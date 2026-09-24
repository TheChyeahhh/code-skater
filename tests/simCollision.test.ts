// tests/simCollision.test.ts (sim track): the BVH collision world on a hand-built collider
// (ARCHITECTURE.md section 10: a BuiltCollider is a non-indexed Float32Array of triangles plus
// triTag / triSurface). Checks the query contract the controller relies on: first hit along a ray,
// the normal oriented toward the query and the rideable-side flag, the original triangle index
// after three-mesh-bvh reorders triangles, sphere contacts nearest first, closest point.
import { describe, expect, it } from 'vitest';
import type { BuiltCollider } from '../src/levels/types';
import { SURFACE_TAG_CODES } from '../src/levels/types';
import { createCollisionWorld } from '../src/sim/collision';

type V = readonly [number, number, number];

/** Quads as two counter-clockwise (seen from the rideable side) triangles each. */
function collider(quads: readonly { readonly corners: readonly [V, V, V, V]; readonly tag: keyof typeof SURFACE_TAG_CODES; readonly id: string }[]): BuiltCollider {
  const pos: number[] = [];
  const tags: number[] = [];
  const surf: number[] = [];
  const ids: string[] = [];
  for (const q of quads) {
    let si = ids.indexOf(q.id);
    if (si < 0) si = ids.push(q.id) - 1;
    const [a, b, c, d] = q.corners;
    for (const tri of [[a, b, c], [a, c, d]] as const) {
      for (const v of tri) pos.push(...v);
      tags.push(SURFACE_TAG_CODES[q.tag]);
      surf.push(si);
    }
  }
  return { positions: new Float32Array(pos), triangleCount: tags.length, triTag: new Uint8Array(tags), triSurface: new Uint16Array(surf), surfaceIds: ids };
}

// A floor (y 0, winding up), a wall at x 5 (winding east, so it is met from its back from the west:
// normals still point at the query), and 40 far blocks so the BVH reorders triangles.
const world = createCollisionWorld(collider([
  { id: 'FLOOR', tag: 'solid', corners: [[0, 0, 0], [0, 0, 10], [10, 0, 10], [10, 0, 0]] },
  { id: 'WALL', tag: 'transition', corners: [[5, 0, 0], [5, 3, 0], [5, 3, 10], [5, 0, 10]] },
  ...Array.from({ length: 40 }, (_, i) => ({ id: `B${i}`, tag: 'boundary' as const, corners: [[20 + i, 0, 0], [20 + i, 0, 1], [21 + i, 0, 1], [21 + i, 0, 0]] as [V, V, V, V] })),
]));

describe('collision world (REQ-CTL-01, REQ-CTL-22)', () => {
  it('a ray down hits the floor from above: rideable side, normal up, surface id and tag of the original triangle', () => {
    const hit = world.raycast({ x: 2, y: 1, z: 2 }, { x: 0, y: -2, z: 0 }, 5);
    expect(hit?.surfaceId).toBe('FLOOR');
    expect(hit?.tag).toBe('solid');
    expect(hit?.front).toBe(true);
    expect(hit?.normal.y).toBeCloseTo(1, 9);
    expect(hit?.distance).toBeCloseTo(1, 6);
    expect(hit?.point.y).toBeCloseTo(0, 6);
    expect([0, 1]).toContain(hit?.triangle);
  });

  it('from below the same floor reads its back side: front false, normal toward the origin', () => {
    const hit = world.raycast({ x: 2, y: -1, z: 2 }, { x: 0, y: 1, z: 0 }, 5);
    expect(hit?.surfaceId).toBe('FLOOR');
    expect(hit?.front).toBe(false);
    expect(hit?.normal.y).toBeCloseTo(-1, 9);
  });

  it('maxDist bounds the ray; the first hit along it wins (the wall before the far blocks)', () => {
    expect(world.raycast({ x: 2, y: 1, z: 2 }, { x: 0, y: -1, z: 0 }, 0.5)).toBeNull();
    const wall = world.raycast({ x: 0, y: 1, z: 5 }, { x: 1, y: 0, z: 0 }, 100);
    expect(wall?.surfaceId).toBe('WALL');
    expect(wall?.tag).toBe('transition');
    expect(wall?.normal.x).toBeCloseTo(-1, 9);
    expect(wall?.distance).toBeCloseTo(5, 6);
    // Triangle ids survive the BVH's reordering: every block reports its own id.
    for (const i of [0, 17, 39]) {
      expect(world.raycast({ x: 20.5 + i, y: 1, z: 0.5 }, { x: 0, y: -1, z: 0 }, 2)?.surfaceId).toBe(`B${i}`);
    }
  });

  it('sphere contacts list every touched triangle, nearest first, normals pointing at the centre', () => {
    const hits = world.sphereContacts({ x: 4.8, y: 0.3, z: 5 }, 0.35);
    // The wall's lower triangle (0.2 m), then both floor triangles (0.3 m, and 0.33 m to the diagonal).
    expect(hits.map((h) => h.surfaceId)).toEqual(['WALL', 'FLOOR', 'FLOOR']);
    expect(hits[2]?.distance).toBeCloseTo(Math.hypot(0.1, 0.3, 0.1), 6);
    expect(hits[0]?.distance).toBeCloseTo(0.2, 6);
    expect(hits[0]?.normal.x).toBeCloseTo(-1, 9);
    for (let i = 1; i < hits.length; i++) expect((hits[i]?.distance ?? 0) >= (hits[i - 1]?.distance ?? 0)).toBe(true);
    expect(world.sphereContacts({ x: 2, y: 2, z: 2 }, 0.35)).toEqual([]);
  });

  it('closest point finds the nearest surface within maxDist', () => {
    const c = world.closestPoint({ x: 4.5, y: 1.5, z: 5 }, 1);
    expect(c?.surfaceId).toBe('WALL');
    expect(c?.distance).toBeCloseTo(0.5, 6);
    expect(world.closestPoint({ x: 2, y: 5, z: 2 }, 1)).toBeNull();
  });

  it('an empty collider answers nothing', () => {
    const empty = createCollisionWorld({ positions: new Float32Array(0), triangleCount: 0, triTag: new Uint8Array(0), triSurface: new Uint16Array(0), surfaceIds: [] });
    expect(empty.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, 5)).toBeNull();
    expect(empty.sphereContacts({ x: 0, y: 0, z: 0 }, 1)).toEqual([]);
  });
});
