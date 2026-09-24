// dev/fx/grindShot.mjs (fx track): the real game on Market Street grinding the Bus Stop Bar (MS-R2) in
// daylight, driven through window.__codeSkater.debug, then measures the grind sparks: the frame with
// sparks against the same frame after the spark stream is switched off live (TUNING is the same module
// instance in the dev server), the changed pixels are the sparks. Prints their count, mean HSV
// saturation and mean colour, and how many are near white (RGB sum > 600), saves both frames.
//   node dev/fx/grindShot.mjs <baseUrl> <out.png> [--gpu] [--tune KEY=value ...]
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const gpu = argv.includes('--gpu');
const tunes = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--tune') tunes.push(argv[++i]);
const [base, out] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--tune');
const args = gpu ? ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
mkdirSync(dirname(out), { recursive: true });
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/', { waitUntil: 'load' });
// The start gate: any click, then the main menu boots the game chunk.
await page.waitForTimeout(500);
await page.mouse.click(640, 360);
await page.mouse.move(2, 2);
await page.waitForFunction(() => window.__codeSkater?.debug?.ready === true, null, { timeout: 90000 });
await page.evaluate(async (tunes) => {
  const { TUNING } = await import(performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes('/src/core/tuning.ts')) ?? '/src/core/tuning.ts');
  for (const t of tunes) {
    const [k, v] = t.split('=');
    TUNING[k] = Number(v);
  }
  const d = window.__codeSkater.debug;
  await d.startRun('marketStreet', 'free');
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // Same drive as e2e/smoke.spec.ts: roll at the rail, ollie just before it, pulse grind in the air,
  // balance against the needle, stop 40 ticks into the grind.
  const rail = { start: { x: 60, z: 85.7 }, dir: { x: 1, z: 0 } };
  d.teleport({ x: rail.start.x - 3.5, y: 0, z: rail.start.z }, { x: 1, y: 0, z: 0 }, 7);
  d.setInput({ held: { ollie: false, grind: false }, dpad: 'N', stick: { x: 0, y: 0 } });
  d.step(1);
  let phase = 'approach';
  let popTick = -1;
  let grindTicks = 0;
  for (let t = 0; t < 1500 && grindTicks < 40; t++) {
    const s = d.snapshot();
    const along = (s.skater.pos.x - rail.start.x) * rail.dir.x + (s.skater.pos.z - rail.start.z) * rail.dir.z;
    let held = { ollie: false, grind: false };
    let dpad = 'N';
    if (phase === 'approach') {
      if (along > -1.2) {
        held = { ollie: true, grind: false };
        if (popTick < 0) popTick = t;
        if (t - popTick >= 2) phase = 'air';
      }
    } else if (phase === 'air') {
      held = { ollie: false, grind: t % 2 === 0 };
      if (s.skater.state === 'Grind') phase = 'grind';
    } else if (s.skater.state === 'Grind') {
      grindTicks++;
      held = { ollie: false, grind: true };
      if (s.balance) dpad = s.balance.needle > 0 ? 'L' : 'R';
    } else break;
    d.setInput({ held, dpad });
    d.step(1);
    if (t % 2 === 0) await frame();
  }
  // Freeze the sim mid grind and let the renderer run on real time so the stream is steady.
  for (let f = 0; f < 30; f++) await frame();
  window.__grindState = d.snapshot().skater.state;
}, tunes);
const state = await page.evaluate(() => window.__grindState);
await page.screenshot({ path: out });
await page.evaluate(async () => {
  const { TUNING } = await import(performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes('/src/core/tuning.ts')) ?? '/src/core/tuning.ts');
  TUNING.SPARK_RATE_PER_S = 0;
  TUNING.FX_CONTACT_GLOW_M = 0.05;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let f = 0; f < 90; f++) await frame();
});
const off = out.replace(/\.png$/, '-nospark.png');
await page.screenshot({ path: off });
// Diff in a blank page with a 2D canvas.
const fs = await import('node:fs');
const a = fs.readFileSync(out).toString('base64');
const b = fs.readFileSync(off).toString('base64');
const stats = await page.evaluate(async ([a, b]) => {
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const c = document.createElement('canvas');
  c.width = ia.width; c.height = ia.height;
  const g = c.getContext('2d');
  g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, c.width, c.height).data;
  g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, sat = 0, white = 0; const mean = [0, 0, 0];
  // Only a box around the board (the chase camera keeps the contact near the lower middle).
  for (let i = 0; i < A.length; i += 4) {
    const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width);
    if (px < c.width * 0.36 || px > c.width * 0.64 || py < c.height * 0.5 || py > c.height * 0.85) continue;
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d < 90) continue;
    const r = A[i], gg = A[i + 1], bb = A[i + 2];
    const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
    sat += mx > 0 ? (mx - mn) / mx : 0;
    if (r + gg + bb > 600) white++;
    mean[0] += r; mean[1] += gg; mean[2] += bb; n++;
  }
  return { sparkPx: n, meanSat: n ? +(sat / n).toFixed(3) : 0, nearWhite: white, mean: mean.map((v) => Math.round(v / Math.max(1, n))) };
}, [a, b]);
console.log(JSON.stringify({ state, ...stats, errors }));
await browser.close();
