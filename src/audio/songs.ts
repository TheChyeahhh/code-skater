/**
 * src/audio/songs.ts (audio track): the synthesized Y2K breakbeat songs as pure data (REQ-AUD-02).
 * A song is drum bars written as 16-step strings, chord progressions, a bass line and an arrangement
 * of sections, so a park plays a whole tune (intro, A, B, break, A, loop) instead of a 2-bar loop.
 * Pure and deterministic: tests read it in node; src/audio/music.ts turns it into sound.
 *
 * Step strings, 16 steps per bar (16th notes):
 *   drums  'X' accent, 'x' normal, 'g' ghost, '.' rest
 *   bass   'r' root, 'o' octave, 'f' fifth, 'b' flat seventh, 'm' minor third, 'n' tone below; '-' holds; '.' rest
 *   chords 'X' hit, '-' holds, '.' rest
 */

import { TUNING } from '../core/tuning';
import type { MusicTrack } from './types';

export const STEPS_PER_BAR = 16;

export type DrumPart = 'kick' | 'snare' | 'hat' | 'openHat' | 'rim' | 'crash';
export const DRUM_PARTS: readonly DrumPart[] = ['kick', 'snare', 'hat', 'openHat', 'rim', 'crash'];

export type DrumBar = Readonly<Partial<Record<DrumPart, string>>>;

export interface Chord {
  /** Bass root, MIDI. */
  readonly root: number;
  /** Voicing, MIDI. */
  readonly notes: readonly number[];
}

export interface SectionDef {
  readonly name: string;
  readonly bars: number;
  /** Drum bar ids, cycled bar by bar. */
  readonly drums: readonly string[];
  /** Drum bar id replacing the section's last bar. */
  readonly fill?: string;
  /** Progression override for this section (else the song's). */
  readonly progression?: readonly Chord[];
  readonly bass: boolean;
  readonly chords: boolean;
  /** Crash on the section's first downbeat. */
  readonly crash: boolean;
}

export type SongStyle = 'street' | 'woodshed';

export interface SongDef {
  readonly id: MusicTrack;
  readonly style: SongStyle;
  /** Live tempo (locked MUSIC_BPM_* keys, REQ-AUD-02). */
  bpm(): number;
  /** Live 16th swing ratio, 0.5 = straight. */
  swing(): number;
  /** Vinyl crackle bed under the whole song. */
  readonly crackle: boolean;
  /** Drum level for this song (the menu plays softer). */
  readonly drumLevel: number;
  readonly drumBars: Readonly<Record<string, DrumBar>>;
  readonly progression: readonly Chord[];
  readonly bassLine: string;
  /** Bass line for sections that override the progression (else bassLine). */
  readonly bassLineB?: string;
  readonly chordRhythm: string;
  readonly sections: readonly SectionDef[];
  /** Section index the song loops back to after the last section. */
  readonly loopFrom: number;
}

export type MusicPart = DrumPart | 'bass' | 'chord';

/** One note to schedule at a step. lenSteps is the note length for bass and chords. */
export interface MusicNote {
  readonly part: MusicPart;
  readonly vel: number;
  readonly midi?: number;
  readonly midis?: readonly number[];
  readonly lenSteps?: number;
}

export interface BarPlan {
  readonly sectionIndex: number;
  readonly section: SectionDef;
  readonly barInSection: number;
  readonly drumBarId: string;
}

// --- Market Street: dusty boom-bap in A minor ------------------------------------------------

const AM9: Chord = { root: 45, notes: [60, 64, 67, 71] };
const DM9: Chord = { root: 38, notes: [53, 57, 60, 64] };
const FMAJ9: Chord = { root: 41, notes: [57, 60, 64, 67] };
const E7B9: Chord = { root: 40, notes: [56, 59, 62, 65] };
const EM9: Chord = { root: 40, notes: [55, 59, 62, 66] };
const G13: Chord = { root: 43, notes: [53, 59, 62, 64] };

const STREET_DRUMS: Record<string, DrumBar> = {
  intro: { hat: 'g.g.g.g.g.g.g.g.', rim: '....x.......x...' },
  a1: { kick: 'X.....x...X.....', snare: '....X..g.g..X..g', hat: 'x.xgx.xgx.xgx.x.' },
  a2: { kick: 'X.....x.X.x.....', snare: '....X..g....X.g.', hat: 'x.x.x.xgx.x.x...', openHat: '..............x.' },
  fill: { kick: 'X.....x...X.X...', snare: '....X..g..g.XxXX', hat: 'x.x.x.x.x.x.....' },
  brk: { kick: 'X..X..x...X..x..', snare: '....X..gX.g.X..g', hat: 'xgxgxgxgxgxgxgxg' },
  soft: { kick: 'x.........x.....', rim: '....x.......x...', hat: 'g.g.g.g.g.g.g.g.' },
};

const MARKET_STREET: SongDef = {
  id: 'marketStreet',
  style: 'street',
  bpm: () => TUNING.MUSIC_BPM_STREET,
  swing: () => TUNING.AUDIO_SWING_STREET,
  crackle: true,
  drumLevel: 1,
  drumBars: STREET_DRUMS,
  progression: [AM9, DM9, FMAJ9, E7B9],
  bassLine: 'r--.....r-.f..o.',
  bassLineB: 'r-....r.f-..b.r.',
  chordRhythm: 'X---------..X---',
  sections: [
    { name: 'intro', bars: 2, drums: ['intro'], bass: false, chords: true, crash: false },
    { name: 'A', bars: 8, drums: ['a1', 'a1', 'a1', 'a2'], fill: 'fill', bass: true, chords: true, crash: true },
    { name: 'B', bars: 8, drums: ['a2', 'a1'], fill: 'fill', progression: [FMAJ9, EM9, DM9, G13], bass: true, chords: true, crash: true },
    { name: 'break', bars: 2, drums: ['brk'], bass: true, chords: false, crash: false },
    { name: 'A2', bars: 8, drums: ['a1', 'a2'], fill: 'fill', bass: true, chords: true, crash: true },
  ],
  loopFrom: 1,
};

// --- Menu: the Street loop's quiet cousin ------------------------------------------------------

const MENU: SongDef = {
  ...MARKET_STREET,
  id: 'menu',
  drumLevel: 0.6,
  sections: [
    { name: 'intro', bars: 4, drums: ['intro'], bass: false, chords: true, crash: false },
    { name: 'A', bars: 8, drums: ['soft'], bass: true, chords: true, crash: false },
    { name: 'B', bars: 8, drums: ['soft', 'intro'], progression: [FMAJ9, EM9, DM9, G13], bass: true, chords: true, crash: false },
  ],
  loopFrom: 0,
};

// --- Woodshed: fast punk breakbeat in E ------------------------------------------------------

const E5: Chord = { root: 40, notes: [52, 59, 64] };
const C5: Chord = { root: 36, notes: [48, 55, 60] };
const G5: Chord = { root: 43, notes: [55, 62, 67] };
const D5: Chord = { root: 38, notes: [50, 57, 62] };
const A5: Chord = { root: 45, notes: [57, 64, 69] };

const WOODSHED_DRUMS: Record<string, DrumBar> = {
  intro: { kick: 'X.......X.......', hat: 'x.x.x.x.x.x.x.x.' },
  a1: { kick: 'X.........X.....', snare: '....X..g.g..X...', hat: 'x.x.x.x.x.x.x.x.' },
  a2: { kick: 'X.X.......XX....', snare: '....X..g.g..X..g', hat: 'x.x.x.x.x.x.x...', openHat: '...............x' },
  punk: { kick: 'X.x...x.X.x...x.', snare: '....X.......X...', openHat: 'x.x.x.x.x.x.x.x.' },
  fill: { kick: 'X.........X.....', snare: '....X...XxXxXXXX', hat: 'x.x.x.x.........' },
  brk: { kick: 'X.X...X...XX..X.', snare: '....X..gX.g.X..g', hat: 'xgxgxgxgxgxgxgxg' },
};

const WOODSHED: SongDef = {
  id: 'woodshed',
  style: 'woodshed',
  bpm: () => TUNING.MUSIC_BPM_WOODSHED,
  swing: () => TUNING.AUDIO_SWING_WOODSHED,
  crackle: false,
  drumLevel: 1,
  drumBars: WOODSHED_DRUMS,
  progression: [E5, C5, G5, D5],
  bassLine: 'r.r.r.r.r.r.o.f.',
  bassLineB: 'r-.rr-.rf-.fo-.o',
  chordRhythm: 'X-....X-....X-X-',
  sections: [
    { name: 'intro', bars: 2, drums: ['intro'], bass: true, chords: false, crash: false },
    { name: 'A', bars: 8, drums: ['a1', 'a2'], fill: 'fill', bass: true, chords: true, crash: true },
    { name: 'B', bars: 8, drums: ['punk'], fill: 'fill', progression: [A5, E5, C5, D5], bass: true, chords: true, crash: true },
    { name: 'break', bars: 2, drums: ['brk'], bass: false, chords: false, crash: false },
    { name: 'A2', bars: 8, drums: ['a1', 'a2'], fill: 'fill', bass: true, chords: true, crash: true },
  ],
  loopFrom: 1,
};

/** Lab Campus (2026-09-23): the street's dusty kit at a slower, darker night tempo, no vinyl bed. */
const LAB_CAMPUS: SongDef = {
  ...MARKET_STREET,
  id: 'labCampus',
  bpm: () => TUNING.MUSIC_BPM_CAMPUS,
  crackle: false,
  progression: [DM9, FMAJ9, AM9, E7B9],
};

export const SONGS: Readonly<Record<MusicTrack, SongDef>> = {
  menu: MENU,
  marketStreet: MARKET_STREET,
  woodshed: WOODSHED,
  labCampus: LAB_CAMPUS,
};

// --- Pure helpers ------------------------------------------------------------------------------

/** Total bars of one pass through the arrangement. */
export function songBars(song: SongDef): number {
  return song.sections.reduce((n, s) => n + s.bars, 0);
}

/** First bar of the loop section. */
export function loopStartBar(song: SongDef): number {
  let n = 0;
  for (let i = 0; i < song.loopFrom; i++) n += song.sections[i]?.bars ?? 0;
  return n;
}

/** Which section and drum bar the song's bar n plays (n counts from the song start, loops forever). */
export function barAt(song: SongDef, n: number): BarPlan {
  const total = songBars(song);
  const loop0 = loopStartBar(song);
  let bar = n < total ? n : loop0 + ((n - total) % Math.max(1, total - loop0));
  for (let i = 0; i < song.sections.length; i++) {
    const s = song.sections[i] as SectionDef;
    if (bar < s.bars) {
      const last = bar === s.bars - 1;
      const drumBarId = last && s.fill ? s.fill : (s.drums[bar % s.drums.length] as string);
      return { sectionIndex: i, section: s, barInSection: bar, drumBarId };
    }
    bar -= s.bars;
  }
  const s0 = song.sections[0] as SectionDef;
  return { sectionIndex: 0, section: s0, barInSection: 0, drumBarId: s0.drums[0] as string };
}

const DRUM_VEL: Readonly<Record<string, number>> = { X: 1, x: 0.7, g: 0.28 };
const BASS_INTERVAL: Readonly<Record<string, number>> = { r: 0, o: 12, f: 7, b: 10, m: 3, n: -2 };

/** Deterministic 0..1 hash for humanizing velocities. */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Length of a note starting at `step`: 1 plus the '-' holds after it. */
function holdLen(line: string, step: number): number {
  let n = 1;
  while (step + n < STEPS_PER_BAR && line[step + n] === '-') n++;
  return n;
}

/** Every note the song plays at (bar n, step). Pure. */
export function stepNotes(song: SongDef, n: number, step: number): MusicNote[] {
  const plan = barAt(song, n);
  const out: MusicNote[] = [];
  const drums = song.drumBars[plan.drumBarId] ?? {};
  const human = 1 - 0.1 * hash01(n, step);
  for (const part of DRUM_PARTS) {
    const ch = drums[part]?.[step];
    const vel = ch ? DRUM_VEL[ch] : undefined;
    if (vel !== undefined) out.push({ part, vel: vel * human * song.drumLevel });
  }
  if (plan.section.crash && plan.barInSection === 0 && step === 0) out.push({ part: 'crash', vel: 0.8 * song.drumLevel });
  const prog = plan.section.progression ?? song.progression;
  const chord = prog[plan.barInSection % prog.length] as Chord;
  if (plan.section.bass) {
    const line = plan.section.progression && song.bassLineB ? song.bassLineB : song.bassLine;
    const ch = line[step] ?? '.';
    const iv = BASS_INTERVAL[ch];
    if (iv !== undefined) out.push({ part: 'bass', vel: 0.9 * human, midi: chord.root + iv, lenSteps: holdLen(line, step) });
  }
  if (plan.section.chords && song.chordRhythm[step] === 'X') {
    out.push({ part: 'chord', vel: 0.8 * human, midis: chord.notes, lenSteps: holdLen(song.chordRhythm, step) });
  }
  return out;
}

/** Seconds per 16th step at the song's live tempo. */
export function stepSeconds(song: SongDef): number {
  const bpm = Math.max(1, song.bpm());
  return 60 / bpm / 4;
}

/** Swing delay of a step: odd 16ths are late by (2 x swing - 1) steps. */
export function swingOffset(step: number, swing: number, stepS: number): number {
  return step % 2 === 1 ? (2 * swing - 1) * stepS : 0;
}
