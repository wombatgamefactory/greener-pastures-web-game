#!/usr/bin/env node
/**
 * Card sheets, rendered by a browser instead of by InDesign.
 *
 * The physical project's sheet pipeline needs Windows, a licensed InDesign and
 * a local .indd template, so exactly one person on the design team can cut a
 * new sheet. `Card.tsx` already draws the printed 1039 x 750 geometry from
 * measured layer positions and `printed.test.ts` asserts it card-for-card
 * against the catalogue, so the renderer that draws the game can draw the
 * sheet - and a browser runs anywhere, including on a CI runner.
 *
 * Same server-plus-real-browser shape as `verify-layout.mjs`, and outside
 * `npm run check` for the same reason: it needs a build and a real browser.
 *
 *   npm run build && npm run cards
 *   npm run cards -- --suit wheat            one suit
 *   npm run cards -- --card W1 --card W3U    single cards, for a fidelity diff
 *
 * Output lands in reports/cards/. NOT a print master: the printed cards are set
 * in Berlin Sans FB and this draws them in Fredoka, which sets ~8% wider.
 */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const UI = join(ROOT, 'packages', 'ui');
const OUT = join(ROOT, 'reports', 'cards');
const SUITS = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];
/** The historic sheet size the .indd template has always exported. */
const SHEET = { width: 7277, height: 3001 };
const CARD = { width: 1039, height: 750 };

/**
 * The Vite dev server, not a built `dist`.
 *
 * `verify-layout.mjs` and friends serve the real build because what they check
 * is the deployed artefact. This checks card ARTWORK, which is identical either
 * way, and skipping the build buys two things: a CI run with no build step, and
 * immunity to the `dist/` EPERM that Dropbox's file handles cause on this
 * workstation every time Vite tries to empty the output directory.
 */
async function serveDev() {
  // Vite's own API, in this process. Spawning `vite` as a child looked simpler
  // and was not: on Windows `shell: true` means `child.kill()` kills the shell
  // and leaves the real server holding the port, so the NEXT run dies on
  // "port already in use". In-process, there is no orphan to leak.
  // `vite` lives in packages/ui/node_modules and is NOT hoisted to the root,
  // so a bare `import('vite')` from tools/ does not resolve. Ask the UI package.
  const requireFromUi = createRequire(join(UI, 'package.json'));
  const { createServer } = await import(pathToFileURL(requireFromUi.resolve('vite')).href);
  const server = await createServer({
    root: UI,
    configFile: join(UI, 'vite.config.ts'),
    // Port 0: the OS picks a free one, so concurrent runs cannot collide.
    server: { port: 0, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const { port } = server.httpServer.address();
  return { stop: () => server.close(), origin: `http://localhost:${port}` };
}

function parseArgs(argv) {
  const suits = [];
  const cards = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--suit') suits.push(argv[(i += 1)]);
    else if (argv[i] === '--card') cards.push(argv[(i += 1)]);
  }
  return { suits: suits.length ? suits : cards.length ? [] : SUITS, cards };
}

/**
 * Playwright's own Chromium is not installed here and downloading ~150MB to
 * take a screenshot is rude, so use an installed browser. CI installs one
 * explicitly; a workstation almost always already has Edge or Chrome.
 */
async function launch() {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    'no Chromium found - install Edge or Chrome, or run `npx playwright-core install chromium`',
  );
}

/**
 * A page is screenshotted at its own CSS size, so a 7277px sheet needs a
 * 7277px viewport - about 22 megapixels, which Chromium renders fine but slowly
 * and hungrily. Rendering at a fraction and letting `deviceScaleFactor` put the
 * pixels back gives an identical bitmap for a quarter of the layout work.
 */
/**
 * Fredoka sets 8.2% wider than the printed Berlin Sans FB (measured over all 123
 * real ability lines; range 1.057-1.109). `.card-ability` is `overflow: hidden`,
 * so type that does not fit is CLIPPED rather than spilling somewhere visible -
 * which is how a card can look fine at thumbnail size and be missing its last
 * line in print.
 *
 * So two verdicts per card, not one:
 *   proof   - it is clipped on this page, in Fredoka
 *   print   - it is STILL clipped with the 8.2% subtracted, i.e. really broken
 *
 * A card that is `proof` but not `print` is a false alarm and says so. Nothing
 * is ever reported as fine when it is not: the correction only ever relaxes.
 */
const FIT_CORRECTION = 1 / 1.082;

async function checkOverset(page) {
  return page.evaluate((fit) => {
    const clipped = (el) => el.scrollHeight > el.clientHeight + 1;
    const out = [];
    for (const card of document.querySelectorAll('.card')) {
      const el = card.querySelector('.card-ability');
      if (!el || !el.textContent.trim()) continue;
      if (!clipped(el)) continue;
      // Berlin Sans is NARROWER than Fredoka, not SMALLER: same line height,
      // more characters per line. So the correction widens the box by 8.2% and
      // re-counts lines at the original size. Shrinking the font instead - the
      // first version of this - shrank the line height too, which let three
      // lines fit that do not fit in print, and reported a genuinely clipped
      // card as a false alarm.
      const before = el.style.width;
      el.style.width = `${el.clientWidth / fit}px`;
      const stillClipped = clipped(el);
      el.style.width = before;
      out.push({
        id: card.querySelector('.card-ref')?.textContent ?? '?',
        name: card.querySelector('.card-name')?.textContent ?? '?',
        inPrint: stillClipped,
      });
    }
    return out;
  }, FIT_CORRECTION);
}

/**
 * Render at a fraction and put the pixels back with `deviceScaleFactor`: a
 * 7277px viewport is ~22 megapixels of layout for an identical bitmap. Verified
 * equivalent - `scrollHeight`/`clientHeight` are layout values, so a CSS
 * transform does not move them, and the overset verdicts match at both scales.
 */
async function shoot(browser, url, size, path) {
  const scale = 0.25;
  const viewport = {
    width: Math.ceil(size.width * scale),
    height: Math.ceil(size.height * scale),
  };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 / scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${url}&scale=${scale}`, { waitUntil: 'networkidle' });
  // Fonts BEFORE measuring: a fallback face is narrower than Fredoka, so
  // measuring early reports everything as fitting.
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  const overset = await checkOverset(page);
  await page.screenshot({ path, clip: { x: 0, y: 0, ...viewport } });
  await page.close();
  return overset;
}

const { suits, cards } = parseArgs(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });

const { stop, origin } = await serveDev();
const page0 = `${origin}/sheet.html`;
const browser = await launch();
const overset = [];
let n = 0;

try {
  for (const suit of suits) {
    const out = join(OUT, `cards-${suit}-front.png`);
    overset.push(...(await shoot(browser, `${page0}?suit=${suit}`, SHEET, out)));
    console.log(`  ${suit} sheet -> ${out}`);
    n += 1;
  }
  for (const raw of cards) {
    const upgraded = /u$/i.test(raw);
    const id = upgraded ? raw.slice(0, -1) : raw;
    const out = join(OUT, `card-${raw.toLowerCase()}.png`);
    overset.push(
      ...(await shoot(browser, `${page0}?card=${id}&upgraded=${upgraded ? 1 : 0}`, CARD, out)),
    );
    console.log(`  card ${raw} -> ${out}`);
    n += 1;
  }
} finally {
  await browser.close();
  stop();
}

console.log('');
console.log(`${n} image(s) written to ${OUT}`);

const broken = overset.filter((o) => o.inPrint);
const suspect = overset.filter((o) => !o.inPrint);
if (broken.length) {
  console.log('');
  console.log(`TEXT DOES NOT FIT (${broken.length}) - clipped in print too:`);
  for (const o of broken) console.log(`  ${o.id.padEnd(5)} ${o.name}`);
}
if (suspect.length) {
  console.log('');
  console.log(`clipped here but fits in Berlin Sans (${suspect.length}) - no action needed:`);
  for (const o of suspect) console.log(`  ${o.id.padEnd(5)} ${o.name}`);
}
if (!overset.length) console.log('no overset text.');
process.exitCode = broken.length ? 1 : 0;
