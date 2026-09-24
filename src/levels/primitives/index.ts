/**
 * src/levels/primitives/index.ts (levels track): per-primitive geometry generators used by
 * buildLevel. Each kind writes render batches and collider triangles for one primitive into a
 * LevelSink (lib/mesh.ts); buildLevel shares one sink across the whole level so static geometry
 * merges by material. buildPrimitive() is the stand-alone form: one primitive, its own parts and
 * collider chunk (no ground holes, no neighbour AO).
 */

import type { SurfaceTag } from '../../core/types';
import type { LevelMeshPart, Primitive, RailDef } from '../types';
import { LevelSink, MERGED_SURFACE_ID } from '../lib/mesh';
import { buildBillboard, buildBox, buildBuilding, buildGround, buildLedge, buildProp } from './basic';
import type { PrimCtx } from './common';
import { buildBank, buildEuroGap, buildFunbox, buildHubba, buildHump, buildKicker, buildPyramid, buildStairs } from './ramps';
import { buildBowl, buildChannel, buildFountain, buildFullPipe, buildQuarterPipe, buildSpine } from './transitions';

export interface ColliderChunk {
  /** Non-indexed triangle positions, 9 floats per triangle. */
  readonly positions: Float32Array;
  /** One tag per triangle. */
  readonly tags: readonly SurfaceTag[];
}

export interface PrimitiveOutput {
  readonly parts: readonly LevelMeshPart[];
  readonly collider: ColliderChunk;
}

export interface PrimitiveBuildContext {
  /** Rails by id, for railPipe and coping references. */
  readonly rails: ReadonlyMap<string, RailDef>;
}

/** Write one primitive into the shared sink. railPipe emits nothing here (pipes are built from the rail network). */
export function emitPrimitive(p: Primitive, ctx: PrimCtx): void {
  switch (p.kind) {
    case 'ground':
      return buildGround(p, ctx);
    case 'box':
      return buildBox(p, ctx);
    case 'building':
      return buildBuilding(p, ctx);
    case 'ledge':
      return buildLedge(p, ctx);
    case 'bank':
      return buildBank(p, ctx);
    case 'stairs':
      return buildStairs(p, ctx);
    case 'hubba':
      return buildHubba(p, ctx);
    case 'quarterPipe':
      return buildQuarterPipe(p, ctx);
    case 'bowl':
      return buildBowl(p, ctx);
    case 'spine':
      return buildSpine(p, ctx);
    case 'fullPipe':
      return buildFullPipe(p, ctx);
    case 'fountain':
      return buildFountain(p, ctx);
    case 'channel':
      return buildChannel(p, ctx);
    case 'euroGap':
      return buildEuroGap(p, ctx);
    case 'hump':
      return buildHump(p, ctx);
    case 'kicker':
      return buildKicker(p, ctx);
    case 'funbox':
      return buildFunbox(p, ctx);
    case 'pyramid':
      return buildPyramid(p, ctx);
    case 'billboard':
      return buildBillboard(p, ctx);
    case 'prop':
      return buildProp(p, ctx);
    case 'railPipe':
      return;
  }
}

/** Convert a sink's batches into LevelMeshParts (merged parts carry surfaceId MERGED_SURFACE_ID). */
export function sinkParts(sink: LevelSink, idPrefix: string): LevelMeshPart[] {
  return sink.allBatches().map((b, i) => ({
    id: `${idPrefix}:${b.key.material}:${b.key.role}:${b.key.surfaceId ?? MERGED_SURFACE_ID}:${i}`,
    surfaceId: b.key.surfaceId ?? MERGED_SURFACE_ID,
    material: b.key.material,
    geometry: b.toGeometry(),
    role: b.key.role,
    castShadow: b.key.castShadow,
    receiveShadow: b.key.receiveShadow,
  }));
}

export function buildPrimitive(primitive: Primitive, ctx: PrimitiveBuildContext): PrimitiveOutput {
  const sink = new LevelSink();
  emitPrimitive(primitive, { sink, env: 'testGrid', holes: [], occluders: [], rails: ctx.rails });
  return {
    parts: sinkParts(sink, primitive.id),
    collider: { positions: new Float32Array(sink.colPositions), tags: [...sink.colTags] },
  };
}
