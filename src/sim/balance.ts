/**
 * src/sim/balance.ts (logic track): the balance needle (SPEC §6, CR-02, CR-06, REQ-BAL-01..05). Pure.
 *
 * Per tick (REQ-BAL-01):
 *   nv += (k x sign(needle) x cw + input x BAL_INPUT_ACCEL) x dt
 *   nv x= (1 - BAL_DAMP x dt)
 *   needle += nv x dt                         bail when |needle| >= 1 (needle clamped to [-1, 1])
 *   k  = BAL_K0 x (1 + BAL_ELEMENT_GAIN x elementsBefore) x (BAL_SAME_OBJECT_MULT if same object)
 *        x switchDrift / statFactor(STAT_BALANCE)
 *   cw = CONTEXT_WINDOW_DRIFT_MULT while Context Window is held, else 1
 *   switchDrift (stance switch) = 1 + (SWITCH_DRIFT_MULT - 1) x (10 - STAT_SWITCH) / 6  (1.35 at stat 4, CR-19)
 *   (10 = the stat maximum, 6 = 10 minus the default switch stat 4, read from TUNING_META / TUNING_DEFAULTS)
 * Input sign: REQ-BAL-03 is the rule, "Left = input -1 pushes the needle negative", so the input
 * term is ADDED. DESIGN's REQ-BAL-01 prints "- input x 2.0", which contradicts REQ-BAL-03 and would
 * make the stick steer the needle further into the lean; submitted as a CHANGE-REQUEST.
 * Re-centre on each new grind / lip / manual element (REQ-BAL-02): needle = BAL_RECENTER x
 * sign(previous needle), or BAL_START_OFFSET x rng.sign() for the first element; velocity 0.
 * Input axis and sign (REQ-BAL-03): manual = vertical, Up = -1 (nose down, negative);
 * grind and lip = horizontal, Left = -1 (negative, drawn left of centre).
 */

import type { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { statFactor, TUNING, TUNING_DEFAULTS, TUNING_META } from '../core/tuning';
import type { Vec2 } from '../core/types';
import type { BalanceAxis, BalanceState, DriftParams } from './types';

/** REQ-CTL-13 / CR-19: drift factor in switch stance, SWITCH_DRIFT_MULT at the default switch stat. */
export function switchDriftMult(): number {
  const max = TUNING_META.STAT_SWITCH.max;
  const ref = TUNING_DEFAULTS.STAT_SWITCH;
  return 1 + (TUNING.SWITCH_DRIFT_MULT - 1) * (max - TUNING.STAT_SWITCH) / (max - ref);
}

/** k for a new linker (REQ-BAL-01, REQ-BAL-04, REQ-BAL-05), Context Window excluded. */
export function driftK(params: DriftParams): number {
  const elements = TUNING.BAL_K0 * (1 + TUNING.BAL_ELEMENT_GAIN * params.elementsBefore);
  const same = params.sameObject ? TUNING.BAL_SAME_OBJECT_MULT : 1;
  const sw = params.switchStance ? switchDriftMult() : 1;
  return (elements * same * sw) / statFactor(TUNING.STAT_BALANCE);
}

/** Start or re-centre the needle for a new element (REQ-BAL-02). prev = the last needle state in this combo, or null. */
export function startBalance(prev: BalanceState | null, axis: BalanceAxis, k: number, rng: Rng): BalanceState {
  const prevSign = prev ? Math.sign(prev.needle) : 0;
  // A centred previous needle (exactly 0) has no sign to keep: use a seeded coin so it never sits still.
  const needle = prev
    ? TUNING.BAL_RECENTER * (prevSign !== 0 ? prevSign : rng.sign())
    : TUNING.BAL_START_OFFSET * rng.sign();
  return { needle, velocity: 0, axis, k, active: true };
}

/** One tick of needle dynamics. input in [-1, 1] after balanceInput(). */
export function stepBalance(state: BalanceState, input: number, dtS: number, contextWindowHeld: boolean): BalanceState {
  if (!state.active) return state;
  const cw = contextWindowHeld ? TUNING.CONTEXT_WINDOW_DRIFT_MULT : 1;
  // Founder 2026-09-23 ("manuals don't last as long as they should"): manual drift is gentler.
  const axisMult = state.axis === 'v' ? TUNING.BAL_MANUAL_DRIFT_MULT : 1;
  let v = state.velocity + (state.k * Math.sign(state.needle) * cw * axisMult + input * TUNING.BAL_INPUT_ACCEL) * dtS;
  v *= 1 - TUNING.BAL_DAMP * dtS;
  const needle = clamp(state.needle + v * dtS, -1, 1);
  return { ...state, needle, velocity: v };
}

/** REQ-BAL-03: map InputFrame.dirAxis to the needle input for this axis (manual: -dirAxis.y; grind/lip: dirAxis.x). */
export function balanceInput(axis: BalanceAxis, dirAxis: Vec2): number {
  // `+ 0` turns a -0 (neutral stick on the manual axis) into 0.
  return clamp(axis === 'v' ? -dirAxis.y : dirAxis.x, -1, 1) + 0;
}

export function isBalanceBail(state: BalanceState): boolean {
  return state.active && Math.abs(state.needle) >= 1;
}

/** Linker ended without a bail: inactive, keeps the needle sign for the next re-centre. */
export function stopBalance(state: BalanceState): BalanceState {
  return { ...state, velocity: 0, active: false };
}
