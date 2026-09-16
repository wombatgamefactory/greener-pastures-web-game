/**
 * Vegetable handlers - all 21 cards, REBUILT (docs/vegetable-suit-rebuild-v4.md,
 * docs/handoff-vegetable-engine-build.md). Card texts are quoted from cards.json
 * (the sheet is the single source of truth for wording).
 *
 * Suit identity: Deliver. ⛔ The rebuild's second outlet, the balloons, was
 * deleted on 16/09/2026 (R1), and V4, V8, V16, V17 and V19 are inert until the
 * v42 Vegetable texts are built (slice 6).
 *
 * Structural things this suit brought to the engine:
 *
 *   1. **The island's tokens are MUTABLE.** V5 swaps two of them between two
 *      island cards (the token island, 16/09/2026: each token keeps its VP and
 *      its Worker). Engine seams: `tokenSwapOptions` and `fx.swapIslandTokens`.
 *      ⛔ V6's face-down token was deleted with the crate island; v42's V6
 *      prints something else and its handler is owed (slice 6).
 *   2. **One delivery may take EVERY receipt a tile has left** (V14), which is
 *      `doDeliver`'s `takeAll` choice: pay the same 4 cards once and take both
 *      tokens, or the last one.
 *
 * DEPOT is a sub-type derived from the whole-word title keyword, following the
 * reference (DL-42) and matching Wheat's FIELD and Orchard's ORCHARD: V4-V8, the
 * only cards in the catalogue named Depot. V12 and V20 both read it.
 *
 * THE ACTION CARD IS GONE (19/08/2026, Dean: "The concept of an ACTION was never
 * requested. They are all GROW."). V13, V14 and V15 used to be the suit's three
 * standing-move ACTION cards - no threshold, no activation type, one `cardMove`
 * whose `applyMove` set `turn.actionSpent` before it did anything else. They are
 * now ordinary owner-activated buildings: the sheet gives all three threshold 1
 * and a wild activation type, so a GROW pays one card of ANY crop into the stack
 * and the printed ability fires from `activate`. Nothing in this file spends the
 * action any more - GROW *is* the action and the grow runtime books it - and
 * `actionMoves`, `actionMove` and `actionOpen` have left the file with it.
 *
 * Two consequences are easy to miss and worth writing down. A Tier 3 card is now
 * CLOGGABLE like every other building: one card on it and it is full until its
 * owner spends an action harvesting, so the suit's three biggest effects are
 * once-per-harvest-cycle rather than once-per-turn. And each of them now costs a
 * card as well as the action, which is a price the ACTION shape never paid - so
 * the conversion is a nerf on tempo even where the printed text got stronger.
 */

import type { GameData, Suit } from '@gp/data';

import {
  barnTally,
  deliverOptions,
  doDeliver,
  islandDeliveriesBy,
  tokenSwapOptions,
} from '../actions.js';
import type { TokenRef } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player } from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { barnCropScorer, farmsteadHandler } from './farmstead.js';
import type { CardHandler } from './types.js';

const DEPOT_NAME = /\bDepot\b/;

/** DEPOT sub-type membership, by whole-word title keyword (reference DL-42). */
export function isDepotCard(data: GameData, id: CardId): boolean {
  return DEPOT_NAME.test(cardById(data, id).name);
}

function builtDepots(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isDepotCard(data, b.card));
}

/** Push a see-N/keep-N "Draw N" for a card ability (each card from any deck). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** Decks on the table with cards left - V13's and V15's "any deck". */
function liveDecks(data: GameData, state: GameState): Suit[] {
  return drawableSuits(data, state).filter((s) => state.suitsInPlay.includes(s));
}

/**
 * V1 Barn (starter) - prints NOTHING (v31).
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
 * V3 Notice Board (starter) - "VISITOR: place 1 card here, then Deliver."
 * Threshold 2, wild activation.
 */
export const vegetableNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the fee landing, the door action and the clog at threshold 2 are ' +
      'all engine-level, and the door is the PLAIN Deliver. ' +
      '⛔ Its coin payoff and its hand-card-into-the-barn rider are both gone (v31). ' +
      '⚠️ IT IS THE DOOR MOST LIKELY TO BE DEAD FOR A VISITOR, and the engine rules that a ' +
      'door which can do nothing is not offered: a seat with an empty barn simply is not ' +
      'shown this board. That is a real lockout - a seat can be shut ' +
      "out of the bonus slot's interaction half entirely - and `bonusDraw` is what backstops " +
      'it.',
  },
};

/**
 * V4 The Market Stall Depot (v39: "Discard 1 card to move a Balloon ...").
 *
 * ⛔ INERT SINCE 16/09/2026: the balloons and the Aerodrome were deleted (R1).
 */
// v42 handler owed (slice 6)
export const marketStallDepot: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Inert: its balloon text died with the balloons on 16/09/2026. v42 handler owed (slice 6).',
  },
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
      'offered. v42 prints "You may swap two demand tokens between 2 islands, then Deliver"; ' +
      'the full v42 handler pass is owed (slice 6). ' +
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
        // cards, each keeping its VP and Worker. v42's text is "You may swap two
        // demand tokens between 2 islands, then Deliver", which this already
        // is; the full v42 handler pass is owed (slice 6).
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

/** V6 The Trade Depot - v42: "Swap up to 2 cards between your hand and your Barn, then Draw 1." */
export const tradeDepot: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Inert since 16/09/2026: its face-down demand token died with the crate island, and the ' +
      'v42 text is a hand/barn swap. v42 handler owed (slice 6).',
  },
  // v42 handler owed (slice 6). The face-down token this card turned was
  // deleted with the crate island on 16/09/2026, and v42's V6 prints "Swap up
  // to 2 cards between your hand and your Barn, then Draw 1", so the card is
  // INERT until that handler is written.
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

/**
 * V8 The Regional Depot (v39: "Move a Balloon to your Aerodrome ...").
 *
 * ⛔ INERT SINCE 16/09/2026: the balloons and the Aerodrome were deleted (R1).
 */
// v42 handler owed (slice 6)
export const regionalDepot: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Inert: its balloon text died with the balloons on 16/09/2026. v42 handler owed (slice 6).',
  },
};

/** V9 The Merchant Guild - "Draw 1 for each different crop in your barn." */
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

/** V10 The Supply House - "Draw 1 for each receipt you have taken." */
export const supplyHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "The suit's other hand refill, and the one that pays for having done the thing the suit " +
      'is for. Counted off the ISLAND (islandDeliveriesBy) rather than off player.receipts, for ' +
      'the same reason the end trigger is: the count has to stay a count of things visible on ' +
      "the board. It therefore counts V14's two receipts as two, which is ruling G's " +
      'recommendation applied consistently. ' +
      'ZERO FLOOR IS INTENDED: it is dead until the first delivery, which is what makes it a ' +
      'payoff card rather than a supply card, and it is capped by the six-delivery end trigger.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, islandDeliveriesBy(fx.state, self.seat));
  },
};

/** V11 The Market Master - "SOW 1 for every card in your Barn." */
export const marketMaster: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "The whole hand onto the tableau, once the barn is deep - the suit's wow card at Tier 2. " +
      'ONE re-entrant sow task with the printed count as its budget rather than N separate ' +
      'tasks: the generic sow task already decrements, and it auto-drops when the hand empties ' +
      'or nothing has room. Sow is suit-free (ruled 2026-07-20) and the generic task restricts ' +
      "targets to your own buildings. WHICH card goes where is still the player's choice, and " +
      'that is the whole of the decision the card offers now. ' +
      '"UP TO" WAS DROPPED ON 19/08/2026 AND THE SOW IS MANDATORY. Dean has ruled this a ' +
      'DELIBERATE POWER-UP, not a wording slip, so it is coded as forced: `optional` comes off ' +
      'the task and no skip answer is ever offered. Read it as the card getting louder rather ' +
      'than the card getting a downside - the sow that used to be declinable is now the point. ' +
      'THE NO-OP CONVENTION (plan §8.3) IS SKIP SILENTLY: with no legal target - an empty hand, ' +
      'or every building of yours full - the enumerator returns nothing and the drain loop drops ' +
      'the task. The activation is never refused and never wedges, and a partly-payable budget ' +
      'does as much as it can and then drops. That is the same answer V12 takes, and it is the ' +
      'one answer applied to every mandatory effect in this pass. ' +
      '⚠️ IT SPENDS THE HAND AND YOU CAN NO LONGER STOP IT. That is a real cost in a suit whose ' +
      'hand is its bottleneck: three cards competing for a hand of 5 is the named risk, an empty ' +
      'hand cannot visit, and a deep barn now forces the whole hand onto buildings whether or ' +
      'not you wanted the thresholds. Watch for a seat that builds V11 and then cannot afford ' +
      'the bonus slot for two turns.',
  },
  activate(fx, self) {
    const budget = player(fx.state, self.seat).barn.length;
    if (budget <= 0) return;
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: budget });
  },
};

/**
 * V12 The Auction House - "Put 1 card from your hand into your barn for each
 * DEPOT you have built."
 */
export const auctionHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The consignment: hand into barn, one per DEPOT, so the Tier 1 layer is literally its ' +
      'supply. Caps at 5. Ruling D is CLOSED by an earlier retext - the old "treat any 1 card as ' +
      'a Vegetable" overlapped the universal wild substitution and is gone, taking doDeliver\'s ' +
      "countAs parameter out of Vegetable's hands (the parameter itself stays, unused, because " +
      'removing it is a separate edit to a shared funnel). One re-entrant handToBarn task with ' +
      'the count as its budget. ' +
      '"UP TO" WAS DROPPED ON 19/08/2026 AND THE DEPOSIT IS MANDATORY, ruled by Dean as a ' +
      'DELIBERATE POWER-UP exactly as V11 was, so `optional` comes off the task and there is no ' +
      'skip answer. This is the sharper of the two: barn cards are worth roughly 1.5 VP each ' +
      'through the delivery rate, so being made to move five of them is mostly upside - but the ' +
      'barn is a DEAD END (barn to island only), so a hand emptied into it cannot be built with, ' +
      'flown with or visited with. A late-game V12 with five Depots on a hand you were saving is ' +
      'the case to watch. ' +
      'THE NO-OP CONVENTION (plan §8.3) IS SKIP SILENTLY, the same answer V11 takes: an empty ' +
      'hand enumerates no answers and the drain loop drops the task, and a hand shorter than the ' +
      'budget moves what it has and then drops. No DEPOT built is caught one step earlier by the ' +
      'zero-budget guard, which never pushes the task at all - same observable outcome, and the ' +
      'guard is kept because pushing a task with a budget of nothing is a lie about what ' +
      'happened.',
  },
  activate(fx, self) {
    const budget = builtDepots(fx.data, fx.state, self.seat).length;
    if (budget <= 0) return;
    fx.pushTask({
      t: 'handToBarn',
      pid: self.seat,
      src: self.card,
      remaining: budget,
    });
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

/** V14 The Distribution Center - "Deliver and take every receipt on the island card." (v42 adds "then destroy this building", slice 6) */
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
      'because it is one Deliver. v42 adds "then destroy this building" and a cost of 3: owed ' +
      'in slice 6. ' +
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
        // ⚠️ BUILDER DEFAULT). v42 adds "then destroy this building": owed in
        // slice 6.
        doDeliver(fx, task.pid, tile, spend, { takeAll: true });
        return true;
      },
    },
  },
};

/** V15 The International Port - "Deliver Twice" */
export const internationalPort: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'THE SUIT\'S "EACH OTHER PLAYER" CARD IS GONE (19/08/2026). It used to read "Put the top ' +
      'card of any deck into each other player\'s barn, Draw 1 for each, then Deliver", and both ' +
      'the gift and its compensation have been deleted. What is left is two Deliver actions in ' +
      'one activation, and nothing else. crossPlayer goes false with it: Vegetable now touches ' +
      'another seat in exactly one place, V16 being raided. ' +
      'That is a real loss to the hook and it should be recorded as one rather than passed off ' +
      'as a simplification. The card was the only place in the suit where a Vegetable turn put ' +
      'something on somebody else\'s side of the table, and the "your junk is their treasure" ' +
      'supply line has one fewer source. The counter-argument, and the reason the cut is ' +
      'defensible: the gift was never the reason anybody built it, the arithmetic had already ' +
      'been reversed once (2026-08-09, the coin became a draw) for handing rivals barn cards ' +
      'worth ~1.5 VP each, and Tier 3 is the wrong slot for a card whose text is mostly about ' +
      'other people. ' +
      'TWO SEPARATE DELIVERS, not one delivery scoring twice, which is the whole difference ' +
      'between this and V14. Each is a plain deliver task off the shared enumerator, so each is ' +
      'PAID for separately, TARGETED separately, and takes ONE receipt. Two tasks rather than one task with ' +
      'a budget of 2, because the deliver task has no budget field and does not need one - the ' +
      'queue is the counter. ' +
      'MANDATORY AS PRINTED, and it auto-skips per delivery: the drain loop drops a deliver task ' +
      'with no payable answer, so a seat that can afford one delivery and not a second simply ' +
      'takes the one. The second task also enumerates AFTER the first has resolved, so a barn ' +
      'emptied by delivery one correctly offers nothing for delivery two - and a Farmstead deck ' +
      'card that arrived on delivery one is available to pay for delivery two. ' +
      'IT GRANTS DELIVERIES, TWO AT A TIME, and six by one seat ends the game. This is the ' +
      'fastest end-trigger route in the suit, ahead of V7 and V14, and worth watching for an ' +
      'abrupt ending at 2p. ' +
      'CONVERTED FROM ACTION TO GROW in the same pass: the standing move and its applyMove are ' +
      'gone, the turn.actionSpent line came out, and it now costs a card into its own stack. ' +
      'SHEET TIDY OWED: the printed text is "Deliver Twice" - capitalised as a title and with ' +
      'no full stop. Cosmetic, and not fixable from the engine (cards.json is generated).',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
};

/**
 * V16 The Market Signal Tower (v39: "Whenever a neighbour moves a Balloon ...").
 *
 * ⛔ INERT SINCE 16/09/2026: the balloons and the Aerodrome were deleted (R1).
 */
// v42 handler owed (slice 6)
export const marketSignalTower: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Inert: its balloon text died with the balloons on 16/09/2026. v42 handler owed (slice 6).',
  },
};

/**
 * V17 The Dockworker's Union (v39: "Whenever you move a Balloon, Draw 1.").
 *
 * ⛔ INERT SINCE 16/09/2026: the balloons and the Aerodrome were deleted (R1).
 */
// v42 handler owed (slice 6)
export const dockworkersUnion: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Inert: its balloon text died with the balloons on 16/09/2026. v42 handler owed (slice 6).',
  },
};

/**
 * V19 The Market Gazette (v39: "Game end: 2 VP for each Balloon at your Aerodrome.").
 *
 * ⛔ INERT SINCE 16/09/2026: the balloons and the Aerodrome were deleted (R1).
 */
// v42 handler owed (slice 6)
export const marketGazette: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'Inert: its balloon text died with the balloons on 16/09/2026. v42 handler owed (slice 6).',
  },
};

/** V20 The Trading Commission - "Game end: 2 VP for each DEPOT you have built." */
export const tradingCommission: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The depth of the network. DEPOT = the whole-word title keyword, exactly V4-V8, so this ' +
      'caps at 10 VP - it was 1 VP a Depot and the sheet now says 2, which roughly doubles it ' +
      'against a winning score that has fallen from ~65 to ~38. Reads the same definition V12 ' +
      'does, which is why DEPOT has to be printed as meaning the five Tier 1 cards. ' +
      "⚠️ Same unresolved keyword problem as Wheat's FIELD and Orchard's ORCHARD: the " +
      'convention contradicts nothing in Vegetable today (all five Tier 1 cards really are named ' +
      'Depot and nothing else is), but it is one shared ruling across the suits and should be ' +
      'settled once.',
  },
  gameEnd(data, state, seat) {
    return 2 * builtDepots(data, state, seat).length;
  },
};

/** V21 The Harvest Ledger - "Game end: 1 VP for every 2 cards in your barn." */
export const harvestLedger: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The residue, and deliberately priced UNDER the delivery rate. A barn payout must sit ' +
      'below roughly 1.5 VP per barn card or it pays you to hold freight back from the island; ' +
      'at 0.5 shipping always wins and the card is insurance, worth 2 to 3 VP. Counts CARDS, ' +
      'not crops - the old "2 VP per different crop colour" is gone, and with it a second card ' +
      'pointing at the same variety metric V9 already owns.',
  },
  gameEnd(_data, state, seat) {
    return Math.floor(player(state, seat).barn.length / 2);
  },
};
