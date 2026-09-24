/**
 * src/input/frameBuilder.ts (input track): RawTickInput -> InputFrame, pure and deterministic.
 *
 * Implements:
 * - REQ-INP-02: stickDir (deadzone 0.35, 45 deg sectors), dpad, dir (D-pad wins), dirAxis.
 * - REQ-INP-03 / REQ-INP-17: the DirEnter ring. A non-neutral Dir8 that is held for
 *   DIR_MIN_DWELL_TICKS (or is held when Square, Circle or Triangle is pressed, see CONFIRM_BUTTONS)
 *   enters the ring stamped tEnter = the tick it began; tExit = the tick it was left (= current tick
 *   while open). Ring size DIR_RING_SIZE, oldest first.
 * - REQ-TIM-02: pressed / released edges pass through in order; when RawTickInput omits them
 *   (scripts), they are derived from held changes against the previous tick. A release the held
 *   state shows but the edges lack (drained while paused) is added too. A missing press is not:
 *   the button that resumes play would otherwise fire a trick on the first tick.
 * - REQ-INP-04 / REQ-INP-07: pressHistory keeps the last PRESS_HISTORY_SIZE presses with the Dir8
 *   and nollie held at the press.
 * Every stamp is a sim tick (the `tick` argument); nothing here reads a clock.
 */

import { TUNING } from '../core/tuning';
import { BUTTONS } from '../core/types';
import type { Button, ButtonState, DirEntry, DirOrNeutral, InputFrame, PressEntry } from '../core/types';
import { analogAxis, combineDir, dir8FromStick } from './dir8';
import type { FrameBuilder, RawTickInput } from './types';

/**
 * A press of one of these while a direction is held enters that direction into the ring at once,
 * without waiting out the dwell: the player held it on purpose at the press (REQ-INP-07). Without
 * this, D-pad Down and Triangle landing in the same render frame (one tick) would miss the pair's
 * second direction and a glowing U,D + Triangle would read as a grind switch. A sweep with no
 * press is still filtered by DIR_MIN_DWELL_TICKS (REQ-INP-03).
 */
const CONFIRM_BUTTONS: readonly Button[] = ['flip', 'grab', 'grind'];

/** The current uninterrupted run of one Dir8 value. */
interface DirRun {
  readonly dir: DirOrNeutral;
  readonly start: number;
  /** True once the run has been pushed into the ring. */
  entered: boolean;
}

function noButtons(): ButtonState {
  const r = {} as Record<Button, boolean>;
  for (const b of BUTTONS) r[b] = false;
  return r;
}

function copyHeld(held: ButtonState): ButtonState {
  const r = {} as Record<Button, boolean>;
  for (const b of BUTTONS) r[b] = held[b] === true;
  return r;
}

export function createFrameBuilder(): FrameBuilder {
  let prevHeld: ButtonState = noButtons();
  let run: DirRun | null = null;
  let ring: DirEntry[] = [];
  let presses: PressEntry[] = [];
  let last: InputFrame | null = null;

  function updateRing(dir: DirOrNeutral, tick: number, confirm: boolean): void {
    const next = ring.slice();
    if (!run || run.dir !== dir) {
      // The previous run ends: close its entry (tExit = this tick, the tick it was left).
      if (run && run.entered) {
        const i = next.length - 1;
        const open = next[i];
        if (open && open.open) next[i] = { ...open, tExit: tick, open: false };
      }
      run = { dir, start: tick, entered: false };
    }
    if (run.dir !== 'N') {
      if (run.entered) {
        const i = next.length - 1;
        const open = next[i];
        if (open && open.open) next[i] = { ...open, tExit: tick };
      } else if (confirm || tick - run.start + 1 >= TUNING.DIR_MIN_DWELL_TICKS) {
        run.entered = true;
        next.push({ id: run.start, dir: run.dir, tEnter: run.start, tExit: tick, open: true });
      }
    }
    const cap = Math.max(1, Math.floor(TUNING.DIR_RING_SIZE));
    ring = next.length > cap ? next.slice(next.length - cap) : next;
  }

  return {
    next(raw: RawTickInput, tick: number): InputFrame {
      const held = copyHeld(raw.held);
      const pressed: Button[] = raw.pressed ? [...raw.pressed] : BUTTONS.filter((b) => held[b] && !prevHeld[b]);
      const released: Button[] = raw.released ? [...raw.released] : [];
      // A button held last tick and up now is released even when its edge was lost: a pause, a
      // lost controller or a hidden tab drains or ages out the queue while the button comes up, and
      // without this the sim would never see the release (a stuck crouch, a stuck grab).
      for (const b of BUTTONS) if (prevHeld[b] && !held[b] && !released.includes(b)) released.push(b);
      const stick = { x: raw.stick.x, y: raw.stick.y };
      const stickDir = dir8FromStick(stick);
      const dpad = raw.dpad;
      const dir = combineDir(dpad, stickDir);
      updateRing(dir, tick, pressed.some((b) => CONFIRM_BUTTONS.includes(b)));
      if (pressed.length > 0) {
        const added = pressed.map((button): PressEntry => ({ button, tick, dir, nollieHeld: held.nollie }));
        const all = presses.concat(added);
        const cap = Math.max(1, Math.floor(TUNING.PRESS_HISTORY_SIZE));
        presses = all.length > cap ? all.slice(all.length - cap) : all;
      }
      prevHeld = held;
      const frame: InputFrame = {
        tick,
        source: raw.source,
        held,
        pressed,
        released,
        stick,
        look: { x: raw.look.x, y: raw.look.y },
        lookDelta: { x: raw.lookDelta.x, y: raw.lookDelta.y },
        dpad,
        stickDir,
        dir,
        dirAxis: analogAxis(stick, dpad),
        dirHistory: ring,
        pressHistory: presses,
      };
      last = frame;
      return frame;
    },
    reset(): void {
      prevHeld = noButtons();
      run = null;
      ring = [];
      presses = [];
      last = null;
    },
    get last(): InputFrame | null {
      return last;
    },
  };
}
