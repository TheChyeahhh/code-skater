/**
 * src/render/npc.ts (skater track): NPC figures built from primitives, stylised, no facial likeness
 * of any real person (REQ-NPC-01, REQ-BRD-05). The hoodie NPC carries an empty laptop sleeve, the
 * contest-jacket NPC holds a coffee cup. Idle sway and breathing; a wave and a nod while talking.
 * Names and lines are never here: the HUD reads BRANDS (REQ-NPC-03).
 *
 * Also the pickup props (readable from afar): the C-O-D-E letters as chunky extruded block letters
 * on a dark coin, and the two MacGuffins (an open laptop with a screen lit on both faces, an
 * external drive with a lit LED bar around three sides), each inside an emissive halo ring under a
 * tall additive beacon, findable across the park. LevelView may build its pickups from these
 * (createLetterProp / createMacGuffinProp); they are static groups, the caller spins and bobs them,
 * and calls the optional update(dt) for the LED pulse. Pure three.js geometry (no canvas), so
 * everything here builds in node for tests.
 */

import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Shape, TorusGeometry, type Material,
} from 'three';
import { facingToYaw } from '../core/math';
import { TUNING } from '../core/tuning';
import type { LetterId, MacGuffinId } from '../core/types';
import type { NpcDef } from '../levels/types';
import type { NpcFigure } from './types';
import { RIG } from './skater/poses';
import { bakeColoredParts, buildHumanoid, createRimMaterial, setBoneRotation, type ColoredPart, type Humanoid, type RigColors } from './skater/rig';

const DEG = Math.PI / 180;

/** Hoodie NPC: forest green hoodie, grey jeans, dark hair; sleeve dark grey. */
const HOODIE_COLORS: RigColors = {
  top: '#3d7a58',
  topDark: '#2b563e',
  pants: '#4b4d58',
  shoe: '#1f2024',
  sole: '#d9d4c7',
  skin: '#c9986f',
  hat: '#4a2f1d',
  hair: '#4a2f1d',
  eyes: '#1a1a1e',
};

/** Contest-jacket NPC: navy staff jacket with a white zip stripe, black trousers, short dark hair. */
const JACKET_COLORS: RigColors = {
  top: '#24397a',
  topDark: '#eef1f7',
  pants: '#1c1d24',
  shoe: '#f1ede4',
  sole: '#3b3230',
  skin: '#d8b090',
  hat: '#2a2320',
  hair: '#2a2320',
  eyes: '#1a1a1e',
};

function triCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}

interface PropParts {
  readonly geos: BufferGeometry[];
  readonly mats: Material[];
  triangles: number;
}

function partMesh(parts: PropParts, geo: BufferGeometry, mat: Material, parent: Object3D, x: number, y: number, z: number, rot?: { x?: number; y?: number; z?: number }): Mesh {
  parts.geos.push(geo);
  parts.triangles += triCount(geo);
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Carried-prop parts laid out under the hand as placeholder frames, then baked into one mesh (one draw). */
interface PropLayout {
  readonly parts: ColoredPart[];
}

function propPart(layout: PropLayout, geo: BufferGeometry, color: string, parent: Object3D, x: number, y: number, z: number, rot?: { x?: number; y?: number; z?: number }): void {
  const n = new Object3D();
  n.position.set(x, y, z);
  if (rot) n.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
  parent.add(n);
  layout.parts.push({ node: n, geo, color });
}

/** Bake the laid-out parts into one vertex-coloured rim mesh on the hand and drop the placeholder frames. */
function bakeProp(parts: PropParts, layout: PropLayout, hand: Object3D, frame: Object3D): void {
  const geo = bakeColoredParts(hand, layout.parts);
  for (const p of layout.parts) p.geo.dispose();
  frame.removeFromParent();
  const mat = createRimMaterial('#ffffff', { vertexColors: true, roughness: 0.7 });
  parts.mats.push(mat);
  parts.geos.push(geo);
  parts.triangles += triCount(geo);
  const m = new Mesh(geo, mat);
  m.name = 'npc:prop';
  m.castShadow = true;
  hand.add(m);
}

/** The empty laptop sleeve: a flat, slightly slumped padded rectangle with a bright zip and a flap, hanging from the hand. */
function addLaptopSleeve(parts: PropParts, hand: Object3D): void {
  const shell = '#3a3f4c';
  const trim = '#d8dde8';
  const layout: PropLayout = { parts: [] };
  const sleeve = new Object3D();
  sleeve.position.set(0.03, -0.22, 0.0);
  sleeve.rotation.set(0, 0.7, -0.08);
  hand.add(sleeve);
  propPart(layout, new BoxGeometry(0.04, 0.34, 0.28), shell, sleeve, 0, 0, 0);
  // Flap folded over the top (empty: it sags).
  propPart(layout, new BoxGeometry(0.05, 0.07, 0.29), shell, sleeve, 0, 0.16, 0, { x: 0.15 });
  // Zip stripe along the flap edge (bright, so the sleeve reads as a bag), a zip pull and a label patch.
  propPart(layout, new BoxGeometry(0.056, 0.02, 0.26), trim, sleeve, 0, 0.13, 0.005);
  propPart(layout, new BoxGeometry(0.02, 0.05, 0.02), trim, sleeve, 0.02, 0.1, 0.1);
  propPart(layout, new BoxGeometry(0.046, 0.05, 0.08), trim, sleeve, 0, -0.06, 0.06);
  // Carry loop the hand holds.
  propPart(layout, new BoxGeometry(0.02, 0.05, 0.03), trim, sleeve, 0, 0.2, 0);
  bakeProp(parts, layout, hand, sleeve);
}

/** A takeaway coffee cup with a lid and a sleeve, held upright in the hand. */
function addCoffeeCup(parts: PropParts, hand: Object3D): void {
  const paper = '#efe6d6';
  const lid = '#f6f6f6';
  const band = '#8a5a34';
  const layout: PropLayout = { parts: [] };
  const cup = new Object3D();
  cup.position.set(0, -0.02, -0.045);
  hand.add(cup);
  propPart(layout, new CylinderGeometry(0.044, 0.036, 0.13, 10), paper, cup, 0, 0, 0);
  propPart(layout, new CylinderGeometry(0.047, 0.045, 0.045, 10), band, cup, 0, -0.005, 0);
  propPart(layout, new CylinderGeometry(0.049, 0.044, 0.022, 10), lid, cup, 0, 0.076, 0);
  propPart(layout, new CylinderGeometry(0.014, 0.014, 0.014, 6), lid, cup, 0.024, 0.094, 0);
  bakeProp(parts, layout, hand, cup);
}

interface Idle {
  readonly wave: 'L' | 'R';
}

function poseHoodie(h: Humanoid, t: number, talking: boolean, idle: Idle): void {
  // Left hand carries the sleeve by its loop; the arm hangs a touch away from the hip.
  setBoneRotation(h.bones.upperArmL, 6, 0, -14);
  setBoneRotation(h.bones.lowerArmL, 8, 0, 0);
  waveOrRest(h, 'R', t, talking, idle.wave === 'R');
}

function poseJacket(h: Humanoid, t: number, talking: boolean, idle: Idle): void {
  // Right forearm up and across, cup at chest height; left hand loosely at the side.
  setBoneRotation(h.bones.upperArmR, 34, 0, 18);
  setBoneRotation(h.bones.lowerArmR, 96 + Math.sin(t * 1.3) * 2, -20, 0);
  waveOrRest(h, 'L', t, talking, idle.wave === 'L');
}

/** A free arm: hangs and swings a little while idle, waves from the elbow while talking. */
function waveOrRest(h: Humanoid, side: 'L' | 'R', t: number, talking: boolean, waves: boolean): void {
  const s = side === 'L' ? -1 : 1;
  const upper = h.bones[`upperArm${side}`];
  const lower = h.bones[`lowerArm${side}`];
  if (talking && waves) {
    const w = Math.sin(t * TUNING.NPC_WAVE_HZ * Math.PI * 2);
    setBoneRotation(upper, 10, 0, s * 78);
    setBoneRotation(lower, 0, w * 14, s * (92 + w * 22));
  } else {
    setBoneRotation(upper, 4 + Math.sin(t * 0.9) * 3, 0, s * 12);
    setBoneRotation(lower, 12, 0, 0);
  }
}

export function createNpcFigure(def: NpcDef): NpcFigure {
  const group = new Group();
  group.name = `npc:${def.id}`;
  const hoodie = def.outfit === 'hoodie';
  // Hood up for the hoodie NPC, short parted hair for the jacket NPC: the pair reads apart at a glance.
  const rig = buildHumanoid(hoodie ? { colors: HOODIE_COLORS, head: 'hood', jacket: false } : { colors: JACKET_COLORS, head: 'hair', jacket: true, hair: 'part' });
  group.add(rig.root);
  const parts: PropParts = { geos: [], mats: [], triangles: 0 };
  if (def.prop === 'laptopSleeve') addLaptopSleeve(parts, rig.handL);
  else addCoffeeCup(parts, rig.handR);
  group.position.set(def.pos.x, def.pos.y, def.pos.z);
  group.rotation.set(0, facingToYaw(def.facing), 0);
  const idle: Idle = { wave: def.prop === 'coffee' ? 'L' : 'R' };
  let t = def.id === 'sam' ? 0 : 1.7;
  const pose = (talking: boolean): void => {
    const sway = TUNING.NPC_IDLE_SWAY_DEG;
    const breath = Math.sin(t * 2.1);
    const look = Math.sin(t * 0.45) * 14;
    setBoneRotation(rig.bones.hips, 0, Math.sin(t * 0.9) * 3, Math.sin(t * 0.7) * sway * 0.35);
    setBoneRotation(rig.bones.spine, -2 + breath, 0, Math.sin(t * 0.7 + 0.4) * sway * 0.5);
    setBoneRotation(rig.bones.chest, -3 + breath * 1.5, Math.sin(t * 0.5) * 4, Math.sin(t * 0.7 + 0.8) * sway * 0.4);
    setBoneRotation(rig.bones.neck, 0, look * 0.4, 0);
    if (talking) setBoneRotation(rig.bones.head, 4 + Math.sin(t * 7) * 5, look * 0.3, Math.sin(t * 3.5) * 3);
    else setBoneRotation(rig.bones.head, 3, look, 0);
    // The mouth opens and closes at TUNING.NPC_MOUTH_HZ while talking.
    rig.mouth.scale.y = talking ? 1 + 2.5 * Math.abs(Math.sin(t * TUNING.NPC_MOUTH_HZ * Math.PI)) : 1;
    // Weight on one leg, the other slightly bent.
    setBoneRotation(rig.bones.thighL, 2, 0, -4);
    setBoneRotation(rig.bones.shinL, -6, 0, 0);
    setBoneRotation(rig.bones.footL, 4, 6, 4);
    setBoneRotation(rig.bones.thighR, -4, 0, 5);
    setBoneRotation(rig.bones.shinR, -2, 0, 0);
    setBoneRotation(rig.bones.footR, 6, -10, -5);
    rig.bones.hips.position.y = RIG.hipY - 0.012 + Math.sin(t * 2.1) * 0.004;
    if (hoodie) poseHoodie(rig, t, talking, idle);
    else poseJacket(rig, t, talking, idle);
  };
  pose(false);
  return {
    group,
    update(dtS, talking) {
      const dt = Number.isFinite(dtS) ? Math.max(0, Math.min(0.1, dtS)) : 0;
      t += dt;
      pose(talking);
    },
    dispose() {
      rig.dispose();
      for (const g of parts.geos) g.dispose();
      for (const m of parts.mats) m.dispose();
    },
  };
}

/** Rig and prop triangle counts, for tests and the harness. */
export function npcTriangles(def: NpcDef): number {
  const fig = createNpcFigure(def);
  let n = 0;
  fig.group.traverse((o) => {
    if (o instanceof Mesh) n += triCount(o.geometry as BufferGeometry);
  });
  fig.dispose();
  return n;
}

// ---------------------------------------------------------------------------------------------
// Pickup props
// ---------------------------------------------------------------------------------------------

export interface PickupProp {
  readonly group: Group;
  readonly triangles: number;
  /** Per-frame animation the prop owns (the MacGuffin LED pulse); the caller spins and bobs the group. */
  update?(dtS: number): void;
  dispose(): void;
}

/** Per-letter face colours: four saturated hues so the tray and the park agree on which is which. */
export const LETTER_COLORS: Readonly<Record<LetterId, string>> = {
  C: '#3ee6ff',
  O: '#ffd23f',
  D: '#ff6b57',
  E: '#7dff5a',
};

const LETTER_SIZE_M = 0.72;
/** Letter extrusion depth: deeper than the coin so the letter stands proud of both faces. */
const LETTER_DEPTH_M = 0.2;
const COIN_THICKNESS_M = 0.06;

function arcPath(shape: Shape, cx: number, cy: number, radius: number, a0: number, a1: number, clockwise: boolean, moveFirst: boolean): void {
  if (moveFirst) shape.moveTo(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius);
  shape.absarc(cx, cy, radius, a0, a1, clockwise);
}

/** Block-letter outlines in a unit box centred on the origin (x right, y up). */
export function letterShape(letter: LetterId): Shape {
  const s = new Shape();
  switch (letter) {
    case 'C': {
      const gap = 42 * DEG;
      arcPath(s, 0, 0, 0.5, gap, Math.PI * 2 - gap, false, true);
      arcPath(s, 0, 0, 0.26, Math.PI * 2 - gap, gap, true, false);
      s.closePath();
      break;
    }
    case 'O': {
      arcPath(s, 0, 0, 0.5, 0, Math.PI * 2, false, true);
      s.closePath();
      const hole = new Shape();
      arcPath(hole, 0, 0, 0.26, 0, Math.PI * 2, true, true);
      hole.closePath();
      s.holes.push(hole);
      break;
    }
    case 'D': {
      s.moveTo(-0.42, -0.5);
      s.lineTo(0.02, -0.5);
      s.absarc(0.02, 0, 0.5, -Math.PI / 2, Math.PI / 2, false);
      s.lineTo(-0.42, 0.5);
      s.closePath();
      const hole = new Shape();
      hole.moveTo(-0.18, -0.25);
      hole.lineTo(-0.18, 0.25);
      hole.lineTo(0.0, 0.25);
      hole.absarc(0.0, 0, 0.25, Math.PI / 2, -Math.PI / 2, true);
      hole.closePath();
      s.holes.push(hole);
      break;
    }
    case 'E': {
      const pts: readonly (readonly [number, number])[] = [
        [-0.42, -0.5], [0.42, -0.5], [0.42, -0.28], [-0.16, -0.28], [-0.16, -0.11], [0.32, -0.11],
        [0.32, 0.11], [-0.16, 0.11], [-0.16, 0.28], [0.42, 0.28], [0.42, 0.5], [-0.42, 0.5],
      ];
      pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
      s.closePath();
      break;
    }
  }
  return s;
}

/** A C-O-D-E letter: a chunky bevelled block letter in its colour, glowing, on a dark coin. */
export function createLetterProp(letter: LetterId): PickupProp {
  const group = new Group();
  group.name = `letter:${letter}`;
  const parts: PropParts = { geos: [], mats: [], triangles: 0 };
  const color = LETTER_COLORS[letter];
  const face = new MeshStandardMaterial({ color, emissive: new Color(color), emissiveIntensity: letterFaceGlow(), roughness: 0.4, metalness: 0, flatShading: true });
  const coin = new MeshStandardMaterial({ color: '#15171d', roughness: 0.6, metalness: 0.3, flatShading: true });
  const rim = new MeshStandardMaterial({ color: '#f4f6ff', emissive: new Color('#c8d8ff'), emissiveIntensity: letterRimGlow(), roughness: 0.35 });
  parts.mats.push(face, coin, rim);
  const geo = new ExtrudeGeometry(letterShape(letter), { depth: LETTER_DEPTH_M / LETTER_SIZE_M, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 1, curveSegments: 12 });
  geo.center();
  const m = partMesh(parts, geo, face, group, 0, 0, 0);
  m.scale.setScalar(LETTER_SIZE_M);
  // Dark coin through the letter's middle so it reads against sky, glass and wood alike, from both sides.
  partMesh(parts, new CylinderGeometry(0.5, 0.5, COIN_THICKNESS_M, 28), coin, group, 0, 0, 0, { x: Math.PI / 2 });
  partMesh(parts, new TorusGeometry(0.5, 0.028, 6, 32), rim, group, 0, 0, 0);
  return {
    group,
    get triangles() {
      return parts.triangles;
    },
    update() {
      // Live glow (the dev panel edits RLV_PICKUP_EMISSIVE and the ratios at runtime).
      face.emissiveIntensity = letterFaceGlow();
      rim.emissiveIntensity = letterRimGlow();
    },
    dispose() {
      for (const g of parts.geos) g.dispose();
      for (const mat of parts.mats) mat.dispose();
    },
  };
}

/** Letter face glow: the pickup emissive (REQ-LVL-08) scaled so the hue blooms without clipping to white. */
function letterFaceGlow(): number {
  return TUNING.RLV_PICKUP_EMISSIVE * TUNING.PICKUP_LETTER_GLOW;
}

function letterRimGlow(): number {
  return TUNING.RLV_PICKUP_EMISSIVE * TUNING.PICKUP_LETTER_RIM_GLOW;
}

export const MACGUFFIN_GLOW: Readonly<Record<MacGuffinId, string>> = {
  secret_laptop: '#ffd166',
  secret_drive: '#9cff8a',
};

/** MacGuffin props are built 1.6x life size: a 2500-point once-per-career pickup needs presence at 5 m. */
const MACGUFFIN_SCALE = 1.6;
/**
 * Vertical beacon: additive cylinder fading from the glow colour to nothing at the top, dimmed by the
 * material colour (TUNING.MACGUFFIN_BEACON_ALPHA, live: added twice by the two walls and lifted by
 * AgX, so it stays tiny). Geometry sizes are fixed at build time.
 */
const BEACON_RADIUS_M = 0.3;
const BEACON_HEIGHT_M = 3.5;

/** An open-ended cylinder whose vertex colours fade the glow to black toward the top (additive = a fade); the material colour sets the base brightness. */
function beaconGeometry(glow: string): BufferGeometry {
  const geo = new CylinderGeometry(BEACON_RADIUS_M, BEACON_RADIUS_M, BEACON_HEIGHT_M, 16, 1, true);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color(glow);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + BEACON_HEIGHT_M / 2) / BEACON_HEIGHT_M;
    const k = (1 - t) * (1 - t);
    colors[i * 3] = c.r * k;
    colors[i * 3 + 1] = c.g * k;
    colors[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/**
 * A MacGuffin: an open laptop with a screen lit on both faces of the lid, or an external drive with
 * a pulsing LED bar wrapping the front and both sides, inside a halo ring, under a tall beacon.
 */
export function createMacGuffinProp(id: MacGuffinId): PickupProp {
  const group = new Group();
  group.name = `macguffin:${id}`;
  const parts: PropParts = { geos: [], mats: [], triangles: 0 };
  const glow = MACGUFFIN_GLOW[id];
  const shell = new MeshStandardMaterial({ color: id === 'secret_laptop' ? '#d3d8e2' : '#b9c0cc', metalness: 0.15, roughness: 0.45, flatShading: true });
  const light = new MeshStandardMaterial({ color: glow, emissive: new Color(glow), emissiveIntensity: TUNING.RLV_PICKUP_EMISSIVE, roughness: 0.5 });
  const keys = new MeshStandardMaterial({ color: '#0f1014', roughness: 0.8 });
  const halo = new MeshStandardMaterial({ color: glow, emissive: new Color(glow), emissiveIntensity: TUNING.RLV_PICKUP_EMISSIVE * TUNING.MACGUFFIN_HALO_GLOW, roughness: 0.5, transparent: true, opacity: 0.85 });
  const beacon = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
  const beaconLevel = (): void => {
    beacon.color.setScalar(TUNING.MACGUFFIN_BEACON_ALPHA);
  };
  beaconLevel();
  parts.mats.push(shell, light, keys, halo, beacon);
  const body = new Group();
  body.scale.setScalar(MACGUFFIN_SCALE);
  group.add(body);
  if (id === 'secret_laptop') {
    // Base, keyboard well, hinged lid, a bright screen on both faces of the lid, a lit logo on the back.
    partMesh(parts, new BoxGeometry(0.5, 0.03, 0.34), shell, body, 0, -0.16, 0.04);
    partMesh(parts, new BoxGeometry(0.42, 0.012, 0.18), keys, body, 0, -0.14, 0.02);
    partMesh(parts, new BoxGeometry(0.12, 0.008, 0.07), keys, body, 0, -0.142, 0.15);
    const lid = new Object3D();
    lid.position.set(0, -0.15, -0.13);
    lid.rotation.x = -0.32;
    body.add(lid);
    partMesh(parts, new BoxGeometry(0.5, 0.36, 0.02), shell, lid, 0, 0.18, 0);
    partMesh(parts, new BoxGeometry(0.44, 0.29, 0.006), light, lid, 0, 0.19, 0.012);
    partMesh(parts, new BoxGeometry(0.44, 0.29, 0.006), light, lid, 0, 0.19, -0.012);
    partMesh(parts, new BoxGeometry(0.1, 0.1, 0.008), keys, lid, 0, 0.19, -0.016);
    partMesh(parts, new BoxGeometry(0.06, 0.06, 0.008), light, lid, 0, 0.19, -0.02);
  } else {
    // External drive: brushed box, rubber feet, a label plate, a lit LED bar wrapping the front and
    // both sides, a cable stub.
    partMesh(parts, new BoxGeometry(0.34, 0.11, 0.5), shell, body, 0, -0.08, 0);
    partMesh(parts, new BoxGeometry(0.26, 0.006, 0.3), keys, body, 0, -0.02, 0.02);
    partMesh(parts, new BoxGeometry(0.34, 0.02, 0.03), light, body, 0, -0.06, 0.255);
    partMesh(parts, new BoxGeometry(0.03, 0.02, 0.5), light, body, 0.17, -0.06, 0);
    partMesh(parts, new BoxGeometry(0.03, 0.02, 0.5), light, body, -0.17, -0.06, 0);
    partMesh(parts, new CylinderGeometry(0.012, 0.012, 0.08, 8), keys, body, 0.1, -0.08, -0.28, { x: Math.PI / 2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) partMesh(parts, new CylinderGeometry(0.02, 0.02, 0.012, 8), keys, body, sx * 0.13, -0.14, sz * 0.2);
  }
  partMesh(parts, new TorusGeometry(0.52, 0.02, 6, 40), halo, body, 0, 0, 0, { x: Math.PI / 2 });
  const beam = partMesh(parts, beaconGeometry(glow), beacon, group, 0, BEACON_HEIGHT_M / 2 - 0.3, 0);
  beam.castShadow = false;
  let t = 0;
  return {
    group,
    get triangles() {
      return parts.triangles;
    },
    update(dtS) {
      const dt = Number.isFinite(dtS) ? Math.max(0, Math.min(0.1, dtS)) : 0;
      t += dt;
      const base = TUNING.RLV_PICKUP_EMISSIVE;
      light.emissiveIntensity = base * (1 + TUNING.MACGUFFIN_PULSE_GLOW * Math.sin(t * TUNING.MACGUFFIN_PULSE_HZ * Math.PI * 2));
      halo.emissiveIntensity = base * TUNING.MACGUFFIN_HALO_GLOW;
      beaconLevel();
    },
    dispose() {
      for (const g of parts.geos) g.dispose();
      for (const mat of parts.mats) mat.dispose();
    },
  };
}
