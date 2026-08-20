/**
 * Apiary handlers - all 21 cards, REBUILT (docs/apiary-suit-rebuild-v5.md, the
 * last of the five). Card texts are quoted from cards.json; the JSON leads and
 * the sheet follows for this one rebuild, which is the reverse of the standing
 * rule and is called out in the handoff.
 *
 * Suit identity, in one line:
 *
 *     Everybody else pays a card into a building to fire THAT building.
 *     Apiary pays a card into a building to fire a DIFFERENT one.
 *
 * There is no third keyword. The cards print "GROW another of your buildings
 * without placing a card", which SUBTRACTS from a verb the table already knows,
 * and that subtraction is the one genuinely new engine capability in the suit:
 *
 *   - no card is paid, so nothing lands and `afterPlacement` never fires
 *   - no crop is matched, because there is nothing to match it against
 *   - nothing advances, so the target's stack is untouched
 *   - a FULL building is a legal target, because the only reason a full
 *     building cannot be grown is that no card may be placed on it
 *
 * That last line is the whole design. 45.4% of turn boundaries find a seat's
 * Service clogged and a full building is dead weight to every other suit; to
 * Apiary it is a button, which is why this suit ships with no harvest valve at
 * all. The seam is `activateTargets` (actions.ts) and `activateOnly`
 * (runtime.ts); the task is `{ t: 'activate' }`.
 *
 * ⛔ THE RECURSION GUARD. A12 fires two buildings, one of which may be A5; A5
 * fires one, which may be A12. The ruling that closes it is `no card's text may
 * fire twice in a turn`, held in `turn.firedThisTurn` and enforced by FILTERING
 * THE OPTION OUT rather than by throwing - the bots probe by cloning and
 * replaying, so a guard that threw would surface as a crash inside probe.ts.
 *
 * ⛔ THE FARMSTEAD IS NOT HANDLER CODE, and both of the seams it used to own are
 * GONE (2026-08-11). The base power waived the crop match for every Apiary seat
 * from turn 1 - Dean: it "trivialises the suit" - and survives only as A6's
 * `anyCrop`. The upgraded face queued a free second placement on every GROW, and
 * A7's new text is word for word what that did, so it had to move: a starter may
 * not be a rung on its own tier cards' ladder. What replaced it is not a
 * consolation prize but a structural necessity - after A7's change all five
 * Tier 1 HIVEs are card-negative and nothing else in the suit refills the hand -
 * and it lives in `apiaryGrowBonus` (actions.ts), called from the GROW ACTION
 * branch in game.ts and nowhere else. A5, A6 and A12 do not trigger it, or The
 * Honey Hut draws three.
 *
 * HIVE is a sub-type derived from the whole-word title keyword (reference
 * DL-42) AND A TIER GUARD: **A4 to A8 and nothing else**. ⚠️ A13 The Queen's
 * Hive is named Hive and is NOT one. The tier guard used to be doing two jobs
 * at once - keeping A13 out of the COUNTS (A10, A14, A20) and keeping A9 and
 * A11 from reaching a building that could hold no cards - and since 19/08/2026
 * it only does the first, because A13 now carries a threshold like any other
 * building. The guard stays exactly as written: A13 is a Tier 3 payoff and
 * counting it would pay the suit's scalers for a card that is not part of the
 * row they are counting. The name collision is known and Dean has been told; a
 * rename is a later theme pass, because `@building` derives the art filename
 * from the Name and every existing render resolves off it.
 *
 * ⛔ THE TIER 3 ACTION CARD IS RETIRED (19/08/2026). Dean's ruling: *"The
 * concept of an ACTION was never requested. They are all GROW."* A13, A14 and
 * A15 were the suit's three ACTIONs - a standing move that WAS the main action,
 * with no threshold, no activation type and an `applyMove` that set
 * `turn.actionSpent` itself. They are ordinary owner-activated GROW buildings
 * now: the sheet gives each a threshold (A13 1, A14 2, A15 1) and
 * `activationType: 'wild'`, so any crop pays for the activation, and the GROW
 * runtime spends the action, which is why not one of them touches
 * `turn.actionSpent` any more. No arm is owed and there is nothing to revert -
 * it is a ruling, not a measurement. What DID survive the conversion is the
 * balance warnings on A14 and A15, and they survived because they got worse
 * rather than better; see each card.
 *
 * ⚠️ THE SUIT NO LONGER TAKES FROM, GIVES TO OR PLACES ON ANYBODY ELSE'S FARM
 * EXCEPT THROUGH A8. The same 19/08/2026 pass re-pointed A4 (its take-from-a-
 * rival is gone), A14 (its cross-table sow is gone) and A15 (its cross-table
 * gift is gone), which took Apiary's four cross-table cards down to one. Three
 * of the replacements are scalers that count the owner's own tableau. That is
 * the direction the Innovation lens warns about - the metric axis becoming the
 * specialisation axis - and it is written into each card's notes so the arm
 * knows what it is reading.
 */

import type { GameData, Suit } from '@gp/data';

import { activateTargets, growOptions } from '../actions.js';
import type { Fx } from '../fx.js';
import { canTakeCard, cardById, drawableSuits, foreignCropBuildings, player } from '../query.js';
import { doGrow } from '../runtime.js';
import type { BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import type { CardHandler } from './types.js';

const HIVE_NAME = /\bHive\b/;

/** A17 The Smoke Pot's printed price for a deck card into your barn. */
const SMOKE_POT_COST = 1;

/**
 * HIVE sub-type membership: the whole-word title keyword AND Tier 1, so the set
 * is exactly A4 to A8. The Queen's Hive (A13) is a Tier 3 GROW building and is
 * not a HIVE; see the docblock.
 */
export function isHiveCard(data: GameData, id: CardId): boolean {
  const c = cardById(data, id);
  return c.type === 'tier1' && HIVE_NAME.test(c.name);
}

function hives(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isHiveCard(data, b.card));
}

/** Push a see-N/keep-N "Draw N" for a card ability (no draw modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
}

/** Every seat but this one, in seat order. */
function rivals(state: GameState, seat: Seat): Seat[] {
  return state.players.map((_, s) => s).filter((s) => s !== seat);
}

/**
 * ⛔ `rivalSowTargets` IS GONE (19/08/2026). It enumerated a neighbour's
 * buildings that could still take a card, and it existed for exactly two
 * callers: A4's replacement sow and A14's placement. Both texts were deleted in
 * the same pass, so the helper went with them rather than sitting unused as an
 * invitation to write a fourth cross-table sow without a design reason.
 *
 * The ruling it carried is worth keeping in words, because it will be asked
 * again the next time anything sows across the table: a neighbour's Notice
 * Board and Service ARE legal targets - they are buildings - with the denial
 * watch attached, and if assertion 5 (clog as denial) ever moves off
 * 0.5% / 0.1% / 0.0% the dial is to exclude them.
 */

/**
 * A1 Barn (starter) - "Hand size 5. When you build a HIVE, sow the top card of
 * any deck onto it." / upgraded "Hand size 7." plus the same rider.
 */
export const apiaryBarn: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The printed hand size is still engine-read (handLimitOf off the current face). The ' +
      'rider mirrors W1 and O1 - on BOTH faces deliberately, or paying £2 to upgrade would ' +
      'delete it - but the payload is a PLACEMENT rather than a draw, which is the suit ' +
      'talking: a new HIVE arrives with a card already on it, so it is worth firing on the ' +
      'turn it lands. It fires on any build path, because afterBuild is the one funnel ' +
      'every landing goes through. Auto-skips when every deck is dry.',
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (!isHiveCard(fx.data, event.card)) return;
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [{ seat: self.seat, card: event.card }],
      });
    },
  },
};

/**
 * A2 Farmstead (starter) - "When you GROW, Draw 1." / upgraded "When you GROW,
 * Draw 1 and you may put 1 card from your hand into your barn."
 */
export const apiaryFarmstead: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Behaviour lives in an engine seam, not this entry: apiaryGrowBonus (actions.ts), ' +
      "called from apply()'s GROW ACTION branch in game.ts. ⛔ It must never move into " +
      'doGrow, which O13 The Grand Orchard and A6 The Garden Hive also call - a seam there ' +
      'would fire once per building grown and The Honey Hut would draw three. RULED: the ' +
      'Farmstead modifies the GROW ACTION, not card text that says GROW, so A5, A6 and A12 ' +
      'do not trigger it. Its draw is a card-ability draw, so no draw modifier applies ' +
      "(DL-47), and the upgraded face's handToBarn is optional and may whiff on an empty " +
      "hand, which is legal and silent. It is the suit's card-neutrality guarantee: after " +
      'the rebuild all five Tier 1 HIVEs are card-negative and nothing else refills the hand. ' +
      '⛔ BOTH OLD SEAMS ARE DELETED - the base crop waiver in growOptions/doGrow (it now ' +
      'lives on A6 alone) and the upgraded free sow (A7 prints that sentence now).',
  },
};

/** A3 Notice Board (starter) - "VISITOR: Take £1 from bank." / upgraded Special Orders. */
export const apiaryNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the whole visit - fee placement, all three payoffs (coin, ' +
      "Service, the upgraded face's 2-cards-take-£3 mode) and the wage minting - is " +
      'engine-level.',
  },
};

/**
 * A4 The Herb Hive - "Draw 1 for every card on this building." Threshold 4.
 */
export const herbHive: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'RE-POINTED 19/08/2026, and it is a total re-point rather than a trim: the card that ' +
      'reached across the table now reads its own stack and nothing else. Threshold went ' +
      '3 to 4 with it, which is the whole balance of the card - a HIVE that pays per card ' +
      'on it wants to be grown LATE, and four is how long you must leave it there. ' +
      '⚠️ THE COUNT INCLUDES THE GROW PAYMENT CARD. `doGrow` places the payment on the ' +
      'stack (fx.placeOnBuilding) BEFORE it calls this handler, in that order and by ' +
      'design, so a Herb Hive holding 2 cards that you then GROW draws 3, and a fresh one ' +
      'draws 1 rather than 0. Verified in runtime.ts, not assumed. The reading matters at ' +
      'the far end too: grown at 3 cards it is full on the payment and draws 4, so the ' +
      'card is a Draw 4 that clogs itself, which is the tension the threshold buys. ' +
      '⚠️ FIRED WITHOUT A PLACEMENT (A5, A12) IT COUNTS WHAT IS ALREADY THERE, with no ' +
      'payment card to add - a real difference between the two routes, and the first card ' +
      "in the suit where the signature 'GROW without placing' is WORSE than a plain GROW. " +
      "⛔ WHAT WENT: this was APIARY'S ONLY TAKE-FROM-A-RIVAL CARD, and the suit now has " +
      'none - the takeFromRival task, the cross-seat stackCardToBarn `to` seat and the ' +
      "replacement sow onto a neighbour's farm are all deleted. The `to` argument survives " +
      "on fx.stackCardToBarn with no caller passing it; that is the engine owner's call, " +
      "not this file's. ⚠️ BALANCE FLAG (plan 8.2): the new scaler POINTS INWARD. It pays " +
      "you for your own stack and it replaced one of the suit's four cross-table cards, so " +
      'it is a vote against the hook in the scaling layer even though no single number in ' +
      'it looks wrong. Read it with A14 and A15, which moved the same way on the same day.',
  },
  activate(fx, self) {
    const own = player(fx.state, self.seat).tableau.find((b) => b.card === self.card);
    drawN(fx, self.seat, self.card, own?.stack.length ?? 0);
  },
};

/** A5 The Meadow Hive - "GROW another of your buildings without placing a card." */
export const meadowHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      "One half of the suit's signature and the card that forced the activate seam. The " +
      "target set is deliberately WIDER than a GROW's: a FULL building fires perfectly " +
      'well, because nothing is being placed on it. ⚠️ It clogs ITSELF at threshold 2 and ' +
      'that is a feature - A12 can still fire it, which is the loop the suit is built on ' +
      'and the way the trick teaches itself at the table. Auto-skips with nothing to fire, ' +
      "which is risk 1 (the cold start): measure the turn of a seat's first activation, and " +
      'if it is turn 8 or later the floor is to let this sow onto itself instead.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'activate',
      pid: self.seat,
      src: self.card,
      remaining: 1,
      targets: activateTargets(fx.data, fx.state, self.seat, [self.card]),
    });
  },
};

/** A6 The Garden Hive - "GROW another of your buildings with a card of any crop." */
export const gardenHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      'A REAL GROW through doGrow - a card paid onto the stack, the ability, the whole ' +
      'funnel - with one modifier, `anyCrop`, which is where the deleted Farmstead crop ' +
      'waiver now lives and the only place in the game it survives. The grown building IS ' +
      'marked fired, so it cannot be fired again this turn, and its own activation resolves ' +
      'normally (A6 into A12 is the best turn in the suit: three activations for three ' +
      'cards). "Another" excludes this card, and O13\'s task at orchard.ts is the ' +
      'enumeration precedent. Full buildings drop out - unlike A5, this one places.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'growAny', riders: {} });
  },
  tasks: {
    growAny: {
      answers(data, state, task) {
        return growOptions(data, state, task.pid, {
          anyCrop: true,
          exclude: [task.src],
        }).map(
          (o) =>
            ({ kind: 'card', payload: { building: o.building, payment: o.payment } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('growAny expects a card answer');
        doGrow(fx, task.pid, answer.payload.building as CardId, answer.payload.payment as CardId, {
          anyCrop: true,
        });
        return true;
      },
    },
  },
};

/** A7 The Foraging Hive - "GROW: Sow 1 card from your hand onto another of your buildings." */
export const foragingHive: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      "The tier's floor and its first build, at a cost of 1: it touches no deck, takes " +
      'nothing from anybody, and does the one thing a new Apiary player must do before any ' +
      'of the rest works - get cards onto buildings so there is something worth firing. ' +
      'Imperative sow = mandatory (the ticket 18/19 convention), suit-free, "another" ' +
      'excludes this card, targets snapshot at activation and re-checked live. ⚠️ Its text ' +
      'is word for word what the upgraded Farmstead used to do, which is why the Farmstead ' +
      "moved: a starter may not be a rung on its own tier cards' ladder.",
  },
  activate(fx, self) {
    const targets = player(fx.state, self.seat)
      .tableau.filter((b) => b.card !== self.card)
      .map((b) => ({ seat: self.seat, card: b.card }));
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 1, targets });
  },
};

/**
 * A8 The Wild Hive - "Put a deck card into a neighbour's barn and take £2."
 */
export const wildHive: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'The only £ in the tier, and the gift goes STRAIGHT INTO THEIR BARN: no threshold ' +
      'advanced, no clog caused, no argument about whether it helped. ⚠️ NO ELIGIBLE ' +
      'NEIGHBOUR MEANS NO COIN - the coin is paid for the gift, so it lives in the resolver ' +
      'and the whole task auto-skips when every deck is dry. ⛔ Its £1 activation surcharge ' +
      'and its needsDesignReview flag are both GONE; activationSurchargeOf stays in the ' +
      'engine, data-driven, with nothing in the catalogue using it. ⚠️ THE FEE WENT £1 TO ' +
      '£2 ON 19/08/2026 (plan group A, a number and nothing else). It is now the only card ' +
      "in the suit that reaches a neighbour's zones at all - A4, A14 and A15 all lost their " +
      'cross-table halves the same day - so if the arm wants to know what Apiary pays the ' +
      'table, this card is the whole answer, and doubling its rate is what was meant to ' +
      'keep the seat willing to pay it.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'giftDeckTop', riders: {} });
  },
  tasks: {
    giftDeckTop: {
      answers(data, state, task) {
        const out: TaskAnswer[] = [];
        for (const seat of rivals(state, task.pid)) {
          for (const suit of drawableSuits(data, state)) {
            out.push({ kind: 'card', payload: { seat, suit } });
          }
        }
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('giftDeckTop expects a card answer');
        fx.deckTopToBarn(answer.payload.seat as Seat, answer.payload.suit as Suit);
        fx.gainCoins(task.pid, 2, 'A8');
        return true;
      },
    },
  },
};

/** A9 The Pollinator Trail - "GROW: Sow the top card of any deck onto each of your HIVEs." */
export const pollinatorTrail: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'FUEL THE ROW: one sowFromDeck task per HIVE with room, each naming that HIVE alone, ' +
      "so the deck is the player's choice and the target is not. Full HIVEs are skipped " +
      'rather than banked. Targets snapshot at activation. ⛔ ITS OLD TWIN IS GONE: this ' +
      "note used to flag A13 The Queen's Hive one tier up as the suit's tightest internal " +
      'pair (sow a deck top onto each HIVE against sow each deck top onto your buildings). ' +
      "A13's 19/08/2026 rewrite sends its cards to the barn instead, so the two no longer " +
      'overlap at all and A9 is now the only card in the suit that fuels the row.',
  },
  activate(fx, self) {
    for (const b of hives(fx.data, fx.state, self.seat)) {
      if (!canTakeCard(fx.data, b)) continue;
      fx.pushTask({
        t: 'sowFromDeck',
        pid: self.seat,
        src: self.card,
        remaining: 1,
        targets: [{ seat: self.seat, card: b.card }],
      });
    }
  },
};

/** A10 The Cross-Pollinator - "GROW: Draw 1 for each of your HIVEs." */
export const crossPollinator: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "FEED THE HAND, and it is the tier's answer to its own problem: the whole of Tier 1 " +
      'spends cards and this is where they come back. Counts HIVEs BUILT (A4-A8), not full ' +
      'ones, so five is the ceiling and the hand limit caps it below that anyway - Draw 5 ' +
      'into a hand of 5 cannot run away. ⛔ RETEXTED: it printed a HIRE discount, then a ' +
      'Service discount named by id in actions.ts; both are gone and ownServiceDiscount ' +
      'with them.',
  },
  activate(fx, self) {
    drawN(fx, self.seat, self.card, hives(fx.data, fx.state, self.seat).length);
  },
};

/** A11 The Wax Workshop - "GROW: Put 1 card from each of your HIVEs into your barn." */
export const waxWorkshop: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'SKIM THE ROW. ⚠️ ONE CARD PER HIVE, not one per card on the stack: a task per loaded ' +
      'HIVE, each choosing which of that stack goes. Not a harvest - stackCardToBarn, so no ' +
      'afterHarvest fires and the HIVE reopens by one rather than emptying. With the colour ' +
      'harvest gone this is one of only four routes Apiary has to the barn (with A4, the ' +
      "upgraded Farmstead and the plain Harvest), which is risk 4: read the suit's " +
      'cards-into-barn against the set. ⚠️ Deliberate anti-synergy with A21, which pays for ' +
      'leaving stacks loaded.',
  },
  activate(fx, self) {
    for (const b of hives(fx.data, fx.state, self.seat)) {
      if (b.stack.length === 0) continue;
      fx.pushTask({
        t: 'card',
        pid: self.seat,
        src: self.card,
        kind: 'skimHive',
        riders: { target: b.card },
      });
    }
  },
  tasks: {
    skimHive: {
      /**
       * ⭐ ANSWERS BY CROP, NOT BY CARD (ruled 20/08/2026 by Dean).
       *
       * This used to offer one answer per card ON the stack, naming it. Two
       * things were wrong with that and change 6 surfaced both. It LEAKED: the
       * view collapses every stack to a list of suits - your own included,
       * `buildingView` - because *"identity dies on placement"*, so a move
       * naming a stack card told the seat something it is not entitled to know,
       * and the view-safety walk caught it the moment an Apiary seat fired this.
       * And it was a FALSE CHOICE: Dean's ruling is that a card on a building
       * *"is never used for its power, just its suit ... they don't need to be
       * able to see which card it is"*, so two wheat cards on the same hive are
       * the same decision offered twice.
       *
       * So the seat picks a CROP and the engine takes the first card of it. The
       * card itself is undamaged by the choice - it keeps its identity, goes to
       * the barn, and is *"out of circulation"* rather than dead.
       */
      answers(data, state, task) {
        const target = player(state, task.pid).tableau.find(
          (b) => b.card === (task.riders.target as CardId),
        );
        if (!target) return [];
        const crops = [...new Set(target.stack.map((id) => cardById(data, id).suit))];
        return crops.map((suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('skimHive expects a card answer');
        const building = task.riders.target as CardId;
        const target = player(fx.state, task.pid).tableau.find((b) => b.card === building);
        if (!target) throw new Error(`${building} is not built`);
        // First of that crop. Which physical card leaves is immaterial to the
        // decision by the ruling above; it is NOT immaterial to the deck, so a
        // real card still moves and keeps its identity in the barn.
        const card = target.stack.find(
          (id) => cardById(fx.data, id).suit === (answer.payload.suit as Suit),
        );
        if (card === undefined)
          throw new Error(`No ${answer.payload.suit as string} on ${building}`);
        fx.stackCardToBarn(task.pid, building, card);
        return true;
      },
    },
  },
};

/** A12 The Honey Hut - "GROW 2 of your other buildings without placing a card." */
export const honeyHut: CardHandler = {
  difficulty: {
    score: 5,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: false, counts: false, interrupts: true },
    notes:
      'The strongest single action in the deck: two firings for one card where everybody ' +
      'else gets one for one. ⚠️ TWO DIFFERENT BUILDINGS, never the same one twice - the ' +
      'enumerator drops anything in turn.firedThisTurn, which is also what makes A12 -> A5 ' +
      '-> A12 terminate. Full buildings are legal, and firing a clogged A5 is the loop the ' +
      'suit is built on. ⚠️ Dean\'s own note is "may be too strong, but ok for now"; the ' +
      'dial, written down so it is not re-derived later, is ONE activation plus Draw 1. ' +
      'A5 and A12 are a deliberate two-rung ladder on one verb, allowed because the ladder ' +
      'IS the suit and no Tier 3 sits on it.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'activate',
      pid: self.seat,
      src: self.card,
      remaining: 2,
      targets: activateTargets(fx.data, fx.state, self.seat, [self.card]),
    });
  },
};

/** A13 The Queen's Hive - "Place the top card of each deck into your barn." Threshold 1. */
export const queensHive: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE SWARM, and after 19/08/2026 it is the simplest card in the tier: five deck tops ' +
      'straight into your own barn, in a fixed order, with nothing to choose. ⛔ ALL ' +
      'TARGETING IS DELETED - the sowFromDeck task per deck, the per-deck whiff when no ' +
      'building had room, the ACTION move and its `moves` room gate. It prompts for nothing ' +
      'now, which is why the score fell from 3 to 1. ⚠️ It still asks the ONE question the ' +
      'old version did: five deck tops in one activation is DECK-TOP PRESSURE, so read ' +
      'reshuffles per played deck before anything else in the arm. ⚠️ The barn is a dead ' +
      "end (barn to island only), so this accelerates nobody's engine - it buys island " +
      'freight and VP and nothing else, which is a different and much safer card than the ' +
      'sow-onto-your-own-buildings version that fed five thresholds at once. ⚠️ NOT a HIVE ' +
      'despite the name (the tier guard on isHiveCard), so it never counts for A10, A14 or ' +
      'A20. It DOES now carry a threshold of 1, so it is a legal target for A9, A11 and its ' +
      "own suit's placements - which the old ACTION version was not, and which is the one " +
      'live behavioural change the GROW conversion made to this card beyond its text. ' +
      "⚠️ Threshold 1 means the GROW payment fills it, so it clogs on every use and can't " +
      'fire again until it is harvested. That is the throttle on the whole effect.',
  },
  activate(fx, self) {
    // No task and no choice: the quantifier is EACH DECK, the destination is
    // fixed, and a dry deck is simply skipped by drawableSuits. Mandatory
    // effects skip silently rather than refusing the activation (plan 8.3), and
    // with every deck dry that means the activation happens and does nothing.
    for (const suit of drawableSuits(fx.data, fx.state)) {
      fx.deckTopToBarn(self.seat, suit);
    }
  },
};

/** A14 The Honeycomb Tower - "Gain £2 for each of your HIVEs." Threshold 2. */
export const honeycombTower: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⚠️⚠️ THE LOUDEST BALANCE RISK IN THE WHOLE 19/08/2026 PASS (plan flag 8.1), and it ' +
      "must not be softened in the reading. This is THE GAME'S ONLY REPEATABLE COIN " +
      'FAUCET - every other Tier 3 pays in a resource with a natural cap and coins have ' +
      'none - and the change did two things at once. ⛔ IT LOST ITS THROTTLE. The old text ' +
      "sowed a deck top onto a neighbour's building, and the handler's own note called " +
      'that sow THE METER: "every use hands a rival a card of freight and advances one of ' +
      'their thresholds, so a seat printing £5 a turn is feeding the table 25 cards a game" ' +
      '- and eventually the legal targets clogged and the card stopped being offered. That ' +
      'brake is gone. ⛔ AND THE RATE DOUBLED, £1 to £2 per HIVE, so five HIVEs is £10 an ' +
      'activation against the old £5. ⛔ AND IT IS NOW A PURE OWN-SUIT SCALER: it pays you ' +
      'for owning more of your own row and gives the table nothing back, where it used to ' +
      'pay the table in freight for every coin it minted. THE ARM OWED IS `a14-coin-faucet` ' +
      '- £2-per-HIVE-no-sow against £1-plus-sow - and it is READ AGAINST TOTAL COINS IN ' +
      "PLAY, never against this card's own play rate, because a faucet nobody turns on is " +
      'not the failure mode. ⚠️ Threshold 2, `activationType` wild: two cards to fire it, ' +
      'then it clogs until harvested, and that clog is now the ONLY brake left on the card. ' +
      '⚠️ It mints unconditionally: no rival, no deck and no legal target can stop it, so ' +
      'unlike A8 there is no path where the coins fail to arrive.',
  },
  activate(fx, self) {
    const wage = 2 * hives(fx.data, fx.state, self.seat).length;
    if (wage > 0) fx.gainCoins(self.seat, wage, 'A14');
  },
};

/** A15 The Royal Apiary - "Draw 1 for each of your buildings with a card on it." Threshold 1. */
export const royalApiary: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'REWRITTEN 19/08/2026, and nothing of the old card survives: the cross-table gift, ' +
      'the per-card choice of recipient, the £2-a-card faucet and the `consign` task are ' +
      'all deleted. It is a draw that scales on your own loaded buildings. ⚠️ THE COUNT IS ' +
      'THE SAME PREDICATE A21 THE WAX HALL SCORES ON - `stack.length >= 1` over the whole ' +
      'tableau - and that is deliberate: the suit already has a card teaching the table ' +
      'that a loaded farm is worth something, so this one reads off the same shelf. ' +
      'STARTERS COUNT if they hold a card, a clogged Notice Board or Service included, so a ' +
      'seat that gets visited a lot draws more. ⚠️ RULED: A15 COUNTS ITSELF. Threshold 1, ' +
      'so the GROW payment card lands on it before `activate` runs (fx.placeOnBuilding then ' +
      'the handler, verified in doGrow) and A15 is therefore always one of the buildings ' +
      'with a card on it - the floor is Draw 1, never Draw 0. The alternative ruling, ' +
      'excluding the source, would print a card whose first activation on an empty farm did ' +
      'literally nothing, and it would disagree with A21 counting the same building on the ' +
      'same table. Same reading as A4, arrived at the same way. ⚠️ FIRED WITHOUT A ' +
      'PLACEMENT (A5, A12) IT DOES NOT COUNT ITSELF unless it already holds a card, because ' +
      'there is no payment. ⚠️ BALANCE FLAG: another inward scaler, replacing a cross-table ' +
      'card - read it with A4 and A14, all three moved the same way on the same day. ' +
      '⚠️ It also anti-synergises with A11 The Wax Workshop exactly as A21 does: A11 exists ' +
      'to empty the stacks this pays you for keeping loaded.',
  },
  activate(fx, self) {
    const loaded = player(fx.state, self.seat).tableau.filter((b) => b.stack.length >= 1).length;
    drawN(fx, self.seat, self.card, loaded);
  },
};

/**
 * A16 The Beekeeper's Veil - "Whenever you place a card that brings a building's
 * stack to 2 cards, Draw 1." UNCHANGED by the rebuild, text and handler: the one
 * row in the suit that survives untouched.
 */
export const beekeepersVeil: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      'Placer-scoped placement reactor (ruling G): stack POSITION 2, any board - your own ' +
      'grow payment or sow, or your visit fee landing on a Notice Board holding one card. ' +
      'Never fires when a rival brings YOUR building to 2. No per-turn limit. ⚠️ ITS ' +
      'SUPPLY OF TRIGGERS SHRANK ON 19/08/2026 without a word of its own text changing: ' +
      'A13, A14 and A17 all used to place cards and none of them does now (A13 and A17 send ' +
      'theirs to a barn, A14 places nothing at all). What is left inside the suit is A7, ' +
      "A9, the Barn's build rider, your own GROW payments and your visit fee landing on a " +
      "neighbour's board. Worth a look in the arm: this card was priced against six " +
      'placement sources and now has five.',
  },
  on: {
    afterPlacement(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.stackSize !== 2) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/**
 * A17 The Smoke Pot - "Whenever you VISIT a neighbour, you may pay £1 to add a
 * deck card into your barn."
 */
export const smokePot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⚠️ THIS CARD IS THE MARKET, MOVED ONTO A CARD (19/08/2026). The same pass deletes ' +
      'the £3 "buy at market" bonus action from the game, and A17\'s new text is that ' +
      'exchange - coins into a barn card - re-priced at £1 and GATED BEHIND A VISIT. That ' +
      'is the whole point of the pair: the market was a solitaire coin sink sitting in the ' +
      'bonus slot, competing with the visit for the one slot the hook lives in, and this ' +
      'takes it off the slot and re-prices it as a REWARD for interacting. Nobody can reach ' +
      "it without first putting a card on a neighbour's Notice Board. If it ever needs a " +
      'dial, the dial is the price, not the trigger. ⛔ THREE CHANGES FROM THE OLD TEXT, ' +
      'and all three matter: it gained a COST (£1, paid to the bank on resolve); it became ' +
      'OPTIONAL, so the task offers a skip and a seat with no coins is simply never asked; ' +
      'and the destination moved from one of your buildings to your BARN, so IT NO LONGER ' +
      'ADVANCES A THRESHOLD. That last one is the quiet one - the card used to feed the ' +
      "suit's clogging engine and now feeds the island instead, and the barn is a dead end " +
      '(barn to island only), so nothing it buys can accelerate an engine. ⚠️ The player ' +
      'chooses WHICH deck, from every deck still drawable; the card is not chosen, it is ' +
      'the top of that deck, exactly as the market was. ⚠️ VISITOR-SIDE, where O16 The ' +
      'Orchard Keeper is host-side on the same hook - that is the guard, ' +
      '`event.visitor === self.seat`. A Helping Hand repeat is not a visit and never fires ' +
      'afterVisit, so it never fires this, which also means the £1 can be paid at most once ' +
      'per turn under the one-bonus-slot rule. ⛔ ITS EARLIER RETEXT still stands: it paid ' +
      'on WORK, a verb that no longer exists. The afterWork hook itself stays - D17 and the ' +
      'Service metrics use it.',
  },
  on: {
    afterVisit(fx, event, self) {
      if (event.visitor !== self.seat) return;
      // Pushed unconditionally and gated in the enumerator instead of here: the
      // wallet and the decks can both change between the hook firing and the
      // task reaching the head of the queue, and an empty answer list is
      // auto-skipped by the drain loop, so an unaffordable offer is never shown.
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'smokeBuy', riders: {} });
    },
  },
  tasks: {
    smokeBuy: {
      answers(data, state, task) {
        if (player(state, task.pid).coins < SMOKE_POT_COST) return [];
        const out = drawableSuits(data, state).map(
          (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
        );
        // The skip rides with the offers rather than being returned alone: with
        // nothing to buy there is nothing to decline, and an empty list lets the
        // drain loop drop the task silently.
        if (out.length === 0) return [];
        out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('smokeBuy expects a card or skip answer');
        fx.payCoins(task.pid, SMOKE_POT_COST, 'A17');
        fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
        return true;
      },
    },
  },
};

/** A19 The Honey Hall - "Game end: 3 VP for each non-Apiary building you have built." */
export const honeyHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE MANY FLOWERS, and it pays for your own decision on the mechanism: Apiary pays no ' +
      'crop cost to fire a building, so a foreign Tier 2 or Tier 3 in an Apiary tableau is ' +
      'a better card than it is in the tableau of the suit that printed it. Buildings ' +
      'printing SOME crop icon that is not Apiary (ticket 07) - a base starter prints the ' +
      'starting-building icon, so it is neither, which stops this penalising an upgrade. ' +
      '⚠️ Duplicates D19 The Cheese Hall in shape at three times the rate; the two rates ' +
      "should be set together, later. ⚠️ Watch for an Apiary seat building somebody else's " +
      'Tier 3 and firing it every turn (risk 5).',
  },
  gameEnd(data, state, seat) {
    return 3 * foreignCropBuildings(data, state, seat, 'apiary').length;
  },
};

/** A20 The Apiarist's Guild - "Game end: 2 VP for each HIVE you have built." */
export const apiaristsGuild: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      'THE DEPTH OF THE APIARY: the HIVE sub-type count, which under the tier guard is A4 ' +
      "to A8 and nothing else, capping at 10 VP. ⚠️ A13 The Queen's Hive is named Hive and " +
      'does NOT count. Matches W21, O20 and D21 - a house convention.',
  },
  gameEnd(data, state, seat) {
    return 2 * hives(data, state, seat).length;
  },
};

/** A21 The Wax Hall - "Game end: 1 VP for each of your buildings that has a card on it." */
export const waxHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      "THE FARM STILL IN USE, and the suit's identity as a scoring condition: every other " +
      'seat ends the game trying to empty its farm, and Apiary is the only one that can ' +
      'leave the stacks loaded and still have used them. ⚠️ STARTERS COUNT if they hold a ' +
      'card, which includes a clogged Notice Board or Service - intended, and a real ' +
      'interaction with being visited a lot. Powers and endgame cards have no stack and ' +
      'never count. ⚠️ Deliberate anti-synergy with A11, which exists to empty them.',
  },
  gameEnd(_data, state, seat) {
    return player(state, seat).tableau.filter((b) => b.stack.length >= 1).length;
  },
};
