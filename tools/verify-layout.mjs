/**
 * The 1024x700 responsive floor, verified rather than assumed.
 *
 * Ticket 09 settled the floor and ticket 24 makes it a hard requirement. The
 * test that matters is NOT "does the page overflow horizontally" - variant C
 * passed that and still dropped two rivals off the bottom. What matters is what
 * falls below the fold, so this measures the real rendered boxes of the
 * landmarks a player must be able to see without scrolling, at each viewport.
 *
 * Driven by playwright-core against the browser already installed on the
 * machine (Edge, then Chrome), so nothing is downloaded and CI is not asked to
 * carry a browser. Deliberately NOT part of `npm run check`: it needs a
 * built app and a real browser.
 *
 *   npm run build && npm run verify:layout
 *   npm run verify:layout -- --shot reports/floor.png
 *   npm run verify:layout -- --result          the end-game scoring screen
 *
 * `--result` walks a whole game out (`?finish=1`) and measures the scoring
 * overlay instead of the table. It is a separate pass rather than an extra
 * landmark because the two cannot be on screen at once, and because the panel's
 * failure mode is its own: it is the one surface that grows with the game, so a
 * seat with fifteen buildings and three end-game cards is what has to fit.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const VIEWPORTS = [
  { name: 'floor', width: 1024, height: 700 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1600, height: 900 },
];

/** Every landmark that must be fully on screen, and where to find it. */
const TABLE_LANDMARKS = [
  { name: 'commons', selector: '.commons' },
  { name: 'island', selector: '.island' },
  { name: 'hiring fair', selector: '.panel-fair' },
  { name: 'your farm', selector: '.farm' },
  { name: 'your tableau', selector: '.tableau' },
  { name: 'your hand', selector: '.hand' },
  { name: 'your barn', selector: '.barn' },
  { name: 'event feed', selector: '.feed' },
  { name: 'the turn bar', selector: '.actionbar' },
];

/**
 * The scoring screen. The panel scrolls internally by design (`.inspector` caps
 * at 88vh), so what is measured is the PANEL fitting the viewport and the
 * ranking table being visible in it without a scroll - the verdict and the
 * standings are what a player looks at first.
 */
const RESULT_LANDMARKS = [
  { name: 'the result panel', selector: '.result' },
  { name: 'the verdict', selector: '.result-head' },
  { name: 'the standings', selector: '.result-table' },
];

const args = process.argv.slice(2);
const shotAt = args.indexOf('--shot');
const shotPath = shotAt === -1 ? null : args[shotAt + 1];
const resultMode = args.includes('--result');
const LANDMARKS = resultMode ? RESULT_LANDMARKS : TABLE_LANDMARKS;
/**
 * Ticket 25 put a start screen in front of the table, so the floor has to be
 * measured on an auto-started game. The warm-up depth matters as much as the
 * viewport: an opening position has three buildings and measures nothing, and
 * what this check exists to catch is a full tableau plus the two interaction
 * strips squeezing the hand off the bottom.
 */
const query =
  process.env.VERIFY_QUERY ??
  (resultMode
    ? '?autostart=1&seats=4&finish=1&seed=result-floor'
    : '?autostart=1&seats=4&depth=320&minHand=4');

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'packages', 'ui', 'dist');
/** Must match `base` in vite.config.ts: the built asset URLs carry this prefix. */
const BASE = '/greener-pastures-web-game/';

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

/**
 * Serve the real build over the real base path. A static server rather than
 * `vite preview`, so the check has no dependency on a dev server starting and
 * the URLs exercised are exactly the ones GitHub Pages will serve.
 */
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
  // Port 0: the OS picks a free one. A fixed port is a trap here - a stray
  // server from an earlier run silently serves the wrong thing.
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function urlFor(server) {
  return `http://127.0.0.1:${server.address().port}${BASE}${query}`;
}

async function measure(page, url, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: 'load' });
  // `attached`, not `visible`: a region squeezed to zero height IS the failure
  // this check exists to catch, so it has to be measured, not waited on.
  if (resultMode) {
    // A whole game is walked in the browser before the first paint, so this is
    // slower than a warmed table and has to be waited for explicitly.
    await page.waitForSelector('.result', { state: 'attached', timeout: 60_000 });
  } else {
    await page.waitForSelector('.farm', { state: 'attached' });
    await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);
  }

  return page.evaluate(
    ({ landmarks, rivalSelector }) => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      /**
       * The rect a human can actually see: the element's own box intersected
       * with every scrolling ancestor that clips it.
       *
       * The naive getBoundingClientRect is not enough and this check was wrong
       * without it - the rail scrolls, so a third neighbour scrolled out of the
       * rail still reported a rect inside the viewport while being invisible on
       * screen. "Below the fold" includes "below the fold of its container".
       */
      const box = (el) => {
        const r = el.getBoundingClientRect();
        let top = r.top;
        let bottom = r.bottom;
        let left = r.left;
        let right = r.right;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const style = getComputedStyle(p);
          const clips = /auto|scroll|hidden/.test(style.overflowY + style.overflowX);
          if (!clips) continue;
          const c = p.getBoundingClientRect();
          top = Math.max(top, c.top);
          bottom = Math.min(bottom, c.bottom);
          left = Math.max(left, c.left);
          right = Math.min(right, c.right);
        }
        return { top, bottom, left, right, clipped: bottom < r.bottom - 1 || right < r.right - 1 };
      };
      const results = landmarks.map((l) => {
        const el = document.querySelector(l.selector);
        return el ? { ...l, ...box(el), found: true } : { ...l, found: false };
      });
      // Skipped on the scoring screen: the table is still mounted behind the
      // overlay, and a neighbour panel under a modal is not a layout failure.
      const rivals = rivalSelector
        ? [...document.querySelectorAll(rivalSelector)].map((el, i) => ({
            name: `rival ${i + 1}`,
            selector: rivalSelector,
            found: true,
            ...box(el),
          }))
        : [];
      return {
        vw,
        vh,
        pageScrollsX: document.documentElement.scrollWidth > vw + 1,
        pageScrollsY: document.documentElement.scrollHeight > vh + 1,
        boxes: [...results, ...rivals],
      };
    },
    { landmarks: LANDMARKS, rivalSelector: resultMode ? null : '.rival' },
  );
}

let server;
let browser;
let failures = 0;

try {
  server = await serveDist();
  const channels = ['msedge', 'chrome'];
  for (const channel of channels) {
    try {
      browser = await chromium.launch({ channel });
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!browser) throw new Error('no installed Chromium-family browser found (Edge or Chrome)');

  const page = await browser.newPage();
  const url = urlFor(server);
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(`  HTTP ${r.status()}  ${r.url()}`);
  });
  page.on('pageerror', (e) => console.log(`  PAGE ERROR  ${e.message}`));

  for (const viewport of VIEWPORTS) {
    const report = await measure(page, url, viewport);
    console.log(`\n${viewport.name}  ${viewport.width}x${viewport.height}`);

    if (report.pageScrollsX) {
      console.log('  FAIL  the page scrolls horizontally');
      failures++;
    }
    if (report.pageScrollsY) {
      console.log('  FAIL  the page scrolls vertically - regions must scroll, not the page');
      failures++;
    }

    for (const b of report.boxes) {
      if (!b.found) {
        console.log(`  FAIL  ${b.name} is missing (${b.selector})`);
        failures++;
        continue;
      }
      const belowFold = b.bottom > report.vh + 1;
      const offRight = b.right > report.vw + 1;
      const invisible = b.bottom - b.top < 8;
      if (belowFold || offRight || invisible || b.clipped) {
        console.log(
          `  FAIL  ${b.name}: top ${b.top.toFixed(0)} bottom ${b.bottom.toFixed(0)} right ${b.right.toFixed(0)}` +
            (invisible ? ' (collapsed)' : '') +
            (b.clipped ? ' (clipped by a scrolling ancestor)' : ''),
        );
        failures++;
      } else {
        console.log(
          `  ok    ${b.name}  ${(b.bottom - b.top).toFixed(0)}px tall, ends at ${b.bottom.toFixed(0)}`,
        );
      }
    }

    if (shotPath) {
      const target = resolve(shotPath.replace(/(\.png)?$/, `-${viewport.name}.png`));
      mkdirSync(dirname(target), { recursive: true });
      await page.screenshot({ path: target });
    }
  }
} finally {
  await browser?.close();
  server?.close();
}

console.log(failures === 0 ? '\nfloor holds at every viewport' : `\n${failures} layout failures`);
process.exit(failures === 0 ? 0 : 1);
