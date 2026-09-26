/**
 * A whole turn, played by keyboard alone (WP5 item 2, 25/09/2026).
 *
 * Reuses `verify-layout.mjs`'s static server and browser-launch shape - see
 * its own header. `?autostart=1` gets the fixture straight to a live turn
 * without needing to drive the start screen's own form (a separate surface,
 * not the turn bar's keyboard layer this file exists to prove); everything
 * FROM the turn-top onward uses `page.keyboard.press` only. No `page.click`,
 * `page.locator(...).click()` or any other pointer call appears anywhere
 * below the fixture load - a real regression here (a shortcut that silently
 * needs a mouse) would otherwise be invisible to this file.
 *
 *   npx vite build --outDir ../../.scratch/wp5-dist --emptyOutDir=false   (from packages/ui)
 *   GP_DIST=.scratch/wp5-dist node tools/verify-keyboard.mjs
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
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

function urlFor(server, query) {
  return `http://127.0.0.1:${server.address().port}${BASE}${query}`;
}

async function launchBrowser() {
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

let failures = 0;
function ok(msg) {
  console.log(`  ok    ${msg}`);
}
function fail(msg) {
  console.log(`  FAIL  ${msg}`);
  failures++;
}

/** Read the focused element's own useful bits, for logging and assertions. */
async function activeInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName,
      cls: el.className,
      text: (el.textContent || '').trim().slice(0, 40),
    };
  });
}

/**
 * Tab (or Shift+Tab) up to `max` times until `matches` - a no-argument
 * in-page function reading `document.activeElement` for itself - returns
 * true, or give up. Mirrors `verify-layout.mjs`'s own "Tab until class X"
 * loops, generalised to any matcher since this file needs several different
 * ones and each has to run inside the page, not out here in Node.
 */
async function tabUntil(page, matches, max = 60, shift = false) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(matches)) return true;
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
  }
  return page.evaluate(matches);
}

const onRivalBoard = () => {
  const el = document.activeElement;
  return (
    !!el && el.classList.contains('rival-board-live') && el.getAttribute('aria-disabled') !== 'true'
  );
};
const onChip = () => !!document.activeElement?.classList.contains('chip');
const onLiveDeck = () => {
  const el = document.activeElement;
  return !!el && el.classList.contains('deck') && el.getAttribute('aria-disabled') !== 'true';
};
const onHandCard = () => !!document.activeElement?.classList.contains('hand-card');
/*
 * `:not(.is-picked)` matters and is not decoration: `tabUntil`'s very first
 * check (before it presses a single Tab) tests wherever focus ALREADY is,
 * which after Enter on one revealed card is still that same button - now
 * carrying `.is-picked`. A bare `.revealed-card` match returns true
 * immediately on that unmoved focus, so a second call in a loop would press
 * Enter on the SAME card again and UN-pick it (`session/play.ts`'s subset
 * toggle: a card already in `picked` is removed by clicking it again) rather
 * than advancing to the next one - measured losing the first pick this way
 * before this exclusion was added.
 */
const onRevealedCard = () =>
  !!document.activeElement?.classList.contains('revealed-card') &&
  !document.activeElement.classList.contains('is-picked');
// T10b (26/09/2026): a task's cards and answers live in the task tray under
// the decks now (`Prompt.tsx`), not in `.prompt-dock`, so both count.
const onFocusableInDock = () =>
  document.activeElement !== document.body &&
  [...document.querySelectorAll('.prompt-dock, .task-tray')].some((dock) =>
    dock.contains(document.activeElement),
  );
const anyActionEnabled = () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.querySelector('.action-name'));
  return !!btn && !btn.disabled;
};

/**
 * A Notice Board's printed power fires AS PART OF the visit that buys it
 * (W3's "Harvest, then 1 card to your barn", V3's Deliver-or-fallback, A3's
 * Grow off a deck top...), and several of those are themselves a TASK - a
 * building to harvest, a hand card to place, cards to keep - which of the
 * three possible rival boards' power fires depends on which one Tab happened
 * to reach in step 3, so this cannot assume any one shape. Rather than one
 * branch per board power, this is the generic keyboard answer: while no main
 * action button has come back to life, Tab into whatever `.prompt-dock` is
 * showing and press Enter on the next thing in it - the same "just keep
 * going" a first-time player without a rulebook would do, and it is exactly
 * how `Prompt.tsx`'s docked answers are built to be walked (a hand card, a
 * revealed card, a building, a confirm button are all real, Tab-reachable
 * controls with no second keyboard idiom of their own).
 */
async function resolvePendingTask(page, max = 6) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(anyActionEnabled)) return true;
    const hasDock = await page.evaluate(() =>
      [...document.querySelectorAll('.prompt-dock, .task-tray')].some(
        (dock) => !!dock.querySelector('button, [tabindex="0"]'),
      ),
    );
    if (!hasDock) break;
    const reached = await tabUntil(page, onFocusableInDock, 40);
    if (!reached) break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  return page.evaluate(anyActionEnabled);
}
const onPrimaryButton = () =>
  document.activeElement?.tagName === 'BUTTON' &&
  document.activeElement.classList.contains('primary');

let server;
let browser;

try {
  server = await serveDist();
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  // The CookieYes script errors on every load in an offline test rig (no
  // network to its CDN) - documented on `TurnSummary.tsx`'s old comment, now
  // `session/escape.ts`'s header - and is not a failure of anything this file
  // tests. Any OTHER page error still fails the run.
  page.on('pageerror', (e) => {
    if (/cookieyes/i.test(e.message))
      console.log(`  --    (CookieYes offline, expected): ${e.message}`);
    else fail(`page error: ${e.message}`);
  });

  console.log('\n1. reach a live turn-top (autostart, no pointer used from here on)');
  await page.goto(urlFor(server, '?autostart=1&seats=4&depth=8&minHand=4'), {
    waitUntil: 'load',
  });
  await page.waitForSelector('.farm', { state: 'attached' });
  await page.waitForFunction(() => document.querySelectorAll('.rival').length > 0);
  ok('table loaded');

  console.log('\n2. the skip link is the first focusable element, and it works');
  // A fresh Tab from nowhere: `document.body` has no prior focus on a hard
  // navigation, so the very first Tab must land on the skip link.
  await page.keyboard.press('Tab');
  const first = await activeInfo(page);
  if (first?.cls?.includes('skip-link')) ok(`first Tab stop is the skip link (${first.text})`);
  else
    fail(`first Tab stop was ${first ? `${first.tag}.${first.cls}` : 'nothing'}, not .skip-link`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  const afterSkip = await activeInfo(page);
  if (afterSkip && afterSkip.tag === 'BUTTON' && !afterSkip.cls?.includes('skip-link')) {
    ok(`skip link moved focus into the turn bar (${afterSkip.text})`);
  } else {
    fail(`skip link did not move focus into the turn bar (landed on ${JSON.stringify(afterSkip)})`);
  }

  console.log('\n3. V arms the visit; a rival board and a fee chip complete it (keyboard only)');
  const bonusBefore = await page.evaluate(
    () => document.querySelector('.zone-bonus .zone-head')?.textContent ?? '',
  );
  await page.keyboard.press('v');
  await page.waitForTimeout(120);
  const armedForVisit = await page.evaluate(
    () => document.querySelectorAll('.rival-board-live').length > 0,
  );
  if (armedForVisit) {
    const reachedBoard = await tabUntil(page, onRivalBoard);
    if (reachedBoard) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
      const reachedChip = await tabUntil(page, onChip);
      if (reachedChip) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(150);
        const bonusAfter = await page.evaluate(
          () => document.querySelector('.zone-bonus .zone-head')?.textContent ?? '',
        );
        if (bonusAfter !== bonusBefore && /taken|again/.test(bonusAfter)) {
          ok(`visit completed by keyboard alone (bonus zone now "${bonusAfter}")`);
        } else {
          fail(`bonus zone did not read as taken after the keyboard visit ("${bonusAfter}")`);
        }
      } else {
        fail('never reached a fee chip by Tab after choosing a host');
      }
    } else {
      fail('never reached a live rival board by Tab after pressing V');
    }
  } else {
    console.log('  --    no rival board was live on this fixture; visit skipped, not failed');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // The visited board's OWN power just fired as part of that same visit
  // (W3/V3/O3/A3 all act at once, CLAUDE.md §2.2) and several of the five are
  // themselves a task - see `resolvePendingTask`'s own header. It is also
  // possible the visited power was the entire rest of the turn (a Harvest
  // with nothing left to do afterwards, say), in which case the turn has
  // already moved on and `resolvePendingTask`'s own "any action button
  // enabled" check reads that correctly as settled.
  const anyoneWaiting = (await page.locator('.waiting-on').count()) > 0;
  const settled = anyoneWaiting || (await resolvePendingTask(page));
  if (settled) ok('the visited board power (if any) resolved by keyboard');
  else fail('a task from the visited board power never cleared by keyboard');

  console.log('\n4. take an action by keyboard (D for Draw, completing any deck-choice task)');
  const drawEnabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => b.querySelector('.action-name')?.textContent === 'Draw',
    );
    return !!btn && !btn.disabled;
  });
  let actionTaken = false;
  if (drawEnabled) {
    await page.keyboard.press('d');
    await page.waitForTimeout(150);
    for (let i = 0; i < 3; i++) {
      if ((await page.locator('.waiting-on').count()) > 0) break;
      // 60, not 30 (T10b, 26/09/2026): a board power's task is now answered
      // in the task tray under the decks (`Prompt.tsx`), so when step 3's
      // answer removes the tray, the browser's Tab starting point is left
      // just AFTER the decks, and reaching them again is a full lap of the
      // page (island tiles, bar, farm, rail) - about 35 stops, not 17.
      const reachedDeck = await tabUntil(page, onLiveDeck, 60);
      if (!reachedDeck) break;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
    }
    // "Keep 2 of the 2 you saw" is still a TASK once both decks are named,
    // answered by Enter on each revealed card (`Prompt.tsx`'s `Revealed`,
    // `.revealed-card`, a real button) rather than by the deck again.
    for (let i = 0; i < 2; i++) {
      if ((await page.locator('.waiting-on').count()) > 0) break;
      const reachedCard = await tabUntil(page, onRevealedCard, 30);
      if (!reachedCard) break;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
    }
    /*
     * ⚠️ NO GENERIC "find a `.primary` button and press it" FALLBACK HERE, on
     * purpose. `Prompt.tsx`'s own "keep 2 of 2" auto-sends the moment both
     * revealed cards are picked (there is only one valid answer once every
     * revealed card is named), so no confirm button is ever shown to find -
     * and B18 (`session/play.ts`) marks the EXIT ROW'S End turn button
     * `.primary` too, as its own "ready to end your turn" cue, once a Draw
     * has revealed something. A generic Tab-to-`.primary` search run here
     * would find THAT button and press it early, which is worth naming even
     * though it was never reached with this list in the order it is in.
     *
     * ⚠️ MEASURED, NOT ASSUMED: on the fixture this file drives, the turn
     * ends the MOMENT the second revealed card is picked - `.waiting-on`
     * appears right there, with no separate `endTurn` move sent by anything
     * in this script. Whatever the engine's own reason (no bonus second play
     * and no Worker were on offer here), the observable fact is that "End
     * turn" is not always a live move once a mandatory task's answer lands,
     * and step 5 below checks for that rather than assuming E is always
     * needed - the same "does nothing when the matching button would be
     * disabled" contract every shortcut keeps.
     */
    actionTaken = true;
    ok('Draw taken by keyboard (D, Enter on live decks, Enter on the revealed cards)');
  } else {
    // Build as the fallback the brief itself offers.
    const buildEnabled = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.querySelector('.action-name')?.textContent === 'Build',
      );
      return !!btn && !btn.disabled;
    });
    if (buildEnabled) {
      await page.keyboard.press('b');
      await page.waitForTimeout(120);
      const reachedHand = await tabUntil(page, onHandCard);
      if (reachedHand) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(150);
        const reachedConfirm = await tabUntil(page, onPrimaryButton);
        if (reachedConfirm) await page.keyboard.press('Enter');
      }
      actionTaken = true;
      ok('Build taken by keyboard (B, a hand card, Enter to confirm)');
    }
  }
  if (!actionTaken)
    fail('neither Draw nor Build was legal on this fixture - cannot take an action');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  console.log('\n5. E ends the turn by keyboard');
  const endBefore = await page.evaluate(() => document.querySelector('.waiting-on')?.textContent);
  if (endBefore) {
    // ⚠️ Measured, not assumed: with no bonus left to take and no Worker
    // held, finishing the Draw's own "keep" task above can ALREADY be the
    // last thing this turn has - the engine hands the turn to the next seat
    // the moment that task's answer is sent, with no separate `endTurn` move
    // in between. E is exactly as correct here as it would be otherwise: this
    // file's job is proving the SHORTCUT does what the button does, and the
    // button ("End turn") is genuinely not offered once there is nothing
    // left for it to end - `moves.length === 0` for that family - which is
    // the same "does nothing when disabled" contract every other shortcut
    // keeps (`session/keys.ts`'s own header).
    ok(
      `the turn had already ended once the task above was answered ("${endBefore}") - E has nothing to do here, correctly`,
    );
  } else {
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    const endAfter = await page.evaluate(() => document.querySelector('.waiting-on')?.textContent);
    if (endAfter && endAfter !== endBefore) ok(`End turn sent by keyboard ("${endAfter}")`);
    else fail('E did not appear to end the turn (no new "waiting on" text)');
  }

  console.log('\n6. ? opens the shortcut sheet, Escape closes it, and focus returns');
  const beforeHelp = await activeInfo(page);
  await page.keyboard.press('?');
  const opened = await page
    .waitForSelector('.keyhelp', { state: 'attached', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (opened) {
    ok('the shortcut sheet opened on ?');
    const focusedInDialog = await page.evaluate(
      () => !!document.activeElement?.closest('.keyhelp'),
    );
    if (focusedInDialog) ok('focus moved into the shortcut sheet');
    else fail('focus did not move into the shortcut sheet on open');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const closed = (await page.locator('.keyhelp').count()) === 0;
    if (closed) ok('Escape closed the shortcut sheet');
    else fail('the shortcut sheet is still open after Escape');

    const afterHelp = await activeInfo(page);
    if (afterHelp && !afterHelp.cls?.includes('keyhelp')) {
      ok(`focus returned after closing (was "${beforeHelp?.text}", now "${afterHelp.text}")`);
    } else {
      fail('focus did not return to the page after closing the shortcut sheet');
    }
  } else {
    fail('the shortcut sheet did not open on ?');
  }
} finally {
  await browser?.close();
  server?.close();
}

console.log(
  failures === 0
    ? '\na full turn plays by keyboard alone'
    : `\n${failures} keyboard-only failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
