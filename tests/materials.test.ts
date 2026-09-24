// tests/materials.test.ts (render track): the procedural material registry (REQ-MAT-01..05).
// Every MaterialId is served; rails and copings carry the RAIL_EMISSIVE_RIM emissive (0.05), metal
// 1 / roughness 0.25 and a streak normal map; maple is clearcoat 0.3 / roughness 0.45 with 2.4 m
// sheet seams; textures are seeded, tiling, mipmapped, anisotropic and cached. Node only: pixel
// generators need no canvas; text textures fall back to a 1 x 1 placeholder here.
import { Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, NoColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/tuning';
import { createMaterialRegistry, ENV_SCALE, MATERIAL_IDS, RAIL_RIM_COLOR } from '../src/render/materials';
import { generate, LINEAR_MAP_KINDS, TILE_M } from '../src/render/textures/generators';
import { decalTexture, disposeTextureCache, proceduralTexture, textureCacheSize, wordmarkTexture } from '../src/render/textures';
import { TEXTURE_ANISOTROPY } from '../src/render/lib/pixels';

describe('registry serves every MaterialId', () => {
  const registry = createMaterialRegistry();

  it('get(id) returns a shared material for all 21 ids, built lazily', () => {
    expect(MATERIAL_IDS).toHaveLength(21);
    expect(registry.built).toEqual([]);
    for (const id of MATERIAL_IDS) {
      const m = registry.get(id);
      expect(m, id).toBeDefined();
      expect(registry.get(id), `${id} is shared`).toBe(m);
    }
    expect([...registry.built].sort()).toEqual([...MATERIAL_IDS].sort());
  });

  it('REQ-MAT-02: rail and coping materials are metal 1 / roughness 0.25 with a streak normal map and the emissive rim', () => {
    for (const kind of ['rail', 'coping'] as const) {
      const m = registry.rail(kind);
      expect(m).toBeInstanceOf(MeshStandardMaterial);
      const s = m as MeshStandardMaterial;
      expect(s.metalness).toBe(1);
      expect(s.roughness).toBe(0.25);
      expect(s.normalMap).not.toBeNull();
      expect(s.emissiveIntensity).toBe(TUNING.RAIL_EMISSIVE_RIM);
      expect(s.emissiveIntensity).toBe(0.05);
      expect(s.emissive.getHex()).toBe(new Color(RAIL_RIM_COLOR).getHex());
      expect(s.onBeforeCompile).toBeTypeOf('function');
      // Dark gunmetal F0 (a dark bar with a highlight reads on a light floor), a stronger IBL share.
      expect(s.color.getHex()).toBeLessThan(0x808080);
      expect(s.envMapIntensity).toBeCloseTo(TUNING.RSKY_ENV_INTENSITY * (ENV_SCALE[kind === 'rail' ? 'steelRail' : 'steelCoping'] ?? 1), 6);
    }
    expect(registry.rail('rail')).toBe(registry.get('steelRail'));
    expect(registry.rail('coping')).toBe(registry.get('steelCoping'));
    // A ledge has no pipe but its grind edge still carries the rim.
    expect((registry.rail('ledge') as MeshStandardMaterial).emissiveIntensity).toBe(TUNING.RAIL_EMISSIVE_RIM);
  });

  it('REQ-MAT-01: maple is clearcoat 0.3, roughness 0.45, grain map tiling one 2.4 x 1.2 m sheet', () => {
    const m = registry.get('maple') as MeshPhysicalMaterial;
    expect(m).toBeInstanceOf(MeshPhysicalMaterial);
    expect(m.clearcoat).toBe(0.3);
    expect(m.roughness).toBe(0.45);
    expect(m.map).not.toBeNull();
    expect(m.map?.repeat.x).toBeCloseTo(1 / TUNING.RMAT_SHEET_M, 6);
    expect(m.map?.repeat.y).toBeCloseTo(1 / 1.2, 6);
    expect(TILE_M.mapleGrain).toEqual([2.4, 1.2]);
  });

  it('REQ-MAT-03: glass reflects (a clearcoated dielectric, low roughness, env-mapped, lit windows); concrete, marble, asphalt, scaffold have maps', () => {
    const g = registry.get('glass') as MeshPhysicalMaterial;
    expect(g.roughness).toBeLessThanOrEqual(0.15);
    expect(g.metalness).toBe(0);
    expect(g.clearcoat).toBe(1);
    expect(g.envMapIntensity).toBeGreaterThan(TUNING.RSKY_ENV_INTENSITY);
    expect(g.envMapIntensity).toBeCloseTo(TUNING.RSKY_ENV_INTENSITY * (ENV_SCALE.glass ?? 0), 6);
    expect(ENV_SCALE.glass).toBeGreaterThanOrEqual(2.5);
    expect(g.emissiveMap).not.toBeNull();
    expect(g.emissiveIntensity).toBe(TUNING.RMAT_GLASS_EMISSIVE);
    expect(g.emissiveIntensity).toBeLessThan(TUNING.BLOOM_THRESHOLD);
    // Concrete carries a roughness map derived from the same height field (pits shinier than the dry slab).
    const c = registry.get('concrete') as MeshStandardMaterial;
    expect(c.roughnessMap).not.toBeNull();
    expect(c.roughness).toBe(1);
    for (const id of ['scaffold', 'metalPanel', 'towerFrame'] as const) {
      expect((registry.get(id) as MeshStandardMaterial).envMapIntensity, id).toBeCloseTo(TUNING.RSKY_ENV_INTENSITY * (ENV_SCALE[id] ?? 0), 6);
      expect(ENV_SCALE[id] ?? 0, id).toBeGreaterThanOrEqual(2.5);
    }
    for (const id of ['concrete', 'marble', 'asphalt', 'scaffold', 'brick', 'plazaTile', 'granite', 'roofTar', 'water'] as const) {
      expect((registry.get(id) as MeshStandardMaterial).map, id).not.toBeNull();
    }
    expect((registry.get('concrete') as MeshStandardMaterial).normalMap).not.toBeNull();
  });

  it('REQ-MAT-04: neon is emissive above the bloom threshold; boundary is invisible', () => {
    const n = registry.get('neon') as MeshStandardMaterial;
    expect(n.emissiveIntensity).toBe(TUNING.RMAT_NEON_EMISSIVE);
    expect(n.emissiveIntensity).toBeGreaterThan(TUNING.BLOOM_THRESHOLD);
    const b = registry.get('boundary') as MeshBasicMaterial;
    expect(b.transparent).toBe(true);
    expect(b.opacity).toBe(0);
    expect(b.depthWrite).toBe(false);
    expect(b.colorWrite).toBe(false);
  });

  it('every level material respects vertex colours (fake AO, REQ-REN-03)', () => {
    for (const id of MATERIAL_IDS) {
      if (id === 'boundary') continue;
      expect((registry.get(id) as MeshStandardMaterial).vertexColors, id).toBe(true);
    }
  });

  it('setEnvironment gives every material the IBL map explicitly, so envMapIntensity applies (three uses scene.environmentIntensity = 1 otherwise)', () => {
    const r = createMaterialRegistry();
    const before = r.get('concrete') as MeshStandardMaterial;
    expect(before.envMap).toBeNull();
    const env = proceduralTexture('concrete', 8, 1);
    r.setEnvironment(env);
    expect(r.environment).toBe(env);
    expect(before.envMap).toBe(env);
    // Materials built after the call get it too, backdrops included.
    expect((r.get('glass') as MeshStandardMaterial).envMap).toBe(env);
    expect((r.backdrop('shedWall') as MeshStandardMaterial).envMap).toBe(env);
    expect((r.rail('rail') as MeshStandardMaterial).envMap).toBe(env);
    r.setEnvironment(null);
    expect(before.envMap).toBeNull();
    // No r.dispose() here: it frees the shared texture cache the next test counts.
  });

  it('refresh() re-reads the live rim and dispose() clears materials and the texture cache', () => {
    const rail = registry.rail('rail') as MeshStandardMaterial;
    const before = TUNING.RAIL_EMISSIVE_RIM;
    TUNING.RAIL_EMISSIVE_RIM = 0.1;
    registry.refresh();
    expect(rail.emissiveIntensity).toBe(0.1);
    TUNING.RAIL_EMISSIVE_RIM = before;
    registry.refresh();
    expect(rail.emissiveIntensity).toBe(before);
    expect(textureCacheSize()).toBeGreaterThan(5);
    registry.dispose();
    expect(registry.built).toEqual([]);
    expect(textureCacheSize()).toBe(0);
  });
});

describe('procedural textures (REQ-MAT-05)', () => {
  it('are seeded: same kind, size and seed gives identical pixels; a different seed differs', () => {
    const a = generate('concrete', 32, 7);
    const b = generate('concrete', 32, 7);
    const c = generate('concrete', 32, 8);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
    expect(a.data.length).toBe(32 * 32 * 4);
  });

  it('every generator kind produces an opaque (or crosswalk alpha) buffer of the right shape', () => {
    for (const kind of Object.keys(TILE_M) as (keyof typeof TILE_M)[]) {
      const p = generate(kind, 32, 1);
      expect(p.data.length, kind).toBe(p.width * p.height * 4);
      const [tx, ty] = TILE_M[kind];
      expect(p.width / p.height, kind).toBeCloseTo(tx / ty, 1);
      let alphaFull = 0;
      for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) alphaFull += 1;
      if (kind !== 'crosswalk') expect(alphaFull, kind).toBe(p.width * p.height);
    }
  });

  it('concrete: mid-grey base with expansion joints, a roughness map in the linear list, pits below the slab in the height field', () => {
    const p = generate('concrete', 128, 201);
    let sum = 0;
    let dark = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      sum += p.data[i] as number;
      if ((p.data[i] as number) < 80) dark += 1;
    }
    const mean = sum / (p.data.length / 4);
    expect(mean).toBeGreaterThan(90);
    expect(mean).toBeLessThan(140); // the old 168 base read as paper under the sun
    expect(dark).toBeGreaterThan(128 * 2); // two joint lines per axis at least
    const r = generate('concreteRough', 64, 201);
    let lo = 255;
    let hi = 0;
    for (let i = 1; i < r.data.length; i += 4) {
      lo = Math.min(lo, r.data[i] as number);
      hi = Math.max(hi, r.data[i] as number);
    }
    expect(lo).toBeLessThan(0.75 * 255);
    expect(hi).toBeGreaterThan(0.85 * 255);
    expect(LINEAR_MAP_KINDS).toContain('concreteRough');
    expect(proceduralTexture('concreteRough', 16, 1).colorSpace).toBe(NoColorSpace);
    disposeTextureCache();
  });

  it('glass: daylight lit ratio is low, mullions are light grey, panes dark (a dielectric with the reflection doing the work)', () => {
    expect(TUNING.RMAT_WINDOW_LIT_RATIO).toBeLessThanOrEqual(0.2);
    const p = generate('glassWindows', 160, 301);
    let bright = 0;
    let darkPane = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const l = p.data[i + 1] as number;
      if (l > 120) bright += 1;
      else if (l < 60) darkPane += 1;
    }
    const total = p.data.length / 4;
    expect(bright / total).toBeGreaterThan(0.03); // thin mullion grid
    expect(bright / total).toBeLessThan(0.2);
    expect(darkPane / total).toBeGreaterThan(0.5);
    const lit = generate('glassWindowsLit', 160, 301, { litRatio: 0.12 });
    let litPx = 0;
    for (let i = 0; i < lit.data.length; i += 4) if ((lit.data[i] as number) > 0) litPx += 1;
    expect(litPx / total).toBeLessThan(0.3);
  });

  it('metal streaks run along v (the pipe length), not around the circumference', () => {
    // Along v the normal should vary little; across u it should vary a lot.
    const p = generate('metalStreaks', 64, 304);
    const at = (x: number, y: number): number => p.data[(y * 64 + x) * 4] as number;
    let alongV = 0;
    let acrossU = 0;
    for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) {
      alongV += Math.abs(at(x, y + 1) - at(x, y));
      acrossU += Math.abs(at(x + 1, y) - at(x, y));
    }
    expect(acrossU).toBeGreaterThan(alongV * 1.5);
  });

  it('marble veins: the warped field makes dark veins on a light ground (not flat)', () => {
    const p = generate('marbleVeins', 64, 3);
    let dark = 0;
    let light = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      const l = p.data[i] as number;
      if (l < 185) dark += 1;
      else if (l > 200) light += 1;
    }
    expect(dark).toBeGreaterThan(20);
    expect(light).toBeGreaterThan(dark);
  });

  it('marble veins read as polished stone, not cracked ice: thin (few dark pixels) and only 20 to 40 % darker than the ground', () => {
    const p = generate('marbleVeins', 512, 203); // the size and seed the registry uses
    const lum: number[] = [];
    for (let i = 0; i < p.data.length; i += 4) lum.push(0.2126 * (p.data[i] as number) + 0.7152 * (p.data[i + 1] as number) + 0.0722 * (p.data[i + 2] as number));
    const sorted = [...lum].sort((a, b) => a - b);
    const ground = sorted[Math.floor(sorted.length / 2)] as number;
    const darkest = sorted[Math.floor(sorted.length * 0.002)] as number;
    // Vein contrast: the darkest veins sit 20 to 40 % under the ground (the old map went 58 % darker).
    expect(darkest / ground).toBeGreaterThan(0.6);
    expect(darkest / ground).toBeLessThan(0.8);
    // Thin: under 7 % of the pixels are noticeably darker than the ground (the old map had 12 %).
    const veinShare = lum.filter((l) => l < ground * 0.88).length / lum.length;
    expect(veinShare).toBeGreaterThan(0.005);
    expect(veinShare).toBeLessThan(0.07);
  });

  it('normal maps point mostly +z (blue), colour maps are sRGB, all tile with mipmaps and anisotropy; cached', () => {
    disposeTextureCache();
    const nm = proceduralTexture('metalStreaks', 32, 1);
    expect(nm.colorSpace).toBe(NoColorSpace);
    const data = (nm.image as { data: Uint8Array }).data;
    let blue = 0;
    for (let i = 2; i < data.length; i += 4) blue += data[i] as number;
    expect(blue / (data.length / 4)).toBeGreaterThan(200);
    const cm = proceduralTexture('brick', 32, 1);
    expect(cm.colorSpace).toBe(SRGBColorSpace);
    expect(cm.wrapS).toBe(RepeatWrapping);
    expect(cm.wrapT).toBe(RepeatWrapping);
    expect(cm.generateMipmaps).toBe(true);
    expect(cm.anisotropy).toBe(TEXTURE_ANISOTROPY);
    expect(cm.repeat.x).toBeCloseTo(1 / TILE_M.brick[0], 6);
    expect(proceduralTexture('brick', 32, 1)).toBe(cm);
    expect(textureCacheSize()).toBe(2);
    disposeTextureCache();
  });

  it('wordmark and text decals need a canvas: in node they return a placeholder, never throw', () => {
    const w = wordmarkTexture('labA', 64, 16);
    expect(w).toBeDefined();
    const d = decalTexture({ id: 'x', kind: 'graffiti', center: { x: 0, y: 0, z: 0 }, on: 'up', width: 2, height: 1, text: 'hi' });
    expect(d).toBeDefined();
    const x = decalTexture({ id: 'y', kind: 'crosswalk', center: { x: 0, y: 0, z: 0 }, on: 'up', width: 4, height: 2 });
    expect((x.image as { width: number }).width).toBeGreaterThan(1);
    disposeTextureCache();
  });
});
