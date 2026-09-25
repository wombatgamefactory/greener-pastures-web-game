/**
 * Apiary handlers - all 21 cards, REBUILT (docs/apiary-suit-rebuild-v5.md, the
 * last of the five). Card texts are quoted from cards.json; the JSON leads and
 * the sheet follows for this one rebuild, which is the reverse of the standing
 * rule and is called out in the handoff.
 *
 * ⭐ v42 (16/09/2026): the HIVE noun is gone from the card text. A9, A10, A11,
 * A13, A14, A17, A19 and A20 were retexted; the building nouns and the shared
 * choices they need live in buildings.ts. A8 and A10 now both sow onto a
 * neighbour's building, so the suit has two cross-table cards again, and the
 * paragraphs below that count HIVEs or say A8 is the only one are history. A17
 * lost its once-per-turn guard (Dean, 15/09/2026: card text fires every time
 * its trigger happens; the only cap left is one activation per building a turn).
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
 * ⛔ THE FARMSTEAD HAS NO SEAM AT ALL ANY MORE (v31, 02/09/2026), and this is
 * the third rewrite of this paragraph, which is the point of keeping it. The
 * base power waived the crop match for every Apiary seat from turn 1 - Dean: it
 * "trivialises the suit" - and survives only as A6's `anyCrop`. The upgraded
 * face queued a free second placement on every GROW, and A7's text is word for
 * word what that did, so it had to move: a starter may not be a rung on its own
 * tier cards' ladder. What replaced it on 2026-08-11 was "When you GROW, Draw
 * 1", held in `apiaryGrowBonus` (actions.ts) on the GROW ACTION branch and never
 * inside `doGrow`, so A5, A6 and A12 could not trigger it and The Honey Hut
 * could not draw three. v31 deletes that too: A2 prints an end-game scorer and
 * the seam is gone from actions.ts.
 *
 * ⚠️ THE HOLE IT LEAVES IS REAL. The GROW rider was "not a consolation prize but
 * a structural necessity", because after A7's change all five Tier 1 HIVEs are
 * card-negative and nothing else in the suit refills the hand. That sentence is
 * still true and the card that answered it has gone. A8 and A14 both gained a
 * Draw in the coin conversion, which is where the refill now lives - but on
 * cards a seat has to build, not on a starter live from turn 1.
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

import {
  activateTargets,
  anyDeliverOption,
  barnTally,
  deliverOptions,
  doDeliver,
} from '../actions.js';
// v48 A10: the card-granted visit. Imported from the module rather than the
// `actions.ts` barrel so the barrel (not this pass's file) needs no new export.
import { cardVisitTargets, doCardVisit } from '../actions/bonus.js';
import type { Fx } from '../fx.js';
import { canSowOnto, cardById, drawableSuits, isFull, isHarvestable, player } from '../query.js';
import { activateOnly } from '../runtime.js';
import type { CardId, GameState, Seat, TaskAnswer } from '../state.js';
import {
  builtBuildingsWorth,
  deckToBarnTask,
  growAnyAnswers,
  ownBuildings,
  resolveGrowAny,
} from './buildings.js';
import { barnCropScorer, farmsteadHandler } from './farmstead.js';
// v48 A15: the discarded card's own handler, looked up at call time only.
import { handlerFor } from './registry.js';
import type { CardHandler } from './types.js';

const HIVE_NAME = /\bHive\b/;

/**
 * HIVE sub-type membership: the whole-word title keyword AND Tier 1, so the set
 * is exactly A4 to A8. The Queen's Hive (A13) is a Tier 3 GROW building and is
 * not a HIVE; see the docblock.
 *
 * ⭐ NO v42 CARD READS IT (16/09/2026). The sheet replaced "your HIVEs" with
 * "your Apiary buildings" (`cropBuildingsOf`, buildings.ts), which counts A9-A15
 * too. The predicate stays exported for the simulator.
 */
export function isHiveCard(data: GameData, id: CardId): boolean {
  const c = cardById(data, id);
  return c.type === 'tier1' && HIVE_NAME.test(c.name);
}

/** Push a see-N/keep-N "Draw N" for a card ability (no draw modifier, DL-47). */
function drawN(fx: Fx, pid: Seat, src: CardId, n: number): void {
  if (n <= 0) return;
  fx.pushTask({ t: 'draw', pid, src, see: n, keep: n, revealed: [] });
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
 * A1 Barn (starter) - prints NOTHING (v31).
 *
 * ⛔ BOTH LINES WENT. The hand size went with the hand limit itself; the build
 * rider - "When you build a HIVE, sow the top card of any deck onto it" - was
 * deleted outright with the other four Barn riders. This one was the odd one of
 * the five: its payload was a PLACEMENT rather than a draw, so a new HIVE
 * arrived with a card already on it and was worth firing on the turn it landed.
 * That is a real loss to the suit's tempo and it is recorded as one - it is also
 * exactly why the whole family had to go together, because a "shared" line whose
 * payload differs per suit is five cards wearing one sentence. *
 * ⭐ THE HAND LIMIT CAME BACK ON 02/09/2026 AND THIS CARD DID NOT. The
 * reinstated limit is a flat 12 for everybody, in `rules.turn.handLimit` and
 * on the player aid; the Barn stays blank. A rule that applies to every seat
 * is not a card value, which is the whole difference between the old shape and
 * the new one - so nothing here should be un-deleted.
 */
export const apiaryBarn: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour of its own, and no printed text to have behaviour about. Registered ' +
      'anyway, so that a Barn with no entry reads as a deliberate blank rather than as a ' +
      'card nobody implemented. ' +
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
   * (S1, Dean 10/09/2026): *"Game end: 1 VP for each Apiary card you have
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
  gameEnd: barnCropScorer('apiary'),
};

/**
 * A2 Farmstead (starter) - "Game end: 1 VP for each Apiary card you have built."
 *
 * ⛔ THE GROW RIDER IS GONE (v31), and with it `apiaryGrowBonus` - the last of
 * the five suit-power seams. It read "When you GROW, Draw 1" and lived on the
 * GROW ACTION branch in game.ts rather than inside `doGrow`, because `doGrow` is
 * also called by A6 and O13 and a seam there would have fired once per building
 * grown and let The Honey Hut draw three. THE STANDING RULE THAT CAME OUT OF IT
 * SURVIVES THE CARD: a suit power modifies the ACTION, never card text that
 * happens to use the same word.
 *
 * ⚠️ IT WAS ALSO THE SUIT'S CARD-NEUTRALITY GUARANTEE, and losing it is the one
 * thing to watch in Apiary after v31: all five Tier 1 HIVEs are card-negative
 * and this was what refilled the hand. A8 and A14 both gained a Draw in the coin
 * conversion, which is where the compensation now sits - but it sits on two
 * Tier 1/Tier 3 cards a seat has to build, not on a starter that is live from
 * turn 1.
 */
export const apiaryFarmstead: CardHandler = farmsteadHandler('apiary');

/**
 * A3 Notice Board (starter) - "Grow a building using the top card of any deck."
 * Threshold 3+ (v42). The power is engine-level (`apiaryPower`, rules.json);
 * the note below describes the older v31 door and is history.
 */
export const apiaryNoticeBoard: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      'No behaviour here: the fee landing, the door action and the clog at threshold 2 are ' +
      'all engine-level. ' +
      '⚠️ THIS IS THE WEAKEST DOOR ON THE TABLE AND DEAN RULED IT SO KNOWINGLY ' +
      '(02/09/2026). The sow is FROM THE HAND, so a visitor pays 1 card onto the board and a ' +
      'SECOND card into the sow, for one threshold step on one of their own buildings: two ' +
      'cards out for one step in, which is the self-cancellation law biting on the one door ' +
      'where it was not paid off. The fix, if the Apiary board takes no traffic, is ' +
      "`from: 'deck'` in workers.json - not a cheaper door - and workers.ts already handles " +
      'that branch. Measure the door mix first.',
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

/**
 * A5 The Meadow Hive - "GROW another of your buildings without placing a
 * card. If it is full, you may Harvest it." v49 retext (24/09/2026,
 * `tasks/v49-rulings-v1.md`): the trailing Harvest is new; the GROW-without-
 * placing half is unchanged.
 */
export const meadowHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      "One half of the suit's signature and the card that forced the activate seam. The " +
      "target set is deliberately WIDER than a GROW's: a FULL building fires perfectly " +
      'well, because nothing is being placed on it. ⚠️ It clogs ITSELF at threshold 2 and ' +
      'that is a feature - A12 can still fire it, which is the loop the suit is built on ' +
      'and the way the trick teaches itself at the table. Auto-skips with nothing to fire, ' +
      "which is risk 1 (the cold start): measure the turn of a seat's first activation, and " +
      'if it is turn 8 or later the floor is to let this sow onto itself instead. ' +
      '⭐ v49 (24/09/2026): "If it is full, you may Harvest it." A5 places no card, so the ' +
      'printed condition can only mean the target was ALREADY full when it was fired - the ' +
      "open question `tasks/v49-rulings-v1.md` leaves open its own answer to. R3 (A9's " +
      'ruling, carried to A5 and A6 by the builder default note): a REAL Harvest of that ' +
      "ONE building, the same one just fired - never any of the owner's other full " +
      "buildings, which is why this is NOT the shared `chooseBuilding filter: 'harvestable'` " +
      'pushed loose, but that exact task with `targets` pinned to the one building the ' +
      'activate answer just named. Optional ("you may"): a skip is offered and declining ' +
      'leaves the clog exactly as A12 still finds it, which is the loop this suit is built ' +
      'on. ' +
      "⛔ WHY THIS IS A FILE-LOCAL `card` TASK AND NOT THE SHARED `t: 'activate'` ONE: the " +
      'generic task has no resolver hook to inspect WHICH building the answer named and ' +
      'push a follow-up keyed to it - A12 fires the same task shape twice a turn and must ' +
      "never gain this tail. The custom task keeps `isProbed`'s 'activate' pricing " +
      "(A14's honeycombGrow set the precedent: answer with `kind: 'activate'`, not the " +
      "catch-all `kind: 'card'`), and the harvest offer is the ordinary `chooseBuilding` -> " +
      "'harvest' shape, priced by its own stack-size feature - so neither half of the card " +
      'falls through to the flat `cardTask`/`skip` terms.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'meadowActivate', riders: {} });
  },
  tasks: {
    meadowActivate: {
      answers(data, state, task) {
        return activateTargets(data, state, task.pid, [task.src]).map(
          (card) => ({ kind: 'activate', card }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'activate') {
          throw new Error('meadowActivate expects an activate answer');
        }
        activateOnly(fx, task.pid, answer.card);
        const b = player(fx.state, task.pid).tableau.find((x) => x.card === answer.card);
        if (b && isHarvestable(fx.data, b)) {
          fx.pushTask({
            t: 'chooseBuilding',
            pid: task.pid,
            src: task.src,
            filter: 'harvestable',
            targets: [answer.card],
            optional: true,
            then: 'harvest',
          });
        }
        return true;
      },
    },
  },
};

/**
 * A6 The Garden Hive - "GROW another of your buildings with a card of any
 * crop. If it is full, you may Harvest it." v49 retext (24/09/2026,
 * `tasks/v49-rulings-v1.md`): the trailing Harvest is new; the any-crop GROW
 * half is unchanged.
 */
export const gardenHive: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      'A REAL GROW through doGrow - a card paid onto the stack, the ability, the whole ' +
      'funnel - with one modifier, `anyCrop`, which is where the deleted Farmstead crop ' +
      'waiver now lives and the only place in the game it survives. The grown building IS ' +
      'marked fired, so it cannot be fired again this turn, and its own activation resolves ' +
      'normally (A6 into A12 is the best turn in the suit: three activations for three ' +
      'cards). "Another" excludes this card, and O13\'s task at orchard.ts is the ' +
      'enumeration precedent. Full buildings drop out - unlike A5, this one places, so the ' +
      'target can only be full AFTER this GROW places the payment card onto a stack that ' +
      'was already one short of its threshold. ' +
      '⭐ v49 (24/09/2026): "If it is full, you may Harvest it" - the SAME building A6 just ' +
      'grew, checked once the grow (payment placed, ability fired) has fully resolved, so a ' +
      'GROW that reaches the threshold is what offers it and a GROW that does not leaves the ' +
      'clog standing. `resolveGrowAny` (buildings.ts) already returns the building it grew, ' +
      'which is what lets this stay a follow-up rather than a second enumeration: the ' +
      "`chooseBuilding filter: 'harvestable'` task, `targets` pinned to that one building, " +
      '`optional: true` for the printed "you may". A6 into A12 still fires three ' +
      'activations for three cards; now the first of the three can also end in an optional ' +
      'Harvest.',
  },
  activate(fx, self) {
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'growAny', riders: {} });
  },
  tasks: {
    growAny: {
      // The shared any-crop Grow (buildings.ts), exactly as O13 uses it. The
      // coin filter that sat here went with the Village Store coin (16/09/2026).
      answers(data, state, task) {
        return growAnyAnswers(data, state, task.pid, [task.src]);
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('growAny expects a card answer');
        const building = resolveGrowAny(fx, task.pid, answer.payload);
        const b = player(fx.state, task.pid).tableau.find((x) => x.card === building);
        if (b && isHarvestable(fx.data, b)) {
          fx.pushTask({
            t: 'chooseBuilding',
            pid: task.pid,
            src: task.src,
            filter: 'harvestable',
            targets: [building],
            optional: true,
            then: 'harvest',
          });
        }
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
      '⭐ v48 retext (24/09/2026, `tasks/v48-ambiguity-audit-v1.md` row A7): "Draw 2, then ' +
      'sow 1 card from your hand onto another of your buildings." A trailing Draw 2 joins ' +
      "the printed order, pushed FIRST so a card just drawn may be the one sown (v47 R1's " +
      'gating question cannot arise here - the reward comes before the mandatory act, not ' +
      'after it). The sow itself is unchanged from the older card: mandatory (imperative = ' +
      'mandatory, the ticket 18/19 convention), suit-free, "another" excludes this card, ' +
      'targets snapshot at activation and re-checked live at answer time. The older note ' +
      'follows. ' +
      "The tier's floor and its first build, at a cost of 1: it touches no deck, takes " +
      'nothing from anybody, and does the one thing a new Apiary player must do before any ' +
      'of the rest works - get cards onto buildings so there is something worth firing. ' +
      '⚠️ Its text used to be word for word what the upgraded Farmstead did, which is why ' +
      "the Farmstead moved: a starter may not be a rung on its own tier cards' ladder.",
  },
  activate(fx, self) {
    // v48: the Draw 2 is pushed first, ahead of the sow, matching the printed order.
    drawN(fx, self.seat, self.card, 2);
    const targets = player(fx.state, self.seat)
      .tableau.filter((b) => b.card !== self.card)
      .map((b) => ({ seat: self.seat, card: b.card }));
    fx.pushTask({ t: 'sow', pid: self.seat, src: self.card, remaining: 1, targets });
  },
};

/**
 * A8 The Wild Hive - "Deliver, using cards from your Barn and cards on full
 * buildings." (v48 retext, 24/09/2026; was "Sow a deck card onto a
 * neighbour's building, then put 2 deck cards into your Barn" on v47.)
 */

/** A crop multiset, the shape every delivery payment is written in. */
type Tally = Partial<Record<Suit, number>>;

/**
 * A8's delivery once the owner has named it: the tile, the token, the whole
 * 4-card spend, how much of each crop is still to be SOURCED (the barn, or
 * which full building), and what has been sourced so far. Plain JSON, so it
 * rides on the task's riders from one answer to the next.
 */
interface WildPlan {
  tile: string;
  token: number;
  spend: Tally;
  need: Tally;
  barn: Tally;
  buildings: Record<CardId, Tally>;
}

/** One place a crop can still be paid from, and how many of it are left there. */
interface WildSource {
  from: 'barn' | CardId;
  left: number;
}

/**
 * Where a card of `suit` can still come from for this plan: the barn first,
 * then each of the owner's OWN full buildings in tableau order (R8). "Full" is
 * `isHarvestable`, so a Notice Board counts at 3 or more (R4) - the same
 * predicate `deliverOptions` pooled with, and the same one `doDeliver` re-asks
 * once at payment. Nothing moves between the delivery answer and the payment,
 * so fullness is judged once, as R8 rules.
 */
function wildSources(
  data: GameData,
  state: GameState,
  seat: Seat,
  plan: WildPlan,
  suit: Suit,
): WildSource[] {
  const out: WildSource[] = [];
  const barnLeft = (barnTally(data, state, seat)[suit] ?? 0) - (plan.barn[suit] ?? 0);
  if (barnLeft > 0) out.push({ from: 'barn', left: barnLeft });
  for (const b of player(state, seat).tableau) {
    if (!isHarvestable(data, b)) continue;
    const onIt = b.stack.filter((id) => cardById(data, id).suit === suit).length;
    const left = onIt - (plan.buildings[b.card]?.[suit] ?? 0);
    if (left > 0) out.push({ from: b.card, left });
  }
  return out;
}

/** Take `n` cards of `suit` from one source into the plan. */
function wildTake(plan: WildPlan, suit: Suit, from: 'barn' | CardId, n: number): void {
  if (n <= 0) return;
  const into = from === 'barn' ? plan.barn : (plan.buildings[from] ??= {});
  into[suit] = (into[suit] ?? 0) + n;
  plan.need[suit] = (plan.need[suit] ?? 0) - n;
  if ((plan.need[suit] as number) <= 0) delete plan.need[suit];
}

/**
 * Source every crop whose source is FORCED, and return the first crop that
 * still needs the owner to choose (null once the whole spend is sourced).
 * Forced means one of two things: only one place still holds that crop, or
 * every card of that crop that is left is needed. Only a genuine choice - the
 * same crop in two or more places with some to spare - ever reaches the owner,
 * and then one card at a time (see `wildHive`). Mutates `plan`.
 */
function wildSettle(data: GameData, state: GameState, seat: Seat, plan: WildPlan): Suit | null {
  for (const suit of data.cards.suits) {
    const need = plan.need[suit] ?? 0;
    if (need <= 0) continue;
    const sources = wildSources(data, state, seat, plan, suit);
    const total = sources.reduce((n, x) => n + x.left, 0);
    if (total < need) throw new Error(`A8 cannot source ${need} ${suit} for its delivery`);
    if (sources.length === 1 || total === need) {
      let owed = need;
      for (const src of sources) {
        const n = Math.min(owed, src.left);
        wildTake(plan, suit, src.from, n);
        owed -= n;
      }
      continue;
    }
    return suit;
  }
  return null;
}

/** Pay the planned delivery: the barn share by crop, each building's share by name. */
function wildPay(fx: Fx, seat: Seat, plan: WildPlan): void {
  const buildingSpend = Object.entries(plan.buildings)
    .filter(([, take]) => Object.values(take).some((n) => (n ?? 0) > 0))
    .map(([building, spend]) => ({ building: building as CardId, spend }));
  doDeliver(fx, seat, plan.tile, plan.spend, {
    token: plan.token,
    ...(buildingSpend.length > 0 ? { buildingSpend } : {}),
  });
}

export const wildHive: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ v48 (24/09/2026): A REAL DELIVER, paid from the barn AND from the cards on the ' +
      "owner's own full buildings. Ruled in `tasks/v48-rulings-v2.md`: R4 (a Notice Board " +
      'may pay, counting as full at 3 or more for this card) and R8 (Q3 of ' +
      '`tasks/v48-ambiguity-audit-v1.md`: YOUR OWN full buildings only, fullness judged ONCE ' +
      'when the delivery is paid, so every card on a full building may pay). The payment ' +
      'source is `actions/deliver.ts` (`fromFullBuildings` on `deliverOptions` and ' +
      '`anyDeliverOption`, `buildingSpend` on `doDeliver`; read its header). It is a real ' +
      'Deliver: a receipt, the end-trigger clock, `afterDeliver` (V16, V18). It is NOT a ' +
      "Harvest: cards taken off a building go to their crops' discards, and no " +
      'When-Harvested line, W16 or W18 fires. A building left below its threshold is simply ' +
      'no longer full. Mandatory (no "may"); with nothing payable the card does nothing. ' +
      "⭐ THE ANSWER SPACE IS KEPT SMALL IN TWO STEPS, on the audit's Engine-notes advice " +
      '("Branching risk"). STEP 1 is the delivery exactly as the island enumerator gives it: ' +
      'tile, token and the 4-card crop multiset over the pooled barn-plus-buildings tally - ' +
      'the same answer count as a plain Deliver on the same pool. STEP 2 SOURCES the spend: ' +
      'every crop whose source is forced is sourced silently (only one place holds it, or ' +
      'every card of it that is left is needed); only where one crop sits in two or more ' +
      'places with some to spare is the owner asked, ONE CARD AT A TIME, "the barn, or which ' +
      'building", so a split between the barn and k buildings adds at most k + 1 answers per ' +
      'card instead of multiplying the delivery list. The task stays at the head between ' +
      'those answers (`resolve` returns false) and pays once, at the end. Barn-first could ' +
      "not be derived the way R15's meeple share is: emptying a clogged building is the " +
      "card's point, so the owner chooses. " +
      '⚠️ Options that lean on R15 (`rules.turn.meepleAsCard`, meeples paying as cards) are ' +
      "filtered out: `doDeliver`'s meeple split is not yet taught about building cards (its " +
      'header says so), and no shipped arm turns both on. ' +
      '⛔ WHAT WENT: the v47 card (a deck sow onto a neighbour, then 2 deck cards into the ' +
      'barn) and its 19/09/2026 gate. `neighbourSowTargets` loses A8 as a caller. A8 no ' +
      "longer reaches another seat at all, so the suit's one cross-table card is A10.",
  },
  activate(fx, self) {
    // Mandatory, so the only gate is "is any delivery payable at all".
    if (!anyDeliverOption(fx.data, fx.state, self.seat, 0, true)) return;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'wildDeliver', riders: {} });
  },
  tasks: {
    wildDeliver: {
      answers(data, state, task) {
        const plan = task.riders.plan as WildPlan | undefined;
        if (plan === undefined) {
          // STEP 1: which delivery (tile, token, spend) over the pooled tally.
          return deliverOptions(data, state, task.pid, Infinity, 0, true)
            .filter((o) => o.meeples === undefined || Object.keys(o.meeples).length === 0)
            .map(
              (o) =>
                ({
                  kind: 'card',
                  payload: { tile: o.tile, token: o.token, spend: o.spend },
                }) as TaskAnswer,
            );
        }
        // STEP 2: where the next contested card of this crop comes from.
        const scratch = JSON.parse(JSON.stringify(plan)) as WildPlan;
        const suit = wildSettle(data, state, task.pid, scratch);
        if (suit === null) return [];
        return wildSources(data, state, task.pid, scratch, suit).map(
          (src) => ({ kind: 'card', payload: { from: src.from } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('wildDeliver expects a card answer');
        let plan = task.riders.plan as WildPlan | undefined;
        if (plan === undefined) {
          const { tile, token, spend } = answer.payload as {
            tile: string;
            token: number;
            spend: Tally;
          };
          plan = { tile, token, spend, need: { ...spend }, barn: {}, buildings: {} };
        } else {
          const suit = wildSettle(fx.data, fx.state, task.pid, plan);
          if (suit === null) throw new Error('A8 has nothing left to source');
          wildTake(plan, suit, answer.payload.from as 'barn' | CardId, 1);
        }
        if (wildSettle(fx.data, fx.state, task.pid, plan) !== null) {
          // A genuine choice is still open: stay at the head and ask it.
          task.riders.plan = plan;
          return false;
        }
        wildPay(fx, task.pid, plan);
        return true;
      },
    },
  },
};

/**
 * A9 The Pollinator Trail - "Sow cards from your hand onto another building,
 * up to its threshold. If it's full, you may Harvest the building." v49
 * retext (24/09/2026, `tasks/v49-rulings-v1.md` R1-R3): the whole card
 * changes shape - a HAND sow of one or more cards onto ONE other building,
 * never the deck-top sow plus Draw 2 of v47-v48.
 */
export const pollinatorTrail: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: true },
    notes:
      '⭐ v49 (24/09/2026): THE DECK SOW AND THE TRAILING DRAW ARE BOTH GONE. In their place, ' +
      "a hand sow: R1 sows 1 OR MORE cards from the owner's hand onto ONE other building, up " +
      'to the number that fills it - the player may stop with fewer, and then there is no ' +
      "Harvest. R2 targets 'another building' exactly as every other sow does: never A9 " +
      'itself, never a Notice Board (S11), never a Power or an End-game card - the last two ' +
      'print no threshold, so `ownBuildings` (buildings.ts) already excludes them by ' +
      'construction and needs no extra check. R3: the trailing Harvest, when the sow fills ' +
      'the building, is a REAL Harvest of that ONE building - the whole stack to the barn, ' +
      'When-Harvested text and W16/W18 firing - optional ("you may"). ' +
      "⭐ THE BUILDER DEFAULT (`tasks/v49-rulings-v1.md`, 'not asked; stands'): one card at a " +
      "time, 'sow one more, or stop', never a chosen SET - the standing branching-blow-up " +
      'guard every multi-card choice in this file obeys (buildings.ts module note). File-local ' +
      '`card` task `pollinatorSow`, riders `{ building: CardId | null }`: round 1 (`building` ' +
      'null) enumerates every hand card onto every legal OTHER building and is MANDATORY (no ' +
      'printed "may", so no skip is offered while a legal sow exists - it auto-drops on an ' +
      "empty hand or no legal building, same as every other unmodified 'Sow' verb in the " +
      'suit); every later round is pinned to the ONE building the first answer named (never a ' +
      "different building mid-sow) and offers a skip - R1's early stop. A card that fills the " +
      'target ends the sow itself and queues the Harvest offer without waiting for a skip. ' +
      "⭐ BOT PRICING: the sow answers are ordinary `{ kind: 'sow' }` (not the flat `card` " +
      'catch-all), so `sow`/`sowCompletes` price them by their own dedicated terms exactly as ' +
      "a generic sow would; the Harvest offer is the shared `chooseBuilding` -> 'harvest' " +
      'shape, priced by stack size. Only the early-stop decision (skip vs a further sow) ' +
      'carries no dedicated weight, which is the standing flat `skip` caveat every optional ' +
      "stop in this file shares (§0's open note: bots may decline an optional Harvest a human " +
      'would take).',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'pollinatorSow',
      riders: { building: null },
    });
  },
  tasks: {
    pollinatorSow: {
      answers(data, state, task) {
        const hand = player(state, task.pid).hand;
        if (hand.length === 0) return [];
        const chosen = task.riders.building as CardId | null;
        const candidates =
          chosen !== null
            ? [chosen]
            : ownBuildings(data, state, task.pid)
                .filter((b) => b.card !== task.src)
                .map((b) => b.card);
        const targets = candidates.filter((card) => {
          const b = player(state, task.pid).tableau.find((x) => x.card === card);
          return b !== undefined && canSowOnto(data, b);
        });
        if (targets.length === 0) return [];
        const out: TaskAnswer[] = hand.flatMap((card) =>
          targets.map((onto) => ({ kind: 'sow', card, onto }) as TaskAnswer),
        );
        // R1: mandatory to START (no skip on round 1); "sow one more, or stop"
        // is offered only once a building has been chosen.
        if (chosen !== null) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'sow') throw new Error('pollinatorSow expects a sow answer');
        fx.placeOnBuilding(task.pid, { seat: task.pid, card: answer.onto }, answer.card);
        task.riders.building = answer.onto;
        const b = player(fx.state, task.pid).tableau.find((x) => x.card === answer.onto);
        if (b && isHarvestable(fx.data, b)) {
          fx.pushTask({
            t: 'chooseBuilding',
            pid: task.pid,
            src: task.src,
            filter: 'harvestable',
            targets: [answer.onto],
            optional: true,
            then: 'harvest',
          });
          return true;
        }
        return false;
      },
    },
  },
};

/**
 * A10 The Cross-Pollinator - "Visit another player's Notice Board, using a
 * deck card." (v48 retext, 24/09/2026; was "Sow 1 card from your hand onto a
 * neighbour's building, then Draw 3" on v42-v47.)
 */
export const crossPollinator: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      '⭐ v48 (24/09/2026): A REAL VISIT, paid with a deck card instead of a hand card. ' +
      '`tasks/v48-rulings-v2.md` R2: it is a visit, so W17 (host), O16 and A17 (visitor) fire ' +
      'for it. R9 (Q4 of `tasks/v48-ambiguity-audit-v1.md`, against the recommendation): an ' +
      'EXTRA visit with NO per-board latch - it is not the one bonus visit (never reads or ' +
      'writes `turn.bonusUsed`), and it may land on the very board the bonus slot visited ' +
      'this turn (never reads or writes `turn.firedThisTurn` for the board). The deck card ' +
      "is the top of a deck of the owner's choice (v45 R5). " +
      'THE MACHINERY is `cardVisitTargets` and `doCardVisit` in `actions/bonus.ts`, which ' +
      "share the bonus-slot visit's own tail (`noticeBoardVisitTail`) so the hooks, events, " +
      "power and S17 run identically: the deck card lands on the rival's board placed by the " +
      'visitor (A16 reads it), then `afterVisit`, `visited`, `doorUsed`, the power for the ' +
      'visitor, `afterWork`. Only boards whose power this seat can carry out right now are ' +
      'offered (S10); never your own board (the face says "another player\'s"). Mandatory ' +
      '(no "may"): one answer per (rival board, drawable deck), and nothing at all when no ' +
      'board is legal or every deck and discard is dry. ' +
      '⚠️ A10 IS NOW THE ONLY WAY A SEAT TAKES TWO VISITS IN ONE TURN since the old A ' +
      "Helping Hand's second play left the game (C120), which the audit flagged for Dean. " +
      '⚠️ Bot pricing: the answer runs through the catch-all `cardTask` term, which cannot ' +
      "tell one board's power from another (the V12 gap). " +
      "⛔ WHAT WENT: the v42 hand sow onto a neighbour's building and its Draw 3. " +
      '`neighbourSowTargets` (buildings.ts) loses its last caller here.',
  },
  activate(fx, self) {
    if (cardVisitTargets(fx.data, fx.state, self.seat).length === 0) return;
    if (drawableSuits(fx.data, fx.state).length === 0) return;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'crossVisit', riders: {} });
  },
  tasks: {
    crossVisit: {
      answers(data, state, task) {
        const decks = drawableSuits(data, state);
        return cardVisitTargets(data, state, task.pid).flatMap(({ host, board }) =>
          decks.map((suit) => ({ kind: 'card', payload: { host, board, suit } }) as TaskAnswer),
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('crossVisit expects a card answer');
        const { host, board, suit } = answer.payload as {
          host: Seat;
          board: CardId;
          suit: Suit;
        };
        doCardVisit(fx, task.pid, host, board, suit);
        return true;
      },
    },
  },
};

/**
 * A11 The Wax Workshop - "Harvest another of your buildings with 2 or more
 * cards on it, even if it is not full." v48 retext (24/09/2026): a REAL
 * Harvest of ONE building, not "put 1 card from each full building into your
 * Barn" (v42-v47). Threshold rises to 3 (data only, R15).
 */
export const waxWorkshop: CardHandler = {
  difficulty: {
    score: 2,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ v48 retext (24/09/2026, `tasks/v48-rulings-v2.md` R3 carried, and R15 on the ' +
      'threshold; `tasks/v48-ambiguity-audit-v1.md` row A11): a REAL HARVEST now, not a ' +
      'move - it prints "Harvest", so the whole stack goes to the barn, the When-Harvested ' +
      'line fires, and W16/W18 count it (the V11 reading, v46 R1). ONE building, the ' +
      "owner's choice: another of your buildings (never A11 itself), full OR holding 2 or " +
      'more cards - your own Notice Board included at 2 or more (R3), which the plain ' +
      'Harvest action never reaches below 3 (S8). Built off `chooseBuilding`, filter ' +
      "'harvestable', `relaxedMin: 2` (the same relaxation the Wheat SERVICE door already " +
      "passes), `exclude: self.card`, `then: 'harvest'` - the shared primitive W8 and the " +
      'Wheat door both use, so this needed no new engine seam. Mandatory (no "may"): with ' +
      'no building holding 2 or more cards, nothing happens. Threshold 3 is data only ' +
      '(R15): A11 can never harvest itself (R3), so its own clog is now cleared only by ' +
      "ANOTHER card's harvest reaching it. The `skimHive` move this replaces - one card per " +
      'FULL building, any suit, via `stackCardToBarn` - is gone; `stackCardToBarn` (fx.ts) ' +
      'lost its only caller here (v48) and regained one on A17 The Smoke Pot (v49, below).',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'chooseBuilding',
      pid: self.seat,
      src: self.card,
      filter: 'harvestable',
      relaxedMin: 2,
      exclude: self.card,
      then: 'harvest',
    });
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

/**
 * A13 The Queen's Hive - "Place any 3 deck cards into your Barn." v48 retext
 * (24/09/2026): the "3 or more Apiary buildings" gate is GONE - three deck-top
 * placements fire unconditionally, every time. Threshold 1 (data only,
 * unchanged).
 */
export const queensHive: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: false, conditional: false, counts: false, interrupts: false },
    notes:
      '⭐ v48 retext (24/09/2026, `tasks/v48-ambiguity-audit-v1.md` row A13, resolved-table ' +
      'entry): the gate is gone - "any 3 deck cards" fires with nothing to check. Same ' +
      "shape as A18's placement (v46 R8): three `deckToBarn` picks (buildings.ts), each the " +
      "top of a deck of the owner's choosing, the same deck as often as wanted. Mandatory, " +
      'doing as much as it can on a dry table (the task auto-drops picks it cannot answer). ' +
      "`cropBuildingsOf`, the gate's counter, has no other caller in this file and leaves " +
      'the import list; it still serves orchard.ts and wheat.ts. The older v42 note, about ' +
      'the gate this removes, follows. ' +
      'THE SWARM, and after 19/08/2026 it is the simplest card in the tier: three deck tops ' +
      'straight into your own barn, in a fixed order, with nothing to choose beyond the ' +
      'deck. ⚠️ DECK-TOP PRESSURE: three deck tops in one activation with no gate at all now, ' +
      'so read reshuffles per played deck before anything else in the arm. ⚠️ The barn is a ' +
      "dead end (barn to island only), so this accelerates nobody's engine - it buys island " +
      'freight and VP and nothing else. ⚠️ NOT a HIVE despite the name (the tier guard on ' +
      'isHiveCard), so it never counts for A10, A14 or A20. It carries a threshold of 1, so ' +
      "it is a legal target for A9, A11 and its own suit's placements. Threshold 1 means the " +
      "GROW payment fills it, so it clogs on every use and can't fire again until it is " +
      'harvested. That is the throttle on the whole effect.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'deckToBarn',
      riders: { remaining: 3 },
    });
  },
  tasks: { deckToBarn: deckToBarnTask() },
};

/**
 * A14 The Honeycomb Tower - "GROW up to 3 of your full buildings (not Notice
 * Board), without placing a card." v48 retext (24/09/2026): the whole card's
 * shape changes, not just a number - was "Draw 1 for each of your Apiary
 * buildings, Max 5" on v42-v47. Threshold 2 (data only, unchanged).
 */
export const honeycombTower: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: false },
    notes:
      '⭐ v48 retext (24/09/2026, `tasks/v48-rulings-v2.md`, `tasks/v48-ambiguity-audit-v1.md` ' +
      'row A14): exactly A5 and A12\'s "GROW without placing a card" (the suit\'s signature ' +
      'move, docblock at the top of this file) - the ability fires, nothing is paid, nothing ' +
      'lands, the stack does not move, so a FULL building stays full - but restricted to ' +
      'FULL buildings only and offered up to three times, declinable at every round. Never ' +
      'A14 itself, never a Notice Board (neither is ever a GROW target regardless), never a ' +
      'Power or Endgame card (no activation type), never a building that has already fired ' +
      'this turn (`turn.firedThisTurn`, the standing recursion guard that also terminates ' +
      'A12 -> A5 -> A12). ' +
      "THE SHARED `activate` task (A12's, and this card's own pre-v48 face) OFFERS NO SKIP " +
      '- it fires exactly `remaining` targets or as many as remain, which is right for ' +
      'A12\'s mandatory "GROW 2" but wrong for a printed "up to". `chooseBuilding` HARVESTS, ' +
      'which this card never does. So this is a file-local `card` task (`honeycombGrow`): ' +
      'each round RE-DERIVES its own target list fresh off `activateTargets` (the same ' +
      'building-eligibility gate A12 uses) filtered to full buildings (`isHarvestable`), so ' +
      'a building an earlier firing in the same activation fills or a Harvest an earlier ' +
      'firing triggers elsewhere moves buildings in or out of scope BETWEEN rounds - the ' +
      'live re-check the ruling calls for, which a snapshot `targets` array on the shared ' +
      "`activate` task could not give it. One activation per round, the owner's choice, a " +
      'skip offered whenever a legal target remains; skipping (or running out of legal ' +
      'targets, or reaching 3) ends the whole sequence - A14 does not ask again this turn. ' +
      'The older v42 note, about the per-Apiary-building draw this replaces, follows. ' +
      '⚠️ THAT CARD WAS THE LOUDEST BALANCE RISK OF THE 19/08/2026 PASS: an own-suit scaler ' +
      'that paid the owner for owning more of their own row and gave the table nothing ' +
      "back. The v48 retext removes the scaler entirely; what replaces it is Apiary's usual " +
      'clog-bypass move, gated on fullness rather than on hand-refilling.',
  },
  activate(fx, self) {
    fx.pushTask({
      t: 'card',
      pid: self.seat,
      src: self.card,
      kind: 'honeycombGrow',
      riders: { remaining: 3 },
    });
  },
  tasks: {
    honeycombGrow: {
      answers(data, state, task) {
        if ((task.riders.remaining as number) <= 0) return [];
        const seat = task.pid;
        const selfCard = task.src as CardId;
        const targets = activateTargets(data, state, seat, [selfCard]).filter((card) => {
          const b = player(state, seat).tableau.find((x) => x.card === card);
          return b !== undefined && isHarvestable(data, b);
        });
        if (targets.length === 0) return [];
        return [
          ...targets.map((card) => ({ kind: 'activate', card }) as TaskAnswer),
          { kind: 'skip' } as TaskAnswer,
        ];
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'activate') {
          throw new Error('honeycombGrow expects an activate answer');
        }
        activateOnly(fx, task.pid, answer.card);
        task.riders.remaining = (task.riders.remaining as number) - 1;
        return (task.riders.remaining as number) <= 0;
      },
    },
  },
};

/**
 * The hand cards A15 The Royal Apiary may discard (R6): Tier 1-3 only, read
 * as "prints an activated line" (`activationType !== null`). Power and
 * End-game cards print no activation type and are never offered; starters are
 * never in a hand.
 */
function royalCandidates(data: GameData, state: GameState, seat: Seat): CardId[] {
  return player(state, seat).hand.filter((id) => cardById(data, id).activationType !== null);
}

/**
 * A15 The Royal Apiary - "Discard a crop card from your hand and activate that
 * card's ability." Threshold 3 (v48 retext, 24/09/2026; was "Draw 1 for each
 * of your buildings with a card on it", threshold 1).
 */
export const royalApiary: CardHandler = {
  difficulty: {
    score: 4,
    verified: { prompts: true, crossPlayer: true, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      '⭐ v48 (24/09/2026), ruled in `tasks/v48-rulings-v2.md`: R1 (it carries out the ' +
      'printed activation effect of the discarded card), R6 (Q1: only a Tier 1-3 card may be ' +
      'discarded and ONLY ITS ACTIVATED LINE fires - never a When-Harvested line, so W5 via ' +
      'A15 draws 1, not 1 and 3; a Power or End-game card cannot be chosen, and with no Tier ' +
      'card in hand A15 does nothing; mandatory otherwise), R7 (Q2: "this building" is the ' +
      'discarded card, which is not on the farm, so that part finds nothing - A4 draws 0, O5 ' +
      'draws 2 and sows nothing, V14 delivers and destroys nothing; "another / other of your ' +
      'buildings" excludes nothing extra, so it may reach A15 itself) and R15 (threshold 3, ' +
      'data only). ' +
      "THE DISPATCH: the chosen card goes to its crop's discard (`fx.discard`, a card-effect " +
      'discard from the hand, never a barn discard), then `handlerFor(card).activate` runs ' +
      'with `self = { seat, card: <the discarded card> }`. No cost is paid, nothing is ' +
      "placed, no stack advances and the Farmstead's GROW rider does not fire (it modifies " +
      'the GROW action, not card text). Custom tasks already dispatch on `task.src` through ' +
      "the registry, not the tableau, so the discarded card's own tasks resolve normally, " +
      "and every self-reference that looks itself up on the farm (A4's stack, O5's sow " +
      "target, V14's demolition check) finds nothing, which IS R7. The discarded card is NOT " +
      'marked fired: it is not on the farm, and `firedThisTurn` means a building fired. ' +
      '⭐ THE LISTENER TRAP, SOLVED HERE AND NOT IN dairy.ts: D5 The Churning Shed, D7 The ' +
      'Versatile Shed and D11 The Heritage House finish their activated line in an ' +
      '`on.afterBuild` listener keyed on `event.src === self.card`, and `fireHook` only walks ' +
      "cards ON A TABLEAU, so a discarded card's listener would never hear its own Build. A15 " +
      'therefore carries its own `afterBuild` listener that FORWARDS the event to the ' +
      "discarded card's listener when, and only when: the build is A15's owner's, its `src` " +
      'is a card on NO tableau (only a card fired from outside the farm can be that, and ' +
      'A15 is the only card that fires one), and A15 has fired this turn. The forwarded ' +
      "`self` names the discarded card, so the listener's own `src` check passes exactly as " +
      'it would on the farm. No other `on` hook carries a `src`, and no other activated line ' +
      "lives in a listener: W4-W8's `afterHarvest` riders are When-Harvested lines, which R6 " +
      'excludes. ' +
      "⚠️ BOTS: that listener puts A15 on `narrow.test.ts`'s afterBuild tripwire, and a " +
      'forwarded D5 or D7 makes the IDENTITY of a spent card matter, so A15 belongs in ' +
      '`READS_BUILD_PAYMENT` and `KEEPS_SPENT_CARDS` (`packages/bots/src/narrow.ts`), which ' +
      'this pass may not edit. ' +
      'NO RECURSION: there is one A15, and it is marked fired before this runs (by `doGrow` ' +
      'or `activateOnly`), so a discarded A5, A6, A12 or A14 cannot fire it again this turn: ' +
      'every one of them filters on `firedThisTurn`. ⚠️ Bot pricing: each answer fires a ' +
      'different handler, priced through the probe, so the cost grows with hand size. ' +
      '`crossPlayer: true` (integration pass, 24/09/2026): the discarded card is dispatched ' +
      'through its OWN activate, and a discarded A10 The Cross-Pollinator runs `doCardVisit` ' +
      'exactly as a real A10 would, naming a rival host and a rival Notice ' +
      'Board - a primitive that targets another seat, which is what `FxAudit.crossSeat` ' +
      '(fx.ts) means and what this flag documents. Nothing else A15 can discard reaches ' +
      'another seat (R7 confines every other self-reference to a card that is on no farm), ' +
      'so A15 is cross-player on exactly one of its Tier candidates and honestly true overall.',
  },
  activate(fx, self) {
    if (royalCandidates(fx.data, fx.state, self.seat).length === 0) return;
    fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'royalDiscard', riders: {} });
  },
  tasks: {
    royalDiscard: {
      answers(data, state, task) {
        // The answer names a card in the owner's own hand, which the view
        // already carries (the O15 precedent on `t: 'card'` riders).
        return royalCandidates(data, state, task.pid).map(
          (card) => ({ kind: 'card', payload: { card } }) as TaskAnswer,
        );
      },
      resolve(fx, task, answer) {
        if (answer.kind !== 'card') throw new Error('royalDiscard expects a card answer');
        const card = answer.payload.card as CardId;
        if (!royalCandidates(fx.data, fx.state, task.pid).includes(card)) {
          throw new Error(`${card} is not a Tier card in seat ${task.pid}'s hand`);
        }
        fx.removeFromHand(task.pid, card);
        fx.discard([card]);
        // R1 / R6: the ACTIVATED line only, with the discarded card as `self` (R7).
        handlerFor(card)?.activate?.(fx, { seat: task.pid, card });
        return true;
      },
    },
  },
  on: {
    afterBuild(fx, event, self) {
      if (event.seat !== self.seat) return;
      const src = event.src;
      if (src === null || src === self.card) return;
      if (!fx.state.turn.firedThisTurn.includes(self.card)) return;
      // A card on any farm hears its own build through the ordinary bus.
      if (fx.state.players.some((p) => p.tableau.some((b) => b.card === src))) return;
      handlerFor(src)?.on?.afterBuild?.(fx, event, { seat: self.seat, card: src });
    },
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
      'Never fires when a rival brings YOUR building to 2. ⭐ NO PER-TURN LIMIT, AND THAT ' +
      'IS A DECISION RE-TAKEN ON 10/09/2026 RATHER THAN AN OMISSION. S9 makes two ' +
      "placements a turn possible for the first time (A Helping Hand's second bonus is a " +
      'second play, onto a different board), which is exactly the change that forced a ' +
      'guard onto A17 The Smoke Pot and O16 The Fruit Store the same day - so the question ' +
      'was asked of this card too and answered the other way. IT IS A PLACEMENT REACTOR, ' +
      'NOT A VISIT REACTOR: it already fires an unbounded number of times a turn off ' +
      'ordinary grow payments and sows (O14 The Conservatory sows a whole hand), it is ' +
      'keyed to a stack POSITION rather than to anything the bonus slot produces, and ' +
      'capping it would change the card in every game including the shipped commons. The ' +
      'two cards guarded that day are guarded because their trigger IS the bonus slot; ' +
      'this one is not. ' +
      '⚠️ READ ITS DRAW COUNT IN THE PASS (S16): four boards cycling through two cards ' +
      'all game is a lot of position-2 placements, and the handoff asks for visit ' +
      'placements split from ordinary ones. ⚠️ ITS ' +
      'SUPPLY OF TRIGGERS SHRANK ON 19/08/2026 without a word of its own text changing: ' +
      'A13, A14 and A17 all used to place cards and none of them does now (A13 and A17 send ' +
      'theirs to a barn, A14 places nothing at all). What is left inside the suit is A7, ' +
      "A9, the Barn's build rider, your own GROW payments and your visit fee landing on a " +
      "neighbour's board. Worth a look in the arm: this card was priced against six " +
      'placement sources and now has five.',
  },
  on: {
    // ⭐ DELIBERATELY UNGUARDED, re-decided 10/09/2026 - see the notes. It
    // fires per PLACEMENT and always has; A17 and O16 gained per-turn guards
    // that day because their trigger is the bonus slot, and this one's is not.
    // Both of those guards were removed on 15/09/2026 (card text fires every
    // time its trigger happens), so all three now agree.
    afterPlacement(fx, event, self) {
      if (event.seat !== self.seat) return;
      if (event.stackSize !== 2) return;
      drawN(fx, self.seat, self.card, 1);
    },
  },
};

/**
 * A17 The Smoke Pot - "At the end of your turn, you may move 1 card from any 1
 * of your full buildings to your Barn." v49 retext (24/09/2026,
 * `tasks/v49-rulings-v1.md` R4): a NEW SHAPE - a clog RELIEF valve rather than
 * a visit reward. Was "Whenever you visit a neighbour, you may SOW the top
 * card of any deck onto one of your buildings" on v42-v48.
 */
export const smokePot: CardHandler = {
  difficulty: {
    score: 3,
    verified: { prompts: true, crossPlayer: false, addsMoves: false, endgame: false },
    asserted: { newPrimitive: true, conditional: true, counts: false, interrupts: true },
    notes:
      '⭐ v49 (24/09/2026): THE TRIGGER, THE SOURCE AND THE DESTINATION ALL CHANGE AT ONCE. ' +
      'The card no longer keys off a visit at all - `afterVisit` and its visitor/neighbour ' +
      'guards are gone - and moves onto `beforeTurnEnd`, the same fixed end-of-turn seam ' +
      'O17 The Fruit Basket, V17 and O18 already use (`fruitBasket`, orchard.ts): ' +
      "`finishTurn` fires it exactly once a turn, before the hand-limit discard, so 'once a " +
      "turn' is automatic and needs no `markFired` guard of its own. Owner-scoped " +
      '(`event.seat === self.seat`). ' +
      "⭐ R4 (Dean): the source is any ONE of the OWNER'S OWN full buildings - never a " +
      "rival's, so this is no longer a cross-table card at all (`crossPlayer` flips to " +
      'false) - and a Notice Board is NEVER a source: a `3+` board is never `isFull` ' +
      '(S8), which is the CLOG definition (`isFull`, query.ts), not the harvest-reached ' +
      "definition `isHarvestable` most of this suit's other new Harvest offers read. Using " +
      '`isFull` rather than the more familiar `fullBuildings`/`harvestable` filter is ' +
      'deliberate and load-bearing: `fullBuildings` would wrongly let a `3+` Notice Board ' +
      'count once it held three cards, which R4 explicitly rules out ("A Notice Board is ' +
      "never 'full' and is not a source\"). One card, the OWNER's choice, off any full " +
      "building's stack, so a mixed stack (sow is suit-free) is a real choice - which crop " +
      'leaves matters to the Barn\'s own-crop scorer. Optional ("you may"): a skip is ' +
      'offered and a full building simply stays clogged. ' +
      '⭐ A PLACEMENT INTO THE BARN, NOT A HARVEST (R4, and the builder default note): the ' +
      'primitive is `fx.stackCardToBarn` (fx.ts), which splices the one named card off the ' +
      'stack and pushes it straight to the barn with no `afterHarvest` hook, exactly as the ' +
      "old A11 (pre-v48) used it and exactly as D7 The Versatile Shed's `spendFromStack` " +
      'sibling stays out of the Harvest funnel on purpose. `stackCardToBarn` was orphaned by ' +
      'the v48 pass (A11 The Wax Workshop moved to a real Harvest) and this is its first ' +
      'caller since. THE BUILDING IS THEN NO LONGER FULL (R4): one card leaves a stack that ' +
      'was exactly at threshold, so it drops back under, and it may be grown again next ' +
      "turn - this is the card's whole point, a Harvest-shaped release valve that costs no " +
      "action and touches no other card's text. " +
      "⛔ WHAT WENT: the deck-top sow onto one of the owner's buildings, and the whole " +
      'visitor/neighbour-side machinery (`afterVisit`, `event.self`, the v31 self-visit ' +
      'guard) that machinery needed. A17 no longer cares who visited whom, or whether ' +
      'anybody did. ' +
      "⭐ BOT PRICING: no existing `TaskAnswer` kind fits 'one of (building, card on its " +
      "stack)', so the choice is a file-local `card` task (`smokePotMove`) whose answers " +
      'fall through the flat `cardTask`/`skip` terms - a genuine measurement caveat, the ' +
      "same shape A10's board/deck choice and A15's discard choice already carry (§0). " +
      '⛔ THE ANSWER NAMES A CROP, NEVER A CARD ID (fixed after `view-safety.test.ts` caught ' +
      'it at seed `view-safety-3-0` step 308): `buildingView` (view.ts) shows every stack, ' +
      "including the OWNER's own, as suit letters only - individual card identity on a " +
      'stack is not part of ANY view, owner included - so an answer naming a specific ' +
      'stacked card by id cannot be justified from what the answering seat can even see, ' +
      "the same boundary that makes D10 The Scout's Post answer a revealed deck top BY " +
      'SLOT rather than by id (`revealedIn`/`pickFromReveal`, state.ts). Cards on one ' +
      'stack of the same crop are interchangeable for this purpose (sow is suit-free, so a ' +
      'stack is a multiset of crops with no meaningful order - the standing Discard ' +
      'Ordering principle applies here too), so the answer is `{ building, crop }` and the ' +
      'resolver takes the first stacked card of that crop - any one of them is the same ' +
      'move. This also SHRINKS the answer count to at most one per crop on a stack rather ' +
      'than one per card.',
  },
  on: {
    beforeTurnEnd(fx, event, self) {
      if (event.seat !== self.seat) return;
      // R4: `isFull` (the CLOG question), never `isHarvestable`/`fullBuildings`
      // (the HARVEST question) - a `3+` Notice Board answers isHarvestable at
      // three cards but isFull is false for it forever (S8), which is exactly
      // the exclusion R4 names.
      const full = player(fx.state, self.seat).tableau.filter((b) => isFull(fx.data, b));
      if (full.length === 0) return;
      fx.pushTask({ t: 'card', pid: self.seat, src: self.card, kind: 'smokePotMove', riders: {} });
    },
  },
  tasks: {
    smokePotMove: {
      answers(data, state, task) {
        const full = player(state, task.pid).tableau.filter((b) => isFull(data, b));
        const out: TaskAnswer[] = full.flatMap((b) => {
          // BY CROP, NEVER BY CARD ID: a stack is shown to every seat, its
          // owner included, as suit letters only (`buildingView`, view.ts),
          // so the answer can only name what that view can see.
          const crops = new Set(b.stack.map((card) => cardById(data, card).suit));
          return [...crops].map(
            (crop) => ({ kind: 'card', payload: { building: b.card, crop } }) as TaskAnswer,
          );
        });
        if (out.length > 0) out.push({ kind: 'skip' });
        return out;
      },
      resolve(fx, task, answer) {
        if (answer.kind === 'skip') return true;
        if (answer.kind !== 'card') throw new Error('smokePotMove expects a card answer');
        const { building, crop } = answer.payload as { building: CardId; crop: Suit };
        const b = player(fx.state, task.pid).tableau.find((x) => x.card === building);
        if (!b) throw new Error(`${building} is not on seat ${task.pid}'s farm`);
        // Any card of the named crop is the same move (crops on a stack are
        // interchangeable; see the docblock).
        const card = b.stack.find((c) => cardById(fx.data, c).suit === crop);
        if (card === undefined) throw new Error(`No ${crop} card on ${building}'s stack`);
        fx.stackCardToBarn(task.pid, building, card);
        return true;
      },
    },
  },
};

/**
 * A19 The Honey Hall - "Game end: 2 VP for each tractor building you have
 * built. (Max 6VP)" v48 retext (24/09/2026): "tractor building" is Dean's name
 * for a Power card, of ANY suit (R5, `tasks/v48-rulings-v2.md`); the old count
 * of non-Apiary BUILDINGS is gone, and the rate doubles from 1 to 2. Was
 * "1 VP for each non-Apiary building you have built (Max 5)" on v45-v47.
 */
export const honeyHall: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v48 retext (24/09/2026, R5, `tasks/v48-rulings-v2.md`; Q8 of ' +
      '`tasks/v48-ambiguity-audit-v1.md`): "tractor building" = a Power card (`type === ' +
      "'power'`) of ANY suit in the seat's farm at game end - the cards printing the tractor " +
      'icon (A16, A17, A18 and their D/O/V/W siblings). NOT `foreignBuildingsOf` any more: ' +
      'that helper reads `ownBuildings`, which is threshold cards only, so it structurally ' +
      'can never see a Power card - counting Power cards means reading the tableau directly ' +
      'and filtering on `type`, own-suit Power cards included (the old card excluded its ' +
      'own suit; this one does not, R5). `foreignBuildingsOf` (buildings.ts) loses its only ' +
      'caller across the whole codebase and is orphaned rather than deleted (not this ' +
      "pass's file; it still serves nobody else). " +
      '2 VP each, and "(Max 6VP)" caps the VP directly, not the count, so at most three ' +
      'Power cards score. `rules.economy.honeyHallCap` (added v45 R9 on the `grandGranaryCap` ' +
      'pattern) is RE-POINTED rather than replaced: it was already read as a VP figure ' +
      '(`Math.min(cap, vp)`), and the old 1-VP-per-count rate made a VP cap and a count cap ' +
      'numerically identical, which is why nobody had to notice the distinction before. At ' +
      '2 VP per card the two diverge, so the shipped value moves 5 to 6 to keep capping VP, ' +
      'not the count (a count cap of 5 would allow 10 VP, well past the printed "(Max 6VP)"). ' +
      'null would be uncapped, as before. The older v45 and v42 notes, about the count this ' +
      'replaces, follow. ' +
      '⭐ v45 (R9, tasks/v45-rulings-v1.md): the printed cap is a new tunable number, on the ' +
      '`grandGranaryCap` pattern (W20) - its own knob rather than shared with A20 ' +
      '`apiaristsGuildCap`, because the two cards count different things. ' +
      '⭐ v42: the rate falls 3 to 1 (now v48 raises it back to 2, on a different count). It ' +
      'counted BUILDINGS (`foreignBuildingsOf`, threshold cards printing another crop), so a ' +
      'foreign Power or Endgame card did not count then - the exact reading v48 reverses. ' +
      'THE MANY FLOWERS, and it used to pay for Apiary paying no crop cost to fire a foreign ' +
      "building; the v48 card pays instead for stacking the table's rarest card type, the " +
      'Power cards, regardless of suit. ⚠️ Duplicates D19 The Cheese Hall in shape; the two ' +
      "no longer share a rate. ⚠️ Watch for an Apiary seat building several suits' Power " +
      'cards purely to bank this line.',
  },
  gameEnd(data, state, seat) {
    const towers = player(state, seat).tableau.filter(
      (b) => cardById(data, b.card).type === 'power',
    ).length;
    const cap = data.rules.economy.honeyHallCap;
    const vp = towers * 2;
    return cap === null ? vp : Math.min(cap, vp);
  },
};

/**
 * A20 The Apiarist's Guild - "Game end: 1 VP for each 1VP building you have
 * built. (Max 5)" (v45, 19/09/2026: the "(Max 5)" cap is new; v42 was
 * uncapped at 1 VP each.)
 */
export const apiaristsGuild: CardHandler = {
  difficulty: {
    score: 1,
    verified: { prompts: false, crossPlayer: false, addsMoves: false, endgame: true },
    asserted: { newPrimitive: false, conditional: false, counts: true, interrupts: false },
    notes:
      '⭐ v45 (R9, tasks/v45-rulings-v1.md): the printed "(Max 5)" is a new tunable number, ' +
      '`rules.economy.apiaristsGuildCap`, on the `grandGranaryCap` pattern (W20) - shipped 5, ' +
      'its own knob rather than shared with A19 `honeyHallCap`, because the two cards count ' +
      'different things. null would be uncapped, which is how the card read before this ' +
      'ruling. The older v42 note follows. ' +
      '⭐ v42: 1 VP for each building you have built whose PRINTED VP is exactly 1, of any ' +
      'suit (`builtBuildingsWorth`, buildings.ts). Buildings only: a Power or Endgame card ' +
      'printing 1 VP never counts, and on v42 the Power cards print 0 anyway. One of a ' +
      'family with D21 (3VP buildings) and O20 (2VP buildings). It used to count HIVEs, ' +
      'A4 to A8, at 2 VP each.',
  },
  gameEnd(data, state, seat) {
    const count = builtBuildingsWorth(data, state, seat, 1);
    const cap = data.rules.economy.apiaristsGuildCap;
    return cap === null ? count : Math.min(cap, count);
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
