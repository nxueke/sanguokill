/** Minimal authoritative rules core. All mutations must run on the server. */
export const GAME_MODES = Object.freeze({ STANDARD: 'standard', DUEL_LORD: 'duel_lord', DOUBLE_GENERAL: 'double_general' });
export const IDENTITY_ROLES = Object.freeze({ LORD: 'lord', LOYALIST: 'loyalist', REBEL: 'rebel', RENEGADE: 'renegade' });

/** Standard identity-role counts for 3–10 players. The lord is always first. */
export function assignIdentityRoles(playerCount, random = Math.random) {
  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 10) {
    throw new RangeError('playerCount must be an integer from 3 to 10');
  }
  if (typeof random !== 'function') throw new TypeError('random must be a function');
  const counts = {
    3: { loyalists: 0, rebels: 1, renegades: 1 },
    4: { loyalists: 1, rebels: 2, renegades: 0 },
    5: { loyalists: 1, rebels: 2, renegades: 1 },
    6: { loyalists: 2, rebels: 2, renegades: 1 },
    7: { loyalists: 2, rebels: 3, renegades: 1 },
    8: { loyalists: 2, rebels: 4, renegades: 1 },
    9: { loyalists: 3, rebels: 4, renegades: 1 },
    10: { loyalists: 3, rebels: 5, renegades: 1 },
  }[playerCount];
  const roles = [
    IDENTITY_ROLES.LORD,
    ...Array(counts.loyalists).fill(IDENTITY_ROLES.LOYALIST),
    ...Array(counts.rebels).fill(IDENTITY_ROLES.REBEL),
    ...Array(counts.renegades).fill(IDENTITY_ROLES.RENEGADE),
  ];
  // Keep the lord in seat 1; shuffle all other roles for replayability.
  for (let i = roles.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.max(0, Math.min(0.999999999, random())) * i);
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

export function createGameState({ playerCount, mode = GAME_MODES.STANDARD, deck = [] }) {
  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 10) {
    throw new RangeError('playerCount must be an integer from 3 to 10');
  }
  if (!Object.values(GAME_MODES).includes(mode)) throw new TypeError('Unsupported game mode');
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: `p${index + 1}`, seat: index, name: `Player ${index + 1}`,
    hp: 4, maxHp: 4, hand: [], alive: true, generals: [], role: null, marks: {},
  }));
  return {
    version: 1, status: 'waiting', mode, playerCount, players, winningSide: null,
    deck: [...deck], discard: [], currentPlayerIndex: 0, turnPhase: 'waiting',
    turnNumber: 0, winner: null, log: [],
  };
}

export function startGame(state, { roles = [], hands = [] } = {}) {
  if (state.status !== 'waiting') throw new Error('Game has already started');
  if (roles.length && roles.length !== state.playerCount) throw new Error('Role count must match player count');
  if (hands.length && hands.length !== state.playerCount) throw new Error('Hand count must match player count');
  state.players.forEach((p, i) => {
    if (roles.length) p.role = roles[i];
    if (hands.length) p.hand = [...hands[i]];
  });
  state.status = 'playing';
  state.turnPhase = 'play';
  state.turnNumber = 1;
  state.log.push({ type: 'game_started', turn: 1 });
  return state;
}

export function drawCards(state, playerId, count = 1) {
  assertPlaying(state);
  if (!Number.isInteger(count) || count < 0 || count > 20) throw new RangeError('Invalid draw count');
  const player = requirePlayer(state, playerId);
  if (!player.alive) throw new Error('Dead players cannot draw cards');
  const drawn = [];
  while (drawn.length < count && state.deck.length) drawn.push(state.deck.shift());
  player.hand.push(...drawn);
  state.log.push({ type: 'cards_drawn', playerId, count: drawn.length });
  return drawn;
}

export function playCard(state, { playerId, cardId, targetId = null }) {
  assertPlaying(state);
  const player = requirePlayer(state, playerId);
  if (!player.alive) throw new Error('Dead players cannot play cards');
  if (state.players[state.currentPlayerIndex]?.id !== playerId) throw new Error("Not this player's turn");
  const index = player.hand.findIndex(card => card.id === cardId);
  if (index < 0) throw new Error('Card is not in player hand');
  if (targetId !== null) {
    const target = requirePlayer(state, targetId);
    if (!target.alive) throw new Error('Cannot target a dead player');
    if (targetId === playerId) throw new Error('Cannot target self with this generic action');
  }
  const [card] = player.hand.splice(index, 1);
  state.discard.push(card);
  state.log.push({ type: 'card_played', playerId, cardId, targetId });
  return { card, targetId };
}

export function applyDamage(state, { sourceId = null, targetId, amount = 1 }) {
  assertPlaying(state);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10) throw new RangeError('Invalid damage amount');
  const target = requirePlayer(state, targetId);
  if (!target.alive) throw new Error('Target is already dead');
  target.hp -= amount;
  state.log.push({ type: 'damage', sourceId, targetId, amount, hp: target.hp });
  if (target.hp <= 0) {
    target.alive = false;
    state.log.push({ type: 'player_died', playerId: targetId });
    evaluateVictory(state);
  }
  return target.hp;
}

export function advanceTurn(state) {
  assertPlaying(state);
  for (let step = 1; step <= state.playerCount; step++) {
    const next = (state.currentPlayerIndex + step) % state.playerCount;
    if (state.players[next].alive) {
      state.currentPlayerIndex = next;
      state.turnNumber += 1;
      state.turnPhase = 'play';
      state.log.push({ type: 'turn_started', playerId: state.players[next].id, turn: state.turnNumber });
      return state.players[next];
    }
  }
  evaluateVictory(state);
  return null;
}

export function evaluateVictory(state) {
  const alive = state.players.filter(p => p.alive);
  if (alive.length <= 1) {
    state.status = 'finished';
    state.turnPhase = 'finished';
    state.winner = alive[0]?.id ?? null;
    state.log.push({ type: 'game_finished', winner: state.winner });
  }
  return state.winner;
}

function requirePlayer(state, id) {
  const player = state.players.find(p => p.id === id);
  if (!player) throw new Error(`Unknown player: ${id}`);
  return player;
}
function assertPlaying(state) {
  if (state.status !== 'playing') throw new Error('Game is not in playing state');
}
