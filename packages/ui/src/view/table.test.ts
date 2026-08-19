/**
 * The view-side derivations. The one that matters most is `noticeBoardOf`
 * returning null: the engine's equivalent throws, which is ticket 30's crash,
 * and the interface has to render that seat rather than white-screen on it.
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';
import type { PlayerView } from '@gp/engine';

import { dealTable } from '../session/table';
import {
  displayOrder,
  farmOf,
  noticeBoardOf,
  receiptTotal,
  seatSuits,
  workerTrack,
  workersOwnedBy,
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

  it('refuses a seat that is not at the table', () => {
    expect(() => farmOf(table(), 9)).toThrow(/not at this table/);
  });
});

describe('noticeBoardOf', () => {
  it('reads the fill, the threshold and the payout off the printed face', () => {
    const view = table();
    const board = noticeBoardOf(data, farmOf(view, view.rivals[0]!.seat));
    expect(board).not.toBeNull();
    expect(board!.threshold).toBeGreaterThan(0);
    expect(board!.filled).toBe(board!.building.stack.length);
    expect(board!.payout).toBe(
      board!.building.upgraded
        ? data.rules.economy.visitPayout.upgraded
        : data.rules.economy.visitPayout.base,
    );
  });

  it("offers Special Orders' two-card line only on the upgraded face", () => {
    const view = table();
    const printed = data.rules.economy.visitPayout.twoCard;
    for (const rival of view.rivals) {
      const board = noticeBoardOf(data, farmOf(view, rival.seat));
      if (!board) continue;
      if (!board.building.upgraded) {
        // A base face never carries the line, whatever the rules say.
        expect(board.twoCard).toBeNull();
      } else {
        // An upgraded face carries exactly what the rules print, which since
        // 2026-08-13 is nothing: the new upgraded face replaced Special Orders,
        // so `twoCard` is null and the line is off everywhere.
        expect(board.twoCard).toBe(printed);
      }
    }
  });

  it('returns null, not a throw, for a seat whose board was demolished', () => {
    // Reachable today: D11 covers and D14 demolishes an empty building, and no
    // rule stops either targeting a starter. Ticket 30 is the ruling; this is
    // the interface refusing to be the thing that breaks meanwhile.
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

describe('workerTrack', () => {
  it('carries the printed action, the wage and the owner cost', () => {
    const view = table();
    for (const worker of view.fair) {
      const spec = data.workers.roster.find((w) => w.id === worker.id)!;
      const track = workerTrack(data, worker);
      expect(track.actionText).toBe(spec.actionText);
      expect(track.linkedSuit).toBe(spec.linkedSuit);
      expect(track.wage).toBe(data.workers.visitWage);
      expect(track.ownCost).toBe(data.workers.ownerActivationCost);
    }
  });

  it('gives every seat exactly one Service, and leaves the absent suits unowned', () => {
    const view = table();
    const owned = view.rivals.flatMap((r) => workersOwnedBy(view, r.seat));
    const mine = workersOwnedBy(view, view.seat);
    expect(mine).toHaveLength(1);
    // Four seats, five Services: the suit nobody chose has no Service on the
    // table at all, which is the rule that makes the menu of buyable actions
    // depend on which suits were picked.
    expect(owned.length + mine.length).toBe(4);
    expect(view.fair.filter((w) => w.owner === null)).toHaveLength(1);
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
    expect(receiptTotal([4, 8, 16])).toBe(28);
    expect(receiptTotal([])).toBe(0);
  });
});
