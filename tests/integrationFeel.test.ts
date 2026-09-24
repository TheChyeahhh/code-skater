/**
 * tests/integrationFeel.test.ts (integration): the founder playtest sweeps (2026-09-23, DESIGN §L
 * CR-43 to CR-47). Seeded random plain ollies and ollie + flip on flat and on ramps through the REAL
 * world (tests/fixtures/sim/rig.ts), counting bails; and a standing-start push up every test box
 * quarter-pipe with the air above the coping. These pin the forgiving arcade landing the founder
 * asked for: a plain ollie never bails, a flip started before the apex almost never does.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/tuning';
import type { Vec2, Vec3 } from '../src/core/types';
import { createRng, type Rng } from '../src/core/rng';
import { MARKET_STREET } from '../src/levels/marketStreet';
import type { LevelDef } from '../src/levels/types';
import { WOODSHED } from '../src/levels/woodshed';
import { built, describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

const dirOf = (yaw: number): Vec3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });

/** A "small lean": what a player holds while riding (neutral, forward, a diagonal, a slight analog tilt). */
function lean(rng: Rng): Vec2 {
  const k = Math.floor(rng.next() * 5);
  if (k === 0) return { x: 0, y: 0 };
  if (k === 1) return { x: 0, y: 1 };
  if (k === 2) return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  if (k === 3) return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  return { x: (rng.next() - 0.5) * 1.0, y: rng.next() };
}

interface Outcome {
  readonly landed: boolean;
  readonly bailed: boolean;
  readonly reason: string;
  readonly debug?: string;
}

/**
 * One ollie: teleport, roll a few ticks, charge Cross for a random time, release, optionally press
 * Square after `flipAfter` air ticks (always before the apex), hold the lean in the air, and watch
 * until the skater is back on the ground or bailed.
 */
function ollie(pos: Vec3, yaw: number, speed: number, rng: Rng, flip: boolean): Outcome {
  const r = new Rig({ seed: 3 });
  r.teleport(pos, dirOf(yaw), speed);
  r.hold(2);
  const stick = lean(rng);
  const charge = 3 + Math.floor(rng.next() * 68);
  r.hold(charge, { buttons: ['ollie'], stick });
  const from = r.tick;
  r.hold(1, { stick });
  // Pop tick known: the apex is about v_pop / g later; press the flip in the first 70% of the rise.
  let airTicks = 0;
  let pressed = !flip;
  const flipAt = 1 + Math.floor(rng.next() * 0.7 * (Math.sqrt(2 * TUNING.OLLIE_H_TAP_M / TUNING.GRAVITY) * TUNING.SIM_HZ));
  for (let i = 0; i < 400; i++) {
    const s = r.snap;
    if (s.skater.state === 'Air') airTicks++;
    if (!pressed && airTicks >= flipAt && s.skater.state === 'Air') {
      r.hold(1, { buttons: ['flip'], stick });
      pressed = true;
      continue;
    }
    if (airTicks > 0 && s.skater.state !== 'Air') break;
    // Never popped (a pop needs the Crouch to register): the run is not an ollie, stop.
    if (airTicks === 0 && i > 20) break;
    r.hold(1, { stick });
  }
  const bail = r.of('bail', from)[0];
  return { landed: r.of('land', from).length > 0 || bail !== undefined, bailed: bail !== undefined, reason: bail?.reason ?? '', debug: process.env.FEEL_DEBUG ? `${JSON.stringify(stick)} ${describeEvents(r.events)}` : '' };
}

interface Tally {
  runs: number;
  bails: number;
  reasons: Record<string, number>;
}

function sweep(n: number, seed: number, flip: boolean, place: (rng: Rng) => { pos: Vec3; yaw: number; speed: number }): Tally {
  const rng = createRng(seed);
  const t: Tally = { runs: 0, bails: 0, reasons: {} };
  for (let i = 0; i < n; i++) {
    const p = place(rng);
    const o = ollie(p.pos, p.yaw, p.speed, rng, flip);
    if (!o.landed) continue;
    t.runs++;
    if (o.bailed) {
      if (process.env.FEEL_DEBUG) report(`BAIL ${JSON.stringify(p)} ${o.reason} ${o.debug ?? ''}`);
      t.bails++;
      t.reasons[o.reason] = (t.reasons[o.reason] ?? 0) + 1;
    }
  }
  return t;
}

/** Open floor south of the test rail, heading east or west (no obstacle within an air's reach). */
const flat = (rng: Rng) => ({
  pos: { x: 26 + rng.next() * 10, y: 0, z: 48 + rng.next() * 6 },
  yaw: (rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng.next() - 0.5) * 0.6,
  speed: 2 + rng.next() * 9,
});

/** On TB-BANK (x 4 to 10, 1.2 m high at x 4, downhill east), any heading: across, down or up it. */
const bank = (rng: Rng) => {
  const x = 5 + rng.next() * 4;
  return {
    pos: { x, y: (1.2 * (10 - x)) / 6, z: 22 + rng.next() * 6 },
    yaw: rng.next() * Math.PI * 2,
    speed: 2 + rng.next() * 6,
  };
};

/** Rolling up TB-MINI (mini quarter-pipe facing south, foot z 5.8) from the flat, heading north. */
const mini = (rng: Rng) => ({
  pos: { x: 46 + rng.next() * 8, y: 0, z: 9 + rng.next() * 3 },
  yaw: (rng.next() - 0.5) * 0.8,
  speed: 3 + rng.next() * 5,
});

/** FEEL_REPORT=1 prints the sweep numbers (vitest hides console output of passing tests). */
const report = (line: string): void => {
  if (process.env.FEEL_REPORT) process.stderr.write(`${line}\n`);
};

const pct = (t: Tally): string => `${t.bails}/${t.runs} ${JSON.stringify(t.reasons)}`;

describe.skipIf(!worldAvailable())('founder playtest 2026-09-23: forgiving landings (CR-43)', () => {
  it('a plain ollie never bails: 100 on flat, 100 on a bank, 60 off a mini ramp, with small stick leans', () => {
    const f = sweep(100, 11, false, flat);
    const b = sweep(100, 12, false, bank);
    const m = sweep(60, 13, false, mini);
    report(`plain ollie bails: flat ${pct(f)}, bank ${pct(b)}, mini ${pct(m)}`);
    expect(f.bails).toBe(0);
    expect(b.bails).toBe(0);
    expect(m.bails).toBe(0);
  }, 120_000);

  it('an ollie + flip started before the apex bails under 10% of the time', () => {
    const f = sweep(100, 21, true, flat);
    const b = sweep(100, 22, true, bank);
    report(`ollie + flip bails: flat ${pct(f)}, bank ${pct(b)}`);
    expect(f.bails / f.runs).toBeLessThan(0.1);
    expect(b.bails / b.runs).toBeLessThan(0.1);
  }, 120_000);
});

interface RampAir {
  readonly topAboveCopingM: number;
  readonly airS: number;
  readonly speedAtFootMps: number;
}

/**
 * Standing start, stick forward (auto-push) straight at a quarter-pipe; the first air off it: its
 * height above the coping and its length. No pop: the plain roll-up.
 */
function rampAir(start: Vec3, copingY: number, footZ: number): RampAir {
  const r = new Rig({ seed: 5 });
  r.teleport(start, { x: 0, y: 0, z: -1 }, 0);
  let top = -Infinity;
  let airTicks = 0;
  let foot = 0;
  for (let i = 0; i < 1500; i++) {
    r.hold(1, { stick: { x: 0, y: 1 } });
    const s = r.snap.skater;
    if (foot === 0 && s.pos.z <= footZ) foot = s.speed;
    if (s.state === 'Air') {
      airTicks++;
      top = Math.max(top, s.pos.y);
    } else if (airTicks > 0) break;
  }
  return { topAboveCopingM: top - copingY, airS: airTicks / TUNING.SIM_HZ, speedAtFootMps: foot };
}

describe.skipIf(!worldAvailable())('founder playtest 2026-09-23: enough speed and air for a trick (CR-44)', () => {
  it('from a standing push, TB-VERT airs at least 2.5 m over the coping and TB-MINI at least 1.2 m, both long enough for a flip', () => {
    const vert = rampAir({ x: 32, y: 0, z: 46 }, 3.6, 7);
    const mini = rampAir({ x: 50, y: 0, z: 46 }, 1.5, 5.8);
    report(`vert ${JSON.stringify(vert)} mini ${JSON.stringify(mini)}`);
    const flipS = (TUNING.FLIP_ANIM_MS_T1 + 150) / 1000;
    expect(vert.topAboveCopingM).toBeGreaterThanOrEqual(2.5);
    expect(mini.topAboveCopingM).toBeGreaterThanOrEqual(1.2);
    expect(vert.airS).toBeGreaterThan(flipS);
    expect(mini.airS).toBeGreaterThan(flipS);
  }, 60_000);
});

/** Every quarter-pipe of a park: the best standing-start push straight at it (a few lanes and run-ups). */
function parkRamps(def: LevelDef): { id: string; best: RampAir & { start: string } }[] {
  const level = built(def);
  const out: { id: string; best: RampAir & { start: string } }[] = [];
  for (const p of def.primitives) {
    if (p.kind !== 'quarterPipe') continue;
    // Facing = the way the face looks; the skater rides the other way into it.
    const axis = p.facing === 'north' || p.facing === 'south' ? 'z' : 'x';
    const sign = p.copingLine > p.footLine ? 1 : -1;
    const baseY = p.baseY ?? 0;
    let best: (RampAir & { start: string }) | null = null;
    for (const f of [0.25, 0.5, 0.75]) {
      const along = p.span[0] + (p.span[1] - p.span[0]) * f;
      for (const d of [6, 9, 12, 16]) {
        const across = p.footLine - sign * d;
        const start = axis === 'z' ? { x: along, y: baseY, z: across } : { x: across, y: baseY, z: along };
        const dir = axis === 'z' ? { x: 0, y: 0, z: sign } : { x: sign, y: 0, z: 0 };
        const r = new Rig({ level, seed: 5 });
        r.teleport(start, dir, 0);
        if (r.snap.skater.state !== 'Grounded') continue;
        let top = -Infinity;
        let airTicks = 0;
        let fromId = '';
        for (let i = 0; i < 900; i++) {
          const prev = r.snap.skater.surface?.surfaceId ?? '';
          r.hold(1, { stick: { x: 0, y: 1 } });
          const s = r.snap.skater;
          if (s.state === 'Air') {
            if (airTicks === 0) fromId = prev;
            airTicks++;
            top = Math.max(top, s.pos.y);
          } else if (airTicks > 0) break;
          if (s.state === 'Bail') break;
        }
        if (fromId !== p.id) continue;
        const res = { topAboveCopingM: top - (baseY + p.copingHeight), airS: airTicks / TUNING.SIM_HZ, speedAtFootMps: 0, start: `${start.x.toFixed(1)},${start.z.toFixed(1)}` };
        if (!best || res.airS > best.airS) best = res;
      }
    }
    out.push({ id: p.id, best: best ?? { topAboveCopingM: -Infinity, airS: 0, speedAtFootMps: 0, start: 'none' } });
  }
  return out;
}

describe.skipIf(!worldAvailable())('founder playtest 2026-09-23: every park quarter-pipe from a standing push (CR-44)', () => {
  it('Market Street and Woodshed: each quarter-pipe launches a standing-start push into an air long enough for a flip', () => {
    const flipS = (TUNING.FLIP_ANIM_MS_T1 + 150) / 1000;
    for (const def of [MARKET_STREET, WOODSHED]) {
      for (const q of parkRamps(def)) {
        report(`${def.id} ${q.id} ${JSON.stringify(q.best)}`);
        expect(q.best.airS, `${def.id} ${q.id}`).toBeGreaterThan(flipS);
      }
    }
  }, 240_000);
});
