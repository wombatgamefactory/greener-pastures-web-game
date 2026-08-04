/**
 * THROWAWAY - is assertion 1's FAIL under the card buy a LEVEL or a SLOPE?
 *
 * The buy takes the end-of-game pile from £13 to £9 and yet the assertion flips
 * from PASS to FAIL, because it measures per-step GROWTH of the median pile over
 * the last five rounds. A percentage on a smaller base is a bigger percentage,
 * so the two arms' raw tail series decide whether the FAIL is a real climb or an
 * arithmetic one. Prints both, plus the absolute step sizes.
 */

import { BASE_GAME_DATA, loadGameData } from '@gp/data';

import { tailSeries } from './src/assertions/lib.js';
import { REFERENCE } from './src/reference.js';
import { pool, runBalance } from './src/run.js';

const NO_BUY = loadGameData({
  name: 'no-card-buy',
  schemaVersion: 1,
  set: { 'rules.turn.buyCost': null },
});

const ARMS = [
  { label: 'buy £1 (base)', data: BASE_GAME_DATA },
  { label: 'no buy', data: NO_BUY },
];

for (const arm of ARMS) {
  const pooled = pool(
    runBalance(arm.data, { reference: REFERENCE, seed: `${REFERENCE.seed}:coins`, games: 200 }),
  );
  console.log(`\n${arm.label}`);
  for (const slice of pooled.bySeats) {
    const series = tailSeries(slice.ended, 5, (g) => g.coinsByRound);
    const steps = series.slice(1).map((v, i) => v - (series[i] as number));
    console.log(
      `  ${slice.seats}p  median coins ${series.map((v) => v.toFixed(1)).join(' -> ')}` +
        `   absolute steps ${steps.map((v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1))).join(' ')}`,
    );
  }
}
