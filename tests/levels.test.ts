// tests/levels.test.ts (levels track): the level builder and SPEC §9.2 / DESIGN G.3 validation.
// Builder: tags (REQ-LVL-09), outward normals, BVH raycasts on the ramp surfaces, rail emission
// (SPEC §1.5: every visible grindable edge snaps), pipes out of the collider and a closed boundary
// (REQ-LVL-11), world UVs and fake AO (REQ-REN-03), triggers (REQ-LVL-08), decals.
// Validation: each rule seen passing on the test box and the all-kinds fixture, and FAILING on a
// deliberate break (REQ-LVL-03, 04, 05, 06, 10, 11, 12, REQ-NPC-04, schema), plus every registered
// level that has content.
import { describe, expect, it } from 'vitest';
import { xzy } from '../src/core/math';
import { TUNING } from '../src/core/tuning';
import type { Vec3 } from '../src/core/types';
import { buildLevel, decalCorners } from '../src/levels/builder';
import { createLevelRaycaster } from '../src/levels/lib/bvh';
import { distToPolyline, samplePolyline } from '../src/levels/lib/grindLines';
import { emittedRails, levelGrindLines } from '../src/levels/lib/rails';
import { buildPrimitive } from '../src/levels/primitives';
import { loadLevelDef, LEVEL_IDS } from '../src/levels/registry';
import { TEST_BOX, TEST_BOX_KNOWN_RAIL_ID } from '../src/levels/testBox';
import {
  type BuiltCollider, type BuiltLevel, type LevelDef, type LevelViolation, type Primitive, type RailDef, SURFACE_TAG_CODES,
  TRANSITION_KINDS,
} from '../src/levels/types';
import { measureFeed, simulateFeedHop, validateLevel } from '../src/levels/validate';
import { ALL_KINDS } from './fixtures/levels/allKinds';

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

function rulesOf(v: readonly LevelViolation[]): string[] {
  return [...new Set(v.map((x) => x.rule))].sort();
}

function describeViolations(v: readonly LevelViolation[]): string {
  return v.map((x) => `${x.rule} [${x.ids.join(',')}] ${x.message}`).join('\n');
}

/** A copy of def with a patch applied to primitives / rails / other fields. */
function patched(def: LevelDef, patch: Partial<LevelDef>): LevelDef {
  return { ...def, ...patch };
}

function withoutRail(def: LevelDef, id: string): LevelDef {
  return patched(def, { rails: def.rails.filter((r) => r.id !== id) });
}

function replaceRail(def: LevelDef, id: string, rail: RailDef): LevelDef {
  return patched(def, { rails: def.rails.map((r) => (r.id === id ? rail : r)) });
}

function tri(c: BuiltCollider, t: number): { a: Vec3; b: Vec3; c: Vec3; n: Vec3 } {
  const p = c.positions;
  const o = t * 9;
  const a = { x: p[o] as number, y: p[o + 1] as number, z: p[o + 2] as number };
  const b = { x: p[o + 3] as number, y: p[o + 4] as number, z: p[o + 5] as number };
  const cc = { x: p[o + 6] as number, y: p[o + 7] as number, z: p[o + 8] as number };
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const w = { x: cc.x - a.x, y: cc.y - a.y, z: cc.z - a.z };
  const n = { x: u.y * w.z - u.z * w.y, y: u.z * w.x - u.x * w.z, z: u.x * w.y - u.y * w.x };
  const l = Math.hypot(n.x, n.y, n.z) || 1;
  return { a, b, c: cc, n: { x: n.x / l, y: n.y / l, z: n.z / l } };
}

function trianglesOf(built: BuiltLevel, surfaceId: string): number[] {
  const k = built.collider.surfaceIds.indexOf(surfaceId);
  const out: number[] = [];
  for (let t = 0; t < built.collider.triangleCount; t++) if (built.collider.triSurface[t] === k) out.push(t);
  return out;
}

function inRect(x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number } | undefined): boolean {
  return !!r && x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6;
}

const tb = buildLevel(TEST_BOX);
const tbRay = createLevelRaycaster(tb.collider);
const lab = buildLevel(ALL_KINDS);
const labRay = createLevelRaycaster(lab.collider);

// ---------------------------------------------------------------------------------------------
// Test box: layout contract for the sim track and e2e
// ---------------------------------------------------------------------------------------------

describe('test box (src/levels/testBox.ts)', () => {
  it('is valid: validateLevel returns no violations', () => {
    const v = validateLevel(TEST_BOX, tb);
    expect(v, describeViolations(v)).toEqual([]);
  });

  it('has the documented known rail, straight ahead of spawn, grindable from a ground snap', () => {
    expect(TEST_BOX_KNOWN_RAIL_ID).toBe('TB-RAIL');
    const r = tb.rails.find((x) => x.id === TEST_BOX_KNOWN_RAIL_ID);
    expect(r).toBeDefined();
    expect(r?.kind).toBe('rail');
    expect(r?.length).toBeCloseTo(20, 6);
    expect(r?.points).toEqual([xzy(40, 40, 0.55), xzy(40, 20, 0.55)]);
    // Spawn faces north (yaw 0), on the rail's line, 6 m before its start.
    expect(tb.spawn.pos).toEqual(xzy(40, 46, 0));
    expect(tb.spawn.yaw).toBe(0);
    expect(r?.segments[0]?.tangent.z).toBeCloseTo(-1, 9);
  });

  it('carries every documented id: vert QP, mini QP, bank, kicker, ledge, pad, spine with transfer edges, stairs + handrail, wall', () => {
    const ids = TEST_BOX.primitives.map((p) => p.id);
    for (const id of ['TB-FLOOR', 'TB-VERT', 'TB-MINI', 'TB-BANK', 'TB-KICK', 'TB-LEDGE', 'TB-PAD', 'TB-SPINE', 'TB-STAIRS', 'TB-STAIRTOP', 'TB-WALL']) {
      expect(ids).toContain(id);
      expect(tb.surfaces[id], id).toBeDefined();
    }
    for (const id of ['TB-SPINE-W', 'TB-SPINE-E']) {
      const r = tb.rails.find((x) => x.id === id);
      expect(r?.tags).toContain('transfer');
      expect(r?.transferPlane).toEqual({ axis: 'x', at: 14 });
    }
    // All authored; the builder had nothing to add.
    expect(tb.rails.map((r) => r.id).sort()).toEqual(['TB-HANDRAIL', 'TB-LEDGE', 'TB-MINI-C', 'TB-RAIL', 'TB-SPINE-E', 'TB-SPINE-W', 'TB-VERT-C']);
    expect(TEST_BOX.gaps.find((g) => g.id === 'TB-G01')?.rule.kind).toBe('transferOn');
  });

  it('the wall faces the spawn plaza for head-on bails', () => {
    const hit = tbRay.raycast({ x: 50, y: 1, z: 46 }, { x: 1, y: 0, z: 0 }, 30);
    expect(hit?.surfaceId).toBe('TB-WALL');
    expect(hit?.point.x).toBeCloseTo(64, 5);
    expect(hit?.normal.x).toBeCloseTo(-1, 5);
    expect(hit?.front).toBe(true);
    expect(hit?.tag).toBe('solid');
  });
});

// ---------------------------------------------------------------------------------------------
// Builder: collider, tags, normals, BVH raycasts
// ---------------------------------------------------------------------------------------------

describe('builder: collider surfaces and BVH raycasts (REQ-LVL-01, REQ-LVL-09)', () => {
  it('a ray down onto the vert quarter-pipe hits its transition face at the profile height, facing the approach', () => {
    // R 3.0 circle tangent at the foot z 7: at z 6 (1 m from the foot) h = 3 - sqrt(9 - 1).
    const hit = tbRay.raycast({ x: 32, y: 10, z: 6 }, DOWN, 20);
    expect(hit?.surfaceId).toBe('TB-VERT');
    expect(hit?.tag).toBe('transition');
    expect(hit?.point.y).toBeCloseTo(3 - Math.sqrt(8), 2);
    expect(hit?.front).toBe(true);
    expect(hit?.normal.y).toBeGreaterThan(0);
    expect(hit?.normal.z).toBeGreaterThan(0);
  });

  it('a horizontal ray into the vert extension hits a vertical transition wall just below the coping', () => {
    const hit = tbRay.raycast({ x: 32, y: 3.3, z: 12 }, { x: 0, y: 0, z: -1 }, 20);
    expect(hit?.surfaceId).toBe('TB-VERT');
    expect(hit?.tag).toBe('transition');
    expect(hit?.point.z).toBeCloseTo(4, 3);
    expect(hit?.normal.z).toBeCloseTo(1, 3);
    expect(hit?.front).toBe(true);
  });

  it('the deck behind the coping is solid flat at the coping height', () => {
    const hit = tbRay.raycast({ x: 32, y: 10, z: 3 }, DOWN, 20);
    expect(hit?.surfaceId).toBe('TB-VERT');
    expect(hit?.tag).toBe('solid');
    expect(hit?.point.y).toBeCloseTo(3.6, 5);
    expect(hit?.normal.y).toBeCloseTo(1, 6);
  });

  it('curved faces step at most LEVELS_ARC_SEG_DEG between facets (smooth for a raycast controller)', () => {
    const tris = trianglesOf(tb, 'TB-VERT').filter((t) => tb.collider.triTag[t] === SURFACE_TAG_CODES.transition);
    const angles = [...new Set(tris.map((t) => Math.round((Math.atan2(tri(tb.collider, t).n.z, tri(tb.collider, t).n.y) * 180) / Math.PI * 100) / 100))].sort((a, b) => a - b);
    // Facet normals sit mid-facet: the first within one step of flat, the last at the 90 deg vert extension.
    expect(angles[0]).toBeLessThanOrEqual(TUNING.LEVELS_ARC_SEG_DEG);
    expect(angles[angles.length - 1]).toBeCloseTo(90, 3);
    for (let i = 1; i < angles.length; i++) expect((angles[i] as number) - (angles[i - 1] as number)).toBeLessThanOrEqual(TUNING.LEVELS_ARC_SEG_DEG + 1e-6);
  });

  it('bank, kicker and spine faces tilt the right way; banks and kickers are solid, spines transition', () => {
    const bank = tbRay.raycast({ x: 7, y: 5, z: 25 }, DOWN, 10);
    expect(bank?.surfaceId).toBe('TB-BANK');
    expect(bank?.tag).toBe('solid');
    expect(bank?.point.y).toBeCloseTo(0.6, 5);
    expect(bank?.normal.x).toBeGreaterThan(0.1); // downhill east
    const kick = tbRay.raycast({ x: 21, y: 5, z: 40 }, DOWN, 10);
    expect(kick?.surfaceId).toBe('TB-KICK');
    expect(kick?.point.y).toBeCloseTo(0.3, 5);
    expect(kick?.normal.x).toBeGreaterThan(0.1); // rises west, so it faces the east approach
    const west = tbRay.raycast({ x: 12.5, y: 5, z: 16 }, DOWN, 10);
    const east = tbRay.raycast({ x: 15.5, y: 5, z: 16 }, DOWN, 10);
    expect(west?.tag).toBe('transition');
    expect(east?.tag).toBe('transition');
    expect(west?.normal.x).toBeLessThan(0);
    expect(east?.normal.x).toBeGreaterThan(0);
    const deck = tbRay.raycast({ x: 14, y: 5, z: 16 }, DOWN, 10);
    expect(deck?.point.y).toBeCloseTo(1.8, 5);
  });

  it('stairs step down by drop / steps; the ledge and pad tops are flat solid', () => {
    for (let k = 0; k < 6; k++) {
      const hit = tbRay.raycast({ x: 64, y: 5, z: 20.4 + 0.8 * k }, DOWN, 10);
      expect(hit?.surfaceId).toBe('TB-STAIRS');
      expect(hit?.point.y).toBeCloseTo(1.2 - 0.2 * k, 5);
    }
    expect(tbRay.raycast({ x: 46.3, y: 5, z: 26 }, DOWN, 10)?.point.y).toBeCloseTo(0.45, 5);
    expect(tbRay.raycast({ x: 54, y: 5, z: 30 }, DOWN, 10)?.point.y).toBeCloseTo(0.15, 5);
  });

  it('every other curved kind rides as a transition with its rideable side out (bowl, fountain, full-pipe, channel, hump)', () => {
    const bowlWall = labRay.raycast({ x: 7, y: 5, z: 16 }, DOWN, 20);
    expect(bowlWall?.surfaceId).toBe('LB-BOWL');
    expect(bowlWall?.tag).toBe('transition');
    expect(bowlWall?.normal.x).toBeGreaterThan(0); // west wall faces east, into the bowl
    const bowlFloor = labRay.raycast({ x: 16, y: 5, z: 16 }, DOWN, 20);
    expect(bowlFloor?.surfaceId).toBe('LB-BOWL');
    expect(bowlFloor?.tag).toBe('solid');
    expect(bowlFloor?.point.y).toBeCloseTo(-2.4, 5);
    const face = labRay.raycast({ x: 40 + 3.7, y: 5, z: 16 }, DOWN, 20);
    expect(face?.surfaceId).toBe('LB-FOUNT');
    expect(face?.tag).toBe('transition');
    expect(face?.normal.x).toBeGreaterThan(0);
    const basin = labRay.raycast({ x: 40, y: 5, z: 16 }, DOWN, 20);
    expect(basin?.point.y).toBeCloseTo(0.3, 5);
    // Inside the full-pipe: up hits the ceiling from its rideable (inner) side, down hits the floor at y 0.
    const ceiling = labRay.raycast({ x: 67, y: 1, z: 16 }, { x: 0, y: 1, z: 0 }, 20);
    expect(ceiling?.surfaceId).toBe('LB-PIPE');
    expect(ceiling?.tag).toBe('transition');
    expect(ceiling?.front).toBe(true);
    expect(ceiling?.point.y).toBeCloseTo(8, 2);
    const pipeFloor = labRay.raycast({ x: 67, y: 1, z: 16 }, DOWN, 20);
    expect(pipeFloor?.surfaceId).toBe('LB-PIPE');
    expect(pipeFloor?.point.y).toBeCloseTo(0, 2);
    const snakeWall = labRay.raycast({ x: 18, y: 5, z: 42.3 }, DOWN, 20);
    expect(snakeWall?.surfaceId).toBe('LB-SNAKE');
    expect(snakeWall?.tag).toBe('transition');
    const snakeFloor = labRay.raycast({ x: 18, y: 5, z: 40 }, DOWN, 20);
    expect(snakeFloor?.tag).toBe('solid');
    expect(snakeFloor?.point.y).toBeCloseTo(-1.2, 5);
    const hump = labRay.raycast({ x: 70, y: 5, z: 44 }, DOWN, 20);
    expect(hump?.tag).toBe('transition');
    expect(hump?.point.y).toBeCloseTo(0.8, 2);
  });

  it('full-pipe flanks are vertical walls down to the floor: no wedge under the round shell (lab and Woodshed WS-FP1)', async () => {
    const ws = await loadLevelDef('woodshed');
    const wsRay = createLevelRaycaster(buildLevel(ws).collider);
    // [raycaster, surface id, axis z, x range, axis y, radius]
    const pipes = [
      [labRay, 'LB-PIPE', 16, [55, 80], 4, 4],
      [wsRay, 'WS-FP1', 30, [50, 76], 4, 4],
    ] as const;
    for (const [ray, id, zc, [x0, x1], ay, r] of pipes) {
      const outer = r + TUNING.LEVELS_FULLPIPE_SHELL_M;
      for (const x of [x0 + 0.5, (x0 + x1) / 2, x1 - 0.5]) {
        for (const y of [0.05, 0.2, 0.5, 1.5, ay - 0.3]) {
          for (const sgn of [-1, 1]) {
            // Roll at the pipe's side from 3 m out: the first thing hit is its flank, flush at the
            // shell's widest point and facing straight out (a wall the controller can bail or slide on).
            const hit = ray.raycast({ x, y, z: zc + sgn * (outer + 3) }, { x: 0, y: 0, z: -sgn }, 6);
            const where = `${id} x ${x} y ${y} side ${sgn}`;
            expect(hit?.surfaceId, where).toBe(id);
            expect(hit?.tag, where).toBe('solid');
            expect(Math.abs(hit?.normal.y ?? 1), where).toBeLessThan(0.05);
            expect((hit?.normal.z ?? 0) * sgn, where).toBeGreaterThan(0.99);
            expect(Math.abs((hit?.point.z ?? 0) - zc), where).toBeCloseTo(outer, 2);
          }
        }
      }
      // At each mouth, beside the opening, the wedge is closed too: along the axis toward the pipe
      // at floor height, 2.3 m off the axis (outside the shell, inside the flank) hits a wall facing out.
      for (const [xo, dx] of [[x0 - 3, 1], [x1 + 3, -1]] as const) {
        for (const sgn of [-1, 1]) {
          const hit = ray.raycast({ x: xo, y: 0.1, z: zc + sgn * 2.3 }, { x: dx, y: 0, z: 0 }, 6);
          const where = `${id} mouth ${dx} side ${sgn}`;
          expect(hit?.surfaceId, where).toBe(id);
          expect(hit?.tag, where).toBe('solid');
          expect((hit?.normal.x ?? 0) * dx, where).toBeLessThan(-0.99);
        }
      }
      // The mouth itself stays open: rolling in along the axis at floor height meets nothing at the mouth.
      const inside = ray.raycast({ x: x0 - 3, y: 0.3, z: zc }, { x: 1, y: 0, z: 0 }, 3 + (x1 - x0) / 2);
      expect(inside, `${id} mouth open`).toBeNull();
    }
  });

  it('REQ-LVL-09: exactly the TRANSITION_KINDS carry transition triangles; boxes, banks and ramps never do', () => {
    for (const built of [tb, lab]) {
      const kindOf = new Map(built.def.primitives.map((p) => [p.id, p.kind]));
      const withTransition = new Set<string>();
      for (let t = 0; t < built.collider.triangleCount; t++) {
        if (built.collider.triTag[t] !== SURFACE_TAG_CODES.transition) continue;
        withTransition.add(built.collider.surfaceIds[built.collider.triSurface[t] as number] as string);
      }
      for (const id of withTransition) expect(TRANSITION_KINDS, id).toContain(kindOf.get(id));
      for (const p of built.def.primitives) if (TRANSITION_KINDS.includes(p.kind)) expect(withTransition.has(p.id), p.id).toBe(true);
    }
  });

  it('ground triangles face up; boundary walls face into the park', () => {
    for (const t of trianglesOf(tb, 'TB-FLOOR')) expect(tri(tb.collider, t).n.y).toBeGreaterThan(0.999);
    const inward: Record<string, Vec3> = {
      'boundary-north': { x: 0, y: 0, z: 1 }, 'boundary-south': { x: 0, y: 0, z: -1 },
      'boundary-west': { x: 1, y: 0, z: 0 }, 'boundary-east': { x: -1, y: 0, z: 0 },
    };
    for (const [id, n] of Object.entries(inward)) {
      const ts = trianglesOf(tb, id);
      expect(ts.length, id).toBeGreaterThan(0);
      for (const t of ts) {
        const tn = tri(tb.collider, t).n;
        expect(tn.x * n.x + tn.z * n.z, id).toBeCloseTo(1, 6);
        expect(tb.collider.triTag[t]).toBe(SURFACE_TAG_CODES.boundary);
      }
    }
  });

  it('REQ-LVL-11: the boundary is closed at h 12 around the size rectangle', () => {
    for (const [dir, x, z] of [[{ x: 1, y: 0, z: 0 }, 80, null], [{ x: -1, y: 0, z: 0 }, 0, null], [{ x: 0, y: 0, z: 1 }, null, 60], [{ x: 0, y: 0, z: -1 }, null, 0]] as const) {
      const hit = tbRay.raycast({ x: 40, y: 11.5, z: 46 }, dir, 200);
      expect(hit?.tag).toBe('boundary');
      if (x !== null) expect(hit?.point.x).toBeCloseTo(x, 5);
      if (z !== null) expect(hit?.point.z).toBeCloseTo(z, 5);
    }
    expect(tbRay.raycast({ x: 40, y: 12.5, z: 46 }, { x: 1, y: 0, z: 0 }, 200)).toBeNull();
  });

  it('REQ-LVL-11: rail and coping pipes are rendered but never in the collider (a ray through a flat bar hits nothing)', () => {
    const bar = tbRay.raycast({ x: 39.5, y: 0.52, z: 30 }, { x: 1, y: 0, z: 0 }, 1);
    expect(bar).toBeNull();
    const rail = tb.parts.filter((p) => p.role === 'rail');
    const coping = tb.parts.filter((p) => p.role === 'coping');
    expect(rail.length).toBeGreaterThan(0);
    expect(coping.length).toBeGreaterThan(0);
    for (const p of [...rail, ...coping]) expect(tb.collider.surfaceIds).not.toContain(p.surfaceId);
    // The handrail pipe primitive renders only.
    expect(tb.surfaces['TB-HANDRAIL-PIPE']).toBeDefined();
    expect(tb.collider.surfaceIds).not.toContain('TB-HANDRAIL-PIPE');
  });

  it('the collider is a non-indexed soup with one tag and one surface per triangle', () => {
    for (const b of [tb, lab]) {
      expect(b.collider.positions.length).toBe(b.collider.triangleCount * 9);
      expect(b.collider.triTag.length).toBe(b.collider.triangleCount);
      expect(b.collider.triSurface.length).toBe(b.collider.triangleCount);
      for (let t = 0; t < b.collider.triangleCount; t++) expect(b.collider.surfaceIds[b.collider.triSurface[t] as number]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Builder: render descriptors
// ---------------------------------------------------------------------------------------------

describe('builder: render parts (REQ-REN-03, REQ-MAT-01)', () => {
  it('parts merge static geometry by material and role (few draw calls)', () => {
    const keys = new Set(tb.parts.map((p) => `${p.material}|${p.role}|${p.castShadow}|${p.receiveShadow}|${p.surfaceId}`));
    expect(keys.size).toBe(tb.parts.length);
    expect(tb.parts.length).toBeLessThanOrEqual(16);
    expect(lab.parts.length).toBeLessThanOrEqual(32);
    // Billboard faces stay one part per billboard so LevelView can find them by id.
    expect(lab.parts.filter((p) => p.role === 'sign').map((p) => p.surfaceId)).toEqual(['LB-BB']);
  });

  it('every part has position, normal, uv and an AO color in [0, 1]; concave corners are darker', () => {
    for (const p of [...tb.parts, ...lab.parts]) {
      for (const a of ['position', 'normal', 'uv', 'color']) expect(p.geometry.hasAttribute(a), `${p.id} ${a}`).toBe(true);
      const c = p.geometry.getAttribute('color');
      for (let i = 0; i < c.count; i++) {
        expect(c.getX(i)).toBeGreaterThanOrEqual(0);
        expect(c.getX(i)).toBeLessThanOrEqual(1);
      }
    }
    // Floor vertices next to the wall's base are darker than open floor.
    const floor = tb.parts.find((p) => p.material === 'concrete' && p.role === 'surface' && !p.castShadow);
    expect(floor).toBeDefined();
    if (!floor) return;
    const pos = floor.geometry.getAttribute('position');
    const col = floor.geometry.getAttribute('color');
    let nearWall = 1, open = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x - 64) < 0.01 && z > 40 && z < 50) nearWall = Math.min(nearWall, col.getX(i));
      if (Math.abs(x - 40) < 0.01 && Math.abs(z - 50) < 0.01) open = col.getX(i);
    }
    expect(open).toBe(1);
    expect(nearWall).toBeLessThan(0.7);
    // The quarter-pipe face is darker at its foot than at the coping.
    const maple = tb.parts.find((p) => p.material === 'maple' && p.role === 'surface');
    expect(maple).toBeDefined();
    if (!maple) return;
    const mp = maple.geometry.getAttribute('position');
    const mc = maple.geometry.getAttribute('color');
    let foot = 1, top = 0;
    for (let i = 0; i < mp.count; i++) {
      if (mp.getX(i) < 24 || mp.getX(i) > 40) continue;
      if (Math.abs(mp.getZ(i) - 7) < 0.01 && mp.getY(i) < 0.01) foot = Math.min(foot, mc.getX(i));
      if (Math.abs(mp.getY(i) - 3.6) < 0.01 && Math.abs(mp.getZ(i) - 4) < 0.01) top = Math.max(top, mc.getX(i));
    }
    expect(foot).toBeLessThan(top);
  });

  it('UVs are world metres, so 2.4 m plywood seams line up across primitives', () => {
    // Every test-box surface, and every plywood (maple) surface of the all-kinds lab.
    for (const p of [...tb.parts, ...lab.parts.filter((x) => x.material === 'maple' || x.material === 'mapleDark')].filter((x) => x.role === 'surface')) {
      const pos = p.geometry.getAttribute('position');
      const uv = p.geometry.getAttribute('uv');
      const nor = p.geometry.getAttribute('normal');
      for (let i = 0; i < pos.count; i++) {
        if (nor.getY(i) < 0.999) continue; // flat up-facing surfaces (and ramp feet) map (x, z) exactly
        // Swept surfaces map along their own path: sunken wall feet (bowl) and the snake run's end ramps.
        if (lab.parts.includes(p) && (pos.getY(i) < -0.01 || inRect(pos.getX(i), pos.getZ(i), lab.surfaces['LB-SNAKE']?.footprint))) continue;
        expect(uv.getX(i)).toBeCloseTo(pos.getX(i), 4);
        expect(uv.getY(i)).toBeCloseTo(pos.getZ(i), 4);
      }
    }
    // The quarter-pipe face runs u along its span in world x.
    const maple = tb.parts.find((p) => p.material === 'maple' && p.role === 'surface');
    const pos = maple?.geometry.getAttribute('position');
    const uv = maple?.geometry.getAttribute('uv');
    if (!pos || !uv) throw new Error('no maple part');
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) >= 24) expect(uv.getX(i)).toBeCloseTo(pos.getX(i), 4); // both QPs face south; the spine (x < 17) runs along z
  });

  it('render normals agree with the triangle winding (outward faces)', () => {
    for (const p of [...tb.parts, ...lab.parts]) {
      const pos = p.geometry.getAttribute('position');
      const nor = p.geometry.getAttribute('normal');
      const idx = p.geometry.getIndex();
      if (!idx) throw new Error(`${p.id} not indexed`);
      let bad = 0;
      for (let t = 0; t < idx.count; t += 3) {
        const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        const u = { x: pos.getX(b) - pos.getX(a), y: pos.getY(b) - pos.getY(a), z: pos.getZ(b) - pos.getZ(a) };
        const w = { x: pos.getX(c) - pos.getX(a), y: pos.getY(c) - pos.getY(a), z: pos.getZ(c) - pos.getZ(a) };
        const fn = { x: u.y * w.z - u.z * w.y, y: u.z * w.x - u.x * w.z, z: u.x * w.y - u.y * w.x };
        const vn = { x: nor.getX(a) + nor.getX(b) + nor.getX(c), y: nor.getY(a) + nor.getY(b) + nor.getY(c), z: nor.getZ(a) + nor.getZ(b) + nor.getZ(c) };
        if (fn.x * vn.x + fn.y * vn.y + fn.z * vn.z < 0) bad += 1;
      }
      expect(bad, p.id).toBe(0);
    }
  });

  it('buildPrimitive builds any single kind stand-alone', () => {
    const rails = new Map(ALL_KINDS.rails.map((r) => [r.id, r]));
    for (const p of ALL_KINDS.primitives) {
      const out = buildPrimitive(p, { rails });
      if (p.kind === 'railPipe') {
        expect(out.collider.tags.length).toBe(0);
        continue;
      }
      expect(out.parts.length, p.id).toBeGreaterThan(0);
      expect(out.collider.positions.length).toBe(out.collider.tags.length * 9);
      if (p.kind === 'prop' && !p.collidable) expect(out.collider.tags.length).toBe(0);
      else expect(out.collider.tags.length, p.id).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Builder: rail network (SPEC §1.5, REQ-LVL-02, REQ-GRD-01)
// ---------------------------------------------------------------------------------------------

describe('builder: rails and rail emission', () => {
  it('every visible grind edge of every primitive has a built rail within 0.1 m (auto rails included)', () => {
    for (const built of [tb, lab]) {
      for (const line of levelGrindLines(built.def)) {
        for (const s of samplePolyline(line.points, 0.25)) {
          let d = Infinity;
          for (const r of built.rails) d = Math.min(d, distToPolyline(s, r.points));
          expect(d, `${line.primId} ${line.key}`).toBeLessThanOrEqual(TUNING.LEVELS_COVERAGE_TOL_M);
        }
      }
    }
  });

  it('emits rails for visible edges the data leaves out, with stable ids (funbox deck edges)', () => {
    const ids = lab.rails.map((r) => r.id);
    expect(ids).toContain('LB-FUN:edge-north');
    expect(ids).toContain('LB-FUN:edge-south');
    const n = lab.rails.find((r) => r.id === 'LB-FUN:edge-north');
    expect(n?.kind).toBe('ledge');
    expect(n?.points).toEqual([xzy(80, 36, 0.8), xzy(86, 36, 0.8)]);
    // Stable: a second build emits the same ids and points.
    expect(buildLevel(ALL_KINDS).rails.map((r) => [r.id, r.points])).toEqual(lab.rails.map((r) => [r.id, r.points]));
    // Only the uncovered edges: the authored ones are never duplicated.
    expect(emittedRails(ALL_KINDS).map((e) => e.rail.id)).toEqual(['LB-FUN:edge-north', 'LB-FUN:edge-south']);
  });

  it('a primitive whose named coping rail is missing still gets it under that id (and the validator reports it)', () => {
    const def = withoutRail(TEST_BOX, 'TB-MINI-C');
    const built = buildLevel(def);
    const r = built.rails.find((x) => x.id === 'TB-MINI-C');
    expect(r?.kind).toBe('coping');
    expect(r?.points).toEqual([xzy(44, 4, 1.5), xzy(56, 4, 1.5)]);
    const v = validateLevel(def, built);
    expect(rulesOf(v)).toEqual(['REQ-LVL-03', 'schema']);
  });

  it('a ledge, a hubba, a grindable box edge and a spine peak with no authored rail are emitted', () => {
    const noLedge = buildLevel(withoutRail(TEST_BOX, 'TB-LEDGE'));
    const ledge = noLedge.rails.find((x) => x.id === 'TB-LEDGE:top');
    expect(ledge?.points).toEqual([xzy(46.3, 18, 0.45), xzy(46.3, 34, 0.45)]);
    const noHubba = buildLevel(withoutRail(ALL_KINDS, 'LB-HUBBA'));
    expect(noHubba.rails.find((x) => x.id === 'LB-HUBBA:top')?.points).toEqual([xzy(50, 58.2, 1.4), xzy(52.5, 58.2, 0.4), xzy(54, 58.2, 0.4)]);
    // Its neighbours' rails touch the corners: the edge is still emitted whole under its plain id.
    const noEdge = buildLevel(withoutRail(ALL_KINDS, 'LB-STEP-N'));
    expect(noEdge.rails.find((x) => x.id === 'LB-STEP:edge-north')?.points).toEqual([xzy(32, 68, 0.5), xzy(26, 68, 0.5)]);
    const noPeak = buildLevel(withoutRail(ALL_KINDS, 'LB-SPINE-P'));
    expect(noPeak.rails.find((x) => x.id === 'LB-SPINE-P')?.points).toEqual([xzy(44, 34, 2), xzy(58, 34, 2)]);
  });

  it('a partly covered edge emits only its uncovered run', () => {
    // Cut the authored ledge rail to its south half: the north half is emitted as run 0.
    const def = replaceRail(TEST_BOX, 'TB-LEDGE', { id: 'TB-LEDGE', kind: 'ledge', points: [xzy(46.3, 34, 0.45), xzy(46.3, 26, 0.45)] });
    const e = emittedRails(def);
    expect(e.map((x) => x.rail.id)).toEqual(['TB-LEDGE:top:0']);
    const pts = e[0]?.rail.points ?? [];
    expect(pts[0]?.z).toBeCloseTo(18, 6);
    expect(pts[pts.length - 1]?.z).toBeLessThan(26);
    expect(pts[pts.length - 1]?.z).toBeGreaterThan(25.5);
  });

  it('BuiltRail segments carry arc length, tangents and bends; closed loops wrap', () => {
    const hand = tb.rails.find((r) => r.id === 'TB-HANDRAIL');
    expect(hand?.length).toBeCloseTo(Math.hypot(4.8, 1.2), 6);
    expect(hand?.segments[0]?.bendToNextDeg).toBe(0);
    const rainbow = lab.rails.find((r) => r.id === 'LB-RAINBOW');
    expect(rainbow?.segments.length).toBe(4);
    expect(rainbow?.segments[1]?.start).toBeCloseTo(Math.hypot(3, 0.6), 6);
    expect(rainbow?.segments[0]?.bendToNextDeg).toBeGreaterThan(5);
    const bowl = lab.rails.find((r) => r.id === 'LB-BOWL-C');
    expect(bowl?.closed).toBe(true);
    const last = bowl?.segments[bowl.segments.length - 1];
    expect(last?.b).toEqual(bowl?.segments[0]?.a);
    expect(Number.isFinite(last?.bendToNextDeg)).toBe(true);
  });

  it('coping pipes follow the coping rails; the pipe rule gives ledges no pipe', () => {
    const coping = lab.parts.find((p) => p.role === 'coping');
    expect(coping?.material).toBe('steelCoping');
    const railParts = lab.parts.filter((p) => p.role === 'rail').map((p) => p.material).sort();
    expect(railParts).toEqual(['scaffold', 'steelRail']);
    // Pipe vertices lie within the pipe radius of some rail: no stray pipe.
    const pos = coping?.geometry.getAttribute('position');
    if (!pos) throw new Error('no coping part');
    const copings = lab.rails.filter((r) => r.kind === 'coping');
    for (let i = 0; i < pos.count; i += 17) {
      const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      let d = Infinity;
      for (const r of copings) d = Math.min(d, distToPolyline(p, r.points));
      expect(d).toBeLessThanOrEqual(TUNING.LEVELS_COPING_PIPE_R_M + 1e-3);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Builder: triggers, decals, surfaces (REQ-LVL-08)
// ---------------------------------------------------------------------------------------------

describe('builder: triggers, decals, surfaces', () => {
  it('REQ-LVL-08: letters, MacGuffin and NPC talk triggers with radius 0 = read the tuning radius live', () => {
    const kinds = lab.triggers.map((t) => `${t.kind}:${String(t.ref)}`);
    expect(kinds).toEqual(['letter:C', 'letter:O', 'letter:D', 'letter:E', 'macguffin:secret_drive', 'npcTalk:dario']);
    for (const t of lab.triggers) expect(t.radius).toBe(0);
    const authored = buildLevel(patched(ALL_KINDS, { npcs: [{ ...(ALL_KINDS.npcs[0] as LevelDef['npcs'][number]), talkRadius: 2.5 }] }));
    expect(authored.triggers.find((t) => t.kind === 'npcTalk')?.radius).toBe(2.5);
  });

  it('decal quads are lifted 1 cm off their surface, counter-clockwise seen from the front', () => {
    for (const d of lab.decals) {
      const [a, b, c] = d.corners;
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const w = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const n = { x: u.y * w.z - u.z * w.y, y: u.z * w.x - u.x * w.z, z: u.x * w.y - u.y * w.x };
      expect(n.x * d.normal.x + n.y * d.normal.y + n.z * d.normal.z, d.def.id).toBeGreaterThan(0);
      const cx = (d.corners[0].x + d.corners[2].x) / 2, cy = (d.corners[0].y + d.corners[2].y) / 2, cz = (d.corners[0].z + d.corners[2].z) / 2;
      expect(cx - d.def.center.x).toBeCloseTo(d.normal.x * TUNING.LEVELS_DECAL_LIFT_M, 9);
      expect(cy - d.def.center.y).toBeCloseTo(d.normal.y * TUNING.LEVELS_DECAL_LIFT_M, 9);
      expect(cz - d.def.center.z).toBeCloseTo(d.normal.z * TUNING.LEVELS_DECAL_LIFT_M, 9);
    }
    // A wall decal facing north spans east-west, its right-hand edge to the west (seen from the north).
    const wall = decalCorners({ id: 'x', kind: 'paint', center: xzy(0, 0, 1), on: 'north', width: 2, height: 1 });
    expect(wall.corners[1].x).toBeLessThan(wall.corners[0].x);
    expect(wall.corners[2].y).toBeGreaterThan(wall.corners[1].y);
  });

  it('every primitive id is a surface id with bounds; spawn yaw follows the facing', () => {
    for (const p of ALL_KINDS.primitives) expect(lab.surfaces[p.id], p.id).toBeDefined();
    expect(lab.surfaces['LB-BOWL']?.footprint.x0).toBeCloseTo(6, 6);
    expect(lab.surfaces['LB-BOWL']?.bounds.min.y).toBeCloseTo(-2.4, 6);
    expect(lab.bounds.max.y).toBeCloseTo(12, 6);
    expect(lab.census.primitives.railPipe).toBe(3);
    expect(lab.census.rails).toEqual({ rail: 6, ledge: 6, coping: 8 });
  });
});

// ---------------------------------------------------------------------------------------------
// Validation (SPEC §9.2, DESIGN G.3): pass, then fail on a deliberate break
// ---------------------------------------------------------------------------------------------

describe('validateLevel: every rule passes clean data and fires on a break', () => {
  it('the all-kinds fixture is valid', () => {
    const v = validateLevel(ALL_KINDS, lab);
    expect(v, describeViolations(v)).toEqual([]);
  });

  it('REQ-LVL-03 rail coverage: a coping rail 0.2 m off its coping line fails; within 0.1 m passes', () => {
    const off = replaceRail(TEST_BOX, 'TB-VERT-C', { id: 'TB-VERT-C', kind: 'coping', points: [xzy(24, 4.2, 3.6), xzy(40, 4.2, 3.6)] });
    const v = validateLevel(off, buildLevel(off));
    expect(rulesOf(v)).toEqual(['REQ-LVL-03']);
    expect(v[0]?.ids).toContain('TB-VERT');
    const near = replaceRail(TEST_BOX, 'TB-VERT-C', { id: 'TB-VERT-C', kind: 'coping', points: [xzy(24, 4.08, 3.6), xzy(40, 4.08, 3.6)] });
    expect(validateLevel(near, buildLevel(near))).toEqual([]);
  });

  it('REQ-LVL-03: a missing authored rail fails even though the builder emitted one (ledge, grindable box edge)', () => {
    const def = withoutRail(ALL_KINDS, 'LB-STEP-N');
    const v = validateLevel(def, buildLevel(def));
    expect(rulesOf(v)).toEqual(['REQ-LVL-03']);
    expect(v[0]?.ids).toEqual(['LB-STEP']);
    const def2 = withoutRail(TEST_BOX, 'TB-LEDGE');
    expect(rulesOf(validateLevel(def2, buildLevel(def2)))).toEqual(['REQ-LVL-03']);
  });

  it('REQ-LVL-04: a decal on the ledge top under its rail fails; the same decal 0.2 m clear passes', () => {
    const bad = patched(TEST_BOX, { decals: [{ id: 'TB-BAD', kind: 'paint', center: xzy(46.3, 26, 0.45), on: 'up', width: 0.3, height: 1 }] });
    const v = validateLevel(bad, buildLevel(bad));
    expect(rulesOf(v)).toEqual(['REQ-LVL-04']);
    expect(v[0]?.ids).toEqual(['TB-BAD', 'TB-LEDGE']);
    const ok = patched(TEST_BOX, { decals: [{ id: 'TB-OK', kind: 'paint', center: xzy(40, 30, 0), on: 'up', width: 0.3, height: 1 }] });
    expect(validateLevel(ok, buildLevel(ok))).toEqual([]);
    // 0.55 m below the bar: clear. Within 0.15 m of it: not.
    const under = patched(TEST_BOX, { decals: [{ id: 'TB-UNDER', kind: 'paint', center: xzy(40, 30, 0.44), on: 'up', width: 0.3, height: 1 }] });
    expect(rulesOf(validateLevel(under, buildLevel(under)))).toEqual(['REQ-LVL-04']);
  });

  it('REQ-LVL-05: a MacGuffin in straight-up ollie reach of spawn or of a spawn-area grid point fails', () => {
    const reach = TUNING.OLLIE_H_FULL_M + TUNING.COLLECT_POINT_UP_M;
    const atSpawn = patched(ALL_KINDS, { macguffin: { id: 'secret_drive', pos: xzy(50, 70, reach) } });
    const v = validateLevel(atSpawn, buildLevel(atSpawn));
    expect(rulesOf(v)).toEqual(['REQ-LVL-05']);
    // Grid point (i 2, j 3) of the 3 x 4 grid over x[40,60] z[66,76].
    const grid = patched(ALL_KINDS, { macguffin: { id: 'secret_drive', pos: xzy(40 + (20 * 2.5) / 3, 66 + (10 * 3.5) / 4, reach + TUNING.COLLECT_RADIUS_M - 0.05) } });
    expect(rulesOf(validateLevel(grid, buildLevel(grid)))).toEqual(['REQ-LVL-05']);
    // Just out of reach above spawn: passes.
    const high = patched(ALL_KINDS, { macguffin: { id: 'secret_drive', pos: xzy(50, 70, reach + TUNING.COLLECT_RADIUS_M + 0.05) } });
    expect(validateLevel(high, buildLevel(high))).toEqual([]);
  });

  it('REQ-LVL-06 / REQ-LVL-10: the DESIGN G.1 P3 -> R7 scaffold hop passes at 6.0 m/s full, fails with R7 at x 104.6', () => {
    const p3: RailDef = { id: 'P3', kind: 'rail', points: [xzy(103.9, 64, 4.2), xzy(103.9, 70, 5.2)] };
    const r7: RailDef = { id: 'R7', kind: 'rail', points: [xzy(104.2, 72, 6.3), xzy(104.2, 87, 6.3)] };
    const m = measureFeed(p3, r7);
    expect(m?.along).toBeCloseTo(2.0, 6);
    expect(m?.up).toBeCloseTo(1.1, 6);
    expect(m?.lateral).toBeCloseTo(0.3, 6);
    const hop = simulateFeedHop(p3, r7, 6.0, 'full');
    expect(hop.hit).toBe(true);
    const moved: RailDef = { ...r7, points: [xzy(104.6, 72, 6.3), xzy(104.6, 87, 6.3)] };
    expect(simulateFeedHop(p3, moved, 6.0, 'full').hit).toBe(false);
    expect(measureFeed(p3, moved)?.lateral).toBeCloseTo(0.7, 6);
  });

  it('REQ-LVL-06 / REQ-LVL-10 in validateLevel: a feed 4 m long fails both rules; the fixture feed passes', () => {
    expect(validateLevel(ALL_KINDS, lab).filter((x) => x.rule === 'REQ-LVL-06' || x.rule === 'REQ-LVL-10')).toEqual([]);
    const far = replaceRail(ALL_KINDS, 'LB-FB', { id: 'LB-FB', kind: 'rail', points: [xzy(22, 60, 1.2), xzy(28, 60, 1.2)] });
    const farther = replaceRail(far, 'LB-FB', { id: 'LB-FB', kind: 'rail', points: [xzy(26, 60.6, 1.9), xzy(30, 60.6, 1.9)] });
    const v = validateLevel(farther, buildLevel(farther));
    expect(rulesOf(v)).toEqual(['REQ-LVL-06', 'REQ-LVL-10']);
    expect(v.filter((x) => x.rule === 'REQ-LVL-06').length).toBe(3); // horizontal, up and lateral
  });

  it('REQ-LVL-11: spawn off the ground fails', () => {
    const def = patched(TEST_BOX, { spawn: { pos: xzy(40, 46, 1), facing: 'north' } });
    expect(rulesOf(validateLevel(def, buildLevel(def)))).toEqual(['REQ-LVL-11']);
  });

  it('REQ-LVL-11: a rail buried in a box fails (and the box around the bar puts geometry at the pipe)', () => {
    const buried = replaceRail(TEST_BOX, 'TB-LEDGE', { id: 'TB-LEDGE', kind: 'ledge', points: [xzy(46.3, 34, 0.2), xzy(46.3, 18, 0.2)] });
    const v = validateLevel(buried, buildLevel(buried));
    expect(rulesOf(v)).toContain('REQ-LVL-11');
    expect(v.some((x) => x.rule === 'REQ-LVL-11' && x.message.includes('buried'))).toBe(true);
    const boxed = patched(TEST_BOX, { primitives: [...TEST_BOX.primitives, { kind: 'box', id: 'TB-HIDE', rect: { x0: 39.9, z0: 25, x1: 40.1, z1: 30 }, y0: 0, height: 0.6 }] });
    const v2 = validateLevel(boxed, buildLevel(boxed));
    expect(v2.some((x) => x.message.includes('TB-RAIL') && x.message.includes('buried'))).toBe(true);
    // A pipe-thin solid along the bar (what a pipe leaking into the BVH looks like) is caught.
    const leak = patched(TEST_BOX, { primitives: [...TEST_BOX.primitives, { kind: 'box', id: 'TB-LEAK', rect: { x0: 39.97, z0: 25, x1: 40.03, z1: 30 }, y0: 0.3, height: 0.25 }] });
    const v3 = validateLevel(leak, buildLevel(leak));
    expect(v3.some((x) => x.message.includes('TB-RAIL') && x.message.includes('collider geometry at the pipe'))).toBe(true);
  });

  it('REQ-LVL-11: an open boundary and back-facing surfaces fail', () => {
    // Drop the east boundary wall from the collider.
    const east = tb.collider.surfaceIds.indexOf('boundary-east');
    const keep: number[] = [];
    for (let t = 0; t < tb.collider.triangleCount; t++) if (tb.collider.triSurface[t] !== east) keep.push(t);
    const open: BuiltCollider = {
      positions: new Float32Array(keep.flatMap((t) => Array.from(tb.collider.positions.subarray(t * 9, t * 9 + 9)))),
      triangleCount: keep.length,
      triTag: new Uint8Array(keep.map((t) => tb.collider.triTag[t] as number)),
      triSurface: new Uint16Array(keep.map((t) => tb.collider.triSurface[t] as number)),
      surfaceIds: tb.collider.surfaceIds,
    };
    const v = validateLevel(TEST_BOX, { ...tb, collider: open });
    expect(v.some((x) => x.rule === 'REQ-LVL-11' && x.message.includes('boundary is open'))).toBe(true);
    // Flip the winding of the pad's collider triangles: its top shows its back face to the sky.
    const pad = tb.collider.surfaceIds.indexOf('TB-PAD');
    const flipped = new Float32Array(tb.collider.positions);
    for (let t = 0; t < tb.collider.triangleCount; t++) {
      if (tb.collider.triSurface[t] !== pad) continue;
      for (let k = 0; k < 3; k++) {
        const b = t * 9 + 3 + k, c = t * 9 + 6 + k;
        const tmp = flipped[b] as number;
        flipped[b] = flipped[c] as number;
        flipped[c] = tmp;
      }
    }
    const v2 = validateLevel(TEST_BOX, { ...tb, collider: { ...tb.collider, positions: flipped } });
    expect(v2.some((x) => x.rule === 'REQ-LVL-11' && x.ids.includes('TB-PAD') && x.message.includes('back face'))).toBe(true);
  });

  it('REQ-LVL-12: a rail ending 0.3 m short of a wall fails', () => {
    const def = patched(TEST_BOX, { primitives: [...TEST_BOX.primitives, { kind: 'box', id: 'TB-BLOCK', rect: { x0: 38, z0: 19, x1: 42, z1: 19.7 }, y0: 0, height: 2 }] });
    const v = validateLevel(def, buildLevel(def));
    expect(rulesOf(v)).toEqual(['REQ-LVL-12']);
    expect(v[0]?.ids).toEqual(['TB-RAIL', 'TB-BLOCK']);
  });

  it('REQ-NPC-04: an em dash in any level text fails', () => {
    const def = patched(TEST_BOX, { gaps: [{ ...(TEST_BOX.gaps[0] as LevelDef['gaps'][number]), name: `SPINE ${String.fromCharCode(0x2014)} TRANSFER` }] });
    expect(rulesOf(validateLevel(def, buildLevel(def)))).toEqual(['REQ-NPC-04']);
  });

  it('schema: duplicate ids, dangling references and transfer rails without a plane fail', () => {
    const dup = patched(TEST_BOX, { primitives: [...TEST_BOX.primitives, { kind: 'box', id: 'TB-PAD', rect: { x0: 2, z0: 50, x1: 3, z1: 51 }, y0: 0, height: 0.1 }] });
    expect(validateLevel(dup, buildLevel(dup)).some((x) => x.rule === 'schema' && x.message.includes('duplicate primitive id TB-PAD'))).toBe(true);
    const dangling = patched(TEST_BOX, { primitives: [...TEST_BOX.primitives, { kind: 'railPipe', id: 'TB-GHOST', railId: 'NOPE', style: 'flatbar' }] });
    expect(validateLevel(dangling, buildLevel(dangling)).some((x) => x.rule === 'schema' && x.ids.includes('NOPE'))).toBe(true);
    const plane = replaceRail(TEST_BOX, 'TB-SPINE-W', { id: 'TB-SPINE-W', kind: 'coping', points: [xzy(13.8, 10, 1.8), xzy(13.8, 22, 1.8)], tags: ['transfer'] });
    expect(rulesOf(validateLevel(plane, buildLevel(plane)))).toEqual(['schema']);
    const gap = patched(TEST_BOX, { gaps: [{ id: 'TB-G02', name: 'X', base: 200, rule: { kind: 'grindDistance', rails: ['NOPE'], minM: 5 } }] });
    expect(rulesOf(validateLevel(gap, buildLevel(gap)))).toEqual(['schema']);
  });

  it('non-finite data fails instead of building silently', () => {
    const def = patched(TEST_BOX, { primitives: [...TEST_BOX.primitives, { kind: 'box', id: 'TB-NAN', rect: { x0: 2, z0: 50, x1: 3, z1: 51 }, y0: 0, height: Number.NaN } as Primitive] });
    const v = validateLevel(def, buildLevel(def));
    expect(v.some((x) => x.rule === 'REQ-LVL-11' && x.message.includes('non-finite'))).toBe(true);
  });

  it('build + validate stay fast (whole-park budget)', () => {
    const t0 = performance.now();
    const b = buildLevel(ALL_KINDS);
    const t1 = performance.now();
    validateLevel(ALL_KINDS, b);
    const t2 = performance.now();
    expect(t1 - t0).toBeLessThan(1500);
    expect(t2 - t1).toBeLessThan(1500);
  });
});

// ---------------------------------------------------------------------------------------------
// Every registered level that has content (street / woodshed fill theirs in parallel)
// ---------------------------------------------------------------------------------------------

describe('registered levels', () => {
  for (const id of LEVEL_IDS) {
    it(`${id}: builds and validates clean once it has content`, async () => {
      const def = await loadLevelDef(id);
      if (def.primitives.length === 0) return; // header-only stub: nothing to validate yet
      const built = buildLevel(def);
      const v = validateLevel(def, built);
      expect(v, describeViolations(v)).toEqual([]);
    });
  }
});

describe('building roofs (REQ-MAT-01)', () => {
  /** Up-facing triangles of `parts` whose XZ footprint holds (x, z), as their heights there. */
  function upHeightsAt(parts: BuiltLevel['parts'], x: number, z: number): { part: BuiltLevel['parts'][number]; y: number }[] {
    const out: { part: BuiltLevel['parts'][number]; y: number }[] = [];
    for (const part of parts) {
      const pos = part.geometry.getAttribute('position');
      const idx = part.geometry.getIndex();
      if (!idx) continue;
      for (let t = 0; t < idx.count; t += 3) {
        const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)].map((i) => ({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) })) as [Vec3, Vec3, Vec3];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, wx = c.x - a.x, wy = c.y - a.y, wz = c.z - a.z;
        const ny = uz * wx - ux * wz;
        const len = Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx);
        if (len < 1e-12 || ny / len < 0.9) continue;
        // Barycentric in XZ.
        const d = ux * wz - uz * wx;
        const px = x - a.x, pz = z - a.z;
        const s = (px * wz - pz * wx) / d, r = (ux * pz - uz * px) / d;
        if (s < -1e-9 || r < -1e-9 || s + r > 1 + 1e-9) continue;
        out.push({ part, y: a.y + s * uy + r * wy });
      }
    }
    return out;
  }

  it('a building roof shows its roof material: no dressing lid lies just above the roof (the parapet is a ring)', async () => {
    for (const id of LEVEL_IDS) {
      const def = await loadLevelDef(id);
      const built = buildLevel(def);
      const dressing = built.parts.filter((p) => p.role === 'dressing');
      const roofs = built.parts.filter((p) => p.role === 'surface' && p.material === 'roofTar');
      for (const prim of def.primitives) {
        if (prim.kind !== 'building' || prim.style === 'booth') continue;
        const roofY = (prim.y0 ?? 0) + prim.height;
        const inset = 0.6; // past any parapet ring and its 5 cm proud
        const r = prim.rect;
        if (r.x1 - r.x0 < 2 * inset + 0.1 || r.z1 - r.z0 < 2 * inset + 0.1) continue;
        const pts = [
          { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 },
          { x: r.x0 + inset, z: r.z0 + inset },
          { x: r.x1 - inset, z: r.z1 - inset },
        ];
        for (const q of pts) {
          const lids = upHeightsAt(dressing, q.x, q.z).filter((h) => h.y > roofY - 0.01 && h.y <= roofY + 0.1);
          expect(lids.map((h) => `${h.part.material} at y ${h.y.toFixed(2)}`), `${id} ${prim.id} roof at (${q.x}, ${q.z})`).toEqual([]);
          const tar = upHeightsAt(roofs, q.x, q.z).filter((h) => Math.abs(h.y - roofY) < 1e-3);
          expect(tar.length, `${id} ${prim.id} roofTar at (${q.x}, ${q.z})`).toBeGreaterThan(0);
        }
      }
    }
  });
});
