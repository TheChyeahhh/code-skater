// dev/audio/verify.mjs (audio track): open dev/audio.html?verify in headless Chromium, wait for the
// offline render check, print one line per render (RMS, peak, NaN) and exit 1 if any render is silent
// or has NaN samples. Needs the harness server: npx vite --port 5311 --strictPort
//
//   node dev/audio/verify.mjs [url]
import process from 'node:process';
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:5311/dev/audio.html?verify';

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let code = 0;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__audioReport !== undefined, null, { timeout: 180000, polling: 250 });
  const report = await page.evaluate(() => window.__audioReport);
  for (const r of report.rows) {
    const name = `${r.group.padEnd(7)} ${r.name}`.padEnd(52);
    console.log(`${name} rms ${r.rms.toFixed(4)}  peak ${r.peak.toFixed(3)}  nan ${r.nan}  ${r.renderMs ? `${Math.round(r.renderMs)} ms` : ''}  ${r.ok ? 'ok' : 'FAIL'}`);
  }
  console.log(`verify: ${report.rows.length} renders, ${report.failed} failed, ${errors.length} console/page errors`);
  for (const e of errors) console.error(`error: ${e}`);
  if (report.failed > 0 || errors.length > 0) code = 1;
} catch (err) {
  console.error(`verify: ${err.message}`);
  code = 2;
} finally {
  await browser.close();
}
process.exit(code);
