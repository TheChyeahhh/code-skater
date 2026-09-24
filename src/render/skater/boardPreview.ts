/**
 * src/render/skater/boardPreview.ts (skater track): the Board Lab turntable (REQ-LAB-01). Mounts its
 * own small canvas and renderer inside the container the UI gives it, spins at TURNTABLE_DPS, takes
 * nudges from the right stick, flips to show the underside, and draws the REQ-LAB-03 sticker cursor
 * ring and the provisional sticker on the underside in 3D (setCursor / setPreviewSticker), so they
 * follow the turntable. The UI never imports three.js.
 */

import {
  ACESFilmicToneMapping, AgXToneMapping, AmbientLight, Box3, CanvasTexture, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer, type Object3D,
} from 'three';
import { TUNING } from '../../core/tuning';
import type { BoardConfig, StickerPlacement, Vec2 } from '../../core/types';
import type { BoardPreviewHost } from '../types';
import { renderStickerThumb, STICKER_H, STICKER_W } from './boardArt';
import { createBoardModel } from './board';
import { DECK } from './deckGeometry';

const DEG = Math.PI / 180;

/** Sticker footprint on the deck in metres (matches STICKER_W / DECK_W of the texture). */
const STICKER_M_W = (STICKER_W / 1024) * DECK.length;
const STICKER_M_H = (STICKER_H / 256) * DECK.width;

/** Margin around the deck in the preview frame (fraction of its bounding radius). */
export const PREVIEW_FIT_MARGIN = 0.12;
/** Direction from the deck to the preview camera (a three-quarter view from above the nose side). */
const PREVIEW_VIEW_DIR = new Vector3(0.45, 0.55, 0.95).normalize();

/**
 * Camera distance that keeps a sphere of `radius` (plus the margin) inside a perspective frame of
 * vertical field of view `vfovDeg` at `aspect` (width / height): the tighter of the two half-angles
 * decides. The turntable yaw and the flip both rotate about the origin, so a sphere about the origin
 * that holds the deck at rest holds it at every angle.
 */
export function fitPreviewDistance(radius: number, vfovDeg: number, aspect: number, margin = PREVIEW_FIT_MARGIN): number {
  const half = (vfovDeg * Math.PI) / 360;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const halfH = Math.atan(Math.tan(half) * a);
  return (radius * (1 + margin)) / Math.sin(Math.min(half, halfH));
}

/** Farthest point of the object's bounding box from the origin (the rotation centre). */
function radiusAboutOrigin(o: Object3D): number {
  o.updateMatrixWorld(true);
  const box = new Box3().setFromObject(o);
  let r = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) r = Math.max(r, Math.hypot(x, y, z));
  return r;
}

/** Underside point for StickerPlacement coordinates (u 0 tail .. 1 nose, v 0 .. 1 across). */
function undersidePoint(u: number, v: number, lift: number): { x: number; y: number; z: number } {
  return { x: (v - 0.5) * DECK.width, y: -DECK.thickness - lift, z: DECK.length / 2 - u * DECK.length };
}

export function createBoardPreview(initial: BoardConfig): BoardPreviewHost {
  const scene = new Scene();
  scene.background = null;
  const camera = new PerspectiveCamera(32, 1, 0.05, 20);
  scene.add(new HemisphereLight('#e6ecff', '#3a3228', 0.9));
  scene.add(new AmbientLight('#ffffff', 0.2));
  const key = new DirectionalLight('#fff1d6', 2.2);
  key.position.set(1.5, 2.5, 1.2);
  scene.add(key);
  const fill = new DirectionalLight('#9fb8ff', 0.8);
  fill.position.set(-2, -1.5, -1);
  scene.add(fill);

  const turntable = new Group();
  scene.add(turntable);
  const board = createBoardModel(initial);
  turntable.add(board.group);
  const deckRadius = radiusAboutOrigin(board.group);
  const fitCamera = (aspect: number): void => {
    camera.aspect = aspect;
    camera.position.copy(PREVIEW_VIEW_DIR).multiplyScalar(fitPreviewDistance(deckRadius, camera.fov, aspect));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  fitCamera(1);

  // Cursor ring and preview sticker live under the deck.
  const ring = new Mesh(new TorusGeometry(0.03, 0.004, 8, 24), new MeshBasicMaterial({ color: '#7dff5a' }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  board.group.add(ring);
  const previewMat = new MeshBasicMaterial({ transparent: true, opacity: 0.85, side: DoubleSide });
  const preview = new Mesh(new PlaneGeometry(STICKER_M_W, STICKER_M_H), previewMat);
  preview.visible = false;
  board.group.add(preview);
  let previewTex: CanvasTexture | null = null;

  let renderer: WebGLRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let container: HTMLElement | null = null;
  let raf = 0;
  let last = 0;
  let yaw = 0;
  let nudgeDeg = 0;
  let flipTarget = 0;
  let flipAngle = 0;
  let observer: ResizeObserver | null = null;

  const resize = (): void => {
    if (!renderer || !container) return;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    fitCamera(w / h);
  };

  const frame = (now: number): void => {
    if (!renderer) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    yaw += (TUNING.TURNTABLE_DPS * dt + nudgeDeg) * DEG;
    nudgeDeg = 0;
    // Flip eases toward its target over about 0.4 s.
    flipAngle += (flipTarget - flipAngle) * Math.min(1, dt * 8);
    turntable.rotation.set(0, yaw, 0);
    board.group.rotation.set(0, 0, flipAngle);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };

  return {
    mount(target) {
      if (container) this.unmount();
      container = target;
      canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      container.append(canvas);
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = typeof AgXToneMapping === 'number' ? AgXToneMapping : ACESFilmicToneMapping;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(new Color('#000000'), 0);
      resize();
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(resize);
        observer.observe(container);
      }
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    setConfig(config) {
      board.setConfig(config);
    },
    nudge(yawDeg) {
      nudgeDeg += yawDeg;
    },
    flip() {
      flipTarget = flipTarget === 0 ? Math.PI : 0;
    },
    setCursor(uv: Vec2 | null) {
      if (!uv) {
        ring.visible = false;
        return;
      }
      const p = undersidePoint(uv.x, uv.y, 0.004);
      ring.position.set(p.x, p.y, p.z);
      ring.visible = true;
    },
    setPreviewSticker(sticker: StickerPlacement | null) {
      if (!sticker) {
        preview.visible = false;
        return;
      }
      previewTex?.dispose();
      previewTex = new CanvasTexture(renderStickerThumb(sticker.sheet, sticker.index));
      previewTex.colorSpace = SRGBColorSpace;
      previewMat.map = previewTex;
      previewMat.needsUpdate = true;
      const p = undersidePoint(sticker.u, sticker.v, 0.003);
      preview.position.set(p.x, p.y, p.z);
      // Lie flat under the deck, long side along the deck, then the placement rotation.
      preview.rotation.set(Math.PI / 2, 0, 0);
      preview.rotateZ(Math.PI / 2 + sticker.rotDeg * DEG);
      preview.visible = true;
    },
    unmount() {
      cancelAnimationFrame(raf);
      raf = 0;
      observer?.disconnect();
      observer = null;
      renderer?.dispose();
      renderer = null;
      canvas?.remove();
      canvas = null;
      container = null;
    },
  };
}
