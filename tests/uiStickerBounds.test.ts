// tests/uiStickerBounds.test.ts (ui track): the Board Lab keeps every sticker wholly on the deck
// (REQ-LAB-03). The UI's outline copy must match the skater track's deck geometry, and a clamped
// centre must always fit, including at the four corners of the uv box and at any rotation.
import { describe, expect, it } from 'vitest';
import { DECK, deckHalfWidth } from '../src/render/skater/deckGeometry';
import { clampStickerCenter, DECK_OUTLINE, outlineHalfWidthFrac, stickerFits, stickerHalfExtents } from '../src/ui/stickerBounds';

describe('sticker bounds (REQ-LAB-03)', () => {
  it('the outline copy matches the deck geometry the 3D board is built from', () => {
    expect(DECK_OUTLINE.length).toBe(DECK.length);
    expect(DECK_OUTLINE.width).toBe(DECK.width);
    expect(DECK_OUTLINE.noseZone).toBe(DECK.noseZone);
    expect(DECK_OUTLINE.tailZone).toBe(DECK.tailZone);
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      expect(outlineHalfWidthFrac(t), `t ${t}`).toBeCloseTo(deckHalfWidth(t) / (DECK.width / 2), 9);
    }
  });

  it('a centre at any corner of the uv box is moved to where the whole sticker fits', () => {
    for (const rot of [0, -15, -45, -90, -135, -180, 30]) {
      for (const [u, v] of [[0, 0], [0, 1], [1, 0], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]] as const) {
        expect(stickerFits(u, v, rot), `raw ${u},${v} rot ${rot}`).toBe(false);
        const c = clampStickerCenter(u, v, rot);
        expect(stickerFits(c.u, c.v, rot), `clamped ${c.u},${c.v} rot ${rot}`).toBe(true);
      }
    }
  });

  it('a centre that already fits is left alone', () => {
    expect(clampStickerCenter(0.5, 0.5, 0)).toEqual({ u: 0.5, v: 0.5 });
    const c = clampStickerCenter(0.4, 0.55, -30);
    expect(c.u).toBeCloseTo(0.4, 9);
    expect(c.v).toBeCloseTo(0.55, 9);
  });

  it('a quarter turn swaps the half extents', () => {
    const a = stickerHalfExtents(0);
    const b = stickerHalfExtents(90);
    expect(b.hu * DECK.length).toBeCloseTo(a.hv * DECK.width, 9);
    expect(b.hv * DECK.width).toBeCloseTo(a.hu * DECK.length, 9);
  });
});
