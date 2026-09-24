// tests/simController.test.ts (sim track): the kinematic controller on the REAL world, testBox and
// the sim fixture level built by the real builder (DESIGN C.6, REQ-CTL-*, REQ-VRT-*, CR-15).
// DESIGN's "controller.test" maps here (ARCHITECTURE.md section 10).
import { afterEach, describe, expect, it } from 'vitest';
import { rotate3 } from '../src/core/math';
import { resetTuning, ticks, TUNING } from '../src/core/tuning';
import { applyPop, applyRevertPivot, classifySurface, createBody, offAxis, popHeight } from '../src/sim/controller';
import { basisQuat } from '../src/sim/physics/vec';
import { built, describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';
import { QP_COPING_Y, QP_COPING_Z, SIM_FIXTURE } from './fixtures/sim/levels';
import { createCollisionWorld } from '../src/sim/collision';
import { createRailNetwork } from '../src/sim/rails';
import type { ControllerEnv } from '../src/sim/controller';

const NORTH = { x: 0, y: 0, z: -1 };
const EAST = { x: 1, y: 0, z: 0 };
const WEST = { x: -1, y: 0, z: 0 };
const fixture = built(SIM_FIXTURE);

afterEach(() => resetTuning());

function normalAt(slopeDeg: number): { x: number; y: number; z: number } {
  const r = (slopeDeg * Math.PI) / 180;
  return { x: 0, y: Math.cos(r), z: Math.sin(r) };
}

describe('REQ-CTL-02 / REQ-CTL-17: surface classes from tag and slope', () => {
  it('six normals classify as the vocabulary table', () => {
    const flat = classifySurface(normalAt(0), 'solid');
    expect([flat.flat, flat.bank, flat.transition, flat.vertLanding, flat.wall]).toEqual([true, false, false, false, false]);
    const gentle = classifySurface(normalAt(34.9), 'solid');
    expect(gentle.flat).toBe(true);
    const bank = classifySurface(normalAt(38), 'solid');
    expect([bank.flat, bank.bank, bank.vertLanding, bank.wall]).toEqual([false, true, false, false]);
    const face = classifySurface(normalAt(50), 'transition');
    expect([face.transition, face.vertLanding, face.nearVertical, face.bank, face.wall]).toEqual([true, true, false, false, false]);
    const lip = classifySurface(normalAt(75), 'transition');
    expect([lip.nearVertical, lip.wall]).toEqual([true, false]);
    const wall = classifySurface(normalAt(85), 'solid');
    expect([wall.wall, wall.bank]).toEqual([true, false]);
    expect(classifySurface(normalAt(0), 'boundary').wall).toBe(true);
    expect(classifySurface(normalAt(90), 'transition').wall).toBe(false);
    expect(face.slopeDeg).toBeCloseTo(50, 9);
  });
});

describe('snapshot basis (src/core/types.ts local frame)', () => {
  it('basisQuat maps local -z to the nose and +y to up', () => {
    const cases = [
      { nose: NORTH, up: { x: 0, y: 1, z: 0 } },
      { nose: EAST, up: { x: 0, y: 1, z: 0 } },
      { nose: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
      { nose: { x: 0.6, y: -0.8, z: 0 }, up: { x: 0.8, y: 0.6, z: 0 } },
    ];
    for (const c of cases) {
      const q = basisQuat(c.nose, c.up);
      const f = rotate3(q, { x: 0, y: 0, z: -1 });
      const u = rotate3(q, { x: 0, y: 1, z: 0 });
      expect(f.x).toBeCloseTo(c.nose.x, 6);
      expect(f.y).toBeCloseTo(c.nose.y, 6);
      expect(f.z).toBeCloseTo(c.nose.z, 6);
      expect(u.x).toBeCloseTo(c.up.x, 6);
      expect(u.y).toBeCloseTo(c.up.y, 6);
      expect(u.z).toBeCloseTo(c.up.z, 6);
    }
  });
});

describe.skipIf(!worldAvailable())('controller on the real world', () => {
  it('REQ-CTL-05: ollie apex 0.9 m tap and 1.6 m full charge, within 1 cm', () => {
    for (const [holdTicks, expected] of [[1, TUNING.OLLIE_H_TAP_M], [ticks(TUNING.OLLIE_FULL_S * 1000) + 6, TUNING.OLLIE_H_FULL_M]] as const) {
      const r = new Rig();
      r.teleport({ x: 40, y: 0, z: 50 }, NORTH, 0);
      r.hold(holdTicks, { buttons: ['ollie'] });
      expect(r.snap.skater.state).toBe('Crouch');
      r.hold(1);
      expect(r.snap.skater.state).toBe('Air');
      const pop = r.of('pop')[0];
      expect(pop?.heightM).toBeCloseTo(expected, 9);
      let apex = 0;
      r.run(200, (s) => {
        apex = Math.max(apex, s.skater.pos.y);
        return {};
      }, (s) => s.skater.state !== 'Air');
      expect(Math.abs(apex - expected)).toBeLessThan(0.01);
      expect(popHeight(holdTicks === 1 ? 0 : 1, 'regular')).toBeCloseTo(expected, 9);
    }
  });

  it('REQ-CTL-13: switch stance pops 15% lower at switch stat 4', () => {
    expect(popHeight(0, 'switch')).toBeCloseTo(TUNING.OLLIE_H_TAP_M * 0.85, 9);
    TUNING.STAT_AIR = 10;
    expect(popHeight(0, 'regular')).toBeCloseTo(TUNING.OLLIE_H_TAP_M * 1.2, 9);
  });

  it('REQ-CTL-04 (CR-44): auto-push 0 to 11.05 m/s in 1.2 s within one tick, then no more pushing', () => {
    const r = new Rig();
    r.teleport({ x: 40, y: 0, z: 58 }, NORTH, 0);
    let reached = -1;
    r.run(400, () => ({ dpad: 'U' }), (s) => {
      if (reached < 0 && s.skater.speed >= TUNING.PUSH_CUTOFF * TUNING.MAX_SPEED_MPS - 1e-9) reached = r.tick;
      return reached >= 0;
    });
    // 0.85 x 13 / 9.2 = 1.201 s = 144.1 ticks.
    expect(Math.abs(reached - ((TUNING.PUSH_CUTOFF * TUNING.MAX_SPEED_MPS) / TUNING.PUSH_ACCEL) * 120)).toBeLessThanOrEqual(1);
    expect(r.of('push').length).toBeGreaterThanOrEqual(2);
    // With the cutoff at full speed (CR-65) the push holds the skater at max speed: friction only
    // takes the few centimetres per second the next stroke gives back.
    r.hold(120, { dpad: 'U' });
    expect(r.snap.skater.speed).toBeCloseTo(TUNING.MAX_SPEED_MPS, 1);
    expect(r.snap.skater.speed).toBeGreaterThan(TUNING.PUSH_CUTOFF * TUNING.MAX_SPEED_MPS - 0.1);
  });

  it('REQ-CTL-04 (CR-65): stick back brakes 6 m/s^2 plus friction, stops, never pivots or reverses; no brake in Manual', () => {
    const r = new Rig();
    r.teleport({ x: 40, y: 0, z: 58 }, NORTH, 6);
    r.hold(60, { dpad: 'D' });
    // 0.5 s at 6.0 + 0.25 m/s^2.
    expect(r.snap.skater.speed).toBeCloseTo(6 - 0.5 * (TUNING.BRAKE_DECEL + TUNING.ROLL_FRICTION), 2);
    r.hold(200, { dpad: 'D' });
    // Founder playtest 2: stopped still facing north, no pivot, no rolling back, no push while held.
    expect(r.snap.skater.forward.z).toBeLessThan(-0.99);
    expect(r.snap.skater.speed).toBe(0);
    expect(r.of('push').length).toBe(0);

    const m = new Rig();
    m.teleport({ x: 40, y: 0, z: 58 }, NORTH, 6);
    m.hold(4, { dpad: 'U' });
    m.hold(4, { dpad: 'D' });
    expect(m.snap.skater.state).toBe('Manual');
    const v = m.snap.skater.speed;
    m.hold(60, { dpad: 'D' });
    expect(m.snap.skater.state).toBe('Manual');
    expect(m.snap.skater.speed).toBeCloseTo(v - 0.5 * TUNING.MANUAL_FRICTION, 2);
  });

  it('REQ-CTL-03: a 180 deg manual turn at 7.5 m/s spans 7.2 m (radius 0.477 x v)', () => {
    TUNING.MANUAL_FRICTION = 0;
    const r = new Rig();
    r.teleport({ x: 20, y: 0, z: 58 }, NORTH, 7.5);
    r.hold(4, { dpad: 'U' });
    r.hold(4, { dpad: 'D' });
    expect(r.snap.skater.state).toBe('Manual');
    const x0 = r.snap.skater.pos.x;
    // The Up of the manual pair auto-pushes for a few ticks (PUSH_ACCEL 9.2, CR-44): the turn runs at the entry speed.
    const v = r.snap.skater.speed;
    // 180 deg at TURN_RATE_MANUAL_DPS (120, then 150 since the founder's 2026-09-23 playtest).
    r.hold(Math.round((180 / TUNING.TURN_RATE_MANUAL_DPS) * 120), { dpad: 'R' });
    expect(r.snap.skater.state).toBe('Manual');
    expect(r.snap.skater.forward.z).toBeGreaterThan(0.999);
    expect(r.snap.skater.pos.x - x0).toBeCloseTo((2 * v) / ((TUNING.TURN_RATE_MANUAL_DPS * Math.PI) / 180), 1);
  });

  it('REQ-CTL-06: over-speed decays at 4 m/s^2 to vmax, glowing raises vmax 8%', () => {
    const r = new Rig();
    r.teleport({ x: 40, y: 0, z: 58 }, NORTH, 18);
    r.hold(60);
    expect(r.snap.skater.speed).toBeCloseTo(18 - 0.5 * (TUNING.OVERSPEED_DECAY + TUNING.ROLL_FRICTION), 2);
    expect(r.snap.skater.speedRatio).toBeCloseTo(r.snap.skater.speed / TUNING.MAX_SPEED_MPS, 6);
    r.setMeter(1);
    r.hold(1);
    expect(r.snap.special.glowing).toBe(true);
    expect(r.snap.skater.speedRatio).toBeCloseTo(r.snap.skater.speed / (TUNING.MAX_SPEED_MPS * (1 + TUNING.GLOW_SPEED_BONUS)), 6);
  });

  it('REQ-CTL-07 / REQ-CTL-08: a 10 m drop lands clean keeping 0.96 of the tangential speed', () => {
    const r = new Rig({ level: fixture });
    r.teleport({ x: 79, y: 10, z: 7 }, EAST, 4);
    expect(r.snap.skater.state).toBe('Grounded');
    r.run(300, () => ({}), () => r.of('land').length > 0 || r.of('bail').length > 0);
    const land = r.of('land')[0];
    expect(r.of('bail')).toEqual([]);
    expect(land?.pos.y).toBeCloseTo(0, 6);
    expect(land?.offAxisDeg).toBeCloseTo(0, 6);
    // Horizontal 4 m/s less the tower-top friction before the edge, x 0.96 at contact.
    const before = r.snaps[r.snaps.length - 2]?.skater.vel;
    expect(land?.speed).toBeCloseTo(Math.hypot(before?.x ?? 0, before?.z ?? 0) * TUNING.LAND_SPEED_RETAIN, 3);
  });

  it('REQ-CTL-09: launching from flat onto a 60 deg bank lands with tilt < 40 (without auto-orient the tilt is far larger, and since CR-43 tilt never bails)', () => {
    const attempt = (): { tilt: number; bailed: boolean; slope: number } => {
      const r = new Rig({ level: fixture });
      r.teleport({ x: 48, y: 0, z: 20 }, WEST, 7);
      r.hold(ticks(700), { buttons: ['ollie'] });
      r.run(200, () => ({}), () => r.of('land').length > 0 || r.of('bail').length > 0);
      const land = r.of('land')[0];
      const contact = r.snaps[r.snaps.length - 1]?.skater.surface;
      return { tilt: land?.tiltDeg ?? 99, bailed: r.of('bail').length > 0, slope: contact?.flags.slopeDeg ?? 0 };
    };
    const ok = attempt();
    expect(ok.bailed).toBe(false);
    expect(ok.slope).toBeCloseTo(60, 0);
    expect(ok.tilt).toBeLessThan(40);
    TUNING.AIR_ORIENT_RATE_DPS = 0;
    const stiff = attempt();
    expect(stiff.tilt).toBeGreaterThan(40);
    expect(stiff.bailed).toBe(false);
  });

  it('REQ-CTL-11: 11 m/s reaches the 3.6 m coping at 8.51 m/s within 0.1 (transition gravity x 0.3, CR-44)', () => {
    const r = new Rig();
    r.teleport({ x: 32, y: 0, z: 7.0 }, NORTH, 11);
    r.run(200, () => ({}), (s) => s.skater.state === 'Air');
    const launchSpeed = r.snap.skater.speed;
    expect(Math.abs(launchSpeed - Math.sqrt(121 - 2 * TUNING.GRAVITY * TUNING.TRANSITION_GRAVITY_FACTOR * 3.6))).toBeLessThan(0.1);
    expect(r.of('stateChanged').find((e) => e.to === 'Air')?.row).toBe('37');
  });

  it('REQ-CTL-18: too slow for the coping, the skater rolls back down fakie without stalling', () => {
    const r = new Rig();
    r.teleport({ x: 32, y: 0, z: 7.0 }, NORTH, 6);
    let peak = 0;
    r.run(240, (s) => {
      peak = Math.max(peak, s.skater.pos.y);
      return {};
    });
    expect(r.of('stateChanged')).toEqual([]);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(3.6);
    expect(r.snap.skater.fakie).toBe(true);
    expect(r.snap.skater.vel.z).toBeGreaterThan(0);
  });

  it('REQ-CTL-12: carving up a steep face at lateral fraction >= 0.4 is a free launch with full velocity', () => {
    const r = new Rig({ level: fixture });
    const dir = { x: Math.sin((50 * Math.PI) / 180), y: 0, z: -Math.cos((50 * Math.PI) / 180) };
    r.teleport({ x: 14, y: 0, z: 8.683 }, dir, 11);
    r.run(200, () => ({}), (s) => s.skater.state === 'Air');
    const pre = r.snaps[r.snaps.length - 2]?.skater.vel;
    const vel = r.snap.skater.vel;
    expect(r.snap.skater.state).toBe('Air');
    expect(r.snap.camera.vertAir).toBe(false);
    // The launch keeps the face-tangent velocity (no assist): its outward part is not clamped to 0.4.
    expect(Math.abs(vel.x - (pre?.x ?? 0))).toBeLessThan(0.01);
    expect(Math.hypot(vel.x, vel.y, vel.z)).toBeGreaterThan(5);
  });

  it('REQ-CTL-20 (CR-65): a wall never bails; 6 m/s at 30 deg incidence bonks back off it, at 60 deg it slides keeping 0.8', () => {
    const dir = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180), y: 0, z: Math.sin((deg * Math.PI) / 180) });
    const head = new Rig();
    head.teleport({ x: 62, y: 0, z: 40 }, dir(30), 6);
    let wallX = 0;
    head.run(120, (s) => {
      wallX = Math.max(wallX, s.skater.pos.x);
      return {};
    });
    expect(head.of('bail')).toEqual([]);
    expect(head.snap.skater.state).toBe('Grounded');
    // Bounced: moving away from the wall (-x) and no longer touching it.
    expect(head.snap.skater.vel.x).toBeLessThan(0);
    expect(head.snap.skater.pos.x).toBeLessThan(wallX - 0.5);

    const glance = new Rig();
    glance.teleport({ x: 62, y: 0, z: 40 }, dir(60), 6);
    let hitSpeed = 0;
    glance.run(120, (s) => {
      hitSpeed = s.skater.speed;
      return {};
    }, (s) => s.skater.vel.x < 1e-6);
    expect(glance.of('bail')).toEqual([]);
    expect(glance.snap.skater.state).toBe('Grounded');
    // Tangential part (sin 60) kept x 0.8, minus one tick of rolling friction.
    expect(glance.snap.skater.speed).toBeCloseTo(hitSpeed * Math.sin(Math.PI / 3) * TUNING.WALL_SLIDE_RETAIN, 1);
  });

  it('REQ-CTL-21: a pump down a transition adds speed and its release never leaves the surface', () => {
    const run = (pump: boolean): { speed: number; airs: number; pops: number } => {
      const r = new Rig();
      // 6 m/s stays below the 3.6 m coping even pumped (transition gravity x 0.3 needs 7.0, CR-44).
      r.teleport({ x: 32, y: 0, z: 7.0 }, NORTH, 6);
      r.run(400, (s) => (pump && s.skater.vel.z > 0 && s.skater.pos.y > 0.05 ? { buttons: ['ollie'] } : {}), (s) => s.skater.vel.z > 0 && s.skater.pos.y === 0 && s.skater.surface?.surfaceId === 'TB-FLOOR');
      r.hold(10);
      return { speed: r.snap.skater.speed, airs: r.of('stateChanged').filter((e) => e.to === 'Air').length, pops: r.of('pop').length };
    };
    const plain = run(false);
    const pumped = run(true);
    expect(pumped.airs).toBe(0);
    expect(pumped.pops).toBe(0);
    expect(pumped.speed).toBeGreaterThan(plain.speed + 1);
  });

  it('REQ-CTL-22 / REQ-LVL-11: rolling through a flat bar at ground level hits nothing (pipes are not in the collider)', () => {
    const r = new Rig();
    r.teleport({ x: 40, y: 0, z: 44 }, NORTH, 6);
    r.hold(300);
    expect(r.of('stateChanged')).toEqual([]);
    // TB-RAIL (0.55 high) spans z 40..20 right above this line: 10 m of it passed with no contact.
    expect(r.snap.skater.pos.z).toBeLessThan(30);
    expect(r.snap.skater.pos.y).toBe(0);
  });
});

describe.skipIf(!worldAvailable())('vert (REQ-VRT, CR-15)', () => {
  const qpRun = (speed: number, input: (r: Rig, t: number) => { buttons?: ('ollie' | 'revert')[] } = () => ({})) => {
    const r = new Rig({ level: fixture });
    r.teleport({ x: 20, y: 0, z: 8.683 }, NORTH, speed);
    let apex = 0;
    r.run(400, (s) => {
      apex = Math.max(apex, s.skater.pos.y);
      return input(r, r.tick);
    }, () => r.of('land').length > 0 || r.of('bail').length > 0);
    return { r, apex, land: r.of('land')[0], launch: r.of('stateChanged').find((e) => e.to === 'Air') };
  };

  it('REQ-VRT-01: exit at 8.5 m/s up a 2.4 QP lands on the same face within 1.0 m of the coping', () => {
    const { r, land } = qpRun(8.5);
    expect(r.of('bail')).toEqual([]);
    expect(land?.vert).toBe(true);
    expect(r.snap.skater.surface?.surfaceId).toBe('SF-QP');
    expect(QP_COPING_Y - (land?.pos.y ?? 0)).toBeGreaterThan(0);
    expect(QP_COPING_Y - (land?.pos.y ?? 0)).toBeLessThanOrEqual(1.0);
    expect(land?.pos.z).toBeGreaterThan(QP_COPING_Z);
    // The assist strips the outward speed to 0.4 m/s (the launch tick of the same run).
    const air = r.snaps.find((s) => s.skater.state === 'Air');
    expect(air?.skater.vel.z).toBeCloseTo(TUNING.VERT_ASSIST_MIN_OUT_MPS, 6);
    expect(air?.camera.vertAir).toBe(true);
  });

  it('CR-15: without the assist the same launch flies off the ramp onto the deck (the mechanic is load-bearing)', () => {
    TUNING.VERT_ASSIST_MAX_LATERAL = 0;
    const { r, land } = qpRun(8.5);
    expect(r.of('bail')).toEqual([]);
    // The unassisted launch keeps its inward drift and comes down on the flat deck behind the coping.
    expect(land?.vert).toBe(false);
    expect(land?.pos.z).toBeLessThan(QP_COPING_Z);
    expect(land?.pos.y).toBeCloseTo(QP_COPING_Y, 6);
  });

  it('REQ-VRT-02: air above the 2.4 QP coping at 11 m/s matches the C.6 formula within 3% (no pop, tap)', () => {
    // C.6: v_lip^2 = v^2 - 2 g f H, air = v_lip^2 / 2g (1.65 m at f 0.45; 2.03 m at the CR-44 f 0.3).
    const g = TUNING.GRAVITY;
    const vLip = Math.sqrt(121 - 2 * g * TUNING.TRANSITION_GRAVITY_FACTOR * QP_COPING_Y);
    const air = (vLip * vLip) / (2 * g);
    expect(Math.abs(qpRun(11).apex - QP_COPING_Y - air) / air).toBeLessThan(0.03);
    // Probe the launch tick, then release a tap pop one tick before it (on the face).
    const probe = qpRun(11).launch?.tick ?? 0;
    const tap = qpRun(11, (_r, t) => (t >= probe - 2 && t < probe - 1 ? { buttons: ['ollie'] } : {}));
    expect(tap.r.of('pop').length).toBe(1);
    // The tap adds SQRT1_2 x VERT_POP_SCALE x sqrt(2 g tap) upward (2.85 m at the old numbers).
    const vTap = vLip + Math.SQRT1_2 * TUNING.VERT_POP_SCALE * Math.sqrt(2 * g * TUNING.OLLIE_H_TAP_M);
    const tapAir = (vTap * vTap) / (2 * g);
    expect(Math.abs(tap.apex - QP_COPING_Y - tapAir) / tapAir).toBeLessThan(0.03);
    expect(tap.land?.vert).toBe(true);
  });

  it('REQ-VRT-02: a pop on a face at slope >= 45 is scaled by 0.6 and blended toward up', () => {
    const level = built();
    const env: ControllerEnv = { collision: createCollisionWorld(level.collider), rails: createRailNetwork(level.rails), dtS: 1 / 120, tick: 0, glowing: false, stance: 'regular' };
    const n = { x: 0, y: 0, z: 1 };
    const body = {
      ...createBody({ x: 32, y: 3.3, z: 4 }, 0), vel: { x: 0, y: 5, z: 0 }, nose: { x: 0, y: 1, z: 0 }, up: n,
      surface: { point: { x: 32, y: 3.3, z: 4 }, normal: n, surfaceId: 'TB-VERT', flags: classifySurface(n, 'transition') },
    };
    const popped = applyPop(body, 0, env);
    const vPop = Math.sqrt(2 * TUNING.GRAVITY * TUNING.OLLIE_H_TAP_M);
    expect(popped.vel.y).toBeCloseTo(5 + Math.SQRT1_2 * TUNING.VERT_POP_SCALE * vPop, 9);
    // The outward part is then clamped by the assist (the face is near-vertical): 0.15 x the popped
    // outward speed, clamped to [0.4, 1.0] m/s.
    const out = Math.SQRT1_2 * TUNING.VERT_POP_SCALE * vPop;
    expect(popped.vel.z).toBeCloseTo(Math.min(TUNING.VERT_ASSIST_MAX_OUT_MPS, Math.max(TUNING.VERT_ASSIST_MIN_OUT_MPS, TUNING.VERT_ASSIST_KEEP * out)), 9);
    expect(popped.vel.z).toBeLessThanOrEqual(TUNING.VERT_ASSIST_MAX_OUT_MPS);
    expect(popped.launch?.assisted).toBe(true);
    // The slope threshold is the live SIM_VERT_POP_MIN_SLOPE_DEG: above 90 no face scales its pop.
    TUNING.SIM_VERT_POP_MIN_SLOPE_DEG = 91;
    expect(applyPop(body, 0, env).vel.y).toBeCloseTo(5 + Math.SQRT1_2 * vPop, 9);
  });

  it('REQ-VRT-06 / REQ-VRT-12: no spin re-enters fakie with off-axis 0; a 180 on the face re-enters forward', () => {
    const none = qpRun(10);
    expect(none.land?.offAxisDeg).toBeCloseTo(0, 3);
    expect(none.r.snap.skater.fakie).toBe(true);
    const spun = new Rig({ level: fixture });
    spun.teleport({ x: 20, y: 0, z: 8.683 }, NORTH, 10);
    spun.run(400, (s) => (s.skater.state === 'Air' && s.skater.stateTicks < 3 ? { buttons: ['spinR'] } : {}), () => spun.of('land').length > 0 || spun.of('bail').length > 0);
    const land = spun.of('land')[0];
    expect(spun.of('bail')).toEqual([]);
    expect(land?.offAxisDeg).toBeLessThan(1);
    expect(spun.snap.skater.fakie).toBe(false);
  });

  it('REQ-VRT-10: 11 m/s up the QP, Cross released 50 ms after leaving the coping, lands on the same face within 1.5 m below', () => {
    const probe = qpRun(11).launch?.tick ?? 0;
    const { r, land } = qpRun(11, (_r, t) => (t >= probe - 20 && t < probe + ticks(50) ? { buttons: ['ollie'] } : {}));
    expect(r.of('pop')[0]?.from).toBe('Air');
    expect(r.of('bail')).toEqual([]);
    expect(r.snap.skater.surface?.surfaceId).toBe('SF-QP');
    expect(QP_COPING_Y - (land?.pos.y ?? 0)).toBeLessThanOrEqual(1.5);
    expect(land?.vert).toBe(true);
  });

  it('REQ-VRT-03 / REQ-VRT-04: L1/R1 bursts turn 180 in 0.25 s, twice as fast as the stick, and snap to 180', () => {
    const air = (): Rig => {
      const r = new Rig();
      r.teleport({ x: 40, y: 3, z: 50 }, NORTH, 0);
      expect(r.snap.skater.state).toBe('Air');
      return r;
    };
    const quick = air();
    quick.hold(1, { buttons: ['spinR'] });
    quick.hold(ticks(250) - 1);
    expect(quick.snap.skater.airYawDeg).toBeCloseTo(-180, 6);
    quick.hold(10);
    expect(quick.snap.skater.airYawDeg).toBeCloseTo(-180, 6);
    const stick = air();
    stick.hold(ticks(250), { dpad: 'R' });
    expect(stick.snap.skater.airYawDeg).toBeCloseTo(-90, 6);
    stick.hold(ticks(250), { dpad: 'R' });
    expect(stick.snap.skater.airYawDeg).toBeCloseTo(-180, 6);
    // Held R1 repeats bursts back to back: 0.5 s held = two bursts = 360.
    const held = air();
    held.hold(ticks(500), { buttons: ['spinR'] });
    expect(held.snap.skater.airYawDeg).toBeCloseTo(-360, 6);
    // Stick + bursts are capped at 900 deg/s.
    const both = air();
    both.hold(ticks(250), { buttons: ['spinR'], dpad: 'R' });
    expect(Math.abs(both.snap.skater.airYawDeg)).toBeCloseTo((900 * ticks(250)) / 120, 6);
  });

  it('REQ-REV-04: the revert pivot yaws 180, keeps 0.85 of the speed and recomputes fakie', () => {
    const b = { ...createBody({ x: 0, y: 0, z: 0 }, 0), vel: { x: 0, y: 0, z: 5 }, nose: { x: 0, y: 0, z: -1 }, fakie: true };
    const p = applyRevertPivot(b);
    expect(p.nose.z).toBeCloseTo(1, 9);
    expect(p.vel.z).toBeCloseTo(5 * TUNING.REVERT_SPEED_RETAIN, 9);
    expect(p.fakie).toBe(false);
  });

  it('REQ-CTL-10: off-axis is the folded nose vs velocity angle in the landing plane', () => {
    const up = { x: 0, y: 1, z: 0 };
    expect(offAxis({ x: 0, y: 0, z: -1 }, { x: 0, y: -3, z: -5 }, up).offAxisDeg).toBeCloseTo(0, 9);
    expect(offAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: -3, z: -5 }, up).offAxisDeg).toBeCloseTo(0, 9);
    expect(offAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: -3, z: -5 }, up).unfoldedDeg).toBeCloseTo(180, 9);
    const n30 = offAxis({ x: Math.sin(Math.PI / 6), y: 0, z: -Math.cos(Math.PI / 6) }, { x: 0, y: 0, z: -5 }, up);
    expect(n30.offAxisDeg).toBeCloseTo(30, 9);
    // Slow on a slope: the downhill direction stands in for the travel.
    const n20 = { x: 0, y: Math.cos((20 * Math.PI) / 180), z: Math.sin((20 * Math.PI) / 180) };
    const downhill = { x: 0, y: -Math.sin((20 * Math.PI) / 180), z: Math.cos((20 * Math.PI) / 180) };
    expect(offAxis(downhill, { x: 0.05, y: -0.3, z: 0 }, n20).offAxisDeg).toBeCloseTo(0, 6);
    expect(offAxis({ x: 1, y: 0, z: 0 }, { x: 0.05, y: -0.3, z: 0 }, n20).offAxisDeg).toBeCloseTo(90, 6);
    // Slow on TRUE flat: the launch heading is the reference, so the world heading never matters
    // (DESIGN's world -z made an ollie in place facing east bail; CHANGE-REQUEST in the report).
    expect(offAxis({ x: 1, y: 0, z: 0 }, { x: 0, y: -2, z: 0 }, up, { x: 1, y: 0, z: 0 }).offAxisDeg).toBeCloseTo(0, 9);
    expect(offAxis({ x: 0, y: 0, z: -1 }, { x: 0, y: -2, z: 0 }, up, { x: 1, y: 0, z: 0 }).offAxisDeg).toBeCloseTo(90, 9);
    expect(offAxis({ x: -1, y: 0, z: 0 }, { x: 0, y: -2, z: 0 }, up, { x: 1, y: 0, z: 0 }).offAxisDeg).toBeCloseTo(0, 9);
    // No usable reference (a vertical launch heading): the nose itself, off-axis 0.
    expect(offAxis({ x: 0, y: 0, z: 1 }, { x: 0, y: -2, z: 0 }, up, { x: 0, y: -1, z: 0 }).offAxisDeg).toBeCloseTo(0, 9);
  });

  it('REQ-CTL-10 in the world: an ollie in place lands clean whatever the heading; a 90 in place bails, a 180 lands', () => {
    TUNING.SIM_SPIN_ASSIST_S = 0; // this test drives the off-axis bail rule itself; the CR-65 landing spin assist would save it
    const inPlace = (dir: { x: number; y: number; z: number }, spinTicks: number): Rig => {
      const r = new Rig();
      r.teleport({ x: 30, y: 0, z: 50 }, dir, 0);
      r.hold(40, { buttons: ['ollie'] });
      r.hold(1);
      r.hold(spinTicks, { dpad: 'R' });
      r.run(200, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
      return r;
    };
    for (const dir of [NORTH, EAST, WEST, { x: 0.6, y: 0, z: 0.8 }]) {
      const r = inPlace(dir, 0);
      expect(r.of('bail'), JSON.stringify(dir)).toEqual([]);
      expect(r.last('land')?.offAxisDeg).toBeCloseTo(0, 6);
    }
    expect(inPlace(EAST, 30).last('bail')?.reason).toBe('landing');
    expect(inPlace(EAST, 60).of('bail')).toEqual([]);
  });

  it('describeEvents helper renders the log (keeps failure messages readable)', () => {
    const r = new Rig();
    r.hold(2);
    expect(describeEvents(r.events)).toBe('');
  });
});
