/**
 * src/core/tuning/integration.ts (integration track): the integration track's own tunables. Only the integration track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:integration").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const INTEGRATION_TUNING = {
  INT_RESULTS_DELAY_S: [1.2, 0, 4, 0.1, 's', 'REQ-GOL-07', 'Run end to results card'], // REQ-GOL-07, 0 to 4 s (mine): the last bank's land text and splash play out before the results card covers the park.
  INT_FREE_SKATE_LENGTH_S: [86400, 600, 86400, 60, 's', 'REQ-GOL-01', 'Free Skate clock (untimed)'], // REQ-GOL-01 as changed in DESIGN L (Free Skate is untimed), 600 to 86400 s: the world always runs a clock, so Free Skate gets one a day long; the HUD shows FREE SKATE instead of the time.
  INT_CAM_IGNORE_HEIGHT_M: [1.0, 0, 2, 0.05, 'm', 'REQ-CAM-05', 'Camera ray ignores shapes shorter than'], // REQ-CAM-05, 0 to 2 m (mine, fx request): ledges, hubbas, planters and props under this height never shorten the chase boom, so a hip-high collider cannot slam the camera into the skater's back.
  INT_CAM_RAY_PASSES: [4, 1, 8, 1, 'count', 'REQ-CAM-05', 'Camera ray pass-through hits'], // REQ-CAM-05, 1 to 8 (mine): how many ignored low shapes one camera ray may pass through before it gives up.
  INT_PROBE_DROP_FRAME_MS: [100, 50, 500, 1, 'ms', 'REQ-REN-05', 'FPS probe ignores frames longer than'], // REQ-REN-05, 50 to 500 ms (mine, polish round 1): a frame interval over this is a long task (shader link, bake, GC), not the steady frame rate, and never counts in the median.
  CAMPUS_HIGH_SCORE: [20000, 20000, 20000, 1, 'points', 'REQ-GOL-01', 'Lab Campus goal: High Score'], // Lab Campus (2026-09-23), fixed.
  CAMPUS_PRO_SCORE: [50000, 50000, 50000, 1, 'points', 'REQ-GOL-01', 'Lab Campus goal: Pro Score'], // Lab Campus, fixed.
  CAMPUS_SICK_SCORE: [100000, 100000, 100000, 1, 'points', 'REQ-GOL-01', 'Lab Campus goal: Sick Score'], // Lab Campus, fixed.
  CAMPUS_HIGH_COMBO: [12000, 12000, 12000, 1, 'points', 'REQ-GOL-01', 'Lab Campus goal: High Combo'], // Lab Campus, fixed.
  CAMPUS_GRIND_MANUALS: [2, 2, 2, 1, 'count', 'REQ-GOL-01', 'Lab Campus goal: grind-manuals in one combo'], // Lab Campus, fixed.
  INT_AIR_TIME_SCALE: [0.75, 0.4, 1, 0.01, 'ratio', 'REQ-SPC-05', 'Slow motion in the air'], // founder 2026-09-23, 0.4 to 1: presentation speed while airborne (1 = off), more time for tricks; sim time is unchanged.
  INT_AIR_TIME_BLEND_S: [0.15, 0.02, 0.6, 0.01, 's', 'REQ-SPC-05', 'Air slow-motion ease'], // founder 2026-09-23, 0.02 to 0.6 s: how fast the air slow motion eases in and out.
  INT_GPU_WARNING_S: [20, 5, 60, 1, 's', 'REQ-REN-05', 'Software-GL notice time'], // REQ-REN-05, 5 to 60 s (founder report 2026-09-23): how long the "no graphics card" notice stays up if not dismissed.
  INT_PROBE_WARM_FRAMES: [30, 0, 240, 1, 'frames', 'REQ-REN-05', 'Frames drawn before the FPS probe'], // REQ-REN-05, 0 to 240 (mine, polish round 1): the "auto" probe waits until the current scene (menu backdrop or run) has drawn this many frames, so it never measures the park build and first-draw shader links.
} satisfies TrackTuningSpec;
