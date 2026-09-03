import type { PolicyId } from '@gp/bots';

import type { Assertion } from './types.js';
import { NO_REMEDY } from './types.js';
import { seatRows } from './lib.js';
import type { SeatRow } from './lib.js';
import { num, pct, proportion, separated, sum } from '../stats.js';

/**
 * Watch-list 2, flagged in the design as "the number one thing to watch", and
 * RE-POINTED FOR v31 (02/09/2026) onto the only half of it that survives.
 *
 * ⛔ THE WAGE IS GONE, AND WITH IT THE RATIO THIS ASSERTION USED TO BE. Under
 * v14 a visit paid the HOST coins the bank minted and the VISITOR an action,
 * and the whole difficulty was finding one currency to compare them in - which
 * the old version solved by pricing the visitor's gain as what they GAVE UP
 * (the coin payoff the same board would have paid them for the same card, a
 * price the table itself set). v31 mints nothing at all. A visit is one card in
 * and one action out.
 *
 * So what is left of the generosity problem is exactly the card, which is what
 * the design always said was the load-bearing half: "if it bites, shrink the
 * wage - never remove the card". Your fee lands on a rival's Notice Board, they
 * Harvest it into their barn, and it arrives as the mixed colour the island
 * demands of them. Three numbers say whether that transfer is real:
 *
 *   PAID     fees placed on a rival's board - the gift as it leaves
 *   BANKED   fees the host actually harvested - the gift as it arrives
 *   LEADER   fees that went to the seat already ahead on VP
 *
 * The gap between paid and banked is the only thing that makes the transfer
 * less than total, and it is not a rounding error: a fee that dies on a board
 * nobody ever clears was never received. A HIGH banked share is the design
 * working as written ("your junk is their treasure") and simultaneously the
 * shape the BGG research flagged as the predecessor's number one dislike. This
 * instrument can measure the transfer; it cannot measure the resentment.
 *
 * ⚠️ IT IS OBSERVE NOW, and that is a demotion made on purpose rather than a
 * threshold left off. The old FAIL at 2.0x was a ratio of two coin figures and
 * both are deleted; the design names no number for the card, and inventing one
 * from this run's own output is the snapshot test ticket 11 section 2 forbids.
 *
 * **The leader half does not survive contact, and is deliberately excluded from
 * the verdict** - unchanged from the v14 version, because the confound is
 * structural rather than economic. Stratifying by bot profile removes the
 * obvious one (a `hermit` never visits anybody and wins a large share of its
 * games), but a seat that is winning IS the leader and you cannot visit
 * yourself, so "never visited the leader" is close to "led from the front" and
 * the negative that falls out is reverse causation wearing a measurement's
 * clothes. Answering it properly needs randomised visit targeting, which is an
 * experiment and not a metric.
 */
export const generosity: Assertion = {
  id: 2,
  title: 'The generosity problem',
  quote:
    'You give a rival a card. This is the exact shape the BGG research flagged as the ' +
    'predecessor\'s #1 dislike - "reverse engine-building" resentment. It is the number one ' +
    'thing to watch. If it bites, shrink the wage - NEVER remove the card. [02/09/2026] There ' +
    'is no wage left to shrink: the card is the whole of it.',
  source:
    'docs/Unified Visit v14.md section 7.2, re-pointed onto the card by ' +
    'docs/design-changes-v31-2026-09-02-v1.md (no coins)',
  shape:
    "Fees paid onto rivals' Notice Boards per game, the share of them the host actually " +
    'harvested into their own barn, and the share that went to the seat already leading. The ' +
    'leader line is reported and does NOT trigger the verdict - see below.',
  threshold:
    'OBSERVE. The wage the old 2.0x ratio was built on does not exist, and the design names no ' +
    'number for the card, so this reports the transfer and does not judge it.',
  taste: true,
  remedy:
    `${NO_REMEDY}. The design forbids the one obvious lever in as many words - never remove ` +
    'the card - and the wage it prescribes shrinking is deleted. If the transfer reads as too ' +
    'generous the levers are rules.economy.noticeBoardThreshold (a tighter board banks fewer ' +
    'fees) and rules.turn.selfVisitAllowed (which decides how much traffic crosses the table ' +
    'at all).',
  measure({ pooled }) {
    const games = pooled.ended;
    const paid = sum(games.map((g) => sum(g.freight.paidBySeat)));
    const banked = sum(games.map((g) => sum(g.freight.bankedBySeat)));
    const toLeader = sum(games.map((g) => sum(g.freight.toLeaderBySeat)));
    const perGame = games.length === 0 ? NaN : paid / games.length;
    const bankedShare = paid === 0 ? NaN : banked / paid;

    const leader = leaderPenalty(seatRows(games));
    return {
      value: perGame,
      headline:
        `${num(perGame, 2)} fees a game land on a rival's board, ` +
        `${pct(bankedShare)} of them reach the host's barn ` +
        `(${paid} paid, ${banked} banked over ${games.length} games)`,
      detail: [
        `${pct(paid === 0 ? NaN : toLeader / paid)} of fees went to the seat that was ` +
          'already the sole VP leader at that moment',
        'The banked share is the transfer made real: a fee that dies on a board nobody clears ' +
          'was never received. A high share is "your junk is their treasure" working, and it ' +
          'is the same shape the BGG research named as the resentment risk. The instrument can ' +
          'see the transfer; only a table can see the resentment.',
        `visiting the leader moves the win rate by ${leader.delta >= 0 ? '+' : ''}` +
          `${pct(leader.delta)}, stratified by bot profile - REPORTED, NOT JUDGED: a seat that ` +
          'is winning IS the leader and so cannot visit one, which makes this variable close to ' +
          '"was ever behind" and its sign reverse causation rather than a finding',
        ...leader.strata,
      ],
      verdict: 'OBSERVE',
    };
  },
};

/**
 * The leader-visit comparison, STRATIFIED BY BOT PROFILE.
 *
 * The unstratified version is worthless and the first real run proved it: a
 * `hermit` never visits anybody and wins a large share of its games, so
 * "visited the leader" and "is a hermit" are the same variable, and the raw
 * comparison reported an enormous, entirely spurious penalty. Comparing only
 * within a profile removes the confound at the cost of some power, and the
 * per-stratum lines are printed so the reader can see which profiles carry the
 * effect. A penalty counts only if EVERY stratum with a usable sample shows a
 * separated negative - one stratum is a coin flip, all of them is a signal.
 */
function leaderPenalty(rows: readonly SeatRow[]): {
  delta: number;
  penalty: boolean;
  strata: string[];
} {
  const byProfile = new Map<PolicyId, SeatRow[]>();
  for (const row of rows) {
    const profile = row.game.profiles[row.seat];
    if (!profile) continue;
    byProfile.set(profile, [...(byProfile.get(profile) ?? []), row]);
  }

  const strata: string[] = [];
  let weighted = 0;
  let weight = 0;
  let usable = 0;
  let negative = 0;
  for (const [profile, group] of [...byProfile].sort((a, b) => a[0].localeCompare(b[0]))) {
    const did = group.filter((r) => (r.game.visitsToLeaderBySeat[r.seat] ?? 0) > 0);
    const not = group.filter((r) => (r.game.visitsToLeaderBySeat[r.seat] ?? 0) === 0);
    if (did.length < 10 || not.length < 10) {
      strata.push(`  ${profile}: too few of one kind (${did.length} did, ${not.length} did not)`);
      continue;
    }
    const a = proportion(did.filter((r) => r.won).length, did.length);
    const b = proportion(not.filter((r) => r.won).length, not.length);
    const clear = separated(a.interval, b.interval);
    usable += 1;
    if (clear && a.rate < b.rate) negative += 1;
    weighted += (a.rate - b.rate) * group.length;
    weight += group.length;
    strata.push(
      `  ${profile}: ${pct(a.rate)} (n=${a.trials}) against ${pct(b.rate)} (n=${b.trials})` +
        `, delta ${a.rate - b.rate >= 0 ? '+' : ''}${pct(a.rate - b.rate)}` +
        (clear ? ' SEPARATED' : ' overlapping'),
    );
  }
  if (usable === 0) strata.push(`  no profile had enough of both kinds; delta is ${num(NaN)}`);
  return {
    delta: weight === 0 ? NaN : weighted / weight,
    penalty: usable > 0 && negative === usable,
    strata,
  };
}
