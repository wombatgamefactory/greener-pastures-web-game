/**
 * gp-sim - the headless balance simulator.
 *
 * Runs the same @gp/engine the browser runs, driven by the same @gp/bots the
 * browser's difficulty ladder uses. The harness, metrics and the v14 watch-list
 * assertion suite are designed in wayfinder ticket 11; what exists today is the
 * entry point, the tuning surface the harness will run over, the game driver,
 * and `--explain` (ticket 28), which is how a bot's weights get argued with.
 */

import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';
import { BASE_GAME_DATA, SUITS, listKnobs } from '@gp/data';
import type { Suit } from '@gp/data';
import { POLICY_IDS, isPolicyId } from '@gp/bots';

import { explainReport } from './explain.js';

const HELP = [
  'gp-sim - Greener Pastures balance simulator',
  '',
  'Usage: npm run sim -- [options]',
  '',
  '  --list-knobs        Print every tunable value an overlay or a sweep may address.',
  '  --list-bots         Print the roster.',
  '  --explain           Print the per-term breakdown behind one bot decision.',
  '    --policy=<id>     Which bot to explain (default: balanced).',
  '    --seed=<string>   Game seed (default: explain).',
  '    --seats=<n>       2-4 (default: 2).',
  '    --at=<n>          Which decision; negative counts back from the last (default: -1).',
  '    --top=<n>         How many moves to list (default: 6).',
  '  -h, --help          This.',
  '',
  'The harness itself is not built yet. See wayfinder ticket 11.',
  '',
].join('\n');

function flag(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

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

function listBotsReport(): string {
  return [
    `${POLICY_IDS.length} bots: ${POLICY_IDS.join(', ')}.`,
    'Ladder: easy = pulse, normal = balanced, hard = an alias with no bot behind it',
    'until ticket 11 measures win rates.',
    '',
  ].join('\n');
}

function explainMode(argv: readonly string[]): { report: string; code: number } {
  const policy = flag(argv, 'policy') ?? 'balanced';
  if (!isPolicyId(policy)) {
    return { report: `Unknown bot "${policy}". Try --list-bots.\n`, code: 1 };
  }
  const seats = Number(flag(argv, 'seats') ?? 2);
  if (!Number.isInteger(seats) || seats < 2 || seats > 4) {
    return { report: '--seats must be 2, 3 or 4.\n', code: 1 };
  }
  const report = explainReport(BASE_GAME_DATA, {
    seed: flag(argv, 'seed') ?? 'explain',
    seats,
    suits: SUITS.slice(0, seats) as Suit[],
    policy,
    at: Number(flag(argv, 'at') ?? -1),
    top: Number(flag(argv, 'top') ?? 6),
  });
  return { report, code: 0 };
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

  if (argv.includes('--list-bots')) {
    process.stdout.write(listBotsReport());
    return 0;
  }

  if (argv.includes('--explain')) {
    const { report, code } = explainMode(argv);
    process.stdout.write(report);
    return code;
  }

  process.stdout.write(
    `gp-sim: engine ${ENGINE_VERSION}, rules ${RULES_EDITION}, ` +
      `${BASE_GAME_DATA.cards.catalogue.length} cards, ${POLICY_IDS.length} bots loaded. ` +
      'No harness yet (ticket 11).\n',
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
