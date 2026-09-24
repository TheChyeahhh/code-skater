// tests/simRun.test.ts (sim track): DESIGN "goals.test" on the sim side (ARCHITECTURE.md section 10):
// the 2:00 run clock, triggers, every goal condition kind the two parks use, and the real parks'
// letters, MacGuffins, NPC talk and goal completion events (REQ-GOL-01..06, REQ-CTL-15, REQ-NPC-02,
// REQ-SCR-06, REQ-SPC-05, CR-23). The save layer persists what these events report (ui track).
import { afterEach, describe, expect, it } from 'vitest';
import { hitstopTicks, resetTuning, TUNING } from '../src/core/tuning';
import type { LetterId, Vec3 } from '../src/core/types';
import { BRANDS } from '../src/data/brands';
import type { GoalDef } from '../src/data/goals';
import { MARKET_STREET } from '../src/levels/marketStreet';
import type { TriggerSphere } from '../src/levels/types';
import { WOODSHED } from '../src/levels/woodshed';
import { createRun, goalsOnBank, goalsOnState, runView, stepClock, triggersHit, type BankedComboFacts, type RunState } from '../src/sim/run';
import type { BankResult, ComboElement } from '../src/sim/types';
import { built, describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

afterEach(() => resetTuning());

const P = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const street = built(MARKET_STREET);
const woodshed = built(WOODSHED);

describe('the run clock (REQ-GOL-01, REQ-SM-09, REQ-SPC-05)', () => {
  it('2:00 counts down in sim time, one runTick per whole second, freezes at 0', () => {
    let run = createRun(street, 'career', TUNING.RUN_LENGTH_S, []);
    expect(run.clockS).toBe(120);
    const seconds: number[] = [];
    let zeroAt = -1;
    for (let t = 0; t < 120 * 120 + 30; t++) {
      const c = stepClock(run, 1 / 120, false, false);
      run = c.run;
      if (c.secondTick !== null) seconds.push(c.secondTick);
      if (c.reachedZero && zeroAt < 0) zeroAt = t;
    }
    expect(seconds).toEqual(Array.from({ length: 120 }, (_, i) => 119 - i));
    expect(Object.is(seconds[119], 0)).toBe(true);
    expect(zeroAt).toBe(120 * 120 - 1);
    expect(run.clockS).toBe(0);
    expect(run.frozen).toBe(true);
    expect(run.overtimeS).toBe(0);
  });

  it('900ms Inference held: the clock loses dt / 0.6 per tick so it keeps presentation time', () => {
    const run = createRun(street, 'free', 10, []);
    expect(stepClock(run, 1 / 120, true, true).run.clockS).toBeCloseTo(10 - 1 / 120 / TUNING.INFERENCE_TIME_SCALE, 12);
  });

  it('overtime only runs with a combo alive, and fires once at RUN_OVERTIME_MAX_S', () => {
    let run: RunState = { ...createRun(street, 'free', 1, []), clockS: 0 };
    expect(stepClock(run, 1 / 120, false, false).run.overtimeS).toBe(0);
    let fired = 0;
    for (let t = 0; t < 30 * 120 + 60; t++) {
      const c = stepClock(run, 1 / 120, false, true);
      run = c.run;
      if (c.overtimeExpired) fired++;
    }
    expect(fired).toBe(1);
    expect(runView(run).overtime).toBe(true);
  });

  it('createRun: letters reset, the MacGuffin stays collected for the career (REQ-SCR-06)', () => {
    const fresh = createRun(street, 'career', 120, []);
    expect(fresh.letters).toEqual({ C: false, O: false, D: false, E: false });
    expect(fresh.macguffin).toBe('secret_laptop');
    expect(fresh.macguffinCollected).toBe(false);
    expect(createRun(street, 'career', 120, ['secret_laptop']).macguffinCollected).toBe(true);
    expect(createRun(woodshed, 'career', 120, ['secret_laptop']).macguffinCollected).toBe(false);
  });
});

describe('triggers (REQ-CTL-15, REQ-NPC-02, ARCHITECTURE decision 24)', () => {
  const letter: TriggerSphere = { id: 'L', kind: 'letter', center: P(10, 2, 10), radius: 0, ref: 'C' };
  const npc: TriggerSphere = { id: 'N', kind: 'npcTalk', center: P(0, 0, 0), radius: 0, ref: 'sam' };

  it('letters use the collect point (feet + 0.9 m) and the LIVE COLLECT_RADIUS_M', () => {
    expect(triggersHit([letter], P(10, 2 - 0.9, 10.85))).toEqual([letter]);
    expect(triggersHit([letter], P(10, 2 - 0.9, 10.95))).toEqual([]);
    TUNING.COLLECT_RADIUS_M = 1.0;
    expect(triggersHit([letter], P(10, 2 - 0.9, 10.95))).toEqual([letter]);
  });

  it('NPC talk uses the feet and TALK_TRIGGER_M; an authored radius overrides', () => {
    expect(triggersHit([npc], P(1.9, 0, 0))).toEqual([npc]);
    expect(triggersHit([npc], P(2.1, 0, 0))).toEqual([]);
    expect(triggersHit([{ ...npc, radius: 3 }], P(2.5, 0, 0)).length).toBe(1);
  });
});

describe('goal conditions (REQ-GOL-02, REQ-STR-06, REQ-WSH-06)', () => {
  const el = (category: ComboElement['category'], id: string = category): ComboElement => ({
    id: id as ComboElement['id'], baseId: null, category, name: id, base: 100, stanceMult: 1, variantMult: 1, degradation: 1, value: 100,
    holdRate: 0, heldS: 0, accrual: 0, open: false, railId: null, addedTick: 0,
  });
  const facts = (final: number, over: Partial<BankedComboFacts> = {}): BankedComboFacts => {
    const bank: BankResult = { final, base: final, multiplier: 1, elementCount: 1, spin180s: 0, quality: 'clean', elements: [] };
    return { bank, elements: [], gapIds: [], surfacesTouched: [], specialHeldS: {}, ...over };
  };
  const g = (id: string, condition: GoalDef['condition']): GoalDef => ({ id, levelId: 'marketStreet', index: 1, name: id, condition, reqId: 'REQ-GOL-02' });
  const run = createRun(street, 'career', 120, []);

  it('comboScore (High Combo) fires on a bank at or over the threshold', () => {
    const goals = [g('HC', { kind: 'comboScore', threshold: 'STREET_HIGH_COMBO' })];
    expect(goalsOnBank(goals, run, facts(9999))).toEqual([]);
    expect(goalsOnBank(goals, run, facts(10000))).toEqual(['HC']);
    // Already completed this run: never twice.
    expect(goalsOnBank(goals, { ...run, goalsCompleted: ['HC'] }, facts(20000))).toEqual([]);
  });

  it('gapInBankedCombo and comboWithSurface (surface touched OR the gap)', () => {
    const gap = [g('G7', { kind: 'gapInBankedCombo', gapId: 'MS-G07' })];
    expect(goalsOnBank(gap, run, facts(10, { gapIds: ['MS-G07'] }))).toEqual(['G7']);
    expect(goalsOnBank(gap, run, facts(10, { gapIds: ['MS-G06'] }))).toEqual([]);
    const fountain = [g('F', { kind: 'comboWithSurface', threshold: 'STREET_FOUNTAIN_COMBO', surfaceId: 'MS-F1', orGapId: 'MS-G04' })];
    expect(goalsOnBank(fountain, run, facts(5000, { surfacesTouched: ['MS-F1'] }))).toEqual(['F']);
    expect(goalsOnBank(fountain, run, facts(5000, { gapIds: ['MS-G04'] }))).toEqual(['F']);
    expect(goalsOnBank(fountain, run, facts(4999, { surfacesTouched: ['MS-F1'] }))).toEqual([]);
    expect(goalsOnBank(fountain, run, facts(6000, { surfacesTouched: ['MS-T1'] }))).toEqual([]);
  });

  it('specialHeld: a holdable special held 3.0 presentation seconds in a banked combo', () => {
    const goal = [g('S', { kind: 'specialHeld', specialIds: ['gpu_slide', 'context_window', 'inference_900ms'], seconds: 'SPECIAL_HOLD_GOAL_S' })];
    expect(goalsOnBank(goal, run, facts(10, { specialHeldS: { inference_900ms: 3.0 } }))).toEqual(['S']);
    expect(goalsOnBank(goal, run, facts(10, { specialHeldS: { gpu_slide: 2.9 } }))).toEqual([]);
  });

  it('sequenceInCombo: two revert -> manual pairs by category (switch ids included)', () => {
    const goal = [g('RM', { kind: 'sequenceInCombo', first: 'revert', then: 'manual', count: 'WOODSHED_REVERT_MANUALS' })];
    const one = [el('revert'), el('manual', 'switch_manual'), el('flip')];
    const two = [...one, el('revert', 'switch_revert'), el('manual', 'nose_manual')];
    expect(goalsOnBank(goal, run, facts(10, { elements: one }))).toEqual([]);
    expect(goalsOnBank(goal, run, facts(10, { elements: two }))).toEqual(['RM']);
  });

  it('state goals: run score only at run end, all four letters, the MacGuffin', () => {
    const goals = [
      g('HS', { kind: 'runScore', threshold: 'STREET_HIGH_SCORE' }),
      g('L', { kind: 'letters' }),
      g('M', { kind: 'macguffin', id: 'secret_laptop' }),
    ];
    const rich: RunState = { ...run, score: 15000 };
    expect(goalsOnState(goals, rich, false)).toEqual([]);
    expect(goalsOnState(goals, rich, true)).toEqual(['HS']);
    const three = { ...run, letters: { C: true, O: true, D: true, E: false } };
    expect(goalsOnState(goals, three, false)).toEqual([]);
    expect(goalsOnState(goals, { ...three, letters: { ...three.letters, E: true } }, false)).toEqual(['L']);
    expect(goalsOnState(goals, { ...run, macguffinCollected: true }, false)).toEqual(['M']);
    // Held from the save (an earlier career run): never re-completed (polish round 2).
    expect(goalsOnState(goals, { ...run, macguffinCollected: true, macguffinFromSave: true }, false)).toEqual([]);
    expect(createRun(street, 'career', 120, ['secret_laptop']).macguffinFromSave).toBe(true);
  });

  it('every goal the two parks define has a kind the sim evaluates', () => {
    const known = new Set(['runScore', 'comboScore', 'letters', 'macguffin', 'gapInBankedCombo', 'comboWithSurface', 'specialHeld', 'sequenceInCombo']);
    for (const lvl of [street, woodshed]) {
      expect(lvl.def.goals.length).toBe(10);
      for (const goal of lvl.def.goals) expect(known.has(goal.condition.kind)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The real parks
// ---------------------------------------------------------------------------------------------

/** Feet position that puts the collect point (feet + COLLECT_POINT_UP_M) exactly on `p`. */
const feetFor = (p: Vec3): Vec3 => P(p.x, p.y - TUNING.COLLECT_POINT_UP_M, p.z);

describe.skipIf(!worldAvailable())('Market Street letters, laptop and SAM on the real world', () => {
  it('C-O-D-E: each letter collects once per run; all four in one run complete the goal in career mode only', () => {
    for (const mode of ['career', 'free'] as const) {
      const r = new Rig({ level: street, mode });
      for (const l of street.def.letters) {
        r.teleport(feetFor(l.pos), P(0, 0, -1), 0);
        r.hold(1);
      }
      expect(r.of('letter').map((e) => e.letter)).toEqual(['C', 'O', 'D', 'E'] satisfies LetterId[]);
      expect(r.last('letter')?.collected).toEqual(['C', 'O', 'D', 'E']);
      expect(r.snap.run.letters).toEqual({ C: true, O: true, D: true, E: true });
      // Standing on a letter again collects nothing.
      r.teleport(feetFor(street.def.letters[0]?.pos ?? P(0, 0, 0)), P(0, 0, -1), 0);
      r.hold(1);
      expect(r.of('letter').length).toBe(4);
      const goals = r.of('goalCompleted').map((e) => e.goalId);
      expect(goals).toEqual(mode === 'career' ? ['MS-GOAL-05'] : []);
    }
  });

  it('the laptop: +1 element worth 2500 (never degraded), splash, toast, 7-tick hitstop, goal 6; no respawn once held', () => {
    const lap = street.def.macguffin;
    expect(lap?.id).toBe('secret_laptop');
    if (!lap) return;
    const r = new Rig({ level: street, mode: 'career' });
    r.teleport(feetFor(lap.pos), P(0, 0, 1), 0);
    r.hold(1);
    const e = r.last('macguffin');
    expect(e).toMatchObject({
      id: 'secret_laptop', name: BRANDS.macguffins.secret_laptop.name, splash: BRANDS.macguffins.secret_laptop.splash,
      toast: BRANDS.npcs.sam.toast, hitstopTicks: hitstopTicks(),
    });
    expect(e?.hitstopTicks).toBe(7);
    expect(r.of('pickup').map((p) => p.kind)).toEqual(['macguffin']);
    expect(r.snap.run.macguffinCollected).toBe(true);
    expect(r.of('goalCompleted').map((g) => g.goalId)).toEqual(['MS-GOAL-06']);
    const added = r.last('elementAdded')?.element;
    expect(added).toMatchObject({ id: 'secret_laptop', category: 'macguffin', value: 2500 });
    r.run(400, () => ({}), (s) => s.skater.state === 'Grounded' || s.skater.state === 'Bail');
    expect(r.last('comboBanked')?.final).toBe(2500);
    // A career that already holds it: the pickup never respawns.
    const held = new Rig({ level: street, mode: 'career', collectedMacGuffins: ['secret_laptop'] });
    held.teleport(feetFor(lap.pos), P(0, 0, 1), 0);
    held.hold(1);
    expect(held.of('macguffin')).toEqual([]);
    expect(held.snap.run.macguffinCollected).toBe(true);
  });

  it('SAM: rolling into the 2 m trigger fires npcTalk with the brand line on every entry (CR-23)', () => {
    const sam = street.def.npcs[0];
    expect(sam?.id).toBe('sam');
    if (!sam) return;
    const r = new Rig({ level: street });
    r.teleport(P(sam.pos.x + 1.5, sam.pos.y, sam.pos.z), P(1, 0, 0), 0);
    r.hold(2);
    expect(r.of('npcTalk')).toHaveLength(1);
    expect(r.last('npcTalk')).toMatchObject({ npcId: 'sam', name: BRANDS.npcs.sam.name, line: BRANDS.npcs.sam.line });
    expect(r.snap.npc?.npcId).toBe('sam');
    r.teleport(P(sam.pos.x + 6, sam.pos.y, sam.pos.z), P(1, 0, 0), 0);
    r.hold(2);
    expect(r.snap.npc).toBeNull();
    r.teleport(P(sam.pos.x + 1.5, sam.pos.y, sam.pos.z), P(1, 0, 0), 0);
    r.hold(2);
    expect(r.of('npcTalk')).toHaveLength(2);
  });
});

describe.skipIf(!worldAvailable())('Woodshed goals on the real world', () => {
  it('Spine Transfer the Center: WS-G01 in a banked combo completes WS-GOAL-07 (career), not in free skate', () => {
    for (const mode of ['career', 'free'] as const) {
      const r = new Rig({ level: woodshed, mode });
      // WS-SP1: ridge x 43, copings 2.4 (x 42.7 / 43.3), west foot at x 40; approach east at 11 m/s
      // at z 20 (the drive hangs over the peak at z 28, where a spine air at this speed collects it).
      r.teleport(P(34, 0, 20), P(1, 0, 0), 11);
      r.run(600, (s) => (s.skater.state === 'Air' && s.skater.stateTicks > 10 && s.skater.stateTicks < 13 ? { buttons: ['revert'] } : {}),
        (s) => s.skater.state === 'Grounded' && r.of('transfer').length > 0);
      const log = describeEvents(r.events);
      expect(r.last('transfer')?.railId, log).toMatch(/^WS-SP1-[WE]$/);
      expect(r.last('gap')?.gapId).toBe('WS-G01');
      expect(r.last('land')?.pos.x).toBeGreaterThan(43);
      expect(r.last('comboBanked')?.final, log).toBe(500);
      expect(r.of('goalCompleted').map((g) => g.goalId)).toEqual(mode === 'career' ? ['WS-GOAL-07'] : []);
      expect(r.snap.run.goalsCompleted).toEqual(mode === 'career' ? ['WS-GOAL-07'] : []);
    }
  });

  it('the run end reports score, best combo, goals, letters and the MacGuffin for the save layer', () => {
    const r = new Rig({ level: woodshed, mode: 'career', runLengthS: 3 });
    const drive = woodshed.def.macguffin;
    if (!drive) return;
    // The drive needs a transfer in the same air (MacGuffinDef.needs, polish round 2): a spine air at
    // 11 m/s with R2 on its first air tick.
    r.teleport(P(36, 0, 28), P(1, 0, 0), 11);
    let pressed = false;
    r.run(3 * 120 + 400, (s) => {
      if (pressed || s.skater.state !== 'Air') return {};
      pressed = true;
      return { buttons: ['revert'] };
    }, (s) => s.run.ended);
    const end = r.last('runEnd');
    expect(end).toMatchObject({ levelId: 'woodshed', mode: 'career', macguffin: true, letters: [] });
    expect(end?.goalsCompleted).toContain('WS-GOAL-06');
    expect(end?.score).toBe(r.snap.run.score);
    // The drive (2500) and the WS-G01 Spine Transfer gap (500) bank together: (2500 + 500) x 2 elements.
    expect(end?.bestCombo).toBe(6000);
  });
});
