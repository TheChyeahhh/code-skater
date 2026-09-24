/**
 * src/input/rumble.ts (input track): REQ-INP-05. Light on grind contact (pulsed while grinding),
 * medium on bail, short pulse on gap and MacGuffin. Strengths and lengths come from TUNING.RUMBLE_*.
 * Fails silently when gamepad.vibrationActuator is missing (rumble.test: no-ops without an actuator).
 * Wiring: the app subscribes rumbleForEvent to the event bus and calls InputSystem.rumble(); the
 * grind pulse repeats through InputSystem.setRumbleLoop (grindStart on, grindEnd / bail off).
 */

import { TUNING } from '../core/tuning';
import type { SimEvent } from '../core/events';
import type { GamepadLike, RumbleEffect, RumbleSpec } from './types';

/** Current strengths for an effect, read from TUNING at call time. */
export function rumbleSpec(effect: RumbleEffect): RumbleSpec {
  switch (effect) {
    case 'grindPulse':
      return { weak: TUNING.RUMBLE_GRIND_WEAK, strong: 0, durationMs: TUNING.RUMBLE_GRIND_PULSE_MS };
    case 'bail':
      return { weak: 0, strong: TUNING.RUMBLE_BAIL_STRONG, durationMs: TUNING.RUMBLE_BAIL_MS };
    case 'gap':
      return { weak: 0, strong: TUNING.RUMBLE_GAP_STRONG, durationMs: TUNING.RUMBLE_GAP_MS };
    case 'macguffin':
      return { weak: 0, strong: TUNING.RUMBLE_MACGUFFIN_STRONG, durationMs: TUNING.RUMBLE_MACGUFFIN_MS };
  }
}

/** The effect a gameplay event should trigger, or null (grindStart -> grindPulse, bail, gap, macguffin). */
export function rumbleForEvent(e: SimEvent): RumbleEffect | null {
  switch (e.type) {
    case 'grindStart':
      return 'grindPulse';
    case 'bail':
      return 'bail';
    case 'gap':
      return 'gap';
    case 'macguffin':
      return 'macguffin';
    default:
      return null;
  }
}

/** Play on one pad; a silent no-op without a vibration actuator. Never throws. */
export function playRumble(pad: GamepadLike | null, spec: RumbleSpec): void {
  try {
    const actuator = pad?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return;
    if (spec.durationMs <= 0 || (spec.weak <= 0 && spec.strong <= 0)) return;
    const p = actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: spec.durationMs,
      weakMagnitude: Math.min(1, Math.max(0, spec.weak)),
      strongMagnitude: Math.min(1, Math.max(0, spec.strong)),
    });
    // A rejected promise (effect preempted, unsupported) must never surface as an unhandled rejection.
    if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => undefined);
  } catch {
    // Fail silently (REQ-INP-05).
  }
}
