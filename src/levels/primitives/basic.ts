/**
 * src/levels/primitives/basic.ts (levels track): ground, box, building, ledge, billboard, prop.
 * Ground pieces are cut by every sunken footprint below them (lib/context.ts holes), rendered on a
 * fine grid for contact AO and collided on a coarse grid.
 */

import { TUNING } from '../../core/tuning';
import type { Facing, Vec3 } from '../../core/types';
import type { BillboardPrim, BoxPrim, BuildingPrim, GroundPrim, LedgePrim, PropPrim } from '../types';
import { groundAo } from '../lib/context';
import { UP } from '../lib/derive';
import { face, withStyle } from '../lib/emit';
import { type P2, rectPoly, rectsOverlap, subtractAll } from '../lib/poly2d';
import { orientedBox, post, type PrimCtx, solidBox, styleOf } from './common';

// ---------------------------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------------------------

export function buildGround(p: GroundPrim, ctx: PrimCtx): void {
  const holes = ctx.holes.filter((h) => h.primId !== p.id && h.lowY < p.y - 0.01 && rectsOverlap(h.bbox, p.rect));
  const s = styleOf(p, ctx, 'surface', 'solid', { castShadow: false });
  const tile = (cell: number, render: boolean): void => {
    const r = p.rect;
    const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / cell - 1e-9));
    const nz = Math.max(1, Math.ceil((r.z1 - r.z0) / cell - 1e-9));
    const style = withStyle(s, render ? { collide: false } : { render: false });
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const c = {
          x0: r.x0 + ((r.x1 - r.x0) * i) / nx,
          x1: r.x0 + ((r.x1 - r.x0) * (i + 1)) / nx,
          z0: r.z0 + ((r.z1 - r.z0) * j) / nz,
          z1: r.z0 + ((r.z1 - r.z0) * (j + 1)) / nz,
        };
        const local = holes.filter((h) => rectsOverlap(h.bbox, c));
        const pieces: P2[][] = local.length === 0 ? [rectPoly(c)] : subtractAll(rectPoly(c), local.flatMap((h) => h.pieces));
        for (const piece of pieces) {
          const pts = piece.map((q) => ({ x: q.x, y: p.y, z: q.z }));
          face(ctx.sink, style, pts, UP, render ? { ao: (q) => groundAo(q.x, q.z, p.y, ctx.occluders) } : {});
        }
      }
    }
  };
  tile(TUNING.LEVELS_GROUND_CELL_M, true);
  tile(TUNING.LEVELS_COLLIDER_CELL_M, false);
}

// ---------------------------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------------------------

export function buildBox(p: BoxPrim, ctx: PrimCtx): void {
  const side = styleOf(p, ctx, 'wall', 'solid');
  const top = styleOf(p, ctx, 'surface', 'solid');
  solidBox(ctx, side, p.rect, p.y0, p.y0 + p.height, { top, bottom: p.y0 > 0.05 });
}

export function buildLedge(p: LedgePrim, ctx: PrimCtx): void {
  const side = styleOf(p, ctx, 'wall', 'solid');
  const top = styleOf(p, ctx, 'surface', 'solid');
  solidBox(ctx, side, p.rect, p.baseY ?? 0, p.topY, { top });
}

export function buildBuilding(p: BuildingPrim, ctx: PrimCtx): void {
  const y0 = p.y0 ?? 0;
  const y1 = y0 + p.height;
  const side = styleOf(p, ctx, 'wall', 'solid');
  const roof = styleOf(p, ctx, 'surface', 'solid', p.style === 'booth' ? {} : { material: 'roofTar' });
  solidBox(ctx, side, p.rect, y0, y1, { top: roof, bottom: y0 > 0.05 });
  // Facade dressing (render only): floor bands on glass towers, a base course elsewhere.
  const band = withStyle(side, { material: p.style === 'glassTower' ? 'towerFrame' : 'metalPanel', role: 'dressing', collide: false });
  const proud = 0.05;
  const r = { x0: p.rect.x0 - proud, z0: p.rect.z0 - proud, x1: p.rect.x1 + proud, z1: p.rect.z1 + proud };
  if (p.style === 'glassTower') {
    for (let y = y0 + 4; y < y1 - 0.5; y += 4) solidBox(ctx, band, r, y, y + 0.15, { bottom: true, sideAo: false });
  } else if (p.style !== 'booth' && p.height > 1.5) {
    // Roof parapet trim so a flat block reads as a building at distance: a ring along the edge,
    // never a lid, so the roof material is what shows (and what the skater rides) inside it.
    const w = Math.min(TUNING.LEVELS_PARAPET_W_M, (r.x1 - r.x0) / 2, (r.z1 - r.z0) / 2);
    const strips = [
      { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z0 + w },
      { x0: r.x0, z0: r.z1 - w, x1: r.x1, z1: r.z1 },
      { x0: r.x0, z0: r.z0 + w, x1: r.x0 + w, z1: r.z1 - w },
      { x0: r.x1 - w, z0: r.z0 + w, x1: r.x1, z1: r.z1 - w },
    ];
    for (const s of strips) {
      if (s.x1 - s.x0 > 1e-6 && s.z1 - s.z0 > 1e-6) solidBox(ctx, band, s, y1 - 0.12, y1 + 0.02, { bottom: true, sideAo: false });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Billboard
// ---------------------------------------------------------------------------------------------

function faceFrame(face: Facing): { n: Vec3; right: Vec3 } {
  switch (face) {
    case 'north':
      return { n: { x: 0, y: 0, z: -1 }, right: { x: -1, y: 0, z: 0 } };
    case 'south':
      return { n: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 } };
    case 'east':
      return { n: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 0, z: -1 } };
    case 'west':
      return { n: { x: -1, y: 0, z: 0 }, right: { x: 0, y: 0, z: 1 } };
  }
}

export function buildBillboard(p: BillboardPrim, ctx: PrimCtx): void {
  const y0 = p.y0, y1 = p.y0 + p.height;
  // Frame box in painted steel; the face part keeps the billboard's own id so LevelView can find
  // it (a "neon" material on the billboard makes the face neon, REQ-MAT-04).
  const frame = styleOf(p, ctx, 'wall', 'solid', { material: 'paintedSteel' });
  solidBox(ctx, frame, p.rect, y0, y1, { bottom: y0 > 0.05, top: frame });
  // Sign face: UV 0..1 across the face for the wordmark texture (REQ-MAT-04), 1 cm proud.
  const { n, right } = faceFrame(p.face);
  const r = p.rect;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const halfW = Math.abs(right.x) > 0 ? (r.x1 - r.x0) / 2 : (r.z1 - r.z0) / 2;
  const halfD = Math.abs(n.x) > 0 ? (r.x1 - r.x0) / 2 : (r.z1 - r.z0) / 2;
  const off = halfD + 0.01;
  const inset = 0.15;
  const c = { x: cx + n.x * off, z: cz + n.z * off };
  const P = (a: number, y: number): Vec3 => ({ x: c.x + right.x * a, y, z: c.z + right.z * a });
  const w = Math.max(0.05, halfW - inset);
  const ya = y0 + inset, yb = y1 - inset;
  const sign = styleOf(p, ctx, 'sign', 'solid', { material: p.material === 'neon' ? 'neon' : 'signBoard', collide: false, ownPart: true });
  face(ctx.sink, sign, [P(-w, ya), P(w, ya), P(w, yb), P(-w, yb)], n, { uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
}

// ---------------------------------------------------------------------------------------------
// Props (render dressing; collidable ones add a footprint box to the collider)
// ---------------------------------------------------------------------------------------------

export function buildProp(p: PropPrim, ctx: PrimCtx): void {
  const yaw = ((p.yawDeg ?? 0) * Math.PI) / 180;
  const at = p.at;
  const sx = p.size.x, sy = p.size.y, sz = p.size.z;
  const body = styleOf(p, ctx, 'dressing', 'solid', { collide: false });
  const metal = withStyle(body, { material: 'paintedSteel' });
  const box = (lx: number, ly: number, lz: number, w: number, h: number, d: number, s = body): void =>
    orientedBox(ctx, s, at, { x: lx, y: ly, z: lz }, { x: w, y: h, z: d }, yaw);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const world = (lx: number, lz: number): { x: number; z: number } => ({ x: at.x + lx * c + lz * sn, z: at.z - lx * sn + lz * c });
  const pole = (lx: number, lz: number, y0: number, y1: number, r: number, s = metal): void => {
    const w = world(lx, lz);
    post(ctx, s, w.x, w.z, at.y + y0, at.y + y1, r);
  };
  switch (p.prop) {
    case 'booth':
      box(0, 0, 0, sx, sy * 0.9, sz);
      box(0, sy * 0.9, 0, sx + 0.1, sy * 0.1, sz + 0.1, metal);
      break;
    case 'canopy':
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) pole((a * sx) / 2 * 0.95, (b * sz) / 2 * 0.95, 0, sy - 0.1, 0.05);
      box(0, sy - 0.1, 0, sx, 0.1, sz, metal);
      break;
    case 'busShelter': {
      // Roof, two open front posts, and a thin steel back frame (sill, head, posts splitting it into
      // bays). The end bay holds a light poster panel; the other bays stay open, since the only
      // glass material is the tower curtain wall, which reads as a black slab on a pane this small.
      box(0, sy - 0.1, 0, sx, 0.1, sz, metal);
      pole(-sx / 2 + 0.05, -sz / 2 + 0.05, 0, sy - 0.1, 0.05);
      pole(sx / 2 - 0.05, -sz / 2 + 0.05, 0, sy - 0.1, 0.05);
      const back = sz / 2 - 0.05, w = sx * 0.96, bar = 0.06, sill = 0.1, head = sy - 0.1 - bar;
      box(0, sill, back, w, bar, bar, metal);
      box(0, head, back, w, bar, bar, metal);
      const bays = Math.max(1, Math.round(w / 2));
      for (let i = 0; i <= bays; i++) pole(-w / 2 + (w * i) / bays, back, 0, sy - 0.1, 0.04);
      const bayW = w / bays;
      box(w / 2 - bayW / 2, sill + bar, back, bayW - 0.12, head - sill - bar, 0.08, withStyle(body, { material: 'signBoard' }));
      break;
    }
    case 'scaffoldFrame': {
      const sc = withStyle(body, { material: 'scaffold' });
      const nx = Math.max(1, Math.round(sx / 2));
      for (let i = 0; i <= nx; i++) {
        const lx = -sx / 2 + (sx * i) / nx;
        pole(lx, -sz / 2, 0, sy, 0.03, sc);
        pole(lx, sz / 2, 0, sy, 0.03, sc);
      }
      for (let y = 2; y <= sy + 1e-6; y += 2) {
        box(0, y - 0.03, -sz / 2, sx, 0.06, 0.06, sc);
        box(0, y - 0.03, sz / 2, sx, 0.06, 0.06, sc);
      }
      break;
    }
    case 'trusses': {
      const n = Math.max(1, Math.round(sz / 3));
      for (let i = 0; i <= n; i++) box(0, sy - 0.4, -sz / 2 + (sz * i) / n, sx, 0.4, 0.3, metal);
      break;
    }
    case 'planter':
      box(0, 0, 0, sx, sy, sz);
      box(0, sy, 0, sx - 0.2, 0.02, sz - 0.2, withStyle(body, { material: 'roofTar' }));
      break;
    case 'lamp':
      pole(0, 0, 0, sy, Math.max(0.05, sx / 4));
      box(0, sy, 0, sx, 0.2, sz, withStyle(body, { material: 'neon' }));
      break;
    case 'vent':
      box(0, 0, 0, sx, sy * 0.8, sz, withStyle(body, { material: 'metalPanel' }));
      box(0, sy * 0.8, 0, sx * 0.6, sy * 0.2, sz * 0.6, metal);
      break;
    case 'coffeeTable':
      box(0, sy - 0.05, 0, sx, 0.05, sz);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) pole((a * sx) / 2 * 0.85, (b * sz) / 2 * 0.85, 0, sy - 0.05, 0.03);
      break;
  }
  if (p.collidable) {
    orientedBox(ctx, styleOf(p, ctx, 'dressing', 'solid', { render: false }), at, { x: 0, y: 0, z: 0 }, p.size, yaw, false);
  }
}
