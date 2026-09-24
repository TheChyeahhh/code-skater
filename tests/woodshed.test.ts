// tests/woodshed.test.ts (woodshed track): WOODSHED as data (SPEC §9.2 level B, DESIGN G.2,
// REQ-WSH-01..07, REQ-LVL-05/06/10, REQ-GOL-02, REQ-NPC-03/04).
// Block 1 is data only: DESIGN coordinates, ids and references, the 12 gaps, the 10 goals, letters,
// DARIO, the transition census, no em dash, the chain's row spacing. Block 2 builds the park with
// the levels track's builder (skipped while it is a stub): zero validator violations, every listed
// feed and the two side feeds, the Drive out of spawn-ollie reach, letters and the Drive in open
// air, and each of the four lines walked beat by beat (flat floor, no walls or stray rails on the
// rolls, rail hops inside the feed rule, letters by their feature).
import { describe, expect, it } from 'vitest';
import { tryImplemented } from '../src/core/contract';
import { xzy } from '../src/core/math';
import { TUNING } from '../src/core/tuning';
import { LETTERS, type Vec3 } from '../src/core/types';
import { BRANDS } from '../src/data/brands';
import { goalName } from '../src/data/goals';
import { buildLevel } from '../src/levels/builder';
import { createLevelRaycaster } from '../src/levels/lib/bvh';
import { closestOnSegment, distToPolyline } from '../src/levels/lib/grindLines';
import type { BuiltLevel, LevelViolation, RailDef } from '../src/levels/types';
import { macguffinProbePoints, measureFeed, simulateFeedHop, validateLevel } from '../src/levels/validate';
import { WOODSHED, WOODSHED_GOALS } from '../src/levels/woodshed';
import { WOODSHED_CHAIN, WOODSHED_CHAIN_TURNS, WOODSHED_LINES, type GroundPoint } from './fixtures/woodshed/lines';

const EM_DASH = String.fromCharCode(0x2014);
const DEF = WOODSHED;

function rail(id: string): RailDef {
  const r = DEF.rails.find((x) => x.id === id);
  if (!r) throw new Error(`no rail ${id}`);
  return r;
}

function prim(id: string) {
  const p = DEF.primitives.find((x) => x.id === id);
  if (!p) throw new Error(`no primitive ${id}`);
  return p;
}

function first(r: RailDef): Vec3 {
  return r.points[0] as Vec3;
}

function last(r: RailDef): Vec3 {
  return r.points[r.points.length - 1] as Vec3;
}

function describeViolations(v: readonly LevelViolation[]): string {
  return v.map((x) => `${x.rule} [${x.ids.join(',')}] ${x.message}`).join('\n');
}

function railLength(r: RailDef): number {
  let l = 0;
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i] as Vec3, b = r.points[i + 1] as Vec3;
    l += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return l;
}

/**
 * Side feed (two rails running beside each other, joined by a transfer air or a hop across):
 * along the overlap of `from`, the closest point of `to` is within the lateral and rise limits.
 */
function sideFeed(from: RailDef, to: RailDef): { lateral: number; up: number; overlap: number } {
  let lateral = 0;
  let up = -Infinity;
  let overlap = 0;
  const step = 0.5;
  for (let i = 0; i + 1 < from.points.length; i++) {
    const a = from.points[i] as Vec3, b = from.points[i + 1] as Vec3;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
      let best = Infinity;
      let at: Vec3 = p;
      for (let j = 0; j + 1 < to.points.length; j++) {
        const c = closestOnSegment(p, to.points[j] as Vec3, to.points[j + 1] as Vec3).point;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < best) {
          best = d;
          at = c;
        }
      }
      // Inside the target's extent (its closest point is not one of its ends)?
      const s = to.points[0] as Vec3, e = to.points[to.points.length - 1] as Vec3;
      const atEnd = Math.hypot(at.x - s.x, at.z - s.z) < 1e-6 || Math.hypot(at.x - e.x, at.z - e.z) < 1e-6;
      if (atEnd) continue;
      overlap += 1;
      lateral = Math.max(lateral, best);
      up = Math.max(up, at.y - p.y);
    }
  }
  return { lateral, up, overlap };
}

// ---------------------------------------------------------------------------------------------
// Block 1: data only
// ---------------------------------------------------------------------------------------------

describe('Woodshed data (DESIGN G.2, REQ-WSH-01)', () => {
  it('header: 90 x 70 m indoor wood park, spawn (34, 62, 0) facing north at the Booth Rail, spawnArea x[20,42] z[50,66]', () => {
    expect(DEF.id).toBe('woodshed');
    expect(DEF.size).toEqual({ x: 90, z: 70 });
    expect(DEF.environment).toBe('woodshedInterior');
    expect(DEF.spawn).toEqual({ pos: xzy(34, 62, 0), facing: 'north' });
    // The first thing in view: WS-RF's east half, 10.7 m straight ahead (a tap, or a ground snap where y <= 0.7).
    const rf = rail('WS-RF');
    expect(first(rf).x).toBeLessThan(DEF.spawn.pos.x);
    expect(last(rf).x).toBeGreaterThan(DEF.spawn.pos.x);
    expect(DEF.spawn.pos.z - first(rf).z).toBeCloseTo(10.1, 6);
    expect(DEF.spawnArea).toEqual({ x0: 20, z0: 50, x1: 42, z1: 66 });
  });

  it('every primitive, rail, gap, goal and decal id is unique', () => {
    for (const list of [DEF.primitives.map((p) => p.id), DEF.rails.map((r) => r.id), DEF.gaps.map((g) => g.id), DEF.goals.map((g) => g.id), DEF.decals.map((d) => d.id)]) {
      expect(new Set(list).size, list.join(',')).toBe(list.length);
    }
  });

  it('every rail and surface reference resolves (copings, peak, rims, pipes, gap rules, feeds)', () => {
    const rails = new Set(DEF.rails.map((r) => r.id));
    const prims = new Set(DEF.primitives.map((p) => p.id));
    for (const p of DEF.primitives) {
      if (p.kind === 'quarterPipe' || p.kind === 'bowl') expect(rails.has(p.copingRailId), p.id).toBe(true);
      if (p.kind === 'spine') {
        for (const id of p.copingRailIds) expect(rails.has(id), p.id).toBe(true);
        expect(p.peakRailId && rails.has(p.peakRailId), p.id).toBe(true);
      }
      if (p.kind === 'channel') for (const id of p.rimRailIds ?? []) expect(rails.has(id), p.id).toBe(true);
      if (p.kind === 'railPipe') expect(rails.has(p.railId), p.id).toBe(true);
    }
    for (const g of DEF.gaps) {
      const r = g.rule;
      const railIds = r.kind === 'grindSpan' || r.kind === 'grindDistance' ? r.rails : r.kind === 'transferOn' ? [...r.rails, ...(r.then?.grindOn ?? [])] : r.kind === 'grindSequence' ? r.steps.flat() : [];
      for (const id of railIds) expect(rails.has(id), `${g.id} -> ${id}`).toBe(true);
      const surfaces = r.kind === 'airBoxToBox' ? [r.startSurface, r.landSurface] : r.kind === 'airApexIn' ? [r.landSurface] : r.kind === 'dropIn' ? r.surfaces : r.kind === 'surfaceAzimuth' ? [r.surface] : [];
      for (const id of surfaces) if (id !== undefined) expect(prims.has(id), `${g.id} -> ${id}`).toBe(true);
    }
    for (const f of DEF.feeds) {
      expect(rails.has(f.from), f.from).toBe(true);
      expect(rails.has(f.to), f.to).toBe(true);
    }
  });

  it('DESIGN G.2 rail table: spot checks', () => {
    expect(rail('WS-RA').points).toEqual([xzy(8, 38, 0.55), xzy(24, 38, 0.55)]);
    expect(rail('WS-RB').points).toEqual([xzy(26.5, 38.3, 1.2), xzy(33, 38.3, 0.6)]);
    // Chain rows widened for the manual turns (polish pass): RR1 z 45 -> 45.4, RE / RF z 51 / 51.3 -> 51.6 / 51.9.
    expect(rail('WS-RR1').points).toHaveLength(7);
    expect(first(rail('WS-RR1'))).toEqual(xzy(31, 45.4, 0.5));
    expect(rail('WS-RR1').points[3]).toEqual(xzy(19, 45.4, 1.5));
    expect(last(rail('WS-RR1'))).toEqual(xzy(7, 45.4, 0.5));
    expect(rail('WS-RE').kind).toBe('ledge');
    expect(rail('WS-RE').points).toEqual([xzy(9, 51.6, 0.6), xzy(24, 51.6, 0.6)]);
    expect(rail('WS-RF').points).toEqual([xzy(26.2, 51.9, 0.9), xzy(40, 51.9, 0.5)]);
    expect(rail('WS-QW1-C').points).toEqual([xzy(4, 70, 2.0), xzy(30, 70, 2.0)]);
    expect(rail('WS-TR1').points).toEqual([xzy(30, 69.5, 2.0), xzy(60, 69.5, 2.4)]);
    expect(rail('WS-QE1-C').points).toEqual([xzy(60, 70, 2.4), xzy(87, 70, 2.4)]);
    expect(rail('WS-SP1-W').points).toEqual([xzy(42.7, 12, 2.4), xzy(42.7, 44, 2.4)]);
    expect(rail('WS-SP1-E').points).toEqual([xzy(43.3, 12, 2.4), xzy(43.3, 44, 2.4)]);
    expect(rail('WS-SP1-P').points).toEqual([xzy(43, 16, 2.75), xzy(43, 40, 2.75)]);
    expect(rail('WS-FB1').points).toEqual([xzy(47, 8, 0.55), xzy(56, 8, 0.55)]);
    expect(rail('WS-FB3').points).toEqual([xzy(59.4, 8, 1.55), xzy(69, 8, 1.55)]);
    expect(rail('WS-PL1-N').points).toEqual([xzy(58.6, 2.2, 1.0), xzy(70, 2.2, 1.0)]);
    expect(rail('WS-PL1-E').points).toEqual([xzy(70, 2.4, 1.0), xzy(70, 7.0, 1.0)]);
    expect(rail('WS-VW1-NC').points).toEqual([xzy(84, 22, 3.6), xzy(89.4, 22, 3.6)]);
    expect(rail('WS-VW1-SC').points).toEqual([xzy(84, 48, 3.6), xzy(89.4, 48, 3.6)]);
    expect(rail('WS-BT-N').points).toEqual([xzy(36, 60.5, 1.2), xzy(40, 60.5, 1.2)]);
    expect(rail('WS-HB1N').points).toEqual([xzy(70, 8, 1.4), xzy(72.5, 8, 0.4), xzy(74, 8, 0.4)]);
    expect(rail('WS-HB1S').points).toEqual([xzy(70, 12.6, 1.4), xzy(72.5, 12.6, 0.4), xzy(74, 12.6, 0.4)]);
    expect(rail('WS-VW1-C').points).toEqual([xzy(84, 22, 3.6), xzy(84, 48, 3.6)]);
    expect(rail('WS-OV').points).toEqual([xzy(84.5, 26, 4.0), xzy(84.5, 44, 4.0)]);
    expect(rail('WS-RR2').points).toEqual([xzy(48, 40, 0.5), xzy(52, 40, 1.15), xzy(56, 40, 1.5), xzy(60, 40, 1.15), xzy(64, 40, 0.5)]);
    // Pool coping loops close on their first point and hug the bowl rects.
    for (const [id, rect] of [['WS-BW1-C', { x0: 4, z0: 6, x1: 24, z1: 26 }], ['WS-BW2-C', { x0: 80, z0: 2, x1: 88, z1: 18 }]] as const) {
      const r = rail(id);
      expect(r.kind).toBe('coping');
      expect(r.closed).toBe(true);
      expect(first(r)).toEqual(last(r));
      for (const p of r.points) {
        expect(p.y).toBe(0);
        expect(p.x).toBeGreaterThanOrEqual(rect.x0 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(rect.x1 + 1e-9);
        expect(p.z).toBeGreaterThanOrEqual(rect.z0 - 1e-9);
        expect(p.z).toBeLessThanOrEqual(rect.z1 + 1e-9);
      }
    }
  });

  it('transfer edges: both spine copings on plane x 43, the vert coping on plane x 84; nothing else is tagged', () => {
    for (const id of ['WS-SP1-W', 'WS-SP1-E']) {
      expect(rail(id).tags).toEqual(['transfer']);
      expect(rail(id).transferPlane).toEqual({ axis: 'x', at: 43 });
    }
    expect(rail('WS-VW1-C').tags).toEqual(['transfer']);
    expect(rail('WS-VW1-C').transferPlane).toEqual({ axis: 'x', at: 84 });
    expect(DEF.rails.filter((r) => r.tags?.includes('transfer')).map((r) => r.id).sort()).toEqual(['WS-SP1-E', 'WS-SP1-W', 'WS-VW1-C']);
    const sp = prim('WS-SP1');
    expect(sp.kind === 'spine' && sp.centre === 43 && sp.gapWidth === 0.6 && sp.copingHeight === 2.4).toBe(true);
  });

  it('DESIGN G.2 feature table: spot checks', () => {
    expect(prim('WS-BW1')).toMatchObject({ kind: 'bowl', rect: { x0: 4, z0: 6, x1: 24, z1: 26 }, depth: 2.4, wallRadius: 2.4, cornerRadius: 3 });
    expect(prim('WS-BW2')).toMatchObject({ kind: 'bowl', rect: { x0: 80, z0: 2, x1: 88, z1: 18 }, depth: 2, wallRadius: 2, cornerRadius: 2 });
    expect(prim('WS-QW1')).toMatchObject({ kind: 'quarterPipe', facing: 'north', footLine: 67.8, copingLine: 70, span: [4, 30], copingHeight: 2.0, radius: 2.2 });
    expect(prim('WS-QE1')).toMatchObject({ kind: 'quarterPipe', facing: 'north', footLine: 67.3, copingLine: 70, span: [60, 87], copingHeight: 2.4, radius: 2.7 });
    // Corner decks and end blocks flush with the coping tops (polish round 2): no slot beside a ramp end.
    expect(prim('WS-QE1-END')).toMatchObject({ kind: 'box', rect: { x0: 87, z0: 67.3, x1: 90, z1: 70 }, y0: 0, height: 2.4 });
    expect(prim('WS-QW1-END')).toMatchObject({ kind: 'box', rect: { x0: 0, z0: 67.8, x1: 4, z1: 70 }, y0: 0, height: 2.0 });
    expect(prim('WS-VW1-N-END')).toMatchObject({ kind: 'box', rect: { x0: 89.4, z0: 19, x1: 90, z1: 22 }, y0: 0, height: 3.6 });
    expect(prim('WS-VW1-S-END')).toMatchObject({ kind: 'box', rect: { x0: 89.4, z0: 48, x1: 90, z1: 51 }, y0: 0, height: 3.6 });
    expect(prim('WS-VW1')).toMatchObject({ kind: 'quarterPipe', facing: 'west', footLine: 81, copingLine: 84, span: [22, 48], copingHeight: 3.6, radius: 3.0, vertExt: 0.6, deckDepth: 6 });
    // Vert pockets close the deck's ends: same profile as the wall, foot 3 m out (R 3 quarter circle), no deck of their own.
    expect(prim('WS-VW1-N')).toMatchObject({ kind: 'quarterPipe', facing: 'north', footLine: 19, copingLine: 22, span: [84, 89.4], copingHeight: 3.6, radius: 3.0, vertExt: 0.6, copingRailId: 'WS-VW1-NC' });
    expect(prim('WS-VW1-S')).toMatchObject({ kind: 'quarterPipe', facing: 'south', footLine: 51, copingLine: 48, span: [84, 89.4], copingHeight: 3.6, radius: 3.0, vertExt: 0.6, copingRailId: 'WS-VW1-SC' });
    for (const id of ['WS-VW1-N', 'WS-VW1-S']) expect((prim(id) as { deckDepth?: number }).deckDepth ?? 0, id).toBe(0);
    expect(prim('WS-FP1')).toMatchObject({ kind: 'fullPipe', a: xzy(50, 30, 4), b: xzy(76, 30, 4), radius: 4 });
    // Bank and platform 0.2 / 0.6 m east of DESIGN: WS-FB1's end post (x 56) stands on flat floor, not on the bank.
    expect(prim('WS-PL1')).toMatchObject({ kind: 'box', rect: { x0: 58.6, z0: 2, x1: 70, z1: 14 }, height: 1.0 });
    expect(prim('WS-BK1')).toMatchObject({ kind: 'bank', rect: { x0: 56.2, z0: 2, x1: 58.6, z1: 14 }, yHigh: 1.0, yLow: 0, downhill: 'west' });
    expect(last(rail('WS-FB1')).x).toBeLessThan((prim('WS-BK1') as { rect: { x0: number } }).rect.x0);
    expect(prim('WS-ST1')).toMatchObject({ kind: 'stairs', steps: 5, drop: 1.0, down: 'east' });
    expect(prim('WS-EG1')).toMatchObject({ kind: 'euroGap', rect: { x0: 75, z0: 2, x1: 77.4, z1: 14 }, floorY: -0.6, bankRunM: 0.6 });
    // The hump lives in line 1's lane (polish pass): east of the snake run's outer rim, west of the pocket lane.
    expect(prim('WS-H1')).toMatchObject({ kind: 'hump', rect: { x0: 77, z0: 52, x1: 83.5, z1: 60 }, ridgeAxis: 'x', height: 0.8 });
    expect(prim('WS-RE')).toMatchObject({ kind: 'ledge', rect: { x0: 9, z0: 51.4, x1: 24, z1: 51.8 }, topY: 0.6 });
    const sr = prim('WS-SR1');
    expect(sr.kind).toBe('channel');
    if (sr.kind === 'channel') {
      expect(sr.width).toBe(6);
      expect(sr.floorY).toBe(-1.2);
      expect(sr.wallRadius).toBe(1.5);
      expect(sr.openEndRampM).toBe(3);
      expect(sr.centreline[sr.centreline.length - 1]).toEqual({ x: 52, z: 60 });
      expect(sr.rimRailIds).toEqual(['WS-SR1-A', 'WS-SR1-B']);
    }
  });

  it('REQ-WSH-07 census: a transition park (2 bowls, spine, full-pipe, vert wall, 2 quarter-pipes, snake run, hump, 2 rainbows), no long stairs, no roofs', () => {
    const count = (k: string): number => DEF.primitives.filter((p) => p.kind === k).length;
    expect(count('bowl')).toBe(2);
    expect(count('spine')).toBe(1);
    expect(count('fullPipe')).toBe(1);
    expect(count('channel')).toBe(1);
    expect(count('hump')).toBe(1);
    expect(count('fountain')).toBe(0);
    const qps = DEF.primitives.filter((p) => p.kind === 'quarterPipe');
    expect(qps.length).toBe(5); // two quarters + the vert wall and its two pocket ends
    expect(qps.filter((p) => p.kind === 'quarterPipe' && (p.vertExt ?? 0) > 0).map((p) => p.id).sort()).toEqual(['WS-VW1', 'WS-VW1-N', 'WS-VW1-S']);
    expect(DEF.primitives.filter((p) => p.kind === 'railPipe' && p.style === 'rainbow').length).toBe(2);
    for (const p of DEF.primitives) {
      if (p.kind === 'stairs') expect(p.steps, p.id).toBeLessThanOrEqual(5);
      if (p.kind === 'building') expect(p.walkableRoof ?? false, p.id).toBe(false);
    }
    // Rail mix: pool coping, rainbows, flat bars, hubbas, snake-run rims, transfer rails (SPEC §9.2 grind density).
    const kinds = { rail: 0, ledge: 0, coping: 0 };
    for (const r of DEF.rails) kinds[r.kind] += 1;
    expect(kinds.coping).toBeGreaterThanOrEqual(9);
    expect(kinds.rail).toBeGreaterThanOrEqual(10);
    expect(kinds.ledge).toBeGreaterThanOrEqual(5);
    expect(DEF.rails.length).toBeGreaterThanOrEqual(24);
  });

  it('REQ-WSH-05: letters C, O, D, E once each at their coordinates; the Drive high above the spine peak rail', () => {
    expect(DEF.letters.map((l) => l.letter)).toEqual([...LETTERS]);
    expect(DEF.letters.find((l) => l.letter === 'C')?.pos).toEqual(xzy(14, 5.6, 2.8));
    expect(DEF.letters.find((l) => l.letter === 'O')?.pos).toEqual(xzy(76.2, 8, 2.0));
    expect(DEF.letters.find((l) => l.letter === 'D')?.pos).toEqual(xzy(60, 32.8, 6.2));
    expect(DEF.letters.find((l) => l.letter === 'E')?.pos).toEqual(xzy(84.5, 40, 4.9));
    expect(DEF.macguffin).toEqual({ id: 'secret_drive', pos: xzy(43, 28, 5.5), needs: { transferInAir: true } });
    // The Drive hangs over the peak rail's midpoint, out of a grind's reach: a peak-rail grind (collect
    // point 3.65) misses by 1.85 m, so it takes a pumped spine air plus the transfer (SPEC "speed + transfer").
    const p = rail('WS-SP1-P');
    const mid = { x: (first(p).x + last(p).x) / 2, y: first(p).y, z: (first(p).z + last(p).z) / 2 };
    expect(DEF.macguffin?.pos.x).toBeCloseTo(mid.x, 6);
    expect(DEF.macguffin?.pos.z).toBeCloseTo(mid.z, 6);
    expect((DEF.macguffin?.pos.y ?? 0) - mid.y).toBeGreaterThan(TUNING.COLLECT_POINT_UP_M + TUNING.COLLECT_RADIUS_M);
    // ...but not out of a spine air: feet 1.5 m above the coping (the transfer window) plus the collect reach get it.
    const sp = prim('WS-SP1');
    const coping = sp.kind === 'spine' ? sp.copingHeight : 0;
    expect(DEF.macguffin?.pos.y).toBeLessThanOrEqual(coping + 1.5 + TUNING.COLLECT_POINT_UP_M + TUNING.COLLECT_RADIUS_M);
    // Letter E hangs exactly a collect point above the over-vert rail.
    const e = DEF.letters.find((l) => l.letter === 'E')?.pos as Vec3;
    expect(distToPolyline({ ...e, y: e.y - TUNING.COLLECT_POINT_UP_M }, rail('WS-OV').points)).toBeLessThan(1e-9);
    // Letter D hangs inside the full-pipe (inside its radius, above the axis).
    const d = DEF.letters.find((l) => l.letter === 'D')?.pos as Vec3;
    expect(Math.hypot(d.z - 30, d.y - 4)).toBeLessThan(4.0);
    expect(d.y).toBeGreaterThan(4.0);
  });

  it('REQ-LVL-05 (data): a max ollie plus reach from any spawnArea point cannot reach the Drive', () => {
    const reach = TUNING.OLLIE_H_FULL_M + TUNING.COLLECT_POINT_UP_M + TUNING.COLLECT_RADIUS_M;
    const m = DEF.macguffin as { pos: Vec3 };
    for (const q of macguffinProbePoints(DEF)) {
      const horizontal = Math.hypot(m.pos.x - q.x, m.pos.z - q.z);
      expect(horizontal > TUNING.COLLECT_RADIUS_M || m.pos.y > reach, `${q.x},${q.z}`).toBe(true);
    }
    expect(m.pos.y).toBeGreaterThan(reach);
  });

  it('REQ-WSH-06: the 12 named gaps with DESIGN ids, names, bases and rule kinds', () => {
    expect(DEF.gaps.map((g) => g.id)).toEqual(Array.from({ length: 12 }, (_, i) => `WS-G${String(i + 1).padStart(2, '0')}`));
    const byId = new Map(DEF.gaps.map((g) => [g.id, g]));
    const expectGap = (id: string, name: string, base: number, kind: string): void => {
      const g = byId.get(id);
      expect(g?.name, id).toBe(name);
      expect(g?.base, id).toBe(base);
      expect(g?.rule.kind, id).toBe(kind);
    };
    expectGap('WS-G01', 'SPINE TRANSFER', 500, 'transferOn');
    expectGap('WS-G02', 'BOWL CARVE-OUT', 300, 'airBoxToBox');
    expectGap('WS-G03', 'EURO GAP', 400, 'airBoxToBox');
    expectGap('WS-G04', 'HUBBA DROP', 250, 'grindSpan');
    expectGap('WS-G05', 'PIPE HIGH AIR', 600, 'airApexIn');
    expectGap('WS-G06', 'OVER THE VERT', 1200, 'transferOn');
    expectGap('WS-G07', 'DROP-IN', 200, 'airBoxToBox');
    expectGap('WS-G08', 'RAINBOW', 350, 'grindSpan');
    expectGap('WS-G09', 'CENTER RAINBOW', 350, 'grindSpan');
    expectGap('WS-G10', 'COPING LINK', 700, 'grindDistance');
    expectGap('WS-G11', 'HUMP AIR', 300, 'airBoxToBox');
    expectGap('WS-G12', 'SNAKE BITE', 450, 'grindDistance');
    for (const g of DEF.gaps) {
      expect(g.base, g.id).toBeGreaterThanOrEqual(200);
      expect(g.base, g.id).toBeLessThanOrEqual(2000);
      expect(g.name, g.id).toBe(g.name.toUpperCase());
      expect(g.name.includes(EM_DASH), g.id).toBe(false);
    }
    const g01 = byId.get('WS-G01')?.rule;
    expect(g01?.kind === 'transferOn' && [...g01.rails].sort()).toEqual(['WS-SP1-E', 'WS-SP1-W']);
    const g06 = byId.get('WS-G06')?.rule;
    expect(g06?.kind === 'transferOn' && g06.rails[0] === 'WS-VW1-C' && g06.then?.grindOn?.[0] === 'WS-OV').toBe(true);
    const g10 = byId.get('WS-G10')?.rule;
    expect(g10?.kind === 'grindDistance' && g10.minM === 24 && g10.rails[0] === 'WS-TR1').toBe(true);
    const g12 = byId.get('WS-G12')?.rule;
    expect(g12?.kind === 'grindDistance' && g12.minM === 10).toBe(true);
    // HUMP AIR is a hop over the ridge, not a flat air over the whole mound: its boxes cover the hump's
    // footprint and start / end on the slopes (inside the rect, 1 m past the foot), 6 m apart (< 6.5 m).
    const g11 = byId.get('WS-G11')?.rule;
    const hump = prim('WS-H1');
    expect(g11?.kind === 'airBoxToBox' && hump.kind === 'hump').toBe(true);
    if (g11?.kind === 'airBoxToBox' && hump.kind === 'hump') {
      expect(g11.start?.x).toEqual([hump.rect.x0, hump.rect.x1]);
      expect(g11.land?.x).toEqual([hump.rect.x0, hump.rect.x1]);
      const startZ = g11.start?.z?.[1] ?? NaN, landZ = g11.land?.z?.[0] ?? NaN;
      expect(startZ).toBeGreaterThan(hump.rect.z0);
      expect(landZ).toBeLessThan(hump.rect.z1);
      expect(landZ - startZ).toBeLessThanOrEqual(6.5);
      expect(g11.eitherDirection).toBe(true);
    }
    // The coping link is long enough for its gap, the snake-run rims for theirs.
    expect(railLength(rail('WS-TR1'))).toBeGreaterThanOrEqual(24);
    expect(railLength(rail('WS-SR1-A'))).toBeGreaterThanOrEqual(10);
    expect(railLength(rail('WS-SR1-B'))).toBeGreaterThanOrEqual(10);
  });

  it('REQ-WSH-06 / REQ-GOL-02: the 10 goals, well formed, with TUNING thresholds and resolving references', () => {
    expect(DEF.goals).toBe(WOODSHED_GOALS);
    expect(DEF.goals).toHaveLength(10);
    const gapIds = new Set(DEF.gaps.map((g) => g.id));
    DEF.goals.forEach((g, i) => {
      expect(g.id).toBe(`WS-GOAL-${String(i + 1).padStart(2, '0')}`);
      expect(g.index).toBe(i + 1);
      expect(g.levelId).toBe('woodshed');
      expect(g.reqId).toBe('REQ-WSH-06');
      expect(goalName(g).length).toBeGreaterThan(0);
      expect(goalName(g).includes(EM_DASH)).toBe(false);
      const c = g.condition;
      if (c.kind === 'runScore' || c.kind === 'comboScore') expect(typeof TUNING[c.threshold], g.id).toBe('number');
      if (c.kind === 'gapInBankedCombo') expect(gapIds.has(c.gapId), g.id).toBe(true);
      if (c.kind === 'specialHeld') {
        expect(typeof TUNING[c.seconds], g.id).toBe('number');
        expect(TUNING[c.seconds]).toBe(3.0);
      }
      if (c.kind === 'sequenceInCombo') {
        expect(typeof TUNING[c.count], g.id).toBe('number');
        expect(TUNING[c.count]).toBe(2);
      }
    });
    const kinds = DEF.goals.map((g) => g.condition.kind);
    expect(kinds).toEqual(['runScore', 'runScore', 'runScore', 'comboScore', 'letters', 'macguffin', 'gapInBankedCombo', 'gapInBankedCombo', 'specialHeld', 'sequenceInCombo']);
    expect(DEF.goals[0]?.condition).toEqual({ kind: 'runScore', threshold: 'WOODSHED_HIGH_SCORE' });
    expect(TUNING.WOODSHED_HIGH_SCORE).toBe(25000);
    expect(TUNING.WOODSHED_PRO_SCORE).toBe(60000);
    expect(TUNING.WOODSHED_SICK_SCORE).toBe(120000);
    expect(TUNING.WOODSHED_HIGH_COMBO).toBe(15000);
    expect(DEF.goals[5]?.nameFromMacGuffin).toBe('secret_drive');
    expect(goalName(DEF.goals[5] as (typeof DEF.goals)[number])).toBe(BRANDS.macguffins.secret_drive.name);
    expect(DEF.goals[6]?.condition).toEqual({ kind: 'gapInBankedCombo', gapId: 'WS-G01' });
    expect(DEF.goals[7]?.condition).toEqual({ kind: 'gapInBankedCombo', gapId: 'WS-G08' });
    expect(DEF.goals[9]?.condition).toMatchObject({ kind: 'sequenceInCombo', first: 'revert', then: 'manual' });
  });

  it('REQ-NPC-01/03/04: DARIO at (41, 61) beside the booth with a contest jacket and coffee; his brand text has no em dash', () => {
    expect(DEF.npcs).toHaveLength(1);
    const d = DEF.npcs[0];
    expect(d).toMatchObject({ id: 'dario', pos: xzy(41, 61, 0), outfit: 'contestJacket', prop: 'coffee' });
    expect(d?.talkRadius).toBeUndefined(); // TALK_TRIGGER_M read live (2 m)
    expect(TUNING.TALK_TRIGGER_M).toBe(2.0);
    const booth = prim('WS-BT');
    expect(booth.kind).toBe('box');
    if (booth.kind === 'box') {
      const dx = Math.max(booth.rect.x0 - 41, 0, 41 - booth.rect.x1);
      const dz = Math.max(booth.rect.z0 - 61, 0, 61 - booth.rect.z1);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.5);
      expect(Math.hypot(dx, dz)).toBeLessThan(2.5);
      // The booth is out from under the Coping Link (its canopy roof was 0.7 m off the skater's hip):
      // at least 5 m north of the rail line and 4 m west of the snake run's exit ramp (x 49).
      expect(booth.rect.z1).toBeLessThanOrEqual(first(rail('WS-TR1')).z - 5);
      expect(booth.rect.x1).toBeLessThan(49 - 4);
    }
    // The 10 cm wall skin behind the Coping Link: the rail centreline sits 0.4 m off its face, so a
    // 0.35 m capsule on it is never buried in the panel.
    const panel = prim('WS-WALL-S');
    expect(panel.kind === 'box' && panel.rect.z0 - first(rail('WS-TR1')).z).toBeGreaterThanOrEqual(0.4 - 1e-9);
    for (const t of [BRANDS.npcs.dario.line, BRANDS.npcs.dario.toast, BRANDS.macguffins.secret_drive.splash, BRANDS.macguffins.secret_drive.name]) {
      expect(t.includes(EM_DASH), t).toBe(false);
    }
  });

  it('no em dash anywhere in the level data; banners carry brand keys (never names) and hang above head height', () => {
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'string') expect(v.includes(EM_DASH), path).toBe(false);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(DEF, 'woodshed');
    const banners = DEF.primitives.filter((p) => p.kind === 'billboard');
    expect(banners.length).toBeGreaterThanOrEqual(3);
    // Head room: a full ollie off any rail within 1 m of a banner's footprint puts the air sphere's top
    // at rail y + OLLIE_H_FULL_M + AIR_SPHERE_UP_M + 0.35; the frame (a collidable box) stays 0.3 m above that.
    const sphereTop = TUNING.OLLIE_H_FULL_M + TUNING.AIR_SPHERE_UP_M + 0.35 + 0.3;
    for (const b of banners) {
      if (b.kind !== 'billboard') continue;
      expect(['labA', 'labB', 'chip']).toContain(b.brand);
      expect(b.y0).toBeGreaterThanOrEqual(4);
      let railTop = -Infinity;
      for (const r of DEF.rails) {
        for (let i = 0; i + 1 < r.points.length; i++) {
          const a = r.points[i] as Vec3, c = r.points[i + 1] as Vec3;
          for (let k = 0; k <= 20; k++) {
            const q = { x: a.x + ((c.x - a.x) * k) / 20, y: a.y + ((c.y - a.y) * k) / 20, z: a.z + ((c.z - a.z) * k) / 20 };
            const dx = Math.max(b.rect.x0 - q.x, 0, q.x - b.rect.x1), dz = Math.max(b.rect.z0 - q.z, 0, q.z - b.rect.z1);
            if (Math.hypot(dx, dz) <= 1.0) railTop = Math.max(railTop, q.y);
          }
        }
      }
      if (railTop > -Infinity) expect(b.y0, `${b.id} frame over a rail at y ${railTop}`).toBeGreaterThanOrEqual(railTop + sphereTop);
    }
    // WS-BN4 hangs over the Coping Link: the check above is live there (rail top 2.4, frame bottom 5.8, raised for the CR-44 2.0 m full ollie).
    expect(banners.find((b) => b.id === 'WS-BN4')?.kind === 'billboard' && (banners.find((b) => b.id === 'WS-BN4') as { y0: number }).y0).toBe(6.1);
    for (const d of DEF.decals) if (d.brand) expect(['labA', 'labB', 'chip']).toContain(d.brand);
  });

  it('REQ-WSH-02 (data): every listed feed is within 3.5 m horizontal, 1.2 m up and 0.5 m lateral', () => {
    const listed = DEF.feeds.map((f) => `${f.from}>${f.to}`);
    for (const pair of ['WS-RA>WS-RB', 'WS-RE>WS-RF', 'WS-FB1>WS-FB3', 'WS-FB3>WS-HB1N', 'WS-QW1-C>WS-TR1', 'WS-TR1>WS-QE1-C']) expect(listed).toContain(pair);
    for (const f of DEF.feeds) {
      const m = measureFeed(rail(f.from), rail(f.to));
      expect(m, f.from).not.toBeNull();
      if (!m) continue;
      const horiz = Math.hypot(m.target.x - m.exit.x, m.target.z - m.exit.z);
      expect(horiz, `${f.from} -> ${f.to} horizontal`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_ALONG_M);
      expect(m.up, `${f.from} -> ${f.to} up`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_UP_M);
      expect(m.lateral, `${f.from} -> ${f.to} lateral`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_LATERAL_M + 1e-6);
      expect(m.along, `${f.from} -> ${f.to} along`).toBeGreaterThanOrEqual(0);
    }
    // The two side feeds a transfer air (or a hop across) joins: 0.5 / +0.4 and 0.3 / +0.35 per DESIGN.
    const ov = sideFeed(rail('WS-VW1-C'), rail('WS-OV'));
    expect(ov.overlap).toBeGreaterThan(10);
    expect(ov.lateral).toBeCloseTo(0.5, 6);
    expect(ov.up).toBeCloseTo(0.4, 6);
    for (const side of ['WS-SP1-W', 'WS-SP1-E']) {
      const sp = sideFeed(rail(side), rail('WS-SP1-P'));
      expect(sp.overlap).toBeGreaterThan(10);
      expect(sp.lateral).toBeCloseTo(0.3, 6);
      expect(sp.up).toBeCloseTo(0.35, 6);
    }
    expect(0.5).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_LATERAL_M);
  });

  it('REQ-WSH-02 rail chain: each row spacing is a manual half-circle at 90..100% of the max turn rate, hops feed, the chain runs >= WOODSHED_CHAIN_MIN_S', () => {
    // A 180 deg manual turn at speed v and rate w spans 2 v / w; the rows must be at least that far
    // apart at the MAX rate (a tighter spacing cannot be turned) and close enough that a rate of
    // 90% of the max still lands the next rail's line (the script may turn slower, never faster).
    for (const [from, to, v] of WOODSHED_CHAIN_TURNS) {
      const dz = Math.abs(first(rail(to)).z - first(rail(from)).z);
      const neededDps = ((2 * v) / dz) * (180 / Math.PI);
      expect(neededDps, `${from} -> ${to} row spacing ${dz} needs ${neededDps.toFixed(1)} deg/s`).toBeLessThanOrEqual(TUNING.TURN_RATE_MANUAL_DPS);
      // Rows are spaced for the DESIGN G.2 120 deg/s half-circle; the max rate may be higher since the
      // founder's 2026-09-23 playtest (easier manual steering), which only makes the turn easier.
      expect(neededDps, `${from} -> ${to} row spacing ${dz} needs only ${neededDps.toFixed(1)} deg/s`).toBeGreaterThanOrEqual(120 * 0.9);
    }
    let seconds = 0;
    let prevSpeed = TUNING.WOODSHED_CHAIN_ENTRY_MPS;
    for (const step of WOODSHED_CHAIN) {
      if (step.kind === 'rail') {
        const len = railLength(rail(step.id));
        seconds += len / ((prevSpeed + step.speedAfter) / 2);
        prevSpeed = step.speedAfter;
      } else if (step.kind === 'manual') {
        seconds += step.lengthM / step.speed;
      } else {
        const m = measureFeed(rail(step.from), rail(step.to));
        expect(m?.along, `${step.from} -> ${step.to}`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_ALONG_M);
        expect(simulateFeedHop(rail(step.from), rail(step.to), step.speed, step.pop).hit, `${step.from} -> ${step.to} hop`).toBe(true);
      }
    }
    expect(seconds).toBeGreaterThanOrEqual(TUNING.WOODSHED_CHAIN_MIN_S * 0.9); // linkers alone; airs add about 2 s
    expect(seconds + 2.2).toBeGreaterThanOrEqual(TUNING.WOODSHED_CHAIN_MIN_S);
    // The chain's manual runs stay on open floor: the spine foot (x 40) is east of every turn.
    expect(last(rail('WS-RB')).x + 5.2).toBeLessThan(40); // half-circle diameter at 7.5 m/s is 7.2 m, turn starts 1.6 m past the end
  });

  it('REQ-WSH-03 note: the chain uses only rails a ground snap or a tap reaches (SPEC §9.2 pass bar is rails + manuals)', () => {
    for (const step of WOODSHED_CHAIN) {
      if (step.kind !== 'rail') continue;
      const r = rail(step.id);
      const y = first(r).y;
      expect(y, step.id).toBeLessThanOrEqual(TUNING.OLLIE_H_TAP_M + 0.35);
    }
    expect(first(rail('WS-RA')).y).toBeLessThanOrEqual(TUNING.GRIND_GROUND_SNAP_DY_MAX);
  });
});

// ---------------------------------------------------------------------------------------------
// Block 2: builder-backed
// ---------------------------------------------------------------------------------------------

const probe = tryImplemented(() => validateLevel(DEF, buildLevel(DEF)));

describe.skipIf(probe === null)('Woodshed built (levels track builder)', () => {
  const built = buildLevel(DEF) as BuiltLevel;
  const ray = createLevelRaycaster(built.collider);
  const violations = validateLevel(DEF, built);
  const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
  const top = built.bounds.max.y + 1;

  function groundAt(x: number, z: number): { y: number; surface: string; ny: number } | null {
    const hit = ray.raycast({ x, y: top, z }, DOWN, top + 60);
    return hit ? { y: hit.point.y, surface: hit.surfaceId, ny: hit.normal.y } : null;
  }

  function hangsFree(p: Vec3): boolean {
    const up = ray.raycast(p, { x: 0, y: 1, z: 0 }, 60);
    return !up || up.front;
  }

  it('validates with zero violations (REQ-LVL-03/04/05/06/10/11/12, REQ-NPC-04, schema)', () => {
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('builds every listed rail (nothing left for the builder to invent) and every primitive is a surface', () => {
    const ids = new Set(built.rails.map((r) => r.id));
    for (const r of DEF.rails) expect(ids.has(r.id), r.id).toBe(true);
    expect(built.rails.filter((r) => !DEF.rails.some((d) => d.id === r.id)).map((r) => r.id)).toEqual([]);
    for (const p of DEF.primitives) if (p.kind !== 'railPipe' && p.kind !== 'prop') expect(built.surfaces[p.id], p.id).toBeDefined();
    expect(built.census.primitives.bowl).toBe(2);
    expect(built.census.primitives.spine).toBe(1);
    expect(built.census.primitives.fullPipe).toBe(1);
    expect(built.census.primitives.channel).toBe(1);
    expect(built.census.primitives.hump).toBe(1);
  });

  it('REQ-LVL-05: the Drive is out of a straight-up max ollie from spawn and the 12 spawn-area points', () => {
    expect(violations.filter((v) => v.rule === 'REQ-LVL-05')).toEqual([]);
    const reach = TUNING.OLLIE_H_FULL_M + TUNING.COLLECT_POINT_UP_M + TUNING.COLLECT_RADIUS_M;
    for (const q of macguffinProbePoints(DEF)) {
      const g = groundAt(q.x, q.z);
      expect(g?.surface, `${q.x},${q.z}`).toBe('WS-FL');
      expect((g?.y ?? 0) + reach).toBeLessThan(DEF.macguffin?.pos.y ?? 0);
    }
  });

  it('REQ-LVL-08: four letter triggers, the Drive and DARIO with live radii; letters and the Drive hang in open air', () => {
    expect(built.triggers.filter((t) => t.kind === 'letter').map((t) => t.ref)).toEqual([...LETTERS]);
    expect(built.triggers.find((t) => t.kind === 'macguffin')?.ref).toBe('secret_drive');
    expect(built.triggers.find((t) => t.kind === 'npcTalk')?.ref).toBe('dario');
    for (const t of built.triggers) expect(t.radius).toBe(0);
    for (const l of DEF.letters) expect(hangsFree(l.pos), l.letter).toBe(true);
    expect(hangsFree(DEF.macguffin?.pos as Vec3)).toBe(true);
    // Letter D is inside the pipe: straight up it meets the pipe ceiling from the inside.
    const d = DEF.letters.find((l) => l.letter === 'D')?.pos as Vec3;
    const ceiling = ray.raycast(d, { x: 0, y: 1, z: 0 }, 10);
    expect(ceiling?.surfaceId).toBe('WS-FP1');
    expect(ceiling?.front).toBe(true);
  });

  it('REQ-LVL-06 / REQ-LVL-10: every listed feed passes the hop simulation at its recorded speed', () => {
    expect(violations.filter((v) => v.rule === 'REQ-LVL-06' || v.rule === 'REQ-LVL-10')).toEqual([]);
    for (const f of DEF.feeds) expect(simulateFeedHop(rail(f.from), rail(f.to), f.exitSpeed, f.pop).hit, `${f.from} -> ${f.to}`).toBe(true);
    // The peak rail's end also feeds back onto a spine coping (a hop across the 0.3 m offset).
    expect(simulateFeedHop(rail('WS-SP1-P'), rail('WS-SP1-W'), 6, 'tap').hit).toBe(true);
  });

  it('REQ-LVL-09: the transition surfaces are exactly the curved kinds (bowls, spine, pipe, vert, quarters, snake run, hump)', () => {
    const tagged = new Set<string>();
    for (let t = 0; t < built.collider.triangleCount; t++) if (built.collider.triTag[t] === 1) tagged.add(built.collider.surfaceIds[built.collider.triSurface[t] as number] as string);
    expect([...tagged].sort()).toEqual(['WS-BW1', 'WS-BW2', 'WS-FP1', 'WS-H1', 'WS-QE1', 'WS-QW1', 'WS-SP1', 'WS-SR1', 'WS-VW1', 'WS-VW1-N', 'WS-VW1-S']);
  });

  it('the spawn faces 10 m of clear floor north up to the Booth Rail; DARIO stands on the floor by the booth', () => {
    const sp = DEF.spawn.pos;
    for (let z = sp.z; z >= sp.z - 10; z -= 0.5) {
      const g = groundAt(sp.x, z);
      expect(g?.surface, `z ${z}`).toBe('WS-FL');
      expect(Math.abs(g?.y ?? 1), `z ${z}`).toBeLessThan(0.01);
    }
    const wall = ray.raycast({ x: sp.x, y: 0.6, z: sp.z }, { x: 0, y: 0, z: -1 }, 10);
    expect(wall).toBeNull();
    // The booth stands beside the spawn, not in front of it: nothing but floor 3 m either side of the spawn point.
    for (const dx of [-3, -1.5, 1.5]) expect(groundAt(sp.x + dx, sp.z)?.surface, `dx ${dx}`).toBe('WS-FL');
    const d = DEF.npcs[0]?.pos as Vec3;
    expect(groundAt(d.x, d.z)?.surface).toBe('WS-FL');
  });

  it('the hump sits in line 1 lane: its end faces are >= 3 m from every fixture roll and 1 m off the snake run rim; the vert pockets have no exposed deck end', () => {
    const h = prim('WS-H1');
    expect(h.kind).toBe('hump');
    if (h.kind !== 'hump') return;
    // buildHump extrudes the profile with vertical end faces at x0 and x1: keep every roll 3 m from them.
    for (const line of WOODSHED_LINES) {
      for (const b of line.beats) {
        if (b.kind !== 'roll') continue;
        const n = Math.ceil(Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z) / 0.5);
        for (let k = 0; k <= n; k++) {
          const p = { x: b.a.x + ((b.b.x - b.a.x) * k) / n, z: b.a.z + ((b.b.z - b.a.z) * k) / n };
          if (p.z < h.rect.z0 - 0.5 || p.z > h.rect.z1 + 0.5) continue;
          for (const xEnd of [h.rect.x0, h.rect.x1]) expect(Math.abs(p.x - xEnd), `line ${line.index} roll at (${p.x}, ${p.z}) vs hump end x ${xEnd}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // The hump's west edge stays east of the outer rim, its east edge west of the pocket lane (x 84).
    const rim = rail('WS-SR1-A');
    for (const q of rim.points) if (q.z >= h.rect.z0 && q.z <= h.rect.z1) expect(h.rect.x0 - q.x).toBeGreaterThanOrEqual(1);
    expect(h.rect.x1).toBeLessThanOrEqual(84 - 0.5);
    // The floor between the ridge and the vert deck / QE1 foot is flat: a roll along x 80 sees hump then floor.
    for (const z of [48.5, 50, 51.5]) expect(groundAt(80, z)?.surface, `z ${z}`).toBe('WS-FL');
    expect(groundAt(80, 56)?.surface).toBe('WS-H1');
    expect(groundAt(80, 56)?.y).toBeCloseTo(0.8, 2);
    for (const z of [61, 64, 66.5]) expect(groundAt(80, z)?.surface, `z ${z}`).toBe('WS-FL');
    // The deck's ends: a ray heading north from the QE1 lane at x 87, y 1.5 meets the south pocket's
    // transition face (a ramp, not a head-on wall); the same from the East Bowl side meets the north pocket.
    const south = ray.raycast({ x: 87, y: 1.5, z: 56 }, { x: 0, y: 0, z: -1 }, 12);
    expect(south?.surfaceId).toBe('WS-VW1-S');
    expect(south && south.normal.y).toBeGreaterThan(0.2);
    const north = ray.raycast({ x: 87, y: 1.5, z: 18.5 }, { x: 0, y: 0, z: 1 }, 12);
    expect(north?.surfaceId).toBe('WS-VW1-N');
    expect(north && north.normal.y).toBeGreaterThan(0.2);
    // The pocket copings meet the vert coping at the deck corners, all at deck height.
    expect(first(rail('WS-VW1-NC'))).toEqual(first(rail('WS-VW1-C')));
    expect(first(rail('WS-VW1-SC'))).toEqual(last(rail('WS-VW1-C')));
  });

  // Lines: every beat of SPEC §9.2's four lines against the built geometry.
  function walkRoll(a: GroundPoint, b: GroundPoint, over: readonly string[], lineRails: ReadonlySet<string>, label: string): void {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / 0.5));
    const dir = { x: (b.x - a.x) / (len || 1), y: 0, z: (b.z - a.z) / (len || 1) };
    const allowed = new Set(['WS-FL', ...over]);
    const clear = TUNING.WOODSHED_LINE_RAIL_CLEAR_M;
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + (b.x - a.x) * (k / n), z: a.z + (b.z - a.z) * (k / n) };
      const g = groundAt(p.x, p.z);
      expect(g, `${label} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) has no ground`).not.toBeNull();
      if (!g) continue;
      expect(allowed.has(g.surface), `${label} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) rolls over ${g.surface}`).toBe(true);
      if (g.surface === 'WS-FL') expect(Math.abs(g.y), `${label} floor height at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeLessThan(0.01);
      // No wall within the next step at board height.
      if (k < n) {
        const w = ray.raycast({ x: p.x, y: g.y + 0.4, z: p.z }, dir, len / n + 0.5);
        expect(w && Math.abs(w.normal.y) < 0.5 ? w.surfaceId : null, `${label}: wall ahead at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeNull();
      }
      // No unrelated low rail (a bar and its posts) under the path.
      for (const r of built.rails) {
        if (lineRails.has(r.id) || r.kind === 'coping') continue;
        const low = r.points.every((q) => q.y - g.y < 2.0);
        if (!low) continue;
        const d = Math.min(...r.segments.map((s) => {
          const c = closestOnSegment({ x: p.x, y: g.y, z: p.z }, { ...s.a, y: g.y }, { ...s.b, y: g.y }).point;
          return Math.hypot(c.x - p.x, c.z - p.z);
        }));
        expect(d, `${label}: rail ${r.id} ${d.toFixed(2)} m from the path at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(clear);
      }
    }
  }

  for (const line of WOODSHED_LINES) {
    it(`line ${line.index} (${line.letter}) is skateable beat by beat`, () => {
      const lineRails = new Set<string>();
      for (const b of line.beats) {
        if (b.kind === 'grind') lineRails.add(b.rail);
        if (b.kind === 'hop' || b.kind === 'sideHop') lineRails.add(b.from).add(b.to);
        if (b.kind === 'transfer') for (const r of b.rails) lineRails.add(r);
      }
      const letters = line.beats.filter((b) => b.kind === 'letter');
      expect(letters).toHaveLength(1);
      expect(letters[0]?.kind === 'letter' && letters[0].letter).toBe(line.letter);
      for (const b of line.beats) {
        const label = `line ${line.index} ${b.kind}`;
        switch (b.kind) {
          case 'roll':
            walkRoll(b.a, b.b, b.over ?? [], lineRails, label);
            break;
          case 'feature':
            expect(built.surfaces[b.surface], label).toBeDefined();
            break;
          case 'grind':
            expect(built.rails.find((r) => r.id === b.rail), label).toBeDefined();
            break;
          case 'hop': {
            const m = measureFeed(rail(b.from), rail(b.to));
            expect(m && Math.hypot(m.target.x - m.exit.x, m.target.z - m.exit.z), label).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_ALONG_M);
            expect(m?.up, label).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_UP_M);
            expect(m?.lateral, label).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_LATERAL_M + 1e-6);
            expect(simulateFeedHop(rail(b.from), rail(b.to), b.speed, b.pop).hit, label).toBe(true);
            break;
          }
          case 'sideHop': {
            const s = sideFeed(rail(b.from), rail(b.to));
            expect(s.lateral, label).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_LATERAL_M + 1e-6);
            expect(s.up, label).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_UP_M);
            expect(s.overlap, label).toBeGreaterThan(0);
            break;
          }
          case 'transfer':
            for (const id of b.rails) {
              const r = rail(id);
              expect(r.tags, label).toContain('transfer');
              expect(r.transferPlane, label).toBeDefined();
            }
            break;
          case 'letter': {
            const pos = DEF.letters.find((l) => l.letter === b.letter)?.pos as Vec3;
            if (b.byRail) {
              expect(distToPolyline(pos, rail(b.byRail).points), label).toBeLessThanOrEqual(TUNING.COLLECT_POINT_UP_M + 1e-6);
            }
            if (b.bySurface) {
              const s = built.surfaces[b.bySurface];
              expect(s, label).toBeDefined();
              if (!s) break;
              const pad = 1.0;
              expect(pos.x, label).toBeGreaterThanOrEqual(s.footprint.x0 - pad);
              expect(pos.x, label).toBeLessThanOrEqual(s.footprint.x1 + pad);
              expect(pos.z, label).toBeGreaterThanOrEqual(s.footprint.z0 - pad);
              expect(pos.z, label).toBeLessThanOrEqual(s.footprint.z1 + pad);
              // Reachable: at most a full ollie plus the collect reach above the feature's top (or the floor for a gap).
              const ceiling = Math.max(s.bounds.max.y, 0) + TUNING.OLLIE_H_FULL_M + TUNING.COLLECT_POINT_UP_M + TUNING.COLLECT_RADIUS_M;
              expect(pos.y, label).toBeLessThanOrEqual(ceiling);
            }
            break;
          }
        }
      }
    });
  }

  it('rail chain (REQ-WSH-03 geometry): every chain rail is built, hops pass, the manual turns run over clear floor', () => {
    for (const step of WOODSHED_CHAIN) {
      if (step.kind === 'rail') expect(built.rails.find((r) => r.id === step.id), step.id).toBeDefined();
      if (step.kind === 'hop') expect(simulateFeedHop(rail(step.from), rail(step.to), step.speed, step.pop).hit, `${step.from} -> ${step.to}`).toBe(true);
    }
    const chainRails = new Set(WOODSHED_CHAIN.flatMap((s) => (s.kind === 'rail' ? [s.id] : s.kind === 'hop' ? [s.from, s.to] : [])));
    // RB end -> half circle right (east side, x up to 38.2) -> RR1 start; RR1 end -> half circle left (west, x down to 3) -> RE start; RF end -> 14 m east on open floor.
    walkRoll({ x: 34.6, z: 38.3 }, { x: 38.2, z: 41.9 }, [], chainRails, 'chain turn 1a');
    walkRoll({ x: 38.2, z: 41.9 }, { x: 34.6, z: 45.6 }, [], chainRails, 'chain turn 1b');
    walkRoll({ x: 34.6, z: 45.6 }, { x: 31.5, z: 45.4 }, [], chainRails, 'chain turn 1c');
    walkRoll({ x: 5.85, z: 45.4 }, { x: 3.0, z: 48.5 }, [], chainRails, 'chain turn 2a');
    walkRoll({ x: 3.0, z: 48.5 }, { x: 5.85, z: 51.6 }, [], chainRails, 'chain turn 2b');
    walkRoll({ x: 5.85, z: 51.6 }, { x: 8.0, z: 51.6 }, [], chainRails, 'chain turn 2c'); // the tap onto WS-RE (x 9) leaves from here
    walkRoll({ x: 41, z: 51.9 }, { x: 55, z: 51.9 }, [], chainRails, 'chain final manual');
  });

  it('build + validate stay inside the whole-park budget', () => {
    const t0 = performance.now();
    const b = buildLevel(DEF);
    const t1 = performance.now();
    validateLevel(DEF, b);
    const t2 = performance.now();
    expect(t1 - t0).toBeLessThan(2500);
    expect(t2 - t1).toBeLessThan(2500);
  });
});
