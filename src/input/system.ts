/**
 * src/input/system.ts (input track): the browser input front end (REQ-TIM-02, REQ-INP-01..09).
 * Merges the keyboard/mouse device and every connected standard gamepad; the most recently active
 * device drives glyphs (REQ-HUD-05). Emits connection events for the app's auto-pause (REQ-INP-08).
 *
 * Merge rule: held = OR over devices; D-pad = OR of each device's D-pad components; left / right
 * stick = the pad stick with the largest deflection; mouse lookDelta accumulates until nextTick().
 * Edges: every device edge is queued (sim queue and nav queue) with its render timestamp. The first
 * nextTick() after they arrive delivers all of them, in timestamp order, so two presses inside one
 * render frame reach the sim as two presses (REQ-TIM-02). Edges older than INPUT_EDGE_MAX_AGE_MS at
 * nextTick() are dropped (they piled up while no tick ran: menus, pause).
 */

import { TUNING } from '../core/tuning';
import { BUTTONS } from '../core/types';
import type { Button, ButtonState, DirOrNeutral, InputSource, NavInput, Vec2 } from '../core/types';
import { createGamepadDevice, createKeyboardMouseDevice } from './devices';
import type { KeyboardMouseDevice, NavKey } from './devices';
import { analogAxis, dir8FromDpad, dirParts } from './dir8';
import { playRumble, rumbleSpec } from './rumble';
import type {
  ButtonEdge, ConnectionEvent, DeviceInfo, DeviceSample, GamepadLike, InputDevice, InputSystem, RawTickInput, RumbleEffect,
} from './types';

export interface InputSystemOptions {
  /** Defaults to navigator.getGamepads(); tests pass fakes. */
  readonly getGamepads?: () => readonly (GamepadLike | null)[];
}

const ZERO: Vec2 = { x: 0, y: 0 };
const KEYBOARD_INFO: DeviceInfo = { kind: 'keyboard', id: 'keyboard', index: null, glyphs: 'keyboard' };
const NAV_DIRS = ['up', 'down', 'left', 'right'] as const;
type NavDir = (typeof NAV_DIRS)[number];

interface PadSlot {
  readonly id: string;
  readonly device: InputDevice;
}

interface QueuedEdge extends ButtonEdge {
  readonly kind: 'gamepad' | 'keyboard';
}

function noButtons(): Record<Button, boolean> {
  const r = {} as Record<Button, boolean>;
  for (const b of BUTTONS) r[b] = false;
  return r;
}

function defaultGetGamepads(): readonly (GamepadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return [...navigator.getGamepads()] as unknown as readonly (GamepadLike | null)[];
  } catch {
    return [];
  }
}

function magnitude(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function createInputSystem(options?: InputSystemOptions): InputSystem {
  const getGamepads = options?.getGamepads ?? defaultGetGamepads;
  const pads = new Map<number, PadSlot>();
  const listeners = new Set<(e: ConnectionEvent) => void>();
  let keyboard: KeyboardMouseDevice | null = null;
  let attachedTo: Window | null = null;

  let active: DeviceInfo = KEYBOARD_INFO;
  let held: ButtonState = noButtons();
  let stick: Vec2 = ZERO;
  let look: Vec2 = ZERO;
  let dpad: DirOrNeutral = 'N';
  let lookDelta = { x: 0, y: 0 };
  let simQueue: QueuedEdge[] = [];
  let navQueue: QueuedEdge[] = [];
  let navKeyQueue: NavKey[] = [];
  let lastSampleMs = 0;

  let rumbleOn = true;
  let rumbleLoop: RumbleEffect | null = null;
  let rumbleLoopMs = 0;

  const navHold: Record<NavDir, { held: boolean; next: number }> = {
    up: { held: false, next: 0 }, down: { held: false, next: 0 }, left: { held: false, next: 0 }, right: { held: false, next: 0 },
  };

  const padByIndex = (index: number): GamepadLike | null => {
    for (const p of getGamepads()) if (p && p.index === index) return p;
    return null;
  };

  const emit = (e: ConnectionEvent): void => {
    for (const l of [...listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error('input: connection listener failed', err);
      }
    }
  };

  const queue = (edges: readonly ButtonEdge[], kind: 'gamepad' | 'keyboard'): void => {
    for (const e of edges) {
      const q: QueuedEdge = { button: e.button, down: e.down, ms: e.ms, kind };
      simQueue.push(q);
      if (e.down) navQueue.push(q);
    }
  };

  const removePad = (index: number, nowMs: number): void => {
    const slot = pads.get(index);
    if (!slot) return;
    // One last poll releases anything still held on the vanished pad.
    queue(slot.device.poll(nowMs).edges, 'gamepad');
    const info = { ...slot.device.info, id: slot.id };
    slot.device.dispose();
    pads.delete(index);
    if (active.kind === 'gamepad' && active.index === index) active = KEYBOARD_INFO;
    emit({ connected: false, device: info });
  };

  /** Connect / disconnect by polling (REQ-INP-08); also run from the gamepad events. */
  const scanPads = (nowMs: number): void => {
    const seen = new Set<number>();
    for (const p of getGamepads()) {
      if (!p || !p.connected || p.mapping !== 'standard') continue;
      seen.add(p.index);
      const slot = pads.get(p.index);
      if (slot && slot.id !== p.id) removePad(p.index, nowMs);
      if (!pads.get(p.index)) {
        const index = p.index;
        const device = createGamepadDevice(index, () => padByIndex(index));
        pads.set(index, { id: p.id, device });
        // A pad that just connected (at boot or on reconnect) drives glyphs at once; keyboard input in
        // the same sample still wins in sample()'s pick (REQ-HUD-05).
        active = device.info;
        emit({ connected: true, device: device.info });
      }
    }
    for (const index of [...pads.keys()]) if (!seen.has(index)) removePad(index, nowMs);
  };

  const onPadEvent = (): void => scanPads(lastSampleMs);

  const fireRumble = (effect: RumbleEffect): void => {
    if (!rumbleOn || active.kind !== 'gamepad' || active.index === null) return;
    playRumble(padByIndex(active.index), rumbleSpec(effect));
  };

  return {
    attach(target: Window, pointerTarget?: HTMLElement): void {
      if (attachedTo) this.detach();
      attachedTo = target;
      keyboard = createKeyboardMouseDevice(target, pointerTarget);
      target.addEventListener('gamepadconnected', onPadEvent);
      target.addEventListener('gamepaddisconnected', onPadEvent);
    },

    detach(): void {
      keyboard?.dispose();
      keyboard = null;
      if (attachedTo) {
        attachedTo.removeEventListener('gamepadconnected', onPadEvent);
        attachedTo.removeEventListener('gamepaddisconnected', onPadEvent);
      }
      attachedTo = null;
    },

    sample(nowMs: number): void {
      lastSampleMs = nowMs;
      scanPads(nowMs);
      const samples: { info: DeviceInfo; s: DeviceSample }[] = [];
      for (const slot of pads.values()) samples.push({ info: slot.device.info, s: slot.device.poll(nowMs) });
      if (keyboard) {
        samples.push({ info: keyboard.info, s: keyboard.poll(nowMs) });
        navKeyQueue.push(...keyboard.drainNavKeys());
      }

      const merged = noButtons();
      const parts = { up: false, down: false, left: false, right: false };
      let bestStick: Vec2 = ZERO;
      let bestLook: Vec2 = ZERO;
      for (const { info, s } of samples) {
        for (const b of BUTTONS) if (s.held[b]) merged[b] = true;
        const p = dirParts(s.dpad);
        parts.up ||= p.up;
        parts.down ||= p.down;
        parts.left ||= p.left;
        parts.right ||= p.right;
        if (magnitude(s.stick) > magnitude(bestStick)) bestStick = s.stick;
        if (magnitude(s.look) > magnitude(bestLook)) bestLook = s.look;
        lookDelta.x += s.lookDelta.x;
        lookDelta.y += s.lookDelta.y;
        queue(s.edges, info.kind);
      }
      held = merged;
      stick = bestStick;
      look = bestLook;
      dpad = dir8FromDpad(parts.up, parts.down, parts.left, parts.right);

      // Active device: one that produced edges this frame wins; otherwise keep the current one while it is still active.
      const withEdges = samples.find((x) => x.s.edges.length > 0);
      const current = samples.find((x) => x.info.kind === active.kind && x.info.index === active.index);
      const pick = withEdges ?? (current?.s.active ? current : samples.find((x) => x.s.active));
      if (pick) active = pick.info;

      if (rumbleLoop && nowMs - rumbleLoopMs >= TUNING.RUMBLE_GRIND_PULSE_MS) {
        rumbleLoopMs = nowMs;
        fireRumble(rumbleLoop);
      }
    },

    nextTick(): RawTickInput {
      const oldest = lastSampleMs - TUNING.INPUT_EDGE_MAX_AGE_MS;
      const edges = simQueue.filter((e) => e.ms >= oldest);
      edges.sort((a, b) => a.ms - b.ms); // stable: same-timestamp edges keep arrival order
      simQueue = [];
      const pressed: Button[] = [];
      const released: Button[] = [];
      for (const e of edges) (e.down ? pressed : released).push(e.button);
      const delta = lookDelta;
      lookDelta = { x: 0, y: 0 };
      const source: InputSource = active.kind;
      return { held, pressed, released, stick, look, lookDelta: delta, dpad, source };
    },

    nav(): NavInput {
      const q = navQueue;
      navQueue = [];
      const keys = navKeyQueue;
      navKeyQueue = [];
      const has = (b: Button): boolean => q.some((e) => e.button === b);
      const now = lastSampleMs;

      // Directions: D-pad / arrows OR the stick's dominant axis past INPUT_NAV_STICK, with auto-repeat.
      const p = dirParts(dpad);
      const t = TUNING.INPUT_NAV_STICK;
      const horiz = Math.abs(stick.x) >= Math.abs(stick.y);
      const state: Record<NavDir, boolean> = {
        up: p.up || (!horiz && stick.y >= t),
        down: p.down || (!horiz && stick.y <= -t),
        left: p.left || (horiz && stick.x <= -t),
        right: p.right || (horiz && stick.x >= t),
      };
      const fired: Record<NavDir, boolean> = { up: false, down: false, left: false, right: false };
      for (const d of NAV_DIRS) {
        const h = navHold[d];
        if (state[d]) {
          if (!h.held) {
            fired[d] = true;
            h.next = now + TUNING.INPUT_NAV_REPEAT_DELAY_MS;
          } else if (now >= h.next) {
            fired[d] = true;
            h.next = now + TUNING.INPUT_NAV_REPEAT_MS;
          }
        }
        h.held = state[d];
        if (keys.includes(d)) fired[d] = true; // a key tapped between two samples still moves focus
      }

      const anyEdge = q.length > 0 || keys.length > 0;
      const padEdge = q.some((e) => e.kind === 'gamepad');
      const source: InputSource = padEdge ? 'gamepad' : anyEdge ? 'keyboard' : active.kind;
      return {
        up: fired.up,
        down: fired.down,
        left: fired.left,
        right: fired.right,
        confirm: has('ollie') || keys.includes('confirm'),
        back: has('grab') || keys.includes('back'),
        tabPrev: has('spinL'),
        tabNext: has('spinR'),
        action1: has('flip'),
        action2: has('grind'),
        pause: has('pause'),
        dev: has('dev'),
        lookX: look.x,
        cursor: analogAxis(stick, dpad),
        source,
      };
    },

    get activeDevice(): DeviceInfo {
      return active;
    },

    onConnection(listener: (e: ConnectionEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    rumble(effect: RumbleEffect): void {
      fireRumble(effect);
    },

    setRumbleLoop(effect: RumbleEffect | null): void {
      rumbleLoop = effect;
      if (effect) {
        rumbleLoopMs = lastSampleMs;
        fireRumble(effect);
      }
    },

    setRumbleEnabled(on: boolean): void {
      rumbleOn = on;
    },

    requestPointerLock(): void {
      keyboard?.requestPointerLock();
    },

    exitPointerLock(): void {
      keyboard?.exitPointerLock();
    },
  };
}
