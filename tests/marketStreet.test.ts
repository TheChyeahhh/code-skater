// tests/marketStreet.test.ts (street track): MARKET STREET as data (DESIGN G.1, REQ-STR-01..07,
// REQ-LVL-05/06/08/10, REQ-NPC-04, REQ-GOL-02) after the line-design polish pass. Block 1 checks
// the data alone (coordinates, census, gaps, goals, the four lines' feasibility rules); block 2
// builds the level with the levels track's builder and validator (skipped while those are stubs,
// never failing because another track is unfinished) and raycasts the geometry the review flagged.
import { describe, expect, it } from 'vitest';
import { tryImplemented } from '../src/core/contract';
import { xzy } from '../src/core/math';
import { TUNING } from '../src/core/tuning';
import { LETTERS, type Vec3 } from '../src/core/types';
import { BRANDS } from '../src/data/brands';
import { goalName } from '../src/data/goals';
import { buildLevel } from '../src/levels/builder';
import { createLevelRaycaster, type LevelRaycaster } from '../src/levels/lib/bvh';
import { closestOnSegment } from '../src/levels/lib/grindLines';
import { ANNEX_FACE_X, FOUNTAIN_CENTRE, FOUNTAIN_RIM_RADIUS, FOUNTAIN_RIM_Y, MARKET_STREET } from '../src/levels/marketStreet';
import { type LineStep, MARKET_STREET_LINES, STREET_Q3_POP_POINT, STREET_Q3_POP_SLOPE_DEG } from '../src/levels/marketStreetLines';
import { type GapRule, type LevelDef, type LevelViolation, type PropPrim, type QuarterPipePrim, TRANSITION_KINDS } from '../src/levels/types';
import { macguffinProbePoints, measureFeed, simulateFeedHop, validateLevel } from '../src/levels/validate';
import { Rig, worldAvailable } from './fixtures/sim/rig';

const DEF = MARKET_STREET;
const EM_DASH = String.fromCharCode(0x2014);

const LEDGES = ['MS-L1', 'MS-L2', 'MS-L3', 'MS-L3W', 'MS-L4', 'MS-L5', 'MS-L6', 'MS-L7', 'MS-L8', 'MS-L9', 'MS-L10', 'MS-L11', 'MS-R8', 'MS-R9', 'MS-R13', 'MS-PL1', 'MS-PL2', 'MS-PL3', 'MS-PL4', 'MS-PL5', 'MS-PL6', 'MS-VAN1-R', 'MS-VAN2-R', 'MS-CRATES-R'];
const RAILS = ['MS-R1', 'MS-R2', 'MS-R3', 'MS-R4', 'MS-R6', 'MS-R7', 'MS-R10', 'MS-R11', 'MS-R12', 'MS-P1', 'MS-P2', 'MS-P3'];
const COPINGS = ['MS-Q1-C', 'MS-Q2-C', 'MS-Q3-C', 'MS-Q4-C', 'MS-Q5-C', 'MS-F1-C'];
const GAP_IDS = Array.from({ length: 12 }, (_, i) => `MS-G${String(i + 1).padStart(2, '0')}`);
const DOWN = { x: 0, y: -1, z: 0 };

function rail(id: string) {
  const r = DEF.rails.find((x) => x.id === id);
  if (!r) throw new Error(`no rail ${id}`);
  return r;
}

function prim(id: string) {
  const p = DEF.primitives.find((x) => x.id === id);
  if (!p) throw new Error(`no primitive ${id}`);
  return p;
}

function gap(id: string) {
  const g = DEF.gaps.find((x) => x.id === id);
  if (!g) throw new Error(`no gap ${id}`);
  return g;
}

function near(a: Vec3, b: Vec3, tol = 0.05): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
}

function describeViolations(v: readonly LevelViolation[]): string {
  return v.map((x) => `${x.rule} [${x.ids.join(',')}] ${x.message}`).join('\n');
}

function patched(def: LevelDef, patch: Partial<LevelDef>): LevelDef {
  return { ...def, ...patch };
}

/** Text fields of the level as authored (names, ids, decal text), for the em-dash scan. */
function allText(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const x of value) allText(x, out);
  else if (value && typeof value === 'object') for (const x of Object.values(value)) allText(x, out);
  return out;
}

/**
 * DESIGN C.6 ollie arithmetic: horizontal range of a full pop (sqrt(2 g h)) at speed v when the
 * landing is `dy` above the take-off (negative = a drop), or null when the rise beats the pop.
 */
function hopRange(v: number, dy: number): number | null {
  const g = TUNING.GRAVITY;
  const vy = Math.sqrt(2 * g * TUNING.OLLIE_H_FULL_M);
  const disc = vy * vy - 2 * g * dy;
  if (disc < 0) return null;
  return (v * (vy + Math.sqrt(disc))) / g;
}

function horiz(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Every hop of a line that a flat-ground ollie sizes: the approach when via = hop, the step itself
 * when move = air. An air launched off a transition (the previous step rides one) carries the
 * face's vertical speed and is traced by its own test instead.
 */
function hopsOf(steps: readonly LineStep[]): { label: string; from: Vec3; to: Vec3 }[] {
  const out: { label: string; from: Vec3; to: Vec3 }[] = [];
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    if (s.via === 'hop' && prev) out.push({ label: `${prev.feature} -> ${s.feature}`, from: prev.to, to: s.from });
    if (s.move !== 'air') return;
    const launch = prev && s.via === 'roll' ? stepPrim(prev) : null;
    if (launch && TRANSITION_KINDS.includes(launch.kind)) return;
    out.push({ label: `${s.feature} (air)`, from: s.from, to: s.to });
  });
  return out;
}

/** Horizontal distance from a point to a step's path (the segment from -> to, flattened). */
function distToStep(pos: Vec3, step: LineStep): number {
  const c = closestOnSegment({ x: pos.x, y: step.from.y, z: pos.z }, { ...step.from, y: step.from.y }, { ...step.to, y: step.from.y }).point;
  return horiz(c, pos);
}

/** The primitive a step rides, when its feature names one ("MS-F1 air" -> MS-F1). */
function stepPrim(step: LineStep) {
  const id = step.feature.split(' ')[0] ?? '';
  return DEF.primitives.find((p) => p.id === id) ?? null;
}

/** Quarter-pipe arc numbers (src/levels/lib/derive.ts transitionProfile with vertExt 0). */
function qpArc(q: QuarterPipePrim): { base: number; thetaMax: number; run: number } {
  const base = q.baseY ?? 0;
  const thetaMax = Math.acos((q.radius - q.copingHeight) / q.radius);
  return { base, thetaMax, run: q.radius * Math.sin(thetaMax) };
}

// ---------------------------------------------------------------------------------------------
// Block 1: data only
// ---------------------------------------------------------------------------------------------

describe('Market Street data (DESIGN G.1)', () => {
  it('header: id, size, late-afternoon environment, spawn on the north terrace facing south, spawn area', () => {
    expect(DEF.id).toBe('marketStreet');
    expect(DEF.name).toBe('Market Street');
    expect(DEF.size).toEqual({ x: 120, z: 120 });
    expect(DEF.environment).toBe('streetAfternoon');
    expect(DEF.spawn).toEqual({ pos: xzy(46, 30, 0.8), facing: 'south' });
    expect(DEF.spawnArea).toEqual({ x0: 20, z0: 20, x1: 84, z1: 88 });
  });

  it('REQ-STR-01: coordinate spot checks against the feature and rail tables as amended (0.05 m)', () => {
    expect(near(rail('MS-L1').points[0] as Vec3, xzy(41.6, 38, 1.4))).toBe(true);
    expect(near(rail('MS-L1').points[1] as Vec3, xzy(41.6, 43.2, 0.4))).toBe(true);
    expect(near(rail('MS-L3').points[1] as Vec3, xzy(80, 39.6, 1.2))).toBe(true);
    expect(near(rail('MS-R1').points[0] as Vec3, xzy(50.2, 49, 0.6))).toBe(true);
    expect(near(rail('MS-R10').points[0] as Vec3, xzy(41.6, 49, 0.6))).toBe(true);
    expect(near(rail('MS-R2').points[0] as Vec3, xzy(60, 85.7, 0.9))).toBe(true);
    expect(near(rail('MS-R2').points[1] as Vec3, xzy(80, 85.7, 0.9))).toBe(true);
    expect(near(rail('MS-R3').points[1] as Vec3, xzy(40.4, 92.2, -0.3))).toBe(true);
    expect(near(rail('MS-R4').points[0] as Vec3, xzy(51.6, 87.4, 0.9))).toBe(true);
    expect(near(rail('MS-R7').points[0] as Vec3, xzy(104.8, 72, 6.3))).toBe(true);
    expect(near(rail('MS-P3').points[1] as Vec3, xzy(104.3, 70, 5.2))).toBe(true);
    expect(near(rail('MS-Q3-C').points[0] as Vec3, xzy(95, 88, 3.5))).toBe(true);
    expect(near(rail('MS-Q3-C').points[1] as Vec3, xzy(104.1, 88, 3.5))).toBe(true);
    expect(near(rail('MS-Q2-C').points[1] as Vec3, xzy(86.7, 78, 2.4))).toBe(true);
    expect(near(rail('MS-Q5-C').points[0] as Vec3, xzy(96, 100, 5.0))).toBe(true);
    expect(near(rail('MS-L6').points[1] as Vec3, xzy(101, 80, 1.1))).toBe(true);
    // Primitive extents.
    const f = prim('MS-F1');
    if (f.kind !== 'fountain') throw new Error('MS-F1 is not a fountain');
    // Moved from G.1's (52, 64) onto the R1 bar lane and 2 m south (polish round 1): line 3's hop lands flat and climbs the fall line.
    expect(f.centre).toEqual({ x: 50.4, z: 66 });
    expect([f.footRadius, f.faceRadius, f.rimRadius, f.rimHeight, f.basinY]).toEqual([5.0, 1.5, 3.5, 1.2, 0.9]);
    const eb = prim('MS-EB');
    if (eb.kind !== 'building') throw new Error('MS-EB is not a building');
    expect(eb.rect).toEqual({ x0: 86.7, z0: 40, x1: 88.5, z1: 80 });
    expect(eb.height).toBe(2.4);
    const q2 = prim('MS-Q2');
    if (q2.kind !== 'quarterPipe') throw new Error('MS-Q2 is not a quarter-pipe');
    expect([q2.footLine, q2.copingLine, q2.copingHeight, q2.radius, q2.facing]).toEqual([84.0, 86.7, 2.4, 2.7, 'west']);
    expect(q2.span).toEqual([44, 78]);
    const q5 = prim('MS-Q5');
    if (q5.kind !== 'quarterPipe') throw new Error('MS-Q5 is not a quarter-pipe');
    expect([q5.copingLine, q5.copingHeight, q5.radius, q5.baseY, q5.facing]).toEqual([100, 1.5, 1.8, 3.5, 'north']);
    // Its foot line is where its arc meets the roof.
    expect(q5.footLine).toBeCloseTo(q5.copingLine - qpArc(q5).run, 1);
    const s1 = prim('MS-S1');
    if (s1.kind !== 'stairs') throw new Error('MS-S1 is not stairs');
    expect(s1.rect).toEqual({ x0: 41.8, z0: 40, x1: 50.2, z1: 43.2 });
    const s2 = prim('MS-S2');
    if (s2.kind !== 'stairs') throw new Error('MS-S2 is not stairs');
    expect(s2.rect).toEqual({ x0: 40, z0: 88, x1: 52, z1: 91.6 });
    expect([s2.steps, s2.drop, s2.down]).toEqual([6, 1.2, 'south']);
    const bb = prim('MS-BB1');
    if (bb.kind !== 'billboard') throw new Error('MS-BB1 is not a billboard');
    expect(bb.rect).toEqual({ x0: 83, z0: 101, x1: 89, z1: 102 });
    expect([bb.y0, bb.height]).toEqual([3.5, 6]);
    const ax = prim('MS-AX');
    if (ax.kind !== 'building') throw new Error('MS-AX is not a building');
    expect(ax.rect.x0).toBe(ANNEX_FACE_X);
    const q1 = prim('MS-Q1');
    if (q1.kind !== 'quarterPipe') throw new Error('MS-Q1 is not a quarter-pipe');
    expect(q1.span).toEqual([22, 70]);
  });

  it('the hubbas meet the stair set with no slit and the handrails stand on the S2 steps', () => {
    const s1 = prim('MS-S1'), l1 = prim('MS-L1'), l2 = prim('MS-L2'), s2 = prim('MS-S2');
    if (s1.kind !== 'stairs' || l1.kind !== 'hubba' || l2.kind !== 'hubba' || s2.kind !== 'stairs') throw new Error('kinds');
    expect(l1.rect.x1).toBe(s1.rect.x0);
    expect(s1.rect.x1).toBe(l2.rect.x0);
    for (const [id, x] of [['MS-R3', 40.4], ['MS-R4', 51.6]] as const) {
      for (const p of rail(id).points) {
        expect(p.x, id).toBe(x);
        expect(p.x, `${id} inside the stairs`).toBeGreaterThan(s2.rect.x0);
        expect(p.x, `${id} inside the stairs`).toBeLessThan(s2.rect.x1);
      }
    }
  });

  it('ids are unique per category and every rail / surface reference resolves', () => {
    // A ledge or hubba primitive shares its id with its top rail (DESIGN rail table, like TB-LEDGE).
    for (const ids of [DEF.primitives.map((p) => p.id), DEF.rails.map((r) => r.id), DEF.gaps.map((g) => g.id), DEF.decals.map((d) => d.id), DEF.goals.map((g) => g.id)]) {
      expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
    }
    const rails = new Set(DEF.rails.map((r) => r.id));
    const prims = new Set(DEF.primitives.map((p) => p.id));
    for (const p of DEF.primitives) {
      if (p.kind === 'railPipe') expect(rails.has(p.railId), p.id).toBe(true);
      if (p.kind === 'quarterPipe' || p.kind === 'fountain') expect(rails.has(p.copingRailId), p.id).toBe(true);
    }
    const railRefs = (r: GapRule): string[] => {
      switch (r.kind) {
        case 'grindSpan':
        case 'grindDistance':
          return [...r.rails];
        case 'grindSequence':
          return r.steps.flat();
        case 'transferOn':
          return [...r.rails, ...(r.then?.grindOn ?? [])];
        default:
          return [];
      }
    };
    const surfaceRefs = (r: GapRule): string[] => {
      switch (r.kind) {
        case 'airBoxToBox':
          return [r.startSurface, r.landSurface].filter((x): x is string => x !== undefined);
        case 'surfaceAzimuth':
          return [r.surface];
        case 'dropIn':
          return [...r.surfaces];
        case 'airApexIn':
          return r.landSurface ? [r.landSurface] : [];
        default:
          return [];
      }
    };
    for (const g of DEF.gaps) {
      for (const id of railRefs(g.rule)) expect(rails.has(id), `${g.id} -> ${id}`).toBe(true);
      for (const id of surfaceRefs(g.rule)) expect(prims.has(id), `${g.id} -> ${id}`).toBe(true);
    }
    for (const f of DEF.feeds) {
      expect(rails.has(f.from), f.from).toBe(true);
      expect(rails.has(f.to), f.to).toBe(true);
    }
  });

  it('REQ-STR-07 census: 24 ledges, 12 rails, 6 copings, 1 fountain, 5 quarter-pipes, 2 stair sets, 2 hubbas, 1 kicker, 3 roof levels, no bowl / spine / full-pipe', () => {
    const byKind = (kind: string): string[] => DEF.rails.filter((r) => r.kind === kind).map((r) => r.id).sort();
    expect(byKind('ledge')).toEqual([...LEDGES].sort());
    expect(byKind('rail')).toEqual([...RAILS].sort());
    expect(byKind('coping')).toEqual([...COPINGS].sort());
    const count = (kind: string): number => DEF.primitives.filter((p) => p.kind === kind).length;
    expect(count('fountain')).toBe(1);
    expect(count('quarterPipe')).toBe(5);
    expect(count('stairs')).toBe(2);
    expect(count('hubba')).toBe(2);
    expect(count('kicker')).toBe(1);
    expect(count('bowl') + count('spine') + count('fullPipe')).toBe(0);
    const roofs = new Set(DEF.primitives.filter((p) => p.kind === 'building' && p.walkableRoof).map((p) => (p.kind === 'building' ? (p.y0 ?? 0) + p.height : 0)));
    expect([...roofs].sort((a, b) => a - b)).toEqual([2.4, 3.5, 6.0]);
    // Every rail has its DESIGN name; the Bus Stop Bar is 20 m, the fountain rim is a closed 24-gon at y 1.2.
    for (const r of DEF.rails) expect(r.name, r.id).toBeTruthy();
    expect(rail('MS-R2').name).toBe('Bus Stop Bar');
    expect(horiz(rail('MS-R2').points[0] as Vec3, rail('MS-R2').points[1] as Vec3)).toBe(20);
    const rim = rail('MS-F1-C');
    expect(rim.closed).toBe(true);
    expect(rim.points.length).toBe(25);
    expect(rim.points[0]).toEqual(rim.points[24]);
    for (const p of rim.points) {
      expect(p.y).toBe(FOUNTAIN_RIM_Y);
      expect(Math.hypot(p.x - FOUNTAIN_CENTRE.x, p.z - FOUNTAIN_CENTRE.z)).toBeCloseTo(FOUNTAIN_RIM_RADIUS, 2);
    }
  });

  it('REQ-STR-04: the 12 named gaps with their bases, splash names and rule kinds', () => {
    expect(DEF.gaps.map((g) => g.id)).toEqual(GAP_IDS);
    const expected: Record<string, [string, number, GapRule['kind']]> = {
      'MS-G01': ['HUBBA HOP', 250, 'grindSpan'],
      'MS-G02': ['TERRACE DROP', 200, 'airBoxToBox'],
      'MS-G03': ['PLAZA BAR HOP', 500, 'grindSequence'],
      'MS-G04': ['FOUNTAIN TRANSFER', 750, 'surfaceAzimuth'],
      'MS-G05': ['STAIR SET', 300, 'airBoxToBox'],
      'MS-G06': ['CROSSWALK MANUAL', 350, 'manualSpan'],
      'MS-G07': ['BUS STOP BAR', 500, 'grindDistance'],
      'MS-G08': ['ALLEY TRANSFER', 600, 'airBoxToBox'],
      'MS-G09': ['DOCK ROOF ACCESS', 300, 'airBoxToBox'],
      'MS-G10': ['BILLBOARD GAP', 1000, 'airBoxToBox'],
      'MS-G11': ['SCAFFOLD CLIMB', 800, 'grindSequence'],
      'MS-G12': ['ROOFTOP DROP', 400, 'airBoxToBox'],
    };
    for (const g of DEF.gaps) {
      const [name, base, kind] = expected[g.id] as [string, number, GapRule['kind']];
      expect(g.name, g.id).toBe(name);
      expect(g.base, g.id).toBe(base);
      expect(g.rule.kind, g.id).toBe(kind);
      expect(g.name).toBe(g.name.toUpperCase());
      expect(g.base).toBeGreaterThanOrEqual(200);
      expect(g.base).toBeLessThanOrEqual(2000);
    }
    // The conditions that carry numbers.
    const g07 = gap('MS-G07').rule;
    expect(g07.kind === 'grindDistance' && g07.minM === 14 && g07.rails[0] === 'MS-R2').toBe(true);
    const g06 = gap('MS-G06').rule;
    expect(g06.kind === 'manualSpan' && g06.within.x?.[0] === 38 && g06.within.x?.[1] === 54 && g06.from.value === 93 && g06.to.value === 100.5).toBe(true);
    const g10 = gap('MS-G10').rule;
    expect(g10.kind === 'airBoxToBox' && g10.start?.x?.[0] === 95 && g10.land?.x?.[1] === 90 && g10.start?.y?.[0] === 3.4).toBe(true);
    const g04 = gap('MS-G04').rule;
    expect(g04.kind === 'surfaceAzimuth' && g04.surface === 'MS-F1' && g04.minDeltaDeg === 45 && g04.centre.x === FOUNTAIN_CENTRE.x && g04.centre.z === FOUNTAIN_CENTRE.z).toBe(true);
    const g11 = gap('MS-G11').rule;
    expect(g11.kind === 'grindSequence' && g11.steps.map((s) => s[0]).join(',') === 'MS-P1,MS-P2,MS-P3').toBe(true);
    const g01 = gap('MS-G01').rule;
    expect(g01.kind === 'grindSpan' && g01.from.value === 40 && g01.to.value === 44).toBe(true);
    // Both flat bars count for the bar hop; the rooftop drop starts on the moved annex.
    const g03 = gap('MS-G03').rule;
    expect(g03.kind === 'grindSequence' && g03.steps[1]?.includes('MS-R10') && g03.steps[1]?.includes('MS-R1')).toBe(true);
    const g12 = gap('MS-G12').rule;
    expect(g12.kind === 'airBoxToBox' && g12.start?.x?.[0] === ANNEX_FACE_X).toBe(true);
  });

  it('REQ-STR-03: letters C, O, D, E at the listed points and the Laptop above the annex roof rail', () => {
    expect(DEF.letters.map((l) => l.letter)).toEqual([...LETTERS]);
    const at = Object.fromEntries(DEF.letters.map((l) => [l.letter, l.pos]));
    expect(at['C']).toEqual(xzy(46, 90.5, 2.4));
    expect(at['O']).toEqual(xzy(92.5, 94, 6.5));
    expect(at['D']).toEqual(xzy(50.4, 62.5, 3.0));
    expect(at['E']).toEqual(xzy(104.3, 58, 4.4));
    expect(DEF.macguffin).toEqual({ id: 'secret_laptop', pos: xzy(104.8, 80, 7.2) });
    // Directly above R7's line, within the collect reach of a grinding skater.
    const r7 = rail('MS-R7');
    const c = closestOnSegment(DEF.macguffin?.pos as Vec3, r7.points[0] as Vec3, r7.points[1] as Vec3).point;
    expect(horiz(c, DEF.macguffin?.pos as Vec3)).toBeLessThanOrEqual(0.01);
    expect((DEF.macguffin?.pos.y ?? 0) - c.y).toBeCloseTo(0.9, 6);
    // The D hangs over the fountain rim (not the face) and a tap off the rim reaches it.
    const d = at['D'] as Vec3;
    expect(Math.hypot(d.x - FOUNTAIN_CENTRE.x, d.z - FOUNTAIN_CENTRE.z)).toBeCloseTo(FOUNTAIN_RIM_RADIUS, 1);
    expect(d.y - FOUNTAIN_RIM_Y).toBeLessThanOrEqual(TUNING.OLLIE_H_TAP_M + TUNING.COLLECT_POINT_UP_M + 1e-9);
    // The E hangs over the scaffold pipes' line.
    expect(at['E']?.x).toBe(rail('MS-P2').points[0]?.x);
  });

  it('REQ-STR-05 / REQ-NPC-01..04: SAM just ahead of the spawn in a hoodie with the laptop sleeve; lines from BRANDS without em dashes', () => {
    expect(DEF.npcs.length).toBe(1);
    const sam = DEF.npcs[0];
    expect(sam?.id).toBe('sam');
    expect(sam?.pos).toEqual(xzy(47.5, 35, 0.8));
    expect(sam?.facing).toBe('north');
    expect(sam?.outfit).toBe('hoodie');
    expect(sam?.prop).toBe('laptopSleeve');
    expect(sam?.talkRadius).toBeUndefined(); // TALK_TRIGGER_M read live (2.0 m)
    expect(TUNING.TALK_TRIGGER_M).toBe(2.0);
    expect(TUNING.COLLECT_RADIUS_M).toBe(0.9);
    // SAM is ahead of the spawn (the spawn faces south) on the same terrace, and a straight roll south
    // from spawn passes through the talk trigger without running him over.
    expect(sam?.pos.z).toBeGreaterThan(DEF.spawn.pos.z);
    expect(horiz(sam?.pos as Vec3, DEF.spawn.pos)).toBeLessThan(6);
    expect(sam?.pos.y).toBe(DEF.spawn.pos.y);
    const lane = Math.abs((sam?.pos.x ?? 0) - DEF.spawn.pos.x);
    expect(lane).toBeGreaterThan(TUNING.SKATER_RADIUS_M * 2);
    expect(lane).toBeLessThan(TUNING.TALK_TRIGGER_M);
    const brand = BRANDS.npcs.sam;
    expect(brand.line).toBe("Hey, I lost my laptop. It's got all my code on it. Grab it before the demo.");
    expect(brand.toast).toBe("Nice. Don't open README.md.");
    expect(BRANDS.macguffins.secret_laptop.splash).toBe(BRANDS.macguffins.secret_laptop.splash.toUpperCase());
    for (const t of [brand.name, brand.title, brand.line, brand.toast, BRANDS.macguffins.secret_laptop.name, BRANDS.macguffins.secret_laptop.splash]) {
      expect(t.includes(EM_DASH), t).toBe(false);
    }
  });

  it('REQ-NPC-04: no em dash anywhere in the level data', () => {
    for (const t of allText(DEF)) expect(t.includes(EM_DASH), t).toBe(false);
  });

  it('REQ-STR-06 / REQ-GOL-02: ten well-formed goals with the listed conditions and TUNING thresholds', () => {
    expect(DEF.goals.length).toBe(10);
    expect(DEF.goals.map((g) => g.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(DEF.goals.map((g) => g.id)).size).toBe(10);
    for (const g of DEF.goals) {
      expect(g.levelId).toBe('marketStreet');
      expect(g.reqId).toBe('REQ-STR-06');
      expect(goalName(g).includes(EM_DASH)).toBe(false);
      expect(goalName(g).length).toBeGreaterThan(0);
    }
    const c = DEF.goals.map((g) => g.condition);
    expect(c[0]).toEqual({ kind: 'runScore', threshold: 'STREET_HIGH_SCORE' });
    expect(c[1]).toEqual({ kind: 'runScore', threshold: 'STREET_PRO_SCORE' });
    expect(c[2]).toEqual({ kind: 'runScore', threshold: 'STREET_SICK_SCORE' });
    expect(c[3]).toEqual({ kind: 'comboScore', threshold: 'STREET_HIGH_COMBO' });
    expect(c[4]).toEqual({ kind: 'letters' });
    expect(c[5]).toEqual({ kind: 'macguffin', id: 'secret_laptop' });
    expect(DEF.goals[5]?.nameFromMacGuffin).toBe('secret_laptop');
    expect(goalName(DEF.goals[5] as (typeof DEF.goals)[number])).toBe(BRANDS.macguffins.secret_laptop.name);
    expect(c[6]).toEqual({ kind: 'gapInBankedCombo', gapId: 'MS-G07' });
    expect(c[7]).toEqual({ kind: 'gapInBankedCombo', gapId: 'MS-G10' });
    expect(c[8]).toEqual({ kind: 'gapInBankedCombo', gapId: 'MS-G06' });
    expect(c[9]).toEqual({ kind: 'comboWithSurface', threshold: 'STREET_FOUNTAIN_COMBO', surfaceId: 'MS-F1', orGapId: 'MS-G04' });
    expect([TUNING.STREET_HIGH_SCORE, TUNING.STREET_PRO_SCORE, TUNING.STREET_SICK_SCORE, TUNING.STREET_HIGH_COMBO, TUNING.STREET_FOUNTAIN_COMBO]).toEqual([15000, 40000, 80000, 10000, 5000]);
    expect(TUNING.UNLOCK_WOODSHED_GOALS).toBe(6);
    const gapIds = new Set(DEF.gaps.map((g) => g.id));
    for (const cond of c) {
      if (cond.kind === 'gapInBankedCombo') expect(gapIds.has(cond.gapId)).toBe(true);
      if (cond.kind === 'comboWithSurface') {
        expect(DEF.primitives.some((p) => p.id === cond.surfaceId)).toBe(true);
        if (cond.orGapId) expect(gapIds.has(cond.orGapId)).toBe(true);
      }
    }
  });

  it('sponsor signage reads brand keys and sits on walls, never on a rail or coping surface', () => {
    const bb = DEF.primitives.filter((p) => p.kind === 'billboard');
    expect(bb.length).toBeGreaterThanOrEqual(1);
    for (const b of bb) if (b.kind === 'billboard') expect(['labA', 'labB', 'chip']).toContain(b.brand);
    const marks = DEF.decals.filter((d) => d.kind === 'wordmark');
    expect(marks.length).toBeGreaterThanOrEqual(3);
    for (const d of marks) {
      expect(d.brand, d.id).toBeDefined();
      expect(d.on, d.id).not.toBe('up');
      expect(d.text, d.id).toBeUndefined();
    }
    // Crosswalk on the street, water in the basin.
    const xw = DEF.decals.find((d) => d.kind === 'crosswalk');
    expect(xw?.center).toEqual(xzy(46, 96.8, -1.2));
    expect([xw?.width, xw?.height]).toEqual([16, 10.4]);
    expect(DEF.decals.find((d) => d.kind === 'water')?.center).toEqual(xzy(FOUNTAIN_CENTRE.x, FOUNTAIN_CENTRE.z, 0.9));
  });

  it('the water decal is the largest square whose corners stay hidden under the fountain rim', () => {
    const f = prim('MS-F1');
    if (f.kind !== 'fountain') throw new Error('MS-F1 is not a fountain');
    const w = DEF.decals.find((d) => d.kind === 'water');
    if (!w) throw new Error('no water decal');
    expect(w.width).toBe(w.height);
    const inner = f.rimRadius - TUNING.LEVELS_FOUNTAIN_RIM_W_M;
    // Wider than the basin, so its corners pass under the rim top (the crescents at the edge
    // midpoints are what only a builder disc can fill).
    expect(w.width / 2).toBeGreaterThan(inner * 0.75);
    expect(w.width / 2).toBeLessThan(inner);
    // The outer face is a quarter-pipe profile (foot flat, steep at the rim): the water height is
    // reached u* past the rim; the corners must stop before that, and not far before it.
    const R = f.faceRadius;
    const thetaMax = Math.acos((R - Math.min(R, f.rimHeight)) / R);
    const run = R * Math.sin(thetaMax);
    const clear = f.basinY + TUNING.LEVELS_DECAL_LIFT_M + 0.05 - (f.baseY ?? 0);
    const thClear = Math.acos(1 - clear / R);
    const uClear = run - R * Math.sin(thClear);
    const rMax = f.rimRadius + uClear;
    const rc = (w.width / 2) * Math.SQRT2;
    expect(rc, `corner radius ${rc.toFixed(3)} vs the face dropping to water height at r ${rMax.toFixed(3)}`).toBeLessThanOrEqual(rMax);
    expect(rc).toBeGreaterThan(rMax - 0.15);
  });

  it('the four lines: one letter each in C-O-D-E order, every hop within a full ollie at the typical speed (REQ-STR-02)', () => {
    expect(MARKET_STREET_LINES.map((l) => l.letter)).toEqual([...LETTERS]);
    expect(MARKET_STREET_LINES.map((l) => l.index)).toEqual([1, 2, 3, 4]);
    const v = TUNING.STREET_LINE_SPEED_MPS;
    const railIds = new Set(DEF.rails.map((r) => r.id));
    const gapIds = new Set(DEF.gaps.map((g) => g.id));
    for (const line of MARKET_STREET_LINES) {
      expect(line.steps.length).toBeGreaterThanOrEqual(5);
      for (const hop of hopsOf(line.steps)) {
        const dy = hop.to.y - hop.from.y;
        const range = hopRange(v, dy);
        expect(range, `line ${line.index} ${hop.label}: rise ${dy.toFixed(2)} m beats a full ollie`).not.toBeNull();
        expect(horiz(hop.from, hop.to), `line ${line.index} ${hop.label}: ${horiz(hop.from, hop.to).toFixed(2)} m > ${(range ?? 0).toFixed(2)} m at ${v} m/s`).toBeLessThanOrEqual(range ?? 0);
      }
      for (const s of line.steps) {
        // A grind step rides an authored rail: its ends lie on the rail line.
        if (s.move === 'grind') {
          expect(railIds.has(s.feature), `line ${line.index} grinds unknown rail ${s.feature}`).toBe(true);
          const r = rail(s.feature);
          for (const q of [s.from, s.to]) {
            let d = Infinity;
            for (let i = 0; i + 1 < r.points.length; i++) {
              const c = closestOnSegment(q, r.points[i] as Vec3, r.points[i + 1] as Vec3).point;
              d = Math.min(d, Math.hypot(c.x - q.x, c.y - q.y, c.z - q.z));
            }
            expect(d, `line ${line.index} ${s.feature} point off its rail`).toBeLessThanOrEqual(0.05);
          }
        }
        for (const g of s.gaps ?? []) expect(gapIds.has(g), `line ${line.index} earns unknown gap ${g}`).toBe(true);
      }
      // Lines 1 to 4 visit the features DESIGN names for them (line 1 mirrored onto the west hubba and bar).
      const features = line.steps.map((s) => s.feature).join(' ');
      const must = { 1: ['MS-L1', 'MS-R10', 'MS-G05', 'MS-G06', 'MS-Q1'], 2: ['MS-L6', 'MS-Q3', 'MS-Q5', 'MS-G10', 'MS-R6'], 3: ['MS-R1', 'MS-F1', 'MS-L2'], 4: ['MS-P1', 'MS-P2', 'MS-P3', 'MS-R7', 'MS-G12', 'MS-G10'] }[line.index];
      for (const id of must) expect(features, `line ${line.index} misses ${id}`).toContain(id);
    }
  });

  it('air has no steer: every hop leaves along the previous step\'s exit tangent within the entry angle and the feed lateral limit', () => {
    const maxDeg = TUNING.GRIND_ENTRY_MAX_DEG;
    const maxLateral = TUNING.LEVELS_FEED_MAX_LATERAL_M;
    let hops = 0;
    for (const line of MARKET_STREET_LINES) {
      line.steps.forEach((s, i) => {
        const prev = line.steps[i - 1];
        if (s.via !== 'hop' || !prev) return;
        const label = `line ${line.index} ${prev.feature} -> ${s.feature}`;
        const tx = prev.to.x - prev.from.x, tz = prev.to.z - prev.from.z;
        const tl = Math.hypot(tx, tz);
        expect(tl, `${label}: the previous step has no horizontal direction`).toBeGreaterThan(0.05);
        const hx = s.from.x - prev.to.x, hz = s.from.z - prev.to.z;
        const hl = Math.hypot(hx, hz);
        if (hl < 0.05) return; // a hop straight up (a lip pop) has no heading of its own
        const cos = (hx * tx + hz * tz) / (hl * tl);
        const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        const lateral = Math.abs(hx * tz - hz * tx) / tl;
        expect(ang, `${label}: hop heading ${ang.toFixed(1)} deg off the exit tangent`).toBeLessThanOrEqual(maxDeg);
        expect(lateral, `${label}: ${lateral.toFixed(2)} m lateral`).toBeLessThanOrEqual(maxLateral + 1e-9);
        hops += 1;
      });
    }
    expect(hops).toBeGreaterThanOrEqual(12);
    // The rule bites: the old line 1 hop from R1's south end to the x 46 manual lane fails it.
    const bad: LineStep[] = [
      { feature: 'MS-R1', via: 'roll', move: 'grind', from: xzy(50.2, 49, 0.6), to: xzy(50.2, 57, 0.6) },
      { feature: 'manual south', via: 'hop', move: 'roll', from: xzy(46, 60, 0), to: xzy(46, 87.8, 0) },
    ];
    const p = bad[0] as LineStep, s = bad[1] as LineStep;
    expect(Math.abs((s.from.x - p.to.x) * (p.to.z - p.from.z) - (s.from.z - p.to.z) * (p.to.x - p.from.x)) / horiz(p.from, p.to)).toBeGreaterThan(maxLateral);
  });

  it('each letter hangs over its line step within collect reach; letters over a transition or an air get no slack; the Laptop over the R7 grind', () => {
    const up = TUNING.COLLECT_POINT_UP_M;
    const reach = TUNING.OLLIE_H_FULL_M;
    const r = TUNING.COLLECT_RADIUS_M;
    const slack = TUNING.STREET_LINE_LETTER_SLACK_M;
    let overTransition = 0;
    const check = (label: string, pos: Vec3, step: LineStep): void => {
      const p = stepPrim(step);
      const overTr = p !== null && TRANSITION_KINDS.includes(p.kind);
      if (overTr) overTransition += 1;
      // Air has no steer: a letter over an air step must sit on the step's own path, like one over a transition.
      const tight = overTr || step.move === 'air';
      const allowed = tight ? r : r + slack;
      expect(distToStep(pos, step), `${label}: ${distToStep(pos, step).toFixed(2)} m beside ${step.feature} (max ${allowed})`).toBeLessThanOrEqual(allowed);
      const dy = pos.y - step.from.y;
      expect(dy, `${label}: ${dy.toFixed(2)} m above ${step.feature}`).toBeGreaterThanOrEqual(up - r);
      expect(dy, `${label}: ${dy.toFixed(2)} m above ${step.feature}`).toBeLessThanOrEqual(up + reach + r);
    };
    for (const line of MARKET_STREET_LINES) {
      const step = line.steps[line.letterStep];
      expect(step, `line ${line.index} letterStep`).toBeDefined();
      const letter = DEF.letters.find((l) => l.letter === line.letter);
      check(`letter ${line.letter}`, letter?.pos as Vec3, step as LineStep);
    }
    expect(overTransition).toBe(1); // the D over the fountain
    const r7 = MARKET_STREET_LINES[3]?.steps.find((s) => s.feature === 'MS-R7');
    check('laptop', DEF.macguffin?.pos as Vec3, r7 as LineStep);
  });

  it('line 2: the Q3 pop point sits at the recorded slope and, traced with the C.6 transition, pop and gravity rules from minSpeed, comes down on the dock roof', () => {
    const q3 = prim('MS-Q3');
    if (q3.kind !== 'quarterPipe') throw new Error('MS-Q3 is not a quarter-pipe');
    const line2 = MARKET_STREET_LINES[1] as (typeof MARKET_STREET_LINES)[number];
    const face = line2.steps.find((s) => s.feature === 'MS-Q3') as LineStep;
    const air = line2.steps.find((s) => s.feature === 'MS-G09') as LineStep;
    expect(face.to).toEqual(STREET_Q3_POP_POINT);
    expect(air.from).toEqual(STREET_Q3_POP_POINT);
    expect(face.minSpeed).toBeDefined();
    const { base, run } = qpArc(q3);
    expect(q3.footLine).toBeCloseTo(q3.copingLine - run, 1);
    const th = (STREET_Q3_POP_SLOPE_DEG * Math.PI) / 180;
    // The pop point on the arc (DESIGN says "pop early on the transition"; below the VERT_POP_SCALE cliff).
    expect(STREET_Q3_POP_SLOPE_DEG).toBeLessThan(TUNING.SIM_VERT_POP_MIN_SLOPE_DEG);
    const zPop = q3.copingLine - (run - q3.radius * Math.sin(th));
    const yPop = base + q3.radius * (1 - Math.cos(th));
    expect(STREET_Q3_POP_POINT.z).toBeCloseTo(zPop, 1);
    expect(STREET_Q3_POP_POINT.y).toBeCloseTo(yPop, 2);
    expect(STREET_Q3_POP_POINT.x).toBeGreaterThan(q3.span[0]);
    expect(STREET_Q3_POP_POINT.x).toBeLessThan(q3.span[1]);
    // Speed on the face after climbing (yPop - base) at the transition gravity factor.
    const g = TUNING.GRAVITY;
    const v0 = face.minSpeed as number;
    const v2 = v0 * v0 - 2 * g * TUNING.TRANSITION_GRAVITY_FACTOR * (yPop - base);
    expect(v2).toBeGreaterThan(0);
    const v = Math.sqrt(v2);
    // Tap pop blended between the face normal (pointing back north) and up; scaled only at or above the cliff.
    const scale = STREET_Q3_POP_SLOPE_DEG >= TUNING.SIM_VERT_POP_MIN_SLOPE_DEG ? TUNING.VERT_POP_SCALE : 1;
    const vPop = Math.sqrt(2 * g * TUNING.OLLIE_H_TAP_M) * scale;
    const b = TUNING.POP_UP_BLEND;
    const pz = -b * Math.sin(th), py = b * Math.cos(th) + (1 - b);
    const pl = Math.hypot(pz, py);
    const vz = v * Math.cos(th) + (vPop * pz) / pl;
    const vy = v * Math.sin(th) + (vPop * py) / pl;
    const roof = prim('MS-DB');
    if (roof.kind !== 'building') throw new Error('MS-DB is not a building');
    const yRoof = (roof.y0 ?? 0) + roof.height;
    const dy = yRoof - yPop;
    const disc = vy * vy - 2 * g * dy;
    expect(disc, `apex ${(vy * vy / (2 * g)).toFixed(2)} m does not reach the roof ${dy.toFixed(2)} m up`).toBeGreaterThan(0);
    const t = (vy + Math.sqrt(disc)) / g;
    const zLand = zPop + vz * t;
    expect(vz).toBeGreaterThan(0);
    expect(zLand, `lands at z ${zLand.toFixed(2)} (coping z ${q3.copingLine})`).toBeGreaterThanOrEqual(q3.copingLine + TUNING.STREET_LINE_ROOF_MARGIN_M);
    expect(zLand).toBeLessThanOrEqual(roof.rect.z1);
    // Clears the coping on the way (board thickness over the lip).
    const tLip = (q3.copingLine - zPop) / vz;
    expect(yPop + vy * tLip - 0.5 * g * tLip * tLip).toBeGreaterThan(yRoof + TUNING.BOARD_THICKNESS_M);
    // The authored landing point matches the trace.
    expect(air.to.z).toBeCloseTo(zLand, 0);
    expect(air.to.y).toBe(yRoof);
    // The recorded speed is reachable: the push cutoff exceeds it and the D2 run-up before the foot is a
    // real run (from the L6 exit, pushing at PUSH_ACCEL from the ledge speed reaches it).
    const cutoff = TUNING.PUSH_CUTOFF * TUNING.MAX_SPEED_MPS;
    expect(v0).toBeLessThanOrEqual(cutoff);
    const d2 = line2.steps.find((s) => s.feature === 'MS-D2') as LineStep;
    const runUp = horiz(d2.from, d2.to);
    const l6 = DEF.feeds.find((f) => f.to === 'MS-R1') as (typeof DEF.feeds)[number]; // the ledge exit speed the feeds record
    const vAfter = Math.sqrt(l6.exitSpeed * l6.exitSpeed + 2 * TUNING.PUSH_ACCEL * runUp);
    expect(Math.min(vAfter, cutoff)).toBeGreaterThanOrEqual(v0);
    // The mini quarter on the roof is reachable at the cutoff speed: it needs sqrt(2 g factor h) at its foot.
    const q5 = prim('MS-Q5');
    if (q5.kind !== 'quarterPipe') throw new Error('MS-Q5 is not a quarter-pipe');
    expect(Math.sqrt(2 * g * TUNING.TRANSITION_GRAVITY_FACTOR * q5.copingHeight)).toBeLessThan(cutoff);
    // Billboard Gap at the push cutoff with a full ollie: the slot is narrower than the range.
    const slot = line2.steps.find((s) => s.feature === 'MS-G10') as LineStep;
    expect(horiz(slot.from, slot.to)).toBeLessThan(hopRange(cutoff, 0) as number);
  });

  it('REQ-LVL-06: the planter-hubba-bar chains and the scaffold chain are listed feeds within 3.5 m / 1.2 m / 0.5 m lateral', () => {
    expect(DEF.feeds.map((f) => `${f.from}>${f.to}`)).toEqual(['MS-PL1>MS-L1', 'MS-PL2>MS-L2', 'MS-L1>MS-R10', 'MS-L2>MS-R1', 'MS-P1>MS-P2', 'MS-P2>MS-P3', 'MS-P3>MS-R7']);
    for (const f of DEF.feeds) {
      const m = measureFeed(rail(f.from), rail(f.to));
      expect(m, f.from).not.toBeNull();
      if (!m) continue;
      expect(Math.hypot(m.target.x - m.exit.x, m.target.z - m.exit.z), `${f.from} -> ${f.to} horizontal`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_ALONG_M);
      expect(m.up, `${f.from} -> ${f.to} up`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_UP_M);
      expect(m.lateral, `${f.from} -> ${f.to} lateral`).toBeLessThanOrEqual(TUNING.LEVELS_FEED_MAX_LATERAL_M + 1e-9);
      expect(simulateFeedHop(rail(f.from), rail(f.to), f.exitSpeed, f.pop).hit, `${f.from} -> ${f.to} hop`).toBe(true);
    }
    const last = measureFeed(rail('MS-P3'), rail('MS-R7'));
    expect(last?.along).toBeCloseTo(2.0, 6);
    expect(last?.up).toBeCloseTo(1.1, 6);
    expect(last?.lateral).toBeCloseTo(0.5, 6);
    expect(simulateFeedHop(rail('MS-P3'), rail('MS-R7'), 6.0, 'full').hit).toBe(true);
    // The scaffold pipes stand off the annex face by more than the air collision sphere's radius.
    for (const id of ['MS-P1', 'MS-P2', 'MS-P3']) for (const p of rail(id).points) expect(ANNEX_FACE_X - p.x, id).toBeGreaterThan(TUNING.SKATER_RADIUS_M);
  });

  it('every collidable prop at ledge height carries a ledge rail on its top', () => {
    const minH = TUNING.STREET_PROP_RAIL_MIN_H_M;
    const maxH = TUNING.OLLIE_H_FULL_M;
    let railed = 0;
    for (const p of DEF.primitives) {
      if (p.kind !== 'prop' || !p.collidable) continue;
      if (p.size.y < minH || p.size.y > maxH) continue;
      const top = p.at.y + p.size.y;
      const r = DEF.rails.find((x) => x.kind === 'ledge' && x.points.every((q) => Math.abs(q.y - top) < 1e-6 && horiz(q, p.at) <= Math.hypot(p.size.x, p.size.z) / 2));
      expect(r, `${p.id} (${p.size.y} m) has no ledge rail on its top`).toBeDefined();
      railed += 1;
    }
    expect(railed).toBe(9);
  });
});

// ---------------------------------------------------------------------------------------------
// Block 2: builder-backed (skips while buildLevel / validateLevel are stubs)
// ---------------------------------------------------------------------------------------------

const probe = tryImplemented(() => validateLevel(DEF, buildLevel(DEF)));

describe.skipIf(probe === null)('Market Street built (levels builder + validator)', () => {
  const built = buildLevel(DEF);
  const violations = probe ?? [];
  const ray: LevelRaycaster = createLevelRaycaster(built.collider);
  const groundAt = (x: number, z: number, from = 60) => ray.raycast({ x, y: from, z }, DOWN, from + 80);

  it('validateLevel: zero violations', () => {
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it('REQ-LVL-03: every eligible grind line is covered by an AUTHORED rail (the builder adds none)', () => {
    const authored = new Set(DEF.rails.map((r) => r.id));
    const extra = built.rails.filter((r) => !authored.has(r.id)).map((r) => r.id);
    expect(extra).toEqual([]);
    expect(built.rails.length).toBe(LEDGES.length + RAILS.length + COPINGS.length);
  });

  it('REQ-LVL-08: triggers for four letters, the Laptop and SAM, radius 0 = live tuning', () => {
    expect(built.triggers.map((t) => `${t.kind}:${String(t.ref)}`)).toEqual(['letter:C', 'letter:O', 'letter:D', 'letter:E', 'macguffin:secret_laptop', 'npcTalk:sam']);
    for (const t of built.triggers) expect(t.radius).toBe(0);
  });

  it('REQ-STR-03 / REQ-LVL-05: the Laptop is out of straight-up ollie reach at spawn and the 12 spawn-area points', () => {
    const m = DEF.macguffin as NonNullable<LevelDef['macguffin']>;
    const top = built.bounds.max.y + 1;
    const pts = macguffinProbePoints(DEF);
    expect(pts.length).toBe(13);
    for (const [i, q] of pts.entries()) {
      const feet = i === 0 ? DEF.spawn.pos.y : ray.raycast({ x: q.x, y: top, z: q.z }, DOWN, top + 50)?.point.y;
      expect(feet, `probe ${i} has ground`).toBeDefined();
      const best = feet !== undefined ? (feet + TUNING.COLLECT_POINT_UP_M + TUNING.OLLIE_H_FULL_M) : 0;
      // Either too far sideways or too far up.
      const sideways = horiz({ x: q.x, y: 0, z: q.z }, m.pos);
      expect(sideways > TUNING.COLLECT_RADIUS_M || m.pos.y - best > TUNING.COLLECT_RADIUS_M, `probe ${i} at (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`).toBe(true);
      expect(sideways).toBeGreaterThan(20);
    }
    expect(violations.filter((v) => v.rule === 'REQ-LVL-05')).toEqual([]);
    // The check bites: the same Laptop 2 m over spawn fails REQ-LVL-05.
    const cheat = patched(DEF, { macguffin: { id: 'secret_laptop', pos: xzy(46, 30, 0.8 + TUNING.COLLECT_POINT_UP_M + 1.0) } });
    expect(validateLevel(cheat, buildLevel(cheat)).some((v) => v.rule === 'REQ-LVL-05')).toBe(true);
  });

  it('REQ-STR-01 heights: the built collider puts the terrace, plaza, street, roofs, the dock step and the fountain basin where the data says', () => {
    const down = (x: number, z: number, y: number, id?: string): void => {
      const h = groundAt(x, z);
      expect(h, `(${x}, ${z}) has ground`).not.toBeNull();
      expect(h?.point.y, `(${x}, ${z}) height`).toBeCloseTo(y, 5);
      if (id) expect(h?.surfaceId, `(${x}, ${z}) surface`).toBe(id);
    };
    down(46, 30, 0.8, 'MS-T2'); // terrace under spawn
    down(30, 60, 0, 'MS-T1'); // plaza
    down(46, 96, -1.2, 'MS-ST'); // street under the crosswalk
    down(FOUNTAIN_CENTRE.x, FOUNTAIN_CENTRE.z, 0.9, 'MS-F1'); // fountain basin
    down(87.6, 60, 2.4); // closet roof = Q2 deck
    down(98, 76, 1.1, 'MS-D1'); // dock platform
    down(103, 84, 1.1, 'MS-D2'); // dock east step
    down(110, 94, 3.5, 'MS-DB'); // dock roof
    down(86, 96, 3.5, 'MS-DP'); // depot roof
    down(112, 60, 6.0, 'MS-AX'); // annex roof
    down(46, 89.9, -0.6, 'MS-S2'); // S2 fourth tread
    down(46, 42.0, 0.4, 'MS-S1'); // S1 third tread (0.8 m treads from z 40)
    down(92.5, 94, 0, 'MS-PASS'); // the slot floor under the Billboard Gap
    down(89, 60, 0, 'MS-ALLEY'); // the alley transfer lands here
    down(88.4, 60, 2.4, 'MS-EB'); // the closet roof is 1.8 m wide
    down(96, 44, 0, 'MS-ALLEY'); // B5 ends at z 42.4
    down(87.6, 84, 0, 'MS-T1S'); // the mouth south of the closet row
    down(107, 97, 3.5, 'MS-DB'); // roof in front of the mini quarter
    down(20, 39.6, 1.2, 'MS-L3W'); // west terrace ledge
    down(18, 60, 0.45, 'MS-L9'); // west plaza ledge
  });

  it('REQ-LVL-09: the five quarter-pipes and the fountain face are transitions; banks, stairs, hubbas and the kicker are not', () => {
    expect(groundAt(46, 116.5, 10)?.tag).toBe('transition'); // Q1
    expect(groundAt(85, 58, 10)?.tag).toBe('transition'); // Q2
    expect(groundAt(98, 87, 10)?.tag).toBe('transition'); // Q3
    expect(groundAt(1, 80, 10)?.tag).toBe('transition'); // Q4
    const q5 = groundAt(107, 99.3, 10);
    expect(q5?.tag).toBe('transition'); // Q5 on the dock roof
    expect(q5?.surfaceId).toBe('MS-Q5');
    expect(q5?.point.y).toBeGreaterThan(3.6);
    expect(groundAt(FOUNTAIN_CENTRE.x, FOUNTAIN_CENTRE.z - 4.2, 10)?.tag).toBe('transition'); // F1 north face
    expect(groundAt(20, 41, 10)?.tag).toBe('solid'); // B1
    expect(groundAt(41.6, 41, 10)?.tag).toBe('solid'); // L1 hubba
    const k = groundAt(31, 65, 10);
    expect(k?.tag).toBe('solid'); // K1 kicker
    expect(k?.surfaceId).toBe('MS-K1');
    expect(k?.point.y).toBeGreaterThan(0.3);
  });

  it('the Billboard Gap is a real 5 m slot between two 3.5 m roofs and the closet roof has room to land on', () => {
    // Inside the slot heading west: the depot's east wall at x 90; heading east: the dock block's west wall at x 95.
    const west = ray.raycast({ x: 94.9, y: 3.0, z: 94 }, { x: -1, y: 0, z: 0 }, 20);
    expect(west?.surfaceId).toBe('MS-DP');
    expect(west?.point.x).toBeCloseTo(90, 3);
    expect(west?.front).toBe(true);
    const east = ray.raycast({ x: 90.1, y: 3.0, z: 94 }, { x: 1, y: 0, z: 0 }, 20);
    expect(east?.surfaceId).toBe('MS-DB');
    expect(east?.point.x).toBeCloseTo(95, 3);
    // Above the roofs the slot is open air across its whole width.
    expect(ray.raycast({ x: 96, y: 4.0, z: 94 }, { x: -1, y: 0, z: 0 }, 8)).toBeNull();
  });

  it('no slit between the hubbas and the stairs: the floor beside each hubba face is a stair tread, not the plaza', () => {
    for (const x of [41.9, 50.1]) {
      const h = groundAt(x, 41.5, 5);
      expect(h?.surfaceId, `(${x}, 41.5)`).toBe('MS-S1');
      expect(h?.point.y ?? -1, `(${x}, 41.5)`).toBeGreaterThan(0.3);
    }
  });

  it('the bus stop bar exits into the alley: no wall within the run-out at either end, and the mouth floor is level', () => {
    const r2 = rail('MS-R2');
    const a = r2.points[0] as Vec3, b = r2.points[1] as Vec3;
    const runout = TUNING.STREET_WALL_RUNOUT_M;
    for (const [p, dir] of [[b, { x: 1, y: 0, z: 0 }], [a, { x: -1, y: 0, z: 0 }]] as const) {
      // A wall is anything steeper than the wall slope and taller than a full ollie: probe at ollie height.
      const hit = ray.raycast({ x: p.x, y: TUNING.OLLIE_H_FULL_M, z: p.z }, dir, runout);
      expect(hit === null || Math.abs(hit.normal.y) >= 0.5, `${dir.x > 0 ? 'east' : 'west'} exit meets ${hit?.surfaceId ?? ''} at ${hit?.distance.toFixed(1) ?? ''} m`).toBe(true);
      // And the floor along the run-out stays within a curb of the bar's ground.
      for (let d = 0.5; d <= runout; d += 0.5) {
        const g = groundAt(p.x + dir.x * d, p.z, 5);
        expect(g?.point.y ?? -9, `floor ${d} m ${dir.x > 0 ? 'east' : 'west'} of the bar`).toBeGreaterThanOrEqual(-1.2);
        expect(g?.point.y ?? 9, `floor ${d} m ${dir.x > 0 ? 'east' : 'west'} of the bar`).toBeLessThanOrEqual(0.01);
      }
    }
    // The mouth: from the pocket east of the bank into the alley at floor level, the first thing
    // ahead is the loading dock (1.1 m, an ollie up) a full run-out away, not the closet wall 3.7 m out.
    const mouth = ray.raycast({ x: 83, y: 0.5, z: 86.5 }, { x: 1, y: 0, z: 0 }, 20);
    expect(mouth?.surfaceId, 'the pocket east of the bank opens into the alley').toBe('MS-D1');
    expect(mouth?.distance ?? 0).toBeGreaterThanOrEqual(runout);
    // The bar's posts stand on the flat plaza (the brick bus-stop paving), not on the curb bank.
    for (const p of r2.points) {
      const g = groundAt(p.x, p.z, 5);
      expect(g?.surfaceId).toBe('MS-T1K');
      expect(g?.point.y).toBeCloseTo(0, 5);
    }
  });

  it('the alley strip beside the annex ends in a bank up to the dock step, not the dock block wall', () => {
    for (const x of [102, 104.3]) {
      const hit = ray.raycast({ x, y: 0.5, z: 60 }, { x: 0, y: 0, z: 1 }, 40);
      expect(hit?.surfaceId, `strip at x ${x}`).toBe('MS-D2B');
      expect(hit?.normal.y ?? 0, `strip at x ${x} meets a slope`).toBeGreaterThan(0.5);
    }
    // On the step, heading south, the next surface is the dock quarter's transition.
    const onStep = ray.raycast({ x: 102, y: 1.6, z: 81 }, { x: 0, y: 0, z: 1 }, 10);
    expect(onStep?.surfaceId).toBe('MS-Q3');
    expect(onStep?.tag).toBe('transition');
  });

  it('the scaffold pipes stand off the annex face by more than the air sphere radius and the climb never enters the wall', () => {
    for (const id of ['MS-P1', 'MS-P2', 'MS-P3']) {
      for (const p of rail(id).points) {
        const hit = ray.raycast({ x: p.x, y: p.y + TUNING.AIR_SPHERE_UP_M, z: p.z }, { x: 1, y: 0, z: 0 }, 5);
        expect(hit?.surfaceId, `${id} at z ${p.z}`).toBe('MS-AX');
        expect(hit?.distance ?? 0, `${id} at z ${p.z}: wall ${hit?.distance.toFixed(2)} m away`).toBeGreaterThan(TUNING.SKATER_RADIUS_M);
      }
    }
    // The roof rail sits just inside the roof edge, above the roof.
    for (const p of rail('MS-R7').points) {
      const g = groundAt(p.x, p.z, 10);
      expect(g?.surfaceId).toBe('MS-AX');
      expect(p.y - (g?.point.y ?? 0)).toBeCloseTo(0.3, 5);
    }
  });

  it('every ledge rail on a prop, the dock and the handrails sits on its surface', () => {
    const onSurface = (id: string, surface: string, above = 0): void => {
      for (const p of rail(id).points) {
        const g = groundAt(p.x, p.z, p.y + 3);
        expect(g?.surfaceId, `${id} at (${p.x}, ${p.z})`).toBe(surface);
        expect(p.y - (g?.point.y ?? -9), `${id} at (${p.x}, ${p.z}) height over ${surface}`).toBeCloseTo(above, 3);
      }
    };
    for (const p of DEF.primitives) {
      if (p.kind !== 'prop' || !p.collidable) continue;
      const r = DEF.rails.find((x) => x.name && x.kind === 'ledge' && x.points.every((q) => Math.abs(q.y - (p.at.y + p.size.y)) < 1e-6 && horiz(q, p.at) <= Math.hypot(p.size.x, p.size.z) / 2));
      if (r) onSurface(r.id, p.id);
    }
    onSurface('MS-L10', 'MS-D1');
    onSurface('MS-L11', 'MS-D1');
    onSurface('MS-L6', 'MS-D1');
    // Stair handrails: over the landing at the top, the treads along the run and the street at the last 0.6 m.
    for (const id of ['MS-R3', 'MS-R4']) {
      const [a, b] = rail(id).points as [Vec3, Vec3];
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = a.x, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        const g = groundAt(x, z, 5);
        expect(t < 1 ? ['MS-S2', 'MS-S2L'] : ['MS-S2', 'MS-ST'], `${id} ${t}`).toContain(g?.surfaceId);
        const over = y - (g?.point.y ?? -9);
        expect(over, `${id} ${t}: ${over.toFixed(2)} m over the step`).toBeGreaterThanOrEqual(0.5);
        expect(over, `${id} ${t}`).toBeLessThanOrEqual(1.2);
      }
    }
    // The yawed corner planter's rail follows the prop's rotated top.
    const p5 = prim('MS-PR-PLANTER5') as PropPrim;
    expect(p5.yawDeg).toBe(25);
    onSurface('MS-PL5', 'MS-PR-PLANTER5');
  });

  it('no pocket under a floor: every cell reachable from the street air has a floor under it (flood fill, 0.5 m cells)', () => {
    // Reachable space = cells joined by unobstructed rays, from the air over the crosswalk. A reached
    // cell whose down ray finds nothing before the lowest floor is a void the skater can fall into
    // (the pockets under MS-SOUTH east of MS-B3 and under the plaza floor east of MS-B4E).
    const H = 0.5, nx = Math.round(DEF.size.x / H), nz = Math.round(DEF.size.z / H);
    const ys = Array.from({ length: 21 }, (_, k) => -1.0 + 0.4 * k);
    const ny = ys.length;
    const cell = (id: number): Vec3 => ({ x: (id % nx) * H + H / 2, y: ys[Math.floor(id / (nx * nz))] as number, z: (Math.floor(id / nx) % nz) * H + H / 2 });
    const seen = new Uint8Array(nx * nz * ny);
    const start = Math.floor(96 / H) * nx + Math.floor(46 / H); // (46, -1.0, 96): over the crosswalk
    seen[start] = 1;
    const queue = [start];
    const steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (let h = 0; h < queue.length; h++) {
      const id = queue[h] as number;
      const i = id % nx, j = Math.floor(id / nx) % nz, k = Math.floor(id / (nx * nz));
      const o = cell(id);
      for (const [di, dj, dk] of steps) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= nz || c >= ny) continue;
        const n = (c * nz + b) * nx + a;
        if (seen[n]) continue;
        const t = cell(n);
        const d = { x: t.x - o.x, y: t.y - o.y, z: t.z - o.z };
        if (ray.raycast(o, d, Math.hypot(d.x, d.y, d.z))) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    expect(queue.length).toBeGreaterThan(100000); // the flood really spread over the park
    const voids: string[] = [];
    for (const id of queue) {
      const o = cell(id);
      if (!ray.raycast(o, DOWN, o.y + 2.5)) voids.push(`(${o.x}, ${o.y.toFixed(1)}, ${o.z})`);
    }
    expect(voids.slice(0, 12), `${voids.length} reachable cells over nothing`).toEqual([]);
  });

  it('the D letter is collectable from a rim air: the face under it is the rim edge, not the outer face 1 m out', () => {
    const d = DEF.letters.find((l) => l.letter === 'D')?.pos as Vec3;
    const g = groundAt(d.x, d.z, 5);
    expect(g?.surfaceId).toBe('MS-F1');
    expect(g?.point.y ?? 0).toBeGreaterThan(FOUNTAIN_RIM_Y - 0.15);
  });
});

// ---------------------------------------------------------------------------------------------
// Block 3: the real world on Market Street (skips while any stub in the sim chain throws)
// ---------------------------------------------------------------------------------------------

describe.skipIf(!worldAvailable() || probe === null)('Market Street on the real world (lines, letters, pockets)', () => {
  const level = buildLevel(DEF);
  type Btn = 'ollie' | 'grind';
  const gaps = (r: Rig): string[] => r.of('gap').map((g) => g.gapId);
  const letters = (r: Rig): string[] => r.of('letter').map((l) => l.letter);
  /** Roll from `pos` along `dir` at `speed`, holding Cross from `holdFrom` until `release` along `axis` (null = no ollie). */
  const rollAndPop = (pos: Vec3, dir: Vec3, speed: number, axis: 'x' | 'z', holdFrom: number, release: number | null, maxTicks = 400): Rig => {
    const r = new Rig({ level, mode: 'career' });
    r.teleport(pos, dir, speed);
    const sgn = Math.sign(axis === 'x' ? dir.x : dir.z);
    let popped = release === null;
    for (let i = 0; i < maxTicks; i++) {
      const s = r.snap.skater;
      const at = (axis === 'x' ? s.pos.x : s.pos.z) * sgn;
      let buttons: Btn[] = [];
      if (!popped && s.state !== 'Air') {
        if (at >= holdFrom * sgn && at < (release as number) * sgn) buttons = ['ollie'];
        else if (at >= (release as number) * sgn) popped = true;
      }
      r.hold(1, { buttons });
      if (r.of('bail').length > 0 || (popped && r.of('land').length > 0)) break;
    }
    r.hold(20);
    return r;
  };

  it('rolling off the east end of MS-B3 or MS-B4E stays on a floor (no fall under the sidewalk)', () => {
    for (const [z0, dz] of [[104.2, 1], [86.2, -1]] as const) {
      for (const hdg of [20, 35, 50]) {
        const a = (hdg * Math.PI) / 180;
        const d = { x: Math.sin(a), y: 0, z: Math.cos(a) * dz };
        const r = new Rig({ level, mode: 'free' });
        r.teleport({ x: 81.5 - d.x * 3, y: -1.2, z: z0 - d.z * 3 }, d, 7);
        let minY = Infinity;
        for (let i = 0; i < 360; i++) {
          r.hold(1);
          minY = Math.min(minY, r.snap.skater.pos.y);
        }
        expect(minY, `z0 ${z0} heading ${hdg}: fell to y ${minY.toFixed(2)}`).toBeGreaterThan(-1.3);
      }
    }
  });

  it('line 1: a charged stair-set air on the line earns MS-G05 and takes the C every time', () => {
    const line1 = MARKET_STREET_LINES[0] as (typeof MARKET_STREET_LINES)[number];
    const air = line1.steps.find((s) => s.feature === 'MS-G05') as LineStep;
    let earned = 0;
    for (const v of [6, 7, 8]) {
      for (const rel of [86.5, 87.0, 87.5, 88.0]) {
        const r = rollAndPop({ x: air.from.x, y: 0, z: 78 }, { x: 0, y: 0, z: 1 }, v, 'z', rel - (v * 40) / 120, rel);
        if (!gaps(r).includes('MS-G05')) continue;
        earned += 1;
        expect(letters(r), `${v} m/s release z ${rel}`).toContain('C');
      }
    }
    expect(earned).toBeGreaterThanOrEqual(6);
  });

  it('line 2: the pop off MS-Q3 onto the dock roof works across a metre of the face and from a plain roll-off', () => {
    for (const v of [7.5, 8, 9, 10]) {
      for (const rel of [86.6, 86.9, 87.2]) {
        const r = rollAndPop({ x: 101.4, y: 1.1, z: 81 }, { x: 0, y: 0, z: 1 }, v, 'z', 84.8, rel);
        expect(gaps(r), `${v} m/s release z ${rel}`).toContain('MS-G09');
      }
    }
    for (const v of [8, 9, 10]) {
      const r = rollAndPop({ x: 101.4, y: 1.1, z: 81 }, { x: 0, y: 0, z: 1 }, v, 'z', 0, null);
      expect(gaps(r), `${v} m/s roll-off`).toContain('MS-G09');
    }
  });

  it('line 2: every charged ollie that clears the Billboard Gap takes the O', () => {
    let earned = 0;
    for (const v of [8, 9, 10]) {
      for (const hold of [40, 72]) {
        for (const rel of [95.2, 95.6, 96.0]) {
          const r = rollAndPop({ x: 101, y: 3.5, z: 93.5 }, { x: -1, y: 0, z: 0 }, v, 'x', rel + (v * hold) / 120, rel);
          if (!gaps(r).includes('MS-G10')) continue;
          earned += 1;
          expect(letters(r), `${v} m/s hold ${hold} release x ${rel}`).toContain('O');
        }
      }
    }
    expect(earned).toBeGreaterThanOrEqual(10);
  });

  it('line 2: on the O lane the Billboard Gap and the O pay in the same air (no mid-air snap onto MS-R6)', () => {
    // Polish round 2: with the vent pipe under the O (z 94) a charged slot ollie snapped it mid-air,
    // the air ended in a grind and MS-G10 fired on about 1 run in 10.
    let withO = 0;
    for (const z of [93.5, 94, 94.5]) {
      for (const v of [7, 8, 9, 10, 11]) {
        for (const hold of [40, 72]) {
          for (const rel of [95.2, 95.6, 96.0]) {
            const r = rollAndPop({ x: 101, y: 3.5, z }, { x: -1, y: 0, z: 0 }, v, 'x', rel + (v * hold) / 120, rel);
            // Taking the O at 7 m/s from a late release can still fall into the slot: that run did not clear.
            const end = r.snap.skater.pos;
            if (!letters(r).includes('O') || end.x >= 90 || end.y < 3.4) continue;
            withO += 1;
            const label = `z ${z} ${v} m/s hold ${hold} release x ${rel}`;
            expect(r.of('grindStart').map((g) => g.railId), label).not.toContain('MS-R6');
            expect(gaps(r), label).toContain('MS-G10');
          }
        }
      }
    }
    expect(withO).toBeGreaterThanOrEqual(70);
    // Line 2's next step: from the landing, a carve south-west and a grind tap put the skater on MS-R6.
    for (const v of [5, 7, 9]) {
      for (const deg of [25, 36, 45]) {
        const a = (deg * Math.PI) / 180;
        const r = new Rig({ level, mode: 'career' });
        r.teleport({ x: 89.9, y: 3.5, z: 94 }, { x: -Math.cos(a), y: 0, z: Math.sin(a) }, v);
        for (let i = 0; i < 240 && r.of('grindStart').length === 0; i++) {
          r.hold(1, r.snap.skater.pos.z > 96 && i % 2 === 0 ? { buttons: ['grind'] } : {});
        }
        expect(r.of('grindStart').map((g) => g.railId), `${v} m/s carve ${deg} deg`).toContain('MS-R6');
        expect(r.of('bail'), `${v} m/s carve ${deg} deg`).toEqual([]);
      }
    }
  });

  it('line 3: off the end of MS-R1 into the fountain never bails, and from 6 m/s the rim air takes the D', () => {
    let dCount = 0;
    for (const v of [6, 7, 8]) {
      for (const hop of [null, 55.5, 56]) {
        const r = new Rig({ level, mode: 'career' });
        r.teleport({ x: 50.2, y: 0.7, z: 49.4 }, { x: 0, y: 0, z: 1 }, v);
        r.hold(1, { buttons: ['grind'] });
        let held = 0;
        for (let i = 0; i < 600; i++) {
          const s = r.snap;
          let h = r.holdBalance(s);
          if (hop !== null && held <= 6 && s.skater.state === 'Grind' && s.skater.pos.z >= hop - (v * 6) / 120) {
            h = held < 6 ? { buttons: ['ollie'] } : {};
            held += 1;
          }
          r.hold(1, h);
          if (r.of('bail').length > 0) break;
        }
        expect(r.of('bail').map((b) => `${b.reason} at z ${b.pos.z.toFixed(2)}`), `${v} m/s hop ${hop}`).toEqual([]);
        if (letters(r).includes('D')) dCount += 1;
      }
    }
    expect(dCount).toBeGreaterThanOrEqual(8);
  });

  it('line 3: at the speed the line brings to MS-L2, a tap or a full pop off the hubba top grinds MS-PL2', () => {
    // Polish round 2: line 3 reaches L2 at 5.1 to 5.5 m/s and the uphill hubba bleeds that to about
    // 2.5 m/s at its top; with the planter 3 m past the top, every pop fell short onto the terrace.
    const line3 = MARKET_STREET_LINES[2] as (typeof MARKET_STREET_LINES)[number];
    const pl2 = line3.steps.find((s) => s.feature === 'MS-PL2') as LineStep;
    let slowest = Infinity;
    for (const v of [5.1, 5.5, 6, 7]) {
      for (const charge of [6, 40]) {
        for (const lead of [0.3, 0.8, 1.5]) {
          const r = new Rig({ level, mode: 'career' });
          r.teleport({ x: 50.4, y: 0.45, z: 45.6 }, { x: 0, y: 0, z: -1 }, v);
          r.hold(1, { buttons: ['grind'] });
          let held = 0, released = false;
          for (let i = 0; i < 400; i++) {
            const s = r.snap, sk = s.skater;
            let h = r.holdBalance(s);
            // Start the charge so a full pop releases about `lead` m before the top at the hubba's exit speed.
            if (!released && sk.state === 'Grind' && sk.pos.z <= 38 + lead + (charge > 6 ? (2.5 * charge) / 120 : 0)) {
              held += 1;
              h = { ...h, buttons: ['ollie'] };
            }
            if (!released && held > 0 && (held > charge || sk.state !== 'Grind')) {
              released = true;
              slowest = Math.min(slowest, Math.hypot(sk.vel.x, sk.vel.z));
              h = {};
            }
            if (released && sk.state === 'Air' && sk.pos.z < pl2.from.z) h = { buttons: ['grind'] };
            r.hold(1, h);
            if (r.of('bail').length > 0 || (released && (r.of('land').length > 0 || r.of('grindStart').some((g) => g.railId === 'MS-PL2')))) break;
          }
          const label = `${v} m/s charge ${charge} lead ${lead}`;
          expect(r.of('bail'), label).toEqual([]);
          expect(r.of('grindStart').map((g) => g.railId), label).toContain('MS-PL2');
        }
      }
    }
    // The slowest pop tried is at or under the step's recorded minSpeed.
    expect(slowest).toBeLessThanOrEqual((pl2.minSpeed ?? 0) + 0.1);
  });
});
