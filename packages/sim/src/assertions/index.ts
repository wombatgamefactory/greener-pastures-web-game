/**
 * The suite, in id order.
 *
 * ⭐ RE-CUT FOR v31 (02/09/2026). Four assertions were RETIRED because their
 * subject no longer exists - `a01-coin-flood`, `a03-bootstrap`,
 * `a10-bread-hall` and `a14-market-mix`, all four of which measured something
 * denominated in a currency the game no longer has. They are not deleted:
 * `tombstones.ts` keeps what each one measured, what it last read and why the
 * subject is gone, and the report prints that list under the watch list so a
 * reader who remembers assertion 1 can see what happened to it.
 *
 * Three assertions are NEW and come straight out of the plan's part 4:
 * `a15-meeple-economy` (a meeple nobody spends is a dead component),
 * `a16-action-inflation` (the number the whole pass moves, which nothing
 * measured) and `a17-bonus-mix` (the four-way tally, with self-visits counted
 * apart).
 *
 * Ids are never reused, so the suite is 2, 4-9, 11-13, 15-17 and the gaps are
 * the tombstones. Six carry a threshold and can FAIL; six are OBSERVE, because
 * the design names no number for them and a snapshot of our own first run is
 * not a threshold. That split is not a gap in the work - it is ticket 11
 * section 2 doing its job.
 */

import { generosity } from './a02-generosity.js';
import { doorClog } from './a04-door-clog.js';
import { clogDenial } from './a05-clog-denial.js';
import { barnGlut } from './a06-barn-glut.js';
import { doorMix } from './a07-door-mix.js';
import { theHook } from './a08-the-hook.js';
import { wheatIdentity } from './a09-wheat-identity.js';
import { dairyNoBuild } from './a11-dairy-no-build.js';
import { balloonRaid } from './a12-balloon-raid.js';
import { supplyLock } from './a13-supply-lock.js';
import { meepleEconomy } from './a15-meeple-economy.js';
import { actionInflation } from './a16-action-inflation.js';
import { bonusMix } from './a17-bonus-mix.js';
import type { Assertion } from './types.js';

export const WATCHLIST: readonly Assertion[] = [
  generosity,
  doorClog,
  clogDenial,
  barnGlut,
  doorMix,
  theHook,
  wheatIdentity,
  dairyNoBuild,
  balloonRaid,
  supplyLock,
  meepleEconomy,
  actionInflation,
  bonusMix,
];

export type { Assertion, MeasureContext, Measurement, Verdict } from './types.js';
export { NO_REMEDY } from './types.js';
export { RETIRED } from './tombstones.js';
export type { Tombstone } from './tombstones.js';
