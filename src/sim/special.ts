/**
 * src/sim/special.ts (logic track): the special meter (SPEC §6, REQ-SPC-01..06). Pure.
 * - Fed per completed element: meter += (value + accrual) / SPECIAL_FULL_BASE, clamped to [0, 1].
 * - Idle drain SPECIAL_DRAIN_PER_S per second after SPECIAL_IDLE_DELAY_S without a completed element;
 *   the drain pauses while a combo is alive. idleS keeps counting either way (seconds since the last
 *   completed element); only the time past the delay drains, so the first draining tick drains the
 *   part of dt beyond the delay.
 * - Glowing turns on at meter >= 1 and off below SPECIAL_GLOW_OFF (hysteresis). Glowing enables
 *   specials and +GLOW_SPEED_BONUS vmax. A special does NOT spend the meter (REQ-SPC-06).
 * - Bail empties the meter and ends glowing immediately (REQ-SPC-04).
 */

import { clamp } from '../core/math';
import { TUNING } from '../core/tuning';
import type { SpecialState, SpecialStep } from './types';

export function createSpecial(): SpecialState {
  return { meter: 0, glowing: false, idleS: 0 };
}

/** Hysteresis (REQ-SPC-03): on at a full meter, off only below SPECIAL_GLOW_OFF. */
function glowFor(wasGlowing: boolean, meter: number): boolean {
  if (wasGlowing) return meter >= TUNING.SPECIAL_GLOW_OFF;
  return meter >= 1;
}

function step(prev: SpecialState, meter: number, idleS: number): SpecialStep {
  const glowing = glowFor(prev.glowing, meter);
  return {
    state: { meter, glowing, idleS },
    becameGlowing: glowing && !prev.glowing,
    stoppedGlowing: !glowing && prev.glowing,
  };
}

/** A completed element worth `points` (value + accrual). Resets the idle timer. */
export function feedSpecial(state: SpecialState, points: number): SpecialStep {
  return step(state, clamp(state.meter + points / TUNING.SPECIAL_FULL_BASE, 0, 1), 0);
}

/** One tick: idle timer, drain (paused while comboAlive), hysteresis. */
export function stepSpecial(state: SpecialState, dtS: number, comboAlive: boolean): SpecialStep {
  const idleS = state.idleS + dtS;
  let meter = state.meter;
  if (!comboAlive) {
    const drainingS = Math.min(dtS, Math.max(0, idleS - TUNING.SPECIAL_IDLE_DELAY_S));
    meter = clamp(meter - TUNING.SPECIAL_DRAIN_PER_S * drainingS, 0, 1);
  }
  return step(state, meter, idleS);
}

/** Bail: meter 0, glow off. */
export function emptySpecial(state: SpecialState): SpecialStep {
  return {
    state: { meter: 0, glowing: false, idleS: 0 },
    becameGlowing: false,
    stoppedGlowing: state.glowing,
  };
}

/** REQ-SPC-03 / REQ-SPC-06: specials parse only while glowing (at the press tick). */
export function specialsEnabled(state: SpecialState): boolean {
  return state.glowing;
}

/** REQ-SPC-03: max speed factor from the meter, 1 + GLOW_SPEED_BONUS while glowing (maxSpeed() in tuning applies it). */
export function glowSpeedFactor(state: SpecialState): number {
  return state.glowing ? 1 + TUNING.GLOW_SPEED_BONUS : 1;
}
