/**
 * The public surface: newGame (setup.ts) / legalMoves / apply. UI renders
 * legal moves, bots choose among them, the sim samples them; apply re-validates
 * everything (defence in depth) and the sim asserts the two agree.
 */

import type { GameData } from '@gp/data';

import {
  balloonMoveOptions,
  bonusDrawOpen,
  buildOptions,
  commonsOptions,
  commonsTakeOptions,
  deliverOptions,
  doBonusDraw,
  doBuild,
  doCommons,
  doCommonsTake,
  doDeliver,
  doDraw,
  doMoveBalloon,
  doHarvestAction,
  doCollect,
  doSpendMeeple,
  doVisit,
  growOptions,
  harvestOptions,
  hasMainOption,
  collectOptions,
  meepleOptions,
  visitOptions,
} from './actions.js';
import { Fx } from './fx.js';
import { handlerFor } from './handlers/registry.js';
import { drawableSuits } from './query.js';
import type { Applied } from './runtime.js';
import { cloneState, doGrow, shapeKey, standingMoves } from './runtime.js';
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
      moves.push(
        // ⭐ V6 (A150, 12/09/2026): the coin count rides on BOTH shapes, so a
        // coin-paid build with no meeples in it keeps the narrow one. Absent
        // when zero, which is what keeps a Store-off move list byte-identical.
        o.meeples === undefined
          ? {
              type: 'build',
              seat,
              card: o.card,
              payment: o.payment,
              ...(o.coins === undefined ? {} : { coins: o.coins }),
            }
          : {
              type: 'build',
              seat,
              card: o.card,
              payment: o.payment,
              meeples: o.meeples,
              ...(o.wildPairs === undefined ? {} : { wildPairs: o.wildPairs }),
              ...(o.coins === undefined ? {} : { coins: o.coins }),
            },
      );
    }
    // ⭐ `mainAction: true` IS THE ONE PLACE IT IS SET (builder default D-C1,
    // 10/09/2026), and it is what makes the coin-activated Farmstead a MAIN
    // action and only a main action: the Apiary board's bought Grow pushes a
    // `grow` task whose answers come from this same enumerator without it.
    for (const o of growOptions(data, state, seat, { mainAction: true })) {
      moves.push(
        o.coin === true
          ? // K10: one coin, nothing placed, the Farmstead's suit power fires.
            { type: 'grow', seat, building: o.building, payment: null, coin: true }
          : o.coinGrow === true
            ? // ⭐ V8/V9 (A150, 12/09/2026): one VILLAGE STORE coin, nothing
              // placed, the building's own ability fires, and under
              // `coinGrowOnFullBuilding` a clogged building is a legal target.
              { type: 'grow', seat, building: o.building, payment: null, coinGrow: true }
            : o.meeples === undefined
            ? { type: 'grow', seat, building: o.building, payment: o.payment }
            : {
                type: 'grow',
                seat,
                building: o.building,
                payment: null,
                meeples: o.meeples,
                ...(o.placements === undefined ? {} : { placements: o.placements }),
                ...(o.paymentToll === undefined ? {} : { paymentToll: o.paymentToll }),
              },
      );
    }
    for (const building of harvestOptions(data, state, seat)) {
      moves.push({ type: 'harvest', seat, building });
    }
    for (const o of deliverOptions(data, state, seat)) {
      moves.push(
        o.meeples === undefined
          ? { type: 'deliver', seat, tile: o.tile, spend: o.spend }
          : {
              type: 'deliver',
              seat,
              tile: o.tile,
              spend: o.spend,
              meeples: o.meeples,
              ...(o.placements === undefined ? {} : { placements: o.placements }),
              ...(o.paymentToll === undefined ? {} : { paymentToll: o.paymentToll }),
            },
      );
    }
    // The Deliver action's freight branch (DL-12): balloon moves.
    for (const o of balloonMoveOptions(data, state, seat)) {
      moves.push({ type: 'moveBalloon', seat, balloon: o.balloon, spend: o.spend });
    }
    // ⛔ This used to read "...and no Tier 3 ACTION card is live either": an
    // ACTION card was a main action too, so it had to suppress `pass` exactly as
    // the five printed actions do. The concept was retired on 19/08/2026 (all
    // fifteen are GROW buildings now), so `pass` is back to meaning what it
    // says: no main action of any kind is legal.
    //
    // ⚠️ It counts only the MAIN-action moves above, which is why the meeple and
    // bonus blocks are appended after it. `pass` must stay available to a seat
    // whose only remaining options are start-of-turn ones, or that seat has no
    // legal move at all - the same trap the GBP 2 upgrade fell into on
    // 19/08/2026.
    if (moves.length === 0) moves.push({ type: 'pass', seat });
  }

  // THE MEEPLE PHASE, then THE BONUS SLOT - the two start-of-turn windows, in
  // the order they are played.
  //
  // Every option below gates itself (`meepleSpendOpen`, `bonusOpen`), so this
  // block is offered at the start of the turn only and empties the moment an
  // action is taken. Nothing here needs to test a window itself. Meeples come
  // first because they are first in the rule and because taking the bonus SHUTS
  // the meeple phase - a meeple may not be held back past it.
  //
  // ⚠️ UNDER `meepleSpendTiming: 'afterAction'` (M4, 12/09/2026) THE
  // MEEPLE LINE IS NOT A START-OF-TURN WINDOW AT ALL: it enumerates only once
  // the action is spent, so it appears at the END of the turn's menu even though
  // it is written here. The position in this list is not the rule - the
  // predicate is - and moving the line would change nothing but the order the
  // bots see.
  for (const colour of meepleOptions(data, state, seat)) {
    moves.push({ type: 'spendMeeple', seat, colour });
  }
  // The bonus slot's solitaire half, under whichever currency is in play:
  // `bonusDrawOpen` is false under the meeple arm and `collectOptions` is empty
  // under the shipped game, so exactly one of the two lines can contribute.
  if (bonusDrawOpen(data, state)) moves.push({ type: 'bonusDraw', seat });
  moves.push(...collectOptions(data, state, seat));
  moves.push(...visitOptions(data, state, seat));
  // THE COMMONS (C3): the whole of the bonus slot under `visitCurrency:
  // 'commons'`, and empty under both controls. It sits in this block rather
  // than beside the main actions because it IS a bonus option - it spends
  // `turn.bonusUsed` and never `turn.actionSpent` - and `bonusOpen` gates it,
  // so under the commons' own `bonusTiming: 'start'` these moves are on offer
  // exactly while the action is unspent, which is C2.
  moves.push(...commonsOptions(data, state, seat));
  // ⭐ DEAN'S VARIANTS (`rules.turn.commonsTake: 'bonus'`, `'spend'` or
  // `'paid'`, 09/09/2026, and `'coins'`, 10/09/2026): the slot's OTHER option
  // under any of those knob values, empty under the shipped `'harvest'` rule
  // and under both controls - `commonsTakeOptions` fails closed on the same
  // checks `commonsOptions` does, and dispatches its own resolution
  // (`doCommonsTake`), by board under `'spend'` and to the discards for coins
  // under `'coins'`.
  moves.push(...commonsTakeOptions(data, state, seat));
  moves.push(...standingMoves(data, state, seat));
  if (turn.actionSpent) moves.push({ type: 'endTurn', seat });

  return moves;
}

/**
 * The moves that SPEND the turn's one action.
 *
 * ⚠️ `bonusDraw`, `visit` and `spendMeeple` are deliberately NOT here, and none
 * of them may ever be added: they spend `turn.bonusUsed` or a meeple in their
 * own funnels. The GBP 2 upgrade taught the cost of getting this wrong - it left
 * this set on 19/08/2026 and had to leave `hasMainOption` in the same edit, or a
 * seat whose only remaining option was a bonus would have had `pass` suppressed
 * and no legal move at all.
 */
const MAIN_ACTIONS = new Set<Move['type']>([
  // ⚠️ `commons` IS NOT HERE EITHER, on the same rule as the three above it: it
  // spends the bonus slot, and adding it would suppress `pass` for a seat whose
  // only remaining option is a commons play. `commonsTake` (Dean's variant,
  // 09/09/2026) is the same case again: it spends `turn.bonusUsed`, never
  // `turn.actionSpent`.
  'draw',
  'build',
  'grow',
  'harvest',
  'deliver',
  'moveBalloon',
  'pass',
]);

/**
 * Which half of the turn a task should resume into. The start-of-turn moves -
 * both bonus options and a spent meeple - resume as 'bonus'; everything else is
 * the main action. ('bonus' was called 'worker' until v31, when the Services it
 * named stopped existing.)
 */
function resumeFor(type: Move['type']): Resume {
  return type === 'visit' ||
    type === 'bonusDraw' ||
    type === 'collect' ||
    type === 'commons' ||
    type === 'commonsTake' ||
    type === 'spendMeeple'
    ? 'bonus'
    : 'main';
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
    // The needle's key is hoisted out of the scan deliberately - see `shapeKey`.
    const answerKey = shapeKey(move.answer);
    if (!legal.some((a) => shapeKey(a) === answerKey)) {
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

  if (MAIN_ACTIONS.has(move.type)) {
    if (turn.actionSpent) throw new Error('Main action already spent this turn');
    turn.actionSpent = true;
  }

  switch (move.type) {
    case 'draw':
      doDraw(fx, move.seat);
      break;
    case 'bonusDraw':
      doBonusDraw(fx, move.seat);
      break;
    case 'spendMeeple':
      doSpendMeeple(fx, move.seat, move.colour);
      break;
    case 'build':
      // The plain printed rules: no mods. The Build ACTION carries no
      // substitution since 2026-08-10 - that is the Builder's Yard's to grant.
      doBuild(fx, move.seat, {
        card: move.card,
        payment: move.payment,
        ...(move.meeples === undefined ? {} : { meeples: move.meeples }),
        ...(move.wildPairs === undefined ? {} : { wildPairs: move.wildPairs }),
        // V6 (A150): a count, re-validated and charged in `doBuild`.
        ...(move.coins === undefined ? {} : { coins: move.coins }),
      });
      break;
    case 'grow':
      // ⛔ `apiaryGrowBonus` was called here, on the GROW ACTION branch and
      // nowhere else, so that A5, A6 and A12 did not each trigger it. The card
      // is gone (v31); the rule that an action-scoped effect belongs on this
      // branch and never inside `doGrow` is not.
      doGrow(
        fx,
        move.seat,
        move.building,
        move.payment,
        // K10: `coin` is the only mod the ACTION ever carries, and it is the
        // payment rather than a grant - see `GrowMods.coin`. Spread so the
        // object is `{}` in the shipped game, exactly as it always was.
        // ⭐ AND V8's IS THE SECOND (A150, 12/09/2026), spread the same way so
        // the object is `{}` in the shipped game exactly as it always was.
        {
          ...(move.coin === true ? { coin: true } : {}),
          ...(move.coinGrow === true ? { coinGrow: true } : {}),
        },
        move.meeples ?? [],
        {
          ...(move.placements === undefined ? {} : { placements: move.placements }),
          ...(move.paymentToll === undefined ? {} : { paymentToll: move.paymentToll }),
        },
      );
      break;
    case 'harvest':
      // ⛔ The ActionAgain arming stood here ("Harvest is 2 buildings", the
      // upgraded Wheat Farmstead) and is gone with the whole gate - see the
      // tombstone on `harvestAgainPower` in actions.ts.
      doHarvestAction(fx, move.seat, move.building);
      break;
    case 'deliver':
      doDeliver(fx, move.seat, move.tile, move.spend, undefined, 1, move.meeples, {
        ...(move.placements === undefined ? {} : { placements: move.placements }),
        ...(move.paymentToll === undefined ? {} : { paymentToll: move.paymentToll }),
      });
      break;
    case 'moveBalloon':
      doMoveBalloon(fx, move.seat, move.balloon, move.spend);
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
      // The move IS the spend: `fee` under the card currency, `meeples` plus
      // `colour` under the meeple one, and doVisit branches on the knob.
      doVisit(fx, move.seat, move.host, move);
      break;
    case 'collect':
      doCollect(fx, move.seat);
      break;
    case 'commons':
      // One card onto one central board, then that board's action (C3). No
      // host, so nothing here names a second seat. `fee2` is the wild pair's
      // second card (K3, 10/09/2026) and is undefined in the shipped game.
      doCommons(fx, move.seat, move.board, move.fee, move.fee2);
      break;
    case 'commonsTake':
      // Dean's variants: the whole of one central pile. No action is ever
      // bought; under 'paid' `move.fee` is the card it costs, discarded before
      // the pile moves, and under 'coins' (K3/K8, 10/09/2026) the pile goes to
      // the discards and pays one coin per card.
      doCommonsTake(fx, move.seat, move.board, move.fee);
      break;
    case 'endTurn':
      if (!turn.actionSpent) throw new Error('End turn requires the action spent (or passed)');
      turn.ending = true;
      break;
    case 'cardMove': {
      const offered = standingMoves(data, draft, move.seat);
      const moveKey = shapeKey(move);
      if (!offered.some((m) => shapeKey(m) === moveKey)) {
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
