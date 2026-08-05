/**
 * The suite, in the order ticket 11 section 8 lists it.
 *
 * Nine assertions carry a threshold and can FAIL; five are OBSERVE, because
 * the design names no number for them and a snapshot of our own first run is
 * not a threshold. That split is not a gap in the work - it is ticket 11
 * section 2 doing its job. Assertion 14 (ticket 56) is live only while the
 * market rule is switched on, and reports OBSERVE otherwise.
 */

import { coinFlood } from './a01-coin-flood.js';
import { generosity } from './a02-generosity.js';
import { bootstrap } from './a03-bootstrap.js';
import { trackCherryPicking } from './a04-track-cherry-picking.js';
import { clogDenial } from './a05-clog-denial.js';
import { barnGlut } from './a06-barn-glut.js';
import { drawWorker } from './a07-draw-worker.js';
import { theHook } from './a08-the-hook.js';
import { wheatIdentity } from './a09-wheat-identity.js';
import { breadHall } from './a10-bread-hall.js';
import { wagonSelfWork } from './a11-wagon-self-work.js';
import { balloonRaid } from './a12-balloon-raid.js';
import { supplyLock } from './a13-supply-lock.js';
import { marketMix } from './a14-market-mix.js';
import type { Assertion } from './types.js';

export const WATCHLIST: readonly Assertion[] = [
  coinFlood,
  generosity,
  bootstrap,
  trackCherryPicking,
  clogDenial,
  barnGlut,
  drawWorker,
  theHook,
  wheatIdentity,
  breadHall,
  wagonSelfWork,
  balloonRaid,
  supplyLock,
  marketMix,
];

export type { Assertion, MeasureContext, Measurement, Verdict } from './types.js';
export { NO_REMEDY } from './types.js';
