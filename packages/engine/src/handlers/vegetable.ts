/**
 * Vegetable handlers - all 21 cards, REBUILT (docs/vegetable-suit-rebuild-v4.md,
 * docs/handoff-vegetable-engine-build.md). Card texts are quoted from cards.json
 * (the sheet is the single source of truth for wording).
 *
 * Suit identity: Deliver, and the rebuild's thesis is one line:
 *
 *     The island eats your barn. The balloon eats your hand.
 *     Vegetable is the only farm that can feed both at once.
 *
 * In the drafts before this one both outlets ate BARN cards, so a Vegetable seat
 * chose every turn between flying freight and scoring it. Paying for flights out
 * of the HAND removes the choice, and it is the change that made the suit work.
 *
 * Three structural things are new to the engine here, and two of them are the
 * suit:
 *
 *   1. **The island's demand tokens are MUTABLE.** V5 swaps two of them, V6
 *      turns one face down (and a face-down token accepts any crops). In 105
 *      cards nothing else touches the colour puzzle after setup - it is decided
 *      once, by the bag, before anybody has played a card. V5 and V6 ARE the
 *      suit; if they were ever cut for implementation cost the suit would go
 *      back to being four other suits wearing a green hat. Engine seams:
 *      `namedDemand` (one disjunction), `demandSwapOptions` /
 *      `demandFaceDownOptions`, and the two Fx verbs.
 *   2. **A balloon may be paid for out of the HAND** (V4, V8), via
 *      `doMoveBalloonFromHand`. A sibling of `doMoveBalloon`, never a branch
 *      inside it: the base rule - 2 barn cards of differing crops, spent as the
 *      Deliver action - is unchanged for everybody, Vegetable included.
 *   3. **One delivery may take BOTH of a tile's receipts** (V14), which is
 *      `doDeliver`'s `receipts` argument and falls out of `deliveredBy` being an
 *      ordered list: pay once, push the seat twice, and 6 + 3 = 9 with no
 *      scoring rule of its own.
 *
 * DEPOT is a sub-type derived from the whole-word title keyword, following the
 * reference (DL-42) and matching Wheat's FIELD and Orchard's ORCHARD: V4-V8, the
 * only cards in the catalogue named Depot. V12 and V20 both read it.
 *
 * The Tier 3 ACTION seam (V13/V14/V15) is Wheat's, unchanged - `actionMoves`,
 * `actionMove`/`actionOpen`, and `applyMove` spending the action first.
 */

import type { GameData, Suit } from '@gp/data';
import { deliveriesPerTile } from '@gp/data';

import {
  barnTally,
  demandFaceDownOptions,
  demandSwapOptions,
  deliverOptions,
  doDeliver,
  doMoveBalloonFromHand,
  grantBalloonReward,
  handBalloonMoveOptions,
  islandDeliveriesBy,
} from '../actions.js';
import type { DeliverOption, DemandRef } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player } from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { actionMove, actionOpen } from './actionCard.js';
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
 * THE FLIGHT, shared by V4 and V8: pick 2 hand cards and a balloon that is not
 * already yours, discard the cards, take the balloon.
 *
 * READING: the text is imperative ("Discard 2 cards to move a Balloon"), so it
 * is MANDATORY when it can be paid and auto-skips when it cannot - the drain
 * loop drops a task with no legal answer, which is the only way an empty hand or
 * an empty sky can decline it. That is the same reading the suit's imperative
 * cards have always taken, and it is honest to the card: a Grow spent on a Depot
 * is spent to fly.
 */
function flightAnswers(data: GameData, state: GameState, pid: Seat): TaskAnswer[] {
  return handBalloonMoveOptions(data, state, pid).map(
    (o) => ({ kind: 'card', payload: { balloon: o.balloon, cards: o.cards } }) as TaskAnswer,
  );
}

function takeFlight(fx: Fx, pid: Seat, answer: TaskAnswer, grantReward: boolean): string {
  if (answer.kind !== 'card') throw new Error('a flight expects a card answer');
  const { balloon, cards } = answer.payload as { balloon: string; cards: CardId[] };
  doMoveBalloonFromHand(fx, pid, balloon, cards, { grantReward });
  return balloon;
}

/**
 * V1 Barn (starter) - "Hand size 5. When you build a DEPOT, Draw 2." /
 * upgraded "Hand size 7. When you build a DEPOT, Draw 2."
 */
export const vegetableBarn: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Identical in shape to W1 and O1 - three rebuilt suits now teach the same sentence with ' +
      'one word changed. The printed hand size stays engine-read (handLimitOf off the current ' +
      'face); what is new is the rider, and it is on BOTH faces deliberately, because on the ' +
      'base face only, paying £2 to upgrade would delete the power. It fires on any build path ' +
      '- the action, a Service, a card-granted build - because afterBuild is the one funnel ' +
      'every landing goes through. A card-ability draw, so the Orchard modifier does not apply ' +
      '(DL-47). It matters more here than in the other two suits: this is the main thing paying ' +
      'for flights, and the hand is what the whole suit is short of. The old upgraded-face ' +
      'freight refund ("return 1 Vegetable to barn") is GONE, and with it this suit\'s only use ' +
      'of the reclaimDiscard primitive.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (!isDepotCard(fx.data, event.card)) return;
      drawN(fx, self.seat, self.card, 2);
    },
  },
};

/**
 * V2 Farmstead (starter) - "When you Deliver to the island, put 1 card from your
 * hand into your barn." / upgraded adds ", and you may swap 1 card in your barn
 * for the top card of any deck."
 */
export const vegetableFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'THE OLD "When you Deliver, gain £1 / £2" IS GONE, and its deletion is a rules fix rather ' +
      'than a balance one: it minted coins on a solitaire action, which the coin rule adopted ' +
      'with the Wheat rebuild forbids outright (a card may only mint at the moment another ' +
      'player acts). What replaces it moves a card instead of a coin. ' +
      'THE WORD "FIRST" (2026-08-09, Dean) IS THE WHOLE CARD, AND IT DOES NOT LIVE IN THIS FILE. ' +
      'Until it was added, this handler pushed a handToBarn on afterDeliver - which fires AFTER ' +
      'the payment - so the card it moved could not help pay for the delivery that triggered ' +
      'it. You had to already be able to deliver in order to earn the fuel for the next ' +
      'delivery, which is a circle, and it is why the card was worth 1.5 VP a game in a suit ' +
      "that needed four. Wheat's Farmstead relaxes the harvest and Orchard's modifies the " +
      "draw; both sit UPSTREAM of their suit's bottleneck and this one now does too. " +
      "The head is enumerated in actions.ts (deliverHeadSize / headCandidates / doDeliver's " +
      '`head`), NOT here, because it has to be visible to option enumeration and to LEGALITY: ' +
      'a Deliver that only becomes payable once a hand card is loaded has to be offered in the ' +
      'first place. It therefore composes with every route to an island delivery - the main ' +
      'action, the Deliver Service, V5, V6, V7, V14, V15 - which is what "when you Deliver to ' +
      'the island" says. It also composes with the wild substitution rather than duplicating ' +
      'it: one hand card plus one spare barn card is a card of the crate. ' +
      "ONLY WHAT IT LEAVES BEHIND IS HERE: the upgrade's barn swap, which still fires after the " +
      'delivery because recolouring the barn is a thing you do with the residue. ' +
      'GUARDED ON island === true: a balloon move is a Deliver (DL-12) but not a Deliver to the ' +
      'island, so V17 owns the flight trigger and this owns the island one. That split is why ' +
      'the rulebook line "a balloon move IS the Deliver action" has to stay visible. ' +
      'The swap names a suit OUT and a suit IN, because barn identity is inert - a barn is a ' +
      'per-crop tally, so a crop is the only thing there is to choose.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (!event.island || event.seat !== self.seat) return;
      const farmstead = player(fx.state, self.seat).tableau.find((b) => b.card === self.card);
      if (!farmstead?.upgraded) return;
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'barnSwap', riders: {} });
    },
  },
  tasks: {
    barnSwap: {
      answers(data, state, task) {
        const tally = barnTally(data, state, task.pid);
        const out: TaskAnswer[] = [];
        for (const [gone, n] of Object.entries(tally) as [Suit, number][]) {
          if (n < 1) continue;
          for (const into of liveDecks(data, state)) {
            out.push({ kind: 'card', payload: { gone, into } });
          }
        }
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('barnSwap expects a card answer');
        const { gone, into } = answer.payload as { gone: Suit; into: Suit };
        fx.spendFromBarn(task.pid, { [gone]: 1 } as Partial<Record<Suit, number>>);
        fx.deckTopToBarn(task.pid, into);
        return true;
      },
    },
  },
};

/** V3 Notice Board (starter) - "VISITOR: Take £1 from bank OR ..." */
export const vegetableNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here, and untouched by the rebuild: the whole visit - fee placement, the ' +
      'payoffs and the wage minting - is engine-level. Change 6 (the Notice Board absorbing the ' +
      'Service) has landed in the SHEET and not in the engine, so the printed text on this card ' +
      "is ahead of the code; that is change 6's ticket, not this one.",
  },
};

/**
 * V4 The Market Stall Depot - "Discard 2 cards to move a Balloon to your
 * Aerodrome and take its reward."
 */
export const marketStallDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'THE HAND-PAID FLIGHT, and the cheapest card in the suit at cost 1. It forced ' +
      'doMoveBalloonFromHand: a sibling of doMoveBalloon, not a branch inside it, so the base ' +
      'rule (2 barn cards of DIFFERING crops, spent as the Deliver action) is untouched for ' +
      'everybody including a Vegetable seat taking the plain action. No suit constraint on the ' +
      "fee - the differing-crops rule is what makes the barn payment the table's orphan sink, " +
      'and this route is deliberately unfussy so the fee is the worst two cards in hand. ' +
      'DECIDED (handoff §5): a hand-paid flight still fires afterDeliver with island: false, ' +
      'because moving a balloon IS the Deliver action (DL-12) and one funnel is worth more than ' +
      'the purity. Nothing reads a non-island deliver any more - the rebuilt Farmstead guards on ' +
      'island - so the choice is currently unobservable, and it is written down here because the ' +
      'next card that reads afterDeliver has to know which way it went. ' +
      'Mandatory when it can be paid; auto-skips on a hand of under 2 or an empty sky.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'flight', riders: {} });
  },
  tasks: {
    flight: {
      answers(data, state, task) {
        return flightAnswers(data, state, task.pid);
      },
      resolve(fx, task, answer) {
        takeFlight(fx, task.pid, answer, true);
        return true;
      },
    },
  },
};

/** V5 The Coastal Trading Depot - "You may swap two demand tokens on the island." */
export const coastalTradingDepot: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'THE FIRST CARD IN THE GAME THAT WRITES TO THE SHARED BOARD. It forced the mutable ' +
      'demand tokens: fx.swapDemandTokens plus demandSwapOptions, with the whole of the rule ' +
      'living in one disjunction in namedDemand. ' +
      'LEGALITY: both tiles must still have a receipt space (tileHasRoom), so a delivery already ' +
      'made is never retrospectively re-priced. Any two crates otherwise, same tile included. ' +
      'The options are de-duped by the island configuration each swap would produce, because ' +
      'crate ORDER carries no rule - offering two indistinguishable boards would double an ' +
      'already large answer list. A pair of identical tokens is a no-op and is never offered. ' +
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
        const out: TaskAnswer[] = demandSwapOptions(data, state).map(
          ([a, b]) => ({ kind: 'card', payload: { a, b } }) as TaskAnswer,
        );
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('swapDemand expects a card answer');
        const { a, b } = answer.payload as { a: DemandRef; b: DemandRef };
        fx.swapDemandTokens(task.pid, a, b);
        return true;
      },
    },
  },
};

/**
 * V6 The Trade Depot - "Turn face down a demand token on a tile where a receipt
 * has already been taken."
 */
export const tradeDepot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'The other half of the mutable demand tokens, and the one that points OUTWARD: a ' +
      'face-down token opens a crate for the whole table and the Vegetable seat is simply first ' +
      'in the queue. Theme: the second buyer is not fussy. ' +
      'THE "WHERE A RECEIPT HAS ALREADY BEEN TAKEN" CLAUSE IS THE TIMING DIAL, not flavour. It ' +
      'is what Dean\'s "this feels like a Tier 2 power" was answered with instead of a roster ' +
      'move: the card cannot fire on turn one because no tile has a receipt yet, and it comes ' +
      'alive exactly when the race starts. It is enumerated in demandFaceDownOptions rather than ' +
      'merely asserted in the verb, so an illegal target is never offered. It also protects what ' +
      'the island is FOR: gating the wild to half-run tiles keeps the colour puzzle hard while it ' +
      'matters and soft only where the race is already over. ' +
      'A cornucopia and an already-blank token are both skipped - turning either buys nothing. ' +
      'Mandatory as printed, and it simply has no legal target early, in which case the drain ' +
      'loop drops the task. Happy accident worth keeping: V14 wants a VIRGIN tile and this wants ' +
      'a half-filled one, so they point at opposite ends of the island and never compete. ' +
      '"THEN DELIVER" ADDED 2026-08-09 (Dean), same reasoning as V5: the card was bottom of its ' +
      'band at 22% built and fired 0.0 times a game, because a GROW that produces nothing loses ' +
      'to any GROW that draws. Opening the crate and filling it is now one action. ' +
      '⚠️ THE THRESHOLD WAS NOT DROPPED. The review recommended 3 -> 2 as the fix; the Deliver ' +
      'was approved instead, and stacking both would have been two buffs on one card. If the ' +
      'card is still inert after the arm, the threshold is the next dial.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'faceDown', riders: {} });
    // Queued after the face-down, so the delivery sees the opened crate. The
    // face-down is mandatory but can have no legal target early, in which case
    // the drain loop drops it and the delivery still runs (the W15/A5 precedent).
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
  tasks: {
    faceDown: {
      answers(data, state) {
        return demandFaceDownOptions(data, state).map(
          (ref) => ({ kind: 'card', payload: { ...ref } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('faceDown expects a card answer');
        const { tile, crate } = answer.payload as { tile: string; crate: number };
        fx.turnDemandFaceDown(task.pid, tile, crate);
        return true;
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
      'The Deliver is the full action - island claims AND balloon moves (DL-12) - and auto-skips ' +
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
 * V8 The Regional Depot - "Discard 2 cards to move a Balloon to your Aerodrome
 * and take the reward of any Balloon."
 */
export const regionalDepot: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'V4 plus the choice of cargo, at one card more and one threshold higher - a proper ladder. ' +
      'It is the interesting one: balloon rewards are welded to colours (Draw 4 / Build at a ' +
      'discount of 4 / Sow 4 from hand / Gain £4), so which reward you can have is normally an ' +
      'accident of where the balloons are parked, and this severs reachability from cargo. ' +
      "The moved balloon's OWN reward is suppressed at source (the shared landBalloon helper's " +
      'grantReward flag) rather than granted and then compensated for, so it can never fire ' +
      'twice; the chosen reward is then granted from ANY balloon in the game, the one just moved ' +
      'included. ' +
      '⚠️ RULING H, OWED BY DEAN: the magenta balloon\'s "Gain £4" is a solitaire coin faucet, ' +
      'which the coin rule forbids, and this card can now target it DELIBERATELY for 2 hand ' +
      "cards. The fault is the reward, not the card. Report the £4 balloon's take rate in the " +
      'arm - if V8 always picks magenta, that is the finding.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'flightAny', riders: {} });
  },
  tasks: {
    flightAny: {
      answers(data, state, task) {
        return flightAnswers(data, state, task.pid);
      },
      resolve(fx, task, answer) {
        takeFlight(fx, task.pid, answer, false);
        fx.prependTask({
          t: 'card',
          pid: task.pid,
          src: task.src,
          kind: 'anyReward',
          riders: {},
        });
        return true;
      },
    },
    anyReward: {
      answers(_data, state) {
        const aero = state.aerodrome;
        if (!aero) return [];
        return aero.balloons.map(
          (b) => ({ kind: 'card', payload: { balloon: b.id } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('anyReward expects a card answer');
        grantBalloonReward(fx, task.pid, answer.payload.balloon as string);
        return true;
      },
    },
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
      'game flow through it by harvest) and not a store, and the wild substitution is what keeps ' +
      'the level down. A "for each X" with nothing raising X is a lottery ticket (docs/innovation.md). ' +
      'What replaces it is flat and upstream, and it is the suit in one line: Draw refills the ' +
      'hand, which flights and visits both eat, and the card into the barn loads the thing the ' +
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

/**
 * V11 The Market Master - "SOW up to 1 card from your hand onto your buildings
 * for each card in your barn."
 */
export const marketMaster: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "The whole hand onto the tableau, once the barn is deep - the suit's wow card at Tier 2. " +
      'ONE re-entrant sow task with the printed count as its budget rather than N separate ' +
      'tasks: the generic sow task already decrements and already ends on a skip, which is ' +
      'exactly "up to N", and it auto-drops when the hand empties or nothing has room. Sow is ' +
      'suit-free (ruled 2026-07-20) and the generic task restricts targets to your own ' +
      'buildings. ' +
      '⚠️ It SPENDS the hand, as V12 and every flight do. Three cards competing for a hand of 5 ' +
      "is the suit's named risk, and an empty hand cannot visit.",
  },
  activate(fx, self) {
    const budget = player(fx.state, self.seat).barn.length;
    if (budget <= 0) return;
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: budget, optional: true });
  },
};

/**
 * V12 The Auction House - "Put up to 1 card from your hand into your barn for
 * each DEPOT you have built."
 */
export const auctionHouse: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The consignment: hand into barn, one per DEPOT, so the Tier 1 layer is literally its ' +
      'supply. Caps at 5. Ruling D is CLOSED by this retext - the old "treat any 1 card as a ' +
      'Vegetable" overlapped the universal wild substitution and is gone, taking doDeliver\'s ' +
      "countAs parameter out of Vegetable's hands (the parameter itself stays, unused, because " +
      'removing it is a separate edit to a shared funnel). One re-entrant handToBarn task with ' +
      'the count as its budget, skippable at every step ("up to").',
  },
  activate(fx, self) {
    const budget = builtDepots(fx.data, fx.state, self.seat).length;
    if (budget <= 0) return;
    fx.pushTask({
      t: 'handToBarn',
      pid: self.seat,
      src: self.card,
      remaining: budget,
      optional: true,
    });
  },
};

/**
 * V13 The Grand Marketplace (ACTION) - "For each different crop in your barn,
 * put the top card of that crop's deck into your barn."
 */
export const grandMarketplace: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: true, endgame: false },
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
      'first card in the suit that adds to a barn without a delivery in the same breath.',
  },
  actionMoves: true,
  moves(data, state, self) {
    return actionMove(self, actionOpen(state, self) && cropsToRefill(data, state, self.seat) > 0);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
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

function cropsToRefill(data: GameData, state: GameState, seat: Seat): number {
  return refillCrops(data, state, seat).length;
}

/**
 * V14 The Distribution Center (ACTION) - "Deliver to a tile where nobody has
 * delivered, and take both of its receipts."
 */
export const distributionCenter: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: true, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      'CHEAPER THAN IT READS, because deliveredBy is a Seat[] IN ORDER and the seat at index i ' +
      'took vpByDeliveryOrder[i]. So "both receipts" is: assert the tile is virgin, pay its cost ' +
      'ONCE, and push the seat TWICE - 6 + 3 = 9 with no scoring rule of its own. That is ' +
      "doDeliver's `receipts` argument, which defaults to 1 for every other delivery in the " +
      'game. It emits one `delivered` event per receipt so nothing counting deliveries has to ' +
      'learn about the double, and fires afterDeliver ONCE, because it is one Deliver and the ' +
      'Farmstead pays per delivery rather than per receipt. ' +
      'ISLAND ONLY: no balloon branch, because a balloon has no receipts. ' +
      '⚠️ RULING G, OWED BY DEAN: two receipts count as TWO deliveries toward the six-delivery ' +
      'end trigger, which is what islandDeliveriesBy does for free and is the recommendation. ' +
      'The trigger check runs after BOTH pushes. If Dean rules the other way it is a real change ' +
      'and needs a dial; there is deliberately no dial for it yet.',
  },
  actionMoves: true,
  moves(data, state, self) {
    const live = actionOpen(state, self) && virginDeliveries(data, state, self.seat).length > 0;
    return actionMove(self, live);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'doubleDeliver', riders: {} });
  },
  tasks: {
    doubleDeliver: {
      answers(data, state, task) {
        return virginDeliveries(data, state, task.pid).map(
          (o) =>
            ({
              kind: 'card',
              // The head rides on the answer or the spend is validated against a
              // barn the cards never reached. This is a `card` payload rather
              // than the shared `deliver` answer, so it does NOT get the wiring
              // in tasks.ts for free and has to carry it by hand.
              payload: { tile: o.tile, spend: o.spend, ...(o.head ? { head: o.head } : {}) },
            }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('doubleDeliver expects a card answer');
        const { tile, spend, head } = answer.payload as {
          tile: string;
          spend: Partial<Record<Suit, number>>;
          head?: CardId[];
        };
        doDeliver(fx, task.pid, tile, spend, undefined, 2, head);
        return true;
      },
    },
  },
};

/**
 * Payable deliveries to tiles NOBODY has delivered to, and which have room for
 * BOTH receipts. Filtered off the shared enumerator rather than re-derived, so
 * the wild substitution and the face-down tokens both compose with V14 for free.
 *
 * The capacity test is against the VP schedule's length rather than
 * `tileHasRoom`, because this delivery needs two spaces and not one: an overlay
 * that shortened the schedule to a single receipt would make the card dead
 * rather than make it throw.
 */
function virginDeliveries(data: GameData, state: GameState, seat: Seat): DeliverOption[] {
  if (deliveriesPerTile(data) < 2) return [];
  const virgin = new Set(
    state.island.tiles.filter((t) => t.deliveredBy.length === 0).map((t) => t.tile),
  );
  return deliverOptions(data, state, seat).filter((o) => virgin.has(o.tile));
}

/**
 * V15 The International Port (ACTION) - "Put the top card of any deck into each
 * other player's barn, take £1 for each, then Deliver."
 */
export const internationalPort: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: true, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: true, interrupts: true },
    notes:
      'The suit\'s "each other player" card. ' +
      'THE £1 BECAME A DRAW 1 on 2026-08-09 (Dean, off the post-implementation review). The ' +
      'arithmetic was upside down: at four seats you handed the table three barn cards, worth ' +
      'about 1.5 VP each through the delivery rate, to receive £3 in a game that ends on a ' +
      'median of £1-£2 with the market running at 0.1 buys a game. You were paying to improve ' +
      "everybody else's position, which is the predecessor's number one BGG dislike pointed the " +
      'wrong way. The generosity and the cross-table moment are unchanged; the compensation is ' +
      'now the resource the suit is actually short of. It also takes the last solitaire coin ' +
      "faucet out of the suit, which the coin rule wanted anyway - V16's raid payment is the " +
      'only £ Vegetable prints now, and it needs a rival to act. ' +
      'NO RIVAL IS EVER ASKED ANYTHING: YOU choose which deck each of them gets, so every task ' +
      'here belongs to the acting seat and the rivals simply receive. That keeps the card off ' +
      'the "prompts a rival" list and makes it a gift with a price rather than a negotiation. ' +
      'The draw fires on the act (the W15/A5 "then" precedent), and only drawable decks are ever ' +
      'offered, so a deck emptying between enumeration and resolution is not reachable. ' +
      'It scales with the seat count - one rival card and one draw at 2p, three of each at 4p - ' +
      'which is deliberate for the only card in the suit that reads the table. ' +
      'The Deliver is the full action (island AND balloon) and auto-skips when nothing is ' +
      'payable; it runs after the gifts because tasks answer in queue order.',
  },
  actionMoves: true,
  moves(data, state, self) {
    const live = state.players.length > 1 && liveDecks(data, state).length > 0;
    return actionMove(self, actionOpen(state, self) && live);
  },
  applyMove(fx, self) {
    fx.state.turn.actionSpent = true;
    for (let host = 0; host < fx.state.players.length; host++) {
      if (host === self.seat) continue;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'consign',
        riders: { to: host },
      });
    }
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
  tasks: {
    consign: {
      answers(data, state) {
        return liveDecks(data, state).map((suit) => ({ kind: 'deck', suit }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'deck') throw new Error('consign expects a deck answer');
        fx.deckTopToBarn(task.riders.to as Seat, answer.suit);
        // PREPENDED, not pushed: the Deliver is already queued behind every
        // consign, and a pushed draw would land behind it and read "then
        // Deliver, then draw". The card says the draws come first.
        fx.prependTask({ t: 'draw', pid: task.pid, src: task.src, see: 1, keep: 1, revealed: [] });
        return true;
      },
    },
  },
};

/**
 * V16 The Market Signal Tower - "Whenever a neighbour moves a Balloon from your
 * Aerodrome, take £2."
 */
export const marketSignalTower: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The second of the two cards in the suit that print a £, and like the first it needs a ' +
      'neighbour: this pays for BEING RAIDED. Owner-scoped on the afterBalloonMove hook, guarded ' +
      "both ways - the balloon left THIS seat's Aerodrome and somebody else took it - so it can " +
      "never fire on its owner's own flight. crossPlayer: it mints for its owner mid a rival's " +
      'turn. ' +
      'Together with V19 and re-flying, it makes a parked balloon worth three different things ' +
      'you can only have one of: 2 VP if you keep it, £2 if a neighbour comes for it, or a fresh ' +
      'reward if you fly it out again. That triangle costs no rules at all. ' +
      '⚠️ Assertion 12 (a12-balloon-raid) reports the score gap for raided seats, and this card ' +
      'plus V19 deliberately make being raided profitable. Re-read it before believing it.',
  },
  on: {
    afterBalloonMove(fx, event, self) {
      if (event.from !== self.seat || event.seat === self.seat) return;
      fx.gainCoins(self.seat, 2, 'V16');
    },
  },
};

/** V17 The Dockworker's Union - "Whenever you move a Balloon, Draw 1." */
export const dockworkersUnion: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'LOAD-BEARING RATHER THAN DECORATIVE, and the first card a Vegetable seat should buy. A ' +
      'flight costs 2 hand cards and this refunds 1, which is the difference between the balloon ' +
      'layer being affordable and being a hand-shredder. ' +
      'ACTOR-scoped, and it fires on EVERY move the owner makes - the plain barn-paid Deliver ' +
      "action, a hand-paid Depot flight, V8's - because the hook is one and the card names no " +
      'route. That is the mirror image of the Farmstead, which fires only on the ISLAND half; ' +
      'between them they split the Deliver action in two, and that split is why "a balloon move ' +
      'IS the Deliver action" has to stay printed in the rulebook.',
  },
  on: {
    afterBalloonMove(fx, event, self) {
      if (event.seat !== self.seat) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/** V19 The Market Gazette - "Game end: 2 VP for each Balloon at your Aerodrome." */
export const marketGazette: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'The fleet you kept, and the third corner of the parked-balloon triangle (see V16). Caps ' +
      'at 8 with all four balloons, which against a winning score of ~38 is a lot - but holding ' +
      'four means never re-flying one, and every rival with a Depot can come and take them. ' +
      'Reads the module directly, so it is simply worth 0 in a game with no Vegetable seat, ' +
      'which cannot happen: only a Vegetable seat can build it.',
  },
  gameEnd(_data, state, seat) {
    return 2 * (state.aerodrome?.balloons.filter((b) => b.at === seat).length ?? 0);
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
