// tests/audio.test.ts (audio track): REQ-AUD-01..03 in node. The event -> voice map covers every
// SimEvent type; every voice, loop and song schedules only finite, well-ordered Web Audio calls on a
// recording fake context (tests/fixtures/audio/fakeContext.ts); the songs are real arrangements, not a
// 2-bar loop, and follow the live tempo tuning; the engine is a no-op before init and plays after it;
// the player's folder is filtered and shuffled; no audio file ships. Audible output (RMS, no NaN) is
// measured in a real browser by dev/audio.html?verify (node dev/audio/verify.mjs).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../src/audio/engine';
import { EVENT_VOICES, SILENT_EVENTS, voicesForEvent } from '../src/audio/eventMap';
import { GrindLoop, RollLoop, WindLoop } from '../src/audio/loops';
import { MusicPlayer } from '../src/audio/music';
import { SONGS, STEPS_PER_BAR, barAt, loopStartBar, songBars, stepNotes, stepSeconds, swingOffset } from '../src/audio/songs';
import { isPlayableAudioFile, shuffled } from '../src/audio/userMusic';
import { VOICES, VOICE_IDS, playVoice, type VoiceParams } from '../src/audio/voices';
import type { SimEventType } from '../src/core/events';
import { mockEventsAt, mockSnapshotAt, restSnapshot } from '../src/core/mock';
import { TUNING, resetTuning } from '../src/core/tuning';
import { ONE_OF_EACH } from './fixtures/audio/events';
import { FakeContext } from './fixtures/audio/fakeContext';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

afterEach(() => {
  resetTuning();
  vi.useRealTimers();
});

function eventTypesFromSource(): string[] {
  const src = readFileSync(join(ROOT, 'src/core/events.ts'), 'utf8');
  const union = src.slice(src.indexOf('export type SimEvent ='), src.indexOf('export type SimEventType'));
  return [...union.matchAll(/readonly type: '(\w+)'/g)].map((m) => m[1] as string).sort();
}

describe('REQ-AUD-01: every SimEvent has a voice entry', () => {
  it('EVENT_VOICES covers exactly the SimEvent union in src/core/events.ts', () => {
    const types = eventTypesFromSource();
    expect(types.length).toBeGreaterThan(30);
    expect(Object.keys(EVENT_VOICES).sort()).toEqual(types);
  });

  it('the fixture has one event of every type', () => {
    expect([...new Set(ONE_OF_EACH.map((e) => e.type))].sort()).toEqual(eventTypesFromSource());
  });

  it('an event is silent only when SILENT_EVENTS says why; every other event plays a known voice', () => {
    for (const e of ONE_OF_EACH) {
      const calls = voicesForEvent(e);
      if (calls.length === 0) {
        expect(SILENT_EVENTS[e.type], `${e.type} is silent without a reason`).toBeTruthy();
      } else {
        expect(SILENT_EVENTS[e.type], `${e.type} plays but is listed silent`).toBeUndefined();
        for (const c of calls) expect(VOICE_IDS, e.type).toContain(c.voice);
      }
    }
  });

  it('the brief sound list maps to voices', () => {
    const voiceOf = (type: SimEventType): string[] => voicesForEvent(ONE_OF_EACH.find((e) => e.type === type) as never).map((c) => c.voice);
    expect(voiceOf('pop')).toEqual(['pop']);
    expect(voiceOf('land')).toEqual(['land']);
    expect(voiceOf('grindStart')).toEqual(['grindOn']);
    expect(voiceOf('grindSwitch')).toEqual(['grindSwitch']);
    expect(voiceOf('lipStart')).toEqual(['lipStall']);
    expect(voiceOf('manualStart')).toEqual(['manualSqueak']);
    expect(voiceOf('revert')).toEqual(['revertScuff']);
    expect(voiceOf('bail')).toEqual(['bail']);
    expect(voiceOf('specialReady')).toEqual(['specialReady']);
    expect(voiceOf('specialUsed')).toEqual(['specialUsed']);
    expect(voiceOf('gap')).toEqual(['gap']);
    expect(voiceOf('letter')).toEqual(['letter']);
    expect(voiceOf('macguffin')).toEqual(['macguffin']);
    expect(voiceOf('goalCompleted')).toEqual(['goal']);
    expect(voiceOf('comboBanked')).toEqual(['comboBank']);
    expect(voiceOf('comboLost')).toEqual(['comboLost']);
    expect(voiceOf('runEnd')).toEqual(['runEndHorn']);
    expect(voiceOf('runTick')).toEqual(['clockTick']);
  });

  it('land, bank and grind voices carry quality and rail kind', () => {
    expect(voicesForEvent({ type: 'land', tick: 0, quality: 'ok', offAxisDeg: 15, tiltDeg: 0, vert: false, speed: 5, pos: { x: 0, y: 0, z: 0 }, linker: 'none' })[0]?.params?.variant).toBe('ok');
    expect(voicesForEvent({ type: 'land', tick: 0, quality: 'clean', offAxisDeg: 2, tiltDeg: 0, vert: true, speed: 5, pos: { x: 0, y: 0, z: 0 }, linker: 'none' })[0]?.params?.variant).toBe('clean');
    expect(voicesForEvent({ type: 'comboBanked', tick: 0, final: 99999, base: 1, multiplier: 1, elementCount: 1, quality: 'insane', runScore: 0 })[0]?.params?.variant).toBe('insane');
    for (const railKind of ['rail', 'ledge', 'coping'] as const) {
      const call = voicesForEvent({ type: 'grindStart', tick: 0, railId: 'R', railKind, grindType: 'fifty_fifty', pos: { x: 0, y: 0, z: 0 }, speed: 5 })[0];
      expect(call?.params?.variant).toBe(railKind);
    }
  });

  it('the clock ticks only under AUDIO_CLOCK_TICK_FROM_S, read live', () => {
    const tick = (s: number): number => voicesForEvent({ type: 'runTick', tick: 0, secondsLeft: s }).length;
    expect(tick(10)).toBe(0);
    expect(tick(9)).toBe(1);
    expect(tick(1)).toBe(1);
    expect(tick(0)).toBe(0);
    expect(tick(60)).toBe(0);
    TUNING.AUDIO_CLOCK_TICK_FROM_S = 30;
    expect(tick(20)).toBe(1);
  });

  it('bad numbers never reach a voice as NaN', () => {
    const calls = voicesForEvent({ type: 'bail', tick: 0, reason: 'wall', speed: Number.NaN, pos: { x: 0, y: 0, z: 0 } });
    expect(Number.isFinite(calls[0]?.params?.intensity)).toBe(true);
  });
});

const VARIANTS: Partial<Record<(typeof VOICE_IDS)[number], VoiceParams[]>> = {
  land: [{ variant: 'clean', intensity: 0.5 }, { variant: 'ok', intensity: 1 }],
  grindOn: [{ variant: 'rail' }, { variant: 'ledge' }, { variant: 'coping' }],
  grindSwitch: [{ variant: 'rail' }, { variant: 'ledge' }, { variant: 'coping' }],
  comboBank: [{ variant: 'clean' }, { variant: 'sick' }, { variant: 'insane', intensity: 1 }],
  letter: [{ index: 0 }, { index: 3 }],
  clockTick: [{ index: 9 }, { index: 2 }],
};

describe('REQ-AUD-01: every voice schedules clean Web Audio (fake context)', () => {
  it.each([...VOICE_IDS])('%s', (id) => {
    for (const params of VARIANTS[id] ?? [{}, { intensity: Number.NaN }]) {
      const ctx = new FakeContext();
      ctx.currentTime = 1.5;
      const out = ctx.createGain();
      const tail = playVoice(id, { ctx: ctx.asAudio, out: out as unknown as AudioNode, t: 1.5 }, params);
      expect(ctx.problems, `${id} ${JSON.stringify(params)}`).toEqual([]);
      expect(tail).toBeGreaterThan(0);
      expect(tail).toBeLessThan(3);
      expect(ctx.sources.length, id).toBeGreaterThan(0);
      for (const s of ctx.sources) {
        expect(s.startT, id).toBeGreaterThanOrEqual(1.5);
        expect(s.stopT, `${id} source never stops`).not.toBeNull();
      }
      expect(ctx.unreached(out), `${id}: sources not reaching out`).toEqual([]);
    }
  });

  it('the voice table and the id list agree', () => {
    expect(Object.keys(VOICES).sort()).toEqual([...VOICE_IDS].sort());
  });
});

describe('REQ-AUD-01: continuous loops', () => {
  it('roll (wood, concrete), grind (rail, ledge, coping) and wind glide and stop cleanly', () => {
    const ctx = new FakeContext();
    const out = ctx.createGain() as unknown as AudioNode;
    const loops = [
      new RollLoop(ctx.asAudio, out, 'wood'), new RollLoop(ctx.asAudio, out, 'concrete'),
      new GrindLoop(ctx.asAudio, out, 'rail'), new GrindLoop(ctx.asAudio, out, 'ledge'), new GrindLoop(ctx.asAudio, out, 'coping'),
      new WindLoop(ctx.asAudio, out),
    ];
    for (const l of loops) {
      for (const r of [0, 0.5, 1, Number.NaN]) l.set(0.3, r);
      l.set(Number.NaN, 0.5);
      ctx.currentTime += 0.5;
      l.stop();
      expect(l.isStopped).toBe(true);
    }
    expect(ctx.problems).toEqual([]);
    expect(ctx.sources.every((s) => s.stopT !== null)).toBe(true);
    expect(ctx.unreached(out as never)).toEqual([]);
  });

  it('grind loops by rail kind differ: metal rails sing a note, a concrete ledge does not', () => {
    const count = (kind: 'rail' | 'ledge' | 'coping'): number => {
      const ctx = new FakeContext();
      new GrindLoop(ctx.asAudio, ctx.createGain() as unknown as AudioNode, kind);
      return ctx.sources.filter((s) => s.kind === 'osc').length;
    };
    expect(count('rail')).toBeGreaterThan(1);
    expect(count('coping')).toBeGreaterThan(1);
    expect(count('ledge')).toBe(0);
  });
});

describe('REQ-AUD-02: songs', () => {
  const tracks = Object.keys(SONGS) as (keyof typeof SONGS)[];

  it('there is a song for the menu and each park', () => {
    expect(tracks.sort()).toEqual(['labCampus', 'marketStreet', 'menu', 'woodshed']);
  });

  it.each(tracks)('%s: pattern strings are 16 steps of known symbols', (id) => {
    const song = SONGS[id];
    for (const [barId, bar] of Object.entries(song.drumBars)) {
      for (const [part, line] of Object.entries(bar)) {
        expect(line, `${barId}.${part}`).toMatch(/^[Xxg.]{16}$/);
      }
    }
    expect(song.bassLine).toMatch(/^[rofbmn.-]{16}$/);
    if (song.bassLineB) expect(song.bassLineB).toMatch(/^[rofbmn.-]{16}$/);
    expect(song.chordRhythm).toMatch(/^[X.-]{16}$/);
    for (const s of song.sections) {
      for (const d of [...s.drums, ...(s.fill ? [s.fill] : [])]) expect(song.drumBars[d], `${s.name} -> ${d}`).toBeDefined();
    }
  });

  it.each(tracks)('%s: an arrangement of sections, not a 2-bar loop', (id) => {
    const song = SONGS[id];
    expect(song.sections.length).toBeGreaterThanOrEqual(3);
    expect(songBars(song)).toBeGreaterThanOrEqual(16);
    expect(song.loopFrom).toBeGreaterThanOrEqual(0);
    expect(song.loopFrom).toBeLessThan(song.sections.length);
    // Distinct drum bars and chord changes across one pass.
    const drumIds = new Set<string>();
    const chords = new Set<string>();
    for (let n = 0; n < songBars(song); n++) {
      drumIds.add(barAt(song, n).drumBarId);
      for (let s = 0; s < STEPS_PER_BAR; s++) for (const note of stepNotes(song, n, s)) if (note.part === 'chord') chords.add(String(note.midis));
    }
    expect(drumIds.size).toBeGreaterThanOrEqual(2);
    expect(chords.size).toBeGreaterThanOrEqual(4);
  });

  it('bars loop back to the loop section after the last bar', () => {
    const song = SONGS.marketStreet;
    const total = songBars(song);
    const loop0 = loopStartBar(song);
    expect(barAt(song, total).sectionIndex).toBe(song.loopFrom);
    expect(barAt(song, total + 3)).toEqual(barAt(song, loop0 + 3));
    expect(barAt(song, 0).section.name).toBe('intro');
  });

  it('street is a boom-bap break: kick on 1, backbeat snare, ghost notes, swing', () => {
    const song = SONGS.marketStreet;
    const firstA = loopStartBar(song);
    const at = (s: number) => stepNotes(song, firstA + 1, s);
    expect(at(0).some((n) => n.part === 'kick')).toBe(true);
    expect(at(4).some((n) => n.part === 'snare' && n.vel > 0.8)).toBe(true);
    expect(at(12).some((n) => n.part === 'snare' && n.vel > 0.8)).toBe(true);
    const ghosts = Array.from({ length: 16 }, (_, s) => at(s)).flat().filter((n) => n.part === 'snare' && n.vel < 0.4);
    expect(ghosts.length).toBeGreaterThan(0);
    expect(song.swing()).toBeGreaterThan(0.5);
    const stepS = stepSeconds(song);
    expect(swingOffset(0, song.swing(), stepS)).toBe(0);
    expect(swingOffset(1, song.swing(), stepS)).toBeCloseTo((2 * song.swing() - 1) * stepS, 9);
    expect(stepNotes(song, firstA, 0).some((n) => n.part === 'crash')).toBe(true);
  });

  it('tempo follows the locked MUSIC_BPM_* keys live', () => {
    expect(SONGS.marketStreet.bpm()).toBe(TUNING.MUSIC_BPM_STREET);
    expect(SONGS.woodshed.bpm()).toBe(TUNING.MUSIC_BPM_WOODSHED);
    const before = stepSeconds(SONGS.woodshed);
    // A live dev-panel edit below the locked default (DESIGN L CR-41: 170) slows the song down.
    TUNING.MUSIC_BPM_WOODSHED = 150;
    expect(stepSeconds(SONGS.woodshed)).toBeCloseTo(60 / 150 / 4, 9);
    expect(stepSeconds(SONGS.woodshed)).toBeGreaterThan(before);
  });

  it.each(tracks)('%s: a full pass plus the loop schedules cleanly with the lookahead player', (id) => {
    const ctx = new FakeContext();
    const out = ctx.createGain();
    const song = SONGS[id];
    const player = new MusicPlayer(ctx.asAudio, out as unknown as AudioNode, song);
    player.start(0.1);
    const passS = (songBars(song) + 2) * STEPS_PER_BAR * stepSeconds(song);
    // Pump like the engine does: small hops of the audio clock.
    for (let t = 0; t < passS; t += 0.025) {
      ctx.currentTime = t;
      player.pump(t + TUNING.AUDIO_LOOKAHEAD_S);
    }
    expect(ctx.problems).toEqual([]);
    expect(player.position.bar).toBeGreaterThanOrEqual(songBars(song));
    expect(ctx.sources.length).toBeGreaterThan(songBars(song) * 8);
    expect(ctx.unreached(out)).toEqual([]);
    // Nothing is ever scheduled in the past of the clock at the time it was scheduled.
    for (const s of ctx.sources) expect(s.startT).toBeGreaterThanOrEqual(0.1);
    player.stop(ctx.currentTime);
    expect(ctx.problems).toEqual([]);
  });

  it('after a stall the player skips ahead instead of bursting the missed notes', () => {
    const ctx = new FakeContext();
    const player = new MusicPlayer(ctx.asAudio, ctx.createGain() as unknown as AudioNode, SONGS.woodshed);
    player.start(0);
    player.pump(0.1);
    const before = ctx.sources.length;
    ctx.currentTime = 5;
    player.pump(5.1);
    const burst = ctx.sources.slice(before);
    expect(burst.every((s) => (s.startT ?? 0) >= 5)).toBe(true);
    expect(burst.length).toBeLessThan(40);
  });
});

describe('REQ-AUD-03 + engine', () => {
  it('before init every method is a silent no-op (node has no AudioContext)', async () => {
    const engine = createAudioEngine();
    expect(engine.ready).toBe(false);
    for (const e of ONE_OF_EACH) engine.onEvent(e);
    engine.update(restSnapshot('marketStreet'), 1 / 60);
    engine.update(null, 1 / 60);
    engine.playMusic('marketStreet');
    engine.setVolumes({ music: 0.5, sfx: 0.5 });
    engine.uiSound('confirm');
    engine.setPaused(true);
    engine.setPaused(false);
    engine.useUserMusic(true);
    expect(await engine.loadUserMusic([])).toBe(0);
    await engine.init(); // no AudioContext in node: stays not ready, does not throw
    expect(engine.ready).toBe(false);
    engine.dispose();
  });

  it('adopts the gate context, plays events, loops and music, pauses and disposes cleanly', async () => {
    vi.useFakeTimers();
    const ctx = new FakeContext();
    const engine = createAudioEngine();
    engine.playMusic('marketStreet');
    await engine.init(ctx.asAudio);
    await engine.init(ctx.asAudio); // idempotent
    expect(engine.ready).toBe(true);
    const musicSources = (): number => ctx.sources.length;
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.025;
      vi.advanceTimersByTime(TUNING.AUDIO_SCHEDULER_MS);
    }
    const afterMusic = musicSources();
    expect(afterMusic).toBeGreaterThan(10);

    for (const e of ONE_OF_EACH) engine.onEvent(e);
    for (let tick = 0; tick < 8 * 120; tick += 2) {
      engine.update(mockSnapshotAt(tick), 1 / 60);
      for (const e of mockEventsAt(tick)) engine.onEvent(e);
    }
    engine.uiSound('move');
    engine.setVolumes({ music: Number.NaN, sfx: 2 });
    engine.update(null, 1 / 60);

    engine.setPaused(true);
    const paused = ctx.sources.length;
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.025;
      vi.advanceTimersByTime(TUNING.AUDIO_SCHEDULER_MS);
    }
    expect(ctx.sources.length, 'no music scheduled while paused').toBe(paused);
    engine.setPaused(false);
    for (let i = 0; i < 20; i++) {
      ctx.currentTime += 0.025;
      vi.advanceTimersByTime(TUNING.AUDIO_SCHEDULER_MS);
    }
    expect(ctx.sources.length).toBeGreaterThan(paused);

    engine.playMusic('woodshed');
    engine.playMusic(null);
    engine.dispose();
    expect(engine.ready).toBe(false);
    expect(ctx.problems).toEqual([]);
    expect(ctx.danglingSources()).toEqual([]);
  });
});

describe('REQ-AUD-02: the player music folder', () => {
  it('keeps only audio files', () => {
    const files = [
      { name: 'a.mp3', type: 'audio/mpeg' },
      { name: 'b.MP3', type: '' },
      { name: 'cover.jpg', type: 'image/jpeg' },
      { name: 'notes.txt', type: 'text/plain' },
      { name: 'c.ogg', type: '' },
      { name: 'desktop.ini', type: '' },
    ];
    expect(files.filter(isPlayableAudioFile).map((f) => f.name)).toEqual(['a.mp3', 'b.MP3', 'c.ogg']);
  });

  it('loadUserMusic resolves to the playable count', async () => {
    const engine = createAudioEngine();
    const files = [new File(['x'], 'one.mp3', { type: 'audio/mpeg' }), new File(['x'], 'two.mp3', { type: 'audio/mpeg' }), new File(['x'], 'x.png', { type: 'image/png' })];
    expect(await engine.loadUserMusic(files)).toBe(2);
  });

  it('shuffle is a permutation', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let s = 1;
    const out = shuffled(items, () => ((s = (s * 16807) % 2147483647) / 2147483647));
    expect([...out].sort((a, b) => a - b)).toEqual(items);
    expect(out).not.toEqual(items);
  });
});

describe('REQ-AUD-01: zero audio files', () => {
  it('no audio file sits in src/, dev/ or public/, and src/audio loads no URL', () => {
    const walk = (dir: string): string[] => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    };
    const files = ['src', 'dev', 'public'].flatMap((d) => walk(join(ROOT, d)));
    expect(files.filter((f) => /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(f))).toEqual([]);
    for (const f of walk(join(ROOT, 'src/audio'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/https?:|fetch\(|decodeAudioData/);
    }
  });
});
