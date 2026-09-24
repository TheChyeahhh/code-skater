/**
 * src/render/fx/ribbon.ts (fx track): a fixed-capacity fading strip through the last N samples
 * pushed into it (REQ-FX-02). Two modes:
 * - line (default): push(x, y, z) samples become a camera-facing triangle strip of a given width
 *   (the green light ribbon the special grind leaves on the rail);
 * - pair: pushPair(nose, tail) samples become a quad strip between the two edge rings, so the strip
 *   reads as a ghost of the deck (the board motion trail during specials).
 * Alpha fades by sample age over a fade time the caller reads from TUNING; colour is written above
 * 1 by the HDR gain so the render track's bloom catches it. Preallocated buffers, no allocation per
 * frame.
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';

const VERT = /* glsl */ `
  attribute float aAlpha;
  attribute float aSide;
  varying float vAlpha;
  varying float vSide;
  void main() {
    vAlpha = aAlpha;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uHdr;
  varying float vAlpha;
  varying float vSide;
  void main() {
    float edge = 1.0 - vSide * vSide;
    float core = smoothstep(0.55, 0.0, abs(vSide));
    float a = vAlpha * uOpacity * edge;
    if (a <= 0.003) discard;
    vec3 rgb = mix(uColor, vec3(1.0), core * 0.45) * uHdr;
    gl_FragColor = vec4(rgb, a);
  }
`;

export class Ribbon {
  readonly mesh: Mesh;
  readonly capacity: number;
  readonly pair: boolean;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  // Second edge (pair mode).
  private readonly qx: Float32Array;
  private readonly qy: Float32Array;
  private readonly qz: Float32Array;
  private readonly born: Float32Array;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly alphaAttr: BufferAttribute;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly uColor: IUniform<Color>;
  private readonly uOpacity: IUniform<number>;
  private readonly uHdr: IUniform<number>;
  private head = 0; // next write slot
  private count = 0; // samples held (<= capacity)
  private time = 0;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly dir = new Vector3();
  private readonly toCam = new Vector3();
  private readonly sideV = new Vector3();
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastZ = Number.NaN;
  private tipAlpha = 1;

  constructor(capacity: number, color: string, renderOrder = 20, pair = false) {
    const n = Math.max(4, Math.floor(capacity));
    this.capacity = n;
    this.pair = pair;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.qx = new Float32Array(pair ? n : 0);
    this.qy = new Float32Array(pair ? n : 0);
    this.qz = new Float32Array(pair ? n : 0);
    this.born = new Float32Array(n);
    this.positions = new Float32Array(n * 2 * 3);
    this.alphas = new Float32Array(n * 2);
    const sides = new Float32Array(n * 2);
    const index = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n; i++) {
      sides[i * 2] = -1;
      sides[i * 2 + 1] = 1;
    }
    for (let i = 0; i < n - 1; i++) {
      const o = i * 6;
      const v = i * 2;
      index[o] = v;
      index[o + 1] = v + 1;
      index[o + 2] = v + 2;
      index[o + 3] = v + 1;
      index[o + 4] = v + 3;
      index[o + 5] = v + 2;
    }
    this.geometry = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.alphaAttr = new BufferAttribute(this.alphas, 1);
    this.alphaAttr.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aSide', new BufferAttribute(sides, 1));
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = null;
    this.uColor = { value: new Color(color) };
    this.uOpacity = { value: 1 };
    this.uHdr = { value: 1 };
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: this.uColor, uOpacity: this.uOpacity, uHdr: this.uHdr },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  /** Samples currently held. */
  get samples(): number {
    return this.count;
  }

  get color(): Color {
    return this.uColor.value;
  }

  setColor(hex: string): void {
    this.uColor.value.set(hex);
  }

  setOpacity(o: number): void {
    this.uOpacity.value = o;
  }

  /** Colour gain above 1 for the bloom, and the alpha of the newest sample. */
  setLook(hdr: number, tipAlpha: number): void {
    this.uHdr.value = hdr;
    this.tipAlpha = tipAlpha;
  }

  /** Add a sample at the ribbon clock; samples closer than minStep to the last one are skipped. */
  push(x: number, y: number, z: number, minStep = 0.02): void {
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const dz = z - this.lastZ;
    if (this.count > 0 && dx * dx + dy * dy + dz * dz < minStep * minStep) {
      // Refresh the head sample's age so a slow board keeps a bright tip.
      const h = (this.head - 1 + this.capacity) % this.capacity;
      this.born[h] = this.time;
      return;
    }
    const i = this.head;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.born[i] = this.time;
    this.head = i + 1 >= this.capacity ? 0 : i + 1;
    if (this.count < this.capacity) this.count += 1;
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;
  }

  /** Pair mode: add a nose / tail sample (the centre decides the minStep skip). */
  pushPair(nx: number, ny: number, nz: number, tx: number, ty: number, tz: number, minStep = 0.02): void {
    if (!this.pair) {
      this.push((nx + tx) * 0.5, (ny + ty) * 0.5, (nz + tz) * 0.5, minStep);
      return;
    }
    const cx = (nx + tx) * 0.5;
    const cy = (ny + ty) * 0.5;
    const cz = (nz + tz) * 0.5;
    const dx = cx - this.lastX;
    const dy = cy - this.lastY;
    const dz = cz - this.lastZ;
    if (this.count > 0 && dx * dx + dy * dy + dz * dz < minStep * minStep) {
      const h = (this.head - 1 + this.capacity) % this.capacity;
      this.born[h] = this.time;
      return;
    }
    const i = this.head;
    this.px[i] = nx;
    this.py[i] = ny;
    this.pz[i] = nz;
    this.qx[i] = tx;
    this.qy[i] = ty;
    this.qz[i] = tz;
    this.born[i] = this.time;
    this.head = i + 1 >= this.capacity ? 0 : i + 1;
    if (this.count < this.capacity) this.count += 1;
    this.lastX = cx;
    this.lastY = cy;
    this.lastZ = cz;
  }

  /** Forget every sample (run start, teleport). */
  clear(): void {
    this.count = 0;
    this.head = 0;
    this.lastX = Number.NaN;
    this.lastY = Number.NaN;
    this.lastZ = Number.NaN;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * Advance the clock and rebuild the strip: width metres (line mode), samples older than fadeS
   * vanish, camPos orients a line strip to face the camera.
   */
  update(dtS: number, widthM: number, fadeS: number, camPos: Vector3): void {
    this.time += dtS;
    if (this.count === 0) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    // Drop dead samples from the tail (oldest first).
    const fade = Math.max(1e-3, fadeS);
    while (this.count > 0) {
      const tail = (this.head - this.count + this.capacity) % this.capacity;
      if (this.time - (this.born[tail] as number) > fade) this.count -= 1;
      else break;
    }
    if (this.count < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const half = widthM * 0.5;
    const n = this.count;
    for (let k = 0; k < n; k++) {
      const i = (this.head - n + k + this.capacity) % this.capacity;
      const age = this.time - (this.born[i] as number);
      // Tip stays wide and bright; the tail thins to nothing.
      const life = 1 - Math.min(1, age / fade);
      const o = k * 6;
      if (this.pair) {
        this.positions[o] = this.px[i] as number;
        this.positions[o + 1] = this.py[i] as number;
        this.positions[o + 2] = this.pz[i] as number;
        this.positions[o + 3] = this.qx[i] as number;
        this.positions[o + 4] = this.qy[i] as number;
        this.positions[o + 5] = this.qz[i] as number;
      } else {
        const iNext = (this.head - n + Math.min(k + 1, n - 1) + this.capacity) % this.capacity;
        const iPrev = (this.head - n + Math.max(k - 1, 0) + this.capacity) % this.capacity;
        this.a.set(this.px[iPrev] as number, this.py[iPrev] as number, this.pz[iPrev] as number);
        this.b.set(this.px[iNext] as number, this.py[iNext] as number, this.pz[iNext] as number);
        this.dir.subVectors(this.b, this.a);
        const x = this.px[i] as number;
        const y = this.py[i] as number;
        const z = this.pz[i] as number;
        this.toCam.set(camPos.x - x, camPos.y - y, camPos.z - z);
        this.sideV.crossVectors(this.dir, this.toCam);
        if (this.sideV.lengthSq() < 1e-9) this.sideV.set(1, 0, 0);
        else this.sideV.normalize();
        const w = half * (0.25 + 0.75 * life);
        this.positions[o] = x - this.sideV.x * w;
        this.positions[o + 1] = y - this.sideV.y * w;
        this.positions[o + 2] = z - this.sideV.z * w;
        this.positions[o + 3] = x + this.sideV.x * w;
        this.positions[o + 4] = y + this.sideV.y * w;
        this.positions[o + 5] = z + this.sideV.z * w;
      }
      const a = life * this.tipAlpha;
      this.alphas[k * 2] = a;
      this.alphas[k * 2 + 1] = a;
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
