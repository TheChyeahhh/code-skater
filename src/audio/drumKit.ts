/**
 * src/audio/drumKit.ts (audio track): the music drum kit, synthesized sample by sample in code
 * (REQ-AUD-02: kick pitch sweep, snare tone + noise, hats and cymbal from filtered noise). Each drum is
 * computed once per context and style into an AudioBuffer; a hit is then one buffer source and one
 * gain, which keeps a breakbeat with ghost notes cheap on the CPU. Deterministic (seeded noise).
 */

import { lcg } from './synth';
import type { DrumPart, SongStyle } from './songs';

export type DrumKit = Readonly<Record<DrumPart, AudioBuffer>>;

/** Level at which an exponential decay counts as finished (-80 dB, like the SFX envelopes). */
const DECAY_FLOOR = 1e-4;

interface KickSpec { readonly f0: number; readonly f1: number; readonly sweep: number; readonly decay: number; readonly click: number }
interface NoiseSpec { readonly type: 'bandpass' | 'highpass'; readonly hz: number; readonly q: number }
interface SnareSpec { readonly tone: number; readonly toneDecay: number; readonly noise: NoiseSpec; readonly decay: number }
interface KitSpec {
  readonly kick: KickSpec;
  readonly snare: SnareSpec;
  readonly hatHz: number;
  readonly closedDecay: number;
  readonly openDecay: number;
}

const SPECS: Readonly<Record<SongStyle, KitSpec>> = {
  street: {
    kick: { f0: 140, f1: 46, sweep: 0.1, decay: 0.42, click: 0.25 },
    snare: { tone: 185, toneDecay: 0.1, noise: { type: 'bandpass', hz: 1900, q: 0.9 }, decay: 0.17 },
    hatHz: 6500,
    closedDecay: 0.045,
    openDecay: 0.26,
  },
  woodshed: {
    kick: { f0: 185, f1: 50, sweep: 0.06, decay: 0.28, click: 0.45 },
    snare: { tone: 220, toneDecay: 0.1, noise: { type: 'highpass', hz: 1500, q: 0.7 }, decay: 0.2 },
    hatHz: 8000,
    closedDecay: 0.045,
    openDecay: 0.26,
  },
};

/** Exponential decay envelope with a 2 ms linear attack. */
function env(t: number, decay: number): number {
  const attack = 0.002;
  if (t < attack) return t / attack;
  return Math.pow(DECAY_FLOOR, (t - attack) / decay);
}

/** RBJ biquad, processed in place. */
function biquad(data: Float32Array, sr: number, type: 'bandpass' | 'highpass', hz: number, q: number): void {
  const w = (2 * Math.PI * Math.min(hz, sr * 0.45)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0: number, b1: number, b2: number;
  if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i] as number;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[i] = y;
  }
}

function noiseInto(n: number, seed: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(n * 4));
  const rnd = lcg(seed);
  for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
  return out;
}

function triangle(phase: number): number {
  const p = phase - Math.floor(phase);
  return 1 - 4 * Math.abs(p - 0.5);
}

function makeBuffer(ctx: BaseAudioContext, seconds: number, fill: (data: Float32Array<ArrayBuffer>, sr: number) => void): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(1, Math.ceil(seconds * sr));
  const buf = ctx.createBuffer(1, n, sr);
  const data = new Float32Array(new ArrayBuffer(n * 4));
  fill(data, sr);
  buf.copyToChannel(data, 0);
  return buf;
}

function kick(ctx: BaseAudioContext, k: KickSpec): AudioBuffer {
  return makeBuffer(ctx, k.decay + 0.02, (d, sr) => {
    const click = noiseInto(Math.ceil(0.015 * sr), 0xc11c);
    biquad(click, sr, 'highpass', 3000, 0.7);
    let phase = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const f = t < k.sweep ? k.f0 * Math.pow(k.f1 / k.f0, t / k.sweep) : k.f1;
      phase += f / sr;
      let v = 0.95 * env(t, k.decay) * Math.sin(2 * Math.PI * phase);
      if (i < click.length) v += k.click * env(t, 0.012) * (click[i] as number);
      d[i] = v;
    }
  });
}

function snare(ctx: BaseAudioContext, s: SnareSpec): AudioBuffer {
  return makeBuffer(ctx, Math.max(s.decay, s.toneDecay) + 0.02, (d, sr) => {
    const n = noiseInto(d.length, 0x5a4e);
    biquad(n, sr, s.noise.type, s.noise.hz, s.noise.q);
    let phase = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const f = s.tone * Math.pow(0.8, Math.min(1, t / 0.08));
      phase += f / sr;
      d[i] = 0.45 * env(t, s.toneDecay) * triangle(phase) + 0.6 * env(t, s.decay) * (n[i] as number);
    }
  });
}

function filteredNoise(ctx: BaseAudioContext, seed: number, type: 'bandpass' | 'highpass', hz: number, q: number, peak: number, decay: number): AudioBuffer {
  return makeBuffer(ctx, decay + 0.02, (d, sr) => {
    const n = noiseInto(d.length, seed);
    biquad(n, sr, type, hz, q);
    for (let i = 0; i < d.length; i++) d[i] = peak * env(i / sr, decay) * (n[i] as number);
  });
}

function rim(ctx: BaseAudioContext): AudioBuffer {
  return makeBuffer(ctx, 0.06, (d, sr) => {
    const n = noiseInto(d.length, 0x41a1);
    biquad(n, sr, 'bandpass', 1700, 4);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      d[i] = 0.5 * env(t, 0.035) * (n[i] as number) + 0.2 * env(t, 0.03) * triangle((820 * i) / sr);
    }
  });
}

const cache = new WeakMap<BaseAudioContext, Map<SongStyle, DrumKit>>();

/** The kit for a style on this context, synthesized on first use and cached. */
export function drumKit(ctx: BaseAudioContext, style: SongStyle): DrumKit {
  let byStyle = cache.get(ctx);
  if (!byStyle) {
    byStyle = new Map();
    cache.set(ctx, byStyle);
  }
  const hit = byStyle.get(style);
  if (hit) return hit;
  const s = SPECS[style];
  const kit: DrumKit = {
    kick: kick(ctx, s.kick),
    snare: snare(ctx, s.snare),
    hat: filteredNoise(ctx, 0x4a70, 'highpass', s.hatHz, 0.8, 0.3, s.closedDecay),
    openHat: filteredNoise(ctx, 0x0be7, 'highpass', s.hatHz, 0.8, 0.3, s.openDecay),
    rim: rim(ctx),
    crash: filteredNoise(ctx, 0xc4a5, 'highpass', 4500, 0.7, 0.28, 1.3),
  };
  byStyle.set(style, kit);
  return kit;
}
