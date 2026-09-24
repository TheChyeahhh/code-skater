/**
 * src/render/materials.ts (render track): the procedural material registry (REQ-MAT-01..05).
 * One shared Material per MaterialId used by level data (src/levels/types.ts), all textures generated
 * with pixel generators or Canvas2D (src/render/textures). Rails and copings: metalness 1, roughness
 * 0.25, streak normal noise, emissive rim TUNING.RAIL_EMISSIVE_RIM (a visibility rule, REQ-MAT-02).
 * Maple: grain + 2.4 m sheet seams, clearcoat 0.3, roughness 0.45 (REQ-MAT-01).
 *
 * Conventions:
 * - Level geometry carries uv in WORLD METRES; every tiling map sets repeat = 1 / TILE_M, so a
 *   plywood sheet is 2.4 x 1.2 m and a brick 0.25 m wherever it is drawn.
 * - vertexColors is on for every level material: the builder's "color" attribute is the fake AO
 *   (REQ-REN-03). LevelView adds a white colour attribute to any part that lacks one.
 * - Materials are built on first get(id) and shared afterwards; dispose() frees them and the
 *   texture cache. refresh() re-reads the live tunables (emissive rim, neon, IBL intensity).
 * - The rail rim is emissive x a fresnel term (edge-on brighter, RMAT_RAIL_RIM_GAIN) injected with
 *   onBeforeCompile; emissiveIntensity itself stays RAIL_EMISSIVE_RIM.
 * - Rails and copings are also INFLATED in the vertex shader so the drawn pipe never drops under
 *   RMAT_RAIL_MIN_PX pixels on screen (a 3 cm bar was one pixel at 25 m and gone at 70 m). Only the
 *   drawn mesh grows: the sim and the collider are untouched. The pixel size comes from
 *   projectionMatrix[1][1] and the shared viewport height uniform (src/render/lib/viewport.ts).
 * - Steel is dark gunmetal (#60666e as F0), not pale: a dark bar with a sun highlight and a warm rim
 *   reads on a light floor and on brick; pale steel reflecting a pale sky on a pale floor did not.
 * - Every material carries the environment map explicitly (setEnvironment, synced by LevelView from its
 *   scene): three 0.186 applies material.envMapIntensity only when material.envMap is set; with only
 *   scene.environment it uses scene.environmentIntensity (1) and the IBL drowned the sun's shadows.
 * - ENV_SCALE gives metals and glass a stronger share of the IBL (reflections carry the horizon and
 *   the sun blob that sky.ts bakes into the environment) than the diffuse materials.
 */

import {
  Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector2, type Material, type Texture, type WebGLProgramParametersWithUniforms,
} from 'three';
import { TUNING } from '../core/tuning';
import type { RailKind } from '../core/types';
import type { MaterialId } from '../levels/types';
import { VIEWPORT_HEIGHT_UNIFORM } from './lib/viewport';
import { disposeTextureCache, proceduralTexture, type ProceduralTextureKind } from './textures';
import type { MaterialRegistry } from './types';

/**
 * Every id the registry must serve. A Record keyed by MaterialId, so adding an id to
 * src/levels/types.ts fails typecheck here until the render track serves it.
 */
const MATERIAL_MAP: Readonly<Record<MaterialId, true>> = {
  asphalt: true, concrete: true, plazaTile: true, marble: true, granite: true, brick: true, glass: true,
  towerFrame: true, metalPanel: true, roofTar: true, paintedSteel: true, maple: true, mapleDark: true,
  woodPanel: true, steelCoping: true, steelRail: true, scaffold: true, water: true, signBoard: true,
  neon: true, boundary: true,
};

/** Every id the registry must serve (levels.test can assert level data only uses these). */
export const MATERIAL_IDS: readonly MaterialId[] = Object.keys(MATERIAL_MAP) as MaterialId[];

/** Render-only backdrop materials (src/render/lib/backdrop.ts): the Woodshed room and the Street skyline. */
export type BackdropId = 'shedWall' | 'shedWindow' | 'shedCeiling' | 'shedLamp' | 'skyline' | 'apron';

export const BACKDROP_IDS: readonly BackdropId[] = ['shedWall', 'shedWindow', 'shedCeiling', 'shedLamp', 'skyline', 'apron'];

type RegistryId = MaterialId | 'ledgeRim' | BackdropId;

/** envMapIntensity multiplier per id (x RSKY_ENV_INTENSITY); 1 for everything not listed. */
export const ENV_SCALE: Readonly<Partial<Record<RegistryId, number>>> = {
  steelRail: 3.0, steelCoping: 3.0, scaffold: 3.8, metalPanel: 3.8, towerFrame: 3.8, glass: 3.8, water: 2.0,
  skyline: 0.35, apron: 0.5,
};

/** Nominal pipe radius per steel id (the levels track's LEVELS_RAIL_PIPE_R_M / LEVELS_COPING_PIPE_R_M defaults), for the inflate. */
export const RAIL_RADIUS_M: Readonly<Record<'steelRail' | 'steelCoping', number>> = { steelRail: 0.03, steelCoping: 0.04 };

/** Registry plus the live refresh the level view calls each frame. */
export interface GameMaterialRegistry extends MaterialRegistry {
  /** Re-read live tunables (rim, neon, window glow, IBL intensity, rail inflate) into the built materials. */
  refresh(): void;
  /** Ids built so far (tests, dev panel). */
  readonly built: readonly MaterialId[];
  /** A render-only backdrop material (shared, freed by dispose like every other id). */
  backdrop(id: BackdropId): Material;
  /**
   * Give every registry material this environment map explicitly (null clears it). three 0.186
   * ignores material.envMapIntensity when envMap is null and scene.environment is set (it uses
   * scene.environmentIntensity, default 1), which silently ran the IBL at full strength and washed
   * out every shadow. With envMap set, RSKY_ENV_INTENSITY x ENV_SCALE applies. Idempotent and cheap
   * (LevelView calls it each frame with its scene's environment).
   */
  setEnvironment(env: Texture | null): void;
  /** The environment map the registry materials carry (tests). */
  readonly environment: Texture | null;
}

/** Fixed seeds per map so a park looks the same every load. */
const SEED: Readonly<Record<ProceduralTextureKind, number>> = {
  mapleGrain: 101, mapleDark: 102, woodPanel: 103, concrete: 201, concreteNormal: 201, concreteRough: 201, asphalt: 202, marbleVeins: 203, granite: 204,
  brick: 205, brickNormal: 205, plazaTile: 206, glassWindows: 301, glassWindowsLit: 301, roofTar: 207, water: 401, waterNormal: 401,
  scaffold: 302, paintedSteel: 303, metalStreaks: 304, crosswalk: 501, shedWall: 601, shedWindows: 602, shedCeiling: 603, skylineFacade: 604,
  skylineFacadeLit: 604,
};

/** Rim colour: warm, so the edge reads as a lit highlight on the dark bar, not a white outline. */
export const RAIL_RIM_COLOR = '#fff0d0';

interface RailUniforms {
  readonly railRadius: { value: number };
  readonly railMinPx: { value: number };
  readonly rimGain: { value: number };
  readonly viewportHeight: { value: number };
}

/**
 * Fresnel-weighted emissive: edge-on rails glow up to (0.5 + rimGain)x, face-on 0.5x, so the
 * silhouette of a bar carries a bright line. Uniform rimGain = RMAT_RAIL_RIM_GAIN (live).
 */
function rimFresnelFragment(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = `uniform float rimGain;\n${shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    {
      float rimNdV = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
      float rimEdge = 1.0 - rimNdV;
      totalEmissiveRadiance *= 0.5 + rimGain * rimEdge * rimEdge;
    }`,
  )}`;
}

/**
 * Screen-thickness inflate: push the vertex along its normal by whatever keeps a pipe of
 * railRadius at least railMinPx pixels wide at its view depth. pixel size at depth d =
 * 2 d / (projectionMatrix[1][1] * viewportHeight); offset = max(0, minPx * pixel / 2 - radius).
 */
function inflateVertex(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = `uniform float railRadius;\nuniform float railMinPx;\nuniform float viewportHeight;\n${shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    {
      vec4 railMv = modelViewMatrix * vec4(transformed, 1.0);
      float railDepth = max(0.0, -railMv.z);
      float railPixel = (2.0 * railDepth) / (projectionMatrix[1][1] * viewportHeight);
      float railGrow = max(0.0, railMinPx * railPixel * 0.5 - railRadius);
      transformed += normalize(objectNormal) * railGrow;
    }`,
  )}`;
}

/** Skyline base colour (x the per-block vertex tint); near neutral, a touch cool. */
export const SKYLINE_BASE_COLOR = '#dfe3ea';

/** Per-channel shift the skyline haze applies to the fog colour at full RMAT_SKYLINE_HAZE_BLUE (luminance about kept). */
const SKYLINE_HAZE_TINT = [0.8, 0.95, 1.2] as const;

const SKYLINE_HAZE_UNIFORM = { value: 0 };

/**
 * Aerial perspective for the distant blocks: the scene fog (the baked horizon, warm near the ground)
 * made them fade to a neutral grey. The skyline's own fog mixes toward a bluer version of the same
 * fog colour, so far blocks go the way of the sky. Linear Fog only (the Street's); exp2 is left as is.
 */
function skylineHaze(m: MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.skylineHaze = SKYLINE_HAZE_UNIFORM;
    shader.fragmentShader = `uniform float skylineHaze;\n${shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#if defined( USE_FOG ) && !defined( FOG_EXP2 )
        float skyFogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        vec3 skyFogColor = fogColor * mix( vec3( 1.0 ), vec3( ${SKYLINE_HAZE_TINT.map((v) => v.toFixed(2)).join(', ')} ), skylineHaze );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, skyFogColor, skyFogFactor );
      #else
        #include <fog_fragment>
      #endif`,
    )}`;
  };
  m.customProgramCacheKey = () => 'skylineHaze';
}

export function createMaterialRegistry(): GameMaterialRegistry {
  const cache = new Map<RegistryId, Material>();
  const railUniforms = new Map<RegistryId, RailUniforms>();
  const tex = (kind: ProceduralTextureKind): Texture => proceduralTexture(kind, TUNING.RMAT_TEXTURE_PX, SEED[kind]);
  const envIntensity = (id: RegistryId): number => TUNING.RSKY_ENV_INTENSITY * (ENV_SCALE[id] ?? 1);

  const standard = (id: RegistryId, opts: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial =>
    new MeshStandardMaterial({ name: id, vertexColors: true, envMapIntensity: envIntensity(id), ...opts });
  const physical = (id: RegistryId, opts: ConstructorParameters<typeof MeshPhysicalMaterial>[0]): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({ name: id, vertexColors: true, envMapIntensity: envIntensity(id), ...opts });

  /** Attach the rim (and, for pipes, the inflate) to a material; the uniforms are refreshed live. */
  const withRim = (id: RegistryId, m: MeshStandardMaterial, inflate: boolean): MeshStandardMaterial => {
    const u: RailUniforms = {
      railRadius: { value: id === 'steelCoping' ? RAIL_RADIUS_M.steelCoping : RAIL_RADIUS_M.steelRail },
      railMinPx: { value: inflate ? TUNING.RMAT_RAIL_MIN_PX : 0 },
      rimGain: { value: TUNING.RMAT_RAIL_RIM_GAIN },
      viewportHeight: VIEWPORT_HEIGHT_UNIFORM,
    };
    railUniforms.set(id, u);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.railRadius = u.railRadius;
      shader.uniforms.railMinPx = u.railMinPx;
      shader.uniforms.rimGain = u.rimGain;
      shader.uniforms.viewportHeight = u.viewportHeight;
      rimFresnelFragment(shader);
      if (inflate) inflateVertex(shader);
    };
    m.customProgramCacheKey = () => (inflate ? 'rimFresnel+inflate' : 'rimFresnel');
    return m;
  };

  const steel = (id: 'steelRail' | 'steelCoping'): MeshStandardMaterial =>
    withRim(id, standard(id, {
      color: new Color('#60666e'),
      metalness: 1,
      roughness: 0.25,
      normalMap: tex('metalStreaks'),
      normalScale: new Vector2(0.35, 0.35),
      emissive: new Color(RAIL_RIM_COLOR),
      emissiveIntensity: TUNING.RAIL_EMISSIVE_RIM,
    }), true);

  const build = (id: RegistryId): Material => {
    switch (id) {
      case 'asphalt':
        return standard(id, { map: tex('asphalt'), roughness: 0.95, metalness: 0 });
      case 'concrete':
        return standard(id, {
          map: tex('concrete'), normalMap: tex('concreteNormal'), normalScale: new Vector2(0.5, 0.5), roughnessMap: tex('concreteRough'), roughness: 1, metalness: 0,
        });
      case 'ledgeRim':
        return withRim(id, standard(id, {
          map: tex('concrete'), normalMap: tex('concreteNormal'), normalScale: new Vector2(0.35, 0.35), roughnessMap: tex('concreteRough'), roughness: 0.95, metalness: 0,
          emissive: new Color(RAIL_RIM_COLOR), emissiveIntensity: TUNING.RAIL_EMISSIVE_RIM,
        }), false);
      case 'plazaTile':
        return standard(id, { map: tex('plazaTile'), roughness: 0.55, metalness: 0 });
      case 'marble':
        // Polished: a clearcoat over a low-roughness base so the low sun draws a sheen across it.
        return physical(id, { map: tex('marbleVeins'), roughness: 0.3, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.12 });
      case 'granite':
        return standard(id, { map: tex('granite'), roughness: 0.5, metalness: 0 });
      case 'brick':
        return standard(id, { map: tex('brick'), normalMap: tex('brickNormal'), normalScale: new Vector2(0.8, 0.8), roughness: 0.9, metalness: 0 });
      case 'glass':
        // A dielectric curtain wall: the dark pane albedo lives in the map, the sky reflection
        // (clearcoat over a low-roughness base, ENV_SCALE x2.5) is what makes it read as glass.
        return physical(id, {
          map: tex('glassWindows'),
          emissiveMap: tex('glassWindowsLit'),
          emissive: new Color('#ffffff'),
          emissiveIntensity: TUNING.RMAT_GLASS_EMISSIVE,
          metalness: 0,
          roughness: 0.06,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        });
      case 'towerFrame':
        return standard(id, { color: new Color('#3a3f48'), metalness: 0.9, roughness: 0.35, normalMap: tex('metalStreaks'), normalScale: new Vector2(0.2, 0.2) });
      case 'metalPanel':
        return standard(id, { color: new Color('#9aa0a8'), metalness: 0.9, roughness: 0.4, normalMap: tex('metalStreaks'), normalScale: new Vector2(0.5, 0.5) });
      case 'roofTar':
        return standard(id, { map: tex('roofTar'), roughness: 1, metalness: 0 });
      case 'paintedSteel':
        return standard(id, { map: tex('paintedSteel'), metalness: 0.35, roughness: 0.5 });
      case 'maple':
        return physical(id, { map: tex('mapleGrain'), roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35 });
      case 'mapleDark':
        return physical(id, { map: tex('mapleDark'), roughness: 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.4 });
      case 'woodPanel':
        return standard(id, { map: tex('woodPanel'), roughness: 0.75, metalness: 0 });
      case 'steelCoping':
        return steel(id);
      case 'steelRail':
        return steel(id);
      case 'scaffold':
        return standard(id, { map: tex('scaffold'), metalness: 0.9, roughness: 0.45, normalMap: tex('metalStreaks'), normalScale: new Vector2(0.25, 0.25) });
      case 'water':
        return physical(id, {
          map: tex('water'), normalMap: tex('waterNormal'), normalScale: new Vector2(0.4, 0.4), color: new Color('#cfe8f0'),
          roughness: 0.05, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false,
        });
      case 'signBoard':
        return standard(id, { color: new Color('#e9e5db'), roughness: 0.6, metalness: 0 });
      case 'neon':
        return standard(id, { color: new Color('#ff3fd0'), emissive: new Color('#ff3fd0'), emissiveIntensity: TUNING.RMAT_NEON_EMISSIVE, roughness: 0.4, metalness: 0 });
      case 'boundary':
        return new MeshBasicMaterial({ name: id, transparent: true, opacity: 0, depthWrite: false, colorWrite: false, side: DoubleSide });
      // --- backdrops: no vertex-colour AO on these (their geometry has none, or a shade of its own) ---
      case 'shedWall':
        return new MeshStandardMaterial({ name: id, map: tex('shedWall'), roughness: 0.7, metalness: 0.15, envMapIntensity: envIntensity(id) });
      case 'shedWindow':
        return new MeshStandardMaterial({
          name: id, map: tex('shedWindows'), emissiveMap: tex('shedWindows'), emissive: new Color('#dfe9ff'),
          emissiveIntensity: TUNING.RLV_SHED_WINDOW_EMISSIVE, roughness: 0.2, metalness: 0, envMapIntensity: envIntensity(id),
        });
      case 'shedCeiling':
        return new MeshStandardMaterial({ name: id, map: tex('shedCeiling'), roughness: 0.85, metalness: 0.2, envMapIntensity: envIntensity(id) });
      case 'shedLamp':
        return new MeshStandardMaterial({
          name: id, color: new Color('#2a2a2c'), emissive: new Color('#fff0d6'), emissiveIntensity: TUNING.RLV_SHED_LAMP_EMISSIVE, roughness: 0.6, metalness: 0.3,
        });
      case 'skyline': {
        // Distant blocks: a near-neutral base, so the per-block vertex colour (sandstone, teal glass,
        // brick, slate: src/render/lib/backdrop.ts) sets each building's hue; a scatter of lit windows
        // (emissive, never on the bloom layer) and a blue-shifted haze (skylineHaze below).
        const m = new MeshStandardMaterial({
          name: id, map: tex('skylineFacade'), color: new Color(SKYLINE_BASE_COLOR), vertexColors: true, roughness: 0.8, metalness: 0.1, envMapIntensity: envIntensity(id),
          emissiveMap: tex('skylineFacadeLit'), emissive: new Color('#ffffff'), emissiveIntensity: TUNING.RMAT_SKYLINE_WINDOW_EMISSIVE,
        });
        skylineHaze(m);
        return m;
      }
      case 'apron':
        // Graphics overhaul 2026-09-23: city asphalt instead of a flat brown plane (it read as a desert).
        return new MeshStandardMaterial({ name: id, map: tex('asphalt'), color: new Color('#40464f'), roughness: 0.95, metalness: 0, envMapIntensity: envIntensity(id) });
    }
  };

  let environment: Texture | null = null;
  const applyEnv = (m: Material): void => {
    if (m instanceof MeshStandardMaterial && m.envMap !== environment) m.envMap = environment;
  };

  const get = (id: RegistryId): Material => {
    const hit = cache.get(id);
    if (hit) return hit;
    const m = build(id);
    applyEnv(m);
    cache.set(id, m);
    return m;
  };

  return {
    get: (id) => get(id),
    rail(kind: RailKind) {
      return kind === 'coping' ? get('steelCoping') : kind === 'rail' ? get('steelRail') : get('ledgeRim');
    },
    get built() {
      return [...cache.keys()].filter((k): k is MaterialId => k !== 'ledgeRim' && !(BACKDROP_IDS as readonly string[]).includes(k));
    },
    backdrop: (id) => get(id),
    get environment() {
      return environment;
    },
    setEnvironment(env) {
      if (env === environment) return;
      environment = env;
      for (const m of cache.values()) applyEnv(m);
    },
    refresh() {
      for (const [id, m] of cache) {
        if (!(m instanceof MeshStandardMaterial)) continue;
        if (id === 'steelCoping' || id === 'steelRail' || id === 'ledgeRim') m.emissiveIntensity = TUNING.RAIL_EMISSIVE_RIM;
        else if (id === 'neon') m.emissiveIntensity = TUNING.RMAT_NEON_EMISSIVE;
        else if (id === 'glass') m.emissiveIntensity = TUNING.RMAT_GLASS_EMISSIVE;
        else if (id === 'skyline') m.emissiveIntensity = TUNING.RMAT_SKYLINE_WINDOW_EMISSIVE;
        else if (id === 'shedWindow') m.emissiveIntensity = TUNING.RLV_SHED_WINDOW_EMISSIVE;
        else if (id === 'shedLamp') m.emissiveIntensity = TUNING.RLV_SHED_LAMP_EMISSIVE;
        m.envMapIntensity = envIntensity(id);
      }
      SKYLINE_HAZE_UNIFORM.value = TUNING.RMAT_SKYLINE_HAZE_BLUE;
      for (const [id, u] of railUniforms) {
        u.rimGain.value = TUNING.RMAT_RAIL_RIM_GAIN;
        if (id !== 'ledgeRim') u.railMinPx.value = TUNING.RMAT_RAIL_MIN_PX;
      }
    },
    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
      railUniforms.clear();
      disposeTextureCache();
    },
  };
}
