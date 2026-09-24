// tests/simWorld.test.ts (sim track): the REAL world on the test box (every track's code runs: the
// input frame builder and parser, the logic state machine / scoring / balance / special, the level
// builder, and the sim controller, rails, gaps and run). One scenario per SPEC §19 physics item and
// the M3 / M4 done conditions (SPEC §16): exact states, rows and numbers, so a broken mechanic fails.
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, ticks, ticksS, TUNING } from '../src/core/tuning';
import type { SimSnapshot } from '../src/core/types';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { replay } from '../src/sim/debug';
import { createWorld, simInternals } from '../src/sim/world';
import { built, describeEvents, probeTick, Rig, worldAvailable } from './fixtures/sim/rig';

const N = { x: 0, y: 0, z: -1 };
const S = { x: 0, y: 0, z: 1 };
const E = { x: 1, y: 0, z: 0 };
const W = { x: -1, y: 0, z: 0 };

afterEach(() => resetTuning());

const airOrLanded = (r: Rig) => () => r.of('land').length > 0 || r.of('bail').length > 0;
const FINAL = (base: number, mult: number) => Math.floor(base * mult + 1e-6);

/** Up the test box vert (TB-VERT, coping 3.6) straight north at x 32 from z 12. */
function vertRig(speed = 11): Rig {
  const r = new Rig();
  r.teleport({ x: 32, y: 0, z: 12 }, N, speed);
  return r;
}

/** Tick of the first landing of a plain vert air at `speed` (the probe run of the same script). */
function vertContactTick(speed = 11): number {
  return probeTick(() => vertRig(speed), (r) => {
    r.run(700, () => ({}), airOrLanded(r));
  }, (r) => r.of('land')[0]?.tick);
}

describe.skipIf(!worldAvailable())('M3: skate, ollie, land, bank (SPEC §16)', () => {
  it('push from rest, crouch-charge ollie, kickflip, land: LandWindow then banks 100', () => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 0);
    r.hold(60, { dpad: 'U' });
    // REQ-CTL-04: PUSH_ACCEL for 0.5 s from rest (under max speed since the founder asked for 12 m/s).
    expect(r.snap.skater.speed).toBeCloseTo(TUNING.PUSH_ACCEL * 0.5, 9);
    expect(r.of('push').length).toBe(1);
    r.hold(36, { buttons: ['ollie'] });
    expect(r.snap.skater.state).toBe('Crouch');
    r.hold(1);
    const pop = r.last('pop');
    // Charge (36 / 120 - 0.1) / 0.5 = 0.4 -> tap + (full - tap) x 0.4 = 1.52 m (REQ-CTL-05, CR-44 heights).
    expect(pop?.heightM).toBeCloseTo(TUNING.OLLIE_H_TAP_M + (TUNING.OLLIE_H_FULL_M - TUNING.OLLIE_H_TAP_M) * 0.4, 9);
    expect(r.snap.skater.state).toBe('Air');
    r.hold(1, { buttons: ['flip'], dpad: 'L' });
    expect(r.last('trickStart')?.trickId).toBe('kickflip');
    r.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.rows()).toEqual(['1', '2', '9', '9b']);
    const land = r.last('land');
    expect(land?.quality).toBe('clean');
    expect(land?.vert).toBe(false);
    const bank = r.last('comboBanked');
    expect(bank?.final).toBe(100);
    expect(bank?.elementCount).toBe(1);
    expect(r.snap.run.score).toBe(100);
    expect(r.world.lastBanked).toBe(100);
    // The LandWindow lasts exactly ticks(MANUAL_LAND_WINDOW_MS) = 17 ticks after a flat contact.
    expect((bank?.tick ?? 0) - (land?.tick ?? 0)).toBe(ticks(TUNING.MANUAL_LAND_WINDOW_MS));
    expect(r.snap.lastLand).toEqual({ quality: 'clean', tick: land?.tick, final: 100 });
  });

  it('REQ-CTL-10 (CR-43): a 21 deg off-axis landing reads OK, a 66 deg one bails and loses the combo (limit 60, CR-65)', () => {
    TUNING.SIM_SPIN_ASSIST_S = 0; // this test drives the off-axis bail rule itself; the CR-65 landing spin assist would save it
    const land = (spinTicks: number): Rig => {
      const r = new Rig();
      r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
      r.hold(30, { buttons: ['ollie'] });
      r.hold(1);
      r.hold(1, { buttons: ['flip'] });
      // Stick spin 360 deg/s = 3 deg per tick.
      r.hold(spinTicks, { dpad: 'R' });
      r.run(300, () => ({}), airOrLanded(r));
      return r;
    };
    const ok = land(7);
    expect(ok.last('land')?.offAxisDeg).toBeCloseTo(21, 6);
    expect(ok.last('land')?.quality).toBe('ok');
    const bad = land(22);
    expect(bad.last('bail')?.reason).toBe('landing');
    expect(bad.rows()).toContain('10');
    expect(bad.last('comboLost')?.elementCount).toBe(1);
    expect(bad.snap.skater.state).toBe('Bail');
  });

  it('REQ-SM-05 / REQ-TIM-10: a bail tumbles 0.6 s, locks every input for 0.85 s, then stands still facing the old heading', () => {
    TUNING.SIM_SPIN_ASSIST_S = 0; // this test drives the off-axis bail rule itself; the CR-65 landing spin assist would save it
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
    r.hold(30, { buttons: ['ollie'] });
    r.hold(1);
    r.hold(25, { dpad: 'R', buttons: ['flip'] });
    r.run(300, () => ({}), (s) => s.skater.state === 'Bail');
    const bailTick = r.tick - 1;
    r.run(400, () => ({ buttons: ['ollie'], dpad: 'U' }), (s) => s.skater.state === 'Grounded');
    const getUp = r.of('stateChanged').find((e) => e.to === 'GetUp');
    const grounded = r.of('stateChanged').find((e) => e.to === 'Grounded');
    expect((getUp?.tick ?? 0) - bailTick).toBe(ticksS(TUNING.BAIL_TUMBLE_S));
    expect((grounded?.tick ?? 0) - (getUp?.tick ?? 0)).toBe(ticksS(TUNING.GETUP_LOCKOUT_S));
    // Nothing was parsed during Bail / GetUp: Cross held the whole time never made a Crouch.
    expect(r.of('stateChanged').filter((e) => e.tick <= (grounded?.tick ?? 0)).map((e) => e.to)).toEqual(['Crouch', 'Air', 'Bail', 'GetUp', 'Grounded']);
    // Stood up at 0 m/s facing north again; the lockout is over on that very tick, so the held
    // stick already gives one tick of auto-push.
    expect(r.snap.skater.speed).toBeCloseTo(TUNING.PUSH_ACCEL / 120, 9);
    expect(r.snap.skater.forward.z).toBeLessThan(-0.99);
    expect(r.snap.skater.bail).toBeNull();
  });
});

describe.skipIf(!worldAvailable())('air tricks in the world (REQ-SM-03, REQ-INP-04, REQ-SCR-10, REQ-SPC-01)', () => {
  /** Full ollie heading north at 5 m/s; returns the rig in the air and the probed contact tick. */
  const fullOllie = (): { make: () => Rig; contact: number } => {
    const make = (): Rig => {
      const r = new Rig();
      r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
      r.hold(72, { buttons: ['ollie'] });
      r.hold(1);
      return r;
    };
    return { make, contact: probeTick(make, (r) => r.run(300, () => ({}), airOrLanded(r)), (r) => r.last('land')?.tick) };
  };

  it('a grab released 133 ms before contact lands, and 100 ms before lands inside the landing grace (CR-43); held through the contact it lets go and lands (CR-65), and bails with SIM_GRAB_AUTO_RELEASE off', () => {
    const { make, contact } = fullOllie();
    const grab = (releaseBefore: number): Rig => {
      const r = make();
      r.run(300, () => (r.tick < contact - releaseBefore ? { buttons: ['grab'] } : {}), airOrLanded(r));
      return r;
    };
    const ok = grab(16);
    expect(ok.of('bail')).toEqual([]);
    expect(ok.last('trickStart')?.trickId).toBe('indy');
    const late = grab(12);
    expect(late.of('bail')).toEqual([]);
    expect(grab(-5).of('bail')).toEqual([]);
    TUNING.SIM_GRAB_AUTO_RELEASE = 0;
    expect(grab(-5).last('bail')?.reason).toBe('midTrick');
  });

  it('a held grab accrues 100/s until released; the element closes on release', () => {
    const { make, contact } = fullOllie();
    const r = make();
    const start = r.tick;
    r.run(300, () => (r.tick < contact - 20 ? { buttons: ['grab'] } : {}), (s) => s.skater.state === 'Grounded');
    const heldTicks = contact - 20 - start;
    expect(r.last('comboBanked')?.final).toBe(TUNING.BASE_GRAB + Math.round(TUNING.HOLD_GRAB * (heldTicks / 120)));
  });

  it('REQ-INP-04: Square twice within 250 ms is ONE Double Kickflip (150); 400 ms apart it is two Kickflips', () => {
    const { make } = fullOllie();
    const twice = (gap: number): Rig => {
      const r = make();
      r.hold(1, { buttons: ['flip'] });
      r.hold(gap - 1);
      r.hold(1, { buttons: ['flip'] });
      r.run(300, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
      return r;
    };
    const dbl = twice(ticks(200));
    expect(dbl.of('elementAdded').map((e) => e.element.id)).toEqual(['kickflip']);
    expect(dbl.last('comboBanked')?.final).toBe(150);
    expect(dbl.of('trickStart').map((e) => e.trickId)).toEqual(['kickflip', 'double_kickflip']);
    // 400 ms apart the first flip (300 ms, CR-65) has finished: a second, degraded Kickflip (x0.9).
    // The 2.5 m full ollie at g 20 (CR-65) is a 1.0 s air, so it finishes its own 300 ms and lands;
    // 900 ms apart it cannot finish even inside the 200 ms landing grace, and the landing bails (REQ-SM-03).
    const two = twice(ticks(400));
    expect(two.of('elementAdded').map((e) => [e.element.id, e.element.value])).toEqual([['kickflip', 100], ['kickflip', 90]]);
    expect(two.of('bail')).toEqual([]);
    expect(twice(ticks(900)).last('bail')?.reason).toBe('midTrick');
  });

  it('REQ-SCR-10: L2 held with the flip is a Nollie Kickflip (base x1.1, own degradation id)', () => {
    const { make } = fullOllie();
    const r = make();
    r.hold(1, { buttons: ['flip', 'nollie'] });
    r.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.of('elementAdded').map((e) => e.element.id)).toEqual(['nollie_kickflip']);
    expect(r.last('comboBanked')?.final).toBe(FINAL(100 * TUNING.NOLLIE_FAKIE_MULT, 1));
  });

  it('REQ-SPC-01: the special meter fills per completed element by value / 6000', () => {
    const { make } = fullOllie();
    const r = make();
    r.hold(1, { buttons: ['flip'], dpad: 'DR' });
    r.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.last('comboBanked')?.final).toBe(250);
    expect(r.snap.special.meter).toBeCloseTo(250 / TUNING.SPECIAL_FULL_BASE, 9);
  });

  it('rows 12 / 13: landing with Cross held banks and crouches (charge from contact); with a manual pair it manuals', () => {
    const { make, contact } = fullOllie();
    const crouch = make();
    crouch.hold(1, { buttons: ['flip'] });
    crouch.run(300, () => (crouch.tick >= contact - 10 ? { buttons: ['ollie'] } : {}), () => crouch.tick > contact + 2);
    expect(crouch.rows().slice(-1)).toEqual(['12']);
    expect(crouch.snap.skater.state).toBe('Crouch');
    expect(crouch.last('land')?.linker).toBe('crouch');
    expect(crouch.last('comboBanked')?.tick).toBe(contact);
    const man = make();
    man.run(300, (s) => {
      const t = man.tick - contact;
      if (s.skater.state === 'Manual') return man.holdBalance(s, { buttons: ['ollie'] });
      if (t >= -16 && t < -10) return { dpad: 'U', buttons: ['ollie'] };
      if (t >= -10) return { dpad: 'D', buttons: ['ollie'] };
      return {};
    }, () => man.tick > contact + 2);
    expect(man.rows().slice(-1)).toEqual(['13']);
    expect(man.snap.skater.state).toBe('Manual');
  });
});

describe.skipIf(!worldAvailable())('manuals keep the combo alive (SPEC §19, REQ-MAN-01..07)', () => {
  /** Kickflip ollie on the plaza heading north; the manual pair is typed by `pair(airTick)`. */
  const flipOllie = (pair: (airTick: number) => 'U' | 'D' | 'N'): { r: Rig; contact: number } => {
    const make = (): Rig => {
      const r = new Rig();
      r.teleport({ x: 30, y: 0, z: 56 }, N, 6);
      r.hold(30, { buttons: ['ollie'] });
      r.hold(1);
      r.hold(1, { buttons: ['flip'], dpad: 'L' });
      return r;
    };
    const contact = probeTick(make, (r) => r.run(300, () => ({}), airOrLanded(r)), (r) => r.last('land')?.tick);
    const r = make();
    r.run(200, (s) => {
      const d = pair(r.tick - contact);
      if (s.skater.state === 'Manual') return r.holdBalance(s);
      return d === 'N' ? {} : { dpad: d };
    }, (s) => s.skater.state !== 'Air' && r.tick > contact + 20);
    return { r, contact };
  };

  it('row 7: Up,Down completed 10 ticks before contact links a manual; the combo banks as one', () => {
    // Up held 6 ticks, Down from 10 ticks before contact (enters the ring after its 3-tick dwell).
    const { r, contact } = flipOllie((t) => (t >= -16 && t < -10 ? 'U' : t >= -10 && t < -4 ? 'D' : 'N'));
    expect(r.last('land')?.linker).toBe('manual');
    expect(r.of('stateChanged').find((e) => e.tick === contact)?.row).toBe('7');
    r.run(60, (s) => r.holdBalance(s));
    expect(r.snap.skater.state).toBe('Manual');
    expect(r.snap.combo?.names).toEqual(['Kickflip', 'Manual']);
    expect(r.snap.balance?.axis).toBe('v');
    r.hold(1, { buttons: ['ollie'] });
    r.hold(1);
    expect(r.rows().slice(-1)).toEqual(['27']);
    r.run(200, () => ({}), (s) => s.skater.state === 'Grounded');
    const end = r.last('manualEnd');
    const accrual = Math.round(TUNING.HOLD_MANUAL * (end?.heldS ?? 0));
    expect(end?.reason).toBe('pop');
    expect(r.last('comboBanked')?.final).toBe(FINAL(100 + 50 + accrual, 2));
    expect(r.of('comboBanked').length).toBe(1);
  });

  it('row 9d: a pair completed after contact inside the 140 ms LandWindow links too; one past it does not', () => {
    const late = flipOllie((t) => (t >= -2 && t < 4 ? 'U' : t >= 4 && t < 12 ? 'D' : 'N')).r;
    expect(late.rows()).toContain('9d');
    expect(late.snap.skater.state).toBe('Manual');
    // Past the window the kickflip combo has banked; the same pair on flat then starts a NEW manual combo (row 4).
    const tooLate = flipOllie((t) => (t >= 8 && t < 14 ? 'U' : t >= 18 && t < 26 ? 'D' : 'N')).r;
    expect(tooLate.rows()).toEqual(['1', '2', '9', '9b', '4']);
    expect(tooLate.of('comboBanked').map((e) => e.final)).toEqual([100]);
    expect(tooLate.snap.combo?.names).toEqual(['Manual']);
  });

  it('row 28: the opposite pair swaps manual <-> nose manual (+1, needle re-centred), rate-limited (REQ-INP-18)', () => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 8);
    r.hold(6, { dpad: 'U' });
    r.hold(6, { dpad: 'D' });
    expect(r.snap.combo?.names).toEqual(['Manual']);
    r.hold(20);
    r.hold(6, { dpad: 'D' });
    r.hold(6, { dpad: 'U' });
    expect(r.rows().slice(-1)).toEqual(['4']);
    expect(r.snap.combo?.names).toEqual(['Manual', 'Nose Manual']);
    expect(r.last('manualStart')).toMatchObject({ manualId: 'nose_manual', swap: true });
    expect(Math.abs(r.snap.balance?.needle ?? 0)).toBeGreaterThan(TUNING.BAL_RECENTER - 0.02);
    // A second swap inside the 600 ms cooldown is ignored.
    r.hold(6, { dpad: 'U' });
    r.hold(6, { dpad: 'D' });
    expect(r.snap.combo?.names).toEqual(['Manual', 'Nose Manual']);
  });

  it('row 4: Up,Down while rolling on flat starts a manual combo; stick back does not brake it (REQ-CTL-04)', () => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 6);
    r.hold(6, { dpad: 'U' });
    r.hold(6, { dpad: 'D' });
    expect(r.rows()).toEqual(['4']);
    expect(r.snap.combo?.names).toEqual(['Manual']);
    const v = r.snap.skater.speed;
    r.hold(24, { dpad: 'D' });
    expect(r.snap.skater.speed).toBeCloseTo(v - (24 / 120) * TUNING.MANUAL_FRICTION, 6);
  });
});

describe.skipIf(!worldAvailable())('revert (SPEC §19, CR-03, CR-04, REQ-REV-01..05)', () => {
  it('REQ-REV-05: R2 100 ms early, Up,Down at 150 ms: RevertWindow -> Manual, combo alive, stance switched', () => {
    const c = vertContactTick();
    const r = vertRig();
    r.run(900, (s) => {
      const t = r.tick - c;
      if (t >= -12 && t < -10) return { buttons: ['revert'] };
      if (t >= -4 && t < 3) return { dpad: 'U' };
      if (t >= 3 && t < 9) return { dpad: 'D' };
      if (s.skater.state === 'Manual') return r.holdBalance(s);
      return {};
    }, () => r.tick > c + 60);
    const land = r.last('land');
    expect(land?.tick).toBe(c);
    expect(land?.vert).toBe(true);
    expect(land?.linker).toBe('revert');
    expect(r.rows()).toEqual(['37', '8', '15']);
    expect(r.last('revert')?.stance).toBe('switch');
    expect(r.snap.skater.stance).toBe('switch');
    // The manual after a revert scores switch: base 50 x 1.2 (CR-04, REQ-SCR-02).
    expect(r.snap.combo?.elements.map((e) => [e.id, e.value])).toEqual([['revert', 100], ['switch_manual', 60]]);
    // REQ-CTL-13 / CR-19: the switch manual drifts x1.35 at switch stat 4 (one element before it: x1.12).
    const k = simInternals(r.world)?.balance()?.k;
    expect(k).toBeCloseTo(TUNING.BAL_K0 * (1 + TUNING.BAL_ELEMENT_GAIN) * TUNING.SWITCH_DRIFT_MULT, 9);
    // REQ-MAN-07: the manual rides DOWN the face (row 31 only ends a climbing manual) with the combo alive.
    expect(r.snap.skater.state).toBe('Manual');
    expect(r.snap.skater.vel.z).toBeGreaterThan(0);
    expect(r.of('comboBanked')).toEqual([]);
  });

  it('REQ-TIM-11 / row 9c: R2 170 ms after a vert contact reverts, at 190 ms the window has banked', () => {
    const c = vertContactTick();
    const at = (ms: number): Rig => {
      const r = vertRig();
      const press = c + Math.floor((ms * 120) / 1000);
      r.run(900, () => (r.tick >= press && r.tick < press + 2 ? { buttons: ['revert'] } : {}), () => r.tick > c + 40);
      return r;
    };
    const ok = at(170);
    expect(ok.rows()).toEqual(['37', '9', '9c']);
    expect(ok.snap.skater.stance).toBe('switch');
    const late = at(190);
    expect(late.rows()).toEqual(['37', '9', '9b']);
    expect(late.snap.skater.stance).toBe('regular');
  });

  it('REQ-REV-01: R2 more than 150 ms before contact is gone by landing; R2 on a flat landing does nothing', () => {
    const c = vertContactTick();
    const early = vertRig();
    early.run(900, () => (early.tick >= c - 20 && early.tick < c - 18 ? { buttons: ['revert'] } : {}), () => early.tick > c + 30);
    expect(early.rows()).toEqual(['37', '9', '9b']);
    const flat = new Rig();
    flat.teleport({ x: 30, y: 0, z: 56 }, N, 5);
    flat.hold(30, { buttons: ['ollie'] });
    flat.hold(1);
    flat.run(200, (s) => (s.skater.pos.y < 0.4 && s.skater.vel.y < 0 ? { buttons: ['revert'] } : {}), (s) => s.skater.state === 'Grounded');
    expect(flat.rows()).toEqual(['1', '2', '9', '9b']);
    expect(flat.snap.skater.stance).toBe('regular');
  });
});

describe.skipIf(!worldAvailable())('M4: grind -> manual -> revert in one combo on the test box (SPEC §16)', () => {
  it('ledge ground snap, rail end, manual landing, ollie into the mini quarter, revert, switch manual, bank', () => {
    // A choreographed line: it keeps the manual numbers it was timed with (before the founder's
    // 2026-09-23 easier manuals), since it tests the linking rows, not the manual tuning.
    TUNING.MANUAL_FRICTION = 0.35;
    TUNING.MANUAL_MIN_SPEED = 1.0;
    // TB-LEDGE runs north at x 46.3 from z 34 to 18 (top 0.45); TB-MINI's foot is at z 5.8 straight ahead.
    const r = new Rig();
    r.teleport({ x: 46.3, y: 0, z: 40 }, N, 6.5);
    let phase = 0;
    let charge = 0;
    r.run(1600, (s) => {
      const st = s.skater.state;
      const z = s.skater.pos.z;
      switch (phase) {
        case 0: // P5b ground snap (dy 0.45: hop max(0.3, 0.55) m), then balance on the ledge
          if (st === 'Grind') phase = 1;
          return z < 34.4 ? { buttons: ['grind'] } : {};
        case 1: // rail end -> Air (row 21); type Up,Down just before the landing (row 7)
          if (st === 'Grind') return r.holdBalance(s);
          if (st === 'Manual') {
            phase = 2;
            return r.holdBalance(s);
          }
          return s.skater.stateTicks < 10 ? {} : s.skater.stateTicks < 16 ? { dpad: 'U' } : { dpad: 'D' };
        case 2: // manual north, a short charge, release at z 7 (1.2 m before the mini's foot); the
          // CR-65 full ollie (2.5 m) would carry the skater over the mini, so this is a near tap.
          if (st !== 'Manual') {
            phase = 3;
            return {};
          }
          if (z < 8 && z > 7) {
            charge++;
            return r.holdBalance(s, { buttons: ['ollie'] });
          }
          return r.holdBalance(s);
        case 3: // in the air into the mini: R2 spammed on the way down, then Up,Down in the RevertWindow
          if (st === 'Air') return s.skater.vel.y < -0.5 && r.tick % 10 < 5 ? { buttons: ['revert'] } : {};
          if (st === 'RevertWindow') return s.skater.stateTicks < 4 ? { dpad: 'U' } : { dpad: 'D' };
          if (st === 'Manual') {
            phase = 4;
            return r.holdBalance(s);
          }
          return {};
        case 4: // switch manual down the face and out onto the flat, then a tap ollie out and land
          if (st === 'Manual' && z > 9) {
            phase = 5;
            return r.holdBalance(s, { buttons: ['ollie'] });
          }
          if (st === 'Manual') return r.holdBalance(s);
          return {};
        default:
          return {};
      }
    }, (s) => s.skater.state === 'Grounded' && phase >= 4);
    const log = describeEvents(r.events);
    expect(r.rows(), log).toEqual(['36', '21', '7', '27', '8', '15', '27', '9', '9b']);
    // One combo from the snap to the bank: nothing banked or lost in between.
    expect(r.of('comboBanked').length, log).toBe(1);
    expect(r.of('comboLost')).toEqual([]);
    const bank = r.last('comboBanked');
    expect(bank?.elementCount).toBe(4);
    expect(bank?.multiplier).toBe(4);
    expect(r.of('elementAdded').map((e) => e.element.id)).toEqual(['fifty_fifty', 'manual', 'revert', 'switch_manual']);
    expect(r.snap.skater.stance).toBe('switch');
    // FINAL = (100 + 50 + 100 + 60 + accruals) x 4, accruals from the hold times the events report.
    const grind = r.last('grindEnd');
    const manuals = r.of('manualEnd');
    const accrual = Math.round(TUNING.HOLD_FIFTY_FIFTY * (grind?.heldS ?? 0))
      + manuals.reduce((a, m) => a + Math.round(TUNING.HOLD_MANUAL * m.heldS), 0);
    expect(bank?.final).toBe(FINAL(100 + 50 + 100 + 60 + accrual, 4));
    expect(charge).toBeGreaterThan(0);
  });
});

describe.skipIf(!worldAvailable())('spin (CR-01, REQ-VRT-03..05)', () => {
  const ollie = (): Rig => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
    r.hold(72, { buttons: ['ollie'] });
    r.hold(1);
    return r;
  };

  it('one R1 press turns exactly 180 in 0.25 s, twice the stick rate, and the landing counts one 180 (x1.5)', () => {
    const quick = ollie();
    quick.hold(1, { buttons: ['flip', 'spinR'] });
    quick.hold(ticks(250) - 1);
    const quickDeg = Math.abs(quick.snap.skater.airYawDeg);
    expect(quickDeg).toBeCloseTo(180, 6);
    const stick = ollie();
    stick.hold(1, { buttons: ['flip'] });
    stick.hold(ticks(250) - 1, { dpad: 'R' });
    // The stick turned for ticks(250) - 1 ticks at 360 deg/s (the flip press tick was neutral).
    expect(Math.abs(stick.snap.skater.airYawDeg)).toBeCloseTo(3 * (ticks(250) - 1), 6);
    expect(quickDeg).toBeGreaterThan(1.9 * Math.abs(stick.snap.skater.airYawDeg));
    quick.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
    // A 180 on flat re-enters fakie with off-axis 0 (folded, REQ-CTL-10); spin180s 1 adds 0.5.
    expect(quick.last('land')?.offAxisDeg).toBeCloseTo(0, 6);
    expect(quick.of('stateChanged').some((e) => e.to === 'Bail')).toBe(false);
    const bank = quick.last('comboBanked');
    expect(bank?.multiplier).toBe(1.5);
    expect(bank?.final).toBe(FINAL(100, 1.5));
  });

  it('two R1 presses back to back make a 360: two 180s (x2.0)', () => {
    const r = ollie();
    r.hold(1, { buttons: ['flip', 'spinR'] });
    r.hold(1, { buttons: ['flip'] });
    r.hold(1, { buttons: ['flip', 'spinR'] });
    r.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.last('comboBanked')?.multiplier).toBe(2);
    expect(r.last('land')?.offAxisDeg).toBeCloseTo(0, 6);
  });
});

describe.skipIf(!worldAvailable())('walls (REQ-CTL-20, rows 9f / 14)', () => {
  it('CR-65: a kickflip ollie into TB-WALL at 6 m/s head-on never bails on the wall; it bounces off and lands', () => {
    const r = new Rig();
    r.teleport({ x: 59, y: 0, z: 46 }, E, 6);
    r.setMeter(0.6);
    r.hold(30, { buttons: ['ollie'] });
    r.hold(1);
    r.hold(1, { buttons: ['flip'] });
    r.run(300, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
    expect(r.of('bail')).toEqual([]);
    expect(r.snap.skater.state).toBe('Grounded');
    expect(r.snap.skater.vel.x).toBeLessThan(0);
    expect(r.snap.special.meter).toBeGreaterThan(0);
  });
});

describe.skipIf(!worldAvailable())('spine transfer (REQ-VRT-08, CR-24)', () => {
  const transfer = (): Rig => {
    const r = new Rig();
    // TB-SPINE: ridge x 14, coping 1.8 on TB-SPINE-W (x 13.8), approached east up the west face.
    r.teleport({ x: 8, y: 0, z: 16 }, E, 9);
    r.run(400, (s) => (s.skater.state === 'Air' && s.skater.stateTicks > 20 && s.skater.stateTicks < 23 ? { buttons: ['revert'] } : {}), airOrLanded(r));
    return r;
  };

  it('R2 in the air above the transfer coping mirrors the skater to the far face and earns the named gap', () => {
    const r = transfer();
    const t = r.last('transfer');
    expect(['TB-SPINE-W', 'TB-SPINE-E']).toContain(t?.railId);
    // Mirrored across x 14: launched west of the plane, now east of it.
    expect(t?.pos.x).toBeGreaterThan(14);
    expect(r.last('gap')).toMatchObject({ gapId: 'TB-G01', name: 'SPINE TRANSFER', base: 500 });
    const land = r.last('land');
    expect(land?.vert).toBe(true);
    expect(land?.pos.x).toBeGreaterThan(14);
    // The transfer press is never a revert buffer (REQ-INP-16): a plain LandWindow, no revert.
    expect(land?.linker).toBe('none');
    // Row 11 stays in Air (no state change): the log is the launch and the landing only.
    expect(r.rows()).toEqual(['37', '9']);
    expect(r.of('transfer').length).toBe(1);
    expect(r.snap.combo?.elements.map((e) => [e.id, e.value])).toEqual([['gap:TB-G01', 500]]);
  });

  it('the gap never degrades: a second transfer in the same run is worth 500 again (REQ-SCR-05)', () => {
    const r = transfer();
    r.run(200, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.last('comboBanked')?.final).toBe(500);
    r.teleport({ x: 8, y: 0, z: 16 }, E, 9);
    r.run(400, (s) => (s.skater.state === 'Air' && s.skater.stateTicks > 20 && s.skater.stateTicks < 23 ? { buttons: ['revert'] } : {}), (s) => s.skater.state === 'Grounded' && r.of('comboBanked').length === 2);
    expect(r.of('comboBanked').map((e) => e.final)).toEqual([500, 500]);
  });
});

describe.skipIf(!worldAvailable())('specials never trigger a manual or a grind switch (SPEC §19, CR-11, CR-12)', () => {
  const flatAir = (glow: boolean): { r: Rig; contact: number } => {
    const make = (): Rig => {
      const r = new Rig();
      r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
      if (glow) r.setMeter(1);
      r.hold(72, { buttons: ['ollie'] });
      r.hold(1);
      return r;
    };
    const contact = probeTick(make, (r) => r.run(300, () => ({}), airOrLanded(r)), (r) => r.last('land')?.tick);
    return { r: make(), contact };
  };

  it('not glowing, U,D + Circle 16 ticks before contact is a Tailgrab and the pair links a manual (REQ-INP-12)', () => {
    const { r, contact } = flatAir(false);
    r.run(200, (s) => {
      const t = r.tick - contact;
      if (t >= -22 && t < -16) return { dpad: 'U' };
      if (t === -16) return { dpad: 'D', buttons: ['grab'] };
      if (t > -16 && t < -12) return { dpad: 'D' };
      if (s.skater.state === 'Manual') return r.holdBalance(s);
      return {};
    }, () => r.tick > contact + 3);
    expect(r.snap.combo?.names).toEqual(['Tailgrab', 'Manual']);
    expect(r.snap.skater.state).toBe('Manual');
  });

  it('glowing, the SAME input is Kernel Panic: the special consumes the pair, so no manual can follow (CR-11)', () => {
    const { r, contact } = flatAir(true);
    r.run(200, (s) => {
      const t = r.tick - contact;
      if (t >= -22 && t < -16) return { dpad: 'U' };
      if (t === -16) return { dpad: 'D', buttons: ['grab'] };
      if (t > -16 && t < -12) return { dpad: 'D' };
      if (s.skater.state === 'Manual') return r.holdBalance(s);
      return {};
    }, () => r.tick > contact + 3);
    expect(r.last('specialUsed')?.specialId).toBe('kernel_panic');
    expect(r.of('stateChanged').some((e) => e.to === 'Manual')).toBe(false);
    // 700 ms of animation cannot finish in 16 ticks: the landing is a mid-trick bail (REQ-SM-03).
    expect(r.last('bail')?.reason).toBe('midTrick');
  });

  it('glowing, L,R + Square is Token Overflow (2800); not glowing the same input is a Heelflip (REQ-INP-12)', () => {
    const glow = flatAir(true).r;
    glow.hold(4, { dpad: 'L' });
    glow.hold(1, { dpad: 'R', buttons: ['flip'] });
    glow.run(300, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
    expect(glow.last('specialUsed')?.specialId).toBe('token_overflow');
    // The 5 dpad ticks spun the skater 12 deg one way and 3 back: still clean.
    expect(glow.last('comboBanked')?.final).toBe(2800);
    const plainAir = flatAir(false).r;
    plainAir.hold(4, { dpad: 'L' });
    plainAir.hold(1, { dpad: 'R', buttons: ['flip'] });
    plainAir.run(300, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
    expect(plainAir.of('specialUsed')).toEqual([]);
    expect(plainAir.last('comboBanked')?.final).toBe(100);
    expect(plainAir.of('trickStart').map((e) => e.trickId)).toEqual(['heelflip']);
  });

  it('glowing, Kernel Panic early in a full ollie lands clean: 3000 banked, the special meter is not spent', () => {
    const { r } = flatAir(true);
    r.hold(4, { dpad: 'U' });
    r.hold(1, { dpad: 'D', buttons: ['grab'] });
    r.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.of('bail')).toEqual([]);
    expect(r.last('comboBanked')?.final).toBe(3000);
    expect(r.snap.special.glowing).toBe(true);
  });
});

describe.skipIf(!worldAvailable())('holdable specials (REQ-SPC-05, REQ-BAL-01 Context Window)', () => {
  it('900ms Inference: time scale 0.6 while held, the run clock keeps real time, accrual in presentation seconds', () => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
    r.setMeter(1);
    r.hold(72, { buttons: ['ollie'] });
    r.hold(1);
    r.hold(4, { dpad: 'D' });
    const clock0 = r.snap.run.clockS;
    r.hold(1, { dpad: 'U', buttons: ['grab'] });
    expect(r.last('specialUsed')?.specialId).toBe('inference_900ms');
    expect(r.snap.timeScale).toBe(TUNING.INFERENCE_TIME_SCALE);
    // Each held tick advances the clock by (1/120) / 0.6 s (REQ-SPC-05).
    expect(clock0 - r.snap.run.clockS).toBeCloseTo(1 / 120 / 0.6, 9);
    r.hold(64, { buttons: ['grab'] });
    expect(r.snap.special.activeId).toBe('inference_900ms');
    r.run(200, () => ({}), (s) => s.skater.state === 'Grounded');
    expect(r.of('bail')).toEqual([]);
    expect(r.snap.timeScale).toBe(1);
    const bank = r.last('comboBanked');
    // Held 65 ticks = 65 / 120 / 0.6 presentation seconds at 150 points/s.
    expect(bank?.final).toBe(4500 + Math.round(TUNING.HOLD_SPECIAL * (65 / 120 / 0.6)));
  });

  it('Context Window: L,R + Triangle in a glowing manual adds the special and doubles the drift while held', () => {
    TUNING.BAL_MANUAL_DRIFT_MULT = 1; // the doubling is measured against grind-strength drift
    const needleAfter = (glow: boolean): { r: Rig; start: number; end: number } => {
      const r = new Rig();
      r.teleport({ x: 30, y: 0, z: 56 }, N, 6);
      if (glow) r.setMeter(1);
      r.hold(6, { dpad: 'U' });
      r.hold(6, { dpad: 'D' });
      r.hold(4, { dpad: 'L' });
      r.hold(1, { dpad: 'R', buttons: ['grind'] });
      const start = r.snap.balance?.needle ?? 0;
      r.hold(24, { buttons: ['grind'] });
      return { r, start, end: r.snap.balance?.needle ?? 0 };
    };
    const cw = needleAfter(true);
    const plainRun = needleAfter(false);
    expect(cw.r.snap.combo?.names).toEqual(['Manual', 'Context Window']);
    expect(cw.r.snap.skater.poseVariant).toBe('context_window');
    expect(plainRun.r.snap.combo?.names).toEqual(['Manual']);
    // Same seed, same needle history up to the special: the doubled drift moves it further.
    expect(Math.abs(cw.end - cw.start)).toBeGreaterThan(1.5 * Math.abs(plainRun.end - plainRun.start));
  });
});

describe.skipIf(!worldAvailable())('the 2:00 run (REQ-GOL-01, REQ-GOL-06, REQ-SM-09, CR-25)', () => {
  it('the default career run is 2:00: 120 runTick events, 0:00 at tick 14400, then RunEnd (row 41)', () => {
    const r = new Rig({ mode: 'career' });
    expect(r.snap.run.clockS).toBe(120);
    r.hold(120 * 120 + 2);
    expect(r.of('runStart')[0]?.lengthS).toBe(120);
    expect(r.of('runTick').map((e) => e.secondsLeft)).toEqual(Array.from({ length: 120 }, (_, i) => 119 - i));
    expect(r.last('runTick')?.tick).toBe(120 * 120 - 1);
    expect(r.snap.skater.state).toBe('RunEnd');
    expect(r.rows()).toEqual(['41']);
    expect(r.of('runEnd').length).toBe(1);
    expect(r.snap.run.ended).toBe(true);
  });

  it('CR-42: Free Skate with no runLengthS is untimed (INT_FREE_SKATE_LENGTH_S), whoever creates the world', () => {
    const r = new Rig({ mode: 'free' });
    expect(r.snap.run.clockS).toBe(TUNING.INT_FREE_SKATE_LENGTH_S);
    r.hold(120 * 120 + 2);
    expect(r.of('runEnd')).toEqual([]);
    expect(r.of('runStart')[0]?.lengthS).toBe(TUNING.INT_FREE_SKATE_LENGTH_S);
    expect(r.snap.skater.state).not.toBe('RunEnd');
  });

  it('a combo still in the air at 0:00 banks when it lands, then the run ends with it in the score', () => {
    const r = new Rig({ runLengthS: 1 });
    r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
    r.hold(72, { buttons: ['ollie'] });
    r.hold(1);
    r.hold(1, { buttons: ['flip'] });
    r.run(300, () => ({}), (s) => s.run.ended);
    const zero = r.of('runTick').find((e) => e.secondsLeft === 0);
    const bank = r.last('comboBanked');
    expect(zero?.tick).toBe(119);
    expect(bank?.tick).toBeGreaterThan(119);
    expect(bank?.final).toBe(100);
    expect(r.last('runEnd')?.score).toBe(100);
    // Row 40 keeps the air alive at 0:00 (no state change); the landing banks, then row 41 ends the run.
    expect(r.rows()).toEqual(['1', '2', '9', '9b', '41']);
    expect(r.of('stateChanged').find((e) => e.to === 'LandWindow')?.tick).toBeGreaterThan(119);
    expect(r.snap.run.clockS).toBe(0);
  });

  it('a combo lost at 0:00 ends the run after the get-up with nothing banked', () => {
    TUNING.SIM_SPIN_ASSIST_S = 0; // this test drives the off-axis bail rule itself; the CR-65 landing spin assist would save it
    const r = new Rig({ runLengthS: 1 });
    r.teleport({ x: 30, y: 0, z: 56 }, N, 5);
    r.hold(72, { buttons: ['ollie'] });
    r.hold(1);
    r.hold(1, { buttons: ['flip'] });
    // A 90 deg under-rotation (30 ticks of stick spin) bails the landing after 0:00.
    r.run(400, (s) => (s.skater.state === 'Air' && s.skater.stateTicks < 30 ? { dpad: 'R' } : {}), (s) => s.run.ended);
    expect(r.last('comboLost')?.elementCount).toBe(1);
    expect(r.last('runEnd')?.score).toBe(0);
    expect(r.rows()).toEqual(['1', '2', '10', '38', '39', '41']);
    expect(r.of('stateChanged').find((e) => e.to === 'Bail')?.tick).toBeGreaterThan(119);
  });

  it('RUN_OVERTIME_MAX_S after 0:00 a still-alive combo is forced to bail (row 40 overtime)', () => {
    TUNING.RUN_OVERTIME_MAX_S = 1;
    const r = new Rig({ runLengthS: 0.5 });
    r.teleport({ x: 30, y: 0, z: 56 }, N, 9);
    r.hold(6, { dpad: 'U' });
    r.hold(6, { dpad: 'D' });
    r.run(600, (s) => r.holdBalance(s), (s) => s.skater.state === 'Bail');
    expect(r.last('bail')?.reason).toBe('overtime');
    expect(r.last('bail')?.tick).toBe(60 + 120 - 1);
  });
});

describe.skipIf(!worldAvailable())('determinism (ARCHITECTURE decision 4)', () => {
  const timeline = [
    { atTick: 0, input: { dpad: 'U' as const } },
    { atTick: 90, input: { held: { ollie: true } } },
    { atTick: 130, input: { held: { ollie: false }, dpad: 'N' as const } },
    { atTick: 134, input: { held: { flip: true }, dpad: 'L' as const } },
    { atTick: 136, input: { held: { flip: false }, dpad: 'N' as const } },
    { atTick: 216, input: { dpad: 'U' as const } },
    { atTick: 221, input: { dpad: 'D' as const } },
    { atTick: 300, input: { dpad: 'N' as const, held: { ollie: true } } },
    { atTick: 302, input: { held: { ollie: false, spinR: true } } },
    { atTick: 303, input: { held: { spinR: false } } },
  ];
  const run = (seed: number): { snaps: readonly SimSnapshot[]; events: readonly unknown[] } => {
    const world = createWorld({ level: built(), mode: 'free', seed, collectedMacGuffins: [], completedGoals: [] });
    const out = replay(world, createFrameBuilder(), timeline, 600);
    return { snaps: out.snapshots, events: out.events };
  };

  it('same seed and inputs give identical snapshots and events, tick for tick', () => {
    // The timeline rolls north along TB-RAIL's line, so its last pop comes down onto the rail; with
    // the auto grind (SIM_AUTO_GRIND) that is an unbalanced grind and a bail instead of the bank this
    // replay checks for. The rail itself is covered in simGrind.
    TUNING.SIM_AUTO_GRIND = 0;
    const a = run(3);
    const b = run(3);
    expect(a.snaps.length).toBe(600);
    expect(JSON.stringify(a.snaps)).toBe(JSON.stringify(b.snaps));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    // The replay did something: an ollie, a manual and a bank.
    const types = new Set((a.events as { type: string }[]).map((e) => e.type));
    expect(types.has('pop')).toBe(true);
    expect(types.has('manualStart')).toBe(true);
    expect(types.has('comboBanked')).toBe(true);
  });

  it('snapshots are plain JSON (the e2e hook serialises them)', () => {
    const a = run(3);
    const last = a.snaps[a.snaps.length - 1] as SimSnapshot;
    expect(JSON.parse(JSON.stringify(last))).toEqual(last);
  });
});

describe.skipIf(!worldAvailable())('coyote window (REQ-TIM-06, CR-14)', () => {
  const offEdge = (pressAfter: number): Rig => {
    const r = new Rig();
    // TB-STAIRTOP (top 1.2): roll west off its west edge at x 60.
    r.teleport({ x: 63, y: 1.2, z: 17 }, W, 5);
    expect(r.snap.skater.state).toBe('Grounded');
    r.run(200, () => ({}), (s) => s.skater.state === 'Air');
    const left = r.tick - 1;
    r.run(100, () => (r.tick >= left + pressAfter && r.tick < left + pressAfter + 2 ? { buttons: ['ollie'] } : {}), airOrLanded(r));
    return r;
  };

  it('Cross 80 ms after rolling off an edge still pops (0.9 m); 100 ms after, nothing', () => {
    const late = offEdge(ticks(80));
    expect(late.last('pop')).toMatchObject({ from: 'Air', heightM: TUNING.OLLIE_H_TAP_M });
    const tooLate = offEdge(ticks(100));
    expect(tooLate.of('pop')).toEqual([]);
    expect(tooLate.rows()[0]).toBe('37');
  });
});

describe.skipIf(!worldAvailable())('facing (REQ-CTL-18, snapshot)', () => {
  it('the snapshot rotation carries the nose and the skater keeps heading south after a brake pivot', () => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 30 }, S, 3);
    r.hold(30);
    expect(r.snap.skater.forward.z).toBeCloseTo(1, 6);
    expect(r.snap.skater.state).toBe('Grounded');
  });
});

describe.skipIf(!worldAvailable())('polish round 1: vert, spine and out-of-world fixes (sim)', () => {
  /** Hold Cross up TB-VERT at 11 m/s and release it when `release(s)` first holds; returns the rig after the air. */
  const vertRelease = (release: (r: Rig, s: SimSnapshot) => boolean): { r: Rig; peak: number } => {
    const r = vertRig(11);
    let released = false;
    let peak = 0;
    r.run(700, (s) => {
      peak = Math.max(peak, s.skater.pos.y);
      if (!released && release(r, s)) released = true;
      return released ? {} : { buttons: ['ollie'] };
    }, airOrLanded(r));
    return { r, peak };
  };

  it('REQ-CTL-22: an early pop up the vert rises past the coping corner without a head-on wall bail', () => {
    // Cross held up TB-VERT and released at 1.4 to 1.9 m: the corner of the deck behind the coping
    // (a downward-facing contact) used to read as a head-on wall.
    const bails: string[] = [];
    for (const [z0, speed] of [[10, 9], [10, 11], [12, 9], [12, 11]] as const) {
      for (let y = 1.4; y < 1.95; y += 0.1) {
        const r = new Rig();
        r.teleport({ x: 32, y: 0, z: z0 }, N, speed);
        let released = false;
        r.run(700, (s) => {
          if (!released && s.skater.pos.y >= y) released = true;
          return released ? {} : { buttons: ['ollie'] };
        }, airOrLanded(r));
        for (const b of r.of('bail')) bails.push(`z0 ${z0} v ${speed} y ${y.toFixed(1)}: ${b.reason}`);
      }
    }
    expect(bails).toEqual([]);
  });

  it('REQ-VRT-10: the vert pop height is continuous across the lip (Cross released just before or just after leaving)', () => {
    const leave = probeTick(() => vertRig(11), (r) => r.run(700, () => ({ buttons: ['ollie'] }), (s) => s.skater.state === 'Air'), (r) => r.tick);
    const peakAt = (dt: number): number => vertRelease((r) => r.tick >= leave + dt).peak;
    const early = peakAt(-3);
    const atLip = peakAt(0);
    const late = peakAt(3);
    expect(Math.abs(atLip - early)).toBeLessThan(0.15);
    expect(Math.abs(atLip - late)).toBeLessThan(0.15);
  });

  it('DESIGN E.9: R2 anywhere in a full-pop spine air at 11 m/s transfers, the apex included (no height dead zone)', () => {
    const spineRun = (pressAt: number | null): Rig => {
      const r = new Rig();
      r.teleport({ x: 5, y: 0, z: 16 }, E, 11);
      let t0 = -1;
      r.run(700, (s) => {
        if (s.skater.state !== 'Air') return { buttons: ['ollie'] };
        if (t0 < 0) t0 = r.tick;
        return pressAt !== null && (r.tick - t0 === pressAt || r.tick - t0 === pressAt + 1) ? { buttons: ['revert'] } : {};
      }, airOrLanded(r));
      return r;
    };
    const plainAir = spineRun(null);
    const pop = plainAir.of('pop')[0];
    expect(pop?.from).toBe('Air');
    const airTicks = (plainAir.last('land')?.tick ?? 0) - (pop?.tick ?? 0);
    expect(airTicks).toBeGreaterThan(120);
    const missed: number[] = [];
    for (let d = 0; d < airTicks - ticks(200) - 4; d += 10) {
      const r = spineRun(d);
      if (r.of('transfer').length !== 1) missed.push(d);
    }
    expect(missed).toEqual([]);
  });

  it('a skater who leaves the world bails (landing) and gets up on the last safe grounded spot', () => {
    const r = new Rig();
    r.teleport({ x: 30, y: 0, z: 56 }, N, 3);
    r.hold(10);
    const safe = r.snap.skater.pos;
    expect(r.snap.skater.state).toBe('Grounded');
    const lowest = built().bounds.min.y;
    r.teleport({ x: -500, y: 2, z: -500 }, N, 3);
    expect(r.snap.skater.state).toBe('Air');
    r.run(1200, () => ({}), (s) => s.skater.state === 'Grounded');
    const log = describeEvents(r.events);
    expect(r.of('bail').map((e) => e.reason), log).toEqual(['landing']);
    expect(Math.min(...r.snaps.map((s) => s.skater.pos.y))).toBeGreaterThan(lowest - TUNING.SIM_KILL_BELOW_M - 0.5);
    expect(r.snap.skater.state).toBe('Grounded');
    expect(Math.hypot(r.snap.skater.pos.x - safe.x, r.snap.skater.pos.z - safe.z)).toBeLessThan(1);
  });
});
