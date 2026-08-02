/**
 * `--explain`: the per-term breakdown behind one bot decision.
 *
 * An unexplainable bot cannot be debugged when a balance number looks wrong,
 * and hand-tuned weights that nobody can argue with are folklore. This plays a
 * seeded game forward to a chosen decision and prints what every term
 * contributed to every move on offer.
 */

import type { GameData, Suit } from '@gp/data';
import type { Move } from '@gp/engine';
import { apply, isOver, legalMoves, newGame, viewFor } from '@gp/engine';
import type { PolicyId } from '@gp/bots';
import { makePolicy, policyRng } from '@gp/bots';

export interface ExplainOptions {
  seed: string;
  seats: number;
  suits: readonly Suit[];
  policy: PolicyId;
  /** Which decision to explain. Negative counts back from the last one played. */
  at: number;
  /** Moves listed, best first. */
  top: number;
}

function describeMove(move: Move): string {
  const { type, seat, ...rest } = move;
  return `${type} (seat ${seat}) ${JSON.stringify(rest)}`;
}

export function explainReport(data: GameData, opts: ExplainOptions): string {
  const policy = makePolicy(opts.policy);
  if (!policy.explain) {
    return `${opts.policy} has no explain: only the scored evaluator keeps a term breakdown.\n`;
  }
  const rngs = Array.from({ length: opts.seats }, (_, seat) =>
    policyRng(opts.seed, seat, policy.id),
  );

  let state = newGame(data, { seats: opts.seats, suits: [...opts.suits], seed: opts.seed });
  const frames: { state: typeof state; moves: Move[] }[] = [];

  // Play forward, keeping the states so a negative `at` can look backwards.
  for (let step = 0; step < 4000 && !isOver(state); step++) {
    const moves = legalMoves(data, state);
    if (moves.length === 0) break;
    frames.push({ state, moves });
    const seat = (moves[0] as Move).seat;
    const rng = rngs[seat];
    if (!rng) throw new Error(`no rng for seat ${seat}`);
    const view = viewFor(data, state, seat);
    state = apply(data, state, policy.choose({ data, view, moves, rng })).state;
  }

  if (frames.length === 0) return 'No decisions to explain.\n';
  const index =
    opts.at < 0 ? Math.max(0, frames.length + opts.at) : Math.min(opts.at, frames.length - 1);
  const frame = frames[index];
  if (!frame) return 'No decisions to explain.\n';

  const seat = (frame.moves[0] as Move).seat;
  const view = viewFor(data, frame.state, seat);
  const rows = policy
    .explain({ data, view, moves: frame.moves, rng: policyRng(opts.seed, seat, policy.id) })
    .slice(0, opts.top);

  const lines = [
    `${policy.id} - decision ${index + 1} of ${frames.length}, seat ${seat} (${view.you.suit})`,
    `hand ${view.you.hand.length}, coins ${view.you.coins}, ` +
      `receipts [${view.you.receipts.join(', ')}], ${frame.moves.length} legal moves`,
    '',
  ];
  for (const row of rows) {
    const terms = Object.entries(row.terms)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([name, value]) => `${name} ${value > 0 ? '+' : ''}${value.toFixed(2)}`)
      .join('  ');
    lines.push(`${row.total.toFixed(2).padStart(8)}  ${describeMove(row.move)}`);
    lines.push(`          ${terms || '(no term fired)'}`);
  }
  return `${lines.join('\n')}\n`;
}
