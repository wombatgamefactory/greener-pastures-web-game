/**
 * Ticket 40's two claims, made falsifiable.
 *
 * 1. **The probe is blind.** Dean's ruling: a probe may price anything the seat
 *    would legitimately know before committing, but never a card the probe
 *    itself just turned face up. The test reshuffles every deck and every
 *    discard behind the seat's back and demands the identical valuation - which
 *    is the only way to prove a bot is not reading the deck before deciding.
 *
 * Lives in @gp/sim rather than beside the code it tests: it holds a `GameState`
 * in order to reshuffle the decks, and ticket 01's boundary refuses that import
 * anywhere under `packages/bots/**` - test or not. Ticket 30's starter-exclusion
 * guard was relocated for exactly the same reason.
 *
 * 2. **It answers NOW.** The same card in two positions must price differently:
 *    a harvest ability with nothing to harvest is worth nothing, and the flat
 *    2.5 this ticket replaced could never say that.
 */

import { loadGameData } from '@gp/data';
import type { Suit } from '@gp/data';
import type { CardId, GameState, Move } from '@gp/engine';
import {
  apply,
  legalMoves,
  makeProber,
  newGame,
  player,
  seedRng,
  shuffle,
  testkit,
  viewFor,
} from '@gp/engine';
import { describe, expect, it } from 'vitest';

import {
  BALANCED,
  actOf,
  coinWorth,
  makeOutcomes,
  makePolicy,
  makeScratch,
  policyRng,
  TERMS,
} from '@gp/bots';

import { assignProfiles, runGame } from './driver.js';

const data = loadGameData();
const SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

/** Value every probe-worthy move at a position, keyed so two states compare. */
function valuations(state: GameState): Map<string, number> {
  const seat = state.tasks[0]?.pid ?? state.turnPlayer;
  const moves = legalMoves(data, state);
  const scratch = makeScratch(data, viewFor(data, state, seat));
  const outcomes = makeOutcomes(scratch, BALANCED, makeProber(data, state, seat));
  const out = new Map<string, number>();
  for (const move of moves) out.set(JSON.stringify(move), outcomes.value(move));
  return out;
}

/**
 * Shuffle every deck and discard with a fresh stream, leaving hands, tableaux,
 * barns, coins, the island and the turn exactly as they were. Nothing the seat
 * can legitimately see has moved.
 */
function reshuffleTheUnseen(state: GameState, seed: string): GameState {
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  const rng = seedRng(seed);
  for (const suit of Object.keys(next.decks) as (keyof typeof next.decks)[]) {
    next.decks[suit] = shuffle(rng, [...next.decks[suit]]);
    next.discards[suit] = shuffle(rng, [...next.discards[suit]]);
  }
  return next;
}

/** Walk a game to a position where at least one probe-worthy move is legal. */
function walkToProbeable(seed: string, seats: number, suits: string[]): GameState | null {
  let state = newGame(data, { seats, suits: suits as never, seed });
  const rngs = new Map<number, ReturnType<typeof policyRng>>();
  for (let step = 0; step < 400; step++) {
    const moves = legalMoves(data, state);
    if (moves.length === 0) return null;
    const seat = state.tasks[0]?.pid ?? state.turnPlayer;
    // A position is interesting once a GROW is on offer: that is the move whose
    // value was a flat constant before this ticket.
    if (step > 40 && moves.some((m) => actOf(m).a === 'grow')) return state;
    const rng = rngs.get(seat) ?? policyRng(seed, seat, 'balanced');
    rngs.set(seat, rng);
    const policy = makePolicy('balanced');
    const probe = makeProber(data, state, seat);
    state = apply(
      data,
      state,
      policy.choose({ data, view: viewFor(data, state, seat), moves, rng, probe }),
    ).state;
  }
  return null;
}

describe('the probe is blind to what it reveals', () => {
  it('prices a position identically after every unseen deck is reshuffled', () => {
    let checked = 0;
    for (const seed of ['blind-a', 'blind-b', 'blind-c']) {
      const state = walkToProbeable(seed, 3, ['wheat', 'orchard', 'apiary']);
      if (state === null) continue;
      const before = valuations(state);
      const after = valuations(reshuffleTheUnseen(state, `${seed}:shuffled`));
      expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [move, value] of before) {
        // A single failing move here means a bot somewhere is deciding on deck
        // order, and every card economic in the balance report carries it.
        expect(after.get(move), `valuation of ${move} moved with the deck`).toBeCloseTo(value, 9);
      }
      checked += 1;
    }
    expect(checked, 'no seed reached a probe-worthy position').toBeGreaterThan(0);
  });
});

describe('the probe answers NOW', () => {
  it('spreads GROW valuations across a real game instead of holding a constant', () => {
    // Measured over a whole game rather than one position on purpose: two grows
    // at the SAME position are often the same building paid with a different
    // hand card, and those genuinely SHOULD price alike. The claim worth making
    // is that the value moves with the board.
    const seen: number[] = [];
    let state = newGame(data, {
      seats: 3,
      suits: ['wheat', 'orchard', 'dairy'],
      seed: 'spread',
    });
    const rngs = new Map<number, ReturnType<typeof policyRng>>();
    for (let step = 0; step < 400 && seen.length < 40; step++) {
      const moves = legalMoves(data, state);
      if (moves.length === 0) break;
      const seat = state.tasks[0]?.pid ?? state.turnPlayer;
      const view = viewFor(data, state, seat);
      const probe = makeProber(data, state, seat);
      const grows = moves.filter((m) => actOf(m).a === 'grow');
      if (grows.length > 0) {
        const outcomes = makeOutcomes(makeScratch(data, view), BALANCED, probe);
        for (const move of grows) seen.push(outcomes.value(move));
      }
      const rng = rngs.get(seat) ?? policyRng('spread', seat, 'balanced');
      rngs.set(seat, rng);
      state = apply(
        data,
        state,
        makePolicy('balanced').choose({
          data,
          view,
          moves,
          rng,
          probe: makeProber(data, state, seat),
        }),
      ).state;
    }

    expect(seen.length, 'no GROW was ever offered').toBeGreaterThan(5);
    const distinct = new Set(seen.map((v) => v.toFixed(6)));
    // Under the term this ticket replaced, every one of these was exactly 2.5.
    expect(
      distinct.size,
      'every GROW in a whole game priced identically - the probe is not reading the ability',
    ).toBeGreaterThan(1);
    // And the spread has to be real, not floating-point noise.
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(1);
  });

  it('prices a probe-worthy move at zero when its effect does nothing', () => {
    // A rollout that produced no events and offered no follow-up choice is
    // worth nothing, which is the shape "The Bakery with no full buildings"
    // takes. Proven directly against the pricer rather than hunted for in play.
    const state = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'zero' });
    const seat = state.turnPlayer;
    const scratch = makeScratch(data, viewFor(data, state, seat));
    const outcomes = makeOutcomes(scratch, BALANCED, () => ({
      events: [],
      next: [],
      truncated: false,
      pending: null,
      handSize: 0,
      // No demand token moved, so the deliverability term is a zero delta - the
      // same reading `probeAt` gives every probe that leaves the island alone.
      deliverableBefore: 0,
      deliverable: 0,
      step: () => {
        throw new Error('no step expected');
      },
    }));
    const anyMove = legalMoves(data, state)[0] as Move;
    expect(outcomes.value(anyMove)).toBe(0);
  });
});

/**
 * Ticket 50. A `draw` task takes one `deck` answer per card REVEALED and only
 * then a `keep`, and `cardsToHand` - the only priced event in the effect - fires
 * on the keep. At `DEPTH = 3` that put everything drawing 3 or more beyond the
 * rollout's reach, and the worst case was the Draw Worker: priced at exactly
 * zero in 82.2% of the positions it was offered in, against 0.0% for all four
 * other Workers. It is the one the design calls a traffic magnet, and watch-list
 * assertion 7 exists to measure how much it attracts.
 *
 * Ticket 49 split the assertion in two, and the reason is that ticket 50's own
 * proxy stopped meaning what it said. The price is now capped by ROOM IN HAND,
 * so a seat renting a Draw Worker with a full hand is priced at zero on purpose:
 * it draws into its own end-of-turn discard. That is a valuation, not the
 * blindness this test was written to catch, and lumping the two together would
 * either hide a regression or forbid a correct answer. So the rate is measured
 * where there IS room - the only place the old claim can be tested - and the
 * full-hand zeroes are asserted separately as the intended behaviour.
 *
 * The full-hand half is now a CONSTRUCTED position rather than a hunt through
 * the corpus (2026-08-11, the Apiary rebuild). It had been widened three times,
 * and the comment on the third said what to do if it happened again: "the honest
 * fix is a constructed position rather than a wider net, because a corpus
 * property is not a test". This is the fourth, so the net was not widened again.
 * Measured after the rebuild: over the 60 games the sweep below runs, not one
 * offer had a hand over its limit, and it takes 180 games to turn up 34 of them
 * (0 at 2 seats, 22 at 3, 12 at 4, and every one of them priced at 0). The
 * behaviour is intact and merely rare, which is exactly the thing a sample
 * cannot promise to contain - so the cap is asserted where it can be stated
 * outright, and the sweep keeps only the opportunistic version of the check.
 */
describe('a pending draw', () => {
  it('prices a rented Draw Worker as the cards it will keep, not as zero', () => {
    const zeroes: number[] = [];
    const values: number[] = [];
    /** Split by whether the seat had room AFTER paying the visit fee. */
    const withRoom: number[] = [];
    const zeroesWithRoom: number[] = [];
    const noRoom: number[] = [];
    const nonZeroWithNoRoom: number[] = [];

    // Widened from 3 seeds on 2026-08-09, widened AGAIN for the Wheat rebuild
    // (across seat counts rather than seeds), and a THIRD time for the Vegetable
    // rebuild. Not widened a fourth time: the Apiary rebuild took the full-hand
    // subcase out of this net again, and the constructed test below now carries
    // that half instead. This sweep keeps the half a sample CAN carry - the rate
    // of zeroes where there is room - which is a property of the corpus in the
    // only sense that matters, since it is measured over hundreds of positions
    // rather than waiting on one rare shape to appear.
    for (const seats of [2, 3, 4]) {
      for (let n = 0; n < 20; n++) {
        const seed = `drawworker-${seats}-${n}`;
        // Rotate rather than slice: n now runs past 5 and a slice runs off the end.
        const suits = Array.from(
          { length: seats },
          (_, i) => SUITS[(n + i) % SUITS.length] as Suit,
        );
        const result = runGame(data, {
          seed,
          seats,
          suits,
          policies: assignProfiles(seed, seats),
          maxMoves: 600,
        });
        let state = newGame(data, { seed, seats, suits });
        for (const move of result.moves) {
          const seat = state.turnPlayer;
          const rented = legalMoves(data, state).filter((m) => {
            const act = actOf(m);
            return (
              m.seat === seat &&
              act.a === 'visit' &&
              act.payoff.mode === 'worker' &&
              act.payoff.workerId === 'draw'
            );
          });
          // O16 The Orchard Keeper pays the VISITOR a card just for visiting,
          // independently of the Draw. Before the suit Services (2026-08-10) that
          // co-occurrence was rare - the host had to have hired the Draw Worker
          // AND built O16 - and now every Orchard seat owns the Draw Service from
          // turn 1, so it is common. Those positions are excluded rather than
          // asserted away: the cap under test is on what the DRAW keeps, and a
          // card arriving from somewhere else is not that cap failing.
          const hostHasKeeper = rented.some((m) =>
            player(state, (m as Extract<Move, { type: 'visit' }>).host).tableau.some(
              (b) => b.card === 'O16',
            ),
          );
          if (rented.length > 0 && !hostHasKeeper) {
            const scratch = makeScratch(data, viewFor(data, state, seat));
            const prober = makeProber(data, state, seat);
            const outcomes = makeOutcomes(scratch, BALANCED, prober);
            const move = rented[0] as Move;
            const value = outcomes.value(move);
            values.push(value);
            if (value === 0) zeroes.push(value);
            // The room the pricer itself sees, measured BEFORE the draw and
            // AFTER the visit fee has left hand - which is the moment the cap
            // is applied at. Read off the hand and the fee, NOT off
            // `prober(move).handSize`: that is the hand once the draw has
            // already resolved, so a seat at the limit that kept exactly one
            // card comes back at the limit too, and the two cases are then
            // indistinguishable. First hit on 2026-08-09 by a Wheat seat at
            // 7/7 whose kept card exactly replaced its fee, which the old
            // reading filed under "no room" and then failed for pricing at a
            // correct 1.95.
            const limit = scratch.handLimit ?? Infinity;
            const roomBeforeDraw =
              limit - (player(state, seat).hand.length - (move as { fee: CardId[] }).fee.length);
            if (roomBeforeDraw > 0) {
              withRoom.push(value);
              if (value === 0) zeroesWithRoom.push(value);
            } else {
              noRoom.push(value);
              if (value !== 0) nonZeroWithNoRoom.push(value);
            }
          }
          state = apply(data, state, move).state;
        }
      }
    }

    // Vacuous unless a Draw Worker really was rentable with room in hand.
    expect(values.length, 'no seat was ever offered a rival Draw Worker').toBeGreaterThan(20);
    expect(withRoom.length, 'never offered one with room in hand').toBeGreaterThan(10);

    // Ticket 50's claim, where it can be tested: with room in hand the rollout
    // reaches the draw's payoff. It was 82.2% zero across all positions before
    // that fix, so a stray zero here would be a real regression rather than a
    // legitimate answer.
    expect(zeroesWithRoom.length / withRoom.length).toBeLessThan(0.1);
    // Ticket 49's cap, opportunistically: `noRoom` is empty in most corpora now,
    // so this says "and if the sweep did stumble on one, it priced at zero". The
    // non-vacuous version of the same claim is the next test.
    expect(nonZeroWithNoRoom).toEqual([]);
    // 60 full games of probing, so it wants more than the 5s default - and it
    // wants it stated here rather than raised globally, because every OTHER
    // test in the suite finishing inside 5s is worth knowing.
  }, 30_000);

  /**
   * Ticket 49's cap, constructed rather than hunted for.
   *
   * The shape is a seat OVER its hand limit taking its bonus-slot visit, which
   * is legal and does happen: the limit is checked at end of turn only, so a
   * Draw earlier in the turn can leave a seat above it. It is simply rare, and
   * three widenings of the sweep above proved that a sample cannot be relied on
   * to hold one.
   *
   * Built from a real `newGame` rather than from `testkit.makeState`, on purpose:
   * setup is what ties each Service to the seat whose suit brought it, and the
   * visit's ownership check reads that. Everything the position needs is the
   * opening table plus cards in one hand.
   */
  it('prices a rented Draw Service at zero once the hand is over its limit', () => {
    // The orchard seat owns the Draw Service from setup, so seat 0 is the renter.
    const rented = (state: GameState): Move | undefined =>
      legalMoves(data, state).find((m) => {
        const act = actOf(m);
        return (
          m.seat === 0 &&
          act.a === 'visit' &&
          act.payoff.mode === 'worker' &&
          act.payoff.workerId === 'draw'
        );
      });

    const opening = (): GameState =>
      newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'fullhand' });

    /**
     * The opening table with seat 0's hand topped up to exactly `size` cards.
     * Topped up through `testkit.dealTo`, so the cards come out of the deck they
     * belong to and the 105 ids are still conserved.
     */
    const atHandSize = (size: number): GameState => {
      const state = opening();
      const hand = player(state, 0).hand;
      expect(
        hand.length,
        'the opening hand is already past the size under test',
      ).toBeLessThanOrEqual(size);
      while (hand.length < size) {
        testkit.dealTo(data, state, 0, state.decks.wheat[0] as CardId);
      }
      return state;
    };

    const limit = makeScratch(data, viewFor(data, opening(), 0)).handLimit as number;
    expect(limit, 'the wheat Barn must print a hand limit').toBeGreaterThan(0);

    const priceAt = (size: number): number => {
      const state = atHandSize(size);
      const move = rented(state);
      expect(move, `no rival Draw Service was offered at a hand of ${size}`).toBeDefined();
      const scratch = makeScratch(data, viewFor(data, state, 0));
      const prober = makeProber(data, state, 0);
      return makeOutcomes(scratch, BALANCED, prober).value(move as Move);
    };

    // At the limit the fee makes room for exactly one card, so the rental is
    // still worth something - the case the sweep above measures in bulk.
    expect(
      priceAt(limit),
      'a hand at the limit still has room once the fee leaves',
    ).toBeGreaterThan(0);
    // One over, the fee only gets the seat back TO the limit and the draw keeps
    // nothing. Exact arithmetic, so the assertion is an absolute.
    expect(priceAt(limit + 1)).toBe(0);
    expect(priceAt(limit + 2)).toBe(0);
  });
});

/**
 * Ticket 49. `grantBalloonReward` pushes a real ability - Draw 4, Sow 4 from
 * hand, a build at a discount, or £4 - and all four scored the identical flat
 * `balloon` weight, which is the shape ticket 40 deleted for GROW. Two claims,
 * and the second is the one that stops it coming back: the pricer must not pay
 * the flat weight, because the move term already does, and a weight charged in
 * two places is how `growSpend`, `buildSpend` and `deliverCost` each went wrong.
 */
describe('a balloon move', () => {
  /**
   * Every distinct balloon priced, over real games - through the `outcome` TERM
   * rather than through `Outcomes.value`, which is the difference between
   * testing the pricer and testing the bot. `value` will roll a balloon out
   * whether or not anything asks it to; only the term consults `isProbed`, so
   * only the term fails when a balloon is taken back out of it.
   */
  function priceBalloons(weights = BALANCED): Map<string, number[]> {
    const outcome = TERMS.find((t) => t.name === 'outcome');
    if (!outcome) throw new Error('no `outcome` term');
    const seen = new Map<string, number[]>();
    for (const seats of [2, 3]) {
      const seed = `balloon-${seats}`;
      // The Aerodrome is only in play with Vegetables at the table.
      const suits = SUITS.slice(1, 1 + seats);
      const result = runGame(data, { seed, seats, suits, policies: assignProfiles(seed, seats) });
      let state = newGame(data, { seed, seats, suits });
      for (const move of result.moves) {
        const seat = state.tasks[0]?.pid ?? state.turnPlayer;
        const balloons = legalMoves(data, state).filter(
          (m) => m.seat === seat && m.type === 'moveBalloon',
        );
        if (balloons.length > 0) {
          const scratch = makeScratch(data, viewFor(data, state, seat));
          const outcomes = makeOutcomes(scratch, weights, makeProber(data, state, seat));
          for (const m of balloons) {
            const id = (m as Extract<Move, { type: 'moveBalloon' }>).balloon;
            const list = seen.get(id) ?? [];
            list.push(outcome.feature(actOf(m), scratch, m, outcomes));
            seen.set(id, list);
          }
        }
        state = apply(data, state, move).state;
      }
    }
    return seen;
  }

  it('prices the four balloons by what they grant, not by one constant', () => {
    const seen = priceBalloons();
    expect(seen.size, 'no balloon was ever movable').toBeGreaterThan(2);
    const means = [...seen.values()].map((vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
    // Every one of these was the identical flat weight before the probe.
    expect(new Set(means.map((m) => m.toFixed(6))).size).toBe(means.length);
    // And the spread has to be a real preference, not floating-point noise:
    // measured 4.8 to 9.9 over 55 games, against a flat 2 for all four.
    expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(1);
  });

  it('never pays the flat balloon weight inside the pricer', () => {
    // The invariant that keeps the two halves apart. `balloon` is a MOVE term,
    // the way `grow` is; the pricer charges the freight and walks the reward.
    // So cranking the weight must move nothing here - and the control is that
    // it moves everything if `balloonMoved` ever pays it again.
    const plain = priceBalloons();
    const cranked = priceBalloons({ ...BALANCED, balloon: 1000 });
    for (const [id, values] of plain) {
      expect(cranked.get(id), `balloon ${id}`).toEqual(values);
    }
  });
});

describe('the coin runway', () => {
  /**
   * Ticket 37's finding, kept as the PAIRED CONTROL for the card buy.
   *
   * Without the buy, a coin above everything the seat can spend on is worth
   * exactly nothing, and that is what made 65% of every coin minted dead. With
   * the buy live it is worth its face value, because there is always a card to
   * turn it into. Both halves are asserted here so the claim the rule rests on
   * is a test rather than a sentence, and so the paired sim run is measuring the
   * rule rather than a re-tuned bot.
   */
  /**
   * ⚠️ THE ARMS SWAPPED SIDES ON 19/08/2026, and the test had to swap with
   * them. `rules.turn.buyCost` is now null in the shipped rules, so the
   * buy-less half is the base game and it is the BUY that has to be reached for
   * through an overlay. Both halves keep their overlays anyway and neither
   * reads `data` bare: an assertion about what a coin is worth WITH the buy
   * must not silently become an assertion about the shipped game the next time
   * the knob moves, which is exactly how this test went red today. Same
   * re-pointing the engine's own suite took.
   */
  const noBuy = loadGameData({
    name: 'no-card-buy',
    schemaVersion: 1,
    set: { 'rules.turn.buyCost': null },
  });
  const withBuy = loadGameData({
    name: 'card-buy',
    schemaVersion: 1,
    // 1 is the price the rule shipped at from 2026-08-03 until it was switched
    // off; `overlays/turn-structure-v14.overlay.json` restores the same number.
    set: { 'rules.turn.buyCost': 1 },
  });

  it('values a coin at nothing once the seat has bought everything it can', () => {
    const state = newGame(noBuy, { seats: 2, suits: ['wheat', 'orchard'], seed: 'runway' });
    const seat = state.turnPlayer;
    const scratch = makeScratch(noBuy, viewFor(noBuy, state, seat));
    // A fresh seat has real sinks: a Worker to hire and two starters to flip.
    expect(scratch.coinRunway).toBeGreaterThan(0);
    expect(scratch.coins).toBe(noBuy.rules.setup.startingCoins);
    expect(scratch.coinNeverDead).toBe(false);

    const rich = { ...scratch, coins: scratch.coinRunway + 10 };
    expect(coinWorth(rich, 3)).toBe(0);
    expect(coinWorth(scratch, 1)).toBe(1);
  });

  it('values a coin at its face value while the card buy is live', () => {
    const state = newGame(withBuy, { seats: 2, suits: ['wheat', 'orchard'], seed: 'runway' });
    const seat = state.turnPlayer;
    const scratch = makeScratch(withBuy, viewFor(withBuy, state, seat));
    expect(scratch.coinNeverDead).toBe(true);

    const rich = { ...scratch, coins: scratch.coinRunway + 10 };
    expect(coinWorth(rich, 3)).toBe(3);
  });

  it('sees the cheapest thing the seat still wants, affordable or not', () => {
    // A fresh seat wants two starter flips (the hire is gone: every seat owns
    // its Service from setup). The gap is the cheapest of them, and it stays
    // the cheapest once the seat can pay - which is the whole point: "would
    // buying leave me short" is not "am I short now".
    const cheapest = data.rules.economy.upgradeCostCoins;
    const broke = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'runway' });
    const poor = makeScratch(data, viewFor(data, broke, broke.turnPlayer));
    expect(poor.sinkGap).toBe(cheapest);

    const flush = loadGameData({
      name: 'flush',
      schemaVersion: 1,
      set: { 'rules.setup.startingCoins': cheapest },
    });
    const paid = newGame(flush, { seats: 2, suits: ['wheat', 'orchard'], seed: 'runway' });
    expect(makeScratch(flush, viewFor(flush, paid, paid.turnPlayer)).sinkGap).toBe(cheapest);
  });
});
