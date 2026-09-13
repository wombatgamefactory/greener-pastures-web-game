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
 * ⭐ ONE MORE IS NEW ON 09/09/2026: `a18-commons-traffic`, the interaction
 * readings (the commons it was written for was deleted on 13/09/2026, and a18
 * now carries the farm traffic under the notice-board visit). It ships with NO
 * FAIL CONDITION: the design names no number for any of its lines.
 *
 * `a19-coin-economy` was DELETED on 13/09/2026 with the commons-with-coins arm
 * it measured; under every surviving mode it printed NO SUBJECT. Its id is not
 * reused.
 *
 * ⭐ AND ONE MORE IS NEW ON 10/09/2026 WITH THE NOTICE-BOARD VISIT:
 * `a20-board-stall`. It exists because S8 writes a rule - the Notice Board's
 * threshold is `3+`, a MINIMUM to harvest at and never a maximum load - against
 * a failure this suite could not see, and because the rule broke the instrument
 * that used to look at that board. `a04-door-clog` asks "is it FULL", and a `3+`
 * board is never full, so a04 now reads a GENUINE and permanent 0% under this
 * mode. The question S8 was written against is a different one - does a board
 * sit LOADED AND UNCLEARED, and for how long - which needs `isHarvestable` and a
 * run length. It ships with NO FAIL CONDITION for the same reason a18
 * does, and with one addition: the design names no number here because it ships a
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
 * FAIL CONDITION for the same reason a18 and a20 do, and with one addition
 * that matters more than the rest of the page: ⛔ THE SIMULATOR CANNOT MEASURE
 * THE EFFECT DEAN LIKED. The engine's hand limit is an INSTRUMENT bound (C7) and
 * the table plays with none, so the instrument clips exactly the thing the table
 * enjoyed; every hand-size line on that page carries the caveat and the bound
 * together, and no report of the arm may be quoted as evidence about tightness.
 *
 * ⭐ AND ONE MORE IS NEW ON 12/09/2026 FOR LEDGER ROW C114:
 * `a22-crop-diagnosis`. It is the odd one out of the suite in two ways worth
 * knowing. First, it measures NOTHING ABOUT A NEW RULE: both of its readings
 * were OWED FROM BEFORE the Village Store coin (A150) and the delivery meeple
 * (A151) were drafted, and they exist to test whether that coin is aimed at the
 * right fault at all. Orchard wins 17.4% against Wheat's 41.9% on an even 36.2%
 * and it is not the Orchard cards; the standing diagnosis is a LIQUIDITY one,
 * and it has a hole in it. ⛔ Nobody has measured whether a crop's deliveries
 * are FIRST to a tile (6 VP) or SECOND (3 VP) - table-wide the split is 62.5% /
 * 37.5% and it has never been broken down - so if Orchard's harvest-and-clear
 * loop makes it arrive second more often, the island is where it loses and the
 * coin is pointed at the wrong thing. And hand size by crop is the one link in
 * the liquidity chain that is inferred rather than measured. Second, it is the
 * only assertion in the suite with NO MODE GATE: every currency this codebase
 * has delivers to an island and deals a hand, so it never reports NO SUBJECT.
 * It ships with NO FAIL CONDITION for the same reason a18, a20 and a21 do,
 * and ⛔ every line of its hand half carries the C7 caveat ON THE LINE: the
 * engine's hand limit is the SIMULATOR'S bound and the table plays with none.
 *
 * ⭐ AND TWO MORE ARE NEW ON 12/09/2026 WITH THE VILLAGE STORE PASS, and they
 * are deliberately TWO rather than one because they are two different
 * questions: `a23-delivery-meeple` asks whether a COMPONENT earns its place and
 * `a24-deck-circulation` asks whether a RULE lubricates the deck. They share no
 * counter, they have opposite mode gates, and they have different lifetimes -
 * a23 dies with the meeple if Dean drops it, where a24 outlives every rule in
 * this pass. Folding them into one page would put a component decision and a
 * hypothesis test behind one headline.
 *
 * `a23-delivery-meeple` (M1 to M8, ledger A151) is the delivery meeple's own
 * page: minted, spent and STRANDED at game end, the colour mix of the spends and
 * of the stranded, and what the spends actually bought read OFF THE EVENT (M6
 * and M7 mean the action and the colour stopped agreeing). ⛔ Its stranded count
 * is D8 arriving as a number - a meeple's plain action is subject to the
 * standing rule that an illegal action is not offered, so a meeple CAN be
 * undiscardable, and a high stranded share is the rule working as ruled AND the
 * component not earning its place at once. ⚠️ It reads the same counters as a15,
 * which is NOT gated away under `'noticeBoardPower'` and applies its `'card'`
 * floor to them; that floor was written for the v31 island meeple and has not
 * been ruled onto this component, so a15 carries the verdict, a23 carries the
 * diagnosis, and the two are never two findings.
 *
 * `a24-deck-circulation` (ledger A150) is Dean's circulation argument as a
 * falsifiable prediction, and it is the cleanest one in the pass: barn-locked
 * cards are cards out of the pool, played decks reshuffle 7 / 6 / 4 times a game
 * at 2p / 3p / 4p, and ⛔ IF THE STORE WORKS THAT NUMBER FALLS. Reshuffles are
 * roughly draws over pool and a stranded card is a card out of the pool, so a
 * Store that returns cards makes the pool bigger and the reshuffles fewer. It
 * prints both terms of that ratio beside the headline, because reshuffles
 * falling because the game got shorter is a different fact from reshuffles
 * falling because the pool grew. ⭐ It is the second assertion in the suite with
 * NO MODE GATE, after a22.
 *
 * ⭐ AND THREE MORE JOINED ON 12/09/2026 WITH THE VILLAGE STORE COIN (V1 to
 * V12, ledger row A150), and THREE rather than one because they are three
 * questions with three different lifetimes, on the a23/a24 precedent set the
 * same day.
 *
 * `a25-village-store-coin` is the BALANCE SHEET, in the register a21 uses: one mint (barn cards converted at a delivery), one shared recirculating
 * supply and how often it holds nothing, and TWO sinks split by name - coins on
 * a build (V6/V7) and coin-GROWS split from card-Grows (V8) with ⛔ the ones
 * that fired on a FULL building (V9) on their own line, because V9 is the
 * strongest single clause in the package and is the first clog bypass in this
 * game since the meeples. It exists as a page because every coin economy this
 * project has shipped died of a second faucet or a pity rate, and O17 The Fruit
 * Basket had already opened one loop before the rule was a day old. The Store's
 * events are read off `board === 'store'` and off `on` being `'build'` or
 * `'grow'`.
 *
 * `a26-store-conversion` is LEDGER ROW C113 and it is the single most important
 * line in the pass: ⛔ DOES EVERY PLAYER CONVERT EVERY SPARE CARD EVERY TIME?
 * `docs/village-store-2026-08-19-v1.md` section 1 ruled this exact rider-on-
 * Deliver placement out in August ("no cost, so it is always correct, breaks
 * everything"), Dean's answer of 12/09/2026 is that a valid delivery is a
 * precondition and the capped shared supply bounds the reward, and ⛔ THE
 * OBJECTION SURVIVES AS A TEST. It prints three shares - windows that converted
 * at all, convertible cards actually converted, and windows that took ALL of
 * them - and near-100% on all three is the August verdict confirmed, with the
 * PLACEMENT rather than the price being what to change. ⚠️ Its own header says
 * what it cannot do: a bot that always takes a free thing is not proof a human
 * would, so the reading is a CEILING on how automatic the decision is and not a
 * measurement of its weight. It is a separate page from a25 because its subject
 * is a PLACEMENT rather than a currency, and it dies if the exchange moves while
 * a25 lives on.
 *
 * `a27-coin-hand` is the one the handoff DOES NOT ASK FOR: the build discovered
 * it. A coin sink PAYS NO CARD, so cards stop leaving the hand - worst hand 11
 * under the control against 15 under `grow-only` at the bench, driving the
 * end-of-turn discard enumeration to C(15,8) = 6,435 legal moves against 789.
 * ⭐ IT IS THE SAME SHAPE THAT BROKE THE PROJECT ON 02/09/2026, when deleting
 * the hand limit produced a 116,535-move position and 91-second games. ⛔ And
 * the instrument UNDERSTATES it: the engine's `handLimit` is the SIMULATOR'S
 * bound (C7) and the table plays with none, so every line is a FLOOR and every
 * line says so. ⚠️ It reads the same four hand counters as a21 and a22 and the
 * three are never three findings - a21 carries the CONTROL's hand, a22 splits
 * them by crop, and this page asks what a cardless sink does.
 *
 * ⭐ THE SAME PASS RESTORED a08-the-hook, WHICH HAD PRINTED "NO SUBJECT" SINCE
 * 09/09/2026. The boards are owned again and a visit has a HOST again, so the
 * hook's quantity exists; a08 now asks `isNoticeBoardPower` by name rather than
 * falling through to its `'card'` path and reading correctly by luck. a18
 * changed meaning rather than going quiet - it carries the FARM traffic under
 * that mode.
 *
 * Ids are never reused, so the suite is 2, 4-9, 11-13, 15-18, 20-27 and the gaps
 * are the tombstones and a19. Six carry a threshold and can FAIL; fourteen are
 * OBSERVE, because
 * the design names no number for them and a snapshot of our own first run is
 * not a threshold. That split is not a gap in the work - it is ticket 11
 * section 2 doing its job.
 *
 * ⚠️ SEVERAL OF THE TWENTY-TWO REPORT "NO SUBJECT" UNDER WHICHEVER MODE THEY
 * WERE NOT WRITTEN FOR, and the pattern is deliberate rather than a special
 * case: a18 says so under both controls, a20 and a21 say so everywhere but the
 * notice-board visit, and a25, a26 and a27 say so everywhere but a Village
 * Store arm. A branch is never
 * deleted while a control still exercises it; a mode where a reading has
 * nothing to measure says NO SUBJECT and points at whatever owns the question
 * there. ⭐ a22 IS THE ONE THAT NEVER DOES, and it is the only one: every
 * currency this codebase has delivers to an island and deals a hand, so its two
 * readings have a subject under all of them.
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
import { boardStall } from './a20-board-stall.js';
import { hostDraw } from './a21-host-draw.js';
import { cropDiagnosis } from './a22-crop-diagnosis.js';
import { deliveryMeeple } from './a23-delivery-meeple.js';
import { deckCirculation } from './a24-deck-circulation.js';
import { villageStoreCoin } from './a25-village-store-coin.js';
import { storeConversion } from './a26-store-conversion.js';
import { coinHand } from './a27-coin-hand.js';
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
  boardStall,
  hostDraw,
  cropDiagnosis,
  deliveryMeeple,
  deckCirculation,
  villageStoreCoin,
  storeConversion,
  coinHand,
];

export type { Assertion, MeasureContext, Measurement, Verdict } from './types.js';
export { NO_REMEDY } from './types.js';
export { RETIRED } from './tombstones.js';
export type { Tombstone } from './tombstones.js';
