/**
 * src/core/rng.ts: the seedable RNG (REQ-CTL-16). The sim never calls Math.random (eslint bans it
 * in src/sim/**); it owns one Rng created from WorldConfig.seed, so a run replays exactly from
 * (seed, input frames). Render-side effects may use their own Rng for seeded sparks.
 *
 * Algorithm: mulberry32 (32-bit state, fast, good enough for gameplay coin flips).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** +1 or -1 with equal probability. */
  sign(): 1 | -1;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Current internal state, for snapshots and replay. */
  readonly state: number;
  /** Independent copy with the same state. */
  clone(): Rng;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    sign: () => (next() < 0.5 ? -1 : 1),
    range: (lo, hi) => lo + (hi - lo) * next(),
    get state() {
      return s;
    },
    clone: () => createRng(s),
  };
  return rng;
}
