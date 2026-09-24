/**
 * src/ui/stickerBounds.ts (ui track): where a sticker may sit on the deck underside (REQ-LAB-03).
 * The Board Lab cursor and the mouse drop clamp the sticker CENTRE so the whole (rotated) sticker
 * stays inside the deck outline; a sticker parked at a corner of the uv box was counted but drawn
 * off the deck (invisible on the 2D map and the 3D board).
 *
 * The outline mirrors src/render/skater/deckGeometry.ts (deckHalfWidth: straight sides, rounded
 * nose and tail zones). That module imports three.js, which must stay out of the menu chunk
 * (REQ-MNU-05), so the numbers are restated here; tests/uiStickerBounds.test.ts checks this copy
 * against the real deckHalfWidth so the two cannot drift apart.
 *
 * Coordinates: StickerPlacement space, u = 0 tail .. 1 nose (along), v = 0 .. 1 across.
 */

import { STICKER_ACROSS, STICKER_ALONG } from './labArt';

/** Deck outline, metres (mirror of DECK in deckGeometry.ts). */
export const DECK_OUTLINE = { length: 0.82, width: 0.21, noseZone: 0.17, tailZone: 0.15, roundPow: 2.6 } as const;

/** Outline half-width at t (0 tail .. 1 nose) as a fraction of the full half-width (0 .. 1). */
export function outlineHalfWidthFrac(t: number): number {
  const L = DECK_OUTLINE.length;
  const s = Math.min(1, Math.max(0, t)) * L;
  const round = (dist: number, zone: number): number => {
    if (dist >= zone) return 1;
    const k = 1 - dist / zone;
    return Math.sqrt(Math.max(0, 1 - Math.pow(k, DECK_OUTLINE.roundPow)));
  };
  return Math.min(round(s, DECK_OUTLINE.tailZone), round(L - s, DECK_OUTLINE.noseZone));
}

/** Half extents of a sticker rotated by rotDeg, as fractions of the deck length (hu) and width (hv). */
export function stickerHalfExtents(rotDeg: number): { readonly hu: number; readonly hv: number } {
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const alongM = (STICKER_ALONG * DECK_OUTLINE.length) / 2;
  const acrossM = (STICKER_ACROSS * DECK_OUTLINE.width) / 2;
  return {
    hu: (c * alongM + s * acrossM) / DECK_OUTLINE.length,
    hv: (s * alongM + c * acrossM) / DECK_OUTLINE.width,
  };
}

/** Room either side of the centre line (v fraction) for a sticker centred at u with half extents hu / hv. */
function acrossRoom(u: number, hu: number, hv: number): number {
  return 0.5 * Math.min(outlineHalfWidthFrac(u - hu), outlineHalfWidthFrac(u + hu)) - hv;
}

/** Steps used to walk the centre in from a rounded end until the sticker fits across. */
const FIT_STEPS = 64;

/** True when a sticker centred at (u, v) with this rotation lies wholly inside the deck outline. */
export function stickerFits(u: number, v: number, rotDeg: number): boolean {
  const { hu, hv } = stickerHalfExtents(rotDeg);
  if (u - hu < 0 || u + hu > 1) return false;
  const room = acrossRoom(u, hu, hv);
  return room >= 0 && Math.abs(v - 0.5) <= room + 1e-9;
}

/** The nearest centre to (u, v) at which the sticker lies wholly inside the deck outline. */
export function clampStickerCenter(u: number, v: number, rotDeg: number): { readonly u: number; readonly v: number } {
  const { hu, hv } = stickerHalfExtents(rotDeg);
  let cu = hu >= 0.5 ? 0.5 : Math.min(1 - hu, Math.max(hu, u));
  // In a rounded end the deck narrows: walk the centre toward the middle until the sticker fits across.
  for (let i = 0; i < FIT_STEPS && acrossRoom(cu, hu, hv) < 0; i++) cu += (0.5 - cu) / (FIT_STEPS - i);
  const room = Math.max(0, acrossRoom(cu, hu, hv));
  const cv = Math.min(0.5 + room, Math.max(0.5 - room, v));
  return { u: cu, v: cv };
}
