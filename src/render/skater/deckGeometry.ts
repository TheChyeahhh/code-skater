/**
 * src/render/skater/deckGeometry.ts (skater track): the deck mesh (REQ-SKT-02): a popsicle outline
 * with rounded nose and tail, raised kicks at both ends, concave across the width, a plywood edge.
 * DOM-free (node-testable). Local frame: -z nose, +z tail, +x right, y up; the deck TOP centre is
 * the origin (the feet stand at y = 0), the deck hangs below.
 *
 * Groups: 0 = top (grip), 1 = bottom (graphic + stickers), 2 = edge (plywood plies).
 * UV on top and bottom: u = 0 tail .. 1 nose, v = 0 .. 1 across (StickerPlacement coordinates).
 */

import { BufferAttribute, BufferGeometry } from 'three';

export const DECK = {
  length: 0.82,
  width: 0.21,
  /** Arcade-thick (a real deck is 12 mm): the plywood edge must read from the 4.2 m chase camera. */
  thickness: 0.02,
  noseKick: 0.065,
  tailKick: 0.055,
  noseZone: 0.17,
  tailZone: 0.15,
  concave: 0.011,
  /** Axle centre distance from the deck centre along z. */
  truckZ: 0.18,
  /** Truck stack: deck bottom to axle centre. */
  truckHeight: 0.053,
  /** Oversized a touch (real: 26 to 28 mm) so the wheels read at chase distance. */
  wheelRadius: 0.033,
  wheelWidth: 0.04,
  /** Axle half length (wheel centre from the deck centre line). */
  axleHalf: 0.083,
} as const;

/** Deck top height above the wheel contact: wheel radius + truck stack + thickness. */
export const DECK_STACK_HEIGHT = DECK.wheelRadius + DECK.truckHeight + DECK.thickness;

/** Half-width of the outline at t (0 tail .. 1 nose). */
export function deckHalfWidth(t: number): number {
  const L = DECK.length;
  const s = t * L;
  const fromTail = s;
  const fromNose = L - s;
  const hw = DECK.width / 2;
  const round = (dist: number, zone: number): number => {
    if (dist >= zone) return 1;
    const k = 1 - dist / zone;
    return Math.sqrt(Math.max(0, 1 - Math.pow(k, 2.6)));
  };
  return hw * Math.min(round(fromTail, DECK.tailZone), round(fromNose, DECK.noseZone));
}

/** Kick height along the length at t (0 tail .. 1 nose): flat in the middle, rising at both ends. */
export function deckKick(t: number): number {
  const L = DECK.length;
  const s = t * L;
  const rise = (dist: number, zone: number, h: number): number => {
    if (dist >= zone) return 0;
    const k = 1 - dist / zone;
    return h * k * k;
  };
  return rise(s, DECK.tailZone + 0.06, DECK.tailKick) + rise(L - s, DECK.noseZone + 0.06, DECK.noseKick);
}

/** Top-surface height at (t, across in -1 .. 1): kick plus the concave (edges at the kick height, centre lower). */
export function deckTopY(t: number, across: number): number {
  return deckKick(t) - DECK.concave * (1 - across * across);
}

/** Skater-frame deck-top point for a (x, z) foot placement on the deck (x clamped to the outline). */
export function deckSurfaceAt(x: number, z: number): { x: number; y: number; z: number } {
  const t = Math.min(1, Math.max(0, 0.5 - z / DECK.length));
  const hw = Math.max(1e-3, deckHalfWidth(t));
  const cx = Math.min(hw, Math.max(-hw, x));
  return { x: cx, y: deckTopY(t, cx / hw), z };
}

export interface DeckGeometryOptions {
  readonly rows?: number;
  readonly cols?: number;
}

export function createDeckGeometry(opts: DeckGeometryOptions = {}): BufferGeometry {
  const N = opts.rows ?? 30;
  const M = opts.cols ?? 8;
  const L = DECK.length;
  const T = DECK.thickness;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groups: { start: number; count: number; material: number }[] = [];

  const push = (x: number, y: number, z: number, u: number, v: number): number => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  const surface = (yOffset: number, flip: boolean): number => {
    const base = positions.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const z = L / 2 - t * L;
      const hw = deckHalfWidth(t);
      for (let j = 0; j <= M; j++) {
        const a = (j / M) * 2 - 1;
        push(a * hw, deckTopY(t, a) + yOffset, z, t, j / M);
      }
    }
    const start = indices.length;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = base + i * (M + 1) + j;
        const b = a + 1;
        const c = a + (M + 1);
        const d = c + 1;
        // Top faces +y with (a, b, c)(b, d, c); the bottom is wound the other way.
        if (flip) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
    return start;
  };
  // Top.
  const topStart = surface(0, false);
  groups.push({ start: topStart, count: indices.length - topStart, material: 0 });
  // Bottom.
  const bottomStart = surface(-T, true);
  groups.push({ start: bottomStart, count: indices.length - bottomStart, material: 1 });
  // Edge ring: walk the outline (tail row j=0..M, nose side, back) with its own vertices.
  const ring: { t: number; a: number }[] = [];
  for (let j = 0; j <= M; j++) ring.push({ t: 0, a: (j / M) * 2 - 1 });
  for (let i = 1; i <= N; i++) ring.push({ t: i / N, a: 1 });
  for (let j = M - 1; j >= 0; j--) ring.push({ t: 1, a: (j / M) * 2 - 1 });
  for (let i = N - 1; i >= 1; i--) ring.push({ t: i / N, a: -1 });
  const ringBase = positions.length / 3;
  const R = ring.length;
  for (let k = 0; k < R; k++) {
    const { t, a } = ring[k] as { t: number; a: number };
    const hw = deckHalfWidth(t);
    const z = L / 2 - t * L;
    const y = deckTopY(t, a);
    const u = k / R;
    push(a * hw, y, z, u * 6, 1);
    push(a * hw, y - T, z, u * 6, 0);
  }
  const edgeStart = indices.length;
  for (let k = 0; k < R; k++) {
    const k2 = (k + 1) % R;
    const a = ringBase + k * 2;
    const b = a + 1;
    const c = ringBase + k2 * 2;
    const d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  groups.push({ start: edgeStart, count: indices.length - edgeStart, material: 2 });

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  for (const gr of groups) geo.addGroup(gr.start, gr.count, gr.material);
  geo.computeVertexNormals();
  // The ring's normals must point outward; computeVertexNormals on the ring alone gives that when
  // the winding is consistent, and the flipped bottom faces its own way. Check one edge quad's
  // winding sign and flip the whole ring if it faces inward.
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const k0 = ringBase + Math.floor(R / 4) * 2; // a point on the +x side
  if (nrm.getX(k0) * pos.getX(k0) < 0) {
    const idx = geo.getIndex();
    if (idx) {
      for (let i = edgeStart; i < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, b);
      }
      geo.computeVertexNormals();
    }
  }
  geo.computeBoundingBox();
  return geo;
}
