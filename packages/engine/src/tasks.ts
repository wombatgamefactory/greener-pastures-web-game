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
  buildSubstitutePower,
  deliverAnswers,
  doBuild,
  doDeliver,
  doMoveBalloon,
  harvestOptions,
  harvestSurchargeOf,
  subsets,
  workerActionLegal,
} from './actions.js';
import type { BuildMods } from './actions.js';
import type { Fx } from './fx.js';
import { fireHook } from './fx.js';
import { canTakeCard, drawableSuits, fullBuildings, player, workerState } from './query.js';
import type { BuildingState, GameState, Task, TaskAnswer } from './state.js';
import { workWorker } from './workers.js';
import { handlerFor } from './handlers/registry.js';

/**
 * A build task's modifiers, with the actor's own Farmstead substitution folded
 * in. One place decides it, so a card that grants a Build never has to remember
 * whose Build it is, and the enumerator and the resolver cannot disagree.
 */
function buildModsFor(state: GameState, task: Extract<Task, { t: 'build' }>): BuildMods {
  const mods: BuildMods = { ...(task.mods ?? {}) };
  if (buildSubstitutePower(state, task.pid)) mods.substitute = true;
  return mods;
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
      // A harvest pays the target's printed surcharge (W8): unaffordable
      // targets are never offered, matching the action gate.
      if (task.then === 'harvest') {
        pool = pool.filter((b) => harvestSurchargeOf(data, b.card) <= p.coins);
      }
      return pool.map((b) => ({ kind: 'building', card: b.card }));
    }

    case 'sow': {
      const hand = player(state, task.pid).hand;
      let targets = player(state, task.pid).tableau.filter((b) => canTakeCard(data, b));
      if (task.targets) targets = targets.filter((b) => task.targets?.includes(b.card));
      const out = hand.flatMap((card) =>
        targets.map((b) => ({ kind: 'sow', card, onto: b.card }) as TaskAnswer),
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
            ...(o.barn ? { barn: o.barn } : {}),
            ...(o.coinWild ? { coinWild: o.coinWild } : {}),
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
      const suits = drawableSuits(data, state);
      let targets = player(state, task.pid).tableau.filter((b) => canTakeCard(data, b));
      if (task.targets) targets = targets.filter((b) => task.targets?.includes(b.card));
      return suits.flatMap((suit) =>
        targets.map((b) => ({ kind: 'deckSow', suit, onto: b.card }) as TaskAnswer),
      );
    }

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
      // "If you do, gain £2" (D9): minted only when the work actually happened.
      if ((task.actorCoins ?? 0) > 0) {
        fx.gainCoins(task.pid, task.actorCoins as number, `rider:${task.src}`);
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
      fx.discard(rest);
      // The reference's onDraw moment (keepFromReveal): fires for every
      // see/keep draw - base action, Draw Worker, card abilities - and never
      // for autoDraw. O17 The Fruit Basket is its consumer.
      if (answer.cards.length > 0) {
        fireHook(fx, 'afterDrawKeep', { seat: task.pid, cards: answer.cards });
      }
      return true;
    }

    case 'chooseBuilding': {
      if (answer.kind !== 'building') throw new Error('chooseBuilding expects a building answer');
      const fee = harvestSurchargeOf(fx.data, answer.card);
      if (fee > 0) fx.payCoins(task.pid, fee, `surcharge:${answer.card}`);
      fx.harvest(task.pid, answer.card);
      return true;
    }

    case 'sow': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind !== 'sow') throw new Error('sow expects a sow answer');
      fx.placeOnBuilding(task.pid, { seat: task.pid, card: answer.onto }, answer.card);
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
          ...(answer.barn ? { barn: answer.barn } : {}),
          ...(answer.coinWild ? { coinWild: answer.coinWild } : {}),
        },
        buildModsFor(fx.state, task),
        task.src,
      );
      return true;
    }

    case 'deliver': {
      if (answer.kind === 'skip' && task.optional === true) return true;
      if (answer.kind === 'deliver') {
        doDeliver(fx, task.pid, answer.tile, answer.spend);
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
      fx.deckTopToBuilding(task.pid, answer.suit, answer.onto);
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
      fx.discard(answer.cards);
      return true;
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
