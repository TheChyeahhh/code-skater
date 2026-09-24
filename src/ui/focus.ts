/**
 * src/ui/focus.ts (ui track): controller-complete focus navigation (REQ-MNU-02, REQ-LAB-03).
 * D-pad / stick move between items (grid-aware), confirm activates, back calls the screen's back
 * handler, left / right adjust sliders and pickers. The focused element gets aria-selected and a
 * visible focus style; mouse hover and click still work.
 */

import type { FocusItem, FocusManager } from './types';

export const FOCUS_CLASS = 'is-focused';

export interface FocusManagerOptions {
  /** Called whenever the focused index changes through navigation or hover (menu blip). */
  readonly onMove?: (index: number) => void;
  /** Called when confirm activates an item. */
  readonly onConfirm?: (index: number) => void;
  /** Called when confirm hits a disabled item (error blip). */
  readonly onBlocked?: (index: number) => void;
}

export function createFocusManager(options: FocusManagerOptions = {}): FocusManager {
  let items: readonly FocusItem[] = [];
  let columns = 1;
  let wrap = true;
  let index = 0;
  let onBack: (() => void) | null = null;
  let cleanups: (() => void)[] = [];

  const apply = (): void => {
    items.forEach((it, i) => {
      const on = i === index;
      if (it.el.classList.contains(FOCUS_CLASS) !== on) it.el.classList.toggle(FOCUS_CLASS, on);
      if (on) {
        it.el.setAttribute('aria-selected', 'true');
        if (typeof it.el.scrollIntoView === 'function') {
          try {
            it.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          } catch {
            // happy-dom and old browsers: no scrolling needed.
          }
        }
      } else if (it.el.hasAttribute('aria-selected')) {
        it.el.removeAttribute('aria-selected');
      }
    });
  };

  const focus = (next: number, notify = true): void => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    if (clamped === index) {
      apply();
      return;
    }
    index = clamped;
    apply();
    if (notify) options.onMove?.(index);
  };

  /** Move by a delta in the item list, skipping disabled items, wrapping when allowed. */
  const step = (delta: number): boolean => {
    if (items.length === 0) return false;
    let i = index;
    for (let n = 0; n < items.length; n++) {
      i += delta;
      if (i < 0 || i >= items.length) {
        if (!wrap) return false;
        i = (i + items.length) % items.length;
      }
      if (!items[i]?.disabled) {
        focus(i);
        return true;
      }
    }
    return false;
  };

  const confirm = (): boolean => {
    const it = items[index];
    if (!it) return false;
    if (it.disabled) {
      options.onBlocked?.(index);
      return true;
    }
    it.onConfirm?.();
    options.onConfirm?.(index);
    return true;
  };

  const bindMouse = (): void => {
    for (const c of cleanups) c();
    cleanups = [];
    items.forEach((it, i) => {
      const enter = (): void => focus(i);
      const click = (ev: Event): void => {
        ev.preventDefault();
        focus(i, false);
        confirm();
      };
      it.el.addEventListener('pointerenter', enter);
      it.el.addEventListener('click', click);
      cleanups.push(() => {
        it.el.removeEventListener('pointerenter', enter);
        it.el.removeEventListener('click', click);
      });
    });
  };

  return {
    get index() {
      return index;
    },
    setItems(next, opts) {
      items = next;
      columns = Math.max(1, opts?.columns ?? 1);
      wrap = opts?.wrap ?? true;
      let initial = Math.max(0, Math.min(items.length - 1, opts?.initial ?? 0));
      // Never start on a disabled item.
      if (items[initial]?.disabled) {
        const first = items.findIndex((it) => !it.disabled);
        if (first >= 0) initial = first;
      }
      index = initial;
      bindMouse();
      apply();
    },
    handle(nav) {
      if (items.length === 0) {
        if (nav.back && onBack) {
          onBack();
          return true;
        }
        return false;
      }
      const it = items[index];
      if (nav.confirm) return confirm();
      if (nav.back) {
        if (onBack) onBack();
        return onBack !== null;
      }
      if (nav.left || nav.right) {
        const delta: -1 | 1 = nav.left ? -1 : 1;
        if (it?.onAdjust?.(delta)) return true;
        if (columns > 1) return step(delta);
        return false;
      }
      if (nav.up) return step(-columns);
      if (nav.down) return step(columns);
      return false;
    },
    focus(i) {
      focus(i, false);
    },
    setOnBack(handler) {
      onBack = handler;
    },
    clear() {
      for (const c of cleanups) c();
      cleanups = [];
      items = [];
      index = 0;
      onBack = null;
    },
  };
}
