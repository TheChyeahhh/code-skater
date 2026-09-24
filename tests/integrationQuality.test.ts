// tests/integrationQuality.test.ts (integration): the "auto" quality probe is decided by the steady
// frame rate, not by a stall inside its window (polish round 1: the park build and first-draw shader
// links landed inside the 2 s probe and an RTX 5070 picked Low). A long task never decides the preset.
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import { autoQuality, medianFps, probeFps } from '../src/render/quality';

afterEach(() => resetTuning());

/** A fake clock whose frames take the listed times (ms), then `rest` ms each. */
function scripted(first: readonly number[], rest: number): { renderFrame: () => void; now: () => number; schedule: (cb: () => void) => void } {
  let t = 0;
  let n = 0;
  return {
    renderFrame: () => {
      // The untimed warm-up frame (n = 0) is instant; timed frames follow the script.
      if (n > 0) t += first[n - 1] ?? rest;
      n += 1;
    },
    now: () => t,
    schedule: (cb) => queueMicrotask(cb),
  };
}

describe('REQ-REN-05 probe vs long tasks', () => {
  it('one 1500 ms frame followed by 16 ms frames is still Ultra', async () => {
    const w = scripted([1500], 16);
    expect((await autoQuality('auto', w.renderFrame, w.now, w.schedule)).id).toBe('ultra');
  });

  it('several 250 ms shader-link stalls among 60 fps frames are ignored', async () => {
    const w = scripted([250, 16, 16, 300, 16, 400, 16, 16, 16, 250], 1000 / 60);
    expect(await probeFps(w.renderFrame, w.now, w.schedule)).toBeCloseTo(60, 0);
  });

  it('a steady slow machine still measures slow: 25 fps is Low, 40 fps is Med', async () => {
    const slow = scripted([], 40);
    expect((await autoQuality('auto', slow.renderFrame, slow.now, slow.schedule)).id).toBe('low');
    const med = scripted([], 25);
    expect((await autoQuality('auto', med.renderFrame, med.now, med.schedule)).id).toBe('med');
  });

  it('medianFps: empty is 0, odd and even counts take the middle', () => {
    expect(medianFps([])).toBe(0);
    expect(medianFps([10, 20, 1000])).toBeCloseTo(50, 9);
    expect(medianFps([10, 20, 30, 40])).toBeCloseTo(40, 9);
  });

  it('the drop threshold is live: at 2000 ms the stall counts again and the median is untouched', async () => {
    TUNING.INT_PROBE_DROP_FRAME_MS = 2000;
    const w = scripted([1500], 16);
    expect((await autoQuality('auto', w.renderFrame, w.now, w.schedule)).id).toBe('ultra');
  });
});
