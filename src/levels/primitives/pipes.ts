/**
 * src/levels/primitives/pipes.ts (levels track): the visible rail and coping pipes, one rule
 * (src/levels/types.ts, above RailPipePrim):
 * - kind "rail" without a RailPipePrim: round pipe of LEVELS_RAIL_PIPE_R_M with posts down to the
 *   surface below, steelRail, role "rail";
 * - kind "coping": coping pipe of LEVELS_COPING_PIPE_R_M, no posts, steelCoping, role "coping";
 * - kind "ledge": nothing (the ledge / hubba / box edge is the visible surface);
 * - a RailPipePrim overrides style, radius and posts for its rail.
 * Pipes and posts are render only: never in the movement collider (REQ-LVL-11, REQ-CTL-22).
 * Round rail pipes sit with their TOP on the rail line (the board rides the line); coping pipes
 * are centred on it so the lip reads as a round steel edge.
 */

import { TUNING } from '../../core/tuning';
import type { Vec3 } from '../../core/types';
import type { BuiltRail, MaterialId, RailPipePrim } from '../types';
import type { LevelRaycaster } from '../lib/bvh';
import { type EmitStyle, tube } from '../lib/emit';
import type { LevelSink, PartRole } from '../lib/mesh';

function pipeRadius(style: RailPipePrim['style'] | null, override: number | undefined, kind: BuiltRail['kind']): number {
  if (override !== undefined) return override;
  if (kind === 'coping' && style === null) return TUNING.LEVELS_COPING_PIPE_R_M;
  if (style === 'scaffold') return TUNING.LEVELS_SCAFFOLD_PIPE_R_M;
  if (style === 'vent') return TUNING.LEVELS_VENT_PIPE_R_M;
  return TUNING.LEVELS_RAIL_PIPE_R_M;
}

/** Points every `spacing` metres of horizontal-ish arc length along a polyline, both ends included. */
function postPoints(pts: readonly Vec3[], spacing: number, inset: number): Vec3[] {
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Vec3, b = pts[i + 1] as Vec3;
    const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    lens.push(l);
    total += l;
  }
  if (total <= 2 * inset) return total > 0 ? [pointAt(pts, lens, total / 2)] : [];
  const usable = total - 2 * inset;
  const n = Math.max(1, Math.ceil(usable / Math.max(0.1, spacing) - 1e-9));
  const out: Vec3[] = [];
  for (let k = 0; k <= n; k++) out.push(pointAt(pts, lens, inset + (usable * k) / n));
  return out;
}

function pointAt(pts: readonly Vec3[], lens: readonly number[], s: number): Vec3 {
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i] as number;
    if (s <= acc + l || i === lens.length - 1) {
      const t = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      const a = pts[i] as Vec3, b = pts[i + 1] as Vec3;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    acc += l;
  }
  return { ...(pts[0] as Vec3) };
}

export function buildRailPipes(
  sink: LevelSink,
  rails: readonly BuiltRail[],
  pipePrims: readonly RailPipePrim[],
  ray: LevelRaycaster,
): void {
  const byRail = new Map<string, RailPipePrim>();
  for (const p of pipePrims) byRail.set(p.railId, p);
  const segs = Math.max(6, Math.round(TUNING.LEVELS_PIPE_RADIAL_SEGS));
  for (const rail of rails) {
    const prim = byRail.get(rail.id) ?? null;
    if (!prim && rail.kind === 'ledge') continue;
    const style = prim?.style ?? null;
    const r = pipeRadius(style, prim?.radius, rail.kind);
    const coping = rail.kind === 'coping' && prim === null;
    const role: PartRole = coping ? 'coping' : 'rail';
    const material: MaterialId = prim?.material ?? (coping ? 'steelCoping' : style === 'scaffold' ? 'scaffold' : 'steelRail');
    const s: EmitStyle = {
      surfaceId: prim?.id ?? rail.id,
      material,
      role,
      tag: 'solid',
      collide: false,
      castShadow: true,
      receiveShadow: true,
    };
    // Coping pipes centre on the line; round rails hang their top on it.
    const drop = coping ? 0 : r;
    const pts = rail.points.map((p) => ({ x: p.x, y: p.y - drop, z: p.z }));
    tube(sink, s, pts, r, segs, rail.closed);
    const wantPosts = prim ? (prim.posts ?? (prim.style !== 'wallMounted' && prim.style !== 'parapet')) : !coping;
    if (!wantPosts) continue;
    const postR = r * TUNING.LEVELS_POST_R_RATIO;
    const postStyle: EmitStyle = { ...s, surfaceId: `${s.surfaceId}:posts` };
    for (const q of postPoints(pts, TUNING.LEVELS_RAIL_POST_SPACING_M, Math.min(0.15, r * 4))) {
      const top = q.y - r;
      const hit = ray.raycast({ x: q.x, y: top, z: q.z }, { x: 0, y: -1, z: 0 }, TUNING.LEVELS_POST_MAX_DROP_M);
      if (!hit || hit.distance < 0.02) continue;
      tube(sink, postStyle, [{ x: q.x, y: hit.point.y, z: q.z }, { x: q.x, y: top + r * 0.5, z: q.z }], postR, Math.max(6, segs - 2), false);
    }
  }
}
