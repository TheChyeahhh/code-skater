// tests/simParks.test.ts (sim track): the REAL world on the two finished parks, Market Street and
// Woodshed, built by the real builder (reached through tryImplemented, ARCHITECTURE.md section 10).
// Coordinates come from the level data (rails, primitives, letters), so the parks can be polished
// without breaking these checks. Covers the e2e "grind a known rail for 2 s and bank" scenario, the
// tick budget, determinism, and the park-only mechanics: full-pipe launch (REQ-VRT-11), spine
// transfer timing (REQ-VRT-08) and the vert-wall transfer onto the deck (Over the Vert).
import { afterEach, describe, expect, it } from 'vitest';
import { tryImplemented } from '../src/core/contract';
import { resetTuning, TUNING } from '../src/core/tuning';
import type { SimSnapshot, Vec3 } from '../src/core/types';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { buildLevel } from '../src/levels/builder';
import { MARKET_STREET } from '../src/levels/marketStreet';
import type { BuiltLevel, FullPipePrim, LevelDef, QuarterPipePrim, RailDef, SpinePrim } from '../src/levels/types';
import { WOODSHED } from '../src/levels/woodshed';
import { createCollisionWorld } from '../src/sim/collision';
import { replay } from '../src/sim/debug';
import { createWorld } from '../src/sim/world';
import { describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

afterEach(() => resetTuning());

const P = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const parkOf = (def: LevelDef): BuiltLevel | null => tryImplemented(() => buildLevel(def));
const street = parkOf(MARKET_STREET);
const woodshed = parkOf(WOODSHED);
const ready = worldAvailable() && street !== null && woodshed !== null;

function railOf(level: BuiltLevel, id: string): RailDef {
  const r = level.def.rails.find((x) => x.id === id);
  if (!r) throw new Error(`no rail ${id}`);
  return r;
}

function prim<T>(level: BuiltLevel, id: string): T {
  const p = level.def.primitives.find((x) => x.id === id);
  if (!p) throw new Error(`no primitive ${id}`);
  return p as T;
}

/** Height of the walkable surface under (x, z), from 20 m up. */
function floorAt(level: BuiltLevel, x: number, z: number): number {
  const hit = createCollisionWorld(level.collider).raycast(P(x, 20, z), P(0, -1, 0), 40);
  if (!hit) throw new Error(`no floor at ${x}, ${z}`);
  return hit.point.y;
}

/** Ground snap onto a rail from its first point: roll along it on the floor below, Triangle inside the magnet. */
function groundGrind(level: BuiltLevel, railId: string, speed: number): Rig {
  const rail = railOf(level, railId);
  const a = rail.points[0] as Vec3;
  const b = rail.points[1] as Vec3;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const d = P((b.x - a.x) / len, 0, (b.z - a.z) / len);
  const start = P(a.x - d.x * 2, 0, a.z - d.z * 2);
  const r = new Rig({ level });
  r.teleport(P(start.x, floorAt(level, start.x, start.z), start.z), d, speed);
  expect(r.snap.skater.state).toBe('Grounded');
  r.run(900, (s) => {
    if (s.skater.state === 'Grind') return r.holdBalance(s);
    const along = (s.skater.pos.x - a.x) * d.x + (s.skater.pos.z - a.z) * d.z;
    return r.of('grindStart').length === 0 && along > -0.45 ? { buttons: ['grind'] } : {};
  }, (s) => s.skater.state === 'Grounded' && r.of('grindStart').length > 0);
  return r;
}

describe.skipIf(!ready)('both parks on the real world', () => {
  for (const [name, level] of [['Market Street', street], ['Woodshed', woodshed]] as const) {
    if (!level) continue;
    it(`${name}: spawns Grounded on the authored spawn, ollies, kickflips and banks 100`, () => {
      const r = new Rig({ level });
      const sp = level.spawn.pos;
      expect(r.snap.skater.state).toBe('Grounded');
      expect(r.snap.skater.pos.x).toBeCloseTo(sp.x, 6);
      expect(r.snap.skater.pos.z).toBeCloseTo(sp.z, 6);
      expect(r.snap.skater.pos.y).toBeCloseTo(sp.y, 3);
      r.hold(60, { dpad: 'U' });
      r.hold(20, { buttons: ['ollie'] });
      r.hold(1);
      r.hold(1, { buttons: ['flip'] });
      r.run(300, () => ({}), (s) => s.skater.state === 'Grounded');
      expect(r.last('comboBanked')?.final, describeEvents(r.events)).toBe(100);
    });

    it(`${name}: a tick costs well under 1 ms (skating, turning and ollieing for 20 s)`, () => {
      const r = new Rig({ level });
      const t0 = globalThis.performance.now();
      r.run(2400, (_s, i) => ({ dpad: i % 240 < 180 ? 'U' : 'L', buttons: i % 100 < 30 ? ['ollie'] : [] }));
      const perTick = (globalThis.performance.now() - t0) / 2400;
      expect(perTick).toBeLessThan(0.5);
    });

    it(`${name}: same inputs, same run (determinism on a real park)`, () => {
      const timeline = [
        { atTick: 0, input: { dpad: 'U' as const } },
        { atTick: 100, input: { held: { ollie: true } } },
        { atTick: 140, input: { held: { ollie: false }, dpad: 'R' as const } },
        { atTick: 150, input: { held: { grab: true } } },
        { atTick: 170, input: { held: { grab: false }, dpad: 'U' as const } },
      ];
      const go = (): string => {
        const world = createWorld({ level, mode: 'career', seed: 11, collectedMacGuffins: [], completedGoals: [] });
        const out = replay(world, createFrameBuilder(), timeline, 480);
        return JSON.stringify([out.snapshots, out.events]);
      };
      expect(go()).toBe(go());
    });
  }

  it('Market Street: the terrace ledge MS-L3 ground snap holds a grind over 2 s, rail end, lands and banks', () => {
    if (!street) return;
    const r = groundGrind(street, 'MS-L3', 7);
    const log = describeEvents(r.events);
    expect(r.last('grindStart')?.railId, log).toBe('MS-L3');
    expect(r.last('grindEnd')?.reason).toBe('railEnd');
    expect(r.last('grindEnd')?.heldS).toBeGreaterThan(2);
    expect(r.of('bail')).toEqual([]);
    const held = r.last('grindEnd')?.heldS ?? 0;
    expect(r.last('comboBanked')?.final).toBe(TUNING.BASE_FIFTY_FIFTY + Math.round(TUNING.HOLD_FIFTY_FIFTY * held));
  });

  it('Woodshed: the long bar WS-RA ground snap holds over 2 s and banks (the 20 s chain starts here)', () => {
    if (!woodshed) return;
    const r = groundGrind(woodshed, 'WS-RA', 6);
    expect(r.last('grindStart')?.railId, describeEvents(r.events)).toBe('WS-RA');
    expect(r.last('grindEnd')?.heldS).toBeGreaterThan(2);
    expect(r.last('comboBanked')?.final).toBeGreaterThan(0);
  });

  it('Market Street: the Bus Stop Bar gap is earned mid-grind, joins the line when the grind closes, and completes goal 7', () => {
    if (!street) return;
    const bar = railOf(street, 'MS-R2');
    const a = bar.points[0] as Vec3;
    const b = bar.points[1] as Vec3;
    const d = Math.sign(b.x - a.x);
    const r = new Rig({ level: street, mode: 'career' });
    r.teleport(P(a.x + d * 0.4, a.y + 0.1, a.z), P(d, 0, 0), 7);
    r.hold(1, { buttons: ['grind'] });
    expect(r.last('grindStart')?.railId).toBe('MS-R2');
    r.run(900, (s) => (s.skater.state === 'Grind' ? r.holdBalance(s) : {}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
    const log = describeEvents(r.events);
    const gap = r.last('gap');
    const end = r.last('grindEnd');
    expect(gap?.gapId, log).toBe('MS-G07');
    expect(gap?.tick).toBeLessThan(end?.tick ?? 0);
    // The grind kept accruing after the gap: its hold covers the whole bar.
    expect(end?.reason).toBe('railEnd');
    expect(r.of('elementAdded').map((e) => e.element.id)).toEqual(['fifty_fifty', 'gap:MS-G07']);
    expect(r.of('elementAdded')[1]?.tick).toBe(end?.tick);
    const bank = r.last('comboBanked');
    expect(bank?.final, log).toBe(Math.floor((100 + Math.round(80 * (end?.heldS ?? 0)) + 500) * 2 + 1e-6));
    expect(r.of('goalCompleted').map((g) => g.goalId)).toContain('MS-GOAL-07');
  });

  /** Across WS-FP1 at x from its floor line heading south at `speed`; Cross held `hold` ticks ending just before the launch. */
  const pipeAir = (x: number, speed: number, hold: number): { r: Rig; apex: number } => {
    if (!woodshed) throw new Error('no woodshed');
    const fp = prim<FullPipePrim>(woodshed, 'WS-FP1');
    const start = P(x, 0, fp.a.z);
    const probe = new Rig({ level: woodshed });
    probe.teleport(start, P(0, 0, 1), speed);
    probe.run(400, () => ({}), (s) => s.skater.state === 'Air');
    const launchTick = probe.tick - 1;
    const r = new Rig({ level: woodshed });
    r.teleport(start, P(0, 0, 1), speed);
    let apex = 0;
    r.run(500, (s) => {
      apex = Math.max(apex, s.skater.pos.y);
      return r.tick >= launchTick - hold - 1 && r.tick < launchTick - 1 ? { buttons: ['ollie'] } : {};
    }, () => r.of('land').length > 0 || r.of('bail').length > 0);
    return { r, apex };
  };

  it('Woodshed REQ-VRT-11: a 9.7 m/s full-pop full-pipe air clears the overhanging wall and lands flat (< 35 deg)', () => {
    if (!woodshed) return;
    const fp = prim<FullPipePrim>(woodshed, 'WS-FP1');
    // 9.7 m/s at transition gravity x 0.3 (CR-44) meets the 4.0 m line as fast as 11 m/s did at x 0.45.
    const { r, apex } = pipeAir((fp.a.x + fp.b.x) / 2, 9.7, 72);
    expect(r.of('bail'), describeEvents(r.events)).toEqual([]);
    expect(r.of('pop')[0]?.charge).toBe(1);
    expect(apex).toBeGreaterThan(fp.a.y + 1.5);
    expect(r.snap.skater.surface?.surfaceId).toBe('WS-FP1');
    // The return lands on the lower wall, flat enough for a manual and never a revert.
    expect(r.snap.skater.surface?.flags.slopeDeg).toBeLessThan(TUNING.FLAT_MAX_SLOPE_DEG);
    expect(r.last('land')?.vert).toBe(false);
  });

  it('Woodshed REQ-VRT-11: letter D inside the pipe is collected at 9.5 m/s with a tap', () => {
    if (!woodshed) return;
    const d = woodshed.def.letters.find((l) => l.letter === 'D');
    if (!d) return;
    const { r } = pipeAir(d.pos.x, 9.5, 1);
    expect(r.of('letter').map((e) => e.letter), describeEvents(r.events)).toEqual(['D']);
    expect(r.of('bail')).toEqual([]);
  });

  it('Woodshed REQ-VRT-08: R2 0.25 s after leaving the spine coping lands on the far face, steep enough to revert', () => {
    if (!woodshed) return;
    const sp = prim<SpinePrim>(woodshed, 'WS-SP1');
    const r = new Rig({ level: woodshed });
    r.teleport(P(sp.centre - 9, 0, sp.span[0] + 8), P(1, 0, 0), 11);
    r.run(600, (s) => (s.skater.state === 'Air' && s.skater.stateTicks >= 30 && s.skater.stateTicks < 32 ? { buttons: ['revert'] } : {}),
      () => r.of('land').length > 0 || r.of('bail').length > 0);
    const land = r.last('land');
    expect(r.last('transfer')?.railId, describeEvents(r.events)).toMatch(/^WS-SP1-[WE]$/);
    expect(land?.pos.x).toBeGreaterThan(sp.centre);
    expect(land?.vert).toBe(true);
    expect(sp.copingHeight - (land?.pos.y ?? 0)).toBeLessThanOrEqual(1.2);
    expect(sp.copingHeight - (land?.pos.y ?? 0)).toBeGreaterThan(0);
  });

  it('Woodshed: the vert wall coping is a transfer too: R2 mirrors onto the deck and earns Over the Vert (1200)', () => {
    if (!woodshed) return;
    const vw = prim<QuarterPipePrim>(woodshed, 'WS-VW1');
    const r = new Rig({ level: woodshed });
    r.teleport(P(vw.footLine - 9, 0, (vw.span[0] + vw.span[1]) / 2), P(1, 0, 0), 11);
    r.run(600, (s) => (s.skater.state === 'Air' && s.skater.stateTicks >= 20 && s.skater.stateTicks < 22 ? { buttons: ['revert'] } : {}),
      () => r.of('land').length > 0 || r.of('bail').length > 0);
    const log = describeEvents(r.events);
    const land = r.last('land');
    expect(r.last('transfer')?.railId, log).toBe(vw.copingRailId);
    expect(land?.pos.x).toBeGreaterThan(vw.copingLine);
    // The deck behind the coping sits at the coping height (DESIGN E.9: lands at x 84.3, y 3.6).
    expect(land?.pos.y).toBeCloseTo(vw.copingHeight, 3);
    expect(land?.vert).toBe(false);
    expect(r.last('gap')).toMatchObject({ gapId: 'WS-G06', base: 1200 });
  });
});

describe.skipIf(!ready)('polish round 2 (sim fixes) on the parks', () => {
  it('Woodshed: a 20 deg carve up WS-VW1 at 11 m/s with R2 still goes Over the Vert (launch on the plane, pushed onto the deck)', () => {
    if (!woodshed) return;
    const vw = prim<QuarterPipePrim>(woodshed, 'WS-VW1');
    const a = (20 * Math.PI) / 180;
    const r = new Rig({ level: woodshed });
    r.teleport(P(vw.footLine - 11, 0, 35), P(Math.cos(a), 0, Math.sin(a)), 11);
    r.run(600, (s) => (s.skater.state === 'Air' && s.skater.stateTicks >= 20 && s.skater.stateTicks < 22 ? { buttons: ['revert'] } : r.holdBalance(s)),
      () => r.of('land').length > 0 || r.of('bail').length > 0 || r.of('grindStart').length > 0);
    const log = describeEvents(r.events);
    expect(r.last('transfer')?.railId, log).toBe(vw.copingRailId);
    // The launch sat on the plane (x 84.00): the push used to point back at the ramp (vx -0.4).
    const after = r.snaps.find((x) => x.tick === (r.last('transfer')?.tick ?? -1));
    expect(after?.skater.vel.x, log).toBeGreaterThan(0);
    expect(r.of('gap').map((g) => g.gapId), log).toContain('WS-G06');
    expect(r.of('bail'), log).toEqual([]);
    // Onto the deck, or the WS-OV grind the descent passes over (DESIGN E.9 edge cases).
    const land = r.last('land');
    const ov = r.of('grindStart').some((g) => g.railId === 'WS-OV');
    expect(ov || (land !== undefined && land.pos.x > vw.copingLine && Math.abs(land.pos.y - vw.copingHeight) < 1e-3), log).toBe(true);
  });

  it('Woodshed WS-RA -> WS-RB: Triangle mashed from the pop never re-snaps WS-RA on the way up and catches WS-RB', () => {
    if (!woodshed) return;
    const ra = railOf(woodshed, 'WS-RA');
    const a = ra.points[0] as Vec3;
    const end = ra.points[ra.points.length - 1] as Vec3;
    for (const k of [1, 2, 4, 8]) {
      const r = new Rig({ level: woodshed });
      r.teleport(P(a.x + 2, a.y + 0.2, a.z), P(1, 0, 0), 7.5);
      r.hold(1, { buttons: ['grind'] });
      expect(r.snap.skater.state).toBe('Grind');
      let popAt = -1;
      r.run(400, (s, i) => {
        if (popAt < 0 && s.skater.state === 'Grind' && s.skater.pos.x >= end.x - 1) popAt = i;
        if (popAt >= 0 && i < popAt + 2) return { buttons: ['ollie'] };
        if (popAt >= 0 && i >= popAt + 2 + k && (i - popAt - 2 - k) % 4 === 0 && s.skater.state === 'Air') return { buttons: ['grind'] };
        return r.holdBalance(s);
      }, () => r.of('grindStart').length >= 2 || r.of('land').length > 0 || r.of('bail').length > 0);
      expect(r.of('grindStart').map((g) => g.railId), `Triangle ${k} ticks after the pop: ${describeEvents(r.events)}`).toEqual(['WS-RA', 'WS-RB']);
    }
  });

  it('Market Street MS-R2: tap Cross + Triangle spam re-grinds the bar only after a real hop (one element per hop, no farming)', () => {
    if (!street) return;
    const r2 = railOf(street, 'MS-R2');
    const a = r2.points[0] as Vec3;
    const r = new Rig({ level: street });
    r.teleport(P(a.x + 0.5, a.y + 0.3, a.z), P(1, 0, 0), 7);
    r.hold(1, { buttons: ['grind'] });
    expect(r.snap.skater.state).toBe('Grind');
    let c = 0;
    r.run(600, (s) => {
      c += 1;
      const cyc = c % 7;
      return r.holdBalance(s, cyc < 3 ? { buttons: ['ollie'] } : cyc >= 5 ? { buttons: ['grind'] } : {});
    }, (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail' || s.skater.pos.x > 79);
    const log = describeEvents(r.events);
    const pops = r.of('pop').filter((p) => p.from === 'Grind');
    const snaps = r.of('grindStart').filter((g) => g.railId === 'MS-R2');
    expect(pops.length, log).toBeGreaterThan(0);
    // Every re-snap after a pop comes after that air's apex: the skater is coming DOWN onto the bar.
    for (const g of snaps.slice(1)) {
      const before = r.snaps.find((x) => x.tick === g.tick - 1);
      expect(before?.skater.vel.y ?? 1, `re-snap at ${g.tick}: ${log}`).toBeLessThanOrEqual(0);
    }
    // A hop takes a rise and a fall (0.4 s or more at the tap pop), so 600 ticks hold only a handful.
    expect(snaps.length, log).toBeLessThanOrEqual(1 + pops.length);
    expect(snaps.length, log).toBeLessThan(10);
  });

  it('Market Street line 3: a hop off the MS-R1 end into the fountain foot keeps its speed (no dead stop on the rising face)', () => {
    if (!street) return;
    for (const v of [8, 9]) {
      for (const hop of [55.5, 56, 56.5]) {
        const r = new Rig({ level: street });
        r.teleport(P(50.2, 0.7, 49.4), P(0, 0, 1), v);
        r.hold(1, { buttons: ['grind'] });
        let held = 0;
        r.run(600, (s) => {
          if (held <= 6 && s.skater.state === 'Grind' && s.skater.pos.z >= hop - (v * 6) / 120) {
            held += 1;
            return held <= 6 ? { buttons: ['ollie'] } : {};
          }
          return r.holdBalance(s);
        }, () => r.of('land').length > 0 || r.of('bail').length > 0);
        const land = r.last('land');
        expect(r.of('bail'), `${v} m/s hop ${hop}`).toEqual([]);
        // The plain C.6 projection left 0.46 to 2.9 m/s here; the horizontal travel projected on the face keeps most of it.
        // At g 20 (CR-65) the late hop lands higher on the steeper part of the foot, so the floor is 0.35 v (still no dead stop).
        expect(land?.speed ?? 0, `${v} m/s hop ${hop}: ${describeEvents(r.events)}`).toBeGreaterThan(0.35 * v);
      }
    }
  });

  it('a MacGuffin held from the save does not re-complete its goal in a later career run', () => {
    if (!street) return;
    const r = new Rig({ level: street, mode: 'career', collectedMacGuffins: ['secret_laptop'], completedGoals: ['MS-GOAL-06'], runLengthS: 2 });
    r.run(2 * 120 + 400, () => ({}), (s) => s.run.ended);
    expect(r.of('goalCompleted').map((g) => g.goalId)).toEqual([]);
    expect(r.last('runEnd')?.goalsCompleted).toEqual([]);
    expect(r.last('runEnd')?.macguffin).toBe(true);
  });
});

describe.skipIf(!ready)('the snapshot contract on a park (render / HUD / camera read these)', () => {
  it('a vert air reports the camera vertAir hint and ramp normal; the grind snapshot carries contact and tangent', () => {
    if (!woodshed) return;
    const vw = prim<QuarterPipePrim>(woodshed, 'WS-VW1');
    const r = new Rig({ level: woodshed });
    r.teleport(P(vw.footLine - 9, 0, (vw.span[0] + vw.span[1]) / 2), P(1, 0, 0), 11);
    r.run(400, () => ({}), (s) => s.skater.state === 'Air');
    const air: SimSnapshot = r.snap;
    expect(air.camera.vertAir).toBe(true);
    expect(air.camera.rampNormal?.x).toBeLessThan(-0.9);
    expect(air.skater.pose).toBe('air');
    const g = groundGrind(woodshed, 'WS-RA', 6);
    const mid = g.snaps.find((s) => s.skater.state === 'Grind' && s.skater.stateTicks > 20);
    expect(mid?.skater.grind).toMatchObject({ railId: 'WS-RA', railKind: 'rail', type: 'fifty_fifty' });
    expect(mid?.skater.grind?.tangent.x).toBeCloseTo(1, 6);
    expect(mid?.skater.contactPoint?.y).toBeCloseTo(0.55, 6);
    expect(mid?.skater.pose).toBe('grind');
    expect(mid?.balance?.axis).toBe('h');
  });
});
