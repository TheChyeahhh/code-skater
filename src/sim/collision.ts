/**
 * src/sim/collision.ts (sim track): collision world over the level collider with three-mesh-bvh
 * (SPEC §4, REQ-CTL-01, REQ-CTL-22, REQ-LVL-11). No rigidbody engine.
 *
 * Build: a BufferGeometry from BuiltCollider.positions (non-indexed) and one MeshBVH over it.
 * Original triangle of a hit = Math.floor(hit.face.a / 3) (see BuiltCollider); read its tag and
 * surface id from triTag / triSurface. Rails and coping pipes are not in the collider.
 * Allowed three imports: math classes, BufferGeometry, BufferAttribute, sides (eslint enforces).
 *
 * Queries the controller uses every tick (well under 1 ms together on the parks):
 * - raycast: the ground probe along the surface normal, the swept feet segment for landings, the
 *   forward wall ray and the landing-prediction sweep. Double sided; `front` says whether the ray
 *   met the triangle's rideable (winding) side, so a launch off a face never "lands" on it again.
 * - sphereContacts: the air collision sphere (REQ-CTL-22).
 * - closestPoint: lip face normals and debug.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Sphere, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { SurfaceTag, Vec3 } from '../core/types';
import { type BuiltCollider, SURFACE_TAG_BY_CODE } from '../levels/types';

export interface SurfaceHit {
  readonly point: Vec3;
  /** Unit face normal, oriented toward the query origin / sphere centre. */
  readonly normal: Vec3;
  readonly distance: number;
  readonly tag: SurfaceTag;
  readonly surfaceId: string;
  /** Original triangle index into the collider arrays. */
  readonly triangle: number;
  /**
   * Extension (sim track): true when the query met the triangle's rideable side (its winding normal
   * faces the query origin). A ray leaving a surface from its front never reports front = true.
   */
  readonly front?: boolean;
  /** Extension (sim track): the triangle's winding (outward, rideable side) normal. */
  readonly faceNormal?: Vec3;
}

export interface CollisionWorld {
  /** First hit along a ray (dir need not be normalised), or null within maxDist. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): SurfaceHit | null;
  /** Closest surface point within maxDist of a point, or null. */
  closestPoint(point: Vec3, maxDist: number): SurfaceHit | null;
  /** Every triangle the sphere touches (air collision sphere, REQ-CTL-22), nearest first. */
  sphereContacts(center: Vec3, radius: number): readonly SurfaceHit[];
  readonly surfaceIds: readonly string[];
}

const EMPTY: CollisionWorld = {
  raycast: () => null,
  closestPoint: () => null,
  sphereContacts: () => [],
  surfaceIds: [],
};

export function createCollisionWorld(collider: BuiltCollider): CollisionWorld {
  if (collider.triangleCount === 0) return { ...EMPTY, surfaceIds: collider.surfaceIds };
  const geometry = new BufferGeometry();
  // Copy: MeshBVH writes an index into the geometry and reorders it; the collider stays untouched.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(collider.positions), 3));
  const bvh = new MeshBVH(geometry);
  const index = geometry.index;
  const pos = collider.positions;

  // Winding normal per original triangle, computed once.
  const faceN = new Float32Array(collider.triangleCount * 3);
  for (let t = 0; t < collider.triangleCount; t++) {
    const o = t * 9;
    const ax = pos[o] as number, ay = pos[o + 1] as number, az = pos[o + 2] as number;
    const ux = (pos[o + 3] as number) - ax, uy = (pos[o + 4] as number) - ay, uz = (pos[o + 5] as number) - az;
    const vx = (pos[o + 6] as number) - ax, vy = (pos[o + 7] as number) - ay, vz = (pos[o + 8] as number) - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    faceN[t * 3] = nx / l;
    faceN[t * 3 + 1] = ny / l;
    faceN[t * 3 + 2] = nz / l;
  }

  const ray = new Ray();
  const tmpV = new Vector3();
  const tmpTarget = new Vector3();
  const sphere = new Sphere();

  /** Reordered BVH triangle slot -> original collider triangle. */
  const original = (slot: number): number => {
    const a = index ? (index.array[slot * 3] as number) : slot * 3;
    return Math.floor(a / 3);
  };

  const hitFor = (tri: number, point: Vec3, distance: number, towardX: number, towardY: number, towardZ: number): SurfaceHit => {
    const fx = faceN[tri * 3] as number, fy = faceN[tri * 3 + 1] as number, fz = faceN[tri * 3 + 2] as number;
    const front = fx * towardX + fy * towardY + fz * towardZ >= 0;
    const s = front ? 1 : -1;
    return {
      point,
      normal: { x: fx * s + 0, y: fy * s + 0, z: fz * s + 0 },
      distance,
      tag: SURFACE_TAG_BY_CODE[collider.triTag[tri] as number] ?? 'solid',
      surfaceId: collider.surfaceIds[collider.triSurface[tri] as number] ?? '',
      triangle: tri,
      front,
      faceNormal: { x: fx, y: fy, z: fz },
    };
  };

  return {
    surfaceIds: collider.surfaceIds,

    raycast(origin, dir, maxDist) {
      tmpV.set(dir.x, dir.y, dir.z);
      const len = tmpV.length();
      if (len < 1e-12 || maxDist <= 0) return null;
      tmpV.multiplyScalar(1 / len);
      ray.origin.set(origin.x, origin.y, origin.z);
      ray.direction.copy(tmpV);
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, maxDist);
      if (!hit || !hit.face || hit.distance > maxDist) return null;
      const tri = Math.floor(hit.face.a / 3);
      // The origin side is "toward": against the ray direction.
      return hitFor(tri, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, hit.distance, -tmpV.x, -tmpV.y, -tmpV.z);
    },

    closestPoint(point, maxDist) {
      tmpV.set(point.x, point.y, point.z);
      const info = bvh.closestPointToPoint(tmpV, undefined, 0, maxDist);
      if (!info || info.distance > maxDist) return null;
      const tri = original(info.faceIndex);
      const p = info.point;
      return hitFor(tri, { x: p.x, y: p.y, z: p.z }, info.distance, point.x - p.x, point.y - p.y, point.z - p.z);
    },

    sphereContacts(center, radius) {
      const out: SurfaceHit[] = [];
      tmpV.set(center.x, center.y, center.z);
      sphere.set(tmpV, radius);
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sphere),
        intersectsTriangle: (triangle, slot) => {
          triangle.closestPointToPoint(tmpV, tmpTarget);
          const d = tmpTarget.distanceTo(tmpV);
          if (d > radius) return false;
          const tri = original(slot);
          out.push(hitFor(tri, { x: tmpTarget.x, y: tmpTarget.y, z: tmpTarget.z }, d, tmpV.x - tmpTarget.x, tmpV.y - tmpTarget.y, tmpV.z - tmpTarget.z));
          return false;
        },
      });
      out.sort((a, b) => a.distance - b.distance || a.triangle - b.triangle);
      return out;
    },
  };
}
