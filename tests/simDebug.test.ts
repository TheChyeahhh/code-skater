// tests/simDebug.test.ts (sim track): the sim side of the window.__codeSkater.debug contract
// (src/sim/debug.ts, REQ-DEP-07, REQ-TST-02): scripted input holds and timelines, step, teleport,
// comboBanked / runScore, event collection, and the headless replay() the other suites use.
import { describe, expect, it } from 'vitest';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { createDebugDriver, replay } from '../src/sim/debug';
import { createWorld } from '../src/sim/world';
import { built, worldAvailable } from './fixtures/sim/rig';

const world = () => createWorld({ level: built(), mode: 'free', seed: 5, collectedMacGuffins: [], completedGoals: [] });

describe.skipIf(!worldAvailable())('the sim debug driver', () => {
  it('a ScriptInput is held from the next tick until changed; omitted fields keep their value', () => {
    const w = world();
    const d = createDebugDriver(w, createFrameBuilder());
    d.teleport({ x: 30, y: 0, z: 56 }, { x: 0, y: 0, z: -1 }, 0);
    d.setInput({ dpad: 'U' });
    d.step(60);
    const v1 = d.snapshot().skater.speed;
    expect(v1).toBeGreaterThan(2);
    // Only Cross changes: the stick stays forward (the skater crouches, so pushing stops).
    d.setInput({ held: { ollie: true } });
    const s = d.step(10);
    expect(s.skater.state).toBe('Crouch');
    expect(s).toBe(d.snapshot());
    d.setInput({ held: { ollie: false } });
    expect(d.step(1).skater.state).toBe('Air');
    expect(d.takeEvents().map((e) => e.type)).toContain('pop');
    expect(d.takeEvents()).toEqual([]);
  });

  it('a timeline plays keyframes relative to the tick it starts; step returns the last snapshot', () => {
    const w = world();
    const d = createDebugDriver(w, createFrameBuilder());
    d.teleport({ x: 30, y: 0, z: 56 }, { x: 0, y: 0, z: -1 }, 5);
    d.step(7);
    d.setInput([
      { atTick: 3, input: { held: { ollie: true } } },
      { atTick: 0, input: { dpad: 'N' } },
      { atTick: 33, input: { held: { ollie: false } } },
      { atTick: 34, input: { held: { flip: true } } },
      { atTick: 36, input: { held: { flip: false } } },
    ]);
    d.step(40);
    const events = d.takeEvents();
    const crouch = events.find((e) => e.type === 'stateChanged' && e.to === 'Crouch');
    const pop = events.find((e) => e.type === 'pop');
    expect(crouch?.tick).toBe(7 + 3);
    expect(pop?.tick).toBe(7 + 33);
    d.step(200);
    expect(d.comboBanked()).toBe(100);
    expect(d.runScore()).toBe(100);
    expect(w.lastBanked).toBe(100);
  });

  it('teleport places the skater: Grounded on a surface, Air above one, heading and speed as given', () => {
    const w = world();
    const d = createDebugDriver(w, createFrameBuilder());
    d.teleport({ x: 20, y: 0.1, z: 50 }, { x: 1, y: 0.3, z: 0 }, 4);
    expect(d.snapshot().skater.state).toBe('Grounded');
    expect(d.snapshot().skater.pos.y).toBeCloseTo(0, 6);
    expect(d.snapshot().skater.forward.x).toBeCloseTo(1, 6);
    expect(d.snapshot().skater.speed).toBeCloseTo(4, 6);
    d.teleport({ x: 20, y: 3, z: 50 }, { x: 0, y: 0, z: 1 }, 2);
    expect(d.snapshot().skater.state).toBe('Air');
    expect(d.snapshot().skater.vel.z).toBeCloseTo(2, 6);
  });

  it('replay() runs a timeline headless and returns one snapshot per tick plus every event', () => {
    const out = replay(world(), createFrameBuilder(), [{ atTick: 0, input: { dpad: 'U' } }], 120);
    expect(out.snapshots.length).toBe(120);
    expect(out.snapshots[119]?.tick).toBe(119);
    expect(out.events[0]?.type).toBe('runStart');
    expect(out.events.filter((e) => e.type === 'push').length).toBeGreaterThan(0);
  });
});
