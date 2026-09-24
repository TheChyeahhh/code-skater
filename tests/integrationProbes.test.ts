// tests/integrationProbes.test.ts (integration): the builder-backed and world / replay suites of the
// street, woodshed and sim tracks sit behind `describe.skipIf(tryImplemented(...) === null)` probes
// (ARCHITECTURE.md section 10), which were right while tracks were stubs. After the merge a probe
// that returns null would silently SKIP those suites, so this suite pins every probe to "implemented":
// a stub coming back, or a probe throwing, now fails here instead of turning suites grey.
import { describe, expect, it } from 'vitest';
import { tryImplemented } from '../src/core/contract';
import { neutralFrame } from '../src/core/mock';
import { buildLevel } from '../src/levels/builder';
import { MARKET_STREET } from '../src/levels/marketStreet';
import { TEST_BOX } from '../src/levels/testBox';
import type { LevelDef } from '../src/levels/types';
import { validateLevel } from '../src/levels/validate';
import { WOODSHED } from '../src/levels/woodshed';
import { createWorld } from '../src/sim/world';

const LEVELS: readonly LevelDef[] = [TEST_BOX, MARKET_STREET, WOODSHED];

describe('track probes are live after the merge (no suite may skip on a stub)', () => {
  for (const def of LEVELS) {
    it(`${def.id}: buildLevel + validateLevel are implemented and the park validates clean`, () => {
      const violations = tryImplemented(() => validateLevel(def, buildLevel(def)));
      expect(violations).not.toBeNull();
      expect(violations).toEqual([]);
    });

    it(`${def.id}: createWorld(...).step() is implemented (the sim suites' worldAvailable probe)`, () => {
      const snap = tryImplemented(() => {
        const world = createWorld({ level: buildLevel(def), mode: 'career', seed: 1, collectedMacGuffins: [], completedGoals: [] });
        return world.step(neutralFrame(0)).snapshot;
      });
      expect(snap).not.toBeNull();
      expect(snap?.levelId).toBe(def.id);
    });
  }
});
