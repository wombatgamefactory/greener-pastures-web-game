/**
 * The public surface: newGame (setup.ts) / legalMoves / apply. UI renders
 * legal moves, bots choose among them, the sim samples them; apply re-validates
 * everything (defence in depth) and the sim asserts the two agree.
 */

import type { GameData } from '@gp/data';

import {
  buildOptions,
  deliverOptions,
  doBuild,
  doDeliver,
  doDraw,
  doHarvestAction,
  doHire,
  doUpgrade,
  doVisit,
  doWorkOwn,
  growOptions,
  harvestOptions,
  hasMainOption,
  hireOptions,
  upgradeOptions,
  visitOptions,
  workOwnOptions,
} from './actions.js';
import { Fx } from './fx.js';
import { handlerFor } from './handlers/registry.js';
import { drawableSuits } from './query.js';
import type { Applied } from './runtime.js';
import { cloneState, doGrow, sameShape, standingMoves } from './runtime.js';
import type { GameState, Move, Resume, Task } from './state.js';
import { drainTasks, resolveTask, taskAnswers } from './tasks.js';
import { settleTurn } from './turnflow.js';

export { newGame } from './setup.js';
export type { NewGameOptions } from './setup.js';

export function isOver(state: GameState): boolean {
  return state.phase === 'ended';
}

/**
 * Every move the current actor may make. With a pending task, the head task's
 * owner answers it and nothing else is on offer; otherwise the turn player
 * sees whatever halves of the turn are unspent, any standing card moves, and
 * endTurn once the action is spent. `pass` appears only when no main action is
 * legal (it spends the action and keeps the bonus slot).
 */
export function legalMoves(data: GameData, state: GameState): Move[] {
  if (state.phase !== 'playing') return [];

  if (state.tasks.length > 0) {
    const head = state.tasks[0] as Task;
    return taskAnswers(data, state, head).map((answer) => ({
      type: 'task',
      seat: head.pid,
      answer,
    }));
  }

  const seat = state.turnPlayer;
  const turn = state.turn;
  const moves: Move[] = [];

  if (!turn.actionSpent) {
    if (drawableSuits(data, state).length > 0) moves.push({ type: 'draw', seat });
    for (const o of buildOptions(data, state, seat)) {
      moves.push({ type: 'build', seat, card: o.card, payment: o.payment });
    }
    for (const workerId of hireOptions(data, state, seat))
      moves.push({ type: 'hire', seat, workerId });
    for (const card of upgradeOptions(data, state, seat))
      moves.push({ type: 'upgrade', seat, card });
    for (const o of growOptions(data, state, seat)) {
      moves.push({ type: 'grow', seat, building: o.building, payment: o.payment });
    }
    for (const building of harvestOptions(data, state, seat)) {
      moves.push({ type: 'harvest', seat, building });
    }
    for (const o of deliverOptions(data, state, seat)) {
      moves.push({ type: 'deliver', seat, tile: o.tile, spend: o.spend });
    }
    if (moves.length === 0) moves.push({ type: 'pass', seat });
  }

  moves.push(...visitOptions(data, state, seat));
  for (const workerId of workOwnOptions(data, state, seat)) {
    moves.push({ type: 'workOwnWorker', seat, workerId });
  }
  moves.push(...standingMoves(data, state, seat));
  if (turn.actionSpent) moves.push({ type: 'endTurn', seat });

  return moves;
}

const MAIN_ACTIONS = new Set<Move['type']>([
  'draw',
  'build',
  'hire',
  'upgrade',
  'grow',
  'harvest',
  'deliver',
  'pass',
]);

function resumeFor(type: Move['type']): Resume {
  return type === 'visit' || type === 'workOwnWorker' ? 'worker' : 'main';
}

/** Apply one move. Throws on anything legalMoves would not offer. */
export function apply(data: GameData, state: GameState, move: Move): Applied {
  if (state.phase !== 'playing') throw new Error('The game is over');
  const draft = cloneState(state);

  if (move.type === 'task') {
    const head = draft.tasks[0];
    if (!head) throw new Error('No pending task');
    if (move.seat !== head.pid) throw new Error(`Task belongs to seat ${head.pid}`);
    const legal = taskAnswers(data, draft, head);
    if (!legal.some((a) => sameShape(a, move.answer))) {
      throw new Error(`Illegal answer to ${head.t}: ${JSON.stringify(move.answer)}`);
    }
    const fx = new Fx(data, draft, head.pid);
    const done = resolveTask(fx, head, move.answer);
    if (done) draft.tasks.shift();
    drainTasks(data, draft);
    settleTurn(data, draft, fx);
    return { state: draft, events: fx.events, audit: fx.audit };
  }

  if (draft.tasks.length > 0) throw new Error('A pending task must be answered first');
  if (move.seat !== draft.turnPlayer) throw new Error(`It is seat ${draft.turnPlayer}'s turn`);
  const fx = new Fx(data, draft, move.seat);
  const turn = draft.turn;

  if (MAIN_ACTIONS.has(move.type)) {
    if (turn.actionSpent) throw new Error('Main action already spent this turn');
    turn.actionSpent = true;
  }

  switch (move.type) {
    case 'draw':
      doDraw(fx, move.seat);
      break;
    case 'build':
      doBuild(fx, move.seat, move.card, move.payment);
      break;
    case 'hire':
      doHire(fx, move.seat, move.workerId);
      break;
    case 'upgrade':
      doUpgrade(fx, move.seat, move.card);
      break;
    case 'grow':
      doGrow(fx, move.seat, move.building, move.payment);
      break;
    case 'harvest':
      doHarvestAction(fx, move.seat, move.building);
      break;
    case 'deliver':
      doDeliver(fx, move.seat, move.tile, move.spend);
      break;
    case 'pass':
      if (hasMainOption(data, state, move.seat)) {
        throw new Error('Pass is legal only when no main action is');
      }
      break;
    case 'visit':
      doVisit(fx, move.seat, move.host, move.fee, move.payoff);
      break;
    case 'workOwnWorker':
      doWorkOwn(fx, move.seat, move.workerId);
      break;
    case 'endTurn':
      if (!turn.actionSpent) throw new Error('End turn requires the action spent (or passed)');
      turn.ending = true;
      turn.visit = null;
      break;
    case 'cardMove': {
      const offered = standingMoves(data, draft, move.seat);
      if (!offered.some((m) => sameShape(m, move))) {
        throw new Error(`Move not offered: ${move.card}/${move.kind}`);
      }
      const handler = handlerFor(move.card);
      if (!handler?.applyMove) throw new Error(`${move.card} has no applyMove`);
      handler.applyMove(fx, { seat: move.seat, card: move.card }, move);
      break;
    }
    default:
      move satisfies never;
  }

  if (draft.tasks.length > 0 && draft.resume === null) draft.resume = resumeFor(move.type);
  drainTasks(data, draft);
  settleTurn(data, draft, fx);
  return { state: draft, events: fx.events, audit: fx.audit };
}
