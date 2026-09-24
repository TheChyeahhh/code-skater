/**
 * src/app/debugHook.ts (integration): installs window.__codeSkater.debug (REQ-DEP-07, REQ-TST-02).
 * Imported only behind `if (import.meta.env.DEV)` with a dynamic import, so production bundles never
 * contain it. It forwards to the app (startRun, unlockAll, ready) and to the running session's
 * scripted driver (src/sim/debug.ts through src/app/session.ts): the first setInput() or step()
 * pauses real time and device input, and the sim then advances only through step(n).
 */

import type { CodeSkaterDebug } from '../core/debugApi';
import type { LevelId, RunMode } from '../core/types';
import type { GameSession } from './session';

/** What the hook needs from the app (src/app/boot.ts). */
export interface DebugHost {
  readonly ready: boolean;
  startRun(level: LevelId, mode: RunMode): Promise<void>;
  session(): GameSession | null;
  unlockAll(): void;
}

export function installDebugHook(api: CodeSkaterDebug): void {
  window.__codeSkater = { debug: api };
}

export function createDebugApi(host: DebugHost): CodeSkaterDebug {
  const live = (): GameSession => {
    const s = host.session();
    if (!s) throw new Error('code skater debug: no run in progress (call startRun first)');
    return s;
  };
  return {
    get ready() {
      return host.ready;
    },
    startRun: (level, mode) => host.startRun(level, mode),
    setInput: (input) => live().debug.setInput(input),
    step: (ticks) => live().debug.step(ticks),
    snapshot: () => live().snapshot,
    teleport: (pos, dir, speed) => live().debug.teleport(pos, dir, speed),
    comboBanked: () => live().debug.comboBanked(),
    runScore: () => live().debug.runScore(),
    unlockAll: () => host.unlockAll(),
    resume: () => live().debug.resume(),
  };
}
