// tests/quality.test.ts (render track): quality presets and the FPS probe (REQ-REN-05).
import { describe, expect, it } from 'vitest';
import { PIXEL_RATIO_CAPS, SHADOW_MAP_SIZES, TUNING } from '../src/core/tuning';
import { autoQuality, presetForFps, probeFps, QUALITY_PRESET_IDS, qualitySettings } from '../src/render/quality';

describe('REQ-REN-05 presets', () => {
  it('Low / Med / High / Ultra: shadow 1024/2048/2048/4096, AO off/on/on/on, ratio cap 1.0/1.25/1.5/2.0, bloom off/on/on/on', () => {
    expect(QUALITY_PRESET_IDS).toEqual(['low', 'med', 'high', 'ultra']);
    const rows = QUALITY_PRESET_IDS.map(qualitySettings);
    expect(rows.map((r) => r.shadowMapSize)).toEqual([1024, 2048, 2048, 4096]);
    expect(rows.map((r) => r.shadowMapSize)).toEqual([...SHADOW_MAP_SIZES]);
    expect(rows.map((r) => r.ao)).toEqual([false, true, true, true]);
    expect(rows.map((r) => r.pixelRatioCap)).toEqual([1.0, 1.25, 1.5, 2.0]);
    expect(rows.map((r) => r.pixelRatioCap)).toEqual([...PIXEL_RATIO_CAPS]);
    expect(rows.map((r) => r.bloom)).toEqual([false, true, true, true]);
    expect(rows.map((r) => r.id)).toEqual(QUALITY_PRESET_IDS);
    for (const r of rows) expect(r.smaa).toBe(true);
  });

  it('presetForFps: >= 55 Ultra, >= 45 High, >= 30 Med, else Low (thresholds read live)', () => {
    expect(presetForFps(60)).toBe('ultra');
    expect(presetForFps(55)).toBe('ultra');
    expect(presetForFps(54.9)).toBe('high');
    expect(presetForFps(45)).toBe('high');
    expect(presetForFps(44)).toBe('med');
    expect(presetForFps(30)).toBe('med');
    expect(presetForFps(29.9)).toBe('low');
    expect(presetForFps(0)).toBe('low');
    expect(presetForFps(Number.NaN)).toBe('low');
    const old = TUNING.QUALITY_FPS_ULTRA;
    TUNING.QUALITY_FPS_ULTRA = 58;
    expect(presetForFps(56)).toBe('high');
    TUNING.QUALITY_FPS_ULTRA = old;
  });
});

describe('REQ-REN-05 FPS probe', () => {
  /** A fake clock that advances msPerFrame every time a frame is rendered. */
  function fakeWorld(msPerFrame: number): { renderFrame: () => void; now: () => number; schedule: (cb: () => void) => void; frames: () => number } {
    let t = 0;
    let frames = 0;
    return {
      renderFrame: () => {
        frames += 1;
        t += msPerFrame;
      },
      now: () => t,
      schedule: (cb) => queueMicrotask(cb),
      frames: () => frames,
    };
  }

  it('runs FPS_PROBE_S seconds of frames and reports the average FPS', async () => {
    const w = fakeWorld(1000 / 60);
    const fps = await probeFps(w.renderFrame, w.now, w.schedule);
    expect(fps).toBeCloseTo(60, 0);
    // About 2 s x 60 fps frames (+1 untimed warm-up frame).
    expect(w.frames()).toBeGreaterThanOrEqual(TUNING.FPS_PROBE_S * 60);
    expect(w.frames()).toBeLessThanOrEqual(TUNING.FPS_PROBE_S * 60 + 2);
  });

  it('a slow machine measures low and lands on Low; a fast one on Ultra; explicit presets skip the probe', async () => {
    const slow = fakeWorld(1000 / 20);
    expect((await autoQuality('auto', slow.renderFrame, slow.now, slow.schedule)).id).toBe('low');
    const fast = fakeWorld(1000 / 144);
    expect((await autoQuality('auto', fast.renderFrame, fast.now, fast.schedule)).id).toBe('ultra');
    const never = fakeWorld(1);
    const q = await autoQuality('med', never.renderFrame, never.now, never.schedule);
    expect(q.id).toBe('med');
    expect(never.frames()).toBe(0);
  });
});
