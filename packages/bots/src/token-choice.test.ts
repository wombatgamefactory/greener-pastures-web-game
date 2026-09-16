/**
 * ⭐ THE BOTS ON THE TOKEN ISLAND (Dean, ruling R3, 16/09/2026).
 *
 * ⛔ AN UNPRICED OPTION IS ONE A BOT NEVER TAKES, which is this package's
 * standing reason for a test per new decision. The decision is WHICH token a
 * first delivery takes: a higher-VP token, or a lower one carrying a Worker.
 * It has to be priced on the token the move names, and the Worker only on the
 * token that carries it.
 *
 * ⚠️ WHAT THIS DOES NOT CLAIM: that the bots take the Worker token often. At
 * the shipped weights a Worker is worth about 0.83 VP (`tokenWorkerWorth` in
 * terms.ts), below the token set's smallest 1 VP gap. The weights are not
 * tuned here; the tie case proves the Worker is priced at all.
 */

import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA } from '@gp/data';
import { legalMoves, makeProber, testkit, viewFor } from '@gp/engine';
import type { IslandToken, Move, Seat } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { makePolicy, policyRng } from './roster.js';
import type { ExplainedMove } from './types.js';

/** A position, spelled without naming the engine's truth type. */
type Position = ReturnType<typeof testkit.makeState>;

const data: GameData = BASE_GAME_DATA;
const SEAT = 0 as Seat;

function explainAt(state: Position, seat: Seat): { explained: ExplainedMove[]; chosen: Move } {
  const policy = makePolicy('balanced');
  const ctx = {
    data,
    view: viewFor(data, state, seat),
    moves: legalMoves(data, state),
    rng: policyRng('token-choice', seat, 'balanced'),
    probe: makeProber(data, state, seat),
  };
  const explained = policy.explain?.(ctx);
  if (!explained) throw new Error('the reference bot has no explain');
  return { explained, chosen: policy.choose(ctx) };
}

function stockBarn(state: Position, seat: Seat, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

/** A position with ONE payable tile, A1, holding exactly these two tokens. */
function onePayableTile(tokens: IslandToken[]): Position {
  const state = testkit.makeState(data, ['wheat', 'orchard']);
  for (const tile of state.island.tiles) {
    tile.tokens =
      tile.tile === 'A1'
        ? tokens
        : [
            { demand: 'dairy', vp: 6, worker: null },
            { demand: 'dairy', vp: 5, worker: null },
          ];
  }
  stockBarn(state, SEAT, 'wheat', 4);
  return state;
}

const deliveryOf = (moves: readonly ExplainedMove[], token: number) =>
  moves.find((m) => m.move.type === 'deliver' && m.move.tile === 'A1' && m.move.token === token);

describe('the token choice, priced', () => {
  it('prices each token on its own VP, and the Worker only on the token that carries it', () => {
    const state = onePayableTile([
      { demand: 'wheat', vp: 5, worker: null },
      { demand: 'wheat', vp: 4, worker: 'orchard' },
    ]);
    const { explained, chosen } = explainAt(state, SEAT);
    const five = deliveryOf(explained, 0);
    const four = deliveryOf(explained, 1);
    expect(five, 'the 5 VP token is offered').toBeDefined();
    expect(four, 'the 4 VP Worker token is offered').toBeDefined();
    expect(five?.terms['deliver']).toBeGreaterThan(four?.terms['deliver'] ?? Infinity);
    expect(four?.terms['meepleGain']).toBeGreaterThan(0);
    expect(five?.terms['meepleGain'] ?? 0).toBe(0);
    expect(legalMoves(data, state)).toContainEqual(chosen);
  });

  it('takes the Worker token when the VP is level, so the Worker is priced at all', () => {
    const state = onePayableTile([
      { demand: 'wheat', vp: 4, worker: null },
      { demand: 'wheat', vp: 4, worker: 'orchard' },
    ]);
    const { chosen } = explainAt(state, SEAT);
    expect(chosen.type).toBe('deliver');
    if (chosen.type !== 'deliver') return;
    expect(chosen.token).toBe(1);
  });
});
