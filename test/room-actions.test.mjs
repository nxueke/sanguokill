import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.mjs';

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
  assert.throws(() => manager.act(host.token, { type: 'play_card', cardId: 'c3' }), /必须选择目标/);
  assert.equal(room.game.players.find(p => p.id === host.id).hand.some(c => c.id === 'c3'), true);
  manager.act(host.token, { type: 'play_card', cardId: 'c3', targetId: guest.id });
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
  manager.act(host.token, { type: 'play_card', cardId: 'c3', targetId: guest.id });
  assert.throws(
    () => manager.act(host.token, { type: 'play_card', cardId: 'extra-attack', targetId: guest.id }),
    /本回合已经使用过/
  );
  manager.act(host.token, { type: 'end_turn' });
  manager.act(guest.token, { type: 'end_turn' });
  manager.act(host.token, { type: 'play_card', cardId: 'extra-attack', targetId: guest.id });
  assert.equal(room.game.players.find(p => p.id === guest.id).hp, 2);
});
