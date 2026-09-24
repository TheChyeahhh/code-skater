// e2e/smoke.spec.ts (integration): SPEC §13 / REQ-TST-02 smoke test on the dev server, WebGL through
// SwiftShader (playwright.config.ts). Boots through the start gate to the main menu with no console
// errors; starts Free Skate on both parks through window.__codeSkater.debug (dev builds only); scripts
// an ollie onto a known rail, holds the grind over 2 s, lands and asserts the combo banked > 0; and
// captures screenshots/menu.png, street-spawn.png, street-grind.png, woodshed-bowl.png, board-lab.png.
// Any console error, page error, lost WebGL context or THREE.* warning fails the test.
import { devices, expect, test, type Page } from '@playwright/test';
import type { Vec3 } from '../src/core/types';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    else if (/CONTEXT_LOST/i.test(msg.text())) errors.push(`webgl: ${msg.text()}`);
    // three.js deprecation / misuse warnings count too (M0 caught PCFSoftShadowMap this way).
    else if (msg.type() === 'warning' && /^THREE\./.test(msg.text())) errors.push(`three: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`page: ${err.message}`));
  return errors;
}

/** Let the rAF loop draw the latest sim state (SwiftShader frames are slow, so wait in frames, not ms). */
async function settle(page: Page, frames = 12): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const f = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    frames,
  );
}

/** One key tap, then a few frames so the next tap lands in a later render frame (nav edges are per frame). */
async function tap(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await settle(page, 3);
  }
}

async function bootToMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Press any button to start')).toBeVisible();
  await expect(page).toHaveTitle('Code Skater');
  await page.mouse.click(640, 360);
  // Park the pointer in a corner: menus focus the item under a hovering mouse, which would steal the
  // keyboard focus the nav steps below expect.
  await page.mouse.move(2, 2);
  await expect(page.locator('.start-gate')).toHaveCount(0);
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible();
  await page.waitForFunction(() => window.__shotReady === true && window.__codeSkater?.debug.ready === true, null, { timeout: 45_000 });
}

/** A known rail: where it starts, which way it runs, the floor height beside it. */
interface KnownRail {
  readonly start: Vec3;
  readonly dir: Vec3;
  readonly floorY: number;
  readonly speed: number;
  /** Teleport distance behind the rail start (default 3.5 m). */
  readonly back?: number;
}

/** Market Street MS-L3 "Terrace Ledge": (56, 39.6) -> (80, 39.6) at y 1.2 on the 0.8 m terrace. */
const STREET_LEDGE: KnownRail = { start: { x: 56, y: 1.2, z: 39.6 }, dir: { x: 1, y: 0, z: 0 }, floorY: 0.8, speed: 7 };
/** Woodshed WS-RA "Long Bar": (8, 38) -> (24, 38) at y 0.55 on the floor. */
// Auto-push (DESIGN L CR-65) accelerates the approach, so this 16 m bar starts slow and close enough
// that the grind speed (about 7 m/s) still leaves more than 2 s on it.
const WOODSHED_BAR: KnownRail = { start: { x: 8, y: 0.55, z: 38 }, dir: { x: 1, y: 0, z: 0 }, floorY: 0, speed: 3, back: 1.5 };

interface GrindProgress {
  readonly phase: 'approach' | 'air' | 'grind' | 'after';
  readonly grindTicks: number;
  readonly state: string;
  readonly banked: number;
  readonly ticks: number;
}

/**
 * Teleport behind the rail, roll at it, tap Cross (ollie) just before its start, press Triangle in the
 * air (grind pre-buffer), balance against the needle while grinding (REQ-BAL-03: stick against the
 * lean), then ride off the rail end, land and let the LandWindow bank the combo. Runs inside the page
 * tick by tick through the debug hook; stops after `stopAfterGrindTicks` ticks of grinding (for the
 * mid-grind screenshot) or when the combo banked.
 */
async function scriptGrind(page: Page, rail: KnownRail, stopAfterGrindTicks: number | null, fresh: boolean): Promise<GrindProgress> {
  return page.evaluate(
    ({ rail, stopAfterGrindTicks, fresh }) => {
      const d = window.__codeSkater!.debug;
      const w = window as unknown as { __grindScript?: { phase: string; grindTicks: number; ticks: number; popTick: number } };
      if (fresh) {
        const back = rail.back ?? 3.5;
        d.teleport({ x: rail.start.x - rail.dir.x * back, y: rail.floorY, z: rail.start.z - rail.dir.z * back }, rail.dir, rail.speed);
        d.setInput({ held: { ollie: false, grind: false, flip: false, grab: false }, dpad: 'N', stick: { x: 0, y: 0 } });
        d.step(1);
        w.__grindScript = { phase: 'approach', grindTicks: 0, ticks: 0, popTick: -1 };
      }
      const st = w.__grindScript!;
      const MAX_TICKS = 1500;
      while (st.ticks < MAX_TICKS) {
        const s = d.snapshot();
        const along = (s.skater.pos.x - rail.start.x) * rail.dir.x + (s.skater.pos.z - rail.start.z) * rail.dir.z;
        let held = { ollie: false, grind: false };
        let dpad: 'N' | 'L' | 'R' = 'N';
        if (st.phase === 'approach') {
          if (along > -1.2) {
            held = { ollie: true, grind: false };
            if (st.popTick < 0) st.popTick = st.ticks;
            if (st.ticks - st.popTick >= 2) st.phase = 'air';
          }
        } else if (st.phase === 'air') {
          // Release Cross (pop), then pulse Triangle every other tick so each press is a fresh edge.
          held = { ollie: false, grind: st.ticks % 2 === 0 };
          if (s.skater.state === 'Grind') st.phase = 'grind';
        } else if (st.phase === 'grind') {
          if (s.skater.state === 'Grind') {
            st.grindTicks += 1;
            const b = s.balance;
            if (b && b.axis === 'h') dpad = b.needle > 0 ? 'L' : 'R';
          } else {
            st.phase = 'after';
          }
        }
        if (st.phase === 'after' && d.comboBanked() > 0) break;
        if (stopAfterGrindTicks !== null && st.grindTicks >= stopAfterGrindTicks) break;
        if (s.skater.state === 'Bail') break;
        d.setInput({ held, dpad });
        d.step(1);
        st.ticks += 1;
      }
      const s = d.snapshot();
      return { phase: st.phase as GrindProgress['phase'], grindTicks: st.grindTicks, state: s.skater.state, banked: d.comboBanked(), ticks: st.ticks };
    },
    { rail, stopAfterGrindTicks, fresh },
  );
}

test('boots to the menu, grinds a known rail on both parks, captures the screenshots', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await bootToMenu(page);
  await settle(page, 20);
  await page.screenshot({ path: 'screenshots/menu.png' });

  // --- Market Street, Free Skate ------------------------------------------------------------------
  await page.evaluate(async () => {
    const d = window.__codeSkater!.debug;
    d.unlockAll();
    await d.startRun('marketStreet', 'free');
  });
  await expect(page.locator('.hud')).toBeVisible();
  const spawn = await page.evaluate(() => {
    const d = window.__codeSkater!.debug;
    const s = d.step(2);
    return { state: s.skater.state, level: s.levelId, mode: s.run.mode };
  });
  expect(spawn).toEqual({ state: 'Grounded', level: 'marketStreet', mode: 'free' });
  await settle(page, 20);
  await page.screenshot({ path: 'screenshots/street-spawn.png' });

  const mid = await scriptGrind(page, STREET_LEDGE, 120, true);
  expect(mid.state, JSON.stringify(mid)).toBe('Grind');
  await settle(page, 16);
  await page.screenshot({ path: 'screenshots/street-grind.png' });
  const street = await scriptGrind(page, STREET_LEDGE, null, false);
  expect(street.grindTicks, JSON.stringify(street)).toBeGreaterThanOrEqual(240); // 2 s at 120 Hz
  expect(street.banked, JSON.stringify(street)).toBeGreaterThan(0);

  // --- Woodshed, Free Skate -------------------------------------------------------------------------
  await page.evaluate(async () => {
    await window.__codeSkater!.debug.startRun('woodshed', 'free');
  });
  const shed = await scriptGrind(page, WOODSHED_BAR, null, true);
  expect(shed.grindTicks, JSON.stringify(shed)).toBeGreaterThanOrEqual(240);
  expect(shed.banked, JSON.stringify(shed)).toBeGreaterThan(0);

  // The west bowl WS-BW1 (x 4..24, z 6..26, 2.4 m deep): roll across its floor toward the east wall.
  await page.evaluate(() => {
    const d = window.__codeSkater!.debug;
    d.setInput({ held: { ollie: false, grind: false }, dpad: 'N' });
    d.teleport({ x: 11, y: -2.4, z: 16 }, { x: 1, y: 0, z: 0.25 }, 5);
    d.step(30);
  });
  await settle(page, 20);
  await page.screenshot({ path: 'screenshots/woodshed-bowl.png' });

  // --- Board Lab through the menus (keyboard mirrors the pad: arrows + Enter) ------------------------
  await page.evaluate(() => window.__codeSkater!.debug.resume());
  await tap(page, 'Escape');
  await expect(page.locator('.screen--pause.is-active')).toBeVisible();
  // Pause: Resume, Restart run, Options, Quit to menu.
  await tap(page, 'ArrowDown', 3);
  await tap(page, 'Enter');
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible();
  // Main menu: Career, Free Skate, Board Lab.
  await tap(page, 'ArrowDown', 2);
  await tap(page, 'Enter');
  await expect(page.locator('.screen--boardLab.is-active')).toBeVisible();
  await settle(page, 30);
  await page.screenshot({ path: 'screenshots/board-lab.png' });

  expect(errors).toEqual([]);
});

/**
 * Career loop (SPEC §16 M8 "full loop from title to Lab Circuit stamp"): a career run on each park in
 * which the skater is placed on that park's MacGuffin (collected by the real sim trigger), the 2:00
 * clock runs out through the debug hook, the results card appears, the save holds the MacGuffin, and
 * after the second park the main menu shows the Lab Circuit stamp.
 */
async function careerRunWithMacGuffin(page: Page, level: 'marketStreet' | 'woodshed', at: Vec3): Promise<{ collected: boolean; ended: boolean }> {
  return page.evaluate(
    async ({ level, at }) => {
      const d = window.__codeSkater!.debug;
      await d.startRun(level, 'career');
      d.setInput({ held: { ollie: false, grind: false }, dpad: 'N' });
      // Feet 0.9 m (COLLECT_POINT_UP_M) under the prop: the collect point sits inside its sphere.
      d.teleport({ x: at.x, y: at.y - 0.9, z: at.z }, { x: 0, y: 0, z: -1 }, 0);
      let s = d.step(2);
      const collected = s.run.macguffinCollected;
      for (let i = 0; i < 40 && s.skater.state !== 'RunEnd'; i++) s = d.step(480);
      return { collected, ended: s.skater.state === 'RunEnd' };
    },
    { level, at },
  );
}

/**
 * The Woodshed drive "needs speed + transfer" (SPEC §9.2, MacGuffinDef.needs): roll at the spine at
 * 11 m/s and press R2 in the air over it (the spine transfer); the transfer air collects the Drive.
 */
async function careerRunWithDrive(page: Page): Promise<{ collected: boolean; ended: boolean }> {
  return page.evaluate(async () => {
    const d = window.__codeSkater!.debug;
    await d.startRun('woodshed', 'career');
    const idle = { held: { ollie: false, grind: false, revert: false }, dpad: 'N' as const };
    d.setInput(idle);
    d.teleport({ x: 36, y: 0, z: 28 }, { x: 1, y: 0, z: 0 }, 11);
    let s = d.step(1);
    for (let i = 0; i < 200 && s.skater.state !== 'Air'; i++) s = d.step(1);
    d.setInput({ ...idle, held: { ...idle.held, revert: true } });
    s = d.step(1);
    d.setInput(idle);
    for (let i = 0; i < 60 && !s.run.macguffinCollected; i++) s = d.step(1);
    const collected = s.run.macguffinCollected;
    for (let i = 0; i < 40 && s.skater.state !== 'RunEnd'; i++) s = d.step(480);
    return { collected, ended: s.skater.state === 'RunEnd' };
  });
}

test('career loop: MacGuffin, run end, results, save, Lab Circuit stamp', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await bootToMenu(page);
  await page.evaluate(() => localStorage.clear());
  await expect(page.locator('.stamp.is-visible')).toHaveCount(0);

  const street = await careerRunWithMacGuffin(page, 'marketStreet', { x: 104.8, y: 7.2, z: 80 });
  expect(street).toEqual({ collected: true, ended: true });
  await expect(page.locator('.screen--results.is-active')).toBeVisible({ timeout: 30_000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('codeSkater.v1') ?? '{}') as { career?: { macguffins?: string[] } });
  expect(saved.career?.macguffins).toEqual(['secret_laptop']);
  await tap(page, 'Escape'); // results: back = Main menu
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible();
  await expect(page.locator('.stamp.is-visible')).toHaveCount(0);

  const shed = await careerRunWithDrive(page);
  expect(shed).toEqual({ collected: true, ended: true });
  await expect(page.locator('.screen--results.is-active')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.results__unlock', { hasText: 'Lab Circuit stamp' })).toBeVisible();
  await settle(page, 8);
  await page.screenshot({ path: 'screenshots/results-lab-circuit.png' });
  await tap(page, 'Escape');
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible();
  await expect(page.locator('.stamp.is-visible')).toBeVisible();
  await settle(page, 12);
  await page.screenshot({ path: 'screenshots/menu-stamp.png' });

  // The stamp survives a reload: it comes from the save, not from this session.
  await page.reload();
  await page.mouse.click(640, 360);
  await page.mouse.move(2, 2);
  await expect(page.locator('.screen--mainMenu.is-active .stamp.is-visible, .stamp.is-visible').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => localStorage.clear());
  expect(errors).toEqual([]);
});

/**
 * Polish round 2: a career run left before 0:00 keeps what it earned. The Laptop picked up in a career
 * run, then Pause > Quit to menu: the save holds the MacGuffin and its goal, as Free Skate does.
 */
test('career quit to menu keeps the MacGuffin and its goal', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await bootToMenu(page);
  await page.evaluate(() => localStorage.clear());
  const collected = await page.evaluate(async () => {
    const d = window.__codeSkater!.debug;
    await d.startRun('marketStreet', 'career');
    d.setInput({ held: { ollie: false, grind: false }, dpad: 'N' });
    d.teleport({ x: 104.8, y: 7.2 - 0.9, z: 80 }, { x: 0, y: 0, z: -1 }, 0);
    const s = d.step(2);
    return { collected: s.run.macguffinCollected, ended: s.run.ended };
  });
  expect(collected).toEqual({ collected: true, ended: false });
  await page.evaluate(() => window.__codeSkater!.debug.resume());
  await tap(page, 'Escape');
  await expect(page.locator('.screen--pause.is-active')).toBeVisible();
  // Pause: Resume, Restart run, Options, Quit to menu.
  await tap(page, 'ArrowDown', 3);
  await tap(page, 'Enter');
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('codeSkater.v1') ?? '{}') as { career?: { macguffins?: string[]; goals?: { marketStreet?: string[] } } });
  expect(saved.career?.macguffins).toEqual(['secret_laptop']);
  expect(saved.career?.goals?.marketStreet).toContain('MS-GOAL-06');
  await page.evaluate(() => localStorage.clear());
  expect(errors).toEqual([]);
});

test('a gamepad unplugged mid-run pauses with "Controller disconnected" (REQ-INP-08, REQ-DEP-05)', async ({ page }) => {
  const errors = collectErrors(page);
  // A fake standard-mapping Xbox pad behind navigator.getGamepads (the input system polls it each frame).
  await page.addInitScript(() => {
    const w = window as unknown as { __padOn: boolean; __pad: unknown };
    w.__padOn = true;
    w.__pad = {
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0],
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [w.__padOn ? w.__pad : null] });
  });
  await bootToMenu(page);
  await page.evaluate(async () => {
    await window.__codeSkater!.debug.startRun('marketStreet', 'career');
    window.__codeSkater!.debug.resume(); // real time, device input
  });
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('.hud__clock')).toHaveText(/^[12]:\d\d$/);
  await page.evaluate(() => {
    (window as unknown as { __padOn: boolean }).__padOn = false;
  });
  await expect(page.locator('.overlay--lost.is-visible')).toBeVisible();
  await expect(page.locator('.screen--pause.is-active')).toBeVisible();
  const paused = await page.evaluate(() => window.__codeSkater!.debug.snapshot().tick);
  await settle(page, 20);
  expect(await page.evaluate(() => window.__codeSkater!.debug.snapshot().tick)).toBe(paused); // the sim is frozen
  await page.evaluate(() => {
    (window as unknown as { __padOn: boolean }).__padOn = true;
  });
  await expect(page.locator('.overlay--lost.is-visible')).toHaveCount(0);
  await expect(page.locator('.screen--pause.is-active')).toBeVisible();
  expect(errors).toEqual([]);
});

test('?autostart skips the gate and still reaches the menu', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?autostart');
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 45_000 });
  await expect(page.locator('.start-gate')).toHaveCount(0);
  await expect(page.locator('.screen--mainMenu.is-active')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a phone gets the "needs a computer" notice, a desktop does not', async ({ browser, page }) => {
  await page.goto('/');
  await expect(page.getByText('Press any button to start')).toBeVisible();
  await expect(page.locator('.phone-warning')).toHaveCount(0);

  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const mobile = await phone.newPage();
  const errors = collectErrors(mobile);
  await mobile.goto('/');
  const note = mobile.locator('.phone-warning');
  await expect(note).toBeVisible();
  await expect(note).toContainText('Code Skater needs a computer.');
  // The whole message fits on screen.
  const box = await note.boundingBox();
  const width = mobile.viewportSize()?.width ?? 0;
  expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  await mobile.screenshot({ path: 'screenshots/phone-notice.png' });
  // OK closes it, and that tap does not start the game behind it.
  await note.getByRole('button', { name: 'OK' }).tap();
  await expect(note).toHaveCount(0);
  await expect(mobile.getByText('Press any button to start')).toBeVisible();
  expect(errors).toEqual([]);
  await phone.close();
});
