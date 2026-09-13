import type { GameData } from '@gp/data';
import {
  isMeepleCurrency,
  isNoticeBoardPower,
  noticeBoardBlocks,
  noticeBoardsPerSeat,
} from '@gp/data';

import type { Assertion, Measurement, MeasureContext } from './types.js';
import { NO_REMEDY } from './types.js';
import { mean, median, num, pct, sum } from '../stats.js';

/**
 * NEW ON 10/09/2026 WITH THE NOTICE-BOARD VISIT, and it exists because a rule
 * was written specifically to prevent a failure that nothing in this suite
 * could see.
 *
 * ## ⭐⭐ WHY IT EXISTS: `3+` IS AN ANSWER TO A DOCUMENTED FAILURE
 *
 * S8, Dean 10/09/2026: **the Notice Board's threshold is `3+`, and the plus sign
 * is the rule.** Three is the MINIMUM before the owner may harvest, never a
 * maximum load. Cards can always be added, nothing ever blocks, and the owner
 * chooses when to cash in. The handoff gives the reason in one sentence and it
 * is not a preference: *the game stalls when nobody wants to load*, which is a
 * documented failure in **the predecessor game**. A BLOCKING board
 * can be shut by an owner who simply declines to harvest, and at two players
 * there are only two boards on the table - so one sulking owner halves the
 * game's interaction and the other player cannot do anything about it.
 *
 * ⭐ **THE FACE PRINTS `3+` AND NOT `3` FOR THIS REASON ALONE** (Dean,
 * 10/09/2026): the plus sign is the only thing telling a reader it is a floor
 * rather than a ceiling.
 *
 * ## ⛔ AND THE OLD PROBE HAS STOPPED ANSWERING THE QUESTION
 *
 * `a04-door-clog` asks "is this seat's Notice Board FULL", off `isFull`. Under
 * `3+` a board is never full - `thresholdShuts` answers false for it, so
 * `isFull` answers false however deep the stack goes - and a04 therefore reads
 * a **GENUINE and permanent 0%** under this mode. ⚠️ **That 0% is not a bug and
 * must not be treated as one.** It is the correct answer to a question that has
 * stopped being interesting: nothing refuses a play, so nothing clogs.
 *
 * The question that IS interesting is the one S8 was written against, and it
 * needs a different predicate and a different shape: **how often does a board
 * sit at or above its threshold UNHARVESTED, and for how long?** That is
 * `isHarvestable` plus a run length, and it is what this assertion counts.
 *
 * ## What it counts, and where it samples
 *
 * ⭐ **THE SAMPLING POINT IS THE WHOLE OF THE MEANING.** Each of a seat's boards
 * is sampled once at THAT SEAT'S OWN turn boundary, not once per seat at every
 * turn boundary the way the door clog is. So:
 *
 *   - the SHARE is "at the end of what fraction of my own turns was my board
 *     sitting harvestable and uncleared";
 *   - a RUN of k is "k of my own turns went by and I did not clear it", which
 *     is a unit a reader can act on and a designer can price against an action.
 *
 * ⚠️ **IT THEREFORE CANNOT SEE A BOARD THAT FILLED AND WAS CLEARED INSIDE ONE
 * ROUND, and that is deliberate**: a board its owner cleared at the first
 * opportunity never stalled. The cost, stated rather than hidden, is that this
 * is a FLOOR on how often a board is loaded and never an estimate of it.
 *
 * ⭐ **RUNS STILL OPEN AT GAME END ARE KEPT APART FROM COMPLETED ONES.** An
 * unfinished run is right-censored: the board was never cleared and the game
 * simply stopped, so its true length is unknown and at least what was measured.
 * Pooling the two would average away exactly the failure this reading is
 * hunting.
 *
 * ## ⛔ AND IT RUNS PER BOARD SINCE DEAN'S TWO-BOARD FIX (11/09/2026)
 *
 * `rules.economy.noticeBoardsBySeats` lays out TWO Notice Boards in front of
 * every seat at two seats - the seat's own suit's, plus one drawn at random
 * from the suits nobody is farming. The probe sampled the own-suit board alone
 * and missed the extra one entirely, so it now samples EVERY board a seat holds
 * and keys its run state on the BOARD CARD rather than on the seat.
 *
 * ⚠️ **THE HALVED FILL RATE IS THE READING THAT MOST NEEDS SAYING OUT LOUD**,
 * and it is open risk 2 of the arm. A seat's incoming fee traffic splits across
 * its boards, so at two seats each board fills at HALF the rate: the share of
 * board-turns spent loaded falls on arithmetic before any owner has decided
 * anything, and the same board sits UNDER its minimum for twice as long, so the
 * owner is paid later and the RUNS may lengthen as the share falls. A reader
 * who takes the lower share for an improvement has read the arithmetic as a
 * finding.
 *
 * ## ⭐ READ IT HARDEST AT TWO PLAYERS
 *
 * The handoff says so and the corpus is why. At two seats there are two boards,
 * a neighbour's gift is closest to zero-sum, and the predecessor's public record
 * carries 2-player degeneration. A stall at four seats costs the table one
 * option of four; a stall at two costs it one of two, and the seat that suffers
 * cannot fix it. Every line below is printed by seat count for that reason.
 *
 * ## ⛔ NO FAIL CONDITION, AND THAT IS THE POINT RATHER THAN A GAP
 *
 * The design names no number. It does something better and more specific: it
 * writes a RULE that is supposed to make the number small (`3+`, S8) and it
 * ships the paired control that turns the rule off
 * (`overlays/notice-board-visit-blocking-v1.overlay.json`,
 * `rules.economy.noticeBoardBlocks: true`). **So the reading that matters is a
 * DELTA and not a level**, and a level threshold taken from the first run of an
 * arm nobody has played would be a snapshot test that can never fail (ticket 11
 * section 2). Run the arm and the blocking control on the same seeds and read
 * this page twice.
 *
 * ⚠️ **AND WHAT THE CONTROL MEASURES IS NOT THIS NUMBER GOING UP.** Under
 * `noticeBoardBlocks: true` a loaded board REFUSES visits, so the failure shows
 * up as a visit that could not be made rather than as a longer run - in a04's
 * clog line, in a17's rate falling, and in a08's neighbour rate falling. This
 * page is where the same fact is visible from the owner's side under BOTH
 * settings, which is why it samples under the shipped `3+` rule too.
 *
 * ## No subject under every other mode
 *
 * Under `'meeple'` the Notice Board is not a building and has no
 * threshold at all (R5); what shuts a farm there is five blocked colour slots,
 * which a04 already reads. Under `'card'` the board is an ordinary CLOGGING
 * building, so a full board refuses cards and a04's door clog is exactly the
 * right instrument for it - a stall and a clog are the same event there, and
 * measuring it twice would report one finding as two.
 */
export const boardStall: Assertion = {
  id: 20,
  title: 'The board stall',
  quote:
    'The Notice Board threshold is `3+`, and the plus sign is the rule. Three is the MINIMUM ' +
    'before the owner may harvest, not a maximum load. Cards can always be added, nothing ever ' +
    'blocks, and the owner chooses when to cash in. This is the deliberate difference from ' +
    'every other building in the game. The reason is a documented failure in the predecessor: ' +
    'the game stalls when nobody wants to load. A blocking board can be shut by an owner who ' +
    'declines to harvest, and at two players there are only two boards. [S8, Dean, 10/09/2026] ' +
    'New a20-board-stall (OBSERVE, no fail condition): how often a Notice Board sits at or ' +
    'above its threshold unharvested, and for how long. This is the predecessor’s documented ' +
    'failure and the reason S8 prints `3+`. Read it hardest at two players.',
  source:
    'docs/notice-board-visit-handoff-2026-09-10-v2.md S8 of section 2.2, section 3.4 and ' +
    'reading 3 of section 4; the 887-comment BGG record of the predecessor game',
  shape:
    'The share of BOARD-TURNS - each of a seat’s Notice Boards sampled at that seat’s own turn ' +
    'boundary - that ended with the board at or above its ' +
    'threshold and uncleared, pooled and by seat count; the mean, median, p90 and max of a ' +
    'stall RUN in the owner’s own turns; runs still OPEN at game end, counted apart because ' +
    'they are right-censored; the deepest a board ever got; and the share of boards holding at ' +
    'least one card at game end, which is also the handoff’s reading 9 for A21 The Wax Hall. ' +
    '⭐ AND SINCE 11/09/2026, UNDER rules.economy.unclaimedBoardsToCentre, THE SAME FOUR ' +
    'READINGS ARE TAKEN A SECOND TIME OF THE CENTRAL PILES AND PRINTED SEPARATELY: the share ' +
    'of pile-turns a central pile sat at or above rules.economy.commonsHarvestMin unclaimed, ' +
    'the length of an unclaimed run in TABLE turns, runs still open at game end, and how deep ' +
    'a pile ever got. ⛔ THEY ARE A DIFFERENT PHENOMENON AND NOT A SECOND MEASUREMENT OF THE ' +
    'SAME ONE: an owned board sitting harvestable is one named person declining their own ' +
    'payment, a central pile sitting harvestable is a CONTESTED PILE NOBODY HAS CLAIMED YET, ' +
    'and the two denominators differ (one seat at its own boundary against every pile at every ' +
    'boundary), so the two shares must never be diffed. ' +
    'NO SUBJECT under visitCurrency "commons" (nobody owns a board and a pile has no ' +
    'threshold), "meeple" (the board is not a building) or "card" (a full board is a CLOG and ' +
    'a04-door-clog already owns it).',
  threshold:
    'OBSERVE, and there is NO FAIL CONDITION. The design names no number: it writes a RULE ' +
    'meant to keep the number small (S8’s `3+`) and ships the paired control that turns the ' +
    'rule off (overlays/notice-board-visit-blocking-v1.overlay.json, ' +
    'rules.economy.noticeBoardBlocks true), so the reading that decides anything is a DELTA ' +
    'between the two arms on identical seeds and not a level. A level taken from the first run ' +
    'of an arm nobody has played would be a snapshot test that can never fail (ticket 11 ' +
    'section 2). ⚠️ AND a04-door-clog READS A GENUINE 0% UNDER THIS MODE, which is not a bug: ' +
    'a `3+` board is never FULL, so nothing clogs and nothing refuses a play. That is precisely ' +
    'why this assertion exists. ⛔ OBSERVE ON THE CENTRAL PILES TOO (11/09/2026) AND FOR A ' +
    'STRONGER REASON: a long unclaimed run there is genuinely ambiguous - a pile the table is ' +
    'watching grow and a pile the table has forgotten produce the same number, and nothing in ' +
    'this instrument can tell them apart. The paired reading is ' +
    'overlays/notice-board-visit-no-self-v1.overlay.json, which is the same ban with no ' +
    'centre, so its central lines have no subject and its owned lines are directly comparable.',
  // ⭐ TASTE-SENSITIVE, AND OBVIOUSLY SO ONCE STATED. Every card on a board was
  // put there by somebody choosing to visit, and every board cleared was
  // somebody choosing to spend a Harvest on their own payment rather than on
  // their own farm. A hermit's boards never fill and a socialite's fill fast, so
  // a stall rate read without the mirror spread beside it is a number one
  // archetype could be producing on its own.
  taste: true,
  remedy:
    `${NO_REMEDY} - and there is deliberately none, because this assertion cannot fail. What ` +
    'it is FOR is the paired comparison: overlays/notice-board-visit-blocking-v1.overlay.json ' +
    'is S8 turned off (rules.economy.noticeBoardBlocks true, an ordinary clogging board, which ' +
    'is the v31 rule), and the threshold sweep is ' +
    'overlays/notice-board-visit-threshold-2-v1.overlay.json and -threshold-4-v1, which is ' +
    "Dean's own pair: at 2 the owner's harvest is barely worth an action, at 4 they are paid " +
    'too late. If a table ever says the boards sit uncleared, those three arms are the ' +
    'evidence and the answer is a threshold change rather than a new rule.',
  measure(ctx) {
    if (!isNoticeBoardPower(ctx.data)) return noSubject(ctx.data);
    return stallMode(ctx);
  },
};

function stallMode({ data, pooled }: MeasureContext): Measurement {
  const games = pooled.ended;
  const sampled = sum(games.map((g) => sum(g.boardSampledTurnsBySeat)));
  const loaded = sum(games.map((g) => sum(g.boardHarvestableTurnsBySeat)));

  if (games.length === 0 || sampled === 0) {
    return {
      value: NaN,
      headline: 'not measured: no seat ever finished a turn',
      verdict: 'OBSERVE',
    };
  }

  const value = loaded / sampled;
  const runs = games.flatMap((g) => g.boardStallRuns);
  const open = games.flatMap((g) => g.boardStallRunsOpenAtEnd);
  const deepest = games.flatMap((g) => g.boardMaxStackBySeat);
  const atEnd = games.flatMap((g) => g.boardCardsAtEndBySeat.slice(0, g.seats));
  const threshold = data.rules.economy.noticeBoardThreshold;
  const blocks = noticeBoardBlocks(data);
  // ⭐ BOARDS AND NOT SEATS (Dean's two-board fix, 11/09/2026). A seat lays out
  // TWO Notice Boards at two seats under `rules.economy.noticeBoardsBySeats`,
  // so "boards holding a card at game end" stopped being a per-seat question:
  // A21 The Wax Hall scores a BUILDING holding a card (S16) and a seat is not a
  // building. `boardsAtEnd` and `boardsHoldingAtEnd` are the per-board
  // population and are identical to the seat counts in every game that lays out
  // one board each.
  const boardsAtEnd = sum(games.map((g) => g.boardsAtEnd));
  const boardsHolding = sum(games.map((g) => g.boardsHoldingAtEnd));
  // ⭐ IS THIS THE TWO-BOARD ARM? Asked of the KNOB and not of the games, so the
  // line fires on a run that produced no two-seat games as well - a banner that
  // depends on the sample is a banner that disappears when the sample is thin.
  const twoBoards = [1, 2, 3, 4].some((n) => noticeBoardsPerSeat(data, n) > 1);

  // ⭐ BY SEAT COUNT, AND THE 2-PLAYER ROW IS THE ONE TO READ. The handoff says
  // so and the corpus is why: two seats means two boards, so a stall costs the
  // table one option of two rather than one of four, and the seat that suffers
  // cannot fix it.
  const rows = [...pooled.bySeats]
    .sort((a, b) => a.seats - b.seats)
    .map((slice) => {
      const s = sum(slice.ended.map((g) => sum(g.boardSampledTurnsBySeat)));
      const l = sum(slice.ended.map((g) => sum(g.boardHarvestableTurnsBySeat)));
      const r = slice.ended.flatMap((g) => g.boardStallRuns);
      const o = slice.ended.flatMap((g) => g.boardStallRunsOpenAtEnd);
      const ba = sum(slice.ended.map((g) => g.boardsAtEnd));
      const bh = sum(slice.ended.map((g) => g.boardsHoldingAtEnd));
      return {
        seats: slice.seats,
        // ⭐ BOARDS PER SEAT, WHICH IS THE DIVISOR ON EVERY LINE BELOW AND NOT A
        // DETAIL. At two seats under Dean's two-board fix a seat's incoming fee
        // traffic splits across TWO boards, so each one fills at half the rate
        // and sits under its minimum for twice as long.
        boards: noticeBoardsPerSeat(data, slice.seats),
        share: s === 0 ? NaN : l / s,
        meanRun: mean(r),
        maxRun: r.length === 0 ? NaN : Math.max(...r),
        openPerGame: slice.ended.length === 0 ? NaN : o.length / slice.ended.length,
        holding: ba === 0 ? NaN : bh / ba,
      };
    });

  const detail = [
    `⭐ WHY THIS PAGE EXISTS, IN ONE SENTENCE: S8 prints \`${threshold}+\` on the Notice Board ` +
      'because a documented failure in the predecessor is that the game stalls when nobody ' +
      'wants to load, and a BLOCKING board can be shut by an owner who declines to harvest. ' +
      `Under this run the threshold is ${threshold} and it is a ` +
      `${blocks ? 'CEILING (rules.economy.noticeBoardBlocks TRUE - this is the paired CONTROL, an ordinary clogging board, the v31 rule)' : 'FLOOR (rules.economy.noticeBoardBlocks false - S8 as shipped: cards may always be added and nothing ever refuses a play)'}.`,
    `⛔ AND a04-door-clog READS A GENUINE 0% UNDER THE SHIPPED SETTING, WHICH IS NOT A BUG. It ` +
      'asks "is this board FULL", off `isFull`; a `3+` board is never full however deep the ' +
      'stack goes, so the honest answer is 0% for ever. This page asks the question that ' +
      'replaced it - is the board LOADED AND UNCLEARED - off `isHarvestable`, which stopped ' +
      'being the same boolean on 10/09/2026.',
    `THE STALL SHARE: ${pct(value)} of ${sampled} BOARD-TURNS ended with that board at or ` +
      `above ${threshold} cards and uncleared. ⭐ BY SEAT COUNT, AND READ THE 2p ROW ` +
      `HARDEST: ${rows
        .map(
          (r) =>
            `${r.seats}p ${pct(r.share)} (${r.boards} board${r.boards === 1 ? '' : 's'} a seat)`,
        )
        .join('  ')}. The corpus records 2-player degeneration in the original, and a ` +
      'stall at two seats costs the table a larger share of its options than a stall at four.' +
      (twoBoards
        ? ' ⛔⛔ AND THE DENOMINATOR IS BOARD-TURNS AND NOT OWNER TURNS, WHICH IS THE LINE ' +
          "THAT STOPS A LOWER NUMBER HERE BEING READ AS AN IMPROVEMENT. Dean's two-board fix " +
          'lays out TWO Notice Boards in front of every seat at two seats, so a seat’s incoming ' +
          'fee traffic SPLITS and EACH BOARD FILLS AT HALF THE RATE. A board that fills at half ' +
          'the rate reaches its minimum half as often, so the share of board-turns spent loaded ' +
          'falls on arithmetic alone, before any owner has decided anything. ⚠️ THAT IS OPEN ' +
          'RISK 2 OF THE ARM AND IT CUTS BOTH WAYS: the same board sits UNDER its minimum for ' +
          'twice as long, so the owner is paid later and the stall RUNS below may lengthen even ' +
          'as this share falls. Read the two lines together, and read them against ' +
          'overlays/notice-board-visit-no-self-v1.overlay.json on identical seeds, where a seat ' +
          'has one board and the traffic is not split.'
        : ''),
    `⚠️ THE SAMPLING POINT IS THE WHOLE OF THE MEANING, so it is stated rather than assumed: ` +
      "each board is sampled once at ITS OWN OWNER'S turn boundary, not once per seat at every " +
      'turn boundary the way the door clog is. So the denominator is the owner’s own turns, ' +
      'counted ONCE PER BOARD THEY HOLD, and the question is "did you leave this board of yours ' +
      'loaded". ⛔ IT CANNOT SEE A BOARD THAT ' +
      'FILLED AND WAS CLEARED INSIDE ONE ROUND, deliberately: a board the owner cleared at the ' +
      'first opportunity never stalled. This is therefore a FLOOR on how often a board is ' +
      'loaded and never an estimate of it. ⛔ AND THE RUN STATE IS KEYED ON THE BOARD CARD, so ' +
      'two boards in one tableau keep two independent histories: a seat-keyed counter would ' +
      'splice them and report a stall that never happened.',
    `THE LENGTH OF A STALL, in the owner's OWN turns, over ${runs.length} completed runs: ` +
      `mean ${num(mean(runs), 2)}, median ${num(median(runs), 1)}, p90 ` +
      `${num(percentile(runs, 0.9), 1)}, max ${runs.length === 0 ? '-' : Math.max(...runs)}. ` +
      `By seat count (mean / max): ${rows
        .map((r) => `${r.seats}p ${num(r.meanRun, 2)} / ${num(r.maxRun, 0)}`)
        .join('  ')}. A run opens at the first of the owner's turn boundaries with the board ` +
      'loaded and closes when a later one finds it below the threshold, which under these ' +
      'rules means they harvested it.',
    `⭐ RUNS STILL OPEN WHEN THE GAME ENDED - boards NOBODY EVER CLEARED - counted apart from ` +
      `the completed ones: ${open.length} of them over ${games.length} games ` +
      `(${num(games.length === 0 ? NaN : open.length / games.length, 2)} a game), running ` +
      `mean ${num(mean(open), 2)} and max ${open.length === 0 ? '-' : Math.max(...open)} owner ` +
      `turns when the game stopped. By seat count, per game: ${rows
        .map((r) => `${r.seats}p ${num(r.openPerGame, 2)}`)
        .join('  ')}. ⚠️ THEY ARE KEPT APART BECAUSE THEY ARE RIGHT-CENSORED: the true length ` +
      'is unknown and at least what was measured, so a mean pooled with the completed runs ' +
      'would quietly average away exactly the failure this reading is hunting.',
    `HOW DEEP A BOARD EVER GOT: mean of each seat's DEEPEST board ${num(mean(deepest), 2)} cards, ` +
      `median ${num(median(deepest), 1)}, worst on the table ` +
      `${deepest.length === 0 ? '-' : Math.max(...deepest)}. ` +
      (blocks
        ? '⚠️ UNDER THE BLOCKING CONTROL THIS IS CAPPED BY CONSTRUCTION at the threshold, so ' +
          'it is a check that the cap holds rather than a reading about the design.'
        : `⭐ UNDER S8 THERE IS NO CAP AT ALL, so this says how far past ${threshold} a real ` +
          'table is willing to let a board run. A maximum that never leaves the threshold is ' +
          'owners clearing at the first opportunity, which is `3+` costing nothing; one that ' +
          'runs far past it is a board being used as a bank.'),
    `⭐ BOARDS HOLDING AT LEAST ONE CARD AT GAME END: ${pct(boardsAtEnd === 0 ? NaN : boardsHolding / boardsAtEnd)} ` +
      `of ${boardsAtEnd} BOARDS over ${atEnd.length} seat-games (${sum(atEnd)} cards left ` +
      `standing in all). By seat ` +
      `count: ${rows.map((r) => `${r.seats}p ${pct(r.holding)}`).join('  ')}. ⚠️ THE ` +
      'DENOMINATOR IS BOARDS AND NOT SEATS, which is the same figure in every game that lays ' +
      "out one board each and half the figure at two seats under Dean's two-board fix. ⭐ THIS IS ALSO " +
      "THE HANDOFF'S READING 9 FOR A21 THE WAX HALL, which scores 1 VP for each of your " +
      'buildings holding a card and counts the Notice Board again under S16. The closer this ' +
      'is to 100%, the more that point is FREE rather than earned - and if it reads that way ' +
      'at a table, the handoff says the card is the thing to change and not the rule. It ' +
      'carries no fail condition here for the same reason nothing else on this page does.',
    '⛔ NO FAIL CONDITION, AND THE COMPARISON IS THE READING. Every line is OBSERVE. The ' +
      'design names no number; it writes a rule meant to keep the number small and ships the ' +
      'control that turns the rule off, so run this page twice on identical seeds - the arm ' +
      'and overlays/notice-board-visit-blocking-v1.overlay.json - and read the DELTA. ' +
      '⚠️ AND EXPECT THE CONTROL TO FAIL SOMEWHERE ELSE: a blocking board refuses visits, so ' +
      'its damage shows up as a visit that could not be made (a04, a08 and a17) rather than as ' +
      'a longer run here. This page is where the owner’s side of the same fact is visible ' +
      'under both settings.',
  ];

  return {
    value,
    headline:
      `TWO KINDS OF BOARD. OWNED: sat loaded and uncleared at the end of ${pct(value)} of ` +
      `${sampled} BOARD-TURNS (threshold ${threshold}${blocks ? ', BLOCKING - the control' : '+, S8'}); ` +
      `mean stall ${num(mean(runs), 2)} owner turns over ${runs.length} runs, ${open.length} ` +
      `still open at game end; 2p reads ${pct(rows[0]?.share ?? NaN)}` +
      (twoBoards
        ? ' ⚠️ AND TWO BOARDS A SEAT AT TWO SEATS, so the traffic splits and each board fills ' +
          'at HALF the rate: a lower share there is arithmetic before it is a finding'
        : ''),
    detail,
    verdict: 'OBSERVE',
  };
}

/** p-th percentile by nearest rank. */
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] as number;
}

/**
 * ⭐ NO SUBJECT, and it names the mode and points somewhere rather than printing
 * a blank - the pattern a08, a18 and a19 all use.
 *
 * The two other modes are subjectless for two DIFFERENT reasons, and saying
 * which one applies is the whole value of the line: under the meeple loop the
 * board is not a building, and under the v31 card game a loaded board is a
 * CLOG and a04 is exactly the right instrument for it.
 */
function noSubject(data: GameData): Measurement {
  const why = isMeepleCurrency(data)
    ? 'NO SUBJECT UNDER THE MEEPLE LOOP: the Notice Board is not a building there (R5) and ' +
      'has no threshold, so it cannot be at one. What shuts a farm under that arm is five ' +
      'blocked colour slots, and a04-door-clog already reads it.'
    : 'NO SUBJECT UNDER THE v31 CARD GAME: the Notice Board is an ordinary CLOGGING building ' +
      'there, so a loaded board refuses cards and a stall and a clog are the same event. ' +
      'a04-door-clog is the right instrument for it, and measuring it here as well would ' +
      'report one finding twice.';
  return {
    value: NaN,
    headline: why,
    detail: [
      '⭐ THIS ASSERTION IS FOR ONE RULE AND ONE MODE: S8, the `3+` Notice Board of the ' +
        'notice-board visit (rules.turn.visitCurrency "noticeBoardPower", 10/09/2026), where ' +
        'the threshold is a MINIMUM to harvest at and never a maximum load. That is the only ' +
        'game in this project where a building can be at its threshold and still accept cards, ' +
        'and therefore the only one where "loaded" and "clogged" are different questions.',
      '⛔ IT IS NOT DELETED AND ITS COUNTERS ARE NOT SAMPLED UNDER THE OTHER MODES, which is ' +
        'deliberate rather than lazy: an empty denominator reads as "not measured", which is ' +
        'the truth, where a zero numerator over a real denominator would read as "never ' +
        'stalled", which is a finding about a thing that is not in the game.',
    ],
    verdict: 'OBSERVE',
  };
}
