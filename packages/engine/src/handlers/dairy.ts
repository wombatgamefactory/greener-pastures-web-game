/**
 * Dairy handlers - all 21 cards, REBUILT (docs/dairy-suit-rebuild-v4.md, landed
 * from docs/handoff-dairy-engine-build.md). Card texts are quoted from
 * cards.json (the sheet is the single source of truth for wording).
 *
 * Suit identity: Build. Every tier card is a Build variant, so almost nothing
 * here is card-specific logic: the variants are expressed as `BuildMods` on the
 * shared build task and the enumerator does the rest. That is still the whole
 * design of this suit - IF A DAIRY CARD NEEDS ITS OWN BUILD CODE, THE MODS ARE
 * WRONG - and the rebuild kept it while changing what the mods are: `discount`
 * and `substitute` survive, `coinWild` and `fromBarn` are deleted (see
 * `BuildMods`), and `fromStacks` is new for D7.
 *
 * ## Why the suit was rebuilt
 *
 * Dairy was last in the game on every channel: 10.6% win rate, 22.0 score, 2.0
 * deliveries, 10.2 cards into its barn, 2.8 rival cards onto its Service, and
 * 0.12 activations per Tier 1 card - the worst number in the game by a factor of
 * six. The cause of the last of those is one sentence: **Build is a free action
 * every turn, so a card that reads "Build" plus a small rider is worth minus one
 * card.** Every old Tier 1 read exactly that. So every number below is set above
 * the line where a modifier merely refunds the card that paid for it: a discount
 * of 1 against a 1-cost card is worth precisely nothing, which is what the old
 * Milking Shed printed.
 *
 * The deeper fault was not price at all. Dairy's cards moved cards OFF the
 * pipeline into the tableau, where they can never be delivered, and freight is
 * 80% of a winning score. That is what the Farmstead now fixes, in one line.
 *
 * ## The three seams that are not in this file
 *
 *   1. **The Farmstead diversion** (`actions.ts`: `buildDivertPower`,
 *      `divertOrDiscard`). "When you Build, put 1 card you spend from your hand
 *      into your barn instead of discarding it", every card on the upgraded
 *      face. It is a build-time seam and not a card handler because it has to
 *      act BEFORE the payment is discarded - D5 reaches into the discard for
 *      the same cards afterwards (D6 stopped doing this in v47; see D6's own
 *      notes), and one destination per spent card falls out of that ordering.
 *      This entry contributes only the task that asks WHICH card
 *      (`divertSpent`, on D2).
 *      ⚠️ HAND CARDS ONLY. A card D7 lifted off a stack is not divertible, or
 *      D2 + D7 is a free Harvest - stack to build cost to barn, no action spent.
 *   2. **`BuildMods.fromStacks`** (`actions.ts`), D7's payment source.
 *
 * ## What left the file on 19/08/2026 (the v30 card pass)
 *
 * Two whole mechanisms, and both of them were engine seams rather than card
 * text, so nothing here is safe to reason about from an older doc:
 *
 *   1. **The Tier 3 ACTION seam is retired** (`handlers/actionCard.ts`). D13,
 *      D14 and D15 printed no threshold and no activation type, so they could
 *      be neither grown nor sown, and each offered a standing MOVE that WAS the
 *      main action. Dean, 19/08/2026: *"The concept of an ACTION was never
 *      requested. They are all GROW."* All three now carry a threshold and a
 *      wild activation off the sheet and are ordinary owner-activated
 *      buildings. The measured argument for the seam - a GROW-gated Tier 3
 *      fired 0.63 times per card built, an action-gated one as often as its
 *      owner chose - is overruled rather than refuted, and no arm is owed.
 *      `turn.actionSpent` is set by the grow runtime now, never by a handler.
 *   2. **The `covered` zone is deleted with D11's build-on-top.** The Heritage
 *      House read *"Build. Sow all the cards spent."* on this date (v47
 *      retexts it again, to a plain "Draw 1 for each card you spent" - see its
 *      own notes below; the zone deletion this paragraph is about is
 *      unaffected either way). Covering was the only thing in the game that
 *      produced a covered card, and covered was a first-class player zone:
 *      `GameState.covered`, a `coverBuilding` primitive, a `covered` event, a
 *      term in end-game printed VP, two fields in the player view, a case in
 *      the bots' outcome fold and a panel in the UI. All gone. ⛔ Do not
 *      reintroduce a cover on any card without reintroducing the zone - there
 *      is nowhere for a buried card to live.
 *
 * ## What went, and it was load-bearing
 *
 * `buildSubstitutePower` gave a Dairy seat permanent crop substitution from turn
 * 1 and `buildAgainPower` sold a second Build ACTION - the scarcest resource in
 * the game - for £2. Both are deleted. Substitution survives only as a mod the
 * BUILDER'S YARD grants to whoever visits it, which is what makes a Dairy seat's
 * own Service worth buying: 5% of rival Service uses and 2.8 rival cards a game
 * were both last in the game, and the traffic ranking is the win ranking in
 * exact order. Expect this to read as a Dairy nerf in the arm before the
 * diversion pays it back.
 *
 * SHED is a sub-type derived from the whole-word title keyword, following the
 * reference (DL-42) and matching `isFieldCard` in wheat.ts: D4-D8, and D4-D8
 * only. ⚠️ Any future card named "... Shed" joins the set silently.
 */

import type { GameData, Suit } from '@gp/data';

import { doBuild, paymentOptions } from '../actions.js';
import type { BuildMods } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player, thresholdOf } from '../query.js';
import { REVEAL_RIDER, pickFromReveal, revealedIn } from '../state.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { builtBuildingsAndPower, builtBuildingsWorth } from './buildings.js';
import { barnCropScorer, farmsteadHandler } from './farmstead.js';
import type { CardHandler } from './types.js';

/**
 * D14's flat payout. It used to be the demolished building's own card cost -
 * the one number Dairy is best at making large - and Dean flattened it to 3 on
 * 19/08/2026. Named rather than inlined because it is the dial the arm will
 * reach for first if the Refinery stops being built at all (v30 flag 8.5).
 */
const REFINERY_DECK_CARDS = 3;

/**
 * D15's "for free" (v47 retext; tasks/v47-ambiguity-audit-v1.md, the D15 rows
 * of "Resolved from the printed words or a standing ruling"): a
 * `BuildMods.discount` at least the largest printed build cost waives BOTH
 * halves of `priceOf` at once - `cardsNeeded` bottoms out at 0 and any
 * `discount > 0` already zeroes `ownSuitMin`, so this one number is the whole
 * of "for free" including the n-of-suit requirement. 99 is comfortably above
 * the highest cost in `cards.json` (4, as of v47).
 */
const FREE_BUILD_DISCOUNT = 99;

const SHED_NAME = /\bShed\b/;

/**
 * SHED sub-type membership, by whole-word title keyword (reference DL-42).
 * ⭐ No card reads it since v42 (16/09/2026): the Barn's build rider went in
 * v31 and D21 now counts 3VP buildings. Kept exported for the simulator.
 */
export function isShedCard(data: GameData, id: CardId): boolean {
  return SHED_NAME.test(cardById(data, id).name);
}

/**
 * D14 The Cream Refinery's DEMOLISH TARGET LIST ONLY, since v48 - every
 * non-starter card in a seat's tableau, Power and Endgame included.
 *
 * ⛔ NO LONGER A COUNTING NOUN. Before v48 this doubled as "buildings you have
 * built" for D9, D13 and D20; R13 (tasks/v48-rulings-v2.md) now makes Power
 * cards count for THOSE cards specifically, so they read the new, DELIBERATELY
 * SEPARATE `builtBuildingsAndPower` (buildings.ts) instead, which excludes
 * Endgame cards this function does not. Widening THIS function to match would
 * have handed D14 the same Power cards as legal demolish targets, which R13
 * forbids outright ("never a sow, Grow, Harvest, activation or stack target") -
 * D14's demolish is a stack-emptying target choice, exactly the kind of list
 * R13 says must not move. So this stays exactly as it was, kept for D14 alone;
 * see `builtBuildingsAndPower`'s own doc comment for the count reading.
 *
 * BUILT MEANS PAID FOR AND PUT DOWN. The three starters arrive pre-built and
 * nobody built them, so counting them would hand every holder a flat 3; that
 * holds whether or not they are flipped. A D14-demolished card has left the
 * tableau and is already excluded, which is the cost of demolishing. The same
 * set is also the TARGET SET for the one primitive that removes a building -
 * `fx.demolish` - and `sim/starter-invariant.test.ts` reads this filter to
 * prove no starter can reach it. (`fx.coverBuilding` was the second such
 * primitive and is gone with the `covered` zone, 19/08/2026.)
 */
function builtBuildings(data: GameData, state: GameState, seat: Seat): CardId[] {
  return player(state, seat)
    .tableau.filter((b) => cardById(data, b.card).type !== 'starter')
    .map((b) => b.card);
}

/**
 * Decks on the table with cards left - D10's deck choice and D14's flat 3
 * deck-to-barn cards. ⛔ D15 no longer reads this (v47: it builds off the hand,
 * touching no deck at all).
 */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/** Push a see-N/keep-N "Draw N" for a card ability (no Orchard modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/**
 * Push a Build under `mods`, tagged with `src` so the card can react to its own
 * build (D5, D6). Nothing is folded in on top any more: what a build carries is
 * exactly what granted it.
 */
function buildWith(fx: Fx, seat: Seat, src: CardId, mods: BuildMods, optional = false): void {
  fx.pushTask({ t: 'build', pid: seat, src, mods, ...(optional ? { optional: true } : {}) });
}

/**
 * Cards of `spent` still face up in their suits' discards - D5 asks. ⛔ D6
 * stopped asking in v47 (it no longer reaches into the discard at all).
 */
function stillDiscarded(data: GameData, state: GameState, spent: readonly CardId[]): CardId[] {
  return spent.filter((id) => state.discards[cardById(data, id).suit]?.includes(id));
}

/**
 * D1 Barn (starter) - prints NOTHING (v31).
 *
 * ⛔ Both lines went: the hand size with the hand limit itself, and the build
 * rider ("When you build a SHED, Draw 1") with the other four Barn riders. THIS
 * IS THE ONE THAT MEASURED WORST, and the reading is the reason the whole family
 * was deleted rather than trimmed. The rider is printed identically on all five
 * Barns but pays out per BUILD, and Dairy builds 12.02 buildings a seat against
 * a field of about 5, so a line the sheet treats as shared paid this suit 2.4x
 * what it paid anybody else: a shared line on an unshared metric is a hidden
 * per-suit faucet. The Dairy rebalance had already halved it (Draw 2 to Draw 1)
 * on exactly that finding. *
 * ⭐ THE HAND LIMIT CAME BACK ON 02/09/2026 AND THIS CARD DID NOT. The
 * reinstated limit is a flat 12 for everybody, in `rules.turn.handLimit` and
 * on the player aid; the Barn stays blank. A rule that applies to every seat
 * is not a card value, which is the whole difference between the old shape and
 * the new one - so nothing here should be un-deleted.
 */
export const dairyBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour of its own, and no printed text to have behaviour about. Registered ' +
      'so that a Barn with no entry reads as a deliberate blank rather than as a card ' +
      'nobody implemented. ' +
      '⭐ ENDGAME IS TRUE SINCE 10/09/2026, AND THE FLAG IS STRUCTURAL RATHER THAN A ' +
      'taste: the card carries a `gameEnd` now. Under the notice-board visit (S1) the ' +
      'crop scorer - "Game end: 1 VP for each <CROP> card you have built" - moves off ' +
      'the Farmstead onto the Barn, which is the starter whose one job is to hold your ' +
      'harvested cards. `barnCropScorer` answers 0 in every other game, so the printed ' +
      'behaviour is still nothing at all in the shipped commons and in all four ' +
      'controls. Every other flag stays false: no prompt, no move, no hook, nothing ' +
      'cross-table.',
  },
  /**
   * ⭐ THE CROP SCORER, WHICH LANDS HERE UNDER THE NOTICE-BOARD VISIT ONLY
   * (S1, Dean 10/09/2026): *"Game end: 1 VP for each Dairy card you have
   * built."* Under that rejig each starter does exactly one thing - the Notice
   * Board prints your suit's power and holds the visit fees, the Barn holds
   * your harvested cards and prints this line, and the Farmstead holds six
   * island receipt tokens and prints nothing at all.
   *
   * ⚠️ AND IT IS SILENT IN EVERY OTHER GAME. `barnCropScorer` answers 0
   * unless `rules.turn.visitCurrency` is `'noticeBoardPower'`, so the shipped
   * commons, the v31 control, the meeple controls and the coins arm all score
   * exactly as they did - the Farmstead keeps the line in the first four and
   * loses it with nowhere to go in the fifth (K13). The two are gated by the
   * same predicate from opposite sides, so the term can never be scored twice
   * or dropped.
   */
  gameEnd: barnCropScorer('dairy'),
};

/**
 * D2 Farmstead (starter) - "Game end: 1 VP for each Dairy card you have built."
 *
 * ⛔ THE BUILD DIVERSION IS GONE (v31), and it was called "the suit's whole
 * compensation": "put 1 card you spend from your hand into your barn instead of
 * discarding it", the direct answer to barn intake of 10.2 against Orchard's
 * 25.7. Every other suit spent a card OR shipped it; Dairy did both.
 *
 * FOUR RULINGS DIED WITH IT AND THREE ARE WORTH KEEPING, because anything that
 * reaches into a build payment will meet them again. (1) Cards spent from your
 * HAND only - a card D7 lifted off a stack is not eligible, or D2 plus D7 is a
 * free Harvest. (2) Once per Build however many buildings that Build puts down,
 * with the COUNT per card spent, so D12 and D15 diverted more without the
 * trigger re-firing. (3) ONE DESTINATION PER SPENT CARD, enforced by ORDERING
 * rather than by assertions: the diversion came out BEFORE the discard, never
 * reclaimed from the pile afterwards, so D5 and D6 could never race it. That
 * ordering rule is written into `divertOrDiscard` (actions.ts) and is the rule
 * O17 The Fruit Basket now has to obey.
 *
 * ⚠️ NOTHING REPLACES IT. The suit that most needed cards turning into freight
 * has lost the only line that did it, and D2's scorer pays for building your own
 * crop - which Dairy was already doing more than anybody. Watch barn intake and
 * the own-crop build share together after v31.
 */
export const dairyFarmstead: CardHandler = farmsteadHandler('dairy');

/**
 * D3 Notice Board (starter) - "VISITOR: place 1 card here, then Build."
 * Threshold 2, wild activation.
 */
export const dairyNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the fee landing, the door action and the clog at threshold 2 are ' +
      'all engine-level. ' +
      "⛔ THE DISCOUNT AND THE CROP WAIVER ARE BOTH GONE (v31). The Builder's Yard used to " +
      "take 2 cards off a visitor's build cost and waive its crop requirements, which was " +
      'itself a reversal of a documented ruling (outstanding-rule-changes.md section 5) that ' +
      'Dean approved on the visitor side because Build took 5% of all rival door uses, last ' +
      'in the game. v31 makes every door plain on one argument that outranks it: the bonus ' +
      'slot itself became the enhancement, because a door now buys a WHOLE CORE ACTION for ' +
      'one card. ' +
      '⚠️ THE SUBSTITUTION MOD OUTLIVED ITS PRODUCER. `BuildMods.substitute` is still in ' +
      'actions.ts with nothing in the shipped data granting it - kept deliberately, as the ' +
      'one expression of "crop requirements waived" - so the next card that prints those ' +
      'words has somewhere to attach.',
  },
};

/** D4 The Milking Shed - "Build at a discount of 1." */
export const milkingShed: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Alters THE PRICE. The naked skeleton at a discount, and the counting task is gone with ' +
      'the counting: the old card counted cards on its own stack and therefore opened at a ' +
      'discount of 1, which against a 1-cost activation is EXACTLY WORTHLESS, so the rebuild ' +
      'made it a FLAT 2. ⚠️ THE DAIRY REBALANCE (v21, 2026-08-12) CUT IT TO 1, and the ' +
      'argument that 2 "is the point" is now out of date rather than wrong. What changed is the ' +
      'baseline it was set against: a flat discount is only worthless when it is CONDITIONAL on ' +
      'a stack that starts empty. Unconditional at 1, this is a 1-cost card at threshold 2 that ' +
      'turns one Dairy card into a card of discount every activation, forever - measured the ' +
      "best rate in the game at 58% play, and now level with the Builder's Yard. The +1 card " +
      'the flat 2 bought is exactly the card-positivity the rebalance is removing from the ' +
      'suit; the card that paid for it is still banked in the stack as freight, which is the ' +
      'half of the old argument that survives. (The rebalance expects this card to shed a ' +
      'point of difficulty and it cannot: it was already at the floor of 1.)',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: 1 });
  },
};

/**
 * D5 The Churning Shed - "Build. Sow 1 card you spent onto the new building."
 * (v47 retext: was "SOW the cards you spend onto the new building, even if
 * the threshold is exceeded.")
 */
export const churningShed: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ v47: SINGLE-SHOT AND ORDINARY. The card no longer sows every spent card and no ' +
      'longer waives fullness - it sows exactly ONE of them, through the ordinary ' +
      '`fx.placeFromDiscard` (the same primitive D11 has always used), never ' +
      '`fx.placeFromDiscardPastThreshold`. That primitive is not deleted (it has no other ' +
      'caller and the audit records it as an orphan for the to-do list; nothing here calls it ' +
      'any more) - "even if the threshold is exceeded" is off the face, so the one thing it did ' +
      'that ordinary placement does not is no longer needed. It CANNOT overfill the new ' +
      'building: a freshly built stack is empty and every threshold is at least 1, so the sown ' +
      'card at most reaches the threshold exactly - a Tier 3 built by D5 can arrive full and ' +
      'harvestable in the same action, which is the printed card and not a special case. ' +
      'Alters THE RESIDUE, at home: needs to know what its OWN build spent, which is what ' +
      "afterBuild's `src` is for - The Ledger reacts to every build, this reacts only to the " +
      'one it granted. The owner picks which one of the spent cards to sow, while it is still ' +
      'face up in its own discard (`stillDiscarded`, so a card O17 diverted to the barn is not ' +
      'available). Mandatory (no "may"), and it auto-skips on a free build (nothing spent) or ' +
      'when the new building has no stack (a Power or Endgame card, or - never reachable - a ' +
      'Notice Board).',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.src !== self.card) return;
      if (event.seat !== self.seat) return;
      if (event.payment.length === 0) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'sowSpent',
        riders: { built: event.card, spent: [...event.payment] },
      });
    },
  },
  tasks: {
    sowSpent: {
      answers(data, state, task) {
        const built = task.riders.built as CardId;
        const target = player(state, task.pid).tableau.find((b) => b.card === built);
        if (!target) return [];
        // Does this card even have a stack? A Power/Endgame card has none.
        if (thresholdOf(data, target) === null) return [];
        if (cardById(data, built).slot === 'noticeboard') return [];
        // Only the cards THIS build spent, and only while they are still the
        // face-up cards we discarded - no reaching into the pile's history, and
        // no reaching for one the Farmstead has already banked.
        const spent = stillDiscarded(data, state, task.riders.spent as CardId[]);
        if (spent.length === 0) return [];
        return spent.map((card) => ({ kind: 'card', payload: { card } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('sowSpent expects a card answer');
        fx.placeFromDiscard(
          task.pid,
          { seat: task.pid, card: task.riders.built as CardId },
          answer.payload.card as CardId,
        );
        // v47: exactly one card, so the task is done after this one placement.
        return true;
      },
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/**
 * D6 The Trading Shed - "If you have less than 5 cards in hand, Draw 1 for
 * each building you have built." (v48 retext: was "Build. You and one
 * neighbour each Draw 1.")
 */
export const tradingShed: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      '⭐ v48 (tasks/v48-ambiguity-audit-v1.md, the resolved-table D6 rows): NO BUILD, NO ' +
      'NEIGHBOUR, NO GIVE. D6 stops being a Build card outright - the `buildWith` call and the ' +
      '`neighbourDraw` task both go - and stops crossing the table at all: `crossPlayer` is ' +
      'FALSE for the first time this card has ever printed. D6 is GROWN exactly like any other ' +
      'Tier 1 building (pay 1 card matching its activation cost onto its own stack); this ' +
      '`activate` is what fires once that payment has already landed. ' +
      'THE HAND IS COUNTED ONCE, HERE, AFTER THE PAYMENT THAT GREW D6 HAS ALREADY LEFT IT (every ' +
      'GROW places its payment before `activate` runs) - "less than 5" reads as 4 OR FEWER. If ' +
      'the gate passes, the FULL count is drawn in one go (`drawN` pushes a single see-N/keep-N ' +
      'task) and is NOT re-checked per card, so the draw itself can carry the hand back above 5. ' +
      'Mandatory (no "may"): with the gate open the draw always happens, even for a count of 0.\n' +
      '⭐ R13 (tasks/v48-rulings-v2.md, 24/09/2026): "EACH BUILDING YOU HAVE BUILT" NOW INCLUDES ' +
      'YOUR OWN BUILT POWER CARDS - `builtBuildingsAndPower` (buildings.ts), a new counting-only ' +
      'helper kept deliberately separate from every target list (a Power card must never become ' +
      'a sow, Grow, Harvest or stack target). Still never a starter (the Notice Board included - ' +
      'nobody builds a starter) and still never an Endgame card: R13 names Power cards only. D6 ' +
      'no longer reads the file-local `builtBuildings`, which stays behind for D14 The Cream ' +
      "Refinery's demolish target list alone - see that function's own doc comment.",
  },
  activate(fx, self) {
    if (player(fx.state, self.seat).hand.length < 5) {
      drawN(fx, self.seat, self.card, builtBuildingsAndPower(fx.data, fx.state, self.seat).length);
    }
  },
};

/**
 * D7 The Versatile Shed - "Build. Place 1 of the cards spent into your Barn."
 * (v48 retext: was "Build. You may spend cards from one of your buildings as
 * 2 wild resources.")
 */
export const versatileShed: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '⭐ v48: THE STACK PAYMENT IS GONE, and the fork it printed - a card on a stack is either ' +
      'freight or building material and never both - goes with it. `BuildMods.fromStacks`, ' +
      '`stackSourcesFor` and `STACK_WILD_VALUE` (actions/build.ts) lose their only caller ' +
      '(tasks/v48-ambiguity-audit-v1.md, Engine notes: "Their only caller (D7)"), and the bots\' ' +
      'stack-payment leg goes with them. D7 is now a PLACEMENT card, the D5 shape: the owner ' +
      "picks ONE of THIS build's spent cards, while it is still face up in its own discard " +
      '(`stillDiscarded`, shared with D5 and O17), and it goes straight into the barn through ' +
      "`fx.reclaimDiscard` - a plain placement, never a sow (v46 R8's language: reaching a stack " +
      'is a sow, reaching a barn is not). Mandatory (no "may"); the task offers nothing and is ' +
      "dropped when the Build could not happen or spent no card. D7 and D18 The Ledger's " +
      "successor both reach for the same spent cards; the resolved table's answer is that each " +
      'takes a DIFFERENT one, and when only one is left the turn player orders them (rule book ' +
      'v7, Card Notes) - this handler enforces nothing about that order itself, it only offers ' +
      'whichever spent cards are still in the discard when it is asked.\n' +
      '⚠️ THE SAME COUPLING D5 HAS, CARRIED FORWARD RATHER THAN FIXED. The follow-up is an ' +
      '`on.afterBuild` listener keyed on `event.src === self.card`, and `fireHook` (fx.ts) only ' +
      "calls a listener for a card it finds ON A TABLEAU - it walks every seat's `tableau` and " +
      'looks the card up there. Checked before choosing this shape: the generic `build` task ' +
      '(tasks.ts) and `doBuild` (actions/build.ts) thread only `src` through to `afterBuild`, ' +
      'with no `then`-style callback to chain a follow-up straight off `activate` instead - the ' +
      'kind `barnDiscardTask` (buildings.ts) offers for a barn discard has no equivalent on a ' +
      'Build. So if a FUTURE card discards THIS card from a hand and runs its activated line ' +
      'directly (A15 The Royal Apiary is that card, per tasks/v48-ambiguity-audit-v1.md R1/R6, ' +
      'not built in this pass), D7 will not be on any tableau when that Build resolves and this ' +
      'listener will never fire - the barn placement would silently not happen even though the ' +
      'Build itself did. Flagged for whoever builds A15 to open, not fixed here.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.src !== self.card) return;
      if (event.seat !== self.seat) return;
      if (event.payment.length === 0) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'reclaimSpent',
        riders: { spent: [...event.payment] },
      });
    },
  },
  tasks: {
    reclaimSpent: {
      answers(data, state, task) {
        const spent = stillDiscarded(data, state, task.riders.spent as CardId[]);
        if (spent.length === 0) return [];
        return spent.map((card) => ({ kind: 'card', payload: { card } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('reclaimSpent expects a card answer');
        fx.reclaimDiscard(task.pid, answer.payload.card as CardId);
        return true;
      },
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/** D8 The Abundant Shed - "Build. Draw 2." (v48: was "Build. Draw 1.") */
export const abundantShed: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "Alters THE REFILL, and it is Dairy's card-neutrality guarantee. Flat and unconditional " +
      'on purpose - it is the card you can always take, and without it a Dairy hand empties ' +
      'into the tableau and nothing else in the suit ever fires. ⚠️ THE DAIRY REBALANCE (v21, ' +
      '2026-08-12) CUT THE DRAW FROM 2 TO 1, and that sharpened the card rather than dulling ' +
      'it: at Draw 2 the guarantee was pay 1, draw 2, build, which was card-POSITIVE, and with ' +
      "the Barn's SHED rider and The Ledger on top, building through this card drew 5. At " +
      'Draw 1 it was pay 1, draw 1, build - EXACTLY card-neutral, which is what the guarantee ' +
      'was ever meant to be and the reason the suit no longer refunds its own core action.\n' +
      '⭐ v48 R14 (tasks/v48-rulings-v2.md, the Q9 ambiguity of tasks/v48-ambiguity-audit-v1.md): ' +
      'THE SHEET NOW PRINTS DRAW 2, AND DEAN SETTLED THE ORDER QUESTION IN FAVOUR OF THE FACE - ' +
      'Build, THEN Draw 2, PRINTED ORDER. The old reversal (Draw pushed first, so the build ' +
      'enumerated against the refreshed hand) existed only because Draw 1 made the card ' +
      'card-negative in printed order, "which kills it outright" - that reason is gone now the ' +
      'draw is 2 (card-positive either way), and the flag this note used to carry to Dean has ' +
      'been answered: he chose the printed order over the stronger, order-reversed card. THE ' +
      'DRAW IS UNCONDITIONAL (v47 R1, own act): it fires whether or not the Build could happen, ' +
      "the same shape as D6's gated draw and D11's refund. ⛔ THE OLD \"DO NOT TIDY THE ORDER " +
      'BACK" WARNING IS RETIRED, WITH A POINTER TO THIS RULING - the order the printed face ' +
      'gives is now the order this handler runs.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
    drawN(fx, self.seat, self.card, 2);
  },
};

/** D9 The Prosperity Wagon - "Build at a discount of 1 for each different crop among the buildings you have built." */
export const prosperityWagon: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "Alters THE PRICE, scaling: the tier's scaling noun, and the DAIRY REBALANCE (v21, " +
      '2026-08-12) REPOINTED WHAT IT SCALES ON. It was "1 for every 2 buildings you have ' +
      'built" - the ramp stated as arithmetic, which at the measured 12.02 buildings a seat ' +
      "was a discount of 6 and is innovation.md's constraint 2 in its purest form: a card that " +
      'paid you for owning more of YOURSELF, on the suit where the metric axis and the ' +
      'specialisation axis are already the same axis. It now counts DIFFERENT CROPS among the ' +
      'same buildings, so it pays variety instead of volume: it caps at 5 and realistically ' +
      'reads 2 to 3.\n' +
      '⭐ v48 R13 (tasks/v48-rulings-v2.md, 24/09/2026): THE NOUN IS NOW builtBuildingsAndPower ' +
      '(buildings.ts), and A POWER CARD COUNTS. Before this ruling, W19 The Wheat Exchange - ' +
      'which prints the same eleven words - read a DIFFERENT set, the whole tableau through ' +
      'cropOf, so the two cards genuinely counted different things (ruling M, ' +
      "outstanding-rule-changes.md). R13 closes that gap from both sides: this card's noun grew " +
      "to include Power cards and W19's noun shrank to exclude Endgame cards, and the two now " +
      'read the exact same set for the first time. Starters (the Notice Board included) and ' +
      'Endgame cards still never count on either card. The Wagon itself is a Tier 2 card and ' +
      'always counts, so it still opens at a discount of at least 1. The old chooseWorker task ' +
      'and its £2 rider are gone with the Hiring Fair; nothing in the suit works a Service.',
  },
  activate(fx, self) {
    // R13: builtBuildingsAndPower, which now agrees with W19's noun (see the
    // note above) rather than diverging from it.
    const crops = new Set(
      builtBuildingsAndPower(fx.data, fx.state, self.seat).map(
        (b) => cardById(fx.data, b.card).suit,
      ),
    );
    buildWith(fx, self.seat, self.card, { discount: crops.size });
  },
};

/**
 * D10 The Scout's Post - "Reveal the top card of any deck. You may build it at
 * a discount of 2." (v47 retext: was "Reveal the top card of each deck. You
 * may build 1 of them at a discount of 2.")
 */
export const scoutsPost: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      '⭐ v47: ONE DECK, CHOSEN FIRST, NOT EVERY DECK AT ONCE. The old face revealed the top of ' +
      'every live deck and offered a build against the lot; the new one asks which deck first - ' +
      'the `scoutDeck` task, reusing the deck-choice shape D15 The Grand Creamery used to open ' +
      "with (`creameryFlip`, retired below) - then reveals exactly that deck's top card into the " +
      'existing `scout` task, unchanged in shape but now over a REVEAL_RIDER of length 1. ' +
      "⛔ R3 (tasks/v47-rulings-v1.md), AGAINST THE AUDIT'S OWN RECOMMENDATION: A DECLINED OR " +
      'UNAFFORDABLE REVEAL IS DISCARDED, NOT RETURNED. The old `fx.returnToDeckTop` note (marked ' +
      '"RULING" in this file with no traceable source) is overturned outright: D10 now burns a ' +
      'deck top on every declined scout, which is the opposite of what "a free look" used to ' +
      'mean and turns the card into a mild, one-card-at-a-time deck-cycler. The chosen card still ' +
      'passes THROUGH THE HAND and is built by the shared doBuild, which is not a detour: it is ' +
      'what makes the build a real Build - a real price at a discount of 2, the Barn rider, The ' +
      'Ledger - rather than a second copy of the build code this suit exists not to have. The ' +
      "payment is enumerated by paymentOptions, which is buildOptions' inner half, because the " +
      'card being priced is not in the hand when the choice is offered.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'scoutDeck', riders: {} });
  },
  tasks: {
    /**
     * Which deck to reveal, blind, from any deck in play (v45 R5; rule book
     * v7: "any deck" always means the top card of a deck of your choice).
     * Auto-skips when nothing is live.
     */
    scoutDeck: {
      answers(data, state) {
        return liveDecks(data, state).map((suit) => ({ kind: 'card', payload: { suit } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('scoutDeck expects a card answer');
        const card = fx.takeDeckTop(answer.payload.suit as Suit);
        if (card === null) return true;
        fx.pushTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'scout',
          riders: { [REVEAL_RIDER]: [card] },
        });
        return true;
      },
    },
    scout: {
      answers(data, state, task) {
        const revealed = revealedIn(task);
        if (revealed.length === 0) return [];
        const out: TaskAnswer[] = [];
        // BY SLOT, never by id: this card is in limbo and no PlayerView
        // carries it, so an answer naming it would put the deck top into the
        // unredacted move list. See REVEAL_RIDER in state.ts.
        revealed.forEach((card, pick) => {
          for (const pay of paymentOptions(data, state, task.pid, card, { discount: 2 })) {
            out.push({
              kind: 'card',
              payload: {
                pick,
                payment: pay.payment,
                // R15: the meeple half of the payment, as a count per colour.
                ...(pay.meeples === undefined ? {} : { meeples: pay.meeples }),
                ...(pay.wildPairs === undefined ? {} : { wildPairs: pay.wildPairs }),
                // The Village Store coin half of the payment stood here and went
                // with the coin (16/09/2026).
              },
            });
          }
        });
        // "You may": declining is always available, and it is also what keeps
        // the task from being dropped with the reveal still in limbo.
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        const revealed = [...revealedIn(task)];
        const chosen: CardId | null = answer.kind === 'card' ? pickFromReveal(task, answer) : null;
        // Limbo emptied BEFORE the build, so nothing the build fires can find
        // the reveal still hanging on the task and act on it twice. The slot
        // has already been read into `chosen`, which is why the order works.
        task.riders[REVEAL_RIDER] = [];
        if (chosen !== null && answer.kind === 'card') {
          fx.cardsToHand(task.pid, [chosen]);
          doBuild(
            fx,
            task.pid,
            {
              card: chosen,
              payment: answer.payload.payment as CardId[],
              ...(answer.payload.meeples === undefined
                ? {}
                : { meeples: answer.payload.meeples as Partial<Record<Suit, number>> }),
              ...(answer.payload.wildPairs === undefined
                ? {}
                : { wildPairs: answer.payload.wildPairs as number }),
            },
            { discount: 2 },
            task.src,
          );
        } else if (revealed.length > 0) {
          // R3: declined, or nothing affordable even at the discount - burn it
          // to its crop's discard pile. Never back on the deck.
          fx.discard(revealed);
        }
        return true;
      },
    },
  },
};

/**
 * D11 The Heritage House - "Build. Draw 1 for each card you spent." (v47
 * retext: was "Build. Sow all the cards spent.")
 */
export const heritageHouse: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v47: NO LONGER A SOW AT ALL - a plain refund, one card drawn for each card the build ' +
      'spent. The `sowAnywhere` task, the reach into the discard for the still-there spent ' +
      'cards, and the whole `stillDiscarded` competition with D2 and O17 for the same pile all ' +
      'go: this card no longer touches the discard, it reads `event.payment` directly off its ' +
      'own afterBuild. The count is the cards paid FROM HAND for this build, after any discount ' +
      '(`event.payment.length`) - a card O17 diverted to the barn was still spent and still ' +
      'counts, a Worker is not a card and never counts, and a free build (D15 The Grand ' +
      'Creamery growing it) pays nothing and draws 0. Mandatory (no "may"), fires only on its ' +
      'own build (`event.src === self.card`), and needs no separate task: the draw is pushed ' +
      'straight off the afterBuild event, exactly as D8, D13 and D16 already do theirs. ' +
      '⚠️ THE OLD CARD WAS A HAND-CLOCK LAUNDERER (every spent card came straight back onto the ' +
      'board as a threshold step) and this one is the opposite shape: every spent card comes ' +
      'back into the HAND instead, which is card-neutral rather than card-positive, and reads ' +
      'much closer to D8 The Abundant Shed scaled by spend than to the old sow. \n' +
      '⚠️ THE BUILD-ON-TOP AND ITS `covered` ZONE STAY DELETED (19/08/2026) AND ARE UNRELATED TO ' +
      'THIS RETEXT: there is still nowhere for a buried card to live, and nothing here ' +
      'reintroduces one. See D14 and the registry test for the standing check.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.src !== self.card) return;
      if (event.seat !== self.seat) return;
      drawN(fx, self.seat, self.card, event.payment.length);
    },
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {});
  },
};

/** D12 The Butter Factory - "Build 2 buildings." */
export const butterFactory: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Alters THE COUNT: the pure multiplier, nothing stapled on. Two OPTIONAL builds, each ' +
      'independently skippable - "optional" rather than forced because a build task with ' +
      'nothing affordable would drop itself anyway, and a player who wants only one should be ' +
      'able to say so. The second is enumerated after the first resolves, so a card built by ' +
      'the first can pay for nothing and the hand it sees is the real one. ⚠️ EACH BUILD WAS ' +
      'AT A DISCOUNT OF 1 UNTIL THE DAIRY REBALANCE (v21, 2026-08-12) and both are now full ' +
      'price. This was the largest build-count multiplier in the suit and the discount made it ' +
      'nearly free; PAYING FULL PRICE TWICE OUT OF A HAND OF 5 IS THE NATURAL BRAKE, and it ' +
      'turns the card from a freebie into a real decision about whether the hand can stand it. ' +
      "Two builds still means TWO diversions - the Farmstead's count is per card spent, and " +
      'that is deliberately untouched, because keeping the diversion is what stops a ' +
      'discountless D12 becoming worthless. It now means ONE Ledger draw for a different ' +
      'reason than before: D16 moved to the general once-per-turn guard.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, {}, true);
    buildWith(fx, self.seat, self.card, {}, true);
  },
};

/** D13 The Cheese Vault - "Draw 1 for each building you built." */
export const cheeseVault: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The suit scaler, and after 19/08/2026 that is ALL it is: draw one card for every ' +
      'building you have built, threshold 2, wild activation, no rider of any kind. One ' +
      'ruling survives the simplification and it is the one that is easy to lose - THE DRAW IS ' +
      'NOT THE DRAW ACTION. It is a card ability, so the Orchard Farmstead modifier must not ' +
      'apply (DL-47), which drawN guarantees by pushing the printed numbers rather than ' +
      'routing through the action.\n' +
      '⚠️ THE CROSS-TABLE HALF IS DELETED (v30, group D + F, 19/08/2026) AND THE CARD LOST ITS ' +
      'ARGUMENT WITH IT. The old text was "Draw a card for every building you have built. Give ' +
      'any cards over your hand limit to other players, and take £1 from the bank for each", ' +
      'and the give-away was not a rider - it was the entire design: THE HAND LIMIT IS THE ' +
      'BRAKE, AND IT GROWS WITH THE PAYOUT, so every extra building converted one more of the ' +
      'draw from a card you keep into a card the village got. That intrinsic brake was also ' +
      'the reason it stayed an ACTION card rather than becoming a threshold-1 GROW. Both ' +
      'reasons are gone at once. The hand limit still models the ceiling - you cannot hold ' +
      'what you draw and the end-of-turn discard takes it - but it takes it to a DISCARD PILE ' +
      'instead of to a rival, so the card is now purely inward-facing, and Dairy is one ' +
      'cross-table card lighter. Watch the play rate: without the leak the payout is capped by ' +
      'hand size rather than by generosity, and a big farm draws a lot to keep very little. ' +
      '`crossPlayer` is false and `giftableSeats` is no longer called from here.\n' +
      '⚠️ IT IS A GROW CARD NOW (v30 group F, Dean 19/08/2026: "The concept of an ACTION was ' +
      'never requested. They are all GROW."). It printed no threshold and no activation type ' +
      'and offered a standing MOVE that WAS the main action; the sheet now gives it threshold ' +
      '2 and a wild activation, so it is paid for with a card like every other building and ' +
      'fires at most once a turn. The old seam justified itself on a measured number - a ' +
      'GROW-gated Tier 3 fired 0.63 times per card built against an action-gated one firing as ' +
      'often as its owner chose - and that number is not refuted, it is overruled. No arm is ' +
      'owed. `turn.actionSpent` is no longer set here: GROW is the action, and the grow ' +
      'runtime spends it.\n' +
      '⭐ v48 R13 (tasks/v48-rulings-v2.md, 24/09/2026): the noun is now ' +
      '`builtBuildingsAndPower` (buildings.ts) - a built Power card now draws too, on top of ' +
      'every Tier 1-3 building. Endgame cards and starters still do not.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, builtBuildingsAndPower(fx.data, fx.state, self.seat).length);
  },
};

/**
 * D14 The Cream Refinery - "Demolish one of your buildings. Place 3 deck cards
 * into your barn."
 */
export const creamRefinery: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Still the only card in the game that shrinks a tableau, and that is the reason to keep ' +
      'it in the suit at all - a Build deck needs one verb pointing the other way. But it is ' +
      'now a FLAT trade and no longer a scaling one: any building of yours off the table, ' +
      'three deck cards into your barn, whatever the building cost and whatever was on it. ' +
      'Starters may never be chosen (builtBuildings, the noun D9, D11, D20 and this card ' +
      'share). Its own card IS a legal target, which is the same one-shot line it always had: ' +
      'the Refinery refines itself. The three deck cards are chosen one deck at a time, ' +
      'revealed as they land, which is the Patisserie shape and the same deckToBarn task as ' +
      'before - only the count changed.\n' +
      '⚠️ IT LOST BOTH HALVES OF ITS PAYOUT ON 19/08/2026 AND IS NOW MUCH WEAKER (v30 balance ' +
      'flag 8.5). It used to read "Put one of your buildings, and every card on it, into your ' +
      'barn. For each cost of the building, add 1 deck card into your barn", so a 4-cost Tier ' +
      '3 with two cards on it was SIX barn cards plus the building itself as a seventh, all ' +
      'freight, and freight is about 80% of a winning score. Dean ruled on 19/08/2026 that the ' +
      'building goes TO THE DISCARD ALONG WITH ANY CARDS ON IT - neither becomes freight - and ' +
      'the payout is a FLAT 3. The same activation is therefore now: lose a building, lose its ' +
      'whole stack, gain 3. ⚠️ WATCH WHETHER ANYBODY BUILDS IT. It is entirely possible this ' +
      'card is now strictly worse than not activating it, and if the arm says so the dial is ' +
      'the flat number, not the destination - Dean chose the destination deliberately, and ' +
      'routing the stack back to the barn would restore the un-clog the card is no longer for.\n' +
      'VP behaviour needed no work and that is worth stating, because it looks like it should ' +
      'have: scoring reads `p.tableau`, a discarded building is not in it, so the demolished ' +
      "card's printed VP simply stops counting - which is what the old handler already did " +
      'when the building went to the barn. The `covered` pile that used to be the one exception ' +
      'to "not in the tableau means no printed VP" is gone with D11 (19/08/2026), so the rule ' +
      'now has no exceptions at all.\n' +
      '⚠️ IT IS A GROW CARD NOW (v30 group F, Dean 19/08/2026: "The concept of an ACTION was ' +
      'never requested. They are all GROW."). Threshold 1, wild activation, off the sheet. ' +
      '`turn.actionSpent` is no longer set here - GROW is the action - and the standing move ' +
      'is gone, so `addsMoves` is false. ⚠️ Anti-synergy with D20 The Counting House is ' +
      'unchanged and deliberate: that card pays for buildings and this one destroys them.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'refine', riders: {} });
  },
  tasks: {
    refine: {
      answers(data, state, task) {
        return builtBuildings(data, state, task.pid).map((card) => ({
          kind: 'card',
          payload: { card },
        }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('refine expects a card answer');
        const building = answer.payload.card as CardId;
        // Dean, 19/08/2026: the stack goes to the DISCARD with the building,
        // not to the barn. The order is still load-bearing and for the same
        // reason it always was - fx.demolish asserts an empty stack, and that
        // throw is what stops these two lines being swapped unnoticed.
        fx.discardStack(task.pid, building);
        fx.demolish(task.pid, building);
        for (let i = 0; i < REFINERY_DECK_CARDS; i++) {
          fx.pushTask({ t: 'card', pid: task.pid, src: task.src, kind: 'deckToBarn', riders: {} });
        }
        return true;
      },
    },
    deckToBarn: {
      answers(data, state) {
        return liveDecks(data, state).map((suit) => ({ kind: 'card', payload: { suit } }));
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('deckToBarn expects a card answer');
        fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
        return true;
      },
    },
  },
};

/**
 * D15 The Grand Creamery - "Build a card from your hand for free." (v47
 * retext: was "Reveal 2 deck cards. Build 1 for free. Discard the other.")
 */
export const grandCreamery: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "⭐ v47: NO REVEAL, NO GAMBLE - a free Build off the OWNER'S OWN HAND, any card they " +
      'hold, Power and Endgame included. `creameryFlip`, `creameryPick` and the `CREAMERY_REVEALS` ' +
      'constant all go with the old two-deck-tops look (tasks/v47-ambiguity-audit-v1.md, the D15 ' +
      'row of "Resolved from the printed words or a standing ruling": "creameryFlip, creameryPick ' +
      'and CREAMERY_REVEALS all go"); the deck-choice SHAPE they used is not lost, it moves to ' +
      "D10 The Scout's Post as `scoutDeck`, per the housekeeping note in tasks/v47-rulings-v1.md. " +
      'THE GAMBLE IS GONE and so is the deck-cycling pressure the old face put on the table - ' +
      'this card no longer touches a deck at all. What survives is the still the only card in ' +
      'the suit that turns an activation into a building at NO CARD COST: `buildWith` under a ' +
      '`FREE_BUILD_DISCOUNT` big enough to zero every printed cost waives BOTH halves of `priceOf` ' +
      '- the card count AND the n-of-suit minimum, because any positive discount already zeroes ' +
      '`ownSuitMin` (see `priceOf` in actions/build.ts) - which is exactly how "for free" reads: ' +
      'there is nothing left to make up. It goes through the ordinary `build` task and `doBuild`, ' +
      'not a bespoke landing, so every afterBuild reactor still fires (D16 The Ledger draws) and ' +
      'fires against an EMPTY payment (`event.payment` is `[]`), which is what keeps D5 and D11 ' +
      'silent on a Creamery-built card - both already guard on a non-empty payment. ' +
      'Mandatory (no "may"): with any card in hand, one must be built; an empty hand does ' +
      'nothing, which is the ordinary auto-skip a `build` task with no options already gives. ' +
      '⚠️ IT IS A GROW CARD (v30 group F, Dean 19/08/2026: "The concept of an ACTION was never ' +
      'requested. They are all GROW."), at threshold 1 with a wild activation off the sheet - so ' +
      'the free build is paid for with the card that grows it, and the card is card-neutral ' +
      'rather than card-free. `turn.actionSpent` is not set here; GROW is the action.',
  },
  activate(fx, self) {
    buildWith(fx, self.seat, self.card, { discount: FREE_BUILD_DISCOUNT });
  },
};

/** D16 The Ledger - "Whenever you Build, Draw 1." */
export const ledger: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'The load-bearing Power card of the suit, at 59% play, and as of 19/08/2026 it has no ' +
      'guard at all: every building that lands in your tableau draws you a card. Owner-scoped, ' +
      "never a rival's. A card-ability draw, so no Orchard modifier (DL-47). It fires PER " +
      'BUILDING and not per Build action, because the hook is afterBuild and afterBuild fires ' +
      'once per card placed - which is now the same reading D17 The Strongbox has always had, ' +
      'so the two reactors on this suit finally agree.\n' +
      '⚠️ "ONCE PER TURN" CAME OFF THE SHEET ON 19/08/2026 (v30 group A) AND THIS IS A REAL ' +
      'POWER INCREASE, NOT A TIDY-UP. The history is worth keeping because the guard was ' +
      'argued twice. The first ruling (2026-08-10) was once per Build ACTION, read off ' +
      'turn.buildSources, precisely so The Grand Creamery could not draw four and The Butter ' +
      'Factory two. The second (Dairy rebalance, 2026-08-12) moved it onto the general rule ' +
      "adopted the day after by the Apiary rebuild - NO CARD'S TEXT MAY FIRE TWICE IN A TURN, " +
      'turn.firedThisTurn - and the sheet printed "Once per turn." to match. Both of those ' +
      'existed to stop exactly the interaction the card now permits: D12 The Butter Factory ' +
      'builds twice and draws twice, and D15 The Grand Creamery builds free and draws for it. ' +
      '⚠️ THIS IS BALANCE FLAG 8.4 OF THE v30 PLAN and it is owed a simulator arm, ' +
      '`d16-ledger-uncapped`: an unbounded draw faucet, on the Build suit, sitting beside D15 ' +
      'which builds for free and, since v47, D11 which draws again for the same build (Draw 1 ' +
      'per card spent, rather than sowing it). Cards are the master clock of the game and this ' +
      'is now the cheapest way to print them. ' +
      'If the arm reads badly the dial is the sheet text, not a private counter here.\n' +
      '✅ THE GENERAL RULE STILL WORKS FOR EVERY OTHER CARD. This card is simply no longer a ' +
      'member of turn.firedThisTurn, and nothing else about that list moved: runtime.ts is ' +
      'still its one writer (markFired), growOptions still filters on it, and the check that ' +
      'made a Power card safe to put in it - growOptions also requires activationType !== ' +
      'null, which a Power card has not got - is now moot here rather than wrong.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      // No guard, by design (19/08/2026). D12's pair and D15's free build both
      // pay out in full; see the notes for the two rulings this replaces and
      // the arm that is owed on it.
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** D17 The Strongbox - "When you build a card that is not Dairy, Draw 1." */
export const strongbox: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⛔ ITS SCOPE FLIPPED FROM RIVAL TO OWNER, AND THE HANDLER HAD NOT FOLLOWED. The card ' +
      'this file implemented was "whenever a NEIGHBOUR Builds, take £1" - the "materials ' +
      'yard", the purest statement of the suit paying you for the village building rather ' +
      'than for building yourself, and the one number flagged as most likely wrong in the ' +
      'whole suit (up to £10 a game for £2, where seats ended on £1). The sheet has printed ' +
      '"When you build a card that is not Dairy" since v30 and the engine was still running ' +
      'the older text; v31 converts the coin to a draw and this pass follows the print on ' +
      'both halves at once. ' +
      '⚠️ SO THE SUIT LOST ITS SECOND CROSS-TABLE CARD IN ONE EDIT. crossPlayer goes FALSE. ' +
      'With D2 now an end-game scorer and this owner-scoped, Dairy touches another seat in ' +
      'exactly one place: D6 The Trading Shed. That is worth recording as a loss to the hook ' +
      "rather than as a tidy-up - and it is a straight instance of the Innovation lens's " +
      'standing warning, an outward-pointing card replaced by an inward-pointing one. ' +
      '⚠️ WHAT IT PAYS FOR NOW IS ANTI-MONOCULTURE, which is the one thing in its favour: ' +
      'it fires only on a NON-Dairy build, so it pulls against the Farmstead and against the ' +
      'own-suit Power price, and it is one of the few lines in v31 pointing that way. It ' +
      "reads the built card's printed suit, so a starter can never trigger it (starters are " +
      'never built) and a foreign Tier 3 in a Dairy tableau always does. ' +
      '⚠️ IT FIRES PER BUILDING, NOT PER BUILD ACTION, which is unchanged and is the same ' +
      'reading D16 The Ledger has: a Grand Creamery run that lands four foreign cards pays ' +
      'this four times.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (cardById(fx.data, event.card).suit === 'dairy') return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** D19 The Cheese Hall - "Game end: 1 VP for each non-Dairy building you have built." */
export const cheeseHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The most important of the three endgame cards, because it is the one card in the suit ' +
      "that pays OUTWARD - and the Innovation lens's sharpest finding is that our suit is our " +
      'specialisation is our metric. It reads much better since The Grand Creamery started ' +
      'handing out free buildings off every deck, almost none of them Dairy. Not the complement ' +
      'of a Dairy count: a base starter prints the starting-building icon, so it is neither a ' +
      'Dairy building nor a non-Dairy one and scores nothing either way, which also stops this ' +
      'card penalising a Dairy seat for upgrading. A D14-demolished card is not in the tableau ' +
      'and never counts; neither, until 19/08/2026, was a D11-covered one, and that clause is ' +
      'retired with the zone rather than being wrong.\n' +
      '⭐ v48 R13 (tasks/v48-rulings-v2.md, 24/09/2026): THE NOUN IS NOW builtBuildingsAndPower ' +
      "(buildings.ts), FILTERED TO A FOREIGN SUIT, IN PLACE OF query.ts's `foreignCropBuildings` " +
      '- a Power card of some OTHER suit now scores here too (a built Power card of your own ' +
      'suit still does not, same as a Tier 1-3 card of your own suit never has). Endgame cards ' +
      'of any suit still never count: `foreignCropBuildings` never excluded them (it read the ' +
      'whole tableau, "not a starter" its only gate), so this is a real narrowing as well as a ' +
      'widening, and it is why this card no longer reads that query.ts helper. `foreignCropBuildings` ' +
      'itself is UNCHANGED and UNTOUCHED - editing query.ts is outside this pass - and is now an ' +
      'orphan with no caller left in the engine.',
  },
  gameEnd(data, state, seat) {
    return builtBuildingsAndPower(data, state, seat).filter(
      (b) => cardById(data, b.card).suit !== 'dairy',
    ).length;
  },
};

/** D20 The Counting House - "Game end: 1 VP for every 2 buildings you have built." */
export const countingHouse: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE SIZE OF THE FARM. It replaced "build cost of 4 or more", which under the compressed ' +
      'ladder counted only the three Tier 3s. "You have built" is the shared count: the three ' +
      'starters arrive pre-built and nobody built them, and a demolished one has gone to the ' +
      'discard (Dean, 19/08/2026 - it used to be barn stock). The third clause this note used ' +
      'to carry, that a covered card is not a building either, is retired with the `covered` ' +
      'zone on the same date. ⚠️ THE DIVISOR IS 2 AS OF THE DAIRY REBALANCE (v21, ' +
      '2026-08-12); it was a flat count per building and measured the HIGHEST-SCORING SINGLE ' +
      "CARD IN THE GAME at 3.6 VP. innovation.md's divisor rule is the reasoning: the divisor " +
      "rises with the metric's abundance, and Dairy's build count is 2.4x the field's. ⚠️ It " +
      'was also WORD FOR WORD W20 The Grand Granary, and the divisor resolves that too: W20 ' +
      'KEEPS the flat count, honestly, because Wheat builds about 5 and 5 VP is not 12. So ' +
      'the two cards no longer print the same sentence and the cross-suit duplicate is closed ' +
      'here rather than deferred to the five-suit pass. ⚠️ Anti-synergy with D14, ' +
      'deliberately: this pays for buildings and the Refinery destroys them - now at half the ' +
      'rate, so the Refinery is a slightly easier call.\n' +
      '⭐ v48 R13 (tasks/v48-rulings-v2.md, 24/09/2026): the noun is now `builtBuildingsAndPower` ' +
      '(buildings.ts) - a built Power card now counts too, and this card and W20 still share ' +
      'exactly one noun between them (both read the same helper now), the divisor the only ' +
      'difference. Starters and Endgame cards still never count on either.',
  },
  gameEnd(data, state, seat) {
    return Math.floor(builtBuildingsAndPower(data, state, seat).length / 2);
  },
};

/**
 * D21 The Refinery - "Game end: 3 VP for each 3VP building you have built."
 * (v42; was 2 VP for each SHED.)
 */
export const refinery: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v42: 3 VP for each building you have built whose PRINTED VP is exactly 3, of any ' +
      'suit (`builtBuildingsWorth`, buildings.ts). Buildings only, never a Power or Endgame ' +
      'card, never a starter. One of a family with A20 (1VP buildings) and O20 (2VP ' +
      'buildings). The SHED count below is history. ' +
      '⛔ REPLACED (v31, plan section 3.2). It read "2 VP for each of your starters showing ' +
      'its upgraded side" and lost its referent outright: there are no upgraded faces left ' +
      'to show. The replacement fills the one gap in an existing set - A20 scores HIVEs, ' +
      'O20 ORCHARDs, V20 DEPOTs, W21 FIELDs, and Dairy had no SHED scorer - so the five ' +
      'Endgame trios are symmetrical for the first time. ' +
      '⚠️ THE CARD IT REPLACES WAS ITSELF A REPLACEMENT FOR THIS ONE, on 2026-08-12, and ' +
      'the reasoning that moved it away is the reasoning to watch now that it is back: ' +
      '"2 VP for each own-suit noun" pays most on the suit that builds most, and Dairy built ' +
      '12.02 buildings a seat against a field of about 5. SHED is D4-D8, five cards, so the ' +
      'ceiling is 10 VP - the same ceiling A20 and O20 carry, on a suit that reaches it more ' +
      'often. If the arm reads Dairy hot at game end, this is the card and the dial is the ' +
      'rate. ' +
      '⛔ It counts SHEDs and NOT starters, so `isShedCard` is the whole of it - the reverse ' +
      'of the note this card used to carry, which existed to warn that `builtBuildings` ' +
      'excludes starters and would have scored the old text 0 forever. A demolished SHED ' +
      '(D14) has left the tableau and stops counting, which is the cost of demolishing.',
  },
  gameEnd(data, state, seat) {
    return 3 * builtBuildingsWorth(data, state, seat, 3);
  },
};
