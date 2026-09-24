/**
 * src/levels/lib/debugShapes.ts (levels track): the trigger boxes a level's named gaps test
 * (REQ-LVL-07), as finite boxes for the dev harness. Gap rules are evaluated by src/sim/gaps.ts from
 * element events and box tests; this only turns their BoxRanges into drawable volumes (an omitted
 * or infinite axis is clamped to the park rectangle and a default height band).
 */

import type { Box3Like } from '../../core/types';
import type { BoxRange, LevelDef } from '../types';

export interface GapBox {
  readonly gapId: string;
  readonly role: 'start' | 'end' | 'within';
  readonly box: Box3Like;
}

const Y_BAND: readonly [number, number] = [-3, 12];

function finite(r: readonly [number, number] | undefined, lo: number, hi: number): [number, number] {
  const a = r?.[0] ?? -Infinity, b = r?.[1] ?? Infinity;
  return [Number.isFinite(a) ? a : lo, Number.isFinite(b) ? b : hi];
}

function toBox(b: BoxRange, size: { readonly x: number; readonly z: number }): Box3Like {
  const [x0, x1] = finite(b.x, 0, size.x);
  const [y0, y1] = finite(b.y, Y_BAND[0], Y_BAND[1]);
  const [z0, z1] = finite(b.z, 0, size.z);
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

export function gapBoxes(def: LevelDef, size: { readonly x: number; readonly z: number }): GapBox[] {
  const out: GapBox[] = [];
  for (const g of def.gaps) {
    const r = g.rule;
    const push = (role: GapBox['role'], b: BoxRange | undefined): void => {
      if (b) out.push({ gapId: g.id, role, box: toBox(b, size) });
    };
    switch (r.kind) {
      case 'airBoxToBox':
        push('start', r.start);
        push('end', r.land);
        break;
      case 'transferOn':
        push('end', r.then?.land);
        break;
      case 'manualSpan':
      case 'airApexIn':
        push('within', r.within);
        break;
      default:
        break;
    }
  }
  return out;
}
