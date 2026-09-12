/**
 * THE FIVE DOORS: performing a suit's action.
 *
 * `workers.json` says what each suit's action IS, and since v31 exactly two
 * things read it - a NOTICE BOARD grants that action to whoever places a card on
 * it, and a MEEPLE of that colour performs the same action free when its owner
 * spends it. Same five entries, same five actions, two ways in, so there is one
 * dispatch here and both routes come through it.
 *
 * ⛔ WHAT LEFT THIS FILE, IN THE ORDER IT LEFT. The Working Week track's advance,
 * wage and expiry arithmetic went with the Hiring Fair (2026-08-10). The wage
 * itself went with the currency (v31), and with it the standing law it enforced
 * - that you never earn from your own farm - because in v31 the owner places a
 * card on their own board exactly as a rival does and there is nothing to earn.
 * `workWorker` and its `WorkOptions.progress` flag went at the same time:
 * `progress: false` was the Herb Hive's off-the-books mode, where the action
 * happened but no card was placed and no wage was minted, and neither half of
 * that sentence describes anything that still exists.
 *
 * ⭐ THE DOORS ARE PLAIN, AND THAT IS THE v31 CHANGE. Every enhancement the
 * roster used to carry - the relaxed harvest, the hand card into the barn before
 * a delivery, the deck-sown card, the build at a discount with crop requirements
 * waived - is gone, because the bonus slot itself became the enhancement: a door
 * now buys a WHOLE CORE ACTION for one card, which is a far bigger prize than
 * any rider was, and stacking a rider on top was pricing a sweetener into a deal
 * that no longer needed one. The `draw` and `sow` blocks survive only because
 * those two actions need a size.
 */

import type { GameData, Suit } from '@gp/data';
import { dairyGrowsBuilt, doorActionForSuit, isMeepleCurrency, meepleSpendTiming } from '@gp/data';

import { doorOf, unclaimedCentre } from './query.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import type { CardId, DoorAction, Seat } from './state.js';

/**
 * What paid for this door action: a card on a rival's Notice Board, a meeple
 * leaving the supply, or - since 09/09/2026 - a card played onto a CENTRAL board
 * (C3). Three routes, one dispatch, exactly as the first two have been since
 * v31: `via` says what paid and nothing below it branches on the answer.
 */
export type DoorVia = 'visit' | 'meeple' | 'commons';

/**
 * ⭐ WHAT A COLOUR'S DOOR BUYS, WHICH IS NOT ALWAYS WHAT `action` PRINTS.
 *
 * Under the commons the Apiary board buys **GROW** - pay the building's
 * activation card into its stack and gain the ability - where the roster's
 * `action` prints SOW, and Dean's reason is worth keeping: a sow through the
 * door cost a visitor two cards for one threshold step (the self-cancellation
 * bite), and the commons fee is a third card on top of it. A Grow is the same
 * placement with the ability attached, so the weakest door in the game becomes a
 * real one at the same price.
 *
 * The override is DATA (`workers.roster.sow.actionUnderCommons`, C3), read
 * through the data package's own `doorActionForSuit` so the engine, the bots and
 * the sim cannot disagree about what a board buys. It is a second payload beside
 * `action` rather than an edit to it, so `overlays/v31-card-visit` and
 * `overlays/meeple-loop-v1` keep their Sow door without pinning anything.
 *
 * Throws rather than defaulting, exactly as `doorOf` does: a colour with no door
 * is a corrupt roster and not a state a caller should be handling.
 */
export function doorActionOf(data: GameData, colour: Suit): DoorAction {
  const action = doorActionForSuit(data, colour);
  if (action === undefined) throw new Error(`No door action for suit ${colour}`);
  return action;
}

/**
 * ⭐ WHAT A MEEPLE BUYS, AND IT IS THE **PLAIN ACTION** AND NEVER A BOARD POWER
 * (M6/M7, Dean 12/09/2026, A151, the delivery meeple).
 *
 * ⛔ **M6 IS THE WHOLE POINT AND IT IS EASY TO GET WRONG.** Under
 * `visitCurrency: 'noticeBoardPower'` a VISIT buys the board's printed power -
 * the Orchard board is "Draw 4" - and a meeple buys the plain Draw 2. They stopped
 * being the same thing on 10/09/2026 and nothing in the design says so twice.
 * `performDoorAction` is the plain path (`fireNoticeBoardPower` is the other
 * one), so a meeple routed through it already gets the plain action for four of
 * the five colours; this function exists for the fifth.
 *
 * ⛔ **THE FIFTH IS THE APIARY, WHICH BUYS A GROW AND NEVER A SOW (M7).** Sow is
 * not one of the five core actions - it is a keyword granted by card text - and
 * "orange means Grow here and Sow there" has cost this project a day before. The
 * roster's `action` for that door is `sow`, so the one mapping is written here:
 * a sow door buys the GROW its `actionUnderCommons` payload already names. ⭐ M8:
 * a meeple Grow places its activation card AS NORMAL and CAN clog, which is the
 * ordinary `grow` task and therefore free - it differs on purpose from V8's
 * coin-Grow, which places nothing.
 *
 * ⚠️ **GATED ON `meepleSpendTiming === 'afterAction'` AND THAT IS DELIBERATE.**
 * `'start'` is the v31 control's own turn-start spend, whose Apiary meeple has
 * bought a SOW since v31 and whose four fixtures replay it. M7 belongs to M4's
 * sentence ("after your main action, discard one meeple for the plain action of
 * its colour"), so it arrives with M4's timing and not before it.
 */
export function meepleActionOf(data: GameData, colour: Suit): DoorAction {
  const action = doorActionOf(data, colour);
  if (meepleSpendTiming(data) !== 'afterAction') return action;
  return action === 'sow' ? 'grow' : action;
}

/**
 * ⭐ THE FIVE NOTICE BOARD POWERS (S12 of
 * `docs/notice-board-visit-handoff-2026-09-10-v2.md`, as amended by Dean's
 * rulings C88 and C89 of the same evening). Live under
 * `rules.turn.visitCurrency: 'noticeBoardPower'`, where a visitor plays one
 * card onto ANY player's Notice Board and takes that board's PRINTED POWER -
 * and under `rules.economy.farmsteadCoinPower`, the superseded coins arm of
 * that morning, whose Farmstead activates for a coin into the same five.
 *
 *   Orchard    "Draw 4."                                        `orchardDraw`
 *   Dairy      "Build. You may spend cards of any crops."        `dairyWild`
 *   Wheat      "Harvest one of your buildings, then put 1 card
 *               from your hand into your barn."                  `wheatBarn`
 *   Apiary     "Sow 2 cards from your hand onto your buildings." `apiarySows`
 *   Vegetable  "Deliver. If you cannot, put 2 cards from your
 *               hand into your barn."                    `vegetableFallback`
 *
 * ⭐ EACH IS ITS OWN SUIT'S VERB AMPLIFIED, so a board is guessable from its
 * colour before it is read, and each is worth roughly two plain actions. S13
 * fixed AVAILABILITY first and power second: the morning's set was measured
 * over 6,771 positions and four of the five were dead most of the time (live
 * rates 63%, 44%, 42%, 19%, 5%), which is why every power below has a leg that
 * works out of a bare hand.
 *
 * ⛔ S13's PRECEDENT BINDS ALL FIVE AND IT KILLED THREE OF THEM ALREADY: a
 * power that duplicates a card word for word takes that card's identity away.
 * The morning's Dairy power WAS D4 The Milking Shed (a discount of 1 already
 * waives crop requirements, see `priceOf`) and its Vegetable power WAS V15 The
 * International Port (two deliver tasks); ruling C88 then killed S12's own
 * Wheat power for being W11 The Bakehouse. Read the note on each branch before
 * moving a number.
 *
 * ⚠️ IT LIVES IN THIS FILE AND NOT IN `handlers/farmstead.ts`, WHICH IS A
 * DELIBERATE MOVE (10/09/2026). This is the file that already answers "perform
 * a suit's action, bought by something" - `performDoorAction` is its sibling
 * three functions up - and the power is a bought action rather than card text.
 * It also cannot live in `actions.ts`, which calls it from `doVisit`, nor in a
 * handler, which `actions.ts` may not import.
 *
 * ⚠️ `deliverLegal` IS ANSWERED BY THE CALLER, AND ONLY THE VEGETABLE
 * BRANCH READS IT. "Deliver. If you cannot..." is a question about island
 * claims and balloon moves, and both enumerators live in `actions.ts`, which
 * this file may not import (it is imported BY it). One boolean in beats a
 * module cycle, and both call sites answer it with the same
 * `doorActionLegal(data, state, actor, 'deliver')`.
 */
export function fireNoticeBoardPower(
  fx: Fx,
  actor: Seat,
  colour: Suit,
  opts: {
    /** The card that granted this: a Farmstead under the coins arm, null for a visit. */
    src: CardId | null;
    /** Can `actor` deliver right now - an island claim or a balloon move (DL-12)? */
    deliverLegal: boolean;
  },
): void {
  const numbers = fx.data.rules.economy.noticeBoardPower;
  const { src } = opts;
  switch (colour) {
    case 'orchard':
      // "Draw 4." The ordinary plain-draw path - a see-N/keep-N draw task, one
      // card from any deck in play per card seen, which is what every
      // card-granted draw in the game pushes. ⭐ THE ONE POWER THAT CAN NEVER
      // BE DEAD, because the decks are always there, and the only one of the
      // five S13 raised rather than replaced (3 to 4).
      fx.pushTask({
        t: 'draw',
        pid: actor,
        src,
        see: numbers.orchardDraw,
        keep: numbers.orchardDraw,
        revealed: [],
      });
      return;
    case 'dairy':
      // "Build. You may spend cards of any crops." ⭐ A WAIVER, NOT A
      // DISCOUNT, and that is ruling S13 in one line: a build at a discount of
      // 1 ALREADY waives the crop requirement (`priceOf` sets the own-suit
      // minimum to 0 whenever a discount applies), so the morning's
      // `dairyDiscount` power was D4 The Milking Shed word for word and the
      // card lost its identity to it. The full card count is still paid here;
      // only the n-of-suit half goes, through `BuildMods.substitute` - which
      // has been "a mod with no producer" since the v31 doors went plain and
      // now has one again.
      fx.pushTask({
        t: 'build',
        pid: actor,
        src,
        ...(numbers.dairyWild ? { mods: { substitute: true } } : {}),
        // ⭐ Dean's Dairy experiment (12/09/2026), shipped 'none'.
        ...(dairyGrowsBuilt(fx.data) === 'none'
          ? {}
          : { thenGrow: dairyGrowsBuilt(fx.data) as 'paid' | 'paidWild' | 'free' }),
      });
      return;
    case 'wheat': {
      // "Harvest one of your buildings, then put 1 card from your hand into
      // your barn." ⛔ RULING C88 (Dean, 10/09/2026): S12 printed *"Harvest
      // any one of your buildings, however many cards are on it"*, which is
      // W11 The Bakehouse word for word, so the POWER moved and the CARD kept
      // its identity. ONE building, at any stack size - `filter: 'loaded'` is
      // that sentence, the same gate W11 and W13 print - and then a card from
      // the hand into the barn, which is the leg that keeps the power live for
      // a seat with nothing worth harvesting.
      //
      // ⛔ AND IT IS EMPHATICALLY NOT W13 THE BAKERY'S CASCADE. W13 harvests
      // EVERY loaded building; this harvests exactly one. The coins arm's
      // Farmstead did the cascade until 10/09/2026 and that was the collision
      // S13 named.
      //
      // ⚠️ A LOADED NOTICE BOARD IS ONE OF "YOUR BUILDINGS" HERE, so this
      // power can cash a board of your own below the `3+` minimum. That is the
      // magenta balloon's precedent ("Harvest any building, even if it is not
      // full") reaching the one building S8 gives a floor to, and it is a
      // reading the engine had to make rather than one the handoff wrote down.
      // Flagged for Dean; excluding it would have been the bigger invention.
      //
      // ⭐ AND UNDER DEAN'S UNCLAIMED-BOARDS VARIANT IT ALSO REACHES A CENTRAL
      // PILE (11/09/2026). Dean reaffirmed D1 that day - "a Harvest is a
      // Harvest" - and his stated reason was "to prevent any rules exceptions",
      // so the bought Harvest must take one of your buildings OR any central
      // board at `commonsHarvestMin`, exactly as the MAIN Harvest action does.
      // ⚠️ THE TWO LEGS KEEP THEIR OWN GATES AND THEY ARE DIFFERENT ON
      // PURPOSE: a building of yours qualifies at ANY stack size (C88's
      // `filter: 'loaded'`), a central pile only at the minimum, because the
      // minimum is the centre's own `3+` rule and not a relaxation this power
      // is allowed to waive. The flag is `central` rather than a sixth filter
      // value so that W11, W13 and O7 - the card faces that also print
      // `'loaded'` and say "YOUR buildings" - are untouched.
      fx.pushTask({
        t: 'chooseBuilding',
        pid: actor,
        src,
        filter: 'loaded',
        ...(unclaimedCentre(fx.data) ? { central: true } : {}),
        then: 'harvest',
      });
      fx.pushTask({ t: 'handToBarn', pid: actor, src, remaining: numbers.wheatBarn });
      return;
    }
    case 'apiary':
      // "Sow 2 cards from your hand onto your buildings." ⛔ A SOW AND NOT A
      // GROW (ruling C89, Dean 10/09/2026): nothing is activated and no
      // ability fires, so the power cannot become a cheaper A12 The Honey Hut
      // or A5 The Meadow Hive, and it is not the morning's `apiaryGrows`
      // either. ONE task with a remaining of 2 rather than two tasks, because
      // the sow task's own counter is the loop and a hand that runs out drops
      // the remainder through the drain loop.
      //
      // ⛔ ONTO YOUR OWN BUILDINGS ONLY (C89). S12 said "onto any buildings",
      // which read literally reaches across the table; Dean ruled it
      // self-contained, so every power is solitaire and THE VISIT ITSELF STAYS
      // THE ONLY CROSS-TABLE ACT IN THE DESIGN. A `sow` task with no `targets`
      // is exactly "your own buildings" (see `sowTargets`), and S11 takes the
      // Notice Board itself out of that set through `canSowOnto`.
      fx.pushTask({ t: 'sow', pid: actor, src, remaining: numbers.apiarySows });
      return;
    case 'vegetable':
      // "Deliver. If you cannot, put 2 cards from your hand into your barn."
      // ⭐ ONE delivery with a fallback, and NOT the morning's two: delivering
      // twice was V15 The International Port word for word and S13 killed it.
      // The fallback is what makes the board never dead - Deliver is worth
      // nothing to a payer with an empty barn (C53's standing finding), and
      // this is the one power whose failure case SETS UP the next delivery
      // rather than making this one.
      //
      // ⚠️ THE BRANCH IS TAKEN AT FIRE TIME, not at resolution: "if you
      // cannot" is a question about the position the power fires into. A
      // deliver task pushed into a position with no answer would simply be
      // dropped by the drain loop and the seat would get nothing at all, which
      // is the reading S13 was fixing.
      if (opts.deliverLegal) {
        fx.pushTask({ t: 'deliver', pid: actor, src });
      } else {
        fx.pushTask({ t: 'handToBarn', pid: actor, src, remaining: numbers.vegetableFallback });
      }
      return;
    default:
      return colour satisfies never;
  }
}

/**
 * Perform a suit's door action as `actor`.
 *
 * RULING (locked, carried over unchanged since v13): SUIT POWERS APPLY TO
 * ACTIONS PERFORMED THROUGH A DOOR OR BY A MEEPLE. It is your action, whoever's
 * premises it is taken on and whatever wooden thing paid for it. In v31 there
 * are no Farmstead suit powers left for that ruling to reach, but it still
 * governs anything a CARD grants, so the branches below push the same tasks the
 * core actions push and nothing here is a second implementation of an action.
 *
 * ⚠️ THE ONE EXCEPTION IN THE SET IS THE ORCHARD DOOR AT DRAW 3, AND IT IS
 * LOAD-BEARING. The self-cancellation law: a visitor pays 1 card to use a door,
 * so a door whose action PRODUCES cards has to over-deliver or buying it is net
 * zero. The bonus slot's other option is a free Draw 1, so a plain Draw 2 door
 * would cost 1 card and return 2 - exactly what the free option gives for
 * nothing - and would be STRICTLY WORSE than its own alternative. Draw 3 nets
 * +2. Tidy it to 2 for consistency with the other four and the Orchard door dies
 * overnight, and it will die silently: nothing errors, the traffic simply goes
 * somewhere else.
 *
 * `colour` is looked up in `workers.roster` and never in `state.fair`, because a
 * meeple of a suit NOBODY is farming still works.
 */
export function performDoorAction(fx: Fx, actor: Seat, colour: Suit, via: DoorVia): void {
  const door = doorOf(fx.data, colour);
  // The commons re-reads one of the five (Apiary sow becomes GROW, C3); under
  // both controls this is exactly `door.action`.
  // ⭐ AND THE DELIVERY MEEPLE RE-READS THE SAME ONE (M7, 12/09/2026): under
  // `meepleSpendTiming: 'afterAction'` a meeple buys the PLAIN action of its
  // colour and the Apiary's is GROW. One dispatch for all three routes, so a
  // meeple can never be offered one action and handed another - see
  // `meepleActionOf` for why the two questions differ at all.
  const action = via === 'meeple' ? meepleActionOf(fx.data, colour) : doorActionOf(fx.data, colour);
  fx.emit({ e: 'doorUsed', seat: actor, colour, action, via });

  switch (action) {
    case 'draw': {
      // Draw 3, keep 3 - see the exception note above. No draw modifier is
      // consulted: `withDrawModifier` went with the Orchard Farmstead (v31), so
      // the printed numbers are the numbers.
      // ⭐ THE ORCHARD EXCEPTION IS CURRENCY-DEPENDENT (the meeple-loop arm,
      // R2). Draw 3 exists only because a card visit has to beat a free Draw 1;
      // under the meeple currency a visit costs no card and there is no
      // standalone free Draw, so the door is the plain Draw 2 the other four
      // doors are equivalents of. A SECOND printed payload rather than an
      // overwrite, so the shipped 3/3 cannot move when the arm does.
      // ⭐ THE COMMONS READS THE PRINTED `draw`, WHICH IS 2/2 SINCE 09/09/2026
      // (C3: Dean chose Draw 2 over Draw 3, with `commons-draw-three` as the
      // paired arm). No third payload and no branch: the data pass moved the
      // printed number, the meeple arm keeps its own second payload, and the
      // v31 control is the one game that ever wanted a 3 here.
      const spec = (isMeepleCurrency(fx.data) ? door.drawUnderMeepleCurrency : undefined) ??
        door.draw ?? { see: 1, keep: 1 };
      fx.pushTask({
        t: 'draw',
        pid: actor,
        src: null,
        see: spec.see,
        keep: spec.keep,
        revealed: [],
      });
      break;
    }
    case 'harvest':
      // The PLAIN Harvest: full buildings only. The `relaxedMin` rider this used
      // to pass ("2 or more cards, even if not full") was printed on the Wheat
      // Notice Board and travelled with the action to whoever worked the door;
      // v31's flat doors deleted it.
      fx.pushTask({
        t: 'chooseBuilding',
        pid: actor,
        src: null,
        filter: 'harvestable',
        then: 'harvest',
      });
      break;
    case 'sow':
      // ⚠️ FROM THE HAND, AND THIS IS THE WEAKEST DOOR ON THE TABLE (Dean,
      // 02/09/2026, ruled that way knowingly). A visitor pays 1 card onto the
      // board and a SECOND card into the sow, for one threshold step on one of
      // their own buildings: two cards out for one step in, which is the
      // self-cancellation law biting on the one door where it was not paid off.
      // The fix, if the Apiary board takes no traffic, is `from: 'deck'` in the
      // data - not a cheaper door - and this branch already handles it.
      if (door.sow?.from === 'deck') {
        fx.pushTask({ t: 'sowFromDeck', pid: actor, src: null, remaining: door.sow.amount });
      } else {
        fx.pushTask({ t: 'sow', pid: actor, src: null, remaining: door.sow?.amount ?? 1 });
      }
      break;
    case 'grow':
      // ⭐ THE COMMONS APIARY BOARD (C3), and the one door action with no
      // roster entry of its own. It reuses the main Grow action's own task
      // chain - one task, answers straight out of `growOptions`, resolved
      // through `doGrow` - so the ability fires through the same funnel a
      // played Grow does and nothing here is a second implementation. The
      // commons FEE is extra and has already left the hand by the time this
      // runs, which is why the enumerator prices the payment without it.
      // ⛔ NO CLOG BYPASS (C3): a card is placed, so a full building is not a
      // target. The meeple-paid Grow's bypass (R15) is a different rule and
      // there are no meeples here.
      fx.pushTask({ t: 'grow', pid: actor, src: null });
      break;
    case 'build':
      // The PLAIN Build: full cost, crop requirements apply. The Builder's Yard
      // used to waive the crops and take a card off the price; v31's flat doors
      // deleted both, so a visitor buying a Build buys the action and nothing
      // more.
      fx.pushTask({ t: 'build', pid: actor, src: null });
      break;
    case 'deliver':
      // The PLAIN Deliver, island or freight (a balloon move IS the Deliver
      // action, DL-12). The hand-card-into-the-barn head this used to queue
      // first was the door's rider and is gone.
      fx.pushTask({ t: 'deliver', pid: actor, src: null });
      break;
    default:
      action satisfies never;
  }

  // Fires for both routes. It used to carry `owner` (who collected the wage) and
  // `free` (the Herb Hive's off-the-books use); both described an economy that
  // no longer exists, so the payload says what happened instead of who was paid.
  fireHook(fx, 'afterWork', { actor, colour, action, via });
}
