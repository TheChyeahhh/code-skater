// tests/woodshedChain.test.ts (woodshed track): REQ-WSH-03, the DESIGN G.2 20 s rails + manuals
// chain run by a scripted competent input on the REAL sim (input track frame builder, logic track
// state machine and scoring, sim track world, on the built Woodshed). The script grinds with the
// balance held at the needle sign, taps between rails with grind pressed near the next rail's
// start, types Up,Down on landing for the manuals and steers the two half-circle turns with full
// stick, pushing balance only when the needle passes BAL_PUSH_AT (the stick is one vector: full
// steer and full push cannot coexist), then tracks the next row's line with a short-lookahead
// pursuit. Self-contained (no other track's fixture); skipped while any stub in the world chain
// still throws (ARCHITECTURE.md section 10).
import { describe, expect, it } from 'vitest';
import { tryImplemented } from '../src/core/contract';
import type { EventOf, SimEvent, SimEventType } from '../src/core/events';
import { neutralFrame } from '../src/core/mock';
import { TUNING } from '../src/core/tuning';
import type { Button, DirOrNeutral, SimSnapshot, Vec2, Vec3 } from '../src/core/types';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { buildLevel } from '../src/levels/builder';
import { WOODSHED } from '../src/levels/woodshed';
import { createDebugDriver } from '../src/sim/debug';
import type { SkaterWorld } from '../src/sim/types';
import { createWorld } from '../src/sim/world';

const EAST = { x: 1, y: 0, z: 0 };
const TICK_HZ = 120;
/** Needle magnitude at which the script gives half the stick to balance instead of steering. */
const BAL_PUSH_AT = 0.4;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface Held {
  readonly buttons?: readonly Button[];
  readonly dpad?: DirOrNeutral;
  readonly stick?: Vec2;
}

const worldAvailable = (): boolean =>
  tryImplemented(() => createWorld({ level: buildLevel(WOODSHED), mode: 'free', seed: 1, collectedMacGuffins: [], completedGoals: [] }).step(neutralFrame(0))) !== null;

/** The real world on the built park, driven one tick at a time through the sim's debug driver. */
class Run {
  readonly world: SkaterWorld;
  readonly events: SimEvent[] = [];
  private readonly driver;

  constructor() {
    this.world = createWorld({ level: buildLevel(WOODSHED), mode: 'free', seed: 3, collectedMacGuffins: [], completedGoals: [] });
    this.driver = createDebugDriver(this.world, createFrameBuilder());
  }

  teleport(pos: Vec3, dir: Vec3, speed: number): void {
    this.driver.teleport(pos, dir, speed);
  }

  /** Step with a per-tick input (every button not listed is released) until `until` or maxTicks. */
  run(maxTicks: number, input: (s: SimSnapshot, i: number) => Held, until: () => boolean): void {
    for (let i = 0; i < maxTicks; i++) {
      if (until()) return;
      const h = input(this.world.snapshot, i);
      const held: Partial<Record<Button, boolean>> = {};
      for (const b of ['ollie', 'flip', 'grab', 'grind', 'revert', 'nollie', 'spinL', 'spinR'] as const) held[b] = (h.buttons ?? []).includes(b);
      this.driver.setInput({ held, dpad: h.dpad ?? 'N', stick: h.stick ?? { x: 0, y: 0 } });
      this.driver.step(1);
      for (const e of this.driver.takeEvents()) this.events.push(e);
    }
  }

  of<K extends SimEventType>(type: K): EventOf<K>[] {
    return this.events.filter((e): e is EventOf<K> => e.type === type);
  }
}

/**
 * The chain rows are spaced for a 120 deg/s manual half-circle (DESIGN G.2). The founder's 2026-09-23
 * playtest raised the max manual turn rate, so the script turns with the matching part of the stick.
 */
const CHAIN_TURN_DPS = 120;
const turnStick = (): number => Math.min(1, CHAIN_TURN_DPS / TUNING.TURN_RATE_MANUAL_DPS);

/** Steer on the stick x, balance push on the stick y (manual) or the d-pad (grind), sharing the unit circle. */
function drive(s: SimSnapshot, steer: number, extra: Held = {}): Held {
  const b = s.balance;
  if (!b) return { ...extra, stick: { x: steer, y: 0 } };
  if (b.axis === 'h') return { ...extra, dpad: b.needle > 0 ? 'L' : 'R', stick: { x: steer, y: 0 } };
  const push = Math.abs(b.needle) >= BAL_PUSH_AT;
  if (!push) return { ...extra, stick: { x: steer, y: 0 } };
  const sx = clamp(steer, -1, 1) * Math.SQRT1_2;
  const sy = Math.sqrt(Math.max(0, 1 - sx * sx)) * (b.needle > 0 ? 1 : -1);
  return { ...extra, stick: { x: sx, y: sy } };
}

/** Pursuit steer toward the line z = zTarget while travelling along x in direction dirX (clockwise = +). */
function pursue(s: SimSnapshot, zTarget: number, dirX: -1 | 1, lookahead = 3): number {
  const p = s.skater.pos;
  const dx = dirX * lookahead, dz = zTarget - p.z;
  const n = Math.hypot(dx, dz) || 1;
  const f = s.skater.forward;
  const cross = f.z * (dx / n) - f.x * (dz / n);
  return clamp(-cross * 3, -1, 1);
}

function railStart(id: string): Vec3 {
  const r = WOODSHED.rails.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r.points[0] as Vec3;
}

/** Short event log for failure messages. */
function describeEvents(events: readonly SimEvent[]): string {
  const skip = new Set(['runTick', 'push', 'speedTier', 'runStart', 'comboUpdated', 'trickLand']);
  return events.filter((e) => !skip.has(e.type)).map((e) => {
    switch (e.type) {
      case 'stateChanged': return `${e.tick}:${e.to}(${e.row})`;
      case 'elementAdded': return `${e.tick}:+${e.element.id}`;
      case 'comboBanked': return `${e.tick}:bank=${e.final}`;
      case 'land': return `${e.tick}:land(off ${e.offAxisDeg.toFixed(1)}, ${e.linker})`;
      case 'bail': return `${e.tick}:bail(${e.reason})`;
      default: return `${e.tick}:${e.type}`;
    }
  }).join(' ');
}

describe.skipIf(!worldAvailable())('Woodshed rail chain on the real sim (REQ-WSH-03)', () => {
  it('scripted input holds RA -> RB -> manual -> RR1 -> manual -> RE -> RF -> manual for >= WOODSHED_CHAIN_MIN_S and banks >= WOODSHED_HIGH_COMBO', () => {
    const r = new Run();
    r.teleport({ x: 2, y: 0, z: 38 }, EAST, TUNING.WOODSHED_CHAIN_ENTRY_MPS);
    const log: string[] = [];
    let phase = 'toRA';
    let sub = 0;
    const go = (p: string, s: SimSnapshot, i: number): void => {
      log.push(`${i}: ${phase} -> ${p} at (${s.skater.pos.x.toFixed(2)}, ${s.skater.pos.y.toFixed(2)}, ${s.skater.pos.z.toFixed(2)}) v ${s.skater.speed.toFixed(2)} ${s.skater.state}`);
      phase = p;
      sub = 0;
    };
    const onRail = (s: SimSnapshot, id: string): boolean => s.skater.state === 'Grind' && s.skater.grind?.railId === id;
    /** In the air: press grind in 2-tick edges (never a hold carried over the pop) once the next rail's start is within reach. */
    const snapNear = (s: SimSnapshot, id: string, within: number): Held => {
      sub += 1;
      const t = railStart(id);
      const near = Math.hypot(t.x - s.skater.pos.x, t.z - s.skater.pos.z) <= within;
      return near && sub % 4 < 2 ? { buttons: ['grind'] } : {};
    };
    const landed = (s: SimSnapshot): boolean => s.skater.state === 'LandWindow' || s.skater.state === 'Grounded';
    const manualPair = (s: SimSnapshot, next: string, i: number): Held => {
      sub += 1;
      if (sub > 6) go(next, s, i);
      return { dpad: sub <= 3 ? 'U' : 'D' };
    };
    const zRR1 = railStart('WS-RR1').z, zRE = railStart('WS-RE').z;
    r.run(4800, (s, i) => {
      const p = s.skater.pos;
      const f = s.skater.forward;
      if (i % 120 === 0) log.push(`  ${i}: ${phase} ${s.skater.state} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) v ${s.skater.speed.toFixed(2)} fwd (${f.x.toFixed(2)}, ${f.z.toFixed(2)}) needle ${s.balance?.needle.toFixed(2) ?? '-'}`);
      switch (phase) {
        case 'toRA':
          if (onRail(s, 'WS-RA')) go('onRA', s, i);
          return p.x >= 7.9 ? { buttons: ['grind'] } : {};
        case 'onRA':
          if (p.x >= 23.5) { go('hopRB', s, i); return { buttons: ['ollie'] }; }
          return drive(s, 0);
        case 'hopRB':
          if (onRail(s, 'WS-RB')) go('onRB', s, i);
          return snapNear(s, 'WS-RB', 1.6);
        case 'onRB':
          if (landed(s)) go('pairRB', s, i);
          return drive(s, 0);
        case 'pairRB':
          return manualPair(s, 'turn1', i);
        case 'turn1':
          // Full right turn, then pursue the Rainbow's row heading west; tap onto its start once aligned.
          if (p.x <= railStart('WS-RR1').x + 1.2 && f.x < -0.95 && Math.abs(p.z - zRR1) < 0.35) { go('hopRR1', s, i); return { buttons: ['ollie'] }; }
          return drive(s, f.z < 0.5 && f.x > 0 ? turnStick() : pursue(s, zRR1, -1));
        case 'hopRR1':
          if (onRail(s, 'WS-RR1')) go('onRR1', s, i);
          return snapNear(s, 'WS-RR1', 2.0);
        case 'onRR1':
          if (landed(s)) go('pairRR1', s, i);
          return drive(s, 0);
        case 'pairRR1':
          return manualPair(s, 'turn2', i);
        case 'turn2':
          // Full left turn, then pursue the Kink Ledge's row heading east; tap onto its start once aligned (the ledge box is solid: pop before x 9).
          if (p.x >= railStart('WS-RE').x - 2.0 && f.x > 0.95 && Math.abs(p.z - zRE) < 0.35) { go('hopRE', s, i); return { buttons: ['ollie'] }; }
          return drive(s, f.z < 0.5 && f.x < 0 ? -turnStick() : pursue(s, zRE, 1));
        case 'hopRE':
          if (onRail(s, 'WS-RE')) go('onRE', s, i);
          return snapNear(s, 'WS-RE', 2.4);
        case 'onRE':
          if (p.x >= 23.4) { go('hopRF', s, i); return { buttons: ['ollie'] }; }
          return drive(s, 0);
        case 'hopRF':
          if (onRail(s, 'WS-RF')) go('onRF', s, i);
          return snapNear(s, 'WS-RF', 1.6);
        case 'onRF':
          if (landed(s)) go('pairRF', s, i);
          return drive(s, 0);
        case 'pairRF':
          return manualPair(s, 'manualEast', i);
        case 'manualEast':
          // The easier manuals (founder 2026-09-23) keep more speed, so the line is quicker: the last
          // manual runs on over the open floor to x 68 (the hump WS-H1 starts at x 77) to hold 20 s.
          if (p.x >= 68) { go('finish', s, i); return { buttons: ['ollie'] }; }
          return drive(s, 0);
        case 'finish':
          return {};
      }
      return {};
    }, () => r.of('comboBanked').length > 0 || r.of('bail').length > 0);
    const report = log.join('\n') + '\n' + describeEvents(r.events);
    const starts = r.of('grindStart');
    const banked = r.of('comboBanked')[0];
    expect(r.of('bail'), report).toEqual([]);
    expect(starts.map((e) => e.railId), report).toEqual(['WS-RA', 'WS-RB', 'WS-RR1', 'WS-RE', 'WS-RF']);
    expect(r.of('manualStart').length, report).toBeGreaterThanOrEqual(3);
    // The Rainbow is grinded end to end on the way (gap WS-G08, DESIGN's tenth element).
    expect(r.of('elementAdded').some((e) => e.element.id === 'gap:WS-G08'), report).toBe(true);
    expect(banked, report).toBeDefined();
    if (!banked || !starts[0]) return;
    const seconds = (banked.tick - starts[0].tick) / TICK_HZ;
    expect(seconds, report).toBeGreaterThanOrEqual(TUNING.WOODSHED_CHAIN_MIN_S);
    expect(banked.final, report).toBeGreaterThanOrEqual(TUNING.WOODSHED_HIGH_COMBO);
  });
});
