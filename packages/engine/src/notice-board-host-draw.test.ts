/**
 * ⭐ S17, THE HOST DRAW: **WHEN A NEIGHBOUR VISITS YOU, YOU DRAW 1 CARD.**
 * (Dean, ruled 11/09/2026, `rules.turn.hostDrawOnVisit`,
 * `overlays/notice-board-visit-host-draw-v1.overlay.json`.)
 *
 * ⭐ **ITS PROVENANCE IS A TABLE AND NOT A SIMULATION**, which is rare enough
 * in this project to be the first thing recorded about it. Dean played
 * `overlays/notice-board-visit-two-boards-v1.overlay.json` at a two-player
 * table on 11/09/2026, house-ruled this in during the session, and reported
 * that the visiting worked well, that everyone visited, that every Notice Board
 * was used at some stage, and that "the rule that the person who gets visited
 * draws a card led to a lot of extra cards in play, which relieved the
 * tightness of the game in a useful way".
 *
 * ⛔ **IT AMENDS S7** of `docs/notice-board-visit-handoff-2026-09-10-v2.md`,
 * which said in as many words that the fee resting on the host's board "is the
 * payment and there is no other". There is now one other and it is paid
 * instantly: the host is paid TWICE, once in a card drawn now and once in
 * material they must still harvest and then deliver.
 *
 * ⛔ **AN ARM AND NOT THE GAME, AND AN ARM OF AN ARM AT THAT.** The shipped
 * game is still the commons. Every case here takes its data from
 * `noticeBoardHostDrawGame()` or from its control `noticeBoardTwoBoardsGame()`,
 * never from `BASE_GAME_DATA` - except the one case at the bottom whose whole
 * point is that the shipped game does not move.
 *
 * ## What this file is guarding, in the order the traps were named
 *
 * ⛔ **1. THE DRAW GOES TO THE HOST, WHO IS NOT THE ACTIVE PLAYER.** Same class
 * of bug as the power-fires-for-the-visitor orientation, which the 10/09/2026
 * pass called "the one bug this design can have". A self-visit would hide it,
 * and self-visiting is banned on this arm, so the orientation is asserted at
 * THREE seats and again at TWO.
 *
 * ⛔ **2. EXACTLY `hostDrawOnVisit` CARDS AND NEVER `baseDraw`'s TWO.** The
 * plain Draw action is see 2 / keep 2 since v31, so an engine that implemented
 * this by calling the ordinary Draw would pay the host double. Asserted
 * against the knob at 1 and again at 2, with `baseDraw` read in the same test
 * so that the trap is visible in the assertion rather than only in a comment.
 *
 * ⛔ **3. `rules.turn.bonusDraw` IS NOT THIS NUMBER.** It is 1, it is the v31
 * standalone free Draw 1 deleted on 04/09/2026, and it is subjectless under
 * this currency - so a stray read of it would look right at `n` 1 and be wrong
 * everywhere else. The knob-at-0 and knob-at-2 cases are what separate them.
 *
 * ⛔ **4. THE CORRECTNESS GATE.** At `hostDrawOnVisit` 0 the engine must behave
 * exactly as it did before the rule existed: byte-identical games on identical
 * seeds against the control at every seat count. And at 1 it must NOT be
 * identical, because identical in both directions would mean the knob is not
 * wired at all.
 */

import { describe, expect, it } from 'vitest';
import type { GameData, Suit } from '@gp/data';
import { BASE_GAME_DATA, applyOverlay, hostDrawOnVisit } from '@gp/data';

import {
  apply,
  drainTasks,
  legalMoves,
  newGame,
  noticeBoardsOf,
  player,
  taskAnswers,
} from './index.js';
import { rngInt, seedRng } from './rng.js';
import type { CardId, GameEvent, GameState, Move, Seat, Task } from './state.js';
import {
  buildFor,
  cardVisitGame,
  dealTo,
  makeState,
  noticeBoardHostDrawGame,
  noticeBoardHostDrawSelfGame,
  noticeBoardTwoBoardsGame,
  withBonusSlots,
} from './testkit.js';

/** The arm: the two-board game plus S17 at its ruled value of 1. */
const arm: GameData = noticeBoardHostDrawGame();
/** The control: the same eighteen leaves, S17 absent and therefore 0. */
const control: GameData = noticeBoardTwoBoardsGame();

const BOARD: Record<Suit, CardId> = {
  wheat: 'W3',
  vegetable: 'V3',
  orchard: 'O3',
  apiary: 'A3',
  dairy: 'D3',
};

/** A position with the bonus window OPEN: `bonusTiming` is 'start', so before the action. */
function position(data: GameData, suits: Suit[]): GameState {
  const s = makeState(data, suits);
  s.turnPlayer = 0;
  s.turn.actionSpent = false;
  return s;
}

function visit(seat: Seat, host: Seat, fee: CardId, board?: CardId): Move {
  return board === undefined
    ? { type: 'visit', seat, host, fee }
    : { type: 'visit', seat, host, fee, board };
}

/** The board cards in a seat's tableau, in tableau order. */
function boardCards(data: GameData, state: GameState, seat: Seat): CardId[] {
  return noticeBoardsOf(data, state, seat).map((b) => b.card);
}

/** The pending host-draw tasks, which is the only thing S17 ever creates. */
function hostDraws(state: GameState): Extract<Task, { t: 'draw' }>[] {
  return state.tasks.filter(
    (t): t is Extract<Task, { t: 'draw' }> => t.t === 'draw' && t.via === 'hostDraw',
  );
}

/** Every `cardsToHand` that carries S17's label, which is how the sim will count them. */
function hostDrawEvents(events: GameEvent[]): Extract<GameEvent, { e: 'cardsToHand' }>[] {
  return events.filter(
    (e): e is Extract<GameEvent, { e: 'cardsToHand' }> =>
      e.e === 'cardsToHand' && e.via === 'hostDraw',
  );
}

/**
 * Drain a settled position by taking the first answer at every step, KEEPING
 * the events. `autoResolve` in the sibling files throws them away, and half of
 * what this file asserts is on the event stream.
 */
function settle(
  data: GameData,
  state: GameState,
): { state: GameState; events: GameEvent[]; answered: Move[] } {
  const events: GameEvent[] = [];
  const answered: Move[] = [];
  let s = state;
  for (let guard = 0; guard < 80 && s.tasks.length > 0; guard++) {
    drainTasks(data, s);
    const head = s.tasks[0];
    if (head === undefined) break;
    const first = taskAnswers(data, s, head)[0];
    if (first === undefined) break;
    const move: Move = { type: 'task', seat: head.pid, answer: first };
    const out = apply(data, s, move);
    answered.push(move);
    events.push(...out.events);
    s = out.state;
  }
  return { state: s, events, answered };
}

/**
 * Resolve ONLY the head draw task, one deck pick then the keep, and return what
 * happened.
 *
 * ⚠️ `pid` IS ASSERTED AND NOT ASSUMED, and that is the probe-truncation fix of
 * 11/09/2026 arriving in this file. S17's draw task used to be pushed BEFORE
 * the visitor's power and therefore sat at the head of the queue; it is now
 * pushed last, behind everything the visitor bought, so "the head draw" and
 * "the host's draw" are no longer the same task. Naming the seat is what stops
 * a re-ordering ever being absorbed silently by a helper.
 */
function resolveHeadDraw(
  data: GameData,
  state: GameState,
  suit: Suit,
  pid?: Seat,
): { state: GameState; events: GameEvent[] } {
  const head = state.tasks[0];
  if (head === undefined || head.t !== 'draw') throw new Error('The head task is not a draw');
  if (pid !== undefined && head.pid !== pid) {
    throw new Error(`The head draw belongs to seat ${head.pid} and not to seat ${pid}`);
  }
  const events: GameEvent[] = [];
  let s = state;
  for (let i = 0; i < head.see; i++) {
    const out = apply(data, s, { type: 'task', seat: head.pid, answer: { kind: 'deck', suit } });
    events.push(...out.events);
    s = out.state;
  }
  const keep = taskAnswers(data, s, s.tasks[0] as Task)[0];
  if (keep === undefined) throw new Error('The draw offered no keep');
  const out = apply(data, s, { type: 'task', seat: (s.tasks[0] as Task).pid, answer: keep });
  events.push(...out.events);
  return { state: out.state, events };
}

/**
 * Resolve the HOST'S draw, walking past whatever the VISITOR bought first.
 *
 * ⚠️ Since 11/09/2026 S17's task is pushed last, behind the power the visitor
 * paid for, so a test that wants the host's payment alone has to drain the
 * visitor's own draw out of the way first. Every intermediate draw is taken off
 * a DIFFERENT deck from the one named for the host, so the two payments stay
 * tellable apart in the events even when both are draws.
 */
function resolveHostDraw(
  data: GameData,
  state: GameState,
  suit: Suit,
): { state: GameState; events: GameEvent[] } {
  const other = data.cards.suits.find((x) => x !== suit) as Suit;
  const events: GameEvent[] = [];
  let s = state;
  for (let guard = 0; guard < 8; guard++) {
    const head = s.tasks[0];
    if (head === undefined) throw new Error('The queue holds no host draw');
    if (head.t !== 'draw') throw new Error(`A ${head.t} task sits ahead of the host draw`);
    const mine = head.via === 'hostDraw';
    const out = resolveHeadDraw(data, s, mine ? suit : other, head.pid);
    events.push(...out.events);
    s = out.state;
    if (mine) return { state: s, events };
  }
  throw new Error('The queue never reached the host draw');
}

// ---------------------------------------------------------------------------
// ⛔ TRAP 3: THE DRAW GOES TO THE HOST, AT THREE SEATS AND AT TWO
// ---------------------------------------------------------------------------

describe('S17: the HOST draws, and the host is not the active player', () => {
  it('at THREE seats, with every half asserted separately', () => {
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    const VISITOR: Seat = 0;
    const HOST: Seat = 1;
    const BYSTANDER: Seat = 2;
    dealTo(arm, s, VISITOR, 'W7');
    dealTo(arm, s, HOST, 'O7', 'O9');
    dealTo(arm, s, BYSTANDER, 'D7');

    const hostHandBefore = [...player(s, HOST).hand];
    const visitorHandBefore = [...player(s, VISITOR).hand];
    const bystanderHandBefore = [...player(s, BYSTANDER).hand];

    const out = apply(arm, s, visit(VISITOR, HOST, 'W7'));

    // 1. TWO DRAW TASKS, ONE PER SEAT, AND THE LABELLED ONE IS THE HOST'S. The
    //    host farms Orchard, so the visitor's own payoff - the Orchard power's
    //    Draw 4 - is a second draw task belonging to the OTHER seat, which is
    //    exactly the pair a swapped orientation would make indistinguishable.
    //    ⚠️ THE VISITOR'S IS NOW THE ONE AT THE HEAD (11/09/2026): S17 is
    //    pushed last so that a probe of a visit can walk the power the visitor
    //    just bought. The orientation is asserted off `pid` and the `hostDraw`
    //    label, which is where it belongs, and never off the queue position.
    const draws = out.state.tasks.filter((t) => t.t === 'draw');
    expect(draws).toHaveLength(2);
    expect(hostDraws(out.state)).toHaveLength(1);
    expect(hostDraws(out.state)[0]?.pid).toBe(HOST);
    expect(draws.find((t) => t.t === 'draw' && t.via === undefined)?.pid).toBe(VISITOR);
    expect(out.state.tasks[0]?.pid).toBe(VISITOR);

    // 2. THE VISITOR'S OWN PAYOFF RESOLVES FIRST AND PAYS THE VISITOR ALONE.
    //    Nothing the host is owed has been paid yet, so a card reaching the
    //    host here could only have come out of the visitor's purchase.
    const bought = resolveHeadDraw(arm, out.state, 'apiary', VISITOR);
    expect(player(bought.state, HOST).hand).toEqual(hostHandBefore);
    expect(player(bought.state, VISITOR).hand.length).toBeGreaterThan(visitorHandBefore.length - 1);
    expect(hostDrawEvents(bought.events)).toHaveLength(0);
    const visitorHandBought = [...player(bought.state, VISITOR).hand];

    // 3. THEN THE CARD REACHES THE HOST'S HAND, and it comes off a deck the
    //    host chose. Exactly one, and the visitor gains nothing further from
    //    it, so the two payments cannot be confused for one another.
    const drawn = resolveHeadDraw(arm, bought.state, 'apiary', HOST);
    const hostHandAfter = player(drawn.state, HOST).hand;
    expect(hostHandAfter).toHaveLength(hostHandBefore.length + 1);
    expect(hostHandBefore.every((c) => hostHandAfter.includes(c))).toBe(true);
    expect(player(drawn.state, VISITOR).hand).toEqual(visitorHandBought);
    // 4. AND NOTHING REACHED THE THIRD SEAT AT ALL, at either step.
    expect(player(drawn.state, BYSTANDER).hand).toEqual(bystanderHandBefore);

    // The event names the host as the seat, and carries S17's label.
    const labelled = hostDrawEvents(drawn.events);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.seat).toBe(HOST);
    expect(labelled[0]?.cards).toHaveLength(1);
  });

  it('at TWO seats, where the single rival is the only seat it can go to', () => {
    // ⚠️ TWO SEATS IS WHERE THE ARM DEALS TWO BOARDS, so the host here owns
    // both D3 and the randomly dealt O3 and the visit has to name one. The
    // ORCHARD board is named deliberately: its power is a Draw for the VISITOR,
    // which is the nearest thing in the game to the host's own payment and
    // therefore the easiest pair to confuse if the orientation were wrong.
    const s = position(arm, ['wheat', 'dairy']);
    const VISITOR: Seat = 0;
    const HOST: Seat = 1;
    dealTo(arm, s, VISITOR, 'W7');
    dealTo(arm, s, HOST, 'D7', 'D9');
    expect(boardCards(arm, s, HOST)).toEqual([BOARD.dairy, BOARD.orchard]);
    const hostHandBefore = [...player(s, HOST).hand];
    const visitorHandBefore = [...player(s, VISITOR).hand];

    const out = apply(arm, s, visit(VISITOR, HOST, 'W7', BOARD.orchard));
    expect(hostDraws(out.state).map((t) => t.pid)).toEqual([HOST]);

    // ⚠️ THE VISITOR'S BOUGHT DRAW COMES FIRST IN THE QUEUE since 11/09/2026
    // (the probe-truncation fix), so it is resolved first and off a DIFFERENT
    // deck, which keeps the two payments tellable apart card by card.
    const bought = resolveHeadDraw(arm, out.state, 'orchard', VISITOR);
    expect(player(bought.state, HOST).hand).toEqual(hostHandBefore);
    const visitorHandBought = [...player(bought.state, VISITOR).hand];

    const drawn = resolveHeadDraw(arm, bought.state, 'vegetable', HOST);
    expect(player(drawn.state, HOST).hand).toHaveLength(hostHandBefore.length + 1);
    expect(player(drawn.state, VISITOR).hand).toEqual(visitorHandBought);
    expect(visitorHandBought).not.toContain('W7');
    expect(
      visitorHandBefore.filter((c) => c !== 'W7').every((c) => visitorHandBought.includes(c)),
    ).toBe(true);
    // And the card came off the deck the HOST picked, which is not their suit:
    // Dean's ruling that a host draws from any deck in play, like every other
    // draw in this game, rather than from their own suit's deck.
    const drawnCard = hostDrawEvents(drawn.events)[0]?.cards[0] as CardId;
    expect(arm.cards.catalogue.find((c) => c.id === drawnCard)?.suit).toBe('vegetable');
  });

  it('the host may draw off ANY deck in play, their own suit included but not required', () => {
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    dealTo(arm, s, 0, 'W7');
    dealTo(arm, s, 1, 'O7');
    const out = apply(arm, s, visit(0, 1, 'W7'));
    // ⚠️ THE HOST'S TASK BY ITS LABEL AND NOT BY ITS QUEUE POSITION: since
    // 11/09/2026 S17 is pushed behind everything the visitor bought, so
    // `tasks[0]` here is the visitor's own Orchard draw.
    const head = hostDraws(out.state)[0] as Task;
    const decks = taskAnswers(arm, out.state, head)
      .filter((a) => a.kind === 'deck')
      .map((a) => (a.kind === 'deck' ? a.suit : null));
    // All five suits are drawable in a fresh position, and every one of them is
    // offered: no own-suit restriction, which is Dean's "no rules exceptions".
    expect(new Set(decks)).toEqual(new Set(arm.cards.suits));
  });
});

// ---------------------------------------------------------------------------
// ⛔ TRAPS 1 AND 2: EXACTLY N, AND NEITHER `baseDraw` NOR `bonusDraw`
// ---------------------------------------------------------------------------

describe('S17 draws exactly `hostDrawOnVisit`, and reads no other draw-sized number', () => {
  function visited(data: GameData): { state: GameState; events: GameEvent[] } {
    const s = position(data, ['wheat', 'orchard', 'dairy']);
    dealTo(data, s, 0, 'W7');
    dealTo(data, s, 1, 'O7');
    return { state: apply(data, s, visit(0, 1, 'W7')).state, events: [] };
  }

  it('⛔ ONE card and not `baseDraw`’s TWO', () => {
    // The trap named in the overlay: `baseDraw` is see 2 / keep 2, so reusing
    // the plain Draw path would pay the host double. Both numbers are read
    // here so the assertion carries the trap rather than a comment alone.
    expect(arm.rules.turn.baseDraw).toEqual({ see: 2, keep: 2 });
    expect(hostDrawOnVisit(arm)).toBe(1);
    const after = visited(arm);
    const task = hostDraws(after.state)[0];
    expect(task?.see).toBe(1);
    expect(task?.keep).toBe(1);
    const drawn = resolveHostDraw(arm, after.state, 'wheat');
    expect(hostDrawEvents(drawn.events)[0]?.cards).toHaveLength(1);
  });

  it('⛔ and TWO when the knob says two, which is what separates it from `bonusDraw`', () => {
    // `rules.turn.bonusDraw` is 1 and subjectless under this currency. A stray
    // read of it would be invisible at the ruled value and wrong here.
    const twoCards = noticeBoardHostDrawGame(2);
    expect(twoCards.rules.turn.bonusDraw).toBe(1);
    expect(hostDrawOnVisit(twoCards)).toBe(2);
    const after = visited(twoCards);
    const task = hostDraws(after.state)[0];
    expect(task?.see).toBe(2);
    expect(task?.keep).toBe(2);
    const drawn = resolveHostDraw(twoCards, after.state, 'wheat');
    expect(hostDrawEvents(drawn.events)[0]?.cards).toHaveLength(2);
  });

  it('⛔ and NOTHING at the shipped 0, however much `bonusDraw` says otherwise', () => {
    expect(control.rules.turn.bonusDraw).toBe(1);
    expect(hostDrawOnVisit(control)).toBe(0);
    const after = visited(control);
    expect(hostDraws(after.state)).toHaveLength(0);
    // Not merely unlabelled: no task at all. The visitor's own Orchard power is
    // the single draw in the queue.
    expect(after.state.tasks.filter((t) => t.t === 'draw')).toHaveLength(1);
    expect(after.state.tasks.filter((t) => t.t === 'draw')[0]?.pid).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⛔ A SELF-VISIT NEVER PAYS IT
// ---------------------------------------------------------------------------

describe('⛔ a self-visit is never paid the host draw', () => {
  it('pays nothing when the visitor and the host are the same seat', () => {
    // ⛔ UNREACHABLE ON EVERY ARM THAT MATTERS - `selfVisitAllowed` is false on
    // all of them - and the guard is written and tested anyway, because the
    // reason is a rule rather than a configuration: a card drawn for visiting
    // yourself is a pure faucet with no giver, which is the shape the RESTOCK
    // ban closed. This data exists for this test alone.
    const selfArm = noticeBoardHostDrawSelfGame();
    const s = position(selfArm, ['orchard', 'wheat']);
    dealTo(selfArm, s, 0, 'O7');
    const handBefore = [...player(s, 0).hand];
    const out = apply(selfArm, s, visit(0, 0, 'O7'));
    expect(hostDraws(out.state)).toHaveLength(0);
    // The visit itself happened: the fee is on the seat's own board and the
    // power fired for them. It is only the PAYMENT that has no giver.
    expect(noticeBoardsOf(selfArm, out.state, 0)[0]?.stack).toEqual(['O7']);
    expect(out.events.some((e) => e.e === 'visited' && e.self)).toBe(true);
    expect(player(out.state, 0).hand).toEqual(handBefore.filter((c) => c !== 'O7'));
  });
});

// ---------------------------------------------------------------------------
// ONCE PER VISIT, NOT ONCE PER TURN
// ---------------------------------------------------------------------------

describe('S17 is paid ONCE PER VISIT and never latched to the turn', () => {
  it('a SECOND visit to the same owner in one turn is paid twice', () => {
    // ⭐ REACHABLE ONLY UNDER THE TWO-BOARD ARM, and only at two seats: S9
    // latches one use per BOARD per turn, so a second visit needs a second
    // board, and at two seats the single rival holds both. The host is paid
    // for both because they also receive two fee cards - the payment is for
    // the fee, not for the turn.
    // ⚠️ The second play came from the old A Helping Hand until it was
    // retired on 16/09/2026; the slot is now widened by rule to keep the case.
    const wide = withBonusSlots(arm);
    const s = position(wide, ['wheat', 'dairy']);
    dealTo(wide, s, 0, 'D9', 'W7', 'W9', 'W10', 'W12', 'W13', 'W14');
    dealTo(wide, s, 1, 'D7', 'D11');
    expect(boardCards(wide, s, 1)).toEqual([BOARD.dairy, BOARD.orchard]);
    const hostHandBefore = player(s, 1).hand.length;

    const first = apply(wide, s, visit(0, 1, 'W7', BOARD.dairy));
    expect(hostDraws(first.state)).toHaveLength(1);
    const afterFirst = settle(wide, first.state);

    const second = legalMoves(wide, afterFirst.state).filter((m) => m.type === 'visit');
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((m) => m.type === 'visit' && m.board === BOARD.orchard)).toBe(true);
    const out = apply(wide, afterFirst.state, second[0] as Move);
    expect(hostDraws(out.state)).toHaveLength(1);
    const afterSecond = settle(wide, out.state);

    // TWO labelled draws, both to the host, and two cards in their hand that
    // no fee and no action of theirs put there.
    const paid = [...hostDrawEvents(afterFirst.events), ...hostDrawEvents(afterSecond.events)];
    expect(paid).toHaveLength(2);
    expect(paid.every((e) => e.seat === 1)).toBe(true);
    expect(player(afterSecond.state, 1).hand.length).toBe(hostHandBefore + 2);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ W17 THE PIE SHOP IS NOW A DUPLICATE OF THE RULE, AND THE TWO STACK
// ---------------------------------------------------------------------------

describe('⚠️ W17 The Pie Shop beside S17: what a W17 owner actually draws', () => {
  it('a W17 owner visited ONCE draws TWO, and that is deliberate', () => {
    // ⚠️ THE CARD AND THE RULE SAY THE SAME WORDS ("Whenever a neighbour visits
    // you, Draw 1") AND BOTH FIRE. Nothing here suppresses either: the card is
    // a card, the rule is a rule, and they are two separate tasks. ⛔ THE
    // RETEXT IS A SHEET DECISION DEAN HAS NOT MADE, so no card changes in this
    // pass; this test is the reading it needs when he makes it.
    // THREE seats, so the host owns one board and the visit needs no `board`.
    const s = position(arm, ['orchard', 'wheat', 'dairy']);
    buildFor(arm, s, 1, 'W17');
    dealTo(arm, s, 0, 'O7', 'O9');
    dealTo(arm, s, 1, 'W9');
    const hostHandBefore = player(s, 1).hand.length;

    const out = apply(arm, s, visit(0, 1, 'O7'));
    const draws = out.state.tasks.filter((t) => t.t === 'draw' && t.pid === 1);
    // W17's task is pushed inside `afterVisit`, AHEAD of the visitor's power;
    // S17's is pushed LAST, behind it (the probe-truncation fix, 11/09/2026).
    // Both belong to the host either way, which is all this case reads.
    expect(draws).toHaveLength(2);
    expect(draws.filter((t) => t.t === 'draw' && t.via === 'hostDraw')).toHaveLength(1);
    expect(draws.filter((t) => t.t === 'draw' && t.src === 'W17')).toHaveLength(1);

    const settled = settle(arm, out.state);
    expect(player(settled.state, 1).hand.length).toBe(hostHandBefore + 2);
    // ⭐ NO LONGER ASYMMETRIC (Dean, 15/09/2026): W17 lost its once-a-turn
    // latch with the fire-once rule, so a W17 owner visited TWICE in one turn
    // draws four, exactly as the rule and the card each pay per visit.
    expect(settled.state.turn.firedThisTurn).not.toContain('W17');
  });

  it('under the CONTROL the same owner draws ONE: the card alone', () => {
    const s = position(control, ['orchard', 'wheat', 'dairy']);
    buildFor(control, s, 1, 'W17');
    dealTo(control, s, 0, 'O7', 'O9');
    dealTo(control, s, 1, 'W9');
    const hostHandBefore = player(s, 1).hand.length;
    const out = apply(control, s, visit(0, 1, 'O7'));
    expect(out.state.tasks.filter((t) => t.t === 'draw' && t.pid === 1)).toHaveLength(1);
    const settled = settle(control, out.state);
    expect(player(settled.state, 1).hand.length).toBe(hostHandBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// THE DRY TABLE: IT DEGRADES, IT NEVER THROWS
// ---------------------------------------------------------------------------

describe('S17 degrades gracefully when there is nothing to draw', () => {
  it('a visit still resolves with every deck and discard empty, and pays no card', () => {
    const s = position(arm, ['orchard', 'wheat', 'dairy']);
    // The host farms wheat, whose power stays legal off a bare hand ("put 1
    // card from your hand into your barn"), so the visit itself survives a dry
    // table and the only question left is what S17 does. Three seats, so the
    // host owns one board and the visit needs no `board`.
    dealTo(arm, s, 0, 'O7', 'O9');
    dealTo(arm, s, 1, 'W9');
    for (const suit of arm.cards.suits) {
      s.decks[suit] = [];
      s.discards[suit] = [];
    }
    const hostHandBefore = [...player(s, 1).hand];

    const out = apply(arm, s, visit(0, 1, 'O7'));
    expect(hostDraws(out.state)).toHaveLength(0);
    expect(player(out.state, 1).hand).toEqual(hostHandBefore);
    // And the game is still playable: nothing threw, and the queue drains.
    const settled = settle(arm, out.state);
    expect(settled.state.phase).toBe('playing');
    expect(hostDrawEvents(settled.events)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ⛔ THE CORRECTNESS GATE: AT 0 THE ENGINE IS THE ENGINE IT WAS
// ---------------------------------------------------------------------------

/**
 * A whole game played by taking a seeded-random legal move every time.
 *
 * ⭐ RANDOM AND NOT A BOT, DELIBERATELY, for the reason the two-board file
 * records: the gate is that two DATASETS produce the same game, so the chooser
 * only has to be a pure function of the position and the seed - and @gp/bots is
 * downstream of this package in any case. The MOVE LIST is compared as well as
 * the state, because two runs could in principle converge on one position by
 * different routes and that would still be a leak.
 */
function playout(
  data: GameData,
  seats: number,
  seed: string,
  cap = 1500,
): { moves: Move[]; state: GameState } {
  let state = newGame(data, { seats, seed });
  const rng = seedRng(`playout:${seed}`);
  const moves: Move[] = [];
  for (let i = 0; i < cap && state.phase === 'playing'; i++) {
    const legal = legalMoves(data, state);
    if (legal.length === 0) break;
    const move = legal[rngInt(rng, legal.length)] as Move;
    moves.push(move);
    state = apply(data, state, move).state;
  }
  return { moves, state };
}

function transcript(run: { moves: Move[]; state: GameState }): string {
  return JSON.stringify(run);
}

describe('⛔ the correctness gate: `hostDrawOnVisit` 0 changes nothing at all', () => {
  /** The arm's own overlay with the one leaf explicitly at zero. */
  const zero: GameData = noticeBoardHostDrawGame(0);

  it('plays byte-identical games to the control at TWO seats', () => {
    for (const seed of ['gate-1', 'gate-2', 'gate-3']) {
      expect(transcript(playout(zero, 2, seed)), seed).toBe(transcript(playout(control, 2, seed)));
    }
  });

  it('plays byte-identical games to the control at THREE and FOUR seats', () => {
    for (const seed of ['gate-1', 'gate-2']) {
      expect(transcript(playout(zero, 3, seed)), seed).toBe(transcript(playout(control, 3, seed)));
      expect(transcript(playout(zero, 4, seed)), seed).toBe(transcript(playout(control, 4, seed)));
    }
  });

  it('⭐ and the ARM at 1 DIFFERS, which is the other half of the gate', () => {
    // Both halves matter: identical in both directions would mean the knob is
    // not wired at all, and this is the whole of what Dean ruled in.
    for (const seats of [2, 3, 4]) {
      expect(transcript(playout(arm, seats, 'gate-1')), `${seats} seats`).not.toBe(
        transcript(playout(control, seats, 'gate-1')),
      );
    }
  });

  it('the setup itself is identical at every seat count, rng included', () => {
    // The narrower claim underneath the gate, and the one that fails FIRST if
    // the knob ever reaches setup: same decks, same hands, same island, same
    // rng state at move zero. It holds for the ARM as well as for the zero
    // column, because S17 is paid during a visit and nowhere else.
    for (const seats of [2, 3, 4]) {
      for (const seed of ['setup-1', 'setup-2']) {
        const expected = JSON.stringify(newGame(control, { seats, seed }));
        expect(JSON.stringify(newGame(zero, { seats, seed })), `zero ${seats} ${seed}`).toBe(
          expected,
        );
        expect(JSON.stringify(newGame(arm, { seats, seed })), `arm ${seats} ${seed}`).toBe(
          expected,
        );
      }
    }
  });

  it('⛔ and it has NO SUBJECT under the v31 card control, at 1 as much as at 0', () => {
    // `rules.turn.hostDrawOnVisit` is read only under `visitCurrency:
    // 'noticeBoardPower'`. The knob at 1 on top of the v31 control must
    // therefore be that control, move for move. (It was asserted against the
    // shipped commons until the commons was deleted on 13/09/2026.)
    const v31 = cardVisitGame();
    const v31AtOne = applyOverlay(v31, {
      name: 'v31-with-host-draw-probe',
      schemaVersion: 1,
      set: { 'rules.turn.hostDrawOnVisit': 1 },
    });
    expect(hostDrawOnVisit(BASE_GAME_DATA)).toBe(0);
    for (const seats of [2, 3]) {
      expect(transcript(playout(v31AtOne, seats, 'gate-1')), `${seats} seats`).toBe(
        transcript(playout(v31, seats, 'gate-1')),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// THE LABEL ITSELF: PURELY ADDITIVE
// ---------------------------------------------------------------------------

describe('the `via` label is additive and nothing else carries it', () => {
  it('every OTHER card that reaches a hand is unlabelled, in the arm as in the control', () => {
    // ⭐ THE ONE FIELD THIS PASS ADDED, and the assertion that it is inert: a
    // full random game under the CONTROL must emit no labelled event at all,
    // and under the ARM every labelled event must be a draw to a seat that is
    // not the one taking the turn.
    const plain = playout(control, 3, 'label-1');
    expect(plain.moves.length).toBeGreaterThan(20);
    const s = position(arm, ['wheat', 'orchard', 'dairy']);
    dealTo(arm, s, 0, 'W7');
    dealTo(arm, s, 1, 'O7');
    const out = apply(arm, s, visit(0, 1, 'W7'));
    const settled = settle(arm, out.state);
    const all = settled.events.filter((e) => e.e === 'cardsToHand');
    // The visitor's Orchard Draw 4 is in there too, and it is NOT labelled.
    expect(all.length).toBeGreaterThan(1);
    expect(hostDrawEvents(settled.events)).toHaveLength(1);
    expect(all.filter((e) => e.e === 'cardsToHand' && e.via === undefined).length).toBeGreaterThan(
      0,
    );
  });
});
