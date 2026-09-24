/**
 * src/input/types.ts: input track contracts (frozen after M0; integration track only).
 *
 * Pipeline (DESIGN C.1, REQ-TIM-02):
 *   render frame:  InputSystem.sample(nowMs)             polls gamepads, drains keyboard / mouse queues
 *   each sim tick: raw = InputSystem.nextTick()          held state + edges queued since the last tick
 *                  frame = FrameBuilder.next(raw, tick)   Dir8, DirEnter ring, press history (pure)
 *                  world.step(frame)                      the sim; inside it the world calls
 *                  parseTick(ctx, frame, memory)          the pure priority parser (C.3) and
 *                  resolveLanding(...)                    on the contact tick (rows 7, 8, 13)
 * Scripts (tests, e2e debug hook) skip InputSystem: they build RawTickInput and use FrameBuilder.
 *
 * The parser turns PRESSES and DIRECTION SEQUENCES into actions. Held state (grab held, Triangle
 * held for lips and Context Window, spin buttons held, Cross held, nollie held) is read by the world
 * straight from InputFrame.held.
 */

import type {
  Button, ButtonState, Dir8, DirOrNeutral, GlyphSet, GrindTypeId, InputFrame, InputSource,
  ManualId, NavInput, SkaterStateName, SpecialId, Vec2, AirTrickId, EnhancedFlipId, TweakedGrabId,
} from '../core/types';

// ---------------------------------------------------------------------------------------------
// Devices (src/input/devices.ts, src/input/system.ts)
// ---------------------------------------------------------------------------------------------

/**
 * Gamepad "standard" mapping indices (W3C Gamepad API). Axes: 0/1 left stick, 2/3 right stick
 * (y down positive in the API; the device layer flips it so y up is positive).
 * 0 Cross/A = ollie, 1 Circle/B = grab, 2 Square/X = flip, 3 Triangle/Y = grind, 4 L1/LB = spinL,
 * 5 R1/RB = spinR, 6 L2/LT = nollie, 7 R2/RT = revert, 8 Share/View = dev, 9 Options/Menu = pause,
 * 12..15 D-pad up/down/left/right. Triggers count as pressed at value >= 0.5.
 * Keyboard: Space ollie, J flip, K grab, L grind, Shift revert, Z (or Ctrl) nollie, Q/E spin,
 * WASD / arrows = D-pad and steer, Esc pause, Backquote (~) dev, mouse under pointer lock = camera.
 */
export interface DeviceInfo {
  readonly kind: 'gamepad' | 'keyboard';
  /** gamepad.id, or "keyboard". */
  readonly id: string;
  /** Gamepad index, null for the keyboard. */
  readonly index: number | null;
  readonly glyphs: GlyphSet;
}

/** One queued button edge with the render timestamp it was observed at. */
export interface ButtonEdge {
  readonly button: Button;
  readonly down: boolean;
  readonly ms: number;
}

/** What one device reports for one render frame. */
export interface DeviceSample {
  readonly held: ButtonState;
  /** Edges since the previous poll, oldest first (keyboard: from key events, so two presses per frame survive). */
  readonly edges: readonly ButtonEdge[];
  readonly stick: Vec2;
  readonly look: Vec2;
  readonly lookDelta: Vec2;
  readonly dpad: DirOrNeutral;
  /** Any button, stick past the deadzone, or key this frame: makes this the active device. */
  readonly active: boolean;
}

export interface InputDevice {
  readonly info: DeviceInfo;
  poll(nowMs: number): DeviceSample;
  dispose(): void;
}

/** Minimal Gamepad shape the device layer reads (lets tests pass fakes). */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
  readonly vibrationActuator?: {
    playEffect?(type: 'dual-rumble', params: { startDelay?: number; duration: number; weakMagnitude: number; strongMagnitude: number }): Promise<unknown>;
  } | null;
}

export interface ConnectionEvent {
  readonly connected: boolean;
  readonly device: DeviceInfo;
}

/** REQ-INP-05 rumble effects. Strengths and lengths come from TUNING.RUMBLE_*. */
export type RumbleEffect = 'grindPulse' | 'bail' | 'gap' | 'macguffin';

export interface RumbleSpec {
  readonly weak: number;
  readonly strong: number;
  readonly durationMs: number;
}

/** Browser input front end (src/input/system.ts). */
export interface InputSystem {
  /** Start listening (keyboard, mouse, gamepadconnected / disconnected). pointerTarget gets pointer lock. */
  attach(target: Window, pointerTarget?: HTMLElement): void;
  detach(): void;
  /** Once per render frame, before the loop runs ticks (REQ-TIM-02). */
  sample(nowMs: number): void;
  /**
   * Once per sim tick: held state plus the edges queued since the previous tick. Each queued edge is
   * delivered exactly once; if a frame queued more edges of one button than there are ticks, the
   * extra edges still arrive (several presses in one RawTickInput), never dropped.
   */
  nextTick(): RawTickInput;
  /** Menu navigation edges since the last call (render rate), with auto-repeat on held directions. */
  nav(): NavInput;
  /** The device that last produced input (glyphs follow it, REQ-HUD-05). */
  readonly activeDevice: DeviceInfo;
  /** Gamepad connect / disconnect (REQ-INP-08). Returns an unsubscribe function. */
  onConnection(listener: (e: ConnectionEvent) => void): () => void;
  /** Fire a rumble effect on the active gamepad; silent no-op without an actuator (REQ-INP-05). */
  rumble(effect: RumbleEffect): void;
  /**
   * Repeat an effect until cleared (REQ-INP-05 "100 ms pulses while grinding"): the input track
   * re-fires it every TUNING.RUMBLE_GRIND_PULSE_MS from sample(). The app calls
   * setRumbleLoop('grindPulse') on grindStart and setRumbleLoop(null) on grindEnd, bail, pause and
   * run end. null stops it; a new effect replaces the old one.
   */
  setRumbleLoop(effect: RumbleEffect | null): void;
  setRumbleEnabled(on: boolean): void;
  /** Pointer lock for mouse camera (REQ-CAM-03); requested on a canvas click during a run. */
  requestPointerLock(): void;
  exitPointerLock(): void;
}

// ---------------------------------------------------------------------------------------------
// Frame builder (src/input/frameBuilder.ts): pure
// ---------------------------------------------------------------------------------------------

/**
 * Raw input for one tick. When `pressed` / `released` are omitted (scripts), the builder derives
 * edges from held changes against the previous tick.
 */
export interface RawTickInput {
  readonly held: ButtonState;
  readonly pressed?: readonly Button[];
  readonly released?: readonly Button[];
  readonly stick: Vec2;
  readonly look: Vec2;
  readonly lookDelta: Vec2;
  readonly dpad: DirOrNeutral;
  readonly source: InputSource;
}

/** Pure, deterministic: the same RawTickInput sequence always yields the same InputFrames. */
export interface FrameBuilder {
  /** Build the frame for `tick` (ticks must increase by 1 per call). */
  next(raw: RawTickInput, tick: number): InputFrame;
  /** Forget history (new run). */
  reset(): void;
  /** The last frame built, or null. */
  readonly last: InputFrame | null;
}

// ---------------------------------------------------------------------------------------------
// Parser (src/input/parser.ts): pure, DESIGN C.3 priority table
// ---------------------------------------------------------------------------------------------

/**
 * Facts the parser needs that only the sim knows. The world computes them at the START of each
 * tick (before physics) from its current state and geometry queries at the current position.
 */
export interface ParserContext {
  readonly state: SkaterStateName;
  readonly glowing: boolean;
  readonly speed: number;
  /** Grounded / LandWindow / Manual on a surface with slope < FLAT_MAX_SLOPE_DEG (MANUAL_ENTRY). */
  readonly onFlat: boolean;
  /** Kind of the landing that opened LandWindow / RevertWindow, else null. */
  readonly landKind: 'flat' | 'vert' | null;
  /** A revert already fired for the current landing (P2b allows one). */
  readonly revertUsedThisLanding: boolean;
  /** Tick the current state was entered (REVERT_MANUAL 24-tick window, lip min hold). */
  readonly stateEnteredTick: number;
  /** REQ-VRT-08 transfer condition holds now (P1). */
  readonly spineTransferAvailable: boolean;
  /** Air magnet candidate now: "rail" (rail, ledge, or coping approached <= 55 deg) or "lip" (coping > 55 deg), REQ-LIP-02. */
  readonly airGrindCandidate: 'rail' | 'lip' | null;
  /** P5b ground snap candidate now (REQ-GRD-05). */
  readonly groundSnapAvailable: boolean;
  /** Grind type per direction on the current rail (Grind) or best candidate, toe-side rule applied by the sim. */
  readonly grindTypeByDir: Readonly<Record<DirOrNeutral, GrindTypeId>>;
  readonly currentGrindType: GrindTypeId | null;
  /** Air only: ticks since leftSurface or rail end (coyote, P8b / P9); null when not applicable. */
  readonly ticksSinceLeftSurface: number | null;
  /** A pop already happened in this air (coyote allows one). */
  readonly poppedThisAir: boolean;
  /** Cross was held at leftSurface (row 37b release pop). */
  readonly crossHeldAtLeftSurface: boolean;
  /** Cross charge is running on a linker or in Crouch (P9 release pops). */
  readonly charging: boolean;
  /** Current manual type in Manual, else null. */
  readonly manual: ManualId | null;
  /** L2 pressed while rolling fakie gives fakie_ variants instead of nollie_ (REQ-SCR-10). */
  readonly rollingFakie: boolean;
}

/** Parser state carried between ticks (plain data; part of the deterministic sim state). */
export interface ParserMemory {
  /** DirEntry ids consumed by a special or a reader (CR-11); bounded to the ring. */
  readonly consumed: readonly number[];
  /** Tick R2 was pressed in Air (P2); valid for ticks(REVERT_PRE_MS). */
  readonly revertBufferTick: number | null;
  /** Tick the grind buffer started (P5 press, or the pop tick for P5c); valid ticks(GRIND_PREBUFFER_MS). */
  readonly grindBufferTick: number | null;
  /** Triangle pressed or held during Crouch (P5c): the buffer starts at the pop. */
  readonly grindHeldInCrouch: boolean;
  /** Last flip / grab press in this air for double-tap (P6, REQ-INP-04). */
  readonly lastAirTrick: { readonly button: 'flip' | 'grab'; readonly dir: DirOrNeutral; readonly tick: number; readonly enhanced: boolean } | null;
  readonly lastGrindSwitchTick: number | null;
  readonly lastManualSwapTick: number | null;
  /** Swaps in the current manual run (REQ-INP-18); reset when Manual is entered from another state. */
  readonly manualSwapsThisRun: number;
  /** State seen on the previous tick (detects state entry). */
  readonly lastState: SkaterStateName;
}

/** Actions the parser emits (DESIGN C.3 "Action" column). At most one per press event. */
export type ParsedAction =
  /** P1 */
  | { readonly kind: 'spineTransfer' }
  /** P2: R2 in Air stored as the revert pre-buffer (informational; ParserMemory holds it). */
  | { readonly kind: 'revertBuffered' }
  /** P2b: R2 in a vert LandWindow. */
  | { readonly kind: 'revert' }
  /** P3 */
  | { readonly kind: 'special'; readonly specialId: SpecialId }
  /** P4 */
  | { readonly kind: 'grindSwitch'; readonly grindType: GrindTypeId }
  /** P5 / P5b (and each buffered tick in which a candidate exists): try to snap. ground = P5b hop. */
  | { readonly kind: 'grindTry'; readonly ground: boolean; readonly buffered: boolean; readonly dir: DirOrNeutral }
  /** P6: double-tap upgrades the pending air trick (one element, not two). */
  | { readonly kind: 'enhance'; readonly trickId: EnhancedFlipId | TweakedGrabId }
  /** P7: a flip or grab in Air. */
  | { readonly kind: 'trick'; readonly button: 'flip' | 'grab'; readonly dir: DirOrNeutral; readonly trickId: AirTrickId; readonly nollie: boolean; readonly fakie: boolean }
  /** P8: Cross pressed (the state machine picks Crouch, pump, crouch-on-linker or bank-then-crouch). */
  | { readonly kind: 'crossPress' }
  /** P8b: coyote pop with charge 0. */
  | { readonly kind: 'coyotePop' }
  /** P9: Cross released while charging (Crouch, a linker, or row 37b inside the coyote window). */
  | { readonly kind: 'crossRelease' }
  /** P10: L1 / R1 in Air. */
  | { readonly kind: 'quickSpin'; readonly deg: -180 | 180 }
  /** Reader MANUAL_ENTRY (row 4). */
  | { readonly kind: 'manualEntry'; readonly manual: ManualId }
  /** Reader MANUAL_LAND inside LandWindow (row 9d). The contact-tick half is resolveLanding(). */
  | { readonly kind: 'manualLand'; readonly manual: ManualId }
  /** Reader REVERT_MANUAL (row 15). */
  | { readonly kind: 'revertManual'; readonly manual: ManualId }
  /** Reader MANUAL_SWAP (row 28), rate-limited (REQ-INP-18). */
  | { readonly kind: 'manualSwap'; readonly manual: ManualId }
  /** Triangle released (Lip exit row 25 / 25b, Context Window end). */
  | { readonly kind: 'triangleRelease' };

export interface ParseResult {
  /** In emission order: press-driven actions in press order, then reader actions. */
  readonly actions: readonly ParsedAction[];
  readonly memory: ParserMemory;
}

/** Linkers valid on a contact tick (rows 7, 8, 12, 13), from resolveLanding(). */
export interface LandingLinkers {
  /** R2 pressed within ticks(REVERT_PRE_MS) before this contact (only meaningful on vert). */
  readonly revertBuffered: boolean;
  /** Manual pair completed within ticks(MANUAL_LAND_WINDOW_MS) before contact (flat only), consumed if returned. */
  readonly manualPair: ManualId | null;
  readonly memory: ParserMemory;
}

/** A pair of unconsumed DirEnter entries read by a sequence reader. */
export interface DirPair {
  readonly first: Dir8;
  readonly second: Dir8;
  readonly firstId: number;
  readonly secondId: number;
  /** H[-1].tEnter - H[-2].tExit (leave-to-enter, REQ-INP-17). */
  readonly gapTicks: number;
  /** Tick the second direction was entered. */
  readonly completedTick: number;
}
