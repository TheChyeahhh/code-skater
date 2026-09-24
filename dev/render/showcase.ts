/**
 * dev/render/showcase.ts (render track harness): the material showcase. One sphere and one cube per
 * MaterialId on a concrete floor (uv in metres, white vertex colours), a flat bar, a coping pipe on a
 * maple quarter-pipe stand-in, a brick wall, a glass slab and three wordmark signs (one per brand
 * slot, the first neon). Harness code only.
 */

import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import type { BrandKey } from '../../src/data/brands';
import { TUNING } from '../../src/core/tuning';
import type { MaterialId } from '../../src/levels/types';
import { MATERIAL_IDS, type GameMaterialRegistry } from '../../src/render/materials';
import { wordmarkTexture } from '../../src/render/textures';

function whiteColors(g: BufferGeometry): BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/** Planar uv in metres from the dominant normal axis. */
function metreUv(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    if (ay >= ax && ay >= az) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else if (ax >= az) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

function sphereMetreUv(g: BufferGeometry, radius: number): BufferGeometry {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * radius * Math.PI * 2, uv.getY(i) * radius * Math.PI);
  return g;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.applyMatrix4(new Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  return whiteColors(metreUv(g));
}

function quarterPipe(x1: number, z0: number, z1: number, radius: number, copingHeight: number): BufferGeometry {
  const segs = 16;
  const angle = Math.asin(Math.min(1, copingHeight / radius));
  const cx = x1 - radius;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * angle;
    const x = cx + Math.sin(a) * radius;
    const y = radius - Math.cos(a) * radius;
    for (const z of [z0, z1]) {
      positions.push(x, y, z);
      normals.push(-Math.sin(a), Math.cos(a), 0);
      uvs.push(a * radius, z);
    }
  }
  for (let j = 0; j < segs; j++) {
    const a = j * 2;
    index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(index);
  return whiteColors(g);
}

function pipeX(x0: number, x1: number, y: number, z: number, r: number): BufferGeometry {
  const g = new CylinderGeometry(r, r, x1 - x0, 14, 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * Math.PI * 2, uv.getY(i) * (x1 - x0));
  g.applyMatrix4(new Matrix4().makeTranslation((x0 + x1) / 2, y, z).multiply(new Matrix4().makeRotationZ(Math.PI / 2)));
  return whiteColors(g);
}

function pipeY(x: number, y0: number, y1: number, z: number, r: number): BufferGeometry {
  const g = new CylinderGeometry(r, r, y1 - y0, 12, 1);
  g.applyMatrix4(new Matrix4().makeTranslation(x, (y0 + y1) / 2, z));
  return whiteColors(g);
}

export interface Showcase {
  readonly group: Group;
  /** Sign materials to pulse (index 0 is the neon one). */
  readonly signs: MeshStandardMaterial[];
  dispose(): void;
}

export function buildShowcase(registry: GameMaterialRegistry): Showcase {
  const group = new Group();
  const owned: BufferGeometry[] = [];
  const signs: MeshStandardMaterial[] = [];
  const add = (geometry: BufferGeometry, material: MaterialId | 'rail' | 'coping', cast = true, receive = true): Mesh => {
    owned.push(geometry);
    const mat = material === 'rail' ? registry.rail('rail') : material === 'coping' ? registry.rail('coping') : registry.get(material);
    const mesh = new Mesh(geometry, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };

  // Floor 40 x 40 m of concrete with an asphalt strip and a plaza tile patch.
  add(box(0, -0.2, 0, 40, 0, 40), 'concrete', false, true);
  add(box(0, -0.1, 30, 40, 0.005, 36), 'asphalt', false, true);
  add(box(24, -0.1, 4, 40, 0.01, 16), 'plazaTile', false, true);

  // Swatch rows: sphere + cube per material, 7 per row.
  const perRow = 7;
  MATERIAL_IDS.filter((id) => id !== 'boundary').forEach((id, i) => {
    const x = 4 + (i % perRow) * 3.6;
    const z = 6 + Math.floor(i / perRow) * 4.2;
    const sphere = whiteColors(sphereMetreUv(new SphereGeometry(0.7, 40, 24), 0.7));
    sphere.applyMatrix4(new Matrix4().makeTranslation(x, 0.72, z));
    add(sphere, id);
    add(box(x + 1.4, 0, z - 0.6, x + 2.6, 1.2, z + 0.6), id);
  });

  // Flat bar with posts, a marble ledge, a brick wall.
  add(pipeX(4, 16, 0.55, 22, 0.03), 'rail');
  add(pipeY(4.6, 0, 0.55, 22, 0.025), 'rail');
  add(pipeY(15.4, 0, 0.55, 22, 0.025), 'rail');
  add(box(18, 0, 21.7, 28, 0.45, 22.3), 'marble');
  add(box(0, 0, 0, 40, 4, 0.6), 'brick');

  // Maple quarter pipe with coping, wood cheeks, painted steel back.
  add(quarterPipe(36, 24, 34, 3.2, 2.5), 'maple');
  const copingG = new CylinderGeometry(0.045, 0.045, 10, 14, 1);
  copingG.applyMatrix4(new Matrix4().makeTranslation(36, 2.5, 29).multiply(new Matrix4().makeRotationX(Math.PI / 2)));
  whiteColors(copingG);
  add(copingG, 'coping');
  add(box(32.8, 0, 23.8, 38, 2.5, 24), 'woodPanel');
  add(box(32.8, 0, 34, 38, 2.5, 34.2), 'woodPanel');
  add(box(36, 0, 24, 38, 2.5, 34), 'mapleDark');
  add(box(38, 0, 23.8, 38.3, 2.7, 34.2), 'paintedSteel');

  // Glass slab with a frame and a tar roof.
  add(box(28, 0, 36.5, 40, 12, 40), 'glass');
  add(box(27.8, 0, 36.3, 40, 0.5, 40), 'towerFrame');
  add(box(28, 12, 36.5, 40, 12.3, 40), 'roofTar');

  // Scaffold frame with a metal deck.
  for (const x of [20, 24]) add(pipeY(x, 0, 6, 38, 0.04), 'scaffold');
  add(pipeX(20, 24, 3, 38, 0.04), 'scaffold');
  add(pipeX(20, 24, 6, 38, 0.04), 'scaffold');
  add(box(19.8, 3, 36.6, 24.2, 3.06, 38.2), 'metalPanel');

  // Water basin.
  add(box(8, 0, 26, 14, 0.4, 29), 'granite');
  add(box(8.4, 0.3, 26.4, 13.6, 0.32, 28.6), 'water', false, true);

  // Signs: three wordmarks on the brick wall, first one neon.
  const brands: BrandKey[] = ['labA', 'labB', 'chip'];
  brands.forEach((brand, i) => {
    const x0 = 3 + i * 12.5;
    const neon = i === 0;
    add(box(x0, 4.3, 0.6, x0 + 10, 6.3, 1.1), neon ? 'neon' : 'signBoard');
    const tex = wordmarkTexture(brand, 1024, 205);
    const mat = new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new Color('#ffffff'), emissiveIntensity: neon ? TUNING.RMAT_NEON_EMISSIVE : 1.2, roughness: 0.5 });
    signs.push(mat);
    const plane = new PlaneGeometry(9.6, 1.8);
    owned.push(plane);
    const mesh = new Mesh(plane, mat);
    mesh.position.set(x0 + 5, 5.3, 1.12);
    group.add(mesh);
  });

  return {
    group,
    signs,
    dispose() {
      for (const g of owned) g.dispose();
      for (const s of signs) s.dispose();
      group.clear();
    },
  };
}
