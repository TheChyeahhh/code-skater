/**
 * src/audio/music.ts (audio track): plays a SongDef (src/audio/songs.ts) with a lookahead scheduler
 * (REQ-AUD-02). The engine calls pump(ctx.currentTime + AUDIO_LOOKAHEAD_S) every AUDIO_SCHEDULER_MS;
 * every 16th step that starts before that horizon is scheduled on the audio clock, so timing never
 * depends on the timer's jitter.
 * Low CPU: drums are one buffer source + one gain per hit (the kit is synthesized once, drumKit.ts),
 * the bass is one persistent mono voice re-pitched per note, and only chords build nodes per hit.
 * Works on any BaseAudioContext, so the dev harness renders whole songs offline and measures them.
 */

import { TUNING } from '../core/tuning';
import { drumKit, type DrumKit } from './drumKit';
import { STEPS_PER_BAR, stepNotes, stepSeconds, swingOffset, type MusicNote, type SongDef, type SongStyle } from './songs';
import { SILENT, ahr, crackleBuffer, driveCurve, filter, gain, mtof, tone, type Dest } from './synth';

const FADE_IN_S = 0.4;
/** Dusty top end for Street, open for Woodshed. */
const BUS_LOWPASS_HZ: Readonly<Record<SongStyle, number>> = { street: 7000, woodshed: 14000 };

function playDrum(d: Dest, buffer: AudioBuffer, vel: number): void {
  const src = d.ctx.createBufferSource();
  src.buffer = buffer;
  const g = gain(d.ctx, vel);
  src.connect(g).connect(d.out);
  src.start(d.t);
}

/** One persistent bass voice: oscillators run for the whole song, each note re-pitches and re-envelopes. */
class MonoBass {
  private readonly ctx: BaseAudioContext;
  private readonly style: SongStyle;
  private readonly amp: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly oscs: { readonly osc: OscillatorNode; readonly ratio: number }[] = [];

  constructor(ctx: BaseAudioContext, out: AudioNode, style: SongStyle, t: number) {
    this.ctx = ctx;
    this.style = style;
    this.amp = gain(ctx, SILENT);
    this.amp.connect(out);
    if (style === 'street') {
      // Sub sine plus a quiet triangle an octave up for definition, through a warm low-pass.
      this.lp = filter(ctx, 'lowpass', 420, 0.8);
      this.lp.connect(this.amp);
      this.add('sine', 1, 1, t);
      this.add('triangle', 2, 0.25, t);
    } else {
      // Driven saw plus a sub sine: punk bass with a plucky filter per note.
      this.lp = filter(ctx, 'lowpass', 900, 1.5);
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(2);
      this.lp.connect(ws).connect(this.amp);
      this.add('sawtooth', 1, 1, t);
      this.add('sine', 0.5, 1, t);
    }
  }

  private add(type: OscillatorType, ratio: number, level: number, t: number): void {
    const g = gain(this.ctx, level);
    g.connect(this.lp);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 55 * ratio;
    osc.connect(g);
    osc.start(t);
    this.oscs.push({ osc, ratio });
  }

  note(t: number, midi: number, lenS: number, vel: number): void {
    const f = mtof(midi);
    for (const o of this.oscs) o.osc.frequency.setValueAtTime(f * o.ratio, t);
    if (this.style === 'street') {
      ahr(this.amp.gain, t, 0.55 * vel, 0.008, Math.max(0.02, lenS - 0.1), 0.08);
    } else {
      this.lp.frequency.setValueAtTime(1400, t);
      this.lp.frequency.exponentialRampToValueAtTime(500, t + Math.max(0.05, lenS));
      ahr(this.amp.gain, t, 0.32 * vel, 0.004, Math.max(0.02, lenS - 0.06), 0.05);
    }
  }

  stop(t: number): void {
    for (const o of this.oscs) o.osc.stop(t);
  }
}

function playChord(d: Dest, style: SongStyle, midis: readonly number[], lenS: number, vel: number): void {
  const g = gain(d.ctx, SILENT);
  if (style === 'street') {
    // Dusty electric piano: one triangle per note, alternately detuned so the voicing beats softly.
    const lp = filter(d.ctx, 'lowpass', 1700, 0.6);
    lp.connect(g).connect(d.out);
    ahr(g.gain, d.t, 0.13 * vel, 0.012, Math.max(0.02, lenS - 0.1), 0.35);
    midis.forEach((m, i) => tone(d.ctx, 'triangle', mtof(m), d.t, lenS + 0.4, lp, i % 2 === 0 ? -6 : 6));
  } else {
    // Punk power-chord stab: detuned saws into drive.
    const lp = filter(d.ctx, 'lowpass', 2600, 0.9);
    const ws = d.ctx.createWaveShaper();
    ws.curve = driveCurve(3.5);
    lp.connect(ws).connect(g).connect(d.out);
    ahr(g.gain, d.t, 0.13 * vel, 0.004, Math.max(0.02, lenS - 0.03), 0.07);
    // One saw per note, plus a detuned double on the root for width.
    midis.forEach((m, i) => tone(d.ctx, 'sawtooth', mtof(m), d.t, lenS + 0.1, lp, i === 0 ? -9 : 4));
    tone(d.ctx, 'sawtooth', mtof(midis[0] ?? 40), d.t, lenS + 0.1, lp, 9);
  }
}

/** One song playing on one context. Create, start(t), pump(horizon) repeatedly, stop(t). */
export class MusicPlayer {
  readonly song: SongDef;
  private readonly ctx: BaseAudioContext;
  private readonly bus: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly kit: DrumKit;
  private bass: MonoBass | null = null;
  private crackle: AudioBufferSourceNode | null = null;
  private crackleGain: GainNode | null = null;
  /** Straight-grid time of the next step (swing is added per step). */
  private nextGridT = 0;
  /** Steps since the song started. */
  private step = 0;
  private running = false;

  constructor(ctx: BaseAudioContext, out: AudioNode, song: SongDef) {
    this.ctx = ctx;
    this.song = song;
    this.kit = drumKit(ctx, song.style);
    this.bus = gain(ctx, SILENT);
    this.tone = filter(ctx, 'lowpass', BUS_LOWPASS_HZ[song.style], 0.5);
    this.tone.connect(this.bus).connect(out);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Bar and step the scheduler will play next. */
  get position(): { readonly bar: number; readonly step: number } {
    return { bar: Math.floor(this.step / STEPS_PER_BAR), step: this.step % STEPS_PER_BAR };
  }

  start(t: number): void {
    if (this.running) return;
    this.running = true;
    this.nextGridT = t;
    this.bus.gain.setValueAtTime(SILENT, t);
    this.bus.gain.exponentialRampToValueAtTime(1, t + FADE_IN_S);
    this.bass = new MonoBass(this.ctx, this.tone, this.song.style, t);
    if (this.song.crackle) {
      const src = this.ctx.createBufferSource();
      src.buffer = crackleBuffer(this.ctx);
      src.loop = true;
      this.crackleGain = gain(this.ctx, TUNING.AUDIO_CRACKLE_GAIN);
      src.connect(this.crackleGain).connect(this.bus);
      src.start(t);
      this.crackle = src;
    }
  }

  /** Schedule every step that starts before `horizon` (seconds on the context clock). */
  pump(horizon: number): void {
    if (!this.running) return;
    if (this.crackleGain) this.crackleGain.gain.value = TUNING.AUDIO_CRACKLE_GAIN;
    // Never schedule into the past: after a stall the grid jumps forward instead of bursting.
    if (this.nextGridT < this.ctx.currentTime) this.resync(this.ctx.currentTime + 0.02);
    while (this.nextGridT < horizon) {
      const stepS = stepSeconds(this.song);
      const bar = Math.floor(this.step / STEPS_PER_BAR);
      const s = this.step % STEPS_PER_BAR;
      const t = this.nextGridT + swingOffset(s, this.song.swing(), stepS);
      for (const note of stepNotes(this.song, bar, s)) this.play(note, t, stepS);
      this.nextGridT += stepS;
      this.step += 1;
    }
  }

  private play(note: MusicNote, t: number, stepS: number): void {
    const lenS = (note.lenSteps ?? 1) * stepS;
    const d: Dest = { ctx: this.ctx, out: this.tone, t };
    if (note.part === 'bass') {
      if (note.midi !== undefined) this.bass?.note(t, note.midi, lenS, note.vel);
    } else if (note.part === 'chord') {
      if (note.midis) playChord(d, this.song.style, note.midis, lenS, note.vel);
    } else {
      playDrum(d, this.kit[note.part], note.vel);
    }
  }

  /** Move the grid to t without playing the skipped steps (resume after pause or a stall). */
  resync(t: number): void {
    const stepS = stepSeconds(this.song);
    if (this.nextGridT >= t) return;
    const skipped = Math.ceil((t - this.nextGridT) / stepS);
    this.nextGridT += skipped * stepS;
    this.step += skipped;
  }

  /** Fade out and release every node at t + fadeS. */
  stop(t: number, fadeS = 0.35): void {
    if (!this.running) return;
    this.running = false;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(SILENT, t, fadeS / 4);
    const end = t + fadeS + 0.05;
    this.crackle?.stop(end);
    this.bass?.stop(end);
    this.crackle = null;
    this.crackleGain = null;
    this.bass = null;
    const bus = this.bus;
    if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(() => bus.disconnect(), (fadeS + 0.3) * 1000);
  }
}
