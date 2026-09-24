/**
 * src/sim/rails.ts (sim track): rail network, magnet query and grind motion (DESIGN E.1,
 * REQ-GRD-02..15, REQ-LIP-02, REQ-VRT-08 transfer lookup).
 *
 * Magnet (REQ-GRD-02): for every segment in the 3 x 3 spatial-hash cells (RAIL_GRID_CELL_M) around
 * the board centre P: closest point C, d = |P - C| <= GRIND_MAGNET_RADIUS_M (for a ledge the
 * across-the-ledge part less SKATER_RADIUS_M; see ledgeHorizontal), travel tangent sign by
 * dot(v, tan), horizontal entry angle <= GRIND_ENTRY_MAX_DEG; score = d / radius + angle / maxAngle,
 * lowest wins; rail or ledge candidates beat coping ones (REQ-LIP-02). A candidate at an open rail
 * end with travel pointing off it (less than one tick of rail ahead) is no candidate. Coping approached at > 55 deg
 * with the lip conditions (LIP_MAGNET_M, LIP_MAX_VY, y >= coping - LIP_BELOW_COPING_M) = lip candidate.
 * Snap speed = max(dot(v, tan3D), GRIND_MIN_ENTRY_SPEED) along the 3D tangent (REQ-GRD-03).
 * Motion (REQ-GRD-08): v += (-friction(kind) - GRIND_GRAVITY_FACTOR x g x sin(slope)) dt; below
 * GRIND_MIN_SPEED -> stall; past the end -> railEnd; a bend > GRIND_CORNER_MAX_DEG -> corner end;
 * closed loops wrap.
 *
 * Ground mode (REQ-GRD-05, P5b): the closest point is taken in the horizontal projection (the rail
 * is beside or above the rolling board), the horizontal distance must be inside the magnet and the
 * rail height above the board dy inside [GRIND_GROUND_SNAP_DY_MIN, GRIND_GROUND_SNAP_DY_MAX].
 */

import { dot3, RAD } from '../core/math';
import { tickSeconds, TUNING } from '../core/tuning';
import type { DirOrNeutral, GrindTypeId, RailKind, Stance, Vec3 } from '../core/types';
import { grindTypeFromDir } from '../data/tricks';
import type { BuiltRail, RailSegment } from '../levels/types';

export interface RailCandidate {
  readonly rail: BuiltRail;
  readonly segment: number;
  /** Parameter 0..1 along the segment. */
  readonly t: number;
  /** Closest point on the rail. */
  readonly point: Vec3;
  readonly distance: number;
  /** Horizontal angle between velocity and the travel tangent, degrees. */
  readonly angleDeg: number;
  readonly score: number;
  /** Unit 3D tangent in the direction of travel. */
  readonly tangent: Vec3;
  readonly kind: RailKind;
  /** Coping approached steeply: a lip, not a grind. */
  readonly lip: boolean;
}

export interface RailQuery {
  /** Board centre. */
  readonly pos: Vec3;
  readonly vel: Vec3;
  /** "air" = REQ-GRD-02 + lip rules; "ground" = REQ-GRD-05 (rail dy within GRIND_GROUND_SNAP_DY_MIN..MAX). */
  readonly mode: 'air' | 'ground';
  /** A rail id never returned (the world passes the rail an air just popped off while it still rises). */
  readonly exclude?: string | null;
}

export interface RailNetwork {
  readonly rails: readonly BuiltRail[];
  byId(id: string): BuiltRail | undefined;
  /** Best candidate or null. */
  query(q: RailQuery): RailCandidate | null;
  /**
   * Spine transfer rail for REQ-VRT-08: a rail tagged transfer whose closest point is 0..SPINE_TRANSFER_HEIGHT_M
   * below the skater and within SPINE_TRANSFER_LATERAL_M horizontally of the rail line, or null.
   * `maxHeightM` replaces the height window (the world passes Infinity once an air has been in
   * reach of a transfer rail, so the press works to the top of a popped air, DESIGN E.9).
   */
  transferRail(pos: Vec3, maxHeightM?: number): BuiltRail | null;
}

/** Position on a rail during a grind. */
export interface GrindMotion {
  readonly railId: string;
  /** Arc length along the rail. */
  readonly s: number;
  /** +1 = toward the last point, -1 = toward the first. */
  readonly dir: 1 | -1;
  /** Along-rail speed, m/s (>= 0). */
  readonly speed: number;
  /** Distance travelled on this rail id in the current grind chain (grindDistance gaps). */
  readonly travelled: number;
}

export interface GrindStep {
  readonly motion: GrindMotion;
  readonly point: Vec3;
  readonly tangent: Vec3;
  readonly slopeDeg: number;
  readonly event: 'railEnd' | 'corner' | 'stall' | null;
}

/** Numeric spatial-hash key of a cell (parks are far smaller than the 65536-cell span). */
const cellKey = (ix: number, iz: number): number => (ix + 32768) * 65536 + (iz + 32768);

/**
 * Horizontal magnet distance of the offset (hx, hz) from the closest rail point. For a ledge the
 * part across the segment is reduced by SKATER_RADIUS_M (the capsule touching the face is inside
 * the magnet); the part along it (past a clamped end) is kept. Rails and coping use |P - C|.
 */
function ledgeHorizontal(kind: RailKind, hx: number, hz: number, ab: Vec3): number {
  const dh = Math.hypot(hx, hz);
  if (kind !== 'ledge') return dh;
  const l = Math.hypot(ab.x, ab.z);
  const along = l > 1e-9 ? (hx * ab.x + hz * ab.z) / l : 0;
  const across = Math.sqrt(Math.max(0, dh * dh - along * along));
  return Math.hypot(along, Math.max(0, across - TUNING.SKATER_RADIUS_M));
}

interface SegRef {
  readonly rail: BuiltRail;
  readonly index: number;
}

function segmentAt(rail: BuiltRail, s: number): { seg: RailSegment; index: number } {
  const segs = rail.segments;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] as RailSegment;
    if (s <= seg.start + seg.length + 1e-9 || i === segs.length - 1) return { seg, index: i };
  }
  return { seg: segs[segs.length - 1] as RailSegment, index: segs.length - 1 };
}

/** Point and unit segment tangent (a -> b) at arc length s (clamped to the rail). */
export function railPointAt(rail: BuiltRail, s: number): { point: Vec3; tangent: Vec3; segment: number } {
  const clamped = Math.max(0, Math.min(rail.length, s));
  const { seg, index } = segmentAt(rail, clamped);
  const u = seg.length > 0 ? (clamped - seg.start) / seg.length : 0;
  return {
    point: { x: seg.a.x + (seg.b.x - seg.a.x) * u, y: seg.a.y + (seg.b.y - seg.a.y) * u, z: seg.a.z + (seg.b.z - seg.a.z) * u },
    tangent: seg.tangent,
    segment: index,
  };
}

function frictionFor(kind: RailKind): number {
  switch (kind) {
    case 'rail':
      return TUNING.GRIND_FRICTION_RAIL;
    case 'ledge':
      return TUNING.GRIND_FRICTION_LEDGE;
    case 'coping':
      return TUNING.GRIND_FRICTION_COPING;
  }
}

/** Horizontal angle in degrees between two vectors; 90 when the first has no horizontal speed. */
function hAngle(v: Vec3, tan: Vec3): number {
  const vh = Math.hypot(v.x, v.z);
  const th = Math.hypot(tan.x, tan.z);
  if (vh < TUNING.SIM_GRIND_MIN_HSPEED || th < 1e-9) return 90;
  const c = (v.x * tan.x + v.z * tan.z) / (vh * th);
  return Math.acos(Math.max(-1, Math.min(1, c))) * RAD;
}

export function createRailNetwork(rails: readonly BuiltRail[]): RailNetwork {
  const byId = new Map<string, BuiltRail>();
  for (const r of rails) byId.set(r.id, r);
  // Spatial hash of segments (REQ-GRD-14). Built at the cell size in effect now; a changed
  // RAIL_GRID_CELL_M rebuilds the hash on the next query. Segments are numbered once; a query
  // de-duplicates segments that span several cells with a per-query stamp (no allocation per hit).
  const refs: SegRef[] = [];
  for (const rail of rails) rail.segments.forEach((_seg, index) => refs.push({ rail, index }));
  const stamp = new Uint32Array(refs.length);
  let queryNo = 0;
  let cell = 0;
  let grid = new Map<number, number[]>();
  const rebuild = (): void => {
    cell = TUNING.RAIL_GRID_CELL_M;
    grid = new Map();
    refs.forEach((ref, id) => {
      const seg = ref.rail.segments[ref.index] as RailSegment;
      const x0 = Math.floor(Math.min(seg.a.x, seg.b.x) / cell), x1 = Math.floor(Math.max(seg.a.x, seg.b.x) / cell);
      const z0 = Math.floor(Math.min(seg.a.z, seg.b.z) / cell), z1 = Math.floor(Math.max(seg.a.z, seg.b.z) / cell);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = cellKey(ix, iz);
          const list = grid.get(k);
          if (list) list.push(id);
          else grid.set(k, [id]);
        }
      }
    });
  };
  rebuild();
  const scratch: SegRef[] = [];

  /** Segments in the 3 x 3 cells around p, each once (the returned array is reused per call). */
  const near = (p: Vec3): SegRef[] => {
    if (cell !== TUNING.RAIL_GRID_CELL_M) rebuild();
    queryNo = (queryNo + 1) >>> 0;
    if (queryNo === 0) {
      stamp.fill(0);
      queryNo = 1;
    }
    const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    scratch.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (const id of list) {
          if (stamp[id] === queryNo) continue;
          stamp[id] = queryNo;
          scratch.push(refs[id] as SegRef);
        }
      }
    }
    return scratch;
  };

  const query = (q: RailQuery): RailCandidate | null => {
    const P = q.pos;
    const v = q.vel;
    const radius = TUNING.GRIND_MAGNET_RADIUS_M;
    const maxAng = TUNING.GRIND_ENTRY_MAX_DEG;
    let bestRail: RailCandidate | null = null;
    let bestCoping: RailCandidate | null = null;
    for (const { rail, index } of near(P)) {
      if (q.exclude && rail.id === q.exclude) continue;
      const seg = rail.segments[index] as RailSegment;
      const A = seg.a, B = seg.b;
      const ab = { x: B.x - A.x, y: B.y - A.y, z: B.z - A.z };
      let t: number;
      if (q.mode === 'ground') {
        const l2 = ab.x * ab.x + ab.z * ab.z;
        t = l2 > 1e-12 ? ((P.x - A.x) * ab.x + (P.z - A.z) * ab.z) / l2 : 0;
      } else {
        const l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
        t = l2 > 1e-12 ? ((P.x - A.x) * ab.x + (P.y - A.y) * ab.y + (P.z - A.z) * ab.z) / l2 : 0;
      }
      t = Math.max(0, Math.min(1, t));
      const C = { x: A.x + ab.x * t, y: A.y + ab.y * t, z: A.z + ab.z * t };
      // A ledge is a solid block: the capsule stops SKATER_RADIUS_M off its face, so its lateral
      // distance is measured from the body surface, not the feet centre (SPEC §1 rule 5).
      const dh = ledgeHorizontal(rail.kind, P.x - C.x, P.z - C.z, ab);
      let d: number;
      if (q.mode === 'ground') {
        d = dh;
        const dy = C.y - P.y;
        if (dy < TUNING.GRIND_GROUND_SNAP_DY_MIN || dy > TUNING.GRIND_GROUND_SNAP_DY_MAX) continue;
      } else {
        d = Math.hypot(dh, P.y - C.y);
      }
      let tan = seg.tangent;
      if (dot3(v, tan) < 0) tan = { x: -tan.x + 0, y: -tan.y + 0, z: -tan.z + 0 };
      // Nothing left ahead: the closest point is the rail's open end and travel points off it, so a
      // snap would end on the next tick (it re-snapped the end every tick after a rail end).
      if (!rail.closed) {
        const s = seg.start + t * seg.length;
        const ahead = dot3(tan, seg.tangent) >= 0 ? rail.length - s : s;
        if (ahead <= Math.abs(dot3(v, tan)) * tickSeconds() + 1e-6) continue;
      }
      const ang = hAngle(v, tan);
      const isCoping = rail.kind === 'coping';
      let lip = false;
      if (ang > maxAng) {
        // Only a coping approached steeply from the air can still be a candidate: a lip (E.4).
        if (!isCoping || q.mode !== 'air') continue;
        if (d > TUNING.LIP_MAGNET_M || v.y > TUNING.LIP_MAX_VY || P.y < C.y - TUNING.LIP_BELOW_COPING_M) continue;
        lip = true;
      } else if (d > radius) {
        continue;
      }
      const score = d / (lip ? TUNING.LIP_MAGNET_M : radius) + ang / maxAng;
      const cand: RailCandidate = { rail, segment: index, t, point: C, distance: d, angleDeg: ang, score, tangent: tan, kind: rail.kind, lip };
      if (isCoping) {
        if (!bestCoping || score < bestCoping.score) bestCoping = cand;
      } else if (!bestRail || score < bestRail.score) {
        bestRail = cand;
      }
    }
    // REQ-LIP-02: a rail or ledge candidate always beats a coping candidate.
    return bestRail ?? bestCoping;
  };

  const transferRail = (p: Vec3, maxHeightM: number = TUNING.SPINE_TRANSFER_HEIGHT_M): BuiltRail | null => {
    let best: BuiltRail | null = null;
    let bestD = Infinity;
    for (const rail of rails) {
      if (!rail.tags?.includes('transfer')) continue;
      for (const seg of rail.segments) {
        const ax = seg.b.x - seg.a.x, az = seg.b.z - seg.a.z;
        const l2 = ax * ax + az * az;
        let t = l2 > 1e-12 ? ((p.x - seg.a.x) * ax + (p.z - seg.a.z) * az) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = seg.a.x + ax * t, cz = seg.a.z + az * t, cy = seg.a.y + (seg.b.y - seg.a.y) * t;
        const dh = Math.hypot(p.x - cx, p.z - cz);
        const dy = p.y - cy;
        if (dy < 0 || dy > maxHeightM || dh > TUNING.SPINE_TRANSFER_LATERAL_M) continue;
        if (dh < bestD) {
          bestD = dh;
          best = rail;
        }
      }
    }
    return best;
  };

  return { rails, byId: (id) => byId.get(id), query, transferRail };
}

/** Motion state at the snap (REQ-GRD-03). */
export function startGrind(candidate: RailCandidate, vel: Vec3): GrindMotion {
  const seg = candidate.rail.segments[candidate.segment] as RailSegment;
  const s = seg.start + candidate.t * seg.length;
  const dir: 1 | -1 = dot3(candidate.tangent, seg.tangent) >= 0 ? 1 : -1;
  // Vertical velocity counts only along a sloped rail: no free speed from an ollie and a resnap.
  const along = dot3(vel, candidate.tangent);
  return { railId: candidate.rail.id, s, dir, speed: Math.max(along, TUNING.GRIND_MIN_ENTRY_SPEED), travelled: 0 };
}

/** Bend in degrees the rider meets at the segment boundary ahead (travel direction dir). */
function bendAhead(rail: BuiltRail, index: number, dir: 1 | -1): number {
  if (dir === 1) return (rail.segments[index] as RailSegment).bendToNextDeg;
  const prev = rail.segments[index - 1];
  if (prev) return prev.bendToNextDeg;
  // Closed loops: the bend from the last segment into the first.
  return rail.closed ? (rail.segments[rail.segments.length - 1] as RailSegment).bendToNextDeg : 0;
}

/** One tick along the rail (REQ-GRD-08..10). */
export function stepGrind(motion: GrindMotion, network: RailNetwork, dtS: number): GrindStep {
  const rail = network.byId(motion.railId);
  if (!rail) {
    return { motion, point: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: -1 }, slopeDeg: 0, event: 'railEnd' };
  }
  const here = railPointAt(rail, motion.s);
  const travelTan = { x: here.tangent.x * motion.dir, y: here.tangent.y * motion.dir, z: here.tangent.z * motion.dir };
  // sin(slope of travel) = the tangent's y component (unit tangent).
  const accel = -frictionFor(rail.kind) - TUNING.GRIND_GRAVITY_FACTOR * TUNING.GRAVITY * travelTan.y;
  const speed = Math.max(0, motion.speed + accel * dtS);
  let s = motion.s + motion.dir * speed * dtS;
  let event: GrindStep['event'] = null;
  const seg = rail.segments[here.segment] as RailSegment;
  const segEnd = motion.dir === 1 ? seg.start + seg.length : seg.start;
  const crossed = motion.dir === 1 ? s > segEnd + 1e-9 : s < segEnd - 1e-9;
  if (crossed) {
    const atRailEnd = motion.dir === 1 ? here.segment === rail.segments.length - 1 : here.segment === 0;
    if (atRailEnd && !rail.closed) {
      s = segEnd;
      event = 'railEnd';
    } else if (bendAhead(rail, here.segment, motion.dir) > TUNING.GRIND_CORNER_MAX_DEG) {
      s = segEnd;
      event = 'corner';
    }
  }
  if (rail.closed && rail.length > 0) s = ((s % rail.length) + rail.length) % rail.length;
  if (event === null && speed < TUNING.GRIND_MIN_SPEED) event = 'stall';
  const at = railPointAt(rail, s);
  const tangent = { x: at.tangent.x * motion.dir, y: at.tangent.y * motion.dir, z: at.tangent.z * motion.dir };
  const moved = Math.abs(s - motion.s) > rail.length / 2 && rail.closed ? rail.length - Math.abs(s - motion.s) : Math.abs(s - motion.s);
  return {
    motion: { ...motion, s, speed, travelled: motion.travelled + moved },
    point: at.point,
    tangent,
    slopeDeg: Math.asin(Math.max(-1, Math.min(1, tangent.y))) * RAD,
    event,
  };
}

/**
 * REQ-GRD-06 toe-side rule: toe side = right of travel when (stance regular XOR fakie), else left;
 * the rail is on the toe side when dot(railPoint - boardCentre, right) x toeSign > 0.
 */
export function railOnToeSide(railPoint: Vec3, boardCentre: Vec3, right: Vec3, stance: Stance, fakie: boolean): boolean {
  const toeSign = (stance === 'regular') !== fakie ? 1 : -1;
  const lateral = (railPoint.x - boardCentre.x) * right.x + (railPoint.y - boardCentre.y) * right.y + (railPoint.z - boardCentre.z) * right.z;
  return lateral * toeSign > 0;
}

const ALL_DIRS: readonly DirOrNeutral[] = ['N', 'U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];

/** Grind type for every direction on this rail (feeds ParserContext.grindTypeByDir). */
export function grindTypesByDir(railOnToe: boolean): Readonly<Record<DirOrNeutral, GrindTypeId>> {
  const out = {} as Record<DirOrNeutral, GrindTypeId>;
  for (const d of ALL_DIRS) out[d] = grindTypeFromDir(d, railOnToe);
  return out;
}
