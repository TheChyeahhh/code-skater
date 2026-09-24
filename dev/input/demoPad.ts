/**
 * dev/input/demoPad.ts (input track harness): a scripted fake standard-mapping pad for ?demo, so the
 * harness shows the whole stack (device -> system -> frame builder -> parser -> overlay) headless.
 * The id carries the Sony vendor id, so the overlay shows the PlayStation glyph set.
 * Script (ms from start): Air glowing U,D + Circle (special), Square double tap (enhanced),
 * Grind glowing U,D + Triangle (special grind), Grind not glowing Down + Triangle (grind switch),
 * Manual glowing L,R + Triangle (Context Window), Air R2 trigger at 0.7 (revert buffer).
 */

import type { GamepadLike } from '../../src/input/types';

const BUTTON_COUNT = 17;
const AXIS_COUNT = 4;

interface Step {
  readonly at: number;
  readonly label?: string;
  /** Mock context switch (harness chip label) and glow. */
  readonly state?: readonly [string, boolean];
  /** Buttons held from this step on (standard indices); omitted = keep. */
  readonly buttons?: readonly number[];
  /** Analog values for held buttons (triggers). */
  readonly values?: Readonly<Record<number, number>>;
  /** Axes 0..3 (API convention, y down positive); omitted = keep. */
  readonly axes?: readonly [number, number, number, number];
}

const UP = 12;
const DOWN = 13;
const LEFT = 14;
const RIGHT = 15;
const CIRCLE = 1;
const SQUARE = 2;
const TRIANGLE = 3;
const R2 = 7;

const SCRIPT: readonly Step[] = [
  { at: 0, label: 'Air, glowing', state: ['Air', true], buttons: [], axes: [0, 0, 0, 0] },
  { at: 100, buttons: [UP] },
  { at: 220, buttons: [] },
  { at: 260, buttons: [DOWN] },
  { at: 380, label: 'U,D + Circle', buttons: [DOWN, CIRCLE] },
  { at: 460, buttons: [] },
  { at: 600, label: 'Square + Left, twice', buttons: [SQUARE], axes: [-1, 0, 0.6, 0] },
  { at: 650, buttons: [] },
  { at: 730, buttons: [SQUARE] },
  { at: 780, buttons: [], axes: [0, 0, 0, 0] },
  { at: 900, label: 'Grind, glowing', state: ['Grind', true], buttons: [UP] },
  { at: 1000, buttons: [] },
  { at: 1040, buttons: [DOWN] },
  { at: 1150, label: 'U,D + Triangle', buttons: [DOWN, TRIANGLE] },
  { at: 1250, buttons: [] },
  { at: 1400, label: 'Grind, not glowing', state: ['Grind', false], axes: [0, 1, 0, 0] },
  { at: 1500, label: 'Down + Triangle', buttons: [TRIANGLE] },
  { at: 1600, buttons: [], axes: [0, 0, 0, 0] },
  { at: 1800, label: 'Manual, glowing', state: ['Manual', true], buttons: [LEFT] },
  { at: 1900, buttons: [] },
  { at: 1940, buttons: [RIGHT] },
  { at: 2050, label: 'L,R + Triangle', buttons: [RIGHT, TRIANGLE] },
  { at: 2150, buttons: [] },
  { at: 2300, label: 'Air, R2 trigger 0.7', state: ['Air', true], buttons: [R2], values: { [R2]: 0.7 }, axes: [0.55, -0.55, 0, 0] },
  { at: 2400, buttons: [] },
];
const FINISH_MS = 2700;

export interface DemoPad {
  readonly pad: GamepadLike;
  readonly label: string;
  readonly finished: boolean;
  advance(nowMs: number): void;
  onRumble: ((weak: number, strong: number, ms: number) => void) | null;
}

export function createDemoPad(hooks: { setState(name: string, glow: boolean): void }): DemoPad {
  const buttons = Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false, value: 0 }));
  const axes = Array.from({ length: AXIS_COUNT }, () => 0);
  let start: number | null = null;
  let next = 0;
  let label = 'starting';
  let finished = false;
  const demo: DemoPad = {
    pad: {
      id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons,
      axes,
      vibrationActuator: {
        playEffect(_type, params) {
          demo.onRumble?.(params.weakMagnitude, params.strongMagnitude, params.duration);
          return Promise.resolve('complete');
        },
      },
    },
    get label() {
      return label;
    },
    get finished() {
      return finished;
    },
    onRumble: null,
    advance(nowMs: number): void {
      if (start === null) start = nowMs;
      const t = nowMs - start;
      while (next < SCRIPT.length && (SCRIPT[next] as Step).at <= t) {
        const s = SCRIPT[next] as Step;
        next += 1;
        if (s.label) label = s.label;
        if (s.state) hooks.setState(s.state[0], s.state[1]);
        if (s.buttons) {
          buttons.forEach((b, i) => {
            const on = s.buttons?.includes(i) ?? false;
            b.pressed = on;
            b.value = on ? (s.values?.[i] ?? 1) : 0;
          });
        }
        if (s.axes) s.axes.forEach((v, i) => (axes[i] = v));
      }
      if (t >= FINISH_MS) finished = true;
    },
  };
  return demo;
}
