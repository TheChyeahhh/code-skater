/**
 * src/sim/run.ts (sim track): the 2:00 run, letters, MacGuffin, NPC triggers and goal evaluation
 * (REQ-GOL-01..07, REQ-SM-09, REQ-SPC-05 clock, REQ-CTL-15 collection, REQ-NPC-02).
 *
 * Clock: sim state, decremented by dtS per tick, or dtS / INFERENCE_TIME_SCALE while 900ms Inference
 * is held so the HUD clock keeps real time (REQ-SPC-05). At 0 it freezes; a live combo may still bank;
 * RUN_OVERTIME_MAX_S later a still-alive combo is forced to bail (row 40).
 * Goals count on bank (element goals) or at run end (score goals) and fire once per run.
 * NPC talk: "npcTalk" fires on EVERY entry into an NPC trigger (outside -> inside), so leaving and
 * rolling back in repeats the dialog (REQ-NPC-02 wins over G.1's "once per run", DESIGN §L CR-23).
 * The sim only reports being inside (snapshot.npc); the HUD owns the dialog's open / closed state.
 *
 * Both run modes are 2:00 runs (REQ-GOL-01: "default session everywhere (Career and Free Skate)",
 * DESIGN H.1 "Free Skate -> 2:00 run without goal toasts"). The world evaluates goals in career mode
 * only (main menu: "Free Skate: no goals, just the line"); these functions are mode-free.
 */

import { TUNING, type NumericTuningKey } from '../core/tuning';
import { LETTERS, type LetterId, type LevelId, type MacGuffinId, type NpcId, type RunMode, type RunView, type Vec3 } from '../core/types';
import type { GoalDef } from '../data/goals';
import type { BuiltLevel, TriggerSphere } from '../levels/types';
import type { BankResult, ComboElement } from './types';

export interface RunState {
  readonly levelId: LevelId;
  readonly mode: RunMode;
  readonly clockS: number;
  /** Seconds since the clock hit 0 with a combo alive. */
  readonly overtimeS: number;
  readonly frozen: boolean;
  readonly ended: boolean;
  readonly score: number;
  readonly bestCombo: number;
  readonly letters: Readonly<Record<LetterId, boolean>>;
  readonly macguffin: MacGuffinId | null;
  readonly macguffinCollected: boolean;
  /** The MacGuffin came from the save (collected in an earlier career run): its goal is not re-completed. */
  readonly macguffinFromSave: boolean;
  readonly goalsCompleted: readonly string[];
  /** NPC whose trigger the skater is inside, and the tick it entered (the npcTalk tick). */
  readonly npcInside: { readonly id: NpcId; readonly sinceTick: number } | null;
}

export interface ClockStep {
  readonly run: RunState;
  /** The clock crossed 0 this tick. */
  readonly reachedZero: boolean;
  /** Whole seconds left when a new whole second was entered this tick (runTick event), else null. */
  readonly secondTick: number | null;
  /** Overtime cap reached this tick (force bail). */
  readonly overtimeExpired: boolean;
}

/** Facts about a banked combo that goals need beyond BankResult. */
export interface BankedComboFacts {
  readonly bank: BankResult;
  readonly elements: readonly ComboElement[];
  readonly gapIds: readonly string[];
  /** Surface ids contacted during the combo (Street goal 10). */
  readonly surfacesTouched: readonly string[];
  /** Longest hold per special id, presentation seconds (Woodshed goal 9). */
  readonly specialHeldS: Readonly<Record<string, number>>;
}

function noLetters(): Record<LetterId, boolean> {
  const r = {} as Record<LetterId, boolean>;
  for (const l of LETTERS) r[l] = false;
  return r;
}

export function createRun(level: BuiltLevel, mode: RunMode, lengthS: number, collected: readonly MacGuffinId[]): RunState {
  const macguffin = level.def.macguffin?.id ?? null;
  const fromSave = macguffin !== null && collected.includes(macguffin);
  return {
    levelId: level.def.id,
    mode,
    clockS: Math.max(0, lengthS),
    overtimeS: 0,
    frozen: false,
    ended: false,
    score: 0,
    bestCombo: 0,
    letters: noLetters(),
    macguffin,
    macguffinCollected: fromSave,
    macguffinFromSave: fromSave,
    goalsCompleted: [],
    npcInside: null,
  };
}

export function stepClock(run: RunState, dtS: number, inferenceHeld: boolean, comboAlive: boolean): ClockStep {
  if (run.ended) return { run, reachedZero: false, secondTick: null, overtimeExpired: false };
  if (run.clockS <= 0) {
    // Overtime only runs while a combo is alive at 0:00 (row 40).
    if (!comboAlive) return { run: { ...run, frozen: true }, reachedZero: false, secondTick: null, overtimeExpired: false };
    const overtimeS = run.overtimeS + dtS;
    const cap = TUNING.RUN_OVERTIME_MAX_S;
    // The epsilon absorbs the float sum of dt (120 x 1/120 is a hair under 1).
    const expired = run.overtimeS < cap - 1e-9 && overtimeS >= cap - 1e-9;
    return { run: { ...run, frozen: true, overtimeS }, reachedZero: false, secondTick: null, overtimeExpired: expired };
  }
  const step = inferenceHeld ? dtS / TUNING.INFERENCE_TIME_SCALE : dtS;
  // Round away float noise so 120 ticks of 1/120 s land exactly on whole seconds.
  const raw = run.clockS - step;
  const clockS = Math.max(0, Math.abs(raw - Math.round(raw)) < 1e-9 ? Math.round(raw) : raw);
  const before = Math.ceil(run.clockS - 1e-9);
  const after = Math.ceil(clockS - 1e-9);
  // `+ 0` turns the -0 of ceil(-1e-9) into 0 (JSON and deep-equal safe).
  const secondTick = after < before ? after + 0 : null;
  const reachedZero = clockS <= 0;
  return { run: { ...run, clockS, frozen: reachedZero }, reachedZero, secondTick, overtimeExpired: false };
}

/**
 * Triggers the collect point (feet + COLLECT_POINT_UP_M) or the feet (NPC talk) is inside this tick.
 * A TriggerSphere with radius 0 uses the live tuning radius, read at call time: COLLECT_RADIUS_M for
 * letters and MacGuffins, TALK_TRIGGER_M for NPC talk (so the dev panel slider works without a
 * rebuild); a non-zero radius is an authored override (NpcDef.talkRadius).
 */
export function triggersHit(triggers: readonly TriggerSphere[], feet: Vec3): readonly TriggerSphere[] {
  const collect = { x: feet.x, y: feet.y + TUNING.COLLECT_POINT_UP_M, z: feet.z };
  const out: TriggerSphere[] = [];
  for (const t of triggers) {
    const talk = t.kind === 'npcTalk';
    const r = t.radius > 0 ? t.radius : talk ? TUNING.TALK_TRIGGER_M : TUNING.COLLECT_RADIUS_M;
    const p = talk ? feet : collect;
    if (Math.hypot(p.x - t.center.x, p.y - t.center.y, p.z - t.center.z) <= r) out.push(t);
  }
  return out;
}

/** A numeric goal parameter, read live from TUNING (goal data never holds numbers, data/goals.ts). */
function tuned(key: NumericTuningKey): number {
  return TUNING[key];
}

/** Goal ids newly completed by a bank (element goals and High Combo). */
export function goalsOnBank(goals: readonly GoalDef[], run: RunState, facts: BankedComboFacts): readonly string[] {
  const out: string[] = [];
  for (const g of goals) {
    if (run.goalsCompleted.includes(g.id)) continue;
    const c = g.condition;
    let done = false;
    switch (c.kind) {
      case 'comboScore':
        done = facts.bank.final >= tuned(c.threshold);
        break;
      case 'gapInBankedCombo':
        done = facts.gapIds.includes(c.gapId);
        break;
      case 'comboWithSurface':
        done = facts.bank.final >= tuned(c.threshold) && (facts.surfacesTouched.includes(c.surfaceId) || (c.orGapId !== undefined && facts.gapIds.includes(c.orGapId)));
        break;
      case 'specialHeld': {
        const need = tuned(c.seconds);
        done = c.specialIds.some((id) => (facts.specialHeldS[id] ?? 0) >= need - 1e-9);
        break;
      }
      case 'sequenceInCombo': {
        const need = tuned(c.count);
        let n = 0;
        for (let i = 0; i + 1 < facts.elements.length; i++) {
          if ((facts.elements[i] as ComboElement).category === c.first && (facts.elements[i + 1] as ComboElement).category === c.then) n++;
        }
        done = n >= need;
        break;
      }
      default:
        break;
    }
    if (done) out.push(g.id);
  }
  return out;
}

/** Goal ids newly completed at run end or by a pickup (score goals, C-O-D-E, MacGuffin). */
export function goalsOnState(goals: readonly GoalDef[], run: RunState, runEnded: boolean): readonly string[] {
  const out: string[] = [];
  for (const g of goals) {
    if (run.goalsCompleted.includes(g.id)) continue;
    const c = g.condition;
    switch (c.kind) {
      case 'runScore':
        if (runEnded && run.score >= tuned(c.threshold)) out.push(g.id);
        break;
      case 'letters':
        if (LETTERS.every((l) => run.letters[l])) out.push(g.id);
        break;
      case 'macguffin':
        // Only a pickup THIS run completes it: a MacGuffin held from the save re-completed its goal at
        // tick 0 of every later career run, so the results card listed it under GOALS THIS RUN.
        if (run.macguffin === c.id && run.macguffinCollected && !run.macguffinFromSave) out.push(g.id);
        break;
      default:
        break;
    }
  }
  return out;
}

export function runView(run: RunState): RunView {
  return {
    levelId: run.levelId,
    mode: run.mode,
    clockS: Math.max(0, run.clockS),
    overtime: run.clockS <= 0 && !run.ended && run.overtimeS > 0,
    ended: run.ended,
    score: run.score,
    bestCombo: run.bestCombo,
    letters: { ...run.letters },
    macguffinCollected: run.macguffinCollected,
    goalsCompleted: [...run.goalsCompleted],
  };
}
