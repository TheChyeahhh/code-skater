/**
 * src/levels/lib/context.ts (levels track): level-wide facts the per-primitive builders need:
 * - holes: sunken footprints cut out of every ground piece above them (a bowl, snake run, euro gap,
 *   lower street, curb bank, stairs down to the street, the strip under a full-pipe), as convex
 *   pieces sharing the exact rim vertices of the primitive that sinks there;
 * - occluders: footprints of everything standing on the ground, for the ground's fake contact AO;
 * - fake AO curves (REQ-REN-03).
 */

import { TUNING } from '../../core/tuning';
import type { RectXZ } from '../../core/types';
import type { LevelDef, Primitive } from '../types';
import { bowlShape, channelPoint, channelShape, pipeFrame } from './derive';
import { bboxOf, type P2, rectPoly } from './poly2d';

export interface Hole {
  readonly primId: string;
  /** Convex pieces (union = the hole). */
  readonly pieces: readonly (readonly P2[])[];
  readonly bbox: RectXZ;
  /** Lowest surface height inside the hole: ground pieces above this get cut. */
  readonly lowY: number;
}

export interface Occluder {
  readonly primId: string;
  readonly rect: RectXZ;
  readonly baseY: number;
  readonly height: number;
}

function hole(primId: string, pieces: P2[][], lowY: number): Hole {
  const all = pieces.flat();
  return { primId, pieces, bbox: bboxOf(all), lowY };
}

export function holesOf(p: Primitive): Hole | null {
  switch (p.kind) {
    case 'ground':
      return hole(p.id, [rectPoly(p.rect)], p.y);
    case 'bank':
      return hole(p.id, [rectPoly(p.rect)], Math.min(p.yLow, p.yHigh));
    case 'stairs':
      return hole(p.id, [rectPoly(p.rect)], p.topY - p.drop);
    case 'euroGap':
      return hole(p.id, [rectPoly(p.rect)], p.floorY);
    case 'bowl': {
      const sh = bowlShape(p);
      return hole(p.id, [sh.rim.map((q) => ({ x: q.x, z: q.z }))], sh.floorY);
    }
    case 'channel': {
      const sh = channelShape(p);
      const pieces: P2[][] = [];
      for (let i = 0; i + 1 < sh.sections.length; i++) {
        const a = sh.sections[i], b = sh.sections[i + 1];
        if (!a || !b) continue;
        const la = channelPoint(a, sh.half, 0, 0), ra = channelPoint(a, -sh.half, 0, 0);
        const lb = channelPoint(b, sh.half, 0, 0), rb = channelPoint(b, -sh.half, 0, 0);
        pieces.push([
          { x: la.x, z: la.z },
          { x: lb.x, z: lb.z },
          { x: rb.x, z: rb.z },
          { x: ra.x, z: ra.z },
        ]);
      }
      return hole(p.id, pieces, p.floorY);
    }
    case 'fountain': {
      // Only a basin sunk below the fountain's base cuts the ground (same ring as the basin wall).
      if (p.basinY >= (p.baseY ?? 0) - 0.01) return null;
      const n = Math.max(12, Math.round(TUNING.LEVELS_REVOLVE_SEGS));
      const r = Math.max(0.1, p.rimRadius - TUNING.LEVELS_FOUNTAIN_RIM_W_M);
      const ring: P2[] = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        ring.push({ x: p.centre.x + Math.cos(a) * r, z: p.centre.z + Math.sin(a) * r });
      }
      return hole(p.id, [ring], p.basinY);
    }
    case 'fullPipe': {
      // Strip where the outer shell dips below the ground plane under the axis.
      const f = pipeFrame(p);
      const outer = p.radius + TUNING.LEVELS_FULLPIPE_SHELL_M;
      const axisY = Math.min(p.a.y, p.b.y);
      const half = Math.sqrt(Math.max(0, outer * outer - axisY * axisY));
      if (half <= 1e-3) return null;
      const side = { x: f.e2.x, z: f.e2.z };
      const sl = Math.hypot(side.x, side.z) || 1;
      const sx = (side.x / sl) * half, sz = (side.z / sl) * half;
      return hole(p.id, [[
        { x: p.a.x + sx, z: p.a.z + sz },
        { x: p.b.x + sx, z: p.b.z + sz },
        { x: p.b.x - sx, z: p.b.z - sz },
        { x: p.a.x - sx, z: p.a.z - sz },
      ]], axisY - outer);
    }
    default:
      return null;
  }
}

export function levelHoles(def: LevelDef): Hole[] {
  const out: Hole[] = [];
  for (const p of def.primitives) {
    const h = holesOf(p);
    if (h) out.push(h);
  }
  return out;
}

export function levelOccluders(def: LevelDef): Occluder[] {
  const out: Occluder[] = [];
  for (const p of def.primitives) {
    switch (p.kind) {
      case 'box':
        out.push({ primId: p.id, rect: p.rect, baseY: p.y0, height: p.height });
        break;
      case 'building':
        out.push({ primId: p.id, rect: p.rect, baseY: p.y0 ?? 0, height: p.height });
        break;
      case 'ledge':
        out.push({ primId: p.id, rect: p.rect, baseY: p.baseY ?? 0, height: p.topY - (p.baseY ?? 0) });
        break;
      case 'hubba':
        out.push({ primId: p.id, rect: p.rect, baseY: p.baseY ?? 0, height: Math.max(p.yTop, p.yEnd) - (p.baseY ?? 0) });
        break;
      case 'billboard':
        out.push({ primId: p.id, rect: p.rect, baseY: p.y0, height: p.height });
        break;
      case 'prop':
        if (p.collidable) {
          const hx = p.size.x / 2, hz = p.size.z / 2;
          const yaw = ((p.yawDeg ?? 0) * Math.PI) / 180;
          const ex = Math.abs(Math.cos(yaw)) * hx + Math.abs(Math.sin(yaw)) * hz;
          const ez = Math.abs(Math.sin(yaw)) * hx + Math.abs(Math.cos(yaw)) * hz;
          out.push({ primId: p.id, rect: { x0: p.at.x - ex, z0: p.at.z - ez, x1: p.at.x + ex, z1: p.at.z + ez }, baseY: p.at.y, height: p.size.y });
        }
        break;
      case 'kicker':
      case 'funbox':
      case 'pyramid':
        out.push({ primId: p.id, rect: p.rect, baseY: 0, height: p.height * 0.5 });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Fake AO fade: 1 - strength x (1 - d / range)^2 for d < range (REQ-REN-03). */
export function aoFade(d: number, weight = 1): number {
  const R = TUNING.LEVELS_AO_RANGE_M;
  if (d >= R) return 1;
  const k = 1 - Math.max(0, d) / R;
  return 1 - TUNING.LEVELS_AO_STRENGTH * weight * k * k;
}

/** Contact AO on a ground vertex at height y from every occluder standing at that height. */
export function groundAo(x: number, z: number, y: number, occ: readonly Occluder[]): number {
  let ao = 1;
  const R = TUNING.LEVELS_AO_RANGE_M;
  for (const o of occ) {
    if (Math.abs(o.baseY - y) > 0.15 || o.height < 0.05) continue;
    const r = o.rect;
    if (x < r.x0 - R || x > r.x1 + R || z < r.z0 - R || z > r.z1 + R) continue;
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - z, 0, z - r.z1);
    const w = Math.min(1, o.height / 0.6);
    ao = Math.min(ao, aoFade(Math.hypot(dx, dz), w));
  }
  return ao;
}
