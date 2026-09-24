/**
 * tests/special.test.ts (logic track): special meter (REQ-SPC-01..04, REQ-SPC-06, SPEC §6):
 * fill from landed COMBO_BASE (full at 6000), 4%/s idle drain after 3 s, paused while a combo is
 * alive, glow on at 1.0 and off below 0.85, +8% max speed while glowing, bail empties it instantly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maxSpeed, resetTuning, TUNING } from '../src/core/tuning';
import {
  createSpecial, emptySpecial, feedSpecial, glowSpeedFactor, specialsEnabled, stepSpecial,
} from '../src/sim/special';
import type { SpecialState } from '../src/sim/types';

const DT = 1 / 120;

function idle(s: SpecialState, seconds: number, comboAlive = false): SpecialState {
  let st = s;
  for (let i = 0; i < Math.round(seconds * 120); i++) st = stepSpecial(st, DT, comboAlive).state;
  return st;
}

// These suites prove the meter rules with the SPEC §6 numbers the DESIGN D.3 worked example uses
// (full at 6000, 4%/s after 3 s). The shipped defaults are easier since the founder's 2026-09-23
// playtest (3000, 3%/s after 4 s); tests/tuning.test.ts pins those.
beforeEach(() => {
  TUNING.SPECIAL_FULL_BASE = 6000;
  TUNING.SPECIAL_IDLE_DELAY_S = 3;
  TUNING.SPECIAL_DRAIN_PER_S = 0.04;
});
afterEach(() => resetTuning());

describe('fill (REQ-SPC-01)', () => {
  it('starts empty; each completed element adds (value + accrual) / 6000', () => {
    const s0 = createSpecial();
    expect(s0).toEqual({ meter: 0, glowing: false, idleS: 0 });
    const s1 = feedSpecial(s0, 1632);
    expect(s1.state.meter).toBeCloseTo(0.272, 12);
    expect(s1.becameGlowing).toBe(false);
    expect(feedSpecial(s1.state, 1500).state.meter).toBeCloseTo(0.522, 12);
  });

  it('0 to full at 6000 base: glows exactly at 6000, clamped at 1', () => {
    const almost = feedSpecial(createSpecial(), 5999);
    expect(almost.state.glowing).toBe(false);
    const full = feedSpecial(almost.state, 1);
    expect(full.state.meter).toBe(1);
    expect(full.becameGlowing).toBe(true);
    expect(full.state.glowing).toBe(true);
    const over = feedSpecial(full.state, 9000);
    expect(over.state.meter).toBe(1);
    expect(over.becameGlowing).toBe(false);
  });

  it('SPECIAL_FULL_BASE is read live', () => {
    TUNING.SPECIAL_FULL_BASE = 4000;
    expect(feedSpecial(createSpecial(), 1000).state.meter).toBe(0.25);
  });
});

describe('idle drain (REQ-SPC-02)', () => {
  it('nothing drains for 3 s, then 4% per second', () => {
    const half = feedSpecial(createSpecial(), 3000).state;
    const at3 = idle(half, 3);
    expect(at3.meter).toBe(0.5);
    expect(at3.idleS).toBeCloseTo(3, 9);
    expect(idle(half, 4).meter).toBeCloseTo(0.46, 9);
    expect(idle(half, 8).meter).toBeCloseTo(0.3, 9);
  });

  it('drains to 0 and stops there', () => {
    const s = feedSpecial(createSpecial(), 600).state; // 0.1
    expect(idle(s, 3 + 2.5).meter).toBeCloseTo(0, 9);
    expect(idle(s, 20).meter).toBe(0);
  });

  it('the drain pauses while a combo is alive; a completed element resets the idle timer', () => {
    const s = feedSpecial(createSpecial(), 3000).state;
    const inCombo = idle(s, 10, true);
    expect(inCombo.meter).toBe(0.5);
    expect(inCombo.idleS).toBeCloseTo(10, 9);
    // The combo banks: its elements complete, which resets the timer, so 3 s of grace start again.
    const fed = feedSpecial(inCombo, 0).state;
    expect(fed.idleS).toBe(0);
    expect(idle(fed, 3).meter).toBe(0.5);
    expect(idle(fed, 5).meter).toBeCloseTo(0.42, 9);
  });

  it('drain rate and delay are read live', () => {
    TUNING.SPECIAL_IDLE_DELAY_S = 2;
    TUNING.SPECIAL_DRAIN_PER_S = 0.08;
    expect(idle(feedSpecial(createSpecial(), 6000).state, 3).meter).toBeCloseTo(0.92, 9);
  });
});

describe('glow (REQ-SPC-03, REQ-SPC-06)', () => {
  it('on at 1.0, stays on down to 0.85, off below it (hysteresis)', () => {
    const full = feedSpecial(createSpecial(), 6000).state;
    const stillOn = idle(full, 3 + 3.5); // 1 - 0.14 = 0.86
    expect(stillOn.meter).toBeCloseTo(0.86, 9);
    expect(stillOn.glowing).toBe(true);
    let s = stillOn;
    let stopped = -1;
    for (let i = 1; i <= 120; i++) {
      const r = stepSpecial(s, DT, false);
      s = r.state;
      if (r.stoppedGlowing) {
        stopped = i;
        break;
      }
    }
    // 0.86 -> below 0.85 takes 0.25 s = 30 ticks (0.01 / 0.04 per s).
    expect(stopped).toBe(31);
    expect(s.glowing).toBe(false);
    expect(s.meter).toBeLessThan(0.85);
    // Refilling to 0.9 does not relight it: glow needs a full meter again.
    const refill = feedSpecial(s, 0.05 * 6000).state;
    expect(refill.meter).toBeGreaterThan(0.85);
    expect(refill.glowing).toBe(false);
    expect(feedSpecial(refill, 6000).becameGlowing).toBe(true);
  });

  it('glowing enables specials and +8% max speed; a special does not spend the meter', () => {
    const full = feedSpecial(createSpecial(), 6000).state;
    expect(specialsEnabled(full)).toBe(true);
    expect(specialsEnabled(createSpecial())).toBe(false);
    expect(glowSpeedFactor(full)).toBeCloseTo(1.08, 12);
    expect(glowSpeedFactor(createSpecial())).toBe(1);
    expect(maxSpeed(true) / maxSpeed(false)).toBeCloseTo(1.08, 12);
    // A Kernel Panic landed while glowing is just another element: it feeds, it never subtracts.
    const after = feedSpecial(full, 3000).state;
    expect(after.meter).toBe(1);
    expect(after.glowing).toBe(true);
  });
});

describe('bail (REQ-SPC-04)', () => {
  it('empties the meter and ends the glow instantly', () => {
    const full = feedSpecial(createSpecial(), 6000).state;
    const r = emptySpecial(full);
    expect(r.state).toEqual({ meter: 0, glowing: false, idleS: 0 });
    expect(r.stoppedGlowing).toBe(true);
    expect(r.becameGlowing).toBe(false);
    const part = emptySpecial(feedSpecial(createSpecial(), 1200).state);
    expect(part.state.meter).toBe(0);
    expect(part.stoppedGlowing).toBe(false);
  });
});
