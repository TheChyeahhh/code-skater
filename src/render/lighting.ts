/**
 * src/render/lighting.ts (render track): one directional sun with a shadow map of the preset size
 * whose ortho frustum (SHADOW_BOX_M) follows the skater, texel-snapped to kill shimmer, PCF filtering
 * (PCFShadowMap: three 0.186 removed PCFSoftShadowMap);
 * plus hemisphere / warm fill per environment (REQ-REN-03). Street: sun at SUN_ELEVATION_DEG.
 *
 * Colour split (SPEC section 10 "saturated"): a warm late-afternoon sun (#ffc07e) against a cool blue
 * hemisphere sky (#6f8fe0) over a dark warm ground, so lit faces go warm and shadow sides go cool
 * instead of both going grey. The shed pairs a warm key and fill with a COOL skylight hemisphere
 * (RLIT_WOODSHED_SKY_INTENSITY) so plywood, brick and tile do not converge on one orange.
 *
 * Shade fill (polish round 2): a hemisphere lifts floors far more than walls, so the Street's
 * shade faces sat near black while its floor shadows were fine. streetAfternoon adds a cool
 * "skylight" (RLIT_SKYFILL_*): a second HemisphereLight whose axis points below the horizon on the
 * side opposite the sun, with a black far side. Faces that turn away from the sun get most of it,
 * floors a quarter, sunlit faces none. A hemisphere is diffuse only: a directional fill did the same
 * for the walls but drew a large white specular glare on the glossy plaza floor when the camera
 * looked toward it.
 *
 * Every light is on every render layer (see createLighting), so the bloom mask pass sees the same
 * light setup as the main pass and no material re-selects its program between them.
 *
 * Every number is read from TUNING inside update(), so the dev panel moves the sun live.
 * Runs in node (lights are plain objects): render.test proves the frustum centre tracks the skater.
 */

import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';
import { TUNING } from '../core/tuning';
import type { Vec3 } from '../core/types';
import type { EnvironmentPreset } from '../levels/types';
import { snapShadowFocus, sunDirection } from './lib/shadowSnap';
import type { Lighting, QualitySettings } from './types';

interface EnvLights {
  readonly sunColor: string;
  readonly skyColor: string;
  readonly groundColor: string;
  /** Sun elevation / azimuth, or null to read the Street values from TUNING live. */
  readonly sun: { readonly elevationDeg: number; readonly azimuthDeg: number } | null;
  readonly sunIntensity: () => number;
  readonly hemiIntensity: () => number;
  /** Warm interior fill (Woodshed), 0 elsewhere. */
  readonly fill: { readonly color: string; readonly intensity: () => number } | null;
  /** Cool shadowless skylight for the shade faces (Street), null elsewhere. Angles read live. */
  readonly skyFill: { readonly color: string; readonly intensity: () => number } | null;
}

export const ENV: Readonly<Record<EnvironmentPreset, EnvLights>> = {
  streetAfternoon: {
    sunColor: '#ffc07e',
    skyColor: '#6f8fe0',
    groundColor: '#4e3f30',
    sun: null,
    sunIntensity: () => TUNING.RLIT_SUN_INTENSITY,
    hemiIntensity: () => TUNING.RLIT_HEMI_INTENSITY,
    fill: null,
    skyFill: { color: '#a9bff0', intensity: () => TUNING.RLIT_SKYFILL_INTENSITY },
  },
  woodshedInterior: {
    sunColor: '#fff1dc',
    skyColor: '#c8d4e8',
    groundColor: '#3a2c20',
    sun: { elevationDeg: 58, azimuthDeg: 205 },
    sunIntensity: () => TUNING.RLIT_WOODSHED_KEY_INTENSITY,
    hemiIntensity: () => TUNING.RLIT_WOODSHED_SKY_INTENSITY,
    fill: { color: '#ffb877', intensity: () => TUNING.RLIT_WOODSHED_FILL_INTENSITY },
    skyFill: null,
  },
  campusNight: {
    // A cool moon key (with the shadow map), a blue-violet sky hemisphere and a neon-violet fill.
    sunColor: '#a8b8ff',
    skyColor: '#3b4a90',
    groundColor: '#15121e',
    sun: { elevationDeg: 42, azimuthDeg: 140 },
    sunIntensity: () => TUNING.RLIT_CAMPUS_MOON_INTENSITY,
    hemiIntensity: () => TUNING.RLIT_CAMPUS_SKY_INTENSITY,
    fill: { color: '#7a5cff', intensity: () => TUNING.RLIT_CAMPUS_FILL_INTENSITY },
    skyFill: null,
  },
  testGrid: {
    sunColor: '#fff6ea',
    skyColor: '#b8ccf0',
    groundColor: '#5c5650',
    sun: { elevationDeg: 48, azimuthDeg: 225 },
    sunIntensity: () => TUNING.RLIT_SUN_INTENSITY * 0.85,
    hemiIntensity: () => TUNING.RLIT_HEMI_INTENSITY,
    fill: null,
    skyFill: null,
  },
};

export interface GameLighting extends Lighting {
  /** Unit vector toward the sun (world), refreshed by update(). */
  readonly sunDir: Vector3;
}

export function createLighting(environment: EnvironmentPreset, quality: QualitySettings): GameLighting {
  const env = ENV[environment];
  const group = new Group();
  group.name = `lighting:${environment}`;

  const sun = new DirectionalLight(new Color(env.sunColor), env.sunIntensity());
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.radius = 1.5;
  group.add(sun, sun.target);

  const hemi = new HemisphereLight(new Color(env.skyColor), new Color(env.groundColor), env.hemiIntensity());
  hemi.name = 'hemisphere';
  group.add(hemi);

  let fill: AmbientLight | null = null;
  if (env.fill) {
    fill = new AmbientLight(new Color(env.fill.color), env.fill.intensity());
    fill.name = 'warmFill';
    group.add(fill);
  }

  let skyFill: HemisphereLight | null = null;
  if (env.skyFill) {
    skyFill = new HemisphereLight(new Color(env.skyFill.color), new Color('#000000'), env.skyFill.intensity());
    skyFill.name = 'skyFill';
    group.add(skyFill);
  }

  // Lights on every layer: the selective bloom renders its mask with the camera on BLOOM_LAYER only,
  // and a light that drops out of that pass changes the lights hash, so every lit material re-selects
  // its program twice a frame (about 50 lookups a frame on Med and above). Same lights in every pass.
  for (const light of [sun, hemi, fill, skyFill]) light?.layers.enableAll();

  const sunDir = new Vector3(0, 1, 0);
  const skyFillDir = new Vector3(0, 1, 0);
  const focus = new Vector3();
  const snap = { target: new Vector3(), position: new Vector3() };
  let boxM = -1;
  let depthM = -1;

  const refreshFrustum = (): void => {
    const box = TUNING.SHADOW_BOX_M;
    const depth = TUNING.RLIT_SHADOW_DEPTH_M;
    if (box === boxM && depth === depthM) return;
    boxM = box;
    depthM = depth;
    const cam = sun.shadow.camera;
    cam.left = -box / 2;
    cam.right = box / 2;
    cam.top = box / 2;
    cam.bottom = -box / 2;
    cam.far = depth;
    cam.updateProjectionMatrix();
  };

  const update = (at: Vec3): void => {
    refreshFrustum();
    const el = env.sun ? env.sun.elevationDeg : TUNING.SUN_ELEVATION_DEG;
    const az = env.sun ? env.sun.azimuthDeg : TUNING.RSKY_SUN_AZIMUTH_DEG;
    sunDirection(el, az, sunDir);
    sun.intensity = env.sunIntensity();
    hemi.intensity = env.hemiIntensity();
    if (fill && env.fill) fill.intensity = env.fill.intensity();
    if (skyFill && env.skyFill) {
      skyFill.intensity = env.skyFill.intensity();
      sunDirection(TUNING.RLIT_SKYFILL_ELEVATION_DEG, (az + 180 + TUNING.RLIT_SKYFILL_AZIMUTH_OFFSET_DEG) % 360, skyFillDir);
      // A hemisphere's axis is its position seen from the origin.
      skyFill.position.copy(skyFillDir);
    }
    sun.shadow.bias = TUNING.RLIT_SHADOW_BIAS;
    sun.shadow.normalBias = TUNING.RLIT_SHADOW_NORMAL_BIAS;
    focus.set(at.x, at.y, at.z);
    snapShadowFocus(focus, sunDir, boxM, sun.shadow.mapSize.x, depthM / 2, snap);
    sun.position.copy(snap.position);
    sun.target.position.copy(snap.target);
    sun.target.updateMatrixWorld();
  };

  update({ x: 0, y: 0, z: 0 });

  return {
    group,
    sun,
    sunDir,
    update,
    setQuality(q) {
      if (sun.shadow.mapSize.x === q.shadowMapSize) return;
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.needsUpdate = true;
      update(focus);
    },
    dispose() {
      sun.shadow.dispose();
      group.clear();
    },
  };
}
