/**
 * gp-sim - the headless balance simulator.
 *
 * Runs the same @gp/engine the browser runs. The harness, metrics and the v14
 * watch-list assertion suite are designed in wayfinder ticket 11; what exists
 * today is the entry point, the proof that Node consumes the engine unchanged,
 * and the tuning surface the harness will run over.
 */

import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';
import { BASE_GAME_DATA, listKnobs } from '@gp/data';

const HELP = [
  'gp-sim - Greener Pastures balance simulator',
  '',
  'Usage: npm run sim -- [options]',
  '',
  '  --list-knobs   Print every tunable value an overlay or a sweep may address.',
  '  -h, --help     This.',
  '',
  'The harness itself is not built yet. See wayfinder ticket 11.',
  '',
].join('\n');

function listKnobsReport(): string {
  const knobs = listKnobs(BASE_GAME_DATA);
  const width = Math.max(...knobs.map((knob) => knob.path.length));
  const lines = [
    `${knobs.length} knobs. Any of these may be set by a tuning overlay or swept.`,
    'Card text is deliberately absent: the sheet is the single source of truth for wording.',
    '',
  ];
  for (const knob of knobs) {
    const value = Array.isArray(knob.baseValue)
      ? `[${knob.baseValue.join(', ')}]`
      : String(knob.baseValue);
    lines.push(`  ${knob.path.padEnd(width)}  ${value.padStart(9)}  ${knob.type}`);
  }
  return `${lines.join('\n')}\n`;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  if (argv.includes('--list-knobs')) {
    process.stdout.write(listKnobsReport());
    return 0;
  }

  process.stdout.write(
    `gp-sim: engine ${ENGINE_VERSION}, rules ${RULES_EDITION}, ` +
      `${BASE_GAME_DATA.cards.catalogue.length} cards loaded. No harness yet (ticket 11).\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
