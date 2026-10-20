import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.mjs';

test('room creation and joining enforce player limits', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', maxPlayers: 3 });
  assert.equal(room.players.length, 1);
  manager.join({ code: room.code.toLowerCase(), name: 'P2' });
  manager.join({ code: room.code, name: 'P3' });
  assert.throws(() => manager.join({ code: room.code, name: 'P4' }), /房间已满/);
  assert.equal(manager.snapshot(room, host.id).players.length, 3);
});

test('room start requires host and at least three players', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host' });
  assert.throws(() => manager.start(host.token), /至少需要 3 名玩家/);
  const guest = manager.join({ code: room.code, name: 'Guest' });
  assert.throws(() => manager.start(guest.player.token), /只有房主/);
  manager.join({ code: room.code, name: 'Third' });
  manager.start(host.token);
  assert.equal(room.status, 'playing');
  assert.equal(room.game.players[0].hand.length, 4);
});

test('personal snapshots hide other players’ hands', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host' });
  const guest = manager.join({ code: room.code, name: 'Guest' }).player;
  manager.join({ code: room.code, name: 'Third' });
  manager.start(host.token);
  const hostView = manager.snapshot(room, host.id);
  assert.equal(hostView.players.find(p => p.id === host.id).hand.length, 4);
  assert.equal(hostView.players.find(p => p.id === guest.id).hand, undefined);
  assert.equal(hostView.players.find(p => p.id === guest.id).handCount, 4);
  assert.ok(hostView.players.find(p => p.id === host.id).role);
  assert.equal(hostView.players.find(p => p.id === guest.id).role, undefined);
});

test('reconnect token restores a disconnected player within grace period', () => {
  let now = 1000;
  const manager = new RoomManager({ now: () => now, reconnectGraceMs: 5000 });
  const { room, player } = manager.create({ name: 'Host' });
  manager.disconnect(player.token);
  now += 1000;
  const restored = manager.reconnect({ token: player.token, socket: { restored: true } });
  assert.equal(restored.room.code, room.code);
  assert.equal(restored.player.connected, true);
  assert.equal(restored.player.socket.restored, true);
});

test('expired reconnect token is rejected', () => {
  let now = 1000;
  const manager = new RoomManager({ now: () => now, reconnectGraceMs: 10 });
  const { player } = manager.create({ name: 'Host' });
  manager.disconnect(player.token);
  now += 11;
  assert.throws(() => manager.reconnect({ token: player.token, socket: {} }), /无法恢复房间/);
});

test('finished game snapshots expose the finished status', () => {
  const manager = new RoomManager();
  const { room, player } = manager.create({ name: 'Host' });
  room.status = 'playing';
  room.game = { status: 'finished', mode: 'standard', players: [], currentPlayerIndex: 0, turnNumber: 1, winner: player.id, winningSide: 'lord', discard: [], log: [] };
  assert.equal(manager.snapshot(room, player.id).status, 'finished');
  assert.equal(manager.leave(player.token), room);
});

test('double-general mode requires two distinct selections from every player', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', mode: 'double_general', maxPlayers: 3 });
  const guest = manager.join({ code: room.code, name: 'Guest' }).player;
  const third = manager.join({ code: room.code, name: 'Third' }).player;
  assert.throws(() => manager.start(host.token), /先选择两名武将/);
  assert.throws(() => manager.selectGenerals(host.token, ['wei_guard', 'wei_guard']), /两名不同/);
  manager.selectGenerals(host.token, ['wei_guard', 'wu_sage']);
  manager.selectGenerals(guest.token, ['healer', 'iron_wall']);
  manager.selectGenerals(third.token, ['shu_blade', 'swift_arrow']);
  manager.start(host.token);
  assert.equal(room.game.players[0].generals.length, 2);
  assert.deepEqual(room.game.players[0].generals, ['魏之坚守', '吴之谋略']);
  assert.equal(room.game.players[0].maxHp, 3);
  assert.equal(room.game.players[1].maxHp, 3);
});

test('only landlord selects two generals in landlord mode', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.create({ name: 'Host', mode: 'duel_lord', maxPlayers: 3 });
  manager.join({ code: room.code, name: 'Second' });
  manager.join({ code: room.code, name: 'Third' });
  const landlordIndex = room.assignedRoles.indexOf('landlord');
  const landlord = room.players[landlordIndex];
  const peasant = room.players[room.assignedRoles.indexOf('peasant')];
  assert.throws(() => manager.selectGenerals(peasant.token, ['wei_guard', 'wu_sage']), /只有地主/);
  assert.throws(() => manager.start(host.token), /地主必须先选择/);
  manager.selectGenerals(landlord.token, ['wei_guard', 'wu_sage']);
  manager.start(host.token);
  const landlordState = room.game.players.find(p => p.id === landlord.id);
  const peasantState = room.game.players.find(p => p.id === peasant.id);
  assert.deepEqual(landlordState.generals, ['魏之坚守', '吴之谋略']);
  assert.equal(peasantState.generals.length, 0);
  assert.equal(landlordState.maxHp, 3);
});
