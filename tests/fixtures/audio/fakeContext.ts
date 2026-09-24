// tests/fixtures/audio/fakeContext.ts (audio track): a recording stand-in for BaseAudioContext so
// node tests can run every voice, loop and song and check what they schedule: every AudioParam value
// finite, every exponential ramp target above 0, every source started and stopped in order, every
// started source connected. It makes no sound; the dev harness measures real audio (RMS) in a browser.

export class FakeParam {
  private v: number;
  private readonly ctx: FakeContext;
  readonly name: string;
  constructor(ctx: FakeContext, name: string, value: number) {
    this.ctx = ctx;
    this.name = name;
    this.v = value;
  }
  get value(): number {
    return this.v;
  }
  set value(x: number) {
    this.ctx.check(Number.isFinite(x), `${this.name}.value = ${x}`);
    this.v = x;
  }
  setValueAtTime(x: number, t: number): this {
    this.ctx.check(Number.isFinite(x) && Number.isFinite(t) && t >= 0, `${this.name}.setValueAtTime(${x}, ${t})`);
    return this;
  }
  linearRampToValueAtTime(x: number, t: number): this {
    this.ctx.check(Number.isFinite(x) && Number.isFinite(t) && t >= 0, `${this.name}.linearRamp(${x}, ${t})`);
    return this;
  }
  exponentialRampToValueAtTime(x: number, t: number): this {
    this.ctx.check(Number.isFinite(x) && x > 0 && Number.isFinite(t) && t >= 0, `${this.name}.expRamp(${x}, ${t})`);
    return this;
  }
  setTargetAtTime(x: number, t: number, tc: number): this {
    this.ctx.check(Number.isFinite(x) && Number.isFinite(t) && t >= 0 && Number.isFinite(tc) && tc > 0, `${this.name}.setTarget(${x}, ${t}, ${tc})`);
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.ctx.check(Number.isFinite(t), `${this.name}.cancel(${t})`);
    return this;
  }
}

export class FakeNode {
  readonly outputs: (FakeNode | FakeParam)[] = [];
  protected readonly ctx: FakeContext;
  readonly kind: string;
  constructor(ctx: FakeContext, kind: string) {
    this.ctx = ctx;
    this.kind = kind;
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    this.ctx.check(dest !== undefined && dest !== null, `${this.kind}.connect(undefined)`);
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
  protected param(name: string, value: number): FakeParam {
    return new FakeParam(this.ctx, `${this.kind}.${name}`, value);
  }
}

class FakeGain extends FakeNode {
  readonly gain = this.param('gain', 1);
  constructor(ctx: FakeContext) {
    super(ctx, 'gain');
  }
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = this.param('frequency', 350);
  readonly Q = this.param('Q', 1);
  readonly gain = this.param('gain', 0);
  readonly detune = this.param('detune', 0);
  constructor(ctx: FakeContext) {
    super(ctx, 'biquad');
  }
}

class FakeShaper extends FakeNode {
  private c: Float32Array | null = null;
  constructor(ctx: FakeContext) {
    super(ctx, 'shaper');
  }
  get curve(): Float32Array | null {
    return this.c;
  }
  set curve(c: Float32Array | null) {
    this.ctx.check(c === null || Array.from(c).every(Number.isFinite), 'shaper.curve has a non-finite value');
    this.c = c;
  }
}

class FakeCompressor extends FakeNode {
  readonly threshold = this.param('threshold', -24);
  readonly knee = this.param('knee', 30);
  readonly ratio = this.param('ratio', 12);
  readonly attack = this.param('attack', 0.003);
  readonly release = this.param('release', 0.25);
  constructor(ctx: FakeContext) {
    super(ctx, 'compressor');
  }
}

export class FakeSource extends FakeNode {
  startT: number | null = null;
  stopT: number | null = null;
  onended: (() => void) | null = null;
  constructor(ctx: FakeContext, kind: string) {
    super(ctx, kind);
    ctx.sources.push(this);
  }
  start(t = 0, offset = 0): void {
    this.ctx.check(this.startT === null, `${this.kind} started twice`);
    this.ctx.check(Number.isFinite(t) && t >= 0 && Number.isFinite(offset) && offset >= 0, `${this.kind}.start(${t}, ${offset})`);
    this.startT = t;
  }
  stop(t = 0): void {
    this.ctx.check(this.startT !== null, `${this.kind} stopped before start`);
    this.ctx.check(Number.isFinite(t) && t >= (this.startT ?? 0), `${this.kind}.stop(${t}) before start ${this.startT}`);
    this.stopT = t;
  }
}

class FakeOsc extends FakeSource {
  type = 'sine';
  readonly frequency = this.param('frequency', 440);
  readonly detune = this.param('detune', 0);
  constructor(ctx: FakeContext) {
    super(ctx, 'osc');
  }
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = this.param('playbackRate', 1);
  constructor(ctx: FakeContext) {
    super(ctx, 'bufferSource');
  }
}

export class FakeContext {
  currentTime = 0;
  readonly sampleRate = 8000;
  state: 'running' | 'suspended' | 'closed' = 'running';
  readonly nodes: FakeNode[] = [];
  readonly sources: FakeSource[] = [];
  readonly problems: string[] = [];
  readonly destination: FakeNode;

  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }

  check(ok: boolean, what: string): void {
    if (!ok && this.problems.length < 50) this.problems.push(what);
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }
  createOscillator(): FakeOsc {
    return new FakeOsc(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createMediaElementSource(): FakeNode {
    return new FakeNode(this, 'mediaElement');
  }
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(i: number): Float32Array; copyToChannel(src: Float32Array, i: number): void; length: number; sampleRate: number } {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      sampleRate,
      getChannelData: (i: number) => data[i] as Float32Array,
      copyToChannel: (src: Float32Array, i: number) => {
        this.check(Array.from(src).every(Number.isFinite), 'buffer data has a non-finite sample');
        (data[i] as Float32Array).set(src);
      },
    };
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Started sources that connect to nothing (they would be silent). */
  danglingSources(): FakeSource[] {
    return this.sources.filter((s) => s.startT !== null && s.outputs.length === 0);
  }

  /** Every started source must reach `target` through connections (params count as dead ends). */
  unreached(target: FakeNode): FakeSource[] {
    const reaches = new Map<FakeNode, boolean>();
    const visit = (n: FakeNode, depth: number): boolean => {
      if (n === target) return true;
      const hit = reaches.get(n);
      if (hit !== undefined) return hit;
      if (depth > 64) return false;
      reaches.set(n, false);
      const ok = n.outputs.some((o) => o instanceof FakeNode && visit(o, depth + 1));
      reaches.set(n, ok);
      return ok;
    };
    // LFOs modulate params, not audio paths: skip sources whose only outputs feed params through gains.
    return this.sources.filter((s) => s.startT !== null && !visit(s, 0) && !feedsParamOnly(s));
  }

  /** Cast for APIs typed as BaseAudioContext / AudioContext. */
  get asAudio(): AudioContext {
    return this as unknown as AudioContext;
  }
}

function feedsParamOnly(n: FakeNode, depth = 0): boolean {
  if (depth > 8 || n.outputs.length === 0) return false;
  return n.outputs.every((o) => o instanceof FakeParam || (o instanceof FakeNode && feedsParamOnly(o, depth + 1)));
}
