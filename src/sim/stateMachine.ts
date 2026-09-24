/**
 * src/sim/stateMachine.ts (logic track): the pure, table-driven skater state machine
 * (SPEC §8, DESIGN C.5, REQ-SM-01..14). No rendering imports, no geometry, no events.
 *
 * TRANSITIONS lists every row of DESIGN C.5 (plus "x:" implementation rows). transition() finds the
 * rows whose `from` contains the current state and whose `event` matches, tries their guards in
 * table order, and returns the first match: next state, combo effect, element to add and effects.
 * No match = the event is ignored (row null, state unchanged). The world applies the result:
 *   combo effect -> src/sim/scoring.ts (start / add / bank / lose; "lose" also empties the special)
 *   effects      -> controller (pop, snap, pivot, mirror, hop), balance (start / stop), run clock.
 * Every DESIGN row id in DESIGN_ROW_IDS must appear in TRANSITIONS and in stateMachine.test.
 *
 * Timers (half-open, REQ-TIM-03): LandWindow ticks(MANUAL_LAND_WINDOW_MS) after a flat landing and
 * ticks(REVERT_POST_MS) after a vert one; RevertWindow ticks(REVERT_TO_MANUAL_MS); Bail
 * ticksS(BAIL_TUMBLE_S); GetUp ticksS(GETUP_LOCKOUT_S); a pending Lip exit ticks(LIP_MIN_HOLD_MS)
 * after entry; Crouch ticksS(OLLIE_FULL_S) after chargeStartTick (row 3: same state, the charge
 * saturates, no effects; it fires once, on that tick). timerEvent() reports expiry as a
 * { kind: "timeout" } event.
 *
 * Decisions the rows must follow (src/sim/types.ts has the details):
 * - Row 11 (spine transfer) is combo "live" with no element and effects [spineMirror]; the +1 gap
 *   comes only from the gap tracker (DESIGN §L CR-24). No row ever returns a "gap" ElementRef.
 * - clockZero arrives every tick from 0:00 until RunEnd: row 40 (alive states, clockFreeze), row 41
 *   (Grounded -> RunEnd), "x:crouch-clock-zero" (Crouch -> RunEnd); Bail / GetUp ignore it (CR-25).
 *
 * Readings of DESIGN this table makes (logic track, M2):
 * - Row 10's bail reason: an unfinished animation is "midTrick", then off-axis "landing", then tilt.
 * - A landing on a bank (neither flat nor vert) opens the flat-length LandWindow; row 9d still needs
 *   the current surface to be flat.
 * - Row 25 fires on the Cross PRESS in Lip (the SmEvent contract and the C.5 row); the P8 /
 *   REQ-CTL-14 "crouch on linker" charge applies to Grind and Manual only (see requests).
 * - Rows 19 and 27 pop only after a charge started on the linker (x:grind-charge / x:manual-charge,
 *   or row 13's held Cross); a tap is a press plus a release, which pops at charge 0.
 * - Leaving a linker (Grind / Lip / Manual) always emits balanceStop, a bail from one too.
 * - Pumping after an air (polish round 2): LandWindow and RevertWindow pump like Grounded (rows 9i,
 *   9j, 12b); row 12 (land with Cross held, charge from contact) is for flat ground only.
 */

import { clamp } from '../core/math';
import { ticks, ticksS, TUNING } from '../core/tuning';
import { COMBO_ALIVE_STATES, type BailReason, type BaseTrickId, type SkaterStateName } from '../core/types';
import type {
  ElementRef, LandingFacts, MachineState, SmEffect, SmEvent, SmFacts, TransitionResult, TransitionRow,
} from './types';

type Ev<K extends SmEvent['kind']> = Extract<SmEvent, { kind: K }>;
type Fn<T> = (m: MachineState, e: SmEvent, f: SmFacts) => T;

/** A TRANSITIONS row plus the logic-internal field changes of the next MachineState. */
interface LogicRow extends TransitionRow {
  readonly patch?: Fn<Partial<MachineState>>;
}

const LINKER_STATES: readonly SkaterStateName[] = ['Grind', 'Lip', 'Manual'];

/** REQ-CTL-05 / CTL-14: charge in [0, 1] from a Cross hold that began at chargeStartTick (tap below OLLIE_TAP_MAX_S = 0). */
export function popCharge(chargeStartTick: number | null, tick: number): number {
  if (chargeStartTick === null) return 0;
  const heldS = (tick - chargeStartTick) / TUNING.SIM_HZ;
  const lin = clamp((heldS - TUNING.OLLIE_TAP_MAX_S) / (TUNING.OLLIE_FULL_S - TUNING.OLLIE_TAP_MAX_S), 0, 1);
  return Math.pow(lin, TUNING.OLLIE_CHARGE_EXP);
}

/** REQ-SM-03: why a contact from Air bails, or null for a clean enough landing. */
export function landingBailReason(l: LandingFacts): BailReason | null {
  if (!l.animsDone) return 'midTrick';
  if (Math.abs(l.offAxisDeg) > TUNING.LAND_OFFAXIS_BAIL_DEG) return 'landing';
  if (Math.abs(l.tiltDeg) > TUNING.TILT_BAIL_DEG) return 'tilt';
  return null;
}

const land = (e: SmEvent): LandingFacts => (e as Ev<'contact'>).landing;
const grindTry = (e: SmEvent): Ev<'grindTry'> => e as Ev<'grindTry'>;
const wall = (e: SmEvent): Ev<'wallHit'> => e as Ev<'wallHit'>;
const trick = (trickId: BaseTrickId): ElementRef => ({ kind: 'trick', trickId });
const manualOf = (e: SmEvent) => (e as Ev<'manualEntry' | 'manualLand' | 'revertManual' | 'manualSwap'>).manual;

const fx = (...list: SmEffect[]): Fn<readonly SmEffect[]> => () => list;
const stopIfLinker = (m: MachineState): SmEffect[] => (LINKER_STATES.includes(m.state) ? [{ kind: 'balanceStop' }] : []);
const bailFx = (reason: BailReason): Fn<readonly SmEffect[]> => (m) => [...stopIfLinker(m), { kind: 'bailStart', reason }];
const bailPatch = (reason: BailReason): Fn<Partial<MachineState>> => () => ({ bailReason: reason });
const popFx = (withStop: boolean): Fn<readonly SmEffect[]> => (m, _e, f) => [
  ...(withStop ? [{ kind: 'balanceStop' } as const] : []),
  { kind: 'pop', charge: popCharge(m.chargeStartTick, f.tick) },
];
const chargeNow: Fn<Partial<MachineState>> = (_m, _e, f) => ({ chargeStartTick: f.tick });
const hasCharge: Fn<boolean> = (m) => m.chargeStartTick !== null;
const headOn: Fn<boolean> = (_m, e) => wall(e).headOn;
const glancing: Fn<boolean> = (_m, e) => !wall(e).headOn;
const railFromGround: Fn<boolean> = (_m, e) => grindTry(e).candidate === 'rail' && grindTry(e).ground;
const grindElement: Fn<ElementRef> = (_m, e) => trick(grindTry(e).grindType);
const manualElement: Fn<ElementRef> = (_m, e) => trick(manualOf(e));
const manualPatch: Fn<Partial<MachineState>> = (_m, e) => ({ manual: manualOf(e) });
/**
 * Rows 1b, 9i: Cross pressed on a transition while moving down it = pump: on the steep face when not
 * moving up, on its shallow (flat-sloped) foot only while really descending (f.movingDown), so a
 * level bowl floor still crouches.
 */
const pumpGuard: Fn<boolean> = (_m, _e, f) =>
  f.surface !== null && f.surface.transition && (f.surface.flat ? f.movingDown === true : !f.movingUp);
/** Rows 8, 12b: a contact with Cross already held on a transition while moving down it = pump, not Crouch. */
const pumpLanding = (e: SmEvent, f: SmFacts): boolean => land(e).crossHeld && pumpGuard(initialMachine(f.tick), e, f);
/** Rows 9b, 9c, 16: a pump in a window carries into the next state while Cross is still held. */
const keepPump: Fn<Partial<MachineState>> = (m, _e, f) => ({ pumping: m.pumping && f.crossHeld });

const ROWS: readonly LogicRow[] = [
  // ---- Grounded ----
  {
    id: '1b', from: ['Grounded'], event: 'crossPress', to: 'same', combo: 'none',
    guard: pumpGuard,
    effects: fx({ kind: 'pump', on: true }), patch: () => ({ pumping: true }),
    note: 'Cross on a transition while moving down: pump, no charge, the release fires no hop',
  },
  {
    id: '1', from: ['Grounded'], event: 'crossPress', to: 'Crouch', combo: 'none',
    effects: fx({ kind: 'startCharge' }), patch: chargeNow,
    note: 'Cross on flat or bank, or on a transition while moving up: charge starts',
  },
  {
    id: '1c', from: ['Grounded'], event: 'velocityUp', to: 'Crouch', combo: 'none',
    guard: (m, _e, f) => m.pumping && f.crossHeld,
    effects: fx({ kind: 'pump', on: false }, { kind: 'startCharge' }), patch: chargeNow,
    note: 'pumping, velocity turns upward with Cross held: charge starts now',
  },
  {
    id: 'x:pump-release', from: ['Grounded', 'LandWindow', 'RevertWindow'], event: 'crossRelease', to: 'same', combo: 'none',
    guard: (m) => m.pumping,
    effects: fx({ kind: 'pump', on: false }), patch: () => ({ pumping: false }),
    note: 'releasing a pump fires no hop (REQ-CTL-21)',
  },
  {
    id: '4', from: ['Grounded'], event: 'manualEntry', to: 'Manual', combo: 'startAdd',
    guard: (_m, _e, f) => f.speed >= TUNING.MANUAL_MIN_SPEED && f.surface !== null && f.surface.flat,
    element: manualElement, effects: fx({ kind: 'balanceStart', axis: 'v' }), patch: manualPatch,
    note: 'MANUAL_ENTRY pair, speed >= 1.0, slope < 35: needle starts at +-0.05',
  },
  {
    id: '35', from: ['Grounded', 'Crouch'], event: 'wallHit', to: 'Bail', combo: 'lose', guard: headOn,
    effects: bailFx('wall'), patch: bailPatch('wall'), note: 'head-on wall hit; combo already dead',
  },
  {
    id: '36', from: ['Grounded', 'Crouch'], event: 'grindTry', to: 'Grind', combo: 'startAdd', guard: railFromGround,
    element: grindElement, effects: fx({ kind: 'groundSnapHop' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'GRIND_TRY with a low candidate (P5b): hop and snap, a new combo',
  },
  {
    id: '37', from: ['Grounded'], event: 'leftSurface', to: 'Air', combo: 'start',
    note: 'rolled off a ledge, step, roof edge, bowl rim or coping: combo starts empty',
  },
  {
    id: '41', from: ['Grounded'], event: 'clockZero', to: 'RunEnd', combo: 'none', guard: (_m, _e, f) => !f.comboAlive,
    effects: fx({ kind: 'runEnd' }), note: 'run clock at 0:00 with no combo alive',
  },
  // ---- Crouch ----
  {
    id: '2', from: ['Crouch'], event: 'crossRelease', to: 'Air', combo: 'start', effects: popFx(false),
    note: 'release Cross: pop height from the hold (REQ-CTL-05)',
  },
  {
    id: '3', from: ['Crouch'], event: 'timeout', to: 'same', combo: 'none',
    note: 'hold > 0.6 s: the charge saturates, crouch holds indefinitely',
  },
  {
    id: '37b', from: ['Crouch'], event: 'leftSurface', to: 'Air', combo: 'start',
    patch: (m) => ({ chargeStartTick: m.chargeStartTick }),
    note: 'rolled off an edge while charging: the charge keeps accumulating, a release inside the coyote window pops',
  },
  {
    id: 'x:crouch-clock-zero', from: ['Crouch'], event: 'clockZero', to: 'RunEnd', combo: 'none',
    effects: fx({ kind: 'runEnd' }), note: 'Crouch never has a live combo: the run ends at 0:00 (CR-25)',
  },
  // ---- Air: contact (first match wins) ----
  {
    id: '10', from: ['Air'], event: 'contact', to: 'Bail', combo: 'lose',
    guard: (_m, e) => landingBailReason(land(e)) !== null,
    effects: (_m, e) => [{ kind: 'bailStart', reason: landingBailReason(land(e)) as BailReason }],
    patch: (_m, e) => ({ bailReason: landingBailReason(land(e)) }),
    note: 'off-axis > 60 (LAND_OFFAXIS_BAIL_DEG, CR-43, CR-65) or tilt > TILT_BAIL_DEG (off by default) or an unfinished flip / grab / special animation',
  },
  {
    id: '13', from: ['Air'], event: 'contact', to: 'Manual', combo: 'liveAdd',
    guard: (_m, e) => land(e).crossHeld && land(e).flat && land(e).manualPair !== null,
    element: (_m, e) => trick(land(e).manualPair as NonNullable<LandingFacts['manualPair']>),
    effects: fx({ kind: 'balanceStart', axis: 'v' }, { kind: 'startCharge' }),
    patch: (_m, e, f) => ({ manual: land(e).manualPair, chargeStartTick: f.tick }),
    note: 'contact with Cross held and a valid manual pair: the held Cross becomes a manual pop charge',
  },
  {
    id: '7', from: ['Air'], event: 'contact', to: 'Manual', combo: 'liveAdd',
    guard: (_m, e) => land(e).flat && land(e).manualPair !== null,
    element: (_m, e) => trick(land(e).manualPair as NonNullable<LandingFacts['manualPair']>),
    effects: fx({ kind: 'balanceStart', axis: 'v' }), patch: (_m, e) => ({ manual: land(e).manualPair }),
    note: 'flat contact, MANUAL_LAND pair within 17 ticks before contact: needle re-centred',
  },
  {
    id: '8', from: ['Air'], event: 'contact', to: 'RevertWindow', combo: 'liveAdd',
    guard: (_m, e) => land(e).vert && land(e).revertBuffered,
    element: () => trick('revert'), effects: (_m, e, f) => [{ kind: 'revertPivot' }, ...(pumpLanding(e, f) ? [{ kind: 'pump', on: true } as const] : [])],
    patch: (_m, e, f) => ({ landKind: 'vert', revertUsed: true, pumping: pumpLanding(e, f) }),
    note: 'vert contact with R2 in the pre buffer (18 ticks): stance toggles, board yaws 180 (Cross held down the face also pumps, row 12b)',
  },
  {
    id: '12b', from: ['Air'], event: 'contact', to: 'LandWindow', combo: 'live',
    guard: (_m, e, f) => pumpLanding(e, f),
    effects: fx({ kind: 'pump', on: true }),
    patch: (_m, e) => ({ landKind: land(e).vert ? 'vert' : 'flat', pumping: true }),
    note: 'contact with Cross held on a transition while moving down it: LandWindow pumping, no charge, the release fires no hop',
  },
  {
    id: '12', from: ['Air'], event: 'contact', to: 'Crouch', combo: 'bank',
    guard: (_m, e) => land(e).crossHeld && land(e).flat && land(e).manualPair === null,
    effects: fx({ kind: 'startCharge' }), patch: chargeNow,
    note: 'contact with Cross held on flat, no manual pair: banks at contact, charge starts at contact',
  },
  {
    id: '9', from: ['Air'], event: 'contact', to: 'LandWindow', combo: 'live',
    patch: (_m, e) => ({ landKind: land(e).vert ? 'vert' : 'flat' }),
    note: 'clean contact, no linker this tick: LandWindow 17 ticks (flat) or 22 (vert), nothing banks yet',
  },
  // ---- Air: other events ----
  {
    id: '5b', from: ['Air'], event: 'grindTry', to: 'Bail', combo: 'lose',
    guard: (_m, e, f) => !grindTry(e).ground && !f.animsDone,
    effects: bailFx('midTrick'), patch: bailPatch('midTrick'), note: 'grinding (or lipping) mid-flip',
  },
  {
    id: '5', from: ['Air'], event: 'grindTry', to: 'Grind', combo: 'liveAdd',
    guard: (_m, e) => !grindTry(e).ground && grindTry(e).candidate === 'rail',
    element: grindElement, effects: fx({ kind: 'grindSnap' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'GRIND_TRY (pressed or buffered) with a rail candidate, animations done: snap',
  },
  {
    id: '6', from: ['Air'], event: 'grindTry', to: 'Lip', combo: 'liveAdd',
    guard: (_m, e) => !grindTry(e).ground && grindTry(e).candidate === 'lip',
    element: (_m, e) => trick(grindTry(e).lipId), effects: fx({ kind: 'lipSnap' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'Triangle at coping, near-vertical below, vy <= 3, animations done: Axle Stall or Rock to Fakie',
  },
  {
    id: '11', from: ['Air'], event: 'spineTransfer', to: 'same', combo: 'live', effects: fx({ kind: 'spineMirror' }),
    note: 'spine transfer mirror; the +1 is the level gap from the gap tracker (CR-24)',
  },
  {
    id: '14', from: ['Air'], event: 'wallHit', to: 'Bail', combo: 'lose', guard: headOn,
    effects: bailFx('wall'), patch: bailPatch('wall'), note: 'head-on wall hit in the air',
  },
  {
    id: 'x:coyote-pop', from: ['Air'], event: 'coyotePop', to: 'same', combo: 'live',
    effects: fx({ kind: 'pop', charge: 0 }), patch: () => ({ chargeStartTick: null }),
    note: 'P8b: Cross pressed within 11 ticks of leaving a surface pops as a tap',
  },
  {
    id: 'x:coyote-release', from: ['Air'], event: 'crossRelease', to: 'same', combo: 'live',
    guard: (m, _e, f) => m.chargeStartTick !== null && f.tick - m.enteredTick < ticks(TUNING.COYOTE_MS),
    effects: popFx(false), patch: () => ({ chargeStartTick: null }),
    note: 'P9 / row 37b: a charge held over an edge pops if released within 11 ticks of leftSurface',
  },
  {
    id: 'x:coyote-release-late', from: ['Air'], event: 'crossRelease', to: 'same', combo: 'live', guard: hasCharge,
    patch: () => ({ chargeStartTick: null }), note: 'row 37b: a later release does nothing',
  },
  // ---- LandWindow (CR-18) ----
  {
    id: '9b', from: ['LandWindow'], event: 'timeout', to: 'Grounded', combo: 'bank', patch: keepPump,
    note: 'timer expires: banks (0 if empty); a pump with Cross still held carries on',
  },
  {
    id: '9c', from: ['LandWindow'], event: 'revertPress', to: 'RevertWindow', combo: 'liveAdd',
    guard: (m) => m.landKind === 'vert' && !m.revertUsed,
    element: () => trick('revert'), effects: fx({ kind: 'revertPivot' }),
    patch: (m, e, f) => ({ landKind: 'vert', revertUsed: true, ...keepPump(m, e, f) }),
    note: 'R2 after a vert landing (P2b): the post-contact half of the 180 ms window',
  },
  {
    id: '9d', from: ['LandWindow'], event: 'manualLand', to: 'Manual', combo: 'liveAdd',
    guard: (m, _e, f) => m.landKind === 'flat' && f.surface !== null && f.surface.flat,
    element: manualElement, effects: fx({ kind: 'balanceStart', axis: 'v' }), patch: manualPatch,
    note: 'MANUAL_LAND pair after a flat landing: the post-contact half of the 140 ms window',
  },
  {
    id: '9i', from: ['LandWindow', 'RevertWindow'], event: 'crossPress', to: 'same', combo: 'none', guard: pumpGuard,
    effects: fx({ kind: 'pump', on: true }), patch: () => ({ pumping: true }),
    note: 'Cross on a transition while moving down it inside the window: pump (row 1b), the combo stays alive',
  },
  {
    id: '9j', from: ['LandWindow', 'RevertWindow'], event: 'velocityUp', to: 'Crouch', combo: 'bank',
    guard: (m, _e, f) => m.pumping && f.crossHeld,
    effects: fx({ kind: 'pump', on: false }, { kind: 'startCharge' }), patch: chargeNow,
    note: 'pumping inside the window, velocity turns upward with Cross held: banks, then the charge starts (rows 1c, 9e)',
  },
  {
    id: '9e', from: ['LandWindow'], event: 'crossPress', to: 'Crouch', combo: 'bank',
    effects: fx({ kind: 'startCharge' }), patch: chargeNow, note: 'Cross banks on the press, then Crouch begins',
  },
  {
    id: '9f', from: ['LandWindow'], event: 'wallHit', to: 'Bail', combo: 'lose', guard: headOn,
    effects: bailFx('wall'), patch: bailPatch('wall'), note: 'head-on wall hit',
  },
  {
    id: '9g', from: ['LandWindow'], event: 'grindTry', to: 'Grind', combo: 'bankStartAdd', guard: railFromGround,
    element: grindElement, effects: fx({ kind: 'groundSnapHop' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'ground snap (P5b) from the window: the old combo banks, the grind starts a new one',
  },
  { id: '9h', from: ['LandWindow'], event: 'leftSurface', to: 'Air', combo: 'live', note: 'rolled off an edge inside the window' },
  // ---- RevertWindow ----
  {
    id: '15', from: ['RevertWindow'], event: 'revertManual', to: 'Manual', combo: 'liveAdd',
    element: manualElement, effects: fx({ kind: 'balanceStart', axis: 'v' }), patch: manualPatch,
    note: 'REVERT_MANUAL pair within 24 ticks: scores switch if the stance is now switch',
  },
  {
    id: '16', from: ['RevertWindow'], event: 'timeout', to: 'Grounded', combo: 'bank', patch: keepPump,
    note: '24 ticks elapse: banks; a pump with Cross still held carries on',
  },
  {
    id: '17', from: ['RevertWindow'], event: 'wallHit', to: 'Bail', combo: 'lose', guard: headOn,
    effects: bailFx('wall'), patch: bailPatch('wall'), note: 'the only bail in RevertWindow (REQ-SM-10)',
  },
  {
    id: '18', from: ['RevertWindow'], event: 'crossPress', to: 'Crouch', combo: 'bank',
    effects: fx({ kind: 'startCharge' }), patch: chargeNow, note: 'Cross is not a linker here: banks, then Crouch',
  },
  {
    id: 'x:revert-left-surface', from: ['RevertWindow'], event: 'leftSurface', to: 'Air', combo: 'live',
    note: 'left the face inside the window (REQ-SM-12 spirit): the combo lives, landing needs a linker',
  },
  // ---- Grind ----
  {
    id: 'x:grind-charge', from: ['Grind'], event: 'crossPress', to: 'same', combo: 'live',
    effects: fx({ kind: 'startCharge' }), patch: chargeNow, note: 'CROUCH_ON_LINKER: charge while grinding (P8)',
  },
  {
    id: '19', from: ['Grind'], event: 'crossRelease', to: 'Air', combo: 'live', guard: hasCharge, effects: popFx(true),
    note: 'release Cross after the linker charge (or a tap): pop from charge',
  },
  {
    id: '20', from: ['Grind'], event: 'grindSwitch', to: 'same', combo: 'liveAdd',
    element: (_m, e) => trick((e as Ev<'grindSwitch'>).grindType),
    effects: fx({ kind: 'grindSnap' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'grind-type switch: own degradation history, needle re-centred, same-object x1.6 stays',
  },
  {
    id: '21', from: ['Grind'], event: 'railEnd', to: 'Air', combo: 'live', effects: fx({ kind: 'balanceStop' }),
    note: 'rail end (or a corner sharper than 55): keeps tangent velocity; a same-tick switch is dropped',
  },
  {
    id: '22', from: ['Grind'], event: 'stall', to: 'Air', combo: 'live',
    effects: fx({ kind: 'balanceStop' }, { kind: 'stallHop' }), note: 'speed < 1.5 m/s: stall-out hop 0.3 m',
  },
  {
    id: '22b', from: ['Grind'], event: 'wallHit', to: 'Bail', combo: 'lose', guard: headOn,
    effects: bailFx('wall'), patch: bailPatch('wall'), note: 'head-on wall hit on a rail',
  },
  {
    id: '22c', from: ['Grind'], event: 'wallHit', to: 'same', combo: 'live', guard: glancing,
    effects: fx({ kind: 'railClamp' }), note: 'glancing wall hit: velocity clamped along the rail x0.8',
  },
  {
    id: '23', from: ['Grind'], event: 'needleOut', to: 'Bail', combo: 'lose',
    effects: bailFx('balance'), patch: bailPatch('balance'), note: 'needle abs >= 1',
  },
  {
    id: '24', from: ['Grind'], event: 'special', to: 'same', combo: 'liveAdd',
    guard: (_m, e) => (e as Ev<'special'>).specialId === 'gpu_slide',
    element: () => trick('gpu_slide'), effects: fx({ kind: 'grindSnap' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'special grind: a grind type, holdable, +150/s',
  },
  // ---- Lip ----
  {
    id: '25', from: ['Lip'], event: 'crossPress', to: 'Air', combo: 'live',
    effects: fx({ kind: 'balanceStop' }, { kind: 'lipExit' }), note: 'Cross: lip exit back into the ramp (REQ-LIP-03)',
  },
  {
    id: '25', from: ['Lip'], event: 'triangleRelease', to: 'Air', combo: 'live',
    guard: (m, _e, f) => f.tick - m.enteredTick >= ticks(TUNING.LIP_MIN_HOLD_MS),
    effects: fx({ kind: 'balanceStop' }, { kind: 'lipExit' }), note: 'Triangle released after the 150 ms minimum hold',
  },
  {
    id: '25b', from: ['Lip'], event: 'triangleRelease', to: 'same', combo: 'live',
    patch: () => ({ lipExitPending: true }), note: 'Triangle released before 150 ms: stay until 150 ms, then row 25',
  },
  {
    id: '25', from: ['Lip'], event: 'timeout', to: 'Air', combo: 'live', guard: (m) => m.lipExitPending,
    effects: fx({ kind: 'balanceStop' }, { kind: 'lipExit' }), note: 'the pending exit of row 25b at 150 ms',
  },
  {
    id: '26', from: ['Lip'], event: 'needleOut', to: 'Bail', combo: 'lose',
    effects: bailFx('balance'), patch: bailPatch('balance'), note: 'needle abs >= 1 (no wall hit is possible in Lip)',
  },
  // ---- Manual ----
  {
    id: 'x:manual-charge', from: ['Manual'], event: 'crossPress', to: 'same', combo: 'live',
    effects: fx({ kind: 'startCharge' }), patch: chargeNow, note: 'CROUCH_ON_LINKER: charge while in a manual (P8)',
  },
  {
    id: '27', from: ['Manual'], event: 'crossRelease', to: 'Air', combo: 'live', guard: hasCharge, effects: popFx(true),
    note: 'release Cross (charged) or tap Cross: pop',
  },
  {
    id: '28', from: ['Manual'], event: 'manualSwap', to: 'same', combo: 'liveAdd',
    element: manualElement, effects: fx({ kind: 'balanceStart', axis: 'v' }), patch: manualPatch,
    note: 'nose / normal swap (rate-limited by the parser): +1, needle re-centred',
  },
  {
    id: '29', from: ['Manual'], event: 'needleOut', to: 'Bail', combo: 'lose',
    effects: bailFx('balance'), patch: bailPatch('balance'), note: 'needle abs >= 1',
  },
  {
    id: '30', from: ['Manual'], event: 'slowStop', to: 'Grounded', combo: 'bank', effects: fx({ kind: 'balanceStop' }),
    note: 'speed < 1.0 m/s: rolled to a stop',
  },
  {
    id: '31', from: ['Manual'], event: 'climbSteep', to: 'Grounded', combo: 'bank', effects: fx({ kind: 'balanceStop' }),
    note: 'climbing a bank into slope >= 35 (a transition is ridden up and off the lip, row 33b; descending one is allowed)',
  },
  {
    id: '32', from: ['Manual'], event: 'wallHit', to: 'Bail', combo: 'lose', guard: headOn,
    effects: bailFx('wall'), patch: bailPatch('wall'), note: 'head-on wall hit (speed >= 5.0, incidence <= 45)',
  },
  {
    id: '33', from: ['Manual'], event: 'wallHit', to: 'same', combo: 'live', guard: glancing,
    effects: fx({ kind: 'wallSlide' }), note: 'glancing wall hit: redirected along the wall x0.8',
  },
  {
    id: '33b', from: ['Manual'], event: 'leftSurface', to: 'Air', combo: 'live', effects: fx({ kind: 'balanceStop' }),
    note: 'manual off a ledge: landing needs a linker again',
  },
  {
    id: '34', from: ['Manual'], event: 'special', to: 'same', combo: 'liveAdd',
    guard: (_m, e) => (e as Ev<'special'>).specialId === 'context_window',
    element: () => trick('context_window'), note: 'special manual: drift x2 while held (the world passes the flag to stepBalance)',
  },
  {
    id: '34b', from: ['Manual'], event: 'grindTry', to: 'Grind', combo: 'liveAdd', guard: railFromGround,
    element: grindElement, effects: fx({ kind: 'groundSnapHop' }, { kind: 'balanceStart', axis: 'h' }),
    note: 'hop of max(0.3, dy + 0.1) m onto a rail: the grind -> manual -> grind line',
  },
  // ---- Bail, GetUp ----
  { id: '38', from: ['Bail'], event: 'timeout', to: 'GetUp', combo: 'none', note: 'tumble animation end (0.6 s)' },
  {
    id: '39', from: ['GetUp'], event: 'timeout', to: 'Grounded', combo: 'none', effects: fx({ kind: 'standUp' }),
    note: 'get-up lockout 0.85 s: Grounded at 0 m/s facing the pre-bail heading',
  },
  // ---- Run clock, pause ----
  {
    id: '40', from: 'alive', event: 'clockZero', to: 'same', combo: 'live', effects: fx({ kind: 'clockFreeze' }),
    note: 'clock freezes at 0:00; the run ends at the next bank or loss (repeats every tick, CR-25)',
  },
  {
    id: '40', from: 'alive', event: 'overtime', to: 'Bail', combo: 'lose',
    effects: bailFx('overtime'), patch: bailPatch('overtime'), note: 'RUN_OVERTIME_MAX_S at 0:00 with a combo alive: forced bail',
  },
  { id: '42', from: 'any', event: 'pause', to: 'same', combo: 'none', note: 'sim ticks stop; documentation row' },
];

/** The table (logic track fills it; order matters: first matching guard wins). */
export const TRANSITIONS: readonly TransitionRow[] = ROWS;

/** Grounded at `tick`, nothing pending. */
export function initialMachine(tick: number): MachineState {
  return {
    state: 'Grounded', enteredTick: tick, pumping: false, landKind: null, revertUsed: false,
    chargeStartTick: null, manual: null, lipExitPending: false, bailReason: null,
  };
}

/** REQ-SM-02: combo alive in Air, Grind, Lip, Manual, RevertWindow, LandWindow. */
export function isComboAliveState(state: SkaterStateName): boolean {
  return COMBO_ALIVE_STATES.includes(state);
}

function fromMatches(from: TransitionRow['from'], state: SkaterStateName): boolean {
  if (from === 'any') return true;
  if (from === 'alive') return isComboAliveState(state);
  return from.includes(state);
}

/** Next MachineState for a row: a fresh state record on a state change, the old one on "same", then the row's patch. */
function nextMachine(row: LogicRow, m: MachineState, e: SmEvent, f: SmFacts): MachineState {
  const base: MachineState = row.to === 'same' ? m : {
    ...initialMachine(f.tick), state: row.to, bailReason: row.to === 'GetUp' ? m.bailReason : null,
  };
  return row.patch ? { ...base, ...row.patch(m, e, f) } : base;
}

/** Pure transition. Never throws for an unmatched event: returns row null and the same state. */
export function transition(machine: MachineState, event: SmEvent, facts: SmFacts): TransitionResult {
  for (const row of ROWS) {
    if (row.event !== event.kind || !fromMatches(row.from, machine.state)) continue;
    if (row.guard && !row.guard(machine, event, facts)) continue;
    return {
      row: row.id,
      prev: machine,
      next: nextMachine(row, machine, event, facts),
      combo: row.combo,
      element: row.element ? row.element(machine, event, facts) : null,
      effects: row.effects ? row.effects(machine, event, facts) : [],
    };
  }
  return { row: null, prev: machine, next: machine, combo: 'none', element: null, effects: [] };
}

/** The timeout event if the current state's timer expired at `tick` (see the header), else null. */
export function timerEvent(machine: MachineState, tick: number, facts: SmFacts): SmEvent | null {
  const n = tick - machine.enteredTick;
  let expired: boolean;
  switch (machine.state) {
    case 'LandWindow':
      expired = n >= (machine.landKind === 'vert' ? ticks(TUNING.REVERT_POST_MS) : ticks(TUNING.MANUAL_LAND_WINDOW_MS));
      break;
    case 'RevertWindow':
      expired = n >= ticks(TUNING.REVERT_TO_MANUAL_MS);
      break;
    case 'Bail':
      expired = n >= ticksS(TUNING.BAIL_TUMBLE_S);
      break;
    case 'GetUp':
      expired = n >= ticksS(TUNING.GETUP_LOCKOUT_S);
      break;
    case 'Lip':
      expired = machine.lipExitPending && n >= ticks(TUNING.LIP_MIN_HOLD_MS);
      break;
    case 'Crouch':
      expired = machine.chargeStartTick !== null && tick - machine.chargeStartTick === ticksS(TUNING.OLLIE_FULL_S);
      break;
    default:
      expired = false;
  }
  return expired ? { kind: 'timeout' } : null;
}

/** Rows that could fire for (state, event kind), in table order (debug overlay, tests). */
export function rowsFor(state: SkaterStateName, event: SmEvent['kind']): readonly TransitionRow[] {
  return ROWS.filter((r) => r.event === event && fromMatches(r.from, state));
}
