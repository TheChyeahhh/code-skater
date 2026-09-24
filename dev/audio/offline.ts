/**
 * dev/audio/offline.ts (audio track harness): renders every voice, loop and song through an
 * OfflineAudioContext in the real browser and measures the samples (RMS, peak, NaN count), so
 * "each sound renders non-silent audio without NaN" is checked on real Web Audio, not a fake.
 * dev/audio.html?verify runs it at load; node dev/audio/verify.mjs reads the report.
 */

import { GrindLoop, RollLoop, WindLoop } from '../../src/audio/loops';
import { MusicPlayer } from '../../src/audio/music';
import { SONGS, STEPS_PER_BAR, barAt, songBars, stepSeconds } from '../../src/audio/songs';
import type { MusicTrack } from '../../src/audio/types';
import { VOICE_IDS, playVoice, type VoiceId, type VoiceParams } from '../../src/audio/voices';

export interface RenderRow {
  readonly group: 'voice' | 'loop' | 'song' | 'section';
  readonly name: string;
  readonly seconds: number;
  readonly rms: number;
  readonly peak: number;
  readonly nan: number;
  readonly renderMs: number;
  readonly ok: boolean;
}

export interface RenderReport {
  readonly rows: readonly RenderRow[];
  readonly failed: number;
  readonly sampleRate: number;
}

const SR = 44100;
/** Below this RMS a render counts as silent (about -70 dBFS). */
const MIN_RMS = 3e-4;

/** Voice variants the report renders separately. */
export interface VoiceCase {
  readonly id: VoiceId;
  readonly label: string;
  readonly params: VoiceParams;
}

export const VOICE_CASES: readonly VoiceCase[] = VOICE_IDS.flatMap((id): VoiceCase[] => {
  switch (id) {
    case 'land': return [{ id, label: 'land clean', params: { variant: 'clean', intensity: 0.6 } }, { id, label: 'land ok', params: { variant: 'ok', intensity: 0.6 } }];
    case 'grindOn': case 'grindSwitch': case 'grindOff':
      return (['rail', 'ledge', 'coping'] as const).map((k) => ({ id, label: `${id} ${k}`, params: { variant: k } }));
    case 'comboBank': return (['clean', 'sick', 'insane'] as const).map((q) => ({ id, label: `comboBank ${q}`, params: { variant: q, intensity: 0.6 } }));
    case 'letter': return [0, 1, 2, 3].map((i) => ({ id, label: `letter ${'CODE'[i]}`, params: { index: i } }));
    case 'clockTick': return [{ id, label: 'clockTick 9', params: { index: 9 } }, { id, label: 'clockTick 3', params: { index: 3 } }];
    default: return [{ id, label: id, params: {} }];
  }
});

function measure(data: Float32Array, from = 0, to = data.length): { rms: number; peak: number; nan: number } {
  let sum = 0;
  let peak = 0;
  let nan = 0;
  for (let i = from; i < to; i++) {
    const v = data[i] as number;
    if (!Number.isFinite(v)) {
      nan += 1;
      continue;
    }
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sum / Math.max(1, to - from)), peak, nan };
}

async function render(seconds: number, build: (ctx: OfflineAudioContext, out: AudioNode) => void): Promise<{ data: Float32Array; ms: number }> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  build(ctx, out);
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  return { data: buf.getChannelData(0), ms: performance.now() - t0 };
}

function row(group: RenderRow['group'], name: string, seconds: number, m: { rms: number; peak: number; nan: number }, renderMs: number): RenderRow {
  return { group, name, seconds, ...m, renderMs, ok: m.nan === 0 && m.rms >= MIN_RMS };
}

export async function renderVoices(): Promise<RenderRow[]> {
  const rows: RenderRow[] = [];
  for (const c of VOICE_CASES) {
    let tail = 1;
    const { data, ms } = await render(2, (ctx, out) => {
      tail = playVoice(c.id, { ctx, out, t: 0.01 }, c.params);
    });
    const end = Math.min(data.length, Math.ceil((tail + 0.02) * SR));
    rows.push(row('voice', c.label, tail, measure(data, 0, end), ms));
  }
  return rows;
}

export async function renderLoops(): Promise<RenderRow[]> {
  const cases: [string, (ctx: OfflineAudioContext, out: AudioNode) => { set(l: number, r: number): void }][] = [
    ['roll concrete', (c, o) => new RollLoop(c, o, 'concrete')],
    ['roll wood', (c, o) => new RollLoop(c, o, 'wood')],
    ['grind rail', (c, o) => new GrindLoop(c, o, 'rail')],
    ['grind ledge', (c, o) => new GrindLoop(c, o, 'ledge')],
    ['grind coping', (c, o) => new GrindLoop(c, o, 'coping')],
    ['wind', (c, o) => new WindLoop(c, o)],
  ];
  const rows: RenderRow[] = [];
  for (const [name, make] of cases) {
    const { data, ms } = await render(1.2, (ctx, out) => make(ctx, out).set(0.4, 0.7));
    rows.push(row('loop', name, 1.2, measure(data, Math.floor(0.3 * SR)), ms));
  }
  return rows;
}

/** One full pass of the arrangement plus 2 bars of the loop; one row per song and per section. */
export async function renderSong(track: MusicTrack): Promise<RenderRow[]> {
  const song = SONGS[track];
  const bars = songBars(song) + 2;
  const stepS = stepSeconds(song);
  const barS = stepS * STEPS_PER_BAR;
  const t0 = 0.05;
  const seconds = t0 + bars * barS + 1;
  const { data, ms } = await render(seconds, (ctx, out) => {
    const p = new MusicPlayer(ctx, out, song);
    p.start(t0);
    p.pump(t0 + bars * barS);
  });
  const rows: RenderRow[] = [row('song', `${track} @ ${song.bpm()} bpm`, bars * barS, measure(data), ms)];
  let bar = 0;
  while (bar < bars) {
    const plan = barAt(song, bar);
    const len = plan.section.bars - plan.barInSection;
    const from = Math.floor((t0 + bar * barS) * SR);
    const to = Math.min(data.length, Math.floor((t0 + (bar + len) * barS) * SR));
    rows.push(row('section', `${track} ${plan.section.name} (bars ${bar + 1}-${bar + len})`, len * barS, measure(data, from, to), 0));
    bar += len;
  }
  return rows;
}

export async function renderAll(): Promise<RenderReport> {
  const rows: RenderRow[] = [...(await renderVoices()), ...(await renderLoops())];
  for (const t of ['menu', 'marketStreet', 'woodshed'] as const) rows.push(...(await renderSong(t)));
  return { rows, failed: rows.filter((r) => !r.ok).length, sampleRate: SR };
}
