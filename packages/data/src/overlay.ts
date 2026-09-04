/**
 * Tuning overlays: the balance-experiment surface.
 *
 * An overlay is a flat map of knob path to replacement value, applied over the
 * extract at load. The extract is never edited to run an experiment, so a run's
 * numbers are always the committed numbers plus a diff you can read in one
 * screen.
 *
 * Three rules, and they are all "fail loudly":
 *
 *  1. **Leaf replacement only.** A path addresses one leaf and the value
 *     replaces it whole. Arrays are replaced, never merged. There is no deep
 *     merge, because a deep merge of two array-shaped tracks has no obviously
 *     correct answer and would need a rule nobody would remember.
 *  2. **Unknown or missing path is an error**, not a no-op. An overlay
 *     referencing a card the extract no longer has is exactly the bug you want
 *     to see: it means the experiment is measuring something that left the game.
 *  3. **Schema mismatch is an error.** A saved overlay from before a schema
 *     change is not silently reinterpreted.
 */

import { cloneData, setPath } from './paths.js';
import type { Leaf } from './paths.js';
import { listKnobs } from './knobs.js';
import type { Knob, KnobType } from './knobs.js';
import { SUITS } from './types.js';

/**
 * The closed value set behind `cropOrWild`. Kept here beside `typeMatches` so a
 * sixth crop or a renamed one cannot pass validation on one side and fail on
 * the other.
 */
const ACTIVATION_VALUES: ReadonlySet<string> = new Set<string>([...SUITS, 'wild']);

/**
 * The closed value set behind `bonusTiming`, kept here for the same reason as
 * `ACTIVATION_VALUES`: a fourth timing must not pass validation on one side of
 * the codebase and fail on the other.
 */
const BONUS_TIMING_VALUES: ReadonlySet<string> = new Set<string>(['start', 'any', 'end']);

/**
 * The closed value set behind `visitCurrency`, kept here for the same reason as
 * `BONUS_TIMING_VALUES`. Two values and no third: the meeple loop is a paired
 * arm against the shipped game, not a ladder.
 */
const VISIT_CURRENCY_VALUES: ReadonlySet<string> = new Set<string>(['card', 'meeple']);

/** The closed value set behind `balloonReward`, kept here for the same reason. */
const BALLOON_REWARD_VALUES: ReadonlySet<string> = new Set<string>([
  'draw',
  'buildDiscount',
  'sowFromHand',
  'harvestAny',
  'meepleFromBag',
]);

/** Bumped when the meaning of a knob path changes, not when a knob is added. */
export const OVERLAY_SCHEMA_VERSION = 1;

export interface Overlay {
  readonly name: string;
  readonly description?: string;
  readonly schemaVersion: number;
  /** Knob path to replacement value. */
  readonly set: Readonly<Record<string, Leaf>>;
}

export interface SweepAxis {
  readonly knob: string;
  readonly values: readonly Leaf[];
}

export interface SweepFile {
  readonly name: string;
  readonly description?: string;
  readonly schemaVersion: number;
  /** Applied to every cell before the axes. Optional. */
  readonly base?: Readonly<Record<string, Leaf>>;
  readonly sweep: readonly SweepAxis[];
}

/** One point in a sweep: a label for the report, and the overlay to run. */
export interface SweepCell {
  readonly label: string;
  readonly overlay: Overlay;
}

export class OverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayError';
  }
}

function typeMatches(type: KnobType, value: Leaf): boolean {
  switch (type) {
    case 'int':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'intOrNull':
      return value === null || (typeof value === 'number' && Number.isInteger(value));
    case 'intArray':
      return (
        Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isInteger(v))
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'cropOrWild':
      return value === null || (typeof value === 'string' && ACTIVATION_VALUES.has(value));
    case 'bonusTiming':
      return typeof value === 'string' && BONUS_TIMING_VALUES.has(value);
    case 'visitCurrency':
      return typeof value === 'string' && VISIT_CURRENCY_VALUES.has(value);
    case 'balloonReward':
      return typeof value === 'string' && BALLOON_REWARD_VALUES.has(value);
  }
}

/**
 * Paths whose leaf is printed wording. None of them is in the registry, so they
 * would fail anyway as unknown knobs; this exists so the error says WHY instead
 * of implying the path was mistyped.
 */
const TEXT_LEAF = /\.(name|abilityText|actionText|rewardText|note|sourceSheet)$/;

function describe(value: Leaf): string {
  return Array.isArray(value) ? `[${value.join(', ')}]` : JSON.stringify(value);
}

function knobIndex(data: unknown): Map<string, Knob> {
  return new Map(listKnobs(data).map((k) => [k.path, k]));
}

/**
 * Check an overlay against the data it will be applied to. Collects every
 * problem before throwing: fixing one typo at a time across ten runs is the
 * slowest possible way to write an overlay.
 */
export function validateOverlay(overlay: Overlay, data: unknown): void {
  const problems: string[] = [];

  if (overlay.schemaVersion !== OVERLAY_SCHEMA_VERSION) {
    problems.push(
      `overlay declares schemaVersion ${overlay.schemaVersion}, but this build reads ` +
        `version ${OVERLAY_SCHEMA_VERSION}. Re-check every path against --list-knobs, ` +
        `then bump the overlay.`,
    );
  }

  const knobs = knobIndex(data);
  for (const [path, value] of Object.entries(overlay.set)) {
    const knob = knobs.get(path);
    if (!knob) {
      problems.push(
        TEXT_LEAF.test(path)
          ? `'${path}' is printed wording, and an overlay may never override card text. ` +
              `The sheet is the single source of truth for wording, which is what stops the ` +
              `web game and the physical game drifting apart. Change the sheet and re-extract.`
          : `unknown knob '${path}'. Either it is not in the knob registry, or it names ` +
              `something the current data no longer has. Run --list-knobs.`,
      );
      continue;
    }
    if (!typeMatches(knob.type, value)) {
      problems.push(`knob '${path}' is ${knob.type}, but the overlay sets ${describe(value)}.`);
    }
  }

  if (problems.length > 0) {
    throw new OverlayError(
      `overlay '${overlay.name}' has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/**
 * Apply an overlay, returning a new data tree. The input is not mutated, so the
 * baseline stays available for a side-by-side report.
 */
export function applyOverlay<T>(data: T, overlay: Overlay): T {
  validateOverlay(overlay, data);
  const next = cloneData(data);
  for (const [path, value] of Object.entries(overlay.set)) {
    if (!setPath(next, path, value)) {
      // validateOverlay already proved the path resolves, so this is a bug in
      // the walker rather than a bad overlay.
      throw new OverlayError(`knob '${path}' validated but could not be written`);
    }
  }
  return next;
}

/** Guard against a sweep that quietly asks for a hundred thousand games. */
export const DEFAULT_MAX_SWEEP_CELLS = 256;

/**
 * Expand a sweep file into one overlay per cell: the cross product of the axes,
 * with `base` underneath each. This is what makes "try every end trigger from 4
 * to 10" one command instead of seven edits.
 */
export function expandSweep(
  file: SweepFile,
  maxCells: number = DEFAULT_MAX_SWEEP_CELLS,
): SweepCell[] {
  if (file.sweep.length === 0) {
    throw new OverlayError(`sweep '${file.name}' declares no axes`);
  }
  for (const axis of file.sweep) {
    if (axis.values.length === 0) {
      throw new OverlayError(`sweep '${file.name}': axis '${axis.knob}' has no values`);
    }
  }

  const total = file.sweep.reduce((n, axis) => n * axis.values.length, 1);
  if (total > maxCells) {
    const shape = file.sweep.map((a) => `${a.knob} x${a.values.length}`).join(' * ');
    throw new OverlayError(
      `sweep '${file.name}' expands to ${total} cells (${shape}), over the limit of ${maxCells}. ` +
        `Narrow an axis, or raise the limit deliberately.`,
    );
  }

  let cells: SweepCell[] = [
    {
      label: 'base',
      overlay: {
        name: file.name,
        schemaVersion: file.schemaVersion,
        set: { ...(file.base ?? {}) },
      },
    },
  ];

  for (const axis of file.sweep) {
    const next: SweepCell[] = [];
    for (const cell of cells) {
      for (const value of axis.values) {
        const label = `${axis.knob}=${describe(value)}`;
        next.push({
          label: cell.label === 'base' ? label : `${cell.label}, ${label}`,
          overlay: {
            ...cell.overlay,
            name: `${file.name} [${cell.label === 'base' ? label : `${cell.label}, ${label}`}]`,
            set: { ...cell.overlay.set, [axis.knob]: value },
          },
        });
      }
    }
    cells = next;
  }

  return cells;
}
