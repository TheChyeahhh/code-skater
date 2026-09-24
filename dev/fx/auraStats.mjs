// dev/fx/auraStats.mjs (fx track): reads window.__auraStats from dev/fx/aura.html?case=skater for a few
// variants (glow off, round-1 push, current profile) and prints the colours side by side; saves a PNG
// of each into <outDir>. node dev/fx/auraStats.mjs <baseUrl> <outDir> [extra query] [--gpu]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base, outDir, extra = ''] = process.argv.slice(2).filter((a) => a !== '--gpu');
const gpu = process.argv.includes('--gpu');
const args = gpu ? ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args });
const variants = [
  ['off', 'glow=0'],
  ['round1', 'push=1&coreback=0&core=0&rim=0.01'],
  ['now', ''],
];
const rows = [];
for (const [name, q] of variants) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const url = `${base}/dev/fx/aura.html?case=skater&${q}&${extra}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true && window.__auraStats, null, { timeout: 60000 });
  const st = await page.evaluate(() => window.__auraStats);
  await page.screenshot({ path: `${outDir}/aura-${name}${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '_') : ''}.png` });
  rows.push({ name, ...st });
  await page.close();
}
await browser.close();
const off = rows[0];
const pct = (a, b) => (100 * (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.max(1, Math.hypot(b[0], b[1], b[2])))).toFixed(1);
for (const r of rows) console.log(`${r.name.padEnd(7)} hoodie ${r.hoodie.join(',').padEnd(12)} (${pct(r.hoodie, off.hoodie)}%)  pants ${r.pants.join(',').padEnd(12)} (${pct(r.pants, off.pants)}%)  ring ${r.ring}  mask ${r.maskPx}`);
