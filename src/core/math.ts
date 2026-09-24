/**
 * src/core/math.ts: small pure helpers on the plain records of src/core/types.ts (frozen after M0).
 * Implementations may use three.js math classes instead; these exist so boundary code, data files
 * and tests do not each reinvent them. Heading convention: see src/core/types.ts.
 */

import type { Facing, Quat, Vec3 } from './types';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * Level authoring helper: DESIGN.md's G tables list points as (x, z, y). xzy(41.6, 38, 1.2)
 * returns { x: 41.6, y: 1.2, z: 38 }. Use it when transcribing those tables to avoid axis swaps.
 */
export function xzy(x: number, z: number, y: number): Vec3 {
  return { x, y, z };
}

export const ZERO3: Vec3 = { x: 0, y: 0, z: 0 };
export const UP3: Vec3 = { x: 0, y: 1, z: 0 };
export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function len3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Unit vector, or (0, 0, 0) for a zero-length input. */
export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : ZERO3;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Copy any {x, y, z} (for example a three.Vector3) into a plain frozen-shape record. */
export function copy3(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function copyQuat(q: Quat): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** forward(yaw) = (-sin yaw, 0, -cos yaw): yaw 0 = north (-z), +PI/2 = west. */
export function yawToForward(yaw: number): Vec3 {
  return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

/** Inverse of yawToForward for any horizontal-ish vector (y ignored). */
export function forwardToYaw(f: Vec3): number {
  return Math.atan2(-f.x, -f.z);
}

/** Compass facing to yaw: north 0, west PI/2, south PI, east -PI/2. */
export function facingToYaw(facing: Facing): number {
  switch (facing) {
    case 'north':
      return 0;
    case 'west':
      return Math.PI / 2;
    case 'south':
      return Math.PI;
    case 'east':
      return -Math.PI / 2;
  }
}

/** Unit world vector for a compass facing. */
export function facingVector(facing: Facing): Vec3 {
  switch (facing) {
    case 'north':
      return { x: 0, y: 0, z: -1 };
    case 'south':
      return { x: 0, y: 0, z: 1 };
    case 'east':
      return { x: 1, y: 0, z: 0 };
    case 'west':
      return { x: -1, y: 0, z: 0 };
  }
}

/** Rotation about +y by yaw (three convention), as a quaternion. */
export function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Shortest-path spherical interpolation. */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number;
  let k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const theta = Math.acos(cos);
    const s = Math.sin(theta);
    k0 = Math.sin((1 - t) * theta) / s;
    k1 = Math.sin(t * theta) / s;
  }
  const x = a.x * k0 + bx * k1;
  const y = a.y * k0 + by * k1;
  const z = a.z * k0 + bz * k1;
  const w = a.w * k0 + bw * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}

/** Rotate a vector by a unit quaternion. */
export function rotate3(q: Quat, v: Vec3): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(a: number): number {
  let r = a % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}
