/**
 * src/render/lib/viewport.ts (render track): the drawing-buffer size, shared as one mutable record.
 * renderer.ts writes it on resize / setQuality (CSS size x pixel ratio); materials read it through a
 * shared uniform so a vertex shader knows how big one pixel is at a given depth (the rail inflate,
 * REQ-MAT-02: a grind line must never drop under RMAT_RAIL_MIN_PX pixels on screen). No camera is
 * needed for that: the vertex shader takes the focal length from projectionMatrix[1][1].
 *
 * Pure data, so render.test can drive it without a WebGL context.
 */

export interface ViewportSize {
  widthPx: number;
  heightPx: number;
}

/** Drawing-buffer size in device pixels (1920 x 1080 until the renderer resizes). */
export const VIEWPORT: ViewportSize = { widthPx: 1920, heightPx: 1080 };

/** Uniform shared by every material that needs the viewport height (one object, updated in place). */
export const VIEWPORT_HEIGHT_UNIFORM: { value: number } = { value: VIEWPORT.heightPx };

export function setViewportSize(widthPx: number, heightPx: number): void {
  VIEWPORT.widthPx = Math.max(1, Math.round(widthPx));
  VIEWPORT.heightPx = Math.max(1, Math.round(heightPx));
  VIEWPORT_HEIGHT_UNIFORM.value = VIEWPORT.heightPx;
}

/**
 * World-space size of one pixel at view depth `depthM` for a camera whose projection matrix has
 * p11 = 1 / tan(fov / 2) (the same formula the rail vertex shader uses).
 */
export function pixelWorldSize(depthM: number, projectionP11: number, viewportHeightPx: number): number {
  return (2 * depthM) / (projectionP11 * viewportHeightPx);
}

/**
 * Radius growth (m) that keeps a pipe of `radiusM` at least `minPx` pixels wide at `depthM`
 * (0 when it is already wide enough). The vertex shader does exactly this along the normal.
 */
export function railInflate(radiusM: number, depthM: number, projectionP11: number, viewportHeightPx: number, minPx: number): number {
  const px = pixelWorldSize(depthM, projectionP11, viewportHeightPx);
  return Math.max(0, (minPx * px) / 2 - radiusM);
}
