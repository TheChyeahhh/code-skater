/**
 * tests/integrationSpeedTier.test.ts (integration, polish round 2): the snapshot speed tier
 * (REQ-CAM-04) has hysteresis. The top push speed (PUSH_CUTOFF 0.85 of vmax, CR-44) sits on
 * CAM_FOV_KICK_SPEED 0.85, which made a sustained push flip fast / cruise every 0.3 s; now a push
 * settles in cruise and only real over-push speed reads fast.
 */

import { describe, expect, it } from 'vitest';
import { Rig, worldAvailable } from './fixtures/sim/rig';

const EAST = { x: 1, y: 0, z: 0 };

describe.skipIf(!worldAvailable())('speed tier hysteresis (REQ-CAM-04)', () => {
  it('a 4 s push from rest changes tier at most twice and never flickers', () => {
    const r = new Rig({ seed: 3 });
    r.teleport({ x: 2, y: 0, z: 58 }, EAST, 0);
    r.hold(480, { stick: { x: 0, y: 1 } });
    const tiers = r.of('speedTier');
    expect(r.snap.skater.speedRatio).toBeGreaterThan(0.84);
    expect(tiers.length, tiers.map((t) => `${t.tick}:${t.tier}`).join(' ')).toBeLessThanOrEqual(2);
  });

  it('rolling well above the push ceiling reads fast', () => {
    const r = new Rig({ seed: 3 });
    r.teleport({ x: 2, y: 0, z: 58 }, EAST, 14.5);
    r.hold(3);
    expect(r.snap.skater.speedTier).toBe('fast');
  });
});
