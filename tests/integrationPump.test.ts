/**
 * tests/integrationPump.test.ts (integration, polish round 2): pumping on the way down after an air
 * (DESIGN C.5 rows 9i, 9j, 12b; REQ-CTL-21, REQ-SM-13). Through the REAL world on the test box and
 * the Woodshed: Cross held on the descending face after a vert landing pumps (speed gain, no Crouch,
 * no pop); Cross held through the landing pumps too; pumping every descent of WS-BW1 builds the air
 * that reaches letter C (Woodshed line 1, "pump two walls").
 */

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { WOODSHED } from '../src/levels/woodshed';
import { built, describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

const NORTH: Vec3 = { x: 0, y: 0, z: -1 };

/** Roll up a test-box quarter-pipe with no input, air, land; returns the rig on the landing tick. */
function toLanding(x: number, speed: number, holdCrossInAir = false): Rig {
  const r = new Rig({ seed: 5 });
  r.teleport({ x, y: 0, z: 12 }, NORTH, speed);
  let airSeen = false;
  for (let i = 0; i < 600; i++) {
    const inAirDown = airSeen && r.snap.skater.vel.y < 0;
    r.hold(1, { buttons: holdCrossInAir && inAirDown ? ['ollie'] : [] });
    const s = r.snap.skater;
    if (s.state === 'Air') airSeen = true;
    if (airSeen && s.state !== 'Air') return r;
  }
  throw new Error(`never landed: ${describeEvents(r.events)}`);
}

describe.skipIf(!worldAvailable())('pumping after an air (rows 9i, 9j, 12b)', () => {
  for (const [name, x, speed] of [['TB-VERT', 32, 11], ['TB-MINI', 50, 8]] as const) {
    it(`${name} at ${speed} m/s: Cross held 5 to 20 ticks after the vert landing pumps, never crouches or pops`, () => {
      for (const delay of [5, 10, 15, 20]) {
        const r = toLanding(x, speed);
        const t0 = r.tick;
        expect(r.snap.skater.state, `${name} d${delay}`).toBe('LandWindow');
        r.hold(delay);
        const before = r.snap.skater.speed;
        let best = before;
        for (let i = 0; i < 60; i++) best = Math.max(best, r.hold(1, { buttons: ['ollie'] }).skater.speed);
        r.hold(30);
        const log = `${name} d${delay}: ${describeEvents(r.events.filter((e) => e.tick >= t0))}`;
        expect(r.of('pop', t0), log).toHaveLength(0);
        expect(r.states(t0), log).not.toContain('Crouch');
        expect(best - before, log).toBeGreaterThan(0.3);
      }
    }, 60_000);
  }

  it('Cross held through a vert landing pumps (row 12b); releasing at the bottom fires no hop', () => {
    const r = toLanding(32, 11, true);
    const t0 = r.tick - 1;
    const log = (): string => describeEvents(r.events.filter((e) => e.tick >= t0));
    expect(r.rows(t0), log()).toContain('12b');
    expect(r.snap.skater.pumping, log()).toBe(true);
    r.hold(20, { buttons: ['ollie'] });
    r.hold(60);
    expect(r.of('pop', t0), log()).toHaveLength(0);
    expect(r.of('bail', t0), log()).toHaveLength(0);
  }, 60_000);

  it('WS-BW1: pumping every descent from 8 m/s grows each air and reaches letter C, with no pop', () => {
    const r = new Rig({ level: built(WOODSHED), seed: 5 });
    r.teleport({ x: 14, y: -2.4, z: 16 }, NORTH, 8);
    const apexes: number[] = [];
    let top = -Infinity;
    for (let i = 0; i < 120 * 10; i++) {
      const s = r.snap.skater;
      if (s.state === 'Air') top = Math.max(top, s.pos.y);
      else if (top > -Infinity) {
        apexes.push(top);
        top = -Infinity;
      }
      r.hold(1, { buttons: s.state !== 'Air' && s.vel.y < -0.05 ? ['ollie'] : [] });
    }
    const log = `apexes ${apexes.map((a) => a.toFixed(2)).join(',')} ${describeEvents(r.events)}`;
    expect(r.of('pop'), log).toHaveLength(0);
    expect(r.of('bail'), log).toHaveLength(0);
    expect(apexes.length, log).toBeGreaterThanOrEqual(3);
    expect(apexes[2], log).toBeGreaterThan(apexes[0] + 0.5);
    expect(r.of('letter').length, log).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
