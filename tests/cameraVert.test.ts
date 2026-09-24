/**
 * tests/cameraVert.test.ts (fx track): the chase camera on a REAL level after a quarter-pipe air
 * (REQ-CAM-02, REQ-CAM-05; polish round 2). The real world rolls the skater up a quarter pipe, airs and
 * re-enters; the rig runs at 60 fps with the level ray the session uses. Before the fix the heading
 * flip swung the boom into the launch ramp and the collision cut it to about 2.2 m for half a second
 * (TB-VERT at 8 m/s), then it took a second to pull back. Now the boom holds the open side until the
 * boom behind is clear, so it never comes closer than 4 m.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/tuning';
import type { Vec3 } from '../src/core/types';
import { createLevelRaycaster } from '../src/levels/lib/bvh';
import { MARKET_STREET } from '../src/levels/marketStreet';
import { TEST_BOX } from '../src/levels/testBox';
import type { BuiltLevel, LevelDef } from '../src/levels/types';
import { WOODSHED } from '../src/levels/woodshed';
import { createCameraRig } from '../src/render/camera';
import type { CameraRaycast } from '../src/render/types';
import { built, Rig, worldAvailable } from './fixtures/sim/rig';

/** Same ray as src/app/session.ts: shapes lower than INT_CAM_IGNORE_HEIGHT_M are passed through. */
function levelRay(b: BuiltLevel): CameraRaycast {
  const ray = createLevelRaycaster(b.collider);
  return (origin, dir, maxDist) => {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    let travelled = 0;
    let o = origin;
    for (let pass = 0; pass < TUNING.INT_CAM_RAY_PASSES; pass++) {
      const hit = ray.raycast(o, d, maxDist - travelled);
      if (!hit) return null;
      const s = b.surfaces[hit.surfaceId];
      const tall = !s || s.bounds.max.y - s.bounds.min.y >= TUNING.INT_CAM_IGNORE_HEIGHT_M;
      if (tall) return travelled + hit.distance;
      const step = hit.distance + 0.02;
      travelled += step;
      if (travelled >= maxDist) return null;
      o = { x: o.x + d.x * step, y: o.y + d.y * step, z: o.z + d.z * step };
    }
    return null;
  };
}

interface QpLike {
  readonly kind: string;
  readonly id: string;
  readonly facing: 'north' | 'south' | 'east' | 'west';
  readonly footLine: number;
  readonly span: readonly [number, number];
  readonly baseY?: number;
}

const FACING: Record<QpLike['facing'], Vec3> = {
  north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 }, east: { x: 1, y: 0, z: 0 }, west: { x: -1, y: 0, z: 0 },
};

interface Probe {
  /** Closest camera to torso distance from the re-entry until 1.5 s later, metres. */
  readonly minDist: number;
  /** Seconds of that window with the camera under 3 m. */
  readonly under3S: number;
  /** The skater really went up, aired and came back down. */
  readonly reentered: boolean;
}

/** Roll at `speed` from `runUp` metres before the foot of quarter pipe `id`, straight at it. */
function probe(def: LevelDef, id: string, speed: number, runUp: number): Probe {
  const b = built(def);
  const qp = def.primitives.find((p) => p.id === id) as unknown as QpLike;
  const f = FACING[qp.facing];
  const mid = (qp.span[0] + qp.span[1]) / 2;
  const y = qp.baseY ?? 0;
  const foot: Vec3 = f.z !== 0 ? { x: mid, y, z: qp.footLine } : { x: qp.footLine, y, z: mid };
  const start: Vec3 = { x: foot.x + f.x * runUp, y, z: foot.z + f.z * runUp };
  const r = new Rig({ level: b });
  r.teleport(start, { x: -f.x, y: 0, z: -f.z }, speed);
  const rig = createCameraRig(levelRay(b));
  rig.snapTo(r.snap);
  const look = { stick: { x: 0, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } };
  const frameTicks = Math.round(TUNING.SIM_HZ / 60);
  let sawAir = false;
  let reentryFrame = -1;
  let minDist = Infinity;
  let under3 = 0;
  for (let frame = 0; frame < 60 * 6; frame++) {
    r.hold(frameTicks, {});
    for (const e of r.events.splice(0)) rig.onEvent(e);
    rig.update(r.snap, look, 1 / 60);
    const k = r.snap.skater;
    if (r.snap.camera.vertAir) sawAir = true;
    if (sawAir && reentryFrame < 0 && !r.snap.camera.vertAir) reentryFrame = frame;
    if (reentryFrame < 0) continue;
    if (frame - reentryFrame > 90) break;
    const c = rig.camera.position;
    const d = Math.hypot(c.x - k.pos.x, c.y - (k.pos.y + 1), c.z - k.pos.z);
    minDist = Math.min(minDist, d);
    if (d < 3) under3 += 1 / 60;
  }
  return { minDist, under3S: under3, reentered: reentryFrame >= 0 };
}

const ready = worldAvailable();

describe.skipIf(!ready)('REQ-CAM-02 / REQ-CAM-05 quarter-pipe re-entry on real levels', () => {
  it('TB-VERT at 8 m/s: the rollout keeps the camera at least 4 m from the skater', () => {
    const p = probe(TEST_BOX, 'TB-VERT', 8, 14);
    expect(p.reentered).toBe(true);
    expect(p.minDist).toBeGreaterThanOrEqual(4);
    expect(p.under3S).toBe(0);
  });

  it.each([
    ['MS-Q1', MARKET_STREET], ['MS-Q4', MARKET_STREET], ['MS-Q5', MARKET_STREET], ['WS-QW1', WOODSHED], ['WS-QE1', WOODSHED],
  ] as const)('%s at 10 m/s from 8 m out never pulls the camera in under 4 m', (id, def) => {
    const p = probe(def, id, 10, 8);
    expect(p.reentered).toBe(true);
    expect(p.minDist).toBeGreaterThanOrEqual(4);
  });
});
