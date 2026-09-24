// dev/fx/vertShot.mjs (fx track): the real game rolling at a quarter pipe, airing and re-entering,
// driven through window.__codeSkater.debug at 2 ticks per frame; saves a contact strip of frames from
// the re-entry on so the chase camera's rollout framing can be looked at (REQ-CAM-02 / REQ-CAM-05).
//   node dev/fx/vertShot.mjs <baseUrl> <outDir> [level x z dirX dirZ speed] [--gpu]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const gpu = argv.includes('--gpu');
const pos = argv.filter((a) => a !== '--gpu');
const [base, outDir] = pos;
const level = pos[2] ?? 'marketStreet';
const [x, z, dx, dz, speed] = (pos.length > 3 ? pos.slice(3, 8) : ['46', '107.3', '0', '1', '10']).map(Number);
const args = gpu ? ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.mouse.click(480, 270);
await page.mouse.move(2, 2);
await page.waitForFunction(() => window.__codeSkater?.debug?.ready === true, null, { timeout: 90000 });
await page.evaluate(async ([level, x, z, dx, dz, speed]) => {
  const d = window.__codeSkater.debug;
  await d.startRun(level, 'free');
  d.teleport({ x, y: 0, z }, { x: dx, y: 0, z: dz }, speed);
  d.setInput({ held: {}, dpad: 'N' });
  window.__vert = { sawAir: false, reentry: -1, f: 0 };
}, [level, x, z, dx, dz, speed]);
const shots = [];
for (let f = 0; f < 400; f++) {
  const st = await page.evaluate(async () => {
    const d = window.__codeSkater.debug;
    const v = window.__vert;
    d.step(2);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const s = d.snapshot();
    if (s.camera.vertAir) v.sawAir = true;
    if (v.sawAir && v.reentry < 0 && !s.camera.vertAir) v.reentry = v.f;
    v.f++;
    return { rel: v.reentry < 0 ? -1 : v.f - 1 - v.reentry, state: s.skater.state };
  });
  if (st.rel >= 0 && st.rel % 6 === 0) {
    const p = `${outDir}/vert-${String(st.rel).padStart(3, '0')}.png`;
    await page.screenshot({ path: p });
    shots.push(p);
  }
  if (st.rel > 72) break;
}
console.log(JSON.stringify({ shots: shots.length }));
await browser.close();
