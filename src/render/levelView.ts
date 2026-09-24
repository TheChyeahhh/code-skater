/**
 * src/render/levelView.ts (render track): BuiltLevel -> scene graph. Static parts are merged per
 * (material, shadow flags) into one Mesh each to keep draw calls low, with the registry material
 * (role rail / coping -> registry.rail(kind), "boundary" skipped, every other part -> registry.get);
 * the builder's "color" attribute (fake AO, REQ-REN-03) is respected and a white one is added where
 * missing so vertexColors never darkens a part. Decal quads (polygonOffset, never on rails: validated
 * upstream), letters and the MacGuffin as spinning emissive pickups hidden once collected, NPC figures
 * from deps.createNpc (a placeholder figure while that is a stub), billboard wordmarks
 * (REQ-MAT-04: emissive, brand from BRANDS, on the sign face only). Reads the interpolated snapshot only.
 * Everything emissive (neon parts, sign faces, pickups) is put on BLOOM_LAYER so the selective bloom
 * touches only those (REQ-REN-04 "only emissive"); pickups and sign planes cast no shadow.
 * The builder's boundary walls stay invisible colliders; what closes the view is a render-only
 * backdrop (src/render/lib/backdrop.ts, registry.backdrop): the Woodshed's walls, clerestory windows,
 * ceiling deck and high-bay lamps (DESIGN G.2), and Market Street's ground apron and distant skyline.
 * Decals draw in a single pass (forceSinglePass) so a transparent DoubleSide quad is one draw.
 */

import {
  BufferAttribute, BufferGeometry, CapsuleGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  PlaneGeometry, SphereGeometry, type Material, type Object3D, type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tryImplemented } from '../core/contract';
import { facingToYaw, facingVector } from '../core/math';
import { TUNING } from '../core/tuning';
import type { SimSnapshot } from '../core/types';
import type { BillboardPrim, BuiltDecal, LevelMeshPart, NpcDef } from '../levels/types';
import { shedShell, streetSkyline } from './lib/backdrop';
import { markBloom } from './lib/bloomLayer';
import type { BackdropId, GameMaterialRegistry } from './materials';
import { createLetterProp, createMacGuffinProp, type PickupProp } from './npc';
import { decalTexture, wordmarkTexture } from './textures';
import type { LevelView, LevelViewDeps, MaterialRegistry, NpcFigure } from './types';

const DEG = Math.PI / 180;

interface Pickup {
  readonly mesh: Group;
  readonly prop: PickupProp;
  readonly baseY: number;
  readonly phase: number;
  readonly isCollected: (s: SimSnapshot) => boolean;
}

interface Sign {
  readonly material: MeshStandardMaterial;
  readonly neon: boolean;
}

interface NpcSlot {
  readonly def: NpcDef;
  readonly figure: NpcFigure;
}

/** LevelView plus counters the harness and tests read. */
export interface GameLevelView extends LevelView {
  /** Static merged meshes (one per material + shadow flag combination). */
  readonly staticMeshCount: number;
  /** Render-only backdrop meshes (Woodshed walls, windows, ceiling, lamps; Street apron and skyline). */
  readonly backdropMeshCount: number;
  readonly decalCount: number;
  readonly pickupCount: number;
}

function ensureColor(g: BufferGeometry): BufferGeometry {
  if (g.hasAttribute('color')) return g;
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3).fill(1);
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g;
}

function ensureUv(g: BufferGeometry): BufferGeometry {
  if (g.hasAttribute('uv')) return g;
  const n = g.getAttribute('position').count;
  g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function ensureNormal(g: BufferGeometry): BufferGeometry {
  if (!g.hasAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Merge a list of part geometries into one; falls back to per-part copies when attributes disagree. */
function mergeParts(geoms: readonly BufferGeometry[]): BufferGeometry[] {
  const prepared = geoms.map((g) => ensureColor(ensureUv(ensureNormal(g.clone()))));
  const anyIndexed = prepared.some((g) => g.index !== null);
  const allIndexed = prepared.every((g) => g.index !== null);
  const uniform = anyIndexed && !allIndexed ? prepared.map((g) => (g.index ? g.toNonIndexed() : g)) : prepared;
  const merged = uniform.length === 1 ? uniform[0] ?? null : mergeGeometries(uniform, false);
  if (merged) return [merged];
  return uniform;
}

function materialFor(registry: MaterialRegistry, part: LevelMeshPart): Material {
  if (part.role === 'rail') return registry.rail('rail');
  if (part.role === 'coping') return registry.rail('coping');
  return registry.get(part.material);
}

function groupKey(part: LevelMeshPart): string {
  const mat = part.role === 'rail' ? 'rail:rail' : part.role === 'coping' ? 'rail:coping' : part.material;
  return `${mat}|${part.castShadow ? 1 : 0}|${part.receiveShadow ? 1 : 0}`;
}

function decalQuad(d: BuiltDecal): BufferGeometry {
  const g = new BufferGeometry();
  const c = d.corners;
  const pos = new Float32Array([c[0].x, c[0].y, c[0].z, c[1].x, c[1].y, c[1].z, c[2].x, c[2].y, c[2].z, c[3].x, c[3].y, c[3].z]);
  const nrm = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    nrm[i * 3] = d.normal.x;
    nrm[i * 3 + 1] = d.normal.y;
    nrm[i * 3 + 2] = d.normal.z;
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function placeholderNpc(): NpcFigure {
  const group = new Group();
  const body = new Mesh(new CapsuleGeometry(0.28, 0.9, 4, 10), new MeshStandardMaterial({ color: '#5a6a8a', roughness: 0.8 }));
  body.position.y = 0.75;
  body.castShadow = true;
  const head = new Mesh(new SphereGeometry(0.16, 12, 10), new MeshStandardMaterial({ color: '#d8b090', roughness: 0.7 }));
  head.position.y = 1.5;
  head.castShadow = true;
  group.add(body, head);
  let t = 0;
  return {
    group,
    update(dtS, talking) {
      t += dtS;
      group.rotation.z = Math.sin(t * 1.4) * 0.03;
      head.rotation.y = talking ? Math.sin(t * 6) * 0.25 : 0;
    },
    dispose() {
      body.geometry.dispose();
      (body.material as Material).dispose();
      head.geometry.dispose();
      (head.material as Material).dispose();
    },
  };
}

/**
 * A pickup prop from the skater track (src/render/npc.ts: extruded C-O-D-E letters on a coin, the
 * MacGuffin laptop / drive with its halo and beacon) inside an unnamed holder that LevelView spins and
 * bobs. Marked for bloom, never a shadow caster (letter-shaped shadows read as noise).
 */
function propHolder(prop: PickupProp): Group {
  const holder = new Group();
  holder.add(prop.group);
  holder.traverse((o) => {
    o.castShadow = false;
  });
  markBloom(holder);
  return holder;
}

export function createLevelView(deps: LevelViewDeps): GameLevelView {
  const { built, materials } = deps;
  const group = new Group();
  group.name = `level:${built.def.id}`;
  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: Material[] = [];
  const pickups: Pickup[] = [];
  const signs: Sign[] = [];
  const npcs: NpcSlot[] = [];
  let staticMeshCount = 0;
  let time = 0;

  // --- static parts, merged per material and shadow flags --------------------------------------
  const groups = new Map<string, { part: LevelMeshPart; geoms: BufferGeometry[] }>();
  for (const part of built.parts) {
    if (part.material === 'boundary') continue;
    const key = groupKey(part);
    const g = groups.get(key);
    if (g) g.geoms.push(part.geometry);
    else groups.set(key, { part, geoms: [part.geometry] });
  }
  for (const { part, geoms } of groups.values()) {
    const material = materialFor(materials, part);
    for (const geometry of mergeParts(geoms)) {
      ownedGeometries.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.name = `${groupKey(part)}`;
      mesh.castShadow = part.castShadow;
      mesh.receiveShadow = part.receiveShadow;
      if (part.material === 'neon') markBloom(mesh);
      group.add(mesh);
      staticMeshCount += 1;
    }
  }

  // --- decals -----------------------------------------------------------------------------------
  for (const d of built.decals) {
    const geometry = decalQuad(d);
    ownedGeometries.push(geometry);
    const tex = decalTexture(d.def);
    const material = new MeshStandardMaterial({
      map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
      roughness: d.def.kind === 'water' ? 0.1 : 0.9, metalness: 0, opacity: d.def.kind === 'water' ? 0.85 : 1, side: DoubleSide,
      // One draw with both faces: without this, three draws a transparent DoubleSide material twice
      // (back then front), flipping side and needsUpdate each time, so every decal re-checked its
      // program twice a frame.
      forceSinglePass: true,
    });
    ownedMaterials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.name = `decal:${d.def.id}`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- pickups ----------------------------------------------------------------------------------
  built.def.letters.forEach((l, i) => {
    const prop = createLetterProp(l.letter);
    const mesh = propHolder(prop);
    mesh.position.set(l.pos.x, l.pos.y, l.pos.z);
    group.add(mesh);
    pickups.push({ mesh, prop, baseY: l.pos.y, phase: i * 1.3, isCollected: (s) => s.run.letters[l.letter] });
  });
  if (built.def.macguffin) {
    const m = built.def.macguffin;
    const prop = createMacGuffinProp(m.id);
    const mesh = propHolder(prop);
    mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
    group.add(mesh);
    pickups.push({ mesh, prop, baseY: m.pos.y, phase: 2.1, isCollected: (s) => s.run.macguffinCollected });
  }

  // --- billboard wordmarks ----------------------------------------------------------------------
  for (const p of built.def.primitives) {
    if (p.kind !== 'billboard') continue;
    const bb: BillboardPrim = p;
    const neon = built.parts.some((part) => part.surfaceId === bb.id && part.material === 'neon');
    const n = facingVector(bb.face);
    const alongX = bb.face === 'north' || bb.face === 'south';
    const width = alongX ? bb.rect.x1 - bb.rect.x0 : bb.rect.z1 - bb.rect.z0;
    const height = bb.height;
    const cx = (bb.rect.x0 + bb.rect.x1) / 2;
    const cz = (bb.rect.z0 + bb.rect.z1) / 2;
    const px = bb.face === 'east' ? bb.rect.x1 : bb.face === 'west' ? bb.rect.x0 : cx;
    const pz = bb.face === 'south' ? bb.rect.z1 : bb.face === 'north' ? bb.rect.z0 : cz;
    const texW = 1024;
    const texH = Math.max(64, Math.round((texW * height) / Math.max(0.1, width)));
    const tex = wordmarkTexture(bb.brand, texW, Math.min(512, texH));
    const base = neon ? TUNING.RMAT_NEON_EMISSIVE : TUNING.RLV_SIGN_EMISSIVE;
    const material = new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new Color('#ffffff'), emissiveIntensity: base, roughness: 0.5, metalness: 0 });
    ownedMaterials.push(material);
    const geometry = new PlaneGeometry(width * 0.96, height * 0.9);
    ownedGeometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(px + n.x * 0.02, bb.y0 + height / 2, pz + n.z * 0.02);
    mesh.rotation.y = facingToYaw(bb.face) + Math.PI;
    mesh.name = `sign:${bb.id}`;
    if (neon) markBloom(mesh);
    group.add(mesh);
    signs.push({ material, neon });
  }

  // --- backdrop: the Woodshed room, the Street skyline (render only) ------------------------------
  const backdrop = (materials as Partial<GameMaterialRegistry>).backdrop;
  let backdropMeshCount = 0;
  const addBackdrop = (name: string, geometry: BufferGeometry, id: BackdropId, opts: { receiveShadow: boolean; bloom: boolean }): void => {
    if (!backdrop) return;
    ownedGeometries.push(geometry);
    const mesh = new Mesh(geometry, backdrop(id));
    mesh.name = `backdrop:${name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = opts.receiveShadow;
    if (opts.bloom) markBloom(mesh);
    group.add(mesh);
    backdropMeshCount += 1;
  };
  if (backdrop && built.def.environment === 'woodshedInterior') {
    const shell = shedShell(built.def.size.x, built.def.size.z);
    addBackdrop('walls', shell.walls, 'shedWall', { receiveShadow: true, bloom: false });
    addBackdrop('windows', shell.windows, 'shedWindow', { receiveShadow: false, bloom: true });
    addBackdrop('ceiling', shell.ceiling, 'shedCeiling', { receiveShadow: false, bloom: false });
    addBackdrop('lamps', shell.lamps, 'shedLamp', { receiveShadow: false, bloom: true });
  } else if (backdrop && (built.def.environment === 'streetAfternoon' || built.def.environment === 'campusNight')) {
    const sky = streetSkyline(built.def.size.x, built.def.size.z);
    addBackdrop('apron', sky.apron, 'apron', { receiveShadow: false, bloom: false });
    addBackdrop('skyline', sky.blocks, 'skyline', { receiveShadow: false, bloom: false });
  }

  // --- NPC figures ------------------------------------------------------------------------------
  for (const def of built.def.npcs) {
    const figure = tryImplemented(() => deps.createNpc(def)) ?? placeholderNpc();
    figure.group.position.set(def.pos.x, def.pos.y, def.pos.z);
    figure.group.rotation.y = facingToYaw(def.facing);
    group.add(figure.group);
    npcs.push({ def, figure });
  }

  const registry = materials as MaterialRegistry & Partial<Pick<GameMaterialRegistry, 'refresh' | 'setEnvironment'>>;
  /** The scene this view is mounted in (walk up the parents), for its environment map. */
  const sceneOf = (): Scene | null => {
    let o: Object3D | null = group.parent;
    while (o && !(o as Scene).isScene) o = o.parent;
    return (o as Scene | null) ?? null;
  };

  return {
    group,
    get staticMeshCount() {
      return staticMeshCount;
    },
    get backdropMeshCount() {
      return backdropMeshCount;
    },
    get decalCount() {
      return built.decals.length;
    },
    get pickupCount() {
      return pickups.length;
    },
    update(snapshot, dtS) {
      time += dtS;
      // Registry materials carry the scene's IBL map explicitly so their envMapIntensity applies
      // (see GameMaterialRegistry.setEnvironment); a no-op when it did not change.
      const scene = sceneOf();
      if (scene) {
        registry.setEnvironment?.(scene.environment);
        for (const m of ownedMaterials) {
          if (!(m instanceof MeshStandardMaterial)) continue;
          if (m.envMap !== scene.environment) m.envMap = scene.environment;
          m.envMapIntensity = TUNING.RSKY_ENV_INTENSITY;
        }
      }
      registry.refresh?.();
      const spin = TUNING.RLV_PICKUP_SPIN_DPS * DEG;
      for (const p of pickups) {
        const collected = p.isCollected(snapshot);
        p.mesh.visible = !collected;
        if (collected) continue;
        p.prop.update?.(dtS);
        p.mesh.rotation.y = (time * spin + p.phase) % (Math.PI * 2);
        p.mesh.position.y = p.baseY + Math.sin(time * TUNING.RLV_PICKUP_BOB_HZ * Math.PI * 2 + p.phase) * TUNING.RLV_PICKUP_BOB_M;
      }
      for (const s of signs) {
        const base = s.neon ? TUNING.RMAT_NEON_EMISSIVE : TUNING.RLV_SIGN_EMISSIVE;
        const pulse = s.neon ? 1 + TUNING.RLV_SIGN_PULSE_DEPTH * Math.sin(time * TUNING.RLV_SIGN_PULSE_HZ * Math.PI * 2) : 1;
        s.material.emissiveIntensity = base * pulse;
      }
      for (const n of npcs) n.figure.update(dtS, snapshot.npc?.npcId === n.def.id);
    },
    dispose() {
      for (const n of npcs) n.figure.dispose();
      for (const p of pickups) p.prop.dispose();
      for (const g of ownedGeometries) g.dispose();
      for (const m of ownedMaterials) m.dispose();
      group.clear();
    },
  };
}
