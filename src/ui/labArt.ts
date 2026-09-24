/**
 * src/ui/labArt.ts (ui track): Canvas2D thumbnails for the Board Lab pickers (REQ-LAB-01, REQ-LAB-02:
 * no downloaded art). The pictures come from the skater track's board art (src/render/skater/boardArt.ts,
 * the same drawings the in-game deck texture uses, so what the Lab shows is what the board gets), called
 * through tryImplemented (ARCHITECTURE decision 22) with this file's own simpler drawings as the fallback
 * while that module is a stub. Grip, truck and wheel swatches are ours. Every drawing guards a missing
 * 2D context (happy-dom) by returning the blank canvas.
 */

import { tryImplemented } from '../core/contract';
import type { GripId, ParkId, StickerSheetId, TruckColorId, WheelId } from '../core/types';
import { BRANDS, stickerSheetLabel } from '../data/brands';
import {
  DECK_GRAPHIC_NAMES as SKATER_DECK_GRAPHIC_NAMES, DECK_H as SKATER_DECK_H, DECK_W as SKATER_DECK_W, drawDeckGraphic as skaterDeckGraphic,
  drawSticker as skaterSticker, STICKER_COUNT as SKATER_STICKER_COUNT, STICKER_H as SKATER_STICKER_H, STICKER_W as SKATER_STICKER_W,
} from '../render/skater/boardArt';

export const STICKER_SHEETS: readonly StickerSheetId[] = ['labA', 'labB', 'chip', 'wafer', 'pcb', 'tokenStream', 'inference'];
const FALLBACK_STICKERS_PER_SHEET = 4;
export const STICKERS_PER_SHEET: number = SKATER_STICKER_COUNT > 0 ? SKATER_STICKER_COUNT : FALLBACK_STICKERS_PER_SHEET;

const FALLBACK_DECK_GRAPHIC_NAMES: readonly string[] = ['Stack Trace', 'Hex Dump', 'Gradient Descent', 'Hot Kernel', 'Checksum', 'Wireframe'];
export const DECK_GRAPHIC_NAMES: readonly string[] = SKATER_DECK_GRAPHIC_NAMES.length > 0 ? SKATER_DECK_GRAPHIC_NAMES : FALLBACK_DECK_GRAPHIC_NAMES;

/** Sticker footprint on the deck as fractions of its length (along) and width (across), from the skater's texture layout. */
export const STICKER_ALONG: number = SKATER_STICKER_W / SKATER_DECK_W;
export const STICKER_ACROSS: number = SKATER_STICKER_H / SKATER_DECK_H;
/** Thumbnail size, the skater's sticker aspect. */
export const STICKER_THUMB_W = 96;
export const STICKER_THUMB_H = Math.round((STICKER_THUMB_W * SKATER_STICKER_H) / SKATER_STICKER_W);
/** The 2D underside map's width / length (styles.css .map__deck aspect-ratio must match). */
export const MAP_DECK_ASPECT = 0.29;

export const GRIP_LABELS: Readonly<Record<GripId, string>> = { black: 'Black', gray: 'Gray', clear: 'Clear', dieCut: 'Die-cut' };
export const TRUCK_LABELS: Readonly<Record<TruckColorId, string>> = { raw: 'Raw', black: 'Black', gold: 'Gold', red: 'Red' };
export const TRUCK_COLORS: Readonly<Record<TruckColorId, string>> = { raw: '#b9bec8', black: '#23262d', gold: '#d9a531', red: '#d0342c' };
export const WHEEL_LABELS: Readonly<Record<WheelId, string>> = { white99a: 'White 99a', blue101a: 'Blue 101a', green97a: 'Green 97a', orange99a: 'Orange 99a' };
export const WHEEL_COLORS: Readonly<Record<WheelId, string>> = { white99a: '#f1f1ec', blue101a: '#3d7bff', green97a: '#4fd36b', orange99a: '#ff8a2a' };
export const GRIP_COLORS: Readonly<Record<GripId, string>> = { black: '#1c1c1f', gray: '#5d6067', clear: '#c9b58f', dieCut: '#1c1c1f' };

/** Dominant colour per deck graphic (the 2D placeholder board and the sticker map use it). */
export const DECK_GRAPHIC_COLORS: readonly string[] = ['#1d2a4a', '#0e2e1c', '#ff6a00', '#5a0f2a', '#e9e2cf', '#101318'];

const STICKER_TINTS = ['#ff7a1a', '#35e0ff', '#f2ff3d', '#ff3ca6'];

function ctx2d(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  let g: CanvasRenderingContext2D | null;
  try {
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  return { canvas, g };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Deterministic pseudo-random for pattern art (no Math.random anywhere near the sim). */
function hash(n: number): number {
  let x = (n * 374761393 + 668265263) | 0;
  x = ((x ^ (x >>> 13)) * 1274126177) | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Draw deck graphic `index` into a w x h context (the deck runs vertically: y is along the length, the
 * nose at the top). The skater's art is drawn horizontally (x along the length, nose to the right) into an
 * offscreen canvas and turned a quarter turn; its fallback draws straight into g.
 */
export function drawDeckGraphic(g: CanvasRenderingContext2D, index: number, w: number, h: number): void {
  const off = ctx2d(Math.max(64, Math.round(h * 2)), Math.max(16, Math.round(w * 2)));
  const drawn = off.g
    ? tryImplemented(() => {
        skaterDeckGraphic(off.g as CanvasRenderingContext2D, off.canvas.width, off.canvas.height, index);
        return true;
      })
    : null;
  if (drawn) {
    g.save();
    g.translate(0, h);
    g.rotate(-Math.PI / 2);
    g.drawImage(off.canvas, 0, 0, h, w);
    g.restore();
    return;
  }
  fallbackDeckGraphic(g, index, w, h);
}

function fallbackDeckGraphic(g: CanvasRenderingContext2D, index: number, w: number, h: number): void {
  const n = FALLBACK_DECK_GRAPHIC_NAMES.length;
  const i = ((index % n) + n) % n;
  g.save();
  switch (i) {
    case 0: {
      g.fillStyle = '#1d2a4a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#35e0ff';
      for (let k = 0; k < 9; k++) {
        const y = (h / 9) * k + 4;
        g.globalAlpha = 0.25 + 0.75 * hash(k);
        g.fillRect(6, y, w * (0.3 + 0.6 * hash(k + 40)), h / 22);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#f2ff3d';
      g.fillRect(6, h * 0.45, w - 12, h / 18);
      break;
    }
    case 1: {
      g.fillStyle = '#0e2e1c';
      g.fillRect(0, 0, w, h);
      const cols = 4;
      const rows = 12;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = hash(r * cols + c + 7);
          g.fillStyle = v > 0.7 ? '#4fd36b' : v > 0.35 ? '#1f6b3a' : '#123f26';
          g.fillRect(4 + (c * (w - 8)) / cols, 4 + (r * (h - 8)) / rows, (w - 8) / cols - 2, (h - 8) / rows - 2);
        }
      }
      break;
    }
    case 2: {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#ff3ca6');
      grad.addColorStop(0.5, '#ff6a00');
      grad.addColorStop(1, '#f2ff3d');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 3;
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.moveTo(0, h * 0.15 + k * h * 0.14);
        g.lineTo(w, h * 0.35 + k * h * 0.14);
        g.stroke();
      }
      break;
    }
    case 3: {
      g.fillStyle = '#5a0f2a';
      g.fillRect(0, 0, w, h);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = k % 2 ? '#ff6a00' : '#ffd23c';
        g.beginPath();
        g.moveTo(w * 0.5, h * (0.1 + k * 0.12));
        g.lineTo(w * 0.1, h * (0.3 + k * 0.12));
        g.lineTo(w * 0.9, h * (0.3 + k * 0.12));
        g.closePath();
        g.fill();
      }
      break;
    }
    case 4: {
      const n = 6;
      const cell = w / n;
      for (let r = 0; r < Math.ceil(h / cell); r++) {
        for (let c = 0; c < n; c++) {
          g.fillStyle = (r + c) % 2 ? '#e9e2cf' : '#1a1a1a';
          g.fillRect(c * cell, r * cell, cell + 1, cell + 1);
        }
      }
      break;
    }
    default: {
      g.fillStyle = '#101318';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#35e0ff';
      g.lineWidth = 1.5;
      const step = w / 5;
      for (let x = 0; x <= w; x += step) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      g.strokeStyle = '#ff3ca6';
      g.beginPath();
      g.moveTo(0, h * 0.7);
      g.lineTo(w * 0.5, h * 0.2);
      g.lineTo(w, h * 0.8);
      g.stroke();
      break;
    }
  }
  g.restore();
}

/** Draw sticker `index` of `sheet` into a w x h context: the skater's sticker art, or the fallback. */
export function drawSticker(g: CanvasRenderingContext2D, sheet: StickerSheetId, index: number, w: number, h: number): void {
  const drawn = tryImplemented(() => {
    skaterSticker(g, sheet, index, w, h);
    return true;
  });
  if (!drawn) fallbackSticker(g, sheet, index, w, h);
}

function fallbackSticker(g: CanvasRenderingContext2D, sheet: StickerSheetId, index: number, w: number, h: number): void {
  const i = ((index % FALLBACK_STICKERS_PER_SHEET) + FALLBACK_STICKERS_PER_SHEET) % FALLBACK_STICKERS_PER_SHEET;
  const tint = STICKER_TINTS[i] as string;
  g.save();
  g.clearRect(0, 0, w, h);
  const pad = Math.max(2, w * 0.05);
  const wordmark = sheet === 'labA' || sheet === 'labB' || sheet === 'chip' ? BRANDS.companies[sheet].wordmark : stickerSheetLabel(sheet).toUpperCase();
  const drawText = (text: string, fill: string, size: number): void => {
    g.fillStyle = fill;
    g.font = `900 ${size}px Impact, 'Arial Narrow', 'Arial Black', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let s = size;
    while (g.measureText(text).width > w - pad * 4 && s > 6) {
      s -= 1;
      g.font = `900 ${s}px Impact, 'Arial Narrow', 'Arial Black', sans-serif`;
    }
    g.fillText(text, w / 2, h / 2);
  };
  switch (sheet) {
    case 'labA':
    case 'labB':
    case 'chip': {
      // Wordmark stickers: filled pill, outlined pill, badge with the initial, slanted banner.
      g.lineWidth = 3;
      if (i === 0) {
        roundRect(g, pad, pad, w - pad * 2, h - pad * 2, h * 0.3);
        g.fillStyle = tint;
        g.fill();
        g.strokeStyle = '#fff';
        g.stroke();
        drawText(wordmark, '#111', h * 0.42);
      } else if (i === 1) {
        roundRect(g, pad, pad, w - pad * 2, h - pad * 2, 4);
        g.fillStyle = '#111';
        g.fill();
        g.strokeStyle = tint;
        g.stroke();
        drawText(wordmark, tint, h * 0.42);
      } else if (i === 2) {
        g.beginPath();
        g.arc(w / 2, h / 2, Math.min(w, h) / 2 - pad, 0, Math.PI * 2);
        g.fillStyle = tint;
        g.fill();
        g.strokeStyle = '#fff';
        g.stroke();
        drawText(wordmark.charAt(0), '#111', h * 0.6);
      } else {
        g.translate(w / 2, h / 2);
        g.rotate(-0.12);
        g.fillStyle = tint;
        g.fillRect(-w / 2 + pad, -h * 0.3, w - pad * 2, h * 0.6);
        g.strokeStyle = '#fff';
        g.strokeRect(-w / 2 + pad, -h * 0.3, w - pad * 2, h * 0.6);
        g.translate(-w / 2, -h / 2);
        drawText(wordmark, '#111', h * 0.38);
      }
      break;
    }
    case 'wafer': {
      const r = Math.min(w, h) / 2 - pad;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.fillStyle = i % 2 ? '#8d95a8' : '#c7ccd8';
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      g.save();
      g.clip();
      const cell = r / (2.5 + i);
      g.strokeStyle = tint;
      g.lineWidth = 1;
      for (let x = w / 2 - r; x <= w / 2 + r; x += cell) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = h / 2 - r; y <= h / 2 + r; y += cell) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      g.restore();
      break;
    }
    case 'pcb': {
      roundRect(g, pad, pad, w - pad * 2, h - pad * 2, 4);
      g.fillStyle = i === 3 ? '#1b2a6b' : '#0f5c2e';
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = '#d9a531';
      g.lineWidth = 2;
      for (let k = 0; k < 4 + i; k++) {
        const y = pad * 2 + ((h - pad * 4) * (k + 0.5)) / (4 + i);
        g.beginPath();
        g.moveTo(pad * 2, y);
        g.lineTo(w * (0.3 + 0.4 * hash(k + i * 9)), y);
        g.lineTo(w * (0.3 + 0.4 * hash(k + i * 9)), y + (hash(k) > 0.5 ? 6 : -6));
        g.lineTo(w - pad * 2, y + (hash(k) > 0.5 ? 6 : -6));
        g.stroke();
        g.beginPath();
        g.arc(pad * 2, y, 2.5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'tokenStream': {
      roundRect(g, pad, pad, w - pad * 2, h - pad * 2, 4);
      g.fillStyle = '#111';
      g.fill();
      g.strokeStyle = tint;
      g.lineWidth = 2;
      g.stroke();
      const rows = 3;
      for (let r = 0; r < rows; r++) {
        let x = pad * 2;
        const y = pad * 2 + ((h - pad * 4) * r) / rows;
        const rh = (h - pad * 4) / rows - 3;
        let k = 0;
        while (x < w - pad * 2) {
          const bw = 6 + 14 * hash(r * 31 + k + i * 100);
          g.fillStyle = k % 3 === i % 3 ? tint : '#e8ebf2';
          g.fillRect(x, y, Math.min(bw, w - pad * 2 - x), rh);
          x += bw + 3;
          k += 1;
        }
      }
      break;
    }
    case 'inference': {
      roundRect(g, pad, pad, w - pad * 2, h - pad * 2, h * 0.25);
      g.fillStyle = tint;
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.stroke();
      g.strokeStyle = '#111';
      g.lineWidth = 3;
      g.beginPath();
      const n = 9;
      for (let k = 0; k < n; k++) {
        const x = pad * 2 + ((w - pad * 4) * k) / (n - 1);
        const y = h / 2 + (h * 0.3) * (hash(k + i * 17) - 0.5) * 2;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      drawText('900ms', '#111', h * 0.3);
      break;
    }
  }
  g.restore();
}

export function deckGraphicThumb(index: number, w = 44, h = 120): HTMLCanvasElement {
  const { canvas, g } = ctx2d(w, h);
  if (g) {
    drawDeckGraphic(g, index, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    roundRect(g, 1, 1, w - 2, h - 2, w * 0.45);
    g.stroke();
  }
  return canvas;
}

export function stickerThumb(sheet: StickerSheetId, index: number, w = STICKER_THUMB_W, h = STICKER_THUMB_H): HTMLCanvasElement {
  const { canvas, g } = ctx2d(w, h);
  if (g) drawSticker(g, sheet, index, w, h);
  return canvas;
}

const graphicUrlCache = new Map<number, string | null>();

/** The deck graphic as a data URL for a CSS background (the underside map), or null without a 2D context. */
export function deckGraphicDataUrl(index: number): string | null {
  if (graphicUrlCache.has(index)) return graphicUrlCache.get(index) ?? null;
  let url: string | null = null;
  try {
    const { canvas, g } = ctx2d(80, 276);
    if (g) {
      drawDeckGraphic(g, index, 80, 276);
      url = canvas.toDataURL();
    }
  } catch {
    url = null;
  }
  graphicUrlCache.set(index, url);
  return url;
}

export function gripThumb(grip: GripId, w = 44, h = 120): HTMLCanvasElement {
  const { canvas, g } = ctx2d(w, h);
  if (!g) return canvas;
  roundRect(g, 1, 1, w - 2, h - 2, w * 0.45);
  g.fillStyle = GRIP_COLORS[grip];
  g.fill();
  if (grip === 'dieCut') {
    g.fillStyle = '#c9b58f';
    g.beginPath();
    g.moveTo(w / 2, h * 0.3);
    g.lineTo(w * 0.8, h * 0.5);
    g.lineTo(w / 2, h * 0.7);
    g.lineTo(w * 0.2, h * 0.5);
    g.closePath();
    g.fill();
  }
  if (grip === 'clear') {
    g.fillStyle = 'rgba(255,255,255,0.15)';
    for (let y = 8; y < h; y += 14) g.fillRect(6, y, w - 12, 4);
  }
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 2;
  g.stroke();
  return canvas;
}

export function swatchThumb(color: string, w = 44, h = 44): HTMLCanvasElement {
  const { canvas, g } = ctx2d(w, h);
  if (!g) return canvas;
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.arc(w * 0.38, h * 0.36, w * 0.12, 0, Math.PI * 2);
  g.fill();
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// Park select card art (REQ-MNU-02): a Canvas2D silhouette per park, procedural like the rest of the
// UI and independent of the render track. Market Street is a dusk skyline over a marble ledge with
// one rail; Woodshed is a warm plywood room with a bowl curve and a rainbow rail arc.
// ---------------------------------------------------------------------------------------------

const PARK_ART_W = 320;
const PARK_ART_H = 120;
const parkArtCache = new Map<ParkId, string | null>();

function drawMarketStreet(g: CanvasRenderingContext2D, w: number, h: number): void {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1a2140');
  sky.addColorStop(0.55, '#5a2a4a');
  sky.addColorStop(1, '#ff7a1a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // Sun.
  g.fillStyle = 'rgba(255, 210, 60, 0.9)';
  g.beginPath();
  g.arc(w * 0.72, h * 0.62, h * 0.16, 0, Math.PI * 2);
  g.fill();
  // Skyline: ten towers of hashed size, darker towards the front.
  const towers = 10;
  for (let i = 0; i < towers; i++) {
    const x = (i / towers) * w + hash(i * 7 + 1) * 10 - 5;
    const tw = w / towers + hash(i * 7 + 2) * 18 - 4;
    const th = h * (0.25 + hash(i * 7 + 3) * 0.5);
    g.fillStyle = i % 2 === 0 ? '#0d1020' : '#161b30';
    g.fillRect(x, h * 0.78 - th, tw, th);
    // A few lit windows.
    g.fillStyle = 'rgba(255, 220, 120, 0.55)';
    const rows = Math.floor(th / 10);
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        if (hash(i * 131 + r * 17 + c * 3) > 0.62) g.fillRect(x + 4 + c * (tw / 2), h * 0.78 - th + r * 10, 3, 4);
      }
    }
  }
  // Marble ledge with a highlight line, then the ground.
  g.fillStyle = '#c9c4b8';
  g.fillRect(0, h * 0.78, w, h * 0.07);
  g.fillStyle = 'rgba(255, 255, 255, 0.7)';
  g.fillRect(0, h * 0.78, w, 2);
  g.fillStyle = '#3a3f4c';
  g.fillRect(0, h * 0.85, w, h * 0.15);
  // One handrail down the front.
  g.strokeStyle = '#e6e9f0';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.12, h * 0.66);
  g.lineTo(w * 0.42, h * 0.92);
  g.stroke();
  g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.3;
    const px = w * (0.12 + 0.3 * t);
    const py = h * (0.66 + 0.26 * t);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, py + h * 0.1);
    g.stroke();
  }
}

function drawWoodshed(g: CanvasRenderingContext2D, w: number, h: number): void {
  const wall = g.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#3a2414');
  wall.addColorStop(1, '#8a5a2c');
  g.fillStyle = wall;
  g.fillRect(0, 0, w, h);
  // Roof trusses.
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const x = (i / 5) * w;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + w * 0.12, h * 0.34);
    g.stroke();
  }
  // Plywood floor planks.
  for (let y = h * 0.62; y < h; y += 7) {
    g.fillStyle = (Math.floor(y / 7) % 2 === 0) ? '#c98a3c' : '#b47a30';
    g.fillRect(0, y, w, 7);
  }
  // Bowl: a dark curve dropping below the floor, lip highlighted.
  g.fillStyle = '#6e4620';
  g.beginPath();
  g.moveTo(w * 0.05, h * 0.62);
  g.bezierCurveTo(w * 0.12, h * 1.05, w * 0.5, h * 1.05, w * 0.58, h * 0.62);
  g.closePath();
  g.fill();
  g.strokeStyle = '#f0d9a8';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.05, h * 0.62);
  g.bezierCurveTo(w * 0.12, h * 1.05, w * 0.5, h * 1.05, w * 0.58, h * 0.62);
  g.stroke();
  // Rainbow rail arc on the right.
  g.strokeStyle = '#35e0ff';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(w * 0.62, h * 0.66);
  g.quadraticCurveTo(w * 0.8, h * 0.18, w * 0.98, h * 0.66);
  g.stroke();
  g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  g.lineWidth = 2;
  for (const t of [0.2, 0.5, 0.8]) {
    const px = w * (0.62 + 0.36 * t);
    const py = (1 - t) * (1 - t) * h * 0.66 + 2 * (1 - t) * t * h * 0.18 + t * t * h * 0.66;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, h * 0.66);
    g.stroke();
  }
  // Warm overhead light.
  const glow = g.createRadialGradient(w * 0.5, h * 0.1, 4, w * 0.5, h * 0.1, w * 0.5);
  glow.addColorStop(0, 'rgba(255, 220, 150, 0.35)');
  glow.addColorStop(1, 'rgba(255, 220, 150, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
}

/** Card art for a park as a data URL (cached), or null without a 2D context. */
export function parkArtDataUrl(park: ParkId): string | null {
  if (parkArtCache.has(park)) return parkArtCache.get(park) ?? null;
  let url: string | null = null;
  try {
    const { canvas, g } = ctx2d(PARK_ART_W, PARK_ART_H);
    if (g) {
      if (park === 'woodshed') drawWoodshed(g, PARK_ART_W, PARK_ART_H);
      else drawMarketStreet(g, PARK_ART_W, PARK_ART_H);
      url = canvas.toDataURL();
    }
  } catch {
    url = null;
  }
  parkArtCache.set(park, url);
  return url;
}
