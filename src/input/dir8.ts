/**
 * src/input/dir8.ts (input track): direction math (REQ-INP-02, REQ-VRT-03). Pure.
 * Stick y is UP positive here (the device layer flips the Gamepad API axis).
 */

import { TUNING } from '../core/tuning';
import { DIR8 } from '../core/types';
import type { DirOrNeutral, Vec2 } from '../core/types';

const DEG_PER_RAD = 180 / Math.PI;
const FULL_TURN_DEG = 360;
const ZERO: Vec2 = { x: 0, y: 0 };

/** Unit vectors per direction (x right, y up); diagonals normalised. */
const D = Math.SQRT1_2;
const AXIS: Readonly<Record<DirOrNeutral, Vec2>> = {
  N: ZERO,
  U: { x: 0, y: 1 }, UR: { x: D, y: D }, R: { x: 1, y: 0 }, DR: { x: D, y: -D },
  D: { x: 0, y: -1 }, DL: { x: -D, y: -D }, L: { x: -1, y: 0 }, UL: { x: -D, y: D },
};

/**
 * Stick -> Dir8: neutral inside the radial deadzone (TUNING.STICK_DEADZONE, 0.35), otherwise 8
 * sectors of DIR_SECTOR_DEG (45) centred on the cardinals: U covers -22.5..22.5 deg around up,
 * UR 22.5..67.5, and so on clockwise. Boundary angles go to the clockwise-next sector.
 */
export function dir8FromStick(stick: Vec2, deadzone: number = TUNING.STICK_DEADZONE): DirOrNeutral {
  const mag = Math.hypot(stick.x, stick.y);
  if (!(mag >= deadzone) || mag === 0) return 'N';
  const sector = TUNING.DIR_SECTOR_DEG;
  // Clockwise angle from up: atan2(x, y).
  let deg = Math.atan2(stick.x, stick.y) * DEG_PER_RAD;
  if (deg < 0) deg += FULL_TURN_DEG;
  const idx = Math.floor((deg + sector / 2) / sector) % DIR8.length;
  return DIR8[idx] as DirOrNeutral;
}

/** D-pad buttons -> Dir8; opposite presses cancel on that axis. Must equal dir8FromStick for the same direction (REQ-INP-02). */
export function dir8FromDpad(up: boolean, down: boolean, left: boolean, right: boolean): DirOrNeutral {
  const v = up === down ? 0 : up ? 1 : -1;
  const h = left === right ? 0 : right ? 1 : -1;
  if (v === 0 && h === 0) return 'N';
  return dir8FromStick({ x: h, y: v }, 0);
}

/** REQ-INP-02: the D-pad wins when both are non-neutral. */
export function combineDir(dpad: DirOrNeutral, stickDir: DirOrNeutral): DirOrNeutral {
  return dpad !== 'N' ? dpad : stickDir;
}

/** Unit axis vector of a direction (diagonals normalised); N = (0, 0). */
export function dirToAxis(dir: DirOrNeutral): Vec2 {
  return AXIS[dir];
}

/**
 * InputFrame.dirAxis: D-pad non-neutral -> dirToAxis(dpad); else the stick rescaled radially so the
 * deadzone edge maps to 0 and the rim to 1 (REQ-VRT-03 analog spin, REQ-BAL-03 balance input).
 */
export function analogAxis(stick: Vec2, dpad: DirOrNeutral, deadzone: number = TUNING.STICK_DEADZONE): Vec2 {
  if (dpad !== 'N') return dirToAxis(dpad);
  const mag = Math.hypot(stick.x, stick.y);
  if (!(mag >= deadzone) || mag === 0) return ZERO;
  const span = 1 - deadzone;
  const scaled = span > 0 ? Math.min(1, (Math.min(mag, 1) - deadzone) / span) : 1;
  const k = scaled / mag;
  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  return { x: clamp(stick.x * k), y: clamp(stick.y * k) };
}

/** True when the stick is past the play deadzone (device "active" flag). */
export function stickActive(stick: Vec2, deadzone: number = TUNING.STICK_DEADZONE): boolean {
  return Math.hypot(stick.x, stick.y) >= deadzone;
}

/** Split a direction into its four D-pad components (menu navigation, device merging). */
export function dirParts(dir: DirOrNeutral): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const a = AXIS[dir];
  return { up: a.y > 0, down: a.y < 0, left: a.x < 0, right: a.x > 0 };
}
