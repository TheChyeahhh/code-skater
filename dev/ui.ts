/**
 * dev/ui.ts (ui track harness, port 5310): the UI root on its own, fed by the mock snapshot and events
 * over a busy 3D background. Keyboard drives NavInput (dev/ui/keyboardNav.ts). Query params:
 *   ?screen=mainMenu|parkSelect|goalList|hud|pause|options|credits|boardLab|results   (default hud)
 *   &glyphs=xbox|playstation|keyboard   &stamp=1 (Lab Circuit)   &unlocked=1 (Woodshed)   &progress=1 (some goals done)
 *   &mode=career|free   &at=<seconds into the mock loop>   &clock=<seconds left>   &combo=long
 *   &event=gap|macguffin|ok|sick|insane|npc|goal|letter|toast   (fired once after the first frames)
 *   &lost=1 (controller overlay)   &dev=1 (tuning panel open)   &view=controls (options)   &placing=1 (Board Lab)
 *   &preview=2d (Board Lab: the UI's 2D placeholder instead of the skater track's 3D turntable)
 *   &size=<w>x<h> is the screenshot's job (scripts/shot.mjs --size).
 */

import { BRAND_MODE, BRANDS } from '../src/data/brands';
import { tryImplemented } from '../src/core/contract';
import { TUNING } from '../src/core/tuning';
import { createBoardPreview } from '../src/render/skater/boardPreview';
import type { ComboView, GlyphSet, NavInput, RunMode, SimSnapshot } from '../src/core/types';
import type { SimEvent } from '../src/core/events';
import { DEFAULT_SAVE, type SaveData } from '../src/save/types';
import { createUiRoot } from '../src/ui/root';
import type { RunResults, ScreenId, UiActions } from '../src/ui/types';
import { mountPanel, shotReadyAt, startFrames } from './shared/harness';
import { createMockDrive } from './shared/mockDrive';
import { createBusyScene } from './ui/busyScene';
import { createKeyboardNav } from './ui/keyboardNav';
import { MOCK_GOALS } from '../tests/fixtures/ui/goals';

const params = new URLSearchParams(window.location.search);
const screen = (params.get('screen') ?? 'hud') as ScreenId;
const glyphs = (params.get('glyphs') ?? 'xbox') as GlyphSet;
const mode = (params.get('mode') ?? (screen === 'hud' || screen === 'pause' ? 'career' : 'career')) as RunMode;
const uiRoot = document.getElementById('ui-root') ?? document.body;

const scene = createBusyScene();
const panel = mountPanel('UI harness', ['UI track, port 5310. Arrows move, Enter confirms, Esc backs, Q/E tabs, J/L actions, ` tuning panel.']);
panel.root.style.top = 'auto';
panel.root.style.bottom = '12px';
panel.root.style.left = '50%';
panel.root.style.transform = 'translateX(-50%)';
panel.root.style.maxWidth = '30vw';
panel.root.style.fontSize = '11px';
panel.root.style.opacity = '0.8';
if (params.has('nopanel')) panel.root.style.display = 'none';

const log = (what: string) => () => panel.log(`action ${what}`);
let save: SaveData = DEFAULT_SAVE;
if (params.has('unlocked') || params.has('progress')) {
  save = { ...save, career: { ...save.career, goals: { marketStreet: ['MS-GOAL-01', 'MS-GOAL-04', 'MS-GOAL-05', 'MS-GOAL-07', 'MS-GOAL-09', 'MS-GOAL-10'], woodshed: ['WS-GOAL-01'], labCampus: [] }, bestScores: { marketStreet: 46600, woodshed: 12250, labCampus: 0 }, bestCombos: { marketStreet: 15504, woodshed: 4100, labCampus: 0 }, woodshedUnlocked: true } };
}
if (params.has('stamp')) save = { ...save, career: { ...save.career, macguffins: ['secret_laptop', 'secret_drive'], labCircuitStamp: true } };
if (params.has('board')) save = { ...save, board: { deckGraphic: 2, grip: 'dieCut', trucks: 'gold', wheels: 'orange99a', stickers: [{ sheet: 'labA', index: 0, u: 0.3, v: 0.5, rotDeg: 10 }, { sheet: 'chip', index: 2, u: 0.62, v: 0.4, rotDeg: -15 }, { sheet: 'pcb', index: 1, u: 0.8, v: 0.55, rotDeg: 0 }] } };

const pushState = (): void => ui.setState({ save, glyphs, brandMode: BRAND_MODE, version: 'v0.1', goals: MOCK_GOALS });

const actions: UiActions = {
  startRun: (level, m) => panel.log(`action startRun ${level} ${m}`),
  resume: log('resume'),
  restartRun: log('restartRun'),
  quitToMenu: log('quitToMenu'),
  setOptions: (o) => {
    save = { ...save, options: o };
    pushState();
    panel.log(`action setOptions ${JSON.stringify(o)}`);
  },
  resetCareer: () => {
    save = { ...save, career: DEFAULT_SAVE.career };
    pushState();
    panel.log('action resetCareer');
  },
  setBoard: (b) => {
    save = { ...save, board: b };
    pushState();
    panel.log(`action setBoard ${b.deckGraphic} ${b.grip} ${b.trucks} ${b.wheels} stickers ${b.stickers.length}`);
  },
  loadMusicFolder: (files) => Promise.resolve(files.length),
  uiSound: (k) => panel.log(`sound ${k}`),
};

// The Board Lab shows the skater track's real 3D turntable when its factory is built (&preview=2d
// forces the UI's own 2D placeholder, which is also what a stub falls back to).
const boardPreview = params.get('preview') === '2d' ? null : tryImplemented(() => createBoardPreview(save.board));
if (!boardPreview) panel.log('board preview: 2D placeholder');
const ui = createUiRoot(uiRoot, { actions, boardPreview });
pushState();

const results: RunResults = {
  levelId: 'marketStreet', mode, score: 46600, bestCombo: 15504,
  goalsCompleted: mode === 'career' ? [{ id: 'MS-GOAL-01', name: 'High Score' }, { id: 'MS-GOAL-07', name: 'Grind the Bus Stop Bar' }] : [],
  nextGoal: { name: 'High Combo', distance: '4,496 to go' }, letters: ['C', 'O', 'E'], unlocks: params.has('unlocked') ? ['Woodshed unlocked', 'New best score'] : ['New best score'],
};

if (screen === 'results') ui.showResults(results);
else ui.show(screen);
if (params.get('view') === 'controls' && screen === 'options') {
  // Options rows: Quality, Music, SFX, Rumble, MP3 folder, Controls.
  for (let i = 0; i < 5; i++) ui.press('down');
  ui.press('confirm');
}
if (params.has('placing') && screen === 'boardLab') {
  ui.press('down');
  ui.press('down');
  ui.press('down');
  ui.press('down');
  ui.press('confirm');
}
if (params.has('lost')) ui.setControllerLost(true);
if (params.has('dev')) ui.toggleDevPanel();

const keys = createKeyboardNav();
const drive = createMockDrive(Number(params.get('at') ?? 0));
const clockOverride = params.has('clock') ? Number(params.get('clock')) : null;
const LONG_NAMES = ['Switch Kickflip', 'Boardslide', 'Crooked', 'PLAZA BAR HOP', 'Revert', 'Manual', 'Nose Manual', 'Varial Heelflip', 'Smith', 'Feeble', 'Indy', BRANDS.specialSlideName];
const longCombo: ComboView = {
  elements: LONG_NAMES.map((name, i) => ({ id: 'kickflip', category: 'flip', name, value: 100, accrual: 0, open: i === LONG_NAMES.length - 1 })), names: ['Switch Kickflip', 'Boardslide', 'Crooked', 'PLAZA BAR HOP', 'Revert', 'Manual', 'Nose Manual', 'Varial Heelflip', 'Smith', 'Feeble', 'Indy', BRANDS.specialSlideName],
  base: 12480, multiplier: 14.5, spin180s: 3, final: 180960,
};
const eventName = params.get('event');
let fired = false;

function mockEvent(name: string, tick: number, snap: SimSnapshot): SimEvent | null {
  const pos = snap.skater.pos;
  switch (name) {
    case 'gap': return { type: 'gap', tick, gapId: 'MS-G10', name: 'BILLBOARD GAP', base: 1000 };
    case 'macguffin': return { type: 'macguffin', tick, id: 'secret_laptop', name: BRANDS.macguffins.secret_laptop.name, splash: BRANDS.macguffins.secret_laptop.splash, toast: BRANDS.npcs.sam.toast, hitstopTicks: 7, pos };
    case 'ok': return { type: 'land', tick, quality: 'ok', offAxisDeg: 20, tiltDeg: 3, vert: false, speed: 7, pos, linker: 'none' };
    case 'sick': return { type: 'comboBanked', tick, final: 15504, base: 1632, multiplier: 9.5, elementCount: 8, quality: 'sick', runScore: 46600 };
    case 'insane': return { type: 'comboBanked', tick, final: 62000, base: 4000, multiplier: 15.5, elementCount: 12, quality: 'insane', runScore: 108600 };
    case 'npc': return { type: 'npcTalk', tick, npcId: 'sam', name: BRANDS.npcs.sam.name, line: BRANDS.npcs.sam.line };
    case 'goal': return { type: 'goalCompleted', tick, levelId: 'marketStreet', goalId: 'MS-GOAL-07', name: 'Grind the Bus Stop Bar', index: 7 };
    case 'letter': return { type: 'letter', tick, letter: 'O', collected: ['C', 'O'], pos };
    default: return null;
  }
}

startFrames((dt, frame) => {
  scene.spin(dt);
  scene.render();
  let snap = drive.advance(dt);
  if (clockOverride !== null) snap = { ...snap, run: { ...snap.run, clockS: Math.max(0, clockOverride - snap.simTime), overtime: clockOverride === 0 } };
  if (params.get('combo') === 'long') snap = { ...snap, combo: longCombo };
  if (mode !== snap.run.mode) snap = { ...snap, run: { ...snap.run, mode, goalsCompleted: params.has('progress') ? ['MS-GOAL-07'] : [] } };
  if (params.has('glow')) snap = { ...snap, special: { ...snap.special, meter: 1, glowing: true } };
  const nav: NavInput = keys.frame();
  if (nav.pause) {
    ui.show(ui.screen === 'pause' ? 'hud' : 'pause');
    panel.log('pause toggled');
  }
  ui.update(nav, dt);
  ui.hud.update(snap, dt);
  for (const e of drive.events) ui.hud.onEvent(e);
  if (eventName && !fired && frame >= 3) {
    fired = true;
    if (eventName === 'toast') ui.hud.toast('Controller connected');
    else {
      const e = mockEvent(eventName, snap.tick, snap);
      if (e) ui.hud.onEvent(e);
    }
  }
  panel.setStatus([`screen ${ui.screen}  t ${snap.simTime.toFixed(1)}s  state ${snap.skater.state}`, `TUNING.CLOCK_RED_S ${TUNING.CLOCK_RED_S}`]);
  shotReadyAt(frame, 12);
});
