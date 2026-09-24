/**
 * src/core/tuning/sim.ts (sim track): the sim track's own tunables. Only the sim track edits this file
 * (one owner per file, so parallel edits can never clobber another track's keys).
 *
 * Entry format, one line per key:
 *   KEY: [value, min, max, step, unit, 'REQ-XXX-NN', 'label'], // REQ ID, range and rationale
 * src/core/tuning.ts builds TUNING and TUNING_META from these entries (dev panel group "track:sim").
 * Keys are global across TUNING: prefix yours when a name could collide; tests/tuning.test.ts fails
 * on duplicates. Systems read the live value through TUNING.KEY, never through this object.
 * Keep this file import free except the type import below (scripts load it with Node type stripping).
 *
 * These fill gaps DESIGN C.6 leaves as prose (probe geometry, thresholds the formulas imply). None
 * of them changes a locked number.
 */

import type { TrackTuningSpec } from '../tuning.ts';

export const SIM_TUNING = {
  SIM_GROUND_PROBE_UP_M: [0.25, 0.1, 0.4, 0.01, 'm', 'REQ-CTL-01', 'Ground probe start above the feet'], // REQ-CTL-01, 0.1 to 0.4 m (mine, DESIGN C.6 "down ray"): the ground ray starts this far out along the surface normal, so it is also the largest step the wheels roll up (a 0.15 m manual pad yes, a 0.45 m ledge no).
  SIM_WALL_PROBE_UP_M: [0.3, 0.15, 0.6, 0.01, 'm', 'REQ-CTL-20', 'Wall ray height above the feet'], // REQ-CTL-20, 0.15 to 0.6 m (mine, DESIGN C.6 "forward ray for walls"): anything taller than this in front is a wall candidate.
  SIM_PUSH_AXIS_MIN: [0.38, 0.2, 0.7, 0.01, 'ratio', 'REQ-CTL-04', 'Stick forward threshold for auto-push'], // REQ-CTL-04, 0.2 to 0.7 (mine): dirAxis.y at or above this is "stick forward"; 0.38 = cos 67.5 deg, the edge of the U / UL / UR sectors.
  SIM_BAIL_FRICTION: [6, 2, 12, 0.1, 'm/s^2', 'REQ-SM-05', 'Bail slide deceleration'], // REQ-SM-05, 2 to 12 (mine, DESIGN E.11): the tumble slides to a stop before the get-up.
  SIM_PREDICT_SEGMENTS: [8, 2, 16, 1, 'count', 'REQ-CTL-09', 'Landing prediction segments'], // REQ-CTL-09, 2 to 16 (mine): the ballistic path is swept in segments of LAND_PREDICT_AHEAD_S, so the look-ahead horizon is 2 s by default.
  SIM_GRIND_MIN_HSPEED: [0.05, 0.01, 0.5, 0.01, 'm/s', 'REQ-GRD-02', 'Horizontal speed for a defined entry angle'], // REQ-GRD-02, 0.01 to 0.5 (mine): below it the approach angle counts as 90 deg (a vertical drop onto a coping is a lip, not a coping grind).
  SIM_CONVEX_LEAVE_DEG: [45, 20, 80, 0.5, 'deg', 'REQ-CTL-12', 'Convex edge launch angle'], // REQ-CTL-12, 20 to 80 deg (mine): the ground ray finding a surface whose normal tilts forward by more than this (a coping, a spine top, a fountain rim) is a launch, not a surface change, so steep faces fly off at the coping instead of rolling onto the deck behind it.
  SIM_LAND_TRAVEL_MIN_MPS: [0.5, 0.1, 1.0, 0.01, 'm/s', 'REQ-CTL-10', 'Landing travel speed for off-axis'], // REQ-CTL-10, 0.1 to 1.0 m/s (DESIGN C.6 "< 0.5 m/s"): slower projected velocity reads the downhill direction (or, on true flat, the launch heading) as the travel direction for the 28 deg rule.
  SIM_TELEPORT_GROUND_M: [0.35, 0.05, 1.0, 0.01, 'm', 'REQ-DEP-07', 'Teleport ground snap reach'], // REQ-DEP-07, 0.05 to 1 m (mine): a teleport lands Grounded when a surface is this close below the feet, else Air.
  SIM_AUTO_GRIND: [1, 0, 1, 1, 'on/off', 'REQ-GRD-02', 'Coming down onto a rail grinds without Triangle'], // REQ-GRD-02 as changed by the founder playtest 2026-09-23 (CHANGE-REQUEST filed), 0 or 1: 1 = descending into the magnet of a rail, ledge or deck coping (entry angle inside GRIND_ENTRY_MAX_DEG, feet at or above the rail) snaps a 50-50 with no press; Triangle still picks the type.
  SIM_VERT_POP_MIN_SLOPE_DEG: [45, 40, 60, 0.5, 'deg', 'REQ-VRT-02', 'Pop scale slope'], // REQ-VRT-02, 40 to 60 deg (DESIGN C.6 "slope >= 45"): a pop from a face at or above this slope, or a coyote pop after leaving one, is scaled by VERT_POP_SCALE.
  SIM_CEILING_NORMAL_Y: [0.3, 0.1, 0.7, 0.01, 'ratio', 'REQ-CTL-22', 'Ceiling normal threshold'], // REQ-CTL-22, 0.1 to 0.7 (mine): an air contact whose normal points down by more than this (normal.y < -value) is a ceiling: push out, drop the upward speed, never a head-on wall bail.
  SIM_LIP_FACE_PROBE_OUT_M: [0.5, 0.2, 1.0, 0.01, 'm', 'REQ-LIP-03', 'Lip face probe offset'], // REQ-LIP-03, 0.2 to 1.0 m (mine): the ray that finds the real ramp face under a lip starts this far out from the coping.
  SIM_LIP_FACE_PROBE_DROP_M: [0.3, 0.1, 0.6, 0.01, 'm', 'REQ-LIP-03', 'Lip face probe drop'], // REQ-LIP-03, 0.1 to 0.6 m (mine): ... and this far below it (clear of the deck edge).
  SIM_LIP_FACE_PROBE_REACH_M: [1.0, 0.5, 2.0, 0.01, 'm', 'REQ-LIP-03', 'Lip face probe reach'], // REQ-LIP-03, 0.5 to 2.0 m (mine): ray length back toward the face.
  SIM_LIP_LAUNCH_HORIZ_MIN: [0.3, 0.1, 0.7, 0.01, 'ratio', 'REQ-LIP-03', 'Lip side from launch normal'], // REQ-LIP-03, 0.1 to 0.7 (mine): a launch normal with at least this horizontal part says which side of the coping the face is; flatter launches use the skater position.
  SIM_HEADING_MIN_HSPEED: [0.05, 0.01, 0.5, 0.01, 'm/s', 'REQ-GRD-06', 'Travel heading speed'], // REQ-GRD-06, 0.01 to 0.5 m/s (mine): slower horizontal speed takes the nose as the travel direction for the toe-side rule.
  SIM_MIN_HORIZ_DIR: [0.1, 0.01, 0.5, 0.01, 'ratio', 'REQ-CTL-03', 'Nose horizontal part for yaw'], // REQ-CTL-03, 0.01 to 0.5 (mine): a nose with less horizontal part than this (riding a vert face) keeps the previous heading yaw.
  SIM_KILL_BELOW_M: [3, 1, 10, 0.1, 'm', 'REQ-CTL-22', 'Out-of-world depth'], // REQ-CTL-22, 1 to 10 m (mine): feet this far below the lowest point of the level collider = left the world: a landing bail (combo lost), then the get-up at the last safe grounded spot.
  SIM_AIR_SPIN_DEADZONE: [0.75, 0, 0.95, 0.01, 'ratio', 'REQ-VRT-03', 'Air spin stick deadzone'], // REQ-VRT-03 as changed by the founder playtest 2026-09-23 (DESIGN L CR-43), 0 to 0.95: the air spin reads only |stick x| beyond this, rescaled to full rate at full lock, so a riding lean (a diagonal is 0.71) never spins the skater sideways.
  SIM_AUTO_PUSH: [1, 0, 1, 1, 'on/off', 'REQ-CTL-04', 'Auto-push with no stick input'], // REQ-CTL-04 as changed by founder playtest 2 (DESIGN L CR-65), 0 or 1: 1 = THPS1 style, the skater pushes on his own unless the stick is held back; 0 = push only while the stick is held forward.
  SIM_SPIN_ASSIST_S: [0.18, 0, 0.4, 0.01, 's', 'REQ-CTL-10', 'Landing spin assist window'], // REQ-CTL-10 as changed by founder playtest 2 (DESIGN L CR-65), 0 to 0.4 s: this long before touchdown the air spin turns to the nearest 180 instead of following the stick; 0 = off.
  SIM_SPIN_ASSIST_DPS: [900, 360, 1440, 10, 'deg/s', 'REQ-CTL-10', 'Landing spin assist rate'], // REQ-CTL-10 as changed by founder playtest 2 (DESIGN L CR-65), 360 to 1440: 0.18 s x 900 = 162 deg covers the worst case (90 deg off).
  SIM_SPIN_ASSIST_PROBE_DEG: [2, 0.5, 10, 0.5, 'deg', 'REQ-CTL-10', 'Landing spin assist probe step'], // REQ-CTL-10 (CR-65), 0.5 to 10 deg: the assist tries this much yaw each way to find which turn lowers the landing off-axis.
  SIM_SPIN_ASSIST_PROBE_M: [30, 5, 60, 1, 'm', 'REQ-CTL-10', 'Landing spin assist ground probe'], // REQ-CTL-10 (CR-65), 5 to 60 m: how far below the feet the assist looks for the ground.
  SIM_GRIND_WAITS_FOR_TRICK: [1, 0, 1, 1, 'on/off', 'REQ-SM-03', 'Triangle mid-trick waits instead of bailing'], // REQ-SM-03 as changed by founder playtest 2 (DESIGN L CR-65), 0 or 1: 1 = a grind press during a flip or grab snaps once the trick finishes (inside the pre-buffer); 0 = row 5b bails.
  SIM_GRAB_AUTO_RELEASE: [1, 0, 1, 1, 'on/off', 'REQ-SM-03', 'A grab held at touchdown lets go'], // REQ-SM-03 as changed by founder playtest 2 (DESIGN L CR-65), 0 or 1: 1 = holding a grab into the landing no longer bails; 0 = it is an unfinished animation (row 10).
  SIM_WALL_BOUNCE: [0.35, 0, 0.8, 0.01, 'ratio', 'REQ-CTL-20', 'Head-on wall bounce'], // REQ-CTL-20 as changed by founder playtest 2 (DESIGN L CR-65), 0 to 0.8: walls never bail; a near head-on hit bounces back at this fraction of the into-wall speed.
  SIM_LAND_ANIM_GRACE_MS: [200, 0, 300, 1, 'ms', 'REQ-SM-03', 'Landing grace for a finishing trick'], // REQ-SM-03 as changed by the founder playtest 2026-09-23 (DESIGN L CR-43), 0 to 250 ms: a flip or released grab that ends within this after contact lands instead of bailing midTrick. 15 ticks.
  SIM_LAND_SLOW_MPS: [2.0, 0, 4, 0.05, 'm/s', 'REQ-CTL-10', 'Slow landing: only the spin counts'], // REQ-CTL-10 as changed by the founder playtest 2026-09-23 (DESIGN L CR-43), 0 to 4 m/s: a landing with less horizontal speed than this is judged only by the player's own air spin, never by a velocity that rolled back under the nose.
  SIM_TRANSFER_SIDE_EPS_M: [0.05, 0.01, 0.3, 0.01, 'm', 'REQ-VRT-08', 'Transfer launch side: off-plane distance'], // REQ-VRT-08, 0.01 to 0.3 m (mine, polish round 2): a launch farther than this from the transfer plane takes its side from the position; closer (a carve leaving at the vert coping itself) takes it from the launch face normal, so the push never points back at the ramp.
  SIM_PUMP_MIN_DESCENT_MPS: [0.1, 0.01, 1, 0.01, 'm/s', 'REQ-CTL-21', 'Pump: descent speed on a shallow face'], // REQ-CTL-21 / REQ-SM-13, 0.01 to 1 m/s (integration, polish round 2): Cross pressed on the flat-sloped foot of a transition pumps (rows 1b, 9i) only while the skater descends faster than this; a level bowl floor (v.y about 0) crouches as before. Steeper faces pump whenever the skater is not moving up.
  SIM_SPEED_TIER_HYST: [0.03, 0, 0.1, 0.005, 'ratio of vmax', 'REQ-CAM-04', 'Speed tier hysteresis'], // REQ-CAM-04, 0 to 0.1 (integration, polish round 2): the snapshot speed tier rises to cruise / fast only this far above SPEED_TIER_CRUISE_RATIO / CAM_FOV_KICK_SPEED and falls back below the threshold itself; the top push (0.85 of vmax) stays cruise instead of flickering.
} satisfies TrackTuningSpec;
