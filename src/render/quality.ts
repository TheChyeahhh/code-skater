/**
 * src/render/quality.ts (render track): quality presets and the first-load FPS probe (REQ-REN-05).
 * Low / Med / High / Ultra: pixel ratio cap PIXEL_RATIO_CAPS, shadow SHADOW_MAP_SIZES, AO off/on/on/on,
 * bloom off/on/on/on, SMAA on everywhere (it is the only anti-aliasing: canvas MSAA is off).
 * Probe FPS_PROBE_S seconds: >= QUALITY_FPS_ULTRA Ultra, >= HIGH High, >= MED Med, else Low.
 * SwiftShader (headless tests) lands on Low.
 *
 * The Options screen sets a preset by calling renderer.setQuality(q), post.setQuality(q),
 * lighting.setQuality(q) and fx.setQuality(q) with q = qualitySettings(id); "auto" runs
 * autoQuality() once and then does the same.
 */

import { PIXEL_RATIO_CAPS, SHADOW_MAP_SIZES, TUNING } from '../core/tuning';
import type { QualityOption, QualityPresetId } from '../core/types';
import type { QualitySettings } from './types';

export const QUALITY_PRESET_IDS: readonly QualityPresetId[] = ['low', 'med', 'high', 'ultra'];

const PRESET_INDEX: Readonly<Record<QualityPresetId, 0 | 1 | 2 | 3>> = { low: 0, med: 1, high: 2, ultra: 3 };

export function qualitySettings(id: QualityPresetId): QualitySettings {
  const i = PRESET_INDEX[id];
  return {
    id,
    pixelRatioCap: PIXEL_RATIO_CAPS[i],
    shadowMapSize: SHADOW_MAP_SIZES[i],
    ao: i >= 1,
    bloom: i >= 1,
    smaa: true,
  };
}

/** Preset for a measured average FPS (thresholds read live from TUNING). */
export function presetForFps(fps: number): QualityPresetId {
  if (!Number.isFinite(fps)) return 'low';
  if (fps >= TUNING.QUALITY_FPS_ULTRA) return 'ultra';
  if (fps >= TUNING.QUALITY_FPS_HIGH) return 'high';
  if (fps >= TUNING.QUALITY_FPS_MED) return 'med';
  return 'low';
}

export type FrameScheduler = (cb: () => void) => void;

function defaultScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === 'function') return (cb) => requestAnimationFrame(() => cb());
  return (cb) => setTimeout(cb, 0);
}

/**
 * Render frames for FPS_PROBE_S seconds of wall time and report the FPS of the MEDIAN frame
 * interval, ignoring intervals longer than INT_PROBE_DROP_FRAME_MS (a long task: a shader link, a
 * texture bake, a GC pause), so one stall inside the window cannot decide the preset (polish round 1:
 * a 1.5 s park-build stall made an RTX 5070 read 20 fps and pick Low). All frames dropped = 0 fps.
 * renderFrame draws one frame; now() is milliseconds (performance.now in the browser).
 * The first frame is drawn but not timed (shader compiles land there). schedule defaults to
 * requestAnimationFrame; tests inject a synchronous scheduler.
 */
export function probeFps(renderFrame: () => void, now: () => number, schedule: FrameScheduler = defaultScheduler()): Promise<number> {
  return new Promise((resolve) => {
    const lengthMs = TUNING.FPS_PROBE_S * 1000;
    renderFrame();
    const start = now();
    let last = start;
    const intervals: number[] = [];
    const step = (): void => {
      renderFrame();
      const t = now();
      const dt = t - last;
      last = t;
      if (dt > 0 && dt <= TUNING.INT_PROBE_DROP_FRAME_MS) intervals.push(dt);
      if (t - start >= lengthMs) {
        resolve(medianFps(intervals));
        return;
      }
      schedule(step);
    };
    schedule(step);
  });
}

/** FPS of the median of the frame intervals (ms); no intervals = 0. */
export function medianFps(intervalsMs: readonly number[]): number {
  if (intervalsMs.length === 0) return 0;
  const s = [...intervalsMs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const m = s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  return m > 0 ? 1000 / m : 0;
}

/** Resolve a GameOptions quality choice: a preset id as is, "auto" through the probe. */
export async function autoQuality(option: QualityOption, renderFrame: () => void, now: () => number, schedule?: FrameScheduler): Promise<QualitySettings> {
  if (option !== 'auto') return qualitySettings(option);
  const fps = await probeFps(renderFrame, now, schedule);
  return qualitySettings(presetForFps(fps));
}
