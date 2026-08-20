#!/usr/bin/env node
/**
 * The whole co-designer pipeline, in one command.
 *
 *   Google Sheet -> .xlsx -> extract_cards.py -> sheet-cards.json -> PNG sheets
 *
 * Why each hop is what it is:
 *
 *  - the SHEET, not the .xlsm, because a co-designer without Excel, Windows or
 *    InDesign can still edit a Google Sheet;
 *  - as .XLSX, because `extract_cards.py` already reads a workbook and already
 *    knows the parts that are easy to get wrong (cost icons, the base/upgraded
 *    face split, the printing `U` suffix on Ref). A JS reimplementation would be
 *    a second copy of all three, drifting from the first;
 *  - into SHEET-CARDS.JSON, never `cards.json`. The baseline and the sheet
 *    disagree deliberately and the `noticeboard-threshold-*` overlays measure
 *    that gap; extracting over the baseline would silently make them no-ops.
 *
 *   npm run cards:sheet                 # everything, all five suits
 *   npm run cards:sheet -- --suit wheat # one suit
 *   npm run cards:sheet -- --skip-fetch # re-render the last fetch
 *
 * Needs CARD_SHEET_CSV (a CSV export URL readable without a login) and Python
 * with openpyxl.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const WORK = join(ROOT, '.sheet-cache');
const XLSX = join(WORK, 'sheet.xlsx');
/** `public/` so the dev server serves it at BASE_URL, like any other asset. */
const CARDS = join(ROOT, 'packages', 'ui', 'public', 'sheet-cards.json');

const args = process.argv.slice(2);
const skipFetch = args.includes('--skip-fetch');
const passthrough = args.filter((a) => a !== '--skip-fetch');

function run(label, cmd, cmdArgs) {
  console.log(`\n[${label}] ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: ROOT, shell: false });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  // The extractor exits non-zero on a FATAL sheet problem and prints why. Its
  // non-fatal warnings (the Notice Board threshold, today) are exit 0 and are
  // meant to be read, not suppressed.
  if (r.status !== 0) {
    console.error(`\n[${label}] failed with exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

mkdirSync(WORK, { recursive: true });

if (!skipFetch) {
  if (!process.env.CARD_SHEET_CSV) {
    console.error(
      'CARD_SHEET_CSV is not set.\n' +
        '\n' +
        "  local:  set it to the sheet's CSV export URL\n" +
        '  CI:     add it as a repository VARIABLE, never in the tree - this repo is public\n',
    );
    process.exit(2);
  }
  run('fetch', process.execPath, [join(ROOT, 'tools', 'fetch-sheet.mjs'), '--xlsx', XLSX]);
} else if (!existsSync(XLSX)) {
  console.error(`--skip-fetch, but no cached workbook at ${XLSX}`);
  process.exit(2);
}

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
run('extract', python, [join(ROOT, 'tools', 'extract_cards.py'), XLSX, '--out', CARDS]);
run('render', process.execPath, [join(ROOT, 'tools', 'render-sheets.mjs'), ...passthrough]);
