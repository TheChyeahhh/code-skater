/**
 * src/render/fx/overlays.ts (fx track): full-screen overlay quads that need no camera transform.
 * The vertex shader writes clip space directly (gl_Position = position), depth test off,
 * frustum culling off, so they draw over the scene from any camera and pass through the render
 * track's post chain like any scene object (the white flash blooms, as SPEC section 10 wants).
 * - flash: one colour, alpha 1 -> 0 over a duration (MacGuffin white, Kernel Panic blue tint).
 * - speed lines: a thin flickering streak band in the outer fifth of the frame, strength 0..1
 *   (REQ-FX-02 / REQ-CAM-04); never over the skater.
 * - slow-mo look: letterbox bars, a light cool vignette and a slow horizontal sweep while 900ms
 *   Inference is held.
 * - blue-screen card: a generated (Canvas2D) parody crash card for Kernel Panic, held for the flash
 *   duration with two one-frame black flickers and a progress percent that ticks.
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Mesh, NormalBlending, ShaderMaterial, type IUniform, type Texture } from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FLASH_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    if (uAlpha <= 0.002) discard;
    gl_FragColor = vec4(uColor, uAlpha);
  }
`;

const SPEED_FRAG = /* glsl */ `
  uniform float uStrength;
  uniform float uTime;
  uniform float uAspect;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    if (uStrength <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= uAspect;
    float r = length(p);
    // Only the outer fifth of the frame carries lines; the centre stays clean.
    float radial = smoothstep(1.05, 1.6, r);
    if (radial <= 0.001) discard;
    float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
    float sectors = 32.0;
    float s = ang * sectors;
    float id = floor(s);
    float h = hash(id);
    // Per-line flicker: a line is on for a few frames at a time.
    if (hash(id + floor(uTime * 14.0)) > 0.55) discard;
    float k = fract(s);
    float width = 0.015 + 0.03 * h;
    float line = smoothstep(0.5 - width, 0.5, k) * smoothstep(0.5 + width, 0.5, k);
    float along = fract(r * 3.0 - uTime * (9.0 + 6.0 * h) + h * 9.0);
    float dash = smoothstep(0.2, 0.45, along) * smoothstep(1.0, 0.75, along);
    float a = line * dash * radial * uStrength * (0.5 + 0.5 * h);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.92), a);
  }
`;

const SLOWMO_FRAG = /* glsl */ `
  uniform float uStrength;
  uniform float uTime;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    if (uStrength <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= uAspect;
    float r = length(p);
    // Light cool vignette (0.25 max), real black letterbox bars, a slow 3 px sweep band.
    float vig = smoothstep(0.5, 1.5, r) * 0.25;
    float bar = smoothstep(0.86, 0.9, abs(p.y));
    float sweepY = fract(uTime * 0.4);
    float sweep = smoothstep(0.004, 0.0, abs(vUv.y - sweepY)) * 0.06;
    vec3 cold = vec3(0.35, 0.6, 1.0);
    vec3 rgb = mix(cold, vec3(0.0), bar);
    rgb = mix(rgb, vec3(1.0), sweep * 8.0 * (1.0 - bar));
    float a = uStrength * max(vig + sweep, bar * 0.9);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(rgb, a);
  }
`;

const CARD_FRAG = /* glsl */ `
  uniform sampler2D uCard;
  uniform float uHasCard;
  uniform float uAlpha;
  uniform float uBlack;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    if (uAlpha <= 0.002) discard;
    if (uBlack > 0.5) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 bg = vec3(0.04, 0.23, 0.84);
    vec2 uv = vec2((vUv.x - 0.5) * uAspect / 1.7777778 + 0.5, vUv.y);
    vec3 rgb = bg;
    if (uHasCard > 0.5 && uv.x >= 0.0 && uv.x <= 1.0) rgb = texture2D(uCard, uv).rgb;
    gl_FragColor = vec4(rgb, uAlpha);
  }
`;

function quad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.boundingSphere = null;
  return g;
}

function overlayMesh(material: ShaderMaterial, order: number): Mesh {
  const m = new Mesh(quad(), material);
  m.frustumCulled = false;
  m.renderOrder = order;
  return m;
}

export class ScreenFlash {
  readonly mesh: Mesh;
  private readonly uColor: IUniform<Color>;
  private readonly uAlpha: IUniform<number>;
  private readonly material: ShaderMaterial;
  private t = -1;
  private durationS = 0;
  private peak = 1;

  constructor() {
    this.uColor = { value: new Color('#ffffff') };
    this.uAlpha = { value: 0 };
    this.material = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FLASH_FRAG, uniforms: { uColor: this.uColor, uAlpha: this.uAlpha },
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
    });
    this.mesh = overlayMesh(this.material, 1002);
  }

  /** Start a flash; a new flash replaces the running one. */
  fire(hex: string, durationS: number, peakAlpha: number): void {
    this.uColor.value.set(hex);
    this.durationS = Math.max(1e-3, durationS);
    this.peak = peakAlpha;
    this.t = 0;
    this.uAlpha.value = peakAlpha;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  get alpha(): number {
    return this.uAlpha.value;
  }

  /** Seconds left, 0 when idle. */
  get remainingS(): number {
    return this.t < 0 ? 0 : Math.max(0, this.durationS - this.t);
  }

  update(dtS: number): void {
    if (this.t < 0) return;
    this.t += dtS;
    const u = this.t / this.durationS;
    if (u >= 1) {
      this.t = -1;
      this.uAlpha.value = 0;
      return;
    }
    // Snappy: full for the first fifth, then a quadratic tail.
    const k = u < 0.2 ? 1 : 1 - (u - 0.2) / 0.8;
    this.uAlpha.value = this.peak * k * k;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** A strength-driven overlay (speed lines, slow-mo look) that eases toward a target. */
export class StrengthOverlay {
  readonly mesh: Mesh;
  private readonly uStrength: IUniform<number>;
  private readonly uTime: IUniform<number>;
  private readonly uAspect: IUniform<number>;
  private readonly material: ShaderMaterial;

  constructor(kind: 'speedLines' | 'slowMo') {
    this.uStrength = { value: 0 };
    this.uTime = { value: 0 };
    this.uAspect = { value: 16 / 9 };
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: kind === 'speedLines' ? SPEED_FRAG : SLOWMO_FRAG,
      uniforms: { uStrength: this.uStrength, uTime: this.uTime, uAspect: this.uAspect },
      transparent: true, depthTest: false, depthWrite: false,
      blending: kind === 'speedLines' ? AdditiveBlending : NormalBlending,
    });
    this.mesh = overlayMesh(this.material, kind === 'speedLines' ? 1000 : 1001);
  }

  get strength(): number {
    return this.uStrength.value;
  }

  /** Move strength toward target at 1 / fadeS per second; advance the shader clock. */
  update(dtS: number, target: number, fadeS: number, aspect: number): void {
    const step = dtS / Math.max(1e-3, fadeS);
    const s = this.uStrength.value;
    const d = target - s;
    this.uStrength.value = Math.abs(d) <= step ? target : s + Math.sign(d) * step;
    this.uTime.value += dtS;
    this.uAspect.value = aspect;
    this.mesh.visible = this.uStrength.value > 0.002;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const CARD_W = 640;
const CARD_H = 360;
/** Frames (0-based since fire) drawn solid black: two one-frame flickers. */
const FLICKER_FRAMES: readonly number[] = [2, 6];

/**
 * The Kernel Panic blue-screen card (SPEC section 9.1, REQ-FX-02): parody text drawn with Canvas2D
 * into a texture (no assets, no vendor names), shown full screen for the flash duration. Without a
 * document (tests in node) the card is a flat blue.
 */
export class BlueScreenCard {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly uAlpha: IUniform<number>;
  private readonly uBlack: IUniform<number>;
  private readonly uAspect: IUniform<number>;
  private readonly uCard: IUniform<Texture | null>;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly texture: CanvasTexture | null;
  private t = -1;
  private durationS = 0;
  private frame = 0;
  private peak = 0.85;
  private lastPercent = -1;

  constructor() {
    this.uAlpha = { value: 0 };
    this.uBlack = { value: 0 };
    this.uAspect = { value: 16 / 9 };
    this.uCard = { value: null };
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = CARD_W;
      this.canvas.height = CARD_H;
      this.texture = new CanvasTexture(this.canvas);
      this.uCard.value = this.texture;
    } else {
      this.texture = null;
    }
    this.material = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: CARD_FRAG,
      uniforms: { uCard: this.uCard, uHasCard: { value: this.texture ? 1 : 0 }, uAlpha: this.uAlpha, uBlack: this.uBlack, uAspect: this.uAspect },
      transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending,
    });
    this.mesh = overlayMesh(this.material, 1003);
    this.mesh.visible = false;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  get alpha(): number {
    return this.uAlpha.value;
  }

  private draw(percent: number): void {
    if (!this.canvas || !this.texture) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a3bd6';
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.font = '96px ui-monospace, Consolas, "Courier New", monospace';
    ctx.fillText(':(', 60, 40);
    ctx.font = '20px ui-monospace, Consolas, "Courier New", monospace';
    ctx.fillText('KERNEL PANIC', 60, 160);
    ctx.font = '15px ui-monospace, Consolas, "Courier New", monospace';
    ctx.fillText('Your deck ran into a problem and needs to restart.', 60, 194);
    ctx.fillText('We are collecting some sparks, then we will restart it for you.', 60, 216);
    ctx.font = '20px ui-monospace, Consolas, "Courier New", monospace';
    ctx.fillText(`${percent}% complete`, 60, 252);
    ctx.font = '12px ui-monospace, Consolas, "Courier New", monospace';
    ctx.fillText('Stop code: DECK_NOT_HANDLED', 60, 318);
    ctx.fillText('What failed: trucks.sys', 60, 336);
    this.texture.needsUpdate = true;
  }

  /** Show the card for durationS at peakAlpha. */
  fire(durationS: number, peakAlpha: number): void {
    this.durationS = Math.max(1e-3, durationS);
    this.peak = peakAlpha;
    this.t = 0;
    this.frame = 0;
    this.lastPercent = -1;
    this.uAlpha.value = peakAlpha;
    this.uBlack.value = 0;
    this.mesh.visible = true;
    this.draw(0);
    this.lastPercent = 0;
  }

  update(dtS: number, aspect: number): void {
    this.uAspect.value = aspect;
    if (this.t < 0) return;
    this.t += dtS;
    this.frame += 1;
    if (this.t >= this.durationS) {
      this.t = -1;
      this.uAlpha.value = 0;
      this.uBlack.value = 0;
      this.mesh.visible = false;
      return;
    }
    this.uBlack.value = FLICKER_FRAMES.includes(this.frame) ? 1 : 0;
    this.uAlpha.value = this.peak;
    // The fake progress ticks in steps as the card holds.
    const percent = Math.min(99, Math.floor((this.t / this.durationS) * 4) * 33);
    if (percent !== this.lastPercent) {
      this.lastPercent = percent;
      this.draw(percent);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}
