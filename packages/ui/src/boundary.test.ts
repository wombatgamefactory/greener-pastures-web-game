/**
 * The hidden-information boundary, enforced rather than intended.
 *
 * Ticket 04 built one true `GameState` and a `viewFor(seat)` that redacts it,
 * and ticket 24's constraint is that "the component tree must never touch
 * GameState, or the boundary is decorative". A type import is not enough to
 * enforce that - `PlayerView` and `GameState` are both just objects - so this
 * scans the sources.
 *
 * `session/table.ts` is the single sanctioned exception: it holds the state and
 * hands out views. Everything else renders what it is given.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;

/** The one module allowed to hold state and drive the engine. */
const STATE_HOLDER = join('session', 'table.ts');

/**
 * Modules allowed to SOURCE card data, as opposed to being handed it.
 *
 * `table.ts` because it holds the game's state. `sheet/main.tsx` because it is
 * the card sheet renderer's entry point: a separate page, not part of the game,
 * whose whole job is to draw a chosen dataset and pass it down as a prop - the
 * same shape as `table.ts`, for a different consumer. The rule below exists so
 * an overlay-applied run is honoured; the sheet page renders what the shared
 * card sheet currently says, which is not an overlay-applied run and is not
 * meant to be. It still hands `GameData` to its components as a prop, so the
 * constraint that actually matters is intact.
 */
const DATA_SOURCES = [STATE_HOLDER, join('sheet', 'main.tsx')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({
  rel: path.slice(SRC.length + 1),
  text: readFileSync(path, 'utf8'),
}));

describe('the UI cannot reach past the view', () => {
  it('finds the source tree it is supposed to be scanning', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.rel === STATE_HOLDER)).toBe(true);
  });

  it('names GameState in exactly one module', () => {
    const offenders = files.filter((f) => f.rel !== STATE_HOLDER && /\bGameState\b/.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('drives the engine from exactly one module', () => {
    const engineVerbs = /\b(newGame|legalMoves|apply|viewFor|redactEvents|cloneState)\s*\(/;
    const offenders = files.filter((f) => f.rel !== STATE_HOLDER && engineVerbs.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('keeps components off the raw data files, so a tuning overlay is honoured', () => {
    // Every component takes `GameData` as a prop. A component importing
    // BASE_GAME_DATA directly would silently ignore an overlay-applied run.
    const offenders = files.filter(
      (f) => !DATA_SOURCES.includes(f.rel) && /BASE_GAME_DATA|loadGameData/.test(f.text),
    );
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });
});
