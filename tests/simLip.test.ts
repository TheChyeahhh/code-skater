// tests/simLip.test.ts (sim track): DESIGN "lip.test" (ARCHITECTURE.md section 10), REQ-LIP-01..04,
// CR-13, on the REAL world: stalls on the test box vert coping (TB-VERT-C, 3.6 m), their exits, the
// lip -> revert -> manual line, and the coping grind a shallow approach gets instead (REQ-LIP-02).
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, ticks, TUNING } from '../src/core/tuning';
import type { DirOrNeutral } from '../src/core/types';
import { describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

afterEach(() => resetTuning());

const N = { x: 0, y: 0, z: -1 };

/**
 * Up TB-VERT at the speed whose air peaks 0.43 m over the 3.6 m coping (9.5 m/s at transition
 * gravity x 0.45; 8.15 m/s at the CR-44 x 0.3), x 32; Triangle (with `dir`) pressed near the apex.
 */
function lipRig(dir: DirOrNeutral = 'N'): Rig {
  const r = new Rig();
  const g = TUNING.GRAVITY;
  r.teleport({ x: 32, y: 0, z: 12 }, N, Math.sqrt(2 * g * TUNING.TRANSITION_GRAVITY_FACTOR * 3.6 + 2 * g * 0.43));
  r.run(400, (s) => (s.skater.state === 'Air' && s.skater.vel.y < 2.5 ? { buttons: ['grind'], dpad: dir } : {}), (s) => s.skater.state === 'Lip' || r.of('land').length > 0);
  return r;
}

describe.skipIf(!worldAvailable())('lip tricks at the coping (REQ-LIP-01, CR-13)', () => {
  it('Triangle at the vert coping near the apex stalls: Axle Stall, frozen on the coping, horizontal needle', () => {
    const r = lipRig();
    expect(r.snap.skater.state, describeEvents(r.events)).toBe('Lip');
    expect(r.rows()).toEqual(['37', '6']);
    expect(r.last('lipStart')).toMatchObject({ railId: 'TB-VERT-C', lipId: 'axle_stall' });
    expect(r.snap.combo?.names).toEqual(['Axle Stall']);
    expect(r.snap.balance?.axis).toBe('h');
    expect(r.snap.skater.pose).toBe('lip');
    r.hold(30, { buttons: ['grind'] });
    expect(r.snap.skater.speed).toBe(0);
    expect(r.snap.skater.pos.y).toBeCloseTo(3.6 + TUNING.BOARD_THICKNESS_M, 6);
    expect(r.snap.skater.pos.z).toBeCloseTo(4, 6);
  });

  it('REQ-LIP-03: releasing Triangle drops back in (row 25): the first face contact comes within 0.4 s at slope >= 40', () => {
    const r = lipRig();
    r.run(40, (s) => r.holdBalance(s, { buttons: ['grind'] }));
    r.hold(1);
    expect(r.rows().slice(-1)).toEqual(['25']);
    const exitTick = r.tick - 1;
    const air = r.snap.skater;
    // Exit: 0.15 m off the (vertical, south-facing) face, 3.5 m/s down it plus 0.5 x sqrt(2 g 0.25)
    // up, then this tick's gravity step.
    const vy = -TUNING.LIP_EXIT_SPEED + 0.5 * Math.sqrt(2 * TUNING.GRAVITY * TUNING.LIP_EXIT_POP_M) - TUNING.GRAVITY / 120;
    expect(air.vel.y).toBeCloseTo(vy, 6);
    expect(air.vel.z).toBeCloseTo(0, 6);
    expect(air.pos.z).toBeCloseTo(4 + TUNING.LIP_EXIT_OFFSET_M, 6);
    r.run(200, () => ({}), () => r.of('land').length > 0 || r.of('bail').length > 0);
    const land = r.last('land');
    expect(r.of('bail')).toEqual([]);
    expect(land?.vert).toBe(true);
    expect(((land?.tick ?? 0) - exitTick) / 120).toBeLessThan(0.4);
    expect(r.last('lipEnd')).toMatchObject({ lipId: 'axle_stall', reason: 'exit' });
    // An Axle Stall comes back in forward.
    expect(r.snap.skater.fakie).toBe(false);
    r.run(100, () => ({}), (s) => s.skater.state === 'Grounded');
    const held = r.last('lipEnd')?.heldS ?? 0;
    expect(r.last('comboBanked')?.final).toBe(TUNING.BASE_LIP + Math.round(TUNING.HOLD_LIP * held));
  });

  it('row 25b: a tapped Triangle still stalls for LIP_MIN_HOLD_MS (150 ms) before dropping in', () => {
    const r = lipRig();
    const enter = r.tick - 1;
    r.hold(1);
    expect(r.snap.skater.state).toBe('Lip');
    r.run(60, () => ({}), (s) => s.skater.state !== 'Lip');
    const exit = r.of('stateChanged').find((e) => e.from === 'Lip');
    expect(exit?.row).toBe('25');
    expect((exit?.tick ?? 0) - enter).toBe(ticks(TUNING.LIP_MIN_HOLD_MS));
  });

  it('row 25b: a Triangle TAPPED early (released in Air before the buffered snap) still exits at LIP_MIN_HOLD_MS', () => {
    for (const tap of [1, 2, 4]) {
      const r = new Rig();
      // 8.5 m/s up TB-VERT (9 before the CR-65 gravity 20): pressed on the way up (vy < 1), the lip candidate comes ~20 ticks later.
      r.teleport({ x: 32, y: 0, z: 12 }, N, 8.5);
      let pressAt = -1;
      r.run(600, (s) => {
        if (pressAt < 0 && s.skater.state === 'Air' && s.skater.vel.y < 1) pressAt = r.tick;
        const down = pressAt >= 0 && r.tick < pressAt + tap;
        return r.holdBalance(s, down ? { buttons: ['grind'] } : {});
      }, () => r.of('lipEnd').length > 0 || r.of('bail').length > 0);
      const log = describeEvents(r.events);
      const start = r.last('lipStart');
      // The buffered case: the snap came after the release.
      expect(start?.tick ?? -1, log).toBeGreaterThanOrEqual(pressAt + tap);
      const end = r.last('lipEnd');
      expect(end?.reason, `tap ${tap}: ${log}`).toBe('exit');
      expect((end?.tick ?? 0) - (start?.tick ?? 0)).toBe(ticks(TUNING.LIP_MIN_HOLD_MS));
    }
  });

  it('Rock to Fakie (Down + Triangle) exits riding fakie; Cross also leaves the lip (row 25)', () => {
    const r = lipRig('D');
    expect(r.last('lipStart')?.lipId).toBe('rock_to_fakie');
    r.run(30, (s) => r.holdBalance(s, { buttons: ['grind'] }));
    r.hold(1, { buttons: ['grind', 'ollie'] });
    expect(r.snap.skater.state).toBe('Air');
    r.run(200, () => ({}), () => r.of('land').length > 0 || r.of('bail').length > 0);
    expect(r.of('bail')).toEqual([]);
    expect(r.snap.skater.fakie).toBe(true);
    expect(r.snap.combo?.names).toEqual(['Rock to Fakie']);
  });

  it('lip -> revert -> manual: R2 before the face contact after the stall reverts, Up,Down links the manual', () => {
    const r = lipRig();
    r.run(30, (s) => r.holdBalance(s, { buttons: ['grind'] }));
    r.hold(1);
    r.run(200, (s) => {
      if (s.skater.state === 'Air') return s.skater.pos.y < 3.0 ? { buttons: ['revert'] } : {};
      if (s.skater.state === 'RevertWindow') return s.skater.stateTicks < 4 ? { dpad: 'U' } : { dpad: 'D' };
      return r.holdBalance(s);
    }, (s) => s.skater.state === 'Manual');
    expect(r.rows()).toEqual(['37', '6', '25', '8', '15']);
    expect(r.snap.combo?.names).toEqual(['Axle Stall', 'Revert', 'Switch Manual']);
    expect(r.snap.skater.stance).toBe('switch');
  });

  it('row 26: pushing into the lean on the coping bails and loses the combo', () => {
    const r = lipRig();
    r.run(300, (s) => ({ buttons: ['grind'], dpad: (s.balance?.needle ?? 0) > 0 ? 'R' : 'L' }), (s) => s.skater.state !== 'Lip');
    expect(r.rows().slice(-1)).toEqual(['26']);
    expect(r.last('lipEnd')?.reason).toBe('bail');
    expect(r.last('comboLost')?.elementCount).toBe(1);
  });

  it('REQ-LIP-02: in the air along the coping (<= 55 deg) Triangle is a coping grind, not a lip', () => {
    const r = new Rig();
    r.teleport({ x: 26, y: 3.95, z: 4.1 }, { x: 1, y: 0, z: 0 }, 5);
    expect(r.snap.skater.state).toBe('Air');
    r.hold(1, { buttons: ['grind'] });
    expect(r.snap.skater.state).toBe('Grind');
    expect(r.last('grindStart')).toMatchObject({ railId: 'TB-VERT-C', railKind: 'coping' });
    expect(r.of('lipStart')).toEqual([]);
  });
});
