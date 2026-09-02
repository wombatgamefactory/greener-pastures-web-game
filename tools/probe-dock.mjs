/**
 * What the hand's dock magnifier ACTUALLY draws, at every step of the ladder.
 *
 * `view/dock.test.ts` pins the arithmetic against fan shapes typed into a
 * fixture list. This measures the shapes the real layout produces, and it is
 * what caught the thing the unit tests could not: on 27/08/2026 the dock passed
 * every assertion in that file and still drew
 *
 *      1.12   1.36   1.48   1.36   1.12
 *
 * at 1600x900, which is a magnifier nobody can see working. A wave is a SHAPE,
 * and the only way to know whether the shape is right is to print it.
 *
 * Per viewport it reports the resting geometry the arithmetic ran on, the live
 * scale of every card with the pointer on the middle one, the gap between each
 * neighbouring pair, and the worst overrun found by putting the pointer on
 * every card in turn - which is the check that the strip never reaches the
 * barn, the rail, or the turn bar above the farm panel.
 *
 * Deliberately NOT part of `npm run check`: it needs a build and a browser.
 *
 *   npm run build && node tools/probe-dock.mjs
 *   node tools/probe-dock.mjs --shot reports/dock.png
 */
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const DIST = resolve('packages/ui/dist');
const BASE = '/greener-pastures-web-game/';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const query = '?autostart=1&seats=4&depth=320&minHand=6';

function serveDist() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path.slice(1);
    let file = normalize(join(DIST, rel));
    if (!file.startsWith(DIST)) return void res.writeHead(403).end();
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, {
      'content-type': MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const VIEWPORTS = [
  { name: 'floor', width: 1024, height: 700 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1600, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
  // The three large steps `tools/measure-ui.mjs` pins: 4K at 150%, a 21:9
  // ultrawide (identical once the layout cap bites), and 4K at 100%.
  { name: '2560', width: 2560, height: 1440 },
  { name: '3440', width: 3440, height: 1440 },
  { name: '3840', width: 3840, height: 2160 },
];

const shotAt = process.argv.indexOf('--shot');
const shotPath = shotAt === -1 ? null : process.argv[shotAt + 1];

const server = await serveDist();
let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* next */
  }
}
const page = await browser.newPage();
const url = `http://127.0.0.1:${server.address().port}${BASE}${query}`;

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.hand-card', { state: 'attached' });
  await page.waitForTimeout(300);

  const rest = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand-card')];
    const inner = (el) => el.querySelector('.card') ?? el;
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, w: b.width, h: b.height };
    };
    const hand = document.querySelector('.hand');
    const strips = document.querySelector('.farm-strips');
    const farm = document.querySelector('.farm');
    const barn = document.querySelector('.barn');
    return {
      n: cards.length,
      boxes: cards.map((c) => r(inner(c))),
      hand: r(hand),
      strips: r(strips),
      farm: r(farm),
      barn: barn ? r(barn) : null,
      peakToken: getComputedStyle(hand).getPropertyValue('--dock-peak'),
      fan: getComputedStyle(hand).getPropertyValue('--hand-fan'),
      vw: window.innerWidth,
    };
  });

  // Every card in turn, so the overrun at the ends of the row is measured too.
  const read = async () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.hand-card')];
      const inner = (el) => el.querySelector('.card') ?? el;
      return cards.map((c) => {
        const el = inner(c);
        const b = el.getBoundingClientRect();
        return {
          l: b.left,
          r: b.right,
          t: b.top,
          w: b.width,
          s: +(getComputedStyle(el).getPropertyValue('--dock-s') || 1),
        };
      });
    });
  let worstRight = -Infinity;
  let worstLeft = Infinity;
  let worstTop = Infinity;
  for (let i = 0; i < rest.n; i++) {
    const b = rest.boxes[i];
    await page.mouse.move(b.l + b.w / 2, b.t + b.h / 2);
    await page.waitForTimeout(260);
    const now = await read();
    worstRight = Math.max(worstRight, ...now.map((c) => c.r));
    worstLeft = Math.min(worstLeft, ...now.map((c) => c.l));
    worstTop = Math.min(worstTop, ...now.map((c) => c.t));
  }

  // hover the middle card
  const mid = Math.floor(rest.n / 2);
  const box = rest.boxes[mid];
  await page.mouse.move(box.l + box.w / 2, box.t + box.h / 2);
  await page.waitForTimeout(400);

  const live = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand-card')];
    const inner = (el) => el.querySelector('.card') ?? el;
    return cards.map((c) => {
      const el = inner(c);
      const b = el.getBoundingClientRect();
      return {
        l: b.left,
        r: b.right,
        t: b.top,
        w: b.width,
        s: +(getComputedStyle(el).getPropertyValue('--dock-s') || 1),
      };
    });
  });

  const restW = rest.boxes[0].w;
  const advance = rest.n > 1 ? (rest.boxes.at(-1).l - rest.boxes[0].l) / (rest.n - 1) : restW;
  const budget = rest.strips.r - rest.boxes.at(-1).r;
  console.log(`\n${vp.name}  ${vp.width}x${vp.height}   cards ${rest.n}`);
  console.log(
    `  card ${restW.toFixed(0)}px  advance ${advance.toFixed(0)}px (${(advance / restW).toFixed(2)} card)  --hand-fan${rest.fan}  --dock-peak${rest.peakToken}`,
  );
  console.log(
    `  hand row ${rest.hand.w.toFixed(0)}  strips ${rest.strips.w.toFixed(0)}  farm ${rest.farm.w.toFixed(0)}  budget-to-strips-right ${budget.toFixed(0)}px`,
  );
  console.log(`  scales: ${live.map((c) => c.s.toFixed(2)).join(' ')}`);
  const gaps = live.slice(1).map((c, i) => c.l - live[i].r);
  console.log(`  gaps:   ${gaps.map((g) => g.toFixed(0).padStart(5)).join(' ')}`);
  console.log(
    `  lift:   ${(rest.boxes[0].t - live[0].t).toFixed(0)}px   widest live card ${Math.max(...live.map((c) => c.w)).toFixed(0)}px`,
  );
  const overBarn = worstRight - rest.strips.r;
  const overRow = worstRight - rest.hand.r;
  const overLeft = rest.boxes[0].l - worstLeft;
  const overTop = rest.farm.t - worstTop;
  console.log(
    `  worst over: row ${overRow.toFixed(0)}px  strips/barn column ${overBarn.toFixed(0)}px  ` +
      `left of rest ${overLeft.toFixed(0)}px  above farm top ${overTop.toFixed(0)}px`,
  );
  const covered = await page.evaluate(
    () => document.querySelector('.farm')?.classList.contains('dock-covered') ?? false,
  );
  const overPanel = worstRight - rest.farm.r;
  console.log(
    `  took the reading column: ${covered ? 'YES' : 'no'}   past the farm panel ${overPanel.toFixed(0)}px`,
  );

  if (shotPath) {
    const target = resolve(shotPath.replace(/(\.png)?$/, `-${vp.name}.png`));
    mkdirSync(dirname(target), { recursive: true });
    await page.screenshot({ path: target });
  }
}
await browser.close();
server.close();
