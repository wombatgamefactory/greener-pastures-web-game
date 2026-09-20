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
 *   1. **The island's tokens are MUTABLE.** V5 swaps two of them between two
 *      island cards (the token island, 16/09/2026: each token keeps its VP and
 *      its Worker). Engine seams: `tokenSwapOptions` and `fx.swapIslandTokens`.
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
 *   4. **A barn card into the hand** (V6): `Fx.barnToHand`, by crop.
 *   5. **A card off a building into the barn without a harvest** (V11):
 *      `Fx.stackCardToBarn`, which already existed.
 *   6. **A board power by crop without a visit** (V12): `fireNoticeBoardPower`
 *      (workers.ts), which places no card, fires no `afterVisit` and latches no
 *      board, so it is no visit: no fee, and no W17, O16 or A17. ⭐ v45: the
 *      power is FREE (R4) - the barn only names which suits are on offer, and
 *      nothing is discarded to pay for it.
 *   7. **Receipts by crop and value** (V19, V20, V21; W21 in wheat.ts).
 *   8. **An end-of-turn condition on an empty Barn** (V17, v45): a second
 *      listener on `beforeTurnEnd` (fx.ts), the hook `finishTurn` (turnflow.ts)
 *      already fires once a turn, for O18 A Helping Hand.
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
 * threshold also rises, 2 to 3, alongside its retext. `pushPlainAction` is
 * deleted with V10's old text, its only caller.
 */

import type { GameData, Suit } from '@gp/data';

import {
  barnTally,
  deliverOptions,
  doDeliver,
  placeBuilt,
  tokenSwapOptions,
  vegetableBoardCanDeliver,
} from '../actions.js';
import type { TokenRef } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player } from '../query.js';
import type { CardId, DoorAction, GameState, Receipt, Seat, TaskAnswer } from '../state.js';
import { doorActionOf, fireNoticeBoardPower } from '../workers.js';
import {
  barnDiscardRiders,
  barnDiscardTask,
  deckToBarnTask,
  drawFromCropDeck,
  isNoticeBoardCard,
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
 * ⚠️ UNCALLED SINCE SHEET v45 (19/09/2026): this was V10 The Supply House's
 * "base action" mapping (`pushPlainAction`, deleted the same day with its only
 * caller when V10 was retexted to a plain per-crop draw, R1-R3). Left in place
 * because it is a small, already-proven utility and no card currently needs
 * it removed, but nothing in the engine calls it right now - flag this for a
 * future pass if it stays dead.
 */
export function plainActionOf(data: GameData, crop: Suit): DoorAction {
  const action = doorActionOf(data, crop);
  return action === 'sow' ? 'grow' : action;
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
 * V4 The Market Stall Depot - v42: "If your barn has 3 or fewer cards, place a
 * deck card into your barn."
 */
export const marketStallDepot: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The barn size is read ONCE, at activation, after the GROW payment has landed on this ' +
      'card (a payment goes on the stack, never in the barn, so it cannot move the count). ' +
      'A barn of 4 or more does nothing at all. Otherwise one `deckToBarn` task: the player ' +
      'picks the deck and its top card goes straight into the barn (the shared task in ' +
      'buildings.ts). A table with every deck dry offers nothing and the task drops. ' +
      'Replaces the v39 balloon text, which died with the balloons on 16/09/2026.',
  },
  activate(fx, self) {
    if (player(fx.state, self.seat).barn.length > 3) return;
    if (drawableSuits(fx.data, fx.state).length === 0) return;
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'deckToBarn',
      riders: { remaining: 1 },
    });
  },
  tasks: { deckToBarn: deckToBarnTask() },
};

/** V5 The Coastal Trading Depot - "You may swap two demand tokens between 2 islands, then Deliver." */
export const coastalTradingDepot: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'THE FIRST CARD IN THE GAME THAT WRITES TO THE SHARED BOARD: fx.swapIslandTokens plus ' +
      'tokenSwapOptions. ⭐ ON THE TOKEN ISLAND (16/09/2026) two tokens on two DIFFERENT island ' +
      'cards trade places, each keeping its VP and its Worker; a finished tile holds nothing, so ' +
      'a delivery already made is never re-priced. ⚠️ BUILDER DEFAULT: the lone token of a ' +
      'half-finished tile may be swapped. A pair of identical tokens is a no-op and is never ' +
      'offered. v42 prints "You may swap two demand tokens between 2 islands, then Deliver", ' +
      'which this is (checked 16/09/2026). ' +
      '"You may", so a skip is offered whenever there is anything to skip. ' +
      "⚠️ THE BOTS CANNOT JUDGE THIS CARD'S DENIAL USE. outcome.ts prices what the acting seat " +
      'GAINS and never rival harm (a deliberate law of the instrument), so every swap a bot ' +
      'takes is self-serving and an arm reads the card as pure upside. Whether swapping a token ' +
      "out from under a rival's hoarded pair lands as clever or as the predecessor's \"reverse " +
      'engine-building" resentment is a table question and only a table question. The dial, if a ' +
      'table hates it, is to allow swaps only on tiles NOBODY has delivered to. ' +
      '"THEN DELIVER" ADDED 2026-08-09 (Dean, off the post-implementation review), and it is the ' +
      'fix for the sharpest anomaly in the suit: the card was the MOST-BUILT in its band at 59% ' +
      'and activated 0.1 times a game. The cause was tempo, not pricing - a GROW cost the action ' +
      'plus a matching card and returned no card, no coin and no VP, only a repositioned token ' +
      'on a board where a rival might deliver into the slot you had just improved. Re-route the ' +
      'order and then fill it is one turn now, which is the fantasy the card was always selling. ' +
      '⚠️ NOT RE-PRICED. The review recommended cost 2 / threshold 3 alongside this, on the ' +
      'grounds that V7 pays 2 and a threshold of 4 for harvest-then-Deliver; this ships at cost ' +
      '1 / threshold 2 because that is what was approved. If the arm shows V5 eating the layer, ' +
      'the price is the dial, not the text.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'swapDemand', riders: {} });
    // The swap resolves first (tasks answer in queue order), so the delivery
    // enumerates against the island the swap just produced - which is the whole
    // point of putting the two on one card. Auto-skips when nothing is payable,
    // on the V7 / W15 / A5 "then" precedent.
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
  tasks: {
    swapDemand: {
      answers(data, state) {
        // ⭐ The token island (16/09/2026): two tokens on two DIFFERENT island
        // cards, each keeping its VP and Worker - v42's "You may swap two
        // demand tokens between 2 islands, then Deliver".
        const out: TaskAnswer[] = tokenSwapOptions(data, state).map(
          ([a, b]) => ({ kind: 'card', payload: { a, b } }) as TaskAnswer,
        );
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('swapDemand expects a card answer');
        const { a, b } = answer.payload as { a: TokenRef; b: TokenRef };
        fx.swapIslandTokens(task.pid, a, b);
        return true;
      },
    },
  },
};

/**
 * V6 The Trade Depot - v45 (19/09/2026): "Swap up to 2 cards between your hand
 * and your Barn, then Draw 2." (was "...then Draw 1" on v42.)
 */
export const tradeDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'A SWAP IS ONE CARD FOR ONE CARD (handoff §3): a hand card into the barn and a barn card ' +
      'into the hand. The answer names the HAND card by id (the owner sees their hand) and the ' +
      'BARN card by crop only (a barn is anonymous even to its owner, so two barn cards of one ' +
      'crop are one choice; `Fx.barnToHand`, the new primitive, takes the first). Up to 2 swaps, ' +
      'each its own optional answer: one re-entrant `tradeSwap` task with a skip, never a ' +
      'subset enumeration. The barn card leaves BEFORE the hand card arrives, so a same-crop ' +
      'swap really hands over a different card. The swapped hand card is not a delivery and ' +
      'not a discard. ⭐ THEN DRAW 2 (v45, 19/09/2026; was Draw 1 on v42), the ordinary draw ' +
      'task with the deck chosen, which runs whether or not anything was swapped. Replaces the ' +
      'v39 face-down token, which died with the crate island on 16/09/2026.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'tradeSwap',
      riders: { remaining: 2 },
    });
    drawN(fx, self.seat, self.card, 2);
  },
  tasks: {
    tradeSwap: {
      answers(data, state, task) {
        if ((task.riders.remaining as number) <= 0) return [];
        const p = player(state, task.pid);
        const crops = data.cards.suits.filter((suit) =>
          p.barn.some((id) => cardById(data, id).suit === suit),
        );
        const out: TaskAnswer[] = [];
        for (const give of p.hand) {
          for (const take of crops) out.push({ kind: 'card', payload: { give, take } });
        }
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('tradeSwap expects a card answer');
        const give = answer.payload.give as CardId;
        const take = answer.payload.take as Suit;
        fx.barnToHand(task.pid, take);
        fx.handToBarn(task.pid, give);
        task.riders.remaining = (task.riders.remaining as number) - 1;
        return (task.riders.remaining as number) <= 0;
      },
    },
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
      '⛔ THE OLD SHAPE IS GONE: no discard, no "up to", no per-crop plain action. ' +
      '`pushPlainAction` loses its only caller here and is deleted with it; `plainActionOf` is ' +
      'left in place but is presently uncalled anywhere in the engine.',
  },
  activate(fx, self) {
    const tally = barnTally(fx.data, fx.state, self.seat);
    for (const suit of fx.data.cards.suits) {
      const n = tally[suit] ?? 0;
      if (n > 0) drawFromCropDeck(fx, self.seat, self.card, suit, n);
    }
  },
};

/**
 * V11 The Market Master - v42: "For every card in your Barn, move a card of the
 * same crop from any of your buildings into your Barn."
 */
export const marketMaster: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: false },
    notes:
      'The barn is COUNTED BY CROP ONCE, at activation, before anything moves: a card that ' +
      'arrives cannot extend the loop that moved it. For each counted card you MAY move one ' +
      'card of that crop off one of your buildings into your barn (`Fx.stackCardToBarn`). ' +
      '"MOVE", NOT HARVEST: no afterHarvest, so no When-Harvested text, no W16 and no W18. ' +
      'It may take cards off a FULL building, which unclogs it. ' +
      '⚠️ BUILDER DEFAULT: NEVER FROM A NOTICE BOARD (S11: a board card leaves only by its ' +
      "owner's Harvest). No cap is printed and none is applied. " +
      'One re-entrant `stackMove` task: each answer names a building and a crop (stack ' +
      'identity dies on placement, so two cards of one crop on one stack are one choice), and ' +
      'a skip ends it - "may" is the builder reading of an effect the player would sometimes ' +
      'not want (a half-built stack loses progress). A sequence of single choices, never a ' +
      'subset enumeration. Replaces v31\'s "SOW 1 for every card in your Barn".',
  },
  activate(fx, self) {
    const budget = barnTally(fx.data, fx.state, self.seat);
    if (Object.values(budget).every((n) => (n ?? 0) <= 0)) return;
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'stackMove',
      riders: { budget },
    });
  },
  tasks: {
    stackMove: {
      answers(data, state, task) {
        const budget = task.riders.budget as Partial<Record<Suit, number>>;
        const out: TaskAnswer[] = [];
        for (const b of ownBuildings(data, state, task.pid)) {
          if (isNoticeBoardCard(data, b.card)) continue;
          for (const suit of data.cards.suits) {
            if ((budget[suit] ?? 0) <= 0) continue;
            if (!b.stack.some((id) => cardById(data, id).suit === suit)) continue;
            out.push({ kind: 'card', payload: { building: b.card, suit } });
          }
        }
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('stackMove expects a card answer');
        const building = answer.payload.building as CardId;
        const suit = answer.payload.suit as Suit;
        const b = player(fx.state, task.pid).tableau.find((x) => x.card === building);
        const card = b?.stack.find((id) => cardById(fx.data, id).suit === suit);
        if (card === undefined) throw new Error(`${building} holds no ${suit} card`);
        fx.stackCardToBarn(task.pid, building, card);
        const budget = { ...(task.riders.budget as Partial<Record<Suit, number>>) };
        budget[suit] = (budget[suit] ?? 0) - 1;
        task.riders.budget = budget;
        return Object.values(budget).every((n) => (n ?? 0) <= 0);
      },
    },
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
      '"Deliver Twice".',
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
 * V17 The Dockworker's Union - v45 (19/09/2026): "If, at the end of your turn,
 * your Barn is empty, place any deck card into your Barn." (was "Whenever you
 * discard a card from your Barn, Draw 1." on v42 - a full retext, not a
 * wording change.)
 */
export const dockworkersUnion: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      "⭐ RETEXTED ON SHEET v45 (Dean's ruling R5, `tasks/v45-rulings-v1.md`), and the card " +
      'moves to a completely different hook. It no longer listens on `afterBarnDiscard` at ' +
      "all - V8 and V15 are that hook's only listeners now (buildings.ts still fires it for " +
      "them; the hook itself is not deleted, only this card's wiring to it). " +
      'THE NEW LISTENER IS `beforeTurnEnd` (fx.ts), the hook `finishTurn` (turnflow.ts) fires ' +
      'once a turn, before the hand-limit discard - the same seam O18 A Helping Hand already ' +
      'uses, so V17 joins an existing seam rather than needing a new one. Owner-scoped ' +
      '("your turn"): the listener guards on `event.seat === self.seat`. MANDATORY (R5): the ' +
      'only choice is which deck, through the shared `deckToBarn` task (buildings.ts), the ' +
      "same one V4, A8/A13 and V16 use - the top card of a deck of the player's choosing, " +
      'never a search. FIRES ON A TURN WHERE THE BARN WAS NEVER TOUCHED, including most early ' +
      'turns, because the game starts with an empty barn and the condition is only "empty at ' +
      'the end of your turn". Checked ONCE, after the main action and any meeple spend, before ' +
      'the discard; a barn holding even one card at that moment does not fire it at all.',
  },
  on: {
    beforeTurnEnd(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (player(fx.state, self.seat).barn.length > 0) return;
      // A table with every deck AND discard dry offers nothing (the same guard
      // as V4 and V16, the other two `deckToBarn` call sites). Missing this
      // guard let the task push unconditionally, and `deckToBarnTask.answers()`
      // returns `[]` when nothing is drawable - a mandatory task with no
      // answer, which is a dead end the sim's driver reports as "no legal
      // moves and the game is not over" (found 19/09/2026 off
      // reference-v21:3:VOD+W:17, turn 70).
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
