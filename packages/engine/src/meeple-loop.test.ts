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
import { buildFor, dealTo, deliveredAt, makeState } from './testkit.js';

const WHEAT: Seat = 0;
const ORCHARD: Seat = 1;

/**
 * The arm - which since Dean ruled it in on 04/09/2026 is simply the shipped
 * game. The overlay is kept and the tests still load through it because
 * `overlays/meeple-loop-v1.overlay.json` is a no-op against the default and this
 * file is what would notice if that ever stopped being true.
 */
const arm: GameData = loadGameData({
  name: 'meeple-loop-v1',
  schemaVersion: 1,
  set: { 'rules.turn.visitCurrency': 'meeple' },
});

/** The v31 card-fee game, as `overlays/v31-card-visit.overlay.json` sets it. */
const control: GameData = loadGameData({
  name: 'v31-card-visit',
  schemaVersion: 1,
  set: { 'rules.turn.visitCurrency': 'card' },
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
    // The bag is untouched by R3: it still seeds the island and only the island.
    const dealt = s.island.tiles.flatMap((t) => t.meeples).length;
    expect(dealt).toBe(s.island.tiles.length);
    expect(dealt).toBeLessThanOrEqual(arm.island.meeples.poolSize);
  });

  it('seeds ONE meeple per tile, on the 3 VP second space (R12)', () => {
    const s = newGame(arm, { seats: 2, seed: 'meeple-seed' });
    for (const tile of s.island.tiles) expect(tile.meeples).toHaveLength(1);
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

  it('boxes a duplicate coming off the island, and pays the meeple on the SECOND delivery only', () => {
    const s = makeState(arm, ['wheat', 'orchard']);
    const tile = s.island.tiles[0];
    if (!tile) throw new Error('no tile in play');
    // The testkit deals the bag unshuffled, so tile 0's one meeple is the first
    // colour in `island.meeples.colours`.
    const seeded = tile.meeples[0];
    expect(seeded).toBeDefined();

    // Enough barn cards to pay both crates of the tile, whatever they demand.
    const barn = player(s, WHEAT).barn;
    for (const crate of tile.crates) {
      const suit = crate === 'wild' ? 'wheat' : crate;
      for (let i = 0; i < arm.island.tileRule.cardsPerCrate; i++) {
        const card = s.decks[suit].shift();
        if (card === undefined) throw new Error(`${suit} deck ran dry`);
        barn.push(card);
      }
    }
    supply(s, WHEAT)[seeded as Suit] = 1;

    // FIRST delivery: VP only, no meeple (R12).
    const first = apply(arm, s, {
      type: 'deliver',
      seat: WHEAT,
      tile: tile.tile,
      spend: countBySuit(arm, barn),
    });
    expect(first.events.some((e) => e.e === 'meepleGained' || e.e === 'meepleBoxed')).toBe(false);

    // SECOND delivery to the same tile: the meeple, and it duplicates one held.
    const s2 = makeState(arm, ['wheat', 'orchard']);
    deliveredAt(s2, ORCHARD, tile.tile);
    const barn2 = player(s2, WHEAT).barn;
    for (const crate of tile.crates) {
      const suit = crate === 'wild' ? 'wheat' : crate;
      for (let i = 0; i < arm.island.tileRule.cardsPerCrate; i++) {
        const card = s2.decks[suit].shift();
        if (card === undefined) throw new Error(`${suit} deck ran dry`);
        barn2.push(card);
      }
    }
    supply(s2, WHEAT)[seeded as Suit] = 1;
    const second = apply(arm, s2, {
      type: 'deliver',
      seat: WHEAT,
      tile: tile.tile,
      spend: countBySuit(arm, barn2),
    });
    expect(second.events).toContainEqual({
      e: 'meepleBoxed',
      seat: WHEAT,
      colour: seeded,
      source: 'island',
    });
    expect(supply(second.state, WHEAT)[seeded as Suit]).toBe(1);
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

describe('A Helping Hand under the arm (R11)', () => {
  it('grants ONE visit and ONE collect, never two of either', () => {
    const s = armPosition();
    buildFor(arm, s, WHEAT, 'W18');

    const first = visits(s).find((m) => m.host === ORCHARD && m.colour === 'orchard');
    const afterVisit = apply(arm, s, first as Move);
    let state = afterVisit.state;
    // The visit pushed a Draw 2 task; answer it away so the bonus slot is what
    // the next enumeration is about.
    state = drainDraw(state);

    // A second visit is refused, a collect is not.
    expect(visitOptions(arm, state, WHEAT)).toHaveLength(0);
    expect(collectOpen(arm, state, WHEAT)).toBe(true);

    const afterCollect = apply(arm, state, { type: 'collect', seat: WHEAT });
    // Read the slot record BEFORE the draw drains: with both options spent and
    // the action already taken, `settleTurn` ends the turn and `freshTurn`
    // clears `bonusUsed`, so draining first would assert against the next seat.
    expect(afterCollect.state.turn.bonusUsed).toEqual(['visit', 'collect']);
    expect(collectOpen(arm, afterCollect.state, WHEAT)).toBe(false);
    expect(visitOptions(arm, afterCollect.state, WHEAT)).toHaveLength(0);
    // And the turn really does end rather than offering a third option.
    state = drainDraw(afterCollect.state);
    expect(state.turnPlayer).toBe(ORCHARD);
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
describe('the shipped default is the arm, and the control still reproduces v31', () => {
  it('the base data IS the meeple loop', () => {
    expect(BASE_GAME_DATA.rules.turn.visitCurrency).toBe('meeple');
    const s = newGame(BASE_GAME_DATA, { seats: 2, seed: 'shipped' });
    for (const p of s.players) {
      for (const colour of BASE_GAME_DATA.cards.suits) expect(p.meeples[colour]).toBe(1);
    }
    for (const tile of s.island.tiles) expect(tile.meeples).toHaveLength(1);
  });

  it('carries no Notice Board slots and no starting meeples under the v31 control', () => {
    expect(control.rules.turn.visitCurrency).toBe('card');
    const s = newGame(control, { seats: 2, seed: 'control' });
    for (const p of s.players) {
      expect(Object.hasOwn(p, 'noticeBoard')).toBe(false);
      for (const colour of control.cards.suits) expect(p.meeples[colour]).toBe(0);
    }
    // Two meeples per tile, on both delivery spaces, exactly as v31 deals them.
    for (const tile of s.island.tiles) expect(tile.meeples).toHaveLength(2);
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
    // ⚠️ LAST, AND THE ORDER IS THE WHOLE OF IT. A balloon move IS the Deliver
    // action but never an island delivery, so a greedy policy that prefers one
    // spends the turn without moving the clock and the game never ends. It is
    // in the list at all because a position can offer nothing else, which is
    // what a bare `throw` here was mistaking for a stuck game.
    'moveBalloon',
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

/** Answer whatever draw task is pending, taking the first legal answer each time. */
function drainDraw(state: GameState): GameState {
  let out = state;
  for (let guard = 0; guard < 20 && out.tasks.length > 0; guard++) {
    const move = legalMoves(arm, out)[0];
    if (!move) break;
    out = apply(arm, out, move).state;
  }
  return out;
}

/** A barn tally by suit, for a deliver move's `spend`. */
function countBySuit(data: GameData, cards: readonly string[]): Partial<Record<Suit, number>> {
  const out: Partial<Record<Suit, number>> = {};
  for (const id of cards) {
    const suit = data.cards.catalogue.find((c) => c.id === id)?.suit;
    if (!suit) throw new Error(`Unknown card ${id}`);
    out[suit] = (out[suit] ?? 0) + 1;
  }
  return out;
}
