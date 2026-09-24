/**
 * src/audio/loops.ts (audio track): the continuous voices that follow the snapshot every frame
 * (REQ-AUD-01): wheels rolling (filtered noise by speed, wood vs concrete), the grind loop by rail
 * kind (metal scrape with a held metallic note, pitch by speed) and wind. Each loop is built once,
 * then set(level, speedRatio) glides its gain and filters; stop() fades it out and frees the nodes.
 */

import type { RailKind } from '../core/types';
import { TUNING } from '../core/tuning';
import { SILENT, clamp01, filter, finite, gain, glide, noiseBuffer } from './synth';

export type RollSurface = 'wood' | 'concrete';

const STOP_FADE_S = 0.08;

abstract class NoiseLoop {
  protected readonly ctx: BaseAudioContext;
  protected readonly out: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private stopped = false;

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = gain(ctx, SILENT);
    this.out.connect(dest);
  }

  /** A looping noise source from a random point of the shared buffer. */
  protected noiseInto(node: AudioNode, offset: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuffer(this.ctx);
    src.loop = true;
    src.connect(node);
    src.start(this.ctx.currentTime, offset);
    this.sources.push(src);
  }

  protected oscInto(node: AudioNode, type: OscillatorType, freq: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(node);
    o.start(this.ctx.currentTime);
    this.sources.push(o);
    return o;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** level 0..1 (already mixed), ratio = speedRatio 0..1. */
  set(level: number, ratio: number): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    glide(this.out.gain, Math.max(SILENT, finite(level, 0)), now);
    this.shape(clamp01(finite(ratio, 0)), now);
  }

  protected abstract shape(ratio: number, now: number): void;

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(SILENT, now, STOP_FADE_S / 3);
    for (const s of this.sources) s.stop(now + STOP_FADE_S + 0.05);
    const out = this.out;
    const first = this.sources[0];
    if (first) first.onended = () => out.disconnect();
  }
}

/** Wheels on the ground: a hiss band that opens with speed plus a low rumble. */
export class RollLoop extends NoiseLoop {
  readonly surface: RollSurface;
  private readonly band: BiquadFilterNode;
  private readonly rumble: BiquadFilterNode;

  constructor(ctx: BaseAudioContext, dest: AudioNode, surface: RollSurface) {
    super(ctx, dest);
    this.surface = surface;
    const wood = surface === 'wood';
    this.band = filter(ctx, 'bandpass', wood ? 420 : 1100, wood ? 1.3 : 0.6);
    const bandGain = gain(ctx, wood ? 0.7 : 1);
    this.band.connect(bandGain).connect(this.out);
    this.rumble = filter(ctx, 'lowpass', wood ? 160 : 220, wood ? 2.5 : 0.8);
    const rumbleGain = gain(ctx, wood ? 1.6 : 0.8);
    rumbleGain.connect(this.out);
    if (wood) {
      // Hollow ramp boom: a resonant peak under the band.
      const boom = filter(ctx, 'peaking', 190, 3);
      boom.gain.value = 8;
      this.rumble.connect(boom).connect(rumbleGain);
    } else {
      this.rumble.connect(rumbleGain);
    }
    this.noiseInto(this.band, 0.3);
    this.noiseInto(this.rumble, 1.1);
  }

  protected shape(ratio: number, now: number): void {
    const wood = this.surface === 'wood';
    // Concrete sweep read live (AUDIO_ROLL_BRIGHT_HZ, founder playtest: softer, less hiss).
    glide(this.band.frequency, (wood ? 300 : 700) + (wood ? 600 : TUNING.AUDIO_ROLL_BRIGHT_HZ) * ratio, now);
    glide(this.rumble.frequency, (wood ? 120 : 160) + 140 * ratio, now);
  }
}

interface GrindVoicing {
  readonly bandHz: number;
  readonly bandQ: number;
  /** Held metallic note partials at speedRatio 0.5 (Hz); empty = no note (concrete ledge). */
  readonly partials: readonly number[];
  readonly noteLevel: number;
  readonly gritHz: number;
}

const GRIND_VOICING: Readonly<Record<RailKind, GrindVoicing>> = {
  rail: { bandHz: 3200, bandQ: 5, partials: [1210, 1873, 2977], noteLevel: 0.22, gritHz: 900 },
  coping: { bandHz: 2200, bandQ: 3.5, partials: [640, 1512, 2380], noteLevel: 0.18, gritHz: 700 },
  ledge: { bandHz: 1000, bandQ: 0.9, partials: [], noteLevel: 0, gritHz: 400 },
};

/** The grind: scrape band + grit + a held metallic note whose pitch rises with speed. */
export class GrindLoop extends NoiseLoop {
  readonly kind: RailKind;
  private readonly band: BiquadFilterNode;
  private readonly oscs: OscillatorNode[] = [];
  private readonly voicing: GrindVoicing;

  constructor(ctx: BaseAudioContext, dest: AudioNode, kind: RailKind) {
    super(ctx, dest);
    this.kind = kind;
    this.voicing = GRIND_VOICING[kind];
    const v = this.voicing;
    this.band = filter(ctx, 'bandpass', v.bandHz, v.bandQ);
    const bandGain = gain(ctx, kind === 'ledge' ? 1.4 : 1);
    this.band.connect(bandGain).connect(this.out);
    const grit = filter(ctx, 'lowpass', v.gritHz, 0.7);
    const gritGain = gain(ctx, kind === 'ledge' ? 0.9 : 0.35);
    grit.connect(gritGain).connect(this.out);
    this.noiseInto(this.band, 0.7);
    this.noiseInto(grit, 1.5);
    if (v.partials.length > 0) {
      const noteGain = gain(ctx, v.noteLevel);
      noteGain.connect(this.out);
      // A slow wobble on the note: the rail sings unevenly.
      const depth = gain(ctx, 18);
      this.oscInto(depth, 'sine', 5.5);
      v.partials.forEach((f, i) => {
        const pg = gain(ctx, 1 / (i + 1.5));
        pg.connect(noteGain);
        const o = this.oscInto(pg, 'sine', f);
        depth.connect(o.detune);
        this.oscs.push(o);
      });
    }
  }

  protected shape(ratio: number, now: number): void {
    const pitch = 0.8 + 0.4 * ratio;
    glide(this.band.frequency, this.voicing.bandHz * pitch, now);
    this.voicing.partials.forEach((f, i) => {
      const o = this.oscs[i];
      if (o) glide(o.frequency, f * pitch, now);
    });
  }
}

/** Wind past the ears: low band that brightens with speed. */
export class WindLoop extends NoiseLoop {
  private readonly band: BiquadFilterNode;

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    super(ctx, dest);
    this.band = filter(ctx, 'bandpass', 500, 0.5);
    const lp = filter(ctx, 'lowpass', 2500, 0.5);
    this.band.connect(lp).connect(this.out);
    this.noiseInto(this.band, 0.9);
  }

  protected shape(ratio: number, now: number): void {
    glide(this.band.frequency, 350 + 1200 * ratio, now, 0.2);
  }
}
