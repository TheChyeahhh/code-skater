/**
 * src/input/glyphs.ts (input track): button glyphs per controller family (REQ-INP-06, REQ-HUD-05).
 * Detection from gamepad.id: contains "Xbox" -> xbox; contains "054c" (Sony vendor id), "DualSense"
 * or "Wireless Controller" -> playstation; anything else -> xbox (SPEC §5 default).
 * The label table lives ONLY here. Other tracks (the ui controls view, HUD hints) call glyphLabel and,
 * while it is still a stub, fall back through tryImplemented to the plain Button name, never a copy
 * of this table. The keyboard nollie label is Z, not Ctrl: Ctrl+W (nollie + up) closes the tab.
 */

import type { Button, GlyphSet } from '../core/types';

/** Case-insensitive id fragments per family, checked in this order. */
const XBOX_IDS = ['xbox'];
const PLAYSTATION_IDS = ['054c', 'dualsense', 'wireless controller'];

export function detectGlyphs(gamepadId: string): GlyphSet {
  const id = gamepadId.toLowerCase();
  if (XBOX_IDS.some((s) => id.includes(s))) return 'xbox';
  if (PLAYSTATION_IDS.some((s) => id.includes(s))) return 'playstation';
  return 'xbox';
}

const LABELS: Readonly<Record<GlyphSet, Readonly<Record<Button, string>>>> = {
  xbox: {
    ollie: 'A', grab: 'B', flip: 'X', grind: 'Y', spinL: 'LB', spinR: 'RB', nollie: 'LT', revert: 'RT',
    pause: 'Menu', dev: 'View',
  },
  playstation: {
    ollie: 'Cross', grab: 'Circle', flip: 'Square', grind: 'Triangle', spinL: 'L1', spinR: 'R1', nollie: 'L2',
    revert: 'R2', pause: 'Options', dev: 'Share',
  },
  keyboard: {
    ollie: 'Space', grab: 'K', flip: 'J', grind: 'L', spinL: 'Q', spinR: 'E', nollie: 'Z', revert: 'Shift',
    pause: 'Esc', dev: '~',
  },
};

/** Short label for a button in HUD hints and menus ("A", "Cross", "Space"...). Text only, no logo art. */
export function glyphLabel(set: GlyphSet, button: Button): string {
  return LABELS[set][button];
}
