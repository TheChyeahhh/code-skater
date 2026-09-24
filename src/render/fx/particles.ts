/**
 * src/render/fx/particles.ts (fx track): a fixed-size GPU particle pool (REQ-FX-01 "GPU points").
 *
 * One THREE.Points per pool. Every particle is written ONCE at spawn (position, velocity, birth,
 * life, size, colour, spin, kind) into preallocated Float32Arrays; the vertex shader integrates
 * p = p0 + v t + 0.5 g t^2 from uTime, fades by age and parks dead points off screen. So the per
 * frame CPU cost is one uniform write plus an upload of the slots written since the last frame
 * (update ranges, two when the ring wrapped). Slots are reused round robin: when the pool is full the
 * oldest particle is overwritten, which caps the cost of any burst storm. Zero allocation after
 * construction.
 *
 * Shapes: spark (a streak stretched along the screen velocity that cools over its life: white hot
 * for the first SPARK_HOT_AGE, then its own orange, then red, with the HDR gain on the leading head
 * only so the bloom catches the tip while the tail keeps its colour), smoke (a generated noise blob, rotated per particle), sticker (die-cut shapes by `kind`:
 * circle, banner, diamond, star, with a white border and a flutter), star (a cross glint that
 * twinkles) and chip (a dark concrete flake, normal blending).
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, DataTexture, DynamicDrawUsage, LinearFilter, NormalBlending, Points, RGBAFormat, ShaderMaterial, type IUniform } from 'three';
import type { Rng } from '../../core/rng';

export type ParticleShape = 'spark' | 'smoke' | 'sticker' | 'star' | 'chip';

export interface ParticlePoolOptions {
  readonly capacity: number;
  readonly shape: ParticleShape;
  /** Additive (sparks, sparkles) or normal (dust, chips). */
  readonly additive: boolean;
  /** Draw order; overlays sit above. */
  readonly renderOrder?: number;
}

const SHAPE_ID: Readonly<Record<ParticleShape, number>> = { spark: 0, smoke: 1, sticker: 2, star: 3, chip: 4 };

const NOISE_SIZE = 128;
let noiseTexture: DataTexture | null = null;

/** Deterministic hash in [0, 1). */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 2D value noise in [0, 1] on a lattice of `cell` pixels. */
function valueNoise2(x: number, y: number, cell: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * The smoke puff alpha texture (generated, zero assets): four octaves of value noise under a radial
 * fade, 128 px, shared by every smoke pool. Built on first use, in plain JS so tests in node get it too.
 */
export function smokeNoiseTexture(): DataTexture {
  if (noiseTexture) return noiseTexture;
  const n = NOISE_SIZE;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      let amp = 0.5;
      let cell = 32;
      for (let o = 0; o < 4; o++) {
        v += valueNoise2(x + o * 17, y + o * 31, cell) * amp;
        amp *= 0.5;
        cell *= 0.5;
      }
      const dx = (x + 0.5) / n * 2 - 1;
      const dy = (y + 0.5) / n * 2 - 1;
      const r = Math.hypot(dx, dy);
      const fade = Math.max(0, Math.min(1, (1 - r) / 0.55));
      const a = Math.max(0, Math.min(1, (v - 0.25) * 1.9)) * fade * fade;
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  noiseTexture = tex;
  return tex;
}

const VERT = /* glsl */ `
  attribute vec3 vel;
  attribute float birth;
  attribute float life;
  attribute float size;
  attribute vec3 color;
  attribute float spin;
  attribute float kind;
  uniform float uTime;
  uniform float uGravity;
  uniform float uPixelScale;
  uniform float uShape;
  uniform float uAspect;
  varying vec4 vColor;
  varying float vAngle;
  varying float vAge;
  varying float vKind;
  varying vec2 vDir;
  void main() {
    float t = uTime - birth;
    bool alive = life > 0.0 && t >= 0.0 && t <= life;
    float u = alive ? clamp(t / life, 0.0, 1.0) : 1.0;
    vec3 p = position + vel * t;
    p.y -= 0.5 * uGravity * t * t;
    if (uShape > 1.5 && uShape < 2.5) {
      // Stickers flutter as they fall instead of sliding on a straight line.
      p.x += sin(t * 9.0 + spin) * 0.03;
      p.z += cos(t * 7.0 + spin * 0.7) * 0.03;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    // Screen-space direction of travel for the spark streak.
    vDir = vec2(0.0);
    if (uShape < 0.5) {
      vec3 vNow = vel;
      vNow.y -= uGravity * t;
      vec4 clip2 = projectionMatrix * modelViewMatrix * vec4(p + vNow * 0.02, 1.0);
      vec2 d = (clip2.xy / max(clip2.w, 0.01) - clip.xy / max(clip.w, 0.01)) * vec2(uAspect, 1.0);
      float l = length(d);
      vDir = l > 1e-5 ? d / l : vec2(0.0);
    }
    // Smoke grows and thins; sparks shrink at the end; stickers keep their size; stars pop then shrink.
    float grow = uShape < 0.5 ? (1.0 - 0.5 * u * u)
      : (uShape < 1.5 ? (0.6 + 1.5 * u)
      : (uShape < 2.5 ? 1.0
      : (uShape < 3.5 ? (0.4 + 0.8 * sin(u * 3.14159)) : (1.0 - 0.3 * u))));
    float fade = uShape < 1.5 ? (1.0 - u) : (1.0 - smoothstep(0.7, 1.0, u));
    if (uShape < 1.5 && uShape > 0.5) fade = sin(u * 3.14159);
    if (uShape > 2.5 && uShape < 3.5) fade *= 0.55 + 0.45 * sin(t * 20.0 + spin);
    vColor = vec4(color, alive ? fade : 0.0);
    vAngle = spin * t;
    vAge = u;
    vKind = kind;
    gl_PointSize = alive ? max(1.0, size * grow * uPixelScale / max(-mv.z, 0.2)) : 0.0;
    gl_Position = alive ? clip : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uShape;
  uniform float uStretch;
  uniform float uHdr;
  uniform float uBodyGain;
  uniform float uAlpha;
  uniform sampler2D uNoise;
  varying vec4 vColor;
  varying float vAngle;
  varying float vAge;
  varying float vKind;
  varying vec2 vDir;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    c.y = -c.y;
    float a;
    vec3 rgb = vColor.rgb;
    if (uShape < 0.5) {
      // Streak: an ellipse along the screen velocity, aspect uStretch. It cools over its life: white
      // hot for the first 20 percent, then the spark's own orange easing to red. The HDR gain (bloom)
      // sits on the leading head only, so the tail keeps its colour instead of clipping to white.
      vec2 e = vDir;
      float along = dot(c, e);
      float across = length(c - along * e);
      float hasDir = step(1e-4, length(e));
      float d = hasDir > 0.5 ? length(vec2(along, across * uStretch)) * 2.0 : length(c) * 2.0;
      a = smoothstep(1.0, 0.1, d);
      a *= a;
      float hot = 1.0 - smoothstep(0.0, 0.2, vAge);
      vec3 cool = mix(rgb, rgb * vec3(0.75, 0.3, 0.3), smoothstep(0.4, 1.0, vAge));
      rgb = mix(cool, vec3(1.0, 0.85, 0.55), hot);
      float head = hasDir > 0.5 ? smoothstep(-0.05, 0.3, along) : 1.0;
      float core = smoothstep(0.45, 0.0, d);
      rgb = mix(rgb, vec3(1.0, 0.92, 0.75), core * head * (0.2 + 0.5 * hot));
      rgb *= uBodyGain * mix(1.0, uHdr, core * head);
    } else if (uShape < 1.5) {
      float s = sin(vAngle);
      float co = cos(vAngle);
      vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
      a = texture2D(uNoise, r).a * uAlpha;
    } else if (uShape < 2.5) {
      float s = sin(vAngle);
      float co = cos(vAngle);
      vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y) * 2.0;
      // Die-cut shapes by kind: 0 circle, 1 banner, 2 diamond, 3 star; a signed distance in [-1, 0] inside.
      float k = floor(vKind + 0.5);
      float d;
      if (k < 0.5) d = length(r) - 0.8;
      else if (k < 1.5) d = max(abs(r.x) - 0.85, abs(r.y) - 0.45);
      else if (k < 2.5) d = abs(r.x) + abs(r.y) - 0.85;
      else {
        float ang = atan(r.y, r.x);
        float rad = 0.55 + 0.3 * pow(abs(cos(ang * 2.5)), 0.5);
        d = length(r) - rad;
      }
      if (d > 0.0) discard;
      a = 1.0;
      // White die-cut border, a second tone across the middle, no dark centre.
      float border = smoothstep(-0.2, -0.05, d);
      vec3 tone = mix(rgb, rgb * 0.75 + 0.25, step(0.0, r.y));
      rgb = mix(tone, vec3(1.0), border);
    } else if (uShape < 3.5) {
      // Cross glint with a soft centre.
      float s = sin(vAngle * 0.3);
      float co = cos(vAngle * 0.3);
      vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y);
      float g = max(0.0, 1.0 - abs(r.x) * 8.0) + max(0.0, 1.0 - abs(r.y) * 8.0);
      a = g * g * 0.35 + smoothstep(0.35, 0.0, length(r) * 2.0) * 0.8;
      a = min(a, 1.0);
      rgb = mix(rgb, vec3(1.0), smoothstep(0.3, 0.0, length(r) * 2.0) * 0.6) * uHdr;
    } else {
      // Concrete chip: a small dark flake.
      float s = sin(vAngle);
      float co = cos(vAngle);
      vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y);
      float m = max(abs(r.x) * 1.6, abs(r.y));
      if (m > 0.4) discard;
      a = uAlpha;
    }
    a *= vColor.a;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(rgb, a);
  }
`;

export class ParticlePool {
  readonly points: Points;
  readonly capacity: number;
  private readonly position: Float32Array;
  private readonly vel: Float32Array;
  private readonly birth: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly color: Float32Array;
  private readonly spin: Float32Array;
  private readonly kind: Float32Array;
  private readonly attrs: BufferAttribute[];
  private readonly material: ShaderMaterial;
  private readonly uTime: IUniform<number>;
  private readonly uGravity: IUniform<number>;
  private readonly uPixelScale: IUniform<number>;
  private readonly uAspect: IUniform<number>;
  private readonly uStretch: IUniform<number>;
  private readonly uHdr: IUniform<number>;
  private readonly uBodyGain: IUniform<number>;
  private readonly uAlpha: IUniform<number>;
  private readonly geometry: BufferGeometry;
  private next = 0;
  private time = 0;
  private aliveCount = 0;
  // Slots written since the last upload: a ring range [first, first + touched).
  private first = 0;
  private touched = 0;
  private fullUpload = true;
  /** Total particles ever spawned (tests, harness stats). */
  spawned = 0;

  constructor(options: ParticlePoolOptions) {
    const n = Math.max(1, Math.floor(options.capacity));
    this.capacity = n;
    this.position = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.birth = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    this.spin = new Float32Array(n);
    this.kind = new Float32Array(n);
    this.geometry = new BufferGeometry();
    const mk = (arr: Float32Array, item: number, name: string): BufferAttribute => {
      const a = new BufferAttribute(arr, item);
      a.setUsage(DynamicDrawUsage);
      this.geometry.setAttribute(name, a);
      return a;
    };
    this.attrs = [
      mk(this.position, 3, 'position'),
      mk(this.vel, 3, 'vel'),
      mk(this.birth, 1, 'birth'),
      mk(this.life, 1, 'life'),
      mk(this.size, 1, 'size'),
      mk(this.color, 3, 'color'),
      mk(this.spin, 1, 'spin'),
      mk(this.kind, 1, 'kind'),
    ];
    // Dead points are parked off screen by the shader; the bounding sphere is never used.
    this.geometry.boundingSphere = null;
    this.uTime = { value: 0 };
    this.uGravity = { value: 0 };
    this.uPixelScale = { value: 720 };
    this.uAspect = { value: 16 / 9 };
    this.uStretch = { value: 4 };
    this.uHdr = { value: 1 };
    this.uBodyGain = { value: 1 };
    this.uAlpha = { value: 1 };
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: this.uTime,
        uGravity: this.uGravity,
        uPixelScale: this.uPixelScale,
        uAspect: this.uAspect,
        uStretch: this.uStretch,
        uHdr: this.uHdr,
        uBodyGain: this.uBodyGain,
        uAlpha: this.uAlpha,
        uShape: { value: SHAPE_ID[options.shape] },
        uNoise: { value: options.shape === 'smoke' ? smokeNoiseTexture() : null },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: options.additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = options.renderOrder ?? 10;
  }

  /** Particles whose life has not ended at the last update (estimate kept by spawn / update). */
  get alive(): number {
    return this.aliveCount;
  }

  /**
   * Streak aspect (sparks), HDR gain (sparks: the streak head only; stars), base opacity (smoke,
   * chips) and the spark body gain (the whole streak, head and tail); read live by the caller.
   */
  setLook(stretch: number, hdr: number, alpha: number, bodyGain = 1): void {
    this.uStretch.value = stretch;
    this.uHdr.value = hdr;
    this.uAlpha.value = alpha;
    this.uBodyGain.value = bodyGain;
  }

  /**
   * Write one particle. `t0` is the pool clock at spawn (usually the current time; a negative
   * offset back-dates a particle so a burst spread over a frame looks continuous). `kind` picks the
   * sticker shape (0..3) and is free for the other shapes.
   */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    lifeS: number, sizeM: number,
    r: number, g: number, b: number,
    spinRadPerS = 0, t0 = this.time, kind = 0,
  ): void {
    const i = this.next;
    this.next = i + 1 >= this.capacity ? 0 : i + 1;
    const i3 = i * 3;
    this.position[i3] = x;
    this.position[i3 + 1] = y;
    this.position[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.birth[i] = t0;
    this.life[i] = lifeS;
    this.size[i] = sizeM;
    this.color[i3] = r;
    this.color[i3 + 1] = g;
    this.color[i3 + 2] = b;
    this.spin[i] = spinRadPerS;
    this.kind[i] = kind;
    if (this.touched === 0) this.first = i;
    if (this.touched < this.capacity) this.touched += 1;
    this.spawned += 1;
    if (this.aliveCount < this.capacity) this.aliveCount += 1;
  }

  /** Random cone burst helper: `count` particles from (x, y, z) with base velocity plus spread. */
  burst(
    rng: Rng, count: number,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, spread: number,
    lifeS: number, lifeJitter: number, sizeM: number, sizeJitter: number,
    r: number, g: number, b: number, colorJitter: number,
    spinRadPerS = 0,
  ): void {
    for (let n = 0; n < count; n++) {
      const cj = 1 + (rng.next() - 0.5) * 2 * colorJitter;
      this.spawn(
        x, y, z,
        vx + (rng.next() - 0.5) * 2 * spread,
        vy + (rng.next() - 0.5) * 2 * spread,
        vz + (rng.next() - 0.5) * 2 * spread,
        lifeS * (1 + (rng.next() - 0.5) * 2 * lifeJitter),
        sizeM * (1 + (rng.next() - 0.5) * 2 * sizeJitter),
        Math.min(1, r * cj), Math.min(1, g * cj), Math.min(1, b * cj),
        spinRadPerS === 0 ? 0 : (rng.next() - 0.5) * 2 * spinRadPerS,
      );
    }
  }

  /**
   * Mark the slots written since the last upload on every attribute (one range, or two round the
   * wrap). Ranges are only ever ADDED: the renderer clears them when it uploads, and if two updates
   * run between two renders (a hidden tab, a harness stepping several times per frame) the earlier
   * ranges must survive until then; three merges overlapping ranges itself.
   */
  private upload(): void {
    const full = this.fullUpload || this.touched >= this.capacity;
    const end = this.first + this.touched;
    for (let k = 0; k < this.attrs.length; k++) {
      const a = this.attrs[k] as BufferAttribute;
      const item = a.itemSize;
      if (full) {
        a.addUpdateRange(0, this.capacity * item);
      } else if (end <= this.capacity) {
        a.addUpdateRange(this.first * item, this.touched * item);
      } else {
        a.addUpdateRange(this.first * item, (this.capacity - this.first) * item);
        a.addUpdateRange(0, (end - this.capacity) * item);
      }
      a.needsUpdate = true;
    }
    this.fullUpload = false;
    this.touched = 0;
  }

  /** Advance the pool clock (seconds, already scaled by the caller) and upload spawns. */
  update(dtS: number, gravity: number, pixelScale: number, aspect = 16 / 9): void {
    this.time += dtS;
    this.uTime.value = this.time;
    this.uGravity.value = gravity;
    this.uPixelScale.value = pixelScale;
    this.uAspect.value = aspect;
    if (this.touched > 0 || this.fullUpload) this.upload();
    if (this.aliveCount > 0) {
      // Liveness count for stats: a linear scan over a small pool, no allocation.
      let alive = 0;
      const t = this.time;
      const life = this.life;
      const birth = this.birth;
      for (let i = 0; i < this.capacity; i++) {
        const l = life[i] as number;
        if (l > 0 && t - (birth[i] as number) <= l) alive += 1;
      }
      this.aliveCount = alive;
    }
  }

  /** Current pool clock, seconds. */
  get clock(): number {
    return this.time;
  }

  /** Slots the next update() will upload (tests). */
  get pendingSlots(): number {
    return this.fullUpload ? this.capacity : this.touched;
  }

  /** Kill every particle (run start). */
  clear(): void {
    this.life.fill(0);
    this.fullUpload = true;
    this.touched = 0;
    this.aliveCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
