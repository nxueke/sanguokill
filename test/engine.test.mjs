import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, startGame, drawCards, playCard, applyDamage, advanceTurn, GAME_MODES } from '../server/engine.mjs';

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
