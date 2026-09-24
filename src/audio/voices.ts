/**
 * src/audio/voices.ts (audio track): every one-shot sound effect, synthesized (REQ-AUD-01).
 * A voice schedules its own nodes on dest.ctx starting at dest.t and returns how long its tail rings,
 * in seconds (the dev harness renders each one offline for that long and measures RMS).
 * The numbers here are sound design (frequencies, envelope times), not gameplay tunables; mix levels
 * live in src/core/tuning/audio.ts.
 */

import { SILENT, ahr, clamp01, driveCurve, filter, finite, gain, mtof, noise, perc, tone, type Dest } from './synth';

export interface VoiceParams {
  /** 0..1 loudness / energy of the moment (pop charge, landing speed, bank size). */
  readonly intensity?: number;
  /** Voice specific flavour: land quality, rail kind, bank quality. */
  readonly variant?: string;
  /** Voice specific index: letter number, seconds left. */
  readonly index?: number;
}

export const VOICE_IDS = [
  'push', 'pop', 'flick', 'land', 'grindOn', 'grindSwitch', 'grindOff', 'lipStall', 'manualSqueak',
  'revertScuff', 'transfer', 'bail', 'specialReady', 'specialUsed', 'gap', 'letter', 'macguffin', 'goal',
  'comboBank', 'comboLost', 'clockTick', 'runEndHorn', 'crack',
  'uiMove', 'uiConfirm', 'uiBack', 'uiError', 'uiToast',
] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

type VoiceFn = (d: Dest, p: VoiceParams) => number;

function level(p: VoiceParams, fallback = 1): number {
  return clamp01(finite(p.intensity ?? fallback, fallback));
}

/** Short noise burst through a filter with a percussive envelope. */
function burst(d: Dest, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, at = 0, offset = 0): void {
  const f = filter(d.ctx, type, freq, q);
  const g = gain(d.ctx, SILENT);
  f.connect(g).connect(d.out);
  perc(g.gain, d.t + at, peak, 0.002, decay);
  noise(d.ctx, d.t + at, decay + 0.05, f, offset);
}

/** A pitched thump: oscillator sweeping from f0 to f1. */
function thump(d: Dest, type: OscillatorType, f0: number, f1: number, sweep: number, peak: number, decay: number, at = 0): void {
  const g = gain(d.ctx, SILENT);
  g.connect(d.out);
  perc(g.gain, d.t + at, peak, 0.002, decay);
  const o = tone(d.ctx, type, f0, d.t + at, decay + 0.05, g);
  o.frequency.exponentialRampToValueAtTime(f1, d.t + at + sweep);
}

/** Inharmonic metal partials (rails, coping, bells). */
function partials(d: Dest, freqs: readonly number[], peak: number, decay: number, at = 0, type: OscillatorType = 'sine'): void {
  const g = gain(d.ctx, SILENT);
  g.connect(d.out);
  perc(g.gain, d.t + at, peak, 0.002, decay);
  freqs.forEach((f, i) => {
    const pg = gain(d.ctx, 1 / (i + 1));
    pg.connect(g);
    tone(d.ctx, type, f, d.t + at, decay + 0.05, pg);
  });
}

/** Noise through a band-pass whose centre sweeps: whooshes and scrapes. */
function sweep(d: Dest, f0: number, f1: number, q: number, peak: number, attack: number, hold: number, release: number, at = 0): void {
  const f = filter(d.ctx, 'bandpass', f0, q);
  const g = gain(d.ctx, SILENT);
  f.connect(g).connect(d.out);
  const t = d.t + at;
  const dur = attack + hold + release;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  ahr(g.gain, t, peak, attack, hold, release);
  noise(d.ctx, t, dur + 0.05, f, at * 7);
}

/** A plucked / belled note sequence: each note starts `gap` after the last. */
function notes(d: Dest, midis: readonly number[], gapS: number, type: OscillatorType, peak: number, decay: number, lastDecay = decay): void {
  midis.forEach((m, i) => {
    const last = i === midis.length - 1;
    partials(d, [mtof(m), mtof(m) * 2], peak, last ? lastDecay : decay, i * gapS, type);
  });
}

/** Detuned sawtooth brass through an opening low-pass (fanfare, horn). */
function brass(d: Dest, midi: number, at: number, hold: number, peak: number, drive = 0): void {
  const t = d.t + at;
  const lp = filter(d.ctx, 'lowpass', 500, 1.2);
  const g = gain(d.ctx, SILENT);
  if (drive > 0) {
    const ws = d.ctx.createWaveShaper();
    ws.curve = driveCurve(drive);
    lp.connect(ws).connect(g);
  } else {
    lp.connect(g);
  }
  g.connect(d.out);
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
  lp.frequency.exponentialRampToValueAtTime(1400, t + hold + 0.2);
  ahr(g.gain, t, peak, 0.02, hold, 0.25);
  for (const cents of [-8, 0, 7]) tone(d.ctx, 'sawtooth', mtof(midi), t, hold + 0.35, lp, cents);
}

const METAL_RAIL = [620, 1347, 2213, 3471];
const METAL_COPING = [380, 913, 1652];

function railClack(d: Dest, kind: string, peak: number): number {
  if (kind === 'ledge') {
    burst(d, 'bandpass', 1300, 1.4, peak * 0.8, 0.09);
    thump(d, 'triangle', 170, 70, 0.05, peak * 0.6, 0.1);
    return 0.2;
  }
  const freqs = kind === 'coping' ? METAL_COPING : METAL_RAIL;
  partials(d, freqs, peak * 0.35, kind === 'coping' ? 0.35 : 0.28);
  burst(d, 'highpass', 3000, 0.7, peak * 0.5, 0.03);
  thump(d, 'triangle', 220, 90, 0.04, peak * 0.4, 0.07);
  return 0.4;
}

export const VOICES: Readonly<Record<VoiceId, VoiceFn>> = {
  push: (d, p) => {
    const i = level(p, 0.7);
    burst(d, 'bandpass', 900, 1, 0.3 * i, 0.13);
    thump(d, 'sine', 110, 70, 0.05, 0.2 * i, 0.07);
    return 0.2;
  },
  pop: (d, p) => {
    const i = 0.6 + 0.4 * level(p, 0.5);
    burst(d, 'highpass', 1800, 0.7, 0.9 * i, 0.035);
    thump(d, 'triangle', 260, 110, 0.05, 0.7 * i, 0.09);
    burst(d, 'bandpass', 700, 4, 0.45 * i, 0.06, 0.004, 0.3);
    return 0.15;
  },
  flick: (d, p) => {
    sweep(d, 600, 3500, 2, 0.25 * level(p, 0.7), 0.03, 0.03, 0.09);
    return 0.2;
  },
  land: (d, p) => {
    const i = 0.5 + 0.5 * level(p, 0.6);
    thump(d, 'sine', 120, 42, 0.12, 1.0 * i, 0.3);
    burst(d, 'lowpass', 2500, 0.8, 0.6 * i, 0.08);
    burst(d, 'bandpass', 420, 0.8, 0.35 * i, 0.16, 0, 0.5);
    if (p.variant === 'ok') {
      // Sloppy: a second slap and a skid.
      burst(d, 'lowpass', 1800, 0.8, 0.45 * i, 0.06, 0.045, 0.9);
      sweep(d, 1600, 500, 1.2, 0.22 * i, 0.02, 0.06, 0.12, 0.05);
      return 0.4;
    }
    return 0.35;
  },
  grindOn: (d, p) => railClack(d, p.variant ?? 'rail', 0.8),
  grindSwitch: (d, p) => {
    const tail = railClack(d, p.variant ?? 'rail', 0.6);
    sweep(d, 2600, 1800, 1.5, 0.2, 0.01, 0.04, 0.08);
    return tail;
  },
  grindOff: (d, p) => {
    burst(d, 'highpass', 2500, 0.7, 0.4, 0.03);
    if ((p.variant ?? 'rail') !== 'ledge') partials(d, [1810, 2710], 0.12, 0.08);
    return 0.12;
  },
  lipStall: (d) => {
    thump(d, 'triangle', 210, 80, 0.06, 0.6, 0.13);
    partials(d, [423, 1031, 1870], 0.25, 0.22);
    sweep(d, 1900, 1200, 1.2, 0.18, 0.01, 0.05, 0.1, 0.02);
    return 0.3;
  },
  manualSqueak: (d) => {
    const bp = filter(d.ctx, 'bandpass', 1800, 3);
    const g = gain(d.ctx, SILENT);
    bp.connect(g).connect(d.out);
    ahr(g.gain, d.t, 0.35, 0.01, 0.08, 0.07);
    const o = tone(d.ctx, 'triangle', 1400, d.t, 0.2, bp);
    o.frequency.linearRampToValueAtTime(2050, d.t + 0.05);
    o.frequency.linearRampToValueAtTime(1600, d.t + 0.15);
    return 0.2;
  },
  revertScuff: (d, p) => {
    const i = level(p, 0.7);
    sweep(d, 2200, 500, 1.2, 0.5 * i, 0.02, 0.14, 0.16);
    thump(d, 'sine', 80, 50, 0.2, 0.2 * i, 0.25);
    return 0.35;
  },
  transfer: (d) => {
    sweep(d, 400, 1600, 1.2, 0.22, 0.2, 0.05, 0.25);
    return 0.5;
  },
  bail: (d, p) => {
    const i = 0.6 + 0.4 * level(p, 0.7);
    thump(d, 'sine', 95, 35, 0.2, 1.0 * i, 0.3);
    burst(d, 'lowpass', 900, 0.7, 0.8 * i, 0.22);
    sweep(d, 1800, 650, 0.8, 0.4 * i, 0.03, 0.2, 0.55, 0.08);
    for (const [at, f] of [[0.18, 320], [0.31, 270], [0.42, 360]] as const) thump(d, 'triangle', f, f * 0.6, 0.03, 0.3 * i, 0.06, at);
    return 0.95;
  },
  specialReady: (d) => {
    for (const [k, m] of [88, 95, 100].entries()) partials(d, [mtof(m), mtof(m) * 2.76], 0.22, 0.9, k * 0.07);
    burst(d, 'highpass', 6000, 0.7, 0.12, 0.25);
    return 1.1;
  },
  specialUsed: (d) => {
    sweep(d, 300, 5000, 1.5, 0.5, 0.22, 0.03, 0.15);
    thump(d, 'sine', 160, 45, 0.35, 0.5, 0.4, 0.2);
    return 0.65;
  },
  gap: (d) => {
    notes(d, [81, 85, 88], 0.075, 'triangle', 0.26, 0.35, 0.6);
    return 0.8;
  },
  letter: (d, p) => {
    const step = [0, 2, 4, 7][Math.max(0, Math.min(3, Math.round(finite(p.index ?? 0, 0))))] ?? 0;
    partials(d, [mtof(84 + step), mtof(84 + step) * 2, mtof(84 + step) * 3.01], 0.3, 0.6);
    burst(d, 'highpass', 5000, 0.7, 0.15, 0.02);
    return 0.7;
  },
  macguffin: (d) => {
    const run = [72, 76, 79];
    run.forEach((m, k) => brass(d, m, k * 0.11, 0.06, 0.16));
    for (const m of [72, 76, 79, 84]) brass(d, m, 0.34, 0.85, 0.11);
    for (const [k, m] of [96, 100, 103].entries()) partials(d, [mtof(m)], 0.08, 0.7, 0.34 + k * 0.09);
    return 1.7;
  },
  goal: (d) => {
    notes(d, [79, 84, 88], 0.09, 'square', 0.1, 0.18, 0.5);
    partials(d, [mtof(76), mtof(79), mtof(84)], 0.08, 0.6, 0.18, 'triangle');
    return 0.85;
  },
  comboBank: (d, p) => {
    const i = 0.5 + 0.5 * level(p, 0.5);
    const extra = p.variant === 'insane' ? [91, 95, 100] : p.variant === 'sick' ? [91] : [];
    const run = [76, 83, 88, ...extra];
    const lp = filter(d.ctx, 'lowpass', 4200, 0.7);
    lp.connect(d.out);
    const sub: Dest = { ctx: d.ctx, out: lp, t: d.t };
    notes(sub, run, 0.055, 'square', 0.1 * i, 0.16, 0.4);
    if (extra.length > 0) burst(d, 'highpass', 7000, 0.7, 0.15 * i, 0.35, 0.05);
    return 0.5 + run.length * 0.055;
  },
  comboLost: (d) => {
    const lp = filter(d.ctx, 'lowpass', 2000, 2);
    const g = gain(d.ctx, SILENT);
    lp.connect(g).connect(d.out);
    lp.frequency.setValueAtTime(2000, d.t);
    lp.frequency.exponentialRampToValueAtTime(260, d.t + 0.5);
    ahr(g.gain, d.t, 0.28, 0.01, 0.2, 0.3);
    for (const cents of [0, 18]) {
      const o = tone(d.ctx, 'sawtooth', 330, d.t, 0.6, lp, cents);
      o.frequency.exponentialRampToValueAtTime(98, d.t + 0.5);
    }
    return 0.6;
  },
  clockTick: (d, p) => {
    const last = finite(p.index ?? 10, 10) <= 3;
    thump(d, 'sine', last ? 2400 : 1800, last ? 2300 : 1700, 0.02, 0.3, 0.045);
    thump(d, 'triangle', last ? 1200 : 900, last ? 1150 : 860, 0.02, 0.15, 0.05);
    return 0.1;
  },
  runEndHorn: (d) => {
    for (const m of [70, 74, 77]) {
      const t = d.t;
      const lp = filter(d.ctx, 'lowpass', 2600, 1);
      const ws = d.ctx.createWaveShaper();
      ws.curve = driveCurve(2.5);
      const g = gain(d.ctx, SILENT);
      lp.connect(ws).connect(g).connect(d.out);
      ahr(g.gain, t, 0.12, 0.03, 0.9, 0.25);
      for (const cents of [-6, 6]) {
        const o = tone(d.ctx, 'sawtooth', mtof(m) * 0.8, t, 1.25, lp, cents);
        o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.08);
      }
    }
    return 1.3;
  },
  crack: (d, p) => {
    const i = level(p, 0.6);
    burst(d, 'bandpass', 950, 2, 0.16 * i, 0.03);
    thump(d, 'sine', 150, 100, 0.02, 0.12 * i, 0.035);
    return 0.08;
  },
  uiMove: (d) => {
    partials(d, [880], 0.12, 0.05, 0, 'triangle');
    return 0.08;
  },
  uiConfirm: (d) => {
    notes(d, [81, 88], 0.06, 'triangle', 0.13, 0.08, 0.15);
    return 0.25;
  },
  uiBack: (d) => {
    notes(d, [79, 74], 0.06, 'triangle', 0.12, 0.07, 0.12);
    return 0.2;
  },
  uiError: (d) => {
    const lp = filter(d.ctx, 'lowpass', 1400, 0.7);
    const g = gain(d.ctx, SILENT);
    lp.connect(g).connect(d.out);
    ahr(g.gain, d.t, 0.14, 0.005, 0.14, 0.05);
    tone(d.ctx, 'square', 180, d.t, 0.22, lp);
    tone(d.ctx, 'square', 191, d.t, 0.22, lp);
    return 0.22;
  },
  uiToast: (d) => {
    notes(d, [88, 93], 0.07, 'sine', 0.12, 0.2, 0.3);
    return 0.4;
  },
};

export function playVoice(id: VoiceId, d: Dest, p: VoiceParams = {}): number {
  return VOICES[id](d, p);
}

