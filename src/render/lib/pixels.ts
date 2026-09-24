/**
 * src/render/lib/pixels.ts (render track): RGBA pixel buffers -> three DataTextures, plus a height
 * -> tangent-space normal map bake. Pure typed-array work, so it runs in node tests as well as the
 * browser (REQ-TST-01) and never needs a Canvas2D context (REQ-MAT-05).
 */

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';

/** Anisotropic filtering request; three clamps it to the device maximum. */
export const TEXTURE_ANISOTROPY = 8;

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, top row first. */
  readonly data: Uint8Array;
}

export function createPixels(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function putPixel(p: PixelBuffer, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const i = (y * p.width + x) * 4;
  p.data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
  p.data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
  p.data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  p.data[i + 3] = a < 0 ? 0 : a > 255 ? 255 : a;
}

/** Fill every pixel from a callback returning [r, g, b] in 0..255 (alpha 255) or [r, g, b, a]. */
export function fillPixels(p: PixelBuffer, f: (x: number, y: number) => readonly [number, number, number] | readonly [number, number, number, number]): void {
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const c = f(x, y);
      putPixel(p, x, y, c[0], c[1], c[2], c[3] ?? 255);
    }
  }
}

export interface TextureOptions {
  /** Colour data (sRGB) or linear data such as a normal or roughness map. */
  readonly srgb: boolean;
  readonly repeat: boolean;
}

/** Wrap a pixel buffer as a mipmapped, anisotropic DataTexture. */
export function toTexture(p: PixelBuffer, opts: TextureOptions): DataTexture {
  const tex = new DataTexture(p.data, p.width, p.height, RGBAFormat, UnsignedByteType);
  tex.colorSpace = opts.srgb ? SRGBColorSpace : NoColorSpace;
  tex.wrapS = opts.repeat ? RepeatWrapping : tex.wrapS;
  tex.wrapT = opts.repeat ? RepeatWrapping : tex.wrapT;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = TEXTURE_ANISOTROPY;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tangent-space normal map from a height field in [0, 1] (row-major, width x height, tiling).
 * strength = how many texture-widths one unit of height spans (bigger = steeper normals).
 */
export function normalMapFromHeight(height: Float32Array, width: number, h: number, strength: number): PixelBuffer {
  const out = createPixels(width, h);
  const at = (x: number, y: number): number => height[(((y % h) + h) % h) * width + (((x % width) + width) % width)] as number;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normal = normalize(-dx, -dy, 1); three's normal maps are +y up in texture space, so flip dy.
      const nx = -dx;
      const ny = dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      putPixel(out, x, y, ((nx / len) * 0.5 + 0.5) * 255, ((ny / len) * 0.5 + 0.5) * 255, ((nz / len) * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** True when a Canvas2D context can be created (browser); false in node tests. */
export function canvasAvailable(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}
