/**
 * dev/shared/mockDrive.ts (integration): runs the mock snapshot (src/core/mock.ts) through the real
 * FixedLoop at 120 Hz and interpolates with lerpSnapshot, exactly as the game will drive views.
 * Harnesses call advance(dtS) once per render frame and read the events of the ticks it ran.
 */

import type { SimEvent } from '../../src/core/events';
import { lerpSnapshot } from '../../src/core/interp';
import { FixedLoop } from '../../src/core/loop';
import { mockEventsAt, mockSnapshotAt } from '../../src/core/mock';
import { TUNING } from '../../src/core/tuning';
import type { SimSnapshot } from '../../src/core/types';

export interface MockDrive {
  /** Advance real time; returns the interpolated snapshot for this render frame. */
  advance(dtS: number): SimSnapshot;
  /** Events produced by the ticks of the last advance(), in order. */
  readonly events: readonly SimEvent[];
}

/**
 * startS: where in the loop to begin. freezePose: hold still at the first tick showing that pose
 * (for pose screenshots), or null to run.
 */
export function createMockDrive(startS = 0, freezePose: string | null = null): MockDrive {
  let tick0 = Math.max(0, Math.round(startS * TUNING.SIM_HZ));
  if (freezePose) {
    for (let t = tick0; t < tick0 + 8 * TUNING.SIM_HZ; t++) {
      if (mockSnapshotAt(t).skater.pose === freezePose) {
        tick0 = t;
        break;
      }
    }
  }
  let prev = mockSnapshotAt(tick0);
  let curr = prev;
  let events: SimEvent[] = [];
  const loop = new FixedLoop({
    onTick: (t) => {
      prev = curr;
      curr = mockSnapshotAt(tick0 + t + 1);
      events.push(...mockEventsAt(tick0 + t + 1));
    },
  });
  return {
    advance(dtS) {
      events = [];
      if (freezePose) return curr;
      loop.frame(dtS);
      return lerpSnapshot(prev, curr, loop.alpha);
    },
    get events() {
      return events;
    },
  };
}
