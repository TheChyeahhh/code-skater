/**
 * src/sim/types.ts: contracts between the logic track (stateMachine, scoring, balance, special),
 * the sim track (controller, collision, rails, gaps, world, run, debug) and the app. Frozen after M0.
 *
 * Division of labour:
 * - logic modules are PURE: plain data in, plain data out, no geometry, no events, no three.js.
 *   They decide WHAT happens (which transition, what an element is worth, how the needle moves).
 * - the sim world ORCHESTRATES one tick: it asks the parser for actions, feeds the state machine
 *   events, executes the returned effects through the controller, calls scoring / balance / special,
 *   evaluates gaps, pickups and goals, and returns a SimSnapshot plus SimEvents.
 * - Physics never changes state on its own (REQ-SM-11): the controller reports physical events
 *   (contact, leftSurface, railEnd, stall, wallHit) and only transition() changes the state.
 * All sim code: no Math.random (use the Rng), no Date / performance / rAF, no DOM, no render imports.
 */

import type {
  BailReason, BaseTrickId, ElementId, GrindTypeId, InputFrame, LandQuality, LevelId, LipId, MacGuffinId,
  ManualId, RunMode, SimSnapshot, SkaterStateName, SpecialId, Stance, SurfaceFlags, TrickCategory, Vec3,
} from '../core/types';
import type { SimEvent } from '../core/events';
import type { ParsedAction, ParserMemory } from '../input/types';
import type { BuiltLevel } from '../levels/types';

// =============================================================================================
// State machine (logic track: src/sim/stateMachine.ts), DESIGN C.5
// =============================================================================================

/** Row ids of DESIGN C.5, numbered and lettered. */
export type DesignRowId =
  | '1' | '1b' | '1c' | '2' | '3' | '4' | '5' | '5b' | '6' | '7' | '8' | '9' | '9b' | '9c' | '9d' | '9e'
  | '9f' | '9g' | '9h' | '9i' | '9j' | '10' | '11' | '12' | '12b' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20'
  | '21' | '22' | '22b' | '22c' | '23' | '24' | '25' | '25b' | '26' | '27' | '28' | '29' | '30' | '31'
  | '32' | '33' | '33b' | '34' | '34b' | '35' | '36' | '37' | '37b' | '38' | '39' | '40' | '41' | '42';

/** Every DESIGN C.5 row id, in table order: stateMachine.test must cover each (REQ-SM-01). */
export const DESIGN_ROW_IDS: readonly DesignRowId[] = [
  '1', '1b', '1c', '2', '3', '4', '5', '5b', '6', '7', '8', '9', '9b', '9c', '9d', '9e', '9f', '9g', '9h', '9i', '9j',
  '10', '11', '12', '12b', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '22b', '22c', '23', '24',
  '25', '25b', '26', '27', '28', '29', '30', '31', '32', '33', '33b', '34', '34b', '35', '36', '37', '37b',
  '38', '39', '40', '41', '42',
];

/**
 * A TRANSITIONS row id: a DESIGN row, or an implementation row "x:<name>" for transitions the
 * table implies but does not number (for example Cross pressed on a linker starts a charge).
 * Several TRANSITIONS rows may share one DESIGN id (row 40 has a clock-zero and an overtime case).
 */
export type SmRowId = DesignRowId | `x:${string}`;

/**
 * Combo column of DESIGN C.5:
 * none = "-", start = "starts", startAdd = "starts, +1", live = "lives", liveAdd = "lives, +1",
 * bank = "banks" (FINAL to the run score, combo cleared), lose = "lost" (combo discarded AND the
 * special meter emptied, REQ-SCR-07; applies even when no combo is alive), bankStartAdd = row 9g.
 */
export type ComboEffect = 'none' | 'start' | 'startAdd' | 'live' | 'liveAdd' | 'bank' | 'lose' | 'bankStartAdd';

/** Facts about the landing on a contact tick (rows 7, 8, 9, 10, 12, 13). */
export interface LandingFacts {
  /** Contact surface slope >= VERT_LAND_MIN_SLOPE_DEG (reverts allowed). */
  readonly vert: boolean;
  readonly flat: boolean;
  readonly slopeDeg: number;
  /** Yaw off-axis per the DESIGN C.6 vocabulary (the 28 deg rule). */
  readonly offAxisDeg: number;
  readonly tiltDeg: number;
  /** All flip / grab / special animations finished (REQ-SM-03). */
  readonly animsDone: boolean;
  readonly crossHeld: boolean;
  /** From resolveLanding(): manual pair completed inside the pre-contact window (flat only). */
  readonly manualPair: ManualId | null;
  /** From resolveLanding(): R2 inside the pre-land buffer. */
  readonly revertBuffered: boolean;
}

/** Events the state machine consumes. The world builds them from parser actions and physics. */
export type SmEvent =
  /** Cross pressed: rows 1, 1b, 9e, 9i, 18, 25; crouch-on-linker charge start. */
  | { readonly kind: 'crossPress' }
  /** Cross released while charging: rows 2, 19, 27, 37b (charge from MachineState.chargeStartTick). */
  | { readonly kind: 'crossRelease' }
  /** P8b coyote press in Air: Air stays Air with a pop effect. */
  | { readonly kind: 'coyotePop' }
  /** Rows 1c, 9j: velocity turned upward on a transition with Cross still held (pumping -> Crouch). */
  | { readonly kind: 'velocityUp' }
  | { readonly kind: 'contact'; readonly landing: LandingFacts }
  /** Rows 9h, 33b, 37, 37b: the down probe lost the surface. */
  | { readonly kind: 'leftSurface' }
  /** Row 21 (corner = a bend sharper than GRIND_CORNER_MAX_DEG, REQ-GRD-10). */
  | { readonly kind: 'railEnd'; readonly corner: boolean }
  /** Row 22: grind speed < GRIND_MIN_SPEED. */
  | { readonly kind: 'stall' }
  /** REQ-CTL-20: headOn = speed >= WALL_BAIL_SPEED_MPS and incidence <= WALL_BAIL_ANGLE_DEG. */
  | { readonly kind: 'wallHit'; readonly headOn: boolean; readonly speed: number; readonly incidenceDeg: number }
  /** Rows 23, 26, 29: |needle| >= 1. */
  | { readonly kind: 'needleOut' }
  /** State timer expired (rows 9b, 16, 38, 39, 25b follow-up); produced by timerEvent(). */
  | { readonly kind: 'timeout' }
  /**
   * Rows 5, 5b, 6, 9g, 34b, 36. candidate: "rail" = grind, "lip" = lip (REQ-LIP-02).
   * ground = P5b hop from the ground or a manual. grindType / lipId already resolved by the world.
   */
  | { readonly kind: 'grindTry'; readonly candidate: 'rail' | 'lip'; readonly ground: boolean; readonly railId: string; readonly grindType: GrindTypeId; readonly lipId: LipId }
  /** Row 20 (a switch to the current type never reaches here: the parser filters it, REQ-DEG-05). */
  | { readonly kind: 'grindSwitch'; readonly grindType: GrindTypeId }
  /** Row 9c. */
  | { readonly kind: 'revertPress' }
  /** Row 4. */
  | { readonly kind: 'manualEntry'; readonly manual: ManualId }
  /** Row 9d. */
  | { readonly kind: 'manualLand'; readonly manual: ManualId }
  /** Row 15. */
  | { readonly kind: 'revertManual'; readonly manual: ManualId }
  /** Row 28. */
  | { readonly kind: 'manualSwap'; readonly manual: ManualId }
  /** Rows 24 (gpu_slide in Grind) and 34 (context_window in Manual). Air specials are not transitions. */
  | { readonly kind: 'special'; readonly specialId: SpecialId }
  /**
   * Row 11. railId = the transfer rail used (the same id the world feeds the gap tracker as
   * { kind: "transfer", railId } and puts on the "transfer" SimEvent). The row returns combo "live"
   * with NO element and effects [spineMirror]: the +1 is the level's transferOn gap (for example
   * WS-G01 on the spine, WS-G06 on WS-VW1-C), produced only by src/sim/gaps.ts (DESIGN §L CR-24).
   */
  | { readonly kind: 'spineTransfer'; readonly railId: string }
  /** Rows 25, 25b. */
  | { readonly kind: 'triangleRelease' }
  /** Row 30: Manual speed < MANUAL_MIN_SPEED. */
  | { readonly kind: 'slowStop' }
  /** Row 31: Manual climbing (v.y > 0) onto slope >= FLAT_MAX_SLOPE_DEG. */
  | { readonly kind: 'climbSteep' }
  /**
   * Rows 40, 41. Emitted by the world on the tick the run clock reaches 0:00 AND on every later tick
   * until the state is RunEnd (idempotent; facts.clockZero is true on all of them), so the run can end
   * whatever state the skater was in at 0:00 (DESIGN §L CR-25):
   * - alive states: row 40, "same", combo lives, effects [clockFreeze] (idempotent, fires every tick);
   * - Grounded with no combo alive: row 41 -> RunEnd, effects [runEnd];
   * - Crouch (never has a live combo): row "x:crouch-clock-zero" -> RunEnd, effects [runEnd];
   * - Bail and GetUp: no row, ignored; the re-emission reaches Grounded after row 39 and ends the run.
   * A combo alive at 0:00 therefore ends the run one tick after it banks (Grounded) or after the bail
   * and get-up play out (lost).
   */
  | { readonly kind: 'clockZero' }
  /** Row 40: RUN_OVERTIME_MAX_S passed at 0:00 with a combo alive: forced bail (emitted once). */
  | { readonly kind: 'overtime' }
  /** Row 42 (documentation row: pausing stops ticks; transition() returns the state unchanged). */
  | { readonly kind: 'pause' };

export type SmEventKind = SmEvent['kind'];

/** Per-tick facts the guards read (computed by the world before transitions). */
export interface SmFacts {
  readonly tick: number;
  readonly speed: number;
  /** Current ground contact classification, null in the air. */
  readonly surface: SurfaceFlags | null;
  /** Along-surface velocity has an upward component (v.y > 0 while on the ground). */
  readonly movingUp: boolean;
  /**
   * On the ground and descending faster than SIM_PUMP_MIN_DESCENT_MPS (v.y < -that): the shallow foot
   * of a transition pumps too (rows 1b, 9i), a level bowl floor never does. Optional: absent = false.
   */
  readonly movingDown?: boolean;
  /** All air trick animations finished (REQ-SM-03). */
  readonly animsDone: boolean;
  readonly crossHeld: boolean;
  readonly triangleHeld: boolean;
  /** Scoring has a live combo. */
  readonly comboAlive: boolean;
  /** Run clock is at 0:00 (REQ-SM-09). */
  readonly clockZero: boolean;
}

/** The state machine's own state. Plain data. */
export interface MachineState {
  readonly state: SkaterStateName;
  readonly enteredTick: number;
  /** Grounded sub-mode: pumping a transition (row 1b). */
  readonly pumping: boolean;
  /** LandWindow / RevertWindow: the kind of landing that opened it. */
  readonly landKind: 'flat' | 'vert' | null;
  /** A revert already fired for the current landing. */
  readonly revertUsed: boolean;
  /** Tick the Cross charge started (Crouch or crouch-on-linker), else null. */
  readonly chargeStartTick: number | null;
  /** Current manual type (Manual), else null. */
  readonly manual: ManualId | null;
  /** Lip: Triangle was released before LIP_MIN_HOLD_MS; exit when the hold completes (row 25b). */
  readonly lipExitPending: boolean;
  /** Bail reason while in Bail / GetUp. */
  readonly bailReason: BailReason | null;
}

/**
 * Combo line element the world should add, as a base id; the world derives the variant (switch / nollie).
 * TRANSITIONS rows return only "trick" refs. "gap" refs are built by the world from the gap tracker's
 * EarnedGap (src/sim/gaps.ts), never by a row: the logic track cannot know a level's gap ids.
 */
export type ElementRef =
  | { readonly kind: 'trick'; readonly trickId: BaseTrickId }
  | { readonly kind: 'gap'; readonly gapId: string };

/** Side effects the world executes after a transition, in order. */
export type SmEffect =
  /** Start the Cross charge now (Crouch entry, row 1c, crouch-on-linker). */
  | { readonly kind: 'startCharge' }
  /** Ollie with charge in [0, 1] (0 = tap / coyote), REQ-CTL-05 / CTL-14. */
  | { readonly kind: 'pop'; readonly charge: number }
  | { readonly kind: 'pump'; readonly on: boolean }
  /** Rows 5, 20, 24: snap / re-type on the rail (80 ms blend on entry). */
  | { readonly kind: 'grindSnap' }
  /** P5b: hop of max(GRIND_GROUND_SNAP_HOP_MIN_M, dy + GRIND_GROUND_SNAP_CLEAR_M) then snap. */
  | { readonly kind: 'groundSnapHop' }
  | { readonly kind: 'lipSnap' }
  /** Revert: toggle stance, yaw 180, speed x REVERT_SPEED_RETAIN, recompute fakie (REQ-SM-04). */
  | { readonly kind: 'revertPivot' }
  /** Spine transfer mirror (REQ-VRT-08). */
  | { readonly kind: 'spineMirror' }
  /** Lip exit (REQ-LIP-03). */
  | { readonly kind: 'lipExit' }
  /** Grind stall-out hop GRIND_EXIT_POP_M (row 22). */
  | { readonly kind: 'stallHop' }
  /** Glancing wall: remove the normal component, keep WALL_SLIDE_RETAIN (rows 33, and the controller default). */
  | { readonly kind: 'wallSlide' }
  /** Row 22c: clamp velocity along the rail x WALL_SLIDE_RETAIN. */
  | { readonly kind: 'railClamp' }
  /** A new grind / lip / manual element: re-centre the needle (REQ-BAL-02) on this axis. */
  | { readonly kind: 'balanceStart'; readonly axis: 'h' | 'v' }
  | { readonly kind: 'balanceStop' }
  | { readonly kind: 'bailStart'; readonly reason: BailReason }
  /** GetUp end: Grounded at 0 m/s facing the pre-bail heading (DESIGN E.11). */
  | { readonly kind: 'standUp' }
  /** Row 40: the clock stays at 0:00 from now on. */
  | { readonly kind: 'clockFreeze' }
  /** Rows 40 / 41: the run ends after this tick. */
  | { readonly kind: 'runEnd' };

/** A row of the table-driven state machine (REQ-SM-01). */
export interface TransitionRow {
  readonly id: SmRowId;
  /** States the row applies to; "alive" = COMBO_ALIVE_STATES; "any" = every state. */
  readonly from: readonly SkaterStateName[] | 'alive' | 'any';
  readonly event: SmEventKind;
  /** Pure predicate; omitted = always. Rows are tried in table order; the first match wins. */
  readonly guard?: (m: MachineState, e: SmEvent, f: SmFacts) => boolean;
  /** Target state, or "same". */
  readonly to: SkaterStateName | 'same';
  readonly combo: ComboEffect;
  /** The element to add for startAdd / liveAdd / bankStartAdd rows. */
  readonly element?: (m: MachineState, e: SmEvent, f: SmFacts) => ElementRef | null;
  /** Effects to run after the transition. */
  readonly effects?: (m: MachineState, e: SmEvent, f: SmFacts) => readonly SmEffect[];
  /** Short note mirroring DESIGN C.5. */
  readonly note: string;
}

export interface TransitionResult {
  /** The matched row, or null when no row matched (the event is ignored). */
  readonly row: SmRowId | null;
  readonly prev: MachineState;
  readonly next: MachineState;
  readonly combo: ComboEffect;
  readonly element: ElementRef | null;
  readonly effects: readonly SmEffect[];
}

// =============================================================================================
// Scoring (logic track: src/sim/scoring.ts), DESIGN D
// =============================================================================================

/** What to add to the combo line (the world builds it from an ElementRef plus stance and L2). */
export interface ElementSpec {
  readonly ref: ElementRef;
  readonly stance: Stance;
  /** Flip / grab with L2 while rolling forward (REQ-SCR-10). */
  readonly nollie?: boolean;
  /** Flip / grab with L2 while rolling fakie. */
  readonly fakie?: boolean;
  /** Grind elements: the rail id (same-object rule, grind gaps). */
  readonly railId?: string;
  /** Gap elements: splash name and base from the level's GapDef. */
  readonly gap?: { readonly name: string; readonly base: number };
  /** Holdable element (grab, grind, manual, lip, holdable special) opens and accrues until closed. */
  readonly holdable: boolean;
}

export interface ComboElement {
  readonly id: ElementId;
  /** Base trick id, or null for a gap. */
  readonly baseId: BaseTrickId | null;
  readonly category: TrickCategory;
  readonly name: string;
  readonly base: number;
  /** STANCE_SWITCH_MULT when added in switch stance, else 1 (1 for gaps and MacGuffins). */
  readonly stanceMult: number;
  /** NOLLIE_FAKIE_MULT for nollie / fakie variants, else 1. */
  readonly variantMult: number;
  /** From the run's degradation history (1 for gaps and MacGuffins, REQ-SCR-05 / 06). */
  readonly degradation: number;
  /** trickValue = base x stanceMult x variantMult x degradation (not rounded; FINAL floors). */
  readonly value: number;
  readonly holdRate: number;
  readonly heldS: number;
  /** holdRate x heldS, rounded to whole points when the element closes (REQ-SCR-04). */
  readonly accrual: number;
  readonly open: boolean;
  readonly railId: string | null;
  readonly addedTick: number;
}

export interface ComboState {
  readonly elements: readonly ComboElement[];
  readonly spin180s: number;
  readonly startTick: number;
}

export interface BankResult {
  /** floor(COMBO_BASE x MULTIPLIER + 1e-6): the epsilon absorbs binary float error (REQ-SCR-01). */
  readonly final: number;
  readonly base: number;
  readonly multiplier: number;
  readonly elementCount: number;
  readonly spin180s: number;
  readonly quality: LandQuality;
  readonly elements: readonly ComboElement[];
}

export interface LoseResult {
  readonly base: number;
  readonly multiplier: number;
  readonly elementCount: number;
  readonly elements: readonly ComboElement[];
}

// =============================================================================================
// Balance (logic track: src/sim/balance.ts), REQ-BAL-01..06
// =============================================================================================

export type BalanceAxis = 'h' | 'v';

export interface BalanceState {
  /** In [-1, 1]; |needle| >= 1 = bail. Negative = left (h) or nose down (v). */
  readonly needle: number;
  readonly velocity: number;
  readonly axis: BalanceAxis;
  /** Drift constant k for this linker (REQ-BAL-01), Context Window factor excluded. */
  readonly k: number;
  readonly active: boolean;
}

export interface DriftParams {
  /** +1 elements already in the combo when the linker starts, excluding the linker itself (REQ-BAL-05). */
  readonly elementsBefore: number;
  /** The previous grind element in this combo was on the same rail id (REQ-BAL-04). */
  readonly sameObject: boolean;
  /** Stance flag is switch (REQ-CTL-13 switch drift). */
  readonly switchStance: boolean;
}

// =============================================================================================
// Special meter (logic track: src/sim/special.ts), REQ-SPC-01..06
// =============================================================================================

export interface SpecialState {
  /** In [0, 1]. */
  readonly meter: number;
  readonly glowing: boolean;
  /** Seconds since the last completed element (drain starts after SPECIAL_IDLE_DELAY_S). */
  readonly idleS: number;
}

export interface SpecialStep {
  readonly state: SpecialState;
  readonly becameGlowing: boolean;
  readonly stoppedGlowing: boolean;
}

// =============================================================================================
// World facade (sim track: src/sim/world.ts). The only sim API the app uses.
// =============================================================================================

export interface WorldConfig {
  readonly level: BuiltLevel;
  readonly mode: RunMode;
  /** Seeds the sim Rng (needle start sign, anything random). Same seed + same frames = same run. */
  readonly seed: number;
  /** MacGuffins already in the career: they do not respawn (REQ-SCR-06). */
  readonly collectedMacGuffins: readonly MacGuffinId[];
  /** Goal ids already completed in the career (for "next goal"; completion events still fire per run). */
  readonly completedGoals: readonly string[];
  /** Run length override for tests; default TUNING.RUN_LENGTH_S. */
  readonly runLengthS?: number;
}

export interface WorldStepResult {
  readonly snapshot: SimSnapshot;
  /** Events of this tick, in the order they happened. */
  readonly events: readonly SimEvent[];
}

export interface SkaterWorld {
  readonly levelId: LevelId;
  /** Ticks simulated so far; the next frame must carry this tick index. */
  readonly tick: number;
  /** Latest snapshot (the spawn snapshot before the first step). */
  readonly snapshot: SimSnapshot;
  /** Advance exactly one fixed tick. */
  step(frame: InputFrame): WorldStepResult;
  /** Debug / e2e: place the skater (REQ-DEP-07 teleport). */
  teleport(pos: Vec3, dir: Vec3, speed: number): void;
  /** FINAL of the most recently banked combo (0 if none). */
  readonly lastBanked: number;
  /**
   * Read-only view of the last tick's parse, for the F2 input dev overlay (SPEC M1 "raw / parsed
   * input"): the parsed actions and the parser memory after that tick. Optional so test worlds may omit it.
   */
  readonly lastParse?: { readonly tick: number; readonly actions: readonly ParsedAction[]; readonly memory: ParserMemory } | null;
}
