/**
 * Ticket 30's structural guard: nothing may remove a starter from a tableau.
 *
 * The ruling is that D11's cover and D14's demolish never target a starter, and
 * the whole fix is one filter inside one function (`builtBuildings` in
 * `handlers/dairy.ts`, which was `emptyBuildings` until the Dairy rebuild
 * widened both target sets from empty buildings to any built one). That is cheap
 * to break: a third caller of `fx.coverBuilding` or `fx.demolish`, or a target
 * set assembled by hand, and the invariant is silently false again - at which
 * point `noticeBoardOf` throws from inside `legalMoves` and takes the whole game
 * down for every seat.
 *
 * So this reads the engine's source rather than trusting the comment. It lives
 * in @gp/sim because file I/O is exactly what the engine may not do (ticket 01),
 * a sibling of `boundary.test.ts`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ENGINE_SRC = fileURLToPath(new URL('../../engine/src', import.meta.url));

/** The one module allowed to remove a building from a tableau. */
const REMOVER = join('handlers', 'dairy.ts');

function engineSources(dir = ENGINE_SRC): { rel: string; text: string }[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return engineSources(path);
    if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) return [];
    return [{ rel: path.slice(ENGINE_SRC.length + 1), text: readFileSync(path, 'utf8') }];
  });
}

const files = engineSources();

describe('nothing can remove a starter from a tableau', () => {
  it('finds the engine sources it is supposed to be scanning', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.rel === REMOVER)).toBe(true);
    expect(files.some((f) => f.rel === 'fx.ts')).toBe(true);
  });

  it('calls the two removal primitives from exactly one module', () => {
    // fx.ts DEFINES them; dairy.ts is the only place that may CALL them.
    const call = /\bfx\.(coverBuilding|demolish)\s*\(/;
    const offenders = files.filter((f) => f.rel !== REMOVER && call.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('funnels both target sets through the starter filter', () => {
    const dairy = files.find((f) => f.rel === REMOVER)?.text ?? '';
    // The shared count IS the target set: `builtBuildings` excludes starters by
    // definition, and D11's cover and D14's demolish both enumerate from it. Its
    // other readers (D9's scaling discount, D13's draw, D20's endgame) mean the
    // call count is no longer a useful pin, so what is pinned is the filter
    // itself plus the two enumerators reaching for it and nothing else.
    expect(dairy).toMatch(/cardById\(data, b\.card\)\.type !== 'starter'/);
    for (const kind of ['cover', 'refine']) {
      const task = dairy.slice(dairy.indexOf(`    ${kind}: {`));
      expect(task.slice(0, task.indexOf('resolve(')), kind).toMatch(/builtBuildings\(/);
    }
  });
});
