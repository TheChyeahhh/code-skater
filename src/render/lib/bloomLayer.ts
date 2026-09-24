/**
 * src/render/lib/bloomLayer.ts (render track): the bloom selection (REQ-REN-04, "only emissive").
 * The post chain blooms through a SelectiveBloomEffect whose mask is a depth pass of the objects on
 * BLOOM_LAYER, so sunlit plywood or a white wall never blooms however bright it is. LevelView marks
 * the neon boxes, signs and pickups; the fx track marks sparks, the special glow and the MacGuffin
 * flash with markBloom(obj) (a layer flag on the object, no reference to the post chain needed).
 * The object stays on layer 0 too, so it still renders normally.
 */

import type { Object3D } from 'three';

/** Render layer of everything that may bloom (postprocessing Selection layers are 2..31). */
export const BLOOM_LAYER = 11;

/** Let this object (and, with recurse, its descendants) bloom. Safe to call twice. */
export function markBloom(obj: Object3D, recurse = true): void {
  if (recurse) obj.traverse((o) => o.layers.enable(BLOOM_LAYER));
  else obj.layers.enable(BLOOM_LAYER);
}

/** Take the object (and its descendants) out of the bloom mask again. */
export function unmarkBloom(obj: Object3D, recurse = true): void {
  if (recurse) obj.traverse((o) => o.layers.disable(BLOOM_LAYER));
  else obj.layers.disable(BLOOM_LAYER);
}

export function isBloomMarked(obj: Object3D): boolean {
  return (obj.layers.mask & (1 << BLOOM_LAYER)) !== 0;
}
