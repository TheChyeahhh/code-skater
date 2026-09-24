/**
 * src/render/camera.ts (fx track): the chase camera (REQ-CAM-01..07). CAM_BACK_M behind, CAM_UP_M up,
 * looking at camera.lookAhead, critically damped springs (CAM_OMEGA); vert air pulls back and up
 * (CAM_VERT_*) and drops the look point toward the coping; right stick / mouse orbit with
 * CAM_ORBIT_RETURN_S spring-back; FOV CAM_FOV_DEG + CAM_FOV_KICK_DEG ramping in from
 * CAM_FOV_KICK_SPEED; collision via the injected raycast (CAM_COLLIDE_PAD_M, CAM_MIN_BOOM_M,
 * CAM_MIN_BOOM_RISE) with a boom that shortens at once and lengthens slowly; bail shake CAM_SHAKE_BAIL_*
 * as noise-driven rotation plus a positional wobble; a small dip on every landing. Never first person.
 * Reads the interpolated snapshot only.
 *
 * Spring space: the springs run in SKATER-RELATIVE space, never on world points. An anchor follows the
 * skater rigidly in x / z (springing it would settle 2v / omega behind a moving skater: 1.5 m at 6 m/s,
 * which cancels the look-ahead exactly at speed) and springs only in y. Around the anchor the boom's
 * yaw, length, height and side offset are sprung scalars and the look offset a sprung vector, so a
 * skater at constant speed is framed exactly as at rest.
 *
 * Order of one update(): orbit -> goals (heading, grind / bail / vert framing) -> springs on the
 * offsets -> collision on the sprung position (so a lagging spring can never sit inside a wall) ->
 * positional shake and land kick -> FOV -> lookAt -> rotational shake. Every tunable is read live.
 * No allocation per frame: the temps below are reused.
 */

import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from 'three';
import type { SimEvent } from '../core/events';
import { DEG } from '../core/math';
import { TUNING } from '../core/tuning';
import type { SimSnapshot, Vec3 } from '../core/types';
import type { CameraLookInput, CameraRaycast, CameraRig } from './types';

/** Read-only view of the rig's internals for tests and the dev harness. */
export interface CameraRigDebug {
  /** Orbit offset the stick / mouse added, degrees (0 when resting behind the skater). */
  readonly orbitYawDeg: number;
  readonly orbitPitchDeg: number;
  /** 0 = normal framing, 1 = full vert-air pull-back (REQ-CAM-02). */
  readonly vertBlend: number;
  /** Boom distance and height used for the desired position this frame. */
  readonly backM: number;
  readonly upM: number;
  /** Boom length after collision, metres from the pivot (REQ-CAM-05). */
  readonly boomM: number;
  /** Metres the collision took off the boom this frame (after the slow lengthening). */
  readonly boomCutM: number;
  /** Extra rise added when the boom hit its floor (REQ-CAM-05). */
  readonly riseM: number;
  /** True when the collision ray shortened the boom this frame. */
  readonly collided: boolean;
  /** True while the boom holds its open-side yaw after a vert re-entry (REQ-CAM-02). */
  readonly holdingYaw: boolean;
  readonly fovDeg: number;
  /** Shake offset magnitude this frame, metres (REQ-CAM-06). */
  readonly shakeM: number;
  /** Shake rotation magnitude this frame, degrees (REQ-CAM-06). */
  readonly shakeRotDeg: number;
  /** Bail trauma in [0, 1], 0 when no shake runs. */
  readonly trauma: number;
  /** Landing kick offset this frame, metres (positive = the camera dipped). */
  readonly landKickM: number;
  /** The sprung (unclamped) camera goal. */
  readonly sprungPos: Vec3;
  readonly target: Vec3;
}

export interface CameraRigRuntime extends CameraRig {
  readonly debug: CameraRigDebug;
}

/**
 * Critically damped spring step in closed form (stable for any dt, never overshoots from rest):
 * x(t) = (x0 + (v0 + w x0) t) e^{-wt}. Writes the new value into `pos`, the new velocity into `vel`.
 */
function springStep(pos: Vector3, vel: Vector3, goal: Vector3, omega: number, dt: number, tmp: Vector3): void {
  const e = Math.exp(-omega * dt);
  // tmp = displacement from the goal
  tmp.subVectors(pos, goal);
  const cx = vel.x + omega * tmp.x;
  const cy = vel.y + omega * tmp.y;
  const cz = vel.z + omega * tmp.z;
  pos.x = goal.x + (tmp.x + cx * dt) * e;
  pos.y = goal.y + (tmp.y + cy * dt) * e;
  pos.z = goal.z + (tmp.z + cz * dt) * e;
  vel.x = (vel.x - cx * omega * dt) * e;
  vel.y = (vel.y - cy * omega * dt) * e;
  vel.z = (vel.z - cz * omega * dt) * e;
}

/** Scalar critically damped spring toward 0; returns the new value and writes the velocity through the box. */
function springScalarToZero(x: number, v: { v: number }, omega: number, dt: number): number {
  const e = Math.exp(-omega * dt);
  const c = v.v + omega * x;
  v.v = (v.v - c * omega * dt) * e;
  return (x + c * dt) * e;
}

/** A sprung scalar: value plus velocity, stepped toward a goal. */
class Spring1 {
  x = 0;
  private readonly vel = { v: 0 };
  step(goal: number, omega: number, dt: number): number {
    this.x = goal + springScalarToZero(this.x - goal, this.vel, omega, dt);
    return this.x;
  }
  set(x: number): void {
    this.x = x;
    this.vel.v = 0;
  }
}

/** Wrap an angle to (-PI, PI]. */
function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Deterministic hash in [0, 1) for the shake noise lattice. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 1D value noise in [-1, 1]: a hash lattice with smoothstep interpolation, so the shake is a band
 * limited wobble at the lattice rate instead of a sine that aliases at 60 fps. `seed` separates the
 * axes. The lattice point 0 of every axis is pinned to a full swing so the first frame after a bail
 * is the hardest hit (impact first, wobble after).
 */
function valueNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = i === 0 ? (seed % 2 === 0 ? 1 : -1) : hash01(i + seed * 57.3) * 2 - 1;
  const b = hash01(i + 1 + seed * 57.3) * 2 - 1;
  return a + (b - a) * u;
}

const UP = new Vector3(0, 1, 0);

/** raycast = null disables camera collision (harnesses). */
export function createCameraRig(raycast: CameraRaycast | null): CameraRigRuntime {
  const camera = new PerspectiveCamera(TUNING.CAM_FOV_DEG, 16 / 9, 0.05, 500);

  // Sprung boom (skater relative): world yaw of the "behind" direction, length, height, side offset.
  const yawS = new Spring1();
  const backS = new Spring1();
  const upS = new Spring1();
  const sideS = new Spring1();
  const anchorYS = new Spring1();
  // Sprung look offset from the skater's feet.
  const tgtOff = new Vector3();
  const tgtOffVel = new Vector3();
  // Goals computed this frame.
  let goalYaw = 0;
  let goalBack = 0;
  let goalUp = 0;
  let goalSide = 0;
  const goalTgtOff = new Vector3();
  const heading = new Vector3(0, 0, -1);
  const frozenHeading = new Vector3(0, 0, -1);
  const behind = new Vector3();
  const side = new Vector3();
  const pos = new Vector3();
  const target = new Vector3();
  const pivot = new Vector3();
  const boomDir = new Vector3();
  const finalPos = new Vector3();
  const tmp = new Vector3();
  const rayOrigin: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  const rayDir: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  let orbitYaw = 0; // radians
  let orbitPitch = 0; // radians
  const orbitYawVel = { v: 0 };
  const orbitPitchVel = { v: 0 };
  let orbitReturnLeft = 0; // seconds until the orbit springs back
  let vertBlend = 0;
  let fov = TUNING.CAM_FOV_DEG;
  let shakeT = -1; // seconds since the bail; < 0 = no shake
  let kickT = -1; // seconds since the landing; < 0 = no kick
  let headingFrozen = false;
  // Vert re-entry yaw hold (REQ-CAM-02): seconds left (<= 0 = off) and the held heading yaw.
  let holdLeft = 0;
  let heldYaw = 0;
  let wasVertAir = false;
  let boomM = 0;
  let riseM = 0;
  let collided = false;
  let backM = 0;
  let upM = 0;
  let shakeM = 0;
  let shakeYaw = 0;
  let shakePitch = 0;
  let shakeRoll = 0;
  let trauma = 0;
  let landKickM = 0;
  // Collision smoothing: the cut and the rise grow at once and shrink at FXCAM_BOOM_RETURN_OMEGA
  // (FXCAM_BOOM_CLEAR_OMEGA once the ray is clear).
  const cutS = new Spring1();
  const riseS = new Spring1();
  let lastAspect = camera.aspect;
  let lastFov = fov;
  let snapped = false;

  function readHeading(snapshot: SimSnapshot): void {
    const k = snapshot.skater;
    const bailing = k.state === 'Bail' || k.state === 'GetUp';
    if (bailing) {
      if (!headingFrozen) {
        frozenHeading.copy(heading);
        headingFrozen = true;
      }
      heading.copy(frozenHeading);
      return;
    }
    headingFrozen = false;
    // Grind framing: sit behind the direction of travel along the rail.
    const h = k.grind ? k.grind.tangent : snapshot.camera.heading;
    heading.set(h.x, 0, h.z);
    if (heading.lengthSq() < 1e-6) heading.set(k.forward.x, 0, k.forward.z);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1);
    heading.normalize();
  }

  /**
   * REQ-CAM-02 re-entry: a vert air comes back down the wall it launched from, so the heading flips
   * and "behind" points straight into that ramp. Swinging there dragged the boom round side-on and
   * the collision cut it to about 2 m for half a second. Instead the boom holds its open-side yaw (in
   * front of the skater, the way it framed the air) until the boom behind would be clear of the
   * ramp, then swings round. Ends early on the next air, a grind or a bail, and after
   * FXCAM_VERT_HOLD_MAX_S at the latest.
   */
  function updateVertHold(snapshot: SimSnapshot, baseYaw: number, busy: boolean, dt: number): void {
    const vertNow = snapshot.camera.vertAir;
    if (wasVertAir && !vertNow && !busy && TUNING.FXCAM_VERT_HOLD_MAX_S > 0
      && Math.abs(wrapAngle(baseYaw - yawS.x)) > TUNING.FXCAM_VERT_HOLD_MIN_DEG * DEG) {
      holdLeft = TUNING.FXCAM_VERT_HOLD_MAX_S;
      heldYaw = wrapAngle(yawS.x - orbitYaw);
    }
    wasVertAir = vertNow;
    if (holdLeft <= 0) return;
    holdLeft -= dt;
    if (busy || vertNow || snapshot.skater.state === 'Air' || behindClear(snapshot, baseYaw)) holdLeft = 0;
  }

  /** True when the un-held boom (straight behind the heading) would keep FXCAM_VERT_HOLD_CLEAR of its length. */
  function behindClear(snapshot: SimSnapshot, baseYaw: number): boolean {
    if (!raycast) return true;
    const k = snapshot.skater;
    const x = Math.sin(baseYaw) * backM;
    const y = anchorYS.x - k.pos.y + upM - TUNING.FXCAM_PIVOT_UP_M;
    const z = Math.cos(baseYaw) * backM;
    const want = Math.hypot(x, y, z);
    if (want < 1e-6) return true;
    rayOrigin.x = k.pos.x;
    rayOrigin.y = k.pos.y + TUNING.FXCAM_PIVOT_UP_M;
    rayOrigin.z = k.pos.z;
    rayDir.x = x / want;
    rayDir.y = y / want;
    rayDir.z = z / want;
    const hit = raycast(rayOrigin, rayDir, want);
    return hit === null || hit - TUNING.CAM_COLLIDE_PAD_M >= want * TUNING.FXCAM_VERT_HOLD_CLEAR;
  }

  /** Desired boom and look offset for this frame, skater relative (before springs and collision). */
  function computeGoals(snapshot: SimSnapshot, dt: number): void {
    const k = snapshot.skater;
    readHeading(snapshot);
    // REQ-CAM-02: vert air pull-back blends in over CAM_VERT_BLEND_S and back on landing.
    const vertGoal = snapshot.camera.vertAir ? 1 : 0;
    const blendRate = dt / Math.max(1e-3, TUNING.CAM_VERT_BLEND_S);
    vertBlend += Math.max(-blendRate, Math.min(blendRate, vertGoal - vertBlend));
    backM = TUNING.CAM_BACK_M + vertBlend * TUNING.CAM_VERT_BACK_EXTRA_M;
    upM = TUNING.CAM_UP_M + vertBlend * TUNING.CAM_VERT_UP_EXTRA_M;
    const grinding = k.state === 'Grind' && k.grind !== null;
    const bailing = k.state === 'Bail' || k.state === 'GetUp';
    if (grinding) upM *= TUNING.FXCAM_GRIND_UP_SCALE;
    if (bailing) backM += TUNING.FXCAM_BAIL_BACK_EXTRA_M;

    // Behind direction = -heading; the boom yaw is its world angle plus the orbit yaw about +y.
    behind.copy(heading).negate();
    const baseYaw = Math.atan2(behind.x, behind.z);
    updateVertHold(snapshot, baseYaw, grinding || bailing, dt);
    goalYaw = wrapAngle((holdLeft > 0 ? heldYaw : baseYaw) + orbitYaw);
    goalBack = backM;
    goalUp = upM;
    goalSide = grinding ? TUNING.FXCAM_GRIND_SIDE_M : 0;

    // Look target: the sim's look-ahead point lifted to the torso. In vert air the sim's point follows
    // a near-vertical velocity and would tilt the camera at the sky, so the look point is rebuilt from
    // the horizontal heading, dropped toward the coping and biased against the ramp normal.
    // An orbit is for looking at the skater: as the camera swings to the side and round the front, the
    // look-ahead offset shrinks to zero (else a camera in front would look past the skater at a point
    // behind itself). The vert re-entry hold counts as the same kind of offset: a held boom in front
    // of the skater looks at the skater.
    const la = snapshot.camera.lookAhead;
    const ahead = Math.max(0, Math.cos(wrapAngle(goalYaw - baseYaw)));
    if (bailing) goalTgtOff.set(0, TUNING.FXCAM_TARGET_UP_M, 0);
    else goalTgtOff.set((la.x - k.pos.x) * ahead, la.y - k.pos.y + TUNING.FXCAM_TARGET_UP_M, (la.z - k.pos.z) * ahead);
    if (vertBlend > 0 && !bailing) {
      const n = snapshot.camera.rampNormal;
      tmp.copy(heading).multiplyScalar(TUNING.CAM_LOOKAHEAD_M * ahead);
      tmp.y = TUNING.FXCAM_TARGET_UP_M - vertBlend * TUNING.FXCAM_VERT_LOOK_DROP_M;
      if (n) {
        tmp.x -= n.x * TUNING.FXCAM_VERT_RAMP_BIAS_M * vertBlend;
        tmp.z -= n.z * TUNING.FXCAM_VERT_RAMP_BIAS_M * vertBlend;
      }
      goalTgtOff.lerp(tmp, vertBlend);
    }
  }

  function applyOrbit(look: CameraLookInput, dt: number): void {
    const stickX = look.stick.x;
    const stickY = look.stick.y;
    const mx = look.mouseDeltaPx.x;
    const my = look.mouseDeltaPx.y;
    const active = Math.abs(stickX) > 1e-3 || Math.abs(stickY) > 1e-3 || mx !== 0 || my !== 0;
    const pitchMax = TUNING.FXCAM_ORBIT_PITCH_MAX_DEG * DEG;
    if (active) {
      const rate = TUNING.CAM_ORBIT_RATE_DPS * DEG;
      // Stick right / mouse right orbits the camera to the skater's right (camera moves clockwise seen from above).
      orbitYaw -= stickX * rate * dt;
      orbitPitch += stickY * rate * 0.6 * dt;
      orbitYaw -= mx * TUNING.CAM_MOUSE_DEG_PER_PX * DEG;
      orbitPitch -= my * TUNING.CAM_MOUSE_DEG_PER_PX * DEG;
      orbitYawVel.v = 0;
      orbitPitchVel.v = 0;
      orbitReturnLeft = TUNING.CAM_ORBIT_RETURN_S;
    } else if (orbitReturnLeft > 0) {
      orbitReturnLeft -= dt;
    } else {
      const w = TUNING.FXCAM_ORBIT_RETURN_OMEGA;
      orbitYaw = springScalarToZero(orbitYaw, orbitYawVel, w, dt);
      orbitPitch = springScalarToZero(orbitPitch, orbitPitchVel, w, dt);
      if (Math.abs(orbitYaw) < 1e-5) orbitYaw = 0;
      if (Math.abs(orbitPitch) < 1e-5) orbitPitch = 0;
    }
    // Keep yaw in (-PI, PI] so a long spin springs back the short way.
    orbitYaw = wrapAngle(orbitYaw);
    if (orbitPitch > pitchMax) orbitPitch = pitchMax;
    else if (orbitPitch < -pitchMax) orbitPitch = -pitchMax;
  }

  /** Step the offset springs and build the sprung camera position and look target. */
  function springOffsets(snapshot: SimSnapshot, dt: number, snap: boolean): void {
    const k = snapshot.skater;
    const w = TUNING.CAM_OMEGA;
    if (snap) {
      yawS.set(goalYaw);
      backS.set(goalBack);
      upS.set(goalUp);
      sideS.set(goalSide);
      anchorYS.set(k.pos.y);
      tgtOff.copy(goalTgtOff);
      tgtOffVel.set(0, 0, 0);
    } else {
      // Yaw springs the short way round.
      yawS.x = goalYaw + wrapAngle(yawS.x - goalYaw);
      yawS.step(goalYaw, w, dt);
      backS.step(goalBack, w, dt);
      upS.step(goalUp, w, dt);
      sideS.step(goalSide, w, dt);
      anchorYS.step(k.pos.y, TUNING.FXCAM_ANCHOR_Y_OMEGA, dt);
      springStep(tgtOff, tgtOffVel, goalTgtOff, w, dt, tmp);
    }
    const yaw = yawS.x;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const cosP = Math.cos(orbitPitch);
    const sinP = Math.sin(orbitPitch);
    const h = backS.x * cosP;
    // Right of travel in the boom frame: (cos yaw, 0, -sin yaw) (heading north -> +x, east).
    pos.set(k.pos.x + sy * h + cy * sideS.x, anchorYS.x + upS.x + backS.x * sinP, k.pos.z + cy * h - sy * sideS.x);
    target.set(k.pos.x + tgtOff.x, k.pos.y + tgtOff.y, k.pos.z + tgtOff.z);
  }

  /**
   * REQ-CAM-05: shorten the boom from the pivot to `from`, writing the safe position into `out`. The
   * cut and the rise apply at once when they grow and ease back at FXCAM_BOOM_RETURN_OMEGA when the
   * hit goes away, so passing a pillar never pops the camera a metre forward and back in one frame.
   */
  function collide(snapshot: SimSnapshot, from: Vector3, out: Vector3, dt: number, snap: boolean): void {
    const k = snapshot.skater;
    pivot.set(k.pos.x, k.pos.y + TUNING.FXCAM_PIVOT_UP_M, k.pos.z);
    boomDir.subVectors(from, pivot);
    const want = boomDir.length();
    collided = false;
    if (want < 1e-6) {
      boomM = 0;
      riseM = 0;
      out.copy(from);
      return;
    }
    boomDir.multiplyScalar(1 / want);
    const minBoom = TUNING.CAM_MIN_BOOM_M;
    let cut = 0;
    let rise = 0;
    if (raycast) {
      rayOrigin.x = pivot.x;
      rayOrigin.y = pivot.y;
      rayOrigin.z = pivot.z;
      rayDir.x = boomDir.x;
      rayDir.y = boomDir.y;
      rayDir.z = boomDir.z;
      const hit = raycast(rayOrigin, rayDir, want);
      if (hit !== null && hit < want) {
        collided = true;
        const shortened = hit - TUNING.CAM_COLLIDE_PAD_M;
        if (shortened >= minBoom) {
          cut = want - shortened;
        } else {
          cut = want - minBoom;
          rise = Math.max(0, minBoom - hit) * TUNING.CAM_MIN_BOOM_RISE;
        }
      }
    }
    // Grow at once, shrink slowly: a partial cut eases back at FXCAM_BOOM_RETURN_OMEGA, a fully
    // clear ray at the faster FXCAM_BOOM_CLEAR_OMEGA.
    const wBack = collided ? TUNING.FXCAM_BOOM_RETURN_OMEGA : TUNING.FXCAM_BOOM_CLEAR_OMEGA;
    if (snap || cut >= cutS.x) cutS.set(cut);
    else cutS.step(cut, wBack, dt);
    if (snap || rise >= riseS.x) riseS.set(rise);
    else riseS.step(rise, wBack, dt);
    // Under 5 mm the tail of the spring is invisible: settle it.
    if (cutS.x < 5e-3) cutS.set(0);
    if (riseS.x < 5e-3) riseS.set(0);
    let boom = want - cutS.x;
    // Never first person: the boom never goes below the floor even without a hit (REQ-CAM-07).
    if (boom < minBoom) boom = minBoom;
    boomM = boom;
    riseM = riseS.x;
    out.copy(pivot).addScaledVector(boomDir, boom);
    if (riseM > 0) {
      if (raycast) {
        rayOrigin.x = out.x;
        rayOrigin.y = out.y;
        rayOrigin.z = out.z;
        rayDir.x = 0;
        rayDir.y = 1;
        rayDir.z = 0;
        const up = raycast(rayOrigin, rayDir, riseM);
        if (up !== null && up < riseM) riseM = Math.max(0, up - TUNING.CAM_COLLIDE_PAD_M);
      }
      out.y += riseM;
    }
  }

  /** Bail shake (positional part, REQ-CAM-06) and the landing kick, applied to the world position. */
  function applyShake(dt: number, out: Vector3): void {
    shakeM = 0;
    shakeYaw = 0;
    shakePitch = 0;
    shakeRoll = 0;
    trauma = 0;
    landKickM = 0;
    if (kickT >= 0) {
      kickT += dt;
      const len = Math.max(1e-3, TUNING.FXCAM_LAND_KICK_S);
      if (kickT >= len) kickT = -1;
      else {
        landKickM = TUNING.FXCAM_LAND_KICK_M * Math.sin((kickT / len) * Math.PI);
        out.y -= landKickM;
      }
    }
    if (shakeT < 0) return;
    shakeT += dt;
    const len = Math.max(1e-3, TUNING.CAM_SHAKE_BAIL_S);
    if (shakeT >= len) {
      shakeT = -1;
      return;
    }
    trauma = 1 - shakeT / len;
    const t2 = trauma * trauma;
    const nt = shakeT * TUNING.FXCAM_SHAKE_NOISE_HZ;
    const amp = TUNING.CAM_SHAKE_BAIL_AMP_M * t2;
    const dx = valueNoise(nt, 1) * amp;
    const dy = valueNoise(nt, 2) * amp * 0.7;
    // Shake sideways and up in camera space: side = cross(up, boomDir).
    side.crossVectors(UP, boomDir);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    else side.normalize();
    out.addScaledVector(side, dx);
    out.y += dy;
    shakeM = Math.hypot(dx, dy);
    shakeYaw = valueNoise(nt, 3) * TUNING.FXCAM_SHAKE_YAW_DEG * DEG * t2;
    shakePitch = valueNoise(nt, 4) * TUNING.FXCAM_SHAKE_YAW_DEG * DEG * t2;
    shakeRoll = valueNoise(nt, 5) * TUNING.FXCAM_SHAKE_ROLL_DEG * DEG * t2;
  }

  function applyFov(snapshot: SimSnapshot, dt: number): void {
    // REQ-CAM-04: the kick starts at CAM_FOV_KICK_SPEED and is full FXCAM_KICK_RAMP above it (no
    // on / off breathing when the speed dithers around the threshold).
    const goal = TUNING.CAM_FOV_DEG + TUNING.CAM_FOV_KICK_DEG * kickRamp(snapshot.skater.speedRatio);
    const a = 1 - Math.exp(-TUNING.CAM_FOV_LERP * dt);
    fov += (goal - fov) * a;
    if (Math.abs(fov - goal) < 1e-4) fov = goal;
  }

  function commit(): void {
    camera.position.copy(finalPos);
    camera.lookAt(target);
    // Rotational shake after lookAt so the skater jolts with the frame (REQ-CAM-06).
    if (shakeYaw !== 0 || shakePitch !== 0 || shakeRoll !== 0) {
      camera.rotateY(shakeYaw);
      camera.rotateX(shakePitch);
      camera.rotateZ(shakeRoll);
    }
    if (fov !== lastFov || camera.aspect !== lastAspect) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      lastFov = fov;
      lastAspect = camera.aspect;
    }
  }

  const debug: CameraRigDebug = {
    get orbitYawDeg() {
      return orbitYaw / DEG;
    },
    get orbitPitchDeg() {
      return orbitPitch / DEG;
    },
    get vertBlend() {
      return vertBlend;
    },
    get backM() {
      return backM;
    },
    get upM() {
      return upM;
    },
    get boomM() {
      return boomM;
    },
    get boomCutM() {
      return cutS.x;
    },
    get riseM() {
      return riseM;
    },
    get collided() {
      return collided;
    },
    get holdingYaw() {
      return holdLeft > 0;
    },
    get fovDeg() {
      return fov;
    },
    get shakeM() {
      return shakeM;
    },
    get shakeRotDeg() {
      return Math.hypot(shakeYaw, shakePitch, shakeRoll) / DEG;
    },
    get trauma() {
      return trauma;
    },
    get landKickM() {
      return landKickM;
    },
    get sprungPos() {
      return pos;
    },
    get target() {
      return target;
    },
  };

  const rig: CameraRigRuntime = {
    camera,
    debug,
    update(snapshot, look, dtS) {
      const dt = Math.max(0, Math.min(0.1, dtS));
      if (!snapped) rig.snapTo(snapshot);
      applyOrbit(look, dt);
      computeGoals(snapshot, dt);
      springOffsets(snapshot, dt, false);
      collide(snapshot, pos, finalPos, dt, false);
      applyShake(dt, finalPos);
      applyFov(snapshot, dt);
      commit();
    },
    onEvent(e: SimEvent) {
      if (e.type === 'bail') shakeT = 0;
      else if (e.type === 'land') kickT = 0;
      else if (e.type === 'runStart') {
        shakeT = -1;
        kickT = -1;
      }
    },
    snapTo(snapshot) {
      snapped = true;
      orbitYaw = 0;
      orbitPitch = 0;
      orbitYawVel.v = 0;
      orbitPitchVel.v = 0;
      orbitReturnLeft = 0;
      headingFrozen = false;
      holdLeft = 0;
      wasVertAir = snapshot.camera.vertAir;
      vertBlend = snapshot.camera.vertAir ? 1 : 0;
      shakeT = -1;
      kickT = -1;
      fov = TUNING.CAM_FOV_DEG;
      computeGoals(snapshot, 0);
      springOffsets(snapshot, 0, true);
      collide(snapshot, pos, finalPos, 0, true);
      applyShake(0, finalPos);
      commit();
    },
    setAspect(aspect) {
      if (aspect > 0 && Number.isFinite(aspect)) camera.aspect = aspect;
    },
  };
  return rig;
}

/**
 * Ramp in [0, 1] for the FOV kick and the speed lines (REQ-CAM-04): 0 at and below
 * CAM_FOV_KICK_SPEED, 1 from CAM_FOV_KICK_SPEED + FXCAM_KICK_RAMP, smooth between.
 */
export function kickRamp(speedRatio: number): number {
  const lo = TUNING.CAM_FOV_KICK_SPEED;
  const w = Math.max(1e-3, TUNING.FXCAM_KICK_RAMP);
  const u = Math.max(0, Math.min(1, (speedRatio - lo) / w));
  return u * u * (3 - 2 * u);
}

// ---------------------------------------------------------------------------------------------
// Title-screen flythrough path helper (for the render track's createMenuFlythrough, REQ-MNU-01)
// ---------------------------------------------------------------------------------------------

export interface FlythroughPath {
  /** Loop length in seconds (one lap of the closed spline). */
  readonly loopS: number;
  /** Path length in metres. */
  readonly lengthM: number;
  /** Write the camera position and look target at time tS (wraps) into outPos / outTarget. Allocation free. */
  sampleInto(tS: number, outPos: Vector3, outTarget: Vector3): void;
  /** Convenience for tests: plain records of the sample at tS. */
  sample(tS: number): { readonly pos: Vec3; readonly target: Vec3 };
}

/**
 * A closed Catmull-Rom spline through `points`, travelled once per `loopS` seconds at constant arc
 * speed, looking FXCAM_FLY_LOOKAHEAD_M ahead along the path (read live) plus `targetDrop` metres down
 * so the park, not the sky, fills the frame. At least 3 points.
 */
export function createFlythroughPath(points: readonly Vec3[], loopS: number, targetDrop = 1.5): FlythroughPath {
  if (points.length < 3) throw new Error('createFlythroughPath: at least 3 points');
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p.x, p.y, p.z)), true, 'centripetal');
  const lengthM = curve.getLength();
  const loop = Math.max(1e-3, loopS);
  const tmpP = new Vector3();
  const tmpT = new Vector3();
  const sampleInto = (tS: number, outPos: Vector3, outTarget: Vector3): void => {
    let u = (tS / loop) % 1;
    if (u < 0) u += 1;
    curve.getPointAt(u, outPos);
    const aheadU = (u + TUNING.FXCAM_FLY_LOOKAHEAD_M / Math.max(1e-3, lengthM)) % 1;
    curve.getPointAt(aheadU, outTarget);
    outTarget.y -= targetDrop;
  };
  return {
    loopS: loop,
    lengthM,
    sampleInto,
    sample(tS) {
      sampleInto(tS, tmpP, tmpT);
      return { pos: { x: tmpP.x, y: tmpP.y, z: tmpP.z }, target: { x: tmpT.x, y: tmpT.y, z: tmpT.z } };
    },
  };
}
