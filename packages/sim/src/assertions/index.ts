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
 * ⭐ AND ONE MORE IS NEW ON 10/09/2026 WITH THE COMMONS-WITH-COINS ARM:
 * `a19-coin-economy`. It exists because the arm puts a CURRENCY back in a game
 * that deleted one eight days earlier, and every coin economy this project has
 * shipped died of a second faucet or a pity rate - so the whole balance sheet
 * (one mint, two sinks, what is left dead in a wallet) belongs on one page where
 * a third use arriving in a later pass is visible as one. It ships with NO FAIL
 * CONDITION for the same reason a18 does, and it reports NO SUBJECT under every
 * value of `rules.turn.commonsTake` but `'coins'`, which is every mode this
 * project has ever shipped.
 *
 * ⭐ AND ONE MORE IS NEW ON 10/09/2026 WITH THE NOTICE-BOARD VISIT:
 * `a20-board-stall`. It exists because S8 writes a rule - the Notice Board's
 * threshold is `3+`, a MINIMUM to harvest at and never a maximum load - against
 * a failure this suite could not see, and because the rule broke the instrument
 * that used to look at that board. `a04-door-clog` asks "is it FULL", and a `3+`
 * board is never full, so a04 now reads a GENUINE and permanent 0% under this
 * mode. The question S8 was written against is a different one - does a board
 * sit LOADED AND UNCLEARED, and for how long - which needs `isHarvestable` and a
 * run length. It ships with NO FAIL CONDITION for the same reason a18 and a19
 * do, and with one addition: the design names no number here because it ships a
 * paired CONTROL instead (`noticeBoardBlocks: true`), so the reading that
 * decides anything is a delta and not a level.
 *
 * ⭐ AND ONE MORE IS NEW ON 11/09/2026 WITH S17, THE HOST DRAW:
 * `a21-host-draw`. It exists because the rule is a FAUCET and nothing in this
 * suite counted one: `rules.turn.hostDrawOnVisit` pays the owner of a visited
 * Notice Board a card off a deck, which amends S7 (the fee resting on the board
 * was the host's entire payment) so that the host is paid TWICE. ⭐ AND ITS
 * PROVENANCE IS A TABLE RATHER THAN A RUN, which nothing else in this suite can
 * say: Dean played the two-board arm at two players on 11/09/2026, house-ruled
 * it in mid-session, and reported that it "led to a lot of extra cards in play,
 * which relieved the tightness of the game in a useful way". It ships with NO
 * FAIL CONDITION for the same reason a18, a19 and a20 do, and with one addition
 * that matters more than the rest of the page: ⛔ THE SIMULATOR CANNOT MEASURE
 * THE EFFECT DEAN LIKED. The engine's hand limit is an INSTRUMENT bound (C7) and
 * the table plays with none, so the instrument clips exactly the thing the table
 * enjoyed; every hand-size line on that page carries the caveat and the bound
 * together, and no report of the arm may be quoted as evidence about tightness.
 *
 * ⭐ THE SAME PASS RESTORED a08-the-hook, WHICH HAD PRINTED "NO SUBJECT" SINCE
 * 09/09/2026. The boards are owned again and a visit has a HOST again, so the
 * hook's quantity exists; a08 now asks `isNoticeBoardPower` by name rather than
 * falling through to its `'card'` path and reading correctly by luck. a18
 * changed meaning rather than going quiet - it carries the FARM traffic under
 * that mode and the CENTRE traffic under the commons - and a19 reports no
 * subject there and points at a17.
 *
 * Ids are never reused, so the suite is 2, 4-9, 11-13, 15-21 and the gaps are
 * the tombstones. Six carry a threshold and can FAIL; nine are OBSERVE, because
 * the design names no number for them and a snapshot of our own first run is
 * not a threshold. That split is not a gap in the work - it is ticket 11
 * section 2 doing its job.
 *
 * ⚠️ THREE OF THE SEVENTEEN NOW REPORT "NO SUBJECT" UNDER WHICHEVER MODE THEY WERE
 * NOT WRITTEN FOR, and the pattern is deliberate rather than a special case:
 * a08 says so under the commons, a18 says so under both controls, a19 says so
 * everywhere but the coin arm, a20 and a21 say so everywhere but the notice-board
 * visit, and a04, a05 and a15 say so under the commons. A branch is never
 * deleted while a control still exercises it; a mode where a reading has
 * nothing to measure says NO SUBJECT and points at whatever owns the question
 * there.
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
import { coinEconomy } from './a19-coin-economy.js';
import { boardStall } from './a20-board-stall.js';
import { hostDraw } from './a21-host-draw.js';
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
  coinEconomy,
  boardStall,
  hostDraw,
];

export type { Assertion, MeasureContext, Measurement, Verdict } from './types.js';
export { NO_REMEDY } from './types.js';
export { RETIRED } from './tombstones.js';
export type { Tombstone } from './tombstones.js';
