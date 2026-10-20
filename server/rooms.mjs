import { randomBytes, randomUUID } from 'node:crypto';
import { createGameState, startGame, drawCards, playCard, applyDamage, advanceTurn, evaluateVictory, GAME_MODES, assignIdentityRoles, assignDuelLordRoles } from './engine.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export class RoomManager {
  constructor({ now = () => Date.now(), reconnectGraceMs = 120_000 } = {}) {
    this.rooms = new Map();
    this.sessions = new Map();
    this.now = now;
    this.reconnectGraceMs = reconnectGraceMs;
  }

  create({ name = '玩家', mode = GAME_MODES.STANDARD, maxPlayers = 8, socket }) {
    if (!Object.values(GAME_MODES).includes(mode)) throw new Error('不支持的游戏模式');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 3 || maxPlayers > 10) throw new Error('房间人数必须为 3～10 人');
    const code = this.#newCode();
    const player = this.#newPlayer(name, socket, true);
    const room = { code, mode, maxPlayers, hostId: player.id, status: 'waiting', players: [player], game: null, createdAt: this.now() };
    this.rooms.set(code, room);
    this.sessions.set(player.token, { roomCode: code, playerId: player.id });
    return { room, player };
  }

  join({ code, name = '玩家', socket }) {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room) throw new Error('房间不存在');
    if (room.status !== 'waiting') throw new Error('对局已开始，暂不允许中途加入');
    if (room.players.length >= room.maxPlayers) throw new Error('房间已满');
    const player = this.#newPlayer(name, socket, false);
    room.players.push(player);
    this.sessions.set(player.token, { roomCode: room.code, playerId: player.id });
    return { room, player };
  }

  reconnect({ token, socket }) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('重连凭证无效或已过期');
    const room = this.rooms.get(session.roomCode);
    const player = room?.players.find(p => p.id === session.playerId);
    if (!room || !player || (player.disconnectedAt && this.now() - player.disconnectedAt > this.reconnectGraceMs)) {
      this.sessions.delete(token);
      throw new Error('重连时间已过，无法恢复房间');
    }
    player.socket = socket;
    player.connected = true;
    player.disconnectedAt = null;
    return { room, player };
  }

  leave(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    const room = this.rooms.get(session.roomCode);
    if (!room) { this.sessions.delete(token); return null; }
    if (room.status === 'playing' && room.game?.status !== 'finished') throw new Error('对局进行中，暂不支持主动离开；可断开连接后重连');
    this.sessions.delete(token);
    const index = room.players.findIndex(p => p.id === session.playerId);
    if (index >= 0) {
      const [player] = room.players.splice(index, 1);
      if (player.socket) player.socket = null;
      if (room.hostId === player.id && room.players.length) room.hostId = room.players[0].id;
    }
    if (!room.players.length) this.rooms.delete(room.code);
    return room;
  }

  disconnect(token, socket = null) {
    const session = this.sessions.get(token);
    if (!session) return null;
    const room = this.rooms.get(session.roomCode);
    const player = room?.players.find(p => p.id === session.playerId);
    // A stale socket closing after reconnection must not disconnect the new socket.
    if (player && (socket === null || player.socket === socket)) {
      player.connected = false;
      player.socket = null;
      player.disconnectedAt = this.now();
    }
    return room ?? null;
  }

  start(token) {
    const { room, player } = this.#session(token);
    if (room.hostId !== player.id) throw new Error('只有房主可以开始游戏');
    if (room.status !== 'waiting') throw new Error('房间已开始');
    if (room.players.length < 3) throw new Error('至少需要 3 名玩家才能开始');
    if (room.mode === GAME_MODES.DUEL_LORD && room.players.length !== 3) throw new Error('斗地主模式目前要求正好 3 名玩家');
    const state = createGameState({ playerCount: room.players.length, mode: room.mode, deck: makeStarterDeck() });
    state.players.forEach((p, i) => {
      p.id = room.players[i].id;
      p.name = room.players[i].name;
    });
    startGame(state, { roles: room.mode === GAME_MODES.DUEL_LORD ? assignDuelLordRoles(room.players.length) : assignIdentityRoles(room.players.length) });
    state.players.forEach(p => drawCards(state, p.id, 4));
    state.drawnThisTurn = false;
    state.attacksUsedThisTurn = false;
    room.game = state;
    room.status = 'playing';
    return room;
  }

  act(token, action) {
    const { room, player } = this.#session(token);
    if (room.status !== 'playing' || !room.game || room.game.status !== 'playing') throw new Error('对局尚未开始或已经结束');
    const game = room.game;

    if (game.pendingResponse) {
      const pending = game.pendingResponse;
      if (pending.type === 'dodge') {
        if (player.id !== pending.targetId) throw new Error('正在等待受【杀】目标响应');
        if (action?.type !== 'respond' || !['dodge', 'pass'].includes(action.response)) throw new Error('请打出【闪】或选择不响应');
        if (action.response === 'dodge') {
          const card = removeResponseCard(game, player.id, action.cardId, 'dodge');
          game.discard.push(card);
          game.log.push({ type: 'card_responded', playerId: player.id, card: card.name, response: 'dodge' });
          game.pendingResponse = null;
          game.log.push({ type: 'attack_evaded', sourceId: pending.sourceId, targetId: pending.targetId });
          return room;
        }
        game.pendingResponse = null;
        const target = game.players.find(p => p.id === pending.targetId);
        if (target?.armor) {
          game.discard.push(target.armor);
          target.armor = null;
          game.log.push({ type: 'armor_blocked', targetId: pending.targetId });
        } else {
          applyDamage(game, { sourceId: pending.sourceId, targetId: pending.targetId, amount: 1, deferDying: true });
          if (game.dyingPlayerId) beginRescue(game, game.dyingPlayerId);
        }
        return room;
      }
      if (pending.type === 'rescue') {
        const expectedId = pending.order[pending.cursor];
        if (player.id !== expectedId) throw new Error('正在等待另一名玩家进行濒死救援');
        if (action?.type !== 'rescue' || !['save', 'pass'].includes(action.response)) throw new Error('请使用【桃】救援或选择放弃');
        const dying = game.players.find(p => p.id === pending.targetId);
        if (action.response === 'save') {
          const card = removeResponseCard(game, player.id, action.cardId, 'heal');
          game.discard.push(card);
          if (!dying) throw new Error('濒死玩家不存在');
          dying.hp += 1;
          game.log.push({ type: 'rescue', rescuerId: player.id, targetId: dying.id, hp: dying.hp });
          if (dying.hp > 0) {
            dying.alive = true;
            game.dyingPlayerId = null;
            game.pendingResponse = null;
            return room;
          }
        }
        pending.cursor += 1;
        if (pending.cursor >= pending.order.length) {
          if (dying) {
            dying.alive = false;
            game.dyingPlayerId = null;
            game.log.push({ type: 'player_died', playerId: dying.id });
            game.pendingResponse = null;
            evaluateVictory(game);
          } else {
            game.pendingResponse = null;
          }
        }
        return room;
      }
    }

    if (action?.type === 'play_card') {
      const current = game.players[game.currentPlayerIndex];
      if (current?.id !== player.id) throw new Error('还没轮到你');
      const heldCard = playerCard(game, player.id, action.cardId);
      if (heldCard.kind === 'dodge') throw new Error('【闪】只能在受到【杀】时响应');
      if (heldCard.kind === 'attack' && game.attacksUsedThisTurn) throw new Error('本回合已经使用过【杀】');
      if (['attack', 'steal'].includes(heldCard.kind) && !action.targetId) throw new Error(heldCard.kind === 'attack' ? '使用【杀】必须选择目标' : '使用【顺手牵羊】必须选择目标');
      if (!['attack', 'steal'].includes(heldCard.kind) && action.targetId) throw new Error('该牌不能指定目标');
      const played = playCard(game, { playerId: player.id, cardId: action.cardId, targetId: action.targetId ?? null });
      const card = played.card;
      if (card.kind === 'attack') {
        game.attacksUsedThisTurn = true;
        game.pendingResponse = { type: 'dodge', sourceId: player.id, targetId: played.targetId };
        game.log.push({ type: 'response_requested', response: 'dodge', sourceId: player.id, targetId: played.targetId });
      }
      if (card.kind === 'heal') {
        const target = game.players.find(p => p.id === player.id);
        target.hp = Math.min(target.hp + 1, target.maxHp);
        game.log.push({ type: 'healed', playerId: player.id, hp: target.hp });
      }
      if (card.kind === 'draw2') drawCards(game, player.id, 2);
      if (card.kind === 'armor') {
        const owner = game.players.find(p => p.id === player.id);
        if (owner.armor) game.discard.push(owner.armor);
        const discardIndex = game.discard.findIndex(c => c.id === card.id);
        if (discardIndex >= 0) game.discard.splice(discardIndex, 1);
        owner.armor = card;
        game.log.push({ type: 'equipment_equipped', playerId: player.id, cardId: card.id, slot: 'armor' });
      }
      if (card.kind === 'steal') {
        const target = game.players.find(p => p.id === played.targetId);
        if (target?.hand.length) {
          const stolenIndex = Math.floor(Math.random() * target.hand.length);
          const [stolen] = target.hand.splice(stolenIndex, 1);
          player.hand.push(stolen);
          game.log.push({ type: 'card_stolen', playerId: player.id, targetId: target.id, cardId: stolen.id });
        } else {
          game.log.push({ type: 'steal_empty', playerId: player.id, targetId: played.targetId });
        }
      }
      return room;
    }
    if (action?.type === 'draw') {
      if (game.players[game.currentPlayerIndex]?.id !== player.id) throw new Error('还没轮到你');
      if (game.drawnThisTurn) throw new Error('本回合已经摸过牌');
      drawCards(game, player.id, 1);
      game.drawnThisTurn = true;
      return room;
    }
    if (action?.type === 'end_turn') {
      if (game.players[game.currentPlayerIndex]?.id !== player.id) throw new Error('还没轮到你');
      advanceTurn(game);
      game.drawnThisTurn = false;
      game.attacksUsedThisTurn = false;
      return room;
    }
    throw new Error('未知操作类型');
  }

  snapshot(room, viewerId) {
    const game = room.game;
    return {
      code: room.code, mode: room.mode, status: game?.status === 'finished' ? 'finished' : room.status, maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      players: room.players.map(p => {
        const gp = game?.players.find(x => x.id === p.id);
        return { id: p.id, name: p.name, host: p.id === room.hostId, connected: p.connected,
          hp: gp?.hp ?? 4, alive: gp?.alive ?? true, armor: gp?.armor?.name ?? null, handCount: gp?.hand.length ?? 0,
          hand: p.id === viewerId ? (gp?.hand ?? []) : undefined, role: p.id === viewerId ? (gp?.role ?? null) : undefined };
      }),
      currentPlayerId: game?.players[game.currentPlayerIndex]?.id ?? null,
      turnNumber: game?.turnNumber ?? 0, winner: game?.winner ?? null, winningSide: game?.winningSide ?? null,
      pendingResponse: game?.pendingResponse ? { type: game.pendingResponse.type, targetId: game.pendingResponse.targetId, responsePlayerId: game.pendingResponse.type === 'rescue' ? game.pendingResponse.order[game.pendingResponse.cursor] : game.pendingResponse.targetId } : null,
      discardCount: game?.discard.length ?? 0,
      log: game?.log.slice(-20) ?? [],
    };
  }

  #session(token) {
    const session = this.sessions.get(token);
    if (!session) throw new Error('会话不存在，请重新加入房间');
    const room = this.rooms.get(session.roomCode);
    const player = room?.players.find(p => p.id === session.playerId);
    if (!room || !player) throw new Error('房间或玩家不存在');
    return { room, player };
  }

  #newPlayer(name, socket, host) {
    return { id: randomUUID(), token: randomBytes(24).toString('hex'), name: String(name).trim().slice(0, 24) || '玩家', socket, connected: true, disconnectedAt: null, host };
  }

  #newCode() {
    let code;
    do { code = roomCode(); } while (this.rooms.has(code));
    return code;
  }
}

function playerCard(game, playerId, cardId) {
  const player = game.players.find(p => p.id === playerId);
  const card = player?.hand.find(c => c.id === cardId);
  if (!card) throw new Error('手牌中没有这张牌');
  return card;
}

function makeStarterDeck() {
  const deck = [];
  let id = 1;
  const kinds = ['heal', 'dodge', 'attack', 'dodge', 'attack', 'draw2', 'steal', 'heal', 'armor'];
  for (let i = 0; i < 90; i++) {
    const kind = kinds[i % kinds.length];
    const name = kind === 'heal' ? '桃' : kind === 'attack' ? '杀' : kind === 'dodge' ? '闪' : kind === 'draw2' ? '摸二张' : kind === 'steal' ? '顺手牵羊' : '护心镜';
    deck.push({ id: 'c' + id++, name, kind });
  }
  return deck;
}

function removeResponseCard(game, playerId, cardId, requiredKind) {
  const player = game.players.find(p => p.id === playerId);
  const index = player?.hand.findIndex(card => card.id === cardId) ?? -1;
  if (index < 0) throw new Error('手牌中没有这张牌');
  if (player.hand[index].kind !== requiredKind) throw new Error(requiredKind === 'dodge' ? '响应【杀】必须使用【闪】' : '濒死救援必须使用【桃】');
  return player.hand.splice(index, 1)[0];
}

function beginRescue(game, targetId) {
  const targetIndex = game.players.findIndex(p => p.id === targetId);
  const order = [];
  for (let step = 0; step < game.players.length; step++) {
    const p = game.players[(targetIndex + step) % game.players.length];
    if (p.alive) order.push(p.id);
  }
  game.pendingResponse = { type: 'rescue', targetId, order, cursor: 0 };
}
