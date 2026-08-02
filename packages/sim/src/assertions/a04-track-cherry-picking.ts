import type { Assertion } from './types.js';
import { pct } from '../stats.js';

/**
 * Watch-list 4. A presence assertion, not a level one: the question is whether
 * the top of the Working Week track EXISTS in play at all.
 *
 * The mechanism the design worries about is specific. The visitor does not pay
 * the wage, so an ascending track deters by enriching a rival: rivals take the
 * cheap early spaces and abandon the Worker before the dear ones. If the top
 * space never sells, the track's last space is decoration.
 */
export const trackCherryPicking: Assertion = {
  id: 4,
  title: 'Cherry-picking the track',
  quote:
    'The visitor does not pay the wage, so the ascending track deters by rival-enrichment - ' +
    'rivals take cheap early spaces and abandon the Worker. The £3 space may never sell. ' +
    'Partly a race at 3-4p; at 2p it just degrades -> flatten.',
  source: 'CLAUDE.md playtest watch-list 4, from docs/Unified Visit v14.md section 7',
  shape: "Share of Worker lifetimes whose meeple reaches the track's top paying space.",
  threshold: 'FAIL below 5%',
  taste: false,
  remedy:
    'npm run sim -- --watchlist --sweep=overlays/flat-track.overlay.json   (wages [2,2,2]; ' +
    'the design says "at 2p it just degrades -> flatten")',
  measure({ data, pooled }) {
    const top = new Map(data.workers.roster.map((w) => [w.id as string, w.wages.length]));
    let lifetimes = 0;
    let reachedTop = 0;
    let stillOpen = 0;
    for (const g of pooled.ended) {
      for (const life of g.workerLifetimes) {
        lifetimes += 1;
        if (!life.expired) stillOpen += 1;
        if (life.maxPos >= (top.get(life.worker) ?? Infinity)) reachedTop += 1;
      }
    }
    const value = lifetimes === 0 ? NaN : reachedTop / lifetimes;
    return {
      value,
      headline: `${pct(value)} of ${lifetimes} Worker lifetimes reach the top wage space`,
      detail: [
        `${stillOpen} lifetimes were still on the track when the game ended, and are counted as ` +
          'not having reached it - which is the state of the table, not a rounding choice',
      ],
      verdict: !Number.isFinite(value) ? 'OBSERVE' : value < 0.05 ? 'FAIL' : 'PASS',
    };
  },
};
