/**
 * The only module in the UI that holds a `GameState`.
 *
 * Everything below `components/` and `view/` renders a `PlayerView` and knows
 * nothing else, which is what keeps ticket 04's hidden-information boundary
 * load-bearing rather than decorative: a component cannot leak what it cannot
 * reach. `src/boundary.test.ts` scans the sources and fails the build if any
 * other file names `GameState`.
 *
 * Ticket 24 needed only `dealTable`, which walks a position and hands out a
 * view. Ticket 25 adds `Session`: the same boundary, plus a way to send a move
 * and a bot driver. The seam is still that `state` never leaves this file - a
 * component receives a `Snapshot`, which is a view, a move list and some flags.
 *
 * A session is a pure function of (data, options, move log). Bots are asked for
 * a move but their answer is recorded in the log like any other, so undo is
 * replay-a-prefix (ticket 04) with nothing else to unwind: `restart` re-seeds
 * every policy stream and replays, so the same log always reproduces the same
 * game.
 */

import { loadGameData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
import { makePolicy, policyRng } from '@gp/bots';
import type { PolicyId } from '@gp/bots';
import {
  apply,
  isOver,
  legalMoves,
  makeCapture,
  makeProber,
  newGame,
  redactEvents,
  rngInt,
  score,
  seedRng,
  viewFor,
} from '@gp/engine';
import type {
  Capture,
  CaptureLabel,
  CaptureUi,
  GameEvent,
  GameScore,
  GameState,
  Move,
  PlayerView,
  RngState,
  Seat,
} from '@gp/engine';

export const data: GameData = loadGameData();

/** The seat the human sits in. Always 0: the interface is written from one chair. */
export const YOU: Seat = 0;

/**
 * Which build this is, stamped into a bug report.
 *
 * Injected by `vite.config.ts` from `git describe`. The guard is not paranoia:
 * the unit tests run under vitest with no Vite `define` at all, and a bare
 * reference to an undefined global is a ReferenceError rather than `undefined`.
 */
declare const __APP_VERSION__: string | undefined;
const APP_VERSION: string | null = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null;

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
  'buy',
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
  'buy',
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

/**
 * The warm-up's hand-keeping line. Draw first, VISIT LAST - and that ordering is
 * the whole point. With visit above the builders (as in HAND_KEEPING) the seat
 * draws one card and spends it on a visit every single turn, so the hand sits at
 * zero forever and the interface is handed a turn with almost nothing legal.
 * Measured at four seats, where your turn comes round rarely enough that the
 * pattern never breaks on its own.
 */
const WARM_KEEPING: Move['type'][] = [
  'task',
  'draw',
  'buy',
  'harvest',
  'grow',
  'build',
  'hire',
  'upgrade',
  'deliver',
  'workOwnWorker',
  'moveBalloon',
  'visit',
  'cardMove',
  'pass',
  'endTurn',
];

function pick(rng: RngState, moves: Move[], order: Move['type'][] = PRIORITY): Move {
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

// --- the live session -------------------------------------------------------

export interface SessionOptions {
  readonly seats: number;
  /** One per seat, in seating order. Index 0 is yours. */
  readonly suits: readonly Suit[];
  readonly seed: string;
  /** One per seat; index 0 is ignored because seat 0 is the human. */
  readonly opponents: readonly PolicyId[];
}

/**
 * Everything a component may see. Deliberately not the state: a snapshot is a
 * view plus the legal move list, so the "one source of legality" constraint is
 * structural - there is nothing else here to derive a move from.
 */
export interface Snapshot {
  readonly view: PlayerView;
  /**
   * Exactly what `legalMoves` offered, and only when the decision is yours.
   * Empty while a bot is thinking, so no interface path can act out of turn.
   */
  readonly moves: readonly Move[];
  /** Whose decision it is - the head task's owner, or the turn player. */
  readonly actor: Seat | null;
  readonly yours: boolean;
  readonly events: readonly GameEvent[];
  readonly over: boolean;
  readonly score: GameScore | null;
  readonly canUndo: boolean;
  /** Moves played so far. A save is (seed, this) - ticket 04's format. */
  readonly played: number;
}

/** Whose decision the position is waiting on. */
function actorOf(state: GameState): Seat | null {
  if (state.phase !== 'playing') return null;
  return state.tasks[0]?.pid ?? state.turnPlayer;
}

export class Session {
  private state: GameState;
  private readonly log: Move[] = [];
  private events: GameEvent[] = [];
  private rngs = new Map<Seat, RngState>();
  /** Moves undo may not rewind past: the warm-up walk is scenery, not your play. */
  private floor = 0;
  /**
   * Which turn the table is on. Counted here rather than derived from the log,
   * because a cross-player task answer changes a move's `seat` without ending
   * anyone's turn - deriving it from seat changes overstates a real game by
   * about a tenth.
   */
  private turns = 1;

  constructor(
    private readonly gameData: GameData,
    readonly options: SessionOptions,
  ) {
    this.state = this.deal();
  }

  private deal(): GameState {
    this.rngs.clear();
    // Replay re-deals, so the counter has to reset with the table or an undo
    // would leave it counting from the old game.
    this.turns = 1;
    for (let seat = 0; seat < this.options.seats; seat++) {
      if (seat === YOU) continue;
      const id = this.policyId(seat);
      this.rngs.set(seat, policyRng(this.options.seed, seat, id));
    }
    return newGame(this.gameData, {
      seats: this.options.seats,
      suits: [...this.options.suits],
      seed: this.options.seed,
    });
  }

  private policyId(seat: Seat): PolicyId {
    return this.options.opponents[seat] ?? 'balanced';
  }

  snapshot(): Snapshot {
    const actor = actorOf(this.state);
    const yours = actor === YOU;
    return {
      view: viewFor(this.gameData, this.state, YOU),
      moves: yours ? legalMoves(this.gameData, this.state) : [],
      actor,
      yours,
      events: this.events.slice(-160),
      over: isOver(this.state),
      score: isOver(this.state) ? score(this.gameData, this.state) : null,
      canUndo: this.log.slice(this.floor).some((m) => m.seat === YOU),
      played: this.log.length,
    };
  }

  /**
   * Walk the table forward with the crude priority policy above, every seat
   * included, and stop at the top of your turn. Not a way to play - it is how
   * the interface gets judged against a dense mid-game board (ticket 09's
   * finding that a real seeded position beats invented data), and how
   * `verify:layout` measures the floor against a full tableau rather than a
   * three-building opening.
   *
   * The walked moves go into the log like any other, so the session stays a
   * pure function of (seed, log) and undo still works across the seam.
   */
  warmUp(depth: number, minHand: number): void {
    if (depth <= 0) return;
    try {
      this.walk(depth, minHand);
    } finally {
      this.floor = this.log.length;
    }
  }

  private walk(depth: number, minHand: number): void {
    // Your neighbours are walked by the real scored bot, so the board you are
    // handed is one a game could actually produce. Your own seat is walked by
    // the hand-keeping order instead: `balanced` spends a hand to zero every
    // turn (measured - every seat it plays sits at 0 for long stretches), which
    // would hand the interface a permanently empty hand and hide half of what
    // is being demonstrated. Preferring Draw is a different LINE of play, not a
    // different rule set, so the position is still one the rules produced.
    const policy = makePolicy('balanced');
    const rngs = new Map<Seat, RngState>();
    const step = () => {
      const moves = legalMoves(this.gameData, this.state);
      if (moves.length === 0) return false;
      const seat = this.state.tasks[0]?.pid ?? this.state.turnPlayer;
      const rng = rngs.get(seat) ?? seedRng(`warmup:${this.options.seed}:${seat}`);
      rngs.set(seat, rng);
      if (seat === YOU) {
        // Draw while short of cards, then spend like anyone else. Held to the
        // keeping line the whole way, the seat draws every single turn and
        // never builds, so the tableau stays at three starters.
        const short = (this.state.players[YOU]?.hand.length ?? 0) < minHand;
        this.send(pick(rng, moves, short ? WARM_KEEPING : PRIORITY));
        return true;
      }
      const view = viewFor(this.gameData, this.state, seat);
      const probe = makeProber(this.gameData, this.state, seat);
      this.send(policy.choose({ data: this.gameData, view, moves, rng, probe }));
      return true;
    };

    const hand = () => this.state.players[YOU]?.hand.length ?? 0;
    const turnTop = () =>
      this.state.turnPlayer === YOU &&
      this.state.tasks.length === 0 &&
      !this.state.turn.actionSpent;

    // The last turn-top seen while walking to depth. A caller asking for more
    // depth than the game has left would otherwise be handed a FINISHED board:
    // the search below never runs (the state is already over) and there is
    // nothing to fall back to. Ticket 38's cheaper island shortened the game by
    // 20% and depth 260 started overrunning it, which is the failure mode - so
    // the deepest playable turn-top is kept as a floor from the first move.
    let lastTop: number | null = null;
    for (let i = 0; i < depth && !isOver(this.state); i++) {
      if (turnTop()) lastTop = this.log.length;
      if (!step()) break;
    }

    // Keep the FIRST turn-top as a floor and only better it. Without that a
    // walk that insists on a full hand runs the whole game out and hands the
    // interface a finished board - which is exactly what happened: the crude
    // policy spends a hand to zero every turn, so `minHand` is often never met.
    let best: { at: number; hand: number } | null = null;
    for (let guard = 0; guard < 240 && !isOver(this.state); guard++) {
      if (turnTop()) {
        if (hand() >= minHand) return;
        if (best === null || hand() > best.hand) best = { at: this.log.length, hand: hand() };
      }
      if (!step()) break;
    }
    if (best !== null) this.replay(this.log.slice(0, best.at));
    else if (lastTop !== null && isOver(this.state)) this.replay(this.log.slice(0, lastTop));
  }

  /**
   * The move log. With the seed this IS the save format ticket 04 settled -
   * `{dataFingerprint, seed, moves}` - and it is what makes undo replay rather
   * than unwind.
   */
  history(): readonly Move[] {
    return this.log;
  }

  /** Play a move. Throws exactly where the engine would, so no UI-side rule can hide one. */
  send(move: Move): void {
    const applied = apply(this.gameData, this.state, move);
    if (applied.state.turnPlayer !== this.state.turnPlayer) this.turns += 1;
    this.state = applied.state;
    this.log.push(move);
    this.events.push(...redactEvents(applied.events, YOU));
  }

  /**
   * Let the seat to move decide, if it is not you. One move per call, so the
   * caller controls pacing and the feed stays followable - ticket 09 measured
   * that a narrated turn needs no animation to follow, but it does need to
   * arrive at a human rate.
   */
  stepBot(): boolean {
    const actor = actorOf(this.state);
    if (actor === null || actor === YOU) return false;
    const id = this.policyId(actor);
    const rng = this.rngs.get(actor) ?? policyRng(this.options.seed, actor, id);
    this.rngs.set(actor, rng);
    const moves = legalMoves(this.gameData, this.state);
    if (moves.length === 0) return false;
    const move = makePolicy(id).choose({
      data: this.gameData,
      view: viewFor(this.gameData, this.state, actor),
      moves,
      rng,
      // Ticket 40: the probe closes over the state, so the bots price a card's
      // ability in the browser exactly as they do in the simulator.
      probe: makeProber(this.gameData, this.state, actor),
    });
    this.send(move);
    return true;
  }

  /**
   * Take a bug report or a design note (ticket 31).
   *
   * The whole payload is metadata plus `(seed, move log)`, because ticket 04's
   * contract means that pair replays to a bit-identical state - so nothing here
   * describes what went wrong or dumps a position, and there is no way for the
   * capture to disagree with the game it was taken from.
   *
   * Deliberately callable mid-task. Mid-effect states are exactly where bugs
   * live, and taking a capture applies no move, so a half-answered draw is
   * captured as a half-answered draw: the pending task's type rides in `ui` and
   * the log stops one move short of answering it.
   */
  capture(input: {
    label: CaptureLabel;
    note: string;
    at: string;
    ui?: CaptureUi | null;
  }): Capture {
    return makeCapture({
      label: input.label,
      note: input.note,
      at: input.at,
      origin: 'ui',
      dataFingerprint: this.state.dataFingerprint,
      // The UI never names the neutral decks - the seed deals them - so the
      // setup here is exactly what `deal` passes to newGame, and no more.
      setup: {
        seed: this.options.seed,
        seats: this.options.seats,
        suits: this.options.suits,
      },
      // Seat 0 is you; the rest are labelled with the bot actually playing them,
      // which is what makes "the socialite did something odd" reproducible.
      policies: Array.from({ length: this.options.seats }, (_, seat) =>
        seat === YOU ? 'human' : this.policyId(seat),
      ),
      moves: this.log,
      seat: YOU,
      turn: this.turns,
      appVersion: APP_VERSION,
      overlay: null,
      ui: {
        ...(input.ui ?? { intent: null, picked: [], task: null }),
        task: input.ui?.task ?? this.state.tasks[0]?.t ?? null,
      },
      error: null,
    });
  }

  /**
   * Rewind to just before your last decision, by replaying the log without its
   * tail. No engine feature is needed for this (ticket 04) - but note what it
   * costs: a replayed prefix reproduces the same shuffles, so undoing a draw
   * and drawing again deals the same cards. That is a peek, and it is the
   * reason this is a solo-versus-bots affordance rather than a rule.
   */
  undo(): boolean {
    let cut = -1;
    for (let i = this.log.length - 1; i >= this.floor; i--) {
      if ((this.log[i] as Move).seat === YOU) {
        cut = i;
        break;
      }
    }
    if (cut < 0) return false;
    this.replay(this.log.slice(0, cut));
    return true;
  }

  private replay(moves: readonly Move[]): void {
    const floor = this.floor;
    this.state = this.deal();
    this.log.length = 0;
    this.events = [];
    for (const move of moves) this.send(move);
    this.floor = floor;
  }
}
