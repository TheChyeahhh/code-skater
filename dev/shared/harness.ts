/**
 * dev/shared/harness.ts (integration): helpers for the per-track dev harness pages (dev/<track>.html).
 * Serve with "npx vite --port <track port> --strictPort" and open http://localhost:<port>/dev/<track>.html,
 * screenshot with "node scripts/shot.mjs <url> <out.png>". Harness code never ships (not in the build).
 */

import {
  AmbientLight, Color, DirectionalLight, GridHelper, HemisphereLight, PerspectiveCamera, SRGBColorSpace, Scene,
  WebGLRenderer, ACESFilmicToneMapping, AgXToneMapping,
} from 'three';
import { isNotImplemented } from '../../src/core/contract';

export interface HarnessPanel {
  readonly root: HTMLElement;
  /** Replace the status lines. */
  setStatus(lines: readonly string[]): void;
  /** Append a line to the scrolling log (newest first, capped). */
  log(line: string): void;
}

const PANEL_CSS = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0d12; color: #e8ebf2;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
  canvas.harness-canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
  .harness-panel { position: fixed; top: 12px; left: 12px; max-width: 46vw; padding: 10px 14px; border-radius: 8px;
    background: rgba(10, 12, 18, 0.78); font-size: 13px; line-height: 1.45; pointer-events: auto; }
  .harness-panel h1 { margin: 0 0 4px; font-size: 15px; letter-spacing: 0.04em; }
  .harness-panel .status { white-space: pre; font-family: ui-monospace, Consolas, 'Courier New', monospace; font-size: 12px; }
  .harness-panel .log { margin-top: 6px; max-height: 30vh; overflow: hidden; font-family: ui-monospace, Consolas, 'Courier New', monospace; font-size: 11px; color: #9aa3b5; white-space: pre; }
  .harness-panel .warn { color: #ffb020; }
`;

/** Title panel in the top-left corner. */
export function mountPanel(title: string, notes: readonly string[] = []): HarnessPanel {
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'harness-panel';
  const h = document.createElement('h1');
  h.textContent = title;
  root.append(h);
  for (const n of notes) {
    const p = document.createElement('div');
    p.textContent = n;
    root.append(p);
  }
  const status = document.createElement('div');
  status.className = 'status';
  const log = document.createElement('div');
  log.className = 'log';
  root.append(status, log);
  document.body.append(root);
  const lines: string[] = [];
  return {
    root,
    setStatus(next) {
      status.textContent = next.join('\n');
    },
    log(line) {
      lines.unshift(line);
      if (lines.length > 14) lines.length = 14;
      log.textContent = lines.join('\n');
    },
  };
}

/** Add a highlighted "not implemented yet" note to a panel. */
export function noteFallback(panel: HarnessPanel, what: string): void {
  const p = document.createElement('div');
  p.className = 'warn';
  p.textContent = `${what}: not implemented yet, showing the placeholder.`;
  panel.root.append(p);
}

/** Try a factory; null when it throws notImplemented (other errors propagate). */
export function tryBuild<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    if (isNotImplemented(err)) return null;
    throw err;
  }
}

export interface BasicScene {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  render(): void;
}

/** A full-window renderer, scene, camera, lights and a ground grid, resized with the window. */
export function createBasicScene(background = '#1c2230'): BasicScene {
  const canvas = document.createElement('canvas');
  canvas.className = 'harness-canvas';
  document.body.prepend(canvas);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = typeof AgXToneMapping === 'number' ? AgXToneMapping : ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene();
  scene.background = new Color(background);
  scene.add(new HemisphereLight('#dfe8ff', '#3a3228', 0.8));
  scene.add(new AmbientLight('#ffffff', 0.15));
  const sun = new DirectionalLight('#fff1d6', 2.0);
  sun.position.set(-8, 14, 6);
  scene.add(sun);
  const grid = new GridHelper(40, 40, '#46506a', '#2b3244');
  grid.position.set(20, 0, 20);
  scene.add(grid);
  const camera = new PerspectiveCamera(60, 16 / 9, 0.05, 500);
  camera.position.set(20, 6, 34);
  camera.lookAt(20, 0.8, 20);
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  return { canvas, renderer, scene, camera, render: () => renderer.render(scene, camera) };
}

/** requestAnimationFrame loop with dt in seconds (clamped to 0.1 s). */
export function startFrames(onFrame: (dtS: number, frame: number) => void): void {
  let last = performance.now();
  let frame = 0;
  const step = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    onFrame(dt, frame);
    frame += 1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Mark the page ready for scripts/shot.mjs after `frames` frames of startFrames (call once per frame). */
export function shotReadyAt(frame: number, frames = 10): void {
  if (frame === frames) window.__shotReady = true;
}
