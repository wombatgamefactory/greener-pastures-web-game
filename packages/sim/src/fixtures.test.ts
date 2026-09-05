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
import { BASE_GAME_DATA, loadGameData } from '@gp/data';
import { replayFixture } from '@gp/engine';
import type { Fixture } from '@gp/engine';

const DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

/**
 * ⭐ WHICH RULES A FIXTURE REPLAYS AGAINST IS READ OFF ITS FILENAME, and it is
 * the only place in the project that does anything of the kind, so it is worth
 * saying why rather than hiding it.
 *
 * A fixture is a seed and a move log and nothing else - the format is frozen and
 * asserted below, key by key, precisely so that nothing private can ride into
 * one - so it has no field in which to name the rules it was recorded under.
 * Until 04/09/2026 that cost nothing: there was one game, and a log that stopped
 * replaying was either a regression or a stale fixture to re-capture.
 *
 * Dean then ruled the meeple loop in and the v31 game did NOT go away: it is the
 * control, one flag off, at `overlays/v31-card-visit.overlay.json`. So the three
 * `-v31-` logs are not stale, they are logs of a game that is still runnable and
 * still worth guarding, and re-capturing them on top of the new rules would have
 * thrown away the only coverage the `'card'` branch has. They replay against the
 * control; the `-meeple-loop-` logs replay against the shipped default.
 *
 * A new fixture belongs to the shipped game and needs no marker. Only a log
 * deliberately captured under an arm carries one.
 *
 * ⭐ IT HAPPENED A SECOND TIME ON 05/09/2026, which is what turns a special case
 * into a convention. Dean ruled the meeple ECONOMY in - a meeple pays wherever a
 * card of its colour would and lands on a neighbour's board - so the `-meeple-
 * loop-` logs stopped being logs of the shipped game and became logs of an arm
 * that is still runnable and still worth guarding, exactly as the `-v31-` ones
 * did the day before. They now replay against `overlays/meeple-loop-v1`. ⚠️ THE
 * SHIPPED RULES CURRENTLY HAVE NO FIXTURE OF THEIR OWN: the whole-game walks in
 * `game.test.ts` and `meeple-loop.test.ts` and the `--audit` bench are what
 * cover them, and a captured R17 game would be worth having.
 */
const V31_CONTROL = loadGameData({
  name: 'v31-card-visit',
  schemaVersion: 1,
  set: {
    'rules.turn.visitCurrency': 'card',
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
  },
});

const MEEPLE_LOOP_V1 = loadGameData({
  name: 'meeple-loop-v1',
  schemaVersion: 1,
  set: {
    'rules.turn.visitCurrency': 'meeple',
    'rules.turn.meepleAsCard': false,
    'rules.turn.slotToll': null,
    'rules.turn.meepleCapPerColour': 1,
  },
});

function dataFor(file: string) {
  if (file.includes('-v31-')) return V31_CONTROL;
  if (file.includes('-meeple-loop-')) return MEEPLE_LOOP_V1;
  return BASE_GAME_DATA;
}

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
      const result = replayFixture(dataFor(file), fixture);
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
