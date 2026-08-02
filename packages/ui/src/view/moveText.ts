/**
 * Moves and task answers, in English.
 *
 * Used by three surfaces that must agree: the action bar's family buttons, the
 * disambiguation menu a click opens when it matched more than one move, and the
 * task prompt's fallback list. Writing them once means the fallback is never a
 * dump of JSON - which matters, because the fallback is what guarantees ticket
 * 25's "every task answerable" for a card escape hatch nobody has written a
 * bespoke surface for.
 */

import type { GameData, Suit, WorkerAction } from '@gp/data';
import type { Move, MoveType, PlayerView, Seat, Task, TaskAnswer } from '@gp/engine';

import { SUIT_META, seatName } from './suits';
import { seatSuits } from './table';

export function cardName(data: GameData, id: string): string {
  if (id.endsWith('?')) {
    const suit = data.cards.suits.find((s) => s.charAt(0).toUpperCase() === id.charAt(0));
    return suit ? `a ${SUIT_META[suit].label} card` : 'a card';
  }
  return data.cards.catalogue.find((c) => c.id === id)?.name ?? id;
}

export function spendText(spend: Partial<Record<Suit, number>>): string {
  const parts = (Object.entries(spend) as [Suit, number][])
    .filter(([, n]) => n > 0)
    .map(([suit, n]) => `${n} ${SUIT_META[suit].label}`);
  return parts.length === 0 ? 'nothing' : parts.join(' + ');
}

export function workerName(data: GameData, id: WorkerAction): string {
  return data.workers.roster.find((w) => w.id === id)?.name ?? id;
}

function who(view: PlayerView, seat: Seat): string {
  return seatName(seatSuits(view)[seat], seat, view.seat);
}

function cardList(data: GameData, ids: readonly string[]): string {
  return ids.length === 0 ? 'nothing' : ids.map((id) => cardName(data, id)).join(', ');
}

export function describeAnswer(data: GameData, answer: TaskAnswer): string {
  switch (answer.kind) {
    case 'worker':
      return `the ${workerName(data, answer.workerId)}`;
    case 'deck':
      return `the ${SUIT_META[answer.suit].label} deck`;
    case 'keep':
      return `keep ${cardList(data, answer.cards)}`;
    case 'building':
      return cardName(data, answer.card);
    case 'sow':
      return `${cardName(data, answer.card)} onto ${cardName(data, answer.onto)}`;
    case 'build':
      return `${cardName(data, answer.card)}, paying ${cardList(data, answer.payment)}${
        answer.barn ? ` + ${spendText(answer.barn)} from the barn` : ''
      }${answer.coinWild ? ` + £${answer.coinWild} as cards` : ''}`;
    case 'deliver':
      return `island ${answer.tile}, spending ${spendText(answer.spend)}`;
    case 'balloon':
      return `the ${balloonWord(answer.balloon)} balloon, spending ${spendText(answer.spend)}`;
    case 'discard':
      return `discard ${cardList(data, answer.cards)}`;
    case 'skip':
      return 'decline';
    case 'card':
      return JSON.stringify(answer.payload);
    default:
      return answer satisfies never;
  }
}

export function balloonWord(id: string): string {
  return (
    id
      .replace(/balloon/i, '')
      .replace(/[-_]/g, ' ')
      .trim()
      .toLowerCase() || id
  );
}

export function describeMove(data: GameData, view: PlayerView, move: Move): string {
  switch (move.type) {
    case 'task':
      return describeAnswer(data, move.answer);
    case 'cardMove':
      return `${cardName(data, move.card)}: ${move.kind}`;
    case 'draw':
      return 'Draw';
    case 'build':
      return `Build ${cardName(data, move.card)}, paying ${cardList(data, move.payment)}`;
    case 'hire':
      return `Hire the ${workerName(data, move.workerId)} for £${data.workers.hireFee}`;
    case 'upgrade':
      return `Upgrade ${cardName(data, move.card)} for £${data.rules.economy.upgradeCostCoins}`;
    case 'grow':
      return `Grow ${cardName(data, move.building)}, paying ${cardName(data, move.payment)}`;
    case 'harvest':
      return `Harvest ${cardName(data, move.building)}`;
    case 'deliver':
      return `Deliver to island ${move.tile}: ${spendText(move.spend)}`;
    case 'moveBalloon':
      return `Bring in the ${balloonWord(move.balloon)} balloon: ${spendText(move.spend)}`;
    case 'visit':
      return `Visit ${who(view, move.host)} with ${cardList(data, move.fee)} - ${
        move.payoff.mode === 'coin'
          ? 'take the money'
          : move.payoff.mode === 'special'
            ? 'the Special Orders prize'
            : `work their ${workerName(data, move.payoff.workerId)}`
      }`;
    case 'workOwnWorker':
      return `Work your own ${workerName(data, move.workerId)}`;
    case 'pass':
      return 'Pass';
    case 'endTurn':
      return 'End turn';
    default:
      return move satisfies never;
  }
}

/** What a pending task is asking for, as a prompt line. */
export function describeTask(data: GameData, task: Task): string {
  switch (task.t) {
    case 'chooseWorker':
      return task.owned === 'rival'
        ? "Work one of your neighbours' Hired Workers."
        : 'Choose a Hired Worker to work.';
    case 'draw':
      return task.revealed.length < task.see
        ? `Turn over a card: pick a deck (${task.revealed.length} of ${task.see} seen).`
        : `Keep ${Math.min(task.keep, task.revealed.length)} of the ${task.revealed.length} you saw. The rest go to their discards.`;
    case 'chooseBuilding':
      return 'Choose one of your buildings to harvest.';
    case 'sow':
      return `Sow ${task.remaining} card${task.remaining === 1 ? '' : 's'}: pick one from your hand, then a building to place it on. Any suit will do.`;
    case 'build':
      return 'Build a card from your hand.';
    case 'deliver':
      return 'Deliver: choose an island tile, or bring in a balloon.';
    case 'discard':
      return `Your barn caps your hand at ${task.downTo}. Choose what to discard.`;
    case 'card':
      return `${cardName(data, task.src)}: choose.`;
    default:
      return task satisfies never;
  }
}

// --- the action bar's families ----------------------------------------------

export interface ActionGroup {
  readonly type: MoveType;
  readonly label: string;
  readonly hint: string;
  /** True when clicking it needs a target next rather than playing immediately. */
  readonly needsTarget: boolean;
  readonly moves: Move[];
}

/**
 * The five main actions, the bonus slot and the turn's exits, in the order the
 * rulebook teaches them. A family with no legal move is still listed, greyed:
 * "what can I not do" is half of learning a turn, and hiding it would make the
 * bar jump about between turns.
 */
const FAMILIES: readonly {
  type: MoveType;
  label: string;
  hint: string;
  needsTarget: boolean;
}[] = [
  { type: 'draw', label: 'Draw', hint: 'Top of any two decks, keep one', needsTarget: false },
  { type: 'build', label: 'Build', hint: 'Pay cards from hand', needsTarget: true },
  { type: 'hire', label: 'Hire', hint: 'Build a Worker out of the Fair', needsTarget: true },
  { type: 'upgrade', label: 'Upgrade', hint: 'Flip a starter for coins', needsTarget: true },
  { type: 'grow', label: 'Grow', hint: 'Activate one of your buildings', needsTarget: true },
  {
    type: 'harvest',
    label: 'Harvest',
    hint: 'Take a full stack into your barn',
    needsTarget: true,
  },
  { type: 'deliver', label: 'Deliver', hint: 'Barn to the island', needsTarget: true },
  { type: 'moveBalloon', label: 'Freight', hint: 'Bring in a balloon', needsTarget: true },
  { type: 'visit', label: 'Visit', hint: "A card on a neighbour's board", needsTarget: true },
  { type: 'workOwnWorker', label: 'Work yours', hint: 'Free, and no wage', needsTarget: true },
  { type: 'cardMove', label: 'Card power', hint: 'A standing move on a card', needsTarget: false },
  { type: 'pass', label: 'Pass', hint: 'Nothing else is legal', needsTarget: false },
  { type: 'endTurn', label: 'End turn', hint: 'Decline what is left', needsTarget: false },
];

export function actionGroups(moves: readonly Move[]): ActionGroup[] {
  return FAMILIES.map((family) => ({
    ...family,
    moves: moves.filter((m) => m.type === family.type),
  }));
}
