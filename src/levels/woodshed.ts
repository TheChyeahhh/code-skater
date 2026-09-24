/**
 * src/levels/woodshed.ts (woodshed track): WOODSHED as data (SPEC §9.2 level B, DESIGN G.2,
 * REQ-WSH-01..07, REQ-GOL-02, REQ-NPC-01..04). An indoor wood park, 90 x 70 m: honey maple floor
 * and ramps, steel coping, two bowls, a centre spine with tagged transfer edges, a full-pipe, a vert
 * wall with an over-vert rail, two quarter-pipes joined by a wall rail, a snake run, a hump, euro
 * gap, a street platform with a flat bar, hubbas and stairs, two rainbow rails, flat bars and a kink
 * ledge. Coordinates: x east, y up, z south, origin at the north-west corner; the (x, z, y) tables of
 * DESIGN G.2 go through xzy().
 *
 * Every id doubles as the surface id the sim reports. Names that reference a brand or a person come
 * from src/data/brands.ts at run time (NPC line, toast, splash, the Drive's name, banner wordmarks):
 * nothing here spells one.
 *
 * Layout notes (what differs from the DESIGN G.2 one-pager, and why; each is listed as a
 * CHANGE-REQUEST in the track report):
 * - The snake run's east leg sits at x 73 (DESIGN 76) and its north mouth at z 45 (DESIGN 40): with
 *   the leg at x 76 the lane between the run and the vert wall foot (x 81) was 2 m, and the mouth ramp
 *   at z 37..40 sat right on the centre rainbow's line (z 40). Line 1 now has a 5 m lane east of the
 *   run to reach WS-QE1 head-on, and a rainbow grinder rolling on at z 40 clears the mouth by 2 m.
 * - The contest booth stands at x[41,45] z[64.5,68.5] (DESIGN x[44,48] z[60,64]): the DESIGN spot
 *   was 1 m in front of the snake run's west exit ramp (x 49..52, z 57..63), a wall in the face of
 *   anyone riding out of the run. DARIO keeps his DESIGN spot (46, 65), now 1 m east of the booth.
 * - Letter D sits at (60, 32.8, 6.2) (DESIGN (60, 33.2, 6.5)): the DESIGN point is 4.06 m from the
 *   pipe axis, i.e. inside the plywood shell (inner radius 4.0). 0.44 m inside the surface it reads
 *   as a letter hanging in the pipe and is 0.70 m from the DESIGN collect point (radius 0.9).
 * - A woodPanel wall (WS-WALL-S) backs the Coping Link between the two quarter-pipes so the
 *   wall-mounted rail has a wall (the boundary renders invisible).
 * - The two transfer-side feeds (WS-VW1-C -> WS-OV and WS-SP1-W/E -> WS-SP1-P) are not listed under
 *   `feeds`: they are side-by-side rails, not an end feeding a start, and the validator measures from
 *   the exit point. tests/woodshed.test.ts checks their lateral offset and rise directly.
 *
 * Polish pass (art director review), each also a CHANGE-REQUEST in the track report:
 * - The hump moved from x[56,64] z[47,55] to x[77,83.5] z[52,60] (ridge along x at z 56): the old spot
 *   was walled off by the snake run's west leg (its SE corner 0.7 m from the inner rim) and line 1
 *   never touched it. It now sits in the lane line 1 rolls down (x 78..80) between the vert deck and
 *   WS-QE1, 1 m east of the outer rim, 0.5 m west of the vert pocket lane. HUMP AIR is a hop over the
 *   ridge (z <= 53 to z >= 59), base 300. Both end faces are >= 3 m from every fixture roll.
 * - The vert deck's two 3.6 m end walls (z 22 and z 48) became vert pockets WS-VW1-N / WS-VW1-S:
 *   quarter-pipes of the same profile facing the East Bowl and the QE1 lane, with copings, so the
 *   corner is a pool-to-vert pocket instead of two head-on bail traps.
 * - The Drive hangs at (43, 28, 5.5), not 3.6: a peak-rail grind or a coping-speed spine air no longer
 *   collects it; it needs a pumped spine air (about 10 m/s). Its height cannot demand the transfer
 *   SPEC asks for (a plain spine air passes as close to the peak as a transfer air does): that needs a
 *   pickup gate in the sim, requested in the polish round 2 report.
 * - WS-BN4 rose to y0 5.4 so a full ollie off the Coping Link (sphere top 4.7) never meets its frame;
 *   5.8 since the founder playtest's 2.0 m full ollie (DESIGN L CR-44, sphere top 5.1).
 * - The south wall panel is a 10 cm skin (z0 69.9) so the Coping Link sits 0.4 m off its face; the
 *   booth moved out from under the rail to x[36,40] z[60.5,63.5] beside the spawn, DARIO to (41, 61).
 * - Spawn faces north at (34, 62): WS-RF is 10.7 m straight ahead, the chain rows and the bowl beyond.
 * - Chain rows widened for the manual turns: WS-RR1 at z 45.4 (7.4 m from WS-RA), WS-RE / WS-RF at
 *   z 51.6 / 51.9 (6.2 m from WS-RR1), so both half-circles fit at about 116 deg/s instead of 120.
 * - WS-BK1 / WS-PL1 / WS-FB3 shifted 0.2 / 0.6 / 0.4 m east so WS-FB1's end post stands clear of the
 *   bank; WS-PL1-E rails the platform's open east edge; WS-BT-N rails the booth counter.
 *
 * Polish round 2 (feel audit), each also a CHANGE-REQUEST in the track report:
 * - No slot at a ramp end: WS-QE1 stops at x 87 and a corner deck WS-QE1-END (x 87..90, flush with
 *   the coping at 2.4) fills the south-east corner; WS-QW1-END (x 0..4, 2.0) does the same in the
 *   south-west; WS-VW1-N-END / WS-VW1-S-END fill the 0.6 m between the pockets and the east wall to
 *   deck height. A grind off either south-wall coping end lands on a deck and banks (COPING LINK kept)
 *   before the wall, and the air sphere can no longer wedge in a slot and leave the park.
 * - DROP-IN is an air from the park floor landing inside a bowl (any triangle below -0.7 m), since
 *   riders faster than 5 m/s fly past the vertical-at-rim walls to the floor.
 * - CENTER RAINBOW spans x <= 50 to x >= 62 (2 m slack at each end, as RAINBOW has).
 */

import { xzy } from '../core/math';
import type { RectXZ, Vec3 } from '../core/types';
import type { GoalDef } from '../data/goals';
import type { DecalDef, FeedDef, GapDef, LevelDef, Primitive, RailDef } from './types';

/**
 * Pool coping loop for a bowl rect with corners of radius r: clockwise seen from above, starting on
 * the north edge, `segs` straight pieces per corner arc (DESIGN G.2: 4 per corner), first point
 * repeated at the end (closed). The builder's own rim uses 12 pieces per corner; the largest gap
 * between the two is the chord sagitta r (1 - cos(90 deg / (2 segs))), 0.058 m for r 3 and 0.038 m
 * for r 2, inside the 0.1 m REQ-LVL-03 tolerance.
 */
function poolCoping(rect: RectXZ, r: number, y: number, segs: number): Vec3[] {
  const arc = (cx: number, cz: number, from: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 1; i <= segs; i++) {
      const a = from + (Math.PI / 2) * (i / segs);
      out.push(xzy(cx + r * Math.cos(a), cz + r * Math.sin(a), y));
    }
    return out;
  };
  const pts: Vec3[] = [xzy(rect.x0 + r, rect.z0, y)];
  pts.push(xzy(rect.x1 - r, rect.z0, y), ...arc(rect.x1 - r, rect.z0 + r, -Math.PI / 2)); // north edge, NE corner
  pts.push(xzy(rect.x1, rect.z1 - r, y), ...arc(rect.x1 - r, rect.z1 - r, 0)); // east edge, SE corner
  pts.push(xzy(rect.x0 + r, rect.z1, y), ...arc(rect.x0 + r, rect.z1 - r, Math.PI / 2)); // south edge, SW corner
  pts.push(xzy(rect.x0, rect.z0 + r, y), ...arc(rect.x0 + r, rect.z0 + r, Math.PI).slice(0, -1)); // west edge, NW corner
  pts.push({ ...(pts[0] as Vec3) }); // closed: the first point again, exactly
  return pts;
}

const BW1_RECT: RectXZ = { x0: 4, z0: 6, x1: 24, z1: 26 };
const BW2_RECT: RectXZ = { x0: 80, z0: 2, x1: 88, z1: 18 };

export const WOODSHED_GOALS: readonly GoalDef[] = [
  { id: 'WS-GOAL-01', levelId: 'woodshed', index: 1, name: 'High Score', condition: { kind: 'runScore', threshold: 'WOODSHED_HIGH_SCORE' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-02', levelId: 'woodshed', index: 2, name: 'Pro Score', condition: { kind: 'runScore', threshold: 'WOODSHED_PRO_SCORE' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-03', levelId: 'woodshed', index: 3, name: 'Sick Score', condition: { kind: 'runScore', threshold: 'WOODSHED_SICK_SCORE' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-04', levelId: 'woodshed', index: 4, name: 'High Combo', condition: { kind: 'comboScore', threshold: 'WOODSHED_HIGH_COMBO' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-05', levelId: 'woodshed', index: 5, name: 'C-O-D-E', condition: { kind: 'letters' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-06', levelId: 'woodshed', index: 6, name: '', nameFromMacGuffin: 'secret_drive', condition: { kind: 'macguffin', id: 'secret_drive' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-07', levelId: 'woodshed', index: 7, name: 'Spine Transfer the Center', condition: { kind: 'gapInBankedCombo', gapId: 'WS-G01' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-08', levelId: 'woodshed', index: 8, name: 'Grind the Rainbow', condition: { kind: 'gapInBankedCombo', gapId: 'WS-G08' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-09', levelId: 'woodshed', index: 9, name: 'Hold a 3-second special', condition: { kind: 'specialHeld', specialIds: ['gpu_slide', 'context_window', 'inference_900ms'], seconds: 'SPECIAL_HOLD_GOAL_S' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-10', levelId: 'woodshed', index: 10, name: '2 revert-manuals in one combo', condition: { kind: 'sequenceInCombo', first: 'revert', then: 'manual', count: 'WOODSHED_REVERT_MANUALS' }, reqId: 'REQ-WSH-06' },
];

const PRIMITIVES: readonly Primitive[] = [
  // Floor, walls come from the builder (boundary h 12); ceiling trusses hang at y 12 (render only).
  { kind: 'ground', id: 'WS-FL', rect: { x0: 0, z0: 0, x1: 90, z1: 70 }, y: 0, material: 'maple' },
  // Bowls: vertical at the rim (wall radius = depth), pool coping loops WS-BW1-C / WS-BW2-C.
  { kind: 'bowl', id: 'WS-BW1', rect: BW1_RECT, depth: 2.4, wallRadius: 2.4, cornerRadius: 3.0, copingRailId: 'WS-BW1-C' },
  { kind: 'bowl', id: 'WS-BW2', rect: BW2_RECT, depth: 2.0, wallRadius: 2.0, cornerRadius: 2.0, copingRailId: 'WS-BW2-C' },
  // Kink ledge box under WS-RE (its centreline rail).
  { kind: 'ledge', id: 'WS-RE', rect: { x0: 9, z0: 51.4, x1: 24, z1: 51.8 }, topY: 0.6 },
  // South-west and south-east quarter-pipes on the south wall, joined by the wall-mounted Coping Link.
  { kind: 'quarterPipe', id: 'WS-QW1', facing: 'north', footLine: 67.8, copingLine: 70, span: [4, 30], copingHeight: 2.0, radius: 2.2, copingRailId: 'WS-QW1-C' },
  // (A 10 cm skin, 0.6 m short of each quarter-pipe end so the coping ends keep their REQ-LVL-12
  // clearance; the Coping Link's centreline sits 0.4 m off its face, the capsule clears by 0.05.)
  { kind: 'box', id: 'WS-WALL-S', rect: { x0: 30.6, z0: 69.9, x1: 59.4, z1: 70 }, y0: 0, height: 2.8, material: 'woodPanel' },
  { kind: 'quarterPipe', id: 'WS-QE1', facing: 'north', footLine: 67.3, copingLine: 70, span: [60, 87], copingHeight: 2.4, radius: 2.7, copingRailId: 'WS-QE1-C' },
  // Corner decks flush with the coping tops at both ends of the south wall: a coping grind that runs
  // off WS-QE1-C (east) or WS-QW1-C (west) lands on a deck and banks before it reaches the wall
  // (3 m / 4 m: the 17-tick land window at 11 m/s is 1.6 m), and nothing can drop beside a ramp end.
  { kind: 'box', id: 'WS-QE1-END', rect: { x0: 87, z0: 67.3, x1: 90, z1: 70 }, y0: 0, height: 2.4, material: 'maple' },
  { kind: 'box', id: 'WS-QW1-END', rect: { x0: 0, z0: 67.8, x1: 4, z1: 70 }, y0: 0, height: 2.0, material: 'maple' },
  // Centre spine: ridge along z at x 43, copings at x 42.7 / 43.3 (tagged transfer, plane x 43), peak rail.
  {
    kind: 'spine', id: 'WS-SP1', axis: 'z', centre: 43, span: [12, 44], copingHeight: 2.4, radius: 2.7, gapWidth: 0.6,
    copingRailIds: ['WS-SP1-W', 'WS-SP1-E'], peakRailId: 'WS-SP1-P',
  },
  // Contest booth (counter with a grindable north edge, canopy, coffee table) 2 m right of the spawn;
  // DARIO stands 1 m east of it, clear of the snake run's exit lane (z 57..63 runs out west of x 49).
  // The counter sits 0.5 m off the REQ-LVL-05 probe rows (z 60 and 64) so every probe stays on floor.
  { kind: 'box', id: 'WS-BT', rect: { x0: 36, z0: 60.5, x1: 40, z1: 63.5 }, y0: 0, height: 1.2, material: 'woodPanel' },
  { kind: 'prop', id: 'WS-BT-CANOPY', prop: 'canopy', at: xzy(38, 62, 0), size: xzy(4.6, 4.6, 2.6), collidable: false },
  { kind: 'prop', id: 'WS-BT-TABLE', prop: 'coffeeTable', at: xzy(41.9, 62.4, 0), size: xzy(0.8, 0.6, 0.75), collidable: false },
  // Street course along the north wall: bank up to the platform, flat bars, stairs between two hubbas, euro gap.
  // (Bank and platform sit 0.2 / 0.6 m east of DESIGN so WS-FB1's end post at x 56 stands on flat floor.)
  { kind: 'bank', id: 'WS-BK1', rect: { x0: 56.2, z0: 2, x1: 58.6, z1: 14 }, yHigh: 1.0, yLow: 0, downhill: 'west' },
  { kind: 'box', id: 'WS-PL1', rect: { x0: 58.6, z0: 2, x1: 70, z1: 14 }, y0: 0, height: 1.0 },
  { kind: 'stairs', id: 'WS-ST1', rect: { x0: 70, z0: 8.3, x1: 72.5, z1: 12.3 }, topY: 1.0, drop: 1.0, steps: 5, down: 'east' },
  { kind: 'hubba', id: 'WS-HB1N', rect: { x0: 70, z0: 7.8, x1: 74, z1: 8.2 }, yTop: 1.4, yKink: 0.4, kinkAt: 72.5, yEnd: 0.4, along: 'east' },
  { kind: 'hubba', id: 'WS-HB1S', rect: { x0: 70, z0: 12.4, x1: 74, z1: 12.8 }, yTop: 1.4, yKink: 0.4, kinkAt: 72.5, yEnd: 0.4, along: 'east' },
  { kind: 'euroGap', id: 'WS-EG1', rect: { x0: 75, z0: 2, x1: 77.4, z1: 14 }, floorY: -0.6, bankRunM: 0.6, across: 'x' },
  // Full-pipe, R 4, floor tangent at y 0, open both ends; letter D hangs inside.
  { kind: 'fullPipe', id: 'WS-FP1', a: xzy(50, 30, 4.0), b: xzy(76, 30, 4.0), radius: 4.0 },
  // Vert wall on the east wall: R 3 + 0.6 m vertical, deck x[84,90], over-vert rail WS-OV behind the coping.
  {
    kind: 'quarterPipe', id: 'WS-VW1', facing: 'west', footLine: 81, copingLine: 84, span: [22, 48], copingHeight: 3.6, radius: 3.0,
    vertExt: 0.6, deckDepth: 6, copingRailId: 'WS-VW1-C',
  },
  // Vert pockets on the deck's two ends (same profile, no deck of their own: they share WS-VW1's):
  // north faces the East Bowl (1 m of flat between the pool rim z 18 and the foot z 19), south faces
  // the QE1 lane. Spans stop 0.6 m short of the east wall (REQ-LVL-12 coping clearance); end blocks fill the slot.
  {
    kind: 'quarterPipe', id: 'WS-VW1-N', facing: 'north', footLine: 19, copingLine: 22, span: [84, 89.4], copingHeight: 3.6, radius: 3.0,
    vertExt: 0.6, copingRailId: 'WS-VW1-NC',
  },
  {
    kind: 'quarterPipe', id: 'WS-VW1-S', facing: 'south', footLine: 51, copingLine: 48, span: [84, 89.4], copingHeight: 3.6, radius: 3.0,
    vertExt: 0.6, copingRailId: 'WS-VW1-SC',
  },
  // End blocks in the 0.6 m slots between the pockets' east ends and the east wall, flush with the
  // coping top: an open slot let the air sphere wedge between the ramp end and the boundary wall and
  // fall out of the park (22 of 554 drops along x 89.5..89.7 did).
  { kind: 'box', id: 'WS-VW1-N-END', rect: { x0: 89.4, z0: 19, x1: 90, z1: 22 }, y0: 0, height: 3.6, material: 'maple' },
  { kind: 'box', id: 'WS-VW1-S-END', rect: { x0: 89.4, z0: 48, x1: 90, z1: 51 }, y0: 0, height: 3.6, material: 'maple' },
  // Hump: sine ridge along x at z 56, 0.8 m high (max slope 17 deg, manual-able), tagged transition,
  // in line 1's lane between the vert deck (z 48) and WS-QE1's foot (z 67.3).
  { kind: 'hump', id: 'WS-H1', rect: { x0: 77, z0: 52, x1: 83.5, z1: 60 }, ridgeAxis: 'x', height: 0.8 },
  // Snake run: north mouth at (73, 45), bend south-west, west leg to (52, 60); both open ends ramp up over 3 m.
  {
    kind: 'channel', id: 'WS-SR1', centreline: [{ x: 73, z: 45 }, { x: 73, z: 52 }, { x: 64, z: 60 }, { x: 52, z: 60 }], width: 6,
    floorY: -1.2, wallRadius: 1.5, wallHeight: 1.2, openEndRampM: 3, rimRailIds: ['WS-SR1-A', 'WS-SR1-B'],
  },
  // Rail pipe looks: the two rainbows and the wall-mounted link (every other rail gets the default flat bar).
  { kind: 'railPipe', id: 'WS-RR1-PIPE', railId: 'WS-RR1', style: 'rainbow' },
  { kind: 'railPipe', id: 'WS-RR2-PIPE', railId: 'WS-RR2', style: 'rainbow' },
  { kind: 'railPipe', id: 'WS-TR1-PIPE', railId: 'WS-TR1', style: 'wallMounted' },
  // Contest banners high on the walls (brand wordmarks from BRANDS), never over a rail or coping.
  { kind: 'billboard', id: 'WS-BN1', rect: { x0: 57, z0: 0, x1: 71, z1: 0.35 }, y0: 4.0, height: 2.2, face: 'south', brand: 'labB' },
  { kind: 'billboard', id: 'WS-BN2', rect: { x0: 0, z0: 8, x1: 0.35, z1: 24 }, y0: 4.5, height: 2.2, face: 'east', brand: 'labA' },
  { kind: 'billboard', id: 'WS-BN3', rect: { x0: 89.65, z0: 26, x1: 90, z1: 44 }, y0: 7.5, height: 2.2, face: 'west', brand: 'chip' },
  { kind: 'billboard', id: 'WS-BN4', rect: { x0: 36, z0: 69.65, x1: 54, z1: 70 }, y0: 6.1, height: 2.0, face: 'north', brand: 'labB' },
  { kind: 'billboard', id: 'WS-BN5', rect: { x0: 26, z0: 0, x1: 40, z1: 0.35 }, y0: 4.0, height: 2.2, face: 'south', brand: 'chip' },
  // Ceiling trusses at y 12 (render only), one every 12 m.
  { kind: 'prop', id: 'WS-TRUSS-1', prop: 'trusses', at: xzy(45, 12, 0), size: xzy(88, 0.6, 12), collidable: false },
  { kind: 'prop', id: 'WS-TRUSS-2', prop: 'trusses', at: xzy(45, 24, 0), size: xzy(88, 0.6, 12), collidable: false },
  { kind: 'prop', id: 'WS-TRUSS-3', prop: 'trusses', at: xzy(45, 36, 0), size: xzy(88, 0.6, 12), collidable: false },
  { kind: 'prop', id: 'WS-TRUSS-4', prop: 'trusses', at: xzy(45, 48, 0), size: xzy(88, 0.6, 12), collidable: false },
  { kind: 'prop', id: 'WS-TRUSS-5', prop: 'trusses', at: xzy(45, 60, 0), size: xzy(88, 0.6, 12), collidable: false },
];

const RAILS: readonly RailDef[] = [
  { id: 'WS-BW1-C', kind: 'coping', points: poolCoping(BW1_RECT, 3.0, 0, 4), closed: true, name: 'Bowl Coping' },
  { id: 'WS-BW2-C', kind: 'coping', points: poolCoping(BW2_RECT, 2.0, 0, 4), closed: true, name: 'East Bowl Coping' },
  { id: 'WS-RA', kind: 'rail', points: [xzy(8, 38, 0.55), xzy(24, 38, 0.55)], name: 'Long Bar' },
  { id: 'WS-RB', kind: 'rail', points: [xzy(26.5, 38.3, 1.2), xzy(33, 38.3, 0.6)], name: 'Step-up Bar' },
  // Not in DESIGN G.2 (its ids skip FB2): a bar in the otherwise empty floor between the west bowl
  // and the spine, 4 m short of the spine's west foot, so "bar -> spine air" is a line of its own.
  { id: 'WS-FB2', kind: 'rail', points: [xzy(28, 14, 0.55), xzy(36, 14, 0.55)], name: 'Corner Bar' },
  {
    id: 'WS-RR1', kind: 'rail', name: 'Rainbow',
    points: [xzy(31, 45.4, 0.5), xzy(27, 45.4, 1.05), xzy(23, 45.4, 1.4), xzy(19, 45.4, 1.5), xzy(15, 45.4, 1.4), xzy(11, 45.4, 1.05), xzy(7, 45.4, 0.5)],
  },
  { id: 'WS-RE', kind: 'ledge', points: [xzy(9, 51.6, 0.6), xzy(24, 51.6, 0.6)], name: 'Kink Ledge' },
  { id: 'WS-RF', kind: 'rail', points: [xzy(26.2, 51.9, 0.9), xzy(40, 51.9, 0.5)], name: 'Booth Rail' },
  { id: 'WS-QW1-C', kind: 'coping', points: [xzy(4, 70, 2.0), xzy(30, 70, 2.0)], name: 'SW Coping' },
  { id: 'WS-TR1', kind: 'rail', points: [xzy(30, 69.5, 2.0), xzy(60, 69.5, 2.4)], name: 'Coping Link' },
  { id: 'WS-QE1-C', kind: 'coping', points: [xzy(60, 70, 2.4), xzy(87, 70, 2.4)], name: 'SE Coping' },
  { id: 'WS-SP1-W', kind: 'coping', points: [xzy(42.7, 12, 2.4), xzy(42.7, 44, 2.4)], name: 'Spine West', tags: ['transfer'], transferPlane: { axis: 'x', at: 43 } },
  { id: 'WS-SP1-E', kind: 'coping', points: [xzy(43.3, 12, 2.4), xzy(43.3, 44, 2.4)], name: 'Spine East', tags: ['transfer'], transferPlane: { axis: 'x', at: 43 } },
  { id: 'WS-SP1-P', kind: 'rail', points: [xzy(43, 16, 2.75), xzy(43, 40, 2.75)], name: 'Spine Peak Rail' },
  { id: 'WS-FB1', kind: 'rail', points: [xzy(47, 8, 0.55), xzy(56, 8, 0.55)], name: 'Street Flat Bar' },
  { id: 'WS-FB3', kind: 'rail', points: [xzy(59.4, 8, 1.55), xzy(69, 8, 1.55)], name: 'Platform Bar' },
  { id: 'WS-PL1-N', kind: 'ledge', points: [xzy(58.6, 2.2, 1.0), xzy(70, 2.2, 1.0)], name: 'Platform North Edge' },
  { id: 'WS-PL1-S', kind: 'ledge', points: [xzy(58.6, 13.8, 1.0), xzy(70, 13.8, 1.0)], name: 'Platform South Edge' },
  // The platform's open east edge north of the hubba (a visible 1.0 m drop); stops 0.8 m short of WS-HB1N's step.
  { id: 'WS-PL1-E', kind: 'ledge', points: [xzy(70, 2.4, 1.0), xzy(70, 7.0, 1.0)], name: 'Platform East Edge' },
  { id: 'WS-HB1N', kind: 'ledge', points: [xzy(70, 8.0, 1.4), xzy(72.5, 8.0, 0.4), xzy(74, 8.0, 0.4)], name: 'Hubba North' },
  { id: 'WS-HB1S', kind: 'ledge', points: [xzy(70, 12.6, 1.4), xzy(72.5, 12.6, 0.4), xzy(74, 12.6, 0.4)], name: 'Hubba South' },
  { id: 'WS-VW1-C', kind: 'coping', points: [xzy(84, 22, 3.6), xzy(84, 48, 3.6)], name: 'Vert Coping', tags: ['transfer'], transferPlane: { axis: 'x', at: 84 } },
  { id: 'WS-OV', kind: 'rail', points: [xzy(84.5, 26, 4.0), xzy(84.5, 44, 4.0)], name: 'Over-vert Rail' },
  { id: 'WS-VW1-NC', kind: 'coping', points: [xzy(84, 22, 3.6), xzy(89.4, 22, 3.6)], name: 'North Pocket Coping' },
  { id: 'WS-VW1-SC', kind: 'coping', points: [xzy(84, 48, 3.6), xzy(89.4, 48, 3.6)], name: 'South Pocket Coping' },
  // The booth counter's north top edge (1.2 m: a tap reaches it).
  { id: 'WS-BT-N', kind: 'ledge', points: [xzy(36, 60.5, 1.2), xzy(40, 60.5, 1.2)], name: 'Booth Counter' },
  { id: 'WS-RR2', kind: 'rail', points: [xzy(48, 40, 0.5), xzy(52, 40, 1.15), xzy(56, 40, 1.5), xzy(60, 40, 1.15), xzy(64, 40, 0.5)], name: 'Centre Rainbow' },
  // Snake run rims: the builder's mitred offsets of the centreline (3 m each side), outer = left of travel.
  { id: 'WS-SR1-A', kind: 'coping', points: [xzy(76, 45, 0), xzy(76, 53.35, 0), xzy(65.14, 63, 0), xzy(52, 63, 0)], name: 'Snake Run Outer Rim' },
  { id: 'WS-SR1-B', kind: 'coping', points: [xzy(70, 45, 0), xzy(70, 50.65, 0), xzy(62.86, 57, 0), xzy(52, 57, 0)], name: 'Snake Run Inner Rim' },
];

const GAPS: readonly GapDef[] = [
  { id: 'WS-G01', name: 'SPINE TRANSFER', base: 500, rule: { kind: 'transferOn', rails: ['WS-SP1-W', 'WS-SP1-E'] } },
  {
    id: 'WS-G02', name: 'BOWL CARVE-OUT', base: 300,
    rule: { kind: 'airBoxToBox', startSurface: 'WS-BW1', land: { y: [-0.1, Infinity] }, landOutside: { x: [4, 24], z: [6, 26] } },
  },
  {
    id: 'WS-G03', name: 'EURO GAP', base: 400,
    rule: { kind: 'airBoxToBox', start: { x: [-Infinity, 75], z: [2, 14], y: [-0.1, Infinity] }, land: { x: [77.4, Infinity], z: [2, 14] }, eitherDirection: true },
  },
  { id: 'WS-G04', name: 'HUBBA DROP', base: 250, rule: { kind: 'grindSpan', rails: ['WS-HB1N', 'WS-HB1S'], axis: 'x', from: { op: '<=', value: 70.5 }, to: { op: '>=', value: 73 } } },
  { id: 'WS-G05', name: 'PIPE HIGH AIR', base: 600, rule: { kind: 'airApexIn', within: { x: [50, 76], z: [26, 34] }, minApexY: 5.5, landSurface: 'WS-FP1' } },
  { id: 'WS-G06', name: 'OVER THE VERT', base: 1200, rule: { kind: 'transferOn', rails: ['WS-VW1-C'], then: { land: { x: [84, Infinity], y: [3.5, Infinity] }, grindOn: ['WS-OV'] } } },
  // An air that leaves the park floor and first lands inside either bowl (the box over both, below
  // the euro gap pit's -0.6 floor): the bowls are vertical at the rim, so from 6 m/s up a rider
  // rolling in flies past the wall to the bowl floor, which the dropIn rule (transition triangle
  // first) never counted.
  { id: 'WS-G07', name: 'DROP-IN', base: 200, rule: { kind: 'airBoxToBox', startSurface: 'WS-FL', land: { x: [4, 88], z: [2, 26], y: [-Infinity, -0.7] } } },
  { id: 'WS-G08', name: 'RAINBOW', base: 350, rule: { kind: 'grindSpan', rails: ['WS-RR1'], axis: 'x', from: { op: '>=', value: 29 }, to: { op: '<=', value: 9 }, eitherDirection: true } },
  { id: 'WS-G09', name: 'CENTER RAINBOW', base: 350, rule: { kind: 'grindSpan', rails: ['WS-RR2'], axis: 'x', from: { op: '<=', value: 50 }, to: { op: '>=', value: 62 }, eitherDirection: true } },
  { id: 'WS-G10', name: 'COPING LINK', base: 700, rule: { kind: 'grindDistance', rails: ['WS-TR1'], minM: 24 } },
  // A hop over the ridge (z 56) from one slope to the other, 6 m: a tap at the line speed off the slope.
  { id: 'WS-G11', name: 'HUMP AIR', base: 300, rule: { kind: 'airBoxToBox', start: { x: [77, 83.5], z: [-Infinity, 53] }, land: { x: [77, 83.5], z: [59, Infinity] }, eitherDirection: true } },
  { id: 'WS-G12', name: 'SNAKE BITE', base: 450, rule: { kind: 'grindDistance', rails: ['WS-SR1-A', 'WS-SR1-B'], minM: 10 } },
];

const DECALS: readonly DecalDef[] = [
  // Floor arrow ahead of spawn, pointing north at the Booth Rail.
  { id: 'WS-D-ARROW', kind: 'arrow', center: xzy(34, 58.5, 0), on: 'up', width: 1.2, height: 2.4, rotDeg: 0 },
  // Sponsor wordmarks painted on the floor, well clear of every rail (REQ-LVL-04).
  { id: 'WS-D-MARK-A', kind: 'wordmark', center: xzy(15, 33, 0), on: 'up', width: 7, height: 2.2, brand: 'labB' },
  { id: 'WS-D-MARK-B', kind: 'wordmark', center: xzy(66, 19, 0), on: 'up', width: 8, height: 2.4, brand: 'chip' },
  { id: 'WS-D-MARK-C', kind: 'wordmark', center: xzy(49, 50, 0), on: 'up', width: 6, height: 2, brand: 'labA' },
  // Paint stripe on the vert deck, between the over-vert rail and the wall.
  { id: 'WS-D-DECK', kind: 'paint', center: xzy(87.6, 35, 3.6), on: 'up', width: 1.6, height: 10 },
  // A coffee ring by the booth.
  { id: 'WS-D-STAIN', kind: 'stain', center: xzy(41.6, 61.7, 0), on: 'up', width: 0.6, height: 0.6 },
];

/** Listed end-to-start feeds (REQ-WSH-02 / REQ-LVL-06 / REQ-LVL-10) with the DESIGN G.2 exit speeds. */
const FEEDS: readonly FeedDef[] = [
  { from: 'WS-RA', to: 'WS-RB', exitSpeed: 7.5, pop: 'tap' },
  { from: 'WS-RE', to: 'WS-RF', exitSpeed: 4.9, pop: 'tap' },
  { from: 'WS-FB1', to: 'WS-FB3', exitSpeed: 6.5, pop: 'full' },
  { from: 'WS-FB3', to: 'WS-HB1N', exitSpeed: 6.5, pop: 'tap' },
  { from: 'WS-QW1-C', to: 'WS-TR1', exitSpeed: 6.0, pop: 'tap' },
  { from: 'WS-TR1', to: 'WS-QE1-C', exitSpeed: 6.0, pop: 'tap' },
];

export const WOODSHED: LevelDef = {
  id: 'woodshed',
  name: 'Woodshed',
  size: { x: 90, z: 70 },
  environment: 'woodshedInterior',
  spawn: { pos: xzy(34, 62, 0), facing: 'north' },
  spawnArea: { x0: 20, z0: 50, x1: 42, z1: 66 },
  primitives: PRIMITIVES,
  rails: RAILS,
  gaps: GAPS,
  letters: [
    { letter: 'C', pos: xzy(14, 5.6, 2.8) },
    { letter: 'O', pos: xzy(76.2, 8, 2.0) },
    { letter: 'D', pos: xzy(60, 32.8, 6.2) },
    { letter: 'E', pos: xzy(84.5, 40, 4.9) },
  ],
  // SPEC §9.2 "needs speed + transfer": a plain spine roll-up at 10 m/s reached y 5.5 too, so the pickup
  // is gated on a transfer in the same air (MacGuffinDef.needs, polish round 2).
  macguffin: { id: 'secret_drive', pos: xzy(43, 28, 5.5), needs: { transferInAir: true } },
  npcs: [{ id: 'dario', pos: xzy(41, 61, 0), facing: 'north', outfit: 'contestJacket', prop: 'coffee' }],
  goals: WOODSHED_GOALS,
  decals: DECALS,
  feeds: FEEDS,
};
