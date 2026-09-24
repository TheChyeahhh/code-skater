/**
 * dev/skater/poseSnapshot.ts (skater track harness): a valid SimSnapshot that shows one pose of the
 * library at a phase, following the PoseId table in src/core/types.ts (flip sets flipId + flipPhase,
 * grab sets grabId, balance poses carry a needle, bail / getup carry bail.t, Kernel Panic lights the
 * blue screen). Used by the turntable and the grid views.
 */

import { yawQuat } from '../../src/core/math';
import { restSnapshot } from '../../src/core/mock';
import type { BaseTrickId, EnhancedFlipId, FlipId, GrabId, GrindTypeId, PoseId, SimSnapshot, Stance, Vec3 } from '../../src/core/types';

export interface PoseShot {
  readonly pose: PoseId;
  readonly variant: BaseTrickId | null;
  readonly phase: number;
  readonly stance?: Stance;
  readonly fakie?: boolean;
  readonly pos?: Vec3;
  readonly yaw?: number;
}

const AIR_POSES: readonly PoseId[] = ['pop', 'air', 'flip', 'grab', 'special', 'transfer'];

export function poseSnapshot(shot: PoseShot): SimSnapshot {
  const rest = restSnapshot();
  const pos = shot.pos ?? rest.skater.pos;
  const yaw = shot.yaw ?? 0;
  const inAir = AIR_POSES.includes(shot.pose);
  const balanceAxis = shot.pose === 'manual' || shot.pose === 'noseManual' ? 'v' : 'h';
  const balanced = shot.pose === 'grind' || shot.pose === 'lip' || shot.pose === 'manual' || shot.pose === 'noseManual';
  const state = shot.pose === 'grind' ? 'Grind'
    : shot.pose === 'lip' ? 'Lip'
      : shot.pose === 'manual' || shot.pose === 'noseManual' ? 'Manual'
        : shot.pose === 'bail' ? 'Bail'
          : shot.pose === 'getup' ? 'GetUp'
            : shot.pose === 'revert' ? 'RevertWindow'
              : shot.pose === 'crouch' ? 'Crouch'
                : inAir ? 'Air' : 'Grounded';
  const grindType = shot.pose === 'grind' ? ((shot.variant ?? 'fifty_fifty') as GrindTypeId) : null;
  return {
    ...rest,
    skater: {
      ...rest.skater,
      pos,
      rot: yawQuat(yaw),
      forward: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
      state,
      stance: shot.stance ?? 'regular',
      fakie: shot.fakie ?? false,
      crouchCharge: shot.pose === 'crouch' ? shot.phase : 0,
      pose: shot.pose,
      poseVariant: shot.variant,
      posePhase: shot.phase,
      trickId: shot.variant,
      flipId: shot.pose === 'flip' ? ((shot.variant ?? 'kickflip') as FlipId | EnhancedFlipId) : null,
      flipPhase: shot.pose === 'flip' ? shot.phase : 0,
      grabId: shot.pose === 'grab' ? ((shot.variant ?? 'indy') as GrabId) : null,
      grind: grindType
        ? {
          type: grindType,
          railId: 'DEV-R1', railKind: 'rail', contact: { x: pos.x, y: pos.y, z: pos.z }, tangent: { x: 0, y: 0, z: -1 }, distanceM: 0,
        }
        : null,
      contactPoint: inAir ? null : pos,
      bail: shot.pose === 'bail' ? { phase: 'tumble', t: shot.phase } : shot.pose === 'getup' ? { phase: 'getup', t: shot.phase } : null,
    },
    special: { ...rest.special, activeId: shot.pose === 'special' && shot.variant === 'kernel_panic' ? 'kernel_panic' : null },
    balance: balanced ? { needle: shot.phase * 2 - 1, axis: balanceAxis } : null,
  };
}
