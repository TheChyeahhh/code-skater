/**
 * src/core/tuning/levels.ts (levels track): the levels track's own tunables. Only the levels track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:levels").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * Builder keys are read when buildLevel runs (a rebuild picks up a slider change); validator keys
 * are read when validateLevel runs.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const LEVELS_TUNING = {
  LEVELS_RAIL_PIPE_R_M: [0.03, 0.02, 0.06, 0.005, 'm', 'REQ-LVL-11', 'Default rail pipe radius'], // REQ-LVL-11, 0.02 to 0.06 m (mine, M0): flat bars and handrails without a RailPipePrim override; read at build time.
  LEVELS_COPING_PIPE_R_M: [0.04, 0.03, 0.06, 0.005, 'm', 'REQ-LVL-11', 'Coping pipe radius'], // REQ-LVL-11, 0.03 to 0.06 m (mine, M0): every kind coping rail; read at build time.
  LEVELS_RAIL_POST_SPACING_M: [2.5, 1.0, 5.0, 0.1, 'm', 'REQ-LVL-11', 'Rail post spacing'], // REQ-LVL-11, 1 to 5 m (mine): posts under default rail pipes, down to the surface below.
  LEVELS_PIPE_RADIAL_SEGS: [8, 6, 16, 1, 'count', 'REQ-LVL-11', 'Rail pipe radial segments'], // REQ-LVL-11, 6 to 16 (mine): 8 reads round at chase-cam distance for a 3 cm pipe.
  LEVELS_ARC_SEG_DEG: [3, 1, 8, 0.5, 'deg', 'REQ-LVL-09', 'Transition arc segment angle'], // REQ-LVL-09, 1 to 8 deg (mine): max normal step between collider facets on quarter-pipes, bowls, spines, fountains, channels; 3 deg keeps a raycast controller smooth.
  LEVELS_REVOLVE_SEGS: [64, 24, 128, 4, 'count', 'REQ-LVL-09', 'Segments around full-pipes and fountains'], // REQ-LVL-09, 24 to 128 (mine): 64 = 5.6 deg per facet around a full-pipe.
  LEVELS_CORNER_SEGS: [12, 4, 32, 1, 'count', 'REQ-LVL-09', 'Bowl corner segments'], // REQ-LVL-09, 4 to 32 (mine): segments per rounded bowl corner (7.5 deg each).
  LEVELS_MAX_SEG_M: [4, 1, 16, 0.5, 'm', 'REQ-LVL-01', 'Max straight segment length'], // REQ-LVL-01, 1 to 16 m (mine): long straight spans are split so collider triangles stay BVH friendly.
  LEVELS_GROUND_CELL_M: [1, 0.5, 4, 0.25, 'm', 'REQ-REN-03', 'Ground render cell'], // REQ-REN-03, 0.5 to 4 m (mine): render grid for ground AO; the collider uses LEVELS_COLLIDER_CELL_M.
  LEVELS_COLLIDER_CELL_M: [8, 2, 32, 1, 'm', 'REQ-LVL-01', 'Ground collider cell'], // REQ-LVL-01, 2 to 32 m (mine): ground collider tiles.
  LEVELS_AO_STRENGTH: [0.45, 0, 0.8, 0.01, 'ratio', 'REQ-REN-03', 'Fake AO strength'], // REQ-REN-03, 0 to 0.8 (mine): vertex colour darkening in concave corners (wall bases, ramp feet, bowl floors).
  LEVELS_AO_RANGE_M: [1.2, 0.3, 3, 0.05, 'm', 'REQ-REN-03', 'Fake AO range'], // REQ-REN-03, 0.3 to 3 m (mine): distance over which the darkening fades out.
  LEVELS_FOUNTAIN_RIM_W_M: [0.35, 0.15, 1.0, 0.01, 'm', 'REQ-LVL-01', 'Fountain rim top width'], // REQ-LVL-01, 0.15 to 1 m (mine, DESIGN G.1 gives no width): flat rim between the coping and the basin wall.
  LEVELS_FULLPIPE_SHELL_M: [0.2, 0.05, 0.5, 0.01, 'm', 'REQ-LVL-01', 'Full-pipe shell thickness'], // REQ-LVL-01, 0.05 to 0.5 m (mine): outer shell so the pipe is solid from outside.
  LEVELS_COVERAGE_TOL_M: [0.1, 0.05, 0.2, 0.01, 'm', 'REQ-LVL-03', 'Rail coverage tolerance'], // REQ-LVL-03, spec §9.2 value 0.1 m: every coping / ledge top edge has a rail this close.
  LEVELS_DECAL_CLEAR_M: [0.15, 0.1, 0.3, 0.01, 'm', 'REQ-LVL-04', 'Decal clearance from rails'], // REQ-LVL-04, spec §9.2 value 0.15 m.
  LEVELS_FEED_MAX_ALONG_M: [3.5, 2.5, 4.5, 0.05, 'm', 'REQ-LVL-06', 'Feed max horizontal hop'], // REQ-LVL-06, spec §9.2 value 3.5 m.
  LEVELS_FEED_MAX_UP_M: [1.2, 0.8, 1.6, 0.05, 'm', 'REQ-LVL-06', 'Feed max rise'], // REQ-LVL-06, spec §9.2 value 1.2 m.
  LEVELS_FEED_MAX_LATERAL_M: [0.5, 0.3, 0.75, 0.01, 'm', 'REQ-LVL-06', 'Feed max lateral offset'], // REQ-LVL-06, DESIGN G value 0.5 m (GRIND_MAGNET_RADIUS_M - 0.05).
  LEVELS_FEED_SIM_MAX_S: [3, 1, 5, 0.1, 's', 'REQ-LVL-10', 'Feed hop simulation length'], // REQ-LVL-10, 1 to 5 s (mine): longest hop the feed simulation follows.
  LEVELS_WALL_CLEAR_M: [0.5, 0.3, 1.0, 0.05, 'm', 'REQ-LVL-12', 'Rail end wall clearance'], // REQ-LVL-12, DESIGN value 0.5 m: no wall this close ahead of a rail end.
  LEVELS_WALL_PROBE_UP_M: [0.3, 0.1, 0.6, 0.01, 'm', 'REQ-LVL-12', 'Rail end wall probe height'], // REQ-LVL-12, 0.1 to 0.6 m (mine): the probe ray runs this far above the rail so a deck at rail height is not a wall.
  LEVELS_SCAFFOLD_PIPE_R_M: [0.024, 0.02, 0.04, 0.001, 'm', 'REQ-LVL-11', 'Scaffold pipe radius'], // REQ-LVL-11, 0.02 to 0.04 m (mine): a 48 mm scaffold tube, the RailPipePrim style default.
  LEVELS_VENT_PIPE_R_M: [0.12, 0.06, 0.25, 0.01, 'm', 'REQ-LVL-11', 'Vent duct radius'], // REQ-LVL-11, 0.06 to 0.25 m (mine): the "vent" RailPipePrim style default, a fat duct.
  LEVELS_POST_R_RATIO: [0.8, 0.4, 1.0, 0.05, 'ratio', 'REQ-LVL-11', 'Rail post radius / pipe radius'], // REQ-LVL-11, 0.4 to 1.0 (mine).
  LEVELS_POST_MAX_DROP_M: [12, 2, 30, 0.5, 'm', 'REQ-LVL-11', 'Longest rail post'], // REQ-LVL-11, 2 to 30 m (mine): no post when nothing is below within this.
  LEVELS_AUTO_RAIL_SAMPLE_M: [0.25, 0.05, 1, 0.05, 'm', 'REQ-LVL-03', 'Grind line sample step'], // REQ-LVL-03, 0.05 to 1 m (mine): coverage sampling for auto rail emission and validation.
  LEVELS_DECAL_LIFT_M: [0.01, 0.002, 0.05, 0.001, 'm', 'REQ-LVL-04', 'Decal lift off its surface'], // REQ-LVL-04, contract value 1 cm (src/levels/types.ts DecalDef).
  LEVELS_PROBE_STEP_M: [1.0, 0.25, 4, 0.25, 'm', 'REQ-LVL-11', 'Validator probe grid step'], // REQ-LVL-11 sanity, 0.25 to 4 m (mine): grid of rays for the outward-normal and closed-boundary checks.
  LEVELS_BURY_PROBE_M: [0.05, 0.01, 0.2, 0.01, 'm', 'REQ-LVL-11', 'Buried rail probe lift'], // REQ-LVL-11 sanity, 0.01 to 0.2 m (mine): a rail point lifted this far must be in open air.
  LEVELS_PARAPET_W_M: [0.25, 0.1, 0.6, 0.01, 'm', 'REQ-MAT-01', 'Roof parapet trim width'], // REQ-MAT-01, 0.1 to 0.6 m (mine): the metal trim is a ring this wide along the roof edge, so the roof material shows inside it; read at build time.
  LEVELS_SPAWN_GROUND_TOL_M:[0.1, 0.02, 0.3, 0.01, 'm', 'REQ-LVL-11', 'Spawn on ground tolerance'], // REQ-LVL-11 sanity, 0.02 to 0.3 m (mine): spawn feet within this of the surface below.
} satisfies TrackTuningSpec;
