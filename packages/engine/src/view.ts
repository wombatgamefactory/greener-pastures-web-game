/**
 * The hidden-information boundary. One true GameState; policies and the UI's
 * rival panels see only a PlayerView. What a seat may know follows the
 * physical table: your own hand ids; rivals' hands as counts; decks as counts;
 * every barn as anonymous tallies (identity dies on harvest, even for the
 * owner); building stacks as suits (identity dies on placement); discards,
 * coins, workers, island and receipts fully public.
 *
 * Masked ids keep their suit letter (`W?`): the suit of a placed or drawn card
 * is public knowledge, its identity is not.
 */

import type { GameData, Suit } from '@gp/data';

import { cardById } from './query.js';
import type {
  AerodromeState,
  CardId,
  GameEvent,
  GameState,
  IslandState,
  Resume,
  Seat,
  Task,
  TurnState,
  WorkerState,
} from './state.js';

/** A building as everyone sees it: the stack collapses to suits. */
export interface BuildingView {
  card: CardId;
  stack: Suit[];
  upgraded: boolean;
}

export interface RivalView {
  seat: Seat;
  suit: Suit;
  coins: number;
  handCount: number;
  barnCount: number;
  tableau: BuildingView[];
  receipts: number[];
}

export interface PlayerView {
  seat: Seat;
  seats: number;
  suitsInPlay: Suit[];
  turnPlayer: Seat;
  phase: 'playing' | 'ended';
  endTrigger: { seat: Seat } | null;
  you: {
    suit: Suit;
    coins: number;
    hand: CardId[];
    barn: Partial<Record<Suit, number>>;
    tableau: BuildingView[];
    receipts: number[];
  };
  rivals: RivalView[];
  decks: Record<Suit, number>;
  discards: Record<Suit, CardId[]>;
  fair: WorkerState[];
  island: IslandState;
  aerodrome: AerodromeState | null;
  turn: TurnState;
  /** Pending tasks, with another seat's in-flight draw reveals masked. */
  tasks: Task[];
  resume: Resume | null;
}

/** Mask an id down to its public part: the suit letter. */
export function maskCard(id: CardId): CardId {
  return `${id.charAt(0)}?`;
}

/**
 * One pending task as a seat may see it: another seat's in-flight draw reveals
 * masked, and another seat's in-flight DIVERT cards with them, everything else
 * public.
 *
 * A divert holds cards in limbo on their way to a discard (the Orchard
 * rebuild). Their owner has seen them - they came off that seat's own reveal or
 * out of its own hand, and the answers name them - so the owner's copy is
 * unmasked and everybody else's is not, exactly as a draw's reveal is.
 *
 * Shared by `viewFor` and the probe (ticket 50), which needed to hand a rollout
 * the task it stopped on. One function so the two can never redact differently.
 */
export function redactTask(task: Task, seat: Seat): Task {
  if (task.pid === seat) return { ...task };
  if (task.t === 'draw') return { ...task, revealed: task.revealed.map(maskCard) };
  if (task.t === 'divert') return { ...task, cards: task.cards.map(maskCard) };
  return { ...task };
}

function buildingView(
  data: GameData,
  b: { card: CardId; stack: CardId[]; upgraded: boolean },
): BuildingView {
  return {
    card: b.card,
    stack: b.stack.map((id) => cardById(data, id).suit),
    upgraded: b.upgraded,
  };
}

export function viewFor(data: GameData, state: GameState, seat: Seat): PlayerView {
  const you = state.players[seat];
  if (!you) throw new Error(`No player in seat ${seat}`);

  const barn: Partial<Record<Suit, number>> = {};
  for (const id of you.barn) {
    const suit = cardById(data, id).suit;
    barn[suit] = (barn[suit] ?? 0) + 1;
  }

  return {
    seat,
    seats: state.seats,
    suitsInPlay: [...state.suitsInPlay],
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    endTrigger: state.endTrigger === null ? null : { ...state.endTrigger },
    you: {
      suit: you.suit,
      coins: you.coins,
      hand: [...you.hand],
      barn,
      tableau: you.tableau.map((b) => buildingView(data, b)),
      receipts: [...you.receipts],
    },
    rivals: state.players.flatMap((p, s) =>
      s === seat
        ? []
        : [
            {
              seat: s,
              suit: p.suit,
              coins: p.coins,
              handCount: p.hand.length,
              barnCount: p.barn.length,
              tableau: p.tableau.map((b) => buildingView(data, b)),
              receipts: [...p.receipts],
            },
          ],
    ),
    decks: Object.fromEntries(
      Object.entries(state.decks).map(([suit, deck]) => [suit, deck.length]),
    ) as Record<Suit, number>,
    discards: Object.fromEntries(
      Object.entries(state.discards).map(([suit, pile]) => [suit, [...pile]]),
    ) as Record<Suit, CardId[]>,
    fair: state.fair.map((w) => ({ ...w })),
    island: {
      tiles: state.island.tiles.map((t) => ({
        ...t,
        crates: [...t.crates],
        deliveredBy: [...t.deliveredBy],
      })),
    },
    aerodrome:
      state.aerodrome === null
        ? null
        : { balloons: state.aerodrome.balloons.map((b) => ({ ...b })) },
    turn: {
      ...state.turn,
      visit: state.turn.visit === null ? null : { ...state.turn.visit },
      onceUsed: [...state.turn.onceUsed],
    },
    tasks: state.tasks.map((task) => redactTask(task, seat)),
    resume: state.resume,
  };
}

/**
 * The truth-level event stream, masked to what a seat may know. Card identity
 * survives only where the seat was entitled to it: cards entering YOUR hand,
 * a card YOU placed. Harvested and deck-to-barn ids die for everyone (barns
 * are anonymous even to their owner); discards are face-up and stay public.
 */
export function redactEvents(events: GameEvent[], seat: Seat): GameEvent[] {
  return events.map((event) => {
    switch (event.e) {
      case 'cardsToHand':
        return event.seat === seat ? event : { ...event, cards: event.cards.map(maskCard) };
      case 'cardPlaced':
        return event.seat === seat ? event : { ...event, card: maskCard(event.card) };
      case 'harvested':
        return { ...event, cards: event.cards.map(maskCard) };
      case 'deckToBarn':
      case 'stackToBarn':
        return { ...event, card: maskCard(event.card) };
      case 'cardGifted':
        // Identity travels with the gift: giver chose it, recipient now holds it.
        return event.from === seat || event.to === seat
          ? event
          : { ...event, card: maskCard(event.card) };
      case 'handToBarn':
        // The owner chose the card; to everyone else the barn stays a suit tally.
        return event.seat === seat ? event : { ...event, card: maskCard(event.card) };
      default:
        return event;
    }
  });
}
