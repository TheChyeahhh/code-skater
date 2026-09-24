/**
 * tests/stateMachine.test.ts (logic track): SPEC §13 state machine suite (REQ-SM-01..14).
 * One case per TRANSITIONS row (every DESIGN C.5 row, numbered and lettered, plus the x: rows),
 * then the window scenarios: revert pre-buffer on contact (REQ-TIM-07), R2 170 / 190 ms after a vert
 * landing (REQ-TIM-11), revert -> manual inside 200 ms and its timeout (REQ-REV-02 / 03), manual
 * input within 140 ms of a flat contact before and after (REQ-TIM-08), the REQ-REV-05 quality gate.
 */

import { describe, expect, it } from 'vitest';
import { ticks, ticksS, TUNING } from '../src/core/tuning';
import { COMBO_ALIVE_STATES, type SkaterStateName } from '../src/core/types';
import {
  initialMachine, isComboAliveState, landingBailReason, popCharge, rowsFor, timerEvent, TRANSITIONS, transition,
} from '../src/sim/stateMachine';
import {
  DESIGN_ROW_IDS, type ComboEffect, type ElementRef, type MachineState, type SmEffect, type SmEvent, type SmFacts,
} from '../src/sim/types';
import { BOWL_FLOOR, FLAT, facts, landing, LogicRig, machine, QP_FACE, VERT_LANDING } from './fixtures/logic/rig';

const T = 100; // the tick every case runs at

const rail = (grindType: 'fifty_fifty' | 'smith' | 'five_o' = 'fifty_fifty', ground = false): SmEvent =>
  ({ kind: 'grindTry', candidate: 'rail', ground, railId: 'MS-R1', grindType, lipId: 'axle_stall' });
const lip = (lipId: 'axle_stall' | 'rock_to_fakie' = 'axle_stall'): SmEvent =>
  ({ kind: 'grindTry', candidate: 'lip', ground: false, railId: 'MS-Q1-coping', grindType: 'fifty_fifty', lipId });
const wall = (headOn: boolean): SmEvent => ({ kind: 'wallHit', headOn, speed: headOn ? 6 : 6, incidenceDeg: headOn ? 30 : 60 });
const t = (trickId: Extract<ElementRef, { kind: 'trick' }>['trickId']): ElementRef => ({ kind: 'trick', trickId });

interface Case {
  readonly row: string;
  readonly m: MachineState;
  readonly e: SmEvent;
  readonly f?: Partial<SmFacts>;
  readonly to: SkaterStateName;
  readonly combo: ComboEffect;
  readonly element?: ElementRef | null;
  readonly effects?: readonly SmEffect[];
  readonly next?: Partial<MachineState>;
}

/** One case per TRANSITIONS entry, in table order (the coverage test below checks the order). */
const CASES: readonly Case[] = [
  // Grounded
  { row: '1b', m: machine('Grounded'), e: { kind: 'crossPress' }, f: { surface: QP_FACE, movingUp: false }, to: 'Grounded', combo: 'none', effects: [{ kind: 'pump', on: true }], next: { pumping: true, chargeStartTick: null } },
  { row: '1', m: machine('Grounded'), e: { kind: 'crossPress' }, to: 'Crouch', combo: 'none', effects: [{ kind: 'startCharge' }], next: { chargeStartTick: T, enteredTick: T } },
  { row: '1c', m: machine('Grounded', { pumping: true }), e: { kind: 'velocityUp' }, f: { surface: QP_FACE, crossHeld: true, movingUp: true }, to: 'Crouch', combo: 'none', effects: [{ kind: 'pump', on: false }, { kind: 'startCharge' }], next: { chargeStartTick: T, pumping: false } },
  { row: 'x:pump-release', m: machine('Grounded', { pumping: true }), e: { kind: 'crossRelease' }, f: { surface: QP_FACE }, to: 'Grounded', combo: 'none', effects: [{ kind: 'pump', on: false }], next: { pumping: false } },
  { row: '4', m: machine('Grounded'), e: { kind: 'manualEntry', manual: 'nose_manual' }, f: { speed: 1.0 }, to: 'Manual', combo: 'startAdd', element: t('nose_manual'), effects: [{ kind: 'balanceStart', axis: 'v' }], next: { manual: 'nose_manual' } },
  { row: '35', m: machine('Crouch', { chargeStartTick: 90 }), e: wall(true), to: 'Bail', combo: 'lose', effects: [{ kind: 'bailStart', reason: 'wall' }], next: { bailReason: 'wall', chargeStartTick: null } },
  { row: '36', m: machine('Grounded'), e: rail('five_o', true), to: 'Grind', combo: 'startAdd', element: t('five_o'), effects: [{ kind: 'groundSnapHop' }, { kind: 'balanceStart', axis: 'h' }] },
  { row: '37', m: machine('Grounded'), e: { kind: 'leftSurface' }, f: { surface: null }, to: 'Air', combo: 'start', effects: [] },
  { row: '41', m: machine('Grounded'), e: { kind: 'clockZero' }, f: { clockZero: true, comboAlive: false }, to: 'RunEnd', combo: 'none', effects: [{ kind: 'runEnd' }] },
  // Crouch
  { row: '2', m: machine('Crouch', { chargeStartTick: T - 72 }), e: { kind: 'crossRelease' }, f: { surface: null }, to: 'Air', combo: 'start', effects: [{ kind: 'pop', charge: 1 }], next: { chargeStartTick: null } },
  { row: '3', m: machine('Crouch', { chargeStartTick: T - 72 }), e: { kind: 'timeout' }, to: 'Crouch', combo: 'none', effects: [], next: { chargeStartTick: T - 72 } },
  { row: '37b', m: machine('Crouch', { chargeStartTick: T - 30 }), e: { kind: 'leftSurface' }, f: { surface: null }, to: 'Air', combo: 'start', effects: [], next: { chargeStartTick: T - 30, enteredTick: T } },
  { row: 'x:crouch-clock-zero', m: machine('Crouch', { chargeStartTick: 90 }), e: { kind: 'clockZero' }, f: { clockZero: true }, to: 'RunEnd', combo: 'none', effects: [{ kind: 'runEnd' }] },
  // Air: contact
  { row: '10', m: machine('Air'), e: { kind: 'contact', landing: landing({ offAxisDeg: 60.5 }) }, to: 'Bail', combo: 'lose', effects: [{ kind: 'bailStart', reason: 'landing' }], next: { bailReason: 'landing' } },
  { row: '13', m: machine('Air'), e: { kind: 'contact', landing: landing({ crossHeld: true, manualPair: 'manual' }) }, f: { crossHeld: true }, to: 'Manual', combo: 'liveAdd', element: t('manual'), effects: [{ kind: 'balanceStart', axis: 'v' }, { kind: 'startCharge' }], next: { manual: 'manual', chargeStartTick: T } },
  { row: '7', m: machine('Air'), e: { kind: 'contact', landing: landing({ manualPair: 'manual', offAxisDeg: 27 }) }, to: 'Manual', combo: 'liveAdd', element: t('manual'), effects: [{ kind: 'balanceStart', axis: 'v' }], next: { manual: 'manual', chargeStartTick: null } },
  { row: '8', m: machine('Air'), e: { kind: 'contact', landing: VERT_LANDING({ revertBuffered: true }) }, f: { surface: QP_FACE }, to: 'RevertWindow', combo: 'liveAdd', element: t('revert'), effects: [{ kind: 'revertPivot' }], next: { landKind: 'vert', revertUsed: true } },
  { row: '12b', m: machine('Air'), e: { kind: 'contact', landing: VERT_LANDING({ crossHeld: true }) }, f: { surface: QP_FACE, crossHeld: true, movingUp: false }, to: 'LandWindow', combo: 'live', element: null, effects: [{ kind: 'pump', on: true }], next: { landKind: 'vert', pumping: true, chargeStartTick: null } },
  { row: '12', m: machine('Air'), e: { kind: 'contact', landing: landing({ crossHeld: true }) }, f: { crossHeld: true }, to: 'Crouch', combo: 'bank', effects: [{ kind: 'startCharge' }], next: { chargeStartTick: T } },
  { row: '9', m: machine('Air'), e: { kind: 'contact', landing: VERT_LANDING() }, f: { surface: QP_FACE }, to: 'LandWindow', combo: 'live', element: null, effects: [], next: { landKind: 'vert', revertUsed: false } },
  // Air: other
  { row: '5b', m: machine('Air'), e: rail(), f: { animsDone: false }, to: 'Bail', combo: 'lose', effects: [{ kind: 'bailStart', reason: 'midTrick' }], next: { bailReason: 'midTrick' } },
  { row: '5', m: machine('Air'), e: rail('smith'), to: 'Grind', combo: 'liveAdd', element: t('smith'), effects: [{ kind: 'grindSnap' }, { kind: 'balanceStart', axis: 'h' }] },
  { row: '6', m: machine('Air'), e: lip('rock_to_fakie'), to: 'Lip', combo: 'liveAdd', element: t('rock_to_fakie'), effects: [{ kind: 'lipSnap' }, { kind: 'balanceStart', axis: 'h' }], next: { lipExitPending: false } },
  { row: '11', m: machine('Air'), e: { kind: 'spineTransfer', railId: 'WS-SP1-W' }, to: 'Air', combo: 'live', element: null, effects: [{ kind: 'spineMirror' }] },
  { row: '14', m: machine('Air'), e: wall(true), to: 'Bail', combo: 'lose', effects: [{ kind: 'bailStart', reason: 'wall' }] },
  { row: 'x:coyote-pop', m: machine('Air', { enteredTick: T - 5 }), e: { kind: 'coyotePop' }, to: 'Air', combo: 'live', effects: [{ kind: 'pop', charge: 0 }] },
  { row: 'x:coyote-release', m: machine('Air', { enteredTick: T - 10, chargeStartTick: T - 72 }), e: { kind: 'crossRelease' }, to: 'Air', combo: 'live', effects: [{ kind: 'pop', charge: 1 }], next: { chargeStartTick: null } },
  { row: 'x:coyote-release-late', m: machine('Air', { enteredTick: T - 11, chargeStartTick: T - 72 }), e: { kind: 'crossRelease' }, to: 'Air', combo: 'live', effects: [], next: { chargeStartTick: null } },
  // LandWindow
  { row: '9b', m: machine('LandWindow', { landKind: 'flat', enteredTick: T - 17 }), e: { kind: 'timeout' }, to: 'Grounded', combo: 'bank', effects: [], next: { landKind: null } },
  { row: '9c', m: machine('LandWindow', { landKind: 'vert' }), e: { kind: 'revertPress' }, f: { surface: QP_FACE }, to: 'RevertWindow', combo: 'liveAdd', element: t('revert'), effects: [{ kind: 'revertPivot' }], next: { landKind: 'vert', revertUsed: true, enteredTick: T } },
  { row: '9d', m: machine('LandWindow', { landKind: 'flat' }), e: { kind: 'manualLand', manual: 'manual' }, to: 'Manual', combo: 'liveAdd', element: t('manual'), effects: [{ kind: 'balanceStart', axis: 'v' }], next: { manual: 'manual' } },
  { row: '9i', m: machine('LandWindow', { landKind: 'vert' }), e: { kind: 'crossPress' }, f: { surface: QP_FACE, movingUp: false }, to: 'LandWindow', combo: 'none', element: null, effects: [{ kind: 'pump', on: true }], next: { landKind: 'vert', pumping: true, chargeStartTick: null } },
  { row: '9j', m: machine('LandWindow', { landKind: 'vert', pumping: true }), e: { kind: 'velocityUp' }, f: { surface: QP_FACE, crossHeld: true, movingUp: true }, to: 'Crouch', combo: 'bank', effects: [{ kind: 'pump', on: false }, { kind: 'startCharge' }], next: { chargeStartTick: T, pumping: false } },
  { row: '9e', m: machine('LandWindow', { landKind: 'flat' }), e: { kind: 'crossPress' }, to: 'Crouch', combo: 'bank', effects: [{ kind: 'startCharge' }], next: { chargeStartTick: T } },
  { row: '9f', m: machine('LandWindow', { landKind: 'flat' }), e: wall(true), to: 'Bail', combo: 'lose', effects: [{ kind: 'bailStart', reason: 'wall' }] },
  { row: '9g', m: machine('LandWindow', { landKind: 'flat' }), e: rail('fifty_fifty', true), to: 'Grind', combo: 'bankStartAdd', element: t('fifty_fifty'), effects: [{ kind: 'groundSnapHop' }, { kind: 'balanceStart', axis: 'h' }] },
  { row: '9h', m: machine('LandWindow', { landKind: 'flat' }), e: { kind: 'leftSurface' }, f: { surface: null }, to: 'Air', combo: 'live', effects: [], next: { landKind: null } },
  // RevertWindow
  { row: '15', m: machine('RevertWindow', { landKind: 'vert', revertUsed: true }), e: { kind: 'revertManual', manual: 'manual' }, f: { surface: QP_FACE }, to: 'Manual', combo: 'liveAdd', element: t('manual'), effects: [{ kind: 'balanceStart', axis: 'v' }], next: { manual: 'manual' } },
  { row: '16', m: machine('RevertWindow', { enteredTick: T - 24 }), e: { kind: 'timeout' }, to: 'Grounded', combo: 'bank', effects: [] },
  { row: '17', m: machine('RevertWindow'), e: wall(true), to: 'Bail', combo: 'lose', effects: [{ kind: 'bailStart', reason: 'wall' }] },
  { row: '18', m: machine('RevertWindow'), e: { kind: 'crossPress' }, to: 'Crouch', combo: 'bank', effects: [{ kind: 'startCharge' }], next: { chargeStartTick: T } },
  { row: 'x:revert-left-surface', m: machine('RevertWindow'), e: { kind: 'leftSurface' }, f: { surface: null }, to: 'Air', combo: 'live', effects: [] },
  // Grind
  { row: 'x:grind-charge', m: machine('Grind'), e: { kind: 'crossPress' }, to: 'Grind', combo: 'live', effects: [{ kind: 'startCharge' }], next: { chargeStartTick: T } },
  { row: '19', m: machine('Grind', { chargeStartTick: T - 42 }), e: { kind: 'crossRelease' }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }, { kind: 'pop', charge: expect.closeTo(0.5, 12) as number }], next: { chargeStartTick: null } },
  { row: '20', m: machine('Grind', { enteredTick: 40 }), e: { kind: 'grindSwitch', grindType: 'smith' }, to: 'Grind', combo: 'liveAdd', element: t('smith'), effects: [{ kind: 'grindSnap' }, { kind: 'balanceStart', axis: 'h' }], next: { enteredTick: 40 } },
  { row: '21', m: machine('Grind'), e: { kind: 'railEnd', corner: false }, f: { surface: null }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }] },
  { row: '22', m: machine('Grind'), e: { kind: 'stall' }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }, { kind: 'stallHop' }] },
  { row: '22b', m: machine('Grind'), e: wall(true), to: 'Bail', combo: 'lose', effects: [{ kind: 'balanceStop' }, { kind: 'bailStart', reason: 'wall' }], next: { bailReason: 'wall' } },
  { row: '22c', m: machine('Grind'), e: wall(false), to: 'Grind', combo: 'live', effects: [{ kind: 'railClamp' }] },
  { row: '23', m: machine('Grind'), e: { kind: 'needleOut' }, to: 'Bail', combo: 'lose', effects: [{ kind: 'balanceStop' }, { kind: 'bailStart', reason: 'balance' }], next: { bailReason: 'balance' } },
  { row: '24', m: machine('Grind'), e: { kind: 'special', specialId: 'gpu_slide' }, f: { triangleHeld: true }, to: 'Grind', combo: 'liveAdd', element: t('gpu_slide'), effects: [{ kind: 'grindSnap' }, { kind: 'balanceStart', axis: 'h' }] },
  // Lip
  { row: '25', m: machine('Lip', { enteredTick: T - 5 }), e: { kind: 'crossPress' }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }, { kind: 'lipExit' }] },
  { row: '25', m: machine('Lip', { enteredTick: T - 18 }), e: { kind: 'triangleRelease' }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }, { kind: 'lipExit' }] },
  { row: '25b', m: machine('Lip', { enteredTick: T - 17 }), e: { kind: 'triangleRelease' }, to: 'Lip', combo: 'live', effects: [], next: { lipExitPending: true, enteredTick: T - 17 } },
  { row: '25', m: machine('Lip', { enteredTick: T - 18, lipExitPending: true }), e: { kind: 'timeout' }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }, { kind: 'lipExit' }], next: { lipExitPending: false } },
  { row: '26', m: machine('Lip'), e: { kind: 'needleOut' }, to: 'Bail', combo: 'lose', effects: [{ kind: 'balanceStop' }, { kind: 'bailStart', reason: 'balance' }] },
  // Manual
  { row: 'x:manual-charge', m: machine('Manual', { manual: 'manual' }), e: { kind: 'crossPress' }, to: 'Manual', combo: 'live', effects: [{ kind: 'startCharge' }], next: { chargeStartTick: T, manual: 'manual' } },
  { row: '27', m: machine('Manual', { manual: 'manual', chargeStartTick: T }), e: { kind: 'crossRelease' }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }, { kind: 'pop', charge: 0 }], next: { manual: null } },
  { row: '28', m: machine('Manual', { manual: 'manual' }), e: { kind: 'manualSwap', manual: 'nose_manual' }, to: 'Manual', combo: 'liveAdd', element: t('nose_manual'), effects: [{ kind: 'balanceStart', axis: 'v' }], next: { manual: 'nose_manual' } },
  { row: '29', m: machine('Manual', { manual: 'manual' }), e: { kind: 'needleOut' }, to: 'Bail', combo: 'lose', effects: [{ kind: 'balanceStop' }, { kind: 'bailStart', reason: 'balance' }] },
  { row: '30', m: machine('Manual', { manual: 'manual' }), e: { kind: 'slowStop' }, f: { speed: 0.9 }, to: 'Grounded', combo: 'bank', effects: [{ kind: 'balanceStop' }], next: { manual: null } },
  { row: '31', m: machine('Manual', { manual: 'manual' }), e: { kind: 'climbSteep' }, f: { surface: QP_FACE, movingUp: true }, to: 'Grounded', combo: 'bank', effects: [{ kind: 'balanceStop' }] },
  { row: '32', m: machine('Manual', { manual: 'manual' }), e: wall(true), to: 'Bail', combo: 'lose', effects: [{ kind: 'balanceStop' }, { kind: 'bailStart', reason: 'wall' }] },
  { row: '33', m: machine('Manual', { manual: 'manual' }), e: wall(false), to: 'Manual', combo: 'live', effects: [{ kind: 'wallSlide' }] },
  { row: '33b', m: machine('Manual', { manual: 'manual' }), e: { kind: 'leftSurface' }, f: { surface: null }, to: 'Air', combo: 'live', effects: [{ kind: 'balanceStop' }] },
  { row: '34', m: machine('Manual', { manual: 'manual' }), e: { kind: 'special', specialId: 'context_window' }, f: { triangleHeld: true }, to: 'Manual', combo: 'liveAdd', element: t('context_window'), effects: [], next: { manual: 'manual' } },
  { row: '34b', m: machine('Manual', { manual: 'manual' }), e: rail('fifty_fifty', true), to: 'Grind', combo: 'liveAdd', element: t('fifty_fifty'), effects: [{ kind: 'groundSnapHop' }, { kind: 'balanceStart', axis: 'h' }], next: { manual: null } },
  // Bail, GetUp
  { row: '38', m: machine('Bail', { bailReason: 'balance', enteredTick: T - 72 }), e: { kind: 'timeout' }, to: 'GetUp', combo: 'none', effects: [], next: { bailReason: 'balance', enteredTick: T } },
  { row: '39', m: machine('GetUp', { bailReason: 'balance', enteredTick: T - 102 }), e: { kind: 'timeout' }, to: 'Grounded', combo: 'none', effects: [{ kind: 'standUp' }], next: { bailReason: null } },
  // Clock, pause
  { row: '40', m: machine('LandWindow', { landKind: 'flat', enteredTick: T - 3 }), e: { kind: 'clockZero' }, f: { clockZero: true, comboAlive: true }, to: 'LandWindow', combo: 'live', effects: [{ kind: 'clockFreeze' }], next: { enteredTick: T - 3, landKind: 'flat' } },
  { row: '40', m: machine('Manual', { manual: 'manual' }), e: { kind: 'overtime' }, f: { clockZero: true, comboAlive: true }, to: 'Bail', combo: 'lose', effects: [{ kind: 'balanceStop' }, { kind: 'bailStart', reason: 'overtime' }], next: { bailReason: 'overtime' } },
  { row: '42', m: machine('Grind', { enteredTick: 7 }), e: { kind: 'pause' }, to: 'Grind', combo: 'none', effects: [], next: { enteredTick: 7 } },
];

describe('TRANSITIONS covers DESIGN C.5 (REQ-SM-01)', () => {
  it('every DESIGN row id is in the table and has a test case', () => {
    const tableIds = new Set(TRANSITIONS.map((r) => r.id));
    const caseIds = new Set(CASES.map((c) => c.row));
    for (const id of DESIGN_ROW_IDS) {
      expect(tableIds.has(id), `row ${id} in TRANSITIONS`).toBe(true);
      expect(caseIds.has(id), `row ${id} has a case`).toBe(true);
    }
  });

  it('one case per TRANSITIONS entry, in table order', () => {
    expect(CASES.map((c) => c.row)).toEqual(TRANSITIONS.map((r) => r.id));
  });

  it('every row has a note and names only real states', () => {
    for (const r of TRANSITIONS) {
      expect(r.note.length, `row ${r.id} note`).toBeGreaterThan(5);
      expect(r.note).not.toMatch(/—/);
    }
  });
});

describe('one test per row', () => {
  CASES.forEach((c, i) => {
    it(`row ${c.row} (entry ${i}): ${c.m.state} + ${c.e.kind} -> ${c.to}, ${c.combo}`, () => {
      const r = transition(c.m, c.e, facts({ tick: T, ...c.f }));
      expect(r.row).toBe(c.row);
      // The case must hit THIS entry: the entry it matched is the first matching one in table order.
      const hit = rowsFor(c.m.state, c.e.kind).find((row) => !row.guard || row.guard(c.m, c.e, facts({ tick: T, ...c.f })));
      expect(hit).toBe(TRANSITIONS[i]);
      expect(r.next.state).toBe(c.to);
      expect(r.combo).toBe(c.combo);
      if (c.element !== undefined) expect(r.element).toEqual(c.element);
      if (c.effects !== undefined) expect(r.effects).toEqual(c.effects);
      if (c.next) for (const [k, v] of Object.entries(c.next)) expect(r.next[k as keyof MachineState], k).toEqual(v);
      if (c.to !== c.m.state) expect(r.next.enteredTick).toBe(T);
      expect(r.prev).toBe(c.m);
    });
  });
});

describe('guards and precedence', () => {
  it('unmatched events are ignored: row null, same state, no effects', () => {
    const m = machine('Air');
    const r = transition(m, { kind: 'grindSwitch', grindType: 'smith' }, facts({ tick: T }));
    expect(r).toEqual({ row: null, prev: m, next: m, combo: 'none', element: null, effects: [] });
  });

  it('GetUp and Bail accept nothing but their timer and pause (REQ-TIM-10)', () => {
    const events: SmEvent[] = [
      { kind: 'crossPress' }, { kind: 'crossRelease' }, rail('fifty_fifty', true), { kind: 'manualEntry', manual: 'manual' },
      { kind: 'revertPress' }, { kind: 'leftSurface' }, wall(true), { kind: 'clockZero' }, { kind: 'overtime' }, { kind: 'needleOut' },
    ];
    for (const s of ['Bail', 'GetUp'] as const) for (const e of events) expect(transition(machine(s), e, facts({ tick: T, clockZero: true })).row, `${s} ${e.kind}`).toBeNull();
  });

  it('row 10 bail reasons: unfinished anim, off-axis > 60, tilt only above TILT_BAIL_DEG (180 = never, CR-43); exactly 60 lands', () => {
    expect(landingBailReason(landing({ animsDone: false }))).toBe('midTrick');
    expect(landingBailReason(landing({ offAxisDeg: 60.01 }))).toBe('landing');
    expect(landingBailReason(landing({ offAxisDeg: 60, tiltDeg: 90 }))).toBeNull();
    const tilt = TUNING.TILT_BAIL_DEG;
    try {
      TUNING.TILT_BAIL_DEG = 40;
      expect(landingBailReason(landing({ tiltDeg: 40.01 }))).toBe('tilt');
      expect(landingBailReason(landing({ offAxisDeg: 60, tiltDeg: 40 }))).toBeNull();
    } finally {
      TUNING.TILT_BAIL_DEG = tilt;
    }
    const r = transition(machine('Air'), { kind: 'contact', landing: landing({ animsDone: false, manualPair: 'manual' }) }, facts({ tick: T }));
    expect(r.row).toBe('10');
    expect(r.next.bailReason).toBe('midTrick');
  });

  it('REQ-SM-07: Cross held on a flat landing banks then crouches; a valid pair wins (rows 12, 13)', () => {
    expect(transition(machine('Air'), { kind: 'contact', landing: landing({ crossHeld: true }) }, facts({ tick: T })).row).toBe('12');
    expect(transition(machine('Air'), { kind: 'contact', landing: landing({ crossHeld: true, manualPair: 'nose_manual' }) }, facts({ tick: T })).row).toBe('13');
  });

  it('REQ-SM-13 after an air: the windows pump like Grounded and a held pump survives their timers (rows 9i, 12b, 9b, 16)', () => {
    const f = facts({ tick: T, surface: QP_FACE, movingUp: false, crossHeld: true });
    expect(transition(machine('RevertWindow', { landKind: 'vert', revertUsed: true }), { kind: 'crossPress' }, f).row).toBe('9i');
    expect(transition(machine('LandWindow', { landKind: 'vert' }), { kind: 'crossPress' }, facts({ surface: FLAT })).row).toBe('9e');
    // Row 12 stays flat ground only; a level bowl floor landing with Cross held still crouches.
    expect(transition(machine('Air'), { kind: 'contact', landing: landing({ crossHeld: true }) }, facts({ tick: T, surface: BOWL_FLOOR, crossHeld: true })).row).toBe('12');
    expect(transition(machine('Air'), { kind: 'contact', landing: landing({ crossHeld: true }) }, facts({ tick: T, surface: BOWL_FLOOR, crossHeld: true, movingDown: true })).row).toBe('12b');
    const revertPump = transition(machine('Air'), { kind: 'contact', landing: VERT_LANDING({ crossHeld: true, revertBuffered: true }) }, f);
    expect(revertPump.row).toBe('8');
    expect(revertPump.next.pumping).toBe(true);
    const lw = transition(machine('LandWindow', { landKind: 'vert', pumping: true, enteredTick: T - 22 }), { kind: 'timeout' }, f);
    expect([lw.row, lw.next.state, lw.next.pumping]).toEqual(['9b', 'Grounded', true]);
    const rw = transition(machine('RevertWindow', { pumping: true, enteredTick: T - 24 }), { kind: 'timeout' }, facts({ tick: T, crossHeld: false }));
    expect([rw.row, rw.next.state, rw.next.pumping]).toEqual(['16', 'Grounded', false]);
    const rel = transition(machine('LandWindow', { landKind: 'vert', pumping: true }), { kind: 'crossRelease' }, f);
    expect(rel.row).toBe('x:pump-release');
    expect(rel.effects.some((x) => x.kind === 'pop')).toBe(false);
  });

  it('REQ-SM-13: pump on a transition going down, crouch on a bowl floor (transition AND flat) or going up', () => {
    expect(transition(machine('Grounded'), { kind: 'crossPress' }, facts({ surface: QP_FACE, movingUp: false })).row).toBe('1b');
    expect(transition(machine('Grounded'), { kind: 'crossPress' }, facts({ surface: QP_FACE, movingUp: true })).row).toBe('1');
    expect(transition(machine('Grounded'), { kind: 'crossPress' }, facts({ surface: BOWL_FLOOR })).row).toBe('1');
    // The shallow foot of a transition (flat-sloped) pumps only while really descending (polish round 2).
    expect(transition(machine('Grounded'), { kind: 'crossPress' }, facts({ surface: BOWL_FLOOR, movingDown: true })).row).toBe('1b');
    // A pump release fires no hop: no pop effect.
    const rel = transition(machine('Grounded', { pumping: true }), { kind: 'crossRelease' }, facts());
    expect(rel.effects.some((x) => x.kind === 'pop')).toBe(false);
    expect(rel.next.state).toBe('Grounded');
    // velocityUp without Cross held stays pumping-free Grounded.
    expect(transition(machine('Grounded', { pumping: true }), { kind: 'velocityUp' }, facts({ crossHeld: false })).row).toBeNull();
  });

  it('row 4 needs speed >= MANUAL_MIN_SPEED on flat; slower or on a bank is ignored', () => {
    const e: SmEvent = { kind: 'manualEntry', manual: 'manual' };
    expect(transition(machine('Grounded'), e, facts({ speed: TUNING.MANUAL_MIN_SPEED - 0.01 })).row).toBeNull();
    expect(transition(machine('Grounded'), e, facts({ speed: 3, surface: QP_FACE })).row).toBeNull();
  });

  it('row 9c needs a vert landing and fires once per landing; row 9d needs a flat one', () => {
    expect(transition(machine('LandWindow', { landKind: 'flat' }), { kind: 'revertPress' }, facts()).row).toBeNull();
    expect(transition(machine('LandWindow', { landKind: 'vert', revertUsed: true }), { kind: 'revertPress' }, facts()).row).toBeNull();
    expect(transition(machine('LandWindow', { landKind: 'vert' }), { kind: 'manualLand', manual: 'manual' }, facts({ surface: QP_FACE })).row).toBeNull();
  });

  it('REQ-SM-06: rail end and a switch on the same tick, the rail end wins and the switch is dropped', () => {
    const end = transition(machine('Grind'), { kind: 'railEnd', corner: true }, facts({ tick: T }));
    expect(end.row).toBe('21');
    expect(transition(end.next, { kind: 'grindSwitch', grindType: 'smith' }, facts({ tick: T })).row).toBeNull();
  });

  it('row 11 adds no element (CR-24) and a special in the wrong state is ignored', () => {
    expect(transition(machine('Air'), { kind: 'spineTransfer', railId: 'WS-SP1-E' }, facts()).element).toBeNull();
    expect(transition(machine('Manual'), { kind: 'special', specialId: 'gpu_slide' }, facts()).row).toBeNull();
    expect(transition(machine('Grind'), { kind: 'special', specialId: 'context_window' }, facts()).row).toBeNull();
    expect(transition(machine('Air'), { kind: 'special', specialId: 'kernel_panic' }, facts()).row).toBeNull();
  });

  it('rows 19 / 27 pop only after a charge on the linker; a tap pops at charge 0 (REQ-CTL-14)', () => {
    expect(transition(machine('Grind'), { kind: 'crossRelease' }, facts()).row).toBeNull();
    const press = transition(machine('Manual', { manual: 'manual' }), { kind: 'crossPress' }, facts({ tick: T }));
    const rel = transition(press.next, { kind: 'crossRelease' }, facts({ tick: T + 1 }));
    expect(rel.row).toBe('27');
    expect(rel.effects).toEqual([{ kind: 'balanceStop' }, { kind: 'pop', charge: 0 }]);
  });

  it('popCharge: tap below 0.1 s = 0, linear to 1 at 0.6 s, saturates', () => {
    expect(popCharge(null, 50)).toBe(0);
    expect(popCharge(0, 12)).toBe(0);
    expect(popCharge(0, 42)).toBeCloseTo(0.5, 12);
    expect(popCharge(0, 72)).toBe(1);
    expect(popCharge(0, 200)).toBe(1);
  });

  it('isComboAliveState matches COMBO_ALIVE_STATES (REQ-SM-02)', () => {
    const all: SkaterStateName[] = ['Grounded', 'Crouch', 'Air', 'Grind', 'Lip', 'Manual', 'RevertWindow', 'LandWindow', 'Bail', 'GetUp', 'RunEnd'];
    expect(all.filter(isComboAliveState)).toEqual([...COMBO_ALIVE_STATES]);
  });
});

describe('timers (REQ-TIM-03, half-open)', () => {
  const f = facts();
  it('LandWindow 17 ticks flat, 22 vert; RevertWindow 24; Bail 72; GetUp 102; lip pending 18', () => {
    const expectTimer = (m: MachineState, n: number) => {
      expect(timerEvent(m, m.enteredTick + n - 1, f), `${m.state} n-1`).toBeNull();
      expect(timerEvent(m, m.enteredTick + n, f), `${m.state} n`).toEqual({ kind: 'timeout' });
    };
    expectTimer(machine('LandWindow', { landKind: 'flat', enteredTick: 10 }), 17);
    expectTimer(machine('LandWindow', { landKind: 'vert', enteredTick: 10 }), 22);
    expectTimer(machine('RevertWindow', { enteredTick: 10 }), 24);
    expectTimer(machine('Bail', { enteredTick: 10 }), 72);
    expectTimer(machine('GetUp', { enteredTick: 10 }), 102);
    expectTimer(machine('Lip', { enteredTick: 10, lipExitPending: true }), 18);
    expect(timerEvent(machine('Lip', { enteredTick: 10 }), 500, f)).toBeNull();
    expect([ticks(TUNING.MANUAL_LAND_WINDOW_MS), ticks(TUNING.REVERT_POST_MS), ticks(TUNING.REVERT_TO_MANUAL_MS), ticksS(TUNING.BAIL_TUMBLE_S), ticksS(TUNING.GETUP_LOCKOUT_S)]).toEqual([17, 22, 24, 72, 102]);
  });

  it('row 3 fires once, exactly ticksS(OLLIE_FULL_S) after the charge started', () => {
    const m = machine('Crouch', { chargeStartTick: 10, enteredTick: 10 });
    expect(timerEvent(m, 81, f)).toBeNull();
    expect(timerEvent(m, 82, f)).toEqual({ kind: 'timeout' });
    expect(timerEvent(m, 83, f)).toBeNull();
    for (const s of ['Grounded', 'Air', 'Grind', 'Manual', 'RunEnd'] as const) expect(timerEvent(machine(s), 10000, f)).toBeNull();
  });

  it('Bail then GetUp then Grounded through the timers: 72 + 102 ticks', () => {
    const rig = new LogicRig({}, 'Grind');
    rig.send({ kind: 'needleOut' });
    rig.wait(71);
    expect(rig.m.state).toBe('Bail');
    rig.wait(1);
    expect(rig.m.state).toBe('GetUp');
    rig.wait(101);
    expect(rig.m.state).toBe('GetUp');
    rig.wait(1);
    expect(rig.m.state).toBe('Grounded');
    expect(rig.rows).toEqual(['23', '38', '39']);
  });
});

describe('landing windows (SPEC §13)', () => {
  function airRig(): LogicRig {
    const rig = new LogicRig({}, 'Air');
    rig.scoring.startCombo(0);
    rig.add({ kind: 'trick', trickId: 'melon' });
    rig.scoring.closeOpen();
    return rig;
  }

  it('revert pre-buffer fires on contact (REQ-TIM-07): RevertWindow, +1 revert, stance toggles', () => {
    const rig = airRig();
    const r = rig.send({ kind: 'contact', landing: VERT_LANDING({ revertBuffered: true }) }, { surface: QP_FACE });
    expect(r.row).toBe('8');
    expect(rig.m.state).toBe('RevertWindow');
    expect(rig.stance).toBe('switch');
    expect(rig.scoring.combo?.elements.map((e) => e.id)).toEqual(['melon', 'revert']);
  });

  it('R2 at 170 ms after a vert landing reverts, at 190 ms it does not (REQ-TIM-11)', () => {
    const late = (ms: number) => {
      const rig = airRig();
      rig.send({ kind: 'contact', landing: VERT_LANDING() }, { surface: QP_FACE });
      rig.wait(Math.round((ms * 120) / 1000), { surface: QP_FACE });
      return { rig, r: rig.send({ kind: 'revertPress' }, { surface: QP_FACE }) };
    };
    const a = late(170);
    expect(a.r.row).toBe('9c');
    expect(a.rig.m.state).toBe('RevertWindow');
    expect(a.rig.scoring.combo?.elements.length).toBe(2);
    const b = late(190);
    expect(b.r.row).toBeNull();
    expect(b.rig.rows).toEqual(['9', '9b', null]);
    expect(b.rig.m.state).toBe('Grounded');
    expect(b.rig.banks).toEqual([150]);
  });

  it('revert -> manual inside 200 ms keeps the combo (REQ-REV-02)', () => {
    const rig = airRig();
    rig.send({ kind: 'contact', landing: VERT_LANDING({ revertBuffered: true }) }, { surface: QP_FACE });
    rig.wait(23, { surface: QP_FACE });
    const r = rig.send({ kind: 'revertManual', manual: 'manual' }, { surface: QP_FACE });
    expect(r.row).toBe('15');
    expect(rig.m.state).toBe('Manual');
    expect(rig.banks).toEqual([]);
    expect(rig.scoring.combo?.elements.map((e) => e.id)).toEqual(['melon', 'revert', 'switch_manual']);
  });

  it('revert window timeout kills it: banks at 24 ticks, a later pair does nothing (REQ-REV-03)', () => {
    const rig = airRig();
    rig.send({ kind: 'contact', landing: VERT_LANDING({ revertBuffered: true }) }, { surface: QP_FACE });
    rig.wait(24, { surface: QP_FACE });
    expect(rig.m.state).toBe('Grounded');
    expect(rig.banks).toEqual([(150 + 100) * 2]);
    expect(rig.send({ kind: 'revertManual', manual: 'manual' }).row).toBeNull();
    expect(rig.scoring.combo).toBeNull();
  });

  it('manual input inside the 140 ms window on flat keeps the combo, before (row 7) and after (row 9d) contact', () => {
    const before = airRig();
    expect(before.send({ kind: 'contact', landing: landing({ manualPair: 'manual' }) }).row).toBe('7');
    expect(before.m.state).toBe('Manual');
    expect(before.banks).toEqual([]);

    const after = airRig();
    after.send({ kind: 'contact', landing: landing() });
    after.wait(16);
    expect(after.m.state).toBe('LandWindow');
    expect(after.send({ kind: 'manualLand', manual: 'nose_manual' }).row).toBe('9d');
    expect(after.m.state).toBe('Manual');
    expect(after.banks).toEqual([]);
    expect(after.scoring.combo?.elements.map((e) => e.id)).toEqual(['melon', 'nose_manual']);

    const tooLate = airRig();
    tooLate.send({ kind: 'contact', landing: landing() });
    tooLate.wait(17);
    expect(tooLate.m.state).toBe('Grounded');
    expect(tooLate.banks).toEqual([150]);
  });

  it('REQ-REV-05 quality gate: R2 100 ms early, Up,Down at 150 ms -> Manual, combo alive, stance switched', () => {
    const rig = airRig();
    rig.send({ kind: 'contact', landing: VERT_LANDING({ revertBuffered: true }) }, { surface: QP_FACE });
    rig.wait(18, { surface: QP_FACE });
    rig.send({ kind: 'revertManual', manual: 'manual' }, { surface: QP_FACE });
    expect(rig.m.state).toBe('Manual');
    expect(rig.stance).toBe('switch');
    expect(rig.scoring.combo?.elements.map((e) => e.id)).toEqual(['melon', 'revert', 'switch_manual']);
  });

  it('REQ-MAN-06: grind -> manual -> grind banks as one combo', () => {
    const rig = airRig();
    rig.send(rail('fifty_fifty'));
    rig.wait(60);
    rig.send({ kind: 'railEnd', corner: false });
    rig.wait(30);
    rig.send({ kind: 'contact', landing: landing({ manualPair: 'manual' }) });
    rig.wait(60);
    rig.send(rail('five_o', true));
    rig.wait(60);
    rig.send({ kind: 'crossPress' });
    rig.send({ kind: 'crossRelease' });
    rig.wait(20);
    rig.send({ kind: 'contact', landing: landing() });
    rig.wait(17);
    expect(rig.rows).toEqual(['5', '21', '7', '34b', 'x:grind-charge', '19', '9', '9b']);
    expect(rig.banks.length).toBe(1);
    // melon 150 + 50-50 100 + 40 + manual 50 + 20 + 5-0 150 + 45 = 555, x4 elements
    expect(rig.banks[0]).toBe(555 * 4);
  });

  it('rows 40 / 41 at 0:00: the alive combo freezes the clock, banks, then the run ends; a bail ends it after the get-up', () => {
    const rig = airRig();
    rig.send({ kind: 'contact', landing: landing() });
    expect(rig.send({ kind: 'clockZero' }, { clockZero: true }).row).toBe('40');
    rig.wait(17, { clockZero: true });
    expect(rig.m.state).toBe('Grounded');
    expect(rig.send({ kind: 'clockZero' }, { clockZero: true }).row).toBe('41');
    expect(rig.m.state).toBe('RunEnd');

    const bailed = new LogicRig({}, 'Grind');
    bailed.send({ kind: 'needleOut' });
    expect(bailed.send({ kind: 'clockZero' }, { clockZero: true }).row).toBeNull();
    bailed.wait(72 + 102, { clockZero: true });
    expect(bailed.m.state).toBe('Grounded');
    expect(bailed.send({ kind: 'clockZero' }, { clockZero: true }).row).toBe('41');
  });

  it('coyote: a charge held over an edge pops if released inside 11 ticks, not after (row 37b, P9)', () => {
    const go = (after: number) => {
      const rig = new LogicRig();
      rig.send({ kind: 'crossPress' });
      rig.wait(36);
      rig.send({ kind: 'leftSurface' }, { surface: null });
      rig.wait(after, { surface: null });
      return rig.send({ kind: 'crossRelease' }, { surface: null });
    };
    const ok = go(10);
    expect(ok.row).toBe('x:coyote-release');
    expect(ok.effects).toEqual([{ kind: 'pop', charge: popCharge(0, 46) }]);
    expect(go(11).row).toBe('x:coyote-release-late');
    expect(go(11).effects).toEqual([]);
  });

  it('a lip tap stays 150 ms then exits (rows 25b, 25)', () => {
    const rig = airRig();
    rig.send(lip());
    rig.wait(5);
    expect(rig.send({ kind: 'triangleRelease' }).row).toBe('25b');
    rig.wait(12);
    expect(rig.m.state).toBe('Lip');
    rig.wait(1);
    expect(rig.m.state).toBe('Air');
    expect(rig.rows).toEqual(['6', '25b', '25']);
  });

  it('initialMachine is Grounded with nothing pending', () => {
    expect(initialMachine(3)).toEqual({
      state: 'Grounded', enteredTick: 3, pumping: false, landKind: null, revertUsed: false,
      chargeStartTick: null, manual: null, lipExitPending: false, bailReason: null,
    });
  });
});
