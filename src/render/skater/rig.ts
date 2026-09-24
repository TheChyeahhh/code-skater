/**
 * src/render/skater/rig.ts (skater track): the procedural low-poly humanoid (REQ-SKT-01) shared by
 * the skater and the NPC figures (REQ-NPC-01). Capsules and boxes under a joint hierarchy of bones
 * (hips, spine, chest, neck, head, shoulders, elbows, hands, thighs, knees, ankles), flat-shaded with
 * a rim light term injected into MeshStandardMaterial, plus a dark inverted-hull ink line (a back-face
 * copy of the big parts pushed out by the outline width): the classic arcade outline. No likeness of
 * anyone: the face is two eye blocks and a mouth block on a rounded head.
 *
 * Draw cost. Every part is baked into ONE rigidly skinned mesh (each vertex weighted 1.0 to the bone
 * that carries it, colours in a vertex attribute), and every hull into one more, so a whole figure is
 * two draws in the main pass and one in the shadow pass, whatever the part count.
 *
 * Bind pose: standing, arms hanging, soles at y = 0, body facing -z, +x right. Bone frames are
 * identity in bind, so a JointRotation (degrees, XYZ) applies directly (see poses.ts).
 */

import {
  BackSide, Bone, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group,
  Matrix3, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Object3D, Skeleton, SkinnedMesh, Sphere, SphereGeometry, TorusGeometry,
  Uint16BufferAttribute, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BoneId } from './poses';
import { RIG } from './poses';

export interface RigColors {
  readonly top: string;
  readonly topDark: string;
  readonly pants: string;
  readonly shoe: string;
  readonly sole: string;
  readonly skin: string;
  readonly hat: string;
  readonly hair: string;
  readonly eyes: string;
}

/**
 * Saturated on purpose (founder playtest 2026-09-23: the skater read pastel): low green / blue in the
 * orange and a real blue in the pants, because the warm 14x sun and AgX pull every lit colour toward
 * peach and grey. The value stays mid, so the flat-shaded folds still read.
 */
export const SKATER_COLORS: RigColors = {
  top: '#f2461c',
  topDark: '#b8300f',
  pants: '#26408c',
  shoe: '#f1ede4',
  sole: '#3b3230',
  skin: '#e0b48d',
  hat: '#17181d',
  hair: '#3a2416',
  eyes: '#1a1a1e',
};

/** Contrast panel on the cap front, so the cap reads as a cap at chase distance. */
const CAP_PANEL_COLOR = '#f1ede4';

export interface HumanoidSpec {
  readonly colors: RigColors;
  /** cap = skate cap with a brim; hood = hoodie hood up; hair = bare hair block (see `hair`). */
  readonly head: 'cap' | 'hood' | 'hair';
  /** Contest jacket: collar, zip stripe and a badge instead of the hoodie pocket. */
  readonly jacket: boolean;
  /** Bare-hair silhouette: round = a taller rounded mop; part = short hair with a side part. Default round. */
  readonly hair?: 'round' | 'part';
}

export interface Humanoid {
  readonly root: Group;
  readonly bones: Readonly<Record<BoneId, Object3D>>;
  /** Hand anchors (children of the lower arms, at the palm). */
  readonly handL: Object3D;
  readonly handR: Object3D;
  /** The mouth bone (child of the head, at the mouth block): scale.y it while talking. */
  readonly mouth: Object3D;
  readonly materials: readonly MeshStandardMaterial[];
  /** The whole body as one rigidly skinned mesh (one draw, one shadow caster). */
  readonly body: SkinnedMesh;
  /** The ink outline of the big parts as one skinned back-face mesh (one draw, no shadow). */
  readonly hull: SkinnedMesh;
  /** Body triangles plus the outline hull's. */
  readonly triangles: number;
  /** Outline hull width (metres) and brightness 0..1 (0 = the ink colour, 1 = the rim colour). */
  setOutline(widthM: number, brightness: number): void;
  dispose(): void;
}

/** Shared rim-light uniforms: the skater view writes TUNING into them every frame. */
export const RIM_UNIFORMS = {
  uRimColor: { value: new Color('#dfe8ff') },
  uRimStrength: { value: 0.25 },
  uRimPower: { value: 3.0 },
  /** Scale on the lit result (sun + sky + IBL): below 1 keeps the sunlit side out of AgX's desaturating shoulder. */
  uLightScale: { value: 0.7 },
  /** Albedo self-light added after the scale, so the shadow side keeps its colour. */
  uSelfLight: { value: 0.12 },
};

/** Outline defaults for rigs nobody drives (NPCs): the skater view overrides its own each frame. */
export const OUTLINE_DEFAULT_M = 0.012;
export const OUTLINE_DEFAULT_BRIGHTNESS = 0;
/** The outline at brightness 0: a blue-black ink, so the stroke reads as a drawn line, not a hole or a glow. */
export const OUTLINE_INK = new Color('#07080d');

/**
 * The figure's light response, then the rim term. The lit result is scaled down and a little albedo
 * self-light added (so the sunlit side stays saturated under AgX and the shadow side keeps its hue),
 * then the rim is added only on the side the sun does not reach (directionalLights[0] is the sun), so
 * the lit clothes keep their colour and the shadow side still separates from the ground. `normal`
 * and the light direction are both view space.
 */
const RIM_GLSL = `
  {
    outgoingLight = outgoingLight * uLightScale + diffuseColor.rgb * uSelfLight;
    vec3 rimV = normalize(vViewPosition);
    float rimF = pow(1.0 - clamp(dot(normal, rimV), 0.0, 1.0), uRimPower);
    float rimLit = 0.0;
    #if NUM_DIR_LIGHTS > 0
      rimLit = clamp(dot(normal, directionalLights[0].direction), 0.0, 1.0);
    #endif
    outgoingLight += uRimColor * (rimF * uRimStrength * (1.0 - rimLit));
  }
  #include <opaque_fragment>`;

/** Flat-shaded standard material with the rim term (REQ-SKT-01). vertexColors: the albedo comes from a colour attribute. */
export function createRimMaterial(color: string, extra: { emissive?: string; emissiveIntensity?: number; roughness?: number; metalness?: number; vertexColors?: boolean } = {}): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color,
    roughness: extra.roughness ?? 0.85,
    metalness: extra.metalness ?? 0,
    // Graphics overhaul 2026-09-23: smooth shading (the flat facets read as a block figure).
    flatShading: false,
    vertexColors: extra.vertexColors ?? false,
    emissive: extra.emissive ? new Color(extra.emissive) : new Color('#000000'),
    emissiveIntensity: extra.emissiveIntensity ?? 1,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = RIM_UNIFORMS.uRimColor;
    shader.uniforms.uRimStrength = RIM_UNIFORMS.uRimStrength;
    shader.uniforms.uRimPower = RIM_UNIFORMS.uRimPower;
    shader.uniforms.uLightScale = RIM_UNIFORMS.uLightScale;
    shader.uniforms.uSelfLight = RIM_UNIFORMS.uSelfLight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nuniform float uLightScale;\nuniform float uSelfLight;')
      .replace('#include <opaque_fragment>', RIM_GLSL);
  };
  mat.customProgramCacheKey = () => 'skater-rim';
  return mat;
}

/**
 * The ink hull material: back faces only, each vertex pushed out along its `hullOffset` attribute by
 * the live width (metres per unit of hullOffset). Shared by the figures and the deck outline.
 */
export function createHullMaterial(width: { value: number }): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ color: OUTLINE_INK.clone(), side: BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = width;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 hullOffset;\nuniform float uOutlineWidth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += hullOffset * uOutlineWidth;');
  };
  mat.customProgramCacheKey = () => 'skater-hull';
  return mat;
}

function triCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}

// Limb tessellation: 8-sided flat-shaded limbs keep body + hull inside the 4k budget.
const LIMB_RADIAL = 10;
const LIMB_CAPS = 3;
/** Rounded-box bevel segments (graphics overhaul 2026-09-23): soft edges on the torso, head, shoes and hands. */
const ROUND_SEG = 1;
const rbox = (w: number, h: number, d: number, r: number): BufferGeometry => new RoundedBoxGeometry(w, h, d, ROUND_SEG, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
/** Parts thinner than this on any axis get no hull (an eye's hull would stand off the face). */
export const HULL_MIN_SIZE = 0.03;
/** Culling sphere of a posed figure, rig space: covers every pose of the library (bail dive and arms up included). */
const FIGURE_BOUNDS = new Sphere(new Vector3(0, 0.9, 0), 2.2);

const tmpM3 = new Matrix3();
const tmpV = new Vector3();

function sizeOf(geo: BufferGeometry): Vector3 {
  if (!geo.boundingBox) geo.computeBoundingBox();
  return geo.boundingBox ? geo.boundingBox.getSize(new Vector3()) : new Vector3(1, 1, 1);
}

function addRigidSkin(out: BufferGeometry, n: number, boneIndex: number): void {
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = boneIndex;
    w[i * 4] = 1;
  }
  out.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  out.setAttribute('skinWeight', new Float32BufferAttribute(w, 4));
}

/** One part's geometry moved into the target frame by `m`, with its colour (and the rigid skin weight when boneIndex is given). */
function bakePart(src: BufferGeometry, m: Matrix4, color: Color, boneIndex: number | null): BufferGeometry {
  // Rounded boxes come non-indexed; every part is baked non-indexed so they all merge.
  const geo = src.index ? src.toNonIndexed() : src;
  const out = new BufferGeometry();
  const pos = geo.getAttribute('position').clone();
  pos.applyMatrix4(m);
  const nrm = geo.getAttribute('normal').clone();
  nrm.applyNormalMatrix(tmpM3.getNormalMatrix(m));
  out.setAttribute('position', pos);
  out.setAttribute('normal', nrm);
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  out.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (boneIndex !== null) addRigidSkin(out, n, boneIndex);
  if (geo !== src) geo.dispose();
  return out;
}

/**
 * One part's hull: its positions in the figure frame plus `hullOffset`, the direction that grows the
 * part about its own origin by 2 x width / size on each local axis (so every part's outline is the
 * same width in metres, box or capsule), rotated into the figure frame.
 */
function bakeHull(input: BufferGeometry, m: Matrix4, size: Vector3, boneIndex: number): BufferGeometry {
  const geo = input.index ? input.toNonIndexed() : input;
  const out = new BufferGeometry();
  const src = geo.getAttribute('position');
  const pos = src.clone();
  pos.applyMatrix4(m);
  out.setAttribute('position', pos);
  const rot = tmpM3.setFromMatrix4(m);
  const off = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    tmpV.set((2 * src.getX(i)) / size.x, (2 * src.getY(i)) / size.y, (2 * src.getZ(i)) / size.z).applyMatrix3(rot);
    off[i * 3] = tmpV.x;
    off[i * 3 + 1] = tmpV.y;
    off[i * 3 + 2] = tmpV.z;
  }
  out.setAttribute('hullOffset', new BufferAttribute(off, 3));
  addRigidSkin(out, src.count, boneIndex);
  if (geo !== input) geo.dispose();
  return out;
}

/** A part placed in a build-time frame tree: the node's matrix relative to the anchor is baked into the merged geometry. */
export interface ColoredPart {
  readonly node: Object3D;
  readonly geo: BufferGeometry;
  readonly color: string;
}

/**
 * Bake parts laid out under `anchor` (placeholder Object3D nodes at any depth) into one vertex-coloured
 * geometry in the anchor's frame, so a whole prop is one mesh and one draw (the NPC props).
 */
export function bakeColoredParts(anchor: Object3D, parts: readonly ColoredPart[]): BufferGeometry {
  anchor.updateMatrixWorld(true);
  const inv = new Matrix4().copy(anchor.matrixWorld).invert();
  const baked = parts.map((p) => bakePart(p.geo, new Matrix4().multiplyMatrices(inv, p.node.matrixWorld), new Color(p.color), null));
  const merged = mergeGeometries(baked);
  for (const b of baked) b.dispose();
  if (!merged) throw new Error('bakeColoredParts: parts do not merge');
  return merged;
}

interface PartRec {
  readonly node: Object3D;
  readonly geo: BufferGeometry;
  readonly color: Color;
  readonly hull: boolean;
}

export function buildHumanoid(spec: HumanoidSpec): Humanoid {
  const c = spec.colors;
  const col = {
    top: new Color(c.top),
    topDark: new Color(c.topDark),
    pants: new Color(c.pants),
    shoe: new Color(c.shoe),
    sole: new Color(c.sole),
    skin: new Color(c.skin),
    hat: new Color(c.hat),
    hair: new Color(c.hair),
    eyes: new Color(c.eyes),
    capPanel: new Color(CAP_PANEL_COLOR),
    eyeWhite: new Color('#f4f1ea'),
    skinDark: new Color(c.skin).multiplyScalar(0.85),
  };
  const geos: BufferGeometry[] = [];
  const parts: PartRec[] = [];
  const boneList: Bone[] = [];
  const g = <T extends BufferGeometry>(geo: T): T => {
    geos.push(geo);
    return geo;
  };
  /**
   * A part: a placeholder frame under a bone (or under another part's frame) whose geometry is baked
   * into the skinned body. Inner parts (a knee ball inside the thigh, the neck inside the head) skip
   * the hull: it would poke out as a ring.
   */
  const mesh = (geo: BufferGeometry, color: Color, x: number, y: number, z: number, parent: Object3D, rot?: { x?: number; y?: number; z?: number }, hull = true): Object3D => {
    const n = new Object3D();
    n.position.set(x, y, z);
    if (rot) n.rotation.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0);
    parent.add(n);
    parts.push({ node: n, geo, color, hull });
    return n;
  };
  const bone = (name: BoneId | string, parent: Object3D, x: number, y: number, z: number): Bone => {
    const b = new Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    boneList.push(b);
    return b;
  };

  const root = new Group();
  root.name = 'humanoid';

  // Hierarchy. The neck is short (0.05) so the oversized arcade head keeps the standing height.
  const hips = bone('hips', root, 0, RIG.hipY, 0);
  const spine = bone('spine', hips, 0, 0.08, 0);
  const chest = bone('chest', spine, 0, 0.2, 0);
  const neck = bone('neck', chest, 0, 0.3, 0);
  const head = bone('head', neck, 0, 0.05, 0);
  const upperArmL = bone('upperArmL', chest, -0.24, 0.27, 0);
  const lowerArmL = bone('lowerArmL', upperArmL, 0, -RIG.upperArm, 0);
  const upperArmR = bone('upperArmR', chest, 0.24, 0.27, 0);
  const lowerArmR = bone('lowerArmR', upperArmR, 0, -RIG.upperArm, 0);
  const thighL = bone('thighL', hips, -0.1, -0.02, 0);
  const shinL = bone('shinL', thighL, 0, -RIG.thigh, 0);
  const footL = bone('footL', shinL, 0, -RIG.shin, 0);
  const thighR = bone('thighR', hips, 0.1, -0.02, 0);
  const shinR = bone('shinR', thighR, 0, -RIG.thigh, 0);
  const footR = bone('footR', shinR, 0, -RIG.shin, 0);
  const handL = bone('handL', lowerArmL, 0, -RIG.lowerArm - 0.05, 0);
  const handR = bone('handR', lowerArmR, 0, -RIG.lowerArm - 0.05, 0);
  const mouth = bone('mouth', head, 0, 0.07, -0.113);

  // Pelvis and baggy pants: the legs are as bulky as the pelvis, straight shins that flare into a
  // stacked cuff over the shoe.
  const pelvis = g(rbox(0.4, 0.2, 0.27, 0.07));
  mesh(pelvis, col.pants, 0, 0.02, 0, hips);
  const thighGeo = g(new CapsuleGeometry(0.13, 0.2, LIMB_CAPS, LIMB_RADIAL));
  const shinGeo = g(new CylinderGeometry(0.11, 0.135, 0.3, LIMB_RADIAL, 1));
  const kneeGeo = g(new SphereGeometry(0.115, LIMB_RADIAL, 5));
  const cuffGeo = g(new CylinderGeometry(0.14, 0.15, 0.09, LIMB_RADIAL, 1));
  const soleGeo = g(rbox(0.14, 0.04, 0.32, 0.018));
  const upperGeo = g(rbox(0.13, 0.08, 0.29, 0.035));
  const toeGeo = g(rbox(0.115, 0.05, 0.1, 0.022));
  const tongueGeo = g(new BoxGeometry(0.09, 0.06, 0.09));
  const laceGeo = g(new BoxGeometry(0.06, 0.012, 0.11));
  for (const [thigh, shin, foot] of [[thighL, shinL, footL], [thighR, shinR, footR]] as const) {
    mesh(thighGeo, col.pants, 0, -0.21, 0, thigh);
    mesh(kneeGeo, col.pants, 0, -0.01, 0, shin, undefined, false);
    mesh(shinGeo, col.pants, 0, -0.19, 0, shin);
    mesh(cuffGeo, col.pants, 0, -0.36, 0.005, shin);
    // Chunky skate shoe: fat sole, upper, toe cap, tongue, laces.
    mesh(soleGeo, col.sole, 0, -RIG.ankle + 0.017, -0.05, foot);
    mesh(upperGeo, col.shoe, 0, -RIG.ankle + 0.068, -0.045, foot);
    mesh(toeGeo, col.sole, 0, -RIG.ankle + 0.05, -0.16, foot);
    mesh(tongueGeo, col.shoe, 0, -RIG.ankle + 0.115, -0.02, foot, undefined, false);
    mesh(laceGeo, col.sole, 0, -RIG.ankle + 0.11, -0.085, foot, undefined, false);
  }

  // Torso: hoodie (or jacket) body, chest, shoulders, a ribbed hem that overhangs the pelvis.
  // One continuous hoodie: the belly box runs up inside the chest box and both keep small bevels,
  // so the join never shows as a crease (it read as two stacked pillows).
  mesh(g(rbox(0.38, 0.3, 0.26, 0.05)), col.top, 0, 0.14, 0, spine);
  mesh(g(rbox(0.44, 0.06, 0.3, 0.025)), col.topDark, 0, 0.0, 0, spine);
  mesh(g(rbox(0.42, 0.34, 0.28, 0.06)), col.top, 0, 0.13, 0, chest);
  const shoulderGeo = g(new SphereGeometry(0.095, 8, 6));
  mesh(shoulderGeo, col.top, -0.23, 0.27, 0, chest);
  mesh(shoulderGeo, col.top, 0.23, 0.27, 0, chest);
  if (spec.jacket) {
    // Zip stripe, collar and a lanyard badge.
    mesh(g(new BoxGeometry(0.03, 0.5, 0.012)), col.topDark, 0, 0.09, -0.135, spine, undefined, false);
    mesh(g(new BoxGeometry(0.3, 0.05, 0.08)), col.topDark, 0, 0.32, -0.06, chest);
    mesh(g(new BoxGeometry(0.08, 0.1, 0.012)), col.shoe, -0.09, 0.08, -0.14, chest, undefined, false);
  } else {
    // Kangaroo pocket and a drawstring block.
    mesh(g(new BoxGeometry(0.26, 0.11, 0.03)), col.topDark, 0, 0.06, -0.13, spine);
    mesh(g(new BoxGeometry(0.14, 0.05, 0.02)), col.topDark, 0, 0.3, -0.135, chest, undefined, false);
  }
  if (spec.head === 'hood') {
    // Hood up: a hollow-looking rounded shell behind and over the head, plus the collar in front.
    mesh(g(new SphereGeometry(0.16, 10, 8)), col.topDark, 0, 0.13, 0.04, head);
    mesh(g(new TorusGeometry(0.08, 0.024, 6, 12)), col.topDark, 0, 0.32, -0.01, chest, { x: Math.PI / 2 });
  } else if (!spec.jacket) {
    // Hood down: a flattened half-torus collar lying behind the neck, a draped box down the back,
    // and a neckline ring at the chest top so the front shows a hoodie collar.
    mesh(g(new TorusGeometry(0.11, 0.045, 6, 12, Math.PI)), col.topDark, 0, 0.31, 0.05, chest, { x: Math.PI / 2 });
    mesh(g(new BoxGeometry(0.32, 0.06, 0.14)), col.topDark, 0, 0.29, 0.12, chest, { x: 0.25 });
    mesh(g(new TorusGeometry(0.07, 0.022, 6, 12)), col.topDark, 0, 0.32, -0.01, chest, { x: Math.PI / 2 });
  }

  // Arms: puffy sleeves, ribbed cuffs, skin mitts with a thumb nub (oversized so a grab reads).
  const upperArmGeo = g(new CapsuleGeometry(0.072, 0.18, LIMB_CAPS, LIMB_RADIAL));
  const lowerArmGeo = g(new CapsuleGeometry(0.062, 0.16, LIMB_CAPS, LIMB_RADIAL));
  const wristGeo = g(new CylinderGeometry(0.058, 0.052, 0.05, LIMB_RADIAL, 1));
  const handGeo = g(rbox(0.1, 0.12, 0.065, 0.03));
  const thumbGeo = g(new BoxGeometry(0.03, 0.05, 0.03));
  for (const [upper, lower, hand, side] of [[upperArmL, lowerArmL, handL, -1], [upperArmR, lowerArmR, handR, 1]] as const) {
    mesh(upperArmGeo, col.top, 0, -0.15, 0, upper);
    mesh(lowerArmGeo, col.top, 0, -0.13, 0, lower);
    mesh(wristGeo, col.topDark, 0, -RIG.lowerArm + 0.01, 0, lower, undefined, false);
    mesh(handGeo, col.skin, 0, 0.0, 0, hand);
    mesh(thumbGeo, col.skin, 0, 0.02, -0.045, hand, { z: side * 0.5 }, false);
  }

  // Neck and head (1.15x arcade head; the head box top sits at y 0.24 in the head frame).
  mesh(g(new CylinderGeometry(0.05, 0.055, 0.09, 8)), col.skin, 0, 0.02, 0, neck, undefined, false);
  const headGeo = g(rbox(0.23, 0.25, 0.22, 0.085));
  mesh(headGeo, col.skin, 0, 0.12, 0, head);
  // Face (graphics overhaul): white eyes with dark pupils, brows, a nose and ears, so it reads as a face.
  const eyeWhiteGeo = g(new SphereGeometry(0.024, 8, 6));
  const pupilGeo = g(new SphereGeometry(0.013, 6, 4));
  const browGeo = g(rbox(0.05, 0.012, 0.012, 0.005));
  for (const sx of [-1, 1]) {
    mesh(eyeWhiteGeo, col.eyeWhite, sx * 0.05, 0.135, -0.104, head, undefined, false);
    mesh(pupilGeo, col.eyes, sx * 0.05, 0.133, -0.124, head, undefined, false);
    mesh(browGeo, col.hair, sx * 0.052, 0.172, -0.112, head, { z: sx * -0.12 }, false);
    mesh(g(new SphereGeometry(0.032, 6, 5)), col.skin, sx * 0.118, 0.12, 0.005, head, undefined, false);
  }
  mesh(g(rbox(0.03, 0.045, 0.035, 0.012)), col.skinDark, 0, 0.1, -0.115, head, undefined, false);
  mesh(g(new BoxGeometry(0.06, 0.012, 0.01)), col.eyes, 0, 0, 0, mouth, undefined, false);
  if (spec.head === 'cap') {
    // Skate cap: a tall crown tilted back a touch, a button, a brim tilted up, a contrast front
    // panel, hair poking out at the back.
    const crown = mesh(g(new CylinderGeometry(0.13, 0.126, 0.115, 12)), col.hat, 0, 0.27, 0.0, head, { x: -0.08 });
    mesh(g(new SphereGeometry(0.014, 6, 4)), col.hat, 0, 0.0575, 0, crown, undefined, false);
    mesh(g(new BoxGeometry(0.14, 0.06, 0.012)), col.capPanel, 0, 0.0, -0.126, crown, undefined, false);
    mesh(g(new BoxGeometry(0.19, 0.014, 0.16)), col.hat, 0, 0.22, -0.17, head, { x: 0.18 }, false);
    mesh(g(new BoxGeometry(0.22, 0.05, 0.05)), col.hair, 0, 0.19, 0.115, head, undefined, false);
  } else if (spec.head === 'hair') {
    if (spec.hair === 'part') {
      // Short hair with a side part: a low block and a fringe block set off to one side.
      mesh(g(new BoxGeometry(0.24, 0.07, 0.23)), col.hat, 0, 0.255, 0.01, head);
      mesh(g(new BoxGeometry(0.13, 0.05, 0.06)), col.hat, 0.05, 0.235, -0.09, head, { z: -0.12 });
      mesh(g(new BoxGeometry(0.235, 0.06, 0.06)), col.hat, 0, 0.21, 0.1, head);
    } else {
      // A taller rounded mop clipped to the head top.
      mesh(g(new SphereGeometry(0.14, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55)), col.hat, 0, 0.19, 0.005, head);
      mesh(g(new BoxGeometry(0.235, 0.05, 0.07)), col.hat, 0, 0.215, -0.085, head, { x: 0.2 });
    }
  }

  // Bake: every part into the skinned body (weight 1 on the bone that carries it), the big ones into
  // the hull too, then drop the placeholder frames so only bones remain in the tree.
  root.updateMatrixWorld(true);
  const bodyParts: BufferGeometry[] = [];
  const hullParts: BufferGeometry[] = [];
  for (const p of parts) {
    let owner: Object3D | null = p.node.parent;
    while (owner && !(owner instanceof Bone)) owner = owner.parent;
    const boneIndex = owner instanceof Bone ? boneList.indexOf(owner) : 0;
    bodyParts.push(bakePart(p.geo, p.node.matrixWorld, p.color, boneIndex));
    const size = sizeOf(p.geo);
    if (p.hull && Math.min(size.x, size.y, size.z) >= HULL_MIN_SIZE) hullParts.push(bakeHull(p.geo, p.node.matrixWorld, size, boneIndex));
  }
  for (const p of parts) p.node.removeFromParent();
  const bodyGeo = mergeGeometries(bodyParts);
  const hullGeo = mergeGeometries(hullParts);
  for (const b of [...bodyParts, ...hullParts, ...geos]) b.dispose();
  if (!bodyGeo || !hullGeo) throw new Error('buildHumanoid: parts do not merge');

  const material = createRimMaterial('#ffffff', { vertexColors: true, roughness: 0.8 });
  const hullWidth = { value: OUTLINE_DEFAULT_M };
  const hullMat = createHullMaterial(hullWidth);
  const skeleton = new Skeleton(boneList);
  const body = new SkinnedMesh(bodyGeo, material);
  body.name = 'humanoid:body';
  body.castShadow = true;
  body.receiveShadow = false;
  const hull = new SkinnedMesh(hullGeo, hullMat);
  hull.name = 'humanoid:outline';
  hull.castShadow = false;
  hull.receiveShadow = false;
  root.add(body, hull);
  body.bind(skeleton);
  hull.bind(skeleton);
  body.boundingSphere = FIGURE_BOUNDS.clone();
  hull.boundingSphere = FIGURE_BOUNDS.clone();
  const triangles = triCount(bodyGeo) + triCount(hullGeo);

  const bones: Record<BoneId, Object3D> = {
    hips, spine, chest, neck, head, upperArmL, lowerArmL, upperArmR, lowerArmR, thighL, shinL, footL, thighR, shinR, footR,
  };
  const setOutline = (widthM: number, brightness: number): void => {
    const w = Number.isFinite(widthM) ? Math.max(0, widthM) : 0;
    hull.visible = w > 0;
    hullWidth.value = w;
    const b = Number.isFinite(brightness) ? Math.min(1, Math.max(0, brightness)) : 0;
    hullMat.color.copy(OUTLINE_INK).lerp(RIM_UNIFORMS.uRimColor.value, b);
  };
  setOutline(OUTLINE_DEFAULT_M, OUTLINE_DEFAULT_BRIGHTNESS);
  return {
    root,
    bones,
    handL,
    handR,
    mouth,
    materials: [material],
    body,
    hull,
    triangles,
    setOutline,
    dispose() {
      bodyGeo.dispose();
      hullGeo.dispose();
      material.dispose();
      hullMat.dispose();
      skeleton.dispose();
    },
  };
}

/** Apply a degrees XYZ rotation to a bone. */
export function setBoneRotation(bone: Object3D, x: number, y: number, z: number): void {
  const d = Math.PI / 180;
  bone.rotation.set(x * d, y * d, z * d, 'XYZ');
}
