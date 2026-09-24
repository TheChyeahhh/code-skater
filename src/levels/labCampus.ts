/**
 * src/levels/labCampus.ts: LEVEL C, LAB CAMPUS (founder request 2026-09-23; the "lab-campus park"
 * of SPEC §18's Later column). A research campus after dark, 100 x 90 m, flat at y 0 except the
 * server deck. Coordinates (x east, z south, y up) go through xzy(x, z, y) like the other parks.
 *
 *   z 0..8     north: the glass atrium (west) and the lab tower (east), neon banners between them
 *   z 10..24   the server deck (y 1.2): banks up at both ends, grindable lip, a 5-step set with two
 *              handrails down the middle
 *   z 26..70   the quad: three server-rack ledges (west), the reflecting pool (a mini-vert fountain,
 *              centre), flatbars and a funbox (east), a long quarter-pipe on the east wall and a
 *              shorter one on the west wall
 *   z 74       the cable tray: a 48 m flatbar across the whole campus
 *   z 78..88   spawn, facing north up the campus
 *
 * Lines: (1) spawn -> ollie onto the cable tray -> ride it out -> manual into the quad;
 * (2) server racks: grind one, hop to the next (RACK HOP) and grab the C over the middle rack;
 * (3) pool: carve the reflecting pool and transfer across it (POOL TRANSFER), the O over its north rim;
 * (4) deck: bank up, grind the lip, drop the stair set (DECK DROP, the D over the steps) or take the
 * handrails; the E hangs in the air over the east quarter-pipe.
 * No MacGuffin and no NPC: the campus is a free-skate and score park.
 */

import { xzy } from '../core/math';
import type { Vec3 } from '../core/types';
import type { GoalDef } from '../data/goals';
import type { GapDef, LevelDef, Primitive, RailDef } from './types';

export const POOL_CENTRE = { x: 50, z: 50 } as const;
const POOL_RIM_RADIUS = 3.5;
const POOL_RIM_Y = 1.2;
const POOL_RIM_POINTS = 24;
const DECK_Y = 1.2;
const RACK_X = [12, 18, 24] as const;
const RACK_TOP = 0.9;
const PLANTER_TOP = 0.5;
/** Planter ledges around the pool: id, x0, z0, x1, z1 (0.6 m wide, rail on the centreline). */
const PLANTERS: readonly (readonly [string, number, number, number, number])[] = [
  ['LC-PL1', 40, 38.7, 46, 39.3],
  ['LC-PL2', 54, 38.7, 60, 39.3],
  ['LC-PL3', 40, 60.7, 46, 61.3],
  ['LC-PL4', 54, 60.7, 60, 61.3],
];

/** A closed polygon of n points on a circle at height y, first point repeated last (closed rails repeat it). */
function circle(centre: { readonly x: number; readonly z: number }, radius: number, y: number, n: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * (i % n)) / n;
    pts.push({ x: Math.round((centre.x + radius * Math.cos(a)) * 1000) / 1000, y, z: Math.round((centre.z + radius * Math.sin(a)) * 1000) / 1000 });
  }
  return pts;
}

export const LAB_CAMPUS_GOALS: readonly GoalDef[] = [
  { id: 'LC-GOAL-01', levelId: 'labCampus', index: 1, name: 'High Score', condition: { kind: 'runScore', threshold: 'CAMPUS_HIGH_SCORE' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-02', levelId: 'labCampus', index: 2, name: 'Pro Score', condition: { kind: 'runScore', threshold: 'CAMPUS_PRO_SCORE' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-03', levelId: 'labCampus', index: 3, name: 'Sick Score', condition: { kind: 'runScore', threshold: 'CAMPUS_SICK_SCORE' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-04', levelId: 'labCampus', index: 4, name: 'High Combo', condition: { kind: 'comboScore', threshold: 'CAMPUS_HIGH_COMBO' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-05', levelId: 'labCampus', index: 5, name: 'C-O-D-E', condition: { kind: 'letters' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-06', levelId: 'labCampus', index: 6, name: 'Hop the Server Racks', condition: { kind: 'gapInBankedCombo', gapId: 'LC-G01' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-07', levelId: 'labCampus', index: 7, name: 'Grind the Cable Tray', condition: { kind: 'gapInBankedCombo', gapId: 'LC-G02' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-08', levelId: 'labCampus', index: 8, name: 'Transfer the Pool', condition: { kind: 'gapInBankedCombo', gapId: 'LC-G03' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-09', levelId: 'labCampus', index: 9, name: 'Drop the Deck Stairs', condition: { kind: 'gapInBankedCombo', gapId: 'LC-G04' }, reqId: 'REQ-GOL-01' },
  { id: 'LC-GOAL-10', levelId: 'labCampus', index: 10, name: '2 grind-manuals in one combo', condition: { kind: 'sequenceInCombo', first: 'grind', then: 'manual', count: 'CAMPUS_GRIND_MANUALS' }, reqId: 'REQ-GOL-01' },
];

const PRIMITIVES: readonly Primitive[] = [
  { kind: 'ground', id: 'LC-FL', rect: { x0: 0, z0: 0, x1: 100, z1: 90 }, y: 0, material: 'granite' },

  // North: the glass atrium and the lab tower (collidable dressing).
  { kind: 'building', id: 'LC-ATRIUM', rect: { x0: 0, z0: 0, x1: 30, z1: 8 }, height: 18, style: 'glassTower' },
  { kind: 'building', id: 'LC-TOWER', rect: { x0: 70, z0: 0, x1: 100, z1: 8 }, height: 30, style: 'glassTower' },
  { kind: 'billboard', id: 'LC-BB1', rect: { x0: 34, z0: 0.4, x1: 46, z1: 1 }, y0: 4.5, height: 3, face: 'south', brand: 'labA', material: 'neon' },
  { kind: 'billboard', id: 'LC-BB2', rect: { x0: 54, z0: 0.4, x1: 66, z1: 1 }, y0: 4.5, height: 3, face: 'south', brand: 'labB', material: 'neon' },

  // The server deck: a raised metal platform, grindable along its south lip either side of the stairs.
  {
    kind: 'box', id: 'LC-DECK', rect: { x0: 34, z0: 10, x1: 66, z1: 20 }, y0: 0, height: DECK_Y, material: 'metalPanel',
    grindable: [
      { a: xzy(34, 20, DECK_Y), b: xzy(48, 20, DECK_Y) },
      { a: xzy(52, 20, DECK_Y), b: xzy(66, 20, DECK_Y) },
    ],
  },
  { kind: 'bank', id: 'LC-BK1', rect: { x0: 28, z0: 10, x1: 34, z1: 20 }, yHigh: DECK_Y, yLow: 0, downhill: 'west', material: 'concrete' },
  { kind: 'bank', id: 'LC-BK2', rect: { x0: 66, z0: 10, x1: 72, z1: 20 }, yHigh: DECK_Y, yLow: 0, downhill: 'east', material: 'concrete' },
  { kind: 'stairs', id: 'LC-ST', rect: { x0: 48, z0: 20, x1: 52, z1: 24 }, topY: DECK_Y, drop: DECK_Y, steps: 5, down: 'south', material: 'concrete' },
  { kind: 'railPipe', id: 'LC-HR1-P', railId: 'LC-HR1', style: 'handrail' },
  { kind: 'railPipe', id: 'LC-HR2-P', railId: 'LC-HR2', style: 'handrail' },

  // The quad: server racks (west), the reflecting pool (centre), flatbars and a funbox (east).
  ...RACK_X.map((x, i): Primitive => ({ kind: 'ledge', id: `LC-RK${i + 1}`, rect: { x0: x - 0.3, z0: 30, x1: x + 0.3, z1: 50 }, topY: RACK_TOP, material: 'metalPanel' })),
  {
    kind: 'fountain', id: 'LC-POOL', centre: POOL_CENTRE, footRadius: 5.0, faceRadius: 1.5, rimRadius: POOL_RIM_RADIUS,
    rimHeight: POOL_RIM_Y, basinY: 0.9, copingRailId: 'LC-POOL-C', material: 'granite',
  },
  { kind: 'railPipe', id: 'LC-FB1-P', railId: 'LC-FB1', style: 'flatbar', posts: true },
  { kind: 'railPipe', id: 'LC-FB2-P', railId: 'LC-FB2', style: 'flatbar', posts: true },
  { kind: 'funbox', id: 'LC-FX', rect: { x0: 70, z0: 44, x1: 80, z1: 52 }, height: 0.8, rampRunM: 1.6, ramps: ['east', 'west'], material: 'concrete' },

  // More to skate in the quad: a pyramid (south-east), a bank-to-bank (south-west) and four granite
  // planters around the pool, each with a ledge rail on its top.
  { kind: 'pyramid', id: 'LC-PY', rect: { x0: 62, z0: 56, x1: 72, z1: 66 }, height: 1.0, rampRunM: 3.0, material: 'concrete' },
  { kind: 'bank', id: 'LC-BBW', rect: { x0: 8, z0: 56, x1: 14, z1: 68 }, yHigh: 1.0, yLow: 0, downhill: 'east', material: 'concrete' },
  { kind: 'bank', id: 'LC-BBE', rect: { x0: 22, z0: 56, x1: 28, z1: 68 }, yHigh: 1.0, yLow: 0, downhill: 'west', material: 'concrete' },
  ...PLANTERS.map(([id, x0, z0, x1, z1]): Primitive => ({ kind: 'ledge', id, rect: { x0, z0, x1, z1 }, topY: PLANTER_TOP, material: 'granite' })),

  // Quarter-pipes: a long one on the east wall, a shorter one on the west wall.
  { kind: 'quarterPipe', id: 'LC-Q1', facing: 'west', footLine: 94.0, copingLine: 96.7, span: [26, 70], copingHeight: 2.4, radius: 2.7, copingRailId: 'LC-Q1-C', material: 'concrete' },
  { kind: 'quarterPipe', id: 'LC-Q2', facing: 'east', footLine: 2.7, copingLine: 0, span: [54, 72], copingHeight: 2.4, radius: 2.7, copingRailId: 'LC-Q2-C', material: 'concrete' },

  // The cable tray across the campus.
  { kind: 'railPipe', id: 'LC-CT-P', railId: 'LC-CT', style: 'flatbar', posts: true },

  // Lamps (render only).
  { kind: 'prop', id: 'LC-LAMP1', prop: 'lamp', at: xzy(30, 66, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'LC-LAMP2', prop: 'lamp', at: xzy(70, 66, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'LC-LAMP3', prop: 'lamp', at: xzy(30, 28, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'LC-LAMP4', prop: 'lamp', at: xzy(70, 28, 0), size: xzy(0.3, 0.3, 6), collidable: false },
];

const RAILS: readonly RailDef[] = [
  { id: 'LC-DE1', kind: 'ledge', points: [xzy(34, 20, DECK_Y), xzy(48, 20, DECK_Y)], name: 'Deck Lip West' },
  { id: 'LC-DE2', kind: 'ledge', points: [xzy(52, 20, DECK_Y), xzy(66, 20, DECK_Y)], name: 'Deck Lip East' },
  { id: 'LC-HR1', kind: 'rail', points: [xzy(48.3, 20, 2.1), xzy(48.3, 24, 0.9)], name: 'Deck Handrail West' },
  { id: 'LC-HR2', kind: 'rail', points: [xzy(51.7, 20, 2.1), xzy(51.7, 24, 0.9)], name: 'Deck Handrail East' },
  ...RACK_X.map((x, i): RailDef => ({ id: `LC-RK${i + 1}`, kind: 'ledge', points: [xzy(x, 30, RACK_TOP), xzy(x, 50, RACK_TOP)], name: `Server Rack ${i + 1}` })),
  { id: 'LC-POOL-C', kind: 'coping', points: circle(POOL_CENTRE, POOL_RIM_RADIUS, POOL_RIM_Y, POOL_RIM_POINTS), closed: true, name: 'Pool Rim' },
  ...PLANTERS.map(([id, x0, z0, x1, z1]): RailDef => ({ id, kind: 'ledge', points: [xzy(x0, (z0 + z1) / 2, PLANTER_TOP), xzy(x1, (z0 + z1) / 2, PLANTER_TOP)], name: 'Pool Planter' })),
  { id: 'LC-FB1', kind: 'rail', points: [xzy(60, 32, 0.5), xzy(72, 32, 0.5)], name: 'East Flatbar' },
  { id: 'LC-FB2', kind: 'rail', points: [xzy(31, 65, 0.5), xzy(42, 65, 0.5)], name: 'West Flatbar' },
  { id: 'LC-Q1-C', kind: 'coping', points: [xzy(96.7, 26, 2.4), xzy(96.7, 70, 2.4)], name: 'East Quarter Coping' },
  { id: 'LC-Q2-C', kind: 'coping', points: [xzy(0, 54, 2.4), xzy(0, 72, 2.4)], name: 'West Quarter Coping' },
  { id: 'LC-CT', kind: 'rail', points: [xzy(26, 74, 0.9), xzy(74, 74, 0.9)], name: 'Cable Tray' },
];

const GAPS: readonly GapDef[] = [
  { id: 'LC-G01', name: 'RACK HOP', base: 400, rule: { kind: 'grindSequence', steps: [['LC-RK1', 'LC-RK3'], ['LC-RK2']], noGroundContact: true } },
  { id: 'LC-G02', name: 'CABLE TRAY', base: 500, rule: { kind: 'grindDistance', rails: ['LC-CT'], minM: 30 } },
  { id: 'LC-G03', name: 'POOL TRANSFER', base: 600, rule: { kind: 'surfaceAzimuth', surface: 'LC-POOL', centre: POOL_CENTRE, minDeltaDeg: 45 } },
  { id: 'LC-G04', name: 'DECK DROP', base: 300, rule: { kind: 'airBoxToBox', start: { x: [34, 66], y: [DECK_Y - 0.1, Infinity], z: [10, 20.5] }, land: { y: [-0.1, 0.2], z: [24, Infinity] } } },
  { id: 'LC-G05', name: 'DECK HANDRAIL', base: 350, rule: { kind: 'grindDistance', rails: ['LC-HR1', 'LC-HR2'], minM: 3 } },
];

export const LAB_CAMPUS: LevelDef = {
  id: 'labCampus',
  name: 'Lab Campus',
  size: { x: 100, z: 90 },
  environment: 'campusNight',
  spawn: { pos: xzy(50, 84, 0), facing: 'north' },
  spawnArea: { x0: 42, z0: 78, x1: 58, z1: 88 },
  primitives: PRIMITIVES,
  rails: RAILS,
  gaps: GAPS,
  letters: [
    { letter: 'C', pos: xzy(18, 40, 2.7) },
    { letter: 'O', pos: xzy(50, 46.5, 3.0) },
    { letter: 'D', pos: xzy(50, 23, 3.2) },
    { letter: 'E', pos: xzy(95.8, 48, 5.6) },
  ],
  macguffin: null,
  npcs: [],
  goals: LAB_CAMPUS_GOALS,
  decals: [
    // Painted campus paths: a north-south strip up the middle and an east-west strip under the deck.
    { id: 'LC-DC1', kind: 'paint', center: xzy(50, 69, 0), on: 'up', width: 3, height: 8 },
    { id: 'LC-DC2', kind: 'paint', center: xzy(50, 28, 0), on: 'up', width: 30, height: 2 },
    { id: 'LC-DC3', kind: 'arrow', center: xzy(50, 80, 0), on: 'up', width: 2, height: 3 },
  ],
  feeds: [],
};
