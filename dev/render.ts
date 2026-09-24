/**
 * dev/render.ts (render track harness, port 5307): the renderer / post / quality / lighting / sky /
 * materials test bench. Everything on screen goes through the real GameRenderer, PostChain,
 * Lighting, EnvironmentHandle and MaterialRegistry.
 *
 *   ?scene=park       (default) the mini park fixture through LevelView (or a real built level with
 *                     ?level=marketStreet|woodshed|testBox once buildLevel lands)
 *   ?scene=showcase   material swatches, rail, coping quarter pipe, signs, glass, scaffold
 *   ?scene=fly        the park through the main menu flythrough camera (REQ-MNU-01)
 *   ?env=streetAfternoon|woodshedInterior|testGrid   environment preset (default from the level)
 *   ?quality=low|med|high|ultra|auto                 preset (default high; auto runs the 2 s probe)
 *   ?cam=x,y,z,tx,ty,tz                              free camera pose for deterministic screenshots
 *   ?glow=1                                          chromatic aberration on (special glow)
 *   ?ao=only|split|ssao                              N8AO debug views, or the SSAO fallback
 *   ?tune=KEY=value,KEY=value                        override any TUNING key before the scene builds
 *   ?post=0                                          bypass the post chain (raw renderer output)
 *   WASD / QE / drag to fly. window.__shotReady after 10 frames.
 */

import { Scene, Vector3 } from 'three';
import { mockSnapshotAt } from '../src/core/mock';
import { TUNING } from '../src/core/tuning';
import type { LevelId, QualityOption, QualityPresetId } from '../src/core/types';
import { buildLevel } from '../src/levels/builder';
import { loadLevelDef, LEVEL_IDS } from '../src/levels/registry';
import type { BuiltLevel, EnvironmentPreset } from '../src/levels/types';
import { createLevelView } from '../src/render/levelView';
import { createLighting } from '../src/render/lighting';
import { createMaterialRegistry } from '../src/render/materials';
import { createMenuFlythrough } from '../src/render/menuFlythrough';
import { createNpcFigure } from '../src/render/npc';
import { createPostChain } from '../src/render/post';
import { autoQuality, qualitySettings } from '../src/render/quality';
import { createGameRenderer } from '../src/render/renderer';
import { createEnvironment, environmentFog } from '../src/render/sky';
import { textureCacheSize } from '../src/render/textures';
import { miniPark } from '../tests/fixtures/render/miniPark';
import { mountPanel, noteFallback, shotReadyAt, startFrames, tryBuild } from './shared/harness';
import { createFreeCamera } from './render/freeCamera';
import { buildShowcase } from './render/showcase';

const params = new URLSearchParams(window.location.search);
const sceneParam = params.get('scene');
const sceneKind: 'showcase' | 'park' | 'fly' = sceneParam === 'showcase' ? 'showcase' : sceneParam === 'fly' ? 'fly' : 'park';
const envParam = params.get('env');
const ENVS: readonly EnvironmentPreset[] = ['streetAfternoon', 'woodshedInterior', 'testGrid'];
const qualityParam = (params.get('quality') ?? 'high') as QualityOption;
const QUALITIES: readonly string[] = ['low', 'med', 'high', 'ultra', 'auto'];
const qualityOption: QualityOption = QUALITIES.includes(qualityParam) ? qualityParam : 'high';
for (const kv of (params.get('tune') ?? '').split(',')) {
  const [k, v] = kv.split('=');
  if (k && v !== undefined && k in TUNING && Number.isFinite(Number(v))) (TUNING as unknown as Record<string, number>)[k] = Number(v);
}

const panel = mountPanel('Render harness', [
  'Render track, port 5307. ?scene=park|showcase ?env=streetAfternoon|woodshedInterior|testGrid ?quality=low|med|high|ultra|auto ?level=<id> ?cam=x,y,z,tx,ty,tz ?glow=1',
  'WASD / QE fly, drag to look, Shift = fast.',
]);

async function loadBuilt(): Promise<{ built: BuiltLevel; source: string }> {
  const requested = params.get('level');
  if (requested && (LEVEL_IDS as readonly string[]).includes(requested)) {
    const def = await loadLevelDef(requested as LevelId);
    const built = tryBuild(() => buildLevel(def));
    if (built) return { built, source: `buildLevel(${requested})` };
    noteFallback(panel, 'buildLevel');
  }
  const env = ENVS.includes(envParam as EnvironmentPreset) ? (envParam as EnvironmentPreset) : 'streetAfternoon';
  return { built: miniPark(env), source: 'tests/fixtures/render/miniPark' };
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const canvas = document.createElement('canvas');
  canvas.className = 'harness-canvas';
  document.body.prepend(canvas);

  const initial = qualitySettings(qualityOption === 'auto' ? 'med' : (qualityOption as QualityPresetId));
  const renderer = createGameRenderer(canvas, initial);
  const scene = new Scene();
  const registry = createMaterialRegistry();

  const { built, source } = await loadBuilt();
  const environment: EnvironmentPreset = ENVS.includes(envParam as EnvironmentPreset) ? (envParam as EnvironmentPreset) : built.def.environment;

  const env = createEnvironment(renderer, environment);
  scene.background = env.background;
  scene.environment = env.environment;
  scene.fog = environmentFog(environment);
  renderer.renderer.info.autoReset = false;
  const lighting = createLighting(environment, initial);
  scene.add(lighting.group);

  let showcaseSigns: import('./render/showcase').Showcase | null = null;
  let levelView: ReturnType<typeof createLevelView> | null = null;
  if (sceneKind === 'showcase') {
    showcaseSigns = buildShowcase(registry);
    scene.add(showcaseSigns.group);
  } else {
    levelView = createLevelView({ built, materials: registry, createNpc: createNpcFigure });
    scene.add(levelView.group);
  }
  const buildMs = performance.now() - t0;

  const cam = createFreeCamera(canvas, TUNING.CAM_FOV_DEG, window.innerWidth / window.innerHeight);
  const camParam = params.get('cam');
  if (camParam) {
    const v = camParam.split(',').map(Number);
    if (v.length === 6 && v.every((n) => Number.isFinite(n))) cam.lookFrom(new Vector3(v[0], v[1], v[2]), new Vector3(v[3], v[4], v[5]));
  } else if (sceneKind === 'showcase') {
    cam.lookFrom(new Vector3(20, 9, 46), new Vector3(20, 1.5, 18));
  } else {
    const s = built.spawn.pos;
    cam.lookFrom(new Vector3(s.x + 4, 5, s.z + 9), new Vector3(s.x, 1, s.z - 14));
  }

  const fly = sceneKind === 'fly' ? createMenuFlythrough(built, window.innerWidth / window.innerHeight) : null;
  if (fly) fly.update(Number(params.get('t') ?? '3'));
  const activeCamera = fly ? fly.camera : cam.camera;
  const post = createPostChain(renderer, scene, activeCamera, { forceSsao: params.get('ao') === 'ssao' });
  post.setGlowing(params.get('glow') === '1');
  const bypassPost = params.get('post') === '0';
  if (params.get('ao') === 'only') post.setAoDisplay('AO');
  if (params.get('ao') === 'split') post.setAoDisplay('Split');
  (window as unknown as { __renderDebug: unknown }).__renderDebug = { renderer, scene, lighting, post, registry, camera: activeCamera };

  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.resize(w, h);
    post.setSize(w, h);
    cam.camera.aspect = w / Math.max(1, h);
    cam.camera.updateProjectionMatrix();
    fly?.setAspect(w / Math.max(1, h));
  };
  window.addEventListener('resize', resize);
  resize();

  let quality = initial;
  const applyQuality = (q: typeof quality): void => {
    quality = q;
    renderer.setQuality(q);
    lighting.setQuality(q);
    post.setQuality(q);
    resize();
  };
  window.addEventListener('keydown', (e) => {
    const map: Record<string, QualityPresetId> = { '1': 'low', '2': 'med', '3': 'high', '4': 'ultra' };
    const id = map[e.key];
    if (id) applyQuality(qualitySettings(id));
    if (e.key === 'g') post.setGlowing(true);
    if (e.key === 'h') post.setGlowing(false);
  });

  let probeNote = qualityOption === 'auto' ? 'probing...' : 'explicit';
  if (qualityOption === 'auto') {
    void autoQuality('auto', () => post.render(1 / 60), () => performance.now()).then((q) => {
      probeNote = `auto -> ${q.id}`;
      applyQuality(q);
    });
  }

  const focus = new Vector3();
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 0;
  let tick = 0;
  startFrames((dt, frame) => {
    cam.update(dt);
    if (fly && frame > 10) fly.update(dt);
    // The shadow box follows the camera's ground point in the showcase, the mock skater in the park.
    if (levelView) {
      tick += Math.round(dt * TUNING.SIM_HZ);
      const snap = mockSnapshotAt(tick);
      levelView.update(snap, dt);
      focus.set(snap.skater.pos.x, snap.skater.pos.y, snap.skater.pos.z);
    } else {
      focus.set(cam.camera.position.x, 0, cam.camera.position.z - 12);
      if (showcaseSigns) {
        const pulse = 1 + 0.12 * Math.sin(frame * 0.02 * TUNING.RLV_SIGN_PULSE_HZ * Math.PI * 2);
        const neon = showcaseSigns.signs[0];
        if (neon) neon.emissiveIntensity = TUNING.RMAT_NEON_EMISSIVE * pulse;
      }
      registry.refresh();
    }
    lighting.update(focus);
    renderer.renderer.info.reset();
    if (bypassPost) {
      renderer.renderer.toneMappingExposure = TUNING.RENDER_EXPOSURE;
      renderer.renderer.render(scene, cam.camera);
    } else {
      post.render(dt);
    }
    fpsAcc += dt;
    fpsFrames += 1;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    if (frame % 15 === 0) {
      const info = renderer.renderer.info;
      panel.setStatus([
        `scene ${sceneKind} (${source}), env ${environment}, quality ${quality.id} (${probeNote})`,
        `passes: ${post.passNames.join(' -> ')} | ao ${post.aoMode ?? 'off'}`,
        `draw calls ${info.render.calls}, triangles ${info.render.triangles}, textures ${info.memory.textures}, programs ${info.programs?.length ?? 0}`,
        `materials built ${registry.built.length}, cached textures ${textureCacheSize()}, build ${buildMs.toFixed(0)} ms, ${fps.toFixed(0)} fps`,
        levelView ? `level view: ${levelView.staticMeshCount} static meshes, ${levelView.decalCount} decals, ${levelView.pickupCount} pickups` : 'showcase',
        `camera ${activeCamera.position.x.toFixed(1)}, ${activeCamera.position.y.toFixed(1)}, ${activeCamera.position.z.toFixed(1)}${fly ? ' (flythrough)' : ''}`,
      ]);
    }
    shotReadyAt(frame);
  });
}

void main();
