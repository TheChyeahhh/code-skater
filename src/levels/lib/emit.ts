/**
 * src/levels/lib/emit.ts (levels track): the few shape emitters every primitive is written with.
 * Every emitter writes the render batch AND the collider from the same points (REQ-LVL-01), and
 * orients each face by an expected outward / rideable normal, so winding bugs cannot flip a face.
 *
 * UVs are world-space metres (REQ-MAT-01: plywood seams every 2.4 m line up across primitives):
 * up-facing planar faces map (x, z); other planar faces map (horizontal tangent, height-ish);
 * curved surfaces pass arc-length UVs from their profile.
 */

import { cross3, dot3, len3, norm3, sub3 } from '../../core/math';
import type { SurfaceTag, Vec3 } from '../../core/types';
import type { MaterialId } from '../types';
import { DEGENERATE_AREA2, type LevelSink, type PartRole, triArea2 } from './mesh';

export interface EmitStyle {
  readonly surfaceId: string;
  readonly material: MaterialId;
  readonly role: PartRole;
  readonly tag: SurfaceTag;
  /** Default true. */
  readonly render?: boolean;
  /** Default true. */
  readonly collide?: boolean;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** Keep this part separate (sign faces): the part's surfaceId. */
  readonly ownPart?: boolean;
}

export type AoFn = (p: Vec3) => number;

const UP: Vec3 = { x: 0, y: 1, z: 0 };

export function withStyle(s: EmitStyle, patch: Partial<EmitStyle>): EmitStyle {
  return { ...s, ...patch };
}

function batchOf(sink: LevelSink, s: EmitStyle) {
  return sink.batch({
    material: s.material,
    role: s.role,
    castShadow: s.castShadow ?? true,
    receiveShadow: s.receiveShadow ?? true,
    ...(s.ownPart ? { surfaceId: s.surfaceId } : {}),
  });
}

/** Newell normal of a polygon (unnormalised). */
export function newell(pts: readonly Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Vec3;
    const b = pts[(i + 1) % pts.length] as Vec3;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

/** World-metre planar UV for a point on a face with normal n. */
export function planarUv(p: Vec3, n: Vec3): [number, number] {
  if (Math.abs(n.y) > 0.7) return [p.x, p.z];
  const t = norm3(cross3(UP, n));
  const b = cross3(n, t);
  return [dot3(p, t), dot3(p, b)];
}

/**
 * Convex planar polygon (any winding; oriented to face `expected`). Fan-triangulated.
 * ao: a function of the point, or one value per point. uvs: one pair per point, else planar.
 */
export function face(
  sink: LevelSink,
  s: EmitStyle,
  input: readonly Vec3[],
  expected: Vec3,
  opts: { readonly ao?: AoFn | readonly number[]; readonly uvs?: readonly (readonly [number, number])[] } = {},
): void {
  if (input.length < 3) return;
  let pts = input;
  let aoList = Array.isArray(opts.ao) ? (opts.ao as readonly number[]) : null;
  let uvList = opts.uvs ?? null;
  let nn = newell(pts);
  if (len3(nn) < DEGENERATE_AREA2) return;
  if (dot3(nn, expected) < 0) {
    pts = [...pts].reverse();
    if (aoList) aoList = [...aoList].reverse();
    if (uvList) uvList = [...uvList].reverse();
    nn = { x: -nn.x, y: -nn.y, z: -nn.z };
  }
  const n = norm3(nn);
  const aoFn = typeof opts.ao === 'function' ? opts.ao : null;
  if (s.render !== false) {
    const b = batchOf(sink, s);
    const idx = pts.map((p, i) => {
      const uv = uvList?.[i] ?? planarUv(p, n);
      const ao = aoList ? (aoList[i] ?? 1) : aoFn ? aoFn(p) : 1;
      sink.bound(s.surfaceId, p);
      return b.vertex(p, n, uv[0], uv[1], ao);
    });
    for (let i = 1; i + 1 < idx.length; i++) {
      const a = pts[0] as Vec3, bb = pts[i] as Vec3, c = pts[i + 1] as Vec3;
      if (triArea2(a, bb, c) < DEGENERATE_AREA2) continue;
      b.tri(idx[0] as number, idx[i] as number, idx[i + 1] as number);
    }
  }
  if (s.collide !== false) {
    for (let i = 1; i + 1 < pts.length; i++) sink.colTri(s.surfaceId, s.tag, pts[0] as Vec3, pts[i] as Vec3, pts[i + 1] as Vec3);
  }
}

export interface GridOpts {
  /** Analytic unit normals per vertex (curved surfaces). Else smooth normals from the cells. */
  readonly normals?: readonly (readonly Vec3[])[];
  /** Expected outward direction when no normals are given. */
  readonly expected?: Vec3;
  readonly uv?: (i: number, j: number, p: Vec3) => readonly [number, number];
  readonly ao?: (i: number, j: number, p: Vec3) => number;
  /** Per-cell collider tag override (cell i, j = between rows i, i+1 and columns j, j+1). */
  readonly tagAt?: (i: number, j: number) => SurfaceTag;
}

/**
 * Structured surface: rows[i][j], all rows the same length. Each cell is two triangles oriented to
 * the expected normal (analytic when given). Render vertices are shared (smooth shading).
 */
export function grid(sink: LevelSink, s: EmitStyle, rows: readonly (readonly Vec3[])[], opts: GridOpts): void {
  const ni = rows.length;
  const nj = rows[0]?.length ?? 0;
  if (ni < 2 || nj < 2) return;
  const P = (i: number, j: number): Vec3 => (rows[i] as readonly Vec3[])[j] as Vec3;
  // Cell normals oriented to the expected direction.
  const cellN: Vec3[][] = [];
  const flip: boolean[][] = [];
  for (let i = 0; i + 1 < ni; i++) {
    const rowN: Vec3[] = [];
    const rowF: boolean[] = [];
    for (let j = 0; j + 1 < nj; j++) {
      const q = [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)];
      const nn = newell(q);
      let exp = opts.expected ?? UP;
      if (opts.normals) {
        const nr = opts.normals;
        const a = (nr[i] as readonly Vec3[])[j] as Vec3;
        const b = (nr[i] as readonly Vec3[])[j + 1] as Vec3;
        const c = (nr[i + 1] as readonly Vec3[])[j + 1] as Vec3;
        const d = (nr[i + 1] as readonly Vec3[])[j] as Vec3;
        exp = { x: a.x + b.x + c.x + d.x, y: a.y + b.y + c.y + d.y, z: a.z + b.z + c.z + d.z };
      }
      const f = dot3(nn, exp) < 0;
      rowF.push(f);
      rowN.push(f ? { x: -nn.x, y: -nn.y, z: -nn.z } : nn);
    }
    cellN.push(rowN);
    flip.push(rowF);
  }
  if (s.render !== false) {
    const b = batchOf(sink, s);
    const idx: number[][] = [];
    for (let i = 0; i < ni; i++) {
      const r: number[] = [];
      for (let j = 0; j < nj; j++) {
        const p = P(i, j);
        let n: Vec3;
        if (opts.normals) n = (opts.normals[i] as readonly Vec3[])[j] as Vec3;
        else {
          let x = 0, y = 0, z = 0;
          for (const [ci, cj] of [[i - 1, j - 1], [i - 1, j], [i, j - 1], [i, j]] as const) {
            const c = cellN[ci]?.[cj];
            if (c) {
              x += c.x;
              y += c.y;
              z += c.z;
            }
          }
          n = norm3({ x, y, z });
          if (len3(n) === 0) n = opts.expected ?? UP;
        }
        const uv = opts.uv ? opts.uv(i, j, p) : planarUv(p, n);
        const ao = opts.ao ? opts.ao(i, j, p) : 1;
        sink.bound(s.surfaceId, p);
        r.push(b.vertex(p, n, uv[0], uv[1], ao));
      }
      idx.push(r);
    }
    for (let i = 0; i + 1 < ni; i++) {
      for (let j = 0; j + 1 < nj; j++) {
        const a = (idx[i] as number[])[j] as number;
        const bb = (idx[i] as number[])[j + 1] as number;
        const c = (idx[i + 1] as number[])[j + 1] as number;
        const d = (idx[i + 1] as number[])[j] as number;
        const pa = P(i, j), pb = P(i, j + 1), pc = P(i + 1, j + 1), pd = P(i + 1, j);
        const f = (flip[i] as boolean[])[j];
        // Newell over (a, b, c, d) is the non-flipped winding: triangles (a, b, c), (a, c, d).
        if (!f) {
          if (triArea2(pa, pb, pc) >= DEGENERATE_AREA2) b.tri(a, bb, c);
          if (triArea2(pa, pc, pd) >= DEGENERATE_AREA2) b.tri(a, c, d);
        } else {
          if (triArea2(pa, pc, pb) >= DEGENERATE_AREA2) b.tri(a, c, bb);
          if (triArea2(pa, pd, pc) >= DEGENERATE_AREA2) b.tri(a, d, c);
        }
      }
    }
  }
  if (s.collide !== false) {
    for (let i = 0; i + 1 < ni; i++) {
      for (let j = 0; j + 1 < nj; j++) {
        const tag = opts.tagAt ? opts.tagAt(i, j) : s.tag;
        const pa = P(i, j), pb = P(i, j + 1), pc = P(i + 1, j + 1), pd = P(i + 1, j);
        if (!(flip[i] as boolean[])[j]) {
          sink.colTri(s.surfaceId, tag, pa, pb, pc);
          sink.colTri(s.surfaceId, tag, pa, pc, pd);
        } else {
          sink.colTri(s.surfaceId, tag, pa, pc, pb);
          sink.colTri(s.surfaceId, tag, pa, pd, pc);
        }
      }
    }
  }
}

/** Split [a, b] into equal pieces no longer than maxLen (at least one piece). Returns the n+1 cut points. */
export function splitRange(a: number, b: number, maxLen: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / Math.max(1e-6, maxLen) - 1e-9));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

/** Height cuts for a vertical wall so the fake AO darkens its base only (REQ-REN-03). */
export function wallCuts(y0: number, y1: number, maxLen: number): number[] {
  const cuts = new Set<number>([y0, y1]);
  for (const h of [0.35, 1.2]) if (y0 + h < y1 - 0.05) cuts.add(y0 + h);
  const sorted = [...cuts].sort((p, q) => p - q);
  const out: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const seg = splitRange(sorted[i] as number, sorted[i + 1] as number, maxLen);
    if (i > 0) seg.shift();
    out.push(...seg);
  }
  return out;
}

/**
 * Vertical wall along the ground segment a -> b (a.y / b.y ignored) from y0 to y1, facing `out`.
 * Split vertically at the AO cuts and horizontally at maxLen.
 */
export function wall(
  sink: LevelSink,
  s: EmitStyle,
  a: { x: number; z: number },
  b: { x: number; z: number },
  y0: number,
  y1: number,
  out: Vec3,
  maxLen: number,
  ao: (heightAboveBase: number) => number,
): void {
  if (y1 - y0 < 1e-6) return;
  const hs = wallCuts(y0, y1, maxLen);
  const ts = splitRange(0, 1, maxLen / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z)));
  const rows = hs.map((y) => ts.map((t) => ({ x: a.x + (b.x - a.x) * t, y, z: a.z + (b.z - a.z) * t })));
  grid(sink, s, rows, { expected: out, ao: (i) => ao((hs[i] as number) - y0) });
}

/** Closed tube along a polyline (rail and coping pipes, posts). Render only unless style says otherwise. */
export function tube(
  sink: LevelSink,
  s: EmitStyle,
  pts: readonly Vec3[],
  radius: number,
  segs: number,
  closed: boolean,
): void {
  const n = pts.length;
  if (n < 2) return;
  // Parallel-transport frames along the polyline.
  const tangents: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n - 1) % (n - 1)] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % (n - 1)] : pts[Math.min(n - 1, i + 1)];
    let t = norm3(sub3(next as Vec3, prev as Vec3));
    if (len3(t) === 0) t = { x: 1, y: 0, z: 0 };
    tangents.push(t);
  }
  const t0 = tangents[0] as Vec3;
  let ref: Vec3 = Math.abs(t0.y) < 0.9 ? UP : { x: 1, y: 0, z: 0 };
  let nrm = norm3(cross3(cross3(t0, ref), t0));
  const rings: Vec3[][] = [];
  const normals: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    const t = tangents[i] as Vec3;
    // Re-project the previous normal onto the plane of this tangent.
    const d = dot3(nrm, t);
    nrm = norm3({ x: nrm.x - t.x * d, y: nrm.y - t.y * d, z: nrm.z - t.z * d });
    if (len3(nrm) === 0) {
      ref = Math.abs(t.y) < 0.9 ? UP : { x: 1, y: 0, z: 0 };
      nrm = norm3(cross3(cross3(t, ref), t));
    }
    const bin = cross3(t, nrm);
    const p = pts[i] as Vec3;
    const ring: Vec3[] = [];
    const rn: Vec3[] = [];
    for (let k = 0; k <= segs; k++) {
      const a = (2 * Math.PI * k) / segs;
      const c = Math.cos(a), sn = Math.sin(a);
      const dir = { x: nrm.x * c + bin.x * sn, y: nrm.y * c + bin.y * sn, z: nrm.z * c + bin.z * sn };
      ring.push({ x: p.x + dir.x * radius, y: p.y + dir.y * radius, z: p.z + dir.z * radius });
      rn.push(dir);
    }
    rings.push(ring);
    normals.push(rn);
  }
  let along = 0;
  const alongAt: number[] = [0];
  for (let i = 1; i < n; i++) {
    along += len3(sub3(pts[i] as Vec3, pts[i - 1] as Vec3));
    alongAt.push(along);
  }
  grid(sink, s, rings, {
    normals,
    uv: (i, j) => [alongAt[i] as number, (j / segs) * 2 * Math.PI * radius],
  });
  if (!closed) {
    const cap = (i: number, dir: Vec3): void => face(sink, s, (rings[i] as Vec3[]).slice(0, segs), dir);
    const ta = tangents[0] as Vec3;
    cap(0, { x: -ta.x, y: -ta.y, z: -ta.z });
    cap(n - 1, tangents[n - 1] as Vec3);
  }
}
