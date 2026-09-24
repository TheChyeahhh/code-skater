/**
 * dev/audio.ts (audio track harness, port 5311). Click "Start audio" (the user gesture), then:
 * park music (menu / Market Street / Woodshed / off, locked or proposed tempo), volume sliders,
 * the player's own music folder, pause, a button per synthesized sound, the continuous loops, and
 * the mock run (mock SimEvents and snapshots through AudioEngine.onEvent / update).
 * "Render check" renders every voice, loop and song offline and lists RMS / peak / NaN per render;
 * ?verify runs it at load, logs "AUDIO_REPORT <json>" and sets window.__audioReport
 * (node dev/audio/verify.mjs prints it and fails on any silent or NaN render).
 */

import { createAudioEngine } from '../src/audio/engine';
import { GrindLoop, RollLoop, WindLoop } from '../src/audio/loops';
import type { MusicTrack } from '../src/audio/types';
import { pickMusicFolder } from '../src/audio/userMusic';
import { playVoice } from '../src/audio/voices';
import { TUNING, TUNING_DEFAULTS } from '../src/core/tuning';
import { renderAll, VOICE_CASES, type RenderReport } from './audio/offline';
import { mountPanel, shotReadyAt, startFrames } from './shared/harness';
import { createMockDrive } from './shared/mockDrive';

declare global {
  interface Window {
    __audioReport?: RenderReport;
  }
}

/** Tempos this track proposes (CHANGE-REQUEST in the audio report): boom-bap Street, fast Woodshed. */
const PROPOSED_BPM = { street: 94, woodshed: 170 } as const;

const params = new URLSearchParams(window.location.search);
const verifyAtLoad = params.has('verify');

const css = document.createElement('style');
css.textContent = `
  .aud-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; align-items: center; }
  .aud-row b { width: 100%; font-size: 12px; color: #9aa3b5; font-weight: 600; letter-spacing: 0.04em; margin-top: 4px; }
  .aud-row button { font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 5px; border: 1px solid #39425a; background: #1b2130; color: #e8ebf2; cursor: pointer; }
  .aud-row button.on { background: #2f6f4f; border-color: #3f9a6a; }
  .aud-row label { font-size: 12px; display: flex; gap: 6px; align-items: center; margin-right: 10px; }
  .aud-report { position: fixed; top: 12px; right: 12px; bottom: 12px; width: 50vw; overflow: auto; padding: 10px 14px; border-radius: 8px;
    background: rgba(10, 12, 18, 0.78); font-family: ui-monospace, Consolas, 'Courier New', monospace; font-size: 11px; line-height: 1.35; }
  .aud-report h2 { margin: 0 0 6px; font: 600 14px system-ui, sans-serif; }
  .aud-report table { border-collapse: collapse; width: 100%; }
  .aud-report td, .aud-report th { padding: 1px 6px; text-align: right; white-space: nowrap; }
  .aud-report td:first-child, .aud-report th:first-child { text-align: left; }
  .aud-report tr.fail td { color: #ff6b6b; }
  .aud-report tr.song td { color: #8fd3ff; font-weight: 600; }
  .aud-report .bar { display: inline-block; height: 8px; background: #3f9a6a; vertical-align: middle; }
`;
document.head.append(css);

const panel = mountPanel('Audio harness', ['Audio track, port 5311. Click "Start audio" first (browsers need a gesture).']);
const engine = createAudioEngine();
let ctx: AudioContext | null = null;
let sfxOut: GainNode | null = null;

function row(title: string): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'aud-row';
  const b = document.createElement('b');
  b.textContent = title;
  r.append(b);
  panel.root.append(r);
  return r;
}

function button(parent: HTMLElement, label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => onClick(b));
  parent.append(b);
  return b;
}

function slider(parent: HTMLElement, label: string, value: number, onInput: (v: number) => void): void {
  const l = document.createElement('label');
  l.textContent = label;
  const s = document.createElement('input');
  s.type = 'range';
  s.min = '0';
  s.max = '1';
  s.step = '0.01';
  s.value = String(value);
  s.addEventListener('input', () => onInput(Number(s.value)));
  l.append(s);
  parent.append(l);
}

// --- engine -----------------------------------------------------------------------------------

const top = row('ENGINE');
button(top, 'Start audio', (b) => {
  if (ctx) return;
  ctx = new AudioContext();
  void ctx.resume();
  sfxOut = ctx.createGain();
  sfxOut.gain.value = 0.8;
  sfxOut.connect(ctx.destination);
  void engine.init(ctx).then(() => panel.log(`audio started, ${ctx?.sampleRate} Hz, state ${ctx?.state}`));
  b.classList.add('on');
});
let paused = false;
button(top, 'Pause', (b) => {
  paused = !paused;
  engine.setPaused(paused);
  b.classList.toggle('on', paused);
});
let mockRun = false;
button(top, 'Mock run', (b) => {
  mockRun = !mockRun;
  b.classList.toggle('on', mockRun);
  if (!mockRun) engine.update(null, 0);
});
button(top, 'Render check', () => void runVerify());

// --- music ------------------------------------------------------------------------------------

const music = row('MUSIC');
const musicButtons: HTMLButtonElement[] = [];
const tracks: [string, MusicTrack | null][] = [['Menu', 'menu'], ['Market Street', 'marketStreet'], ['Woodshed', 'woodshed'], ['Off', null]];
for (const [label, track] of tracks) {
  musicButtons.push(button(music, label, (b) => {
    engine.playMusic(track);
    for (const m of musicButtons) m.classList.toggle('on', m === b && track !== null);
    panel.log(`music ${track ?? 'off'}`);
  }));
}
button(music, 'Tempo: locked', (b) => {
  const proposed = TUNING.MUSIC_BPM_STREET !== PROPOSED_BPM.street;
  TUNING.MUSIC_BPM_STREET = proposed ? PROPOSED_BPM.street : TUNING_DEFAULTS.MUSIC_BPM_STREET;
  TUNING.MUSIC_BPM_WOODSHED = proposed ? PROPOSED_BPM.woodshed : TUNING_DEFAULTS.MUSIC_BPM_WOODSHED;
  b.textContent = proposed ? 'Tempo: proposed' : 'Tempo: locked';
  b.classList.toggle('on', proposed);
  panel.log(`tempo street ${TUNING.MUSIC_BPM_STREET}, woodshed ${TUNING.MUSIC_BPM_WOODSHED}`);
});
const volumes = { music: 0.7, sfx: 0.8 };
slider(music, 'music', volumes.music, (v) => {
  volumes.music = v;
  engine.setVolumes(volumes);
});
slider(music, 'sfx', volumes.sfx, (v) => {
  volumes.sfx = v;
  engine.setVolumes(volumes);
});

const mine = row('MY MUSIC (a folder of MP3s, never bundled)');
button(mine, 'Pick folder', () => {
  void pickMusicFolder().then(async (files) => {
    const n = await engine.loadUserMusic(files);
    panel.log(`picked ${files.length} files, ${n} playable`);
  });
});
let useMine = false;
button(mine, 'Use my music', (b) => {
  useMine = !useMine;
  engine.useUserMusic(useMine);
  b.classList.toggle('on', useMine);
});

// --- one-shots and loops --------------------------------------------------------------------------

const sfx = row('SFX (one button per sound)');
for (const c of VOICE_CASES) {
  button(sfx, c.label, () => {
    if (!ctx || !sfxOut) return panel.log('click "Start audio" first');
    playVoice(c.id, { ctx, out: sfxOut, t: ctx.currentTime + 0.01 }, c.params);
    panel.log(`voice ${c.label}`);
  });
}

const loops = row('LOOPS (toggle; speed slider)');
let loopSpeed = 0.7;
const live = new Map<string, { set(l: number, r: number): void; stop(): void }>();
const loopCases: [string, (c: AudioContext, o: AudioNode) => { set(l: number, r: number): void; stop(): void }][] = [
  ['roll concrete', (c, o) => new RollLoop(c, o, 'concrete')],
  ['roll wood', (c, o) => new RollLoop(c, o, 'wood')],
  ['grind rail', (c, o) => new GrindLoop(c, o, 'rail')],
  ['grind ledge', (c, o) => new GrindLoop(c, o, 'ledge')],
  ['grind coping', (c, o) => new GrindLoop(c, o, 'coping')],
  ['wind', (c, o) => new WindLoop(c, o)],
];
for (const [name, make] of loopCases) {
  button(loops, name, (b) => {
    if (!ctx || !sfxOut) return panel.log('click "Start audio" first');
    const cur = live.get(name);
    if (cur) {
      cur.stop();
      live.delete(name);
    } else {
      const l = make(ctx, sfxOut);
      l.set(0.4, loopSpeed);
      live.set(name, l);
    }
    b.classList.toggle('on', !cur);
  });
}
slider(loops, 'speed', loopSpeed, (v) => {
  loopSpeed = v;
  for (const l of live.values()) l.set(0.4, v);
});

// --- render check ---------------------------------------------------------------------------------

const report = document.createElement('div');
report.className = 'aud-report';
report.innerHTML = '<h2>Render check</h2><div>Not run yet. Click "Render check" or open with ?verify.</div>';
document.body.append(report);

function fmt(v: number, digits = 4): string {
  return v.toFixed(digits);
}

function showReport(r: RenderReport): void {
  const maxRms = Math.max(...r.rows.map((x) => x.rms), 1e-9);
  const lines = r.rows.map((x) => {
    const cls = !x.ok ? 'fail' : x.group === 'song' ? 'song' : '';
    const w = Math.round((x.rms / maxRms) * 80);
    return `<tr class="${cls}"><td>${x.group === 'section' ? '&nbsp;&nbsp;' : ''}${x.name}</td><td>${fmt(x.seconds, 2)}</td><td>${fmt(x.rms)}</td><td><span class="bar" style="width:${w}px"></span></td><td>${fmt(x.peak, 3)}</td><td>${x.nan}</td><td>${x.renderMs ? Math.round(x.renderMs) : ''}</td><td>${x.ok ? 'ok' : 'FAIL'}</td></tr>`;
  });
  const status = r.failed === 0 ? `all ${r.rows.length} renders non-silent, no NaN` : `${r.failed} of ${r.rows.length} renders FAILED`;
  report.innerHTML = `<h2>Render check: ${status}</h2><table><tr><th>render (OfflineAudioContext, ${r.sampleRate} Hz)</th><th>s</th><th>RMS</th><th></th><th>peak</th><th>NaN</th><th>ms</th><th></th></tr>${lines.join('')}</table>`;
}

async function runVerify(): Promise<void> {
  report.innerHTML = '<h2>Render check</h2><div>Rendering...</div>';
  try {
    const r = await renderAll();
    showReport(r);
    window.__audioReport = r;
    console.log(`AUDIO_REPORT ${JSON.stringify(r)}`);
    if (r.failed > 0) console.error(`audio render check: ${r.failed} silent or NaN renders`);
  } catch (err) {
    report.innerHTML = `<h2>Render check crashed</h2><pre>${String(err)}</pre>`;
    console.error('audio render check crashed', err);
  }
  if (verifyAtLoad) window.__shotReady = true;
}

if (verifyAtLoad) void runVerify();

// --- frame loop: mock run through the engine --------------------------------------------------------

const drive = createMockDrive();
startFrames((dt, frame) => {
  const snap = drive.advance(dt);
  if (ctx && mockRun) {
    for (const e of drive.events) {
      engine.onEvent(e);
      if (e.type !== 'runTick') panel.log(`tick ${e.tick} ${e.type}`);
    }
    engine.update(snap, dt);
  }
  panel.setStatus([
    `audio ${ctx ? ctx.state : 'waiting for the click'}  engine ${engine.ready ? 'ready' : 'not ready'}  mock run ${mockRun ? 'on' : 'off'}`,
    `tempo street ${TUNING.MUSIC_BPM_STREET} bpm, woodshed ${TUNING.MUSIC_BPM_WOODSHED} bpm  state ${snap.skater.state}  speed ${snap.skater.speed.toFixed(1)}`,
  ]);
  if (!verifyAtLoad) shotReadyAt(frame);
});
