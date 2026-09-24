/**
 * src/levels/lib/bvh.ts (levels track): a three-mesh-bvh raycaster over a BuiltCollider, for the
 * builder (rail posts down to the surface below) and the validator (ground under the spawn and the
 * spawn-area grid, walls ahead of rail ends, buried rails, outward normals, a closed boundary).
 * Same recipe the sim uses (src/sim/collision.ts contract): a non-indexed BufferGeometry, one
 * MeshBVH, original triangle = floor(face.a / 3). Geometry only, no meshes.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { SurfaceTag, Vec3 } from '../../core/types';
import { type BuiltCollider, SURFACE_TAG_BY_CODE } from '../types';

export interface LevelRayHit {
  readonly point: Vec3;
  /** Geometric normal from the triangle winding (the outward / rideable side), not flipped toward the ray. */
  readonly normal: Vec3;
  readonly distance: number;
  readonly triangle: number;
  readonly tag: SurfaceTag;
  readonly surfaceId: string;
  /** True when the ray hit the triangle's outward side. */
  readonly front: boolean;
}

export interface LevelRaycaster {
  raycast(origin: Vec3, dir: Vec3, maxDist: number): LevelRayHit | null;
  readonly triangleCount: number;
}

const EMPTY: LevelRaycaster = { raycast: () => null, triangleCount: 0 };

export function createLevelRaycaster(collider: BuiltCollider): LevelRaycaster {
  if (collider.triangleCount === 0) return EMPTY;
  const geometry = new BufferGeometry();
  // Copy: MeshBVH writes an index into the geometry and reorders it.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(collider.positions), 3));
  const bvh = new MeshBVH(geometry);
  const ray = new Ray();
  const dirV = new Vector3();
  const pos = collider.positions;
  return {
    triangleCount: collider.triangleCount,
    raycast(origin, dir, maxDist) {
      dirV.set(dir.x, dir.y, dir.z);
      const len = dirV.length();
      if (len === 0) return null;
      dirV.multiplyScalar(1 / len);
      ray.origin.set(origin.x, origin.y, origin.z);
      ray.direction.copy(dirV);
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, maxDist);
      if (!hit || !hit.face || hit.distance > maxDist) return null;
      const tri = Math.floor(hit.face.a / 3);
      const o = tri * 9;
      const ax = pos[o] as number, ay = pos[o + 1] as number, az = pos[o + 2] as number;
      const ux = (pos[o + 3] as number) - ax, uy = (pos[o + 4] as number) - ay, uz = (pos[o + 5] as number) - az;
      const vx = (pos[o + 6] as number) - ax, vy = (pos[o + 7] as number) - ay, vz = (pos[o + 8] as number) - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      return {
        point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        normal: { x: nx, y: ny, z: nz },
        distance: hit.distance,
        triangle: tri,
        tag: SURFACE_TAG_BY_CODE[collider.triTag[tri] as number] ?? 'solid',
        surfaceId: collider.surfaceIds[collider.triSurface[tri] as number] ?? '',
        front: nx * dirV.x + ny * dirV.y + nz * dirV.z < 0,
      };
    },
  };
}
