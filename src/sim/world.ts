/**
 * src/sim/world.ts (sim track): the SkaterWorld facade. One call = one fixed tick:
 * InputFrame in, SimSnapshot + SimEvents out. Deterministic from (WorldConfig.seed, frames).
 *
 * Tick order (ARCHITECTURE.md "per-tick data flow"):
 *  1. ParserContext from the current state + geometry queries at the current position
 *     (spine transfer, air grind / lip candidate, ground snap candidate, grind types by dir).
 *  2. parseTick (input track) -> actions. Air tricks, enhance, quick spin and Air specials go to
 *     scoring / animation timers directly; every other action becomes an SmEvent.
 *  3. transition() (logic) for each SmEvent; apply its combo effect (scoring), element and effects
 *     (controller pops, snaps, pivots, mirrors; balance start / stop; clock freeze).
 *  4. stepController in the mode the state implies -> physics events. On "contact", call
 *     resolveLanding (input track) and send a contact SmEvent with LandingFacts.
 *  5. Derived events (slowStop, climbSteep, velocityUp, needleOut, clockZero, overtime) ->
 *     transitions. timerEvent() runs at the TOP of the tick, before parsing (decisions below).
 *  6. Balance (balanceInput from frame.dirAxis), special meter (feed with scoring.takeClosed()),
 *     hold accrual, gaps, pickups, NPC triggers, run clock, goals.
 *  7. Build the SimSnapshot (fresh plain objects) and the tick's SimEvents.
 * Imports allowed: core, data, levels/types, input parser + types, logic modules, sim modules.
 *
 * Decisions made here (sim track, M3 / M4; also in the track report):
 * - State timers (LandWindow, RevertWindow, Bail, GetUp, the pending lip exit, Crouch saturation)
 *   are checked at the start of each tick, so a window of N ticks accepts presses at n = 0 .. N - 1
 *   after its anchor and not at n = N (half-open, REQ-TIM-03): R2 170 ms after a vert contact
 *   reverts, 190 ms does not (REQ-TIM-11).
 * - Gap and MacGuffin elements are queued and joined to the combo line when no hold element is
 *   open (grind, lip, manual, a held grab or holdable special): Scoring.addElement closes the open
 *   element, so a gap earned mid-grind would otherwise end the grind's accrual. The "gap" /
 *   "macguffin" splash events fire on the tick they are earned.
 * - comboBanked is emitted only for a combo with at least one element (an ollie with no trick
 *   clears its empty combo silently).
 * - Goals are evaluated in career mode only (main menu "Free Skate: no goals, just the line").
 *   Career runs are 2:00 (REQ-GOL-01); Free Skate defaults to the untimed INT_FREE_SKATE_LENGTH_S
 *   clock (CR-42). WorldConfig.runLengthS overrides both.
 * - Coming down onto a rail, ledge or deck coping inside the magnet snaps a 50-50 with no press
 *   (SIM_AUTO_GRIND, founder playtest 2026-09-23); not the rail this air left, not a coping during a
 *   vert air or after a transfer, never mid-trick.
 * - Feet SIM_KILL_BELOW_M under the level's lowest point = out of the world: a landing bail at the
 *   last safe grounded spot (combo lost), then the usual get-up.
 * - A spine transfer is allowed once per air; Row 5b applies to a buffered snap too (a Triangle
 *   pressed during a flip bails if the magnet catches mid-flip).
 * - teleport() discards the live combo silently (no events) and keeps the special meter.
 * - Polish round 2: the rail an air left is out of the air magnet (pressed, buffered or auto) while
 *   the skater still rises, so pop + Triangle reaches the next rail and cannot farm the same bar; a
 *   buffered Triangle released before its lip snap counts as released on the snap tick (row 25b).
 */

import { add3, cross3, dot3, len3, norm3, scale3, sub3, yawQuat, yawToForward } from '../core/math';
import { createRng } from '../core/rng';
import { hitstopTicks, maxSpeed, ticks, ticksS, tickSeconds, TUNING } from '../core/tuning';
import type {
  BailReason, BalanceView, ComboElementView, GrindTypeId, InputFrame, LandQuality, LandView, LipId,
  ManualId, NpcTalkView, Quat, SimSnapshot, SkaterSnapshot, SkaterStateName, SpecialId, SpeedTier, Stance, TrickVariantId, Vec3,
} from '../core/types';
import { COMBO_ALIVE_STATES, LETTERS } from '../core/types';
import type { SimEvent } from '../core/events';
import { BRANDS } from '../data/brands';
import { goalName } from '../data/goals';
import { getTrick, grindTypeFromDir, lipFromDir, TRICKS, variantId } from '../data/tricks';
import { createParserMemory, parseTick, resolveLanding } from '../input/parser';
import type { ParsedAction, ParserContext, ParserMemory } from '../input/types';
import type { BuiltRail, GapDef } from '../levels/types';
import { balanceInput, driftK, isBalanceBail, startBalance, stepBalance, stopBalance } from './balance';
import { createCollisionWorld } from './collision';
import {
  airNose, applyPop, applyRevertPivot, applySpineTransfer, boardOn, createBody, groundBody, launchBody, popHeight,
  stepController, type BodyState, type ControlIntent, type ControllerEnv, type LaunchInfo, type MovementMode, type PhysicsEvent,
} from './controller';
import { createGapTracker, type EarnedGap, type GapFeed } from './gaps';
import { airPose, allAnimsDone, animLengthTicks, flipPhase, running, type AirAnim, type FlipSnapshotId, type GrabSnapshotId } from './physics/anims';
import { basisQuat, normOr, plain, projectOnPlane, rotateAbout, slopeOf, UP } from './physics/vec';
import { createRailNetwork, grindTypesByDir, railOnToeSide, startGrind, stepGrind, type RailCandidate } from './rails';
import { createRun, goalsOnBank, goalsOnState, runView, stepClock, triggersHit, type RunState } from './run';
import { landQuality, Scoring } from './scoring';
import { createSpecial, emptySpecial, feedSpecial, stepSpecial } from './special';
import { initialMachine, landingBailReason, popCharge, timerEvent, transition } from './stateMachine';
import type {
  BalanceState, ElementRef, ElementSpec, LandingFacts, MachineState, SkaterWorld, SmEffect, SmEvent, SmFacts, SpecialState,
  TransitionResult, WorldConfig, WorldStepResult,
} from './types';

// ---------------------------------------------------------------------------------------------
// Internal records
// ---------------------------------------------------------------------------------------------

interface AirRun {
  readonly startTick: number;
  popped: boolean;
  popTick: number | null;
  readonly crossHeldAtStart: boolean;
  anims: AirAnim[];
  transferTick: number | null;
  /** The rail this air left (rail end, pop, stall hop): never auto-grinds again in this air. */
  leftRail: string | null;
  /** A transfer rail was in reach during this air: the height window no longer applies (DESIGN E.9). */
  transferLatched: boolean;
}

interface GrindRun {
  readonly railId: string;
  readonly rail: BuiltRail;
  type: GrindTypeId;
  readonly onToe: boolean;
  readonly sameObject: boolean;
  typeStartTick: number;
  /** Reached from an air that made a spine transfer (the Woodshed drive gate, MacGuffinDef.needs). */
  readonly afterTransfer: boolean;
}

interface LipRun {
  readonly railId: string;
  readonly lipId: LipId;
  readonly point: Vec3;
  readonly faceNormal: Vec3;
  readonly startTick: number;
}

interface ManualRun {
  readonly startTick: number;
  contextWindow: boolean;
  contextStartTick: number | null;
}

interface SpecialRun {
  readonly id: SpecialId;
  readonly startTick: number;
  /** Presentation seconds held (holdable specials). */
  heldS: number;
  /** 900ms Inference: still dilating and accruing. */
  active: boolean;
}

interface PendingSnap {
  readonly cand: RailCandidate;
  readonly onToe: boolean;
  readonly ground: boolean;
}

interface Internals {
  setSpecialMeter(meter: number): void;
  body(): BodyState;
  machine(): MachineState;
  /** The live needle (drift constant k included), or null off a linker. */
  balance(): BalanceState | null;
}

const INTERNALS = new WeakMap<SkaterWorld, Internals>();

/** Sim-track debug access for tests and the debug driver (not a contract; null for foreign worlds). */
export function simInternals(world: SkaterWorld): Internals | null {
  return INTERNALS.get(world) ?? null;
}

const GROUND_SNAP_STATES: readonly SkaterStateName[] = ['Grounded', 'LandWindow', 'Manual', 'Crouch'];
/** Rows 1b, 9i, 12b: the states that pump a descending transition while Cross is held (REQ-CTL-21). */
const PUMP_STATES: readonly SkaterStateName[] = ['Grounded', 'LandWindow', 'RevertWindow'];
const MACGUFFIN_NPC = { secret_laptop: 'sam', secret_drive: 'dario' } as const;

function holdableRef(ref: ElementRef): boolean {
  if (ref.kind === 'gap') return false;
  const t = getTrick(ref.trickId);
  return t.holdable === true || t.category === 'grind' || t.category === 'manual' || t.category === 'lip';
}

function modeFor(state: SkaterStateName): MovementMode {
  switch (state) {
    case 'Grounded':
    case 'LandWindow':
    case 'RevertWindow':
      return 'ground';
    case 'Crouch':
      return 'crouch';
    case 'Manual':
      return 'manual';
    case 'Air':
      return 'air';
    case 'Grind':
      return 'grind';
    case 'Lip':
      return 'lip';
    case 'Bail':
      return 'bail';
    case 'GetUp':
      return 'getup';
    case 'RunEnd':
      return 'frozen';
  }
}

/**
 * REQ-CAM-04 speed band with hysteresis (polish round 2): a tier is entered SIM_SPEED_TIER_HYST above
 * its threshold and left below the threshold itself, so the top push speed (PUSH_CUTOFF 0.85 of vmax,
 * CR-44, the same ratio as CAM_FOV_KICK_SPEED) no longer flips fast / cruise every few ticks.
 */
function speedTierFor(ratio: number, prev: SpeedTier): SpeedTier {
  const h = TUNING.SIM_SPEED_TIER_HYST;
  if (ratio >= TUNING.CAM_FOV_KICK_SPEED + (prev === 'fast' ? 0 : h)) return 'fast';
  if (ratio >= TUNING.SPEED_TIER_CRUISE_RATIO + (prev === 'slow' ? h : 0)) return 'cruise';
  return 'slow';
}

// ---------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------

export function createWorld(config: WorldConfig): SkaterWorld {
  const level = config.level;
  const collision = createCollisionWorld(level.collider);
  const rails = createRailNetwork(level.rails);
  const gapTracker = createGapTracker(level);
  const rng = createRng(config.seed);
  const goals = level.def.goals;
  const career = config.mode === 'career';
  const scoring = new Scoring();

  let tick = 0;
  let stance: Stance = 'regular';
  let special: SpecialState = createSpecial();
  let balance: BalanceState | null = null;
  let lastNeedle: BalanceState | null = null;
  // Free Skate is untimed (CR-42): its default clock is INT_FREE_SKATE_LENGTH_S, whoever creates the world.
  const runLength = config.runLengthS ?? (config.mode === 'free' ? TUNING.INT_FREE_SKATE_LENGTH_S : TUNING.RUN_LENGTH_S);
  let run: RunState = createRun(level, config.mode, runLength, config.collectedMacGuffins);
  let air: AirRun = { startTick: 0, popped: false, popTick: null, crossHeldAtStart: false, anims: [], transferTick: null, leftRail: null, transferLatched: false };
  let grindRun: GrindRun | null = null;
  let lipRun: LipRun | null = null;
  let manualRun: ManualRun | null = null;
  let specialRun: SpecialRun | null = null;
  let lastGrindRail: string | null = null;
  let chainTravelled = 0;
  let pendingSnap: PendingSnap | null = null;
  let pendingElements: ElementSpec[] = [];
  let openKind: 'grab' | 'linker' | 'special' | null = null;
  let surfacesTouched = new Set<string>();
  let gapIds: string[] = [];
  let specialHeldS: Record<string, number> = {};
  let lastContactOffAxis = 0;
  let lastLand: LandView | null = null;
  let speedTier: SpeedTier = 'slow';
  let bailNose: Vec3 = { x: 0, y: 0, z: -1 };
  let revertTick: number | null = null;
  let started = false;
  let events: SimEvent[] = [];
  let frameNow: InputFrame | null = null;
  let quickSpinsThisTick = 0;
  let railEndPeek = false;
  /** Last flat grounded spot (feet, nose): where a skater who left the world gets up. */
  let safeSpot: { pos: Vec3; nose: Vec3 } | null = null;

  // Spawn: seated on the surface under the spawn point, else in the air.
  let body: BodyState = createBody(level.spawn.pos, level.spawn.yaw);
  let machine: MachineState = initialMachine(0);
  const seated = groundBody(body, collision, TUNING.SIM_TELEPORT_GROUND_M);
  if (seated) body = seated;
  else machine = { ...machine, state: 'Air' };
  let memory: ParserMemory = createParserMemory(machine.state);
  /** The last tick's parse, for the input dev overlay (SkaterWorld.lastParse). */
  let lastParse: { readonly tick: number; readonly actions: readonly ParsedAction[]; readonly memory: ParserMemory } | null = null;

  const emit = (e: SimEvent): void => {
    events.push(e);
  };
  const dt = (): number => tickSeconds();

  const env = (): ControllerEnv => ({ collision, rails, dtS: dt(), tick, glowing: special.glowing, stance, level });

  // ------------------------------------------------------------------ scoring glue

  const comboAlive = (): boolean => scoring.combo !== null;

  const feedMeter = (): void => {
    for (const el of scoring.takeClosed()) {
      const s = feedSpecial(special, el.value + el.accrual);
      special = s.state;
      if (s.becameGlowing) emit({ type: 'specialReady', tick });
    }
  };

  const elementView = (el: { id: ComboElementView['id']; category: ComboElementView['category']; name: string; value: number; accrual: number; open: boolean }): ComboElementView => ({
    id: el.id, category: el.category, name: el.name, value: el.value, accrual: el.accrual, open: el.open,
  });

  const flushPending = (): void => {
    if (pendingElements.length === 0) return;
    const list = pendingElements;
    pendingElements = [];
    for (const spec of list) addNow(spec);
  };

  const addNow = (spec: ElementSpec): void => {
    const el = scoring.addElement(spec, tick);
    openKind = spec.holdable ? (el.category === 'grab' ? 'grab' : el.category === 'special' ? 'special' : 'linker') : null;
    const view = scoring.view();
    emit({ type: 'elementAdded', tick, element: elementView(el), index: (view?.elements.length ?? 1) - 1, combo: view as NonNullable<typeof view> });
    if (el.category !== 'grind' && el.category !== 'gap') gapTracker.feed({ kind: 'element', category: el.category }, tick);
    feedMeter();
  };

  const addElement = (spec: ElementSpec): void => {
    // Queued gaps / MacGuffins join first (they were earned before this element).
    flushPending();
    addNow(spec);
  };

  const closeOpen = (): void => {
    scoring.closeOpen();
    openKind = null;
    flushPending();
    feedMeter();
  };

  const specFor = (ref: ElementRef, extra: Partial<ElementSpec> = {}): ElementSpec => ({ ref, stance, holdable: holdableRef(ref), ...extra });

  const resetComboFacts = (): void => {
    surfacesTouched = new Set();
    gapIds = [];
    specialHeldS = {};
    lastNeedle = null;
    lastGrindRail = null;
    chainTravelled = 0;
  };

  const completeGoals = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (run.goalsCompleted.includes(id)) continue;
      const g = goals.find((x) => x.id === id);
      if (!g) continue;
      run = { ...run, goalsCompleted: [...run.goalsCompleted, id] };
      emit({ type: 'goalCompleted', tick, levelId: level.def.id, goalId: id, name: goalName(g), index: g.index });
    }
  };

  const bankCombo = (): void => {
    flushPending();
    const had = scoring.combo;
    const bank = scoring.bank(tick, lastContactOffAxis);
    openKind = null;
    feedMeter();
    gapTracker.feed({ kind: 'comboEnd' }, tick);
    if (had && bank.elementCount > 0) {
      run = { ...run, score: run.score + bank.final, bestCombo: Math.max(run.bestCombo, bank.final) };
      emit({
        type: 'comboBanked', tick, final: bank.final, base: bank.base, multiplier: bank.multiplier, elementCount: bank.elementCount,
        quality: bank.quality, runScore: run.score,
      });
      if (lastLand) lastLand = { quality: bank.quality, tick: lastLand.tick, final: bank.final };
      if (career) {
        completeGoals(goalsOnBank(goals, run, {
          bank, elements: bank.elements, gapIds: [...gapIds], surfacesTouched: [...surfacesTouched], specialHeldS: { ...specialHeldS },
        }));
      }
    }
    resetComboFacts();
  };

  const loseCombo = (reason: BailReason): void => {
    pendingElements = [];
    const had = scoring.combo;
    const lost = scoring.lose(tick);
    openKind = null;
    if (had) emit({ type: 'comboLost', tick, base: lost.base, multiplier: lost.multiplier, elementCount: lost.elementCount, reason });
    const e = emptySpecial(special);
    special = e.state;
    if (e.stoppedGlowing) emit({ type: 'specialEmptied', tick, reason: 'bail' });
    gapTracker.feed({ kind: 'comboEnd' }, tick);
    resetComboFacts();
  };

  const earnGaps = (earned: readonly EarnedGap[]): void => {
    for (const e of earned) addGap(e.gap);
  };

  const addGap = (gap: GapDef): void => {
    gapIds.push(gap.id);
    emit({ type: 'gap', tick, gapId: gap.id, name: gap.name, base: gap.base });
    const spec: ElementSpec = { ref: { kind: 'gap', gapId: gap.id }, stance, holdable: false, gap: { name: gap.name, base: gap.base } };
    if (openKind !== null) pendingElements.push(spec);
    else addNow(spec);
  };

  const feedGaps = (f: GapFeed): void => {
    earnGaps(gapTracker.feed(f, tick));
  };

  // ------------------------------------------------------------------ air bookkeeping

  const beginAir = (crossHeld: boolean, popped: boolean, leftRail: string | null = null): void => {
    air = { startTick: tick, popped, popTick: popped ? tick : null, crossHeldAtStart: crossHeld, anims: [], transferTick: null, leftRail, transferLatched: false };
  };

  const animsDone = (): boolean => allAnimsDone(air.anims, tick);
  /**
   * The air tricks a landing is judged on. Founder playtest 2 (CR-65): a grab still held at
   * touchdown simply lets go (SIM_GRAB_AUTO_RELEASE), so only flips and specials can land unfinished.
   */
  const landingAnims = (): readonly AirAnim[] =>
    TUNING.SIM_GRAB_AUTO_RELEASE >= 0.5 ? air.anims.filter((a) => !(a.category === 'grab' && a.endTick === null)) : air.anims;

  /** End of an air that did not bail: spin credit and trickLand for each air trick (REQ-VRT-05). */
  const creditAir = (airYawDeg: number): void => {
    const spins = Math.round(Math.abs(airYawDeg) / 180);
    if (spins > 0 && comboAlive()) {
      scoring.addSpins(spins);
      const view = scoring.view();
      if (view) emit({ type: 'comboUpdated', tick, combo: view });
    }
    for (const a of air.anims) emit({ type: 'trickLand', tick, trickId: a.id });
  };

  // ------------------------------------------------------------------ facts and context

  const facts = (frame: InputFrame): SmFacts => ({
    tick,
    speed: len3(body.vel),
    surface: body.surface?.flags ?? null,
    movingUp: body.surface !== null && body.vel.y > 1e-6,
    movingDown: body.surface !== null && body.vel.y < -TUNING.SIM_PUMP_MIN_DESCENT_MPS,
    animsDone: animsDone(),
    crossHeld: frame.held.ollie,
    triangleHeld: frame.held.grind,
    comboAlive: comboAlive(),
    clockZero: run.clockS <= 0,
  });

  const travelDir = (): Vec3 => {
    const h = { x: body.vel.x, y: 0, z: body.vel.z };
    return len3(h) > TUNING.SIM_HEADING_MIN_HSPEED ? norm3(h) : normOr({ x: body.nose.x, y: 0, z: body.nose.z }, yawToForward(body.yaw));
  };

  const toeSideOf = (cand: RailCandidate): boolean => {
    const right = norm3(cross3(travelDir(), UP));
    return railOnToeSide(cand.point, body.pos, right, stance, body.fakie);
  };

  /**
   * Air magnet candidate. The rail this air left (a pop, a stall hop, a rail end) is out of reach
   * while the skater still rises: a Triangle mashed right after popping off a bar re-snapped the
   * same bar 1 tick later, eating the hop to the next rail and farming +1 per tap. After the apex
   * the same rail is fair again (a real hop back onto it, as in THPS).
   */
  const airCandidate = (): RailCandidate | null =>
    rails.query({ pos: body.pos, vel: body.vel, mode: 'air', exclude: body.vel.y > 0 ? air.leftRail : null });

  /**
   * Transfer rail in reach now. Once one has been in reach during this air the height window no
   * longer applies, so R2 works through the whole of a popped air (DESIGN E.9 "any press from
   * launch to the last 0.2 s"; a 1.5 m window left a dead zone around the apex).
   */
  const transferRailNow = (): BuiltRail | null => {
    if (machine.state !== 'Air') return rails.transferRail(body.pos);
    const r = rails.transferRail(body.pos, air.transferLatched ? Number.POSITIVE_INFINITY : TUNING.SPINE_TRANSFER_HEIGHT_M);
    if (r) air.transferLatched = true;
    return r;
  };
  const groundCandidate = (): RailCandidate | null => rails.query({ pos: body.pos, vel: body.vel, mode: 'ground' });

  const parserContext = (): ParserContext => {
    const S = machine.state;
    const cand = S === 'Air' ? airCandidate() : null;
    const ground = GROUND_SNAP_STATES.includes(S) && S !== 'Crouch' ? groundCandidate() : null;
    let byDir = grindTypesByDir(true);
    if (S === 'Grind' && grindRun) byDir = grindTypesByDir(grindRun.onToe);
    else if (cand) byDir = grindTypesByDir(toeSideOf(cand));
    else if (ground) byDir = grindTypesByDir(toeSideOf(ground));
    return {
      state: S,
      glowing: special.glowing,
      speed: len3(body.vel),
      onFlat: body.surface?.flags.flat ?? false,
      landKind: machine.landKind,
      revertUsedThisLanding: machine.revertUsed,
      stateEnteredTick: machine.enteredTick,
      spineTransferAvailable: S === 'Air' && air.transferTick === null && transferRailNow() !== null,
      airGrindCandidate: cand ? (cand.lip ? 'lip' : 'rail') : null,
      groundSnapAvailable: ground !== null,
      grindTypeByDir: byDir,
      currentGrindType: grindRun?.type ?? null,
      ticksSinceLeftSurface: S === 'Air' ? tick - air.startTick : null,
      poppedThisAir: air.popped,
      crossHeldAtLeftSurface: air.crossHeldAtStart,
      charging: machine.chargeStartTick !== null,
      manual: machine.manual,
      rollingFakie: body.fakie,
    };
  };

  // ------------------------------------------------------------------ transitions

  const send = (e: SmEvent, frame: InputFrame): TransitionResult => {
    const r = transition(machine, e, facts(frame));
    if (r.row === null) return r;
    apply(r, e, frame);
    return r;
  };

  const exitReasonGrind = (e: SmEvent): 'pop' | 'railEnd' | 'corner' | 'stall' | 'bail' => {
    if (e.kind === 'crossRelease') return 'pop';
    if (e.kind === 'railEnd') return e.corner ? 'corner' : 'railEnd';
    if (e.kind === 'stall') return 'stall';
    return 'bail';
  };

  /** `travelled`: the distance read before the body left the rail (offLinker / stall hop clear body.grind). */
  const endGrindRun = (reason: 'pop' | 'railEnd' | 'corner' | 'stall' | 'switch' | 'bail' | 'lip', travelled?: number): void => {
    if (!grindRun) return;
    const heldS = (tick - grindRun.typeStartTick) * dt();
    const distanceM = travelled ?? body.grind?.travelled ?? chainTravelled;
    emit({
      type: 'grindEnd', tick, railId: grindRun.railId, railKind: grindRun.rail.kind, grindType: grindRun.type, reason, heldS,
      distanceM, pos: plain(body.pos),
    });
    if (reason !== 'switch') {
      chainTravelled = distanceM;
      feedGaps({ kind: 'grindEnd', railId: grindRun.railId, pos: plain(body.pos), travelledM: chainTravelled });
      grindRun = null;
    }
  };

  const endManualRun = (reason: 'pop' | 'stop' | 'slope' | 'leftSurface' | 'grind' | 'swap' | 'bail', manualId: ManualId | 'context_window'): void => {
    if (!manualRun) return;
    emit({ type: 'manualEnd', tick, manualId, heldS: (tick - manualRun.startTick) * dt(), reason });
    feedGaps({ kind: 'manualEnd', pos: plain(body.pos) });
    if (reason !== 'swap') manualRun = null;
  };

  const exitReasonManual = (e: SmEvent): 'pop' | 'stop' | 'slope' | 'leftSurface' | 'grind' | 'bail' => {
    switch (e.kind) {
      case 'crossRelease':
        return 'pop';
      case 'slowStop':
        return 'stop';
      case 'climbSteep':
        return 'slope';
      case 'leftSurface':
        return 'leftSurface';
      case 'grindTry':
        return 'grind';
      default:
        return 'bail';
    }
  };

  /** A body riding a rail or stalled on a coping put back in the air (rail end, bail off a linker). */
  const offLinker = (frame: InputFrame): void => {
    if (body.grind) {
      const railId = body.grind.railId;
      const launch: LaunchInfo = {
        tick, pos: plain(body.pos), surfaceId: railId, normal: UP, slopeDeg: 0, assisted: false, nose0: plain(body.nose), transition: false,
      };
      body = launchBody(body, body.pos, body.vel, launch, UP);
      beginAir(frame.held.ollie, false, railId);
      feedGaps({ kind: 'airStart', pos: plain(body.pos), surfaceId: launch.surfaceId, tag: 'solid' });
    } else if (lipRun) {
      const pos = add3(lipRun.point, scale3(lipRun.faceNormal, TUNING.LIP_EXIT_OFFSET_M));
      const launch: LaunchInfo = {
        tick, pos, surfaceId: lipRun.railId, normal: lipRun.faceNormal, slopeDeg: slopeOf(lipRun.faceNormal), assisted: false,
        nose0: plain(body.nose), transition: true,
      };
      body = launchBody(body, pos, { x: 0, y: 0, z: 0 }, launch, lipRun.faceNormal);
    }
  };

  const apply = (r: TransitionResult, e: SmEvent, frame: InputFrame): void => {
    const prev = r.prev.state;
    machine = r.next;
    const next = machine.state;
    if (prev !== next) emit({ type: 'stateChanged', tick, from: prev, to: next, row: String(r.row) });

    // Combo effect (elements join before the effects run: balanceStart counts them, REQ-BAL-05).
    switch (r.combo) {
      case 'start':
        scoring.startCombo(tick);
        break;
      case 'startAdd':
      case 'liveAdd':
        if (r.element) addElement(elementSpec(r.element, e));
        break;
      case 'bank':
        bankCombo();
        break;
      case 'bankStartAdd':
        bankCombo();
        if (r.element) addElement(elementSpec(r.element, e));
        break;
      case 'lose':
        loseCombo(machine.bailReason ?? 'landing');
        break;
      default:
        break;
    }

    for (const fx of r.effects) effect(fx, r, e, frame);

    // Linker exit / entry bookkeeping.
    if (prev === 'Grind' && next !== 'Grind') {
      const reason = next === 'Bail' ? 'bail' : exitReasonGrind(e);
      const travelled = body.grind?.travelled;
      if (body.grind) offLinker(frame);
      endGrindRun(reason, travelled);
    }
    if (prev === 'Lip' && next !== 'Lip' && lipRun) {
      if (next === 'Bail') offLinker(frame);
      emit({ type: 'lipEnd', tick, railId: lipRun.railId, lipId: lipRun.lipId, heldS: (tick - lipRun.startTick) * dt(), reason: next === 'Bail' ? 'bail' : 'exit' });
      lipRun = null;
    }
    if (prev === 'Manual' && next !== 'Manual') {
      endContextWindow();
      endManualRun(next === 'Bail' ? 'bail' : exitReasonManual(e), r.prev.manual ?? 'manual');
    }
    if (next === 'Manual' && prev !== 'Manual') {
      manualRun = { startTick: tick, contextWindow: false, contextStartTick: null };
      emit({ type: 'manualStart', tick, manualId: machine.manual ?? 'manual', swap: false, pos: plain(body.pos) });
      feedGaps({ kind: 'manualStart', pos: plain(body.pos) });
    } else if (prev === 'Manual' && next === 'Manual' && e.kind === 'manualSwap') {
      endContextWindow();
      endManualRun('swap', r.prev.manual ?? 'manual');
      if (manualRun) manualRun = { ...manualRun, startTick: tick };
      emit({ type: 'manualStart', tick, manualId: machine.manual ?? 'manual', swap: true, pos: plain(body.pos) });
    } else if (prev === 'Manual' && next === 'Manual' && e.kind === 'special' && manualRun) {
      manualRun.contextWindow = true;
      manualRun.contextStartTick = tick;
      specialRun = { id: 'context_window', startTick: tick, heldS: 0, active: true };
      emit({ type: 'specialUsed', tick, specialId: 'context_window' });
      emit({ type: 'manualStart', tick, manualId: 'context_window', swap: false, pos: plain(body.pos) });
    }
    if (next === 'Air' && prev !== 'Air' && prev !== 'Grind' && prev !== 'Lip' && !r.effects.some((f) => f.kind === 'pop')) {
      // Rolled off an edge (rows 9h, 33b, 37, 37b): the air began in the controller this tick.
      if (air.startTick !== tick) beginAir(frame.held.ollie, false);
    }
    if (next === 'Bail' || next === 'GetUp' || next === 'Grounded' || next === 'RunEnd') {
      if (prev === 'Air' || prev === 'Grind' || prev === 'Lip') specialRun = null;
    }
  };

  const elementSpec = (ref: ElementRef, e: SmEvent): ElementSpec => {
    const base = specFor(ref);
    if (ref.kind === 'trick' && (getTrick(ref.trickId).category === 'grind' || ref.trickId === 'gpu_slide')) {
      const railId = e.kind === 'grindTry' ? e.railId : grindRun?.railId;
      return railId ? { ...base, railId } : base;
    }
    return base;
  };

  const endContextWindow = (): void => {
    if (!manualRun?.contextWindow) return;
    manualRun.contextWindow = false;
    if (specialRun?.id === 'context_window') {
      specialHeldS.context_window = Math.max(specialHeldS.context_window ?? 0, specialRun.heldS);
      specialRun = null;
    }
    if (openKind === 'special') closeOpen();
  };

  const startNeedle = (axis: 'h' | 'v', sameObject: boolean): void => {
    const count = scoring.combo?.elements.length ?? 1;
    const k = driftK({ elementsBefore: Math.max(0, count - 1), sameObject, switchStance: stance === 'switch' });
    balance = startBalance(lastNeedle, axis, k, rng);
    lastNeedle = balance;
  };

  const effect = (fx: SmEffect, r: TransitionResult, e: SmEvent, frame: InputFrame): void => {
    const prev = r.prev.state;
    switch (fx.kind) {
      case 'pop': {
        const from = prev;
        const wasAir = from === 'Air';
        const heightM = popHeight(fx.charge, stance);
        if (from === 'Manual') endContextWindow();
        const at = plain(body.pos);
        body = applyPop(body, fx.charge, env());
        if (wasAir) {
          air.popped = true;
          air.popTick = tick;
        } else {
          beginAir(frame.held.ollie, true, from === 'Grind' ? (grindRun?.railId ?? null) : null);
          const launch = body.launch;
          feedGaps({ kind: 'airStart', pos: at, surfaceId: launch?.surfaceId ?? '', tag: launch?.transition ? 'transition' : 'solid' });
        }
        emit({ type: 'pop', tick, heightM, charge: fx.charge, from, pos: at });
        break;
      }
      case 'grindSnap':
        if (prev === 'Air' && pendingSnap) startGrindRun(pendingSnap, e);
        else if (grindRun && (e.kind === 'grindSwitch' || e.kind === 'special')) {
          const to: GrindTypeId = e.kind === 'grindSwitch' ? e.grindType : 'gpu_slide';
          const from = grindRun.type;
          if (from === 'gpu_slide' && specialRun?.id === 'gpu_slide') {
            specialHeldS.gpu_slide = Math.max(specialHeldS.gpu_slide ?? 0, specialRun.heldS);
            specialRun = null;
          }
          endGrindRun('switch');
          emit({ type: 'grindSwitch', tick, railId: grindRun.railId, railKind: grindRun.rail.kind, from, to, pos: plain(body.pos) });
          grindRun.type = to;
          grindRun.typeStartTick = tick;
          if (to === 'gpu_slide') {
            specialRun = { id: 'gpu_slide', startTick: tick, heldS: 0, active: true };
            emit({ type: 'specialUsed', tick, specialId: 'gpu_slide' });
          }
        }
        break;
      case 'groundSnapHop':
        if (pendingSnap) startGrindRun(pendingSnap, e);
        break;
      case 'lipSnap':
        if (pendingSnap) startLipRun(pendingSnap, e);
        break;
      case 'revertPivot': {
        stance = stance === 'regular' ? 'switch' : 'regular';
        body = applyRevertPivot(body);
        revertTick = tick;
        emit({ type: 'revert', tick, stance, pos: plain(body.pos) });
        break;
      }
      case 'spineMirror': {
        if (e.kind !== 'spineTransfer') break;
        const rail = rails.byId(e.railId);
        if (!rail?.transferPlane) break;
        body = applySpineTransfer(body, rail.transferPlane);
        air.transferTick = tick;
        emit({ type: 'transfer', tick, railId: rail.id, pos: plain(body.pos) });
        feedGaps({ kind: 'transfer', railId: rail.id });
        break;
      }
      case 'lipExit':
        lipExit(frame);
        break;
      case 'stallHop': {
        if (!body.grind) break;
        const railId = body.grind.railId;
        const travelled = body.grind.travelled;
        const launch: LaunchInfo = {
          tick, pos: plain(body.pos), surfaceId: railId, normal: UP, slopeDeg: 0, assisted: false, nose0: plain(body.nose), transition: false,
        };
        const v = add3(body.vel, scale3(UP, Math.sqrt(2 * TUNING.GRAVITY * TUNING.GRIND_EXIT_POP_M)));
        body = launchBody(body, body.pos, v, launch, UP);
        endGrindRun('stall', travelled);
        beginAir(frame.held.ollie, false, railId);
        feedGaps({ kind: 'airStart', pos: plain(body.pos), surfaceId: launch.surfaceId, tag: 'solid' });
        break;
      }
      case 'railClamp':
        if (body.grind) body = { ...body, grind: { ...body.grind, speed: body.grind.speed * TUNING.WALL_SLIDE_RETAIN } };
        break;
      case 'balanceStart': {
        const sameObject = fx.axis === 'h' && grindRun !== null && prev === 'Grind' ? grindRun.sameObject : pendingSameObject;
        startNeedle(fx.axis, fx.axis === 'h' ? sameObject : false);
        break;
      }
      case 'balanceStop':
        if (balance) {
          balance = stopBalance(balance);
          lastNeedle = balance;
          balance = null;
        }
        closeOpen();
        break;
      case 'bailStart': {
        bailNose = plain(body.nose);
        emit({ type: 'bail', tick, reason: fx.reason, speed: len3(body.vel), pos: plain(body.pos) });
        balance = null;
        specialRun = null;
        air.anims = [];
        break;
      }
      case 'standUp': {
        const standing = groundBody({ ...body, vel: { x: 0, y: 0, z: 0 }, nose: normOr({ x: bailNose.x, y: 0, z: bailNose.z }, body.nose) }, collision, TUNING.GROUND_PROBE_M + 1);
        body = standing ?? { ...body, vel: { x: 0, y: 0, z: 0 } };
        break;
      }
      case 'clockFreeze':
        run = { ...run, frozen: true };
        break;
      case 'runEnd':
        endRun();
        break;
      default:
        break;
    }
  };

  let pendingSameObject = false;

  const startGrindRun = (p: PendingSnap, e: SmEvent): void => {
    const cand = p.cand;
    const grindType: GrindTypeId = e.kind === 'grindTry' ? e.grindType : 'fifty_fifty';
    creditAir(body.airYawDeg);
    const continuing = lastGrindRail === cand.rail.id;
    const motion0 = startGrind(cand, body.vel);
    const motion = continuing ? { ...motion0, travelled: chainTravelled } : motion0;
    if (!continuing) chainTravelled = 0;
    const tan = cand.tangent;
    const nose = dot3(body.nose, tan) >= 0 ? tan : scale3(tan, -1);
    const from = plain(body.pos);
    const dyBoard = cand.point.y - body.pos.y;
    const hopM = p.ground ? Math.max(TUNING.GRIND_GROUND_SNAP_HOP_MIN_M, dyBoard + TUNING.GRIND_GROUND_SNAP_CLEAR_M) : 0;
    body = {
      ...body, grind: motion, surface: null, launch: null, vel: plain(scale3(tan, motion.speed)), nose: plain(nose), up: UP, airYawDeg: 0,
      quickSpinDeg: 0, fakie: dot3(nose, tan) < 0, snap: { from, tick0: tick, ticks: Math.max(1, ticks(TUNING.GRIND_SNAP_BLEND_MS)), hopM },
    };
    grindRun = {
      railId: cand.rail.id, rail: cand.rail, type: grindType, onToe: p.onToe, sameObject: pendingSameObject, typeStartTick: tick,
      afterTransfer: !p.ground && air.transferTick !== null,
    };
    lastGrindRail = cand.rail.id;
    air.anims = [];
    emit({ type: 'grindStart', tick, railId: cand.rail.id, railKind: cand.rail.kind, grindType, pos: plain(boardOn(cand.point)), speed: motion.speed });
    feedGaps({ kind: 'grindStart', railId: cand.rail.id, pos: plain(cand.point) });
  };

  const lipFace = (cand: RailCandidate): Vec3 => {
    const tan = cand.tangent;
    let out = normOr({ x: -tan.z, y: 0, z: tan.x }, { x: 0, y: 0, z: 1 });
    const launchN = body.launch?.normal;
    const side = launchN && Math.hypot(launchN.x, launchN.z) > TUNING.SIM_LIP_LAUNCH_HORIZ_MIN ? dot3(launchN, out) : dot3(sub3(body.pos, cand.point), out);
    if (side < 0) out = scale3(out, -1);
    // Refine with the real face just below the coping.
    const probeFrom = add3(add3(cand.point, scale3(out, TUNING.SIM_LIP_FACE_PROBE_OUT_M)), { x: 0, y: -TUNING.SIM_LIP_FACE_PROBE_DROP_M, z: 0 });
    const probe = collision.raycast(probeFrom, scale3(out, -1), TUNING.SIM_LIP_FACE_PROBE_REACH_M);
    if (probe && probe.front !== false && probe.tag === 'transition') return plain(probe.normal);
    return out;
  };

  const startLipRun = (p: PendingSnap, e: SmEvent): void => {
    const cand = p.cand;
    const lipId: LipId = e.kind === 'grindTry' ? e.lipId : 'axle_stall';
    creditAir(body.airYawDeg);
    const faceNormal = lipFace(cand);
    lipRun = { railId: cand.rail.id, lipId, point: plain(cand.point), faceNormal, startTick: tick };
    body = { ...body, pos: plain(boardOn(cand.point)), vel: { x: 0, y: 0, z: 0 }, grind: null, surface: null, airYawDeg: 0, quickSpinDeg: 0, snap: null };
    air.anims = [];
    emit({ type: 'lipStart', tick, railId: cand.rail.id, lipId, pos: plain(body.pos) });
  };

  const lipExit = (frame: InputFrame): void => {
    if (!lipRun) return;
    const n = lipRun.faceNormal;
    const faceDown = normOr(projectOnPlane({ x: 0, y: -1, z: 0 }, n), { x: 0, y: -1, z: 0 });
    const pos = add3(lipRun.point, scale3(n, TUNING.LIP_EXIT_OFFSET_M));
    const vel = add3(scale3(faceDown, TUNING.LIP_EXIT_SPEED), scale3(UP, 0.5 * Math.sqrt(2 * TUNING.GRAVITY * TUNING.LIP_EXIT_POP_M)));
    const nose0 = getTrick(lipRun.lipId).exitsFakie ? scale3(faceDown, -1) : faceDown;
    const launch: LaunchInfo = { tick, pos, surfaceId: lipRun.railId, normal: n, slopeDeg: slopeOf(n), assisted: false, nose0, transition: true };
    body = launchBody(body, pos, vel, launch, n);
    beginAir(frame.held.ollie, false);
    feedGaps({ kind: 'airStart', pos: plain(pos), surfaceId: lipRun.railId, tag: 'transition' });
  };

  const endRun = (): void => {
    if (run.ended) return;
    if (career) completeGoals(goalsOnState(goals, run, true));
    run = { ...run, ended: true, frozen: true };
    emit({
      type: 'runEnd', tick, levelId: level.def.id, mode: run.mode, score: run.score, bestCombo: run.bestCombo, goalsCompleted: [...run.goalsCompleted],
      letters: LETTERS.filter((l) => run.letters[l]), macguffin: run.macguffinCollected,
    });
  };

  // ------------------------------------------------------------------ actions

  const tryGrind = (a: Extract<ParsedAction, { kind: 'grindTry' }>, frame: InputFrame): void => {
    // Founder playtest 2 (CR-65): Triangle during a flip or grab waits for the trick to finish (the
    // parser keeps retrying inside GRIND_PREBUFFER_MS) instead of bailing on row 5b.
    if (!a.ground && machine.state === 'Air' && TUNING.SIM_GRIND_WAITS_FOR_TRICK >= 0.5 && !animsDone()) return;
    const cand = a.ground ? groundCandidate() : airCandidate();
    if (!cand) return;
    const onToe = toeSideOf(cand);
    pendingSnap = { cand, onToe, ground: a.ground };
    pendingSameObject = lastGrindRail === cand.rail.id && comboAlive();
    send({
      kind: 'grindTry', candidate: cand.lip ? 'lip' : 'rail', ground: a.ground, railId: cand.rail.id,
      grindType: grindTypeFromDir(a.dir, onToe), lipId: lipFromDir(a.dir),
    }, frame);
    pendingSnap = null;
    // A buffered Triangle released before the lip snapped: its release edge fell in Air and matched
    // no row, so the stall waited for Cross or the needle. Treat it as released now (row 25b), so a
    // tap still exits at LIP_MIN_HOLD_MS (DESIGN E.4).
    if (machine.state === 'Lip' && lipRun?.startTick === tick && !frame.held.grind && !machine.lipExitPending) {
      send({ kind: 'triangleRelease' }, frame);
    }
  };

  const airTrick = (a: Extract<ParsedAction, { kind: 'trick' }>): void => {
    if (machine.state !== 'Air') return;
    const cat = a.button === 'flip' ? 'flip' : 'grab';
    if (cat === 'flip' && (running(air.anims, tick, 'flip') || running(air.anims, tick, 'special'))) return;
    if (cat === 'grab' && running(air.anims, tick, 'grab')) return;
    addElement(specFor({ kind: 'trick', trickId: a.trickId }, { nollie: a.nollie, fakie: a.fakie }));
    const id = variantId(a.trickId, { switchStance: stance === 'switch', nollie: a.nollie, fakie: !a.nollie && a.fakie });
    const len = cat === 'flip' ? animLengthTicks(a.trickId) : 0;
    air.anims.push({ id, base: a.trickId, category: cat, startTick: tick, endTick: cat === 'flip' ? tick + len : null, releaseTick: null, nollie: a.nollie, fakie: a.fakie });
    emit({ type: 'trickStart', tick, trickId: id, category: cat, animMs: cat === 'flip' ? (getTrick(a.trickId).animMs ?? null) : null });
  };

  const enhance = (a: Extract<ParsedAction, { kind: 'enhance' }>): void => {
    if (machine.state !== 'Air') return;
    const plainId = TRICKS[a.trickId].enhancedOf;
    const anim = [...air.anims].reverse().find((x) => x.base === plainId);
    const last = scoring.combo?.elements.at(-1);
    if (!anim || !last || last.baseId !== plainId) return;
    scoring.replaceLast(specFor({ kind: 'trick', trickId: a.trickId }, { nollie: anim.nollie, fakie: anim.fakie }), tick);
    const id = variantId(a.trickId, { switchStance: stance === 'switch', nollie: anim.nollie, fakie: !anim.nollie && anim.fakie });
    anim.id = id;
    anim.base = a.trickId;
    if (anim.category === 'flip') anim.endTick = anim.startTick + animLengthTicks(a.trickId);
    const view = scoring.view();
    if (view) emit({ type: 'comboUpdated', tick, combo: view });
    emit({ type: 'trickStart', tick, trickId: id, category: anim.category, animMs: anim.category === 'flip' ? (getTrick(a.trickId).animMs ?? null) : null });
  };

  const airSpecial = (id: SpecialId): void => {
    if (machine.state !== 'Air' || running(air.anims, tick, 'special')) return;
    addElement(specFor({ kind: 'trick', trickId: id }));
    const holdable = getTrick(id).holdable === true;
    air.anims.push({
      id: variantId(id, { switchStance: stance === 'switch' }), base: id, category: 'special', startTick: tick,
      endTick: holdable ? null : tick + animLengthTicks(id), releaseTick: null, nollie: false, fakie: false,
    });
    specialRun = { id, startTick: tick, heldS: 0, active: holdable };
    emit({ type: 'specialUsed', tick, specialId: id });
    emit({ type: 'trickStart', tick, trickId: variantId(id, { switchStance: stance === 'switch' }), category: 'special', animMs: holdable ? null : (getTrick(id).animMs ?? null) });
  };

  const handleAction = (a: ParsedAction, frame: InputFrame): void => {
    switch (a.kind) {
      case 'trick':
        airTrick(a);
        break;
      case 'enhance':
        enhance(a);
        break;
      case 'quickSpin':
        if (machine.state === 'Air') quickSpinsThisTick += a.deg > 0 ? 1 : -1;
        break;
      case 'special':
        if (getTrick(a.specialId).specialState === 'Air') airSpecial(a.specialId);
        else send({ kind: 'special', specialId: a.specialId }, frame);
        break;
      case 'revert':
        send({ kind: 'revertPress' }, frame);
        break;
      case 'spineTransfer': {
        const rail = transferRailNow();
        if (rail && air.transferTick === null) send({ kind: 'spineTransfer', railId: rail.id }, frame);
        break;
      }
      case 'grindSwitch':
        // REQ-SM-06: a rail end on the same tick wins; the switch press is dropped.
        if (!railEndPeek) send({ kind: 'grindSwitch', grindType: a.grindType }, frame);
        break;
      case 'grindTry':
        tryGrind(a, frame);
        break;
      case 'crossPress':
        send({ kind: 'crossPress' }, frame);
        break;
      case 'crossRelease':
        send({ kind: 'crossRelease' }, frame);
        break;
      case 'coyotePop':
        send({ kind: 'coyotePop' }, frame);
        break;
      case 'manualEntry':
        send({ kind: 'manualEntry', manual: a.manual }, frame);
        break;
      case 'manualLand':
        send({ kind: 'manualLand', manual: a.manual }, frame);
        break;
      case 'revertManual':
        send({ kind: 'revertManual', manual: a.manual }, frame);
        break;
      case 'manualSwap':
        send({ kind: 'manualSwap', manual: a.manual }, frame);
        break;
      case 'triangleRelease':
        if (machine.state === 'Manual') endContextWindow();
        send({ kind: 'triangleRelease' }, frame);
        break;
      case 'revertBuffered':
        break;
    }
  };

  /** Held-button bookkeeping: grab release, 900ms Inference hold, Context Window release. */
  const heldUpdates = (frame: InputFrame): void => {
    for (const a of air.anims) {
      if (a.endTick !== null) continue;
      if (a.category === 'grab' && !frame.held.grab) {
        a.releaseTick = tick;
        a.endTick = tick + ticks(TUNING.GRAB_RELEASE_BEFORE_LAND_MS);
        if (openKind === 'grab') closeOpen();
      }
    }
    if (specialRun?.id === 'inference_900ms' && specialRun.active) {
      const stillHeld = frame.held.grab || specialRun.heldS * 1000 < TUNING.INFERENCE_MIN_HOLD_MS;
      if (!stillHeld) {
        specialRun.active = false;
        specialHeldS.inference_900ms = Math.max(specialHeldS.inference_900ms ?? 0, specialRun.heldS);
        const anim = air.anims.find((x) => x.base === 'inference_900ms' && x.endTick === null);
        if (anim) {
          anim.releaseTick = tick;
          anim.endTick = tick + ticks(TUNING.GRAB_RELEASE_BEFORE_LAND_MS);
        }
        if (openKind === 'special') closeOpen();
      }
    }
  };

  /**
   * Coming down onto a rail (SIM_AUTO_GRIND, founder playtest 2026-09-23): in the air, descending,
   * feet at or above the rail, inside the magnet at an entry angle the magnet accepts: a 50-50 with
   * no press (row 5). Skipped mid-trick (row 5b would bail), for the rail this air left, and for a
   * coping during a vert air or a transfer (that air comes back down its own face).
   */
  const autoGrind = (frame: InputFrame): void => {
    if (TUNING.SIM_AUTO_GRIND < 0.5 || machine.state !== 'Air' || body.vel.y >= 0 || !animsDone()) return;
    const cand = airCandidate();
    if (!cand || cand.lip || cand.rail.id === air.leftRail || body.pos.y < cand.point.y) return;
    if (cand.kind === 'coping' && (body.launch?.assisted === true || body.transferred)) return;
    const onToe = toeSideOf(cand);
    pendingSnap = { cand, onToe, ground: false };
    pendingSameObject = lastGrindRail === cand.rail.id && comboAlive();
    send({ kind: 'grindTry', candidate: 'rail', ground: false, railId: cand.rail.id, grindType: grindTypeFromDir('N', onToe), lipId: lipFromDir('N') }, frame);
    pendingSnap = null;
  };

  /** Lowest point of the level (bounds of everything built) less SIM_KILL_BELOW_M. */
  const killY = (): number => level.bounds.min.y - TUNING.SIM_KILL_BELOW_M;

  /**
   * Out of the world (feet below killY in the air): the body is put back on the last safe grounded
   * spot (else the spawn) and the air ends as a landing bail there, so the combo is lost and the
   * usual tumble and get-up follow.
   */
  const outOfWorld = (frame: InputFrame): void => {
    if (machine.state !== 'Air' || body.pos.y >= killY()) return;
    const spot = safeSpot ?? { pos: level.spawn.pos, nose: yawToForward(level.spawn.yaw) };
    const b0: BodyState = { ...createBody(spot.pos, Math.atan2(-spot.nose.x, -spot.nose.z)), nose: plain(spot.nose) };
    const placed = groundBody(b0, collision, TUNING.SIM_TELEPORT_GROUND_M);
    if (!placed) return;
    body = placed;
    const lf: LandingFacts = {
      vert: false, flat: true, slopeDeg: 0, offAxisDeg: 90, tiltDeg: 0, animsDone: true, crossHeld: false, manualPair: null, revertBuffered: false,
    };
    send({ kind: 'contact', landing: lf }, frame);
    air.anims = [];
  };

  // ------------------------------------------------------------------ physics events

  const landing = (pe: Extract<PhysicsEvent, { kind: 'contact' }>, frame: InputFrame): void => {
    const flags = pe.contact.flags;
    const kind = flags.vertLanding ? 'vert' : 'flat';
    const linkers = resolveLanding(frame, memory, tick, kind);
    memory = linkers.memory;
    const lf: LandingFacts = {
      vert: flags.vertLanding, flat: flags.flat, slopeDeg: flags.slopeDeg, offAxisDeg: pe.offAxisDeg, tiltDeg: pe.tiltDeg,
      // Founder playtest 2026-09-23 (DESIGN L CR-43): a flip or a released grab that finishes within
      // SIM_LAND_ANIM_GRACE_MS after contact still lands (a trick started near the apex).
      animsDone: allAnimsDone(landingAnims(), tick + ticks(TUNING.SIM_LAND_ANIM_GRACE_MS)), crossHeld: frame.held.ollie,
      manualPair: linkers.manualPair, revertBuffered: linkers.revertBuffered,
    };
    const clean = landingBailReason(lf) === null;
    if (clean) {
      creditAir(pe.airYawDeg ?? 0);
      lastContactOffAxis = pe.offAxisDeg;
      const quality: LandQuality = landQuality(pe.offAxisDeg, 0);
      // Rows 8, 12b (the state machine's pumpLanding): Cross held into a descending transition pumps.
      const pumpLand = flags.transition && (flags.flat ? body.vel.y < -TUNING.SIM_PUMP_MIN_DESCENT_MPS : body.vel.y <= 1e-6);
      const linker = lf.flat && lf.manualPair ? 'manual' : lf.vert && lf.revertBuffered ? 'revert' : lf.crossHeld && lf.flat && !pumpLand ? 'crouch' : 'none';
      lastLand = { quality, tick, final: 0 };
      emit({ type: 'land', tick, quality, offAxisDeg: pe.offAxisDeg, tiltDeg: pe.tiltDeg, vert: lf.vert, speed: pe.speed, pos: plain(pe.contact.point), linker });
      if (comboAlive()) surfacesTouched.add(pe.contact.surfaceId);
      feedGaps({ kind: 'land', pos: plain(pe.contact.point), surfaceId: pe.contact.surfaceId, tag: flags.tag });
    }
    send({ kind: 'contact', landing: lf }, frame);
    if (machine.state !== 'Air') air.anims = [];
  };

  const handlePhysics = (pe: PhysicsEvent, frame: InputFrame): void => {
    switch (pe.kind) {
      case 'contact':
        if (machine.state === 'Air') landing(pe, frame);
        break;
      case 'leftSurface': {
        const S = machine.state;
        if (S === 'Bail' || S === 'GetUp' || S === 'RunEnd') break;
        beginAir(frame.held.ollie, false);
        feedGaps({ kind: 'airStart', pos: plain(pe.launch.pos), surfaceId: pe.launch.surfaceId, tag: pe.launch.transition ? 'transition' : 'solid' });
        send({ kind: 'leftSurface' }, frame);
        break;
      }
      case 'railEnd':
        if (machine.state === 'Grind') send({ kind: 'railEnd', corner: pe.corner }, frame);
        break;
      case 'stall':
        if (machine.state === 'Grind') send({ kind: 'stall' }, frame);
        break;
      case 'wallHit':
        send({ kind: 'wallHit', headOn: pe.headOn, speed: pe.speed, incidenceDeg: pe.incidenceDeg }, frame);
        break;
      case 'push':
        emit({ type: 'push', tick, pos: plain(body.pos) });
        break;
      case 'apex':
        break;
    }
  };

  // ------------------------------------------------------------------ per-tick systems

  const intentFor = (frame: InputFrame): ControlIntent => {
    const S = machine.state;
    const pushBrake = S === 'Grounded' || S === 'LandWindow';
    const steerOk = S === 'Grounded' || S === 'LandWindow' || S === 'RevertWindow' || S === 'Crouch' || S === 'Manual' || S === 'Air';
    return {
      steer: steerOk ? frame.dirAxis.x : 0,
      throttle: pushBrake ? frame.dirAxis.y : 0,
      pump: PUMP_STATES.includes(S) && machine.pumping && frame.held.ollie,
      quickSpins: quickSpinsThisTick,
      spinHeld: S === 'Air' ? (frame.held.spinR ? 1 : frame.held.spinL ? -1 : 0) : 0,
      look: frame.look,
    };
  };

  const derived = (frame: InputFrame): void => {
    const S = machine.state;
    const speed = len3(body.vel);
    if (S === 'Manual' && body.surface) {
      if (speed < TUNING.MANUAL_MIN_SPEED) send({ kind: 'slowStop' }, frame);
      // Row 31 (polish round 2): only a bank ends a climbing manual; up a transition the manual rides
      // on and leaves the lip into the air with the combo alive (row 33b), as the G.1 / G.2 lines chain.
      else if (!body.surface.flags.transition && body.surface.flags.slopeDeg >= TUNING.FLAT_MAX_SLOPE_DEG && body.vel.y > 1e-6) send({ kind: 'climbSteep' }, frame);
    }
    if (PUMP_STATES.includes(machine.state) && machine.pumping && frame.held.ollie && body.surface && body.vel.y > 1e-6) send({ kind: 'velocityUp' }, frame);
    if (run.clockS <= 0 && !run.ended && machine.state !== 'RunEnd') send({ kind: 'clockZero' }, frame);
  };

  const needleTick = (frame: InputFrame): void => {
    if (!balance?.active) return;
    const cw = manualRun?.contextWindow === true && frame.held.grind;
    balance = stepBalance(balance, balanceInput(balance.axis, frame.dirAxis), dt(), cw);
    lastNeedle = balance;
    if (isBalanceBail(balance)) send({ kind: 'needleOut' }, frame);
  };

  const accrueTick = (frame: InputFrame): void => {
    const S = machine.state;
    const scale = TUNING.INFERENCE_TIME_SCALE;
    if (specialRun) {
      const pres = specialRun.id === 'inference_900ms' ? dt() / scale : dt();
      if (specialRun.active && (specialRun.id !== 'context_window' || frame.held.grind)) specialRun.heldS += pres;
      if (specialRun.id === 'gpu_slide' && grindRun?.type === 'gpu_slide') specialHeldS.gpu_slide = Math.max(specialHeldS.gpu_slide ?? 0, specialRun.heldS);
      if (specialRun.id === 'context_window') specialHeldS.context_window = Math.max(specialHeldS.context_window ?? 0, specialRun.heldS);
      if (specialRun.id === 'inference_900ms') specialHeldS.inference_900ms = Math.max(specialHeldS.inference_900ms ?? 0, specialRun.heldS);
    }
    if (openKind === null) return;
    if (S === 'Grind' || S === 'Lip' || S === 'Manual') scoring.accrue(dt());
    else if (S === 'Air' && openKind === 'grab') scoring.accrue(dt());
    else if (S === 'Air' && openKind === 'special' && specialRun?.id === 'inference_900ms' && specialRun.active) scoring.accrue(dt() / scale);
  };

  const specialTick = (): void => {
    const s = stepSpecial(special, dt(), comboAlive());
    special = s.state;
    if (s.becameGlowing) emit({ type: 'specialReady', tick });
    if (s.stoppedGlowing) emit({ type: 'specialEmptied', tick, reason: 'drain' });
  };

  const gapSamples = (): void => {
    const S = machine.state;
    if (S === 'Air') feedGaps({ kind: 'airSample', pos: plain(body.pos) });
    else if (S === 'Grind' && grindRun && body.grind) feedGaps({ kind: 'grindSample', railId: grindRun.railId, pos: plain(body.pos), travelledM: body.grind.travelled });
    else if (S === 'Manual') feedGaps({ kind: 'manualSample', pos: plain(body.pos) });
    else if ((S === 'LandWindow' || S === 'RevertWindow') && body.surface) feedGaps({ kind: 'groundContact', surfaceId: body.surface.surfaceId });
    if (body.surface && comboAlive()) surfacesTouched.add(body.surface.surfaceId);
  };

  const collectMacGuffin = (id: 'secret_laptop' | 'secret_drive', pos: Vec3): void => {
    run = { ...run, macguffinCollected: true };
    const brand = BRANDS.macguffins[id];
    emit({
      type: 'macguffin', tick, id, name: brand.name, splash: brand.splash, toast: BRANDS.npcs[MACGUFFIN_NPC[id]].toast,
      hitstopTicks: hitstopTicks(), pos: plain(pos),
    });
    emit({ type: 'pickup', tick, kind: 'macguffin', id, pos: plain(pos) });
    const spec = specFor({ kind: 'trick', trickId: id });
    if (COMBO_ALIVE_STATES.includes(machine.state)) {
      if (openKind !== null) pendingElements.push(spec);
      else addElement(spec);
    } else {
      // Picked up while no combo is alive: it banks on its own (+1, 2500, REQ-SCR-06).
      scoring.startCombo(tick);
      addElement(spec);
      bankCombo();
    }
  };

  /** MacGuffinDef.needs: a transfer gate opens only in a transfer air or on a grind that air reached. */
  const macguffinGateOpen = (): boolean => {
    if (!level.def.macguffin?.needs?.transferInAir) return true;
    if (machine.state === 'Air') return air.transferTick !== null;
    return machine.state === 'Grind' && grindRun?.afterTransfer === true;
  };

  const triggerTick = (): void => {
    const hits = triggersHit(level.triggers, body.pos);
    let npc: { id: 'sam' | 'dario' } | null = null;
    for (const t of hits) {
      if (t.kind === 'letter') {
        const letter = t.ref as (typeof LETTERS)[number];
        if (!run.letters[letter]) {
          run = { ...run, letters: { ...run.letters, [letter]: true } };
          emit({ type: 'letter', tick, letter, collected: LETTERS.filter((l) => run.letters[l]), pos: plain(t.center) });
          emit({ type: 'pickup', tick, kind: 'letter', id: letter, pos: plain(t.center) });
        }
      } else if (t.kind === 'macguffin') {
        if (!run.macguffinCollected && (t.ref === 'secret_laptop' || t.ref === 'secret_drive') && macguffinGateOpen()) collectMacGuffin(t.ref, t.center);
      } else if (t.kind === 'npcTalk' && (t.ref === 'sam' || t.ref === 'dario')) {
        npc = { id: t.ref };
      }
    }
    if (npc) {
      if (!run.npcInside || run.npcInside.id !== npc.id) {
        run = { ...run, npcInside: { id: npc.id, sinceTick: tick } };
        const b = BRANDS.npcs[npc.id];
        emit({ type: 'npcTalk', tick, npcId: npc.id, name: b.name, line: b.line });
      }
    } else if (run.npcInside) {
      run = { ...run, npcInside: null };
    }
    if (career) completeGoals(goalsOnState(goals, run, false));
  };

  const clockTick = (frame: InputFrame): void => {
    const inference = specialRun?.id === 'inference_900ms' && specialRun.active;
    const c = stepClock(run, dt(), inference, comboAlive() && COMBO_ALIVE_STATES.includes(machine.state));
    run = c.run;
    if (c.secondTick !== null) emit({ type: 'runTick', tick, secondsLeft: c.secondTick });
    if (c.overtimeExpired) send({ kind: 'overtime' }, frame);
  };

  // ------------------------------------------------------------------ snapshot

  const needle01 = (): number => (balance ? (balance.needle + 1) / 2 : 0.5);

  const skaterSnapshot = (): SkaterSnapshot => {
    const S = machine.state;
    const n = tick - machine.enteredTick;
    const speed = len3(body.vel);
    const vmax = maxSpeed(special.glowing);
    const ratio = vmax > 0 ? speed / vmax : 0;
    const up = S === 'Grind' || S === 'Lip' ? UP : normOr(body.up, UP);
    const physNose = S === 'Air' ? airNose(body) : body.nose;
    const shownNose = body.yawSnapDeg !== 0 && S !== 'Air' ? rotateAbout(physNose, up, (body.yawSnapDeg * Math.PI) / 180) : physNose;
    const rot: Quat = basisQuat(shownNose, up);
    const fwd = normOr({ x: physNose.x, y: 0, z: physNose.z }, yawToForward(body.yaw));
    let pose: SkaterSnapshot['pose'];
    let poseVariant: SkaterSnapshot['poseVariant'] = null;
    let posePhase = 0;
    let trickId: TrickVariantId | null = null;
    const cycle = Math.max(1, ticksS(TUNING.PUSH_CYCLE_S));
    switch (S) {
      case 'Bail':
        pose = 'bail';
        posePhase = Math.min(1, n / Math.max(1, ticksS(TUNING.BAIL_TUMBLE_S)));
        break;
      case 'GetUp':
        pose = 'getup';
        posePhase = Math.min(1, n / Math.max(1, ticksS(TUNING.GETUP_LOCKOUT_S)));
        break;
      case 'Grind':
        pose = 'grind';
        poseVariant = grindRun?.type ?? 'fifty_fifty';
        posePhase = needle01();
        trickId = variantId(poseVariant, { switchStance: stance === 'switch' });
        break;
      case 'Lip':
        pose = 'lip';
        poseVariant = lipRun?.lipId ?? 'axle_stall';
        posePhase = needle01();
        trickId = variantId(poseVariant, { switchStance: stance === 'switch' });
        break;
      case 'Manual': {
        const m = machine.manual ?? 'manual';
        pose = m === 'nose_manual' ? 'noseManual' : 'manual';
        poseVariant = manualRun?.contextWindow ? 'context_window' : m;
        posePhase = needle01();
        trickId = variantId(poseVariant, { switchStance: stance === 'switch' });
        break;
      }
      case 'RevertWindow':
        pose = 'revert';
        posePhase = Math.min(1, n / Math.max(1, ticks(TUNING.REVERT_TO_MANUAL_MS)));
        break;
      case 'Crouch':
        pose = 'crouch';
        posePhase = popCharge(machine.chargeStartTick, tick);
        break;
      case 'Air': {
        const inferMs = specialRun?.id === 'inference_900ms' ? specialRun.heldS * 1000 : 0;
        const ap = airPose(air.anims, tick, air.transferTick, air.popTick, inferMs);
        pose = ap.pose;
        poseVariant = ap.variant;
        posePhase = ap.phase;
        const owner = [...air.anims].reverse().find((a) => a.endTick === null || tick < a.endTick);
        trickId = owner ? owner.id : null;
        break;
      }
      default: {
        const braking = (S === 'Grounded' || S === 'LandWindow') && (body.pivotTicks > 0 || ((frameNow?.dirAxis.y ?? 0) <= -TUNING.SIM_PUSH_AXIS_MIN && speed >= TUNING.BRAKE_PIVOT_SPEED));
        if (braking) {
          pose = 'brake';
          posePhase = body.pivotTicks > 0 ? 1 - body.pivotTicks / Math.max(1, ticksS(TUNING.BRAKE_PIVOT_S)) : 0;
        } else if (PUMP_STATES.includes(S) && machine.pumping && frameNow?.held.ollie === true) {
          pose = 'pump';
        } else if ((S === 'Grounded' || S === 'LandWindow') && body.pushTick !== null) {
          pose = 'push';
          posePhase = ((tick - body.pushTick) % cycle) / cycle;
        } else {
          pose = 'roll';
          posePhase = (((n % cycle) + cycle) % cycle) / cycle;
        }
      }
    }
    const flip = S === 'Air' ? running(air.anims, tick, 'flip') : undefined;
    const grab = S === 'Air' ? running(air.anims, tick, 'grab') : undefined;
    const charging = machine.chargeStartTick !== null && (S === 'Crouch' || S === 'Grind' || S === 'Manual' || S === 'Air');
    let boardRel: Quat = { x: 0, y: 0, z: 0, w: 1 };
    if (S === 'RevertWindow' && revertTick !== null) boardRel = yawQuat(Math.PI * (1 - Math.min(1, posePhase)));
    const grindSnap = S === 'Grind' && grindRun && body.grind
      ? (() => {
        const g = body.grind;
        const st = stepGrind({ ...g, speed: 0 }, rails, 0);
        return {
          type: grindRun.type, railId: grindRun.railId, railKind: grindRun.rail.kind, contact: plain(st.point), tangent: plain(st.tangent),
          distanceM: g.travelled,
        };
      })()
      : null;
    const contactPoint = grindSnap ? grindSnap.contact : body.surface ? plain(body.surface.point) : S === 'Lip' && lipRun ? plain(lipRun.point) : null;
    return {
      pos: plain(body.pos), rot, vel: plain(body.vel), speed, speedRatio: ratio, speedTier: speedTierFor(ratio, speedTier), forward: plain(fwd), up: plain(up),
      state: S, stateTicks: n, stance, fakie: body.fakie, pumping: machine.pumping, crouchCharge: charging ? popCharge(machine.chargeStartTick, tick) : 0,
      boardRel, trickId, flipId: flip ? (flip.base as FlipSnapshotId) : null, flipPhase: flip ? flipPhase(flip, tick) : 0,
      grabId: grab ? (grab.base as GrabSnapshotId) : null, pose, poseVariant, posePhase: Math.max(0, Math.min(1, posePhase)),
      airYawDeg: S === 'Air' ? body.airYawDeg : 0, grind: grindSnap, contactPoint,
      surface: body.surface ? { surfaceId: body.surface.surfaceId, normal: plain(body.surface.normal), flags: { ...body.surface.flags } } : null,
      bail: S === 'Bail' ? { phase: 'tumble', t: posePhase } : S === 'GetUp' ? { phase: 'getup', t: posePhase } : null,
    };
  };

  const buildSnapshot = (): SimSnapshot => {
    const skater = skaterSnapshot();
    const hv = { x: body.vel.x, y: 0, z: body.vel.z };
    const heading = len3(hv) > TUNING.ROLLBACK_SPEED_MPS ? norm3(hv) : skater.forward;
    const combo = scoring.view();
    const balanceView: BalanceView | null = balance?.active ? { needle: balance.needle, axis: balance.axis } : null;
    const npc: NpcTalkView | null = run.npcInside
      ? { npcId: run.npcInside.id, name: BRANDS.npcs[run.npcInside.id].name, line: BRANDS.npcs[run.npcInside.id].line, sinceTick: run.npcInside.sinceTick }
      : null;
    const vertAir = machine.state === 'Air' && body.launch?.assisted === true;
    return {
      tick,
      simTime: tick / TUNING.SIM_HZ,
      timeScale: specialRun?.id === 'inference_900ms' && specialRun.active ? TUNING.INFERENCE_TIME_SCALE : 1,
      levelId: level.def.id,
      skater,
      combo,
      special: {
        meter: special.meter, glowing: special.glowing, activeId: specialRun ? specialRun.id : (air.anims.find((a) => a.category === 'special' && (a.endTick === null || tick < a.endTick))?.base as SpecialId | undefined) ?? null,
        heldS: specialRun?.heldS ?? 0,
      },
      balance: balanceView,
      run: runView(run),
      camera: {
        vertAir,
        rampNormal: vertAir && body.launch ? plain(body.launch.normal) : null,
        lookAhead: plain(add3(body.pos, scale3(heading, TUNING.CAM_LOOKAHEAD_M))),
        heading: plain(heading),
      },
      lastLand: lastLand ? { ...lastLand } : null,
      npc,
    };
  };

  let snapshot: SimSnapshot = buildSnapshot();

  // ------------------------------------------------------------------ step

  const step = (frame: InputFrame): WorldStepResult => {
    events = [];
    frameNow = frame;
    quickSpinsThisTick = 0;
    if (!started) {
      started = true;
      emit({ type: 'runStart', tick, levelId: level.def.id, mode: run.mode, lengthS: run.clockS });
    }
    if (machine.state === 'RunEnd') {
      snapshot = buildSnapshot();
      tick += 1;
      return { snapshot, events };
    }

    // State timers first (rows 3, 9b, 16, 25, 38, 39): a window of N ticks accepts input at
    // n = 0 .. N - 1 after its anchor and is gone on tick N (half-open, REQ-TIM-03). Checking after
    // this tick's input would let a press on tick N still land inside it.
    const te = timerEvent(machine, tick, facts(frame));
    if (te) send(te, frame);

    // 1-3: parse and act.
    const ctx = parserContext();
    const parsed = parseTick(ctx, frame, memory);
    memory = parsed.memory;
    lastParse = { tick, actions: parsed.actions, memory };
    railEndPeek = machine.state === 'Grind' && body.grind !== null && stepGrind(body.grind, rails, dt()).event !== null;
    for (const a of parsed.actions) handleAction(a, frame);
    autoGrind(frame);
    heldUpdates(frame);

    // 4: physics in the mode of the (possibly new) state.
    const res = stepController(body, modeFor(machine.state), intentFor(frame), env());
    body = res.body;
    for (const pe of res.events) handlePhysics(pe, frame);

    // 5: derived events (the state timers ran at the top of the tick).
    derived(frame);
    outOfWorld(frame);
    if (machine.state === 'Grounded' && body.surface?.flags.flat) safeSpot = { pos: plain(body.pos), nose: plain(body.nose) };

    // 6: needle, accrual, meter, gaps, pickups, clock.
    needleTick(frame);
    accrueTick(frame);
    specialTick();
    gapSamples();
    triggerTick();
    clockTick(frame);

    // 7: snapshot.
    snapshot = buildSnapshot();
    if (snapshot.skater.speedTier !== speedTier) {
      emit({ type: 'speedTier', tick, tier: snapshot.skater.speedTier, prev: speedTier });
      speedTier = snapshot.skater.speedTier;
    }
    tick += 1;
    return { snapshot, events };
  };

  const teleport = (pos: Vec3, dir: Vec3, speed: number): void => {
    pendingElements = [];
    scoring.lose(tick);
    openKind = null;
    gapTracker.feed({ kind: 'comboEnd' }, tick);
    resetComboFacts();
    balance = null;
    grindRun = null;
    lipRun = null;
    manualRun = null;
    specialRun = null;
    const nose = normOr({ x: dir.x, y: 0, z: dir.z }, body.nose);
    const b0: BodyState = { ...createBody(pos, Math.atan2(-nose.x, -nose.z)), nose };
    const g = groundBody({ ...b0, vel: scale3(nose, speed) }, collision, TUNING.SIM_TELEPORT_GROUND_M);
    if (g) {
      const v = normOr(projectOnPlane(nose, g.up), nose);
      body = { ...g, vel: plain(scale3(v, speed)), nose: plain(v) };
      machine = initialMachine(tick);
    } else {
      const launch: LaunchInfo = { tick, pos: plain(pos), surfaceId: '', normal: UP, slopeDeg: 0, assisted: false, nose0: plain(nose), transition: false };
      body = launchBody(b0, pos, scale3(nose, speed), launch, UP);
      machine = { ...initialMachine(tick), state: 'Air' };
      air = { startTick: tick, popped: true, popTick: null, crossHeldAtStart: false, anims: [], transferTick: null, leftRail: null, transferLatched: false };
    }
    memory = createParserMemory(machine.state);
    snapshot = buildSnapshot();
  };

  const world: SkaterWorld = {
    get levelId() {
      return level.def.id;
    },
    get tick() {
      return tick;
    },
    get snapshot() {
      return snapshot;
    },
    step,
    teleport,
    get lastBanked() {
      return scoring.lastBanked;
    },
    get lastParse() {
      return lastParse;
    },
  };
  INTERNALS.set(world, {
    setSpecialMeter(meter) {
      const s = feedSpecial({ ...special, meter: 0, glowing: false }, meter * TUNING.SPECIAL_FULL_BASE);
      special = s.state;
    },
    body: () => body,
    machine: () => machine,
    balance: () => balance,
  });
  return world;
}
