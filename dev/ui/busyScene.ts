/**
 * dev/ui/busyScene.ts (ui track harness): a deliberately busy, bright 3D background so HUD and menu
 * legibility is judged over the worst case (glass towers, neon boxes, a hot sky), not over black.
 */

import { BoxGeometry, Color, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createBasicScene, type BasicScene } from '../shared/harness';

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createBusyScene(): BasicScene & { spin(dtS: number): void } {
  const scene = createBasicScene('#2a3a6a');
  const r = rand(42);
  const palette = ['#ff7a1a', '#35e0ff', '#f2ff3d', '#ff3ca6', '#e9e2cf', '#4fd36b', '#8ab4ff', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const w = 0.6 + r() * 3;
    const h = 0.4 + r() * 9;
    const d = 0.6 + r() * 3;
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color: new Color(palette[Math.floor(r() * palette.length)]), roughness: 0.3, metalness: r() > 0.6 ? 0.9 : 0.1, emissive: r() > 0.7 ? new Color(palette[Math.floor(r() * palette.length)]) : new Color('#000'), emissiveIntensity: 0.6 }));
    m.position.set(2 + r() * 36, h / 2, 2 + r() * 36);
    m.rotation.y = r() * Math.PI;
    scene.scene.add(m);
  }
  const ground = new Mesh(new PlaneGeometry(60, 60, 12, 12), new MeshStandardMaterial({ color: '#c9c2b2', roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(20, -0.01, 20);
  scene.scene.add(ground);
  let t = 0;
  return {
    ...scene,
    spin(dtS) {
      t += dtS * 0.15;
      scene.camera.position.set(20 + Math.cos(t) * 16, 5, 20 + Math.sin(t) * 16);
      scene.camera.lookAt(20, 1.2, 20);
    },
  };
}
