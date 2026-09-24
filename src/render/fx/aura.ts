/**
 * src/render/fx/aura.ts (fx track): the special-glow aura around the skater while the meter glows
 * (REQ-FX-02, REQ-SPC-03): a camera-facing radial glow quad plus a soft radial ground glow (no hard
 * band, so it never reads as a selection ring), additive so the render track's bloom picks it up.
 * Strength eases in on specialReady and out on specialEmptied; pop() brightens it for a moment so
 * the meter filling is an event.
 *
 * Both quads follow the skater's auto-oriented up axis (on a quarter-pipe wall the body sticks out of
 * the wall, so a world-up offset would park the glow on the concrete). The vertex shader then moves
 * every vertex along its own eye ray, scaling about the eye so the screen footprint is unchanged: only
 * the depth moves. How far depends on the vertex's radius in the quad (the quads are subdivided so the
 * profile is smooth): the core (radius under uCoreR) sits uCoreBack metres BEHIND the quad's centre, so
 * the body in front of it passes the depth test and the glow never washes over the skater, and from
 * uRimR out the rim slides toward the camera by uPush, so a floor or wall inside the soft falloff no longer slices it
 * into a hard edge. Anything truly between the camera and the skater still hides it.
 */

import { AdditiveBlending, Color, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type IUniform, type Quaternion } from 'three';

/** Plain xyz, so callers pass snapshot vectors without allocating. */
export interface AuraVec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const BILLBOARD_VERT = /* glsl */ `
  uniform float uPush;
  uniform float uCoreBack;
  uniform float uCoreR;
  uniform float uRimR;
  uniform float uMinView;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
    float push = mix(-uCoreBack, uPush, smoothstep(uCoreR, uRimR, length(position.xy)));
    float k = d > 1e-4 ? max(d - push, uMinView) / d : 1.0;
    gl_Position = projectionMatrix * vec4(mv.xyz * k, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uPulse;
  uniform float uPop;
  varying vec2 vUv;
  void main() {
    if (uStrength <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float glow = smoothstep(1.0, 0.0, r);
    glow = glow * glow * (0.55 + 0.45 * uPulse);
    float a = glow * uStrength * 0.55 * uPop;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), glow * 0.35) * uPop, a);
  }
`;

const GROUND_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uPulse;
  uniform float uPop;
  varying vec2 vUv;
  void main() {
    if (uStrength <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float g = smoothstep(1.0, 0.2, r);
    float a = g * g * 0.35 * uStrength * (0.92 + 0.08 * uPulse) * uPop;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(uColor * uPop, a);
  }
`;

/** PlaneGeometry faces +z; the ground glow turns that normal onto the skater's up axis. */
const PLANE_NORMAL = new Vector3(0, 0, 1);
/** Quad subdivisions: enough vertices for the radial depth profile to read as a smooth curve. */
const QUAD_SEGMENTS = 16;

export class SpecialAura {
  readonly group = new Group();
  private readonly glow: Mesh;
  private readonly ground: Mesh;
  private readonly glowMat: ShaderMaterial;
  private readonly groundMat: ShaderMaterial;
  private readonly uStrength: IUniform<number>;
  private readonly uPulse: IUniform<number>;
  private readonly uPop: IUniform<number>;
  private readonly uColor: IUniform<Color>;
  private readonly uGlowPush: IUniform<number>;
  private readonly uGroundPush: IUniform<number>;
  private readonly uCoreBack: IUniform<number>;
  private readonly uCoreR: IUniform<number>;
  private readonly uRimR: IUniform<number>;
  private readonly uGroundCoreR: IUniform<number>;
  private readonly uMinView: IUniform<number>;
  private readonly upV = new Vector3(0, 1, 0);
  private time = 0;
  private popT = -1;
  private popPeak = 1;
  private popS = 0.15;

  constructor(color: string) {
    this.uStrength = { value: 0 };
    this.uPulse = { value: 0 };
    this.uPop = { value: 1 };
    this.uColor = { value: new Color(color) };
    this.uGlowPush = { value: 0 };
    this.uGroundPush = { value: 0 };
    this.uCoreBack = { value: 0 };
    this.uCoreR = { value: 0.5 };
    this.uRimR = { value: 0.85 };
    this.uGroundCoreR = { value: 0.6 };
    this.uMinView = { value: 0 };
    const shared = { uColor: this.uColor, uStrength: this.uStrength, uPulse: this.uPulse, uPop: this.uPop, uMinView: this.uMinView };
    this.glowMat = new ShaderMaterial({
      vertexShader: BILLBOARD_VERT, fragmentShader: GLOW_FRAG, uniforms: { ...shared, uPush: this.uGlowPush, uCoreBack: this.uCoreBack, uCoreR: this.uCoreR, uRimR: this.uRimR },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    // The ground glow lies on the floor: its core stays at raw depth (pushed back it would sink into the
    // concrete) and its push only builds from uGroundCoreR to the disc's edge, so the part of the disc
    // behind the feet (on screen: over the legs) stays behind the legs; the rim still clears a curved
    // transition.
    this.groundMat = new ShaderMaterial({
      vertexShader: BILLBOARD_VERT, fragmentShader: GROUND_FRAG, uniforms: { ...shared, uPush: this.uGroundPush, uCoreBack: { value: 0 }, uCoreR: this.uGroundCoreR, uRimR: { value: 1 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.glow = new Mesh(new PlaneGeometry(2, 2, QUAD_SEGMENTS, QUAD_SEGMENTS), this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 15;
    this.ground = new Mesh(new PlaneGeometry(2, 2, QUAD_SEGMENTS, QUAD_SEGMENTS), this.groundMat);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = 14;
    this.group.add(this.glow, this.ground);
    this.group.visible = false;
  }

  get strength(): number {
    return this.uStrength.value;
  }

  /** Brightness multiplier from the last pop (1 when idle). */
  get pop(): number {
    return this.uPop.value;
  }

  setColor(hex: string): void {
    this.uColor.value.set(hex);
  }

  /** World position of the camera-facing glow quad (read by tests and the dev harness). */
  get glowCenter(): Readonly<Vector3> {
    return this.glow.position;
  }

  /** Metres the glow quad's rim is slid toward the camera in the vertex shader (0 = raw depth). */
  get depthPushM(): number {
    return this.uGlowPush.value;
  }

  /** Metres the glow quad's core sits behind the body centre, so the skater stays in front of it. */
  get coreBackM(): number {
    return this.uCoreBack.value;
  }

  /** Brighten to `peak` and ease back to 1 over durationS (specialReady). */
  firePop(peak: number, durationS: number): void {
    this.popPeak = peak;
    this.popS = Math.max(1e-3, durationS);
    this.popT = 0;
  }

  /**
   * Follow the skater: feet at pos, body along the auto-oriented up axis, camera quaternion for the
   * billboard. strengthTarget 1 while glowing, eased at 1 / fadeS per second; radius, pulse rate,
   * the rim depth push (a share of each quad's radius), the closest eye distance it may reach, the
   * core's distance behind the body, the core radius, the full-push radius and the ground glow's
   * core radius (shares of each quad's radius) live.
   */
  update(
    dtS: number, pos: AuraVec, up: AuraVec, bodyH: number, camQuat: Quaternion,
    strengthTarget: number, fadeS: number, radiusM: number, pulseHz: number, pushRatio: number, minViewM: number,
    coreBackM = 0, coreRatio = 0.5, rimRatio = 0.85, groundCoreRatio = 0.6,
  ): void {
    this.time += dtS;
    const step = dtS / Math.max(1e-3, fadeS);
    const s = this.uStrength.value;
    const d = strengthTarget - s;
    this.uStrength.value = Math.abs(d) <= step ? strengthTarget : s + Math.sign(d) * step;
    if (this.popT >= 0) {
      this.popT += dtS;
      const u = this.popT / this.popS;
      if (u >= 1) {
        this.popT = -1;
        this.uPop.value = 1;
      } else {
        this.uPop.value = 1 + (this.popPeak - 1) * (1 - u) * (1 - u);
      }
    }
    const on = this.uStrength.value > 0.002;
    this.group.visible = on;
    if (!on) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * pulseHz * 2 * Math.PI);
    this.uPulse.value = pulse;
    const u = this.upV.set(up.x, up.y, up.z);
    if (u.lengthSq() < 1e-8) u.set(0, 1, 0);
    else u.normalize();
    this.glow.position.set(pos.x + u.x * bodyH * 0.55, pos.y + u.y * bodyH * 0.55, pos.z + u.z * bodyH * 0.55);
    this.glow.quaternion.copy(camQuat);
    const gs = radiusM * (1 + 0.08 * pulse);
    this.glow.scale.set(gs, gs, gs);
    this.ground.position.set(pos.x + u.x * 0.02, pos.y + u.y * 0.02, pos.z + u.z * 0.02);
    this.ground.quaternion.setFromUnitVectors(PLANE_NORMAL, u);
    const rs = radiusM * 0.9 * (1 + 0.08 * pulse);
    this.ground.scale.set(rs, rs, rs);
    const push = Math.max(0, pushRatio);
    this.uGlowPush.value = gs * push;
    this.uGroundPush.value = rs * push;
    this.uMinView.value = Math.max(0, minViewM);
    this.uCoreBack.value = Math.max(0, coreBackM);
    this.uCoreR.value = Math.max(0, Math.min(0.98, coreRatio));
    this.uRimR.value = Math.max(this.uCoreR.value + 0.01, Math.min(1, rimRatio));
    this.uGroundCoreR.value = Math.max(0, Math.min(0.98, groundCoreRatio));
  }

  dispose(): void {
    this.glow.geometry.dispose();
    this.ground.geometry.dispose();
    this.glowMat.dispose();
    this.groundMat.dispose();
  }
}
