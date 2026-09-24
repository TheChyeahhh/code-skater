/**
 * src/sim/controller.ts (sim track): the arcade kinematic controller (DESIGN C.6, REQ-CTL-01..22,
 * REQ-VRT-01..12). Moves the body one fixed tick in the movement mode the state machine chose and
 * REPORTS physical events; it never changes the skater state itself (REQ-SM-11).
 *
 * Ground: heading steer (TURN_RATE_GROUND_DPS with TURN_SPEED_FALLOFF; manual TURN_RATE_MANUAL_DPS),
 * velocity along the heading projected on the surface (no slip), auto-push, friction, brake + pivot,
 * over-speed decay, transition gravity factor, pump. Air: gravity, spin about the skater up
 * (stick + quick-spin bursts, cap), auto-orient toward the predicted landing normal, one collision
 * sphere, vert assist on launch, full-pipe rule. Contact: yaw / tilt off-axis per the vocabulary,
 * LAND_SPEED_RETAIN, yaw snap to the nearest 180. Walls: head-on vs glancing (REQ-CTL-20).
 * Deterministic: no randomness here; the world owns the Rng.
 *
 * Ground model (3D, so vertical faces work): the velocity lives in the tangent plane of the contact
 * normal; each tick it is steered about the normal, accelerated along travel, given the tangent part
 * of gravity (x TRANSITION_GRAVITY_FACTOR on transition-tagged faces), moved, and the ground ray is
 * cast back along the normal from SIM_GROUND_PROBE_UP_M above the new point. A hit re-seats the
 * feet and rotates velocity and nose onto the new facet with no speed loss (REQ-CTL-12); a miss
 * within GROUND_PROBE_M is leftSurface (row 37). The nose follows the velocity with its sign kept,
 * so rolling back down a face flips the fakie flag (REQ-CTL-18).
 *
 * Readings of DESIGN made here (listed in the track report):
 * - Rolling friction is not applied on transition-tagged faces, because every C.6 energy number (the
 *   ramp table, the drop-in trace, the REQ-CTL-11 check "11 m/s reaches a 3.6 m coping at 7.05 m/s")
 *   is computed without it.
 * - The yaw off-axis of a slow landing on TRUE flat reads the launch heading, not world -z (see
 *   offAxis): with -z an ollie in place facing east bailed at 90 deg.
 * - During a grind the wall ray starts at the board on the rail, so a ground-snap hop onto a ledge
 *   never reads the ledge's own end face as a wall.
 */

import { add3, clamp, cross3, DEG, dot3, forwardToYaw, len3, norm3, RAD, scale3, sub3, yawToForward } from '../core/math';
import { maxSpeed, statFactor, ticks, ticksS, TUNING, TUNING_DEFAULTS, TUNING_META } from '../core/tuning';
import type { Stance, SurfaceFlags, SurfaceTag, Vec2, Vec3 } from '../core/types';
import type { BuiltLevel } from '../levels/types';
import type { CollisionWorld, SurfaceHit } from './collision';
import { stepGrind, type GrindMotion, type RailNetwork } from './rails';
import { addScaled, angleDeg, horizontal, normOr, plain, projectOnPlane, rotateAbout, rotateToward, signedAngleAbout, slopeOf, UP } from './physics/vec';

/** Movement rules to apply this tick (picked by the world from the machine state). */
export type MovementMode = 'ground' | 'crouch' | 'manual' | 'air' | 'grind' | 'lip' | 'bail' | 'getup' | 'frozen';

export interface SurfaceContact {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly flags: SurfaceFlags;
  readonly surfaceId: string;
}

/** Stored at leftSurface: what the air launched from (vert assist, spine side, gaps). */
export interface LaunchInfo {
  readonly tick: number;
  readonly pos: Vec3;
  readonly surfaceId: string;
  readonly normal: Vec3;
  readonly slopeDeg: number;
  /** Vert assist applied at launch (camera vertAir hint, REQ-CAM-02). */
  readonly assisted: boolean;
  /** Launch tangent: the skater basis nose0 (REQ-VRT-12). */
  readonly nose0: Vec3;
  /** Extension (sim track): the launch surface was tagged transition. */
  readonly transition?: boolean;
}

/** Grind snap blend (REQ-GRD-03 80 ms; REQ-GRD-05 hop arc for a ground snap). Extension. */
export interface SnapBlend {
  readonly from: Vec3;
  readonly tick0: number;
  readonly ticks: number;
  /** Peak height of the hop above `from` (0 = straight blend). */
  readonly hopM: number;
}

export interface BodyState {
  /** Feet position. */
  readonly pos: Vec3;
  readonly vel: Vec3;
  /** Heading yaw, radians (src/core/types.ts convention). */
  readonly yaw: number;
  /** Auto-oriented up axis. */
  readonly up: Vec3;
  readonly surface: SurfaceContact | null;
  /** Signed yaw accumulated about the skater up in the current air, degrees. */
  readonly airYawDeg: number;
  readonly launch: LaunchInfo | null;
  readonly grind: GrindMotion | null;
  /** Rolling backward (recomputed on the ground). */
  readonly fakie: boolean;
  // ---- extensions (sim track; only the sim reads BodyState) ----
  /** Unit nose direction in world space (tangent to the surface on the ground; the skater basis in the air). */
  readonly nose: Vec3;
  /** Quick-spin degrees still to turn in the current bursts (signed like airYawDeg). */
  readonly quickSpinDeg: number;
  /** Predicted landing normal (REQ-CTL-9) and the tick it was computed. */
  readonly predictNormal: Vec3;
  readonly predictTick: number;
  /** Visual yaw offset (deg) of the board still easing to the nearest 180 after a landing (REQ-CTL-07). */
  readonly yawSnapDeg: number;
  /** Ticks left in the low-speed brake pivot (REQ-CTL-04), 0 = none. */
  readonly pivotTicks: number;
  /** A pivot already ran during the current stick-back hold (one pivot per hold). */
  readonly pivotLatch: boolean;
  /** Tick the current push stroke began, or null while not pushing. */
  readonly pushTick: number | null;
  /** A spine transfer happened in this air (REQ-VRT-08: no further assist). */
  readonly transferred: boolean;
  readonly snap: SnapBlend | null;
}

/** Continuous controls for this tick, derived by the world from InputFrame and the machine state. */
export interface ControlIntent {
  /** Steer / air spin axis in [-1, 1] (InputFrame.dirAxis.x). */
  readonly steer: number;
  /** Forward axis in [-1, 1] (InputFrame.dirAxis.y): push when forward, brake when back (ground only). */
  readonly throttle: number;
  /** Cross held on a descending transition (pump, row 1b). */
  readonly pump: boolean;
  /** Quick-spin bursts queued this tick (+1 per R1 180, -1 per L1 180), REQ-VRT-04. */
  readonly quickSpins: number;
  /** Spin buttons held (bursts repeat back to back while held). */
  readonly spinHeld: -1 | 0 | 1;
  /** Camera-relative look is not applied to movement; right stick is camera only. */
  readonly look?: Vec2;
}

export type PhysicsEvent =
  | { readonly kind: 'contact'; readonly contact: SurfaceContact; readonly offAxisDeg: number; readonly tiltDeg: number; readonly speed: number; readonly airYawDeg?: number }
  | { readonly kind: 'leftSurface'; readonly launch: LaunchInfo }
  | { readonly kind: 'wallHit'; readonly headOn: boolean; readonly speed: number; readonly incidenceDeg: number; readonly normal: Vec3 }
  | { readonly kind: 'railEnd'; readonly corner: boolean }
  | { readonly kind: 'stall' }
  | { readonly kind: 'apex'; readonly pos: Vec3 }
  /** Extension: a new auto-push stroke began (push sound, pose loop). */
  | { readonly kind: 'push' };

export interface ControllerEnv {
  readonly collision: CollisionWorld;
  readonly rails: RailNetwork;
  readonly dtS: number;
  readonly tick: number;
  readonly glowing: boolean;
  readonly stance: Stance;
  /** Extension: the level, for the full-pipe launch rule (REQ-VRT-11). */
  readonly level?: BuiltLevel;
}

export interface ControllerStep {
  readonly body: BodyState;
  readonly events: readonly PhysicsEvent[];
}

type Events = PhysicsEvent[];

// ---------------------------------------------------------------------------------------------
// Construction and classification
// ---------------------------------------------------------------------------------------------

/** Body at a spawn point, standing still. */
export function createBody(pos: Vec3, yaw: number): BodyState {
  const nose = yawToForward(yaw);
  return {
    pos: plain(pos), vel: { x: 0, y: 0, z: 0 }, yaw, up: UP, surface: null, airYawDeg: 0, launch: null, grind: null,
    fakie: false, nose, quickSpinDeg: 0, predictNormal: UP, predictTick: -1_000_000, yawSnapDeg: 0, pivotTicks: 0,
    pivotLatch: false, pushTick: null, transferred: false, snap: null,
  };
}

/** REQ-CTL-02: flags from a contact normal and triangle tag, thresholds from TUNING. */
export function classifySurface(normal: Vec3, tag: SurfaceTag): SurfaceFlags {
  const slopeDeg = slopeOf(normOr(normal, UP));
  const transition = tag === 'transition';
  const wall = tag === 'boundary' || (slopeDeg >= TUNING.WALL_MIN_SLOPE_DEG && !transition);
  const flat = slopeDeg < TUNING.FLAT_MAX_SLOPE_DEG;
  return {
    slopeDeg,
    tag,
    flat,
    bank: !flat && !transition && !wall,
    transition,
    nearVertical: transition && slopeDeg >= TUNING.VERT_ASSIST_MIN_SLOPE_DEG,
    vertLanding: slopeDeg >= TUNING.VERT_LAND_MIN_SLOPE_DEG,
    wall,
  };
}

function contactOf(hit: SurfaceHit): SurfaceContact {
  return { point: plain(hit.point), normal: plain(hit.normal), flags: classifySurface(hit.normal, hit.tag), surfaceId: hit.surfaceId };
}

/**
 * Seat a body on the surface under its feet (spawn, teleport, stand-up): a ray down from
 * SIM_GROUND_PROBE_UP_M above the feet reaching `reach` below them. Returns null when nothing is there.
 */
export function groundBody(body: BodyState, collision: CollisionWorld, reach: number): BodyState | null {
  const up = TUNING.SIM_GROUND_PROBE_UP_M;
  const hit = collision.raycast(add3(body.pos, { x: 0, y: up, z: 0 }), { x: 0, y: -1, z: 0 }, up + reach);
  if (!hit || hit.front === false) return null;
  const c = contactOf(hit);
  if (c.flags.wall) return null;
  const n = c.normal;
  const nose = normOr(projectOnPlane(body.nose, n), normOr(projectOnPlane(yawToForward(body.yaw), n), body.nose));
  const speed = len3(body.vel);
  const vel = scale3(nose, speed);
  return {
    ...body, pos: c.point, vel, up: n, surface: c, nose, fakie: false, airYawDeg: 0, grind: null, launch: null,
    quickSpinDeg: 0, transferred: false, snap: null, yawSnapDeg: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

function yawOf(nose: Vec3, fallback: number): number {
  return Math.hypot(nose.x, nose.z) > TUNING.SIM_MIN_HORIZ_DIR ? forwardToYaw(nose) : fallback;
}

/** REQ-CTL-13: switch pop factor 1 - SWITCH_POP_PENALTY x (10 - s) / (10 - default s). */
function switchPopFactor(stance: Stance): number {
  if (stance !== 'switch') return 1;
  const max = TUNING_META.STAT_SWITCH.max;
  const ref = TUNING_DEFAULTS.STAT_SWITCH;
  return 1 - (TUNING.SWITCH_POP_PENALTY * (max - TUNING.STAT_SWITCH)) / (max - ref);
}

/** REQ-CTL-05: pop height for a charge already shaped by OLLIE_CHARGE_EXP (stateMachine.popCharge). */
export function popHeight(charge: number, stance: Stance): number {
  const c = clamp(charge, 0, 1);
  return (TUNING.OLLIE_H_TAP_M + (TUNING.OLLIE_H_FULL_M - TUNING.OLLIE_H_TAP_M) * c) * statFactor(TUNING.STAT_AIR) * switchPopFactor(stance);
}

/** A downward-facing contact (a deck underside, an overhang edge): never a wall, never a floor. */
function isCeiling(normal: Vec3): boolean {
  return normal.y < -TUNING.SIM_CEILING_NORMAL_Y;
}

/** The outward horizontal face direction of a steep face (its normal flattened). */
function faceOut(normal: Vec3): Vec3 {
  return normOr(horizontal(normal), { x: 0, y: 0, z: 1 });
}

/**
 * REQ-VRT-01 / CR-15 clamp: the horizontal velocity component perpendicular to the ramp face is
 * scaled by VERT_ASSIST_KEEP and clamped to [VERT_ASSIST_MIN_OUT_MPS, VERT_ASSIST_MAX_OUT_MPS]
 * outward (or set to `fixedOut`, the full-pipe rule REQ-VRT-11). The along-coping part is kept.
 */
function assistClamp(vel: Vec3, normal: Vec3, fixedOut: number | null): Vec3 {
  const out = faceOut(normal);
  const vPerp = dot3(vel, out);
  const next = fixedOut ?? clamp(TUNING.VERT_ASSIST_KEEP * vPerp, TUNING.VERT_ASSIST_MIN_OUT_MPS, TUNING.VERT_ASSIST_MAX_OUT_MPS);
  return addScaled(vel, out, next - vPerp);
}

/** Full-pipe primitive a surface id belongs to, if any. */
function fullPipeOf(env: ControllerEnv, surfaceId: string): boolean {
  const kind = env.level?.surfaces[surfaceId]?.kind;
  return kind === 'fullPipe';
}

/** Launch bookkeeping for leaving a surface (roll-off, pop), vert assist included (REQ-VRT-01, REQ-VRT-11). */
function launchFrom(body: BodyState, contact: SurfaceContact, vel: Vec3, env: ControllerEnv): { vel: Vec3; launch: LaunchInfo } {
  const flags = contact.flags;
  let v = vel;
  let assisted = false;
  if (flags.transition && flags.slopeDeg >= TUNING.VERT_ASSIST_MIN_SLOPE_DEG && len3(v) > 1e-6) {
    const out = faceOut(contact.normal);
    const along = normOr(cross3(UP, out), { x: 1, y: 0, z: 0 });
    const lateral = Math.abs(dot3(v, along)) / len3(v);
    if (lateral < TUNING.VERT_ASSIST_MAX_LATERAL) {
      v = assistClamp(v, contact.normal, fullPipeOf(env, contact.surfaceId) ? TUNING.FULLPIPE_ASSIST_OUT_MPS : null);
      assisted = true;
    }
  }
  return {
    vel: v,
    launch: {
      tick: env.tick, pos: plain(body.pos), surfaceId: contact.surfaceId, normal: plain(contact.normal),
      slopeDeg: flags.slopeDeg, assisted, nose0: plain(body.nose), transition: flags.transition,
    },
  };
}

/** Body in the air after a launch. */
function airborne(body: BodyState, pos: Vec3, vel: Vec3, launch: LaunchInfo, up: Vec3): BodyState {
  return {
    ...body, pos: plain(pos), vel: plain(vel), surface: null, grind: null, launch, up: normOr(up, UP), airYawDeg: 0,
    quickSpinDeg: 0, predictTick: -1_000_000, predictNormal: UP, yawSnapDeg: 0, pivotTicks: 0, pivotLatch: false, pushTick: null,
    transferred: false, snap: null,
  };
}

/** Put a body in the air from a launch the world computed (rail end, stall hop, lip exit, a bail off a linker). */
export function launchBody(body: BodyState, pos: Vec3, vel: Vec3, launch: LaunchInfo, up: Vec3): BodyState {
  const b = airborne(body, pos, vel, launch, up);
  return { ...b, nose: plain(normOr(launch.nose0, body.nose)) };
}

/**
 * The skater-basis nose in the air (REQ-VRT-12): nose0 carried along by the auto-orient (the same
 * rotation that takes the launch up to the current up), re-projected on the plane of up, turned by
 * airYaw about up. Founder playtest 2026-09-23 (DESIGN L CR-43): a bare re-projection lost the
 * heading when the up tilted toward the nose (an ollie up a mini ramp face turned the nose 70 deg
 * sideways and the landing bailed); carrying it keeps the auto-orient a pure pitch / roll.
 */
export function airNose(body: BodyState): Vec3 {
  const up = body.up;
  const nose0 = body.launch?.nose0 ?? body.nose;
  const up0 = body.launch ? normOr(body.launch.normal, up) : up;
  const axis = cross3(up0, up);
  const carried = len3(axis) > 1e-6 ? rotateAbout(nose0, norm3(axis), angleDeg(up0, up) * DEG) : nose0;
  let base = projectOnPlane(carried, up);
  if (len3(base) < 1e-4) base = projectOnPlane(body.nose, up);
  if (len3(base) < 1e-4) base = projectOnPlane({ x: 0, y: 0, z: -1 }, up);
  return norm3(rotateAbout(norm3(base), up, body.airYawDeg * DEG));
}

/** A downhill projection shorter than this is true flat (a numeric guard, not a feel number). */
const TRUE_FLAT = 1e-3;

/**
 * Yaw off-axis at a contact (DESIGN C.6 vocabulary): the angle between the nose and the velocity,
 * both projected on the landing plane, folded to [0, 90]; a projected velocity slower than
 * SIM_LAND_TRAVEL_MIN_MPS (0.5) is replaced by the surface downhill direction. On TRUE flat there is
 * no downhill: DESIGN's "world -z" there would make an ollie in place facing east read 90 deg and
 * bail, so the reference is the launch heading instead (`reference`, the skater-basis nose0 before
 * any spin), and with no usable reference the nose itself (off-axis 0). Logged as a CHANGE-REQUEST.
 * Returns the unfolded angle too (fakie = unfolded > 90).
 */
export function offAxis(nose: Vec3, vel: Vec3, normal: Vec3, reference?: Vec3): { offAxisDeg: number; unfoldedDeg: number; travel: Vec3 } {
  const n = normOr(normal, UP);
  const noseP = projectOnPlane(nose, n);
  let travel = projectOnPlane(vel, n);
  if (len3(travel) < TUNING.SIM_LAND_TRAVEL_MIN_MPS) {
    travel = projectOnPlane({ x: 0, y: -1, z: 0 }, n);
    if (len3(travel) < TRUE_FLAT) {
      const ref = reference ? projectOnPlane(reference, n) : null;
      travel = ref && len3(ref) > 1e-3 ? ref : len3(noseP) > 1e-6 ? noseP : { x: 0, y: 0, z: -1 };
    }
  }
  const theta = angleDeg(noseP, travel);
  return { offAxisDeg: Math.min(theta, 180 - theta), unfoldedDeg: theta, travel: norm3(travel) };
}

/**
 * Founder playtest 2026-09-23 (DESIGN L CR-43): only YAW against the travel direction counts at a
 * landing. The plane measure above also counts the downhill part a fall adds to the projected
 * velocity (a plain ollie across a bank read 20 to 40 deg off-axis with the nose dead along the
 * travel), so where both the nose and the velocity have a usable horizontal part the world-yaw
 * angle between them is measured too and the smaller one is taken. Vert airs (nose or velocity
 * nearly vertical) keep the plane measure.
 */
export function landingOffAxis(nose: Vec3, vel: Vec3, normal: Vec3, reference?: Vec3): { offAxisDeg: number; unfoldedDeg: number; travel: Vec3 } {
  const plane = offAxis(nose, vel, normal, reference);
  const nh = { x: nose.x, y: 0, z: nose.z };
  const vh = { x: vel.x, y: 0, z: vel.z };
  if (len3(nh) < TUNING.SIM_MIN_HORIZ_DIR || len3(vh) < TUNING.SIM_LAND_TRAVEL_MIN_MPS) return plane;
  const theta = angleDeg(nh, vh);
  const yawDeg = Math.min(theta, 180 - theta);
  return yawDeg < plane.offAxisDeg ? { ...plane, offAxisDeg: yawDeg } : plane;
}

// ---------------------------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------------------------

interface GroundRules {
  readonly push: boolean;
  readonly brake: boolean;
  readonly friction: number;
  /** Apply `friction` on transition-tagged faces too (manual, bail); rolling friction is not (header). */
  readonly frictionOnTransitions: boolean;
  readonly turnDps: (speed: number, vmax: number) => number;
  readonly pump: boolean;
}

const groundTurn = (speed: number, vmax: number): number =>
  TUNING.TURN_RATE_GROUND_DPS * (1 - TUNING.TURN_SPEED_FALLOFF * Math.min(1, speed / vmax));

function wallCheck(pos: Vec3, n: Vec3, vel: Vec3, env: ControllerEnv, events: Events): { vel: Vec3; blocked: boolean } {
  const speed = len3(vel);
  if (speed < 1e-4) return { vel, blocked: false };
  const dir = scale3(vel, 1 / speed);
  const origin = addScaled(pos, n, TUNING.SIM_WALL_PROBE_UP_M);
  const hit = env.collision.raycast(origin, dir, speed * env.dtS + TUNING.SKATER_RADIUS_M);
  if (!hit || hit.front === false) return { vel, blocked: false };
  const flags = classifySurface(hit.normal, hit.tag);
  if (!flags.wall) return { vel, blocked: false };
  return wallResponse(vel, hit.normal, events);
}

/**
 * REQ-CTL-20 as changed by founder playtest 2 (CR-65): a wall never bails. A glancing hit slides
 * along it; a near head-on hit (incidence <= WALL_BAIL_ANGLE_DEG) bonks the skater back off it at
 * SIM_WALL_BOUNCE of the into-wall speed, so auto-push cannot pin him against the wall.
 */
function wallResponse(vel: Vec3, wallNormal: Vec3, events: Events): { vel: Vec3; blocked: boolean } {
  const speed = len3(vel);
  const incidence = angleDeg(scale3(vel, -1), wallNormal);
  events.push({ kind: 'wallHit', headOn: false, speed, incidenceDeg: incidence, normal: plain(wallNormal) });
  const into = dot3(vel, wallNormal);
  if (into >= 0) return { vel, blocked: false };
  const tangential = scale3(sub3(vel, scale3(wallNormal, into)), TUNING.WALL_SLIDE_RETAIN);
  if (incidence > TUNING.WALL_BAIL_ANGLE_DEG) return { vel: tangential, blocked: false };
  return { vel: addScaled(tangential, wallNormal, -into * TUNING.SIM_WALL_BOUNCE), blocked: false };
}

function stepGround(body: BodyState, intent: ControlIntent, env: ControllerEnv, rules: GroundRules): ControllerStep {
  const events: Events = [];
  const surface = body.surface as SurfaceContact;
  const dt = env.dtS;
  const n = surface.normal;
  const vmax = maxSpeed(env.glowing);
  let v = projectOnPlane(body.vel, n);
  let nose = normOr(projectOnPlane(body.nose, n), normOr(projectOnPlane(yawToForward(body.yaw), n), body.nose));
  const speed = len3(v);

  // Steering about the contact normal (right stick = clockwise from above = negative angle).
  const turn = -rules.turnDps(speed, vmax) * DEG * clamp(intent.steer, -1, 1) * dt;
  // Founder playtest 2 (CR-65): no brake pivot. Stick back only brakes, and never turns or reverses.
  const pivotTicks = 0;
  const pivotLatch = false;
  const back = rules.brake && intent.throttle <= -TUNING.SIM_PUSH_AXIS_MIN;
  if (turn !== 0) {
    v = rotateAbout(v, n, turn);
    nose = rotateAbout(nose, n, turn);
  }

  // Along-travel acceleration: push, friction, brake, pump, over-speed decay.
  const travel = speed > 1e-6 ? scale3(v, 1 / speed) : nose;
  // THPS1-style auto-push (CR-65): the skater pushes on his own whenever the stick is not held back.
  const pushing = rules.push && !back && (TUNING.SIM_AUTO_PUSH >= 0.5 || intent.throttle >= TUNING.SIM_PUSH_AXIS_MIN) && speed < TUNING.PUSH_CUTOFF * vmax;
  let a = 0;
  if (pushing) a += TUNING.PUSH_ACCEL;
  else if (!surface.flags.transition || rules.frictionOnTransitions) a -= rules.friction;
  if (back) a -= TUNING.BRAKE_DECEL;
  if (rules.pump && intent.pump && surface.flags.transition && v.y < 0) a += TUNING.PUMP_ACCEL;
  let next = Math.max(0, speed + a * dt);
  if (next > vmax && speed > vmax) next = Math.max(vmax, next - TUNING.OVERSPEED_DECAY * dt);
  v = scale3(travel, next);

  // Tangent gravity (x TRANSITION_GRAVITY_FACTOR on transitions, REQ-CTL-11).
  const gT = projectOnPlane({ x: 0, y: -TUNING.GRAVITY, z: 0 }, n);
  v = addScaled(v, gT, (surface.flags.transition ? TUNING.TRANSITION_GRAVITY_FACTOR : 1) * dt);

  let pushTick = body.pushTick;
  if (pushing) {
    if (pushTick === null || env.tick - pushTick >= ticksS(TUNING.PUSH_CYCLE_S)) {
      pushTick = env.tick;
      events.push({ kind: 'push' });
    }
  } else {
    pushTick = null;
  }

  // Walls ahead (REQ-CTL-20).
  const wall = wallCheck(body.pos, n, v, env, events);
  v = wall.vel;
  const moveTo = wall.blocked ? body.pos : addScaled(body.pos, v, dt);

  // Full-pipe launch at the 4.0 m line (REQ-VRT-11): the wall is vertical or overhanging there.
  if (fullPipeOf(env, surface.surfaceId) && n.y <= 1e-3 && v.y > 0) {
    return leave(body, surface, moveTo, v, nose, env, events, pushTick);
  }

  // Ground probe back along the normal.
  const up = TUNING.SIM_GROUND_PROBE_UP_M;
  const hit = env.collision.raycast(addScaled(moveTo, n, up), scale3(n, -1), up + TUNING.GROUND_PROBE_M);
  const contact = hit && hit.front !== false ? contactOf(hit) : null;
  if (!contact || contact.flags.wall) return leave(body, surface, moveTo, v, nose, env, events, pushTick);

  const n2 = contact.normal;
  const sp = len3(v);
  // A convex edge (the new normal tilts forward along travel by more than SIM_CONVEX_LEAVE_DEG) launches.
  if (sp > 1e-3 && angleDeg(n, n2) > TUNING.SIM_CONVEX_LEAVE_DEG && dot3(sub3(n2, n), v) > 0) {
    return leave(body, surface, moveTo, v, nose, env, events, pushTick);
  }
  const vOn = projectOnPlane(v, n2);
  v = len3(vOn) > 1e-9 ? scale3(norm3(vOn), sp) : { x: 0, y: 0, z: 0 };
  nose = normOr(projectOnPlane(nose, n2), nose);
  if (sp > 1e-3) {
    const d = scale3(v, 1 / sp);
    nose = dot3(nose, d) >= 0 ? d : scale3(d, -1);
  }
  const fakie = sp > 1e-3 ? dot3(nose, v) < 0 : body.fakie;
  // The residual is at most 90 deg, so a linear 90 / ticks step ends every snap inside LAND_YAW_SNAP_MS.
  const snapStep = 90 / Math.max(1, ticks(TUNING.LAND_YAW_SNAP_MS));
  const yawSnapDeg = Math.abs(body.yawSnapDeg) <= snapStep ? 0 : body.yawSnapDeg - Math.sign(body.yawSnapDeg) * snapStep;
  return {
    body: {
      ...body, pos: contact.point, vel: plain(v), up: n2, surface: contact, nose: plain(nose), yaw: yawOf(nose, body.yaw), fakie,
      pivotTicks, pivotLatch, pushTick, yawSnapDeg, airYawDeg: 0,
    },
    events,
  };
}

function leave(body: BodyState, surface: SurfaceContact, pos: Vec3, vel: Vec3, nose: Vec3, env: ControllerEnv, events: Events, pushTick: number | null): ControllerStep {
  const seated: BodyState = { ...body, nose: plain(nose), pushTick };
  const { vel: v, launch } = launchFrom(seated, surface, vel, env);
  events.push({ kind: 'leftSurface', launch });
  return { body: { ...airborne(seated, pos, v, launch, surface.normal), yaw: yawOf(nose, body.yaw) }, events };
}

// ---------------------------------------------------------------------------------------------
// Air
// ---------------------------------------------------------------------------------------------

/** Ballistic sweep for the landing prediction (REQ-CTL-09): normal of the first rideable hit, else null. */
function predictLanding(pos: Vec3, vel: Vec3, collision: CollisionWorld): Vec3 | null {
  const seg = TUNING.LAND_PREDICT_AHEAD_S;
  const g = TUNING.GRAVITY;
  let p = pos;
  let v = vel;
  for (let k = 0; k < TUNING.SIM_PREDICT_SEGMENTS; k++) {
    const q = { x: p.x + v.x * seg, y: p.y + v.y * seg - 0.5 * g * seg * seg, z: p.z + v.z * seg };
    const d = sub3(q, p);
    const hit = collision.raycast(p, d, len3(d));
    if (hit && hit.front !== false) {
      const flags = classifySurface(hit.normal, hit.tag);
      if (!flags.wall) return plain(hit.normal);
    }
    p = q;
    v = { x: v.x, y: v.y - g * seg, z: v.z };
  }
  return null;
}

/**
 * REQ-VRT-04: each R1 (+1) / L1 (-1) queues a QUICKSPIN_STEP_DEG burst at QUICKSPIN_RATE_DPS; a held
 * button queues the next burst the tick one ends; the stick spin adds; the sum is capped at
 * SPIN_RATE_CAP_DPS with the stick part cut first, so bursts always finish on 180 increments.
 * Sign: positive yaw = counter-clockwise from above (three's yaw), so R1 and stick right are negative.
 */
function spinStep(body: BodyState, intent: ControlIntent, dt: number): { yawDeg: number; rem: number } {
  const rem = body.quickSpinDeg - intent.quickSpins * TUNING.QUICKSPIN_STEP_DEG;
  const burst = Math.sign(rem) * Math.min(Math.abs(rem), TUNING.QUICKSPIN_RATE_DPS * dt);
  // Founder playtest 2026-09-23 (DESIGN L CR-43): a riding lean (a diagonal, a slight analog tilt)
  // must not spin the skater into a sideways landing, so the air spin reads only the part of the
  // stick's x beyond SIM_AIR_SPIN_DEADZONE, rescaled so full left / right is still full rate.
  const dz = clamp(TUNING.SIM_AIR_SPIN_DEADZONE, 0, 0.99);
  const sx = clamp(intent.steer, -1, 1);
  const spinIn = Math.sign(sx) * Math.max(0, (Math.abs(sx) - dz) / (1 - dz));
  let stick = -spinIn * TUNING.SPIN_RATE_STICK_DPS * statFactor(TUNING.STAT_SPIN) * dt;
  const cap = TUNING.SPIN_RATE_CAP_DPS * dt;
  if (Math.sign(stick) === Math.sign(burst) && Math.abs(stick) + Math.abs(burst) > cap) stick = Math.sign(stick) * Math.max(0, cap - Math.abs(burst));
  if (Math.abs(stick) > cap) stick = Math.sign(stick) * cap;
  let next = rem - burst;
  if (Math.abs(next) < 1e-9) next = 0;
  // Holding L1 / R1 repeats bursts back to back: the next one starts the tick this one ends.
  if (next === 0 && Math.abs(burst) > 0 && intent.spinHeld !== 0) next = -intent.spinHeld * TUNING.QUICKSPIN_STEP_DEG;
  return { yawDeg: burst + stick, rem: next };
}

/**
 * Degrees of air yaw the landing spin assist still has to turn (CR-65), signed. It follows the same
 * off-axis measure the landing is judged by (landingOffAxis against the predicted landing normal),
 * so a flat landing lines up with the travel and a ramp-face landing lines up with the face: probe
 * one SIM_SPIN_ASSIST_PROBE_DEG each way and turn toward the smaller off-axis, by as much as is left.
 */
function spinAssistDiff(body: BodyState, airYawDeg: number, v: Vec3): number {
  const off = (yaw: number): number => landingOffAxis(airNose({ ...body, airYawDeg: yaw }), v, body.predictNormal, body.launch?.nose0).offAxisDeg;
  const h = TUNING.SIM_SPIN_ASSIST_PROBE_DEG;
  const f0 = off(airYawDeg);
  const fp = off(airYawDeg + h);
  const fm = off(airYawDeg - h);
  if (f0 <= fp && f0 <= fm) return 0;
  return fp < fm ? f0 : -f0;
}

/**
 * Seconds until the feet at `p` moving at `v` meet a surface: the straight fall onto the ground
 * below (while descending) or a face straight ahead along the travel (an ollie into a ramp still
 * rising), whichever comes first; Infinity if neither is within the assist window.
 */
function timeToContact(p: Vec3, v: Vec3, g: number, env: ControllerEnv): number {
  let t = Infinity;
  if (v.y < 0) {
    const down = env.collision.raycast(p, { x: 0, y: -1, z: 0 }, TUNING.SIM_SPIN_ASSIST_PROBE_M);
    if (down && down.front !== false) {
      const h = Math.max(0, p.y - down.point.y);
      t = (v.y + Math.sqrt(v.y * v.y + 2 * g * h)) / g;
    }
  }
  const speed = len3(v);
  if (speed > 1e-3) {
    const ahead = env.collision.raycast(p, scale3(v, 1 / speed), speed * TUNING.SIM_SPIN_ASSIST_S);
    if (ahead && ahead.front !== false) t = Math.min(t, ahead.distance / speed);
  }
  return t;
}

function stepAir(body: BodyState, intent: ControlIntent, env: ControllerEnv, spin: boolean): ControllerStep {
  const events: Events = [];
  const dt = env.dtS;
  const g = TUNING.GRAVITY;
  // Exact constant-gravity step, so a pop of v_pop peaks at v_pop^2 / 2g (REQ-CTL-05 apex within 1 cm).
  let v = { x: body.vel.x, y: body.vel.y - g * dt, z: body.vel.z };
  if (body.vel.y > 0 && v.y <= 0) events.push({ kind: 'apex', pos: plain(body.pos) });
  const p0 = body.pos;
  let p1 = { x: p0.x + body.vel.x * dt, y: p0.y + body.vel.y * dt - 0.5 * g * dt * dt, z: p0.z + body.vel.z * dt };

  // Spin about the skater up (REQ-VRT-03, 04, 12).
  let airYawDeg = body.airYawDeg;
  let quickSpinDeg = body.quickSpinDeg;
  if (spin) {
    const s = spinStep(body, intent, dt);
    quickSpinDeg = s.rem;
    // Founder playtest 2 (CR-65) landing spin assist: in the last SIM_SPIN_ASSIST_S before the feet
    // reach the ground below, with no quick-spin burst still running, the stick spin is replaced by
    // a turn to the nearest 180 at SIM_SPIN_ASSIST_DPS, so a held stick never lands sideways.
    const toGround = quickSpinDeg === 0 ? timeToContact(p1, v, g, env) : Infinity;
    if (toGround <= TUNING.SIM_SPIN_ASSIST_S) {
      const diff = spinAssistDiff(body, airYawDeg, v);
      airYawDeg += Math.sign(diff) * Math.min(Math.abs(diff), TUNING.SIM_SPIN_ASSIST_DPS * dt);
    } else {
      airYawDeg += s.yawDeg;
    }
  }

  // Auto-orient toward the predicted landing normal (REQ-CTL-09).
  let predictNormal = body.predictNormal;
  let predictTick = body.predictTick;
  if (env.tick - predictTick >= TUNING.LAND_PREDICT_EVERY_TICKS) {
    predictNormal = predictLanding(p1, v, env.collision) ?? UP;
    predictTick = env.tick;
  }
  const up = rotateToward(normOr(body.up, UP), predictNormal, TUNING.AIR_ORIENT_RATE_DPS * DEG * dt);

  let next: BodyState = { ...body, up, airYawDeg, quickSpinDeg, predictNormal, predictTick };
  const nose = airNose(next);
  next = { ...next, nose, yaw: yawOf(nose, body.yaw) };

  // Swept feet segment: landings (and walls met at the feet).
  const seg = sub3(p1, p0);
  const segLen = len3(seg);
  const hit = segLen > 1e-9 ? env.collision.raycast(p0, seg, segLen) : null;
  if (hit && hit.front !== false) {
    const contact = contactOf(hit);
    if (isCeiling(contact.normal)) {
      // The feet met an underside (a full-pipe overhang, a deck edge from below): never a landing
      // upside down. Drop the speed into it and stay in the air (REQ-CTL-22, as for the sphere).
      if (dot3(v, contact.normal) < 0) v = sub3(v, scale3(contact.normal, dot3(v, contact.normal)));
      p1 = p0;
    } else if (contact.flags.wall) {
      const r = wallResponse(v, contact.normal, events);
      v = r.vel;
      p1 = r.blocked ? p0 : addScaled(p0, v, dt);
    } else {
      return land(turnWithWall(next, body.vel, v), contact, v, events);
    }
  }

  // The collision sphere (REQ-CTL-22): walls and ceilings; floors are left to the feet segment.
  // A downward-facing contact (normal or push direction) is a ceiling, checked before the wall
  // class: classifySurface calls every face steeper than 80 deg a wall, undersides included, and an
  // early pop past a coping corner read the deck underside as a head-on wall.
  const centre = addScaled(p1, up, TUNING.AIR_SPHERE_UP_M);
  const prePush = p1;
  let wallDone = false;
  for (const c of env.collision.sphereContacts(centre, TUNING.SKATER_RADIUS_M)) {
    const flags = classifySurface(c.normal, c.tag);
    const push = normOr(sub3(centre, c.point), c.normal);
    const depth = TUNING.SKATER_RADIUS_M - c.distance;
    if (isCeiling(push) || isCeiling(c.normal)) {
      // Ceiling: push out and drop the upward part.
      p1 = addScaled(p1, push, Math.max(0, depth));
      if (dot3(v, push) < 0) v = sub3(v, scale3(push, dot3(v, push)));
    } else if (flags.wall && !wallDone) {
      wallDone = true;
      if (dot3(v, c.normal) < 0) {
        const r = wallResponse(v, c.normal, events);
        v = r.vel;
      }
      p1 = addScaled(p1, push, Math.max(0, depth));
    }
  }
  // A push never carries the feet through a floor: the pushed path meeting one is a landing on it.
  const pushed = sub3(p1, prePush);
  const pushLen = len3(pushed);
  if (pushLen > 1e-9) {
    const floor = env.collision.raycast(prePush, pushed, pushLen);
    if (floor && floor.front !== false) {
      const contact = contactOf(floor);
      if (!contact.flags.wall && !isCeiling(contact.normal)) return land(turnWithWall(next, body.vel, v), contact, v, events);
    }
  }
  return { body: { ...turnWithWall(next, body.vel, v), pos: plain(p1), vel: plain(v) }, events };
}

/**
 * Founder playtest 2 (CR-65): a collision that redirects an air (a wall, an edge, a push-out) turns
 * the skater with it. Gravity never changes the horizontal heading, so any heading change between
 * the start and end of an air tick came from a contact; the launch basis nose0 (the reference for
 * spin and landing off-axis) rotates by it, and a bounced skater lands along his new travel.
 */
function turnWithWall(body: BodyState, before: Vec3, after: Vec3): BodyState {
  const h0 = horizontal(before);
  const h1 = horizontal(after);
  if (!body.launch || len3(h0) < 1e-3 || len3(h1) < 1e-3) return body;
  const turn = signedAngleAbout(h0, h1, UP);
  if (Math.abs(turn) < 1e-6) return body;
  const launch = { ...body.launch, nose0: plain(rotateAbout(body.launch.nose0, UP, turn)) };
  const turned: BodyState = { ...body, launch };
  const nose = airNose(turned);
  return { ...turned, nose, yaw: yawOf(nose, body.yaw) };
}

function land(body: BodyState, contact: SurfaceContact, vel: Vec3, events: Events): ControllerStep {
  const n = contact.normal;
  const nose = airNose(body);
  const oa = landingOffAxis(nose, vel, n, body.launch?.nose0);
  const tiltDeg = angleDeg(body.up, n);
  const tangent = projectOnPlane(vel, n);
  // Founder playtest (DESIGN L CR-43): a slow landing has no travel direction worth judging (a
  // crouch that rolled back on a bank turned the velocity under a still nose), so with less than
  // SIM_LAND_SLOW_MPS of horizontal speed only the player's own spin counts as off-axis.
  const spun = Math.abs(body.airYawDeg) % 180;
  const offAxisDeg = Math.hypot(vel.x, vel.z) < TUNING.SIM_LAND_SLOW_MPS ? Math.min(oa.offAxisDeg, Math.min(spun, 180 - spun)) : oa.offAxisDeg;
  // Arcade landing into a rising transition face (polish round 2, CHANGE-REQUEST filed): projecting
  // the whole velocity lets the fall cancel the travel, so a hop INTO a face that rises ahead (the
  // fountain foot after an R1 hop) came out at 0.5 m/s. On a face that rises along the horizontal
  // travel, the fall is absorbed by the landing and only the horizontal travel is projected onto the
  // face (its speed x cos slope, so a steep face still keeps little and no hop becomes a vert air).
  // Landings coming back down a face (vert airs) move against the rise and keep the C.6 projection.
  const hVel = { x: vel.x, y: 0, z: vel.z };
  const rising = contact.flags.tag === 'transition' && len3(hVel) >= TUNING.SIM_LAND_SLOW_MPS && dot3(hVel, projectOnPlane(UP, n)) > 0;
  const hTan = rising ? projectOnPlane(hVel, n) : null;
  const arcade = hTan !== null && len3(hTan) > len3(tangent);
  const kept = arcade && hTan ? hTan : tangent;
  const speed = len3(kept) * TUNING.LAND_SPEED_RETAIN;
  const dir = len3(kept) > 1e-6 ? norm3(kept) : oa.travel;
  const fakie = arcade ? dot3(projectOnPlane(nose, n), dir) < 0 : oa.unfoldedDeg > 90;
  const physNose = fakie ? scale3(dir, -1) : dir;
  const noseP = normOr(projectOnPlane(nose, n), physNose);
  // Visual residual of the yaw snap to the nearest 180 (REQ-CTL-07): from the aligned nose back to the air nose.
  const yawSnapDeg = signedAngleAbout(physNose, noseP, n) * RAD;
  events.push({ kind: 'contact', contact, offAxisDeg, tiltDeg, speed, airYawDeg: body.airYawDeg });
  return {
    body: {
      ...body, pos: contact.point, vel: plain(scale3(dir, speed)), up: n, surface: contact, nose: plain(physNose),
      yaw: yawOf(physNose, body.yaw), fakie, airYawDeg: 0, quickSpinDeg: 0, yawSnapDeg, pivotTicks: 0, pushTick: null,
      grind: null,
    },
    events,
  };
}

// ---------------------------------------------------------------------------------------------
// Grind, lip, bail
// ---------------------------------------------------------------------------------------------

/** Board height above the rail line (REQ-GRD-03). */
export function boardOn(point: Vec3): Vec3 {
  return { x: point.x, y: point.y + TUNING.BOARD_THICKNESS_M, z: point.z };
}

/** REQ-GRD-05 hop arc: y(u) = a u - b u^2 through (1, dy) with its peak at hopM above the start. */
export function hopArc(u: number, dy: number, hopM: number): number {
  if (hopM <= 0) return dy * u;
  const h = Math.max(hopM, dy + 1e-6, 1e-6);
  const a = 2 * h + 2 * Math.sqrt(Math.max(0, h * h - h * dy));
  const b = a - dy;
  return a * u - b * u * u;
}

function stepGrindMode(body: BodyState, env: ControllerEnv): ControllerStep {
  const events: Events = [];
  const motion = body.grind;
  if (!motion) return { body, events };
  const step = stepGrind(motion, env.rails, env.dtS);
  const target = boardOn(step.point);
  let pos = target;
  let snap = body.snap;
  if (snap) {
    const u = Math.min(1, (env.tick - snap.tick0 + 1) / Math.max(1, snap.ticks));
    const dy = target.y - snap.from.y;
    pos = {
      x: snap.from.x + (target.x - snap.from.x) * u,
      y: snap.from.y + hopArc(u, dy, snap.hopM),
      z: snap.from.z + (target.z - snap.from.z) * u,
    };
    if (u >= 1) snap = null;
  }
  let vel = scale3(step.tangent, step.motion.speed);
  let nose = dot3(body.nose, step.tangent) >= 0 ? step.tangent : scale3(step.tangent, -1);
  let motionOut = step.motion;
  // Walls along the rail (rows 22b / 22c): the world clamps the speed on a glance. The ray starts
  // at the board on the rail, not the blended body position: during a ground-snap hop the body is
  // still at floor height and would read the ledge's own end face as a wall.
  const wall = wallCheck(target, UP, vel, env, events);
  if (wall.blocked) {
    vel = { x: 0, y: 0, z: 0 };
    motionOut = { ...motion, speed: 0 };
    pos = body.pos;
  }
  if (step.event === 'railEnd') events.push({ kind: 'railEnd', corner: false });
  else if (step.event === 'corner') events.push({ kind: 'railEnd', corner: true });
  else if (step.event === 'stall') events.push({ kind: 'stall' });
  nose = normOr(nose, body.nose);
  // Riding the rail backward keeps its fakie flag (the nose against the travel tangent).
  const fakie = dot3(nose, step.tangent) < 0;
  return {
    body: { ...body, pos: plain(pos), vel: plain(vel), grind: motionOut, nose: plain(nose), yaw: yawOf(nose, body.yaw), up: UP, snap, surface: null, fakie },
    events,
  };
}

/** Advance one tick in `mode`. */
export function stepController(body: BodyState, mode: MovementMode, intent: ControlIntent, env: ControllerEnv): ControllerStep {
  switch (mode) {
    case 'ground':
      if (!body.surface) return stepAir(body, intent, env, false);
      return stepGround(body, intent, env, { push: true, brake: true, friction: TUNING.ROLL_FRICTION, frictionOnTransitions: false, turnDps: groundTurn, pump: true });
    case 'crouch':
      if (!body.surface) return stepAir(body, intent, env, false);
      // Holding ollie keeps rolling and pushing (THPS1, CR-65): charging never costs speed.
      return stepGround(body, intent, env, { push: true, brake: false, friction: TUNING.ROLL_FRICTION, frictionOnTransitions: false, turnDps: groundTurn, pump: false });
    case 'manual':
      if (!body.surface) return stepAir(body, intent, env, false);
      return stepGround(body, intent, env, { push: false, brake: false, friction: TUNING.MANUAL_FRICTION, frictionOnTransitions: true, turnDps: () => TUNING.TURN_RATE_MANUAL_DPS, pump: false });
    case 'air':
      return stepAir(body, intent, env, true);
    case 'grind':
      return stepGrindMode(body, env);
    case 'lip':
      return { body: { ...body, vel: { x: 0, y: 0, z: 0 } }, events: [] };
    case 'bail':
      if (!body.surface) return stepAir(body, { ...intent, steer: 0, quickSpins: 0, spinHeld: 0 }, env, false);
      return stepGround(body, { ...intent, steer: 0, throttle: 0, pump: false }, env, { push: false, brake: false, friction: TUNING.SIM_BAIL_FRICTION, frictionOnTransitions: true, turnDps: () => 0, pump: false });
    case 'getup':
      if (!body.surface) return stepAir(body, { ...intent, steer: 0, quickSpins: 0, spinHeld: 0 }, env, false);
      return { body: { ...body, vel: { x: 0, y: 0, z: 0 } }, events: [] };
    case 'frozen':
      return { body, events: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// Effects the world applies on transitions
// ---------------------------------------------------------------------------------------------

/** Ollie / pop with charge in [0, 1] (REQ-CTL-05, REQ-VRT-02, REQ-VRT-10). */
export function applyPop(body: BodyState, charge: number, env: ControllerEnv): BodyState {
  const vPopFull = Math.sqrt(2 * TUNING.GRAVITY * popHeight(charge, env.stance));
  if (body.surface) {
    // Pop off a surface: p = normalize(blend x n + (1 - blend) x up); x VERT_POP_SCALE on slopes >= SIM_VERT_POP_MIN_SLOPE_DEG.
    const s = body.surface;
    const p = norm3(add3(scale3(s.normal, TUNING.POP_UP_BLEND), scale3(UP, 1 - TUNING.POP_UP_BLEND)));
    const vPop = s.flags.slopeDeg >= TUNING.SIM_VERT_POP_MIN_SLOPE_DEG ? vPopFull * TUNING.VERT_POP_SCALE : vPopFull;
    const v0 = addScaled(body.vel, p, vPop);
    const { vel, launch } = launchFrom(body, s, v0, env);
    return airborne(body, body.pos, vel, launch, s.normal);
  }
  if (body.grind) {
    const launch: LaunchInfo = {
      tick: env.tick, pos: plain(body.pos), surfaceId: body.grind.railId, normal: UP, slopeDeg: 0, assisted: false,
      nose0: plain(body.nose), transition: false,
    };
    return airborne(body, body.pos, addScaled(body.vel, UP, vPopFull), launch, UP);
  }
  // Coyote pop in the air (P8b / row 37b), from the last contact.
  const launch = body.launch;
  if (launch && launch.assisted && !body.transferred) {
    // REQ-VRT-10: p = up after a steep transition, then the assist clamp again. The upward part is
    // the on-face pop's (the up component of the blended pop direction off the launch face), so
    // releasing Cross just before or just after the lip gives the same height.
    const vPop = launch.slopeDeg >= TUNING.SIM_VERT_POP_MIN_SLOPE_DEG ? vPopFull * TUNING.VERT_POP_SCALE : vPopFull;
    const onFace = norm3(add3(scale3(launch.normal, TUNING.POP_UP_BLEND), scale3(UP, 1 - TUNING.POP_UP_BLEND)));
    const v = assistClamp(addScaled(body.vel, UP, vPop * onFace.y), launch.normal, null);
    return { ...body, vel: plain(v) };
  }
  const n = launch?.normal ?? UP;
  const p = norm3(add3(scale3(n, TUNING.POP_UP_BLEND), scale3(UP, 1 - TUNING.POP_UP_BLEND)));
  const vPop = (launch?.slopeDeg ?? 0) >= TUNING.SIM_VERT_POP_MIN_SLOPE_DEG ? vPopFull * TUNING.VERT_POP_SCALE : vPopFull;
  return { ...body, vel: plain(addScaled(body.vel, p, vPop)) };
}

/** Revert pivot: yaw 180, speed x REVERT_SPEED_RETAIN, fakie recomputed (REQ-REV-04). */
export function applyRevertPivot(body: BodyState): BodyState {
  const nose = scale3(body.nose, -1);
  const vel = scale3(body.vel, TUNING.REVERT_SPEED_RETAIN);
  const fakie = len3(vel) > 1e-3 ? dot3(nose, vel) < 0 : !body.fakie;
  return { ...body, nose: plain(nose), vel: plain(vel), yaw: yawOf(nose, body.yaw + Math.PI), fakie, yawSnapDeg: 0 };
}

/** Spine transfer mirror across the rail's transfer plane (REQ-VRT-08). */
export function applySpineTransfer(body: BodyState, plane: { readonly axis: 'x' | 'z'; readonly at: number }): BodyState {
  const ax = plane.axis;
  const off = (p: Vec3): number => (ax === 'x' ? p.x : p.z) - plane.at;
  // launchSide: the launch position's side when it is clearly off the plane; a launch ON the plane
  // (a carve up the vert wall leaves at the coping itself, x 84.00) reads the side the launch face
  // looks toward instead, since a +0 / +epsilon offset pointed "outward on the far side" back at the ramp.
  const launchPos = body.launch?.pos ?? body.pos;
  const launchN = body.launch?.normal;
  const nPerp = launchN ? (ax === 'x' ? launchN.x : launchN.z) : 0;
  const launchOff = off(launchPos);
  const launchSide = Math.abs(launchOff) > TUNING.SIM_TRANSFER_SIDE_EPS_M
    ? Math.sign(launchOff)
    : Math.abs(nPerp) >= TUNING.SIM_LIP_LAUNCH_HORIZ_MIN ? Math.sign(nPerp) : Math.sign(launchOff) || Math.sign(off(body.pos)) || 1;
  const d = off(body.pos);
  let pos = body.pos;
  let vel = body.vel;
  const mirrorAxis = (v: Vec3): Vec3 => (ax === 'x' ? { x: -v.x, y: v.y, z: v.z } : { x: v.x, y: v.y, z: -v.z });
  if (Math.sign(d) === launchSide || d === 0) {
    pos = ax === 'x' ? { ...pos, x: plane.at - d } : { ...pos, z: plane.at - d };
    vel = mirrorAxis(vel);
  }
  // Outward on the far side (-launchSide), at least SPINE_TRANSFER_PUSH_MPS.
  const perp = ax === 'x' ? vel.x : vel.z;
  const want = -launchSide * Math.max(Math.abs(perp), TUNING.SPINE_TRANSFER_PUSH_MPS);
  vel = ax === 'x' ? { ...vel, x: want } : { ...vel, z: want };
  // Basis: up mirrored onto the far face; nose0 turned 180 about the rail axis so a straight air lands forward.
  const rot180 = (v: Vec3): Vec3 => (ax === 'x' ? { x: -v.x, y: -v.y, z: v.z } : { x: v.x, y: -v.y, z: -v.z });
  const up = mirrorAxis(body.up);
  const launch = body.launch
    ? { ...body.launch, nose0: plain(rot180(body.launch.nose0)), normal: plain(mirrorAxis(body.launch.normal)) }
    : null;
  const next: BodyState = { ...body, pos: plain(pos), vel: plain(vel), up: plain(up), launch, transferred: true, predictTick: -1_000_000 };
  const nose = airNose(next);
  return { ...next, nose, yaw: yawOf(nose, body.yaw) };
}
