/**
 * THE FIVE v42 HELPING HANDS (W18, A18, D18, O18, V18), one Power card per
 * suit, sharing a name and nothing else (sheet v42, ledger A163). Built
 * 16/09/2026.
 *
 * Dean's rule for the set: *"the task you are asked to perform to qualify for
 * the reward must be special and intentional, rather than just ordinary"*.
 *
 *   W18  If, on your turn, you Harvest two or more of your buildings, Draw 3.
 *   A18  If, on your turn, you fill one of your buildings, sow the top card of
 *        any deck onto another of your buildings.
 *   D18  If, on your turn, you Build two buildings, put the top 2 cards of any
 *        one deck into your Barn.
 *   O18  At the end of your turn, Draw until you have at least 3 cards in hand.
 *   V18  After you Deliver, if your Barn has 1 or fewer cards, Draw 3.
 *
 * Every one is owner-only and passive. Each fires every time its condition is
 * NEWLY met (Dean, 15/09/2026: the fire-once rule is deleted), which for W18,
 * D18 and O18 is at most once a turn by construction: a count passes 2 once,
 * and the end of a turn happens once.
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

import type { Suit } from '@gp/data';

import type { Fx } from '../fx.js';
import { canSowOnto, drawableSuits, player, thresholdOf } from '../query.js';
import type { CardId, Seat, TaskAnswer } from '../state.js';
import { isNoticeBoardCard, ownBuildings } from './buildings.js';
import type { CardHandler } from './types.js';

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
 * A18 A Helping Hand - "If, on your turn, you fill one of your buildings, sow
 * the top card of any deck onto another of your buildings."
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
      'and bar Notice Boards; it is mandatory as printed and skipped when nothing has room.',
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
      fx.pushTask({ t: 'sowFromDeck', pid: self.seat, src: self.card, remaining: 1, targets });
    },
  },
};

/**
 * D18 A Helping Hand - "If, on your turn, you Build two buildings, put the top 2
 * cards of any one deck into your Barn."
 */
export const helpingHandDairy: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: true, interrupts: false },
    notes:
      'Fires on the build that brings the count to exactly 2, so once a turn. ⭐ BUILDER ' +
      'DEFAULT (16/09/2026, not ruled): "buildings" is read as ANY card built, Power and ' +
      'Endgame cards included, because the card says Build and a Build is how they arrive; ' +
      'D18 itself counts if it is the second build. Every route counts - the Build action, ' +
      'the Dairy Notice Board, W7, D10, D13. The count is `turn.buildsThisTurn`, written by ' +
      '`placeBuilt` before the hook. ONE choice, the deck, then its top two cards straight ' +
      'to the barn (the W15 Patisserie shape); a deck that runs out mid-way reshuffles its ' +
      'own discard as everywhere.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat || !onOwnTurn(fx, self.seat)) return;
      if (fx.state.turn.buildsThisTurn !== 2) return;
      if (drawableSuits(fx.data, fx.state).length === 0) return;
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'd18Deck', riders: {} });
    },
  },
  tasks: {
    d18Deck: {
      answers(data, state) {
        return drawableSuits(data, state).map(
          (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('d18Deck expects a card answer');
        const suit = answer.payload.suit as Suit;
        for (let i = 0; i < 2; i++) fx.deckTopToBarn(task.pid, suit);
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
