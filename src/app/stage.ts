/**
 * src/app/stage.ts (integration): the one WebGL renderer on #game and what it shows between runs.
 *
 * - One GameRenderer for the whole page (menu backdrop and runs share it), resized with the window,
 *   pixel ratio capped by the quality preset (REQ-REN-07).
 * - Shared, cached resources: the material registry, one EnvironmentHandle per preset (PMREM bakes are
 *   the slow part) and every BuiltLevel (built once per page; views clone its geometry).
 * - The main menu backdrop (REQ-MNU-01, ARCHITECTURE section 2): Market Street built exactly as for a
 *   run (LevelView, lighting, sky, fog) seen through createMenuFlythrough's camera, disposed when a
 *   run starts and rebuilt when the menu comes back.
 * - Quality: "auto" is resolved once by the 2 s FPS probe while the menu renders (REQ-REN-05); the
 *   probe only counts frames, the app loop keeps drawing, so the measured rate is the real one. It
 *   starts only after the current scene has drawn INT_PROBE_WARM_FRAMES frames (never during the park
 *   build and first-draw shader links, which made an RTX 5070 pick Low), measures the median frame,
 *   and its result is kept in localStorage so later page loads skip it (SPEC §10 "on first load").
 * - Shaders: a scene is compiled with renderer.compileAsync (KHR_parallel_shader_compile) before it is
 *   first drawn (StageScene.warm), so no program links on the main thread in the first frames.
 */

import { Scene, type Camera, type Object3D, type WebGLRenderer } from 'three';
import type { LevelId, QualityOption, QualityPresetId } from '../core/types';
import { buildLevel } from '../levels/builder';
import { loadLevelDef } from '../levels/registry';
import type { BuiltLevel, EnvironmentPreset } from '../levels/types';
import { createLevelView } from '../render/levelView';
import { createLighting } from '../render/lighting';
import { createMaterialRegistry, type GameMaterialRegistry } from '../render/materials';
import { createMenuFlythrough } from '../render/menuFlythrough';
import { createNpcFigure } from '../render/npc';
import { createPostChain } from '../render/post';
import { autoQuality, QUALITY_PRESET_IDS, qualitySettings } from '../render/quality';
import { createGameRenderer } from '../render/renderer';
import { createEnvironment, type GameEnvironment } from '../render/sky';
import type { GameRenderer, QualitySettings } from '../render/types';
import { restSnapshot } from '../core/mock';
import { TUNING } from '../core/tuning';

/** Preset used while "auto" is still probing. */
const AUTO_START_PRESET: QualityPresetId = 'med';
/** localStorage key of the probed "auto" preset (a per-browser convenience, never required). */
const PROBED_KEY = 'code-skater.probedQuality';

/**
 * Link every program an object needs through KHR_parallel_shader_compile before its first frame
 * (first-playable finding). Without the extension (SwiftShader) there is nothing to gain and three
 * would warn, so it resolves at once; compile errors never reject (the first render compiles the rest).
 */
export function warmScene(renderer: WebGLRenderer, scene: Object3D, camera: Camera): Promise<void> {
  try {
    if (!renderer.getContext().getSupportedExtensions()?.includes('KHR_parallel_shader_compile')) return Promise.resolve();
    return renderer.compileAsync(scene, camera).then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

/** Renderer names of software GL: the browser is drawing without the graphics card. */
const SOFTWARE_GL = /basic render driver|swiftshader|llvmpipe|software/i;

/**
 * Founder report 2026-09-23 ("super choppy"): Chrome had fallen back to the Microsoft Basic Render
 * Driver, so the game ran at 12 fps on an RTX 5070. Tell the player once per load. Automated
 * browsers (navigator.webdriver) use software GL on purpose and get no notice.
 */
function warnIfSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  try {
    if (navigator.webdriver) return;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (!SOFTWARE_GL.test(name)) return;
    const note = document.createElement('div');
    note.className = 'gpu-warning';
    note.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = 'Your browser is drawing this game without your graphics card, so it will be choppy. Turn on "Use graphics acceleration when available" in the browser settings, then restart the browser.';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => note.remove());
    note.append(text, ok);
    document.body.append(note);
    window.setTimeout(() => note.remove(), TUNING.INT_GPU_WARNING_S * 1000);
  } catch {
    // A missing notice is better than a broken boot.
  }
}

function readProbed(): QualityPresetId | null {
  try {
    const v = window.localStorage.getItem(PROBED_KEY);
    return v !== null && (QUALITY_PRESET_IDS as readonly string[]).includes(v) ? (v as QualityPresetId) : null;
  } catch {
    return null;
  }
}

function writeProbed(id: QualityPresetId): void {
  try {
    window.localStorage.setItem(PROBED_KEY, id);
  } catch {
    // Private window or blocked storage: the probe simply runs again next load.
  }
}

/** Something the stage draws each frame (the menu backdrop or a run). */
export interface StageScene {
  render(dtS: number): void;
  resize(width: number, height: number): void;
  setQuality(q: QualitySettings): void;
  dispose(): void;
  /** Compile every program the scene needs without blocking (compileAsync); called before its first frame. */
  warm?(): Promise<void>;
}

export interface Stage {
  readonly renderer: GameRenderer;
  readonly materials: GameMaterialRegistry;
  readonly quality: QualitySettings;
  /** Cached BuiltLevel (buildLevel runs once per level per page). */
  level(id: LevelId): Promise<BuiltLevel>;
  environment(preset: EnvironmentPreset): GameEnvironment;
  /** The scene drawn by frame(); null draws nothing (a black frame never shows: the UI covers it). */
  setScene(scene: StageScene | null): void;
  /** Build the Market Street flythrough backdrop and make it the current scene. */
  showMenuBackdrop(): Promise<void>;

  /** Apply a quality option live: a preset at once, "auto" through the probe (once per page). */
  applyQuality(option: QualityOption): void;
  frame(dtS: number): void;
  readonly width: number;
  readonly height: number;
  /** Frames drawn since the page loaded (window.__shotReady). */
  readonly framesDrawn: number;
}

export function createStage(canvas: HTMLCanvasElement, option: QualityOption): Stage {
  let quality = qualitySettings(option === 'auto' ? AUTO_START_PRESET : option);
  const renderer = createGameRenderer(canvas, quality);
  warnIfSoftwareGl(renderer.renderer.getContext());
  const materials = createMaterialRegistry();
  const levels = new Map<LevelId, Promise<BuiltLevel>>();
  const envs = new Map<EnvironmentPreset, GameEnvironment>();
  let scene: StageScene | null = null;
  let width = 1;
  let height = 1;
  let frames = 0;
  let probed: QualitySettings | null = null;
  let probing = false;
  let probePending = false;
  let sceneFrames = 0;
  let menuToken = 0;

  const startProbe = (): void => {
    probePending = false;
    probing = true;
    // The probe counts rAF frames while the app loop keeps rendering the current scene.
    void autoQuality('auto', () => undefined, () => performance.now()).then((q) => {
      probing = false;
      probed = q;
      writeProbed(q.id);
      setQualityNow(q);
    });
  };

  const setQualityNow = (q: QualitySettings): void => {
    quality = q;
    renderer.setQuality(q);
    scene?.setQuality(q);
    scene?.resize(width, height);
  };

  const resize = (): void => {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    renderer.resize(width, height);
    scene?.resize(width, height);
  };
  window.addEventListener('resize', resize);
  resize();

  const stage: Stage = {
    renderer,
    materials,
    get quality() {
      return quality;
    },
    level(id) {
      let p = levels.get(id);
      if (!p) {
        p = loadLevelDef(id).then((def) => buildLevel(def));
        levels.set(id, p);
        p.catch(() => levels.delete(id));
      }
      return p;
    },
    environment(preset) {
      let env = envs.get(preset);
      if (!env) {
        env = createEnvironment(renderer, preset);
        envs.set(preset, env);
      }
      return env;
    },
    setScene(next) {
      if (scene === next) return;
      scene?.dispose();
      scene = next;
      sceneFrames = 0;
      menuToken += 1;
      if (scene) {
        scene.setQuality(quality);
        scene.resize(width, height);
      }
    },
    async showMenuBackdrop() {
      const token = ++menuToken;
      const built = await stage.level('marketStreet');
      if (token !== menuToken) return; // a run started meanwhile
      const env = stage.environment(built.def.environment);
      const s = new Scene();
      s.background = env.background;
      s.environment = env.environment;
      s.fog = env.fog;
      s.environmentIntensity = TUNING.RSKY_ENV_INTENSITY;
      const lighting = createLighting(built.def.environment, quality);
      s.add(lighting.group);
      const view = createLevelView({ built, materials, createNpc: createNpcFigure });
      s.add(view.group);
      const fly = createMenuFlythrough(built, width / height);
      // The chain is built at the stage's quality, which setScene below re-applies without a rebuild.
      const post = createPostChain(renderer, s, fly.camera);
      const snap = restSnapshot('marketStreet');
      const menuScene: StageScene = {
        render(dtS) {
          s.environmentIntensity = TUNING.RSKY_ENV_INTENSITY;
          fly.update(dtS);
          view.update(snap, dtS);
          lighting.update(fly.camera.position);
          post.render(dtS);
        },
        resize(w, h) {
          post.setSize(w, h);
          fly.setAspect(w / h);
        },
        setQuality(q) {
          lighting.setQuality(q);
          post.setQuality(q);
        },
        dispose() {
          post.dispose();
          view.dispose();
          lighting.dispose();
          fly.dispose();
        },
      };
      // Compile off the main thread before the first backdrop frame (first-playable finding).
      await warmScene(renderer.renderer, s, fly.camera);
      if (token !== menuToken) {
        menuScene.dispose();
        return;
      }
      scene?.dispose();
      scene = menuScene;
      sceneFrames = 0;
      menuScene.setQuality(quality);
      menuScene.resize(width, height);
    },
    applyQuality(opt) {
      if (opt !== 'auto') {
        setQualityNow(qualitySettings(opt));
        return;
      }
      if (!probed) {
        const stored = readProbed();
        if (stored) probed = qualitySettings(stored);
      }
      if (probed) {
        setQualityNow(probed);
        return;
      }
      if (probing) return;
      // Deferred: frame() starts it once the current scene has drawn INT_PROBE_WARM_FRAMES frames.
      probePending = true;
    },
    frame(dtS) {
      if (!scene) return;
      scene.render(dtS);
      frames += 1;
      sceneFrames += 1;
      if (probePending && !probing && sceneFrames >= TUNING.INT_PROBE_WARM_FRAMES) startProbe();
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get framesDrawn() {
      return frames;
    },
  };
  return stage;
}
