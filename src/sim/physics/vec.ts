/**
 * src/sim/physics/vec.ts (sim track): small pure helpers on plain Vec3 / Quat records that
 * src/core/math.ts does not have (rotation about an axis, plane projection, angles, basis quaternion).
 * Everything returns fresh records; nothing here holds state.
 */

import { add3, cross3, dot3, len3, norm3, RAD, scale3, sub3 } from '../../core/math';
import type { Quat, Vec3 } from '../../core/types';

export const UP: Vec3 = { x: 0, y: 1, z: 0 };
const EPS = 1e-9;

/** v with its component along the unit normal n removed. */
export function projectOnPlane(v: Vec3, n: Vec3): Vec3 {
  return sub3(v, scale3(n, dot3(v, n)));
}

/** Horizontal part of v (y = 0). */
export function horizontal(v: Vec3): Vec3 {
  return { x: v.x, y: 0, z: v.z };
}

/** Unit vector, or `fallback` when v is (near) zero. */
export function normOr(v: Vec3, fallback: Vec3): Vec3 {
  const l = len3(v);
  return l > 1e-6 ? scale3(v, 1 / l) : fallback;
}

/** Rodrigues rotation of v about the unit axis by `angle` radians (right-hand rule). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = axis;
  const kxv = cross3(k, v);
  const kdv = dot3(k, v);
  return {
    x: v.x * c + kxv.x * s + k.x * kdv * (1 - c),
    y: v.y * c + kxv.y * s + k.y * kdv * (1 - c),
    z: v.z * c + kxv.z * s + k.z * kdv * (1 - c),
  };
}

/** Unsigned angle between two vectors in degrees (0 if either is zero). */
export function angleDeg(a: Vec3, b: Vec3): number {
  const la = len3(a);
  const lb = len3(b);
  if (la < EPS || lb < EPS) return 0;
  const c = Math.max(-1, Math.min(1, dot3(a, b) / (la * lb)));
  return Math.acos(c) * RAD;
}

/** Signed angle in radians from a to b measured about the unit axis (both are projected on its plane). */
export function signedAngleAbout(a: Vec3, b: Vec3, axis: Vec3): number {
  const pa = projectOnPlane(a, axis);
  const pb = projectOnPlane(b, axis);
  return Math.atan2(dot3(cross3(pa, pb), axis), dot3(pa, pb));
}

/** Rotate unit vector `from` toward unit vector `to` by at most maxRad (the auto-orient slerp). */
export function rotateToward(from: Vec3, to: Vec3, maxRad: number): Vec3 {
  const c = Math.max(-1, Math.min(1, dot3(from, to)));
  const ang = Math.acos(c);
  if (ang <= maxRad || ang < 1e-7) return norm3(to);
  let axis = cross3(from, to);
  if (len3(axis) < 1e-9) {
    // Opposite vectors: any perpendicular axis works.
    axis = Math.abs(from.y) < 0.9 ? cross3(from, UP) : cross3(from, { x: 1, y: 0, z: 0 });
  }
  return norm3(rotateAbout(from, norm3(axis), maxRad));
}

/** Slope of a surface normal in degrees (0 = flat floor). */
export function slopeOf(n: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, n.y))) * RAD;
}

/**
 * Quaternion taking the skater local frame (-z nose, +y up, +x right) to world, from a nose and an
 * up vector. The nose is re-orthogonalised against up; a degenerate nose falls back to world north.
 */
export function basisQuat(nose: Vec3, up: Vec3): Quat {
  const y = normOr(up, UP);
  let f = projectOnPlane(nose, y);
  if (len3(f) < 1e-6) f = projectOnPlane({ x: 0, y: 0, z: -1 }, y);
  if (len3(f) < 1e-6) f = projectOnPlane({ x: 1, y: 0, z: 0 }, y);
  const fwd = norm3(f);
  const z = scale3(fwd, -1);
  const x = cross3(y, z);
  // Rotation matrix with columns x, y, z -> quaternion (Shepperd).
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  const l = Math.hypot(qx, qy, qz, qw) || 1;
  return { x: qx / l + 0, y: qy / l + 0, z: qz / l + 0, w: qw / l + 0 };
}

/** a + b * s */
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return add3(a, scale3(b, s));
}

/** Plain copy that is safe to store in a snapshot (drops any class identity, rounds -0 to 0). */
export function plain(v: Vec3): Vec3 {
  return { x: v.x + 0, y: v.y + 0, z: v.z + 0 };
}
