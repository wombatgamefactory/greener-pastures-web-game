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
 *   A18  If, on your turn, you fill a building, you may sow a deck card into
 *        your Barn. (v46, 20/09/2026: RETEXTED off "...sow the top card of any
 *        deck onto another of your buildings" - see the handler's own note,
 *        R8/R9 in tasks/v46-rulings-v1.md. Despite the word "sow" the act is a
 *        plain barn placement, not the SOW keyword.)
 *   D18  Whenever you build a card with a cost of 3 or more, add 1 of those
 *        cards to your Barn. (19/09/2026 wording; was "...a card that costs 3
 *        or more resources..." on the 18/09/2026 save, and before that "If,
 *        on your turn, you Build two buildings, put the top 2 cards of any
 *        one deck into your Barn.") ⚠️ TEXT ONLY: `resources` meant the
 *        printed @cost icon total then and `cost` means the same total now -
 *        see the handler's own note for why that reading was already right.
 *   O18  At the end of your turn, Draw until you have at least 3 cards in hand.
 *   V18  After you Deliver, activate the base power of the receipt's suit.
 *        RETEXTED ON SHEET v48 (24/09/2026, `tasks/v48-rulings-v2.md` R10/R11;
 *        audit `tasks/v48-ambiguity-audit-v1.md` Q5/Q6): the old barn-size
 *        Draw 3 is gone. "Base power" is ruled the crop's PLAIN ACTION, taken
 *        exactly as a delivery Worker pays it - see the handler's own note.
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

import type { GameData, Suit } from '@gp/data';

import { doorActionLegal } from '../actions/doors.js';
import type { Fx } from '../fx.js';
import { cardById, drawableSuits, player, thresholdOf } from '../query.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import { meepleActionOf, performDoorAction } from '../workers.js';
import { isNoticeBoardCard } from './buildings.js';
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
 * deck card into your Barn." (v46, 20/09/2026, RETEXTED off "...sow the top
 * card of any deck onto another of your buildings" - R8/R9 in
 * `tasks/v46-rulings-v1.md`.)
 */
export const helpingHandApiary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'READING: "fill" is a card landing on one of your buildings that brings its stack to ' +
      'EXACTLY its threshold on this placement; a stack already full (D5 sows past it) is not ' +
      'filled again, and a Notice Board, whose 3+ is a minimum that never fills, never ' +
      'counts. BUILDER DEFAULT (16/09/2026, not ruled, and unaffected by the retext): ANY ' +
      'placement you make counts - a GROW payment, a sow, a deck sow from one of your own ' +
      'cards. ' +
      '⭐ R8 (v46, 20/09/2026): DESPITE THE WORD "SOW" THIS IS NOT A SOW. The reward moved off ' +
      "a rival building onto the OWNER'S OWN BARN, the same plain placement V16 The Market " +
      "Signal Tower and A13 The Queen's Hive already make, through the shared `deckToBarn` " +
      'primitive (`Fx.deckTopToBarn`). Nothing that watches a placement onto a building - not ' +
      'this card, not any other - sees this reward: it emits no `cardPlaced`, fills nothing, ' +
      'and so it CANNOT chain into itself or into anything else. The old "another of your ' +
      'buildings with room" gate went with the destination: `ownBuildings` and `canSowOnto` ' +
      "are gone from this file's imports because nothing here targets a building any more. " +
      '⭐ R9 (v46): no second condition survives. A18 fires on a one-building farm and on a ' +
      'farm whose buildings are all full - there is nothing left to gate on but the fill ' +
      'itself. THE DRY-TABLE GUARD STAYS (`drawableSuits(...).length === 0`, the same shape ' +
      'V17 needed after the v45 crash): it is the only thing left that can stop A18 firing. ' +
      'Still `optional: true` in effect: the local `deckToBarn` task offers a `skip` answer ' +
      'so "you may" is honoured without a second condition to hang it on. This handler\'s own ' +
      'copy of the task exists because the shared `deckToBarnTask` (buildings.ts) is ' +
      'deliberately mandatory (A13, V16); adding a skip there would change those cards too.',
  },
  on: {
    afterPlacement(fx, event, self) {
      if (event.seat !== self.seat || event.onto.seat !== self.seat) return;
      if (!onOwnTurn(fx, self.seat)) return;
      if (isNoticeBoardCard(fx.data, event.onto.card)) return;
      const filled = player(fx.state, self.seat).tableau.find((b) => b.card === event.onto.card);
      if (filled === undefined) return;
      if (event.stackSize !== thresholdOf(fx.data, filled)) return;
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
  tasks: {
    /**
     * A local "put a deck card into your Barn" task, not the shared
     * `deckToBarnTask` (buildings.ts, mandatory, A13/V16 use it): this one
     * adds a `skip` answer because A18 is the only deck-to-barn card that
     * prints "you may" (R9).
     */
    deckToBarn: {
      answers(gameData, state, task) {
        if ((task.riders.remaining as number) <= 0) return [];
        const out: TaskAnswer[] = drawableSuits(gameData, state).map(
          (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
        );
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('deckToBarn expects a card answer');
        fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
        task.riders.remaining = (task.riders.remaining as number) - 1;
        return (task.riders.remaining as number) <= 0;
      },
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

/**
 * V18 A Helping Hand - RETEXTED ON SHEET v48 (24/09/2026): "After you Deliver, activate the
 * base power of the receipt's suit." (was "...if your Barn has 3 or fewer cards, Draw 3.")
 *
 * ⭐ R10 (`tasks/v48-rulings-v2.md`, against the audit's own recommendation): "base power" is
 * the crop's PLAIN ACTION - Orchard Draw 2 (keep both), Dairy Build, Apiary Grow, Wheat Harvest
 * (full buildings only), Vegetable Deliver - taken exactly as a delivery Worker pays it
 * (`performDoorAction`, `workers.ts`, `via: 'meeple'`; that is also what turns the Apiary
 * door's printed SOW into a GROW, M7, through `meepleActionOf`). NOT `fireNoticeBoardPower`
 * (the V12 The Auction House path, reading (a) in the audit's Q5) - Dean ruled the smaller
 * card. Mandatory ("activate", no "may"): a Wheat power will Harvest, a Dairy power will
 * Build, if either legally can.
 *
 * A wild receipt has no suit of its own, so its owner names one (the audit's Q5, reading (i)).
 * A delivery that takes more than one receipt (V14, "take every receipt a tile has left") still
 * fires this listener once - `afterDeliver` fires once per delivery, whatever it collects - and
 * if the receipts differ in crop the owner is offered the same choice a wild receipt gives.
 * Only a plain action this seat can actually take right now is ever offered or fired
 * (`doorActionLegal`); with none legal - nothing buildable, nothing to Harvest, an unpayable
 * Deliver even under the Vegetable board's own relaxation - it does as much as it can, which
 * here is nothing.
 *
 * ⭐ R11 (Q6, against the audit's own recommendation for the order question only - the CHAIN
 * question is decided the audit's way, (b)): A VEGETABLE RECEIPT GRANTS ANOTHER DELIVER, WHICH
 * IS ITSELF A DELIVERY, WHICH WOULD OTHERWISE FIRE THIS SAME LISTENER AGAIN - and a second
 * Vegetable receipt from THAT delivery could keep the chain going for as long as the barn can
 * pay, off one Power card that cost 2. R11 stops it at ONE LINK: a delivery made by V18's own
 * granted action never triggers V18 again, though every other delivery this turn still does
 * (the main action, a visit, O6, O12, A8, V5, V7, V14, a Worker - the fire-every-time rule,
 * 15/09/2026, is otherwise untouched).
 *
 * ⭐ THE MARKER IS A ONE-SHOT TURN FLAG, `turn.v18Chain`, declared on `TurnState` (state.ts)
 * alongside `firedThisTurn` and `harvestsThisTurn`, in the same optional-and-absent-until-set
 * register those fields use. `clonePlain` (clone.ts) walks every OWN ENUMERABLE KEY of a plain
 * object generically, so the field survives every clone and every probe exactly as those do, and
 * `freshTurn()` replacing the whole `turn` object at every turn boundary clears it for free, the
 * same as those fields. It is set true only when the granted action is itself a Vegetable
 * Deliver, immediately before `performDoorAction` pushes that Deliver's task; the listener above
 * checks it FIRST, on every `afterDeliver` for this owner, clears it and returns without firing
 * again the moment it sees it set. One flag rather than `turn.firedThisTurn` (which would block
 * V18 from ever firing again this turn, not just off its own chain) because R11 only retires the
 * ONE delivery V18 itself granted - a genuine second Deliver later in the same turn, by any other
 * route, still triggers V18 exactly as the fire-every-time rule says it should.
 *
 * ⭐ THE RESOLUTION ORDER AGAINST V16 The Market Signal Tower STAYS RULED (v46 R10, restated by
 * the audit for this retext): V18 still resolves before V16 whenever both are built and a
 * delivery fires both. Nothing here forces that order deliberately - V18 no longer reads the
 * barn, so v46 R10's original reason (V18 must see the barn before V16's card lands in it) no
 * longer applies to THIS card's own behaviour - but the engine hook order that produced it is
 * unchanged (`fireHook` walks buildings in tableau order, unmoved by this retext), and Dean's
 * ruling keeps it rather than reopening it (Q6, "(i)").
 */
export const helpingHandVegetable: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      "Fires on the owner's own deliveries only. Reads `event.receipts` for their crops: a " +
      'named crop is offered iff `doorActionLegal` (through `meepleActionOf`, so the Apiary ' +
      "door's SOW is asked about as a GROW) says this seat can take that plain action right " +
      'now; a wild receipt, or receipts of more than one crop, expands to every crop the seat ' +
      'can currently act on and lets the owner choose among them (`v18Crop` card task) when ' +
      'more than one qualifies; exactly one legal crop fires straight off `performDoorAction` ' +
      'with no task at all; zero legal crops does nothing. `addsMoves` stays false: the choice ' +
      'is a TASK (`v18Crop`), never a standing `moves`/`applyMove` pair - no Helping Hand ' +
      "declares those (see this file's own header). `turn.v18Chain`, declared on `TurnState` " +
      "(state.ts, alongside `firedThisTurn` and `harvestsThisTurn`), is V18's own no-chain " +
      'marker (R11): set only when the ' +
      'fired crop is Vegetable, read and cleared at the top of this same listener, so a ' +
      'Vegetable receipt granted BY V18 cannot trigger V18 again while every other delivery ' +
      'this turn still can. `interrupts: true` because a wild or mixed receipt can suspend the ' +
      'turn on a real player choice, which the old barn-size Draw 3 never did, and because the ' +
      'plain action it grants (a Build, a Harvest...) can itself suspend the turn.',
  },
  on: {
    afterDeliver(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (fx.state.turn.v18Chain === true) {
        // R11: this delivery is the one V18 itself granted (the marker was set
        // just before `performDoorAction` pushed it, below). Consume the
        // marker and stop here - one link, never a second.
        fx.state.turn.v18Chain = false;
        return;
      }
      const crops = v18Candidates(fx, self.seat, event.receipts);
      if (crops.length === 0) return;
      if (crops.length === 1) {
        v18Fire(fx, self.seat, crops[0] as Suit);
        return;
      }
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'v18Crop',
        riders: { crops },
      });
    },
  },
  tasks: {
    /**
     * The owner's choice of crop, offered only for a wild receipt or a
     * multi-receipt delivery whose receipts name more than one legal crop
     * (the audit's Q5, reading (i) and its V14 extension). `crops` was
     * already filtered to what is legally actionable right now when the
     * listener above pushed this task; `answers` re-checks it against the
     * live state rather than trusting the stale snapshot, the same
     * defensive re-check `stillDiscarded` makes for D18 above.
     */
    v18Crop: {
      answers(data, state, task) {
        const crops = task.riders.crops as Suit[];
        return crops
          .filter((suit) => doorActionLegal(data, state, task.pid, meepleActionOf(data, suit)))
          .map((suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('v18Crop expects a card answer');
        v18Fire(fx, task.pid, answer.payload.suit as Suit);
        return true;
      },
    },
  },
};

/**
 * Every crop V18 could legally fire for this delivery's receipts: a wild
 * receipt expands to every suit (the owner may name any of them, Q5 reading
 * (i)); a named receipt contributes its own crop; duplicates collapse (two
 * receipts of the same crop still offer one choice, matching "one action" for
 * a delivery, however many receipts it took - the V14 extension of Q5). Every
 * candidate is filtered to what `doorActionLegal` says this seat can actually
 * do right now, through `meepleActionOf` so the Apiary door's SOW is read as
 * the GROW a meeple buys - an illegal crop is never offered and never fires.
 */
function v18Candidates(fx: Fx, seat: Seat, receipts: readonly { crop: Suit | 'wild' }[]): Suit[] {
  let wild = false;
  const named = new Set<Suit>();
  for (const receipt of receipts) {
    if (receipt.crop === 'wild') wild = true;
    else named.add(receipt.crop);
  }
  const pool = wild ? fx.data.cards.suits : [...named];
  return pool.filter((suit) =>
    doorActionLegal(fx.data, fx.state, seat, meepleActionOf(fx.data, suit)),
  );
}

/**
 * Fire V18's granted plain action for one crop (R10), through the same
 * `performDoorAction` a delivery Worker uses. Arms the no-chain marker (R11)
 * first, and only for Vegetable: every other crop's plain action cannot grant
 * a further Deliver, so nothing else needs a marker to stop it chaining.
 */
function v18Fire(fx: Fx, seat: Seat, colour: Suit): void {
  if (colour === 'vegetable') {
    fx.state.turn.v18Chain = true;
  }
  performDoorAction(fx, seat, colour, 'meeple');
}
