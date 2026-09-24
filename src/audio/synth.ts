/**
 * src/audio/synth.ts (audio track): small Web Audio building blocks shared by the SFX voices, the
 * music instruments and the continuous loops (REQ-AUD-01). Everything takes a BaseAudioContext, so the
 * same code plays live and renders into an OfflineAudioContext (the dev harness measures RMS that way).
 * No audio files: noise comes from a generated buffer, tones from oscillators.
 */

/** Where a voice plays: the context, the node it connects to, and the start time on ctx's clock. */
export interface Dest {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly t: number;
}

/** Floor for exponential ramps (they cannot reach 0). */
export const SILENT = 0.0001;

const NOISE_SECONDS = 2;
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const crackleCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Deterministic 32-bit LCG in [0, 1): generated buffers are identical run to run. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A shared 2 s mono white noise buffer per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rnd = lcg(0x5eed);
  for (let i = 0; i < len; i++) data[i] = rnd() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

/** Vinyl crackle: sparse clicks and pops over a faint hiss, loopable (Street music, REQ-AUD-02). */
export function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const hit = crackleCache.get(ctx);
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rnd = lcg(0xc4ac);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    lp += 0.08 * (rnd() * 2 - 1 - lp);
    data[i] = lp * 0.25;
  }
  const clicks = Math.floor(NOISE_SECONDS * 38);
  for (let c = 0; c < clicks; c++) {
    const at = Math.floor(rnd() * (len - 64));
    const amp = rnd() < 0.12 ? 0.9 : 0.15 + rnd() * 0.35;
    const width = 2 + Math.floor(rnd() * 24);
    const sign = rnd() < 0.5 ? -1 : 1;
    for (let k = 0; k < width; k++) data[at + k] = (data[at + k] ?? 0) + sign * amp * Math.exp(-k / (width * 0.35));
  }
  crackleCache.set(ctx, buf);
  return buf;
}

export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A finite number or the fallback (event fields feed straight into AudioParams: never let NaN in). */
export function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Percussive envelope on a gain param: fast attack to peak, exponential decay to silence. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(SILENT, t);
  p.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  p.exponentialRampToValueAtTime(SILENT, t + attack + decay);
}

/** Attack, hold at sustain, release: for tones with a length (chords, bass, horn). */
export function ahr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(SILENT, t);
  p.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  p.setValueAtTime(Math.max(SILENT, peak), t + attack + hold);
  p.exponentialRampToValueAtTime(SILENT, t + attack + hold + release);
}

/** An oscillator started at t and stopped at t + dur, connected to dest. */
export function tone(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  o.connect(dest);
  o.start(t);
  o.stop(t + dur);
  return o;
}

/** A noise burst from the shared buffer (random start point), started at t for dur seconds. */
export function noise(ctx: BaseAudioContext, t: number, dur: number, dest: AudioNode, offset = 0): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.connect(dest);
  src.start(t, offset % (NOISE_SECONDS - 0.01));
  src.stop(t + dur);
  return src;
}

/** Soft saturation curve for WaveShaperNode (punk stabs, bass grit). */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = Math.max(0.01, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/** Set a live param smoothly (continuous voices follow the snapshot every frame). */
export function glide(p: AudioParam, value: number, now: number, timeConstant = 0.05): void {
  p.setTargetAtTime(value, now, timeConstant);
}
