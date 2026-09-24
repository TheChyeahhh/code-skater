/**
 * src/render/post.ts (render track): pmndrs postprocessing chain (REQ-REN-04):
 * N8AO (Med and above; on an init throw fall back to postprocessing SSAO with one console.warn)
 * -> bloom (BLOOM_THRESHOLD, emissive only) -> SMAA -> vignette (VIGNETTE) -> chromatic aberration
 * (CHROMATIC_ABERRATION, only while glowing). Low disables AO and bloom.
 *
 * Tone mapping happens exactly once: the scene is drawn into a HalfFloat (linear HDR) buffer, where
 * three skips renderer.toneMapping, bloom thresholds that HDR image, and a ToneMappingEffect in the
 * same pass applies AgX (ACESFilmic fallback) with renderer.toneMappingExposure. Everything after
 * (grade, SMAA, vignette, aberration) works on the display-referred image and the final pass writes sRGB.
 *
 * "Only emissive" is enforced by a SelectiveBloomEffect: its mask is a depth pass of the objects on
 * BLOOM_LAYER (src/render/lib/bloomLayer.ts), so a sunlit white wall at 2.5 linear never blooms while
 * a neon box (marked by LevelView) does. Other tracks mark their glowing meshes with markBloom().
 *
 * Grade (SPEC section 10 "saturated"): a HueSaturationEffect (RPOST_SATURATION) and a
 * SoftContrastEffect (RPOST_CONTRAST, src/render/lib/softContrast.ts) sit in the finish pass after
 * tone mapping, read live. The soft curve replaced BrightnessContrastEffect in polish round 2: that
 * one is a straight line through linear 0.5 and clipped every value under linear 0.07 to black.
 * N8AO's darkening is floored by RPOST_AO_FLOOR (src/render/lib/n8aoPatch.ts), and the aberration
 * stays out of the centre of the frame (RPOST_CA_MODULATION_OFFSET).
 * The stage list and the fallback logic live in src/render/lib/postPlan.ts (unit-tested).
 */

import { HalfFloatType, Vector2, type PerspectiveCamera, type Scene } from 'three';
import {
  ChromaticAberrationEffect, EffectComposer, EffectPass, HueSaturationEffect, NormalPass, Pass, RenderPass, SMAAEffect,
  SMAAPreset, SSAOEffect, SelectiveBloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { TUNING } from '../core/tuning';
import { BLOOM_LAYER } from './lib/bloomLayer';
import { AO_FLOOR_UNIFORM, disableN8aoTransparency, patchN8aoPass, type PatchableN8ao } from './lib/n8aoPatch';
import { SoftContrastEffect } from './lib/softContrast';
import { assemblePasses, planPostChain, type AssembledPass, type StageFactories } from './lib/postPlan';
import type { GameRenderer, PostChain, QualitySettings } from './types';

/** PostChain plus the pass names in order (harness status, tests). */
export interface GamePostChain extends PostChain {
  readonly passNames: readonly string[];
  /** "n8ao" or "ssao" while AO is on, null on Low. */
  readonly aoMode: 'n8ao' | 'ssao' | null;
  /** Debug view of the N8AO pass (harness only); no-op without N8AO. */
  setAoDisplay(mode: 'Combined' | 'AO' | 'No AO' | 'Split'): void;
  /** The live N8AO pass for the harness dev panel, null when AO is off or SSAO is in use. */
  readonly n8aoPass: N8AOPostPass | null;
}

interface LiveEffects {
  bloom: SelectiveBloomEffect | null;
  vignette: VignetteEffect | null;
  aberration: ChromaticAberrationEffect | null;
  saturation: HueSaturationEffect | null;
  contrast: SoftContrastEffect | null;
  n8ao: N8AOPostPass | null;
}

function toneMappingMode(): ToneMappingMode {
  return typeof ToneMappingMode.AGX === 'number' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC;
}

/** Vignette shape: where the falloff starts (darkness itself is the locked VIGNETTE). */
const VIGNETTE_OFFSET = 0.2;

export interface PostChainOptions {
  /** Skip N8AO and use the SSAO fallback (harness comparison only). */
  readonly forceSsao?: boolean;
}

/** N8AO settings per preset: High shares Med's half-res AO and MEDIUM SMAA; Ultra gets full res and HIGH (REQ-REN-06 budget). */
export function aoSettingsFor(id: QualitySettings['id']): { halfRes: boolean; mode: 'Low' | 'Medium' | 'High' } {
  return { halfRes: id !== 'ultra', mode: id === 'ultra' ? 'High' : id === 'high' ? 'Medium' : 'Low' };
}

export function smaaPresetFor(id: QualitySettings['id']): SMAAPreset {
  return id === 'ultra' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM;
}

/** Two quality settings that build the same pass chain. */
function sameQuality(a: QualitySettings, b: QualitySettings): boolean {
  return a.id === b.id && a.ao === b.ao && a.bloom === b.bloom && a.smaa === b.smaa && a.shadowMapSize === b.shadowMapSize && a.pixelRatioCap === b.pixelRatioCap;
}

export function createPostChain(renderer: GameRenderer, scene: Scene, camera: PerspectiveCamera, opts: PostChainOptions = {}): GamePostChain {
  const composer = new EffectComposer(renderer.renderer, { frameBufferType: HalfFloatType, multisampling: 0, stencilBuffer: false });
  let stages: AssembledPass<Pass[]>[] = [];
  let names: string[] = [];
  let aoMode: 'n8ao' | 'ssao' | null = null;
  const live: LiveEffects = { bloom: null, vignette: null, aberration: null, saturation: null, contrast: null, n8ao: null };
  let glowing = false;
  let warned = false;

  const size = (): { w: number; h: number } => {
    const v = renderer.renderer.getSize(new Vector2());
    return { w: Math.max(1, v.x), h: Math.max(1, v.y) };
  };

  const factories = (q: QualitySettings): StageFactories<Pass[]> => ({
    render: () => [new RenderPass(scene, camera)],
    n8ao: () => {
      if (opts.forceSsao) throw new Error('forceSsao');
      const { w, h } = size();
      const pass = new N8AOPostPass(scene, camera, w, h);
      pass.configuration.aoRadius = TUNING.RPOST_AO_RADIUS_M;
      pass.configuration.intensity = TUNING.RPOST_AO_INTENSITY;
      pass.configuration.distanceFalloff = TUNING.RPOST_AO_FALLOFF;
      pass.configuration.gammaCorrection = false; // not the last pass: tone mapping and sRGB happen later
      const ao = aoSettingsFor(q.id);
      pass.configuration.halfRes = ao.halfRes;
      pass.setQualityMode(ao.mode);
      // No transparency pass (two extra scene renders a frame) and explicit-LOD denoise fetches
      // (no D3D X3595 warning): src/render/lib/n8aoPatch.ts.
      disableN8aoTransparency(pass as unknown as PatchableN8ao);
      patchN8aoPass(pass as unknown as PatchableN8ao);
      live.n8ao = pass;
      return [pass];
    },
    ssao: () => {
      const normalPass = new NormalPass(scene, camera);
      const ssao = new SSAOEffect(camera, normalPass.texture, {
        worldDistanceThreshold: 20,
        worldDistanceFalloff: 5,
        worldProximityThreshold: 0.4,
        worldProximityFalloff: 0.1,
        luminanceInfluence: 0.6,
        samples: 12,
        rings: 5,
        radius: 0.08,
        intensity: TUNING.RPOST_AO_INTENSITY / 2,
      });
      return [normalPass, new EffectPass(camera, ssao)];
    },
    bloomTone: (bloom) => {
      const tone = new ToneMappingEffect({ mode: toneMappingMode() });
      if (!bloom) return [new EffectPass(camera, tone)];
      const effect = new SelectiveBloomEffect(scene, camera, {
        luminanceThreshold: TUNING.BLOOM_THRESHOLD,
        luminanceSmoothing: TUNING.RPOST_BLOOM_SMOOTHING,
        mipmapBlur: true,
        intensity: TUNING.RPOST_BLOOM_INTENSITY,
      });
      effect.selection.layer = BLOOM_LAYER;
      effect.ignoreBackground = true;
      live.bloom = effect;
      return [new EffectPass(camera, effect, tone)];
    },
    smaa: () => [new EffectPass(camera, new SMAAEffect({ preset: smaaPresetFor(q.id) }))],
    finish: () => {
      const saturation = new HueSaturationEffect({ saturation: TUNING.RPOST_SATURATION });
      const contrast = new SoftContrastEffect(TUNING.RPOST_CONTRAST);
      const vignette = new VignetteEffect({ offset: VIGNETTE_OFFSET, darkness: TUNING.VIGNETTE });
      const aberration = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: TUNING.RPOST_CA_MODULATION_OFFSET });
      live.saturation = saturation;
      live.contrast = contrast;
      live.vignette = vignette;
      live.aberration = aberration;
      return [new EffectPass(camera, saturation, contrast, vignette, aberration)];
    },
  });

  const teardown = (): void => {
    for (const s of stages) for (const p of s.pass) {
      composer.removePass(p);
      p.dispose();
    }
    stages = [];
    live.bloom = null;
    live.vignette = null;
    live.aberration = null;
    live.saturation = null;
    live.contrast = null;
    live.n8ao = null;
  };

  /** The settings the passes were last built for: setQuality with equal settings keeps them (polish round 1). */
  let builtFor: QualitySettings | null = null;
  const build = (q: QualitySettings): void => {
    teardown();
    builtFor = { ...q };
    const warn = (msg: string): void => {
      if (!warned) console.warn(msg);
      warned = true;
    };
    stages = assemblePasses(planPostChain(q), q, factories(q), warn);
    names = stages.map((s) => s.name);
    aoMode = names.includes('n8ao') ? 'n8ao' : names.includes('ssao') ? 'ssao' : null;
    for (const s of stages) for (const p of s.pass) composer.addPass(p);
  };

  build(renderer.quality);

  const applyLive = (): void => {
    renderer.renderer.toneMappingExposure = TUNING.RENDER_EXPOSURE;
    if (live.bloom) {
      live.bloom.luminanceMaterial.threshold = TUNING.BLOOM_THRESHOLD;
      live.bloom.luminanceMaterial.smoothing = TUNING.RPOST_BLOOM_SMOOTHING;
      live.bloom.intensity = TUNING.RPOST_BLOOM_INTENSITY;
    }
    if (live.vignette) live.vignette.darkness = TUNING.VIGNETTE;
    if (live.saturation && live.saturation.saturation !== TUNING.RPOST_SATURATION) live.saturation.saturation = TUNING.RPOST_SATURATION;
    if (live.contrast && live.contrast.contrast !== TUNING.RPOST_CONTRAST) live.contrast.contrast = TUNING.RPOST_CONTRAST;
    if (live.aberration) {
      const k = glowing ? TUNING.CHROMATIC_ABERRATION : 0;
      live.aberration.offset.set(k, k);
      if (live.aberration.modulationOffset !== TUNING.RPOST_CA_MODULATION_OFFSET) live.aberration.modulationOffset = TUNING.RPOST_CA_MODULATION_OFFSET;
    }
    AO_FLOOR_UNIFORM.value = TUNING.RPOST_AO_FLOOR;
    if (live.n8ao) {
      // N8AO rebuilds its denoise materials on quality / depth-type changes: re-patch new ones.
      patchN8aoPass(live.n8ao as unknown as PatchableN8ao);
      const c = live.n8ao.configuration;
      if (c.aoRadius !== TUNING.RPOST_AO_RADIUS_M) c.aoRadius = TUNING.RPOST_AO_RADIUS_M;
      if (c.intensity !== TUNING.RPOST_AO_INTENSITY) c.intensity = TUNING.RPOST_AO_INTENSITY;
      if (c.distanceFalloff !== TUNING.RPOST_AO_FALLOFF) c.distanceFalloff = TUNING.RPOST_AO_FALLOFF;
    }
  };

  return {
    get passNames() {
      return names;
    },
    get aoMode() {
      return aoMode;
    },
    get n8aoPass() {
      return live.n8ao;
    },
    render(dtS) {
      applyLive();
      composer.render(dtS);
    },
    setQuality(q) {
      // Every scene switch re-applies the stage quality: rebuilding the same chain disposed and
      // recompiled every pass program and walked postprocessing's Selection layer ids past 31.
      if (builtFor && sameQuality(builtFor, q)) return;
      build(q);
    },
    setGlowing(on) {
      glowing = on;
    },
    setAoDisplay(mode) {
      live.n8ao?.setDisplayMode(mode);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    dispose() {
      teardown();
      composer.dispose();
    },
  };
}
