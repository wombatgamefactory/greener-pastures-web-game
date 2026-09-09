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
 * ⭐ ONE MORE IS NEW ON 09/09/2026 WITH THE COMMONS: `a18-commons-traffic`. It
 * is not a re-point and not a replacement - `a08-the-hook` keeps every branch it
 * has, because both controls still exercise them - but under
 * `visitCurrency: 'commons'` the boards are ownerless (C1), a08 has no
 * neighbour to count, and the interaction readings have to live somewhere. a18
 * is where, and it ships with NO FAIL CONDITION: the design names no number for
 * any of its lines, and one taken off the first commons run would be a snapshot
 * test.
 *
 * Ids are never reused, so the suite is 2, 4-9, 11-13, 15-18 and the gaps are
 * the tombstones. Six carry a threshold and can FAIL; seven are OBSERVE, because
 * the design names no number for them and a snapshot of our own first run is
 * not a threshold. That split is not a gap in the work - it is ticket 11
 * section 2 doing its job.
 *
 * ⚠️ TWO OF THE FOURTEEN NOW REPORT "NO SUBJECT" UNDER WHICHEVER MODE THEY WERE
 * NOT WRITTEN FOR, and the pattern is deliberate rather than a special case:
 * a08 says so under the commons, a18 says so under both controls, and a04, a05
 * and a15 say so under the commons. A branch is never deleted while a control
 * still exercises it; a mode where a reading has nothing to measure says NO
 * SUBJECT and points at whatever owns the question there.
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
import { commonsTraffic } from './a18-commons-traffic.js';
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
  commonsTraffic,
];

export type { Assertion, MeasureContext, Measurement, Verdict } from './types.js';
export { NO_REMEDY } from './types.js';
export { RETIRED } from './tombstones.js';
export type { Tombstone } from './tombstones.js';
