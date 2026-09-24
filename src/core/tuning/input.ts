/**
 * src/core/tuning/input.ts (input track): the input track's own tunables. Only the input track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:input").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const INPUT_TUNING = {
  INPUT_TRIGGER_PRESS: [0.5, 0.1, 0.9, 0.01, 'ratio', 'REQ-INP-01', 'Trigger press threshold'], // REQ-INP-01, 0.1 to 0.9 (src/input/types.ts contract: L2 / R2 count as pressed at >= 0.5). Read live by the gamepad device.
  INPUT_EDGE_MAX_AGE_MS: [250, 100, 1000, 10, 'ms', 'REQ-TIM-02', 'Queued edge max age'], // REQ-TIM-02, 100 to 1000 ms (mine): edges queued while no tick ran (menus, pause) older than this are dropped, so a menu press never leaks into the first tick of a run.
  INPUT_NAV_STICK: [0.5, 0.3, 0.9, 0.01, 'ratio', 'REQ-MNU-02', 'Menu stick threshold'], // REQ-MNU-02, 0.3 to 0.9 (mine): the stick's dominant axis must pass this to move menu focus; higher than the 0.35 play deadzone so a resting stick never drifts focus.
  INPUT_NAV_REPEAT_DELAY_MS: [400, 200, 800, 10, 'ms', 'REQ-MNU-02', 'Menu auto-repeat delay'], // REQ-MNU-02, 200 to 800 ms (mine): hold a direction this long before focus starts repeating.
  INPUT_NAV_REPEAT_MS: [120, 60, 300, 10, 'ms', 'REQ-MNU-02', 'Menu auto-repeat interval'], // REQ-MNU-02, 60 to 300 ms (mine): one focus step per interval while held, about 8 per second.
  INPUT_OVERLAY_LOG_LINES: [16, 4, 40, 1, 'lines', 'REQ-DEP-07', 'Input overlay log length'], // REQ-DEP-07, 4 to 40 (mine, dev only): parsed actions kept in the M1 input overlay.
} satisfies TrackTuningSpec;
