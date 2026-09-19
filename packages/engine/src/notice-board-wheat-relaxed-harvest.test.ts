/**
 * DEAN'S WHEAT BOARD RETEXT (19/09/2026, sheet v44,
 * `rules.economy.noticeBoardPower.wheatHarvestGate` / `wheatBarn`):
 * *"Harvest one of your buildings, even if it is 1 card short of full."*
 *
 * REPLACES RULING C88 of 10/09/2026 ("Harvest one of your buildings, then put
 * 1 card from your hand into your barn"), which `notice-board-visit.test.ts`
 * keeps testing on its own FROZEN 10/09/2026 arm - this file is the current
 * shipped default's coverage and runs on `BASE_GAME_DATA` deliberately, never
 * on that arm.
 *
 * ⭐⭐ THE NOTICE-BOARD-AT-2 REVERSAL is the second case below: a `3+` Notice
 * Board's fill level is 3, so "1 card short of full" reaches it at 2 cards.
 * **THIS REVERSES THE STANDING RULE OF 15/09/2026** ("the Wheat board
 * harvests only a full building or a 3+ Notice Board"; "a Notice Board is
 * never harvested below 3 by any card") FOR THIS POWER SPECIFICALLY - see
 * `wheatHarvestGate`'s knob comment (`packages/data/src/types.ts`,
 * `knobs.ts`) for the ruling in full. That sentence stays true everywhere
 * else: the plain Harvest action and every other card still need a full `3+`
 * board (in practice never, since a Notice Board never reaches a printed
 * threshold above 3).
 */

import { describe, expect, it } from 'vitest';
import type { Suit } from '@gp/data';
import { BASE_GAME_DATA } from '@gp/data';

import { apply, drainTasks, noticeBoardPowerLegal, player, taskAnswers } from './index.js';
import type { CardId, GameState, Move } from './state.js';
import { buildFor, dealTo, loadStack, makeState } from './testkit.js';

const data = BASE_GAME_DATA;

/** Seat 0 farms Orchard and visits seat 1's Wheat board; seat 2 pads the table. */
function position(): GameState {
  const suits: Suit[] = ['orchard', 'wheat', 'dairy'];
  const s = makeState(data, suits);
  s.turnPlayer = 0;
  s.turn.actionSpent = false;
  return s;
}

const VISIT: Move = { type: 'visit', seat: 0, host: 1, fee: 'W7' };

/** Drain a settled position by taking the first legal answer at every step. */
function autoResolve(state: GameState): GameState {
  for (let guard = 0; guard < 60 && state.tasks.length > 0; guard++) {
    drainTasks(data, state);
    const head = state.tasks[0];
    if (head === undefined) break;
    const first = taskAnswers(data, state, head)[0];
    if (first === undefined) break;
    state = apply(data, state, { type: 'task', seat: head.pid, answer: first }).state;
  }
  return state;
}

function choosableBuildings(state: GameState): CardId[] {
  const choose = state.tasks.find((t) => t.t === 'chooseBuilding');
  if (!choose) return [];
  expect(choose.filter).toBe('nearFull');
  return taskAnswers(data, state, choose)
    .filter((a): a is Extract<typeof a, { kind: 'building' }> => a.kind === 'building')
    .map((a) => a.card);
}

describe('the shipped Wheat board (W3): relaxed harvest, no bank (19/09/2026)', () => {
  it('offers a building 1 card short of full (O4, threshold 3, loaded to 2)', () => {
    const s = position();
    buildFor(data, s, 0, 'O4');
    loadStack(data, s, 0, 'O4', 2);
    dealTo(data, s, 0, 'W7');
    const out = apply(data, s, VISIT);
    expect(choosableBuildings(out.state)).toContain('O4');
  });

  it("harvests the visitor's OWN Notice Board loaded to 2 - the Notice-Board-at-2 reversal", () => {
    const s = position();
    // O3 is a starter: already in the tableau, no `buildFor` needed.
    loadStack(data, s, 0, 'O3', 2, 'orchard');
    dealTo(data, s, 0, 'W7');
    const out = apply(data, s, VISIT);
    expect(choosableBuildings(out.state)).toContain('O3');
    const after = autoResolve(out.state);
    // The stack moved into the visitor's own barn, exactly as an ordinary
    // harvest would - the board is a building for harvest and nothing else.
    expect(player(after, 0).barn).toHaveLength(2);
    expect(player(after, 0).tableau.find((b) => b.card === 'O3')?.stack).toHaveLength(0);
  });

  it('does NOT offer a building more than 1 card short of full (O4 loaded to only 1)', () => {
    const s = position();
    buildFor(data, s, 0, 'O4');
    loadStack(data, s, 0, 'O4', 1);
    dealTo(data, s, 0, 'W7');
    // Nothing else of the visitor's is loaded (their Notice Board starts
    // empty), so the board has no legal harvest and - `wheatBarn` shipping 0,
    // the old fallback leg gone - no legal power at all: S10 says it is not
    // offered.
    expect(noticeBoardPowerLegal(data, s, 0, 'wheat', { excludingHandCard: 'W7' })).toBe(false);
  });

  it('no longer banks a hand card: one full harvest, no handToBarn task, hand unchanged', () => {
    const s = position();
    buildFor(data, s, 0, 'O4');
    loadStack(data, s, 0, 'O4', 3); // full, not just nearFull - the plain case too
    dealTo(data, s, 0, 'W7', 'W9', 'W10');
    const before = player(s, 0).hand.length;
    const out = apply(data, s, VISIT);
    expect(out.state.tasks.some((t) => t.t === 'handToBarn')).toBe(false);
    const after = autoResolve(out.state);
    expect(after.tasks.some((t) => t.t === 'handToBarn')).toBe(false);
    // Only the fee left the hand; nothing else was banked on top of it.
    expect(player(after, 0).hand).toHaveLength(before - 1);
  });
});
