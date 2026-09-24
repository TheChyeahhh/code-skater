/**
 * tests/integrationManualLine.test.ts (integration, polish round 2): a manual rolled into a
 * transition rides up the face and leaves the lip into the air with the combo alive (DESIGN C.5 row
 * 31 banks on a bank only; row 33b takes the lip). The authored lines chain exactly this: G.1 line 1
 * "manual across the crosswalk -> up MS-B3 -> MS-Q1 (air, Indy, R2 revert)" and G.2 line 4 "manual
 * west -> spine east face -> air". Replays through the REAL world on the real parks.
 */

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { MARKET_STREET } from '../src/levels/marketStreet';
import type { LevelDef } from '../src/levels/types';
import { WOODSHED } from '../src/levels/woodshed';
import { built, describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

/** Teleport, Up,Down manual, balance; R2 tapped on the tick after the first vert landing (row 9c, the revert). */
function manualInto(def: LevelDef, pos: Vec3, dir: Vec3, speed: number): Rig {
  const r = new Rig({ level: built(def), seed: 5 });
  r.teleport(pos, dir, speed);
  r.hold(2);
  r.hold(4, { dpad: 'U' });
  r.hold(4, { dpad: 'D' });
  let reverted = false;
  for (let i = 0; i < 500; i++) {
    const s = r.snap;
    const tap = !reverted && s.skater.state === 'LandWindow';
    if (tap) reverted = true;
    r.hold(1, r.holdBalance(s, tap ? { buttons: ['revert'] } : {}));
    if (r.of('comboBanked').length > 0 || r.of('bail').length > 0) break;
  }
  return r;
}

describe.skipIf(!worldAvailable())('a manual rides a transition into the air (rows 31, 33b)', () => {
  it('Market Street line 1: the crosswalk manual carries up MS-Q1 into an air and a revert, one combo', () => {
    for (const speed of [11, 12, 13]) {
      const r = manualInto(MARKET_STREET, { x: 46, y: -1.2, z: 93 }, { x: 0, y: 0, z: 1 }, speed);
      const log = `${speed} m/s: ${describeEvents(r.events)}`;
      expect(r.rows(), log).not.toContain('31');
      expect(r.rows(), log).toContain('33b');
      expect(r.of('bail'), log).toHaveLength(0);
      const ids = r.of('elementAdded').map((e) => e.element.id);
      expect(ids, log).toContain('manual');
      expect(ids, log).toContain('revert');
      // Manual and revert banked together: one combo, at least two elements.
      expect(r.of('comboBanked')[0]?.elementCount ?? 0, log).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);

  it('Woodshed: a manual into the spine west face at 7, 9 and 11 m/s airs off the top with the combo alive', () => {
    for (const speed of [7, 9, 11]) {
      const r = manualInto(WOODSHED, { x: 30, y: 0, z: 30 }, { x: 1, y: 0, z: 0 }, speed);
      const log = `${speed} m/s: ${describeEvents(r.events)}`;
      expect(r.rows(), log).not.toContain('31');
      expect(r.rows(), log).toContain('33b');
      expect(r.of('bail'), log).toHaveLength(0);
      expect(r.of('comboBanked')[0]?.elementCount ?? 0, log).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);
});
