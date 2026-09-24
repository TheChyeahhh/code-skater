/**
 * src/levels/marketStreetLines.ts (street track): the four Market Street lines of DESIGN G.1 as data
 * (REQ-STR-02), one letter per line. Each line is an ordered list of steps; a step is a feature (or
 * an approach roll) with the point where the skater joins it (`from`), the point where they leave
 * it (`to`), how they reach `from` from the previous step's `to` (`via`: roll = ground, bank or
 * transition, any length, steering allowed; hop = an ollie, no steer) and what the step itself is
 * (`move`: roll, grind or air). The rules tests/marketStreet.test.ts holds every line to, against
 * TUNING at test time:
 *  - every hop and every air fits the air time of a full ollie at the typical speed and its rise
 *    fits a full ollie (DESIGN C.6 "derived feel numbers");
 *  - a hop leaves along the previous step's exit tangent: air has no steer, so the hop vector must
 *    be within GRIND_ENTRY_MAX_DEG of that tangent with at most the REQ-LVL-06 lateral offset;
 *  - a grind step's ends lie on its rail; each line's letter hangs over its `letterStep`;
 *  - line 2's roof launch, traced with the transition, pop and vert rules of DESIGN C.6 from the
 *    recorded `minSpeed`, lands on the dock roof.
 * Nothing at runtime reads this file; it is the design's playability contract for the level.
 */

import { xzy } from '../core/math';
import type { LetterId, Vec3 } from '../core/types';

export interface LineStep {
  /** Feature id (a rail, surface or gap) or a plain label for a roll. */
  readonly feature: string;
  /** How the skater reaches `from` from the previous step's `to`. */
  readonly via: 'roll' | 'hop';
  /** What happens between `from` and `to`. */
  readonly move: 'roll' | 'grind' | 'air';
  readonly from: Vec3;
  readonly to: Vec3;
  /** Gap ids this step earns (documentation, cross-checked against the gap list). */
  readonly gaps?: readonly string[];
  /** Speed the step needs at `from`, m/s (documentation; the tests trace the steps that record one). */
  readonly minSpeed?: number;
}

export interface StreetLine {
  readonly index: 1 | 2 | 3 | 4;
  readonly letter: LetterId;
  readonly name: string;
  readonly steps: readonly LineStep[];
  /** Index of the step whose path passes under the letter. */
  readonly letterStep: number;
}

/** Line 2 pops off MS-Q3 where the face slope is this steep (below VERT_POP_SCALE's 45 deg cliff). */
export const STREET_Q3_POP_SLOPE_DEG = 40;
/**
 * Where that pop point is on MS-Q3 (footLine 84.33, coping z 88 at y 3.5, radius 4.0 above the 1.1
 * platform). The lip tops out at 66 deg, below VERT_ASSIST_MIN_SLOPE_DEG, so a roll-off launches onto
 * the roof too and the pop window spans about a metre of the face instead of a few ticks.
 */
export const STREET_Q3_POP_POINT: Vec3 = xzy(101.4, 86.9, 2.036);

export const MARKET_STREET_LINES: readonly StreetLine[] = [
  {
    index: 1,
    letter: 'C',
    name: 'Plaza to street',
    letterStep: 4,
    steps: [
      // Past SAM, steering toward the west hubba (the terrace planter beside it is the optional opener).
      { feature: 'spawn', via: 'roll', move: 'roll', from: xzy(46, 30, 0.8), to: xzy(42.2, 36.8, 0.8) },
      { feature: 'MS-L1', via: 'hop', move: 'grind', from: xzy(41.6, 38, 1.4), to: xzy(41.6, 46, 0.4), gaps: ['MS-G01'] },
      { feature: 'MS-R10', via: 'hop', move: 'grind', from: xzy(41.6, 49, 0.6), to: xzy(41.6, 57, 0.6), gaps: ['MS-G03'] },
      // The bar exits west of the fountain foot; the manual drifts east to the stairs' centre line x 46
      // (DESIGN G.1 line 1 "manual south along x 46"), where the C hangs: air has no steer, so the stair
      // air must leave on the letter's line.
      { feature: 'manual south', via: 'hop', move: 'roll', from: xzy(41.6, 60, 0), to: xzy(46, 87.6, 0) },
      { feature: 'MS-G05', via: 'roll', move: 'air', from: xzy(46, 87.6, 0), to: xzy(46, 92.5, -1.2), gaps: ['MS-G05'] },
      { feature: 'MS-G06', via: 'roll', move: 'roll', from: xzy(46, 93, -1.2), to: xzy(46, 100.5, -1.2), gaps: ['MS-G06'] },
      { feature: 'MS-B3', via: 'roll', move: 'roll', from: xzy(46, 104, -1.2), to: xzy(46, 106.4, 0) },
      { feature: 'MS-Q1', via: 'roll', move: 'roll', from: xzy(46, 115.3, 0), to: xzy(46, 117.5, 2.2) },
      { feature: 'MS-Q1 air', via: 'roll', move: 'air', from: xzy(46, 117.5, 2.2), to: xzy(46, 117.3, 2.0) },
      { feature: 'manual north', via: 'roll', move: 'roll', from: xzy(46, 112, 0), to: xzy(46, 100, 0) },
    ],
  },
  {
    index: 2,
    letter: 'O',
    name: 'Alley dock to the depot roof',
    letterStep: 11,
    steps: [
      { feature: 'terrace east', via: 'roll', move: 'roll', from: xzy(100, 30, 0.8), to: xzy(101, 40, 0.8) },
      { feature: 'MS-B5', via: 'roll', move: 'roll', from: xzy(101, 40, 0.8), to: xzy(101, 42.4, 0) },
      { feature: 'alley', via: 'roll', move: 'roll', from: xzy(101, 42.4, 0), to: xzy(101, 68, 0) },
      { feature: 'MS-L6', via: 'hop', move: 'grind', from: xzy(101, 70, 1.1), to: xzy(101, 80, 1.1) },
      // 4.1 m of platform (D2) to push before the dock quarter's foot.
      { feature: 'MS-D2', via: 'roll', move: 'roll', from: xzy(101.2, 80.2, 1.1), to: xzy(101.4, 84.33, 1.1) },
      { feature: 'MS-Q3', via: 'roll', move: 'roll', from: xzy(101.4, 84.33, 1.1), to: STREET_Q3_POP_POINT, minSpeed: 7.5 },
      { feature: 'MS-G09', via: 'roll', move: 'air', from: STREET_Q3_POP_POINT, to: xzy(101.4, 89.1, 3.5), gaps: ['MS-G09'] },
      // Heading south on the dock roof: push into the mini quarter, air, revert.
      { feature: 'dock roof', via: 'roll', move: 'roll', from: xzy(101.4, 89.1, 3.5), to: xzy(102, 98.2, 3.5) },
      { feature: 'MS-Q5', via: 'roll', move: 'roll', from: xzy(102, 98.2, 3.5), to: xzy(102, 99.96, 4.83) },
      { feature: 'MS-Q5 air', via: 'roll', move: 'air', from: xzy(102, 99.96, 4.83), to: xzy(102, 99.7, 4.6) },
      // Revert, roll north-west off the face, push to the slot edge.
      { feature: 'revert north-west', via: 'roll', move: 'roll', from: xzy(102, 97, 3.5), to: xzy(95.4, 93.5, 3.5) },
      { feature: 'MS-G10', via: 'roll', move: 'air', from: xzy(95.2, 93.5, 3.5), to: xzy(89.9, 94, 3.5), gaps: ['MS-G10'] },
      // The vent pipe runs on z 97, clear of the slot lane: land, carve south-west, hop on at 36 deg.
      { feature: 'MS-DP roof', via: 'roll', move: 'roll', from: xzy(89.9, 94, 3.5), to: xzy(88, 95.4, 3.5) },
      { feature: 'MS-R6', via: 'hop', move: 'grind', from: xzy(85.83, 97, 3.9), to: xzy(82.5, 97, 3.9) },
      { feature: 'street', via: 'hop', move: 'roll', from: xzy(79, 97, -1.2), to: xzy(70, 97, -1.2) },
    ],
  },
  {
    index: 3,
    letter: 'D',
    name: 'Fountain mini-vert',
    letterStep: 3,
    steps: [
      { feature: 'MS-R1', via: 'roll', move: 'grind', from: xzy(50.2, 49, 0.6), to: xzy(50.2, 57, 0.6) },
      // Hops off the bar end onto the flat 2.4 m past it (the fountain foot is 4 m past the bar, so the
      // hop never lands on the steep face), rolls up the fall line (the fountain centre is on the bar
      // lane) to the rim, vert air straight up through the D.
      { feature: 'plaza', via: 'hop', move: 'roll', from: xzy(50.2, 59.4, 0), to: xzy(50.4, 60.9, 0) },
      { feature: 'MS-F1 face', via: 'roll', move: 'roll', from: xzy(50.4, 60.9, 0), to: xzy(50.4, 62.6, 1.1) },
      { feature: 'MS-F1 air', via: 'roll', move: 'air', from: xzy(50.4, 62.6, 1.1), to: xzy(50.4, 62.5, 1.0) },
      { feature: 'revert manual north', via: 'roll', move: 'roll', from: xzy(50.4, 60.8, 0), to: xzy(50.4, 48, 0) },
      { feature: 'MS-L2', via: 'hop', move: 'grind', from: xzy(50.4, 46, 0.4), to: xzy(50.4, 38, 1.4), gaps: ['MS-G01'] },
      // The uphill hubba bleeds the 5 m/s the manual brings to about 2.5 m/s at its top: the planter
      // starts 0.75 m past it, inside a tap at that speed.
      { feature: 'MS-PL2', via: 'hop', move: 'grind', from: xzy(50.4, 37.25, 1.4), to: xzy(50.4, 32.25, 1.4), minSpeed: 2.7 },
      { feature: 'terrace', via: 'hop', move: 'roll', from: xzy(50.4, 30.25, 0.8), to: xzy(50.4, 24, 0.8) },
    ],
  },
  {
    index: 4,
    letter: 'E',
    name: 'Scaffold climb to the Laptop',
    letterStep: 2,
    steps: [
      { feature: 'MS-B5', via: 'roll', move: 'roll', from: xzy(104.3, 40, 0.8), to: xzy(104.3, 41.5, 0.3) },
      { feature: 'MS-P1', via: 'hop', move: 'grind', from: xzy(104.3, 43, 1.08), to: xzy(104.3, 52, 1.8) },
      { feature: 'MS-P2', via: 'hop', move: 'grind', from: xzy(104.3, 54, 2.6), to: xzy(104.3, 62, 3.4) },
      { feature: 'MS-P3', via: 'hop', move: 'grind', from: xzy(104.3, 64, 4.2), to: xzy(104.3, 70, 5.2), gaps: ['MS-G11'] },
      { feature: 'MS-R7', via: 'hop', move: 'grind', from: xzy(104.8, 72, 6.3), to: xzy(104.8, 87, 6.3) },
      { feature: 'MS-G12', via: 'roll', move: 'air', from: xzy(104.8, 88, 6.0), to: xzy(104.8, 92, 3.5), gaps: ['MS-G12'] },
      { feature: 'MS-G10', via: 'roll', move: 'air', from: xzy(95.2, 94, 3.5), to: xzy(89.9, 94, 3.5), gaps: ['MS-G10'] },
      { feature: 'MS-DP roof', via: 'roll', move: 'roll', from: xzy(89.9, 94, 3.5), to: xzy(84, 96, 3.5) },
    ],
  },
];
