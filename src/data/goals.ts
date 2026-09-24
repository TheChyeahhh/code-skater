/**
 * src/data/goals.ts: goal types and small pure helpers (REQ-GOL-*, REQ-STR-06, REQ-WSH-06). Frozen.
 *
 * The goal LISTS are authored in each level file (LevelDef.goals) by the street and woodshed
 * tracks, 10 per park, exactly as DESIGN G.1 / G.2. Evaluation happens in the sim
 * (src/sim/run.ts); persistence in the app through src/save (REQ-SAV-03). A goal that references an
 * element counts when the combo containing it BANKS (DESIGN G.1 note, open question 6).
 * Score thresholds are TUNING keys, never numbers, so the dev panel and tests read one source.
 */

import { TUNING, type NumericTuningKey } from '../core/tuning';
import type { LevelId, MacGuffinId, ParkId, SpecialId, TrickCategory } from '../core/types';
import { BRANDS } from './brands';

export type GoalCondition =
  /** Run score >= TUNING[threshold] at run end (High / Pro / Sick). */
  | { readonly kind: 'runScore'; readonly threshold: NumericTuningKey }
  /** Any single banked FINAL >= TUNING[threshold] (High Combo). */
  | { readonly kind: 'comboScore'; readonly threshold: NumericTuningKey }
  /** All four letters collected within one run (C-O-D-E, REQ-GOL-05). */
  | { readonly kind: 'letters' }
  /** The park's MacGuffin collected (any run; once per career). */
  | { readonly kind: 'macguffin'; readonly id: MacGuffinId }
  /** A named gap inside a banked combo. */
  | { readonly kind: 'gapInBankedCombo'; readonly gapId: string }
  /**
   * A banked combo with FINAL >= TUNING[threshold] during which the skater contacted surfaceId
   * or earned orGapId (Street goal 10, "5,000 over the fountain").
   */
  | { readonly kind: 'comboWithSurface'; readonly threshold: NumericTuningKey; readonly surfaceId: string; readonly orGapId?: string }
  /** A holdable special from specialIds held >= TUNING[seconds] presentation seconds, in a banked combo (Woodshed goal 9). */
  | { readonly kind: 'specialHeld'; readonly specialIds: readonly SpecialId[]; readonly seconds: NumericTuningKey }
  /**
   * A banked combo containing >= TUNING[count] occurrences of an element of category `first`
   * immediately followed by one of category `then` (Woodshed goal 10: revert then manual, any id).
   */
  | { readonly kind: 'sequenceInCombo'; readonly first: TrickCategory; readonly then: TrickCategory; readonly count: NumericTuningKey };

export interface GoalDef {
  /** Stable id used in saves, e.g. "MS-GOAL-07". */
  readonly id: string;
  readonly levelId: LevelId;
  /** 1..10, the order in DESIGN G. */
  readonly index: number;
  /** Display name; ignored when nameFromMacGuffin is set. No em dashes. */
  readonly name: string;
  /** Read the name from BRANDS.macguffins (the two MacGuffin goals, Street 6 and Woodshed 6). */
  readonly nameFromMacGuffin?: MacGuffinId;
  readonly condition: GoalCondition;
  readonly reqId: string;
}

/** Brand-resolved goal name. */
export function goalName(goal: GoalDef): string {
  return goal.nameFromMacGuffin ? BRANDS.macguffins[goal.nameFromMacGuffin].name : goal.name;
}

/** REQ-GOL-03: Woodshed unlocks at UNLOCK_WOODSHED_GOALS completed Street goals. */
export function isWoodshedUnlocked(completedStreetGoals: number): boolean {
  return completedStreetGoals >= TUNING.UNLOCK_WOODSHED_GOALS;
}

/** REQ-GOL-04: both MacGuffins collected -> Lab Circuit stamp. */
export function hasLabCircuit(collected: readonly MacGuffinId[]): boolean {
  return collected.includes('secret_laptop') && collected.includes('secret_drive');
}

/** The MacGuffin that belongs to a park. */
export function parkMacGuffin(park: ParkId): MacGuffinId {
  return park === 'marketStreet' ? 'secret_laptop' : 'secret_drive';
}

/** Parks in career order. */
export const PARKS: readonly ParkId[] = ['marketStreet', 'woodshed', 'labCampus'];
