/**
 * src/levels/lib/mesh.ts (levels track): geometry accumulators shared by every primitive.
 *
 * - RenderBatch: one indexed triangle list with position, normal, uv (world metres) and a grey
 *   "color" attribute holding the baked-looking fake AO (REQ-REN-03).
 * - LevelSink: every batch of a level keyed by (material, role, shadows[, surface]) so static
 *   geometry merges by material (one draw call per material and role), plus the collider triangle
 *   soup with one SurfaceTag and one surface id per triangle (REQ-LVL-01, REQ-LVL-11), plus the
 *   bounds of every surface id.
 * Plain arrays while building; typed arrays and BufferGeometry only at the end.
 */

import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import type { SurfaceTag, Vec3 } from '../../core/types';
import type { LevelMeshPart, MaterialId } from '../types';

export type PartRole = LevelMeshPart['role'];

export interface BatchKey {
  readonly material: MaterialId;
  readonly role: PartRole;
  /** Only set for parts that must stay per primitive (sign faces carry their billboard's brand). */
  readonly surfaceId?: string;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

/** surfaceId of parts merged across primitives (every static part except sign faces). */
export const MERGED_SURFACE_ID = '*';

export class RenderBatch {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  readonly key: BatchKey;

  constructor(key: BatchKey) {
    this.key = key;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(p: Vec3, n: Vec3, u: number, v: number, ao: number): number {
    const i = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    this.colors.push(ao, ao, ao);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    const n = this.vertexCount;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export interface MutableBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export function emptyBounds(): MutableBounds {
  return { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
}

export function growBounds(b: MutableBounds, p: Vec3): void {
  if (p.x < b.min.x) b.min.x = p.x;
  if (p.y < b.min.y) b.min.y = p.y;
  if (p.z < b.min.z) b.min.z = p.z;
  if (p.x > b.max.x) b.max.x = p.x;
  if (p.y > b.max.y) b.max.y = p.y;
  if (p.z > b.max.z) b.max.z = p.z;
}

/** Twice the triangle area below this counts as degenerate and is dropped (collider and render). */
export const DEGENERATE_AREA2 = 1e-9;

export function triArea2(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

export class LevelSink {
  private readonly batches = new Map<string, RenderBatch>();
  readonly colPositions: number[] = [];
  readonly colTags: SurfaceTag[] = [];
  readonly colSurfaces: string[] = [];
  readonly surfaceBounds = new Map<string, MutableBounds>();

  batch(key: BatchKey): RenderBatch {
    const k = `${key.material}|${key.role}|${key.castShadow ? 1 : 0}${key.receiveShadow ? 1 : 0}|${key.surfaceId ?? ''}`;
    let b = this.batches.get(k);
    if (!b) {
      b = new RenderBatch(key);
      this.batches.set(k, b);
    }
    return b;
  }

  allBatches(): readonly RenderBatch[] {
    return [...this.batches.values()].filter((b) => b.indices.length > 0);
  }

  bound(surfaceId: string, p: Vec3): void {
    let b = this.surfaceBounds.get(surfaceId);
    if (!b) {
      b = emptyBounds();
      this.surfaceBounds.set(surfaceId, b);
    }
    growBounds(b, p);
  }

  /** One collider triangle (winding = the face's outward / rideable side). Degenerates are dropped. */
  colTri(surfaceId: string, tag: SurfaceTag, a: Vec3, b: Vec3, c: Vec3): void {
    if (triArea2(a, b, c) < DEGENERATE_AREA2) return;
    this.colPositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.colTags.push(tag);
    this.colSurfaces.push(surfaceId);
    this.bound(surfaceId, a);
    this.bound(surfaceId, b);
    this.bound(surfaceId, c);
  }

  get colTriangleCount(): number {
    return this.colTags.length;
  }
}
