/**
 * ⭐ **THE BOTS UNDER THE VILLAGE STORE COIN (V1 to V12, A150) AND THE DELIVERY
 * MEEPLE (M1 to M8, A151), both ruled by Dean on 12/09/2026.**
 *
 * ⛔ **WHY THIS FILE EXISTS, AND IT IS NOT COVERAGE FOR ITS OWN SAKE: AN
 * UNPRICED OPTION IS ONE A BOT NEVER TAKES, AND AN ARM WHOSE NEW RULE IS NEVER
 * USED READS EXACTLY LIKE ITS CONTROL.** This project has published a run where
 * a knob was inert and the zero delta was nearly read as "the rule does not
 * matter" (19/08/2026, `bonus-any-time`). Every case below asserts that one of
 * the new decisions is visible to the term table, and visible in the right
 * direction.
 *
 * ⛔ **AN ARM ON TOP OF AN ARM.** C100 is open and no Notice Board configuration
 * is ruled in as the shipped game, so `villageStoreGame()` and
 * `deliveryMeepleGame()` both pin the twenty leaves of the best-measured
 * host-draw arm and differ from it only in their own rules' leaves.
 *
 * ⚠️ **IT WALKS WHOLE GAMES IN THREE CASES, WHICH THIS PACKAGE OTHERWISE LEAVES
 * TO @gp/sim.** `commons.test.ts` states the exception and this file takes it
 * for the same reason: "does a bot ever use the rule" is this package's own
 * correctness, and the loop is the same deliberately minimal copy of `runGame`.
 *
 * ⛔ **AND NOTHING HERE NAMES THE ENGINE'S TRUTH TYPE**, which `boundary.test.ts`
 * in @gp/sim reads this very file to check. A position is only ever passed
 * along, and the alias below is how it is spelled.
 */

import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, testkit, viewFor } from '@gp/engine';
import type { CardId, Move, Seat } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { makePolicy, policyRng } from './roster.js';
import { MEEPLE_LATENT, cardById, makeScratch, meepleWorth } from './scratch.js';
import type { ExplainedMove } from './types.js';

/** A position, spelled without naming the engine's truth type (see the header). */
type Position = ReturnType<typeof testkit.makeState>;

const SEAT = 0 as Seat;
const arm = testkit.villageStoreGame();
const meepleArm = testkit.deliveryMeepleGame();
/** The named control of both arms, whose `meepleSpendTiming` is the shipped `'start'`. */
const control = testkit.noticeBoardHostDrawBySeatsGame();

/** The reference bot's term-by-term breakdown of every move in this position. */
function explainAt(
  data: GameData,
  state: Position,
  seat: Seat = SEAT,
): { explained: ExplainedMove[]; chosen: Move } {
  const policy = makePolicy('balanced');
  const ctx = {
    data,
    view: viewFor(data, state, seat),
    moves: legalMoves(data, state),
    rng: policyRng('village-store', seat, 'balanced'),
    probe: makeProber(data, state, seat),
  };
  const explained = policy.explain?.(ctx);
  if (!explained) throw new Error('the reference bot has no explain');
  return { explained, chosen: policy.choose(ctx) };
}

/** Cards straight off a deck into a barn, by suit and count - the engine tests' own helper. */
function stockBarn(state: Position, seat: Seat, suit: Suit, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = state.decks[suit].shift();
    if (!id) throw new Error(`deck ${suit} ran dry`);
    state.players[seat]?.barn.push(id);
  }
}

/**
 * A two-seat position holding `wheat` wheat cards in the barn, with four of them
 * paid to tile A1 - so the mint task is the head task and its ceiling is what is
 * left. A1 and A2 each want two crates of wheat at two cards a crate.
 */
function atTheMint(wheat: number): Position {
  const state = testkit.makeState(arm, ['wheat', 'orchard']);
  stockBarn(state, SEAT, 'wheat', wheat);
  const out = apply(arm, state, { type: 'deliver', seat: SEAT, tile: 'A1', spend: { wheat: 4 } });
  if (out.state.tasks[0]?.t !== 'mint') throw new Error('no mint task pending');
  return out.state;
}

const convertAnswer = (moves: readonly ExplainedMove[]): ExplainedMove | undefined =>
  moves.find((m) => m.move.type === 'task' && m.move.answer.kind === 'card');

const skipAnswer = (moves: readonly ExplainedMove[]): ExplainedMove | undefined =>
  moves.find((m) => m.move.type === 'task' && m.move.answer.kind === 'skip');

describe('the Village Store mint, and whether a bot ever declines it (C113)', () => {
  /**
   * ⭐ THE PRICING ITSELF. A mint answer is `coinWorth` for the coin it gains
   * and `barnSpend` for the card it costs, and it is deliberately NOT given
   * `cardTask`'s flat +1: that thumb is for an optional offer nothing can price,
   * and this one is priced.
   */
  it('prices a conversion as a coin gained against a barn card spent, with no flat taste', () => {
    const { explained } = explainAt(arm, atTheMint(7));
    const convert = convertAnswer(explained);
    expect(convert, 'the mint offers a card answer').toBeDefined();
    expect(convert?.terms['coinWorth']).toBeGreaterThan(0);
    expect(convert?.terms['barnSpend']).toBeLessThan(0);
    expect(convert?.terms['cardTask']).toBeUndefined();
  });

  /**
   * ⭐ THE SPARE CARD IS CONVERTED. Three wheat left after the crate cannot pay
   * A2's four, so nothing is lost by exchanging one and the bot takes it over
   * the skip.
   */
  it('converts a card the barn cannot spend', () => {
    const { explained, chosen } = explainAt(arm, atTheMint(7));
    expect(convertAnswer(explained)?.terms['mintStrands']).toBeUndefined();
    expect(chosen.type === 'task' && chosen.answer.kind).toBe('card');
  });

  /**
   * ⛔ **AND THE CARD THAT IS NOT SPARE IS REFUSED, WHICH IS THE WHOLE POINT.**
   * Four wheat left after the crate is exactly A2's price, so converting one
   * costs a delivery the barn can pay for today: `mintStrands` charges it and
   * the answer falls below `skip`. Without this the bot empties its barn at
   * every delivery and C113 comes back "yes" as a fact about the term table.
   */
  it('refuses to convert the second half of a crate it could still pay', () => {
    const { explained, chosen } = explainAt(arm, atTheMint(8));
    const convert = convertAnswer(explained);
    expect(convert?.terms['mintStrands']).toBeLessThan(0);
    expect(convert?.total).toBeLessThan(skipAnswer(explained)?.total ?? 0);
    expect(chosen.type === 'task' && chosen.answer.kind).toBe('skip');
  });
});

describe('the coin-Grow: an ability use with no clog cost (V8, V9)', () => {
  /**
   * A seat `stack` cards into W4 (threshold 2), holding a wheat card and three
   * coins. The hand card is dealt BEFORE the stack is loaded, because
   * `loadStack` fills from the same deck's top and would otherwise take it.
   */
  function withStack(stack: number): Position {
    const state = testkit.makeState(arm, ['wheat', 'orchard']);
    testkit.buildFor(arm, state, SEAT, 'W4');
    testkit.dealTo(arm, state, SEAT, 'W5');
    testkit.loadStack(arm, state, SEAT, 'W4', stack);
    testkit.giveCoins(state, SEAT, 3);
    return state;
  }

  const growOn = (moves: readonly ExplainedMove[], coin: boolean): ExplainedMove | undefined =>
    moves.find(
      (m) =>
        m.move.type === 'grow' && m.move.building === 'W4' && (m.move.coinGrow === true) === coin,
    );

  /**
   * ⛔ **THE ONE MISPRICING THIS SLICE WAS WRITTEN TO PREVENT.**
   * `fillsBuilding` asks `stack + 1 >= threshold` and cannot see what paid, so
   * an unguarded coin-Grow would collect +3 for completing a building it does
   * not touch. A card-Grow on the same building DOES complete it and keeps the
   * credit, which is what makes the bot spend the card when the card is what
   * buys the Harvest.
   */
  it('gives a card-Grow the completion credit and a coin-Grow none', () => {
    const { explained } = explainAt(arm, withStack(1));
    const card = growOn(explained, false);
    const coin = growOn(explained, true);
    expect(card, 'the card-Grow is on offer').toBeDefined();
    expect(coin, 'the coin-Grow is on offer').toBeDefined();
    expect(card?.terms['growCompletes']).toBeGreaterThan(0);
    expect(coin?.terms['growCompletes']).toBeUndefined();
    // And only the card-Grow takes a card out of a hand, so only it pays `handSpend`.
    expect(card?.terms['handSpend']).toBeLessThan(0);
    expect(coin?.terms['handSpend']).toBeUndefined();
  });

  /**
   * ⛔ **V9, THE STRONGEST CLAUSE IN THE PACKAGE.** On a FULL building the coin
   * is the only Grow there is, `fillsBuilding` reads true for the first time in
   * this game's history (`stack >= threshold`), and the credit must still not be
   * paid. What the bypass is WORTH arrives through the rollout as whatever the
   * ability fires.
   */
  it('takes a coin-Grow on a building that is already full, and still pays no completion', () => {
    const { explained } = explainAt(arm, withStack(2));
    expect(growOn(explained, false), 'a card-Grow cannot reach a full building').toBeUndefined();
    const coin = growOn(explained, true);
    expect(coin, 'V9 offers the coin-Grow').toBeDefined();
    expect(coin?.terms['growCompletes']).toBeUndefined();
  });

  /**
   * ⚠️ The coin itself is charged INSIDE the rollout (a Grow is on `isProbed`,
   * so `coinsSpent` reaches `priceEvent`), never by a move term - so a coin-Grow
   * must carry no `coinSpend` line at all. Charge it in both places and the sink
   * reads empty.
   */
  it('charges the coin-Grow inside the rollout and never twice', () => {
    const { explained } = explainAt(arm, withStack(1));
    expect(growOn(explained, true)?.terms['coinSpend']).toBeUndefined();
  });
});

describe('the coin-paid build (V6, V7)', () => {
  /**
   * ⛔ **A BUILD IS NOT PROBED, SO `coinSpend` IS THE ONLY THING THAT CAN CHARGE
   * IT.** `cardsLeavingHand` counts the payment's CARDS, so a build paid partly
   * or wholly in coins reads free without this, and a bot holding coins takes
   * every card it is offered and keeps none back for a Grow.
   */
  it('charges every coin in a build payment, in proportion', () => {
    const state = testkit.makeState(arm, ['wheat', 'orchard']);
    testkit.dealTo(arm, state, SEAT, 'W9');
    testkit.giveCoins(state, SEAT, 3);
    const { explained } = explainAt(arm, state);
    const paid = explained.filter((m) => m.move.type === 'build' && (m.move.coins ?? 0) > 0);
    expect(paid.length, 'the engine offers coin-paid builds').toBeGreaterThan(0);
    for (const m of paid) {
      const coins = m.move.type === 'build' ? (m.move.coins ?? 0) : 0;
      expect(m.terms['coinSpend']).toBeCloseTo(-1.2 * coins, 10);
    }
    // A build paid entirely in cards carries no coin charge at all.
    const cards = explained.find((m) => m.move.type === 'build' && (m.move.coins ?? 0) === 0);
    expect(cards?.terms['coinSpend']).toBeUndefined();
  });
});

describe('the delivery meeple: what it buys, not what its door sells (M7)', () => {
  /** A bare seat, one hand card, one apiary meeple - no deck building at all. */
  function bareWithMeeple(data: GameData): Position {
    const state = testkit.makeState(data, ['wheat', 'orchard']);
    testkit.dealTo(data, state, SEAT, 'W4');
    testkit.giveMeeples(state, SEAT, 'apiary', 1);
    return state;
  }

  /**
   * ⛔ **AN APIARY MEEPLE BUYS A GROW UNDER `'afterAction'` AND THE ROSTER PRINTS
   * SOW.** The engine gates `meepleOptions` on `meepleActionOf`, so a bot that
   * priced the meeple by the door's own action would value a Sow the engine
   * never offers - the `hostGift` seam of 12/09/2026 in a new place.
   *
   * The bare position is exactly the case that separates the two: a Notice Board
   * is a legal SOW target and can never be a Grow target, so the door reads live
   * where the meeple reads dead.
   */
  it('prices an apiary meeple by GROW readiness and not by SOW readiness', () => {
    const state = bareWithMeeple(meepleArm);
    expect(meepleWorth(makeScratch(meepleArm, viewFor(meepleArm, state, SEAT)), 'apiary')).toBe(
      MEEPLE_LATENT,
    );
    // One Wheat Field later a Grow is legal and the same meeple is live.
    testkit.buildFor(meepleArm, state, SEAT, 'W5');
    expect(
      meepleWorth(makeScratch(meepleArm, viewFor(meepleArm, state, SEAT)), 'apiary'),
    ).toBeGreaterThan(MEEPLE_LATENT);
  });

  /**
   * ⚠️ AND THE TURN-START SPEND IS UNTOUCHED: the named control ships
   * `meepleSpendTiming: 'start'`, where an apiary meeple still buys its Sow, so
   * the SAME bare position reads LIVE. That is the half four fixtures replay,
   * and it is why `meepleActionFor` is the identity under every other timing.
   */
  it('leaves the turn-start spend reading its own Sow', () => {
    const state = bareWithMeeple(control);
    expect(
      meepleWorth(makeScratch(control, viewFor(control, state, SEAT)), 'apiary'),
    ).toBeGreaterThan(MEEPLE_LATENT);
  });
});

const SEAT_SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary'];

interface Walked {
  readonly moves: readonly Move[];
  /** Coin-Grows whose target was AT or OVER its printed threshold - V9's own count. */
  readonly bypasses: number;
}

/** One game, driven by the reference bot - the same minimal loop `commons.test.ts` uses. */
function walk(data: GameData, seats: number, seed: string): Walked {
  const suits = SEAT_SUITS.slice(0, seats);
  const policies = Array.from({ length: seats }, () => makePolicy('balanced'));
  const rngs = policies.map((p, seat) => policyRng(seed, seat, p.id));
  let state = newGame(data, { seats, suits, seed });
  const moves: Move[] = [];
  let bypasses = 0;
  let idle = 0;
  while (!isOver(state) && moves.length < 6000 && idle < seats * 4) {
    const legal = legalMoves(data, state);
    const first = legal[0];
    if (!first) throw new Error('No legal moves and the game is not over');
    const policy = policies[first.seat];
    const rng = rngs[first.seat];
    if (!policy || !rng) throw new Error(`No policy for seat ${first.seat}`);
    const move = policy.choose({
      data,
      view: viewFor(data, state, first.seat),
      moves: legal,
      rng,
      probe: makeProber(data, state, first.seat),
    });
    if (move.type === 'grow' && move.coinGrow === true && atThreshold(data, state, move)) {
      bypasses += 1;
    }
    state = apply(data, state, move).state;
    moves.push(move);
    idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
  }
  return { moves, bypasses };
}

/** Is this Grow's target already at or over its printed threshold? V9's whole subject. */
function atThreshold(
  data: GameData,
  state: Position,
  move: { seat: Seat; building: CardId },
): boolean {
  const stack = state.players[move.seat]?.tableau.find((b) => b.card === move.building)?.stack;
  const threshold = cardById(data, move.building).threshold;
  return stack !== undefined && threshold !== null && stack.length >= threshold;
}

describe('the bots actually use both sinks over whole games', () => {
  /**
   * ⛔ **THE ONE CASE THAT WOULD HAVE CAUGHT AN INERT ARM.** Every count below
   * is asserted non-zero and nothing more: a threshold taken off the run that
   * first measures a quantity is a snapshot test that can never fail (ticket 11
   * section 2), and the levels belong to the watch-list at `--n=1580` rather
   * than to a three-game unit test.
   */
  it('mints coins, spends them on builds and on Grows, and bypasses a clog with one', () => {
    let minted = 0;
    let builds = 0;
    let coinGrows = 0;
    let bypasses = 0;
    for (const seed of ['store-a', 'store-b', 'store-c']) {
      const walked = walk(arm, 3, seed);
      bypasses += walked.bypasses;
      for (const move of walked.moves) {
        if (move.type === 'task' && move.answer.kind === 'card' && 'suit' in move.answer.payload) {
          minted += 1;
        }
        if (move.type === 'build' && (move.coins ?? 0) > 0) builds += 1;
        if (move.type === 'grow' && move.coinGrow === true) coinGrows += 1;
      }
    }
    expect(minted, 'V1: the mint is used').toBeGreaterThan(0);
    expect(builds, 'V6: the Build sink is used').toBeGreaterThan(0);
    expect(coinGrows, 'V8: the Grow sink is used').toBeGreaterThan(0);
    expect(bypasses, 'V9: a coin-Grow reaches a full building').toBeGreaterThan(0);
  });

  /**
   * ⛔ AND THE ARM THAT TURNS V9 OFF NEVER REACHES ONE. `'growOpen'` keeps the
   * Grow sink and refuses a CLOGGED target, so the bypass count must be exactly
   * zero there - which is the assertion that says the count above is the clause
   * and not the sink.
   *
   * ⚠️ **THE TOTAL NUMBER OF COIN-GROWS IS DELIBERATELY NOT COMPARED.** It reads
   * HIGHER under `'growOpen'` on these seeds, and that is two different games
   * diverging from the first decision rather than a finding; the only sound
   * comparison at three games is the structural zero.
   */
  it('never reaches a full building when V9 is off', () => {
    const open = testkit.villageStoreGame('growOpen');
    for (const seed of ['bypass-a', 'bypass-b', 'bypass-c']) {
      expect(walk(open, 3, seed).bypasses).toBe(0);
    }
  });

  /**
   * ⭐ AND THE DELIVERY MEEPLE IS SPENT UNDER ITS OWN TIMING (M4), which is the
   * half `MEEPLE_WINDOW` in `evaluator.ts` was documenting as a turn-START
   * window until 12/09/2026.
   */
  it('spends a delivery meeple after the main action', () => {
    let spent = 0;
    for (const seed of ['meeple-a', 'meeple-b', 'meeple-c']) {
      spent += walk(meepleArm, 3, seed).moves.filter((m) => m.type === 'spendMeeple').length;
    }
    expect(spent, 'M4: a claimed meeple is spent').toBeGreaterThan(0);
  });
});
