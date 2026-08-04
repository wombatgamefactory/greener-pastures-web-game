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
import type { GameState, Move } from '@gp/engine';
import { apply, legalMoves, makeProber, newGame, seedRng, shuffle, viewFor } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import {
  BALANCED,
  actOf,
  coinWorth,
  makeOutcomes,
  makePolicy,
  makeScratch,
  policyRng,
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
 */
describe('a pending draw', () => {
  it('prices a rented Draw Worker as the cards it will keep, not as zero', () => {
    const zeroes: number[] = [];
    const values: number[] = [];

    for (const seats of [2, 3]) {
      for (let n = 0; n < 3; n++) {
        const seed = `drawworker-${seats}-${n}`;
        const suits = SUITS.slice(n, n + seats);
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
          if (rented.length > 0) {
            const scratch = makeScratch(data, viewFor(data, state, seat));
            const outcomes = makeOutcomes(scratch, BALANCED, makeProber(data, state, seat));
            const value = outcomes.value(rented[0] as Move);
            values.push(value);
            if (value === 0) zeroes.push(value);
          }
          state = apply(data, state, move).state;
        }
      }
    }

    // Vacuous unless a Draw Worker really was rentable.
    expect(values.length, 'no seat was ever offered a rival Draw Worker').toBeGreaterThan(20);
    // It was 82.2% before the fix. A stray zero is a legitimate position (an
    // empty supply), so this is a rate rather than an absolute.
    expect(zeroes.length / values.length).toBeLessThan(0.1);
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
  const noBuy = loadGameData({
    name: 'no-card-buy',
    schemaVersion: 1,
    set: { 'rules.turn.buyCost': null },
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
    const state = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'runway' });
    const seat = state.turnPlayer;
    const scratch = makeScratch(data, viewFor(data, state, seat));
    expect(scratch.coinNeverDead).toBe(true);

    const rich = { ...scratch, coins: scratch.coinRunway + 10 };
    expect(coinWorth(rich, 3)).toBe(3);
  });

  it('sees the cheapest thing the seat still wants, affordable or not', () => {
    // A fresh seat wants a Worker and two starter flips. The gap is the cheapest
    // of them, and it stays the cheapest of them once the seat can pay - which
    // is the whole point: "would buying leave me short" is not "am I short now".
    // Filtering to the unaffordable ones made a seat on exactly £2 read null,
    // buy a card, and lose the Worker it was one coin away from.
    const broke = newGame(data, { seats: 2, suits: ['wheat', 'orchard'], seed: 'runway' });
    const poor = makeScratch(data, viewFor(data, broke, broke.turnPlayer));
    const cheapest = Math.min(data.workers.hireFee, data.rules.economy.upgradeCostCoins);
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
