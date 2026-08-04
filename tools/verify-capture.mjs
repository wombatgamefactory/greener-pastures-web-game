/**
 * The capture button, driven for real (ticket 31).
 *
 * The unit tests prove the payload replays. What they cannot prove is that the
 * button SAVES anything: ticket 31 chose a browser download over a dev-server
 * endpoint precisely so it works on the deployed build, and a download is a
 * browser behaviour with no test-double worth trusting. Ticket 26 learned this
 * the expensive way - `verify:drag` found the one bug unit tests could not,
 * because it drove a real pointer.
 *
 * So this clicks the real button on the real build, catches the real download,
 * and replays the bytes that actually landed on disk through the real engine.
 * If any link in that chain is broken the run fails.
 *
 * Same shape as `verify-layout.mjs` and `verify-drag.mjs`, and outside
 * `npm run check` for the same reason: it needs a build and a real browser.
 *
 *   npm run build && npm run verify:capture
 *
 * Run through `tsx` rather than bare node, because it replays the downloaded
 * file through the engine's TypeScript sources - which is the point: the check
 * is that the browser's bytes reach the same engine the simulator uses.
 */

import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

import { BASE_GAME_DATA } from '@gp/data';
import { parseCapture, replayCapture } from '@gp/engine';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'packages', 'ui', 'dist');
const BASE = '/greener-pastures-web-game/';
/** Four seats and a warmed table, so the log is long enough to be worth replaying. */
const QUERY = '?autostart=1&seats=4&depth=320&minHand=4&seed=verify-capture';
/** The responsive floor. A report button that only fits a big screen has failed. */
const VIEWPORT = { width: 1024, height: 700 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

function serveDist() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build at ${DIST} - run \`npm run build\` first`);
  }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path.slice(1);
    let file = normalize(join(DIST, rel));
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

let failures = 0;
function check(what, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const NOTE = 'the Draw Worker feels too strong';

let server;
let browser;
let saved;

try {
  server = await serveDist();
  for (const channel of ['msedge', 'chrome']) {
    try {
      browser = await chromium.launch({ channel });
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!browser) throw new Error('no installed Chromium-family browser found (Edge or Chrome)');

  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => check('no page error', false, e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${BASE}${QUERY}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('.hand-card');

  console.log(`\nthe capture gesture at ${VIEWPORT.width}x${VIEWPORT.height}`);

  const trigger = page.locator('.capture > button');
  check('the report button is on screen', (await trigger.count()) === 1);
  const box = await trigger.boundingBox();
  check(
    'and inside the viewport at the floor',
    box !== null && box.y + box.height <= VIEWPORT.height && box.x >= 0,
    box ? `at ${Math.round(box.x)},${Math.round(box.y)}` : 'no box',
  );

  await trigger.click();
  await page.waitForSelector('.capture-panel');
  check(
    'opens a panel without covering the hand',
    await page.locator('.hand-card').first().isVisible(),
  );

  await page.locator('.capture-note').fill(NOTE);
  await page.locator('.capture-labels button', { hasText: 'Design note' }).click();

  // The real thing: a real download, written to a real file.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.locator('.capture-actions button', { hasText: 'save file' }).click(),
  ]);
  saved = join(tmpdir(), `gp-verify-capture-${process.pid}.json`);
  await download.saveAs(saved);

  check('the browser downloaded a file', existsSync(saved), download.suggestedFilename());
  check(
    'named for its label and its time',
    /^gp-design-note-.*\.json$/.test(download.suggestedFilename()),
    download.suggestedFilename(),
  );
  check(
    'and the panel closed, leaving the game alone',
    (await page.locator('.capture-panel').count()) === 0,
  );
  check('with the filename shown back', (await page.locator('.capture-saved').count()) === 1);

  // ---- the bytes that landed, replayed ------------------------------------
  console.log('\nthe file, replayed');
  const capture = parseCapture(JSON.parse(readFileSync(saved, 'utf8')));
  check('parses as a capture', capture.label === 'design-note', capture.label);
  check('carries the note', capture.note === NOTE);
  check('carries a build id', typeof capture.appVersion === 'string', capture.appVersion ?? 'null');
  check('carries the whole log', capture.moves.length > 100, `${capture.moves.length} moves`);
  check(
    'names the neighbours',
    capture.policies.length === 4 && capture.policies[0] === 'human',
    capture.policies.join(', '),
  );

  const result = replayCapture(BASE_GAME_DATA, capture);
  check('the data matches this build', result.fingerprintMatches);
  check(
    'and the whole log replays without throwing',
    result.threw === null && result.applied === capture.moves.length,
    result.threw ? `threw at ${result.threw.at}: ${result.threw.error}` : `${result.turns} turns`,
  );

  // ---- over the scoring screen --------------------------------------------
  //
  // The one place the button was silently unreachable. The result overlay is a
  // scrim at z-index 90, and the pace strip the button first lived in is at 60,
  // so it rendered and could never be clicked. Playwright's actionability check
  // is what proves the fix: `click` fails if anything covers the element.
  console.log('\nover the scoring screen');
  await page.goto(
    `http://127.0.0.1:${server.address().port}${BASE}?autostart=1&seats=3&finish=1&seed=capture-result`,
    { waitUntil: 'load' },
  );
  await page.waitForSelector('.result', { state: 'attached', timeout: 60_000 });
  const overResult = page.locator('.capture > button');
  check(
    'the report button is still there once the game is scored',
    (await overResult.count()) === 1,
  );
  await overResult.click({ timeout: 5000 });
  check('and nothing is covering it', (await page.locator('.capture-panel').count()) === 1);
} finally {
  await browser?.close();
  server?.close();
  if (saved) rmSync(saved, { force: true });
}

console.log(
  failures === 0
    ? '\nthe capture button saves a file that replays.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
