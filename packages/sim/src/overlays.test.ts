/**
 * Every overlay and sweep committed to `overlays/` must still be runnable.
 *
 * They are the balance questions we have written down, and they reference knob
 * paths by string. A re-extract that renames or removes a knob would leave them
 * silently broken until someone tried to run one, weeks later, and got an error
 * instead of an answer. This turns that into a failing test on the commit that
 * broke it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA, expandSweep, loadGameData, validateOverlay } from '@gp/data';
import type { Overlay, SweepFile } from '@gp/data';

const OVERLAY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'overlays');

function read<T>(file: string): T {
  return JSON.parse(readFileSync(join(OVERLAY_DIR, file), 'utf8')) as T;
}

const files = readdirSync(OVERLAY_DIR);
const overlays = files.filter((f) => f.endsWith('.overlay.json'));
const sweeps = files.filter((f) => f.endsWith('.sweep.json'));

/**
 * ⭐ `overlays/retired/` IS DELIBERATELY EXCLUDED FROM VALIDATION, AND THAT
 * EXCLUSION IS NOW ASSERTED RATHER THAN LEFT TO A `readdirSync` THAT HAPPENS NOT
 * TO RECURSE (09/09/2026).
 *
 * The eleven files in there describe games the engine no longer ships. They were
 * retired with the commons flip because each one's `set` is a single number
 * whose RULE has lost its subject - a supply cap or a slot toll in a game with no
 * meeples, or a turn order that is now the default - and pinning them back into
 * validity would mean adding the whole meeple-economy set beneath each, at which
 * point none of them is the arm it is named after. `overlays/retired/README.md`
 * carries the audit, one row per file.
 *
 * ## Why the exclusion is ASSERTED and not simply relied upon
 *
 * The call was between two options and both are defensible:
 *
 *   VALIDATE THEM   an overlay that names a knob the extract no longer has is
 *                   caught on the commit that broke it - which is exactly what
 *                   this file exists for.
 *   EXCLUDE THEM    a retired arm is history, and keeping history valid means
 *                   maintaining it, which is the cost the retirement was taken
 *                   to avoid.
 *
 * **EXCLUDE wins, because the retired files are not runnable by design.** Two of
 * them (`meeple-as-card-off-v1`, `bonus-first`) set a leaf to what the shipped
 * default now IS, so they would validate and mean nothing; the rest pin one knob
 * of a rule set the default no longer has, so they would validate and MISLEAD.
 * A file that passes a test and cannot answer a question is worse than one that
 * is openly out of service.
 *
 * ⛔ **BUT THE EXCLUSION MUST NOT BE ACCIDENTAL.** Until today it rested
 * entirely on `readdirSync` being non-recursive, which is a property of a call
 * nobody reading this file would notice - so a future change to a recursive walk
 * (or a glob) would silently pull eleven unmaintainable files into the suite. The
 * two tests below pin the intent: the folder EXISTS, it has a README explaining
 * itself, and NOTHING in it is validated. If a file is ever moved back out, it
 * is validated by the block above like any other, which is the whole point of
 * moving it.
 */
const RETIRED_DIR = join(OVERLAY_DIR, 'retired');
const retired = readdirSync(RETIRED_DIR).filter((f) => f.endsWith('.overlay.json'));

describe('the committed overlays', () => {
  it('has some', () => {
    expect(overlays.length + sweeps.length).toBeGreaterThan(0);
  });

  it('does not reach into overlays/retired', () => {
    // The listing above is non-recursive, and this is what says so on purpose.
    expect(retired.length, 'retired/ has files to be excluded FROM').toBeGreaterThan(0);
    for (const file of retired) {
      expect(overlays, `${file} must not be validated: it is retired`).not.toContain(file);
      expect(overlays, `${file} must not be validated: it is retired`).not.toContain(
        join('retired', file),
      );
    }
  });

  it('explains itself in overlays/retired/README.md', () => {
    // A folder of dead arms with no note is a trap: the README is what stops the
    // next session moving one back out without re-reading every path in it
    // against `npm run sim -- --list-knobs`. Its presence is asserted; its
    // completeness deliberately is NOT.
    //
    // It names several files by family with a shorthand row
    // (`meeple-as-card-cap-one-v1 . -cap-three-v1 . -toll-two-v1`), which reads
    // better than eleven near-identical rows and is the right call for a human
    // document - so a per-file `toContain` would fail on prose that is doing its
    // job. What is asserted is that the folder is documented at all and that the
    // note is substantial enough to be a note.
    const readme = readFileSync(join(RETIRED_DIR, 'README.md'), 'utf8');
    expect(readme.length, 'retired/README.md is empty or a stub').toBeGreaterThan(400);
    expect(readme, 'the README must say why these files are here').toMatch(/retired/i);
  });

  it.each(overlays)('%s validates and applies', (file) => {
    const overlay = read<Overlay>(file);
    expect(() => validateOverlay(overlay, BASE_GAME_DATA)).not.toThrow();
    expect(loadGameData(overlay)).toBeDefined();
  });

  it.each(sweeps)('%s expands to runnable cells', (file) => {
    const sweep = read<SweepFile>(file);
    const cells = expandSweep(sweep);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(() => loadGameData(cell.overlay), cell.label).not.toThrow();
    }
  });
});
