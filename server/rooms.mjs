import { randomBytes, randomUUID } from 'node:crypto';
import { createGameState, startGame, drawCards, playCard, applyDamage, advanceTurn, GAME_MODES } from './engine.mjs';

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
    this.sessions.delete(token);
    const room = this.rooms.get(session.roomCode);
    if (!room) return null;
    const index = room.players.findIndex(p => p.id === session.playerId);
    if (index >= 0) {
      const [player] = room.players.splice(index, 1);
      if (player.socket) player.socket = null;
      if (room.hostId === player.id && room.players.length) room.hostId = room.players[0].id;
    }
    if (!room.players.length) this.rooms.delete(room.code);
    return room;
  }

  disconnect(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    const room = this.rooms.get(session.roomCode);
    const player = room?.players.find(p => p.id === session.playerId);
    if (player) {
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
    const state = createGameState({ playerCount: room.players.length, mode: room.mode, deck: makeStarterDeck() });
    state.players.forEach((p, i) => {
      p.id = room.players[i].id;
      p.name = room.players[i].name;
    });
    startGame(state);
    state.players.forEach(p => drawCards(state, p.id, 4));
    room.game = state;
    room.status = 'playing';
    return room;
  }

  act(token, action) {
    const { room, player } = this.#session(token);
    if (room.status !== 'playing' || !room.game) throw new Error('对局尚未开始');
    if (action?.type === 'play_card') {
      const played = playCard(room.game, { playerId: player.id, cardId: action.cardId, targetId: action.targetId ?? null });
      const card = played.card;
      if (card.kind === 'attack' && played.targetId) applyDamage(room.game, { sourceId: player.id, targetId: played.targetId, amount: 1 });
      if (card.kind === 'heal') player.hp = Math.min(player.hp + 1, player.maxHp);
      return room;
    }
    if (action?.type === 'draw') {
      if (room.game.players[room.game.currentPlayerIndex]?.id !== player.id) throw new Error('还没轮到你');
      drawCards(room.game, player.id, 1);
      return room;
    }
    if (action?.type === 'end_turn') {
      if (room.game.players[room.game.currentPlayerIndex]?.id !== player.id) throw new Error('还没轮到你');
      advanceTurn(room.game);
      return room;
    }
    throw new Error('未知操作类型');
  }

  snapshot(room, viewerId) {
    const game = room.game;
    return {
      code: room.code, mode: room.mode, status: room.status, maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      players: room.players.map(p => {
        const gp = game?.players.find(x => x.id === p.id);
        return { id: p.id, name: p.name, host: p.id === room.hostId, connected: p.connected,
          hp: gp?.hp ?? 4, alive: gp?.alive ?? true, handCount: gp?.hand.length ?? 0,
          hand: p.id === viewerId ? (gp?.hand ?? []) : undefined };
      }),
      currentPlayerId: game?.players[game.currentPlayerIndex]?.id ?? null,
      turnNumber: game?.turnNumber ?? 0, winner: game?.winner ?? null,
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

function makeStarterDeck() {
  const deck = [];
  let id = 1;
  for (let i = 0; i < 60; i++) {
    const kind = i % 5 === 0 ? 'heal' : i % 2 === 0 ? 'attack' : 'dodge';
    const name = kind === 'heal' ? '桃' : kind === 'attack' ? '杀' : '闪';
    deck.push({ id: 'c' + id++, name, kind });
  }
  return deck;
}
