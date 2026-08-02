/**
 * The bot boundary probe, a sibling of ticket 01's engine probes.
 *
 * eslint already refuses a `GameState` import in `packages/bots/**`, and the
 * package's tsconfig gives it neither DOM nor Node types. This is the third
 * overlapping check, and the one that survives someone disabling a lint rule:
 * it reads the source. A policy that could see the truth would know the deck
 * order, and every balance number the simulator produces would be worthless.
 *
 * It lives in @gp/sim because reading files is exactly what @gp/bots may not do.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const BOTS_SRC = fileURLToPath(new URL('../../bots/src', import.meta.url));

function botSources(): { file: string; text: string }[] {
  return readdirSync(BOTS_SRC)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ file: name, text: readFileSync(join(BOTS_SRC, name), 'utf8') }));
}

describe('the bot package boundary', () => {
  it('has sources to check', () => {
    expect(botSources().length).toBeGreaterThan(5);
  });

  it('never mentions GameState', () => {
    const offenders = botSources()
      .filter(({ text }) => /\bGameState\b/.test(stripComments(text)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('imports nothing platform-specific', () => {
    const banned = /from '(node:[^']+|fs|path|react[^']*|@gp\/ui[^']*|@gp\/sim[^']*)'/;
    const offenders = botSources()
      .filter(({ text }) => banned.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

/** Comments may discuss GameState - the point is that no code touches it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
