/**
 * src/render/skater/boardArt.ts (skater track): every Board Lab texture, drawn with Canvas2D
 * (REQ-LAB-02, REQ-SKT-02): grip patterns, the six deck graphics, the seven sticker sheets (the
 * three brand sheets read BRANDS, REQ-LAB-01) and the Kernel Panic blue screen (SPEC §9.1).
 * Also thumbnails for the Board Lab UI. Deterministic: a small seeded generator, never Math.random.
 * Canvas layout for deck faces: x = u (0 tail .. 1 nose), y = v (0 .. 1 across).
 */

import { BRANDS, stickerSheetLabel } from '../../data/brands';
import type { BoardConfig, GripId, StickerPlacement, StickerSheetId } from '../../core/types';

export const DECK_W = 1024;
export const DECK_H = 256;
export const STICKER_W = 150;
export const STICKER_H = 100;

/** Deck graphic names for the Board Lab tabs (index = BoardConfig.deckGraphic). */
export const DECK_GRAPHIC_NAMES: readonly string[] = ['Wafer', 'Terminal', 'Token Stream', 'Circuit', 'Sponsor', 'Latency'];

export const DECK_GRAPHIC_COUNT = DECK_GRAPHIC_NAMES.length;

export const GRIP_NAMES: Readonly<Record<GripId, string>> = { black: 'Black', gray: 'Gray', clear: 'Clear', dieCut: 'Die cut' };

/** Stickers per sheet (index range for StickerPlacement.index). */
export const STICKER_COUNT = 6;

export const STICKER_SHEET_IDS: readonly StickerSheetId[] = ['labA', 'labB', 'chip', 'wafer', 'pcb', 'tokenStream', 'inference'];

export const WOOD_COLOR = '#d7b27c';
export const WOOD_DARK = '#b98f5a';

type Ctx = CanvasRenderingContext2D;

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: HTMLCanvasElement): Ctx {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('boardArt: no 2d context');
  return ctx;
}

const SANS = "700 40px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const MONO = "600 28px ui-monospace, Consolas, 'Courier New', monospace";

function font(ctx: Ctx, px: number, mono = false, weight = 700): void {
  ctx.font = mono ? `${weight} ${px}px ui-monospace, Consolas, 'Courier New', monospace` : `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Fit text into a width by shrinking the font size. */
function fitText(ctx: Ctx, text: string, maxW: number, px: number, mono = false): void {
  let size = px;
  font(ctx, size, mono);
  while (ctx.measureText(text).width > maxW && size > 8) {
    size -= 2;
    font(ctx, size, mono);
  }
}

// ---------------------------------------------------------------------------------------------
// Wood and grip
// ---------------------------------------------------------------------------------------------

export function drawWood(ctx: Ctx, w: number, h: number, seed = 7): void {
  const rnd = seeded(seed);
  ctx.fillStyle = WOOD_COLOR;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 26; i++) {
    const y0 = rnd() * h;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y0 + Math.sin(x / 90 + i) * 6 + (rnd() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function speckle(ctx: Ctx, w: number, h: number, count: number, light: string, dark: string, seed: number): void {
  const rnd = seeded(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rnd() < 0.5 ? light : dark;
    ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
}

/** Black grip: lifted off pure black so the deck top reads against a dark ground, with a lighter border. */
const GRIP_BLACK = '#2b2b31';
const GRIP_BLACK_LIGHT = '#4a4a54';
const GRIP_BLACK_DARK = '#121216';
/** Border around the grip outline (the canvas edge maps onto the deck outline), px of the 1024 x 256 sheet. */
const GRIP_BORDER_PX = 8;
const GRIP_BORDER_COLOR = '#3c3c46';

function gripBorder(ctx: Ctx, w: number, h: number): void {
  ctx.strokeStyle = GRIP_BORDER_COLOR;
  ctx.lineWidth = GRIP_BORDER_PX * 2;
  ctx.strokeRect(0, 0, w, h);
}

/** The deck top (REQ-LAB-01 grip tab). */
export function drawGrip(ctx: Ctx, w: number, h: number, grip: GripId): void {
  drawWood(ctx, w, h, 11);
  switch (grip) {
    case 'black':
      ctx.fillStyle = GRIP_BLACK;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 3200, GRIP_BLACK_LIGHT, GRIP_BLACK_DARK, 3);
      gripBorder(ctx, w, h);
      break;
    case 'gray':
      ctx.fillStyle = '#5c5f66';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 3200, '#8a8e96', '#3a3d44', 5);
      ctx.strokeStyle = '#71747c';
      ctx.lineWidth = GRIP_BORDER_PX * 2;
      ctx.strokeRect(0, 0, w, h);
      break;
    case 'clear':
      ctx.fillStyle = 'rgba(40, 40, 46, 0.32)';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 2400, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.35)', 9);
      break;
    case 'dieCut': {
      ctx.fillStyle = GRIP_BLACK;
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 3200, GRIP_BLACK_LIGHT, GRIP_BLACK_DARK, 3);
      gripBorder(ctx, w, h);
      // Cut-outs: a diagonal band and a ring showing the wood.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(w * 0.42, 0);
      ctx.lineTo(w * 0.5, 0);
      ctx.lineTo(w * 0.36, h);
      ctx.lineTo(w * 0.28, h);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w * 0.72, h / 2, h * 0.22, 0, Math.PI * 2);
      ctx.arc(w * 0.72, h / 2, h * 0.14, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      // Paint the wood back into the holes.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      drawWood(ctx, w, h, 11);
      ctx.restore();
      break;
    }
  }
}

/** Plywood plies for the deck edge (7 layers, two dyed). */
export function drawPlies(ctx: Ctx, w: number, h: number): void {
  const colors = ['#e2bd86', '#c99a62', '#e2bd86', '#7a4a3a', '#e2bd86', '#c99a62', '#e2bd86'];
  const ply = h / colors.length;
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * ply, w, ply + 1);
  });
}

// ---------------------------------------------------------------------------------------------
// Deck graphics (bottom)
// ---------------------------------------------------------------------------------------------

/**
 * Deck graphics keep their text and key marks inside u 0.2 .. 0.8: the deck outline rounds off the
 * tail zone (0.15 m of 0.82 = u 0.18) and the nose zone (0.17 m = u 0.21), so anything outside the
 * straight section is clipped by the outline.
 */
const ART_U0 = 0.22;
const ART_U1 = 0.78;

export function drawDeckGraphic(ctx: Ctx, w: number, h: number, index: number): void {
  const i = ((Math.floor(index) % DECK_GRAPHIC_COUNT) + DECK_GRAPHIC_COUNT) % DECK_GRAPHIC_COUNT;
  ctx.save();
  switch (i) {
    case 0: {
      // Wafer: navy field, a silicon wafer disc of dies.
      ctx.fillStyle = '#101a33';
      ctx.fillRect(0, 0, w, h);
      const cx = w * 0.66;
      const cy = h / 2;
      const R = h * 0.46;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#2b3a6b';
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      const die = 16;
      for (let y = cy - R; y < cy + R; y += die) {
        for (let x = cx - R; x < cx + R; x += die) {
          ctx.fillStyle = ((x + y) / die) % 5 === 0 ? '#5ee0d0' : '#3c58a8';
          ctx.fillRect(x + 2, y + 2, die - 4, die - 4);
        }
      }
      ctx.restore();
      ctx.strokeStyle = '#8fd8ff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#8fd8ff';
      ctx.textBaseline = 'middle';
      fitText(ctx, 'WAFER', w * 0.3, 54);
      ctx.fillText('WAFER', w * ART_U0, h * 0.42);
      font(ctx, 22, true);
      ctx.fillStyle = '#5ee0d0';
      ctx.fillText('yield 97%', w * ART_U0, h * 0.66);
      break;
    }
    case 1: {
      // Terminal: black with green monospace lines.
      ctx.fillStyle = '#07090c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4bff7a';
      ctx.textBaseline = 'top';
      font(ctx, 26, true);
      const lines = ['$ compile the line', '$ fetch the drive', '$ land clean', '> ok 200'];
      lines.forEach((l, k) => ctx.fillText(l, w * ART_U0, h * 0.12 + k * 46));
      ctx.fillRect(w * ART_U0 + 8 * 16, h * 0.12 + 3 * 46, 16, 28);
      font(ctx, 150, true);
      ctx.fillStyle = '#1f7a3a';
      ctx.fillText('>_', w * 0.58, h * 0.12);
      break;
    }
    case 2: {
      // Token stream: diagonal coloured token blocks.
      ctx.fillStyle = '#f4efe6';
      ctx.fillRect(0, 0, w, h);
      const palette = ['#ff5f3a', '#2ec4b6', '#ffb020', '#5b6cff', '#e14ec9'];
      const words = ['pop', 'flip', 'grind', 'land', 'push', 'air', 'bank', 'revert'];
      const rnd = seeded(21);
      ctx.textBaseline = 'middle';
      for (let k = 0; k < 24; k++) {
        const x = w * ART_U0 + ((k * 97) % (w * (ART_U1 - ART_U0) - 120));
        const y = ((k * 53) % (h - 60)) + 10;
        const word = words[k % words.length] as string;
        font(ctx, 24, true);
        const tw = ctx.measureText(word).width + 24;
        ctx.fillStyle = palette[k % palette.length] as string;
        roundRect(ctx, x, y, tw, 40, 10);
        ctx.fill();
        ctx.fillStyle = rnd() < 0.5 ? '#ffffff' : '#101010';
        ctx.fillText(word, x + 12, y + 20);
      }
      break;
    }
    case 3: {
      // Circuit board: green mask, gold traces and pads.
      ctx.fillStyle = '#1d6b3a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d9b34a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      const rnd = seeded(33);
      for (let k = 0; k < 22; k++) {
        let x = rnd() * w;
        let y = rnd() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
          const horiz = s % 2 === 0;
          x = horiz ? x + (rnd() - 0.5) * 300 : x;
          y = horiz ? y : y + (rnd() - 0.5) * 120;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = '#f2d77a';
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#111';
      ctx.fillRect(w * 0.42, h * 0.3, 160, 100);
      ctx.fillStyle = '#d9b34a';
      for (let p = 0; p < 8; p++) {
        ctx.fillRect(w * 0.42 + 10 + p * 19, h * 0.3 - 14, 8, 14);
        ctx.fillRect(w * 0.42 + 10 + p * 19, h * 0.3 + 100, 8, 14);
      }
      break;
    }
    case 4: {
      // Sponsor: burgundy field, the lab A wordmark in cream, a bracket motif.
      ctx.fillStyle = '#5a1f2e';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f5e6c8';
      ctx.textBaseline = 'middle';
      font(ctx, 150);
      ctx.fillText('{', w * ART_U0, h * 0.5);
      ctx.fillText('}', w * 0.72, h * 0.5);
      const mark = BRANDS.companies.labA.wordmark;
      fitText(ctx, mark, w * 0.4, 96);
      ctx.fillText(mark, w * 0.3, h * 0.46);
      font(ctx, 24, true);
      ctx.fillText('team rider', w * 0.3, h * 0.78);
      break;
    }
    default: {
      // Latency: orange, a huge 900 with speed stripes and "ms".
      ctx.fillStyle = '#ff7a1a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd08a';
      for (let k = 0; k < 6; k++) ctx.fillRect(0, 20 + k * 40, w * (0.2 + k * 0.05), 12);
      ctx.fillStyle = '#1a1024';
      ctx.textBaseline = 'middle';
      font(ctx, 200);
      ctx.fillText('900', w * 0.32, h * 0.5);
      font(ctx, 70);
      ctx.fillText('ms', w * 0.66, h * 0.62);
      break;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Stickers
// ---------------------------------------------------------------------------------------------

interface Palette {
  readonly bg: string;
  readonly fg: string;
  readonly accent: string;
}

const BRAND_PALETTES: Readonly<Record<'labA' | 'labB' | 'chip', Palette>> = {
  labA: { bg: '#111318', fg: '#ffffff', accent: '#8ad7ff' },
  labB: { bg: '#e8dccb', fg: '#2a1e14', accent: '#c96a3a' },
  chip: { bg: '#0f1a10', fg: '#7dff5a', accent: '#ffffff' },
};

function brandSticker(ctx: Ctx, key: 'labA' | 'labB' | 'chip', index: number, w: number, h: number): void {
  const pal = BRAND_PALETTES[key];
  const co = BRANDS.companies[key];
  const initial = co.name.charAt(0).toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (index % STICKER_COUNT) {
    case 0: // pill wordmark
      ctx.fillStyle = pal.bg;
      roundRect(ctx, 2, h * 0.2, w - 4, h * 0.6, h * 0.3);
      ctx.fill();
      ctx.fillStyle = pal.fg;
      fitText(ctx, co.wordmark, w * 0.84, 34);
      ctx.fillText(co.wordmark, w / 2, h / 2);
      break;
    case 1: // round badge with the initial
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.bg;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.fg;
      font(ctx, 54);
      ctx.fillText(initial, w / 2, h / 2 + 2);
      break;
    case 2: // slanted product box
      ctx.save();
      ctx.transform(1, 0, -0.25, 1, 20, 0);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(4, h * 0.22, w - 30, h * 0.56);
      ctx.fillStyle = pal.accent;
      fitText(ctx, co.product.toUpperCase(), w * 0.7, 30);
      ctx.fillText(co.product.toUpperCase(), (w - 24) / 2, h / 2);
      ctx.restore();
      break;
    case 3: // diamond
      ctx.fillStyle = pal.bg;
      ctx.beginPath();
      ctx.moveTo(w / 2, 2);
      ctx.lineTo(w - 2, h / 2);
      ctx.lineTo(w / 2, h - 2);
      ctx.lineTo(2, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = pal.fg;
      font(ctx, 40);
      ctx.fillText(initial, w / 2, h / 2 + 2);
      break;
    case 4: // team banner
      ctx.fillStyle = pal.accent;
      ctx.fillRect(2, h * 0.1, w - 4, h * 0.8);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(8, h * 0.18, w - 16, h * 0.64);
      ctx.fillStyle = pal.fg;
      font(ctx, 18, true);
      ctx.fillText('TEAM', w / 2, h * 0.36);
      fitText(ctx, co.wordmark, w * 0.8, 26);
      ctx.fillText(co.wordmark, w / 2, h * 0.64);
      break;
    default: // small square monogram
      ctx.fillStyle = pal.bg;
      roundRect(ctx, w / 2 - h * 0.45, h * 0.05, h * 0.9, h * 0.9, 10);
      ctx.fill();
      ctx.fillStyle = pal.accent;
      font(ctx, 60);
      ctx.fillText(initial, w / 2, h / 2 + 2);
      break;
  }
}

function themeSticker(ctx: Ctx, sheet: 'wafer' | 'pcb' | 'tokenStream' | 'inference', index: number, w: number, h: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const k = index % STICKER_COUNT;
  if (sheet === 'wafer') {
    const teal = '#5ee0d0';
    const navy = '#14224a';
    switch (k) {
      case 0: {
        ctx.fillStyle = navy;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, h * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = teal;
        for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 10) ctx.fillRect(w / 2 + x * 11 - 4, h / 2 + y * 11 - 4, 8, 8);
        break;
      }
      case 1:
        ctx.fillStyle = '#222';
        ctx.fillRect(w * 0.25, h * 0.2, w * 0.5, h * 0.6);
        ctx.fillStyle = '#c9c9c9';
        for (let p = 0; p < 6; p++) {
          ctx.fillRect(w * 0.25 + 6 + p * 11, h * 0.08, 6, h * 0.12);
          ctx.fillRect(w * 0.25 + 6 + p * 11, h * 0.8, 6, h * 0.12);
        }
        ctx.fillStyle = teal;
        font(ctx, 18, true);
        ctx.fillText('DIE', w / 2, h / 2);
        break;
      case 2:
        ctx.fillStyle = teal;
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const a = (Math.PI / 3) * s - Math.PI / 6;
          const px = w / 2 + Math.cos(a) * h * 0.46;
          const py = h / 2 + Math.sin(a) * h * 0.46;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = navy;
        font(ctx, 40);
        ctx.fillText('Si', w / 2, h / 2 + 2);
        break;
      case 3:
        ctx.fillStyle = '#8a8f9a';
        roundRect(ctx, w * 0.2, h * 0.3, w * 0.6, h * 0.4, 20);
        ctx.fill();
        ctx.fillStyle = navy;
        font(ctx, 16, true);
        ctx.fillText('INGOT', w / 2, h / 2);
        break;
      case 4:
        ctx.fillStyle = navy;
        roundRect(ctx, 4, h * 0.25, w - 8, h * 0.5, h * 0.25);
        ctx.fill();
        ctx.fillStyle = teal;
        font(ctx, 30);
        ctx.fillText('7 nm', w / 2, h / 2);
        break;
      default:
        ctx.strokeStyle = navy;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.7, h * 0.5, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = teal;
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.7, h * 0.5, Math.PI, Math.PI * 1.9);
        ctx.stroke();
        ctx.fillStyle = navy;
        font(ctx, 20, true);
        ctx.fillText('97%', w / 2, h * 0.62);
        break;
    }
    return;
  }
  if (sheet === 'pcb') {
    const green = '#1d6b3a';
    const gold = '#f2d77a';
    switch (k) {
      case 0:
        ctx.fillStyle = green;
        ctx.fillRect(4, 4, w - 8, h - 8);
        ctx.strokeStyle = gold;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(10, h * 0.3);
        ctx.lineTo(w * 0.4, h * 0.3);
        ctx.lineTo(w * 0.4, h * 0.7);
        ctx.lineTo(w - 10, h * 0.7);
        ctx.moveTo(10, h * 0.7);
        ctx.lineTo(w * 0.25, h * 0.7);
        ctx.lineTo(w * 0.25, h * 0.5);
        ctx.lineTo(w * 0.7, h * 0.5);
        ctx.lineTo(w * 0.7, h * 0.25);
        ctx.stroke();
        break;
      case 1:
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(6, h / 2);
        ctx.lineTo(w - 6, h / 2);
        ctx.stroke();
        ctx.fillStyle = '#d2b48c';
        roundRect(ctx, w * 0.25, h * 0.3, w * 0.5, h * 0.4, 12);
        ctx.fill();
        for (const [x, c] of [[0.35, '#b22'], [0.45, '#222'], [0.55, '#e84'], [0.65, '#da2']] as const) {
          ctx.fillStyle = c;
          ctx.fillRect(w * x, h * 0.3, 8, h * 0.4);
        }
        break;
      case 2:
        ctx.fillStyle = '#2b3a8f';
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.42, h * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#999';
        ctx.fillRect(w / 2 - 14, h * 0.7, 6, h * 0.28);
        ctx.fillRect(w / 2 + 8, h * 0.7, 6, h * 0.28);
        ctx.fillStyle = '#fff';
        font(ctx, 16, true);
        ctx.fillText('10uF', w / 2, h * 0.42);
        break;
      case 3:
        ctx.fillStyle = '#111';
        ctx.fillRect(w * 0.2, h * 0.25, w * 0.6, h * 0.5);
        ctx.fillStyle = '#c9c9c9';
        for (let p = 0; p < 7; p++) {
          ctx.fillRect(w * 0.2 + 6 + p * 12, h * 0.12, 6, h * 0.13);
          ctx.fillRect(w * 0.2 + 6 + p * 12, h * 0.75, 6, h * 0.13);
        }
        ctx.fillStyle = gold;
        font(ctx, 16, true);
        ctx.fillText('IC 42', w / 2, h / 2);
        break;
      case 4:
        ctx.fillStyle = '#ff3a3a';
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.4, h * 0.3, Math.PI, 0);
        ctx.lineTo(w / 2 + h * 0.3, h * 0.65);
        ctx.lineTo(w / 2 - h * 0.3, h * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#999';
        ctx.fillRect(w / 2 - 12, h * 0.65, 5, h * 0.3);
        ctx.fillRect(w / 2 + 7, h * 0.65, 5, h * 0.22);
        break;
      default:
        ctx.strokeStyle = green;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(w / 2, 8);
        ctx.lineTo(w / 2, h * 0.45);
        ctx.moveTo(w * 0.25, h * 0.45);
        ctx.lineTo(w * 0.75, h * 0.45);
        ctx.moveTo(w * 0.33, h * 0.62);
        ctx.lineTo(w * 0.67, h * 0.62);
        ctx.moveTo(w * 0.42, h * 0.79);
        ctx.lineTo(w * 0.58, h * 0.79);
        ctx.stroke();
        ctx.fillStyle = green;
        font(ctx, 14, true);
        ctx.fillText('GND', w * 0.82, h * 0.86);
        break;
    }
    return;
  }
  if (sheet === 'tokenStream') {
    const palette = ['#ff5f3a', '#2ec4b6', '#ffb020', '#5b6cff'];
    switch (k) {
      case 0:
        ctx.fillStyle = '#2ec4b6';
        roundRect(ctx, 4, h * 0.22, w - 8, h * 0.56, 14);
        ctx.fill();
        ctx.fillStyle = '#101010';
        font(ctx, 30, true);
        ctx.fillText('<tok>', w / 2, h / 2);
        break;
      case 1:
        palette.slice(0, 3).forEach((c, i) => {
          ctx.fillStyle = c;
          roundRect(ctx, 6 + i * (w / 3), h * 0.3, w / 3 - 10, h * 0.4, 8);
          ctx.fill();
        });
        break;
      case 2:
        ctx.fillStyle = '#101010';
        ctx.fillRect(w / 2 - 10, h * 0.15, 20, h * 0.7);
        ctx.fillStyle = '#5b6cff';
        font(ctx, 20, true);
        ctx.fillText('next', w * 0.78, h / 2);
        break;
      case 3:
        ctx.fillStyle = '#ffb020';
        roundRect(ctx, 4, h * 0.22, w - 8, h * 0.56, h * 0.28);
        ctx.fill();
        ctx.fillStyle = '#101010';
        font(ctx, 30);
        ctx.fillText('128k', w / 2, h / 2);
        break;
      case 4:
        palette.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.moveTo(8 + i * 34, h * 0.3);
          ctx.lineTo(30 + i * 34, h * 0.5);
          ctx.lineTo(8 + i * 34, h * 0.7);
          ctx.closePath();
          ctx.fill();
        });
        break;
      default:
        ctx.fillStyle = '#ff5f3a';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, h * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        font(ctx, 28, true);
        ctx.fillText('EOS', w / 2, h / 2);
        break;
    }
    return;
  }
  // inference
  switch (k) {
    case 0:
      ctx.strokeStyle = '#1a1024';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.56, h * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#1a1024';
      ctx.fillRect(w / 2 - 8, h * 0.05, 16, 12);
      ctx.fillStyle = '#ff7a1a';
      font(ctx, 20, true);
      ctx.fillText('900ms', w / 2, h * 0.58);
      break;
    case 1:
      ctx.fillStyle = '#ffd400';
      ctx.beginPath();
      ctx.moveTo(w * 0.55, 6);
      ctx.lineTo(w * 0.3, h * 0.55);
      ctx.lineTo(w * 0.5, h * 0.55);
      ctx.lineTo(w * 0.42, h - 6);
      ctx.lineTo(w * 0.72, h * 0.4);
      ctx.lineTo(w * 0.52, h * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    case 2:
      ctx.fillStyle = '#f5e6c8';
      ctx.fillRect(6, h * 0.2, w - 12, h * 0.6);
      ctx.strokeStyle = '#1a1024';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 3;
      ctx.strokeRect(6, h * 0.2, w - 12, h * 0.6);
      ctx.setLineDash([]);
      ctx.fillStyle = '#1a1024';
      font(ctx, 20, true);
      ctx.fillText('batch 1', w / 2, h / 2);
      break;
    case 3:
      ctx.fillStyle = '#222';
      roundRect(ctx, 6, h * 0.35, w - 12, h * 0.3, 8);
      ctx.fill();
      ctx.fillStyle = '#4bff7a';
      roundRect(ctx, 8, h * 0.37, (w - 16) * 0.99, h * 0.26, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      font(ctx, 16, true);
      ctx.fillText('99%', w / 2, h * 0.5);
      break;
    case 4:
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.moveTo(w / 2, 6);
      ctx.bezierCurveTo(w * 0.85, h * 0.4, w * 0.8, h * 0.9, w / 2, h - 6);
      ctx.bezierCurveTo(w * 0.2, h * 0.9, w * 0.15, h * 0.4, w / 2, 6);
      ctx.fill();
      ctx.fillStyle = '#ffd400';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.68, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = '#1d6b3a';
      roundRect(ctx, 4, h * 0.22, w - 8, h * 0.56, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      font(ctx, 26, true);
      ctx.fillText('OK 200', w / 2, h / 2);
      break;
  }
}

/** Draw sticker `index` of `sheet` into a w x h box at the origin. */
export function drawSticker(ctx: Ctx, sheet: StickerSheetId, index: number, w: number, h: number): void {
  ctx.save();
  if (sheet === 'labA' || sheet === 'labB' || sheet === 'chip') brandSticker(ctx, sheet, index, w, h);
  else themeSticker(ctx, sheet, index, w, h);
  ctx.restore();
}

/** A thumbnail canvas for the Board Lab sticker picker. */
export function renderStickerThumb(sheet: StickerSheetId, index: number, w = STICKER_W, h = STICKER_H): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  drawSticker(ctxOf(c), sheet, index, w, h);
  return c;
}

/** Label for a sheet (brand sheets through BRANDS). */
export function sheetLabel(sheet: StickerSheetId): string {
  return stickerSheetLabel(sheet);
}

// ---------------------------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------------------------

/** Draw one placed sticker onto a deck-face canvas (u along x, v along y). */
export function drawPlacedSticker(ctx: Ctx, w: number, h: number, s: StickerPlacement): void {
  ctx.save();
  ctx.translate(s.u * w, s.v * h);
  ctx.rotate((s.rotDeg * Math.PI) / 180);
  ctx.translate(-STICKER_W / 2, -STICKER_H / 2);
  // A light paper edge under every sticker so it reads as a sticker.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  roundRect(ctx, -3, -3, STICKER_W + 6, STICKER_H + 6, 10);
  ctx.fill();
  drawSticker(ctx, s.sheet, s.index, STICKER_W, STICKER_H);
  ctx.restore();
}

/** The deck underside: graphic plus stickers. */
export function renderDeckBottom(config: BoardConfig, w = DECK_W, h = DECK_H): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  drawDeckGraphic(ctx, w, h, config.deckGraphic);
  for (const s of config.stickers) drawPlacedSticker(ctx, w, h, s);
  return c;
}

/** The deck top: grip over wood. */
export function renderDeckTop(grip: GripId, w = DECK_W, h = DECK_H): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  drawGrip(ctxOf(c), w, h, grip);
  return c;
}

/** The plywood edge strip. */
export function renderPlies(w = 64, h = 32): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  drawPlies(ctxOf(c), w, h);
  return c;
}

/** Kernel Panic: the deck bottom becomes a blue screen (SPEC §9.1, REQ-FX-02). */
export const BLUE_SCREEN_LINES: readonly string[] = [
  'KERNEL PANIC',
  'Your board ran into a problem and needs to restart.',
  'Collecting error info: 0% complete',
  'Stop code: LANDING_NOT_FOUND',
];

export function drawBlueScreen(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#0a3bd6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  font(ctx, 150, false, 700);
  ctx.fillText(':(', w * 0.04, h * 0.5);
  BLUE_SCREEN_LINES.forEach((line, i) => {
    font(ctx, i === 0 ? 44 : 22, true, i === 0 ? 700 : 500);
    ctx.fillText(line, w * 0.3, h * 0.22 + i * (i === 0 ? 0.24 : 0.2) * h * 0.9);
  });
}

export function renderBlueScreen(w = DECK_W, h = DECK_H): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  drawBlueScreen(ctxOf(c), w, h);
  return c;
}

/** Wheel side cap: a colour ring and the durometer label (REQ-LAB-01 "colour and durometer label"). */
export function renderWheelCap(color: string, label: string, size = 96): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctxOf(c);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#5a5a60';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  font(ctx, 18, false, 800);
  ctx.fillText(label, size / 2, size * 0.8);
  return c;
}

/** Fonts used, exported for tests: system stacks only (no CDN). */
export const FONT_STACKS = [SANS, MONO];
