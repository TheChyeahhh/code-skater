/**
 * src/render/fx/glow.ts (fx track): small additive flares (REQ-FX-01, REQ-FX-02): a camera-facing
 * radial glow or a flat ground ring, positioned and sized per frame. Used for the grind contact hot
 * spot, the grind snap flash, the landing impact ring and the pickup ring. One quad each, no
 * allocation per frame; hidden when alpha is 0.
 */

import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial, type IUniform, type Quaternion } from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uHdr;
  varying vec2 vUv;
  void main() {
    if (uAlpha <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float g = smoothstep(1.0, 0.0, r);
    g *= g;
    float a = g * uAlpha;
    if (a <= 0.003) discard;
    vec3 rgb = mix(uColor, vec3(1.0), smoothstep(0.5, 0.0, r) * 0.7) * uHdr;
    gl_FragColor = vec4(rgb, a);
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uHdr;
  varying vec2 vUv;
  void main() {
    if (uAlpha <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float band = smoothstep(0.14, 0.0, abs(r - 0.86));
    float a = band * uAlpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor * uHdr, a);
  }
`;

export class Flare {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly uColor: IUniform<Color>;
  private readonly uAlpha: IUniform<number>;
  private readonly uHdr: IUniform<number>;
  private readonly ground: boolean;

  constructor(kind: 'glow' | 'ring', color: string, renderOrder: number, ground: boolean) {
    this.uColor = { value: new Color(color) };
    this.uAlpha = { value: 0 };
    this.uHdr = { value: 1 };
    this.ground = ground;
    this.material = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: kind === 'glow' ? GLOW_FRAG : RING_FRAG,
      uniforms: { uColor: this.uColor, uAlpha: this.uAlpha, uHdr: this.uHdr },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    if (ground) this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
  }

  get alpha(): number {
    return this.uAlpha.value;
  }

  setColor(hex: string): void {
    this.uColor.value.set(hex);
  }

  /** Place the flare: diameter sizeM, opacity alpha, HDR gain; a billboard takes the camera quaternion. */
  set(x: number, y: number, z: number, sizeM: number, alpha: number, hdr: number, camQuat: Quaternion | null): void {
    this.uAlpha.value = alpha;
    this.uHdr.value = hdr;
    const on = alpha > 0.002;
    this.mesh.visible = on;
    if (!on) return;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(sizeM, sizeM, sizeM);
    if (!this.ground && camQuat) this.mesh.quaternion.copy(camQuat);
  }

  hide(): void {
    this.uAlpha.value = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** A one-shot flare animation: size and alpha lerp from start to end over durationS, then hides. */
export class FlareShot {
  readonly flare: Flare;
  private t = -1;
  private durationS = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  private size0 = 0;
  private size1 = 0;
  private alpha0 = 0;
  private alpha1 = 0;
  private hdr = 1;

  constructor(flare: Flare) {
    this.flare = flare;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  fire(x: number, y: number, z: number, size0: number, size1: number, alpha0: number, alpha1: number, durationS: number, hdr = 1): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.size0 = size0;
    this.size1 = size1;
    this.alpha0 = alpha0;
    this.alpha1 = alpha1;
    this.durationS = Math.max(1e-3, durationS);
    this.hdr = hdr;
    this.t = 0;
    this.flare.set(x, y, z, size0, alpha0, hdr, null);
  }

  update(dtS: number, camQuat: Quaternion): void {
    if (this.t < 0) return;
    this.t += dtS;
    const u = this.t / this.durationS;
    if (u >= 1) {
      this.t = -1;
      this.flare.hide();
      return;
    }
    // Ease out: fast growth first.
    const e = 1 - (1 - u) * (1 - u);
    this.flare.set(this.x, this.y, this.z, this.size0 + (this.size1 - this.size0) * e, this.alpha0 + (this.alpha1 - this.alpha0) * u, this.hdr, camQuat);
  }

  clear(): void {
    this.t = -1;
    this.flare.hide();
  }
}
