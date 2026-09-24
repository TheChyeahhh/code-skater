/**
 * tests/fixtures/render/miniPark.ts (render track): a hand-built BuiltLevel (no buildLevel needed)
 * with one part per material family, a flat bar, a ledge, a maple quarter pipe with coping, a glass
 * slab, a brick wall, a neon billboard, decals, the four letters, a MacGuffin, an NPC and four
 * boundary walls. Used by render.test and by dev/render.html while the levels builder is a stub.
 * Geometry carries uv in world metres and a "color" attribute (fake AO) like the real builder.
 * Runs in node: three geometry classes only.
 */

import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { v3 } from '../../../src/core/math';
import type { Vec3 } from '../../../src/core/types';
import type {
  BuiltDecal, BuiltLevel, BuiltRail, DecalDef, EnvironmentPreset, LevelDef, LevelMeshPart, MaterialId, Primitive, RailDef, RailSegment, SurfaceInfo,
} from '../../../src/levels/types';

type Role = LevelMeshPart['role'];

/** Planar uv in world metres from the dominant normal axis (boxes and flat parts). */
function worldPlanarUv(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    if (ny >= nx && ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else if (nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
}

/** Fake AO: 0.55 at the floor rising to 1 over 0.6 m (deep enough to read as contact shadow). */
function fakeAo(g: BufferGeometry, floorY: number): void {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) - floorY;
    const k = h < 0.02 ? 0.55 : Math.min(1, 0.55 + h * 0.75);
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, floorY = 0): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.applyMatrix4(new Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  worldPlanarUv(g);
  fakeAo(g, floorY);
  return g;
}

function part(id: string, surfaceId: string, material: MaterialId, geometry: BufferGeometry, role: Role, castShadow = true, receiveShadow = true): LevelMeshPart {
  return { id, surfaceId, material, geometry, role, castShadow, receiveShadow };
}

/** Quarter pipe facing west (skater approaches from the west): coping line at x = x1, foot line at x1 - radius. */
function quarterPipe(x1: number, z0: number, z1: number, radius: number, copingHeight: number, deck: number): BufferGeometry {
  const segs = 14;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const angle = Math.asin(Math.min(1, copingHeight / radius));
  const cx = x1 - radius;
  // Profile from the foot (x1 - radius, 0) up the arc to the coping (x1, copingHeight) then the deck.
  const profile: { x: number; y: number; nx: number; ny: number; s: number }[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * angle;
    profile.push({ x: cx + Math.sin(a) * radius, y: radius - Math.cos(a) * radius, nx: -Math.sin(a), ny: Math.cos(a), s: a * radius });
  }
  const top = profile[profile.length - 1] as { x: number; y: number; s: number };
  profile.push({ x: x1 + deck, y: top.y, nx: 0, ny: 1, s: top.s + deck });
  for (let j = 0; j < profile.length; j++) {
    const p = profile[j] as { x: number; y: number; nx: number; ny: number; s: number };
    for (const z of [z0, z1]) {
      positions.push(p.x, p.y, z);
      normals.push(p.nx, p.ny, 0);
      uvs.push(p.s, z);
      const ao = Math.min(1, 0.7 + p.y * 0.4);
      colors.push(ao, ao, ao);
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    const a = j * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  // Side cheeks and the back wall (flat boxes) are separate parts in the fixture.
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

/** A horizontal pipe from a to b with uv along its length. */
function pipe(a: Vec3, b: Vec3, radius: number): BufferGeometry {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const g = new CylinderGeometry(radius, radius, len, 14, 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * radius * Math.PI * 2, uv.getY(i) * len);
  const dir = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  const m = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const q = new Matrix4().makeRotationAxis(new Vector3().crossVectors(up, dir).normalize(), Math.acos(Math.max(-1, Math.min(1, up.dot(dir)))));
  if (Math.abs(up.dot(dir)) > 0.9999) q.identity();
  m.multiply(new Matrix4().makeTranslation((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)).multiply(q);
  g.applyMatrix4(m);
  return g;
}

function builtRail(def: RailDef): BuiltRail {
  const segments: RailSegment[] = [];
  let start = 0;
  for (let i = 0; i < def.points.length - 1; i++) {
    const a = def.points[i] as Vec3;
    const b = def.points[i + 1] as Vec3;
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    segments.push({ a, b, length, start, tangent: v3((b.x - a.x) / length, (b.y - a.y) / length, (b.z - a.z) / length), bendToNextDeg: 0 });
    start += length;
  }
  return { ...def, segments, length: start, closed: def.closed ?? false };
}

function decal(def: DecalDef): BuiltDecal {
  const hw = def.width / 2;
  const hh = def.height / 2;
  const c = def.center;
  const r = ((def.rotDeg ?? 0) * Math.PI) / 180;
  const rot = (x: number, z: number): Vec3 => v3(c.x + x * Math.cos(r) - z * Math.sin(r), c.y + 0.01, c.z + x * Math.sin(r) + z * Math.cos(r));
  return { def, corners: [rot(-hw, hh), rot(hw, hh), rot(hw, -hh), rot(-hw, -hh)], normal: v3(0, 1, 0) };
}

function surface(id: string, kind: SurfaceInfo['kind'], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SurfaceInfo {
  return { id, kind, bounds: { min: v3(x0, y0, z0), max: v3(x1, y1, z1) }, footprint: { x0, z0, x1, z1 } };
}

const SIZE = 40;

/** Build the mini park for an environment preset. */
export function miniPark(environment: EnvironmentPreset = 'streetAfternoon'): BuiltLevel {
  const primitives: Primitive[] = [
    { kind: 'ground', id: 'MP-FLOOR', rect: { x0: 0, z0: 0, x1: SIZE, z1: SIZE }, y: 0, material: environment === 'woodshedInterior' ? 'maple' : 'concrete' },
    { kind: 'ground', id: 'MP-PLAZA', rect: { x0: 4, z0: 22, x1: 18, z1: 36 }, y: 0.01, material: 'plazaTile' },
    { kind: 'ground', id: 'MP-ROAD', rect: { x0: 22, z0: 0, x1: 30, z1: SIZE }, y: 0.005, material: 'asphalt' },
    { kind: 'ledge', id: 'MP-L1', rect: { x0: 6, z0: 14, x1: 16, z1: 14.6 }, topY: 0.45, material: 'marble' },
    { kind: 'box', id: 'MP-B1', rect: { x0: 6, z0: 24, x1: 9, z1: 27 }, y0: 0, height: 1.0, material: 'granite' },
    { kind: 'quarterPipe', id: 'MP-Q1', facing: 'west', footLine: 31, copingLine: 34, span: [8, 20], copingHeight: 2.4, radius: 3, deckDepth: 2, copingRailId: 'MP-R-COPE', material: 'maple' },
    { kind: 'building', id: 'MP-TOWER', rect: { x0: 32, z0: 26, x1: 40, z1: 40 }, height: 14, style: 'glassTower', material: 'glass' },
    { kind: 'building', id: 'MP-WALL', rect: { x0: 0, z0: 0, x1: 20, z1: 1 }, height: 4, style: 'block', material: 'brick' },
    { kind: 'billboard', id: 'MP-SIGN', rect: { x0: 4, z0: 1, x1: 12, z1: 1.6 }, y0: 4.2, height: 2, face: 'south', brand: 'labA', material: 'neon' },
    { kind: 'billboard', id: 'MP-SIGN2', rect: { x0: 13, z0: 1, x1: 19, z1: 1.6 }, y0: 4.2, height: 1.6, face: 'south', brand: 'labB', material: 'signBoard' },
    { kind: 'prop', id: 'MP-SCAF', prop: 'scaffoldFrame', at: v3(36, 0, 6), size: v3(4, 6, 2), collidable: true, material: 'scaffold' },
    { kind: 'railPipe', id: 'MP-BAR-PIPE', railId: 'MP-R-BAR', style: 'flatbar' },
  ];
  const rails: RailDef[] = [
    { id: 'MP-R-BAR', kind: 'rail', points: [v3(10, 0.55, 8), v3(20, 0.55, 8)], name: 'Flat bar' },
    { id: 'MP-R-L1', kind: 'ledge', points: [v3(6, 0.45, 14.3), v3(16, 0.45, 14.3)], name: 'Marble ledge' },
    { id: 'MP-R-COPE', kind: 'coping', points: [v3(34, 2.4, 8), v3(34, 2.4, 20)], name: 'Quarter coping' },
  ];
  const decals: DecalDef[] = [
    { id: 'MP-D-XWALK', kind: 'crosswalk', center: v3(26, 0.005, 20), on: 'up', width: 8, height: 4 },
    { id: 'MP-D-WATER', kind: 'water', center: v3(11, 0.01, 30), on: 'up', width: 5, height: 5 },
    { id: 'MP-D-MARK', kind: 'wordmark', center: v3(14, 0, 20), on: 'up', width: 6, height: 1.5, brand: 'chip' },
    { id: 'MP-D-ARROW', kind: 'arrow', center: v3(26, 0.005, 32), on: 'up', width: 3, height: 1.5, rotDeg: 90 },
    { id: 'MP-D-STAIN', kind: 'stain', center: v3(4, 0, 10), on: 'up', width: 3, height: 3 },
  ];
  const def: LevelDef = {
    id: 'testBox',
    name: 'Mini Park',
    size: { x: SIZE, z: SIZE },
    environment,
    spawn: { pos: v3(20, 0, 34), facing: 'north' },
    spawnArea: { x0: 16, z0: 30, x1: 24, z1: 38 },
    primitives,
    rails,
    gaps: [],
    letters: [
      { letter: 'C', pos: v3(8, 1.2, 12) },
      { letter: 'O', pos: v3(12, 1.2, 12) },
      { letter: 'D', pos: v3(16, 1.2, 12) },
      { letter: 'E', pos: v3(20, 1.2, 12) },
    ],
    macguffin: { id: 'secret_laptop', pos: v3(7.5, 1.4, 25.5) },
    npcs: [{ id: 'sam', pos: v3(18, 0, 28), facing: 'south', outfit: 'hoodie', prop: 'laptopSleeve' }],
    goals: [],
    decals,
    feeds: [],
  };

  const floorMat: MaterialId = environment === 'woodshedInterior' ? 'maple' : 'concrete';
  const parts: LevelMeshPart[] = [
    part('MP-FLOOR:top', 'MP-FLOOR', floorMat, box(0, -0.2, 0, SIZE, 0, SIZE), 'surface', false, true),
    part('MP-PLAZA:top', 'MP-PLAZA', 'plazaTile', box(4, -0.1, 22, 18, 0.01, 36), 'surface', false, true),
    part('MP-ROAD:top', 'MP-ROAD', 'asphalt', box(22, -0.1, 0, 30, 0.005, SIZE), 'surface', false, true),
    part('MP-L1:body', 'MP-L1', 'marble', box(6, 0, 14, 16, 0.45, 14.6), 'surface'),
    part('MP-B1:body', 'MP-B1', 'granite', box(6, 0, 24, 9, 1.0, 27), 'surface'),
    part('MP-Q1:face', 'MP-Q1', 'maple', quarterPipe(34, 8, 20, 3, 2.4, 2), 'surface'),
    part('MP-Q1:cheekN', 'MP-Q1', 'woodPanel', box(31, 0, 7.8, 36, 2.4, 8), 'wall'),
    part('MP-Q1:cheekS', 'MP-Q1', 'woodPanel', box(31, 0, 20, 36, 2.4, 20.2), 'wall'),
    part('MP-Q1:back', 'MP-Q1', 'paintedSteel', box(36, 0, 7.8, 36.3, 2.6, 20.2), 'wall'),
    part('MP-TOWER:body', 'MP-TOWER', 'glass', box(32, 0, 26, 40, 14, 40), 'dressing'),
    part('MP-TOWER:frame', 'MP-TOWER', 'towerFrame', box(31.8, 0, 25.8, 40, 0.6, 40), 'dressing'),
    part('MP-TOWER:roof', 'MP-TOWER', 'roofTar', box(32, 14, 26, 40, 14.3, 40), 'dressing'),
    part('MP-WALL:body', 'MP-WALL', 'brick', box(0, 0, 0, 20, 4, 1), 'wall'),
    part('MP-SIGN:box', 'MP-SIGN', 'neon', box(4, 4.2, 1, 12, 6.2, 1.6), 'sign'),
    part('MP-SIGN2:box', 'MP-SIGN2', 'signBoard', box(13, 4.2, 1, 19, 5.8, 1.6), 'sign'),
    part('MP-SCAF:p1', 'MP-SCAF', 'scaffold', pipe(v3(34, 0, 5), v3(34, 6, 5), 0.04), 'dressing'),
    part('MP-SCAF:p2', 'MP-SCAF', 'scaffold', pipe(v3(38, 0, 5), v3(38, 6, 5), 0.04), 'dressing'),
    part('MP-SCAF:p3', 'MP-SCAF', 'scaffold', pipe(v3(34, 3, 5), v3(38, 3, 5), 0.04), 'dressing'),
    part('MP-SCAF:p4', 'MP-SCAF', 'scaffold', pipe(v3(34, 6, 5), v3(38, 6, 5), 0.04), 'dressing'),
    part('MP-SCAF:deck', 'MP-SCAF', 'metalPanel', box(33.8, 3, 5.2, 38.2, 3.05, 7), 'dressing'),
    part('MP-BAR-PIPE:pipe', 'MP-R-BAR', 'steelRail', pipe(v3(10, 0.55, 8), v3(20, 0.55, 8), 0.03), 'rail'),
    part('MP-BAR-PIPE:post1', 'MP-R-BAR', 'steelRail', pipe(v3(10.5, 0, 8), v3(10.5, 0.55, 8), 0.025), 'rail'),
    part('MP-BAR-PIPE:post2', 'MP-R-BAR', 'steelRail', pipe(v3(19.5, 0, 8), v3(19.5, 0.55, 8), 0.025), 'rail'),
    part('MP-R-COPE:pipe', 'MP-Q1', 'steelCoping', pipe(v3(34, 2.4, 8), v3(34, 2.4, 20), 0.04), 'coping'),
    part('MP-BOUND:n', 'MP-BOUND', 'boundary', box(0, 0, -0.5, SIZE, 12, 0), 'wall', false, false),
    part('MP-BOUND:s', 'MP-BOUND', 'boundary', box(0, 0, SIZE, SIZE, 12, SIZE + 0.5), 'wall', false, false),
    part('MP-BOUND:e', 'MP-BOUND', 'boundary', box(SIZE, 0, 0, SIZE + 0.5, 12, SIZE), 'wall', false, false),
    part('MP-BOUND:w', 'MP-BOUND', 'boundary', box(-0.5, 0, 0, 0, 12, SIZE), 'wall', false, false),
  ];
  // A fountain basin for the water decal so the plaza has a second grind edge.
  parts.push(part('MP-FOUNT:rim', 'MP-FOUNT', 'concrete', box(8, 0, 27, 14, 0.4, 33), 'surface'));
  parts.push(part('MP-FOUNT:basin', 'MP-FOUNT', 'water', box(8.5, 0.3, 27.5, 13.5, 0.32, 32.5), 'surface', false, true));

  const surfaces: Record<string, SurfaceInfo> = {
    'MP-FLOOR': surface('MP-FLOOR', 'ground', 0, 0, 0, SIZE, 0, SIZE),
    'MP-PLAZA': surface('MP-PLAZA', 'ground', 4, 0, 22, 18, 0.01, 36),
    'MP-ROAD': surface('MP-ROAD', 'ground', 22, 0, 0, 30, 0.005, SIZE),
    'MP-L1': surface('MP-L1', 'ledge', 6, 0, 14, 16, 0.45, 14.6),
    'MP-B1': surface('MP-B1', 'box', 6, 0, 24, 9, 1, 27),
    'MP-Q1': surface('MP-Q1', 'quarterPipe', 31, 0, 8, 36.3, 2.6, 20),
    'MP-TOWER': surface('MP-TOWER', 'building', 32, 0, 26, 40, 14.3, 40),
    'MP-WALL': surface('MP-WALL', 'building', 0, 0, 0, 20, 4, 1),
    'MP-SIGN': surface('MP-SIGN', 'billboard', 4, 4.2, 1, 12, 6.2, 1.6),
    'MP-SIGN2': surface('MP-SIGN2', 'billboard', 13, 4.2, 1, 19, 5.8, 1.6),
    'MP-SCAF': surface('MP-SCAF', 'prop', 33.8, 0, 5, 38.2, 6, 7),
    'MP-FOUNT': surface('MP-FOUNT', 'fountain', 8, 0, 27, 14, 0.4, 33),
    'MP-BOUND': surface('MP-BOUND', 'boundary', -0.5, 0, -0.5, SIZE + 0.5, 12, SIZE + 0.5),
  };

  return {
    def,
    parts,
    collider: { positions: new Float32Array(0), triangleCount: 0, triTag: new Uint8Array(0), triSurface: new Uint16Array(0), surfaceIds: [] },
    rails: rails.map(builtRail),
    triggers: [
      ...def.letters.map((l) => ({ id: `letter:${l.letter}`, kind: 'letter' as const, center: l.pos, radius: 0, ref: l.letter })),
      { id: 'macguffin:secret_laptop', kind: 'macguffin', center: v3(7.5, 1.4, 25.5), radius: 0, ref: 'secret_laptop' },
      { id: 'npc:sam', kind: 'npcTalk', center: v3(18, 0, 28), radius: 0, ref: 'sam' },
    ],
    decals: decals.map(decal),
    surfaces,
    bounds: { min: v3(-0.5, -0.2, -0.5), max: v3(SIZE + 0.5, 14.3, SIZE + 0.5) },
    spawn: { pos: v3(20, 0, 34), yaw: 0 },
    census: {
      primitives: { ground: 3, ledge: 1, box: 1, quarterPipe: 1, building: 2, billboard: 2, prop: 1, railPipe: 1 },
      rails: { rail: 1, ledge: 1, coping: 1 },
    },
  };
}
