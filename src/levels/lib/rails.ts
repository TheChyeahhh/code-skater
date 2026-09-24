/**
 * src/levels/lib/rails.ts (levels track): the level's rail network (REQ-LVL-02, REQ-GRD-01, SPEC §1.5).
 *
 * 1. Authored rails (LevelDef.rails) are kept exactly as written.
 * 2. Every grind line a primitive's visible geometry implies (lib/grindLines.ts) must snap:
 *    - a line whose primitive names a rail id (copingRailId, copingRailIds, peakRailId, rimRailIds)
 *      that the data does not define is EMITTED under that id, so the reference always resolves;
 *    - any other line is compared with the authored rails, and every run of it no authored rail
 *      covers within LEVELS_COVERAGE_TOL_M is EMITTED under a stable id "<primId>:<edge>" (whole
 *      line) or "<primId>:<edge>:<k>" (k-th uncovered run), e.g. "TB-FUN:edge-north".
 *    The validator still demands AUTHORED coverage for the REQ-LVL-03 classes, so a park that leans
 *    on an auto rail fails its test even though it plays.
 * 3. Each rail becomes a BuiltRail: segments with arc length, tangent and bend to the next segment.
 */

import { TUNING } from '../../core/tuning';
import type { Vec3 } from '../../core/types';
import type { BuiltRail, LevelDef, RailDef, RailSegment } from '../types';
import { autoRailId, distToRails, type GrindLine, grindLinesOf, samplePolyline } from './grindLines';

/** Extra facts about an emitted rail (the dev harness colours auto rails differently). */
export interface EmittedRail {
  readonly rail: RailDef;
  readonly primId: string;
  /** "named" = a primitive's own rail id the data left out; "auto" = an uncovered visible edge. */
  readonly reason: 'named' | 'auto';
}

/** Grind lines of every primitive, in primitive order. */
export function levelGrindLines(def: LevelDef): GrindLine[] {
  const out: GrindLine[] = [];
  for (const p of def.primitives) out.push(...grindLinesOf(p, def));
  return out;
}

function lineRail(line: GrindLine, id: string, points: readonly Vec3[]): RailDef {
  return {
    id,
    kind: line.kind,
    points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    ...(line.closed ? { closed: true } : {}),
    ...(line.tags ? { tags: line.tags } : {}),
    ...(line.transferPlane ? { transferPlane: line.transferPlane } : {}),
  };
}

/** Runs of consecutive samples farther than tol from every authored rail (each run >= 2 samples). */
function uncoveredRuns(samples: readonly Vec3[], authored: readonly RailDef[], tol: number): Vec3[][] {
  const runs: Vec3[][] = [];
  let cur: Vec3[] = [];
  for (const s of samples) {
    if (distToRails(s, authored) > tol) cur.push(s);
    else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** Drop interior samples that lie on the straight line between their neighbours (keeps kinks). */
function simplify(pts: readonly Vec3[]): Vec3[] {
  if (pts.length <= 2) return [...pts];
  const out: Vec3[] = [pts[0] as Vec3];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = out[out.length - 1] as Vec3, b = pts[i] as Vec3, c = pts[i + 1] as Vec3;
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
    const cr = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    if (lu * lv === 0 || cr / (lu * lv) > 1e-4) out.push(b);
  }
  out.push(pts[pts.length - 1] as Vec3);
  return out;
}

/** Rails the builder adds to the authored ones (see the file header). */
export function emittedRails(def: LevelDef): EmittedRail[] {
  const authored = def.rails;
  const ids = new Set(authored.map((r) => r.id));
  const out: EmittedRail[] = [];
  const tol = TUNING.LEVELS_COVERAGE_TOL_M;
  for (const line of levelGrindLines(def)) {
    if (line.railId !== undefined) {
      if (!ids.has(line.railId)) {
        ids.add(line.railId);
        out.push({ rail: lineRail(line, line.railId, line.points), primId: line.primId, reason: 'named' });
      }
      continue;
    }
    const samples = samplePolyline(line.points, TUNING.LEVELS_AUTO_RAIL_SAMPLE_M);
    const runs = uncoveredRuns(samples, authored, tol);
    if (runs.length === 0) continue;
    // Whole line when everything but its very ends is uncovered: a neighbour's rail touching a
    // shared corner (a box's other edges) does not split an otherwise bare edge.
    const a = line.points[0] as Vec3, b = line.points[line.points.length - 1] as Vec3;
    const nearEnd = (q: Vec3): boolean => !line.closed && Math.min(Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z), Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z)) < 2 * tol;
    const interior = samples.filter((q) => !nearEnd(q));
    const whole = interior.length > 0 && interior.every((q) => distToRails(q, authored) > tol);
    runs.forEach((run, k) => {
      const id = whole ? autoRailId(line) : autoRailId(line, k);
      if (ids.has(id)) return;
      ids.add(id);
      const pts = whole ? line.points : simplify(run);
      const rail = lineRail({ ...line, closed: whole && line.closed }, id, pts);
      out.push({ rail, primId: line.primId, reason: 'auto' });
    });
  }
  // Spine peak rail named by the primitive but not authored: a rail along the ridge centre.
  for (const p of def.primitives) {
    if (p.kind !== 'spine' || !p.peakRailId || ids.has(p.peakRailId)) continue;
    ids.add(p.peakRailId);
    const y = p.copingHeight;
    const pt = (s: number): Vec3 => (p.axis === 'z' ? { x: p.centre, y, z: s } : { x: s, y, z: p.centre });
    out.push({ rail: { id: p.peakRailId, kind: 'rail', points: [pt(p.span[0]), pt(p.span[1])] }, primId: p.id, reason: 'named' });
  }
  return out;
}

/** RailDef -> BuiltRail: drops repeated points, measures segments, bends and total length. */
export function toBuiltRail(def: RailDef): BuiltRail {
  const pts: Vec3[] = [];
  for (const p of def.points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 1e-6) pts.push({ x: p.x, y: p.y, z: p.z });
  }
  const closed = def.closed === true;
  const segs: { a: Vec3; b: Vec3; length: number; start: number; tangent: Vec3 }[] = [];
  let start = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Vec3, b = pts[i + 1] as Vec3;
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
    segs.push({ a, b, length, start, tangent });
    start += length;
  }
  const segments: RailSegment[] = segs.map((s, i) => {
    const next = segs[i + 1] ?? (closed ? segs[0] : undefined);
    let bend = 0;
    if (next && next !== s) {
      const d = s.tangent.x * next.tangent.x + s.tangent.y * next.tangent.y + s.tangent.z * next.tangent.z;
      bend = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
    }
    return { a: s.a, b: s.b, length: s.length, start: s.start, tangent: s.tangent, bendToNextDeg: bend };
  });
  return { ...def, points: pts, segments, length: start, closed };
}
