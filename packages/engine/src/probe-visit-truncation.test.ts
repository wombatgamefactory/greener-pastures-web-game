/**
 * ⛔ THE PROBE-TRUNCATION DEFECT, AND THE ONE RULE THAT CLOSES IT: **A VISIT'S
 * ROLLOUT MUST ALWAYS BE ABLE TO SEE WHAT THE VISITOR BOUGHT.**
 * (Found and fixed 11/09/2026, engine-side, `doNoticeBoardVisit`.)
 *
 * ## The defect
 *
 * A visit does three things, and until this fix it did them in an order that
 * blinded the seat taking the turn:
 *
 *   1. `afterVisit` fires, and W17 The Pie Shop pushes a draw task for the HOST;
 *   2. `payHostDrawOnVisit` (S17) pushes ANOTHER draw task for the HOST;
 *   3. only then does the VISITOR's power resolve, pushing the visitor's own.
 *
 * So the head of the task queue belonged to the host. `probeAt` in `probe.ts`
 * returns `next: []` and `pending: null` the moment the head task is not the
 * probing seat's own - deliberately, because a rollout may never answer for a
 * rival - so a bot evaluating a visit had its rollout cut before the power it
 * had just paid for was ever walked. Measured over real decisions, the arm
 * against its paired control:
 *
 *     seats   mean rollout value of a visit   probes cut dead   bonus premium
 *     2p      2.358 -> 0.003                  18.9% -> 99.9%    80.6% -> 0.1%
 *     3p      3.367 -> 0.115                   2.4% -> 89.4%    96.4% -> 10.6%
 *     4p      2.806 -> 0.240                  13.3% -> 81.3%    86.4% -> 18.7%
 *
 * A visit cost the bot a card plus the gift to the host and earned, in its own
 * books, nothing. It stopped visiting, and **every bonus rate, door mix and
 * hook number taken off the host-draw arm before this fix is a reading about
 * the defect and not about S17.**
 *
 * ## The fix, and what it deliberately does NOT do
 *
 * S17's push moved to the END of `doNoticeBoardVisit`, behind the power and
 * behind `afterWork`. The two payments are independent - the visitor is paid in
 * the power, the host in a card off a deck - so the order between them is free,
 * and free order must not be spent on blinding the acting seat.
 *
 * ⭐ **MEASURED ENGINE-SIDE EITHER SIDE OF THE FIX, 40 seeded-random games per
 * seat count on the arm, counting every legal visit probed by the seat whose
 * turn it is** (a random chooser rather than a bot, so these are the ENGINE's
 * numbers and not @gp/bots': a probe is "cut" when `next` is empty and
 * `pending` null with `truncated` false):
 *
 *     2 seats   94.1% of 22,452 visit probes cut  ->  11.7% of 23,433
 *     3 seats   88.9% of 43,946 visit probes cut  ->   6.4% of 44,523
 *
 * ⚠️ **WHAT IS LEFT IS W17 AND THE POWERS THAT PUSH NO TASK AT ALL.** A power
 * that resolves outright leaves the host's draw at the head with nothing of the
 * visitor's behind it, and that reads as a cut without hiding anything: the
 * power's own events are in `probe.events` already.
 *
 * ⚠️ **W17's OWN TASK HAS NOT MOVED.** It is still pushed inside `afterVisit`,
 * ahead of the power, so no card's behaviour changes and every control arm
 * stays byte-identical. A visit to a W17 owner therefore still truncates, which
 * is the residue this file names rather than hides: the last case here asserts
 * it, so that the day somebody decides to move W17 too, the cost of that
 * decision is already written down.
 *
 * ⭐ **AND NOTHING MOVES AT THE SHIPPED 0**: `payHostDrawOnVisit` pushes no
 * task, emits no event and consumes no rng when `hostDrawOnVisit` is 0, so
 * where it is called from cannot reach the control. The identity gate lives in
 * `notice-board-host-draw.test.ts`; the control cases here are the same claim
 * made from the probe's side.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';

import { apply, legalMoves, makeProber, player } from './index.js';
import type { CardId, GameState, Move, Seat, Task } from './state.js';
import {
  buildFor,
  dealTo,
  makeState,
  noticeBoardHostDrawGame,
  noticeBoardTwoBoardsGame,
} from './testkit.js';

/** The arm: the two-board notice-board visit plus S17 at its ruled value of 1. */
const arm: GameData = noticeBoardHostDrawGame();
/** The control: the same eighteen leaves with S17 absent, and therefore 0. */
const control: GameData = noticeBoardTwoBoardsGame();

const ORCHARD_BOARD: CardId = 'O3';
const VISITOR: Seat = 0;
const HOST: Seat = 1;

/** A position with the bonus window OPEN: `bonusTiming` is 'start', so before the action. */
function position(data: GameData, suits: Suit[]): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = 0;
  s.turn.actionSpent = false;
  return s;
}

/**
 * The two positions the defect was measured in, built the same way at both seat
 * counts: seat 0 pays a Wheat card to seat 1's ORCHARD board.
 *
 * ⭐ THE ORCHARD BOARD IS NAMED DELIBERATELY. Its power is a Draw for the
 * VISITOR, so the thing the visitor bought is itself a task - which is exactly
 * what the truncation hid, and the only shape that can assert it was recovered.
 * At two seats the arm deals the host two boards, so the visit has to name one.
 */
function visitPosition(data: GameData, seats: 2 | 3): GameState {
  const s =
    seats === 2
      ? position(data, ['wheat', 'dairy'])
      : position(data, ['wheat', 'orchard', 'dairy']);
  dealTo(data, s, VISITOR, 'W7');
  dealTo(data, s, HOST, 'D7', 'D9');
  return s;
}

function visitMove(seats: 2 | 3): Move {
  return seats === 2
    ? { type: 'visit', seat: VISITOR, host: HOST, fee: 'W7', board: ORCHARD_BOARD }
    : { type: 'visit', seat: VISITOR, host: HOST, fee: 'W7' };
}

/** Every task in the queue that belongs to a seat other than `seat`. */
function rivalTasks(state: GameState, seat: Seat): Task[] {
  return state.tasks.filter((t) => t.pid !== seat);
}

// ---------------------------------------------------------------------------
// ⭐ THE REGRESSION ITSELF: A PROBE OF A VISIT SEES THE POWER IT BOUGHT
// ---------------------------------------------------------------------------

describe('⭐ a probe of a visit can see the power the visitor bought', () => {
  for (const seats of [2, 3] as const) {
    it(`at ${seats} seats, where the truncation read ${seats === 2 ? '99.9%' : '89.4%'}`, () => {
      const s = visitPosition(arm, seats);
      const move = visitMove(seats);
      // The move is genuinely on the menu, so this is the real decision a bot
      // faces and not a hand-built state the enumerator would never offer.
      expect(legalMoves(arm, s)).toContainEqual(move);

      const probe = makeProber(arm, s, VISITOR)(move);

      // 1. THE ROLLOUT IS NOT CUT. `truncated` is the budget's flag and was
      //    never the defect's; the defect showed up as an empty `next` with
      //    `truncated` false, which is why both are read here.
      expect(probe.truncated).toBe(false);
      expect(probe.next.length).toBeGreaterThan(0);

      // 2. AND WHAT IT STOPPED ON IS THE VISITOR'S OWN BOUGHT DRAW, not the
      //    host's payment. `via` separates them: S17's task carries the
      //    `hostDraw` label and the Orchard power's carries none. This is the
      //    assertion that would have failed before the fix, where `pending`
      //    came back null because the head task belonged to the host.
      const pending = probe.pending as Task | null;
      expect(pending).not.toBeNull();
      expect(pending?.pid).toBe(VISITOR);
      expect(pending?.t).toBe('draw');
      expect(pending?.t === 'draw' ? pending.via : 'x').toBeUndefined();

      // 3. THE HOST'S PAYMENT IS STILL THERE, behind it. The fix is an order
      //    and not a deletion, and a test that only read the head could not
      //    tell the two apart.
      const applied = apply(arm, s, move);
      const hostDraw = applied.state.tasks.find((t) => t.t === 'draw' && t.via === 'hostDraw') as
        Task | undefined;
      expect(hostDraw?.pid).toBe(HOST);
      expect(applied.state.tasks[0]?.pid).toBe(VISITOR);

      // 4. AND THE ROLLOUT CAN ACTUALLY WALK, which is the whole point: the
      //    probe steps INTO the bought draw rather than stopping at it.
      const stepped = probe.step(probe.next[0] as Move);
      expect(stepped.truncated).toBe(false);
      // Still the visitor's own chain a level down - a deck pick emits nothing
      // by itself, so the reading that matters is that the walk CONTINUES.
      expect(stepped.next.length > 0 || stepped.pending !== null).toBe(true);
    });
  }

  it('⭐ NO RIVAL TASK EVER SITS AHEAD OF THE VISITOR’S OWN, on any legal visit', () => {
    // The invariant behind the three cases above, asserted over every visit the
    // enumerator offers rather than over the one board this file names. A power
    // that pushes NO task leaves the host's draw at the head and that is
    // harmless - there is nothing of the visitor's left to see - so the claim
    // is the ordering one: whatever the visitor is owed comes first.
    for (const seats of [2, 3] as const) {
      const s = visitPosition(arm, seats);
      const visits = legalMoves(arm, s).filter((m) => m.type === 'visit');
      expect(visits.length).toBeGreaterThan(0);
      for (const move of visits) {
        const tasks = apply(arm, s, move).state.tasks;
        const firstMine = tasks.findIndex((t) => t.pid === VISITOR);
        const firstRival = tasks.findIndex((t) => t.pid !== VISITOR);
        if (firstMine >= 0 && firstRival >= 0) {
          expect(firstMine, `${seats} seats, ${JSON.stringify(move)}`).toBeLessThan(firstRival);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE CONTROL DID NOT MOVE
// ---------------------------------------------------------------------------

describe('⛔ the control is untouched: at `hostDrawOnVisit` 0 there is no host task at all', () => {
  for (const seats of [2, 3] as const) {
    it(`at ${seats} seats the same visit probes the same way, with no rival task in the queue`, () => {
      const s = visitPosition(control, seats);
      const move = visitMove(seats);
      const probe = makeProber(control, s, VISITOR)(move);
      expect(probe.truncated).toBe(false);
      expect(probe.next.length).toBeGreaterThan(0);
      expect((probe.pending as Task | null)?.pid).toBe(VISITOR);
      // ⭐ AND THE QUEUE HOLDS NOTHING OF ANYBODY ELSE'S: S17 pushes no task at
      // 0, so moving where it is pushed from could not have reached this arm.
      expect(rivalTasks(apply(control, s, move).state, VISITOR)).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// ⚠️ THE RESIDUE: W17 THE PIE SHOP STILL TRUNCATES, AND IT IS LEFT THAT WAY
// ---------------------------------------------------------------------------

describe('⚠️ W17 The Pie Shop still cuts the rollout, deliberately and on the record', () => {
  it('a visit to a W17 owner comes back with an empty `next`, and that is the known residue', () => {
    // W17 pushes its host draw inside `afterVisit`, which fires BEFORE the
    // power, so its task heads the queue and `probeAt` stops there. Moving it
    // would be a behavioural change to games already recorded under the
    // controls - the card predates S17 by a week - so it is measured and left:
    // it truncated 9.9% to 13.4% of probes at three and four seats before S17
    // existed, and it still does.
    const s = position(arm, ['orchard', 'wheat', 'dairy']);
    buildFor(arm, s, HOST, 'W17');
    // ⚠️ TWO CARDS AND NOT ONE: the Wheat board's power is a Harvest and the
    // enumerator asks whether it is legal with the FEE already gone, so a
    // one-card hand takes the visit off the menu for a reason that has nothing
    // to do with this file.
    dealTo(arm, s, VISITOR, 'O7', 'O9');
    dealTo(arm, s, HOST, 'W9');
    const move: Move = { type: 'visit', seat: VISITOR, host: HOST, fee: 'O7' };
    expect(legalMoves(arm, s)).toContainEqual(move);

    const applied = apply(arm, s, move);
    // The host owns the head task, and it is W17's rather than S17's.
    const head = applied.state.tasks[0] as Task;
    expect(head.pid).toBe(HOST);
    expect(head.t === 'draw' ? head.src : null).toBe('W17');
    // ⚠️ SO THE PROBE STOPS, EXACTLY AS THE DEFECT DID. Asserted rather than
    // assumed: if somebody ever moves W17's task too, this is the case that
    // tells them a control arm has just moved with it.
    const probe = makeProber(arm, s, VISITOR)(move);
    expect(probe.next).toHaveLength(0);
    expect(probe.pending).toBeNull();
    expect(probe.truncated).toBe(false);
    // The visitor really did pay: the fee left the hand, and the probe prices
    // that loss against a payoff it cannot see. That asymmetry is the residue.
    expect(player(applied.state, VISITOR).hand).not.toContain('O7');
  });
});
