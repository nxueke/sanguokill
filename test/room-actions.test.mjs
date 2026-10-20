import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.mjs';

function attackCardId(room, playerId) {
  const player = room.game.players.find(p => p.id === playerId);
  const card = player.hand.find(c => c.kind === 'attack');
  if (!card) throw new Error('Test fixture expected an attack card in the starting hand');
  return card.id;
}

function startedRoom() {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', maxPlayers: 3 });
  const guest = manager.join({ code: room.code, name: 'Guest' }).player;
  manager.join({ code: room.code, name: 'Third' });
  manager.start(host.token);
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
  const { manager, host, guest } = startedRoom();
  assert.throws(() => manager.act(host.token, { type: 'play_card', cardId: 'c2' }), /只能在受到/);
  assert.throws(() => manager.act(guest.token, { type: 'draw' }), /还没轮到你/);
});

test('drawing is limited to once per turn and resets after turn advancement', () => {
  const { manager, host, guest, room } = startedRoom();
  manager.act(host.token, { type: 'draw' });
  assert.throws(() => manager.act(host.token, { type: 'draw' }), /已经摸过牌/);
  manager.act(host.token, { type: 'end_turn' });
  manager.act(guest.token, { type: 'draw' });
  assert.equal(room.game.players.find(p => p.id === guest.id).hand.length, 5);
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
