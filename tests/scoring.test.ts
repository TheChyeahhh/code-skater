/**
 * tests/scoring.test.ts (logic track): SPEC §13 scoring suite. DESIGN D.3 worked example with every
 * intermediate number (REQ-SCR-01, REQ-TST-05), degradation per run and both presets (REQ-DEG-01..05),
 * switch history (CR-05), gaps and MacGuffins (REQ-SCR-05 / 06), bail (REQ-SCR-07), spin (REQ-SCR-03,
 * REQ-VRT-07), land quality (REQ-CTL-10, REQ-SCR-08), grind-type switch (REQ-GRD-07), enhanced
 * replacement (REQ-SCR-11), nollie (REQ-SCR-10), accrual rounding (REQ-SCR-04).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import {
  comboBase, comboFinal, comboMultiplier, degradationFactor, landQuality, Scoring, trickValue,
} from '../src/sim/scoring';
import { createSpecial, emptySpecial, feedSpecial } from '../src/sim/special';
import type { BaseTrickId } from '../src/core/types';
import type { ElementSpec } from '../src/sim/types';
import { WORKED_EXAMPLE as W } from './fixtures/workedExample';
import { LogicRig, VERT_LANDING, landing } from './fixtures/logic/rig';

const TICK_S = 1 / 120;

function trick(trickId: BaseTrickId, p: Partial<ElementSpec> = {}): ElementSpec {
  return { ref: { kind: 'trick', trickId }, stance: 'regular', holdable: false, ...p };
}

function hold(s: Scoring, n: number): void {
  for (let i = 0; i < n; i++) s.accrue(TICK_S);
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

describe('DESIGN D.3 worked example (REQ-SCR-01)', () => {
  it('reproduces every intermediate number and FINAL 15504', () => {
    const s = new Scoring(W.historyBefore);
    let tick = 0;
    let fed = createSpecial();
    const feed = () => {
      for (const el of s.takeClosed()) fed = feedSpecial(fed, el.value + el.accrual).state;
    };
    for (const step of W.steps) {
      const before = step.ref.kind === 'trick' ? (s.history[step.expected.id] ?? 0) : null;
      expect(before, `row ${step.n} times done before`).toBe(step.expected.timesBefore);
      const el = s.addElement({ ref: step.ref, stance: step.stance, holdable: step.holdable, railId: step.railId, gap: step.gap }, tick);
      feed();
      expect(el.id, `row ${step.n} id`).toBe(step.expected.id);
      expect(el.base, `row ${step.n} base`).toBe(step.expected.base);
      expect(el.stanceMult, `row ${step.n} stance`).toBe(step.expected.stanceMult);
      expect(el.degradation, `row ${step.n} degradation`).toBe(step.expected.degradation);
      expect(el.value, `row ${step.n} trickValue`).toBeCloseTo(step.expected.value, 9);
      hold(s, step.holdTicks);
      tick += step.holdTicks + 1;
      s.addSpins(step.spinsAfter);
    }
    const combo = s.combo;
    expect(combo).not.toBeNull();
    if (!combo) return;
    // Live view before the bank: the last element (heelflip) is not holdable, the manual closed when it was added.
    const values = combo.elements.map((e) => e.value);
    const accruals = combo.elements.map((e) => e.accrual);
    expect(accruals).toEqual(W.steps.map((st) => st.expected.accrual));
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(W.trickValueSum, 9);
    expect(accruals.reduce((a, b) => a + b, 0)).toBe(W.accrualSum);
    expect(combo.elements.length).toBe(W.elements);
    expect(combo.spin180s).toBe(W.spin180s);
    expect(TUNING.SPIN_MULT_PER_180 * combo.spin180s).toBe(W.spinBonus);
    expect(comboBase(combo)).toBeCloseTo(W.comboBase, 9);
    expect(comboMultiplier(combo)).toBe(W.multiplier);
    expect(comboFinal(combo)).toBe(W.final);
    const view = s.view();
    expect(view?.base).toBe(W.comboBase);
    expect(view?.final).toBe(W.final);
    expect(view?.names).toEqual(['Kickflip', '50-50', 'Smith', 'PLAZA BAR HOP', 'Boardslide', 'Revert', 'Switch Manual', 'Switch Heelflip']);

    const banked = s.bank(tick, W.landOffAxisDeg);
    feed();
    expect(banked.final).toBe(W.final);
    expect(banked.base).toBeCloseTo(W.comboBase, 9);
    expect(banked.multiplier).toBe(W.multiplier);
    expect(banked.elementCount).toBe(W.elements);
    expect(banked.quality).toBe(W.landQuality);
    expect(s.runScore).toBe(W.final);
    expect(s.lastBanked).toBe(W.final);
    expect(s.bestCombo).toBe(W.final);
    expect(s.combo).toBeNull();
    expect(fed.meter).toBeCloseTo(W.specialFed, 12);
    expect(s.history).toEqual(W.historyAfter);
  });

  it('the same line through the TRANSITIONS rows banks 15504', () => {
    const rig = new LogicRig(W.historyBefore);
    rig.send({ kind: 'crossPress' });
    rig.wait(72);
    rig.send({ kind: 'crossRelease' });
    rig.add({ kind: 'trick', trickId: 'kickflip' });
    rig.wait(79);
    rig.scoring.addSpins(1);
    rig.send({ kind: 'grindTry', candidate: 'rail', ground: false, railId: 'MS-L2', grindType: 'fifty_fifty', lipId: 'axle_stall' });
    rig.wait(120);
    rig.send({ kind: 'grindSwitch', grindType: 'smith' });
    rig.wait(96);
    rig.send({ kind: 'crossPress' });
    rig.send({ kind: 'crossRelease' });
    rig.add({ kind: 'gap', gapId: 'MS-G03' }, { gap: { name: 'PLAZA BAR HOP', base: 500 } });
    rig.wait(30);
    rig.send({ kind: 'grindTry', candidate: 'rail', ground: false, railId: 'MS-R1', grindType: 'boardslide', lipId: 'axle_stall' });
    rig.wait(216);
    rig.send({ kind: 'railEnd', corner: false });
    rig.wait(40);
    rig.send({ kind: 'contact', landing: VERT_LANDING({ revertBuffered: true }) }, { surface: null });
    expect(rig.stance).toBe('switch');
    rig.wait(10);
    rig.send({ kind: 'revertManual', manual: 'manual' });
    rig.wait(180);
    rig.send({ kind: 'crossPress' });
    rig.send({ kind: 'crossRelease' });
    rig.add({ kind: 'trick', trickId: 'heelflip' });
    rig.wait(60);
    rig.scoring.addSpins(2);
    rig.send({ kind: 'contact', landing: landing() }, { surface: null });
    rig.wait(17);
    expect(rig.rows).toEqual(['1', '3', '2', '5', '20', 'x:grind-charge', '19', '5', '21', '8', '15', 'x:manual-charge', '27', '9', '9b']);
    expect(rig.m.state).toBe('Grounded');
    expect(rig.banks).toEqual([W.final]);
    expect(rig.scoring.runScore).toBe(15504);
    expect(rig.special.meter).toBeCloseTo(W.specialFed, 12);
    expect(rig.scoring.history).toEqual(W.historyAfter);
  });
});

describe('degradation per run (REQ-DEG-01..05)', () => {
  it('classic table: 100, 90, 75, 50, 25, 25 across combos in one run; resetRun restores 100', () => {
    const s = new Scoring();
    const values: number[] = [];
    for (let i = 0; i < 6; i++) {
      values.push(s.addElement(trick('kickflip'), i).value);
      s.bank(i, 0);
    }
    expect(values).toEqual([100, 90, 75, 50, 25, 25]);
    expect(s.history).toEqual({ kickflip: 6 });
    s.resetRun();
    expect(s.history).toEqual({});
    expect(s.runScore).toBe(0);
    expect(s.addElement(trick('kickflip'), 0).value).toBe(100);
  });

  it('degradationFactor follows the preset, steep = 1, 0.75, 0.5, 0.25, 0.1', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(degradationFactor)).toEqual([1, 0.9, 0.75, 0.5, 0.25, 0.25, 0.25]);
    TUNING.DEGRADATION_PRESET = 'steep';
    expect([0, 1, 2, 3, 4, 5].map(degradationFactor)).toEqual([1, 0.75, 0.5, 0.25, 0.1, 0.1]);
    const s = new Scoring();
    expect([0, 1, 2, 3, 4].map((i) => s.addElement(trick('impossible'), i).value)).toEqual([200, 150, 100, 50, 20]);
  });

  it('the count increments on add even when the combo is lost (REQ-DEG-04)', () => {
    const s = new Scoring();
    s.addElement(trick('heelflip'), 0);
    s.lose(1);
    expect(s.history).toEqual({ heelflip: 1 });
    expect(s.addElement(trick('heelflip'), 2).value).toBe(90);
  });

  it('switch variant has a separate history (CR-05, REQ-DEG-03)', () => {
    const s = new Scoring();
    expect(s.addElement(trick('kickflip'), 0).value).toBe(100);
    expect(s.addElement(trick('kickflip'), 1).value).toBe(90);
    const sw = s.addElement(trick('kickflip', { stance: 'switch' }), 2);
    expect(sw.id).toBe('switch_kickflip');
    expect(sw.name).toBe('Switch Kickflip');
    expect(sw.degradation).toBe(1);
    expect(sw.value).toBeCloseTo(120, 9);
    expect(s.addElement(trick('kickflip', { stance: 'switch' }), 3).value).toBeCloseTo(108, 9);
    expect(s.history).toEqual({ kickflip: 2, switch_kickflip: 2 });
  });

  it('nollie and fakie are their own ids at base x1.1 (REQ-SCR-10); stance x1.2 stacks', () => {
    const s = new Scoring();
    const n = s.addElement(trick('kickflip', { nollie: true }), 0);
    expect(n.id).toBe('nollie_kickflip');
    expect(n.value).toBeCloseTo(110, 9);
    const f = s.addElement(trick('indy', { fakie: true, holdable: true }), 1);
    expect(f.id).toBe('fakie_indy');
    expect(f.value).toBeCloseTo(165, 9);
    const sn = s.addElement(trick('kickflip', { nollie: true, stance: 'switch' }), 2);
    expect(sn.id).toBe('switch_nollie_kickflip');
    expect(sn.value).toBeCloseTo(132, 9);
    // Nollie is an air-trick variant only: a grind ignores the flag.
    expect(s.addElement(trick('smith', { nollie: true, holdable: true }), 3).id).toBe('smith');
    expect(s.history).toEqual({ nollie_kickflip: 1, fakie_indy: 1, switch_nollie_kickflip: 1, smith: 1 });
  });

  it('grind-type switch is a new element with its own history (REQ-DEG-05, E.1 anti-cheese)', () => {
    const s = new Scoring();
    const seq: BaseTrickId[] = ['fifty_fifty', 'smith', 'fifty_fifty', 'smith', 'fifty_fifty', 'smith', 'fifty_fifty', 'smith', 'fifty_fifty'];
    const values = seq.map((id, i) => s.addElement(trick(id, { holdable: true, railId: 'MS-L2' }), i).value);
    expect(values.slice(0, 4)).toEqual([100, 180, 90, 162]);
    expect(values[8]).toBe(25);
    expect(s.combo?.elements.length).toBe(9);
    expect(s.history).toEqual({ fifty_fifty: 5, smith: 4 });
  });
});

describe('gaps and MacGuffins never degrade (REQ-SCR-05, REQ-SCR-06)', () => {
  it('the same gap six times in one run is worth its base every time and is not counted', () => {
    const s = new Scoring();
    for (let i = 0; i < 6; i++) {
      const g = s.addElement({ ref: { kind: 'gap', gapId: 'MS-G03' }, stance: 'switch', holdable: false, gap: { name: 'PLAZA BAR HOP', base: 500 } }, i);
      expect(g.value).toBe(500);
      expect(g.degradation).toBe(1);
      expect(g.stanceMult).toBe(1);
      expect(g.category).toBe('gap');
      expect(g.baseId).toBeNull();
      s.bank(i, 0);
    }
    expect(s.runScore).toBe(6 * 500);
    expect(s.history).toEqual({});
  });

  it('a MacGuffin is 2500 every time, in any stance, and never enters the history', () => {
    const s = new Scoring();
    for (let i = 0; i < 5; i++) {
      const m = s.addElement(trick('secret_laptop', { stance: i % 2 === 0 ? 'switch' : 'regular' }), i);
      expect(m.id).toBe('secret_laptop');
      expect(m.value).toBe(2500);
      expect(m.stanceMult).toBe(1);
      expect(m.degradation).toBe(1);
    }
    expect(s.combo?.elements.length).toBe(5);
    expect(s.history).toEqual({});
  });
});

describe('bail (REQ-SCR-07, REQ-SM-05)', () => {
  it('discards the whole combo and the special meter goes to 0', () => {
    const s = new Scoring();
    let sp = createSpecial();
    s.addElement(trick('kickflip'), 0);
    s.addElement(trick('fifty_fifty', { holdable: true }), 1);
    hold(s, 240);
    s.addElement(trick('smith', { holdable: true }), 250);
    for (const el of s.takeClosed()) sp = feedSpecial(sp, el.value + el.accrual).state;
    expect(sp.meter).toBeCloseTo((100 + 100 + 160) / 6000, 12);
    hold(s, 120);
    const lost = s.lose(400);
    sp = emptySpecial(sp).state;
    expect(lost.elementCount).toBe(3);
    expect(lost.base).toBe(100 + 100 + 160 + 180 + 90);
    expect(lost.multiplier).toBe(3);
    expect(s.combo).toBeNull();
    expect(s.view()).toBeNull();
    expect(s.runScore).toBe(0);
    expect(s.lastBanked).toBe(0);
    expect(s.takeClosed()).toEqual([]);
    expect(sp).toEqual({ meter: 0, glowing: false, idleS: 0 });
  });

  it('lose drops elements completed but not yet reported, so a bail never feeds the meter', () => {
    const s = new Scoring();
    s.addElement(trick('kickflip'), 0);
    s.addElement(trick('japan', { holdable: true }), 1); // kickflip completes here, unreported
    hold(s, 60);
    s.lose(70);
    expect(s.takeClosed()).toEqual([]);
    s.addElement(trick('heelflip'), 80);
    s.bank(81, 0);
    expect(s.takeClosed().map((e) => e.id)).toEqual(['heelflip']);
  });

  it('an empty combo banked after a real bank leaves lastBanked at the real FINAL (trickless ollie)', () => {
    const s = new Scoring();
    s.addElement(trick('kickflip'), 0);
    const real = s.bank(10, 0).final;
    expect(real).toBeGreaterThan(0);
    s.startCombo(20); // plain ollie: combo started, no element
    const empty = s.bank(30, 0);
    expect(empty.elementCount).toBe(0);
    expect(s.lastBanked).toBe(real);
    expect(s.runScore).toBe(real);
  });

  it('through the state machine: a needle-out bail in a grind loses the combo and empties a glowing meter', () => {
    const rig = new LogicRig({}, 'Air');
    rig.scoring.startCombo(0);
    rig.special = { meter: 1, glowing: true, idleS: 0 };
    rig.send({ kind: 'grindTry', candidate: 'rail', ground: false, railId: 'R', grindType: 'fifty_fifty', lipId: 'axle_stall' });
    rig.wait(60);
    const r = rig.send({ kind: 'needleOut' });
    expect(r.row).toBe('23');
    expect(r.combo).toBe('lose');
    expect(rig.scoring.combo).toBeNull();
    expect(rig.scoring.runScore).toBe(0);
    expect(rig.special).toEqual({ meter: 0, glowing: false, idleS: 0 });
  });
});

describe('spin and multiplier (REQ-SCR-03, REQ-VRT-07)', () => {
  it('+0.5 per 180, accumulated across airs in one combo', () => {
    const s = new Scoring();
    s.addElement(trick('kickflip'), 0);
    expect(s.view()?.multiplier).toBe(1);
    s.addSpins(1);
    expect(s.view()?.multiplier).toBe(1.5);
    s.addElement(trick('melon', { holdable: true }), 1);
    s.addSpins(2);
    expect(s.view()?.multiplier).toBe(3.5);
    expect(s.view()?.spin180s).toBe(3);
    // 100 + 150 = 250 x 3.5 = 875
    expect(s.bank(2, 0).final).toBe(875);
  });

  it('SPIN_MODE "base" adds SPIN_BASE_PER_180 per 180 to the base and nothing to the multiplier', () => {
    TUNING.SPIN_MODE = 'base';
    const s = new Scoring();
    s.addElement(trick('kickflip'), 0);
    s.addSpins(3);
    const v = s.view();
    expect(v?.multiplier).toBe(1);
    expect(v?.base).toBe(100 + 300);
    expect(s.bank(1, 0).final).toBe(400);
  });

  it('an empty combo banks 0 and a spin with no combo is ignored', () => {
    const s = new Scoring();
    s.addSpins(2);
    expect(s.combo).toBeNull();
    s.startCombo(0);
    s.addSpins(2);
    expect(s.bank(1, 0).final).toBe(0);
    expect(s.runScore).toBe(0);
  });
});

describe('land quality (REQ-CTL-10, REQ-SCR-08)', () => {
  it('clean < 20, OK 20 to 50 (CR-43), SICK >= 10000, INSANE >= 50000 on the banked FINAL', () => {
    expect(landQuality(19.9, 0)).toBe('clean');
    expect(landQuality(20, 0)).toBe('ok');
    expect(landQuality(50, 0)).toBe('ok');
    expect(landQuality(0, 9999)).toBe('clean');
    expect(landQuality(25, 9999)).toBe('ok');
    expect(landQuality(0, 10000)).toBe('sick');
    expect(landQuality(27, 49999)).toBe('sick');
    expect(landQuality(0, 50000)).toBe('insane');
  });

  it('bank stamps the quality from the stored off-axis and the FINAL', () => {
    const s = new Scoring();
    s.addElement(trick('kickflip'), 0);
    expect(s.bank(1, 20).quality).toBe('ok');
    s.addElement(trick('heelflip'), 2);
    expect(s.bank(3, 3).quality).toBe('clean');
  });
});

describe('elements, accrual and replacement', () => {
  it('trickValue = base x stance x variant x degradation, not rounded; FINAL floors', () => {
    expect(trickValue(150, 1, 1, 0.25)).toBe(37.5);
    const s = new Scoring({ indy: 4 });
    s.addElement(trick('indy', { holdable: true }), 0);
    expect(s.view()?.base).toBe(37);
    expect(s.bank(1, 0).final).toBe(37);
  });

  it('hold accrual rounds to whole points, is not stance-multiplied nor degraded (REQ-SCR-02, REQ-SCR-04)', () => {
    const s = new Scoring({ switch_five_o: 4 });
    s.addElement(trick('five_o', { holdable: true, stance: 'switch' }), 0);
    hold(s, 61); // 0.508 s x 90/s = 45.75 -> 46
    expect(s.view()?.elements[0]?.accrual).toBe(46);
    expect(s.view()?.elements[0]?.open).toBe(true);
    s.closeOpen();
    hold(s, 60); // closed: no more accrual
    const el = s.combo?.elements[0];
    expect(el?.accrual).toBe(46);
    expect(el?.open).toBe(false);
    expect(el?.value).toBeCloseTo(150 * 1.2 * 0.25, 9);
  });

  it('a double tap replaces the pending flip, one element, history re-keyed (REQ-SCR-11)', () => {
    const s = new Scoring({ kickflip: 1 });
    s.addElement(trick('kickflip'), 0);
    const d = s.replaceLast(trick('double_kickflip'), 5);
    expect(d.id).toBe('double_kickflip');
    expect(d.value).toBe(150);
    expect(d.addedTick).toBe(0);
    expect(s.combo?.elements.length).toBe(1);
    expect(s.history).toEqual({ kickflip: 1, double_kickflip: 1 });
    // The replaced flip never feeds the meter; the replacement does, once, when the combo banks.
    expect(s.takeClosed()).toEqual([]);
    s.bank(6, 0);
    expect(s.takeClosed().map((e) => e.id)).toEqual(['double_kickflip']);
  });

  it('takeClosed reports completed elements in completion order, each once', () => {
    const s = new Scoring();
    s.addElement(trick('kickflip'), 0);
    expect(s.takeClosed()).toEqual([]); // pending: a double tap could still replace it
    s.addElement(trick('japan', { holdable: true }), 1);
    expect(s.takeClosed().map((e) => e.id)).toEqual(['kickflip']);
    hold(s, 30);
    s.closeOpen();
    const closed = s.takeClosed();
    expect(closed.map((e) => [e.id, e.accrual])).toEqual([['japan', 25]]);
    expect(s.takeClosed()).toEqual([]);
  });
});
