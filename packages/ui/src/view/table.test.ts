/**
 * The view-side derivations. The one that matters most is `noticeBoardOf`
 * returning null: the engine's equivalent throws, which is ticket 30's crash,
 * and the interface has to render that seat rather than white-screen on it.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';
import type { Suit } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { thresholdOf } from '@gp/engine';

import { dealTable } from '../session/table';
import { printedFace } from './printed';
import {
  allDoors,
  displayOrder,
  doorOf,
  doorOwner,
  farmOf,
  liveThreshold,
  meepleCount,
  meepleTally,
  noticeBoardOf,
  receiptTotal,
  seatSuits,
} from './table';

function table(): PlayerView {
  return dealTable({
    seats: 4,
    suits: ['wheat', 'vegetable', 'orchard', 'apiary'],
    seed: 'view-tests',
    depth: 160,
    minHand: 3,
  }).view;
}

describe('farmOf', () => {
  it('gives your own seat and a rival the same shape', () => {
    const view = table();
    const mine = farmOf(view, view.seat);
    const theirs = farmOf(view, view.rivals[0]!.seat);
    expect(Object.keys(mine).sort()).toEqual(Object.keys(theirs).sort());
    expect(mine.suit).toBe(view.you.suit);
  });

  it('counts your own barn from the suit tally, which is all the view has', () => {
    const view = table();
    const expected = Object.values(view.you.barn).reduce((a, b) => a + (b ?? 0), 0);
    expect(farmOf(view, view.seat).barnCount).toBe(expected);
  });

  /**
   * ⭐ MEEPLES REPLACED COINS ON THIS SHAPE (v31), and the two are not
   * interchangeable: a coin was one fungible number, a supply is five discrete
   * colours each worth one specific action. Every colour is a key, including the
   * ones a seat holds none of and the ones nobody at the table farms - a meeple
   * of a suit that is not in play still works.
   */
  it('carries a meeple count for all five colours, on every seat', () => {
    const view = table();
    for (const seat of [view.seat, ...view.rivals.map((r) => r.seat)]) {
      const farm = farmOf(view, seat);
      expect(Object.keys(farm.meeples).sort()).toEqual([...data.cards.suits].sort() as string[]);
      for (const n of Object.values(farm.meeples)) expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses a seat that is not at the table', () => {
    expect(() => farmOf(table(), 9)).toThrow(/not at this table/);
  });
});

describe('meepleTally', () => {
  it('drops the empty colours and sums to the count', () => {
    const held: Record<Suit, number> = {
      wheat: 2,
      vegetable: 0,
      orchard: 1,
      apiary: 0,
      dairy: 0,
    };
    expect(meepleTally(held)).toEqual([
      ['wheat', 2],
      ['orchard', 1],
    ]);
    expect(meepleCount(held)).toBe(3);
  });

  it('is empty rather than five zeroes for a seat holding none', () => {
    const none: Record<Suit, number> = {
      wheat: 0,
      vegetable: 0,
      orchard: 0,
      apiary: 0,
      dairy: 0,
    };
    expect(meepleTally(none)).toEqual([]);
    expect(meepleCount(none)).toBe(0);
  });
});

describe('noticeBoardOf', () => {
  /**
   * ⭐ WHAT A VISIT BUYS CHANGED, SO WHAT THIS SHAPE CARRIES CHANGED. There is no
   * payout and no two-card line: a card on a board buys that farm's suit action
   * and nothing else, so the board's only payoff field is the door.
   */
  it('reads the fill, the threshold and the DOOR the board grants', () => {
    const view = table();
    for (const rival of view.rivals) {
      const farm = farmOf(view, rival.seat);
      const board = noticeBoardOf(data, farm);
      expect(board).not.toBeNull();
      expect(board!.threshold).toBeGreaterThan(0);
      expect(board!.filled).toBe(board!.building.stack.length);
      // The door is the HOST's suit's, never the visitor's.
      expect(board!.action).toBe(doorOf(data, farm.suit).action);
      expect(board!.actionText).toBe(doorOf(data, farm.suit).actionText);
    }
  });

  it('returns null, not a throw, for a seat whose board was demolished', () => {
    // Reachable today: D14 demolishes an empty building, and no rule stops it
    // targeting a starter. Ticket 30 is the ruling; this is the interface
    // refusing to be the thing that breaks meanwhile.
    const view = table();
    const farm = farmOf(view, view.rivals[0]!.seat);
    const without = {
      ...farm,
      tableau: farm.tableau.filter(
        (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot !== 'noticeboard',
      ),
    };
    expect(noticeBoardOf(data, without)).toBeNull();
  });
});

describe('the five doors', () => {
  it('names one door per colour, with the roster action and text', () => {
    const doors = allDoors(data);
    expect(doors).toHaveLength(5);
    for (const door of doors) {
      const spec = data.workers.roster.find((w) => w.linkedSuit === door.colour)!;
      expect(door.action).toBe(spec.action);
      expect(door.actionText).toBe(spec.actionText);
      expect(door.actionLabel.length).toBeGreaterThan(0);
    }
    // Every colour, exactly once - which is what makes the legend a meeple key.
    expect(doors.map((d) => d.colour).sort()).toEqual([...data.cards.suits].sort());
  });

  /**
   * ⚠️ A COLOUR NOBODY FARMS STILL HAS A DOOR, and the legend must show it. At 2
   * and 3 seats several suits are off the table, but a MEEPLE of those colours
   * is dealt from the same 25-strong bag and works exactly the same - so
   * `doorOwner` returning null is a real answer the legend renders, not an error.
   */
  it('owns a door per seat, and leaves the absent colours unowned', () => {
    const view = table();
    const owners = allDoors(data).map((d) => doorOwner(view, d.colour));
    expect(owners.filter((o) => o !== null)).toHaveLength(view.seats);
    expect(owners.filter((o) => o === null)).toHaveLength(5 - view.seats);
    for (const rival of view.rivals) {
      expect(doorOwner(view, rival.suit)).toBe(rival.seat);
    }
    expect(doorOwner(view, view.you.suit)).toBe(view.seat);
  });
});

describe('displayOrder', () => {
  it('puts the three starters first, in printed order', () => {
    const view = table();
    const ordered = displayOrder(data, view.you.tableau);
    const slots = ordered.map(
      (b) => data.cards.catalogue.find((c) => c.id === b.card)?.slot ?? null,
    );
    expect(slots.slice(0, 3)).toEqual(['farmstead', 'barn', 'noticeboard']);
    expect(ordered).toHaveLength(view.you.tableau.length);
  });
});

describe('seatSuits and receiptTotal', () => {
  it('indexes every seat at the table by its seat number', () => {
    const view = table();
    const suits = seatSuits(view);
    expect(suits[view.seat]).toBe(view.you.suit);
    for (const rival of view.rivals) expect(suits[rival.seat]).toBe(rival.suit);
    expect(suits.filter(Boolean)).toHaveLength(view.seats);
  });

  it('sums receipts', () => {
    expect(receiptTotal([6, 3, 6])).toBe(15);
    expect(receiptTotal([])).toBe(0);
  });
});

/**
 * The threshold seam. This pins the property that was broken until 26/08/2026:
 * the interface may lag the SHEET, but it may never contradict the ENGINE about
 * whether a move is legal.
 *
 * Deliberately asserted against the engine's own `thresholdOf` rather than
 * against a literal. The v31 sheet prints 2 and the knob is 2, so the two agree
 * today and the seam is currently the identity - but the knob is a named sweep
 * arm (threshold 2 versus 3), and a test hard-coding either number would fail
 * for the wrong reason the moment an overlay moved it.
 */
describe('liveThreshold', () => {
  it('agrees with the engine on every building on the table', () => {
    const view = table();
    for (const seat of [view.seat, ...view.rivals.map((r) => r.seat)]) {
      for (const b of farmOf(view, seat).tableau) {
        const printed = printedFace(data, b.card).threshold;
        expect(liveThreshold(data, b.card, printed)).toBe(
          thresholdOf(data, { card: b.card, stack: b.stack }),
        );
      }
    }
  });

  it('leaves a card with no threshold alone', () => {
    expect(liveThreshold(data, 'W1', null)).toBeNull();
  });

  it('overrides the Notice Board and nothing else', () => {
    const override = data.rules.economy.noticeBoardThreshold;
    const boards = data.cards.catalogue.filter((c) => c.slot === 'noticeboard');
    expect(boards.length).toBeGreaterThan(0);
    for (const card of boards) {
      expect(liveThreshold(data, card.id, 99)).toBe(override ?? 99);
    }
    for (const card of data.cards.catalogue.filter((c) => c.slot !== 'noticeboard')) {
      expect(liveThreshold(data, card.id, 99)).toBe(99);
    }
  });

  it('is what the rail reports, so the fill bar cannot promise a blocked visit', () => {
    const view = table();
    for (const rival of view.rivals) {
      const board = noticeBoardOf(data, farmOf(view, rival.seat));
      if (board === null) continue;
      expect(board.threshold).toBe(
        thresholdOf(data, { card: board.building.card, stack: board.building.stack }),
      );
      expect(board.full).toBe(board.filled >= board.threshold);
    }
  });
});
