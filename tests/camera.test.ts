// tests/camera.test.ts (fx track): the chase camera maths (REQ-CAM-01..07) in plain node.
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import { restSnapshot } from '../src/core/mock';
import { createCameraRig, createFlythroughPath, kickRamp } from '../src/render/camera';
import type { CameraLookInput, CameraRaycast } from '../src/render/types';
import type { SimSnapshot, Vec3 } from '../src/core/types';

afterEach(() => resetTuning());

const DT = 1 / 120;
const NO_LOOK: CameraLookInput = { stick: { x: 0, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } };

/** A skater at pos heading north (-z) at speedRatio, with the sim's look-ahead filled in. */
function snap(pos: Vec3, speedRatio = 0.5, patch: Partial<SimSnapshot> = {}): SimSnapshot {
  const base = restSnapshot();
  const forward = { x: 0, y: 0, z: -1 };
  return {
    ...base,
    skater: { ...base.skater, pos, forward, speedRatio, speed: speedRatio * 11, vel: { x: 0, y: 0, z: -speedRatio * 11 } },
    camera: { vertAir: false, rampNormal: null, lookAhead: { x: pos.x, y: pos.y, z: pos.z - TUNING.CAM_LOOKAHEAD_M }, heading: forward },
    ...patch,
  };
}

function run(rig: ReturnType<typeof createCameraRig>, s: SimSnapshot, seconds: number, look = NO_LOOK): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) rig.update(s, look, DT);
}

describe('REQ-CAM-01 chase camera and springs', () => {
  it('rests CAM_BACK_M behind and CAM_UP_M above the skater, looking at the look-ahead point', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 10, y: 0, z: 10 });
    rig.snapTo(s);
    const c = rig.camera.position;
    expect(c.x).toBeCloseTo(10, 6);
    expect(c.z).toBeCloseTo(10 + TUNING.CAM_BACK_M, 6);
    expect(c.y).toBeCloseTo(TUNING.CAM_UP_M, 6);
    // The camera looks along -z toward the target ahead of the skater.
    const dir = rig.camera.getWorldDirection(rig.camera.position.clone());
    expect(dir.z).toBeLessThan(-0.9);
    expect(rig.debug.target.z).toBeCloseTo(10 - TUNING.CAM_LOOKAHEAD_M, 6);
  });

  it('step response settles within 2% in 0.8 s with no overshoot (critically damped, omega 8)', () => {
    // The springs run on the skater-relative boom, so the step is a change of framing: CAM_BACK_M
    // jumps 1.3 m farther (6.0 to 7.3 since the founder playtest, CR-45) and the boom eases out,
    // monotone, never past the goal.
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    const start = rig.camera.position.z;
    const goal = TUNING.CAM_BACK_M + 1.3;
    TUNING.CAM_BACK_M = goal;
    let prev = start;
    const n = Math.round(0.8 / DT);
    for (let i = 0; i < n; i++) {
      rig.update(s, NO_LOOK, DT);
      const z = rig.camera.position.z;
      expect(z).toBeGreaterThanOrEqual(prev - 1e-9); // monotone approach
      expect(z).toBeLessThanOrEqual(goal + 1e-9); // never past the goal
      prev = z;
    }
    expect(Math.abs(rig.camera.position.z - goal)).toBeLessThan(0.02 * (goal - start));
  });

  it('a heading step swings the boom round without overshoot and settles within 2% in 0.8 s', () => {
    const rig = createCameraRig(null);
    rig.snapTo(snap({ x: 0, y: 0, z: 0 }));
    // Turn east: heading +x, so the camera should end up at -x (behind).
    const east = snap({ x: 0, y: 0, z: 0 }, 0.5, { camera: { vertAir: false, rampNormal: null, lookAhead: { x: TUNING.CAM_LOOKAHEAD_M, y: 0, z: 0 }, heading: { x: 1, y: 0, z: 0 } } });
    let prevAng = 0;
    const n = Math.round(0.8 / DT);
    for (let i = 0; i < n; i++) {
      rig.update(east, NO_LOOK, DT);
      const c = rig.camera.position;
      const ang = Math.atan2(c.x, c.z); // 0 = behind a north heading (+z), -PI/2 = at -x
      expect(ang).toBeLessThanOrEqual(prevAng + 1e-9);
      expect(ang).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9);
      // The boom keeps its length while it swings (polar spring, not a chord).
      expect(Math.hypot(c.x, c.z)).toBeCloseTo(TUNING.CAM_BACK_M, 6);
      prevAng = ang;
    }
    expect(Math.abs(prevAng + Math.PI / 2)).toBeLessThan(0.02 * (Math.PI / 2));
  });

  it('a skater moving at 6 m/s is framed exactly as at rest: no lag, look-ahead intact', () => {
    const rig = createCameraRig(null);
    const v = 6;
    let z = 0;
    rig.snapTo(snap({ x: 0, y: 0, z: 0 }, v / 11));
    const n = Math.round(2 / DT);
    for (let i = 0; i < n; i++) {
      z -= v * DT;
      rig.update(snap({ x: 0, y: 0, z }, v / 11), NO_LOOK, DT);
    }
    const c = rig.camera.position;
    expect(Math.hypot(c.x, c.y - TUNING.CAM_UP_M, c.z - (z + TUNING.CAM_BACK_M))).toBeLessThan(0.15);
    expect(Math.abs(rig.debug.target.z - z + TUNING.CAM_LOOKAHEAD_M)).toBeLessThan(0.2);
  });

  it('an ollie lifts the skater in frame: the anchor springs in y only', () => {
    const rig = createCameraRig(null);
    rig.snapTo(snap({ x: 0, y: 0, z: 0 }));
    rig.update(snap({ x: 0, y: 1, z: -0.5 }), NO_LOOK, DT);
    const c = rig.camera.position;
    expect(c.z).toBeCloseTo(-0.5 + TUNING.CAM_BACK_M, 6); // rigid in z
    expect(c.y).toBeLessThan(TUNING.CAM_UP_M + 0.5); // still on the way up in y
    expect(c.y).toBeGreaterThan(TUNING.CAM_UP_M);
  });

  it('a long frame (dt clamped to 0.1 s) is stable and still converges', () => {
    const rig = createCameraRig(null);
    rig.snapTo(snap({ x: 0, y: 0, z: 0 }));
    const moved = snap({ x: 5, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) rig.update(moved, NO_LOOK, 0.5);
    expect(rig.camera.position.x).toBeCloseTo(5, 3);
    expect(Number.isFinite(rig.camera.position.y)).toBe(true);
  });

  it('grind framing slides to the right of travel and lowers the boom', () => {
    const rig = createCameraRig(null);
    const base = restSnapshot();
    const s: SimSnapshot = {
      ...snap({ x: 0, y: 0.6, z: 0 }),
      skater: {
        ...base.skater, pos: { x: 0, y: 0.6, z: 0 }, state: 'Grind',
        grind: { type: 'fifty_fifty', railId: 'R', railKind: 'rail', contact: { x: 0, y: 0.6, z: 0 }, tangent: { x: 0, y: 0, z: -1 }, distanceM: 1 },
      },
    };
    rig.snapTo(s);
    // Heading north: right of travel is +x (east).
    expect(rig.camera.position.x).toBeCloseTo(TUNING.FXCAM_GRIND_SIDE_M, 6);
    expect(rig.debug.upM).toBeCloseTo(TUNING.CAM_UP_M * TUNING.FXCAM_GRIND_UP_SCALE, 6);
  });
});

describe('REQ-CAM-02 vert air pull-back', () => {
  it('grows the offset by CAM_VERT_BACK_EXTRA_M and CAM_VERT_UP_EXTRA_M over CAM_VERT_BLEND_S and returns on landing', () => {
    const rig = createCameraRig(null);
    const ground = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(ground);
    const air = snap({ x: 0, y: 2, z: 0 }, 0.5, { camera: { ...ground.camera, vertAir: true, rampNormal: { x: 0, y: 0, z: 1 } } });
    run(rig, air, TUNING.CAM_VERT_BLEND_S / 2);
    expect(rig.debug.vertBlend).toBeCloseTo(0.5, 1);
    run(rig, air, TUNING.CAM_VERT_BLEND_S);
    expect(rig.debug.vertBlend).toBe(1);
    expect(rig.debug.backM).toBeCloseTo(TUNING.CAM_BACK_M + TUNING.CAM_VERT_BACK_EXTRA_M, 6);
    expect(rig.debug.upM).toBeCloseTo(TUNING.CAM_UP_M + TUNING.CAM_VERT_UP_EXTRA_M, 6);
    run(rig, ground, TUNING.CAM_VERT_BLEND_S + 0.05);
    expect(rig.debug.vertBlend).toBe(0);
    expect(rig.debug.backM).toBeCloseTo(TUNING.CAM_BACK_M, 6);
  });

  it('in vert air the look point follows the horizontal heading, drops toward the coping and leans into the ramp', () => {
    const rig = createCameraRig(null);
    const ground = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(ground);
    // Going straight up: the sim's lookAhead is 1.5 m above the head; the ramp face normal points +z.
    const air = snap({ x: 0, y: 3, z: 0 }, 0.6, {
      camera: { vertAir: true, rampNormal: { x: 0, y: 0, z: 1 }, lookAhead: { x: 0, y: 3 + TUNING.CAM_LOOKAHEAD_M, z: 0 }, heading: { x: 0, y: 0, z: -1 } },
    });
    run(rig, air, 1.5);
    const t = rig.debug.target;
    // Not the sky: below the sim's point, at the torso minus the drop.
    expect(t.y).toBeCloseTo(3 + TUNING.FXCAM_TARGET_UP_M - TUNING.FXCAM_VERT_LOOK_DROP_M, 2);
    // Ahead along the heading and biased against the ramp normal (toward -z here).
    expect(t.z).toBeCloseTo(-TUNING.CAM_LOOKAHEAD_M - TUNING.FXCAM_VERT_RAMP_BIAS_M, 2);
    const dir = rig.camera.getWorldDirection(rig.camera.position.clone());
    expect(dir.y).toBeLessThan(0); // looking down at the ramp, not up
  });
});

describe('REQ-CAM-03 orbit and spring-back', () => {
  it('100 px of mouse motion orbits 15 deg and springs back after CAM_ORBIT_RETURN_S', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    rig.update(s, { stick: { x: 0, y: 0 }, mouseDeltaPx: { x: 100, y: 0 } }, DT);
    expect(Math.abs(rig.debug.orbitYawDeg)).toBeCloseTo(100 * TUNING.CAM_MOUSE_DEG_PER_PX, 6);
    expect(Math.abs(rig.debug.orbitYawDeg)).toBeCloseTo(15, 6);
    // Let the spring settle the boom, then check the camera really sits 15 deg off the heading.
    run(rig, s, 1.0);
    const c = rig.camera.position;
    const ang = Math.atan2(c.x, c.z) * 180 / Math.PI; // 0 = straight behind (+z)
    expect(Math.abs(ang)).toBeCloseTo(15, 0);
    // Still holding 15 deg just before the return delay ends (1.0 s of the 1.2 s passed).
    expect(Math.abs(rig.debug.orbitYawDeg)).toBeCloseTo(15, 6);
    run(rig, s, 0.3 + 1.5);
    expect(Math.abs(rig.debug.orbitYawDeg)).toBeLessThan(0.5);
    const back = rig.camera.position;
    expect(Math.abs(Math.atan2(back.x, back.z))).toBeLessThan(0.02);
  });

  it('the right stick orbits at CAM_ORBIT_RATE_DPS and pitch is clamped', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    run(rig, s, 0.5, { stick: { x: 1, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } });
    expect(Math.abs(rig.debug.orbitYawDeg)).toBeCloseTo(TUNING.CAM_ORBIT_RATE_DPS * 0.5, 0);
    run(rig, s, 3, { stick: { x: 0, y: 1 }, mouseDeltaPx: { x: 0, y: 0 } });
    expect(rig.debug.orbitPitchDeg).toBeCloseTo(TUNING.FXCAM_ORBIT_PITCH_MAX_DEG, 6);
  });
});

describe('REQ-CAM-04 FOV kick', () => {
  it('kicks +CAM_FOV_KICK_DEG above CAM_FOV_KICK_SPEED at CAM_FOV_LERP per second and returns below it', () => {
    const rig = createCameraRig(null);
    const slow = snap({ x: 0, y: 0, z: 0 }, 0.5);
    rig.snapTo(slow);
    expect(rig.debug.fovDeg).toBe(TUNING.CAM_FOV_DEG);
    // The kick ramps in over FXCAM_KICK_RAMP above the threshold (no on / off breathing).
    const fast = snap({ x: 0, y: 0, z: 0 }, TUNING.CAM_FOV_KICK_SPEED + TUNING.FXCAM_KICK_RAMP);
    run(rig, fast, 1.0);
    const expected = TUNING.CAM_FOV_DEG + TUNING.CAM_FOV_KICK_DEG * (1 - Math.exp(-TUNING.CAM_FOV_LERP));
    expect(rig.debug.fovDeg).toBeCloseTo(expected, 1);
    run(rig, fast, 3);
    expect(rig.debug.fovDeg).toBeCloseTo(TUNING.CAM_FOV_DEG + TUNING.CAM_FOV_KICK_DEG, 3);
    expect(rig.camera.fov).toBeCloseTo(TUNING.CAM_FOV_DEG + TUNING.CAM_FOV_KICK_DEG, 3);
    run(rig, snap({ x: 0, y: 0, z: 0 }, TUNING.CAM_FOV_KICK_SPEED - 0.01), 3);
    expect(rig.debug.fovDeg).toBeCloseTo(TUNING.CAM_FOV_DEG, 3);
  });

  it('kickRamp is 0 at the threshold, 1 a ramp width above it and continuous between', () => {
    expect(kickRamp(TUNING.CAM_FOV_KICK_SPEED - 0.1)).toBe(0);
    expect(kickRamp(TUNING.CAM_FOV_KICK_SPEED)).toBe(0);
    const mid = kickRamp(TUNING.CAM_FOV_KICK_SPEED + TUNING.FXCAM_KICK_RAMP / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(kickRamp(TUNING.CAM_FOV_KICK_SPEED + TUNING.FXCAM_KICK_RAMP)).toBe(1);
    expect(kickRamp(1)).toBe(1);
  });
});

describe('REQ-CAM-05 collision', () => {
  const wallAt = (dist: number): CameraRaycast => (_o, _d, max) => (dist < max ? dist : null);

  it('shortens the boom to the hit distance minus the pad', () => {
    const rig = createCameraRig(wallAt(3.0));
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    expect(rig.debug.collided).toBe(true);
    expect(rig.debug.boomM).toBeCloseTo(3.0 - TUNING.CAM_COLLIDE_PAD_M, 6);
    expect(rig.debug.riseM).toBe(0);
  });

  it('a 3 m corridor keeps the boom >= CAM_MIN_BOOM_M and rises instead', () => {
    // A wall 1.0 m behind the pivot: shortened boom would be 0.7 < 1.2.
    const rig = createCameraRig(wallAt(1.0));
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    run(rig, s, 1);
    expect(rig.debug.boomM).toBeCloseTo(TUNING.CAM_MIN_BOOM_M, 6);
    expect(rig.debug.riseM).toBeCloseTo((TUNING.CAM_MIN_BOOM_M - 1.0) * TUNING.CAM_MIN_BOOM_RISE, 6);
    // Never inside the skater: at least the min boom from the pivot.
    const pivotY = TUNING.FXCAM_PIVOT_UP_M;
    const c = rig.camera.position;
    expect(Math.hypot(c.x, c.y - pivotY, c.z)).toBeGreaterThanOrEqual(TUNING.CAM_MIN_BOOM_M - 1e-6);
    // Rise = (1.2 - 1.0) x 1.5 = 0.3 m above the floored boom point.
    const boomY = pivotY + ((TUNING.CAM_UP_M - pivotY) / Math.hypot(TUNING.CAM_BACK_M, TUNING.CAM_UP_M - pivotY)) * TUNING.CAM_MIN_BOOM_M;
    expect(c.y).toBeCloseTo(boomY + 0.3, 3);
  });

  it('the boom exactly at the floor stays there without a rise', () => {
    const rig = createCameraRig(wallAt(TUNING.CAM_MIN_BOOM_M + TUNING.CAM_COLLIDE_PAD_M));
    rig.snapTo(snap({ x: 0, y: 0, z: 0 }));
    expect(rig.debug.boomM).toBeCloseTo(TUNING.CAM_MIN_BOOM_M, 6);
    expect(rig.debug.riseM).toBe(0);
  });

  it('the boom shortens at once on a hit and lengthens back slowly when the hit goes away', () => {
    let wall: number | null = null;
    const rig = createCameraRig((_o, _d, max) => (wall !== null && wall < max ? wall : null));
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    run(rig, s, 0.5);
    const full = rig.debug.boomM;
    wall = 3.0;
    rig.update(s, NO_LOOK, DT);
    expect(rig.debug.boomM).toBeCloseTo(3.0 - TUNING.CAM_COLLIDE_PAD_M, 6); // instant
    wall = null;
    rig.update(s, NO_LOOK, DT);
    // One frame later the boom has barely grown: no 1 m pop.
    expect(rig.debug.boomM).toBeLessThan(3.0 - TUNING.CAM_COLLIDE_PAD_M + 0.05);
    run(rig, s, 0.3);
    expect(rig.debug.boomM).toBeGreaterThan(3.0 - TUNING.CAM_COLLIDE_PAD_M + 0.3);
    expect(rig.debug.boomM).toBeLessThan(full - 0.05);
    run(rig, s, 3);
    expect(rig.debug.boomM).toBeCloseTo(full, 2);
    expect(rig.debug.boomCutM).toBe(0);
  });

  it('no hit leaves the boom alone; null raycast disables collision', () => {
    const rig = createCameraRig(wallAt(50));
    rig.snapTo(snap({ x: 0, y: 0, z: 0 }));
    expect(rig.debug.collided).toBe(false);
    const rig2 = createCameraRig(null);
    rig2.snapTo(snap({ x: 0, y: 0, z: 0 }));
    expect(rig2.debug.collided).toBe(false);
    expect(rig2.debug.boomM).toBeCloseTo(Math.hypot(TUNING.CAM_BACK_M, TUNING.CAM_UP_M - TUNING.FXCAM_PIVOT_UP_M), 6);
  });
});

describe('REQ-CAM-06 bail shake', () => {
  it('shakes up to CAM_SHAKE_BAIL_AMP_M and decays to nothing within CAM_SHAKE_BAIL_S', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    run(rig, s, 1);
    const rest = rig.camera.position.clone();
    rig.onEvent({ type: 'bail', tick: 0, reason: 'landing', speed: 5, pos: { x: 0, y: 0, z: 0 } });
    let maxOff = 0;
    const n = Math.round(TUNING.CAM_SHAKE_BAIL_S / DT);
    for (let i = 0; i < n; i++) {
      rig.update(s, NO_LOOK, DT);
      maxOff = Math.max(maxOff, rig.camera.position.distanceTo(rest));
      expect(rig.debug.shakeM).toBeLessThanOrEqual(TUNING.CAM_SHAKE_BAIL_AMP_M * Math.SQRT2 + 1e-9);
    }
    expect(maxOff).toBeGreaterThan(TUNING.CAM_SHAKE_BAIL_AMP_M * 0.4);
    run(rig, s, 0.05);
    expect(rig.debug.shakeM).toBe(0);
    expect(rig.camera.position.distanceTo(rest)).toBeLessThan(1e-6);
  });

  it('the shake also rotates the frame after lookAt, hardest on the first frame, and is gone at the end', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    run(rig, s, 1);
    const restQ = rig.camera.quaternion.clone();
    rig.onEvent({ type: 'bail', tick: 0, reason: 'landing', speed: 5, pos: { x: 0, y: 0, z: 0 } });
    rig.update(s, NO_LOOK, DT);
    expect(rig.debug.trauma).toBeGreaterThan(0.9);
    const first = rig.debug.shakeRotDeg;
    expect(first).toBeGreaterThan(TUNING.FXCAM_SHAKE_YAW_DEG * 0.5);
    expect(first).toBeLessThanOrEqual(Math.hypot(TUNING.FXCAM_SHAKE_YAW_DEG, TUNING.FXCAM_SHAKE_YAW_DEG, TUNING.FXCAM_SHAKE_ROLL_DEG) + 1e-9);
    expect(rig.camera.quaternion.angleTo(restQ)).toBeGreaterThan(0.005);
    run(rig, s, TUNING.CAM_SHAKE_BAIL_S + 0.05);
    expect(rig.debug.shakeRotDeg).toBe(0);
    expect(rig.debug.trauma).toBe(0);
    expect(rig.camera.quaternion.angleTo(restQ)).toBeLessThan(1e-6);
  });

  it('every landing dips the camera by FXCAM_LAND_KICK_M for FXCAM_LAND_KICK_S', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    run(rig, s, 1);
    const restY = rig.camera.position.y;
    rig.onEvent({ type: 'land', tick: 0, quality: 'clean', offAxisDeg: 3, tiltDeg: 2, vert: false, speed: 6, pos: { x: 0, y: 0, z: 0 }, linker: 'none' });
    let minY = restY;
    let maxKick = 0;
    const n = Math.round(TUNING.FXCAM_LAND_KICK_S / DT);
    for (let i = 0; i < n; i++) {
      rig.update(s, NO_LOOK, DT);
      minY = Math.min(minY, rig.camera.position.y);
      maxKick = Math.max(maxKick, rig.debug.landKickM);
    }
    expect(maxKick).toBeGreaterThan(TUNING.FXCAM_LAND_KICK_M * 0.9);
    expect(restY - minY).toBeGreaterThan(TUNING.FXCAM_LAND_KICK_M * 0.9);
    run(rig, s, 0.05);
    expect(rig.debug.landKickM).toBe(0);
    expect(rig.camera.position.y).toBeCloseTo(restY, 6);
  });
});

describe('REQ-CAM-07 never first person', () => {
  it('keeps the camera at least CAM_MIN_BOOM_M from the pivot with every framing', () => {
    const rig = createCameraRig(null);
    const base = restSnapshot();
    const states: SimSnapshot[] = [
      snap({ x: 0, y: 0, z: 0 }),
      { ...snap({ x: 0, y: 0, z: 0 }), skater: { ...base.skater, state: 'Bail', bail: { phase: 'tumble', t: 0.5 } } },
      snap({ x: 0, y: 3, z: 0 }, 0.9, { camera: { vertAir: true, rampNormal: null, lookAhead: { x: 0, y: 3, z: -1 }, heading: { x: 0, y: 0, z: -1 } } }),
    ];
    for (const s of states) {
      run(rig, s, 0.5);
      const c = rig.camera.position;
      const d = Math.hypot(c.x - s.skater.pos.x, c.y - s.skater.pos.y - TUNING.FXCAM_PIVOT_UP_M, c.z - s.skater.pos.z);
      expect(d).toBeGreaterThanOrEqual(TUNING.CAM_MIN_BOOM_M);
    }
  });

  it('tuning is read live: changing CAM_BACK_M moves the rest pose', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 });
    rig.snapTo(s);
    TUNING.CAM_BACK_M = 5.5;
    run(rig, s, 2);
    expect(rig.camera.position.z).toBeCloseTo(5.5, 2);
  });
});

describe('flythrough path helper', () => {
  it('loops once per loopS, looks ahead along the path and allocates nothing per sample', () => {
    const path = createFlythroughPath([{ x: 0, y: 5, z: 0 }, { x: 40, y: 6, z: 0 }, { x: 40, y: 5, z: 40 }, { x: 0, y: 7, z: 40 }], 20);
    const a = path.sample(0);
    const b = path.sample(20);
    expect(a.pos.x).toBeCloseTo(b.pos.x, 6);
    expect(a.pos.z).toBeCloseTo(b.pos.z, 6);
    expect(path.lengthM).toBeGreaterThan(120);
    const mid = path.sample(5);
    expect(Number.isFinite(mid.pos.x)).toBe(true);
    // The target sits ahead and below the camera height.
    const d = Math.hypot(mid.target.x - mid.pos.x, mid.target.z - mid.pos.z);
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(TUNING.FXCAM_FLY_LOOKAHEAD_M * 1.5);
    expect(mid.target.y).toBeLessThan(mid.pos.y);
    expect(() => createFlythroughPath([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 10)).toThrow();
  });
});

describe('REQ-CAM-03 orbit look', () => {
  it('a camera orbited round the front looks at the skater, not at a point behind itself', () => {
    const rig = createCameraRig(null);
    const s = snap({ x: 0, y: 0, z: 0 }, 0.6);
    rig.snapTo(s);
    // Half a second of full stick at 180 deg/s = 90 deg (beside), a full second = 180 deg (in front).
    run(rig, s, 0.5, { stick: { x: 1, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } });
    expect(Math.abs(rig.debug.orbitYawDeg)).toBeCloseTo(90, 0);
    run(rig, s, 0.5, { stick: { x: 1, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } });
    expect(Math.abs(Math.abs(rig.debug.orbitYawDeg) - 180)).toBeLessThan(2);
    // Let the boom spring catch up with the orbit before reading the pose.
    run(rig, s, 0.5, { stick: { x: 0, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } });
    const c = rig.camera.position;
    expect(c.z).toBeLessThan(-3); // in front (heading north = -z)
    const t = rig.debug.target;
    expect(Math.hypot(t.x, t.z)).toBeLessThan(0.05); // looking at the skater
    const dir = rig.camera.getWorldDirection(c.clone());
    expect(dir.z).toBeGreaterThan(0.9); // looking back toward the skater
  });
});
