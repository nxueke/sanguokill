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
