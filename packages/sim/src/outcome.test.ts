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
import {
  apply,
  legalMoves,
  makeProber,
  newGame,
  player,
  seedRng,
  shuffle,
  viewFor,
} from '@gp/engine';
import { describe, expect, it } from 'vitest';

import {
  BALANCED,
  MEEPLE_AS_CARD_DOOR_PREMIUM,
  MEEPLE_AS_CARD_LIVE,
  MEEPLE_LATENT,
  actOf,
  makeOutcomes,
  makePolicy,
  makeScratch,
  meepleWorth,
  policyRng,
  TERMS,
} from '@gp/bots';

import { assignProfiles, runGame } from './driver.js';
import { meanInterval, separated } from './stats.js';

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
 * Ticket 50, RE-POINTED FOR v31 (02/09/2026). A `draw` task takes one `deck`
 * answer per card REVEALED and only then a `keep`, and `cardsToHand` - the only
 * priced event in the effect - fires on the keep. At `DEPTH = 3` that put
 * everything drawing 3 or more beyond the rollout's reach, and the worst case
 * was the door the design calls a traffic magnet: priced at exactly zero in
 * 82.2% of the positions it was offered in, against 0.0% for the other four.
 *
 * ⭐ THE SAME TRAP IS SET ONE CARD DEEPER IN v31, which is why this test
 * survives its subject being renamed twice. The Orchard door is **Draw 3** -
 * the one printed exception in the door set - and it is exactly the thing a
 * depth limit cannot see. A visitor paying one card onto an Orchard seat's
 * Notice Board and taking Draw 3 must not price at zero.
 *
 * ⛔ THE HAND-ROOM HALF OF THIS TEST IS DELETED, AND THAT IS A RULE DELETION
 * rather than a test being loosened. Ticket 49 capped a pending draw at the
 * room left under the Barn's printed hand size, because a card drawn into the
 * end-of-turn discard is an action thrown away - measured on the Draw 4 balloon,
 * which the bots took 32.9% of the time with no room at all. v31 prints no hand
 * size and has no discard, so there is nothing to cap against and the two tests
 * that asserted the cap (a corpus sweep and a constructed over-limit position)
 * assert a rule that does not exist. What that removes from the instrument is a
 * BRAKE, not a bias, and the consequence points one way: a draw can never be a
 * bad move now, so every door and every meeple that draws is worth strictly
 * more than it used to be, and the Orchard door is the biggest beneficiary in
 * the game. If the door mix comes back Orchard-heavy, this is the first thing
 * to check - and the check is a rules question, not a bot one.
 */
describe('a pending draw', () => {
  it('prices a visit to the Draw 3 door as the cards it will keep, not as zero', () => {
    const zeroes: number[] = [];
    const values: number[] = [];

    // The Orchard seat's board IS the Draw 3 door, so every cell below has one
    // and the visitor is whoever is not farming Orchard. Rotating the suits
    // rather than slicing keeps every pairing in the sample.
    //
    // ⭐ THE FULL NET IS BACK (03/09/2026): 20 seeds at 2, 3 and 4 seats, and
    // no move cap. It was cut to 6 seeds at 2 and 3 seats with `maxMoves: 250`
    // on 02/09/2026, when a v31 game cost minutes rather than milliseconds
    // because the hand limit had been deleted and legal-move enumeration went
    // combinatorial in hand size. `rules.turn.handLimit` came back the same
    // day and a 2-seat game is under a second again, so the sample that was
    // cut for affordability is restored. What the claim needs is POSITIONS
    // rather than games, and the guard below still refuses to pass on fewer
    // than 20 offers, so a thin sample fails loudly rather than vacuously.
    for (const seats of [2, 3, 4]) {
      for (let n = 0; n < 20; n++) {
        const seed = `drawdoor-${seats}-${n}`;
        const suits = Array.from(
          { length: seats },
          (_, i) => SUITS[(n + i) % SUITS.length] as Suit,
        );
        if (!suits.includes('orchard')) continue;
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
          const offered = legalMoves(data, state).filter((m) => {
            const act = actOf(m);
            return (
              m.seat === seat &&
              act.a === 'visit' &&
              !act.self &&
              player(state, act.host).suit === 'orchard'
            );
          });
          // O16 The Orchard Keeper pays the VISITOR a card just for visiting,
          // independently of the Draw, so a value above zero there proves
          // nothing about the draw. Those positions are excluded rather than
          // asserted away: the claim under test is that the DRAW is visible.
          const hostHasKeeper = offered.some((m) =>
            player(state, (m as Extract<Move, { type: 'visit' }>).host).tableau.some(
              (b) => b.card === 'O16',
            ),
          );
          if (offered.length > 0 && !hostHasKeeper) {
            const scratch = makeScratch(data, viewFor(data, state, seat));
            const prober = makeProber(data, state, seat);
            const outcomes = makeOutcomes(scratch, BALANCED, prober);
            const value = outcomes.value(offered[0] as Move);
            values.push(value);
            if (value === 0) zeroes.push(value);
          }
          state = apply(data, state, move).state;
        }
      }
    }

    // Vacuous unless a rival Orchard door really was reachable.
    expect(values.length, 'no seat was ever offered a rival Draw 3 door').toBeGreaterThan(20);
    // Ticket 50's claim, restated on the door that replaced the Worker. It was
    // 82.2% zero before that fix, so a stray zero here is a real regression
    // rather than a legitimate answer: with no hand limit there is no position
    // in which drawing three cards is worth nothing.
    expect(zeroes.length / values.length).toBeLessThan(0.1);
    // Sixty games of probing, so it wants far more than the 5s default - and it
    // wants it stated here rather than raised globally, because a test that
    // needs a budget should say so where it needs one.
  }, 300_000);
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
   *
   * ⭐ THE SAMPLE WAS WIDENED ON 03/09/2026 AND THAT IS PART OF THE FIX. It used
   * to be ONE seed at each of two seat counts, and while the hand limit was
   * deleted it was also capped at 250 moves to stay affordable. That sample
   * produced a spread statistic that swung between 0.54 and 2.13 FOR THE SAME
   * RULES depending only on where the cap fell - which is not a calibration,
   * it is a coin flip. Six full games across 2, 3 and 4 seats give 350 to 570
   * priced offers per balloon and cost about 25 seconds, which is affordable
   * again only because `rules.turn.handLimit` came back.
   *
   * ⭐ WIDENED AGAIN ON 04/09/2026, TO TWELVE GAMES, and for the same reason a
   * second time. The meeple loop changed how often a balloon is on offer at all
   * (the bonus slot no longer spends a card, the turn-start meeple phase is
   * gone), and at six games the two claims below disagreed: the SPREAD was a
   * healthy 0.787, comfortably over the floor, while the 95% intervals of the
   * dearest and cheapest balloon overlapped by 0.04 - a sample too thin to
   * separate them, not a pricer that had stopped preferring. Twelve games reads
   * spread 1.499 and separates cleanly. NOTHING WAS LOOSENED: the floor is
   * untouched at 0.35, the separation claim is untouched, and the sample it is
   * asked of is bigger. Twelve games cost about 2 seconds here, which is what
   * makes it the cheap answer rather than the thorough one.
   */
  function priceBalloons(weights = BALANCED): Map<string, number[]> {
    const outcome = TERMS.find((t) => t.name === 'outcome');
    if (!outcome) throw new Error('no `outcome` term');
    const seen = new Map<string, number[]>();
    for (const seats of [2, 3, 4]) {
      for (const run of [0, 1, 2, 3]) {
        const seed = `balloon-${seats}-${run}`;
        // The Aerodrome is only in play with Vegetables at the table.
        const suits = SUITS.slice(1, 1 + seats);
        const result = runGame(data, {
          seed,
          seats,
          suits,
          policies: assignProfiles(seed, seats),
        });
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
    }
    return seen;
  }

  /**
   * ⚠️⚠️ **THIS CONSTANT IS HAND-LIMIT DEPENDENT. RE-CUT IT WHENEVER
   * `rules.turn.handLimit` MOVES.**
   *
   * It was 1.0, measured in 2026-08 under the per-Barn hand size, and it
   * survived into v31 where there was no limit at all. Re-cut 03/09/2026,
   * over the widened sample above. Measured twice on the same day, because the
   * limit moved under it between the two:
   *
   *   limit  5   spread 1.906   SEPARATED
   *   limit  7   spread 1.313   SEPARATED   <- shipped
   *   limit  9   spread 1.424   SEPARATED
   *   limit 10   spread 1.909   SEPARATED
   *   limit 12   spread 0.539   SEPARATED
   *   limit 15   spread 1.318   SEPARATED
   *   limit 18   spread 0.563   SEPARATED
   *
   * The mechanism is the draw-value cap: a pending draw is priced at the cards
   * it will KEEP, and room in hand is what decides how many that is, so a Draw
   * 4 balloon really is worth less into a nearly full hand. What the ladder
   * also shows is that **the relationship is not monotone** - 12 and 18 sit
   * near 0.55 while 10 and 15 sit near 1.3 to 1.9 - because the limit moves the
   * LEVEL of every balloon's price as well as the gaps between them. So this is
   * a number to re-measure, never one to extrapolate.
   *
   * 0.35 was cut against limit 12's 0.539, which was the shipped value for the
   * few hours it held, and it is a third of margin below the SMALLEST cell in
   * the whole ladder. The shipped 7 reads 1.313, so the floor now sits nearly
   * four times below the live value - loose, and deliberately left there rather
   * than tightened to the current rung, because 12 proved the statistic can
   * halve without anything being wrong. A floor of 0.5 would have sat within 8%
   * of two cells, which is a threshold that fails on a re-run rather than on a
   * regression.
   */
  const SPREAD_FLOOR = 0.35;

  it(
    'prices the four balloons by what they grant, not by one constant',
    { timeout: 300_000 },
    () => {
      const seen = priceBalloons();
      expect(seen.size, 'no balloon was ever movable').toBeGreaterThan(2);
      const rows = [...seen.values()]
        .map((vs) => ({
          mean: vs.reduce((a, b) => a + b, 0) / vs.length,
          interval: meanInterval(vs),
        }))
        .sort((a, b) => b.mean - a.mean);
      const means = rows.map((r) => r.mean);
      // Every one of these was the identical flat weight before the probe.
      expect(new Set(means.map((m) => m.toFixed(6))).size).toBe(means.length);

      // THE CLAIM THAT DOES NOT NEED RE-CUTTING: the dearest balloon and the
      // cheapest are separated at 95%, so the preference is real rather than
      // four different roundings of one number. It held at every rung of the
      // hand-limit ladder above, which the absolute spread did not, and it is
      // the assertion to trust if the two ever disagree.
      const best = rows[0];
      const worst = rows[rows.length - 1];
      expect(best && worst && separated(best.interval, worst.interval)).toBe(true);

      // And the absolute gap, which is the limit-dependent half - see the
      // comment on SPREAD_FLOOR before touching this.
      expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(SPREAD_FLOOR);
    },
  );

  it('never pays the flat balloon weight inside the pricer', { timeout: 300_000 }, () => {
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

describe('what a meeple is worth', () => {
  const opening = (suits: Suit[]): GameState =>
    newGame(data, { seats: suits.length, suits, seed: 'meeple-worth' });

  /** The v1 loop, where a meeple is ONLY a visit. `overlays/meeple-loop-v1`. */
  const v1 = loadGameData({
    name: 'meeple-loop-v1',
    schemaVersion: 1,
    set: {
      'rules.turn.visitCurrency': 'meeple',
      'rules.turn.meepleAsCard': false,
      'rules.turn.slotToll': null,
      'rules.turn.meepleCapPerColour': 1,
    },
  });

  it('prices a colour this seat can use above one it cannot, under the v1 loop', () => {
    // An opening seat has an empty barn and nothing full, so the Deliver and
    // Harvest doors can do nothing for it while the Draw door always can. That
    // is the whole of the claim: usable now beats usable later.
    //
    // ⚠️ PINNED TO THE v1 LOOP ON 05/09/2026, because it stopped being true of
    // the shipped game that day - see the case below, which is the same claim
    // failing on purpose. The door-worth logic this pins is still live: it is
    // what prices a meeple whenever `meepleAsCard` is off.
    const state = newGame(v1, { seats: 2, suits: ['wheat', 'orchard'], seed: 'meeple-worth' });
    const scratch = makeScratch(v1, viewFor(v1, state, 0));
    expect(meepleWorth(scratch, 'orchard')).toBeGreaterThan(meepleWorth(scratch, 'vegetable'));
    // ...and a latent colour is worth SOMETHING, not zero: a meeple is spent on
    // a future turn, and almost every dead door comes back within a turn or two.
    expect(meepleWorth(scratch, 'vegetable')).toBe(MEEPLE_LATENT);
    expect(MEEPLE_LATENT).toBeGreaterThan(0);
  });

  /**
   * ⛔ THE SHIPPED GAME PRICES EVERY COLOUR THE SAME, AND THAT IS LEDGER C64
   * RATHER THAN A BUG. Since 05/09/2026 a meeple pays wherever a card of its
   * colour would, so `meepleWorth` leaves the door-worth branch entirely and
   * returns the flat `MEEPLE_AS_CARD_LIVE`, which is `MEEPLE_AS_CARD_FLOOR`
   * plus a `MEEPLE_AS_CARD_DOOR_PREMIUM` that ships at ZERO.
   *
   * The consequence, written here because a balance number will not show it:
   * THE BOTS ARE COLOUR-BLIND ABOUT WHICH MEEPLE TO BURN. R15 asks a real
   * question - a colour given up is a door you cannot buy next turn - and at a
   * flat worth no bot has a preference. The premium was shipped at 0 on the
   * paired-arm rule (a premium taxes every visit in the arm and none in the
   * control, so the hook delta would become a mixture of the rule and the
   * instrument), and a smoke sample at n=12 moved rival visits 125 to 45 at a
   * premium of 0.6. This case exists so that raising it fails HERE, loudly,
   * rather than surfacing as a door mix nobody can explain.
   */
  it('prices every colour the same under the shipped rules, which is C64', () => {
    const state = opening(['wheat', 'orchard']);
    const scratch = makeScratch(data, viewFor(data, state, 0));
    expect(MEEPLE_AS_CARD_DOOR_PREMIUM).toBe(0);
    const worths = SUITS.map((colour) => meepleWorth(scratch, colour));
    expect(new Set(worths).size).toBe(1);
    expect(worths[0]).toBe(MEEPLE_AS_CARD_LIVE);
  });

  it('prices a colour no seat is farming, because a meeple of it still works', () => {
    // The five door actions exist independently of who farms what, so a colour
    // out of the game is looked up in `workers.roster` and priced normally.
    // This is the half a `state.fair` lookup would have got wrong.
    const state = opening(['wheat', 'orchard']);
    const scratch = makeScratch(data, viewFor(data, state, 0));
    for (const colour of SUITS) expect(meepleWorth(scratch, colour)).toBeGreaterThan(0);
  });

  it('pins the price to itself in both directions', () => {
    // ⚠️ THE HOARDING KNOB, and it is pinned rather than tuned: `meepleGain`
    // credits this when a delivery hands a meeple over and `meepleSpend`
    // charges exactly the same number when one is spent, so a meeple is neither
    // created nor destroyed by the bot's own accounting and the decision to
    // spend one turns entirely on whether the rolled-out action beats the
    // stock. Raise it and the bots hoard; lower it and they dump. Neither the
    // 2.5 nor MEEPLE_LATENT's 0.4 has a measurement behind it.
    expect(BALANCED['meepleSpend']).toBe(BALANCED['meepleGain']);
  });
});
