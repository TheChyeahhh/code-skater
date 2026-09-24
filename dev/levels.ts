/**
 * dev/levels.ts (levels track harness, port 5303; street 5304 and woodshed 5305 open it with
 * ?level=marketStreet / ?level=woodshed). Renders buildLevel(def) with basic materials (one flat
 * colour per material id, the fake-AO vertex colours on), rails as bright lines over their pipes
 * (rail yellow, ledge orange, coping cyan, builder-emitted auto rails magenta), triggers as
 * wireframe spheres at their live tuning radius, gap boxes as wireframes, spawn and spawnArea, and
 * the validateLevel() violations in the panel (red markers in the scene).
 *
 *   ?level=testBox|marketStreet|woodshed   level (default testBox)
 *   ?fixture=allKinds   the levels test fixture with every primitive kind (tests/fixtures/levels)
 *   ?raw         draw the LevelDef data only (footprints, rails, markers), no builder
 *   ?top         straight-down view of the whole park
 *   ?cam=x,y,z,tx,ty,tz   camera position and target (deterministic screenshots)
 *   ?focus=<id>  frame one primitive / surface id
 *   ?uv          2.4 m world-UV check texture on every surface (seams line up across primitives)
 *   ?collider    collider wireframe coloured by tag (solid grey, transition blue, boundary red)
 *   ?nolabels    hide the rail id labels
 * Drag = orbit, right drag = pan, wheel = zoom. Keys: T top view, C collider, U uv texture.
 * Sets window.__shotReady after 10 frames.
 */

import {
  BoxGeometry, BufferGeometry, CanvasTexture, CapsuleGeometry, Color, ConeGeometry, EdgesGeometry, Float32BufferAttribute,
  Group, Line, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, Sprite, SpriteMaterial, SphereGeometry, Vector3, WireframeGeometry,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TUNING } from '../src/core/tuning';
import type { LevelId, Vec3 } from '../src/core/types';
import { buildLevel } from '../src/levels/builder';
import { gapBoxes } from '../src/levels/lib/debugShapes';
import { emittedRails } from '../src/levels/lib/rails';
import { loadLevelDef, LEVEL_IDS } from '../src/levels/registry';
import type { BuiltLevel, LevelDef, LevelViolation, MaterialId, Primitive, RailDef } from '../src/levels/types';
import { validateLevel } from '../src/levels/validate';
import { createBasicScene, mountPanel, noteFallback, shotReadyAt, startFrames, tryBuild } from './shared/harness';

const params = new URLSearchParams(window.location.search);
const requested = params.get('level') ?? 'testBox';
const levelId: LevelId = (LEVEL_IDS as readonly string[]).includes(requested) ? (requested as LevelId) : 'testBox';

const RAIL_COLORS = { rail: '#ffd23f', ledge: '#ff8c42', coping: '#3fd7ff' } as const;
const AUTO_RAIL_COLOR = '#ff3fd2';

/** Basic flat colours per material id (the real procedural materials live in src/render). */
const MATERIAL_COLORS: Record<MaterialId, string> = {
  asphalt: '#3b3e44', concrete: '#a7a59f', plazaTile: '#c2b8a6', marble: '#e4e1da', granite: '#8d8a86', brick: '#9a4b36',
  glass: '#6f98b8', towerFrame: '#3c4450', metalPanel: '#7d8792', roofTar: '#34353a', paintedSteel: '#3f6f8f',
  maple: '#d8b27a', mapleDark: '#a97c4a', woodPanel: '#8a5a33', steelCoping: '#d6dde6', steelRail: '#c7ced8',
  scaffold: '#b9a13c', water: '#3f8fc4', signBoard: '#f2efe6', neon: '#ff5fa2', boundary: '#ff0000',
};

function colorFor(id: string): Color {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return new Color().setHSL((h % 360) / 360, 0.45, 0.55);
}

function polyline(points: readonly Vec3[], color: string, lift = 0): Line {
  const pts: number[] = [];
  for (const p of points) pts.push(p.x, p.y + lift, p.z);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return new Line(g, new LineBasicMaterial({ color, depthTest: false, transparent: true }));
}

function wireBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string | Color): LineSegments {
  const box = new BoxGeometry(Math.max(0.05, x1 - x0), Math.max(0.02, y1 - y0), Math.max(0.05, z1 - z0));
  const e = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color }));
  e.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return e;
}

function marker(geometry: BufferGeometry, color: string, at: Vec3, wire = false): Mesh {
  const m = new Mesh(geometry, new MeshStandardMaterial({ color, emissive: new Color(color), emissiveIntensity: 0.5, wireframe: wire }));
  m.position.set(at.x, at.y, at.z);
  return m;
}

function label(text: string, at: Vec3, color: string, scale: number): Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(10,12,18,0.7)';
    g.fillRect(0, 0, c.width, c.height);
    g.font = 'bold 26px ui-monospace, Consolas, monospace';
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(text, 8, c.height / 2);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(scale, (scale * c.height) / c.width, 1);
  s.position.set(at.x, at.y, at.z);
  return s;
}

/** 2.4 m plywood-sheet check texture in world UVs (uv are metres, repeat = 1 / 2.4). */
function uvTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#d9d4c7';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#c3bca9';
    g.fillRect(0, 0, 128, 128);
    g.fillRect(128, 128, 128, 128);
    g.strokeStyle = '#3b2f22';
    g.lineWidth = 6;
    g.strokeRect(0, 0, 256, 256);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / 2.4, 1 / 2.4);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Approximate footprint box of a primitive for the raw view: [x0, y0, z0, x1, y1, z1], or null. */
function footprint(p: Primitive): readonly [number, number, number, number, number, number] | null {
  switch (p.kind) {
    case 'ground':
      return [p.rect.x0, p.y - 0.02, p.rect.z0, p.rect.x1, p.y, p.rect.z1];
    case 'box':
      return [p.rect.x0, p.y0, p.rect.z0, p.rect.x1, p.y0 + p.height, p.rect.z1];
    case 'building':
      return [p.rect.x0, p.y0 ?? 0, p.rect.z0, p.rect.x1, (p.y0 ?? 0) + p.height, p.rect.z1];
    case 'ledge':
      return [p.rect.x0, p.baseY ?? 0, p.rect.z0, p.rect.x1, p.topY, p.rect.z1];
    case 'bank':
      return [p.rect.x0, p.yLow, p.rect.z0, p.rect.x1, p.yHigh, p.rect.z1];
    case 'stairs':
      return [p.rect.x0, p.topY - p.drop, p.rect.z0, p.rect.x1, p.topY, p.rect.z1];
    case 'hubba':
      return [p.rect.x0, p.baseY ?? 0, p.rect.z0, p.rect.x1, p.yTop, p.rect.z1];
    case 'bowl':
      return [p.rect.x0, (p.rimY ?? 0) - p.depth, p.rect.z0, p.rect.x1, p.rimY ?? 0, p.rect.z1];
    case 'euroGap':
      return [p.rect.x0, p.floorY, p.rect.z0, p.rect.x1, 0, p.rect.z1];
    case 'hump':
    case 'kicker':
    case 'funbox':
    case 'pyramid':
      return [p.rect.x0, 0, p.rect.z0, p.rect.x1, p.height, p.rect.z1];
    case 'billboard':
      return [p.rect.x0, p.y0, p.rect.z0, p.rect.x1, p.y0 + p.height, p.rect.z1];
    case 'quarterPipe': {
      const a = Math.min(p.footLine, p.copingLine);
      const b = Math.max(p.footLine, p.copingLine);
      const y0 = p.baseY ?? 0;
      const y1 = y0 + p.copingHeight;
      return p.facing === 'east' || p.facing === 'west' ? [a, y0, p.span[0], b, y1, p.span[1]] : [p.span[0], y0, a, p.span[1], y1, b];
    }
    case 'spine': {
      const half = p.radius + p.gapWidth / 2;
      return p.axis === 'z'
        ? [p.centre - half, 0, p.span[0], p.centre + half, p.copingHeight, p.span[1]]
        : [p.span[0], 0, p.centre - half, p.span[1], p.copingHeight, p.centre + half];
    }
    case 'fountain':
      return [p.centre.x - p.footRadius, p.baseY ?? 0, p.centre.z - p.footRadius, p.centre.x + p.footRadius, (p.baseY ?? 0) + p.rimHeight, p.centre.z + p.footRadius];
    case 'fullPipe':
      return [Math.min(p.a.x, p.b.x) - (p.a.z === p.b.z ? 0 : p.radius), Math.min(p.a.y, p.b.y) - p.radius, Math.min(p.a.z, p.b.z) - (p.a.x === p.b.x ? 0 : p.radius), Math.max(p.a.x, p.b.x) + (p.a.z === p.b.z ? 0 : p.radius), Math.max(p.a.y, p.b.y) + p.radius, Math.max(p.a.z, p.b.z) + (p.a.x === p.b.x ? 0 : p.radius)];
    case 'prop':
      return [p.at.x - p.size.x / 2, p.at.y, p.at.z - p.size.z / 2, p.at.x + p.size.x / 2, p.at.y + p.size.y, p.at.z + p.size.z / 2];
    case 'channel':
      return null;
    case 'railPipe':
      return null;
  }
}

function drawRaw(def: LevelDef, add: (o: Mesh | Line | LineSegments | Sprite | Group) => void): void {
  for (const p of def.primitives) {
    if (p.kind === 'channel') add(polyline(p.centreline.map((c) => ({ x: c.x, y: p.floorY, z: c.z })), `#${colorFor(p.id).getHexString()}`));
    const f = footprint(p);
    if (!f) continue;
    add(wireBox(f[0], f[1], f[2], f[3], f[4], f[5], colorFor(p.id)));
  }
}

function drawMarkers(def: LevelDef, add: (o: Mesh | Line | LineSegments | Sprite | Group) => void): void {
  // Park rectangle (the builder's boundary walls stand on it), so an empty stub still has a frame.
  add(wireBox(0, 0, 0, def.size.x, def.boundaryHeight ?? 12, def.size.z, '#5a6275'));
  add(marker(new ConeGeometry(0.4, 1.2, 12), '#7cff6b', { x: def.spawn.pos.x, y: def.spawn.pos.y + 0.6, z: def.spawn.pos.z }));
  const a = def.spawnArea;
  add(wireBox(a.x0, def.spawn.pos.y, a.z0, a.x1, def.spawn.pos.y + 0.05, a.z1, '#7cff6b'));
  const collect = TUNING.COLLECT_RADIUS_M;
  for (const l of def.letters) add(marker(new SphereGeometry(collect, 16, 10), '#ff4fd8', l.pos, true));
  if (def.macguffin) add(marker(new OctahedronGeometry(collect), '#ffffff', def.macguffin.pos, true));
  for (const n of def.npcs) {
    add(marker(new CapsuleGeometry(0.3, 1.1, 4, 8), '#c8a2ff', { x: n.pos.x, y: n.pos.y + 0.85, z: n.pos.z }));
    add(marker(new SphereGeometry(n.talkRadius ?? TUNING.TALK_TRIGGER_M, 16, 8), '#c8a2ff', n.pos, true));
  }
  const size = { x: def.size.x, z: def.size.z };
  for (const g of gapBoxes(def, size)) add(wireBox(g.box.min.x, g.box.min.y, g.box.min.z, g.box.max.x, g.box.max.y, g.box.max.z, g.role === 'start' ? '#5dff9e' : g.role === 'end' ? '#ff9e5d' : '#9e9eff'));
}

function drawRails(rails: readonly RailDef[], auto: ReadonlySet<string>, add: (o: Mesh | Line | LineSegments | Sprite | Group) => void, labels: boolean): void {
  for (const r of rails) {
    const color = auto.has(r.id) ? AUTO_RAIL_COLOR : RAIL_COLORS[r.kind];
    add(polyline(r.points, color, 0.01));
    if (!labels) continue;
    const mid = r.points[Math.floor((r.points.length - 1) / 2)];
    if (mid) add(label(r.id, { x: mid.x, y: mid.y + 0.6, z: mid.z }, color, 2.2));
  }
}

function colliderWire(built: BuiltLevel): LineSegments[] {
  const out: LineSegments[] = [];
  const colors = ['#8a8f99', '#3f8cff', '#ff4040'];
  for (let code = 0; code < 3; code++) {
    const pts: number[] = [];
    const pos = built.collider.positions;
    for (let t = 0; t < built.collider.triangleCount; t++) {
      if (built.collider.triTag[t] !== code) continue;
      for (let k = 0; k < 9; k++) pts.push(pos[t * 9 + k] as number);
    }
    if (pts.length === 0) continue;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    out.push(new LineSegments(new WireframeGeometry(g), new LineBasicMaterial({ color: colors[code], transparent: true, opacity: 0.55 })));
  }
  return out;
}

function parseCam(s: string | null): { pos: Vector3; target: Vector3 } | null {
  if (!s) return null;
  const n = s.split(',').map(Number);
  if (n.length !== 6 || n.some((x) => !Number.isFinite(x))) return null;
  return { pos: new Vector3(n[0], n[1], n[2]), target: new Vector3(n[3], n[4], n[5]) };
}

async function main(): Promise<void> {
  // ?fixture=allKinds shows the levels test fixture with every primitive kind.
  const def = params.get('fixture') === 'allKinds' ? (await import('../tests/fixtures/levels/allKinds')).ALL_KINDS : await loadLevelDef(levelId);
  const panel = mountPanel(`Levels harness: ${def.name}`, [
    'Levels 5303, street 5304 (?level=marketStreet), woodshed 5305 (?level=woodshed).',
    'Rails: yellow rail, orange ledge, cyan coping, magenta = auto-emitted by the builder.',
    '?raw ?top ?uv ?collider ?focus=<id> ?cam=x,y,z,tx,ty,tz  |  T top, C collider, U uv',
  ]);
  const s = createBasicScene(def.environment === 'woodshedInterior' ? '#1d1712' : '#141925');
  const size = Math.max(def.size.x, def.size.z);
  s.camera.far = size * 8;
  s.camera.near = 0.05;
  s.camera.updateProjectionMatrix();
  const controls = new OrbitControls(s.camera, s.canvas);
  controls.enableDamping = false;
  const setTop = (): void => {
    // Fit the park rectangle to the view: vertical FOV for z, horizontal for x.
    const t = Math.tan((s.camera.fov * Math.PI) / 360);
    const h = Math.max(def.size.z / 2 / t, def.size.x / 2 / (t * s.camera.aspect)) * 1.06;
    s.camera.position.set(def.size.x / 2, h, def.size.z / 2 + 0.01);
    controls.target.set(def.size.x / 2, 0, def.size.z / 2);
    controls.update();
  };
  const setOverview = (): void => {
    s.camera.position.set(def.size.x * 0.5, size * 0.55, def.size.z + size * 0.35);
    controls.target.set(def.size.x / 2, 0, def.size.z * 0.45);
    controls.update();
  };
  // The shared scene's 40 m grid helper would cover the level floor: hide it.
  for (const o of s.scene.children) if (o.type === 'GridHelper') o.visible = false;
  const root = new Group();
  s.scene.add(root);
  const add = (o: Mesh | Line | LineSegments | Sprite | Group): void => {
    root.add(o);
  };
  const status = [
    `level ${def.id}: ${def.primitives.length} primitives, ${def.rails.length} rails, ${def.gaps.length} gaps, ${def.letters.length} letters, ${def.goals.length} goals, ${def.decals.length} decals`,
  ];
  const built = params.has('raw') ? null : tryBuild(() => buildLevel(def));
  const colliderGroup = new Group();
  colliderGroup.visible = params.has('collider');
  s.scene.add(colliderGroup);
  const uvTex = uvTexture();
  const surfaceMats: MeshStandardMaterial[] = [];
  if (built) {
    const auto = new Set(emittedRails(def).map((e) => e.rail.id));
    for (const part of built.parts) {
      if (part.material === 'boundary') continue;
      const color = MATERIAL_COLORS[part.material];
      const metal = part.role === 'rail' || part.role === 'coping';
      const mat = new MeshStandardMaterial({
        color, roughness: metal ? 0.3 : 0.85, metalness: metal ? 0.6 : 0, vertexColors: part.geometry.hasAttribute('color'),
        emissive: part.material === 'neon' ? new Color(color) : new Color('#000000'), emissiveIntensity: part.material === 'neon' ? 0.8 : 0,
      });
      if (!metal && part.role !== 'sign') surfaceMats.push(mat);
      add(new Mesh(part.geometry, mat));
    }
    for (const d of built.decals) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(d.corners.flatMap((c) => [c.x, c.y, c.z]), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      add(new Mesh(g, new MeshStandardMaterial({ color: d.def.kind === 'water' ? '#3f8fc4' : '#f5f0e0', transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })));
      add(polyline([...d.corners, d.corners[0]], '#ffffff', 0.005));
    }
    drawRails(built.rails, auto, add, !params.has('nolabels'));
    for (const w of colliderWire(built)) colliderGroup.add(w);
    const bvhStart = performance.now();
    const violations: readonly LevelViolation[] = tryBuild(() => validateLevel(def, built)) ?? [];
    const validateMs = performance.now() - bvhStart;
    let verts = 0;
    for (const p of built.parts) verts += p.geometry.getAttribute('position').count;
    status.push(`built: ${built.parts.length} parts (${verts} verts), ${built.collider.triangleCount} collider tris, ${built.rails.length} rails (${auto.size} auto), ${built.triggers.length} triggers`);
    status.push(`validateLevel: ${violations.length} violation(s) in ${validateMs.toFixed(0)} ms`);
    for (const v of violations.slice(0, 14)) panel.log(`${v.rule} ${v.ids.join(',')}: ${v.message}`);
    for (const v of violations) if (v.at) add(marker(new SphereGeometry(0.35, 10, 6), '#ff2020', v.at));
  } else {
    if (!params.has('raw')) noteFallback(panel, 'buildLevel');
    const floor = new Mesh(new PlaneGeometry(def.size.x, def.size.z), new MeshStandardMaterial({ color: '#2a3140', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(def.size.x / 2, -0.03, def.size.z / 2);
    add(floor);
    drawRaw(def, add);
    drawRails(def.rails, new Set(), add, !params.has('nolabels'));
  }
  drawMarkers(def, add);
  const applyUv = (on: boolean): void => {
    for (const m of surfaceMats) {
      m.map = on ? uvTex : null;
      m.needsUpdate = true;
    }
  };
  applyUv(params.has('uv'));
  const cam = parseCam(params.get('cam'));
  const focus = params.get('focus');
  const fs = focus && built ? built.surfaces[focus] : undefined;
  if (cam) {
    s.camera.position.copy(cam.pos);
    controls.target.copy(cam.target);
    controls.update();
  } else if (fs) {
    const c = new Vector3((fs.bounds.min.x + fs.bounds.max.x) / 2, (fs.bounds.min.y + fs.bounds.max.y) / 2, (fs.bounds.min.z + fs.bounds.max.z) / 2);
    const r = Math.max(2, Math.hypot(fs.bounds.max.x - fs.bounds.min.x, fs.bounds.max.y - fs.bounds.min.y, fs.bounds.max.z - fs.bounds.min.z));
    s.camera.position.set(c.x + r * 0.7, c.y + r * 0.6, c.z + r * 0.9);
    controls.target.copy(c);
    controls.update();
  } else if (params.has('top')) setTop();
  else setOverview();
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') setTop();
    if (e.key === 'c' || e.key === 'C') colliderGroup.visible = !colliderGroup.visible;
    if (e.key === 'u' || e.key === 'U') applyUv(surfaceMats[0]?.map === null);
  });
  panel.setStatus(status);
  startFrames((_dt, frame) => {
    controls.update();
    s.render();
    shotReadyAt(frame);
  });
}

void main();
