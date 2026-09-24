/**
 * tests/fixtures/sim/rails.ts (sim track): hand-built BuiltRails for the rail network unit tests
 * (ARCHITECTURE.md section 10: "a BuiltRail is a RailDef plus segments"), independent of the builder.
 */

import type { Vec3 } from '../../../src/core/types';
import type { BuiltRail, RailDef, RailSegment } from '../../../src/levels/types';

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function angleDeg(a: Vec3, b: Vec3): number {
  const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (len(a) * len(b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** A RailDef with its segments, arc lengths, tangents and bends (the BuiltRail contract). */
export function builtRail(def: RailDef): BuiltRail {
  const segments: RailSegment[] = [];
  let start = 0;
  const pts = def.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Vec3;
    const b = pts[i + 1] as Vec3;
    const d = sub(b, a);
    const length = len(d);
    segments.push({ a, b, length, start, tangent: { x: d.x / length, y: d.y / length, z: d.z / length }, bendToNextDeg: 0 });
    start += length;
  }
  for (let i = 0; i < segments.length; i++) {
    const next = segments[i + 1] ?? (def.closed ? segments[0] : undefined);
    const seg = segments[i] as RailSegment;
    segments[i] = { ...seg, bendToNextDeg: next ? angleDeg(seg.tangent, next.tangent) : 0 };
  }
  return { ...def, segments, length: start, closed: def.closed === true };
}

export const P = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
