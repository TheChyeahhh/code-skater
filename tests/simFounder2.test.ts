// tests/simFounder2.test.ts (sim track): founder playtest 2 (DESIGN L CR-65) on the shipped tuning,
// with auto-push ON. The global test setup turns auto-push off for the coasting scenario suites;
// every test here turns it back on first.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maxSpeed, resetTuning, TUNING } from '../src/core/tuning';
import { Rig, worldAvailable } from './fixtures/sim/rig';

const E = { x: 1, y: 0, z: 0 };

beforeEach(() => {
  TUNING.SIM_AUTO_PUSH = 1;
});
afterEach(() => resetTuning());

describe.skipIf(!worldAvailable())('founder playtest 2 (CR-65)', () => {
  it('THPS1 auto-roll: from a standstill, with no stick input, the skater pushes to full speed in about 1.2 s', () => {
    const r = new Rig();
    r.teleport({ x: 4, y: 0, z: 58 }, E, 0);
    r.hold(144);
    expect(r.snap.skater.state).toBe('Grounded');
    expect(r.snap.skater.speed).toBeGreaterThan(0.95 * maxSpeed(false));
    expect(r.of('push').length).toBeGreaterThan(0);
  });

  it('holding ollie (Crouch) keeps pushing, so charging never costs speed', () => {
    const r = new Rig();
    r.teleport({ x: 4, y: 0, z: 58 }, E, 6);
    r.hold(60, { buttons: ['ollie'] });
    expect(r.snap.skater.state).toBe('Crouch');
    expect(r.snap.skater.speed).toBeGreaterThan(6);
  });

  it('stick back only brakes: it stops the skater, never turns him around, and releasing it rolls on the same way', () => {
    const r = new Rig();
    r.teleport({ x: 4, y: 0, z: 58 }, E, 5);
    r.run(360, () => ({ dpad: 'D' }), undefined);
    expect(r.snap.skater.speed).toBe(0);
    expect(r.snap.skater.forward.x).toBeGreaterThan(0.99);
    r.hold(60);
    expect(r.snap.skater.vel.x).toBeGreaterThan(1);
    expect(r.snap.skater.forward.x).toBeGreaterThan(0.99);
  });

  it('a wall never bails: full speed head-on into TB-WALL, rolling or in the air, keeps skating', () => {
    for (const air of [false, true]) {
      const r = new Rig();
      r.teleport({ x: 50, y: 0, z: 46 }, E, maxSpeed(false));
      if (air) r.run(200, (s) => (s.skater.pos.x > 56 && s.skater.state === 'Grounded' ? { buttons: ['ollie'] } : {}), (s) => s.skater.state === 'Air');
      r.hold(240);
      expect(r.of('bail'), air ? 'air' : 'ground').toEqual([]);
      expect(r.snap.skater.state, air ? 'air' : 'ground').toBe('Grounded');
    }
  });

  it('plain ollies never bail: 60 ollies with random speed, charge and steering on the flat plaza all land', () => {
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let ollies = 0;
    for (let i = 0; i < 60; i++) {
      const r = new Rig();
      r.teleport({ x: 4, y: 0, z: 50 }, E, 4 + rand() * 8);
      const charge = 1 + Math.floor(rand() * 80);
      const steer = rand() < 0.33 ? 'L' : rand() < 0.5 ? 'R' : undefined;
      r.hold(charge, steer ? { buttons: ['ollie'], dpad: steer } : { buttons: ['ollie'] });
      r.run(300, () => (steer ? { dpad: steer } : {}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
      ollies += r.of('pop').length;
      expect(r.of('bail'), `ollie ${i}: charge ${charge} steer ${steer ?? '-'} ${JSON.stringify(r.of('bail'))} ${JSON.stringify(r.snap.skater.pos)}`).toEqual([]);
    }
    expect(ollies).toBe(60);
  });

  it('a kickflip popped from a tap ollie at any point before the apex lands', () => {
    for (const delay of [0, 10, 20, 30]) {
      const r = new Rig();
      r.teleport({ x: 4, y: 0, z: 50 }, E, 8);
      r.hold(1, { buttons: ['ollie'] });
      r.hold(1);
      r.hold(delay);
      r.hold(1, { buttons: ['flip'], dpad: 'L' });
      r.run(300, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
      expect(r.of('bail'), `flip ${delay} ticks after the pop`).toEqual([]);
    }
  });
});
