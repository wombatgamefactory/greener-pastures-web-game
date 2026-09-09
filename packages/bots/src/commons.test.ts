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
