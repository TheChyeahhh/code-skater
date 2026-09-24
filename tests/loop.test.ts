// tests/loop.test.ts (integration): fixed 120 Hz accumulator loop with a fake clock
// (REQ-TIM-01, REQ-TIM-04, REQ-SPC-05 time scale, REQ-FX-03 hitstop).
import { describe, expect, it } from 'vitest';
import { FixedLoop, RafDriver, type FrameScheduler } from '../src/core/loop';
import { createRng } from '../src/core/rng';

function counting(): { loop: FixedLoop; ticks: number[] } {
  const ticks: number[] = [];
  const loop = new FixedLoop({ onTick: (t) => ticks.push(t) });
  return { loop, ticks };
}

describe('FixedLoop', () => {
  it('REQ-TIM-01: 1000 frames of random dt run floor(sum x 120) ticks (within 1)', () => {
    const { loop, ticks } = counting();
    const rng = createRng(1234);
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const dt = rng.range(0.001, 0.05);
      sum += dt;
      const r = loop.frame(dt);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
    }
    expect(Math.abs(ticks.length - Math.floor(sum * 120))).toBeLessThanOrEqual(1);
    expect(loop.tick).toBe(ticks.length);
    expect(ticks.every((t, i) => t === i)).toBe(true);
    expect(loop.simTime).toBeCloseTo(loop.tick / 120, 12);
  });

  it('REQ-TIM-04: a 0.5 s frame is clamped to 0.1 s and never runs more than 12 ticks', () => {
    const { loop, ticks } = counting();
    const r = loop.frame(0.5);
    expect(r.steps).toBeLessThanOrEqual(12);
    expect(ticks.length).toBe(r.steps);
    expect(loop.maxStepsPerFrame()).toBe(12);
    for (let i = 0; i < 5; i++) expect(loop.frame(10).steps).toBeLessThanOrEqual(12);
  });

  it('exact tick-rate frames advance exactly one tick each', () => {
    const { loop } = counting();
    for (let i = 0; i < 240; i++) loop.frame(1 / 120);
    expect(Math.abs(loop.tick - 240)).toBeLessThanOrEqual(1);
  });

  it('pause stops ticks and alpha; resume continues', () => {
    const { loop } = counting();
    loop.frame(0.05);
    const t = loop.tick;
    const a = loop.alpha;
    loop.pause();
    expect(loop.frame(0.05).steps).toBe(0);
    expect(loop.tick).toBe(t);
    expect(loop.alpha).toBe(a);
    loop.resume();
    expect(loop.frame(0.05).steps).toBeGreaterThan(0);
  });

  it('REQ-SPC-05: time scale 0.6 runs 0.6 x the ticks of real time', () => {
    const { loop } = counting();
    loop.setTimeScale(0.6);
    for (let i = 0; i < 60; i++) loop.frame(1 / 60);
    expect(Math.abs(loop.tick - 72)).toBeLessThanOrEqual(1);
  });

  it('REQ-FX-03: freeze(7) swallows the next 7 ticks of time', () => {
    const { loop } = counting();
    loop.freeze(7);
    const r = loop.frame(10 / 120);
    expect(r.frozen).toBe(7);
    expect(r.steps).toBe(3);
    expect(loop.frozenTicks).toBe(0);
  });

  it('stepTicks(n) runs exactly n ticks even while paused', () => {
    const { loop, ticks } = counting();
    loop.pause();
    loop.stepTicks(5);
    expect(ticks).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('RafDriver with a fake clock', () => {
  it('turns scheduled frames into loop time', () => {
    const { loop } = counting();
    let now = 0;
    let pending: (() => void) | null = null;
    const scheduler: FrameScheduler = {
      request: (cb) => {
        pending = cb;
        return 1;
      },
      cancel: () => {
        pending = null;
      },
    };
    const frames: number[] = [];
    const driver = new RafDriver(loop, { clock: { now: () => now }, scheduler, onFrame: (r) => frames.push(r.steps) });
    driver.start();
    for (let i = 0; i < 60; i++) {
      const cb: (() => void) | null = pending;
      if (!cb) throw new Error('no frame scheduled');
      (cb as () => void)();
      now += 1000 / 60;
    }
    driver.stop();
    expect(frames.length).toBe(60);
    // 59 intervals of 1/60 s (the first frame has dt 0) = 118 ticks at 120 Hz.
    expect(Math.abs(loop.tick - 118)).toBeLessThanOrEqual(1);
    expect(driver.running).toBe(false);
  });
});
