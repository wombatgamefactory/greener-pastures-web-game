/**
 * The report. Ticket 35's own warning, kept at the top of the file it applies
 * to: **the report is the deliverable, not the code. A wall of numbers is not a
 * verdict.**
 *
 * So the shape is: verdict first, evidence second, raw table last. A PASS is
 * one line. A FAIL is the only thing that gets to be long, and it prints
 * everything needed to act - measured against threshold, the design's own
 * words, the mirror spread if the number is taste-sensitive, and the exact
 * command that tests the design's own prescribed response.
 *
 * Every header names `reference-v1`, the seed and `n`, because ticket 11's
 * first decision makes every number in here meaningless without them.
 */

import type { GameData, Suit } from '@gp/data';
import {
  BASE_GAME_DATA,
  hostDrawOnVisit,
  isMeepleCurrency,
  isNoticeBoardPower,
  noticeBoardBlocks,
  noticeBoardsPerSeat,
} from '@gp/data';
import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';
import { LADDER, POLICY_IDS } from '@gp/bots';

import { deckSizes } from './assertions/a24-deck-circulation.js';
import { cutList, funnel } from './cutlist.js';
import type { CutRow, FunnelRow } from './cutlist.js';
import type { GameMetrics } from './observe.js';
import { RETIRED } from './assertions/index.js';
import { NOISE_FLOOR, REFERENCE } from './reference.js';
import type { Pooled, RunResult } from './run.js';
import { mean, median, num, pct, proportion, separated, sum } from './stats.js';
import type { WatchlistRow } from './watchlist.js';
import { MIRROR_PROFILES } from './watchlist.js';

const RULE = '='.repeat(96);
const THIN = '-'.repeat(96);

export interface ReportInput {
  readonly data: GameData;
  readonly result: RunResult;
  readonly pooled: Pooled;
  readonly rows: readonly WatchlistRow[];
  readonly mirrorGames: number;
  readonly overlayName: string | null;
  /** Full funnel table, which is 105 rows. Off by default; the cut list is the point. */
  readonly fullFunnel: boolean;
}

export function renderReport(input: ReportInput): string {
  const out: string[] = [];
  out.push(...header(input));
  out.push(...watchlistSection(input));
  out.push(...seriesSection(input));
  out.push(...giveawaySection(input));
  out.push(...freightSection(input));
  out.push(...dairySection(input));
  out.push(...apiarySection(input));
  out.push(...actionMix(input));
  out.push(...seatTable(input));
  out.push(...suitTable(input));
  out.push(...botTable(input));
  out.push(...cutListSection(input));
  if (input.fullFunnel) out.push(...funnelSection(input));
  return `${out.join('\n')}\n`;
}

/**
 * ⭐ THE HAND-LIMIT SENTENCE, PRINTED IN EVERY HEADER SINCE 09/09/2026 (C7).
 *
 * **The table plays with NO hand limit and found that positive.** The engine
 * keeps 7 anyway, because the simulator cannot enumerate an unbounded hand: the
 * end-of-turn discard is `subsets(hand, excess)`, and `reference-v14` measured a
 * single 4-seat position at **888,030 legal moves** on a hand of 27 choosing
 * which 20 to throw. So the number is an INSTRUMENT BOUND and not a rule of the
 * game, and it goes in the header rather than in a footnote because a reader who
 * takes a hand-size reading off this report and quotes it at a table is quoting
 * the simulator's constraint back at the design.
 *
 * ⚠️ It prints under every mode, not only the commons, and it names the
 * value it actually finds rather than a hard-coded 7 - the hand-limit overlays
 * (`overlays/hand-limit-*.overlay.json`) are still meaningful and still run.
 * `null` is the no-limit tree, which is the table's own rule and is unrunnable at
 * reference scale; the header says so rather than printing a blank.
 */
function handLimitNote(limit: number | null): string {
  return limit === null
    ? 'hand limit  NONE - the no-limit tree, which is the rule the TABLE plays by. It is ' +
        'unrunnable at reference\n            scale (see rules.turn.handLimit and the 888,030-move ' +
        'position reference-v14 measured).'
    : `hand limit  ${limit}, AND IT IS THE SIMULATOR'S BOUND RATHER THAN A RULE OF THE GAME ` +
        `(C7, 09/09/2026).\n            The table plays with NO hand limit and found that ` +
        `positive; the engine keeps ${limit} only because an\n            unbounded hand cannot be ` +
        `enumerated. ANY READING ABOUT HAND SIZE BELOW IS A READING\n            ABOUT THE ` +
        `INSTRUMENT, not about the design.`;
}

function header({ result, pooled, overlayName, mirrorGames }: ReportInput): string[] {
  const { reference, plan, games, wallMs } = result;
  const perSeat = pooled.bySeats
    .map(
      (s) =>
        `${s.seats}p ${s.all.length} in ${plan.cells.filter((c) => c.cell.seats === s.seats).length} cells`,
    )
    .join(', ');
  return [
    RULE,
    'Greener Pastures - balance report',
    RULE,
    `reference   ${reference.id}  -  ${reference.description}`,
    `seed        ${result.seed}`,
    `data        ${result.data.cards.meta.sourceSha256 ?? 'unknown'}   overlay: ${overlayName ?? 'none (base)'}`,
    `games       ${games.length} (${perSeat})`,
    `mirrors     ${mirrorGames > 0 ? `${MIRROR_PROFILES.join(', ')} at ${mirrorGames} games per seat count` : 'not run'}`,
    `wall        ${(wallMs / 1000).toFixed(1)}s   (${num(games.length / (wallMs / 1000), 2)} games/s on ` +
      `${result.workers === 1 ? '1 thread, inline' : `${result.workers} threads`})`,
    ...costNote(games.length / (wallMs / 1000), mirrorGames, result.workers),
    `engine      ${ENGINE_VERSION}, rules ${RULES_EDITION}, ${result.data.cards.catalogue.length} cards, ${POLICY_IDS.length} bots`,
    handLimitNote(result.data.rules.turn.handLimit),
    '',
    'Every number below is defined against this reference and is meaningless without it.',
    ...boundaryBanner(reference.id, result.data, overlayName ?? null),
    ...crashBanner(pooled),
    '',
  ];
}

/**
 * ⛔ THE INCOMPARABILITY BANNER, printed at the TOP where it cannot be missed
 * rather than in a footnote, because the failure mode it guards against is a
 * reader opening this file beside an older one and diffing two numbers that
 * were never measuring the same game.
 *
 * ⭐ IT MOVED TO reference-v15 ON 09/09/2026, and the file's own instruction is
 * why: "it fires on reference-v10 and only on v10 - when v11 is cut, this block
 * moves with it or goes, because a permanent banner is a banner nobody reads."
 * It was left pointing at v10 through v11, v12, v13 and v14, which meant four
 * re-cuts shipped with no banner at all. It fires on the CURRENT reference and
 * on nothing else; when v16 is cut it moves again or it goes.
 */
function boundaryBanner(id: string, data: GameData, overlayName: string | null): string[] {
  // ⭐ THE ARM BANNERS RIDE WITH THE REFERENCE BANNER, NEVER INSTEAD OF IT
  // (10/09/2026), and are appended rather than chosen between.
  // ⭐ AND S17, THE HOST DRAW, RIDES WITH ALL THREE ON THE SAME TERMS AGAIN
  // (11/09/2026). It is ONE LEAF on top of the two-board arm
  // (`rules.turn.hostDrawOnVisit`), so it is appended after that banner rather
  // than replacing it: the arm banner says what the notice-board visit is, the
  // two-board banner says what a seat lays out, and this one says what a host is
  // paid. It is PAIRED against
  // `overlays/notice-board-visit-two-boards-v1.overlay.json` on identical seeds.
  // ⭐ AND SINCE 13/09/2026 THE NOTICE BOARD VISIT IS THE SHIPPED GAME, so a run
  // whose Notice Board leaves all sit at their shipped values prints the short
  // shipped-game banner instead of claiming to be an arm. The arm banners print
  // only when at least one of those leaves has been moved.
  if (id !== 'reference-v10') {
    if (!isNoticeBoardPower(data)) return [];
    const off = visitLeavesOffShipped(data);
    if (off.length === 0) return shippedGameBanner(id, data, overlayName);
    return [
      ...noticeBoardArmBanner(id, data, overlayName, off),
      ...twoBoardArmBanner(id, data, overlayName),
      ...hostDrawArmBanner(id, data, overlayName),
    ];
  }
  return [
    '',
    '*** reference-v10: NO NUMBER IN ANY EARLIER REPORT IN reports/ IS COMPARABLE WITH THIS ONE. ***',
    '',
    '    v31 (02/09/2026) deletes the CURRENCY. Coins, the visit wage, the GBP 2 starter',
    '    upgrades and all fifteen upgraded faces, the market, the card buy, the coin tie-break',
    '    and the coin half of thirty Power and Endgame cards are all gone. The plain Draw is',
    '    2-keep-2, the bonus slot offers a free Draw 1 or a card on ANY Notice Board INCLUDING',
    '    YOUR OWN, and the island pays a MEEPLE - a stored free action that leaves the game when',
    '    spent.',
    '',
    '    The HAND LIMIT was deleted too and came back the same day as one global',
    '    rules.turn.handLimit of 12, checked at the turn boundary, after the first run of this',
    '    instrument measured what the deletion cost: hands to 34 cards, 43,879 legal moves in a',
    '    single position, and 91.5 seconds a game against reference-v9s 0.1. The only numbers',
    '    ever taken in the no-limit tree are the five -REDUCED reports of 02/09/2026, 8 games',
    '    each; every n=1580 run under this reference is the limit-12 game.',
    '',
    '    So the rules, the cards, the bots and the metric set all moved at once. Four watch-list',
    '    assertions were retired because their subject no longer exists (listed below the suite)',
    '    and three were written. Every report before 02/09/2026 measured a different game: a',
    '    suit win rate, a per-card economic, a headline metric and an assertion value are all',
    '    incomparable across this line. The sampling plan is the ONE thing held still.',
    '',
    '    THE NOISE FLOOR HAS NOT BEEN RE-MEASURED FOR THIS INSTRUMENT unless the footer below',
    '    says otherwise, and the v9 floor was NOT carried over - three of its eleven metrics no',
    '    longer exist under their old names.',
  ];
}

/**
 * The Notice Board leaves the shipped game is defined by (Dean, 13/09/2026,
 * `reference-v17`), each as [path, value]. A run with every one of them at its
 * value in `BASE_GAME_DATA` IS the shipped Notice Board visit, whatever else an
 * overlay moves; a run with any of them moved is an arm on it.
 */
function visitLeaves(data: GameData): readonly (readonly [string, unknown])[] {
  const { turn, economy } = data.rules;
  return [
    ['rules.turn.visitCurrency', turn.visitCurrency],
    ['rules.turn.bonusTiming', turn.bonusTiming],
    ['rules.turn.selfVisitAllowed', turn.selfVisitAllowed],
    ['rules.turn.hostDrawOnVisit', turn.hostDrawOnVisit],
    ['rules.economy.noticeBoardThreshold', economy.noticeBoardThreshold],
    ['rules.economy.noticeBoardBlocks', economy.noticeBoardBlocks],
    ['rules.economy.noticeBoardsBySeats', economy.noticeBoardsBySeats],
  ];
}

/** The Notice Board leaves this run has moved off the shipped game, printed as `path value (shipped value)`. */
function visitLeavesOffShipped(data: GameData): string[] {
  const shipped = new Map(visitLeaves(BASE_GAME_DATA));
  const show = (v: unknown) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));
  return visitLeaves(data)
    .filter(([path, v]) => JSON.stringify(v) !== JSON.stringify(shipped.get(path)))
    .map(([path, v]) => `${path} ${show(v)} (shipped ${show(shipped.get(path))})`);
}

/**
 * ⭐ THE SHIPPED GAME'S BANNER (13/09/2026), printed when every Notice Board leaf
 * sits at its shipped value. Short on purpose: the arm banners below carry the
 * history of how each leaf was chosen, and a baseline that prints "THIS IS AN ARM"
 * over the shipped game is a banner that lies at the top of the file.
 */
function shippedGameBanner(id: string, data: GameData, overlayName: string | null): string[] {
  const threshold = data.rules.economy.noticeBoardThreshold;
  const map = [1, 2, 3, 4].map((n) => `${n}p ${noticeBoardsPerSeat(data, n)}`).join('  ');
  return [
    '',
    '*** THIS IS THE SHIPPED GAME: THE TWO-BOARD NOTICE BOARD VISIT, NO HOST DRAW (Dean, 13/09/2026). ***',
    '',
    `    overlay: ${overlayName ?? 'none (base)'}. Every Notice Board leaf is at its shipped value:`,
    `    rules.turn.visitCurrency '${data.rules.turn.visitCurrency}', bonusTiming '${data.rules.turn.bonusTiming}', ` +
      `selfVisitAllowed ${data.rules.turn.selfVisitAllowed},`,
    `    hostDrawOnVisit ${hostDrawOnVisit(data)}, rules.economy.noticeBoardThreshold ${threshold}, ` +
      `noticeBoardBlocks ${noticeBoardBlocks(data)},`,
    `    noticeBoardsBySeats ${map}.`,
    ...(overlayName === null
      ? []
      : [
          '    ⚠️ THE OVERLAY MOVES OTHER LEAVES ONLY, so this run is an ARM ON THE SHIPPED GAME and',
          '    not the baseline itself: read it as a paired delta against the no-overlay run.',
        ]),
    '',
    '    THE RULE IN ONE LINE: the Notice Boards are BUILDINGS on their owners’ farms, and the',
    '    bonus - FIRST, before the main action - is to play ONE card from your hand onto a',
    '    RIVAL’s board and take the PRINTED POWER on it. Self-visiting is banned, so every target',
    '    is a person: at two seats each player lays out two boards (their own suit’s plus one',
    '    drawn at random from the suits nobody farms), and one at three and four. The fee card',
    '    rests on the board until its owner harvests it, and that is the host’s whole payment.',
    `    The threshold of ${threshold} is a MINIMUM to harvest at and never a maximum, so a04-door-clog`,
    '    reads a genuine 0% and a20-board-stall carries the real question.',
    '',
    '    THE COMMONS WAS RULED DEAD AND ITS CODE DELETED ON 13/09/2026 (C100 AND C122 RULED). A',
    '    central column below is a structural zero, and a commons figure quoted below is history.',
    '',
    `    THE INSTRUMENT IS ${id}. Every arm on this game - the Village Store and delivery-meeple`,
    '    overlays, the host draw, the blocking and threshold controls - is read as a PAIRED DELTA',
    `    on identical ${id} seeds: --overlay= with --watchlist, never --sweep=, and always`,
    '    --n=1580. A bare --watchlist is a 1,580-game pilot and must not be quoted beside a real run.',
  ];
}

/**
 * ⭐ DEAN'S TWO-BOARD FIX FOR THE NOTICE-BOARD VISIT (ruled 11/09/2026,
 * `overlays/notice-board-visit-two-boards-v1.overlay.json`), printed at the top
 * beside the reference banner and immediately under the notice-board arm's own,
 * and SILENT under every other run, because a permanent banner is a banner
 * nobody reads.
 *
 * ⛔ IT RIDES WITH THE ARM BANNER RATHER THAN REPLACING IT, which is the
 * opposite of what the unclaimed-boards variant does and for a stated reason:
 * that variant reverses the arm banner's own first sentence ("there is NO
 * CENTRE") and this one does not reverse anything at all. Every word of the arm
 * banner is still true here; the only thing that changes is WHAT A SEAT LAYS
 * OUT at two players.
 *
 * ⭐ DEAN RULED IT INTO THE SHIPPED GAME ON 13/09/2026 (`reference-v17`), so it
 * now prints only beside an arm on the Notice Board visit, and its header no
 * longer claims the two boards are an arm.
 */
function twoBoardArmBanner(id: string, data: GameData, overlayName: string | null): string[] {
  if (!isNoticeBoardPower(data)) return [];
  const bySeats = [1, 2, 3, 4].map((n) => [n, noticeBoardsPerSeat(data, n)] as const);
  if (!bySeats.some(([, boards]) => boards > 1)) return [];
  // TARGETS = the boards a seat may visit = every board on the table that is not
  // its own. With self-visiting banned that is (seats - 1) rivals times the
  // boards each of them lays out.
  const targets = bySeats.map(([n, boards]) => [n, (n - 1) * boards] as const);
  const map = bySeats.map(([n, boards]) => `${n}p ${boards}`).join('  ');
  return [
    '',
    '*** AT TWO SEATS EVERY PLAYER LAYS OUT TWO BOARDS (the shipped rule since 13/09/2026). ***',
    '',
    `    overlay: ${overlayName ?? 'none named - the knobs were set directly'}.  rules.economy.noticeBoardsBySeats = ${map},`,
    `    with rules.turn.selfVisitAllowed ${data.rules.turn.selfVisitAllowed}. Everything else is the notice-board`,
    '    visit above, leaf for leaf.',
    '',
    '    THE RULE IN ONE LINE: self-visiting stays BANNED, and at TWO SEATS each player lays out',
    '    TWO Notice Boards - their own suit’s, plus one more drawn AT RANDOM from the suits',
    '    nobody is farming - with the fifth board unused. At three and four seats it is one board',
    '    each and the rest are unused, which is exactly the control.',
    '',
    '    THE TARGETS A SEAT MAY VISIT, and every one of them is a PERSON:',
    '',
    '        seats   boards each   rivals   TARGETS',
    ...targets.map(([n, t]) => {
      const boards = bySeats.find(([s]) => s === n)?.[1] ?? 1;
      return `        ${n}       ${boards}             ${n - 1}        ${t}`;
    }),
    '',
    '    ⭐ EVERY TARGET IS A PERSON, AND THAT IS THE WHOLE ARGUMENT FOR THIS ARM. It is measured',
    '    rather than argued. The starve at two players had two proposed cures and they differ in',
    '    ONE thing: what the extra targets ARE. The unclaimed-boards variant added OWNERLESS',
    '    central boards, fixed the rate and DESTROYED THE CROSS-TABLE TRAFFIC - at two players',
    '    ONLY 14.7% OF PLAYS REACHED A PERSON and the hook fell to 0.31. The structural lesson it',
    '    measured is that there are only ever four targets and EVERY TARGET ADDED THAT IS NOT A',
    '    PERSON DILUTES THE PERSON. So this arm adds targets that are people, and a08 asserts the',
    '    cross-table share of every play at 100% at every seat count: with the ban on and no',
    '    centre, anything else is a leak rather than a taste.',
    '',
    '    THE PRE-RULING CONTROL WAS overlays/notice-board-visit-no-self-v1.overlay.json, THE ONLY',
    '    CORNER OF THE 11/09/2026 2x2 THAT PASSED THE HOOK, at 0.54. Its sole problem was two',
    '    seats: the bonus slot is used on 28.8% of turns there against Dean’s own 30% floor, and',
    '    17.9% of two-player turns begin with cards in hand and NO LEGAL VISIT, because with',
    '    self-visiting banned and one board each THERE IS EXACTLY ONE BOARD A SEAT MAY VISIT.',
    '    ⛔ IF THIS ARM MOVES THE HOOK DOWN, THE FIX HAS COST THE THING IT WAS PROTECTING, and',
    '    that is the headline of the run rather than the rate.',
    '',
    '    ⛔⛔ AT THREE AND FOUR SEATS THIS IS THE CONTROL, RULE FOR RULE, AND THE ENGINE PROVES',
    '    IT. rules.economy.noticeBoardsBySeats is 1 at three seats and 1 at four, which is the',
    '    base value, and the setup code takes no rng call at all where no extra board is dealt -',
    '    so those columns replay BYTE-IDENTICALLY under both datasets on identical seeds. ONLY THE',
    '    TWO-SEAT COLUMN CAN MOVE. Any difference at three or four seats is a LEAK and not a',
    '    finding - a bot term reading the new knob it should not read, a setup draw consuming an',
    '    rng call it did not consume before, or a report line counting boards where it counted',
    '    seats - and everything below it is unreadable until it is fixed. Read those two columns',
    '    against the control FIRST.',
    '',
    '    THE EXTRA BOARD IS DRAWN AT RANDOM AND IT PAYS ITS OWNER, which is this design’s core',
    '    loop arriving on a card whose power its owner can never use. The draw is from the suits',
    '    nobody is farming, without replacement, so the two seats get different boards and neither',
    '    can buy its own; but every fee paid onto it RESTS THERE until its owner harvests it into',
    '    their barn. A POPULAR BOARD IS INCOME. ⚠️ THAT IS AN ARGUMENT AND NOT A READING, AND IT',
    '    IS OPEN RISK 1: which board you get is LUCK, and at two seats there is one opponent and',
    '    nowhere for the luck to average out. a18 reading 4d is the number - the busiest-against-',
    '    quietest board spread SPLIT by whether a board is its owner’s own suit or the one they',
    '    drew, OBSERVE and with no fail condition.',
    '',
    '    ⚠️ AND THE EXTRA BOARD’S SUIT NEED NOT HAVE A DECK IN PLAY. island.decksInPlayBySeats is',
    '    3 at two seats, so of the three unfarmed suits only ONE has a deck on the table; the draw',
    '    does not prefer it, deliberately, because a board grants a POWER and never a deck and',
    '    preferring it would weld the extra board to the neutral-deck choice.',
    '',
    '    ⭐ A HELPING HAND COMES ALIVE AT TWO SEATS FOR THE FIRST TIME, AND IT MOVES A HEADLINE',
    '    NUMBER. S9 is one use per board per turn, latched on the BOARD’S CARD ID, so the second',
    '    play must land on a DIFFERENT board. Under the control at two seats a seat faces exactly',
    '    ONE legal board, so the second play CAN NEVER BE TAKEN and the gap between the turn',
    '    measure and the plays measure is WELDED SHUT AT ZERO. Under this arm the one rival holds',
    '    two boards, so it can. EXPECT THE TWO MEASURES TO DIVERGE AT TWO SEATS AND NOWHERE ELSE;',
    '    a17 prints the gap by seat count for exactly that reason.',
    '',
    '    ⛔ THE BAND IS STILL A SHARE OF TURNS. Judging it on plays per turn cost this project a',
    '    re-run of all five arms on 09/09/2026, and a card that grants a second one of the thing',
    '    being counted is precisely what breaks the denominator. a17 prints both, labelled, and',
    '    the verdict reads the turn share against Dean’s 30%-60%.',
    '',
    '    ⚠️ TWO BOARDS IS TWO HARVESTS, WHICH IS OPEN RISK 2. rules.economy.noticeBoardThreshold',
    '    applies to EACH board separately, so at two seats a seat’s incoming fee traffic SPLITS',
    '    and each board fills at HALF the rate and sits under its minimum for twice as long. That',
    '    may move the BARN GLUT and the GAME LENGTH at two seats and nowhere else, which is the',
    '    shape of finding this arm is most likely to produce and most likely to have mistaken for',
    '    a leak. a20-board-stall now samples PER BOARD and its denominator is BOARD-TURNS: a lower',
    '    stall share at two seats is arithmetic before it is ever a finding.',
    '',
    '    THE HAND LIMIT OF 7 IS THE SIMULATOR’S BOUND AND NOT A RULE OF THE GAME (C7). The table',
    '    plays with NO hand limit and found that positive on 09/09/2026; the engine keeps 7 only',
    '    because an unbounded hand cannot be enumerated. ANY READING ABOUT HAND SIZE BELOW IS A',
    '    READING ABOUT THE INSTRUMENT and not about the design.',
    '',
    `    THE INSTRUMENT IS ${id}. The pairing is the only sound comparison this project has, and`,
    '    the pre-ruling pair is overlays/notice-board-visit-no-self-v1.overlay.json on identical',
    '    seeds, --overlay= with --watchlist and always --n=1580. A bare --watchlist is a 1,580-game',
    '    pilot and must not be quoted beside a real run.',
  ];
}

/**
 * ⭐ S17, THE HOST DRAW (Dean, ruled 11/09/2026), printed beside the reference
 * banner and immediately under the two-board arm's own, and SILENT under every
 * other run, because a permanent banner is a banner nobody reads.
 *
 * ⛔ IT RIDES WITH THE OTHER THREE RATHER THAN REPLACING ANY OF THEM. It is ONE
 * LEAF on top of the two-board arm - `rules.turn.hostDrawOnVisit`, 0 against 1 -
 * and it reverses nothing any of them says. The arm banner says what the
 * notice-board visit is, the two-board banner says what a seat lays out, and this
 * one says what a HOST IS PAID.
 *
 * ⭐ ITS PROVENANCE IS A TABLE RATHER THAN A RUN, which is rare enough in this
 * project to be the first thing the banner records.
 *
 * ⛔ THE SHIPPED GAME OF 13/09/2026 HAS NO HOST DRAW, so this is an arm on it,
 * measured against `overlays/notice-board-visit-two-boards-v1.overlay.json` on
 * identical seeds of the current reference.
 */
function hostDrawArmBanner(id: string, data: GameData, overlayName: string | null): string[] {
  if (!isNoticeBoardPower(data)) return [];
  const n = hostDrawOnVisit(data);
  if (n <= 0) return [];
  const limit = data.rules.turn.handLimit;
  return [
    '',
    '*** THIS IS AN ARM AND NOT THE SHIPPED GAME. WHEN A NEIGHBOUR VISITS YOU, YOU DRAW A CARD. ***',
    '',
    `    overlay: ${overlayName ?? 'none named - the knobs were set directly'}.  rules.turn.hostDrawOnVisit = ${n},`,
    '    and every other Notice Board leaf is as listed above.',
    '',
    '    THE RULE IN ONE LINE (S17, Dean, 11/09/2026): the owner of a visited Notice Board',
    '    immediately draws one card off a deck. NEVER on a self-visit, and PER VISIT rather than',
    '    per turn - so A Helping Hand sending a second visit to the same owner pays them twice,',
    '    because they also receive two fee cards and the payment is for the fee and not the turn.',
    '',
    '    ⭐ ITS PROVENANCE IS A TABLE TEST AND NOT A RUN, WHICH NOTHING ELSE IN THIS REPORT CAN',
    '    SAY. Dean played overlays/notice-board-visit-two-boards-v1.overlay.json at a two-player',
    '    table on 11/09/2026 and house-ruled this in during the session. His verdict on that',
    '    session: the visiting worked well, everyone visited, every Notice Board was used at some',
    '    stage, and "the rule that the person who gets visited draws a card led to a lot of extra',
    '    cards in play, which relieved the tightness of the game in a useful way". ⛔ THE SHIPPED',
    '    GAME OF 13/09/2026 HAS NO HOST DRAW, so this rule is an arm on it. The simulator is here to',
    '    find what one session could not see; it is not here to second-guess what the session did see.',
    '',
    '    ⛔ IT AMENDS S7, AND S7 SAID THE OPPOSITE IN AS MANY WORDS. S7 reads that the card stays',
    '    on the board it was played to, its owner harvests it into their barn like any other',
    '    building, "and that is the payment and there is no other". Under S17 there is now one',
    '    other and it is paid INSTANTLY: THE HOST IS PAID TWICE, once in a card drawn now and once',
    '    in material they must still harvest and then deliver. Do not quote S7 forward without S17',
    '    beside it.',
    '',
    '    ⛔⛔ THE MEASUREMENT CAVEAT, AND IT IS THE MOST IMPORTANT SENTENCE IN THIS HEADER: THE',
    '    SIMULATOR CANNOT MEASURE THE EFFECT DEAN ACTUALLY LIKED. The engine caps hands at',
    `    ${limit === null ? 'nothing on this run' : limit} as an INSTRUMENT BOUND (C7) while the table plays with NO HAND LIMIT AT ALL,`,
    "    and this rule's principal effect is MORE CARDS IN HAND - so the instrument clips exactly",
    '    the thing the table enjoyed. This report can honestly answer: does the bonus rate leave',
    "    Dean's 30% to 60% band (a17, ON THE SHARE OF TURNS), what happens to the barn glut (a06),",
    '    to game length, to deliveries per player and to the hook (a08). IT CANNOT ANSWER WHETHER',
    '    THE GAME FEELS LESS TIGHT. ⛔ NO NUMBER IN THIS REPORT MAY BE QUOTED AS EVIDENCE ABOUT',
    '    TIGHTNESS, IN EITHER DIRECTION, AND EVERY HAND-SIZE LINE BELOW CARRIES THE SAME CAVEAT',
    '    AND THE SAME BOUND ON ITS OWN LINE, because a number quoted out of a report loses its',
    '    header first.',
    '',
    '    ⚠️ EXPECT THE BONUS RATE TO RISE, AND IT IS THE READING WITH A VERDICT. A card handed',
    '    back on every visit makes the NEXT visit easier to afford. The control PASSES at 51.7% of',
    '    turns pooled (2p 44.0 / 3p 49.2 / 4p 59.9), so FOUR SEATS IS ALREADY ONE TENTH OF A POINT',
    '    INSIDE THE 60% CEILING. If any seat count leaves the band, that is the finding and the',
    '    rate is the headline. ⛔ THE VERDICT IS THE SHARE OF TURNS AND NOT PLAYS PER TURN:',
    "    judging Dean's band on plays cost this project a re-run of five arms on 09/09/2026.",
    '',
    '    ⚠️ AND THE COST IS REAL RATHER THAN ARGUED AWAY: EVERY VISIT NOW ADDS A CARD TO THE',
    '    GAME. At two seats under the control arm there are about 14.4 visits received per player',
    '    per game, so this is a substantial new faucet, and it is the reason the barn glut (a06)',
    '    and the game length have to be read BESIDE the rate rather than after it. ⭐ THE SHAPE',
    '    IS the one this project left open rather than the one it banned: RESTOCK was banned as "a',
    '    per-interaction bank faucet" and the standing rule beside that ban reads that if a',
    '    give-cards effect returns, it pays in DRAWS. A host draw comes off a DECK and never off a',
    '    bank.',
    '',
    '    ⚠️ W17 THE PIE SHOP NOW PAYS ITS OWNER TWO CARDS ON BEING VISITED. Its text reads',
    '    "Whenever a neighbour visits you, Draw 1", which under S17 duplicates the rule in words,',
    '    and THE TWO STACK: the card is a card and the rule is a rule, they are pushed as two',
    '    separate tasks and nothing suppresses either. They are ASYMMETRIC - W17 carries the',
    "    once-a-turn latch every card's text carries and the RULE DOES NOT - so a W17 owner",
    '    visited TWICE in one turn draws THREE and not four. a21-host-draw separates the two',
    "    exactly, off the draw task's own src, and the retext is a SHEET decision Dean has not",
    '    made: no card changes in this pass.',
    '',
    '    THE CONTROL IS overlays/notice-board-visit-two-boards-v1.overlay.json AND THE TWO DIFFER',
    '    IN EXACTLY ONE LEAF: rules.turn.hostDrawOnVisit, 0 against 1. Everything else in the arm',
    '    is that file pinned leaf for leaf, so EVERY DELTA BETWEEN THE TWO COLUMNS IS THIS RULE',
    '    AND NOTHING ELSE.',
    '',
    `    THE INSTRUMENT IS ${id}, AND THE PAIR RUNS ON IDENTICAL ${id} SEEDS. The pairing is the`,
    '    only sound comparison this project has. --overlay= with --watchlist, never --sweep=, and',
    '    always --n=1580: a bare --watchlist is a 1,580-game pilot and must not be quoted beside a',
    '    real run.',
  ];
}

/**
 * ⭐ THE NOTICE-BOARD VISIT (S1-S16, Dean 10/09/2026, plus rulings C88 and C89
 * of the same evening), printed at the top beside the reference banner and
 * SILENT under every other run, because a permanent banner is a banner nobody
 * reads.
 *
 * ⭐ SINCE 13/09/2026 THE NOTICE BOARD VISIT IS THE SHIPPED GAME (`reference-v17`),
 * so this banner prints only when a run has moved one of its leaves off the
 * shipped value (`visitLeavesOffShipped`) and names the leaves it moved. A run
 * with none moved gets `shippedGameBanner` instead.
 */
function noticeBoardArmBanner(
  id: string,
  data: GameData,
  overlayName: string | null,
  off: readonly string[],
): string[] {
  if (!isNoticeBoardPower(data)) return [];
  const threshold = data.rules.economy.noticeBoardThreshold;
  const blocks = noticeBoardBlocks(data);
  const self = data.rules.turn.selfVisitAllowed;
  return [
    '',
    '*** THIS IS AN ARM AND NOT THE SHIPPED GAME: THE NOTICE BOARD VISIT WITH A LEAF MOVED. ***',
    '',
    `    overlay: ${overlayName ?? 'none named - the knobs were set directly'}.  rules.turn.visitCurrency = 'noticeBoardPower'`,
    `    (S5, Dean 10/09/2026), with rules.economy.noticeBoardThreshold ${threshold},`,
    `    noticeBoardBlocks ${blocks}, rules.turn.selfVisitAllowed ${self} and bonusTiming`,
    `    '${data.rules.turn.bonusTiming}'.`,
    `    MOVED OFF THE SHIPPED GAME (13/09/2026): ${off.join('; ')}.`,
    '',
    '    THE RULE IN ONE LINE: there is NO CENTRE. The five Notice Board cards are BUILDINGS on',
    '    the farms that own them, and the bonus - still FIRST, before the main action - is to play',
    `    ONE card from your hand onto a Notice Board on the table (${self ? 'your own included, as this run allows' : 'a RIVAL’s only, as shipped'}),`,
    '    and immediately take the PRINTED POWER on it. Orchard Draw 4; Dairy Build,',
    '    spending cards of any crops; Wheat harvest one of your buildings then 1 card from hand to',
    '    barn; Apiary Sow 2 from hand onto your OWN buildings; Vegetable Deliver, or 2 cards from',
    '    hand to barn if you cannot.',
    '',
    '    THE CARD IS THE WHOLE OF THE HOST PAYMENT AND THERE IS NO OTHER (S7). It rests on the',
    '    board it was played to, and the owner harvests it into their barn like any other',
    '    building. The visitor is paid instantly with the power; the owner is paid in material',
    '    they still have to convert. That is the Lopiano fault named in all seven previous',
    '    versions of this bonus action - pay the giver in the same act, or the giver draws the',
    '    charge - answered the way the predecessor answered it.',
    '',
    `    THE THRESHOLD OF ${threshold} IS A MINIMUM AND NEVER A MAXIMUM (S8), which is why the face prints`,
    `    \`${threshold}+\`. It is the floor before the OWNER may harvest; cards can always be added, no`,
    '    board is ever full, and NOTHING IN THE GAME REFUSES A PLAY. So a04-door-clog',
    '    reads a GENUINE 0% here and that is not a bug - a `3+` board cannot clog - and the new',
    '    a20-board-stall measures the real question instead: how often a board sits loaded and',
    '    uncleared, and for how long. Read a20 hardest at TWO PLAYERS, where there are two boards.',
    '',
    `    SELF-VISITING IS BANNED IN THE SHIPPED GAME (13/09/2026) and it is ${self ? 'ON' : 'OFF'} in this run. S6 had`,
    '    made it legal on 10/09/2026 on the argument that the five boards print five DIFFERENT',
    '    powers, so your own board is one option of five and the one that never has what you have',
    '    not got, where in v31 every board printed the SAME thing and a self-visit was strictly',
    '    better than a visit. WHERE IT IS ON, ITS SHARE IS THE HEADLINE RISK. v31 read 22.2%; much',
    '    above that says the variety argument is wrong and the interaction is decoration. a17',
    '    splits it by seat count.',
    '',
    '    TWO RULINGS POSTDATE THE HANDOFF AND THE CODE FOLLOWS THEM, NOT S12, so nobody reads a',
    '    disagreement into it. C88, WHEAT: S12 printed "Harvest any one of your buildings, however',
    '    many cards are on it", which is W11 The Bakehouse word for word, so Dean ruled that the',
    '    POWER moves and the CARD keeps its identity - the board harvests plainly and pays 1 card',
    '    from hand into the barn on top. C89, APIARY: S12 said "onto any buildings", which reads',
    '    across the table, and Dean ruled it is your OWN buildings only, so every power is',
    '    self-contained and THE VISIT ITSELF STAYS THE ONLY CROSS-TABLE ACT IN THE DESIGN.',
    '',
    '    WHAT MOVED IN THE SUITE, so a reader knows why a familiar line changed: a08-the-hook HAS',
    '    A SUBJECT, where under the commons it printed NO SUBJECT - there is a host, so NEIGHBOUR',
    '    visits per player per turn is a rate over an event that can happen and its floor of 0.5',
    '    is live. a18 carries the FARM traffic (visits received per player, the',
    '    busiest-against-quietest board spread, cards resting on boards by game third, and the',
    '    farm bypass REDEFINED as the share of barn cards that arrived as a fee somebody else',
    '    paid), still with no fail condition. a20-board-stall carries the stall. a19-coin-economy',
    '    is retired with the commons (13/09/2026), and a17 carries the band of 30%-60% OF TURNS',
    '    that Dean set on 09/09/2026, split self against neighbour.',
    '',
    '    THE BAND IS A SHARE OF TURNS AND NOT OF PLAYS. A Helping Hand grants a second visit (S9,',
    '    to a different board), so visits per turn runs above the share of turns that used the',
    '    slot. Judging the band on the wrong quantity cost this project a re-run of all five arms',
    '    on 09/09/2026; a17 prints both, labelled, and the verdict reads the turn share.',
    '',
    '    THE HAND LIMIT OF 7 IS THE BOUND ON THE SIMULATOR AND NOT A RULE OF THE GAME. The',
    '    table plays with NO hand limit and found that positive on 09/09/2026; the engine keeps',
    '    7 only because an unbounded hand cannot be enumerated. ANY READING ABOUT HAND SIZE',
    '    BELOW IS A READING ABOUT THE INSTRUMENT and not about the design.',
    '',
    `    THE INSTRUMENT IS ${id}. This arm is read as a PAIRED DELTA on identical ${id} seeds`,
    '    against the shipped baseline (no overlay) or its own named control, never as a level.',
    '    overlays/v31-card-visit.overlay.json is the last design before this one that put a card',
    '    on a board somebody owned, and the one whose 22.2% self-visit number a self-visit arm',
    '    must be read against.',
  ];
}

/**
 * ⏱️ WHAT A RUN COSTS, printed in the header rather than left for the reader to
 * infer from the wall time, because it decides what is affordable to ask.
 *
 * reference-v9 ran 1580 games at **9.7 games a second** on one thread.
 * reference-v10 is nowhere near that, and FOUR things are tangled in the gap.
 * The body below reports the two that were fixed; these are all of them, kept
 * apart because only one is a defect that is still open:
 *
 *   - **The v31 branching factor**, catastrophic and now bounded. Deleting the
 *     hand limit made a 2-seat game cost 91.5 seconds; `rules.turn.handLimit`
 *     brought that to 0.91, with the worst position going from 116,535 legal
 *     moves to 2,788. FIXED.
 *   - **The option collapse** in @gp/bots plus the engine's payment enumerator:
 *     4.5x, with zero behavioural change (120 of 120 game digests identical).
 *     FIXED.
 *   - **The v31 GAME being bigger**, which is not a defect at all. A turn
 *     resolves about two actions rather than one (the bonus slot buys a whole
 *     core action, and meeples add more) and there is a meeple phase to
 *     enumerate at the start of every turn, so a 4-seat game takes 393-591
 *     decisions. That is what the design asked for.
 *   - **⛔ THE COST OF EACH DECISION, which is still open and is the larger
 *     factor.** Measured 03/09/2026 at the shipped hand limit and AFTER the
 *     option collapse: a decision costs **18.6 to 34.4 applies** against a
 *     historical 5.9-6.4 and ticket 40's published 6.7. Three to five times
 *     dearer per decision, on top of more decisions per game.
 *     `bots.test.ts > keeps a whole game inside the throughput` is the guard;
 *     both of its gates are firing and NEITHER has been re-cut, because a guard
 *     that is firing correctly is not a stale constant.
 *
 * The practical consequence, and it is a finding rather than an inconvenience:
 * **the full suite WITH the five mirrors is not affordable in one sitting.** A
 * mirror pool is five more runs, so a report that skips them is the norm now
 * rather than the exception - and it costs the reader the taste spread on the
 * six taste-sensitive assertions, which is exactly the diagnostic that says
 * whether one archetype is producing a number on its own. Ticket 10's control
 * goes with it: without a hermit mirror, nothing checks that assertion 8 has
 * teeth. Read a mirror-less report knowing that.
 */
function costNote(gamesPerSecond: number, mirrorGames: number, workers: number): string[] {
  const out = [
    `throughput  ${num(gamesPerSecond, 2)} games/s against reference-v9's 9.7 (single core). ⚠️ THE TWO ` +
      `ARE NOT
            COMPARABLE AS ENGINEERING: since 03/09/2026 a run is spread over ` +
      `${workers === 1 ? 'ONE thread' : `${workers} THREADS`}
            (pool.ts), so this figure is wall-clock throughput and not the cost ` +
      `of a game. What
            moved under it, on 03/09/2026 and measured paired on identical seeds: ` +
      `the option
            collapse in @gp/bots plus the engine's payment enumerator ` +
      `(4.5x, ZERO behavioural
            change, 120 of 120 game digests identical), and the hand limit ` +
      `12 -> 7 (a further
            2.7x, and a REAL rule change that moves the game - see ` +
      `rules.turn.handLimit).`,
  ];
  if (mirrorGames === 0) {
    out.push(
      `            ⚠️ MIRRORS NOT RUN. That costs the taste spread on every taste-sensitive` +
        `
            assertion, and it removes ticket 10's control: without a hermit mirror` +
        `
            nothing checks that assertion 8 has teeth. A mirror pool is five more runs.`,
    );
  }
  return out;
}

/**
 * A crash is louder than a verdict. The driver survives one so the other 749
 * games still produce a report, but it must never be something a reader has to
 * go looking for.
 */
function crashBanner(pooled: Pooled): string[] {
  const crashes = pooled.all.filter((g) => g.outcome === 'crashed');
  if (crashes.length === 0) return [];
  const distinct = new Map<string, number>();
  for (const g of crashes)
    distinct.set(g.error ?? 'unknown', (distinct.get(g.error ?? 'unknown') ?? 0) + 1);
  return [
    '',
    `*** ${crashes.length} of ${pooled.all.length} GAMES CRASHED - the engine threw and the game was excluded. ***`,
    ...[...distinct].map(([message, n]) => `      ${n} x "${message}"`),
    '      Example seeds: ' +
      crashes
        .slice(0, 3)
        .map((g) => g.seed)
        .join(', '),
  ];
}

function watchlistSection({ rows, mirrorGames }: ReportInput): string[] {
  const out = [THIN, 'THE WATCH LIST', THIN, ''];
  for (const row of rows) {
    const { assertion: a, measurement: m } = row;
    const tag = `${String(a.id).padStart(2)} ${m.verdict.padEnd(7)}`;
    if (m.verdict === 'PASS') {
      out.push(`${tag} ${a.title} - ${m.headline}`);
      // The detail lines print on a PASS too (ticket 56). Assertion 14's
      // details ARE the market doc's log sheet - the bonus-slot mix, the plain
      // £1 visit after midgame, the exploit probe - and a paired-arm comparison
      // needs them from the arm that passes exactly as much as from the one
      // that fails. Ticket 44's re-scorability rule points the same way: a
      // headline that hides its own components cannot be re-scored by hand.
      for (const line of m.detail ?? []) out.push(`         detail:   ${line}`);
      // The mirror spread is printed even on a PASS, and especially on one. A
      // taste-sensitive number that passes on the mixed table while a single
      // archetype's mirror sits far outside it is a pass held up by the other
      // seats, and hiding that is the failure mode the mirrors exist to catch.
      // Ticket 10's control lives here: a HERMIT MIRROR SHOULD FAIL ASSERTION 8.
      out.push(...mirrorLine(row, mirrorGames));
      continue;
    }
    out.push(`${tag} ${a.title}`);
    out.push(`         measured: ${m.headline}`);
    out.push(`         rule:     ${a.threshold}`);
    for (const line of m.detail ?? []) out.push(`         detail:   ${line}`);
    if (m.verdict === 'FAIL') {
      out.push(...wrap(`design:   "${a.quote}"`, 9));
      out.push(`         source:   ${a.source}`);
    }
    out.push(...mirrorLine(row, mirrorGames));
    if (m.verdict === 'FAIL') out.push(...wrap(`remedy:   ${a.remedy}`, 9));
    out.push('');
  }
  const counts = { PASS: 0, FAIL: 0, OBSERVE: 0 };
  for (const r of rows) counts[r.measurement.verdict] += 1;
  out.push(
    `VERDICT: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.OBSERVE} OBSERVE` +
      (counts.FAIL === 0 ? '' : '   <- the run exits non-zero'),
  );
  out.push('');
  out.push(...retiredSection());
  return out;
}

/**
 * The tombstones, printed short and under the suite.
 *
 * An assertion whose subject has been deleted cannot FAIL, so leaving it in
 * would print a permanent PASS that reads as evidence and is not. But a reader
 * who remembers assertion 1 and finds a gap where it was will assume it was
 * quietly dropped, which is the other half of the same problem. So the ids stay
 * visible, the reasoning stays in `assertions/tombstones.ts`, and ids are never
 * reused.
 */
function retiredSection(): string[] {
  if (RETIRED.length === 0) return [];
  const out = [`RETIRED (ids are never reused, so the gaps above are these ${RETIRED.length}):`];
  for (const t of RETIRED) {
    out.push(`  ${String(t.id).padStart(2)} ${t.title} - retired ${t.retired}`);
  }
  out.push('     Full reasoning, and what each last measured, in packages/sim/src/assertions/');
  out.push('     tombstones.ts. Each was deleted because its SUBJECT no longer exists, not');
  out.push('     because it was inconvenient.');
  out.push('');
  return out;
}

function mirrorLine(row: WatchlistRow, mirrorGames: number): string[] {
  if (!row.mirrors || mirrorGames === 0) return [];
  const spread = [...row.mirrors].map(([p, v]) => `${p} ${num(v, 2)}`).join('  ');
  return [
    `         mirrors:  ${spread}   (diagnostic only, ${mirrorGames} games each; ` +
      `mixed reads ${num(row.measurement.value, 2)})`,
  ];
}

/**
 * The four bias-exposed series carry an all-games control column, because
 * excluding stalls systematically excludes the games with more delivery, more
 * spending and shorter barns - which is survivorship bias landing on two of the
 * assertions.
 */
function seriesSection({ data, pooled }: ReportInput): string[] {
  const arm = isMeepleCurrency(data);
  // ⭐ THE NOTICE-BOARD VISIT SWAPS TWO SLOTS: there are no meeples under it (S15 keeps the
  // knobs, at zero), so "meeples held at game end" and "meeples spent / gained"
  // are names for nothing, and a column of zeroes in the table a reader scans
  // FIRST reads as a finding. What stands in the same place is the surface the
  // design put the interaction on - the boards - and the two readings the pass
  // exists to take.
  const boards = isNoticeBoardPower(data);
  const out = [
    THIN,
    'THE SERIES  (ended games; the [all] column includes stalls, so the bias is visible)',
    THIN,
    '',
  ];
  out.push(pad('', 34) + pooled.bySeats.map((s) => pad(`${s.seats} seats`, 20)).join(''));
  const line = (label: string, f: (games: readonly GameMetrics[]) => string) =>
    out.push(
      pad(label, 34) + pooled.bySeats.map((s) => pad(`${f(s.ended)}  [${f(s.all)}]`, 20)).join(''),
    );

  out.push(
    pad('games', 34) +
      pooled.bySeats.map((s) => pad(`${s.ended.length} of ${s.all.length}`, 20)).join(''),
  );
  out.push(pad('unfinished', 34) + pooled.bySeats.map((s) => pad(pct(s.stallRate), 20)).join(''));
  // `stalled` and `maxMoves` mean completely different things - a table that
  // drained the card supply, against a game the move ceiling cut off - and
  // pooling them into one "unfinished" percentage hid that for eight references.
  // The method document's clock section: if a game has three end conditions and
  // one fires 99% of the time, the other two are backstops and you should KNOW
  // that rather than assume a mix.
  // Its own block rather than a column: "ended 530, stalled 10" does not fit the
  // 20-character grid, and a truncated end-reason reads as though there were
  // only one.
  out.push(pad('end reasons', 34) + 'below the table');
  line('game length, rounds (median)', (g) => num(median(g.map((x) => x.rounds)), 0));
  if (boards) {
    line('cards on Notice Boards at game end (median)', (g) =>
      num(median(g.flatMap((x) => x.noticeBoardCardsByRound.slice(-1))), 1),
    );
  } else {
    line('meeples held at game end (median)', (g) =>
      num(median(g.flatMap((x) => x.meeplesByRound.slice(-1))), 1),
    );
  }
  line('barn at game end (median)', (g) =>
    num(median(g.flatMap((x) => x.barnByRound.slice(-1))), 0),
  );
  line('deliveries per player (mean)', (g) =>
    num(mean(g.map((x) => sum(x.deliveriesBySeat) / x.seats)), 2),
  );
  // ⭐ THE THREE v31 LINES. Actions per turn is risk 1 and the number the whole
  // pass moves; the meeple spend rate is the dead-component check; the
  // self-visit share is risk 2 in one number. They are in the SERIES table as
  // well as in their own assertions because this table is what a reader scans
  // first and what a paired arm is diffed on.
  line('actions per turn (mean)', (g) => {
    const turns = sum(g.map((x) => sum(x.turnsBySeat)));
    return num(turns === 0 ? NaN : sum(g.map((x) => sum(x.actionsBySeat))) / turns, 2);
  });
  // ⭐ TWO OF THE THREE SWAP UNDER THE MEEPLE-LOOP ARM, because under it they
  // would print numbers that mean nothing. "Spent / gained" is arithmetic about
  // a population that does not exist once meeples recirculate (see
  // a15-meeple-economy), and the self-visit share is 0 by construction (X5) and
  // therefore a column of zeroes where a reader expects information. What
  // replaces them are the two lines the handoff asks a scanner to read first.
  if (arm) {
    line('spends per meeple-turn', (g) => {
      const held = sum(g.map((x) => sum(x.meepleTurnsBySeat)));
      return num(held === 0 ? NaN : sum(g.map((x) => sum(x.meeplesSpentBySeat))) / held, 2);
    });
    line('wild share of spends', (g) => {
      const visits = sum(g.map((x) => sum(x.visitsBySeat)));
      return pct(visits === 0 ? NaN : sum(g.map((x) => sum(x.wildVisitsBySeat))) / visits, 0);
    });
    line('empty-board collects / turn', (g) => {
      const turns = sum(g.map((x) => sum(x.turnsBySeat)));
      return pct(turns === 0 ? NaN : sum(g.map((x) => sum(x.collectsEmptyBySeat))) / turns, 0);
    });
    line('meeples boxed per game', (g) =>
      num(g.length === 0 ? NaN : sum(g.map((x) => sum(x.meeplesBoxedBySeat))) / g.length, 1),
    );
  } else if (boards) {
    // The four readings the handoff's own measurement plan asks a scanner to
    // read first: the rate on the TURN measure (a17), the self share (the
    // headline risk), the payment that crossed the table (a18) and the stall
    // (a20). Turns and not visits, for the reason a17's header labours.
    line('bonus slot used / turn', (g) => {
      const turns = sum(g.map((x) => sum(x.turnsBySeat)));
      return pct(turns === 0 ? NaN : sum(g.map((x) => sum(x.bonusTurnsBySeat))) / turns, 0);
    });
    line('self-visit share of visits', (g) => {
      const all = sum(g.map((x) => sum(x.visitsBySeat)));
      return pct(all === 0 ? NaN : sum(g.map((x) => sum(x.selfVisitsBySeat))) / all, 0);
    });
    line('visits received / player / game', (g) => {
      const seats = sum(g.map((x) => x.seats));
      return num(seats === 0 ? NaN : sum(g.map((x) => sum(x.freight.receivedBySeat))) / seats, 2);
    });
    line('barn cards paid by a RIVAL', (g) => {
      const banked = sum(g.map((x) => sum(x.freight.bankedBySeat)));
      const inn = sum(g.map((x) => sum(x.barnInBySeat)));
      return pct(inn === 0 ? NaN : banked / inn, 0);
    });
    line('board loaded and uncleared / turn', (g) => {
      const sampled = sum(g.map((x) => sum(x.boardSampledTurnsBySeat)));
      const loaded = sum(g.map((x) => sum(x.boardHarvestableTurnsBySeat)));
      return pct(sampled === 0 ? NaN : loaded / sampled, 0);
    });
  } else {
    line('meeples spent / gained', (g) => {
      const got = sum(g.map((x) => sum(x.meeplesGainedBySeat)));
      return pct(got === 0 ? NaN : sum(g.map((x) => sum(x.meeplesSpentBySeat))) / got, 0);
    });
    line('self-visit share of visits', (g) => {
      const all = sum(g.map((x) => sum(x.visitsBySeat)));
      return pct(all === 0 ? NaN : sum(g.map((x) => sum(x.selfVisitsBySeat))) / all, 0);
    });
  }
  line('lead changes (median)', (g) => num(median(g.map((x) => x.leadChanges)), 0));
  line('winning score (median)', (g) =>
    num(median(g.flatMap((x) => (x.winner === null ? [] : [x.scores[x.winner]?.total ?? NaN]))), 0),
  );
  line('score spread, top - bottom', (g) =>
    num(
      median(
        g.map((x) => {
          const totals = x.scores.map((s) => s.total);
          return Math.max(...totals) - Math.min(...totals);
        }),
      ),
      0,
    ),
  );
  // Preferred over the raw gap above, and printed beside it rather than instead
  // of it: the gap says how far apart the ends were, the ratio says whether the
  // loser was ever in it, and only the ratio survives score inflation. This is
  // the number to move if that complaint ever comes back from a table.
  out.push(
    pad('last as % of winner (median)', 34) +
      pooled.bySeats.map((s) => pad(pct(s.lastPctOfWinner, 0), 20)).join(''),
  );
  // The engine's tie-break chain ends on seat order, so `winner` is never null
  // and a tie is invisible in every win rate in this report. Measured off the
  // totals instead. Below about 18% a tiebreak is not a rules burden worth
  // spending a clause on at gateway weight - but that is a decision, and it
  // needs the number in front of it.
  out.push(
    pad('games with a tied top score', 34) +
      pooled.bySeats.map((s) => pad(pct(s.tieRate, 1), 20)).join(''),
  );
  line('island filled at game end', (g) => pct(median(g.map((x) => x.islandFill)), 0));
  // The C1 lines, tracked from 2026-08-09. Per DECK, not per game, and split,
  // because a played crop's central deck is smaller than a neutral crop's by what
  // setup deals out of it (`deckSizes`, 14 against 18 since v31) - they churn at
  // different rates and one pooled number describes neither. See the note below
  // the table.
  line('reshuffles per played deck', (g) => num(median(perDeck(g, 'played')), 2));
  line('reshuffles per neutral deck', (g) => num(median(perDeck(g, 'neutral')), 2));
  const decks = deckSizes(data);
  out.push('');
  out.push(
    'Reshuffles are the C1 line: a pool that cycles is not a pool that is sampled. A played',
  );
  out.push(
    `crop's deck holds ${decks.played} cards (setup deals ${decks.hand} of its ${decks.whole} ` +
      `to a hand and ${decks.barn} to a barn); a neutral`,
  );
  out.push(
    `crop's holds ${decks.whole} and loses none, which is why the two lines are printed apart. If the`,
  );
  out.push(
    'played figure is above about 1, that crop is a cycling deck rather than a sampled pool,',
  );
  out.push(
    'and any claim that the 105 cards give variety WITHIN a game is being made off the wrong',
  );
  out.push(
    'half of the pool. First recorded 2026-08-09 on reference-v9 at n=1580: played 6 / 5 / 5',
  );
  out.push(
    `by seat count, neutral 0 / 0 / 0. The played line's pooled median has a noise floor ` +
      `("reshuffles, played crop", ${NOISE_FLOOR?.reference ?? 'none measured'});`,
  );
  out.push('the neutral line has none - run --noise before reading a movement in it as a finding.');
  out.push('');
  out.push('End reasons. `stalled` drained the card supply; `maxMoves` hit the ceiling; `crashed`');
  out.push('is a bug. They are three different things and only the first is a design fact.');
  for (const s of pooled.bySeats) {
    out.push(
      `  ${s.seats}p  ` +
        [...s.endReasons]
          .sort((a, b) => b[1] - a[1])
          .map(([reason, n]) => `${reason} ${n}`)
          .join(', '),
    );
  }
  out.push('');
  out.push(
    'The end trigger DEFINES the end, so "when it fires relative to game length" is 100% by',
  );
  out.push(
    'construction and measures nothing. Island fill is the same question - did it fire early? -',
  );
  out.push('asked of something that can actually vary.');
  out.push('');
  out.push('VP sources on a winning score (the design wants island deliveries at 50%+):');
  const winners = pooled.ended.flatMap((g) => (g.winner === null ? [] : [g.scores[g.winner]]));
  const part = (
    pick: (s: { printed: number; receipts: number; endgame: number; total: number }) => number,
  ) => pct(mean(winners.flatMap((s) => (s && s.total > 0 ? [pick(s) / s.total] : []))), 0);
  out.push(
    `  island receipts ${part((s) => s.receipts)}   printed VP ${part((s) => s.printed)}   ` +
      `endgame cards ${part((s) => s.endgame)}`,
  );
  out.push(
    '  The coin pity column is gone with the currency (v31). The Farmstead is an end-game ' +
      'scorer now,',
  );
  out.push('  so every seat has at least one endgame card and that column is no longer optional.');
  out.push('');
  return out;
}

/**
 * The giveaway, the barn's routes and the grove - the three lines the Orchard
 * rebuild's pass conditions need and no previous run recorded (2026-08-09).
 *
 * All three are general questions asked of the whole table, not Orchard
 * diagnostics: how many cards cross the table in a game (the design's own risk
 * 7 - the giveaway loosens the table's card clock, which is the master brake),
 * how the barn actually filled (the rebuild claims Orchard is "rich in cards and
 * poor in freight", and the harvest share is where that is true or false), and
 * how deep the grove got (what O1's build refund and O20 both pay for).
 *
 * ⚠️ NO NOISE FLOOR YET for any of them. Run --noise before reading a movement
 * in one as a finding.
 */
function giveawaySection({ pooled }: ReportInput): string[] {
  const games = pooled.ended;
  const out = [THIN, 'THE GIVEAWAY, THE BARN AND THE GROVE  (ended games)', THIN, ''];
  if (games.length === 0) {
    out.push('  no ended games', '');
    return out;
  }
  // MEANS, not medians, and deliberately: every giving card in the game is an
  // Orchard card, so most cells have no Orchard seat at all and the median of
  // the giveaway across all games is a structural 0 that says nothing.
  const per = (f: (g: GameMetrics) => number) => mean(games.map(f));
  const orchardGames = games.filter((g) => g.suits.includes('orchard'));
  const route = (key: string) => median(games.map((g) => g.barnInByRoute[key] ?? 0));

  out.push(
    `  cards given to rivals per game        ${num(
      per((g) => sum(g.giftsBySeat)),
      2,
    )}` +
      `   (games with an Orchard seat: ` +
      `${num(mean(orchardGames.map((g) => sum(g.giftsBySeat))), 2)})`,
  );
  out.push(
    `  ORCHARDs built per Orchard seat       ${num(orchardsPerOrchardSeat(games), 2)}` +
      `   (median; any seat, mean ${num(
        per((g) => sum(g.orchardsBuiltBySeat) / g.seats),
        2,
      )})`,
  );
  out.push(
    `  O17's £1 discard divert per game      ${num(
      per((g) => sum(g.divertsBySeat)),
      2,
    )}` +
      `   (games with an Orchard seat: ` +
      `${num(mean(orchardGames.map((g) => sum(g.divertsBySeat))), 2)})`,
  );
  out.push('');
  out.push('  barn cards in, by route (median cards per game):');
  out.push(
    `    harvest ${num(route('harvest'), 1)}   hand ${num(route('hand'), 1)}   ` +
      `deck ${num(route('deck'), 1)}   stack ${num(route('stack'), 1)}   ` +
      `discard ${num(route('discard'), 1)}`,
  );
  out.push('');
  out.push(
    'The hand route is O12 The Fruit Press, the Wheat hand-to-barn lines and O17 pooled; the',
  );
  out.push("divert line splits O17 back out, counted off its answer because it emits the others'");
  out.push('event. No noise floor for any of these three - run --noise before believing a delta.');
  out.push('');
  out.push(
    '⚠️ THE BOTS GIVE FREELY, by construction and not by accident: the divert seam hands over',
  );
  out.push(
    'a card that was going to a discard anyway, so the pricer - which values what a seat GAINS',
  );
  out.push(
    'and never rival harm - sees no cost at all. The giveaway figure is an UPPER BOUND, and',
  );
  out.push('whether a human hands a rival free cards is a table question, not a simulator one.');
  out.push('');
  return out;
}

/**
 * THE MANIFEST AND THE RACE - the lines the Vegetable rebuild's pass conditions
 * need and no previous run recorded (2026-08-09). (The balloon lines went with
 * the balloons on 16/09/2026.)
 *
 * Like the giveaway section, these are general questions asked of the whole
 * table rather than Vegetable diagnostics: whether the island's colour puzzle is
 * still decided once by the bag, and whether anybody is racing for a tile - the
 * flat island's only remaining time gradient.
 *
 * ⚠️ NO NOISE FLOOR YET for any of them. Run --noise before reading a movement
 * in one as a finding.
 *
 * ⚠️ AND THE BOTS CANNOT PRICE THE DENIAL HALF OF A SWAP. `outcome.ts` values
 * what a seat gains and never rival harm, so a swap here is always self-serving
 * and the swap count is an upper bound on the useful ones and no bound at all on
 * the spiteful ones.
 */
function freightSection({ data, pooled }: ReportInput): string[] {
  const games = pooled.ended;
  const out = [THIN, 'THE MANIFEST AND THE RACE  (ended games)', THIN, ''];
  if (games.length === 0) {
    out.push('  no ended games', '');
    return out;
  }
  // MEANS, not medians: only a Vegetable seat can build the cards that touch a
  // demand token, so most cells have none and the median of every line here is
  // a structural 0 that says nothing.
  const per = (f: (g: GameMetrics) => number) => mean(games.map(f));

  // DELIVERIES BY SUIT. Not a Vegetable diagnostic either, though it was added
  // for one: the island carries most of a winning score, so a suit's delivery
  // count is close to its scoring rate, and this is the line that says whether a
  // suit whose IDENTITY is Deliver actually delivers. It is the number the
  // Vegetable rebuild moved furthest and the one its own pass conditions never
  // thought to ask for.
  out.push('  island deliveries per seat, by suit:');
  out.push(
    `    ${data.cards.suits
      .map((suit) => `${suit} ${num(deliveriesBySuit(games, suit), 2)}`)
      .join('   ')}`,
  );
  out.push('');
  // CARDS INTO THE BARN BY SUIT (the Dairy rebuild, 2026-08-10). The route
  // table above is per GAME and says HOW a barn filled; this is per SEAT and
  // says WHOSE. Dairy was rebuilt on the claim that it manufactures no freight
  // - it builds the most and ships the least - so this line and the delivery
  // line above are the two that decide it.
  out.push('  cards into the barn per seat, by suit (all routes):');
  out.push(
    `    ${data.cards.suits
      .map((suit) => `${suit} ${num(barnInBySuit(games, suit), 1)}`)
      .join('   ')}`,
  );
  out.push('');
  // BUILDS BY SUIT, printed beside the two above because it is the third term
  // of the same sentence: a build is a card OFF the pipeline and into the
  // tableau, where it scores printed VP and feeds every "for each building"
  // scaler. The Build ACTION is one per turn for everybody, so any suit far
  // above the others is manufacturing builds off its own card text.
  out.push('  buildings built per seat, by suit:');
  out.push(
    `    ${data.cards.suits
      .map((suit) => `${suit} ${num(buildsBySuit(games, suit), 2)}`)
      .join('   ')}`,
  );
  out.push('');
  // ⛔ THE FARMSTEAD FLIP LINE IS GONE (v31). It reported how often and how
  // early each suit reached its upgraded Farmstead face, first as a milestone
  // and then, from 2026-08-12, as a GBP 2 purchase. Starters are single-faced
  // now: the Farmstead prints one end-game scorer and nothing flips, so there
  // is no moment to time. What replaced the question is the own-crop build
  // share (assertion 8's last detail line), because the Farmstead's VP is what
  // that share is now paying for.
  out.push(
    `  island tokens swapped per game (V5)   ${num(
      per((g) => g.demandSwaps),
      2,
    )}`,
  );
  out.push('');
  // ⭐ THE TOKEN ISLAND (16/09/2026): arrival order at a tile, the token choice
  // a first delivery makes, and receipts by token value.
  const firsts = sum(games.map((g) => sum(g.receiptsByArrivalBySeat.map((r) => r[0] ?? 0))));
  const seconds = sum(games.map((g) => sum(g.receiptsByArrivalBySeat.map((r) => r[1] ?? 0))));
  const choices = sum(games.map((g) => sum(g.firstChoicesBySeat)));
  out.push(
    `  receipts by arrival order             first ${firsts}   second ${seconds}` +
      `   first share ${pct(firsts / Math.max(1, firsts + seconds), 1)}`,
  );
  out.push(
    `  first-delivery token choices          ${choices}   took the higher VP ${pct(
      sum(games.map((g) => sum(g.firstTookHigherBySeat))) / Math.max(1, choices),
      1,
    )}   lower for a Worker ${sum(games.map((g) => sum(g.firstLowerForWorkerBySeat)))}`,
  );
  const values = data.island.tokens.vpValues;
  const byVp = (vp: number) =>
    sum(games.map((g) => sum(g.receiptsByVpBySeat.map((r) => r[String(vp)] ?? 0))));
  out.push(
    `  receipts by token value               ${values.map((vp) => `${vp} VP ${byVp(vp)}`).join('   ')}` +
      `   wild-token receipts ${sum(games.map((g) => sum(g.wildTokenReceiptsBySeat)))}`,
  );
  out.push(
    `  Vegetable board relaxation (R9)       ${sum(
      games.map((g) => sum(g.vegetableWildDeliveriesBySeat)),
    )} deliveries, ${sum(games.map((g) => sum(g.vegetableWildCardsBySeat)))} cards of any crop`,
  );
  out.push('');
  return out;
}

/**
 * THE YARD (the Dairy rebuild, 2026-08-10).
 *
 * The four lines its pass conditions need that nothing else in this report
 * prints. Two of them decide the rebuild and are NOT here, because they already
 * have homes that read them against every suit: cards into a Dairy seat's barn
 * (the freight section's route table) and deliveries per Dairy seat (the
 * by-suit delivery line above). What is here is the diagnosis.
 *
 * MEANS, not medians, and per DAIRY SEAT rather than per game: most cells have
 * no Dairy seat at all, so a table-wide median is a structural 0 that says
 * nothing - the same reasoning the manifest section states for its lines.
 */
function dairySection({ pooled }: ReportInput): string[] {
  const games = pooled.ended;
  const out = [THIN, 'THE YARD  (the Dairy rebuild, ended games)', THIN, ''];
  if (games.length === 0) {
    out.push('  no ended games', '');
    return out;
  }

  const builds: number[] = [];
  let blocked = 0;
  let sampled = 0;
  const runs: number[] = [];
  for (const g of games) {
    runs.push(...g.creameryRuns);
    g.suits.forEach((suit, seat) => {
      if (suit !== 'dairy') return;
      builds.push(g.buildsBySeat[seat] ?? 0);
      blocked += g.noBuildTurnsBySeat[seat] ?? 0;
      sampled += g.buildSampledBySeat[seat] ?? 0;
    });
  }

  if (builds.length === 0) {
    out.push('  no Dairy seat in this data set', '');
    return out;
  }

  out.push(`  builds per Dairy seat per game        ${num(mean(builds), 2)}`);
  out.push(
    `  Dairy turns with NO build available   ${pct(sampled === 0 ? NaN : blocked / sampled, 1)}` +
      `   (of ${sampled} turns; the design's own risk 1)`,
  );
  out.push(
    `  cards taken off deck tops per game    ${num(mean(games.map((g) => g.deckTopsTaken)), 1)}` +
      `   (read beside reshuffles per played deck, which must stay flat)`,
  );
  out.push(
    `  Grand Creamery runs                   ${runs.length}` +
      `   median length ${runs.length === 0 ? 'n/a' : num(median(runs), 1)}` +
      `   longest ${runs.length === 0 ? 'n/a' : Math.max(...runs)}`,
  );
  out.push('');
  out.push(
    'A median Creamery run of 1 is a disappointment machine and 3 is too strong; the dial is whether',
  );
  out.push(
    'a coin-priced card counts as cost 0 or busts the run. Deck-top pressure is the rebuild’s',
  );
  out.push(
    'likeliest external breakage - three Dairy cards pull off deck tops and D15 BUILDS them, so',
  );
  out.push(
    'they never come back. The no-build share is the screen most likely to fail at a table.',
  );
  out.push('');
  return out;
}

/**
 * THE SWARM - the Apiary rebuild's own counters (2026-08-11).
 *
 * Seven numbers, and only two of them decide the arm (Apiary's card play rate
 * and its win rate, both read off the funnel and the suit table). These are the
 * diagnosis, and one of them outranks the win rate: if `activations of a FULL
 * building` comes back near zero, the design's central claim is wrong and the
 * suit needs a harvest valve after all.
 */
function apiarySection({ pooled }: ReportInput): string[] {
  const games = pooled.ended;
  const out = [THIN, 'THE SWARM  (the Apiary rebuild, ended games)', THIN, ''];
  if (games.length === 0) {
    out.push('  no ended games', '');
    return out;
  }

  const acts: number[] = [];
  const turns: number[] = [];
  const firsts: number[] = [];
  let full = 0;
  let foreign = 0;
  let total = 0;
  let tableWide = 0;
  let offered = 0;
  for (const g of games) {
    // A5 and A12 can be BUILT by any seat, so the table-wide figure and the
    // Apiary-seat figure are different questions and both are worth printing.
    // `offered` is the ceiling the two cards bought: one firing per grow of A5,
    // two per grow of A12. The gap between it and `tableWide` is risk 1 made
    // arithmetic - activations that were offered and had nothing to aim at.
    tableWide += sum(g.activationsBySeat);
    offered += (g.cards.get('A5')?.activations ?? 0) + 2 * (g.cards.get('A12')?.activations ?? 0);
    g.suits.forEach((suit, seat) => {
      if (suit !== 'apiary') return;
      acts.push(g.activationsBySeat[seat] ?? 0);
      turns.push(g.turnsBySeat[seat] ?? 0);
      const first = g.firstActivationRoundBySeat[seat];
      if (first !== null && first !== undefined) firsts.push(first);
      full += g.activationsOfFullBySeat[seat] ?? 0;
      foreign += g.activationsOfForeignBySeat[seat] ?? 0;
      total += g.activationsBySeat[seat] ?? 0;
    });
  }

  if (acts.length === 0) {
    out.push('  no Apiary seat in this data set', '');
    return out;
  }

  const turnTotal = turns.reduce((a, b) => a + b, 0);
  out.push(
    `  activations per Apiary TURN           ${num(turnTotal === 0 ? NaN : total / turnTotal, 2)}` +
      `   (${total} firings over ${turnTotal} turns; risk 3, and the table averages 3.6 GROWs a GAME)`,
  );
  out.push(
    `  round of a seat's FIRST activation    ${firsts.length === 0 ? 'never' : num(median(firsts), 1)}` +
      `   (median; ${firsts.length} of ${acts.length} seats ever fired one. Risk 1: round 8+ means A5 needs a floor)`,
  );
  out.push(
    `  activations OFFERED, table-wide       ${offered}` +
      `   (1 per grow of A5, 2 per grow of A12, by any seat of any suit)`,
  );
  out.push(
    `  ...of which AIMED at something        ${pct(offered === 0 ? NaN : tableWide / offered, 1)}` +
      `   (${tableWide}. ⛔ THE COLD START, as arithmetic: the rest had no legal target and lapsed)`,
  );
  out.push(
    `  activations of a FULL building        ${pct(total === 0 ? NaN : full / total, 1)}` +
      `   (${full}. ⛔ NEAR ZERO MEANS THE CENTRAL CLAIM IS WRONG and the suit needs a valve)`,
  );
  out.push(
    `  activations of a FOREIGN-crop card    ${pct(total === 0 ? NaN : foreign / total, 1)}` +
      `   (${foreign}; risk 5, and A19 The Honey Hall pays for it)`,
  );
  // ⛔ TWO LINES LEFT WITH THE CURRENCY (v31): coins minted by A14 The
  // Honeycomb Tower (the suit's risk 2, the first repeatable coin faucet) and
  // market buys per game (the sink A14 and A15 existed to feed). A14 draws a
  // card per HIVE now and the market is deleted, so both questions are answered
  // by the card clock and the funnel instead.
  out.push(
    `  cards into an Apiary seat's barn      ${num(barnInBySuit(games, 'apiary'), 1)}` +
      `   (risk 4; Dairy ran 10.2 against Orchard's 25.7 and that gap was the win ranking in order)`,
  );
  out.push('');
  out.push(
    'Apiary ships with NO harvest valve, which no non-Wheat suit has been allowed since 2026-07-04, and',
  );
  out.push(
    'the full-building line is what pays for that: to every other suit a clogged building is dead weight',
  );
  out.push(
    'until an action is spent on it, and to this one it is a button. Two counters decide the arm and',
  );
  out.push(
    'neither is here - Apiary’s card play rate up from 19.9% and its win rate up from 20.7%.',
  );
  out.push('');
  return out;
}

/** Island deliveries made by the seats actually farming a given suit, per game. */
function deliveriesBySuit(games: readonly GameMetrics[], suit: string): number {
  return bySuit(games, suit, (g, seat) => g.deliveriesBySeat[seat] ?? 0);
}

/**
 * Cards that reached the barn of a seat actually farming a given suit, per
 * game, every route pooled. The Dairy rebuild's first pass condition.
 */
function barnInBySuit(games: readonly GameMetrics[], suit: string): number {
  return bySuit(games, suit, (g, seat) => g.barnInBySeat[seat] ?? 0);
}

/** Buildings put down by the seats actually farming a given suit, per game. */
function buildsBySuit(games: readonly GameMetrics[], suit: string): number {
  return bySuit(games, suit, (g, seat) => g.buildsBySeat[seat] ?? 0);
}

/** Mean of a per-seat counter over the seats actually farming a given suit. */
function bySuit(
  games: readonly GameMetrics[],
  suit: string,
  of: (g: GameMetrics, seat: number) => number,
): number {
  const per: number[] = [];
  for (const g of games) {
    g.suits.forEach((s, seat) => {
      if (s === suit) per.push(of(g, seat));
    });
  }
  return per.length === 0 ? NaN : mean(per);
}

/** ORCHARDs built, counted only in the seats that actually farmed Orchard. */
function orchardsPerOrchardSeat(games: readonly GameMetrics[]): number {
  const per: number[] = [];
  for (const g of games) {
    g.suits.forEach((suit, seat) => {
      if (suit === 'orchard') per.push(g.orchardsBuiltBySeat[seat] ?? 0);
    });
  }
  return per.length === 0 ? NaN : median(per);
}

/**
 * The action mix - not in ticket 11's list, added because the first real run
 * made the gap obvious.
 *
 * The per-card table reports whether a card was BUILT. It cannot tell you
 * whether the card ever DID anything, and the first run showed activation
 * counts near zero across the set. Without a take rate that reading is
 * ambiguous between "nobody wants to GROW" and "GROW is rarely legal", and
 * those two send a card change in opposite directions. Offered-versus-taken
 * separates them, and it costs nothing: the fold already holds `legalMoves`.
 */
function actionMix({ pooled, data }: ReportInput): string[] {
  const chosen = new Map<string, number>();
  const offered = new Map<string, number>();
  let decisions = 0;
  for (const g of pooled.ended) {
    decisions += g.moves;
    for (const [type, n] of Object.entries(g.movesChosen)) {
      chosen.set(type, (chosen.get(type) ?? 0) + n);
    }
    for (const [type, n] of Object.entries(g.movesOffered)) {
      offered.set(type, (offered.get(type) ?? 0) + n);
    }
  }
  const out = [
    THIN,
    'THE ACTION MIX  (what was taken, against the decisions it was on offer at)',
    THIN,
    '',
  ];
  out.push(
    pad('move', 16) + pad('taken', 12) + pad('offered at', 14) + pad('take rate', 12) + 'per game',
  );
  const rows = [...offered.keys()].sort((a, b) => (chosen.get(b) ?? 0) - (chosen.get(a) ?? 0));
  for (const type of rows) {
    const took = chosen.get(type) ?? 0;
    const had = offered.get(type) ?? 0;
    out.push(
      pad(type, 16) +
        pad(String(took), 12) +
        pad(String(had), 14) +
        pad(pct(had === 0 ? NaN : took / had, 1), 12) +
        num(took / Math.max(1, pooled.ended.length), 1),
    );
  }
  out.push('');
  // Ticket 45: this line used to read "a card's ability only fires on GROW, so
  // the GROW row is the ceiling on how much of the card set does anything at
  // all in a game", which is false for 47 of the 105 cards - the endgame cards
  // score without ever being activated, the Power cards fire on hooks, the
  // starters carry the suit powers, and the two Wheat fields fire on harvest.
  // Derived from the data rather than transcribed, so a retrigger cannot make
  // the sentence stale.
  const enabled = data.cards.catalogue.filter((c) => c.enabled);
  const gated = enabled.filter((c) => c.abilityTrigger.includes('onActivate')).length;
  // The ACTION cards are deliberately NOT in `gated`: they are taken instead of
  // a main action, so their ceiling is the `cardMove:action` row, not GROW.
  const acted = enabled.filter((c) => c.abilityTrigger.includes('action')).length;
  out.push(
    `${decisions} decisions across ${pooled.ended.length} ended games. GROW is what fires a ` +
      `card's printed ability, so the\nGROW row bounds how often the ${gated} ` +
      `activation-gated cards do anything - not the other ${enabled.length - gated}, which ` +
      `score at\ngame end, fire on hooks, are the starters carrying the suit powers, or (${acted} ` +
      'of them) print an ACTION\ntaken instead of a main action, whose ceiling is the ' +
      'cardMove:action row above.',
  );
  out.push('');
  return out;
}

/**
 * The chairs. New in reference-v9, and the reason the SUITS table below it is
 * worth reading at all.
 *
 * Win-share DEVIATION rather than raw win rate, because an even split is a
 * different number at every seat count and the eye should not have to do that
 * arithmetic. The band is about +/-3 points; anything past it is a defect in the
 * design, not a curiosity, and the method document calls this the most sensitive
 * number in the whole method - it moves when nothing else does.
 *
 * The gradient columns are here because the deviation says WHO wins and cannot
 * say by how much or through what. When v8's fixed seating was measured, the
 * last chair's whole deficit turned out to sit in island receipts while printed
 * VP and visits held level: the island is a race for tiles and the last seat
 * loses it. Deviation alone would never have found that.
 */
function seatTable({ pooled }: ReportInput): string[] {
  const out = [
    THIN,
    'SEATS  (seat 0 is the start player; the suits rotate, so this is the CHAIR)',
    THIN,
    '',
  ];
  out.push(
    pad('seats', 8) +
      pad('seat', 7) +
      pad('games', 8) +
      pad('win rate', 11) +
      pad('deviation', 12) +
      pad('95% interval', 18) +
      pad('mean score', 12) +
      pad('receipts', 10) +
      'turns',
  );
  for (const slice of pooled.bySeats) {
    const even = 1 / slice.seats;
    for (const s of slice.bySeatIndex) {
      const p = proportion(s.wins, s.games);
      const dev = (p.rate - even) * 100;
      out.push(
        pad(`${slice.seats}p`, 8) +
          pad(String(s.seat), 7) +
          pad(String(s.games), 8) +
          pad(pct(p.rate), 11) +
          pad(`${dev >= 0 ? '+' : ''}${num(dev, 1)} pts`, 12) +
          pad(`${pct(p.interval.lo)} - ${pct(p.interval.hi)}`, 18) +
          pad(num(s.meanScore, 1), 12) +
          pad(num(s.meanReceipts, 1), 10) +
          num(s.meanTurns, 2),
      );
    }
    out.push('');
  }
  out.push(
    'Deviation is win share minus an even split, in percentage points. The band is about +/-3.',
  );
  out.push(...noiseNote(['seat deviation']));
  out.push('');
  return out;
}

function suitTable({ pooled }: ReportInput): string[] {
  const out = [THIN, 'SUITS', THIN, ''];
  out.push(pad('suit', 14) + pad('seat-games', 12) + pad('win rate', 12) + '95% interval');
  const evenShare = mean(pooled.ended.map((g) => 1 / g.seats));
  for (const [suit, rec] of pooled.winsBySuit) {
    const p = proportion(rec.wins, rec.seats);
    out.push(
      pad(suit as Suit, 14) +
        pad(String(rec.seats), 12) +
        pad(pct(p.rate), 12) +
        `${pct(p.interval.lo)} - ${pct(p.interval.hi)}`,
    );
  }
  out.push(`  even share at these seat counts is ${pct(evenShare)}.`);
  out.push('');
  return out;
}

/**
 * The win-rate table that names `hard` - or leaves it empty.
 *
 * Ticket 11's refinement of ticket 10: the top profile takes the label only if
 * its win rate is SEPARATED from the field by more than its confidence
 * interval. Otherwise `hard` stays an alias with no bot behind it and the
 * report says so, because crowning the leader on a coin-flip gives a player who
 * picks "hard" a taste, not a stronger opponent.
 */
function botTable({ pooled }: ReportInput): string[] {
  const out = [THIN, 'BOTS', THIN, ''];
  const rows = [...pooled.winsByProfile]
    .map(([profile, rec]) => ({ profile, ...rec, p: proportion(rec.wins, rec.seats) }))
    .sort((a, b) => b.p.rate - a.p.rate);
  out.push(pad('profile', 14) + pad('seat-games', 12) + pad('win rate', 12) + '95% interval');
  for (const r of rows) {
    out.push(
      pad(r.profile, 14) +
        pad(String(r.seats), 12) +
        pad(pct(r.p.rate), 12) +
        `${pct(r.p.interval.lo)} - ${pct(r.p.interval.hi)}`,
    );
  }
  out.push('');
  const [top, second] = rows;
  if (!top || !second) {
    out.push('Not enough profiles to rank. `hard` stays an alias.');
  } else if (separated(top.p.interval, second.p.interval) && top.profile === 'hermit') {
    // The one case ticket 11's separation rule does not settle on its own.
    // `hermit` is the DESIGNATED CONTROL for assertion 8 - a bot defined by
    // refusing the mechanism the game is built on. If it tops the table that is
    // a finding about the design, not a candidate for the ladder: shipping
    // "hard = never visits anyone" would make the sim's own verdict on the hook
    // into the game's advice to the player.
    out.push(
      `hermit is separated from the field (${pct(top.p.rate)} against ${pct(second.p.rate)}, ` +
        `intervals do not overlap) - but hermit is the CONTROL for assertion 8, not a ` +
        `difficulty tier.\nA bot that refuses the game's central mechanism and wins is a ` +
        `WATCH-LIST FINDING, not a ladder decision, so \`hard\` stays an alias and HARD_TIER ` +
        `still points at "${LADDER.hard}".\nRead this line together with assertion 8.`,
    );
  } else if (separated(top.p.interval, second.p.interval)) {
    out.push(
      `${top.profile} is separated from the field (${pct(top.p.rate)} against ` +
        `${pct(second.p.rate)}, intervals do not overlap). It is the honest candidate for the ` +
        `ladder's HARD tier; HARD_TIER currently points at "${LADDER.hard}".`,
    );
  } else {
    out.push(
      `No profile is separated from the field by more than its interval ` +
        `(top ${top.profile} ${pct(top.p.rate)}, next ${second.profile} ${pct(second.p.rate)}). ` +
        `\`hard\` stays an alias with no bot behind it - which ticket 11 names as an acceptable ` +
        `outcome, because crowning the leader here would give the player a taste, not a ` +
        `stronger opponent. HARD_TIER currently points at "${LADDER.hard}".`,
    );
  }
  out.push('');
  return out;
}

function cutListSection(input: ReportInput): string[] {
  const rows = funnel(input.data, input.pooled);
  const cuts = cutList(rows);
  const out = [
    THIN,
    "THE CUT LIST  (ranked within each card's own suit-and-tier band; no CUT stamp, by design)",
    THIN,
    '',
  ];
  out.push(
    'A card at the bottom of its band with a high difficulty score is a simplification candidate. ' +
      '`noise` means\nthe 95% interval straddles the band median, so the ranking is not ' +
      'distinguishable from chance. `fuel` means the\ncard is kept willingly and then spent - ' +
      'which the design says is what the visit fee is FOR, not a fault.\n',
  );
  out.push(
    pad('card', 8) +
      pad('name', 24) +
      pad('band', 20) +
      pad('play', 8) +
      pad('vs band', 9) +
      pad('rank', 8) +
      pad('diff', 6) +
      'flags',
  );
  for (const r of cuts.slice(0, 25)) out.push(cutRow(r));
  out.push('');
  out.push('Top of the table, for contrast:');
  for (const r of cuts.slice(-5).reverse()) out.push(cutRow(r));
  out.push('');
  const fuel = cuts.filter((r) => r.fuel);
  out.push(
    `${fuel.length} of ${cuts.length} deck cards read as FUEL rather than cards ` +
      `(kept, then spent more often than built): ${fuel
        .slice(0, 12)
        .map((r) => r.id)
        .join(', ')}` +
      (fuel.length > 12 ? ', ...' : ''),
  );
  out.push('');
  return out;
}

function cutRow(r: CutRow): string {
  const flags = [r.noise ? 'noise' : '', r.fuel ? 'fuel' : ''].filter(Boolean).join(' ');
  return (
    pad(r.id, 8) +
    pad(r.name.slice(0, 23), 24) +
    pad(r.band, 20) +
    pad(pct(r.play, 0), 8) +
    pad(`${r.vsBand >= 0 ? '+' : ''}${pct(r.vsBand, 0)}`, 9) +
    pad(`${r.rankInBand}/${r.bandSize}`, 8) +
    pad(Number.isFinite(r.difficulty) ? String(r.difficulty) : '-', 6) +
    flags
  );
}

function funnelSection(input: ReportInput): string[] {
  const rows = funnel(input.data, input.pooled);
  const out = [
    THIN,
    'THE FULL FUNNEL  (surface / keep / play / junk, each conditioned on the layer above)',
    THIN,
    '',
  ];
  out.push(
    pad('card', 8) +
      pad('name', 24) +
      pad('supply', 8) +
      pad('surface', 9) +
      pad('keep', 8) +
      pad('play', 8) +
      pad('junk', 8) +
      pad('acts', 7) +
      pad('VP/g', 7) +
      pad('uplift', 8) +
      'diff',
  );
  const order: readonly FunnelRow[] = [...rows].sort(
    (a, b) =>
      a.suit.localeCompare(b.suit) || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  for (const r of order) {
    out.push(
      pad(r.id, 8) +
        pad(r.name.slice(0, 23), 24) +
        pad(String(r.inSupply), 8) +
        pad(pct(r.surface, 0), 9) +
        pad(pct(r.keep, 0), 8) +
        pad(r.starter ? 'starter' : pct(r.play, 0), 8) +
        pad(pct(r.junk, 0), 8) +
        pad(num(r.activations, 1), 7) +
        pad(num(r.vpPerGame, 1), 7) +
        pad(
          Number.isFinite(r.winUplift)
            ? `${r.winUplift >= 0 ? '+' : ''}${pct(r.winUplift, 0)}`
            : '-',
          8,
        ) +
        (Number.isFinite(r.difficulty) ? String(r.difficulty) : '-'),
    );
  }
  out.push('');
  out.push(
    'Win-rate uplift is REPORTED, never a cut criterion on its own: it is confounded (the ' +
      'evaluator builds\nthe card because its weights already like it, then wins) and 105 cards ' +
      'needs punishing n before the\ninterval is narrower than the effect.',
  );
  out.push('');
  return out;
}

/**
 * The noise floor, quoted where the number it bounds is printed rather than in a
 * footnote. The method document's section 4 is explicit about the placement:
 * "print the noise floor in the report header, not in a footnote", because a
 * reader who has to go looking will not.
 *
 * Says so loudly when it has not been measured for this reference. A stale floor
 * is worse than an absent one, since it licenses a claim about a run it never saw.
 */
function noiseNote(metrics: readonly string[]): string[] {
  // Bound locally: an imported binding is not narrowed inside a callback.
  const floor = NOISE_FLOOR;
  if (floor === null) {
    return [
      'NOISE FLOOR NOT MEASURED for this reference. Run `npm run sim -- --noise` and paste the',
      'result into NOISE_FLOOR in reference.ts. Until then nothing here has a threshold to be',
      'read against, and a small difference cannot be told from re-drawing the deck.',
    ];
  }
  const quoted = metrics
    .map((m) => {
      const v = floor.movement[m];
      return v === undefined ? null : `${m} +/-${num(v, 2)}`;
    })
    .filter((s): s is string => s !== null);
  const stale =
    floor.reference === REFERENCE.id
      ? ''
      : `  *** measured against ${floor.reference}, not ${REFERENCE.id} - re-measure ***`;
  if (quoted.length === 0) {
    return [
      `Noise floor (${floor.reference}, n=${floor.games}): not measured for this metric.${stale}`,
    ];
  }
  return [
    `Noise floor, seed to seed at n=${floor.games}: ${quoted.join(', ')}. ` +
      `A smaller difference is not a finding.${stale}`,
    // The seat figure is a maximum over every chair at every seat count, so it
    // runs high on purpose. Chair by chair the movement was under 5 points. A
    // reader who takes 6.19 as "any chair inside 6 points is fine" has the wrong
    // end of it: the +/-3 band is what the design wants, and this number says
    // the instrument cannot yet resolve it at this n.
    'That seat figure is the WORST chair at any seat count, a maximum over nine, so it runs high;',
    'per chair the movement was under 5 points. The +/-3 band is a design target, not a detection',
    'threshold, and at this n the instrument cannot separate the two.',
  ];
}

/** One entry per crop deck of the given kind, across the given games. */
function perDeck(games: readonly GameMetrics[], which: 'played' | 'neutral'): number[] {
  const out: number[] = [];
  for (const g of games) {
    for (const crop of which === 'played' ? g.suits : g.neutral) {
      out.push(g.reshufflesByCrop[crop] ?? 0);
    }
  }
  return out;
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s.slice(0, n - 1)} ` : s.padEnd(n);
}

function wrap(text: string, indent: number): string[] {
  const width = 96 - indent;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      lines.push(line);
      line = ' '.repeat(10);
    }
    line += (line.trim().length === 0 ? '' : ' ') + word;
  }
  if (line.trim().length > 0) lines.push(line);
  return lines.map((l, i) => (i === 0 ? ' '.repeat(indent) + l : l));
}
