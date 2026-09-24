// tests/contracts.test.ts (integration): the M0 contracts load in plain node (no DOM, no WebGL),
// follow the stub convention, and the shared conventions (heading, quaternions, plain snapshots,
// interpolation, seeded RNG) behave as documented in src/core/types.ts and ARCHITECTURE.md.
import { describe, expect, it } from 'vitest';
import { isNotImplemented, notImplemented, tryImplemented } from '../src/core/contract';
import { lerpSnapshot } from '../src/core/interp';
import { facingToYaw, forwardToYaw, rotate3, xzy, yawQuat, yawToForward } from '../src/core/math';
import { mockEventsAt, mockSnapshotAt, restSnapshot } from '../src/core/mock';
import { createRng } from '../src/core/rng';
import { COMBO_ALIVE_STATES } from '../src/core/types';
import { loadLevelDef, LEVEL_IDS } from '../src/levels/registry';
import { initialMachine, TRANSITIONS } from '../src/sim/stateMachine';
import { DESIGN_ROW_IDS } from '../src/sim/types';

// Every module under src except the entry (it touches the DOM at import time).
const modules = import.meta.glob(['../src/**/*.ts', '!../src/main.ts', '!../src/**/*.d.ts']);

describe('module contracts', () => {
  it('suites run in plain node unless they opt in to happy-dom on line 1', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('every src module imports in node without touching the DOM or WebGL', async () => {
    const paths = Object.keys(modules);
    expect(paths.length).toBeGreaterThan(50);
    for (const p of paths) {
      const load = modules[p];
      if (!load) throw new Error(`no loader for ${p}`);
      await expect(load(), p).resolves.toBeDefined();
    }
  });

  // The stub convention is tested on a local throw, never on a track's entry point: a track that
  // implements its stub must not turn this integration-owned suite red.
  it('the stub convention: notImplemented throws a recognisable error, tryImplemented maps it to null', () => {
    let caught: unknown = null;
    try {
      notImplemented('tests/contracts: probe');
    } catch (err) {
      caught = err;
    }
    expect(isNotImplemented(caught)).toBe(true);
    expect(isNotImplemented(new Error('real failure'))).toBe(false);
    expect(tryImplemented(() => notImplemented('tests/contracts: probe'))).toBeNull();
    expect(tryImplemented(() => 42)).toBe(42);
    expect(() => tryImplemented(() => {
      throw new TypeError('a real bug');
    })).toThrow(TypeError);
  });

  it('the state machine table shape is in place', () => {
    expect(Array.isArray(TRANSITIONS)).toBe(true);
    expect(new Set(DESIGN_ROW_IDS).size).toBe(DESIGN_ROW_IDS.length);
    expect(DESIGN_ROW_IDS.length).toBe(61);
    const m = initialMachine(5);
    expect(m.state).toBe('Grounded');
    expect(m.enteredTick).toBe(5);
    expect(COMBO_ALIVE_STATES).toEqual(['Air', 'Grind', 'Lip', 'Manual', 'RevertWindow', 'LandWindow']);
  });

  it('every registered level loads a LevelDef whose id matches', async () => {
    for (const id of LEVEL_IDS) expect((await loadLevelDef(id)).id).toBe(id);
  });
});

describe('shared conventions', () => {
  it('heading: yaw 0 north, +PI/2 west, PI south, -PI/2 east; quaternion rotates local -z to forward', () => {
    const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
      expect(a.z).toBeCloseTo(b.z, 9);
    };
    near(yawToForward(0), { x: 0, y: 0, z: -1 });
    near(yawToForward(facingToYaw('west')), { x: -1, y: 0, z: 0 });
    near(yawToForward(facingToYaw('south')), { x: 0, y: 0, z: 1 });
    near(yawToForward(facingToYaw('east')), { x: 1, y: 0, z: 0 });
    for (const yaw of [0, 0.3, 1.7, -2.4, Math.PI]) {
      near(rotate3(yawQuat(yaw), { x: 0, y: 0, z: -1 }), yawToForward(yaw));
      expect(Math.cos(forwardToYaw(yawToForward(yaw)) - yaw)).toBeCloseTo(1, 9);
    }
  });

  it('xzy() reads DESIGN G tables in (x, z, y) order', () => {
    expect(xzy(41.6, 38, 1.2)).toEqual({ x: 41.6, y: 1.2, z: 38 });
  });

  it('snapshots are plain JSON-safe data', () => {
    for (const snap of [restSnapshot(), mockSnapshotAt(300), mockSnapshotAt(500)]) {
      expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    }
    const events = Array.from({ length: 960 }, (_, t) => mockEventsAt(t)).flat();
    expect(events.some((e) => e.type === 'grindStart')).toBe(true);
    expect(events.every((e) => typeof e.tick === 'number')).toBe(true);
  });

  it('lerpSnapshot blends motion and keeps discrete data from curr', () => {
    const a = mockSnapshotAt(100);
    const b = mockSnapshotAt(101);
    expect(lerpSnapshot(a, b, 0).skater.pos).toEqual(a.skater.pos);
    expect(lerpSnapshot(a, b, 1)).toBe(b);
    const mid = lerpSnapshot(a, b, 0.5);
    expect(mid.skater.pos.x).toBeCloseTo((a.skater.pos.x + b.skater.pos.x) / 2, 9);
    expect(mid.tick).toBe(b.tick);
    expect(mid.skater.state).toBe(b.skater.state);
  });

  it('lerpSnapshot blends flipPhase while the same flip runs, and pose phases in both directions', () => {
    const a = mockSnapshotAt(252); // 2.1 s: kickflip animating
    const b = mockSnapshotAt(253);
    expect(a.skater.flipId).toBe('kickflip');
    expect(b.skater.flipPhase).toBeGreaterThan(a.skater.flipPhase);
    expect(lerpSnapshot(a, b, 0.5).skater.flipPhase).toBeCloseTo((a.skater.flipPhase + b.skater.flipPhase) / 2, 9);
    expect(restSnapshot().skater.flipPhase).toBe(0);
    // A balance-lean phase may fall between ticks and still blends; a loop wrap (big jump) does not.
    const lean = { ...b, skater: { ...b.skater, posePhase: a.skater.posePhase - 0.1 } };
    expect(lerpSnapshot(a, lean, 0.5).skater.posePhase).toBeCloseTo(a.skater.posePhase - 0.05, 9);
    const wrap = { ...b, skater: { ...b.skater, posePhase: 0.95 } };
    const start = { ...a, skater: { ...a.skater, posePhase: 0.02 } };
    expect(lerpSnapshot(start, wrap, 0.5).skater.posePhase).toBe(0.95);
  });

  it('the seeded RNG replays exactly', () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    const s1 = Array.from({ length: 50 }, () => r1.next());
    const s2 = Array.from({ length: 50 }, () => r2.next());
    expect(s1).toEqual(s2);
    expect(s1.every((v) => v >= 0 && v < 1)).toBe(true);
    const c = r1.clone();
    expect(c.next()).toBe(r1.next());
  });
});
