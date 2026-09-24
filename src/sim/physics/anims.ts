/**
 * src/sim/physics/anims.ts (sim track): air trick animation timers (REQ-SM-03) and the pose table on
 * PoseId (src/core/types.ts) that the world applies when it builds a snapshot.
 *
 * - A flip or an Air special runs ticks(animMs) from its start; a grab has no end while held and ends
 *   ticks(GRAB_RELEASE_BEFORE_LAND_MS) after its release; 900ms Inference ends that long after its
 *   active hold ends. Windows are half-open: done at tick t iff t >= endTick.
 * - Pose: the most recently STARTED animation that is still running owns it; the spine transfer
 *   rotation is a pose-only animation (it never blocks a landing).
 */

import { clamp } from '../../core/math';
import { ticks, ticksS, TUNING } from '../../core/tuning';
import type { AirTrickId, BaseTrickId, EnhancedFlipId, FlipId, GrabId, PoseId, SpecialId, TrickVariantId, TweakedGrabId } from '../../core/types';
import { getTrick } from '../../data/tricks';

export interface AirAnim {
  /** Variant id of the combo element (switch_ / nollie_ prefixes). */
  id: TrickVariantId;
  /** Base id (enhanced ids included). */
  base: AirTrickId | SpecialId;
  readonly category: 'flip' | 'grab' | 'special';
  readonly startTick: number;
  /** Tick the animation is finished, null while still held. */
  endTick: number | null;
  releaseTick: number | null;
  readonly nollie: boolean;
  readonly fakie: boolean;
}

export function animLengthTicks(base: BaseTrickId): number {
  const ms = getTrick(base).animMs;
  return ms === undefined ? 0 : ticks(ms);
}

export function allAnimsDone(anims: readonly AirAnim[], tick: number): boolean {
  return anims.every((a) => a.endTick !== null && tick >= a.endTick);
}

export function running(anims: readonly AirAnim[], tick: number, category: AirAnim['category']): AirAnim | undefined {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i] as AirAnim;
    if (a.category === category && (a.endTick === null || tick < a.endTick)) return a;
  }
  return undefined;
}

export interface AirPose {
  readonly pose: PoseId;
  readonly variant: BaseTrickId | null;
  readonly phase: number;
}

/** Base grab of a (possibly tweaked) grab id: the tweak shares the plain grab's pose. */
function baseGrab(id: AirTrickId | SpecialId): BaseTrickId {
  const t = getTrick(id);
  return (t.enhancedOf ?? id) as BaseTrickId;
}

/** Board flip animation phase of a flip anim (REQ-SKT-04: completes exactly at animMs). */
export function flipPhase(a: AirAnim, tick: number): number {
  const len = animLengthTicks(a.base);
  return len > 0 ? clamp((tick - a.startTick) / len, 0, 1) : 1;
}

/**
 * Pose for the air per the PoseId table. `transfer` = tick of a spine transfer in this air or null;
 * `popTick` = tick of the last pop or null; `inferenceHeldMs` = presentation ms of 900ms Inference.
 */
export function airPose(anims: readonly AirAnim[], tick: number, transfer: number | null, popTick: number | null, inferenceHeldMs: number): AirPose {
  let owner: AirAnim | null = null;
  for (const a of anims) {
    const live = a.endTick === null || tick < a.endTick;
    if (live && (!owner || a.startTick >= owner.startTick)) owner = a;
  }
  const transferLen = Math.max(1, ticksS(TUNING.SPINE_TRANSFER_ANIM_S));
  const transferLive = transfer !== null && tick - transfer < transferLen;
  if (transferLive && (!owner || (transfer as number) >= owner.startTick)) {
    return { pose: 'transfer', variant: null, phase: clamp((tick - (transfer as number)) / transferLen, 0, 1) };
  }
  if (owner) {
    const n = tick - owner.startTick;
    if (owner.category === 'flip') return { pose: 'flip', variant: owner.base, phase: flipPhase(owner, tick) };
    if (owner.category === 'grab') {
      const reach = Math.max(1, ticks(TUNING.GRAB_MIN_POSE_MS));
      const rel = Math.max(1, ticks(TUNING.GRAB_RELEASE_BEFORE_LAND_MS));
      const phase = owner.releaseTick === null ? 0.5 * Math.min(1, n / reach) : 0.5 + 0.5 * clamp((tick - owner.releaseTick) / rel, 0, 1);
      return { pose: 'grab', variant: baseGrab(owner.base), phase };
    }
    if (owner.base === 'inference_900ms') {
      return { pose: 'special', variant: owner.base, phase: clamp(inferenceHeldMs / TUNING.INFERENCE_MIN_HOLD_MS, 0, 1) };
    }
    const len = Math.max(1, animLengthTicks(owner.base));
    return { pose: 'special', variant: owner.base, phase: clamp(n / len, 0, 1) };
  }
  const popLen = Math.max(1, ticks(TUNING.POP_POSE_MS));
  if (popTick !== null && tick - popTick < popLen) return { pose: 'pop', variant: null, phase: clamp((tick - popTick) / popLen, 0, 1) };
  return { pose: 'air', variant: null, phase: 0 };
}

export type FlipSnapshotId = FlipId | EnhancedFlipId;
export type GrabSnapshotId = GrabId | TweakedGrabId;
