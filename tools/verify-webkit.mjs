/**
 * What a Mac sees.
 *
 * Two different questions, because one check cannot answer both:
 *
 * 1. DOES WEBKIT RENDER IT THE SAME AS BLINK? Playwright ships a real WebKit
 *    build, so the same surfaces are rendered in both engines and written to
 *    reports/webkit/ side by side to be looked at. Not asserted: the two
 *    engines antialias text differently and always will, so a pixel threshold
 *    here would either be so loose it caught nothing or so tight it cried
 *    every run.
 *
 * 2. WILL IT SURVIVE AN OLDER SAFARI? This is the one that bites, and the one
 *    a WebKit render CANNOT answer - Playwright's WebKit tracks Safari Tech
 *    Preview, so it is always NEWER than the Safari on anybody's Mac. It would
 *    have rendered the paint-order bug of 10/08/2026 perfectly while every Mac
 *    on Ventura showed brown mush.
 *
 *    So instead of chasing old builds, each fragile capability is switched OFF
 *    in a current WebKit and the page is diffed against itself. Same engine,
 *    same antialiasing, so the diff is caused by the capability and nothing
 *    else. A big diff means the layout is LOAD-BEARING on it: on a browser
 *    that lacks it, the page changes by that much. That is the assertion.
 *
 * A capability belongs in FRAGILE when it cannot be feature-detected honestly
 * (`paint-order` is the worst kind: `CSS.supports` answers true on the very
 * versions that ignore it, so `@supports` cannot gate a fallback) or when it
 * degrades into something unreadable rather than something plain.
 *
 *   npm run build && npm run verify:webkit
 *
 * Like verify:layout, this needs a build and a real browser, so it is not part
 * of `npm run check`. It needs Playwright's own WebKit rather than an installed
 * browser - there is no WebKit on Windows otherwise:
 *
 *   npx playwright-core install webkit chromium
 */

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium, webkit } from 'playwright-core';

/**
 * Capabilities the card art leans on that a Mac two OS versions back may not
 * have. `css` is what that browser effectively does: nothing.
 */
const FRAGILE = [
  {
    name: 'paint-order',
    since: 'Safari 17.4, March 2024 (so: not on macOS Ventura or older)',
    used: 'the sepia keyline on every white card string - see [data-text] in base.css',
    detectable: false,
    css: '*, *::before, *::after { paint-order: normal !important; }',
  },
];

/**
 * How much of the page may change when a capability goes missing. Not a
 * rendering tolerance - a design budget. Above it, the page is relying on the
 * capability rather than being decorated by it.
 *
 * It can be this tight because of the per-channel cut in `diffPercent`, which
 * is set high enough to ignore glyph-edge antialiasing and only count pixels
 * that changed COLOUR. Measured against the paint-order bug on 10/08/2026:
 * with the fill layer in place every surface scores 0.00%; with it removed
 * (the bug) the same surfaces score 0.45% (island), 0.73% (table), 3.44%
 * (hand) and 3.70% (the enlarged card). There is no grey area to sit in.
 */
const BUDGET = 0.1; // % of pixels

/** Rendered in both engines, and again with each capability switched off. */
const SURFACES = [
  { name: 'table', selector: null },
  { name: 'island', selector: '.island' },
  { name: 'hand', selector: '.hand' },
  /** The card blown up to the size the zoom panel uses: where text detail shows. */
  { name: 'card', selector: '#probe-card .card', enlarge: true },
];

const ROOT = resolve(import.meta.dirname, '..');
const DIST = normalize(join(ROOT, 'packages', 'ui', 'dist'));
const OUT = join(ROOT, 'reports', 'webkit');
/** Must match `base` in vite.config.ts. */
const BASE = '/greener-pastures-web-game/';
const QUERY = '?autostart=1&seats=4&depth=320&minHand=4&seed=webkit';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
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

/** A warmed table with one card lifted out and enlarged for the text check. */
async function openTable(browser, url, disableCss) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.hand .card', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  if (disableCss) await page.addStyleTag({ content: disableCss });
  // Settle art decode and any entry transition before anything is measured.
  await page.waitForTimeout(1200);
  return page;
}

async function enlargeCard(page) {
  await page.evaluate(() => {
    document.querySelector('#probe-card')?.remove();
    const source = document.querySelector('.hand .card');
    const holder = document.createElement('div');
    holder.id = 'probe-card';
    holder.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;padding:20px;';
    const clone = source.cloneNode(true);
    // The hand's own class: keeps every printed layer, drops nothing.
    clone.classList.add('card-readable');
    clone.style.width = '820px';
    holder.appendChild(clone);
    document.body.appendChild(holder);
  });
  await page.waitForTimeout(400);
}

async function hideCard(page) {
  await page.evaluate(() => document.querySelector('#probe-card')?.remove());
}

/** Every surface, as PNG buffers keyed by name. */
async function capture(page) {
  const shots = {};
  for (const surface of SURFACES) {
    if (surface.enlarge) await enlargeCard(page);
    shots[surface.name] = surface.selector
      ? await page.locator(surface.selector).screenshot()
      : await page.screenshot();
    if (surface.enlarge) await hideCard(page);
  }
  return shots;
}

/**
 * Percentage of pixels that differ, done in a browser rather than with an image
 * library so the tool keeps its one dependency.
 *
 * `threshold` is per channel out of 255, and deliberately coarse. A stroked
 * glyph has a lot of edge, and a fill painted over a stroke antialiases very
 * slightly differently from a stroke painted under a fill - at a fine cut that
 * halo alone scored 1.5% on the hand and drowned the signal. What this check
 * cares about is a pixel that changed COLOUR, white to sepia, and that clears
 * 110 comfortably.
 */
async function diffPercent(page, a, b, threshold = 110) {
  return page.evaluate(
    async ([aB64, bB64, cut]) => {
      const load = (b64) =>
        new Promise((ok, no) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = no;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(aB64), load(bB64)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 100;
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      let differing = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (
          Math.abs(pa[i] - pb[i]) > cut ||
          Math.abs(pa[i + 1] - pb[i + 1]) > cut ||
          Math.abs(pa[i + 2] - pb[i + 2]) > cut
        ) {
          differing++;
        }
      }
      return (differing / (pa.length / 4)) * 100;
    },
    [a.toString('base64'), b.toString('base64'), threshold],
  );
}

function save(engine, tag, shots) {
  for (const [name, buf] of Object.entries(shots)) {
    writeFileSync(join(OUT, `${engine}-${tag}-${name}.png`), buf);
  }
}

let server;
let webkitBrowser;
let chromiumBrowser;
let failures = 0;

try {
  mkdirSync(OUT, { recursive: true });
  server = await serveDist();
  const url = `http://127.0.0.1:${server.address().port}${BASE}${QUERY}`;

  webkitBrowser = await webkit.launch();
  chromiumBrowser = await chromium.launch();

  // --- 1. the two engines, for a human to compare -------------------------
  const wkPage = await openTable(webkitBrowser, url);
  const crPage = await openTable(chromiumBrowser, url);

  for (const [engine, page] of [
    ['webkit', wkPage],
    ['chromium', crPage],
  ]) {
    const fonts = await page.evaluate(() => ({
      fredoka: document.fonts.check('600 16px Fredoka'),
      family: getComputedStyle(document.querySelector('.card-name')).fontFamily,
    }));
    if (!fonts.fredoka) {
      console.log(
        `  FAIL  ${engine}: Fredoka did not load - card text is falling back to ${fonts.family}`,
      );
      failures++;
    } else {
      console.log(`  ok    ${engine}: Fredoka loaded`);
    }
  }

  const wkShots = await capture(wkPage);
  save('webkit', 'baseline', wkShots);
  save('chromium', 'baseline', await capture(crPage));
  console.log(`\n  both engines rendered to ${OUT} - open the pairs and compare`);

  // --- 2. each fragile capability, switched off in WebKit ------------------
  // The differ runs in the chromium page: a blank canvas, no page state used.
  const differ = await chromiumBrowser.newPage();
  await differ.goto('about:blank');

  for (const cap of FRAGILE) {
    console.log(`\n${cap.name}  (${cap.since})`);
    console.log(`  used for: ${cap.used}`);
    const page = await openTable(webkitBrowser, url, cap.css);
    const shots = await capture(page);
    save('webkit', `no-${cap.name}`, shots);
    await page.close();

    for (const [name, buf] of Object.entries(shots)) {
      const pct = await diffPercent(differ, wkShots[name], buf);
      const verdict = pct > BUDGET ? 'FAIL' : 'ok  ';
      console.log(`  ${verdict}  ${name}: ${pct.toFixed(2)}% of pixels change without it`);
      if (pct > BUDGET) failures++;
    }
    if (!cap.detectable) {
      console.log(`  note: cannot be feature-detected, so there is no @supports fallback to add`);
    }
  }

  await wkPage.close();
  await crPage.close();
  await differ.close();
} finally {
  await webkitBrowser?.close();
  await chromiumBrowser?.close();
  server?.close();
}

console.log(
  failures === 0
    ? '\nnothing on the page is load-bearing on a capability an older Mac may lack'
    : `\n${failures} failures - a Mac without these will not see what you see`,
);
process.exit(failures === 0 ? 0 : 1);
