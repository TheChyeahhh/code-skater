/**
 * src/core/debugApi.ts: the e2e debug hook contract (REQ-DEP-07, REQ-TST-02). Frozen.
 *
 * Installed by src/app/debugHook.ts ONLY when import.meta.env.DEV is true, at
 * window.__codeSkater.debug. A production build never contains it (the install call sits behind
 * an `if (import.meta.env.DEV)` branch, which Vite removes).
 *
 * Determinism: the first call to setInput() or step() switches the session to scripted mode:
 * the real-time loop pauses, device input is ignored, and the sim advances ONLY through step(n).
 * resume() returns to real time and device input. All values returned are plain JSON-safe data
 * (Playwright's page.evaluate serialises them).
 *
 * Name mapping to DESIGN REQ-DEP-07: startFreeSkate(park) = startRun(park, "free");
 * inject(script) = setInput(timeline); readBanked() = comboBanked().
 */

import type { InputTimeline, LevelId, RunMode, ScriptInput, SimSnapshot, Vec3 } from './types';

export interface CodeSkaterDebug {
  /** True once the app has booted far enough for startRun() to work (menu or run on screen). */
  readonly ready: boolean;
  /** Load a level and start a 2:00 run in the given mode, skipping menus. Resolves when the first tick is ready. */
  startRun(level: LevelId, mode: RunMode): Promise<void>;
  /**
   * Scripted input. A ScriptInput is held from the next tick until changed (a partial frame: omitted
   * fields keep their value). An InputTimeline plays from the next tick, keyframes relative to it.
   * Press/release edges come from held changes.
   */
  setInput(input: ScriptInput | InputTimeline): void;
  /** Advance exactly `ticks` sim ticks (pauses real time) and return the snapshot after the last one. */
  step(ticks: number): SimSnapshot;
  /** The latest snapshot. */
  snapshot(): SimSnapshot;
  /** Place the skater: feet at pos, heading along dir (projected on the ground plane), speed m/s along it. State becomes Grounded if a surface is under pos, else Air. */
  teleport(pos: Vec3, dir: Vec3, speed: number): void;
  /** FINAL of the most recently banked combo in this run (0 if none). */
  comboBanked(): number;
  /** Current run score. */
  runScore(): number;
  /** Mark Woodshed unlocked for this session (no save write). */
  unlockAll(): void;
  /** Leave scripted mode: real-time loop and device input again. */
  resume(): void;
}

export interface CodeSkaterGlobal {
  readonly debug: CodeSkaterDebug;
}

declare global {
  interface Window {
    /** Dev builds only (REQ-DEP-07). */
    __codeSkater?: CodeSkaterGlobal;
    /** Set true by a page when its first stable frame is on screen; scripts/shot.mjs waits for it. */
    __shotReady?: boolean;
  }
}
