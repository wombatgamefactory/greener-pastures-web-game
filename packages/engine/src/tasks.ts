/**
 * The task library: for every generic task type, an enumerator of legal
 * answers and a resolver that applies one. This is the primitive vocabulary
 * seen from the other side - a handler pushes tasks, the engine asks the
 * player (or a bot) to answer them, and the resolvers below do the work.
 *
 * The enumerators are what let legalMoves stay the single source of legality:
 * a handler declares its targeting as task DATA ("a full building of mine")
 * and never enumerates anything itself.
 *
 * The drain loop auto-skips a task with nothing legal to do (no drawable deck,
 * no qualifying building), looping over consecutive skips, so a dead picker is
 * never shown - the design the reference implementation proved against all
 * 105 cards.
 */

import type { GameData } from '@gp/data';

import {
  buildOptions,
  deliverAnswers,
  doBuild,
  doDeliver,
  doMoveBalloon,
  harvestOptions,
  subsets,
} from './actions.js';
import type { BuildMods } from './actions.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import { canTakeCard, drawableSuits, fullBuildings, player } from './query.js';
import { activateOnly } from './runtime.js';
import type {
  BuildingRef,
  BuildingState,
  CardId,
  GameState,
  Seat,
  Task,
  TaskAnswer,
} from './state.js';
import { handlerFor } from './handlers/registry.js';

/**
 * A build task's modifiers: exactly what granted the build, and nothing folded
 * in on top.
 *
 * It used to OR in the seat's own Dairy Farmstead substitution, so that no card
 * granting a Build had to remember whose Build it was. That power is gone
 * (2026-08-10) - a Dairy seat matches crops like everybody else now, and
 * substitution survives only as a mod the Builder's Yard hands to whoever
 * visits it. The function stays because the enumerator and the resolver must go
 * on reading one expression rather than two.
 */
function buildModsFor(_state: GameState, task: Extract<Task, { t: 'build' }>): BuildMods {
  return { ...(task.mods ?? {}) };
}

// --- the discard divert seam ------------------------------------------------

/** The seat's built card that takes a discard into the barn instead (O17), or null. */
function discardDiverterOf(state: GameState, seat: Seat): CardId | null {
  return player(state, seat).tableau.find((b) => handlerFor(b.card)?.divertsDiscard)?.card ?? null;
}

/**
 * THE ONE FUNNEL every discard of a player's OWN cards goes through.
 *
 * With no diverter in play (the overwhelming majority of discards) this is
 * `fx.discard` with an extra branch and nothing queues. With one, a `divert`
 * task takes the cards into LIMBO - out of the reveal or the hand, not yet in
 * any pile - and offers a destination for each.
 *
 * Deliberately NOT wired to `spendFromBarn`: paying the island is a SPEND, not a
 * discard, and letting a card buy a just-spent delivery back into the barn would
 * turn the barn from a dead end into a loop.
 *
 * ⛔ ITS OTHER BRANCH IS GONE (v31), and it was the hinge of the Orchard rebuild:
 * the Farmstead's "when one of your draws discards a card, GIVE it to a
 * neighbour instead" (`drawGiftPower`), which shared this seam with O17's barn
 * diversion because both acted on the same moment and were mutually exclusive
 * per card. All five Farmsteads print an end-game scorer now.
 *
 * ⚠️ `fromDraw` SURVIVES with no reader, and that is deliberate. It was the
 * discriminator between the two branches, and the reason it existed is the
 * lesson: the gift was offered on a DRAW's discard and never on the end-of-turn
 * hand-limit discard, which closed a give-four-cards-for-four-coins exploit with
 * no special case at all. Anything that ever hangs off this seam again needs the
 * same distinction available - and the end-of-turn discard it distinguished
 * against is live again since 02/09/2026, so the exploit it closed is a live
 * shape rather than a historical one.
 */
export function discardOrDivert(
  fx: Fx,
  pid: Seat,
  cards: readonly CardId[],
  fromDraw: boolean,
): void {
  if (cards.length === 0) return;
  if (discardDiverterOf(fx.state, pid) === null) {
    fx.discard([...cards]);
    return;
  }
  fx.pushTask({ t: 'divert', pid, src: null, cards: [...cards], fromDraw });
}

/**
 * Destinations for the head card of a divert task.
 *
 * `skip` is offered whenever a card is still held, which is what makes the task
 * safe: the drain loop drops a task with NO legal answer, and a dropped divert
 * would take its limbo cards out of the game. Skip discards everything left.
 *
 * The barn diversion is FREE since v31 - it cost GBP 1 and there are no coins -
 * so the only thing gating it is having the card in play. ⚠️ That makes it
 * strictly better than discarding, every time, which is a real change in the
 * card's shape: it used to be a wallet-capped choice and is now an always-take.
 * O17's v31 text moves the trigger to a build payment; whether it also needs a
 * price ("discard a card from your hand" is the only currency left) is flagged
 * in the v31 plan §3.3 and is a card decision, not an engine one.
 */
function divertAnswers(
  _data: GameData,
  state: GameState,
  task: Extract<Task, { t: 'divert' }>,
): TaskAnswer[] {
  const card = task.cards[0];
  if (card === undefined) return [];
  const out: TaskAnswer[] = [];
  if (discardDiverterOf(state, task.pid) !== null) {
    out.push({ kind: 'card', payload: { card, barn: true } });
  }
  out.push({ kind: 'skip' });
  return out;
}

/**
 * THE ONE PLACE a sow's target list is resolved, for both sow tasks.
 *
 * An absent list means the actor's own tableau, which is what every caller
 * before the Apiary rebuild meant and why none of them had to change. A list
 * that IS present may name a neighbour's building (A4, A14). Either way the
 * live gate is `canTakeCard`, applied here and not at push time, so a building
 * that clogs between the push and the answer drops out by itself - and a
 * neighbour's clogged Notice Board or Service simply is not offered.
 */
function sowTargets(
  data: GameData,
  state: GameState,
  task: { pid: Seat; targets?: BuildingRef[] },
): BuildingRef[] {
  const refs: BuildingRef[] =
    task.targets ?? player(state, task.pid).tableau.map((b) => ({ seat: task.pid, card: b.card }));
  return refs.filter((ref) => {
    const p = state.players[ref.seat];
    const b = p?.tableau.find((x) => x.card === ref.card);
    return b !== undefined && canTakeCard(data, b);
  });
}

/** A sow answer's target seat: absent means the actor's own building. */
function ontoRef(pid: Seat, answer: { onto: CardId; ontoSeat?: Seat }): BuildingRef {
  return { seat: answer.ontoSeat ?? pid, card: answer.onto };
}

/** A sow answer, with `ontoSeat` present only when the target is a neighbour's. */
function sowAnswer(pid: Seat, ref: BuildingRef, rest: Record<string, unknown>): TaskAnswer {
  return {
    ...rest,
    onto: ref.card,
    ...(ref.seat === pid ? {} : { ontoSeat: ref.seat }),
  } as TaskAnswer;
}

/**
 * The buildings an `activate` task may still fire (the Apiary rebuild).
 *
 * The snapshot in `task.targets` was taken when the card activated; this
 * re-checks it against the live tableau AND against `turn.firedThisTurn`, which
 * is the whole recursion guard: a card that has already fired this turn is not
 * offered again, so A12 -> A5 -> A12 cannot be entered rather than being cut off
 * part way through.
 */
function activateAnswers(state: GameState, task: Extract<Task, { t: 'activate' }>): TaskAnswer[] {
  const tableau = player(state, task.pid).tableau;
  return task.targets
    .filter((card) => tableau.some((b) => b.card === card))
    .filter((card) => !state.turn.firedThisTurn.includes(card))
    .map((card) => ({ kind: 'activate', card }) as TaskAnswer);
}

/** Legal answers to a task. Empty = the task has nothing to do and is skipped. */
export function taskAnswers(data: GameData, state: GameState, task: Task): TaskAnswer[] {
  switch (task.t) {
    case 'draw': {
      if (task.revealed.length < task.see) {
        const suits = drawableSuits(data, state);
        if (suits.length > 0) return suits.map((suit) => ({ kind: 'deck', suit }));
        // Decks ran dry mid-reveal: fall through to keeping what was revealed.
      }
      const keep = Math.min(task.keep, task.revealed.length);
      if (task.revealed.length === 0) return [];
      return subsets(task.revealed, keep).map((cards) => ({ kind: 'keep', cards }));
    }

    case 'chooseBuilding': {
      const p = player(state, task.pid);
      let pool =
        task.filter === 'harvestable'
          ? harvestOptions(data, state, task.pid, task.relaxedMin).map(
              (id) => p.tableau.find((b) => b.card === id) as BuildingState,
            )
          : task.filter === 'full'
            ? fullBuildings(data, state, task.pid)
            : task.filter === 'loaded'
              ? p.tableau.filter((b) => b.stack.length >= 1)
              : p.tableau.filter((b) => canTakeCard(data, b));
      if (task.exclude !== undefined) pool = pool.filter((b) => b.card !== task.exclude);
      if (task.targets) pool = pool.filter((b) => task.targets?.includes(b.card));
      // A harvest used to also drop targets whose printed GBP 1 surcharge (W8)
      // the seat could not pay, matching the action gate. No card prints a
      // surcharge in v31 and there is nothing to pay one with.
      const out: TaskAnswer[] = pool.map((b) => ({ kind: 'building', card: b.card }));
      if (task.optional === true && out.length > 0) out.push({ kind: 'skip' });
      return out;
    }

    case 'sow': {
      const hand = player(state, task.pid).hand;
      const targets = sowTargets(data, state, task);
      const out = hand.flatMap((card) =>
        targets.map((ref) => sowAnswer(task.pid, ref, { kind: 'sow', card })),
      );
      if (task.optional === true && out.length > 0) out.push({ kind: 'skip' });
      return out;
    }

    case 'build': {
      const out = buildOptions(data, state, task.pid, undefined, buildModsFor(state, task)).map(
        (o) =>
          ({
            kind: 'build',
            card: o.card,
            payment: o.payment,
            ...(o.stacks ? { stacks: o.stacks } : {}),
            ...(o.meeples === undefined ? {} : { meeples: o.meeples }),
            ...(o.wildPairs === undefined ? {} : { wildPairs: o.wildPairs }),
            ...(o.placements === undefined ? {} : { placements: o.placements }),
            ...(o.paymentToll === undefined ? {} : { paymentToll: o.paymentToll }),
          }) as TaskAnswer,
      );
      if (task.optional === true && out.length > 0) out.push({ kind: 'skip' });
      return out;
    }

    case 'deliver': {
      // Island deliveries AND balloon moves - one Deliver action (DL-12).
      const out = deliverAnswers(data, state, task.pid);
      if (task.optional === true && out.length > 0) out.push({ kind: 'skip' });
      return out;
    }

    case 'sowFromDeck': {
      // A fixed deck (A13's "the top card of EACH deck") still has to be
      // drawable: a suit whose deck and discard are both empty offers nothing
      // and the task is dropped, which is the printed "whiffs" reading.
      const suits = drawableSuits(data, state).filter(
        (s) => task.suit === undefined || s === task.suit,
      );
      const targets = sowTargets(data, state, task);
      return suits.flatMap((suit) =>
        targets.map((ref) => sowAnswer(task.pid, ref, { kind: 'deckSow', suit })),
      );
    }

    case 'activate':
      return activateAnswers(state, task);

    case 'handToBarn': {
      const out = player(state, task.pid).hand.map(
        (card) => ({ kind: 'handToBarn', card }) as TaskAnswer,
      );
      if (task.optional === true && out.length > 0) out.push({ kind: 'skip' });
      return out;
    }

    case 'discard': {
      // ⚠️ C(hand, excess), and the widest enumeration in the game after a build
      // payment. Bounded only because the hand it reads was itself bounded by
      // the previous turn's pass through this same task - see `subsets`.
      const hand = player(state, task.pid).hand;
      const excess = hand.length - task.downTo;
      if (excess <= 0) return [];
      return subsets(hand, excess).map((cards) => ({ kind: 'discard', cards }) as TaskAnswer);
    }

    case 'divert':
      return divertAnswers(data, state, task);

    case 'card': {
      const custom = handlerFor(task.src)?.tasks?.[task.kind];
      if (!custom) throw new Error(`No task resolver '${task.kind}' on handler ${task.src}`);
      return custom.answers(data, state, task);
    }

    default:
      return task satisfies never;
  }
}

/**
 * Apply an answer to the head task. Returns true when the task is finished
 * (pop it); false when it stays for another round (the re-entrant draw).
 */
export function resolveTask(fx: Fx, task: Task, answer: TaskAnswer): boolean {
  switch (task.t) {
    case 'draw': {
      if (answer.kind === 'deck') {
        const card = fx.takeDeckTop(answer.suit);
        if (card !== null) task.revealed.push(card);
        return false;
      }
      if (answer.kind !== 'keep') throw new Error('draw expects a deck or keep answer');
      const rest = task.revealed.filter((c) => !answer.cards.includes(c));
      fx.cardsToHand(task.pid, answer.cards);
      // The card a see/keep draw throws away goes through the divert seam. Since
      // v31 the base Draw keeps both cards (see 2, keep 2) and so does every
      // door, so `rest` is empty for the printed actions and only a `see > keep`
      // card ability reaches this at all.
      discardOrDivert(fx, task.pid, rest, true);
      // The reference's onDraw moment (keepFromReveal): fires for every
      // see/keep draw - base action, bonus draw, a door's draw, card abilities -
      // and never for autoDraw.
      if (answer.cards.length > 0) {
        fireHook(fx, 'afterDrawKeep', { seat: task.pid, cards: answer.cards });
      }
      return true;
    }

    case 'chooseBuilding': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'building') throw new Error('chooseBuilding expects a building answer');
      fx.harvest(task.pid, answer.card);
      return true;
    }

    case 'sow': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'sow') throw new Error('sow expects a sow answer');
      fx.placeOnBuilding(task.pid, ontoRef(task.pid, answer), answer.card);
      task.remaining -= 1;
      return task.remaining <= 0;
    }

    case 'build': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'build') throw new Error('build expects a build answer');
      doBuild(
        fx,
        task.pid,
        {
          card: answer.card,
          payment: answer.payment,
          ...(answer.stacks ? { stacks: answer.stacks } : {}),
          ...(answer.meeples === undefined ? {} : { meeples: answer.meeples }),
          ...(answer.wildPairs === undefined ? {} : { wildPairs: answer.wildPairs }),
          ...(answer.placements === undefined ? {} : { placements: answer.placements }),
          ...(answer.paymentToll === undefined ? {} : { paymentToll: answer.paymentToll }),
        },
        buildModsFor(fx.state, task),
        task.src,
      );
      return true;
    }

    case 'deliver': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind === 'deliver') {
        doDeliver(fx, task.pid, answer.tile, answer.spend, undefined, 1, answer.meeples);
        return true;
      }
      if (answer.kind === 'balloon') {
        doMoveBalloon(fx, task.pid, answer.balloon, answer.spend);
        return true;
      }
      throw new Error('deliver expects a deliver or balloon answer');
    }

    case 'sowFromDeck': {
      if (answer.kind !== 'deckSow') throw new Error('sowFromDeck expects a deckSow answer');
      fx.deckTopToBuilding(task.pid, answer.suit, ontoRef(task.pid, answer));
      task.remaining -= 1;
      return task.remaining <= 0;
    }

    case 'activate': {
      if (answer.kind !== 'activate') throw new Error('activate expects an activate answer');
      activateOnly(fx, task.pid, answer.card);
      task.remaining -= 1;
      return task.remaining <= 0;
    }

    case 'handToBarn': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'handToBarn') throw new Error('handToBarn expects a handToBarn answer');
      fx.handToBarn(task.pid, answer.card);
      task.remaining -= 1;
      return task.remaining <= 0;
    }

    case 'discard': {
      if (answer.kind !== 'discard') throw new Error('discard expects a discard answer');
      for (const card of answer.cards) fx.removeFromHand(task.pid, card);
      // The overflow goes through the divert seam like any other discard, so a
      // card that buys discards into a barn (O17's family) reaches the turn
      // boundary too. `fromDraw` is false: this is not a draw, and the
      // distinction is what used to keep a give-away power off this seam.
      discardOrDivert(fx, task.pid, answer.cards, false);
      return true;
    }

    case 'divert': {
      if (answer.kind === 'skip') {
        fx.discard([...task.cards]);
        task.cards = [];
        return true;
      }
      if (answer.kind !== 'card') throw new Error('divert expects a card or skip answer');
      const card = answer.payload.card as CardId;
      // The barn is the only destination left: the gift branch went with the
      // Orchard Farmstead (v31). `fx.passCard` survives as a primitive for the
      // cards that still hand a limbo card across the table.
      fx.stashCard(task.pid, card);
      task.cards = task.cards.filter((c) => c !== card);
      return task.cards.length === 0;
    }

    case 'card': {
      const custom = handlerFor(task.src)?.tasks?.[task.kind];
      if (!custom) throw new Error(`No task resolver '${task.kind}' on handler ${task.src}`);
      return custom.resolve(fx, task, answer);
    }

    default:
      return task satisfies never;
  }
}

/**
 * Remove a RESOLVED task by identity, not by position. A resolver may have
 * prepended tasks of its own (D13's two free builds must run before anything
 * queued behind the gate), so the task that just finished is no longer
 * guaranteed to be at index 0 - popping blindly would drop a fresh task and
 * leave the finished one to be answered twice.
 */
export function popTask(state: GameState, task: Task): void {
  const i = state.tasks.indexOf(task);
  if (i >= 0) state.tasks.splice(i, 1);
}

/** Drop dead tasks from the head until a live one (or none) faces the player. */
export function drainTasks(data: GameData, state: GameState): void {
  while (state.tasks.length > 0) {
    const head = state.tasks[0] as Task;
    if (taskAnswers(data, state, head).length > 0) return;
    state.tasks.shift();
  }
  state.resume = null;
}
