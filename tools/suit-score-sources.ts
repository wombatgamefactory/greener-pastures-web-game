/**
 * suit-score-sources.ts - WHERE EACH SUIT'S POINTS COME FROM.
 *
 * Reporting only. Plays games exactly the way `npm run sim -- --watchlist`
 * does - same plan generator (`planRun`/`jobsFor` off `REFERENCE`), same
 * seeds, same bot profiles, same overlay mechanism (`loadGameData`) - and
 * folds each game through the sim's own `Fold` (so every existing
 * `GameMetrics` field is available), plus a small amount of extra bookkeeping
 * this question needs and the standard fold does not carry: which seat
 * triggered the end, the round each seat's delivery count crossed 3 and 6,
 * and whether an own-suit card was still sitting unbuilt in its seat's hand
 * at the final state.
 *
 * No engine, bot, data or card file is imported for its SIDE EFFECTS and none
 * is modified. This script only calls what `packages/sim/src/job.ts` already
 * calls (`runGame`, `Fold`) plus reads the final `GameState` that `runJob`
 * itself discards.
 *
 * Usage:
 *   npx tsx tools/suit-score-sources.ts [--overlay=overlays/x.overlay.json]
 *                                        [--n=1580] [--seed=reference-v25]
 *                                        [--sample=1] [--compare=reports/watchlist-....txt]
 *
 * `--overlay` defaults to `overlays/hand-limit-7-legacy-v1.overlay.json`
 * (hand bound 7, Dean's choice for this pass). `--sample=k` keeps every k-th
 * job of the full stratified plan, for a documented subsample if a future
 * overlay makes the full n=1580 too slow to run inline; the default is 1
 * (every game), which this overlay's plan completes in under two minutes
 * single-threaded (measured: ~83s for 4,820 games, see the report header).
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import type { Card, GameData, Overlay, Suit } from '@gp/data';
import { BASE_GAME_DATA, SUITS, loadGameData, validateOverlay } from '@gp/data';
import type { CardId, GameEvent, GameState, Seat } from '@gp/engine';

import { runGame } from '../packages/sim/src/driver.js';
import { Fold } from '../packages/sim/src/observe.js';
import type { GameMetrics } from '../packages/sim/src/observe.js';
import { REFERENCE } from '../packages/sim/src/reference.js';
import { jobsFor, planRun } from '../packages/sim/src/run.js';
import type { GameJob } from '../packages/sim/src/job.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function flag(argv: readonly string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

function fromRoot(path: string): string {
  return resolve(ROOT, path);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// --- CLI ---------------------------------------------------------------

const argv = process.argv.slice(2);
const overlayPath = flag(argv, 'overlay') ?? 'overlays/hand-limit-7-legacy-v1.overlay.json';
const games = Number(flag(argv, 'n') ?? 1580);
const seed = flag(argv, 'seed') ?? REFERENCE.seed;
const sample = Number(flag(argv, 'sample') ?? 1);
const compareArg = flag(argv, 'compare');

const overlay = JSON.parse(readFileSync(fromRoot(overlayPath), 'utf8')) as Overlay;
validateOverlay(overlay, BASE_GAME_DATA);
const data: GameData = loadGameData(overlay);
const overlayName = overlay.name;

const cardsById = new Map<CardId, Card>(data.cards.catalogue.map((c) => [c.id, c]));

// --- Build the plan exactly as the watchlist does -----------------------

const opts = { reference: REFERENCE, seed, games };
const plan = planRun(data, opts);
const allJobs = jobsFor(opts, plan, seed);
const jobs: GameJob[] = sample <= 1 ? allJobs : allJobs.filter((_, i) => i % sample === 0);

process.stderr.write(
  `${REFERENCE.id} plan: ${allJobs.length} games across ${plan.cells.length} cells` +
    (sample > 1 ? `, subsampled to ${jobs.length} (every ${sample}${ordinalSuffix(sample)})\n` : `\n`),
);

function ordinalSuffix(n: number): string {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
}

// --- Per-game extras the standard Fold does not carry --------------------

interface Extras {
  endTriggerSeat: Seat | null;
  endTriggerRound: number | null;
  roundAt3BySeat: (number | null)[];
  roundAt6BySeat: (number | null)[];
  deliveriesSoFarBySeat: number[];
}

function makeExtras(seats: number): Extras {
  return {
    endTriggerSeat: null,
    endTriggerRound: null,
    roundAt3BySeat: Array.from({ length: seats }, () => null),
    roundAt6BySeat: Array.from({ length: seats }, () => null),
    deliveriesSoFarBySeat: Array.from({ length: seats }, () => 0),
  };
}

/** Tracks turnsEnded the same way Fold does, so `roundOf()` agrees with `endTriggerRound`. */
function trackExtras(extras: Extras, seats: number) {
  let turnsEnded = 0;
  const roundOf = () => Math.floor(turnsEnded / seats) + 1;
  return (pre: GameState, post: GameState, events: readonly GameEvent[]) => {
    for (const e of events) {
      if (e.e === 'delivered') {
        extras.deliveriesSoFarBySeat[e.seat] = (extras.deliveriesSoFarBySeat[e.seat] ?? 0) + 1;
        const n = extras.deliveriesSoFarBySeat[e.seat] as number;
        if (n === 3 && extras.roundAt3BySeat[e.seat] === null) extras.roundAt3BySeat[e.seat] = roundOf();
        if (n === 6 && extras.roundAt6BySeat[e.seat] === null) extras.roundAt6BySeat[e.seat] = roundOf();
      } else if (e.e === 'endTriggered') {
        extras.endTriggerSeat = e.seat;
        extras.endTriggerRound = roundOf();
      }
    }
    if (post.turnPlayer !== pre.turnPlayer) turnsEnded += 1;
  };
}

// --- Accumulators ----------------------------------------------------------

interface ScoreAcc {
  n: number;
  winN: number;
  sums: { printed: number; receipts: number; endgame: number; total: number };
  winSums: { printed: number; receipts: number; endgame: number; total: number };
}
function newScoreAcc(): ScoreAcc {
  return {
    n: 0,
    winN: 0,
    sums: { printed: 0, receipts: 0, endgame: 0, total: 0 },
    winSums: { printed: 0, receipts: 0, endgame: 0, total: 0 },
  };
}

const scoreBySuit = new Map<Suit, ScoreAcc>();
const scoreBySuitSeats = new Map<string, ScoreAcc>(); // key `${suit}:${seats}`
for (const s of SUITS) scoreBySuit.set(s, newScoreAcc());

const endTriggerBySuit = new Map<Suit, number>();
const endTriggerGames = new Map<number, number>(); // by seat count, ended games
for (const s of SUITS) endTriggerBySuit.set(s, 0);

const roundAt3BySuit = new Map<Suit, number[]>();
const roundAt6BySuit = new Map<Suit, number[]>();
const neverReached3BySuit = new Map<Suit, number>();
const neverReached6BySuit = new Map<Suit, number>();
for (const s of SUITS) {
  roundAt3BySuit.set(s, []);
  roundAt6BySuit.set(s, []);
  neverReached3BySuit.set(s, 0);
  neverReached6BySuit.set(s, 0);
}

const marginToWinnerBySuit = new Map<Suit, number[]>();
for (const s of SUITS) marginToWinnerBySuit.set(s, []);

// Section 0: score balance - a game's raw mean score can move opposite to its
// win rate (an overlay that pulls every seat's score down but this suit's
// down LESS still raises its win rate), so these read relative position
// instead: margin against the rest of the table, margin against whoever
// actually topped the score (0 for the top seat or a tie at the top, read off
// the raw totals rather than the engine's tie-break chain), score as a share
// of the top score, and finishing rank (read off `metrics.ranking`, which IS
// the engine's own tie-break chain, so "rank" agrees with who the game calls
// the winner even when two totals tie).
interface BalanceAcc {
  n: number;
  tableMargin: number[];
  winnerMargin: number[];
  shareOfWinner: number[];
  rankSum: number;
  lastCount: number;
}
function newBalanceAcc(): BalanceAcc {
  return { n: 0, tableMargin: [], winnerMargin: [], shareOfWinner: [], rankSum: 0, lastCount: 0 };
}
const balanceBySuit = new Map<Suit, BalanceAcc>();
const balanceBySuitSeats = new Map<string, BalanceAcc>(); // key `${suit}:${seats}`
for (const s of SUITS) balanceBySuit.set(s, newBalanceAcc());

const deliveriesBySuit = new Map<Suit, number[]>();
const buildsBySuit = new Map<Suit, number[]>();
for (const s of SUITS) {
  deliveriesBySuit.set(s, []);
  buildsBySuit.set(s, []);
}

// Section 3: Apiary and Wheat's own-suit cards.
interface OwnCardAcc {
  seatGames: number;
  builtSeats: number;
  activationsSum: number;
  activationsSumWhenBuilt: number;
  vpSum: number;
  unbuiltInHandAtEnd: number;
}
const FOCUS_SUITS: Suit[] = ['apiary', 'wheat'];
const ownCardStats = new Map<Suit, Map<CardId, OwnCardAcc>>();
for (const suit of FOCUS_SUITS) {
  const m = new Map<CardId, OwnCardAcc>();
  for (const c of data.cards.catalogue.filter((c) => c.suit === suit && c.type !== 'starter')) {
    m.set(c.id, {
      seatGames: 0,
      builtSeats: 0,
      activationsSum: 0,
      activationsSumWhenBuilt: 0,
      vpSum: 0,
      unbuiltInHandAtEnd: 0,
    });
  }
  ownCardStats.set(suit, m);
}
const seatGamesOfSuit = new Map<Suit, number>();
for (const s of SUITS) seatGamesOfSuit.set(s, 0);

// Section 4: built cards by (seat's suit, own/foreign, tier).
const TIERS = ['tier1', 'tier2', 'tier3', 'power', 'endgame'] as const;
type Tier = (typeof TIERS)[number];
const builtByTier = new Map<Suit, Record<'own' | 'foreign', Record<Tier, number>>>();
for (const s of SUITS) {
  builtByTier.set(s, {
    own: { tier1: 0, tier2: 0, tier3: 0, power: 0, endgame: 0 },
    foreign: { tier1: 0, tier2: 0, tier3: 0, power: 0, endgame: 0 },
  });
}

let endedGames = 0;
let notEndedGames = 0;
const notEndedOutcomes = new Map<string, number>();

// --- Run ---------------------------------------------------------------

const started = performance.now();
let lastPrint = started;

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i] as GameJob;
  const extras = makeExtras(job.seats);
  const track = trackExtras(extras, job.seats);
  const fold = new Fold(
    data,
    { seed: job.seed, cell: job.cell, suits: [...job.seating], neutral: [...job.neutral], profiles: [...job.profiles] },
    job.seats,
  );
  const result = runGame(data, {
    seed: job.seed,
    seats: job.seats,
    suits: [...job.seating],
    neutralSuits: [...job.neutral],
    policies: [...job.profiles],
    maxMoves: REFERENCE.maxMoves,
    observe: (d) => {
      fold.observe(d);
      track(d.pre, d.post, d.events);
    },
  });
  const metrics: GameMetrics = fold.finish(result.state, result.outcome, result.chooseMs, result.error ?? null);

  const now = performance.now();
  if (now - lastPrint > 2000) {
    lastPrint = now;
    process.stderr.write(`\r  ${i + 1} / ${jobs.length} games   `);
  }

  if (!metrics.ended) {
    notEndedGames += 1;
    notEndedOutcomes.set(metrics.outcome, (notEndedOutcomes.get(metrics.outcome) ?? 0) + 1);
    continue;
  }
  endedGames += 1;
  endTriggerGames.set(job.seats, (endTriggerGames.get(job.seats) ?? 0) + 1);

  const seating = job.seating;

  // Section 0: this game's totals, read once, so every seat's balance figures
  // are relative to the SAME game rather than re-summed per seat.
  const gameTotals = metrics.scores.map((s) => s.total);
  const gameTotalSum = gameTotals.reduce((a, b) => a + b, 0);
  const winningScore = gameTotals.length === 0 ? NaN : Math.max(...gameTotals);

  // Section 1: score breakdown, by suit and by (suit, seats).
  for (let seat = 0; seat < job.seats; seat++) {
    const suit = seating[seat] as Suit;
    const brk = metrics.scores[seat];
    if (!brk) continue;
    const won = metrics.winner === seat;

    // Section 0: score balance, this seat.
    {
      const othersMean = job.seats > 1 ? (gameTotalSum - brk.total) / (job.seats - 1) : NaN;
      const tableMargin = brk.total - othersMean;
      const winnerMargin = brk.total - winningScore; // <= 0; 0 for the top score, ties included
      const shareOfWinner = winningScore === 0 ? NaN : (100 * brk.total) / winningScore;
      const rank = metrics.ranking.indexOf(seat) + 1; // 1-based, via the engine's own tie-break chain
      const isLast = rank === job.seats;

      const fold0 = (acc: BalanceAcc) => {
        acc.n += 1;
        acc.tableMargin.push(tableMargin);
        acc.winnerMargin.push(winnerMargin);
        if (Number.isFinite(shareOfWinner)) acc.shareOfWinner.push(shareOfWinner);
        acc.rankSum += rank;
        if (isLast) acc.lastCount += 1;
      };
      fold0(balanceBySuit.get(suit) as BalanceAcc);
      const bKey = `${suit}:${job.seats}`;
      const bAcc = balanceBySuitSeats.get(bKey) ?? newBalanceAcc();
      fold0(bAcc);
      balanceBySuitSeats.set(bKey, bAcc);
    }

    const acc = scoreBySuit.get(suit) as ScoreAcc;
    acc.n += 1;
    acc.sums.printed += brk.printed;
    acc.sums.receipts += brk.receipts;
    acc.sums.endgame += brk.endgame;
    acc.sums.total += brk.total;
    if (won) {
      acc.winN += 1;
      acc.winSums.printed += brk.printed;
      acc.winSums.receipts += brk.receipts;
      acc.winSums.endgame += brk.endgame;
      acc.winSums.total += brk.total;
    }

    const key = `${suit}:${job.seats}`;
    const seatsAcc = scoreBySuitSeats.get(key) ?? newScoreAcc();
    seatsAcc.n += 1;
    seatsAcc.sums.printed += brk.printed;
    seatsAcc.sums.receipts += brk.receipts;
    seatsAcc.sums.endgame += brk.endgame;
    seatsAcc.sums.total += brk.total;
    if (won) {
      seatsAcc.winN += 1;
      seatsAcc.winSums.printed += brk.printed;
      seatsAcc.winSums.receipts += brk.receipts;
      seatsAcc.winSums.endgame += brk.endgame;
      seatsAcc.winSums.total += brk.total;
    }
    scoreBySuitSeats.set(key, seatsAcc);

    if (!won) {
      const winnerTotal = metrics.winner !== null ? (metrics.scores[metrics.winner]?.total ?? NaN) : NaN;
      if (Number.isFinite(winnerTotal)) {
        (marginToWinnerBySuit.get(suit) as number[]).push(winnerTotal - brk.total);
      }
    }

    (deliveriesBySuit.get(suit) as number[]).push(metrics.deliveriesBySeat[seat] ?? 0);
    (buildsBySuit.get(suit) as number[]).push(metrics.buildsBySeat[seat] ?? 0);

    seatGamesOfSuit.set(suit, (seatGamesOfSuit.get(suit) ?? 0) + 1);

    // Section 2: pace, per-seat round-at-3/6.
    const r3 = extras.roundAt3BySeat[seat] ?? null;
    const r6 = extras.roundAt6BySeat[seat] ?? null;
    if (r3 !== null) (roundAt3BySuit.get(suit) as number[]).push(r3);
    else neverReached3BySuit.set(suit, (neverReached3BySuit.get(suit) ?? 0) + 1);
    if (r6 !== null) (roundAt6BySuit.get(suit) as number[]).push(r6);
    else neverReached6BySuit.set(suit, (neverReached6BySuit.get(suit) ?? 0) + 1);
  }

  if (extras.endTriggerSeat !== null) {
    const suit = seating[extras.endTriggerSeat] as Suit;
    endTriggerBySuit.set(suit, (endTriggerBySuit.get(suit) ?? 0) + 1);
  }

  // Section 3: Apiary and Wheat's own-suit cards.
  for (const suit of FOCUS_SUITS) {
    const seat = seating.indexOf(suit);
    if (seat < 0) continue;
    const own = ownCardStats.get(suit) as Map<CardId, OwnCardAcc>;
    const hand = new Set(result.state.players[seat]?.hand ?? []);
    for (const [cardId, acc] of own) {
      acc.seatGames += 1;
      const facts = metrics.cards.get(cardId);
      const builtByThisSeat = facts?.builtBy.includes(seat) ?? false;
      if (builtByThisSeat) {
        acc.builtSeats += 1;
        acc.activationsSum += facts?.activations ?? 0;
        acc.activationsSumWhenBuilt += facts?.activations ?? 0;
        acc.vpSum += facts?.vp[seat] ?? 0;
      } else if (hand.has(cardId)) {
        acc.unbuiltInHandAtEnd += 1;
      }
    }
  }

  // Section 4: built cards by suit and tier, own vs foreign.
  for (const [cardId, facts] of metrics.cards) {
    if (facts.builtBy.length === 0) continue;
    const card = cardsById.get(cardId);
    if (!card || card.type === 'starter') continue;
    for (const seat of facts.builtBy) {
      const suit = seating[seat];
      if (!suit) continue;
      const row = builtByTier.get(suit) as Record<'own' | 'foreign', Record<Tier, number>>;
      const bucket = card.suit === suit ? row.own : row.foreign;
      bucket[card.type as Tier] += 1;
    }
  }
}
process.stderr.write(`\r  ${jobs.length} / ${jobs.length} games\n`);
const wallMs = performance.now() - started;

// --- Win-rate sanity check ------------------------------------------------

interface SuitWinRow {
  suit: Suit;
  seatGames: number;
  wins: number;
}
const winsBySuit = new Map<Suit, SuitWinRow>();
for (const s of SUITS) winsBySuit.set(s, { suit: s, seatGames: 0, wins: 0 });

// Re-derive independently from the same accumulation pass (winSums.n doubles
// as win count per suit since winN was incremented on a win).
for (const s of SUITS) {
  const acc = scoreBySuit.get(s) as ScoreAcc;
  const row = winsBySuit.get(s) as SuitWinRow;
  row.seatGames = acc.n;
  row.wins = acc.winN;
}

function findCompareFile(): string | null {
  if (compareArg) return fromRoot(compareArg);
  const dir = join(ROOT, 'reports');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  const matches = files.filter(
    (f) => f.startsWith('watchlist-') && f.includes('reference-v25') && f.includes(overlayName),
  );
  if (matches.length > 0) {
    matches.sort();
    return join(dir, matches[matches.length - 1] as string);
  }
  // Fall back to the plain reference-v25 baseline (hand bound 10), noted as such.
  const fallback = files
    .filter((f) => f.startsWith('watchlist-') && f.includes('reference-v25') && !f.includes('-hand-limit'))
    .sort();
  if (fallback.length > 0) return join(dir, fallback[fallback.length - 1] as string);
  return null;
}

interface CompareRow {
  suit: Suit;
  winRate: number;
}
function parseCompare(path: string): CompareRow[] | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const rows: CompareRow[] = [];
  for (const suit of SUITS) {
    const re = new RegExp(`^${suit}\\s+(\\d+)\\s+([\\d.]+)%`, 'm');
    const m = re.exec(text);
    if (m) rows.push({ suit, winRate: Number(m[2]) });
  }
  return rows.length === SUITS.length ? rows : null;
}

const comparePath = findCompareFile();
const compareRows = comparePath ? parseCompare(comparePath) : null;

// --- Report ----------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}
function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}
function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
/** Linear-interpolation percentile (0-100), the same method most spreadsheets default to. */
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo] as number;
  const frac = idx - lo;
  return (s[lo] as number) * (1 - frac) + (s[hi] as number) * frac;
}
function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}
/** A likely range on the MEAN (not on individual games): mean +/- 1.96 standard errors. */
function ci95(xs: readonly number[]): [number, number] {
  const m = mean(xs);
  const se = stdev(xs) / Math.sqrt(xs.length);
  return [m - 1.96 * se, m + 1.96 * se];
}

const lines: string[] = [];
const push = (s = '') => lines.push(s);

push('suit-score-sources.ts - where each suit\'s points come from');
push('='.repeat(78));
push(`instrument:   ${REFERENCE.id}, overlay "${overlayName}" (${overlayPath})`);
push(`seed:         ${seed}`);
push(`plan:         ${allJobs.length} games across ${plan.cells.length} stratified cells (n=${games} target)`);
if (sample > 1) push(`subsample:    every ${sample}${ordinalSuffix(sample)} job -> ${jobs.length} games run`);
push(`games run:    ${jobs.length} (${endedGames} ended, ${notEndedGames} not ended)`);
if (notEndedGames > 0) {
  push(`  not ended by outcome: ${[...notEndedOutcomes.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
push(`wall time:    ${(wallMs / 1000).toFixed(1)}s single-threaded (${(jobs.length / (wallMs / 1000)).toFixed(1)} games/s)`);
push('');

push('WIN-RATE SANITY CHECK');
push('-'.repeat(78));
if (compareRows) {
  push(`compared against: ${comparePath}`);
  push('suit          this script   control watchlist   diff');
  for (const s of SUITS) {
    const row = winsBySuit.get(s) as SuitWinRow;
    const mine = row.seatGames === 0 ? NaN : (100 * row.wins) / row.seatGames;
    const control = compareRows.find((r) => r.suit === s)?.winRate ?? NaN;
    const diff = mine - control;
    push(
      `${s.padEnd(13)} ${fmt(mine).padStart(5)}%       ${fmt(control).padStart(5)}%              ${diff >= 0 ? '+' : ''}${fmt(diff)} pts`,
    );
  }
  push('A diff within about 2 points at this n is within the suit table\'s own noise; see the control report\'s 95% interval column.');
} else {
  push('No control watchlist report found to compare against (looked in reports/ for a reference-v25 file matching the overlay name).');
  push('suit          this script win rate');
  for (const s of SUITS) {
    const row = winsBySuit.get(s) as SuitWinRow;
    const mine = row.seatGames === 0 ? NaN : (100 * row.wins) / row.seatGames;
    push(`${s.padEnd(13)} ${fmt(mine)}%`);
  }
}
push('');

push('SECTION 0: SCORE BALANCE BY SUIT');
push('-'.repeat(78));
push('Why this section exists: a raw mean score can move the opposite way from a suit\'s win rate.');
push('On the apiary-board-sow-hand7-v1 overlay, Apiary\'s mean total FELL (29.2 to 28.4) while its');
push('win rate ROSE (20.6% to 29.1%), because every seat\'s score fell and Apiary\'s fell less than');
push('everyone else\'s. These readings are all relative to the other seats in the SAME game, so they');
push('track position at the table rather than a raw number that a whole-game shift can drag either way.');
push('');
push('pooled, mean per seat-game:');
push('suit          n     vs table   vs winner   % of winner   typical rank   last%');
for (const s of SUITS) {
  const a = balanceBySuit.get(s) as BalanceAcc;
  const meanRank = a.n === 0 ? NaN : a.rankSum / a.n;
  push(
    `${s.padEnd(13)} ${String(a.n).padStart(5)} ${fmt(mean(a.tableMargin)).padStart(8)}   ${fmt(mean(a.winnerMargin)).padStart(8)}    ${fmt(
      mean(a.shareOfWinner),
    ).padStart(9)}%     ${fmt(meanRank, 2).padStart(9)}     ${pct(a.lastCount, a.n).padStart(6)}`,
  );
}
push('  vs table    = this seat\'s score minus the average of the OTHER seats\' scores in that game.');
push('  vs winner   = this seat\'s score minus the top score in that game (0 if this seat topped it, ties included).');
push('  % of winner = this seat\'s score as a percentage of the top score in that game.');
push('  typical rank = mean finishing position, 1 = top, read off the game\'s own tie-break order.');
push('  last%       = share of that suit\'s seat-games that finished in last place.');
push('');
push('by seat count:');
push('suit:seats     n     vs table   vs winner   % of winner   typical rank   last%');
for (const s of SUITS) {
  for (const seats of REFERENCE.seatCounts) {
    const a = balanceBySuitSeats.get(`${s}:${seats}`);
    if (!a || a.n === 0) continue;
    const meanRank = a.rankSum / a.n;
    push(
      `${`${s}:${seats}p`.padEnd(14)} ${String(a.n).padStart(5)} ${fmt(mean(a.tableMargin)).padStart(8)}   ${fmt(
        mean(a.winnerMargin),
      ).padStart(8)}    ${fmt(mean(a.shareOfWinner)).padStart(9)}%     ${fmt(meanRank, 2).padStart(9)}     ${pct(a.lastCount, a.n).padStart(6)}`,
    );
  }
}
push('');
push('distribution of the margin against the table, pooled (so a small difference between two suits, or');
push('two overlays, can be judged against how spread out one suit\'s own games already are):');
push('suit          10th   25th   typical(50th)   75th   90th   |  likely range on the mean (95%)');
for (const s of SUITS) {
  const a = balanceBySuit.get(s) as BalanceAcc;
  const xs = a.tableMargin;
  const [lo, hi] = ci95(xs);
  push(
    `${s.padEnd(13)} ${fmt(percentile(xs, 10)).padStart(6)} ${fmt(percentile(xs, 25)).padStart(6)}   ${fmt(percentile(xs, 50)).padStart(9)}    ${fmt(
      percentile(xs, 75),
    ).padStart(6)} ${fmt(percentile(xs, 90)).padStart(6)}  |  ${fmt(lo)} to ${fmt(hi)}`,
  );
}
push('');
const spreadEntries = SUITS.map((s) => ({ suit: s, m: mean((balanceBySuit.get(s) as BalanceAcc).tableMargin) }));
const spreadTop = spreadEntries.reduce((a, b) => (b.m > a.m ? b : a));
const spreadBottom = spreadEntries.reduce((a, b) => (b.m < a.m ? b : a));
const spread = spreadTop.m - spreadBottom.m;
push(
  `ONE-NUMBER SUMMARY: the spread of mean table margin across the five suits is ${fmt(spread)} points ` +
    `(${spreadTop.suit} highest at ${fmt(spreadTop.m)}, ${spreadBottom.suit} lowest at ${fmt(spreadBottom.m)}). ` +
    'This is the number a score-balance goal can be tracked on: 0 would mean every suit finishes a typical game on the same score as its table, and there is no target band on it yet.',
);
push('');

push('SECTION 1: FINAL SCORE BY SOURCE, BY SUIT');
push('-'.repeat(78));
push('mean per seat-game (all ended games this suit sat in), then winners only');
push('suit          n     printed  receipts  endgame  total  | winners: printed receipts endgame total (n)');
for (const s of SUITS) {
  const a = scoreBySuit.get(s) as ScoreAcc;
  const m = (x: number) => fmt(x / a.n);
  const wm = (x: number) => fmt(a.winN === 0 ? NaN : x / a.winN);
  push(
    `${s.padEnd(13)} ${String(a.n).padStart(5)} ${m(a.sums.printed).padStart(8)} ${m(a.sums.receipts).padStart(9)} ${m(
      a.sums.endgame,
    ).padStart(8)} ${m(a.sums.total).padStart(6)}  |  ${wm(a.winSums.printed).padStart(7)} ${wm(a.winSums.receipts).padStart(8)} ${wm(
      a.winSums.endgame,
    ).padStart(7)} ${wm(a.winSums.total).padStart(5)} (${a.winN})`,
  );
}
push('');
push('The same, split by seat count (suit:seats)');
push('suit:seats     n     printed  receipts  endgame  total');
for (const s of SUITS) {
  for (const seats of REFERENCE.seatCounts) {
    const a = scoreBySuitSeats.get(`${s}:${seats}`);
    if (!a || a.n === 0) continue;
    const m = (x: number) => fmt(x / a.n);
    push(
      `${`${s}:${seats}p`.padEnd(14)} ${String(a.n).padStart(5)} ${m(a.sums.printed).padStart(8)} ${m(a.sums.receipts).padStart(9)} ${m(
        a.sums.endgame,
      ).padStart(8)} ${m(a.sums.total).padStart(6)}`,
    );
  }
}
push('');

push('SECTION 2: GAME PACE, BY SUIT');
push('-'.repeat(78));
push('who fills their Farmstead first (triggers the end):');
push(`  ended games: ${endedGames}`);
for (const s of SUITS) {
  push(`  ${s.padEnd(11)} ${endTriggerBySuit.get(s)} (${pct(endTriggerBySuit.get(s) ?? 0, endedGames)})`);
}
push('  even share would be ~20% (5 suits), but not every game seats every suit - read against seat-games, not games.');
push('');
push('round a seat first reaches 3 deliveries, and 6 (median; "never" = share of that suit\'s seat-games that did not reach it):');
push('suit          median round @3   never-3   median round @6   never-6');
for (const s of SUITS) {
  const r3 = roundAt3BySuit.get(s) as number[];
  const r6 = roundAt6BySuit.get(s) as number[];
  const totalSeatGames = seatGamesOfSuit.get(s) ?? 0;
  push(
    `${s.padEnd(13)} ${fmt(median(r3), 1).padStart(8)}          ${pct(neverReached3BySuit.get(s) ?? 0, totalSeatGames).padStart(6)}    ${fmt(
      median(r6),
      1,
    ).padStart(8)}          ${pct(neverReached6BySuit.get(s) ?? 0, totalSeatGames).padStart(6)}`,
  );
}
push('');
push('margin to the winner, when a seat of this suit loses (mean points behind):');
for (const s of SUITS) {
  const xs = marginToWinnerBySuit.get(s) as number[];
  push(`  ${s.padEnd(11)} ${fmt(mean(xs))} pts behind (n=${xs.length})`);
}
push('');
push('deliveries and buildings per seat-game, for cross-reference against the win-rate table:');
push('suit          mean deliveries   mean buildings');
for (const s of SUITS) {
  push(
    `${s.padEnd(13)} ${fmt(mean(deliveriesBySuit.get(s) as number[])).padStart(8)}          ${fmt(
      mean(buildsBySuit.get(s) as number[]),
    ).padStart(8)}`,
  );
}
push('');

push('SECTION 3: APIARY AND WHEAT\'S OWN-SUIT CARDS');
push('-'.repeat(78));
for (const suit of FOCUS_SUITS) {
  push(`${suit.toUpperCase()} (${seatGamesOfSuit.get(suit) ?? 0} seat-games)`);
  push('card   name                          built%   mean activ. (built only)  mean VP    unbuilt-in-hand-at-end%');
  const own = ownCardStats.get(suit) as Map<CardId, OwnCardAcc>;
  for (const [cardId, acc] of own) {
    const card = cardsById.get(cardId) as Card;
    const builtShare = pct(acc.builtSeats, acc.seatGames);
    const meanActivWhenBuilt = acc.builtSeats === 0 ? NaN : acc.activationsSumWhenBuilt / acc.builtSeats;
    const meanVp = acc.builtSeats === 0 ? NaN : acc.vpSum / acc.builtSeats;
    const unbuiltShare = pct(acc.unbuiltInHandAtEnd, acc.seatGames);
    push(
      `${cardId.padEnd(6)} ${card.name.slice(0, 28).padEnd(29)} ${builtShare.padStart(6)}   ${fmt(meanActivWhenBuilt).padStart(6)}                   ${fmt(
        meanVp,
      ).padStart(6)}     ${unbuiltShare.padStart(6)}`,
    );
  }
  push('  (mean activations and mean VP are conditioned on having been built; "unbuilt-in-hand-at-end%" is share of all seat-games of this suit, not just the ones that did not build it.)');
  push('');
}

push('SECTION 4: BUILT CARDS BY SUIT AND TIER, OWN vs FOREIGN');
push('-'.repeat(78));
push('mean buildings per seat-game, own-suit and foreign-suit, by tier');
push('suit          own: t1   t2   t3   pow  end | foreign: t1   t2   t3   pow  end');
for (const s of SUITS) {
  const n = seatGamesOfSuit.get(s) ?? 0;
  const row = builtByTier.get(s) as Record<'own' | 'foreign', Record<Tier, number>>;
  const o = (t: Tier) => fmt(n === 0 ? NaN : row.own[t] / n, 2);
  const f = (t: Tier) => fmt(n === 0 ? NaN : row.foreign[t] / n, 2);
  push(
    `${s.padEnd(13)}      ${o('tier1').padStart(4)} ${o('tier2').padStart(4)} ${o('tier3').padStart(4)} ${o('power').padStart(4)} ${o(
      'endgame',
    ).padStart(4)} |          ${f('tier1').padStart(4)} ${f('tier2').padStart(4)} ${f('tier3').padStart(4)} ${f('power').padStart(4)} ${f(
      'endgame',
    ).padStart(4)}`,
  );
}
push('  raw totals (own / foreign), for reference:');
for (const s of SUITS) {
  const row = builtByTier.get(s) as Record<'own' | 'foreign', Record<Tier, number>>;
  const sumOwn = TIERS.reduce((a, t) => a + row.own[t], 0);
  const sumForeign = TIERS.reduce((a, t) => a + row.foreign[t], 0);
  push(
    `  ${s.padEnd(11)} own ${sumOwn} (${TIERS.map((t) => `${t}:${row.own[t]}`).join(' ')})  foreign ${sumForeign} (${TIERS.map(
      (t) => `${t}:${row.foreign[t]}`,
    ).join(' ')})`,
  );
}
push('');

push('WHAT COULD NOT BE MEASURED HERE, AND WHY');
push('-'.repeat(78));
push('- Per-card activation counts are GAME totals attributed to the single seat that built the');
push('  card (a specific card id has at most one physical copy in a game, so this is exact, not an');
push('  approximation) - but they cannot be split further into WHEN in the game an activation fired,');
push('  only how many.');
push('- "Unbuilt in hand at game end" reads the final GameState directly (no engine change - the sim');
push('  already holds this state; runJob simply discards it, this script does not). It cannot say');
push('  whether a card sat in hand the WHOLE game or arrived on the final turn; only that it was');
push('  there when the game stopped.');
push('- The margin-to-winner and end-trigger readings are pooled across seat counts. A seat-count');
push('  split exists in Section 1 and could be extended to Sections 2-4 if wanted; skipped here to');
push('  keep the report to one pass over the same instrument the brief asked for.');
push('- Card VP in Section 3 is the ENGINE\'S per-seat vp[] field on CardFacts (printed VP plus any');
push('  end-game formula for that specific card only) - it does not include the Barn\'s own-crop');
push('  scorer or any other card\'s contribution, which is why Section 1\'s "endgame" column is the');
push('  one to read for a suit\'s total end-game VP.');
push('');

const report = lines.join('\n') + '\n';
const outDir = join(ROOT, 'reports');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `analysis-${stamp()}-suit-score-sources-${overlayName}.txt`);
writeFileSync(outFile, report, 'utf8');
process.stdout.write(report);
process.stdout.write(`\nWritten to ${outFile}\n`);
