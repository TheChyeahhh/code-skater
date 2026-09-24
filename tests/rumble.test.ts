/**
 * tests/rumble.test.ts (input track): REQ-INP-05. Event -> effect map, strengths read live from
 * TUNING, no-ops without an actuator, never throws, and the InputSystem rumble / grind pulse loop.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/core/events';
import { resetTuning, TUNING } from '../src/core/tuning';
import { playRumble, rumbleForEvent, rumbleSpec } from '../src/input/rumble';
import { createInputSystem } from '../src/input/system';
import type { GamepadLike } from '../src/input/types';

afterEach(() => resetTuning());

type Call = { weak: number; strong: number; ms: number };

function padWithActuator(calls: Call[], impl?: () => Promise<unknown>): GamepadLike {
  return {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    vibrationActuator: {
      playEffect(_type, p) {
        calls.push({ weak: p.weakMagnitude, strong: p.strongMagnitude, ms: p.duration });
        return impl ? impl() : Promise.resolve('complete');
      },
    },
  };
}

describe('rumble (REQ-INP-05)', () => {
  it('maps grindStart, bail, gap and macguffin; ignores everything else', () => {
    const ev = (type: string): SimEvent => ({ type, tick: 0 } as unknown as SimEvent);
    expect(rumbleForEvent(ev('grindStart'))).toBe('grindPulse');
    expect(rumbleForEvent(ev('bail'))).toBe('bail');
    expect(rumbleForEvent(ev('gap'))).toBe('gap');
    expect(rumbleForEvent(ev('macguffin'))).toBe('macguffin');
    expect(rumbleForEvent(ev('land'))).toBeNull();
    expect(rumbleForEvent(ev('grindEnd'))).toBeNull();
  });

  it('light grind, medium bail, short gap / MacGuffin, read live from TUNING', () => {
    expect(rumbleSpec('grindPulse')).toEqual({ weak: 0.25, strong: 0, durationMs: 100 });
    expect(rumbleSpec('bail')).toEqual({ weak: 0, strong: 0.8, durationMs: 250 });
    expect(rumbleSpec('gap')).toEqual({ weak: 0, strong: 0.5, durationMs: 120 });
    expect(rumbleSpec('macguffin')).toEqual({ weak: 0, strong: 0.6, durationMs: 200 });
    TUNING.RUMBLE_BAIL_STRONG = 0.5;
    expect(rumbleSpec('bail').strong).toBe(0.5);
  });

  it('is a silent no-op without a pad, without an actuator, or when the actuator throws or rejects', async () => {
    const spec = rumbleSpec('bail');
    expect(() => playRumble(null, spec)).not.toThrow();
    const bare: GamepadLike = { id: 'x', index: 0, connected: true, mapping: 'standard', buttons: [], axes: [] };
    expect(() => playRumble(bare, spec)).not.toThrow();
    expect(() => playRumble({ ...bare, vibrationActuator: null }, spec)).not.toThrow();
    expect(() => playRumble({ ...bare, vibrationActuator: {} }, spec)).not.toThrow();
    const throwing = { ...bare, vibrationActuator: { playEffect: (): Promise<unknown> => { throw new Error('nope'); } } };
    expect(() => playRumble(throwing, spec)).not.toThrow();
    const calls: Call[] = [];
    playRumble(padWithActuator(calls, () => Promise.reject(new Error('preempted'))), spec);
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run
    expect(calls).toEqual([{ weak: 0, strong: 0.8, ms: 250 }]);
  });

  it('InputSystem rumbles the active pad, repeats the grind pulse every RUMBLE_GRIND_PULSE_MS, and can be disabled', () => {
    const calls: Call[] = [];
    const pad = padWithActuator(calls) as GamepadLike & { buttons: { pressed: boolean; value: number }[] };
    const sys = createInputSystem({ getGamepads: () => [pad] });
    sys.rumble('gap');
    expect(calls).toEqual([]); // nothing sampled yet: keyboard is the active device
    sys.sample(0);
    sys.rumble('gap');
    expect(calls).toEqual([{ weak: 0, strong: 0.5, ms: 120 }]); // a pad that connects becomes active at once
    calls.length = 0;
    pad.buttons[0] = { pressed: true, value: 1 };
    sys.sample(16);
    sys.rumble('gap');
    expect(calls).toEqual([{ weak: 0, strong: 0.5, ms: 120 }]);
    calls.length = 0;
    sys.setRumbleLoop('grindPulse');
    expect(calls.length).toBe(1);
    const pulse = TUNING.RUMBLE_GRIND_PULSE_MS;
    sys.sample(16 + pulse - 1);
    expect(calls.length).toBe(1);
    sys.sample(16 + pulse);
    expect(calls.length).toBe(2);
    sys.setRumbleLoop(null);
    sys.sample(16 + 3 * pulse);
    expect(calls.length).toBe(2);
    sys.setRumbleEnabled(false);
    sys.rumble('bail');
    expect(calls.length).toBe(2);
  });
});
