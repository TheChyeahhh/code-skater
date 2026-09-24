// e2e/static.spec.ts (integration): REQ-DEP-01 / REQ-DEP-06 and the SPEC §19 gate item "npm run build
// output doesn't run from a static host, or console has errors on load". The production build is
// served from a SUBPATH (/games/code-skater/) by `vite preview` (playwright.config.ts, project
// "static"); the test passes the gate, reaches the main menu, starts Free Skate by keyboard only
// (ArrowDown, Enter, Enter) and asserts the run is on screen with no console error, page error, lost
// WebGL context or THREE.* warning, and that the production build exposes no debug hook.
import { expect, test } from '@playwright/test';

test('the production build boots from a static subpath and starts Free Skate by keyboard with a clean console', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    else if (/CONTEXT_LOST/i.test(msg.text())) errors.push(`webgl: ${msg.text()}`);
    else if (msg.type() === 'warning' && /^THREE\./.test(msg.text())) errors.push(`three: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`page: ${err.message}`));
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('./');
  await expect(page.getByText('Press any button to start')).toBeVisible();
  await page.mouse.click(640, 360);
  await page.mouse.move(2, 2);
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible({ timeout: 30_000 });
  // Main menu: Career, Free Skate, Board Lab. Free Skate -> park select (Market Street first).
  // Menu nav edges are per render frame: a few frames between taps (as in smoke.spec.ts), and the
  // backdrop settled first so SwiftShader's slow first frames cannot merge two taps into one frame.
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60_000 });
  const frames = (n: number): Promise<void> =>
    page.evaluate((k) => new Promise<void>((resolve) => {
      let left = k;
      const f = (): void => {
        left -= 1;
        if (left <= 0) resolve();
        else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }), n);
  const press = async (key: string): Promise<void> => {
    await page.keyboard.press(key);
    await frames(3);
  };
  await press('ArrowDown');
  await press('Enter');
  await expect(page.locator('.screen--parkSelect.is-active')).toBeVisible();
  await press('Enter');
  await expect(page.locator('.is-run')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hud')).toBeVisible();
  // A few seconds of the live run (the game chunk, a park chunk and the vendor chunk all loaded).
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => typeof window.__codeSkater)).toBe('undefined');
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
