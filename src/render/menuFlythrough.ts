/**
 * src/render/menuFlythrough.ts (render track): the main menu's animated park flythrough (REQ-MNU-01):
 * the park seen from a camera on a closed spline, one loop per TUNING.MENU_FLYTHROUGH_S (read live).
 * The app owns the scene (LevelView, lighting, sky, exactly as for a run) and renders it through
 * this camera behind #ui-root on the mainMenu screen (src/app/**). No sim, no skater, no input.
 *
 * Market Street (the menu park) flies an authored tour at 4 to 10 m: the terrace stairs and hubbas,
 * around the fountain, up the scaffold to the rooftop laptop, over the dock roof past the billboard,
 * down to the street stairs and back over the plaza ledges. Every key has a look target on a hero
 * feature; the camera yaws RMENU_FRAME_YAW_DEG to the left of it so the feature sits in the right
 * third of the frame (the menu panel covers the left). Other levels fall back to a rounded loop
 * inset RMENU_CAM_INSET into the bounds at RMENU_CAM_HEIGHT_M, looking toward the park centre.
 *
 * Clearance: the keys are lifted until the whole sampled spline stays CLEARANCE_M above every
 * surface and prop under it (props within PROP_RADIUS_M, so lamp poles never cross the lens).
 */

import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from 'three';
import { TUNING } from '../core/tuning';
import type { LevelId } from '../core/types';
import type { BuiltLevel, SurfaceInfo } from '../levels/types';
import type { MenuFlythrough } from './types';

/** Clearance above the highest surface or prop under the camera (m). */
export const CLEARANCE_M = 2.5;
/** Horizontal reach of the clearance test around the camera (m). */
const PROBE_RADIUS_M = 2;
/** Samples along the spline for the clearance lift and the tests. */
export const FLY_SAMPLES = 240;
/** Generic loop: waypoints around the park. */
const WAYPOINTS = 10;

/** One key of an authored tour: where the camera is and which hero feature it frames. */
export interface FlyKey {
  readonly pos: readonly [number, number, number];
  readonly look: readonly [number, number, number];
  readonly name: string;
}

/**
 * Authored tours per level (x east, z south, y up; DESIGN G.1 coordinates). Keep the camera at 4 to
 * 10 m and every look target on a named feature.
 */
export const FLY_TOURS: Readonly<Partial<Record<LevelId, readonly FlyKey[]>>> = {
  marketStreet: [
    { name: 'terrace stairs and hubbas', pos: [22, 6, 26], look: [46, 1.5, 44] },
    { name: 'plaza flat bar toward the fountain', pos: [32, 5.5, 50], look: [50.4, 2, 64] },
    { name: 'fountain', pos: [40, 5, 78], look: [51, 2, 63] },
    { name: 'plaza quarter-pipe', pos: [62, 5.5, 78], look: [86.7, 3, 58] },
    { name: 'scaffold climb', pos: [78, 6, 52], look: [104.3, 5, 62] },
    { name: 'rooftop laptop', pos: [90, 8.5, 64], look: [104.8, 7.5, 80] },
    { name: 'billboard gap over the dock roof', pos: [100, 9, 92], look: [86, 6.5, 101.5] },
    { name: 'street stairs from the depot', pos: [76, 7, 96], look: [46, 0.5, 90] },
    { name: 'crosswalk and stairs', pos: [60, 5, 113], look: [42, 0.5, 92] },
    { name: 'granite bench ledge', pos: [18, 6, 106], look: [30, 1, 74] },
    { name: 'plaza from the storefronts', pos: [14, 6, 84], look: [46, 1.5, 50] },
    { name: 'terrace ledge from the west', pos: [18, 6.5, 44], look: [60, 2, 40] },
  ],
};

interface Obstacle {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly top: number;
}

/** Surfaces (minus the boundary) and props, as top heights over ground rectangles. */
function obstacles(built: BuiltLevel): Obstacle[] {
  const out: Obstacle[] = [];
  for (const s of Object.values(built.surfaces) as SurfaceInfo[]) {
    if (s.kind === 'boundary') continue;
    out.push({ x0: s.bounds.min.x, z0: s.bounds.min.z, x1: s.bounds.max.x, z1: s.bounds.max.z, top: s.bounds.max.y });
  }
  for (const p of built.def.primitives) {
    if (p.kind !== 'prop') continue;
    // Axis-aligned bounds of the yawed footprint.
    const yaw = ((p.yawDeg ?? 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const hx = (c * p.size.x + s * p.size.z) / 2;
    const hz = (s * p.size.x + c * p.size.z) / 2;
    out.push({ x0: p.at.x - hx, z0: p.at.z - hz, x1: p.at.x + hx, z1: p.at.z + hz, top: p.at.y + p.size.y });
  }
  return out;
}

/** Highest obstacle top within `radius` of (x, z); 0 over open ground. */
export function floorUnder(obs: readonly Obstacle[], x: number, z: number, radius = PROBE_RADIUS_M): number {
  let top = 0;
  for (const o of obs) {
    if (x + radius < o.x0 || x - radius > o.x1 || z + radius < o.z0 || z - radius > o.z1) continue;
    top = Math.max(top, o.top);
  }
  return top;
}

/** The generic loop's waypoints from the level bounds (pure, exported for render.test). */
export function flythroughWaypoints(built: BuiltLevel): Vector3[] {
  const b = built.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const sx = (b.max.x - b.min.x) / 2;
  const sz = (b.max.z - b.min.z) / 2;
  const inset = 1 - TUNING.RMENU_CAM_INSET * 2;
  const height = TUNING.RMENU_CAM_HEIGHT_M;
  const obs = obstacles(built);
  const points: Vector3[] = [];
  const spawn = built.spawn.pos;
  for (let i = 0; i < WAYPOINTS; i++) {
    const a = (i / WAYPOINTS) * Math.PI * 2;
    // A superellipse-ish loop keeps the corners of a square park in view without hugging the walls.
    const x = cx + Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.7) * sx * inset;
    const z = cz + Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.7) * sz * inset;
    const dSpawn = Math.hypot(x - spawn.x, z - spawn.z);
    const near = Math.max(0, 1 - dSpawn / (Math.max(sx, sz) * 0.8));
    const floor = floorUnder(obs, x, z) + CLEARANCE_M;
    const y = Math.max(floor, b.min.y + height * (1 - 0.45 * near));
    points.push(new Vector3(x, y, z));
  }
  return points;
}

export interface FlyPath {
  /** Camera positions (closed). */
  readonly camera: CatmullRomCurve3;
  /** Look targets (closed, same key parameterisation as camera). */
  readonly look: CatmullRomCurve3;
  /** True when the path is an authored tour. */
  readonly authored: boolean;
}

/**
 * The flythrough path for a level: its authored tour (keys lifted until every sample clears the
 * obstacles by CLEARANCE_M), else the generic loop looking toward the park centre.
 */
export function flythroughPath(built: BuiltLevel): FlyPath {
  const tour = FLY_TOURS[built.def.id as LevelId];
  if (!tour || tour.length < 4) {
    const pts = flythroughWaypoints(built);
    const b = built.bounds;
    const centre = new Vector3((b.min.x + b.max.x) / 2, b.min.y + 1.5, (b.min.z + b.max.z) / 2);
    return { camera: new CatmullRomCurve3(pts, true, 'centripetal', 0.5), look: new CatmullRomCurve3(pts.map(() => centre.clone()), true), authored: false };
  }
  const obs = obstacles(built);
  const keys = tour.map((k) => new Vector3(k.pos[0], k.pos[1], k.pos[2]));
  const looks = tour.map((k) => new Vector3(k.look[0], k.look[1], k.look[2]));
  const camera = new CatmullRomCurve3(keys, true, 'catmullrom', 0.5);
  const p = new Vector3();
  const lift = new Array<number>(keys.length).fill(0);
  for (let pass = 0; pass < 12; pass++) {
    lift.fill(0);
    for (let i = 0; i < FLY_SAMPLES; i++) {
      const t = i / FLY_SAMPLES;
      camera.getPoint(t, p);
      const need = floorUnder(obs, p.x, p.z) + CLEARANCE_M - p.y;
      if (need <= 0) continue;
      // The two keys around this sample carry the worst shortfall of their segment (the spline
      // passes through its keys, so lifting both lifts the whole segment).
      const k = Math.floor(t * keys.length) % keys.length;
      for (const j of [k, (k + 1) % keys.length]) lift[j] = Math.max(lift[j] ?? 0, need + 0.05);
    }
    if (lift.every((l) => l === 0)) break;
    keys.forEach((key, j) => key.setY(key.y + (lift[j] ?? 0)));
    camera.updateArcLengths();
  }
  return { camera, look: new CatmullRomCurve3(looks, true, 'catmullrom', 0.5), authored: true };
}

export function createMenuFlythrough(built: BuiltLevel, aspect: number): MenuFlythrough {
  const path = flythroughPath(built);
  const camera = new PerspectiveCamera(TUNING.RMENU_FOV_DEG, aspect, 0.1, 600);
  const pos = new Vector3();
  const ahead = new Vector3();
  const look = new Vector3();
  const dir = new Vector3();
  let t = 0;

  const place = (): void => {
    const loopS = Math.max(1, TUNING.MENU_FLYTHROUGH_S);
    if (path.authored) {
      // Same key parameterisation on both curves, so each key frames its own feature.
      path.camera.getPoint(t, pos);
      path.look.getPoint(t, look);
      // Yaw the view left of the feature so it lands in the right third, clear of the menu panel.
      dir.subVectors(look, pos);
      const yaw = (TUNING.RMENU_FRAME_YAW_DEG * Math.PI) / 180;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const dx = dir.x * c + dir.z * s;
      const dz = -dir.x * s + dir.z * c;
      look.set(pos.x + dx, look.y, pos.z + dz);
    } else {
      path.camera.getPointAt(t, pos);
      path.camera.getPointAt((t + TUNING.RMENU_LOOK_AHEAD_S / loopS) % 1, ahead);
      path.look.getPoint(0, look);
      // Look between the path ahead and the park centre, a little below eye height.
      look.lerp(ahead, 0.45);
      look.y = Math.min(look.y, pos.y - 1.5);
    }
    camera.position.copy(pos);
    camera.lookAt(look);
    camera.fov = TUNING.RMENU_FOV_DEG;
    camera.updateProjectionMatrix();
  };
  place();

  return {
    camera,
    update(dtS) {
      const loopS = Math.max(1, TUNING.MENU_FLYTHROUGH_S);
      t = (t + Math.max(0, dtS) / loopS) % 1;
      place();
    },
    setAspect(a) {
      camera.aspect = a;
      camera.updateProjectionMatrix();
    },
    dispose() {
      // Nothing on the GPU: the app owns the scene.
    },
  };
}
