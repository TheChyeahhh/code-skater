/**
 * src/render/skater/ik.ts (skater track): two-bone IK for the rig's limbs, so planted feet sit on
 * the deck and grabbing hands reach the board whatever the authored angles say (REQ-SKT-03,
 * REQ-SKT-05 "no interpenetration"). Pure three.js math on the bone hierarchy; node-testable.
 *
 * Solves in a reference frame R (an ancestor of the limb, normally the rig root's parent group):
 * given the upper bone's pivot P, the target T for the lower bone's end, lengths l1 and l2 and a
 * pole hint (where the middle joint should bend toward), it sets upper.quaternion and
 * lower.quaternion so the chain ends at T (or reaches toward it when out of range).
 */

import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

// Module scratch: the solver runs up to four times per rendered frame, so it allocates nothing.
const tmpB = new Vector3();
const tmpN = new Vector3();
const tmpPerp = new Vector3();
const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpZ = new Vector3();
const sPivot = new Vector3();
const sKnee = new Vector3();
const sEnd = new Vector3();
const sDirUpper = new Vector3();
const sDirLower = new Vector3();
const sDecompPos = new Vector3();
const sDecompScale = new Vector3();
const tmpM = new Matrix4();
const tmpInv = new Matrix4();
const qUpperFrame = new Quaternion();
const qLowerFrame = new Quaternion();
const qFrameInv = new Quaternion();
const qWorld = new Quaternion();
const qInFrame = new Quaternion();
const qLocal = new Quaternion();

/** World-space quaternion of an object (matrixWorld must be current). */
function worldQuat(o: Object3D, out: Quaternion): Quaternion {
  o.matrixWorld.decompose(sDecompPos, out, sDecompScale);
  return out;
}

/**
 * Quaternion whose local -y points along `dir` and whose local -z points as close to `front` as
 * possible (the limb's front side). Both in the same frame.
 */
function limbQuat(dir: Vector3, front: Vector3, out: Quaternion): Quaternion {
  tmpY.copy(dir).multiplyScalar(-1).normalize(); // local +y
  tmpZ.copy(front).multiplyScalar(-1); // local +z = -front
  tmpZ.addScaledVector(tmpY, -tmpZ.dot(tmpY));
  if (tmpZ.lengthSq() < 1e-8) {
    // front parallel to dir: pick any perpendicular.
    tmpZ.set(1, 0, 0).addScaledVector(tmpY, -tmpY.x);
    if (tmpZ.lengthSq() < 1e-8) tmpZ.set(0, 0, 1).addScaledVector(tmpY, -tmpY.z);
  }
  tmpZ.normalize();
  tmpX.crossVectors(tmpY, tmpZ).normalize();
  tmpM.makeBasis(tmpX, tmpY, tmpZ);
  return out.setFromRotationMatrix(tmpM);
}

export interface TwoBoneInput {
  /** The upper bone (its position is the chain's pivot). */
  readonly upper: Object3D;
  /** The lower bone, a child of upper at (0, -l1, 0). */
  readonly lower: Object3D;
  /** The end effector, a child of lower at (0, -l2, 0) (the foot or hand anchor). */
  readonly end: Object3D;
  /** Target for the end effector, in the frame of `frame`. */
  readonly target: Vector3;
  /** Point the middle joint should bend toward, in the frame of `frame`. */
  readonly pole: Vector3;
  /** The reference frame object (an ancestor of upper); its matrixWorld must be current. */
  readonly frame: Object3D;
  /** Blend weight 0..1 (0 = leave the FK rotations). */
  readonly weight: number;
}

/**
 * Solve the chain in place. Call after the FK pose is applied and frame.updateMatrixWorld(true)
 * has run; the function refreshes the matrices it touches.
 */
export function solveTwoBone(input: TwoBoneInput): void {
  const { upper, lower, end, target, pole, frame, weight } = input;
  if (weight <= 0) return;
  tmpInv.copy(frame.matrixWorld).invert();
  // Pivot and lengths in the frame.
  upper.updateWorldMatrix(true, false);
  const P = sPivot.setFromMatrixPosition(upper.matrixWorld).applyMatrix4(tmpInv);
  const l1 = lower.position.length();
  const l2 = end.position.length();
  if (l1 <= 0 || l2 <= 0) return;
  const toT = tmpB.copy(target).sub(P);
  let d = toT.length();
  if (d < 1e-6) return;
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) d = maxD;
  const n = tmpN.copy(toT).normalize();
  // Angle at the pivot between the chain and the target line (law of cosines).
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // Bend plane from the pole.
  tmpPerp.copy(pole).sub(P);
  tmpPerp.addScaledVector(n, -tmpPerp.dot(n));
  if (tmpPerp.lengthSq() < 1e-8) tmpPerp.set(0, 0, -1).addScaledVector(n, n.z);
  tmpPerp.normalize();
  const knee = sKnee.copy(P).addScaledVector(n, l1 * cosA).addScaledVector(tmpPerp, l1 * sinA);
  // Desired world(frame)-space orientations: upper along P->knee, lower along knee->end; front = the bend side.
  const dirUpper = sDirUpper.copy(knee).sub(P).normalize();
  const endPt = sEnd.copy(P).addScaledVector(n, d);
  const dirLower = sDirLower.copy(endPt).sub(knee).normalize();
  limbQuat(dirUpper, tmpPerp, qUpperFrame);
  limbQuat(dirLower, tmpPerp, qLowerFrame);
  // Convert into local space: local = inverse(parent in frame) * desired, parent in frame = inverse(frameQ) * parentWorld.
  worldQuat(frame, qFrameInv).invert();
  const parentUpper = upper.parent;
  if (!parentUpper) return;
  parentUpper.updateWorldMatrix(true, false);
  qInFrame.copy(qFrameInv).multiply(worldQuat(parentUpper, qWorld));
  qLocal.copy(qInFrame).invert().multiply(qUpperFrame);
  if (weight >= 1) upper.quaternion.copy(qLocal);
  else upper.quaternion.slerp(qLocal, weight);
  upper.updateWorldMatrix(false, false);
  qInFrame.copy(qFrameInv).multiply(worldQuat(upper, qWorld));
  qLocal.copy(qInFrame).invert().multiply(qLowerFrame);
  if (weight >= 1) lower.quaternion.copy(qLocal);
  else lower.quaternion.slerp(qLocal, weight);
  lower.updateWorldMatrix(false, false);
}

/** Position of an object's origin in the frame of `frame` (matrices must be current). */
export function positionInFrame(o: Object3D, frame: Object3D, out: Vector3): Vector3 {
  o.updateWorldMatrix(true, false);
  tmpInv.copy(frame.matrixWorld).invert();
  return out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(tmpInv);
}

/**
 * Set an object's orientation so that, in the frame of `frame`, it equals `qFrame`
 * (parent matrices must be current).
 */
export function setQuaternionInFrame(o: Object3D, frame: Object3D, qFrame: Quaternion): void {
  const parent = o.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  worldQuat(frame, qFrameInv).invert();
  qInFrame.copy(qFrameInv).multiply(worldQuat(parent, qWorld));
  o.quaternion.copy(qInFrame.invert().multiply(qFrame));
}
