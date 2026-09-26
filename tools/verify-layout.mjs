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
  // B2, 25/09/2026: the designer views at 4K (2560/3440 CSS px), and nothing
  // above 1600 was ever gated before this. `--table-max` caps the table's own
  // width at 2560 (base.css), so the ultrawide step is a taller viewport at
  // the SAME table width, not a wider one - both belong in the same gate.
  { name: 'qhd', width: 2560, height: 1440 },
  { name: 'ultrawide', width: 3440, height: 1440 },
];

/** Every landmark that must be fully on screen, and where to find it. */
const TABLE_LANDMARKS = [
  // ⭐ RENAMED 19/09/2026: the commons was deleted 13/09/2026 and the panel
  // this used to find is `SharedTable` now (`SharedTable.tsx`), `.shared-table`.
  { name: 'shared table', selector: '.shared-table' },
  { name: 'island', selector: '.island' },
  { name: 'the doors legend', selector: '.panel-doors' },
  { name: 'your farm', selector: '.farm' },
  { name: 'your tableau', selector: '.tableau' },
  { name: 'your hand', selector: '.hand' },
  { name: 'your barn', selector: '.barn' },
  { name: 'event feed', selector: '.feed' },
  /*
   * ⭐ MEASURES `.turn-zone`, NOT `.actionbar`, SINCE 25/09/2026 (B3, WP1).
   *
   * The turn zone is now a capped, `overflow-y: auto` row (`main-column.css`):
   * past the cap the bar's OWN buttons scroll within it rather than pushing
   * the farm down, which is what stops a tall bar from ever re-opening the
   * tableau/hand/barn clipping bug this file's `floor holds at every viewport`
   * banner exists to catch. That is the same shape as `.tableau` scrolling its
   * buildings, and this file has never failed a landmark for a SELF-scrolling
   * region - only for one squeezed to nothing or clipped by an ANCESTOR. This
   * landmark is measured the same way: the zone itself, whose height is always
   * bounded by its own cap, rather than its content, which is allowed to
   * outgrow it and scroll.
   */
  { name: 'the turn bar', selector: '.turn-zone' },
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
// GP_DIST (25/09/2026): lets parallel workers verify their own build, e.g.
// `npx vite build --outDir <dir>` from packages/ui, then GP_DIST=<dir>.
const DIST = process.env.GP_DIST
  ? resolve(process.env.GP_DIST)
  : join(ROOT, 'packages', 'ui', 'dist');
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
  /*
   * ⚠️ THE NAVIGATION ITSELF NEEDS THE LONGER BUDGET IN `--result` MODE, not
   * just the wait after it.
   *
   * `?finish=1` walks a WHOLE GAME synchronously before the first paint, so the
   * `load` event is what is slow - and Playwright's default `goto` timeout is
   * 30s, which the walk now exceeds. It is over the line because of v31 rather
   * than because of anything here: a scored bot move costs ~36ms and there is no
   * hand limit any more, so mid-game move lists run to the thousands and a
   * four-seat game is several hundred decisions.
   *
   * The `waitForSelector` below already had 60s for exactly this reason; it was
   * simply guarding the wrong half, because the page never got as far as firing
   * `load`.
   */
  await page.goto(url, { waitUntil: 'load', ...(resultMode ? { timeout: 180_000 } : {}) });
  // `attached`, not `visible`: a region squeezed to zero height IS the failure
  // this check exists to catch, so it has to be measured, not waited on.
  if (resultMode) {
    await page.waitForSelector('.result', { state: 'attached', timeout: 180_000 });
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
      /**
       * The hand fan against the barn beside it - the one pair in the layout
       * that can collide without anything falling off the screen, so neither the
       * fold check nor the horizontal-scroll check sees it.
       *
       * The fan overflows its own grid column by design (the cards are a fixed
       * width and the slots shrink under them), which means "does `.hand` fit"
       * is the wrong question: what matters is the right edge of the LAST card.
       * Measured at 120px over the barn at 1600x900 before the slots were
       * allowed to shrink.
       */
      const cards = [...document.querySelectorAll('.hand-card')];
      const barn = document.querySelector('.barn');
      const fanOverBarn =
        cards.length && barn
          ? Math.round(
              cards.at(-1).getBoundingClientRect().right - barn.getBoundingClientRect().left,
            )
          : null;
      // B2, 25/09/2026: `.farm`'s children collapsing to a 0px-wide grid
      // column is exactly how the Farmstead floor bug (B1) went unnoticed -
      // `.farmstead` was 220px TALL and still passed every landmark check
      // above, because none of them looked at width. A direct child at 0
      // width is never innocent: every one of them is meant to fill the
      // farm's single column.
      const farmEl = document.querySelector('.farm');
      const zeroWidthFarmChildren = farmEl
        ? [...farmEl.children].filter((c) => c.getBoundingClientRect().width === 0).length
        : 0;
      return {
        vw,
        vh,
        pageScrollsX: document.documentElement.scrollWidth > vw + 1,
        pageScrollsY: document.documentElement.scrollHeight > vh + 1,
        fanOverBarn,
        zeroWidthFarmChildren,
        boxes: [...results, ...rivals],
      };
    },
    { landmarks: LANDMARKS, rivalSelector: resultMode ? null : '.rival' },
  );
}

/*
 * THE MID-ACTION PASS (B2/B3, 25/09/2026).
 *
 * Every check above measures the table at rest. That is not where the appraisal
 * found the reflow bug: `draw-step2-1600.png` and `build-paid-1600.png` sliced
 * the tableau mid-turn, on a screen the turn-top check never sees, because the
 * old turn zone grew with whatever the prompt was showing (Top 2 in the
 * appraisal). This drives the table into three live states and re-measures
 * `.hand`, `.tableau` and `.barn` there:
 *
 *   arm      Visit is armed (a one-line `prompt-quiet`) - a sanity check that
 *            the quiet notes never regress, since they share `.turn-zone`.
 *   assembly Build is armed AND a hand card is chosen, so `BuildPanel` is on
 *            screen - the actual "multi-line assembly" case B3 exists for.
 *   dock     while `assembly` is up, a deck/board/hand click must still be
 *            possible everywhere the CURRENT task does not cover with a
 *            docked sheet - the bug a reviewer found in the first cut of B3
 *            (`.scratch/wp4/debug-blocked-1600.png`): an opaque prompt sitting
 *            over the very deck a Draw task was asking the player to click.
 *
 * `depth=8` (not the landmark checks' `depth=320`): early enough that Build
 * and the bonus slot both reliably stay live, which the deep fixture used above
 * mostly does not.
 */
const MID_ACTION_VIEWPORTS = [
  { name: 'floor', width: 1024, height: 700 },
  { name: 'desktop', width: 1600, height: 900 },
  { name: 'qhd', width: 2560, height: 1440 },
];
const MID_ACTION_QUERY = '?autostart=1&seats=4&depth=8&minHand=4';

/*
 * The same clipped-rect logic `measure()` uses above, inlined again here
 * rather than shared: it has to run INSIDE the page, and Playwright serialises
 * whatever function `page.evaluate` is given rather than letting two page
 * contexts share one closure.
 */
async function checkStrip(page, name, selector, failLabel) {
  const box = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
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
  }, selector);
  if (!box) {
    console.log(`  FAIL  ${failLabel}: ${name} is missing`);
    return 1;
  }
  const h = box.bottom - box.top;
  if (h < 60 || box.clipped) {
    console.log(
      `  FAIL  ${failLabel}: ${name} is ${h.toFixed(0)}px tall${box.clipped ? ' (clipped by a scrolling ancestor)' : ''}`,
    );
    return 1;
  }
  console.log(`  ok    ${failLabel}: ${name} is ${h.toFixed(0)}px tall`);
  return 0;
}

/** Is the element at `selector`'s own centre actually the thing a click would hit? */
/**
 * `atLeftEdge` (default false) tests a point 2px in from the LEFT edge rather
 * than dead centre. `.hand-card` is a fan BY DESIGN (`hand.css`'s own
 * "the sliver that always stays grabbable" comment): each card overlaps the
 * one before it, so a centre-point test fails most of the hand on every
 * viewport with a hand of more than about three cards, on a build this file
 * shipped with no dock at all - that is the fan working, not the prompt-dock
 * bug this check exists to catch. 2px, not a rounder number: the fan's own
 * overlap at the tightest step (`--hand-fan`, `base.css`) measured as little
 * as 8px between two cards, and an 8px offset landed exactly on that seam and
 * read as covered by chance. The dock bug covers a whole region from ABOVE
 * (the deck row, a rival's board), which a near-edge point catches exactly as
 * well as a centre one would.
 */
async function checkHitTestable(page, selector, failLabel, atLeftEdge = false) {
  const results = await page.evaluate(
    ({ selector, atLeftEdge }) => {
      return [...document.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return { hit: false, empty: true };
        const cx = atLeftEdge ? r.left + Math.min(2, r.width / 4) : r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const at = document.elementFromPoint(cx, cy);
        return { hit: !!(at && (at === el || el.contains(at))), empty: false };
      });
    },
    { selector, atLeftEdge },
  );
  const misses = results.filter((r) => !r.empty && !r.hit).length;
  if (misses > 0) {
    console.log(
      `  FAIL  ${failLabel}: ${misses} of ${results.length} (${selector}) are covered, not clickable`,
    );
    return 1;
  }
  console.log(`  ok    ${failLabel}: all ${results.length} (${selector}) are clickable`);
  return 0;
}

async function runMidActionPass(page, server) {
  let fails = 0;
  const url = `http://127.0.0.1:${server.address().port}${BASE}${MID_ACTION_QUERY}`;

  for (const viewport of MID_ACTION_VIEWPORTS) {
    console.log(`\nmid-action  ${viewport.name}  ${viewport.width}x${viewport.height}`);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // --- turn-top ---
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.farm', { state: 'attached' });
    await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);

    // --- arm Visit: a one-line prompt-quiet, must not disturb the strips ---
    const visitBtn = page.locator('button:has(.action-name:text-is("Visit a neighbour"))');
    if ((await visitBtn.count()) > 0 && (await visitBtn.isEnabled())) {
      await visitBtn.click();
      await page.waitForTimeout(150);
      fails += await checkStrip(page, 'your hand', '.hand', 'visit-armed');
      fails += await checkStrip(page, 'your tableau', '.tableau', 'visit-armed');
      fails += await checkStrip(page, 'your barn', '.barn', 'visit-armed');
      fails += await checkHitTestable(page, '.rival', 'visit-armed rival boards');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    } else {
      console.log('  --    visit was not legal on this fixture, skipped');
    }

    // --- resolve the bonus, so the action zone exists: THIS is the baseline
    // the farm-bbox check compares against, not the pre-bonus turn-top. Taking
    // or skipping the bonus is its own, legitimate layout change (the bonus
    // zone's row leaves the bar), which B3 was never trying to make free; what
    // it promises is that OPENING AN ASSEMBLY on top of an already-resolved
    // bonus costs the farm nothing, and that is what is measured below.
    await page
      .locator('button:has-text("skip bonus action")')
      .click()
      .catch(() => {});
    await page.waitForTimeout(100);
    const farmActionTop = await page.evaluate(() =>
      document.querySelector('.farm').getBoundingClientRect(),
    );
    const buildBtn = page.locator('button:has(.action-name:text-is("Build"))');
    if ((await buildBtn.count()) > 0 && (await buildBtn.isEnabled())) {
      await buildBtn.click();
      await page.waitForTimeout(150);
      await page.locator('.hand-card').first().click();
      await page.waitForTimeout(150);
      const hasAssembly = await page.evaluate(
        () => !!document.querySelector('.prompt-dock .prompt .assembly'),
      );
      if (!hasAssembly) {
        console.log('  --    the Build assembly did not open on this fixture, skipped');
      } else {
        fails += await checkStrip(page, 'your hand', '.hand', 'build-assembly-open');
        fails += await checkStrip(page, 'your tableau', '.tableau', 'build-assembly-open');
        fails += await checkStrip(page, 'your barn', '.barn', 'build-assembly-open');
        /*
         * `:last-child` only, not the whole fan. Every earlier card in a hand
         * fan is PARTLY covered by the one after it, by design (`hand.css`),
         * and which card sits on top at their shared seam shifts with which
         * one is picked - measured landing either way, with no prompt-dock
         * involved at all (confirmed by comparing `.prompt-dock`'s own rect
         * against `.hand`'s: they never intersect). The last card in the fan
         * has nothing after it to cover it, so it is what a dock draped over
         * the hand - the actual bug class this check exists for - would
         * reach first, and is the one card whose own click can never be a
         * false positive from the fan's own overlap.
         */
        fails += await checkHitTestable(page, '.hand-card:last-child', 'build-assembly-open hand');

        if (viewport.name === 'desktop') {
          const farmAssembly = await page.evaluate(() =>
            document.querySelector('.farm').getBoundingClientRect(),
          );
          const dTop = Math.abs(farmAssembly.top - farmActionTop.top);
          const dLeft = Math.abs(farmAssembly.left - farmActionTop.left);
          if (dTop > 2 || dLeft > 2) {
            console.log(
              `  FAIL  build-assembly-open: .farm moved ${dTop.toFixed(1)}px vertically, ${dLeft.toFixed(1)}px horizontally since the bonus resolved (over the 2px budget)`,
            );
            fails++;
          } else {
            console.log(
              `  ok    build-assembly-open: .farm moved ${dTop.toFixed(1)}px / ${dLeft.toFixed(1)}px since the bonus resolved`,
            );
          }
        }
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    } else {
      console.log('  --    Build was not legal on this fixture, skipped');
    }
  }
  return fails;
}

/*
 * T10b, 26/09/2026: THE TWO DEFECTS EVERY CHECK ABOVE MISSED, TESTED WHERE A
 * PLAYER MEETS THEM (QA D1 and D2, `.scratch/ui-qa-2026-09-26-v1.md`).
 *
 * D1: the landmark loop only asks that `.tableau` be 60px or more and not
 * clipped by an ANCESTOR. It never looked at the buildings INSIDE it, and 60px
 * was exactly the floor a squeezed tableau sat on while every 87px building at
 * 1600x900 lost its bottom third - and its fixture is a turn whose bonus was
 * already resolved, a state where the bar is shortest. So this pass loads
 * ORDINARY turn-tops (the bonus slot still open, no Workers held) and dense
 * farms (a 2p farm of 14 buildings, 4p farms of 5 and 6) at every viewport,
 * and fails if any building in your tableau is cut through vertically by any
 * clipping ancestor or the viewport.
 *
 * D2: a task prompt that was not an assembly (the Draw reveal, "Deliver:
 * choose an island tile") sat in normal flow and pushed the farm down by up
 * to 95px, taking the hand off the bottom of the screen. This pass takes a
 * Draw to its reveal and a Vegetable visit to its tile choice, and fails if
 * the farm's box moved at all (2px budget), if the hand or the Farmstead
 * left the screen, or if the thing the task asks you to click (a deck back,
 * an island tile) is covered.
 */
const T10B_VIEWPORTS = VIEWPORTS;
const T10B_TURN_TOPS = [
  { seats: 2, seed: 'qa-a', depth: 320 },
  { seats: 4, seed: 'qa-b', depth: 320 },
  { seats: 4, seed: 'qa-c', depth: 240 },
];

function t10bClipped() {
  const tableau = document.querySelector('.farm .tableau');
  if (!tableau) return null;
  const all = [...tableau.querySelectorAll('.building')];
  let clipped = 0;
  for (const b of all) {
    const r = b.getBoundingClientRect();
    let bad = r.top < -0.5 || r.bottom > window.innerHeight + 0.5;
    for (
      let a = b.parentElement;
      a && a !== document.documentElement && !bad;
      a = a.parentElement
    ) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      if (r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5) bad = true;
    }
    if (bad) clipped++;
  }
  return {
    buildings: all.length,
    clipped,
    card: Math.round(all[0]?.getBoundingClientRect().height ?? 0),
    bonusOpen: !!document.querySelector('.bonus-exits'),
  };
}

function t10bFarm() {
  const f = document.querySelector('.farm').getBoundingClientRect();
  const hand = document.querySelector('.hand').getBoundingClientRect();
  const stead = document.querySelector('.farmstead')?.getBoundingClientRect();
  return {
    top: f.top,
    left: f.left,
    height: f.height,
    handBottom: hand.bottom,
    steadBottom: stead ? stead.bottom : 0,
    vh: window.innerHeight,
  };
}

/** Hit-test the upper part of each element: for a deck, its BACK (the part a Draw clicks). */
function t10bClickable(selector) {
  return [...document.querySelectorAll(selector)].map((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 4, 20));
    return !!(at && (at === el || el.contains(at)));
  });
}

async function t10bSettle(page) {
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(r, 250))),
      ),
  );
}

function t10bCompare(label, before, after) {
  let fails = 0;
  const moved = Math.max(Math.abs(after.top - before.top), Math.abs(after.left - before.left));
  const grew = Math.abs(after.height - before.height);
  if (moved > 2 || grew > 2) {
    console.log(
      `  FAIL  ${label}: the farm moved ${moved.toFixed(0)}px and changed height by ${grew.toFixed(0)}px`,
    );
    fails++;
  } else {
    console.log(`  ok    ${label}: the farm did not move (${moved.toFixed(0)}px)`);
  }
  if (after.handBottom > after.vh + 0.5 || after.steadBottom > after.vh + 0.5) {
    console.log(
      `  FAIL  ${label}: hand bottom ${after.handBottom.toFixed(0)}, Farmstead bottom ${after.steadBottom.toFixed(0)}, viewport ${after.vh}`,
    );
    fails++;
  } else {
    console.log(`  ok    ${label}: hand and Farmstead on screen`);
  }
  return fails;
}

async function runT10bPass(page, server) {
  let fails = 0;
  const at = (q) => `http://127.0.0.1:${server.address().port}${BASE}${q}`;
  const load = async (q) => {
    await page.goto(at(q), { waitUntil: 'load', timeout: 180_000 });
    await page.waitForSelector('.farm .tableau', { timeout: 180_000 });
    await t10bSettle(page);
  };
  console.log('\nT10b: buildings never cut through, and a task never moves the farm');
  for (const viewport of T10B_VIEWPORTS) {
    console.log(`\n  ${viewport.name}  ${viewport.width}x${viewport.height}`);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const t of T10B_TURN_TOPS) {
      await load(`?autostart=1&seats=${t.seats}&depth=${t.depth}&minHand=0&seed=${t.seed}`);
      const m = await page.evaluate(t10bClipped);
      const label = `turn-top ${t.seats}p ${t.seed}@${t.depth} (${m?.buildings ?? 0} buildings${m?.bonusOpen ? ', bonus open' : ''})`;
      if (!m || m.clipped > 0) {
        console.log(`  FAIL  ${label}: ${m?.clipped ?? '?'} building(s) cut through vertically`);
        fails++;
      } else {
        console.log(`  ok    ${label}: none cut through (${m.card}px tall)`);
      }
    }

    // D2a: the Draw reveal.
    await load('?autostart=1&seats=4&depth=40&minHand=4&seed=qa-a');
    await page
      .locator('.actionbar button', { hasText: /skip/i })
      .first()
      .click()
      .catch(() => {});
    const draw = page.locator('button.action:has(.action-name:text-is("Draw"))').first();
    if ((await draw.count()) > 0 && (await draw.isEnabled())) {
      await draw.click();
      await t10bSettle(page);
      const before = await page.evaluate(t10bFarm);
      await page.locator('.deck.is-live, .deck.is-target').first().click();
      await page.mouse.move(1, 1);
      await t10bSettle(page);
      const revealed = await page.locator('.revealed-card').count();
      const after = await page.evaluate(t10bFarm);
      fails += t10bCompare(`draw reveal (${revealed} card shown)`, before, after);
      const decks = await page.evaluate(t10bClickable, '.deck.is-live, .deck.is-target');
      if (decks.length === 0 || decks.some((ok) => !ok)) {
        console.log(`  FAIL  draw reveal: live deck backs covered ${JSON.stringify(decks)}`);
        fails++;
      } else {
        console.log(`  ok    draw reveal: all ${decks.length} live deck backs clickable`);
      }
    } else {
      console.log('  --    Draw not legal on this fixture, skipped');
    }

    // D2b: "Deliver: choose an island tile", after a visit to the Vegetable board.
    await load('?autostart=1&seats=4&depth=160&minHand=4&seed=qa-a');
    const before = await page.evaluate(t10bFarm);
    const visit = page.locator('button.action-hook:not([disabled])').first();
    if ((await visit.count()) > 0) {
      await visit.click();
      await t10bSettle(page);
      await page.locator('.rival-board-live').first().click();
      await t10bSettle(page);
      await page.locator('.hand-card.is-target, .hand-card.is-live').first().click();
      await page.mouse.move(1, 1);
      await t10bSettle(page);
      const line = await page.evaluate(
        () => document.querySelector('.prompt-line')?.textContent ?? '',
      );
      if (!/island tile/i.test(line)) {
        console.log(`  --    the visit did not lead to a tile choice here ("${line}"), skipped`);
      } else {
        const after = await page.evaluate(t10bFarm);
        fails += t10bCompare('deliver tile choice', before, after);
        const tiles = await page.evaluate(
          t10bClickable,
          '.island-tile.is-live, .island-tile.is-target',
        );
        if (tiles.length === 0 || tiles.some((ok) => !ok)) {
          console.log(`  FAIL  deliver tile choice: live tiles covered ${JSON.stringify(tiles)}`);
          fails++;
        } else {
          console.log(`  ok    deliver tile choice: all ${tiles.length} live tiles clickable`);
        }
      }
    } else {
      console.log('  --    no visit legal on this fixture, skipped');
    }
  }
  return fails;
}

/*
 * WP1b, 25/09/2026: the standings strip, island readability and keyboard
 * reachability checks (items 1, 2, 3 and 4 of that pass's brief). Grouped
 * here rather than folded into the landmark loop above because each is a
 * CONTENT or FOCUS-ORDER check rather than a bounding-box one, and together
 * they are what "scripted check" means against those items' acceptance
 * criteria.
 */
const WP1B_VIEWPORTS = [
  { name: 'floor', width: 1024, height: 700 },
  { name: 'desktop', width: 1600, height: 900 },
  { name: 'qhd', width: 2560, height: 1440 },
  { name: 'ultrawide', width: 3440, height: 1440 },
];

async function runWp1bChecks(page, server) {
  let fails = 0;
  const url = urlFor(server);

  console.log('\nWP1b: standings, island and keyboard checks');

  // --- B21: the standings strip, every seat, visible without scrolling -----
  for (const viewport of WP1B_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.standings', { state: 'attached' });
    const info = await page.evaluate(() => {
      const strip = document.querySelector('.standings');
      const rows = [...document.querySelectorAll('.standing')];
      const rivals = document.querySelectorAll('.rival').length;
      const r = strip.getBoundingClientRect();
      // The same "clipped by a scrolling ancestor" idea `measure()` above
      // tests for a landmark, inlined here for the strip: does an ancestor's
      // own scrolling box cut it off.
      let clipped = false;
      for (let a = strip.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
          const ar = a.getBoundingClientRect();
          if (r.bottom > ar.bottom + 1 || r.top < ar.top - 1) {
            clipped = true;
            break;
          }
        }
      }
      return {
        rowCount: rows.length,
        rivals,
        bottom: r.bottom,
        height: r.height,
        clipped,
        labels: rows.map((li) => li.getAttribute('title') || ''),
      };
    });
    const seats = info.rivals + 1;
    const okCount = info.rowCount === seats;
    const okVisible = !info.clipped && info.height > 0 && info.bottom <= viewport.height + 1;
    const okContent = info.labels.every(
      (l) => /VP/.test(l) && /of \d+ island deliveries/.test(l) && /card/.test(l),
    );
    if (okCount && okVisible && okContent) {
      console.log(`  ok    standings strip  ${viewport.name}: ${info.rowCount} seats, unclipped`);
    } else {
      console.log(
        `  FAIL  standings strip  ${viewport.name}: rows ${info.rowCount}/${seats}` +
          `${info.clipped ? ' clipped' : ' fits'}` +
          `${okContent ? '' : ', missing VP/receipts/hand text'}`,
      );
      fails++;
    }
  }

  // --- B20: island demand-token size, the wild key, the per-tile tooltip ---
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.island-tile', { state: 'attached' });
  const islandInfo = await page.evaluate(() => {
    const token = document.querySelector('.island-token-art');
    const key = document.querySelector('.island-key-inline');
    const tile = document.querySelector('.island-tile');
    return {
      tokenWidth: token ? token.getBoundingClientRect().width : 0,
      keyLabel: key ? (key.getAttribute('aria-label') ?? key.getAttribute('title')) : null,
      tileLabel: tile ? tile.getAttribute('aria-label') : null,
    };
  });
  if (islandInfo.tokenWidth >= 20) {
    console.log(`  ok    island demand token: ${islandInfo.tokenWidth.toFixed(0)}px at 1600x900`);
  } else {
    console.log(
      `  FAIL  island demand token: only ${islandInfo.tokenWidth.toFixed(0)}px at 1600x900`,
    );
    fails++;
  }
  if (islandInfo.keyLabel && /cornucopia/i.test(islandInfo.keyLabel)) {
    console.log('  ok    the wild (cornucopia) token has an accessible key');
  } else {
    console.log('  FAIL  the wild token has no accessible key');
    fails++;
  }
  if (islandInfo.tileLabel && /needs|closed/i.test(islandInfo.tileLabel)) {
    console.log('  ok    an island tile states what it needs, for hover and for focus');
  } else {
    console.log('  FAIL  an island tile does not state what it needs');
    fails++;
  }

  // --- B23: a deck's count and top discard, keyboard reachable -------------
  await page
    .locator('body')
    .click({ position: { x: 1, y: 1 } })
    .catch(() => {});
  await page.keyboard.press('Tab');
  let deckFocused = false;
  for (let i = 0; i < 60 && !deckFocused; i++) {
    deckFocused = await page.evaluate(() => document.activeElement?.classList?.contains('deck'));
    if (!deckFocused) await page.keyboard.press('Tab');
  }
  if (deckFocused) {
    // The reveal is a CSS transition (`--motion-ui`, `shared-table.css`), so a
    // read on the very tick focus lands still sees the pre-transition 0 -
    // real, not flaky, and `hoverOpacity` mid-transition proved the same rule
    // fires for a pointer too. Give it its own duration to finish rather than
    // asserting on a value the rule was never meant to hold for.
    await page.waitForTimeout(250);
    const popover = await page.evaluate(() => {
      const el = document.activeElement;
      const pop = el?.querySelector('.deck-popover');
      if (!pop) return null;
      return {
        opacity: getComputedStyle(pop).opacity,
        label: el.getAttribute('aria-label') ?? '',
      };
    });
    if (popover && Number(popover.opacity) > 0 && /\d+ cards? left/.test(popover.label)) {
      console.log('  ok    a deck shows its count and top discard on keyboard focus');
    } else {
      console.log('  FAIL  a focused deck does not show its popover, or its count is missing');
      fails++;
    }
  } else {
    console.log('  FAIL  no deck was reachable by Tab within 60 stops');
    fails++;
  }

  // --- item 4: rival Notice Boards, roving tabindex within the rail --------
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.rival-board-live', { state: 'attached' });
  const totalBoards = await page.evaluate(
    () => document.querySelectorAll('.rival-board-live').length,
  );
  await page
    .locator('body')
    .click({ position: { x: 1, y: 1 } })
    .catch(() => {});
  await page.keyboard.press('Tab');
  let boardFocused = false;
  for (let i = 0; i < 60 && !boardFocused; i++) {
    boardFocused = await page.evaluate(() =>
      document.activeElement?.classList?.contains('rival-board-live'),
    );
    if (!boardFocused) await page.keyboard.press('Tab');
  }
  const seen = new Set();
  if (boardFocused) {
    for (let i = 0; i < totalBoards; i++) {
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-card'));
      seen.add(id);
      await page.keyboard.press('ArrowDown');
    }
  }
  if (boardFocused && seen.size === totalBoards) {
    console.log(
      `  ok    Tab reaches the rail and the arrow keys visit all ${totalBoards} Notice Boards`,
    );
  } else {
    console.log(
      `  FAIL  rival Notice Board keyboard nav: reached ${seen.size} of ${totalBoards} boards` +
        (boardFocused ? '' : ' (Tab never reached one)'),
    );
    fails++;
  }

  return fails;
}

let server;
let browser;
let failures = 0;

try {
  server = await serveDist();
  /*
   * B2, 25/09/2026: `null` (no `channel` at all) is a THIRD, not-a-channel
   * option alongside Edge and Chrome, added for `deploy.yml`. A developer's
   * machine has a system Edge or Chrome, which is what the two named channels
   * are for - nothing is downloaded there, per this file's own header. CI has
   * neither: `card-sheets.yml`'s `npx playwright-core install chromium` step
   * (reused by `deploy.yml`) installs Playwright's OWN bundled Chromium, which
   * is reached by calling `chromium.launch()` with no channel at all, never by
   * a channel string - `channel: 'chrome'` asks specifically for the system
   * browser and would fail on a runner that only has the bundled one.
   */
  const channels = ['msedge', 'chrome', null];
  for (const channel of channels) {
    try {
      browser = await chromium.launch(channel ? { channel } : {});
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!browser) {
    throw new Error('no installed Chromium-family browser found (Edge, Chrome, or a bundled one)');
  }

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

    if (report.zeroWidthFarmChildren > 0) {
      console.log(`  FAIL  ${report.zeroWidthFarmChildren} of .farm's children render at 0 width`);
      failures++;
    }

    if (report.fanOverBarn !== null && report.fanOverBarn > 1) {
      console.log(`  FAIL  the hand fan runs ${report.fanOverBarn}px over the barn`);
      failures++;
    } else if (report.fanOverBarn !== null) {
      console.log(`  ok    the hand fan clears the barn by ${-report.fanOverBarn}px`);
    }

    if (shotPath) {
      const target = resolve(shotPath.replace(/(\.png)?$/, `-${viewport.name}.png`));
      mkdirSync(dirname(target), { recursive: true });
      await page.screenshot({ path: target });
    }
  }

  if (!resultMode) {
    failures += await runMidActionPass(page, server);
    failures += await runWp1bChecks(page, server);
    failures += await runT10bPass(page, server);
  }
} finally {
  await browser?.close();
  server?.close();
}

console.log(failures === 0 ? '\nfloor holds at every viewport' : `\n${failures} layout failures`);
process.exit(failures === 0 ? 0 : 1);
