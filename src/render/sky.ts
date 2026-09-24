/**
 * src/render/sky.ts (render track): image-based lighting (REQ-REN-02). Street: three's Sky shader
 * (late afternoon, SUN_ELEVATION_DEG) baked to PMREM. Woodshed: RoomEnvironment + warm fill.
 * Test grid: a neutral gradient. No downloaded HDRIs are required (REQ-MAT-05).
 *
 * background = a 512 px cube render of the sky (crisp horizon and sun glow), environment = the
 * PMREM of the same sky WITHOUT the sun disc (the DirectionalLight owns the sun and its shadows)
 * but WITH a warm ground disc and a small soft sun blob (RSKY_ENV_GROUND, RSKY_ENV_SUN_BLOB): the
 * reflections on steel and glass carry a horizon line and a highlight, which is what makes chrome
 * read as chrome, while the blob's diffuse share stays too small to fill the shadows. Baked once per
 * createEnvironment. After the bake, the cube's horizon row is read back and becomes the fog colour
 * (environmentFog), so distance fades into the sky instead of into a guessed beige.
 */

import {
  BackSide, CircleGeometry, Color, CubeCamera, DataUtils, Fog, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial,
  PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLCubeRenderTarget, type Texture,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TUNING } from '../core/tuning';
import type { EnvironmentPreset } from '../levels/types';
import { sunDirection } from './lib/shadowSnap';
import type { EnvironmentHandle, GameRenderer } from './types';

const GRADIENT_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GRADIENT_FRAG = `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform float brightness;
varying vec3 vDir;
void main() {
  float y = vDir.y;
  vec3 up = mix(horizon, zenith, smoothstep(0.02, 0.7, y));
  vec3 down = mix(horizon, ground, smoothstep(0.0, -0.35, y));
  vec3 c = y >= 0.0 ? up : down;
  gl_FragColor = vec4(c * brightness, 1.0);
}`;

interface GradientLook {
  readonly zenith: string;
  readonly horizon: string;
  readonly ground: string;
  readonly brightness: number;
}

/** A big inward-facing sphere with a three-stop gradient: the backdrop for the shed and the test grid. */
function gradientSky(look: GradientLook): Mesh {
  const mat = new ShaderMaterial({
    uniforms: {
      zenith: { value: new Vector3().fromArray(hexToLinear(look.zenith)) },
      horizon: { value: new Vector3().fromArray(hexToLinear(look.horizon)) },
      ground: { value: new Vector3().fromArray(hexToLinear(look.ground)) },
      brightness: { value: look.brightness },
    },
    vertexShader: GRADIENT_VERT,
    fragmentShader: GRADIENT_FRAG,
    side: BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(400, 24, 12), mat);
  mesh.name = 'gradientSky';
  return mesh;
}

function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const s = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [s((n >> 16) & 255), s((n >> 8) & 255), s(n & 255)];
}

/** Fog distances per environment; the colour is the baked horizon once an environment exists. */
const FOG_RANGE: Readonly<Record<EnvironmentPreset, readonly [number, number]>> = {
  streetAfternoon: [70, 520],
  woodshedInterior: [45, 140],
  campusNight: [45, 320],
  testGrid: [60, 220],
};

/** Fallback fog colours before a bake (tests, or fog created before the environment). */
const FOG_DEFAULT: Readonly<Record<EnvironmentPreset, string>> = {
  streetAfternoon: '#c9b8a6',
  woodshedInterior: '#1d1712',
  campusNight: '#1b1d3a',
  testGrid: '#cdd5de',
};

/** Horizon colour read back from the last bake of each preset (linear), shared with environmentFog. */
const bakedHorizon = new Map<EnvironmentPreset, Color>();

/** The baked horizon colour for a preset (linear), or null before createEnvironment ran for it. */
export function bakedHorizonColor(environment: EnvironmentPreset): Color | null {
  const c = bakedHorizon.get(environment);
  return c ? c.clone() : null;
}

/**
 * Fog per environment for the app's scene (the handle only carries textures). The colour is the
 * cube's horizon row sampled after the bake when createEnvironment has run for this preset, else a
 * default; pass `horizon` to override.
 */
export function environmentFog(environment: EnvironmentPreset, horizon?: Color): Fog {
  const [near, far] = FOG_RANGE[environment];
  const color = horizon ?? bakedHorizon.get(environment) ?? new Color(FOG_DEFAULT[environment]);
  return new Fog(color.clone(), near, far);
}

function streetSky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(2000);
  // The Sky shader is authored for exposure 0.5 and tone mapping on the canvas; we bake it linear,
  // so scale its radiance before it reaches the PMREM and the background.
  sky.material.fragmentShader = `uniform float skyScale;\n${sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyScale, 1.0 );')}`;
  sky.material.uniforms.skyScale = { value: TUNING.RSKY_RADIANCE };
  sky.material.needsUpdate = true;
  const u = sky.material.uniforms;
  (u.turbidity as { value: number }).value = TUNING.RSKY_TURBIDITY;
  (u.rayleigh as { value: number }).value = TUNING.RSKY_RAYLEIGH;
  (u.mieCoefficient as { value: number }).value = TUNING.RSKY_MIE;
  (u.mieDirectionalG as { value: number }).value = 0.82;
  (u.sunPosition as { value: Vector3 }).value.copy(sunDirection(TUNING.SUN_ELEVATION_DEG, TUNING.RSKY_SUN_AZIMUTH_DEG));
  return sky;
}

/** The horizon line and the sun highlight that only the reflection environment gets. */
function reflectionProps(sunDir: Vector3, sunRadiance: number): { ground: Mesh; blob: Mesh } {
  const groundMat = new MeshBasicMaterial({ color: new Color('#6b5a48').multiplyScalar(TUNING.RSKY_ENV_GROUND), fog: false });
  const ground = new Mesh(new CircleGeometry(1500, 48), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  ground.name = 'envGround';
  const dist = 1000;
  const radius = Math.tan((3 * Math.PI) / 180) * dist; // a 6 deg disc
  const blobMat = new MeshBasicMaterial({ color: new Color('#ffd9a8').multiplyScalar(sunRadiance), fog: false });
  const blob = new Mesh(new SphereGeometry(radius, 16, 12), blobMat);
  blob.position.copy(sunDir).multiplyScalar(dist);
  blob.name = 'envSunBlob';
  return { ground, blob };
}

function bakeCube(renderer: GameRenderer, scene: Scene, size: number): WebGLCubeRenderTarget {
  // Linear HDR data: the post chain tone-maps it once with everything else.
  const rt = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  const cam = new CubeCamera(0.1, 5000, rt);
  cam.update(renderer.renderer, scene);
  return rt;
}

/** Mean colour of the horizon row over the four side faces of a baked cube (linear). */
function sampleHorizon(renderer: GameRenderer, cube: WebGLCubeRenderTarget): Color | null {
  const size = cube.width;
  const row = Math.floor(size / 2);
  const buf = new Uint16Array(size * 4);
  const sum = [0, 0, 0];
  let n = 0;
  try {
    for (const face of [0, 1, 4, 5]) {
      renderer.renderer.readRenderTargetPixels(cube, 0, row, size, 1, buf, face);
      for (let x = 0; x < size; x++) {
        sum[0] += DataUtils.fromHalfFloat(buf[x * 4] as number);
        sum[1] += DataUtils.fromHalfFloat(buf[x * 4 + 1] as number);
        sum[2] += DataUtils.fromHalfFloat(buf[x * 4 + 2] as number);
        n += 1;
      }
    }
  } catch {
    return null;
  }
  if (n === 0 || !Number.isFinite(sum[0] + sum[1] + sum[2])) return null;
  return new Color(sum[0] / n, sum[1] / n, sum[2] / n);
}

/**
 * Run a PMREM bake with three's shader diagnostics off. three's own PMREMGGXConvolution shader
 * makes the D3D compiler (ANGLE on Windows) print an X4122 precision note ("sum of 0.996094 and
 * -2.98e-17 cannot be represented accurately"), which three forwards as a THREE.WebGLProgram
 * warning on every load. The shader is three's, unchanged and correct; only the bake is silenced,
 * every other program keeps its checks. The previous setting is restored even if the bake throws.
 */
export function quietPmremBake<T>(renderer: Pick<GameRenderer, 'renderer'>, bake: () => T): T {
  const debug = renderer.renderer.debug;
  const was = debug.checkShaderErrors;
  debug.checkShaderErrors = false;
  try {
    return bake();
  } finally {
    debug.checkShaderErrors = was;
  }
}

export interface GameEnvironment extends EnvironmentHandle {
  /** Fog for the app's scene, coloured from the baked horizon. */
  readonly fog: Fog;
  /** The sampled horizon colour (linear), null when the readback was unavailable. */
  readonly horizon: Color | null;
}

export function createEnvironment(renderer: GameRenderer, environment: EnvironmentPreset): GameEnvironment {
  const gl = renderer.renderer;
  const pmrem = new PMREMGenerator(gl);
  pmrem.compileEquirectangularShader();
  const disposables: { dispose(): void }[] = [pmrem];

  const skyScene = new Scene();
  let envScene: Scene = skyScene;
  let sunDisc: { value: number } | null = null;
  let props: { ground: Mesh; blob: Mesh } | null = null;
  switch (environment) {
    case 'streetAfternoon': {
      const sky = streetSky();
      skyScene.add(sky);
      disposables.push(sky.material, sky.geometry);
      sunDisc = sky.material.uniforms.showSunDisc as { value: number };
      props = reflectionProps(sunDirection(TUNING.SUN_ELEVATION_DEG, TUNING.RSKY_SUN_AZIMUTH_DEG), TUNING.RLIT_SUN_INTENSITY * TUNING.RSKY_ENV_SUN_BLOB);
      break;
    }
    case 'woodshedInterior': {
      const g = gradientSky({ zenith: '#15110e', horizon: '#3a2d22', ground: '#120e0b', brightness: 0.8 });
      skyScene.add(g);
      disposables.push(g.geometry, g.material as ShaderMaterial);
      const room = new RoomEnvironment();
      // RoomEnvironment is authored for showroom exposure: scale its lights and light panels down,
      // then add two cool skylight panels so the warm shed has a cool counterpoint in reflections.
      const k = TUNING.RSKY_ROOM_SCALE;
      room.traverse((o) => {
        const light = o as { isLight?: boolean; intensity?: number };
        if (light.isLight && typeof light.intensity === 'number') light.intensity *= k;
        const m = (o as Mesh).material as { emissiveIntensity?: number } | undefined;
        if (m && typeof m.emissiveIntensity === 'number' && m.emissiveIntensity > 1) m.emissiveIntensity *= k;
      });
      const skylight = new MeshBasicMaterial({ color: new Color('#c8d4e8').multiplyScalar(6 * k) });
      for (const x of [-3, 3]) {
        const panel = new Mesh(new CircleGeometry(1.2, 4), skylight);
        panel.rotation.x = Math.PI / 2;
        panel.position.set(x, 20, 0);
        panel.name = 'envSkylight';
        room.add(panel);
      }
      envScene = room;
      break;
    }
    case 'campusNight': {
      // Lab Campus at night: deep navy overhead, a violet city glow on the horizon (it also becomes
      // the fog colour), and a small moon highlight for the steel and glass reflections.
      const g = gradientSky({ zenith: '#040819', horizon: '#34305e', ground: '#0a0b12', brightness: 1.0 });
      skyScene.add(g);
      disposables.push(g.geometry, g.material as ShaderMaterial);
      props = reflectionProps(sunDirection(42, 140), TUNING.RLIT_CAMPUS_MOON_INTENSITY * TUNING.RSKY_ENV_SUN_BLOB);
      break;
    }
    case 'testGrid': {
      const g = gradientSky({ zenith: '#6f96d0', horizon: '#dfe4ea', ground: '#5a5650', brightness: 1.0 });
      skyScene.add(g);
      disposables.push(g.geometry, g.material as ShaderMaterial);
      props = reflectionProps(sunDirection(48, 225), TUNING.RLIT_SUN_INTENSITY * 0.85 * TUNING.RSKY_ENV_SUN_BLOB);
      break;
    }
  }

  const cube = bakeCube(renderer, skyScene, 512);
  disposables.push(cube);
  let background: Texture | null = cube.texture;
  const horizon = sampleHorizon(renderer, cube);
  if (horizon) bakedHorizon.set(environment, horizon);

  // The IBL must not contain the sun disc: the sun is the DirectionalLight (with shadows), and a
  // baked disc would light everything from the sun's direction with no shadow at all. The soft
  // blob and the ground disc go in only here, for reflections.
  if (sunDisc) sunDisc.value = 0;
  if (props) skyScene.add(props.ground, props.blob);
  const envRt = quietPmremBake(renderer, () => pmrem.fromScene(envScene, 0.02, 0.1, 5000));
  if (props) {
    skyScene.remove(props.ground, props.blob);
    props.ground.geometry.dispose();
    (props.ground.material as MeshBasicMaterial).dispose();
    props.blob.geometry.dispose();
    (props.blob.material as MeshBasicMaterial).dispose();
  }
  if (sunDisc) sunDisc.value = 1;
  disposables.push(envRt);
  let env: Texture | null = envRt.texture;
  if (envScene !== skyScene) {
    // RoomEnvironment allocates meshes and lights of its own.
    envScene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as { dispose?: () => void } | undefined;
      if (mat && typeof mat.dispose === 'function') mat.dispose();
    });
  }

  return {
    background,
    environment: env,
    fog: environmentFog(environment, horizon ?? undefined),
    horizon,
    dispose() {
      for (const d of disposables) d.dispose();
      background = null;
      env = null;
    },
  };
}
