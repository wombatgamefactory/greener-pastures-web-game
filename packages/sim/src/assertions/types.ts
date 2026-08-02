/**
 * What an assertion IS, per ticket 11 section 8.
 *
 * Each of the 13 is one file declaring: `id`, `title`, **the design quote it
 * enforces**, its shape, its threshold, whether it is taste-sensitive, and its
 * remedy - an overlay command, or the literal `no prescribed remedy`, never an
 * invented one.
 *
 * The quote is the load-bearing field. Ticket 11 section 2: thresholds come
 * from design intent expressed as shape - slope, ratio, presence, band - and
 * never from our own output, because a threshold set from a first run is a
 * snapshot test that can never fail. Where the design names no number, the
 * assertion ships as OBSERVE: measured, reported, no verdict.
 */

import type { GameData } from '@gp/data';

import type { Pooled } from '../run.js';

export type Verdict = 'PASS' | 'FAIL' | 'OBSERVE';

export interface Measurement {
  /** The number the threshold is read against. NaN when nothing could be measured. */
  readonly value: number;
  /** One line, printed on PASS and FAIL alike. */
  readonly headline: string;
  /** Supporting numbers. Printed in the full report and on any FAIL. */
  readonly detail?: readonly string[];
  readonly verdict: Verdict;
}

export interface MeasureContext {
  readonly data: GameData;
  readonly pooled: Pooled;
}

export interface Assertion {
  readonly id: number;
  readonly title: string;
  /** The design's own words. Printed on every FAIL. */
  readonly quote: string;
  /** Where the quote is from. */
  readonly source: string;
  readonly shape: string;
  readonly threshold: string;
  /** Report the four-mirror spread, because one taste could be producing the number alone. */
  readonly taste: boolean;
  /** The design's prescribed response, as a runnable command, or why there is none. */
  readonly remedy: string;
  measure(ctx: MeasureContext): Measurement;
}

export const NO_REMEDY = 'no prescribed remedy';

/** A measurement that could not be taken. Never a PASS: an absent number is not a pass. */
export function unmeasured(what: string): Measurement {
  return { value: NaN, headline: `not measured: ${what}`, verdict: 'OBSERVE' };
}
