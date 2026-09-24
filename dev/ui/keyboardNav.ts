/**
 * dev/ui/keyboardNav.ts (ui track harness): turns keyboard events into NavInput frames so the UI can be
 * driven by hand in the harness. The real game gets NavInput from the input track; this is only for
 * dev/ui.html. Arrows / WASD move (held = cursor for the sticker placer), Enter / Space confirm,
 * Esc / Backspace back, Q / E tabs, J action1, L action2, P pause, ` dev panel, [ ] = right stick x.
 */

import type { NavInput } from '../../src/core/types';
import { NO_NAV } from '../../src/ui/root';

export interface KeyboardNav {
  /** Edges since the last call, plus held cursor / look; call once per frame. */
  frame(): NavInput;
}

export function createKeyboardNav(): KeyboardNav {
  const held = new Set<string>();
  let pending: Partial<Record<keyof NavInput, boolean>> = {};
  const edge = (key: keyof NavInput): void => {
    pending[key] = true;
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    held.add(e.key);
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': edge('up'); break;
      case 'ArrowDown': case 's': case 'S': edge('down'); break;
      case 'ArrowLeft': case 'a': case 'A': edge('left'); break;
      case 'ArrowRight': case 'd': case 'D': edge('right'); break;
      case 'Enter': case ' ': edge('confirm'); break;
      case 'Escape': case 'Backspace': edge('back'); break;
      case 'q': case 'Q': edge('tabPrev'); break;
      case 'e': case 'E': edge('tabNext'); break;
      case 'j': case 'J': edge('action1'); break;
      case 'l': case 'L': edge('action2'); break;
      case 'p': case 'P': edge('pause'); break;
      case '`': case '~': edge('dev'); break;
      default: return;
    }
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.key));
  window.addEventListener('blur', () => held.clear());
  return {
    frame() {
      const cursor = {
        x: (held.has('ArrowRight') || held.has('d') ? 1 : 0) - (held.has('ArrowLeft') || held.has('a') ? 1 : 0),
        y: (held.has('ArrowUp') || held.has('w') ? 1 : 0) - (held.has('ArrowDown') || held.has('s') ? 1 : 0),
      };
      const lookX = (held.has(']') ? 1 : 0) - (held.has('[') ? 1 : 0);
      const nav: NavInput = { ...NO_NAV, ...pending, cursor, lookX, source: Object.keys(pending).length ? 'keyboard' : 'none' };
      pending = {};
      return nav;
    },
  };
}
