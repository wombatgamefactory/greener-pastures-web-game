/**
 * The scoring terms. `score(move) = sum over terms of weight[term] * feature(term)`.
 *
 * Ticket 10 chose a term table over a 1-ply state evaluator because `apply`
 * very often returns a mid-effect state with a pending task, so resulting
 * positions are not comparable across moves. The cost of that choice is that
 * the bot has an opinion about each MOVE, which rots when the rules move. Two
 * things hold it honest:
 *
 *   - every term declares the move types it `claims`, and a test asserts the
 *     union of claims is exactly the engine's `MOVE_TYPES`, so a rules change
 *     that adds a move type fails the build rather than scoring it 0 forever;
 *   - `--explain` prints the per-term breakdown behind a decision, so a weight
 *     can be argued with instead of believed.
 *
 * Three terms come straight from the reference implementation's `BotPolicy.php`
 * - `deliver` (DL-78 "Deliver is absolute"), `unclogBoard`, and the junk rank
 * behind `visitFeeJunk` / `discardJunk`. Everything else is ours: the reference
 * bot never hires, upgrades, visits or answers an optional task, and those are
 * precisely the mechanisms the watch-list has to measure.
 */

import type { GameData, Suit } from '@gp/data';
import type { CardId, MoveType } from '@gp/engine';
import { tileLevel } from '@gp/engine';

import type { Act } from './acts.js';
import { spendSize } from './acts.js';
import { cardValue, totalValue } from './junk.js';
import type { Scratch } from './scratch.js';
import { cardById, faceOfView } from './scratch.js';

export interface Term {
  readonly name: string;
  /** Move types this term can score. Asserted against the engine's MOVE_TYPES. */
  readonly claims: readonly MoveType[];
  readonly feature: (act: Act, s: Scratch) => number;
}

/** Both spellings of the same act: the main move and its task-answer twin. */
const ACTION_AND_TASK: readonly MoveType[] = ['task'];

function suitOf(data: GameData, id: CardId): Suit {
  return cardById(data, id).suit;
}

function stackOf(s: Scratch, building: CardId): number {
  return s.buildings.get(building)?.stack.length ?? 0;
}

function thresholdOf(s: Scratch, building: CardId): number | null {
  const view = s.buildings.get(building);
  return view ? faceOfView(s.data, view).threshold : null;
}

function fillsBuilding(s: Scratch, building: CardId): boolean {
  const threshold = thresholdOf(s, building);
  return threshold !== null && stackOf(s, building) + 1 >= threshold;
}

function countOwnCrop(s: Scratch, ids: readonly CardId[]): number {
  let n = 0;
  for (const id of ids) if (suitOf(s.data, id) === s.mySuit) n += 1;
  return n;
}

/** The card a standing move spends out of hand: the Helping Hand's fee, O1's gift. */
function cardMoveSpend(payload: Record<string, unknown>): CardId | null {
  const fee = payload['fee'];
  if (typeof fee === 'string') return fee;
  const card = payload['card'];
  if (typeof card === 'string') return card;
  return null;
}

export const TERMS: readonly Term[] = [
  // --- the island -----------------------------------------------------------
  {
    // DL-78. The one rule that makes a game terminate, so it carries the
    // biggest feature in the table: the printed VP of the tile, 4 / 8 / 16.
    name: 'deliver',
    claims: ['deliver', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'deliver'
        ? (s.data.island.levelRules[String(tileLevel(s.data, act.tile))]?.vp ?? 0)
        : 0,
  },
  {
    // The level gate (ticket 07) makes a first delivery at a level worth more
    // than the VP on it: it opens the level above, and Level 3 ends the game.
    name: 'deliverClimb',
    claims: ['deliver', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'deliver' && !s.heldLevels.has(tileLevel(s.data, act.tile)) ? 1 : 0,
  },
  {
    name: 'deliverCost',
    claims: ['deliver', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'deliver' ? -spendSize(act.spend) : 0),
  },
  {
    // The freight branch: a Deliver action that moves a balloon instead. Pays
    // 2 differing barn cards and is never an island delivery.
    name: 'balloon',
    claims: ['moveBalloon', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'balloon' ? 1 : 0),
  },

  // --- the barn supply line -------------------------------------------------
  {
    name: 'harvest',
    claims: ['harvest', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'harvest' ? stackOf(s, act.building) : 0),
  },
  {
    // The reference's second rule: a clogged Notice Board shuts off the
    // table's coin faucet, so unclogging your own is worth more than the cards.
    name: 'unclogBoard',
    claims: ['harvest', ...ACTION_AND_TASK],
    feature: (act, s) =>
      act.a === 'harvest' && s.noticeBoard !== null && act.building === s.noticeBoard.card ? 1 : 0,
  },
  {
    name: 'grow',
    claims: ['grow', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'grow' ? 1 : 0),
  },
  {
    name: 'growCompletes',
    claims: ['grow', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'grow' && fillsBuilding(s, act.building) ? 1 : 0),
  },
  {
    name: 'sow',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'sow' ? 1 : 0),
  },
  {
    name: 'sowCompletes',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'sow' && fillsBuilding(s, act.onto) ? 1 : 0),
  },

  // --- the tableau ----------------------------------------------------------
  {
    name: 'build',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'build' ? 1 : 0),
  },
  {
    name: 'buildVp',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' ? (cardById(s.data, act.card).printedVp ?? 0) : 0),
  },
  {
    // The Farmstead free-flip is the whole own-suit incentive, so a profile's
    // loyalty lives in this one weight.
    name: 'buildOwnCrop',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act, s) => (act.a === 'build' && suitOf(s.data, act.card) === s.mySuit ? 1 : 0),
  },
  {
    // Cards are the scarce resource and the master clock (v14). Paying four of
    // them for a card has to hurt or the bot empties its hand every turn.
    name: 'buildSpend',
    claims: ['build', ...ACTION_AND_TASK],
    feature: (act) => (act.a === 'build' ? -(act.payment.length + act.coinWild) : 0),
  },
  {
    name: 'hire',
    claims: ['hire'],
    feature: (act, s) => (act.a === 'hire' && !s.ownsWorker ? 1 : 0),
  },
  {
    name: 'upgrade',
    claims: ['upgrade'],
    feature: (act) => (act.a === 'upgrade' ? 1 : 0),
  },
  {
    // Ticket 29's change with teeth: an upgraded starter prints its crop icon,
    // so a £2 flip can also be the third own-colour building that flips the
    // Farmstead free. The £2 sinks went unused in the 2026-07-14 playtest;
    // this is the term that decides whether a bot finds the double duty.
    name: 'upgradeMilestone',
    claims: ['upgrade'],
    feature: (act, s) =>
      act.a === 'upgrade' && !s.farmsteadUpgraded && s.ownCropBuildings + 1 >= s.flipAt ? 1 : 0,
  },

  // --- the hand -------------------------------------------------------------
  {
    // Scaled by room in hand: drawing into an end-of-turn discard is a wasted
    // action, and the base Draw only nets +1 card a turn.
    name: 'drawAction',
    claims: ['draw'],
    feature: (act, s) => (act.a === 'draw' ? s.handRoom : 0),
  },
  {
    name: 'deckOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && act.suit === s.mySuit ? 1 : 0),
  },
  {
    name: 'deckDemand',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'deckPick' && s.demandSuits.has(act.suit) ? 1 : 0),
  },
  {
    name: 'keepValue',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? totalValue(s.data, act.cards) : 0),
  },
  {
    name: 'keepOwnCrop',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'keep' ? countOwnCrop(s, act.cards) : 0),
  },
  {
    // The junk rank, negated: the least valuable discard scores highest.
    name: 'discardJunk',
    claims: ACTION_AND_TASK,
    feature: (act, s) => (act.a === 'discard' ? -totalValue(s.data, act.cards) : 0),
  },

  // --- the bonus slot -------------------------------------------------------
  {
    name: 'visit',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' ? 1 : 0),
  },
  {
    name: 'visitWorker',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' && act.payoff.mode === 'worker' ? 1 : 0),
  },
  {
    name: 'visitSpecial',
    claims: ['visit'],
    feature: (act) => (act.a === 'visit' && act.payoff.mode === 'special' ? 1 : 0),
  },
  {
    // "Your junk is their treasure" made executable: of two identical visits,
    // take the one that pays with the card you least want.
    name: 'visitFeeJunk',
    claims: ['visit'],
    feature: (act, s) => (act.a === 'visit' ? -totalValue(s.data, act.fee) : 0),
  },
  {
    name: 'workOwn',
    claims: ['workOwnWorker'],
    feature: (act) => (act.a === 'workOwn' ? 1 : 0),
  },
  {
    // Answering a chooseWorker task: doing the work beats declining it. The
    // skip answer, where one is offered, is scored by `skip`.
    name: 'workerTask',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'worker' ? 1 : 0),
  },

  // --- standing moves and the turn boundary ---------------------------------
  {
    name: 'cardMove',
    claims: ['cardMove'],
    feature: (act) => (act.a === 'cardMove' ? 1 : 0),
  },
  {
    name: 'cardMoveSpend',
    claims: ['cardMove'],
    feature: (act, s) => {
      if (act.a !== 'cardMove') return 0;
      const spent = cardMoveSpend(act.payload);
      return spent === null ? 0 : -cardValue(s.data, spent);
    },
  },
  {
    // Optional tasks: "you may". A negative weight means take the option.
    name: 'skip',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'skip' ? 1 : 0),
  },
  {
    // The card-task escape hatch. No card in the 105 uses it, so this exists to
    // keep the coverage honest if one ever does - and to score it last.
    name: 'cardTask',
    claims: ACTION_AND_TASK,
    feature: (act) => (act.a === 'cardTask' ? 1 : 0),
  },
  {
    // Only legal when no main action is, so the weight never picks between
    // moves - it just has to lose to any bonus-slot move that is still open.
    name: 'pass',
    claims: ['pass'],
    feature: (act) => (act.a === 'pass' ? 1 : 0),
  },
  {
    // Ending with the bonus slot unspent is the one thing a v14 bot must not
    // do: the free visit is where the money is minted.
    name: 'endTurn',
    claims: ['endTurn'],
    feature: (act) => (act.a === 'endTurn' ? 1 : 0),
  },
];

export const TERM_NAMES: readonly string[] = TERMS.map((t) => t.name);
