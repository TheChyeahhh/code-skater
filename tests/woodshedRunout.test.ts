// tests/woodshedRunout.test.ts (woodshed track): polish round 2 feel checks on the REAL sim (input
// frame builder, logic state machine and scoring, sim world, the built Woodshed), with balance-only
// input unless a check says otherwise.
// - Ramp ends at the east wall leave no slot: drops along x 89.5..89.7 never leave the park.
// - A coping grind off either south-wall coping end (the auto-grind carries a Coping Link rider onto
//   them) lands on a corner deck and BANKS before the wall: COPING LINK is kept, nobody falls out.
// - The vert pocket copings' east ends never drop a rider out of the park.
// - DROP-IN is earned rolling over a bowl rim at any line speed, not only at walking pace.
// - CENTER RAINBOW is earned from a snap anywhere in the first 2 m of WS-RR2.
// Self-contained like woodshedChain.test.ts; skipped while any stub in the world chain still throws.
import { describe, expect, it } from 'vitest';
import { tryImplemented } from '../src/core/contract';
import type { EventOf, SimEvent, SimEventType } from '../src/core/events';
import { neutralFrame } from '../src/core/mock';
import type { Button, DirOrNeutral, SimSnapshot, Vec3 } from '../src/core/types';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { buildLevel } from '../src/levels/builder';
import type { BuiltLevel } from '../src/levels/types';
import { WOODSHED } from '../src/levels/woodshed';
import { createDebugDriver } from '../src/sim/debug';
import { createWorld } from '../src/sim/world';

const E: Vec3 = { x: 1, y: 0, z: 0 };
const W: Vec3 = { x: -1, y: 0, z: 0 };
const N: Vec3 = { x: 0, y: 0, z: -1 };
const SPEEDS = [4, 5, 6, 7, 8, 9, 10, 11];
/** Out of the park: past the east wall or below the kill line the audit used. */
const PARK_X = WOODSHED.size.x;
const FALL_Y = -0.5;

let level: BuiltLevel | null = null;
const built = (): BuiltLevel => (level ??= buildLevel(WOODSHED));

const worldAvailable = (): boolean =>
  tryImplemented(() => createWorld({ level: built(), mode: 'free', seed: 1, collectedMacGuffins: [], completedGoals: [] }).step(neutralFrame(0))) !== null;

interface Held {
  readonly buttons?: readonly Button[];
  readonly dpad?: DirOrNeutral;
}

class Run {
  readonly events: SimEvent[] = [];
  private readonly world = createWorld({ level: built(), mode: 'free', seed: 5, collectedMacGuffins: [], completedGoals: [] });
  private readonly driver = createDebugDriver(this.world, createFrameBuilder());
  maxX = -Infinity;
  minY = Infinity;

  constructor(pos: Vec3, dir: Vec3, speed: number) {
    this.driver.teleport(pos, dir, speed);
  }

  get snap(): SimSnapshot {
    return this.world.snapshot;
  }

  /** Step up to maxTicks with a per-tick input (unlisted buttons released); stop when `until` holds. */
  run(maxTicks: number, input: (s: SimSnapshot, i: number) => Held, until: () => boolean = () => false): void {
    for (let i = 0; i < maxTicks; i++) {
      if (until()) return;
      const h = input(this.snap, i);
      const held: Partial<Record<Button, boolean>> = {};
      for (const b of ['ollie', 'flip', 'grab', 'grind', 'revert', 'nollie', 'spinL', 'spinR'] as const) held[b] = (h.buttons ?? []).includes(b);
      this.driver.setInput({ held, dpad: h.dpad ?? 'N', stick: { x: 0, y: 0 } });
      this.driver.step(1);
      for (const e of this.driver.takeEvents()) this.events.push(e);
      this.maxX = Math.max(this.maxX, this.snap.skater.pos.x);
      this.minY = Math.min(this.minY, this.snap.skater.pos.y);
    }
  }

  of<K extends SimEventType>(type: K): EventOf<K>[] {
    return this.events.filter((e): e is EventOf<K> => e.type === type);
  }

  gaps(): string[] {
    return this.of('elementAdded').map((e) => e.element.id).filter((id) => id.startsWith('gap:'));
  }

  describe(): string {
    const p = this.snap.skater.pos;
    const bails = this.of('bail').map((b) => `${b.tick}:${b.reason}`).join(',');
    const banks = this.of('comboBanked').map((b) => `${b.tick}:${b.final}`).join(',');
    return `rails ${[...new Set(this.of('grindStart').map((e) => e.railId))].join('>')} gaps ${this.gaps().join(',')} banks ${banks} bails ${bails} end (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) ${this.snap.skater.state} minY ${this.minY.toFixed(2)} maxX ${this.maxX.toFixed(2)}`;
  }
}

/** Grind / manual balance only: push the d-pad against the needle. */
function balance(s: SimSnapshot): Held {
  const b = s.balance;
  if (!b) return {};
  if (b.axis === 'h') return { dpad: b.needle > 0 ? 'L' : 'R' };
  return { dpad: b.needle > 0 ? 'U' : 'D' };
}

/** Teleported just above a rail: press grind in 2-tick edges for the first ticks of the air, then balance only. */
function snapThenBalance(s: SimSnapshot, i: number): Held {
  if (i < 12 && s.skater.state === 'Air') return { buttons: i % 4 < 2 ? ['grind'] : [] };
  return balance(s);
}

/** Grind from `start` along `dir` at `speed` with balance only; runs until the first bank or bail, then 1 s more. */
function grindOut(start: Vec3, dir: Vec3, speed: number): Run {
  const r = new Run(start, dir, speed);
  r.run(2400, snapThenBalance, () => r.of('comboBanked').length > 0 || r.of('bail').length > 0);
  r.run(120, balance);
  return r;
}

describe.skipIf(!worldAvailable())('Woodshed run-outs and gap reach on the real sim (polish round 2)', () => {
  it('no slot at the east wall: drops from y 4.2 along x 89.55 / 89.65 never leave the park', () => {
    const out: string[] = [];
    let drops = 0;
    for (const x of [89.55, 89.65]) {
      for (let z = 0.5; z <= WOODSHED.size.z - 0.5; z += 0.25) {
        drops += 1;
        const r = new Run({ x, y: 4.2, z }, E, 0);
        r.run(360, balance);
        if (r.maxX > PARK_X || r.minY < FALL_Y) out.push(`drop (${x}, 4.2, ${z}): ${r.describe()}`);
      }
    }
    expect(drops).toBeGreaterThan(500);
    expect(out, out.join('\n')).toEqual([]);
  });

  it('Coping Link east (auto-carried onto WS-QE1-C) and west (onto WS-QW1-C) banks COPING LINK before the wall at 4..11 m/s', () => {
    const out: string[] = [];
    const cases = [
      { label: 'TR1 east', start: { x: 31, y: 2.35, z: 69.5 }, dir: E },
      { label: 'TR1 west', start: { x: 59, y: 2.75, z: 69.5 }, dir: W },
    ];
    for (const c of cases) {
      for (const v of SPEEDS) {
        const r = grindOut(c.start, c.dir, v);
        const bank = r.of('comboBanked')[0];
        const bail = r.of('bail')[0];
        const ok = r.gaps().includes('gap:WS-G10') && bank !== undefined && bank.final > 0 && (bail === undefined || bail.tick > bank.tick)
          && r.maxX <= PARK_X && r.minY >= FALL_Y;
        if (!ok) out.push(`${c.label} ${v} m/s: ${r.describe()}`);
      }
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  it('every coping end at the east and west walls: a balance-only grind never leaves the park, and the south-wall copings bank first', () => {
    const out: string[] = [];
    const cases = [
      { label: 'QE1-C east', start: { x: 83, y: 2.75, z: 69.9 }, dir: E, banks: true },
      { label: 'QW1-C west', start: { x: 10, y: 2.35, z: 69.9 }, dir: W, banks: true },
      // The pocket copings run 5.4 m into the east wall: a rider still on the rail at 6 m/s and up
      // meets it head-on (REQ-CTL-20), but never drops out of the park beside the pocket.
      { label: 'VW1-NC east', start: { x: 85, y: 3.95, z: 22 }, dir: E, banks: false },
      { label: 'VW1-SC east', start: { x: 85, y: 3.95, z: 48 }, dir: E, banks: false },
    ];
    for (const c of cases) {
      for (const v of SPEEDS) {
        const r = grindOut(c.start, c.dir, v);
        const bank = r.of('comboBanked')[0];
        const bail = r.of('bail')[0];
        const inPark = r.maxX <= PARK_X && r.minY >= FALL_Y && r.snap.skater.pos.x >= 0;
        const banked = bank !== undefined && (bail === undefined || bail.tick > bank.tick);
        if (!inPark || (c.banks && !banked)) out.push(`${c.label} ${v} m/s: ${r.describe()}`);
      }
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  it('DROP-IN (WS-G07) rolling over either bowl rim at 3..9 m/s with no input', () => {
    const out: string[] = [];
    const rims = [
      { label: 'BW1 south', start: { x: 14, y: 0, z: 28 }, dir: N },
      { label: 'BW1 east', start: { x: 26, y: 0, z: 16 }, dir: W },
      { label: 'BW2 west', start: { x: 78.2, y: 0, z: 10 }, dir: E },
      { label: 'BW2 south', start: { x: 84, y: 0, z: 18.6 }, dir: N },
    ];
    for (const c of rims) {
      for (const v of [3, 4, 6, 8, 9]) {
        const r = new Run(c.start, c.dir, v);
        r.run(240, balance);
        if (!r.gaps().includes('gap:WS-G07')) out.push(`${c.label} ${v} m/s: ${r.describe()}`);
      }
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  it('DROP-IN is not a bowl air: a carve out and back in, or a fall into the euro gap pit, earns no DROP-IN', () => {
    // Up the BW1 north wall from the floor with no input: a vert air off its own wall, back into the bowl.
    const vert = new Run({ x: 14, y: -2.4, z: 16 }, N, 9);
    vert.run(360, balance);
    expect(vert.of('stateChanged').some((e) => e.to === 'Air'), vert.describe()).toBe(true);
    expect(vert.gaps(), vert.describe()).not.toContain('gap:WS-G07');
    // Rolling off the euro gap's west edge into its pit (floor -0.6) at walking pace.
    const pit = new Run({ x: 73.5, y: 0, z: 8 }, E, 3);
    pit.run(240, balance);
    expect(pit.minY, pit.describe()).toBeLessThan(-0.5);
    expect(pit.gaps(), pit.describe()).not.toContain('gap:WS-G07');
  });

  it('CENTER RAINBOW (WS-G09) from a snap anywhere in the first 2 m of WS-RR2, heading east', () => {
    const out: string[] = [];
    let lateSnaps = 0;
    for (const x of [48.2, 48.8, 49.3, 49.6, 49.9]) {
      for (const v of [6, 8, 9.5]) {
        // RR2 climbs 0.65 m over its first 4 m: start 0.35 m above the rail at x.
        const y = 0.5 + ((x - 48) / 4) * 0.65 + 0.35;
        const r = new Run({ x, y, z: 40 }, E, v);
        r.run(600, snapThenBalance, () => r.of('comboBanked').length > 0 || r.of('bail').length > 0);
        const snap = r.of('grindStart')[0];
        if (snap?.railId !== 'WS-RR2') {
          out.push(`x ${x} ${v} m/s: no snap on WS-RR2: ${r.describe()}`);
          continue;
        }
        if (snap.pos.x > 50) continue; // the snap itself landed past the span start: not this check's case
        if (snap.pos.x > 49) lateSnaps += 1;
        if (!r.gaps().includes('gap:WS-G09')) out.push(`x ${x} ${v} m/s (snap at ${snap.pos.x.toFixed(2)}): ${r.describe()}`);
      }
    }
    expect(out, out.join('\n')).toEqual([]);
    // The audit's misses were snaps at x 49.15 to 49.87: the sweep must include some.
    expect(lateSnaps).toBeGreaterThanOrEqual(3);
  });
});
