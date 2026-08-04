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
 * `--history` additionally scans every blob and every commit message reachable
 * from any ref. That is a DIFFERENT question and it is the one that bites: the
 * working-tree scan passes the moment an offending line is deleted, but going
 * public exposes the whole history, so a line that was committed and then
 * removed is still served to anyone with the commit SHA. Exactly that happened
 * here - the publisher reference above was removed in a follow-up commit and sat
 * readable in the root commit until the ticket-16 audit found it.
 *
 * History mode is deliberately NOT part of `npm run check`, because CI checks out
 * with fetch-depth 1 and would scan a single commit and call it clean. Run it
 * locally, and before any change to who can read this repo.
 *
 * Run: node tools/check-disclosure.mjs [--history]
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

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/**
 * Every blob and every commit message reachable from any ref.
 *
 * Blobs are deduplicated by SHA, so a file that never changed is read once
 * however many commits carry it, and binary paths are skipped the same way the
 * working-tree scan skips them. The path a blob is reported under is whichever
 * one `rev-list` names it by; a blob can have had several, and one is enough to
 * find it.
 */
function scanHistory() {
  const findings = [];

  const listing = git(['rev-list', '--all', '--objects']).split('\n');
  const candidates = new Map(); // sha -> path
  for (const line of listing) {
    const sp = line.indexOf(' ');
    if (sp === -1) continue; // a commit, listed with no path
    const sha = line.slice(0, sp);
    const path = line.slice(sp + 1);
    if (!path || candidates.has(sha)) continue;
    if (BINARY.test(path)) continue;
    if (path === SELF) continue;
    candidates.set(sha, path);
  }

  // `rev-list --objects` names trees as well as blobs, and asking cat-file for
  // the contents of a tree as a blob is a fatal error rather than a skip. One
  // batch-check resolves every type up front.
  const blobs = new Map();
  if (candidates.size > 0) {
    const types = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
      input: [...candidates.keys()].join('\n'),
    }).split('\n');
    for (const line of types) {
      const [sha, type] = line.trim().split(' ');
      if (type === 'blob') blobs.set(sha, candidates.get(sha));
    }
  }

  for (const [sha, path] of blobs) {
    let body;
    try {
      body = git(['cat-file', 'blob', sha]);
    } catch {
      continue; // not a blob, or unreadable
    }
    body.split('\n').forEach((text, i) => {
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(text)) {
          findings.push({
            file: `${path} @ ${sha.slice(0, 8)}`,
            line: i + 1,
            text: text.trim().slice(0, 120),
            why,
            what: 'content',
          });
        }
      }
    });
  }

  // NUL-separated records, because a commit message contains newlines and any
  // printable separator could legitimately appear inside one.
  const messages = git(['log', '--all', '--format=%H%n%s%n%b%x00']).split('\0');
  for (const record of messages) {
    const text = record.trim();
    if (!text) continue;
    const [sha, ...rest] = text.split('\n');
    const body = rest.join('\n');
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(body)) {
        findings.push({
          file: `commit message @ ${sha.slice(0, 8)}`,
          line: 0,
          text: (rest[0] ?? '').slice(0, 120),
          why,
          what: 'content',
        });
      }
    }
  }

  return findings;
}

const history = process.argv.includes('--history');
const findings = history ? [...scan(), ...scanHistory()] : scan();
const scope = history ? 'working tree + history' : 'working tree';

if (findings.length === 0) {
  process.stdout.write(`disclosure boundary: clean (${scope})\n`);
  process.exit(0);
}

process.stderr.write(`disclosure boundary: ${findings.length} leak(s) (${scope})\n\n`);
for (const f of findings) {
  const where = f.what === 'path' ? `${f.file} (filename)` : `${f.file}:${f.line}`;
  process.stderr.write(`  ${where}\n    ${f.text}\n    -> ${f.why}\n\n`);
}
process.stderr.write(
  'This repo goes public, and going public exposes the whole history. Remove the\n' +
    'reference, or move the file behind the .gitignore boundary, before committing.\n',
);
if (history) {
  process.stderr.write(
    '\nA finding against a blob or a commit message is already published if this repo\n' +
      'is public. Deleting the line in a new commit does NOT unpublish it - the history\n' +
      'has to be rewritten and force pushed.\n',
  );
}
process.exit(1);
