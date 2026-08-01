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

describe('the committed overlays', () => {
  it('has some', () => {
    expect(overlays.length + sweeps.length).toBeGreaterThan(0);
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
