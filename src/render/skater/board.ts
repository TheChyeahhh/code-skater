/**
 * src/render/skater/board.ts (skater track): the board model factory (REQ-SKT-02, REQ-LAB-02):
 * concave extruded deck outline with kicks, trucks (Board Lab colour), wheels (colour + durometer
 * label), top = grip texture, bottom = deck graphic + up to MAX_STICKERS stickers, all procedural
 * CanvasTextures. Brand sticker sheets read BRANDS (stickerSheetLabel). Deck length along local -z (nose).
 *
 * Group origin = the deck TOP centre (the feet stand at y = 0); the deck, trucks and wheels hang
 * below, the wheels touching y = -DECK_STACK_HEIGHT.
 *
 * Draw cost: the deck (3 material groups) plus a dark ink hull around it, both trucks baked into one
 * mesh, kingpins and axles into another, the four wheel bands into one and the eight wheel caps into
 * one. The wheels spin by rotating the cap texture (the bands are plain colour, so a spinning band
 * and a still one look the same), which keeps all four wheels in two draws.
 */

import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D,
  RepeatWrapping, SRGBColorSpace, type Material, type Texture,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNING } from '../../core/tuning';
import type { BoardConfig, TruckColorId, WheelId } from '../../core/types';
import type { BoardModel } from '../types';
import { renderBlueScreen, renderDeckBottom, renderDeckTop, renderPlies, renderWheelCap } from './boardArt';
import { createDeckGeometry, DECK, DECK_STACK_HEIGHT } from './deckGeometry';
import { bakeColoredParts, createHullMaterial } from './rig';

export const TRUCK_COLORS: Readonly<Record<TruckColorId, { color: string; metalness: number; roughness: number; label: string }>> = {
  raw: { color: '#c3c7cf', metalness: 0.9, roughness: 0.38, label: 'Raw' },
  black: { color: '#1c1d22', metalness: 0.5, roughness: 0.45, label: 'Black' },
  gold: { color: '#d9a827', metalness: 1, roughness: 0.3, label: 'Gold' },
  red: { color: '#c8322a', metalness: 0.4, roughness: 0.4, label: 'Red' },
};

export const WHEEL_STYLES: Readonly<Record<WheelId, { color: string; durometer: string; label: string }>> = {
  white99a: { color: '#f2efe6', durometer: '99A', label: 'White 99A' },
  blue101a: { color: '#2f6df6', durometer: '101A', label: 'Blue 101A' },
  green97a: { color: '#3ec46d', durometer: '97A', label: 'Green 97A' },
  orange99a: { color: '#ff8a2a', durometer: '99A', label: 'Orange 99A' },
};

/** Underside self-light (emissive x its own texture): enough to read the graphic in shadow, not enough to glow. */
const BOTTOM_SELF_LIGHT = 0.35;
/** The Kernel Panic blue screen glows well past the bloom threshold. */
const BLUE_SCREEN_SELF_LIGHT = 1.2;
/** Plywood edge self-light: light maple, far under the bloom threshold, enough to lift it off a dark ground. */
const EDGE_SELF_LIGHT_COLOR = '#e6c48e';
/** Raised from 0.12 after the founder playtest 2026-09-23 ("the board is hard to see"): the edge is the deck's outline. */
const EDGE_SELF_LIGHT = 0.22;
/** Wheel bands self-light a little in their own colour, so the four wheels read under the deck's shadow. */
const WHEEL_SELF_LIGHT = 0.18;

/** Local y (below the deck top) of the part that touches a rail: trucks for truck grinds, the deck bottom for slides. */
export const BOARD_CONTACT_Y = {
  truck: -(DECK.thickness + DECK.truckHeight - 0.012),
  deck: -DECK.thickness,
  wheel: -DECK_STACK_HEIGHT,
} as const;

function canvasTexture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface BoardModelExtras extends BoardModel {
  /** Spin the wheels for a rolled distance (metres). */
  roll(distanceM: number): void;
  /** Current wheel spin angle (radians), shown by the cap texture. */
  readonly wheelAngle: number;
  readonly triangles: number;
}

/** Ink outline width around the deck (metres): thin, so the kicks keep their shape. */
const BOARD_OUTLINE_M = 0.006;

/**
 * The deck's hull: the deck positions with `hullOffset` = the normal smoothed over coincident
 * vertices (the top, bottom and edge groups share positions), so the pushed-out shell has no cracks.
 */
function deckHullGeometry(deck: BufferGeometry): BufferGeometry {
  const src = new BufferGeometry();
  src.setAttribute('position', deck.getAttribute('position').clone());
  if (deck.index) src.setIndex(deck.index.clone());
  const welded = mergeVertices(src, 1e-5);
  src.dispose();
  welded.computeVertexNormals();
  const n = welded.getAttribute('normal');
  welded.setAttribute('hullOffset', new BufferAttribute(Float32Array.from(n.array as ArrayLike<number>), 3));
  welded.deleteAttribute('normal');
  return welded;
}

export function createBoardModel(config: BoardConfig): BoardModelExtras {
  const group = new Group();
  group.name = 'board';
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  let triangles = 0;
  const keep = <T extends BufferGeometry>(g: T): T => {
    geos.push(g);
    triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    return g;
  };

  // Deck.
  const deckGeo = keep(createDeckGeometry());
  const deckOutline = { value: BOARD_OUTLINE_M };
  const topMat = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  // The underside carries a little self-light so the Lab graphic reads mid-flip even when the sky is
  // above it; the blue screen glows harder (SPEC §9.1 "flashes").
  const bottomMat = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.05, emissive: new Color('#ffffff'), emissiveIntensity: BOTTOM_SELF_LIGHT });
  const pliesTex = canvasTexture(renderPlies());
  pliesTex.wrapS = RepeatWrapping;
  pliesTex.wrapT = RepeatWrapping;
  // Light maple edge with a little self-light (the rail-rim visibility rule): the deck's outline is the
  // second most readable shape after the skater, on any ground.
  const edgeMat = new MeshStandardMaterial({ map: pliesTex, roughness: 0.7, emissive: new Color(EDGE_SELF_LIGHT_COLOR), emissiveIntensity: EDGE_SELF_LIGHT });
  mats.push(topMat, bottomMat, edgeMat);
  const deck = new Mesh(deckGeo, [topMat, bottomMat, edgeMat]);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Ink outline around the deck (the figures' hull material): back faces pushed out along the
  // smoothed normal, so the deck's silhouette reads against pale concrete and wood alike.
  const deckHullGeo = keep(deckHullGeometry(deckGeo));
  const deckHullMat = createHullMaterial(deckOutline);
  mats.push(deckHullMat);
  const deckHull = new Mesh(deckHullGeo, deckHullMat);
  deckHull.name = 'board:outline';
  deckHull.castShadow = false;
  group.add(deckHull);

  // Trucks: every truck part laid out as a placeholder frame, then baked into two meshes (the
  // coloured truck body, the steel axles and kingpins).
  const truckMat = new MeshStandardMaterial({ color: TRUCK_COLORS.raw.color, metalness: 0.9, roughness: 0.38 });
  const kingpinMat = new MeshStandardMaterial({ color: '#8c8f96', metalness: 0.9, roughness: 0.4 });
  mats.push(truckMat, kingpinMat);
  const axleY = -(DECK.thickness + DECK.truckHeight);
  const layout = new Object3D();
  group.add(layout);
  const bodyParts: { node: Object3D; geo: BufferGeometry; color: string }[] = [];
  const pinParts: { node: Object3D; geo: BufferGeometry; color: string }[] = [];
  const place = (list: typeof bodyParts, geo: BufferGeometry, x: number, y: number, z: number, rot?: { x?: number; z?: number }): void => {
    const n = new Object3D();
    n.position.set(x, y, z);
    if (rot) n.rotation.set(rot.x ?? 0, 0, rot.z ?? 0);
    layout.add(n);
    list.push({ node: n, geo, color: '#ffffff' });
  };
  const baseGeo = new BoxGeometry(0.075, 0.008, 0.062);
  const hangerGeo = new CylinderGeometry(0.014, 0.02, 0.12, 6);
  const neckGeo = new BoxGeometry(0.03, DECK.truckHeight - 0.012, 0.03);
  const axleGeo = new CylinderGeometry(0.005, 0.005, DECK.axleHalf * 2 + 0.018, 8);
  const kingpinGeo = new CylinderGeometry(0.006, 0.006, 0.04, 6);
  const wheelBand = new CylinderGeometry(DECK.wheelRadius, DECK.wheelRadius, DECK.wheelWidth, 14, 1, true);
  const wheelDisc = new CircleGeometry(DECK.wheelRadius, 14);
  const bandParts: typeof bodyParts = [];
  const capParts: typeof bodyParts = [];
  for (const sign of [-1, 1]) {
    const z = sign * DECK.truckZ;
    place(bodyParts, baseGeo, 0, -DECK.thickness - 0.004, z);
    place(bodyParts, neckGeo, 0, axleY + (DECK.truckHeight - 0.012) / 2 + 0.002, z);
    place(bodyParts, hangerGeo, 0, axleY, z, { z: Math.PI / 2 });
    place(pinParts, axleGeo, 0, axleY, z, { z: Math.PI / 2 });
    place(pinParts, kingpinGeo, 0, axleY + 0.02, z - sign * 0.022, { x: sign * 0.35 });
    for (const side of [-1, 1]) {
      const cx = side * DECK.axleHalf;
      place(bandParts, wheelBand, cx, axleY, z, { z: Math.PI / 2 });
      // Two caps per wheel facing out along the axle (a disc faces +z; a quarter turn about y aims it at +x or -x).
      for (const face of [-1, 1]) {
        const n = new Object3D();
        n.position.set(cx + (face * DECK.wheelWidth) / 2, axleY, z);
        n.rotation.set(0, (face * Math.PI) / 2, 0);
        layout.add(n);
        capParts.push({ node: n, geo: wheelDisc, color: '#ffffff' });
      }
    }
  }
  const trucks = new Mesh(keep(bakeColoredParts(group, bodyParts)), truckMat);
  trucks.name = 'board:trucks';
  const pins = new Mesh(keep(bakeColoredParts(group, pinParts)), kingpinMat);
  pins.name = 'board:axles';
  const wheelSide = new MeshStandardMaterial({ color: WHEEL_STYLES.white99a.color, roughness: 0.55, emissive: new Color(WHEEL_STYLES.white99a.color), emissiveIntensity: WHEEL_SELF_LIGHT });
  const wheelCap = new MeshStandardMaterial({ roughness: 0.55 });
  mats.push(wheelSide, wheelCap);
  const bands = new Mesh(keep(bakeColoredParts(group, bandParts)), wheelSide);
  bands.name = 'board:wheels';
  const caps = new Mesh(keep(bakeColoredParts(group, capParts)), wheelCap);
  caps.name = 'board:wheelCaps';
  layout.removeFromParent();
  for (const geo of [baseGeo, hangerGeo, neckGeo, axleGeo, kingpinGeo, wheelBand, wheelDisc]) geo.dispose();
  for (const m of [trucks, pins, bands, caps]) {
    m.castShadow = true;
    group.add(m);
  }
  let wheelAngle = 0;

  let topTex: Texture | null = null;
  let bottomTex: Texture | null = null;
  let capTex: Texture | null = null;
  let blueTex: Texture | null = null;
  let override: 'none' | 'blueScreen' = 'none';
  let current: BoardConfig = config;

  const applyBottom = (): void => {
    if (override === 'blueScreen') {
      if (!blueTex) blueTex = canvasTexture(renderBlueScreen());
      bottomMat.map = blueTex;
      bottomMat.emissiveMap = blueTex;
      bottomMat.emissiveIntensity = BLUE_SCREEN_SELF_LIGHT;
    } else {
      bottomMat.map = bottomTex;
      bottomMat.emissiveMap = bottomTex;
      bottomMat.emissiveIntensity = BOTTOM_SELF_LIGHT;
    }
    bottomMat.needsUpdate = true;
  };

  const setConfig = (next: BoardConfig): void => {
    current = next;
    const max = Math.max(0, Math.floor(TUNING.MAX_STICKERS));
    const trimmed = next.stickers.length > max ? { ...next, stickers: next.stickers.slice(0, max) } : next;
    topTex?.dispose();
    topTex = canvasTexture(renderDeckTop(trimmed.grip));
    topMat.map = topTex;
    topMat.needsUpdate = true;
    bottomTex?.dispose();
    bottomTex = canvasTexture(renderDeckBottom(trimmed));
    applyBottom();
    const truck = TRUCK_COLORS[trimmed.trucks] ?? TRUCK_COLORS.raw;
    truckMat.color.set(truck.color);
    truckMat.metalness = truck.metalness;
    truckMat.roughness = truck.roughness;
    const wheel = WHEEL_STYLES[trimmed.wheels] ?? WHEEL_STYLES.white99a;
    wheelSide.color.set(wheel.color);
    wheelSide.emissive.set(wheel.color);
    capTex?.dispose();
    capTex = canvasTexture(renderWheelCap(wheel.color, wheel.durometer));
    capTex.center.set(0.5, 0.5);
    capTex.rotation = wheelAngle;
    wheelCap.map = capTex;
    wheelCap.needsUpdate = true;
  };
  setConfig(config);

  return {
    group,
    get triangles() {
      return triangles;
    },
    setConfig,
    setDeckOverride(mode) {
      if (mode === override) return;
      override = mode;
      applyBottom();
    },
    roll(distanceM) {
      if (!Number.isFinite(distanceM)) return;
      wheelAngle = (wheelAngle - distanceM / DECK.wheelRadius) % (Math.PI * 2);
      if (capTex) capTex.rotation = wheelAngle;
    },
    get wheelAngle() {
      return wheelAngle;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      topTex?.dispose();
      bottomTex?.dispose();
      capTex?.dispose();
      blueTex?.dispose();
      pliesTex.dispose();
      void current;
    },
  };
}
