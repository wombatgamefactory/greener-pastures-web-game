/**
 * THE BONUS SLOT, THE COMMONS (C1-C10) and Dean's 'spend' variant.
 *
 * ⛔ THESE THREE CANNOT BE SEPARATED and it was measured rather than assumed
 * (tools/map-cycles.py, 12/09/2026): bonus needs `anyCentralHarvestAfterFee`
 * from the commons while the commons needs `bonusOpen` and
 * `noticeBoardPowerLegal` back, and the commons and 'spend' trade five symbols
 * in both directions. Splitting them means real runtime import cycles.
 *
 * Split out of actions.ts on 2026-09-12; the code is unchanged.
 */

import type { Fx } from '../fx.js';
import { fireHook } from '../fx.js';
import {
  canSowOnto,
  canTakeCard,
  cardById,
  commonsBoardCard,
  commonsBoards,
  commonsHarvestMin,
  doorOf,
  drawableSuits,
  hasCentre,
  hostDrewThisRound,
  isFull,
  isHarvestable,
  meeplesHeld,
  noticeBoardOf,
  noticeBoardSlots,
  noticeBoardsOf,
  player,
  unclaimedCentre,
  visitTargetOf,
  workerData,
} from '../query.js';
import type { BonusOption, CardId, GameState, Move, Seat } from '../state.js';
import { markFiredOnTurn } from '../state.js';
import {
  doorActionOf,
  fireNoticeBoardPower,
  meepleActionOf,
  performDoorAction,
} from '../workers.js';
import type { GameData, Suit } from '@gp/data';
import {
  commonsHarvestReachesCentre,
  commonsWildPair,
  hostDrawCapPerRound,
  hostDrawOnVisitAt,
  isCommons,
  isCommonsTakeCoins,
  isCommonsTakePaid,
  isCommonsTakeToHand,
  isCommonsTakeToSpend,
  isMeepleCurrency,
  isNoticeBoardPower,
  meepleSpendDistinctColours,
  meepleSpendPerTurn,
  meepleSpendTiming,
} from '@gp/data';
import { anyBuildOption, divertOrDiscard, paymentsFor, placeBuilt, priceOf } from './build.js';
import {
  deliverDemands,
  finishDelivery,
  matchedAgainst,
  namedDemand,
  spendKey,
  substitutedSpends,
  tallyTotal,
  tileHasRoom,
  wildFills,
} from './deliver.js';
import { doorActionLegal, workerActionLegal } from './doors.js';
import { meepleFills, slotTollOf } from './meeples.js';
import { withoutFirst } from './shared.js';

// --- The bonus slot --------------------------------------------------------

/**
 * EXTRA BONUS OPTIONS granted by card text, on top of
 * `rules.turn.bonusSlotsPerTurn`.
 *
 * Wired at import time by the handler registry, exactly as `wireHookBus` wires
 * the hook bus in fx.ts, and for the same reason: A Helping Hand's v31 text is
 * *"Each turn, you may take both bonus options: Draw 1 AND place a card on a
 * Notice Board"*, so the number of slots is a property of a BUILT CARD - but
 * actions.ts may not import the handler registry (the Helping Hand imports
 * actions.ts for `workerActionLegal`, and a value cycle between the two would be
 * fragile). An indirection, not laziness.
 *
 * Unwired it contributes nothing, so the printed rule stands on its own and
 * every test that never touches a Helping Hand behaves identically.
 */
type ExtraBonusLookup = (data: GameData, state: GameState, seat: Seat) => number;
let extraBonusLookup: ExtraBonusLookup | null = null;

export function wireExtraBonusSlots(lookup: ExtraBonusLookup): void {
  extraBonusLookup = lookup;
}

/** How many bonus options this seat may take this turn: the printed one, plus card text. */
export function bonusSlotsFor(data: GameData, state: GameState, seat: Seat): number {
  return data.rules.turn.bonusSlotsPerTurn + (extraBonusLookup?.(data, state, seat) ?? 0);
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
 * what stops a seat holding a Helping Hand from taking Draw 1 twice: the card
 * grants both options, not two of either.
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
  // ⭐ THE COMMONS IS EXEMPT FROM "ONE OF EACH" (C8, 09/09/2026), and it has to
  // be: its slot holds ONE option, so refusing a second use of it would make A
  // Helping Hand grant a seat nothing at all. Under the commons the rule is "up
  // to `bonusSlotsFor` plays" - two with the card, one without, never three -
  // and the count above is the whole of the bound.
  //
  // ⭐ `commonsTake` CARRIES THE SAME EXEMPTION (Dean's variant, 09/09/2026):
  // under `commonsTake: 'bonus'` the slot holds ONE free option (the take)
  // beside the paid `commons` play, so a seat may play twice, take twice, or
  // one of each with A Helping Hand - never three - on exactly the reasoning
  // above.
  //
  // Keyed on the OPTION and not on the mode, because `'commons'` and
  // `'commonsTake'` are each producible only under their own knob; the
  // two-option slot the controls play keeps the per-option refusal that stops
  // a seat taking Draw 1 twice.
  //
  // ⭐ AND THE NOTICE-BOARD VISIT CARRIES IT TOO (S9, 10/09/2026), for
  // exactly the commons' reason: its slot holds ONE option, the visit, so
  // refusing a second use of it would make A Helping Hand grant a seat nothing
  // at all. What stops the two plays being the same play is not this rule but
  // S9's ONE-USE-PER-BOARD latch in `enumerateNoticeBoardVisits`, which sends
  // the second bonus to a DIFFERENT board. The exemption is keyed on the mode
  // as well as the option, because `'visit'` is producible under three
  // currencies and only this one widens the slot.
  //
  // ⛔ AND SINCE 11/09/2026 BOTH EXEMPTIONS CAN BE LIVE AT ONCE, WHICH IS THE
  // ONE CASE TO REASON ABOUT BEFORE TOUCHING THIS FUNCTION. Under Dean's
  // unclaimed-boards variant a seat may produce a `visit` (onto a rival's
  // board) AND a `commons` play (onto an ownerless one) in the same turn, so
  // for the first time two exempt options share one slot.
  //
  // ⭐ THEY DO NOT ADD UP TO TWO SLOTS, AND THE LINE THAT GUARANTEES IT IS THE
  // COUNT AT THE TOP OF THIS FUNCTION, NOT THE EXEMPTION BELOW.
  // `turn.bonusUsed.length >= bonusSlotsFor(...)` is a count of PLAYS and is
  // blind to which kind each one was: one slot means one play, whichever kind;
  // A Helping Hand means two, of any mix; and there is never a third. The
  // exemption only ever says "a second play may be the same KIND as the first",
  // which is what makes the card grant anything at all. What stops the two
  // plays being the same BOARD is S9's latch, and under the variant that latch
  // is written by `doNoticeBoardVisit` and `doCommons` into the same
  // `turn.firedThisTurn` list, so it spans both halves of the slot.
  // `notice-board-unclaimed.test.ts` asserts all four of those separately.
  if (
    option !== undefined &&
    option !== 'commons' &&
    option !== 'commonsTake' &&
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
      // ⛔ NO MEEPLES AT ALL UNDER THE COMMONS (C6): no starting supply, no
      // island seed, no spend and no Collect. The supply is all zeros there, so
      // this changes no answer - it is here because `settleTurn` holds a turn
      // open while `meepleOptions` is non-empty and "empty by construction" is
      // exactly the claim that stops being true quietly.
      // ⚠️ IT IS INSIDE THIS BRANCH AND NOT ABOVE THE SWITCH, since
      // 12/09/2026. M1 can seed a meeple in ANY game (`tileMeepleSpaces`: a
      // non-null `deliveryMeepleSpace` wins outright), so a currency-shaped
      // refusal at the top would strand a meeple the rules had just handed out.
      // The commons has no meeples only while nothing seeds one, which is the
      // claim this clause is actually making.
      if (isCommons(data)) return false;
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
 * ABSENT under the shipped game and all three named controls, exactly as
 * `PlayerState.coins` is, so no serialised state and no view moves for a rule
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
 * island is the only source, and under M4 the only source is the 3 VP delivery
 * space, so every meeple spent is one fewer action left in the game for anybody.
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
  // ⛔ AND CLOSED UNDER THE COMMONS (C9): the slot holds one option, the
  // commons play, and an unspent slot is a turn that chose not to pay. The
  // number survives here too, unread - there is no Collect under the commons
  // for it to price either.
  if (isCommons(data)) return false;
  // ⛔ AND CLOSED UNDER THE NOTICE-BOARD VISIT (S5, 10/09/2026), which is a
  // PASSENGER THE HANDOFF DID NOT PIN and had to be named rather than
  // inherited. S5 says the bonus action IS the visit, one per turn, optional -
  // the slot holds one option - and the standalone free Draw 1 is one of the
  // three things `'card'` carries that this arm explicitly does not want. It
  // is also the thing that killed v31: the free Draw ate the slot at 67.6%,
  // and leaving it open here would have measured that failure a second time
  // under a different name. The NUMBER survives, unread, exactly as it does
  // under the commons and the meeple loop.
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
  // ⛔ THERE IS NO `visit` MOVE UNDER THE COMMONS (C6/C9). A play onto a
  // central board IS the visit for every card that keys on the word (C8), but
  // it is its own move with no host, so the visit enumerator answers nothing -
  // and it must answer BEFORE the card branch below, which would otherwise ask
  // `noticeBoardOf` for a board that is not in anybody's tableau and throw from
  // inside `legalMoves`.
  if (isCommons(data)) return false;
  if (isMeepleCurrency(data)) return enumerateMeepleVisits(data, state, seat, out);
  // ⛔ AND A CENTRAL BOARD IS NEVER A `visit` TARGET UNDER DEAN'S
  // UNCLAIMED-BOARDS VARIANT (11/09/2026). A play onto an OWNERLESS board is
  // the `commons` move; a `visit` names a HOST SEAT, which is the whole of what
  // the two moves are for - the visit's fee rests on a person's board as
  // material they must harvest (S7, "pay the giver in the same act"), and a
  // central fee is paid to nobody. It falls out of the enumerator below looping
  // `state.players` rather than needing a filter: a board with no owner has no
  // seat index to be `host`, so it cannot be produced here at all.
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
    /**
     * ⭐ THE CENTRAL BOARD THE FEE IS ABOUT TO LAND ON, under Dean's
     * unclaimed-boards variant (11/09/2026). Present only on the `commons`
     * route - a play onto an OWNERLESS board - and never on the `visit` route,
     * where the fee lands on a rival's building instead and no pile moves.
     *
     * ⛔ ONLY THE WHEAT BRANCH READS IT, and it is the same question
     * `commonsHarvestLegalAfterFee` asks under the commons: the fee joins the
     * pile BEFORE the power runs, so a play onto the wheat board can be what
     * takes its own pile to `commonsHarvestMin`. Asking the position as it
     * stands rather than as the fee makes it is how an enumerator and its
     * funnel come to disagree.
     */
    feeOntoCentral?: Suit;
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
      // "Build. You may spend cards of any crops." The waiver is part of the
      // gate, not just of the resolution: a hand that cannot pay the own-suit
      // half can still pay this build, and offering it is the point.
      return anyBuildOption(data, state, seat, hand, numbers.dairyWild ? { substitute: true } : {});
    case 'wheat':
      // "Harvest one of your buildings, then put 1 card from your hand into
      // your barn." EITHER leg makes it live: a building with a card on it
      // (`filter: 'loaded'`, any stack size), or a card left in hand for the
      // barn. That second leg is ruling C88's whole purpose.
      //
      // ⭐ AND A THIRD LEG SINCE 11/09/2026, UNDER DEAN'S UNCLAIMED-BOARDS
      // VARIANT: ANY CENTRAL PILE AT `commonsHarvestMin`. "A Harvest is a
      // Harvest" (D1, reaffirmed that day, and his explicit reason was "to
      // prevent any rules exceptions"), so the Wheat power reaches the centre
      // exactly as the main Harvest action does and under exactly the same
      // minimum. Without this leg the bought Harvest would be the one Harvest
      // in the game that could not take a pile, which is the rules exception
      // the ruling forbids.
      return (
        p.tableau.some((b) => b.stack.length >= 1) ||
        anyCentralHarvestAfterFee(data, state, opts?.feeOntoCentral) ||
        (numbers.wheatBarn > 0 && hand.length > 0)
      );
    case 'apiary':
      // "Sow 2 cards from your hand onto your buildings." A card to sow and
      // somewhere of your OWN to put it (C89) - and never the Notice Board
      // itself (S11), which is why this reads `canSowOnto`.
      return (
        numbers.apiarySows > 0 && hand.length > 0 && p.tableau.some((b) => canSowOnto(data, b))
      );
    case 'vegetable':
      // "Deliver. If you cannot, put 2 cards from your hand into your barn."
      // Island claim or balloon move (DL-12), else the fallback - so it is
      // dead only for a seat that can do neither AND holds nothing.
      return (
        doorActionLegal(data, state, seat, 'deliver') ||
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
 *  - **S9, ONE USE PER BOARD PER TURN.** A Helping Hand's second bonus must go
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
 * farm. What changes is that A Helping Hand's second play finally has somewhere
 * to go at two seats - the rival's other board - where under the control the
 * one legal target was latched by the first play and the card granted nothing.
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
  // Already false under the commons (C6) and under the v31 card game: Collect is
  // the meeple loop's own half of the slot and has no subject in either. One
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

// --- THE COMMONS (C1-C10, 09/09/2026) --------------------------------------

/**
 * C10's TWO FALLBACK KNOBS, both OFF by default, so that if the bonus reads
 * automatic at the table the cap is one number away.
 *
 * `commonsThreshold` (int or null): a board holding at least this many cards
 * refuses further plays. `commonsColourMatch` (boolean): the fee must be a card
 * of the board's own colour.
 *
 * ⭐ THE OTHER TWO COMMONS KNOBS ARE NOT HERE, AND THAT IS THE SEAM RATHER
 * THAN AN OVERSIGHT. `commonsHarvestMin` and `commonsHarvestTake` (Dean,
 * 09/09/2026) ration the HARVEST rather than the play, so they are read where a
 * harvest is decided - `harvestOptions` and `fx.harvest` - through
 * `query.ts`'s two helpers. The only place all four meet is
 * `commonsActionLegal`, because the wheat board buys a Harvest and a board
 * whose action can do nothing is not offered.
 */
interface CommonsKnobs {
  threshold: number | null;
  colourMatch: boolean;
}

function commonsKnobs(data: GameData): CommonsKnobs {
  const { commonsThreshold, commonsColourMatch } = data.rules.economy;
  return { threshold: commonsThreshold, colourMatch: commonsColourMatch };
}

export type CommonsOption = Extract<Move, { type: 'commons' }>;

/**
 * ⭐ CAN THIS BOARD'S ACTION DO ANYTHING, GIVEN THAT THE FEE LANDS FIRST?
 *
 * The order in `doCommons` is load-bearing (C3, and the card visit's own order
 * since v14): the fee leaves the hand and joins the pile BEFORE the action runs.
 * So the gate has to be asked of the position AFTER it lands, or the enumerator
 * and the funnel disagree - which is the exact failure `workerActionLegal`'s
 * warning describes, arriving from a new direction.
 *
 * Two consequences, and both are rules rather than implementation:
 *
 *  - the hand-reading actions (Build and GROW, plus Sow if a roster ever prints
 *    one here) are asked WITHOUT the fee, so a hand of one card can pay the
 *    board or pay the build, never both;
 *  - ⭐ THE WHEAT BOARD CAN NEVER BE DEAD, WHICH IS D6 - AND `commonsHarvestMin`
 *    IS THE ONE KNOB THAT TAKES IT AWAY. Its action is Harvest and every
 *    central pile deep enough to take is a target (C5), so under the shipped
 *    rules the fee that buys the Harvest is itself a legal thing to harvest: a
 *    seat with no full building can still play a card onto the wheat board and
 *    take it, and anything under it, straight into their barn. That is Dean's
 *    "a good turn, not a loop" read literally, and it makes the floor of the
 *    bonus slot "one card from hand to barn" rather than "nothing".
 *
 * ⛔ UNDER `commonsHarvestMin` (Dean, 09/09/2026) THE WHEAT BOARD IS AN
 * ORDINARY BOARD AGAIN. A pile below the minimum refuses a harvest, so the fee
 * only makes its OWN pile harvestable if that pile REACHES the minimum once the
 * fee has landed - which is why the probe below counts the fee onto the board
 * being played and asks the rest of the position as it stands. At n = 3 a play
 * onto an empty wheat board buys a Harvest of nothing, so the board is not
 * offered at all unless some other pile is already deep enough or the seat has
 * a full building of its own. That is a real change of rule, not a tuning, and
 * it is named on the knob's own description.
 */
function commonsActionLegal(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
  fee: CardId,
  /**
   * ⭐ THE WILD PAIR'S SECOND CARD (K3, 10/09/2026). It lands on the pile
   * exactly as `fee` does, so it has to leave the hand for this probe exactly as
   * `fee` does: a hand of two cards can pay a pair OR pay a build, never both.
   * Leaving it in would offer a dairy board the seat cannot then afford to use,
   * which is the enumerator-and-funnel disagreement `workerActionLegal`'s own
   * warning describes, arriving from a third direction.
   */
  fee2?: CardId,
): boolean {
  // ⭐ A CENTRAL BOARD GRANTS THE SAME PRINTED POWER AS AN OWNED ONE UNDER
  // DEAN'S UNCLAIMED-BOARDS VARIANT (ruled 11/09/2026 on his standing
  // principle that there are no rules exceptions). It is the SAME CARD - O3 is
  // O3 whether it sits in an Orchard seat's farm or in the middle of the table
  // - and a card prints what it does, so a central Orchard board is *Draw 4*
  // and not the commons' plain Draw 2, and a central Apiary board is *Sow 2
  // cards from your hand onto your buildings* (S12 as amended by C89) and not
  // the commons' GROW substitution.
  //
  // ⛔ SO THE GATE IS `noticeBoardPowerLegal` AND NOT `doorActionLegal`, and
  // the difference is not cosmetic: three of the five powers are WIDER than
  // the plain action they are named after (the Dairy board waives the crop
  // requirement, the Wheat board harvests at any stack size and banks a card,
  // the Vegetable board has a fallback), so asking the plain door gate would
  // refuse central boards the variant exists to keep alive.
  //
  // ⛔ AND IT RESOLVES THE PASSENGER THE DATA PASS FLAGGED, IN THE DIRECTION
  // THE RULING POINTS. `doorActionForSuit` substitutes
  // `workers.roster.sow.actionUnderCommons` (the Apiary board's GROW, C3 of the
  // commons) only while `isCommons` is true, and under this variant the
  // currency is `'noticeBoardPower'`, so it is FALSE and the Apiary board reads
  // back its printed SOW. That is the CORRECT answer here rather than a bug to
  // fix: the GROW substitution is the commons' own rule for a board that grants
  // a plain door action, and a board that grants a printed power has no door
  // action to substitute. Nothing below reads `doorActionOf` on this path.
  if (unclaimedCentre(data)) {
    return noticeBoardPowerLegal(data, state, seat, board, {
      excludingHandCard: fee,
      feeOntoCentral: board,
    });
  }
  const action = doorActionOf(data, board);
  if (action === 'harvest') return commonsHarvestLegalAfterFee(data, state, seat, board);
  return doorActionLegal(data, state, seat, action, {
    excludingHandCard: fee,
    ...(fee2 === undefined ? {} : { excludingHandCard2: fee2 }),
  });
}

/**
 * Would a Harvest have a target, in the position the fee makes?
 *
 * The one gate in the file that has to look at the position AFTER a card it has
 * not yet played, and it exists because `harvestOptions` cannot be asked the
 * question: the fee is still in the hand when the enumerator runs, and the
 * board being played on is one card shallower than it will be. Counting the fee
 * here rather than mutating a copy of the state keeps the probe cheap enough to
 * run five times per card in hand.
 */
function commonsHarvestLegalAfterFee(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): boolean {
  // The HARVEST question, so `isHarvestable` (10/09/2026); commons-only, where
  // the two predicates are still the same boolean, but the reading has to say
  // which one it meant.
  if (player(state, seat).tableau.some((b) => isHarvestable(data, b))) return true;
  // ⭐ UNDER EVERY `commonsTake` VALUE BUT THE SHIPPED ONE THE WHEAT BOARD IS AN
  // ORDINARY BOARD AGAIN, exactly as under commonsHarvestMin (D6 stops
  // holding): Harvest never reaches the centre (D-S4 under 'bonus', 'spend'
  // and 'paid'; K4 under 'coins'), so the fee just played can never be what
  // makes this Harvest legal. Without a full building of their own, this seat
  // has nothing for the wheat board's action to do. Read through the same
  // helper `harvestOptions` uses, so the gate and the action cannot disagree.
  return anyCentralHarvestAfterFee(data, state, board);
}

/**
 * ⭐ WOULD ANY CENTRAL PILE BE DEEP ENOUGH TO HARVEST ONCE THE FEE HAS LANDED?
 *
 * The tail of `commonsHarvestLegalAfterFee`, lifted out on 11/09/2026 because
 * the Wheat Notice Board's POWER now asks the identical question under Dean's
 * unclaimed-boards variant (`noticeBoardPowerLegal`, case `'wheat'`). One
 * helper rather than two copies of a depth test: the commons already paid once
 * for a gate and its action drifting apart.
 *
 * `feeOnto` is the board the fee is about to join, or undefined when the fee is
 * not going to the centre at all - a visit to a rival's board, or a gate asked
 * about the position as it stands. It counts for ONE card, because a fee is one
 * card; the wild pair (two cards onto one pile) is `commonsWildPair`, which is
 * pinned false under both games that have a centre today, and if it is ever
 * turned on beside a `commonsHarvestMin` above 1 this is the line to widen.
 *
 * Answers false where Harvest cannot reach the centre at all
 * (`commonsHarvestReachesCentre`), so the four `commonsTake` variants read a
 * farm bypass of 0% by construction exactly as `harvestOptions` does.
 */
function anyCentralHarvestAfterFee(data: GameData, state: GameState, feeOnto?: Suit): boolean {
  if (!hasCentre(data) || !commonsHarvestReachesCentre(data)) return false;
  const min = commonsHarvestMin(data);
  const boards = commonsBoards(state);
  // Allocation-free for the reason `centralHarvestTargets` above gives: the
  // bonus enumerator asks this once per (board, card in hand) pair.
  for (const colour of data.cards.suits) {
    const pile = boards[colour];
    if (pile === undefined) continue;
    const depth = pile.length + (colour === feeOnto ? 1 : 0);
    if (depth >= min) return true;
  }
  return false;
}

/**
 * EVERY COMMONS PLAY ON OFFER (C3): one move per (central board, card in hand)
 * whose board's action this seat can legally perform right now.
 *
 * Any card onto any board is the printed rule - the fee is a fee and not a
 * payment in kind - so the list is (5 boards x hand), which is where the bonus
 * slot's whole branching factor now lives. It REPLACES the meeple visit's
 * (rival hosts x 5 colours x wild pairs), so the count should fall rather than
 * rise.
 *
 * ⛔ A BOARD WHOSE ACTION YOU CANNOT PERFORM IS NOT OFFERED, which is Dean's
 * standing ruling and unchanged since the doors were introduced. Under the
 * commons it bites less often than it ever has: the wheat board is always live
 * (see `commonsActionLegal`) and the orchard board is live whenever a deck has a
 * card, so a seat is essentially never locked out of the slot - which matters,
 * because the commons has no free Draw 1 to backstop it (C9).
 */
export function commonsOptions(data: GameData, state: GameState, seat: Seat): CommonsOption[] {
  const out: CommonsOption[] = [];
  enumerateCommons(data, state, seat, out);
  return out;
}

/** Is ANY commons play on offer? The same walk, stopping at the first hit. */
export function anyCommonsOption(data: GameData, state: GameState, seat: Seat): boolean {
  return enumerateCommons(data, state, seat, null);
}

/**
 * The one walk behind both, exactly as `enumerateVisits` is for the visit:
 * `out === null` means "stop at the first legal play". A predicate COPIED out of
 * an enumerator silently stops agreeing with it, and `settleTurn` asks the
 * question after every apply.
 */
function enumerateCommons(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: CommonsOption[] | null,
): boolean {
  // ⭐ TWO GAMES PRODUCE A `commons` MOVE SINCE 11/09/2026. The commons itself
  // (all five piles, C1) and Dean's unclaimed-boards variant, where the piles
  // are the boards of the suits nobody is farming and a play onto a RIVAL's
  // board is the `visit` move instead. One enumerator for both, deliberately:
  // the move's shape, its fee, its slot accounting and its pile are identical,
  // and the manager's ruling of 11/09/2026 was "do NOT invent a third move
  // shape".
  if (!hasCentre(data)) return false;
  if (!bonusOpen(data, state, 'commons')) return false;
  const hand = player(state, seat).hand;
  if (hand.length === 0) return false;
  const boards = commonsBoards(state);
  const knobs = commonsKnobs(data);
  // ⭐ S9's ONE-USE-PER-BOARD LATCH REACHES THE CENTRE (11/09/2026). Under the
  // variant A Helping Hand's second play must go to a DIFFERENT board, and the
  // two halves of the slot - a rival's board and a central one - have to share
  // one latch or a seat could play onto central Wheat and then rival Wheat and
  // take the same power twice.
  //
  // ⛔ THE LATCH IS PER CARD ID, NOT PER SUIT, AND UNDER THIS VARIANT THE TWO
  // ARE THE SAME PARTITION, WHICH IS WHY THE CHOICE IS SAFE. A suit is EITHER
  // one seat's or in the centre and never both: `newGame` refuses duplicate
  // player suits, and `freshCommons` puts exactly the leftovers in the middle.
  // So "central Wheat then rival Wheat" is not a loophole this closes, it is a
  // position that cannot exist - there is no rival Wheat board in a game where
  // Wheat is central. Per card id is kept because that is what
  // `turn.firedThisTurn` already means ("this card's printed text has fired
  // this turn") and a Notice Board's power IS its printed text, whichever side
  // of the table the card is on; a parallel per-suit list would have added a
  // `TurnState` field and moved every fixture in `packages/sim/fixtures/`.
  const latched = unclaimedCentre(data);
  let any = false;
  for (const board of data.cards.suits) {
    // ⭐ AN ABSENT PILE IS A BOARD THAT IS NOT IN THE CENTRE (11/09/2026): some
    // seat is farming that suit, so their board is a building and the way to it
    // is the `visit` move. All five keys are present under the commons, so this
    // skips nothing there and the walk is the one it always was.
    const pile = boards[board];
    if (pile === undefined) continue;
    // C10, off by default: a board at its cap refuses the play outright. It is
    // the one thing in the commons that ever refuses anything, which is why it
    // is a knob and not a rule - C4 says a central board never refuses a play.
    if (knobs.threshold !== null && pile.length >= knobs.threshold) continue;
    if (latched && state.turn.firedThisTurn.includes(commonsBoardCard(data, board))) continue;
    for (const fee of hand) {
      // C10 again: the fee must match the board's colour.
      if (knobs.colourMatch && cardById(data, fee).suit !== board) continue;
      if (!commonsActionLegal(data, state, seat, board, fee)) continue;
      if (out === null) return true;
      out.push({ type: 'commons', seat, board, fee });
      any = true;
    }
    // ⭐ THE WILD PAIR (D5 of the commons pass, left unbuilt on 09/09/2026 by
    // D7, ruled back in by K3 on 10/09/2026): TWO cards of ANY colours pay for
    // one board of any colour, and BOTH land on its pile.
    //
    // ⚠️ ONLY UNDER COLOUR MATCHING, and the guard is a rule rather than an
    // optimisation: with any card already paying for any board there is no
    // colour for a pair to stand in for, so every pair would be a strictly
    // dominated way to pay - two cards out for what one buys - and offering
    // them would multiply the bonus slot's branching by C(hand, 2) for a choice
    // no player would ever make.
    //
    // ⚠️ BRANCHING: C(h, 2) MORE OPTIONS PER BOARD, which at the engine's
    // hand bound of 7 (C7, an instrument bound and not a rule of the game) is 21
    // a board and 105 a turn, well under the build enumerator. Unordered and
    // distinct - `j` starts at `i + 1` - because a pair is a pair whichever card
    // is named first and both go to the same place, so (a, b) and (b, a) are the
    // same move.
    //
    // ⭐ AND THE PAIR IS OFFERED WHEREVER IT IS LEGAL, never only as a last
    // resort. That is the OPPOSITE of the meeple wild pair's rule in
    // `paymentsFor` and `growOptions`, and deliberately so: a meeple pair was
    // strictly dominated by spending the exact colour singly, whereas a seat
    // holding one matching card AND two off-colour cards has a real choice
    // between paying its good card and paying two junk ones (L5, "your junk is
    // their treasure"). Suppressing it would make that decision for the player.
    //
    // ⛔ AND NEVER UNDER DEAN'S UNCLAIMED-BOARDS VARIANT (11/09/2026), which is
    // a fail-closed guard rather than a rule. `commonsWildPair` is pinned false
    // in both of that variant's overlays and means nothing without
    // `commonsColourMatch`, which is pinned false beside it; but the gate this
    // variant's play is asked through - `noticeBoardPowerLegal` - takes ONE
    // `excludingHandCard`, so a pair would be priced with its second card still
    // notionally in hand and could offer a Dairy board the seat cannot then
    // afford to use. Turning the pair on here is therefore a second change and
    // not a knob flip: widen the power gate first.
    if (unclaimedCentre(data)) continue;
    if (!knobs.colourMatch || !commonsWildPair(data)) continue;
    for (let i = 0; i < hand.length; i++) {
      const fee = hand[i] as CardId;
      for (let j = i + 1; j < hand.length; j++) {
        const fee2 = hand[j] as CardId;
        if (!commonsActionLegal(data, state, seat, board, fee, fee2)) continue;
        if (out === null) return true;
        out.push({ type: 'commons', seat, board, fee, fee2 });
        any = true;
      }
    }
  }
  return any;
}

/**
 * ⭐ THE COMMONS PLAY (C3): one card from your hand onto one of the five central
 * Notice Boards, then that board's action, taken by you.
 *
 * ⭐ AND SINCE 11/09/2026 IT IS ALSO DEAN'S UNCLAIMED-BOARDS VARIANT'S PLAY,
 * onto one of the boards of the suits nobody is farming. Same move, same fee,
 * same slot accounting, same pile - what differs is that the board grants its
 * PRINTED POWER rather than the plain door action (see the branch at the foot
 * of this function) and that S9's one-use-per-board latch applies, shared with
 * `doNoticeBoardVisit` through `turn.firedThisTurn`.
 *
 * THE ORDER IS LOAD-BEARING and is the card visit's, unchanged since v14: the
 * fee LANDS first, then `afterVisit` fires, then the action runs.
 *
 *  - the fee first, so a Harvest bought through the wheat board can take the
 *    pile it has just fed (C5) - the one place the order is visible in the rules
 *    rather than only in a hook;
 *  - `afterVisit` before the action, so O16 The Fruit Store and A17 The Smoke
 *    Pot fire off a play with no host at all (C8), which is what `host: null` on
 *    that hook is for. W17 The Pie Shop compares the host to its own seat and
 *    can never match, so it is dead under the commons exactly as C8 says.
 *
 * ⛔ `afterPlacement` IS NOT FIRED (C8). A central board is not a building, so
 * A16 The Beekeeper's Veil does not see a play - `fx.playOnCommons` is a
 * separate primitive from `fx.placeOnBuilding` for that reason alone.
 *
 * ⚠️ AND UNDER DEAN'S UNCLAIMED-BOARDS VARIANT THAT MAKES AN ASYMMETRY WORTH
 * FLAGGING RATHER THAN FIXING (11/09/2026): the same bonus slot fires A16 when
 * the card lands on a RIVAL's board (`doNoticeBoardVisit` places it through
 * `fx.placeOnBuilding`) and does not when it lands on a CENTRAL one. It is the
 * physical truth - a central board is in nobody's tableau and A21 The Wax Hall
 * cannot count it either - and it follows from S16's two rulings rather than
 * contradicting them, but it does mean A16 quietly prefers cross-table plays.
 * That is a CARD reading for Dean and a number for the pass to take, not an
 * engine choice to make here.
 *
 * Every predicate the enumerator checked is re-checked here, because a
 * re-validation must ask what the move NEEDS and never trust the window the
 * caller consumed.
 */
export function doCommons(fx: Fx, seat: Seat, board: Suit, fee: CardId, fee2?: CardId): void {
  const { data, state } = fx;
  // ⭐ TWO GAMES, ONE MOVE (11/09/2026). Under Dean's unclaimed-boards variant
  // a play onto an ownerless board is this same `commons` move; what differs is
  // what it BUYS (the board's printed S12 power rather than the plain door
  // action) and that S9's one-use-per-board latch applies to it.
  const variant = unclaimedCentre(data);
  if (!hasCentre(data)) {
    throw new Error(
      'There is no centre unless rules.turn.visitCurrency is commons, or is ' +
        'noticeBoardPower with rules.economy.unclaimedBoardsToCentre',
    );
  }
  if (!bonusOpen(data, state, 'commons')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  if (!player(state, seat).hand.includes(fee)) {
    throw new Error(`Card ${fee} is not in seat ${seat}'s hand`);
  }
  const knobs = commonsKnobs(data);
  const pile = commonsBoards(state)[board];
  // ⚠️ UNDER THE VARIANT THIS IS ALSO THE "IS THAT BOARD OWNED?" CHECK, and it
  // has to be: a colour with no key in the zone is a colour some SEAT is
  // farming, whose board is a building in their tableau and is reached by the
  // `visit` move instead. A missing key is never an empty pile here.
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  // S9, ONE USE PER BOARD PER TURN, shared with `doNoticeBoardVisit` through
  // `turn.firedThisTurn`. Thrown here and FILTERED in the enumerator, which is
  // this file's standing division of labour.
  const boardCard = commonsBoardCard(data, board);
  if (variant && state.turn.firedThisTurn.includes(boardCard)) {
    throw new Error(`${boardCard} has already been used this turn`);
  }
  if (variant && fee2 !== undefined) {
    throw new Error('There is no wild pair under rules.economy.unclaimedBoardsToCentre');
  }
  if (knobs.threshold !== null && pile.length >= knobs.threshold) {
    throw new Error(`The ${board} board is at its threshold of ${knobs.threshold}`);
  }
  // ⭐ THE WILD PAIR (K3, 10/09/2026): two cards of ANY colours in place of one
  // card of the board's colour, both landing on the pile. Everything the
  // enumerator checked is re-checked here, on the file's standing discipline -
  // a re-validation asks what the move NEEDS and never trusts the window the
  // caller consumed - and the colour gate is the one predicate the pair
  // REPLACES rather than adds to, which is exactly what the pair is.
  if (fee2 !== undefined) {
    if (!knobs.colourMatch || !commonsWildPair(data)) {
      throw new Error(
        'A second fee is a wild pair and needs both commonsColourMatch and commonsWildPair',
      );
    }
    if (fee2 === fee) throw new Error('A wild pair is two DIFFERENT cards');
    if (!player(state, seat).hand.includes(fee2)) {
      throw new Error(`Card ${fee2} is not in seat ${seat}'s hand`);
    }
  } else if (knobs.colourMatch && cardById(data, fee).suit !== board) {
    throw new Error(`The ${board} board takes a ${board} card under commonsColourMatch`);
  }
  if (!commonsActionLegal(data, state, seat, board, fee, fee2)) {
    throw new Error(`The ${board} board has nothing legal to do for seat ${seat}`);
  }

  // ⭐ ONE `commonsPlayed` PER CARD, which is builder's choice and is recorded
  // as one: `fx.playOnCommons` is called twice for a pair, so `pileSize` is
  // right on each event and the count of cards ENTERING the centre is simply
  // the number of `commonsPlayed` events - never a field somebody has to
  // remember to add. That keeps a18's conservation identity (in = discarded by
  // takes + stranded) exact arithmetic rather than a special case, and it keeps
  // the fee-suit mix reading one row per card, which is what the pair is FOR
  // (two junk cards instead of one matching one, L5).
  //
  // ⚠️ IT ALSO MEANS PLAYS PER TURN AND CARDS INTO THE CENTRE STOP BEING THE
  // SAME NUMBER under this arm, exactly as A Helping Hand made plays per turn
  // and the share of turns that used the slot stop being the same number on
  // 09/09/2026 - which cost a re-run. a17 counts TURNS, a18 counts CARDS, and
  // under the pair one bonus can put two cards in.
  fx.playOnCommons(seat, board, fee);
  if (fee2 !== undefined) fx.playOnCommons(seat, board, fee2);
  state.turn.bonusUsed.push('commons');
  fireHook(fx, 'afterVisit', { visitor: seat, host: null, self: false, board });
  if (!variant) {
    performDoorAction(fx, seat, board, 'commons');
    return;
  }
  // ⭐ AND UNDER DEAN'S UNCLAIMED-BOARDS VARIANT THE BOARD GRANTS ITS PRINTED
  // POWER, NOT THE PLAIN DOOR ACTION (manager's ruling, 11/09/2026, on Dean's
  // standing principle of no rules exceptions). O3 is O3 wherever it sits, so a
  // central Orchard board is *Draw 4* and a central Apiary board *Sows 2 from
  // your hand onto your buildings* - never the commons' Draw 2 and never its
  // GROW substitution. This is the line that makes a centre worth what a rival's
  // board is worth, which is the headline risk the overlay names: a central
  // board is SOCIALLY FREE and a rival's is not, so if the two also differed in
  // POWER the comparison would be measuring two things at once.
  //
  // ⛔ THE LATCH IS SET HERE AND NOT INSIDE THE POWER, exactly as
  // `doNoticeBoardVisit` sets it, so both halves of the slot write the same
  // list and A Helping Hand's second play is forced onto a different board.
  markFiredOnTurn(state.turn, boardCard);
  // ⭐ `doorUsed` IS EMITTED HERE RATHER THAN INSIDE THE POWER, on D4's
  // reasoning and word for word as the visit does it: action inflation (a16)
  // and the door mix (a07) count a bought action off one field and must count
  // this exactly as they counted a commons play, so `via` stays `'commons'`.
  // ⚠️ THE ROSTER'S PRINTED ACTION AND NOT `doorActionOf`, for the visit
  // branch's reason and one of this variant's own: `doorActionForSuit`
  // substitutes the Apiary GROW only while `isCommons` is true, which it is not
  // here, so the two agree - and reading it off the override would widen a
  // field typed `WorkerAction` to `DoorAction` for a sixth value this mode can
  // never produce.
  const action = doorOf(data, board).action;
  fx.emit({ e: 'doorUsed', seat, colour: board, action, via: 'commons' });
  fireNoticeBoardPower(fx, seat, board, {
    src: null,
    deliverLegal: doorActionLegal(data, state, seat, 'deliver'),
  });
  fireHook(fx, 'afterWork', { actor: seat, colour: board, action, via: 'commons' });
}

export type CommonsTakeOption = Extract<Move, { type: 'commonsTake' }>;

/**
 * ⭐ DEAN'S VARIANTS' SHARED MOVE (`rules.turn.commonsTake: 'bonus'`, `'spend'`
 * or `'paid'`, 09/09/2026, and `'coins'`, 10/09/2026): every legal
 * `commonsTake` move, one per central pile this seat may legally take right now
 * (or, under `'paid'`, one per (pile, fee card) pair).
 *
 * Never producible under the shipped `'harvest'` rule - `enumerateCommonsTake`
 * checks the knob first, exactly as `enumerateCommons` checks `isCommons`
 * first, so the two enumerators fail closed the same way. Under `'bonus'`
 * every non-empty pile qualifies; under `'spend'` a board also has to have
 * something for its action to do (D-S3), which is `commonsSpendTakeLegal`;
 * under `'paid'` a board qualifies whenever it is non-empty AND the seat has
 * at least one card in hand to pay with (D-P1's other half - see
 * `enumerateCommonsTake`); under `'coins'` (K3/K5) every non-empty pile
 * qualifies and nothing else is asked, because a coin take buys no action.
 */
export function commonsTakeOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
): CommonsTakeOption[] {
  const out: CommonsTakeOption[] = [];
  enumerateCommonsTake(data, state, seat, out);
  return out;
}

/** Is ANY commonsTake on offer? The same walk, stopping at the first hit. */
export function anyCommonsTakeOption(data: GameData, state: GameState, seat: Seat): boolean {
  return enumerateCommonsTake(data, state, seat, null);
}

/**
 * The one walk behind both, exactly as `enumerateCommons` is for the play:
 * `out === null` means "stop at the first legal take".
 *
 * ⭐ UNDER `'paid'` (09/09/2026) THE SHAPE CHANGES: `enumerateCommons` walks
 * (board, fee) pairs because a commons PLAY needs a fee card, and a paid take
 * now needs one too, so this branch walks the same product - one move per
 * non-empty board per card in hand. The fee can never be one of the taken
 * cards: it comes out of the hand, the taken cards come out of the pile, and
 * the two pools never overlap.
 */
function enumerateCommonsTake(
  data: GameData,
  state: GameState,
  seat: Seat,
  out: CommonsTakeOption[] | null,
): boolean {
  const toHand = isCommonsTakeToHand(data);
  const toSpend = isCommonsTakeToSpend(data);
  const toPaid = isCommonsTakePaid(data);
  // ⭐ THE COIN TAKE (K3 second half / K8, Dean 10/09/2026): "discard every card
  // on one central pile and take one coin per card". It needs NO branch of its
  // own down the walk - no fee to choose (unlike 'paid') and no per-board
  // legality to ask (unlike 'spend', whose action has to have something to do,
  // D-S3) - because a coin take buys no action at all. So it is one more term
  // in the fail-closed guard and one more mode the plain loop below serves, and
  // K5's "not offered on an empty pile" is the loop's own existing check.
  const toCoins = isCommonsTakeCoins(data);
  // ⚠️ `isCommons` AND NOT `hasCentre`, DELIBERATELY (11/09/2026). Dean's
  // unclaimed-boards variant pins `commonsTake: 'harvest'` by name, so all four
  // flags above are false there and this would fail closed anyway; the narrow
  // predicate is kept because the four take VARIANTS are rules of the commons
  // and were each ruled against a centre of five ownerless boards. Pairing one
  // of them with a centre of two would be a new design rather than a knob, and
  // it is `hasCentre` here that would make it look like a knob.
  if (!isCommons(data) || (!toHand && !toSpend && !toPaid && !toCoins)) return false;
  if (!bonusOpen(data, state, 'commonsTake')) return false;
  const boards = commonsBoards(state);
  let any = false;
  if (toPaid) {
    const hand = player(state, seat).hand;
    if (hand.length === 0) return false;
    for (const board of data.cards.suits) {
      if ((boards[board]?.length ?? 0) === 0) continue;
      for (const fee of hand) {
        if (out === null) return true;
        out.push({ type: 'commonsTake', seat, board, fee });
        any = true;
      }
    }
    return any;
  }
  for (const board of data.cards.suits) {
    if ((boards[board]?.length ?? 0) === 0) continue;
    if (toSpend && !commonsSpendTakeLegal(data, state, seat, board)) continue;
    if (out === null) return true;
    out.push({ type: 'commonsTake', seat, board });
    any = true;
  }
  return any;
}

/**
 * ⭐ DEAN'S 'spend' VARIANT'S LEGALITY (D-S3, 09/09/2026): "a door that can do
 * nothing is not offered", the standing ruling, read per board. Orchard and
 * wheat are the uncomplicated whole-pile legs and are legal whenever their
 * pile is non-empty (already checked by the caller); dairy, vegetable and
 * apiary each ask whether their action has anything to do.
 */
function commonsSpendTakeLegal(data: GameData, state: GameState, seat: Seat, board: Suit): boolean {
  switch (board) {
    case 'orchard':
    case 'wheat':
      return true;
    case 'dairy':
      return anyCommonsSpendBuildOption(data, state, seat, board);
    case 'vegetable':
      return anyCommonsSpendDeliverOption(data, state, seat, board);
    case 'apiary':
      return player(state, seat).tableau.some((b) => canTakeCard(data, b));
    default:
      return board satisfies never;
  }
}

/**
 * ⭐ DEAN'S VARIANTS' TAKE, DISPATCHED BY commonsTake: take the whole of one
 * central pile. Under `'bonus'` and `'paid'` it always goes straight to hand
 * (`Fx.takeCommons`); under `'spend'` its fate depends on `board` -
 * `doCommonsSpendTake` is where the five legs live; under `'coins'` (K3/K8,
 * 10/09/2026) it goes to the suits' DISCARDS and pays one coin per card, which
 * is the one value where the pile leaves the game rather than reaching anybody.
 *
 * Every predicate the enumerator checked is re-checked here, on the same
 * discipline `doCommons` follows. `fee` is read only under `'paid'`, where it
 * is required; it is ignored (and should be `undefined`, as `legalMoves`
 * never sets it) under the other three.
 */
export function doCommonsTake(fx: Fx, seat: Seat, board: Suit, fee?: CardId): void {
  const { data, state } = fx;
  const toHand = isCommonsTakeToHand(data);
  const toSpend = isCommonsTakeToSpend(data);
  const toPaid = isCommonsTakePaid(data);
  const toCoins = isCommonsTakeCoins(data);
  if (!isCommons(data) || (!toHand && !toSpend && !toPaid && !toCoins)) {
    throw new Error(
      "commonsTake is legal only under rules.turn.commonsTake: 'bonus', 'spend', 'paid' or 'coins'",
    );
  }
  if (!bonusOpen(data, state, 'commonsTake')) {
    throw new Error('The bonus slot is shut: spent, or outside its window for this bonusTiming');
  }
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  if (pile.length === 0) throw new Error(`The ${board} board is empty`);

  if (toCoins) {
    // ⭐ THE MINT (K3/K8, Dean 10/09/2026): NO FEE IS PAID, so `fee` is ignored
    // here exactly as it is under 'bonus' and 'spend' - `legalMoves` never sets
    // it under this value. The pile goes to its cards' OWN suits' discard piles
    // (a pile holds any colours, and the wild pair puts two of any colours on
    // one board) and the taker is paid one coin per card. Marked spent BEFORE
    // the resolution, on the same rule `'spend'` states: the slot goes the
    // moment the board is chosen.
    state.turn.bonusUsed.push('commonsTake');
    fx.clearCommonsForCoins(seat, board);
    return;
  }

  if (toPaid) {
    if (fee === undefined) {
      throw new Error("commonsTake needs a fee card under rules.turn.commonsTake: 'paid'");
    }
    if (!player(state, seat).hand.includes(fee)) {
      throw new Error(`Card ${fee} is not in seat ${seat}'s hand`);
    }
    // ⭐ DEAN'S 'paid' VARIANT (09/09/2026): the fee is discarded FIRST, to its
    // OWN suit's discard pile - "the card you pay goes to the discard pile",
    // never onto the pile it is paying to take and never boxed. Only once it
    // is gone does the pile move, so the fee can never be counted among the
    // cards taken.
    fx.discardFromHand(seat, fee);
    fx.takeCommons(seat, board, fee);
    state.turn.bonusUsed.push('commonsTake');
    return;
  }

  if (toSpend) {
    if (!commonsSpendTakeLegal(data, state, seat, board)) {
      throw new Error(`The ${board} board has nothing legal to take right now`);
    }
    // Marked BEFORE the resolution, exactly as `doCommons` marks `'commons'`
    // before `performDoorAction` pushes its task: the slot is spent the
    // moment the board is chosen, not when its (possibly multi-step)
    // resolution finishes.
    state.turn.bonusUsed.push('commonsTake');
    doCommonsSpendTake(fx, seat, board);
    return;
  }

  fx.takeCommons(seat, board);
  state.turn.bonusUsed.push('commonsTake');
}

// --- Dean's 'spend' variant (09/09/2026, commonsTake: 'spend') -------------
//
// One pile, five fates, dispatched by board (C3's door table): orchard to
// hand, wheat to barn (both uncomplicated whole-pile moves, resolved inline),
// dairy/vegetable/apiary each a multi-step choice resolved through its own
// task. See `CommonsTake` in @gp/data for Dean's words and the four builder
// defaults D-S1 to D-S4.

/** How many cards of each suit sit on a central pile - the payment pool for the dairy and vegetable legs. */
function pileTally(data: GameData, pile: readonly CardId[]): Partial<Record<Suit, number>> {
  const tally: Partial<Record<Suit, number>> = {};
  for (const id of pile) {
    const suit = cardById(data, id).suit;
    tally[suit] = (tally[suit] ?? 0) + 1;
  }
  return tally;
}

function doCommonsSpendTake(fx: Fx, seat: Seat, board: Suit): void {
  switch (board) {
    case 'orchard': {
      const taken = commonsBoards(fx.state)[board]?.length ?? 0;
      fx.takeCommons(seat, board);
      fx.emit({
        e: 'commonsSpent',
        seat,
        board,
        taken,
        used: taken,
        discarded: 0,
        deliveredFromCentre: false,
      });
      return;
    }
    case 'wheat': {
      const taken = commonsBoards(fx.state)[board]?.length ?? 0;
      fx.takeCommonsToBarn(seat, board);
      fx.emit({
        e: 'commonsSpent',
        seat,
        board,
        taken,
        used: taken,
        discarded: 0,
        deliveredFromCentre: false,
      });
      return;
    }
    case 'dairy':
      fx.pushTask({ t: 'commonsSpendBuild', pid: seat, src: null, board });
      return;
    case 'vegetable':
      fx.pushTask({ t: 'commonsSpendDeliver', pid: seat, src: null, board });
      return;
    case 'apiary': {
      const cards = fx.clearCommonsPile(board);
      fx.pushTask({
        t: 'commonsSpendSow',
        pid: seat,
        src: null,
        board,
        cards,
        taken: cards.length,
        used: 0,
        discarded: 0,
      });
      return;
    }
    default:
      board satisfies never;
  }
}

/**
 * ⭐ THE DAIRY LEG'S PAYMENTS (D-S1): every (hand card, pile payment) pair,
 * reusing `paymentsFor` exactly as `paymentOptions` does for D10's revealed
 * deck top - the built card is priced against the pile as its payment pool
 * instead of the hand, with no stacks and no meeples (there are none under
 * the commons, C6), so the default `fills`/`supply`/`place` arguments already
 * say the right thing.
 */
export function commonsSpendBuildOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): { card: CardId; payment: CardId[] }[] {
  const pile = commonsBoards(state)[board];
  if (pile === undefined || pile.length === 0) return [];
  const hand = player(state, seat).hand;
  const out: { card: CardId; payment: CardId[] }[] = [];
  for (const id of hand) {
    const price = priceOf(data, id, {});
    if (!price) continue;
    for (const option of paymentsFor(data, id, pile, [], price)) {
      out.push({ card: option.card, payment: option.payment });
    }
  }
  return out;
}

export function anyCommonsSpendBuildOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): boolean {
  const pile = commonsBoards(state)[board];
  if (pile === undefined || pile.length === 0) return false;
  const hand = player(state, seat).hand;
  return hand.some((id) => {
    const price = priceOf(data, id, {});
    if (!price) return false;
    return paymentsFor(data, id, pile, [], price).length > 0;
  });
}

/**
 * ⭐ THE DAIRY LEG'S RESOLUTION: build ONE card from hand, paid FROM THE PILE
 * ONLY. `payment` is validated against `board`'s pile exactly as `doBuild`
 * validates a hand payment - same cost arithmetic, same own-suit minimum -
 * and then taken out of the pile rather than the hand. Whatever the pile does
 * not use is discarded (D-S2), the payment itself included, on the SAME
 * divert seam a normal build payment uses (so O17's "put a spent card in your
 * barn instead" still fires here).
 */
export function doCommonsSpendBuild(
  fx: Fx,
  seat: Seat,
  board: Suit,
  card: CardId,
  payment: readonly CardId[],
): void {
  const { data, state } = fx;
  const p = player(state, seat);
  if (!p.hand.includes(card)) throw new Error(`${card} is not in seat ${seat}'s hand`);
  const price = priceOf(data, card, {});
  if (!price) throw new Error(`${card} has no build cost`);
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  if (payment.includes(card)) throw new Error(`${card} cannot pay for itself`);
  if (new Set(payment).size !== payment.length) throw new Error('Duplicate payment card');
  for (const id of payment) {
    if (!pile.includes(id)) throw new Error(`${id} is not on the ${board} pile`);
  }
  if (payment.length !== price.cardsNeeded) {
    throw new Error(`${card} costs ${price.cardsNeeded} cards, got ${payment.length}`);
  }
  const suit = cardById(data, card).suit;
  const own = payment.filter((id) => cardById(data, id).suit === suit).length;
  if (own < price.ownSuitMin) {
    throw new Error(`${card} needs ${price.ownSuitMin} ${suit} cards in payment`);
  }

  fx.removeFromHand(seat, card);
  fx.takeFromCommonsPile(board, payment);
  divertOrDiscard(fx, seat, [...payment]);
  const leftover = fx.clearCommonsPile(board);
  fx.discard(leftover);
  // ⛔ `fromHand: false` (A150, 12/09/2026). THIS PAYMENT CAME OFF A CENTRAL
  // PILE AND NEVER OUT OF A HAND, and O17 The Fruit Basket was restricted to a
  // card discarded FROM YOUR HAND on the same day, so it no longer fires here.
  // That is a real behaviour change to this variant and it is the ruling
  // arriving rather than a side effect: the sentence in the docblock above -
  // "so O17's put a spent card in your barn instead still fires here" - is what
  // Dean's O17 ruling withdrew. D5 and D6 are untouched and still reach these
  // cards through `divertOrDiscard` above.
  placeBuilt(fx, seat, card, [...payment], null, false);
  fx.emit({
    e: 'commonsSpent',
    seat,
    board,
    taken: payment.length + leftover.length,
    used: payment.length,
    discarded: leftover.length,
    deliveredFromCentre: false,
  });
}

/**
 * ⭐ THE VEGETABLE LEG'S CRATES (D-S1): every (tile, spend) pair payable out
 * of `board`'s pile, read as a tally exactly as a barn would be - the wild
 * substitution (`substitutedSpends`) and the demand machinery
 * (`deliverDemands`/`namedDemand`) neither know nor care which pool they are
 * reading. There are no meeples under the commons (C6), so this is the plain
 * card arithmetic `deliverOptions` runs before R15 ever joins it.
 */
export function commonsSpendDeliverOptions(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
  /** Stop after this many. `anyCommonsSpendDeliverOption` passes 1. */
  limit: number = Infinity,
): { tile: string; spend: Partial<Record<Suit, number>> }[] {
  const pile = commonsBoards(state)[board];
  if (pile === undefined || pile.length === 0) return [];
  const tally = pileTally(data, pile);
  const demands = deliverDemands(data, state, seat);
  const fillerSuits = [
    ...state.suitsInPlay,
    ...data.cards.suits.filter((x) => !state.suitsInPlay.includes(x)),
  ];
  const out: { tile: string; spend: Partial<Record<Suit, number>> }[] = [];
  const seen = new Set<string>();
  demandLoop: for (const demand of demands) {
    const affordable = (Object.entries(demand.spend) as [Suit, number][]).every(
      ([s, n]) => (tally[s] ?? 0) >= n,
    );
    const spends = affordable
      ? [demand.spend]
      : substitutedSpends(data, fillerSuits, demand.spend, tally);
    for (const spend of spends) {
      const key = spendKey(demand.tile, spend);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tile: demand.tile, spend });
      if (out.length >= limit) break demandLoop;
    }
  }
  return out;
}

export function anyCommonsSpendDeliverOption(
  data: GameData,
  state: GameState,
  seat: Seat,
  board: Suit,
): boolean {
  return commonsSpendDeliverOptions(data, state, seat, board, 1).length > 0;
}

/**
 * ⭐ THE VEGETABLE LEG'S RESOLUTION: deliver ONE crate to `tileId`, paid FROM
 * THE PILE ONLY. Validated against the same wild-substitution arithmetic
 * `doDeliver` uses; the specific cards are then picked off the pile (deepest
 * first is not a rule - any matching cards will do, since barn identity is
 * inert the same way `spendFromBarn`'s is) and discarded, exactly what a barn
 * payment's cards would have done. Scores through the shared `finishDelivery`
 * tail, so a pile-paid crate reads on the board exactly as a barn-paid one
 * does. Unused pile cards are discarded (D-S2); nothing reaches the barn.
 */
export function doCommonsSpendDeliver(
  fx: Fx,
  seat: Seat,
  board: Suit,
  tileId: string,
  spend: Partial<Record<Suit, number>>,
): void {
  const { data, state } = fx;
  const pile = commonsBoards(state)[board];
  if (pile === undefined) throw new Error(`There is no ${board} board in the commons`);
  const tile = state.island.tiles.find((t) => t.tile === tileId);
  if (!tile) throw new Error(`Tile ${tileId} is not in play`);
  if (!tileHasRoom(data, tile)) throw new Error(`Tile ${tileId} has no delivery slots left`);

  const { base, wilds, cardsPerCrate } = namedDemand(data, tile);
  const rate = data.island.cardsPerSubstitution;
  const paid = tallyTotal(spend);
  const legal = wildFills(data.cards.suits, wilds).some((fill) => {
    const need: Partial<Record<Suit, number>> = { ...base };
    for (const s of fill) need[s] = (need[s] ?? 0) + cardsPerCrate;
    const matched = matchedAgainst(need, spend);
    const substituted = tallyTotal(need) - matched;
    if (substituted === 0) return paid === matched;
    if (rate === null) return false;
    return paid - matched === rate * substituted;
  });
  if (!legal) {
    throw new Error(
      rate === null
        ? `Spend does not pay ${tileId}: a crate is ${cardsPerCrate} cards of ONE suit`
        : `Spend does not pay ${tileId}: unmatched cards cost ${rate} of any crop each`,
    );
  }

  const used: CardId[] = [];
  for (const [suit, count] of Object.entries(spend) as [Suit, number][]) {
    let taken = 0;
    for (let i = pile.length - 1; i >= 0 && taken < count; i--) {
      if (cardById(data, pile[i] as CardId).suit === suit) {
        used.push(...pile.splice(i, 1));
        taken += 1;
      }
    }
    if (taken < count) throw new Error(`The ${board} pile has no ${suit} card left to spend`);
  }
  const leftover = fx.clearCommonsPile(board);
  fx.discard(used);
  finishDelivery(fx, seat, tile, tileId, spend, used, 1);
  fx.discard(leftover);
  fx.emit({
    e: 'commonsSpent',
    seat,
    board,
    taken: used.length + leftover.length,
    used: used.length,
    discarded: leftover.length,
    deliveredFromCentre: true,
  });
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
  // ⭐ AND EXACTLY ONE UNDER THE TWO NEWEST DESIGNS. The commons offers the
  // central play alone (C9), and the notice-board visit offers the visit alone
  // (S5) - `bonusDrawOpen` closes under both, and `collectOpen` has no meeples
  // to collect - so the disjunction below is one live term in each.
  return (
    bonusDrawOpen(data, state) ||
    collectOpen(data, state, seat) ||
    anyVisitOption(data, state, seat) ||
    anyCommonsOption(data, state, seat) ||
    anyCommonsTakeOption(data, state, seat)
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
 * so A Helping Hand can send a SECOND visit to the same owner in one turn and
 * they are paid for both - because they also receive two fee cards, and the
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
 * `placeOnBuilding` firing `afterPlacement`, where the commons' `playOnCommons`
 * deliberately did not.
 *
 * ⭐ `doorUsed` IS EMITTED HERE RATHER THAN INSIDE THE POWER, on D4's
 * reasoning: action inflation (a16) and the door mix (a07) count a bought
 * action off one field, and they must count this exactly as they counted a v31
 * visit and a commons play. `via` stays `'visit'`, and the ACTION is the
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
  // ⚠️ THE ROSTER'S PRINTED ACTION AND NOT `doorActionOf`. The two agree
  // under this mode - the Apiary re-read to GROW is the commons' and only the
  // commons' (C3) - but `visited.action` is typed `WorkerAction`, the five-door
  // set, and reading it off the override would widen it to `DoorAction` for a
  // sixth value this mode can never produce.
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
    deliverLegal: doorActionLegal(fx.data, state, visitor, 'deliver'),
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
