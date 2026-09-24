/**
 * src/core/tuning/woodshed.ts (woodshed track): the woodshed track's own tunables. Only the woodshed track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:woodshed").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * These keys describe the park's pass bars and the speeds its lines were laid out for; the level
 * tests (tests/woodshed.test.ts) and the e2e rail-chain check read them, so the numbers live in one place.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const WOODSHED_TUNING = {
  WOODSHED_CHAIN_MIN_S: [20, 15, 30, 0.5, 's', 'REQ-WSH-03', 'Woodshed rail chain pass bar'], // REQ-WSH-03, 15 to 30 s (spec §9.2 value 20): a competent player holds a rails + manuals combo this long.
  WOODSHED_CHAIN_ENTRY_MPS: [7.7, 6, 9, 0.1, 'm/s', 'REQ-WSH-03', 'Rail chain entry speed'], // REQ-WSH-03, 6 to 9 m/s (DESIGN G.2 chain trace): the push ceiling the chain enters WS-RA at.
  WOODSHED_LINE_ROLL_MPS: [7.5, 5, 11, 0.1, 'm/s', 'REQ-WSH-02', 'Typical line speed'], // REQ-WSH-02, 5 to 11 m/s (DESIGN G.2 row spacing): the speed the four lines' hops and manual turns are laid out for.
  WOODSHED_LINE_RAIL_CLEAR_M: [0.6, 0.4, 1.0, 0.05, 'm', 'REQ-WSH-02', 'Line path clearance from rails'], // REQ-WSH-02, 0.4 to 1.0 m (mine): a line's floor path keeps this far from any low rail it does not use (posts and bars are obstacles).
} satisfies TrackTuningSpec;
