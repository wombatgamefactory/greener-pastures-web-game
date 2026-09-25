/**
 * T4b (24/09/2026): the Deliver primitive's two new, OFF-BY-DEFAULT payment
 * sources - see the module comment on `actions/deliver.ts` for the design.
 * No handler calls either yet (two later tasks wire A8 The Wild Hive and O12
 * The Fruit Press); this file tests the primitive alone, straight off
 * `deliverOptions`/`anyDeliverOption`/`doDeliver`, the same way
 * `token-island.test.ts` tests V14's `takeAll` before any card used it.
 *
 * `tasks/v48-rulings-v2.md` R4, R8 (A8); the builder-defaults paragraph and
 * the O12 rows of `tasks/v48-ambiguity-audit-v1.md` (Q3).
 *
 * Testkit island for these seats (`makeState(data, ['wheat', 'orchard'])`):
 * A1 holds two WHEAT tokens (6 VP, 5 VP), so a first delivery there is
 * `{ wheat: 4 }` with no "any" filler - the same fixture `token-island.test.ts`
 * uses, chosen again here because a wheat-only, non-wild demand is exactly
 * what proves a hand card of a DIFFERENT crop can never fill it (O12's "as
 * its own crop, never wild").
 */

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA as data } from '@gp/data';

import { anyDeliverOption, deliverOptions, doDeliver } from '../actions.js';
import { Fx } from '../fx.js';
import type { CardId, GameEvent, GameState, Seat } from '../state.js';
import { buildFor, dealTo, giveMeeples, loadStack, makeState } from '../testkit.js';

const SEAT: Seat = 0;
const RIVAL: Seat = 1;

/** Move ids from a deck straight into a barn (testkit-style surgery). */
function stockBarn(state: GameState, seat: Seat, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks.wheat.shift();
    if (!id) throw new Error('wheat deck ran dry');
    state.players[seat]?.barn.push(id);
  }
}

/** This seat's own Notice Board - wherever it landed in the tableau. */
function boardOf(state: GameState, seat: Seat): CardId {
  const suit = state.players[seat]?.suit;
  const board = state.players[seat]?.tableau.find((b) => {
    const printed = data.cards.catalogue.find((c) => c.id === b.card);
    return printed?.slot === 'noticeboard' && printed.suit === suit;
  });
  if (!board) throw new Error(`Seat ${seat} has no Notice Board`);
  return board.card;
}

function harvestEvents(fx: Fx): GameEvent[] {
  return fx.events.filter((e) => e.e === 'harvested');
}

/** The top id of a deck, without removing it - `dealTo` does the removal. */
function topOf(deck: CardId[]): CardId {
  const [id] = deck;
  if (id === undefined) throw new Error('deck ran dry');
  return id;
}

describe('fromFullBuildings and handCard OFF: nothing about a plain delivery moves', () => {
  it('deliverOptions and anyDeliverOption read exactly as before the new params existed', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 4);
    const bare = deliverOptions(data, s, SEAT);
    const explicit = deliverOptions(data, s, SEAT, Infinity, 0, false, false);
    expect(explicit).toEqual(bare);
    expect(bare.some((o) => o.tile === 'A1')).toBe(true);
    expect(bare.every((o) => o.handCrop === undefined)).toBe(true);
    expect(anyDeliverOption(data, s, SEAT)).toBe(true);
    expect(anyDeliverOption(data, s, SEAT, 0, false, false)).toBe(true);
  });

  it('a barn three short of the demand, with nothing else on, cannot deliver', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 3);
    expect(deliverOptions(data, s, SEAT).some((o) => o.tile === 'A1')).toBe(false);
    expect(anyDeliverOption(data, s, SEAT)).toBe(false);
  });
});

describe('A8 The Wild Hive: fromFullBuildings', () => {
  it('pays with a full Notice Board stack, and takes the whole stack in one go', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    const board = boardOf(s, SEAT); // W3, threshold 3, "3+" never blocks
    loadStack(data, s, SEAT, board, 4); // a clogged board: 4 on a threshold of 3
    expect(s.players[SEAT]!.barn).toHaveLength(0);

    const withBuildings = deliverOptions(data, s, SEAT, Infinity, 0, true);
    const option = withBuildings.find((o) => o.tile === 'A1');
    expect(option).toBeDefined();
    expect(option!.spend).toEqual({ wheat: 4 });
    expect(anyDeliverOption(data, s, SEAT, 0, true)).toBe(true);

    // Without the option the same tile is unreachable - the barn is empty.
    expect(deliverOptions(data, s, SEAT).some((o) => o.tile === 'A1')).toBe(false);
    expect(anyDeliverOption(data, s, SEAT)).toBe(false);

    const fx = new Fx(data, s, SEAT);
    doDeliver(
      fx,
      SEAT,
      'A1',
      { wheat: 4 },
      {
        buildingSpend: [{ building: board, spend: { wheat: 4 } }],
      },
    );

    expect(s.players[SEAT]!.receipts).toHaveLength(1);
    expect(s.players[SEAT]!.barn).toHaveLength(0);
    const b = s.players[SEAT]!.tableau.find((x) => x.card === board);
    expect(b!.stack).toHaveLength(0); // the whole stack left, not one card
    expect(s.discards.wheat).toHaveLength(4);
    // Taking cards off a building this way is NOT a Harvest: no When-Harvested
    // hook, no harvested event, and (since the discard destination is card
    // conservation's own proof) the cards never touched the barn either.
    expect(harvestEvents(fx)).toEqual([]);
  });

  it('a building below its threshold is not full and may not pay', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    const board = boardOf(s, SEAT);
    loadStack(data, s, SEAT, board, 2); // one short of the Notice Board's 3
    stockBarn(s, SEAT, 2);

    expect(deliverOptions(data, s, SEAT, Infinity, 0, true).some((o) => o.tile === 'A1')).toBe(
      false,
    );

    const fx = new Fx(data, s, SEAT);
    expect(() =>
      doDeliver(
        fx,
        SEAT,
        'A1',
        { wheat: 4 },
        {
          buildingSpend: [{ building: board, spend: { wheat: 2 } }],
        },
      ),
    ).toThrow(/not full/);
  });

  it('the same Notice Board pays at 3 but not at 2 (R4)', () => {
    // A barn of 1 in every branch: enough to reach `deliveryCost` (4) only
    // when the board's own 3 joins it - the board's stack, not the barn, is
    // what this test is about.
    const at3 = makeState(data, ['wheat', 'orchard']);
    const board3 = boardOf(at3, SEAT);
    loadStack(data, at3, SEAT, board3, 3);
    stockBarn(at3, SEAT, 1);
    expect(deliverOptions(data, at3, SEAT, Infinity, 0, true).some((o) => o.tile === 'A1')).toBe(
      true,
    );

    const at2 = makeState(data, ['wheat', 'orchard']);
    const board2 = boardOf(at2, SEAT);
    loadStack(data, at2, SEAT, board2, 2);
    stockBarn(at2, SEAT, 1);
    expect(deliverOptions(data, at2, SEAT, Infinity, 0, true).some((o) => o.tile === 'A1')).toBe(
      false,
    );
  });

  it('a non-Notice-Board building pays once full, exactly at its own printed threshold', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    buildFor(data, s, SEAT, 'W4'); // Wheat Field, threshold 2
    loadStack(data, s, SEAT, 'W4', 2, 'wheat');
    stockBarn(s, SEAT, 2);

    const option = deliverOptions(data, s, SEAT, Infinity, 0, true).find((o) => o.tile === 'A1');
    expect(option).toBeDefined();
    expect(option!.spend).toEqual({ wheat: 4 });

    const fx = new Fx(data, s, SEAT);
    doDeliver(
      fx,
      SEAT,
      'A1',
      { wheat: 4 },
      {
        buildingSpend: [{ building: 'W4', spend: { wheat: 2 } }],
      },
    );
    expect(s.players[SEAT]!.tableau.find((x) => x.card === 'W4')!.stack).toHaveLength(0);
    expect(s.players[SEAT]!.barn).toHaveLength(0);
    expect(harvestEvents(fx)).toEqual([]);
  });

  it('never a rival building, even one that is full', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    const rivalBoard = boardOf(s, RIVAL);
    loadStack(data, s, RIVAL, rivalBoard, 3);
    stockBarn(s, SEAT, 4);

    // The acting seat's own tally never sees a rival's building at all.
    const bare = deliverOptions(data, s, SEAT, Infinity, 0, false);
    const withBuildings = deliverOptions(data, s, SEAT, Infinity, 0, true);
    expect(withBuildings).toEqual(bare);

    const fx = new Fx(data, s, SEAT);
    expect(() =>
      doDeliver(
        fx,
        SEAT,
        'A1',
        { wheat: 4 },
        {
          buildingSpend: [{ building: rivalBoard, spend: { wheat: 1 } }],
        },
      ),
    ).toThrow(/not one of seat 0's buildings/);
  });

  it('mixes the barn and a full building freely, and the building only loses what it is told to', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    const board = boardOf(s, SEAT);
    loadStack(data, s, SEAT, board, 3);
    stockBarn(s, SEAT, 2);

    const fx = new Fx(data, s, SEAT);
    doDeliver(
      fx,
      SEAT,
      'A1',
      { wheat: 4 },
      {
        buildingSpend: [{ building: board, spend: { wheat: 2 } }],
      },
    );
    // 2 off the board, 2 out of the barn.
    const b = s.players[SEAT]!.tableau.find((x) => x.card === board);
    expect(b!.stack).toHaveLength(1); // 3 loaded, 2 taken
    expect(s.players[SEAT]!.barn).toHaveLength(0); // 2 loaded, 2 spent
    expect(harvestEvents(fx)).toEqual([]);
  });

  it(
    'a barn short by exactly the building share still pays, even with a meeple of that ' +
      "colour sitting in the seat's supply and R15 (meepleAsCard) shipped OFF " +
      '(regression, T4b crash `gp-bug-2026-09-24T14-3*`: `meepleShare` used to be asked ' +
      "about the FULL spend rather than the barn's own share, so it saw the building's " +
      'share as a barn shortfall and wrongly reached for the meeple supply, throwing ' +
      '"A meeple pays an island delivery only under rules.turn.meepleAsCard" even though ' +
      'no meeple was ever meant to pay anything)',
    () => {
      const s = makeState(data, ['wheat', 'orchard']);
      const board = boardOf(s, SEAT);
      loadStack(data, s, SEAT, board, 3); // the building covers 3 of the 4
      stockBarn(s, SEAT, 1); // the barn covers only the last 1 - no shortfall
      // Big enough to cover the OLD (buggy) shortfall reading too - which
      // asked the supply to cover the building's whole 3 cards, not the 0 the
      // barn is actually short by - so this test would fail to reproduce the
      // bug pre-fix with a supply of only 1 or 2.
      giveMeeples(s, SEAT, 'wheat', 3); // present, and must be left untouched
      expect(data.rules.turn.meepleAsCard).toBe(false); // the shipped default

      const fx = new Fx(data, s, SEAT);
      expect(() =>
        doDeliver(
          fx,
          SEAT,
          'A1',
          { wheat: 4 },
          { buildingSpend: [{ building: board, spend: { wheat: 3 } }] },
        ),
      ).not.toThrow();

      expect(s.players[SEAT]!.receipts).toHaveLength(1);
      expect(s.players[SEAT]!.barn).toHaveLength(0);
      expect(s.players[SEAT]!.meeples.wheat).toBe(3); // untouched, not spent
    },
  );

  it('rejects a buildingSpend that claims more of a crop than the delivery spends', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    const board = boardOf(s, SEAT);
    loadStack(data, s, SEAT, board, 5); // physically enough to take 5

    const fx = new Fx(data, s, SEAT);
    expect(() =>
      // The delivery itself only spends 4, so a buildingSpend of 5 - legal to
      // take off the board on its own - claims more than `spend` accounts for.
      doDeliver(
        fx,
        SEAT,
        'A1',
        { wheat: 4 },
        {
          buildingSpend: [{ building: board, spend: { wheat: 5 } }],
        },
      ),
    ).toThrow(/claims more wheat cards/);
  });
});

describe('O12 The Fruit Press: handCard', () => {
  it('one hand card of the crop bridges a one-card barn shortfall', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 3); // one short of A1's wheat:4
    const handCard = topOf(s.decks.wheat);
    dealTo(data, s, SEAT, handCard);

    const off = deliverOptions(data, s, SEAT);
    expect(off.some((o) => o.tile === 'A1')).toBe(false);
    expect(anyDeliverOption(data, s, SEAT)).toBe(false);

    const on = deliverOptions(data, s, SEAT, Infinity, 0, false, true);
    const option = on.find((o) => o.tile === 'A1');
    expect(option).toBeDefined();
    expect(option!.spend).toEqual({ wheat: 4 });
    expect(option!.handCrop).toBe('wheat');
    expect(anyDeliverOption(data, s, SEAT, 0, false, true)).toBe(true);

    const fx = new Fx(data, s, SEAT);
    doDeliver(fx, SEAT, 'A1', { wheat: 4 }, { handCard });
    expect(s.players[SEAT]!.hand).toEqual([]);
    expect(s.players[SEAT]!.barn).toHaveLength(0);
    expect(s.discards.wheat).toContain(handCard);
    expect(s.players[SEAT]!.receipts).toHaveLength(1);
  });

  it('never wild: a hand card of the wrong crop cannot pay a wheat-only demand', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 3);
    const handCard = topOf(s.decks.dairy);
    dealTo(data, s, SEAT, handCard);

    const on = deliverOptions(data, s, SEAT, Infinity, 0, false, true);
    expect(on.some((o) => o.tile === 'A1')).toBe(false);
    expect(anyDeliverOption(data, s, SEAT, 0, false, true)).toBe(false);

    const fx = new Fx(data, s, SEAT);
    expect(() => doDeliver(fx, SEAT, 'A1', { wheat: 4 }, { handCard })).toThrow();
  });

  it('never two: a two-card shortfall stays unpayable with one hand card allowed', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 2); // two short of A1's wheat:4
    const a = topOf(s.decks.wheat);
    const b = topOf(s.decks.wheat.slice(1));
    dealTo(data, s, SEAT, a, b);

    expect(
      deliverOptions(data, s, SEAT, Infinity, 0, false, true).some((o) => o.tile === 'A1'),
    ).toBe(false);
    expect(anyDeliverOption(data, s, SEAT, 0, false, true)).toBe(false);
  });

  it(
    "a barn short by exactly the hand card's crop still pays, even with a meeple of that " +
      'colour sitting in supply and R15 (meepleAsCard) shipped OFF (regression, T4b crash ' +
      '`gp-bug-2026-09-24T14-3*`, same cause as the A8 case above: `meepleShare` saw the ' +
      "hand card's share as a barn shortfall and reached for the meeple supply)",
    () => {
      const s = makeState(data, ['wheat', 'orchard']);
      stockBarn(s, SEAT, 3); // one short of A1's wheat:4 - the hand card bridges it
      const handCard = topOf(s.decks.wheat);
      dealTo(data, s, SEAT, handCard);
      giveMeeples(s, SEAT, 'wheat', 1); // present, and must be left untouched
      expect(data.rules.turn.meepleAsCard).toBe(false); // the shipped default

      const fx = new Fx(data, s, SEAT);
      expect(() => doDeliver(fx, SEAT, 'A1', { wheat: 4 }, { handCard })).not.toThrow();

      expect(s.players[SEAT]!.receipts).toHaveLength(1);
      expect(s.players[SEAT]!.barn).toHaveLength(0);
      expect(s.players[SEAT]!.meeples.wheat).toBe(1); // untouched, not spent
    },
  );

  it('rejects a handCard whose crop the delivery does not need at all', () => {
    // `DeliverChoice.handCard` only ever takes ONE id, so a delivery cannot
    // even ASK for a second one - "never two" is enforced at the type level
    // for the literal id, and at this check for a claim `spend` cannot cover:
    // the same claim-versus-spend guard `buildingSpend` uses above.
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 4); // barn alone already pays A1's { wheat: 4 }
    const handCard = topOf(s.decks.dairy);
    dealTo(data, s, SEAT, handCard);

    const fx = new Fx(data, s, SEAT);
    expect(() => doDeliver(fx, SEAT, 'A1', { wheat: 4 }, { handCard })).toThrow(
      /claims more dairy cards/,
    );
  });
});

describe('A8 and O12 together: still additive, not multiplicative, when both are off', () => {
  it('deliverOptions with every new param at its default equals the two-argument call', () => {
    const s = makeState(data, ['wheat', 'orchard']);
    stockBarn(s, SEAT, 4);
    expect(deliverOptions(data, s, SEAT, Infinity, 0, false, false)).toEqual(
      deliverOptions(data, s, SEAT),
    );
  });
});
