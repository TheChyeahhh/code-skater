/**
 * src/levels/lib/poly2d.ts (levels track): small 2D polygon helpers on the ground plane (x, z).
 * Used to cut sunken footprints (bowls, channels, euro gaps, lower ground, the full-pipe strip) out
 * of ground pieces so the ground never caps a hole, and for rounded-rectangle / offset paths that
 * the bowl, channel and their holes share vertex for vertex (no cracks between ground and rim).
 * Winding convention: counter-clockwise seen from above (+y) = signedArea > 0, i.e. (x0,z0) ->
 * (x0,z1) -> (x1,z1) -> (x1,z0) for a rectangle.
 */

import type { RectXZ } from '../../core/types';

export interface P2 {
  readonly x: number;
  readonly z: number;
}

/** Signed area, > 0 for counter-clockwise seen from above (normal +y). */
export function signedArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as P2;
    const q = poly[(i + 1) % poly.length] as P2;
    a += p.z * q.x - p.x * q.z;
  }
  return a / 2;
}

export function ccw(poly: readonly P2[]): P2[] {
  return signedArea(poly) >= 0 ? [...poly] : [...poly].reverse();
}

export function rectPoly(r: RectXZ): P2[] {
  return [
    { x: r.x0, z: r.z0 },
    { x: r.x0, z: r.z1 },
    { x: r.x1, z: r.z1 },
    { x: r.x1, z: r.z0 },
  ];
}

/** Side of p relative to the directed edge a -> b for a CCW polygon: > 0 = inside. */
function side(a: P2, b: P2, p: P2): number {
  // For CCW (from above) polygons with our area sign, the interior is where this is > 0.
  return (b.z - a.z) * (p.x - a.x) - (b.x - a.x) * (p.z - a.z);
}

/** Keep the part of a convex polygon on the side where sign * side(a, b, p) >= 0. */
function clip(poly: readonly P2[], a: P2, b: P2, sign: 1 | -1): P2[] {
  const out: P2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i] as P2;
    const q = poly[(i + 1) % n] as P2;
    const sp = sign * side(a, b, p);
    const sq = sign * side(a, b, q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return dedupe(out);
}

function dedupe(poly: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.z - p.z) > 1e-9) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(last.x - first.x) <= 1e-9 && Math.abs(last.z - first.z) <= 1e-9) out.pop();
  return out;
}

const MIN_PIECE_AREA = 1e-7;

/** Convex polygon minus a convex hole: convex pieces covering the difference. */
export function subtractConvex(poly: readonly P2[], hole: readonly P2[]): P2[][] {
  const h = ccw(hole);
  if (!bboxOverlap(poly, h)) return [[...poly]];
  const pieces: P2[][] = [];
  let rest: P2[] = [...poly];
  for (let i = 0; i < h.length && rest.length >= 3; i++) {
    const a = h[i] as P2;
    const b = h[(i + 1) % h.length] as P2;
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-9) continue;
    const outside = clip(rest, a, b, -1);
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > MIN_PIECE_AREA) pieces.push(outside);
    rest = clip(rest, a, b, 1);
  }
  return pieces;
}

/** Convex polygon minus a union of convex holes. */
export function subtractAll(poly: readonly P2[], holes: readonly (readonly P2[])[]): P2[][] {
  let pieces: P2[][] = [[...poly]];
  for (const hole of holes) {
    const next: P2[][] = [];
    for (const p of pieces) next.push(...subtractConvex(p, hole));
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}

export function bboxOf(poly: readonly P2[]): RectXZ {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.x > x1) x1 = p.x;
    if (p.z > z1) z1 = p.z;
  }
  return { x0, z0, x1, z1 };
}

export function rectsOverlap(a: RectXZ, b: RectXZ, eps = 1e-9): boolean {
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;
}

function bboxOverlap(a: readonly P2[], b: readonly P2[]): boolean {
  return rectsOverlap(bboxOf(a), bboxOf(b));
}

/** Distance from p to a rectangle (0 inside). */
export function distToRect(p: P2, r: RectXZ): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dz = Math.max(r.z0 - p.z, 0, p.z - r.z1);
  return Math.hypot(dx, dz);
}

export interface PathPoint extends P2 {
  /** Unit inward normal (toward the enclosed area) at this point. */
  readonly nx: number;
  readonly nz: number;
}

/**
 * Rounded rectangle path, CCW from above, starting at the north-west corner arc. Each corner
 * contributes segs + 1 points on its arc (coincident when r = 0); straight edges are split so no
 * piece is longer than maxLen. The first point is NOT repeated at the end.
 */
export function roundedRectPath(rect: RectXZ, radius: number, segs: number, maxLen: number): PathPoint[] {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const r = Math.max(0, Math.min(radius, w / 2, d / 2));
  // Corner centres in CCW order (from above): NW -> SW -> SE -> NE, i.e. down the west edge first.
  // a0 = the arrival angle of the arc (point = centre + r (cos a, sin a) in (x, z)); each arc turns
  // from a0 to a0 - PI/2 (CCW from above is a DEcreasing angle here, since +z is south).
  const corners = [
    { cx: rect.x0 + r, cz: rect.z0 + r, a0: -Math.PI / 2 },
    { cx: rect.x0 + r, cz: rect.z1 - r, a0: Math.PI },
    { cx: rect.x1 - r, cz: rect.z1 - r, a0: Math.PI / 2 },
    { cx: rect.x1 - r, cz: rect.z0 + r, a0: 0 },
  ];
  const out: PathPoint[] = [];
  for (let c = 0; c < 4; c++) {
    const k = corners[c] as { cx: number; cz: number; a0: number };
    for (let i = 0; i <= segs; i++) {
      const a = k.a0 - (Math.PI / 2) * (i / segs);
      const ca = Math.cos(a), sa = Math.sin(a);
      out.push({ x: k.cx + r * ca, z: k.cz + r * sa, nx: -ca, nz: -sa });
    }
    // Straight edge to the next corner's first point.
    const next = corners[(c + 1) % 4] as { cx: number; cz: number; a0: number };
    const last = out[out.length - 1] as PathPoint;
    const nxt = { x: next.cx + r * Math.cos(next.a0), z: next.cz + r * Math.sin(next.a0) };
    const len = Math.hypot(nxt.x - last.x, nxt.z - last.z);
    const pieces = Math.max(1, Math.ceil(len / maxLen - 1e-9));
    for (let i = 1; i < pieces; i++) {
      const t = i / pieces;
      out.push({ x: last.x + (nxt.x - last.x) * t, z: last.z + (nxt.z - last.z) * t, nx: last.nx, nz: last.nz });
    }
  }
  return out;
}

/** Polyline left normal of a travel direction (dx, dz): facing along it, left = (dz, -dx). */
export function leftOf(dx: number, dz: number): P2 {
  return { x: dz, z: -dx };
}

export interface OffsetFrame extends P2 {
  /** Unit tangent. */
  readonly tx: number;
  readonly tz: number;
  /** Mitre vector: offset o to the LEFT lands at (x + mx o, z + mz o). */
  readonly mx: number;
  readonly mz: number;
}

/** Mitred offset frames along an open polyline (mitre scale capped at 4). */
export function offsetFrames(pts: readonly P2[]): OffsetFrame[] {
  const n = pts.length;
  const out: OffsetFrame[] = [];
  const dirs: P2[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[i] as P2, b = pts[i + 1] as P2;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    dirs.push({ x: (b.x - a.x) / l, z: (b.z - a.z) / l });
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i] as P2;
    const d0 = dirs[Math.max(0, i - 1)] as P2;
    const d1 = dirs[Math.min(dirs.length - 1, i)] as P2;
    const l0 = leftOf(d0.x, d0.z);
    const l1 = leftOf(d1.x, d1.z);
    let mx = l0.x + l1.x, mz = l0.z + l1.z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = mx * l1.x + mz * l1.z;
    const scale = Math.min(4, 1 / Math.max(0.25, cos));
    const tx = d0.x + d1.x, tz = d0.z + d1.z;
    const tl = Math.hypot(tx, tz) || 1;
    out.push({ x: p.x, z: p.z, tx: tx / tl, tz: tz / tl, mx: mx * scale, mz: mz * scale });
  }
  return out;
}

export function pointInConvex(p: P2, poly: readonly P2[]): boolean {
  const h = ccw(poly);
  for (let i = 0; i < h.length; i++) if (side(h[i] as P2, h[(i + 1) % h.length] as P2, p) < -1e-9) return false;
  return true;
}

/** Intersection of a convex polygon (any winding) with an axis-aligned rectangle; [] when empty. */
export function clipConvexToRect(poly: readonly P2[], r: RectXZ): P2[] {
  let out = ccw(poly);
  const rect = rectPoly(r);
  for (let i = 0; i < rect.length && out.length >= 3; i++) {
    out = clip(out, rect[i] as P2, rect[(i + 1) % rect.length] as P2, 1);
  }
  return out.length >= 3 && Math.abs(signedArea(out)) > MIN_PIECE_AREA ? out : [];
}

/** Distance from a point inside a convex polygon to its nearest edge (0 on or outside the boundary). */
export function distToConvexEdge(p: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as P2;
    const b = poly[(i + 1) % poly.length] as P2;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}
