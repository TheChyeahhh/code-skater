/**
 * tests/fixtures/levels/allKinds.ts (levels track): a kitchen-sink LevelDef with every primitive
 * kind, every rail pipe style, letters, a MacGuffin, an NPC, decals, a gap and a feed. It is VALID
 * (validateLevel returns []), so tests can break one thing at a time and watch the right rule fire.
 * The dev harness shows it with dev/levels.html?fixture=allKinds.
 *
 * Coping rails of the curved primitives are taken from the same derivation the builder uses
 * (lib/grindLines.ts) because hand-typing a 64-point fountain rim is error-prone; the test box
 * (src/levels/testBox.ts) covers hand-authored copings.
 *
 * Deliberately NOT authored (the builder must emit them): the funbox's two deck edges without a
 * ramp, "LB-FUN:edge-north" and "LB-FUN:edge-south".
 */

import { xzy } from '../../../src/core/math';
import type { Vec3 } from '../../../src/core/types';
import { grindLinesOf } from '../../../src/levels/lib/grindLines';
import type { LevelDef, Primitive, RailDef } from '../../../src/levels/types';

const EMPTY: LevelDef = {
  id: 'testBox', name: 'x', size: { x: 1, z: 1 }, environment: 'testGrid', spawn: { pos: xzy(0, 0, 0), facing: 'north' },
  spawnArea: { x0: 0, z0: 0, x1: 1, z1: 1 }, primitives: [], rails: [], gaps: [], letters: [], macguffin: null, npcs: [],
  goals: [], decals: [], feeds: [],
};

/** The builder's own grind line `key` of primitive p, as rail points. */
function lineOf(p: Primitive, key: string): Vec3[] {
  const line = grindLinesOf(p, EMPTY).find((l) => l.key === key);
  if (!line) throw new Error(`fixture: no grind line ${key} on ${p.id}`);
  return line.points.map((q) => ({ ...q }));
}

const BOWL: Primitive = { kind: 'bowl', id: 'LB-BOWL', rect: { x0: 6, z0: 6, x1: 26, z1: 26 }, depth: 2.4, wallRadius: 2.4, cornerRadius: 3, copingRailId: 'LB-BOWL-C' };
const FOUNTAIN: Primitive = {
  kind: 'fountain', id: 'LB-FOUNT', centre: { x: 40, z: 16 }, footRadius: 4.5, faceRadius: 1.5, rimRadius: 3, rimHeight: 1.2,
  basinY: 0.3, copingRailId: 'LB-FOUNT-C', material: 'granite',
};
const SNAKE: Primitive = {
  kind: 'channel', id: 'LB-SNAKE', centreline: [{ x: 8, z: 40 }, { x: 28, z: 40 }, { x: 38, z: 50 }], width: 5, floorY: -1.2,
  wallRadius: 1.5, wallHeight: 1.2, openEndRampM: 3, rimRailIds: ['LB-SNAKE-L', 'LB-SNAKE-R'],
};
const QP_WEST: Primitive = {
  kind: 'quarterPipe', id: 'LB-QPW', facing: 'west', footLine: 95.3, copingLine: 98, span: [30, 50], copingHeight: 2.4, radius: 2.7,
  deckDepth: 2, copingRailId: 'LB-QPW-C',
};
const QP_NORTH: Primitive = {
  kind: 'quarterPipe', id: 'LB-QPN', facing: 'north', footLine: 75.3, copingLine: 78, span: [4, 20], copingHeight: 2.4, radius: 2.7,
  deckDepth: 2, copingRailId: 'LB-QPN-C',
};
const SPINE: Primitive = {
  kind: 'spine', id: 'LB-SPINE', axis: 'x', centre: 34, span: [44, 58], copingHeight: 2.0, radius: 2.4, gapWidth: 0.5,
  copingRailIds: ['LB-SPINE-N', 'LB-SPINE-S'], peakRailId: 'LB-SPINE-P',
};

const RAINBOW: RailDef = {
  id: 'LB-RAINBOW', kind: 'rail', name: 'Rainbow',
  points: [xzy(62, 30, 0.5), xzy(65, 30, 1.1), xzy(68, 30, 1.4), xzy(71, 30, 1.1), xzy(74, 30, 0.5)],
};

export const ALL_KINDS: LevelDef = {
  id: 'testBox',
  name: 'All Kinds Lab',
  size: { x: 100, z: 80 },
  environment: 'woodshedInterior',
  spawn: { pos: xzy(50, 70, 0), facing: 'north' },
  spawnArea: { x0: 40, z0: 66, x1: 60, z1: 76 },
  primitives: [
    { kind: 'ground', id: 'LB-FLOOR', rect: { x0: 0, z0: 0, x1: 100, z1: 80 }, y: 0 },
    BOWL,
    FOUNTAIN,
    { kind: 'fullPipe', id: 'LB-PIPE', a: xzy(55, 16, 4), b: xzy(80, 16, 4), radius: 4 },
    SNAKE,
    { kind: 'euroGap', id: 'LB-EURO', rect: { x0: 60, z0: 40, x1: 62.4, z1: 50 }, floorY: -0.6, bankRunM: 0.6, across: 'x' },
    { kind: 'hump', id: 'LB-HUMP', rect: { x0: 66, z0: 40, x1: 74, z1: 48 }, ridgeAxis: 'x', height: 0.8 },
    { kind: 'funbox', id: 'LB-FUN', rect: { x0: 80, z0: 36, x1: 86, z1: 40 }, height: 0.8, rampRunM: 2, ramps: ['west', 'east'] },
    { kind: 'pyramid', id: 'LB-PYR', rect: { x0: 80, z0: 50, x1: 84, z1: 54 }, height: 1, rampRunM: 2 },
    { kind: 'box', id: 'LB-PLAT', rect: { x0: 44, z0: 57, x1: 50, z1: 63 }, y0: 0, height: 1.4 },
    { kind: 'hubba', id: 'LB-HUBBA', rect: { x0: 50, z0: 58, x1: 54, z1: 58.4 }, yTop: 1.4, yKink: 0.4, kinkAt: 52.5, yEnd: 0.4, along: 'east' },
    { kind: 'stairs', id: 'LB-STAIRS', rect: { x0: 50, z0: 58.6, x1: 52.5, z1: 62.6 }, topY: 1.4, drop: 1.4, steps: 5, down: 'east' },
    { kind: 'ledge', id: 'LB-LEDGE', rect: { x0: 30, z0: 64, x1: 38, z1: 64.5 }, topY: 0.5 },
    { kind: 'box', id: 'LB-STEP', rect: { x0: 26, z0: 68, x1: 32, z1: 72 }, y0: 0, height: 0.5, grindable: true },
    { kind: 'bank', id: 'LB-BANK', rect: { x0: 86, z0: 60, x1: 92, z1: 66 }, yHigh: 1.5, yLow: 0, downhill: 'south' },
    { kind: 'kicker', id: 'LB-KICK', rect: { x0: 66, z0: 60, x1: 68, z1: 62 }, height: 0.5, up: 'north' },
    QP_WEST,
    QP_NORTH,
    SPINE,
    { kind: 'building', id: 'LB-TOWER', rect: { x0: 88, z0: 2, x1: 98, z1: 12 }, height: 11, style: 'glassTower' },
    { kind: 'building', id: 'LB-BOOTH', rect: { x0: 70, z0: 66, x1: 74, z1: 70 }, height: 1.2, style: 'booth' },
    { kind: 'billboard', id: 'LB-BB', rect: { x0: 76, z0: 74, x1: 82, z1: 74.4 }, y0: 2, height: 2, face: 'north', brand: 'labA' },
    { kind: 'prop', id: 'LB-LAMP', prop: 'lamp', at: xzy(62, 72, 0), size: xzy(0.3, 0.3, 4), collidable: false },
    { kind: 'prop', id: 'LB-PLANTER', prop: 'planter', at: xzy(36, 74, 0), size: xzy(2, 1, 0.6), collidable: true, yawDeg: 30 },
    { kind: 'prop', id: 'LB-TRUSS', prop: 'trusses', at: xzy(50, 40, 8), size: xzy(20, 12, 1), collidable: false },
    { kind: 'railPipe', id: 'LB-RAINBOW-PIPE', railId: 'LB-RAINBOW', style: 'rainbow' },
    { kind: 'railPipe', id: 'LB-SCAF-PIPE', railId: 'LB-SCAF', style: 'scaffold' },
    { kind: 'railPipe', id: 'LB-WALLR-PIPE', railId: 'LB-WALLR', style: 'wallMounted' },
  ],
  rails: [
    { id: 'LB-BOWL-C', kind: 'coping', points: lineOf(BOWL, 'coping'), closed: true, name: 'Bowl Coping' },
    { id: 'LB-FOUNT-C', kind: 'coping', points: lineOf(FOUNTAIN, 'coping'), closed: true, name: 'Fountain Rim' },
    { id: 'LB-SNAKE-L', kind: 'coping', points: lineOf(SNAKE, 'rim-left') },
    { id: 'LB-SNAKE-R', kind: 'coping', points: lineOf(SNAKE, 'rim-right') },
    { id: 'LB-QPW-C', kind: 'coping', points: [xzy(98, 30, 2.4), xzy(98, 50, 2.4)] },
    { id: 'LB-QPN-C', kind: 'coping', points: [xzy(4, 78, 2.4), xzy(20, 78, 2.4)] },
    { id: 'LB-SPINE-N', kind: 'coping', points: [xzy(44, 33.75, 2.0), xzy(58, 33.75, 2.0)], tags: ['transfer'], transferPlane: { axis: 'z', at: 34 } },
    { id: 'LB-SPINE-S', kind: 'coping', points: [xzy(44, 34.25, 2.0), xzy(58, 34.25, 2.0)], tags: ['transfer'], transferPlane: { axis: 'z', at: 34 } },
    { id: 'LB-SPINE-P', kind: 'rail', points: [xzy(46, 34, 2.35), xzy(56, 34, 2.35)] },
    { id: 'LB-HUBBA', kind: 'ledge', points: [xzy(50, 58.2, 1.4), xzy(52.5, 58.2, 0.4), xzy(54, 58.2, 0.4)] },
    { id: 'LB-LEDGE', kind: 'ledge', points: [xzy(30, 64.25, 0.5), xzy(38, 64.25, 0.5)] },
    { id: 'LB-STEP-W', kind: 'ledge', points: [xzy(26, 68, 0.5), xzy(26, 72, 0.5)] },
    { id: 'LB-STEP-S', kind: 'ledge', points: [xzy(26, 72, 0.5), xzy(32, 72, 0.5)] },
    { id: 'LB-STEP-E', kind: 'ledge', points: [xzy(32, 72, 0.5), xzy(32, 68, 0.5)] },
    { id: 'LB-STEP-N', kind: 'ledge', points: [xzy(32, 68, 0.5), xzy(26, 68, 0.5)] },
    RAINBOW,
    { id: 'LB-SCAF', kind: 'rail', points: [xzy(84, 22, 1.0), xzy(84, 30, 1.6)] },
    { id: 'LB-WALLR', kind: 'rail', points: [xzy(99.7, 56, 1.0), xzy(99.7, 66, 1.0)] },
    { id: 'LB-FA', kind: 'rail', points: [xzy(8, 60, 0.55), xzy(18, 60, 0.55)], name: 'Feed Bar A' },
    { id: 'LB-FB', kind: 'rail', points: [xzy(21, 60, 1.2), xzy(28, 60, 1.2)], name: 'Feed Bar B' },
  ],
  gaps: [{ id: 'LB-G01', name: 'EURO HOP', base: 300, rule: { kind: 'airBoxToBox', start: { x: [56, 60], z: [40, 50] }, land: { x: [62.4, 66], z: [40, 50] }, eitherDirection: true } }],
  letters: [
    { letter: 'C', pos: xzy(16, 16, 1.6) },
    { letter: 'O', pos: xzy(61.2, 45, 1.8) },
    { letter: 'D', pos: xzy(67, 16, 6.5) },
    { letter: 'E', pos: xzy(84, 26, 2.4) },
  ],
  macguffin: { id: 'secret_drive', pos: xzy(51, 34, 3.2) },
  npcs: [{ id: 'dario', pos: xzy(72, 71, 0), facing: 'north', outfit: 'contestJacket', prop: 'coffee' }],
  goals: [],
  decals: [
    { id: 'LB-WATER', kind: 'water', center: xzy(40, 16, 0.3), on: 'up', width: 3.2, height: 3.2 },
    { id: 'LB-ARROW', kind: 'arrow', center: xzy(50, 66, 0), on: 'up', width: 1, height: 2, rotDeg: 15 },
    { id: 'LB-TAG', kind: 'graffiti', center: xzy(47, 57, 0.7), on: 'north', width: 3, height: 1 },
  ],
  feeds: [{ from: 'LB-FA', to: 'LB-FB', exitSpeed: 7, pop: 'full' }],
};
