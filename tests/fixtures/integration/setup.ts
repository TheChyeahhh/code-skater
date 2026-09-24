/**
 * Global vitest setup. The sim scenario suites were written for coasting physics: they start the
 * skater at a set speed and measure what the ramp, rail or landing does to it. Founder playtest 2
 * (DESIGN L CR-65) made the game push on its own (SIM_AUTO_PUSH = 1), which would speed those
 * scenarios up, so every test starts with auto-push off. tests/simFounder2.test.ts turns it on and
 * checks the shipped behavior. Suites reset TUNING in afterEach, so this runs before every test.
 */
import { beforeEach } from 'vitest';
import { TUNING } from '../../../src/core/tuning';

beforeEach(() => {
  TUNING.SIM_AUTO_PUSH = 0;
});
