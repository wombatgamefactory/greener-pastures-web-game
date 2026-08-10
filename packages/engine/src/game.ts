/**
 * The public surface: newGame (setup.ts) / legalMoves / apply. UI renders
 * legal moves, bots choose among them, the sim samples them; apply re-validates
 * everything (defence in depth) and the sim asserts the two agree.
 */

import type { GameData } from '@gp/data';

import {
  balloonMoveOptions,
  buildOptions,
  buyOptions,
  doBuy,
  deliverOptions,
  doBuild,
  doDeliver,
  doDraw,
  doMarket,
  doMoveBalloon,
  doHarvestAction,
  doUpgrade,
  doVisit,
  doWorkOwn,
  growOptions,
  marketOptions,
  harvestAgainPower,
  harvestOptions,
  hasMainOption,
  upgradeOptions,
  visitOptions,
  workOwnOptions,
} from './actions.js';
import { Fx } from './fx.js';
import { handlerFor } from './handlers/registry.js';
import { drawableSuits } from './query.js';
import type { Applied } from './runtime.js';
import { cloneState, doGrow, sameShape, standingMoves } from './runtime.js';
import type { GameState, Move, Resume, Seat, Task } from './state.js';
import { drainTasks, popTask, resolveTask, taskAnswers } from './tasks.js';
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
    for (const card of upgradeOptions(data, state, seat))
      moves.push({ type: 'upgrade', seat, card });
    for (const o of growOptions(data, state, seat)) {
      moves.push({ type: 'grow', seat, building: o.building, payment: o.payment });
    }
    for (const building of harvestOptions(data, state, seat)) {
      moves.push({ type: 'harvest', seat, building });
    }
    for (const o of deliverOptions(data, state, seat)) {
      moves.push({
        type: 'deliver',
        seat,
        tile: o.tile,
        spend: o.spend,
        ...(o.head ? { head: o.head } : {}),
      });
    }
    // The Deliver action's freight branch (DL-12): balloon moves.
    for (const o of balloonMoveOptions(data, state, seat)) {
      moves.push({ type: 'moveBalloon', seat, balloon: o.balloon, spend: o.spend });
    }
    // A Tier 3 ACTION card is a main action too, so it has to suppress `pass`
    // exactly as the five printed actions do - otherwise a seat whose only
    // action is The Bakery is offered "no action is legal" beside it.
    if (moves.length === 0 && actionCardMoves(data, state, seat).length === 0) {
      moves.push({ type: 'pass', seat });
    }
  } else if (turn.again === 'harvest') {
    // The upgraded Wheat Farmstead's optional second harvest, declinable via
    // endTurn (or by taking a bonus-slot move first - the gate stays open). The
    // only ActionAgain left: the Dairy "you may BUILD again" is gone.
    for (const building of harvestOptions(data, state, seat)) {
      moves.push({ type: 'harvest', seat, building });
    }
  }

  // The free actions, offered whether or not the main action is spent.
  for (const suit of buyOptions(data, state, seat)) moves.push({ type: 'buy', seat, suit });
  moves.push(...visitOptions(data, state, seat));
  // The bonus slot's third option (ticket 56): buy at market.
  for (const suit of marketOptions(data, state, seat)) moves.push({ type: 'market', seat, suit });
  for (const workerId of workOwnOptions(data, state, seat)) {
    moves.push({ type: 'workOwnWorker', seat, workerId });
  }
  moves.push(...standingMoves(data, state, seat));
  if (turn.actionSpent) moves.push({ type: 'endTurn', seat });

  return moves;
}

/**
 * The standing moves that ARE main actions - the Wheat Tier 3 ACTION cards,
 * which declare `actionMoves` on their handler.
 *
 * Only `pass` needs the distinction, and it needs it in both directions: a
 * Helping Hand repeat must not suppress `pass` (it is a bonus-slot tail, not an
 * action), and an ACTION card must. `hasMainOption` cannot answer this because
 * actions.ts may not import the handler registry.
 */
function actionCardMoves(data: GameData, state: GameState, seat: Seat) {
  return standingMoves(data, state, seat).filter(
    (m) => handlerFor(m.card)?.actionMoves === true && !state.turn.actionSpent,
  );
}

const MAIN_ACTIONS = new Set<Move['type']>([
  'draw',
  'build',
  'upgrade',
  'grow',
  'harvest',
  'deliver',
  'moveBalloon',
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
    // By identity, not position: a resolver may have prepended its own tasks.
    if (done) popTask(draft, head);
    drainTasks(data, draft);
    settleTurn(data, draft, fx);
    return { state: draft, events: fx.events, audit: fx.audit };
  }

  if (draft.tasks.length > 0) throw new Error('A pending task must be answered first');
  if (move.seat !== draft.turnPlayer) throw new Error(`It is seat ${draft.turnPlayer}'s turn`);
  const fx = new Fx(data, draft, move.seat);
  const turn = draft.turn;

  const againRepeat = turn.actionSpent && move.type === 'harvest' && turn.again === 'harvest';
  if (MAIN_ACTIONS.has(move.type)) {
    if (!turn.actionSpent) {
      turn.actionSpent = true;
    } else if (againRepeat) {
      turn.again = null; // the one repeat, consumed
    } else {
      throw new Error('Main action already spent this turn');
    }
  }

  switch (move.type) {
    case 'draw':
      doDraw(fx, move.seat);
      break;
    case 'buy':
      doBuy(fx, move.seat, move.suit);
      break;
    case 'market':
      doMarket(fx, move.seat, move.suit);
      break;
    case 'build':
      // The plain printed rules: no mods. The Build ACTION carries no
      // substitution since 2026-08-10 - that is the Builder's Yard's to grant.
      doBuild(fx, move.seat, { card: move.card, payment: move.payment });
      break;
    case 'upgrade':
      doUpgrade(fx, move.seat, move.card);
      break;
    case 'grow':
      doGrow(fx, move.seat, move.building, move.payment);
      break;
    case 'harvest':
      doHarvestAction(fx, move.seat, move.building);
      // "Harvest is 2 buildings" (upgraded Wheat Farmstead): arm one optional
      // repeat off the MAIN action only - a Worker's harvest never repeats,
      // following the reference's afterMainAction gate.
      if (!againRepeat && harvestAgainPower(data, draft, move.seat)) {
        turn.again = 'harvest';
      }
      break;
    case 'deliver':
      doDeliver(fx, move.seat, move.tile, move.spend, undefined, 1, move.head);
      break;
    case 'moveBalloon':
      doMoveBalloon(fx, move.seat, move.balloon, move.spend);
      break;
    case 'pass':
      if (hasMainOption(data, state, move.seat) || actionCardMoves(data, state, move.seat).length) {
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
      turn.again = null;
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
