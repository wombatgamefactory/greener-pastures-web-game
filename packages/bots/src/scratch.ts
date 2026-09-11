/**
 * The per-decision facts every scoring term wants, derived once.
 *
 * Terms run once per move per decision, so anything that scans the tableau or
 * the island belongs here rather than inside a feature function. The speed
 * budget is 50us per decision (ticket 10) against a mean branching factor of
 * 4-5, and `viewFor` at 31us has already been spent by the driver before a
 * policy is called - so a term that re-derives the island per move is the one
 * thing that could blow it.
 *
 * Everything here reads the VIEW. No GameState, and no engine function that
 * takes one.
 *
 * ## ⛔ THE COIN VALUATION SUBSYSTEM IS GONE (v31, 02/09/2026), AND WHAT IT TAUGHT
 *
 * Three fields and two functions left this file together: `coins`,
 * `coinRunway`, `sinkGap`, `coinNeverDead`, `marketPayability`, and the
 * `coinWorth` / `sinksOf` / `coinsOf` machinery behind them. They were the
 * answer to one question - *what is a coin worth when you may never get to
 * spend it* - and the answer was measured rather than argued, so the reading
 * outlives the rule:
 *
 *   - Nothing in the bot read a seat's balance at all before ticket 40, so a
 *     visit scored a flat 6 at GBP 0 and at GBP 65. Ticket 37 measured **73.3%
 *     of visits taking the coin payoff, 50.9% of those by a seat already
 *     holding GBP 10 or more, and 65.4% of every coin minted never spent on
 *     anything.** The money was being made and then abandoned.
 *   - Pricing a coin by the seat's remaining RUNWAY - the bounded, once-only
 *     things it could still buy from here - fixed that, and exposed a second
 *     fault under it: at `visit: 2` the bots were taking coin visits whose
 *     marginal coin they valued at provably zero in **70.4%** of cases, because
 *     a free slot plus a junk fee still beat leaving the slot unused.
 *   - The standing conclusion, and the reason v31 deleted the currency rather
 *     than re-tuning it: **money is what buys SOLITAIRE in this game.** A visit
 *     was bought with a card and every other bonus option was bought with a
 *     coin, so a coin sink in the bonus slot crowded the visit out all game.
 *
 * ⚠️ THE SAME TRAP IS NOW SET FOR MEEPLES, one shape further on, which is why
 * `meepleWorth` below is an adaptation of `coinWorth` rather than a fresh idea.
 * A meeple is a stored ACTION, it scores nothing at game end, and a meeple
 * whose action this seat can never use is worth exactly zero - the dead coin,
 * in wood. The number the plan asks the sim to watch (`meepleGained` minus
 * `meepleSpent`) is 65.4% wearing a different hat, and a bot that cannot price
 * a meeple will produce it whatever the rules do.
 */

import type { Card, GameData, Suit, WorkerAction } from '@gp/data';
import type { BuildingView, CardId, PlayerView } from '@gp/engine';
import {
  deliveriesPerTile,
  doorForSuit,
  isMeepleAsCard,
  isMeepleCurrency,
  isNoticeBoardPower,
  noticeBoardBlocks,
} from '@gp/data';

import { magpieTarget } from './magpie.js';

/**
 * Card lookup by id, indexed per GameData.
 *
 * The engine's `cardById` is a linear scan of the 105-card catalogue, which is
 * the right shape for a rules engine that reads a handful of cards per apply.
 * A policy reads one card per card id per scoring term per move - measured at
 * 30-54us a decision against a 50us budget - and the scan was all of it. Keyed
 * on the data object so an overlay run gets its own index and both are
 * collected with the data they describe.
 */
const CARD_INDEX = new WeakMap<GameData, Map<CardId, Card>>();

export function cardIndex(data: GameData): ReadonlyMap<CardId, Card> {
  let index = CARD_INDEX.get(data);
  if (!index) {
    index = new Map(data.cards.catalogue.map((card) => [card.id, card]));
    CARD_INDEX.set(data, index);
  }
  return index;
}

/** Same contract as the engine's `cardById`, including throwing on an unknown id. */
export function cardById(data: GameData, id: CardId): Card {
  const card = cardIndex(data).get(id);
  if (!card) throw new Error(`Unknown card id ${id}`);
  return card;
}

/**
 * A building's printed threshold, or null when it is not a building.
 *
 * This replaces `faceOfView`, which picked between a card's two printed faces.
 * Starters are single-faced since v31, so the pick is a plain card lookup and
 * the CardFace type has left the data package entirely.
 */
/**
 * A building's threshold as the VIEW can see it - and, under the meeple-loop
 * arm, the one place the bots learn that the NOTICE BOARD IS NO LONGER A
 * BUILDING (R5).
 *
 * ⭐ IT MIRRORS THE ENGINE'S `thresholdOf` SEAM ON PURPOSE. The engine turns the
 * board into a card with five slots by returning null here, which drops it out
 * of `isFull`, `canTakeCard` and `roomOn` all at once; this file has its own
 * copy of that read, so without the same null the bots would carry a model of
 * the game the engine does not share. The one place it bites is `doorReady`'s
 * SOW branch - an empty Notice Board with a printed threshold of 2 looks like a
 * legal sow target to the view and is refused by the engine - which would
 * over-value an orange meeple in exactly the positions where the Apiary door is
 * dead, and `meepleWorth` is the hoarding dial's own input.
 *
 * ⭐ **IT NOW COPIES THE ENGINE'S `economy.noticeBoardThreshold` OVERRIDE, AND
 * THAT IS A FIX RATHER THAN AN ADDITION (11/09/2026).** The note that stood
 * here until today said the override was deliberately not copied, because under
 * the `'card'` game the knob and the print both read 2 so the two agreed - and
 * it named the day this would bite: *"if that knob is ever moved off the printed
 * value again, this is the line that will silently disagree with the engine and
 * it should be fixed here rather than worked around at a call site."* The
 * notice-board visit is that day. S8 sets the override to **3** while the v33
 * sheet still prints 2, so without this the bots would have believed a board
 * fills one card early - and `clogOwnBoard`, the largest cost in the table at 6,
 * reads exactly that boolean under the `-blocking-v1` control.
 *
 * ⛔ **AND IT MOVES NO CONTROL.** `overlays/v31-card-visit.overlay.json` pins
 * the override to 2, which is the printed value, so the v31 game reads the same
 * number by both routes; the meeple arm returns null one line above; and under
 * the commons no Notice Board is dealt into a tableau at all, so nothing here
 * is ever asked about one.
 */
export function thresholdOfView(data: GameData, building: BuildingView): number | null {
  const card = cardById(data, building.card);
  if (isMeepleCurrency(data) && card.slot === 'noticeboard') return null;
  if (card.threshold === null) return null;
  const override = data.rules.economy.noticeBoardThreshold;
  if (override === null || card.slot !== 'noticeboard') return card.threshold;
  return override;
}

/**
 * The crop a building prints - the view's copy of the engine's `cropOf`. A
 * starter prints the generic starting-building icon and belongs to no crop,
 * which is the rule the Farmstead's own scorer reads (deck cards only, so a
 * seat cannot collect a flat 3 for turning up).
 */
export function cropOfView(data: GameData, building: BuildingView): Suit | null {
  const card = cardById(data, building.card);
  return card.type === 'starter' ? null : card.suit;
}

/**
 * What a meeple whose door can do NOTHING for this seat right now is worth,
 * against 1 for one it can use immediately.
 *
 * ⚠️ **THE LEAST defensible NUMBER IN THIS FILE, AND IT IS STATED RATHER THAN
 * BURIED.** It is not zero, because a meeple is spent on a FUTURE turn and
 * almost every door that is dead now (no full building to harvest, nothing the
 * barn can pay for) comes back within a turn or two. It is not 1, because a
 * seat that will plainly never use a colour - the Harvest door with no
 * buildings, the Deliver door with an empty barn and a game about to end -
 * should prefer a colour it can. There is no measurement behind 0.4: it is a
 * guess that says "usually usable later, but worth less than one I can use
 * now", and it is the first thing to sweep if the meeple assertion reads oddly.
 */
export const MEEPLE_LATENT = 0.4;

/**
 * ⭐ **WHAT A MEEPLE IS WORTH UNDER R15 WHEN ITS DOOR CAN DO NOTHING: A CARD**,
 * because under R15 that is literally what it is (`rules.turn.meepleAsCard`,
 * Dean 04/09/2026 evening, handoff v2).
 *
 * `MEEPLE_LATENT` above prices a meeple as a STORED ACTION and nothing else,
 * which is the whole of what a meeple was under v1 - and it is why Dean called
 * it a coupon rather than a cost: a colour whose door was dead was worth 0.4 of
 * an action and could be burnt for nothing. R15 gives that same meeple a second
 * use that never goes dead: it pays a build cost, a Grow's activation and an
 * island crate, as a card of its colour. So the FLOOR is no longer the discount
 * on a door that might come back. It is a card.
 *
 * ⚠️ **1 IS "ONE CARD" ONLY BECAUSE `handSpend` AND `meepleGain` ARE BOTH 2.5,
 * AND THAT IS A CALIBRATION, NOT AN IDENTITY.** These worths are in ACTION
 * UNITS, converted to points by `meepleGain` / `meepleSpend`; a card is priced
 * by `handSpend`. The two weights were pinned to each other on purpose (see
 * `weights.ts`, *"the two routes to a door are a card and a meeple"*), so 1
 * action unit and one card are the same 2.5 points today. **If either weight is
 * ever swept, this number has to be re-derived as `handSpend / meepleGain` or
 * the floor silently stops being a card.** It cannot be computed here: a
 * `Scratch` is built without a weight table, deliberately, so that a feature
 * can never read a weight.
 *
 * ⚠️ **SET BY ARGUMENT AND NOT BY MEASUREMENT**, exactly as `MEEPLE_LATENT`
 * and `meepleGain` are, and NOT overlay-addressable - it is a constant in this
 * file, so a sweep of it is an edit and a rebuild. It is the second number the
 * R15 arm rests on, after `meepleGain` itself.
 */
export const MEEPLE_AS_CARD_FLOOR = 1;

/**
 * ⭐ **THE EXTRA A LIVE DOOR IS WORTH ON TOP OF THE CARD FLOOR, AND IT SHIPS AT
 * ZERO. IT IS THE MOST CONSEQUENTIAL NUMBER THIS PACKAGE ADDED FOR R15 AND IT
 * IS THE ONE DEAN MOST NEEDS TO SEE.**
 *
 * The question it answers: under R15 a meeple has TWO uses - a door through a
 * neighbour's board, and a card of its colour - so what is one worth?
 *
 *   - **Zero premium (shipped).** A meeple can only be spent ONCE, so its worth
 *     is the BETTER of its two uses and not their sum. The door use is 1 when
 *     live and `MEEPLE_LATENT` when dead; the card use is `MEEPLE_AS_CARD_FLOOR`
 *     and never goes dead. `max` of those is the floor in both cases, so every
 *     meeple prices flat at one card.
 *   - **The argued alternative, `1 - MEEPLE_LATENT` (0.6).** Holding a meeple
 *     whose door is live gives you a CHOICE where a dead one gives you one
 *     option, and optionality under uncertainty is worth something real. 0.6 is
 *     the daylight v1 already had between a live door and a dead one, carried up
 *     with the floor.
 *
 * ⭐ **ZERO WINS ON THE PAIRED-ARM RULE, NOT ON THE ECONOMICS, AND THE
 * DISTINCTION MATTERS.** A plain visit always spends a meeple whose door is
 * LEGAL - the engine refuses an illegal one - so this premium is a tax on every
 * visit in the arm and on none in the control. At 0.6 the acting meeple prices
 * at 1.6 rather than 1.0 and a visit's reserve price goes 2.5 to 4.0 points,
 * which is a 60% repricing of the exact quantity the arm exists to read. The
 * standing rule in `weights.ts` is that a weight moved in the same pass as a
 * rule makes every delta a mixture of the two, and 0.6 would do precisely that.
 * At 0, the visit costs the same 2.5 under the control and under the arm, and
 * any hook movement is the RULE - meeples being eaten by builds, so fewer exist
 * to visit with - rather than the instrument.
 *
 * ⚠️ **IT IS NOT A SMALL EFFECT AND IT IS MEASURED, NOT ASSUMED.** Paired on 12
 * games (2/3/4 seats, `overlays/meeple-as-card-v1.overlay.json`, identical
 * seeds), the ONLY change being this constant:
 *
 *     premium 0.6    45 visits   46 build / 138 activation / 28 delivery spends
 *     premium 0     125 visits   62 build / 102 activation / 52 delivery spends
 *
 * **The instrument's opinion about a live meeple moves the arm's headline hook
 * number by 2.8x.** Neither reading is measured truth: `meepleGain` 2.5 and
 * `MEEPLE_LATENT` 0.4 were already set by argument, this is a third number of
 * the same kind, and n=12 is a smoke sample rather than a result. **Sweep this
 * beside `meepleGain` before quoting any hook number off the R15 arm.**
 *
 * ⚠️ What zero gives up, stated so it is not rediscovered as a bug: **the bots
 * are colour-blind about which meeple to burn.** R15 asks a real question -
 * which colour goes, because a colour given up is a door you cannot buy next
 * turn - and at a flat worth the bot has no preference and will spend a live
 * colour as readily as a dead one. If the arm's door mix looks like noise, this
 * is why, and 0.6 is the arm that answers it.
 *
 * ⚠️ Set by ARGUMENT and not by measurement, and NOT overlay-addressable.
 */
export const MEEPLE_AS_CARD_DOOR_PREMIUM = 0;

/**
 * What a meeple whose door IS live is worth under R15. Derived, so the two
 * arms above are one edit apart and can never drift out of step with each other.
 */
export const MEEPLE_AS_CARD_LIVE = MEEPLE_AS_CARD_FLOOR + MEEPLE_AS_CARD_DOOR_PREMIUM;

export interface Scratch {
  readonly data: GameData;
  readonly view: PlayerView;
  readonly mySuit: Suit;
  /**
   * ⭐ WHICH GAME IS THIS - the meeple-loop arm, or the shipped `'card'`
   * control? (`rules.turn.visitCurrency`, Dean 04/09/2026.)
   *
   * Derived once and read by every arm-gated term, so that "am I under the arm"
   * has exactly ONE spelling in this package. The alternative - each term
   * asking the data itself - is how a gate gets missed, and a missed gate here
   * does not throw or fail a type check: it silently moves the CONTROL, which is
   * the one thing the whole paired-arm method depends on not happening.
   *
   * ⚠️ MOST TERMS SHOULD NOT READ IT. A term that can gate on the ACT (a null
   * `fee`, an empty `meeples`, a `collect`) should, because that gate is the
   * rule's own shape and cannot drift from it. This flag is for the terms whose
   * subject disappears entirely under the arm rather than changing form.
   */
  readonly meepleArm: boolean;
  /**
   * ⭐ IS THIS THE NOTICE-BOARD VISIT (`rules.turn.visitCurrency:
   * 'noticeBoardPower'`, Dean 10/09/2026)? The twin of `meepleArm` above, and
   * it exists for the same reason: "am I under this arm" gets exactly ONE
   * spelling in this package, because a missed gate does not throw or fail a
   * type check, it silently moves a CONTROL.
   *
   * Read by `hostGift` and, since 11/09/2026, by `visitFeeOwnCrop` - and by
   * nothing else. Every other term this arm touches can gate on the ACT's own
   * shape - a `visit` with a non-null `fee`, a `self` flag - and should, because
   * that gate is the rule's shape and cannot drift from it.
   *
   * ⭐ **WHY `visitFeeOwnCrop` NEEDS IT AND COULD NOT GATE ON THE ACT (Dean's
   * unclaimed-boards variant, 11/09/2026).** Under that variant a play onto a
   * CENTRAL board is a `commons` act, which is the same act the SHIPPED COMMONS
   * produces - so the act's own shape cannot tell the arm from the control, and
   * the magpie's disposal lane has to be open in one and shut in the other. That
   * is exactly the case this flag was written for: a subject that appears under
   * the arm and must not appear under a control.
   */
  readonly noticeBoardArm: boolean;
  /**
   * ⭐ **CAN AN OWNED NOTICE BOARD EVER CLOG IN THIS GAME (S8, Dean
   * 10/09/2026)?** One boolean because two terms ask exactly this question and
   * they are pinned to each other at 6, the largest cost in the table:
   * `clogOwnBoard` charges for shutting your own door and `unclogBoard` pays for
   * reopening it.
   *
   * ⛔ **AND A THIRD READER SINCE 11/09/2026, WHICH IS WHY ONE SPELLING WAS
   * WORTH HAVING**: `outcome.ts`'s `harvested` case pays the SAME `unclogBoard`
   * weight for an owner's harvest reached inside a rollout, and it was missed
   * when the arm was built because it reads the weight directly rather than
   * through `TERMS`. A Harvest bought through the Wheat board's power that took
   * the seat's own Notice Board was paying 6 for reopening a door that cannot
   * shut. It now asks this boolean too.
   *
   * ⛔ **THE `3+` RULE MAKES BOTH SUBJECTLESS.** Three is the MINIMUM before
   * the owner may harvest and never a maximum load, so a board takes cards for
   * ever, no owner can shut a board by declining to harvest, and there is no
   * door to reopen. Left unguarded, a 6-point cost would have fired on the
   * self-visit that filled a board to three - the exact move the arm's headline
   * reading counts - and a 6-point reward would have manufactured the owner's
   * harvest that a20, the stall reading, exists to measure. Either one is the
   * instrument answering the design's own question.
   *
   * True everywhere else, which is what keeps the controls still: under the v31
   * `'card'` game the board is an ordinary clogging building, and under the
   * `-blocking-v1` sub-arm (`rules.economy.noticeBoardBlocks: true`) it is one
   * again, which is precisely the stall being measured against `3+`.
   */
  readonly noticeBoardClogs: boolean;
  /**
   * The magpie's mark: the strongest SEATED crop that is not `mySuit` (see
   * `magpie.ts`). Derived for every profile because it costs one array scan,
   * and read only by the `*TargetCrop` terms - which every profile but `magpie`
   * weights at 0, so nothing else changes behaviour because of it.
   */
  readonly targetSuit: Suit | null;
  /**
   * ⭐ THE HAND LIMIT, one global number off `rules.turn.handLimit`, or null when
   * the rule is switched off. Restored 02/09/2026 with the rule itself.
   *
   * It is read from the data rather than off the seat's Barn, and that is the
   * whole shape of the reinstated rule: the limit is the same for everybody and
   * the Barn prints nothing. A per-seat limit would change only this line.
   */
  readonly handLimit: number | null;
  /**
   * Cards this seat could still draw before the end-of-turn discard bites, and
   * `Infinity` when there is no limit.
   *
   * ⚠️ THIS IS THE DIMINISHING RETURN ON DRAWING, and its absence is half of why
   * the limit came back. With no ceiling a card in hand is always worth a card,
   * so the free bonus Draw 1 is never a worse move than it was last turn - and
   * in the v31 run it became strictly dominant and beat a neighbour visit 3:1,
   * which is the hook losing to arithmetic. Every draw-valuing term reads this.
   */
  readonly handRoom: number;
  readonly buildings: ReadonlyMap<CardId, BuildingView>;
  /**
   * THIS SEAT'S OWN SUIT'S NOTICE BOARD, or null in a game that deals none.
   *
   * ⛔ **"OWN SUIT'S" RATHER THAN "THE ONE IN THE TABLEAU" SINCE DEAN'S
   * TWO-BOARD FIX (11/09/2026)**, which is the engine's `noticeBoardOf` seam
   * arriving here. Those were the same building in every game until that
   * ruling; at TWO seats a tableau holds two boards - the seat's own suit's,
   * laid out with the starters, and one drawn at random from the unfarmed suits
   * and pushed on after - and the scan that used to fill this field kept the
   * LAST match, so a wheat seat's `noticeBoard` read **A3 rather than W3**.
   * Measured, not deduced: that is what the field held before this pass.
   *
   * ⚠️ **EVERY READER THAT MEANT "ANY BOARD OF MINE" MUST ASK
   * `noticeBoards` BELOW**, and all of them now do - the `cardPlaced`
   * exclusion in `outcome.ts`, its `harvested` unclog leg, and the
   * `unclogBoard` term. This one is right for a caller that means the board
   * whose POWER is this seat's own suit's, and for nothing else.
   */
  readonly noticeBoard: BuildingView | null;
  /**
   * ⭐ **EVERY NOTICE BOARD IN THIS SEAT'S OWN TABLEAU, by card id** - the
   * view-side twin of the engine's `noticeBoardsOf` (Dean's two-board fix,
   * 11/09/2026), and the field a term wants whenever the question is about
   * BOARDS rather than about which power a seat prints.
   *
   * ⛔ **IT CANNOT SIMPLY CALL THE ENGINE'S.** `noticeBoardsOf` takes a
   * `GameState` and this package deliberately never sees one (see `index.ts` -
   * a policy gets a `PlayerView` and a `Prober`), which is exactly the problem
   * `centralPileSuitOfView` in `terms.ts` solved for central piles on the same
   * day. So it is mirrored here off the one authority the view carries, the
   * seat's own tableau, in tableau order.
   *
   * A SET rather than an array because every reader asks the same question -
   * "is this building one of mine?" - and none of them cares which.
   *
   * ⚠️ **ONE ENTRY IN EVERY GAME BUT THE TWO-SEAT ARM**, and EMPTY
   * under the commons, where no Notice Board is dealt into a tableau at all
   * (C1). So a reader that swapped an `=== s.noticeBoard.card` test for
   * `s.noticeBoards.has(...)` answers identically everywhere the old test was
   * right, which is what keeps all three controls still.
   */
  readonly noticeBoards: ReadonlySet<CardId>;
  /**
   * The crop this seat's FARMSTEAD prints, or null if it somehow has none.
   *
   * ⭐ v31: the Farmstead is an end-game scorer - *"1 VP for each CROP card you
   * have built"* - so this is the crop every build decision has to be measured
   * against. It is read off the card rather than off `mySuit` because printing
   * is the thing the card does: the two cannot differ today (a Farmstead is a
   * starter, so it is only ever in front of the seat that plays its suit) and
   * keying off the card is what keeps that a fact rather than an assumption.
   */
  readonly farmsteadCrop: Suit | null;
  /**
   * Suits a tile with a free receipt space still wants. Wild crates count for
   * every suit in play.
   *
   * It used to be filtered by the per-player level gate, and ticket 53 measured
   * that filter rather than arguing it: gated and ungated were different sets in
   * 32.6% of the decisions offering a deck choice, and 72.4% before the seat held
   * any receipt, yet over 55 stratified games the distinction changed the bot's
   * top move 0 times in 12,208 decisions. The flat island (2026-08-09) deleted
   * the gate, so this is now simply the ungated set - and that measurement is why
   * the deletion could not have moved these terms.
   */
  readonly demandSuits: ReadonlySet<Suit>;
  /**
   * WHAT ONE MEEPLE OF EACH COLOUR IS WORTH TO THIS SEAT, in ACTION UNITS: 1
   * for a door this seat could use right now, `MEEPLE_LATENT` for one it could
   * not, 0 for a colour with no door at all (unreachable in shipped data).
   *
   * ## Why the scale is flat across the five colours
   *
   * Every door grants exactly ONE core action - that is the v31 design's own
   * claim about the bonus slot, *"a door now buys a WHOLE CORE ACTION for one
   * card"* - so the honest base is the same for all five, and the only thing
   * separating them is whether this seat can use it. Inventing a per-action
   * value table here would have been the ticket 40 sin in its purest form: the
   * plan asks the sim to measure the DOOR MIX, and a bot told in advance that a
   * Draw door beats a Sow door would hand that answer back as a measurement.
   *
   * What the flat scale gives up is real and is named here so nobody rediscovers
   * it as a bug: the Orchard door is Draw 3 and the Apiary door is Sow 1 from
   * hand, and the plan says outright that the second is the weakest door on the
   * table. This model cannot see that difference. It sees only that both are
   * usable. If the door mix comes out suspiciously even, suspect this before
   * suspecting the doors.
   *
   * Read through `meepleWorth`, never directly, so the fallback lives in one
   * place.
   */
  readonly meepleWorth: ReadonlyMap<Suit, number>;
  /**
   * ⭐ THE MEEPLES A COLLECT WOULD ACTUALLY KEEP - the meeple-loop arm's other
   * bonus option, priced after the supply cap has taken its cut (R4, R7).
   *
   * Empty under the `'card'` game, which has no Collect, and empty under the arm
   * whenever the seat's own board is empty - which is the case that matters
   * most, because an empty-board Collect IS the free Draw 1 and is the solitaire
   * line the bonus mix is watching.
   *
   * ⭐ **THE CAP IS THE WHOLE SUBTLETY, AND IT IS WHY THIS IS A LIST AND NOT A
   * COUNT.** You may never hold two meeples of a colour, so collecting a board
   * holding a colour you already hold gains you *nothing but the draw*: that
   * meeple goes to the box. A bot that priced a Collect by how many meeples sat
   * on its board would over-rate exactly the position the cap exists to punish -
   * a full board and a full supply - and would report the cap as harmless.
   *
   * It replays `Fx.collectBoard` rather than approximating it: colours in
   * `data.cards.suits` order, running the supply up as it goes, so a wild pair
   * of two DIFFERENT colours sitting in one slot is resolved the same way the
   * engine resolves it. (Two meeples of the SAME colour in one slot cannot
   * happen - a wild pair is two different colours by rule, and the cap keeps a
   * supply from ever holding two - but the running count would handle it
   * correctly if it ever did.)
   */
  readonly collectKeeps: readonly Suit[];
}

/**
 * What ONE more meeple of `colour` is worth to this seat, and equally what one
 * leaving costs it - the direct descendant of `coinWorth`, and the same idea:
 * a stored resource is worth what this seat can still turn it into, and nothing
 * at all above that.
 *
 * The two callers are deliberately symmetrical. `meepleGain` credits this when
 * a delivery hands a meeple over; `meepleSpend` charges exactly the same number
 * when one is spent, so a meeple is neither created nor destroyed by the bot's
 * own accounting and the decision to spend one turns entirely on whether the
 * rolled-out action beats the stock. That is the property that keeps the
 * hoarding question honest: raise this and the bots hoard, lower it and they
 * dump, and neither is hidden inside a term.
 */
export function meepleWorth(s: Scratch, colour: Suit): number {
  // The fallback is unreachable: the map is built over `data.cards.suits` and
  // every colour in the game is one of them. It is deliberately NOT lifted to
  // the R15 floor, because a colour that is not a suit is not a card either.
  return s.meepleWorth.get(colour) ?? MEEPLE_LATENT;
}

/**
 * How many of `n` cards leaving this hand actually COST the seat anything.
 *
 * The standing half first, because it decides most cases and a refactor would
 * lose it: a card in hand is not junk waiting to be dumped, it is fuel. It can
 * be built, it can pay a GROW and fire an ability, it can pay a visit. The
 * design says so outright - *"cards are the scarce resource and the master
 * clock"* - and with the currency gone a card is the ONLY thing anything in this
 * game is bought with, so the claim is stronger than when it was written.
 *
 * ⭐ THE HAND-LIMIT EXEMPTION IS BACK WITH THE HAND LIMIT (02/09/2026), and it
 * is Dean's ruling and the whole subtlety: **a card you are over your hand limit
 * with is free**, because the end-of-turn discard is going to take it anyway.
 * Cards above the limit are spent first and cost nothing; only what a seat would
 * otherwise have KEPT is charged. v31 deleted the limit and this exemption went
 * with it, which quietly made every visit fee cost full price at any hand size -
 * so a seat drowning in cards priced a visit exactly as dearly as a seat holding
 * three, and the bots hoarded.
 *
 * The FORCED end-of-turn discard is deliberately not run through here. There is
 * no choice at that seam, so there is nothing to price - `discardJunk` only
 * picks which cards go.
 */
export function handSpendCost(s: Scratch, n: number): number {
  if (n <= 0) return 0;
  const limit = s.handLimit;
  const excess = limit === null ? 0 : Math.max(0, s.view.you.hand.length - limit);
  return Math.max(0, n - excess);
}

function starterSlotOf(card: Card): string | null {
  return card.slot ?? null;
}

/**
 * Can this barn tally pay for this tile? The engine's `anyDeliverOption`
 * arithmetic, re-stated over the view: named crates covered outright, then
 * every crate-sized block of surplus in one suit covers one wild. Demand
 * tokens are dealt from in-play suits only, so one pass over `suits` both
 * checks coverage and counts wild capacity.
 */
function tallyPays(
  suits: readonly Suit[],
  tally: Partial<Record<Suit, number>>,
  base: Partial<Record<Suit, number>>,
  wilds: number,
  per: number,
): boolean {
  let wildCapacity = 0;
  for (const suit of suits) {
    const surplus = (tally[suit] ?? 0) - (base[suit] ?? 0);
    if (surplus < 0) return false;
    wildCapacity += Math.floor(surplus / per);
  }
  return wildCapacity >= wilds;
}

/**
 * A tile's demand, over the view: named crates as cards, plus a count of the
 * crates that will take anything.
 *
 * THE FACE-DOWN TOKENS BELONG HERE (the Vegetable rebuild, 2026-08-09). V6 turns
 * a demand token blank and a blank token accepts any crops at the normal rate,
 * which is exactly what a cornucopia does - so both must count as wild capacity
 * or the bots would keep reading a tile as unpayable after somebody opened it.
 * Mirrors the engine's `namedDemand`, and both readers below go through it so
 * the two cannot learn the rule separately.
 */
function demandOf(
  tile: { crates: readonly (Suit | 'wild')[]; faceDown?: readonly boolean[] },
  per: number,
): { base: Partial<Record<Suit, number>>; wilds: number } {
  const base: Partial<Record<Suit, number>> = {};
  let wilds = 0;
  for (const [i, crate] of tile.crates.entries()) {
    if (crate === 'wild' || tile.faceDown?.[i] === true) wilds += 1;
    else base[crate] = (base[crate] ?? 0) + per;
  }
  return { base, wilds };
}

/** Could this seat pay for ANY tile with a free receipt space, out of its barn? */
function canDeliverNow(data: GameData, view: PlayerView): boolean {
  const per = data.island.tileRule.cardsPerCrate;
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= deliveriesPerTile(data)) continue;
    const { base, wilds } = demandOf(tile, per);
    if (tallyPays(view.suitsInPlay, view.you.barn, base, wilds, per)) return true;
  }
  return false;
}

/** Two differing barn suits and a balloon that is not already on your Aerodrome. */
function canMoveBalloonNow(view: PlayerView): boolean {
  if (view.aerodrome === null) return false;
  if (!view.aerodrome.balloons.some((b) => b.at !== view.seat)) return false;
  let suits = 0;
  for (const count of Object.values(view.you.barn)) if ((count ?? 0) > 0) suits += 1;
  return suits >= 2;
}

/**
 * Is this door's action legal for this seat right now? The view's approximation
 * of the engine's `workerActionLegal`, which is what gates both routes to a
 * door - a visit and a meeple.
 *
 * ⚠️ IT IS AN APPROXIMATION AND THE BUILD BRANCH IS WHERE IT IS LOOSEST. The
 * engine asks `anyBuildOption`, a real affordability scan over the hand against
 * every card in it; this asks only whether the hand is non-empty, because the
 * scan needs the crop requirements of every held card and is far too heavy for
 * a per-decision derivation. The error is one-directional - this says yes where
 * the engine would say no, never the reverse - so a Dairy meeple can be
 * OVER-valued and never under-valued. That is the safe direction for the
 * hoarding question (an over-valued meeple gets spent, and a spend the engine
 * refuses is simply not offered) and the wrong direction for the door mix, so
 * it is written down here rather than left to be discovered in a report.
 */
function doorReady(
  data: GameData,
  view: PlayerView,
  action: WorkerAction,
  buildings: ReadonlyMap<CardId, BuildingView>,
): boolean {
  const you = view.you;
  switch (action) {
    case 'draw':
      return view.suitsInPlay.some((suit) => (view.decks[suit] ?? 0) > 0);
    case 'harvest':
      for (const building of buildings.values()) {
        const threshold = thresholdOfView(data, building);
        if (threshold !== null && building.stack.length >= threshold) return true;
      }
      return false;
    case 'sow': {
      if (you.hand.length === 0) return false;
      for (const building of buildings.values()) {
        const threshold = thresholdOfView(data, building);
        if (threshold !== null && building.stack.length < threshold) return true;
      }
      return false;
    }
    case 'build':
      // See the warning above: hand-non-empty stands in for the affordability
      // scan, and errs generous.
      return you.hand.length > 0;
    case 'deliver':
      // Island or freight: a balloon move IS the Deliver action (DL-12).
      return canDeliverNow(data, view) || canMoveBalloonNow(view);
    default:
      return action satisfies never;
  }
}

/**
 * One entry per colour, whatever is at the table - a meeple of a suit NOBODY is
 * farming still works, because the five door actions exist independently of who
 * farms what, so this may never be filtered by `suitsInPlay`.
 */
function meepleWorthByColour(
  data: GameData,
  view: PlayerView,
  buildings: ReadonlyMap<CardId, BuildingView>,
): Map<Suit, number> {
  // ⭐ R15's WHOLE FOOTPRINT ON THE HOLDING PRICE IS THESE TWO LINES. Under v1
  // a meeple is a stored action and nothing else, so a dead door is worth
  // `MEEPLE_LATENT`; under R15 it is also a card of its colour, so the floor is
  // a card and the live door keeps its premium on top. Read off the knob once,
  // here, rather than at each of the term call sites - the same reason
  // `Scratch.meepleArm` exists.
  const asCard = isMeepleAsCard(data);
  const live = asCard ? MEEPLE_AS_CARD_LIVE : 1;
  const dead = asCard ? MEEPLE_AS_CARD_FLOOR : MEEPLE_LATENT;
  const out = new Map<Suit, number>();
  for (const colour of data.cards.suits) {
    const door = doorForSuit(data, colour);
    if (!door) {
      // No door at all, which is unreachable in shipped data. Under R15 it is
      // still a CARD of its colour, so the floor applies and only the door
      // premium is lost; under v1 there is nothing left to be worth.
      out.set(colour, asCard ? MEEPLE_AS_CARD_FLOOR : 0);
      continue;
    }
    out.set(colour, doorReady(data, view, door.action, buildings) ? live : dead);
  }
  return out;
}

/**
 * Replay the engine's `collectBoard` against the view: which of the meeples on
 * this seat's OWN Notice Board would survive the supply cap, in the order the
 * engine takes them.
 *
 * Nothing to do under the `'card'` game, where a seat has no slots at all - the
 * empty array is returned before anything is read, so the control pays one
 * boolean for the arm's existence and no more.
 */
const NO_MEEPLES: readonly Suit[] = [];

function collectKeepsFor(data: GameData, view: PlayerView): readonly Suit[] {
  if (!isMeepleCurrency(data)) return NO_MEEPLES;
  const slots = view.you.noticeBoard?.slots;
  if (!slots) return NO_MEEPLES;
  const cap = data.rules.turn.meepleCapPerColour;
  // A running copy of the supply, because the cap is applied meeple by meeple in
  // the engine and the second of a pair has to see the first one land. Under the
  // shipped `null` (no cap) nothing is ever refused and this walk keeps
  // everything, which is why the loop is not short-circuited: the ORDER it
  // returns is what the caller prices, and that order must not change with the
  // cap.
  const held: Partial<Record<Suit, number>> = { ...view.you.meeples };
  const kept: Suit[] = [];
  for (const slot of data.cards.suits) {
    for (const meeple of slots[slot] ?? []) {
      const have = held[meeple] ?? 0;
      if (cap !== null && have >= cap) continue;
      held[meeple] = have + 1;
      kept.push(meeple);
    }
  }
  return kept;
}

export function makeScratch(data: GameData, view: PlayerView): Scratch {
  const you = view.you;
  const buildings = new Map<CardId, BuildingView>();
  // ⭐ TWO FIELDS WHERE THERE WAS ONE (Dean's two-board fix, 11/09/2026).
  // The scan below used to keep the LAST board it walked past, which was the
  // only board in every game until 11/09/2026 and is the seat's RANDOM EXTRA
  // one at two seats under `rules.economy.noticeBoardsBySeats` - setup lays the
  // starters out first and pushes the extras on after. So the board a term
  // meant by "your own board" is now taken by SUIT, exactly as the engine's
  // `noticeBoardOf` takes it, and the set carries all of them for the readers
  // that meant "any board of mine".
  const noticeBoards = new Set<CardId>();
  let noticeBoard: BuildingView | null = null;
  let farmsteadCrop: Suit | null = null;

  for (const building of you.tableau) {
    buildings.set(building.card, building);
    const card = cardById(data, building.card);
    const slot = starterSlotOf(card);
    if (slot === 'noticeboard') {
      noticeBoards.add(building.card);
      // The seat's own suit's board wins outright; anything else only fills the
      // field while nothing has. ⚠️ The fallback is not dead code and it
      // is not a guess: it is the pre-fix answer for a one-board tableau, and
      // it keeps this field non-null for a game that ever deals a seat a board
      // of a suit it is not farming without dealing it its own. The engine
      // THROWS on that shape (`noticeBoardOf`); a pricer must not, so it takes
      // the first board it sees and the report reads a number rather than a
      // stack trace.
      if (card.suit === you.suit || noticeBoard === null) noticeBoard = building;
    }
    if (slot === 'farmstead') farmsteadCrop = card.suit;
  }

  const demandSuits = new Set<Suit>();
  const per = data.island.tileRule.cardsPerCrate;
  for (const tile of view.island.tiles) {
    if (tile.deliveredBy.length >= deliveriesPerTile(data)) continue;
    const { base, wilds } = demandOf(tile, per);
    if (wilds > 0) for (const suit of view.suitsInPlay) demandSuits.add(suit);
    for (const suit of Object.keys(base) as Suit[]) demandSuits.add(suit);
  }

  const handLimit = data.rules.turn.handLimit;

  return {
    data,
    view,
    mySuit: you.suit,
    meepleArm: isMeepleCurrency(data),
    noticeBoardArm: isNoticeBoardPower(data),
    // The one place the `3+` rule reaches the bots' model of the table. Under
    // every other game a threshold is a ceiling, so this is true.
    noticeBoardClogs: !isNoticeBoardPower(data) || noticeBoardBlocks(data),
    targetSuit: magpieTarget(you.suit, view.suitsInPlay),
    handLimit,
    handRoom:
      handLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, handLimit - you.hand.length),
    buildings,
    noticeBoard,
    noticeBoards,
    farmsteadCrop,
    demandSuits,
    meepleWorth: meepleWorthByColour(data, view, buildings),
    collectKeeps: collectKeepsFor(data, view),
  };
}
