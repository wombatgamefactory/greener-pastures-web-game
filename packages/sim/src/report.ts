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
import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';
import { LADDER, POLICY_IDS } from '@gp/bots';

import { cutList, funnel } from './cutlist.js';
import type { CutRow, FunnelRow } from './cutlist.js';
import type { GameMetrics } from './observe.js';
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
  out.push(...actionMix(input));
  out.push(...seatTable(input));
  out.push(...suitTable(input));
  out.push(...botTable(input));
  out.push(...cutListSection(input));
  if (input.fullFunnel) out.push(...funnelSection(input));
  return `${out.join('\n')}\n`;
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
    `wall        ${(wallMs / 1000).toFixed(1)}s   (${num(games.length / (wallMs / 1000), 1)} games/s, single core)`,
    `engine      ${ENGINE_VERSION}, rules ${RULES_EDITION}, ${result.data.cards.catalogue.length} cards, ${POLICY_IDS.length} bots`,
    '',
    'Every number below is defined against this reference and is meaningless without it.',
    ...crashBanner(pooled),
    '',
  ];
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
function seriesSection({ pooled }: ReportInput): string[] {
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
  line(
    'end coins per player (median)',
    (g) => `£${num(median(g.flatMap((x) => x.coinsByRound.slice(-1))), 0)}`,
  );
  line('barn at game end (median)', (g) =>
    num(median(g.flatMap((x) => x.barnByRound.slice(-1))), 0),
  );
  line('deliveries per player (mean)', (g) =>
    num(mean(g.map((x) => sum(x.deliveriesBySeat) / x.seats)), 2),
  );
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
  // because a played crop's central deck is 12 cards and a neutral crop's is 18
  // - they churn at completely different rates and one pooled number describes
  // neither. See the note below the table.
  line('reshuffles per played deck', (g) => num(median(perDeck(g, 'played')), 2));
  line('reshuffles per neutral deck', (g) => num(median(perDeck(g, 'neutral')), 2));
  out.push('');
  out.push(
    'Reshuffles are the C1 line: a pool that cycles is not a pool that is sampled. A played',
  );
  out.push(
    "crop's deck holds 12 cards (setup takes 6 of its 18 into a hand and a barn); a neutral",
  );
  out.push("crop's holds 18 and loses none, which is why the two lines are printed apart. If the");
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
    'by seat count, neutral 0 / 0 / 0. No noise floor for these two yet - run --noise before',
  );
  out.push('reading a movement in them as a finding.');
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
    pick: (s: {
      printed: number;
      receipts: number;
      endgame: number;
      coinPity: number;
      total: number;
    }) => number,
  ) => pct(mean(winners.flatMap((s) => (s && s.total > 0 ? [pick(s) / s.total] : []))), 0);
  out.push(
    `  island receipts ${part((s) => s.receipts)}   printed VP ${part((s) => s.printed)}   ` +
      `endgame cards ${part((s) => s.endgame)}   coin pity ${part((s) => s.coinPity)}`,
  );
  out.push('');
  return out;
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
      pad('£/g', 7) +
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
        pad(num(r.coinsPerGame, 1), 7) +
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
