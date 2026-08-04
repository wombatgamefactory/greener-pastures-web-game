/**
 * The regression fixtures: captured games that must keep behaving.
 *
 * This is ticket 31's payoff. A bug seen while playing becomes a file, the file
 * becomes a fixture, and the fixture becomes a test whose failure message is
 * "this exact game stopped working". No description of the bug is written down
 * anywhere, because the seed and the move log ARE the description (ticket 04).
 *
 * It lives in @gp/sim rather than beside the engine for the reason ticket 30
 * already hit: the engine may not do file I/O, and its tsconfig has no Node
 * types to do it with. The fixtures are engine-level in CONTENT and public-side
 * in disclosure terms - they carry a setup and a move log and not one byte of
 * anyone's note.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { BASE_GAME_DATA } from '@gp/data';
import { replayFixture } from '@gp/engine';
import type { Fixture } from '@gp/engine';

const DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

function fixtures(): { file: string; fixture: Fixture }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .map((file) => ({
      file,
      fixture: JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Fixture,
    }));
}

describe('captured regression fixtures', () => {
  const all = fixtures();

  it('has fixtures to replay', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  /**
   * Nothing private may cross into a committed fixture. `toFixture` strips by
   * naming what it keeps rather than deleting what it does not, so this is the
   * check that a hand-edited or hand-authored file did not reintroduce a field.
   */
  it('carries no note, no label and no policy list', () => {
    for (const { file, fixture } of all) {
      const keys = Object.keys(fixture).sort();
      expect(keys, file).toEqual(['dataFingerprint', 'expect', 'format', 'moves', 'setup', 'why']);
    }
  });

  it.each(all.map(({ file, fixture }) => [file, fixture] as const))(
    '%s replays as recorded',
    (file, fixture) => {
      const result = replayFixture(BASE_GAME_DATA, fixture);
      const stale =
        result.fingerprintMatches === false
          ? `\n  NOTE: recorded against data ${fixture.dataFingerprint}, this build has ` +
            `${result.actualFingerprint}. A sheet edit can make an old log illegal, which is a ` +
            `stale fixture rather than a regression - re-capture it.`
          : '';

      if (fixture.expect === 'plays') {
        expect(
          result.threw === null,
          `${file}: ${fixture.why}\n  threw at move ${result.threw?.at}: ` +
            `${result.threw?.error}${stale}`,
        ).toBe(true);
        expect(result.applied, file).toBe(fixture.moves.length);
      } else {
        expect(result.threw !== null, `${file}: ${fixture.why} - no longer throws${stale}`).toBe(
          true,
        );
      }
    },
  );
});
