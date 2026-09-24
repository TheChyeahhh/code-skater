/**
 * src/ui/glyphs.ts (ui track): button glyph badges for menus and HUD hints (REQ-HUD-05, REQ-INP-06).
 * The label TEXT comes from the input track's glyphLabel (the only label table); while that is still
 * a stub we fall back to the plain Button name (ARCHITECTURE.md decision 22). The badge LOOK is ours:
 * PlayStation face buttons draw their SPEC section 5 shapes (Cross, Circle, Square, Triangle: the
 * locked input map, not a copy of a table), Xbox face buttons draw coloured letter badges, keyboard
 * and shoulder buttons draw a key cap with the label.
 */

import { tryImplemented } from '../core/contract';
import type { Button, GlyphSet } from '../core/types';
import { glyphLabel } from '../input/glyphs';
import { el, svgIcon } from './dom';

/** Navigation verbs the menus hint at, mapped to the locked pad buttons (SPEC section 5). */
export type NavVerb = 'confirm' | 'back' | 'action1' | 'action2' | 'tabPrev' | 'tabNext' | 'pause' | 'dev' | 'move' | 'adjust';

const VERB_BUTTON: Readonly<Record<Exclude<NavVerb, 'move' | 'adjust'>, Button>> = {
  confirm: 'ollie',
  back: 'grab',
  action1: 'flip',
  action2: 'grind',
  tabPrev: 'spinL',
  tabNext: 'spinR',
  pause: 'pause',
  dev: 'dev',
};

/** Keyboard labels for the navigation verbs (the input track mirrors these keys into NavInput). */
const KEYBOARD_NAV: Readonly<Record<NavVerb, string>> = {
  confirm: 'Enter',
  back: 'Esc',
  action1: 'J',
  action2: 'L',
  tabPrev: 'Q',
  tabNext: 'E',
  pause: 'Esc',
  dev: '~',
  move: 'Arrows',
  adjust: 'Left / Right',
};

/** Text label for a button in the given set, falling back to the button name until input lands. */
export function buttonLabel(set: GlyphSet, button: Button): string {
  return tryImplemented(() => glyphLabel(set, button)) ?? button;
}

const PS_SHAPES: Readonly<Record<string, string>> = {
  ollie: '<path d="M7 7 L17 17 M17 7 L7 17" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
  grab: '<circle cx="12" cy="12" r="5.4" stroke="currentColor" stroke-width="2.6" fill="none"/>',
  flip: '<rect x="6.5" y="6.5" width="11" height="11" stroke="currentColor" stroke-width="2.6" fill="none"/>',
  grind: '<path d="M12 6 L18 17.5 L6 17.5 Z" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" fill="none"/>',
};

/** A badge element for one button. */
export function glyphBadge(set: GlyphSet, button: Button): HTMLElement {
  const label = buttonLabel(set, button);
  const badge = el('span', `glyph glyph--${set} glyph--${button}`);
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', label);
  badge.title = label;
  const shape = set === 'playstation' ? PS_SHAPES[button] : undefined;
  if (shape) {
    badge.append(svgIcon('0 0 24 24', shape, 'glyph__shape'));
  } else {
    badge.append(el('span', 'glyph__text', label));
    if (label.length > 2) badge.classList.add('glyph--wide');
  }
  return badge;
}

/** "(A) Select" style hint: badge + verb text. */
export function navHint(set: GlyphSet, verb: NavVerb, text: string): HTMLElement {
  const hint = el('span', 'hint');
  if (set === 'keyboard' || verb === 'move' || verb === 'adjust') {
    const key = el('span', 'glyph glyph--keyboard glyph--wide', el('span', 'glyph__text', set === 'keyboard' ? KEYBOARD_NAV[verb] : verb === 'move' ? 'D-pad' : 'Left / Right'));
    hint.append(key);
  } else {
    hint.append(glyphBadge(set, VERB_BUTTON[verb]));
  }
  hint.append(el('span', 'hint__text', text));
  return hint;
}

/** The bottom hint bar of a screen. */
export function hintBar(set: GlyphSet, hints: readonly (readonly [NavVerb, string])[]): HTMLElement {
  const bar = el('div', 'hintbar');
  for (const [verb, text] of hints) bar.append(navHint(set, verb, text));
  return bar;
}
