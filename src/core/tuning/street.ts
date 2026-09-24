/**
 * src/core/tuning/street.ts (street track): the street track's own tunables. Only the street track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:street").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * Market Street's geometry, gap bases and goal thresholds are level DATA (DESIGN G.1, §M "GAP bases");
 * the keys below only size the line-feasibility and park-shape checks in tests/marketStreet.test.ts.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const STREET_TUNING = {
  STREET_LINE_SPEED_MPS: [8.0, 6.0, 11.0, 0.1, 'm/s', 'REQ-STR-02', 'Street line check: typical speed'], // REQ-STR-02, 6 to 11 m/s (DESIGN C.6 "Distance at 8 m/s" column): the speed every hop of a Market Street line is checked at; 8 m/s is the pushed cruise DESIGN sizes its gaps against.
  STREET_LINE_LETTER_SLACK_M: [1.0, 0.5, 2.0, 0.05, 'm', 'REQ-STR-03', 'Street line check: letter slack'], // REQ-STR-03, 0.5 to 2.0 m (mine): horizontal slack between a line's path segment and its letter, on top of COLLECT_RADIUS_M, so a grab mid-air still reads as "on the line". Letters over a transition get no slack (the vert assist puts the skater straight over the lip).
  STREET_LINE_ROOF_MARGIN_M: [0.5, 0.2, 2.0, 0.05, 'm', 'REQ-STR-02', 'Street line check: roof landing margin'], // REQ-STR-02, 0.2 to 2.0 m (mine): how far past the coping line 2's traced Q3 launch must come down on the dock roof.
  STREET_PROP_RAIL_MIN_H_M: [0.3, 0.1, 0.6, 0.05, 'm', 'REQ-STR-07', 'Street park check: prop rail min height'], // REQ-STR-07, 0.1 to 0.6 m (mine): a collidable prop whose top is at least this high (and at most a full ollie) above its ground must carry a ledge rail, or it is a bump with nothing to do.
  STREET_WALL_RUNOUT_M: [8, 4, 20, 0.5, 'm', 'REQ-STR-02', 'Street line check: rail exit run-out'], // REQ-STR-02, 4 to 20 m (mine): a goal rail's exit must meet no wall taller than a full ollie within this distance (one second at cruise), beyond the 0.5 m of REQ-LVL-12.
} satisfies TrackTuningSpec;
