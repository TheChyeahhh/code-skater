/**
 * src/render/textures/generators.ts (render track): pixel generators for every tiling material map
 * (REQ-MAT-01..03, REQ-MAT-05). Each returns an RGBA PixelBuffer from (size, seed) with no Canvas2D,
 * so they run in node tests and generate in a few ms at 512 px. Every map tiles.
 *
 * World coverage per tile (metres) is in TILE_M below: materials.ts sets texture.repeat = 1 / TILE_M
 * because level geometry carries uv in world metres.
 */

import { createRng } from '../../core/rng';
import { clamp01, createNoise, mix, smoothstep, warpedFbm, type NoiseField } from '../lib/noise';
import { createPixels, fillPixels, normalMapFromHeight, type PixelBuffer } from '../lib/pixels';

export type ColorMapKind =
  | 'mapleGrain' | 'mapleDark' | 'woodPanel' | 'concrete' | 'asphalt' | 'marbleVeins' | 'granite' | 'brick'
  | 'plazaTile' | 'glassWindows' | 'glassWindowsLit' | 'roofTar' | 'water' | 'scaffold' | 'paintedSteel' | 'crosswalk'
  | 'shedWall' | 'shedWindows' | 'shedCeiling' | 'skylineFacade' | 'skylineFacadeLit';

export type NormalMapKind = 'metalStreaks' | 'brickNormal' | 'concreteNormal' | 'waterNormal';

/** Linear single-channel data maps (roughness in the green channel). */
export type DataMapKind = 'concreteRough';

export type GeneratorKind = ColorMapKind | NormalMapKind | DataMapKind;

/** World size one tile covers, [x, y] metres. */
export const TILE_M: Readonly<Record<GeneratorKind, readonly [number, number]>> = {
  mapleGrain: [2.4, 1.2],
  mapleDark: [2.4, 1.2],
  woodPanel: [1.2, 2.4],
  concrete: [3, 3],
  concreteNormal: [3, 3],
  concreteRough: [3, 3],
  asphalt: [2, 2],
  marbleVeins: [2.5, 2.5],
  granite: [1, 1],
  brick: [1, 1],
  brickNormal: [1, 1],
  plazaTile: [1.2, 1.2],
  glassWindows: [8, 7.2],
  glassWindowsLit: [8, 7.2],
  roofTar: [2, 2],
  water: [4, 4],
  waterNormal: [4, 4],
  scaffold: [0.5, 0.5],
  paintedSteel: [1, 1],
  metalStreaks: [1, 1],
  crosswalk: [1, 1],
  // The Woodshed room (src/render/lib/backdrop.ts): one wall tile spans the full wall height, from
  // SHED.wallBottomY (-3) to SHED.ceilingY (12.3), so the bands land at fixed heights.
  shedWall: [4.8, 15.3],
  shedWindows: [2.4, 2],
  shedCeiling: [4.8, 4.8],
  // Distant Street skyline blocks: 12 bays of 2 m x 4 floors of 3.6 m per tile, big enough to read at
  // 250 m and wide enough that the lit-window scatter does not visibly repeat.
  skylineFacade: [24, 14.4],
  skylineFacadeLit: [24, 14.4],
};

/** World y of the bottom of the shedWall tile (SHED.wallBottomY) and the heights of its bands. */
export const SHED_WALL_BANDS = { bottomY: -3, wainscotTop: 2.4, stripeTop: 2.65, lapY: 7.6, frameY0: 8.45, frameY1: 10.75 } as const;

export const NORMAL_MAP_KINDS: readonly GeneratorKind[] = ['metalStreaks', 'brickNormal', 'concreteNormal', 'waterNormal'];

/** Every kind whose pixels are linear data, not sRGB colour (normal and roughness maps). */
export const LINEAR_MAP_KINDS: readonly GeneratorKind[] = [...NORMAL_MAP_KINDS, 'concreteRough'];

type RGB = readonly [number, number, number];

function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/** Aspect-correct buffer for a kind: TILE_M decides width : height. */
function bufferFor(kind: GeneratorKind, size: number): PixelBuffer {
  const [tx, ty] = TILE_M[kind];
  if (tx === ty) return createPixels(size, size);
  return tx > ty ? createPixels(size, Math.max(4, Math.round((size * ty) / tx))) : createPixels(Math.max(4, Math.round((size * tx) / ty)), size);
}

// ---------------------------------------------------------------------------------------------
// Wood (REQ-MAT-01)
// ---------------------------------------------------------------------------------------------

interface WoodLook {
  readonly light: RGB;
  readonly dark: RGB;
  readonly ringCount: number;
  readonly stretch: number;
  readonly seam: boolean;
  readonly vertical: boolean;
}

/** Layered noise grain with ring stretch: rings run along the long axis, wobbling with fbm. */
function wood(kind: GeneratorKind, size: number, seed: number, look: WoodLook): PixelBuffer {
  const p = bufferFor(kind, size);
  const n = createNoise(seed);
  const w = p.width;
  const h = p.height;
  const period = 8;
  fillPixels(p, (x, y) => {
    const u = (look.vertical ? y / h : x / w) * period; // along the grain
    const v = (look.vertical ? x / w : y / h) * period; // across the grain
    // Slow wobble along the grain, sharp variation across it: the ring stretch.
    const wobble = n.fbm(u * 0.35, v * 1.0, period, 3) * 2.2 + n.fbm(u * 1.4, v * 4, period, 2) * 0.35;
    const rings = v * look.ringCount * 0.08 + wobble * look.stretch;
    const ring = Math.abs(((rings % 1) + 1) % 1 - 0.5) * 2; // 0..1 triangle wave
    const fine = n.fbm(u * 6, v * 30, period, 2);
    let t = smoothstep(0.3, 0.98, ring) * 0.55 + fine * 0.35;
    t = clamp01(t);
    let c = lerpRgb(look.light, look.dark, t);
    // Grain flecks.
    const fleck = n.tile(u * 40, v * 3, period * 40);
    if (fleck > 0.86) c = shade(c, 0.9);
    // Sheet seam: a dark line along the tile edge (2.4 x 1.2 m sheets, REQ-MAT-01).
    if (look.seam) {
      const ex = Math.min(x, w - 1 - x);
      const ey = Math.min(y, h - 1 - y);
      const edge = Math.min(ex, ey);
      if (edge < 1.5) c = shade(c, 0.55);
      else if (edge < 3) c = shade(c, 0.85);
    }
    return c;
  });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Stone and ground (REQ-MAT-03)
// ---------------------------------------------------------------------------------------------

/**
 * Concrete (3 x 3 m tile): a mid-grey slab (the old 168 base read as paper under the sun), Worley
 * pits (24 cells = 12 cm, so they read as pits not a dotted print), expansion joints every 1.5 m,
 * a 2-octave dirt field at 0.5 m plus a directional grime gradient across the tile. The same fields
 * drive concreteHeight (normal map) and concreteRough (roughness map: pits 0.6, dry 0.92).
 */
const CONCRETE_PORE_CELLS = 24;
const CONCRETE_PORE_T = 0.10;
const CONCRETE_JOINTS = 2; // joints per 3 m tile = one every 1.5 m

interface ConcreteSample {
  readonly pit: number; // 0 = flat, 1 = deep in a pore
  readonly joint: boolean;
  readonly dirt: number; // 0..1
  readonly fine: number; // 0..1
  readonly blotch: number; // 0..1
}

function concreteAt(n: NoiseField, x: number, y: number, size: number): ConcreteSample {
  const u = x / size;
  const v = y / size;
  const pores = n.cell(u, v, 1, CONCRETE_PORE_CELLS);
  const pit = 1 - smoothstep(CONCRETE_PORE_T * 0.5, CONCRETE_PORE_T, pores);
  const jointPx = Math.max(2, Math.round(size * 0.006)); // ~3 px at 512
  const fx = ((x % (size / CONCRETE_JOINTS)) + size) % (size / CONCRETE_JOINTS);
  const fy = ((y % (size / CONCRETE_JOINTS)) + size) % (size / CONCRETE_JOINTS);
  const joint = fx < jointPx || fy < jointPx;
  const dirt = n.fbm(u * 6, v * 6, 6, 2); // 0.5 m features
  const fine = n.fbm(u * 48, v * 48, 48, 3);
  const blotch = n.fbm(u * 2, v * 2, 2, 3);
  return { pit, joint, dirt, fine, blotch };
}

function concrete(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const base: RGB = [126, 123, 118];
  fillPixels(p, (x, y) => {
    const s = concreteAt(n, x, y, size);
    let k = 0.86 + (s.blotch - 0.5) * 0.24 + (s.fine - 0.5) * 0.16;
    k *= 1 + (s.dirt - 0.5) * 0.36; // +-18% dirt at 0.5 m
    k *= 1 + Math.sin((y / size) * Math.PI * 2) * 0.05; // a slow grime gradient across the tile (continuous at the seam)
    k *= 1 - s.pit * 0.3;
    if (s.joint) k *= 0.55;
    return shade(base, k);
  });
  return p;
}

function concreteHeight(size: number, seed: number): Float32Array {
  const n = createNoise(seed);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = concreteAt(n, x, y, size);
      h[y * size + x] = 0.5 - s.pit * 1.0 - (s.joint ? 0.5 : 0) + (s.fine - 0.5) * 0.35;
    }
  }
  return h;
}

/** Roughness in the green channel (three reads roughnessMap.g): pits 0.6 (shiny dust), dry slab 0.92. */
function concreteRough(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  fillPixels(p, (x, y) => {
    const s = concreteAt(n, x, y, size);
    let r = 0.92 - s.pit * 0.32 - (s.dirt - 0.5) * 0.12;
    if (s.joint) r = 0.98;
    const v = clamp01(r) * 255;
    return [v, v, v];
  });
  return p;
}

function asphalt(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const rng = createRng(seed ^ 0x5bd1e995);
  const base: RGB = [52, 52, 55];
  fillPixels(p, (x, y) => {
    const u = (x / size) * 4;
    const v = (y / size) * 4;
    const patch = n.fbm(u, v, 4, 3);
    const grain = n.fbm(u * 24, v * 24, 96, 2);
    let k = 0.8 + patch * 0.35 + (grain - 0.5) * 0.5;
    if (grain > 0.72) k += 0.35; // bright aggregate
    return shade(base, k);
  });
  // Scattered light chips.
  for (let i = 0; i < size * 2; i++) {
    const x = rng.int(size);
    const y = rng.int(size);
    const i4 = (y * size + x) * 4;
    const k = 90 + rng.int(60);
    p.data[i4] = k;
    p.data[i4 + 1] = k;
    p.data[i4 + 2] = k + 3;
  }
  return p;
}

/**
 * Distance in pixels from the level set f = t of a tiling float field (|f - t| / |grad f|), so a
 * vein keeps the same pixel width wherever the field is steep or flat. The old |f - t| threshold
 * made fat blotches wherever the field was flat, which read as cracks in ice.
 */
function levelSetDistance(f: Float32Array, size: number, x: number, y: number, t: number): number {
  const at = (px: number, py: number): number => f[((py + size) % size) * size + ((px + size) % size)] as number;
  const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
  const gy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
  const g = Math.max(1e-5, Math.hypot(gx, gy));
  return Math.abs(at(x, y) - t) / g;
}

/** A size x size float field from a sampler over [0, 1) uv. */
function field(size: number, f: (u: number, v: number) => number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = f(x / size, y / size);
  return out;
}

/** Marble vein look (REQ-MAT-03): vein darkening relative to the ground and pixel widths at 512 px. */
export const MARBLE_LOOK = {
  /** Primary vein colour = ground x this (about 30 % darker, a cool grey). */
  veinTint: [0.68, 0.7, 0.72] as const,
  /** Secondary veins reach this share of the primary darkening. */
  secondary: 0.45,
  /** Primary vein full width range in pixels at the 512 px generation size. */
  widthPx: [0.9, 2.5] as const,
  /** Soft halo around a primary vein: its share of the vein darkening and its reach in core widths. */
  halo: 0.3,
  haloWidths: 6,
} as const;

/**
 * Marble (REQ-MAT-03 "veins via domain-warped noise"): a warm white ground with a soft cloud, one
 * primary vein family (a two-scale domain warp so the veins wander, drawn as a thin ridge whose
 * width varies along the vein) and a fainter, thinner secondary family. The veins are about 30 %
 * darker than the ground (SPEC section 10: polished stone, not cracks in ice).
 */
function marble(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const period = 4;
  const light: RGB = [232, 227, 218];
  const warm: RGB = [214, 202, 184];
  const scale = size / 512;
  const f1 = field(size, (u, v) => {
    // A broad warp first, then warpedFbm's own warp: the veins meander at two scales.
    const wu = u * period + (n.fbm(u * 2 + 5.3, v * 2 + 1.7, 2, 2) - 0.5) * 1.6;
    const wv = v * period + (n.fbm(u * 2 + 9.1, v * 2 + 4.2, 2, 2) - 0.5) * 1.6;
    return warpedFbm(n, wu, wv, period, 1.4, 4);
  });
  const f2 = field(size, (u, v) => warpedFbm(n, u * period * 2 + 3.1, v * period * 2 + 7.7, period * 2, 1.1, 3));
  const [w0, w1] = MARBLE_LOOK.widthPx;
  const tint = MARBLE_LOOK.veinTint;
  fillPixels(p, (x, y) => {
    const u = x / size;
    const v = y / size;
    // Widths scale with the generation size but never drop under a pixel (small test sizes).
    const width = Math.max(w0, (w0 + (w1 - w0) * n.tile(u * 6 + 2.2, v * 6 + 8.4, 6)) * scale);
    const d1 = levelSetDistance(f1, size, x, y, 0.5);
    // A crisp core plus a soft halo that fades over a few core widths: a vein in stone, not a pen line.
    const vein1 = Math.max(1 - smoothstep(width * 0.5, width, d1), (1 - smoothstep(width, width * MARBLE_LOOK.haloWidths, d1)) * MARBLE_LOOK.halo);
    const w2 = Math.max(0.6, 0.9 * scale);
    const vein2 = (1 - smoothstep(w2 * 0.4, w2, levelSetDistance(f2, size, x, y, 0.47))) * MARBLE_LOOK.secondary;
    const cloud = n.fbm(u * 2, v * 2, 2, 3);
    const base = lerpRgb(light, warm, clamp01((cloud - 0.35) * 1.4) * 0.8);
    const k = clamp01(vein1 + vein2 * (1 - vein1));
    return [base[0] * mix(1, tint[0], k), base[1] * mix(1, tint[1], k), base[2] * mix(1, tint[2], k)];
  });
  return p;
}

function granite(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const dark: RGB = [70, 68, 74];
  const mid: RGB = [118, 114, 118];
  const pink: RGB = [150, 122, 118];
  fillPixels(p, (x, y) => {
    const a = n.tile((x / size) * 90, (y / size) * 90, 90);
    const b = n.tile((x / size) * 37 + 5, (y / size) * 37 + 9, 37);
    const c = n.fbm((x / size) * 6, (y / size) * 6, 6, 3);
    let col = lerpRgb(dark, mid, a);
    if (b > 0.7) col = lerpRgb(col, pink, (b - 0.7) * 2);
    return shade(col, 0.85 + c * 0.3);
  });
  return p;
}

function brickHeight(size: number, seed: number): Float32Array {
  const n = createNoise(seed + 3);
  const h = new Float32Array(size * size);
  const rows = 12;
  const cols = 4;
  const mortar = 0.06; // fraction of a brick row
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fy = (y / size) * rows;
      const row = Math.floor(fy);
      const ry = fy - row;
      const fx = (x / size) * cols + (row % 2 === 0 ? 0 : 0.5);
      const rx = ((fx % 1) + 1) % 1;
      const inMortar = ry < mortar || ry > 1 - mortar || rx < mortar / 3.2 || rx > 1 - mortar / 3.2;
      const rough = n.fbm((x / size) * 40, (y / size) * 40, 40, 2);
      h[y * size + x] = inMortar ? 0.1 + rough * 0.15 : 0.7 + rough * 0.3;
    }
  }
  return h;
}

function brick(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const rows = 12;
  const cols = 4;
  const mortar = 0.06;
  const mortarC: RGB = [176, 168, 156];
  const bricks: RGB[] = [[158, 74, 58], [172, 88, 66], [140, 66, 54], [166, 96, 74], [150, 80, 62]];
  fillPixels(p, (x, y) => {
    const fy = (y / size) * rows;
    const row = Math.floor(fy);
    const ry = fy - row;
    const fx = (x / size) * cols + (row % 2 === 0 ? 0 : 0.5);
    const col = Math.floor(fx);
    const rx = ((fx % 1) + 1) % 1;
    const inMortar = ry < mortar || ry > 1 - mortar || rx < mortar / 3.2 || rx > 1 - mortar / 3.2;
    const rough = n.fbm((x / size) * 30, (y / size) * 30, 30, 3);
    if (inMortar) return shade(mortarC, 0.85 + rough * 0.3);
    const id = (((row * 7 + col * 13 + seed) % 5) + 5) % 5;
    const c = bricks[id] as RGB;
    return shade(c, 0.8 + rough * 0.4);
  });
  return p;
}

function plazaTile(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const tiles = 2;
  const grout = 0.012;
  const base: RGB = [150, 142, 130];
  const groutC: RGB = [96, 90, 84];
  fillPixels(p, (x, y) => {
    const fx = (x / size) * tiles;
    const fy = (y / size) * tiles;
    const rx = fx % 1;
    const ry = fy % 1;
    if (rx < grout || rx > 1 - grout || ry < grout || ry > 1 - grout) return shade(groutC, 0.9 + n.tile(x / 3, y / 3, 64) * 0.2);
    const tid = Math.floor(fx) + Math.floor(fy) * 2;
    const tint = 0.9 + ((tid * 37 + seed) % 7) * 0.025;
    const mottle = n.fbm((x / size) * 5, (y / size) * 5, 5, 3);
    const speck = n.tile((x / size) * 120, (y / size) * 120, 120);
    let k = tint * (0.86 + mottle * 0.24);
    if (speck > 0.9) k *= 0.85;
    // Worn edge shading toward the grout.
    const edge = Math.min(rx, 1 - rx, ry, 1 - ry);
    k *= 0.85 + smoothstep(0, 0.06, edge) * 0.15;
    return shade(base, k);
  });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Glass towers (REQ-MAT-03): one tile = 8 m wide x 7.2 m tall = 5 bays x 2 floors. Each floor is a
// dark spandrel band under a tall pane; mullions between bays. A second map says which panes are lit.
// ---------------------------------------------------------------------------------------------

const WINDOW_COLS = 5;
const WINDOW_ROWS = 2;
const SPANDREL = 0.26; // fraction of a floor that is the opaque band
const MULLION = 0.02; // thin light-grey caps: black fat mullions read as grout
const BLIND_BANDS = 14;

interface WindowCell {
  readonly col: number;
  readonly row: number;
  readonly rx: number;
  readonly ry: number;
  readonly pane: boolean;
}

function windowCell(x: number, y: number, w: number, h: number): WindowCell {
  const fx = (x / w) * WINDOW_COLS;
  const fy = (y / h) * WINDOW_ROWS;
  const rx = fx % 1;
  const ry = fy % 1;
  const pane = rx > MULLION && rx < 1 - MULLION && ry > SPANDREL && ry < 1 - MULLION;
  return { col: Math.floor(fx), row: Math.floor(fy), rx, ry, pane };
}

/**
 * The albedo of a dielectric curtain wall: dark blue-grey panes (the reflection does the work), a
 * +-8% tint jitter per pane, a faint diagonal streak so the wall is not a uniform grid, dark
 * spandrels and thin light-grey mullions that catch the light.
 */
function glassWindows(size: number, seed: number): PixelBuffer {
  const p = bufferFor('glassWindows', size);
  const n = createNoise(seed);
  const pane: RGB = [20, 32, 44];
  const spandrel: RGB = [30, 32, 38];
  const mullion: RGB = [154, 162, 172];
  fillPixels(p, (x, y) => {
    const c = windowCell(x, y, p.width, p.height);
    if (c.pane) {
      const jitter = 0.92 + n.tile(c.col * 3.3 + seed, c.row * 5.1, 64) * 0.16;
      const diag = n.fbm((x / p.width + y / p.height) * 3, (y / p.height - x / p.width) * 0.5, 6, 2);
      const streak = 1 + (diag - 0.5) * 0.3;
      return shade(pane, jitter * streak);
    }
    if (c.ry <= SPANDREL && c.rx > MULLION && c.rx < 1 - MULLION) return shade(spandrel, 0.9 + n.tile(x / 4, y / 4, 64) * 0.2);
    return shade(mullion, 0.94 + n.tile(x / 2, y / 2, 128) * 0.12);
  });
  return p;
}

function glassWindowsLit(size: number, seed: number, litRatio: number): PixelBuffer {
  const p = bufferFor('glassWindowsLit', size);
  const rng = createRng(seed ^ 0x9e3779b9);
  const lit: boolean[] = [];
  const kinds: RGB[] = [];
  const warm: RGB = [255, 214, 150];
  const cool: RGB = [200, 225, 255];
  for (let i = 0; i < WINDOW_COLS * WINDOW_ROWS; i++) {
    lit.push(rng.next() < litRatio);
    kinds.push(rng.next() < 0.7 ? warm : cool);
  }
  fillPixels(p, (x, y) => {
    const c = windowCell(x, y, p.width, p.height);
    const idx = c.row * WINDOW_COLS + c.col;
    if (!c.pane || !lit[idx]) return [0, 0, 0];
    // Thin venetian blinds in a third of the lit panes, a desk lamp gradient in all of them.
    const band = idx % 3 === 0 && Math.floor(c.ry * BLIND_BANDS * 2) % 2 === 0 ? 0.85 : 1;
    const fall = 0.6 + 0.4 * (1 - Math.abs(c.rx - 0.5) * 1.6);
    return shade(kinds[idx] as RGB, band * fall);
  });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Metal (REQ-MAT-02, REQ-MAT-03)
// ---------------------------------------------------------------------------------------------

/**
 * Anisotropic streak height field: long along v, tight across u (brushed / dragged steel). Pipes map
 * u around the circumference and v along their length, so the streak runs along the bar.
 */
function streakHeight(size: number, seed: number): Float32Array {
  const n = createNoise(seed + 21);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const streak = n.fbm(u * 96, v * 3, 96, 3);
      const scratch = n.tile(u * 400, v * 2 + 0.5, 400);
      const dent = n.fbm(u * 4, v * 4, 4, 2);
      h[y * size + x] = streak * 0.5 + (scratch > 0.8 ? 0.3 : 0) + dent * 0.2;
    }
  }
  return h;
}

function scaffold(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const base: RGB = [150, 152, 150];
  fillPixels(p, (x, y) => {
    const spangle = n.cell(x / size, y / size, 1, 9);
    const dirt = n.fbm((x / size) * 3, (y / size) * 3, 3, 3);
    const k = 0.72 + spangle * 0.35 + (dirt - 0.5) * 0.25;
    return shade(base, k);
  });
  return p;
}

function paintedSteel(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const paint: RGB = [30, 96, 84];
  const chip: RGB = [120, 112, 100];
  fillPixels(p, (x, y) => {
    const wear = n.fbm((x / size) * 5, (y / size) * 5, 5, 4);
    const scratch = n.tile((x / size) * 6, (y / size) * 300, 300);
    let c = shade(paint, 0.85 + wear * 0.3);
    if (wear > 0.74) c = lerpRgb(c, chip, (wear - 0.74) * 6);
    if (scratch > 0.93) c = shade(c, 1.25);
    return c;
  });
  return p;
}

function roofTar(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const base: RGB = [74, 72, 70];
  fillPixels(p, (x, y) => {
    const gravel = n.cell(x / size, y / size, 1, 48);
    const blotch = n.fbm((x / size) * 3, (y / size) * 3, 3, 3);
    let k = 0.7 + blotch * 0.3;
    if (gravel < 0.35) k += (0.35 - gravel) * 1.2;
    return shade(base, k);
  });
  return p;
}

function water(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  const deep: RGB = [22, 74, 92];
  const light: RGB = [90, 170, 190];
  fillPixels(p, (x, y) => {
    const c1 = n.cell(x / size, y / size, 1, 8);
    const c2 = n.cell(x / size + 0.37, y / size + 0.61, 1, 12);
    const caustic = smoothstep(0.55, 1, 1 - Math.min(c1, c2));
    return lerpRgb(deep, light, caustic * 0.9);
  });
  return p;
}

function waterHeight(size: number, seed: number): Float32Array {
  const n = createNoise(seed + 5);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) h[y * size + x] = n.fbm((x / size) * 6, (y / size) * 6, 6, 3);
  }
  return h;
}

function crosswalk(size: number, seed: number): PixelBuffer {
  const p = createPixels(size, size);
  const n = createNoise(seed);
  fillPixels(p, (x, y) => {
    const bars = 5;
    const f = (x / size) * bars;
    const inBar = f % 1 < 0.55;
    const wear = n.fbm((x / size) * 6, (y / size) * 6, 6, 3);
    const a = inBar ? clamp01(0.55 + wear * 0.6) * 255 : 0;
    return [235, 232, 220, a];
  });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Woodshed room (DESIGN G.2): walls, clerestory windows, ceiling deck
// ---------------------------------------------------------------------------------------------

/**
 * One shed wall tile, 4.8 m wide and the full wall height tall. Data row 0 is uv v = 0 (flipY off),
 * the foot of the wall at SHED_WALL_BANDS.bottomY. Bands, bottom to top: plywood wainscot with
 * sheet seams, an orange kick stripe, slate-blue corrugated steel (0.15 m ribs faked in the albedo,
 * a horizontal sheet lap, grime darker toward the floor), a dark frame around the window band.
 */
function shedWall(size: number, seed: number): PixelBuffer {
  const p = bufferFor('shedWall', size);
  const n = createNoise(seed);
  const [tw, th] = TILE_M.shedWall;
  const B = SHED_WALL_BANDS;
  const ply: RGB = [178, 136, 90];
  const plyDark: RGB = [138, 100, 62];
  const stripe: RGB = [226, 118, 36];
  const steel: RGB = [78, 98, 120];
  const frame: RGB = [46, 50, 56];
  fillPixels(p, (x, y) => {
    const um = ((x + 0.5) / p.width) * tw; // metres along the tile
    const wy = B.bottomY + ((y + 0.5) / p.height) * th; // world height
    const gu = um / tw;
    if (wy < B.wainscotTop) {
      const grain = n.fbm(gu * 3, (wy / th) * 60, 3, 3);
      let c = lerpRgb(ply, plyDark, clamp01(grain * 1.2 - 0.3));
      const seamU = Math.min(um % 1.2, 1.2 - (um % 1.2));
      if (seamU < 0.012 || Math.abs(wy - 1.2) < 0.01) c = shade(c, 0.55);
      if (wy > B.wainscotTop - 0.06) c = shade(c, 0.7); // cap rail
      return c;
    }
    if (wy < B.stripeTop) return shade(stripe, 0.92 + 0.12 * n.fbm(gu * 8, wy, 8, 2));
    if (wy > B.frameY0 && wy < B.frameY1) return shade(frame, 0.9 + 0.2 * n.fbm(gu * 4, wy * 0.5, 4, 2));
    const rib = 0.5 + 0.5 * Math.cos((um / 0.15) * Math.PI * 2);
    const grime = n.fbm(gu * 12, (wy / th) * 2, 12, 3);
    const floorDirt = smoothstep(4.5, B.stripeTop, wy) * 0.25;
    let k = 0.78 + rib * 0.3 + (grime - 0.5) * 0.22 - floorDirt;
    if (Math.abs(wy - B.lapY) < 0.03) k *= 0.62;
    if (um < 0.03 || um > tw - 0.03) k *= 0.7; // vertical sheet lap every 4.8 m
    return shade(steel, k);
  });
  return p;
}

/** Clerestory glass: a 4 x 2 pane grid per 2.4 x 2 m tile with dark mullions (map and emissive map). */
function shedWindows(size: number, seed: number): PixelBuffer {
  const p = bufferFor('shedWindows', size);
  const n = createNoise(seed);
  const [tw, th] = TILE_M.shedWindows;
  const sky: RGB = [206, 222, 242];
  const haze: RGB = [236, 238, 240];
  fillPixels(p, (x, y) => {
    const um = ((x + 0.5) / p.width) * tw;
    const vm = ((y + 0.5) / p.height) * th;
    const cu = um % 0.6;
    const cv = vm % 1.0;
    if (Math.min(cu, 0.6 - cu) < 0.035 || Math.min(cv, 1 - cv) < 0.045) return [34, 38, 44];
    const pane = n.tile(Math.floor(um / 0.6) + 0.5, Math.floor(vm) + 0.5, 64);
    const c = lerpRgb(sky, haze, clamp01(vm / th) * 0.6);
    return shade(c, 0.78 + pane * 0.28);
  });
  return p;
}

/** Ceiling deck: dark corrugated steel, ribs every 0.3 m, a purlin shadow every 2.4 m. */
function shedCeiling(size: number, seed: number): PixelBuffer {
  const p = bufferFor('shedCeiling', size);
  const n = createNoise(seed);
  const [tw, th] = TILE_M.shedCeiling;
  const deck: RGB = [64, 60, 56];
  fillPixels(p, (x, y) => {
    const um = ((x + 0.5) / p.width) * tw;
    const vm = ((y + 0.5) / p.height) * th;
    const rib = 0.5 + 0.5 * Math.cos((um / 0.3) * Math.PI * 2);
    let k = 0.8 + rib * 0.3 + (n.fbm((um / tw) * 3, (vm / th) * 3, 3, 3) - 0.5) * 0.3;
    if (Math.min(vm % 2.4, 2.4 - (vm % 2.4)) < 0.05) k *= 0.6;
    return shade(deck, k);
  });
  return p;
}

/**
 * Distant facade (the Street skyline, src/render/lib/backdrop.ts): per 3.6 m floor a dark strip of
 * glazing (60 %) over a light spandrel, mullions every 1.5 m, some panes catching the sky. Only
 * large features, because at 110 to 240 m the mip chain averages away anything finer.
 */
/** Street skyline facade grid: 12 bays of 2 m x 4 floors per tile (TILE_M.skylineFacade), punched windows. */
const SKY_BAYS = 12;
const SKY_FLOORS = 4;
const SKY_SPANDREL = 0.34; // fraction of a floor under the window (the light floor band)
const SKY_PIER = 0.16; // fraction of a bay each side of the window (the light column between windows)
const SKY_SKY_PANES = 0.3; // panes that catch the sky and read lighter
const SKY_WARM_SHARE = 0.75; // lit panes that are warm (the rest are cool office light)

interface SkyCell {
  readonly idx: number;
  readonly rx: number;
  readonly ry: number;
  readonly pane: boolean;
}

function skyCell(x: number, y: number, w: number, h: number): SkyCell {
  const fx = ((x + 0.5) / w) * SKY_BAYS;
  const fy = ((y + 0.5) / h) * SKY_FLOORS;
  const rx = fx % 1;
  const ry = fy % 1;
  const pane = rx > SKY_PIER && rx < 1 - SKY_PIER && ry > SKY_SPANDREL && ry < 0.94;
  return { idx: Math.floor(fy) * SKY_BAYS + Math.floor(fx), rx, ry, pane };
}

/**
 * Distant Street blocks (polish round 2: they read as flat grey boxes): a strong punched-window
 * grid on every face, light floor bands and piers against dark glass, a third of the panes lighter
 * where they catch the sky, and a soft grime fade under each sill. Near white on the stone parts,
 * so the per-block vertex colour (sandstone, teal glass, brick, slate) decides the building's hue.
 */
function skylineFacade(size: number, seed: number): PixelBuffer {
  const p = bufferFor('skylineFacade', size);
  const n = createNoise(seed);
  const rng = createRng(seed ^ 0x2c1b3c6d);
  const skyPane: boolean[] = [];
  for (let i = 0; i < SKY_BAYS * SKY_FLOORS; i++) skyPane.push(rng.next() < SKY_SKY_PANES);
  const stone: RGB = [226, 222, 214];
  const glass: RGB = [38, 50, 66];
  const sky: RGB = [120, 146, 178];
  fillPixels(p, (x, y) => {
    const c = skyCell(x, y, p.width, p.height);
    const grain = 0.94 + 0.12 * n.fbm((x / p.width) * 8, (y / p.height) * 8, 8, 2);
    if (c.pane) {
      const base = skyPane[c.idx] ? sky : glass;
      // Reflections get brighter toward the top of each pane (the sky above), a little per-pane jitter.
      return shade(base, (0.85 + 0.3 * ((c.ry - SKY_SPANDREL) / (0.94 - SKY_SPANDREL))) * grain);
    }
    // Stone: a grime shadow just under each window sill.
    const underSill = c.ry < SKY_SPANDREL && c.ry > SKY_SPANDREL - 0.1 && c.rx > SKY_PIER && c.rx < 1 - SKY_PIER ? 0.82 : 1;
    return shade(stone, grain * underSill);
  });
  return p;
}

/** Which skyline panes are lit (emissive map, black elsewhere): warm and a few cool, a scatter of litRatio. */
function skylineFacadeLit(size: number, seed: number, litRatio: number): PixelBuffer {
  const p = bufferFor('skylineFacadeLit', size);
  const rng = createRng(seed ^ 0x7f4a7c15);
  const kinds: (RGB | null)[] = [];
  for (let i = 0; i < SKY_BAYS * SKY_FLOORS; i++) {
    const lit = rng.next() < litRatio;
    const warm = rng.next() < SKY_WARM_SHARE;
    kinds.push(lit ? (warm ? [255, 196, 120] : [214, 228, 255]) : null);
  }
  fillPixels(p, (x, y) => {
    const c = skyCell(x, y, p.width, p.height);
    const k = kinds[c.idx];
    return c.pane && k ? k : [0, 0, 0];
  });
  return p;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export interface GeneratorParams {
  /** Fraction of tower windows that are lit (glassWindowsLit only). */
  readonly litRatio?: number;
  /** Fraction of skyline windows that are lit (skylineFacadeLit only). */
  readonly skylineLitRatio?: number;
}

export function generate(kind: GeneratorKind, size: number, seed: number, params: GeneratorParams = {}): PixelBuffer {
  switch (kind) {
    case 'mapleGrain':
      return wood(kind, size, seed, { light: [216, 176, 118], dark: [170, 124, 78], ringCount: 18, stretch: 0.9, seam: true, vertical: false });
    case 'mapleDark':
      return wood(kind, size, seed + 1, { light: [132, 96, 60], dark: [78, 52, 30], ringCount: 20, stretch: 0.8, seam: true, vertical: false });
    case 'woodPanel':
      return wood(kind, size, seed + 2, { light: [190, 152, 106], dark: [140, 102, 64], ringCount: 26, stretch: 1.1, seam: true, vertical: true });
    case 'concrete':
      return concrete(size, seed);
    case 'concreteNormal':
      return normalMapFromHeight(concreteHeight(size, seed), size, size, 1.6);
    case 'concreteRough':
      return concreteRough(size, seed);
    case 'asphalt':
      return asphalt(size, seed);
    case 'marbleVeins':
      return marble(size, seed);
    case 'granite':
      return granite(size, seed);
    case 'brick':
      return brick(size, seed);
    case 'brickNormal':
      return normalMapFromHeight(brickHeight(size, seed), size, size, 3);
    case 'plazaTile':
      return plazaTile(size, seed);
    case 'glassWindows':
      return glassWindows(size, seed);
    case 'glassWindowsLit':
      return glassWindowsLit(size, seed, params.litRatio ?? 0.5);
    case 'roofTar':
      return roofTar(size, seed);
    case 'water':
      return water(size, seed);
    case 'waterNormal':
      return normalMapFromHeight(waterHeight(size, seed), size, size, 1.5);
    case 'scaffold':
      return scaffold(size, seed);
    case 'paintedSteel':
      return paintedSteel(size, seed);
    case 'metalStreaks':
      return normalMapFromHeight(streakHeight(size, seed), size, size, 2.2);
    case 'crosswalk':
      return crosswalk(size, seed);
    case 'shedWall':
      return shedWall(size, seed);
    case 'shedWindows':
      return shedWindows(size, seed);
    case 'shedCeiling':
      return shedCeiling(size, seed);
    case 'skylineFacade':
      return skylineFacade(size, seed);
    case 'skylineFacadeLit':
      return skylineFacadeLit(size, seed, params.skylineLitRatio ?? 0.15);
  }
}

export type { NoiseField };
