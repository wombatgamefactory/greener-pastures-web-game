/**
 * HANDOFF v2: THE MEEPLE AS A CARD (R15), THE PRICED SLOT (R6 amended) and the
 * cap at two (R4 amended). `docs/meeple-loop-visit-handoff-2026-09-04-v2.md`.
 *
 * Same discipline as `meeple-loop.test.ts` and for the same reason: every test
 * loads the arm through an overlay, and the last block asserts the SHIPPED game
 * from the other side. v2 must stay a paired arm, so "with the knobs off nothing
 * happened" is a claim worth failing on rather than a comment.
 *
 * ⚠️ THE ONE THING THIS FILE IS REALLY FOR is the pair of rules that are easy
 * to build slightly wrong and impossible to spot in a balance number: a meeple
 * paid for a GROW never touches the stack (so a FULL building is a legal
 * target), and a toll goes to the BOX rather than into the host's slot (so it is
 * a sink, not a loan).
 */

import { BASE_GAME_DATA, loadGameData } from '@gp/data';
import type { GameData } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { buildOptions, deliverOptions, growOptions, visitOptions } from './actions.js';
import { apply, legalMoves } from './game.js';
import { noticeBoardSlots, player } from './query.js';
import type { GameState, Seat } from './state.js';
import { buildFor, dealTo, giveMeeples, loadStack, makeState } from './testkit.js';

const WHEAT: Seat = 0;
const ORCHARD: Seat = 1;

/**
 * The handoff v2 arm as `overlays/meeple-as-card-v1.overlay.json` sets it, and
 * `meepleAsCardGoesTo` is PINNED because 'board' is the default now: Dean ruled
 * R17 in on 05/09/2026, so a meeple spent as a card lands on a neighbour's board
 * unless something says otherwise. This file's subject is R15 plus the box, and
 * that pairing is what makes the arm the control for R17 rather than dead code.
 */
const arm: GameData = loadGameData({
  name: 'meeple-as-card-v1',
  schemaVersion: 1,
  set: {
    'rules.turn.visitCurrency': 'meeple',
    'rules.turn.meepleAsCard': true,
    'rules.turn.meepleAsCardGoesTo': 'box',
    'rules.turn.slotToll': 1,
    'rules.turn.meepleCapPerColour': 2,
  },
});

/**
 * The v1 loop, which was the shipped game when this file was written and is now
 * one flag away: `overlays/meeple-loop-v1.overlay.json`. All four knobs are
 * pinned, because none of them defaults to the loop any more.
 */
const v1: GameData = loadGameData({
  name: 'meeple-loop-v1',
  schemaVersion: 1,
  set: {
    'rules.turn.visitCurrency': 'meeple',
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
  },
});

function table(data: GameData): GameState {
  const s = makeState(data, ['wheat', 'orchard']);
  s.turnPlayer = WHEAT;
  return s;
}

/** Empty the seat's supply, so a test says exactly which meeples it wants. */
function noMeeples(state: GameState, seat: Seat): void {
  const p = player(state, seat);
  for (const colour of Object.keys(p.meeples) as (keyof typeof p.meeples)[]) {
    p.meeples[colour] = 0;
  }
}

function thresholdOf(data: GameData, card: string): number {
  return data.cards.catalogue.find((c) => c.id === card)?.threshold ?? 0;
}

describe('R15 - a meeple is a card of its colour, in a BUILD', () => {
  it('pays the own-suit half of a build cost with a meeple of that colour', () => {
    const s = table(arm);
    noMeeples(s, WHEAT);
    // W4 The Wheat Field costs 1 wheat. The hand holds only the built card, so there is no card
    // payment available at all and every option here is the meeple's doing.
    dealTo(arm, s, WHEAT, 'W4');
    giveMeeples(s, WHEAT, 'wheat', 1);
    const options = buildOptions(arm, s, WHEAT).filter((o) => o.card === 'W4');
    expect(options).toHaveLength(1);
    expect(options[0]?.payment).toEqual([]);
    expect(options[0]?.meeples).toEqual({ wheat: 1 });
  });

  it('is boxed, not discarded, and leaves the supply', () => {
    const s = table(arm);
    noMeeples(s, WHEAT);
    dealTo(arm, s, WHEAT, 'W4');
    giveMeeples(s, WHEAT, 'wheat', 1);
    const move = legalMoves(arm, s).find((m) => m.type === 'build' && m.card === 'W4');
    if (move === undefined) throw new Error('the move under test was not offered');
    const before = s.discards.wheat.length;
    const after = apply(arm, s, move);
    expect(player(after.state, WHEAT).meeples.wheat).toBe(0);
    expect(after.events.some((e) => e.e === 'meepleAsCard' && e.use === 'build')).toBe(true);
    expect(after.events.some((e) => e.e === 'meepleBoxed' && e.source === 'build')).toBe(true);
    // ⭐ NOWHERE ELSE. A meeple has no card id, so it can never reach a discard
    // pile, a barn or a stack, and this is the assertion that says so.
    expect(after.state.discards.wheat.length).toBe(before);
  });

  it('spends two meeples as one card of any colour (R10) only when the cost needs it', () => {
    const s = table(arm);
    noMeeples(s, WHEAT);
    dealTo(arm, s, WHEAT, 'W4');
    // No wheat meeple, so the own-suit half can only be met by a pair.
    giveMeeples(s, WHEAT, 'orchard', 1);
    giveMeeples(s, WHEAT, 'apiary', 1);
    const options = buildOptions(arm, s, WHEAT).filter((o) => o.card === 'W4');
    expect(options).toHaveLength(1);
    expect(options[0]?.wildPairs).toBe(1);
    expect(options[0]?.meeples).toEqual({ orchard: 1, apiary: 1 });
  });

  it('spends the exact colour first: no pair while an own-colour meeple is held', () => {
    const s = table(arm);
    noMeeples(s, WHEAT);
    dealTo(arm, s, WHEAT, 'W4');
    // A wheat meeple pays the own-suit half singly, so no option may pay it with
    // two OTHER meeples instead while the wheat one is still in the supply. That
    // is the "spend the exact colour first" reduction, and it is deliberate: the
    // alternative is a real choice (you may want to keep the yellow for a door)
    // that is not worth the branching factor it costs.
    giveMeeples(s, WHEAT, 'wheat', 1);
    giveMeeples(s, WHEAT, 'orchard', 1);
    giveMeeples(s, WHEAT, 'apiary', 1);
    const options = buildOptions(arm, s, WHEAT).filter((o) => o.card === 'W4');
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => (o.wildPairs ?? 0) === 0)).toBe(true);
  });
});

describe('R15 - a meeple in a GROW, and the priced clog bypass', () => {
  it('activates a building with a meeple of the matching colour', () => {
    const s = table(arm);
    noMeeples(s, WHEAT);
    buildFor(arm, s, WHEAT, 'W4');
    giveMeeples(s, WHEAT, 'wheat', 1);
    const byMeeple = growOptions(arm, s, WHEAT).filter(
      (o) => o.building === 'W4' && o.meeples !== undefined,
    );
    expect(byMeeple).toHaveLength(1);
    expect(byMeeple[0]?.payment).toBeNull();
    expect(byMeeple[0]?.meeples).toEqual(['wheat']);
    expect(byMeeple[0]?.atThreshold).toBe(false);
  });

  it('ACTIVATES A BUILDING ALREADY AT ITS THRESHOLD, which a card can never do', () => {
    const s = table(arm);
    noMeeples(s, WHEAT);
    buildFor(arm, s, WHEAT, 'W4');
    const threshold = thresholdOf(arm, 'W4');
    expect(threshold).toBeGreaterThan(0);
    // Deal BEFORE loading: `loadStack` fills the stack off the top of the same
    // deck, so a card named after it has already gone onto the building.
    dealTo(arm, s, WHEAT, 'W5');
    loadStack(arm, s, WHEAT, 'W4', threshold);
    giveMeeples(s, WHEAT, 'wheat', 1);
    const options = growOptions(arm, s, WHEAT).filter((o) => o.building === 'W4');
    // No card option: the building is full, and a card would have to land.
    expect(options.filter((o) => o.payment !== null)).toHaveLength(0);
    const byMeeple = options.filter((o) => o.meeples !== undefined);
    expect(byMeeple).toHaveLength(1);
    expect(byMeeple[0]?.atThreshold).toBe(true);

    const stackBefore = s.players[WHEAT]?.tableau.find((b) => b.card === 'W4')?.stack.length;
    const move = legalMoves(arm, s).find(
      (m) => m.type === 'grow' && m.building === 'W4' && m.payment === null,
    );
    if (move === undefined) throw new Error('the move under test was not offered');
    const after = apply(arm, s, move);
    // The ability fired, NOTHING was added, the building is as it was.
    const stackAfter = after.state.players[WHEAT]?.tableau.find(
      (b) => b.card === 'W4',
    )?.stack.length;
    expect(stackAfter).toBe(stackBefore);
    expect(
      after.events.some(
        (e) => e.e === 'meepleAsCard' && e.use === 'activation' && e.atThreshold === true,
      ),
    ).toBe(true);
  });

  it('a full building is still NOT growable with a card', () => {
    const s = table(arm);
    buildFor(arm, s, WHEAT, 'W4');
    dealTo(arm, s, WHEAT, 'W5');
    loadStack(arm, s, WHEAT, 'W4', thresholdOf(arm, 'W4'));
    const options = growOptions(arm, s, WHEAT).filter(
      (o) => o.building === 'W4' && o.payment !== null,
    );
    expect(options).toHaveLength(0);
  });
});

describe('R15 - a meeple in an island CRATE', () => {
  it('pays what the barn is short of, and the split is barn first', () => {
    const s = table(arm);
    // The barn is empty at setup, so every payable option must be paid out of
    // the supply, and barn-first makes `meeples` the whole spend.
    for (const o of deliverOptions(arm, s, WHEAT)) {
      const total = Object.values(o.spend).reduce<number>((n, v) => n + (v ?? 0), 0);
      const fromMeeples = Object.values(o.meeples ?? {}).reduce<number>((n, v) => n + (v ?? 0), 0);
      expect(fromMeeples).toBe(total);
    }
  });

  it('offers nothing extra under v1, where a meeple is not a card', () => {
    const s = table(v1);
    expect(deliverOptions(v1, s, WHEAT)).toHaveLength(0);
  });
});

describe('R6 amended - the slot is priced, never blocked', () => {
  it('offers a visit into an occupied slot, at one extra meeple per occupant', () => {
    const s = table(arm);
    s.turn.actionSpent = true;
    // Put a meeple in the host's orchard slot, as a rival visit would.
    noticeBoardSlots(s, ORCHARD).orchard.push('orchard');
    noMeeples(s, WHEAT);
    giveMeeples(s, WHEAT, 'orchard', 1);
    // One meeple only: it can act, but it cannot also pay the toll.
    expect(visitOptions(arm, s, WHEAT).filter((v) => v.colour === 'orchard')).toHaveLength(0);
    giveMeeples(s, WHEAT, 'dairy', 1);
    const paid = visitOptions(arm, s, WHEAT).filter((v) => v.colour === 'orchard');
    expect(paid).toHaveLength(1);
    expect(paid[0]?.toll).toEqual(['dairy']);
  });

  it('THE TOLL GOES TO THE BOX, NOT INTO THE SLOT: it is a sink, not a loan', () => {
    const s = table(arm);
    s.turn.actionSpent = true;
    noticeBoardSlots(s, ORCHARD).orchard.push('orchard');
    noMeeples(s, WHEAT);
    giveMeeples(s, WHEAT, 'orchard', 1);
    giveMeeples(s, WHEAT, 'dairy', 1);
    const move = legalMoves(arm, s).find((m) => m.type === 'visit');
    if (move === undefined) throw new Error('the move under test was not offered');
    const after = apply(arm, s, move);
    // The acting meeple joined the occupant. The toll did not.
    expect(noticeBoardSlots(after.state, ORCHARD).orchard).toEqual(['orchard', 'orchard']);
    expect(player(after.state, WHEAT).meeples.dairy).toBe(0);
    expect(after.events.some((e) => e.e === 'visitToll' && e.occupants === 1)).toBe(true);
    expect(after.events.some((e) => e.e === 'meepleBoxed' && e.source === 'toll')).toBe(true);
  });

  it('under v1 the same slot is simply refused', () => {
    const s = table(v1);
    s.turn.actionSpent = true;
    noticeBoardSlots(s, ORCHARD).orchard.push('orchard');
    expect(visitOptions(v1, s, WHEAT).filter((v) => v.colour === 'orchard')).toHaveLength(0);
  });
});

describe('the v1 loop - with the knobs off, nothing of v2 exists', () => {
  it('offers no meeple payment for a build under v1', () => {
    const s = table(v1);
    noMeeples(s, WHEAT);
    dealTo(v1, s, WHEAT, 'W4');
    giveMeeples(s, WHEAT, 'wheat', 1);
    expect(buildOptions(v1, s, WHEAT).filter((o) => o.card === 'W4')).toHaveLength(0);
  });

  it('offers no meeple payment for a GROW under v1, full or not', () => {
    const s = table(v1);
    noMeeples(s, WHEAT);
    buildFor(v1, s, WHEAT, 'W4');
    giveMeeples(s, WHEAT, 'wheat', 1);
    expect(growOptions(v1, s, WHEAT).every((o) => o.meeples === undefined)).toBe(true);
  });

  /**
   * ⭐ THE DEFAULTS MOVED ON 05/09/2026, when Dean ruled R17 in, and this case is
   * the tripwire on that: the shipped game is now R15 plus R17 - a meeple pays,
   * and it lands on a NEIGHBOUR'S BOARD - with a priced slot and a cap of two.
   * If any of these four ever reads the other way again it is a flip nobody
   * meant, and every arm in `overlays/` is measuring a different game than its
   * description claims.
   */
  it('names the four knobs at their shipped defaults, and the v1 loop as one flag away', () => {
    expect(BASE_GAME_DATA.rules.turn.meepleAsCard).toBe(true);
    expect(BASE_GAME_DATA.rules.turn.meepleAsCardGoesTo).toBe('board');
    expect(BASE_GAME_DATA.rules.turn.slotToll).toBe(1);
    expect(BASE_GAME_DATA.rules.turn.meepleCapPerColour).toBe(2);

    expect(v1.rules.turn.meepleAsCard).toBe(false);
    expect(v1.rules.turn.slotToll).toBeNull();
    expect(v1.rules.turn.meepleCapPerColour).toBe(1);
  });
});
