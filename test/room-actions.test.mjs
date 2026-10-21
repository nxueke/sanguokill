import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.mjs';

function cardIdOfKind(room, playerId, kind) {
  const player = room.game.players.find(p => p.id === playerId);
  const card = player.hand.find(c => c.kind === kind);
  if (!card) throw new Error(`Test fixture expected a ${kind} card in the starting hand`);
  return card.id;
}

function attackCardId(room, playerId) {
  const player = room.game.players.find(p => p.id === playerId);
  return cardIdOfKind(room, playerId, 'attack');
}

function startedRoom() {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', maxPlayers: 3 });
  const guest = manager.join({ code: room.code, name: 'Guest' }).player;
  manager.join({ code: room.code, name: 'Third' });
  manager.start(host.token);
  // Keep action tests deterministic even though the production deck is shuffled.
  const hostState = room.game.players.find(p => p.id === host.id);
  if (!hostState.hand.some(card => card.kind === 'attack')) {
    hostState.hand.push({ id: 'fixture-attack', name: '杀', kind: 'attack' });
  }
  if (!hostState.hand.some(card => card.kind === 'dodge')) {
    hostState.hand.push({ id: 'fixture-dodge', name: '闪', kind: 'dodge' });
  }
  return { manager, room, host, guest };
}

test('attack card requires a target and applies server-side damage', () => {
  const { manager, room, host, guest } = startedRoom();
  assert.throws(() => manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id) }), /必须选择目标/);
  assert.equal(room.game.players.find(p => p.id === host.id).hand.some(c => c.id === attackCardId(room, host.id)), true);
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  assert.equal(room.game.players.find(p => p.id === guest.id).hp, 4);
  assert.equal(room.game.pendingResponse.type, 'dodge');
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(room.game.players.find(p => p.id === guest.id).hp, 3);
});

test('dodge cannot be proactively played and non-current player cannot act', () => {
  const { manager, room, host, guest } = startedRoom();
  assert.throws(() => manager.act(host.token, { type: 'play_card', cardId: cardIdOfKind(room, host.id, 'dodge') }), /只能在受到/);
  assert.throws(() => manager.act(guest.token, { type: 'draw' }), /还没轮到你/);
});

test('drawing is limited to once per turn and resets after turn advancement', () => {
  const { manager, host, guest, room } = startedRoom();
  manager.act(host.token, { type: 'draw' });
  assert.throws(() => manager.act(host.token, { type: 'draw' }), /已经摸过牌/);
  const hostState = room.game.players.find(p => p.id === host.id);
  manager.act(host.token, { type: 'discard', cardIds: hostState.hand.slice(0, hostState.hand.length - hostState.hp).map(card => card.id) });
  manager.act(host.token, { type: 'end_turn' });
  manager.act(guest.token, { type: 'draw' });
  assert.equal(room.game.players.find(p => p.id === guest.id).hand.length, 6);
});

test('active game cannot remove a player from the room roster', () => {
  const { manager, host, room } = startedRoom();
  assert.throws(() => manager.leave(host.token), /对局进行中/);
  assert.equal(room.players.length, 3);
});

test('stale socket close does not disconnect a reconnected player', () => {
  const manager = new RoomManager();
  const oldSocket = { id: 'old' };
  const newSocket = { id: 'new' };
  const { room, player } = manager.create({ name: 'Host', socket: oldSocket });
  manager.disconnect(player.token, oldSocket);
  manager.reconnect({ token: player.token, socket: newSocket });
  manager.disconnect(player.token, oldSocket);
  assert.equal(room.players[0].connected, true);
  assert.equal(room.players[0].socket, newSocket);
});

test('a player can use at most one attack per turn', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  hostState.hand.push({ id: 'extra-attack', name: '杀', kind: 'attack' });
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.throws(
    () => manager.act(host.token, { type: 'play_card', cardId: 'extra-attack', targetId: guest.id }),
    /本回合已经用完【杀】次数/
  );
  manager.act(host.token, { type: 'end_turn' });
  manager.act(guest.token, { type: 'end_turn' });
  manager.act(room.players[2].token, { type: 'end_turn' });
  manager.act(host.token, { type: 'play_card', cardId: 'extra-attack', targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(room.game.players.find(p => p.id === guest.id).hp, 2);
});

test('target can evade an attack with dodge', () => {
  const { manager, room, host, guest } = startedRoom();
  room.game.players.find(p => p.id === guest.id).hand.push({ id: 'guest-dodge', name: '闪', kind: 'dodge' });
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  assert.throws(() => manager.act(host.token, { type: 'draw' }), /等待受/);
  manager.act(guest.token, { type: 'respond', response: 'dodge', cardId: 'guest-dodge' });
  assert.equal(room.game.players.find(p => p.id === guest.id).hp, 4);
  assert.equal(room.game.pendingResponse, null);
});

test('a player at zero HP can be rescued with peach', () => {
  const { manager, room, host, guest } = startedRoom();
  const target = room.game.players.find(p => p.id === guest.id);
  target.hp = 1;
  target.hand.push({ id: 'rescue-peach', name: '桃', kind: 'heal' });
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(target.hp, 0);
  assert.equal(target.alive, true);
  assert.equal(room.game.pendingResponse.type, 'rescue');
  manager.act(guest.token, { type: 'rescue', response: 'save', cardId: 'rescue-peach' });
  assert.equal(target.hp, 1);
  assert.equal(target.alive, true);
  assert.equal(room.game.pendingResponse, null);
});

test('a player dies only after all rescue seats pass', () => {
  const { manager, room, host, guest } = startedRoom();
  const target = room.game.players.find(p => p.id === guest.id);
  target.hp = 1;
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(target.alive, true);
  manager.act(guest.token, { type: 'rescue', response: 'pass' });
  manager.act(room.players[2].token, { type: 'rescue', response: 'pass' });
  manager.act(host.token, { type: 'rescue', response: 'pass' });
  assert.equal(target.alive, false);
  assert.equal(room.game.pendingResponse, null);
});

test('dismantle trick discards one target hand card without transferring it', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.hand.push({ id: 'dismantle-test', name: '过河拆桥', kind: 'dismantle' });
  guestState.hand.push({ id: 'guest-extra', name: '闪', kind: 'dodge' });
  const guestBefore = guestState.hand.length;
  const hostBefore = hostState.hand.length;
  const discardBefore = room.game.discard.length;
  manager.act(host.token, { type: 'play_card', cardId: 'dismantle-test', targetId: guest.id });
  assert.equal(guestState.hand.length, guestBefore - 1);
  assert.equal(hostState.hand.length, hostBefore - 1);
  assert.equal(room.game.discard.length, discardBefore + 2);
  assert.equal(room.game.log.some(entry => entry.type === 'card_dismantled' && entry.targetId === guest.id), true);
});

test('landlord room requires exactly three players and assigns hidden roles', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', mode: 'duel_lord', maxPlayers: 4 });
  manager.join({ code: room.code, name: 'Second' });
  manager.join({ code: room.code, name: 'Third' });
  manager.join({ code: room.code, name: 'Fourth' });
  assert.throws(() => manager.start(host.token), /正好 3 名玩家/);
});

test('draw-two card draws two cards and steal transfers one target card', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  const beforeDraw = hostState.hand.length;
  hostState.hand.push({ id: 'draw-two-test', name: '摸二张', kind: 'draw2' });
  manager.act(host.token, { type: 'play_card', cardId: 'draw-two-test' });
  assert.equal(hostState.hand.length, beforeDraw + 2);

  hostState.hand.push({ id: 'steal-test', name: '顺手牵羊', kind: 'steal' });
  const guestBefore = guestState.hand.length;
  const hostBefore = hostState.hand.length;
  manager.act(host.token, { type: 'play_card', cardId: 'steal-test', targetId: guest.id });
  assert.equal(guestState.hand.length, guestBefore - 1);
  assert.equal(hostState.hand.length, hostBefore);
});

test('Five Grains makes every living player draw one card', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  const thirdState = room.game.players.find(p => p.id !== host.id && p.id !== guest.id);
  hostState.hand.push({ id: 'harvest-test', name: '五谷丰登', kind: 'harvest' });
  const before = [hostState, guestState, thirdState].map(p => p.hand.length);
  manager.act(host.token, { type: 'play_card', cardId: 'harvest-test' });
  assert.deepEqual([hostState, guestState, thirdState].map(p => p.hand.length), [before[0], before[1] + 1, before[2] + 1]);
  assert.equal(room.game.log.filter(entry => entry.type === 'harvest_draw').length, 3);
});

test('Five Grains skips dead players', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  const thirdState = room.game.players.find(p => p.id !== host.id && p.id !== guest.id);
  thirdState.alive = false;
  hostState.hand.push({ id: 'harvest-dead-test', name: '五谷丰登', kind: 'harvest' });
  const hostBefore = hostState.hand.length;
  const guestBefore = guestState.hand.length;
  const deadBefore = thirdState.hand.length;
  manager.act(host.token, { type: 'play_card', cardId: 'harvest-dead-test' });
  assert.equal(hostState.hand.length, hostBefore);
  assert.equal(guestState.hand.length, guestBefore + 1);
  assert.equal(thirdState.hand.length, deadBefore);
});

test('armor equips into a slot and blocks one incoming attack', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.hand.push({ id: 'armor-test', name: '护心镜', kind: 'armor' });
  manager.act(host.token, { type: 'play_card', cardId: 'armor-test' });
  assert.equal(hostState.armor.id, 'armor-test');
  assert.equal(room.game.discard.some(card => card.id === 'armor-test'), false);
  guestState.hand.push({ id: 'guest-attack', name: '杀', kind: 'attack' });
  manager.act(host.token, { type: 'end_turn' });
  manager.act(guest.token, { type: 'play_card', cardId: 'guest-attack', targetId: host.id });
  manager.act(host.token, { type: 'respond', response: 'pass' });
  assert.equal(hostState.hp, 4);
  assert.equal(hostState.armor, null);
});

test('Shu dual general permits a second attack but not a third', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  hostState.generalIds = ['shu_blade'];
  hostState.hand.push(
    { id: 'extra-attack-1', name: '杀', kind: 'attack' },
    { id: 'extra-attack-2', name: '杀', kind: 'attack' }
  );
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  manager.act(host.token, { type: 'play_card', cardId: 'extra-attack-1', targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.throws(() => manager.act(host.token, { type: 'play_card', cardId: 'extra-attack-2', targetId: guest.id }), /已经用完【杀】次数/);
  assert.equal(room.game.players.find(p => p.id === guest.id).hp, 2);
});

test('Healer general increases Peach healing and Iron Wall blocks one attack', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.generalIds = ['healer'];
  hostState.hp = 2;
  hostState.hand.push({ id: 'healer-peach', name: '桃', kind: 'heal' });
  manager.act(host.token, { type: 'play_card', cardId: 'healer-peach' });
  assert.equal(hostState.hp, 4);
  guestState.generalIds = ['iron_wall'];
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(guestState.hp, 4);
  assert.equal(guestState.marks.ironWallUsed, true);
});

test('Wu general draws three cards from draw-two and Swift Arrow deals two damage', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.generalIds = ['wu_sage'];
  const before = hostState.hand.length;
  hostState.hand.push({ id: 'wu-draw-two', name: '摸二张', kind: 'draw2' });
  manager.act(host.token, { type: 'play_card', cardId: 'wu-draw-two' });
  assert.equal(hostState.hand.length, before + 3);
  hostState.generalIds = ['swift_arrow'];
  hostState.hand.push({ id: 'swift-attack', name: '杀', kind: 'attack' });
  manager.act(host.token, { type: 'play_card', cardId: 'swift-attack', targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(guestState.hp, 2);
});

test('original Wine card boosts the next attack by one damage', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.hand.push({ id: 'wine-test', name: '酒', kind: 'wine' });
  manager.act(host.token, { type: 'play_card', cardId: 'wine-test' });
  assert.equal(hostState.marks.wineBoost, true);
  manager.act(host.token, { type: 'play_card', cardId: attackCardId(room, host.id), targetId: guest.id });
  assert.equal(room.game.pendingResponse.damage, 2);
  manager.act(guest.token, { type: 'respond', response: 'pass' });
  assert.equal(guestState.hp, 2);
  assert.equal(hostState.marks.wineBoost, false);
});


test('duel alternates attack responses and damages the player who cannot answer', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.hand.push({ id: 'duel-test', name: '决斗', kind: 'duel' });
  guestState.hand.push({ id: 'duel-response', name: '杀', kind: 'attack' });

  manager.act(host.token, { type: 'play_card', cardId: 'duel-test', targetId: guest.id });
  assert.equal(room.game.pendingResponse.type, 'duel');
  assert.equal(room.game.pendingResponse.responderId, guest.id);

  manager.act(guest.token, { type: 'respond', response: 'attack', cardId: 'duel-response' });
  assert.equal(room.game.pendingResponse.responderId, host.id);
  manager.act(host.token, { type: 'respond', response: 'pass' });

  assert.equal(hostState.hp, 3);
  assert.equal(guestState.hp, 4);
  assert.equal(room.game.pendingResponse, null);
  assert.equal(room.game.log.some(entry => entry.type === 'duel_finished' && entry.loserId === host.id), true);
});


test('Peach Garden heals every living player by one up to max HP', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  const thirdState = room.game.players.find(p => p.id !== host.id && p.id !== guest.id);
  hostState.hp = 2;
  guestState.hp = 3;
  thirdState.hp = 4;
  hostState.hand.push({ id: 'peach-garden-test', name: '桃园结义', kind: 'peach_garden' });

  manager.act(host.token, { type: 'play_card', cardId: 'peach-garden-test' });

  assert.equal(hostState.hp, 3);
  assert.equal(guestState.hp, 4);
  assert.equal(thirdState.hp, 4);
  assert.equal(room.game.log.some(entry => entry.type === 'peach_garden_heal' && entry.targetId === guest.id), true);
});


test('Qinggang Sword ignores armor without consuming the armor slot', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.hand.push({ id: 'qinggang-test', name: '青釭剑', kind: 'weapon' });
  manager.act(host.token, { type: 'play_card', cardId: 'qinggang-test' });
  guestState.armor = { id: 'guest-armor', name: '护心镜', kind: 'armor' };
  hostState.hand.push({ id: 'qinggang-attack', name: '杀', kind: 'attack' });

  manager.act(host.token, { type: 'play_card', cardId: 'qinggang-attack', targetId: guest.id });
  manager.act(guest.token, { type: 'respond', response: 'pass' });

  assert.equal(guestState.hp, 3);
  assert.equal(guestState.armor.id, 'guest-armor');
  assert.equal(hostState.weapon.name, '青釭剑');
  assert.equal(manager.snapshot(room, host.id).players.find(p => p.id === host.id).weapon, '青釭剑');
});


test('Supply Shortage skips the target next draw and expires after use', () => {
  const { manager, room, host, guest } = startedRoom();
  const hostState = room.game.players.find(p => p.id === host.id);
  const guestState = room.game.players.find(p => p.id === guest.id);
  hostState.hand.push({ id: 'supply-test', name: '兵粮寸断', kind: 'supply_shortage' });
  manager.act(host.token, { type: 'play_card', cardId: 'supply-test', targetId: guest.id });
  assert.equal(guestState.marks.skipDraw, true);

  manager.act(host.token, { type: 'end_turn' });
  const handBefore = guestState.hand.length;
  manager.act(guest.token, { type: 'draw' });
  assert.equal(guestState.hand.length, handBefore);
  assert.equal(guestState.marks.skipDraw, false);
  assert.equal(room.game.log.some(entry => entry.type === 'supply_shortage_triggered' && entry.playerId === guest.id), true);
});


test('attack distance is enforced and Qinggang Sword extends attack range to two', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', maxPlayers: 4 });
  const second = manager.join({ code: room.code, name: 'Second' }).player;
  const third = manager.join({ code: room.code, name: 'Third' }).player;
  manager.join({ code: room.code, name: 'Fourth' });
  manager.start(host.token);
  const hostState = room.game.players.find(p => p.id === host.id);
  const thirdState = room.game.players.find(p => p.id === third.id);
  hostState.hand.push({ id: 'range-test-attack', name: '杀', kind: 'attack' });
  assert.throws(
    () => manager.act(host.token, { type: 'play_card', cardId: 'range-test-attack', targetId: third.id }),
    /超出【杀】的攻击距离/
  );
  hostState.hand.push({ id: 'range-test-sword', name: '青釭剑', kind: 'weapon' });
  manager.act(host.token, { type: 'play_card', cardId: 'range-test-sword' });
  manager.act(host.token, { type: 'play_card', cardId: 'range-test-attack', targetId: third.id });
  assert.equal(room.game.pendingResponse.targetId, third.id);
  assert.equal(thirdState.hp, 4);
});

test('Steal only targets a player at distance one', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', maxPlayers: 4 });
  manager.join({ code: room.code, name: 'Second' });
  const third = manager.join({ code: room.code, name: 'Third' }).player;
  manager.join({ code: room.code, name: 'Fourth' });
  manager.start(host.token);
  const hostState = room.game.players.find(p => p.id === host.id);
  hostState.hand.push({ id: 'range-test-steal', name: '顺手牵羊', kind: 'steal' });
  assert.throws(
    () => manager.act(host.token, { type: 'play_card', cardId: 'range-test-steal', targetId: third.id }),
    /距离 1 以内/
  );
  assert.equal(hostState.hand.some(card => card.id === 'range-test-steal'), true);
});


test('targeted cards reject self, missing, and dead targets without consuming the card', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', maxPlayers: 3 });
  const second = manager.join({ code: room.code, name: 'Second' }).player;
  manager.join({ code: room.code, name: 'Third' });
  manager.start(host.token);
  const hostState = room.game.players.find(p => p.id === host.id);
  const secondState = room.game.players.find(p => p.id === second.id);
  hostState.hand.push({ id: 'target-validation-steal', name: '顺手牵羊', kind: 'steal' });
  assert.throws(() => manager.act(host.token, {
    type: 'play_card', cardId: 'target-validation-steal', targetId: host.id
  }), /不能将此牌指定为自己/);
  assert.throws(() => manager.act(host.token, {
    type: 'play_card', cardId: 'target-validation-steal', targetId: 'missing-player'
  }), /目标不存在或已经阵亡/);
  secondState.alive = false;
  assert.throws(() => manager.act(host.token, {
    type: 'play_card', cardId: 'target-validation-steal', targetId: second.id
  }), /目标不存在或已经阵亡/);
  assert.equal(hostState.hand.some(card => card.id === 'target-validation-steal'), true);
});


test('end turn enforces hand limit and validates exact discard selection', () => {
  const { manager, room, host } = startedRoom();
  const actor = room.game.players.find(p => p.id === host.id);
  actor.hp = 2;
  while (actor.hand.length < 4) actor.hand.push({ id: 'limit-' + actor.hand.length, name: '闪', kind: 'dodge' });
  const discardIds = actor.hand.slice(0, actor.hand.length - actor.hp).map(card => card.id);
  assert.throws(() => manager.act(host.token, { type: 'end_turn' }), /必须弃置超出体力值/);
  assert.throws(() => manager.act(host.token, { type: 'discard', cardIds: discardIds.slice(0, 1) }), /恰好选择/);
  assert.throws(() => manager.act(host.token, { type: 'discard', cardIds: ['not-in-hand', ...discardIds.slice(1)] }), /不属于你的手牌/);
  manager.act(host.token, { type: 'discard', cardIds: discardIds });
  assert.equal(actor.hand.length, actor.hp);
  manager.act(host.token, { type: 'end_turn' });
  assert.equal(room.game.currentPlayerIndex, 1);
});
