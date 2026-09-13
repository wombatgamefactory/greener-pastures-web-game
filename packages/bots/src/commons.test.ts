/**
 * THE BOTS UNDER THE COMMONS (C1-C10, 09/09/2026), and under the two controls
 * the commons must not have moved.
 *
 * ⚠️ **THIS FILE WALKS WHOLE GAMES, WHICH THE REST OF THIS PACKAGE'S TESTS
 * DELIBERATELY DO NOT.** `roster.test.ts` says so at the top: the game-walking
 * proofs live with the driver in @gp/sim, because that is where the driver is.
 * They are here anyway, and the reason is the flip itself - the commons became
 * the engine DEFAULT rather than an arm, so "does a bot ever take the one bonus
 * option the game has, and does the game still end" stopped being a simulator
 * question and became this package's own correctness. The loop below is a
 * deliberately minimal copy of `runGame`, with no metrics, no capture and no
 * profile assignment; if it ever grows a third responsibility it belongs in the
 * sim instead.
 *
 * ⛔ Nothing here may name the engine's truth type, and nothing does: the moves
 * come back from the enumerator and the position is only ever passed along. That
 * is the boundary `boundary.test.ts` in @gp/sim reads this very file to check.
 */

import { BASE_GAME_DATA, loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { apply, isOver, legalMoves, makeProber, newGame, testkit, viewFor } from '@gp/engine';
import type { Move } from '@gp/engine';
import { describe, expect, it } from 'vitest';

import { makePolicy, policyRng } from './roster.js';
import { cardById } from './scratch.js';
import type { PolicyId } from './roster.js';

/**
 * Suits by seat count, in catalogue order, so a seed means the same table every
 * time. Wheat and Vegetable first because they are the two suits whose doors do
 * the most work (Harvest and Deliver), which keeps a short game moving.
 */
const TABLE: Record<number, Suit[]> = {
  2: ['wheat', 'vegetable'],
  3: ['wheat', 'vegetable', 'orchard'],
  4: ['wheat', 'vegetable', 'orchard', 'apiary'],
};

interface Walk {
  readonly moves: readonly Move[];
  readonly ended: boolean;
  readonly crash: string | null;
}

/**
 * One game, driven by the given policies. A copy of @gp/sim's `runGame` cut down
 * to what a bots test needs, including its idle guard: `pass` and `endTurn` are
 * the only moves that can repeat forever, so two full rounds of nothing else
 * means the table has locked rather than that a bot is dithering.
 */
function walk(
  data: GameData,
  spec: { seats: number; seed: string; policies: readonly PolicyId[]; maxMoves?: number },
): Walk {
  const policies = spec.policies.map((id) => makePolicy(id));
  const rngs = policies.map((policy, seat) => policyRng(spec.seed, seat, policy.id));
  const maxMoves = spec.maxMoves ?? 6000;
  const idleLimit = spec.seats * 4;

  let state = newGame(data, {
    seats: spec.seats,
    suits: TABLE[spec.seats] as Suit[],
    seed: spec.seed,
  });
  const moves: Move[] = [];
  let idle = 0;
  let crash: string | null = null;

  try {
    while (!isOver(state) && moves.length < maxMoves && idle < idleLimit) {
      const legal = legalMoves(data, state);
      if (legal.length === 0) throw new Error('No legal moves and the game is not over');
      const seat = (legal[0] as Move).seat;
      const policy = policies[seat];
      const rng = rngs[seat];
      if (!policy || !rng) throw new Error(`No policy for seat ${seat}`);
      const move = policy.choose({
        data,
        view: viewFor(data, state, seat),
        moves: legal,
        rng,
        probe: makeProber(data, state, seat),
      });
      state = apply(data, state, move).state;
      moves.push(move);
      idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
    }
  } catch (error) {
    crash = error instanceof Error ? error.message : String(error);
  }

  return { moves, ended: isOver(state), crash };
}

function countOf(moves: readonly Move[], type: Move['type']): number {
  return moves.filter((move) => move.type === type).length;
}

/** The mixed table the balance runs seat, in a fixed order so a seed reproduces. */
const MIXED: PolicyId[] = ['balanced', 'socialite', 'loyalist', 'racer'];

describe('the commons, under the shipped default', () => {
  // ⭐ THE ONE READING THAT WOULD HAVE MADE EVERY OTHER NUMBER MEANINGLESS. The
  // commons is the whole of the bonus slot (C9), so a bot that never plays a
  // card onto a board is a bot playing a strictly smaller game - and the pass's
  // headline is the play rate against Dean's 30-60% band, which an instrument
  // that could not reach the slot would report as a rule nobody wants.
  for (const seats of [2, 3, 4]) {
    it(`plays cards onto the central boards, and the game still ends at ${seats} seats`, () => {
      const walked = walk(BASE_GAME_DATA, {
        seats,
        seed: `commons-${seats}`,
        policies: MIXED.slice(0, seats),
      });
      expect(walked.crash).toBeNull();
      expect(walked.ended).toBe(true);
      expect(countOf(walked.moves, 'commons')).toBeGreaterThan(0);
      // No meeples anywhere (C6), so neither of the meeple game's bonus options
      // may ever enumerate - a stray one would mean the mode gate leaked.
      expect(countOf(walked.moves, 'spendMeeple')).toBe(0);
      expect(countOf(walked.moves, 'collect')).toBe(0);
      expect(countOf(walked.moves, 'visit')).toBe(0);
    });
  }

  // ⭐ THE TWO CONTROLS THAT BRACKET DEAN'S BAND. `hermit` vetoes the `visit`
  // term, which claims the commons play, so it never spends the slot at all;
  // `socialite` pays 8 for one. If these two ever read the same, the profiles
  // have stopped pointing at the shipped bonus slot and every arm run through
  // them is measuring one bot.
  it('has the socialite play far more than the hermit, and the hermit not at all', () => {
    let socialite = 0;
    let hermit = 0;
    for (const seed of ['batch-a', 'batch-b', 'batch-c']) {
      socialite += countOf(
        walk(BASE_GAME_DATA, { seats: 2, seed, policies: ['socialite', 'socialite'] }).moves,
        'commons',
      );
      hermit += countOf(
        walk(BASE_GAME_DATA, { seats: 2, seed, policies: ['hermit', 'hermit'] }).moves,
        'commons',
      );
    }
    expect(hermit).toBe(0);
    expect(socialite).toBeGreaterThan(hermit);
  });

  // The property every balance number rests on: a seed is a game. It held
  // through v31, the meeple loop and the meeple economy, and the commons adds a
  // window that fires before the main action (C2), which is exactly the kind of
  // re-ordering that breaks it.
  it('replays a seed move for move', () => {
    const spec = { seats: 3, seed: 'same-seed', policies: MIXED.slice(0, 3) };
    const first = walk(BASE_GAME_DATA, spec);
    const second = walk(BASE_GAME_DATA, spec);
    expect(first.crash).toBeNull();
    expect(second.moves).toEqual(first.moves);
  });

  // C2's paired control. Under `'end'` the bonus OPENS when the action is spent,
  // so `windowedPick` returns null and the ordinary argmax has its say after the
  // main action - the path both meeple controls and the v31 control take. The
  // point of the case is that the bots still spend the slot there: a window that
  // only fires under `'start'` must not be the only thing reaching a commons
  // play, or the overlay would measure the bot rather than the timing.
  it('still plays onto a board under commons-bonus-last', () => {
    const bonusLast = loadGameData({
      name: 'commons-bonus-last',
      schemaVersion: 1,
      set: { 'rules.turn.bonusTiming': 'end' },
    });
    const walked = walk(bonusLast, {
      seats: 2,
      seed: 'bonus-last',
      policies: ['balanced', 'socialite'],
    });
    expect(walked.crash).toBeNull();
    expect(countOf(walked.moves, 'commons')).toBeGreaterThan(0);
  });
});

/**
 * ⭐ THE COMMONS WITH COINS (K1-K15, `docs/commons-coins-handoff-2026-09-10-v2.md`,
 * 10/09/2026), which is an ARM and not the default.
 *
 * ⚠️ **THESE CASES ASSERT THAT THE ECONOMY CLOSES, AND NOTHING ELSE.** A coin
 * arithmetic with one mint and two sinks fails in exactly one silent way: the
 * bots mint coins and never spend them, which is what ticket 37 measured of the
 * v31 coin (65.4% of every coin minted never spent on anything) and what the
 * arm's a19 "dead coins" line exists to read. A bot that cannot see a coin's
 * worth would take the free pile all game and leave the Farmstead cold, and
 * every number in the pass would be about this package rather than about K7.
 * So: the mint fires, BOTH sinks fire, the pair gets played, and the game ends.
 * The RATES are the simulator's business and are deliberately not asserted here.
 */
describe('the commons with coins, the arm', () => {
  const coins = loadGameData({
    name: 'commons-coins-v1',
    schemaVersion: 1,
    // The seven passengers of `overlays/commons-coins-v1.overlay.json`, spelled
    // out rather than loaded, so this case cannot start passing or failing
    // because somebody edited an overlay file.
    set: {
      'rules.economy.cropScorerOnBarn': false,
      'rules.turn.visitCurrency': 'commons',
      'rules.turn.bonusTiming': 'start',
      'rules.turn.commonsTake': 'coins',
      'rules.economy.commonsColourMatch': true,
      'rules.economy.commonsWildPair': true,
      'rules.economy.endgameCoinCost': 3,
      'rules.economy.farmsteadCoinPower': true,
      // ⛔ PRE-FLIP PINS (12/09/2026). This arm predates Dean's Village Store
      // ruling and must not inherit a SECOND coin system from the base: with the
      // Store's sinks live, a coin is spent on a Grow or a build before it can
      // ever reach the Endgame price this case measures, and the case silently
      // reads zero. The Store and the one-card flight are pinned off by name.
      'rules.economy.storeCoinsPerCard': 0,
      'rules.economy.coinSupplyPerPlayer': 0,
      'rules.economy.coinPaysBuild': false,
      'rules.economy.coinPaysSuitCost': false,
      'rules.economy.coinPaysGrow': false,
      'rules.economy.coinGrowOnFullBuilding': false,
      'aerodrome.moveCost.barnCards': 2,
      'aerodrome.alwaysInPlay': false,
      'aerodrome.flightMints': false,
      'aerodrome.balloons.balloonDraw.reward.type': 'draw',
      'aerodrome.balloons.balloonBuild.reward.type': 'buildDiscount',
      'aerodrome.balloons.balloonSow.reward.type': 'sowFromHand',
      'aerodrome.balloons.balloonCoins.reward.type': 'harvestAny',
    },
  });

  it('mints coins, spends them on the Farmstead, plays the pair, and still ends', () => {
    let mints = 0;
    let farmstead = 0;
    let pairs = 0;
    for (const seed of ['coins-a', 'coins-b', 'coins-c']) {
      const walked = walk(coins, { seats: 3, seed, policies: MIXED.slice(0, 3) });
      expect(walked.crash, seed).toBeNull();
      expect(walked.ended, seed).toBe(true);
      for (const move of walked.moves) {
        // The mint (K3/K8): clear a pile, one coin per card. No fee is ever
        // offered under `'coins'`, so a take here is always the free option.
        if (move.type === 'commonsTake') mints += 1;
        // Sink one (K10): the coin-activated Farmstead, a main-action GROW that
        // places nothing. `coin` is `true` or absent, never `false`.
        if (move.type === 'grow' && move.coin === true) farmstead += 1;
        // The wild pair (K3), built for the first time in this arm.
        if (move.type === 'commons' && move.fee2 !== undefined) pairs += 1;
      }
    }
    expect(mints).toBeGreaterThan(0);
    expect(farmstead).toBeGreaterThan(0);
    expect(pairs).toBeGreaterThan(0);
  });

  /**
   * ⛔ **NOBODY IS BUYING AN ENDGAME CARD FOR WHAT IT SCORES, UNDER EITHER GAME,
   * AND THAT IS A PRE-EXISTING INSTRUMENT BLIND SPOT RATHER THAN A COIN PRICE.**
   *
   * All fifteen Endgame cards print **0 VP** and their whole worth is a game-end
   * handler, and nothing in `terms.ts` prices a game-end handler. So an Endgame
   * card is worth `build` 3 plus `farmsteadVp` 1.5 to a bot, whatever it
   * actually scores, and the only thing that decides whether one gets built is
   * whether that 4.5 beats the price. Measured 10/09/2026 over 30 games at
   * 2/3/4 seats with all five suits rotated:
   *
   *     the shipped commons (2 own-suit cards, handSpend 5)   1 of 115 builds
   *     the arm at coinSpend 1.2 (3 coins, so 3.6)           59 of 337 builds
   *
   * ⚠️ **SO THE ARM'S ENDGAME SINK IS REACHABLE, BUT IT MOVES WITH `coinSpend`
   * AND NOT WITH ANYTHING DEAN RULED.** At the 3.5 this weight first shipped at
   * the price was 10.5 and NOT ONE Endgame card was built; at 1.2 it is 3.6,
   * which slips under the flat 4.5, and 17.5% of all builds become Endgame
   * cards. **a19's "coins spent on the Farmstead against on Endgame cards" is
   * therefore a reading of this table's coin price, not of K15's appeal**, and
   * the same goes for any sweep of `endgameCoinCost`. Do not read K15 as
   * measured until an Endgame card is worth something to a bot.
   *
   * The case pins both halves so the finding cannot rot: the shipped game's
   * share stays near zero, and the arm's stays reachable.
   */
  it('buys an Endgame card only when the price falls, never for what it scores', () => {
    const share = (data: GameData, seed: string): { endgame: number; builds: number } => {
      const builds = walk(data, { seats: 3, seed, policies: MIXED.slice(0, 3) }).moves.filter(
        (move) => move.type === 'build',
      );
      return {
        endgame: builds.filter((move) => cardById(data, move.card).type === 'endgame').length,
        builds: builds.length,
      };
    };
    let armEndgame = 0;
    let shippedEndgame = 0;
    let shippedBuilds = 0;
    for (const seed of ['coins-a', 'coins-b', 'coins-c']) {
      armEndgame += share(coins, seed).endgame;
      const shipped = share(BASE_GAME_DATA, seed);
      shippedEndgame += shipped.endgame;
      shippedBuilds += shipped.builds;
    }
    // The blind spot: under the shipped game an Endgame card costs 5 in hand
    // cards against a flat 4.5, so it is all but never worth it.
    expect(shippedEndgame / shippedBuilds).toBeLessThan(0.05);
    // The arm: 3 coins at 1.2 is 3.6, which slips under the same flat 4.5.
    expect(armEndgame).toBeGreaterThan(0);
  });

  it('replays a seed move for move under the arm too', () => {
    const spec = { seats: 2, seed: 'coins-same', policies: ['balanced', 'socialite'] as const };
    const first = walk(coins, { ...spec, policies: [...spec.policies] });
    const second = walk(coins, { ...spec, policies: [...spec.policies] });
    expect(first.crash).toBeNull();
    expect(second.moves).toEqual(first.moves);
  });

  it('leaves the hermit unable to play a card, but free to clear a pile', () => {
    // ⚠️ THE CONTROL CHANGES SHAPE UNDER THIS ARM AND IT IS WORTH KNOWING. The
    // `visit` term claims the commons PLAY and nothing else, so a hermit still
    // never puts a card on a board - but the coin take is a `commonsTake`, which
    // `visit` does not claim, so the arm hands the hermit back a bonus option
    // the shipped commons had taken away from it (C9). Read a hermit's game
    // length under the coins arm knowing it is no longer "the game with the
    // bonus slot deleted".
    const walked = walk(coins, { seats: 2, seed: 'coins-hermit', policies: ['hermit', 'hermit'] });
    expect(walked.crash).toBeNull();
    expect(countOf(walked.moves, 'commons')).toBe(0);
  });
});

/**
 * ⛔ THE CONTROLS. Neither is an arm any more - they are the baselines every
 * commons delta is read against - so the only thing these cases assert is that
 * nothing in this package's commons pass reached them. Byte-identity of a whole
 * move list against a recorded fixture is @gp/sim's `fixtures.test.ts` and
 * belongs there, where the fixtures live; what is provable from here is that the
 * control's own bonus slot still fills, that the commons move cannot appear in a
 * game that has no commons, and that a seed still reproduces.
 */
describe('the controls the commons must not have moved', () => {
  it('leaves the v31 card visit visiting, with no commons move anywhere', () => {
    const data = testkit.cardVisitGame();
    const spec = { seats: 2, seed: 'control-v31', policies: ['balanced', 'socialite'] as const };
    const first = walk(data, { ...spec, policies: [...spec.policies], maxMoves: 400 });
    const second = walk(data, { ...spec, policies: [...spec.policies], maxMoves: 400 });
    expect(first.crash).toBeNull();
    expect(countOf(first.moves, 'commons')).toBe(0);
    expect(countOf(first.moves, 'visit')).toBeGreaterThan(0);
    expect(second.moves).toEqual(first.moves);
  });

  it('leaves the meeple economy visiting and collecting, with no commons move anywhere', () => {
    const data = testkit.meepleEconomyGame();
    const spec = { seats: 2, seed: 'control-meeple', policies: ['balanced', 'socialite'] as const };
    const first = walk(data, { ...spec, policies: [...spec.policies], maxMoves: 400 });
    const second = walk(data, { ...spec, policies: [...spec.policies], maxMoves: 400 });
    expect(first.crash).toBeNull();
    expect(countOf(first.moves, 'commons')).toBe(0);
    expect(countOf(first.moves, 'visit') + countOf(first.moves, 'collect')).toBeGreaterThan(0);
    expect(second.moves).toEqual(first.moves);
  });
});
