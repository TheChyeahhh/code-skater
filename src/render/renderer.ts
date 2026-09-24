/**
 * src/render/renderer.ts (render track): WebGLRenderer setup (REQ-REN-01, REQ-REN-07).
 * outputColorSpace SRGB, toneMapping AgX (ACESFilmic when AgX is unavailable), exposure
 * TUNING.RENDER_EXPOSURE (the post chain re-reads it each frame), PCF shadows (three 0.186 removed
 * PCFSoftShadowMap: it warns and falls back to PCFShadowMap, which is the soft-filtered path now),
 * pixel ratio capped by the preset. antialias is off: SMAA in the post chain does the anti-aliasing
 * and the composer draws into its own HDR buffer, so canvas MSAA would cost and show nothing.
 * Every resize publishes the drawing-buffer size to src/render/lib/viewport.ts (the rail inflate
 * needs the pixel size, REQ-MAT-02).
 *
 * Shader diagnostics (renderer.debug.checkShaderErrors) are on in dev builds only.
 *
 * rendererConfig() is the pure part (render.test checks it without a WebGL context).
 */

import { ACESFilmicToneMapping, AgXToneMapping, PCFShadowMap, SRGBColorSpace, Vector2, WebGLRenderer, type ToneMapping } from 'three';
import { TUNING } from '../core/tuning';
import { setViewportSize } from './lib/viewport';
import type { GameRenderer, QualitySettings } from './types';

export type ToneMappingName = 'agx' | 'acesFilmic';

export interface RendererConfig {
  readonly toneMapping: ToneMapping;
  readonly toneMappingName: ToneMappingName;
  readonly outputColorSpace: string;
  readonly exposure: number;
  readonly pixelRatio: number;
  readonly shadowMapType: number;
}

/** AgX when this three build has it, else ACESFilmic (REQ-REN-01). */
export function pickToneMapping(agxAvailable: boolean = typeof AgXToneMapping === 'number'): { readonly id: ToneMapping; readonly name: ToneMappingName } {
  return agxAvailable ? { id: AgXToneMapping, name: 'agx' } : { id: ACESFilmicToneMapping, name: 'acesFilmic' };
}

/** min(devicePixelRatio, preset cap) (REQ-REN-05, REQ-REN-07). */
export function pixelRatioFor(devicePixelRatio: number, quality: QualitySettings): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, quality.pixelRatioCap);
}

/** The renderer settings for a preset, as data. */
export function rendererConfig(quality: QualitySettings, devicePixelRatio: number, agxAvailable?: boolean): RendererConfig {
  const tm = pickToneMapping(agxAvailable);
  return {
    toneMapping: tm.id,
    toneMappingName: tm.name,
    outputColorSpace: SRGBColorSpace,
    exposure: TUNING.RENDER_EXPOSURE,
    pixelRatio: pixelRatioFor(devicePixelRatio, quality),
    shadowMapType: PCFShadowMap,
  };
}

export function createGameRenderer(canvas: HTMLCanvasElement, quality: QualitySettings): GameRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
    alpha: false,
  });
  // Shader diagnostics only in dev: in a production build a program link check is a synchronous GL
  // round trip per new program, and its HLSL notes are noise to a player (REQ-REN-06).
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  let current = quality;
  const publishSize = (): void => {
    const size = renderer.getDrawingBufferSize(new Vector2());
    setViewportSize(size.x, size.y);
  };
  const apply = (q: QualitySettings): void => {
    const cfg = rendererConfig(q, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = cfg.toneMapping;
    renderer.toneMappingExposure = cfg.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.setPixelRatio(cfg.pixelRatio);
  };
  apply(current);
  const handle: GameRenderer = {
    renderer,
    canvas,
    get quality() {
      return current;
    },
    setQuality(q) {
      current = q;
      apply(q);
      // Re-apply the current CSS size so the drawing buffer picks up the new pixel ratio.
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      renderer.setSize(w, h, false);
      publishSize();
    },
    resize(width, height) {
      renderer.setSize(width, height, false);
      publishSize();
    },
    dispose() {
      renderer.dispose();
    },
  };
  return handle;
}
