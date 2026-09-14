/**
 * ⭐ THE BOTS UNDER DEAN'S SPACE CHOICE AND CLOSING DRAW (ruled 14/09/2026),
 * shipped beside the delivery meeple.
 *
 * ⛔ AN UNPRICED OPTION IS ONE A BOT NEVER TAKES, which is this package's
 * standing reason for a test per new decision. Two decisions arrive: WHICH
 * space a delivery takes (the 6 VP space, or the 3 VP space and its meeple),
 * and WHICH deck a cornucopia crate's closing draw comes from. The first has to
 * be priced on the space the move names, and the meeple on the space that
 * actually carries it; the second is the ordinary draw task's deck pick.
 *
 * ⚠️ WHAT THIS DOES NOT CLAIM: that the bots choose the 3 VP space often. At
 * the shipped weights a delivery is `deliver` times its VP plus `meepleGain` for
 * the meeple, and 6 VP outweighs 3 VP and a meeple in almost every position. The
 * weights are not tuned here.
 */

import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA } from '@gp/data';
import { apply, legalMoves, makeProber, testkit, viewFor } from '@gp/engine';
import type { Move, Seat } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { makePolicy, policyRng } from './roster.js';
import type { ExplainedMove } from './types.js';

/** A position, spelled without naming the engine's truth type. */
type Position = ReturnType<typeof testkit.makeState>;

const data: GameData = BASE_GAME_DATA;
const SEAT = 0 as Seat;
const OTHER = 1 as Seat;

function explainAt(state: Position, seat: Seat): { explained: ExplainedMove[]; chosen: Move } {
  const policy = makePolicy('balanced');
  const ctx = {
    data,
    view: viewFor(data, state, seat),
    moves: legalMoves(data, state),
    rng: policyRng('delivery-space-choice', seat, 'balanced'),
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

const deliveryTo = (moves: readonly ExplainedMove[], tile: string, space: number) =>
  moves.find((m) => m.move.type === 'deliver' && m.move.tile === tile && m.move.space === space);

describe('the space choice, priced', () => {
  it('prices each space on its own VP, and the meeple only on the space that carries it', () => {
    const state = testkit.makeState(data, ['wheat', 'orchard']);
    stockBarn(state, SEAT, 'wheat', 4);
    const { explained, chosen } = explainAt(state, SEAT);
    const six = deliveryTo(explained, 'A1', 0);
    const three = deliveryTo(explained, 'A1', 1);
    expect(six, 'the 6 VP space is offered').toBeDefined();
    expect(three, 'the 3 VP space is offered').toBeDefined();
    expect(six?.terms['deliver']).toBeGreaterThan(three?.terms['deliver'] ?? Infinity);
    // ⛔ The meeple sits on space 1 and is stored DENSELY at index 0, so a
    // pricer indexing `meeples` by arrival would have put it on space 0.
    expect(three?.terms['meepleGain']).toBeGreaterThan(0);
    expect(six?.terms['meepleGain'] ?? 0).toBe(0);
    expect(legalMoves(data, state)).toContainEqual(chosen);
  });
});

describe('the closing draw, answered', () => {
  it("picks a legal deck for a cornucopia crate's card", () => {
    const state = testkit.makeState(data, ['wheat', 'orchard']);
    const tile = state.island.tiles.find((t) => t.tile === 'A1')!;
    tile.crates = ['wild', 'orchard'];
    testkit.deliveredAt(state, OTHER, 'A1');
    stockBarn(state, SEAT, 'wheat', 2);
    stockBarn(state, SEAT, 'orchard', 2);
    const out = apply(data, state, {
      type: 'deliver',
      seat: SEAT,
      tile: 'A1',
      spend: { wheat: 2, orchard: 2 },
      space: 1,
    });
    const head = out.state.tasks[0];
    expect(head?.t === 'draw' && head.via).toBe('closingDraw');
    const { chosen } = explainAt(out.state, SEAT);
    expect(chosen.type === 'task' && chosen.answer.kind).toBe('deck');
    expect(legalMoves(data, out.state)).toContainEqual(chosen);
  });
});
