/**
 * The drag gesture, driven for real.
 *
 * Ticket 26 asks four questions that no unit test can answer - does a drop land
 * on the same surface a click does, does it work from a finger, does it fight
 * scrolling, and are the zones big enough at the responsive floor - so this
 * drives a real pointer across a real build and measures rather than assumes.
 *
 * Same shape as `verify-layout.mjs` and deliberately outside `npm run check`
 * for the same reason: it needs a build and an installed browser.
 *
 *   npm run build && npm run verify:drag
 *
 * The touch pass goes through CDP `Input.dispatchTouchEvent` rather than the
 * mouse API, because "does it work on a tablet" is a question about
 * `pointerType: touch` and `touch-action`, and a synthesised mouse would answer
 * a different question convincingly.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'packages', 'ui', 'dist');
const BASE = '/greener-pastures-web-game/';
const QUERY = '?autostart=1&seats=4&depth=320&minHand=4';
/** The responsive floor. If the gesture only works on a big screen it has failed. */
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
const ok = (name, extra = '') => console.log(`  ok    ${name}${extra ? `  ${extra}` : ''}`);
const fail = (name, why) => {
  console.log(`  FAIL  ${name}: ${why}`);
  failures++;
};
const check = (name, condition, why) => (condition ? ok(name) : fail(name, why));

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Drag with the mouse, in steps, so pointermove actually fires along the way. */
async function mouseDrag(page, from, to, { onMove } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    if (onMove) await onMove(i / steps);
  }
  await page.mouse.up();
}

/** The same gesture from a finger: real touch events, real `pointerType: touch`. */
async function touchDrag(cdp, from, to) {
  const point = (p) => [{ x: p.x, y: p.y, radiusX: 12, radiusY: 12, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point({
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      }),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** A live neighbour and a hand card: the visit, which is the gesture that matters. */
async function visitPair(page) {
  const rival = page.locator('.rival.is-live, .rival.is-target').first();
  if ((await rival.count()) === 0) return null;
  const card = page.locator('.hand-card').first();
  return {
    rival,
    card,
    from: centre(await card.boundingBox()),
    to: centre(await rival.boundingBox()),
  };
}

let server;
let browser;

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

  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => fail('page error', e.message));
  const url = `http://127.0.0.1:${server.address().port}${BASE}${QUERY}`;

  const reload = async () => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.hand-card');
    await page.waitForSelector('.rival');
  };

  // ---- 1. the zones, measured at the floor -------------------------------
  console.log(`\ndrop zones at ${VIEWPORT.width}x${VIEWPORT.height}`);
  await reload();
  const zones = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-drop]')) {
      const r = el.getBoundingClientRect();
      out.push({
        zone: el.getAttribute('data-drop'),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    const board = document.querySelector('.rival-board-live');
    const b = board?.getBoundingClientRect();
    return { out, board: b ? { w: Math.round(b.width), h: Math.round(b.height) } : null };
  });
  for (const z of zones.out) console.log(`  zone  ${z.zone}  ${z.w} x ${z.h}`);
  if (zones.board)
    console.log(`  (the click-only Notice Board button: ${zones.board.w} x ${zones.board.h})`);
  const smallest = Math.min(...zones.out.map((z) => Math.min(z.w, z.h)));
  check(
    'every drop zone clears a 44px finger target on its short side',
    smallest >= 44,
    `smallest side is ${smallest}px`,
  );

  // ---- 2. the mouse drag: card onto a neighbour --------------------------
  console.log('\nthe visit, dragged');
  const pair = await visitPair(page);
  if (!pair) {
    fail('a live neighbour to visit', 'no rival is lit in the warmed position');
  } else {
    let hotSeen = false;
    await mouseDrag(page, pair.from, pair.to, {
      onMove: async (t) => {
        if (t > 0.7 && !hotSeen) {
          hotSeen = (await page.locator('[data-drop-hot]').count()) > 0;
        }
      },
    });
    check('the zone lights up under the pointer', hotSeen, 'no [data-drop-hot] appeared');
    const panel = await page
      .locator('.prompt')
      .innerText()
      .catch(() => '');
    /*
     * ⭐ REWRITTEN FOR v31. This used to look for "from the bank, to you" and
     * then click a `.payoff` - the panel offered up to three of them (take the
     * money, the Special Orders prize, work one of the host's Hired Workers) and
     * the fee could be two cards. A v31 visit has ONE payoff, the host farm's
     * suit action, and costs exactly one card, so the panel is a title, a hint
     * and a row of fee chips: there is nothing left for a payoff button to be.
     *
     * What is checked instead is the property that matters and survived the
     * rewrite: a card dropped on a neighbour lands on the panel FOR THAT
     * NEIGHBOUR, and it is the hook's panel rather than the self-visit's.
     */
    check(
      'the drop lands on a neighbour visit panel',
      /visit /i.test(panel) && !/no neighbour involved/i.test(panel),
      `the prompt read: ${panel.slice(0, 120).replace(/\s+/g, ' ')}`,
    );
    check(
      'it is the hook, drawn as the hook',
      (await page.locator('.assembly-hook').count()) === 1 &&
        (await page.locator('.assembly-self').count()) === 0,
      'the panel is not marked as a neighbour visit',
    );
    check(
      'the host is marked as the one being visited',
      (await page.locator('.rival-visiting').count()) === 1,
      'no .rival-visiting',
    );

    // Choosing the fee still makes the move from here, which is the "same
    // confirmation surface" half of the ticket. The signal is the LAST feed line
    // rather than the number of them: the feed caps at 40 and a warmed position
    // is already there, so a count is a check that can never pass.
    const lastLine = () => page.locator('.feed-line').last().innerText();
    const before = await lastLine();
    await page.locator('.assembly-visit .chip').first().click();
    await page.waitForTimeout(150);
    check(
      'naming the fee makes the move',
      (await lastLine()) !== before,
      'the event feed did not change',
    );
    check(
      'the panel closes behind the move',
      (await page.locator('.assembly-visit').count()) === 0,
      'the visit panel is still open',
    );
  }

  // ---- 3. nothing obscures the board mid-flight --------------------------
  //
  // Found in a screenshot, not in an assertion: hover zoom is 400px of card
  // pinned to the bottom right, and dragging across your own tableau opened it
  // on every building on the way past. It is `pointer-events: none`, so the
  // drop still worked and only LOOKED broken - which is exactly the class of
  // failure a green test suite waves through.
  console.log('\nthe board stays visible while a card is in flight');
  await reload();
  const overTableau = await visitPair(page);
  if (overTableau) {
    const building = centre(await page.locator('.building').first().boundingBox());
    let zoomSeen = false;
    await mouseDrag(page, overTableau.from, building, {
      onMove: async () => {
        if (!zoomSeen) zoomSeen = await page.locator('.zoom').isVisible();
      },
    });
    check('hover zoom stays out of the way', !zoomSeen, 'the zoom panel covered the tableau');
  }

  // ---- 4. cancel by dropping on nothing ----------------------------------
  console.log('\ncancelling');
  await reload();
  const nowhere = await visitPair(page);
  if (nowhere) {
    const hand = await page.locator('.hand-card').count();
    await mouseDrag(page, nowhere.from, { x: VIEWPORT.width - 6, y: 8 });
    check(
      'a drop on nothing plays no move',
      (await page.locator('.hand-card').count()) === hand,
      'the hand changed size',
    );
    check(
      'a drop on nothing clears the held card',
      (await page.locator('.hand-card.is-held').count()) === 0,
      'a card is still held',
    );
    check(
      'the ghost is gone',
      (await page.locator('.drag-ghost .card').count()) === 0,
      'the ghost is still rendered',
    );
  }

  // ---- 5. the click path is untouched ------------------------------------
  console.log('\nclick still works, and a drag does not double-fire it');
  await reload();
  const clickPair = await visitPair(page);
  if (clickPair) {
    await clickPair.card.click();
    check(
      'clicking a hand card still picks it up',
      (await page.locator('.hand-card.is-held').count()) === 1,
      'no card held',
    );
    await page.keyboard.press('Escape');
    check(
      'escape puts it back',
      (await page.locator('.hand-card.is-held').count()) === 0,
      'still held',
    );
    // A drag ends in a click event: if it were not suppressed the card would be
    // picked straight back up after the drop resolved.
    await mouseDrag(page, clickPair.from, { x: VIEWPORT.width - 6, y: 8 });
    check(
      'the click that follows a drag is swallowed',
      (await page.locator('.hand-card.is-held').count()) === 0,
      'the release re-picked the card up',
    );
  }

  // ---- 6. touch -----------------------------------------------------------
  console.log('\nfrom a finger');
  await reload();
  const touch = await visitPair(page);
  if (touch) {
    const cdp = await context.newCDPSession(page);
    const scrollBefore = await page.evaluate(() => ({
      page: document.documentElement.scrollTop,
      rail: document.querySelector('.rail')?.scrollTop ?? 0,
    }));
    await touchDrag(cdp, touch.from, touch.to);
    const panel = await page
      .locator('.prompt')
      .innerText()
      .catch(() => '');
    check(
      'a finger drag opens the same visit panel',
      /visit /i.test(panel) && !/no neighbour involved/i.test(panel),
      `the prompt read: ${panel.slice(0, 120).replace(/\s+/g, ' ')}`,
    );
    const scrollAfter = await page.evaluate(() => ({
      page: document.documentElement.scrollTop,
      rail: document.querySelector('.rail')?.scrollTop ?? 0,
    }));
    check(
      'the drag does not scroll the page or the rail out from under it',
      scrollBefore.page === scrollAfter.page && scrollBefore.rail === scrollAfter.rail,
      `page ${scrollBefore.page}->${scrollAfter.page}, rail ${scrollBefore.rail}->${scrollAfter.rail}`,
    );
  }
} finally {
  await browser?.close();
  server?.close();
}

console.log(failures === 0 ? '\ndrag holds at the floor' : `\n${failures} drag failures`);
process.exit(failures === 0 ? 0 : 1);
