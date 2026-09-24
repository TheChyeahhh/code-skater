/**
 * src/levels/validate.ts (levels track): the SPEC §9.2 / DESIGN G.3 checks, returned as violations
 * (empty array = valid). levels.test, marketStreet.test and woodshed.test assert on them.
 * - REQ-LVL-03 rail coverage: coping line of every quarterPipe / bowl / spine / fountain / channel,
 *   top centreline of every ledge / hubba, every grindable box edge: an AUTHORED rail within 0.1 m
 *   (sampled every LEVELS_AUTO_RAIL_SAMPLE_M; the builder's auto rails do not count).
 * - REQ-LVL-04 no decal quad within 0.15 m of a rail (built rails, auto ones included).
 * - REQ-LVL-05 a straight-up max ollie (OLLIE_H_FULL_M + COLLECT_POINT_UP_M reach) at spawn and at a
 *   3 x 4 grid over spawnArea never collects the MacGuffin (feet start on the surface below each point).
 * - REQ-LVL-06 / REQ-LVL-10 every listed feed: <= 3.5 m horizontal, <= 1.2 m up, <= 0.5 m lateral,
 *   and a straight-line hop at exitSpeed with the feed's pop passes within GRIND_MAGNET_RADIUS_M of the
 *   next rail's segment (inside the entry angle) at some tick.
 * - REQ-LVL-11 closed boundary; rails not in the collider; sanity: no NaN, spawn on the ground,
 *   rails not buried in geometry, surfaces seen from open space face outward, render normals agree
 *   with the winding. REQ-LVL-12 no rail end within 0.5 m of a wall along its exit tangent.
 *   REQ-NPC-04 no U+2014 in any level text.
 * - "schema": duplicate ids, dangling railId / copingRailId references, transfer rails without a plane.
 *
 * Feed geometry: E = the last point of `from` (its exit), t = the horizontal exit tangent of its last
 * segment, S = the point of `to` closest to E. along = (S - E) . t, lateral = |(S - E) x t|
 * horizontally, up = S.y - E.y. The hop starts at E + board thickness with velocity exitSpeed along
 * the 3D exit tangent plus the pop sqrt(2 g h) (h = OLLIE_H_FULL_M or OLLIE_H_TAP_M), sim ticks at
 * SIM_HZ, gravity GRAVITY, no steer.
 */

import { TUNING } from '../core/tuning';
import type { Vec3 } from '../core/types';
import { createLevelRaycaster, type LevelRaycaster } from './lib/bvh';
import { closestOnSegment, distToPolyline, samplePolyline } from './lib/grindLines';
import { levelGrindLines } from './lib/rails';
import type { BuiltLevel, BuiltRail, LevelDef, LevelViolation, RailDef } from './types';

const EM_DASH = String.fromCharCode(0x2014);

function v(rule: LevelViolation['rule'], message: string, ids: readonly string[], at?: Vec3): LevelViolation {
  return at ? { rule, message, ids, at: { ...at } } : { rule, message, ids };
}

function fmt(p: Vec3): string {
  return `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}, ${p.y.toFixed(2)})`;
}

// ---------------------------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------------------------

function checkSchema(def: LevelDef, out: LevelViolation[]): void {
  const dupes = (kind: string, ids: readonly string[]): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) out.push(v('schema', `duplicate ${kind} id ${id}`, [id]));
      seen.add(id);
    }
  };
  dupes('primitive', def.primitives.map((p) => p.id));
  dupes('rail', def.rails.map((r) => r.id));
  dupes('gap', def.gaps.map((g) => g.id));
  dupes('decal', def.decals.map((d) => d.id));
  const rails = new Set(def.rails.map((r) => r.id));
  const prims = new Set(def.primitives.map((p) => p.id));
  const needRail = (owner: string, id: string | undefined): void => {
    if (id !== undefined && !rails.has(id)) out.push(v('schema', `${owner} references missing rail ${id}`, [owner, id]));
  };
  const needSurface = (owner: string, id: string | undefined): void => {
    if (id !== undefined && !prims.has(id)) out.push(v('schema', `${owner} references missing surface ${id}`, [owner, id]));
  };
  for (const p of def.primitives) {
    switch (p.kind) {
      case 'railPipe':
        needRail(p.id, p.railId);
        break;
      case 'quarterPipe':
      case 'bowl':
      case 'fountain':
        needRail(p.id, p.copingRailId);
        break;
      case 'spine':
        needRail(p.id, p.copingRailIds[0]);
        needRail(p.id, p.copingRailIds[1]);
        needRail(p.id, p.peakRailId);
        break;
      case 'channel':
        needRail(p.id, p.rimRailIds?.[0]);
        needRail(p.id, p.rimRailIds?.[1]);
        break;
      default:
        break;
    }
  }
  for (const r of def.rails) {
    if (r.points.length < 2) out.push(v('schema', `rail ${r.id} has fewer than 2 points`, [r.id]));
    if (r.tags?.includes('transfer') && !r.transferPlane) out.push(v('schema', `transfer rail ${r.id} has no transferPlane`, [r.id]));
    if (r.closed) {
      const a = r.points[0], b = r.points[r.points.length - 1];
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-3) out.push(v('schema', `closed rail ${r.id} does not repeat its first point`, [r.id]));
    }
  }
  for (const g of def.gaps) {
    const r = g.rule;
    switch (r.kind) {
      case 'airBoxToBox':
        needSurface(g.id, r.startSurface);
        needSurface(g.id, r.landSurface);
        break;
      case 'grindSpan':
      case 'grindDistance':
        for (const id of r.rails) needRail(g.id, id);
        break;
      case 'grindSequence':
        for (const step of r.steps) for (const id of step) needRail(g.id, id);
        break;
      case 'transferOn':
        for (const id of r.rails) needRail(g.id, id);
        for (const id of r.then?.grindOn ?? []) needRail(g.id, id);
        break;
      case 'airApexIn':
        needSurface(g.id, r.landSurface);
        break;
      case 'surfaceAzimuth':
        needSurface(g.id, r.surface);
        break;
      case 'dropIn':
        for (const id of r.surfaces) needSurface(g.id, id);
        break;
      case 'manualSpan':
        break;
    }
  }
  for (const f of def.feeds) {
    needRail(`feed ${f.from}->${f.to}`, f.from);
    needRail(`feed ${f.from}->${f.to}`, f.to);
  }
}

// ---------------------------------------------------------------------------------------------
// NaN / text
// ---------------------------------------------------------------------------------------------

function checkFinite(built: BuiltLevel, out: LevelViolation[]): void {
  const pos = built.collider.positions;
  for (let i = 0; i < pos.length; i++) {
    if (!Number.isFinite(pos[i] as number)) {
      const tri = Math.floor(i / 9);
      const sid = built.collider.surfaceIds[built.collider.triSurface[tri] as number] ?? '?';
      out.push(v('REQ-LVL-11', `collider triangle ${tri} has a non-finite coordinate`, [sid]));
      break;
    }
  }
  for (const part of built.parts) {
    for (const name of ['position', 'normal', 'uv', 'color'] as const) {
      const attr = part.geometry.getAttribute(name);
      if (!attr) {
        out.push(v('REQ-LVL-11', `part ${part.id} has no ${name} attribute`, [part.surfaceId]));
        continue;
      }
      const arr = attr.array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i] as number)) {
          out.push(v('REQ-LVL-11', `part ${part.id} ${name} has a non-finite value`, [part.surfaceId]));
          break;
        }
      }
    }
  }
  for (const r of built.rails) {
    if (r.points.some((p) => !Number.isFinite(p.x + p.y + p.z)) || !Number.isFinite(r.length)) {
      out.push(v('REQ-LVL-11', `rail ${r.id} has a non-finite point`, [r.id]));
    }
  }
}

function checkText(def: LevelDef, out: LevelViolation[]): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (value.includes(EM_DASH)) out.push(v('REQ-NPC-04', `em dash in level text at ${path}`, [path]));
    } else if (Array.isArray(value)) {
      value.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (value && typeof value === 'object') {
      for (const [k, x] of Object.entries(value)) walk(x, `${path}.${k}`);
    }
  };
  walk(def, def.id);
}

// ---------------------------------------------------------------------------------------------
// REQ-LVL-03 coverage, REQ-LVL-04 decals
// ---------------------------------------------------------------------------------------------

function distToAuthored(p: Vec3, rails: readonly RailDef[]): { d: number; id: string | null } {
  let d = Infinity;
  let id: string | null = null;
  for (const r of rails) {
    const x = distToPolyline(p, r.points);
    if (x < d) {
      d = x;
      id = r.id;
    }
  }
  return { d, id };
}

function checkCoverage(def: LevelDef, out: LevelViolation[]): void {
  const tol = TUNING.LEVELS_COVERAGE_TOL_M;
  for (const line of levelGrindLines(def)) {
    if (!line.eligible) continue;
    const samples = samplePolyline(line.points, TUNING.LEVELS_AUTO_RAIL_SAMPLE_M);
    let worst = 0;
    let worstAt: Vec3 | null = null;
    let misses = 0;
    for (const s of samples) {
      const { d } = distToAuthored(s, def.rails);
      if (d > tol) {
        misses += 1;
        if (d > worst) {
          worst = d;
          worstAt = s;
        }
      }
    }
    if (misses > 0 && worstAt) {
      const d = Number.isFinite(worst) ? `${worst.toFixed(2)} m` : 'no rail';
      out.push(v('REQ-LVL-03', `${line.primId} ${line.key}: ${misses}/${samples.length} samples have no authored rail within ${tol} m (worst ${d} at ${fmt(worstAt)})`, [line.primId, ...(line.railId ? [line.railId] : [])], worstAt));
    }
  }
}

/** Closest distance between segment PQ and triangle ABC (sampling-free, exact up to float). */
function segTriDist(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  // Segment crossing the triangle plane inside the triangle -> 0.
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const dp = dot(sub(p, a), n), dq = dot(sub(q, a), n);
  if ((dp <= 0 && dq >= 0) || (dp >= 0 && dq <= 0)) {
    const t = dp === dq ? 0 : dp / (dp - dq);
    const x = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
    if (pointTriDist(x, a, b, c) < 1e-9) return 0;
  }
  let best = Math.min(pointTriDist(p, a, b, c), pointTriDist(q, a, b, c));
  for (const [e0, e1] of [[a, b], [b, c], [c, a]] as const) best = Math.min(best, segSegDist(p, q, e0, e1));
  return best;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** Closest point on triangle ABC to P (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return { x: a.x + ac.x * t, y: a.y + ac.y * t, z: a.z + ac.z * t };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return { x: b.x + (c.x - b.x) * t, y: b.y + (c.y - b.y) * t, z: b.z + (c.z - b.z) * t };
  }
  const denom = 1 / (va + vb + vc);
  const vv = vb * denom, ww = vc * denom;
  return { x: a.x + ab.x * vv + ac.x * ww, y: a.y + ab.y * vv + ac.y * ww, z: a.z + ab.z * vv + ac.z * ww };
}

function pointTriDist(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const x = closestOnTri(p, a, b, c);
  return Math.hypot(p.x - x.x, p.y - x.y, p.z - x.z);
}

/** Distance between segments P1Q1 and P2Q2 (Ericson 5.1.9). */
function segSegDist(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) return Math.hypot(r.x, r.y, r.z);
  if (a <= 1e-12) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z);
}

function checkDecals(built: BuiltLevel, out: LevelViolation[]): void {
  const clear = TUNING.LEVELS_DECAL_CLEAR_M;
  for (const d of built.decals) {
    const [a, b, c, e] = d.corners;
    let best = Infinity;
    let nearest = '';
    for (const r of built.rails) {
      for (const s of r.segments) {
        const dist = Math.min(segTriDist(s.a, s.b, a, b, c), segTriDist(s.a, s.b, a, c, e));
        if (dist < best) {
          best = dist;
          nearest = r.id;
        }
      }
    }
    if (best < clear) out.push(v('REQ-LVL-04', `decal ${d.def.id} is ${best.toFixed(3)} m from rail ${nearest} (min ${clear} m)`, [d.def.id, nearest], d.def.center));
  }
}

// ---------------------------------------------------------------------------------------------
// REQ-LVL-05 MacGuffin reach
// ---------------------------------------------------------------------------------------------

/** Feet height on the first walkable surface below (x, top, z), or null. */
function groundBelow(ray: LevelRaycaster, x: number, z: number, top: number): number | null {
  const hit = ray.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, top + 50);
  return hit ? hit.point.y : null;
}

export interface OlliePoint {
  readonly x: number;
  readonly z: number;
}

/** The 13 REQ-LVL-05 probe points: spawn plus a 3 x 4 grid of cell centres over spawnArea. */
export function macguffinProbePoints(def: LevelDef): OlliePoint[] {
  const pts: OlliePoint[] = [{ x: def.spawn.pos.x, z: def.spawn.pos.z }];
  const a = def.spawnArea;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) pts.push({ x: a.x0 + ((a.x1 - a.x0) * (i + 0.5)) / 3, z: a.z0 + ((a.z1 - a.z0) * (j + 0.5)) / 4 });
  return pts;
}

function checkMacGuffin(def: LevelDef, built: BuiltLevel, ray: LevelRaycaster, out: LevelViolation[]): void {
  const m = def.macguffin;
  if (!m) return;
  const top = built.bounds.max.y + 1;
  const reach = TUNING.OLLIE_H_FULL_M;
  const up = TUNING.COLLECT_POINT_UP_M;
  const r = TUNING.COLLECT_RADIUS_M;
  for (const [i, q] of macguffinProbePoints(def).entries()) {
    const feet = i === 0 ? def.spawn.pos.y : groundBelow(ray, q.x, q.z, top);
    if (feet === null) continue;
    // Collect point path: a vertical segment from feet + up to feet + up + reach.
    const a = { x: q.x, y: feet + up, z: q.z };
    const b = { x: q.x, y: feet + up + reach, z: q.z };
    const c = closestOnSegment(m.pos, a, b).point;
    const d = Math.hypot(m.pos.x - c.x, m.pos.y - c.y, m.pos.z - c.z);
    if (d <= r) {
      out.push(v('REQ-LVL-05', `a straight-up max ollie at ${fmt({ x: q.x, y: feet, z: q.z })} collects ${m.id} (${d.toFixed(2)} m <= ${r} m)`, [m.id], { x: q.x, y: feet, z: q.z }));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// REQ-LVL-06 / REQ-LVL-10 feeds
// ---------------------------------------------------------------------------------------------

export interface FeedMeasure {
  readonly along: number;
  readonly lateral: number;
  readonly up: number;
  readonly exit: Vec3;
  readonly target: Vec3;
}

function exitOf(r: RailDef): { e: Vec3; t: Vec3 } | null {
  const n = r.points.length;
  if (n < 2) return null;
  const e = r.points[n - 1] as Vec3, p = r.points[n - 2] as Vec3;
  const len = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z);
  if (len === 0) return null;
  return { e, t: { x: (e.x - p.x) / len, y: (e.y - p.y) / len, z: (e.z - p.z) / len } };
}

function closestOnRail(p: Vec3, r: RailDef): Vec3 {
  let best = Infinity;
  let at: Vec3 = r.points[0] as Vec3;
  for (let i = 0; i + 1 < r.points.length; i++) {
    const c = closestOnSegment(p, r.points[i] as Vec3, r.points[i + 1] as Vec3).point;
    const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
    if (d < best) {
      best = d;
      at = c;
    }
  }
  return at;
}

/** The REQ-LVL-06 numbers of one feed (see the file header). */
export function measureFeed(from: RailDef, to: RailDef): FeedMeasure | null {
  const ex = exitOf(from);
  if (!ex) return null;
  const s = closestOnRail(ex.e, to);
  const hl = Math.hypot(ex.t.x, ex.t.z);
  const tx = hl > 0 ? ex.t.x / hl : 1, tz = hl > 0 ? ex.t.z / hl : 0;
  const dx = s.x - ex.e.x, dz = s.z - ex.e.z;
  return { along: dx * tx + dz * tz, lateral: Math.abs(dx * tz - dz * tx), up: s.y - ex.e.y, exit: ex.e, target: s };
}

/** REQ-LVL-10 straight-line hop: true when the board passes inside the magnet of a segment of `to`. */
export function simulateFeedHop(from: RailDef, to: RailDef, exitSpeed: number, pop: 'tap' | 'full'): { hit: boolean; tick: number; closest: number } {
  const ex = exitOf(from);
  if (!ex) return { hit: false, tick: -1, closest: Infinity };
  const g = TUNING.GRAVITY;
  const h = pop === 'full' ? TUNING.OLLIE_H_FULL_M : TUNING.OLLIE_H_TAP_M;
  const dt = 1 / TUNING.SIM_HZ;
  const p = { x: ex.e.x, y: ex.e.y + TUNING.BOARD_THICKNESS_M, z: ex.e.z };
  const vel = { x: ex.t.x * exitSpeed, y: ex.t.y * exitSpeed + Math.sqrt(2 * g * h), z: ex.t.z * exitSpeed };
  const magnet = TUNING.GRIND_MAGNET_RADIUS_M;
  const maxAng = TUNING.GRIND_ENTRY_MAX_DEG;
  const n = Math.ceil(TUNING.LEVELS_FEED_SIM_MAX_S * TUNING.SIM_HZ);
  const vh = Math.hypot(vel.x, vel.z);
  let closest = Infinity;
  for (let k = 1; k <= n; k++) {
    vel.y -= g * dt;
    p.x += vel.x * dt;
    p.y += vel.y * dt;
    p.z += vel.z * dt;
    for (let i = 0; i + 1 < to.points.length; i++) {
      const a = to.points[i] as Vec3, b = to.points[i + 1] as Vec3;
      const c = closestOnSegment(p, a, b).point;
      const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
      closest = Math.min(closest, d);
      if (d > magnet) continue;
      const sx = b.x - a.x, sz = b.z - a.z;
      const sl = Math.hypot(sx, sz);
      const ang = sl > 0 && vh > 0 ? (Math.acos(Math.min(1, Math.abs(sx * vel.x + sz * vel.z) / (sl * vh))) * 180) / Math.PI : 0;
      if (ang <= maxAng) return { hit: true, tick: k, closest: d };
    }
    if (p.y < Math.min(ex.e.y, ...to.points.map((q) => q.y)) - 3) break;
  }
  return { hit: false, tick: -1, closest };
}

function checkFeeds(def: LevelDef, out: LevelViolation[]): void {
  const byId = new Map(def.rails.map((r) => [r.id, r]));
  for (const f of def.feeds) {
    const from = byId.get(f.from), to = byId.get(f.to);
    if (!from || !to) continue;
    const m = measureFeed(from, to);
    if (!m) continue;
    const ids = [f.from, f.to];
    const horiz = Math.hypot(m.target.x - m.exit.x, m.target.z - m.exit.z);
    if (horiz > TUNING.LEVELS_FEED_MAX_ALONG_M) out.push(v('REQ-LVL-06', `feed ${f.from} -> ${f.to}: ${horiz.toFixed(2)} m horizontal > ${TUNING.LEVELS_FEED_MAX_ALONG_M}`, ids, m.exit));
    if (m.up > TUNING.LEVELS_FEED_MAX_UP_M) out.push(v('REQ-LVL-06', `feed ${f.from} -> ${f.to}: +${m.up.toFixed(2)} m up > ${TUNING.LEVELS_FEED_MAX_UP_M}`, ids, m.exit));
    if (m.lateral > TUNING.LEVELS_FEED_MAX_LATERAL_M + 1e-6) out.push(v('REQ-LVL-06', `feed ${f.from} -> ${f.to}: ${m.lateral.toFixed(2)} m lateral > ${TUNING.LEVELS_FEED_MAX_LATERAL_M}`, ids, m.exit));
    const hop = simulateFeedHop(from, to, f.exitSpeed, f.pop);
    if (!hop.hit) out.push(v('REQ-LVL-10', `feed ${f.from} -> ${f.to}: a ${f.pop} hop at ${f.exitSpeed} m/s never comes within the magnet (closest ${hop.closest.toFixed(2)} m)`, ids, m.exit));
  }
}

// ---------------------------------------------------------------------------------------------
// REQ-LVL-11 sanity, REQ-LVL-12 walls
// ---------------------------------------------------------------------------------------------

/** True when p is inside a closed solid: the first surface straight above faces up (seen from its back). */
function insideSolid(ray: LevelRaycaster, p: Vec3): boolean {
  const hit = ray.raycast(p, { x: 0, y: 1, z: 0 }, 60);
  return !!hit && !hit.front && hit.tag !== 'boundary';
}

function checkBoundary(def: LevelDef, built: BuiltLevel, ray: LevelRaycaster, out: LevelViolation[]): void {
  const s = built.spawn.pos;
  const h = def.boundaryHeight ?? 12;
  const diag = Math.hypot(def.size.x, def.size.z) + 1;
  for (let k = 0; k < 16; k++) {
    const a = (2 * Math.PI * k) / 16;
    const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
    for (const y of [s.y + 1, h - 0.5]) {
      const hit = ray.raycast({ x: s.x, y, z: s.z }, dir, diag);
      if (!hit) out.push(v('REQ-LVL-11', `the boundary is open: a ray from spawn at y ${y.toFixed(1)} toward ${(a * 180 / Math.PI).toFixed(0)} deg leaves the level`, ['boundary'], { x: s.x, y, z: s.z }));
    }
  }
}

function checkSpawn(built: BuiltLevel, ray: LevelRaycaster, out: LevelViolation[]): void {
  const s = built.spawn.pos;
  const lift = 0.5;
  const hit = ray.raycast({ x: s.x, y: s.y + lift, z: s.z }, { x: 0, y: -1, z: 0 }, lift + 5);
  const tol = TUNING.LEVELS_SPAWN_GROUND_TOL_M;
  if (!hit) out.push(v('REQ-LVL-11', `spawn ${fmt(s)} has no ground below`, ['spawn'], s));
  else if (Math.abs(hit.point.y - s.y) > tol || hit.normal.y < 0.9 || !hit.front) {
    out.push(v('REQ-LVL-11', `spawn ${fmt(s)} is not on flat ground (surface ${hit.surfaceId} at y ${hit.point.y.toFixed(2)})`, ['spawn', hit.surfaceId], s));
  }
}

function checkRailsClear(built: BuiltLevel, ray: LevelRaycaster, out: LevelViolation[]): void {
  const lift = TUNING.LEVELS_BURY_PROBE_M;
  const step = Math.max(0.25, TUNING.LEVELS_AUTO_RAIL_SAMPLE_M);
  const pipeR = TUNING.LEVELS_RAIL_PIPE_R_M;
  for (const r of built.rails) {
    let buried: Vec3 | null = null;
    let inCollider: Vec3 | null = null;
    for (const seg of r.segments) {
      const t = seg.tangent;
      const hl = Math.hypot(t.x, t.z);
      const side = hl > 1e-6 ? { x: -t.z / hl, y: 0, z: t.x / hl } : { x: 1, y: 0, z: 0 };
      for (const s of samplePolyline([seg.a, seg.b], step)) {
        if (!buried && insideSolid(ray, { x: s.x, y: s.y + lift, z: s.z })) buried = s;
        if (r.kind === 'rail' && !inCollider) {
          // A ray across the pipe body (just under the line) must hit nothing: pipes are not in the BVH.
          const span = pipeR * 3;
          const o = { x: s.x - side.x * span, y: s.y - pipeR, z: s.z - side.z * span };
          if (ray.raycast(o, side, 2 * span)) inCollider = s;
        }
      }
    }
    if (buried) out.push(v('REQ-LVL-11', `rail ${r.id} is buried in geometry at ${fmt(buried)}`, [r.id], buried));
    if (inCollider) out.push(v('REQ-LVL-11', `rail ${r.id}: collider geometry at the pipe at ${fmt(inCollider)} (pipes stay out of the BVH)`, [r.id], inCollider));
  }
}

function checkWallsAtRailEnds(built: BuiltLevel, ray: LevelRaycaster, out: LevelViolation[]): void {
  const clear = TUNING.LEVELS_WALL_CLEAR_M;
  const lift = TUNING.LEVELS_WALL_PROBE_UP_M;
  for (const r of built.rails) {
    if (r.closed || r.segments.length === 0) continue;
    const first = r.segments[0] as BuiltRail['segments'][number];
    const last = r.segments[r.segments.length - 1] as BuiltRail['segments'][number];
    const ends: [Vec3, Vec3][] = [
      [first.a, { x: -first.tangent.x, y: 0, z: -first.tangent.z }],
      [last.b, { x: last.tangent.x, y: 0, z: last.tangent.z }],
    ];
    for (const [p, t] of ends) {
      const hl = Math.hypot(t.x, t.z);
      if (hl < 1e-6) continue;
      const dir = { x: t.x / hl, y: 0, z: t.z / hl };
      const hit = ray.raycast({ x: p.x, y: p.y + lift, z: p.z }, dir, clear);
      if (hit && Math.abs(hit.normal.y) < 0.5) {
        out.push(v('REQ-LVL-12', `rail ${r.id} ends ${hit.distance.toFixed(2)} m from wall ${hit.surfaceId} along its exit tangent`, [r.id, hit.surfaceId], p));
      }
    }
  }
}

/**
 * Outward normals: every surface seen from open space shows its outward side. Downward rays on a
 * grid over the level and horizontal rays from open grid points must hit front faces.
 */
function checkOutward(def: LevelDef, built: BuiltLevel, ray: LevelRaycaster, out: LevelViolation[]): void {
  const step = TUNING.LEVELS_PROBE_STEP_M;
  const top = built.bounds.max.y + 1;
  const bad = new Map<string, Vec3>();
  const note = (id: string, at: Vec3): void => {
    if (!bad.has(id)) bad.set(id, at);
  };
  const offset = step * 0.37;
  for (let x = offset; x < def.size.x; x += step) {
    for (let z = offset; z < def.size.z; z += step) {
      const hit = ray.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, top + 60);
      if (hit && !hit.front) note(hit.surfaceId, hit.point);
    }
  }
  const dirs = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  const coarse = step * 4;
  for (let x = offset; x < def.size.x; x += coarse) {
    for (let z = offset; z < def.size.z; z += coarse) {
      const g = ray.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, top + 60);
      if (!g) continue;
      const o = { x, y: g.point.y + 0.6, z };
      if (insideSolid(ray, o)) continue;
      for (const d of dirs) {
        const hit = ray.raycast(o, d, 8);
        if (hit && !hit.front) note(hit.surfaceId, hit.point);
      }
    }
  }
  for (const [id, at] of bad) out.push(v('REQ-LVL-11', `surface ${id} shows its back face to open space at ${fmt(at)} (normals must face outward)`, [id], at));
  // Render normals agree with the triangle winding.
  for (const part of built.parts) {
    const pos = part.geometry.getAttribute('position');
    const nor = part.geometry.getAttribute('normal');
    const idx = part.geometry.getIndex();
    if (!pos || !nor || !idx) continue;
    const P = pos.array as ArrayLike<number>, N = nor.array as ArrayLike<number>, I = idx.array as ArrayLike<number>;
    let flipped = 0;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = (I[t] as number) * 3, b = (I[t + 1] as number) * 3, c = (I[t + 2] as number) * 3;
      const u = { x: (P[b] as number) - (P[a] as number), y: (P[b + 1] as number) - (P[a + 1] as number), z: (P[b + 2] as number) - (P[a + 2] as number) };
      const w = { x: (P[c] as number) - (P[a] as number), y: (P[c + 1] as number) - (P[a + 1] as number), z: (P[c + 2] as number) - (P[a + 2] as number) };
      const fn = cross(u, w);
      const vn = { x: (N[a] as number) + (N[b] as number) + (N[c] as number), y: (N[a + 1] as number) + (N[b + 1] as number) + (N[c + 1] as number), z: (N[a + 2] as number) + (N[b + 2] as number) + (N[c + 2] as number) };
      if (dot(fn, vn) < 0) flipped += 1;
    }
    if (flipped > 0) out.push(v('REQ-LVL-11', `part ${part.id}: ${flipped} triangle(s) wound against their vertex normals`, [part.surfaceId]));
  }
}

export function validateLevel(def: LevelDef, built: BuiltLevel): readonly LevelViolation[] {
  const out: LevelViolation[] = [];
  const ray = createLevelRaycaster(built.collider);
  checkSchema(def, out);
  checkText(def, out);
  checkFinite(built, out);
  checkCoverage(def, out);
  checkDecals(built, out);
  checkMacGuffin(def, built, ray, out);
  checkFeeds(def, out);
  checkBoundary(def, built, ray, out);
  checkSpawn(built, ray, out);
  checkRailsClear(built, ray, out);
  checkWallsAtRailEnds(built, ray, out);
  checkOutward(def, built, ray, out);
  return out;
}
