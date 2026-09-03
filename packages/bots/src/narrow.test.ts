/**
 * THE GUARD ON THE OPTION COLLAPSE.
 *
 * Two things are asserted here and only one of them is about this file's own
 * arithmetic. The other is a tripwire: the collapse is safe only while "a spent
 * card is lost" holds, so the moment a new card reaches into a build payment
 * this test fails and somebody has to decide which side of the line it falls
 * on. A silent mis-pricing of Dairy is exactly the failure the collapse could
 * produce and exactly the one nobody would see.
 */

import { describe, expect, it } from 'vitest';

import { loadGameData } from '@gp/data';
import { handlerFor, newGame, registeredCards, viewFor } from '@gp/engine';
import type { CardId, Move, PlayerView } from '@gp/engine';

import { cardValue } from './junk.js';
import {
  IGNORES_BUILD_PAYMENT,
  KEEPS_SPENT_CARDS,
  READS_BUILD_PAYMENT,
  narrowMoves,
} from './narrow.js';

const data = loadGameData();

/** Every registered card whose handler listens to `afterBuild`. */
function afterBuildCards(): CardId[] {
  const out: CardId[] = [];
  for (const id of registeredCards()) {
    const on = handlerFor(id)?.on;
    if (on && 'afterBuild' in on) out.push(id);
  }
  return out.sort();
}

describe('the classification tripwire', () => {
  it('every afterBuild listener is classified, so a new one cannot slip in unread', () => {
    const classified = [...READS_BUILD_PAYMENT, ...IGNORES_BUILD_PAYMENT].sort();
    expect(afterBuildCards()).toEqual(classified);
  });

  it('the keep set is a subset of the cards that read a payment at all', () => {
    for (const id of KEEPS_SPENT_CARDS) expect(READS_BUILD_PAYMENT).toContain(id);
  });

  it('D6 The Trading Shed reads a payment but does NOT keep it: it gives it away', () => {
    expect(READS_BUILD_PAYMENT).toContain('D6');
    expect(KEEPS_SPENT_CARDS).not.toContain('D6');
  });
});

// --- the collapse itself ----------------------------------------------------

function emptyView(): PlayerView {
  const state = newGame(data, { seats: 2, suits: ['wheat', 'vegetable'], seed: 'narrow' });
  return viewFor(data, state, 0);
}

function build(card: CardId, payment: CardId[]): Move {
  return { type: 'build', seat: 0, card, payment };
}

function totalValue(ids: readonly CardId[]): number {
  return ids.reduce((sum, id) => sum + cardValue(data, id), 0);
}

describe('narrowMoves', () => {
  it('leaves a position with nothing collapsible exactly as it found it', () => {
    const moves: Move[] = [
      { type: 'draw', seat: 0 },
      { type: 'endTurn', seat: 0 },
    ];
    expect(narrowMoves(data, emptyView(), moves)).toBe(moves);
  });

  it('keeps one payment per crop multiset, and it is the junkiest', () => {
    // W1..W3 are all wheat, so all three single-card payments are one class.
    const moves = [build('W12', ['W1']), build('W12', ['W2']), build('W12', ['W3'])];
    const kept = narrowMoves(data, emptyView(), moves);
    expect(kept).toHaveLength(1);
    const junkiest = moves.reduce((a, b) =>
      totalValue((a as { payment: CardId[] }).payment) <=
      totalValue((b as { payment: CardId[] }).payment)
        ? a
        : b,
    );
    expect(kept[0]).toBe(junkiest);
  });

  it('keeps DIFFERENT crop multisets apart: a wheat payment is not a vegetable one', () => {
    const moves = [build('W12', ['W1']), build('W12', ['V1']), build('W12', ['W2'])];
    const kept = narrowMoves(data, emptyView(), moves);
    expect(kept).toHaveLength(2);
    const crops = kept.map((m) => (m as { payment: CardId[] }).payment[0]?.charAt(0));
    expect(new Set(crops)).toEqual(new Set(['W', 'V']));
  });

  it('keeps builds of different cards apart', () => {
    const moves = [build('W12', ['W1']), build('W13', ['W1'])];
    expect(narrowMoves(data, emptyView(), moves)).toHaveLength(2);
  });

  it('preserves the engine order of what it keeps', () => {
    const moves = [build('W13', ['W2']), build('W12', ['W1']), build('W12', ['W2'])];
    const kept = narrowMoves(data, emptyView(), moves);
    expect(kept[0]).toBe(moves[0]);
  });

  it('collapses the overflow discard the same way', () => {
    const moves: Move[] = [
      { type: 'task', seat: 0, answer: { kind: 'discard', cards: ['W1', 'W2'] } },
      { type: 'task', seat: 0, answer: { kind: 'discard', cards: ['W1', 'W3'] } },
      { type: 'task', seat: 0, answer: { kind: 'discard', cards: ['W1', 'V1'] } },
    ];
    const kept = narrowMoves(data, emptyView(), moves);
    // Two wheat-wheat sets collapse to one; wheat-vegetable is its own class.
    expect(kept).toHaveLength(2);
  });

  it('keeps the D7 stack selection out of the collapse: which building loses cards is a real choice', () => {
    const moves: Move[] = [
      {
        type: 'task',
        seat: 0,
        answer: { kind: 'build', card: 'W12', payment: [], stacks: ['W5'] },
      },
      {
        type: 'task',
        seat: 0,
        answer: { kind: 'build', card: 'W12', payment: [], stacks: ['W6'] },
      },
    ];
    expect(narrowMoves(data, emptyView(), moves)).toHaveLength(2);
  });

  it('offers the BEST payment as well as the junkiest when a divert power is live', () => {
    const view = emptyView();
    // O17 The Fruit Basket puts a card you spend into your barn, so the junkiest
    // is no longer obviously right and both ends of the class must survive.
    const withBasket: PlayerView = {
      ...view,
      you: {
        ...view.you,
        tableau: [
          ...view.you.tableau,
          { card: 'O17' as CardId, stack: [], full: false, face: 'base' } as never,
        ],
      },
    };
    const moves = [build('W12', ['W1']), build('W12', ['W2']), build('W12', ['W3'])];
    const kept = narrowMoves(data, withBasket, moves);
    expect(kept).toHaveLength(2);
    const values = kept.map((m) => totalValue((m as { payment: CardId[] }).payment));
    const all = moves.map((m) => totalValue((m as { payment: CardId[] }).payment));
    expect(Math.min(...values)).toBe(Math.min(...all));
    expect(Math.max(...values)).toBe(Math.max(...all));
  });
});
