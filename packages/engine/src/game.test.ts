/**
 * Ticket 17's proof: the full newGame / legalMoves / apply surface plays whole
 * games. Surgical tests pin each action funnel and the turn boundary; the
 * full-game tests drive seeded games to the delivery-count end trigger with a greedy
 * policy, assert apply accepts exactly what legalMoves offers, keep a ceiling
 * on the move list, check card conservation, and replay the move list to the
 * bit-identical final state.
 *
 * ⭐ v31 (02/09/2026). Whole suites left this file with the rules they described:
 * `the card buy`, `buy at market`, every upgrade test, the Special Orders 2-card
 * visit, the coin payouts and wages, and the end-of-turn discard. What replaced
 * them is at the bottom of "the bonus slot" and in "the meeple phase". Nothing
 * about the island, the wild substitution or the end trigger changed.
 *
 * ⭐ ONE OF THOSE SUITES CAME BACK THE SAME DAY. The end-of-turn discard is live
 * again in "the turn boundary", against a flat `rules.turn.handLimit` of 12
 * rather than against a printed Barn face. See that block for why.
 */

import { BASE_GAME_DATA as data, loadGameData } from '@gp/data';
import type { Suit } from '@gp/data';
import { describe, expect, it } from 'vitest';

import { anyDeliverOption, deliverOptions, islandDeliveriesBy, tileLevel } from './actions.js';
import { apply, isOver, legalMoves, newGame } from './game.js';
import { cardById } from './query.js';
import { seedRng, rngInt } from './rng.js';
import { score } from './runtime.js';
import { freshTurn, islandTilesInPlay, meeplePool } from './setup.js';
import type { GameEvent, GameState, Move } from './state.js';
import { buildFor, dealTo, deliveredAt, giveMeeples, makeState } from './testkit.js';
import { redactEvents, viewFor } from './view.js';

const WHEAT = 0;
const ORCHARD = 1;

/**
 * Wheat and Orchard, so the two doors under test are the two easiest to reason
 * about: Wheat's is Harvest (needs a full building, so it is the door that
 * refuses) and Orchard's is Draw 3 (legal whenever a deck has a card, so it is
 * the door that always works).
 */
function base(): GameState {
  return makeState(data, ['wheat', 'orchard']);
}

function noticeBoard(state: GameState, seat: number) {
  const board = state.players[seat]?.tableau.find(
    (b) => cardById(data, b.card).slot === 'noticeboard',
  );
  if (!board) throw new Error(`seat ${seat} has no Notice Board`);
  return board;
}

/** A Wheat delivery to A1, which the testkit island stocks with two wheat crates (4 wheat). */
function deliverA1(spend: Partial<Record<Suit, number>>): Move {
  return { type: 'deliver', seat: WHEAT, tile: 'A1', spend };
}

/** Move ids from a deck straight into a barn (testkit-style surgery). */
function stockBarn(state: GameState, seat: number, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

describe('newGame', () => {
  it('sets up a 2-seat game per the rules data', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: 'setup' });
    expect(state.suitsInPlay).toHaveLength(3);
    expect(state.suitsInPlay.slice(0, 2)).toEqual(['wheat', 'apiary']);
    for (const p of state.players) {
      // v31: four cards in hand, NOTHING in the barn, and no coins to have.
      expect(p.hand).toHaveLength(4);
      expect(p.barn).toHaveLength(0);
      expect(Object.values(p.meeples)).toEqual([0, 0, 0, 0, 0]);
      // THREE starters since change 6 (20/08/2026): Barn, Farmstead, Notice
      // Board. The fourth was the Service and its door merged into the Board.
      expect(p.tableau).toHaveLength(3);
      // Own deck holds 14 after dealing the hand; nothing else is dealt.
      expect(state.decks[p.suit]).toHaveLength(14);
      for (const id of p.hand) expect(cardById(data, id).suit).toBe(p.suit);
    }
    const passive = state.suitsInPlay[2] as Suit;
    expect(state.decks[passive]).toHaveLength(18);
    // Bookend rule at 2 seats: A1 A2 A5 / B1 B4 / D1.
    expect(state.island.tiles.map((t) => t.tile)).toEqual(['A1', 'A2', 'A5', 'B1', 'B4', 'D1']);
    // 12 demand tokens over 12 crates - 6 tiles of 2 since the flat island -
    // only in-play suits and wilds.
    const tokens = state.island.tiles.flatMap((t) => t.crates);
    expect(tokens).toHaveLength(12);
    for (const tok of tokens) {
      expect(tok === 'wild' || state.suitsInPlay.includes(tok)).toBe(true);
    }
    // Every door is owned from setup by the suit that brought it, and a door
    // whose suit is absent has no owner at all.
    const owned = state.fair.filter((w) => w.owner !== null);
    expect(owned).toHaveLength(2);
    for (const w of state.fair) {
      const spec = data.workers.roster.find((r) => r.id === w.id)!;
      const seat = state.players.findIndex((p) => p.suit === spec.linkedSuit);
      expect(w.owner, w.id).toBe(seat < 0 ? null : seat);
    }
  });

  /**
   * THE MEEPLE DEAL (v31). One per delivery space, face up, drawn from a bag of
   * 25 that is NOT filtered by who is at the table - a meeple of a suit nobody
   * is farming still performs its action, so the island can and does hand out
   * colours no Notice Board on the table grants.
   */
  it('deals one meeple per island delivery space, face up, from all five colours', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: 'meeples' });
    const dealt = state.island.tiles.flatMap((t) => t.meeples);
    // 6 tiles times 2 delivery spaces. `vpByDeliveryOrder.length` IS the space
    // count, so the two can never drift.
    expect(dealt).toHaveLength(12);
    for (const t of state.island.tiles) expect(t.meeples).toHaveLength(2);
    for (const colour of dealt) expect(data.cards.suits).toContain(colour);
    expect(meeplePool(data)).toHaveLength(data.island.meeples.poolSize);
  });

  /**
   * The bag is 25 and a 4-seat board needs 24, so the draw is near-exhaustive
   * there and genuinely random at 2 seats. That asymmetry is a KNOWN PROPERTY
   * with an overlay arm written for it, not a bug: pinning it here is what stops
   * somebody "fixing" the bag to fit the board and silently deleting the thing
   * the arm measures.
   */
  it('draws 24 of the bag of 25 at four seats', () => {
    const four = newGame(data, {
      seats: 4,
      suits: ['wheat', 'apiary', 'orchard', 'dairy'],
      seed: 'big',
    });
    expect(four.island.tiles.flatMap((t) => t.meeples)).toHaveLength(24);
    expect(data.island.meeples.poolSize).toBe(25);
  });

  it('parks balloons only when Vegetable is on the table', () => {
    const withVeg = newGame(data, { seats: 2, suits: ['vegetable', 'dairy'], seed: 'v' });
    expect(withVeg.aerodrome?.balloons).toHaveLength(4);
    // Ruling J: all four start unowned in the centre - no per-seat parking.
    expect(withVeg.aerodrome?.balloons.filter((b) => b.at === 'centre')).toHaveLength(4);
    // At 4 seats all five decks are on the table, so the Aerodrome is always in play.
    const four = newGame(data, {
      seats: 4,
      suits: ['wheat', 'apiary', 'orchard', 'dairy'],
      seed: 'n',
    });
    expect(four.suitsInPlay).toContain('vegetable');
    expect(four.aerodrome).not.toBeNull();
    // At 2 seats the passive suit is random; find a seed that leaves Vegetable out.
    for (let i = 0; i < 20; i++) {
      const s = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: `n${i}` });
      if (!s.suitsInPlay.includes('vegetable')) {
        expect(s.aerodrome).toBeNull();
        return;
      }
    }
    throw new Error('no seed left Vegetable out in 20 tries');
  });

  it('tiles the island for every seat count', () => {
    expect(islandTilesInPlay(data, 3)).toEqual([
      'A1',
      'A2',
      'A3',
      'A5',
      'B1',
      'B2',
      'B4',
      'C1',
      'C3',
    ]);
    expect(islandTilesInPlay(data, 4)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'B1',
      'B2',
      'B3',
      'B4',
      'C1',
      'C2',
      'C3',
    ]);
  });
});

describe('main actions through apply', () => {
  /**
   * ⭐ DRAW 2, KEEP BOTH (v31). It was see 2 keep 1 from v13, and the discard was
   * the last piece of hidden bookkeeping in the core five actions. The task
   * machinery is unchanged - a `see > keep` card ability still opens a real
   * choice - so what this pins is that the printed action no longer has one.
   */
  it('draw is the base see-2-keep-2 task and spends the action', () => {
    const state = base();
    const applied = apply(data, state, { type: 'draw', seat: WHEAT });
    expect(applied.state.turn.actionSpent).toBe(true);
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 2, keep: 2, pid: WHEAT });
    const picks = legalMoves(data, applied.state);
    expect(picks.every((m) => m.type === 'task' && m.seat === WHEAT)).toBe(true);
  });

  it('a full draw keeps both revealed cards and discards nothing', () => {
    let s = apply(data, base(), { type: 'draw', seat: WHEAT }).state;
    while (s.tasks.length > 0) {
      const moves = legalMoves(data, s);
      s = apply(data, s, moves[0] as Move).state;
    }
    // Two revealed, two kept, and the turn settled with no discard on the way.
    expect(s.players[WHEAT]!.hand).toHaveLength(2);
    expect(data.cards.suits.every((suit) => s.discards[suit].length === 0)).toBe(true);
  });

  it('build pays in cards and nothing else', () => {
    const state = base();
    dealTo(data, state, WHEAT, ...state.decks.wheat.slice(0, 4));
    const before = state.players[WHEAT]!.hand.length;
    const builds = legalMoves(data, state).filter(
      (m): m is Extract<Move, { type: 'build' }> => m.type === 'build',
    );
    expect(builds.length).toBeGreaterThan(0);
    const move = builds[0] as Extract<Move, { type: 'build' }>;
    const applied = apply(data, state, move);
    expect(applied.state.players[WHEAT]!.hand).toHaveLength(before - 1 - move.payment.length);
    expect(applied.events).toContainEqual({
      e: 'built',
      seat: WHEAT,
      card: move.card,
      payment: move.payment,
    });
  });

  /**
   * THE BONUS WINDOW (Dean, 19/08/2026, carried into v31): *"the bonus action
   * can only be performed at the start of your turn."* One predicate,
   * `bonusOpen`, and the whole of it is that the main action has not been taken.
   */
  it('the bonus slot shuts the moment the main action is taken', () => {
    const open = base();
    dealTo(data, open, WHEAT, 'W4'); // a visit needs a fee card in hand
    expect(legalMoves(data, open).some((m) => m.type === 'visit')).toBe(true);
    expect(legalMoves(data, open).some((m) => m.type === 'bonusDraw')).toBe(true);

    // `!actionSpent` IS "at the start of your turn" - there is no other thing a
    // turn can have done, which is why the rule needed no new state. Set here
    // rather than reached through a real action because every main action
    // pushes a task, and a pending task is the one thing that suppresses the
    // whole move list.
    const shut = base();
    dealTo(data, shut, WHEAT, 'W4');
    shut.turn.actionSpent = true;
    expect(shut.turn.bonusUsed).toEqual([]); // unspent, and still unreachable
    expect(legalMoves(data, shut).some((m) => m.type === 'visit')).toBe(false);
    expect(legalMoves(data, shut).some((m) => m.type === 'bonusDraw')).toBe(false);
    expect(legalMoves(data, shut).some((m) => m.type === 'spendMeeple')).toBe(false);
  });

  /**
   * ⭐ THE ISLAND PAYS A MEEPLE, NOT A COIN (v31). Both delivery spaces on every
   * tile carry one, so the 3 VP space is not a consolation prize - it is 3 VP
   * AND a free action.
   */
  it('deliver pays crates from the barn, takes the next receipt, and claims that space its meeple', () => {
    const state = base();
    // Testkit island at 2 seats: A1 holds [wheat, wheat], so 4 wheat.
    const first = state.island.tiles.find((t) => t.tile === 'A1')!.meeples[0]!;
    stockBarn(state, WHEAT, 'wheat', 4);
    const applied = apply(data, state, deliverA1({ wheat: 4 }));
    // First to this tile, so the head of the schedule: 6 VP.
    expect(applied.state.players[WHEAT]!.receipts).toEqual([6]);
    expect(applied.state.players[WHEAT]!.barn).toHaveLength(0);
    expect(applied.state.players[WHEAT]!.meeples[first]).toBe(1);
    expect(applied.events).toContainEqual({
      e: 'meepleGained',
      seat: WHEAT,
      colour: first,
      tile: 'A1',
      space: 0,
    });
    expect(applied.state.island.tiles.find((t) => t.tile === 'A1')?.deliveredBy).toEqual([WHEAT]);
    expect(applied.state.endTrigger).toBeNull();

    // Second to the SAME tile takes the second entry - 3 VP, and the second
    // meeple. The whole time gradient is this: arriving first is worth double,
    // and the free action is the same either way.
    const s2 = applied.state;
    const second = s2.island.tiles.find((t) => t.tile === 'A1')!.meeples[1]!;
    s2.turn = freshTurn();
    s2.turnPlayer = ORCHARD;
    stockBarn(s2, ORCHARD, 'wheat', 4);
    const out = apply(data, s2, {
      type: 'deliver',
      seat: ORCHARD,
      tile: 'A1',
      spend: { wheat: 4 },
    });
    expect(out.state.players[ORCHARD]!.receipts).toEqual([3]);
    expect(out.state.players[ORCHARD]!.meeples[second]).toBe(1);
  });

  it('the meeples on a tile are never mutated: the record is deliveredBy', () => {
    const state = base();
    stockBarn(state, WHEAT, 'wheat', 4);
    const before = [...state.island.tiles.find((t) => t.tile === 'A1')!.meeples];
    const after = apply(data, state, deliverA1({ wheat: 4 })).state;
    // The printed schedule stays put; who took which space is `deliveredBy`.
    expect(after.island.tiles.find((t) => t.tile === 'A1')?.meeples).toEqual(before);
  });

  /**
   * The clock. One seat's Nth island delivery ends the game, counted across the
   * whole island and per seat - so a rival racing does not arm your trigger, and
   * the two receipts on one tile count as two.
   */
  it('the end fires on a sixth island delivery by ONE seat, not on six across the table', () => {
    const s = base();
    // Five for Wheat and five for Orchard, interleaved over the six 2-seat tiles.
    deliveredAt(s, WHEAT, 'A1', 'A2', 'A5', 'B1', 'B4');
    deliveredAt(s, ORCHARD, 'A1', 'A2', 'A5', 'B1', 'B4');
    expect(islandDeliveriesBy(s, WHEAT)).toBe(5);
    expect(s.endTrigger).toBeNull();

    // 8 wheat pays any tile outright under the wild substitution, whatever its
    // crates ask for, so the sixth delivery does not depend on the demand deal.
    stockBarn(s, WHEAT, 'wheat', 8);
    const sixth = legalMoves(data, s).find((m) => m.type === 'deliver' && m.tile === 'D1');
    expect(sixth).toBeDefined();
    const out = apply(data, s, sixth as Move);
    expect(islandDeliveriesBy(out.state, WHEAT)).toBe(6);
    expect(out.state.endTrigger).toEqual({ seat: WHEAT });
    expect(out.events.some((e) => e.e === 'endTriggered')).toBe(true);
  });

  it('rules.endGame.deliveriesToTrigger is the dial on the clock', () => {
    const quick = loadGameData({
      name: 'short-game',
      schemaVersion: 1,
      set: { 'rules.endGame.deliveriesToTrigger': 2 },
    });
    const s = makeState(quick, ['wheat', 'orchard']);
    deliveredAt(s, WHEAT, 'A2');
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(quick, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.endTrigger).toEqual({ seat: WHEAT });
  });

  it('a tile takes two deliveries and then refuses', () => {
    const state = base();
    stockBarn(state, WHEAT, 'wheat', 12);
    const move: Move = { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } };
    let s = apply(data, state, move).state;
    s.turn = freshTurn();
    s.turnPlayer = WHEAT;
    s = apply(data, s, move).state;
    s.turn = freshTurn();
    s.turnPlayer = WHEAT;
    expect(legalMoves(data, s).some((m) => m.type === 'deliver' && m.tile === 'A1')).toBe(false);
    expect(() => apply(data, s, move)).toThrow(/no delivery slots/);
  });

  /**
   * The wild substitution: "when you pay the island, any single card it asks for
   * may instead be paid with 2 cards of any crops".
   *
   * The testkit island puts [wheat, wheat] on A1, so A1 wants 4 wheat. That
   * gives the payment shapes the rule creates - 4 wheat, 3 wheat + 2 anything,
   * and 8 anything - and lets the parity trap it exists to break be shown
   * directly: a barn holding THREE wheat used to be worth nothing against A1.
   */
  it('pays a demanded card with 2 of any crops, at every shape', () => {
    const exact = base();
    stockBarn(exact, WHEAT, 'wheat', 4);
    expect(apply(data, exact, deliverA1({ wheat: 4 })).state.players[WHEAT]!.barn).toHaveLength(0);

    // One card short, which is the 84% case, and it now delivers.
    const half = base();
    stockBarn(half, WHEAT, 'wheat', 3);
    stockBarn(half, WHEAT, 'apiary', 2);
    expect(anyDeliverOption(data, half, WHEAT)).toBe(true);
    apply(data, half, deliverA1({ wheat: 3, apiary: 2 }));

    // No wheat at all: every demanded card substituted, 8 of anything. The flat
    // island caps that at 8 - it used to be 12 at a Level 3 tile.
    const none = base();
    stockBarn(none, WHEAT, 'apiary', 6);
    stockBarn(none, WHEAT, 'orchard', 2);
    apply(data, none, deliverA1({ apiary: 6, orchard: 2 }));

    // And the rate is a real price, so short change is still refused.
    expect(() => apply(data, half, deliverA1({ wheat: 3, apiary: 1 }))).toThrow(/does not pay/);
  });

  it('offers substituted payments as real moves, deduped, and never over-substitutes', () => {
    const s = base();
    stockBarn(s, WHEAT, 'wheat', 3);
    stockBarn(s, WHEAT, 'apiary', 2);
    const spends = deliverOptions(data, s, WHEAT)
      .filter((o) => o.tile === 'A1')
      .map((o) => JSON.stringify(o.spend));
    // Exactly one: the minimum substitution, and the only surplus it can draw
    // filler from is the pair of apiary. Paying more when 5 cards will do is
    // legal but strictly worse, so it is not offered.
    expect(spends).toEqual([JSON.stringify({ wheat: 3, apiary: 2 })]);
    expect(new Set(spends).size).toBe(spends.length);
  });

  it('cardsPerSubstitution null restores exact matching - the control arm', () => {
    const strict = loadGameData({
      name: 'no-wild-substitution',
      schemaVersion: 1,
      set: { 'island.cardsPerSubstitution': null },
    });
    const s = makeState(strict, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 3);
    stockBarn(s, WHEAT, 'apiary', 2);
    expect(anyDeliverOption(strict, s, WHEAT)).toBe(false);
    expect(() =>
      apply(strict, s, {
        type: 'deliver',
        seat: WHEAT,
        tile: 'A1',
        spend: { wheat: 3, apiary: 2 },
      }),
    ).toThrow(/ONE suit/);
  });

  /**
   * The flat island's one gradient, and the properties that make it the rule
   * rather than an implementation detail:
   *  - it is PER TILE, so a rival taking your tile costs you 3 VP while a rival
   *    taking a different tile costs you nothing. That is what makes it a race
   *    over a specific square of board rather than a queue you join;
   *  - it is the WHOLE receipt, not a bonus on top of a printed value. There is
   *    nothing left to add it to;
   *  - it never runs out and never reaches zero, so no delivery is a dead move.
   */
  it('the receipt is decided by arrival order at that tile, per tile', () => {
    const s = base();
    stockBarn(s, WHEAT, 'wheat', 8);
    stockBarn(s, ORCHARD, 'wheat', 8);
    const deliver = (seat: number, tile: string) => ({
      type: 'deliver' as const,
      seat,
      tile,
      spend: { wheat: 4 },
    });
    const nextTurn = (state: GameState, seat: number) => {
      state.turn = freshTurn();
      state.turnPlayer = seat;
      return state;
    };

    // Wheat gets to A1 first: the head of the schedule.
    let g = apply(data, s, deliver(WHEAT, 'A1')).state;
    expect(g.players[WHEAT]!.receipts).toEqual([6]);

    // Orchard goes to a DIFFERENT tile and is first there, so it takes 6 too.
    // Under the old level queue this was the second delivery to Level 1 and
    // would have been docked; per tile, it is not.
    g = apply(data, nextTurn(g, ORCHARD), deliver(ORCHARD, 'A2')).state;
    expect(g.players[ORCHARD]!.receipts).toEqual([6]);

    // Orchard follows Wheat onto A1: second at that tile, so 3.
    g = apply(data, nextTurn(g, ORCHARD), deliver(ORCHARD, 'A1')).state;
    expect(g.players[ORCHARD]!.receipts).toEqual([6, 3]);

    // And Wheat following Orchard onto A2 is second there, also 3 - the schedule
    // is a property of the tile, not of the player or of how late it is.
    g = apply(data, nextTurn(g, WHEAT), deliver(WHEAT, 'A2')).state;
    expect(g.players[WHEAT]!.receipts).toEqual([6, 3]);
  });

  it('island.vpByDeliveryOrder is the schedule AND the capacity - the control arm', () => {
    const flat = loadGameData({
      name: 'flat-receipts',
      schemaVersion: 1,
      set: { 'island.vpByDeliveryOrder': [5, 4] },
    });
    const s = makeState(flat, ['wheat', 'orchard']);
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(flat, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.players[WHEAT]!.receipts).toEqual([5]);

    // Shortening the array closes a delivery space - and, since v31, deals one
    // fewer meeple. There is no second knob to keep in step, which is the reason
    // it is one array.
    const single = loadGameData({
      name: 'one-delivery-per-tile',
      schemaVersion: 1,
      set: { 'island.vpByDeliveryOrder': [6] },
    });
    const t = makeState(single, ['wheat', 'orchard']);
    expect(t.island.tiles.every((tile) => tile.meeples.length === 1)).toBe(true);
    stockBarn(t, WHEAT, 'wheat', 8);
    const u = apply(single, t, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A1',
      spend: { wheat: 4 },
    }).state;
    u.turn = freshTurn();
    u.turnPlayer = WHEAT;
    expect(legalMoves(single, u).some((m) => m.type === 'deliver' && m.tile === 'A1')).toBe(false);
  });

  /**
   * No hierarchy (2026-08-09). The level gate is deleted, not switched off, so
   * every tile on the board is deliverable from the first turn - which is the
   * change a player notices first.
   */
  it('every tile is open from the first turn, whatever its printed row', () => {
    // Testkit island at 2 seats: A1/A2/A5 row 1, B1/B4 row 2, D1 row 3. Stock
    // every demand, so the only thing that could refuse a tile is a rule.
    const s = base();
    // The testkit demand pool spans the in-play suits, so stock all of them
    // rather than naming crops: which colour lands on D1 is a property of the
    // pool order, not of this test.
    for (const suit of s.suitsInPlay) stockBarn(s, WHEAT, suit, 8);
    const rows = new Set(
      legalMoves(data, s)
        .filter((m) => m.type === 'deliver')
        .map((m) => tileLevel(data, m.tile)),
    );
    expect(rows).toEqual(new Set([1, 2, 3]));

    // Including the top row on a seat's very first delivery, which the gate
    // used to make impossible.
    const top = legalMoves(data, s).find((m) => m.type === 'deliver' && m.tile === 'D1');
    expect(top).toBeDefined();
    const out = apply(data, s, top as Move);
    expect(out.state.players[WHEAT]!.receipts).toEqual([6]);
  });

  it('a balloon move is not an island delivery, so it never arms the clock', () => {
    // The freight branch of Deliver (DL-12) never touches the island, so it
    // takes no receipt space, claims no meeple, and does not count toward the
    // end trigger.
    const s = makeState(data, ['vegetable', 'wheat']);
    stockBarn(s, 0, 'wheat', 1);
    stockBarn(s, 0, 'apiary', 1);
    const move = legalMoves(data, s).find((m) => m.type === 'moveBalloon');
    expect(move).toBeDefined();
    const after = apply(data, s, move as Move).state;
    expect(after.island.tiles.every((t) => t.deliveredBy.length === 0)).toBe(true);
    expect(after.players[0]!.receipts).toEqual([]);
    expect(Object.values(after.players[0]!.meeples)).toEqual([0, 0, 0, 0, 0]);
  });

  it('pass is offered only when no main action is legal', () => {
    const state = base();
    expect(legalMoves(data, state).some((m) => m.type === 'pass')).toBe(false);
    // Empty every deck and discard: no draw, and an empty hand allows nothing
    // else - including both halves of the bonus slot, since the free Draw 1
    // needs a live deck and a visit needs a card to place.
    for (const suit of data.cards.suits) {
      state.decks[suit] = [];
      state.discards[suit] = [];
    }
    const moves = legalMoves(data, state);
    expect(moves.some((m) => m.type === 'pass')).toBe(true);
    expect(moves.filter((m) => m.type !== 'pass')).toHaveLength(0);
  });
});

describe('the bonus slot through apply', () => {
  /**
   * ⭐ THE VISIT IS ONE CARD FOR ONE ACTION (v31). No mode, no coin, no wage:
   * what the visitor gets is the host's suit action, and what the host gets is a
   * card on their board that they will harvest into their own barn.
   */
  it('a visit places the fee on the host board and runs that board suit action', () => {
    const state = base();
    dealTo(data, state, WHEAT, 'W4', 'W5');
    const applied = apply(data, state, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: 'W4',
    });
    expect(noticeBoard(applied.state, ORCHARD).stack).toEqual(['W4']);
    expect(applied.state.turn.bonusUsed).toEqual(['visit']);
    // The Orchard door is Draw 3, the one printed exception in the roster.
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 3, keep: 3, pid: WHEAT });
    expect(applied.events).toContainEqual({
      e: 'visited',
      seat: WHEAT,
      host: ORCHARD,
      self: false,
      colour: 'orchard',
      action: 'draw',
    });
  });

  /**
   * ⭐ RISK 2 OF THE WHOLE PASS, ARMED ON PURPOSE. The self-visit is a solitaire
   * door bought with the same currency as the interaction door. Its only brake
   * is structural, and the second half of this test is that brake: your own card
   * counts toward your own threshold of 2, so feeding your board shuts it.
   */
  it('a seat may visit its own board, and doing so clogs its own door', () => {
    const state = base();
    dealTo(data, state, ORCHARD, 'O4', 'O5', 'O6');
    state.turnPlayer = ORCHARD;
    const first = apply(data, state, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O4' });
    expect(noticeBoard(first.state, ORCHARD).stack).toEqual(['O4']);
    expect(first.events).toContainEqual({
      e: 'visited',
      seat: ORCHARD,
      host: ORCHARD,
      self: true,
      colour: 'orchard',
      action: 'draw',
    });

    // Two cards and the board is full: nobody may place on it, the owner
    // included, until it is harvested.
    const s2 = first.state;
    s2.tasks = [];
    s2.turn = freshTurn();
    s2.turnPlayer = ORCHARD;
    const second = apply(data, s2, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O5' });
    const s3 = second.state;
    s3.tasks = [];
    s3.turn = freshTurn();
    s3.turnPlayer = ORCHARD;
    expect(legalMoves(data, s3).some((m) => m.type === 'visit' && m.host === ORCHARD)).toBe(false);
    expect(() =>
      apply(data, s3, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O6' }),
    ).toThrow(/is full/);
    // ⚠️ AND THE COST IS NOT ONLY THE DOOR. A clogged Notice Board is a FULL
    // building, so it is harvestable - which is how the owner reopens it, and
    // also the reason the Wheat door across the table has just become legal for
    // this seat when it was dead a moment ago. The brake and the unclog are the
    // same action.
    expect(legalMoves(data, s3).some((m) => m.type === 'harvest')).toBe(true);
  });

  it('selfVisitAllowed false is the paired control', () => {
    const noSelf = loadGameData({
      name: 'no-self-visit',
      schemaVersion: 1,
      set: { 'rules.turn.selfVisitAllowed': false },
    });
    const s = makeState(noSelf, ['wheat', 'orchard']);
    dealTo(noSelf, s, ORCHARD, 'O4');
    s.turnPlayer = ORCHARD;
    expect(legalMoves(noSelf, s).some((m) => m.type === 'visit' && m.host === ORCHARD)).toBe(false);
    expect(() =>
      apply(noSelf, s, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O4' }),
    ).toThrow(/switched off/);
  });

  /**
   * RULED (v31): a door that can do nothing is not offered. The visit costs a
   * card and returns an action, so a visit whose action is a no-op is strictly
   * dominated. Wheat's door is the one that refuses: Harvest needs a full
   * building.
   */
  it('never offers a visit to a door with nothing legal to do', () => {
    const s = base();
    dealTo(data, s, ORCHARD, 'O4');
    s.turnPlayer = ORCHARD;
    // Orchard has no full building, so the Wheat door (Harvest) is dead for it.
    expect(legalMoves(data, s).some((m) => m.type === 'visit' && m.host === WHEAT)).toBe(false);
    expect(() => apply(data, s, { type: 'visit', seat: ORCHARD, host: WHEAT, fee: 'O4' })).toThrow(
      /nothing legal/,
    );

    // Give it one and the same door opens.
    const board = noticeBoard(s, ORCHARD);
    board.stack = s.decks.orchard.splice(0, 2); // threshold 2: full
    expect(legalMoves(data, s).some((m) => m.type === 'visit' && m.host === WHEAT)).toBe(true);
  });

  /**
   * The SOLITAIRE half. It exists so the bonus slot is never dead - a seat with
   * an empty hand has no card to place - and it is the yardstick every door has
   * to beat, which is why the Orchard door is Draw 3 and not Draw 2.
   */
  it('the bonus Draw 1 is a real draw, spends the slot, and leaves the action alone', () => {
    const state = base();
    const applied = apply(data, state, { type: 'bonusDraw', seat: WHEAT });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 1, keep: 1, pid: WHEAT });
    expect(applied.state.turn.bonusUsed).toEqual(['draw']);
    expect(applied.state.turn.actionSpent).toBe(false);
    // One bonus a turn: the slot is genuinely gone, either half of it.
    let s = applied.state;
    while (s.tasks.length > 0) s = apply(data, s, legalMoves(data, s)[0] as Move).state;
    expect(s.players[WHEAT]!.hand).toHaveLength(1);
    expect(legalMoves(data, s).some((m) => m.type === 'bonusDraw')).toBe(false);
    expect(legalMoves(data, s).some((m) => m.type === 'visit')).toBe(false);
  });

  it('one bonus a turn, whichever half was taken', () => {
    const state = base();
    dealTo(data, state, WHEAT, 'W4', 'W5');
    const after = apply(data, state, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: 'W4',
    }).state;
    after.tasks = [];
    expect(legalMoves(data, after).some((m) => m.type === 'visit')).toBe(false);
    expect(legalMoves(data, after).some((m) => m.type === 'bonusDraw')).toBe(false);
  });
});

describe('the meeple phase', () => {
  /**
   * ⭐ A meeple performs its colour's plain action, free, and LEAVES THE GAME. It
   * is neither the action nor the bonus, so both are still there afterwards -
   * which is exactly the action inflation risk 1 of the v31 plan names.
   */
  it('spending a meeple runs its colour action and leaves the turn intact', () => {
    const s = base();
    giveMeeples(s, WHEAT, 'orchard');
    const applied = apply(data, s, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' });
    expect(applied.state.players[WHEAT]!.meeples.orchard).toBe(0);
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 3, keep: 3, pid: WHEAT });
    expect(applied.state.turn.actionSpent).toBe(false);
    expect(applied.state.turn.bonusUsed).toEqual([]);
    expect(applied.events).toContainEqual({
      e: 'meepleSpent',
      seat: WHEAT,
      colour: 'orchard',
      action: 'draw',
    });
  });

  it('any number may be spent, one at a time', () => {
    const s = base();
    giveMeeples(s, WHEAT, 'orchard', 2);
    let g = apply(data, s, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' }).state;
    while (g.tasks.length > 0) g = apply(data, g, legalMoves(data, g)[0] as Move).state;
    expect(g.players[WHEAT]!.meeples.orchard).toBe(1);
    expect(legalMoves(data, g).some((m) => m.type === 'spendMeeple')).toBe(true);
  });

  /**
   * The meeple phase is the VERY start of the turn: before the bonus and before
   * the action. `bonusUsed.length === 0` is the clause that stops a meeple being
   * held back and spent reactively later, which is the whole difference between
   * a supply of stored actions and a hand of free ones.
   */
  it('closes as soon as the bonus is taken', () => {
    const s = base();
    giveMeeples(s, WHEAT, 'orchard');
    const after = apply(data, s, { type: 'bonusDraw', seat: WHEAT }).state;
    after.tasks = [];
    expect(after.players[WHEAT]!.meeples.orchard).toBe(1);
    expect(legalMoves(data, after).some((m) => m.type === 'spendMeeple')).toBe(false);
    expect(() =>
      apply(data, after, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' }),
    ).toThrow(/start of your turn/);
  });

  it('a meeple whose action can do nothing is not offered, and can die unspent', () => {
    const s = base();
    // A wheat meeple performs Harvest, and this seat has no full building.
    giveMeeples(s, ORCHARD, 'wheat');
    s.turnPlayer = ORCHARD;
    expect(legalMoves(data, s).some((m) => m.type === 'spendMeeple')).toBe(false);
    expect(() => apply(data, s, { type: 'spendMeeple', seat: ORCHARD, colour: 'wheat' })).toThrow(
      /can do anything/,
    );
  });

  it('a meeple of a suit nobody is farming still works', () => {
    // Dairy is not at the table, so no Notice Board grants Build - but the
    // action exists, so the meeple does too.
    const s = base();
    giveMeeples(s, WHEAT, 'dairy');
    dealTo(data, s, WHEAT, ...s.decks.wheat.slice(0, 4));
    const applied = apply(data, s, { type: 'spendMeeple', seat: WHEAT, colour: 'dairy' });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'build', pid: WHEAT });
  });
});

describe('the turn boundary', () => {
  /**
   * ⚠️ INVERTED 19/08/2026, and the inversion is the point of the rule.
   *
   * This used to assert that the kept card funded a visit and so the turn WAITED
   * for the bonus slot to be spent or declined. With the slot start-of-turn only
   * (`bonusOpen` = unspent AND the action untaken), an unspent slot can no
   * longer hold anything open: past the action there is nothing to wait for, so
   * the turn settles on its own and `endTurn` is not needed.
   */
  it('ends the turn by itself once the action is done, because the slot is already shut', () => {
    const state = base();
    const applied = apply(data, state, { type: 'draw', seat: WHEAT });
    // Resolve the draw: pick a deck twice, then keep both.
    let s = applied.state;
    while (s.tasks.length > 0) {
      const moves = legalMoves(data, s);
      s = apply(data, s, moves[0] as Move).state;
    }
    // The kept cards WOULD have funded a visit. They cannot now: the action is
    // spent, so the window is shut and the turn has already passed on.
    expect(s.turnPlayer).toBe(ORCHARD);
  });

  /**
   * ⭐ THE END-OF-TURN DISCARD, BACK AT A FLAT 12 (02/09/2026).
   *
   * v31 deleted the hand limit and this suite lost four tests with it. The
   * reinstatement is deliberately a different rule from the one that was
   * deleted - `rules.turn.handLimit`, one global number, and the Barn still
   * prints nothing - so these are new tests rather than restored ones, and they
   * pin the three things that make it a rule rather than a number:
   *
   *   1. the boundary discards the OVERFLOW ONLY, and the seat chooses which;
   *   2. a hand AT the limit is not over it, so nothing queues;
   *   3. the limit is checked at the boundary and NOWHERE ELSE, which is what
   *      lets a card sow a whole hand or empty one into a barn mid-turn.
   *
   * Why the rule came back at all is on `RulesFile.turn.handLimit`, and it is
   * worth reading before anybody deletes it again: the limit was also the only
   * bound on the build-payment enumerator, and without it a 2-seat position
   * reached 116,535 legal moves.
   */
  it('discards down to the hand limit at the boundary, and only the overflow', () => {
    const state = base();
    const limit = data.rules.turn.handLimit as number;
    dealTo(data, state, WHEAT, ...state.decks.wheat.slice(0, limit + 2));
    state.turn.actionSpent = true;
    const applied = apply(data, state, { type: 'endTurn', seat: WHEAT });
    // The boundary SUSPENDS on the discard rather than completing: the seat
    // picks which cards go, so the turn cannot advance until it has answered.
    expect(applied.state.tasks).toHaveLength(1);
    expect(applied.state.tasks[0]).toMatchObject({ t: 'discard', pid: WHEAT, downTo: limit });
    expect(applied.state.turnPlayer).toBe(WHEAT);

    const answers = legalMoves(data, applied.state);
    expect(answers.length).toBeGreaterThan(0);
    const done = apply(data, applied.state, answers[0] as Move).state;
    expect(done.players[WHEAT]!.hand).toHaveLength(limit);
    expect(done.discards.wheat).toHaveLength(2);
    expect(done.turnPlayer).toBe(ORCHARD);
  });

  it('queues nothing for a hand exactly at the limit', () => {
    const state = base();
    const limit = data.rules.turn.handLimit as number;
    dealTo(data, state, WHEAT, ...state.decks.wheat.slice(0, limit));
    state.turn.actionSpent = true;
    const applied = apply(data, state, { type: 'endTurn', seat: WHEAT });
    expect(applied.state.tasks).toHaveLength(0);
    expect(applied.state.players[WHEAT]!.hand).toHaveLength(limit);
    expect(applied.state.turnPlayer).toBe(ORCHARD);
  });

  /**
   * The rule in one assertion: YOU MAY EXCEED THE LIMIT MID-TURN. Nothing in
   * the action funnels reads it, so a seat holding more than the limit can still
   * draw - and it has to be able to, because O14 sows a whole hand and then
   * draws 4, and W10 empties one into the barn. The limit is a boundary check,
   * not a cap on holding.
   */
  it('lets a seat draw past the limit mid-turn', () => {
    const state = base();
    const limit = data.rules.turn.handLimit as number;
    dealTo(data, state, WHEAT, ...state.decks.wheat.slice(0, limit));
    let s = apply(data, state, { type: 'draw', seat: WHEAT }).state;
    while (s.tasks.length > 0) {
      const moves = legalMoves(data, s);
      s = apply(data, s, moves[0] as Move).state;
    }
    // The draw was allowed, the overflow was taken at the boundary, and the two
    // together are the rule: nothing refused the draw, the discard priced it.
    expect(s.turnPlayer).toBe(ORCHARD);
    expect(s.players[WHEAT]!.hand).toHaveLength(limit);
  });

  /**
   * null is the control arm, and it restores exactly the v31 behaviour this
   * change reversed. It is asserted rather than assumed because the whole
   * reinstatement is a knob, and a knob whose off position is untested is a
   * control arm nobody can trust.
   */
  it('queues nothing at all when the limit knob is null', () => {
    const noLimit = loadGameData({
      name: 'no-hand-limit',
      description: 'The v31 control: no hand limit at all.',
      schemaVersion: 1,
      set: { 'rules.turn.handLimit': null },
    });
    const state = makeState(noLimit, ['wheat', 'orchard']);
    dealTo(noLimit, state, WHEAT, ...state.decks.wheat.slice(0, 18));
    state.turn.actionSpent = true;
    const applied = apply(noLimit, state, { type: 'endTurn', seat: WHEAT });
    expect(applied.state.tasks).toHaveLength(0);
    expect(applied.state.players[WHEAT]!.hand).toHaveLength(18);
    expect(applied.state.turnPlayer).toBe(ORCHARD);
  });
});

describe('views and redaction', () => {
  it('viewFor hides rival hands, deck order and barn identity', () => {
    const state = base();
    dealTo(data, state, ORCHARD, 'O5', 'O6');
    stockBarn(state, ORCHARD, 'orchard', 2);
    const view = viewFor(data, state, WHEAT);
    expect(view.rivals[0]).toMatchObject({ seat: ORCHARD, handCount: 2, barnCount: 2 });
    // The rival panel carries no hand or barn card ids.
    expect(JSON.stringify(view.rivals)).not.toContain('"O5"');
    expect(JSON.stringify(view.rivals)).not.toContain('"O6"');
    expect(view.decks.wheat).toBeTypeOf('number');
  });

  it('meeple supplies are public, both your own and a rival s', () => {
    const state = base();
    giveMeeples(state, ORCHARD, 'dairy', 2);
    giveMeeples(state, WHEAT, 'wheat');
    const view = viewFor(data, state, WHEAT);
    expect(view.you.meeples.wheat).toBe(1);
    expect(view.rivals[0]?.meeples.dairy).toBe(2);
  });

  /**
   * A face-down demand token is PUBLIC. It sits on the board as a visible blank,
   * so it must cross the view boundary unredacted for every seat - and the
   * failure mode the Vegetable rebuild's ticket names is precisely a swap that
   * renders correctly for the acting seat and wrongly for everybody else.
   * `viewFor` spreads the tile, so this holds by construction; asserting it is
   * what stops a future redaction pass quietly dropping the flag. The same
   * applies to the meeples, which are face up from setup.
   */
  it('shows a face-down demand token and every meeple to every seat', () => {
    const state = base();
    const tile = state.island.tiles[0]!;
    tile.faceDown = tile.crates.map((_, i) => i === 0);
    for (let seat = 0; seat < state.players.length; seat++) {
      const seen = viewFor(data, state, seat).island.tiles.find((t) => t.tile === tile.tile);
      expect(seen?.faceDown, `seat ${seat}`).toEqual(tile.faceDown);
      expect(seen?.crates, `seat ${seat}`).toEqual(tile.crates);
      expect(seen?.meeples, `seat ${seat}`).toEqual(tile.meeples);
    }
  });

  it('redactEvents masks ids down to their suit letter for other seats', () => {
    const events: GameEvent[] = [
      { e: 'cardsToHand', seat: ORCHARD, cards: ['O5'] },
      { e: 'cardPlaced', seat: ORCHARD, onto: { seat: WHEAT, building: 'W3' }, card: 'O6' },
      { e: 'harvested', seat: WHEAT, building: 'W4', cards: ['W5'] },
    ];
    const mine = redactEvents(events, ORCHARD);
    expect(mine[0]).toMatchObject({ cards: ['O5'] });
    const theirs = redactEvents(events, WHEAT);
    expect(theirs[0]).toMatchObject({ cards: ['O?'] });
    expect(theirs[1]).toMatchObject({ card: 'O?' });
    expect(theirs[2]).toMatchObject({ cards: ['W?'] }); // barns are anonymous even to the owner
  });
});

describe('scoring', () => {
  /**
   * ⭐ THE TIE-BREAK CHANGED IN v31 (§1.3): total VP, then CARDS IN HAND PLUS
   * BARN, then receipt count, then seat order. It was coins remaining; with no
   * currency, cards are the only stock a player still ends the game holding.
   *
   * Deliberately NOT unspent meeples - paying for holding one would reward not
   * spending it, which is the mistake the coin pity rate was deleted for.
   */
  it('ranks by VP, then cards in hand plus barn', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(6);
    state.players[ORCHARD]!.receipts.push(6); // tied on VP
    dealTo(data, state, ORCHARD, 'O5', 'O6'); // two more cards of stock
    stockBarn(state, WHEAT, 'wheat', 1);
    const result = score(data, state);
    expect(result.seats[WHEAT]!.total).toBe(result.seats[ORCHARD]!.total);
    expect(result.ranking).toEqual([ORCHARD, WHEAT]);
  });

  it('the hand and the barn count together, not separately', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(6);
    state.players[ORCHARD]!.receipts.push(6);
    dealTo(data, state, WHEAT, 'W4', 'W5'); // 2 in hand, 0 in barn
    stockBarn(state, ORCHARD, 'orchard', 3); // 0 in hand, 3 in barn
    expect(score(data, state).ranking).toEqual([ORCHARD, WHEAT]);
  });

  it('falls through to receipt count when VP and stock both tie', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(6); // 6 VP from one receipt
    state.players[ORCHARD]!.receipts.push(3, 3); // 6 VP from two
    const result = score(data, state);
    expect(result.seats[WHEAT]!.total).toBe(result.seats[ORCHARD]!.total);
    expect(result.ranking).toEqual([ORCHARD, WHEAT]);
  });

  it('meeples are worth no VP, spent or held', () => {
    const state = base();
    giveMeeples(state, WHEAT, 'dairy', 4);
    const result = score(data, state);
    expect(result.seats[WHEAT]!.total).toBe(0);
  });

  /**
   * The Farmstead's end-game VP needs no scoring machinery: `gameEndScores`
   * already walks every built card's `gameEnd` formula. This pins the seam
   * itself - printed VP, receipts and the end-game line, and no fourth term.
   */
  it('has exactly three VP sources', () => {
    const state = base();
    buildFor(data, state, WHEAT, 'W4');
    state.players[WHEAT]!.receipts.push(6);
    const s = score(data, state).seats[WHEAT]!;
    expect(s.total).toBe(s.printed + s.receipts + s.endgame);
    expect(s.printed).toBe(cardById(data, 'W4').printedVp);
    expect(Object.keys(s).sort()).toEqual([
      'endgame',
      'endgameCards',
      'printed',
      'receipts',
      'total',
    ]);
  });
});

// --- full games ------------------------------------------------------------

const PRIORITY: Move['type'][] = [
  'task',
  'deliver',
  'harvest',
  'build',
  'spendMeeple',
  'grow',
  'draw',
  'visit',
  'bonusDraw',
  'cardMove',
  'pass',
  'endTurn',
];

/** Greedy delivery-first policy over legal moves, seeded ties. */
function pickMove(rng: [number, number, number, number], moves: Move[]): Move {
  for (const type of PRIORITY) {
    const of = moves.filter((m) => m.type === type);
    if (of.length > 0) return of[rngInt(rng, of.length)] as Move;
  }
  throw new Error('no move to pick');
}

/**
 * Every card id the game still holds, wherever it is - including the two places
 * a card can be in LIMBO, out of every pile and not yet anywhere.
 *
 * The limbo holders are the point of this function and the reason it is not
 * just "the zones". A `draw` task holds what it has revealed; the `divert` seam
 * holds a card on its way to a discard; and the Dairy rebuild added two more -
 * a `divertSpent` rider holds a build's payment between the build and the choice
 * of what goes to the barn, and D10's `scout` holds the revealed deck tops until
 * one is built and the rest go back. A card task's riders are untyped, so both
 * are read by their rider names.
 */
function inPlayCardIds(state: GameState): string[] {
  const ids: string[] = [];
  for (const suit of data.cards.suits) ids.push(...state.decks[suit], ...state.discards[suit]);
  for (const p of state.players) {
    ids.push(...p.hand, ...p.barn);
    for (const b of p.tableau) ids.push(b.card, ...b.stack);
  }
  for (const task of state.tasks) {
    if (task.t === 'draw') ids.push(...task.revealed);
    if (task.t === 'divert') ids.push(...task.cards);
    if (task.t === 'card') {
      for (const key of ['cards', 'revealed']) {
        const held = task.riders[key];
        if (Array.isArray(held)) ids.push(...(held as string[]));
      }
    }
  }
  return ids;
}

function playFullGame(seed: string, seats: number, suits: Suit[]) {
  let state = newGame(data, { seats, suits, seed });
  const expectedCards = inPlayCardIds(state).length;
  const rng = seedRng(`policy:${seed}`);
  const moveLog: Move[] = [];
  let maxMoves = 0;

  for (let step = 0; step < 6000; step++) {
    if (isOver(state)) {
      return { state, moveLog, maxMoves };
    }
    const moves = legalMoves(data, state);
    expect(moves.length).toBeGreaterThan(0);
    // ⚠️ THIS CEILING IS THE HAND LIMIT'S ALARM, AND IT SHOULD HAVE FIRED.
    // `buildOptions` enumerates every k-subset of the hand per buildable card,
    // so the move list grows as C(hand, cost); the only thing bounding the hand
    // is `rules.turn.handLimit`. v31 deleted the limit and this assertion was
    // relaxed rather than believed - the real games then reached 116,535 legal
    // moves in one position and cost minutes each. The limit came back on
    // 02/09/2026 at a flat 12, where the worst payment enumeration is C(11, 4) =
    // 330. If this trips again, the hand has escaped its limit somewhere: fix
    // that, do not raise the number.
    expect(moves.length).toBeLessThan(4000);
    maxMoves = Math.max(maxMoves, moves.length);
    const move = pickMove(rng, moves);
    state = apply(data, state, move).state;
    moveLog.push(move);
    if (step % 50 === 0) {
      const ids = inPlayCardIds(state);
      expect(ids.length).toBe(expectedCards);
      expect(new Set(ids).size).toBe(expectedCards);
    }
  }
  throw new Error(`Game ${seed} did not reach the end trigger in 6000 moves`);
}

describe('full games', () => {
  it('plays a seeded 2-player game to the six-delivery end trigger', () => {
    const { state, maxMoves } = playFullGame('game-a', 2, ['wheat', 'orchard']);
    expect(maxMoves).toBeLessThan(4000);
    expect(state.phase).toBe('ended');
    expect(state.endTrigger).not.toBeNull();
    // Read the level off the island, not off the receipt values: a receipt is
    // now flat (6 first, 3 second) at every tile, so VP alone cannot tell a
    // Level 3 tile apart from any other.
    expect(
      state.island.tiles.some((t) => tileLevel(data, t.tile) === 3 && t.deliveredBy.length > 0),
    ).toBe(true);
    expect(legalMoves(data, state)).toEqual([]);
    expect(score(data, state).ranking).toHaveLength(2);
  });

  it('plays a 3-player game with Vegetable in play to the end', () => {
    const { state } = playFullGame('game-b', 3, ['vegetable', 'wheat', 'apiary']);
    expect(state.phase).toBe('ended');
    expect(state.aerodrome).not.toBeNull();
  });

  it('replays (seed, move list) to a bit-identical final state', () => {
    const { state, moveLog } = playFullGame('game-c', 2, ['dairy', 'apiary']);
    let replayed = newGame(data, { seats: 2, suits: ['dairy', 'apiary'], seed: 'game-c' });
    for (const move of moveLog) replayed = apply(data, replayed, move).state;
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(state));
  });

  it('rejects moves legalMoves does not offer', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: 'illegal' });
    expect(() => apply(data, state, { type: 'harvest', seat: 0, building: 'W4' })).toThrow();
    expect(() => apply(data, state, { type: 'endTurn', seat: 0 })).toThrow();
    expect(() =>
      apply(data, state, { type: 'deliver', seat: 0, tile: 'A1', spend: { wheat: 2 } }),
    ).toThrow();
    expect(() => apply(data, state, { type: 'spendMeeple', seat: 0, colour: 'wheat' })).toThrow();
  });
});
