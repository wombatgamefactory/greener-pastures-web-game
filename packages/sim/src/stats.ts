/**
 * The statistics the report is allowed to claim.
 *
 * Small on purpose. Ticket 11's rule is that a report which will be believed
 * must not hand a made-up number the authority of a measurement, so everything
 * here either carries an interval or is honest about being a raw count. The two
 * interval forms are the two things measured: a PROPORTION (a card was built, a
 * seat won) takes a Wilson interval, which behaves at the small counts a
 * 105-card game produces; a MEAN (coins, barn size) takes the normal interval
 * on the standard error.
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

/**
 * Wilson score interval at 95%. Chosen over the textbook normal approximation
 * because half the per-card play rates are near 0, where the normal interval
 * runs off the end of the scale and reports impossible negative rates.
 */
export function wilson(successes: number, trials: number, z = 1.96): Interval {
  if (trials === 0) return { lo: NaN, hi: NaN };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denom;
  const spread = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { lo: Math.max(0, centre - spread), hi: Math.min(1, centre + spread) };
}

/** 95% interval on a mean. NaN width below 2 samples, which is the honest answer. */
export function meanInterval(xs: readonly number[], z = 1.96): Interval {
  const n = xs.length;
  const m = mean(xs);
  if (n < 2) return { lo: NaN, hi: NaN };
  const variance = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (n - 1);
  const half = (z * Math.sqrt(variance)) / Math.sqrt(n);
  return { lo: m - half, hi: m + half };
}

export interface Proportion {
  readonly successes: number;
  readonly trials: number;
  readonly rate: number;
  readonly interval: Interval;
}

export function proportion(successes: number, trials: number): Proportion {
  return {
    successes,
    trials,
    rate: trials === 0 ? NaN : successes / trials,
    interval: wilson(successes, trials),
  };
}

/** Two proportions are separated when their 95% intervals do not overlap. */
export function separated(a: Interval, b: Interval): boolean {
  if (!Number.isFinite(a.lo) || !Number.isFinite(b.lo)) return false;
  return a.lo > b.hi || b.lo > a.hi;
}

/**
 * Mean absolute change per step of a series: +1.0 is "one more coin a round".
 *
 * Ticket 44 moved assertion 1 onto this and off `growthPerStep`, because a
 * ratio is read against the level it sits on. Re-scored across the whole report
 * archive, the ratio metric **passed the run with the steepest absolute climb**
 * (reference-v1, +£1.75 a round on a £24 pile, 6.6%) and **failed the flattest**
 * (reference-v5, +£0.33 a round on a £5 pile, 21.3%) - so a rule that lowered
 * the pile without changing its shape flipped the verdict. The design's word is
 * *plateau*, which is a statement about coins, not about percentages.
 */
export function changePerStep(series: readonly number[]): number {
  const steps: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1] as number;
    const next = series[i] as number;
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    steps.push(next - prev);
  }
  return steps.length === 0 ? NaN : mean(steps);
}

/**
 * Mean per-step growth of a series, as a fraction: +0.15 is "grows 15% a step".
 *
 * Deliberately the mean of the per-step ratios rather than a fitted regression
 * slope. Assertion 1's threshold used to be stated as a percentage per step,
 * and a regression slope is in coins per step, so it would need a scale to be
 * read against - which is exactly the snapshot-derived number ticket 11 forbids.
 * Ticket 44 found the scale in the design instead (v14: one spare card a turn
 * converts to £1), so assertion 1 no longer calls this. Kept because it is the
 * right shape for any series with no natural unit.
 */
export function growthPerStep(series: readonly number[]): number {
  const steps: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1] as number;
    const next = series[i] as number;
    if (!Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0) continue;
    steps.push(next / prev - 1);
  }
  return steps.length === 0 ? NaN : mean(steps);
}

export function pct(x: number, places = 1): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(places)}%` : '-';
}

export function num(x: number, places = 1): string {
  return Number.isFinite(x) ? x.toFixed(places) : '-';
}
