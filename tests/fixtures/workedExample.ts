/**
 * tests/fixtures/workedExample.ts (logic track): DESIGN.md D.3, the worked example, as data
 * (REQ-TST-05, REQ-SCR-01). Every number below is copied from D.3; tests/scoring.test.ts drives the
 * real Scoring class with these steps and asserts each intermediate number.
 *
 * Hold times are whole ticks at 120 Hz (1.0 s = 120 ticks, 0.8 s = 96, 1.8 s = 216, 1.5 s = 180).
 * Spin credit is added when the air that holds it ends (REQ-VRT-05): the kickflip's 180 at the
 * snap onto MS-L2, the heelflip's 360 at the final landing.
 * The gap element uses the level's real gap id MS-G03 ("PLAZA BAR HOP", G.1); D.3 labels the same
 * gap "gap:PLAZA_BAR_HOP".
 */

import type { Stance } from '../../src/core/types';
import type { ElementRef } from '../../src/sim/types';

export interface WorkedStep {
  /** D.3 row number. */
  readonly n: number;
  readonly label: string;
  readonly ref: ElementRef;
  readonly stance: Stance;
  readonly holdable: boolean;
  /** Ticks the element is held before the next one is added (0 = not holdable). */
  readonly holdTicks: number;
  readonly railId?: string;
  readonly gap?: { readonly name: string; readonly base: number };
  /** 180s credited when the air holding this element ends, before the next element (or the bank). */
  readonly spinsAfter: number;
  readonly expected: {
    readonly id: string;
    readonly base: number;
    readonly stanceMult: number;
    readonly timesBefore: number | null;
    readonly degradation: number;
    readonly value: number;
    readonly accrual: number;
  };
}

export const WORKED_EXAMPLE = {
  /** Run history before the combo: kickflip once, boardslide once, everything else 0. */
  historyBefore: { kickflip: 1, boardslide: 1 } as Readonly<Record<string, number>>,
  steps: [
    {
      n: 1, label: 'Full ollie off the terrace, Kickflip (Square+L)', ref: { kind: 'trick', trickId: 'kickflip' },
      stance: 'regular', holdable: false, holdTicks: 0, spinsAfter: 1,
      expected: { id: 'kickflip', base: 100, stanceMult: 1.0, timesBefore: 1, degradation: 0.9, value: 90, accrual: 0 },
    },
    {
      n: 2, label: 'Snap hubba L2, Triangle neutral', ref: { kind: 'trick', trickId: 'fifty_fifty' },
      stance: 'regular', holdable: true, holdTicks: 120, railId: 'MS-L2', spinsAfter: 0,
      expected: { id: 'fifty_fifty', base: 100, stanceMult: 1.0, timesBefore: 0, degradation: 1.0, value: 100, accrual: 80 },
    },
    {
      n: 3, label: 'DR + Triangle mid-ledge (same object)', ref: { kind: 'trick', trickId: 'smith' },
      stance: 'regular', holdable: true, holdTicks: 96, railId: 'MS-L2', spinsAfter: 0,
      expected: { id: 'smith', base: 180, stanceMult: 1.0, timesBefore: 0, degradation: 1.0, value: 180, accrual: 72 },
    },
    {
      n: 4, label: 'Ollie from the hubba end onto the flat bar R1: gap', ref: { kind: 'gap', gapId: 'MS-G03' },
      stance: 'regular', holdable: false, holdTicks: 0, gap: { name: 'PLAZA BAR HOP', base: 500 }, spinsAfter: 0,
      expected: { id: 'gap:MS-G03', base: 500, stanceMult: 1.0, timesBefore: null, degradation: 1.0, value: 500, accrual: 0 },
    },
    {
      n: 5, label: 'L + Triangle, rail on toe side', ref: { kind: 'trick', trickId: 'boardslide' },
      stance: 'regular', holdable: true, holdTicks: 216, railId: 'MS-R1', spinsAfter: 0,
      expected: { id: 'boardslide', base: 120, stanceMult: 1.0, timesBefore: 1, degradation: 0.9, value: 108, accrual: 162 },
    },
    {
      n: 6, label: 'Low pop on the fountain face, R2 in the pre-buffer, land on vert', ref: { kind: 'trick', trickId: 'revert' },
      stance: 'regular', holdable: false, holdTicks: 0, spinsAfter: 0,
      expected: { id: 'revert', base: 100, stanceMult: 1.0, timesBefore: 0, degradation: 1.0, value: 100, accrual: 0 },
    },
    {
      n: 7, label: 'Up,Down within 200 ms (stance is now switch)', ref: { kind: 'trick', trickId: 'manual' },
      stance: 'switch', holdable: true, holdTicks: 180, spinsAfter: 0,
      expected: { id: 'switch_manual', base: 50, stanceMult: 1.2, timesBefore: 0, degradation: 1.0, value: 60, accrual: 60 },
    },
    {
      n: 8, label: 'Ollie out, Square+R, 360 spin, land clean', ref: { kind: 'trick', trickId: 'heelflip' },
      stance: 'switch', holdable: false, holdTicks: 0, spinsAfter: 2,
      expected: { id: 'switch_heelflip', base: 100, stanceMult: 1.2, timesBefore: 0, degradation: 1.0, value: 120, accrual: 0 },
    },
  ] as readonly WorkedStep[],
  trickValueSum: 1258,
  accrualSum: 374,
  comboBase: 1632,
  elements: 8,
  spin180s: 3,
  spinBonus: 1.5,
  multiplier: 9.5,
  final: 15504,
  /** Off-axis of the final landing: "land clean". */
  landOffAxisDeg: 0,
  landQuality: 'sick' as const,
  /** Special meter fed across the combo: 1632 / 6000. */
  specialFed: 0.272,
  historyAfter: {
    kickflip: 2, fifty_fifty: 1, smith: 1, boardslide: 2, revert: 1, switch_manual: 1, switch_heelflip: 1,
  } as Readonly<Record<string, number>>,
} as const;
