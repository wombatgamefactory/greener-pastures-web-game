/**
 * WCAG 2.2 AA, checked by a tool rather than by eye (WP5 item 1, 25/09/2026).
 *
 * Driven the same way `tools/verify-layout.mjs` is: `playwright-core` against
 * whatever Chromium-family browser is already on the machine, over a static
 * server for a real build (never the dev server), so nothing is downloaded
 * and the URLs exercised are the ones GitHub Pages will serve. The server and
 * browser-launch code below is that file's, reused rather than rewritten -
 * see its own header for why (`GP_DIST`, the channel fallback, the base path).
 *
 * `axe-core` is injected into the live page with `page.addScriptTag`, exactly
 * like Playwright's own `@axe-core/playwright` wrapper does under the hood -
 * that package pulls in a whole extra devDependency graph for what is really
 * one script tag and one `axe.run()` call, so this project takes axe-core
 * itself as its one new root devDependency and drives it directly.
 *
 *   npx vite build --outDir ../../.scratch/wp5-dist --emptyOutDir=false   (from packages/ui)
 *   GP_DIST=.scratch/wp5-dist node tools/verify-a11y.mjs
 *   node tools/verify-a11y.mjs --shots .scratch/wp5
 *
 * Eight states are scanned at 1600x900, the brief's own list: the start
 * screen, How to play open, turn-top, Visit armed, the Build assembly open,
 * the Deliver assembly open, the turn summary showing, and the result screen.
 * Each scan fails the run on any SERIOUS or CRITICAL violation; MODERATE and
 * MINOR ones are printed but do not fail it - the brief asks for a judgement
 * on those in the report, not a red exit code for every "consider adding a
 * `lang`" note axe raises against its own default ruleset.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const SHOTS = resolve(shotsAt === -1 ? '.scratch/wp5' : args[shotsAt + 1]);
mkdirSync(SHOTS, { recursive: true });

const ROOT = resolve(import.meta.dirname, '..');
// GP_DIST (25/09/2026, carried from verify-layout.mjs): lets a build in any
// folder be checked, so the .map-file gate's fresh-folder build and this
// tool's own build never have to share one `dist`.
const DIST = process.env.GP_DIST
  ? resolve(process.env.GP_DIST)
  : join(ROOT, 'packages', 'ui', 'dist');
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

function serveDist() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build at ${DIST} - run \`npx vite build --outDir <dir>\` first`);
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

function urlFor(server, query = '') {
  return `http://127.0.0.1:${server.address().port}${BASE}${query}`;
}

async function launchBrowser() {
  // Same three-way fallback as `verify-layout.mjs`: Edge or Chrome already on
  // a developer's machine, or Playwright's own bundled Chromium in CI.
  const channels = ['msedge', 'chrome', null];
  for (const channel of channels) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      /* try the next one */
    }
  }
  throw new Error('no installed Chromium-family browser found (Edge, Chrome, or a bundled one)');
}

const AXE_PATH = resolve(ROOT, 'node_modules', 'axe-core', 'axe.min.js');

/**
 * ⚠️ EVERY `page.goto` DROPS THE SCRIPT TAG - a full navigation tears down
 * the whole page context, injected scripts included, exactly as it would in a
 * real browser tab. `scan()` below calls this itself before every run rather
 * than once at the top, checking `window.axe` first so the (harmless but
 * pointless) re-inject is skipped on a state that only opened a dialog on the
 * SAME page rather than navigating.
 */
async function injectAxe(page) {
  const present = await page.evaluate(() => typeof window.axe !== 'undefined');
  if (present) return;
  if (!existsSync(AXE_PATH)) {
    throw new Error(`axe-core is not installed at ${AXE_PATH} - \`npm install\` first`);
  }
  await page.addScriptTag({ path: AXE_PATH });
}

/**
 * One scan, one report. `axe.run` is asked for the WCAG 2.x A/AA rule tags
 * plus `best-practice` (axe's own recommended extras, such as a landmark
 * region on the page) - `best-practice` findings are folded into the
 * moderate/minor bucket below rather than treated as a WCAG failure, since
 * they are axe's opinion rather than the standard's text.
 */
async function scan(page, name) {
  await injectAxe(page);
  const results = await page.evaluate(async () => {
    return window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
  });
  const violations = results.violations ?? [];
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const rest = violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');

  console.log(`\n${name}`);
  if (violations.length === 0) {
    console.log('  ok    no violations at any impact level');
  }
  for (const v of bad) {
    console.log(`  FAIL  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`          ${node.target.join(' ')}`);
    }
  }
  for (const v of rest) {
    console.log(`  note  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
  }
  return { name, bad, rest };
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Click a family button by its visible name, if it exists and is enabled. */
async function clickAction(page, label) {
  const btn = page.locator(`button:has(.action-name:text-is("${label}"))`);
  if ((await btn.count()) === 0 || !(await btn.isEnabled())) return false;
  await btn.click();
  await page.waitForTimeout(150);
  return true;
}

/**
 * T10b (26/09/2026): wait until every CSS animation and transition on the page
 * has finished before a scan. The result screen fades in, and scanning the
 * moment `.result` was attached caught it mid-fade one run in three: 20
 * contrast "failures" on text that was simply still at partial opacity (QA
 * D9). `document.getAnimations()` covers both animations and transitions;
 * infinite ones (a pulse, a scroll-driven cue) are skipped, as they never end.
 */
async function settleAnimations(page, timeout = 5_000) {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          const t = a.effect?.getComputedTiming?.();
          return (
            a.playState !== 'running' || !t || t.endTime === Infinity || t.iterations === Infinity
          );
        }),
      null,
      { timeout },
    )
    .catch(() => {});
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

let server;
let browser;
const reports = [];

try {
  server = await serveDist();
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  page.on('pageerror', (e) => console.log(`  PAGE ERROR  ${e.message}`));

  // --- 1. the start screen -------------------------------------------------
  await page.goto(urlFor(server), { waitUntil: 'load' });
  await page.waitForSelector('.start-card', { state: 'attached' });
  reports.push(await scan(page, '1. start screen'));
  await shot(page, 'start-screen-1600');

  // --- 2. How to play, open -------------------------------------------------
  await page.locator('.start-help').click();
  await page.waitForSelector('.htp', { state: 'attached' });
  await page.waitForTimeout(120);
  reports.push(await scan(page, '2. how to play open'));
  await shot(page, 'how-to-play-1600');
  await page.locator('.htp-close').click();
  await page.waitForTimeout(80);

  // --- 3. turn-top ------------------------------------------------------
  await page.goto(urlFor(server, '?autostart=1&seats=4&depth=8&minHand=4'), {
    waitUntil: 'load',
  });
  await page.waitForSelector('.farm', { state: 'attached' });
  await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);
  reports.push(await scan(page, '3. turn-top'));
  await shot(page, 'turn-top-1600');

  // --- 4. Visit armed ---------------------------------------------------
  const visitArmed = await clickAction(page, 'Visit a neighbour');
  if (visitArmed) {
    reports.push(await scan(page, '4. visit armed'));
    await shot(page, 'visit-armed-1600');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  } else {
    console.log('\n4. visit armed\n  --    Visit was not legal on this fixture, skipped');
  }

  // --- 5. Build assembly open -----------------------------------------
  // A single hand card can complete a FREE build outright (`startBuild`
  // sends straight away rather than opening `.assembly` - see
  // `session/play.ts`), which spends the seat's action for the turn, so this
  // does not try a second card on the same fixture once that happens - it
  // moves to a fresh seed instead, the same shape as the Deliver loop below.
  let buildOpen = false;
  for (let seed = 1; seed <= 10 && !buildOpen; seed++) {
    if (seed > 1) {
      await page.goto(
        urlFor(server, `?autostart=1&seats=4&depth=8&minHand=4&seed=a11y-build-${seed}`),
        { waitUntil: 'load' },
      );
      await page.waitForSelector('.farm', { state: 'attached' });
      await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);
    }
    // The bonus phase (`ActionBar.tsx`'s modal shape) draws no main-action
    // family at all until it is taken or skipped, Build included - a no-op
    // click when the bonus is already resolved (state 4 above may have taken
    // it already), which is exactly why this is safe to repeat every seed.
    await page
      .locator('button:has-text("skip bonus action")')
      .click()
      .catch(() => {});
    await page.waitForTimeout(80);
    const buildArmed = await clickAction(page, 'Build');
    if (!buildArmed) continue;
    const card = page.locator('.hand-card').first();
    if ((await card.count()) === 0) continue;
    await card.click();
    await page.waitForTimeout(150);
    buildOpen = await page.evaluate(() => !!document.querySelector('.assembly'));
    if (!buildOpen) await page.keyboard.press('Escape').catch(() => {});
  }
  if (buildOpen) {
    reports.push(await scan(page, '5. build assembly open'));
    await shot(page, 'build-assembly-1600');
  } else {
    console.log(
      '\n5. build assembly open\n  --    the Build assembly did not open on this fixture, skipped',
    );
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // --- 6. Deliver assembly open -------------------------------------------
  // A crate is always 4 barn cards, so this needs a deeper walk than the
  // turn-top fixture above before a barn holds enough to try. Several seeds
  // at a middling depth, same idea as `verify-layout.mjs`'s mid-action pass
  // but reaching further into the game, rather than one seed hand-picked and
  // left to bit-rot the day the bots' policy changes.
  let deliverOpen = false;
  for (let seed = 1; seed <= 12 && !deliverOpen; seed++) {
    await page.goto(
      urlFor(server, `?autostart=1&seats=4&depth=200&minHand=4&seed=a11y-deliver-${seed}`),
      { waitUntil: 'load' },
    );
    await page.waitForSelector('.farm', { state: 'attached' });
    await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);
    // See the same skip in the Build loop above: the bonus phase draws no
    // action-zone family, Deliver included, until it is taken or skipped.
    await page
      .locator('button:has-text("skip bonus action")')
      .click()
      .catch(() => {});
    await page.waitForTimeout(80);
    const armed = await clickAction(page, 'Deliver');
    if (!armed) continue;
    deliverOpen = await page.evaluate(() => !!document.querySelector('.assembly-deliver'));
    if (!deliverOpen) {
      // Might have resolved straight to a lone legal delivery, or need a tile
      // click to open the assembly (see `view/intent.ts`'s `deliverFamilyClick`).
      // `:not([aria-disabled="true"])` matters: most tiles on any given board
      // are not a legal target this turn, and Playwright's `.click()` waits
      // forever for a disabled one to become "actionable" rather than failing
      // fast, which is what hung this loop on its first real run.
      const tile = page.locator('.island-tile:not([aria-disabled="true"])').first();
      if ((await tile.count()) > 0) {
        await tile.click();
        await page.waitForTimeout(150);
        deliverOpen = await page.evaluate(() => !!document.querySelector('.assembly-deliver'));
      }
    }
    if (!deliverOpen) await page.keyboard.press('Escape').catch(() => {});
  }
  if (deliverOpen) {
    reports.push(await scan(page, '6. deliver assembly open'));
    await shot(page, 'deliver-assembly-1600');
  } else {
    console.log(
      '\n6. deliver assembly open\n  --    no fixture in 12 tried seeds offered a Deliver worth opening an assembly for, skipped',
    );
  }
  await page.keyboard.press('Escape').catch(() => {});

  // --- 7. turn summary showing --------------------------------------------
  await page.goto(urlFor(server, '?autostart=1&seats=2&depth=8&minHand=4'), {
    waitUntil: 'load',
  });
  await page.waitForSelector('.farm', { state: 'attached' });
  await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);
  await page
    .locator('button:has-text("skip bonus action")')
    .click()
    .catch(() => {});
  await page.waitForTimeout(100);
  // Draw only, deliberately never Build here: a Build can just as easily open
  // the multi-step assembly (a real payment to choose) as complete for free,
  // and this state only needs SOME action taken cleanly so a bot round can
  // begin - state 5 above is where the assembly itself gets scanned. Draw's
  // own task (pick two decks) is the one flow this file already knows how to
  // finish unattended.
  const drawn = await clickAction(page, 'Draw');
  if (drawn) {
    for (let i = 0; i < 3; i++) {
      if ((await page.locator('.waiting-on').count()) > 0) break;
      const deck = page.locator('.deck.is-live, .deck.is-target').first();
      if ((await deck.count()) === 0) break;
      await deck.click();
      await page.waitForTimeout(120);
    }
    // Draw 2 keep both is still a TASK once the two decks are named - "Keep 2
    // of the 2 you saw" - answered by clicking the revealed cards themselves
    // (`Prompt.tsx`'s `Revealed`, `.revealed-card`), never by the deck a
    // second time. Missing this step is why End turn stayed disabled
    // ("finish what is pending first") and no bot round, and so no turn
    // summary, ever followed.
    const revealed = page.locator('.revealed-card');
    const revealedCount = await revealed.count();
    for (let i = 0; i < revealedCount; i++) {
      await revealed.nth(i).click();
      await page.waitForTimeout(100);
    }
    // A confirm button ("Keep 2") if clicking every card did not already send
    // the answer on its own.
    const confirm = page.locator('.answer-list button.primary');
    if ((await confirm.count()) > 0 && (await confirm.isEnabled().catch(() => false))) {
      await confirm.click();
      await page.waitForTimeout(120);
    }
  }
  const endTurn = page.locator('button:has-text("End turn")');
  if (await endTurn.isEnabled().catch(() => false)) {
    await endTurn.click();
  }
  const summaryShown = await page
    .waitForSelector('.turn-summary', { state: 'attached', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (summaryShown) {
    await settleAnimations(page);
    reports.push(await scan(page, '7. turn summary showing'));
    await shot(page, 'turn-summary-1600');
  } else {
    console.log(
      '\n7. turn summary showing\n  --    the turn summary did not appear within 20s, skipped',
    );
  }

  // --- 8. result screen ----------------------------------------------------
  await page.goto(urlFor(server, '?autostart=1&seats=4&finish=1&seed=a11y-result'), {
    waitUntil: 'load',
    timeout: 180_000,
  });
  await page.waitForSelector('.result', { state: 'visible', timeout: 180_000 });
  await settleAnimations(page);
  reports.push(await scan(page, '8. result screen'));
  await shot(page, 'result-screen-1600');
} finally {
  await browser?.close();
  server?.close();
}

const totalBad = reports.reduce((n, r) => n + r.bad.length, 0);
const totalRest = reports.reduce((n, r) => n + r.rest.length, 0);
console.log(
  `\n${reports.length} state(s) scanned, ${totalBad} serious/critical violation(s), ${totalRest} moderate/minor note(s)`,
);
process.exit(totalBad === 0 ? 0 : 1);
