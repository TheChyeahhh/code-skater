/**
 * src/core/tuning/ui.ts (ui track): the ui track's own tunables. Only the ui track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:ui").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const UI_TUNING = {
  UI_TOAST_S: [2.5, 1, 6, 0.1, 's', 'REQ-HUD-01', 'Toast duration'], // REQ-HUD-01, 1 to 6 s (mine): goal / pickup / controller toasts stay this long unless the caller says otherwise.
  UI_TOAST_MAX: [3, 1, 6, 1, 'count', 'REQ-HUD-01', 'Toasts on screen'], // REQ-HUD-01, 1 to 6 (mine): older toasts drop off so the stack never covers the ticker.
  UI_LETTER_FLASH_S: [0.6, 0.2, 1.5, 0.05, 's', 'REQ-GOL-05', 'Letter tray ding flash'], // REQ-GOL-05, 0.2 to 1.5 s (mine): a collected letter flashes in the tray.
  UI_TICKER_MAX_NAMES: [10, 3, 30, 1, 'count', 'REQ-HUD-03', 'Combo ticker names shown'], // REQ-HUD-03, 3 to 30 (mine): a longer combo shows its newest names after a leading "... +", so the trick being done now never hides behind an ellipsis.
  UI_TICKER_FLASH_S: [0.18, 0.05, 0.5, 0.01, 's', 'REQ-HUD-03', 'Combo ticker flash on a new element'], // REQ-HUD-03, 0.05 to 0.5 s (mine): the ticker pops when an element joins.
  UI_LAND_TEXT_INSANE_S: [1.0, 0.6, 1.5, 0.05, 's', 'REQ-HUD-04', 'INSANE land text hold'], // REQ-HUD-04, 0.6 to 1.5 s (mine): INSANE holds longer than OK / SICK (LAND_TEXT_S) so the biggest bank gets the longest look.
  UI_BALANCE_ARC_Y: [0.36, 0.15, 0.6, 0.01, 'ratio', 'REQ-BAL-06', 'Balance arc height (no projector)'], // REQ-BAL-06, 0.15 to 0.6 of the screen height (mine): where the arc sits when the app has not wired a world-to-screen projector; the chase camera keeps the head there.
  UI_BALANCE_BAR_X: [0.6, 0.5, 0.8, 0.01, 'ratio', 'REQ-BAL-06', 'Manual bar x (no projector)'], // REQ-BAL-06, 0.5 to 0.8 of the screen width (mine): the vertical bar sits beside the skater.
  UI_BALANCE_BAR_GAP_H: [0.5, 0.2, 0.8, 0.01, 'ratio', 'REQ-BAL-06', 'Manual bar gap from the hip (x skater screen height)'], // REQ-BAL-06, 0.2 to 0.8 of the skater's projected head-to-feet height (mine): the bar clears the forward arm in a manual; 0.5 puts it about 110 px off the hip at the 1080p chase distance (skater about 220 px tall), where the old fixed 60 px sat on the wrist.
  UI_BALANCE_BAR_GAP_MIN_PX: [60, 20, 160, 5, 'px', 'REQ-BAL-06', 'Manual bar minimum gap from the hip'], // REQ-BAL-06, 20 to 160 px (mine): floor for the gap above when the skater is small or far away (the old fixed offset).
  UI_STICKER_CURSOR_SPEED: [0.9, 0.3, 2, 0.05, 'uv/s', 'REQ-LAB-03', 'Sticker cursor speed'], // REQ-LAB-03, 0.3 to 2 deck lengths per second (mine): a full stick crosses the deck in about a second.
  UI_STICKER_ROT_STEP_DEG: [15, 5, 45, 5, 'deg', 'REQ-LAB-03', 'Sticker rotate step'], // REQ-LAB-03, 5 to 45 deg (mine): L1 / R1 rotate the provisional sticker by this.
  UI_TURNTABLE_STICK_DPS: [180, 60, 360, 5, 'deg/s', 'REQ-LAB-01', 'Right stick turntable spin'], // REQ-LAB-01, 60 to 360 (mine): full right-stick deflection spins the board this fast.
  UI_RESULTS_COUNT_S: [0.9, 0, 2, 0.05, 's', 'REQ-GOL-07', 'Results score count-up'], // REQ-GOL-07, 0 to 2 s (mine): the score rolls up on the results card; 0 = instant.
} satisfies TrackTuningSpec;
