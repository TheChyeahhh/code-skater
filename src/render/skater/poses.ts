/**
 * src/render/skater/poses.ts (skater track): procedural pose library and board flip rotations
 * (REQ-SKT-03, REQ-SKT-04). Poses are keyframed joint rotations blended over POSE_BLEND_MS.
 * Skater local frame: -z nose / forward, +y up, +x right (src/core/types.ts).
 *
 * Authoring frame. Every pose is written for the REGULAR stance: the body model faces its own -z,
 * the view turns it by the stance yaw (-90 deg) so the chest faces the skater's +x (toe side), the
 * nose is on the body's left and the tail on its right. Bone rotations are Euler XYZ degrees on a
 * limb that hangs along -y (legs, arms) or points along +y (spine, neck, head):
 *   x > 0 swings a hanging limb forward (body -z = toe side), tilts the spine backward;
 *   y > 0 turns toward the body's left (the nose);
 *   z > 0 swings a hanging limb toward the body's right (+x), tilts the spine toward its left.
 * Switch stance = mirrorPose (swap L/R, x, -y, -z) with the stance yaw flipped (view).
 *
 * Contacts. Feet and hands listed in `contacts` are planted by the view's two-bone IK on the board
 * (skater frame: x across, z along, 0 = deck centre; foot yaw = toe direction in degrees from +x
 * toward the nose), so the authored leg angles only set the knee direction and the free limbs.
 */

import { clamp, lerp, mulQuat } from '../../core/math';
import { TUNING } from '../../core/tuning';
import type { BaseTrickId, EnhancedFlipId, FlipId, GrabId, GrindTypeId, PoseId, Quat, SpecialId, Vec3 } from '../../core/types';

export type BoneId =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'upperArmL' | 'lowerArmL' | 'upperArmR' | 'lowerArmR'
  | 'thighL' | 'shinL' | 'footL' | 'thighR' | 'shinR' | 'footR';

export const BONE_IDS: readonly BoneId[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];

/** Euler rotation in degrees (XYZ order) relative to the bind pose. */
export interface JointRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Whole-body offset on top of the stance: degrees about the skater's axes, lift in metres. */
export interface PoseRoot {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly lift: number;
}

/** How the pose holds the board: extra tilt (degrees, skater frame) about a pivot on the deck's long axis, plus an offset. */
export interface BoardPose {
  readonly tilt: JointRotation;
  /** z of the tilt pivot on the deck (0 centre, negative toward the nose). */
  readonly pivotZ: number;
  readonly offset: Vec3;
}

/**
 * A foot planted on the deck: skater-frame point and toe direction (degrees from +x toward the nose).
 * `ground: true` plants it on the skater-frame ground plane instead (the push foot), at the same x, z.
 */
export interface FootContact {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly ground?: boolean;
}

export interface PoseContacts {
  readonly footL: FootContact | null;
  readonly footR: FootContact | null;
  /** A hand reaching a skater-frame point on the board (grabs). */
  readonly handL: Vec3 | null;
  readonly handR: Vec3 | null;
}

export interface Pose {
  readonly bones: Readonly<Partial<Record<BoneId, JointRotation>>>;
  /** Hips height offset from the standing bind pose, metres (crouch < 0). */
  readonly hipsDrop: number;
  /** Skater-track extensions (always filled by getPose; optional so a two-field Pose literal still types). */
  readonly root?: PoseRoot;
  readonly board?: BoardPose;
  readonly contacts?: PoseContacts;
}

/** Rotation axes a flip spins the board around (REQ-SKT-04): roll = nose-tail axis, pitch = across, yaw = up. */
export interface FlipAxes {
  /** Full turns about the roll axis (kickflip +1, heelflip -1). */
  readonly roll: number;
  /** Full turns about the pitch axis (impossible wraps the back foot: +1). */
  readonly pitch: number;
  /** Turns about the yaw axis (shove-it 0.5, 360 flip 1). */
  readonly yaw: number;
  /**
   * Transient pitch, degrees: the deck stands up by this much mid-trick (sin(PI x phase)) and is
   * flat again at phase 1. The hardflip's "vertical" look without landing upside down.
   */
  readonly pitchWobble?: number;
}

/** Peak transient pitch of the hardflip family (degrees). */
export const HARDFLIP_PITCH_WOBBLE_DEG = 35;

/**
 * Board rotation per flip, completing exactly at the trick's animMs (REQ-SKT-04). Enhanced = double
 * the roll/pitch turns. A hardflip is a frontside pop shove-it plus a kickflip (yaw opposite to the
 * varial kickflip), with a transient pitch so it reads vertical: a half pitch turn would land the
 * deck grip-down.
 */
export const FLIP_AXES: Readonly<Record<FlipId, FlipAxes>> = {
  kickflip: { roll: 1, pitch: 0, yaw: 0 },
  heelflip: { roll: -1, pitch: 0, yaw: 0 },
  pop_shove_it: { roll: 0, pitch: 0, yaw: 0.5 },
  varial_kickflip: { roll: 1, pitch: 0, yaw: 0.5 },
  varial_heelflip: { roll: -1, pitch: 0, yaw: -0.5 },
  impossible: { roll: 0, pitch: 1, yaw: 0 },
  hardflip: { roll: 1, pitch: 0, yaw: -0.5, pitchWobble: HARDFLIP_PITCH_WOBBLE_DEG },
  tre_flip: { roll: 1, pitch: 0, yaw: 1 },
};

/** Enhanced (double-tap) flips: roll and pitch turns doubled; the 360 shove-it doubles its yaw instead (REQ-SCR-11). */
export const ENHANCED_FLIP_AXES: Readonly<Record<EnhancedFlipId, FlipAxes>> = {
  double_kickflip: { roll: 2, pitch: 0, yaw: 0 },
  double_heelflip: { roll: -2, pitch: 0, yaw: 0 },
  shove_it_360: { roll: 0, pitch: 0, yaw: 1 },
  double_varial_kickflip: { roll: 2, pitch: 0, yaw: 0.5 },
  double_varial_heelflip: { roll: -2, pitch: 0, yaw: -0.5 },
  double_impossible: { roll: 0, pitch: 2, yaw: 0 },
  double_hardflip: { roll: 2, pitch: 0, yaw: -0.5, pitchWobble: HARDFLIP_PITCH_WOBBLE_DEG },
  double_tre_flip: { roll: 2, pitch: 0, yaw: 1 },
};

export function flipAxesOf(flipId: FlipId | EnhancedFlipId): FlipAxes {
  return (FLIP_AXES as Record<string, FlipAxes>)[flipId] ?? ENHANCED_FLIP_AXES[flipId as EnhancedFlipId];
}

/** True when the deck leaves the horizontal plane during the flip (the feet tuck higher for these). */
export function flipStandsUp(axes: FlipAxes): boolean {
  return axes.pitch !== 0 || (axes.pitchWobble ?? 0) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------------------------

type Bones = Partial<Record<BoneId, JointRotation>>;

export const ZERO_ROT: JointRotation = { x: 0, y: 0, z: 0 };
const ZERO_ROOT: PoseRoot = { yaw: 0, pitch: 0, roll: 0, lift: 0 };
const ZERO_BOARD: BoardPose = { tilt: ZERO_ROT, pivotZ: 0, offset: { x: 0, y: 0, z: 0 } };
const NO_CONTACTS: PoseContacts = { footL: null, footR: null, handL: null, handR: null };

function r(x: number, y: number, z: number): JointRotation {
  return { x, y, z };
}

function addRot(a: JointRotation | undefined, b: JointRotation | undefined): JointRotation {
  return { x: (a?.x ?? 0) + (b?.x ?? 0), y: (a?.y ?? 0) + (b?.y ?? 0), z: (a?.z ?? 0) + (b?.z ?? 0) };
}

/** Component-wise sum of two bone maps (small-angle layering, fine for a stylised rig). */
function layer(a: Bones, b: Bones): Bones {
  const out: Bones = { ...a };
  for (const id of Object.keys(b) as BoneId[]) out[id] = addRot(a[id], b[id]);
  return out;
}

/** Rig leg lengths (must match src/render/skater/rig.ts). */
export const RIG = {
  hipY: 0.92,
  thigh: 0.42,
  shin: 0.42,
  ankle: 0.08,
  upperArm: 0.3,
  lowerArm: 0.28,
  /** Deck half extents (must match deckGeometry.ts). */
  deckHalfLength: 0.41,
  deckHalfWidth: 0.105,
  truckZ: 0.18,
} as const;

const LEG = RIG.thigh + RIG.shin;

/** Hips drop that keeps a foot on the deck with a knee bent by `a` degrees from vertical, plus a lift of the feet. */
function hipsFor(a: number, lift = 0): number {
  return -LEG * (1 - Math.cos((a * Math.PI) / 180)) + lift;
}

/** One leg with the knee bent `a` degrees forward (toward the toe side), foot kept flat. */
function bentLeg(side: 'L' | 'R', a: number, splay: number, footYaw = 0): Bones {
  const s = side === 'L' ? -1 : 1;
  return {
    [`thigh${side}`]: r(a, 0, s * splay),
    [`shin${side}`]: r(-2 * a, 0, 0),
    [`foot${side}`]: r(a, footYaw, -s * splay),
  } as Bones;
}

/** Regular-stance feet on the deck: front (left) foot behind the front bolts angled to the nose, back foot on the tail. */
const RIDE_FEET: PoseContacts = {
  footL: { x: 0.0, z: -0.2, yaw: 22 },
  footR: { x: 0.01, z: 0.27, yaw: -4 },
  handL: null,
  handR: null,
};

/** Upper body turned toward the nose, arms loose. */
const RIDE_UPPER: Bones = {
  hips: r(0, 12, 0),
  spine: r(-4, 10, 0),
  chest: r(-2, 14, 0),
  neck: r(0, 8, 0),
  head: r(4, 20, 0),
  upperArmL: r(12, 0, -14),
  lowerArmL: r(24, 0, 0),
  upperArmR: r(8, 0, 14),
  lowerArmR: r(18, 0, 0),
};

function pose(bones: Bones, hipsDrop: number, extra: Partial<Omit<Pose, 'bones' | 'hipsDrop'>> = {}): Pose {
  return {
    bones,
    hipsDrop,
    root: extra.root ?? ZERO_ROOT,
    board: extra.board ?? ZERO_BOARD,
    contacts: extra.contacts ?? NO_CONTACTS,
  };
}

function ride(kneeL: number, kneeR: number, upper: Bones = {}, lift = 0): Pose {
  return pose(
    layer(layer(layer(RIDE_UPPER, upper), bentLeg('L', kneeL, 9, 18)), bentLeg('R', kneeR, 11, -3)),
    hipsFor(Math.min(kneeL, kneeR), lift),
    { contacts: RIDE_FEET },
  );
}

/** Balance arms: elbows bent, one arm a touch lower and forward, so the T-airplane never appears. */
const ARMS_OUT: Bones = { upperArmL: r(-12, 0, -48), lowerArmL: r(35, 0, 0), upperArmR: r(18, 0, 52), lowerArmR: r(28, 0, 0) };

function withBoard(p: Pose, board: Partial<BoardPose>): Pose {
  return { ...p, board: { ...(p.board ?? ZERO_BOARD), ...board } };
}

function withRoot(p: Pose, root: Partial<PoseRoot>): Pose {
  return { ...p, root: { ...(p.root ?? ZERO_ROOT), ...root } };
}

function withContacts(p: Pose, contacts: Partial<PoseContacts>): Pose {
  return { ...p, contacts: { ...(p.contacts ?? NO_CONTACTS), ...contacts } };
}

function withBones(p: Pose, bones: Bones): Pose {
  return { ...p, bones: layer(p.bones, bones) };
}

/** Piecewise-linear keyframe track over phase 0..1. */
function track(phase: number, keys: readonly (readonly [number, Pose])[]): Pose {
  const p = clamp(phase, 0, 1);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) throw new Error('track needs keys');
  if (p <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] as readonly [number, Pose];
    const b = keys[i] as readonly [number, Pose];
    if (p <= b[0]) {
      const span = b[0] - a[0];
      return blendPoses(a[1], b[1], span > 0 ? (p - a[0]) / span : 1);
    }
  }
  return last[1];
}

/** Smoothstep for eased keyframes. */
function ease(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

// ---------------------------------------------------------------------------------------------
// Blending and mirroring
// ---------------------------------------------------------------------------------------------

function lerpRot(a: JointRotation | undefined, b: JointRotation | undefined, t: number): JointRotation {
  const A = a ?? ZERO_ROT;
  const B = b ?? ZERO_ROT;
  return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), z: lerp(A.z, B.z, t) };
}

function lerpFoot(a: FootContact | null, b: FootContact | null, t: number): FootContact | null {
  if (a && b && !!a.ground === !!b.ground) {
    const f: FootContact = { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), yaw: lerp(a.yaw, b.yaw, t) };
    return a.ground ? { ...f, ground: true } : f;
  }
  return t < 0.5 ? a : b;
}

function lerpHand(a: Vec3 | null, b: Vec3 | null, t: number): Vec3 | null {
  if (a && b) return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
  return t < 0.5 ? a : b;
}

/** Blend two poses by t in [0, 1]. */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  const k = clamp(t, 0, 1);
  if (k <= 0) return a;
  if (k >= 1) return b;
  const bones: Bones = {};
  const ids = new Set<BoneId>([...(Object.keys(a.bones) as BoneId[]), ...(Object.keys(b.bones) as BoneId[])]);
  for (const id of ids) bones[id] = lerpRot(a.bones[id], b.bones[id], k);
  const ra = a.root ?? ZERO_ROOT;
  const rb = b.root ?? ZERO_ROOT;
  const ba = a.board ?? ZERO_BOARD;
  const bb = b.board ?? ZERO_BOARD;
  const ca = a.contacts ?? NO_CONTACTS;
  const cb = b.contacts ?? NO_CONTACTS;
  return {
    bones,
    hipsDrop: lerp(a.hipsDrop, b.hipsDrop, k),
    root: { yaw: lerp(ra.yaw, rb.yaw, k), pitch: lerp(ra.pitch, rb.pitch, k), roll: lerp(ra.roll, rb.roll, k), lift: lerp(ra.lift, rb.lift, k) },
    board: {
      tilt: lerpRot(ba.tilt, bb.tilt, k),
      pivotZ: lerp(ba.pivotZ, bb.pivotZ, k),
      offset: { x: lerp(ba.offset.x, bb.offset.x, k), y: lerp(ba.offset.y, bb.offset.y, k), z: lerp(ba.offset.z, bb.offset.z, k) },
    },
    contacts: {
      footL: lerpFoot(ca.footL, cb.footL, k),
      footR: lerpFoot(ca.footR, cb.footR, k),
      handL: lerpHand(ca.handL, cb.handL, k),
      handR: lerpHand(ca.handR, cb.handR, k),
    },
  };
}

const MIRROR: Readonly<Record<BoneId, BoneId>> = {
  hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  upperArmL: 'upperArmR', lowerArmL: 'lowerArmR', upperArmR: 'upperArmL', lowerArmR: 'lowerArmL',
  thighL: 'thighR', shinL: 'shinR', footL: 'footR', thighR: 'thighL', shinR: 'shinL', footR: 'footL',
};

/**
 * Switch stance (REQ-SKT-05): the body mirrored across its sagittal plane (L and R swapped, y and z
 * rotations negated) and, in the skater frame, across x = 0 (contacts, board tilt, root).
 */
export function mirrorPose(p: Pose): Pose {
  const bones: Bones = {};
  for (const id of Object.keys(p.bones) as BoneId[]) {
    const src = p.bones[id] ?? ZERO_ROT;
    bones[MIRROR[id]] = { x: src.x, y: -src.y, z: -src.z };
  }
  const root = p.root ?? ZERO_ROOT;
  const board = p.board ?? ZERO_BOARD;
  const c = p.contacts ?? NO_CONTACTS;
  const mf = (f: FootContact | null): FootContact | null => (f ? { x: -f.x, z: f.z, yaw: 180 - f.yaw, ...(f.ground ? { ground: true } : {}) } : null);
  const mh = (h: Vec3 | null): Vec3 | null => (h ? { x: -h.x, y: h.y, z: h.z } : null);
  return {
    bones,
    hipsDrop: p.hipsDrop,
    root: { yaw: -root.yaw, pitch: root.pitch, roll: -root.roll, lift: root.lift },
    board: {
      tilt: { x: board.tilt.x, y: -board.tilt.y, z: -board.tilt.z },
      pivotZ: board.pivotZ,
      offset: { x: -board.offset.x, y: board.offset.y, z: board.offset.z },
    },
    contacts: { footL: mf(c.footR), footR: mf(c.footL), handL: mh(c.handR), handR: mh(c.handL) },
  };
}

// ---------------------------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------------------------

/** Cruising: knees soft, a forward lean, hands at hip height with the elbows bent (skating, not standing on a plank). */
const CRUISE_UPPER: Bones = { spine: r(-10, 0, 0), chest: r(-4, 0, 0), upperArmL: r(6, 0, -16), upperArmR: r(2, 0, 16), lowerArmL: r(30, 0, 0), lowerArmR: r(30, 0, 0) };
const ROLL = ride(22, 24, CRUISE_UPPER);

function rollPose(phase: number): Pose {
  // Idle sway: a slow weight shift over the push cycle.
  const s = Math.sin(phase * Math.PI * 2);
  return withBones(ride(22 + 2 * s, 24 - 2 * s, CRUISE_UPPER), { spine: r(0, 0, 2 * s), head: r(0, 0, -2 * s) });
}

/** Push foot on the ground beside the toe-side edge, toes along the travel direction. */
const PUSH_X = 0.32;

function pushPose(phase: number): Pose {
  // Back (right) foot leaves the tail, plants on the ground ahead on the toe side, slides back past the
  // tail as the board rolls on (ground contacts, so the sole really touches the ground) and returns.
  const base = ride(24, 24, { hips: r(0, 26, 0), spine: r(-8, 10, 0), chest: r(-4, 10, 0), upperArmL: r(30, 0, -10), upperArmR: r(-20, 0, 10), lowerArmL: r(40, 0, 0) });
  const free = withContacts(base, { footR: null });
  const lifted = withBones(free, { thighR: r(20, 0, 0), shinR: r(-70, 0, 0), footR: r(10, 0, 0) });
  const planted = withContacts(withBones(free, { spine: r(-6, 0, 0) }), { footR: { x: PUSH_X, z: -0.3, yaw: 8, ground: true } });
  const pushed = withContacts(withBones(free, { spine: r(-10, 0, 0), upperArmL: r(10, 0, 0), upperArmR: r(10, 0, 0) }), { footR: { x: PUSH_X, z: 0.5, yaw: 4, ground: true } });
  const recover = withBones(free, { thighR: r(-6, 0, 2), shinR: r(-84, 0, 0), footR: r(40, 0, 0) });
  const plantedLow = { ...planted, hipsDrop: hipsFor(40) };
  const pushedLow = { ...pushed, hipsDrop: hipsFor(40) };
  return track(phase, [
    [0, base],
    [0.18, lifted],
    [0.36, plantedLow],
    [0.62, pushedLow],
    [0.82, recover],
    [1, base],
  ]);
}

function brakePose(phase: number): Pose {
  const base = ride(26, 20, { spine: r(6, 6, 0), chest: r(4, 6, 0), upperArmL: r(50, 0, -20), upperArmR: r(40, 0, 20), lowerArmL: r(20, 0, 0), lowerArmR: r(20, 0, 0) });
  const drag = withBones(withContacts(base, { footR: null }), { thighR: r(-30, 0, 6), shinR: r(-10, 0, 0), footR: r(36, 0, 0) });
  // Low-speed 180 pivot: the arms swing across over the pivot window.
  const swing = Math.sin(clamp(phase, 0, 1) * Math.PI) * 30;
  return withBones(drag, { upperArmL: r(0, 0, swing), upperArmR: r(0, 0, swing), chest: r(0, swing, 0) });
}

const PUMP = ride(40, 40, { spine: r(-16, 8, 0), chest: r(-8, 8, 0), upperArmL: r(-30, 0, -20), upperArmR: r(-36, 0, 20), lowerArmL: r(30, 0, 0), lowerArmR: r(30, 0, 0) });

function crouchPose(charge: number): Pose {
  const deep = ride(52, 52, { spine: r(-22, 8, 0), chest: r(-12, 8, 0), head: r(10, 0, 0), upperArmL: r(-42, 0, -18), upperArmR: r(-46, 0, 18), lowerArmL: r(20, 0, 0), lowerArmR: r(24, 0, 0) });
  return blendPoses(ride(20, 22), deep, ease(charge));
}

/** Air neutral: a tuck with the arms bent and the hands at chest height, so a grab reaches from the tuck. */
const AIR = withBones(ride(30, 32, { upperArmL: r(10, 0, -40), lowerArmL: r(70, 0, 0), upperArmR: r(24, 0, 44), lowerArmR: r(64, 0, 0) }, 0), { spine: r(-6, 0, 0), head: r(8, 0, 0) });

/** The flip tuck: feet off the deck by `lift`, the board dropped by `drop` (both metres). */
function flipTuck(knee: number, lift: number, drop: number): Pose {
  return pose(
    layer(layer(layer(RIDE_UPPER, ARMS_OUT), bentLeg('L', knee, 10, 18)), bentLeg('R', knee + 2, 12, -3)),
    hipsFor(knee, lift),
    { contacts: NO_CONTACTS, board: { tilt: ZERO_ROT, pivotZ: 0, offset: { x: 0, y: -drop, z: 0 } } },
  );
}

/** Flat flips: feet just clear of the spinning deck. */
export const FLIP_TUCK_FLAT = { knee: 44, lift: 0.15, drop: 0 } as const;
/**
 * Flips where the deck stands up (impossible, hardflip): the feet tuck higher and the board sits
 * lower, so the gap (lift + drop) clears the deck's corner radius about its centre (0.42 m). Split
 * between the two so neither the body nor the board jumps far in the 80 ms blend at either end.
 */
export const FLIP_TUCK_STANDING = { knee: 56, lift: 0.3, drop: 0.15 } as const;

function popPose(phase: number): Pose {
  const explode = withBones(ride(4, 6, { upperArmL: r(70, 0, -40), upperArmR: r(70, 0, 40), lowerArmL: r(10, 0, 0), lowerArmR: r(10, 0, 0), spine: r(6, 0, 0), chest: r(4, 0, 0) }), {});
  return track(phase, [
    [0, crouchPose(1)],
    [0.35, explode],
    [1, AIR],
  ]);
}

/** Feet off the board while it spins (REQ-SKT-03 "flip: feet leave the board"). */
function flipPose(flipId: BaseTrickId | null, phase: number): Pose {
  const axes = flipId ? flipAxesOf(flipId as FlipId | EnhancedFlipId) : FLIP_AXES.kickflip;
  const heel = axes.roll < 0;
  const flick = Math.sin(clamp(phase, 0, 1) * Math.PI);
  const t = flipStandsUp(axes) ? FLIP_TUCK_STANDING : FLIP_TUCK_FLAT;
  const tuck = flipTuck(t.knee, t.lift, t.drop);
  // The front foot flicks off the heel edge (kickflip) or the toe edge (heelflip); shove-its scoop with the back foot.
  const flickL = r(0, heel ? -26 * flick : 0, (heel ? 1 : -1) * 34 * flick);
  const scoopR = axes.yaw !== 0 ? r(-18 * flick, 0, 22 * flick) : r(0, 0, 0);
  const shake = { spine: r(-6, 0, 0), head: r(12, 0, 0) };
  return withBones(tuck, { footL: flickL, thighL: r(6 * flick, 0, -8 * flick), thighR: scoopR, ...shake });
}

/**
 * A grab's signature silhouette. The knees stay bent enough for the hand to reach the lifted board
 * but splay wide along the deck (a diamond, not a ball), the free arm is thrown out, the head looks
 * ahead, and the board turns 35 to 50 deg off flat so it is never seen end-on: the pitch
 * (tilt.x < 0 = tail up) turns the underside graphic toward the chase camera behind, the roll turns
 * it toward a side camera (vert), and a yaw against the roll swings the deck broadside to the chase camera.
 */
interface GrabDef {
  readonly hand: 'L' | 'R';
  readonly at: Vec3;
  readonly tilt: JointRotation;
  /** Knee bend (front L, back R), degrees; the hips sit at the matching height so the IK feet reach the lifted board. */
  readonly knees: readonly [number, number];
  /** Knee splay (front L, back R), degrees: legs open along the deck so the knees read apart. */
  readonly splay: readonly [number, number];
  /** Forward curl of the spine and chest, degrees (the tuck toward the grabbing hand). */
  readonly curl: number;
  /** How far the board comes up to the hand, metres. */
  readonly boardLift: number;
  readonly extra: Bones;
  /** The tweaked version (skater.grabId tweaked_*): these are layered on and the tilt is scaled by GRAB_TWEAK_TILT. */
  readonly tweak: Bones;
  readonly freeFoot?: 'L' | 'R';
}

const TOE = RIG.deckHalfWidth;
const NOSE = -RIG.deckHalfLength;
const TAIL = RIG.deckHalfLength;
/** A tweaked grab pushes the board this much further past the plain tilt. */
const GRAB_TWEAK_TILT = 1.3;

const GRABS: Readonly<Record<GrabId, GrabDef>> = {
  // Front hand on the nose, nose pulled up and across; back arm thrown out behind.
  nosegrab: {
    hand: 'L', at: { x: 0, y: 0, z: NOSE + 0.02 }, tilt: r(34, -20, 26), knees: [76, 66], splay: [18, 28], curl: 30, boardLift: 0.12,
    extra: { chest: r(0, 20, 0), head: r(-14, 16, 0), upperArmR: r(-40, 0, 104), lowerArmR: r(10, 0, 0) },
    tweak: { thighR: r(-24, 0, 14), upperArmR: r(-20, 0, 24) },
  },
  // Back hand on the tail, tail up (the graphic turns to the chase camera); front arm out ahead.
  tailgrab: {
    hand: 'R', at: { x: 0, y: 0, z: TAIL - 0.02 }, tilt: r(-40, 22, -20), knees: [66, 76], splay: [28, 18], curl: 28, boardLift: 0.12,
    extra: { chest: r(0, -18, 0), head: r(-14, -14, 0), upperArmL: r(40, 0, -104), lowerArmL: r(10, 0, 0) },
    tweak: { thighL: r(-24, 0, -14), upperArmL: r(-20, 0, -24) },
  },
  // Back hand on the toe edge between the feet, knees wide, front arm thrown up and forward.
  indy: {
    hand: 'R', at: { x: TOE, y: 0, z: 0.04 }, tilt: r(-34, -24, 32), knees: [72, 74], splay: [30, 30], curl: 30, boardLift: 0.14,
    extra: { upperArmL: r(-30, 0, -124), lowerArmL: r(-10, 0, -10), head: r(-16, 10, 0) },
    tweak: { thighL: r(-22, 0, -18), upperArmL: r(-10, 0, -16) },
  },
  // Front hand on the heel edge, knees wide, back arm up behind.
  melon: {
    hand: 'L', at: { x: -TOE, y: 0, z: -0.06 }, tilt: r(-32, 24, -32), knees: [72, 74], splay: [30, 28], curl: 32, boardLift: 0.14,
    extra: { upperArmR: r(-50, 0, 118), lowerArmR: r(-10, 0, 10), head: r(-14, -10, 0) },
    tweak: { thighR: r(-22, 0, 18), upperArmR: r(-10, 0, 16) },
  },
  // Front hand on the toe edge by the nose, the tightest tuck, nose pulled up; back arm out.
  japan: {
    hand: 'L', at: { x: TOE, y: 0, z: -0.14 }, tilt: r(30, -24, 38), knees: [78, 72], splay: [16, 22], curl: 40, boardLift: 0.12,
    extra: { head: r(-18, 0, 0), upperArmR: r(-60, 0, 96), lowerArmR: r(10, 0, 0) },
    tweak: { thighR: r(-26, 0, 18), upperArmR: r(-20, 0, 20) },
  },
  // Back hand on the heel edge behind the back leg, chest turned back, front arm out ahead.
  stalefish: {
    hand: 'R', at: { x: -TOE, y: 0, z: 0.16 }, tilt: r(-36, 24, -30), knees: [72, 72], splay: [30, 30], curl: 28, boardLift: 0.14,
    extra: { chest: r(0, -30, 0), upperArmL: r(30, 0, -110), lowerArmL: r(10, 0, 0), head: r(-12, 0, 0) },
    tweak: { thighL: r(-22, 0, -18), upperArmL: r(-10, 0, -16) },
  },
  // Back hand on the tail, back foot kicked off and down behind.
  benihana: {
    hand: 'R', at: { x: 0, y: 0, z: TAIL - 0.03 }, tilt: r(-38, 0, 14), knees: [74, 20], splay: [20, 20], curl: 28, boardLift: 0.12,
    extra: { thighR: r(-54, 0, 22), shinR: r(-20, 0, 0), footR: r(30, 0, 0), upperArmL: r(50, 0, -104), head: r(-10, 0, 0) },
    tweak: { thighR: r(-16, 0, 12), upperArmL: r(-10, 0, -16) },
    freeFoot: 'R',
  },
  // Back hand on the toe edge, front foot off and crossed forward over the nose.
  crossbone: {
    hand: 'R', at: { x: TOE, y: 0, z: 0.0 }, tilt: r(-30, -20, 30), knees: [20, 74], splay: [10, 26], curl: 28, boardLift: 0.12,
    extra: { thighL: r(70, 0, -22), shinL: r(-6, 0, 0), footL: r(-30, 0, 0), upperArmL: r(10, 0, -110), head: r(-10, 0, 0) },
    tweak: { thighL: r(16, 0, -10), upperArmL: r(-10, 0, -16) },
    freeFoot: 'L',
  },
};

const GRAB_IDS = Object.keys(GRABS) as GrabId[];

/** The held grab pose (phase 0.5). `variant` may be a tweaked_ id (skater.grabId): the tweak layer is added. */
function heldGrab(variant: BaseTrickId | null): Pose {
  const raw = variant ?? 'indy';
  const tweaked = raw.startsWith('tweaked_');
  const def = GRABS[raw.replace(/^tweaked_/, '') as GrabId] ?? GRABS.indy;
  const k = tweaked ? GRAB_TWEAK_TILT : 1;
  const [kneeL, kneeR] = def.knees;
  const legs = layer(bentLeg('L', kneeL, def.splay[0], 18), bentLeg('R', kneeR, def.splay[1], -3));
  const curl = { spine: r(-def.curl, 0, 0), chest: r(-def.curl * 0.45, 0, 0), head: r(def.curl * 0.6, 0, 0) };
  let bones = layer(layer(layer(RIDE_UPPER, curl), legs), def.extra);
  if (tweaked) bones = layer(bones, def.tweak);
  // Hips: sit for the less bent planted knee, so both IK feet reach the lifted board without folding the body into a ball.
  const plantedKnee = def.freeFoot === 'L' ? kneeR : def.freeFoot === 'R' ? kneeL : Math.min(kneeL, kneeR);
  return pose(bones, hipsFor(plantedKnee, def.boardLift), {
    contacts: {
      footL: def.freeFoot === 'L' ? null : RIDE_FEET.footL,
      footR: def.freeFoot === 'R' ? null : RIDE_FEET.footR,
      handL: def.hand === 'L' ? def.at : null,
      handR: def.hand === 'R' ? def.at : null,
    },
    board: { tilt: r(def.tilt.x * k, def.tilt.y * k, def.tilt.z * k), pivotZ: 0, offset: { x: 0, y: def.boardLift, z: 0 } },
  });
}

function grabPose(variant: BaseTrickId | null, phase: number): Pose {
  const held = heldGrab(variant);
  // 0 .. 0.5 reach in, hold at 0.5, 0.5 .. 1 release back to the air pose.
  const p = clamp(phase, 0, 1);
  if (p <= 0.5) return blendPoses(AIR, held, ease(p / 0.5));
  return blendPoses(held, AIR, ease((p - 0.5) / 0.5));
}

interface GrindDef {
  readonly knees: readonly [number, number];
  readonly tilt: JointRotation;
  readonly pivotZ: number;
  readonly rootYaw: number;
  readonly upper: Bones;
  readonly feet?: PoseContacts;
}

const SLIDE_FEET: PoseContacts = { footL: { x: -0.16, z: 0, yaw: 90 }, footR: { x: 0.2, z: 0.02, yaw: 90 }, handL: null, handR: null };

// Grind arm signatures (regular stance: the left arm is the front arm, over the nose). Each grind
// reads from the upper body alone: 50-50 both arms low and forward; 5-0 front arm up over the nose;
// nosegrind back arm up; slides both arms forward of the chest with the chest turned to travel;
// feeble / smith front arm straight down at the hip, back arm high.
const ARMS_LOW_FORWARD: Bones = { upperArmL: r(30, 0, -30), lowerArmL: r(30, 0, 0), upperArmR: r(26, 0, 30), lowerArmR: r(26, 0, 0) };
const FRONT_ARM_UP: Bones = { upperArmL: r(-20, 0, -110), lowerArmL: r(0, 0, -25), upperArmR: r(24, 0, 36), lowerArmR: r(40, 0, 0) };
const BACK_ARM_UP: Bones = { upperArmL: r(30, 0, -34), lowerArmL: r(40, 0, 0), upperArmR: r(-16, 0, 112), lowerArmR: r(0, 0, 25) };
const ARMS_FORWARD_CHEST: Bones = { upperArmL: r(40, 0, -20), lowerArmL: r(50, 0, 0), upperArmR: r(40, 0, 24), lowerArmR: r(46, 0, 0) };
const FRONT_DOWN_BACK_HIGH: Bones = { upperArmL: r(6, 0, -8), lowerArmL: r(12, 0, 0), upperArmR: r(0, 0, 118), lowerArmR: r(10, 0, 30) };
const SLIDE_UPPER: Bones = layer(ARMS_FORWARD_CHEST, { hips: r(0, -12, 0), spine: r(-8, -10, 0), chest: r(-4, -20, 0), neck: r(0, -8, 0), head: r(6, -20, 0) });

const GRINDS: Readonly<Record<GrindTypeId, GrindDef>> = {
  fifty_fifty: { knees: [28, 30], tilt: ZERO_ROT, pivotZ: 0, rootYaw: 0, upper: layer(ARMS_LOW_FORWARD, { spine: r(-6, 0, 0) }) },
  five_o: { knees: [14, 48], tilt: r(18, 0, 0), pivotZ: RIG.truckZ, rootYaw: 0, upper: layer(FRONT_ARM_UP, { spine: r(0, 0, -12), chest: r(0, 0, -6) }) },
  nosegrind: { knees: [48, 14], tilt: r(-18, 0, 0), pivotZ: -RIG.truckZ, rootYaw: 0, upper: layer(BACK_ARM_UP, { spine: r(0, 0, 12), chest: r(0, 0, 8) }) },
  boardslide: { knees: [36, 36], tilt: r(0, 90, 0), pivotZ: 0, rootYaw: 90, upper: SLIDE_UPPER, feet: SLIDE_FEET },
  lipslide: { knees: [36, 36], tilt: r(0, -90, 0), pivotZ: 0, rootYaw: -90, upper: SLIDE_UPPER, feet: SLIDE_FEET },
  crooked: { knees: [50, 18], tilt: r(-14, 24, 0), pivotZ: -RIG.truckZ, rootYaw: 0, upper: layer(BACK_ARM_UP, { spine: r(0, 0, 14), chest: r(0, 10, 8), upperArmL: r(10, 0, -20) }) },
  overcrook: { knees: [50, 18], tilt: r(-14, -24, 0), pivotZ: -RIG.truckZ, rootYaw: 0, upper: layer(BACK_ARM_UP, { spine: r(0, 0, 14), chest: r(0, -10, 8), upperArmL: r(10, 0, -20) }) },
  feeble: { knees: [22, 46], tilt: r(-10, 30, 0), pivotZ: RIG.truckZ, rootYaw: 0, upper: layer(FRONT_DOWN_BACK_HIGH, { spine: r(0, 8, -10), chest: r(0, 8, -6) }) },
  smith: { knees: [16, 50], tilt: r(-14, -30, 0), pivotZ: RIG.truckZ, rootYaw: 0, upper: layer(FRONT_DOWN_BACK_HIGH, { spine: r(-6, -8, -12), chest: r(0, -8, -8), upperArmR: r(0, 0, -20) }) },
  gpu_slide: { knees: [40, 40], tilt: r(0, 90, 0), pivotZ: 0, rootYaw: 90, upper: { hips: r(0, -12, 0), spine: r(10, -10, 0), chest: r(6, -14, 0), head: r(-14, -10, 0), upperArmL: r(150, 0, -20), lowerArmL: r(0, 0, 0), upperArmR: r(-40, 0, 50), lowerArmR: r(40, 0, 0) }, feet: SLIDE_FEET },
};

const GRIND_IDS = Object.keys(GRINDS) as GrindTypeId[];

/** Balance lean for the h axis: needle01 0 = full left. Body rolls into the lean, arms windmill against it. */
function leanH(p: Pose, needle01: number, degPerUnit: number): Pose {
  const needle = clamp(needle01, 0, 1) * 2 - 1;
  const leaned = withRoot(p, { roll: -needle * degPerUnit });
  return withBones(leaned, { upperArmL: r(0, 0, needle * 24), upperArmR: r(0, 0, needle * 24), spine: r(0, 0, needle * 6) });
}

function grindPose(variant: BaseTrickId | null, phase: number): Pose {
  const def = GRINDS[(variant ?? 'fifty_fifty') as GrindTypeId] ?? GRINDS.fifty_fifty;
  let p = ride(def.knees[0], def.knees[1], def.upper);
  p = withBoard(p, { tilt: def.tilt, pivotZ: def.pivotZ });
  p = withRoot(p, { yaw: def.rootYaw });
  if (def.feet) p = withContacts(p, def.feet);
  return leanH(p, phase, TUNING.SKATER_LEAN_DEG);
}

function manualPose(nose: boolean, variant: BaseTrickId | null, needle01: number): Pose {
  const needle = clamp(needle01, 0, 1) * 2 - 1;
  // Manual: tail down; nose manual: nose down. Deeper toward the bail side of the needle
  // (24 +/- 12 deg: arcade-exaggerated so the tail dip reads from the chase camera).
  const depth = nose ? 24 - needle * 12 : 24 + needle * 12;
  const tilt = nose ? r(-depth, 0, 0) : r(depth, 0, 0);
  const lean = nose ? 10 : -10;
  const wide = variant === 'context_window';
  const upper: Bones = wide
    ? { spine: r(0, 0, lean), chest: r(-6, 0, 0), head: r(-14, 0, 0), upperArmL: r(0, 0, -90), upperArmR: r(0, 0, 90), lowerArmL: r(0, 0, -20), lowerArmR: r(0, 0, 20) }
    : nose
      ? { spine: r(-8, 0, lean), chest: r(-4, 0, 4), upperArmL: r(-30, 0, -40), upperArmR: r(60, 0, 30), lowerArmL: r(10, 0, 0), lowerArmR: r(10, 0, 0) }
      : { spine: r(0, 0, lean - needle * 6), chest: r(0, 0, -4), upperArmL: r(60, 0, -34), upperArmR: r(-30, 0, 40), lowerArmL: r(10, 0, 0), lowerArmR: r(10, 0, 0) };
  const p = nose ? ride(46, 12, upper) : ride(12, 46, upper);
  return withBoard(p, { tilt, pivotZ: nose ? -RIG.truckZ : RIG.truckZ });
}

function lipPose(variant: BaseTrickId | null, needle01: number): Pose {
  const rock = variant === 'rock_to_fakie';
  // Rock: the front arm reaches over the coping; axle stall: hands low and ready to drop back in.
  const base = rock
    ? withBoard(ride(30, 24, layer(FRONT_ARM_UP, { spine: r(0, 0, 12), chest: r(0, 6, 6) })), { tilt: r(-14, 0, 0), pivotZ: 0 })
    : ride(18, 20, layer(ARMS_LOW_FORWARD, { spine: r(4, 0, 0), head: r(-6, 0, 0), upperArmR: r(-10, 0, 30) }));
  return leanH(base, needle01, TUNING.SKATER_LEAN_DEG * TUNING.SKATER_LIP_LEAN_RATIO);
}

function revertPose(phase: number): Pose {
  // The board's 180 pivot comes from boardRel (sim); the body winds up and swings the arms across.
  const s = Math.sin(clamp(phase, 0, 1) * Math.PI);
  const base = ride(30, 30, { spine: r(-6, 0, 0) });
  return withBones(base, { chest: r(0, 40 * s, 0), hips: r(0, -20 * s, 0), upperArmL: r(0, 0, -50 * s), upperArmR: r(0, 0, 50 * s), head: r(0, -20 * s, 0) });
}

function transferPose(phase: number): Pose {
  // Over the spine: tuck with the back hand on the board, looking down at the far face.
  const tuck = withContacts(
    pose(layer(layer(layer(RIDE_UPPER, { spine: r(-24, 0, 0), chest: r(-10, 0, 0), head: r(22, 0, 0), upperArmL: r(40, 0, -60) }), bentLeg('L', 66, 12, 18)), bentLeg('R', 68, 14, -3)), hipsFor(66, 0.08), {
      board: { tilt: r(0, 0, 18), pivotZ: 0, offset: { x: 0, y: 0.08, z: 0 } },
    }),
    { footL: RIDE_FEET.footL, footR: RIDE_FEET.footR, handR: { x: TOE, y: 0, z: 0.04 } },
  );
  const s = Math.sin(clamp(phase, 0, 1) * Math.PI);
  return withRoot(blendPoses(AIR, tuck, s), { pitch: -18 * s });
}

function specialPose(variant: BaseTrickId | null, phase: number): Pose {
  const p = clamp(phase, 0, 1);
  const tuckBones = layer(layer(RIDE_UPPER, bentLeg('L', 52, 12, 18)), bentLeg('R', 54, 14, -3));
  const tuck = pose(tuckBones, hipsFor(52, 0.06), { contacts: RIDE_FEET, board: { tilt: ZERO_ROT, pivotZ: 0, offset: { x: 0, y: 0.06, z: 0 } } });
  switch (variant as SpecialId | null) {
    case 'kernel_panic': {
      // Hands clutch the head, elbows out, the whole body shakes.
      const jit = Math.sin(p * 46) * 6;
      return withBones(tuck, {
        upperArmL: r(150, 0, -70), lowerArmL: r(130, 0, 0), upperArmR: r(150, 0, 70), lowerArmR: r(130, 0, 0),
        head: r(-10 + jit, jit, -jit), chest: r(-8, jit * 0.5, 0), spine: r(-10, 0, jit * 0.5),
      });
    }
    case 'token_overflow': {
      // Arms burst wide, head back, chest open.
      const burst = ease(p * 1.6);
      return withBones(tuck, {
        upperArmL: r(30 * burst, 0, -150 * burst), upperArmR: r(30 * burst, 0, 150 * burst), lowerArmL: r(0, 0, -20 * burst), lowerArmR: r(0, 0, 20 * burst),
        head: r(-30 * burst, 0, 0), chest: r(14 * burst, 0, 0), spine: r(8 * burst, 0, 0),
      });
    }
    case 'inference_900ms':
    default: {
      // Thinking: arms folded, head tilted, slowly pondering harder.
      const hold = ease(p);
      return withBones(tuck, {
        upperArmL: r(70, 0, -12), lowerArmL: r(60, 90, 0), upperArmR: r(70, 0, 12), lowerArmR: r(60, -90, 0),
        head: r(-6, 30 * hold, 18 * hold), chest: r(-6, 10 * hold, 0),
      });
    }
  }
}

function bailPose(t: number): Pose {
  // Ragdoll-lite scripted tumble: dive forward over the nose, hit flat, roll onto the back.
  const flail = pose(layer(layer(layer(RIDE_UPPER, { spine: r(-24, 0, 0), chest: r(-10, 0, 0), head: r(20, 0, 0), upperArmL: r(110, 0, -30), upperArmR: r(120, 0, 30), lowerArmL: r(30, 0, 0), lowerArmR: r(30, 0, 0) }), bentLeg('L', 30, 12, 18)), bentLeg('R', -20, 14, -3)), hipsFor(30, 0.08), {
    root: { yaw: 0, pitch: -24, roll: 0, lift: 0.05 },
  });
  // Dive: the arms reach out to break the fall, the body rolls so the shoulder hits first.
  const dive = pose(layer(layer(layer(RIDE_UPPER, { spine: r(-10, 0, 0), chest: r(-6, 0, 0), head: r(30, 0, 0), upperArmL: r(150, 0, -30), upperArmR: r(140, 0, 40), lowerArmL: r(30, 0, 0), lowerArmR: r(20, 0, 0) }), bentLeg('L', -30, 12, 18)), bentLeg('R', -40, 14, -3)), 0.05, {
    root: { yaw: 0, pitch: -70, roll: 25, lift: 0.3 },
  });
  // Flat: a brace, both arms in front of the chest, elbows bent; the torso held off the ground.
  const flat = pose(layer(layer(layer(RIDE_UPPER, { hips: r(0, 0, 0), spine: r(0, 0, 0), chest: r(0, 0, 0), head: r(-30, 0, 0), upperArmL: r(110, 0, -35), upperArmR: r(110, 0, 35), lowerArmL: r(70, 0, 0), lowerArmR: r(70, 0, 0) }), bentLeg('L', 10, 20, 0)), bentLeg('R', -10, 22, 0)), 0, {
    root: { yaw: 10, pitch: -92, roll: 12, lift: 0.14 },
  });
  // Rolled: the body spins as it slides (root yaw), arms flung.
  const rolled = pose(layer({ head: r(10, 0, 0), upperArmL: r(30, 0, -120), upperArmR: r(40, 0, 130), lowerArmL: r(-40, 0, 0), lowerArmR: r(-30, 0, 0), spine: r(6, 0, 0) }, layer(bentLeg('L', 40, 16, 0), bentLeg('R', 20, 18, 0))), 0, {
    root: { yaw: 35, pitch: -92, roll: 180, lift: 0.06 },
  });
  const sprawl = pose(layer({ head: r(6, 0, 0), upperArmL: r(10, 0, -110), upperArmR: r(10, 0, 110), lowerArmL: r(-20, 0, 0), lowerArmR: r(-20, 0, 0) }, layer(bentLeg('L', 16, 22, 0), bentLeg('R', 8, 26, 0))), 0, {
    root: { yaw: 50, pitch: -92, roll: 180, lift: 0.06 },
  });
  return track(t, [
    [0, flail],
    [0.25, dive],
    [0.45, flat],
    [0.75, rolled],
    [1, sprawl],
  ]);
}

function getupPose(t: number): Pose {
  const lying = bailPose(1);
  const sitting = pose(layer(layer({ spine: r(-30, 0, 0), chest: r(-10, 0, 0), head: r(20, 0, 0), upperArmL: r(-40, 0, -20), upperArmR: r(-40, 0, 20), lowerArmL: r(-10, 0, 0), lowerArmR: r(-10, 0, 0) }, bentLeg('L', 80, 14, 0)), bentLeg('R', 84, 16, 0)), -0.62, {
    root: { yaw: 0, pitch: -20, roll: 0, lift: 0 },
  });
  const crouched = ride(56, 56, { spine: r(-24, 8, 0), chest: r(-10, 8, 0), head: r(14, 0, 0), upperArmL: r(30, 0, -30), upperArmR: r(20, 0, 30), lowerArmL: r(40, 0, 0), lowerArmR: r(40, 0, 0) });
  return track(t, [
    [0, lying],
    [0.4, sitting],
    [0.75, crouched],
    [1, ROLL],
  ]);
}

/** Every pose id must resolve (skater.test, REQ-SKT-03). */
export function getPose(poseId: PoseId, variant: BaseTrickId | null, phase: number): Pose {
  const p = Number.isFinite(phase) ? clamp(phase, 0, 1) : 0;
  switch (poseId) {
    case 'roll':
      return rollPose(p);
    case 'push':
      return pushPose(p);
    case 'brake':
      return brakePose(p);
    case 'pump':
      return PUMP;
    case 'crouch':
      return crouchPose(p);
    case 'pop':
      return popPose(p);
    case 'air':
      return AIR;
    case 'flip':
      return flipPose(variant, p);
    case 'grab':
      return grabPose(variant, p);
    case 'special':
      return specialPose(variant, p);
    case 'grind':
      return grindPose(variant, p);
    case 'manual':
      return manualPose(false, variant, p);
    case 'noseManual':
      return manualPose(true, variant, p);
    case 'lip':
      return lipPose(variant, p);
    case 'revert':
      return revertPose(p);
    case 'transfer':
      return transferPose(p);
    case 'bail':
      return bailPose(p);
    case 'getup':
      return getupPose(p);
  }
}

/** Pose ids with the variants each accepts, for tests and the dev harness. */
export const POSE_CATALOG: readonly { readonly pose: PoseId; readonly variants: readonly (BaseTrickId | null)[] }[] = [
  { pose: 'roll', variants: [null] },
  { pose: 'push', variants: [null] },
  { pose: 'brake', variants: [null] },
  { pose: 'pump', variants: [null] },
  { pose: 'crouch', variants: [null] },
  { pose: 'pop', variants: [null] },
  { pose: 'air', variants: [null] },
  { pose: 'flip', variants: [...(Object.keys(FLIP_AXES) as FlipId[]), ...(Object.keys(ENHANCED_FLIP_AXES) as EnhancedFlipId[])] },
  { pose: 'grab', variants: GRAB_IDS },
  { pose: 'special', variants: ['kernel_panic', 'token_overflow', 'inference_900ms'] },
  { pose: 'grind', variants: GRIND_IDS },
  { pose: 'manual', variants: ['manual', 'context_window'] },
  { pose: 'noseManual', variants: ['nose_manual', 'context_window'] },
  { pose: 'lip', variants: ['axle_stall', 'rock_to_fakie'] },
  { pose: 'revert', variants: [null] },
  { pose: 'transfer', variants: [null] },
  { pose: 'bail', variants: [null] },
  { pose: 'getup', variants: [null] },
];

// ---------------------------------------------------------------------------------------------
// Board flip rotation
// ---------------------------------------------------------------------------------------------

function axisQuat(x: number, y: number, z: number, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(h) };
}

/**
 * Board orientation relative to the body for a flip at phase 0..1: yaw about +y (skater frame),
 * then pitch about +x, then roll about the deck's own long axis (+z), each at turns x 2 PI x phase,
 * so the rotation completes exactly when phase reaches 1 (REQ-SKT-04). Identity at 0; identity at
 * 1 for every whole-turn trick (a half-turn shove-it ends nose-for-tail, which the symmetric deck
 * hides). A pitch wobble (hardflip) adds pitchWobble x sin(PI x phase) degrees, back to 0 at phase
 * 1, so every flip lands grip up.
 */
export function boardFlipRotation(flipId: FlipId | EnhancedFlipId, phase: number): Quat {
  const axes = flipAxesOf(flipId);
  const p = clamp(Number.isFinite(phase) ? phase : 0, 0, 1);
  const tau = Math.PI * 2;
  const wobble = ((axes.pitchWobble ?? 0) * Math.PI / 180) * Math.sin(Math.PI * p);
  const qYaw = axisQuat(0, 1, 0, axes.yaw * tau * p);
  const qPitch = axisQuat(1, 0, 0, axes.pitch * tau * p + wobble);
  const qRoll = axisQuat(0, 0, 1, axes.roll * tau * p);
  return mulQuat(mulQuat(qYaw, qPitch), qRoll);
}
