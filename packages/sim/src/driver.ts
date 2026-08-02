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
import type { GameState, Move, PlayerView, Seat } from '@gp/engine';
import { apply, isOver, legalMoves, newGame, seedRng, shuffle, viewFor } from '@gp/engine';
import type { Policy, PolicyId } from '@gp/bots';
import { BALANCE_PROFILES, makePolicy, policyRng } from '@gp/bots';

export interface GameSpec {
  readonly seed: string;
  readonly seats: number;
  readonly suits: readonly Suit[];
  /**
   * One policy per seat, by roster id or as an instance. Instances are how a
   * sweep seats a custom weight table without inventing a roster entry; the rng
   * seed uses the instance's own `id`, so two tables sharing an id share a
   * stream and reproducibility still holds.
   */
  readonly policies: readonly (PolicyId | Policy)[];
  /** Safety valve. A game that hits it is reported unfinished, never thrown. */
  readonly maxMoves?: number;
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
 */
export type Outcome = 'ended' | 'stalled' | 'maxMoves';

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

  let state = newGame(data, { seats: spec.seats, suits: [...spec.suits], seed: spec.seed });
  const moves: Move[] = [];
  let views = 0;
  let chooseMs = 0;
  let maxLegalMoves = 0;
  // Consecutive moves that did nothing. `pass` is offered only when no main
  // action at all is legal (reference DL-77), so two full rounds of nothing but
  // pass and endTurn means the table has locked, not that a bot is dithering.
  const idleLimit = spec.seats * 4;
  let idle = 0;

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

    state = apply(data, state, move).state;
    moves.push(move);
    idle = move.type === 'pass' || move.type === 'endTurn' ? idle + 1 : 0;
  }

  const outcome: Outcome = isOver(state) ? 'ended' : idle >= idleLimit ? 'stalled' : 'maxMoves';

  return {
    state,
    moves,
    outcome,
    ended: isOver(state),
    decisions: moves.length,
    views,
    chooseMs,
    maxLegalMoves,
  };
}
