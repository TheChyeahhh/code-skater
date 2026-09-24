/**
 * src/levels/primitives/common.ts (levels track): the per-primitive build context and the solid
 * shapes several primitives share (axis-aligned boxes, oriented boxes, vertical posts).
 */

import { TUNING } from '../../core/tuning';
import type { RectXZ, SurfaceTag, Vec3 } from '../../core/types';
import type { EnvironmentPreset, MaterialId, Primitive, RailDef } from '../types';
import { aoFade, type Hole, type Occluder } from '../lib/context';
import { defaultMaterial, UP } from '../lib/derive';
import { type EmitStyle, face, tube, wall } from '../lib/emit';
import type { LevelSink, PartRole } from '../lib/mesh';

export interface PrimCtx {
  readonly sink: LevelSink;
  readonly env: EnvironmentPreset;
  readonly holes: readonly Hole[];
  readonly occluders: readonly Occluder[];
  readonly rails: ReadonlyMap<string, RailDef>;
}

export function styleOf(
  p: Primitive,
  ctx: PrimCtx,
  role: PartRole,
  tag: SurfaceTag,
  patch: Partial<EmitStyle> = {},
): EmitStyle {
  return { surfaceId: p.id, material: defaultMaterial(p, ctx.env), role, tag, ...patch };
}

export const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
export const NORTH: Vec3 = { x: 0, y: 0, z: -1 };
export const SOUTH: Vec3 = { x: 0, y: 0, z: 1 };
export const EAST: Vec3 = { x: 1, y: 0, z: 0 };
export const WEST: Vec3 = { x: -1, y: 0, z: 0 };

export function wallAo(h: number): number {
  return aoFade(h);
}

/** Axis-aligned solid box: top, four AO-graded sides, optional bottom. */
export function solidBox(
  ctx: PrimCtx,
  side: EmitStyle,
  rect: RectXZ,
  y0: number,
  y1: number,
  opts: { readonly top?: EmitStyle; readonly bottom?: boolean; readonly sideAo?: boolean } = {},
): void {
  if (y1 - y0 < 1e-6) return;
  const { sink } = ctx;
  const r = rect;
  const top = opts.top ?? side;
  face(sink, top, [
    { x: r.x0, y: y1, z: r.z0 },
    { x: r.x0, y: y1, z: r.z1 },
    { x: r.x1, y: y1, z: r.z1 },
    { x: r.x1, y: y1, z: r.z0 },
  ], UP);
  const maxLen = TUNING.LEVELS_MAX_SEG_M;
  const ao = opts.sideAo === false ? () => 1 : wallAo;
  wall(sink, side, { x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, y0, y1, NORTH, maxLen, ao);
  wall(sink, side, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }, y0, y1, SOUTH, maxLen, ao);
  wall(sink, side, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, y0, y1, EAST, maxLen, ao);
  wall(sink, side, { x: r.x0, z: r.z1 }, { x: r.x0, z: r.z0 }, y0, y1, WEST, maxLen, ao);
  if (opts.bottom) {
    face(sink, side, [
      { x: r.x0, y: y0, z: r.z0 },
      { x: r.x1, y: y0, z: r.z0 },
      { x: r.x1, y: y0, z: r.z1 },
      { x: r.x0, y: y0, z: r.z1 },
    ], DOWN);
  }
}

/** Box rotated by yaw (radians about +y) around its bottom-centre `at`; size = full extents. */
export function orientedBox(ctx: PrimCtx, s: EmitStyle, at: Vec3, local: Vec3, size: Vec3, yaw: number, bottom = true): void {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  // three's rotation about +y: x' = x c + z s, z' = -x s + z c.
  const W = (x: number, y: number, z: number): Vec3 => {
    const lx = local.x + x, lz = local.z + z;
    return { x: at.x + lx * c + lz * sn, y: at.y + local.y + y, z: at.z - lx * sn + lz * c };
  };
  const R = (v: Vec3): Vec3 => ({ x: v.x * c + v.z * sn, y: v.y, z: -v.x * sn + v.z * c });
  const hx = size.x / 2, hz = size.z / 2, h = size.y;
  const faces: [Vec3[], Vec3][] = [
    [[W(-hx, h, -hz), W(-hx, h, hz), W(hx, h, hz), W(hx, h, -hz)], UP],
    [[W(-hx, 0, -hz), W(hx, 0, -hz), W(hx, h, -hz), W(-hx, h, -hz)], R(NORTH)],
    [[W(-hx, 0, hz), W(hx, 0, hz), W(hx, h, hz), W(-hx, h, hz)], R(SOUTH)],
    [[W(hx, 0, -hz), W(hx, 0, hz), W(hx, h, hz), W(hx, h, -hz)], R(EAST)],
    [[W(-hx, 0, -hz), W(-hx, 0, hz), W(-hx, h, hz), W(-hx, h, -hz)], R(WEST)],
  ];
  if (bottom) faces.push([[W(-hx, 0, -hz), W(hx, 0, -hz), W(hx, 0, hz), W(-hx, 0, hz)], DOWN]);
  for (const [pts, n] of faces) face(ctx.sink, s, pts, n, { ao: (p) => (n.y === 0 ? wallAo(p.y - at.y) : 1) });
}

/** Vertical round post from y0 to y1 (render only unless the style collides). */
export function post(ctx: PrimCtx, s: EmitStyle, x: number, z: number, y0: number, y1: number, radius: number, segs = 6): void {
  if (y1 - y0 < 1e-3) return;
  tube(ctx.sink, s, [{ x, y: y0, z }, { x, y: y1, z }], radius, segs, false);
}

export function materialOr(p: Primitive, ctx: PrimCtx): MaterialId {
  return defaultMaterial(p, ctx.env);
}
