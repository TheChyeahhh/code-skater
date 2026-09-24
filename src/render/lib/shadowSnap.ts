/**
 * src/render/lib/shadowSnap.ts (render track): the texel snap for the following shadow frustum
 * (REQ-REN-03). Pure maths so render.test can prove the centre tracks the skater and moves in
 * whole texels, which is what kills shadow shimmer when the camera and skater glide.
 */

import { Matrix4, Vector3 } from 'three';

export interface SnapResult {
  /** Where the shadow camera should look (the focus snapped to the shadow texel grid). */
  readonly target: Vector3;
  /** Where the light sits: target + sunDir x distance. */
  readonly position: Vector3;
}

const tmpView = new Matrix4();
const tmpInv = new Matrix4();
const tmpUp = new Vector3();
const tmpEye = new Vector3();
const tmpP = new Vector3();
const ORIGIN = new Vector3(0, 0, 0);

/** Rotation that takes light space (z toward the sun) to world; its inverse is world -> light. */
export function lightToWorld(sunDir: Vector3, out = new Matrix4()): Matrix4 {
  tmpUp.set(0, 1, 0);
  if (Math.abs(sunDir.y) > 0.999) tmpUp.set(0, 0, 1);
  tmpEye.copy(sunDir);
  return out.lookAt(tmpEye, ORIGIN, tmpUp);
}

/**
 * Snap `focus` to the shadow map's texel grid in light space. sunDir points FROM the scene TOWARD
 * the sun (unit). boxM is the ortho frustum width, mapSize the shadow map resolution, distance how
 * far along sunDir the light is placed.
 */
export function snapShadowFocus(focus: Vector3, sunDir: Vector3, boxM: number, mapSize: number, distance: number, out?: SnapResult): SnapResult {
  const texel = boxM / mapSize;
  lightToWorld(sunDir, tmpView);
  tmpInv.copy(tmpView).invert();
  // World -> light space (rotation only), snap x and y, back to world.
  tmpP.copy(focus).applyMatrix4(tmpInv);
  tmpP.x = Math.round(tmpP.x / texel) * texel;
  tmpP.y = Math.round(tmpP.y / texel) * texel;
  tmpP.applyMatrix4(tmpView);
  const target = out ? out.target.copy(tmpP) : tmpP.clone();
  const position = out ? out.position.copy(target).addScaledVector(sunDir, distance) : target.clone().addScaledVector(sunDir, distance);
  return out ?? { target, position };
}

/** Unit vector toward the sun for an elevation and a clockwise-from-north azimuth, both in degrees. */
export function sunDirection(elevationDeg: number, azimuthDeg: number, out = new Vector3()): Vector3 {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  // North = -z, east = +x: azimuth 0 -> north, 90 -> east.
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
