/**
 * src/levels/lib/grindLines.ts (levels track): the grind lines each primitive's visible geometry
 * implies (SPEC §1.5 "if a player can see an edge, the grind button snaps to it", REQ-LVL-03).
 *
 * The builder uses them to EMIT a rail for every line no authored rail covers, with a stable id,
 * so a visible grindable edge always snaps. The validator uses the `eligible` ones (DESIGN G.3
 * REQ-LVL-03 a, b, c) to demand an AUTHORED rail within LEVELS_COVERAGE_TOL_M, so a park that
 * relies on an auto rail still fails its test (gaps and goals need named, authored rail ids).
 */

import type { Vec3 } from '../../core/types';
import type { LevelDef, Primitive, RailDef, RailTag, TransferPlane } from '../types';
import type { RailKind } from '../../core/types';
import { bowlShape, channelShape, channelPoint, facingAxisIsX, facingVec, qpProfile, rectAlong } from './derive';
import { TUNING } from '../../core/tuning';

export interface GrindLine {
  /** Primitive id that owns the edge. */
  readonly primId: string;
  /** Stable edge key within the primitive ("coping", "top", "edge-north", "rim-left"). */
  readonly key: string;
  readonly kind: RailKind;
  readonly points: readonly Vec3[];
  readonly closed: boolean;
  /** REQ-LVL-03 classes (a) coping lines, (b) ledge / hubba centrelines, (c) grindable box edges. */
  readonly eligible: boolean;
  /** Rail id the primitive names for this line (copingRailId, rimRailIds, ...), if any. */
  readonly railId?: string;
  readonly tags?: readonly RailTag[];
  readonly transferPlane?: TransferPlane;
}

/** Stable id of an auto-emitted rail for a line (whole line) or its k-th uncovered run. */
export function autoRailId(line: GrindLine, run?: number): string {
  return run === undefined ? `${line.primId}:${line.key}` : `${line.primId}:${line.key}:${run}`;
}

function segLine(primId: string, key: string, kind: RailKind, a: Vec3, b: Vec3, eligible: boolean, extra: Partial<GrindLine> = {}): GrindLine {
  return { primId, key, kind, points: [a, b], closed: false, eligible, ...extra };
}

export function grindLinesOf(p: Primitive, def: LevelDef): GrindLine[] {
  switch (p.kind) {
    case 'quarterPipe': {
      const y = (p.baseY ?? 0) + qpProfile(p).totalHeight;
      const a = facingAxisIsX(p.facing) ? { x: p.copingLine, y, z: p.span[0] } : { x: p.span[0], y, z: p.copingLine };
      const b = facingAxisIsX(p.facing) ? { x: p.copingLine, y, z: p.span[1] } : { x: p.span[1], y, z: p.copingLine };
      return [segLine(p.id, 'coping', 'coping', a, b, true, { railId: p.copingRailId })];
    }
    case 'spine': {
      const lo = p.centre - p.gapWidth / 2;
      const hi = p.centre + p.gapWidth / 2;
      const y = p.copingHeight;
      const plane: TransferPlane = { axis: p.axis === 'z' ? 'x' : 'z', at: p.centre };
      const pt = (c: number, s: number): Vec3 => (p.axis === 'z' ? { x: c, y, z: s } : { x: s, y, z: c });
      const out = [
        segLine(p.id, 'coping-lo', 'coping', pt(lo, p.span[0]), pt(lo, p.span[1]), true, { railId: p.copingRailIds[0], tags: ['transfer'], transferPlane: plane }),
        segLine(p.id, 'coping-hi', 'coping', pt(hi, p.span[0]), pt(hi, p.span[1]), true, { railId: p.copingRailIds[1], tags: ['transfer'], transferPlane: plane }),
      ];
      return out;
    }
    case 'bowl': {
      const sh = bowlShape(p);
      const pts = sh.rim.map((q) => ({ x: q.x, y: sh.rimY, z: q.z }));
      pts.push({ ...(pts[0] as Vec3) });
      return [{ primId: p.id, key: 'coping', kind: 'coping', points: pts, closed: true, eligible: true, railId: p.copingRailId }];
    }
    case 'fountain': {
      const y = (p.baseY ?? 0) + p.rimHeight;
      const n = Math.max(12, Math.round(TUNING.LEVELS_REVOLVE_SEGS));
      const pts: Vec3[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (2 * Math.PI * (i % n)) / n;
        pts.push({ x: p.centre.x + p.rimRadius * Math.cos(a), y, z: p.centre.z + p.rimRadius * Math.sin(a) });
      }
      return [{ primId: p.id, key: 'coping', kind: 'coping', points: pts, closed: true, eligible: true, railId: p.copingRailId }];
    }
    case 'channel': {
      const sh = channelShape(p);
      const core = sh.sections.filter((s) => s.core);
      const left = core.map((s) => channelPoint(s, sh.half, sh.rimY, sh.rimY));
      const right = core.map((s) => channelPoint(s, -sh.half, sh.rimY, sh.rimY));
      return [
        { primId: p.id, key: 'rim-left', kind: 'coping', points: left, closed: false, eligible: true, ...(p.rimRailIds ? { railId: p.rimRailIds[0] } : {}) },
        { primId: p.id, key: 'rim-right', kind: 'coping', points: right, closed: false, eligible: true, ...(p.rimRailIds ? { railId: p.rimRailIds[1] } : {}) },
      ];
    }
    case 'ledge': {
      const r = p.rect;
      const y = p.topY;
      const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
      const a = alongX ? { x: r.x0, y, z: (r.z0 + r.z1) / 2 } : { x: (r.x0 + r.x1) / 2, y, z: r.z0 };
      const b = alongX ? { x: r.x1, y, z: (r.z0 + r.z1) / 2 } : { x: (r.x0 + r.x1) / 2, y, z: r.z1 };
      return [segLine(p.id, 'top', 'ledge', a, b, true)];
    }
    case 'hubba': {
      const ra = rectAlong(p.rect, p.along);
      const f = facingVec(p.along);
      const mid = (ra.s0 + ra.s1) / 2;
      const P = (c: number, y: number): Vec3 => (facingAxisIsX(p.along) ? { x: c, y, z: mid } : { x: mid, y, z: c });
      const pts = [P(ra.start, p.yTop)];
      const kinkInside = (p.kinkAt - ra.start) * (f.x + f.z) > 1e-6 && (ra.end - p.kinkAt) * (f.x + f.z) > 1e-6;
      if (kinkInside) pts.push(P(p.kinkAt, p.yKink));
      pts.push(P(ra.end, kinkInside ? p.yEnd : p.yKink));
      return [{ primId: p.id, key: 'top', kind: 'ledge', points: pts, closed: false, eligible: true }];
    }
    case 'box': {
      if (!p.grindable) return [];
      const y = p.y0 + p.height;
      if (p.grindable === true) {
        const r = p.rect;
        const c = [
          { x: r.x0, y, z: r.z0 },
          { x: r.x0, y, z: r.z1 },
          { x: r.x1, y, z: r.z1 },
          { x: r.x1, y, z: r.z0 },
        ] as const;
        return [
          segLine(p.id, 'edge-west', 'ledge', c[0], c[1], true),
          segLine(p.id, 'edge-south', 'ledge', c[1], c[2], true),
          segLine(p.id, 'edge-east', 'ledge', c[2], c[3], true),
          segLine(p.id, 'edge-north', 'ledge', c[3], c[0], true),
        ];
      }
      return p.grindable.map((e, i) => segLine(p.id, `edge-${i}`, 'ledge', { x: e.a.x, y: e.a.y, z: e.a.z }, { x: e.b.x, y: e.b.y, z: e.b.z }, true));
    }
    case 'funbox': {
      // Deck edges on the sides without a ramp are grindable (funbox ledges); not a REQ-LVL-03 class,
      // so the builder's auto rail is the normal path here.
      const r = p.rect;
      const y = p.height;
      const out: GrindLine[] = [];
      const sides: { f: 'north' | 'south' | 'east' | 'west'; a: Vec3; b: Vec3 }[] = [
        { f: 'north', a: { x: r.x0, y, z: r.z0 }, b: { x: r.x1, y, z: r.z0 } },
        { f: 'south', a: { x: r.x0, y, z: r.z1 }, b: { x: r.x1, y, z: r.z1 } },
        { f: 'west', a: { x: r.x0, y, z: r.z0 }, b: { x: r.x0, y, z: r.z1 } },
        { f: 'east', a: { x: r.x1, y, z: r.z0 }, b: { x: r.x1, y, z: r.z1 } },
      ];
      for (const s of sides) if (!p.ramps.includes(s.f)) out.push(segLine(p.id, `edge-${s.f}`, 'ledge', s.a, s.b, false));
      return out;
    }
    default:
      void def;
      return [];
  }
}

/** Distance from p to a polyline. */
export function distToPolyline(p: Vec3, pts: readonly Vec3[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i] as Vec3, pts[i + 1] as Vec3));
  if (pts.length === 1) best = Math.hypot(p.x - (pts[0] as Vec3).x, p.y - (pts[0] as Vec3).y, p.z - (pts[0] as Vec3).z);
  return best;
}

export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2)) : 0;
  return { point: { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t }, t };
}

export function distToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const c = closestOnSegment(p, a, b).point;
  return Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
}

/** Points along a polyline no further apart than step (vertices included). */
export function samplePolyline(pts: readonly Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Vec3, b = pts[i + 1] as Vec3;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step - 1e-9));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = pts[pts.length - 1];
  if (last) out.push({ ...last });
  return out;
}

/** Nearest distance from p to any of the rails. */
export function distToRails(p: Vec3, rails: readonly RailDef[]): number {
  let best = Infinity;
  for (const r of rails) best = Math.min(best, distToPolyline(p, r.points));
  return best;
}
