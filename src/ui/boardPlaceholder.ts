/**
 * src/ui/boardPlaceholder.ts (ui track): a 2D Canvas turntable that stands in for the skater track's
 * 3D BoardPreviewHost when the UI runs without one (harness, or the skater factory still a stub). It
 * honours the same contract so the Board Lab screen has one code path: setConfig, nudge, flip, the
 * sticker cursor and the provisional sticker. Rendering is a top-down deck squashed by cos(yaw) to
 * read as a turntable; the underside shows the graphic and the stickers, the top shows the grip.
 */

import { TUNING } from '../core/tuning';
import type { BoardConfig, StickerPlacement, Vec2 } from '../core/types';
import type { BoardPreviewHost } from '../render/types';
import { DECK_GRAPHIC_COLORS, drawDeckGraphic, drawSticker, GRIP_COLORS, STICKER_ACROSS, STICKER_ALONG, STICKER_THUMB_H, STICKER_THUMB_W, TRUCK_COLORS, WHEEL_COLORS } from './labArt';

const DECK_W = 0.24;
const DECK_L = 0.82;

export interface BoardPlaceholder extends BoardPreviewHost {
  /** Advance the turntable (TURNTABLE_DPS) and redraw. */
  update(dtS: number): void;
  readonly yawDeg: number;
  readonly showingBottom: boolean;
}

export function createBoardPlaceholder(): BoardPlaceholder {
  const canvas = document.createElement('canvas');
  canvas.className = 'lab__placeholder';
  let g: CanvasRenderingContext2D | null = null;
  let host: HTMLElement | null = null;
  let config: BoardConfig | null = null;
  let yaw = 20;
  // Starts on the top (grip) face like the skater track's 3D host; flip() toggles.
  let bottom = false;
  let cursor: Vec2 | null = null;
  let preview: StickerPlacement | null = null;
  const stickerCache = new Map<string, HTMLCanvasElement>();
  const graphicCache = new Map<number, HTMLCanvasElement>();

  const stickerImage = (s: StickerPlacement): HTMLCanvasElement => {
    const key = `${s.sheet}:${s.index}`;
    let c = stickerCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = STICKER_THUMB_W;
      c.height = STICKER_THUMB_H;
      const cg = c.getContext('2d');
      if (cg) drawSticker(cg, s.sheet, s.index, STICKER_THUMB_W, STICKER_THUMB_H);
      stickerCache.set(key, c);
    }
    return c;
  };

  const graphicImage = (index: number): HTMLCanvasElement => {
    let c = graphicCache.get(index);
    if (!c) {
      c = document.createElement('canvas');
      c.width = 96;
      c.height = 320;
      const cg = c.getContext('2d');
      if (cg) drawDeckGraphic(cg, index, 96, 320);
      graphicCache.set(index, c);
    }
    return c;
  };

  const deckPath = (ctx: CanvasRenderingContext2D, w: number, l: number): void => {
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -l / 2 + r);
    ctx.quadraticCurveTo(-w / 2, -l / 2, 0, -l / 2);
    ctx.quadraticCurveTo(w / 2, -l / 2, w / 2, -l / 2 + r);
    ctx.lineTo(w / 2, l / 2 - r);
    ctx.quadraticCurveTo(w / 2, l / 2, 0, l / 2);
    ctx.quadraticCurveTo(-w / 2, l / 2, -w / 2, l / 2 - r);
    ctx.closePath();
  };

  const draw = (): void => {
    if (!g || !host) return;
    const c2 = g;
    const W = host.clientWidth || 480;
    const H = host.clientHeight || 360;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    g.clearRect(0, 0, W, H);
    // Turntable disc.
    const cx = W / 2;
    const cy = H * 0.55;
    const disc = Math.min(W, H) * 0.42;
    const grad = g.createRadialGradient(cx, cy, disc * 0.2, cx, cy, disc);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(cx, cy, disc, disc * 0.35, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(53,224,255,0.35)';
    g.lineWidth = 2;
    g.stroke();

    const scale = Math.min(W, H) * 0.95;
    const w = DECK_W * scale;
    const l = DECK_L * scale;
    const rad = (yaw * Math.PI) / 180;
    g.save();
    g.translate(cx, cy - H * 0.12);
    g.rotate(Math.PI / 2 + 0.35 * Math.sin(rad));
    g.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(rad)));
    // Shadow.
    g.save();
    g.translate(8, 14);
    deckPath(g, w, l);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fill();
    g.restore();
    const cfg = config;
    if (bottom) {
      // Underside: graphic, then stickers, then the cursor.
      g.save();
      deckPath(g, w, l);
      g.clip();
      g.fillStyle = cfg ? (DECK_GRAPHIC_COLORS[cfg.deckGraphic] ?? '#333') : '#333';
      g.fillRect(-w / 2, -l / 2, w, l);
      if (cfg) g.drawImage(graphicImage(cfg.deckGraphic), -w / 2, -l / 2, w, l);
      const stickers = [...(cfg ? cfg.stickers : []), ...(preview ? [preview] : [])];
      stickers.forEach((s, k) => {
        const isPreview = preview !== null && k === stickers.length - 1;
        // The long side runs along the deck (a quarter turn on this vertical deck), sized like the in-game texture.
        const sw = l * STICKER_ALONG;
        const sh = w * STICKER_ACROSS;
        c2.save();
        // u along the length (0 tail at +y, 1 nose at -y), v across.
        c2.translate((s.v - 0.5) * w, (0.5 - s.u) * l);
        c2.rotate(-Math.PI / 2 + (s.rotDeg * Math.PI) / 180);
        if (isPreview) c2.globalAlpha = 0.75;
        c2.drawImage(stickerImage(s), -sw / 2, -sh / 2, sw, sh);
        c2.restore();
      });
      if (cursor) {
        // Contract coordinates: cursor.x = u along the length, cursor.y = v across.
        g.save();
        g.translate((cursor.y - 0.5) * w, (0.5 - cursor.x) * l);
        g.strokeStyle = '#f2ff3d';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(0, 0, w * 0.18, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(-w * 0.26, 0);
        g.lineTo(w * 0.26, 0);
        g.moveTo(0, -w * 0.26);
        g.lineTo(0, w * 0.26);
        g.stroke();
        g.restore();
      }
      g.restore();
      // Trucks and wheels under the deck.
      for (const side of [-1, 1]) {
        const ty = side * l * 0.3;
        g.fillStyle = cfg ? TRUCK_COLORS[cfg.trucks] : '#999';
        g.fillRect(-w * 0.55, ty - 5, w * 1.1, 10);
        g.fillStyle = cfg ? WHEEL_COLORS[cfg.wheels] : '#eee';
        for (const wx of [-w * 0.6, w * 0.6]) {
          g.beginPath();
          g.ellipse(wx, ty, w * 0.13, w * 0.1, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else {
      deckPath(g, w, l);
      g.fillStyle = cfg ? GRIP_COLORS[cfg.grip] : '#222';
      g.fill();
      if (cfg?.grip === 'dieCut') {
        g.fillStyle = '#c9b58f';
        g.beginPath();
        g.moveTo(0, -l * 0.2);
        g.lineTo(w * 0.3, 0);
        g.lineTo(0, l * 0.2);
        g.lineTo(-w * 0.3, 0);
        g.closePath();
        g.fill();
      }
    }
    deckPath(g, w, l);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  };

  return {
    mount(container) {
      host = container;
      container.append(canvas);
      try {
        g = canvas.getContext('2d');
      } catch {
        g = null;
      }
      draw();
    },
    setConfig(c) {
      config = c;
      draw();
    },
    nudge(deg) {
      yaw = (yaw + deg) % 360;
      draw();
    },
    flip() {
      bottom = !bottom;
      draw();
    },
    setCursor(uv) {
      cursor = uv;
      draw();
    },
    setPreviewSticker(s) {
      preview = s;
      draw();
    },
    unmount() {
      canvas.remove();
      host = null;
      g = null;
    },
    update(dtS) {
      yaw = (yaw + TUNING.TURNTABLE_DPS * dtS) % 360;
      draw();
    },
    get yawDeg() {
      return yaw;
    },
    get showingBottom() {
      return bottom;
    },
  };
}
