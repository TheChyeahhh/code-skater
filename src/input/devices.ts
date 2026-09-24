/**
 * src/input/devices.ts (input track): device abstraction (REQ-INP-01, REQ-INP-07, REQ-CAM-03).
 * - Gamepads: W3C "standard" mapping only (mapping !== "standard" pads are ignored in MVP).
 * - Keyboard + mouse: key events are queued with their timestamp so two presses inside one render
 *   frame both survive (REQ-TIM-02); mouse movement only under pointer lock.
 * The binding tables below are the SPEC §5 map; every Button has a pad binding (REQ-INP-01).
 */

import { TUNING } from '../core/tuning';
import { BUTTONS } from '../core/types';
import type { Button, ButtonState, DirOrNeutral, Vec2 } from '../core/types';
import { dir8FromDpad, stickActive } from './dir8';
import { detectGlyphs } from './glyphs';
import type { ButtonEdge, DeviceInfo, DeviceSample, GamepadLike, InputDevice } from './types';

/** Standard-mapping button indices per logical button (SPEC §5). */
export const PAD_BUTTONS: Readonly<Record<Button, readonly number[]>> = {
  ollie: [0],
  grab: [1],
  flip: [2],
  grind: [3],
  spinL: [4],
  spinR: [5],
  nollie: [6],
  revert: [7],
  dev: [8],
  pause: [9],
};

/** Standard-mapping D-pad indices. */
export const PAD_DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;

/** Standard-mapping axes: left stick 0/1, right stick 2/3 (API y is down positive; flip it). */
export const PAD_AXES = { leftX: 0, leftY: 1, rightX: 2, rightY: 3 } as const;

/**
 * KeyboardEvent.code -> logical button (SPEC §5 keyboard column). Nollie is also on Z, and Z is the
 * key the glyphs teach: a keyboard flip or grab direction is the held WASD key, so a nollie trick
 * "up" on Ctrl is Ctrl+W, which Chrome and Edge reserve (close tab) and never hand to the page.
 * Ctrl stays bound as the SPEC key; it is safe with the arrows.
 */
export const KEY_BUTTONS: Readonly<Record<string, Button>> = {
  Space: 'ollie',
  KeyJ: 'flip',
  KeyK: 'grab',
  KeyL: 'grind',
  ShiftLeft: 'revert',
  ShiftRight: 'revert',
  ControlLeft: 'nollie',
  ControlRight: 'nollie',
  KeyZ: 'nollie',
  KeyQ: 'spinL',
  KeyE: 'spinR',
  Escape: 'pause',
  Backquote: 'dev',
};

/** KeyboardEvent.code -> D-pad direction (WASD and arrows share steer and Dir8, REQ-INP-07). */
export const KEY_DIRS: Readonly<Record<string, 'up' | 'down' | 'left' | 'right'>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/**
 * Trigger buttons (L2 / R2) count as pressed at or above this analog value. Documented default of
 * TUNING.INPUT_TRIGGER_PRESS, which the device reads live (dev panel slider).
 */
export const TRIGGER_PRESS_VALUE = 0.5;

/** Menu-only keys (REQ-MNU-02): Enter confirms, Backspace and Esc go back. */
export const KEY_NAV: Readonly<Record<string, 'confirm' | 'back'>> = {
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Backspace: 'back',
  Escape: 'back',
};

/** Standard-mapping indices of the analog triggers. */
const TRIGGER_INDICES: readonly number[] = [...PAD_BUTTONS.nollie, ...PAD_BUTTONS.revert];

const ZERO: Vec2 = { x: 0, y: 0 };

export type NavKey = 'confirm' | 'back' | 'up' | 'down' | 'left' | 'right';

/** The keyboard device plus the extras the input system needs (menu keys, pointer lock). */
export interface KeyboardMouseDevice extends InputDevice {
  /** Menu key presses (Enter, Backspace, Esc, direction keys) since the last call, oldest first. */
  drainNavKeys(): readonly NavKey[];
  requestPointerLock(): void;
  exitPointerLock(): void;
  readonly pointerLocked: boolean;
}

function noButtons(): Record<Button, boolean> {
  const r = {} as Record<Button, boolean>;
  for (const b of BUTTONS) r[b] = false;
  return r;
}

function neutralSample(held: ButtonState, edges: readonly ButtonEdge[]): DeviceSample {
  return { held, edges, stick: ZERO, look: ZERO, lookDelta: ZERO, dpad: 'N', active: false };
}

function finite(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Read one logical button off a standard-mapping pad (triggers by analog threshold). */
function padButton(pad: GamepadLike, index: number): boolean {
  const btn = pad.buttons[index];
  if (!btn) return false;
  if (TRIGGER_INDICES.includes(index)) return finite(btn.value) >= TUNING.INPUT_TRIGGER_PRESS;
  return btn.pressed === true;
}

/** A standard-mapping gamepad read through getPad() each poll (the Gamepad object is a snapshot in some browsers). */
export function createGamepadDevice(index: number, getPad: () => GamepadLike | null): InputDevice {
  let prev: ButtonState = noButtons();
  let lastId = getPad()?.id ?? '';
  return {
    get info(): DeviceInfo {
      const id = getPad()?.id ?? lastId;
      return { kind: 'gamepad', id, index, glyphs: detectGlyphs(id) };
    },
    poll(nowMs: number): DeviceSample {
      const pad = getPad();
      const usable = pad !== null && pad.connected && pad.mapping === 'standard';
      const held = noButtons();
      if (usable) {
        lastId = pad.id;
        for (const b of BUTTONS) held[b] = PAD_BUTTONS[b].some((i) => padButton(pad, i));
      }
      const edges: ButtonEdge[] = [];
      for (const b of BUTTONS) if (held[b] !== prev[b]) edges.push({ button: b, down: held[b], ms: nowMs });
      prev = held;
      if (!usable) return neutralSample(held, edges);
      const ax = (i: number): number => Math.max(-1, Math.min(1, finite(pad.axes[i])));
      const stick = { x: ax(PAD_AXES.leftX), y: -ax(PAD_AXES.leftY) };
      const look = { x: ax(PAD_AXES.rightX), y: -ax(PAD_AXES.rightY) };
      const dpad = dir8FromDpad(
        padButton(pad, PAD_DPAD.up), padButton(pad, PAD_DPAD.down), padButton(pad, PAD_DPAD.left), padButton(pad, PAD_DPAD.right),
      );
      const active = edges.length > 0 || BUTTONS.some((b) => held[b]) || dpad !== 'N' || stickActive(stick) || stickActive(look);
      return { held, edges, stick, look, lookDelta: ZERO, dpad, active };
    },
    dispose(): void {
      prev = noButtons();
    },
  };
}

/** True when a key event comes from a text field (never steal typing). */
function fromTextField(e: KeyboardEvent): boolean {
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable === true;
}

/** Keyboard + mouse on `target`; pointerTarget receives pointer lock requests (REQ-CAM-03). */
export function createKeyboardMouseDevice(target: Window, pointerTarget?: HTMLElement): KeyboardMouseDevice {
  const downKeys = new Set<string>();
  const counts = noButtonsCount();
  const dirKeys = { up: 0, down: 0, left: 0, right: 0 };
  let edges: ButtonEdge[] = [];
  let navKeys: NavKey[] = [];
  let mouseX = 0;
  let mouseY = 0;
  let activity = false;

  function noButtonsCount(): Record<Button, number> {
    const r = {} as Record<Button, number>;
    for (const b of BUTTONS) r[b] = 0;
    return r;
  }

  const stamp = (e: Event): number => (Number.isFinite(e.timeStamp) ? e.timeStamp : 0);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (fromTextField(e)) return;
    const button = KEY_BUTTONS[e.code];
    const dir = KEY_DIRS[e.code];
    const nav = KEY_NAV[e.code];
    if (button || dir || nav) e.preventDefault?.();
    activity = true;
    if (e.repeat || downKeys.has(e.code)) return;
    downKeys.add(e.code);
    if (button) {
      counts[button] += 1;
      if (counts[button] === 1) edges.push({ button, down: true, ms: stamp(e) });
    }
    if (dir) {
      dirKeys[dir] += 1;
      navKeys.push(dir);
    }
    if (nav) navKeys.push(nav);
  };

  const release = (code: string, ms: number): void => {
    if (!downKeys.delete(code)) return;
    const button = KEY_BUTTONS[code];
    const dir = KEY_DIRS[code];
    if (button && counts[button] > 0) {
      counts[button] -= 1;
      if (counts[button] === 0) edges.push({ button, down: false, ms });
    }
    if (dir && dirKeys[dir] > 0) dirKeys[dir] -= 1;
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (KEY_BUTTONS[e.code] || KEY_DIRS[e.code] || KEY_NAV[e.code]) e.preventDefault?.();
    release(e.code, stamp(e));
  };

  const onBlur = (e: Event): void => {
    for (const code of [...downKeys]) release(code, stamp(e));
  };

  const locked = (): boolean => {
    const doc = target.document as Document | undefined;
    return !!pointerTarget && !!doc && doc.pointerLockElement === pointerTarget;
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!locked()) return;
    mouseX += finite(e.movementX);
    mouseY += finite(e.movementY);
    activity = true;
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  target.addEventListener('mousemove', onMouseMove);

  const info: DeviceInfo = { kind: 'keyboard', id: 'keyboard', index: null, glyphs: 'keyboard' };

  return {
    info,
    poll(_nowMs: number): DeviceSample {
      const held = {} as Record<Button, boolean>;
      for (const b of BUTTONS) held[b] = counts[b] > 0;
      const dpad: DirOrNeutral = dir8FromDpad(dirKeys.up > 0, dirKeys.down > 0, dirKeys.left > 0, dirKeys.right > 0);
      const out = edges;
      edges = [];
      const lookDelta = { x: mouseX, y: mouseY };
      mouseX = 0;
      mouseY = 0;
      const active = activity || out.length > 0;
      activity = false;
      return { held, edges: out, stick: ZERO, look: ZERO, lookDelta, dpad, active };
    },
    drainNavKeys(): readonly NavKey[] {
      const out = navKeys;
      navKeys = [];
      return out;
    },
    requestPointerLock(): void {
      try {
        const r = pointerTarget?.requestPointerLock?.() as unknown;
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
      } catch {
        // Pointer lock refused (no gesture, iframe policy): the camera just stays put.
      }
    },
    exitPointerLock(): void {
      try {
        if (locked()) target.document.exitPointerLock?.();
      } catch {
        // ignore
      }
    },
    get pointerLocked(): boolean {
      return locked();
    },
    dispose(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      target.removeEventListener('mousemove', onMouseMove);
      downKeys.clear();
      edges = [];
      navKeys = [];
    },
  };
}
