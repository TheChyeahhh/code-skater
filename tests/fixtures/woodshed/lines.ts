/**
 * tests/fixtures/woodshed/lines.ts (woodshed track): the four Woodshed lines of SPEC §9.2 / DESIGN
 * G.2 as checkable data, plus the DESIGN G.2 rail chain. tests/woodshed.test.ts walks them against
 * the built level: floor rolls must run over flat floor (or the named feature) with no wall or
 * unrelated low rail in the way, rail hops must satisfy the feed rule, and each letter must hang by
 * the feature its line uses. Coordinates are (x, z) on the ground unless noted.
 */

import type { LetterId } from '../../../src/core/types';

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export type LineBeat =
  /** A flat roll (or manual) from a to b: floor at y 0 all the way, only `over` surfaces besides the floor, no walls or stray low rails. */
  | { readonly kind: 'roll'; readonly a: GroundPoint; readonly b: GroundPoint; readonly over?: readonly string[] }
  /** Riding a feature: the surface must exist (bowl, pipe, quarter-pipe, spine, channel). */
  | { readonly kind: 'feature'; readonly surface: string }
  /** A grind on a named rail. */
  | { readonly kind: 'grind'; readonly rail: string }
  /** A rail end feeding the next rail's start (REQ-LVL-06 / REQ-LVL-10). */
  | { readonly kind: 'hop'; readonly from: string; readonly to: string; readonly speed: number; readonly pop: 'tap' | 'full' }
  /** Two rails side by side, joined by a transfer air or a hop across (lateral offset and rise only). */
  | { readonly kind: 'sideHop'; readonly from: string; readonly to: string }
  /** A spine transfer over a tagged rail pair. */
  | { readonly kind: 'transfer'; readonly rails: readonly string[] }
  /** The letter this line collects, and the rail or surface it hangs by. */
  | { readonly kind: 'letter'; readonly letter: LetterId; readonly byRail?: string; readonly bySurface?: string };

export interface LineDef {
  readonly index: number;
  readonly letter: LetterId;
  readonly beats: readonly LineBeat[];
}

/** SPEC §9.2 lines 1 to 4, one letter each. */
export const WOODSHED_LINES: readonly LineDef[] = [
  {
    // (1) bowl pump -> spine transfer -> rainbow rail -> manual -> QP revert
    index: 1,
    letter: 'C',
    beats: [
      // West along the spawn row (the booth is east of spawn), north up the lane between the west wall
      // and the rail rows, into the bowl's south rim.
      { kind: 'roll', a: { x: 34, z: 62 }, b: { x: 5, z: 62 } },
      { kind: 'roll', a: { x: 5, z: 62 }, b: { x: 4.5, z: 30 } },
      { kind: 'roll', a: { x: 4.5, z: 30 }, b: { x: 12, z: 27.5 } },
      { kind: 'feature', surface: 'WS-BW1' },
      { kind: 'letter', letter: 'C', bySurface: 'WS-BW1' },
      { kind: 'roll', a: { x: 26, z: 22 }, b: { x: 39.5, z: 40 } },
      { kind: 'feature', surface: 'WS-SP1' },
      { kind: 'transfer', rails: ['WS-SP1-W', 'WS-SP1-E'] },
      { kind: 'roll', a: { x: 46.5, z: 40 }, b: { x: 47.5, z: 40 } },
      { kind: 'grind', rail: 'WS-RR2' },
      // East past the snake run's mouth, south down the lane between the vert wall and the run, over
      // the hump (a manual across it or HUMP AIR), into WS-QE1 head-on.
      { kind: 'roll', a: { x: 64.5, z: 40 }, b: { x: 78, z: 40 } },
      { kind: 'roll', a: { x: 78, z: 40 }, b: { x: 80, z: 51 } },
      { kind: 'roll', a: { x: 80, z: 51 }, b: { x: 80, z: 66.5 }, over: ['WS-H1'] },
      { kind: 'feature', surface: 'WS-H1' },
      { kind: 'feature', surface: 'WS-QE1' },
    ],
  },
  {
    // (2) street-course flat bar -> hubba -> euro gap -> bowl drop-in
    index: 2,
    letter: 'O',
    beats: [
      { kind: 'roll', a: { x: 40, z: 8 }, b: { x: 46.5, z: 8 } },
      { kind: 'grind', rail: 'WS-FB1' },
      { kind: 'hop', from: 'WS-FB1', to: 'WS-FB3', speed: 6.5, pop: 'full' },
      { kind: 'grind', rail: 'WS-FB3' },
      { kind: 'hop', from: 'WS-FB3', to: 'WS-HB1N', speed: 6.5, pop: 'tap' },
      { kind: 'grind', rail: 'WS-HB1N' },
      { kind: 'feature', surface: 'WS-EG1' },
      { kind: 'letter', letter: 'O', bySurface: 'WS-EG1' },
      { kind: 'roll', a: { x: 78.2, z: 8 }, b: { x: 79.6, z: 8.6 } },
      { kind: 'feature', surface: 'WS-BW2' },
    ],
  },
  {
    // (3) full-pipe air -> revert -> manual -> snake-run coping
    index: 3,
    letter: 'D',
    beats: [
      { kind: 'roll', a: { x: 47, z: 30 }, b: { x: 49.5, z: 30 } },
      { kind: 'feature', surface: 'WS-FP1' },
      { kind: 'letter', letter: 'D', bySurface: 'WS-FP1' },
      // Out of the east mouth, then south-west into the snake run's north mouth ramp.
      { kind: 'roll', a: { x: 76.5, z: 30 }, b: { x: 79, z: 30 } },
      { kind: 'roll', a: { x: 79, z: 30 }, b: { x: 74, z: 44 }, over: ['WS-SR1'] },
      { kind: 'feature', surface: 'WS-SR1' },
      { kind: 'grind', rail: 'WS-SR1-A' },
      // Out of the west ramp, past the booth's north side, to the spawn.
      { kind: 'roll', a: { x: 48.5, z: 60 }, b: { x: 42, z: 58 } },
      { kind: 'roll', a: { x: 42, z: 58 }, b: { x: 34, z: 58 } },
    ],
  },
  {
    // (4) vert wall -> transfer to the over-vert rail (E) -> back in -> manual west -> spine transfer -> peak rail (the Drive)
    index: 4,
    letter: 'E',
    beats: [
      { kind: 'roll', a: { x: 76.5, z: 30 }, b: { x: 80.5, z: 30 } },
      { kind: 'feature', surface: 'WS-VW1' },
      { kind: 'transfer', rails: ['WS-VW1-C'] },
      { kind: 'sideHop', from: 'WS-VW1-C', to: 'WS-OV' },
      { kind: 'grind', rail: 'WS-OV' },
      { kind: 'letter', letter: 'E', byRail: 'WS-OV' },
      { kind: 'roll', a: { x: 80.5, z: 37 }, b: { x: 47, z: 37 } },
      { kind: 'feature', surface: 'WS-SP1' },
      { kind: 'transfer', rails: ['WS-SP1-W', 'WS-SP1-E'] },
      { kind: 'sideHop', from: 'WS-SP1-E', to: 'WS-SP1-P' },
      { kind: 'grind', rail: 'WS-SP1-P' },
    ],
  },
];

/**
 * The DESIGN G.2 20 s rails + manuals chain: rail steps with the speed after each (m/s) and the
 * manual runs between them (length in m, average speed). Times are lengths / speeds.
 */
export const WOODSHED_CHAIN: readonly (
  | { readonly kind: 'rail'; readonly id: string; readonly speedAfter: number }
  | { readonly kind: 'manual'; readonly lengthM: number; readonly speed: number }
  | { readonly kind: 'hop'; readonly from: string; readonly to: string; readonly speed: number; readonly pop: 'tap' | 'full' }
)[] = [
  { kind: 'rail', id: 'WS-RA', speedAfter: 7.5 },
  { kind: 'hop', from: 'WS-RA', to: 'WS-RB', speed: 7.5, pop: 'tap' },
  { kind: 'rail', id: 'WS-RB', speedAfter: 7.8 },
  { kind: 'manual', lengthM: 13.4, speed: 7.2 }, // half-circle of diameter 7.1 (RB row 38.3 -> RR1 row 45.4) + 2.3 m straight
  { kind: 'rail', id: 'WS-RR1', speedAfter: 6.6 },
  { kind: 'manual', lengthM: 12.7, speed: 6.0 }, // half-circle of diameter 6.2 (RR1 row 45.4 -> RE row 51.6) + 3 m straight
  { kind: 'rail', id: 'WS-RE', speedAfter: 4.9 },
  { kind: 'hop', from: 'WS-RE', to: 'WS-RF', speed: 4.9, pop: 'tap' },
  { kind: 'rail', id: 'WS-RF', speedAfter: 5.2 },
  { kind: 'manual', lengthM: 14.0, speed: 4.5 },
];

/**
 * Rail rows a manual half-circle turn joins in the chain: [from rail, to rail, speed at the turn].
 * The row spacing is the turn's diameter 2 v / w: it must be reachable at or under
 * TURN_RATE_MANUAL_DPS with a little slack (the script may turn slower than the maximum, never faster).
 */
export const WOODSHED_CHAIN_TURNS: readonly (readonly [string, string, number])[] = [
  ['WS-RA', 'WS-RR1', 7.5],
  ['WS-RR1', 'WS-RE', 6.3],
];
