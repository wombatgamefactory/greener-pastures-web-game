/**
 * The only module in the UI that holds a `GameState`.
 *
 * Everything below `components/` and `view/` renders a `PlayerView` and knows
 * nothing else, which is what keeps ticket 04's hidden-information boundary
 * load-bearing rather than decorative: a component cannot leak what it cannot
 * reach. `src/boundary.test.ts` scans the sources and fails the build if any
 * other file names `GameState`.
 *
 * Ticket 24 builds the STATIC half of the interface, so this exposes no way to
 * take a move. It seeds a real position with the engine and hands out the view.
 * Ticket 25 adds the move surface on top; the seam is `TableSession.state`
 * staying private to this file.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import {
  apply,
  isOver,
  legalMoves,
  newGame,
  redactEvents,
  rngInt,
  seedRng,
  viewFor,
} from '@gp/engine';
import type { GameEvent, GameState, Move, PlayerView, Seat } from '@gp/engine';

export const data: GameData = loadGameData();

/** The seat the human sits in. Always 0: the interface is written from one chair. */
export const YOU: Seat = 0;

/**
 * A crude action-priority policy, enough to walk a game into a dense mid-board
 * position. It is NOT a bot: ticket 28 owns the real policy layer, and this one
 * exists only so the interface is judged against honest state. Deliver first is
 * lifted from the reference's own bot (DL-78) because a purely random walk
 * never fills the island - measured in ticket 10.
 */
const PRIORITY: Move['type'][] = [
  'task',
  'deliver',
  'harvest',
  'build',
  'hire',
  'upgrade',
  'grow',
  'draw',
  'visit',
  'workOwnWorker',
  'moveBalloon',
  'cardMove',
  'pass',
  'endTurn',
];

/**
 * The same list with Draw pulled to the front. Used for the human's own seat
 * while it is short of cards: the greedy order above spends a hand to zero every
 * turn, which would hand the interface a permanently empty hand and hide half
 * the thing being built. Preferring Draw is a different LINE of play, not a
 * different rule set, so the position is still one the engine produced - unlike
 * the ticket 09 prototype, which reached into the state and dealt itself cards.
 */
const HAND_KEEPING: Move['type'][] = [
  'task',
  'draw',
  'deliver',
  'harvest',
  'visit',
  'workOwnWorker',
  'hire',
  'upgrade',
  'grow',
  'build',
  'moveBalloon',
  'cardMove',
  'pass',
  'endTurn',
];

type Rng = [number, number, number, number];

function pick(rng: Rng, moves: Move[], order: Move['type'][] = PRIORITY): Move {
  for (const type of order) {
    const of = moves.filter((m) => m.type === type);
    const chosen = of[rngInt(rng, of.length)];
    if (chosen) return chosen;
  }
  throw new Error('legalMoves returned nothing to play');
}

export interface TableOptions {
  readonly seats: number;
  readonly suits: readonly Suit[];
  readonly seed: string;
  /** Policy moves to walk before handing the table over. 0 = a fresh setup. */
  readonly depth: number;
  /** Keep walking until the human's turn starts with at least this many cards. */
  readonly minHand: number;
}

export interface Table {
  readonly view: PlayerView;
  /** The tail of the event stream, redacted to YOU and narrated by the feed. */
  readonly events: readonly GameEvent[];
}

/**
 * Deal a table and walk it `depth` moves, stopping on the human's turn with the
 * action still unspent so the position always reads as "you, to play".
 */
export function dealTable(opts: TableOptions): Table {
  let state: GameState = newGame(data, {
    seats: opts.seats,
    suits: [...opts.suits],
    seed: opts.seed,
  });
  const rng = seedRng(`table:${opts.seed}`);
  const events: GameEvent[] = [];

  // The main walk plays every seat the same way, so the human's farm is as
  // developed as its neighbours'. Only the short approach below switches the
  // human to the hand-keeping line, and only while short of cards: doing it for
  // the whole game left the human with a thin tableau and hid half the interface.
  const orderFor = (s: GameState): Move['type'][] =>
    s.turnPlayer === YOU && (s.players[YOU]?.hand.length ?? 0) < opts.minHand
      ? HAND_KEEPING
      : PRIORITY;

  for (let i = 0; i < opts.depth && !isOver(state); i++) {
    const applied = apply(data, state, pick(rng, legalMoves(data, state)));
    state = applied.state;
    events.push(...redactEvents(applied.events, YOU));
  }
  // Walk on to the top of the human's turn, so the action and the bonus slot are
  // both still live, AND they hold cards. The prototype dealt itself a hand by
  // reaching into the state; this instead keeps walking until the engine hands
  // out a turn that has one, so the position stays something the rules produced.
  //
  // The fallback matters: a walk that insists on a full hand runs the whole game
  // out and hands the interface a finished board. So the first turn top is kept
  // as a floor, and only bettered.
  const turnTop = (s: GameState) =>
    s.turnPlayer === YOU && s.tasks.length === 0 && !s.turn.actionSpent;

  let best: { state: GameState; events: number } | null = null;
  for (let guard = 0; guard < 240 && !isOver(state); guard++) {
    if (turnTop(state)) {
      const hand = state.players[YOU]?.hand.length ?? 0;
      if (best === null) best = { state, events: events.length };
      if (hand >= opts.minHand) {
        best = { state, events: events.length };
        break;
      }
    }
    const applied = apply(data, state, pick(rng, legalMoves(data, state), orderFor(state)));
    state = applied.state;
    events.push(...redactEvents(applied.events, YOU));
  }

  const chosen = best ?? { state, events: events.length };
  return {
    view: viewFor(data, chosen.state, YOU),
    events: events.slice(0, chosen.events).slice(-60),
  };
}
