/**
 * Ticket 30's structural guard: nothing may remove a starter from a tableau.
 *
 * The ruling is that D14's demolish never targets a starter, and the whole fix
 * is one filter inside one function (`builtBuildings` in `handlers/dairy.ts`,
 * which was `emptyBuildings` until the Dairy rebuild widened the target set from
 * empty buildings to any built one). That is cheap to break: a second caller of
 * `fx.demolish`, or a target set assembled by hand, and the invariant is
 * silently false again - at which point `noticeBoardOf` throws from inside
 * `legalMoves` and takes the whole game down for every seat.
 *
 * ⚠️ IT USED TO GUARD TWO PRIMITIVES. `fx.coverBuilding` was the other, and it
 * is gone with the `covered` zone on 19/08/2026, when D11 The Heritage House
 * stopped building on top of things. One primitive left, one enumerator to
 * check, and the test is otherwise unchanged.
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

  it('calls the removal primitive from exactly one module', () => {
    // fx.ts DEFINES it; dairy.ts is the only place that may CALL it.
    const call = /\bfx\.demolish\s*\(/;
    const offenders = files.filter((f) => f.rel !== REMOVER && call.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('has no cover primitive left to guard', () => {
    // The `covered` zone went with D11's build-on-top (19/08/2026). This is the
    // cheap standing check that nothing has quietly put it back. Matched on the
    // CALL/DEFINITION form rather than the bare word, because fx.ts and several
    // handlers still NAME the retired primitive in their notes - which is
    // deliberate, and is how the next reader learns why it is not there.
    const declared = files.filter((f) => /coverBuilding\s*\(/.test(f.text));
    expect(declared.map((f) => f.rel)).toEqual([]);
    const zone = files.filter((f) => /^\s*covered:/m.test(f.text));
    expect(zone.map((f) => f.rel)).toEqual([]);
  });

  it('funnels the target set through the starter filter', () => {
    const dairy = files.find((f) => f.rel === REMOVER)?.text ?? '';
    // The shared count IS the target set: `builtBuildings` excludes starters by
    // definition, and D14's demolish enumerates from it. Its other readers (D9's
    // scaling discount, D13's draw, D20's endgame) mean the call count is no
    // longer a useful pin, so what is pinned is the filter itself plus the one
    // enumerator reaching for it.
    expect(dairy).toMatch(/cardById\(data, b\.card\)\.type !== 'starter'/);
    const task = dairy.slice(dairy.indexOf('    refine: {'));
    expect(task.slice(0, task.indexOf('resolve('))).toMatch(/builtBuildings\(/);
  });
});
