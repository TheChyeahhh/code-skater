/**
 * src/levels/primitives/transitions.ts (levels track): the curved, rideable primitives (REQ-LVL-09):
 * quarter-pipe, spine, bowl, fountain, full-pipe and channel (snake run). Every curved face is
 * built from the shared profile in lib/derive.ts at LEVELS_ARC_SEG_DEG per facet, with analytic
 * outward (rideable side) normals, and tagged "transition" in the collider; flat decks, rims,
 * floors and the solid bodies behind the faces stay "solid".
 *
 * Coping pipes are NOT drawn here: the builder draws one for every coping rail (types.ts rule).
 */

import { TUNING } from '../../core/tuning';
import type { Facing, Vec3 } from '../../core/types';
import type { BowlPrim, ChannelPrim, FountainPrim, FullPipePrim, QuarterPipePrim, SpinePrim } from '../types';
import { aoFade } from '../lib/context';
import { bowlShape, channelPoint, channelShape, facingAxisIsX, facingVec, lineFrame, pipeFrame, type Profile, qpProfile, transitionProfile, UP } from '../lib/derive';
import { type EmitStyle, face, grid, splitRange, withStyle } from '../lib/emit';
import { clipConvexToRect, distToConvexEdge, type P2 } from '../lib/poly2d';
import { type PrimCtx, styleOf, wallAo } from './common';

const opposite: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' };

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Fake AO along a transition face: darker toward its foot (the concave corner with the floor). */
function footAo(arcFromFoot: number): number {
  return aoFade(arcFromFoot * 1.5, 0.6);
}

/**
 * One straight transition face: the profile swept along a coping line.
 * - facing: direction from the coping line toward the foot (the rider's approach side).
 * - copingLine: coordinate of the coping on the facing axis; span: extent on the other axis.
 * Emits the curved face (transition) and the two end walls of the profile (solid). Returns the
 * profile used, so callers can close the body behind it.
 */
function sweptFace(
  ctx: PrimCtx,
  surf: EmitStyle,
  side: EmitStyle,
  facing: Facing,
  copingLine: number,
  span: readonly [number, number],
  base: number,
  prof: Profile,
): void {
  const W = lineFrame(facing, copingLine);
  const f = facingVec(facing);
  const s0 = Math.min(span[0], span[1]);
  const s1 = Math.max(span[0], span[1]);
  const ss = splitRange(s0, s1, TUNING.LEVELS_MAX_SEG_M);
  const pts = prof.points;
  const rows = pts.map((q) => ss.map((s) => W(q.u, s, base + q.h)));
  const normals = pts.map((q) => ss.map(() => unit({ x: f.x * q.nu, y: q.nh, z: f.z * q.nu })));
  // World UVs continuous with the floor at the foot: the facing-axis coordinate runs on from the
  // foot line by arc length, the span axis is the world coordinate (seams line up, REQ-MAT-01).
  const foot = copingLine + (f.x + f.z) * prof.run;
  const sgn = f.x + f.z;
  grid(ctx.sink, surf, rows, {
    normals,
    uv: (i, _j, p) => {
      const along = foot - sgn * (pts[i] as { s: number }).s;
      return facingAxisIsX(facing) ? [along, p.z] : [p.x, along];
    },
    ao: (i) => footAo((pts[i] as { s: number }).s),
  });
  // End walls: one convex trapezoid per profile step, from the curve down to the base.
  for (const [s, sgn] of [[s0, -1], [s1, 1]] as const) {
    const out = facingAxisIsX(facing) ? { x: 0, y: 0, z: sgn } : { x: sgn, y: 0, z: 0 };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as { u: number; h: number };
      const b = pts[i + 1] as { u: number; h: number };
      if (Math.abs(a.u - b.u) < 1e-6) continue;
      face(ctx.sink, side, [W(a.u, s, base), W(b.u, s, base), W(b.u, s, base + b.h), W(a.u, s, base + a.h)], out, {
        ao: (p) => wallAo(p.y - base),
      });
    }
  }
}

/** Flat deck (or coping cap) behind a coping line from u = 0 back to u = -depth, with its back wall and end walls. */
function deckBehind(
  ctx: PrimCtx,
  top: EmitStyle,
  side: EmitStyle,
  facing: Facing,
  copingLine: number,
  span: readonly [number, number],
  base: number,
  height: number,
  depth: number,
  backWall: boolean,
): void {
  const W = lineFrame(facing, copingLine);
  const f = facingVec(facing);
  const s0 = Math.min(span[0], span[1]);
  const s1 = Math.max(span[0], span[1]);
  const y = base + height;
  if (depth > 1e-6) {
    const us = splitRange(0, -depth, TUNING.LEVELS_MAX_SEG_M);
    const ss = splitRange(s0, s1, TUNING.LEVELS_MAX_SEG_M);
    grid(ctx.sink, top, us.map((u) => ss.map((s) => W(u, s, y))), { expected: UP });
    for (const [s, sgn] of [[s0, -1], [s1, 1]] as const) {
      const out = facingAxisIsX(facing) ? { x: 0, y: 0, z: sgn } : { x: sgn, y: 0, z: 0 };
      face(ctx.sink, side, [W(0, s, base), W(-depth, s, base), W(-depth, s, y), W(0, s, y)], out, { ao: (p) => wallAo(p.y - base) });
    }
  }
  if (backWall) {
    const back = { x: -f.x, y: 0, z: -f.z };
    const a = W(-depth, s0, 0), b = W(-depth, s1, 0);
    const hs = splitRange(base, y, TUNING.LEVELS_MAX_SEG_M);
    const ss = splitRange(0, 1, TUNING.LEVELS_MAX_SEG_M / Math.max(1e-6, s1 - s0));
    grid(ctx.sink, side, hs.map((hy) => ss.map((t) => ({ x: a.x + (b.x - a.x) * t, y: hy, z: a.z + (b.z - a.z) * t }))), {
      expected: back,
      ao: (i) => wallAo((hs[i] as number) - base),
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Quarter-pipe
// ---------------------------------------------------------------------------------------------

export function buildQuarterPipe(p: QuarterPipePrim, ctx: PrimCtx): void {
  const base = p.baseY ?? 0;
  const prof = qpProfile(p);
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const deck = styleOf(p, ctx, 'surface', 'solid');
  sweptFace(ctx, surf, side, p.facing, p.copingLine, p.span, base, prof);
  deckBehind(ctx, deck, side, p.facing, p.copingLine, p.span, base, prof.totalHeight, p.deckDepth ?? 0, true);
}

// ---------------------------------------------------------------------------------------------
// Spine: two quarter-pipe faces back to back with a flat deck of gapWidth between the copings
// ---------------------------------------------------------------------------------------------

export function buildSpine(p: SpinePrim, ctx: PrimCtx): void {
  const prof = transitionProfile(p.copingHeight, p.radius, 0);
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const deck = styleOf(p, ctx, 'surface', 'solid');
  const lo = p.centre - p.gapWidth / 2;
  const hi = p.centre + p.gapWidth / 2;
  const loFacing: Facing = p.axis === 'z' ? 'west' : 'north';
  sweptFace(ctx, surf, side, loFacing, lo, p.span, 0, prof);
  sweptFace(ctx, surf, side, opposite[loFacing], hi, p.span, 0, prof);
  // Deck between the copings: from the high coping back toward the low one.
  deckBehind(ctx, deck, side, opposite[loFacing], hi, p.span, 0, prof.totalHeight, hi - lo, false);
}

// ---------------------------------------------------------------------------------------------
// Bowl: rounded-rectangle pool below the rim, walls from the shared profile, flat floor
// ---------------------------------------------------------------------------------------------

export function buildBowl(p: BowlPrim, ctx: PrimCtx): void {
  const sh = bowlShape(p);
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const floorStyle = styleOf(p, ctx, 'surface', 'solid');
  const pts = sh.profile.points;
  const rim = [...sh.rim, sh.rim[0] as (typeof sh.rim)[number]];
  // Rim arc length for UVs (world metres around the wall).
  const around: number[] = [0];
  for (let k = 1; k < rim.length; k++) {
    const a = rim[k - 1] as P2, b = rim[k] as P2;
    around.push((around[k - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const rows = pts.map((q) => rim.map((r) => ({ x: r.x + r.nx * q.u, y: sh.floorY + q.h, z: r.z + r.nz * q.u })));
  const normals = pts.map((q) => rim.map((r) => unit({ x: r.nx * q.nu, y: q.nh, z: r.nz * q.nu })));
  grid(ctx.sink, surf, rows, {
    normals,
    uv: (i, j) => [around[j] as number, (pts[i] as { s: number }).s],
    ao: (i) => footAo((pts[i] as { s: number }).s),
  });
  // Floor: the wall feet ring (convex), cut into cells so collider triangles stay small.
  const foot = rows[0] as Vec3[];
  const floorPoly: P2[] = foot.slice(0, -1).map((q) => ({ x: q.x, z: q.z }));
  floorCells(ctx, floorStyle, floorPoly, sh.floorY);
}

/**
 * A flat convex floor at height y whose boundary is the foot row of a surrounding wall.
 * Render: concentric rings scaled toward the centroid, so the outer ring IS the wall's foot row
 * (no T-junction cracks) and the AO can darken the edge. Collider: the polygon cut into cells.
 */
function floorCells(ctx: PrimCtx, s: EmitStyle, poly: readonly P2[], y: number): void {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, cx = 0, cz = 0;
  for (const q of poly) {
    x0 = Math.min(x0, q.x);
    z0 = Math.min(z0, q.z);
    x1 = Math.max(x1, q.x);
    z1 = Math.max(z1, q.z);
    cx += q.x / poly.length;
    cz += q.z / poly.length;
  }
  if (!(x1 > x0 && z1 > z0)) return;
  const halfSpan = Math.min(x1 - x0, z1 - z0) / 2;
  const R = TUNING.LEVELS_AO_RANGE_M;
  // Ring scales: dense near the edge (AO fades over LEVELS_AO_RANGE_M), then coarse to the centre.
  const scales = [1];
  for (const d of [0.15, 0.4, 0.8, 1.2].map((k) => k * R)) if (d < halfSpan * 0.9) scales.push(1 - d / halfSpan);
  for (let k = 0.5; k > 0.01; k -= 0.25) if (k < (scales[scales.length - 1] as number) - 0.05) scales.push(k);
  scales.push(0.001);
  const ring = [...poly, poly[0] as P2];
  const rows = scales.map((k) => ring.map((q) => ({ x: cx + (q.x - cx) * k, y, z: cz + (q.z - cz) * k })));
  grid(ctx.sink, withStyle(s, { collide: false }), rows, {
    expected: UP,
    uv: (_i, _j, p) => [p.x, p.z],
    ao: (_i, _j, p) => aoFade(distToConvexEdge({ x: p.x, z: p.z }, poly) * 1.5, 0.7),
  });
  const xs = splitRange(x0, x1, TUNING.LEVELS_COLLIDER_CELL_M);
  const zs = splitRange(z0, z1, TUNING.LEVELS_COLLIDER_CELL_M);
  const col = withStyle(s, { render: false });
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const piece = clipConvexToRect(poly, { x0: xs[i] as number, x1: xs[i + 1] as number, z0: zs[j] as number, z1: zs[j + 1] as number });
      if (piece.length >= 3) face(ctx.sink, col, piece.map((q) => ({ x: q.x, y, z: q.z })), UP);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fountain / mini-vert: outer transition face, flat rim, inner basin wall, basin floor
// ---------------------------------------------------------------------------------------------

export function buildFountain(p: FountainPrim, ctx: PrimCtx): void {
  const base = p.baseY ?? 0;
  const prof = transitionProfile(p.rimHeight, p.faceRadius, Math.max(0, p.rimHeight - p.faceRadius));
  const n = Math.max(12, Math.round(TUNING.LEVELS_REVOLVE_SEGS));
  const angles = Array.from({ length: n + 1 }, (_, i) => (2 * Math.PI * (i % n)) / n);
  const c = p.centre;
  const dirAt = (a: number): P2 => ({ x: Math.cos(a), z: Math.sin(a) });
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const solid = styleOf(p, ctx, 'surface', 'solid');
  const wallS = styleOf(p, ctx, 'wall', 'solid');
  const pts = prof.points;
  // Outer face: profile u runs from the coping (rimRadius) outward toward the foot.
  const rows = pts.map((q) => angles.map((a) => {
    const d = dirAt(a);
    const r = p.rimRadius + q.u;
    return { x: c.x + d.x * r, y: base + q.h, z: c.z + d.z * r };
  }));
  const normals = pts.map((q) => angles.map((a) => {
    const d = dirAt(a);
    return unit({ x: d.x * q.nu, y: q.nh, z: d.z * q.nu });
  }));
  grid(ctx.sink, surf, rows, {
    normals,
    uv: (i, j) => [(angles[j] as number) * p.rimRadius + (j === n ? 2 * Math.PI * p.rimRadius : 0), (pts[i] as { s: number }).s],
    ao: (i) => footAo((pts[i] as { s: number }).s),
  });
  const top = base + prof.totalHeight;
  const inner = Math.max(0.1, p.rimRadius - TUNING.LEVELS_FOUNTAIN_RIM_W_M);
  const ring = (r: number, y: number): Vec3[] => angles.map((a) => ({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r }));
  // Flat rim top.
  grid(ctx.sink, solid, [ring(p.rimRadius, top), ring(inner, top)], { expected: UP });
  // Inner basin wall facing the centre, from the rim down to the basin floor.
  const basin = p.basinY;
  if (top - basin > 1e-3) {
    const hs = splitRange(basin, top, TUNING.LEVELS_MAX_SEG_M);
    const wallRows = hs.map((y) => ring(inner, y));
    const wallNormals = hs.map(() => angles.map((a) => ({ x: -Math.cos(a), y: 0, z: -Math.sin(a) })));
    grid(ctx.sink, wallS, wallRows, { normals: wallNormals, ao: (i) => wallAo((hs[i] as number) - basin) });
  }
  // Basin floor (rideable flat; the water decal sits on it).
  const disc: P2[] = angles.slice(0, n).map((a) => ({ x: c.x + Math.cos(a) * inner, z: c.z + Math.sin(a) * inner }));
  floorCells(ctx, solid, disc, basin);
}

// ---------------------------------------------------------------------------------------------
// Full-pipe: inner cylinder (transition), outer shell (solid), end rings
// ---------------------------------------------------------------------------------------------

export function buildFullPipe(p: FullPipePrim, ctx: PrimCtx): void {
  const fr = pipeFrame(p);
  const n = Math.max(12, Math.round(TUNING.LEVELS_REVOLVE_SEGS));
  const ts = splitRange(0, 1, TUNING.LEVELS_MAX_SEG_M / fr.length);
  const R = p.radius;
  const Ro = R + TUNING.LEVELS_FULLPIPE_SHELL_M;
  // theta 0 = bottom of the pipe, +-PI = top (the texture seam sits on the ceiling); dir = -e1 cos + e2 sin.
  const thAt = (k: number): number => -Math.PI + (2 * Math.PI * k) / n;
  const dirAt = (k: number): Vec3 => {
    const th = thAt(k);
    const cs = Math.cos(th), sn = Math.sin(th);
    return { x: -fr.e1.x * cs + fr.e2.x * sn, y: -fr.e1.y * cs + fr.e2.y * sn, z: -fr.e1.z * cs + fr.e2.z * sn };
  };
  const axis = (t: number): Vec3 => ({ x: fr.a.x + (fr.b.x - fr.a.x) * t, y: fr.a.y + (fr.b.y - fr.a.y) * t, z: fr.a.z + (fr.b.z - fr.a.z) * t });
  const ks = Array.from({ length: n + 1 }, (_, k) => k);
  const at = (t: number, k: number, r: number): Vec3 => {
    const o = axis(t), d = dirAt(k);
    return { x: o.x + d.x * r, y: o.y + d.y * r, z: o.z + d.z * r };
  };
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const shell = styleOf(p, ctx, 'wall', 'solid');
  const innerRows = ts.map((t) => ks.map((k) => at(t, k, R)));
  const innerN = ts.map(() => ks.map((k) => {
    const d = dirAt(k);
    return { x: -d.x, y: -d.y, z: -d.z };
  }));
  // AO: the inside darkens toward the floor line (bottom), where the pipe meets the ground.
  grid(ctx.sink, surf, innerRows, {
    normals: innerN,
    // World UVs: u = position along the axis, v = the lateral world coordinate at the floor line
    // plus arc length, so the floor inside continues the ground's mapping at the mouths.
    uv: (i, j) => [dot(fr.a, fr.dir) + (ts[i] as number) * fr.length, dot(fr.a, fr.e2) + thAt(j) * R],
    ao: (_i, j) => aoFade(Math.abs(thAt(j)) * R, 0.35),
  });
  const outerRows = ts.map((t) => ks.map((k) => at(t, k, Ro)));
  grid(ctx.sink, shell, outerRows, { normals: ts.map(() => ks.map((k) => dirAt(k))) });
  // End rings (annuli), facing out of each mouth.
  for (const [t, sgn] of [[0, -1], [1, 1]] as const) {
    const out = { x: fr.dir.x * sgn, y: fr.dir.y * sgn, z: fr.dir.z * sgn };
    for (let k = 0; k < n; k++) face(ctx.sink, shell, [at(t, k, R), at(t, k + 1, R), at(t, k + 1, Ro), at(t, k, Ro)], out);
  }
  // Flanks: below its equator the round shell curves back in to the floor line, leaving an open
  // wedge a rider could roll into and under (the shell's underside is then a ceiling a few cm over
  // the feet). Close it on both long sides with a vertical skirt at +-Ro from the shell's bottom
  // level up to the equator (flush with the shell there), plus a cap per mouth that fills the wedge
  // between shell, skirt and bottom. Solid walls, so a head-on hit bails and a glancing one slides.
  const off = (o: Vec3, lat: number, up: number): Vec3 => ({
    x: o.x + fr.e2.x * lat + fr.e1.x * up,
    y: o.y + fr.e2.y * lat + fr.e1.y * up,
    z: o.z + fr.e2.z * lat + fr.e1.z * up,
  });
  const ups = splitRange(-Ro, 0, TUNING.LEVELS_MAX_SEG_M);
  // Shell outline from the bottom (theta 0) to the equator (PI / 2), the shell's own vertices included.
  const ths = [...new Set([0, Math.PI / 2, ...ks.map(thAt).filter((th) => th > 0 && th < Math.PI / 2)])].sort((p, q) => p - q);
  for (const sgn of [-1, 1] as const) {
    const outSide = { x: fr.e2.x * sgn, y: fr.e2.y * sgn, z: fr.e2.z * sgn };
    grid(ctx.sink, shell, ts.map((t) => ups.map((u) => off(axis(t), sgn * Ro, u))), {
      expected: outSide,
      ao: (_i, j) => wallAo((ups[j] as number) + R),
    });
    for (const [t, sgnT] of [[0, -1], [1, 1]] as const) {
      const out = { x: fr.dir.x * sgnT, y: fr.dir.y * sgnT, z: fr.dir.z * sgnT };
      const o = axis(t);
      const rim = (th: number): Vec3 => off(o, sgn * Math.sin(th) * Ro, -Math.cos(th) * Ro);
      const foot = (th: number): Vec3 => off(o, sgn * Math.sin(th) * Ro, -Ro);
      for (let i = 0; i + 1 < ths.length; i++) {
        const a = ths[i] as number, b = ths[i + 1] as number;
        // The first step starts on the bottom line itself (rim = foot there): a triangle.
        const pts = a === 0 ? [foot(a), foot(b), rim(b)] : [foot(a), foot(b), rim(b), rim(a)];
        face(ctx.sink, shell, pts, out, { ao: (p) => wallAo(dot({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z }, fr.e1) + R) });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Channel (snake run): U cross-section swept along the centreline, open ends ramp back to the rim
// ---------------------------------------------------------------------------------------------

export function buildChannel(p: ChannelPrim, ctx: PrimCtx): void {
  const sh = channelShape(p);
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const wallS = styleOf(p, ctx, 'wall', 'solid');
  const cross = sh.cross;
  const rows = sh.sections.map((sec) => cross.map((c) => channelPoint(sec, c.o, c.y, sh.rimY)));
  const normals = sh.sections.map((sec) => cross.map((c) => {
    const m = unit({ x: sec.frame.mx, y: 0, z: sec.frame.mz });
    const n = unit({ x: m.x * c.no, y: c.ny, z: m.z * c.no });
    const k = sec.flatten;
    return unit({ x: n.x * (1 - k), y: n.y * (1 - k) + k, z: n.z * (1 - k) });
  }));
  grid(ctx.sink, surf, rows, {
    normals,
    uv: (i, j) => [(sh.sections[i] as { along: number }).along, (cross[j] as { s: number }).s],
    ao: (i, j) => {
      const c = cross[j] as { y: number; wall: boolean };
      const k = (sh.sections[i] as { flatten: number }).flatten;
      return 1 - (1 - aoFade((c.y - p.floorY) * 1.5, 0.6)) * (1 - k);
    },
    // Curved walls ride as transitions; the flat floor and the plane end ramps stay solid.
    tagAt: (i, j) => {
      const a = sh.sections[i] as { flatten: number }, b = sh.sections[i + 1] as { flatten: number };
      const ca = cross[j] as { wall: boolean }, cb = cross[j + 1] as { wall: boolean };
      return ca.wall && cb.wall && a.flatten === 0 && b.flatten === 0 ? 'transition' : 'solid';
    },
  });
  // Closed ends (no ramp): a vertical cap from the cross-section up to the rim, facing inward.
  if ((p.openEndRampM ?? 0) <= 0) {
    for (const [idx, sgn] of [[0, 1], [sh.sections.length - 1, -1]] as const) {
      const sec = sh.sections[idx];
      if (!sec) continue;
      const inward = { x: sec.frame.tx * sgn, y: 0, z: sec.frame.tz * sgn };
      for (let j = 0; j + 1 < cross.length; j++) {
        const a = cross[j] as { o: number; y: number }, b = cross[j + 1] as { o: number; y: number };
        face(ctx.sink, wallS, [
          channelPoint(sec, a.o, a.y, sh.rimY),
          channelPoint(sec, b.o, b.y, sh.rimY),
          channelPoint(sec, b.o, sh.rimY, sh.rimY),
          channelPoint(sec, a.o, sh.rimY, sh.rimY),
        ], inward, { ao: (q) => wallAo(q.y - p.floorY) });
      }
    }
  }
}
