/**
 * src/core/loop.ts: fixed-tick simulation loop with an accumulator (REQ-TIM-01, REQ-TIM-04).
 *
 * - The sim advances in fixed ticks of 1 / SIM_HZ (120 Hz) and never sees a variable dt.
 * - Each render frame adds min(realDt, SIM_MAX_CATCHUP_S) x timeScale of time to the accumulator
 *   and runs whole ticks; at most ceil(SIM_MAX_CATCHUP_S x SIM_HZ) = 12 ticks run per frame and any
 *   excess whole ticks are dropped, so a slow frame drops time instead of spiralling.
 * - alpha (0..1) is the leftover fraction of a tick: render interpolates prev -> curr by alpha.
 * - timeScale slows presentation time (900ms Inference = 0.6, REQ-SPC-05). The sim still takes
 *   identical fixed ticks, just fewer per real second, so sim results stay deterministic.
 * - freeze(n) is hitstop (REQ-FX-03): the next n ticks' worth of time passes with no sim step.
 * - pause() stops accumulation entirely; stepTicks() advances exactly n ticks regardless (debug).
 *
 * FixedLoop is pure logic driven by frame(dt); RafDriver feeds it from requestAnimationFrame with
 * an injectable clock and scheduler so tests use a fake clock.
 */

import { TUNING } from './tuning';

export interface FixedLoopOptions {
  /** Called once per fixed tick with the index of the tick being simulated (0, 1, 2, ...). */
  readonly onTick: (tick: number) => void;
  /** Tick rate; defaults to TUNING.SIM_HZ at construction (it is fixed at 120). */
  readonly hz?: number;
}

export interface FrameResult {
  /** Ticks simulated this frame. */
  readonly steps: number;
  /** Ticks swallowed by hitstop this frame. */
  readonly frozen: number;
  /** Whole ticks dropped by the per-frame cap this frame. */
  readonly dropped: number;
  /** Interpolation fraction after this frame, in [0, 1). */
  readonly alpha: number;
}

export class FixedLoop {
  readonly hz: number;
  readonly dt: number;
  private readonly onTick: (tick: number) => void;
  private ticksDone = 0;
  private acc = 0; // in ticks
  private scale = 1;
  private frozenLeft = 0;
  private isPaused = false;

  constructor(options: FixedLoopOptions) {
    this.hz = options.hz ?? TUNING.SIM_HZ;
    this.dt = 1 / this.hz;
    this.onTick = options.onTick;
  }

  /** Ticks completed so far. The next tick simulated gets this index. */
  get tick(): number {
    return this.ticksDone;
  }

  /** Seconds of sim time completed (tick / hz). */
  get simTime(): number {
    return this.ticksDone / this.hz;
  }

  /** Interpolation fraction in [0, 1) for rendering between the last two sim states. */
  get alpha(): number {
    return this.acc;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get timeScale(): number {
    return this.scale;
  }

  /** Ticks of hitstop still pending. */
  get frozenTicks(): number {
    return this.frozenLeft;
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  /** Presentation time scale, clamped to [0, 4]. 1 = real time. */
  setTimeScale(scale: number): void {
    this.scale = Math.min(4, Math.max(0, Number.isFinite(scale) ? scale : 1));
  }

  /** Hitstop: swallow the next `ticks` ticks of accumulated time without stepping (non-cumulative: keeps the larger). */
  freeze(ticks: number): void {
    this.frozenLeft = Math.max(this.frozenLeft, Math.max(0, Math.floor(ticks)));
  }

  /** Max ticks one frame may run: ceil(SIM_MAX_CATCHUP_S x hz), read live from TUNING. */
  maxStepsPerFrame(): number {
    return Math.max(1, Math.ceil(TUNING.SIM_MAX_CATCHUP_S * this.hz - 1e-9));
  }

  /** Advance by one render frame of real time (seconds). */
  frame(realDtS: number): FrameResult {
    if (this.isPaused) return { steps: 0, frozen: 0, dropped: 0, alpha: this.acc };
    const clamped = Math.min(Math.max(Number.isFinite(realDtS) ? realDtS : 0, 0), TUNING.SIM_MAX_CATCHUP_S);
    this.acc += clamped * this.scale * this.hz;
    const cap = this.maxStepsPerFrame();
    let steps = 0;
    let frozen = 0;
    while (this.acc >= 1 - 1e-9) {
      this.acc -= 1;
      if (this.frozenLeft > 0) {
        this.frozenLeft -= 1;
        frozen += 1;
        continue;
      }
      if (steps >= cap) {
        this.acc += 1; // not consumed: dropped below
        break;
      }
      this.runOne();
      steps += 1;
    }
    let dropped = 0;
    if (this.acc >= 1) {
      dropped = Math.floor(this.acc);
      this.acc -= dropped;
    }
    if (this.acc < 0) this.acc = 0;
    return { steps, frozen, dropped, alpha: this.acc };
  }

  /** Run exactly n ticks now, ignoring pause, time scale and hitstop (debug hook step()). */
  stepTicks(n: number): void {
    for (let i = 0; i < n; i++) this.runOne();
  }

  private runOne(): void {
    const t = this.ticksDone;
    this.onTick(t);
    this.ticksDone = t + 1;
  }
}

/** Milliseconds clock. Browser default: performance.now(). */
export interface LoopClock {
  now(): number;
}

/** Frame scheduler. Browser default: requestAnimationFrame. */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface RafDriverOptions {
  readonly clock?: LoopClock;
  readonly scheduler?: FrameScheduler;
  /** Called after the loop advanced, once per render frame: render and HUD update go here. */
  readonly onFrame: (result: FrameResult, realDtS: number) => void;
}

/** Drives a FixedLoop from the display refresh. start() is idempotent. */
export class RafDriver {
  private readonly loop: FixedLoop;
  private readonly clock: LoopClock;
  private readonly scheduler: FrameScheduler;
  private readonly onFrame: (result: FrameResult, realDtS: number) => void;
  private handle: number | null = null;
  private lastMs: number | null = null;

  constructor(loop: FixedLoop, options: RafDriverOptions) {
    this.loop = loop;
    this.onFrame = options.onFrame;
    this.clock = options.clock ?? { now: () => performance.now() };
    this.scheduler = options.scheduler ?? {
      request: (cb) => requestAnimationFrame(() => cb()),
      cancel: (h) => cancelAnimationFrame(h),
    };
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.lastMs = null;
    this.handle = this.scheduler.request(this.tickFrame);
  }

  stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
    this.lastMs = null;
  }

  /** Run one frame immediately (tests). */
  pump(): void {
    const now = this.clock.now();
    const dt = this.lastMs === null ? 0 : (now - this.lastMs) / 1000;
    this.lastMs = now;
    const result = this.loop.frame(dt);
    this.onFrame(result, dt);
  }

  private readonly tickFrame = (): void => {
    if (this.handle === null) return;
    this.pump();
    this.handle = this.scheduler.request(this.tickFrame);
  };
}
