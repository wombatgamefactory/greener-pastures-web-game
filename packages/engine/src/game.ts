/**
 * The public surface: newGame (setup.ts) / legalMoves / apply. UI renders
 * legal moves, bots choose among them, the sim samples them; apply re-validates
 * everything (defence in depth) and the sim asserts the two agree.
 */

import type { GameData } from '@gp/data';

import {
  apiaryGrowBonus,
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
import type { GameState, Move, Resume, Task } from './state.js';
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
        ...(o.deckHead ? { deckHead: o.deckHead } : {}),
      });
    }
    // The Deliver action's freight branch (DL-12): balloon moves.
    for (const o of balloonMoveOptions(data, state, seat)) {
      moves.push({
        type: 'moveBalloon',
        seat,
        balloon: o.balloon,
        spend: o.spend,
        ...(o.head ? { head: o.head } : {}),
        ...(o.deckHead ? { deckHead: o.deckHead } : {}),
      });
    }
    // ⛔ This used to read "...and no Tier 3 ACTION card is live either": an
    // ACTION card was a main action too, so it had to suppress `pass` exactly as
    // the five printed actions do. The concept was retired on 19/08/2026 (all
    // fifteen are GROW buildings now), so `pass` is back to meaning what it
    // says: no main action of any kind is legal.
    if (moves.length === 0) moves.push({ type: 'pass', seat });
  } else if (turn.again === 'harvest') {
    // The upgraded Wheat Farmstead's optional second harvest. `endTurn` is now
    // the ONLY way to decline it: this used to say "or by taking a bonus-slot
    // move first - the gate stays open", and that second path died on
    // 19/08/2026 when the slot became start-of-turn only. After a harvest
    // `actionSpent` is true, so `bonusOpen` is false and the slot is shut. The
    // only ActionAgain left: the Dairy "you may BUILD again" is gone.
    for (const building of harvestOptions(data, state, seat)) {
      moves.push({ type: 'harvest', seat, building });
    }
  }

  // THE BONUS SLOT, and the free actions beside it.
  //
  // Every option below gates itself on `bonusOpen` (actions.ts), which since
  // 19/08/2026 means "unspent AND the main action not yet taken" - so this
  // block is offered at the START of the turn only, and empties the moment an
  // action is taken. Nothing here needs to test the window itself.
  for (const suit of buyOptions(data, state, seat)) moves.push({ type: 'buy', seat, suit });
  moves.push(...visitOptions(data, state, seat));
  for (const suit of marketOptions(data, state, seat)) moves.push({ type: 'market', seat, suit });
  for (const workerId of workOwnOptions(data, state, seat)) {
    moves.push({ type: 'workOwnWorker', seat, workerId });
  }
  // Option 4 (Dean, 19/08/2026): flip a starter for £2. It used to cost the
  // whole main action, which is why the 2026-07-14 table left every £2 sink
  // untouched.
  for (const card of upgradeOptions(data, state, seat)) {
    moves.push({ type: 'upgrade', seat, card });
  }
  moves.push(...standingMoves(data, state, seat));
  if (turn.actionSpent) moves.push({ type: 'endTurn', seat });

  return moves;
}

/**
 * The moves that SPEND the turn's one action.
 *
 * `upgrade` left this set on 19/08/2026 when the starter flip became the fourth
 * bonus-slot option; `doUpgrade` spends `bonusSpent` instead. It had to leave
 * `hasMainOption` at the same time, or a seat whose only remaining option was a
 * bonus would have had `pass` suppressed and no legal move at all.
 */
const MAIN_ACTIONS = new Set<Move['type']>([
  'draw',
  'build',
  'grow',
  'harvest',
  'deliver',
  'moveBalloon',
  'pass',
]);

/**
 * Which half of the turn a task should resume into. The bonus-slot moves resume
 * as 'worker'; everything else is the main action. `upgrade` joined the bonus
 * family on 19/08/2026, and follows the knob that moved it so the paired
 * control arm resumes the way it always did.
 */
function resumeFor(data: GameData, type: Move['type']): Resume {
  if (type === 'visit' || type === 'workOwnWorker') return 'worker';
  if (type === 'upgrade' && data.rules.turn.upgradeIsBonus) return 'worker';
  return 'main';
}

/**
 * Does this move spend the turn's one main action?
 *
 * `upgrade` is the one move whose answer is DATA, not shape: it is a bonus-slot
 * option under `rules.turn.upgradeIsBonus` (the rule since 19/08/2026, where
 * `doUpgrade` spends the slot instead) and a main action under the control arm.
 */
function spendsAction(data: GameData, type: Move['type']): boolean {
  if (type === 'upgrade') return !data.rules.turn.upgradeIsBonus;
  return MAIN_ACTIONS.has(type);
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
  if (spendsAction(data, move.type)) {
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
      // The Apiary Farmstead ("When you GROW, Draw 1", plus the upgraded face's
      // optional card into the barn) hangs off the GROW ACTION and nowhere
      // else, so A5, A6 and A12 do not each trigger it - or The Honey Hut
      // would draw three. Queued after the activation's own tasks.
      apiaryGrowBonus(fx, move.seat);
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
      doDeliver(fx, move.seat, move.tile, move.spend, undefined, 1, move.head, move.deckHead);
      break;
    case 'moveBalloon':
      doMoveBalloon(fx, move.seat, move.balloon, move.spend, move.head, move.deckHead);
      break;
    case 'pass':
      // A standing move never blocks `pass` any more. It used to, for the Tier 3
      // ACTION cards alone - a Helping Hand repeat is a bonus-slot tail and
      // never did - and that whole distinction died with the ACTION concept on
      // 19/08/2026.
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

  if (draft.tasks.length > 0 && draft.resume === null) draft.resume = resumeFor(data, move.type);
  drainTasks(data, draft);
  settleTurn(data, draft, fx);
  return { state: draft, events: fx.events, audit: fx.audit };
}
