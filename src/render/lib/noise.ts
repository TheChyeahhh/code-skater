/**
 * src/render/lib/noise.ts (render track): seeded value noise, fbm and domain warping for the
 * procedural textures (REQ-MAT-01..03, REQ-MAT-05). Pure functions over a permutation table built
 * from the seed, so a texture is identical on every load. Tileable variants wrap at `period`.
 */

import { createRng } from '../../core/rng';

export interface NoiseField {
  /** Value noise in [0, 1] that tiles every `period` units on both axes. */
  tile(x: number, y: number, period: number): number;
  /** Fractal sum of `octaves` tiling layers, in [0, 1]. */
  fbm(x: number, y: number, period: number, octaves: number, gain?: number): number;
  /** Cell / Worley distance in [0, 1] over a jittered grid of `cells` per period (tiles). */
  cell(x: number, y: number, period: number, cells: number): number;
}

const TABLE = 256;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createNoise(seed: number): NoiseField {
  const rng = createRng(seed);
  const perm = new Uint8Array(TABLE * 2);
  const values = new Float32Array(TABLE);
  const ids = new Uint8Array(TABLE);
  for (let i = 0; i < TABLE; i++) {
    ids[i] = i;
    values[i] = rng.next();
  }
  for (let i = TABLE - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = ids[i] as number;
    ids[i] = ids[j] as number;
    ids[j] = t;
  }
  for (let i = 0; i < TABLE * 2; i++) perm[i] = ids[i & (TABLE - 1)] as number;

  const lattice = (ix: number, iy: number, period: number): number => {
    const px = ((ix % period) + period) % period;
    const py = ((iy % period) + period) % period;
    return values[perm[(perm[px & 255] as number) + (py & 255)] as number] as number;
  };

  const tile = (x: number, y: number, period: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);
    const a = lattice(ix, iy, period);
    const b = lattice(ix + 1, iy, period);
    const c = lattice(ix, iy + 1, period);
    const d = lattice(ix + 1, iy + 1, period);
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return top + (bottom - top) * v;
  };

  const fbm = (x: number, y: number, period: number, octaves: number, gain = 0.5): number => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let p = period;
    let px = x;
    let py = y;
    for (let o = 0; o < octaves; o++) {
      sum += tile(px, py, p) * amp;
      norm += amp;
      amp *= gain;
      px *= 2;
      py *= 2;
      p *= 2;
    }
    return sum / norm;
  };

  const cellPoint = (cx: number, cy: number, cells: number, out: Float32Array): void => {
    const px = ((cx % cells) + cells) % cells;
    const py = ((cy % cells) + cells) % cells;
    const h = perm[(perm[px & 255] as number) + (py & 255)] as number;
    out[0] = cx + (values[h] as number);
    out[1] = cy + (values[(h * 7 + 13) & 255] as number);
  };

  const tmp = new Float32Array(2);
  const cell = (x: number, y: number, period: number, cells: number): number => {
    const sx = (x / period) * cells;
    const sy = (y / period) * cells;
    const cx = Math.floor(sx);
    const cy = Math.floor(sy);
    let best = 4;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        cellPoint(cx + dx, cy + dy, cells, tmp);
        const ex = (tmp[0] as number) - sx;
        const ey = (tmp[1] as number) - sy;
        const d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  };

  return { tile, fbm, cell };
}

/** Domain-warped fbm: sample fbm at a position pushed by two other fbm fields (marble veins). */
export function warpedFbm(n: NoiseField, x: number, y: number, period: number, strength: number, octaves: number): number {
  const qx = n.fbm(x + 5.2, y + 1.3, period, octaves);
  const qy = n.fbm(x + 1.7, y + 9.2, period, octaves);
  return n.fbm(x + strength * qx, y + strength * qy, period, octaves);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
