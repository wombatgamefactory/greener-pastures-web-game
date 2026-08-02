import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { pct } from '../stats.js';

/**
 * Added by ticket 10 and sharpened by ticket 28, which found that 40-60% of
 * undirected games LOCK THE TABLE: deck, discard and hand all empty, the whole
 * card supply nailed into buildings and barns, and nothing in v14 ends such a
 * game.
 *
 * This is deliberately OBSERVE and deliberately not a verdict. It feeds
 * [34 - The card-supply lock](34-card-supply-lock.md), which owns the ruling.
 * Ticket 11 does not wait for 34 and 34 is not pre-empted here: the rate is
 * reported honestly and the rule is decided elsewhere.
 *
 * Consequence worth reading with it: this number is also the size of the
 * survivorship bias on every ended-only mean in the report, which is why the
 * four bias-exposed series carry an all-games control column.
 */
export const supplyLock: Assertion = {
  id: 13,
  title: 'Supply lock rate',
  quote:
    'The card supply is finite - every Build consumes a card permanently and only a delivery ' +
    'ever empties a barn - so a table can drain every deck, discard and hand into buildings and ' +
    'barns. Nothing in v14 ends such a game.',
  source: "ticket 28, and the driver's own `stalled` outcome",
  shape: 'Share of games that stall, by seat count.',
  threshold: 'OBSERVE -> ticket 34 owns the ruling',
  taste: false,
  remedy: NO_REMEDY,
  measure({ pooled }) {
    const rows = pooled.bySeats.map((s) => {
      const stalled = s.all.filter((g) => g.outcome === 'stalled').length;
      const capped = s.all.filter((g) => g.outcome === 'maxMoves').length;
      const crashed = s.all.filter((g) => g.outcome === 'crashed').length;
      return {
        seats: s.seats,
        n: s.all.length,
        stalled,
        capped,
        crashed,
        rate: s.all.length === 0 ? NaN : stalled / s.all.length,
      };
    });
    const worst = Math.max(...rows.map((r) => r.rate));
    const crashes = pooled.all.filter((g) => g.outcome === 'crashed');
    const messages = [...new Set(crashes.map((g) => g.error ?? 'unknown'))];
    return {
      value: worst,
      headline: rows
        .map(
          (r) =>
            `${r.seats}p ${pct(r.rate)} locked (${r.stalled} locked, ${r.capped} capped, ` +
            `${r.crashed} crashed, of ${r.n})`,
        )
        .join('  '),
      detail: [
        'The lock rate is also the size of the survivorship bias on every ended-only mean below.',
        // A crash is an engine bug, not a supply lock, and must never hide
        // inside this number - so it is counted apart and named.
        crashes.length === 0
          ? 'No game crashed.'
          : `ENGINE CRASHES: ${crashes.length} game(s) threw and were excluded. ` +
            `Distinct errors: ${messages.map((m) => `"${m}"`).join('; ')}`,
      ],
      verdict: 'OBSERVE',
    };
  },
};
