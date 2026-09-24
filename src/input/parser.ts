/**
 * src/input/parser.ts (input track): the pure input parser, DESIGN C.3 (REQ-INP-10..18, CR-11, CR-12).
 *
 * parseTick applies the priority table P1..P11 to each press event of the frame IN PRESS ORDER
 * (first matching row wins, at most one action per press), then runs the sequence readers
 * (MANUAL_ENTRY, MANUAL_LAND in LandWindow, REVERT_MANUAL, MANUAL_SWAP) on unconsumed DirEnter
 * entries. Arbitration rules that tests pin down:
 * - CR-11: a special consumes its two DirEnter entries (ParserMemory.consumed); no reader may use
 *   them afterwards, so a landed Kernel Panic (U,D + Circle) never becomes a manual (REQ-INP-11).
 * - Specials parse only while ctx.glowing; otherwise the press falls through (U,D + Circle not
 *   glowing = Tailgrab, and the U,D pair stays available to the manual readers) (REQ-INP-12).
 * - CR-12: in Grind, a pair within SPECIAL_SEQ_MS + Triangle while glowing = gpu_slide; otherwise
 *   a single direction + Triangle = grind switch; a pair older than the window is not a sequence
 *   (REQ-INP-13).
 * - Pair gap = H[-1].tEnter - H[-2].tExit (leave-to-enter, REQ-INP-17); windows are half-open in
 *   ticks via ticks(ms) (REQ-TIM-03).
 * - Manual swaps: second direction held >= MANUAL_SWAP_MIN_HOLD_TICKS, MANUAL_SWAP_COOLDOWN_MS,
 *   at most MANUAL_SWAP_MAX_PER_RUN per manual run; a pair failing any check is ignored and NOT
 *   consumed (REQ-INP-18).
 * - GetUp and Bail: only pause is parsed (REQ-TIM-10); pause is handled by the app, so the parser
 *   returns no actions there.
 * - R2 in Air is a spine transfer only when ctx.spineTransferAvailable; a transfer press never
 *   writes the revert buffer (REQ-INP-16).
 * No DOM, no clocks, no randomness: time is frame.tick.
 *
 * Decisions inside the contract (input track, M1):
 * - H is the ring itself: the pair is always its last two entries (H[-2], H[-1]) and both must be
 *   unconsumed. Consumed entries are never skipped over to reach older ones (CR-11 stays strict).
 * - Half-open everywhere (REQ-TIM-03): a gap or age n is inside a window of N = ticks(ms) iff n < N.
 *   newestPair's maxGapTicks is inclusive, so readers pass ticks(ms) - 1.
 * - Recency: MANUAL_ENTRY and MANUAL_SWAP only read a pair completed less than ticks(MANUAL_SEQ_MS)
 *   ago and not before the current state was entered, so an old unconsumed pair (for example a
 *   non-glowing U,D + Circle that missed its landing window) never fires later by surprise.
 *   MANUAL_LAND (LandWindow) and REVERT_MANUAL also accept a pair that completed up to
 *   ticks(MANUAL_LAND_WINDOW_MS) before the state was entered: that is the "before contact" half of
 *   the window when the second direction was still dwelling on the contact tick (CR-03 buffering).
 * - Cross released on the same tick it was pressed (a one-tick tap) emits crossPress then
 *   crossRelease, so a tap ollie or a tap pop off a linker is never lost (rows 2, 19, 27).
 */

import { ticks, TUNING } from '../core/tuning';
import type { Dir8, DirEntry, DirOrNeutral, InputFrame, ManualId, SkaterStateName } from '../core/types';
import { enhancedOf, FLIP_BY_DIR, GRAB_BY_DIR, specialFor } from '../data/tricks';
import type { DirPair, LandingLinkers, ParsedAction, ParserContext, ParserMemory, ParseResult } from './types';

/** States in which no input but pause (app) is parsed (REQ-TIM-10). */
const LOCKED_STATES: readonly SkaterStateName[] = ['Bail', 'GetUp', 'RunEnd'];
/** P8: states where a Cross press is a crossPress (Crouch, pump, crouch-on-linker, bank-then-crouch). */
const CROSS_PRESS_STATES: readonly SkaterStateName[] = ['Grounded', 'LandWindow', 'RevertWindow', 'Grind', 'Manual', 'Lip'];
/** P5b: ground snap states. */
const GROUND_SNAP_STATES: readonly SkaterStateName[] = ['Grounded', 'LandWindow', 'Manual'];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Fresh memory (run start, respawn). */
export function createParserMemory(state: SkaterStateName = 'Grounded'): ParserMemory {
  return {
    consumed: [],
    revertBufferTick: null,
    grindBufferTick: null,
    grindHeldInCrouch: false,
    lastAirTrick: null,
    lastGrindSwitchTick: null,
    lastManualSwapTick: null,
    manualSwapsThisRun: 0,
    lastState: state,
  };
}

/** Manual type for a direction pair, or null. Up->Down = manual, Down->Up = nose manual (SPEC §5). */
function manualForPair(first: Dir8, second: Dir8): ManualId | null {
  if (first === 'U' && second === 'D') return 'manual';
  if (first === 'D' && second === 'U') return 'nose_manual';
  return null;
}

/**
 * The newest unconsumed DirEnter pair (H[-2], H[-1]) whose leave-to-enter gap is <= maxGapTicks, or
 * null. Exposed for tests and readers.
 */
export function newestPair(frame: InputFrame, memory: ParserMemory, maxGapTicks: number): DirPair | null {
  const h = frame.dirHistory;
  if (h.length < 2) return null;
  const a = h[h.length - 2] as DirEntry;
  const b = h[h.length - 1] as DirEntry;
  if (memory.consumed.includes(a.id) || memory.consumed.includes(b.id)) return null;
  const gapTicks = b.tEnter - a.tExit;
  if (gapTicks > maxGapTicks) return null;
  return { first: a.dir, second: b.dir, firstId: a.id, secondId: b.id, gapTicks, completedTick: b.tEnter };
}

/** Ticks the second entry of a pair has been held (open entries count the current tick). */
function heldTicks(frame: InputFrame, id: number): number {
  const e = frame.dirHistory.find((d) => d.id === id);
  if (!e) return 0;
  return e.open ? frame.tick - e.tEnter + 1 : e.tExit - e.tEnter;
}

/** Keep only consumed ids still present in the ring (bounded to the ring). */
function pruneConsumed(consumed: readonly number[], frame: InputFrame): number[] {
  const live = new Set(frame.dirHistory.map((d) => d.id));
  return consumed.filter((id) => live.has(id));
}

/** Pair for a manual reader: half-open gap window of MANUAL_SEQ_MS, a manual shape, both unconsumed. */
function manualPair(frame: InputFrame, memory: ParserMemory): { pair: DirPair; manual: ManualId } | null {
  const pair = newestPair(frame, memory, ticks(TUNING.MANUAL_SEQ_MS) - 1);
  if (!pair) return null;
  const manual = manualForPair(pair.first, pair.second);
  return manual ? { pair, manual } : null;
}

/** One tick of parsing. Pure: same (ctx, frame, memory) -> same result. */
export function parseTick(ctx: ParserContext, frame: InputFrame, memory: ParserMemory): ParseResult {
  const now = frame.tick;
  const S = ctx.state;
  const m: Mutable<ParserMemory> = { ...memory, consumed: pruneConsumed(memory.consumed, frame) };
  const actions: ParsedAction[] = [];

  // --- State entry / exit bookkeeping -------------------------------------------------------
  if (S !== memory.lastState) {
    const from = memory.lastState;
    if (from === 'Air' || S === 'Air') m.lastAirTrick = null;
    if (from === 'Air') {
      m.grindBufferTick = null;
      m.revertBufferTick = null; // resolveLanding already read it on the contact tick
    }
    if (S === 'Air' && from === 'Crouch' && m.grindHeldInCrouch) m.grindBufferTick = ctx.stateEnteredTick; // P5c: from the pop tick
    if (from === 'Crouch') m.grindHeldInCrouch = false;
    if (S === 'Manual') {
      m.manualSwapsThisRun = 0;
      m.lastManualSwapTick = null;
    }
    if (S !== 'Grind') m.lastGrindSwitchTick = null;
  }
  m.lastState = S;

  // --- Buffer expiry (half-open) -------------------------------------------------------------
  if (m.revertBufferTick !== null && now - m.revertBufferTick >= ticks(TUNING.REVERT_PRE_MS)) m.revertBufferTick = null;
  if (m.grindBufferTick !== null && now - m.grindBufferTick >= ticks(TUNING.GRIND_PREBUFFER_MS)) m.grindBufferTick = null;

  if (LOCKED_STATES.includes(S)) {
    m.revertBufferTick = null;
    m.grindBufferTick = null;
    m.grindHeldInCrouch = false;
    return { actions, memory: m };
  }

  // P5c: Triangle held during Crouch buffers the grind from the pop tick.
  if (S === 'Crouch' && frame.held.grind) m.grindHeldInCrouch = true;

  const dir: DirOrNeutral = frame.dir;
  let crossPressedThisTick = false;
  let grindTriedThisTick = false;

  /** P3: a special for button b in state S, while glowing, from the newest unconsumed pair. */
  const trySpecial = (b: 'flip' | 'grab' | 'grind'): boolean => {
    if (!ctx.glowing) return false;
    if (S !== 'Air' && S !== 'Grind' && S !== 'Manual') return false;
    const pair = newestPair(frame, m, ticks(TUNING.SPECIAL_SEQ_MS) - 1);
    if (!pair) return false;
    if (now - pair.completedTick >= ticks(TUNING.SPECIAL_BUTTON_MS)) return false;
    const specialId = specialFor(pair.first, pair.second, b, S);
    if (!specialId) return false;
    actions.push({ kind: 'special', specialId });
    m.consumed = [...m.consumed, pair.firstId, pair.secondId];
    return true;
  };

  // --- Presses, in arrival order -------------------------------------------------------------
  for (const b of frame.pressed) {
    switch (b) {
      case 'revert': {
        if (S === 'Air') {
          if (ctx.spineTransferAvailable) actions.push({ kind: 'spineTransfer' }); // P1
          else {
            m.revertBufferTick = now; // P2
            actions.push({ kind: 'revertBuffered' });
          }
        } else if (S === 'LandWindow' && ctx.landKind === 'vert' && !ctx.revertUsedThisLanding) {
          actions.push({ kind: 'revert' }); // P2b
        }
        break;
      }
      case 'grind': {
        if (trySpecial('grind')) break; // P3 (gpu_slide in Grind, context_window in Manual)
        if (S === 'Grind') {
          // P4
          const type = dir === 'N' ? null : ctx.grindTypeByDir[dir];
          const cooled = m.lastGrindSwitchTick === null || now - m.lastGrindSwitchTick >= ticks(TUNING.GRIND_SWITCH_COOLDOWN_MS);
          if (type && type !== ctx.currentGrindType && cooled) {
            actions.push({ kind: 'grindSwitch', grindType: type });
            m.lastGrindSwitchTick = now;
          }
        } else if (S === 'Air') {
          // P5: try now if a candidate exists; the buffer keeps trying for GRIND_PREBUFFER_MS.
          m.grindBufferTick = now;
          if (ctx.airGrindCandidate !== null) {
            actions.push({ kind: 'grindTry', ground: false, buffered: false, dir });
            grindTriedThisTick = true;
          }
        } else if (GROUND_SNAP_STATES.includes(S)) {
          // P5b
          if (ctx.groundSnapAvailable && ctx.speed >= TUNING.GRIND_GROUND_SNAP_MIN_SPEED) {
            actions.push({ kind: 'grindTry', ground: true, buffered: false, dir });
            grindTriedThisTick = true;
          }
        } else if (S === 'Crouch') {
          m.grindHeldInCrouch = true; // P5c
        }
        break;
      }
      case 'flip':
      case 'grab': {
        if (trySpecial(b)) break; // P3
        if (S !== 'Air') break;
        const prev = m.lastAirTrick;
        if (prev && !prev.enhanced && prev.button === b && prev.dir === dir && now - prev.tick < ticks(TUNING.DOUBLE_TAP_MS)) {
          // P6
          const base = b === 'flip' ? FLIP_BY_DIR[dir] : GRAB_BY_DIR[dir];
          actions.push({ kind: 'enhance', trickId: enhancedOf(base) });
          m.lastAirTrick = { ...prev, enhanced: true };
          break;
        }
        // P7
        const trickId = b === 'flip' ? FLIP_BY_DIR[dir] : GRAB_BY_DIR[dir];
        const mod = frame.held.nollie;
        actions.push({ kind: 'trick', button: b, dir, trickId, nollie: mod && !ctx.rollingFakie, fakie: mod && ctx.rollingFakie });
        m.lastAirTrick = { button: b, dir, tick: now, enhanced: false };
        break;
      }
      case 'ollie': {
        if (CROSS_PRESS_STATES.includes(S)) {
          actions.push({ kind: 'crossPress' }); // P8
          crossPressedThisTick = true;
        } else if (S === 'Air') {
          // P8b coyote
          const t = ctx.ticksSinceLeftSurface;
          if (t !== null && t < ticks(TUNING.COYOTE_MS) && !ctx.poppedThisAir) actions.push({ kind: 'coyotePop' });
        }
        break;
      }
      case 'spinL':
      case 'spinR': {
        if (S === 'Air') actions.push({ kind: 'quickSpin', deg: b === 'spinL' ? -180 : 180 }); // P10
        break;
      }
      default:
        break; // P11: nollie is a held modifier; pause and dev are app buttons.
    }
  }

  // --- Releases --------------------------------------------------------------------------------
  for (const b of frame.released) {
    if (b === 'ollie') {
      // P9
      const t = ctx.ticksSinceLeftSurface;
      const coyoteRelease = S === 'Air' && ctx.crossHeldAtLeftSurface && t !== null && t < ticks(TUNING.COYOTE_MS) && !ctx.poppedThisAir;
      if (S === 'Crouch' || (S !== 'Air' && (ctx.charging || crossPressedThisTick)) || coyoteRelease) {
        actions.push({ kind: 'crossRelease' });
      }
    } else if (b === 'grind') {
      actions.push({ kind: 'triangleRelease' });
    }
  }

  // --- Grind pre-buffer (P5 / REQ-INP-15): try on every buffered tick with a candidate ----------
  if (S === 'Air' && !grindTriedThisTick && m.grindBufferTick !== null && ctx.airGrindCandidate !== null) {
    actions.push({ kind: 'grindTry', ground: false, buffered: true, dir });
  }

  // --- Sequence readers -----------------------------------------------------------------------
  const read = manualPair(frame, m);
  if (read) {
    const { pair, manual } = read;
    const age = now - pair.completedTick;
    const consume = (): void => {
      m.consumed = [...m.consumed, pair.firstId, pair.secondId];
    };
    if (S === 'Grounded') {
      // MANUAL_ENTRY (row 4)
      if (ctx.onFlat && ctx.speed >= TUNING.MANUAL_MIN_SPEED && age < ticks(TUNING.MANUAL_SEQ_MS) && pair.completedTick >= ctx.stateEnteredTick) {
        actions.push({ kind: 'manualEntry', manual });
        consume();
      }
    } else if (S === 'LandWindow') {
      // MANUAL_LAND after a flat contact (row 9d)
      if (ctx.landKind === 'flat' && pair.completedTick > ctx.stateEnteredTick - ticks(TUNING.MANUAL_LAND_WINDOW_MS)) {
        actions.push({ kind: 'manualLand', manual });
        consume();
      }
    } else if (S === 'RevertWindow') {
      // REVERT_MANUAL (row 15): pairs typed during the revert pivot are kept (CR-03)
      if (now - ctx.stateEnteredTick < ticks(TUNING.REVERT_TO_MANUAL_MS) && pair.completedTick > ctx.stateEnteredTick - ticks(TUNING.MANUAL_LAND_WINDOW_MS)) {
        actions.push({ kind: 'revertManual', manual });
        consume();
      }
    } else if (S === 'Manual') {
      // MANUAL_SWAP (row 28), REQ-INP-18: failing pairs are ignored and not consumed
      const opposite = ctx.manual !== null && manual !== ctx.manual;
      const heldEnough = heldTicks(frame, pair.secondId) >= TUNING.MANUAL_SWAP_MIN_HOLD_TICKS;
      const cooled = m.lastManualSwapTick === null || now - m.lastManualSwapTick >= ticks(TUNING.MANUAL_SWAP_COOLDOWN_MS);
      const underCap = m.manualSwapsThisRun < TUNING.MANUAL_SWAP_MAX_PER_RUN;
      const fresh = age < ticks(TUNING.MANUAL_SEQ_MS) && pair.completedTick >= ctx.stateEnteredTick;
      if (opposite && heldEnough && cooled && underCap && fresh) {
        actions.push({ kind: 'manualSwap', manual });
        consume();
        m.lastManualSwapTick = now;
        m.manualSwapsThisRun += 1;
      }
    }
  }

  return { actions, memory: m };
}

/**
 * Called by the world on the contact tick of a landing (rows 7, 8, 12, 13): is the revert pre-buffer
 * live (R2 within ticks(REVERT_PRE_MS) before `tick`), and did a manual pair complete within
 * ticks(MANUAL_LAND_WINDOW_MS) before contact (flat landings only)? A returned manual pair is
 * consumed; the revert buffer is cleared either way.
 */
export function resolveLanding(frame: InputFrame, memory: ParserMemory, tick: number, landing: 'flat' | 'vert'): LandingLinkers {
  const m: Mutable<ParserMemory> = { ...memory, consumed: pruneConsumed(memory.consumed, frame) };
  const revertBuffered = landing === 'vert' && memory.revertBufferTick !== null && tick - memory.revertBufferTick >= 0
    && tick - memory.revertBufferTick < ticks(TUNING.REVERT_PRE_MS);
  m.revertBufferTick = null;
  let manual: ManualId | null = null;
  if (landing === 'flat') {
    const read = manualPair(frame, m);
    if (read && tick - read.pair.completedTick < ticks(TUNING.MANUAL_LAND_WINDOW_MS)) {
      manual = read.manual;
      m.consumed = [...m.consumed, read.pair.firstId, read.pair.secondId];
    }
  }
  return { revertBuffered, manualPair: manual, memory: m };
}
