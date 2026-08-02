import type { PolicyId } from '@gp/bots';

import type { Assertion } from './types.js';
import { seatRows } from './lib.js';
import type { SeatRow } from './lib.js';
import { mean, num, pct, proportion, separated } from '../stats.js';

/**
 * Watch-list 2, flagged in the design as "the number one thing to watch".
 *
 * The measurement's whole difficulty is finding one currency. A worker-visit
 * pays the host COINS and the visitor an ACTION, and the two are not comparable
 * on their face - which is why the ratio is taken against what the visitor GAVE
 * UP, not against what the action is worth. Placing the same card on the same
 * board for the coin payoff was available at that exact moment, so the payout
 * the visitor declined is a revealed price the table itself set. Section 7.2
 * frames the concern in precisely that pair: a rival minted "up to £3" against
 * the £1 the visitor could simply have taken.
 *
 * **The second half does not survive contact, and is deliberately demoted.**
 * Ticket 11 specified the leader-visit win rate as a second FAIL trigger. The
 * first real run showed it cannot carry a verdict: stratifying by bot profile
 * removed the obvious confound (a `hermit` never visits anybody and wins a
 * large share of its games, so unstratified the variable simply WAS "is a
 * hermit"), but a structural one remains and cannot be removed observationally.
 * A seat that is winning IS the leader, and you cannot visit yourself - so
 * "never visited the leader" is close to "led from the front", and the -48%
 * that falls out is reverse causation wearing a measurement's clothes. Answering
 * it properly needs randomised visit targeting, which is an experiment, not a
 * metric.
 *
 * So it is measured, printed with its caveat, and excluded from the verdict.
 * Ticket 11 section 2's own rule decides this: a report that will be believed
 * must not hand a made-up number the authority of a measurement.
 */
export const generosity: Assertion = {
  id: 2,
  title: 'The generosity problem',
  quote:
    'He gives a rival a card and mints them up to £3. This is the exact shape the BGG research ' +
    'flagged as the predecessor\'s #1 dislike - "reverse engine-building" resentment. It is the ' +
    'number one thing to watch. If it bites, shrink the wage (£1/£1/£2) - never remove the card.',
  source: 'docs/Unified Visit v14.md section 7.2',
  shape:
    'Ratio of host gain (the minted wage) to visitor gain (the coin payoff declined at that same ' +
    'board), per worker-visit. The leader-visit win rate is reported alongside but does NOT ' +
    'trigger the verdict - see below.',
  threshold: 'FAIL above 2.0x',
  taste: true,
  remedy:
    'npm run sim -- --watchlist --sweep=overlays/wage-shrink.overlay.json   (wages [1,1,2]; ' +
    'the design says never remove the card)',
  measure({ pooled }) {
    const visits = pooled.ended.flatMap((g) => g.workerVisits);
    const hostGain = mean(visits.map((v) => v.hostGain));
    const visitorAlt = mean(visits.map((v) => v.visitorAlternative));
    const ratio = visitorAlt > 0 ? hostGain / visitorAlt : NaN;

    const leader = leaderPenalty(seatRows(pooled.ended));
    return {
      value: ratio,
      headline:
        `host £${hostGain.toFixed(2)} per worker-visit against a declined £${visitorAlt.toFixed(2)}` +
        ` = ${ratio.toFixed(2)}x  (${visits.length} worker-visits)`,
      detail: [
        `visiting the leader moves the win rate by ${leader.delta >= 0 ? '+' : ''}` +
          `${pct(leader.delta)}, stratified by bot profile - REPORTED, NOT JUDGED: a seat that ` +
          'is winning IS the leader and so cannot visit one, which makes this variable close to ' +
          '"was ever behind" and its sign reverse causation rather than a finding',
        ...leader.strata,
      ],
      verdict: !Number.isFinite(ratio) ? 'OBSERVE' : ratio > 2.0 ? 'FAIL' : 'PASS',
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
