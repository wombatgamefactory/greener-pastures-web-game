/**
 * THE MEEPLE-LOOP ARM (`rules.turn.visitCurrency: 'meeple'`), Dean 04/09/2026,
 * docs/meeple-loop-visit-handoff-2026-09-04-v1.md.
 *
 * Every test here loads the arm through an overlay and never through the base
 * data, which is the point of the file: the shipped `'card'` game is the CONTROL
 * and has to stay bit-reproducible, so the arm's rules are proved somewhere that
 * cannot accidentally assert them of the default. The last block asserts the
 * control from the other side - the arm's fields simply are not there under the
 * default - because "the knob is off" is a claim worth failing on.
 *
 * The rule ids (R1-R14, X1-X6) are the handoff's, and the ledger's when this is
 * ruled in.
 */

import { BASE_GAME_DATA, loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { collectOpen, meepleOptions, visitOptions } from './actions.js';
import { apply, isOver, legalMoves, newGame } from './game.js';
import { seedRng, rngInt } from './rng.js';
import { noticeBoardSlots, player } from './query.js';
import type { GameState, Move, Seat } from './state.js';
import { freshTurn } from './setup.js';
import { buildFor, dealTo, makeState } from './testkit.js';

const WHEAT: Seat = 0;
const ORCHARD: Seat = 1;

/**
 * The v1 loop, as `overlays/meeple-loop-v1.overlay.json` sets it.
 *
 * ⚠️ IT STOPPED BEING THE SHIPPED GAME ON 05/09/2026, when Dean ruled the meeple
 * ECONOMY in: a meeple now PAYS wherever a card of its colour would and lands on
 * a neighbour's board (R15 and R17), a slot is PRICED rather than blocked, and
 * the cap is two. So this file is about the loop as it was ruled on 04/09/2026,
 * and all four knobs are pinned - one of them, `visitCurrency`, is still the
 * default and the other three are not. What the file tests is unchanged and
 * still load-bearing: the visit, the collect, the cap and the board that is not
 * a building are the layer R15 and R17 were built ON TOP of.
 */
const arm: GameData = loadGameData({
  name: 'meeple-loop-v1',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'meeple',
    'rules.turn.selfVisitAllowed': true, // pinned 13/09/2026: the default flipped
    'rules.economy.noticeBoardsBySeats.2': 1, // pinned 13/09/2026: the default flipped
    // ⚠️ PINNED WITH THE COMMONS (09/09/2026). The shipped turn takes its bonus
    // FIRST (C2) and deals no starting meeples (C6), and neither arm is that
    // game: an unpinned leaf is how a control silently stops being the thing it
    // is named after.
    'rules.turn.bonusTiming': 'end',
    'rules.turn.startingMeeplesPerColour': 1,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

/** The v31 card-fee game, as `overlays/v31-card-visit.overlay.json` sets it. */
const control: GameData = loadGameData({
  name: 'v31-card-visit',
  schemaVersion: 1,
  set: {
    'rules.economy.cropScorerOnBarn': false,
    // Pre-flip pins (12/09/2026): this is a named inline copy of a
    // committed overlay, and a copy of a pin stops being a pin.
    'rules.turn.visitCurrency': 'card',
    'rules.turn.selfVisitAllowed': true, // pinned 13/09/2026: the default flipped
    'rules.economy.noticeBoardsBySeats.2': 1, // pinned 13/09/2026: the default flipped
    // ⚠️ PINNED WITH THE COMMONS (09/09/2026). The shipped turn takes its bonus
    // FIRST (C2) and deals no starting meeples (C6), and neither arm is that
    // game: an unpinned leaf is how a control silently stops being the thing it
    // is named after.
    'rules.turn.bonusTiming': 'end',
    'rules.turn.startingMeeplesPerColour': 1,
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
    // The Orchard door is Draw 3 under a card fee - the self-cancellation law,
    // which has a subject only in this game. The printed value went to 2 with
    // the commons (C3), so the control has to pin it.
    'workers.roster.draw.draw.see': 3,
    'workers.roster.draw.draw.keep': 3,
    // ⛔ DELIVERY MEEPLE PINNED 14/09/2026: the spend window, at its old inert
    // values ('start' and null). The space choice was deleted on 16/09/2026.
    'rules.turn.meepleSpendTiming': 'start',
    'rules.turn.meepleSpendPerTurn': null,
    'rules.turn.meepleSpendDistinctColours': false,
    // ⛔ BOARD RETEXTS PINNED 16/09/2026 (R9, R10): this game predates them.
    'rules.economy.noticeBoardPower.vegetableWildCards': 0,
    'rules.economy.noticeBoardPower.dairyDiscount': 0,
  },
});

/**
 * A 2-seat position with the bonus window OPEN.
 *
 * `bonusTiming` is 'end', so the slot opens once the action is spent - every
 * test that wants a bonus option has to say so, and saying it here once keeps
 * the rest of the file about the arm rather than about the turn order.
 *
 * ⚠️ ONLY THE ORCHARD DOOR IS LEGAL IN A BARE POSITION, and that is a fact about
 * the game rather than about the fixture: Draw is legal whenever a deck has a
 * card, while Harvest needs a full building, Sow and Build need cards in hand
 * and Deliver needs a barn. "A door that can do nothing is not offered" is
 * Dean's standing ruling and it survives the currency change, so a test that
 * wants a wheat visit has to build the harvest target first.
 */
function armPosition(): GameState {
  const s = makeState(arm, ['wheat', 'orchard']);
  s.turnPlayer = WHEAT;
  s.turn.actionSpent = true;
  return s;
}

function visits(state: GameState, seat: Seat = WHEAT) {
  return visitOptions(arm, state, seat);
}

function supply(state: GameState, seat: Seat): Record<Suit, number> {
  return player(state, seat).meeples;
}

describe('setup under the arm', () => {
  it('gives every seat one meeple of each colour, from outside the island bag (R3)', () => {
    const s = newGame(arm, { seats: 2, seed: 'meeple-setup' });
    for (const p of s.players) {
      for (const colour of arm.cards.suits) expect(p.meeples[colour], colour).toBe(1);
    }
    // The bag is untouched by R3: it still seeds the island and only the island,
    // one Worker on each 3 and 4 VP token (the token island, 16/09/2026).
    const dealt = s.island.tiles.flatMap((t) => t.tokens).filter((t) => t.worker !== null).length;
    expect(dealt).toBe(s.island.tiles.length);
    expect(dealt).toBeLessThanOrEqual(arm.island.meeples.poolSize);
  });

  it('seeds a Worker on every 3 and 4 VP token and no other (the token island)', () => {
    const s = newGame(arm, { seats: 2, seed: 'meeple-seed' });
    for (const token of s.island.tiles.flatMap((t) => t.tokens)) {
      expect(token.worker !== null).toBe(token.vp <= 4);
    }
  });

  it('gives every seat five empty colour slots (R5)', () => {
    const s = newGame(arm, { seats: 3, seed: 'meeple-slots' });
    for (let seat = 0; seat < s.seats; seat++) {
      const slots = noticeBoardSlots(s, seat);
      expect(Object.keys(slots).sort()).toEqual([...arm.cards.suits].sort());
      for (const colour of arm.cards.suits) expect(slots[colour]).toEqual([]);
    }
  });
});

describe('the visit, paid in meeples', () => {
  it('places the meeple on the host and takes that colour’s action (R1, R2)', () => {
    const s = armPosition();
    const move = visits(s).find((m) => m.host === ORCHARD && m.colour === 'orchard');
    expect(move).toBeDefined();
    expect(move?.fee).toBeNull();

    const out = apply(arm, s, move as Move);
    expect(noticeBoardSlots(out.state, ORCHARD)['orchard']).toEqual(['orchard']);
    expect(supply(out.state, WHEAT)['orchard']).toBe(0);
    expect(out.state.turn.bonusUsed).toEqual(['visit']);

    const visited = out.events.find((e) => e.e === 'visited');
    expect(visited).toMatchObject({ seat: WHEAT, host: ORCHARD, self: false, colour: 'orchard' });
    // The event NAME survives the currency change - A17 and O16 key on it.
    expect(visited).toMatchObject({ wild: false, meeples: ['orchard'] });
    // Draw 2 under the arm, not the shipped Draw 3: the exception dissolved
    // with the card fee (R2).
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', see: 2, keep: 2 });
  });

  it('is never your own board, under any flag (X5)', () => {
    // `selfVisitAllowed` is left TRUE on purpose: the arm must ignore it.
    expect(arm.rules.turn.selfVisitAllowed).toBe(true);
    const s = armPosition();
    expect(visits(s).some((m) => m.host === m.seat)).toBe(false);
    expect(() =>
      apply(arm, s, {
        type: 'visit',
        seat: WHEAT,
        host: WHEAT,
        fee: null,
        meeples: ['orchard'],
        colour: 'orchard',
      }),
    ).toThrow(/no self-visit/i);
  });

  it('refuses a blocked slot, and only that slot (R6)', () => {
    const s = armPosition();
    noticeBoardSlots(s, ORCHARD)['orchard'] = ['orchard'];
    expect(visits(s).some((m) => m.host === ORCHARD && m.colour === 'orchard')).toBe(false);
    expect(() =>
      apply(arm, s, {
        type: 'visit',
        seat: WHEAT,
        host: ORCHARD,
        fee: null,
        meeples: ['orchard'],
        colour: 'orchard',
      }),
    ).toThrow(/already holds a meeple/);
  });

  it('offers no visit for a colour whose door can do nothing (the standing ruling)', () => {
    const s = armPosition();
    // Wheat is Harvest and nothing is full; Vegetable is Deliver with an empty
    // barn; Apiary and Dairy both need cards in hand. Only the Orchard door,
    // which is Draw, has anything to do.
    expect([...new Set(visits(s).map((m) => m.colour))]).toEqual(['orchard']);
  });

  it('spends two meeples as one of any colour, both into the bought slot (R10)', () => {
    const s = armPosition();
    const held = supply(s, WHEAT);
    held['orchard'] = 0; // no orchard meeple, so the pair is the only route to that door
    const wild = visits(s).find((m) => m.colour === 'orchard' && (m.meeples?.length ?? 0) === 2);
    expect(wild).toBeDefined();

    const out = apply(arm, s, wild as Move);
    const slot = noticeBoardSlots(out.state, ORCHARD)['orchard'] ?? [];
    expect(slot).toHaveLength(2);
    expect(slot).not.toContain('orchard');
    expect(wild?.meeples).toEqual(slot);
    for (const colour of slot) expect(supply(out.state, WHEAT)[colour]).toBe(0);
    expect(out.events.find((e) => e.e === 'visited')).toMatchObject({ wild: true });
  });

  it('never offers a pair for a colour already held (the pair is a strictly worse twin)', () => {
    const s = armPosition();
    expect(supply(s, WHEAT)['orchard']).toBe(1);
    expect(visits(s).every((m) => (m.meeples?.length ?? 0) === 1)).toBe(true);
    expect(() =>
      apply(arm, s, {
        type: 'visit',
        seat: WHEAT,
        host: ORCHARD,
        fee: null,
        meeples: ['wheat', 'dairy'],
        colour: 'orchard',
      }),
    ).toThrow(/must spend it singly/);
  });
});

describe('collect', () => {
  it('takes the whole board back and draws 1 (R7)', () => {
    const s = armPosition();
    const slots = noticeBoardSlots(s, WHEAT);
    slots['orchard'] = ['vegetable'];
    supply(s, WHEAT)['vegetable'] = 0;

    const out = apply(arm, s, { type: 'collect', seat: WHEAT });
    expect(noticeBoardSlots(out.state, WHEAT)['orchard']).toEqual([]);
    expect(supply(out.state, WHEAT)['vegetable']).toBe(1);
    expect(out.state.turn.bonusUsed).toEqual(['collect']);
    expect(out.events).toContainEqual({
      e: 'boardCollected',
      seat: WHEAT,
      kept: ['vegetable'],
      boxed: [],
    });
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', see: 1, keep: 1 });
  });

  it('on an EMPTY board is legal and is exactly a Draw 1 (R7, the solitaire line)', () => {
    const s = armPosition();
    expect(collectOpen(arm, s, WHEAT)).toBe(true);

    const out = apply(arm, s, { type: 'collect', seat: WHEAT });
    expect(out.events).toContainEqual({ e: 'boardCollected', seat: WHEAT, kept: [], boxed: [] });
    expect(out.events.some((e) => e.e === 'meepleGained' || e.e === 'meepleBoxed')).toBe(false);
    const n = arm.rules.turn.bonusDraw;
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', see: n, keep: n });
  });

  it('draws a FLAT 1 however many meeples came back (X6)', () => {
    const s = armPosition();
    const slots = noticeBoardSlots(s, WHEAT);
    slots['orchard'] = ['vegetable', 'dairy'];
    slots['apiary'] = ['wheat'];
    for (const colour of arm.cards.suits) supply(s, WHEAT)[colour] = 0;

    const out = apply(arm, s, { type: 'collect', seat: WHEAT });
    const collected = out.events.find((e) => e.e === 'boardCollected');
    expect(collected).toMatchObject({ kept: ['wheat', 'vegetable', 'dairy'], boxed: [] });
    expect(out.state.tasks[0]).toMatchObject({ t: 'draw', see: 1, keep: 1 });
  });
});

describe('the supply cap (R4)', () => {
  it('boxes a duplicate coming off your own board, and still clears the slot', () => {
    const s = armPosition();
    const slots = noticeBoardSlots(s, WHEAT);
    // A wild pair a neighbour spent: one colour this seat holds, one it does not.
    slots['orchard'] = ['wheat', 'dairy'];
    supply(s, WHEAT)['wheat'] = 1;
    supply(s, WHEAT)['dairy'] = 0;

    const out = apply(arm, s, { type: 'collect', seat: WHEAT });
    expect(supply(out.state, WHEAT)['wheat']).toBe(1);
    expect(supply(out.state, WHEAT)['dairy']).toBe(1);
    // The refused meeple leaves the slot anyway - leaving it would shut the
    // owner's own door on a colour they could never clear.
    expect(noticeBoardSlots(out.state, WHEAT)['orchard']).toEqual([]);
    expect(out.events).toContainEqual({
      e: 'meepleBoxed',
      seat: WHEAT,
      colour: 'wheat',
      source: 'collect',
    });
    expect(out.events.find((e) => e.e === 'boardCollected')).toMatchObject({
      kept: ['dairy'],
      boxed: ['wheat'],
    });
  });

  it('boxes a duplicate Worker coming off the island, and pays none off a Worker-less token', () => {
    const s = makeState(arm, ['wheat', 'orchard']);
    // The testkit deals in pool order: A1 holds wheat 6 and 5 (no Worker), A2
    // wheat 4 and 3 (a Worker each, the first colours of the bag).
    const a2 = s.island.tiles.find((t) => t.tile === 'A2')!;
    const seeded = a2.tokens[0]!.worker!;
    const barn = player(s, WHEAT).barn;
    for (let i = 0; i < 8; i++) {
      const card = s.decks.wheat.shift();
      if (card === undefined) throw new Error('wheat deck ran dry');
      barn.push(card);
    }
    supply(s, WHEAT)[seeded] = 1;

    // A token with no Worker: VP only.
    const first = apply(arm, s, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A1',
      spend: { wheat: 4 },
      token: 0,
    });
    expect(first.events.some((e) => e.e === 'meepleGained' || e.e === 'meepleBoxed')).toBe(false);

    // A Worker token whose colour the seat already holds, under the arm's cap
    // of one: the Worker is boxed.
    const s2 = first.state;
    s2.turn = freshTurn();
    s2.turnPlayer = WHEAT;
    const second = apply(arm, s2, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A2',
      spend: { wheat: 4 },
      token: 0,
    });
    expect(second.events).toContainEqual({
      e: 'meepleBoxed',
      seat: WHEAT,
      colour: seeded,
      source: 'island',
    });
    expect(supply(second.state, WHEAT)[seeded]).toBe(1);
  });
});

describe('what the arm deletes', () => {
  it('offers no standalone bonus Draw (R9)', () => {
    const s = armPosition();
    expect(legalMoves(arm, s).some((m) => m.type === 'bonusDraw')).toBe(false);
    expect(() => apply(arm, s, { type: 'bonusDraw', seat: WHEAT })).toThrow(/bonus slot is shut/);
  });

  it('offers no turn-start meeple spend (R8), and does not hold the turn open for one', () => {
    const s = makeState(arm, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    // The window the deleted phase used to live in: nothing spent at all.
    expect(s.turn.actionSpent).toBe(false);
    expect(supply(s, WHEAT)['orchard']).toBe(1);
    expect(meepleOptions(arm, s, WHEAT)).toEqual([]);
    expect(legalMoves(arm, s).some((m) => m.type === 'spendMeeple')).toBe(false);
    expect(() => apply(arm, s, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' })).toThrow(
      /deleted under the meeple visit currency/,
    );
  });

  it('makes the Notice Board not a building: no threshold, no stack, no sow, no harvest (R5)', () => {
    const s = armPosition();
    s.turn.actionSpent = false;
    dealTo(arm, s, WHEAT, 'W7');
    const moves = legalMoves(arm, s);
    // Nothing may target W3 The Notice Board, by any route.
    expect(
      moves.some(
        (m) =>
          (m.type === 'grow' && m.building === 'W3') ||
          (m.type === 'harvest' && m.building === 'W3'),
      ),
    ).toBe(false);
  });
});

describe('A Helping Hand under the arm (R11), retired 16/09/2026', () => {
  // ⛔ The card used to grant ONE visit and ONE collect. The v42 Helping Hands
  // grant no bonus option at all, so under the arm a W18 holder gets the one
  // option the rule gives and the turn ends after it.
  it('grants no second option: after a visit, neither a visit nor a collect', () => {
    const s = armPosition();
    buildFor(arm, s, WHEAT, 'W18');

    const first = visits(s).find((m) => m.host === ORCHARD && m.colour === 'orchard');
    const afterVisit = apply(arm, s, first as Move);
    expect(afterVisit.state.turn.bonusUsed).toEqual(['visit']);
    expect(collectOpen(arm, afterVisit.state, WHEAT)).toBe(false);
    expect(visitOptions(arm, afterVisit.state, WHEAT)).toHaveLength(0);
  });
});

/**
 * ⭐ THE ARM AND THE DEFAULT SWAPPED PLACES ON 04/09/2026. Dean ruled the meeple
 * loop in, so `BASE_GAME_DATA` IS the arm and the v31 card-fee game is the
 * control behind `overlays/v31-card-visit.overlay.json`. This block asserted
 * "the knob is off" of the base data; it now asserts the same claim from the
 * other side, which is worth keeping for exactly the reason it was written -
 * "the flag is where I think it is" is a claim worth failing on.
 */
describe('the shipped default is the NOTICE-BOARD VISIT, and both controls still reproduce their own game', () => {
  /**
   * ⛔ NARROWED TWICE, AND THE SECOND TIME IT CHANGED SIDES. It said "the base
   * data IS the arm" until 05/09/2026, when the meeple ECONOMY was ruled in on
   * top of the loop; it said "the base data is the meeple CURRENCY" until
   * 09/09/2026, when the commons replaced it (C1, C6). So what it pins now is
   * the ABSENCE: no seat holds a meeple, no tile carries one, and this whole
   * file is about an arm rather than about the shipped game. (The commons was
   * deleted on 13/09/2026; the shipped notice-board visit seeds no meeple either.)
   */
  it('the base data starts nobody holding a meeple, and the arm deals them as R3 does', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('noticeBoardPower');
    const shipped = newGame(BASE_GAME_DATA, { seats: 2, seed: 'shipped' });
    for (const p of shipped.players) {
      for (const colour of BASE_GAME_DATA.cards.suits) expect(p.meeples[colour]).toBe(0);
    }
    // ⚠️ The island carries Workers under the shipped game (the delivery meeple,
    // on the 3 and 4 VP tokens since 16/09/2026), and still none in a supply.
    const workersOn = (st: GameState) =>
      st.island.tiles.flatMap((t) => t.tokens).filter((t) => t.worker !== null).length;
    expect(workersOn(shipped)).toBe(shipped.island.tiles.length);

    const s = newGame(arm, { seats: 2, seed: 'shipped' });
    for (const p of s.players) {
      for (const colour of arm.cards.suits) expect(p.meeples[colour]).toBe(1);
    }
    expect(workersOn(s)).toBe(s.island.tiles.length);
  });

  it('carries no Notice Board slots and no starting meeples under the v31 control', () => {
    expect(control.rules.turn.visitCurrency).toBe('card');
    const s = newGame(control, { seats: 2, seed: 'control' });
    for (const p of s.players) {
      expect(Object.hasOwn(p, 'noticeBoard')).toBe(false);
      for (const colour of control.cards.suits) expect(p.meeples[colour]).toBe(0);
    }
    // ⚠️ Since 16/09/2026 the v31 control's island meeples sit on the 3 and 4
    // VP tokens like every other game's: one a tile at two seats.
    expect(s.island.tiles.flatMap((t) => t.tokens).filter((t) => t.worker !== null)).toHaveLength(
      s.island.tiles.length,
    );
  });

  it('still offers the free Draw 1 and still prices a visit in cards', () => {
    const s = makeState(control, ['wheat', 'orchard']);
    s.turnPlayer = WHEAT;
    s.turn.actionSpent = true;
    dealTo(control, s, WHEAT, 'W7');
    const moves = legalMoves(control, s);
    expect(moves.some((m) => m.type === 'bonusDraw')).toBe(true);
    expect(moves.some((m) => m.type === 'collect')).toBe(false);
    expect(moves.some((m) => m.type === 'visit' && m.fee === 'W7')).toBe(true);
  });
});

describe('whole games under the arm', () => {
  /**
   * ⭐ THE POINT IS THE WEDGE, NOT THE OUTCOME. Under the arm a seat can hold a
   * colour every rival board has blocked (X2: no island valve, by ruling), the
   * turn-start meeple phase is gone and the bonus slot's solitaire half is a
   * different move - three separate ways for a position to end up with nothing
   * legal to do. `legalMoves` returning empty mid-game is the failure this
   * block exists to catch, and it would show up in a balance run as a crash
   * rather than as a number.
   */
  const PRIORITY: Move['type'][] = [
    'task',
    'deliver',
    'harvest',
    'build',
    'grow',
    'draw',
    'visit',
    'collect',
    'cardMove',
    'pass',
    'endTurn',
  ];

  function pick(rng: [number, number, number, number], moves: Move[]): Move {
    for (const type of PRIORITY) {
      const of = moves.filter((m) => m.type === type);
      if (of.length > 0) return of[rngInt(rng, of.length)] as Move;
    }
    // Naming the types is the whole value of the throw: a policy list that has
    // fallen behind the move vocabulary looks exactly like a stuck game.
    throw new Error(`no move to pick: ${[...new Set(moves.map((m) => m.type))].join(', ')}`);
  }

  it.each([
    ['arm-2p', 2, ['wheat', 'orchard'] as Suit[]],
    ['arm-3p', 3, ['vegetable', 'wheat', 'apiary'] as Suit[]],
    ['arm-4p', 4, ['dairy', 'orchard', 'vegetable', 'wheat'] as Suit[]],
  ])('plays %s to the end trigger with a legal move at every step', (seed, seats, suits) => {
    let state = newGame(arm, { seats, suits, seed });
    const rng = seedRng(`policy:${seed}`);
    for (let step = 0; step < 6000; step++) {
      if (isOver(state)) break;
      const moves = legalMoves(arm, state);
      expect(moves.length, `step ${step}`).toBeGreaterThan(0);
      expect(moves.length).toBeLessThan(4000);
      state = apply(arm, state, pick(rng, moves)).state;
    }
    /**
     * ⚠️ ENDED, OR SUPPLY-LOCKED, AND THE SECOND IS A REAL TERMINAL STATE RATHER
     * THAN A LOOSENED ASSERTION.
     *
     * This policy is greedy and stupid: it prefers `draw` over `visit`, over
     * `collect` and over anything that ends a turn, so it empties all five decks
     * and every discard into hands, plays those out, and can arrive at a table
     * where nobody holds a card, no barn can pay a crate and every deck is dry.
     * At that point every seat's only legal move is `pass`, forever, because
     * this game's clock is a player action - the sixth island delivery - and
     * there is no deck-out ending to catch it.
     *
     * It is legal and it is not new: the balance suite already counts these as
     * UNFINISHED GAMES and reports the rate. What this block exists to catch is
     * `legalMoves` returning EMPTY mid-game, which is asserted at every step
     * above and is the failure that would show up in a run as a crash.
     *
     * 3p reaches the lock on this seed and 2p and 4p do not. It is worth knowing
     * why the seed changed sides on 04/09/2026: W17 The Pie Shop was re-keyed
     * onto the visit and now draws a card for its owner when a neighbour visits
     * them, which moved this trajectory a few cards further into the deck.
     * Nothing about the currency did it.
     */
    const dry =
      arm.cards.suits.every((c) => state.decks[c].length === 0 && state.discards[c].length === 0) &&
      state.players.every((p) => p.hand.length === 0);
    expect(state.phase === 'ended' || dry, `${seed}: neither ended nor supply-locked`).toBe(true);

    // The loop really did loop: meeples came back off boards rather than only
    // being spent, and nothing left the game except through the cap.
    const held = state.players.reduce(
      (n, p) => n + arm.cards.suits.reduce((m, c) => m + (p.meeples[c] ?? 0), 0),
      0,
    );
    expect(held).toBeGreaterThan(0);
  });
});
