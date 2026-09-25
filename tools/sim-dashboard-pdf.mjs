// Print a built sim dashboard to PDF (A4 landscape, light theme).
//   node tools/sim-dashboard-pdf.mjs reports/<dashboard>.html reports/<name>.pdf
// Needs playwright-core's Chromium (npx playwright-core install chromium).
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [src, out] = process.argv.slice(2);
if (!src || !out)
  throw new Error('usage: node tools/sim-dashboard-pdf.mjs <dashboard.html> <out.pdf>');
if (existsSync(out))
  throw new Error(`${out} exists; pass a new versioned name rather than overwrite it`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  colorScheme: 'light',
});
await page.goto(pathToFileURL(resolve(src)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: 'print', colorScheme: 'light' });
await page.pdf({
  path: out,
  format: 'A4',
  landscape: true,
  scale: 0.75,
  printBackground: true,
  preferCSSPageSize: false,
  margin: { top: '10mm', bottom: '12mm', left: '10mm', right: '10mm' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="font:8px sans-serif;color:#7d8a81;width:100%;text-align:center">Greener Pastures computer playtest · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
});
await browser.close();
console.log(`wrote ${out}`);
