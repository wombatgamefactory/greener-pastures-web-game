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
import type { Overlay } from '@gp/data';
import { replayFixture } from '@gp/engine';
import type { Fixture } from '@gp/engine';

const DIR = fileURLToPath(new URL('../fixtures', import.meta.url));
const OVERLAY_DIR = fileURLToPath(new URL('../../../overlays', import.meta.url));

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
 * did the day before. They now replay against `overlays/meeple-loop-v1`.
 *
 * ## ⭐⭐ IT HAPPENED A THIRD TIME ON 09/09/2026, AND THIS TIME IT BROKE THE TEST
 *
 * Dean ruled THE COMMONS in as the default. Both controls survive, so both sets
 * of logs are still logs of runnable games - but the flip moved FOUR leaves at
 * once (`visitCurrency` to `'commons'`, `bonusTiming` to `'start'`,
 * `startingMeeplesPerColour` to 0, and the Orchard door's printed draw to 2/2),
 * and the two control datas below were built INLINE from a hand-written `set`
 * that named only the knobs the 04/09 and 05/09 flips had moved.
 *
 * ⛔ **SO THE FIXTURES REPLAYED UNDER BONUS-FIRST AND ALL SIX THREW AT MOVE 4**
 * ("It is seat 1's turn"), which is what a turn-order change looks like from
 * inside a move log: the log's fourth move belongs to a turn that, under the new
 * order, had already ended. Nothing was wrong with the fixtures and nothing was
 * wrong with the engine. **The inline `set` was a COPY of an overlay, and a copy
 * of a pin stops being a pin the moment the default moves under it** - which is
 * the same lesson, arriving from a third direction, that
 * `overlays/retired/README.md` records about passengers and that the denial
 * probe in `observe.ts` records about copying a predicate out of the rules.
 *
 * ⭐ **THE FIX IS TO STOP DUPLICATING AND START READING.** Both controls are
 * committed, validated by `overlays.test.ts`, and already pin every leaf the flip
 * moved - that is what the passenger audit of 09/09/2026 was for. So this file
 * loads them FROM DISK by path. The next flip pins its passengers in one place
 * and this test follows for free; a fixture that then fails is a real
 * regression, which is the only thing it was ever supposed to say.
 *
 * ⚠️ **THE SHIPPED RULES STILL HAVE NO FIXTURE OF THEIR OWN, and now there are
 * two versions of that debt.** No `-meeple-economy-` log was ever recorded for
 * the `reference-v14` game, and no `-commons-` log exists for this one.
 * Recording the commons openings needs the bots to enumerate the new move type,
 * so it belongs to the integration step rather than here. The command, for
 * whoever takes it:
 *
 *     npm run sim -- --replay=<capture> --fixture="a whole {2,3,4}p commons opening"
 *
 * and the file must be named `{2,3,4}p-commons-opening.json` so that `dataFor`
 * below leaves it on `BASE_GAME_DATA`, which IS the commons. Until then the
 * commons is covered by `packages/engine/src/commons.test.ts`, the whole-game
 * walks in `game.test.ts` and the `--audit` bench.
 */
function overlayData(file: string) {
  const overlay = JSON.parse(readFileSync(join(OVERLAY_DIR, file), 'utf8')) as Overlay;
  return loadGameData(overlay);
}

/**
 * ⭐ READ FROM THE COMMITTED OVERLAY, NEVER RESTATED HERE. See the note above:
 * an inline copy of a pin stops being a pin the moment the default moves under
 * it, and on 09/09/2026 that cost all six fixtures at once. These two files are
 * the controls the passenger audit maintains, and `overlays.test.ts` validates
 * that every path in them still addresses a real knob.
 */
const V31_CONTROL = overlayData('v31-card-visit.overlay.json');
const MEEPLE_LOOP_V1 = overlayData('meeple-loop-v1.overlay.json');
/**
 * ⭐ THE COMMONS BEFORE THE BALLOON AND VILLAGE STORE RULING (12/09/2026). The
 * three `-commons-opening` fixtures were captured against that game; when Dean
 * ruled the new balloons and the Store into the shipped default, that game
 * became an ARM, so - by this file's own convention - its fixtures gained the
 * `-commons-pre-balloons-` marker and replay here, byte-identically, while fresh
 * unmarked `-commons-opening` fixtures record the new shipped game.
 */
const COMMONS_PRE_BALLOONS = overlayData('commons-pre-balloons-v1.overlay.json');

/**
 * ⚠️ A FILE WITH NO MARKER REPLAYS AGAINST THE SHIPPED DEFAULT, whatever the
 * shipped default currently is. That is the convention and it is deliberate: a
 * fixture belongs to the game of the day it was captured, and a marker is added
 * only when that game becomes an arm. There are no unmarked fixtures today.
 */
function dataFor(file: string) {
  if (file.includes('-v31-')) return V31_CONTROL;
  if (file.includes('-meeple-loop-')) return MEEPLE_LOOP_V1;
  if (file.includes('-commons-pre-balloons-')) return COMMONS_PRE_BALLOONS;
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
