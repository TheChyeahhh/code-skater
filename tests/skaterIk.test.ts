// tests/skaterIk.test.ts (skater track): the two-bone IK that plants feet on the deck and hands on a
// grab (REQ-SKT-03, REQ-SKT-05) reaches its target, bends toward the pole, and allocates no
// Vector3 / Quaternion clones per call (it runs up to four times per rendered frame).
import { afterEach, describe, expect, it } from 'vitest';
import { Group, Object3D, Quaternion, Vector3 } from 'three';
import { positionInFrame, setQuaternionInFrame, solveTwoBone } from '../src/render/skater/ik';

function chain(): { frame: Group; upper: Object3D; lower: Object3D; end: Object3D } {
  const frame = new Group();
  frame.position.set(3, 1, -2);
  frame.rotation.set(0.2, 0.9, -0.1);
  const hips = new Object3D();
  hips.position.set(0, 0.9, 0);
  hips.rotation.set(0.1, -0.3, 0.05);
  frame.add(hips);
  const upper = new Object3D();
  upper.position.set(0.1, -0.02, 0);
  hips.add(upper);
  const lower = new Object3D();
  lower.position.set(0, -0.42, 0);
  upper.add(lower);
  const end = new Object3D();
  end.position.set(0, -0.42, 0);
  lower.add(end);
  frame.updateMatrixWorld(true);
  return { frame, upper, lower, end };
}

const realV = Vector3.prototype.clone;
const realQ = Quaternion.prototype.clone;
afterEach(() => {
  Vector3.prototype.clone = realV;
  Quaternion.prototype.clone = realQ;
});

describe('two-bone IK (REQ-SKT-03, REQ-SKT-05)', () => {
  it('puts the end on a reachable target and bends the middle joint toward the pole', () => {
    const { frame, upper, lower, end } = chain();
    const target = new Vector3(0.25, 0.25, -0.2);
    const pole = new Vector3(0.1, 0.6, -1);
    solveTwoBone({ upper, lower, end, target, pole, frame, weight: 1 });
    frame.updateMatrixWorld(true);
    const got = positionInFrame(end, frame, new Vector3());
    expect(got.distanceTo(target)).toBeLessThan(1e-4);
    const knee = positionInFrame(lower, frame, new Vector3());
    const hip = positionInFrame(upper, frame, new Vector3());
    // The knee sits on the pole's side of the hip-target line.
    const line = target.clone().sub(hip).normalize();
    const kneeOff = knee.clone().sub(hip);
    kneeOff.addScaledVector(line, -kneeOff.dot(line));
    const poleOff = pole.clone().sub(hip);
    poleOff.addScaledVector(line, -poleOff.dot(line));
    expect(kneeOff.dot(poleOff)).toBeGreaterThan(0);
  });

  it('reaches toward an out-of-range target without NaN', () => {
    const { frame, upper, lower, end } = chain();
    const target = new Vector3(0, -3, 0);
    solveTwoBone({ upper, lower, end, target, pole: new Vector3(0, 0.5, -1), frame, weight: 1 });
    frame.updateMatrixWorld(true);
    const got = positionInFrame(end, frame, new Vector3());
    for (const v of [got.x, got.y, got.z]) expect(Number.isFinite(v)).toBe(true);
    const hip = positionInFrame(upper, frame, new Vector3());
    expect(got.clone().sub(hip).normalize().dot(target.clone().sub(hip).normalize())).toBeGreaterThan(0.999);
  });

  it('setQuaternionInFrame gives the object that orientation in the frame', () => {
    const { frame, lower, end } = chain();
    const want = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7);
    setQuaternionInFrame(end, frame, want);
    frame.updateMatrixWorld(true);
    const endWorld = new Quaternion();
    end.matrixWorld.decompose(new Vector3(), endWorld, new Vector3());
    const frameWorld = new Quaternion();
    frame.matrixWorld.decompose(new Vector3(), frameWorld, new Vector3());
    const inFrame = frameWorld.invert().multiply(endWorld);
    expect(Math.abs(inFrame.dot(want))).toBeCloseTo(1, 6);
    void lower;
  });

  it('allocates no vector or quaternion clones per solve (runs 4x per frame)', () => {
    const { frame, upper, lower, end } = chain();
    let clones = 0;
    Vector3.prototype.clone = function (this: Vector3) {
      clones++;
      return realV.call(this);
    };
    Quaternion.prototype.clone = function (this: Quaternion) {
      clones++;
      return realQ.call(this);
    };
    const target = new Vector3(0.25, 0.25, -0.2);
    const pole = new Vector3(0.1, 0.6, -1);
    const q = new Quaternion();
    for (let i = 0; i < 10; i++) {
      solveTwoBone({ upper, lower, end, target, pole, frame, weight: i % 2 ? 1 : 0.5 });
      setQuaternionInFrame(end, frame, q);
    }
    expect(clones).toBe(0);
  });
});
