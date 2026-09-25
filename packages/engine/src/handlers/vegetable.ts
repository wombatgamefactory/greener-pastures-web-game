/**
 * Vegetable handlers - all 21 cards, REBUILT (docs/vegetable-suit-rebuild-v4.md,
 * docs/handoff-vegetable-engine-build.md). Card texts are quoted from cards.json
 * (the sheet is the single source of truth for wording).
 *
 * ⭐ SHEET v42 (16/09/2026, Dean's R8): VEGETABLE IS THE BARN SUIT, and its
 * texts are locked for the next playtest. Every handler below follows the v42
 * text; the implementation notes and builder defaults are those of
 * `docs/vegetable-token-island-handoff-2026-09-16-v1.md` §3 and §5. The
 * balloons, the suit's old second outlet, were deleted the same day (R1).
 *
 * Structural things this suit brought to the engine:
 *
 *   1. **The island's tokens are MUTABLE**, though nothing in the shipped game moves them any
 *      more. V5 used to swap two of them between two island cards (the token island,
 *      16/09/2026: each token keeps its VP and its Worker). Engine seams: `tokenSwapOptions` and
 *      `fx.swapIslandTokens`. ⛔ RETIRED ON SHEET v47 (22/09/2026): V5 is now a bare Deliver with
 *      one wild card and was the only producer of a swap. Kept as an orphan, not deleted, per
 *      the v47 housekeeping decision (`tasks/v47-rulings-v1.md`).
 *   2. **One delivery may take EVERY receipt a tile has left** (V14), which is
 *      `doDeliver`'s `takeAll` choice: pay the same 4 cards once and take both
 *      tokens, or the last one.
 *   3. **"Discard a card from your Barn"** (V8, V15 only, since sheet v45 -
 *      19/09/2026): one shared step, `barnDiscardTask` in buildings.ts,
 *      through `Fx.discardFromBarn`, which fires the `afterBarnDiscard` hook.
 *      ⛔ R6: a delivery payment is never a barn discard, and V14's demolition
 *      is not one either. ⚠️ V10 and V12 used to share this step and no
 *      longer do (v45): both now only COUNT the barn, never spend it (R1,
 *      R4). V8 and V15 are the hook's only listeners now; V17 moved off it
 *      onto `beforeTurnEnd` the same day (item 8 below).
 *   4. **A barn card into the hand** (V6): `Fx.barnToHand`, by crop. ⛔
 *      SUPERSEDED ON SHEET v46 (R5-R7): V6 no longer touches the hand at all -
 *      it swaps BARN <-> DECK now (`Fx.discardFromBarn` / `Fx.deckTopToBarn`).
 *      See the v46 addendum below. ⭐ RETEXTED AGAIN ON SHEET v47 (R4): the
 *      same two primitives, now sequenced discard-both-then-add-both rather
 *      than interleaved, with R6's all-or-nothing gate unchanged.
 *   5. **A card off a building into the barn without a harvest** (V11):
 *      `Fx.stackCardToBarn`, which already existed. ⛔ SUPERSEDED ON SHEET v46
 *      (R1-R4): V11 is a REAL Harvest now, through `fx.harvest`, not a move.
 *      See the v46 addendum below.
 *   6. **A board power by crop without a visit** (V12): `fireNoticeBoardPower`
 *      (workers.ts), which places no card, fires no `afterVisit` and latches no
 *      board, so it is no visit: no fee, and no W17, O16 or A17. ⭐ v45: the
 *      power is FREE (R4) - the barn only names which suits are on offer, and
 *      nothing is discarded to pay for it.
 *   7. **Receipts by crop and value** (V19, V20, V21; W21 in wheat.ts).
 *   8. **An end-of-turn condition on a small Barn** (V17, v45; loosened to "3
 *      or fewer" on v46, R11.3-R11.4): a second listener on `beforeTurnEnd`
 *      (fx.ts), the hook `finishTurn` (turnflow.ts) already fires once a
 *      turn, for O18 A Helping Hand.
 *
 * ⛔ THE DEPOT SUB-TYPE IS GONE FROM THIS FILE (v42). V12 and V20 were its only
 * readers and neither prints the word any more; v41 took the building nouns off
 * the card text.
 *
 * THE ACTION CARD IS GONE (19/08/2026, Dean: "The concept of an ACTION was never
 * requested. They are all GROW."). V13, V14 and V15 used to be the suit's three
 * standing-move ACTION cards - no threshold, no activation type, one `cardMove`
 * whose `applyMove` set `turn.actionSpent` before it did anything else. They are
 * now ordinary owner-activated buildings, all three with a wild activation
 * type, so a GROW pays one card of ANY crop into the stack and the printed
 * ability fires from `activate`. ⚠️ The sheet gave all three threshold 1 at
 * first; v45 (19/09/2026) raised V13 and V15 to threshold 2, leaving V14
 * alone at 1. Nothing in this file spends the
 * action any more - GROW *is* the action and the grow runtime books it - and
 * `actionMoves`, `actionMove` and `actionOpen` have left the file with it.
 *
 * Two consequences are easy to miss and worth writing down. A Tier 3 card is now
 * CLOGGABLE like every other building: one card on it and it is full until its
 * owner spends an action harvesting, so the suit's three biggest effects are
 * once-per-harvest-cycle rather than once-per-turn. And each of them now costs a
 * card as well as the action, which is a price the ACTION shape never paid - so
 * the conversion is a nerf on tempo even where the printed text got stronger.
 *
 * ⭐ SHEET v45 (19/09/2026, Dean's rulings R1-R5, `tasks/v45-rulings-v1.md`):
 * eight faces move. V6 draws 2 instead of 1. V10 is completely retexted - no
 * more discard, no more per-crop plain action: it counts the barn by crop and
 * draws that many cards of each crop, mandatory and uncapped, off a barn left
 * exactly as it was (R1-R3). V12 is completely retexted too: the barn only
 * NAMES a suit whose Notice Board power you may take, for FREE, nothing
 * discarded (R4). V16 keeps its behaviour outright - "any deck card" was
 * already "the top card of a deck of your choice" (R5) - only its printed
 * words moved. V17 is completely retexted, from "draw 1 whenever you discard
 * a barn card" to "if your Barn is empty at the end of your turn, place a
 * deck top card into it" (also R5), so it moves off `afterBarnDiscard` onto
 * `beforeTurnEnd`. V11, V13 and V15 gain a threshold only - 2 to 3, 1 to 2
 * and 1 to 2 respectively - with no change to any printed effect; V12's
 * threshold also rises, 2 to 3, alongside its retext.
 *
 * ⭐ 20/09/2026: TWO KNOBS PUT THE OLD V10 AND V17 BACK, to measure how much
 * of the reference-v21 barn glut (+1.3, against about +0.5 on every earlier
 * version) is these two cards' v45 retexts rather than the rest of the pass.
 * `rules.economy.supplyHouseBarnDrain` (default false) restores V10's old
 * "discard up to 2 from your Barn, then the base action of each crop
 * discarded" - `pushPlainAction` is BACK, no longer deleted, called only
 * when the knob is true. `rules.economy.dockworkersUnionDrawOnDiscard`
 * (default false) restores V17's old `afterBarnDiscard` listener alongside
 * its new `beforeTurnEnd` one, the two mutually exclusive on the knob. Both
 * default to the shipped v45 behaviour, so the default game does not move;
 * both true together is the paired arm, overlays/pre-v45-barn-drains-v1.overlay.json.
 *
 * ⭐ SHEET v46 (20/09/2026, Dean's rulings R1-R4 and R5-R7,
 * `tasks/v46-rulings-v1.md`; R11.2-R11.4 for V15 and V17): three more faces
 * move, and one of them is a full rewrite into a shape this file has never had.
 *
 *   - **V11 The Market Master is now a REAL HARVEST**, not the single-card
 *     `Fx.stackCardToBarn` move it was on v42/v45. For each DISTINCT suit in the
 *     barn (snapshotted once, at activation, through the same `barnTally` V10
 *     and V12 already read) the owner Harvests ONE of their buildings printing
 *     that suit - the whole stack, through `fx.harvest`, the identical
 *     primitive `doHarvestAction` (actions/harvest.ts) uses for the plain
 *     Harvest action, so every on-harvest hook fires exactly as it would for an
 *     ordinary Harvest: `afterHarvest`, W16 The Granary, W18 A Helping Hand, any
 *     card's own When-Harvested text. It is routed through the engine's own
 *     generic `chooseBuilding` task (`filter: 'full', then: 'harvest'`) rather
 *     than a bespoke `card` task, which is what makes reusing `fx.harvest`
 *     free: the task type already resolves through it. Matching now reads the
 *     printed `suit` field straight off `cardById`, NOT `cropOf` - `cropOf`
 *     answers null for every starter including the Notice Board (by design, for
 *     the crop scorers), and R2 puts the Notice Board back in scope at 3+
 *     cards, never below. No bespoke Notice Board exclusion is written for this
 *     card any more - the ordinary `isHarvestable` gate `chooseBuilding`'s
 *     `'full'` filter already reads is S8-aware and does the work by itself.
 *   - **V6 The Trade Depot swaps BARN <-> DECK now, not HAND <-> BARN** ("Swap 2
 *     cards between your Barn and any Deck, then Draw 2"), and "up to" is gone:
 *     it is exactly 2 or nothing, checked once before anything moves. The
 *     outgoing card goes through `Fx.discardFromBarn` (the same `barnDiscarded`
 *     event V8/V10/V12/V15 fire) and the incoming card through
 *     `Fx.deckTopToBarn` (the V4/A8/A13/V16/V17 shape) - nothing is ever placed
 *     into a deck.
 *   - **V17 The Dockworker's Union's threshold loosens from "Barn is empty" (0)
 *     to "Barn has 3 or fewer cards"** (R11.3/R11.4; the sheet prints "3 of
 *     fewer", read as "3 or fewer"). The `beforeTurnEnd` listener and its
 *     dry-table guard (`drawableSuits(...).length === 0`, the fix for the
 *     19/09/2026 crash) are otherwise untouched and sit in the same order.
 *   - **V15 The International Port's build cost drops to 2 suit + 1 wild**
 *     (R11.2), a `cards.json`-only change with no handler to touch: `buildCost`
 *     is read generically off the card by `actions/build.ts`, and nothing in
 *     this file or `workers.ts` pins the old number.
 */

import type { GameData, Suit } from '@gp/data';

import {
  barnTally,
  deliverOptions,
  doDeliver,
  placeBuilt,
  vegetableBoardCanDeliver,
} from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player } from '../query.js';
import type { CardId, DoorAction, GameState, Receipt, Seat, TaskAnswer } from '../state.js';
import { doorActionOf, fireNoticeBoardPower } from '../workers.js';
import {
  barnDiscardRiders,
  barnDiscardTask,
  deckToBarnTask,
  drawFromCropDeck,
  ownBuildings,
} from './buildings.js';
import { barnCropScorer, farmsteadHandler } from './farmstead.js';
import type { CardHandler } from './types.js';

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** Decks on the table with cards left - V13's "that crop's deck". */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/**
 * Push a "discard N cards from your Barn" step (see `barnDiscardTask`); `upTo`
 * makes it optional. Nothing is pushed on an empty barn.
 */
function pushBarnDiscard(
  fx: Fx,
  self: { seat: Seat; card: CardId },
  n: number,
  upTo: boolean,
): void {
  if (player(fx.state, self.seat).barn.length === 0) return;
  fx.pushTask({
    t: 'card',
    pid: self.seat,
    src: self.card,
    kind: 'barnDiscard',
    riders: barnDiscardRiders(n, upTo),
  });
}

/**
 * ⭐ THE PLAIN ACTION OF A CROP: wheat Harvest, vegetable Deliver, orchard
 * Draw 2, apiary GROW, dairy Build - the Worker mapping. It reads the roster
 * through `doorActionOf` and maps the Apiary's `sow` to a Grow
 * UNCONDITIONALLY: `meepleActionOf` makes the same mapping only under
 * `meepleSpendTiming: 'afterAction'`, which is a Worker knob and not a card's
 * business. Deliberately not `performDoorAction`, which emits `doorUsed` and
 * fires `afterWork` as a door or Worker use.
 *
 * ⚠️ WAS UNCALLED SINCE SHEET v45 (19/09/2026): this was V10 The Supply
 * House's "base action" mapping, and its only caller (`pushPlainAction`) was
 * deleted the same day when V10 was retexted to a plain per-crop draw
 * (R1-R3). ⭐ 20/09/2026: `pushPlainAction` is BACK, restored below behind
 * `rules.economy.supplyHouseBarnDrain`, to measure how much of the
 * reference-v21 barn glut V10's drain removal is responsible for
 * (overlays/pre-v45-barn-drains-v1.overlay.json). `plainActionOf` therefore
 * has a live caller again, conditionally.
 */
export function plainActionOf(data: GameData, crop: Suit): DoorAction {
  const action = doorActionOf(data, crop);
  return action === 'sow' ? 'grow' : action;
}

/**
 * Queue the plain action of a crop for `seat`, as granted by the card `src`.
 * ⭐ RESTORED 20/09/2026 behind `rules.economy.supplyHouseBarnDrain` (the arm
 * in overlays/pre-v45-barn-drains-v1.overlay.json): this is V10 The Supply
 * House's pre-v45 tail, quoted verbatim from `git show e6b459c` rather than
 * rewritten from the card text, so the old-value arm really is the old game.
 */
function pushPlainAction(fx: Fx, seat: Seat, src: CardId, crop: Suit): void {
  const action = plainActionOf(fx.data, crop);
  switch (action) {
    case 'draw': {
      const { see, keep } = fx.data.rules.turn.baseDraw;
      fx.pushTask({ t: 'draw', pid: seat, src, see, keep, revealed: [] });
      return;
    }
    case 'harvest':
      fx.pushTask({ t: 'chooseBuilding', pid: seat, src, filter: 'harvestable', then: 'harvest' });
      return;
    case 'grow':
      fx.pushTask({ t: 'grow', pid: seat, src });
      return;
    case 'build':
      fx.pushTask({ t: 'build', pid: seat, src });
      return;
    case 'deliver':
      fx.pushTask({ t: 'deliver', pid: seat, src });
      return;
    case 'sow':
      // Unreachable: `plainActionOf` maps it away. Kept so the switch stays total.
      fx.pushTask({ t: 'grow', pid: seat, src });
      return;
    default:
      return action satisfies never;
  }
}

/** A seat's receipts (the token island, R7). */
function receiptsOf(state: GameState, seat: Seat): readonly Receipt[] {
  return player(state, seat).receipts;
}

/**
 * V1 Barn (starter) - v42: "Game end: 1 VP for each Vegetable card you have
 * built." (the own-crop scorer, `barnCropScorer`; see below). Before v42 it
 * printed nothing (v31), and the history of that is kept here.
 *
 * ⛔ Both lines went: the hand size with the hand limit itself, and the build
 * rider ("When you build a DEPOT, Draw 2") with the other four. It mattered more
 * here than anywhere else - the hand is what this suit is short of - so losing
 * it was the single biggest change to Vegetable in v31. The upgraded face's freight refund had already gone on 19/08/2026,
 * taking the suit's only use of the reclaimDiscard primitive with it; O17 The
 * Fruit Basket is the primitive's caller now. *
 * ⭐ THE HAND LIMIT CAME BACK ON 02/09/2026 AND THIS CARD DID NOT. The
 * reinstated limit is a flat 12 for everybody, in `rules.turn.handLimit` and
 * on the player aid; the Barn stays blank. A rule that applies to every seat
 * is not a card value, which is the whole difference between the old shape and
 * the new one - so nothing here should be un-deleted.
 */
export const vegetableBarn: CardHandler = {
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
   * (S1, Dean 10/09/2026): *"Game end: 1 VP for each Vegetable card you have
   * built."* Under that rejig each starter does exactly one thing - the Notice
   * Board prints your suit's power and holds the visit fees, the Barn holds
   * your harvested cards and prints this line, and the Farmstead holds six
   * island receipt tokens and prints nothing at all.
   *
   * ⚠️ AND IT IS SILENT IN EVERY OTHER GAME. `barnCropScorer` answers 0
   * unless `rules.turn.visitCurrency` is `'noticeBoardPower'`, so the shipped
   * commons, the v31 control and the meeple controls all score exactly as they
   * did - the Farmstead keeps the line. The two are gated by the
   * same predicate from opposite sides, so the term can never be scored twice
   * or dropped.
   */
  gameEnd: barnCropScorer('vegetable'),
};

/**
 * V2 Farmstead (starter) - "Game end: 1 VP for each Vegetable card you have
 * built."
 *
 * ⛔ THE DELIVERY HEAD IS GONE (v31), and with it `deliverHeadSize`,
 * `deliverDeckHead`, `deckHeadCandidates`, `headCandidates`, `withHead` and the
 * `head` / `deckHead` fields on every deliver option, move and task answer. It
 * read "When you Deliver, you may FIRST put 1 card from your hand into your
 * barn".
 *
 * TWO THINGS IT TAUGHT ARE WORTH CARRYING, because the next card that touches a
 * delivery will meet both. THE WORD "FIRST" WAS THE WHOLE CARD: until 2026-08-09
 * it fired on `afterDeliver`, so the card it moved could not help pay for the
 * delivery that triggered it - you had to already be able to deliver in order to
 * earn the fuel for the next delivery, which is a circle, and it is why the card
 * was worth 1.5 VP a game in a suit that needed four. A suit power belongs
 * UPSTREAM of that suit's bottleneck. And A HEAD HAD TO RIDE ON THE ANSWER
 * rather than be re-derived at resolution, because it was frequently the only
 * reason the payment was affordable.
 *
 * ⚠️ A stopgap `deckToBarn` task briefly lived in this handler, firing off
 * `afterDeliver`, and was deleted the same day for the circle above. If a future
 * pass is tempted to put a head back on a hook, that is why it cannot be.
 */
export const vegetableFarmstead: CardHandler = farmsteadHandler('vegetable');

/**
 * V3 Notice Board (starter) - v42: "Deliver - 2 of the cards may be any crop.
 * If you cannot, put 2 cards from your hand into your Barn." Threshold `3+`.
 * The power is engine-level (`fireNoticeBoardPower`, workers.ts, R9); this
 * handler has no behaviour of its own.
 */
export const vegetableNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the fee landing, the `3+` harvest minimum and the power are all ' +
      'engine-level. The power is v42\'s "Deliver - 2 of the cards may be any crop. If you ' +
      'cannot, put 2 cards from your hand into your Barn." (R9, `vegetableWildCards` and ' +
      '`vegetableFallback`), so the board is never dead: a seat that cannot pay a delivery ' +
      'even with the relaxation takes the fallback. ' +
      '⛔ Its coin payoff and its hand-card-into-the-barn rider are both gone (v31).',
  },
};

/**
 * V4 The Market Stall Depot - RETEXTED ON SHEET v48 (24/09/2026, `tasks/v48-rulings-v2.md` R10,
 * builder default): "If your barn has 3 or fewer cards, place a card from your hand into your
 * barn." (was "...place a deck card into your barn.")
 *
 * ⭐ THE SOURCE MOVES FROM THE DECK TO THE HAND. It is now the same plain hand-to-barn act W4 and
 * V9 already print (`handToBarn`), not a deck pick, so `deckToBarnTask` and the dry-table guard
 * leave this card entirely (they are still shared by other users in this file). The barn size is
 * read ONCE, at activation, after the GROW payment has landed on this card (a payment goes on the
 * stack, never in the barn, so it cannot move the count). A barn of 4 or more does nothing at
 * all. Otherwise one mandatory `handToBarn` task, `remaining: 1`: the owner picks which hand card
 * goes into the barn. An empty hand offers no answer and the task auto-skips (the same shape as
 * W4's harvest tail), which is the only way this can do nothing on a barn of 3 or fewer.
 */
export const marketStallDepot: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The barn size is read ONCE, at activation, after the GROW payment has landed on this ' +
      'card. A barn of 4 or more does nothing at all. Otherwise one mandatory `handToBarn` ' +
      'task (`remaining: 1`), the W4/V9 hand-to-barn shape: the owner chooses which hand card ' +
      'lands in the barn. An empty hand offers no answer and the task auto-skips. ' +
      "RETEXTED ON SHEET v48: the source moved from a deck top to a hand card of the owner's " +
      'choice; the old `deckToBarn` task and its dry-table guard left this card.',
  },
  activate(fx, self) {
    if (player(fx.state, self.seat).barn.length > 3) return;
    fx.pushTask({ t: 'handToBarn', pid: self.seat, src: self.card, remaining: 1 });
  },
};

/**
 * V5 The Coastal Trading Depot - v47 (22/09/2026, Dean's ruling, `tasks/v47-rulings-v1.md`
 * housekeeping; audit `tasks/v47-ambiguity-audit-v1.md`, the V5 row): "Deliver. 1 of the cards
 * may be any crop." (was "You may swap two demand tokens between 2 islands, then Deliver.")
 *
 * ⛔ THE TOKEN SWAP IS GONE. V5 was the only card in the game that moved island tokens, so this
 * retires the whole path: `swapDemand`, `tokenSwapOptions`, `fx.swapIslandTokens` and the
 * `demandSwapped` event lose their only producer. Per the v47 housekeeping decision they are
 * KEPT, not deleted, as orphans for a later to-do pass (the v46 `barnToHand` precedent) - do not
 * remove them from `actions.ts` / `fx.ts` / the event log from this file.
 *
 * The card is now the Vegetable Notice Board's own relaxation (V3: "Deliver - 2 of the cards may
 * be any crop") at strength 1: of the 4 cards a delivery pays, 1 may be of any crop in place of
 * what a token's pair asks for. This is a plain `deliver` task with `wildCards: 1`, the same
 * field the board power and V3 already carry. Mandatory ("Deliver."), doing as much as it can:
 * with no payable tile even under the relaxation, nothing happens (the ordinary V7/W11 shape, a
 * `deliver` task that auto-skips when `deliverAnswers` offers nothing).
 */
export const coastalTradingDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'RETEXTED ON SHEET v47: the demand-token swap is gone and this is now a bare Deliver with ' +
      'one wild card, the V3 board-power relaxation at strength 1 (`wildCards: 1` on the ' +
      '`deliver` task, the same field `fireNoticeBoardPower` already sets for V3). Mandatory, ' +
      'no skip of its own: an unpayable table (even with the relaxation) offers nothing and the ' +
      "task auto-skips, same as V7's Deliver half. " +
      '⛔ Orphaned by this retext, kept per the v47 housekeeping decision: `tokenSwapOptions`, ' +
      '`fx.swapIslandTokens`, the `demandSwapped` event and the `swapDemand` task kind. Nothing ' +
      'in the shipped game swaps island tokens any more.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card, wildCards: 1 });
  },
};

/**
 * V6 The Trade Depot - v47 (22/09/2026, Dean's ruling R4, `tasks/v47-rulings-v1.md`; audit
 * `tasks/v47-ambiguity-audit-v1.md` Q4): "Discard 2 cards from your Barn and then add 2 deck
 * cards to your Barn. Draw 2." (sheet typo, "cards your Barn" read as "cards from your Barn";
 * was "Swap 2 cards between your Barn and any Deck, then Draw 2" on v46.)
 *
 * R4: R6 STANDS IN FULL. This retext spells out what v46's R5 and R7 already ruled (barn cards
 * to their own crops' discard piles, deck tops in, freely chosen per card); it does not reopen
 * the all-or-nothing gate. A barn holding fewer than 2 cards means NOTHING happens, including no
 * Draw 2. The order is now printed rather than interleaved: both discards, THEN both adds, THEN
 * the draw - queued through the shared `barnDiscardTask` (buildings.ts) whose `then` callback
 * pushes the shared `deckToBarnTask` and the trailing Draw 2, so the three steps resolve in that
 * order regardless of push order elsewhere in the queue.
 *
 * ⭐ R4's consequence: because the two outgoing cards land in their own crops' discard piles
 * BEFORE the two incoming picks are offered, and a discard pile reshuffles into its own deck the
 * moment that deck runs dry, the incoming step can never be short of a legal answer once the
 * discard step has completed - the old `totalDrawable(...) < 2` pre-check (summed decks plus
 * discards, checked before anything moved) can no longer bite and is REMOVED. `barn.length < 2`
 * is now the only gate, checked once in `activate` before either primitive is touched.
 */
export const tradeDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ RETEXTED ON SHEET v47 (R4). PRINTED ORDER NOW: discard both, add both, then Draw 2 ' +
      "(v46 interleaved one out/one in, twice). The outgoing cards go to THEIR OWN CROP'S " +
      'DISCARD PILE, through the shared `barnDiscardTask` (mandatory, `remaining: 2`, ' +
      '`optional: false`, no skip) - the SAME event V8/V10/V12/V15 fire (`barnDiscarded`), so ' +
      'the bots price the loss for free. Its `then` callback fires once both discards have ' +
      'landed and pushes the shared `deckToBarnTask` (`remaining: 2`, the V4/A8/A13/V16/V17 ' +
      'primitive) followed by the trailing Draw 2, so all three run in the printed order. NO ' +
      'PAIRING (R7, unchanged): each incoming card names its own deck, the top card of a deck ' +
      "of the owner's choice, never tied to the crop just discarded. " +
      'EXACTLY 2 OR NOTHING (R6, unchanged): `barn.length < 2` gates the whole card in ' +
      '`activate`, before any task is pushed - no discard, no add, no Draw 2. Once legal the ' +
      'card always completes both discards and both adds: `barnDiscardTask` is mandatory and ' +
      'the barn is known to hold at least 2 cards, so it can never end early on an empty barn. ' +
      '⛔ The `totalDrawable` pre-check and the re-entrant `tradeSwap` task kind are GONE: the ' +
      'discards landing first, before the adds are offered, mean the deck-and-discard supply ' +
      'can never be short by the time `deckToBarnTask` asks (see the doc comment above).',
  },
  activate(fx, self) {
    // R6: exactly 2 or nothing, checked once before anything moves.
    if (player(fx.state, self.seat).barn.length < 2) return;
    pushBarnDiscard(fx, self, 2, false);
  },
  tasks: {
    barnDiscard: barnDiscardTask((fx, task) => {
      // R4: discard both, THEN add both, THEN Draw 2 - pushed in that order
      // from this `then` callback so it runs after both discards regardless
      // of anything else queued for this turn.
      fx.pushTask({
        t: 'card',
        pid: task.pid,
        src: task.src,
        kind: 'deckToBarn',
        riders: { remaining: 2 },
      });
      drawN(fx, task.pid, task.src, 2);
    }),
    deckToBarn: deckToBarnTask(),
  },
};

/** V7 The Export Depot - "Harvest one of your buildings, then Deliver." */
export const exportDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: true },
    notes:
      "The strongest card in the layer, and it takes threshold 4 for it. It is also the suit's " +
      'self-harvest valve, which every non-Wheat suit needs or its engine clog-locks. ' +
      'STRICT FULL GATE: "one of your buildings" prints no exception, and W11/W12/W13 all spell ' +
      'theirs out in words ("however many cards are on it"), so this is the plain full filter. ' +
      'The Deliver is the full action and auto-skips ' +
      'when nothing is payable. The harvest resolves first because tasks answer in queue order, ' +
      'so its cards are in the barn before the delivery enumerates; on the W15/A5 "then" ' +
      'precedent the delivery still runs if the harvest had no target. ' +
      '⚠️ RULING F, OWED BY DEAN: this collides head-on with W11 The Bakehouse ("Harvest one of ' +
      'your buildings, however many cards are on it, then Deliver"), a Tier 2 costing 3 against ' +
      'this Tier 1 costing 2. The recommendation is that the Deliver belongs to Vegetable and W11 ' +
      'takes the fallback its own rebuild doc printed; the Wheat row has DELIBERATELY not been ' +
      'edited, and V7 is built as printed either way. ' +
      '⚠️ It GRANTS DELIVERIES, and six by one seat ends the game. Threshold 4 is the leash; the ' +
      'dial, if game length collapses, is to drop the Deliver and leave the harvest.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'full',
      then: 'harvest',
    });
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
};

/** V8 The Regional Depot - v42: "Discard a card from your Barn. Draw 4 of that crop." */
export const regionalDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'The shared barn-discard step (`barnDiscardTask`), mandatory, one card, named by crop; ' +
      "then 4 cards off THAT crop's deck (`drawFromCropDeck`, the O15 shape: taken, then an " +
      'ordinary draw task with the cards pre-revealed). A deck that runs out reshuffles its ' +
      'own discard, which by then holds the card just discarded. Triggers V17. An empty barn ' +
      'pushes nothing, so the card does nothing: no discard, no draw. Replaces the v39 ' +
      'balloon text, which died with the balloons on 16/09/2026.',
  },
  activate(fx, self) {
    pushBarnDiscard(fx, self, 1, false);
  },
  tasks: {
    barnDiscard: barnDiscardTask((fx, task, crops) => {
      const crop = crops[0];
      if (crop !== undefined) drawFromCropDeck(fx, task.pid, task.src, crop, 4);
    }),
  },
};

/** V9 The Merchant Guild - v42: "Draw 2, then put 1 card from your hand into your Barn." */
export const merchantGuild: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'DE-SCALED 2026-08-09 (Dean, off the post-implementation review). It used to read "Draw 1 ' +
      'for each different crop in your barn" and it fired 0.0 times a game at a 7-8% play rate, ' +
      'bottom of its band and flagged FUEL. The metric was the fault: the median barn is 1.5 in ' +
      'the middle third of a game and 2.0 in the last, because the barn is a PIPE (54 cards a ' +
      'game flow through it by harvest) and not a store. A "for each X" with nothing raising X is a lottery ticket (docs/innovation.md). ' +
      'What replaces it is flat and upstream, and it is the suit in one line: Draw refills the ' +
      'hand, which visits eat, and the card into the barn loads the thing the ' +
      'island eats. It can never read zero. The handToBarn tail is a task so it can be skipped ' +
      'on an empty hand rather than wedging. A card-ability draw, so the Orchard modifier does ' +
      'not apply (DL-47).',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, 2);
    fx.pushTask({ t: 'handToBarn', pid: self.seat, src: self.card, remaining: 1 });
  },
};

/**
 * V10 The Supply House - v45 (19/09/2026): "For each card in your Barn, draw 1
 * of that suit." (was "Discard up to 2 cards from your Barn. For each card
 * discarded, perform the base action of that crop." on v42.)
 */
export const supplyHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      "⭐ RETEXTED ON SHEET v45 (Dean's rulings R1-R3, `tasks/v45-rulings-v1.md`). THE BARN " +
      'CARDS STAY (R1): nothing is discarded, spent or moved, so this is a permanent faucet the ' +
      'size of the barn and can fire again next turn off the same cards. THE DRAW IS ' +
      'MANDATORY AND UNCAPPED (R2, R3): every barn card draws, no "up to", no skip, and a barn ' +
      'of six draws six - shipped exactly as printed for this measurement run, not softened for ' +
      'the simulator. `barnTally` counts the barn by crop WITHOUT touching it, and each count ' +
      'runs once through `drawFromCropDeck` (the V8 shape: taken now, then handed to an ' +
      'ordinary draw task with the cards pre-revealed), so a crop whose deck runs dry simply ' +
      'draws what is left. NO TASK OF ITS OWN: there is no choice anywhere in the card, so it ' +
      'is one loop over the tally rather than a re-entrant task. ' +
      '⚠️ IMPLEMENTATION NOTE FROM DEAN, NOT SOFTENED HERE: the engine hand bound is 7 and the ' +
      "end-of-turn overflow discard is already the simulator's single largest cost; a forced " +
      'multi-card draw off a full barn pushes on that directly, and that cost is reported ' +
      'rather than capped away. ' +
      '⛔ THE SHIPPED SHAPE HAS NO DISCARD: no "up to", no per-crop plain action. ' +
      '⭐ 20/09/2026, `rules.economy.supplyHouseBarnDrain` (default false): true switches ' +
      'this card back to the pre-v45 shape - "Discard up to 2 cards from your Barn. For each ' +
      'card discarded, perform the base action of that crop" - via the restored ' +
      '`pushPlainAction` and the `barnDiscard` task below, added to measure how much of the ' +
      "reference-v21 barn glut is this one card's drain going away " +
      '(overlays/pre-v45-barn-drains-v1.overlay.json). Under the knob the OLD notes apply: ' +
      'every discard first, then the actions in discard order (discarding first means a card ' +
      'harvested into the barn by the first action can never be discarded by this card), each ' +
      'discard triggers V17 when `dockworkersUnionDrawOnDiscard` is also true, and a Grow ' +
      'cannot pick V10 itself since it has already activated this turn.',
  },
  activate(fx, self) {
    if (fx.data.rules.economy.supplyHouseBarnDrain) {
      pushBarnDiscard(fx, self, 2, true);
      return;
    }
    const tally = barnTally(fx.data, fx.state, self.seat);
    for (const suit of fx.data.cards.suits) {
      const n = tally[suit] ?? 0;
      if (n > 0) drawFromCropDeck(fx, self.seat, self.card, suit, n);
    }
  },
  tasks: {
    barnDiscard: barnDiscardTask((fx, task, crops) => {
      for (const crop of crops) pushPlainAction(fx, task.pid, task.src, crop);
    }),
  },
};

/**
 * V11 The Market Master - v46 (20/09/2026, Dean's rulings R1-R4,
 * `tasks/v46-rulings-v1.md`): "For each suit in your Barn, Harvest a card of
 * that crop." (was "For every card in your Barn, move a card of the same
 * crop from any of your buildings into your Barn" on v42/v45 - a full
 * rewrite from a stack MOVE into a REAL Harvest.)
 */
export const marketMaster: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      '⭐ REWRITTEN ON SHEET v46 (R1-R4). A REAL HARVEST, not the single-card stack move the ' +
      'v42/v45 text did. THE BARN IS SNAPSHOTTED ONCE (R3), BY DISTINCT SUIT, at activation, ' +
      'through the same `barnTally` V10 and V12 already read - at most five entries, and a ' +
      'card that arrives in the barn from a harvest THIS CARD triggers cannot open a new suit ' +
      'or add to the count, because nothing re-reads the barn after this point: every task is ' +
      'pushed up front, one per snapshotted suit. ONE `chooseBuilding` TASK PER SNAPSHOTTED ' +
      "SUIT (`filter: 'full', then: 'harvest'`) - THE SAME TASK THE HARVEST ACTION USES (V7, " +
      'the Wheat door...), resolved through `fx.harvest` in `tasks.ts` and nowhere else, so ' +
      'every on-harvest hook fires exactly as it does for an ordinary Harvest: the `harvested` ' +
      "event, `afterHarvest`, W16 The Granary's fresh hand check, W18 A Helping Hand's count, " +
      "and any card's own When-Harvested text. `targets` restricts each task to that suit's " +
      'buildings (`ownBuildings` filtered on `cardById(...).suit`, DELIBERATELY NOT `cropOf` - ' +
      '`cropOf` reads null for every starter including the Notice Board, and R2 needs the ' +
      "board IN scope). THE FULL GATE IS THE ORDINARY ONE (R2): `filter: 'full'` reads " +
      '`isHarvestable`, already the S8-aware boolean a `3+` Notice Board answers at 3 cards ' +
      'and never below - no bespoke Notice Board exclusion is written here at all, unlike the ' +
      'v42/v45 stack move which had to name-check `isNoticeBoardCard`. A half-built stack is ' +
      'never in `fullBuildings`, so it is never offered. MANDATORY (R4): no `optional` field, ' +
      'so no skip is ever offered once a suit has a legal target; a suit with no full building ' +
      "of its crop gets a target list `chooseBuilding`'s own `taskAnswers` never satisfies, " +
      "and the task self-drains (`drainTasks`, tasks.ts) exactly as V7's empty harvest already " +
      'does - the same silent-drop precedent, not a bespoke check. When more than one full ' +
      'building shares a suit the task offers all of them, so the owner still picks which. ' +
      "⚠️ DEAN'S ACCEPTED CONSEQUENCE: this can dismantle its own owner's farm against their " +
      'will (a cascade shown before the ruling, potentially larger than W13 The Bakery); do ' +
      'not add an escape hatch - the fix, if one is ever wanted, is the word "may" on the ' +
      'printed face. Replaces the v42/v45 `stackMove` task and `Fx.stackCardToBarn`, neither ' +
      'read here any more.',
  },
  activate(fx, self) {
    const budget = barnTally(fx.data, fx.state, self.seat);
    const suits = fx.data.cards.suits.filter((suit) => (budget[suit] ?? 0) > 0);
    for (const suit of suits) {
      const targets = ownBuildings(fx.data, fx.state, self.seat)
        .filter((b) => cardById(fx.data, b.card).suit === suit)
        .map((b) => b.card);
      // A suit with no full building among `targets` (or none at all) simply
      // self-drains once queued (R4) - the same precedent V7's empty harvest
      // already relies on, so no explicit "nothing to harvest" guard is
      // written here.
      fx.pushTask({
        t: 'chooseBuilding',
        pid: self.seat,
        src: self.card,
        filter: 'full',
        targets,
        then: 'harvest',
      });
    }
  },
};

/**
 * V12 The Auction House - v45 (19/09/2026): "Perform the Notice Board action
 * of any suit you have in your Barn." (was "Discard a card from your Barn.
 * Perform the Notice Board action of that crop." on v42.) Threshold 3 (was 2).
 */
export const auctionHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      "⭐ RETEXTED ON SHEET v45 (Dean's ruling R4, `tasks/v45-rulings-v1.md`). THE POWER IS " +
      'FREE: no card is discarded, spent or moved. The barn only NAMES which powers are on ' +
      'offer, not a price - the threshold rise from 2 to 3 is what pays for it. `data.cards.' +
      'suits` filtered to the crops present in the barn gives the choices; the player names ' +
      'one and `fireNoticeBoardPower` (workers.ts) fires it, exactly as before: Wheat ' +
      'harvest-then-hand-to-barn, Vegetable Deliver with 2 any-crop cards or the fallback, ' +
      'Orchard Draw 4, Apiary the wild deck Grow, Dairy Build at a discount of 2 with any ' +
      "crops. Any crop's power is available even if that board is not on the table. STILL NOT " +
      'A VISIT (unchanged, reconfirmed by the audit): no card is placed, no `afterVisit` fires ' +
      'and no board is latched, so there is no fee and no W17, O16 or A17. Vegetable\'s "if you ' +
      'cannot" is asked when the power fires, with the relaxation (`vegetableBoardCanDeliver`), ' +
      'reading the barn exactly as it stands because nothing has left it. ONE POWER, NOT ONE ' +
      'PER SUIT (unchanged): the power fires and does as much as it can, the rest dropping ' +
      'silently, because a GROW activation cannot be refused per crop - and with no discard to ' +
      'pay there is not even a cost to waste. ' +
      '⛔ THE OLD SHAPE IS GONE: no discard, no `barnDiscardTask`, no `afterBarnDiscard` fire ' +
      'from this card. That is moot for V17 anyway, since it no longer listens to that hook ' +
      '(see its own handler).',
  },
  activate(fx, self) {
    const suits = fx.data.cards.suits.filter((suit) =>
      player(fx.state, self.seat).barn.some((id) => cardById(fx.data, id).suit === suit),
    );
    if (suits.length === 0) return;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'auctionSuit', riders: {} });
  },
  tasks: {
    auctionSuit: {
      answers(data, state, task) {
        const barn = player(state, task.pid).barn;
        return data.cards.suits
          .filter((suit) => barn.some((id) => cardById(data, id).suit === suit))
          .map((suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('auctionSuit expects a card answer');
        const suit = answer.payload.suit as Suit;
        fireNoticeBoardPower(fx, task.pid, suit, {
          src: task.src,
          deliverLegal: vegetableBoardCanDeliver(fx.data, fx.state, task.pid),
        });
        return true;
      },
    },
  },
};

/**
 * V13 The Grand Marketplace - "For each different crop in your barn, put the top
 * card of that crop's deck into your barn."
 */
export const grandMarketplace: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'REPOINTED 2026-08-09 (Dean, off the post-implementation review). It used to be the ' +
      'RECOLOURING card - "discard any number from your barn, then put the top card of any deck ' +
      'into your barn for each" - and the reason it went is not that it played badly (7% built, ' +
      '0.1 activations, flagged FUEL) but that its JOB HAD ALREADY BEEN TAKEN. The wild ' +
      'substitution landed on 8 August, one day before this suit shipped, and it fixes a barn ' +
      'full of the wrong crops for everybody: any single card the island asks for can be paid ' +
      'with 2 cards of any crops. A whole main action to recolour at 1:1, on a median barn of 2, ' +
      'was left with nothing to do. ' +
      'What it does now is the OPPOSITE arrow: it does not recolour the barn, it MULTIPLIES it, ' +
      "and the multiplier is the barn's VARIETY. A monoculture barn draws 1 and a rainbow barn " +
      'draws 5, so the card pays for the mixed barn the island demands and the visit fee ' +
      'supplies - the "different crops in your barn" metric CLAUDE.md names as the ' +
      'Currency-shaped candidate, on the one axis in the suit that crosses the specialisation ' +
      'axis rather than running along it. ' +
      'NO CHOICE AND NO TASK: the crop list decides the decks, so there is nothing to ask. The ' +
      'list is taken ONCE, before anything is added, because a card arriving in the barn must ' +
      'not extend the loop that put it there. ' +
      '⚠️ IT PADS THE BARN, which the old card deliberately did not (it was count-neutral). That ' +
      'is the thing to watch: assertion 6 (the barn glut) is already FAILing, and this is the ' +
      'first card in the suit that adds to a barn without a delivery in the same breath. ' +
      'CONVERTED FROM ACTION TO GROW ON 19/08/2026 (Dean: "The concept of an ACTION was never ' +
      'requested. They are all GROW."). The printed effect is UNCHANGED - this is the pure ' +
      'conversion of the three, with no retext behind it - so everything above still holds. What ' +
      'changed is the shell: the standing `cardMove` and its `applyMove` are gone, the effect ' +
      'moved into `activate`, and the `turn.actionSpent = true` line came out because GROW is ' +
      'the action now and the grow runtime books it. The old move gated itself on ' +
      '"cropsToRefill > 0" so it was simply not offered against an empty barn; a GROW has no ' +
      'such gate, so activating this on an empty barn is legal and does nothing. That is the ' +
      'normal shape for a building (you may always pay a card into a stack) and it is not worth ' +
      'a guard - but it does mean the card can be grown purely to advance its own threshold, ' +
      'which the ACTION shape could not.',
  },
  activate(fx, self) {
    // Fixed before the first card lands: "each different crop in your barn" is
    // read at activation, so a Wheat card arriving cannot make Wheat a crop the
    // loop has not already counted.
    const crops = refillCrops(fx.data, fx.state, self.seat);
    for (const suit of crops) fx.deckTopToBarn(self.seat, suit);
  },
};

/** The crops in this seat's barn whose own deck can still be drawn from. */
function refillCrops(data: GameData, state: GameState, seat: Seat): Suit[] {
  const tally = barnTally(data, state, seat);
  const live = liveDecks(data, state);
  return live.filter((suit) => (tally[suit] ?? 0) > 0);
}

/**
 * V14 The Distribution Center - v42: "Deliver and take every receipt on the
 * island card, then destroy this building." Cost 3 (2 vegetable + 1 any).
 */
export const distributionCenter: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      '⭐ ON THE TOKEN ISLAND (16/09/2026) IT IS THE takeAll CHOICE OF doDeliver: pay the tile ' +
      'ONCE (the same 4 cards a first delivery pays) and take every token it still holds, both ' +
      'on a virgin tile, the last one on a half-finished tile (an ordinary second delivery, ' +
      '⚠️ BUILDER DEFAULT). It emits one `delivered` event per token so nothing counting ' +
      'receipts has to learn about the sweep, and fires afterDeliver ONCE with both receipts, ' +
      'because it is one Deliver. ' +
      '⭐ v42 "THEN DESTROY THIS BUILDING": after the delivery, V14\'s own stack goes to the ' +
      'discard (`fx.discardStack`) and V14 leaves the tableau for its discard (`fx.demolish`, ' +
      'the D14 pair), so it scores no printed VP and counts for nothing - the Barn scorer, ' +
      'A19-A21, D21, O20 - from then on. It is NOT a barn discard, so V17 does not fire. ' +
      'The afterDeliver listeners (V16, V18) fire inside the delivery, before the demolition. ' +
      '⚠️ BUILDER DEFAULT: NO DELIVERY, NO DESTRUCTION. Like V7, the activation is not gated ' +
      'on a payable delivery (a GROW is never refused per card); with nothing payable the ' +
      'sweep task drops and V14 stays built, clogged at its threshold of 1. ' +
      '⚠️ RETEXTED AND RE-RULED ON 19/08/2026, AND THE RULING OVERRIDES THE PRINTED TEXT. The ' +
      'card now reads "Deliver and take EVERY RECEIPT ON THE ISLAND", which taken literally ' +
      'would empty the board. Dean has ruled it: it takes whatever receipts REMAIN ON THE TILE ' +
      'IT DELIVERED TO - two if nobody has delivered there, one if somebody has. Not "every ' +
      'receipt on the island", and not always "both". So the tokens are read off the live tile ' +
      'at resolve rather than hard-coded. ' +
      'THE VIRGIN-TILE RESTRICTION IS GENUINELY GONE. The old card read "Deliver to a tile where ' +
      'nobody has delivered, and take both of its receipts", and the enumerator (virginDeliveries) ' +
      'filtered the shared option set down to untouched tiles. It now enumerates every payable ' +
      'delivery, so the card may deliberately be aimed at a half-claimed tile for a single ' +
      'receipt. That makes it strictly more flexible and slightly less explosive: the 9-point ' +
      'double is now a choice you can miss rather than the only thing the card does, and a seat ' +
      'holding V14 for a virgin tile is choosing to wait rather than being forced to. ' +
      'The answers are filtered off deliverOptions rather than re-derived, one per (tile, ' +
      'payment), because the card takes every token and names none. ' +
      '⚠️ RULING G, OWED BY DEAN: two receipts count as TWO deliveries toward the six-delivery ' +
      'end trigger, which is what islandDeliveriesBy does for free and is the recommendation. ' +
      'The trigger check runs after BOTH pushes. If Dean rules the other way it is a real change ' +
      'and needs a dial; there is deliberately no dial for it yet. ' +
      'CONVERTED FROM ACTION TO GROW in the same pass: no standing move, no applyMove, no ' +
      '`turn.actionSpent` line. It costs a card into its own stack now, and it clogs at 1.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'sweepDeliver', riders: {} });
  },
  tasks: {
    sweepDeliver: {
      answers(data, state, task) {
        // One answer per (tile, payment): the token choice does not apply,
        // because the card takes every token the tile holds.
        const seen = new Set<string>();
        return deliverOptions(data, state, task.pid)
          .filter((o) => {
            const key = `${o.tile}|${JSON.stringify(o.spend)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map(
            (o) =>
              ({
                kind: 'card',
                // ⛔ THE TWO HEADS ARE GONE WITH THE VEGETABLE FARMSTEAD (v31), and
                // the warning they carried is kept because it will recur the next
                // time anything rides on a delivery. This is a `card` payload
                // rather than the shared `deliver` answer, so it does NOT get the
                // wiring in tasks.ts for free and has to carry every rider by
                // hand - `deckHead` was missed exactly that way when it landed,
                // crashing roughly 4% of games with "no <crop> card left to spend"
                // on a spend that was only ever affordable because a deck card was
                // supposed to arrive first.
                payload: { tile: o.tile, spend: o.spend },
              }) as TaskAnswer,
          );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('sweepDeliver expects a card answer');
        const { tile, spend } = answer.payload as {
          tile: string;
          spend: Partial<Record<Suit, number>>;
        };
        // "Every receipt" = every token THIS TILE still holds (Dean,
        // 19/08/2026): both on a virgin tile for the one 4-card payment, the
        // last one on a half-finished tile (an ordinary second delivery,
        // ⚠️ BUILDER DEFAULT).
        doDeliver(fx, task.pid, tile, spend, { takeAll: true });
        // v42: "then destroy this building". The D14 pair: the stack to the
        // discard, then the building itself. Never a barn discard (no V17).
        if (player(fx.state, task.pid).tableau.some((b) => b.card === task.src)) {
          fx.discardStack(task.pid, task.src);
          fx.demolish(task.pid, task.src);
        }
        return true;
      },
    },
  },
};

/**
 * V15 The International Port - v42: "Discard 1 card from your Barn, then Build
 * a card of the same crop from your hand for free."
 */
export const internationalPort: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The barn-discard step, mandatory, one card; then a `freeBuild` task offering every ' +
      'card in the hand of THAT crop with a build cost - Power and Endgame cards included - ' +
      'built with NO payment through `placeBuilt`, so the Build hooks fire exactly as for any ' +
      'build: D16 The Ledger, D18 A Helping Hand (it counts toward "Build two buildings"), and ' +
      'the `built` event. The build is mandatory when there is one ("then Build"); with no ' +
      'card of that crop in hand the task drops and the discard stands. The own-suit minimum ' +
      "and every cost are waived, because nothing is paid. Triggers V17. Replaces v31's " +
      '"Deliver Twice". ' +
      '⭐ CHECKED FOR SHEET v46 (R11.2, `tasks/v46-rulings-v1.md`): the build cost drops from ' +
      '3 suit + 1 wild to 2 suit + 1 wild, a `cards.json`-only change. Nothing here or ' +
      'anywhere else in the engine pins the old number - `buildCost` is read generically off ' +
      'the card by `actions/build.ts` - so this handler needs no change, and none is made.',
  },
  activate(fx, self) {
    pushBarnDiscard(fx, self, 1, false);
  },
  tasks: {
    barnDiscard: barnDiscardTask((fx, task, crops) => {
      const crop = crops[0];
      if (crop === undefined) return;
      fx.pushTask({
        t: 'card',
        pid: task.pid,
        src: task.src,
        kind: 'freeBuild',
        riders: { crop },
      });
    }),
    freeBuild: {
      answers(data, state, task) {
        const crop = task.riders.crop as Suit;
        return player(state, task.pid)
          .hand.filter((id) => {
            const card = cardById(data, id);
            return card.suit === crop && card.buildCost !== null;
          })
          .map((card) => ({ kind: 'card', payload: { card } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('freeBuild expects a card answer');
        const card = answer.payload.card as CardId;
        fx.removeFromHand(task.pid, card);
        placeBuilt(fx, task.pid, card, [], task.src);
        return true;
      },
    },
  },
};

/**
 * V16 The Market Signal Tower - v45 (19/09/2026): "Whenever you Deliver, put
 * any deck card into your Barn." (was "...put the top card of any deck..." on
 * v42 - wording only, see below.)
 */
export const marketSignalTower: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "⭐ CONFIRMED A NO-OP BY THE v45 RETEXT (Dean's ruling R5, `tasks/v45-rulings-v1.md`): " +
      '"any deck card" means the top card of a deck of your choice, which is exactly what this ' +
      'card already did. Nothing below changed. ' +
      'Owner-only, on EVERY delivery: the main action, the Vegetable board (V3), V5, V7, V10, ' +
      'V12 and V14 (one delivery, so one card, even when it takes two receipts). One ' +
      '`deckToBarn` task, the player picking the deck. ' +
      '⚠️ WITH V18 (handoff §5 item 6, BUILDER DEFAULT "the active player orders"): NOT ' +
      'IMPLEMENTED AS A CHOICE. The hook bus resolves listeners in a fixed order, and this ' +
      "card only QUEUES its card, so V18 always reads the barn BEFORE V16's card lands, " +
      'whichever sits first in the tableau: in effect V18 first. That is the order an active ' +
      'player who holds both would choose (it can only help V18). Replaces the v39 balloon ' +
      'text, which died with the balloons on 16/09/2026.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (drawableSuits(fx.data, fx.state).length === 0) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'deckToBarn',
        riders: { remaining: 1 },
      });
    },
  },
  tasks: { deckToBarn: deckToBarnTask() },
};

/**
 * V17 The Dockworker's Union - v46 (20/09/2026, Dean's rulings R11.3-R11.4,
 * `tasks/v46-rulings-v1.md`): "If, at the end of your turn, your Barn has 3
 * or fewer cards, place any deck card into your Barn." (was "...your Barn is
 * empty..." on v45 - the sheet prints "3 of fewer", read as "3 or fewer".)
 */
export const dockworkersUnion: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      "⭐ RETEXTED ON SHEET v45 (Dean's ruling R5, `tasks/v45-rulings-v1.md`), and the card " +
      'moves to a completely different hook BY DEFAULT. It no longer listens on ' +
      "`afterBarnDiscard` at all under the shipped knob value - V8 and V15 are that hook's " +
      'only listeners now (buildings.ts still fires it for them; the hook itself is not ' +
      "deleted, only this card's wiring to it). " +
      'THE NEW LISTENER IS `beforeTurnEnd` (fx.ts), the hook `finishTurn` (turnflow.ts) fires ' +
      'once a turn, before the hand-limit discard - the same seam O18 A Helping Hand already ' +
      'uses, so V17 joins an existing seam rather than needing a new one. Owner-scoped ' +
      '("your turn"): the listener guards on `event.seat === self.seat`. MANDATORY (R5): the ' +
      'only choice is which deck, through the shared `deckToBarn` task (buildings.ts), the ' +
      "same one V4, A8/A13 and V16 use - the top card of a deck of the player's choosing, " +
      'never a search. ' +
      '⭐ LOOSENED ON SHEET v46 (R11.3-R11.4): the threshold moves from "Barn is empty" (0) ' +
      'to "Barn has 3 or fewer cards", so this now asks its question on most turns rather ' +
      'than rarely - FIRES ON A TURN WHERE THE BARN WAS NEVER TOUCHED, including most early ' +
      'turns, because the game starts with an empty barn and 0 is comfortably "3 or fewer". ' +
      'Checked ONCE, after the main action and any meeple spend, before the discard; a barn ' +
      'holding 4 or more cards at that moment does not fire it at all. ' +
      '⚠️ THE DRY-TABLE GUARD BELOW IS LOAD-BEARING AND UNCHANGED (R11.4): it sits in the ' +
      'same place, after the barn-size check and before the task push, evaluated fresh on ' +
      'every firing - loosening the barn condition does not touch it, and it must not move. ' +
      '⭐ 20/09/2026, `rules.economy.dockworkersUnionDrawOnDiscard` (default false): true ' +
      'switches this card back to the pre-v45 shape, "Whenever you discard a card from your ' +
      'Barn, Draw 1", back on the `afterBarnDiscard` hook - added alongside ' +
      '`supplyHouseBarnDrain` to measure how much of the reference-v21 barn glut these two ' +
      "cards' v45 retexts are responsible for " +
      '(overlays/pre-v45-barn-drains-v1.overlay.json). The two listeners below are mutually ' +
      'exclusive on the knob: exactly one is live at a time, never both, so a discard cannot ' +
      'be double-counted and an empty-barn turn cannot fire twice.',
  },
  on: {
    beforeTurnEnd(fx, event, self) {
      if (fx.data.rules.economy.dockworkersUnionDrawOnDiscard) return;
      if (event.seat !== self.seat) return;
      // v46 (R11.3): "3 or fewer", loosened from "empty" (was `> 0`).
      if (player(fx.state, self.seat).barn.length > 3) return;
      // A table with every deck AND discard dry offers nothing (the same guard
      // as V4 and V16, the other two `deckToBarn` call sites). Missing this
      // guard let the task push unconditionally, and `deckToBarnTask.answers()`
      // returns `[]` when nothing is drawable - a mandatory task with no
      // answer, which is a dead end the sim's driver reports as "no legal
      // moves and the game is not over" (found 19/09/2026 off
      // reference-v21:3:VOD+W:17, turn 70). LOAD-BEARING (R11.4): keep this
      // guard exactly where it is - the v46 threshold change makes this fire
      // far more often, which makes the guard matter more, not less.
      if (drawableSuits(fx.data, fx.state).length === 0) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'deckToBarn',
        riders: { remaining: 1 },
      });
    },
    // ⭐ RESTORED 20/09/2026 behind `rules.economy.dockworkersUnionDrawOnDiscard`
    // (the arm in overlays/pre-v45-barn-drains-v1.overlay.json): the pre-v45
    // card, "Whenever you discard a card from your Barn, Draw 1", quoted
    // verbatim from `git show e6b459c` so the old-value arm really is the old
    // game. Live only when the knob is true; `beforeTurnEnd` above is live
    // only when it is false, so exactly one of the two ever fires.
    afterBarnDiscard(fx, event, self) {
      if (!fx.data.rules.economy.dockworkersUnionDrawOnDiscard) return;
      if (event.seat !== self.seat) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
  tasks: { deckToBarn: deckToBarnTask() },
};

/**
 * V19 The Market Gazette - v42: "Game end: 3 VP for each pair of RECEIPTs with
 * the same crop."
 */
export const marketGazette: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⚠️ BUILDER DEFAULTS (handoff §5 item 7): pairs are DISJOINT, floor(n / 2) per crop, and ' +
      'a WILD receipt is its own crop: it pairs only with another wild. Receipts carry the ' +
      "token's crop (R7). Replaces the v39 balloon scorer.",
  },
  gameEnd(_data, state, seat) {
    const byCrop = new Map<string, number>();
    for (const r of receiptsOf(state, seat)) byCrop.set(r.crop, (byCrop.get(r.crop) ?? 0) + 1);
    let pairs = 0;
    for (const n of byCrop.values()) pairs += Math.floor(n / 2);
    return 3 * pairs;
  },
};

/** V20 The Trading Commission - v42: "Game end: 2 VP for each RECEIPT worth 4 or less." */
export const tradingCommission: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'Read off the token value on each receipt (the token island: 3, 4, 5 or 6), so the 3 ' +
      'and 4 VP tokens - the ones that carry a Worker - each score 2 more. Every receipt ' +
      'counts, a seventh beside the Farmstead included. Replaces v31\'s "2 VP for each DEPOT ' +
      'you have built".',
  },
  gameEnd(_data, state, seat) {
    return 2 * receiptsOf(state, seat).filter((r) => r.vp <= 4).length;
  },
};

/** V21 The Harvest Ledger - v42: "Game end: 3 VP for each vegetable RECEIPT." */
export const harvestLedger: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'A receipt whose crop is vegetable (R7). ⚠️ BUILDER DEFAULT: a WILD receipt does not ' +
      'count. Replaces v31\'s "1 VP for every 2 cards in your barn".',
  },
  gameEnd(_data, state, seat) {
    return 3 * receiptsOf(state, seat).filter((r) => r.crop === 'vegetable').length;
  },
};
