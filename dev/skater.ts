/**
 * dev/skater.ts (skater track harness, port 5308). Modes (query string):
 *   (default)          the animated mock snapshot (src/core/mock.ts: push, kickflip, 50-50, manual, bail,
 *                      get-up on an 8 s loop) with a following camera; ?t=<s> starts there, ?pose=<PoseId>
 *                      freezes the mock at the first tick showing that pose.
 *   ?mode=turntable    one skater on a slow turntable cycling every pose and variant of the library
 *                      (POSE_CATALOG), each over SECONDS_PER_POSE with its phase running 0 to 1 (flips spin
 *                      the board by flipPhase). ?pose=grab&variant=indy&phase=0.5 holds one pose still;
 *                      ?stance=switch and ?fakie=1 apply the mirrors; ?spin=0 stops the turntable.
 *   ?mode=grid         a contact sheet: one skater per catalog entry (or ?grid=grabs|grinds|flips|specials
 *                      for every variant of that family), all at ?phase (default 0.5), fixed camera.
 *   ?mode=npc          the two NPC figures (talking every other second), the C-O-D-E letters and both
 *                      MacGuffins in a row.
 *   ?mode=board        the board alone, top and underside, big (?deck= ?grip= ?panic=1 for the blue screen).
 * window.__shotReady after 10 frames.
 */

import { DirectionalLight, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { createMockDrive } from './shared/mockDrive';
import { createBasicScene, mountPanel, noteFallback, shotReadyAt, startFrames, tryBuild, type BasicScene } from './shared/harness';
import { DEFAULT_BOARD, LETTERS, type BaseTrickId, type BoardConfig, type PoseId, type Stance } from '../src/core/types';
import type { NpcDef } from '../src/levels/types';
import { createLetterProp, createMacGuffinProp, createNpcFigure } from '../src/render/npc';
import { createBoardModel } from '../src/render/skater/board';
import { renderDeckBottom, renderDeckTop } from '../src/render/skater/boardArt';
import { POSE_CATALOG } from '../src/render/skater/poses';
import { createSkaterView } from '../src/render/skater/skaterView';
import { poseSnapshot, type PoseShot } from './skater/poseSnapshot';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') ?? 'mock';
const SECONDS_PER_POSE = 1.6;
const ORIGIN = { x: 20, y: 0, z: 20 };
/** In-air poses sit this high over the pad in the turntable and grid, so a dropped board (standing flips) stays above the ground. */
const AIR_LIFT_M = 0.3;
const AIR_POSE_IDS: readonly PoseId[] = ['pop', 'air', 'flip', 'grab', 'special', 'transfer'];

function shotPos(pose: PoseId, at: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return AIR_POSE_IDS.includes(pose) ? { ...at, y: at.y + AIR_LIFT_M } : at;
}

/** A board config with a few stickers so the underside shows the Lab art in flips. */
const SHOW_BOARD = {
  ...DEFAULT_BOARD,
  deckGraphic: Number(params.get('deck') ?? '0') % 6,
  trucks: 'gold' as const,
  wheels: (params.get('wheels') ?? 'white99a') as BoardConfig['wheels'],
  stickers: [
    { sheet: 'labA' as const, index: 0, u: 0.3, v: 0.5, rotDeg: -12 },
    { sheet: 'chip' as const, index: 1, u: 0.68, v: 0.42, rotDeg: 20 },
    { sheet: 'wafer' as const, index: 2, u: 0.5, v: 0.7, rotDeg: 0 },
  ],
};

function catalogEntries(filter: string | null): PoseShot[] {
  const out: PoseShot[] = [];
  for (const entry of POSE_CATALOG) {
    const family = entry.pose === 'grab' ? 'grabs' : entry.pose === 'grind' ? 'grinds' : entry.pose === 'flip' ? 'flips' : entry.pose === 'special' ? 'specials' : null;
    if (filter) {
      if (family !== filter) continue;
      for (const v of entry.variants) out.push({ pose: entry.pose, variant: v, phase: 0.5 });
    } else {
      out.push({ pose: entry.pose, variant: entry.variants[0] ?? null, phase: 0.5 });
    }
  }
  return out;
}

function allEntries(): PoseShot[] {
  const out: PoseShot[] = [];
  for (const entry of POSE_CATALOG) for (const v of entry.variants) out.push({ pose: entry.pose, variant: v, phase: 0 });
  return out;
}

function groundPad(s: BasicScene, x: number, z: number, size: number): void {
  const pad = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ color: '#2a3142', roughness: 0.95 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(x, 0.001, z);
  pad.receiveShadow = true;
  s.scene.add(pad);
}

function runMock(): void {
  const panel = mountPanel('Skater harness', ['Skater track, port 5308. Mock loop: push, kickflip, 50-50, manual, bank, bail, get-up. ?mode=turntable|grid|npc']);
  const s = createBasicScene();
  const view = tryBuild(() => createSkaterView(SHOW_BOARD));
  if (view) s.scene.add(view.group);
  else noteFallback(panel, 'createSkaterView');
  const startS = Number(params.get('t') ?? '0');
  const drive = createMockDrive(Number.isFinite(startS) ? startS : 0, params.get('pose'));
  startFrames((dt, frame) => {
    const snap = drive.advance(dt);
    const k = snap.skater;
    view?.update(snap, dt);
    s.camera.position.set(k.pos.x - k.forward.x * 4.2, k.pos.y + 1.8, k.pos.z - k.forward.z * 4.2);
    s.camera.lookAt(k.pos.x + k.forward.x * 1.5, k.pos.y + 0.9, k.pos.z + k.forward.z * 1.5);
    panel.setStatus([`tick ${snap.tick}  state ${k.state}  pose ${k.pose} ${k.poseVariant ?? ''}  phase ${k.posePhase.toFixed(2)}`, `rig tris ${view?.triangles ?? 0}`]);
    s.render();
    shotReadyAt(frame);
  });
}

function runTurntable(): void {
  const panel = mountPanel('Skater turntable', ['?pose=<id>&variant=<trick>&phase=<0..1> holds; ?stance=switch ?fakie=1 ?spin=0 ?deck=<0..5>']);
  const s = createBasicScene();
  groundPad(s, ORIGIN.x, ORIGIN.z, 4);
  const view = tryBuild(() => createSkaterView(SHOW_BOARD));
  if (!view) {
    noteFallback(panel, 'createSkaterView');
    return;
  }
  s.scene.add(view.group);
  const held = params.get('pose') as PoseId | null;
  const heldVariant = (params.get('variant') ?? null) as BaseTrickId | null;
  const heldPhase = Number(params.get('phase') ?? '0.5');
  const stance = (params.get('stance') === 'switch' ? 'switch' : 'regular') as Stance;
  const fakie = params.get('fakie') === '1';
  const spinDps = Number(params.get('spin') ?? '24');
  const entries = allEntries();
  let time = 0;
  let yaw = Number(params.get('yaw') ?? '0.6');
  const dist = Number(params.get('dist') ?? '3.6');
  startFrames((dt, frame) => {
    time += dt;
    yaw += spinDps * (Math.PI / 180) * dt;
    let shot: PoseShot;
    if (held) {
      shot = { pose: held, variant: heldVariant, phase: Number.isFinite(heldPhase) ? heldPhase : 0.5, stance, fakie, pos: shotPos(held, ORIGIN), yaw };
    } else {
      const idx = Math.floor(time / SECONDS_PER_POSE) % entries.length;
      const e = entries[idx] as PoseShot;
      const phase = (time % SECONDS_PER_POSE) / SECONDS_PER_POSE;
      shot = { ...e, phase, stance, fakie, pos: shotPos(e.pose, ORIGIN), yaw };
    }
    const snap = poseSnapshot(shot);
    view.update(snap, dt);
    s.camera.position.set(ORIGIN.x, 1.55, ORIGIN.z + dist);
    s.camera.lookAt(ORIGIN.x, 0.85, ORIGIN.z);
    panel.setStatus([`pose ${shot.pose} ${shot.variant ?? ''}  phase ${shot.phase.toFixed(2)}  stance ${stance}${fakie ? ' fakie' : ''}`, `rig tris ${view.triangles}`]);
    s.render();
    shotReadyAt(frame);
  });
}

function runGrid(): void {
  const family = params.get('grid');
  const phase = Number(params.get('phase') ?? '0.5');
  const stance = (params.get('stance') === 'switch' ? 'switch' : 'regular') as Stance;
  const entries = catalogEntries(family);
  const panel = mountPanel('Skater pose sheet', [`${entries.length} poses${family ? ` (${family})` : ''} at phase ${phase}. ?grid=grabs|grinds|flips|specials ?phase= ?stance=switch`]);
  const s = createBasicScene();
  const cols = Math.ceil(Math.sqrt(entries.length * 1.9));
  const rows = Math.ceil(entries.length / cols);
  const dx = 1.7;
  const dz = 2.4;
  const views = entries.map((e, i) => {
    const view = tryBuild(() => createSkaterView(SHOW_BOARD));
    if (!view) return null;
    s.scene.add(view.group);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const pos = shotPos(e.pose, { x: ORIGIN.x + (col - (cols - 1) / 2) * dx, y: 0, z: ORIGIN.z + (row - (rows - 1) / 2) * dz });
    return { view, shot: { ...e, phase: Number.isFinite(phase) ? phase : 0.5, stance, pos, yaw: 0.35 } as PoseShot };
  });
  if (views.every((v) => v === null)) noteFallback(panel, 'createSkaterView');
  const width = cols * dx;
  const camY = 2.2 + rows * 0.9;
  const camZ = ORIGIN.z + rows * dz * 0.5 + width * 0.38 + 1.2;
  startFrames((dt, frame) => {
    for (const v of views) if (v) v.view.update(poseSnapshot(v.shot), dt);
    s.camera.position.set(ORIGIN.x, camY, camZ);
    s.camera.lookAt(new Vector3(ORIGIN.x, 0.6, ORIGIN.z - rows * 0.2));
    panel.setStatus(entries.map((e, i) => `${i + 1}. ${e.pose} ${e.variant ?? ''}`.trim()).slice(0, 40));
    s.render();
    shotReadyAt(frame);
  });
}

function runNpc(): void {
  const panel = mountPanel('NPC figures and pickups', ['Hoodie NPC with the empty laptop sleeve, contest-jacket NPC with coffee; letters C-O-D-E; laptop and drive. Talking toggles every 2 s.']);
  const s = createBasicScene();
  groundPad(s, ORIGIN.x, ORIGIN.z, 10);
  const defs: readonly NpcDef[] = [
    { id: 'sam', pos: { x: ORIGIN.x - 3.4, y: 0, z: ORIGIN.z + 0.6 }, facing: 'south', outfit: 'hoodie', prop: 'laptopSleeve' },
    { id: 'dario', pos: { x: ORIGIN.x + 3.4, y: 0, z: ORIGIN.z + 0.6 }, facing: 'south', outfit: 'contestJacket', prop: 'coffee' },
  ];
  const figures = defs.map((d) => createNpcFigure(d));
  for (const f of figures) s.scene.add(f.group);
  const props = new Group();
  s.scene.add(props);
  const spinners: Group[] = [];
  LETTERS.forEach((l, i) => {
    const p = createLetterProp(l);
    p.group.position.set(ORIGIN.x - 1.95 + i * 1.3, 1.5, ORIGIN.z - 0.4);
    props.add(p.group);
    spinners.push(p.group);
  });
  const laptop = createMacGuffinProp('secret_laptop');
  laptop.group.position.set(ORIGIN.x - 0.8, 0.55, ORIGIN.z + 0.8);
  const drive = createMacGuffinProp('secret_drive');
  drive.group.position.set(ORIGIN.x + 0.8, 0.55, ORIGIN.z + 0.8);
  props.add(laptop.group, drive.group);
  spinners.push(laptop.group, drive.group);
  let time = Number(params.get('t') ?? '0');
  const talkPhase = params.get('talk');
  startFrames((dt, frame) => {
    time += dt;
    const talking = talkPhase ? talkPhase === '1' : Math.floor(time / 2) % 2 === 1;
    figures.forEach((f, i) => f.update(dt, talking && i === Math.floor(time / 4) % 2));
    spinners.forEach((g, i) => {
      g.rotation.y = time * 0.9 + i * 0.7;
      g.position.y = (i < 4 ? 1.5 : 0.55) + Math.sin(time * 1.7 + i) * 0.08;
    });
    s.camera.position.set(ORIGIN.x, 1.7, ORIGIN.z + 5.2);
    s.camera.lookAt(ORIGIN.x, 0.9, ORIGIN.z - 0.6);
    panel.setStatus([`t ${time.toFixed(1)}  talking ${talking}`]);
    s.render();
    shotReadyAt(frame);
  });
}

function runBoard(): void {
  const panel = mountPanel('Board close-up', ['Top (grip) and underside (graphic + stickers) of the Board Lab config. ?deck=<0..5> ?grip=black|gray|clear|dieCut ?panic=1']);
  const s = createBasicScene();
  const grip = (params.get('grip') ?? 'black') as BoardConfig['grip'];
  const config: BoardConfig = { ...SHOW_BOARD, grip };
  const top = createBoardModel(config);
  const bottom = createBoardModel(config);
  bottom.setDeckOverride(params.get('panic') === '1' ? 'blueScreen' : 'none');
  top.group.position.set(ORIGIN.x - 0.55, 1.0, ORIGIN.z);
  bottom.group.position.set(ORIGIN.x + 0.55, 1.0, ORIGIN.z);
  s.scene.add(top.group, bottom.group);
  // A soft fill from below so the underside is lit the way the sky's IBL lights it in the game.
  const fill = new DirectionalLight('#9fb8ff', 0.9);
  fill.position.set(0.5, -2, 3);
  fill.target.position.set(ORIGIN.x, 1, ORIGIN.z);
  s.scene.add(fill, fill.target);
  if (params.get('showtex') === '1') {
    for (const c of [renderDeckTop(grip), renderDeckBottom(config)]) {
      c.style.cssText = 'position:fixed;right:12px;bottom:12px;width:512px;height:128px;border:1px solid #888;';
      if (c !== null) document.body.append(c);
      c.style.bottom = c === document.body.lastElementChild && document.body.querySelectorAll('canvas').length > 2 ? '150px' : '12px';
    }
  }
  let time = 0;
  startFrames((dt, frame) => {
    time += dt;
    top.group.rotation.set(0.9, time * 0.4, 0);
    bottom.group.rotation.set(-(Math.PI - 0.9), time * 0.4, 0);
    s.camera.position.set(ORIGIN.x, 1.55, ORIGIN.z + 1.7);
    s.camera.lookAt(ORIGIN.x, 1.0, ORIGIN.z);
    panel.setStatus([`deck ${config.deckGraphic}  grip ${grip}  board tris ${top.triangles}`]);
    s.render();
    shotReadyAt(frame);
  });
}

if (mode === 'turntable') runTurntable();
else if (mode === 'board') runBoard();
else if (mode === 'grid') runGrid();
else if (mode === 'npc') runNpc();
else runMock();
