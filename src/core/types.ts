/**
 * src/core/types.ts: types shared by more than one build track (frozen after M0; integration
 * track only). Track-private contract types live in src/<track>/types.ts.
 *
 * MATH CONVENTION (decided at M0, every track follows it):
 * - Every module boundary uses the plain records below (Vec3, Quat, ...): snapshots, events,
 *   level data, input frames. They are JSON-serialisable (the e2e debug hook returns them),
 *   cheap to copy, and carry no hidden mutable state.
 * - Inside an implementation, three.js MATH classes are allowed anywhere, including src/sim/**
 *   and src/levels/** (Vector3, Quaternion, Matrix4, Ray, Box3, Plane, Triangle, MathUtils,
 *   BufferGeometry and attributes for three-mesh-bvh). Rendering classes (WebGLRenderer, Scene,
 *   Mesh, Material, Texture, Light, Camera, Object3D, Group) are banned in src/sim/** and
 *   src/levels/** (eslint enforces it).
 * - A three.Vector3 structurally satisfies Vec3, so it can be PASSED where a Vec3 is read. It must
 *   never be STORED into a snapshot or event: copy it ({ x: v.x, y: v.y, z: v.z }).
 *
 * WORLD AXES: x east, y up, z south; level origin = north-west corner at ground level (DESIGN §0).
 * Units: metres, seconds, m/s. Angles in data are degrees; sim internals may use radians.
 *
 * HEADING: a yaw angle in radians about +y using three's right-hand rule. yaw 0 faces north (-z),
 * yaw +PI/2 faces west (-x), yaw PI faces south (+z), yaw -PI/2 faces east (+x).
 * forward(yaw) = (-sin yaw, 0, -cos yaw). Helpers: src/core/math.ts yawToForward / forwardToYaw.
 *
 * SKATER LOCAL FRAME: -z = nose / forward, +y = up, +x = right. Quat fields in snapshots rotate
 * this local frame into world space, so a model built nose-toward -z can take the quaternion as is
 * (object.quaternion.set(q.x, q.y, q.z, q.w)).
 */

// ---------------------------------------------------------------------------------------------
// Math records
// ---------------------------------------------------------------------------------------------

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Axis-aligned box. */
export interface Box3Like {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Axis-aligned rectangle on the ground plane (x0 < x1, z0 < z1). */
export interface RectXZ {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** Compass direction in world space: north = -z, south = +z, east = +x, west = -x. */
export type Facing = 'north' | 'south' | 'east' | 'west';

// ---------------------------------------------------------------------------------------------
// Directions and buttons (SPEC §5, DESIGN C.2)
// ---------------------------------------------------------------------------------------------

/** 8-way direction as the player sees it: U = stick up / D-pad up / W. */
export type Dir8 = 'U' | 'UR' | 'R' | 'DR' | 'D' | 'DL' | 'L' | 'UL';
/** Dir8 or neutral ("N"). */
export type DirOrNeutral = Dir8 | 'N';

/** Clockwise from U. Index * 45 deg = the sector centre angle measured clockwise from up. */
export const DIR8: readonly Dir8[] = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];

/**
 * Logical buttons (SPEC §5). Directions are not buttons: they come from InputFrame.dir.
 * ollie = Cross/A/Space, flip = Square/X/J, grab = Circle/B/K, grind = Triangle/Y/L,
 * revert = R2/RT/Shift, nollie = L2/LT/Z (or Ctrl), spinL/spinR = L1,R1/LB,RB/Q,E,
 * pause = Options/Menu/Esc, dev = Share,View/View/~ (dev tuning panel).
 */
export type Button = 'ollie' | 'flip' | 'grab' | 'grind' | 'revert' | 'nollie' | 'spinL' | 'spinR' | 'pause' | 'dev';

export const BUTTONS: readonly Button[] = ['ollie', 'flip', 'grab', 'grind', 'revert', 'nollie', 'spinL', 'spinR', 'pause', 'dev'];

export type ButtonState = Readonly<Record<Button, boolean>>;

export type InputSource = 'gamepad' | 'keyboard' | 'script' | 'none';

/** REQ-INP-06: which glyphs the HUD and menus draw. */
export type GlyphSet = 'xbox' | 'playstation' | 'keyboard';

// ---------------------------------------------------------------------------------------------
// Input frame: what the sim consumes each tick (REQ-TIM-02, REQ-INP-02, REQ-INP-03)
// ---------------------------------------------------------------------------------------------

/**
 * One entry of the DirEnter ring (REQ-INP-03, REQ-INP-17). Created when Dir8 changes to a
 * non-neutral value and is then held for DIR_MIN_DWELL_TICKS. Stamped in sim ticks.
 */
export interface DirEntry {
  /** Unique, increasing. Equal to tEnter (at most one entry can begin per tick). */
  readonly id: number;
  readonly dir: Dir8;
  /** Tick the direction began (not the tick the dwell completed). */
  readonly tEnter: number;
  /** Tick the direction was left; equals the current tick while still held (open). */
  readonly tExit: number;
  /** True while this direction is still the current Dir8. */
  readonly open: boolean;
}

/** A button press with the direction held at that moment (REQ-INP-07: keyboard J/K + WASD). */
export interface PressEntry {
  readonly button: Button;
  readonly tick: number;
  readonly dir: DirOrNeutral;
  /** Nollie modifier (L2 / LT / Z, or Ctrl) held at the press. */
  readonly nollieHeld: boolean;
}

/**
 * Per sim tick input, built by the input track's FrameBuilder from raw device state or a
 * script. The sim is a pure function of the sequence of InputFrames (plus its seed), so tests
 * replay by feeding frames.
 */
export interface InputFrame {
  /** Sim tick this frame is for. */
  readonly tick: number;
  readonly source: InputSource;
  /** Held state at this tick. */
  readonly held: ButtonState;
  /** Press edges delivered this tick, in arrival order; a button may appear twice (REQ-TIM-02). */
  readonly pressed: readonly Button[];
  /** Release edges delivered this tick, in arrival order. */
  readonly released: readonly Button[];
  /** Raw left stick, x right +, y UP + (the device layer flips the Gamepad API's y). */
  readonly stick: Vec2;
  /** Raw right stick (camera), same axes. */
  readonly look: Vec2;
  /** Mouse movement under pointer lock since the previous tick, in px (x right, y down). */
  readonly lookDelta: Vec2;
  /** D-pad (or arrow / WASD keys) as a direction. */
  readonly dpad: DirOrNeutral;
  /** Left stick as a direction: deadzone STICK_DEADZONE, 45 deg sectors centred on the cardinals. */
  readonly stickDir: DirOrNeutral;
  /** Combined direction: D-pad wins when non-neutral (REQ-INP-02). */
  readonly dir: DirOrNeutral;
  /**
   * Analog axis for steer, spin and balance, x right +, y up +, each in [-1, 1]:
   * D-pad non-neutral -> its unit vector components (full deflection), else the stick rescaled
   * so the deadzone edge maps to 0 and the rim to 1 (REQ-VRT-03 "proportional past the deadzone").
   */
  readonly dirAxis: Vec2;
  /** DirEnter ring, oldest first, newest last (H[-1]); at most DIR_RING_SIZE entries. */
  readonly dirHistory: readonly DirEntry[];
  /** Recent presses, oldest first, newest last; at most PRESS_HISTORY_SIZE entries. */
  readonly pressHistory: readonly PressEntry[];
}

/** A partial input state for scripts and the debug hook. Omitted fields keep their previous value. */
export interface ScriptInput {
  readonly held?: Partial<Record<Button, boolean>>;
  readonly stick?: Vec2;
  readonly look?: Vec2;
  readonly lookDelta?: Vec2;
  readonly dpad?: DirOrNeutral;
}

/** A keyframe of a scripted input timeline; atTick is relative to the tick the timeline starts. */
export interface ScriptKey {
  readonly atTick: number;
  readonly input: ScriptInput;
}

/** Keyframes sorted by atTick; state persists between keys; press/release edges come from held changes. */
export type InputTimeline = readonly ScriptKey[];

/**
 * Menu navigation for one render frame (REQ-MNU-02). Direction flags are edges with auto-repeat
 * applied by the input track. Keyboard: arrows move, Enter confirms, Esc backs.
 */
export interface NavInput {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  /** Cross / A / Enter / Space. */
  readonly confirm: boolean;
  /** Circle / B / Esc / Backspace. */
  readonly back: boolean;
  /** L1 / LB / Q: previous tab. */
  readonly tabPrev: boolean;
  /** R1 / RB / E: next tab. */
  readonly tabNext: boolean;
  /** Square / X / J: secondary action (Board Lab remove sticker). */
  readonly action1: boolean;
  /** Triangle / Y / L: tertiary action (Board Lab random). */
  readonly action2: boolean;
  /** Options / Menu / Esc. */
  readonly pause: boolean;
  /** Share / View / ~. */
  readonly dev: boolean;
  /** Right stick x in [-1, 1], for turntables. */
  readonly lookX: number;
  /** Left stick / D-pad analog, for the sticker cursor (REQ-LAB-03). */
  readonly cursor: Vec2;
  /** The device that produced any of these edges this frame. */
  readonly source: InputSource;
}

// ---------------------------------------------------------------------------------------------
// Ids (SPEC §9.1, DESIGN D.2). Display names live in src/data/tricks.ts and src/data/brands.ts.
// ---------------------------------------------------------------------------------------------

export type FlipId =
  | 'kickflip' | 'heelflip' | 'pop_shove_it' | 'varial_kickflip' | 'varial_heelflip'
  | 'impossible' | 'hardflip' | 'tre_flip';
export type EnhancedFlipId =
  | 'double_kickflip' | 'double_heelflip' | 'shove_it_360' | 'double_varial_kickflip'
  | 'double_varial_heelflip' | 'double_impossible' | 'double_hardflip' | 'double_tre_flip';
export type GrabId = 'nosegrab' | 'tailgrab' | 'indy' | 'melon' | 'japan' | 'stalefish' | 'benihana' | 'crossbone';
export type TweakedGrabId =
  | 'tweaked_nosegrab' | 'tweaked_tailgrab' | 'tweaked_indy' | 'tweaked_melon'
  | 'tweaked_japan' | 'tweaked_stalefish' | 'tweaked_benihana' | 'tweaked_crossbone';
/**
 * Grind types. "gpu_slide" is the special grind DESIGN D.2 names after the chip brand's platform: renamed so no real mark
 * appears outside src/data/brands.ts (AGENTS.md; DESIGN §L CR-20). Its display name comes from
 * BRANDS.specialSlideName (VIDA Slide in parody mode).
 */
export type GrindTypeId =
  | 'fifty_fifty' | 'nosegrind' | 'five_o' | 'boardslide' | 'lipslide'
  | 'crooked' | 'overcrook' | 'feeble' | 'smith' | 'gpu_slide';
export type LipId = 'axle_stall' | 'rock_to_fakie';
export type ManualId = 'manual' | 'nose_manual';
export type SpecialId = 'kernel_panic' | 'token_overflow' | 'inference_900ms' | 'gpu_slide' | 'context_window';
export type MacGuffinId = 'secret_laptop' | 'secret_drive';

/** Flips and grabs, plain and enhanced: the tricks that take nollie / fakie variants. */
export type AirTrickId = FlipId | EnhancedFlipId | GrabId | TweakedGrabId;

/** Every authored trick id in src/data/tricks.ts. */
export type BaseTrickId = AirTrickId | GrindTypeId | LipId | ManualId | 'revert' | SpecialId | MacGuffinId;

type NollieFakieId = `${'nollie' | 'fakie'}_${AirTrickId}`;

/**
 * Degradation key (REQ-DEG-03): derived, never authored. Prefix order: switch_ then nollie_/fakie_.
 * Examples: kickflip, switch_kickflip, nollie_kickflip, fakie_kickflip, switch_nollie_kickflip,
 * switch_manual. MacGuffins have no variants.
 */
export type TrickVariantId = BaseTrickId | NollieFakieId | `switch_${Exclude<BaseTrickId, MacGuffinId> | NollieFakieId}`;

/** Combo element id for a named gap: "gap:<level gap id>", e.g. "gap:MS-G03". */
export type GapElementId = `gap:${string}`;
export type ElementId = TrickVariantId | GapElementId;

/** SPEC §9.1 categories. */
export type TrickCategory = 'flip' | 'grab' | 'grind' | 'manual' | 'lip' | 'revert' | 'special' | 'gap' | 'macguffin';

export type LetterId = 'C' | 'O' | 'D' | 'E';
export const LETTERS: readonly LetterId[] = ['C', 'O', 'D', 'E'];

export type ParkId = 'marketStreet' | 'woodshed' | 'labCampus';
export type LevelId = ParkId | 'testBox';
export type RunMode = 'career' | 'free';
export type NpcId = 'sam' | 'dario';

// ---------------------------------------------------------------------------------------------
// Skater state (SPEC §8, DESIGN C.5; LandWindow is CR-18)
// ---------------------------------------------------------------------------------------------

export type SkaterStateName =
  | 'Grounded' | 'Crouch' | 'Air' | 'Grind' | 'Lip' | 'Manual'
  | 'RevertWindow' | 'LandWindow' | 'Bail' | 'GetUp' | 'RunEnd';

/** REQ-SM-02: the combo is alive only in these states. */
export const COMBO_ALIVE_STATES: readonly SkaterStateName[] = ['Air', 'Grind', 'Lip', 'Manual', 'RevertWindow', 'LandWindow'];

/** Stance flag, toggled only by revert (CR-04). Score x STANCE_SWITCH_MULT while switch. */
export type Stance = 'regular' | 'switch';

/** Surface tag stored per collider triangle (DESIGN G format). */
export type SurfaceTag = 'solid' | 'transition' | 'boundary';

/**
 * Surface classification of one contact (DESIGN C.6 vocabulary). Flags, not a single class,
 * because a transition's flat bottom is both "transition" and "flat".
 */
export interface SurfaceFlags {
  readonly slopeDeg: number;
  readonly tag: SurfaceTag;
  /** slope < FLAT_MAX_SLOPE_DEG: manuals allowed. */
  readonly flat: boolean;
  /** FLAT_MAX_SLOPE_DEG <= slope and not transition and not wall. */
  readonly bank: boolean;
  /** Tagged transition: reduced along-surface gravity (REQ-CTL-11). */
  readonly transition: boolean;
  /** Transition with slope >= VERT_ASSIST_MIN_SLOPE_DEG: leaving it triggers vert assist. */
  readonly nearVertical: boolean;
  /** slope >= VERT_LAND_MIN_SLOPE_DEG: a landing here is "on vert" (reverts allowed). */
  readonly vertLanding: boolean;
  /** Boundary, or slope >= WALL_MIN_SLOPE_DEG and not transition. */
  readonly wall: boolean;
}

/** REQ-CTL-10 / REQ-VRT-09 land text. clean shows nothing; sick / insane replace the angle text. */
export type LandQuality = 'clean' | 'ok' | 'sick' | 'insane';

/** Why a bail happened (events, HUD, audio). */
export type BailReason = 'landing' | 'tilt' | 'midTrick' | 'wall' | 'balance' | 'overtime';

/**
 * Logical pose (REQ-SKT-03). The sim picks pose, poseVariant and posePhase every tick by this table;
 * the skater track maps them to joint rotations (src/render/skater/poses.ts getPose). The table is
 * the contract: the sim never invents another convention and the skater never re-derives state.
 * "n" = ticks since the thing began, windows via ticks() / ticksS(); every phase is clamped to [0, 1].
 * needle01 = (needle + 1) / 2 of snapshot.balance (0 = full left or nose down, 0.5 centred, 1 = full
 * right or tail down).
 *
 * | State (and condition)                     | pose       | poseVariant               | posePhase                                  |
 * |-------------------------------------------|------------|---------------------------|--------------------------------------------|
 * | Bail                                      | bail       | null                      | bail.t (tumble progress)                   |
 * | GetUp                                     | getup      | null                      | bail.t (get-up progress)                   |
 * | Grind (gpu_slide included)                | grind      | GrindTypeId               | needle01                                   |
 * | Lip                                       | lip        | LipId                     | needle01                                   |
 * | Manual, MachineState.manual = manual      | manual     | ManualId, or context_window while held | needle01                      |
 * | Manual, MachineState.manual = nose_manual | noseManual | as above                  | needle01                                   |
 * | RevertWindow                              | revert     | null                      | n / ticks(REVERT_TO_MANUAL_MS): the 180 pivot plays over the window (REQ-SKT-05) |
 * | Crouch                                    | crouch     | null                      | crouchCharge                               |
 * | Air, an air animation running (below)     | flip / grab / special / transfer | see below | see below                      |
 * | Air, none running, n since pop < ticks(POP_POSE_MS) | pop | null                 | n / ticks(POP_POSE_MS)                     |
 * | Air, otherwise                            | air        | null                      | 0                                          |
 * | Grounded / LandWindow, braking            | brake      | null                      | 0; in the low-speed 180 pivot n / ticksS(BRAKE_PIVOT_S) |
 * | Grounded, pumping (row 1b)                | pump       | null                      | 0                                          |
 * | Grounded / LandWindow, auto-push running  | push       | null                      | (n since this push stroke) / ticksS(PUSH_CYCLE_S), loops |
 * | Grounded / LandWindow otherwise, RunEnd   | roll       | null                      | (n in state mod ticksS(PUSH_CYCLE_S)) / ticksS(PUSH_CYCLE_S), loops (idle sway) |
 *
 * Air animations: the most recently STARTED one that is still running owns the pose; when it ends the
 * pose falls back to an earlier one still running, then to pop / air. So kickflip then Indy in one air
 * shows pose grab while skater.flipId stays kickflip and the board keeps spinning by flipPhase.
 * - flip: variant = skater.flipId (enhanced ids included); phase = skater.flipPhase.
 * - grab: variant = the BASE GrabId (a tweaked grab uses the same pose; skater.grabId carries the
 *   tweak so the rig may exaggerate it); phase = 0.5 x min(1, n / ticks(GRAB_MIN_POSE_MS)) while held
 *   (reach in, then hold at 0.5), then 0.5 + 0.5 x (n since release) / ticks(GRAB_RELEASE_BEFORE_LAND_MS);
 *   the grab animation has ended when the phase reaches 1.
 * - special (Air specials only; gpu_slide and context_window are the grind / manual variants above):
 *   variant = SpecialId; kernel_panic and token_overflow phase = n / ticks(their anim ms in
 *   src/data/tricks.ts); inference_900ms phase = min(1, presentation ms held / INFERENCE_MIN_HOLD_MS).
 * - transfer (spine transfer, row 11): variant null; phase = n / ticksS(SPINE_TRANSFER_ANIM_S).
 * A Cross charge on a linker keeps the linker's pose; the rig lowers the hips by skater.crouchCharge.
 */
export type PoseId =
  | 'roll' | 'push' | 'brake' | 'pump' | 'crouch' | 'pop' | 'air' | 'flip' | 'grab' | 'special'
  | 'grind' | 'manual' | 'noseManual' | 'lip' | 'revert' | 'transfer' | 'bail' | 'getup';

/**
 * Speed band for FOV kick, speed lines and audio (REQ-CAM-04), from skater.speedRatio:
 * fast when >= TUNING.CAM_FOV_KICK_SPEED, cruise when >= TUNING.SPEED_TIER_CRUISE_RATIO, else slow;
 * the sim enters a higher tier only TUNING.SIM_SPEED_TIER_HYST above its threshold (hysteresis).
 * The sim emits a "speedTier" event on every change.
 */
export type SpeedTier = 'slow' | 'cruise' | 'fast';

export type RailKind = 'rail' | 'ledge' | 'coping';

// ---------------------------------------------------------------------------------------------
// SimSnapshot: everything render, UI, audio and FX read. Produced once per tick by the sim
// world; immutable once returned; plain data (JSON-safe).
// ---------------------------------------------------------------------------------------------

export interface GrindSnapshot {
  readonly type: GrindTypeId;
  readonly railId: string;
  readonly railKind: RailKind;
  /** Board contact point on the rail (sparks spawn here). */
  readonly contact: Vec3;
  /** Unit rail tangent in the direction of travel. */
  readonly tangent: Vec3;
  /** Arc length travelled on this rail id in the current grind chain, metres. */
  readonly distanceM: number;
}

export interface SurfaceSnapshot {
  readonly surfaceId: string;
  readonly normal: Vec3;
  readonly flags: SurfaceFlags;
}

export interface SkaterSnapshot {
  /** Feet position (bottom of the capsule, on the board). */
  readonly pos: Vec3;
  /** Body orientation: skater local frame (-z nose, +y up) to world. */
  readonly rot: Quat;
  readonly vel: Vec3;
  readonly speed: number;
  /** speed / current max speed (glow included), for FOV kick and audio. */
  readonly speedRatio: number;
  readonly speedTier: SpeedTier;
  /** Unit heading in world space (the nose direction projected on the ground plane). */
  readonly forward: Vec3;
  /** Auto-oriented up axis (REQ-CTL-09). */
  readonly up: Vec3;
  readonly state: SkaterStateName;
  /** Ticks spent in the current state. */
  readonly stateTicks: number;
  readonly stance: Stance;
  /** Rolling backward (motion flag, not a stance). */
  readonly fakie: boolean;
  /** Grounded and pumping a transition (row 1b). */
  readonly pumping: boolean;
  /** Crouch or linker charge in [0, 1] (REQ-CTL-05). */
  readonly crouchCharge: number;
  /**
   * Board orientation relative to the body in the skater local frame: identity when riding,
   * the 180 pivot during a revert, tumble offsets in a bail. Flip and shove-it rotations are NOT
   * here: SkaterView derives them as boardFlipRotation(flipId, flipPhase) (REQ-SKT-04).
   */
  readonly boardRel: Quat;
  /** The trick currently animating or being held (flip, grab, special, grind type, manual, lip), or null. */
  readonly trickId: TrickVariantId | null;
  /** Base flip id while a flip animation runs (enhanced ids included), else null. */
  readonly flipId: FlipId | EnhancedFlipId | null;
  /**
   * Progress of flipId's board animation in [0, 1]: ticks since the flip started / ticks(its anim ms,
   * enhanced extra included), so the rotation completes exactly at animMs (REQ-SKT-04). Independent
   * of the pose: it keeps running while a grab or a grind snap owns the pose. 0 when flipId is null.
   */
  readonly flipPhase: number;
  /** Base grab id while a grab is held or releasing, else null. */
  readonly grabId: GrabId | TweakedGrabId | null;
  readonly pose: PoseId;
  /** The specific trick the pose is for (grab id, grind type, lip id, flip id), or null. */
  readonly poseVariant: BaseTrickId | null;
  /** Animation phase in [0, 1] for the current pose, per the PoseId table (loops for push / roll). */
  readonly posePhase: number;
  /** Signed yaw accumulated in the current air, degrees (spin readout). */
  readonly airYawDeg: number;
  readonly grind: GrindSnapshot | null;
  /** Wheel or board contact point with the world (grind contact while grinding), or null in the air. */
  readonly contactPoint: Vec3 | null;
  readonly surface: SurfaceSnapshot | null;
  /** Non-null during Bail ("tumble") and GetUp ("getup"); t in [0, 1] through that phase. */
  readonly bail: { readonly phase: 'tumble' | 'getup'; readonly t: number } | null;
}

export interface ComboElementView {
  readonly id: ElementId;
  readonly category: TrickCategory;
  /** Display name, brand-resolved ("Switch Kickflip", "VIDA Slide", "PLAZA BAR HOP"). */
  readonly name: string;
  /** trickValue = base x stance x degradation (x nollie/fakie), before accrual. */
  readonly value: number;
  /** Hold accrual so far, whole points (live while open). */
  readonly accrual: number;
  /** Still being held (grab, grind, manual, lip, holdable special). */
  readonly open: boolean;
}

export interface ComboView {
  readonly elements: readonly ComboElementView[];
  /** Display names in order, for the ticker (joined with " + "). */
  readonly names: readonly string[];
  /** COMBO_BASE including live accrual, whole points. */
  readonly base: number;
  /** elements + 0.5 x spin180s (SPIN_MODE multiplier) or elements (base mode). */
  readonly multiplier: number;
  /** Total 180s credited in this combo. */
  readonly spin180s: number;
  /** floor(base x multiplier) if landed now. */
  readonly final: number;
}

export interface SpecialView {
  /** Meter in [0, 1]. */
  readonly meter: number;
  readonly glowing: boolean;
  /** The special currently animating or held, or null. */
  readonly activeId: SpecialId | null;
  /** Presentation seconds the active holdable special has been held. */
  readonly heldS: number;
}

export interface BalanceView {
  /** Needle in [-1, 1]; |needle| >= 1 is a bail. Negative = left (grind/lip) or nose down (manual). */
  readonly needle: number;
  /** "h" = horizontal arc over the head (grind, lip), "v" = vertical bar (manual) (REQ-BAL-06). */
  readonly axis: 'h' | 'v';
}

export interface RunView {
  readonly levelId: LevelId;
  readonly mode: RunMode;
  /** Seconds left on the 2:00 clock, clamped at 0 (REQ-GOL-01). */
  readonly clockS: number;
  /** Clock at 0 with a combo still alive (REQ-SM-09). */
  readonly overtime: boolean;
  readonly ended: boolean;
  readonly score: number;
  readonly bestCombo: number;
  readonly letters: Readonly<Record<LetterId, boolean>>;
  /** This level's MacGuffin is held (this run or an earlier one: once per career). */
  readonly macguffinCollected: boolean;
  /** Goal ids completed during this run, in completion order. */
  readonly goalsCompleted: readonly string[];
}

export interface CameraHints {
  /** Airborne from a vert launch with the assist active (REQ-CAM-02). */
  readonly vertAir: boolean;
  /** Normal of the ramp face the skater launched from (vert air), else null. */
  readonly rampNormal: Vec3 | null;
  /** World point CAM_LOOKAHEAD_M ahead along velocity (heading when slow). */
  readonly lookAhead: Vec3;
  /** Unit horizontal direction the camera should sit behind. */
  readonly heading: Vec3;
}

/**
 * The most recent landing text. Written at the contact tick with final 0 and quality
 * landQuality(offAxisDeg, 0) (clean or ok only), then REWRITTEN when that landing's combo banks
 * (LandWindow timer or Cross press, rows 9b / 9e / 12, or later from Manual / RevertWindow) with the
 * banked FINAL and landQuality(offAxisDeg of that contact, final), which may be sick or insane.
 * tick stays the contact tick. The world stores the offAxisDeg of the most recent contact from Air
 * and passes it to Scoring.bank.
 */
export interface LandView {
  readonly quality: LandQuality;
  /** Tick of the contact. */
  readonly tick: number;
  /** FINAL of the combo that banked after this landing (0 until it banks). */
  readonly final: number;
}

/**
 * The NPC whose talk trigger the skater is currently inside, or null. The sim never closes a
 * dialog (it never sees the confirm button): the HUD opens the dialog on the "npcTalk" event, hides
 * it after NPC_DIALOG_S or on any confirm (NavInput.confirm), and shows it again on the next
 * "npcTalk" event, which the sim emits on every entry into the trigger (REQ-NPC-02).
 */
export interface NpcTalkView {
  readonly npcId: NpcId;
  /** Brand-resolved display name. */
  readonly name: string;
  readonly line: string;
  /** Tick the skater entered the trigger (the tick of the matching npcTalk event). */
  readonly sinceTick: number;
}

export interface SimSnapshot {
  readonly tick: number;
  /** tick / SIM_HZ, seconds of sim time. */
  readonly simTime: number;
  /**
   * Loop time scale the sim wants: INFERENCE_TIME_SCALE while 900ms Inference is held, else 1.
   * The app applies it to FixedLoop.setTimeScale (REQ-SPC-05). The sim never reads wall time.
   */
  readonly timeScale: number;
  readonly levelId: LevelId;
  readonly skater: SkaterSnapshot;
  /** Live combo, or null when no combo is alive. */
  readonly combo: ComboView | null;
  readonly special: SpecialView;
  /** Active needle (Grind, Lip, Manual), else null. */
  readonly balance: BalanceView | null;
  readonly run: RunView;
  readonly camera: CameraHints;
  /** Most recent landing text, or null before the first landing. */
  readonly lastLand: LandView | null;
  /** NPC talk trigger the skater is inside, or null. Not the dialog's open state: see NpcTalkView. */
  readonly npc: NpcTalkView | null;
}

// ---------------------------------------------------------------------------------------------
// Board Lab config and player options (read by render/skater, ui, save, audio, app)
// ---------------------------------------------------------------------------------------------

export type GripId = 'black' | 'gray' | 'clear' | 'dieCut';
export type TruckColorId = 'raw' | 'black' | 'gold' | 'red';
export type WheelId = 'white99a' | 'blue101a' | 'green97a' | 'orange99a';
/** Sticker sheets: the three brand sheets read their names from BRANDS (REQ-LAB-01). */
export type StickerSheetId = 'labA' | 'labB' | 'chip' | 'wafer' | 'pcb' | 'tokenStream' | 'inference';

export interface StickerPlacement {
  readonly sheet: StickerSheetId;
  /** Sticker index within the sheet (0-based). */
  readonly index: number;
  /** Position on the deck underside, u along the length (0 tail .. 1 nose), v across (0 .. 1). */
  readonly u: number;
  readonly v: number;
  readonly rotDeg: number;
}

/** REQ-LAB-01 / 02. At most MAX_STICKERS stickers. */
export interface BoardConfig {
  /** Deck graphic sheet index 0..5. */
  readonly deckGraphic: number;
  readonly grip: GripId;
  readonly trucks: TruckColorId;
  readonly wheels: WheelId;
  readonly stickers: readonly StickerPlacement[];
}

export const DEFAULT_BOARD: BoardConfig = {
  deckGraphic: 0,
  grip: 'black',
  trucks: 'raw',
  wheels: 'white99a',
  stickers: [],
};

export type QualityPresetId = 'low' | 'med' | 'high' | 'ultra';
export type QualityOption = QualityPresetId | 'auto';

/** REQ-MNU-04 options. */
export interface GameOptions {
  readonly quality: QualityOption;
  /** 0..1 */
  readonly musicVolume: number;
  /** 0..1 */
  readonly sfxVolume: number;
  readonly rumble: boolean;
}

/** Founder playtest 2026-09-23 (DESIGN L CR-46): music 0.7 -> 0.5 and SFX 0.8 -> 0.75 by default. */
export const DEFAULT_OPTIONS: GameOptions = {
  quality: 'auto',
  musicVolume: 0.5,
  sfxVolume: 0.75,
  rumble: true,
};
