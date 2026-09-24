/**
 * src/levels/lib/derive.ts (levels track): the geometric facts of each primitive, computed ONCE and
 * shared by the mesh builders, the ground-hole cutter, rail emission and validation. Keeping one
 * derivation per shape is what makes "every visible grind edge has a rail" (REQ-LVL-03) checkable:
 * the validator reads the same coping line the mesh was built on.
 */

import { TUNING } from '../../core/tuning';
import type { Facing, RectXZ, Vec3 } from '../../core/types';
import type { BowlPrim, ChannelPrim, EnvironmentPreset, FullPipePrim, MaterialId, Primitive, QuarterPipePrim } from '../types';
import { leftOf, offsetFrames, type OffsetFrame, type P2, type PathPoint, roundedRectPath } from './poly2d';

export const UP: Vec3 = { x: 0, y: 1, z: 0 };

// ---------------------------------------------------------------------------------------------
// Facing frames
// ---------------------------------------------------------------------------------------------

/** Unit ground vector of a compass facing (north = -z). */
export function facingVec(f: Facing): P2 {
  switch (f) {
    case 'north':
      return { x: 0, z: -1 };
    case 'south':
      return { x: 0, z: 1 };
    case 'east':
      return { x: 1, z: 0 };
    case 'west':
      return { x: -1, z: 0 };
  }
}

export function facingAxisIsX(f: Facing): boolean {
  return f === 'east' || f === 'west';
}

/**
 * A frame for a primitive laid out along a facing: `lineCoord` is the coordinate of the reference
 * line on the facing axis, u runs from that line along the facing, s is the coordinate on the
 * other axis. world(u, s, y) -> Vec3.
 */
export function lineFrame(facing: Facing, lineCoord: number): (u: number, s: number, y: number) => Vec3 {
  const f = facingVec(facing);
  return facingAxisIsX(facing)
    ? (u, s, y) => ({ x: lineCoord + f.x * u, y, z: s })
    : (u, s, y) => ({ x: s, y, z: lineCoord + f.z * u });
}

/** A rect's extent along a facing axis, as [near, far] relative to the facing direction. */
export function rectAlong(rect: RectXZ, facing: Facing): { start: number; end: number; s0: number; s1: number } {
  switch (facing) {
    case 'north':
      return { start: rect.z1, end: rect.z0, s0: rect.x0, s1: rect.x1 };
    case 'south':
      return { start: rect.z0, end: rect.z1, s0: rect.x0, s1: rect.x1 };
    case 'east':
      return { start: rect.x0, end: rect.x1, s0: rect.z0, s1: rect.z1 };
    case 'west':
      return { start: rect.x1, end: rect.x0, s0: rect.z0, s1: rect.z1 };
  }
}

// ---------------------------------------------------------------------------------------------
// Transition profile (quarter-pipes, spine faces, bowl walls, fountain face, channel walls)
// ---------------------------------------------------------------------------------------------

export interface ProfilePoint {
  /** Horizontal distance from the coping (top) line toward the foot, >= 0. */
  readonly u: number;
  /** Height above the base. */
  readonly h: number;
  /** Unit normal of the rideable side in (u, h): nu along +u (toward the foot side), nh up. */
  readonly nu: number;
  readonly nh: number;
  /** Arc length from the foot. */
  readonly s: number;
}

export interface Profile {
  /** Foot (index 0) to top. */
  readonly points: readonly ProfilePoint[];
  /** Horizontal run of the curve (foot distance from the coping line). */
  readonly run: number;
  readonly arcHeight: number;
  readonly totalHeight: number;
}

/**
 * Circular transition of `radius` tangent to the base at its foot, rising to arcHeight
 * (= totalHeight - vertExt, capped at the radius), then vertExt of vertical wall. Segment angle
 * LEVELS_ARC_SEG_DEG (REQ-LVL-09).
 */
export function transitionProfile(totalHeight: number, radius: number, vertExt = 0): Profile {
  const R = Math.max(1e-3, radius);
  const arcH = Math.max(0, Math.min(R, totalHeight - vertExt));
  const thetaMax = Math.acos(Math.max(-1, Math.min(1, (R - arcH) / R)));
  const run = R * Math.sin(thetaMax);
  const segs = Math.max(2, Math.ceil((thetaMax * 180) / Math.PI / TUNING.LEVELS_ARC_SEG_DEG - 1e-9));
  const pts: ProfilePoint[] = [];
  for (let i = 0; i <= segs; i++) {
    const th = (thetaMax * i) / segs;
    pts.push({ u: run - R * Math.sin(th), h: R - R * Math.cos(th), nu: Math.sin(th), nh: Math.cos(th), s: R * th });
  }
  const top = pts[pts.length - 1] as ProfilePoint;
  const rest = totalHeight - arcH;
  if (rest > 1e-6) {
    // Vertical extension: normal horizontal toward the foot side.
    const pieces = Math.max(1, Math.ceil(rest / 0.6));
    for (let i = 1; i <= pieces; i++) {
      pts.push({ u: 0, h: arcH + (rest * i) / pieces, nu: 1, nh: 0, s: top.s + (rest * i) / pieces });
    }
  }
  return { points: pts, run, arcHeight: arcH, totalHeight: Math.max(totalHeight, arcH) };
}

export function qpProfile(p: QuarterPipePrim): Profile {
  return transitionProfile(p.copingHeight, p.radius, p.vertExt ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Bowl
// ---------------------------------------------------------------------------------------------

export interface BowlShape {
  readonly rim: readonly PathPoint[];
  readonly rimY: number;
  readonly floorY: number;
  readonly profile: Profile;
  /** Corner radius actually used (>= the wall run so the sweep never folds). */
  readonly cornerRadius: number;
}

export function bowlShape(p: BowlPrim): BowlShape {
  const profile = transitionProfile(p.depth, p.wallRadius, Math.max(0, p.depth - p.wallRadius));
  const rc = Math.max(p.cornerRadius, profile.run);
  const rim = roundedRectPath(p.rect, rc, Math.round(TUNING.LEVELS_CORNER_SEGS), TUNING.LEVELS_MAX_SEG_M);
  const rimY = p.rimY ?? 0;
  return { rim, rimY, floorY: rimY - p.depth, profile, cornerRadius: rc };
}

// ---------------------------------------------------------------------------------------------
// Channel (snake run)
// ---------------------------------------------------------------------------------------------

export interface ChannelSection {
  readonly frame: OffsetFrame;
  /** 0 on the channel proper, rising to 1 at the far end of an open-end ramp (fully flat at rim level). */
  readonly flatten: number;
  /** Distance along the whole swept path (UV). */
  readonly along: number;
  /** True for sections on the centreline itself (rails cover these). */
  readonly core: boolean;
}

export interface ChannelShape {
  readonly sections: readonly ChannelSection[];
  readonly rimY: number;
  readonly half: number;
  /** Profile of one wall (foot at the floor edge, top at the rim). */
  readonly profile: Profile;
  /** Lateral offsets and heights of the cross-section, left rim -> right rim, with normals (lateral, up). */
  readonly cross: readonly { readonly o: number; readonly y: number; readonly no: number; readonly ny: number; readonly wall: boolean; readonly s: number }[];
}

export function channelShape(p: ChannelPrim): ChannelShape {
  const half = p.width / 2;
  const rimY = p.floorY + p.wallHeight;
  const profile = transitionProfile(p.wallHeight, p.wallRadius, Math.max(0, p.wallHeight - p.wallRadius));
  const run = Math.min(profile.run, half);
  const cross: { o: number; y: number; no: number; ny: number; wall: boolean; s: number }[] = [];
  // Left wall: from the rim (o = +half) down to the floor edge (o = half - run). Profile u is
  // measured from the rim inward, so o = half - u; the rideable normal points inward (-o) and up.
  const pts = [...profile.points].reverse();
  let s = 0;
  let prev: { o: number; y: number } | null = null;
  for (const q of pts) {
    const o = half - Math.min(q.u, run);
    const y = p.floorY + q.h;
    if (prev) s += Math.hypot(o - prev.o, y - prev.y);
    cross.push({ o, y, no: -q.nu, ny: q.nh, wall: true, s });
    prev = { o, y };
  }
  // Floor to the right wall foot.
  const floorPieces = Math.max(1, Math.ceil((2 * (half - run)) / TUNING.LEVELS_MAX_SEG_M));
  for (let i = 1; i <= floorPieces; i++) {
    const o = (half - run) - (2 * (half - run) * i) / floorPieces;
    const y = p.floorY;
    if (prev) s += Math.hypot(o - prev.o, y - prev.y);
    cross.push({ o, y, no: 0, ny: 1, wall: false, s });
    prev = { o, y };
  }
  // Right wall, foot to rim, mirrored.
  for (const q of profile.points.slice(1)) {
    const o = -(half - Math.min(q.u, run));
    const y = p.floorY + q.h;
    if (prev) s += Math.hypot(o - prev.o, y - prev.y);
    cross.push({ o, y, no: q.nu, ny: q.nh, wall: true, s });
    prev = { o, y };
  }
  // Sections along the centreline, split at LEVELS_MAX_SEG_M, plus the open-end ramps.
  const cl = p.centreline;
  const frames = offsetFrames(cl);
  const sections: ChannelSection[] = [];
  const rampM = p.openEndRampM ?? 0;
  let along = 0;
  const f0 = frames[0] as OffsetFrame;
  if (rampM > 0) {
    const pieces = Math.max(2, Math.ceil(rampM / 0.5));
    for (let i = pieces; i >= 1; i--) {
      const d = (rampM * i) / pieces;
      sections.push({ frame: { ...f0, x: f0.x - f0.tx * d, z: f0.z - f0.tz * d }, flatten: i / pieces, along: -d, core: false });
    }
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as OffsetFrame;
    if (i > 0) {
      const a = frames[i - 1] as OffsetFrame;
      const len = Math.hypot(f.x - a.x, f.z - a.z);
      const pieces = Math.max(1, Math.ceil(len / TUNING.LEVELS_MAX_SEG_M - 1e-9));
      for (let k = 1; k < pieces; k++) {
        const t = k / pieces;
        // Straight interior: plain perpendicular offset (no mitre) along this segment.
        const tx = (f.x - a.x) / (len || 1), tz = (f.z - a.z) / (len || 1);
        const l = leftOf(tx, tz);
        sections.push({ frame: { x: a.x + (f.x - a.x) * t, z: a.z + (f.z - a.z) * t, tx, tz, mx: l.x, mz: l.z }, flatten: 0, along: along + len * t, core: true });
      }
      along += len;
    }
    sections.push({ frame: f, flatten: 0, along, core: true });
  }
  const fl = frames[frames.length - 1] as OffsetFrame;
  if (rampM > 0) {
    const pieces = Math.max(2, Math.ceil(rampM / 0.5));
    for (let i = 1; i <= pieces; i++) {
      const d = (rampM * i) / pieces;
      sections.push({ frame: { ...fl, x: fl.x + fl.tx * d, z: fl.z + fl.tz * d }, flatten: i / pieces, along: along + d, core: false });
    }
  }
  return { sections, rimY, half, profile, cross };
}

/** A point of a channel cross-section in world space. */
export function channelPoint(sec: ChannelSection, o: number, y: number, rimY: number): Vec3 {
  const f = sec.frame;
  return { x: f.x + f.mx * o, y: y + (rimY - y) * sec.flatten, z: f.z + f.mz * o };
}

// ---------------------------------------------------------------------------------------------
// Full-pipe
// ---------------------------------------------------------------------------------------------

export interface PipeFrame {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly dir: Vec3;
  readonly length: number;
  /** Unit vectors perpendicular to the axis: e1 = world-up-most, e2 = dir x e1. */
  readonly e1: Vec3;
  readonly e2: Vec3;
}

export function pipeFrame(p: FullPipePrim): PipeFrame {
  const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, dz = p.b.z - p.a.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / length, y: dy / length, z: dz / length };
  const d = dir.y;
  let e1 = { x: -dir.x * d, y: 1 - dir.y * d, z: -dir.z * d };
  const l1 = Math.hypot(e1.x, e1.y, e1.z) || 1;
  e1 = { x: e1.x / l1, y: e1.y / l1, z: e1.z / l1 };
  const e2 = { x: dir.y * e1.z - dir.z * e1.y, y: dir.z * e1.x - dir.x * e1.z, z: dir.x * e1.y - dir.y * e1.x };
  return { a: p.a, b: p.b, dir, length, e1, e2 };
}

// ---------------------------------------------------------------------------------------------
// Material defaults
// ---------------------------------------------------------------------------------------------

export function defaultMaterial(p: Primitive, env: EnvironmentPreset): MaterialId {
  if (p.material) return p.material;
  const wood = env === 'woodshedInterior';
  switch (p.kind) {
    case 'ground':
      return wood ? 'maple' : 'concrete';
    case 'box':
    case 'ledge':
    case 'hubba':
    case 'stairs':
      return wood ? 'mapleDark' : 'concrete';
    case 'building':
      switch (p.style) {
        case 'glassTower':
          return 'glass';
        case 'annex':
        case 'closet':
          return 'metalPanel';
        case 'depot':
          return 'brick';
        case 'booth':
          return 'woodPanel';
        default:
          return 'concrete';
      }
    case 'bank':
    case 'kicker':
    case 'funbox':
    case 'pyramid':
    case 'euroGap':
    case 'quarterPipe':
    case 'spine':
    case 'bowl':
    case 'fullPipe':
    case 'channel':
    case 'hump':
      return wood ? 'maple' : 'concrete';
    case 'fountain':
      return 'granite';
    case 'railPipe':
      return p.style === 'scaffold' ? 'scaffold' : 'steelRail';
    case 'billboard':
      return 'paintedSteel';
    case 'prop':
      return p.prop === 'booth' || p.prop === 'coffeeTable' ? 'woodPanel' : p.prop === 'planter' ? 'concrete' : 'paintedSteel';
  }
}
