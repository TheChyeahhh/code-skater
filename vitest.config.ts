import { defineConfig } from 'vitest/config';

/**
 * Unit tests run in plain node: no WebGL (REQ-TST-01). three.js math, geometry and three-mesh-bvh
 * work in node; anything that needs a canvas belongs in e2e/.
 * DOM suites (tests/ui*.test.ts, tests/hud*.test.ts, tests/integrationDom.test.ts) opt in to a DOM
 * by putting exactly this on line 1:   // @vitest-environment happy-dom
 * Everything else stays node (tests/contracts.test.ts asserts there is no window by default).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/fixtures/integration/setup.ts'],
    passWithNoTests: false,
    // The sim suites build whole parks (BVH, flood fills) and run the real world for seconds of sim
    // time; on a loaded machine the 5 s default timed out 3 to 4 of them. Suites that need more set it.
    testTimeout: 30_000,
  },
});
