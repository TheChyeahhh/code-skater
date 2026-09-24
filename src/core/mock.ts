/**
 * src/core/mock.ts: valid stand-in data for tests and dev harnesses (frozen). Nothing in the game
 * uses it. mockSnapshotAt(tick) animates a skater circling a point through an 8 s cycle
 * (push, ollie + kickflip, 50-50, manual, land and bank, bail, get-up) so render, skater, FX, UI
 * and audio harnesses can run before the sim exists; mockEventsAt(tick) emits the matching events.
 */

import { BUTTONS, LETTERS, type Button, type ButtonState, type ComboView, type InputFrame, type LetterId, type LevelId, type SimSnapshot, type SkaterStateName, type PoseId, type BaseTrickId } from './types';
import type { SimEvent } from './events';
import { forwardToYaw, IDENTITY_QUAT, yawQuat, v3 } from './math';
import { maxSpeed, TUNING } from './tuning';

export function noButtons(): ButtonState {
  const held = {} as Record<Button, boolean>;
  for (const b of BUTTONS) held[b] = false;
  return held;
}

/** An InputFrame with nothing pressed. */
export function neutralFrame(tick: number): InputFrame {
  return {
    tick, source: 'script', held: noButtons(), pressed: [], released: [],
    stick: { x: 0, y: 0 }, look: { x: 0, y: 0 }, lookDelta: { x: 0, y: 0 },
    dpad: 'N', stickDir: 'N', dir: 'N', dirAxis: { x: 0, y: 0 }, dirHistory: [], pressHistory: [],
  };
}

/** neutralFrame with overrides (no history logic: use the input track's FrameBuilder for sequences). */
export function frameWith(tick: number, patch: Partial<Omit<InputFrame, 'tick'>>): InputFrame {
  return { ...neutralFrame(tick), ...patch };
}

function noLetters(): Record<LetterId, boolean> {
  const r = {} as Record<LetterId, boolean>;
  for (const l of LETTERS) r[l] = false;
  return r;
}

/** A skater standing at the origin of the test box: a valid SimSnapshot with nothing going on. */
export function restSnapshot(levelId: LevelId = 'testBox'): SimSnapshot {
  const pos = v3(20, 0, 20);
  return {
    tick: 0, simTime: 0, timeScale: 1, levelId,
    skater: {
      pos, rot: IDENTITY_QUAT, vel: v3(0, 0, 0), speed: 0, speedRatio: 0, speedTier: 'slow',
      forward: v3(0, 0, -1), up: v3(0, 1, 0), state: 'Grounded', stateTicks: 0, stance: 'regular',
      fakie: false, pumping: false, crouchCharge: 0, boardRel: IDENTITY_QUAT, trickId: null, flipId: null,
      flipPhase: 0, grabId: null, pose: 'roll', poseVariant: null, posePhase: 0, airYawDeg: 0, grind: null,
      contactPoint: pos, surface: null, bail: null,
    },
    combo: null,
    special: { meter: 0, glowing: false, activeId: null, heldS: 0 },
    balance: null,
    run: {
      levelId, mode: 'free', clockS: TUNING.RUN_LENGTH_S, overtime: false, ended: false, score: 0,
      bestCombo: 0, letters: noLetters(), macguffinCollected: false, goalsCompleted: [],
    },
    camera: { vertAir: false, rampNormal: null, lookAhead: pos, heading: v3(0, 0, -1) },
    lastLand: null,
    npc: null,
  };
}

const CYCLE_S = 8;
const CENTRE = { x: 20, z: 20 };
const RADIUS = 8;
const SPEED = 7;

interface Phase {
  readonly from: number;
  readonly to: number;
  readonly state: SkaterStateName;
  readonly pose: PoseId;
  readonly variant: BaseTrickId | null;
}

const AIR_FROM_S = 2;
const AIR_TO_S = 2.8;

const PHASES: readonly Phase[] = [
  { from: 0, to: 2, state: 'Grounded', pose: 'push', variant: null },
  // The kickflip owns the pose for its 380 ms animation, then the rest of the air is "air".
  { from: AIR_FROM_S, to: AIR_FROM_S + 0.38, state: 'Air', pose: 'flip', variant: 'kickflip' },
  { from: AIR_FROM_S + 0.38, to: AIR_TO_S, state: 'Air', pose: 'air', variant: null },
  { from: 2.8, to: 4.8, state: 'Grind', pose: 'grind', variant: 'fifty_fifty' },
  { from: 4.8, to: 6.3, state: 'Manual', pose: 'manual', variant: 'manual' },
  { from: 6.3, to: 7.0, state: 'Grounded', pose: 'roll', variant: null },
  { from: 7.0, to: 7.6, state: 'Bail', pose: 'bail', variant: null },
  { from: 7.6, to: 8.0, state: 'GetUp', pose: 'getup', variant: null },
];

function phaseAt(t: number): Phase {
  for (const p of PHASES) if (t >= p.from && t < p.to) return p;
  return PHASES[0] as Phase;
}

function comboAt(t: number): ComboView | null {
  if (t < 2 || t >= 6.3) return null;
  const names = ['Kickflip'];
  let base = 100;
  let count = 1;
  if (t >= 2.8) {
    names.push('50-50');
    base += 100 + Math.round(Math.min(t - 2.8, 2) * 80);
    count += 1;
  }
  if (t >= 4.8) {
    names.push('MOCK GAP', 'Manual');
    base += 250 + 50 + Math.round((t - 4.8) * 40);
    count += 2;
  }
  const elements = names.map((name, i) => ({
    id: (i === 2 ? 'gap:MOCK' : 'kickflip') as ComboView['elements'][number]['id'],
    category: 'flip' as const, name, value: 0, accrual: 0, open: i === names.length - 1,
  }));
  return { elements, names, base, multiplier: count, spin180s: 0, final: base * count };
}

/** The animated mock snapshot for any tick (loops every 8 s). */
export function mockSnapshotAt(tick: number, levelId: LevelId = 'testBox'): SimSnapshot {
  const simTime = tick / TUNING.SIM_HZ;
  const t = simTime % CYCLE_S;
  const phase = phaseAt(t);
  const theta = (simTime * SPEED) / RADIUS;
  const moving = phase.state !== 'Bail' && phase.state !== 'GetUp';
  const speed = moving ? SPEED : 0;
  const speedRatio = speed / maxSpeed(false);
  let y = 0;
  if (phase.state === 'Air') {
    const u = (t - AIR_FROM_S) / (AIR_TO_S - AIR_FROM_S);
    y = 4 * TUNING.OLLIE_H_FULL_M * u * (1 - u);
  } else if (phase.state === 'Grind') {
    y = 0.6;
  }
  const pos = v3(CENTRE.x + RADIUS * Math.cos(theta), y, CENTRE.z + RADIUS * Math.sin(theta));
  const forward = v3(-Math.sin(theta), 0, Math.cos(theta));
  const vel = v3(forward.x * speed, 0, forward.z * speed);
  const yaw = forwardToYaw(forward);
  const rest = restSnapshot(levelId);
  const phaseLen = phase.to - phase.from;
  const combo = comboAt(t);
  const needleActive = phase.state === 'Grind' || phase.state === 'Manual';
  const needle = needleActive ? 0.6 * Math.sin((t - phase.from) * 2.2) : 0;
  const flipS = TUNING.FLIP_ANIM_MS_T1 / 1000;
  const flipping = phase.state === 'Air' && t - AIR_FROM_S < flipS;
  const flipPhase = flipping ? (t - AIR_FROM_S) / flipS : 0;
  // posePhase per the PoseId table in src/core/types.ts.
  let posePhase: number;
  if (phase.pose === 'push' || phase.pose === 'roll') posePhase = (t % TUNING.PUSH_CYCLE_S) / TUNING.PUSH_CYCLE_S;
  else if (phase.pose === 'flip') posePhase = flipPhase;
  else if (phase.pose === 'air') posePhase = 0;
  else if (needleActive) posePhase = (needle + 1) / 2;
  else posePhase = (t - phase.from) / phaseLen;
  const meter = Math.min(1, (t / 6) % 1.2);
  const letters = noLetters();
  if (t >= 5.5) letters.C = true;
  return {
    ...rest,
    tick,
    simTime,
    skater: {
      ...rest.skater,
      pos, vel, speed, speedRatio, speedTier: speedRatio >= TUNING.CAM_FOV_KICK_SPEED ? 'fast' : speedRatio >= TUNING.SPEED_TIER_CRUISE_RATIO ? 'cruise' : 'slow',
      forward, rot: yawQuat(yaw), state: phase.state,
      stateTicks: Math.floor((t - phase.from) * TUNING.SIM_HZ), pose: phase.pose, poseVariant: phase.variant,
      posePhase, trickId: phase.variant, flipId: flipping ? 'kickflip' : null, flipPhase,
      grind: phase.state === 'Grind'
        ? { type: 'fifty_fifty', railId: 'MOCK-R1', railKind: 'rail', contact: pos, tangent: forward, distanceM: (t - phase.from) * SPEED }
        : null,
      contactPoint: phase.state === 'Air' ? null : pos,
      bail: phase.state === 'Bail' ? { phase: 'tumble', t: (t - phase.from) / phaseLen } : phase.state === 'GetUp' ? { phase: 'getup', t: (t - phase.from) / phaseLen } : null,
    },
    combo,
    special: { meter, glowing: meter >= 1, activeId: null, heldS: 0 },
    balance: needleActive ? { needle, axis: phase.state === 'Manual' ? 'v' : 'h' } : null,
    run: { ...rest.run, clockS: Math.max(0, TUNING.RUN_LENGTH_S - simTime), score: Math.floor(simTime / CYCLE_S) * 1650, letters },
    camera: { vertAir: false, rampNormal: null, lookAhead: v3(pos.x + forward.x * TUNING.CAM_LOOKAHEAD_M, pos.y, pos.z + forward.z * TUNING.CAM_LOOKAHEAD_M), heading: forward },
    lastLand: t >= 6.3 ? { quality: 'clean', tick: tick - Math.floor((t - 6.3) * TUNING.SIM_HZ), final: 1650 } : null,
  };
}

/** Events the mock cycle produces on this exact tick. */
export function mockEventsAt(tick: number): SimEvent[] {
  const cycleTicks = CYCLE_S * TUNING.SIM_HZ;
  const local = tick % cycleTicks;
  const at = (s: number): boolean => local === Math.round(s * TUNING.SIM_HZ);
  const snap = mockSnapshotAt(tick);
  const pos = snap.skater.pos;
  const out: SimEvent[] = [];
  if (local % TUNING.SIM_HZ === 0) out.push({ type: 'runTick', tick, secondsLeft: Math.max(0, Math.ceil(snap.run.clockS)) });
  if (at(0.3) || at(0.9) || at(1.5)) out.push({ type: 'push', tick, pos });
  if (at(2)) {
    out.push({ type: 'pop', tick, heightM: TUNING.OLLIE_H_FULL_M, charge: 1, from: 'Crouch', pos });
    out.push({ type: 'trickStart', tick, trickId: 'kickflip', category: 'flip', animMs: TUNING.FLIP_ANIM_MS_T1 });
  }
  if (at(2.8)) {
    out.push({ type: 'trickLand', tick, trickId: 'kickflip' });
    out.push({ type: 'grindStart', tick, railId: 'MOCK-R1', railKind: 'rail', grindType: 'fifty_fifty', pos, speed: SPEED });
  }
  if (at(4)) out.push({ type: 'specialReady', tick });
  if (at(4.8)) {
    out.push({ type: 'grindEnd', tick, railId: 'MOCK-R1', railKind: 'rail', grindType: 'fifty_fifty', reason: 'railEnd', heldS: 2, distanceM: 14, pos });
    out.push({ type: 'gap', tick, gapId: 'MOCK', name: 'MOCK GAP', base: 250 });
    out.push({ type: 'manualStart', tick, manualId: 'manual', swap: false, pos });
  }
  if (at(5.5)) {
    out.push({ type: 'letter', tick, letter: 'C', collected: ['C'], pos });
    out.push({ type: 'pickup', tick, kind: 'letter', id: 'C', pos });
  }
  if (at(6.3)) {
    out.push({ type: 'manualEnd', tick, manualId: 'manual', heldS: 1.5, reason: 'pop' });
    out.push({ type: 'land', tick, quality: 'clean', offAxisDeg: 4, tiltDeg: 3, vert: false, speed: SPEED, pos, linker: 'none' });
    out.push({ type: 'comboBanked', tick, final: 1650, base: 550, multiplier: 3, elementCount: 4, quality: 'clean', runScore: snap.run.score });
  }
  if (at(7)) {
    out.push({ type: 'bail', tick, reason: 'landing', speed: SPEED, pos });
    out.push({ type: 'specialEmptied', tick, reason: 'bail' });
  }
  return out;
}
