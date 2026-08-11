/**
 * The task library: for every generic task type, an enumerator of legal
 * answers and a resolver that applies one. This is the primitive vocabulary
 * seen from the other side - a handler pushes tasks, the engine asks the
 * player (or a bot) to answer them, and the resolvers below do the work.
 *
 * The enumerators are what let legalMoves stay the single source of legality:
 * a handler declares its targeting as task DATA ("a full building of mine",
 * "a rival's Worker") and never enumerates anything itself.
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
  freeHandSpace,
  harvestOptions,
  harvestSurchargeOf,
  subsets,
  workerActionLegal,
} from './actions.js';
import type { BuildMods } from './actions.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import {
  canTakeCard,
  drawGiftPower,
  drawableSuits,
  fullBuildings,
  player,
  workerState,
} from './query.js';
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
import { workWorker } from './workers.js';
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

/** O17 The Fruit Basket's printed price for taking a discard into the barn. */
const DIVERT_COST = 1;

/** The seat's built card that buys discards into the barn (O17), or null. */
function discardDiverterOf(state: GameState, seat: Seat): CardId | null {
  return player(state, seat).tableau.find((b) => handlerFor(b.card)?.divertsDiscard)?.card ?? null;
}

/**
 * THE ONE FUNNEL every discard of a player's OWN cards goes through, and the
 * hinge of the Orchard rebuild. Both new powers act on the same moment - the
 * card a see/keep draw throws away - so there is one seam and not two.
 *
 * With neither permanent in play (the overwhelming majority of discards) this
 * is `fx.discard` with an extra branch and nothing queues. With one, a `divert`
 * task takes the cards into limbo and offers a destination for each.
 *
 * Deliberately NOT wired to `spendFromBarn`: paying the island is a SPEND, not
 * a discard, and letting the Basket buy a just-spent delivery card back into the
 * barn would turn the barn from a dead end into a loop.
 */
export function discardOrDivert(
  fx: Fx,
  pid: Seat,
  cards: readonly CardId[],
  fromDraw: boolean,
): void {
  if (cards.length === 0) return;
  const gift = fromDraw && drawGiftPower(fx.data, fx.state, pid) !== null;
  const basket = discardDiverterOf(fx.state, pid) !== null;
  if (!gift && !basket) {
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
 */
function divertAnswers(
  data: GameData,
  state: GameState,
  task: Extract<Task, { t: 'divert' }>,
): TaskAnswer[] {
  const card = task.cards[0];
  if (card === undefined) return [];
  const out: TaskAnswer[] = [];
  if (task.fromDraw && drawGiftPower(data, state, task.pid) !== null) {
    for (let seat = 0; seat < state.players.length; seat++) {
      if (seat === task.pid) continue;
      if (freeHandSpace(data, state, seat) < 1) continue;
      out.push({ kind: 'card', payload: { card, to: seat } });
    }
  }
  if (discardDiverterOf(state, task.pid) !== null && player(state, task.pid).coins >= DIVERT_COST) {
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
    case 'chooseWorker': {
      const out: TaskAnswer[] = state.fair
        .filter((w) => {
          if (w.owner === null) return false;
          if (task.owned === 'rival' && w.owner === task.pid) return false;
          if (task.owned === 'own' && w.owner !== task.pid) return false;
          return workerActionLegal(data, state, task.pid, w.id);
        })
        .map((w) => ({ kind: 'worker', workerId: w.id }));
      if (task.optional === true && out.length > 0) out.push({ kind: 'skip' });
      return out;
    }

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
          ? harvestOptions(data, state, task.pid).map(
              (id) => p.tableau.find((b) => b.card === id) as BuildingState,
            )
          : task.filter === 'full'
            ? fullBuildings(data, state, task.pid)
            : task.filter === 'loaded'
              ? p.tableau.filter((b) => b.stack.length >= 1)
              : p.tableau.filter((b) => canTakeCard(data, b));
      if (task.exclude !== undefined) pool = pool.filter((b) => b.card !== task.exclude);
      if (task.targets) pool = pool.filter((b) => task.targets?.includes(b.card));
      // A harvest pays the target's printed surcharge (W8): unaffordable
      // targets are never offered, matching the action gate.
      if (task.then === 'harvest') {
        pool = pool.filter((b) => harvestSurchargeOf(data, b.card) <= p.coins);
      }
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
    case 'chooseWorker': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'worker') throw new Error('chooseWorker expects a worker answer');
      const owner = workerState(fx.state, answer.workerId).owner;
      workWorker(fx, task.pid, answer.workerId, { progress: task.progress });
      if (task.ownerCoins > 0 && owner !== null) {
        fx.gainCoins(owner, task.ownerCoins, `rider:${task.src}`);
      }
      return true;
    }

    case 'draw': {
      if (answer.kind === 'deck') {
        const card = fx.takeDeckTop(answer.suit);
        if (card !== null) task.revealed.push(card);
        return false;
      }
      if (answer.kind !== 'keep') throw new Error('draw expects a deck or keep answer');
      const rest = task.revealed.filter((c) => !answer.cards.includes(c));
      fx.cardsToHand(task.pid, answer.cards);
      // The rebuilt Orchard Farmstead's gift and O17's £1 both act HERE, on the
      // card a see/keep draw throws away, so the discard goes through the seam.
      discardOrDivert(fx, task.pid, rest, true);
      // The reference's onDraw moment (keepFromReveal): fires for every
      // see/keep draw - base action, Draw Worker, card abilities - and never
      // for autoDraw. O17 The Fruit Basket is its consumer.
      if (answer.cards.length > 0) {
        fireHook(fx, 'afterDrawKeep', { seat: task.pid, cards: answer.cards });
      }
      return true;
    }

    case 'chooseBuilding': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'building') throw new Error('chooseBuilding expects a building answer');
      const fee = harvestSurchargeOf(fx.data, answer.card);
      if (fee > 0) fx.payCoins(task.pid, fee, `surcharge:${answer.card}`);
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
        },
        buildModsFor(fx.state, task),
        task.src,
      );
      return true;
    }

    case 'deliver': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind === 'deliver') {
        doDeliver(fx, task.pid, answer.tile, answer.spend, undefined, 1, answer.head);
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
      // O17 reaches the end-of-turn overflow too ("whenever you discard a
      // card"); the Farmstead's gift does not, because this is not a draw.
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
      if (answer.payload.barn === true) {
        fx.payCoins(task.pid, DIVERT_COST, 'divert');
        fx.stashCard(task.pid, card);
      } else {
        const to = answer.payload.to as Seat;
        fx.passCard(task.pid, to, card);
        const coins = drawGiftPower(fx.data, fx.state, task.pid) ?? 0;
        if (coins > 0) fx.gainCoins(task.pid, coins, 'divert');
      }
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
