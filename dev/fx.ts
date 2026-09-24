/**
 * dev/fx.ts (fx track harness, port 5309): FX system and chase camera driven by the mock snapshot and
 * its events (push, ollie + kickflip, 50-50, manual, letter, land, bail on an 8 s loop). The harness
 * adds what the mock cycle lacks so every effect fires each loop: a fast stretch (speed lines + FOV
 * kick), a MacGuffin pickup (flash + hitstop hold), Kernel Panic (blue-screen card + deck hook), the
 * special grind (green ribbon + glow aura), Token Overflow (sticker peel), 900ms Inference (slow-mo
 * look). A dummy skater, a few pillars for camera collision, the rig camera following.
 * ?t=<s> starts the loop there; ?after=<s> sets window.__shotReady that many seconds later
 * (default 0.35); ?freeze=<s> steps the mock with fixed 1/60 s steps to exactly that loop time and
 * holds it (screenshots land on the intended frame); ?slow=<factor> scales every dt (0.1 = ten times
 * slower, to catch a 120 ms flash); ?look=<x>,<y> holds the right stick; ?vert=1 turns the fast
 * stretch into a 2.5 m vert hop (vertAir + rampNormal) for the REQ-CAM-02 framing. Click the canvas
 * for mouse orbit (pointer lock), arrows orbit too, Esc releases.
 */

import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, TorusGeometry, Vector3 } from 'three';
import type { SimEvent } from '../src/core/events';
import { TUNING } from '../src/core/tuning';
import type { RailKind, SimSnapshot, SpecialId } from '../src/core/types';
import { createCameraRig } from '../src/render/camera';
import { createFxSystem } from '../src/render/fx/fxSystem';
import type { CameraRaycast } from '../src/render/types';
import { createBasicScene, mountPanel, shotReadyAt, startFrames } from './shared/harness';
import { createMockDrive } from './shared/mockDrive';

const params = new URLSearchParams(window.location.search);
const panel = mountPanel('FX harness', ['FX track, port 5309. Mock loop + harness extras feed FxSystem.onEvent and CameraRig.onEvent.']);
const s = createBasicScene('#161b26');

// --- obstacles for camera collision (pillars just outside the mock circle, radius 8 around 20,20) --
const obstacles: Mesh[] = [];
const pillarMat = new MeshStandardMaterial({ color: '#5a6478', roughness: 0.8 });
function pillar(angle: number, radius: number, w: number, h: number): void {
  const m = new Mesh(new BoxGeometry(w, h, w), pillarMat);
  m.position.set(20 + radius * Math.cos(angle), h / 2, 20 + radius * Math.sin(angle));
  s.scene.add(m);
  obstacles.push(m);
}
pillar(0.6, 9.6, 1.2, 4);
pillar(2.4, 9.4, 1.0, 6);
pillar(4.1, 9.8, 1.6, 3);
pillar(5.3, 9.5, 0.8, 5);
// A ring at grind height gives the sparks and the ribbon something to sit on.
const rail = new Mesh(new TorusGeometry(8, 0.04, 8, 96), new MeshStandardMaterial({ color: '#c9ced8', metalness: 1, roughness: 0.3 }));
rail.rotation.x = Math.PI / 2;
rail.position.set(20, 0.6, 20);
s.scene.add(rail);

const raycaster = new Raycaster();
const rayO = new Vector3();
const rayD = new Vector3();
const cameraRaycast: CameraRaycast = (origin, dir, maxDist) => {
  rayO.set(origin.x, origin.y, origin.z);
  rayD.set(dir.x, dir.y, dir.z);
  raycaster.set(rayO, rayD);
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(obstacles, false);
  return hits.length > 0 ? (hits[0] as { distance: number }).distance : null;
};

// --- rig first, FX from the rig camera -----------------------------------------------------------
const rig = createCameraRig(cameraRaycast);
let holdS = 0; // hitstop hold (render holds, the mock drive pauses)
let deckMode: 'none' | 'blueScreen' = 'none';
const fx = createFxSystem(rig.camera, 1, {
  freeze: (ticks) => {
    holdS = ticks / TUNING.SIM_HZ;
    panel.log(`hitstop ${ticks} ticks (${Math.round(holdS * 1000)} ms)`);
  },
  setDeckOverride: (mode) => {
    deckMode = mode;
    panel.log(`deck override ${mode}`);
  },
});
s.scene.add(fx.group);
// Exposed for scripted inspection (dev only, the harness never ships).
(window as unknown as { __fx: unknown }).__fx = fx;
(window as unknown as { __rig: unknown }).__rig = rig;
(window as unknown as { __skaterPos: () => unknown }).__skaterPos = () => snap.skater.pos;

// --- dummy skater -------------------------------------------------------------------------------
const skater = new Group();
const bodyMat = new MeshStandardMaterial({ color: '#3a7bd5' });
const body = new Mesh(new CapsuleGeometry(0.3, 1.0, 6, 12), bodyMat);
body.position.y = 0.95;
const deckMat = new MeshStandardMaterial({ color: '#222326' });
const board = new Mesh(new BoxGeometry(0.22, 0.04, 0.8), deckMat);
board.position.y = 0.06;
skater.add(body, board);
s.scene.add(skater);

// --- harness extras keyed to the mock cycle (seconds within the 8 s loop) ------------------------
const CYCLE_S = 8;
const FAST_FROM = 0.4;
const FAST_TO = 1.8;
const MACGUFFIN_AT = 1.2;
const KERNEL_AT = 2.05;
const KERNEL_TO = 2.75;
const SLIDE_FROM = 3.4;
const SLIDE_TO = 4.8;
const GLOW_FROM = 3.0;
const TOKEN_AT = 5.0;
const TOKEN_TO = 5.7;
const INFER_FROM = 5.8;
const INFER_TO = 6.3;
const VERT_FROM = 0.5;
const VERT_TO = 1.6;
const VERT_H = 2.5;
const vertMode = params.get('vert') === '1';
// ?rail=ledge|coping|rail overrides the mock grind's rail kind (concrete chips vs sparks).
const railParam = params.get('rail');
const railKind: RailKind | null = railParam === 'ledge' || railParam === 'coping' || railParam === 'rail' ? railParam : null;
const fired = new Map<string, number>();

function once(name: string, cycle: number, at: number, t: number, prevT: number, emit: () => void): void {
  if (fired.get(name) === cycle) return;
  if (t >= at && (prevT < at || prevT > t)) {
    fired.set(name, cycle);
    emit();
  }
}

/** Patch the mock snapshot with the harness's extra states. */
function decorate(snap: SimSnapshot, t: number): SimSnapshot {
  let activeId: SpecialId | null = null;
  let timeScale = 1;
  let glowing = snap.special.glowing;
  let speedRatio = snap.skater.speedRatio;
  let grind = snap.skater.grind;
  let pos = snap.skater.pos;
  let vel = snap.skater.vel;
  let state = snap.skater.state;
  let camera = snap.camera;
  if (!vertMode && t >= FAST_FROM && t < FAST_TO) speedRatio = 0.92;
  if (vertMode && t >= VERT_FROM && t < VERT_TO) {
    // A vert hop: up and back down on a sine, vertAir with the ramp face normal against travel
    // (the wall the skater launched from is behind the launch point, its face looks back at the flat).
    const u = (t - VERT_FROM) / (VERT_TO - VERT_FROM);
    const h = VERT_H * Math.sin(u * Math.PI);
    const vy = (VERT_H * Math.PI * Math.cos(u * Math.PI)) / (VERT_TO - VERT_FROM);
    pos = { x: pos.x, y: pos.y + h, z: pos.z };
    vel = { x: vel.x, y: vy, z: vel.z };
    state = 'Air';
    const hd = snap.camera.heading;
    const l = Math.hypot(vel.x, vy, vel.z) || 1;
    camera = {
      vertAir: true,
      rampNormal: { x: -hd.x * 0.8, y: 0.6, z: -hd.z * 0.8 },
      lookAhead: { x: pos.x + (vel.x / l) * TUNING.CAM_LOOKAHEAD_M, y: pos.y + (vy / l) * TUNING.CAM_LOOKAHEAD_M, z: pos.z + (vel.z / l) * TUNING.CAM_LOOKAHEAD_M },
      heading: hd,
    };
  }
  if (grind && railKind) grind = { ...grind, railKind };
  if (t >= KERNEL_AT && t < KERNEL_TO) activeId = 'kernel_panic';
  if (t >= GLOW_FROM && t < SLIDE_TO) glowing = true;
  if (t >= SLIDE_FROM && t < SLIDE_TO && grind) {
    activeId = 'gpu_slide';
    grind = { ...grind, type: 'gpu_slide' };
  }
  if (t >= TOKEN_AT && t < TOKEN_TO) activeId = 'token_overflow';
  if (t >= INFER_FROM && t < INFER_TO) {
    activeId = 'inference_900ms';
    timeScale = TUNING.INFERENCE_TIME_SCALE;
  }
  return {
    ...snap,
    timeScale,
    skater: { ...snap.skater, pos, vel, state, speedRatio, speedTier: speedRatio >= TUNING.CAM_FOV_KICK_SPEED ? 'fast' : snap.skater.speedTier, grind },
    special: { ...snap.special, glowing, activeId },
    camera,
  };
}

// --- look input: ?look=x,y, arrows, or mouse under pointer lock ----------------------------------
const lookParam = (params.get('look') ?? '').split(',').map(Number);
const heldStick = { x: Number.isFinite(lookParam[0]) ? (lookParam[0] as number) : 0, y: Number.isFinite(lookParam[1]) ? (lookParam[1] as number) : 0 };
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key));
window.addEventListener('keyup', (e) => keys.delete(e.key));
let mouseDx = 0;
let mouseDy = 0;
s.canvas.addEventListener('click', () => {
  void s.canvas.requestPointerLock();
});
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === s.canvas) {
    mouseDx += e.movementX;
    mouseDy += e.movementY;
  }
});

const startS = Number(params.get('t') ?? '0');
const start = Number.isFinite(startS) ? startS : 0;
const readyAfterS = Number(params.get('after') ?? '0.35');
const slowParam = Number(params.get('slow') ?? '1');
const slow = Number.isFinite(slowParam) && slowParam > 0 ? slowParam : 1;
const freezeParam = Number(params.get('freeze') ?? 'NaN');
// Freeze time is a loop time at or after the start: the harness steps there with fixed steps.
const freezeAt = Number.isFinite(freezeParam) ? (freezeParam >= start % CYCLE_S ? freezeParam : freezeParam + CYCLE_S) : null;
const FIXED_STEP = 1 / 60;
const drive = createMockDrive(start);
let snap = decorate(drive.advance(0), start % CYCLE_S);
rig.snapTo(snap);
let elapsed = 0;
let loopT = start % CYCLE_S; // harness clock within the loop, for the freeze
let prevT = snap.simTime % CYCLE_S; // no 'once' event fires for a moment the loop started after
let readyFired = false;
let frozen = false;

/** One simulation step of the harness: mock, extra events, camera, FX. */
function step(dt: number): void {
  elapsed += dt;
  if (holdS > 0) {
    holdS -= dt;
  } else {
    const raw = drive.advance(dt);
    const t = raw.simTime % CYCLE_S;
    const cycle = Math.floor(raw.simTime / CYCLE_S);
    loopT = t;
    snap = decorate(raw, t);
    const pos = snap.skater.pos;
    const extra: SimEvent[] = [];
    if (!vertMode) {
      once('macguffin', cycle, MACGUFFIN_AT, t, prevT, () => {
        extra.push({ type: 'macguffin', tick: raw.tick, id: 'secret_drive', name: 'MacGuffin', splash: 'MACGUFFIN', toast: 'Got it.', hitstopTicks: 7, pos });
        extra.push({ type: 'pickup', tick: raw.tick, kind: 'macguffin', id: 'secret_drive', pos });
      });
    } else {
      once('vertLand', cycle, VERT_TO, t, prevT, () => extra.push({ type: 'land', tick: raw.tick, quality: 'clean', offAxisDeg: 2, tiltDeg: 1, vert: true, speed: 7, pos, linker: 'none' }));
    }
    once('kernel', cycle, KERNEL_AT, t, prevT, () => extra.push({ type: 'specialUsed', tick: raw.tick, specialId: 'kernel_panic' }));
    once('slide', cycle, SLIDE_FROM, t, prevT, () => extra.push({ type: 'specialUsed', tick: raw.tick, specialId: 'gpu_slide' }));
    once('token', cycle, TOKEN_AT, t, prevT, () => extra.push({ type: 'specialUsed', tick: raw.tick, specialId: 'token_overflow' }));
    once('infer', cycle, INFER_FROM, t, prevT, () => extra.push({ type: 'specialUsed', tick: raw.tick, specialId: 'inference_900ms' }));
    prevT = t;
    for (const e of [...drive.events, ...extra]) {
      fx.onEvent(e);
      rig.onEvent(e);
      if (e.type !== 'runTick') panel.log(`t ${t.toFixed(2)} ${e.type}${'specialId' in e ? ' ' + e.specialId : ''}`);
    }
  }
  const stick = {
    x: heldStick.x + (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
    y: heldStick.y + (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0),
  };
  rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
  rig.update(snap, { stick, mouseDeltaPx: { x: mouseDx, y: mouseDy } }, dt);
  mouseDx = 0;
  mouseDy = 0;
  fx.update(snap, dt);
}

startFrames((realDt, frame) => {
  if (freezeAt !== null && !frozen) {
    // Fixed steps up to the freeze time (several per frame so a late freeze arrives quickly).
    let steps = 0;
    while (!frozen && steps < 40) {
      const target = freezeAt >= CYCLE_S ? freezeAt - CYCLE_S : freezeAt;
      const remaining = (target - loopT + CYCLE_S) % CYCLE_S;
      if (remaining <= 1e-6 || remaining < FIXED_STEP * 0.5) {
        frozen = true;
        break;
      }
      step(Math.min(FIXED_STEP, remaining));
      steps += 1;
    }
  } else if (freezeAt === null) {
    step(realDt * slow);
  }
  const k = snap.skater;
  skater.position.set(k.pos.x, k.pos.y, k.pos.z);
  skater.quaternion.set(k.rot.x, k.rot.y, k.rot.z, k.rot.w);
  deckMat.color.set(deckMode === 'blueScreen' ? '#1d5cff' : '#222326');
  bodyMat.emissive.set(snap.special.glowing ? '#4a2a00' : '#000000');

  const d = fx.debug;
  const c = rig.debug;
  panel.setStatus([
    `tick ${snap.tick}  t ${loopT.toFixed(2)}  state ${k.state}  speedRatio ${k.speedRatio.toFixed(2)}  special ${snap.special.activeId ?? '-'}  glowing ${snap.special.glowing}  vertAir ${snap.camera.vertAir}${frozen ? '  FROZEN' : ''}`,
    `sparks ${d.sparksAlive}/${d.sparksSpawned} (${d.sparkKind ?? '-'})  dust ${d.dustSpawned}  stickers ${d.stickersSpawned}  bursts ${d.burstSpawned}  glow ${d.contactGlow.toFixed(2)}  shots ${d.shotsActive}`,
    `speedLines ${d.speedLines.toFixed(2)}  slowMo ${d.slowMo.toFixed(2)}  aura ${d.aura.toFixed(2)}x${d.auraPop.toFixed(2)}  flash ${d.flashAlpha.toFixed(2)}  card ${d.cardActive}  trail ${d.trailSamples}  ribbon ${d.ribbonSamples}  deck ${d.deckOverride}`,
    `cam fov ${c.fovDeg.toFixed(1)}  boom ${c.boomM.toFixed(2)}${c.collided ? ' HIT' : ''} cut ${c.boomCutM.toFixed(2)} rise ${c.riseM.toFixed(2)}  vert ${c.vertBlend.toFixed(2)}  orbit ${c.orbitYawDeg.toFixed(0)}/${c.orbitPitchDeg.toFixed(0)}  shake ${c.shakeM.toFixed(3)}/${c.shakeRotDeg.toFixed(1)}deg  kick ${c.landKickM.toFixed(3)}  hold ${Math.max(0, holdS).toFixed(2)}`,
  ]);
  s.renderer.render(s.scene, rig.camera);
  const ready = freezeAt !== null ? frozen : elapsed >= readyAfterS;
  if (!readyFired && frame >= 10 && ready) {
    readyFired = true;
    shotReadyAt(10);
  }
});
