/**
 * Running the suite, including the mirror diagnostics.
 *
 * The mirrors exist because of ticket 11's first decision: the bots are the
 * subject as well as the instrument, so a result that is really one taste's
 * artefact has to be visible AS a spread rather than hidden inside a pooled
 * median. Three assertions are marked taste-sensitive and re-measure themselves
 * against a hermit, socialite, loyalist and racer table.
 *
 * Ticket 10's control comes with them and must be read as intended: **a hermit
 * mirror SHOULD fail assertion 8.** Four bots with prohibitive visit weight
 * mint nothing and the run correctly reports solitaire. A run where the hermit
 * mirror passes the hook assertion means the assertion has no teeth.
 *
 * Mirrors are diagnostics, not the baseline, so they run at a fraction of the
 * reference `n` and say so in the report. Their numbers never enter a verdict.
 */

import type { GameData } from '@gp/data';
import type { PolicyId } from '@gp/bots';

import { WATCHLIST } from './assertions/index.js';
import type { Assertion, Measurement } from './assertions/index.js';
import type { Pooled, RunOptions } from './run.js';
import { pool, runBalance } from './run.js';

/**
 * The archetypes. `balanced` is not a mirror: it is the reference's own centre.
 *
 * `magpie` joined on 2026-08-12 as the control for the SUIT, the way `hermit` is
 * the control for the visit. It is a mirror rather than a seat in
 * `BALANCE_PROFILES` because mirrors run on their own seeded pool and never
 * enter a verdict, so adding one cannot move the reference.
 */
export const MIRROR_PROFILES: readonly PolicyId[] = [
  'hermit',
  'socialite',
  'loyalist',
  'racer',
  'magpie',
];

export interface WatchlistRow {
  readonly assertion: Assertion;
  readonly measurement: Measurement;
  /** Taste-sensitive assertions only: the same measurement under each mirror. */
  readonly mirrors?: ReadonlyMap<PolicyId, number>;
}

export function runWatchlist(
  data: GameData,
  pooled: Pooled,
  mirrors: ReadonlyMap<PolicyId, Pooled>,
): WatchlistRow[] {
  return WATCHLIST.map((assertion) => {
    const measurement = assertion.measure({ data, pooled });
    if (!assertion.taste || mirrors.size === 0) return { assertion, measurement };
    const spread = new Map<PolicyId, number>();
    for (const [profile, mirrorPool] of mirrors) {
      spread.set(profile, assertion.measure({ data, pooled: mirrorPool }).value);
    }
    return { assertion, measurement, mirrors: spread };
  });
}

/** One mirror pool per archetype, at the reduced `games` count. */
export async function runMirrors(
  data: GameData,
  opts: RunOptions,
  games: number,
): Promise<Map<PolicyId, Pooled>> {
  const out = new Map<PolicyId, Pooled>();
  if (games <= 0) return out;
  for (const profile of MIRROR_PROFILES) {
    const result = await runBalance(data, {
      ...opts,
      reference: { ...opts.reference, pool: [profile] },
      seed: `${opts.seed ?? opts.reference.seed}:mirror:${profile}`,
      games,
      onGame: undefined,
    });
    out.set(profile, pool(result));
  }
  return out;
}

export function failures(rows: readonly WatchlistRow[]): WatchlistRow[] {
  return rows.filter((r) => r.measurement.verdict === 'FAIL');
}
