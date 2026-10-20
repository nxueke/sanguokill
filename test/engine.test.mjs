import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, startGame, drawCards, playCard, applyDamage, advanceTurn, GAME_MODES, IDENTITY_ROLES, assignIdentityRoles, assignDuelLordRoles } from '../server/engine.mjs';

test('accepts player counts 3 through 10 and rejects out-of-range counts', () => {
  for (let n = 3; n <= 10; n++) assert.equal(createGameState({ playerCount: n }).players.length, n);
  assert.throws(() => createGameState({ playerCount: 2 }), /3 to 10/);
  assert.throws(() => createGameState({ playerCount: 11 }), /3 to 10/);
});

test('validates mode and starts a game once', () => {
  assert.throws(() => createGameState({ playerCount: 4, mode: 'unknown' }), /Unsupported/);
  const game = createGameState({ playerCount: 4, mode: GAME_MODES.DOUBLE_GENERAL });
  startGame(game);
  assert.equal(game.status, 'playing');
  assert.throws(() => startGame(game), /already started/);
});

test('draws only available cards and rejects invalid requests', () => {
  const game = createGameState({ playerCount: 3, deck: [{ id: 'c1' }, { id: 'c2' }] });
  startGame(game);
  assert.deepEqual(drawCards(game, 'p1', 3).map(c => c.id), ['c1', 'c2']);
  assert.equal(game.players[0].hand.length, 2);
  assert.throws(() => drawCards(game, 'p1', -1), /Invalid draw/);
});

test('card play validates turn ownership and hand membership', () => {
  const game = createGameState({ playerCount: 3 });
  startGame(game, { hands: [[{ id: 'sha' }], [], []] });
  assert.throws(() => playCard(game, { playerId: 'p2', cardId: 'sha' }), /Not this player/);
  assert.throws(() => playCard(game, { playerId: 'p1', cardId: 'unknown' }), /not in player hand/);
  playCard(game, { playerId: 'p1', cardId: 'sha', targetId: 'p2' });
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.discard[0].id, 'sha');
});

test('damage can eliminate a player and finish a game when one remains', () => {
  const game = createGameState({ playerCount: 3 });
  startGame(game);
  applyDamage(game, { targetId: 'p2', amount: 4 });
  applyDamage(game, { targetId: 'p3', amount: 4 });
  assert.equal(game.status, 'finished');
  assert.equal(game.winner, 'p1');
});

test('turn advancement skips eliminated players', () => {
  const game = createGameState({ playerCount: 4 });
  startGame(game);
  applyDamage(game, { targetId: 'p2', amount: 4 });
  assert.equal(advanceTurn(game).id, 'p3');
});

test('identity role distribution is valid for 3 through 10 players', () => {
  const expected = {
    3: { lord: 1, loyalist: 0, rebel: 1, renegade: 1, landlord: 0, peasant: 0 },
    4: { lord: 1, loyalist: 1, rebel: 2, renegade: 0, landlord: 0, peasant: 0 },
    5: { lord: 1, loyalist: 1, rebel: 2, renegade: 1, landlord: 0, peasant: 0 },
    6: { lord: 1, loyalist: 2, rebel: 2, renegade: 1, landlord: 0, peasant: 0 },
    7: { lord: 1, loyalist: 2, rebel: 3, renegade: 1, landlord: 0, peasant: 0 },
    8: { lord: 1, loyalist: 2, rebel: 4, renegade: 1, landlord: 0, peasant: 0 },
    9: { lord: 1, loyalist: 3, rebel: 4, renegade: 1, landlord: 0, peasant: 0 },
    10: { lord: 1, loyalist: 3, rebel: 5, renegade: 1, landlord: 0, peasant: 0 },
  };
  for (let n = 3; n <= 10; n++) {
    const roles = assignIdentityRoles(n, () => 0.5);
    assert.equal(roles.length, n);
    assert.equal(roles[0], IDENTITY_ROLES.LORD);
    const actual = Object.fromEntries(Object.values(IDENTITY_ROLES).map(role => [role, roles.filter(r => r === role).length]));
    assert.deepEqual(actual, expected[n]);
  }
  assert.throws(() => assignIdentityRoles(2), /3 to 10/);
});

test('identity victory is based on the role team, not simply last player alive', () => {
  const game = createGameState({ playerCount: 4 });
  startGame(game, { roles: ['lord', 'loyalist', 'rebel', 'rebel'] });
  applyDamage(game, { targetId: 'p3', amount: 4 });
  applyDamage(game, { targetId: 'p4', amount: 4 });
  assert.equal(game.status, 'finished');
  assert.equal(game.winningSide, 'lord');
  assert.equal(game.winner, 'p1');
});

test('identity game continues when only lord and renegade remain', () => {
  const game = createGameState({ playerCount: 5 });
  startGame(game, { roles: ['lord', 'loyalist', 'rebel', 'rebel', 'renegade'] });
  applyDamage(game, { targetId: 'p2', amount: 4 });
  applyDamage(game, { targetId: 'p3', amount: 4 });
  applyDamage(game, { targetId: 'p4', amount: 4 });
  assert.equal(game.status, 'playing');
  assert.equal(game.winner, null);
  applyDamage(game, { targetId: 'p1', amount: 4 });
  assert.equal(game.status, 'finished');
  assert.equal(game.winningSide, 'renegade');
});

test('drawing reshuffles discarded cards when the deck runs out', () => {
  const game = createGameState({ playerCount: 3, deck: [{ id: 'draw-1' }] });
  startGame(game);
  game.discard.push({ id: 'discard-1' }, { id: 'discard-2' });
  const drawn = drawCards(game, 'p1', 3);
  assert.equal(drawn.length, 3);
  assert.deepEqual(new Set(drawn.map(card => card.id)), new Set(['draw-1', 'discard-1', 'discard-2']));
  assert.equal(game.discard.length, 0);
});

test('landlord mode assigns one landlord and two peasants and checks team victory', () => {
  const roles = assignDuelLordRoles(3, () => 0.2);
  assert.equal(roles.filter(role => role === 'landlord').length, 1);
  assert.equal(roles.filter(role => role === 'peasant').length, 2);
  assert.throws(() => assignDuelLordRoles(4), /exactly 3/);
  const game = createGameState({ playerCount: 3, mode: GAME_MODES.DUEL_LORD });
  startGame(game, { roles: ['landlord', 'peasant', 'peasant'] });
  applyDamage(game, { targetId: 'p2', amount: 4 });
  applyDamage(game, { targetId: 'p3', amount: 4 });
  assert.equal(game.status, 'finished');
  assert.equal(game.winningSide, 'landlord');
  assert.equal(game.winner, 'p1');
});
