import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke and screenshot tests (REQ-TST-02). WebGL runs headless through SwiftShader.
 * Browser: Playwright's bundled Chromium ("npx playwright install chromium" works on this
 * machine). If that download is ever unavailable, set PW_CHANNEL=chrome to use the
 * installed Google Chrome instead.
 * GL flags: SPEC §13 names "--use-gl=swiftshader"; on Chromium 153 that flag loses the WebGL
 * context about a second after creation (measured at M0: black screenshots), so SwiftShader is
 * selected through ANGLE ("--use-gl=angle --use-angle=swiftshader"), same software renderer, stable.
 * Screenshots are written to screenshots/ by the specs themselves (see e2e/smoke.spec.ts).
 *
 * Projects: "dev" runs e2e/smoke.spec.ts against the dev server (the debug hook exists there);
 * "static" runs e2e/static.spec.ts against the PRODUCTION build served from a subpath by
 * `vite preview` (REQ-DEP-01 / REQ-DEP-06): it builds into test-results/static-dist first.
 */
const STATIC_BASE = '/games/code-skater/';
const STATIC_PORT = 5174;
const channel = process.env.PW_CHANNEL;
const SWIFTSHADER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/**
 * PW_GPU=1 (local only, render request): hardware ANGLE instead of SwiftShader, so the same specs
 * (which fail on any THREE.* warning) also catch the warnings only a real GPU driver prints, such
 * as HLSL compile warnings. Use it with a full browser channel (the headless shell has no GPU):
 * PW_GPU=1 PW_CHANNEL=chromium npx playwright test (or PW_CHANNEL=chrome for the installed Chrome).
 */
const HARDWARE_ARGS = ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'];
const GL_ARGS = process.env.PW_GPU === '1' ? HARDWARE_ARGS : SWIFTSHADER_ARGS;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  projects: [
    { name: 'dev', testMatch: /smoke\.spec\.ts/, use: { baseURL: 'http://localhost:5173' } },
    { name: 'static', testMatch: /static\.spec\.ts/, use: { baseURL: `http://localhost:${STATIC_PORT}${STATIC_BASE}` } },
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    ...(channel ? { channel } : {}),
    launchOptions: {
      args: GL_ARGS,
    },
  },
  webServer: [
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The real artifact (base "./"), served under a subpath it was never told about.
      command: `npx vite build --outDir test-results/static-dist --emptyOutDir && npx vite preview --base ${STATIC_BASE} --outDir test-results/static-dist --port ${STATIC_PORT} --strictPort`,
      url: `http://localhost:${STATIC_PORT}${STATIC_BASE}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
