// tests/render.test.ts (render track): renderer config (REQ-REN-01), the post chain plan and its
// SSAO fallback (REQ-REN-04), the following texel-snapped shadow frustum (REQ-REN-03), the level
// view's merging / boundary / pickup rules and the menu flythrough (REQ-MNU-01). Node only: no WebGL.
import { ACESFilmicToneMapping, AgXToneMapping, Color, FrontSide, Group, Layers, Mesh, PCFShadowMap, SRGBColorSpace, Vector3, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { restSnapshot } from '../src/core/mock';
import { TUNING } from '../src/core/tuning';
import { createLevelView } from '../src/render/levelView';
import { createLighting } from '../src/render/lighting';
import { assemblePasses, planPostChain, type StageFactories } from '../src/render/lib/postPlan';
import { lightToWorld, snapShadowFocus, sunDirection } from '../src/render/lib/shadowSnap';
import { createMaterialRegistry } from '../src/render/materials';
import { CLEARANCE_M, createMenuFlythrough, FLY_SAMPLES, FLY_TOURS, floorUnder, flythroughPath, flythroughWaypoints } from '../src/render/menuFlythrough';
import { buildLevel } from '../src/levels/builder';
import { MARKET_STREET } from '../src/levels/marketStreet';
import { pickToneMapping, pixelRatioFor, rendererConfig } from '../src/render/renderer';
import { qualitySettings } from '../src/render/quality';
import { notImplemented } from '../src/core/contract';
import { BLOOM_LAYER, isBloomMarked, markBloom, unmarkBloom } from '../src/render/lib/bloomLayer';
import { streetSkyline } from '../src/render/lib/backdrop';
import { pixelWorldSize, railInflate, setViewportSize, VIEWPORT, VIEWPORT_HEIGHT_UNIFORM } from '../src/render/lib/viewport';
import { aoSettingsFor, smaaPresetFor } from '../src/render/post';
import { ENV } from '../src/render/lighting';
import { bakedHorizonColor, environmentFog, quietPmremBake } from '../src/render/sky';
import { disableN8aoTransparency, patchDenoiseShader, patchN8aoPass, type PatchableN8ao } from '../src/render/lib/n8aoPatch';
import type { GameRenderer } from '../src/render/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { miniPark } from './fixtures/render/miniPark';

describe('REQ-REN-01 renderer config', () => {
  it('SRGB output, AgX tone mapping with the ACESFilmic fallback, exposure from TUNING, PCF shadows', () => {
    const cfg = rendererConfig(qualitySettings('high'), 1);
    expect(cfg.outputColorSpace).toBe(SRGBColorSpace);
    expect(cfg.toneMapping).toBe(AgXToneMapping);
    expect(cfg.toneMappingName).toBe('agx');
    expect(cfg.exposure).toBe(TUNING.RENDER_EXPOSURE);
    expect(cfg.shadowMapType).toBe(PCFShadowMap);
    expect(pickToneMapping(false)).toEqual({ id: ACESFilmicToneMapping, name: 'acesFilmic' });
    expect(rendererConfig(qualitySettings('low'), 1, false).toneMappingName).toBe('acesFilmic');
  });

  it('REQ-REN-07 pixel ratio = min(devicePixelRatio, preset cap)', () => {
    expect(pixelRatioFor(2, qualitySettings('low'))).toBe(1);
    expect(pixelRatioFor(2, qualitySettings('med'))).toBe(1.25);
    expect(pixelRatioFor(2, qualitySettings('high'))).toBe(1.5);
    expect(pixelRatioFor(3, qualitySettings('ultra'))).toBe(2);
    expect(pixelRatioFor(1, qualitySettings('ultra'))).toBe(1);
    expect(pixelRatioFor(Number.NaN, qualitySettings('ultra'))).toBe(1);
  });
});

describe('REQ-REN-04 post chain plan', () => {
  const fakeFactories = (n8aoThrows: boolean): StageFactories<string> => ({
    render: () => 'RenderPass',
    n8ao: () => {
      if (n8aoThrows) throw new Error('no float textures');
      return 'N8AOPostPass';
    },
    ssao: () => 'SSAO',
    bloomTone: (bloom) => (bloom ? 'Bloom+AgX' : 'AgX'),
    smaa: () => 'SMAA',
    finish: () => 'Vignette+CA',
  });

  it('High: render -> N8AO -> bloom + tone mapping -> SMAA -> vignette + chromatic aberration', () => {
    const q = qualitySettings('high');
    expect(planPostChain(q)).toEqual(['render', 'ao', 'bloomTone', 'smaa', 'finish']);
    const warnings: string[] = [];
    const passes = assemblePasses(planPostChain(q), q, fakeFactories(false), (m) => warnings.push(m));
    expect(passes.map((p) => p.name)).toEqual(['render', 'n8ao', 'bloom+toneMapping', 'smaa', 'vignette+chromaticAberration']);
    expect(passes.map((p) => p.pass)).toEqual(['RenderPass', 'N8AOPostPass', 'Bloom+AgX', 'SMAA', 'Vignette+CA']);
    expect(warnings).toEqual([]);
  });

  it('Low: no AO, no bloom, tone mapping still happens exactly once', () => {
    const q = qualitySettings('low');
    const passes = assemblePasses(planPostChain(q), q, fakeFactories(false), () => undefined);
    expect(passes.map((p) => p.name)).toEqual(['render', 'toneMapping', 'smaa', 'vignette+chromaticAberration']);
    expect(passes.filter((p) => p.name.includes('toneMapping'))).toHaveLength(1);
  });

  it('N8AO throwing at init falls back to SSAO in the same slot with one console.warn', () => {
    const q = qualitySettings('ultra');
    const warnings: string[] = [];
    const passes = assemblePasses(planPostChain(q), q, fakeFactories(true), (m) => warnings.push(m));
    expect(passes.map((p) => p.name)).toEqual(['render', 'ssao', 'bloom+toneMapping', 'smaa', 'vignette+chromaticAberration']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('SSAO');
  });
});

describe('REQ-MAT-02 rail screen thickness (the inflate maths the vertex shader uses)', () => {
  it('one pixel at depth d for a 70 deg lens at 1080p is about 4.5 cm at 35 m, and the inflate keeps a 3 cm bar at RMAT_RAIL_MIN_PX', () => {
    const p11 = 1 / Math.tan((TUNING.CAM_FOV_DEG / 2) * (Math.PI / 180));
    expect(pixelWorldSize(35, p11, 1080)).toBeCloseTo(0.0454, 3);
    const minPx = TUNING.RMAT_RAIL_MIN_PX;
    expect(minPx).toBeGreaterThanOrEqual(2.5);
    // Close up the bar is already wider than the minimum: no growth.
    expect(railInflate(0.03, 1, p11, 1080, minPx)).toBe(0);
    // At 35 m and 70 m the drawn radius becomes exactly minPx / 2 pixels.
    for (const d of [25, 35, 70]) {
      const grow = railInflate(0.03, d, p11, 1080, minPx);
      expect(grow).toBeGreaterThan(0);
      expect(((0.03 + grow) * 2) / pixelWorldSize(d, p11, 1080)).toBeCloseTo(minPx, 6);
    }
    // At 720p a pixel is bigger, so the growth is bigger.
    expect(railInflate(0.03, 35, p11, 720, minPx)).toBeGreaterThan(railInflate(0.03, 35, p11, 1080, minPx));
    // minPx 0 disables the inflate.
    expect(railInflate(0.03, 70, p11, 1080, 0)).toBe(0);
  });

  it('the shared viewport uniform follows setViewportSize (what renderer.resize publishes)', () => {
    setViewportSize(1280, 720);
    expect(VIEWPORT.heightPx).toBe(720);
    expect(VIEWPORT_HEIGHT_UNIFORM.value).toBe(720);
    setViewportSize(1920.4, 1079.6);
    expect(VIEWPORT.widthPx).toBe(1920);
    expect(VIEWPORT_HEIGHT_UNIFORM.value).toBe(1080);
  });
});

describe('REQ-REN-04 selective bloom layer and the display grade', () => {
  it('markBloom puts an object and its children on BLOOM_LAYER and keeps layer 0; unmarkBloom removes it', () => {
    const group = new Group();
    const child = new Mesh();
    group.add(child);
    expect(isBloomMarked(child)).toBe(false);
    markBloom(group);
    expect(isBloomMarked(group)).toBe(true);
    expect(isBloomMarked(child)).toBe(true);
    expect(child.layers.test(new Layers())).toBe(true); // still on layer 0
    unmarkBloom(group);
    expect(isBloomMarked(child)).toBe(false);
    expect(BLOOM_LAYER).toBeGreaterThanOrEqual(2);
    expect(BLOOM_LAYER).toBeLessThanOrEqual(31);
  });

  it('LevelView marks neon parts, neon signs and pickups for bloom; plain sign boards and rails are not marked', () => {
    const built = miniPark('streetAfternoon');
    const registry = createMaterialRegistry();
    const view = createLevelView({ built, materials: registry, createNpc: () => notImplemented('x') });
    const meshes = view.group.children.filter((c): c is Mesh => c instanceof Mesh);
    const neonPart = meshes.find((m) => m.name.startsWith('neon|'));
    const rail = meshes.find((m) => m.name.startsWith('rail:rail'));
    const neonSign = meshes.find((m) => m.name === 'sign:MP-SIGN');
    const boardSign = meshes.find((m) => m.name === 'sign:MP-SIGN2');
    expect(neonPart && isBloomMarked(neonPart)).toBe(true);
    expect(neonSign && isBloomMarked(neonSign)).toBe(true);
    expect(boardSign && isBloomMarked(boardSign)).toBe(false);
    expect(rail && isBloomMarked(rail)).toBe(false);
    const pickups = view.group.children.filter((c) => c.name === '' && !(c instanceof Mesh)); // 5 pickups + the NPC placeholder
    expect(view.pickupCount).toBe(5);
    let marked = 0;
    let casting = 0;
    for (const p of pickups) {
      let markedHere = 0;
      p.traverse((o) => {
        if (isBloomMarked(o) && o instanceof Mesh) markedHere += 1;
      });
      if (markedHere === 0) continue; // the NPC placeholder
      marked += markedHere;
      p.traverse((o) => {
        if (o instanceof Mesh && o.castShadow) casting += 1;
      });
    }
    expect(marked).toBeGreaterThanOrEqual(5);
    expect(casting).toBe(0); // pickups cast no letter-shaped shadows
    view.dispose();
    registry.dispose();
  });

  it('grade tunables exist in range and High shares half-res AO / MEDIUM SMAA with Med; Ultra gets full res and HIGH', () => {
    expect(TUNING.RPOST_SATURATION).toBeGreaterThan(0);
    expect(TUNING.RPOST_SATURATION).toBeLessThanOrEqual(0.5);
    expect(TUNING.RPOST_CONTRAST).toBeGreaterThan(0);
    expect(TUNING.RPOST_CONTRAST).toBeLessThanOrEqual(0.3);
    expect(aoSettingsFor('med')).toEqual({ halfRes: true, mode: 'Low' });
    expect(aoSettingsFor('high')).toEqual({ halfRes: true, mode: 'Medium' });
    expect(aoSettingsFor('ultra')).toEqual({ halfRes: false, mode: 'High' });
    expect(smaaPresetFor('high')).not.toBe(smaaPresetFor('ultra'));
  });
});

describe('REQ-REN-02 colour split and fog', () => {
  it('Street: warm sun against a cool hemisphere sky; Woodshed: warm key and fill against a cool skylight', () => {
    const warm = (hex: string): boolean => new Color(hex).r > new Color(hex).b;
    expect(warm(ENV.streetAfternoon.sunColor)).toBe(true);
    expect(warm(ENV.streetAfternoon.skyColor)).toBe(false);
    expect(warm(ENV.woodshedInterior.sunColor)).toBe(true);
    expect(warm(ENV.woodshedInterior.fill?.color ?? '#000000')).toBe(true);
    expect(warm(ENV.woodshedInterior.skyColor)).toBe(false);
    expect(ENV.woodshedInterior.hemiIntensity()).toBe(TUNING.RLIT_WOODSHED_SKY_INTENSITY);
    expect(TUNING.RLIT_SUN_INTENSITY).toBeGreaterThan(TUNING.RLIT_HEMI_INTENSITY * 20);
  });

  it('environmentFog: a default colour before any bake (node), the given horizon when passed, distances per preset', () => {
    expect(bakedHorizonColor('streetAfternoon')).toBeNull();
    const f = environmentFog('streetAfternoon');
    // The park (120 m) stays clear of haze; the skyline 110 to 240 m out fades into the horizon.
    expect(f.near).toBe(70); // graphics overhaul 2026-09-23: haze starts nearer (110 -> 70)
    expect(f.far).toBe(520);
    const h = new Color(0.4, 0.5, 0.6);
    const g = environmentFog('streetAfternoon', h);
    expect(g.color.getHex()).toBe(h.getHex());
    expect(g.color).not.toBe(h);
    expect(environmentFog('woodshedInterior').far).toBeLessThan(f.far);
  });
});

describe('REQ-REN-03 following shadow frustum', () => {
  it('sunDirection: elevation and azimuth clockwise from north (north = -z, east = +x)', () => {
    const north = sunDirection(0, 0);
    expect(north.z).toBeCloseTo(-1, 5);
    const east = sunDirection(0, 90);
    expect(east.x).toBeCloseTo(1, 5);
    const up = sunDirection(90, 123);
    expect(up.y).toBeCloseTo(1, 5);
    expect(sunDirection(18, 250).y).toBeCloseTo(Math.sin((18 * Math.PI) / 180), 5);
  });

  it('the frustum centre tracks the skater within one texel and moves in whole texels', () => {
    const q = qualitySettings('high');
    const lighting = createLighting('streetAfternoon', q);
    const sun = lighting.sun;
    expect(sun).not.toBeNull();
    if (!sun) return;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    const texel = TUNING.SHADOW_BOX_M / 2048;
    const cam = sun.shadow.camera;
    expect(cam.right - cam.left).toBeCloseTo(TUNING.SHADOW_BOX_M, 6);
    expect(cam.top - cam.bottom).toBeCloseTo(TUNING.SHADOW_BOX_M, 6);

    lighting.update({ x: 10, y: 0.5, z: 30 });
    const t1 = sun.target.position.clone();
    // The target is within one texel (light-space) of the focus: the world offset is bounded by texel x sqrt(2).
    expect(t1.distanceTo(new Vector3(10, 0.5, 30))).toBeLessThan(texel * 1.5);
    // The light sits along the sun direction from the target.
    const dir = sun.position.clone().sub(t1).normalize();
    expect(dir.dot(lighting.sunDir)).toBeCloseTo(1, 5);

    lighting.update({ x: 25, y: 0.5, z: 12 });
    const t2 = sun.target.position.clone();
    expect(t2.distanceTo(new Vector3(25, 0.5, 12))).toBeLessThan(texel * 1.5);

    // The target sits on the shadow texel grid in light space (that is what stops shimmer): a
    // sub-texel nudge either leaves it alone or moves it by whole texels.
    const worldToLight = lightToWorld(lighting.sunDir).invert();
    const onGrid = (p: Vector3): void => {
      const l = p.clone().applyMatrix4(worldToLight);
      expect(Math.abs(l.x / texel - Math.round(l.x / texel))).toBeLessThan(1e-6);
      expect(Math.abs(l.y / texel - Math.round(l.y / texel))).toBeLessThan(1e-6);
    };
    onGrid(t2);
    lighting.update({ x: 25 + texel * 0.2, y: 0.5, z: 12 + texel * 0.2 });
    onGrid(sun.target.position);
    const moved = sun.target.position.clone().sub(t2).applyMatrix4(worldToLight);
    expect(Math.abs(moved.x / texel - Math.round(moved.x / texel))).toBeLessThan(1e-6);
    expect(Math.abs(moved.y / texel - Math.round(moved.y / texel))).toBeLessThan(1e-6);
    lighting.dispose();
  });

  it('snapShadowFocus: the snapped point is on the light-space texel grid and near the focus', () => {
    const dir = sunDirection(18, 250);
    const texel = 30 / 2048;
    const worldToLight = lightToWorld(dir).invert();
    for (const f of [new Vector3(1, 0, 1), new Vector3(1.0001, 0, 1.0001), new Vector3(57.3, 2.2, -8.1)]) {
      const r = snapShadowFocus(f, dir, 30, 2048, 40);
      const l = r.target.clone().applyMatrix4(worldToLight);
      expect(Math.abs(l.x / texel - Math.round(l.x / texel))).toBeLessThan(1e-6);
      expect(Math.abs(l.y / texel - Math.round(l.y / texel))).toBeLessThan(1e-6);
      expect(r.target.distanceTo(f)).toBeLessThan(texel);
      expect(r.position.distanceTo(r.target)).toBeCloseTo(40, 6);
    }
  });

  it('setQuality changes the shadow map size; every environment has a sun, hemisphere and (indoors) a warm fill', () => {
    const l = createLighting('woodshedInterior', qualitySettings('low'));
    expect(l.sun?.shadow.mapSize.x).toBe(1024);
    l.setQuality(qualitySettings('ultra'));
    expect(l.sun?.shadow.mapSize.x).toBe(4096);
    const names = l.group.children.map((c) => c.name);
    expect(names).toContain('sun');
    expect(names).toContain('hemisphere');
    expect(names).toContain('warmFill');
    const street = createLighting('streetAfternoon', qualitySettings('med'));
    expect(street.group.children.map((c) => c.name)).not.toContain('warmFill');
    expect(createLighting('testGrid', qualitySettings('med')).sun).not.toBeNull();
  });

  it('every light is on every layer, so the bloom mask pass (camera on BLOOM_LAYER only) sees the same lights as the main pass', () => {
    const bloomOnly = new Layers();
    bloomOnly.set(BLOOM_LAYER);
    const main = new Layers();
    for (const env of ['streetAfternoon', 'woodshedInterior', 'testGrid'] as const) {
      const l = createLighting(env, qualitySettings('high'));
      const lights = l.group.children.filter((c) => (c as { isLight?: boolean }).isLight === true);
      expect(lights.length).toBeGreaterThanOrEqual(2);
      for (const light of lights) {
        expect(light.layers.test(bloomOnly), `${env} ${light.name}`).toBe(true);
        expect(light.layers.test(main), `${env} ${light.name}`).toBe(true);
      }
      l.dispose();
    }
  });
});

describe('Windows hardware GL shader warnings (THREE.WebGLProgram on ANGLE D3D11)', () => {
  const dist = readFileSync(resolve(__dirname, '../node_modules/n8ao/dist/N8AO.js'), 'utf8');
  const loopBody = (src: string): string => {
    const start = src.indexOf('for(int i = 0; i < NUM_SAMPLES; i++) {');
    expect(start).toBeGreaterThan(0);
    return src.slice(start, src.indexOf('occlusion += occSample', start));
  };

  it('the N8AO denoise loop fetches with an explicit LOD after the patch (X3595: no implicit derivatives in the loop)', () => {
    // The vendored shader still has the implicit fetches, so the patch has something to do...
    expect(loopBody(dist)).toMatch(/texture2D\(/);
    // ...and after it the loop has none left.
    const patched = patchDenoiseShader(dist);
    expect(loopBody(patched)).not.toMatch(/texture2D\(/);
    expect(loopBody(patched)).toContain('textureLod(tDiffuse, uv + offset, 0.0)');
    expect(loopBody(patched)).toContain('textureLod(sceneDepth, uv + offset, 0.0)');
    expect(patchDenoiseShader(patched)).toBe(patched);
  });

  it('patchN8aoPass patches each denoise material once; transparency is switched off and stays off', () => {
    const shader = `void main(){ for(int i = 0; i < NUM_SAMPLES; i++) { vec4 d = texture2D(tDiffuse, uv + offset); float z = texture2D(sceneDepth, uv + offset).x; } }`;
    const std = { fragmentShader: shader, needsUpdate: false, userData: {} as Record<string, unknown> };
    const pass: PatchableN8ao = { configuration: { transparencyAware: true }, autoDetectTransparency: true, standardDenoiseMaterial: std, neuralDenoiseMaterial: null };
    expect(patchN8aoPass(pass)).toBe(1);
    expect(std.needsUpdate).toBe(true);
    expect(std.fragmentShader).not.toContain('texture2D(');
    std.needsUpdate = false;
    expect(patchN8aoPass(pass)).toBe(0);
    expect(std.needsUpdate).toBe(false);
    // A rebuilt material (N8AO does that on quality changes) gets patched again.
    pass.standardDenoiseMaterial = { fragmentShader: shader, needsUpdate: false, userData: {} };
    expect(patchN8aoPass(pass)).toBe(1);
    disableN8aoTransparency(pass);
    expect(pass.configuration.transparencyAware).toBe(false);
    expect(pass.autoDetectTransparency).toBe(false);
  });

  it('the PMREM bake runs with three shader diagnostics off (X4122 in the GGX shader of three) and restores them, even on a throw', () => {
    const fake = { renderer: { debug: { checkShaderErrors: true } } } as unknown as Pick<GameRenderer, 'renderer'>;
    let during: boolean | null = null;
    expect(quietPmremBake(fake, () => {
      during = fake.renderer.debug.checkShaderErrors;
      return 7;
    })).toBe(7);
    expect(during).toBe(false);
    expect(fake.renderer.debug.checkShaderErrors).toBe(true);
    expect(() => quietPmremBake(fake, () => {
      throw new Error('bake failed');
    })).toThrow('bake failed');
    expect(fake.renderer.debug.checkShaderErrors).toBe(true);
  });
});

describe('LevelView', () => {
  const built = miniPark('streetAfternoon');
  const registry = createMaterialRegistry();
  const npcCalls: string[] = [];
  const view = createLevelView({
    built,
    materials: registry,
    createNpc: (def) => {
      npcCalls.push(def.id);
      return notImplemented('render/npc: createNpcFigure');
    },
  });

  it('merges static parts by material and shadow flags, skips the boundary walls', () => {
    const partMaterials = new Set(built.parts.filter((p) => p.material !== 'boundary').map((p) => `${p.role === 'rail' ? 'rail:rail' : p.role === 'coping' ? 'rail:coping' : p.material}|${p.castShadow ? 1 : 0}|${p.receiveShadow ? 1 : 0}`));
    expect(view.staticMeshCount).toBe(partMaterials.size);
    expect(view.staticMeshCount).toBeLessThan(built.parts.length);
    const meshes = view.group.children.filter((c): c is Mesh => c instanceof Mesh);
    expect(meshes.some((m) => m.name.startsWith('boundary'))).toBe(false);
    // Every merged mesh has a colour attribute (vertexColors is on in the registry).
    for (const m of meshes) if (!m.name.startsWith('decal') && !m.name.startsWith('sign') && !m.name.startsWith('backdrop')) expect(m.geometry.hasAttribute('color')).toBe(true);
  });

  it('rails and copings use the rim materials, boundary is never requested', () => {
    const meshes = view.group.children.filter((c): c is Mesh => c instanceof Mesh);
    const rail = meshes.find((m) => m.name.startsWith('rail:rail'));
    const coping = meshes.find((m) => m.name.startsWith('rail:coping'));
    expect(rail?.material).toBe(registry.rail('rail'));
    expect(coping?.material).toBe(registry.rail('coping'));
    expect(registry.built).not.toContain('boundary');
  });

  it('decals, pickups, signs and NPCs are in the group; pickups hide once collected', () => {
    expect(view.decalCount).toBe(built.decals.length);
    expect(view.pickupCount).toBe(5);
    expect(npcCalls).toEqual(['sam']);
    const names = view.group.children.map((c) => c.name);
    expect(names.filter((n) => n.startsWith('decal:'))).toHaveLength(built.decals.length);
    expect(names).toContain('sign:MP-SIGN');
    const rest = restSnapshot('testBox');
    view.update(rest, 1 / 60);
    const pickups = view.group.children.filter((c) => c.name === '' && !(c instanceof Mesh));
    const visibleBefore = pickups.filter((p) => p.visible).length;
    const collected = { ...rest, run: { ...rest.run, letters: { C: true, O: false, D: true, E: false }, macguffinCollected: true } };
    view.update(collected, 1 / 60);
    const visibleAfter = pickups.filter((p) => p.visible).length;
    expect(visibleBefore - visibleAfter).toBe(3);
  });

  it('decals draw in a single pass (a transparent DoubleSide quad is otherwise drawn twice a frame)', () => {
    const decals = view.group.children.filter((c): c is Mesh => c instanceof Mesh && c.name.startsWith('decal:'));
    expect(decals.length).toBe(built.decals.length);
    for (const d of decals) {
      const m = d.material as MeshStandardMaterial;
      expect(m.side === FrontSide || m.forceSinglePass, d.name).toBe(true);
    }
  });

  it('sign pulse depth and plain-sign emissive come from TUNING live', () => {
    const rest = restSnapshot('testBox');
    const saved = { depth: TUNING.RLV_SIGN_PULSE_DEPTH, plain: TUNING.RLV_SIGN_EMISSIVE };
    const neon = view.group.getObjectByName('sign:MP-SIGN') as Mesh;
    const plain = view.group.getObjectByName('sign:MP-SIGN2') as Mesh;
    try {
      (TUNING as { RLV_SIGN_PULSE_DEPTH: number }).RLV_SIGN_PULSE_DEPTH = 0;
      (TUNING as { RLV_SIGN_EMISSIVE: number }).RLV_SIGN_EMISSIVE = 2.5;
      for (let i = 0; i < 5; i++) {
        view.update(rest, 0.37);
        expect((neon.material as MeshStandardMaterial).emissiveIntensity).toBeCloseTo(TUNING.RMAT_NEON_EMISSIVE, 9);
        expect((plain.material as MeshStandardMaterial).emissiveIntensity).toBeCloseTo(2.5, 9);
      }
    } finally {
      (TUNING as { RLV_SIGN_PULSE_DEPTH: number }).RLV_SIGN_PULSE_DEPTH = saved.depth;
      (TUNING as { RLV_SIGN_EMISSIVE: number }).RLV_SIGN_EMISSIVE = saved.plain;
    }
  });

  it('dispose leaves the registry materials alone', () => {
    view.dispose();
    expect(view.group.children).toHaveLength(0);
    expect(registry.rail('rail')).toBeDefined();
    registry.dispose();
  });
});

describe('LevelView backdrop (DESIGN G.2 room, Street skyline)', () => {
  const meshesOf = (g: Group): Mesh[] => g.children.filter((c): c is Mesh => c instanceof Mesh);
  const box = (m: Mesh): { min: Vector3; max: Vector3 } => {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox;
    if (!b) throw new Error('no bounds');
    return { min: b.min.clone(), max: b.max.clone() };
  };

  it('Woodshed: visible walls close the boundary rectangle up to a ceiling above the trusses, with glowing windows and lamps', () => {
    const built = miniPark('woodshedInterior');
    const registry = createMaterialRegistry();
    const view = createLevelView({ built, materials: registry, createNpc: () => notImplemented('npc') });
    const byName = new Map(meshesOf(view.group).map((m) => [m.name, m]));
    const walls = byName.get('backdrop:walls');
    const ceiling = byName.get('backdrop:ceiling');
    const windows = byName.get('backdrop:windows');
    const lamps = byName.get('backdrop:lamps');
    expect(walls && ceiling && windows && lamps).toBeTruthy();
    if (!walls || !ceiling || !windows || !lamps) return;
    expect(view.backdropMeshCount).toBe(4);
    const wb = box(walls);
    expect(wb.min.x).toBeCloseTo(0, 6);
    expect(wb.min.z).toBeCloseTo(0, 6);
    expect(wb.max.x).toBeCloseTo(built.def.size.x, 6);
    expect(wb.max.z).toBeCloseTo(built.def.size.z, 6);
    expect(wb.max.y).toBeGreaterThanOrEqual(12);
    expect(wb.min.y).toBeLessThan(-2.4); // below the deepest bowl floor
    // Every wall face points into the room.
    const n = walls.geometry.getAttribute('normal');
    const pos = walls.geometry.getAttribute('position');
    const cx = built.def.size.x / 2;
    const cz = built.def.size.z / 2;
    for (let i = 0; i < n.count; i++) expect(n.getX(i) * (cx - pos.getX(i)) + n.getZ(i) * (cz - pos.getZ(i))).toBeGreaterThan(0);
    // The ceiling covers the room above the trusses (y 12) and faces down.
    const cb = box(ceiling);
    expect(cb.min.y).toBeGreaterThanOrEqual(12);
    expect(cb.max.x - cb.min.x).toBeCloseTo(built.def.size.x, 6);
    expect(ceiling.geometry.getAttribute('normal').getY(0)).toBe(-1);
    // Windows and lamps glow (bloom layer); nothing in the backdrop casts a shadow or blocks the key light.
    expect(isBloomMarked(windows)).toBe(true);
    expect(isBloomMarked(lamps)).toBe(true);
    expect(isBloomMarked(walls)).toBe(false);
    for (const m of [walls, ceiling, windows, lamps]) expect(m.castShadow).toBe(false);
    expect(registry.built).not.toContain('boundary');
    view.dispose();
    registry.dispose();
  });

  it('Street: a ground apron and skyline blocks all stand outside the park, inside the camera far plane', () => {
    const built = miniPark('streetAfternoon');
    const registry = createMaterialRegistry();
    const view = createLevelView({ built, materials: registry, createNpc: () => notImplemented('npc') });
    const byName = new Map(meshesOf(view.group).map((m) => [m.name, m]));
    const sky = byName.get('backdrop:skyline');
    expect(byName.get('backdrop:apron')).toBeTruthy();
    expect(byName.has('backdrop:walls')).toBe(false);
    expect(sky).toBeTruthy();
    if (!sky) return;
    expect(sky.receiveShadow).toBe(false);
    view.dispose();
    registry.dispose();
  });

  it('streetSkyline (Market Street, 120 x 120 m): every block is outside the park and inside the 500 m far plane from any point of the park', () => {
    const X = 120;
    const Z = 120;
    const { blocks, apron, blockCount } = streetSkyline(X, Z);
    expect(blockCount).toBeGreaterThanOrEqual(40);
    const pos = blocks.getAttribute('position');
    const halfDiag = Math.hypot(X, Z) / 2;
    let tallest = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Outside the park and its 12 m boundary walls; the near city (graphics overhaul) starts 16 m out.
      expect(x < -14 || x > X + 14 || z < -14 || z > Z + 14).toBe(true);
      expect(Math.hypot(x - X / 2, z - Z / 2) + halfDiag).toBeLessThan(500);
      tallest = Math.max(tallest, pos.getY(i));
    }
    expect(tallest).toBeGreaterThan(40);
    // The apron never covers the park floor (it would z-fight the ground at y 0).
    const ap = apron.getAttribute('position');
    for (let t = 0; t < (apron.index?.count ?? 0); t += 3) {
      const ids = [0, 1, 2].map((k) => apron.index?.getX(t + k) ?? 0);
      const mx = ids.reduce((a, id) => a + ap.getX(id), 0) / 3;
      const mz = ids.reduce((a, id) => a + ap.getZ(id), 0) / 3;
      expect(mx > 0 && mx < X && mz > 0 && mz < Z).toBe(false);
    }
  });
});

describe('REQ-MNU-01 menu flythrough: the authored Market Street tour', () => {
  const built = buildLevel(MARKET_STREET);
  const path = flythroughPath(built);
  const tour = FLY_TOURS.marketStreet ?? [];

  it('Market Street flies an authored tour at 4 to 10 m over the hero features', () => {
    expect(path.authored).toBe(true);
    const names = tour.map((k) => k.name).join(' | ');
    for (const hero of ['stairs', 'fountain', 'scaffold', 'laptop', 'billboard']) expect(names).toContain(hero);
    const p = new Vector3();
    let sum = 0;
    for (let i = 0; i < FLY_SAMPLES; i++) {
      path.camera.getPoint(i / FLY_SAMPLES, p);
      expect(p.y).toBeLessThan(12);
      sum += p.y;
    }
    const mean = sum / FLY_SAMPLES;
    expect(mean).toBeGreaterThanOrEqual(4);
    expect(mean).toBeLessThanOrEqual(8);
  });

  it('every sample of the spline clears the surfaces and props under it (no skimming ledge tops or lamp poles)', () => {
    const p = new Vector3();
    const obs: { x0: number; z0: number; x1: number; z1: number; top: number }[] = [];
    for (const s of Object.values(built.surfaces)) if (s.kind !== 'boundary') obs.push({ x0: s.bounds.min.x, z0: s.bounds.min.z, x1: s.bounds.max.x, z1: s.bounds.max.z, top: s.bounds.max.y });
    for (const pr of built.def.primitives) {
      if (pr.kind !== 'prop') continue;
      const yaw = ((pr.yawDeg ?? 0) * Math.PI) / 180;
      const hx = (Math.abs(Math.cos(yaw)) * pr.size.x + Math.abs(Math.sin(yaw)) * pr.size.z) / 2;
      const hz = (Math.abs(Math.sin(yaw)) * pr.size.x + Math.abs(Math.cos(yaw)) * pr.size.z) / 2;
      obs.push({ x0: pr.at.x - hx, z0: pr.at.z - hz, x1: pr.at.x + hx, z1: pr.at.z + hz, top: pr.at.y + pr.size.y });
    }
    for (let i = 0; i < 1000; i++) {
      path.camera.getPoint(i / 1000, p);
      expect(p.y - floorUnder(obs, p.x, p.z), `sample ${i} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(CLEARANCE_M - 0.3);
      expect(p.x).toBeGreaterThan(built.bounds.min.x);
      expect(p.x).toBeLessThan(built.bounds.max.x);
      expect(p.z).toBeGreaterThan(built.bounds.min.z);
      expect(p.z).toBeLessThan(built.bounds.max.z);
    }
  });

  it('a key over something tall is lifted until the spline clears it (the safety net for future level edits)', () => {
    const key = tour[2];
    expect(key).toBeDefined();
    if (!key) return;
    const [kx, , kz] = key.pos;
    const tower = { id: 'TEST-TOWER', kind: 'box' as const, bounds: { min: { x: kx - 2, y: 0, z: kz - 2 }, max: { x: kx + 2, y: 9, z: kz + 2 } }, footprint: { x0: kx - 2, z0: kz - 2, x1: kx + 2, z1: kz + 2 } };
    const lifted = flythroughPath({ ...built, surfaces: { ...built.surfaces, [tower.id]: tower } });
    const p = new Vector3();
    for (let i = 0; i < 1000; i++) {
      lifted.camera.getPoint(i / 1000, p);
      if (Math.abs(p.x - kx) < 4 && Math.abs(p.z - kz) < 4) expect(p.y, `sample ${i}`).toBeGreaterThanOrEqual(9 + CLEARANCE_M - 0.3);
    }
  });

  it('each key frames its feature in the right third of a 16:9 frame (the menu panel covers the left)', () => {
    const fly = createMenuFlythrough(built, 16 / 9);
    const step = TUNING.MENU_FLYTHROUGH_S / tour.length;
    for (let k = 0; k < tour.length; k++) {
      const key = tour[k];
      if (!key) continue;
      fly.camera.updateMatrixWorld();
      const ndc = new Vector3(key.look[0], key.look[1], key.look[2]).project(fly.camera);
      expect(ndc.z, key.name).toBeLessThan(1); // in front of the camera
      expect(ndc.x, key.name).toBeGreaterThan(0.25);
      expect(ndc.x, key.name).toBeLessThan(0.8);
      expect(Math.abs(ndc.y), key.name).toBeLessThan(0.9);
      fly.update(step);
    }
    fly.dispose();
  });
});

describe('REQ-MNU-01 menu flythrough', () => {
  const built = miniPark('streetAfternoon');

  it('waypoints stay inside the park bounds and above every surface under them', () => {
    const pts = flythroughWaypoints(built);
    expect(pts.length).toBeGreaterThanOrEqual(8);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(built.bounds.min.x);
      expect(p.x).toBeLessThan(built.bounds.max.x);
      expect(p.z).toBeGreaterThan(built.bounds.min.z);
      expect(p.z).toBeLessThan(built.bounds.max.z);
      expect(p.y).toBeGreaterThan(2);
    }
  });

  it('loops once per MENU_FLYTHROUGH_S and moves the camera', () => {
    const fly = createMenuFlythrough(built, 16 / 9);
    const start = fly.camera.position.clone();
    fly.update(TUNING.MENU_FLYTHROUGH_S / 4);
    expect(fly.camera.position.distanceTo(start)).toBeGreaterThan(1);
    fly.update((TUNING.MENU_FLYTHROUGH_S * 3) / 4);
    expect(fly.camera.position.distanceTo(start)).toBeLessThan(1e-3);
    fly.setAspect(2);
    expect(fly.camera.aspect).toBe(2);
    fly.dispose();
  });
});
