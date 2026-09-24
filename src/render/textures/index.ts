/**
 * src/render/textures/index.ts (render track): procedural textures (DataTexture from pixel
 * generators, CanvasTexture for text), zero downloaded assets (REQ-MAT-05). Wordmarks read BRANDS
 * in original typography, never logo art (REQ-BRD-03, REQ-MAT-04). Seeded, so a texture looks the
 * same every load. A cache keyed by (kind, size, seed) means every material shares one GPU texture.
 * The skater track draws its own deck / grip / sticker art inside src/render/skater/.
 *
 * In node (tests) there is no Canvas2D: text textures fall back to a 1 x 1 DataTexture so the
 * material registry still constructs (REQ-TST-01); the pixel generators need no canvas at all.
 */

import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Texture } from 'three';
import { BRANDS, type BrandKey } from '../../data/brands';
import type { DecalDef } from '../../levels/types';
import { TUNING } from '../../core/tuning';
import { canvasAvailable, TEXTURE_ANISOTROPY, toTexture } from '../lib/pixels';
import { generate, LINEAR_MAP_KINDS, TILE_M, type GeneratorKind } from './generators';

export type ProceduralTextureKind = GeneratorKind;
export { TILE_M };

const cache = new Map<string, Texture>();

function cached(key: string, make: () => Texture): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = make();
  cache.set(key, tex);
  return tex;
}

/** A tiling material map. Colour kinds are sRGB; normal and roughness kinds are linear. Repeat is set to 1 / TILE_M (uv in metres). */
export function proceduralTexture(kind: ProceduralTextureKind, sizePx: number, seed: number): Texture {
  return cached(`${kind}:${sizePx}:${seed}`, () => {
    const srgb = !LINEAR_MAP_KINDS.includes(kind);
    const litRatio = TUNING.RMAT_WINDOW_LIT_RATIO;
    const skylineLitRatio = TUNING.RMAT_SKYLINE_LIT_RATIO;
    const tex = toTexture(generate(kind, sizePx, seed, { litRatio, skylineLitRatio }), { srgb, repeat: true });
    const [tx, ty] = TILE_M[kind];
    tex.repeat.set(1 / tx, 1 / ty);
    tex.name = `procedural:${kind}`;
    return tex;
  });
}

/** Dispose every cached texture (registry dispose). */
export function disposeTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/** Number of live cached textures (tests, dev panel). */
export function textureCacheSize(): number {
  return cache.size;
}

function placeholder(): DataTexture {
  const tex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function finishCanvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = TEXTURE_ANISOTROPY;
  return tex;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (!canvasAvailable()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  return { canvas, g };
}

// ---------------------------------------------------------------------------------------------
// Wordmarks (REQ-MAT-04): each brand slot has its own typography, system font stacks only.
// ---------------------------------------------------------------------------------------------

interface Typography {
  readonly font: (px: number) => string;
  readonly letterSpacing: number;
  readonly ink: string;
  readonly paper: string;
  readonly underline: boolean;
  readonly italic: boolean;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const CONDENSED = '"Arial Narrow", "Segoe UI", Roboto, Impact, sans-serif';

/** Brand slot -> its own look. labA: wide geometric sans. labB: serif, quiet. chip: heavy italic condensed with a bar. */
const TYPOGRAPHY: Readonly<Record<BrandKey, Typography>> = {
  labA: { font: (px) => `700 ${px}px ${SANS}`, letterSpacing: 0.18, ink: '#f4f6fb', paper: '#0d0f16', underline: false, italic: false },
  labB: { font: (px) => `500 ${px}px ${SERIF}`, letterSpacing: 0.06, ink: '#f2e8d8', paper: '#1a1410', underline: false, italic: false },
  chip: { font: (px) => `900 ${px}px ${CONDENSED}`, letterSpacing: 0.02, ink: '#b8ff3c', paper: '#0b120a', underline: true, italic: true },
};

function drawSpaced(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, spacingEm: number, px: number): void {
  const gap = spacingEm * px;
  let width = 0;
  for (const ch of text) width += g.measureText(ch).width + gap;
  width -= gap;
  let x = cx - width / 2;
  g.textAlign = 'left';
  for (const ch of text) {
    g.fillText(ch, x, cy);
    x += g.measureText(ch).width + gap;
  }
}

/** Emissive sign / billboard face with the brand wordmark (BRANDS.companies[brand].wordmark). */
export function wordmarkTexture(brand: BrandKey, widthPx: number, heightPx: number): Texture {
  return cached(`wordmark:${brand}:${widthPx}x${heightPx}`, () => {
    const c = makeCanvas(widthPx, heightPx);
    if (!c) return placeholder();
    const { canvas, g } = c;
    const t = TYPOGRAPHY[brand];
    const text = BRANDS.companies[brand].wordmark;
    g.fillStyle = t.paper;
    g.fillRect(0, 0, widthPx, heightPx);
    // Thin inner border so the box reads as a sign.
    g.strokeStyle = t.ink;
    g.globalAlpha = 0.35;
    g.lineWidth = Math.max(2, heightPx * 0.02);
    g.strokeRect(heightPx * 0.06, heightPx * 0.06, widthPx - heightPx * 0.12, heightPx - heightPx * 0.12);
    g.globalAlpha = 1;
    let px = heightPx * 0.5;
    g.font = t.font(px);
    // Shrink to fit the width with the letter spacing.
    const fits = (): boolean => {
      g.font = t.font(px);
      let w = 0;
      for (const ch of text) w += g.measureText(ch).width + t.letterSpacing * px;
      return w <= widthPx * 0.86;
    };
    while (px > 8 && !fits()) px *= 0.92;
    g.fillStyle = t.ink;
    g.textBaseline = 'middle';
    if (t.italic) {
      g.save();
      g.transform(1, 0, -0.18, 1, heightPx * 0.09, 0);
      drawSpaced(g, text, widthPx / 2, heightPx / 2, t.letterSpacing, px);
      g.restore();
    } else {
      drawSpaced(g, text, widthPx / 2, heightPx / 2, t.letterSpacing, px);
    }
    if (t.underline) {
      g.fillRect(widthPx * 0.15, heightPx * 0.78, widthPx * 0.7, Math.max(2, heightPx * 0.045));
    }
    return finishCanvasTexture(canvas);
  });
}

// ---------------------------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------------------------

function textDecal(text: string, w: number, h: number, ink: string, outline: string | null, font: string): Texture {
  const c = makeCanvas(w, h);
  if (!c) return placeholder();
  const { canvas, g } = c;
  g.clearRect(0, 0, w, h);
  let px = h * 0.7;
  g.font = `${font.replace('{px}', String(px))}`;
  while (px > 8 && g.measureText(text).width > w * 0.9) {
    px *= 0.92;
    g.font = font.replace('{px}', String(px));
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (outline) {
    g.lineWidth = Math.max(2, px * 0.12);
    g.strokeStyle = outline;
    g.lineJoin = 'round';
    g.strokeText(text, w / 2, h / 2);
  }
  g.fillStyle = ink;
  g.fillText(text, w / 2, h / 2);
  const tex = finishCanvasTexture(canvas);
  return tex;
}

function shapeDecal(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const c = makeCanvas(w, h);
  if (!c) return placeholder();
  c.g.clearRect(0, 0, w, h);
  draw(c.g);
  return finishCanvasTexture(c.canvas);
}

const DECAL_PX = 256;

/** Texture for a decal quad. Pixel-generated kinds work in node; text kinds need a canvas. */
export function decalTexture(def: DecalDef): Texture {
  const key = `decal:${def.kind}:${def.brand ?? ''}:${def.text ?? ''}:${Math.round(def.width * 10)}x${Math.round(def.height * 10)}`;
  return cached(key, () => {
    const aspect = def.width / Math.max(0.01, def.height);
    const w = Math.round(DECAL_PX * Math.max(1, Math.min(4, aspect)));
    const h = Math.round(DECAL_PX * Math.max(1, Math.min(4, 1 / aspect)));
    switch (def.kind) {
      case 'crosswalk': {
        const tex = toTexture(generate('crosswalk', DECAL_PX, 7), { srgb: true, repeat: false });
        tex.name = 'decal:crosswalk';
        return tex;
      }
      case 'water': {
        const tex = toTexture(generate('water', DECAL_PX, 11), { srgb: true, repeat: true });
        tex.name = 'decal:water';
        return tex;
      }
      case 'wordmark':
        return textDecal(def.text ?? (def.brand ? BRANDS.companies[def.brand].wordmark : ''), w, h, 'rgba(240,236,224,0.85)', null, `700 {px}px ${SANS}`);
      case 'graffiti':
        return textDecal(def.text ?? 'CTRL Z', w, h, '#ff4fd8', '#1a0a2a', `900 {px}px ${CONDENSED}`);
      case 'paint':
        return shapeDecal(w, h, (g) => {
          g.fillStyle = 'rgba(232, 196, 60, 0.9)';
          g.fillRect(w * 0.04, h * 0.1, w * 0.92, h * 0.8);
          if (def.text) {
            g.fillStyle = '#16161c';
            g.font = `700 ${h * 0.5}px ${SANS}`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(def.text, w / 2, h / 2);
          }
        });
      case 'arrow':
        return shapeDecal(w, h, (g) => {
          g.fillStyle = 'rgba(240, 240, 235, 0.9)';
          g.beginPath();
          g.moveTo(w * 0.1, h * 0.4);
          g.lineTo(w * 0.6, h * 0.4);
          g.lineTo(w * 0.6, h * 0.2);
          g.lineTo(w * 0.9, h * 0.5);
          g.lineTo(w * 0.6, h * 0.8);
          g.lineTo(w * 0.6, h * 0.6);
          g.lineTo(w * 0.1, h * 0.6);
          g.closePath();
          g.fill();
        });
      case 'drain':
        return shapeDecal(w, h, (g) => {
          g.fillStyle = 'rgba(30, 30, 34, 0.95)';
          g.fillRect(0, 0, w, h);
          g.fillStyle = 'rgba(120, 120, 126, 0.9)';
          const bars = 7;
          for (let i = 0; i < bars; i++) g.fillRect(0, (h / bars) * i + h * 0.02, w, h / bars - h * 0.04);
        });
      case 'stain':
        return shapeDecal(w, h, (g) => {
          const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) / 2);
          grad.addColorStop(0, 'rgba(20, 18, 16, 0.55)');
          grad.addColorStop(0.7, 'rgba(20, 18, 16, 0.25)');
          grad.addColorStop(1, 'rgba(20, 18, 16, 0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
        });
    }
  });
}

/** Big glowing letter for the C O D E pickups (LevelView). */
export function letterTexture(letter: string): Texture {
  return cached(`letter:${letter}`, () => textDecal(letter, 128, 128, '#ffffff', '#101018', `900 {px}px ${SANS}`));
}
