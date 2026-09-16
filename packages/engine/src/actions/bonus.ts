/**
 * THE BONUS SLOT.
 *
 * Split out of actions.ts on 2026-09-12. The commons (C1-C10) and Dean's
 * 'spend' variant, which shared this module because of import cycles, were
 * deleted on 13/09/2026.
 */

import type { Fx } from '../fx.js';
import { fireHook } from '../fx.js';
import {
  canSowOnto,
  cardById,
  doorOf,
  drawableSuits,
  hostDrewThisRound,
  isFull,
  meeplesHeld,
  noticeBoardOf,
  noticeBoardSlots,
  noticeBoardsOf,
  player,
  visitTargetOf,
  workerData,
} from '../query.js';
import type { BonusOption, CardId, GameState, Move, Seat } from '../state.js';
import { markFiredOnTurn } from '../state.js';
import {
  dairyBoardMods,
  fireNoticeBoardPower,
  meepleActionOf,
  performDoorAction,
} from '../workers.js';
import type { GameData, Suit } from '@gp/data';
import {
  hostDrawCapPerRound,
  hostDrawOnVisitAt,
  isMeepleCurrency,
  isNoticeBoardPower,
  meepleSpendDistinctColours,
  meepleSpendPerTurn,
  meepleSpendTiming,
} from '@gp/data';
import { anyBuildOption } from './build.js';
import { doorActionLegal, vegetableBoardCanDeliver, workerActionLegal } from './doors.js';
import { deckGrowOptions } from './grow.js';
import { meepleFills, slotTollOf } from './meeples.js';
import { withoutFirst } from './shared.js';

// --- The bonus slot --------------------------------------------------------

/**
 * How many bonus options this seat may take this turn: `rules.turn.bonusSlotsPerTurn`,
 * and nothing else.
 *
 * ⛔ THE CARD-TEXT HALF IS GONE (16/09/2026). This used to add whatever built
 * cards granted, through a `wireExtraBonusSlots` lookup the handler registry
 * installed at import time, and its only producer was the old A Helping Hand
 * (W18/V18/O18/A18/D18): *"Each turn, you may take both bonus options"*, which
 * under the notice-board visit became a SECOND PLAY onto a different board. The
 * v42 sheet prints five different per-suit Helping Hands, none of which widens
 * the slot, so the second play left the game and the seam was deleted with its
 * only user rather than left wired to nothing. A future card that widens the
 * slot needs the seam back. `seat` is kept so callers need not change.
 */
export function bonusSlotsFor(data: GameData, _state: GameState, _seat: Seat): number {
  return data.rules.turn.bonusSlotsPerTurn;
}

/**
 * THE BONUS WINDOW, three-state since 03/09/2026 (`rules.turn.bonusTiming`).
 *
 * ⭐ Dean, 03/09/2026, correcting the engine and both design docs: **the turn
 * is meeples, then your CORE ACTION, then the bonus.** `'end'` is the rule and
 * the shipped default; `!actionSpent` had been the predicate since 19/08/2026
 * and was measuring a game nobody was playing.
 *
 *   `'end'`    open once the action is spent. `pass` is in `MAIN_ACTIONS`, so a
 *              seat with no legal action still opens its window and cannot be
 *              stranded without a bonus.
 *   `'start'`  the old rule, open only while `!actionSpent`. The paired control.
 *   `'any'`    v14's "once per turn, at any point". Always open.
 *
 * With `option` given it also answers "is THIS half still available?", which is
 * what stopped a seat holding the old A Helping Hand (retired 16/09/2026) from
 * taking Draw 1 twice under the controls: it granted both options, not two of
 * either. It still matters wherever `bonusSlotsPerTurn` is above 1.
 *
 * ⭐ WHAT THE CORRECTION CHANGES, and it is not a power level. Under `'start'`
 * a door could FUEL the action after it (visit the Orchard door for Draw 3, then
 * Build with those cards) and nothing could inform the door. Under `'end'` the
 * action SETS THE DOOR UP: fill a building with a Grow, then Harvest it through
 * the Wheat door; harvest into your barn, then Deliver through the Vegetable
 * one. The doors whose worth is conditional on how the turn went are the ones
 * that gain, and Wheat and Vegetable are exactly the two the v10 door mix found
 * underused against Orchard's unconditional Draw 3.
 *
 * ⚠️ SLOT UNSPENT still reads this knob, and its absolute is still a rational
 * floor rather than a prediction: a bot never forgets a window and a human does.
 * Only the delta between the arms means anything.
 */
export function bonusOpen(data: GameData, state: GameState, option?: BonusOption): boolean {
  const turn = state.turn;
  if (turn.bonusUsed.length >= bonusSlotsFor(data, state, state.turnPlayer)) return false;
  // ⭐ THE NOTICE-BOARD VISIT IS EXEMPT FROM "ONE OF EACH" (S9, 10/09/2026):
  // its slot holds ONE option, the visit, so refusing a second use of it would
  // make a second slot worth nothing at all. What stops two plays being the
  // same play is not this rule but S9's ONE-USE-PER-BOARD latch in
  // `enumerateNoticeBoardVisits`, which sends the second bonus to a DIFFERENT
  // board. The exemption is keyed on the mode as well as the option, because
  // `'visit'` is producible under three currencies and only this one widens
  // the slot.
  //
  // ⚠️ SINCE 16/09/2026 ITS ONLY SUBJECT IS `bonusSlotsPerTurn` ABOVE 1. The
  // card that made it live, the old A Helping Hand's second play, is retired
  // (see `bonusSlotsFor`); in the shipped game one slot is all there is, and
  // the tests that pin S9's latch widen the slot through that knob instead.
  if (
    option !== undefined &&
    !(option === 'visit' && isNoticeBoardPower(data)) &&
    turn.bonusUsed.includes(option)
  ) {
    return false;
  }
  // A knob and not a constant because this rule ships with others that all move
  // the visit rate, and the diagnosis needs them separable.
  switch (data.rules.turn.bonusTiming) {
    case 'any':
      return true;
    case 'start':
      return !turn.actionSpent;
    case 'end':
      return turn.actionSpent;
  }
}

/**
 * ⭐ THE MEEPLE SPEND WINDOW, AND SINCE 12/09/2026 THERE ARE TWO OF THEM
 * (`rules.turn.meepleSpendTiming`, A151).
 *
 *   `'start'`        the v31 rule and the shipped value: the very start of your
 *                    turn, before the bonus option and before the core action.
 *   `'afterAction'`  M4, the delivery meeple: AFTER your main action, discard
 *                    one meeple for the PLAIN action of its colour.
 *   `'none'`         no spend at all. Reachable, unused, and NOT the off switch:
 *                    `'start'` is what leaves the game alone.
 *
 * ⛔ **`'start'` IS THE CURRENT BEHAVIOUR AND MUST STAY BYTE-IDENTICAL.** Both
 * of its clauses are the rule and neither is redundant. `!actionSpent` is the
 * obvious half; `bonusUsed.length === 0` is the half that stops a meeple being
 * held back and spent after the bonus, which is what would turn the supply into
 * a hand of free reactive actions rather than a decision taken up front. Under
 * `bonusTiming: 'end'` that second clause cannot bind, and it stays anyway:
 * deleting a clause because the shipped knob value makes it unreachable is the
 * exact mistake `turnflow.ts` documents at its own `bonusOpen` line.
 *
 * ⭐ **`'afterAction'` IS ONE PREDICATE BECAUSE OF D7, RULED BY DEAN ON
 * 12/09/2026: the spend is legal on ANY turn once the action window has closed,
 * whether the main action was taken or PASSED.** `pass` is in `MAIN_ACTIONS`, so
 * `actionSpent` is exactly "the window has closed" and no second clause is
 * needed. His reasoning, which is the part worth keeping: gating it on a real
 * action would create a perverse incentive to take a pointless one first, and D8
 * already makes a meeple undiscardable whenever its colour's action is illegal,
 * so stranding is a real risk and not one to compound.
 *
 * ⚠️ **IT REVERSES, MILDLY, THE REASON THE BONUS SITS AT THE FRONT.** The
 * bonus was moved to the start of the turn on Dean's own reading that a turn
 * visibly ends on the main action; a meeple spend after it means some turns end
 * on a bonus again (§6.2 of `docs/village-store-coins-2026-09-12-v2.md`).
 * Recorded, not resolved: most turns have no meeple to spend.
 *
 * ⚠️ THE PER-TURN CAP IS CHECKED HERE AND THE DISTINCT-COLOUR RULE IS NOT,
 * because they are questions of different shapes: the cap closes the WINDOW and
 * C112's rule only removes COLOURS from it. See `meepleOptions`.
 */
export function meepleSpendOpen(data: GameData, state: GameState): boolean {
  if (!meepleSpendsLeft(data, state)) return false;
  switch (meepleSpendTiming(data)) {
    case 'none':
      return false;
    case 'start':
      return !state.turn.actionSpent && state.turn.bonusUsed.length === 0;
    case 'afterAction':
      return state.turn.actionSpent;
  }
}

/**
 * ⭐ IS THIS TURN RATIONED AT ALL - does either of the two per-turn rules
 * apply (M5's cap, or C112's no-two-of-a-colour)?
 *
 * ⛔ **IT IS THE ONE PREDICATE THAT DECIDES WHETHER `turn.meeplesSpent` IS
 * WRITTEN**, and that is the whole of the inertness argument: the field is
 * ABSENT under the shipped game and all three named controls, so no
 * serialised state and no view moves for a rule
 * nothing is running. Nine fixtures depend on that kind of absence.
 */
function meepleSpendRationed(data: GameData): boolean {
  return meepleSpendPerTurn(data) !== null || meepleSpendDistinctColours(data);
}

/**
 * M5: has this turn any meeple spends left in it? `null` is UNLIMITED and is the
 * shipped value, which is why this reads true for the whole of the v31 control's
 * turn and the arm's cap of 1 is the only thing that ever closes it.
 */
function meepleSpendsLeft(data: GameData, state: GameState): boolean {
  const cap = meepleSpendPerTurn(data);
  if (cap === null) return true;
  return (state.turn.meeplesSpent ?? []).length < cap;
}

/**
 * The colours this seat may spend right now: held, not shut out by C112, and
 * with something legal for that colour's action to do.
 *
 * ⭐ **D8, INDICATED BY THE HANDOFF AND TAKEN HERE: A MEEPLE THAT CAN DO
 * NOTHING IS NOT OFFERED**, on the standing ruling that an action you cannot
 * legally perform right now is not offered (the same rule as a dead door - see
 * `workerActionLegal` - and it has survived every currency this game has had).
 * It bites harder here, because spending a meeple is FREE, so a meeple spent for
 * nothing is a pure loss of a stored action.
 *
 * ⛔ **SO A MEEPLE CAN BE UNDISCARDABLE, AND THAT IS THE RULE RATHER THAN A
 * BUG.** A seat can be left holding meeples it may never legally spend - a
 * vegetable meeple with an empty barn, a dairy meeple with nothing affordable -
 * and `meepleGained` minus `meepleSpent` IS the dead-component count. It is a
 * reading the instrument owes rather than a thing to fix, and it is the reason
 * D7 does not also require a real main action: two stranding rules would
 * compound.
 */
export function meepleOptions(data: GameData, state: GameState, seat: Seat): Suit[] {
  // ⛔ THE TURN-START MEEPLE SPEND IS DELETED BY THE MEEPLE-LOOP ARM (R8), and
  // this empty list is the whole of the deletion. The bonus visit becomes the
  // only way a meeple is ever spent, and a spent meeple moves to a neighbour's
  // board rather than leaving the game.
  //
  // ⚠️ IT ALSO CLOSES THE TURNFLOW GATE. `settleTurn` holds a turn open
  // while this is non-empty (turnflow.ts, the line after the bonus check);
  // returning [] here is what stops the arm's turns hanging on a phase that no
  // longer exists, so the two must never be reasoned about separately.
  //
  // ⚠️ IT IS ALSO THE ONE CURRENCY THE DELIVERY MEEPLE MAY NOT BE STACKED
  // ON: under `'meeple'` a spend MOVES a meeple to a neighbour's board and never
  // boxes it, so M4's "the meeple then leaves the game" would be two rules at
  // once.
  if (isMeepleCurrency(data)) return [];
  if (!meepleSpendOpen(data, state)) return [];
  const held = player(state, seat).meeples;
  // ⭐ C112's ALTERNATIVE TO THE CAP: no two meeples spent in one turn may
  // share a colour. Shipped false, so `spent` is read only by the arm that wants
  // it - and the list itself is absent unless a per-turn rule is on.
  const distinct = meepleSpendDistinctColours(data);
  const spent = state.turn.meeplesSpent ?? [];
  return data.cards.suits.filter(
    (colour) =>
      (held[colour] ?? 0) > 0 &&
      !(distinct && spent.includes(colour)) &&
      // ⭐ ASKED ON THE MEEPLE'S OWN ACTION AND NOT ON THE DOOR'S ROSTER ID
      // (M7, 12/09/2026). Under `'afterAction'` an apiary meeple buys a GROW
      // where the roster prints SOW, and the gate and the action must be handed
      // the same question or a meeple is offered with nothing to do - the
      // 19/08/2026 harvest mismatch, arriving through a new door.
      // `meepleActionOf` is the identity under every other timing, so the v31
      // control still asks about its Sow.
      doorActionLegal(data, state, seat, meepleActionOf(data, colour)),
  );
}

/**
 * Spend one meeple: perform its colour's PLAIN action, free, and REMOVE IT FROM
 * THE GAME.
 *
 * It returns to no pool, which is the whole economy: under the v31 control the
 * island is the only source, and under M4 the only source is the island's 3
 * and 4 VP tokens (the Workers, since 16/09/2026), so every meeple spent is one
 * fewer action left in the game for anybody.
 * Nothing here spends the bonus slot or the action - a meeple is neither - and
 * `meepleSpendOpen` is what decides which half of the turn it belongs to.
 *
 * ⛔ **THE PLAIN ACTION AND NEVER A NOTICE BOARD POWER (M6).**
 * `performDoorAction` is the plain path; `fireNoticeBoardPower` is the other one
 * and no meeple ever reaches it. Under `visitCurrency: 'noticeBoardPower'` the
 * Orchard BOARD is "Draw 4" and the plain action is Draw 2, so the two are no
 * longer the same thing and a meeple takes the smaller one.
 *
 * The action is taken as the SPENDER's, on the standing ruling that suit powers
 * apply to actions performed through a door or by a meeple: it is your action,
 * whatever wooden thing paid for it. A meeple of a suit nobody is farming works
 * exactly the same, which is why the colour is looked up in `workers.roster` and
 * never in `state.fair`.
 */
export function doSpendMeeple(fx: Fx, seat: Seat, colour: Suit): void {
  if (isMeepleCurrency(fx.data)) {
    throw new Error('The turn-start meeple spend is deleted under the meeple visit currency');
  }
  if (!meepleSpendOpen(fx.data, fx.state)) {
    throw new Error(
      meepleSpendTiming(fx.data) === 'afterAction'
        ? 'A meeple is spent after your main action, and this turn has none left'
        : 'Meeples are spent at the start of your turn, before your bonus and action',
    );
  }
  if (!meepleOptions(fx.data, fx.state, seat).includes(colour)) {
    throw new Error(`Seat ${seat} has no ${colour} meeple that can do anything`);
  }
  fx.spendMeeple(seat, colour);
  // ⭐ THE EVENT CARRIES THE ACTION THE COLOUR ACTUALLY BOUGHT, which since
  // 12/09/2026 is not always the roster's printed one (M7: an apiary meeple buys
  // GROW). It used to read `doorOf(data, colour).action`, and an instrument
  // reading that would have reported a Sow that never happened.
  fx.emit({ e: 'meepleSpent', seat, colour, action: meepleActionOf(fx.data, colour) });
  // ⛔ RECORDED ONLY WHERE A RULE READS IT (M5, C112). See
  // `meepleSpendRationed`: the field is absent under every game that does not
  // ration the turn, which is what keeps the shipped game and all three controls
  // byte-identical.
  if (meepleSpendRationed(fx.data)) {
    const turn = fx.state.turn;
    turn.meeplesSpent = [...(turn.meeplesSpent ?? []), colour];
  }
  performDoorAction(fx, seat, colour, 'meeple');
}

/**
 * The bonus slot's SOLITAIRE half: Draw `rules.turn.bonusDraw` off the top of
 * any one deck in play.
 *
 * Offered as a single move with no deck named, because the deck pick is the draw
 * task's own answer - the same see/keep machinery as the plain Draw, so
 * `afterDrawKeep` fires and any future draw reactor sees it. That is deliberate:
 * this is a real Draw, unlike the `buy` and `market` it replaced, both of which
 * were carefully NOT draws so that no draw modifier could reach them.
 */
export function bonusDrawOpen(data: GameData, state: GameState): boolean {
  // ⛔ CLOSED UNDER THE MEEPLE-LOOP ARM (R9): there is no standalone free Draw
  // 1, and the only card the bonus slot can draw is the one attached to Collect.
  // The NUMBER survives - `doCollect` draws `rules.turn.bonusDraw` - so the knob
  // still prices the solitaire line, which is now "collect an empty board".
  if (isMeepleCurrency(data)) return false;
  // ⛔ AND CLOSED UNDER THE NOTICE-BOARD VISIT (S5, 10/09/2026), which is a
  // PASSENGER THE HANDOFF DID NOT PIN and had to be named rather than
  // inherited. S5 says the bonus action IS the visit, one per turn, optional -
  // the slot holds one option - and the standalone free Draw 1 is one of the
  // three things `'card'` carries that this arm explicitly does not want. It
  // is also the thing that killed v31: the free Draw ate the slot at 67.6%,
  // and leaving it open here would have measured that failure a second time
  // under a different name. The NUMBER survives, unread, exactly as it does
  // under the meeple loop.
  if (isNoticeBoardPower(data)) return false;
  if (!bonusOpen(data, state, 'draw')) return false;
  if (data.rules.turn.bonusDraw <= 0) return false;
  return drawableSuits(data, state).length > 0;
}

export function doBonusDraw(fx: Fx, seat: Seat): void {
  if (!bonusDrawOpen(fx.data, fx.state)) {
    throw new Error('The bonus slot is shut, or no deck has a card left');
  }
  const n = fx.data.rules.turn.bonusDraw;
  fx.state.turn.bonusUsed.push('draw');
  fx.pushTask({ t: 'draw', pid: seat, src: null, see: n, keep: n, revealed: [] });
}

export type VisitOption = Extract<Move, { type: 'visit' }>;

/**
 * Every visit on offer: one card from hand onto ANY unclogged Notice Board,
 * your own included.
 *
 * ⭐ THREE ENUMERATORS BEHIND ONE MOVE TYPE SINCE 10/09/2026, and the note
 * below describes the FIRST of them. `enumerateVisits` dispatches on the
 * currency: the v31 card fee (this note), the meeple loop
 * (`enumerateMeepleVisits`) and the notice-board visit
 * (`enumerateNoticeBoardVisits`), which buys a board's PRINTED POWER rather
 * than its suit's plain door and rations boards by a per-turn latch rather than
 * by a clog.
 *
 * ⭐ THE SELF-VISIT IS RISK 2 OF THE WHOLE PASS, and `rules.turn.selfVisitAllowed`
 * is its paired control. It replaces the old "activate your own Service for a
 * coin", and the difference is that the card now LANDS on the board: your own
 * traffic clogs your own door at threshold 2 exactly as a rival's does, so
 * feeding your board shuts it in two turns and locks every neighbour out of your
 * suit's action until you spend a Harvest clearing it. That structural brake is
 * the ONLY thing holding the solitaire option back, because both halves of the
 * slot now cost the same currency - one card - where every previous version had
 * the solitaire half bought with coins.
 *
 * A dead door is not offered (see `workerActionLegal`), so a visit always buys
 * something.
 */
export function visitOptions(data: GameData, state: GameState, seat: Seat): VisitOption[] {
  const out: VisitOption[] = [];
  enumerateVisits(data, state, seat, out);
  return out;
}

/**
 * IS ANY VISIT ON OFFER? Exactly `visitOptions(...).length > 0`, and it is the
 * same function saying so - `enumerateVisits` walks one list and stops at the
 * first hit when nobody wants the moves themselves.
 *
 * It exists because two callers only ever asked the QUESTION. `hasBonusOption`
 * (which `settleTurn` calls after every apply, the bots' speculative probe
 * applies included) and the sim's denial probe both built the whole list to read
 * `.length`, which under the meeple currency is up to (rival hosts x 5 colours x
 * 10 wild pairs) move objects thrown away unread. A shared enumerator rather
 * than a second predicate, deliberately: a predicate COPIED out of an enumerator
 * silently stops agreeing with it, which is a mistake the sim's own bonus-window
 * probe already made once.
 */
export function anyVisitOption(data: GameData, state: GameState, seat: Seat): boolean {
  return enumerateVisits(data, state, seat, null);
}

/**
 * The one walk behind both. `out === null` means "stop at the first legal
 * visit"; anything else collects every one of them, in enumeration order.
 */
function enumerateVisits(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: VisitOption[] | null,
): boolean {
  if (!bonusOpen(data, state, 'visit')) return false;
  if (isMeepleCurrency(data)) return enumerateMeepleVisits(data, state, seat, out);
  if (isNoticeBoardPower(data)) return enumerateNoticeBoardVisits(data, state, seat, out);
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat && !data.rules.turn.selfVisitAllowed) continue;
    // ⚠️ ONE BOARD PER SEAT HERE, DELIBERATELY, and `noticeBoardOf` is the
    // right function rather than a first-match accident. Dean's two-board fix
    // (`rules.economy.noticeBoardsBySeats`, 11/09/2026) is read ONLY under
    // `visitCurrency: 'noticeBoardPower'` - `extraNoticeBoardsPerSeat` returns
    // 0 for every other currency - so under the v31 card fee no seat has a
    // second board and this line has no second board to miss. If that gate ever
    // widens, this is one of the two enumerators that has to learn to loop.
    if (isFull(data, noticeBoardOf(data, state, host))) continue;
    const doorId = doorOf(data, player(state, host).suit).id;
    // ONLY TWO OF THE FIVE DOORS READ THE HAND, so only two of them can give a
    // different answer for a different fee. Sow needs a card to sow and Build
    // needs cards to pay with; Draw, Harvest and Deliver ask about the decks,
    // the tableau and the barn and never look at the hand at all - see
    // `workerActionLegal`, where `hand` is touched in exactly those two
    // branches. Asking once for those three is the same answer as asking it once
    // per card in hand, minus a `withoutFirst` copy each time.
    const action = workerData(data, doorId).action;
    if (action !== 'sow' && action !== 'build') {
      if (!workerActionLegal(data, state, seat, doorId)) continue;
      if (out === null) return true;
      for (const fee of hand) out.push({ type: 'visit', seat, host, fee });
      any = true;
      continue;
    }
    for (const fee of hand) {
      if (!workerActionLegal(data, state, seat, doorId, { excludingHandCard: fee })) continue;
      if (out === null) return true;
      out.push({ type: 'visit', seat, host, fee });
      any = true;
    }
  }
  return any;
}

/**
 * ⭐ IS THIS BOARD'S POWER LEGAL FOR THIS SEAT RIGHT NOW (S10, Dean
 * 10/09/2026)? The standing door ruling - a board whose power you cannot
 * perform is not offered - asked of the five S12 powers rather than of the five
 * plain doors.
 *
 * ⚠️ IT IS A DIFFERENT QUESTION FROM `doorActionLegal` AND HAS TO BE. Three
 * of the five powers are wider than the plain action they are named after: the
 * Dairy board waives the crop requirement, so it is legal where a plain Build
 * is not; the Wheat board harvests a building at ANY stack size and banks a
 * card besides, so it is legal where a plain Harvest has no full building; and
 * the Vegetable board has a fallback, so it is legal with an empty barn.
 * Asking the plain gate would refuse boards the arm exists to keep alive - S13
 * fixed availability first, and four of the morning's five powers were dead
 * most of the time.
 *
 * ⭐ IT SHOULD ALMOST NEVER BITE, which is §2.3's whole purpose: with a card
 * in hand only the Orchard board can be dead (every deck exhausted), and even
 * the Apiary board needs only one building with room.
 *
 * `excludingHandCard` is the FEE, which has left the hand by the time the power
 * runs, so every hand-reading leg has to be asked without it - the same rule
 * `doorActionLegal` follows and for the same reason: a hand of one card cannot
 * both pay the board and feed the power.
 */
export function noticeBoardPowerLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  colour: Suit,
  opts?: {
    excludingHandCard?: CardId;
  },
): boolean {
  const p = player(state, seat);
  const hand =
    opts?.excludingHandCard === undefined ? p.hand : withoutFirst(p.hand, opts.excludingHandCard);
  const numbers = data.rules.economy.noticeBoardPower;
  switch (colour) {
    case 'orchard':
      // "Draw 4." Dead only when every deck in play is exhausted.
      return drawableSuits(data, state).length > 0;
    case 'dairy':
      // "Build, spending cards of any crops, with a discount of 2" (R10,
      // 16/09/2026). The discount and the waiver are part of the gate, not just
      // of the resolution: the gate prices the build the power pushes.
      return anyBuildOption(data, state, seat, hand, dairyBoardMods(data));
    case 'wheat':
      // "Harvest one of your buildings, then put 1 card from your hand into
      // your barn." EITHER leg makes it live: a building with a card on it
      // (`filter: 'loaded'`, any stack size), or a card left in hand for the
      // barn. That second leg is ruling C88's whole purpose.
      return (
        p.tableau.some((b) => b.stack.length >= 1) || (numbers.wheatBarn > 0 && hand.length > 0)
      );
    case 'apiary':
      // "Sow 2 cards from your hand onto your buildings." A card to sow and
      // somewhere of your OWN to put it (C89) - and never the Notice Board
      // itself (S11), which is why this reads `canSowOnto`.
      //
      // ⭐ Dean's retext, ruled 14/09/2026 and the shipped power: a deck-paid GROW
      // is live exactly when the task it pushes has an answer, so the gate reads
      // the task's own list.
      if (numbers.apiaryPower !== 'sow') {
        return (
          deckGrowOptions(data, state, seat, numbers.apiaryPower === 'deckGrowWild').length > 0
        );
      }
      return (
        numbers.apiarySows > 0 && hand.length > 0 && p.tableau.some((b) => canSowOnto(data, b))
      );
    case 'vegetable':
      // "Deliver - 2 of the cards may be any crop. If you cannot, put 2 cards
      // from your hand into your Barn." (R9.) A delivery WITH the relaxation,
      // else the fallback - so it is dead only for a seat that can do neither
      // AND holds nothing.
      return (
        vegetableBoardCanDeliver(data, state, seat) ||
        (numbers.vegetableFallback > 0 && hand.length > 0)
      );
    default:
      return colour satisfies never;
  }
}

/**
 * EVERY NOTICE-BOARD VISIT ON OFFER (S5-S11, Dean 10/09/2026): one card from
 * your hand onto ANY player's Notice Board, your own included, for that board's
 * printed power.
 *
 * ⭐ THE THREE RULES THAT ARE NOT THE v31 ENUMERATOR'S, in the order they are
 * applied:
 *
 *  - **S6, self-use is back**, reversing the ban of 04/09/2026, gated by
 *    `rules.turn.selfVisitAllowed` as it was in v31.
 *    `overlays/notice-board-visit-no-self-v1.overlay.json` is the control and
 *    the single most important sub-arm in the plan. Why it is safe now and was
 *    not then: in v31 every board printed the SAME thing, so a self-visit was
 *    strictly better than a visit and took 22.2% of turns; here the five
 *    boards print five DIFFERENT powers, so your own board is one option of
 *    five and it is the one that never has what you have not got.
 *  - **S9, ONE USE PER BOARD PER TURN.** A second bonus (the old A Helping
 *    Hand's, retired 16/09/2026; now only `bonusSlotsPerTurn` above 1) must go
 *    to a DIFFERENT board. The corpus records a chaining blow-up in the
 *    predecessor where five or six loads in one turn drew most of the deck.
 *  - **S8, nothing ever blocks.** `isFull` answers false for a `3+` board
 *    however deep the stack, so this filter bites only under the paired
 *    control `noticeBoardBlocks: true` - where it is exactly the v31 rule and
 *    exactly the stall being measured.
 *
 * ⛔ THE LATCH IS `turn.firedThisTurn`, KEYED BY THE BOARD'S CARD ID, and the
 * choice is worth the sentence it takes. That list means "this card's printed
 * text has fired this turn" and a Notice Board's power IS its printed text, so
 * the semantics fit rather than being borrowed. It identifies the HOST
 * uniquely because `newGame` refuses duplicate player suits, so W3 is one
 * seat's board and no other's. And nothing else reads it in a way that could
 * change: `growOptions` and `activateTargets` are the only two filters over
 * that list and both have excluded the noticeboard slot by name since v31. The
 * alternative - a parallel per-turn list - would have added a `TurnState`
 * field, and an added field is a serialisation change every fixture in
 * `packages/sim/fixtures/` would have had to absorb.
 *
 * ⚠️ ONLY THE DAIRY BOARD IS ASKED ONCE PER FEE. Four of the five powers
 * read the hand for its SIZE alone after the fee leaves it, and that is
 * `hand.length - 1` whichever card pays; the Dairy board's waived build reads
 * WHICH cards are left, so it and only it can answer differently for different
 * fees. Same reduction the v31 enumerator makes for its three hand-blind doors,
 * and it saves a `withoutFirst` copy per card in hand on four boards out of
 * five.
 *
 * ⭐ AND SINCE DEAN'S TWO-BOARD FIX (11/09/2026) IT WALKS BOARDS RATHER THAN
 * SEATS, WHICH IS THE WHOLE OF THE VARIANT IN THIS FUNCTION. A host may hold
 * TWO Notice Boards at two seats - its own suit's, and one drawn from the suits
 * nobody is farming - so the inner loop is over `noticeBoardsOf(host)` and a
 * seat now faces 2 / 2 / 3 targets by seat count instead of 1 / 2 / 3.
 *
 * ⛔ AND THE POWER COMES OFF THE BOARD'S OWN SUIT, NEVER OFF
 * `player(state, host).suit`. That was the same thing in every game until the
 * fix and is the silent bug the variant can have: a host's SECOND board prints
 * a different colour's power, so reading the owner's suit would sell a wheat
 * visitor the apiary board's Grow, invisibly, and only ever at two seats.
 *
 * ⭐ S9'S LATCH IS STILL A CORRECT PARTITION AND NEEDED NO CHANGE, because it
 * is keyed on the BOARD'S CARD ID: no suit's board is ever on the table twice
 * (a seat's own suit is its own board and the extras are dealt from the
 * unfarmed suits without replacement), so W3 still identifies one board on one
 * farm. What changed was that a second play (the old A Helping Hand's, retired
 * 16/09/2026) had somewhere to go at two seats - the rival's other board - where
 * under the control the one legal target was latched by the first play.
 */
function enumerateNoticeBoardVisits(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: VisitOption[] | null,
): boolean {
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  // The stand-in fee for the four hand-blind powers: they read the hand's SIZE
  // after the fee leaves it, which is the same for every card in it.
  const probeFee = hand[0] as CardId;
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat && !data.rules.turn.selfVisitAllowed) continue;
    const boards = noticeBoardsOf(data, state, host);
    // ⭐ THE FIELD IS OMITTED WHEN THE HOST HAS ONE BOARD, which is what keeps
    // every move this enumerator produces byte-identical to the control's at
    // three and four seats - and to the shipped game's, and to every fixture
    // in `packages/sim/fixtures/`. See the `visit` move's own docblock.
    const named = boards.length > 1;
    for (const board of boards) {
      if (state.turn.firedThisTurn.includes(board.card)) continue;
      if (isFull(data, board)) continue;
      const colour = cardById(data, board.card).suit;
      const tag = named ? { board: board.card } : {};
      if (colour !== 'dairy') {
        if (!noticeBoardPowerLegal(data, state, seat, colour, { excludingHandCard: probeFee })) {
          continue;
        }
        if (out === null) return true;
        for (const fee of hand) out.push({ type: 'visit', seat, host, fee, ...tag });
        any = true;
        continue;
      }
      for (const fee of hand) {
        if (!noticeBoardPowerLegal(data, state, seat, colour, { excludingHandCard: fee })) continue;
        if (out === null) return true;
        out.push({ type: 'visit', seat, host, fee, ...tag });
        any = true;
      }
    }
  }
  return any;
}

/**
 * EVERY MEEPLE VISIT ON OFFER, under the meeple-loop arm (R1, R7, R10, X5).
 *
 * One move per (rival host, colour) where the colour is one this seat HOLDS, the
 * host's slot of that colour is free, and the colour's door has something legal
 * for this seat to do. Plus the WILD SPEND: for a colour this seat does not
 * hold, one move per unordered PAIR of held colours, on the same two gates. Both
 * meeples of a pair land in the bought colour's slot.
 *
 * ⭐ NEVER YOUR OWN BOARD (X5), under any flag. `rules.turn.selfVisitAllowed` is
 * not consulted here and must not be: the arm's whole reason for existing is
 * that the solitaire option and the interaction option stopped competing in one
 * slot, and the solitaire option is now Collect. A self-visit would put them
 * back in the same slot at a lower price than the card fee ever charged.
 *
 * ⭐ THE DOOR IS THE SLOT'S COLOUR, NOT THE HOST'S SUIT. Every board has all
 * five slots, so what a visit buys is decided by the meeple you spend and not by
 * what your neighbour farms - which is the availability half of the fix. On more
 * than half of v31's turns no rival door offered an action the visitor could
 * use; here a host offers five, minus the ones already blocked.
 *
 * A DEAD DOOR IS STILL NOT OFFERED (`workerActionLegal`, Dean's standing ruling,
 * unchanged by the currency): a visit that buys a no-op is a dominated move, and
 * under the arm it would also strand a meeple on a rival's board for nothing.
 * `excludingHandCard` is gone with the fee - no card leaves the hand (R1).
 */
function enumerateMeepleVisits(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: VisitOption[] | null,
): boolean {
  const held = meeplesHeld(data, state, seat);
  if (held.length === 0) return false;
  const supply = player(state, seat).meeples;
  // ⭐ R6 AS AMENDED (handoff v2): `toll` null is v1's rule - an occupied slot
  // is BLOCKED and refuses that colour - and a number is v2's: the slot is never
  // refused, it costs that many extra meeples per meeple already sitting in it,
  // and the extras go to the BOX rather than into the slot. Dean's reason for it
  // is a sink ("might be a good way of sinking surplus meeples"), and the design
  // reason is the Feld line the handoff quotes: state may price an option but
  // never remove it.
  const toll = slotTollOf(data);
  // WHETHER A COLOUR'S DOOR HAS ANYTHING FOR THIS SEAT DOES NOT DEPEND ON THE
  // HOST. The gate reads (data, state, seat, colour) and nothing else, so asking
  // it inside the host loop put the same question to `anyBuildOption` and
  // `anyDeliverOption` once per rival - three times over at four seats.
  // Memoised per colour and computed lazily, so a colour whose slot is blocked
  // at every host is still never asked about.
  const doorLegal = new Map<Suit, boolean>();
  const legalDoor = (colour: Suit): boolean => {
    let hit = doorLegal.get(colour);
    if (hit === undefined) {
      hit = workerActionLegal(data, state, seat, doorOf(data, colour).id);
      doorLegal.set(colour, hit);
    }
    return hit;
  };
  // The wild pair, and ONLY for a colour this seat does not hold: a colour you
  // hold you would always spend singly, so enumerating a pair for it would be a
  // strictly worse move wearing the same result. The pairs vary with neither the
  // host nor the colour bought, so they are built once.
  const pairs: [Suit, Suit][] = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) {
      const a = held[i];
      const b = held[j];
      if (a === undefined || b === undefined) continue;
      pairs.push([a, b]);
    }
  }
  let any = false;
  for (let host = 0; host < state.players.length; host++) {
    if (host === seat) continue;
    const slots = noticeBoardSlots(state, host);
    for (const colour of data.cards.suits) {
      const occupants = slots[colour]?.length ?? 0;
      // Under v1 an occupied slot is simply not a target. Under v2 it is a
      // target with a price, and `tollsFor` returns the ways to pay it.
      if (occupants > 0 && toll === null) continue;
      if (!legalDoor(colour)) continue;
      const owed = toll === null ? 0 : toll * occupants;
      if (held.includes(colour)) {
        if (owed === 0) {
          if (out === null) return true;
          out.push({ type: 'visit', seat, host, fee: null, meeples: [colour], colour });
          any = true;
          continue;
        }
        const after = { ...supply, [colour]: (supply[colour] ?? 0) - 1 };
        const ways = tollFills(data, after, owed);
        if (ways.length === 0) continue;
        if (out === null) return true;
        for (const paid of ways) {
          out.push({ type: 'visit', seat, host, fee: null, meeples: [colour], colour, toll: paid });
        }
        any = true;
        continue;
      }
      if (pairs.length === 0) continue;
      for (const pair of pairs) {
        if (owed === 0) {
          if (out === null) return true;
          out.push({ type: 'visit', seat, host, fee: null, meeples: [pair[0], pair[1]], colour });
          any = true;
          continue;
        }
        const after = { ...supply };
        after[pair[0]] = (after[pair[0]] ?? 0) - 1;
        after[pair[1]] = (after[pair[1]] ?? 0) - 1;
        const ways = tollFills(data, after, owed);
        if (ways.length === 0) continue;
        if (out === null) return true;
        for (const paid of ways) {
          out.push({
            type: 'visit',
            seat,
            host,
            fee: null,
            meeples: [pair[0], pair[1]],
            colour,
            toll: paid,
          });
        }
        any = true;
      }
    }
  }
  return any;
}

/**
 * The ways to pay a toll of `owed` meeples out of what is left of a supply,
 * as SORTED COLOUR LISTS in a fixed order.
 *
 * ⚠️ THIS IS THE ONE PLACE THE v2 CHANGE CAN BLOW UP THE MOVE LIST, and
 * it is bounded on purpose. A toll is a burn, so which colours go is a real
 * decision and is enumerated in full - but only as a MULTISET over colours,
 * never as a choice among identical tokens, exactly as `meepleFills` argues. At
 * `slotToll` 1 and one occupant it is at most five options; the arithmetic is
 * the same count-vector walk, reused, and the list is rebuilt as colours rather
 * than counts because the move carries the toll as a list.
 */
function tollFills(data: GameData, supply: Readonly<Record<Suit, number>>, owed: number): Suit[][] {
  if (owed <= 0) return [[]];
  const out: Suit[][] = [];
  for (const fill of meepleFills(data.cards.suits, supply)) {
    if (fill.total !== owed) continue;
    const paid: Suit[] = [];
    for (const colour of data.cards.suits) {
      for (let i = 0; i < (fill.counts[colour] ?? 0); i++) paid.push(colour);
    }
    out.push(paid);
  }
  return out;
}

export type CollectOption = Extract<Move, { type: 'collect' }>;

/**
 * COLLECT: the meeple-loop arm's other bonus option (R7) - take every meeple off
 * your OWN Notice Board into your supply, then Draw 1.
 *
 * ⭐ IT IS THE HALF OF THE DESIGN THAT PAYS THE HOST. Being visited was worth
 * nothing in v31 beyond a card you would eventually harvest; here it hands you
 * back stored actions, so a busy door is an asset rather than a clog.
 *
 * ⭐ COLLECTING AN EMPTY BOARD IS LEGAL and reads as a plain Draw 1 (R7,
 * explicitly). It is the solitaire line, and it is deliberately not priced out:
 * the bonus slot must never be dead. The bonus mix has to count it apart from a
 * collect that actually took meeples back, because it is what the free Draw 1
 * became - see the `boardCollected` event, whose `kept` list is that
 * distinction.
 *
 * ⛔ NO "DRAW 1 PER MEEPLE COLLECTED" (X6). Flat Draw 1, at
 * `rules.turn.bonusDraw`, however many came back.
 */
export function collectOpen(data: GameData, state: GameState, seat: Seat): boolean {
  // False under the v31 card game and the notice-board visit: Collect is the
  // meeple loop's own half of the slot and has no subject in either. One
  // predicate rather than three, so the two modes that have no Collect cannot
  // drift apart.
  if (!isMeepleCurrency(data)) return false;
  if (!bonusOpen(data, state, 'collect')) return false;
  const slots = noticeBoardSlots(state, seat);
  const holdsMeeple = data.cards.suits.some((colour) => (slots[colour]?.length ?? 0) > 0);
  // An empty board with every deck dry is the one case where Collect does
  // nothing at all, and a move that does nothing is not offered.
  return holdsMeeple || drawableSuits(data, state).length > 0;
}

export function collectOptions(data: GameData, state: GameState, seat: Seat): CollectOption[] {
  return collectOpen(data, state, seat) ? [{ type: 'collect', seat }] : [];
}

/**
 * Take the meeples back, then draw. The order is the printed order and it is
 * observable: a `boardCollected` event before the draw task means a UI can
 * animate the meeples home while the deck choice is still open.
 */
export function doCollect(fx: Fx, seat: Seat): void {
  if (!collectOpen(fx.data, fx.state, seat)) {
    throw new Error('Collect is shut: outside the bonus window, or nothing to take and no deck');
  }
  fx.collectBoard(seat);
  fx.state.turn.bonusUsed.push('collect');
  const n = fx.data.rules.turn.bonusDraw;
  if (n > 0) {
    fx.pushTask({ t: 'draw', pid: seat, src: null, see: n, keep: n, revealed: [] });
  }
}

/**
 * Is ANY bonus-slot option legal right now? Two of them since v31, and the
 * shrinking is the point: the slot held five options on 19/08/2026 (two visit
 * modes, your own Service, the market and the GBP 2 upgrade), four of which were
 * bought with coins. Deleting the currency deleted the competitors.
 *
 * Read by `settleTurn` and by the UI's bonus phase.
 */
export function hasBonusOption(data: GameData, state: GameState, seat: Seat): boolean {
  // Two options under either control and never four: `bonusDrawOpen` is false
  // under the meeple arm and `collectOpen` is false under the card game, so the
  // pair on offer is (Draw 1 | visit) or (Collect | visit).
  //
  // ⭐ AND EXACTLY ONE UNDER THE NOTICE-BOARD VISIT, which offers the visit
  // alone (S5) - `bonusDrawOpen` closes under it and `collectOpen` has no
  // meeples to collect.
  return (
    bonusDrawOpen(data, state) ||
    collectOpen(data, state, seat) ||
    anyVisitOption(data, state, seat)
  );
}

/**
 * THE VISIT: one card from your hand onto a Notice Board, then that board's suit
 * action, taken by YOU.
 *
 * The order is load-bearing and unchanged from v14: the fee LANDS first, then
 * `afterVisit` fires host-side, then the action runs. A host-side reactor
 * therefore sees the card on the board, and a door that clogged on this very
 * card is still the door that was bought.
 *
 * ⛔ NOTHING IS MINTED. In v14 this function paid the visitor for a coin visit
 * and the host a wage for a Service visit, and the whole design rested on
 * interaction MINTING money from the bank rather than moving it between players.
 * v31 keeps the shape and deletes the payment: what the visitor gets is the
 * ACTION, and what the host gets is a card on their board that they will harvest
 * into their own barn. "Your junk is their treasure" survives the currency.
 */
/**
 * What a visit is paid with. The `'card'` game fills `fee`; the meeple-loop arm
 * fills `meeples` and `colour` and leaves `fee` null. One shape rather than two
 * functions, because everything AFTER the payment - the host-side hook, the
 * `visited` event, the door action - is identical and must stay identical.
 *
 * ⭐ `board` IS WHICH OF THE HOST'S NOTICE BOARDS THE FEE LANDS ON, and it is
 * present only where a host has more than one to choose between - Dean's
 * two-board fix at two seats (11/09/2026). It is a spend in the strict sense:
 * it names the building the payment goes to, so it belongs here beside the fee
 * rather than beside the payoff.
 */
export type VisitSpend = Pick<VisitOption, 'fee' | 'meeples' | 'colour' | 'toll' | 'board'>;

export function doVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  if (isMeepleCurrency(fx.data)) {
    doMeepleVisit(fx, visitor, host, spend);
    return;
  }
  if (isNoticeBoardPower(fx.data)) {
    doNoticeBoardVisit(fx, visitor, host, spend);
    return;
  }
  const state = fx.state;
  const fee = spend.fee;
  if (fee === null) throw new Error('A visit costs one card from your hand');
  if (visitor === host && !fx.data.rules.turn.selfVisitAllowed) {
    throw new Error('Self-visiting is switched off');
  }
  if (!bonusOpen(fx.data, state, 'visit')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  const target = visitTargetOf(fx.data, state, host);
  if (isFull(fx.data, target)) throw new Error(`${target.card} is full`);
  const colour = player(state, host).suit;
  const door = doorOf(fx.data, colour);
  if (!workerActionLegal(fx.data, state, visitor, door.id, { excludingHandCard: fee })) {
    throw new Error(`The ${colour} door has nothing legal to do for seat ${visitor}`);
  }

  fx.placeOnBuilding(visitor, { seat: host, card: target.card }, fee);
  state.turn.bonusUsed.push('visit');
  // Host-side reactors fire once per visit, after the fee lands and before the
  // payoff (the reference fires it here too).
  fireHook(fx, 'afterVisit', { visitor, host, self: visitor === host });
  fx.emit({
    e: 'visited',
    seat: visitor,
    host,
    self: visitor === host,
    colour,
    action: door.action,
  });
  performDoorAction(fx, visitor, colour, 'visit');
}

/**
 * ⭐ S17, THE HOST DRAW: **WHEN A NEIGHBOUR VISITS YOU, YOU DRAW 1 CARD.**
 * (Dean, ruled 11/09/2026, `rules.turn.hostDrawOnVisit`.)
 *
 * ⭐ ITS PROVENANCE IS A TABLE AND NOT A SIMULATION, which is rare enough in
 * this project to be the first thing recorded about it. Dean played the
 * two-board arm at a two-player table on 11/09/2026, house-ruled this in during
 * the session, and reported that the visiting worked well, that everyone
 * visited, that every Notice Board was used at some stage, and that "the rule
 * that the person who gets visited draws a card led to a lot of extra cards in
 * play, which relieved the tightness of the game in a useful way".
 *
 * ⛔ **IT AMENDS S7** (`docs/notice-board-visit-handoff-2026-09-10-v2.md`),
 * which said in as many words that the fee resting on the host's board "is the
 * payment and there is no other". There is now one other and it is paid
 * INSTANTLY: the host is paid twice, once in a card drawn now and once in
 * material they must still harvest and then deliver. Do not quote S7 forward
 * without S17 beside it.
 *
 * ⛔ **THE DRAW GOES TO THE HOST, WHO IS NOT THE ACTIVE PLAYER**, and that is
 * the one bug this rule can have. It is the same class of mistake as the
 * power-firing-for-the-visitor orientation twenty lines below: the visitor is
 * paid in the POWER, the host in the CARD, and swapping them turns a payment to
 * the giver into a second payment to the taker. A self-visit would hide it,
 * which is one of two reasons the guard below exists.
 *
 * ⛔ **AND A SELF-VISIT NEVER PAYS IT.** `selfVisitAllowed` is false on every
 * arm this rule is measured under, so the guard is unreachable there, and it is
 * written anyway because the reason is a rule rather than a configuration: a
 * card drawn for visiting yourself is a pure faucet with no giver, minted by
 * nobody, and the standing ban on RESTOCK was exactly a ban on that shape. The
 * knob is an integer and `'card'`-currency overlays can put self-visiting back
 * on the table, so the guard is the thing that stops the two ever meeting.
 *
 * ⭐ **THE HOST DRAWS FROM ANY DECK IN PLAY, EXACTLY AS EVERY OTHER DRAW IN
 * THIS GAME DOES** (Dean's standing principle of no rules exceptions). So this
 * pushes the ordinary see-N/keep-N draw TASK, whose answers are deck picks -
 * the same machinery as the plain Draw action, the bonus Draw and W17's - and
 * the host makes the choice themselves in the middle of the visitor's turn,
 * which W17 The Pie Shop has done since 04/09/2026. It is NOT `autoDraw`:
 * `autoDraw` prefers the seat's own suit, fires no draw reactors, and would be
 * a sixth kind of draw invented for one rule.
 *
 * ⛔ **AND IT DRAWS `hostDrawOnVisit` CARDS AND NEVER `baseDraw`'s.** The plain
 * Draw action is see 2 / KEEP 2 since v31, so reusing `doDraw` would hand the
 * host TWO cards where the knob asks for one - the trap the overlay names by
 * name. `see` and `keep` are both the knob. ⛔ And `rules.turn.bonusDraw` is
 * NOT this number: it is 1, it is the v31 standalone free Draw 1 deleted on
 * 04/09/2026, it is subjectless under this currency, and a stray read of it
 * would look right and be wrong.
 *
 * ⚠️ **ONCE PER VISIT AND NOT ONCE PER TURN**, which is the second engine
 * ruling the overlay left owed. At two seats the single rival holds two boards,
 * so a second bonus slot (the old A Helping Hand, retired 16/09/2026, or
 * `bonusSlotsPerTurn` above 1) can send a SECOND visit to the same owner in one
 * turn and they are paid for both - because they also receive two fee cards, and the
 * payment is for the fee rather than for the turn. There is deliberately no
 * latch on `turn.firedThisTurn` here: a latch belongs to a CARD's text (the
 * standing rule of 11/08/2026 that no card's text fires twice in a turn) and
 * this is a rule of the game.
 *
 * ⚠️ **W17 THE PIE SHOP IS NOW A DUPLICATE OF THIS RULE IN WORDS** ("Whenever a
 * neighbour visits you, Draw 1") **AND THE TWO STACK: A W17 OWNER VISITED ONCE
 * DRAWS TWO.** That is deliberate rather than emergent - the card is a card and
 * the rule is a rule, they are pushed as two separate tasks, and nothing here
 * suppresses either. It is also ASYMMETRIC in a way worth knowing before the
 * retext: W17 carries a once-a-turn latch and this rule does not, so a W17
 * owner visited twice in one turn draws THREE and not four. ⛔ The retext is a
 * SHEET decision Dean has not made, so no card changes in this pass; when he
 * makes it, this note is the reading it needs.
 *
 * It degrades gracefully with the table: a draw task with no drawable deck has
 * no legal answer and `drainTasks` drops it, so a dry table pays nothing rather
 * than throwing. The `drawableSuits` check below is the same statement made
 * early, so that no empty task is ever pushed at all.
 */
function payHostDrawOnVisit(fx: Fx, visitor: Seat, host: Seat): void {
  // ⛔ A SELF-VISIT NEVER PAYS IT: a faucet with no giver. See the block above.
  if (visitor === host) return;
  // ⛔ SEAT-AWARE, AND NEVER THE BARE SCALAR: `hostDrawOnVisitBySeats` can
  // switch the payment off at one seat count and leave it on at the others,
  // which is the only lever left that reaches the four-seat breach. Reading
  // `hostDrawOnVisit` here would be right until somebody set a slot.
  const n = hostDrawOnVisitAt(fx.data, fx.state.seats);
  if (n <= 0) return;
  // ⭐ THE HOST-DRAW CAP, HALF ONE - THE READ (`rules.turn.hostDrawCapPerRound`,
  // 11/09/2026): a host is paid AT MOST ONCE between their own turns, however
  // many neighbours visit them in the meantime. The latch is cleared in
  // `clearHostDrawLatch` (turnflow.ts) at the moment the HOST's own turn begins,
  // which is what makes this a cap per ROUND rather than a cap per the VISITOR's
  // turn - the distinction the knob exists for, because a visitor-side cap bites
  // at two seats alone and four seats is the only seat count that breaches the
  // band.
  const capped = hostDrawCapPerRound(fx.data);
  if (capped && hostDrewThisRound(fx.state, host)) return;
  // ⭐ THE CORRECTNESS GATE IN ONE LINE: at the shipped 0 nothing is pushed, no
  // task is created, no rng call is consumed and no event is emitted, so the
  // engine behaves exactly as it did before this rule existed.
  //
  // ⚠️ AND IT SITS ABOVE THE LATCH-SET DELIBERATELY: A PAYMENT NOBODY COULD TAKE
  // IS NOT A PAYMENT TAKEN. A dry table pays nothing (the rule degrading
  // gracefully, which a21 reads as the shortfall from 100%), and it must not
  // ALSO burn the host's one entitlement for the round - that would make the cap
  // bite hardest exactly when the decks are thinnest, which is a second rule
  // nobody asked for.
  if (drawableSuits(fx.data, fx.state).length === 0) return;
  // ⭐ THE HOST-DRAW CAP, HALF TWO - THE SET. On the task being pushed and never
  // on its answer: the entitlement is spent when the payment is made, and the
  // host choosing which deck to draw from is not a thing that can fail.
  if (capped) player(fx.state, host).hostDrewThisRound = true;
  fx.pushTask({ t: 'draw', pid: host, src: null, see: n, keep: n, revealed: [], via: 'hostDraw' });
}

/**
 * ⛔ THE NOTICE-BOARD VISIT (S5-S11, Dean 10/09/2026), AND THE ONE BUG THIS
 * DESIGN CAN HAVE IS IN THESE TWENTY LINES.
 *
 * **THE POWER FIRES FOR THE VISITOR AND THE CARD LANDS ON THE HOST.** The
 * visitor is paid instantly with the power; the host is paid in material they
 * still have to harvest and deliver, and that is the host's whole payment (S7).
 * Swap the two seats and the design inverts into paying the giver nothing,
 * which is the fault the Lopiano lens names in all seven previous versions of
 * this bonus action - so `fx.placeOnBuilding` is handed `{ seat: host }` and
 * `fireNoticeBoardPower` is handed `visitor`, and those two arguments are the
 * design.
 *
 * ⚠️ A SELF-VISIT HIDES THE MISTAKE, because both seats are the same, which
 * is why the test for it is written at THREE seats and asserts all four halves
 * separately: the host's board gained the card, the host's HAND did not move,
 * the visitor's hand lost the card, and the visitor got the payoff.
 *
 * The ORDER is the v31 branch's, unchanged and load-bearing: the fee LANDS
 * first, then `afterVisit` fires host-side, then the power runs. So a host-side
 * reactor (W17 The Pie Shop, alive again now that there is a host) sees the
 * card on the board, and A16 The Beekeeper's Veil sees the placement that
 * brought the board to two - which is S16's second ruling and falls out of
 * `placeOnBuilding` firing `afterPlacement`.
 *
 * ⭐ `doorUsed` IS EMITTED HERE RATHER THAN INSIDE THE POWER, on D4's
 * reasoning: action inflation (a16) and the door mix (a07) count a bought
 * action off one field, and they must count this exactly as they counted a v31
 * visit. `via` stays `'visit'`, and the ACTION is the
 * board's own suit verb (`doorActionOf`), which is what each power amplifies -
 * Orchard draw, Dairy build, Wheat harvest, Apiary sow, Vegetable deliver.
 *
 * Every predicate the enumerator applied is re-asked, including S9's latch:
 * a re-validation must ask what the move NEEDS and never trust the window the
 * caller consumed.
 */
function doNoticeBoardVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  const state = fx.state;
  const fee = spend.fee;
  if (fee === null) throw new Error('A visit costs one card from your hand');
  if (spend.meeples !== undefined && spend.meeples.length > 0) {
    throw new Error('There are no meeples under the notice-board visit');
  }
  if (visitor === host && !fx.data.rules.turn.selfVisitAllowed) {
    throw new Error('Self-visiting is switched off');
  }
  if (!bonusOpen(fx.data, state, 'visit')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  // ⭐ WHICH BOARD, AND THE ONE LINE THAT WOULD PUT THE FEE ON THE WRONG
  // BUILDING IF IT WERE WRONG (Dean's two-board fix, 11/09/2026). `spend.board`
  // is the move's own answer and `visitTargetOf` refuses a card that is not one
  // of this host's boards; with the field absent it is the host's own suit's
  // board, which is every game but the two-board arm.
  //
  // ⛔ AND A HOST WITH TWO BOARDS MUST BE TOLD WHICH ONE. Defaulting would
  // silently send every fee to the seat's own suit's board and leave the second
  // one empty for the whole game, which is a wrong answer that no test of the
  // payoff would ever catch - the power would be right, the card would be on
  // the wrong building, and the owner would harvest the same income either way.
  if (spend.board === undefined && noticeBoardsOf(fx.data, state, host).length > 1) {
    throw new Error(`Seat ${host} has more than one Notice Board: the visit must name one`);
  }
  const target = visitTargetOf(fx.data, state, host, spend.board);
  // S9, ONE USE PER BOARD PER TURN. Thrown here and FILTERED in the
  // enumerator, which is this file's standing division of labour.
  if (state.turn.firedThisTurn.includes(target.card)) {
    throw new Error(`${target.card} has already been used this turn`);
  }
  // S8: false for a `3+` board however deep the stack, so this bites only
  // under the `noticeBoardBlocks: true` control.
  if (isFull(fx.data, target)) throw new Error(`${target.card} is full`);
  // ⛔ THE BOARD'S SUIT AND NOT THE HOST'S. They are the same for a seat's own
  // board and differ on every board the two-board fix deals, and this is the
  // line that decides WHICH POWER IS BOUGHT - see the enumerator, which reads
  // the same field for the same reason.
  const colour = cardById(fx.data, target.card).suit;
  if (!noticeBoardPowerLegal(fx.data, state, visitor, colour, { excludingHandCard: fee })) {
    throw new Error(`The ${colour} Notice Board has nothing legal to do for seat ${visitor}`);
  }

  // THE CARD LEAVES THE VISITOR'S HAND AND LANDS ON THE HOST'S BOARD. Read the
  // two seat arguments together: `visitor` is who is paying, `{ seat: host }`
  // is whose building it lands on.
  fx.placeOnBuilding(visitor, { seat: host, card: target.card }, fee);
  state.turn.bonusUsed.push('visit');
  markFiredOnTurn(state.turn, target.card);
  fireHook(fx, 'afterVisit', { visitor, host, self: visitor === host });
  // ⚠️ THE ROSTER'S PRINTED ACTION AND NOT `doorActionOf`: `visited.action`
  // is typed `WorkerAction`, the five-door set, and `doorActionOf` returns the
  // wider `DoorAction`.
  const action = doorOf(fx.data, colour).action;
  fx.emit({
    e: 'visited',
    seat: visitor,
    host,
    self: visitor === host,
    colour,
    action,
  });
  fx.emit({ e: 'doorUsed', seat: visitor, colour, action, via: 'visit' });
  // AND THE POWER FIRES FOR THE VISITOR.
  fireNoticeBoardPower(fx, visitor, colour, {
    src: null,
    deliverLegal: vegetableBoardCanDeliver(fx.data, state, visitor),
  });
  fireHook(fx, 'afterWork', { actor: visitor, colour, action, via: 'visit' });
  // ⭐ S17 IS PAID LAST, AND THE QUEUE POSITION IS THE WHOLE POINT (the probe
  // truncation defect, found and fixed 11/09/2026).
  //
  // ⛔ **THE DEFECT.** S17 pushes a draw TASK for the HOST in the middle of the
  // VISITOR's turn. Pushed before `fireNoticeBoardPower`, as it was when the
  // rule was first written, it sat at the HEAD of the queue while the visitor's
  // own bought power sat behind it - and `probeAt` in `probe.ts` returns
  // `next: []` and `pending: null` the moment the head task is not the probing
  // seat's own, deliberately, because a rollout may not answer for a rival. So
  // a bot evaluating a visit had its rollout cut before the power it had just
  // paid for was ever walked. Measured over real decisions on the arm against
  // its paired control:
  //
  //     seats   mean rollout value of a visit   probes cut dead   bonus premium
  //     2p      2.358 -> 0.003                  18.9% -> 99.9%    80.6% -> 0.1%
  //     3p      3.367 -> 0.115                   2.4% -> 89.4%    96.4% -> 10.6%
  //     4p      2.806 -> 0.240                  13.3% -> 81.3%    86.4% -> 18.7%
  //
  // A visit cost the bot a card plus the gift to the host and earned, in its
  // books, nothing, so it stopped visiting: every bonus rate, door mix and hook
  // number taken off the arm before this fix describes the defect and not S17.
  //
  // ⭐ **THE FIX, AND THE PRINCIPLE UNDER IT: a visit's rollout must always be
  // able to see what the visitor bought.** The two payments are independent -
  // the visitor is paid in the power, the host in a card off a deck - so the
  // order between them is free, and free order must never be spent on blinding
  // the seat whose turn it is. The visitor's whole purchase is queued first
  // (the power's own tasks, and anything `afterWork` adds), then the host's
  // draw. It is also the more natural table order: nobody waits for the host to
  // pick a deck before the visitor resolves what they just bought.
  //
  // ⛔ **THIS SUPERSEDES THE COMMENT THAT USED TO STAND AT THE OLD CALL SITE**,
  // which argued S17 belonged immediately after `afterVisit` "so that W17 The
  // Pie Shop's task keeps the queue position it has always had". That reasoning
  // was written before the defect was known and it was the wrong trade: it
  // protected a card's queue position at the cost of every bot valuation of the
  // move. ⚠️ **W17's OWN TASK HAS NOT MOVED** - it is still pushed inside
  // `afterVisit`, ahead of the power - so no existing card's behaviour changes
  // and every control arm stays byte-identical. That leaves W17 truncating the
  // rollout of a visit to a W17 owner exactly as it always has (9.9% to 13.4%
  // of probes at three and four seats), which is a REPORTED residue and not an
  // oversight: moving it would move recorded games in the controls too.
  //
  // ⭐ **NOTHING MOVES AT THE SHIPPED 0.** `payHostDrawOnVisit` pushes no task,
  // emits no event and consumes no rng when the knob is 0, so the correctness
  // gate in `notice-board-host-draw.test.ts` - the arm at 0 against
  // `overlays/notice-board-visit-two-boards-v1.overlay.json` - is untouched by
  // where it is called from. It emits no events at any value either, so the
  // EVENT stream of a visit is unchanged and only the task order moves.
  payHostDrawOnVisit(fx, visitor, host);
}

/**
 * THE MEEPLE VISIT (R1, R2, R10, X5): one meeple - or a wild pair - from your
 * supply into the colour slot of a NEIGHBOUR's Notice Board, then that colour's
 * action, taken by you.
 *
 * The order is the same as the card visit's and for the same reason: the
 * payment LANDS first, then `afterVisit` fires host-side, then the action runs.
 * A17 The Smoke Pot and O16 The Fruit Store both key on that hook and neither
 * knows what paid.
 *
 * ⭐ NOTHING LEAVES THE GAME. The meeple sits in the host's slot until the host
 * spends a bonus option collecting it, which is the loop: your spent action
 * becomes their stored one. It is also the denial: while it sits there, that
 * colour of that neighbour is shut to the whole table.
 *
 * Every predicate below is the enumerator's, re-checked - a re-validation must
 * ask what the move NEEDS, never the window the caller has consumed.
 */
function doMeepleVisit(fx: Fx, visitor: Seat, host: Seat, spend: VisitSpend): void {
  const state = fx.state;
  if (visitor === host) {
    throw new Error('There is no self-visit under the meeple visit currency');
  }
  if (!bonusOpen(fx.data, state, 'visit')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  const colour = spend.colour;
  const meeples = spend.meeples ?? [];
  if (colour === undefined || meeples.length === 0) {
    throw new Error('A meeple visit names the slot colour and the meeple(s) spent');
  }
  if (meeples.length > 2) throw new Error('A visit spends one meeple, or two as a wild');
  const held = player(state, visitor).meeples;
  if (meeples.length === 1) {
    if (meeples[0] !== colour)
      throw new Error(`A ${meeples[0]} meeple buys the ${meeples[0]} slot`);
  } else {
    const [a, b] = meeples;
    if (a === undefined || b === undefined || a === b) {
      throw new Error('A wild spend is two meeples of different colours');
    }
    // The enumerator offers a pair only for a colour the seat does not hold, so
    // re-validating that keeps "apply accepts exactly what legalMoves offers".
    if ((held[colour] ?? 0) > 0) {
      throw new Error(`Seat ${visitor} holds a ${colour} meeple and must spend it singly`);
    }
  }
  // The acting meeple(s) and the toll come out of one supply, so they are
  // counted together before either is checked - two meeples of a colour cannot
  // be one spend and one toll when the seat holds only one.
  const toll = spend.toll ?? [];
  const wanted: Partial<Record<Suit, number>> = {};
  for (const m of [...meeples, ...toll]) wanted[m] = (wanted[m] ?? 0) + 1;
  for (const [m, n] of Object.entries(wanted) as [Suit, number][]) {
    if ((held[m] ?? 0) < n) throw new Error(`Seat ${visitor} has no ${m} meeple`);
  }
  // ⭐ R6 AS AMENDED: the slot is PRICED, not blocked. `slotToll` null keeps
  // v1's refusal; a number charges that many meeples per occupant, and both the
  // refusal and the price are re-validated here because `apply` must accept
  // exactly what the enumerator offered.
  const slotToll = slotTollOf(fx.data);
  const occupants = noticeBoardSlots(state, host)[colour]?.length ?? 0;
  if (occupants > 0 && slotToll === null) {
    throw new Error(`Seat ${host}'s ${colour} slot already holds a meeple`);
  }
  const owed = slotToll === null ? 0 : slotToll * occupants;
  if (toll.length !== owed) {
    throw new Error(
      `Seat ${host}'s ${colour} slot costs ${owed} extra meeples, got ${toll.length}`,
    );
  }
  const door = doorOf(fx.data, colour);
  if (!workerActionLegal(fx.data, state, visitor, door.id)) {
    throw new Error(`The ${colour} door has nothing legal to do for seat ${visitor}`);
  }

  const wild = meeples.length > 1;
  // ⭐ THE TOLL IS BURNED BEFORE THE ACTING MEEPLE LANDS (R16). It goes to the
  // BOX and never into the slot, so it is a SINK and not a loan: the host
  // collects the acting meeple and nothing else, and the toll is the drain the
  // v1 loop did not have. `pool by round` is the line that says whether the
  // island can keep up with it.
  if (toll.length > 0) {
    for (const m of toll) fx.boxMeeple(visitor, m, 'toll');
    fx.emit({ e: 'visitToll', seat: visitor, host, colour, paid: [...toll], occupants });
  }
  fx.placeMeepleOnBoard(visitor, host, colour, meeples);
  state.turn.bonusUsed.push('visit');
  fireHook(fx, 'afterVisit', { visitor, host, self: false });
  fx.emit({
    e: 'visited',
    seat: visitor,
    host,
    self: false,
    colour,
    action: door.action,
    wild,
    meeples: [...meeples],
  });
  performDoorAction(fx, visitor, colour, 'visit');
}
