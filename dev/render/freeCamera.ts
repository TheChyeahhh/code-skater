/**
 * dev/render/freeCamera.ts (render track harness): a fly camera. WASD moves, Q / E down / up, drag
 * with the mouse to look, Shift for speed. ?cam=x,y,z,tx,ty,tz places it for deterministic
 * screenshots. Harness code only, never shipped.
 */

import { PerspectiveCamera, Vector3 } from 'three';

export interface FreeCamera {
  readonly camera: PerspectiveCamera;
  update(dtS: number): void;
  lookFrom(pos: Vector3, target: Vector3): void;
}

export function createFreeCamera(canvas: HTMLElement, fovDeg: number, aspect: number): FreeCamera {
  const camera = new PerspectiveCamera(fovDeg, aspect, 0.1, 600);
  let yaw = 0;
  let pitch = 0;
  const held = new Set<string>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (e) => held.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.004;
    pitch -= (e.clientY - lastY) * 0.004;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    lastX = e.clientX;
    lastY = e.clientY;
  });

  const forward = new Vector3();
  const right = new Vector3();
  const apply = (): void => {
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  };
  apply();

  return {
    camera,
    update(dtS) {
      const speed = (held.has('shift') ? 24 : 8) * dtS;
      camera.getWorldDirection(forward);
      right.crossVectors(forward, camera.up).normalize();
      if (held.has('w')) camera.position.addScaledVector(forward, speed);
      if (held.has('s')) camera.position.addScaledVector(forward, -speed);
      if (held.has('d')) camera.position.addScaledVector(right, speed);
      if (held.has('a')) camera.position.addScaledVector(right, -speed);
      if (held.has('e')) camera.position.y += speed;
      if (held.has('q')) camera.position.y -= speed;
      apply();
    },
    lookFrom(pos, target) {
      camera.position.copy(pos);
      const d = target.clone().sub(pos).normalize();
      yaw = Math.atan2(-d.x, -d.z);
      pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
      apply();
    },
  };
}
