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
 * about the island or the end trigger changed. (The wild substitution, the
 * balloons and the Village Store were deleted on 16/09/2026.)
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
import {
  buildFor,
  cardVisitGame,
  dealTo,
  deliveredAt,
  giveMeeples,
  makeState,
  meepleEconomyGame,
  noMeeples,
} from './testkit.js';
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

/**
 * THE MEEPLE ECONOMY, the game as it shipped from 05/09 to 09/09/2026, for the
 * cases whose subject is a MEEPLE. The commons deletes the component outright
 * (C6), so the island seed, the supply and the (absent) cap have no subject in
 * the shipped game and are asserted on the arm that still has one.
 */
const meepleArm = meepleEconomyGame();

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
      // ⛔ NO MEEPLES AT ALL (C6, 09/09/2026). The meeple loop dealt one of each
      // colour as its ignition and the commons deletes the component outright:
      // no starting supply, no island seed, no spend and no Collect. The keys
      // survive at zero because `PlayerState.meeples` is still typed - the two
      // meeple CONTROLS need it - and `meeple-loop.test.ts` is where the deal
      // itself is now asserted.
      expect(Object.values(p.meeples)).toEqual([0, 0, 0, 0, 0]);
      // THREE starters (Barn, Farmstead, Notice Board) plus, at two seats since
      // 13/09/2026, a second Notice Board drawn from an unfarmed suit.
      expect(p.tableau).toHaveLength(4);
      // Own deck holds 14 after dealing the hand; nothing else is dealt.
      expect(state.decks[p.suit]).toHaveLength(14);
      for (const id of p.hand) expect(cardById(data, id).suit).toBe(p.suit);
    }
    const passive = state.suitsInPlay[2] as Suit;
    expect(state.decks[passive]).toHaveLength(18);
    // Bookend rule at 2 seats: A1 A2 A5 / B1 B4 / D1.
    expect(state.island.tiles.map((t) => t.tile)).toEqual(['A1', 'A2', 'A5', 'B1', 'B4', 'D1']);
    // ⭐ THE TOKEN ISLAND (16/09/2026): 12 tokens, two per tile, one per crop in
    // play per VP value and no wilds at two seats.
    const tokens = state.island.tiles.flatMap((t) => t.tokens);
    expect(tokens).toHaveLength(12);
    for (const t of state.island.tiles) expect(t.tokens).toHaveLength(2);
    for (const tok of tokens) {
      expect(tok.demand !== 'wild' && state.suitsInPlay.includes(tok.demand)).toBe(true);
    }
    for (const crop of state.suitsInPlay) {
      expect(
        tokens
          .filter((t) => t.demand === crop)
          .map((t) => t.vp)
          .sort(),
        crop,
      ).toEqual([3, 4, 5, 6]);
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
   * ⭐ THE WORKERS (the delivery meeple on the token island, 16/09/2026): one on
   * every 3 and 4 VP token and none on the 5 and 6, drawn from a bag of 25 that
   * is NOT filtered by who is at the table.
   */
  it('puts a Worker on every 3 and 4 VP token and on no other', () => {
    const state = newGame(data, { seats: 2, suits: ['wheat', 'apiary'], seed: 'meeples' });
    const tokens = state.island.tiles.flatMap((t) => t.tokens);
    for (const tok of tokens) {
      expect(tok.worker !== null, `${tok.demand} ${tok.vp}`).toBe(tok.vp <= 4);
    }
    expect(tokens.filter((t) => t.worker !== null)).toHaveLength(6);
    const before = loadGameData({
      name: 'pre-delivery-meeple',
      schemaVersion: 1,
      set: { 'island.tokens.workerOnVp': [] },
    });
    const old = newGame(before, { seats: 2, suits: ['wheat', 'apiary'], seed: 'meeples' });
    expect(old.island.tiles.flatMap((t) => t.tokens).filter((t) => t.worker !== null)).toEqual([]);
    expect(meeplePool(data)).toHaveLength(data.island.meeples.poolSize);
  });

  /**
   * The seat scaling of worksheet `Island`: 9 tiles and 18 tokens with 2 wilds
   * at three seats, 12 and 24 with 4 wilds at four. ⚠️ BUILDER DEFAULT: at
   * three seats WHICH two wild values are used is drawn from the seed.
   */
  it('scales the token pool by seat count, wilds included', () => {
    const three = newGame(data, { seats: 3, suits: ['wheat', 'apiary', 'dairy'], seed: 'three' });
    const t3 = three.island.tiles.flatMap((t) => t.tokens);
    expect(three.island.tiles).toHaveLength(9);
    expect(t3).toHaveLength(18);
    expect(t3.filter((t) => t.demand === 'wild')).toHaveLength(2);
    const four = newGame(data, {
      seats: 4,
      suits: ['wheat', 'apiary', 'orchard', 'dairy'] as Suit[],
      seed: 'big',
    });
    const t4 = four.island.tiles.flatMap((t) => t.tokens);
    expect(four.island.tiles).toHaveLength(12);
    expect(t4).toHaveLength(24);
    expect(
      t4
        .filter((t) => t.demand === 'wild')
        .map((t) => t.vp)
        .sort(),
    ).toEqual([3, 4, 5, 6]);
    // Half of all tokens carry a Worker at four seats: 12 of the bag's 25.
    expect(t4.filter((t) => t.worker !== null)).toHaveLength(12);
    expect(data.island.meeples.poolSize).toBe(25);
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
   * ⛔ REVERSED AGAIN (Dean, C2, 09/09/2026), and this case has now swung twice
   * in a week, so read the history rather than the assertion. 19/08/2026: bonus
   * FIRST. 03/09/2026: bonus LAST, called "a correction, not an experiment".
   * 09/09/2026: bonus FIRST again, on Dean's reason that a turn visibly ends on
   * the main action. `'end'` is the paired control now, asserted below.
   *
   * ⭐ THE PRICE OF THE REVERSAL IS WORTH KNOWING: under `'start'` a board can
   * FUEL the action after it (play onto the orchard board for Draw 2, then
   * Build), and the action can no longer set a board up - fill a building, then
   * harvest it. The door mix should move, not only the play rate.
   *
   * Set here rather than reached through a real action because every main action
   * pushes a task, and a pending task suppresses the whole move list.
   */
  it('the bonus slot is open before the main action, and shut after it', () => {
    const open = base();
    dealTo(data, open, WHEAT, 'W4');
    expect(open.turn.bonusUsed).toEqual([]);
    expect(legalMoves(data, open).some((m) => m.type === 'visit')).toBe(true);

    const shut = base();
    dealTo(data, shut, WHEAT, 'W4');
    shut.turn.actionSpent = true;
    expect(legalMoves(data, shut).some((m) => m.type === 'visit')).toBe(false);
    // ⛔ AND THE OTHER OPTIONS ARE GONE IN BOTH POSITIONS (S5): no turn-start
    // meeple phase, no Collect and no free Draw 1.
    for (const state of [open, shut]) {
      const types = new Set(legalMoves(data, state).map((m) => m.type));
      expect(types.has('spendMeeple')).toBe(false);
      expect(types.has('collect')).toBe(false);
      expect(types.has('bonusDraw')).toBe(false);
    }
  });

  /**
   * THE PAIRED CONTROLS: `bonusTiming: 'end'` is the rule the engine carried
   * from 03/09/2026 to 09/09/2026, and `'any'`
   * is v14's once-per-turn-at-any-point. Asserted so that an arm switching the
   * knob cannot silently stop switching the rule.
   */
  it('bonusTiming end and any are the paired controls', () => {
    const endRules = {
      ...data,
      rules: { ...data.rules, turn: { ...data.rules.turn, bonusTiming: 'end' as const } },
    };
    const top = base();
    dealTo(data, top, WHEAT, 'W4');
    expect(legalMoves(endRules, top).some((m) => m.type === 'visit')).toBe(false);
    const acted = base();
    dealTo(data, acted, WHEAT, 'W4');
    acted.turn.actionSpent = true;
    expect(legalMoves(endRules, acted).some((m) => m.type === 'visit')).toBe(true);

    const anyRules = {
      ...data,
      rules: { ...data.rules, turn: { ...data.rules.turn, bonusTiming: 'any' as const } },
    };
    expect(legalMoves(anyRules, top).some((m) => m.type === 'visit')).toBe(true);
    expect(legalMoves(anyRules, acted).some((m) => m.type === 'visit')).toBe(true);
  });

  /**
   * ⭐ THE TOKEN ISLAND (Dean, R3, 16/09/2026). The testkit island at two seats,
   * dealt in pool order: A1 [wheat 6, wheat 5], A2 [wheat 4 + Worker, wheat 3 +
   * Worker], A5 [orchard 6, orchard 5], B1 [orchard 4, orchard 3], B4
   * [vegetable 6, vegetable 5], D1 [vegetable 4, vegetable 3], Workers from the
   * bag in colour order (wheat first).
   *
   * A FIRST delivery pays BOTH tokens' demands and CHOOSES which token to take;
   * the token leaves the tile, becomes a receipt that keeps its crop, and hands
   * over its Worker.
   */
  it('a first delivery pays both demands and takes the chosen token, with its Worker', () => {
    const state = base();
    stockBarn(state, WHEAT, 'wheat', 4);
    const choices = legalMoves(data, state).filter((m) => m.type === 'deliver' && m.tile === 'A2');
    // One payment, two tokens: the 4 VP token is offered first.
    expect(choices.map((m) => (m.type === 'deliver' ? m.token : null))).toEqual([0, 1]);
    const worker = state.island.tiles.find((t) => t.tile === 'A2')!.tokens[1]!.worker!;
    const held = state.players[WHEAT]!.meeples[worker];
    const out = apply(data, state, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A2',
      spend: { wheat: 4 },
      token: 1,
    });
    expect(out.state.players[WHEAT]!.receipts).toEqual([{ vp: 3, crop: 'wheat', tile: 'A2' }]);
    expect(out.state.players[WHEAT]!.barn).toHaveLength(0);
    expect(out.state.players[WHEAT]!.meeples[worker]).toBe(held + 1);
    expect(out.events).toContainEqual({
      e: 'meepleGained',
      seat: WHEAT,
      colour: worker,
      tile: 'A2',
      vp: 3,
    });
    const delivered = out.events.find((e) => e.e === 'delivered');
    expect(delivered).toMatchObject({ vp: 3, crop: 'wheat', tookHigher: false });
    const a2 = out.state.island.tiles.find((t) => t.tile === 'A2')!;
    expect(a2.tokens).toEqual([{ demand: 'wheat', vp: 4, worker: 'wheat' }]);
    expect(a2.deliveredBy).toEqual([WHEAT]);
    expect(out.state.endTrigger).toBeNull();
  });

  it('a token with no Worker pays VP alone', () => {
    const state = base();
    stockBarn(state, WHEAT, 'wheat', 4);
    const out = apply(data, state, { ...deliverA1({ wheat: 4 }), token: 0 } as Move);
    expect(out.state.players[WHEAT]!.receipts).toEqual([{ vp: 6, crop: 'wheat', tile: 'A1' }]);
    expect(out.events.some((e) => e.e === 'meepleGained')).toBe(false);
    expect(out.events.find((e) => e.e === 'delivered')).toMatchObject({ tookHigher: true });
  });

  /**
   * ⭐ THE SECOND DELIVERY pays the remaining token's demand PLUS 2 cards of ANY
   * crops (the revealed "2 any"), which may differ. The tile is then finished.
   */
  it('a second delivery pays the last token plus 2 of any crops, and finishes the tile', () => {
    const state = base();
    stockBarn(state, WHEAT, 'wheat', 4);
    const s = apply(data, state, { ...deliverA1({ wheat: 4 }), token: 0 } as Move).state;
    s.turn = freshTurn();
    s.turnPlayer = ORCHARD;
    noMeeples(s);
    stockBarn(s, ORCHARD, 'wheat', 2);
    stockBarn(s, ORCHARD, 'apiary', 1);
    stockBarn(s, ORCHARD, 'dairy', 1);
    const offered = deliverOptions(data, s, ORCHARD).filter((o) => o.tile === 'A1');
    expect(offered).toEqual([{ tile: 'A1', token: 0, spend: { wheat: 2, apiary: 1, dairy: 1 } }]);
    const out = apply(data, s, {
      type: 'deliver',
      seat: ORCHARD,
      tile: 'A1',
      spend: { wheat: 2, apiary: 1, dairy: 1 },
      token: 0,
    });
    expect(out.state.players[ORCHARD]!.receipts).toEqual([{ vp: 5, crop: 'wheat', tile: 'A1' }]);
    const a1 = out.state.island.tiles.find((t) => t.tile === 'A1')!;
    expect(a1.tokens).toEqual([]);
    expect(a1.deliveredBy).toEqual([WHEAT, ORCHARD]);
    // The pair is still owed in its crop.
    const t = apply(data, state, { ...deliverA1({ wheat: 4 }), token: 0 } as Move).state;
    t.turn = freshTurn();
    t.turnPlayer = ORCHARD;
    noMeeples(t);
    stockBarn(t, ORCHARD, 'wheat', 1);
    stockBarn(t, ORCHARD, 'apiary', 3);
    expect(deliverOptions(data, t, ORCHARD).some((o) => o.tile === 'A1')).toBe(false);
  });

  /**
   * THE CAP (R4), on the island side, under the meeple-economy control. ⛔
   * There is no cap any more (Dean, 05/09/2026), so a Worker of a colour the
   * seat already holds is KEPT and nothing is boxed.
   */
  it('keeps an island Worker of a colour the seat already holds: there is no cap (R4)', () => {
    const state = makeState(meepleArm, ['wheat', 'orchard']);
    const worker = state.island.tiles.find((t) => t.tile === 'A2')!.tokens[0]!.worker!;
    stockBarn(state, WHEAT, 'wheat', 4);
    giveMeeples(state, WHEAT, worker, 1);
    const held = state.players[WHEAT]!.meeples[worker];
    const out = apply(meepleArm, state, {
      type: 'deliver',
      seat: WHEAT,
      tile: 'A2',
      spend: { wheat: 4 },
      token: 0,
    });
    expect(out.state.players[WHEAT]!.meeples[worker]).toBe(held + 1);
    expect(out.events.some((e) => e.e === 'meepleBoxed')).toBe(false);
    expect(out.events).toContainEqual({
      e: 'meepleGained',
      seat: WHEAT,
      colour: worker,
      tile: 'A2',
      vp: 4,
    });
  });

  /**
   * The clock. One seat's Nth receipt ends the game, counted per seat - so a
   * rival racing does not arm your trigger.
   */
  it('the end fires on a sixth island delivery by ONE seat, not on six across the table', () => {
    const s = base();
    // Five for Wheat and five for Orchard, interleaved over the six 2-seat tiles.
    deliveredAt(s, WHEAT, 'A1', 'A2', 'A5', 'B1', 'B4');
    deliveredAt(s, ORCHARD, 'A1', 'A2', 'A5', 'B1', 'B4');
    expect(islandDeliveriesBy(s, WHEAT)).toBe(5);
    expect(s.endTrigger).toBeNull();

    // Stock exactly what D1's tokens ask for, so the sixth delivery does not
    // depend on the deal.
    const d1 = s.island.tiles.find((t) => t.tile === 'D1')!;
    for (const token of d1.tokens) {
      stockBarn(
        s,
        WHEAT,
        token.demand === 'wild' ? 'wheat' : token.demand,
        data.island.tileRule.cardsPerCrate,
      );
    }
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
    // The second pays wheat for the pair AND wheat for the 2 any.
    s = apply(data, s, move).state;
    expect(s.players[WHEAT]!.receipts.map((r) => r.vp)).toEqual([6, 5]);
    s.turn = freshTurn();
    s.turnPlayer = WHEAT;
    expect(legalMoves(data, s).some((m) => m.type === 'deliver' && m.tile === 'A1')).toBe(false);
    expect(() => apply(data, s, move)).toThrow(/no tokens left/);
  });

  /**
   * ⭐ NO WILD SUBSTITUTION (Dean, 16/09/2026, R4): a named token takes exactly
   * its crop. A1 wants 4 wheat, and a barn holding three wheat and two apiary
   * pays nothing.
   */
  it('pays a named token only with its own crop', () => {
    const exact = base();
    stockBarn(exact, WHEAT, 'wheat', 4);
    expect(apply(data, exact, deliverA1({ wheat: 4 })).state.players[WHEAT]!.barn).toHaveLength(0);

    const short = base();
    noMeeples(short);
    stockBarn(short, WHEAT, 'wheat', 3);
    stockBarn(short, WHEAT, 'apiary', 2);
    expect(anyDeliverOption(data, short, WHEAT)).toBe(false);
    expect(() => apply(data, short, deliverA1({ wheat: 3, apiary: 1 }))).toThrow(/does not pay/);
  });

  /**
   * ⭐ A WILD TOKEN TAKES ANY 2 CARDS (Dean, 15/09/2026): they may be of
   * different crops. A1 is re-dealt as [wheat 6, wild 5] for the case, and a
   * wild receipt keeps the crop 'wild'.
   */
  it('pays a wild token with any cards of any crops, and offers each mix', () => {
    const s = base();
    noMeeples(s);
    s.island.tiles.find((t) => t.tile === 'A1')!.tokens[1] = {
      demand: 'wild',
      vp: 5,
      worker: null,
    };
    stockBarn(s, WHEAT, 'wheat', 2);
    stockBarn(s, WHEAT, 'apiary', 1);
    stockBarn(s, WHEAT, 'orchard', 1);
    const spends = deliverOptions(data, s, WHEAT)
      .filter((o) => o.tile === 'A1' && o.token === 1)
      .map((o) => o.spend);
    expect(spends).toEqual([{ wheat: 2, apiary: 1, orchard: 1 }]);
    const out = apply(data, s, {
      ...deliverA1({ wheat: 2, apiary: 1, orchard: 1 }),
      token: 1,
    } as Move);
    expect(out.state.players[WHEAT]!.receipts).toEqual([{ vp: 5, crop: 'wild', tile: 'A1' }]);
    // The named wheat token is still owed in wheat.
    expect(() => apply(data, s, deliverA1({ wheat: 1, apiary: 1, orchard: 2 }))).toThrow(
      /does not pay/,
    );
  });

  it('the receipt is the token chosen, per tile, highest first when none is named', () => {
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
    const vps = (state: GameState, seat: number) => state.players[seat]!.receipts.map((r) => r.vp);

    let g = apply(data, s, deliver(WHEAT, 'A1')).state;
    expect(vps(g, WHEAT)).toEqual([6]);
    g = apply(data, nextTurn(g, ORCHARD), deliver(ORCHARD, 'A2')).state;
    expect(vps(g, ORCHARD)).toEqual([4]);
    g = apply(data, nextTurn(g, ORCHARD), deliver(ORCHARD, 'A1')).state;
    expect(vps(g, ORCHARD)).toEqual([4, 5]);
    g = apply(data, nextTurn(g, WHEAT), deliver(WHEAT, 'A2')).state;
    expect(vps(g, WHEAT)).toEqual([6, 3]);
  });

  it('island.tokens is the dial on what the tokens pay and carry', () => {
    const flat = loadGameData({
      name: 'flat-tokens',
      schemaVersion: 1,
      set: { 'island.tokens.vpValues': [5, 5, 4, 4], 'island.tokens.workerOnVp': [] },
    });
    const s = makeState(flat, ['wheat', 'orchard']);
    expect(s.island.tiles.flatMap((t) => t.tokens).every((t) => t.worker === null)).toBe(true);
    stockBarn(s, WHEAT, 'wheat', 4);
    const out = apply(flat, s, { type: 'deliver', seat: WHEAT, tile: 'A1', spend: { wheat: 4 } });
    expect(out.state.players[WHEAT]!.receipts.map((r) => r.vp)).toEqual([5]);
    // Equal VP: no token choice is recorded for the reading.
    expect(out.events.find((e) => e.e === 'delivered')).not.toHaveProperty('tookHigher');
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
    expect(out.state.players[WHEAT]!.receipts.map((r) => r.tile)).toEqual(['D1']);
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

/**
 * ⛔ THIS WHOLE BLOCK IS THE v31 CONTROL, NOT THE SHIPPED GAME. Dean ruled the
 * meeple loop in on 04/09/2026, so `rules.turn.visitCurrency` is `'meeple'` in
 * the base data and the card-fee visit lives behind
 * `overlays/v31-card-visit.overlay.json`. These tests were re-pointed at that
 * overlay rather than deleted, for the reason the overlay exists: the `'card'`
 * branch is a live arm and the control for every future comparison, and a
 * branch nothing runs is a branch that rots.
 *
 * The shipped bonus slot - Visit or Collect, paid in meeples - is proved in
 * `meeple-loop.test.ts`, and the block below this one pins the two shapes apart
 * so neither can quietly acquire the other's moves.
 */
describe('the bonus slot through apply - the v31 card-visit control', () => {
  const control = cardVisitGame();
  const controlBase = (): GameState => makeState(control, ['wheat', 'orchard']);
  const noticeBoard = (state: GameState, seat: number) => {
    const board = state.players[seat]?.tableau.find(
      (b) => cardById(control, b.card).slot === 'noticeboard',
    );
    if (!board) throw new Error(`seat ${seat} has no Notice Board`);
    return board;
  };

  /**
   * ⭐ THE VISIT IS ONE CARD FOR ONE ACTION (v31). No mode, no coin, no wage:
   * what the visitor gets is the host's suit action, and what the host gets is a
   * card on their board that they will harvest into their own barn.
   */
  it('a visit places the fee on the host board and runs that board suit action', () => {
    const state = controlBase();
    dealTo(control, state, WHEAT, 'W4', 'W5');
    state.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(control, state, {
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
    const state = controlBase();
    dealTo(control, state, ORCHARD, 'O4', 'O5', 'O6');
    state.turnPlayer = ORCHARD;
    state.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const first = apply(control, state, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O4' });
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
    s2.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    s2.turnPlayer = ORCHARD;
    const second = apply(control, s2, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O5' });
    const s3 = second.state;
    s3.tasks = [];
    s3.turn = freshTurn();
    s3.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    s3.turnPlayer = ORCHARD;
    expect(legalMoves(control, s3).some((m) => m.type === 'visit' && m.host === ORCHARD)).toBe(
      false,
    );
    expect(() =>
      apply(control, s3, { type: 'visit', seat: ORCHARD, host: ORCHARD, fee: 'O6' }),
    ).toThrow(/is full/);
    // ⚠️ AND THE COST IS NOT ONLY THE DOOR. A clogged Notice Board is a FULL
    // building, so it is harvestable - which is how the owner reopens it, and
    // also the reason the Wheat door across the table has just become legal for
    // this seat when it was dead a moment ago. The brake and the unclog are the
    // same action.
    //
    // ⭐ Read on the UNSPENT action, because under `bonusTiming: 'end'` the two
    // windows are mutually exclusive: the harvest is a MAIN action and the
    // visits either side of it are bonus-slot moves, so no single state can
    // offer both. That is the turn order, not a quirk of the fixture.
    s3.turn.actionSpent = false;
    expect(legalMoves(control, s3).some((m) => m.type === 'harvest')).toBe(true);
  });

  it('selfVisitAllowed false is the paired control', () => {
    const noSelf = loadGameData({
      name: 'no-self-visit',
      schemaVersion: 1,
      // Both keys, because `selfVisitAllowed` is read only under the card
      // currency: under the shipped meeple loop there is no self-visit at any
      // setting of it (X5), which the arm asserts from the other side.
      set: { 'rules.turn.visitCurrency': 'card', 'rules.turn.selfVisitAllowed': false },
    });
    const s = makeState(noSelf, ['wheat', 'orchard']);
    dealTo(noSelf, s, ORCHARD, 'O4');
    s.turnPlayer = ORCHARD;
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
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
    const s = controlBase();
    dealTo(control, s, ORCHARD, 'O4');
    s.turnPlayer = ORCHARD;
    s.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    // Orchard has no full building, so the Wheat door (Harvest) is dead for it.
    expect(legalMoves(control, s).some((m) => m.type === 'visit' && m.host === WHEAT)).toBe(false);
    expect(() =>
      apply(control, s, { type: 'visit', seat: ORCHARD, host: WHEAT, fee: 'O4' }),
    ).toThrow(/nothing legal/);

    // Give it one and the same door opens.
    const board = noticeBoard(s, ORCHARD);
    board.stack = s.decks.orchard.splice(0, 2); // threshold 2: full
    expect(legalMoves(control, s).some((m) => m.type === 'visit' && m.host === WHEAT)).toBe(true);
  });

  /**
   * The SOLITAIRE half. It exists so the bonus slot is never dead - a seat with
   * an empty hand has no card to place - and it is the yardstick every door has
   * to beat, which is why the Orchard door is Draw 3 and not Draw 2.
   */
  it('the bonus Draw 1 is a real draw, spends the slot, and leaves the action alone', () => {
    const state = controlBase();
    state.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const applied = apply(control, state, { type: 'bonusDraw', seat: WHEAT });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'draw', see: 1, keep: 1, pid: WHEAT });
    expect(applied.state.turn.bonusUsed).toEqual(['draw']);
    // ⭐ The bonus is a SEPARATE slot from the action, which under 'end' shows
    // as the turn not having ended: the action was spent before the slot opened
    // and taking the slot does not end the turn by itself.
    expect(applied.state.turn.ending).toBe(false);
    // One bonus a turn: the slot is genuinely gone, either half of it.
    let s = applied.state;
    while (s.tasks.length > 0) s = apply(control, s, legalMoves(control, s)[0] as Move).state;
    expect(s.players[WHEAT]!.hand).toHaveLength(1);
    expect(legalMoves(control, s).some((m) => m.type === 'bonusDraw')).toBe(false);
    expect(legalMoves(control, s).some((m) => m.type === 'visit')).toBe(false);
  });

  it('one bonus a turn, whichever half was taken', () => {
    const state = controlBase();
    dealTo(control, state, WHEAT, 'W4', 'W5');
    state.turn.actionSpent = true; // bonusTiming 'end': the window opens AFTER the action
    const after = apply(control, state, {
      type: 'visit',
      seat: WHEAT,
      host: ORCHARD,
      fee: 'W4',
    }).state;
    after.tasks = [];
    expect(legalMoves(control, after).some((m) => m.type === 'visit')).toBe(false);
    expect(legalMoves(control, after).some((m) => m.type === 'bonusDraw')).toBe(false);
  });
});

/**
 * ⛔ THE TURN-START MEEPLE SPEND IS DELETED IN THE SHIPPED GAME (R8), so this
 * block too is the v31 control. Under the meeple loop a meeple is spent in the
 * bonus slot and only there, it is never removed from the game, and it moves
 * onto the neighbour's board instead. What that replaced is here, on the arm
 * that still plays it.
 */
describe('the meeple phase - the v31 control', () => {
  const control = cardVisitGame();
  const controlBase = (): GameState => makeState(control, ['wheat', 'orchard']);

  /**
   * ⭐ A meeple performs its colour's plain action, free, and LEAVES THE GAME. It
   * is neither the action nor the bonus, so both are still there afterwards -
   * which is exactly the action inflation risk 1 of the v31 plan names.
   */
  it('spending a meeple runs its colour action and leaves the turn intact', () => {
    const s = controlBase();
    giveMeeples(s, WHEAT, 'orchard');
    const applied = apply(control, s, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' });
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
    const s = controlBase();
    giveMeeples(s, WHEAT, 'orchard', 2);
    let g = apply(control, s, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' }).state;
    while (g.tasks.length > 0) g = apply(control, g, legalMoves(control, g)[0] as Move).state;
    expect(g.players[WHEAT]!.meeples.orchard).toBe(1);
    expect(legalMoves(control, g).some((m) => m.type === 'spendMeeple')).toBe(true);
  });

  /**
   * The meeple phase is the VERY start of the turn: before the bonus and before
   * the action. `bonusUsed.length === 0` is the clause that stops a meeple being
   * held back and spent reactively later, which is the whole difference between
   * a supply of stored actions and a hand of free ones.
   */
  /**
   * ⭐ UNDER THE SHIPPED `bonusTiming: 'end'` THE ACTION SHUTS THIS WINDOW
   * BEFORE THE BONUS CAN, so the closure is asserted twice: once off the action,
   * which is what a real turn does, and once off the bonus under `'any'`, the
   * only timing where `bonusUsed.length === 0` is still the binding clause.
   * `meepleOpen` keeps both clauses for exactly this reason - see the note there
   * on not deleting a clause because the shipped knob makes it unreachable.
   */
  it('closes as soon as the turn moves on, by either clause', () => {
    const s = controlBase();
    giveMeeples(s, WHEAT, 'orchard');
    s.turn.actionSpent = true;
    expect(legalMoves(control, s).some((m) => m.type === 'spendMeeple')).toBe(false);
    expect(() =>
      apply(control, s, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' }),
    ).toThrow(/start of your turn/);

    // The second clause, on the one timing that can still reach it.
    const anyRules = {
      ...control,
      rules: { ...control.rules, turn: { ...control.rules.turn, bonusTiming: 'any' as const } },
    };
    const t = controlBase();
    giveMeeples(t, WHEAT, 'orchard');
    const after = apply(anyRules, t, { type: 'bonusDraw', seat: WHEAT }).state;
    after.tasks = [];
    expect(after.turn.actionSpent).toBe(false); // only the bonus has been taken
    expect(after.players[WHEAT]!.meeples.orchard).toBe(1);
    expect(legalMoves(anyRules, after).some((m) => m.type === 'spendMeeple')).toBe(false);
    expect(() =>
      apply(anyRules, after, { type: 'spendMeeple', seat: WHEAT, colour: 'orchard' }),
    ).toThrow(/start of your turn/);
  });

  it('a meeple whose action can do nothing is not offered, and can die unspent', () => {
    const s = controlBase();
    // A wheat meeple performs Harvest, and this seat has no full building.
    giveMeeples(s, ORCHARD, 'wheat');
    s.turnPlayer = ORCHARD;
    expect(legalMoves(control, s).some((m) => m.type === 'spendMeeple')).toBe(false);
    expect(() =>
      apply(control, s, { type: 'spendMeeple', seat: ORCHARD, colour: 'wheat' }),
    ).toThrow(/can do anything/);
  });

  it('a meeple of a suit nobody is farming still works', () => {
    // Dairy is not at the table, so no Notice Board grants Build - but the
    // action exists, so the meeple does too.
    const s = controlBase();
    giveMeeples(s, WHEAT, 'dairy');
    dealTo(control, s, WHEAT, ...s.decks.wheat.slice(0, 4));
    const applied = apply(control, s, { type: 'spendMeeple', seat: WHEAT, colour: 'dairy' });
    expect(applied.state.tasks[0]).toMatchObject({ t: 'build', pid: WHEAT });
  });
});

/**
 * THE SHIPPED BONUS SLOT, in one place, as the pair of shapes rather than as a
 * re-proof of `meeple-loop.test.ts`. Two options under either currency and never
 * four: the meeple loop offers Visit or Collect and offers neither `bonusDraw`
 * nor `spendMeeple`; the control offers Draw 1 or a card visit and offers no
 * Collect. A move type leaking across that line is the failure this pins.
 */
describe('the two bonus slots are disjoint', () => {
  it('the shipped game offers the notice-board visit alone, and nothing from either meeple game', () => {
    const s = base();
    dealTo(data, s, WHEAT, 'W4'); // the fee, and the whole of the bonus slot
    const types = new Set(legalMoves(data, s).map((m) => m.type));
    // ⭐ ONE OPTION (S5): no free Draw 1, no Collect, and an unspent slot is a
    // turn that chose not to pay.
    expect(types.has('visit')).toBe(true);
    expect(types.has('collect')).toBe(false);
    expect(types.has('bonusDraw')).toBe(false);
    expect(types.has('spendMeeple')).toBe(false);
    // And with an empty hand there is nothing to pay with, so the slot is simply
    // not offered - it is never dead by rule, only by position.
    const empty = base();
    expect(legalMoves(data, empty).some((m) => m.type === 'visit')).toBe(false);
  });

  it('the v31 control offers bonusDraw and a card visit, and no collect', () => {
    const control = cardVisitGame();
    const s = makeState(control, ['wheat', 'orchard']);
    dealTo(control, s, WHEAT, 'W4');
    s.turn.actionSpent = true;
    const types = new Set(legalMoves(control, s).map((m) => m.type));
    expect(types.has('visit')).toBe(true);
    expect(types.has('bonusDraw')).toBe(true);
    expect(types.has('collect')).toBe(false);
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
  /**
   * ⛔ REVERSED TWICE, AND THIS IS THE CLEAREST SINGLE STATEMENT OF THE TURN
   * ORDER EACH TIME. It asserted the turn ENDING itself under `'start'`
   * (19/08/2026 to 03/09/2026), then HOLDING OPEN under `'end'`, and the
   * bonus-first turn puts it back (C2, 09/09/2026): the bonus is taken first, so
   * by the time the action is spent there is nothing left to wait for and the
   * turn settles on its own. `endTurn` exists to decline options that are still
   * live, and after the action there are none.
   *
   * ⚠️ The `settleTurn` hold this used to prove is now unreachable and MUST
   * STAY - `turnflow.ts` carries the tombstone explaining why deleting a line
   * because the shipped knob makes it unreachable is how it had to come back
   * once already.
   */
  it('ends the turn on the action, because the slot was open before it', () => {
    const state = base();
    dealTo(data, state, WHEAT, 'W4');
    // The bonus first, while it is open: a card onto a rival's Notice Board.
    const visit = legalMoves(data, state).find((m) => m.type === 'visit');
    expect(visit).toBeDefined();
    let s = apply(data, state, visit as Move).state;
    while (s.tasks.length > 0) {
      const moves = legalMoves(data, s);
      s = apply(data, s, moves[0] as Move).state;
    }
    expect(s.turnPlayer).toBe(WHEAT);
    expect(s.turn.bonusUsed).toEqual(['visit']);

    // Then the action, which ends the turn with no `endTurn` needed.
    const acted = apply(data, s, { type: 'draw', seat: WHEAT });
    let after = acted.state;
    while (after.tasks.length > 0) {
      const moves = legalMoves(data, after);
      after = apply(data, after, moves[0] as Move).state;
    }
    expect(after.turnPlayer).toBe(ORCHARD);
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
    // ⭐ The turn settles by itself again (C2, 09/09/2026): the bonus slot shut
    // when the action was taken, so there is nothing left to decline and the
    // boundary is reached without an `endTurn`. The rule under test has not
    // moved - the draw was allowed over the limit and the discard priced it at
    // the boundary - only the route to the boundary has.
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
    // ⚠️ ON THE MEEPLE ARM: the commons deals no meeples at all (C6), so every
    // supply in the shipped game is five zeros and the claim would assert
    // nothing. The FIELD is still public and still typed, because both meeple
    // controls need it, and this is what pins that.
    const state = makeState(meepleArm, ['wheat', 'orchard']);
    // Every seat starts holding one of each colour on the arm (R3), so these
    // read as deltas: 1 + 2 for the rival, 1 + 0 for you once yours is gone.
    giveMeeples(state, ORCHARD, 'dairy', 2);
    state.players[WHEAT]!.meeples.wheat = 0;
    const view = viewFor(meepleArm, state, WHEAT);
    expect(view.you.meeples.wheat).toBe(0);
    expect(view.you.meeples.orchard).toBe(1);
    expect(view.rivals[0]?.meeples.dairy).toBe(3);
  });

  /**
   * The island's tokens and their Workers are PUBLIC: they sit face up from
   * setup, so they must cross the view boundary unredacted for every seat.
   * Asserting it is what stops a future redaction pass quietly dropping them.
   */
  it('shows every island token and Worker to every seat', () => {
    const state = base();
    const tile = state.island.tiles[1]!;
    for (let seat = 0; seat < state.players.length; seat++) {
      const seen = viewFor(data, state, seat).island.tiles.find((t) => t.tile === tile.tile);
      expect(seen?.tokens, `seat ${seat}`).toEqual(tile.tokens);
    }
  });

  it('redactEvents masks ids down to their suit letter for other seats', () => {
    const events: GameEvent[] = [
      { e: 'cardsToHand', seat: ORCHARD, cards: ['O5'] },
      { e: 'cardPlaced', seat: ORCHARD, onto: { seat: WHEAT, building: 'W3' }, card: 'O6' },
      // `source` and `owner` are constants since the commons was deleted - see
      // the event's own note.
      {
        e: 'harvested',
        seat: WHEAT,
        building: 'W4',
        cards: ['W5'],
        source: 'tableau',
        owner: WHEAT,
      },
    ];
    const mine = redactEvents(events, ORCHARD);
    expect(mine[0]).toMatchObject({ cards: ['O5'] });
    const theirs = redactEvents(events, WHEAT);
    expect(theirs[0]).toMatchObject({ cards: ['O?'] });
    expect(theirs[1]).toMatchObject({ card: 'O?' });
    expect(theirs[2]).toMatchObject({ cards: ['W?'] }); // barns are anonymous even to the owner
  });
});

/** A receipt of this VP (the token island's records, 16/09/2026). */
const R = (vp: number) => ({ vp, crop: 'wheat' as const, tile: 'A1' });

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
    state.players[WHEAT]!.receipts.push(R(6));
    state.players[ORCHARD]!.receipts.push(R(6)); // tied on VP
    dealTo(data, state, ORCHARD, 'O5', 'O6'); // two more cards of stock
    stockBarn(state, WHEAT, 'wheat', 1);
    const result = score(data, state);
    expect(result.seats[WHEAT]!.total).toBe(result.seats[ORCHARD]!.total);
    expect(result.ranking).toEqual([ORCHARD, WHEAT]);
  });

  it('the hand and the barn count together, not separately', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(R(6));
    state.players[ORCHARD]!.receipts.push(R(6));
    dealTo(data, state, WHEAT, 'W4', 'W5'); // 2 in hand, 0 in barn
    stockBarn(state, ORCHARD, 'orchard', 3); // 0 in hand, 3 in barn
    expect(score(data, state).ranking).toEqual([ORCHARD, WHEAT]);
  });

  it('falls through to receipt count when VP and stock both tie', () => {
    const state = base();
    state.players[WHEAT]!.receipts.push(R(6)); // 6 VP from one receipt
    state.players[ORCHARD]!.receipts.push(R(3), R(3)); // 6 VP from two
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
    state.players[WHEAT]!.receipts.push(R(6));
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
  // ⚠️ ADDED 04/09/2026 WITH THE FLIP, AND IT WAS NOT COSMETIC. `pickMove` walks
  // this list in order and falls through to `endTurn`, so a shipped move type
  // missing from it is a move the greedy policy silently never plays - here,
  // Collect, which is half the bonus slot and the only way a meeple comes home.
  // Without it the 2-seat game wandered into a position offering 11,440 legal
  // moves and tripped the ceiling below. With it the worst position is 330,
  // which is the discard task's C(11, 4) and the hand limit doing its job.
  'collect',
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
    //
    // ⚠️ NARROWED 05/09/2026, and the narrowing is the honest half. This used to
    // require the walk to have delivered to a LEVEL 3 tile, which was always
    // incidental to the seed: the policy takes the cheapest tile it can pay,
    // there is exactly ONE level 3 tile at two seats, and the meeple-economy
    // defaults changed which tiles come up affordable, so this seeded game now
    // ends with D1 untouched. The design claim underneath - a level is ART and
    // never a gate - is not a claim about one walk, so it is pinned as "the
    // island is climbed above its bottom row" here and as the flat 6/3 receipt
    // everywhere else.
    expect(
      state.island.tiles.some((t) => tileLevel(data, t.tile) > 1 && t.deliveredBy.length > 0),
    ).toBe(true);
    expect(state.island.tiles.some((t) => tileLevel(data, t.tile) === 3)).toBe(true);
    expect(legalMoves(data, state)).toEqual([]);
    expect(score(data, state).ranking).toHaveLength(2);
  });

  it('plays a 3-player game with Vegetable in play to the end', () => {
    const { state } = playFullGame('game-b', 3, ['vegetable', 'wheat', 'apiary']);
    expect(state.phase).toBe('ended');
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
