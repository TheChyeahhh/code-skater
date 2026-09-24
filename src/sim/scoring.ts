/**
 * src/sim/scoring.ts (logic track): combo, elements, hold accrual, bank, lose, and the per-run
 * degradation history (SPEC §6, DESIGN D, REQ-SCR-01..11, REQ-DEG-01..05). Pure logic, no events.
 *
 *   trickValue   = base x stanceMult x variantMult x degradation      (stance 1.2 if switch at add)
 *   holdAccrual  = holdRate x heldS, rounded when the element closes  (no stance, no degradation)
 *   COMBO_BASE   = sum(trickValue) + sum(holdAccrual)
 *   MULTIPLIER   = elements + SPIN_MULT_PER_180 x spin180s            (SPIN_MODE "multiplier")
 *                  elements                                          (SPIN_MODE "base": SPIN_BASE_PER_180 x 180s
 *                                                                     is added to COMBO_BASE instead)
 *   FINAL        = floor(COMBO_BASE x MULTIPLIER + 1e-6)              (the D.3 example must give 15504)
 *
 * - Degradation per RUN keyed by the variant id (switch_kickflip is separate from kickflip);
 *   the count increments when the element is ADDED, banked or not (REQ-DEG-04); factors from
 *   degradationTable() (DEGRADATION_PRESET). Gaps and MacGuffins never degrade, never take
 *   stance or nollie factors and are not counted in the history (REQ-SCR-05 / 06).
 * - Adding an element closes the currently open one (its accrual is rounded then).
 * - The special meter is fed per COMPLETED element with (value + accrual): read closed elements with
 *   takeClosed() after each call and feed src/sim/special.ts (REQ-SPC-01). A holdable element
 *   completes when it closes; a non-holdable one (flip, revert, gap, MacGuffin, Air special) stays
 *   "pending" until the next element is added or the combo banks, because a double tap may still
 *   replace it (REQ-SCR-11). lose() drops everything pending: the bail empties the meter anyway.
 * - Enhanced tricks REPLACE the pending element (replaceLast), never add a second one (REQ-SCR-11).
 * - Element names are brand-resolved via src/data/tricks.ts trickName (gaps use their GapDef name).
 */

import { degradationTable, TUNING } from '../core/tuning';
import type { ComboView, LandQuality } from '../core/types';
import { getTrick, isAirTrick, trickName, variantId } from '../data/tricks';
import type { BankResult, ComboElement, ComboState, ElementSpec, LoseResult } from './types';

/** ARCHITECTURE decision 6: absorbs binary float error in FINAL (so D.3 is exactly 15504). Not a tunable. */
const FINAL_EPSILON = 1e-6;

/** Factor for a trick already done `timesBefore` times this run (0 = first): 1, 0.9, 0.75, 0.5, 0.25... */
export function degradationFactor(timesBefore: number): number {
  const table = degradationTable();
  const i = Math.min(Math.max(0, Math.floor(timesBefore)), table.length - 1);
  return table[i] as number;
}

export function trickValue(base: number, stanceMult: number, variantMult: number, degradation: number): number {
  return base * stanceMult * variantMult * degradation;
}

export function comboBase(combo: ComboState): number {
  let sum = 0;
  for (const e of combo.elements) sum += e.value + e.accrual;
  if (TUNING.SPIN_MODE === 'base') sum += TUNING.SPIN_BASE_PER_180 * combo.spin180s;
  return sum;
}

export function comboMultiplier(combo: ComboState): number {
  const n = combo.elements.length;
  return TUNING.SPIN_MODE === 'multiplier' ? n + TUNING.SPIN_MULT_PER_180 * combo.spin180s : n;
}

export function comboFinal(combo: ComboState): number {
  return Math.floor(comboBase(combo) * comboMultiplier(combo) + FINAL_EPSILON);
}

/**
 * REQ-CTL-10 / REQ-VRT-09 / REQ-SCR-08: insane if bankedFinal >= INSANE_THRESHOLD, sick if >=
 * SICK_THRESHOLD, else clean if offAxisDeg < LAND_OFFAXIS_OK_DEG, else ok.
 */
export function landQuality(offAxisDeg: number, bankedFinal: number): LandQuality {
  if (bankedFinal >= TUNING.INSANE_THRESHOLD) return 'insane';
  if (bankedFinal >= TUNING.SICK_THRESHOLD) return 'sick';
  return Math.abs(offAxisDeg) < TUNING.LAND_OFFAXIS_OK_DEG ? 'clean' : 'ok';
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface LiveCombo {
  elements: Mutable<ComboElement>[];
  spin180s: number;
  startTick: number;
}

function freeze(e: Mutable<ComboElement>): ComboElement {
  return { ...e };
}

function stateOf(c: LiveCombo): ComboState {
  return { elements: c.elements.map(freeze), spin180s: c.spin180s, startTick: c.startTick };
}

/** Per-run scoring state. One instance per run; resetRun() at run start (REQ-DEG-01). */
export class Scoring {
  private hist: Record<string, number>;
  private live: LiveCombo | null = null;
  /** The element accruing hold time (holdable, not closed yet). */
  private openEl: Mutable<ComboElement> | null = null;
  /** The last non-holdable element, not yet reported to takeClosed (a double tap may replace it). */
  private pendingEl: Mutable<ComboElement> | null = null;
  private closed: ComboElement[] = [];
  private score = 0;
  private best = 0;
  private last = 0;

  /**
   * @param history degradation counts carried in (tests: the D.3 run history kickflip 1, boardslide 1).
   */
  constructor(history: Readonly<Record<string, number>> = {}) {
    this.hist = { ...history };
  }

  /** Times each variant id was added this run. */
  get history(): Readonly<Record<string, number>> {
    return { ...this.hist };
  }

  /** The live combo, or null. */
  get combo(): ComboState | null {
    return this.live ? stateOf(this.live) : null;
  }

  get runScore(): number {
    return this.score;
  }

  /** Best single banked FINAL this run. */
  get bestCombo(): number {
    return this.best;
  }

  /** FINAL of the most recent bank (0 if none). */
  get lastBanked(): number {
    return this.last;
  }

  /** Start an empty combo (rows with combo "start"); no-op if one is alive. */
  startCombo(tick: number): void {
    if (!this.live) this.live = { elements: [], spin180s: 0, startTick: tick };
  }

  /** Add a +1 element (starting a combo if needed). Returns the element as added. */
  addElement(spec: ElementSpec, tick: number): ComboElement {
    this.startCombo(tick);
    this.closeOpen();
    this.flushPending();
    const el = this.build(spec, tick);
    (this.live as LiveCombo).elements.push(el);
    this.track(el, spec.holdable);
    return freeze(el);
  }

  /** Replace the last element (enhanced / tweaked upgrade, REQ-SCR-11); degradation re-keyed to the new id. */
  replaceLast(spec: ElementSpec, tick: number): ComboElement {
    const els = this.live?.elements;
    const old = els && els.length > 0 ? els[els.length - 1] : undefined;
    if (!els || !old) return this.addElement(spec, tick);
    if (this.counts(old)) this.uncount(old);
    if (this.openEl === old) this.openEl = null;
    if (this.pendingEl === old) this.pendingEl = null;
    const el = this.build(spec, old.addedTick);
    els[els.length - 1] = el;
    this.track(el, spec.holdable);
    return freeze(el);
  }

  /** Add held time to the open element (presentation seconds for 900ms Inference, REQ-SPC-05). */
  accrue(dtS: number): void {
    const e = this.openEl;
    if (!e) return;
    e.heldS += dtS;
    e.accrual = Math.round(e.holdRate * e.heldS);
  }

  /** Close the open element now (rounds its accrual). */
  closeOpen(): void {
    const e = this.openEl;
    if (!e) return;
    e.accrual = Math.round(e.holdRate * e.heldS);
    e.open = false;
    this.openEl = null;
    this.closed.push(freeze(e));
  }

  /** Credit 180s at the end of an air (REQ-VRT-05, REQ-VRT-07). */
  addSpins(count180: number): void {
    if (this.live && count180 > 0) this.live.spin180s += count180;
  }

  /** Elements completed since the last call (for the special meter), in completion order. */
  takeClosed(): readonly ComboElement[] {
    const out = this.closed;
    this.closed = [];
    return out;
  }

  /** HUD / snapshot view with live accrual. */
  view(): ComboView | null {
    if (!this.live) return null;
    const c = stateOf(this.live);
    return {
      elements: c.elements.map((e) => ({ id: e.id, category: e.category, name: e.name, value: e.value, accrual: e.accrual, open: e.open })),
      names: c.elements.map((e) => e.name),
      base: Math.floor(comboBase(c) + FINAL_EPSILON),
      multiplier: comboMultiplier(c),
      spin180s: c.spin180s,
      final: comboFinal(c),
    };
  }

  /**
   * Bank: FINAL to the run score, combo cleared (rows with combo "bank"). offAxisDeg = the stored
   * off-axis angle of the most recent contact from Air (the world keeps it from the contact tick to
   * the bank); BankResult.quality = landQuality(offAxisDeg, final) (see LandView in core/types.ts).
   */
  bank(tick: number, offAxisDeg: number): BankResult {
    if (!this.live) {
      return { final: 0, base: 0, multiplier: 0, elementCount: 0, spin180s: 0, quality: landQuality(offAxisDeg, 0), elements: [] };
    }
    this.closeOpen();
    this.flushPending();
    const c = stateOf(this.live);
    const final = comboFinal(c);
    this.score += final;
    this.best = Math.max(this.best, final);
    // Same rule as the world's comboBanked event: an empty combo (trickless ollie) is not a bank.
    if (c.elements.length > 0) this.last = final;
    this.live = null;
    return {
      final, base: comboBase(c), multiplier: comboMultiplier(c), elementCount: c.elements.length,
      spin180s: c.spin180s, quality: landQuality(offAxisDeg, final), elements: c.elements,
    };
  }

  /** Lose: combo discarded (REQ-SCR-07); the caller also empties the special meter. */
  lose(tick: number): LoseResult {
    const c = this.live ? stateOf(this.live) : { elements: [], spin180s: 0, startTick: tick };
    const result: LoseResult = { base: comboBase(c), multiplier: comboMultiplier(c), elementCount: c.elements.length, elements: c.elements };
    this.live = null;
    this.openEl = null;
    this.pendingEl = null;
    this.closed = [];
    return result;
  }

  /** New run: history cleared, score 0 (REQ-DEG-01). */
  resetRun(): void {
    this.hist = {};
    this.live = null;
    this.openEl = null;
    this.pendingEl = null;
    this.closed = [];
    this.score = 0;
    this.best = 0;
    this.last = 0;
  }

  // ---- private ----

  private flushPending(): void {
    if (this.pendingEl) this.closed.push(freeze(this.pendingEl));
    this.pendingEl = null;
  }

  private track(el: Mutable<ComboElement>, holdable: boolean): void {
    if (holdable) this.openEl = el;
    else this.pendingEl = el;
  }

  /** Gaps and MacGuffins are never counted (they never degrade, REQ-SCR-05 / 06). */
  private counts(el: ComboElement): boolean {
    return el.category !== 'gap' && el.category !== 'macguffin';
  }

  private uncount(el: ComboElement): void {
    const n = this.hist[el.id] ?? 0;
    if (n <= 1) delete this.hist[el.id];
    else this.hist[el.id] = n - 1;
  }

  private build(spec: ElementSpec, tick: number): Mutable<ComboElement> {
    const holdable = spec.holdable;
    const ref = spec.ref;
    if (ref.kind === 'gap') {
      const base = spec.gap?.base ?? 0;
      return {
        id: `gap:${ref.gapId}`, baseId: null, category: 'gap', name: spec.gap?.name ?? ref.gapId, base,
        stanceMult: 1, variantMult: 1, degradation: 1, value: trickValue(base, 1, 1, 1),
        holdRate: 0, heldS: 0, accrual: 0, open: false, railId: spec.railId ?? null, addedTick: tick,
      };
    }
    const t = getTrick(ref.trickId);
    const air = isAirTrick(ref.trickId);
    const nollie = air && spec.nollie === true;
    const fakie = air && !nollie && spec.fakie === true;
    const id = variantId(ref.trickId, { switchStance: spec.stance === 'switch', nollie, fakie });
    const macguffin = t.category === 'macguffin';
    const stanceMult = !macguffin && spec.stance === 'switch' ? TUNING.STANCE_SWITCH_MULT : 1;
    const variantMult = nollie || fakie ? TUNING.NOLLIE_FAKIE_MULT : 1;
    let degradation = 1;
    if (!macguffin) {
      const before = this.hist[id] ?? 0;
      degradation = degradationFactor(before);
      this.hist[id] = before + 1;
    }
    return {
      id, baseId: ref.trickId, category: t.category, name: trickName(id), base: t.base,
      stanceMult, variantMult, degradation, value: trickValue(t.base, stanceMult, variantMult, degradation),
      holdRate: holdable ? (t.holdRate ?? 0) : 0, heldS: 0, accrual: 0, open: holdable,
      railId: spec.railId ?? null, addedTick: tick,
    };
  }
}
