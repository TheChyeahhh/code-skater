/**
 * src/levels/testBox.ts (levels track): the M3 / M4 test level (DESIGN J.1): skate, ollie, land,
 * bail, grind, manual and revert at known coordinates. The sim track and e2e build against these
 * ids and numbers; change them only with a note to both.
 *
 * Park 80 x 60 m (x east, z south, y up, origin north-west corner), concrete floor at y 0, the four
 * builder boundary walls (12 m) at the edges. Coordinates below are (x, z, y).
 *
 * | id | kind | where | notes |
 * |---|---|---|---|
 * | TB-FLOOR | ground | x[0,80] z[0,60] y 0 | flat plaza |
 * | spawn | | (40, 46, 0) facing north | spawnArea x[30,50] z[42,52] (clear flat) |
 * | TB-RAIL | rail (round) | (40, 40, 0.55) -> (40, 20, 0.55) | THE KNOWN RAIL for e2e: 20 m flat bar straight ahead of spawn, points run north; ground snap dy 0.55 |
 * | TB-LEDGE | ledge | x[46,46.6] z[18,34], top 0.45 | rail TB-LEDGE (46.3, 34, 0.45) -> (46.3, 18, 0.45) |
 * | TB-PAD | box (manual pad) | x[52,56] z[24,34], h 0.15 | not grindable |
 * | TB-VERT | quarterPipe (vert) | coping z 4, foot z 7, x[24,40], facing south | coping 3.6 = R 3.0 + vertExt 0.6, deck z[2,4]; coping rail TB-VERT-C (24, 4, 3.6) -> (40, 4, 3.6) |
 * | TB-MINI | quarterPipe (mini) | coping z 4, foot z ~5.8, x[44,56], facing south | coping 1.5, R 1.8, deck z[2,4]; coping rail TB-MINI-C (44, 4, 1.5) -> (56, 4, 1.5) |
 * | TB-BANK | bank | x[4,10] z[20,30] | y 1.2 at x 4 down to 0 at x 10 (downhill east) |
 * | TB-KICK | kicker | x[20,22] z[38,42] | rises west to 0.6 |
 * | TB-SPINE | spine | ridge along z at x 14, z[10,22] | coping 1.8, R 2.2, deck gap 0.4; copings TB-SPINE-W (13.8, y 1.8) and TB-SPINE-E (14.2, y 1.8), both tagged transfer, transferPlane x 14 |
 * | TB-STAIRTOP | box (platform) | x[60,68] z[14,20], top 1.2 | reached by TB-STAIRBANK |
 * | TB-STAIRBANK | bank | x[68,74] z[14,20] | 1.2 at x 68 down to 0 at x 74 |
 * | TB-STAIRS | stairs | x[60,68] z[20,24.8] | 6 steps, drop 1.2, down south |
 * | TB-HANDRAIL | rail (handrail pipe) | (60.3, 20, 2.1) -> (60.3, 24.8, 0.9) | over the stairs' west side |
 * | TB-WALL | box (wall) | x[64,65] z[36,56], h 3 | west face at x 64 for head-on bails heading east |
 *
 * Gap: TB-G01 "SPINE TRANSFER" (transferOn TB-SPINE-W / TB-SPINE-E). Decal TB-ARROW on the floor at
 * (40, 50). No letters, MacGuffin, NPCs or goals (test level).
 */

import { xzy } from '../core/math';
import type { LevelDef } from './types';

export const TEST_BOX_KNOWN_RAIL_ID = 'TB-RAIL';

export const TEST_BOX: LevelDef = {
  id: 'testBox',
  name: 'Test Box',
  size: { x: 80, z: 60 },
  environment: 'testGrid',
  spawn: { pos: xzy(40, 46, 0), facing: 'north' },
  spawnArea: { x0: 30, z0: 42, x1: 50, z1: 52 },
  primitives: [
    { kind: 'ground', id: 'TB-FLOOR', rect: { x0: 0, z0: 0, x1: 80, z1: 60 }, y: 0, material: 'concrete' },
    { kind: 'ledge', id: 'TB-LEDGE', rect: { x0: 46, z0: 18, x1: 46.6, z1: 34 }, topY: 0.45, material: 'granite' },
    { kind: 'box', id: 'TB-PAD', rect: { x0: 52, z0: 24, x1: 56, z1: 34 }, y0: 0, height: 0.15 },
    {
      kind: 'quarterPipe', id: 'TB-VERT', facing: 'south', footLine: 7, copingLine: 4, span: [24, 40],
      copingHeight: 3.6, radius: 3.0, vertExt: 0.6, deckDepth: 2, copingRailId: 'TB-VERT-C', material: 'maple',
    },
    {
      kind: 'quarterPipe', id: 'TB-MINI', facing: 'south', footLine: 5.8, copingLine: 4, span: [44, 56],
      copingHeight: 1.5, radius: 1.8, deckDepth: 2, copingRailId: 'TB-MINI-C', material: 'maple',
    },
    { kind: 'bank', id: 'TB-BANK', rect: { x0: 4, z0: 20, x1: 10, z1: 30 }, yHigh: 1.2, yLow: 0, downhill: 'east' },
    { kind: 'kicker', id: 'TB-KICK', rect: { x0: 20, z0: 38, x1: 22, z1: 42 }, height: 0.6, up: 'west', material: 'maple' },
    {
      kind: 'spine', id: 'TB-SPINE', axis: 'z', centre: 14, span: [10, 22], copingHeight: 1.8, radius: 2.2, gapWidth: 0.4,
      copingRailIds: ['TB-SPINE-W', 'TB-SPINE-E'], material: 'maple',
    },
    { kind: 'box', id: 'TB-STAIRTOP', rect: { x0: 60, z0: 14, x1: 68, z1: 20 }, y0: 0, height: 1.2 },
    { kind: 'bank', id: 'TB-STAIRBANK', rect: { x0: 68, z0: 14, x1: 74, z1: 20 }, yHigh: 1.2, yLow: 0, downhill: 'east' },
    { kind: 'stairs', id: 'TB-STAIRS', rect: { x0: 60, z0: 20, x1: 68, z1: 24.8 }, topY: 1.2, drop: 1.2, steps: 6, down: 'south' },
    { kind: 'railPipe', id: 'TB-HANDRAIL-PIPE', railId: 'TB-HANDRAIL', style: 'handrail' },
    { kind: 'box', id: 'TB-WALL', rect: { x0: 64, z0: 36, x1: 65, z1: 56 }, y0: 0, height: 3, material: 'brick' },
  ],
  rails: [
    { id: 'TB-RAIL', kind: 'rail', points: [xzy(40, 40, 0.55), xzy(40, 20, 0.55)], name: 'Test Rail' },
    { id: 'TB-LEDGE', kind: 'ledge', points: [xzy(46.3, 34, 0.45), xzy(46.3, 18, 0.45)], name: 'Test Ledge' },
    { id: 'TB-VERT-C', kind: 'coping', points: [xzy(24, 4, 3.6), xzy(40, 4, 3.6)], name: 'Vert Coping' },
    { id: 'TB-MINI-C', kind: 'coping', points: [xzy(44, 4, 1.5), xzy(56, 4, 1.5)], name: 'Mini Coping' },
    {
      id: 'TB-SPINE-W', kind: 'coping', points: [xzy(13.8, 10, 1.8), xzy(13.8, 22, 1.8)], name: 'Spine West',
      tags: ['transfer'], transferPlane: { axis: 'x', at: 14 },
    },
    {
      id: 'TB-SPINE-E', kind: 'coping', points: [xzy(14.2, 10, 1.8), xzy(14.2, 22, 1.8)], name: 'Spine East',
      tags: ['transfer'], transferPlane: { axis: 'x', at: 14 },
    },
    { id: 'TB-HANDRAIL', kind: 'rail', points: [xzy(60.3, 20, 2.1), xzy(60.3, 24.8, 0.9)], name: 'Stair Handrail' },
  ],
  gaps: [{ id: 'TB-G01', name: 'SPINE TRANSFER', base: 500, rule: { kind: 'transferOn', rails: ['TB-SPINE-W', 'TB-SPINE-E'] } }],
  letters: [],
  macguffin: null,
  npcs: [],
  goals: [],
  decals: [{ id: 'TB-ARROW', kind: 'arrow', center: xzy(40, 50, 0), on: 'up', width: 1.2, height: 2.4 }],
  feeds: [],
};
