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
 *      `namedDemand` (one disjunction), `demandSwapOptions`, and the two Fx
 *      verbs. V6's own target list moved INTO this file on 19/08/2026
 *      (`faceDownTargets`), because the card dropped its eligibility filter and
 *      `demandFaceDownOptions` in actions.ts still enforces it.
 *   2. **A balloon may be paid for out of the HAND** (V4, V8), via
 *      `doMoveBalloonFromHand`. A sibling of `doMoveBalloon`, never a branch
 *      inside it: the base rule - 2 barn cards of differing crops, spent as the
 *      Deliver action - is unchanged for everybody, Vegetable included.
 *   3. **One delivery may take EVERY receipt a tile has left** (V14), which is
 *      `doDeliver`'s `receipts` argument and falls out of `deliveredBy` being an
 *      ordered list: pay once, push the seat as many times as the tile has room
 *      for, and 6 + 3 = 9 with no scoring rule of its own.
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
import { deliveriesPerTile } from '@gp/data';

import {
  barnTally,
  demandSwapOptions,
  deliverOptions,
  doDeliver,
  doMoveBalloon,
  doMoveBalloonFromHand,
  handBalloonMoveOptions,
  islandDeliveriesBy,
  tileHasRoom,
} from '../actions.js';
import type { DemandRef } from '../actions.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player } from '../query.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
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
 * THE HAND-PAID FLIGHT, V4's and V4's alone since 19/08/2026: pick the printed
 * number of hand cards and a balloon that is not already yours, discard the
 * cards, take the balloon and its reward.
 *
 * It used to be shared with V8, which paid the same fee for the reward of ANY
 * balloon. V8's retext deleted both halves of that - no fee, and the reward is
 * the moved balloon's own - so it now goes through `doMoveBalloon` with a null
 * spend (a card effect's FREE move) and this helper has one caller left. Kept as
 * a helper rather than inlined because the fee count is data (`handMoveCost`)
 * and a second hand-paid flight is a plausible card.
 *
 * READING: the text is imperative ("Discard 1 card to move a Balloon"), so it is
 * MANDATORY when it can be paid and auto-skips when it cannot - the drain loop
 * drops a task with no legal answer, which is the only way an empty hand or an
 * empty sky can decline it. That is the same reading the suit's imperative cards
 * have always taken, and it is honest to the card: a Grow spent on a Depot is
 * spent to fly.
 */
function flightAnswers(data: GameData, state: GameState, pid: Seat): TaskAnswer[] {
  return handBalloonMoveOptions(data, state, pid).map(
    (o) => ({ kind: 'card', payload: { balloon: o.balloon, cards: o.cards } }) as TaskAnswer,
  );
}

function takeFlight(fx: Fx, pid: Seat, answer: TaskAnswer): string {
  if (answer.kind !== 'card') throw new Error('a flight expects a card answer');
  const { balloon, cards } = answer.payload as { balloon: string; cards: CardId[] };
  doMoveBalloonFromHand(fx, pid, balloon, cards);
  return balloon;
}

/**
 * V6's targets since 19/08/2026: one face-up, non-cornucopia token per tile that
 * still has a receipt space.
 *
 * A LOCAL COPY OF `demandFaceDownOptions` MINUS ONE LINE, and the line is the
 * whole retext. actions.ts still filters to tiles where a receipt has already
 * been taken, which was V6's timing dial until the sheet dropped the clause;
 * this file owns the card, so the card's own eligibility lives here rather than
 * being asserted twice. Everything else is deliberately identical - the room
 * check, the cornucopia and already-blank exclusions, and the per-tile dedupe by
 * token VALUE (two vegetable crates on one tile are one choice, not two).
 */
function faceDownTargets(data: GameData, state: GameState): DemandRef[] {
  const out: DemandRef[] = [];
  for (const tile of state.island.tiles) {
    if (!tileHasRoom(data, tile)) continue;
    const seen = new Set<string>();
    for (let i = 0; i < tile.crates.length; i++) {
      const value = tile.faceDown?.[i] === true ? 'down' : (tile.crates[i] as string);
      if (value === 'wild' || value === 'down') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ tile: tile.tile, crate: i });
    }
  }
  return out;
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
 * V2 Farmstead (starter) - "When you Deliver, you may first put 1 hand card into
 * your barn." / upgraded "When you Deliver, you may first put 1 deck card into
 * your barn."
 *
 * (The sheet prints a double space in the base text. Left alone: the extract is
 * the source of truth and a whitespace fix is a sheet edit, not an engine one.)
 */
export const vegetableFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'THE OLD "When you Deliver, gain £1 / £2" IS GONE, and its deletion was a rules fix rather ' +
      'than a balance one: it minted coins on a solitaire action, which the coin rule adopted ' +
      'with the Wheat rebuild forbids outright (a card may only mint at the moment another ' +
      'player acts). What replaces it moves a card instead of a coin. ' +
      'THE WORD "FIRST" (2026-08-09, Dean) IS THE WHOLE CARD, AND MOST OF IT DOES NOT LIVE IN ' +
      'THIS FILE. Until it was added, this handler pushed a handToBarn on afterDeliver - which ' +
      'fires AFTER the payment - so the card it moved could not help pay for the delivery that ' +
      'triggered it. You had to already be able to deliver in order to earn the fuel for the ' +
      'next delivery, which is a circle, and it is why the card was worth 1.5 VP a game in a ' +
      "suit that needed four. Wheat's Farmstead relaxes the harvest and Orchard's modifies the " +
      "draw; both sit UPSTREAM of their suit's bottleneck and this one has to as well. " +
      "The hand head is enumerated in actions.ts (deliverHeadSize / headCandidates / doDeliver's " +
      '`head`), NOT here, because it has to be visible to option enumeration and to LEGALITY: ' +
      'a Deliver that only becomes payable once a hand card is loaded has to be offered in the ' +
      'first place. It composes with the wild substitution rather than duplicating it: one hand ' +
      'card plus one spare barn card is a card of the crate. ' +
      'TWO CHANGES ON 19/08/2026, one of them structural. ' +
      '(1) THE TRIGGER WIDENED from "When you Deliver to the island" to "When you Deliver", so ' +
      'the `event.island` guard that used to open this listener is GONE. A balloon move IS the ' +
      'Deliver action (DL-12), so the card now fires on a flight as well as on an island claim - ' +
      'every route, including V4 and V8 and the Deliver Service. That closes the old split where ' +
      'V17 owned the flight trigger and this owned the island one; both hooks are now the same ' +
      "hook, and `afterDeliver`'s `island` boolean is what the two ever differed on. " +
      '(2) THE UPGRADED FACE IS RE-POINTED. The barn swap is DELETED outright - "swap 1 barn ' +
      'card for the top card of any deck" was a recolouring power the wild substitution took ' +
      'over on 8 August - and the deposit source moves from a HAND card to a DECK card. The two ' +
      'faces are ALTERNATIVES and not cumulative, read literally off the printed text: base puts ' +
      'a hand card in, upgraded puts a deck card in. That is what makes the flip worth £2 - a ' +
      'deck card is free where a hand card is the scarcest resource the suit has - and it is why ' +
      'the upgrade does not simply stack a second head on the first. ' +
      'SO THIS HANDLER HAS NO BEHAVIOUR AT ALL, AND THAT IS CORRECT. Both faces are enumerated ' +
      'in actions.ts and nowhere else: `deliverHeadSize` (1 on the base face, ⚠️ **0** on the ' +
      'upgraded one - it does not load a hand card any more), `deliverDeckHead` / ' +
      '`deckHeadCandidates` for the upgraded deck card, and the `head` / `deckHead` arguments ' +
      'threaded through `deliverOptions`, `anyDeliverOption`, `doDeliver`, `balloonMoveOptions` ' +
      'and `doMoveBalloon`. It has to live there because it must be visible to option ' +
      'enumeration AND to LEGALITY: a Deliver that only becomes payable once a card is loaded ' +
      'has to be offered in the first place. The deck head is enumerable with no information ' +
      'leak, because A DECK IS A SUIT - the arriving crop is fully known and only the card is ' +
      'not, and barn identity is inert anyway. ' +
      '⚠️ A stopgap `deckToBarn` task briefly lived here, firing off `afterDeliver`. It was ' +
      'deleted the same day: `afterDeliver` fires AFTER the payment, so the card it moved could ' +
      'not help pay for the delivery that triggered it - the exact circle the word "first" ' +
      'exists to break, and the same bug the 2026-08-09 change was made to fix. If a future ' +
      'pass is tempted to put a head back on a hook, that is why it cannot be.',
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
 * V4 The Market Stall Depot - "Discard 1 card to move a Balloon to your
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
      'the purity. THAT DECISION BECAME OBSERVABLE ON 19/08/2026: the Farmstead dropped its ' +
      '`island` guard when its text widened to "When you Deliver", so an upgraded Vegetable seat ' +
      'now gets a deck card into the barn every time this Depot flies. Two cards for one hand ' +
      'card, which is the ladder working, not a bug. ' +
      'Mandatory when it can be paid; auto-skips on an empty hand or an empty sky.',
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
        takeFlight(fx, task.pid, answer);
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

/** V6 The Trade Depot - "Turn an island demand token face down, then Deliver." */
export const tradeDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: false },
    notes:
      'The other half of the mutable demand tokens, and the one that points OUTWARD: a ' +
      'face-down token opens a crate for the whole table and the Vegetable seat is simply first ' +
      'in the queue. Theme: the second buyer is not fussy. ' +
      'THE ELIGIBILITY FILTER IS GONE (19/08/2026). The card used to read "a demand token on a ' +
      'tile where a receipt has already been taken", and that clause was the TIMING DIAL, not ' +
      'flavour - it is what Dean\'s "this feels like a Tier 2 power" was answered with instead of ' +
      'a roster move. The card could not fire on turn one because no tile had a receipt yet, and ' +
      'it came alive exactly when the race started; it also protected what the island is FOR, by ' +
      'keeping the colour puzzle hard while it mattered and soft only where the race was already ' +
      'over. The sheet dropped it, so ANY token on any open tile is now a legal target and the ' +
      'card is live from turn one. Two knock-on effects to watch in the arm: the parity trap it ' +
      'relieves is now relievable before anybody has committed a barn to a colour, and V14 no ' +
      'longer sits at the opposite end of the island from it (V14 wanted a VIRGIN tile and this ' +
      'wanted a half-filled one, so the two used to be incapable of competing; both are now ' +
      'unrestricted). The difficulty score drops 3 -> 2 with the condition: the card is a plain ' +
      'pick-a-token now. ' +
      'ENUMERATED LOCALLY (faceDownTargets, this file) rather than through demandFaceDownOptions, ' +
      'which still carries the receipt filter and belongs to a shared file this pass does not ' +
      'own. An illegal target is still never offered: a cornucopia and an already-blank token ' +
      'are both skipped, because turning either buys nothing, and a tile with no receipt space ' +
      'left is never re-priced retrospectively. ' +
      'Mandatory as printed. It can now only be targetless on an island of cornucopias and blanks, ' +
      'in which case the drain loop drops the task and the Deliver behind it still runs. ' +
      '"THEN DELIVER" ADDED 2026-08-09 (Dean), same reasoning as V5: the card was bottom of its ' +
      'band at 22% built and fired 0.0 times a game, because a GROW that produces nothing loses ' +
      'to any GROW that draws. Opening the crate and filling it is one action. ' +
      '⚠️ THE THRESHOLD IS STILL 3. It survived the 2026-08-09 review (3 -> 2 was recommended and ' +
      'the Deliver was approved instead) and it is now the only brake left on a card that has ' +
      'lost its timing gate. If V6 turns out to be the card that dissolves the colour puzzle, ' +
      'the threshold is the dial, not the text.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'faceDown', riders: {} });
    // Queued after the face-down, so the delivery sees the opened crate. The
    // face-down is mandatory but can have no legal target, in which case the
    // drain loop drops it and the delivery still runs (the W15/A5 precedent).
    fx.pushTask({ t: 'deliver', pid: self.seat, src: self.card });
  },
  tasks: {
    faceDown: {
      answers(data, state) {
        return faceDownTargets(data, state).map(
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
 * V8 The Regional Depot - "Move a Balloon to your Aerodrome and take its
 * reward."
 */
export const regionalDepot: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'TWO SUBTRACTIONS ON 19/08/2026, and they pull in opposite directions - read them ' +
      'separately or the card looks like a straight buff, which it is not. ' +
      'CHEAPER: the discard is gone. The old card read "Discard 1 card to move a Balloon to your ' +
      'Aerodrome and take the reward of any Balloon"; the fee has been deleted outright, so the ' +
      'flight is now free of everything except the GROW that fired it (the matching card into ' +
      'the stack, plus the action). This is the one Depot that flies without spending hand. ' +
      'WEAKER, AND THIS IS THE HALF TO NOTICE: "the reward of any Balloon" narrowed to "its ' +
      'reward" - the reward of the balloon you actually moved. That was the whole card. Balloon ' +
      'rewards are welded to colours (Draw 4 / Build at a discount of 4 / Sow 4 from hand / Gain ' +
      '£4), so which reward you can have is an accident of where the balloons are parked, and V8 ' +
      'was the only thing in the game that severed reachability from cargo. It is now V4 without ' +
      'the fee, at one more build cost and one more threshold, and the ladder between them is a ' +
      'price ladder rather than a power ladder. Whether that leaves it worth Tier 1 slot 5 is an ' +
      'arm question. ' +
      "The suppression seam went with it: landBalloon's `grantReward` flag existed for this card " +
      'alone and now has no caller. It stays in actions.ts - a shared file - and its docstring ' +
      'still names V8; that note is stale and is on the handoff list. ' +
      'ROUTED THROUGH doMoveBalloon WITH A NULL SPEND, which is the engine\'s "a card effect ' +
      'moved this for free" path: no cards leave any zone, but the raid hook and the deliver ' +
      'hook both still fire, so V16 still pays a raided neighbour and V17 still draws. Not ' +
      'doMoveBalloonFromHand with an empty fee, which would throw on the cost check. ' +
      '⚠️ RULING H, OWED BY DEAN, IS PARTLY ANSWERED BY THE RETEXT: the magenta balloon\'s "Gain ' +
      '£4" is a solitaire coin faucet, which the coin rule forbids, and V8 could previously ' +
      'target it DELIBERATELY. It can now only reach it by moving magenta itself, which any ' +
      'balloon move can do. The fault was always the reward and not the card, and it is now the ' +
      "reward's alone. Still worth reporting the £4 balloon's take rate in the arm.",
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'freeFlight', riders: {} });
  },
  tasks: {
    freeFlight: {
      answers(_data, state, task) {
        const aero = state.aerodrome;
        if (!aero) return [];
        // The shared source rule: the centre or a rival's Aerodrome, never your
        // own. Enumerated here as well as asserted in movableBalloon, so an
        // empty sky drops the task instead of wedging it.
        return aero.balloons
          .filter((b) => b.at !== task.pid)
          .map((b) => ({ kind: 'card', payload: { balloon: b.id } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('freeFlight expects a card answer');
        doMoveBalloon(fx, task.pid, answer.payload.balloon as string, null);
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

/** V14 The Distribution Center - "Deliver and take every receipt on the island." */
export const distributionCenter: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      'CHEAPER THAN IT READS, because deliveredBy is a Seat[] IN ORDER and the seat at index i ' +
      'took vpByDeliveryOrder[i]. So a sweep is: pay the tile ONCE and push the seat as many ' +
      'times as the tile has room for - 6 + 3 = 9 with no scoring rule of its own. That is ' +
      "doDeliver's `receipts` argument, which defaults to 1 for every other delivery in the " +
      'game. It emits one `delivered` event per receipt so nothing counting deliveries has to ' +
      'learn about the sweep, and fires afterDeliver ONCE, because it is one Deliver and the ' +
      'Farmstead pays per delivery rather than per receipt. ' +
      'ISLAND ONLY: no balloon branch, because a balloon has no receipts. ' +
      '⚠️ RETEXTED AND RE-RULED ON 19/08/2026, AND THE RULING OVERRIDES THE PRINTED TEXT. The ' +
      'card now reads "Deliver and take EVERY RECEIPT ON THE ISLAND", which taken literally ' +
      'would empty the board. Dean has ruled it: it takes whatever receipts REMAIN ON THE TILE ' +
      'IT DELIVERED TO - two if nobody has delivered there, one if somebody has. Not "every ' +
      'receipt on the island", and not always "both". So the count is read off the live tile at ' +
      'resolve (deliveriesPerTile minus deliveredBy.length) rather than hard-coded, which is ' +
      'also what keeps it honest under an overlay that changes the per-tile capacity. ' +
      'THE VIRGIN-TILE RESTRICTION IS GENUINELY GONE. The old card read "Deliver to a tile where ' +
      'nobody has delivered, and take both of its receipts", and the enumerator (virginDeliveries) ' +
      'filtered the shared option set down to untouched tiles. It now enumerates every payable ' +
      'delivery, so the card may deliberately be aimed at a half-claimed tile for a single ' +
      'receipt. That makes it strictly more flexible and slightly less explosive: the 9-point ' +
      'double is now a choice you can miss rather than the only thing the card does, and a seat ' +
      'holding V14 for a virgin Level 3 tile is choosing to wait rather than being forced to. ' +
      'It also ends the happy accident that V6 and V14 pointed at opposite ends of the island; ' +
      'both are unrestricted now. ' +
      'The wild substitution and the face-down tokens still compose for free, because the ' +
      'answers are filtered off deliverOptions rather than re-derived. ' +
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
        return deliverOptions(data, state, task.pid).map(
          (o) =>
            ({
              kind: 'card',
              // ⚠️ BOTH heads ride on the answer or the spend is validated
              // against a barn the cards never reached. This is a `card` payload
              // rather than the shared `deliver` answer, so it does NOT get the
              // wiring in tasks.ts for free and has to carry it by hand - and
              // `deckHead` was missed exactly that way when it landed, crashing
              // roughly 4% of games with "no <crop> card left to spend" on a
              // spend that was only ever affordable because a deck card was
              // supposed to arrive first.
              payload: {
                tile: o.tile,
                spend: o.spend,
                ...(o.head ? { head: o.head } : {}),
                ...(o.deckHead ? { deckHead: o.deckHead } : {}),
              },
            }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('sweepDeliver expects a card answer');
        const { tile, spend, head, deckHead } = answer.payload as {
          tile: string;
          spend: Partial<Record<Suit, number>>;
          head?: CardId[];
          deckHead?: Suit;
        };
        // "Every receipt" = every receipt THIS TILE has left (Dean, 19/08/2026).
        // Read off the live island rather than assumed, so the card takes 2 from
        // a virgin tile, 1 from a half-claimed one, and stays correct under an
        // overlay that changes deliveriesPerTile.
        const target = fx.state.island.tiles.find((t) => t.tile === tile);
        if (!target) throw new Error(`Tile ${tile} is not in play`);
        const receipts = deliveriesPerTile(fx.data) - target.deliveredBy.length;
        doDeliver(fx, task.pid, tile, spend, undefined, receipts, head, deckHead);
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
      'PAID for separately, TARGETED separately, takes ONE receipt, and may be an island claim ' +
      'or a balloon move independently of the other (DL-12). Two tasks rather than one task with ' +
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
