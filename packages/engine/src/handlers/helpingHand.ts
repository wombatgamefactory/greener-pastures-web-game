/**
 * THE FIVE HELPING HANDS (W18, A18, D18, O18, V18), one Power card per suit,
 * sharing a name and nothing else (ledger A163). Built 16/09/2026 off the v42
 * sheet; D18 RETEXTED on v44 (18/09/2026) and its WORDING ONLY re-saved again
 * 19/09/2026 (sheet still v44, SHA-256 43d559c2...).
 *
 * Dean's rule for the set: *"the task you are asked to perform to qualify for
 * the reward must be special and intentional, rather than just ordinary"*.
 *
 *   W18  If, on your turn, you Harvest two or more of your buildings, Draw 3.
 *   A18  If, on your turn, you fill one of your buildings, sow the top card of
 *        any deck onto another of your buildings.
 *   D18  Whenever you build a card with a cost of 3 or more, add 1 of those
 *        cards to your Barn. (19/09/2026 wording; was "...a card that costs 3
 *        or more resources..." on the 18/09/2026 save, and before that "If,
 *        on your turn, you Build two buildings, put the top 2 cards of any
 *        one deck into your Barn.") ⚠️ TEXT ONLY: `resources` meant the
 *        printed @cost icon total then and `cost` means the same total now -
 *        see the handler's own note for why that reading was already right.
 *   O18  At the end of your turn, Draw until you have at least 3 cards in hand.
 *   V18  After you Deliver, if your Barn has 1 or fewer cards, Draw 3.
 *
 * Every one is owner-only and passive. Each fires every time its condition is
 * NEWLY met (Dean, 15/09/2026: the fire-once rule is deleted), which for W18
 * and O18 is at most once a turn by construction: a count passes 2 once, and
 * the end of a turn happens once. ⚠️ D18 IS THE EXCEPTION SINCE v44: its
 * condition is per-build, not a running count, so a turn that builds two
 * cards each costing 3 or more fires it TWICE - the deleted fire-once rule
 * working as intended, not a bug.
 *
 * ⛔ THE OLD CARD IS RETIRED. From v31 to 16/09/2026 all five copies printed
 * *"Each turn, you may take both bonus options"*, which under the notice-board
 * visit became a SECOND PLAY onto a different board, through a
 * `wireExtraBonusSlots` seam in actions/bonus.ts that this module installed at
 * import time. The seam is deleted with it (see `bonusSlotsFor`). Before v31
 * the card was a standing move ("place a second card to use the Service
 * again"), which is why the handler API has `moves` / `applyMove` at all; no
 * card declares them now.
 *
 * The per-turn counts are kept by the ENGINE (`turn.harvestsThisTurn` in
 * `Fx.harvest`, `turn.buildsThisTurn` in `placeBuilt`), not by these
 * listeners, so a Helping Hand built part-way through a turn still counts what
 * came before it. O18 listens on `beforeTurnEnd`, a hook added for it.
 */

import type { GameData } from '@gp/data';

import type { Fx } from '../fx.js';
import { canSowOnto, cardById, drawableSuits, player, thresholdOf } from '../query.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { isNoticeBoardCard, ownBuildings } from './buildings.js';
import type { CardHandler } from './types.js';

/**
 * Cards of `spent` still face up in their suits' discards - the same guard
 * D5 The Churning Shed, D6 The Trading Shed and O17 The Fruit Basket use to
 * keep from racing each other for the same just-discarded card. Each of those
 * files keeps its own private copy rather than sharing one across suits; this
 * is D18's.
 */
function stillDiscarded(data: GameData, state: GameState, spent: readonly CardId[]): CardId[] {
  return spent.filter((id) => state.discards[cardById(data, id).suit]?.includes(id));
}

/** A card-ability "Draw N": see N, keep N, each card from a deck of the player's choice. */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** "On your turn": the listener's owner is the seat whose turn it is. */
function onOwnTurn(fx: Fx, seat: Seat): boolean {
  return fx.state.turnPlayer === seat;
}

/** W18 A Helping Hand - "If, on your turn, you Harvest two or more of your buildings, Draw 3." */
export const helpingHandWheat: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      'Fires on the harvest that brings the count to exactly 2, so once a turn however many ' +
      'more follow. READING: every building of yours harvested on your turn counts, by any ' +
      'route - the Harvest action, the Wheat Notice Board, W8, W11, W12, W13 - and a Notice ' +
      'Board is a building. The count is `turn.harvestsThisTurn`, written by `Fx.harvest` ' +
      'before the hook, which is the new primitive. W13 The Bakery emptying several ' +
      'buildings reaches it on its own. The draw is the ordinary Draw 3 task, the player ' +
      'choosing each deck; a card-ability draw, so no Orchard modifier.',
  },
  on: {
    afterHarvest(fx, event, self) {
      if (event.seat !== self.seat || !onOwnTurn(fx, self.seat)) return;
      if (fx.state.turn.harvestsThisTurn !== 2) return;
      drawN(fx, self.seat, self.card, 3);
    },
  },
};

/**
 * A18 A Helping Hand - "If, on your turn, you fill a building, you may sow a
 * deck card onto another of your buildings." (v44, 18/09/2026: gained "you
 * may"; was "you fill one of your buildings, sow the top card of any deck".)
 */
export const helpingHandApiary: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'READING: "fill" is a card landing on one of your buildings that brings its stack to ' +
      'EXACTLY its threshold on this placement; a stack already full (D5 sows past it) is not ' +
      'filled again, and a Notice Board, whose 3+ is a minimum that never fills, never ' +
      'counts. ⭐ BUILDER DEFAULT (16/09/2026, not ruled): ANY placement you make counts - a ' +
      "GROW payment, a sow, a deck sow from one of your own cards - and A18's own sow can " +
      'fill another building and fire it again. That chain is bounded: each fill needs a ' +
      'non-full building and every link fills one. The sow is one `sowFromDeck` task, the ' +
      'player choosing deck and building, onto any of your buildings bar the one just filled ' +
      'and bar Notice Boards; skipped when nothing has room. ' +
      '⭐ OPTIONAL (`optional: true`), RE-CONFIRMED 19/09/2026: THE PRINTED TEXT GOVERNS ' +
      '(Dean) - a sow is declinable if and only if the card says "may", and the v44 sheet ' +
      'retexted this card to "you may sow", so the flag that the 18/09/2026 blanket fix set ' +
      'is now correct for the right reason instead of by accident.',
  },
  on: {
    afterPlacement(fx, event, self) {
      if (event.seat !== self.seat || event.onto.seat !== self.seat) return;
      if (!onOwnTurn(fx, self.seat)) return;
      if (isNoticeBoardCard(fx.data, event.onto.card)) return;
      const filled = player(fx.state, self.seat).tableau.find((b) => b.card === event.onto.card);
      if (filled === undefined) return;
      if (event.stackSize !== thresholdOf(fx.data, filled)) return;
      const targets = ownBuildings(fx.data, fx.state, self.seat)
        .filter((b) => b.card !== filled.card && !isNoticeBoardCard(fx.data, b.card))
        .filter((b) => canSowOnto(fx.data, b))
        .map((b) => ({ seat: self.seat, card: b.card }));
      if (targets.length === 0 || drawableSuits(fx.data, fx.state).length === 0) return;
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets,
        optional: true,
      });
    },
  },
};

/**
 * D18 A Helping Hand - "Whenever you build a card with a cost of 3 or more,
 * add 1 of those cards to your Barn." RETEXTED ON v44 (18/09/2026, sheet diff
 * off v42): the old "Build two buildings, count to 2" card is gone, and so is
 * its once-a-turn shape. ⚠️ RE-SAVED 19/09/2026, WORDING ONLY: the printed
 * sentence dropped "resources" ("...costs 3 or more resources..." became
 * "...a card with a cost of 3 or more..."), which if anything makes the
 * PRINTED-COST reading below more obviously right - "a card with a cost of
 * 3 or more" names a property of the card face, not of what was paid for it.
 * No behaviour changed; only the two quotes above and this one moved.
 */
export const helpingHandDairy: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ FIRES ON EVERY QUALIFYING BUILD, NOT ONCE A TURN: a turn that builds two cards each ' +
      'costing 3 or more resources fires this twice, which is the deleted fire-once rule ' +
      '(15/09/2026) working as intended. "Resources" is read as the PRINTED build cost - ' +
      '`cardById(...).buildCost.suit + .wild`, the @cost icon total the sheet itself calls ' +
      '"resources" - not what was actually paid: a Dairy Notice Board visit or the Milking ' +
      'Shed can shave the price down, but the card built still costs what it says on its own ' +
      'face, and that is the reading this follows. Every route that builds a card counts - the ' +
      'Build action, the Dairy Notice Board, W7, D10, D13. ⚠️ NO "ON YOUR TURN" GATE, UNLIKE ' +
      'THE OLD CARD: the printed text drops the phrase, so this reads `event.seat === self.seat` ' +
      'only, the same owner-scoped shape as D16 The Ledger and D17 The Strongbox - nothing in ' +
      "the game currently builds a card into a seat's tableau on anybody else's turn, so this " +
      'is unreachable today rather than untested. ' +
      '"Those cards" are the cards THIS build spent - `event.payment`, which by the time ' +
      "`afterBuild` fires is already face up in its suits' discards (`divertOrDiscard` moves a " +
      'build payment there before `placeBuilt` fires the hook, and stack-sourced cards off D7 ' +
      'join it too). That is the same route D5 The Churning Shed, D6 The Trading Shed and O17 ' +
      "The Fruit Basket already take to reach a build's spent cards, and `stillDiscarded` is " +
      'the shared guard that keeps this from racing them for the same card. ONE card, the ' +
      "player's choice, straight into the barn via the existing `fx.reclaimDiscard` primitive " +
      '(no new one needed; O17 already uses it the same way). Not a new primitive, so ' +
      '`newPrimitive` is false. Nothing to add when the build spent no cards (D7 can pay a ' +
      'build entirely off a stack with a wild-pair meeple leaving nothing behind) or when ' +
      'another effect has already claimed every spent card - both read as an empty answer ' +
      'list, which the drain loop drops silently, the same no-op a skip would have produced.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.payment.length === 0) return;
      const cost = cardById(fx.data, event.card).buildCost;
      const resources = cost ? cost.suit + cost.wild : 0;
      if (resources < 3) return;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'd18Barn',
        riders: { spent: [...event.payment] },
      });
    },
  },
  tasks: {
    d18Barn: {
      answers(data, state, task) {
        const spent = stillDiscarded(data, state, task.riders.spent as CardId[]);
        return spent.map((card) => ({ kind: 'card', payload: { card } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('d18Barn expects a card answer');
        fx.reclaimDiscard(task.pid, answer.payload.card as CardId);
        return true;
      },
    },
  },
};

/** O18 A Helping Hand - "At the end of your turn, Draw until you have at least 3 cards in hand." */
export const helpingHandOrchard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: true },
    notes:
      'The only listener on `beforeTurnEnd`, a hook added for it: `finishTurn` fires it once ' +
      'a turn, before the hand-limit discard, and suspends the boundary while the draw is ' +
      'answered. Draws 3 minus the hand as one Draw task, the player choosing each deck; a ' +
      'hand of 3 or more draws nothing. Fires on every turn of its owner, whatever the turn ' +
      "did, which makes it Orchard's floor under a hand that the visit fees keep emptying.",
  },
  on: {
    beforeTurnEnd(fx, event, self) {
      if (event.seat !== self.seat) return;
      const short = 3 - player(fx.state, self.seat).hand.length;
      if (short <= 0 || drawableSuits(fx.data, fx.state).length === 0) return;
      drawN(fx, self.seat, self.card, short);
    },
  },
};

/** V18 A Helping Hand - "After you Deliver, if your Barn has 1 or fewer cards, Draw 3." */
export const helpingHandVegetable: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Reads the barn when `afterDeliver` fires, which is after the delivery has been paid ' +
      'out of it. Your own deliveries only. ⭐ BUILDER DEFAULT (16/09/2026, not ruled): if a ' +
      'second "whenever you Deliver" card (V16, a later slice) also fires, the order is the ' +
      "active player's choice; until that exists V18 simply reads the barn as its hook runs, " +
      'which is hook (tableau) order.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (player(fx.state, self.seat).barn.length > 1) return;
      drawN(fx, self.seat, self.card, 3);
    },
  },
};
