/**
 * The minimum driver: walk one game with a policy per seat.
 *
 * Deliberately not the harness. Ticket 11 owns metrics, the watch-list
 * assertions, sweeps and worker threads; this is the loop those need, and the
 * loop ticket 28's own tests need to walk games at all.
 *
 * It lives in @gp/sim rather than @gp/bots because it holds a `GameState`, and
 * the whole point of @gp/bots is that nothing in it can.
 *
 * Two things here are load-bearing rather than incidental:
 *
 *   1. **The view is built once per decision.** `viewFor` costs 31us against
 *      `apply`'s 18us (ticket 10's profile), so a policy that called it itself
 *      would blow the 50us decision budget on its own. `views` is returned so a
 *      test can prove the count rather than trust the comment.
 *   2. **Each policy carries its own rng across the game**, seeded from
 *      (game seed, seat, policy id), and never touches `state.rng`.
 */

import type { GameData, Suit } from '@gp/data';
import type { GameEvent, GameState, Move, PlayerView, Seat } from '@gp/engine';
import { apply, isOver, legalMoves, newGame, seedRng, shuffle, viewFor } from '@gp/engine';
import type { Policy, PolicyId } from '@gp/bots';
import { BALANCE_PROFILES, makePolicy, policyRng } from '@gp/bots';

/**
 * One decision, as the metric fold sees it: what the table looked like, what
 * was chosen, what it did, and what the table looked like afterwards.
 *
 * Ticket 11's fold is one pass over exactly this tuple. It rides on the driver
 * rather than in a loop of its own so the games a balance run measures are the
 * same games the bot tests walk - a second loop is a second set of rules.
 */
export interface Decision {
  readonly pre: GameState;
  readonly seat: Seat;
  readonly legal: readonly Move[];
  readonly move: Move;
  readonly events: readonly GameEvent[];
  readonly post: GameState;
}

export type Observer = (decision: Decision) => void;

export interface GameSpec {
  readonly seed: string;
  readonly seats: number;
  readonly suits: readonly Suit[];
  /**
   * The passive decks. Omit and the game's own rng deals them; a balance run
   * names them so its stratified cells are addressable.
   */
  readonly neutralSuits?: readonly Suit[];
  /**
   * One policy per seat, by roster id or as an instance. Instances are how a
   * sweep seats a custom weight table without inventing a roster entry; the rng
   * seed uses the instance's own `id`, so two tables sharing an id share a
   * stream and reproducibility still holds.
   */
  readonly policies: readonly (PolicyId | Policy)[];
  /** Safety valve. A game that hits it is reported unfinished, never thrown. */
  readonly maxMoves?: number;
  /** Called once per decision, in order. The balance run's metric fold. */
  readonly observe?: Observer;
}

/**
 * How a game stopped.
 *
 * `stalled` is not a timeout and not a bug: the card supply is finite (every
 * Build consumes a card permanently and only a delivery ever empties a barn),
 * so a table can drain every deck, discard and hand into buildings and barns.
 * From there no player can draw, build, grow or visit, and if no barn can fill
 * an open tile the island can never finish. Nothing in v14 ends such a game,
 * so the driver names it rather than burning the move budget on `pass`.
 *
 * `crashed` is the engine throwing mid-game. It is NOT swallowed - the error is
 * carried on the result and the balance run prints the count and the messages -
 * but one bad game in several hundred must not take a 90-second run down with
 * it, or the harness cannot report the other 749. A crash rate above zero is a
 * bug report, and the report says so.
 */
export type Outcome = 'ended' | 'stalled' | 'maxMoves' | 'crashed';

export interface GameResult {
  readonly state: GameState;
  readonly moves: readonly Move[];
  readonly outcome: Outcome;
  /** True when the game reached the Level 3 end trigger and played out. */
  readonly ended: boolean;
  readonly decisions: number;
  /** Views built. Equal to `decisions` unless someone adds a second call site. */
  readonly views: number;
  /** Wall time inside `policy.choose` only, in milliseconds. */
  readonly chooseMs: number;
  readonly maxLegalMoves: number;
  /** Set only when `outcome` is 'crashed'. Never null on a crash. */
  readonly error?: string;
}

/** Default ceiling. Ticket 14 measured a 4p median of ~1200 moves post-gate. */
export const DEFAULT_MAX_MOVES = 6000;

/**
 * Seat the balance profiles deterministically from the run seed, so a run is
 * reproducible from (seed, seats, suits, profileSet) alone.
 */
export function assignProfiles(
  seed: string,
  seats: number,
  pool: readonly PolicyId[] = BALANCE_PROFILES,
): PolicyId[] {
  if (pool.length === 0) throw new Error('assignProfiles needs a non-empty pool');
  const rng = seedRng(`${seed}:profiles`);
  const bag = shuffle(rng, [...pool]);
  return Array.from({ length: seats }, (_, i) => bag[i % bag.length] as PolicyId);
}

/** Test seam: the driver's single `viewFor` call site, injectable so a test can count it. */
export type ViewFn = (data: GameData, state: GameState, seat: Seat) => PlayerView;

export function runGame(data: GameData, spec: GameSpec, viewFn: ViewFn = viewFor): GameResult {
  if (spec.policies.length !== spec.seats) {
    throw new Error(`${spec.seats} seats but ${spec.policies.length} policies`);
  }
  const policies: Policy[] = spec.policies.map((p) => (typeof p === 'string' ? makePolicy(p) : p));
  const rngs = policies.map((policy, seat) => policyRng(spec.seed, seat, policy.id));
  const maxMoves = spec.maxMoves ?? DEFAULT_MAX_MOVES;

  let state = newGame(data, {
    seats: spec.seats,
    suits: [...spec.suits],
    ...(spec.neutralSuits ? { neutralSuits: [...spec.neutralSuits] } : {}),
    seed: spec.seed,
  });
  const moves: Move[] = [];
  let views = 0;
  let chooseMs = 0;
  let maxLegalMoves = 0;
  // Consecutive moves that did nothing. `pass` is offered only when no main
  // action at all is legal (reference DL-77), so two full rounds of nothing but
  // pass and endTurn means the table has locked, not that a bot is dithering.
  const idleLimit = spec.seats * 4;
  let idle = 0;
  let crash: string | null = null;

  try {
    while (!isOver(state) && moves.length < maxMoves && idle < idleLimit) {
      const legal = legalMoves(data, state);
      if (legal.length === 0) throw new Error('No legal moves and the game is not over');
      maxLegalMoves = Math.max(maxLegalMoves, legal.length);

      // Every legal move belongs to one seat - the turn player, or the owner of
      // the head task (which may be a rival: cross-player tasks are supported).
      const seat = (legal[0] as Move).seat;
      const policy = policies[seat];
      const rng = rngs[seat];
      if (!policy || !rng) throw new Error(`No policy for seat ${seat}`);

      const view = viewFn(data, state, seat);
      views += 1;

      const started = performance.now();
      const move = policy.choose({ data, view, moves: legal, rng });
      chooseMs += performance.now() - started;

      const applied = apply(data, state, move);
      if (spec.observe) {
        spec.observe({
          pre: state,
          seat,
          legal,
          move,
          events: applied.events,
          post: applied.state,
        });
      }
      state = applied.state;
      moves.push(move);
      idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
    }
  } catch (error) {
    // Deliberately caught and named rather than swallowed. A balance run walks
    // hundreds of games; one engine bug must not cost the report on the other
    // 749, and a crash that vanished into a `stalled` count would be worse than
    // the crash. The message is carried out and printed.
    crash = error instanceof Error ? error.message : String(error);
  }

  const outcome: Outcome =
    crash !== null
      ? 'crashed'
      : isOver(state)
        ? 'ended'
        : idle >= idleLimit
          ? 'stalled'
          : 'maxMoves';

  return {
    state,
    moves,
    outcome,
    ended: outcome === 'ended',
    decisions: moves.length,
    views,
    chooseMs,
    maxLegalMoves,
    ...(crash === null ? {} : { error: crash }),
  };
}
