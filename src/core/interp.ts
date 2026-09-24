/**
 * src/core/interp.ts: render-side interpolation between the two latest sim snapshots
 * (REQ-TIM-01, REQ-CTL-19). Frozen. The app calls it once per render frame with the loop's alpha
 * and hands the result to every view (skater, camera, FX, HUD, audio), so they all agree.
 */

import { lerp, lerp3, norm3, slerpQuat } from './math';
import type { SimSnapshot, SkaterSnapshot } from './types';

/**
 * A phase step larger than this between two ticks is a wrap or a restart (a looping push / roll
 * cycle going 0.98 -> 0.02, a new flip), so it is not blended. Smaller steps blend in either
 * direction (balance lean phases move both ways).
 */
const PHASE_JUMP = 0.5;

function phaseLerp(p: number, c: number, a: number): number {
  return Math.abs(c - p) <= PHASE_JUMP ? lerp(p, c, a) : c;
}

/**
 * Interpolate prev -> curr by alpha in [0, 1]. Continuous motion (position, rotation, board pivot,
 * velocity, axes, charge, same-pose phase, same-flip phase, grind contact, camera look-ahead) is
 * blended; discrete data (state, combo, run, events) comes from curr. A teleport or state reset is
 * handled by the caller passing prev = curr.
 */
export function lerpSnapshot(prev: SimSnapshot | null, curr: SimSnapshot, alpha: number): SimSnapshot {
  if (!prev || prev === curr || alpha >= 1) return curr;
  const a = Math.min(Math.max(alpha, 0), 1);
  const p = prev.skater;
  const c = curr.skater;
  const samePose = p.pose === c.pose && p.poseVariant === c.poseVariant;
  const sameFlip = p.flipId !== null && p.flipId === c.flipId && c.flipPhase >= p.flipPhase;
  const sameRail = p.grind !== null && c.grind !== null && p.grind.railId === c.grind.railId;
  const skater: SkaterSnapshot = {
    ...c,
    pos: lerp3(p.pos, c.pos, a),
    rot: slerpQuat(p.rot, c.rot, a),
    vel: lerp3(p.vel, c.vel, a),
    speed: lerp(p.speed, c.speed, a),
    forward: norm3(lerp3(p.forward, c.forward, a)),
    up: norm3(lerp3(p.up, c.up, a)),
    boardRel: slerpQuat(p.boardRel, c.boardRel, a),
    crouchCharge: lerp(p.crouchCharge, c.crouchCharge, a),
    posePhase: samePose ? phaseLerp(p.posePhase, c.posePhase, a) : c.posePhase,
    flipPhase: sameFlip ? lerp(p.flipPhase, c.flipPhase, a) : c.flipPhase,
    grind: sameRail && p.grind && c.grind ? { ...c.grind, contact: lerp3(p.grind.contact, c.grind.contact, a) } : c.grind,
  };
  return {
    ...curr,
    skater,
    camera: { ...curr.camera, lookAhead: lerp3(prev.camera.lookAhead, curr.camera.lookAhead, a) },
  };
}
