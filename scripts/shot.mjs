// scripts/shot.mjs (integration): screenshot any page of the dev server.
//
//   node scripts/shot.mjs <url> <out.png> [--wait ms] [--size WxH] [--gpu]
//
// Launches Chromium through Playwright. Default GL: SwiftShader (software, works headless everywhere)
// selected as ANGLE's SwiftShader backend: measured on Chromium 153, the older "--use-gl=swiftshader"
// flag LOSES the WebGL context about a second after creation (black screenshots), while
// "--use-gl=angle --use-angle=swiftshader" stays up. --gpu: hardware GL through ANGLE in Chromium's
// new headless mode (falls back to SwiftShader if the launch fails). Waits until
// window.__shotReady === true or --wait ms (default 15000) pass, saves the PNG, prints every console
// error, page error and WebGL context loss, and exits nonzero on page errors or a lost context (or when
// the page cannot load). PW_CHANNEL=chrome uses the installed Google Chrome instead of Playwright's build.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

function parseArgs(argv) {
  const positional = [];
  const opts = { wait: 15000, width: 1280, height: 720, gpu: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '--size') {
      const m = String(argv[++i] ?? '').match(/^(\d+)x(\d+)$/i);
      if (!m) throw new Error('--size expects WxH, for example 1280x720');
      opts.width = Number(m[1]);
      opts.height = Number(m[2]);
    } else if (a === '--gpu') opts.gpu = true;
    else positional.push(a);
  }
  if (positional.length < 2 || !Number.isFinite(opts.wait)) {
    throw new Error('usage: node scripts/shot.mjs <url> <out.png> [--wait ms] [--size WxH] [--gpu]');
  }
  return { url: positional[0], out: resolve(positional[1]), ...opts };
}

const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const HARDWARE = ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];

async function launch(gpu) {
  const channel = process.env.PW_CHANNEL || (gpu ? 'chromium' : undefined);
  const args = gpu ? HARDWARE : SWIFTSHADER;
  try {
    return { browser: await chromium.launch({ headless: true, args, ...(channel ? { channel } : {}) }), mode: gpu ? 'gpu' : 'swiftshader' };
  } catch (err) {
    if (!gpu) throw err;
    console.warn(`shot: GPU launch failed (${err.message.split('\n')[0]}); falling back to SwiftShader.`);
    return { browser: await chromium.launch({ headless: true, args: SWIFTSHADER }), mode: 'swiftshader (fallback)' };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { browser, mode } = await launch(opts.gpu);
  const consoleErrors = [];
  const pageErrors = [];
  let exitCode = 0;
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      else if (/CONTEXT_LOST/i.test(msg.text())) pageErrors.push(`WebGL context lost: ${msg.text()}`);
    });
    page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));
    const started = Date.now();
    await page.goto(opts.url, { waitUntil: 'load', timeout: Math.max(opts.wait, 10000) });
    let ready = false;
    try {
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: opts.wait, polling: 100 });
      ready = true;
    } catch {
      ready = false;
    }
    const renderer = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'no WebGL';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    });
    mkdirSync(dirname(opts.out), { recursive: true });
    await page.screenshot({ path: opts.out });
    const ms = Date.now() - started;
    console.log(`shot: ${opts.url} -> ${opts.out} (${opts.width}x${opts.height}, ${mode}, GL "${renderer}", ${ready ? '__shotReady' : `no __shotReady after ${opts.wait} ms`}, ${ms} ms)`);
  } catch (err) {
    console.error(`shot: FAILED to capture ${opts.url}: ${err.message}`);
    exitCode = 2;
  } finally {
    await browser.close();
  }
  for (const e of consoleErrors) console.error(`console error: ${e}`);
  for (const e of pageErrors) console.error(`page error: ${e}`);
  console.log(`shot: ${consoleErrors.length} console error(s), ${pageErrors.length} page error(s)`);
  if (pageErrors.length > 0 && exitCode === 0) exitCode = 1;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`shot: ${err.message}`);
  process.exit(2);
});
