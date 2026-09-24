// tests/simGrind.test.ts (sim track): DESIGN "grind.test" (ARCHITECTURE.md section 10). The rail
// network on hand-built rails (magnet math, snap speed, motion, corners, toe side, spatial hash) and
// grinding in the REAL world on the test box: snap tolerance, ground snap, types, switch, rail end,
// balance bail, the special grind (CR-12) and the same-object rule (DESIGN E.1, REQ-GRD-*).
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, ticks, TUNING } from '../src/core/tuning';
import { BRANDS } from '../src/data/brands';
import type { DirOrNeutral, Vec3 } from '../src/core/types';
import { MARKET_STREET } from '../src/levels/marketStreet';
import { WOODSHED } from '../src/levels/woodshed';
import { createRailNetwork, grindTypesByDir, railOnToeSide, startGrind, stepGrind, type GrindMotion } from '../src/sim/rails';
import { simInternals } from '../src/sim/world';
import { built, describeEvents, probeTick, Rig, worldAvailable } from './fixtures/sim/rig';
import { SIM_FIXTURE } from './fixtures/sim/levels';
import { builtRail, P } from './fixtures/sim/rails';

afterEach(() => resetTuning());

const DEG = Math.PI / 180;
/** Horizontal unit vector at `deg` from north (-z), positive toward west (-x). */
const heading = (deg: number): Vec3 => ({ x: -Math.sin(deg * DEG), y: 0, z: -Math.cos(deg * DEG) });

// A flat bar running north (-z) like TB-RAIL, a coping running east, a ledge.
const BAR = builtRail({ id: 'BAR', kind: 'rail', points: [P(40, 0.55, 40), P(40, 0.55, 20)] });
const COPING = builtRail({ id: 'COP', kind: 'coping', points: [P(0, 2.4, 10), P(20, 2.4, 10)] });
const net = createRailNetwork([BAR, COPING]);

describe('REQ-GRD-02: magnet math (closest point on segment, 0.55 m, 55 deg, score)', () => {
  it('on the line and aligned: distance 0, angle 0', () => {
    const c = net.query({ pos: P(40, 0.55, 30), vel: P(0, -1, -5), mode: 'air' });
    expect(c?.rail.id).toBe('BAR');
    expect(c?.distance).toBeCloseTo(0, 9);
    expect(c?.angleDeg).toBeCloseTo(0, 9);
    expect(c?.t).toBeCloseTo(0.5, 9);
    expect(c?.tangent).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('0.4 m off at a 40 deg approach snaps with score 0.4 / 0.55 + 40 / 55; 0.7 m off does not', () => {
    const v = { ...heading(40), y: 0 };
    const c = net.query({ pos: P(40.4, 0.55, 30), vel: { x: v.x * 5, y: -1, z: v.z * 5 }, mode: 'air' });
    expect(c?.distance).toBeCloseTo(0.4, 9);
    expect(c?.angleDeg).toBeCloseTo(40, 9);
    expect(c?.score).toBeCloseTo(0.4 / 0.55 + 40 / 55, 9);
    expect(net.query({ pos: P(40.7, 0.55, 30), vel: { x: v.x * 5, y: -1, z: v.z * 5 }, mode: 'air' })).toBeNull();
  });

  it('the angle limit is 55 deg (horizontal projection), the radius 0.55 m (3D)', () => {
    const at = (deg: number, pos: Vec3) => net.query({ pos, vel: { x: heading(deg).x * 5, y: -3, z: heading(deg).z * 5 }, mode: 'air' });
    expect(at(54.9, P(40.3, 0.55, 30))).not.toBeNull();
    expect(at(55.1, P(40.3, 0.55, 30))).toBeNull();
    // 0.4 above and 0.35 beside = 0.53 m: in; 0.45 above and 0.35 beside = 0.57 m: out.
    expect(at(0, P(40.35, 0.95, 30))?.distance).toBeCloseTo(Math.hypot(0.35, 0.4), 9);
    expect(at(0, P(40.35, 1.0, 30))).toBeNull();
  });

  it('travel direction picks the tangent sign; the segment end clamps the closest point', () => {
    const south = net.query({ pos: P(40, 0.6, 30), vel: P(0, 0, 5), mode: 'air' });
    expect(south?.tangent).toEqual({ x: 0, y: 0, z: 1 });
    const past = net.query({ pos: P(40, 0.55, 40.3), vel: P(0, 0, -5), mode: 'air' });
    expect(past?.t).toBe(0);
    expect(past?.distance).toBeCloseTo(0.3, 9);
  });

  it('two candidates: the lower score wins', () => {
    const twin = createRailNetwork([BAR, builtRail({ id: 'BAR2', kind: 'rail', points: [P(40.6, 0.55, 40), P(40.6, 0.55, 20)] })]);
    expect(twin.query({ pos: P(40.35, 0.55, 30), vel: P(0, 0, -5), mode: 'air' })?.rail.id).toBe('BAR2');
    expect(twin.query({ pos: P(40.25, 0.55, 30), vel: P(0, 0, -5), mode: 'air' })?.rail.id).toBe('BAR');
  });

  it('REQ-LIP-02: coping approached steeply near the apex is a lip; along it a grind; a rail beats a coping', () => {
    // Straight up the face under the coping, rising 1 m/s (vy <= 3), inside 0.55 m: lip.
    const lip = net.query({ pos: P(10, 2.5, 10.3), vel: P(0, 1, 0.4), mode: 'air' });
    expect(lip?.lip).toBe(true);
    expect(lip?.kind).toBe('coping');
    // Too fast upward (vy 4 > LIP_MAX_VY 3) or too far below the coping: nothing.
    expect(net.query({ pos: P(10, 2.5, 10.3), vel: P(0, 4, 0.4), mode: 'air' })).toBeNull();
    expect(net.query({ pos: P(10, 2.0, 10.1), vel: P(0, 1, 0.4), mode: 'air' })).toBeNull();
    // Along the coping at <= 55 deg: a coping grind.
    const along = net.query({ pos: P(10, 2.5, 10.2), vel: P(5, -1, 0.5), mode: 'air' });
    expect(along?.lip).toBe(false);
    // A flat rail next to a coping always wins (even with a worse score).
    const mixed = createRailNetwork([COPING, builtRail({ id: 'NEAR', kind: 'rail', points: [P(0, 2.4, 10.5), P(20, 2.4, 10.5)] })]);
    expect(mixed.query({ pos: P(10, 2.45, 10.05), vel: P(5, -1, 0), mode: 'air' })?.rail.id).toBe('NEAR');
    // A flat rail is never a lip: a steep approach onto it is no candidate at all.
    expect(net.query({ pos: P(40.2, 0.6, 30), vel: P(-5, -1, 0), mode: 'air' })).toBeNull();
  });

  it('REQ-GRD-05 ground mode: horizontal distance, rail height dy in [-0.2, +0.7] above the board', () => {
    const g = (y: number) => net.query({ pos: P(40.3, y, 30), vel: P(0, 0, -5), mode: 'ground' });
    expect(g(-0.05)?.distance).toBeCloseTo(0.3, 9);
    expect(g(-0.15)).toBeNull();
    expect(g(0.75)).not.toBeNull();
    expect(g(0.76)).toBeNull();
  });

  it('REQ-GRD-14: the spatial hash answers 1000 queries in under 5 ms on each park', () => {
    for (const def of [MARKET_STREET, WOODSHED]) {
      const rails = createRailNetwork(built(def).rails);
      const pts = Array.from({ length: 1000 }, (_, i) => P((i * 37) % 110, 1, (i * 53) % 100));
      const vel = P(3, -1, 2);
      // Warm the JIT, then keep the best of 25 passes (the suite runs files in parallel, so a
      // single pass can be slowed by another worker; the best pass is the query's real cost).
      for (const p of pts) rails.query({ pos: p, vel, mode: 'air' });
      let best = Infinity;
      for (let pass = 0; pass < 25; pass++) {
        const t0 = globalThis.performance.now();
        for (const p of pts) rails.query({ pos: p, vel, mode: 'air' });
        best = Math.min(best, globalThis.performance.now() - t0);
      }
      expect(best).toBeLessThan(5);
    }
  });
});

describe('REQ-GRD-03 / 08 / 10: snap speed and rail motion', () => {
  it('an ollie snapped while rising 4 m/s enters a flat rail at its horizontal speed, never below 3 m/s', () => {
    const c = net.query({ pos: P(40, 0.6, 30), vel: P(0, 4, -5), mode: 'air' });
    expect(c).not.toBeNull();
    if (!c) return;
    expect(startGrind(c, P(0, 4, -5)).speed).toBeCloseTo(5, 9);
    expect(startGrind(c, P(0, 4, -1)).speed).toBe(TUNING.GRIND_MIN_ENTRY_SPEED);
  });

  it('8 m/s on a flat rail lasts > 20 s (friction 0.1), then stalls below 1.5 m/s', () => {
    const long = createRailNetwork([builtRail({ id: 'LONG', kind: 'rail', points: [P(0, 1, 0), P(400, 1, 0)] })]);
    let m: GrindMotion = { railId: 'LONG', s: 0, dir: 1, speed: 8, travelled: 0 };
    let t = 0;
    let event: string | null = null;
    while (event === null && t < 100 * 120) {
      const st = stepGrind(m, long, 1 / 120);
      m = st.motion;
      event = st.event;
      t++;
    }
    expect(event).toBe('stall');
    // v = 8 - 0.1 t reaches 1.5 at 65 s.
    expect(t / 120).toBeCloseTo((8 - 1.5) / TUNING.GRIND_FRICTION_RAIL, 1);
    expect(t / 120).toBeGreaterThan(20);
  });

  it('a sloped rail pulls at 0.35 g sin(slope); ledges bite at 0.30 m/s^2', () => {
    const slope = 10 * DEG;
    const up = createRailNetwork([builtRail({ id: 'UP', kind: 'rail', points: [P(0, 0, 0), P(10 * Math.cos(slope), 10 * Math.sin(slope), 0)] })]);
    const st = stepGrind({ railId: 'UP', s: 1, dir: 1, speed: 6, travelled: 0 }, up, 1 / 120);
    expect(st.motion.speed).toBeCloseTo(6 - (TUNING.GRIND_FRICTION_RAIL + 0.35 * TUNING.GRAVITY * Math.sin(slope)) / 120, 9);
    expect(st.slopeDeg).toBeCloseTo(10, 6);
    const ledge = createRailNetwork([builtRail({ id: 'L', kind: 'ledge', points: [P(0, 1, 0), P(10, 1, 0)] })]);
    expect(stepGrind({ railId: 'L', s: 1, dir: 1, speed: 6, travelled: 0 }, ledge, 1 / 120).motion.speed).toBeCloseTo(6 - 0.3 / 120, 9);
  });

  it('REQ-GRD-10: a bend over 55 deg is a rail end (corner); 30 deg rides through; rail ends and closed loops', () => {
    const lvl = built(SIM_FIXTURE);
    const rails = createRailNetwork(lvl.rails);
    const ride = (id: string, s: number, n: number): { event: string | null; s: number } => {
      let m: GrindMotion = { railId: id, s, dir: 1, speed: 6, travelled: 0 };
      for (let i = 0; i < n; i++) {
        const st = stepGrind(m, rails, 1 / 120);
        m = st.motion;
        if (st.event) return { event: st.event, s: m.s };
      }
      return { event: null, s: m.s };
    };
    const kink = ride('SF-KINK', 9, 60);
    expect(kink).toEqual({ event: 'corner', s: 10 });
    const bend = ride('SF-BEND', 7, 60);
    expect(bend.event).toBeNull();
    expect(bend.s).toBeGreaterThan(8);
    expect(ride('SF-BEND', 17, 60).event).toBe('railEnd');
    // A closed 24-point ring (the fountain rim shape, 15 deg bends) wraps instead of ending.
    const ring = Array.from({ length: 25 }, (_, i) => P(3 * Math.cos(((i % 24) * 15) * DEG), 1, 3 * Math.sin(((i % 24) * 15) * DEG)));
    const loopRail = builtRail({ id: 'O', kind: 'coping', closed: true, points: ring });
    const loop = createRailNetwork([loopRail]);
    let m: GrindMotion = { railId: 'O', s: loopRail.length - 0.02, dir: 1, speed: 6, travelled: 0 };
    const st = stepGrind(m, loop, 1 / 120);
    m = st.motion;
    expect(st.event).toBeNull();
    expect(m.s).toBeCloseTo(0.05 - 0.02 - (TUNING.GRIND_FRICTION_COPING / 120) / 120, 3);
    expect(m.travelled).toBeCloseTo(0.05, 2);
  });
});

describe('REQ-GRD-06: grind types by Dir8, the toe-side rule', () => {
  it('regular riding north, rail to the east (right) is on the toe side: L/R = Boardslide; left side = Lipslide', () => {
    const right = P(1, 0, 0);
    expect(railOnToeSide(P(40.3, 0.55, 30), P(40, 0, 30), right, 'regular', false)).toBe(true);
    expect(railOnToeSide(P(39.7, 0.55, 30), P(40, 0, 30), right, 'regular', false)).toBe(false);
    // Switch or fakie flips the toe side; both flip it back.
    expect(railOnToeSide(P(40.3, 0.55, 30), P(40, 0, 30), right, 'switch', false)).toBe(false);
    expect(railOnToeSide(P(40.3, 0.55, 30), P(40, 0, 30), right, 'regular', true)).toBe(false);
    expect(railOnToeSide(P(40.3, 0.55, 30), P(40, 0, 30), right, 'switch', true)).toBe(true);
    const toe = grindTypesByDir(true);
    const heel = grindTypesByDir(false);
    expect([toe.L, toe.R, heel.L, heel.R]).toEqual(['boardslide', 'boardslide', 'lipslide', 'lipslide']);
    const all: Record<DirOrNeutral, string> = { N: 'fifty_fifty', U: 'nosegrind', D: 'five_o', UL: 'crooked', UR: 'overcrook', DL: 'feeble', DR: 'smith', L: 'boardslide', R: 'boardslide' };
    expect(toe).toEqual(all);
  });
});

// ---------------------------------------------------------------------------------------------
// The real world on the test box
// ---------------------------------------------------------------------------------------------

/** Airborne 0.05 m above TB-RAIL's height, `lateral` m east of it, heading `deg` toward it at `speed`. */
function airAtRail(lateral: number, deg: number, speed: number): Rig {
  const r = new Rig();
  // Heading west of north by `deg` (toward the rail when lateral > 0).
  r.teleport(P(40 + lateral, 0.6, 30), heading(deg), speed);
  expect(r.snap.skater.state).toBe('Air');
  return r;
}

/** Ollie onto TB-RAIL from the south at 7 m/s: full charge, Triangle (with `dir`) as the magnet nears. */
function railGrind(dir: DirOrNeutral = 'N', speed = 7): Rig {
  const r = new Rig();
  r.teleport(P(40, 0, 48.5), P(0, 0, -1), speed);
  r.hold(74, { buttons: ['ollie'] });
  r.hold(66);
  r.hold(3, { buttons: ['grind'], dpad: dir });
  r.run(40, (s) => r.holdBalance(s), (s) => s.skater.state === 'Grind');
  return r;
}

describe.skipIf(!worldAvailable())('grinding in the real world (SPEC §19 "rails need no sim-perfect alignment")', () => {
  it('0.4 m off at 40 deg snaps on the press tick; the board blends onto the rail at the projected speed', () => {
    const r = airAtRail(0.4, 40, 5);
    r.hold(1, { buttons: ['grind'] });
    expect(r.snap.skater.state).toBe('Grind');
    expect(r.rows()).toEqual(['5']);
    const start = r.last('grindStart');
    expect(start?.railId).toBe('TB-RAIL');
    expect(start?.speed).toBeCloseTo(5 * Math.cos(40 * DEG), 6);
    r.hold(ticks(TUNING.GRIND_SNAP_BLEND_MS), { buttons: ['grind'] });
    const p = r.snap.skater.pos;
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.y).toBeCloseTo(0.55 + TUNING.BOARD_THICKNESS_M, 6);
    expect(r.snap.skater.grind?.tangent).toEqual({ x: 0, y: 0, z: -1 });
    expect(r.snap.balance?.axis).toBe('h');
  });

  it('0.7 m off (riding parallel past the rail) never snaps: the pre-buffer lapses and it lands on the floor', () => {
    const r = airAtRail(0.7, 0, 5);
    r.run(100, () => ({ buttons: ['grind'] }), (s) => s.skater.state !== 'Air');
    expect(r.of('grindStart')).toEqual([]);
    expect(r.snap.skater.state).toBe('LandWindow');
    // At 0.4 m the same parallel pass snaps.
    const ok = airAtRail(0.4, 0, 5);
    ok.hold(1, { buttons: ['grind'] });
    expect(ok.snap.skater.state).toBe('Grind');
  });

  it('REQ-GRD-04: Triangle pressed early stays live 200 ms and snaps the moment the magnet reaches the rail', () => {
    // 0.9 m east heading 30 deg toward the rail at 5 m/s: 2.5 m/s lateral, inside 0.55 after about 17 ticks.
    const r = airAtRail(0.9, 30, 5);
    r.hold(1, { buttons: ['grind'] });
    expect(r.snap.skater.state).toBe('Air');
    r.run(ticks(TUNING.GRIND_PREBUFFER_MS), () => ({}), (s) => s.skater.state === 'Grind');
    expect(r.snap.skater.state).toBe('Grind');
    // Pressed 30 ticks early (past 24): dropped.
    const late = airAtRail(1.6, 20, 5);
    late.hold(1, { buttons: ['grind'] });
    late.run(60, () => ({}), (s) => s.skater.state !== 'Air');
    expect(late.of('grindStart')).toEqual([]);
  });

  it('REQ-GRD-05 / row 36: Triangle while rolling beside the rail hops max(0.3, dy + 0.1) m onto it and starts a combo', () => {
    const r = new Rig();
    r.teleport(P(40.3, 0, 36), P(0, 0, -1), 5);
    r.hold(1, { buttons: ['grind'] });
    expect(r.snap.skater.state).toBe('Grind');
    expect(r.rows()).toEqual(['36']);
    let peak = 0;
    r.run(ticks(TUNING.GRIND_SNAP_BLEND_MS), (s) => {
      peak = Math.max(peak, s.skater.pos.y);
      return r.holdBalance(s);
    });
    // The hop arc peaks at hopM = max(0.3, 0.55 + 0.1) = 0.65 m above the floor (sampled per tick).
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(0.65 + 1e-9);
    expect(r.snap.combo?.names).toEqual(['50-50']);
    // Too slow (< 3 m/s) or out of the magnet: no ground snap.
    const slow = new Rig();
    slow.teleport(P(40.3, 0, 36), P(0, 0, -1), 2.5);
    slow.hold(1, { buttons: ['grind'] });
    expect(slow.snap.skater.state).toBe('Grounded');
  });

  it('REQ-GRD-06 in the world: D + Triangle = 5-0; L with the rail on the toe side = Boardslide, on the heel side = Lipslide', () => {
    const typed = (lateral: number, dir: DirOrNeutral): string | undefined => {
      const r = airAtRail(lateral, 0, 5);
      r.hold(1, { buttons: ['grind'], dpad: dir });
      return r.last('grindStart')?.grindType;
    };
    expect(typed(0.3, 'D')).toBe('five_o');
    expect(typed(0.3, 'UL')).toBe('crooked');
    expect(typed(0.3, 'N')).toBe('fifty_fifty');
    // Skater east of the rail riding north: the rail is to its left = heel side for a regular stance.
    expect(typed(0.3, 'L')).toBe('lipslide');
    expect(typed(-0.3, 'L')).toBe('boardslide');
    expect(typed(-0.3, 'R')).toBe('boardslide');
  });

  it('REQ-GRD-07: Dir8 + Triangle mid-rail switches type: a new element (own history), same type ignored, needle re-centred', () => {
    const r = railGrind();
    expect(r.snap.skater.state).toBe('Grind');
    r.run(30, (s) => r.holdBalance(s));
    r.hold(1, { buttons: ['grind'], dpad: 'DR' });
    expect(r.last('grindSwitch')).toMatchObject({ from: 'fifty_fifty', to: 'smith', railId: 'TB-RAIL' });
    expect(Math.abs(r.snap.balance?.needle ?? 0)).toBeCloseTo(TUNING.BAL_RECENTER, 1);
    r.run(20, (s) => r.holdBalance(s));
    r.hold(1, { buttons: ['grind'], dpad: 'DR' });
    expect(r.of('grindSwitch').length).toBe(1);
    expect(r.snap.combo?.names).toEqual(['50-50', 'Smith']);
    expect(r.snap.combo?.multiplier).toBe(2);
    // Switching back is another element with its own degradation (fifty_fifty 2nd time = 0.9).
    r.run(20, (s) => r.holdBalance(s));
    r.hold(1, { buttons: ['grind'], dpad: 'N' });
    r.run(20, (s) => r.holdBalance(s));
    r.hold(1, { buttons: ['grind'], dpad: 'N' });
    expect(r.snap.combo?.elements.map((e) => [e.id, e.value])).toEqual([['fifty_fifty', 100], ['smith', 180]]);
  });

  it('row 21: the rail end puts the skater in the air with the tangent velocity; the combo lives and banks on landing', () => {
    const r = railGrind();
    r.run(600, (s) => r.holdBalance(s), (s) => s.skater.state !== 'Grind');
    expect(r.rows().slice(-1)).toEqual(['21']);
    const end = r.last('grindEnd');
    expect(end?.reason).toBe('railEnd');
    expect(r.snap.skater.state).toBe('Air');
    const v = r.snap.skater.vel;
    const grindSpeed = r.snaps[r.snaps.length - 2]?.skater.speed ?? 0;
    expect(v.x).toBeCloseTo(0, 6);
    expect(-v.z).toBeCloseTo(grindSpeed, 1);
    // The distance ridden reached the rail's far end (z 20).
    expect(end?.pos.z).toBeCloseTo(20, 1);
    r.run(200, () => ({}), (s) => s.skater.state === 'Grounded');
    const accrual = Math.round(TUNING.HOLD_FIFTY_FIFTY * (end?.heldS ?? 0));
    expect(r.last('comboBanked')?.final).toBe(100 + accrual);
  });

  it('REQ-TIM-06: Cross within 90 ms after a rail end still pops (coyote), later presses do nothing', () => {
    const endTick = probeTick(() => railGrind(), (r) => r.run(600, (s) => r.holdBalance(s), (s) => s.skater.state !== 'Grind'), (r) => r.last('grindEnd')?.tick);
    const pressAt = (dt: number): Rig => {
      const r = railGrind();
      r.run(700, (s) => (r.tick >= endTick + dt && r.tick < endTick + dt + 2 ? { buttons: ['ollie'] } : r.holdBalance(s)), (s) => s.skater.state === 'LandWindow');
      return r;
    };
    expect(pressAt(ticks(80)).of('pop', endTick).map((e) => [e.from, e.heightM])).toEqual([['Air', TUNING.OLLIE_H_TAP_M]]);
    expect(pressAt(ticks(100)).of('pop', endTick)).toEqual([]);
  });

  it('REQ-SM-06: a switch pressed on the rail-end tick is dropped; the rail end wins', () => {
    const endTick = probeTick(() => railGrind(), (r) => r.run(600, (s) => r.holdBalance(s), (s) => s.skater.state !== 'Grind'), (r) => r.last('grindEnd')?.tick);
    const r = railGrind();
    r.run(700, (s) => (r.tick === endTick ? { buttons: ['grind'], dpad: 'DR' } : r.holdBalance(s)), (s) => s.skater.state !== 'Grind');
    expect(r.of('grindSwitch')).toEqual([]);
    expect(r.last('grindEnd')?.reason).toBe('railEnd');
  });

  it('SPEC §19: a balance bail on the rail dumps the combo AND the special meter, then the 0.85 s get-up', () => {
    const r = railGrind();
    r.setMeter(0.8);
    // Push the stick INTO the lean: the needle runs out fast.
    r.run(600, (s) => ({ dpad: (s.balance?.needle ?? 0) > 0 ? 'R' : 'L' }), (s) => s.skater.state !== 'Grind');
    expect(r.rows().slice(-1)).toEqual(['23']);
    expect(r.last('bail')?.reason).toBe('balance');
    expect(r.last('comboLost')?.elementCount).toBe(1);
    expect(r.last('grindEnd')?.reason).toBe('bail');
    expect(r.snap.special.meter).toBe(0);
    expect(r.snap.special.glowing).toBe(false);
    expect(r.snap.combo).toBeNull();
    r.run(400, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.rows().slice(-2)).toEqual(['38', '39']);
  });

  it('REQ-GRD-08 / row 22: a slow grind up the stair handrail stalls below 1.5 m/s and hops off, combo alive', () => {
    const r = new Rig();
    // TB-HANDRAIL (60.3, 20, 2.1) -> (60.3, 24.8, 0.9): uphill northward; start near its low end.
    r.teleport(P(60.3, 1.2, 24.2), P(0, 0, -1), 3);
    r.hold(1, { buttons: ['grind'] });
    expect(r.snap.skater.grind?.railId).toBe('TB-HANDRAIL');
    r.run(400, (s) => r.holdBalance(s), (s) => s.skater.state !== 'Grind');
    expect(r.last('grindEnd')?.reason).toBe('stall');
    expect(r.rows().slice(-1)).toEqual(['22']);
    expect(r.snap.skater.state).toBe('Air');
    expect(r.snap.skater.vel.y).toBeGreaterThan(0);
    expect(r.snap.combo?.names).toEqual(['50-50']);
  });
});

describe.skipIf(!worldAvailable())('the special grind and the same-object rule (CR-12, REQ-BAL-04, CR-06)', () => {
  const pairThenTriangle = (r: Rig): void => {
    r.hold(4, { dpad: 'U' });
    r.hold(1, { dpad: 'D', buttons: ['grind'] });
  };

  it('glowing, U,D + Triangle mid-rail is the special grind (brand name), NOT a switch to 5-0', () => {
    const r = railGrind();
    r.setMeter(1);
    r.run(20, (s) => r.holdBalance(s));
    pairThenTriangle(r);
    expect(r.last('specialUsed')?.specialId).toBe('gpu_slide');
    expect(r.of('grindSwitch').map((e) => e.to)).toEqual(['gpu_slide']);
    expect(r.snap.combo?.names).toEqual(['50-50', BRANDS.specialSlideName]);
    expect(r.snap.skater.poseVariant).toBe('gpu_slide');
  });

  it('not glowing, the same input is a plain switch to 5-0 (D + Triangle)', () => {
    const r = railGrind();
    r.run(20, (s) => r.holdBalance(s));
    pairThenTriangle(r);
    expect(r.of('specialUsed')).toEqual([]);
    expect(r.of('grindSwitch').map((e) => e.to)).toEqual(['five_o']);
  });

  it('a second grind on the same rail in one combo drifts x1.6 (and x1.12 for the element before it)', () => {
    const kOf = (r: Rig): number => simInternals(r.world)?.balance()?.k ?? NaN;
    const r = railGrind();
    const k1 = kOf(r);
    expect(k1).toBeCloseTo(TUNING.BAL_K0, 9);
    // Pop off mid-rail and snap the same rail again while falling.
    r.run(30, (s) => r.holdBalance(s));
    r.hold(1, { buttons: ['ollie'] });
    r.hold(1);
    expect(r.snap.skater.state).toBe('Air');
    // Triangle on the way down, low enough that the press is still inside the 200 ms pre-buffer
    // when the rail comes into the magnet (the CR-44 1.2 m tap falls longer than that from its apex).
    r.run(120, (s) => (s.skater.vel.y < 0 && s.skater.pos.y < 1.2 ? { buttons: ['grind'] } : {}), (s) => s.skater.state === 'Grind');
    expect(r.of('grindStart').length, describeEvents(r.events)).toBe(2);
    expect(kOf(r) / k1).toBeCloseTo(TUNING.BAL_SAME_OBJECT_MULT * (1 + TUNING.BAL_ELEMENT_GAIN), 9);
  });
});

describe('polish round 1: ledge magnet, rail ends (sim fixes)', () => {
  const LEDGE = builtRail({ id: 'LEDGE', kind: 'ledge', points: [P(50, 0.45, 40), P(50, 0.45, 20)] });
  const pair = createRailNetwork([LEDGE, builtRail({ id: 'BAR3', kind: 'rail', points: [P(60, 0.45, 40), P(60, 0.45, 20)] })]);

  it('SPEC §1 rule 5: a ledge counts its across distance from the capsule (radius off), a rail from its line', () => {
    const q = (x: number, y: number, mode: 'air' | 'ground') => pair.query({ pos: P(x, y, 30), vel: P(0, -1, -5), mode });
    // The capsule touching the face of a 0.8 m ledge: 0.75 m from its line, 0.75 - 0.35 = 0.40 in.
    expect(q(50.75, 0.45, 'air')?.rail.id).toBe('LEDGE');
    expect(q(50.75, 0.45, 'air')?.distance).toBeCloseTo(0.75 - TUNING.SKATER_RADIUS_M, 9);
    expect(q(50.75, 0.05, 'ground')?.rail.id).toBe('LEDGE');
    // 0.95 m across = 0.60 m after the radius: out.
    expect(q(50.95, 0.45, 'air')).toBeNull();
    // The same 0.75 m off a round rail: out (0.55 m magnet from the line, locked).
    expect(q(60.75, 0.45, 'air')).toBeNull();
    // Past a ledge's end the along-rail part is not reduced.
    expect(pair.query({ pos: P(50, 0.45, 40.6), vel: P(0, -1, -5), mode: 'air' })).toBeNull();
  });

  it('an open rail end with travel pointing off it is no candidate; heading back onto the rail it is', () => {
    // BAR runs from z 40 to z 20 (north); just past its north end, still inside 0.55 m.
    expect(net.query({ pos: P(40, 0.6, 19.8), vel: P(0, -1, -5), mode: 'air' })).toBeNull();
    expect(net.query({ pos: P(40, 0.6, 20), vel: P(0, -1, -5), mode: 'air' })).toBeNull();
    const back = net.query({ pos: P(40, 0.6, 19.8), vel: P(0, -1, 5), mode: 'air' });
    expect(back?.rail.id).toBe('BAR');
    expect(back?.tangent).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe.skipIf(!worldAvailable())('polish round 1 in the world (sim fixes)', () => {
  const landed = (s: { skater: { state: string } }): boolean => s.skater.state === 'LandWindow' || s.skater.state === 'Grounded' || s.skater.state === 'Bail';

  it('Triangle mashed through a rail end gives exactly one grind; grindEnd reports the distance ridden', () => {
    const r = railGrind();
    expect(r.snap.skater.state).toBe('Grind');
    r.run(900, (s, i) => (s.skater.state === 'Grind' ? r.holdBalance(s) : i % 10 === 0 ? { buttons: ['grind'] } : {}), landed);
    const log = describeEvents(r.events);
    expect(r.of('grindStart').length, log).toBe(1);
    expect(r.of('elementAdded').filter((e) => e.element.category === 'grind').length, log).toBe(1);
    expect(r.snap.skater.state, log).toBe('LandWindow');
    const end = r.last('grindEnd');
    expect(end?.reason).toBe('railEnd');
    // TB-RAIL is 20 m (z 40 to 20); the CR-65 full ollie (2.5 m at g 20) comes down onto it about
    // 2.3 m in, so the ridden distance is the rest of the rail.
    expect(end?.distanceM).toBeGreaterThan(17);
    expect(end?.distanceM).toBeLessThanOrEqual(20 + 1e-6);
  });

  it('Triangle held through a rail end (the buffered press) never re-snaps the same end', () => {
    const r = railGrind();
    r.run(900, (s) => (s.skater.state === 'Grind' ? r.holdBalance(s, { buttons: ['grind'] }) : { buttons: ['grind'] }), landed);
    expect(r.of('grindStart').length, describeEvents(r.events)).toBe(1);
  });

  it('SPEC §1 rule 5: rolling flush along the 0.8 m terrace ledge MS-L3, Triangle on the ground and ollie + Triangle both grind it', () => {
    const street = built(MARKET_STREET);
    // The ledge box spans z 39.2 to 40 on the 0.8 m terrace; the capsule touching its face is at 38.85.
    const ground = new Rig({ level: street });
    ground.teleport(P(60, 0.8, 38.85), P(1, 0, 0), 6);
    expect(ground.snap.skater.state).toBe('Grounded');
    ground.run(30, () => ({ buttons: ['grind'] }), (s) => s.skater.state === 'Grind');
    expect(ground.last('grindStart')?.railId, describeEvents(ground.events)).toBe('MS-L3');
    const air = new Rig({ level: street });
    air.teleport(P(60, 0.8, 38.85), P(1, 0, 0), 6);
    air.hold(2, { buttons: ['ollie'] });
    air.hold(1);
    expect(air.snap.skater.state).toBe('Air');
    air.run(150, (_s, i) => (i % 2 === 0 ? { buttons: ['grind'] } : {}), (s) => s.skater.state !== 'Air');
    expect(air.snap.skater.state, describeEvents(air.events)).toBe('Grind');
    expect(air.last('grindStart')?.railId).toBe('MS-L3');
  });

  it('founder item 6: ollieing along TB-RAIL and coming down on it grinds a 50-50 with no grind press', () => {
    const r = new Rig();
    r.teleport(P(40, 0, 48.5), P(0, 0, -1), 7);
    r.hold(74, { buttons: ['ollie'] });
    r.hold(1);
    r.run(120, () => ({}), (s) => s.skater.state !== 'Air');
    const log = describeEvents(r.events);
    expect(r.snap.skater.state, log).toBe('Grind');
    expect(r.last('grindStart')).toMatchObject({ railId: 'TB-RAIL', grindType: 'fifty_fifty' });
    expect(r.snap.combo?.names).toEqual(['50-50']);
    expect(r.rows().slice(-1)).toEqual(['5']);
    // The press still picks the type: D + Triangle on the way down is a 5-0.
    const typed = new Rig();
    typed.teleport(P(40, 0, 48.5), P(0, 0, -1), 7);
    typed.hold(74, { buttons: ['ollie'] });
    // Press within the 200 ms pre-buffer of the snap tick the auto rig found.
    typed.hold((r.last('grindStart')?.tick ?? 0) - 74 - 12);
    typed.run(120, () => ({ buttons: ['grind'], dpad: 'D' }), (s) => s.skater.state !== 'Air');
    expect(typed.last('grindStart')?.grindType, describeEvents(typed.events)).toBe('five_o');
    // Switched off, the same ollie never grinds.
    TUNING.SIM_AUTO_GRIND = 0;
    const off = new Rig();
    off.teleport(P(40, 0, 48.5), P(0, 0, -1), 7);
    off.hold(74, { buttons: ['ollie'] });
    off.hold(1);
    off.run(120, () => ({}), (s) => s.skater.state !== 'Air');
    expect(off.of('grindStart')).toEqual([]);
  });

  it('no auto grind across a rail (entry angle), or back onto the rail an air just left', () => {
    // Ollie straight across TB-RAIL from the east: 90 deg to the rail, no grind.
    const across = new Rig();
    across.teleport(P(43, 0, 30), P(-1, 0, 0), 7);
    across.hold(40, { buttons: ['ollie'] });
    across.hold(1);
    across.run(120, () => ({}), (s) => s.skater.state !== 'Air');
    expect(across.of('grindStart')).toEqual([]);
    // A pop off the rail mid-way comes back down on its line: it passes the rail and lands on the floor.
    const popped = railGrind();
    popped.run(30, (s) => popped.holdBalance(s));
    popped.hold(1, { buttons: ['ollie'] });
    popped.hold(1);
    expect(popped.snap.skater.state).toBe('Air');
    popped.run(200, () => ({}), (s) => s.skater.state !== 'Air');
    expect(popped.of('grindStart').length, describeEvents(popped.events)).toBe(1);
    expect(popped.snap.skater.state).toBe('LandWindow');
  });
});
