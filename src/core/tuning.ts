/**
 * src/core/tuning.ts: every tunable number in CODE SKATER (SPEC §1.3, AGENTS "no magic numbers").
 *
 * Source: DESIGN.md section M (Locked numbers), plus a few numbers DESIGN states in its prose
 * but left out of the M table (marked "not in M").
 *
 * Rules for every system:
 * - Read TUNING.<KEY> at the moment you use it, every tick. Never copy a value into a module
 *   constant or a closure at startup: the dev tuning panel mutates TUNING live (REQ-DEP-07).
 * - Windows are authored in ms or s and converted with ticks() / ticksS() at use time (REQ-TIM-03).
 * - Do not change a value here to "fix" feel without a CHANGE-REQUEST line in DESIGN.md §L.
 *
 * Entry format inside a section: KEY: [value, min, max, step, unit, reqId, label], followed by a
 * comment with the REQ ID, the range and the rationale. TUNING and TUNING_META are both built
 * from these entries, so the value and its range cannot drift apart.
 *
 * Area sections (below) are frozen after M0. Track keys live in one file per track,
 * src/core/tuning/<track>.ts, owned and edited only by that track, in the same entry format; this
 * file already imports and assembles all twelve, so a track never edits tuning.ts. The TypeScript
 * types force a META entry for every numeric key, and tests/tuning.test.ts checks that no key is
 * defined twice.
 *
 * Imports: only the per-track files under ./tuning/, with explicit ".ts" specifiers.
 * scripts/*.mjs import this file directly with Node's type stripping, so use only erasable
 * TypeScript syntax here and in the track files.
 */

import { INPUT_TUNING } from './tuning/input.ts';
import { LOGIC_TUNING } from './tuning/logic.ts';
import { LEVELS_TUNING } from './tuning/levels.ts';
import { STREET_TUNING } from './tuning/street.ts';
import { WOODSHED_TUNING } from './tuning/woodshed.ts';
import { SIM_TUNING } from './tuning/sim.ts';
import { RENDER_TUNING } from './tuning/render.ts';
import { SKATER_TUNING } from './tuning/skater.ts';
import { FX_TUNING } from './tuning/fx.ts';
import { UI_TUNING } from './tuning/ui.ts';
import { AUDIO_TUNING } from './tuning/audio.ts';
import { INTEGRATION_TUNING } from './tuning/integration.ts';

// ---------------------------------------------------------------------------------------------
// Types and the section helper
// ---------------------------------------------------------------------------------------------

/** Metadata for one numeric tunable; the dev panel builds a slider from it. */
export interface TuningMeta {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  /** Area group shown in the dev panel ("timing", "grind", ... or "track:<name>"). */
  readonly group: string;
  /** The section the key was declared in (area name or track name). */
  readonly section: string;
  readonly reqId: string;
  readonly label: string;
}

/** [value, min, max, step, unit, reqId, label] */
export type TuningEntry = readonly [number, number, number, number, string, string, string];
type Entry = TuningEntry;

/** Shape of a track file's export (src/core/tuning/<track>.ts): `{ ... } satisfies TrackTuningSpec`. */
export type TrackTuningSpec = Record<string, TuningEntry>;

interface Section<S extends Record<string, Entry>> {
  readonly name: string;
  readonly group: string;
  readonly values: { -readonly [K in keyof S]: number };
  readonly meta: { readonly [K in keyof S]: TuningMeta };
}

function section<S extends Record<string, Entry>>(name: string, group: string, spec: S): Section<S> {
  const values: Record<string, number> = {};
  const meta: Record<string, TuningMeta> = {};
  for (const key of Object.keys(spec)) {
    const [value, min, max, step, unit, reqId, label] = spec[key] as Entry;
    values[key] = value;
    meta[key] = { min, max, step, unit, group, section: name, reqId, label };
  }
  return { name, group, values, meta } as unknown as Section<S>;
}

// ---------------------------------------------------------------------------------------------
// Enum tunables and fixed tables
// ---------------------------------------------------------------------------------------------

/** REQ-DEG-01 / REQ-DEG-02 (CR-07): degradation factor by times already done this run (index 0 = first). */
export const DEGRADATION_PRESETS = {
  /** SPEC §6 locked table (the first game's per-level lineage): 100/90/75/50/25%. */
  classic: [1, 0.9, 0.75, 0.5, 0.25],
  /** The third game's steeper lineage, exposed as a preset only: 100/75/50/25/10%. */
  steep: [1, 0.75, 0.5, 0.25, 0.1],
} as const satisfies Record<string, readonly number[]>;

export type DegradationPresetName = keyof typeof DEGRADATION_PRESETS;

/** REQ-SCR-03 (CR-08): "multiplier" = +0.5 multiplier per 180; "base" = SPIN_BASE_PER_180 points per 180. */
export type SpinMode = 'multiplier' | 'base';

/** REQ-REN-05, spec: pixel ratio cap per quality preset Low / Med / High / Ultra. Fixed. */
export const PIXEL_RATIO_CAPS = [1.0, 1.25, 1.5, 2.0] as const;
/** REQ-REN-05: shadow map size per quality preset Low / Med / High / Ultra. Fixed. */
export const SHADOW_MAP_SIZES = [1024, 2048, 2048, 4096] as const;

interface EnumMeta<T extends string> {
  readonly options: readonly T[];
  readonly group: string;
  readonly reqId: string;
  readonly label: string;
}

const ENUMS = {
  /** REQ-SCR-03, "multiplier" or "base", spec preset (CR-08). Default "multiplier" (THPS1/2 rule). */
  SPIN_MODE: 'multiplier' as SpinMode,
  /** REQ-DEG-02, "classic" or "steep" (CR-07). Default "classic": the locked SPEC §6 table. */
  DEGRADATION_PRESET: 'classic' as DegradationPresetName,
  // SPEC §15's regular / goofy default stance is v1.0 (DESIGN F): not an MVP dropdown, since nothing
  // reads it (the sim always starts regular). Removed in polish round 1.
};

export const TUNING_ENUM_META: { readonly [K in keyof typeof ENUMS]: EnumMeta<(typeof ENUMS)[K]> } = {
  SPIN_MODE: { options: ['multiplier', 'base'], group: 'scoring', reqId: 'REQ-SCR-03', label: 'Spin scoring mode' },
  DEGRADATION_PRESET: { options: ['classic', 'steep'], group: 'scoring', reqId: 'REQ-DEG-02', label: 'Degradation preset' },
};

// ---------------------------------------------------------------------------------------------
// Area sections (frozen after M0; change only by CHANGE-REQUEST in DESIGN.md §L)
// ---------------------------------------------------------------------------------------------

const SIM = section('sim', 'sim', {
  SIM_HZ: [120, 120, 120, 1, 'Hz', 'REQ-TIM-01', 'Sim tick rate'], // REQ-TIM-01, fixed 120 (spec §7): every window is measured in these ticks. Read once when the loop is built.
  SIM_MAX_CATCHUP_S: [0.1, 0.05, 0.25, 0.01, 's', 'REQ-TIM-04', 'Max sim catch-up per frame'], // REQ-TIM-04, 0.05 to 0.25 s: caps catch-up at 12 ticks so a slow frame drops time instead of spiralling.
});

const WINDOWS = section('windows', 'timing', {
  COYOTE_MS: [90, 70, 120, 1, 'ms', 'REQ-TIM-06', 'Late-ollie (coyote) window'], // REQ-TIM-06, 70 to 120 ms (spec §7, CR-14): a slightly late ollie off an edge, rail end or coping still pops. 11 ticks.
  GRIND_PREBUFFER_MS: [200, 120, 300, 1, 'ms', 'REQ-GRD-04', 'Grind button pre-buffer'], // REQ-GRD-04, 120 to 300 ms (spec §7): Triangle pressed early in air snaps when a rail enters the magnet. 24 ticks.
  REVERT_PRE_MS: [150, 100, 200, 1, 'ms', 'REQ-REV-01', 'Revert pre-land buffer'], // REQ-REV-01, 100 to 200 ms (spec §7, CR-03): R2 slightly early fires on contact. 18 ticks.
  REVERT_POST_MS: [180, 140, 220, 1, 'ms', 'REQ-REV-01', 'Revert window after vert land'], // REQ-REV-01, 140 to 220 ms (spec §7): also the vert LandWindow length. 22 ticks.
  REVERT_TO_MANUAL_MS: [200, 160, 260, 1, 'ms', 'REQ-REV-02', 'Revert to manual buffer'], // REQ-REV-02, 160 to 260 ms (spec §7, CR-03): Up,Down during the revert pivot still links. 24 ticks.
  MANUAL_LAND_WINDOW_MS: [140, 100, 180, 1, 'ms', 'REQ-MAN-02', 'Manual entry on land'], // REQ-MAN-02, 100 to 180 ms (spec §7): pair before or after a flat contact links; also the flat LandWindow length. 17 ticks.
  SPECIAL_SEQ_MS: [250, 200, 350, 1, 'ms', 'REQ-INP-13', 'Special sequence window'], // REQ-INP-13, 200 to 350 ms (spec §7): max gap between the two special directions. 30 ticks.
  SPECIAL_BUTTON_MS: [250, 150, 350, 1, 'ms', 'REQ-INP-10', 'Special button after 2nd direction'], // REQ-INP-10, 150 to 350 ms (mine): the button must follow the second direction within this. 30 ticks.
  DOUBLE_TAP_MS: [250, 180, 320, 1, 'ms', 'REQ-INP-04', 'Double-tap enhanced window'], // REQ-INP-04, 180 to 320 ms (spec §5): same flip/grab again within this = enhanced version. 30 ticks.
  MANUAL_SEQ_MS: [250, 180, 350, 1, 'ms', 'REQ-MAN-01', 'Manual pair gap (leave to enter)'], // REQ-MAN-01, 180 to 350 ms (mine): Up->Down gap measured leave-to-enter (REQ-INP-17). 30 ticks.
  GRIND_SWITCH_COOLDOWN_MS: [100, 60, 200, 1, 'ms', 'REQ-GRD-07', 'Grind switch cooldown'], // REQ-GRD-07, 60 to 200 ms (mine): blocks mashing faster than 10 switches per second. 12 ticks.
  LAND_YAW_SNAP_MS: [100, 60, 160, 1, 'ms', 'REQ-CTL-07', 'Landing yaw snap time'], // REQ-CTL-07, 60 to 160 ms (mine): board yaw eases to the nearest 180 after contact. 12 ticks.
  GRIND_SNAP_BLEND_MS: [80, 50, 120, 1, 'ms', 'REQ-GRD-03', 'Grind snap blend'], // REQ-GRD-03, 50 to 120 ms (mine): reads as instant, hides the pop. 10 ticks.
  GRAB_MIN_POSE_MS: [250, 150, 400, 1, 'ms', 'REQ-SM-03', 'Grab minimum pose'], // REQ-SM-03, 150 to 400 ms (mine): a tapped grab still shows its pose.
  GRAB_RELEASE_BEFORE_LAND_MS: [60, 30, 200, 1, 'ms', 'REQ-SM-03', 'Grab release before land'], // REQ-SM-03, 80 to 200 ms (mine): a grab anim ends this long after release; later = unfinished = bail. 15 ticks.
  LIP_MIN_HOLD_MS: [150, 100, 300, 1, 'ms', 'REQ-LIP-03', 'Lip minimum hold'], // REQ-LIP-03, 100 to 300 ms (mine): a tapped Triangle still reads as a stall. 18 ticks.
  MANUAL_SWAP_COOLDOWN_MS: [600, 400, 1000, 10, 'ms', 'REQ-INP-18', 'Manual swap cooldown'], // REQ-INP-18, 400 to 1000 ms (mine): balance taps never farm nose/normal swaps. 72 ticks.
});

const INPUT = section('input', 'input', {
  STICK_DEADZONE: [0.35, 0.2, 0.5, 0.01, 'ratio', 'REQ-INP-02', 'Left stick deadzone'], // REQ-INP-02, 0.2 to 0.5 (spec §5): below this the stick is neutral for Dir8.
  DIR_SECTOR_DEG: [45, 45, 45, 1, 'deg', 'REQ-INP-02', 'Dir8 sector width'], // REQ-INP-02, fixed 45 (spec §5): 8 sectors centred on the cardinals.
  DIR_MIN_DWELL_TICKS: [3, 1, 6, 1, 'ticks', 'REQ-INP-03', 'Dir8 dwell before it enters the ring'], // REQ-INP-03, 1 to 6 ticks (mine): a stick sweep only records directions it dwelt on.
  DIR_RING_SIZE: [4, 4, 8, 1, 'entries', 'REQ-INP-03', 'DirEnter ring size'], // REQ-INP-03, 4 to 8 (not in M, DESIGN C.2 says "the last 4 entries"): enough for one pair plus slack.
  PRESS_HISTORY_SIZE: [8, 4, 16, 1, 'entries', 'REQ-INP-04', 'Press history size'], // REQ-INP-04, 4 to 16 (mine, not in M): recent presses kept in InputFrame.pressHistory for double-tap.
});

const LANDING = section('landing', 'landing', {
  LAND_OFFAXIS_BAIL_DEG: [60, 22, 75, 0.5, 'deg', 'REQ-CTL-10', 'Landing forgiveness off-axis'], // REQ-CTL-10, 22 to 60 deg (spec §6/§7 said 28; DESIGN L CR-43, founder playtest 2026-09-23: 50, arcade forgiving): yaw off-axis beyond this bails.
  LAND_OFFAXIS_OK_DEG: [20, 10, 30, 0.5, 'deg', 'REQ-CTL-10', 'Clean landing below'], // REQ-CTL-10, 10 to 30 deg (spec §6 said 15; DESIGN L CR-43, founder playtest: 20): below = clean, up to the bail angle = "OK".
  TILT_BAIL_DEG: [180, 30, 180, 0.5, 'deg', 'REQ-SM-03', 'Tilt off-axis bail'], // REQ-SM-03, 30 to 180 deg (was 40; DESIGN L CR-43, founder playtest 2026-09-23: tilt is auto-corrected and never bails, 180 = off): up axis vs surface normal at contact.
  LAND_SPEED_RETAIN: [0.96, 0.85, 1.0, 0.01, 'ratio', 'REQ-CTL-07', 'Landing speed retained'], // REQ-CTL-07, 0.85 to 1.0 (mine): tangential speed kept on contact, normal discarded.
  GETUP_LOCKOUT_S: [0.85, 0.6, 1.1, 0.01, 's', 'REQ-TIM-10', 'Get-up lockout'], // REQ-TIM-10, 0.60 to 1.10 s (spec §6/§7): no input but pause and camera. 102 ticks.
  BAIL_TUMBLE_S: [0.6, 0.4, 0.9, 0.01, 's', 'REQ-SM-05', 'Bail tumble length'], // REQ-SM-05, 0.4 to 0.9 s (mine): readable cartoon tumble before GetUp. 72 ticks.
  WALL_BAIL_SPEED_MPS: [5.0, 3, 8, 0.1, 'm/s', 'REQ-CTL-20', 'Head-on wall bail speed'], // REQ-CTL-20, 3 to 8 m/s (mine): slower contacts slide.
  WALL_BAIL_ANGLE_DEG: [45, 30, 60, 1, 'deg', 'REQ-CTL-20', 'Head-on wall incidence'], // REQ-CTL-20, 30 to 60 deg (mine): incidence at or below this is head-on.
  WALL_SLIDE_RETAIN: [0.8, 0.5, 1.0, 0.01, 'ratio', 'REQ-CTL-20', 'Wall glance speed retained'], // REQ-CTL-20, 0.5 to 1.0 (mine): glancing hits keep this much tangential speed.
});

const MOVEMENT = section('movement', 'movement', {
  MAX_SPEED_MPS: [12, 9, 18, 0.1, 'm/s', 'REQ-CTL-06', 'Max speed'], // REQ-CTL-06, 9 to 15 m/s (spec §15 said 11; DESIGN L CR-44, founder playtest 2026-09-23: 13): scaled by statFactor(speed).
  GLOW_SPEED_BONUS: [0.08, 0.05, 0.12, 0.01, 'ratio', 'REQ-SPC-03', 'Glowing max speed bonus'], // REQ-SPC-03, 0.05 to 0.12 (spec §6/§15): +8% vmax while glowing.
  OVERSPEED_DECAY: [4.0, 2, 8, 0.1, 'm/s^2', 'REQ-CTL-06', 'Over-speed decay'], // REQ-CTL-06, 2 to 8 (mine): drop-ins may exceed vmax briefly.
  GRAVITY: [20, 16, 26, 0.5, 'm/s^2', 'REQ-CTL-06', 'Gravity'], // REQ-CTL-06, 16 to 26 (spec §15): arcade floatier than real.
  PUSH_ACCEL: [13, 3, 16, 0.1, 'm/s^2', 'REQ-CTL-04', 'Auto-push acceleration'], // REQ-CTL-04, 3 to 12 (was 4.5; DESIGN L CR-44, founder playtest 2026-09-23): 0 to the 11.05 m/s push top in about 1.2 s.
  PUSH_CUTOFF: [1.0, 0.6, 1.0, 0.01, 'ratio of vmax', 'REQ-CTL-04', 'Auto-push cutoff'], // REQ-CTL-04, 0.6 to 1.0 (spec §15 said 0.7; DESIGN L CR-44, founder playtest 2026-09-23: 0.85): no pushing above 85% vmax, so a push alone carries a skater up and out of every quarter-pipe.
  PUSH_CYCLE_S: [0.6, 0.4, 0.9, 0.01, 's', 'REQ-CTL-04', 'Push animation cycle'], // REQ-CTL-04, 0.4 to 0.9 s (mine, animation): one push per cycle.
  ROLL_FRICTION: [0.25, 0.1, 0.6, 0.01, 'm/s^2', 'REQ-CTL-04', 'Rolling friction'], // REQ-CTL-04, 0.1 to 0.6 (mine): always on the ground when not pushing.
  BRAKE_DECEL: [6.0, 4, 9, 0.1, 'm/s^2', 'REQ-CTL-04', 'Brake deceleration'], // REQ-CTL-04, 4 to 9 (mine): stick back, Grounded/LandWindow only.
  BRAKE_PIVOT_SPEED: [0.5, 0.3, 1.0, 0.01, 'm/s', 'REQ-CTL-04', 'Brake pivot speed'], // REQ-CTL-04, 0.3 to 1.0 (mine): below this, stick back pivots 180 instead of reversing.
  BRAKE_PIVOT_S: [0.3, 0.2, 0.5, 0.01, 's', 'REQ-CTL-04', 'Brake pivot time'], // REQ-CTL-04, 0.2 to 0.5 s (mine).
  TURN_RATE_GROUND_DPS: [150, 110, 200, 1, 'deg/s', 'REQ-CTL-03', 'Ground turn rate at rest'], // REQ-CTL-03, 110 to 200 (mine): falls with speed via TURN_SPEED_FALLOFF.
  TURN_SPEED_FALLOFF: [0.5, 0.3, 0.7, 0.01, 'ratio', 'REQ-CTL-03', 'Turn rate falloff'], // REQ-CTL-03, 0.3 to 0.7 (mine): rate x (1 - falloff x v / vmax), 75 deg/s at vmax.
  TURN_RATE_MANUAL_DPS: [150, 60, 220, 1, 'deg/s', 'REQ-CTL-03', 'Manual turn rate'], // REQ-CTL-03, 60 to 120 (mine): radius 0.477 x v; sets the Woodshed chain row spacing.
  PUMP_ACCEL: [4.0, 2, 6, 0.1, 'm/s^2', 'REQ-CTL-11', 'Pump acceleration'], // REQ-CTL-11, 2 to 6 (mine): Cross held on a transition while descending.
  TRANSITION_GRAVITY_FACTOR: [0.3, 0.2, 0.7, 0.01, 'ratio', 'REQ-CTL-11', 'Transition gravity factor'], // REQ-CTL-11, 0.2 to 0.7 (was 0.45; DESIGN L CR-44, founder playtest 2026-09-23: 0.3): along-surface gravity on transitions, so ramps keep speed and vert walls throw real air.
  ROLLBACK_SPEED_MPS: [0.5, 0.2, 1.0, 0.01, 'm/s', 'REQ-CTL-18', 'Transition roll-back speed'], // REQ-CTL-18, 0.2 to 1.0 (not in M, DESIGN C.6): below this on a transition the skater rolls back down.
  SKATER_RADIUS_M: [0.35, 0.3, 0.45, 0.01, 'm', 'REQ-CTL-01', 'Skater capsule radius'], // REQ-CTL-01, 0.3 to 0.45 m (mine).
  SKATER_HEIGHT_M: [1.8, 1.6, 2.0, 0.01, 'm', 'REQ-CTL-01', 'Skater height'], // REQ-CTL-01, 1.6 to 2.0 m (mine): render only; air collision uses one sphere.
  AIR_SPHERE_UP_M: [0.45, 0.3, 0.9, 0.01, 'm', 'REQ-CTL-22', 'Air sphere height above feet'], // REQ-CTL-22, 0.3 to 0.9 m (mine): the head never collides.
  GROUND_PROBE_M: [0.3, 0.1, 0.6, 0.01, 'm', 'REQ-SM-12', 'Ground probe reach'], // REQ-SM-12, 0.1 to 0.6 m (not in M, DESIGN C.5 row 37): the down ray missing within this = leftSurface.
  BOARD_THICKNESS_M: [0.05, 0.02, 0.1, 0.005, 'm', 'REQ-GRD-03', 'Board thickness above a rail'], // REQ-GRD-03, 0.02 to 0.1 m (not in M, DESIGN E.1): snap raises the board by this.
});

const AIR = section('air', 'air', {
  OLLIE_H_TAP_M: [1.2, 0.7, 2.0, 0.01, 'm', 'REQ-CTL-05', 'Ollie height, tap'], // REQ-CTL-05, 0.7 to 1.5 m (spec §15 said 0.9; DESIGN L CR-44, founder playtest 2026-09-23: 1.2).
  OLLIE_H_FULL_M: [2.5, 1.3, 3.2, 0.01, 'm', 'REQ-CTL-05', 'Ollie height, full charge'], // REQ-CTL-05, 1.3 to 2.5 m (spec §15 said 1.6; DESIGN L CR-44, founder playtest 2026-09-23: 2.0).
  OLLIE_TAP_MAX_S: [0.1, 0.05, 0.2, 0.01, 's', 'REQ-CTL-05', 'Tap hold time'], // REQ-CTL-05, 0.05 to 0.2 s (spec §8 "0.1 to 0.6 s"): holds shorter than this are a tap.
  OLLIE_FULL_S: [0.6, 0.4, 0.8, 0.01, 's', 'REQ-CTL-05', 'Full charge hold time'], // REQ-CTL-05, 0.4 to 0.8 s (spec §8).
  OLLIE_CHARGE_EXP: [1.0, 0.6, 1.5, 0.05, 'exponent', 'REQ-CTL-05', 'Charge curve exponent'], // REQ-CTL-05, 0.6 to 1.5 (mine): linear reads best on a pad.
  POP_UP_BLEND: [0.5, 0.3, 0.7, 0.01, 'ratio', 'REQ-CTL-05', 'Pop direction blend (normal vs up)'], // REQ-CTL-05, 0.3 to 0.7 (mine): 50/50 normal and world up.
  VERT_POP_SCALE: [0.6, 0.4, 1.0, 0.01, 'ratio', 'REQ-VRT-02', 'Pop scale on steep faces'], // REQ-VRT-02, 0.4 to 1.0 (mine): pop on slope >= 45 is scaled so vert airs match the air table.
  LAND_PREDICT_AHEAD_S: [0.25, 0.1, 0.5, 0.01, 's', 'REQ-CTL-09', 'Landing prediction look-ahead'], // REQ-CTL-09, 0.1 to 0.5 s (mine).
  LAND_PREDICT_EVERY_TICKS: [4, 1, 8, 1, 'ticks', 'REQ-CTL-09', 'Landing prediction refresh'], // REQ-CTL-09, 1 to 8 ticks (mine).
  AIR_ORIENT_RATE_DPS: [360, 240, 540, 1, 'deg/s', 'REQ-CTL-09', 'Air auto-orient rate'], // REQ-CTL-09, 240 to 540 (mine): pitch/roll toward the predicted landing normal.
  SPIN_RATE_STICK_DPS: [360, 270, 450, 1, 'deg/s', 'REQ-VRT-03', 'Stick spin rate'], // REQ-VRT-03, 270 to 450 (mine): scaled by statFactor(spin) and stick deflection.
  QUICKSPIN_STEP_DEG: [180, 180, 180, 1, 'deg', 'REQ-VRT-04', 'Quick spin step'], // REQ-VRT-04, fixed 180 (CR-01): bursts snap to 180.
  QUICKSPIN_RATE_DPS: [720, 540, 900, 1, 'deg/s', 'REQ-VRT-04', 'Quick spin rate'], // REQ-VRT-04, 540 to 900 (CR-01): a 180 in 0.25 s.
  SPIN_RATE_CAP_DPS: [900, 720, 1080, 1, 'deg/s', 'REQ-VRT-04', 'Spin rate cap'], // REQ-VRT-04, 720 to 1080 (mine): stick + quick spin add, capped here.
  POP_POSE_MS: [150, 80, 300, 1, 'ms', 'REQ-SKT-03', 'Pop pose length'], // REQ-SKT-03, 80 to 300 ms (mine, not in M, M0 review): the sim shows pose "pop" this long after a pop unless an air trick starts; the PoseId table in src/core/types.ts. 18 ticks.
});

const VERT = section('vert', 'vert', {
  FLAT_MAX_SLOPE_DEG: [35, 25, 40, 0.5, 'deg', 'REQ-CTL-17', 'Flat max slope'], // REQ-CTL-17, 25 to 40 (mine): manuals only below this.
  VERT_LAND_MIN_SLOPE_DEG: [40, 35, 60, 0.5, 'deg', 'REQ-CTL-17', 'Vert landing min slope'], // REQ-CTL-17, 35 to 60 (mine): reverts only at or above; fountain returns land at 40 to 47.
  VERT_ASSIST_MIN_SLOPE_DEG: [70, 60, 80, 0.5, 'deg', 'REQ-VRT-01', 'Vert assist min exit slope'], // REQ-VRT-01, 60 to 80 (mine, CR-15): leaving a transition this steep triggers the assist.
  WALL_MIN_SLOPE_DEG: [80, 70, 89, 0.5, 'deg', 'REQ-CTL-20', 'Wall min slope'], // REQ-CTL-20, 70 to 89 (mine): untagged surfaces this steep are walls.
  VERT_ASSIST_MAX_LATERAL: [0.4, 0.25, 0.6, 0.01, 'ratio', 'REQ-VRT-01', 'Vert assist max lateral fraction'], // REQ-VRT-01, 0.25 to 0.6 (mine): carving harder than this is a free launch.
  VERT_ASSIST_KEEP: [0.15, 0, 0.3, 0.01, 'ratio', 'REQ-VRT-01', 'Vert assist perpendicular keep'], // REQ-VRT-01, 0 to 0.3 (mine, CR-15): perpendicular horizontal speed kept.
  VERT_ASSIST_MIN_OUT_MPS: [0.4, 0.2, 0.8, 0.01, 'm/s', 'REQ-VRT-01', 'Vert assist min outward speed'], // REQ-VRT-01, 0.2 to 0.8 (mine): lands 0.7 to 1.3 m below the coping.
  VERT_ASSIST_MAX_OUT_MPS: [1.0, 0.6, 1.5, 0.01, 'm/s', 'REQ-VRT-01', 'Vert assist max outward speed'], // REQ-VRT-01, 0.6 to 1.5 (mine).
  FULLPIPE_ASSIST_OUT_MPS: [2.0, 1.5, 3.0, 0.01, 'm/s', 'REQ-VRT-11', 'Full-pipe toward-axis speed'], // REQ-VRT-11, 1.5 to 3.0 (mine): keeps the overhanging pipe wall clear.
  SPINE_TRANSFER_HEIGHT_M: [1.5, 1.0, 2.0, 0.01, 'm', 'REQ-VRT-08', 'Spine transfer height window'], // REQ-VRT-08, 1.0 to 2.0 m (spec §9.2): within this above a transfer rail.
  SPINE_TRANSFER_LATERAL_M: [1.0, 0.6, 1.5, 0.01, 'm', 'REQ-VRT-08', 'Spine transfer lateral window'], // REQ-VRT-08, 0.6 to 1.5 m (mine).
  SPINE_TRANSFER_PUSH_MPS: [0.4, 0.3, 1.5, 0.01, 'm/s', 'REQ-VRT-08', 'Spine transfer min outward speed'], // REQ-VRT-08, 0.3 to 1.5 (mine): matches the assist so the far landing sits 1.0 m below the coping.
  SPINE_TRANSFER_ANIM_S: [0.3, 0.2, 0.5, 0.01, 's', 'REQ-VRT-08', 'Spine transfer body rotation'], // REQ-VRT-08, 0.2 to 0.5 s (mine, animation only).
});

const GRIND = section('grind', 'grind', {
  GRIND_MAGNET_RADIUS_M: [0.55, 0.4, 0.8, 0.01, 'm', 'REQ-GRD-02', 'Grind magnet radius'], // REQ-GRD-02, 0.40 to 0.80 m (spec §7): arcade sticky.
  GRIND_ENTRY_MAX_DEG: [55, 45, 70, 0.5, 'deg', 'REQ-GRD-02', 'Grind entry max angle'], // REQ-GRD-02, 45 to 70 (spec §7): horizontal angle between velocity and rail tangent.
  GRIND_FRICTION_RAIL: [0.1, 0, 0.8, 0.01, 'm/s^2', 'REQ-GRD-08', 'Grind friction, rail'], // REQ-GRD-08, 0 to 0.8 (mine): rails keep speed for the 20 s chain.
  GRIND_FRICTION_LEDGE: [0.3, 0, 0.8, 0.01, 'm/s^2', 'REQ-GRD-08', 'Grind friction, ledge'], // REQ-GRD-08, 0 to 0.8 (mine): concrete bites a little.
  GRIND_FRICTION_COPING: [0.15, 0, 0.8, 0.01, 'm/s^2', 'REQ-GRD-08', 'Grind friction, coping'], // REQ-GRD-08, 0 to 0.8 (mine).
  GRIND_GRAVITY_FACTOR: [0.35, 0.2, 1.0, 0.01, 'ratio', 'REQ-GRD-08', 'Grind slope gravity factor'], // REQ-GRD-08, 0.2 to 1.0 (mine): sloped rails accelerate, not violently; scaffold climb stays holdable.
  GRIND_MIN_SPEED: [1.5, 1.0, 2.5, 0.01, 'm/s', 'REQ-GRD-08', 'Grind stall speed'], // REQ-GRD-08, 1.0 to 2.5 (mine): below this the skater hops off (row 22).
  GRIND_MIN_ENTRY_SPEED: [3.0, 2, 4, 0.01, 'm/s', 'REQ-GRD-03', 'Grind min snapped speed'], // REQ-GRD-03, 2 to 4 (mine): slow approaches still slide.
  GRIND_EXIT_POP_M: [0.3, 0.2, 0.5, 0.01, 'm', 'REQ-GRD-08', 'Grind stall-out hop'], // REQ-GRD-08, 0.2 to 0.5 m (mine).
  GRIND_GROUND_SNAP_MIN_SPEED: [3.0, 2, 5, 0.01, 'm/s', 'REQ-GRD-05', 'Ground snap min speed'], // REQ-GRD-05, 2 to 5 (mine): Triangle while rolling hops onto a low rail.
  GRIND_GROUND_SNAP_DY_MIN: [-0.2, -0.5, 0, 0.01, 'm', 'REQ-GRD-05', 'Ground snap min rail height'], // REQ-GRD-05, -0.5 to 0 (mine).
  GRIND_GROUND_SNAP_DY_MAX: [0.7, 0.4, 1.0, 0.01, 'm', 'REQ-GRD-05', 'Ground snap max rail height'], // REQ-GRD-05, 0.4 to 1.0 (mine): MS-R1 0.6, WS-RA 0.55 qualify.
  GRIND_GROUND_SNAP_HOP_MIN_M: [0.3, 0.2, 0.5, 0.01, 'm', 'REQ-GRD-05', 'Ground snap min hop'], // REQ-GRD-05, 0.2 to 0.5 (not in M, DESIGN E.1): hop = max(this, dy + clearance).
  GRIND_GROUND_SNAP_CLEAR_M: [0.1, 0.05, 0.3, 0.01, 'm', 'REQ-GRD-05', 'Ground snap hop clearance'], // REQ-GRD-05, 0.05 to 0.3 (not in M, DESIGN E.1).
  GRIND_CORNER_MAX_DEG: [55, 30, 90, 0.5, 'deg', 'REQ-GRD-10', 'Rail corner max bend'], // REQ-GRD-10, 30 to 90 (mine): sharper polyline corners act as rail ends.
  RAIL_GRID_CELL_M: [8, 4, 16, 1, 'm', 'REQ-GRD-14', 'Rail spatial hash cell'], // REQ-GRD-14, 4 to 16 m (mine): magnet queries touch at most 9 cells.
});

const LIP = section('lip', 'lip', {
  LIP_MAGNET_M: [0.55, 0.4, 0.8, 0.01, 'm', 'REQ-LIP-01', 'Lip magnet radius'], // REQ-LIP-01, 0.4 to 0.8 m (mine): same as grind.
  LIP_MAX_VY: [3.0, 2, 5, 0.01, 'm/s', 'REQ-LIP-01', 'Lip max vertical speed'], // REQ-LIP-01, 2 to 5 (mine): must be near the apex.
  LIP_BELOW_COPING_M: [0.3, 0.1, 0.6, 0.01, 'm', 'REQ-LIP-01', 'Lip reach below coping'], // REQ-LIP-01, 0.1 to 0.6 m (not in M, DESIGN C.6 "at coping"): skater y >= coping y - this.
  LIP_EXIT_SPEED: [3.5, 2.5, 5, 0.01, 'm/s', 'REQ-LIP-03', 'Lip exit speed down the face'], // REQ-LIP-03, 2.5 to 5 (mine).
  LIP_EXIT_POP_M: [0.25, 0.1, 0.4, 0.01, 'm', 'REQ-LIP-03', 'Lip exit pop'], // REQ-LIP-03, 0.1 to 0.4 m (mine): halved in the exit formula.
  LIP_EXIT_OFFSET_M: [0.15, 0.1, 0.3, 0.01, 'm', 'REQ-LIP-03', 'Lip exit offset off the face'], // REQ-LIP-03, 0.1 to 0.3 m (mine).
});

const MANUAL = section('manual', 'manual', {
  MANUAL_FRICTION: [0.15, 0.05, 0.8, 0.01, 'm/s^2', 'REQ-MAN-04', 'Manual friction'], // REQ-MAN-04, 0.2 to 0.8 (mine): a 3 s manual costs about 1 m/s.
  MANUAL_MIN_SPEED: [0.6, 0.3, 2.0, 0.01, 'm/s', 'REQ-MAN-05', 'Manual min speed'], // REQ-MAN-05, 0.5 to 2.0 (mine): entry needs it, below it the manual banks.
  MANUAL_SWAP_MAX_PER_RUN: [3, 2, 5, 1, 'count', 'REQ-INP-18', 'Manual swaps per manual run'], // REQ-INP-18, 2 to 5 (mine).
  MANUAL_SWAP_MIN_HOLD_TICKS: [4, 2, 8, 1, 'ticks', 'REQ-INP-18', 'Manual swap second-direction hold'], // REQ-INP-18, 2 to 8 ticks (mine).
  REVERT_SPEED_RETAIN: [0.85, 0.7, 1.0, 0.01, 'ratio', 'REQ-REV-04', 'Revert speed retained'], // REQ-REV-04, 0.7 to 1.0 (mine): a pivot costs a little speed.
});

const SCORING = section('scoring', 'scoring', {
  FLIP_BASE_T1: [100, 80, 150, 1, 'points', 'REQ-SCR-09', 'Flip base, tier 1'], // REQ-SCR-09, 80 to 150 (spec §6 "100 to 250 by tier"; not in M): tier t base = this + (t - 1) x FLIP_TIER_STEP.
  FLIP_TIER_STEP: [50, 25, 100, 1, 'points', 'REQ-SCR-09', 'Flip tier step'], // REQ-SCR-09, 25 to 100 (spec §6 "100 to 250 by tier"): tiers 100/150/200/250; enhanced = +1 step.
  FLIP_ANIM_MS_T1: [300, 250, 500, 1, 'ms', 'REQ-SCR-09', 'Flip anim, tier 1'], // REQ-SCR-09, 300 to 500 (mine).
  FLIP_ANIM_MS_T2: [340, 250, 600, 1, 'ms', 'REQ-SCR-09', 'Flip anim, tier 2'], // REQ-SCR-09, 350 to 600 (mine).
  FLIP_ANIM_MS_T3: [380, 300, 700, 1, 'ms', 'REQ-SCR-09', 'Flip anim, tier 3'], // REQ-SCR-09, 400 to 700 (mine).
  FLIP_ANIM_MS_T4: [420, 300, 800, 1, 'ms', 'REQ-SCR-09', 'Flip anim, tier 4'], // REQ-SCR-09, 450 to 800 (mine).
  ENHANCED_ANIM_EXTRA_MS: [120, 80, 200, 1, 'ms', 'REQ-SCR-11', 'Enhanced flip extra anim'], // REQ-SCR-11, 80 to 200 (mine): double_tre_flip 720 ms still fits a full ollie.
  ENHANCED_GRAB_BONUS: [50, 25, 100, 1, 'points', 'REQ-SCR-11', 'Tweaked grab bonus'], // REQ-SCR-11, 25 to 100 (spec §5 "+1 tier"): Tweaked grabs 200.
  STANCE_SWITCH_MULT: [1.2, 1.1, 1.4, 0.01, 'ratio', 'REQ-SCR-02', 'Switch stance multiplier'], // REQ-SCR-02, 1.1 to 1.4 (spec §6, CR-05): on trickValue only.
  NOLLIE_FAKIE_MULT: [1.1, 1.0, 1.2, 0.01, 'ratio', 'REQ-SCR-10', 'Nollie / fakie base multiplier'], // REQ-SCR-10, 1.0 to 1.2 (mine, open question 8).
  SPIN_MULT_PER_180: [0.5, 0.25, 1.0, 0.05, 'multiplier', 'REQ-SCR-03', 'Multiplier per 180 of spin'], // REQ-SCR-03, 0.25 to 1.0 (spec §6, CR-08).
  SPIN_BASE_PER_180: [100, 50, 200, 1, 'points', 'REQ-SCR-03', 'Base points per 180 (base mode)'], // REQ-SCR-03, 50 to 200 (mine): used only when SPIN_MODE = "base".
  SICK_THRESHOLD: [10000, 5000, 20000, 100, 'points', 'REQ-SCR-08', 'SICK land text threshold'], // REQ-SCR-08, 5000 to 20000 (spec §6).
  INSANE_THRESHOLD: [50000, 25000, 100000, 500, 'points', 'REQ-SCR-08', 'INSANE land text threshold'], // REQ-SCR-08, 25000 to 100000 (spec §6).
  MACGUFFIN_BASE: [2500, 2500, 2500, 1, 'points', 'REQ-SCR-06', 'MacGuffin base'], // REQ-SCR-06, fixed 2500 (spec §6): never degrades.
  BASE_GRAB: [150, 100, 250, 1, 'points', 'REQ-SCR-09', 'Grab base'], // REQ-SCR-09, 100 to 250 (spec §6).
  HOLD_GRAB: [100, 50, 150, 1, 'points/s', 'REQ-SCR-09', 'Grab hold rate'], // REQ-SCR-09, 50 to 150 (spec §6).
  BASE_FIFTY_FIFTY: [100, 80, 150, 1, 'points', 'REQ-SCR-09', '50-50 base'], // REQ-SCR-09, 80 to 150 (spec §6).
  HOLD_FIFTY_FIFTY: [80, 50, 120, 1, 'points/s', 'REQ-SCR-09', '50-50 hold rate'], // REQ-SCR-09, 50 to 120 (spec §6).
  HOLD_GRIND_DIRECTIONAL: [90, 60, 130, 1, 'points/s', 'REQ-SCR-09', 'Directional grind hold rate'], // REQ-SCR-09, 60 to 130 (spec §6).
  BASE_MANUAL: [50, 30, 100, 1, 'points', 'REQ-SCR-09', 'Manual base'], // REQ-SCR-09, 30 to 100 (spec §6).
  HOLD_MANUAL: [40, 20, 80, 1, 'points/s', 'REQ-SCR-09', 'Manual hold rate'], // REQ-SCR-09, 20 to 80 (spec §6).
  BASE_LIP: [150, 100, 250, 1, 'points', 'REQ-SCR-09', 'Lip base'], // REQ-SCR-09, 100 to 250 (spec §6).
  HOLD_LIP: [100, 50, 150, 1, 'points/s', 'REQ-SCR-09', 'Lip hold rate'], // REQ-SCR-09, 50 to 150 (spec §6).
  BASE_REVERT: [100, 50, 200, 1, 'points', 'REQ-SCR-09', 'Revert base'], // REQ-SCR-09, 50 to 200 (spec §6).
  HOLD_SPECIAL: [150, 100, 250, 1, 'points/s', 'REQ-SCR-09', 'Holdable special rate'], // REQ-SCR-09, 100 to 250 (spec §6/§9.1): 900ms Inference and the special grind (gpu_slide).
  HOLD_CONTEXT_WINDOW: [60, 40, 120, 1, 'points/s', 'REQ-SCR-09', 'Context Window hold rate'], // REQ-SCR-09, 40 to 120 (spec §9.1).
});

const SPECIAL = section('special', 'special', {
  SPECIAL_FULL_BASE: [3000, 2000, 9000, 50, 'points', 'REQ-SPC-01', 'Special meter full at'], // REQ-SPC-01, 4000 to 9000 (spec §6): fed by trickValue + accrual per completed element.
  SPECIAL_IDLE_DELAY_S: [4.0, 2, 6, 0.1, 's', 'REQ-SPC-02', 'Special idle delay'], // REQ-SPC-02, 2 to 5 s (spec §6).
  SPECIAL_DRAIN_PER_S: [0.03, 0.01, 0.08, 0.005, 'ratio/s', 'REQ-SPC-02', 'Special idle drain'], // REQ-SPC-02, 0.02 to 0.08 (spec §6): 4%/s.
  SPECIAL_GLOW_OFF: [0.85, 0.6, 0.95, 0.01, 'ratio', 'REQ-SPC-03', 'Glow off below'], // REQ-SPC-03, 0.6 to 0.95 (mine): hysteresis so a short idle keeps the glow.
  INFERENCE_TIME_SCALE: [0.6, 0.4, 0.8, 0.01, 'ratio', 'REQ-SPC-05', '900ms Inference time scale'], // REQ-SPC-05, 0.4 to 0.8 (spec §9.1): sim runs at 0.6x real time while held.
  INFERENCE_MIN_HOLD_MS: [900, 600, 1200, 10, 'ms', 'REQ-SPC-05', '900ms Inference min pose'], // REQ-SPC-05, 600 to 1200 (mine).
  SPECIAL_HOLD_GOAL_S: [3.0, 2, 5, 0.1, 's', 'REQ-WSH-06', 'Hold-a-special goal length'], // REQ-WSH-06, 2 to 5 s (spec §9.2 Woodshed goal 9): presentation seconds.
});

const BALANCE = section('balance', 'balance', {
  BAL_K0: [0.5, 0.3, 1.0, 0.01, '1/s^2', 'REQ-BAL-01', 'Balance base drift'], // REQ-BAL-01, 0.3 to 1.0 (mine): 3.54 s hands-off on a first grind.
  BAL_ELEMENT_GAIN: [0.12, 0.06, 0.2, 0.005, 'ratio', 'REQ-BAL-01', 'Drift gain per element'], // REQ-BAL-01, 0.06 to 0.20 (spec §6, CR-06): the difficulty curve.
  BAL_SAME_OBJECT_MULT: [1.6, 1.2, 2.0, 0.01, 'ratio', 'REQ-BAL-04', 'Same-object drift multiplier'], // REQ-BAL-04, 1.2 to 2.0 (spec §6): previous grind on the same rail id.
  BAL_RECENTER: [0.35, 0.2, 0.5, 0.01, 'ratio', 'REQ-BAL-02', 'Re-centre on new element'], // REQ-BAL-02, 0.2 to 0.5 (spec §6, CR-06): needle = 0.35 x sign(prev).
  BAL_INPUT_ACCEL: [2.0, 1.2, 3.0, 0.01, '1/s^2', 'REQ-BAL-01', 'Balance input push'], // REQ-BAL-01, 1.2 to 3.0 (mine): out-pushes drift until about 25 elements.
  BAL_DAMP: [1.5, 0.5, 3.0, 0.01, '1/s', 'REQ-BAL-01', 'Needle damping'], // REQ-BAL-01, 0.5 to 3.0 (mine): drift velocity saturates at k / damp.
  BAL_START_OFFSET: [0.05, 0, 0.15, 0.005, 'needle', 'REQ-BAL-02', 'First element start offset'], // REQ-BAL-02, 0 to 0.15 (mine): seeded sign so the needle is never static.
  CONTEXT_WINDOW_DRIFT_MULT: [2.0, 1.5, 3.0, 0.01, 'ratio', 'REQ-BAL-01', 'Context Window drift multiplier'], // REQ-BAL-01, 1.5 to 3.0 (spec §9.1): drift x2 while held.
});

const STATS = section('stats', 'stats', {
  STAT_FACTOR_BASE: [0.7, 0.5, 0.8, 0.01, 'ratio', 'REQ-CTL-13', 'statFactor base'], // REQ-CTL-13, 0.5 to 0.8 (mine): statFactor(s) = base + per x s, 6 -> 1.0.
  STAT_FACTOR_PER: [0.05, 0.03, 0.08, 0.005, 'ratio', 'REQ-CTL-13', 'statFactor per point'], // REQ-CTL-13, 0.03 to 0.08 (mine).
  STAT_SPEED: [6, 0, 10, 1, 'stat', 'REQ-CTL-13', 'Stat: speed'], // REQ-CTL-13, 0 to 10 (spec §15): 6/10.
  STAT_AIR: [6, 0, 10, 1, 'stat', 'REQ-CTL-13', 'Stat: air'], // REQ-CTL-13, 0 to 10 (spec §15): 6/10.
  STAT_BALANCE: [6, 0, 10, 1, 'stat', 'REQ-CTL-13', 'Stat: balance'], // REQ-CTL-13, 0 to 10 (spec §15): 6/10.
  STAT_SWITCH: [4, 0, 10, 1, 'stat', 'REQ-CTL-13', 'Stat: switch'], // REQ-CTL-13, 0 to 10 (spec §15): 4/10.
  STAT_SPIN: [6, 0, 10, 1, 'stat', 'REQ-CTL-13', 'Stat: spin'], // REQ-CTL-13, 0 to 10 (spec §15): 6/10.
  SWITCH_POP_PENALTY: [0.15, 0.05, 0.3, 0.01, 'ratio at stat 4', 'REQ-CTL-13', 'Switch pop penalty'], // REQ-CTL-13, 0.05 to 0.3 (spec §15): -15% pop in switch at switch stat 4.
  SWITCH_DRIFT_MULT: [1.35, 1.0, 1.6, 0.01, 'ratio at stat 4', 'REQ-CTL-13', 'Switch drift multiplier'], // REQ-CTL-13, 1.0 to 1.6 (CR-19): 20% less hands-off time under the damped needle.
});

const CAMERA = section('camera', 'camera', {
  CAM_BACK_M: [6.0, 3, 8, 0.05, 'm', 'REQ-CAM-01', 'Chase camera distance back'], // REQ-CAM-01, 3 to 8 m (spec §10 said 4.2; DESIGN L CR-45, founder playtest 2026-09-23: 6.0, zoomed back).
  CAM_UP_M: [2.3, 1, 3, 0.05, 'm', 'REQ-CAM-01', 'Chase camera height'], // REQ-CAM-01, 1 to 3 m (spec §10 said 1.6; DESIGN L CR-45, founder playtest 2026-09-23: 2.3).
  CAM_LOOKAHEAD_M: [1.5, 0.5, 3, 0.05, 'm', 'REQ-CAM-01', 'Camera look-ahead'], // REQ-CAM-01, 0.5 to 3 m (spec §10): along velocity.
  CAM_OMEGA: [8, 4, 14, 0.1, '1/s', 'REQ-CAM-01', 'Camera spring omega'], // REQ-CAM-01, 4 to 14 (spec §10): critically damped.
  CAM_VERT_BACK_EXTRA_M: [2.5, 1, 4, 0.05, 'm', 'REQ-CAM-02', 'Vert air extra distance'], // REQ-CAM-02, 1 to 4 m (mine; DESIGN L CR-45: 2.0 -> 2.5 to match the farther chase camera and the higher CR-44 vert airs): frames the ramp.
  CAM_VERT_UP_EXTRA_M: [1.8, 0.5, 3, 0.05, 'm', 'REQ-CAM-02', 'Vert air extra height'], // REQ-CAM-02, 0.5 to 3 m (mine; DESIGN L CR-45: 1.5 -> 1.8).
  CAM_VERT_BLEND_S: [0.3, 0.1, 0.6, 0.01, 's', 'REQ-CAM-02', 'Vert air blend time'], // REQ-CAM-02, 0.1 to 0.6 s (mine).
  CAM_ORBIT_RATE_DPS: [180, 90, 300, 1, 'deg/s', 'REQ-CAM-03', 'Right stick orbit rate'], // REQ-CAM-03, 90 to 300 (mine).
  CAM_ORBIT_RETURN_S: [1.2, 0.5, 2.5, 0.05, 's', 'REQ-CAM-03', 'Orbit spring-back delay'], // REQ-CAM-03, 0.5 to 2.5 s (spec §10).
  CAM_MOUSE_DEG_PER_PX: [0.15, 0.05, 0.4, 0.01, 'deg/px', 'REQ-CAM-03', 'Mouse look sensitivity'], // REQ-CAM-03, 0.05 to 0.4 (mine): pointer lock fallback.
  CAM_FOV_DEG: [70, 60, 85, 0.5, 'deg', 'REQ-CAM-04', 'Base FOV'], // REQ-CAM-04, 60 to 85 (mine).
  CAM_FOV_KICK_DEG: [6, 3, 10, 0.5, 'deg', 'REQ-CAM-04', 'FOV kick at speed'], // REQ-CAM-04, 3 to 10 (spec §10).
  CAM_FOV_KICK_SPEED: [0.85, 0.7, 0.95, 0.01, 'ratio of vmax', 'REQ-CAM-04', 'FOV kick / speed lines threshold'], // REQ-CAM-04, 0.7 to 0.95 (spec §10).
  SPEED_TIER_CRUISE_RATIO: [0.3, 0.1, 0.6, 0.01, 'ratio of vmax', 'REQ-CAM-04', 'Speed tier: cruise from'], // REQ-CAM-04, 0.1 to 0.6 (mine, not in M, M0 review): SpeedTier slow below, cruise from here, fast from CAM_FOV_KICK_SPEED (wind audio, roll pitch).
  CAM_FOV_LERP: [4, 2, 8, 0.1, '1/s', 'REQ-CAM-04', 'FOV lerp rate'], // REQ-CAM-04, 2 to 8 (mine).
  CAM_COLLIDE_PAD_M: [0.3, 0.1, 0.6, 0.01, 'm', 'REQ-CAM-05', 'Camera collision pad'], // REQ-CAM-05, 0.1 to 0.6 m (mine).
  CAM_MIN_BOOM_M: [1.2, 0.8, 2.0, 0.01, 'm', 'REQ-CAM-05', 'Camera min boom'], // REQ-CAM-05, 0.8 to 2.0 m (mine): below it the camera rises instead.
  CAM_MIN_BOOM_RISE: [1.5, 1.0, 3.0, 0.01, 'ratio', 'REQ-CAM-05', 'Camera rise per missing boom'], // REQ-CAM-05, 1.0 to 3.0 (mine): rise = (min boom - hit) x this.
  CAM_SHAKE_BAIL_AMP_M: [0.12, 0.05, 0.25, 0.01, 'm', 'REQ-CAM-06', 'Bail shake amplitude'], // REQ-CAM-06, 0.05 to 0.25 m (spec §10).
  CAM_SHAKE_BAIL_S: [0.35, 0.2, 0.6, 0.01, 's', 'REQ-CAM-06', 'Bail shake length'], // REQ-CAM-06, 0.2 to 0.6 s (mine).
});

const FX = section('fx', 'fx', {
  HITSTOP_MACGUFFIN_MS: [60, 30, 120, 1, 'ms', 'REQ-FX-03', 'MacGuffin hitstop'], // REQ-FX-03, 30 to 120 ms (spec §10): floored to 7 ticks by hitstopTicks().
  FLASH_MACGUFFIN_MS: [120, 60, 250, 1, 'ms', 'REQ-FX-03', 'MacGuffin screen flash'], // REQ-FX-03, 60 to 250 ms (mine).
  SPARK_RATE_PER_S: [240, 100, 600, 1, 'particles/s', 'REQ-FX-01', 'Grind spark rate'], // REQ-FX-01, 100 to 600 (mine).
  DUST_BURST_COUNT: [24, 8, 64, 1, 'particles', 'REQ-FX-02', 'Landing dust burst'], // REQ-FX-02, 8 to 64 (mine).
  RUMBLE_GRIND_WEAK: [0.25, 0, 0.6, 0.01, 'ratio', 'REQ-INP-05', 'Rumble: grind (weak motor)'], // REQ-INP-05, 0 to 0.6 (spec §5 "light"): pulsed while grinding.
  RUMBLE_GRIND_PULSE_MS: [100, 50, 200, 1, 'ms', 'REQ-INP-05', 'Rumble: grind pulse'], // REQ-INP-05, 50 to 200 ms (mine).
  RUMBLE_BAIL_STRONG: [0.8, 0.4, 1.0, 0.01, 'ratio', 'REQ-INP-05', 'Rumble: bail (strong motor)'], // REQ-INP-05, 0.4 to 1.0 (spec §5 "medium").
  RUMBLE_BAIL_MS: [250, 150, 400, 1, 'ms', 'REQ-INP-05', 'Rumble: bail length'], // REQ-INP-05, 150 to 400 ms (mine).
  RUMBLE_GAP_STRONG: [0.5, 0.2, 0.8, 0.01, 'ratio', 'REQ-INP-05', 'Rumble: gap'], // REQ-INP-05, 0.2 to 0.8 (spec §5 "short pulse").
  RUMBLE_GAP_MS: [120, 60, 200, 1, 'ms', 'REQ-INP-05', 'Rumble: gap length'], // REQ-INP-05, 60 to 200 ms (mine).
  RUMBLE_MACGUFFIN_STRONG: [0.6, 0.3, 1.0, 0.01, 'ratio', 'REQ-INP-05', 'Rumble: MacGuffin'], // REQ-INP-05, 0.3 to 1.0 (spec §5).
  RUMBLE_MACGUFFIN_MS: [200, 100, 300, 1, 'ms', 'REQ-INP-05', 'Rumble: MacGuffin length'], // REQ-INP-05, 100 to 300 ms (mine).
});

const HUD = section('hud', 'hud', {
  CLOCK_RED_S: [10, 5, 20, 1, 's', 'REQ-HUD-01', 'Clock red pulse under'], // REQ-HUD-01, 5 to 20 s (spec §17).
  LAND_TEXT_S: [0.6, 0.3, 1.2, 0.05, 's', 'REQ-HUD-04', 'Land text duration'], // REQ-HUD-04, 0.3 to 1.2 s (mine).
  GAP_SPLASH_S: [1.2, 0.6, 2.0, 0.05, 's', 'REQ-HUD-04', 'Gap splash duration'], // REQ-HUD-04, 0.6 to 2.0 s (mine).
  MACGUFFIN_SPLASH_S: [1.5, 1.0, 2.5, 0.05, 's', 'REQ-HUD-01', 'MacGuffin splash duration'], // REQ-HUD-01, 1.0 to 2.5 s (mine).
  NPC_DIALOG_S: [4.0, 2, 8, 0.1, 's', 'REQ-NPC-02', 'NPC dialog duration'], // REQ-NPC-02, 2 to 8 s (mine).
});

const RUN = section('run', 'run', {
  RUN_LENGTH_S: [120, 60, 180, 1, 's', 'REQ-GOL-01', 'Run length'], // REQ-GOL-01, 60 to 180 s (spec §6/§19): the default session is a 2:00 run.
  RUN_OVERTIME_MAX_S: [30, 10, 60, 1, 's', 'REQ-SM-09', 'Overtime cap'], // REQ-SM-09, 10 to 60 s (mine): a combo alive this long after 0:00 is forced to Bail.
  COLLECT_RADIUS_M: [0.9, 0.6, 1.2, 0.01, 'm', 'REQ-CTL-15', 'Collect radius'], // REQ-CTL-15, 0.6 to 1.2 m (mine): letters and MacGuffins.
  COLLECT_POINT_UP_M: [0.9, 0.5, 1.2, 0.01, 'm', 'REQ-CTL-15', 'Collect point above feet'], // REQ-CTL-15, 0.5 to 1.2 m (not in M, DESIGN C.6): feet + this world up.
  TALK_TRIGGER_M: [2.0, 1.5, 3.0, 0.05, 'm', 'REQ-NPC-02', 'NPC talk trigger radius'], // REQ-NPC-02, 1.5 to 3.0 m (spec §9.2).
  UNLOCK_WOODSHED_GOALS: [6, 1, 10, 1, 'goals', 'REQ-GOL-03', 'Street goals to unlock Woodshed'], // REQ-GOL-03, 1 to 10 (spec §9.2): 6 of 10.
  STREET_HIGH_SCORE: [15000, 15000, 15000, 1, 'points', 'REQ-STR-06', 'Street goal: High Score'], // REQ-STR-06, fixed (spec §9.2).
  STREET_PRO_SCORE: [40000, 40000, 40000, 1, 'points', 'REQ-STR-06', 'Street goal: Pro Score'], // REQ-STR-06, fixed (spec §9.2).
  STREET_SICK_SCORE: [80000, 80000, 80000, 1, 'points', 'REQ-STR-06', 'Street goal: Sick Score'], // REQ-STR-06, fixed (spec §9.2).
  STREET_HIGH_COMBO: [10000, 10000, 10000, 1, 'points', 'REQ-STR-06', 'Street goal: High Combo'], // REQ-STR-06, fixed (spec §9.2).
  STREET_FOUNTAIN_COMBO: [5000, 5000, 5000, 1, 'points', 'REQ-STR-06', 'Street goal: 5,000 over the fountain'], // REQ-STR-06, fixed (spec §9.2 goal 10; not in M).
  WOODSHED_HIGH_SCORE: [25000, 25000, 25000, 1, 'points', 'REQ-WSH-06', 'Woodshed goal: High Score'], // REQ-WSH-06, fixed (spec §9.2).
  WOODSHED_PRO_SCORE: [60000, 60000, 60000, 1, 'points', 'REQ-WSH-06', 'Woodshed goal: Pro Score'], // REQ-WSH-06, fixed (spec §9.2).
  WOODSHED_SICK_SCORE: [120000, 120000, 120000, 1, 'points', 'REQ-WSH-06', 'Woodshed goal: Sick Score'], // REQ-WSH-06, fixed (spec §9.2).
  WOODSHED_HIGH_COMBO: [15000, 15000, 15000, 1, 'points', 'REQ-WSH-06', 'Woodshed goal: High Combo'], // REQ-WSH-06, fixed (spec §9.2).
  WOODSHED_REVERT_MANUALS: [2, 2, 2, 1, 'count', 'REQ-WSH-06', 'Woodshed goal: revert-manuals in one combo'], // REQ-WSH-06, fixed (spec §9.2 goal 10; not in M).
});

const RENDER = section('render', 'render', {
  RENDER_EXPOSURE: [1.0, 0.5, 2.0, 0.01, 'ratio', 'REQ-REN-01', 'Tone mapping exposure'], // REQ-REN-01, 0.5 to 2.0 (mine).
  BLOOM_THRESHOLD: [0.9, 0.6, 1.0, 0.01, 'ratio', 'REQ-REN-04', 'Bloom luminance threshold'], // REQ-REN-04, 0.6 to 1.0 (spec §10): only emissive blooms.
  VIGNETTE: [0.25, 0, 0.5, 0.01, 'ratio', 'REQ-REN-04', 'Vignette darkness'], // REQ-REN-04, 0 to 0.5 (spec §10 "subtle").
  CHROMATIC_ABERRATION: [0.0008, 0, 0.006, 0.0001, 'ratio', 'REQ-REN-04', 'Chromatic aberration while glowing'], // REQ-REN-04, 0 to 0.006 (spec §10 "subtle"): glowing only. 0.002 -> 0.0008 in polish round 2 (DESIGN L): with the 0.5 clear radius 0.002 split about 3 px at 1080p frame corners.
  RAIL_EMISSIVE_RIM: [0.05, 0.02, 0.12, 0.005, 'ratio', 'REQ-MAT-02', 'Rail and coping emissive rim'], // REQ-MAT-02, 0.02 to 0.12 (spec §10): grind lines read at distance.
  SHADOW_BOX_M: [30, 20, 60, 1, 'm', 'REQ-REN-03', 'Shadow frustum box'], // REQ-REN-03, 20 to 60 m (mine): follows the skater, texel-snapped.
  SUN_ELEVATION_DEG: [18, 5, 45, 0.5, 'deg', 'REQ-REN-02', 'Street sun elevation'], // REQ-REN-02, 5 to 45 (not in M, DESIGN J.2): late afternoon.
  FPS_PROBE_S: [2, 1, 4, 0.1, 's', 'REQ-REN-05', 'Quality FPS probe length'], // REQ-REN-05, 1 to 4 s (spec §10).
  QUALITY_FPS_ULTRA: [55, 40, 60, 1, 'fps', 'REQ-REN-05', 'Probe: Ultra at or above'], // REQ-REN-05 (not in M, DESIGN J.2): >= 55 fps.
  QUALITY_FPS_HIGH: [45, 30, 55, 1, 'fps', 'REQ-REN-05', 'Probe: High at or above'], // REQ-REN-05 (not in M, DESIGN J.2): >= 45 fps.
  QUALITY_FPS_MED: [30, 20, 45, 1, 'fps', 'REQ-REN-05', 'Probe: Med at or above'], // REQ-REN-05 (not in M, DESIGN J.2): >= 30 fps, else Low.
  POSE_BLEND_MS: [80, 40, 160, 1, 'ms', 'REQ-SKT-03', 'Pose blend time'], // REQ-SKT-03, 40 to 160 ms (mine).
  TURNTABLE_DPS: [12, 6, 30, 0.5, 'deg/s', 'REQ-LAB-01', 'Board Lab turntable speed'], // REQ-LAB-01, 6 to 30 (mine).
  MAX_STICKERS: [6, 6, 6, 1, 'count', 'REQ-LAB-01', 'Max underside stickers'], // REQ-LAB-01, fixed 6 (spec §17).
  MENU_FLYTHROUGH_S: [40, 20, 90, 1, 's', 'REQ-MNU-01', 'Menu flythrough loop'], // REQ-MNU-01, 20 to 90 s (mine).
});

const AUDIO = section('audio', 'audio', {
  MUSIC_BPM_STREET: [94, 80, 160, 1, 'bpm', 'REQ-AUD-02', 'Street music tempo'], // REQ-AUD-02, 80 to 160 (mine; DESIGN L: 140 -> 94, the Street song is a swung boom-bap arrangement written for 92 to 96).
  MUSIC_BPM_WOODSHED: [170, 120, 170, 1, 'bpm', 'REQ-AUD-02', 'Woodshed music tempo'], // REQ-AUD-02, 120 to 170 (mine; DESIGN L: 150 -> 170, the Woodshed song is a punk breakbeat written for about 170).
});

const DEPLOY = section('deploy', 'deploy', {
  JS_GZIP_MAX_KB: [1500, 1500, 1500, 1, 'KB', 'REQ-DEP-04', 'Gzipped JS budget'], // REQ-DEP-04, fixed 1500 KB (spec §12): scripts/check-size.mjs, 1 KB = 1024 bytes.
});

// ---------------------------------------------------------------------------------------------
// Track sections: each track owns src/core/tuning/<track>.ts (entry format above) and edits only
// that file. Group shown in the dev panel = "track:<name>". Anything else in this file is frozen.
// ---------------------------------------------------------------------------------------------

const TRACK_INPUT = section('track:input', 'track:input', INPUT_TUNING);
const TRACK_LOGIC = section('track:logic', 'track:logic', LOGIC_TUNING);
const TRACK_LEVELS = section('track:levels', 'track:levels', LEVELS_TUNING);
const TRACK_STREET = section('track:street', 'track:street', STREET_TUNING);
const TRACK_WOODSHED = section('track:woodshed', 'track:woodshed', WOODSHED_TUNING);
const TRACK_SIM = section('track:sim', 'track:sim', SIM_TUNING);
const TRACK_RENDER = section('track:render', 'track:render', RENDER_TUNING);
const TRACK_SKATER = section('track:skater', 'track:skater', SKATER_TUNING);
const TRACK_FX = section('track:fx', 'track:fx', FX_TUNING);
const TRACK_UI = section('track:ui', 'track:ui', UI_TUNING);
const TRACK_AUDIO = section('track:audio', 'track:audio', AUDIO_TUNING);
const TRACK_INTEGRATION = section('track:integration', 'track:integration', INTEGRATION_TUNING);

// ---------------------------------------------------------------------------------------------
// Assembly (frozen). Every track section is already wired in below; tracks never edit this part.
// ---------------------------------------------------------------------------------------------

const SECTIONS = [
  SIM, WINDOWS, INPUT, LANDING, MOVEMENT, AIR, VERT, GRIND, LIP, MANUAL, SCORING, SPECIAL, BALANCE,
  STATS, CAMERA, FX, HUD, RUN, RENDER, AUDIO, DEPLOY,
  TRACK_INPUT, TRACK_LOGIC, TRACK_LEVELS, TRACK_STREET, TRACK_WOODSHED, TRACK_SIM, TRACK_RENDER,
  TRACK_SKATER, TRACK_FX, TRACK_UI, TRACK_AUDIO, TRACK_INTEGRATION,
] as const;

/** Section names and their key lists, for the dev panel and tests/tuning.test.ts. */
export const TUNING_SECTIONS: readonly { readonly name: string; readonly group: string; readonly keys: readonly string[] }[] =
  SECTIONS.map((s) => ({ name: s.name, group: s.group, keys: Object.keys(s.values) }));

/**
 * THE mutable tuning object. Every system reads through it each tick; the dev panel writes it.
 * Never destructure it at module load and never freeze it.
 */
export const TUNING = {
  ...SIM.values, ...WINDOWS.values, ...INPUT.values, ...LANDING.values, ...MOVEMENT.values,
  ...AIR.values, ...VERT.values, ...GRIND.values, ...LIP.values, ...MANUAL.values,
  ...SCORING.values, ...SPECIAL.values, ...BALANCE.values, ...STATS.values, ...CAMERA.values,
  ...FX.values, ...HUD.values, ...RUN.values, ...RENDER.values, ...AUDIO.values, ...DEPLOY.values,
  ...TRACK_INPUT.values, ...TRACK_LOGIC.values, ...TRACK_LEVELS.values, ...TRACK_STREET.values,
  ...TRACK_WOODSHED.values, ...TRACK_SIM.values, ...TRACK_RENDER.values, ...TRACK_SKATER.values,
  ...TRACK_FX.values, ...TRACK_UI.values, ...TRACK_AUDIO.values, ...TRACK_INTEGRATION.values,
  ...ENUMS,
};

export type Tuning = typeof TUNING;
export type TuningKey = keyof Tuning;
/** Keys whose value is a number: exactly the keys that have TUNING_META. */
export type NumericTuningKey = { [K in TuningKey]: Tuning[K] extends number ? K : never }[TuningKey];
export type EnumTuningKey = keyof typeof ENUMS;

/** Slider metadata for every numeric key (compile-time complete: a key without META fails typecheck). */
export const TUNING_META: { readonly [K in NumericTuningKey]: TuningMeta } = {
  ...SIM.meta, ...WINDOWS.meta, ...INPUT.meta, ...LANDING.meta, ...MOVEMENT.meta,
  ...AIR.meta, ...VERT.meta, ...GRIND.meta, ...LIP.meta, ...MANUAL.meta,
  ...SCORING.meta, ...SPECIAL.meta, ...BALANCE.meta, ...STATS.meta, ...CAMERA.meta,
  ...FX.meta, ...HUD.meta, ...RUN.meta, ...RENDER.meta, ...AUDIO.meta, ...DEPLOY.meta,
  ...TRACK_INPUT.meta, ...TRACK_LOGIC.meta, ...TRACK_LEVELS.meta, ...TRACK_STREET.meta,
  ...TRACK_WOODSHED.meta, ...TRACK_SIM.meta, ...TRACK_RENDER.meta, ...TRACK_SKATER.meta,
  ...TRACK_FX.meta, ...TRACK_UI.meta, ...TRACK_AUDIO.meta, ...TRACK_INTEGRATION.meta,
};

/** A copy of the shipped defaults (all values are primitives), taken before anything can mutate TUNING. */
export const TUNING_DEFAULTS: Readonly<Tuning> = Object.freeze({ ...TUNING });

/** Restore every key to its shipped default (dev panel "reset", test isolation). */
export function resetTuning(): void {
  Object.assign(TUNING, TUNING_DEFAULTS);
}

// ---------------------------------------------------------------------------------------------
// Helpers every track uses (frozen)
// ---------------------------------------------------------------------------------------------

/** Seconds per sim tick (1/120). */
export function tickSeconds(): number {
  return 1 / TUNING.SIM_HZ;
}

/**
 * REQ-TIM-03: window length in ticks, ticks(ms) = ceil(ms * SIM_HZ / 1000 - 1e-9).
 * Windows are half-open: an event n ticks after the anchor is inside iff n < ticks(ms).
 * ticks(90) = 11, ticks(150) = 18, ticks(200) = 24, ticks(250) = 30.
 */
export function ticks(ms: number): number {
  return Math.ceil((ms * TUNING.SIM_HZ) / 1000 - 1e-9);
}

/** ticks() for a length in seconds: ticksS(0.85) = 102, ticksS(0.6) = 72. */
export function ticksS(seconds: number): number {
  return ticks(seconds * 1000);
}

/** REQ-FX-03: hitstop is the one floor, floor(60 * 120 / 1000) = 7 ticks. */
export function hitstopTicks(ms: number = TUNING.HITSTOP_MACGUFFIN_MS): number {
  return Math.floor((ms * TUNING.SIM_HZ) / 1000 + 1e-9);
}

/** REQ-CTL-13: statFactor(s) = STAT_FACTOR_BASE + STAT_FACTOR_PER * s (6 -> 1.0). */
export function statFactor(stat: number): number {
  return TUNING.STAT_FACTOR_BASE + TUNING.STAT_FACTOR_PER * stat;
}

/** REQ-DEG-01 / 02: the active degradation table (by DEGRADATION_PRESET). */
export function degradationTable(): readonly number[] {
  return DEGRADATION_PRESETS[TUNING.DEGRADATION_PRESET];
}

/** REQ-CTL-06 / REQ-SPC-03: current max speed, statFactor(speed) and the +8% glow bonus applied. */
export function maxSpeed(glowing: boolean): number {
  return TUNING.MAX_SPEED_MPS * statFactor(TUNING.STAT_SPEED) * (glowing ? 1 + TUNING.GLOW_SPEED_BONUS : 1);
}
