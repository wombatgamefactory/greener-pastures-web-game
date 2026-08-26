/**
 * Phase 0 of the UI redesign: the baseline, measured rather than asserted.
 *
 * The redesign plan (docs/web-ui-redesign-plan-v1.md) claims two numbers are
 * wrong and sets out to move them. This tool is what says whether they moved:
 *
 *   deadSpace   the share of `.farm`'s height nothing is drawn in. The reading
 *               region in Phase 1 is meant to live there, so if this is small
 *               the plan's premise is wrong and Phase 1 needs re-siting.
 *   clipped     hand cards whose title is cut off by the next card in the fan.
 *               Measured, not eyeballed: a card is clipped when the card to its
 *               right starts before this card's title band ends.
 *   capacity    how many buildings would fit in the room the tableau has, at
 *               the size the cards are drawn now. The fixture ceiling is 10 and
 *               a real farm reaches 12-14, so this is the only way to test the
 *               case that actually slices. See the block that computes it.
 *
 * It also counts PANELS - regions carrying the same border-and-fill chrome -
 * because "eleven boxes of equal weight" is the plan's central claim about why
 * the screen reads as dense, and it should be a number too.
 *
 * Run it before a phase and after it:
 *
 *   npm run build && node tools/measure-ui.mjs
 *   node tools/measure-ui.mjs --tag after-phase-1
 *
 * Fixture selection is automatic. Rather than hand-picking a seed, it walks a
 * list of candidates and keeps the DENSEST table it finds - most buildings,
 * fullest hand, most rivals carrying Workers - because a baseline taken on a
 * kind position measures nothing. The winner is printed so it can be pinned.
 *
 * Deliberately NOT part of `npm run check`: it needs a build and a browser.
 */

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const VIEWPORTS = [
  { name: 'floor', width: 1024, height: 700 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1600, height: 900 },
];

/**
 * Candidate fixtures.
 *
 * ⚠️ SEED AND DEPTH ARE NOT THE SAME DIAL, and conflating them is how the first
 * baseline run got read wrong. `depth` walks further into ONE game; `seed`
 * starts a different game entirely. So a row with a bigger depth AND a new seed
 * says nothing about depth - it is just another game, which is exactly why
 * "depth 760" appeared to produce FEWER buildings than depth 600.
 *
 * There is also a ceiling on depth that is not obvious: `Session.walk` replays
 * back to the deepest playable turn-top rather than hand over a finished board
 * (session/table.ts), so asking for more depth than the game has left silently
 * gives you a LATE position, not a denser one. Past that point the only way to
 * a bigger tableau is a different seed.
 *
 * `--sweep` is how these rows were found: it holds each seed and walks the
 * depth ladder, reporting the tableau each one reaches. Re-run it whenever the
 * rules change the length of a game.
 */
const FIXTURES = [
  { seed: 'baseline-a', depth: 320, minHand: 4 },
  { seed: 'baseline-b', depth: 460, minHand: 5 },
  { seed: 'baseline-c', depth: 600, minHand: 5 },
  { seed: 'dense-a', depth: 760, minHand: 6 },
  { seed: 'dense-b', depth: 900, minHand: 6 },
  { seed: 'dense-c', depth: 1100, minHand: 6 },
  /*
   * The widest tableau the warm-up can reach: 10 buildings. Found by `--sweep`,
   * which also found the ceiling - no seed and no depth gets past 10, because
   * the walk replays back to the last playable turn-top rather than overrun the
   * game. A 12+ building farm is reachable in real play and is NOT testable
   * here; the floor viewport is the stand-in, since what slices a tableau is
   * (buildings x card size) / box height and the floor squeezes the box hardest.
   */
  { seed: 'baseline-c', depth: 800, minHand: 5 },
];

/** Seeds and depths `--sweep` crosses, looking for the biggest tableau. */
const SWEEP_SEEDS = ['baseline-a', 'baseline-b', 'baseline-c', 'dense-a', 'dense-b', 'dense-c'];
const SWEEP_DEPTHS = [320, 480, 640, 800];

const args = process.argv.slice(2);
const tagAt = args.indexOf('--tag');
const TAG = tagAt === -1 ? 'baseline-v1' : (args[tagAt + 1] ?? 'baseline-v1');
const SWEEP = args.includes('--sweep');

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'packages', 'ui', 'dist');
const OUT = join(ROOT, 'reports', `ui-${TAG}`);
/** Must match `base` in vite.config.ts. */
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

function urlFor(server, fixture) {
  const q = `?autostart=1&seats=4&seed=${fixture.seed}&depth=${fixture.depth}&minHand=${fixture.minHand}`;
  return `http://127.0.0.1:${server.address().port}${BASE}${q}`;
}

/**
 * Everything measured in one browser-side pass.
 *
 * The two headline numbers are deliberately geometric rather than semantic:
 * they are read off real rendered boxes, so they cannot drift out of step with
 * what a player actually sees the way a count derived from game state can.
 */
function probe() {
  const rect = (el) => el.getBoundingClientRect();
  const farm = document.querySelector('.farm');
  const tableau = document.querySelector('.tableau');
  const strips = document.querySelector('.farm-strips');
  const head = document.querySelector('.farm-head');

  /*
   * DEAD SPACE. The farm's own height, less the height its three rows actually
   * draw in. The tableau's BOX is full-height (it is the 1fr row) but its
   * CONTENT is not, so what counts is the bottom of the lowest building, not
   * the bottom of the tableau.
   */
  const buildings = [...document.querySelectorAll('.building')];
  const lowestBuilding = buildings.length
    ? Math.max(...buildings.map((b) => rect(b).bottom))
    : null;
  let deadSpace = null;
  if (farm && tableau && lowestBuilding !== null) {
    const gap = (strips ? rect(strips).top : rect(tableau).bottom) - lowestBuilding;
    deadSpace = Math.round((Math.max(0, gap) / rect(farm).height) * 100);
  }

  /*
   * CLIPPED TITLES. A hand card's name sits in the band across the top of the
   * card. The fan overlaps from the left, so a card is clipped when the NEXT
   * card's left edge falls inside this one's title run. The title band is the
   * card's full width, so the test is simply: how much of this card is still
   * uncovered, as a share of its own width?
   *
   * 0.62 is the threshold rather than 1.0 because a small overlap eats only the
   * card's right margin. Below ~62% of a card's width the name itself starts to
   * go, which is what was measured off the 5/5 hand in the warm-table shot.
   */
  const handCards = [...document.querySelectorAll('.hand-card')];
  let clipped = 0;
  for (let i = 0; i < handCards.length - 1; i++) {
    const here = rect(handCards[i]);
    const next = rect(handCards[i + 1]);
    const cardWidth = rect(handCards[i].querySelector('.card') ?? handCards[i]).width;
    if (cardWidth > 0 && (next.left - here.left) / cardWidth < 0.62) clipped++;
  }

  /*
   * PANELS. Regions carrying the border-and-fill chrome. Counted by computed
   * style rather than by class, so it stays honest when Phase 2 strips the
   * chrome off some of them but leaves the class in place.
   *
   * THE DEFINITION, written down because a number that can be argued with after
   * the fact is not a number:
   *
   *   a region is CHROMED if it has a FILL that differs from the page
   *   background, or a BORDER ON ALL FOUR SIDES.
   *
   * That is what makes a region read as a container rather than as content
   * sitting on the table, and containers of equal weight are the thing Phase 2
   * exists to reduce - nine of them was the baseline, and the target is that
   * your own farm is the only one left.
   *
   * ⚠️ REVISED IN PHASE 2, AND THE OLD TEST WAS NOT MERELY LOOSER - IT WAS
   * ARBITRARY. It asked `borderTopWidth !== 0 || backgroundColor !== transparent`,
   * so whether a single accent edge counted as chrome depended entirely on which
   * SIDE it was drawn on: a 4px colour bar along the top counted, the identical
   * bar down the left did not. Phase 3's rail keeps exactly such an edge (the
   * 4px seat colour, which is the only separator left between neighbours), so
   * the metric had to say something defensible about it before it could be
   * measured against.
   *
   * It says: an accent edge is not chrome. It costs one colour on one side, it
   * carries information, and it cannot be mistaken for a box. Four sides can.
   *
   * The test is deliberately NOT weakened past that. It is side-agnostic, so an
   * accent cannot be smuggled in by moving it; it counts any fill at all, so a
   * pale wash is still a fill (the active neighbour's highlight is a real
   * background and is counted as one whenever it is on screen); and it says
   * nothing about shadows or radii, which cannot make a box on their own but
   * also cannot save one that already is.
   */
  const isChrome = (el) => {
    const s = getComputedStyle(el);
    const page = getComputedStyle(document.body).backgroundColor;
    const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    const filled = !transparent(s.backgroundColor) && s.backgroundColor !== page;
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const framed = sides.every(
      (side) =>
        Number.parseFloat(s[`border${side}Width`]) > 0 &&
        s[`border${side}Style`] !== 'none' &&
        !transparent(s[`border${side}Color`]),
    );
    return filled || framed;
  };
  const panels = [...document.querySelectorAll('.panel, .rival, .farm, .feed')];
  const chromedList = panels.filter(isChrome).map((el) => `.${[...el.classList].join('.')}`);
  const chromed = chromedList.length;

  /*
   * TABLEAU OVERFLOW. `.tableau` scrolls internally, so a farm with more
   * buildings than fit does not break the layout - it silently SLICES the last
   * row in half, which is worse than a scrollbar because it looks deliberate.
   * Measured as the hidden height, and as the count of buildings whose bottom
   * edge falls outside the tableau's box.
   */
  let tableauHidden = 0;
  let slicedBuildings = 0;
  if (tableau) {
    const box = rect(tableau);
    tableauHidden = Math.max(0, tableau.scrollHeight - Math.round(box.height));
    slicedBuildings = buildings.filter((b) => rect(b).bottom > box.bottom + 1).length;
  }

  /*
   * TABLEAU CAPACITY. How many buildings, at the size they are drawn right now,
   * would fit in the space the tableau is allowed to have.
   *
   * This is the number that tests the case we cannot build a fixture for. The
   * warm-up tops out at 10 buildings - `Session.walk` replays back to the last
   * playable turn-top rather than overrun the game, so no seed and no depth
   * gets past it - while a real farm reaches 12 to 14. `slicedBuildings: 0`
   * only ever proves that today's ten fit. Capacity says whether fourteen would.
   *
   * TWO THINGS ARE EASY TO GET WRONG HERE.
   *
   * It is measured against the space the tableau CAN have, not the box it
   * currently occupies. The farm hugs its content now (`align-self: start` in
   * table.css), so with ten buildings the tableau's box is exactly two rows
   * tall and a naive read would report "two rows fit" - a number that describes
   * the content rather than the room. The farm's unspent height is the slack it
   * would give the tableau if the tableau asked, so it is added back.
   *
   * And the packing is `floor((available + gap) / (card + gap))`, not
   * `floor(available / (card + gap))`. N cards in a line need N card widths and
   * only N-1 gaps, so the cheaper form is short by one whenever the last gap is
   * what does not fit - which at these sizes is most of the time, and would
   * report a box holding exactly two rows as holding one.
   */
  let tableauCapacity = null;
  let tableauGrid = null;
  /*
   * FARM SLACK: the height the farm's row offers that the farm does not use -
   * the bare table between its bottom edge and the turn bar.
   *
   * Phase 1 created it (the panel was collapsed onto its content) and Phase 2
   * spends it, by growing the commons above until the farm's row is nearly all
   * taken. Reported rather than left implicit because it is the dial's headroom:
   * a step with slack left has room for a bigger island, and a step at zero is
   * one change away from squeezing the tableau and slicing a row of buildings.
   */
  let farmSlack = null;
  const firstCard = buildings[0]?.querySelector('.card');
  if (tableau && farm && firstCard) {
    const style = getComputedStyle(tableau);
    const gap = Number.parseFloat(style.rowGap) || 0;
    const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const card = rect(firstCard);

    // What the farm's row in `.main-column` offers, less what its siblings take.
    const column = farm.parentElement;
    const colStyle = getComputedStyle(column);
    const colGap = Number.parseFloat(colStyle.rowGap) || 0;
    const siblings = [...column.children].filter((el) => el !== farm);
    const taken = siblings.reduce((a, el) => a + rect(el).height, 0);
    const farmRoom = rect(column).height - taken - colGap * (column.children.length - 1);
    const slack = Math.max(0, farmRoom - rect(farm).height);

    const usableW = rect(tableau).width - padX;
    const usableH = rect(tableau).height - padY + slack;
    const cols = Math.max(0, Math.floor((usableW + gap) / (card.width + gap)));
    const rows = Math.max(0, Math.floor((usableH + gap) / (card.height + gap)));
    tableauCapacity = cols * rows;
    tableauGrid = `${cols} x ${rows}`;
    farmSlack = Math.round(slack);
  }

  /*
   * THE RIGHT GUTTER. `.commons-right` is `align-content: start`, so whatever
   * height the commons row is given below the Fair and the Aerodrome is empty
   * background. On the worst-case table this is the largest unused rectangle on
   * screen - which makes it, not the farm, the candidate site for a reading
   * region.
   */
  const right = document.querySelector('.commons-right');
  const gutter = right
    ? (() => {
        const box = rect(right);
        const panels = [...right.querySelectorAll(':scope > .panel')];
        const lowest = panels.length ? Math.max(...panels.map((p) => rect(p).bottom)) : box.top;
        return {
          width: Math.round(box.width),
          height: Math.round(Math.max(0, box.bottom - lowest)),
        };
      })()
    : null;

  const rivals = [...document.querySelectorAll('.rival')];
  return {
    deadSpace,
    tableauHidden,
    slicedBuildings,
    tableauCapacity,
    tableauGrid,
    farmSlack,
    gutter,
    clipped,
    handCards: handCards.length,
    chromedPanels: chromed,
    chromedList,
    buildings: buildings.length,
    rivals: rivals.length,
    rivalsWithWorkers: rivals.filter((r) => r.querySelector('.worker')).length,
    barnPiles: document.querySelectorAll('.barn-pile').length,
    actionButtons: document.querySelectorAll('.action-buttons .action').length,
    farmHeight: farm ? Math.round(rect(farm).height) : null,
    headHeight: head ? Math.round(rect(head).height) : null,
    pageScrollsY: document.documentElement.scrollHeight > window.innerHeight + 1,
  };
}

/**
 * How worth-measuring a fixture is. Denser is better: a kind table hides faults.
 *
 * BUILDINGS DOMINATE DELIBERATELY. The defect this harness exists to watch is
 * the tableau slicing its bottom row, and that is driven by the tableau's width
 * in cards - so a fixture with a wider tableau is a better test than one with a
 * fuller hand, even though the hand scores more "stuff on screen". An earlier
 * weighting had them close enough that a 9-building/5-card table beat a
 * 10-building/2-card one, which measured the wrong thing.
 */
function density(m) {
  return m.buildings * 10 + m.handCards * 2 + m.rivalsWithWorkers * 4 + m.barnPiles;
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

  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`  PAGE ERROR  ${e.message}`));
  mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });

  /*
   * `--sweep`: hold the seed, walk the depth ladder. This is the mode that
   * separates the two dials, and its output is what the FIXTURES rows are
   * chosen from. It measures and exits - no screenshots, no report.
   */
  if (SWEEP) {
    console.log('seed          ' + SWEEP_DEPTHS.map((d) => `d${d}`.padStart(8)).join(''));
    for (const seed of SWEEP_SEEDS) {
      const cells = [];
      for (const depth of SWEEP_DEPTHS) {
        await page.goto(urlFor(server, { seed, depth, minHand: 5 }), { waitUntil: 'networkidle' });
        const m = await page.evaluate(probe);
        cells.push(`${m.buildings}b/${m.handCards}h`.padStart(8));
      }
      console.log(`${seed.padEnd(14)}${cells.join('')}`);
    }
    console.log('\nb = buildings in your tableau, h = cards in hand');
    process.exit(0);
  }

  // --- pick the fixture, at the desktop step so nothing is hidden by a floor --
  console.log('choosing a fixture (densest wins)\n');
  let best = null;
  for (const fixture of FIXTURES) {
    await page.goto(urlFor(server, fixture), { waitUntil: 'networkidle' });
    const m = await page.evaluate(probe);
    const score = density(m);
    console.log(
      `  ${fixture.seed.padEnd(12)} depth ${String(fixture.depth).padStart(4)}  ` +
        `${m.buildings} buildings, ${m.handCards} in hand, ` +
        `${m.rivalsWithWorkers}/${m.rivals} rivals with Workers, ${m.barnPiles} barn piles  ` +
        `(density ${score})`,
    );
    if (best === null || score > best.score) best = { fixture, score };
  }
  console.log(`\nfixture: ${best.fixture.seed} at depth ${best.fixture.depth}\n`);

  // --- measure and shoot it at every viewport -------------------------------
  const url = urlFor(server, best.fixture);
  const report = { tag: TAG, takenAt: new Date().toISOString(), fixture: best.fixture, steps: {} };

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(url, { waitUntil: 'networkidle' });
    const m = await page.evaluate(probe);

    /*
     * The turn bar has TWO shapes and only one of them is on screen at a time.
     * The bonus phase filters the families down to the slot's options, so a
     * measurement taken on an opening turn reports four buttons and misses the
     * flat row entirely - which is the shape the redesign is actually aimed at.
     * Skipping the bonus is a local UI state, not a move, so this costs the
     * position nothing and the screenshot is still of a real turn.
     */
    const skip = page.locator('.bonus-exits button');
    if (await skip.count()) {
      await skip.first().click();
      m.actionButtonsMain = await page.locator('.action-buttons .action').count();
    } else {
      m.actionButtonsMain = m.actionButtons;
    }
    report.steps[viewport.name] = m;

    const shot = join(OUT, `${viewport.name}.png`);
    await page.screenshot({ path: shot });

    console.log(`${viewport.name}  ${viewport.width}x${viewport.height}`);
    console.log(`  farm dead space     ${m.deadSpace}%   (of ${m.farmHeight}px)`);
    console.log(
      `  tableau overflow    ${m.tableauHidden}px hidden, ${m.slicedBuildings} of ${m.buildings} buildings sliced`,
    );
    console.log(
      `  tableau capacity    ${m.tableauCapacity} buildings at this size (${m.tableauGrid})`,
    );
    console.log(`  farm slack          ${m.farmSlack}px of its row unspent`);
    console.log(
      `  right gutter        ${m.gutter ? `${m.gutter.width} x ${m.gutter.height}px unused` : 'n/a'}`,
    );
    console.log(`  clipped hand cards  ${m.clipped} of ${m.handCards}`);
    console.log(
      `  chromed panels      ${m.chromedPanels}` +
        (m.chromedList.length ? `  (${m.chromedList.join(', ')})` : ''),
    );
    console.log(
      `  action buttons      ${m.actionButtons} in the bonus phase, ${m.actionButtonsMain} in the main phase`,
    );
    if (m.pageScrollsY) console.log('  WARNING  the page scrolls vertically');
    console.log(`  -> ${shot}`);
  }

  writeFileSync(join(OUT, 'measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwritten to ${OUT}`);
} finally {
  await browser?.close();
  server?.close();
}
