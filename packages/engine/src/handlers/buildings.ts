/**
 * THE BUILDING NOUNS OF THE v42 SHEET, AND THE CHOICES THEY SHARE (16/09/2026).
 *
 * v41 took the sub-type nouns off the card text - FIELD, HIVE, SHED, GROVE and
 * DEPOT became "your Wheat buildings", "your Apiary buildings" and so on - and
 * v42 prints a family of "for each N VP building you have built" scorers. Four
 * suit files now ask the same three questions, so they are answered once, here.
 * The title-keyword sub-types (`isFieldCard`, `isHiveCard`, `isOrchardCard`,
 * `isShedCard`) stay exported for the simulator and for W21, but no v42 card
 * text reads them any more.
 *
 * ⭐ BUILDER DEFAULT (16/09/2026, not a ruling): A BUILDING IS A CARD IN YOUR
 * TABLEAU THAT PRINTS A THRESHOLD (`thresholdOf` is not null). That is every
 * Tier 1-3 card and the Notice Board; never the Barn or the Farmstead (no
 * threshold) and never a Power or Endgame card (no threshold, no stack). It is
 * the engine's own definition - `canTakeCard`, `isHarvestable` and A21 The Wax
 * Hall all read through `thresholdOf` - and it is used for TARGETS (sow,
 * harvest, grow) and for COUNTS (A13's gate, A14, A19, A20, D21, O20) alike.
 * One consequence worth knowing: the Power cards' printed VP (1 before v42, 0
 * on v42) can never reach A20, D21 or O20, whichever way Dean rules on it.
 *
 * ⭐ "YOUR <CROP> BUILDINGS" are your buildings printing that crop's icon
 * (`cropOf`, ticket 07), so a starter - the Notice Board included - is never
 * one: all fifteen print the generic starting-building icon.
 *
 * ⭐ "A BUILDING YOU HAVE BUILT" is a building that is not a starter. Nobody
 * built the starters.
 *
 * ⚠️ The Barn's own-crop scorer (`barnCropScorer`) deliberately counts every
 * CARD built, Power and Endgame included ("card you have built"), and does not
 * read anything in this file.
 *
 * ⛔ Every multi-card choice below is a SEQUENCE OF SINGLE CHOICES with a stop
 * answer where the text says "up to", never a subset enumeration. Branching
 * blow-up is this engine's main performance risk.
 */

import type { GameData, Suit } from '@gp/data';

import { growOptions } from '../actions.js';
import type { Fx } from '../fx.js';
import { canSowOnto, cardById, cropOf, drawableSuits, player, thresholdOf } from '../query.js';
import { doGrow } from '../runtime.js';
import type { BuildingRef, BuildingState, CardId, GameState, Seat, TaskAnswer } from '../state.js';
import type { CustomTask } from './types.js';

/** Is this tableau card a building - does it print a threshold? See the module note. */
export function isBuilding(data: GameData, building: BuildingState): boolean {
  return thresholdOf(data, building) !== null;
}

/** Is this card a Notice Board (any suit's)? */
export function isNoticeBoardCard(data: GameData, card: CardId): boolean {
  return cardById(data, card).slot === 'noticeboard';
}

/** "Your buildings": every card in the seat's tableau that prints a threshold. */
export function ownBuildings(data: GameData, state: GameState, seat: Seat): BuildingState[] {
  return player(state, seat).tableau.filter((b) => isBuilding(data, b));
}

/** "Your <crop> buildings": your buildings printing that crop's icon. Never a starter. */
export function cropBuildingsOf(
  data: GameData,
  state: GameState,
  seat: Seat,
  crop: Suit,
): BuildingState[] {
  return ownBuildings(data, state, seat).filter((b) => cropOf(data, b) === crop);
}

/** "Your non-<crop> buildings you have built": buildings printing some OTHER crop's icon. */
export function foreignBuildingsOf(
  data: GameData,
  state: GameState,
  seat: Seat,
  crop: Suit,
): BuildingState[] {
  return ownBuildings(data, state, seat).filter((b) => {
    const printed = cropOf(data, b);
    return printed !== null && printed !== crop;
  });
}

/**
 * "Each <vp>VP building you have built" (A20, D21, O20): non-starter buildings
 * whose PRINTED VP is exactly `vp`. Printed VP is read off the card as it is in
 * `cards.json`, so the count moves with the sheet and never with a knob.
 */
export function builtBuildingsWorth(
  data: GameData,
  state: GameState,
  seat: Seat,
  vp: number,
): number {
  return ownBuildings(data, state, seat).filter((b) => {
    const card = cardById(data, b.card);
    return card.type !== 'starter' && card.printedVp === vp;
  }).length;
}

/**
 * "A neighbour's building" as a SOW target (A8, A10): every building every
 * other seat owns, never a Notice Board. The live room check (`canSowOnto`) is
 * applied by the task at answer time, so a building that clogs between the push
 * and the answer drops out by itself.
 *
 * ⚠️ The Notice Board exclusion is written out here rather than left to
 * `canSowOnto`, which excludes it only under the notice-board visit (S11). A
 * card that says "a neighbour's building" must not become a free visit fee under
 * any control.
 */
export function neighbourSowTargets(data: GameData, state: GameState, seat: Seat): BuildingRef[] {
  const out: BuildingRef[] = [];
  state.players.forEach((p, s) => {
    if (s === seat) return;
    for (const b of p.tableau) {
      if (!isBuilding(data, b) || isNoticeBoardCard(data, b.card)) continue;
      out.push({ seat: s, card: b.card });
    }
  });
  return out;
}

/** A building on the table, if it is still there. */
function findBuilding(state: GameState, ref: BuildingRef): BuildingState | undefined {
  return state.players[ref.seat]?.tableau.find((b) => b.card === ref.card);
}

/**
 * The riders of a `deckSow` card task. Push it with `deckSowRiders`.
 *
 * - `remaining`: deck cards still to place.
 * - `targets`: the legal buildings, snapshotted at push time; each is
 *   re-checked live (`canSowOnto`, and `emptyOnly`) at every answer.
 * - `distinct`: "up to N of your buildings" - a building that took a card
 *   leaves the list. Absent means the same building may take several.
 * - `optional`: "up to" - a skip answer ends the task.
 * - `emptyOnly`: W9's "buildings that are empty" - a stack must be empty at the
 *   moment the card lands.
 */
export interface DeckSowRiders {
  remaining: number;
  targets: BuildingRef[];
  distinct: boolean;
  optional: boolean;
  emptyOnly: boolean;
}

/** Build the rider bag for a `deckSow` task (a plain object, so it serialises). */
export function deckSowRiders(riders: DeckSowRiders): Record<string, unknown> {
  return { ...riders };
}

/**
 * ⭐ "SOW A DECK CARD ON UP TO N OF ..." - W9, A8, A9.
 *
 * One deck top at a time: the answer names a deck and a building, the card
 * lands through `fx.deckTopToBuilding` (so the placement reactors fire exactly
 * as for any sow), and the task stays for the next card while `remaining`
 * holds. The answer list is at most five decks times the live targets, plus a
 * skip where the text says "up to". Register it on the card's handler under the
 * kind `deckSow`.
 */
export function deckSowTask(): CustomTask {
  return {
    answers(data, state, task) {
      const r = task.riders as unknown as DeckSowRiders;
      if (r.remaining <= 0) return [];
      const targets = r.targets.filter((ref) => {
        const b = findBuilding(state, ref);
        if (!b || !canSowOnto(data, b)) return false;
        return !r.emptyOnly || b.stack.length === 0;
      });
      const out: TaskAnswer[] = [];
      for (const suit of drawableSuits(data, state)) {
        for (const ref of targets) {
          out.push({ kind: 'card', payload: { suit, seat: ref.seat, card: ref.card } });
        }
      }
      if (r.optional && out.length > 0) out.push({ kind: 'skip' });
      return out;
    },
    resolve(fx, task, answer) {
      const r = task.riders as unknown as DeckSowRiders;
      if (answer.kind === 'skip' && r.optional) return true;
      if (answer.kind !== 'card') throw new Error('deckSow expects a card answer');
      const ref: BuildingRef = {
        seat: answer.payload.seat as Seat,
        card: answer.payload.card as CardId,
      };
      fx.deckTopToBuilding(task.pid, answer.payload.suit as Suit, ref);
      task.riders.remaining = r.remaining - 1;
      if (r.distinct) {
        task.riders.targets = r.targets.filter((t) => t.seat !== ref.seat || t.card !== ref.card);
      }
      return (task.riders.remaining as number) <= 0;
    },
  };
}

/**
 * ⭐ "PUT N DECK CARDS INTO YOUR BARN", each from a deck of the player's choice
 * (A8, A13). The answer names a deck; the task stays while `remaining` holds.
 * Mandatory: no skip. A table with every deck dry offers nothing and the drain
 * loop drops the task. Register it under the kind `deckToBarn` (the same kind
 * D14 uses, so the interface already has words for it).
 */
export function deckToBarnTask(): CustomTask {
  return {
    answers(data, state, task) {
      if ((task.riders.remaining as number) <= 0) return [];
      return drawableSuits(data, state).map(
        (suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer,
      );
    },
    resolve(fx, task, answer) {
      if (answer.kind !== 'card') throw new Error('deckToBarn expects a card answer');
      fx.deckTopToBarn(task.pid, answer.payload.suit as Suit);
      task.riders.remaining = (task.riders.remaining as number) - 1;
      return (task.riders.remaining as number) <= 0;
    },
  };
}

/**
 * The riders of a `barnDiscard` card task (v42). Push it with
 * `barnDiscardRiders`.
 *
 * - `remaining`: barn cards still to discard.
 * - `optional`: "up to" (V10) - a skip answer ends the task early.
 * - `crops`: the crops discarded so far, in order; read by the `then` step.
 */
export interface BarnDiscardRiders {
  remaining: number;
  optional: boolean;
  crops: Suit[];
}

/** Build the rider bag for a `barnDiscard` task (a plain object, so it serialises). */
export function barnDiscardRiders(remaining: number, optional: boolean): Record<string, unknown> {
  const riders: BarnDiscardRiders = { remaining, optional, crops: [] };
  return { ...riders };
}

/**
 * ⭐ "DISCARD A CARD FROM YOUR BARN" - V8, V10, V12 and V15 (sheet v42,
 * 16/09/2026), the shared step V17 The Dockworker's Union hooks.
 *
 * One barn card at a time, named BY CROP (a barn is anonymous even to its
 * owner, so two cards of one crop are the same choice), through
 * `Fx.discardFromBarn`, which fires `afterBarnDiscard` per card. The task stays
 * while `remaining` holds. When it finishes - the budget spent, the barn
 * emptied, or a skip where the text says "up to" - `then` runs ONCE with every
 * crop discarded, in order, and queues whatever the card does next.
 *
 * ⛔ R6: a delivery payment never comes through here. Register it on the card's
 * handler under the kind `barnDiscard`.
 *
 * A mandatory discard with an empty barn offers nothing, so the drain loop
 * drops the task and `then` never runs: a card that says "Discard ... then X"
 * does not do X without the discard. An optional one that has already
 * discarded ends itself on the discard that empties the barn, so the drain
 * loop can never drop a task holding crops.
 */
export function barnDiscardTask(
  then: (fx: Fx, task: { pid: Seat; src: CardId }, crops: readonly Suit[]) => void,
): CustomTask {
  return {
    answers(data, state, task) {
      const r = task.riders as unknown as BarnDiscardRiders;
      if (r.remaining <= 0) return [];
      const barn = player(state, task.pid).barn;
      const out: TaskAnswer[] = data.cards.suits
        .filter((suit) => barn.some((id) => cardById(data, id).suit === suit))
        .map((suit) => ({ kind: 'card', payload: { suit } }) as TaskAnswer);
      if (r.optional && out.length > 0) out.push({ kind: 'skip' });
      return out;
    },
    resolve(fx, task, answer) {
      const r = task.riders as unknown as BarnDiscardRiders;
      if (answer.kind === 'skip' && r.optional) {
        if (r.crops.length > 0) then(fx, task, r.crops);
        return true;
      }
      if (answer.kind !== 'card') throw new Error('barnDiscard expects a card answer');
      const suit = answer.payload.suit as Suit;
      // The riders are written BEFORE the discard, whose hook may push tasks
      // but never touches this one.
      const crops = [...r.crops, suit];
      task.riders.crops = crops;
      task.riders.remaining = r.remaining - 1;
      fx.discardFromBarn(task.pid, suit, task.src);
      const done =
        (task.riders.remaining as number) <= 0 || player(fx.state, task.pid).barn.length === 0;
      if (done) then(fx, task, crops);
      return done;
    },
  };
}

/**
 * ⭐ "DRAW N OF THAT CROP" (V8, v42): N cards off ONE named deck, the O15
 * Garden Library shape - taken now, then handed to an ordinary draw task with
 * `revealed` pre-filled and see === keep, so it has exactly one answer and
 * still goes through the draw funnel (`afterDrawKeep`). A deck that runs out
 * reshuffles its own discard as everywhere (`takeDeckTop`); a crop with
 * nothing left draws what there is.
 */
export function drawFromCropDeck(fx: Fx, pid: Seat, src: CardId, suit: Suit, n: number): void {
  const taken: CardId[] = [];
  for (let i = 0; i < n; i++) {
    const card = fx.takeDeckTop(suit);
    if (card === null) break;
    taken.push(card);
  }
  if (taken.length === 0) return;
  fx.pushTask({
    t: 'draw',
    pid,
    src,
    see: taken.length,
    keep: taken.length,
    revealed: taken,
  });
}

/**
 * A GROW paid with a hand card of ANY crop, onto any of your buildings bar
 * `exclude` (A6 The Garden Hive, O13 The Seed Bank). A REAL grow through
 * `doGrow` - a card paid onto the stack, the ability, the fire-once cap - with
 * `anyCrop` waiving the activation cost's crop. Written once, here, for both
 * cards.
 *
 * ⛔ The coin filter that stood here went with the Village Store coin
 * (16/09/2026): there is no coin-paid Grow left to keep out.
 */
export function growAnyAnswers(
  data: GameData,
  state: GameState,
  seat: Seat,
  exclude: readonly CardId[],
): TaskAnswer[] {
  return growOptions(data, state, seat, { anyCrop: true, exclude: [...exclude] }).map(
    (o) =>
      ({
        kind: 'card',
        // R15: `payment` is null and `meeples` carries the payment when a
        // meeple paid; R17 adds where it lands. All of it rides on the answer,
        // because an answer that drops any of it is an answer that cannot pay.
        payload: {
          building: o.building,
          payment: o.payment,
          ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
          ...(o.placements === undefined ? {} : { placements: o.placements }),
          ...(o.paymentToll === undefined ? {} : { paymentToll: o.paymentToll }),
        },
      }) as TaskAnswer,
  );
}

/** Resolve one `growAnyAnswers` answer: the grow itself. Returns the building grown. */
export function resolveGrowAny(fx: Fx, seat: Seat, payload: Record<string, unknown>): CardId {
  const building = payload.building as CardId;
  doGrow(
    fx,
    seat,
    building,
    payload.payment as CardId | null,
    { anyCrop: true },
    (payload.meeples as Suit[] | undefined) ?? [],
    {
      ...(payload.placements === undefined
        ? {}
        : { placements: payload.placements as Partial<Record<Suit, number>>[] }),
      ...(payload.paymentToll === undefined
        ? {}
        : { paymentToll: payload.paymentToll as Partial<Record<Suit, number>> }),
    },
  );
  return building;
}
