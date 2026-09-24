/**
 * src/core/tuning/logic.ts (logic track): the logic track's own tunables. Only the logic track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:logic").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const LOGIC_TUNING = {
  BAL_MANUAL_DRIFT_MULT: [0.5, 0.2, 1, 0.01, 'ratio', 'REQ-BAL-01', 'Manual drift multiplier'], // REQ-BAL-01 (founder 2026-09-23), 0.2 to 1: manual balance drifts at this fraction of the grind drift, so manuals last about twice as long.
} satisfies TrackTuningSpec;
