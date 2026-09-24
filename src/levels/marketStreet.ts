/**
 * src/levels/marketStreet.ts (street track): MARKET STREET as data, transcribed from DESIGN G.1
 * (REQ-STR-01..07) and reworked after the line-design review: feature table -> primitives, rail
 * table -> rails, named gaps MS-G01..G12, letters C-O-D-E, SAM, the Laptop, the 10 goals, decals,
 * and the listed feeds for REQ-LVL-06. Coordinates are (x, z, y) through xzy(): x east, z south,
 * y up, origin at the north-west corner. Every name reads from BRANDS at runtime (NpcDef.id,
 * BillboardPrim.brand, DecalDef.brand, GoalDef.nameFromMacGuffin); no em dashes anywhere (REQ-NPC-04).
 *
 * Layout (120 x 120 m, late afternoon), north to south:
 *   z 0..20    three glass towers (A / B / C) with two lower connectors closing the gaps
 *   z 20..40   the north terrace, y 0.8: spawn, SAM just ahead of it, two planter ledges that feed
 *              the hubbas, the terrace ledges L3 / L3W, the hubba tops
 *   z 40..43.2 banks B1 / B2 / B5 down to the plaza, stairs S1 between the hubbas L1 / L2
 *   z 42..86   the plaza, y 0: flat bars R1 / R10 under the hubbas, fountain F1, ledges L4 / L5 / L9,
 *              bench R9, kicker K1, mini quarter Q4, quarter-pipe Q2 whose deck is the server-closet
 *              roof (EB, 2.4 m) with ledge R8; bus shelter and the bus stop bar R2 on the south edge
 *   x 88.5..104.7 the alley: loading dock D1 (ledges L6 / L10 / L11) plus its east step D2 with the
 *              bank D2B, dock quarter Q3 up to the dock roof, scaffold P1 / P2 / P3 0.4 m off the
 *              annex face (AX, 6 m) to the roof rails R7 / R12; R7 carries the Laptop
 *   z 86..104  stairs S2 with handrails R3 / R4 down to the street (y -1.2) and its crosswalk; depot
 *              DP (3.5 m) with vent pipe R6 and the billboard; the 5 m slot between depot and dock
 *              block DB is the Billboard Gap; mini quarter Q5 on the dock roof turns a landing around
 *   z 104..120 south curb bank B3, planter ledges, flat bar R11, the south quarter-pipe Q1 (48 m)
 *
 * Deviations from the G.1 tables, each for a geometric or flow reason (CHANGE-REQUESTs in the track
 * report): the plaza ground is authored as pieces around the stair landing box MS-S2L; the south
 * curb bank MS-B3 spans x[0,82] like the street; the depot's box starts at y -1.2; the south block
 * MS-SB stops at x 95; the stairs S1 meet the hubba faces (no 0.2 m slits); the hubba tops are 1.4
 * so they read from the terrace; the closet row ends at z 80 so the bus stop bar exits into the
 * alley instead of a wall; the annex face stands at x 104.7 so the scaffold pipes clear the air
 * collision sphere; L6 stops at the D2 step; the D letter hangs over the rim; SAM stands ahead of
 * the spawn; every collidable ledge-height prop carries a rail.
 *
 * Polish round 1 (sim-verified in tests/marketStreet.test.ts block 3): the kerb block MS-SOUTH-E and
 * the solid MS-T1E close the two pockets under the sidewalk floors that the curb banks' east ends
 * opened (a skater fell forever); the fountain moved from (52, 64) to (50.4, 66), onto the R1 bar
 * lane with 4 m of flat after the bar, so line 3 lands flat and climbs the fall line; MS-Q3's radius
 * went 2.7 -> 4.0 (lip 66 deg, under the vert-assist slope) so the dock roof pop works across a metre
 * of the face; O rose 5.0 -> 5.6 -> 6.1 (the CR-44 2.0 m full ollie) to sit in a charged Billboard Gap arc; line 1 runs on x 46 under the
 * C. Dressing: floor zones, south frontages, west storefront fronts, parked vans, crates, lamps, paint.
 *
 * Polish round 2 (sim-verified in block 3): the vent pipe MS-R6 moved z 94 -> 97, off the O lane, so a
 * charged Billboard Gap ollie lands before it can snap the pipe; MS-PL2 moved 2.25 m south (z 32.25..37.25)
 * so line 3's 2.5 m/s exit off the uphill hubba L2 reaches it.
 */

import { xzy } from '../core/math';
import type { Vec3 } from '../core/types';
import type { GoalDef } from '../data/goals';
import type { DecalDef, GapDef, LevelDef, Primitive, RailDef } from './types';

/** Fountain F1 centre and rim (DESIGN G.1: coping = 24-point circle, radius 3.5, y 1.2). */
export const FOUNTAIN_CENTRE = { x: 50.4, z: 66 } as const;
export const FOUNTAIN_RIM_RADIUS = 3.5;
export const FOUNTAIN_RIM_Y = 1.2;
const FOUNTAIN_RIM_POINTS = 24;

/** The annex face (west wall of MS-AX). The scaffold pipes stand SCAFFOLD_STANDOFF west of it. */
export const ANNEX_FACE_X = 104.7;
const SCAFFOLD_X = 104.3;
const ROOF_RAIL_X = 104.8;

/** A closed polygon of n points on the circle (centre, radius) at height y, first point repeated last. */
function circle(centre: { readonly x: number; readonly z: number }, radius: number, y: number, n: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * (i % n)) / n;
    // Round to mm so the repeated first point compares exactly (closed rails must repeat it).
    pts.push({ x: Math.round((centre.x + radius * Math.cos(a)) * 1000) / 1000, y, z: Math.round((centre.z + radius * Math.sin(a)) * 1000) / 1000 });
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Primitives (feature table)
// ---------------------------------------------------------------------------------------------

const PRIMITIVES: readonly Primitive[] = [
  // Ground pieces (non-overlapping; the street and its banks cut the pieces above them).
  // The plaza floor in material zones (polish round 1): a concrete storefront sidewalk on the west
  // edge, granite pavers around the fountain, brick at the bus stop, tile elsewhere. Same height, so
  // the zones are pure dressing.
  { kind: 'ground', id: 'MS-T1W', rect: { x0: 0, z0: 40, x1: 8, z1: 86 }, y: 0, material: 'concrete' },
  { kind: 'ground', id: 'MS-T1N', rect: { x0: 8, z0: 40, x1: 86.7, z1: 58.5 }, y: 0, material: 'plazaTile' },
  { kind: 'ground', id: 'MS-T1', rect: { x0: 8, z0: 58.5, x1: 43, z1: 86 }, y: 0, material: 'plazaTile' },
  { kind: 'ground', id: 'MS-T1F', rect: { x0: 43, z0: 58.5, x1: 58, z1: 74 }, y: 0, material: 'granite' },
  { kind: 'ground', id: 'MS-T1M', rect: { x0: 43, z0: 74, x1: 58, z1: 86 }, y: 0, material: 'plazaTile' },
  { kind: 'ground', id: 'MS-T1R', rect: { x0: 58, z0: 58.5, x1: 86.7, z1: 80 }, y: 0, material: 'plazaTile' },
  { kind: 'ground', id: 'MS-T1K', rect: { x0: 58, z0: 80, x1: 86.7, z1: 86 }, y: 0, material: 'brick' },
  // A solid block, not a floor: the curb bank MS-B4E's east end meets its wall instead of opening
  // into the pocket under the plaza and alley floors.
  { kind: 'box', id: 'MS-T1E', rect: { x0: 82, z0: 86, x1: 86.7, z1: 88 }, y0: -1.2, height: 1.2, material: 'plazaTile' },
  // The mouth between the closet row's south end and the depot: the bus stop bar exits through it into the alley.
  { kind: 'ground', id: 'MS-T1S', rect: { x0: 86.7, z0: 80, x1: 88.5, z1: 88 }, y: 0, material: 'concrete' },
  { kind: 'ground', id: 'MS-ALLEY', rect: { x0: 88.5, z0: 40, x1: ANNEX_FACE_X, z1: 88 }, y: 0, material: 'concrete' },
  { kind: 'ground', id: 'MS-PASS', rect: { x0: 90, z0: 88, x1: 95, z1: 104 }, y: 0, material: 'concrete' },
  { kind: 'ground', id: 'MS-SOUTH', rect: { x0: 0, z0: 106.4, x1: 95, z1: 118 }, y: 0, material: 'brick' },
  // Solid kerb block east of the curb bank MS-B3: the bank's east end meets its wall, so nothing
  // rolls off the bank into a pocket under the south sidewalk (the old ground piece had no body).
  { kind: 'box', id: 'MS-SOUTH-E', rect: { x0: 82, z0: 104, x1: 95, z1: 106.4 }, y0: -1.2, height: 1.2, material: 'brick' },
  { kind: 'ground', id: 'MS-ST', rect: { x0: 0, z0: 88, x1: 82, z1: 104 }, y: -1.2, material: 'asphalt' },

  // North terrace (marble, y 0.8): grindable only at the two step segments beside the hubbas (L7, L8).
  {
    kind: 'box', id: 'MS-T2', rect: { x0: 0, z0: 20, x1: 120, z1: 40 }, y0: 0, height: 0.8, material: 'marble',
    grindable: [
      { a: xzy(38, 40, 0.8), b: xzy(41.4, 40, 0.8) },
      { a: xzy(50.6, 40, 0.8), b: xzy(54, 40, 0.8) },
    ],
  },
  // Glass towers and the connectors that close the gaps between them (nothing leads north).
  { kind: 'building', id: 'MS-TA', rect: { x0: 0, z0: 0, x1: 36, z1: 20 }, height: 40, style: 'glassTower' },
  { kind: 'building', id: 'MS-TB', rect: { x0: 44, z0: 0, x1: 84, z1: 20 }, height: 48, style: 'glassTower' },
  { kind: 'building', id: 'MS-TC', rect: { x0: 90, z0: 0, x1: 120, z1: 20 }, height: 36, style: 'glassTower' },
  { kind: 'building', id: 'MS-TG1', rect: { x0: 36, z0: 0, x1: 44, z1: 20 }, height: 20, style: 'block' },
  { kind: 'building', id: 'MS-TG2', rect: { x0: 84, z0: 0, x1: 90, z1: 20 }, height: 20, style: 'block' },

  // Terrace edge: banks, the stair set S1 flush with the two marble hubbas, the terrace ledges.
  { kind: 'bank', id: 'MS-B1', rect: { x0: 0, z0: 40, x1: 38, z1: 42.4 }, yHigh: 0.8, yLow: 0, downhill: 'south', material: 'plazaTile' },
  { kind: 'stairs', id: 'MS-S1', rect: { x0: 41.8, z0: 40, x1: 50.2, z1: 43.2 }, topY: 0.8, drop: 0.8, steps: 4, down: 'south', material: 'marble' },
  { kind: 'hubba', id: 'MS-L1', rect: { x0: 41.4, z0: 38, x1: 41.8, z1: 46 }, yTop: 1.4, yKink: 0.4, kinkAt: 43.2, yEnd: 0.4, along: 'south', material: 'marble' },
  { kind: 'hubba', id: 'MS-L2', rect: { x0: 50.2, z0: 38, x1: 50.6, z1: 46 }, yTop: 1.4, yKink: 0.4, kinkAt: 43.2, yEnd: 0.4, along: 'south', material: 'marble' },
  { kind: 'bank', id: 'MS-B2', rect: { x0: 54, z0: 40, x1: 86.7, z1: 42.4 }, yHigh: 0.8, yLow: 0, downhill: 'south', material: 'plazaTile' },
  { kind: 'ledge', id: 'MS-L3', rect: { x0: 56, z0: 39.2, x1: 80, z1: 40 }, topY: 1.2, baseY: 0.8, material: 'marble' },
  { kind: 'ledge', id: 'MS-L3W', rect: { x0: 8, z0: 39.2, x1: 32, z1: 40 }, topY: 1.2, baseY: 0.8, material: 'marble' },
  { kind: 'bank', id: 'MS-B5', rect: { x0: 88.5, z0: 40, x1: ANNEX_FACE_X, z1: 42.4 }, yHigh: 0.8, yLow: 0, downhill: 'south', material: 'concrete' },

  // Plaza furniture.
  {
    kind: 'fountain', id: 'MS-F1', centre: FOUNTAIN_CENTRE, footRadius: 5.0, faceRadius: 1.5, rimRadius: FOUNTAIN_RIM_RADIUS,
    rimHeight: FOUNTAIN_RIM_Y, basinY: 0.9, copingRailId: 'MS-F1-C', material: 'granite',
  },
  { kind: 'ledge', id: 'MS-L4', rect: { x0: 24, z0: 73.8, x1: 36, z1: 74.2 }, topY: 0.45, material: 'granite' },
  { kind: 'ledge', id: 'MS-L5', rect: { x0: 68, z0: 51.8, x1: 80, z1: 52.2 }, topY: 0.45, material: 'granite' },
  { kind: 'ledge', id: 'MS-L9', rect: { x0: 12, z0: 59.8, x1: 24, z1: 60.2 }, topY: 0.45, material: 'granite' },
  { kind: 'ledge', id: 'MS-R9', rect: { x0: 3.8, z0: 50, x1: 4.2, z1: 70 }, topY: 0.45, material: 'granite' },
  // Kicker pointing at the bench ledge L4 (a full ollie off its lip reaches the ledge).
  { kind: 'kicker', id: 'MS-K1', rect: { x0: 28, z0: 62, x1: 34, z1: 66 }, height: 0.6, up: 'south', material: 'concrete' },
  { kind: 'quarterPipe', id: 'MS-Q4', facing: 'east', footLine: 1.8, copingLine: 0, span: [74, 86], copingHeight: 1.5, radius: 1.8, copingRailId: 'MS-Q4-C', material: 'concrete' },

  // Server-closet row: Q2's deck is its roof; the closet is narrow so a pop off Q2 clears it (ALLEY TRANSFER).
  // It ends at z 80 so the bus stop bar's east exit opens into the alley through MS-T1S.
  { kind: 'building', id: 'MS-EB', rect: { x0: 86.7, z0: 40, x1: 88.5, z1: 80 }, height: 2.4, style: 'closet', walkableRoof: true },
  { kind: 'quarterPipe', id: 'MS-Q2', facing: 'west', footLine: 84.0, copingLine: 86.7, span: [44, 78], copingHeight: 2.4, radius: 2.7, copingRailId: 'MS-Q2-C', material: 'concrete' },

  // The alley: loading dock with its east step, dock quarter up to the dock roof, server annex with the scaffold.
  {
    kind: 'box', id: 'MS-D1', rect: { x0: 95, z0: 70, x1: 101, z1: 88 }, y0: 0, height: 1.1, material: 'concrete',
    grindable: [
      { a: xzy(95, 70.5, 1.1), b: xzy(95, 83.8, 1.1) },
      { a: xzy(95.5, 70, 1.1), b: xzy(100.5, 70, 1.1) },
      { a: xzy(101, 70, 1.1), b: xzy(101, 80, 1.1) },
    ],
  },
  // The strip between the dock and the annex ends in a step up to the platform, not the dock block's wall.
  { kind: 'box', id: 'MS-D2', rect: { x0: 101, z0: 80, x1: ANNEX_FACE_X, z1: 88 }, y0: 0, height: 1.1, material: 'concrete' },
  { kind: 'bank', id: 'MS-D2B', rect: { x0: 101, z0: 76, x1: ANNEX_FACE_X, z1: 80 }, yHigh: 1.1, yLow: 0, downhill: 'north', material: 'concrete' },
  { kind: 'quarterPipe', id: 'MS-Q3', facing: 'north', footLine: 84.33, copingLine: 88, span: [95, 104.1], copingHeight: 2.4, radius: 4.0, baseY: 1.1, copingRailId: 'MS-Q3-C', material: 'concrete' },
  { kind: 'building', id: 'MS-DB', rect: { x0: 95, z0: 88, x1: 120, z1: 100 }, height: 3.5, style: 'dock', walkableRoof: true },
  // Mini quarter on the dock roof against the south-east block: a Q3 or rooftop landing heading south turns into speed.
  { kind: 'quarterPipe', id: 'MS-Q5', facing: 'north', footLine: 98.2, copingLine: 100, span: [96, 118], copingHeight: 1.5, radius: 1.8, baseY: 3.5, copingRailId: 'MS-Q5-C', material: 'concrete' },
  { kind: 'building', id: 'MS-AX', rect: { x0: ANNEX_FACE_X, z0: 40, x1: 120, z1: 88 }, height: 6.0, style: 'annex', walkableRoof: true },
  { kind: 'railPipe', id: 'MS-P1-PIPE', railId: 'MS-P1', style: 'scaffold' },
  { kind: 'railPipe', id: 'MS-P2-PIPE', railId: 'MS-P2', style: 'scaffold' },
  { kind: 'railPipe', id: 'MS-P3-PIPE', railId: 'MS-P3', style: 'scaffold' },
  { kind: 'railPipe', id: 'MS-R7-PIPE', railId: 'MS-R7', style: 'parapet', posts: true },
  { kind: 'railPipe', id: 'MS-R12-PIPE', railId: 'MS-R12', style: 'parapet', posts: true },

  // Depot with the billboard on its roof and the vent pipe; the slot to the dock block is the Billboard Gap.
  { kind: 'building', id: 'MS-DP', rect: { x0: 82, z0: 88, x1: 90, z1: 104 }, y0: -1.2, height: 4.7, style: 'depot', walkableRoof: true },
  { kind: 'billboard', id: 'MS-BB1', rect: { x0: 83, z0: 101, x1: 89, z1: 102 }, y0: 3.5, height: 6, face: 'north', brand: 'labA', material: 'neon' },
  { kind: 'railPipe', id: 'MS-R6-PIPE', railId: 'MS-R6', style: 'vent' },

  // Plaza edge to the street: curb banks, the stair landing box, stairs S2 with handrails on the steps.
  { kind: 'bank', id: 'MS-B4W', rect: { x0: 0, z0: 86, x1: 38, z1: 88 }, yHigh: 0, yLow: -1.2, downhill: 'south', material: 'plazaTile' },
  { kind: 'box', id: 'MS-S2L', rect: { x0: 38, z0: 86, x1: 54, z1: 88 }, y0: -1.2, height: 1.2, material: 'plazaTile' },
  { kind: 'bank', id: 'MS-B4E', rect: { x0: 54, z0: 86, x1: 82, z1: 88 }, yHigh: 0, yLow: -1.2, downhill: 'south', material: 'plazaTile' },
  { kind: 'stairs', id: 'MS-S2', rect: { x0: 40, z0: 88, x1: 52, z1: 91.6 }, topY: 0, drop: 1.2, steps: 6, down: 'south', material: 'concrete' },
  { kind: 'railPipe', id: 'MS-R3-PIPE', railId: 'MS-R3', style: 'handrail' },
  { kind: 'railPipe', id: 'MS-R4-PIPE', railId: 'MS-R4', style: 'handrail' },

  // South: curb bank up from the street, the 48 m south quarter-pipe against the south block, the south-east block.
  { kind: 'bank', id: 'MS-B3', rect: { x0: 0, z0: 104, x1: 82, z1: 106.4 }, yHigh: 0, yLow: -1.2, downhill: 'north', material: 'asphalt' },
  { kind: 'quarterPipe', id: 'MS-Q1', facing: 'north', footLine: 115.3, copingLine: 118, span: [22, 70], copingHeight: 2.4, radius: 2.7, copingRailId: 'MS-Q1-C', material: 'concrete' },
  // The south block as three frontages of different heights, so the south edge reads as a street of buildings.
  { kind: 'building', id: 'MS-SB', rect: { x0: 30, z0: 118, x1: 64, z1: 120 }, height: 12, style: 'block' },
  { kind: 'building', id: 'MS-SBW', rect: { x0: 0, z0: 118, x1: 30, z1: 120 }, height: 15, style: 'block' },
  { kind: 'building', id: 'MS-SBE', rect: { x0: 64, z0: 118, x1: 95, z1: 120 }, height: 20, style: 'glassTower' },
  { kind: 'building', id: 'MS-SE', rect: { x0: 95, z0: 100, x1: 120, z1: 120 }, height: 16, style: 'block' },
  // West storefront fronts just inside the boundary (0.8 m deep, one storey): the west edge was open to the
  // backdrop. Kept low because the late sun (azimuth 250, 18 deg) throws a wall's shadow 3 x its height east.
  // They stop a run-out short of the west quarter MS-Q4 (its coping runs on x 0) and clear of the curb banks.
  { kind: 'building', id: 'MS-WF1', rect: { x0: 0, z0: 42.4, x1: 0.8, z1: 66 }, height: 4, style: 'block' },
  { kind: 'building', id: 'MS-WF2', rect: { x0: 0, z0: 88, x1: 0.8, z1: 104 }, y0: -1.2, height: 5.2, style: 'block' },
  { kind: 'building', id: 'MS-WF3', rect: { x0: 0, z0: 106.4, x1: 0.8, z1: 118 }, height: 4, style: 'block' },

  // Dressing. Collidable props at ledge height all carry a rail (their ids appear in the rail table).
  // Bus shelter on the plaza edge behind the bus stop bar, glass back to the plaza, open to the street.
  { kind: 'prop', id: 'MS-PR-SHELTER', prop: 'busShelter', at: xzy(70, 83.4, 0), size: xzy(6, 1.6, 2.6), yawDeg: 180, collidable: true },
  // Scaffold frame: its outer pole row stands at x 103.8 (0.5 m beside the pipes), the inner row inside the annex wall.
  { kind: 'prop', id: 'MS-PR-SCAF', prop: 'scaffoldFrame', at: xzy(SCAFFOLD_X, 56.5, 0), size: xzy(30, 1.0, 6), yawDeg: 90, collidable: false },
  { kind: 'prop', id: 'MS-PR-CANOPY', prop: 'canopy', at: xzy(98, 75, 1.1), size: xzy(4.5, 8, 3.5), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP1', prop: 'lamp', at: xzy(40, 66, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP2', prop: 'lamp', at: xzy(72, 70, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP3', prop: 'lamp', at: xzy(6, 108, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP4', prop: 'lamp', at: xzy(80, 112, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  // Terrace planters: two 5 m ledges in line with the hubbas (their tops meet the hubba tops at 1.4) and one on the alley approach.
  { kind: 'prop', id: 'MS-PR-PLANTER1', prop: 'planter', at: xzy(41.6, 32.5, 0.8), size: xzy(1.0, 5, 0.6), collidable: true },
  // PLANTER2 sits 0.75 m short of the hubba top (polish round 2): line 3 comes off the uphill L2 at about
  // 2.5 m/s, and a full pop at that speed carries 2 m, so the old 3 m feed from z 38 to z 35 missed it.
  { kind: 'prop', id: 'MS-PR-PLANTER2', prop: 'planter', at: xzy(50.4, 34.75, 0.8), size: xzy(1.0, 5, 0.6), collidable: true },
  { kind: 'prop', id: 'MS-PR-PLANTER6', prop: 'planter', at: xzy(96, 33, 0.8), size: xzy(1.0, 6, 0.6), collidable: true },
  // Plaza and street planters: 0.8 m ledges.
  { kind: 'prop', id: 'MS-PR-PLANTER3', prop: 'planter', at: xzy(18, 80, 0), size: xzy(6, 1.2, 0.8), collidable: true },
  { kind: 'prop', id: 'MS-PR-PLANTER4', prop: 'planter', at: xzy(12, 112, 0), size: xzy(6, 1.2, 0.8), collidable: true },
  { kind: 'prop', id: 'MS-PR-PLANTER5', prop: 'planter', at: xzy(74, 109, 0), size: xzy(4, 1.5, 0.8), yawDeg: 25, collidable: true },
  // Roof vents are dressing only: a 1.2 m box on the roof line would be an ungrindable ledge.
  { kind: 'prop', id: 'MS-PR-VENT1', prop: 'vent', at: xzy(113, 52, 6), size: xzy(1.6, 1.6, 1.2), collidable: false },
  { kind: 'prop', id: 'MS-PR-VENT2', prop: 'vent', at: xzy(115, 76, 6), size: xzy(1.6, 1.6, 1.2), collidable: false },
  { kind: 'prop', id: 'MS-PR-VENT3', prop: 'vent', at: xzy(114, 90.5, 3.5), size: xzy(2.2, 1.6, 1.4), collidable: false },
  { kind: 'prop', id: 'MS-PR-VENT4', prop: 'vent', at: xzy(117, 93.5, 3.5), size: xzy(1.4, 1.4, 1.0), collidable: false },
  { kind: 'prop', id: 'MS-PR-VENT5', prop: 'vent', at: xzy(84.2, 90, 3.5), size: xzy(1.4, 1.2, 1.0), collidable: false },
  // Street and loading-dock clutter (polish round 1). All taller than a full ollie, so none is a
  // ledge without a rail, and each stands at least 1.8 m off every line and rail.
  // Parked box vans at the south curb of the west street, clear of the crosswalk and the stair landing.
  { kind: 'prop', id: 'MS-PR-VAN1', prop: 'booth', at: xzy(13, 102.3, -1.2), size: xzy(5.4, 2.1, 2.4), collidable: true, material: 'paintedSteel' },
  { kind: 'prop', id: 'MS-PR-VAN2', prop: 'booth', at: xzy(26, 102.3, -1.2), size: xzy(5.4, 2.1, 2.4), collidable: true, material: 'metalPanel' },
  // A delivery truck at the north curb of the east street, west of line 2's roll-off from the depot roof.
  { kind: 'prop', id: 'MS-PR-TRUCK', prop: 'booth', at: xzy(60.5, 90.3, -1.2), size: xzy(6.2, 2.3, 2.7), collidable: true, material: 'paintedSteel' },
  // A crate stack on the dock under the canopy, 1.8 m in from the dock ledges.
  { kind: 'prop', id: 'MS-PR-CRATES', prop: 'booth', at: xzy(97.4, 81.4, 1.1), size: xzy(1.2, 1.2, 2.2), collidable: true, material: 'woodPanel' },
  // More street lamps: plaza corners, the storefront sidewalk, the south sidewalk, the alley (render only).
  { kind: 'prop', id: 'MS-PR-LAMP5', prop: 'lamp', at: xzy(10, 46, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP6', prop: 'lamp', at: xzy(6, 78, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP7', prop: 'lamp', at: xzy(62, 62, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP8', prop: 'lamp', at: xzy(84, 48, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP9', prop: 'lamp', at: xzy(32, 107.2, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP10', prop: 'lamp', at: xzy(60, 107.2, 0), size: xzy(0.3, 0.3, 6), collidable: false },
  { kind: 'prop', id: 'MS-PR-LAMP11', prop: 'lamp', at: xzy(93, 72, 0), size: xzy(0.3, 0.3, 5), collidable: false },
];

/** Planter 5 is yawed 25 deg; its top rail follows the prop's local x axis (world (cos yaw, 0, -sin yaw)), 0.1 m in from each end. */
function planterRail(at: Vec3, halfLength: number, yawDeg: number, top: number): [Vec3, Vec3] {
  const a = (yawDeg * Math.PI) / 180;
  const dx = Math.cos(a) * halfLength, dz = -Math.sin(a) * halfLength;
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return [{ x: r(at.x - dx), y: top, z: r(at.z - dz) }, { x: r(at.x + dx), y: top, z: r(at.z + dz) }];
}

// ---------------------------------------------------------------------------------------------
// Rails (rail table): 21 ledges, 12 rails, 6 copings (REQ-STR-07 census, updated)
// ---------------------------------------------------------------------------------------------

const RAILS: readonly RailDef[] = [
  { id: 'MS-L1', kind: 'ledge', points: [xzy(41.6, 38, 1.4), xzy(41.6, 43.2, 0.4), xzy(41.6, 46, 0.4)], name: 'Hubba West' },
  { id: 'MS-L2', kind: 'ledge', points: [xzy(50.4, 38, 1.4), xzy(50.4, 43.2, 0.4), xzy(50.4, 46, 0.4)], name: 'Hubba East' },
  { id: 'MS-L3', kind: 'ledge', points: [xzy(56, 39.6, 1.2), xzy(80, 39.6, 1.2)], name: 'Terrace Ledge' },
  { id: 'MS-L3W', kind: 'ledge', points: [xzy(8, 39.6, 1.2), xzy(32, 39.6, 1.2)], name: 'Terrace Ledge West' },
  { id: 'MS-L4', kind: 'ledge', points: [xzy(24, 74, 0.45), xzy(36, 74, 0.45)], name: 'Bench Ledge' },
  { id: 'MS-L5', kind: 'ledge', points: [xzy(68, 52, 0.45), xzy(80, 52, 0.45)], name: 'Plaza Ledge' },
  { id: 'MS-L6', kind: 'ledge', points: [xzy(101, 70, 1.1), xzy(101, 80, 1.1)], name: 'Dock Ledge' },
  { id: 'MS-L7', kind: 'ledge', points: [xzy(38, 40, 0.8), xzy(41.4, 40, 0.8)], name: 'Terrace Step West' },
  { id: 'MS-L8', kind: 'ledge', points: [xzy(50.6, 40, 0.8), xzy(54, 40, 0.8)], name: 'Terrace Step East' },
  { id: 'MS-L9', kind: 'ledge', points: [xzy(12, 60, 0.45), xzy(24, 60, 0.45)], name: 'West Ledge' },
  { id: 'MS-L10', kind: 'ledge', points: [xzy(95, 70.5, 1.1), xzy(95, 83.8, 1.1)], name: 'Dock Ledge West' },
  { id: 'MS-L11', kind: 'ledge', points: [xzy(95.5, 70, 1.1), xzy(100.5, 70, 1.1)], name: 'Dock Ledge North' },
  { id: 'MS-R1', kind: 'rail', points: [xzy(50.2, 49, 0.6), xzy(50.2, 57, 0.6)], name: 'Plaza Flat Bar' },
  { id: 'MS-R10', kind: 'rail', points: [xzy(41.6, 49, 0.6), xzy(41.6, 57, 0.6)], name: 'Plaza Flat Bar West' },
  { id: 'MS-R2', kind: 'rail', points: [xzy(60, 85.7, 0.9), xzy(80, 85.7, 0.9)], name: 'Bus Stop Bar' },
  { id: 'MS-R3', kind: 'rail', points: [xzy(40.4, 87.4, 0.9), xzy(40.4, 92.2, -0.3)], name: 'Stair Rail West' },
  { id: 'MS-R4', kind: 'rail', points: [xzy(51.6, 87.4, 0.9), xzy(51.6, 92.2, -0.3)], name: 'Stair Rail East' },
  // z 97, 3 m south of the Billboard Gap lane (polish round 2): on z 94 the pipe sat under the O, so a
  // charged slot ollie snapped it mid-air and the air ended in a grind before MS-G10 could land.
  { id: 'MS-R6', kind: 'rail', points: [xzy(89.5, 97, 3.9), xzy(82.5, 97, 3.9)], name: 'Depot Vent Pipe' },
  { id: 'MS-R7', kind: 'rail', points: [xzy(ROOF_RAIL_X, 72, 6.3), xzy(ROOF_RAIL_X, 87, 6.3)], name: 'Annex Roof Rail' },
  { id: 'MS-R12', kind: 'rail', points: [xzy(105.5, 87.8, 6.3), xzy(118, 87.8, 6.3)], name: 'Annex South Parapet' },
  { id: 'MS-R8', kind: 'ledge', points: [xzy(88.3, 44, 2.4), xzy(88.3, 78, 2.4)], name: 'Closet Roof Edge' },
  { id: 'MS-R9', kind: 'ledge', points: [xzy(4, 50, 0.45), xzy(4, 70, 0.45)], name: 'Storefront Bench' },
  { id: 'MS-R11', kind: 'rail', points: [xzy(10, 110, 0.6), xzy(24, 110, 0.6)], name: 'South Flat Bar' },
  { id: 'MS-R13', kind: 'ledge', points: [xzy(67.2, 83.4, 2.6), xzy(72.8, 83.4, 2.6)], name: 'Shelter Roof' },
  { id: 'MS-P1', kind: 'rail', points: [xzy(SCAFFOLD_X, 42, 1.0), xzy(SCAFFOLD_X, 52, 1.8)], name: 'Scaffold Tier 1' },
  { id: 'MS-P2', kind: 'rail', points: [xzy(SCAFFOLD_X, 54, 2.6), xzy(SCAFFOLD_X, 62, 3.4)], name: 'Scaffold Tier 2' },
  { id: 'MS-P3', kind: 'rail', points: [xzy(SCAFFOLD_X, 64, 4.2), xzy(SCAFFOLD_X, 70, 5.2)], name: 'Scaffold Tier 3' },
  // Planter tops (prop ids in the names' order): terrace pair at 1.4, alley approach at 1.4, plaza and street at 0.8.
  { id: 'MS-PL1', kind: 'ledge', points: [xzy(41.6, 30, 1.4), xzy(41.6, 35, 1.4)], name: 'Planter West' },
  { id: 'MS-PL2', kind: 'ledge', points: [xzy(50.4, 32.25, 1.4), xzy(50.4, 37.25, 1.4)], name: 'Planter East' },
  { id: 'MS-PL6', kind: 'ledge', points: [xzy(96, 30, 1.4), xzy(96, 36, 1.4)], name: 'Alley Planter' },
  { id: 'MS-PL3', kind: 'ledge', points: [xzy(15, 80, 0.8), xzy(21, 80, 0.8)], name: 'Plaza Planter' },
  { id: 'MS-PL4', kind: 'ledge', points: [xzy(9, 112, 0.8), xzy(15, 112, 0.8)], name: 'Street Planter' },
  { id: 'MS-PL5', kind: 'ledge', points: planterRail(xzy(74, 109, 0), 1.9, 25, 0.8), name: 'Corner Planter' },
  // Van roofs (y -1.2 + 2.4 = 1.2): a full ollie reaches them since founder playtest 2 (CR-65), so they grind.
  { id: 'MS-VAN1-R', kind: 'ledge', points: [xzy(10.6, 102.3, 1.2), xzy(15.4, 102.3, 1.2)], name: 'Van Roof West' },
  { id: 'MS-VAN2-R', kind: 'ledge', points: [xzy(23.6, 102.3, 1.2), xzy(28.4, 102.3, 1.2)], name: 'Van Roof East' },
  { id: 'MS-CRATES-R', kind: 'ledge', points: [xzy(97.4, 80.9, 3.3), xzy(97.4, 81.9, 3.3)], name: 'Crate Stack Top' },
  // 4 cm north of the coping line: on the block's wall plane exactly the rail reads as buried.
  { id: 'MS-Q1-C', kind: 'coping', points: [xzy(22, 117.96, 2.4), xzy(70, 117.96, 2.4)], name: 'South QP Coping' },
  { id: 'MS-Q2-C', kind: 'coping', points: [xzy(86.7, 44, 2.4), xzy(86.7, 78, 2.4)], name: 'Plaza QP Coping' },
  { id: 'MS-Q3-C', kind: 'coping', points: [xzy(95, 88, 3.5), xzy(104.1, 88, 3.5)], name: 'Dock QP Coping' },
  { id: 'MS-Q4-C', kind: 'coping', points: [xzy(0, 74, 1.5), xzy(0, 86, 1.5)], name: 'West Quarter Coping' },
  { id: 'MS-Q5-C', kind: 'coping', points: [xzy(96, 99.96, 5.0), xzy(118, 99.96, 5.0)], name: 'Dock Roof QP Coping' },
  { id: 'MS-F1-C', kind: 'coping', points: circle(FOUNTAIN_CENTRE, FOUNTAIN_RIM_RADIUS, FOUNTAIN_RIM_Y, FOUNTAIN_RIM_POINTS), closed: true, name: 'Fountain Rim' },
];

// ---------------------------------------------------------------------------------------------
// Named gaps (REQ-STR-04, REQ-LVL-07): bases are level data (DESIGN §M "GAP bases")
// ---------------------------------------------------------------------------------------------

const GAPS: readonly GapDef[] = [
  { id: 'MS-G01', name: 'HUBBA HOP', base: 250, rule: { kind: 'grindSpan', rails: ['MS-L1', 'MS-L2'], axis: 'z', from: { op: '<=', value: 40 }, to: { op: '>=', value: 44 }, eitherDirection: true } },
  { id: 'MS-G02', name: 'TERRACE DROP', base: 200, rule: { kind: 'airBoxToBox', start: { x: [0, 86], y: [0.8, Infinity], z: [-Infinity, 40] }, startSurface: 'MS-T2', land: { y: [-Infinity, 0.1], z: [43, Infinity] } } },
  { id: 'MS-G03', name: 'PLAZA BAR HOP', base: 500, rule: { kind: 'grindSequence', steps: [['MS-L1', 'MS-L2'], ['MS-R1', 'MS-R10']], noGroundContact: true } },
  { id: 'MS-G04', name: 'FOUNTAIN TRANSFER', base: 750, rule: { kind: 'surfaceAzimuth', surface: 'MS-F1', centre: FOUNTAIN_CENTRE, minDeltaDeg: 45 } },
  { id: 'MS-G05', name: 'STAIR SET', base: 300, rule: { kind: 'airBoxToBox', start: { x: [38, 54], y: [-0.1, Infinity], z: [-Infinity, 88] }, land: { y: [-Infinity, -1.1], z: [92, Infinity] } } },
  { id: 'MS-G06', name: 'CROSSWALK MANUAL', base: 350, rule: { kind: 'manualSpan', within: { x: [38, 54] }, axis: 'z', from: { op: '<=', value: 93 }, to: { op: '>=', value: 100.5 }, eitherDirection: true } },
  { id: 'MS-G07', name: 'BUS STOP BAR', base: 500, rule: { kind: 'grindDistance', rails: ['MS-R2'], minM: 14 } },
  { id: 'MS-G08', name: 'ALLEY TRANSFER', base: 600, rule: { kind: 'airBoxToBox', startSurface: 'MS-Q2', land: { x: [88.5, Infinity], y: [-Infinity, 0.1], z: [40, 88] } } },
  { id: 'MS-G09', name: 'DOCK ROOF ACCESS', base: 300, rule: { kind: 'airBoxToBox', startSurface: 'MS-Q3', land: { x: [95, 108], y: [3.4, 3.7], z: [88, 100] } } },
  { id: 'MS-G10', name: 'BILLBOARD GAP', base: 1000, rule: { kind: 'airBoxToBox', start: { x: [95, Infinity], y: [3.4, Infinity], z: [88, 100] }, land: { x: [-Infinity, 90], y: [3.4, Infinity], z: [88, 104] } } },
  { id: 'MS-G11', name: 'SCAFFOLD CLIMB', base: 800, rule: { kind: 'grindSequence', steps: [['MS-P1'], ['MS-P2'], ['MS-P3']], noGroundContact: false } },
  { id: 'MS-G12', name: 'ROOFTOP DROP', base: 400, rule: { kind: 'airBoxToBox', start: { x: [ANNEX_FACE_X, 120], y: [6.0, Infinity], z: [40, 88] }, land: { x: [95, 120], y: [3.4, 3.7], z: [88, 100] } } },
];

// ---------------------------------------------------------------------------------------------
// Goals (REQ-STR-06, REQ-GOL-02): thresholds are TUNING keys, the Laptop name comes from BRANDS
// ---------------------------------------------------------------------------------------------

function goal(index: number, name: string, condition: GoalDef['condition'], extra: Partial<GoalDef> = {}): GoalDef {
  return { id: `MS-GOAL-${String(index).padStart(2, '0')}`, levelId: 'marketStreet', index, name, condition, reqId: 'REQ-STR-06', ...extra };
}

const GOALS: readonly GoalDef[] = [
  goal(1, 'High Score', { kind: 'runScore', threshold: 'STREET_HIGH_SCORE' }),
  goal(2, 'Pro Score', { kind: 'runScore', threshold: 'STREET_PRO_SCORE' }),
  goal(3, 'Sick Score', { kind: 'runScore', threshold: 'STREET_SICK_SCORE' }),
  goal(4, 'High Combo', { kind: 'comboScore', threshold: 'STREET_HIGH_COMBO' }),
  goal(5, 'C-O-D-E', { kind: 'letters' }),
  goal(6, 'Laptop', { kind: 'macguffin', id: 'secret_laptop' }, { nameFromMacGuffin: 'secret_laptop' }),
  goal(7, 'Grind the Bus Stop Bar', { kind: 'gapInBankedCombo', gapId: 'MS-G07' }),
  goal(8, 'Transfer the Billboard Gap', { kind: 'gapInBankedCombo', gapId: 'MS-G10' }),
  goal(9, 'Manual the Crosswalk', { kind: 'gapInBankedCombo', gapId: 'MS-G06' }),
  goal(10, '5,000 over the Fountain', { kind: 'comboWithSurface', threshold: 'STREET_FOUNTAIN_COMBO', surfaceId: 'MS-F1', orGapId: 'MS-G04' }),
];

// ---------------------------------------------------------------------------------------------
// Decals: crosswalk, water, sponsor wordmarks on walls (never near a rail, REQ-LVL-04 / REQ-MAT-04)
// ---------------------------------------------------------------------------------------------

const DECALS: readonly DecalDef[] = [
  { id: 'MS-DC-XWALK', kind: 'crosswalk', center: xzy(46, 96.8, -1.2), on: 'up', width: 16, height: 10.4 },
  // The basin is a disc of radius 3.15 (rim 3.5 minus the rim top). One square quad cannot fill a
  // disc: this is the largest whose corners stay hidden under the rim top (the outer face drops
  // below the water height 0.07 m past the rim), 0.65 m short of the wall at the edge midpoints.
  // A true water disc needs the builder (request to the levels track).
  { id: 'MS-DC-WATER', kind: 'water', center: xzy(FOUNTAIN_CENTRE.x, FOUNTAIN_CENTRE.z, 0.9), on: 'up', width: 5.0, height: 5.0 },
  { id: 'MS-DC-LANE-W', kind: 'paint', center: xzy(19, 96, -1.2), on: 'up', width: 30, height: 0.25, rotDeg: 90 },
  { id: 'MS-DC-LANE-E', kind: 'paint', center: xzy(68, 96, -1.2), on: 'up', width: 18, height: 0.25, rotDeg: 90 },
  { id: 'MS-DC-DRAIN', kind: 'drain', center: xzy(96, 56, 0), on: 'up', width: 1, height: 1 },
  // Street paint (polish round 1): curb edge lines on both sides (broken by the crosswalk), parking
  // bay ticks between the vans, lane arrows, curb drains and oil stains.
  { id: 'MS-DC-EDGE-NW', kind: 'paint', center: xzy(19, 88.6, -1.2), on: 'up', width: 37, height: 0.15, rotDeg: 90 },
  { id: 'MS-DC-EDGE-NE', kind: 'paint', center: xzy(68, 88.6, -1.2), on: 'up', width: 27, height: 0.15, rotDeg: 90 },
  { id: 'MS-DC-EDGE-SW', kind: 'paint', center: xzy(19, 103.4, -1.2), on: 'up', width: 37, height: 0.15, rotDeg: 90 },
  { id: 'MS-DC-EDGE-SE', kind: 'paint', center: xzy(68, 103.4, -1.2), on: 'up', width: 27, height: 0.15, rotDeg: 90 },
  { id: 'MS-DC-BAY1', kind: 'paint', center: xzy(6.8, 102.3, -1.2), on: 'up', width: 0.15, height: 2.2, rotDeg: 90 },
  { id: 'MS-DC-BAY2', kind: 'paint', center: xzy(19.5, 102.3, -1.2), on: 'up', width: 0.15, height: 2.2, rotDeg: 90 },
  { id: 'MS-DC-BAY3', kind: 'paint', center: xzy(32.2, 102.3, -1.2), on: 'up', width: 0.15, height: 2.2, rotDeg: 90 },
  { id: 'MS-DC-ARROW-W', kind: 'arrow', center: xzy(26, 92.2, -1.2), on: 'up', width: 1.2, height: 3.2, rotDeg: 90 },
  { id: 'MS-DC-ARROW-E', kind: 'arrow', center: xzy(64, 99.8, -1.2), on: 'up', width: 1.2, height: 3.2, rotDeg: -90 },
  { id: 'MS-DC-DRAIN-N', kind: 'drain', center: xzy(30, 88.8, -1.2), on: 'up', width: 0.9, height: 0.6 },
  { id: 'MS-DC-DRAIN-S', kind: 'drain', center: xzy(72, 103.2, -1.2), on: 'up', width: 0.9, height: 0.6 },
  { id: 'MS-DC-DRAIN-F', kind: 'drain', center: xzy(56.5, 72.5, 0), on: 'up', width: 0.8, height: 0.8 },
  { id: 'MS-DC-OIL1', kind: 'stain', center: xzy(9, 101.8, -1.2), on: 'up', width: 1.6, height: 1.1, rotDeg: 10 },
  { id: 'MS-DC-OIL2', kind: 'stain', center: xzy(74, 92, -1.2), on: 'up', width: 1.8, height: 1.2, rotDeg: -25 },
  { id: 'MS-DC-OIL3', kind: 'stain', center: xzy(92, 50, 0), on: 'up', width: 2.4, height: 1.4, rotDeg: 70 },
  { id: 'MS-DC-OIL4', kind: 'stain', center: xzy(99.5, 64, 0), on: 'up', width: 1.6, height: 1.6 },
  { id: 'MS-DC-STAIN-P', kind: 'stain', center: xzy(20, 70, 0), on: 'up', width: 2.0, height: 1.3, rotDeg: 35 },
  { id: 'MS-DC-STAIN', kind: 'stain', center: xzy(98, 80, 1.1), on: 'up', width: 2.2, height: 1.6, rotDeg: 20 },
  { id: 'MS-DC-SIGN-TA', kind: 'wordmark', center: xzy(18, 20, 12), on: 'south', width: 16, height: 3, brand: 'labB' },
  { id: 'MS-DC-SIGN-TB', kind: 'wordmark', center: xzy(64, 20, 14), on: 'south', width: 22, height: 4, brand: 'labA' },
  { id: 'MS-DC-SIGN-TC', kind: 'wordmark', center: xzy(105, 20, 10), on: 'south', width: 14, height: 3, brand: 'chip' },
  { id: 'MS-DC-SIGN-AX', kind: 'wordmark', center: xzy(112, 40, 3.6), on: 'north', width: 10, height: 2, brand: 'chip' },
  { id: 'MS-DC-GRAF-EB', kind: 'graffiti', center: xzy(88.5, 60, 1.2), on: 'east', width: 4, height: 1.6 },
  { id: 'MS-DC-GRAF-DP', kind: 'graffiti', center: xzy(82, 96, 1.5), on: 'west', width: 5, height: 2 },
  { id: 'MS-DC-GRAF-SB', kind: 'graffiti', center: xzy(46, 118, 6), on: 'north', width: 20, height: 3 },
];

// ---------------------------------------------------------------------------------------------
// The level
// ---------------------------------------------------------------------------------------------

export const MARKET_STREET: LevelDef = {
  id: 'marketStreet',
  name: 'Market Street',
  size: { x: 120, z: 120 },
  environment: 'streetAfternoon',
  spawn: { pos: xzy(46, 30, 0.8), facing: 'south' },
  spawnArea: { x0: 20, z0: 20, x1: 84, z1: 88 },
  primitives: PRIMITIVES,
  rails: RAILS,
  gaps: GAPS,
  letters: [
    { letter: 'C', pos: xzy(46, 90.5, 2.4) },
    // Mid-slot, where a full or mid-charge ollie over the Billboard Gap carries the collect point (y 6.0 to 6.4 with the CR-44 ollie heights).
    { letter: 'O', pos: xzy(92.5, 94, 6.5) },
    // Directly above the fountain rim on the flat-bar lane (x 50.4): 1.8 m over the coping.
    { letter: 'D', pos: xzy(50.4, 62.5, 3.0) },
    { letter: 'E', pos: xzy(SCAFFOLD_X, 58, 4.4) },
  ],
  macguffin: { id: 'secret_laptop', pos: xzy(ROOF_RAIL_X, 80, 7.2) },
  // SAM stands just ahead of the spawn, beside the lane to the stairs, facing the player.
  npcs: [{ id: 'sam', pos: xzy(47.5, 35, 0.8), facing: 'north', outfit: 'hoodie', prop: 'laptopSleeve' }],
  goals: GOALS,
  decals: DECALS,
  // Listed feeds (DESIGN G.1 feed check): planter -> hubba -> flat bar on both sides, the scaffold chain.
  feeds: [
    { from: 'MS-PL1', to: 'MS-L1', exitSpeed: 6.0, pop: 'tap' },
    { from: 'MS-PL2', to: 'MS-L2', exitSpeed: 6.0, pop: 'tap' },
    { from: 'MS-L1', to: 'MS-R10', exitSpeed: 6.0, pop: 'tap' },
    { from: 'MS-L2', to: 'MS-R1', exitSpeed: 6.0, pop: 'tap' },
    { from: 'MS-P1', to: 'MS-P2', exitSpeed: 8.2, pop: 'tap' },
    { from: 'MS-P2', to: 'MS-P3', exitSpeed: 7.3, pop: 'tap' },
    { from: 'MS-P3', to: 'MS-R7', exitSpeed: 6.0, pop: 'full' },
  ],
};
