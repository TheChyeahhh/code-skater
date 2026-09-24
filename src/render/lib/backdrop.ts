/**
 * src/render/lib/backdrop.ts (render track): the geometry that closes each park's view, render only
 * (never in the collider, never in the sim). Pure three geometry, so render.test builds it in node.
 *
 * - Woodshed (DESIGN G.2 "walls at the boundary (h 12), ceiling trusses at y 12"): the builder's
 *   boundary walls are invisible colliders, so the room itself is drawn here: four inward walls from
 *   below the bowl floors up to a ceiling deck just above the trusses, a band of high clerestory
 *   windows (the story behind the key light), and a grid of hanging high-bay lamps under the trusses.
 * - Street: a ground apron outside the 120 m park and a ring of seeded skyline blocks 110 to 240 m
 *   beyond it, so the world ends in a city in haze instead of a white void. Each block has a hue of
 *   its own, a dark roof, and the taller ones a setback tier; many a small rooftop plant box.
 *
 * UVs are world metres (u along the wall or ground, v up the wall), like the level geometry, so the
 * registry's texture repeat (1 / TILE_M) applies unchanged.
 */

import { BoxGeometry, BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/rng';

/** Woodshed room numbers (geometry only; the looks live in the registry and TUNING). */
export const SHED = {
  /** Bottom of the walls, below the deepest bowl floor (-2.4 m). */
  wallBottomY: -3,
  /** Ceiling deck height above the trusses (they span y 11.6 to 12.0). */
  ceilingY: 12.3,
  /** Clerestory window band. */
  windowY0: 8.6,
  windowY1: 10.6,
  /** Windows sit this far inside the wall plane so they never z-fight it. */
  windowInset: 0.04,
  /** High-bay lamps: under each truss line, every lampStepX metres. */
  lampY: 11.35,
  lampSize: [1.4, 0.14, 0.5] as const,
  lampStepX: 18,
  trussStepZ: 12,
} as const;

/** Street skyline numbers. */
export const SKYLINE = {
  /** Distance band beyond the park boundary where blocks stand. */
  nearM: 110,
  farM: 240,
  /** Blocks per side of the park. */
  perSide: 14,
  minH: 22,
  maxH: 105,
  /** Ground apron reach beyond the boundary and its height (just under the park floor at y 0). */
  apronM: 700,
  apronY: -0.06,
  seed: 1207,
} as const;

/**
 * Graphics overhaul 2026-09-23: the first ~110 m past the boundary was an empty apron that read as a
 * brown desert. A grid of low-rise city blocks with streets between them now fills that band, rows
 * of `cellM` cells (block + street) from `startM` out, lower than the skyline so it stays visible.
 */
export const NEAR_CITY = {
  startM: 16,
  rows: 3,
  cellM: 30,
  streetM: 10,
  minH: 9,
  maxH: 34,
} as const;

/**
 * Linear multipliers on the skyline material colour, one per block: sandstone, teal glass, brick
 * red, slate blue, pale concrete, dark glass (polish round 2: the old three tints all read as grey).
 */
export const SKYLINE_TINTS: readonly (readonly [number, number, number])[] = [
  [1.02, 0.8, 0.56],
  [0.5, 0.78, 0.8],
  [0.86, 0.46, 0.36],
  [0.66, 0.76, 0.94],
  [0.92, 0.9, 0.86],
  [0.42, 0.5, 0.62],
];

/** Skyline massing: taller blocks get a setback tier, some a rooftop plant box; roofs are darker. */
export const SKYLINE_MASSING = {
  /** Blocks at least this tall get a setback tier on top. */
  setbackMinH: 50,
  /** Tier footprint as a fraction of the block's, and its height as a fraction of the block's. */
  setbackFootprint: [0.55, 0.8] as const,
  setbackHeight: [0.15, 0.35] as const,
  /** Chance of a small plant box on the roof, its footprint fraction and height (m). */
  plantChance: 0.55,
  plantFootprint: [0.2, 0.35] as const,
  plantHeightM: [3, 7] as const,
  /** Vertex shade of roof tops (dark tar and gravel), and of the plant boxes. */
  roofShade: 0.45,
  plantShade: 0.6,
} as const;

/** Fixed facade uv for roof tops: a point inside the stone floor band of skylineFacade, so roofs are plain. */
const ROOF_UV = [0.5, 0.4] as const;

type Rng = ReturnType<typeof createRng>;

/** One skyline box: world-metre facade uv on the walls, plain roof, tint x shade with a darker foot. */
function skylineBox(cx: number, cz: number, sx: number, sz: number, y0: number, h: number, tint: readonly [number, number, number], shade: number, footH: number): BufferGeometry {
  const b = new BoxGeometry(sx, h, sz);
  b.translate(cx, y0 + h / 2, cz);
  const pos = b.getAttribute('position');
  const nrm = b.getAttribute('normal');
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const ny = nrm.getY(k);
    const foot = Math.min(1, (pos.getY(k) - SKYLINE.apronY) / footH); // 0 at the street, 1 high up
    const v = ny > 0.5 ? shade * SKYLINE_MASSING.roofShade : shade * (0.8 + 0.2 * foot);
    col[k * 3] = tint[0] * v;
    col[k * 3 + 1] = tint[1] * v;
    col[k * 3 + 2] = tint[2] * v;
    if (Math.abs(ny) > 0.5) {
      uv[k * 2] = ROOF_UV[0];
      uv[k * 2 + 1] = ROOF_UV[1];
    } else {
      // World-metre planar uv per face, so the facade map keeps its floor height on every block.
      uv[k * 2] = Math.abs(nrm.getX(k)) > 0.5 ? pos.getZ(k) : pos.getX(k);
      uv[k * 2 + 1] = pos.getY(k);
    }
  }
  b.setAttribute('color', new BufferAttribute(col, 3));
  b.setAttribute('uv', new BufferAttribute(uv, 2));
  return b;
}

/** A skyline block with its massing: the base box, an optional setback tier and an optional plant box. */
function skylineBlock(rng: Rng, cx: number, cz: number, sx: number, sz: number, h: number): BufferGeometry[] {
  const M = SKYLINE_MASSING;
  const tint = SKYLINE_TINTS[rng.int(SKYLINE_TINTS.length)] ?? SKYLINE_TINTS[0];
  const shade = rng.range(0.8, 1.1);
  const out: BufferGeometry[] = [];
  let topY = SKYLINE.apronY;
  let topSx = sx;
  let topSz = sz;
  if (h >= M.setbackMinH) {
    const tierH = h * rng.range(M.setbackHeight[0], M.setbackHeight[1]);
    const baseH = h - tierH;
    out.push(skylineBox(cx, cz, sx, sz, topY, baseH, tint, shade, h));
    topY += baseH;
    const f = rng.range(M.setbackFootprint[0], M.setbackFootprint[1]);
    topSx = sx * f;
    topSz = sz * f;
    out.push(skylineBox(cx, cz, topSx, topSz, topY, tierH, tint, shade, h));
    topY += tierH;
  } else {
    out.push(skylineBox(cx, cz, sx, sz, topY, h, tint, shade, h));
    topY += h;
  }
  if (rng.next() < M.plantChance) {
    const f = rng.range(M.plantFootprint[0], M.plantFootprint[1]);
    const ph = rng.range(M.plantHeightM[0], M.plantHeightM[1]);
    out.push(skylineBox(cx, cz, topSx * f, topSz * f, topY, ph, tint, shade * M.plantShade, h));
  }
  return out;
}

/** One inward-facing quad with world-metre uv (u along the edge from a to b, v = y - v0). */
function wallQuad(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, v0: number): BufferGeometry {
  const g = new BufferGeometry();
  const len = Math.hypot(bx - ax, bz - az);
  g.setAttribute('position', new Float32BufferAttribute([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], 3));
  g.setAttribute('normal', new Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, y0 - v0, len, y0 - v0, len, y1 - v0, 0, y1 - v0], 2));
  // Triangle (0, 1, 2) faces (b - a) x up = (-(bz - az), 0, bx - ax); flip the winding when that
  // points away from the wanted normal, so the front face always looks into the room.
  const fx = -(bz - az);
  const fz = bx - ax;
  g.setIndex(fx * nx + fz * nz > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}

/** The four inward walls of an X x Z room between y0 and y1 (v measured from v0). */
function roomWalls(X: number, Z: number, y0: number, y1: number, inset: number, v0: number): BufferGeometry {
  const parts = [
    wallQuad(0, inset, X, inset, y0, y1, 0, 1, v0), // north wall, faces south (+z)
    wallQuad(X, Z - inset, 0, Z - inset, y0, y1, 0, -1, v0), // south wall, faces north
    wallQuad(inset, Z, inset, 0, y0, y1, 1, 0, v0), // west wall, faces east
    wallQuad(X - inset, 0, X - inset, Z, y0, y1, -1, 0, v0), // east wall, faces west
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('render/backdrop: wall merge failed');
  return merged;
}

export interface ShedShellGeometry {
  /** Walls from wallBottomY to ceilingY, uv v = metres above wallBottomY. */
  readonly walls: BufferGeometry;
  /** The clerestory band, just inside the walls, uv v = metres above windowY0. */
  readonly windows: BufferGeometry;
  /** The ceiling deck, facing down. */
  readonly ceiling: BufferGeometry;
  /** Every hanging lamp, merged. */
  readonly lamps: BufferGeometry;
}

/** The Woodshed room for a park of size X x Z (metres). */
export function shedShell(X: number, Z: number): ShedShellGeometry {
  const walls = roomWalls(X, Z, SHED.wallBottomY, SHED.ceilingY, 0, SHED.wallBottomY);
  const windows = roomWalls(X, Z, SHED.windowY0, SHED.windowY1, SHED.windowInset, SHED.windowY0);

  const ceiling = new BufferGeometry();
  const y = SHED.ceilingY;
  ceiling.setAttribute('position', new Float32BufferAttribute([0, y, 0, X, y, 0, X, y, Z, 0, y, Z], 3));
  ceiling.setAttribute('normal', new Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0], 3));
  ceiling.setAttribute('uv', new Float32BufferAttribute([0, 0, X, 0, X, Z, 0, Z], 2));
  ceiling.setIndex([0, 1, 2, 0, 2, 3]); // seen from below: counter-clockwise from -y

  const lampParts: BufferGeometry[] = [];
  const [lx, ly, lz] = SHED.lampSize;
  for (let z = SHED.trussStepZ; z < Z - 1; z += SHED.trussStepZ) {
    for (let x = SHED.lampStepX / 2; x < X; x += SHED.lampStepX) {
      const b = new BoxGeometry(lx, ly, lz);
      b.translate(x, SHED.lampY, z);
      lampParts.push(b);
    }
  }
  const lamps = mergeGeometries(lampParts, false);
  for (const p of lampParts) p.dispose();
  if (!lamps) throw new Error('render/backdrop: lamp merge failed');
  return { walls, windows, ceiling, lamps };
}

export interface SkylineGeometry {
  /** Every block merged (with its setback tier and plant box), a per-vertex "color" (tint and shade per block, darker at the foot and on the roof) and world-metre uv. */
  readonly blocks: BufferGeometry;
  /** Ground apron outside the park rectangle (four quads, uv in metres). */
  readonly apron: BufferGeometry;
  readonly blockCount: number;
}

/** Seeded skyline blocks around an X x Z park, plus the apron they stand on. */
export function streetSkyline(X: number, Z: number): SkylineGeometry {
  const rng = createRng(SKYLINE.seed);
  const parts: BufferGeometry[] = [];
  let blockCount = 0;
  const sides: readonly (readonly [number, number, number, number])[] = [
    // [edge start x, edge start z, outward nx, outward nz] per side; the edge runs perpendicular to n.
    [0, 0, 0, -1],
    [0, Z, 0, 1],
    [0, 0, -1, 0],
    [X, 0, 1, 0],
  ];
  for (const [, , nx, nz] of sides) {
    const along = nx === 0 ? X : Z;
    // Blocks run past the corners (by nearM) so the ring has no gaps at the diagonals, but not so
    // far that a corner block leaves the 500 m camera far plane seen from the opposite corner.
    const span = along + 2 * SKYLINE.nearM;
    for (let i = 0; i < SKYLINE.perSide; i++) {
      const t = (i + rng.range(0.1, 0.9)) / SKYLINE.perSide;
      const s = -SKYLINE.nearM + t * span;
      const d = rng.range(SKYLINE.nearM, SKYLINE.farM);
      const w = rng.range(18, 46);
      const depth = rng.range(18, 40);
      // Taller blocks further out, so near blocks never wall off the far ones.
      const hT = (d - SKYLINE.nearM) / (SKYLINE.farM - SKYLINE.nearM);
      const h = SKYLINE.minH + (SKYLINE.maxH - SKYLINE.minH) * Math.min(1, rng.next() * 0.7 + hT * 0.5);
      const cx = nx === 0 ? s : nx > 0 ? X + d : -d;
      const cz = nz === 0 ? s : nz > 0 ? Z + d : -d;
      parts.push(...skylineBlock(rng, cx, cz, nx === 0 ? w : depth, nx === 0 ? depth : w, h));
      blockCount += 1;
    }
  }
  // The near city: rows of blocks on a street grid around all four sides (corners filled too).
  const N = NEAR_CITY;
  const reach = N.startM + N.rows * N.cellM;
  const blockM = N.cellM - N.streetM;
  for (let gx = -reach; gx < X + reach; gx += N.cellM) {
    for (let gz = -reach; gz < Z + reach; gz += N.cellM) {
      const x0 = gx, z0 = gz, x1 = gx + blockM, z1 = gz + blockM;
      // Only cells wholly outside the park plus the start margin.
      const outside = x1 < -N.startM || x0 > X + N.startM || z1 < -N.startM || z0 > Z + N.startM;
      if (!outside) continue;
      const w = blockM * rng.range(0.7, 1);
      const d = blockM * rng.range(0.7, 1);
      const h = rng.range(N.minH, N.maxH);
      parts.push(...skylineBlock(rng, (x0 + x1) / 2, (z0 + z1) / 2, w, d, h));
      blockCount += 1;
    }
  }

  const blocks = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!blocks) throw new Error('render/backdrop: skyline merge failed');

  // Apron: four quads that tile the plane outside [0, X] x [0, Z] out to apronM.
  const R = SKYLINE.apronM;
  const y = SKYLINE.apronY;
  const rects: readonly (readonly [number, number, number, number])[] = [
    [-R, -R, X + R, 0], // north strip, full width
    [-R, Z, X + R, Z + R], // south strip
    [-R, 0, 0, Z], // west
    [X, 0, X + R, Z], // east
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const [x0, z0, x1, z1] of rects) {
    const b = pos.length / 3;
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uv.push(x0, z0, x1, z0, x1, z1, x0, z1);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // counter-clockwise seen from +y
  }
  const apron = new BufferGeometry();
  apron.setAttribute('position', new Float32BufferAttribute(pos, 3));
  apron.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  apron.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  apron.setIndex(idx);
  return { blocks, apron, blockCount };
}
