/**
 * src/levels/primitives/ramps.ts (levels track): plane ramps and stepped shapes (bank, kicker,
 * funbox, pyramid, hump, euro gap, stairs, hubba). Banks, kickers, funboxes, pyramids, euro gaps,
 * stairs and hubbas are "solid" (REQ-LVL-09: plane ramps are not transitions); the hump is tagged
 * transition (DESIGN WS-H1).
 */

import { TUNING } from '../../core/tuning';
import type { Facing, Vec3 } from '../../core/types';
import type { BankPrim, EuroGapPrim, FunboxPrim, HubbaPrim, HumpPrim, KickerPrim, PyramidPrim, StairsPrim } from '../types';
import { aoFade } from '../lib/context';
import { facingAxisIsX, facingVec, rectAlong, UP } from '../lib/derive';
import { face, grid, splitRange, wall } from '../lib/emit';
import { type PrimCtx, styleOf, wallAo } from './common';

const opposite: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** Point in a rect-along frame: c = coordinate on the facing axis, s = the other axis. */
function alongPoint(f: Facing, c: number, s: number, y: number): Vec3 {
  return facingAxisIsX(f) ? { x: c, y, z: s } : { x: s, y, z: c };
}

function vec3(f: Facing): Vec3 {
  const v = facingVec(f);
  return { x: v.x, y: 0, z: v.z };
}

/**
 * A wedge rising from yLow at the `start` edge to yHigh at the `end` edge of a rect along `rise`
 * (the direction it climbs), on a base at yBase. Emits the slope, the two side walls and the tall
 * end wall. Used by banks and kickers.
 */
function wedge(ctx: PrimCtx, surfStyle: ReturnType<typeof styleOf>, sideStyle: ReturnType<typeof styleOf>, rect: BankPrim['rect'], rise: Facing, yLow: number, yHigh: number, yBase: number, endWall = true): void {
  const ra = rectAlong(rect, rise);
  const P = (c: number, s: number, y: number): Vec3 => alongPoint(rise, c, s, y);
  const up = vec3(rise);
  // Slope normal: tilted back against the rise direction.
  const run = Math.abs(ra.end - ra.start);
  const slopeN = { x: -up.x * (yHigh - yLow), y: run, z: -up.z * (yHigh - yLow) };
  const cs = splitRange(ra.start, ra.end, TUNING.LEVELS_MAX_SEG_M);
  const ss = splitRange(ra.s0, ra.s1, TUNING.LEVELS_MAX_SEG_M);
  const rows = cs.map((c) => ss.map((s) => P(c, s, yLow + ((yHigh - yLow) * (c - ra.start)) / (ra.end - ra.start || 1))));
  grid(ctx.sink, surfStyle, rows, { expected: slopeN });
  // Sides: vertical polygons between the base and the slope line.
  for (const [s, n] of [[ra.s0, -1], [ra.s1, 1]] as const) {
    const out = facingAxisIsX(rise) ? { x: 0, y: 0, z: n } : { x: n, y: 0, z: 0 };
    const pts = [P(ra.start, s, yBase), P(ra.end, s, yBase), P(ra.end, s, yHigh)];
    if (yLow > yBase + 1e-6) pts.push(P(ra.start, s, yLow));
    face(ctx.sink, sideStyle, pts, out, { ao: (p) => wallAo(p.y - yBase) });
  }
  if (endWall) wall(ctx.sink, sideStyle, P(ra.end, ra.s0, 0), P(ra.end, ra.s1, 0), yBase, yHigh, up, TUNING.LEVELS_MAX_SEG_M, wallAo);
  if (yLow > yBase + 1e-6) wall(ctx.sink, sideStyle, P(ra.start, ra.s0, 0), P(ra.start, ra.s1, 0), yBase, yLow, { x: -up.x, y: 0, z: -up.z }, TUNING.LEVELS_MAX_SEG_M, wallAo);
}

export function buildBank(p: BankPrim, ctx: PrimCtx): void {
  // Rises toward the opposite of downhill.
  const surf = styleOf(p, ctx, 'surface', 'solid');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const base = Math.min(p.yLow, p.yHigh);
  wedge(ctx, surf, side, p.rect, opposite[p.downhill], p.yLow, p.yHigh, base);
}

export function buildKicker(p: KickerPrim, ctx: PrimCtx): void {
  const surf = styleOf(p, ctx, 'surface', 'solid');
  const side = styleOf(p, ctx, 'wall', 'solid');
  wedge(ctx, surf, side, p.rect, p.up, 0, p.height, 0);
}

/** Funbox / pyramid: flat deck with plane ramps of rampRunM outward on the listed sides, hip corners between adjacent ramps. */
function deckWithRamps(ctx: PrimCtx, p: FunboxPrim | PyramidPrim, ramps: readonly Facing[]): void {
  const surf = styleOf(p, ctx, 'surface', 'solid');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const r = p.rect, h = p.height, L = p.rampRunM;
  face(ctx.sink, surf, [
    { x: r.x0, y: h, z: r.z0 },
    { x: r.x0, y: h, z: r.z1 },
    { x: r.x1, y: h, z: r.z1 },
    { x: r.x1, y: h, z: r.z0 },
  ], UP);
  const has = (f: Facing): boolean => ramps.includes(f);
  const maxLen = TUNING.LEVELS_MAX_SEG_M;
  // Each side: either a ramp going outward (down away from the deck) or a vertical wall.
  const sides: { f: Facing; a: { x: number; z: number }; b: { x: number; z: number } }[] = [
    { f: 'north', a: { x: r.x0, z: r.z0 }, b: { x: r.x1, z: r.z0 } },
    { f: 'south', a: { x: r.x1, z: r.z1 }, b: { x: r.x0, z: r.z1 } },
    { f: 'east', a: { x: r.x1, z: r.z0 }, b: { x: r.x1, z: r.z1 } },
    { f: 'west', a: { x: r.x0, z: r.z1 }, b: { x: r.x0, z: r.z0 } },
  ];
  for (const sd of sides) {
    const o = facingVec(sd.f);
    if (!has(sd.f)) {
      wall(ctx.sink, side, sd.a, sd.b, 0, h, { x: o.x, y: 0, z: o.z }, maxLen, wallAo);
      continue;
    }
    const a0 = { x: sd.a.x, y: h, z: sd.a.z }, b0 = { x: sd.b.x, y: h, z: sd.b.z };
    const a1 = { x: sd.a.x + o.x * L, y: 0, z: sd.a.z + o.z * L }, b1 = { x: sd.b.x + o.x * L, y: 0, z: sd.b.z + o.z * L };
    const n = { x: o.x * h, y: L, z: o.z * h };
    face(ctx.sink, surf, [a0, b0, b1, a1], n, { ao: (q) => aoFade(q.y * 3, 0.5) });
  }
  // Ramp ends: a hip corner when the neighbour side also has a ramp, else a vertical triangle.
  const corner = (f1: Facing, f2: Facing, cx: number, cz: number): void => {
    const o1 = facingVec(f1), o2 = facingVec(f2);
    const D = { x: cx, y: h, z: cz };
    const A = { x: cx + o1.x * L, y: 0, z: cz + o1.z * L };
    const B = { x: cx + o2.x * L, y: 0, z: cz + o2.z * L };
    const O = { x: cx + (o1.x + o2.x) * L, y: 0, z: cz + (o1.z + o2.z) * L };
    if (has(f1) && has(f2)) {
      const n = { x: (o1.x + o2.x) * h, y: L, z: (o1.z + o2.z) * h };
      face(ctx.sink, surf, [D, A, O], n);
      face(ctx.sink, surf, [D, O, B], n);
    } else if (has(f1)) {
      face(ctx.sink, side, [D, A, { x: cx, y: 0, z: cz }], { x: o2.x, y: 0, z: o2.z }, { ao: (q) => wallAo(q.y) });
    } else if (has(f2)) {
      face(ctx.sink, side, [D, B, { x: cx, y: 0, z: cz }], { x: o1.x, y: 0, z: o1.z }, { ao: (q) => wallAo(q.y) });
    }
  };
  corner('north', 'west', r.x0, r.z0);
  corner('north', 'east', r.x1, r.z0);
  corner('south', 'west', r.x0, r.z1);
  corner('south', 'east', r.x1, r.z1);
}

export function buildFunbox(p: FunboxPrim, ctx: PrimCtx): void {
  deckWithRamps(ctx, p, p.ramps);
}

export function buildPyramid(p: PyramidPrim, ctx: PrimCtx): void {
  deckWithRamps(ctx, p, ['north', 'south', 'east', 'west']);
}

export function buildHump(p: HumpPrim, ctx: PrimCtx): void {
  const surf = styleOf(p, ctx, 'surface', 'transition');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const r = p.rect;
  // Profile across the ridge: y = h (1 - cos 2 pi t) / 2, t in [0, 1] across the rect.
  const across = p.ridgeAxis === 'x' ? { a: r.z0, b: r.z1 } : { a: r.x0, b: r.x1 };
  const alongR = p.ridgeAxis === 'x' ? { a: r.x0, b: r.x1 } : { a: r.z0, b: r.z1 };
  const width = across.b - across.a;
  const n = 32;
  const ts = Array.from({ length: n + 1 }, (_, i) => i / n);
  const ss = splitRange(alongR.a, alongR.b, TUNING.LEVELS_MAX_SEG_M);
  const P = (t: number, s: number): Vec3 => {
    const c = across.a + width * t;
    const y = (p.height * (1 - Math.cos(2 * Math.PI * t))) / 2;
    return p.ridgeAxis === 'x' ? { x: s, y, z: c } : { x: c, y, z: s };
  };
  const N = (t: number): Vec3 => {
    const dy = (p.height * Math.PI * Math.sin(2 * Math.PI * t)) / width;
    const l = Math.hypot(1, dy);
    return p.ridgeAxis === 'x' ? { x: 0, y: 1 / l, z: -dy / l } : { x: -dy / l, y: 1 / l, z: 0 };
  };
  const rows = ts.map((t) => ss.map((s) => P(t, s)));
  const normals = ts.map((t) => ss.map(() => N(t)));
  grid(ctx.sink, surf, rows, { normals, uv: (i, j, q) => [p.ridgeAxis === 'x' ? q.x : q.z, across.a + (width * (i / n))] });
  // End profiles.
  for (const [s, sign] of [[alongR.a, -1], [alongR.b, 1]] as const) {
    const out = p.ridgeAxis === 'x' ? { x: sign, y: 0, z: 0 } : { x: 0, y: 0, z: sign };
    for (let i = 0; i < n; i++) {
      const a = P(ts[i] as number, s), b = P(ts[i + 1] as number, s);
      face(ctx.sink, side, [a, b, { ...b, y: 0 }, { ...a, y: 0 }], out);
    }
  }
}

export function buildEuroGap(p: EuroGapPrim, ctx: PrimCtx): void {
  const surf = styleOf(p, ctx, 'surface', 'solid');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const r = p.rect;
  const top = 0;
  const f = p.floorY;
  const L = Math.max(0, p.bankRunM);
  // Cross-section along the travel axis: rim -> bank -> floor -> bank -> rim.
  const a = p.across === 'x' ? { lo: r.x0, hi: r.x1, s0: r.z0, s1: r.z1 } : { lo: r.z0, hi: r.z1, s0: r.x0, s1: r.x1 };
  const prof = [
    { c: a.lo, y: top },
    { c: Math.min(a.lo + L, (a.lo + a.hi) / 2), y: f },
    { c: Math.max(a.hi - L, (a.lo + a.hi) / 2), y: f },
    { c: a.hi, y: top },
  ];
  const P = (c: number, s: number, y: number): Vec3 => (p.across === 'x' ? { x: c, y, z: s } : { x: s, y, z: c });
  const ss = splitRange(a.s0, a.s1, TUNING.LEVELS_MAX_SEG_M);
  for (let i = 0; i + 1 < prof.length; i++) {
    const q0 = prof[i] as { c: number; y: number }, q1 = prof[i + 1] as { c: number; y: number };
    const dc = q1.c - q0.c, dy = q1.y - q0.y;
    if (Math.abs(dc) < 1e-6) continue;
    const n2 = { c: -dy, y: dc };
    const len = Math.hypot(n2.c, n2.y) || 1;
    const sgn = n2.y < 0 ? -1 : 1;
    const nWorld = P((sgn * n2.c) / len, 0, (sgn * n2.y) / len);
    const nn = p.across === 'x' ? { x: nWorld.x, y: nWorld.y, z: 0 } : { x: 0, y: nWorld.y, z: nWorld.z };
    const rows = [ss.map((s) => P(q0.c, s, q0.y)), ss.map((s) => P(q1.c, s, q1.y))];
    grid(ctx.sink, surf, rows, { expected: nn, ao: (ri) => (i === 1 ? 0.92 : ri === (i === 0 ? 1 : 0) ? aoFade(0, 0.6) : 1) });
  }
  // End walls (vertical trench cross-sections), facing into the trench.
  for (const [s, inward] of [[a.s0, 1], [a.s1, -1]] as const) {
    const out = p.across === 'x' ? { x: 0, y: 0, z: inward } : { x: inward, y: 0, z: 0 };
    for (let i = 0; i + 1 < prof.length; i++) {
      const q0 = prof[i] as { c: number; y: number }, q1 = prof[i + 1] as { c: number; y: number };
      face(ctx.sink, side, [P(q0.c, s, q0.y), P(q1.c, s, q1.y), P(q1.c, s, top), P(q0.c, s, top)], out, { ao: (q) => wallAo(q.y - f) });
    }
  }
}

export function buildStairs(p: StairsPrim, ctx: PrimCtx): void {
  const tread = styleOf(p, ctx, 'surface', 'solid');
  const riser = styleOf(p, ctx, 'wall', 'solid');
  const ra = rectAlong(p.rect, p.down);
  const n = Math.max(1, Math.round(p.steps));
  const rise = p.drop / n;
  const base = p.topY - p.drop;
  const dir = Math.sign(ra.end - ra.start) || 1;
  const depth = Math.abs(ra.end - ra.start) / n;
  const P = (c: number, s: number, y: number): Vec3 => alongPoint(p.down, c, s, y);
  const dv = vec3(p.down);
  const ss = splitRange(ra.s0, ra.s1, TUNING.LEVELS_MAX_SEG_M);
  for (let i = 0; i < n; i++) {
    const c0 = ra.start + dir * depth * i;
    const c1 = ra.start + dir * depth * (i + 1);
    const y = p.topY - rise * i;
    // Tread: darker at its back edge (the concave corner under the riser above).
    grid(ctx.sink, tread, [ss.map((s) => P(c0, s, y)), ss.map((s) => P(c1, s, y))], { expected: UP, ao: (ri) => (ri === 0 && i > 0 ? aoFade(0, 0.7) : 1) });
    // Riser at the front of the tread, down to the next tread (or the base).
    grid(ctx.sink, riser, [ss.map((s) => P(c1, s, y - rise)), ss.map((s) => P(c1, s, y))], { expected: dv, ao: (ri) => (ri === 0 ? aoFade(0, 0.7) : 1) });
    // Side walls of this step column.
    for (const [s, sgn] of [[ra.s0, -1], [ra.s1, 1]] as const) {
      const out = facingAxisIsX(p.down) ? { x: 0, y: 0, z: sgn } : { x: sgn, y: 0, z: 0 };
      face(ctx.sink, riser, [P(c0, s, base), P(c1, s, base), P(c1, s, y), P(c0, s, y)], out, { ao: (q) => wallAo(q.y - base) });
    }
  }
  wall(ctx.sink, riser, P(ra.start, ra.s0, 0), P(ra.start, ra.s1, 0), base, p.topY, { x: -dv.x, y: 0, z: -dv.z }, TUNING.LEVELS_MAX_SEG_M, wallAo);
}

export function buildHubba(p: HubbaPrim, ctx: PrimCtx): void {
  const top = styleOf(p, ctx, 'surface', 'solid');
  const side = styleOf(p, ctx, 'wall', 'solid');
  const base = p.baseY ?? 0;
  const ra = rectAlong(p.rect, p.along);
  const f = facingVec(p.along);
  const sign = f.x + f.z;
  const kinkInside = (p.kinkAt - ra.start) * sign > 1e-6 && (ra.end - p.kinkAt) * sign > 1e-6;
  const prof: { c: number; y: number }[] = [{ c: ra.start, y: p.yTop }];
  if (kinkInside) prof.push({ c: p.kinkAt, y: p.yKink });
  prof.push({ c: ra.end, y: kinkInside ? p.yEnd : p.yKink });
  const P = (c: number, s: number, y: number): Vec3 => alongPoint(p.along, c, s, y);
  const dv = vec3(p.along);
  for (let i = 0; i + 1 < prof.length; i++) {
    const q0 = prof[i] as { c: number; y: number }, q1 = prof[i + 1] as { c: number; y: number };
    const run = Math.abs(q1.c - q0.c);
    // Tilted toward the descent direction by the drop of this piece.
    const nn = { x: dv.x * (q0.y - q1.y), y: run, z: dv.z * (q0.y - q1.y) };
    face(ctx.sink, top, [P(q0.c, ra.s0, q0.y), P(q1.c, ra.s0, q1.y), P(q1.c, ra.s1, q1.y), P(q0.c, ra.s1, q0.y)], nn);
    for (const [s, sgn] of [[ra.s0, -1], [ra.s1, 1]] as const) {
      const out = facingAxisIsX(p.along) ? { x: 0, y: 0, z: sgn } : { x: sgn, y: 0, z: 0 };
      face(ctx.sink, side, [P(q0.c, s, base), P(q1.c, s, base), P(q1.c, s, q1.y), P(q0.c, s, q0.y)], out, { ao: (q) => wallAo(q.y - base) });
    }
  }
  const first = prof[0] as { c: number; y: number };
  const last = prof[prof.length - 1] as { c: number; y: number };
  wall(ctx.sink, side, P(first.c, ra.s0, 0), P(first.c, ra.s1, 0), base, first.y, { x: -dv.x, y: 0, z: -dv.z }, TUNING.LEVELS_MAX_SEG_M, wallAo);
  wall(ctx.sink, side, P(last.c, ra.s0, 0), P(last.c, ra.s1, 0), base, last.y, dv, TUNING.LEVELS_MAX_SEG_M, wallAo);
}
