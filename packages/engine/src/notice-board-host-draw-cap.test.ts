/**
 * ⭐ THE HOST-DRAW CAP: **A HOST IS PAID AT MOST ONCE BETWEEN THEIR OWN TURNS**,
 * however many neighbours visit them in the meantime
 * (`rules.turn.hostDrawCapPerRound`, 11/09/2026,
 * `overlays/notice-board-visit-host-draw-capped-v1.overlay.json`).
 *
 * ⛔ **WHY IT EXISTS: THE FOUR-SEAT BREACH.** S17 was ruled in off a two-player
 * table and it takes the bonus slot out of Dean's 30% to 60% band at four seats
 * alone - 64.9% of turns against a 60% ceiling, where its one-leaf control reads
 * 59.9% and two and three seats barely move. The faucet SCALES WITH THE NUMBER
 * OF RIVALS, because a seat is visited once per rival per round and each card
 * handed back makes the next visit easier to afford.
 *
 * ## ⛔ THE ONE THING THIS FILE EXISTS TO PIN: PER ROUND IS NOT PER TURN
 *
 * **The capped quantity is one payment between the HOST's own turns, not one
 * payment per the VISITOR's turn**, and the difference is the entire value of
 * the knob:
 *
 * - A **visitor-side** cap bites only when ONE visitor sends TWO visits to the
 *   same host in a single turn. That is reachable at TWO seats alone (A Helping
 *   Hand, against a rival holding two boards, itself only reachable since the
 *   two-board fix) and it would leave FOUR SEATS - the only breaching seat
 *   count - completely untouched. It would be a fix that cannot reach the thing
 *   it was built to fix.
 * - A **host-side** cap bites whenever a second rival visits the same host
 *   before that host's next turn, which is precisely the arrival pattern that
 *   scales with the number of rivals.
 *
 * ⛔ **THE FIRST TEST BELOW IS THE ONE THAT SEPARATES THEM**: two DIFFERENT
 * seats visit one host between that host's turns, and only the first is paid. A
 * visitor-side latch would pay both and pass every other test in this file.
 *
 * ⚠️ **AND IT IS EXPECTED TO BE INSUFFICIENT AS A DESIGN FIX**, which is
 * recorded in the overlay and the knob rather than here: measured host draws per
 * host per round are 0.489 / 0.553 / 0.787 by seat count, so a cap of one can
 * remove at most about a fifth to a third of the faucet. This file asserts that
 * the rule does what it says; whether that is ENOUGH is a question for the run.
 *
 * ⛔ **AN ARM OF AN ARM OF AN ARM.** The shipped game is still the commons.
 * Every case here takes its data from `noticeBoardHostDrawCappedGame()` or from
 * its one-leaf control `noticeBoardHostDrawGame()`, never from
 * `BASE_GAME_DATA` - except the correctness gate at the bottom, whose whole
 * point is that nothing moves when the cap is off.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA, hostDrawCapPerRound, hostDrawOnVisit, hostDrawOnVisitAt } from '@gp/data';

import { clonePlain } from './clone.js';
import { apply, newGame, player, taskAnswers } from './index.js';
import type { CardId, GameState, Move, Seat, Task } from './state.js';
import {
  dealTo,
  makeState,
  noticeBoardHostDrawBySeatsGame,
  noticeBoardHostDrawCappedGame,
  noticeBoardHostDrawGame,
} from './testkit.js';

/** The arm: S17 at 1, capped at one payment per host per round. */
const capped: GameData = noticeBoardHostDrawCappedGame();
/** The control: the same twenty leaves with the cap off, so S17 pays every visit. */
const uncapped: GameData = noticeBoardHostDrawGame();

/** A position with the bonus window OPEN: `bonusTiming` is 'start', so before the action. */
function position(data: GameData, suits: Suit[]): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = 0;
  s.turn.actionSpent = false;
  return s;
}

function visit(seat: Seat, host: Seat, fee: CardId): Move {
  return { type: 'visit', seat, host, fee };
}

/** The pending host-draw tasks, which is the only thing S17 ever creates. */
function hostDraws(state: GameState): Extract<Task, { t: 'draw' }>[] {
  return state.tasks.filter(
    (t): t is Extract<Task, { t: 'draw' }> => t.t === 'draw' && t.via === 'hostDraw',
  );
}

/**
 * Drain every pending task by taking the first answer at each step, so the next
 * visit starts from a settled queue.
 *
 * ⚠️ It deliberately does NOT assert what it drained. The cases below assert on
 * `hostDraws` BEFORE draining, which is where the rule is visible; this only has
 * to leave the position playable.
 */
function drain(data: GameData, state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 120 && s.tasks.length > 0; guard++) {
    const head = s.tasks[0];
    if (head === undefined) break;
    const first = taskAnswers(data, s, head)[0];
    if (first === undefined) break;
    s = apply(data, s, { type: 'task', seat: head.pid, answer: first }).state;
  }
  return s;
}

/**
 * Hand the turn to `seat` WITHOUT going through the turn boundary, so a test can
 * stage a second visitor in the same round.
 *
 * ⛔ **THIS IS THE POINT OF THE HELPER AND IT IS NOT A SHORTCUT.** The latch is
 * cleared in `clearHostDrawLatch`, which runs only at a real turn boundary. A
 * test that wants "a second rival visits before the host's next turn" must move
 * the seat marker without crossing one, because crossing one for the VISITOR is
 * exactly what a visitor-side latch would reset on. The "latch clears when the
 * HOST takes a turn" block below is the counterpart that does cross one, and it
 * drives `newGame` through a real `endTurn` for that reason.
 */
function handTurnTo(state: GameState, seat: Seat): GameState {
  const s = clonePlain(state);
  s.turnPlayer = seat;
  s.turn.actionSpent = false;
  s.turn.bonusUsed = [];
  // ⚠️ `firedThisTurn` CARRIES THE S9 LATCH - one use per board per turn, keyed
  // on the board's card id - and it is turn-scoped, so a staged turn has to
  // clear it or the second visit is refused for the wrong reason entirely.
  s.turn.firedThisTurn = [];
  return s;
}

/**
 * ⛔ THE HOSTS IN THIS FILE ARE ORCHARD AND VEGETABLE, AND THE CHOICE IS FORCED.
 *
 * S10: a board whose power the visitor cannot legally perform right now is not
 * offered, and `doNoticeBoardVisit` throws on one. Of the five powers only two
 * are legal for any seat in any position - Orchard's *Draw 4*, and Vegetable's
 * *Deliver, or if you cannot, put 2 cards from your hand into your barn*, whose
 * whole second clause exists to make it never dead. Dairy's Build, Apiary's Grow
 * and Wheat's Harvest all need something in the tableau, so a host farming one
 * of those makes a test fail for a reason that has nothing to do with the cap.
 */
const HOST_SUITS: Suit[] = ['wheat', 'orchard', 'vegetable'];

// ---------------------------------------------------------------------------
// ⛔ THE HEADLINE: TWO DIFFERENT RIVALS, ONE HOST, ONE PAYMENT
// ---------------------------------------------------------------------------

describe('the cap is PER HOST PER ROUND and not per visitor turn', () => {
  it('pays the FIRST rival visit and refuses the second from a DIFFERENT seat', () => {
    // ⛔ THE TEST THAT SEPARATES A HOST-SIDE LATCH FROM A VISITOR-SIDE ONE.
    // Seats 0 and 2 each visit seat 1, and seat 1 does not take a turn in
    // between. A visitor-side latch pays BOTH, because the two visits belong to
    // two different visitors' turns; the rule pays one.
    const s0 = position(capped, HOST_SUITS);
    const HOST: Seat = 1;
    dealTo(capped, s0, 0, 'W7', 'W9', 'W10');
    dealTo(capped, s0, HOST, 'O7', 'O9');
    dealTo(capped, s0, 2, 'V7', 'V9', 'V10');

    // FIRST VISIT: seat 0 pays, and the host is owed a card.
    const first = apply(capped, s0, visit(0, HOST, 'W7'));
    expect(hostDraws(first.state)).toHaveLength(1);
    expect(hostDraws(first.state)[0]?.pid).toBe(HOST);
    expect(player(first.state, HOST).hostDrewThisRound).toBe(true);

    // SECOND VISIT: a different seat, no turn boundary crossed by the HOST.
    const staged = handTurnTo(drain(capped, first.state), 2);
    expect(player(staged, HOST).hostDrewThisRound).toBe(true);
    const second = apply(capped, staged, visit(2, HOST, 'V7'));

    // ⛔ NOTHING IS OWED THE HOST THIS TIME, and that is the whole rule.
    expect(hostDraws(second.state)).toHaveLength(0);
  });

  it('pays BOTH of those visits when the cap is off, so the knob is what did it', () => {
    // ⛔ THE SAME SCRIPT ON THE ONE-LEAF CONTROL. Without this the test above
    // would pass just as well against an engine that never pays a second visit
    // for some unrelated reason.
    const s0 = position(uncapped, HOST_SUITS);
    const HOST: Seat = 1;
    dealTo(uncapped, s0, 0, 'W7', 'W9', 'W10');
    dealTo(uncapped, s0, HOST, 'O7', 'O9');
    dealTo(uncapped, s0, 2, 'V7', 'V9', 'V10');

    const first = apply(uncapped, s0, visit(0, HOST, 'W7'));
    expect(hostDraws(first.state)).toHaveLength(1);
    // No latch field exists at all on this arm - see the serialisation gate.
    expect(player(first.state, HOST).hostDrewThisRound).toBeUndefined();

    const staged = handTurnTo(drain(uncapped, first.state), 2);
    const second = apply(uncapped, staged, visit(2, HOST, 'V7'));
    expect(hostDraws(second.state)).toHaveLength(1);
    expect(hostDraws(second.state)[0]?.pid).toBe(HOST);
  });

  it('pays a DIFFERENT host in the same round, so the latch is per seat', () => {
    // One seat's spent entitlement must not shut another's. Seat 0 visits seat
    // 1, and then seat 0 visits seat 2 - a second host entirely, whose own
    // entitlement is untouched by what seat 1 was paid.
    const s0 = position(capped, HOST_SUITS);
    dealTo(capped, s0, 0, 'W7', 'W9', 'W10', 'W11');
    dealTo(capped, s0, 1, 'O7');
    dealTo(capped, s0, 2, 'V7');

    const first = apply(capped, s0, visit(0, 1, 'W7'));
    expect(hostDraws(first.state)).toHaveLength(1);
    expect(player(first.state, 1).hostDrewThisRound).toBe(true);
    expect(player(first.state, 2).hostDrewThisRound).toBe(false);

    const staged = handTurnTo(drain(capped, first.state), 0);
    const second = apply(capped, staged, visit(0, 2, 'W9'));
    expect(hostDraws(second.state)).toHaveLength(1);
    expect(hostDraws(second.state)[0]?.pid).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ⭐ THE LATCH CLEARS AT THE HOST'S OWN TURN AND AT NOBODY ELSE'S
// ---------------------------------------------------------------------------

describe('the latch clears when the HOST takes a turn', () => {
  it('clears for the seat whose turn begins, and for that seat only', () => {
    // Driven through `newGame` and real turn ends rather than through the
    // testkit, because the thing under test IS the turn boundary.
    const g = clonePlain(
      newGame(capped, { seats: 3, seed: 'host-draw-cap-latch', dataTag: 'capped' }),
    );
    const seats = [0, 1, 2] as Seat[];
    for (const seat of seats) player(g, seat).hostDrewThisRound = true;
    // `endTurn` exists only to DECLINE options that are still live, so it
    // refuses a turn whose action is unspent. Nothing here is testing the
    // action, so it is marked spent rather than played out.
    g.turn.actionSpent = true;

    const start = g.turnPlayer;
    const next = ((start + 1) % 3) as Seat;
    const ended = drain(capped, apply(capped, g, { type: 'endTurn', seat: start }).state);

    // ⭐ THE SEAT WHOSE TURN JUST BEGAN IS CLEAR.
    expect(ended.turnPlayer).toBe(next);
    expect(player(ended, next).hostDrewThisRound).toBe(false);
    // ⛔ AND EVERY OTHER SEAT STILL CARRIES WHAT IT SPENT. A reset that cleared
    // the table would turn the cap into "one payment per turn played anywhere",
    // which is a third rule nobody asked for and would barely cap at all.
    for (const seat of seats.filter((x) => x !== next)) {
      expect(player(ended, seat).hostDrewThisRound).toBe(true);
    }
  });

  it('lets a host be paid again once their own turn has come round', () => {
    const s0 = position(capped, HOST_SUITS);
    const HOST: Seat = 1;
    dealTo(capped, s0, 0, 'W7', 'W9', 'W10');
    dealTo(capped, s0, HOST, 'O7');
    dealTo(capped, s0, 2, 'V7');

    const first = drain(capped, apply(capped, s0, visit(0, HOST, 'W7')).state);
    expect(player(first, HOST).hostDrewThisRound).toBe(true);

    // The host plays a turn, which is the only thing that clears it.
    const cleared = clonePlain(first);
    cleared.turnPlayer = HOST;
    player(cleared, HOST).hostDrewThisRound = false;

    const back = handTurnTo(cleared, 0);
    const second = apply(capped, back, visit(0, HOST, 'W9'));
    expect(hostDraws(second.state)).toHaveLength(1);
    expect(hostDraws(second.state)[0]?.pid).toBe(HOST);
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE CORRECTNESS GATE AND THE SERIALISATION GATE
// ---------------------------------------------------------------------------

describe('the cap changes nothing it should not', () => {
  it('carries NO latch field at all when the cap is off', () => {
    // The field is absent rather than present-and-false under every game that
    // does not run the cap, which is what keeps serialised states, captures and
    // the byte-identical fixtures unchanged.
    const off = newGame(uncapped, { seats: 3, seed: 'cap-off', dataTag: 'uncapped' });
    for (const seat of [0, 1, 2] as Seat[]) {
      expect(player(off, seat).hostDrewThisRound).toBeUndefined();
      expect(Object.hasOwn(player(off, seat), 'hostDrewThisRound')).toBe(false);
    }
    expect(hostDrawCapPerRound(uncapped)).toBe(false);
    expect(hostDrawCapPerRound(capped)).toBe(true);
  });

  it('plays a byte-identical game to its control when S17 itself is 0', () => {
    // ⛔ WITH NOTHING TO CAP, THE CAP MUST BE INERT. At `hostDrawOnVisit` 0 no
    // payment is ever made, so the latch is never read and never set, and the
    // two datasets must produce the same game from the same seed.
    const capOnDrawOff = noticeBoardHostDrawCappedGame(true, 0);
    const capOffDrawOff = noticeBoardHostDrawGame(0);
    expect(hostDrawOnVisit(capOnDrawOff)).toBe(0);
    expect(hostDrawOnVisit(capOffDrawOff)).toBe(0);

    for (const seats of [2, 3, 4]) {
      const seed = `cap-inert-${seats}`;
      const a = newGame(capOnDrawOff, { seats, seed, dataTag: 'x' });
      const b = newGame(capOffDrawOff, { seats, seed, dataTag: 'x' });
      // The latch field is the ONE legitimate difference, because it is gated on
      // the cap and not on the draw, so it is stripped before comparing.
      expect(stripLatch(a)).toEqual(stripLatch(b));
    }
  });

  it('deals an identical SETUP to its control, so the cap is a play rule only', () => {
    // ⭐ THE LATCH IS THE ONLY SETUP-TIME DIFFERENCE, AT EVERY SEAT COUNT. The
    // cap changes what happens during a turn and must not touch the deal: a
    // difference here would mean it had reached the rng, and a rule that moves
    // the shuffle cannot be read against a paired control on identical seeds at
    // all. The PLAY-time difference is asserted by the cases above, which is
    // where it belongs.
    for (const seats of [2, 3, 4]) {
      const seed = `cap-live-${seats}`;
      const a = newGame(capped, { seats, seed, dataTag: 'x' });
      const b = newGame(uncapped, { seats, seed, dataTag: 'x' });
      expect(stripLatch(a)).toEqual(stripLatch(b));
    }
    expect(hostDrawCapPerRound(capped)).toBe(true);
    expect(hostDrawCapPerRound(uncapped)).toBe(false);
  });
});

/** A state with the cap's own field removed from every seat, for comparison. */
function stripLatch(state: GameState): unknown {
  const s = clonePlain(state) as GameState & { players: Record<string, unknown>[] };
  for (const p of s.players) delete p['hostDrewThisRound'];
  return s;
}

// ---------------------------------------------------------------------------
// ⭐ THE SEAT-SHAPED HOST DRAW, WHICH IS WHAT THE CAP'S FAILURE LEFT
// ---------------------------------------------------------------------------

/**
 * ⛔ **PRICING THE FAUCET IS A DEAD LEVER AND THAT IS MEASURED, NOT ARGUED.**
 * The cap above removed 28.7% of the payments at four seats and returned 0.5
 * points of rate (64.9% to 64.4%, still out of band), so the bonus rate is
 * nearly insensitive to the faucet's SIZE. Only its PRESENCE is left to change,
 * and `rules.turn.hostDrawOnVisitBySeats` changes it exactly where there is no
 * headroom.
 *
 * ⛔ **THE PRECEDENCE RULE IS THE THING TO PIN**: a non-null slot wins, a null
 * slot defers to the scalar, every slot ships null. The last of those is what
 * keeps `overlays/notice-board-visit-host-draw-v1.overlay.json` reading exactly
 * as it did when it was measured, and a regression there would invalidate a
 * published report rather than merely fail a test.
 */
describe('the host draw shaped by seat count', () => {
  it('defers to the scalar at every seat count while the slots ship null', () => {
    // ⛔ THE GUARD ON EVERY PUBLISHED NUMBER: the host-draw arm sets the scalar
    // and no slot, so it must still pay 1 at 2, 3 and 4 seats.
    for (const seats of [2, 3, 4]) {
      expect(hostDrawOnVisitAt(uncapped, seats)).toBe(1);
      expect(hostDrawOnVisitAt(BASE_GAME_DATA, seats)).toBe(0);
    }
  });

  it('pays at two and three seats and NOT at four when the 4 slot is set', () => {
    const shaped = noticeBoardHostDrawBySeatsGame();
    expect(hostDrawOnVisitAt(shaped, 2)).toBe(1);
    expect(hostDrawOnVisitAt(shaped, 3)).toBe(1);
    expect(hostDrawOnVisitAt(shaped, 4)).toBe(0);
    // The scalar is untouched, which is what makes this a one-leaf arm.
    expect(hostDrawOnVisit(shaped)).toBe(1);
  });

  it('pays no host draw at FOUR seats and still pays at THREE', () => {
    // The rule, not the accessor: a real visit at each seat count.
    const shaped = noticeBoardHostDrawBySeatsGame();
    const three = position(shaped, HOST_SUITS);
    dealTo(shaped, three, 0, 'W7', 'W9', 'W10');
    dealTo(shaped, three, 1, 'O7', 'O9');
    dealTo(shaped, three, 2, 'V7', 'V9', 'V10');
    expect(hostDraws(apply(shaped, three, visit(0, 1, 'W7')).state)).toHaveLength(1);

    const four = position(shaped, [...HOST_SUITS, 'dairy']);
    dealTo(shaped, four, 0, 'W7', 'W9', 'W10');
    dealTo(shaped, four, 1, 'O7', 'O9');
    dealTo(shaped, four, 2, 'V7', 'V9', 'V10');
    dealTo(shaped, four, 3, 'D7');
    // ⛔ THE SAME VISIT, ONE MORE SEAT, AND THE HOST IS PAID NOTHING.
    expect(hostDraws(apply(shaped, four, visit(0, 1, 'W7')).state)).toHaveLength(0);
  });

  it('is byte-identical to its control at two and three seats', () => {
    // ⛔ THE CORRECTNESS GATE, AND IT IS THE ARM'S WHOLE CLAIM: the 4 slot must
    // not reach the seat counts it does not name. Any movement in the 2p or 3p
    // columns of the run is a leak and not a finding.
    const shaped = noticeBoardHostDrawBySeatsGame();
    for (const seats of [2, 3]) {
      const seed = `by-seats-${seats}`;
      expect(newGame(shaped, { seats, seed, dataTag: 'x' })).toEqual(
        newGame(uncapped, { seats, seed, dataTag: 'x' }),
      );
    }
  });
});
