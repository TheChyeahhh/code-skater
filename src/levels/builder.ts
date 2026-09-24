/**
 * src/levels/builder.ts (levels track): LevelDef -> BuiltLevel (REQ-LVL-01, REQ-LVL-09, REQ-LVL-11,
 * REQ-GRD-01). One source of truth: meshes, collider triangles, rail splines, triggers and decal
 * quads all come from the same primitives and rails.
 * - Emits four boundary walls of def.boundaryHeight (default 12 m) at the size rectangle, tag boundary.
 * - Tags every rideable curved surface of TRANSITION_KINDS "transition"; boxes and banks stay "solid".
 * - Rail pipes per the rule above RailPipePrim in src/levels/types.ts: a default pipe for every
 *   kind "rail" rail without a RailPipePrim, a coping pipe for every kind "coping" rail, none for
 *   ledges; all go to parts (role rail / coping), never to the collider.
 * - Every visible grind edge snaps (SPEC §1.5): rails the primitives imply but the data leaves out
 *   are emitted with stable ids (lib/rails.ts), after the authored ones.
 * - Trigger radii: 0 unless authored (TriggerSphere.radius); the sim reads the tuning radius live.
 * - Per-vertex "color" attribute carries the fake AO (REQ-REN-03); UVs are world metres.
 * - Static geometry is merged per (material, role, shadow flags): merged parts carry surfaceId "*";
 *   billboard faces stay one part per billboard (surfaceId = the billboard id).
 * Runs in node (no WebGL): three geometry classes only, no materials or meshes.
 *
 * Trigger ids: "letter:<C|O|D|E>", "macguffin:<id>", "npc:<id>". Boundary surface ids:
 * "boundary-north" / "-south" / "-east" / "-west".
 */

import { facingToYaw } from '../core/math';
import { TUNING } from '../core/tuning';
import type { Box3Like, RailKind, RectXZ, Vec3 } from '../core/types';
import { createLevelRaycaster } from './lib/bvh';
import { levelHoles, levelOccluders } from './lib/context';
import { face } from './lib/emit';
import { emptyBounds, growBounds, LevelSink, type MutableBounds } from './lib/mesh';
import { emittedRails, toBuiltRail } from './lib/rails';
import { emitPrimitive, sinkParts } from './primitives';
import type { PrimCtx } from './primitives/common';
import { buildRailPipes } from './primitives/pipes';
import {
  type BuiltCollider, type BuiltDecal, type BuiltLevel, type BuiltRail, type DecalDef, type LevelCensus, type LevelDef,
  type PrimitiveKind, type RailDef, type RailPipePrim, SURFACE_TAG_CODES, type SurfaceInfo, type TriggerSphere,
} from './types';

const DEFAULT_BOUNDARY_H = 12;

export const BOUNDARY_IDS = ['boundary-north', 'boundary-south', 'boundary-east', 'boundary-west'] as const;

function boundaryWalls(sink: LevelSink, def: LevelDef): void {
  const X = def.size.x, Z = def.size.z;
  const h = def.boundaryHeight ?? DEFAULT_BOUNDARY_H;
  const y0 = -h * 0.25;
  const walls: [string, Vec3[], Vec3][] = [
    ['boundary-north', [{ x: 0, y: y0, z: 0 }, { x: X, y: y0, z: 0 }, { x: X, y: h, z: 0 }, { x: 0, y: h, z: 0 }], { x: 0, y: 0, z: 1 }],
    ['boundary-south', [{ x: 0, y: y0, z: Z }, { x: X, y: y0, z: Z }, { x: X, y: h, z: Z }, { x: 0, y: h, z: Z }], { x: 0, y: 0, z: -1 }],
    ['boundary-west', [{ x: 0, y: y0, z: 0 }, { x: 0, y: y0, z: Z }, { x: 0, y: h, z: Z }, { x: 0, y: h, z: 0 }], { x: 1, y: 0, z: 0 }],
    ['boundary-east', [{ x: X, y: y0, z: 0 }, { x: X, y: y0, z: Z }, { x: X, y: h, z: Z }, { x: X, y: h, z: 0 }], { x: -1, y: 0, z: 0 }],
  ];
  for (const [id, pts, n] of walls) {
    face(sink, { surfaceId: id, material: 'boundary', role: 'wall', tag: 'boundary', castShadow: false, receiveShadow: false }, pts, n);
  }
}

/** Decal quad corners, lifted off the surface, counter-clockwise seen from the front. */
export function decalCorners(d: DecalDef): BuiltDecal {
  const rot = ((d.rotDeg ?? 0) * Math.PI) / 180;
  const lift = TUNING.LEVELS_DECAL_LIFT_M;
  let n: Vec3, right: Vec3, up: Vec3;
  if (d.on === 'up') {
    n = { x: 0, y: 1, z: 0 };
    // Width along x, height along -z (north) before rotation; rotation about +y.
    right = { x: Math.cos(rot), y: 0, z: -Math.sin(rot) };
    up = { x: -Math.sin(rot), y: 0, z: -Math.cos(rot) };
  } else {
    const f = d.on;
    n = f === 'north' ? { x: 0, y: 0, z: -1 } : f === 'south' ? { x: 0, y: 0, z: 1 } : f === 'east' ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 };
    // Seen from the front (looking along -n), right = (-n) x up = (n.z, 0, -n.x), rotated in the wall plane.
    const r0 = { x: n.z, y: 0, z: -n.x };
    const u0 = { x: 0, y: 1, z: 0 };
    right = { x: r0.x * Math.cos(rot) + u0.x * Math.sin(rot), y: r0.y * Math.cos(rot) + u0.y * Math.sin(rot), z: r0.z * Math.cos(rot) + u0.z * Math.sin(rot) };
    up = { x: u0.x * Math.cos(rot) - r0.x * Math.sin(rot), y: u0.y * Math.cos(rot) - r0.y * Math.sin(rot), z: u0.z * Math.cos(rot) - r0.z * Math.sin(rot) };
  }
  const c = { x: d.center.x + n.x * lift, y: d.center.y + n.y * lift, z: d.center.z + n.z * lift };
  const hw = d.width / 2, hh = d.height / 2;
  const P = (a: number, b: number): Vec3 => ({
    x: c.x + right.x * a + up.x * b,
    y: c.y + right.y * a + up.y * b,
    z: c.z + right.z * a + up.z * b,
  });
  return { def: d, corners: [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], normal: n };
}

function triggers(def: LevelDef): TriggerSphere[] {
  const out: TriggerSphere[] = [];
  for (const l of def.letters) out.push({ id: `letter:${l.letter}`, kind: 'letter', center: { ...l.pos }, radius: 0, ref: l.letter });
  if (def.macguffin) out.push({ id: `macguffin:${def.macguffin.id}`, kind: 'macguffin', center: { ...def.macguffin.pos }, radius: 0, ref: def.macguffin.id });
  for (const n of def.npcs) out.push({ id: `npc:${n.id}`, kind: 'npcTalk', center: { ...n.pos }, radius: n.talkRadius ?? 0, ref: n.id });
  return out;
}

function toBox(b: MutableBounds): Box3Like {
  return { min: { ...b.min }, max: { ...b.max } };
}

function footprintOf(b: MutableBounds): RectXZ {
  return { x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z };
}

function census(def: LevelDef): LevelCensus {
  const primitives: Partial<Record<PrimitiveKind, number>> = {};
  for (const p of def.primitives) primitives[p.kind] = (primitives[p.kind] ?? 0) + 1;
  const rails: Record<RailKind, number> = { rail: 0, ledge: 0, coping: 0 };
  for (const r of def.rails) rails[r.kind] += 1;
  return { primitives, rails };
}

export function buildLevel(def: LevelDef): BuiltLevel {
  const sink = new LevelSink();
  const railDefs: RailDef[] = [...def.rails, ...emittedRails(def).map((e) => e.rail)];
  const ctx: PrimCtx = {
    sink,
    env: def.environment,
    holes: levelHoles(def),
    occluders: levelOccluders(def),
    rails: new Map(railDefs.map((r) => [r.id, r])),
  };
  for (const p of def.primitives) emitPrimitive(p, ctx);
  boundaryWalls(sink, def);

  // Collider (typed arrays), then the rail network and its pipes (posts need the surface below).
  const surfaceIds: string[] = [];
  const surfaceIndex = new Map<string, number>();
  const triSurface = new Uint16Array(sink.colTriangleCount);
  const triTag = new Uint8Array(sink.colTriangleCount);
  for (let i = 0; i < sink.colTriangleCount; i++) {
    const id = sink.colSurfaces[i] as string;
    let k = surfaceIndex.get(id);
    if (k === undefined) {
      k = surfaceIds.length;
      surfaceIds.push(id);
      surfaceIndex.set(id, k);
    }
    triSurface[i] = k;
    triTag[i] = SURFACE_TAG_CODES[sink.colTags[i] ?? 'solid'];
  }
  const collider: BuiltCollider = {
    positions: new Float32Array(sink.colPositions),
    triangleCount: sink.colTriangleCount,
    triTag,
    triSurface,
    surfaceIds,
  };
  const rails: BuiltRail[] = railDefs.filter((r) => r.points.length >= 2).map(toBuiltRail).filter((r) => r.segments.length > 0);
  const pipePrims = def.primitives.filter((p): p is RailPipePrim => p.kind === 'railPipe');
  buildRailPipes(sink, rails, pipePrims, createLevelRaycaster(collider));

  const parts = sinkParts(sink, def.id);
  const decals = def.decals.map(decalCorners);

  const surfaces: Record<string, SurfaceInfo> = {};
  const all = emptyBounds();
  for (const p of def.primitives) {
    const b = sink.surfaceBounds.get(p.id);
    if (!b) continue;
    surfaces[p.id] = { id: p.id, kind: p.kind, bounds: toBox(b), footprint: footprintOf(b) };
  }
  for (const id of BOUNDARY_IDS) {
    const b = sink.surfaceBounds.get(id);
    if (b) surfaces[id] = { id, kind: 'boundary', bounds: toBox(b), footprint: footprintOf(b) };
  }
  for (const b of sink.surfaceBounds.values()) {
    growBounds(all, b.min);
    growBounds(all, b.max);
  }

  return {
    def,
    parts,
    collider,
    rails,
    triggers: triggers(def),
    decals,
    surfaces,
    bounds: toBox(all),
    spawn: { pos: { ...def.spawn.pos }, yaw: facingToYaw(def.spawn.facing) },
    census: census(def),
  };
}
