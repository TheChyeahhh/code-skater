/**
 * tests/inputSystem.test.ts (input track): bindings, glyph detection, the gamepad and keyboard
 * devices, the InputSystem merge / edge queue / connection events, and menu navigation.
 * REQ-INP-01, 05 (wiring), 06, 07, 08 (events), REQ-TIM-02, REQ-MNU-02. Plain node: fake pads and
 * an EventTarget stand in for the browser.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import { BUTTONS } from '../src/core/types';
import type { GlyphSet } from '../src/core/types';
import { createGamepadDevice, KEY_BUTTONS, KEY_DIRS, PAD_BUTTONS, PAD_DPAD } from '../src/input/devices';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { detectGlyphs, glyphLabel } from '../src/input/glyphs';
import { createInputSystem } from '../src/input/system';
import type { ConnectionEvent, GamepadLike } from '../src/input/types';

afterEach(() => resetTuning());

interface FakePad extends GamepadLike {
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
  connected: boolean;
}

function fakePad(id: string, index = 0, mapping = 'standard'): FakePad {
  return {
    id, index, connected: true, mapping,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

function setButton(pad: FakePad, i: number, on: boolean, value = on ? 1 : 0): void {
  pad.buttons[i] = { pressed: on, value };
}

const XBOX_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const DS_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';

/** A Window stand-in: an EventTarget that key events are dispatched on. */
function fakeWindow(): Window {
  return new EventTarget() as unknown as Window;
}

function key(win: Window, type: 'keydown' | 'keyup', code: string, repeat = false): void {
  const e = new Event(type, { cancelable: true });
  Object.defineProperty(e, 'code', { value: code });
  Object.defineProperty(e, 'repeat', { value: repeat });
  win.dispatchEvent(e);
}

describe('bindings (REQ-INP-01): every action is reachable on a pad; nothing is keyboard-only', () => {
  it('every Button has a pad binding and a keyboard key', () => {
    const keyed = new Set(Object.values(KEY_BUTTONS));
    for (const b of BUTTONS) {
      expect(PAD_BUTTONS[b].length, b).toBeGreaterThan(0);
      expect(keyed.has(b), b).toBe(true);
    }
    expect(new Set(Object.values(KEY_DIRS))).toEqual(new Set(Object.keys(PAD_DPAD)));
  });

  it('standard indices follow SPEC §5 (Cross 0, Circle 1, Square 2, Triangle 3, L1 4, R1 5, L2 6, R2 7)', () => {
    expect(PAD_BUTTONS).toMatchObject({ ollie: [0], grab: [1], flip: [2], grind: [3], spinL: [4], spinR: [5], nollie: [6], revert: [7], dev: [8], pause: [9] });
  });
});

describe('glyphs (REQ-INP-06)', () => {
  it('detects the family from gamepad.id, default Xbox', () => {
    expect(detectGlyphs(XBOX_ID)).toBe('xbox');
    expect(detectGlyphs(DS_ID)).toBe('playstation');
    expect(detectGlyphs('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(detectGlyphs('Wireless Controller (STANDARD GAMEPAD)')).toBe('playstation');
    expect(detectGlyphs('Generic USB Joystick (STANDARD GAMEPAD Vendor: 0079)')).toBe('xbox');
    expect(detectGlyphs('')).toBe('xbox');
  });

  it('has a short text label for every button in every set', () => {
    for (const set of ['xbox', 'playstation', 'keyboard'] as GlyphSet[]) {
      for (const b of BUTTONS) {
        const l = glyphLabel(set, b);
        expect(l.length, `${set} ${b}`).toBeGreaterThan(0);
        expect(l.includes(String.fromCharCode(0x2014))).toBe(false);
      }
    }
    expect(glyphLabel('xbox', 'ollie')).toBe('A');
    expect(glyphLabel('playstation', 'grind')).toBe('Triangle');
    expect(glyphLabel('keyboard', 'flip')).toBe('J');
  });
});

describe('keyboard nollie (Ctrl+W closes the tab)', () => {
  it('Z is nollie and is the taught key; Ctrl still works; the taught key is no browser modifier', () => {
    expect(KEY_BUTTONS.KeyZ).toBe('nollie');
    expect(KEY_BUTTONS.ControlLeft).toBe('nollie');
    const taught = glyphLabel('keyboard', 'nollie');
    expect(taught).toBe('Z');
    expect(/ctrl|alt|cmd|meta/i.test(taught)).toBe(false);
  });

  it('holding Z with W held and pressing K records a nollie grab up', () => {
    const win = fakeWindow();
    const sys = createInputSystem({ getGamepads: () => [] });
    sys.attach(win);
    const b = createFrameBuilder();
    key(win, 'keydown', 'KeyZ');
    key(win, 'keydown', 'KeyW');
    sys.sample(performance.now());
    b.next(sys.nextTick(), 0);
    key(win, 'keydown', 'KeyK');
    sys.sample(performance.now());
    expect(b.next(sys.nextTick(), 1).pressHistory.at(-1)).toMatchObject({ button: 'grab', dir: 'U', nollieHeld: true });
    sys.detach();
  });
});

describe('gamepad device', () => {
  it('reads triggers by the live threshold, flips stick y, maps the D-pad to Dir8', () => {
    const pad = fakePad(XBOX_ID);
    const dev = createGamepadDevice(0, () => pad);
    setButton(pad, 7, false, 0.49);
    expect(dev.poll(0).held.revert).toBe(false);
    setButton(pad, 7, false, 0.5);
    const s = dev.poll(1);
    expect(s.held.revert).toBe(true);
    expect(s.edges).toEqual([{ button: 'revert', down: true, ms: 1 }]);
    TUNING.INPUT_TRIGGER_PRESS = 0.8;
    expect(dev.poll(2).held.revert).toBe(false);
    pad.axes = [0.5, -1, 0, 1];
    setButton(pad, PAD_DPAD.down, true);
    setButton(pad, PAD_DPAD.left, true);
    const t = dev.poll(3);
    expect(t.stick).toEqual({ x: 0.5, y: 1 });
    expect(t.look).toEqual({ x: 0, y: -1 });
    expect(t.dpad).toBe('DL');
    expect(dev.info.glyphs).toBe('xbox');
  });

  it('ignores non-standard pads and releases everything when the pad vanishes', () => {
    const odd = fakePad('Odd pad', 0, '');
    setButton(odd, 0, true);
    expect(createGamepadDevice(0, () => odd).poll(0).held.ollie).toBe(false);
    const pad = fakePad(DS_ID);
    let live: GamepadLike | null = pad;
    const dev = createGamepadDevice(0, () => live);
    setButton(pad, 0, true);
    expect(dev.poll(0).held.ollie).toBe(true);
    live = null;
    const s = dev.poll(1);
    expect(s.held.ollie).toBe(false);
    expect(s.edges).toEqual([{ button: 'ollie', down: false, ms: 1 }]);
  });
});

describe('InputSystem', () => {
  it('emits connect / disconnect events with glyphs, and the active device follows the last input', () => {
    const pads: (GamepadLike | null)[] = [];
    const sys = createInputSystem({ getGamepads: () => pads });
    const events: ConnectionEvent[] = [];
    sys.onConnection((e) => events.push(e));
    expect(sys.activeDevice.kind).toBe('keyboard');
    const ds = fakePad(DS_ID, 0);
    pads.push(ds);
    sys.sample(0);
    expect(events).toEqual([{ connected: true, device: { kind: 'gamepad', id: DS_ID, index: 0, glyphs: 'playstation' } }]);
    setButton(ds, 2, true);
    sys.sample(16);
    expect(sys.activeDevice).toMatchObject({ kind: 'gamepad', glyphs: 'playstation' });
    ds.connected = false;
    sys.sample(32);
    expect(events[1]).toMatchObject({ connected: false, device: { id: DS_ID } });
    expect(sys.activeDevice.kind).toBe('keyboard');
    const raw = sys.nextTick();
    expect(raw.pressed).toEqual(['flip']);
    expect(raw.released).toEqual(['flip']); // the vanished pad's held button is released, not stuck
  });

  it('a pad connected at boot, or reconnected, drives glyphs at once (no press needed)', () => {
    const pads: (GamepadLike | null)[] = [];
    const sys = createInputSystem({ getGamepads: () => pads });
    const ds = fakePad(DS_ID, 0);
    pads.push(ds);
    sys.sample(0); // idle pad, no edges
    expect(sys.activeDevice).toMatchObject({ kind: 'gamepad', index: 0, glyphs: 'playstation' });
    ds.connected = false;
    sys.sample(16);
    expect(sys.activeDevice.kind).toBe('keyboard');
    ds.connected = true;
    sys.sample(32);
    expect(sys.activeDevice).toMatchObject({ kind: 'gamepad', glyphs: 'playstation' });
    expect(sys.nav().source).toBe('gamepad');
  });

  it('keyboard input in the frame a pad connects keeps keyboard glyphs', () => {
    const win = fakeWindow();
    const pads: (GamepadLike | null)[] = [];
    const sys = createInputSystem({ getGamepads: () => pads });
    sys.attach(win);
    pads.push(fakePad(XBOX_ID, 0));
    key(win, 'keydown', 'KeyJ');
    sys.sample(performance.now());
    expect(sys.activeDevice.kind).toBe('keyboard');
    sys.detach();
  });

  it('a pad button released while paused (edges drained) still reaches the sim as a release after resume', () => {
    const pad = fakePad(XBOX_ID);
    const sys = createInputSystem({ getGamepads: () => [pad] });
    const b = createFrameBuilder();
    setButton(pad, 0, true);
    sys.sample(0);
    expect(b.next(sys.nextTick(), 0).pressed).toEqual(['ollie']); // crouching
    // Paused: the session drains edges each render frame without ticking the sim.
    setButton(pad, 0, false);
    sys.sample(16);
    sys.nextTick();
    // Resumed: the first real tick.
    sys.sample(32);
    const f = b.next(sys.nextTick(), 1);
    expect(f.held.ollie).toBe(false);
    expect(f.released).toEqual(['ollie']);
  });

  it('REQ-TIM-02: two keyboard presses inside one render frame reach the sim as two presses, once', () => {
    const win = fakeWindow();
    const sys = createInputSystem({ getGamepads: () => [] });
    sys.attach(win);
    key(win, 'keydown', 'KeyJ');
    key(win, 'keyup', 'KeyJ');
    key(win, 'keydown', 'KeyJ');
    sys.sample(performance.now());
    const r1 = sys.nextTick();
    expect(r1.pressed).toEqual(['flip', 'flip']);
    expect(r1.released).toEqual(['flip']);
    expect(r1.held.flip).toBe(true);
    expect(r1.source).toBe('keyboard');
    const r2 = sys.nextTick();
    expect(r2.pressed).toEqual([]);
    const f = createFrameBuilder().next(r1, 0);
    expect(f.pressed).toEqual(['flip', 'flip']);
    sys.detach();
  });

  it('REQ-INP-07: keyboard flip direction is the WASD / arrow direction held at the J press', () => {
    const win = fakeWindow();
    const sys = createInputSystem({ getGamepads: () => [] });
    sys.attach(win);
    const b = createFrameBuilder();
    key(win, 'keydown', 'KeyA');
    key(win, 'keydown', 'ArrowUp');
    sys.sample(performance.now());
    b.next(sys.nextTick(), 0);
    key(win, 'keydown', 'KeyJ');
    sys.sample(performance.now());
    const f = b.next(sys.nextTick(), 1);
    expect(f.dpad).toBe('UL');
    expect(f.pressHistory.at(-1)).toMatchObject({ button: 'flip', dir: 'UL' });
    key(win, 'keyup', 'KeyA');
    key(win, 'keyup', 'ArrowUp');
    key(win, 'keydown', 'ArrowLeft');
    key(win, 'keydown', 'ArrowRight'); // opposite keys cancel
    sys.sample(performance.now());
    expect(b.next(sys.nextTick(), 2).dpad).toBe('N');
    sys.detach();
  });

  it('drops edges that waited longer than INPUT_EDGE_MAX_AGE_MS for a tick (menu presses never leak into a run)', () => {
    const pad = fakePad(XBOX_ID);
    const sys = createInputSystem({ getGamepads: () => [pad] });
    sys.sample(0);
    setButton(pad, 0, true);
    sys.sample(10);
    sys.sample(10 + TUNING.INPUT_EDGE_MAX_AGE_MS + 1);
    const r = sys.nextTick();
    expect(r.pressed).toEqual([]);
    expect(r.held.ollie).toBe(true);
  });

  it('merges devices: held is OR, the bigger stick wins, the D-pad components OR together', () => {
    const a = fakePad(XBOX_ID, 0);
    const b = fakePad(DS_ID, 1);
    const sys = createInputSystem({ getGamepads: () => [a, b] });
    a.axes = [0.2, 0, 0, 0];
    b.axes = [0, -0.9, 0, 0];
    setButton(a, PAD_DPAD.up, true);
    setButton(b, PAD_DPAD.right, true);
    setButton(b, 3, true);
    sys.sample(0);
    const r = sys.nextTick();
    expect(r.stick).toEqual({ x: 0, y: 0.9 });
    expect(r.dpad).toBe('UR');
    expect(r.held.grind).toBe(true);
  });
});

describe('menu navigation (REQ-MNU-02)', () => {
  it('pad: D-pad moves once, then auto-repeats after the delay at the interval; stick past the threshold moves too', () => {
    const pad = fakePad(XBOX_ID);
    const sys = createInputSystem({ getGamepads: () => [pad] });
    const at = (ms: number): boolean => {
      sys.sample(ms);
      return sys.nav().down;
    };
    at(0);
    setButton(pad, PAD_DPAD.down, true);
    expect(at(16)).toBe(true);
    expect(at(32)).toBe(false);
    const delay = TUNING.INPUT_NAV_REPEAT_DELAY_MS;
    const rate = TUNING.INPUT_NAV_REPEAT_MS;
    expect(at(16 + delay - 1)).toBe(false);
    expect(at(16 + delay)).toBe(true);
    expect(at(16 + delay + rate - 1)).toBe(false);
    expect(at(16 + delay + rate)).toBe(true);
    setButton(pad, PAD_DPAD.down, false);
    expect(at(2000)).toBe(false);
    pad.axes = [TUNING.INPUT_NAV_STICK + 0.01, 0.1, 0, 0];
    sys.sample(2016);
    const n = sys.nav();
    expect(n.right).toBe(true);
    expect(n.down).toBe(false);
    pad.axes = [TUNING.INPUT_NAV_STICK - 0.05, 0, 0, 0];
    sys.sample(3000);
    sys.nav();
    sys.sample(3016);
    expect(sys.nav().right).toBe(false);
  });

  it('pad buttons: Cross confirm, Circle back, L1 / R1 tabs, Square / Triangle actions, Options pause, View dev', () => {
    const pad = fakePad(DS_ID);
    const sys = createInputSystem({ getGamepads: () => [pad] });
    sys.sample(0);
    sys.nav();
    for (const i of [0, 1, 2, 3, 4, 5, 8, 9]) setButton(pad, i, true);
    pad.axes = [0, 0, -0.5, 0];
    sys.sample(16);
    const n = sys.nav();
    expect(n).toMatchObject({ confirm: true, back: true, action1: true, action2: true, tabPrev: true, tabNext: true, pause: true, dev: true, lookX: -0.5, source: 'gamepad' });
    sys.sample(32);
    expect(sys.nav()).toMatchObject({ confirm: false, back: false, tabNext: false });
  });

  it('keyboard: arrows move, Enter confirms, Esc backs (and pauses), Backspace backs, a quick tap between samples still moves', () => {
    const win = fakeWindow();
    const sys = createInputSystem({ getGamepads: () => [] });
    sys.attach(win);
    key(win, 'keydown', 'ArrowUp');
    key(win, 'keyup', 'ArrowUp');
    key(win, 'keydown', 'Enter');
    sys.sample(0);
    expect(sys.nav()).toMatchObject({ up: true, confirm: true, back: false, source: 'keyboard' });
    key(win, 'keydown', 'Escape');
    sys.sample(16);
    expect(sys.nav()).toMatchObject({ back: true, pause: true, confirm: false });
    key(win, 'keydown', 'Backspace');
    sys.sample(32);
    expect(sys.nav().back).toBe(true);
    sys.detach();
  });
});
