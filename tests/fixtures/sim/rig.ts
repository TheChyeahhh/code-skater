/**
 * tests/fixtures/sim/rig.ts (sim track): a headless rig around the REAL world on a real level
 * (testBox by default): FrameBuilder + SkaterWorld + the debug driver, tick-by-tick input control,
 * event filters and small helpers for the sim suites. No mocks: every tick runs the input track's
 * frame builder and parser, the logic track's state machine and scoring, and the sim track.
 */

import { tryImplemented } from '../../../src/core/contract';
import { neutralFrame } from '../../../src/core/mock';
import type { EventOf, SimEvent, SimEventType } from '../../../src/core/events';
import type { Button, DirOrNeutral, SimSnapshot, Vec2, Vec3 } from '../../../src/core/types';
import { createFrameBuilder } from '../../../src/input/frameBuilder';
import { buildLevel } from '../../../src/levels/builder';
import { TEST_BOX } from '../../../src/levels/testBox';
import type { BuiltLevel, LevelDef } from '../../../src/levels/types';
import { createDebugDriver, type SimDebugDriver } from '../../../src/sim/debug';
import type { SkaterWorld, WorldConfig } from '../../../src/sim/types';
import { createWorld, simInternals } from '../../../src/sim/world';

const cache = new Map<string, BuiltLevel>();

export function built(def: LevelDef = TEST_BOX): BuiltLevel {
  const key = def.id + ':' + def.name;
  let b = cache.get(key);
  if (!b) {
    b = buildLevel(def);
    cache.set(key, b);
  }
  return b;
}

/** ARCHITECTURE.md section 10 probe: null when any stub in the chain still throws. */
export function worldAvailable(): boolean {
  return tryImplemented(() => createWorld({ level: built(), mode: 'free', seed: 1, collectedMacGuffins: [], completedGoals: [] }).step(neutralFrame(0))) !== null;
}

export interface Held {
  readonly buttons?: readonly Button[];
  readonly dpad?: DirOrNeutral;
  readonly stick?: Vec2;
}

export class Rig {
  readonly world: SkaterWorld;
  readonly driver: SimDebugDriver;
  readonly events: SimEvent[] = [];
  readonly snaps: SimSnapshot[] = [];

  constructor(config: Partial<WorldConfig> & { level?: BuiltLevel } = {}) {
    this.world = createWorld({
      level: config.level ?? built(), mode: config.mode ?? 'free', seed: config.seed ?? 7,
      collectedMacGuffins: config.collectedMacGuffins ?? [], completedGoals: config.completedGoals ?? [],
      ...(config.runLengthS !== undefined ? { runLengthS: config.runLengthS } : {}),
    });
    this.driver = createDebugDriver(this.world, createFrameBuilder());
  }

  get snap(): SimSnapshot {
    return this.world.snapshot;
  }

  get tick(): number {
    return this.world.tick;
  }

  /** Hold exactly this input (every button not listed is released) for n ticks. */
  hold(n: number, h: Held = {}): SimSnapshot {
    const held: Partial<Record<Button, boolean>> = {};
    for (const b of ['ollie', 'flip', 'grab', 'grind', 'revert', 'nollie', 'spinL', 'spinR'] as const) held[b] = (h.buttons ?? []).includes(b);
    this.driver.setInput({ held, dpad: h.dpad ?? 'N', stick: h.stick ?? { x: 0, y: 0 } });
    for (let i = 0; i < n; i++) this.stepOne();
    return this.snap;
  }

  /** Step with a per-tick input function until `until` is true or maxTicks pass; returns ticks run. */
  run(maxTicks: number, input: (s: SimSnapshot, i: number) => Held, until?: (s: SimSnapshot) => boolean): number {
    for (let i = 0; i < maxTicks; i++) {
      if (until && until(this.snap)) return i;
      this.hold(1, input(this.snap, i));
    }
    return maxTicks;
  }

  private stepOne(): void {
    this.driver.step(1);
    for (const e of this.driver.takeEvents()) this.events.push(e);
    this.snaps.push(this.snap);
  }

  teleport(pos: Vec3, dir: Vec3, speed: number): void {
    this.driver.teleport(pos, dir, speed);
  }

  /** Events of one type, optionally only those at or after `fromTick`. */
  of<K extends SimEventType>(type: K, fromTick = -1): EventOf<K>[] {
    return this.events.filter((e): e is EventOf<K> => e.type === type && e.tick >= fromTick);
  }

  states(fromTick = -1): string[] {
    return this.of('stateChanged', fromTick).map((e) => `${e.to}`);
  }

  setMeter(meter: number): void {
    simInternals(this.world)?.setSpecialMeter(meter);
  }

  /** Grind / lip balance: push the stick against the needle (REQ-BAL-03: input -1 = left pushes negative). */
  static balance(s: SimSnapshot, extra: Held = {}): Held {
    const b = s.balance;
    if (!b) return extra;
    if (b.axis === 'h') return { ...extra, dpad: b.needle > 0 ? 'L' : 'R' };
    return { ...extra, dpad: b.needle > 0 ? 'U' : 'D' };
  }

  private manualLatch = false;
  private manualSeen: string | null = null;

  /**
   * Balance that never types a manual swap (REQ-INP-18): a manual's opposite pair is its swap, so
   * the needle is first pushed over to the side of the manual's own first direction and then only
   * ever pushed back with the second one (Up then only Down for a manual: Up,Down is the same type).
   * Grind and lip balance (horizontal) is plain bang-bang, L / R pairs mean nothing there.
   */
  holdBalance(s: SimSnapshot, extra: Held = {}): Held {
    const b = s.balance;
    if (!b) {
      this.manualLatch = false;
      this.manualSeen = null;
      return extra;
    }
    if (b.axis === 'h') return { ...extra, dpad: b.needle > 0 ? 'L' : 'R' };
    const type = String(s.skater.poseVariant);
    if (type !== this.manualSeen) {
      this.manualSeen = type;
      this.manualLatch = false;
    }
    const nose = type.includes('nose');
    // Up pushes the needle negative (nose down), Down positive (REQ-BAL-03).
    const first: DirOrNeutral = nose ? 'D' : 'U';
    const second: DirOrNeutral = nose ? 'U' : 'D';
    const side = nose ? 1 : -1;
    if (!this.manualLatch) {
      if (b.needle * side > 0.1) this.manualLatch = true;
      else return { ...extra, dpad: first };
    }
    return b.needle * side > 0.3 ? { ...extra, dpad: second } : extra;
  }

  /** Last event of a type, or undefined. */
  last<K extends SimEventType>(type: K): EventOf<K> | undefined {
    const all = this.of(type);
    return all[all.length - 1];
  }

  /** Rows of every stateChanged event (DESIGN C.5 ids), optionally from a tick. */
  rows(fromTick = -1): string[] {
    return this.of('stateChanged', fromTick).map((e) => e.row);
  }
}

/** Run the same scripted rig twice: a probe that learns a tick, then the real run (deterministic sim). */
export function probeTick(make: () => Rig, drive: (r: Rig) => void, pick: (r: Rig) => number | undefined): number {
  const r = make();
  drive(r);
  const t = pick(r);
  if (t === undefined) throw new Error(`probe found nothing: ${describeEvents(r.events)}`);
  return t;
}

/** Short event log for failure messages. */
export function describeEvents(events: readonly SimEvent[]): string {
  const skip = new Set(['runTick', 'push', 'speedTier', 'runStart', 'comboUpdated', 'trickLand']);
  return events.filter((e) => !skip.has(e.type)).map((e) => {
    switch (e.type) {
      case 'stateChanged':
        return `${e.tick}:${e.to}(${e.row})`;
      case 'elementAdded':
        return `${e.tick}:+${e.element.id}`;
      case 'comboBanked':
        return `${e.tick}:bank=${e.final}`;
      case 'land':
        return `${e.tick}:land(off ${e.offAxisDeg.toFixed(1)}, ${e.vert ? 'vert' : 'flat'}, ${e.linker})`;
      case 'bail':
        return `${e.tick}:bail(${e.reason})`;
      default:
        return `${e.tick}:${e.type}`;
    }
  }).join(' ');
}
