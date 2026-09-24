/**
 * tests/fixtures/sim/levels.ts (sim track): small LevelDefs for controller and grind tests, built
 * by the REAL level builder (buildLevel). Geometry the test box does not have: the DESIGN C.6
 * standard quarter-pipe (coping 2.4, R 2.7), a 60 deg bank, a 10 m tower, a kinked rail and a
 * long flat bar. Coordinates are (x, z, y) through xzy() like the park files.
 */

import { xzy } from '../../../src/core/math';
import type { LevelDef } from '../../../src/levels/types';

/** Standard QP (MS / spine class, exit slope 83.6 deg): coping line z 6, foot z 6 + 2.683, span x[10, 30]. */
export const QP_COPING_Z = 6;
export const QP_COPING_Y = 2.4;

export const SIM_FIXTURE: LevelDef = {
  id: 'testBox',
  name: 'Sim Fixture',
  size: { x: 100, z: 60 },
  environment: 'testGrid',
  spawn: { pos: xzy(50, 50, 0), facing: 'north' },
  spawnArea: { x0: 40, z0: 45, x1: 60, z1: 55 },
  primitives: [
    { kind: 'ground', id: 'SF-FLOOR', rect: { x0: 0, z0: 0, x1: 100, z1: 60 }, y: 0, material: 'concrete' },
    {
      kind: 'quarterPipe', id: 'SF-QP', facing: 'south', footLine: 8.683, copingLine: QP_COPING_Z, span: [10, 30],
      copingHeight: QP_COPING_Y, radius: 2.7, deckDepth: 3, copingRailId: 'SF-QP-C', material: 'maple',
    },
    // 60 deg plane bank rising to the west: x 42 (y 0) to x 40 (y 3.464).
    { kind: 'bank', id: 'SF-BANK60', rect: { x0: 40, z0: 10, x1: 42, z1: 30 }, yHigh: 3.464, yLow: 0, downhill: 'east' },
    { kind: 'box', id: 'SF-TOWER', rect: { x0: 70, z0: 2, x1: 80, z1: 12 }, y0: 0, height: 10 },
  ],
  rails: [
    { id: 'SF-QP-C', kind: 'coping', points: [xzy(10, QP_COPING_Z, QP_COPING_Y), xzy(30, QP_COPING_Z, QP_COPING_Y)], name: 'QP Coping' },
    // A flat bar with a 90 deg kink at (60, 40): east then north.
    { id: 'SF-KINK', kind: 'rail', points: [xzy(50, 40, 0.55), xzy(60, 40, 0.55), xzy(60, 30, 0.55)], name: 'Kinked Bar' },
    // A gentle 30 deg bend (below the 55 deg corner limit) at (70, 50).
    { id: 'SF-BEND', kind: 'rail', points: [xzy(62, 50, 0.55), xzy(70, 50, 0.55), xzy(78, 45.381, 0.55)], name: 'Bent Bar' },
  ],
  gaps: [],
  letters: [],
  macguffin: null,
  npcs: [],
  goals: [],
  decals: [],
  feeds: [],
};
