/**
 * gp-sim - the headless balance simulator.
 *
 * Runs the same @gp/engine the browser runs. The harness, metrics and the v14
 * watch-list assertion suite are designed in wayfinder ticket 11; this is the
 * entry point and the proof that Node consumes the engine unchanged.
 */

import { ENGINE_VERSION, RULES_EDITION } from '@gp/engine';

function main(argv: readonly string[]): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      [
        'gp-sim - Greener Pastures balance simulator',
        '',
        'Usage: npm run sim -- [options]',
        '',
        'Not implemented yet. See wayfinder ticket 11 for the harness design.',
        '',
      ].join('\n'),
    );
    return 0;
  }

  process.stdout.write(
    `gp-sim: engine ${ENGINE_VERSION}, rules ${RULES_EDITION}. No harness yet (ticket 11).\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
