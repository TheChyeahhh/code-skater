/**
 * dev/fx/aura.ts (fx track harness): the special aura against nearby concrete, for the polish-round
 * check that walls and floor no longer cut hard edges into the glow, and on the REAL skater model for
 * the check that the glow never washes the skater out (polish round 2).
 *   ?case=wall   capsule riding the vertical face of a wall (up = wall normal), camera behind
 *   ?case=floor  capsule on the floor 0.4 m in front of a wall (the floor crosses the raw quad)
 *   ?case=skater the real skater (src/render/skater) framed by the real chase rig, wall 6 m ahead;
 *                ?near=1 puts the wall 0.4 m in front of the feet, ?yaw=<deg> turns the body
 *   ?legacy=1    replay the old placement: world-up body offset and no depth push
 *   ?glow=0      aura off; ?push= ?coreback= ?core= ?rim= override the depth profile tunables
 *                (?push=1&coreback=0&core=0&rim=0.01 replays round 1: the whole quad a radius forward)
 * case=skater writes window.__auraStats after 30 frames: mean sRGB colour of the skater's upper body
 * (hoodie) and legs (pants) from a mask pass, and the mean brightness of a ring just outside the
 * silhouette (the glow around the body).
 */

import { BoxGeometry, CapsuleGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { TUNING } from '../../src/core/tuning';
import { restSnapshot } from '../../src/core/mock';
import { DEFAULT_BOARD, type SimSnapshot } from '../../src/core/types';
import { createCameraRig } from '../../src/render/camera';
import { SpecialAura } from '../../src/render/fx/aura';
import { createSkaterView } from '../../src/render/skater/skaterView';
import { createBasicScene, mountPanel, shotReadyAt, startFrames } from '../shared/harness';

declare global {
  interface Window {
    __auraStats?: { hoodie: number[]; pants: number[]; ring: number; maskPx: number };
  }
}

const params = new URLSearchParams(window.location.search);
const which = params.get('case') === 'floor' ? 'floor' : params.get('case') === 'skater' ? 'skater' : 'wall';
const legacy = params.get('legacy') === '1';
const glowOn = params.get('glow') !== '0';
const num = (k: string, fallback: number): number => {
  const v = params.get(k);
  return v !== null && Number.isFinite(Number(v)) ? Number(v) : fallback;
};
const push = legacy ? 0 : num('push', TUNING.FX_AURA_DEPTH_PUSH);
const coreBack = num('coreback', TUNING.FX_AURA_CORE_BACK_M);
const coreR = num('core', TUNING.FX_AURA_CORE_R);
const rimR = num('rim', TUNING.FX_AURA_RIM_R);
const panel = mountPanel('Aura harness', [`case ${which}${legacy ? ', legacy placement' : ''}${glowOn ? '' : ', glow off'}`, `push ${push}, core back ${coreBack} m, core ${coreR}, rim ${rimR}`]);
const s = createBasicScene('#161b26');

const concrete = new MeshStandardMaterial({ color: '#6a7384', roughness: 0.9 });
const aura = new SpecialAura('#ffb347');
s.scene.add(aura.group);
const worldUp = new Vector3(0, 1, 0);

if (which === 'skater') {
  const near = params.get('near') === '1';
  const floor = new Mesh(new BoxGeometry(30, 0.2, 30), new MeshStandardMaterial({ color: '#c79a63', roughness: 0.8 }));
  floor.position.set(20, -0.1, 20);
  s.scene.add(floor);
  const wall = new Mesh(new BoxGeometry(20, 6, 0.4), concrete);
  wall.position.set(20, 3, near ? 19.6 - 0.2 : 14);
  s.scene.add(wall);
  const view = createSkaterView(DEFAULT_BOARD);
  s.scene.add(view.group);
  const rest = restSnapshot();
  const yaw = num('yaw', 0) * (Math.PI / 180);
  const q = new Quaternion().setFromAxisAngle(worldUp, yaw);
  const snap: SimSnapshot = { ...rest, skater: { ...rest.skater, rot: { x: q.x, y: q.y, z: q.z, w: q.w } } };
  const rig = createCameraRig(null);
  rig.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
  rig.snapTo(snap);
  const look = { stick: { x: 0, y: 0 }, mouseDeltaPx: { x: 0, y: 0 } };
  const gl = s.renderer.getContext();
  const white = new MeshBasicMaterial({ color: '#ffffff' });
  const read = (): Uint8Array => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const measure = (): void => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    // Mask pass: only the skater, flat white, on black.
    const bg = s.scene.background;
    s.scene.background = new Color('#000000');
    const was = s.scene.children.map((o) => o.visible);
    for (const o of s.scene.children) o.visible = o === view.group;
    s.scene.overrideMaterial = white;
    s.renderer.render(s.scene, rig.camera);
    const mask = read();
    s.scene.overrideMaterial = null;
    s.scene.background = bg;
    s.scene.children.forEach((o, i) => { o.visible = was[i] ?? true; });
    s.renderer.render(s.scene, rig.camera);
    const img = read();
    let minY = h;
    let maxY = -1;
    let minX = w;
    let maxX = -1;
    let maskPx = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((mask[(y * w + x) * 4] ?? 0) > 128) {
        maskPx++;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      }
    }
    // readPixels rows run bottom up: top of the figure = maxY. Hoodie = 20-45 % down, pants = 55-85 %.
    const band = (a: number, b: number): number[] => {
      const acc = [0, 0, 0];
      let n = 0;
      for (let y = minY; y <= maxY; y++) {
        const down = (maxY - y) / Math.max(1, maxY - minY);
        if (down < a || down > b) continue;
        for (let x = minX; x <= maxX; x++) {
          const i = (y * w + x) * 4;
          if ((mask[i] ?? 0) <= 128) continue;
          acc[0]! += img[i] ?? 0; acc[1]! += img[i + 1] ?? 0; acc[2]! += img[i + 2] ?? 0;
          n++;
        }
      }
      return acc.map((c) => Math.round(c / Math.max(1, n)));
    };
    // Ring: pixels outside the mask within a margin of the bounding box.
    const m = Math.round((maxY - minY) * 0.25);
    let ring = 0;
    let rn = 0;
    for (let y = Math.max(0, minY - m); y <= Math.min(h - 1, maxY + m); y++) for (let x = Math.max(0, minX - m); x <= Math.min(w - 1, maxX + m); x++) {
      const i = (y * w + x) * 4;
      if ((mask[i] ?? 0) > 128) continue;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
      ring += ((img[i] ?? 0) + (img[i + 1] ?? 0) + (img[i + 2] ?? 0)) / 3;
      rn++;
    }
    window.__auraStats = { hoodie: band(0.2, 0.45), pants: band(0.55, 0.85), ring: Math.round(ring / Math.max(1, rn)), maskPx };
    panel.setStatus([`hoodie ${window.__auraStats.hoodie.join(',')}`, `pants ${window.__auraStats.pants.join(',')}`, `ring ${window.__auraStats.ring}`]);
  };
  startFrames((dt, frame) => {
    view.update(snap, dt);
    rig.update(snap, look, dt);
    rig.camera.updateMatrixWorld();
    aura.update(
      dt, snap.skater.pos, snap.skater.up, TUNING.FX_AURA_HEIGHT_M, rig.camera.quaternion, glowOn ? 1 : 0, 1e-3,
      TUNING.FX_AURA_RADIUS_M, 0, push, TUNING.FX_AURA_MIN_VIEW_M, coreBack, coreR, rimR, TUNING.FX_AURA_GROUND_CORE_R,
    );
    if (frame === 30) measure();
    s.renderer.render(s.scene, rig.camera);
    shotReadyAt(frame, 32);
  });
} else {
  const wall = new Mesh(new BoxGeometry(20, 8, 0.4), concrete);
  wall.position.set(20, 4, -0.2);
  s.scene.add(wall);
  const floor = new Mesh(new BoxGeometry(20, 0.2, 12), concrete);
  floor.position.set(20, -0.1, 6);
  s.scene.add(floor);

  const feet = which === 'wall' ? new Vector3(20, 2.5, 0) : new Vector3(20, 0, 0.4);
  const up = which === 'wall' ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const body = new Mesh(new CapsuleGeometry(0.22, 1.2, 4, 12), new MeshStandardMaterial({ color: '#e0673a' }));
  body.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), up);
  body.position.copy(feet).addScaledVector(up, 0.85);
  s.scene.add(body);

  if (which === 'wall') {
    s.camera.position.set(20, 4.5, 5.5);
    s.camera.lookAt(20, 2.6, 0.5);
  } else {
    s.camera.position.set(20, 1.6, 5.4);
    s.camera.lookAt(20, 0.9, 0.4);
  }

  startFrames((dt, frame) => {
    s.camera.updateMatrixWorld();
    aura.update(
      dt, feet, legacy ? worldUp : up, TUNING.FX_AURA_HEIGHT_M, s.camera.quaternion, glowOn ? 1 : 0, 1e-3,
      TUNING.FX_AURA_RADIUS_M, 0, push, TUNING.FX_AURA_MIN_VIEW_M, coreBack, coreR, rimR, TUNING.FX_AURA_GROUND_CORE_R,
    );
    s.render();
    shotReadyAt(frame, 20);
  });
}
