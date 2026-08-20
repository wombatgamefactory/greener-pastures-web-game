#!/usr/bin/env node
/**
 * Fetch the card data from the shared Google Sheet.
 *
 * The sheet is the editing surface a co-designer can actually use: the .xlsm
 * needs Excel on Windows, and the sheet -> InDesign -> PNG pipeline needs a
 * licensed InDesign on top of that, so today exactly one person can change a
 * card. A published CSV needs neither, and a CI runner can fetch it.
 *
 *   node tools/fetch-sheet.mjs                  # reads CARD_SHEET_CSV
 *   node tools/fetch-sheet.mjs <csv-url>
 *   node tools/fetch-sheet.mjs <url> --out cards.csv
 *
 * The URL is NEVER hard-coded here. This repo is public; the sheet is private
 * design material. It comes from the environment (a GitHub repo variable in
 * CI, a local env var on a workstation), so nothing about it lands in the tree.
 *
 * Columns are resolved by HEADER TEXT downstream, never by position - the same
 * rule `extract_cards.py` documents the hard way, after a deleted column
 * shifted the cost block one place left and silently wrote every build cost an
 * icon short.
 */

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt === -1 ? null : args[outAt + 1];
const xlsxAt = args.indexOf('--xlsx');
const xlsx = xlsxAt === -1 ? null : args[xlsxAt + 1];
let url = args.find((a) => a.startsWith('http')) ?? process.env.CARD_SHEET_CSV;

/**
 * `--xlsx` swaps the CSV export for the workbook export, because the workbook
 * is what `extract_cards.py` already reads. Reimplementing the extraction in JS
 * would mean a second copy of the cost-icon parsing, the base/upgraded face
 * split and the `U`-suffix strip - three things that are subtle, already
 * tested, and would drift apart the first time the sheet changed shape.
 */
if (xlsx && url) url = url.replace(/([?&])format=csv/, '$1format=xlsx');

if (!url) {
  console.error(
    'No sheet URL. Pass one, or set CARD_SHEET_CSV.\n' +
      '\n' +
      'It must be a CSV endpoint readable WITHOUT a login - one of:\n' +
      '  .../export?format=csv&gid=<tab>   (Share > Anyone with the link > Viewer)\n' +
      '  .../pub?output=csv&gid=<tab>      (File > Share > Publish to web, one tab)\n',
  );
  process.exit(2);
}

const res = await fetch(url, { redirect: 'follow' });
const buf = Buffer.from(await res.arrayBuffer());
// A workbook is binary; only decode when it is meant to be text.
const body = xlsx ? buf.subarray(0, 64).toString('latin1') : buf.toString('utf8');

/**
 * Google answers an unauthorised CSV request with 200 and a sign-in PAGE at
 * least as often as with a 401, so the status code alone is not the check. A
 * CSV that starts with markup is a login screen wearing a CSV's URL.
 */
if (!res.ok || /^\s*<(!doctype|html)/i.test(body)) {
  console.error(
    `The sheet is not readable without a login (HTTP ${res.status}).\n` +
      '\n' +
      'In the sheet: Share > General access > "Anyone with the link" > Viewer,\n' +
      'or File > Share > Publish to web and publish the single export tab as CSV.\n' +
      'Publishing one tab is the safer of the two: it exposes only that tab, so\n' +
      'the Discussion column and every other tab stay private.',
  );
  process.exit(1);
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

if (xlsx) {
  writeFileSync(xlsx, buf);
  console.log(`workbook written to ${xlsx} (${buf.length} bytes)`);
  process.exit(0);
}

const rows = parseCsv(body);
const headers = (rows[0] ?? []).map((h) => h.trim()).filter(Boolean);

console.log(`${rows.length - 1} data rows, ${headers.length} named columns`);
console.log('');
console.log('headers:');
for (const [i, h] of headers.entries()) console.log(`  ${String(i).padStart(2)}  ${h}`);

if (out) {
  writeFileSync(out, body, 'utf8');
  console.log('');
  console.log(`raw CSV written to ${out}`);
}
