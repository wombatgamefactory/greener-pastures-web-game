#!/usr/bin/env node
/**
 * The disclosure boundary, checked rather than remembered.
 *
 * This repo will be made public and shown to publishers, and flipping it public
 * exposes the entire history, not just the current tree. `.gitignore` keeps whole
 * directories of design material out. This catches the other half: a private name
 * or a private path that leaks into a file that IS committed.
 *
 * It has already happened once - an early commit named a publisher in the README
 * and had to be scrubbed - which is why it is a gate and not a note.
 *
 * Scope is "everything git would commit": tracked files plus untracked files that
 * are not ignored. Both file CONTENTS and file PATHS are checked.
 *
 * Run: node tools/check-disclosure.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/**
 * Each entry is a name or path that must not appear in a public repo. Adding one
 * is cheap; removing one needs a reason, because every entry here is something
 * that was deliberately kept private.
 */
const FORBIDDEN = [
  { pattern: /isle\s+of\s+farms/i, why: 'the pitch title of the physical game' },
  { pattern: /isle\s+of\s+trains/i, why: 'the predecessor this game is a sequel to' },
  { pattern: /good\s+neighbours/i, why: 'the pitch subtitle' },
  { pattern: /dranda/i, why: 'a publisher this game is pitched to' },
  { pattern: /kosmos/i, why: 'a publisher this game is pitched to' },
  { pattern: /boardgamearena|\bbga\b/i, why: 'the private reference implementation' },
  { pattern: /[a-z]:[\\/]dropbox/i, why: "an absolute path into the designer's private files" },
  // Deliberately NOT here: the spreadsheet's file extension. A format name is
  // not a secret, .gitignore has to name it to exclude it, and the part of the
  // filename that does leak - the game's pitch title - is already caught above.
];

/** Binary-ish files are checked by path only. */
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp3|wav|zip|xlsm|xlsx|docx)$/i;

/** The check cannot forbid the words it is written to forbid. */
const SELF = 'tools/check-disclosure.mjs';

function committableFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function scan() {
  const findings = [];

  for (const file of committableFiles()) {
    if (file === SELF) continue;

    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(file)) {
        findings.push({ file, line: 0, text: file, why, what: 'path' });
      }
    }

    if (BINARY.test(file)) continue;
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue; // raced with a delete
    }
    if (!stat.isFile() || stat.size > 4_000_000) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(text)) {
          findings.push({
            file,
            line: i + 1,
            text: text.trim().slice(0, 120),
            why,
            what: 'content',
          });
        }
      }
    });
  }
  return findings;
}

const findings = scan();

if (findings.length === 0) {
  process.stdout.write('disclosure boundary: clean\n');
  process.exit(0);
}

process.stderr.write(`disclosure boundary: ${findings.length} leak(s)\n\n`);
for (const f of findings) {
  const where = f.what === 'path' ? `${f.file} (filename)` : `${f.file}:${f.line}`;
  process.stderr.write(`  ${where}\n    ${f.text}\n    -> ${f.why}\n\n`);
}
process.stderr.write(
  'This repo goes public, and going public exposes the whole history. Remove the\n' +
    'reference, or move the file behind the .gitignore boundary, before committing.\n',
);
process.exit(1);
