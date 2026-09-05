/**
 * The hidden-information boundary. One true GameState; policies and the UI's
 * rival panels see only a PlayerView. What a seat may know follows the
 * physical table: your own hand ids; rivals' hands as counts; decks as counts;
 * every barn as anonymous tallies (identity dies on harvest, even for the
 * owner); building stacks as suits (identity dies on placement); discards,
 * MEEPLES, doors, island and receipts fully public.
 *
 * Masked ids keep their suit letter (`W?`): the suit of a placed or drawn card
 * is public knowledge, its identity is not.
 */

import type { GameData, Suit } from '@gp/data';

import { cardById, isCardId } from './query.js';
import type {
  AerodromeState,
  CardId,
  GameEvent,
  GameState,
  IslandState,
  NoticeBoardState,
  Resume,
  Seat,
  Task,
  TurnState,
  WorkerState,
} from './state.js';

/**
 * A building as everyone sees it: the stack collapses to suits.
 *
 * `upgraded` left with the second printed faces (v31): every card shows one
 * face, so there is nothing about a building's identity that a view has to
 * carry beyond its card id.
 */
export interface BuildingView {
  card: CardId;
  stack: Suit[];
}

export interface RivalView {
  seat: Seat;
  suit: Suit;
  /**
   * MEEPLES HELD, BY COLOUR - fully public, like the coins they replaced. They
   * are claimed face up off the island and sit in front of their owner, so
   * knowing what free action a rival is holding is part of reading the table.
   */
  meeples: Record<Suit, number>;
  /**
   * THE FIVE COLOUR SLOTS, meeple-loop arm only and FULLY PUBLIC. Meeples sit on
   * a board in front of their host for everyone to read, and which colours of
   * which neighbour are shut is the information the whole bonus decision is
   * made on - a hidden slot would make the arm unplayable rather than merely
   * unclear. Absent under the shipped `'card'` game, where there are no slots.
   */
  noticeBoard?: NoticeBoardState;
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
    meeples: Record<Suit, number>;
    /** Your own five colour slots. Meeple-loop arm only - see `RivalView`. */
    noticeBoard?: NoticeBoardState;
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
  /** Pending tasks, with another seat's in-flight reveals and riders masked. */
  tasks: Task[];
  resume: Resume | null;
}

/** Mask an id down to its public part: the suit letter. */
export function maskCard(id: CardId): CardId {
  return `${id.charAt(0)}?`;
}

/**
 * Every card id anywhere inside a handler-defined rider bag, masked. Walks
 * arrays and nested objects, leaves everything that is not an id alone.
 */
function maskRiders(data: GameData, riders: Record<string, unknown>): Record<string, unknown> {
  const mask = (value: unknown): unknown => {
    if (typeof value === 'string') return isCardId(data, value) ? maskCard(value) : value;
    if (Array.isArray(value)) return value.map(mask);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v)]));
    }
    return value;
  };
  return Object.fromEntries(Object.entries(riders).map(([k, v]) => [k, mask(v)]));
}

/**
 * One pending task as a seat may see it: another seat's in-flight draw reveals
 * masked, another seat's in-flight DIVERT cards with them, and another seat's
 * CARD-TASK RIDERS with both. Everything else public.
 *
 * A divert holds cards in limbo on their way to a discard (the Orchard
 * rebuild). Their owner has seen them - they came off that seat's own reveal or
 * out of its own hand, and the answers name them - so the owner's copy is
 * unmasked and everybody else's is not, exactly as a draw's reveal is.
 *
 * ⚠️ THE THIRD BRANCH WAS MISSING FROM THE DAY CARD TASKS WERE ADDED, and it
 * was a real leak rather than a tidy-up. `riders` is the escape hatch's
 * untyped bag, and three cards fill it with card ids: D10 The Scout's Post and
 * D15 The Grand Creamery hold DECK TOPS in limbo there, and O15 The Lending
 * Library holds the ids it has just drawn INTO ITS OWNER'S HAND. Falling
 * through to `{ ...task }` handed every one of those to every rival's
 * PlayerView - deck order and a rival's hand, the two things this file exists
 * to withhold - for as long as the task sat unanswered.
 *
 * THE WHOLE BAG IS MASKED, not a named field, because `riders` is defined by
 * the handler and this seam cannot know which of its ids are public. The two
 * failure modes are not symmetric: masking a public id (D5's `built`, a
 * tableau card a rival can read off the table anyway) costs a rival's panel a
 * name it can look up elsewhere, while leaking a private one cannot be undone.
 * So the default is mask, and a future card that genuinely needs a rider read
 * across the table should say so by putting it somewhere other than `riders`.
 *
 * Shared by `viewFor` and the probe (ticket 50), which needed to hand a rollout
 * the task it stopped on. One function so the two can never redact differently.
 */
export function redactTask(data: GameData, task: Task, seat: Seat): Task {
  if (task.pid === seat) return { ...task };
  if (task.t === 'draw') return { ...task, revealed: task.revealed.map(maskCard) };
  if (task.t === 'divert') return { ...task, cards: task.cards.map(maskCard) };
  if (task.t === 'card') return { ...task, riders: maskRiders(data, task.riders) };
  return { ...task };
}

/**
 * The colour slots, deep-copied - or nothing at all under the shipped game,
 * where a `PlayerState` carries no board. A spread rather than an assignment so
 * the key is ABSENT and not present-and-undefined, which is what keeps the
 * control arm's views identical to 03/09/2026.
 */
function copyNoticeBoard(board: NoticeBoardState | undefined): { noticeBoard?: NoticeBoardState } {
  if (!board) return {};
  return {
    noticeBoard: {
      slots: Object.fromEntries(
        Object.entries(board.slots).map(([colour, meeples]) => [colour, [...meeples]]),
      ) as Record<Suit, Suit[]>,
    },
  };
}

function buildingView(data: GameData, b: { card: CardId; stack: CardId[] }): BuildingView {
  return { card: b.card, stack: b.stack.map((id) => cardById(data, id).suit) };
}

export function viewFor(data: GameData, state: GameState, seat: Seat): PlayerView {
  const you = state.players[seat];
  if (!you) throw new Error(`No player in seat ${seat}`);

  const barn: Partial<Record<Suit, number>> = {};
  for (const id of you.barn) {
    const suit = cardById(data, id).suit;
    barn[suit] = (barn[suit] ?? 0) + 1;
  }

  // Every card face-up on the table, for the fire-once guard below.
  const onTable = new Set<CardId>(state.players.flatMap((p) => p.tableau.map((b) => b.card)));

  return {
    seat,
    seats: state.seats,
    suitsInPlay: [...state.suitsInPlay],
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    endTrigger: state.endTrigger === null ? null : { ...state.endTrigger },
    you: {
      suit: you.suit,
      meeples: { ...you.meeples },
      ...copyNoticeBoard(you.noticeBoard),
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
              meeples: { ...p.meeples },
              ...copyNoticeBoard(p.noticeBoard),
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
        // Face up from setup, so no redaction: which colour the first and second
        // deliverer to a tile will take is public all game.
        meeples: [...t.meeples],
        deliveredBy: [...t.deliveredBy],
      })),
    },
    aerodrome:
      state.aerodrome === null
        ? null
        : { balloons: state.aerodrome.balloons.map((b) => ({ ...b })) },
    turn: {
      ...state.turn,
      bonusUsed: [...state.turn.bonusUsed],
      onceUsed: [...state.turn.onceUsed],
      // ⛔ FILTERED, NOT COPIED, and the reason is a card that leaves the table
      // between firing and the view being built. `firedThisTurn` names the cards
      // whose text has fired this turn; D14 liquidates itself, reaches the
      // discard, and a reshuffle can put it back into a FACE-DOWN DECK inside
      // the same turn - at which point the view is naming an id that lives in a
      // deck, which is exactly what view-safety.test.ts exists to catch. It went
      // unseen for as long as it did because no random walk had reached that
      // sequence; the meeple-economy defaults of 05/09/2026 changed the walk and
      // it fell out at once. Nothing outside the engine reads this list (the UI
      // constructs an empty one), so filtering costs nothing, and a fired card
      // still on the table is public information at a real table anyway.
      firedThisTurn: state.turn.firedThisTurn.filter((id) => onTable.has(id)),
    },
    tasks: state.tasks.map((task) => redactTask(data, task, seat)),
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
