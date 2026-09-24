/**
 * tests/balance.test.ts (logic track): SPEC §13 balance suite (REQ-BAL-01..05, CR-02, CR-06,
 * REQ-CTL-13 / CR-19). The four DESIGN D.4 "balance feel check" bail times are exact tick counts
 * (120 Hz); re-centre on each new element; drift grows with element count; same object x1.6;
 * both axes and both signs; switch stance bails 20% sooner; Context Window x2.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { resetTuning, TUNING } from '../src/core/tuning';
import {
  balanceInput, driftK, isBalanceBail, startBalance, stepBalance, stopBalance, switchDriftMult,
} from '../src/sim/balance';
import type { BalanceState } from '../src/sim/types';

const DT = 1 / 120;

function needle(n: number, k: number, axis: 'h' | 'v' = 'h'): BalanceState {
  return { needle: n, velocity: 0, axis, k, active: true };
}

/** Ticks until |needle| >= 1 with the given input policy, or null if it holds for maxTicks. */
function bailTicks(start: BalanceState, input: (b: BalanceState) => number = () => 0, cw = false, maxTicks = 120 * 60): number | null {
  let b = start;
  for (let i = 1; i <= maxTicks; i++) {
    b = stepBalance(b, input(b), DT, cw);
    if (isBalanceBail(b)) return i;
  }
  return null;
}

afterEach(() => resetTuning());

describe('drift constant k (REQ-BAL-01, REQ-BAL-04, REQ-BAL-05)', () => {
  it('first grind k = 0.5, one element before 0.56, five 0.8, ten 1.1', () => {
    expect(driftK({ elementsBefore: 0, sameObject: false, switchStance: false })).toBe(0.5);
    expect(driftK({ elementsBefore: 1, sameObject: false, switchStance: false })).toBeCloseTo(0.56, 12);
    expect(driftK({ elementsBefore: 5, sameObject: false, switchStance: false })).toBeCloseTo(0.8, 12);
    expect(driftK({ elementsBefore: 10, sameObject: false, switchStance: false })).toBeCloseTo(1.1, 12);
  });

  it('same object x1.6, not compounding with the count: 5 elements on the same rail = 1.28', () => {
    expect(driftK({ elementsBefore: 5, sameObject: true, switchStance: false })).toBeCloseTo(1.28, 12);
    expect(driftK({ elementsBefore: 0, sameObject: true, switchStance: false })).toBeCloseTo(0.8, 12);
  });

  it('switch stance x1.35 at switch stat 4 (CR-19), x1 at stat 10; balance stat divides k', () => {
    expect(switchDriftMult()).toBeCloseTo(1.35, 12);
    expect(driftK({ elementsBefore: 0, sameObject: false, switchStance: true })).toBeCloseTo(0.675, 12);
    TUNING.STAT_SWITCH = 10;
    expect(switchDriftMult()).toBe(1);
    TUNING.STAT_SWITCH = 7;
    expect(switchDriftMult()).toBeCloseTo(1.175, 12);
    resetTuning();
    TUNING.STAT_BALANCE = 8; // statFactor 1.1
    expect(driftK({ elementsBefore: 0, sameObject: false, switchStance: false })).toBeCloseTo(0.5 / 1.1, 12);
  });
});

describe('needle dynamics: DESIGN D.4 feel check (exact ticks at 120 Hz)', () => {
  it('first grind, no input, k 0.5 from 0.05: bails at tick 425 (3.54 s)', () => {
    expect(bailTicks(needle(0.05, 0.5))).toBe(425);
  });
  it('5-element combo k 0.8 from 0.05: 294 ticks (2.45 s)', () => {
    expect(bailTicks(needle(0.05, driftK({ elementsBefore: 5, sameObject: false, switchStance: false })))).toBe(294);
  });
  it('same object with 5 elements k 1.28 from 0.35: 162 ticks (1.35 s)', () => {
    expect(bailTicks(needle(0.35, driftK({ elementsBefore: 5, sameObject: true, switchStance: false })))).toBe(162);
  });
  it('10-element chain k 1.1 from 0.35: 179 ticks (1.49 s)', () => {
    expect(bailTicks(needle(0.35, driftK({ elementsBefore: 10, sameObject: false, switchStance: false })))).toBe(179);
  });

  it('drift grows with element count: bail time strictly falls from 0 to 10 elements', () => {
    const times = Array.from({ length: 11 }, (_, e) => bailTicks(needle(0.35, driftK({ elementsBefore: e, sameObject: false, switchStance: false }))));
    expect(times).toEqual([315, 289, 268, 250, 235, 223, 212, 202, 193, 186, 179]);
  });

  it('switch stance bails 20% sooner than regular from 0.35 hands-off (REQ-CTL-13, CR-19)', () => {
    const reg = bailTicks(needle(0.35, driftK({ elementsBefore: 0, sameObject: false, switchStance: false })));
    const sw = bailTicks(needle(0.35, driftK({ elementsBefore: 0, sameObject: false, switchStance: true })));
    expect([reg, sw]).toEqual([315, 252]);
    expect((sw as number) / (reg as number)).toBeCloseTo(0.8, 2);
  });

  it('Context Window doubles drift: k 0.5 with the flag = k 1.0 without (191 ticks)', () => {
    expect(bailTicks(needle(0.35, 0.5), () => 0, true)).toBe(191);
    expect(bailTicks(needle(0.35, 1.0))).toBe(191);
    expect(bailTicks(needle(0.35, 0.5))).toBe(315);
  });

  it('input 2.0 out-pushes drift until 25 elements (12 on the same object) for a perfect player', () => {
    const perfect = (b: BalanceState) => -Math.sign(b.needle);
    const k = (e: number, same: boolean) => driftK({ elementsBefore: e, sameObject: same, switchStance: false });
    expect(bailTicks(needle(0.35, k(24, false)), perfect)).toBeNull();
    expect(bailTicks(needle(0.35, k(26, false)), perfect)).toBe(2054);
    expect(bailTicks(needle(0.35, k(12, true)), perfect)).toBeNull();
    expect(bailTicks(needle(0.35, k(13, true)), perfect)).toBe(2548);
  });

  it('bail exactly at |needle| >= 1; the needle is clamped to [-1, 1]; an inactive needle does not move', () => {
    expect(isBalanceBail(needle(1, 0.5))).toBe(true);
    expect(isBalanceBail(needle(-1, 0.5))).toBe(true);
    expect(isBalanceBail(needle(0.9999, 0.5))).toBe(false);
    const fast = stepBalance({ ...needle(0.99, 0.5), velocity: 50 }, 0, DT, false);
    expect(fast.needle).toBe(1);
    const off = stopBalance(needle(0.6, 0.5));
    expect(off).toEqual({ needle: 0.6, velocity: 0, axis: 'h', k: 0.5, active: false });
    expect(stepBalance(off, 1, DT, false)).toBe(off);
    expect(isBalanceBail({ ...off, needle: 1 })).toBe(false);
  });
});

describe('re-centre on each new element (REQ-BAL-02, CR-06)', () => {
  it('a new element starts at 0.35 x the sign of the previous needle, velocity 0', () => {
    const rng = createRng(7);
    const s = rng.state;
    const right = startBalance({ ...needle(0.8, 0.5), velocity: 0.4 }, 'h', 0.56, rng);
    expect(right).toEqual({ needle: 0.35, velocity: 0, axis: 'h', k: 0.56, active: true });
    const left = startBalance(stopBalance(needle(-0.62, 0.5)), 'v', 0.62, rng);
    expect(left).toEqual({ needle: -0.35, velocity: 0, axis: 'v', k: 0.62, active: true });
    expect(rng.state).toBe(s); // a signed previous needle draws no random number
  });

  it('the first element starts at 0.05 x a seeded coin flip, reproducible from the seed', () => {
    const a = startBalance(null, 'h', 0.5, createRng(42));
    const b = startBalance(null, 'h', 0.5, createRng(42));
    expect(a).toEqual(b);
    expect(Math.abs(a.needle)).toBe(0.05);
    expect(a.needle).toBe(0.05 * createRng(42).sign());
    const signs = new Set(Array.from({ length: 40 }, (_, i) => Math.sign(startBalance(null, 'h', 0.5, createRng(i)).needle)));
    expect(signs).toEqual(new Set([1, -1]));
  });

  it('a centred previous needle (exactly 0) takes a seeded sign at 0.35', () => {
    const r = startBalance(needle(0, 0.5), 'h', 0.5, createRng(3));
    expect(Math.abs(r.needle)).toBe(0.35);
  });

  it('re-centring halves a near-bail: 0.35 from 0.95 buys the D.4 1.35 s at k 1.28', () => {
    const k = driftK({ elementsBefore: 5, sameObject: true, switchStance: false });
    const r = startBalance(needle(0.95, 1.1), 'h', k, createRng(1));
    expect(bailTicks(r)).toBe(162);
  });
});

describe('axes and signs (REQ-BAL-03, CR-02)', () => {
  it('manual reads the vertical axis, Up = -1; grind and lip read the horizontal axis, Left = -1', () => {
    expect(balanceInput('v', { x: 0, y: 1 })).toBe(-1);
    expect(balanceInput('v', { x: 0, y: -1 })).toBe(1);
    expect(balanceInput('v', { x: -1, y: 0 })).toBe(0);
    expect(balanceInput('v', { x: 0.3, y: 0.5 })).toBe(-0.5);
    expect(balanceInput('h', { x: -1, y: 0 })).toBe(-1);
    expect(balanceInput('h', { x: 1, y: 0 })).toBe(1);
    expect(balanceInput('h', { x: 0, y: 1 })).toBe(0);
    expect(balanceInput('h', { x: 0.25, y: -1 })).toBe(0.25);
  });

  it('input -1 pushes the needle negative (Left on a grind, Up = nose down on a manual)', () => {
    TUNING.BAL_MANUAL_DRIFT_MULT = 1; // same dynamics on both axes here; the manual mult has its own test
    let g = needle(0.05, 0.5, 'h');
    for (let i = 0; i < 120; i++) g = stepBalance(g, balanceInput('h', { x: -1, y: 0 }), DT, false);
    expect(g.needle).toBeCloseTo(-0.6200617551413705, 12);
    let m = needle(0.05, 0.5, 'v');
    for (let i = 0; i < 120; i++) m = stepBalance(m, balanceInput('v', { x: 0, y: 1 }), DT, false);
    expect(m.needle).toBeCloseTo(-0.6200617551413705, 12);
    let back = needle(-0.3, 0.5, 'v');
    for (let i = 0; i < 60; i++) back = stepBalance(back, balanceInput('v', { x: 0, y: -1 }), DT, false);
    expect(back.needle).toBeGreaterThan(-0.3);
  });

  it('with no input the drift is symmetric: +0.35 and -0.35 mirror exactly', () => {
    let p = needle(0.35, 0.5);
    let n = needle(-0.35, 0.5);
    for (let i = 0; i < 60; i++) {
      p = stepBalance(p, 0, DT, false);
      n = stepBalance(n, 0, DT, false);
    }
    expect(p.needle).toBeCloseTo(0.39976171371393965, 12);
    expect(n.needle).toBe(-p.needle);
  });
});
