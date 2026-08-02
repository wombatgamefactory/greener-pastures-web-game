import type { Assertion } from './types.js';
import { pct } from '../stats.js';

/**
 * Watch-list 7. The Draw Worker is meant to be the traffic magnet - "exactly
 * the scene we want: everyone tramping to one farm" - so a share above an even
 * fifth is the design working, not failing. What is being tested is the far
 * end: charming, not oppressive.
 *
 * The dial matters as much as the number. The Draw Worker is the only Worker
 * that refunds its own fee, so it has no natural brake, and the design is
 * explicit that its brake is TRACK LENGTH and never the card text. The remedy
 * overlay lengthens the track and touches nothing else.
 */
export const drawWorker: Assertion = {
  id: 7,
  title: 'The Draw Worker',
  quote:
    'Cheapest Worker to visit (pays its own fee) -> most rentals -> its owner earns the most ' +
    "wages. Should produce exactly the scene we want: everyone tramping to one farm. Check it's " +
    'charming, not oppressive. The dial is track length, never the card text.',
  source: 'docs/Unified Visit v14.md section 7.5, and CLAUDE.md watch-list 7',
  shape: "The Draw Worker's share of all rival Worker uses, against an even 20%.",
  threshold: 'FAIL above 35%',
  taste: false,
  remedy:
    'npm run sim -- --watchlist --sweep=overlays/draw-track-long.overlay.json   (track [1,2,3], ' +
    'lengthening the Working Week; the card text is untouched)',
  measure({ pooled }) {
    const uses = new Map<string, number>();
    for (const g of pooled.ended) {
      for (const [worker, n] of Object.entries(g.rivalUsesByWorker)) {
        uses.set(worker, (uses.get(worker) ?? 0) + n);
      }
    }
    const total = [...uses.values()].reduce((a, b) => a + b, 0);
    const draw = uses.get('draw') ?? 0;
    const value = total === 0 ? NaN : draw / total;
    const breakdown = [...uses.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([w, n]) => `${w} ${pct(total === 0 ? NaN : n / total, 0)}`)
      .join('  ');
    return {
      value,
      headline: `Draw Worker takes ${pct(value)} of ${total} rival Worker uses (even share 20%)`,
      detail: [`all Workers: ${breakdown || '(none)'}`],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value > 0.35 ? 'FAIL' : 'PASS',
    };
  },
};
