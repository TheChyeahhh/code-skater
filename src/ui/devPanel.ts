/**
 * src/ui/devPanel.ts (ui track): the dev tuning panel (SPEC §1.3, REQ-DEP-07). Toggled by ~ / Share /
 * View. One slider per TUNING_META key (min, max, step, unit, label, REQ id), grouped by
 * TUNING_SECTIONS, a dropdown per TUNING_ENUM_META key, a filter box and "reset to defaults"
 * (resetTuning). Writes TUNING directly; systems read it live. Fully usable with a pad.
 *
 * Pad use: up / down move through Reset all and the rows of the open groups, left / right step the
 * focused slider (or cycle the focused dropdown), confirm on a group header folds it, confirm on
 * Reset all restores every default, back closes the panel. The text filter is keyboard only (folding
 * groups is the pad's way to narrow the list). The mouse and keyboard work on the same controls.
 * The panel is a DOM overlay over everything.
 */

import { resetTuning, TUNING, TUNING_DEFAULTS, TUNING_ENUM_META, TUNING_META, TUNING_SECTIONS, type EnumTuningKey, type NumericTuningKey } from '../core/tuning';
import type { NavInput } from '../core/types';
import { clear, el, setClass, setText } from './dom';
import { createFocusManager } from './focus';
import type { FocusItem } from './types';

export interface DevPanel {
  readonly open: boolean;
  toggle(): void;
  /** One frame of NavInput while open; returns true when consumed. */
  handle(nav: NavInput): boolean;
  dispose(): void;
}

interface Row {
  readonly key: string;
  readonly el: HTMLElement;
  readonly refresh: () => void;
}

function formatValue(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
  return v.toFixed(decimals);
}

export function createDevPanel(container: HTMLElement): DevPanel {
  const panel = el('div', 'devpanel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Tuning');
  const filter = el('input', 'devpanel__filter');
  filter.type = 'search';
  filter.placeholder = 'Filter keys';
  filter.setAttribute('aria-label', 'Filter keys');
  const count = el('span', 'devpanel__count');
  const resetBtn = el('button', 'devpanel__reset', 'Reset all');
  resetBtn.type = 'button';
  const head = el('div', 'devpanel__head', el('span', 'devpanel__title', 'Tuning'), count, filter, resetBtn);
  const body = el('div', 'devpanel__body');
  panel.append(head, body);
  panel.style.display = 'none';
  container.append(panel);

  const focus = createFocusManager();
  const rows: Row[] = [];
  const folded = new Set<string>();
  let open = false;
  let query = '';
  let laidOut = false;

  const numericKeys = Object.keys(TUNING_META) as NumericTuningKey[];
  const enumKeys = Object.keys(TUNING_ENUM_META) as EnumTuningKey[];

  const buildRow = (key: NumericTuningKey): Row => {
    const meta = TUNING_META[key];
    const label = el('span', 'row__label', meta.label);
    const keyEl = el('span', 'row__key', `${key}  ${meta.reqId}`);
    const value = el('span', 'row__value');
    const input = el('input', 'row__slider');
    input.type = 'range';
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.step = String(meta.step);
    input.setAttribute('aria-label', meta.label);
    const row = el('div', 'devpanel__row', el('div', 'row__text', label, keyEl), input, value);
    const refresh = (): void => {
      const v = TUNING[key];
      if (input.value !== String(v)) input.value = String(v);
      setText(value, `${formatValue(v, meta.step)} ${meta.unit}`);
      setClass(row, 'is-changed', v !== TUNING_DEFAULTS[key]);
    };
    input.addEventListener('input', () => {
      TUNING[key] = Number(input.value);
      refresh();
    });
    refresh();
    return { key, el: row, refresh };
  };

  const buildEnumRow = (key: EnumTuningKey): Row => {
    const meta = TUNING_ENUM_META[key];
    const select = el('select', 'row__select');
    select.setAttribute('aria-label', meta.label);
    for (const opt of meta.options) {
      const o = el('option', '', opt);
      o.value = opt;
      select.append(o);
    }
    const row = el('div', 'devpanel__row devpanel__row--enum', el('div', 'row__text', el('span', 'row__label', meta.label), el('span', 'row__key', `${key}  ${meta.reqId}`)), select);
    const refresh = (): void => {
      const v = String(TUNING[key]);
      if (select.value !== v) select.value = v;
      setClass(row, 'is-changed', v !== String(TUNING_DEFAULTS[key]));
    };
    select.addEventListener('change', () => {
      (TUNING as Record<string, unknown>)[key] = select.value;
      refresh();
    });
    refresh();
    return { key, el: row, refresh };
  };

  const rowByKey = new Map<string, Row>();
  const groups: { readonly name: string; readonly header: HTMLElement; readonly rows: Row[]; readonly box: HTMLElement }[] = [];

  // Enum rows live in the group their META names.
  const enumRowsByGroup = new Map<string, Row[]>();
  for (const key of enumKeys) {
    const row = buildEnumRow(key);
    rowByKey.set(key, row);
    const g = TUNING_ENUM_META[key].group;
    enumRowsByGroup.set(g, [...(enumRowsByGroup.get(g) ?? []), row]);
  }

  for (const section of TUNING_SECTIONS) {
    const header = el('div', 'devpanel__group', el('span', 'group__name', section.name), el('span', 'group__count'));
    const box = el('div', 'devpanel__groupbox');
    const groupRows: Row[] = [];
    for (const key of section.keys) {
      if (!(numericKeys as readonly string[]).includes(key)) continue;
      const row = buildRow(key as NumericTuningKey);
      rowByKey.set(key, row);
      groupRows.push(row);
    }
    for (const row of enumRowsByGroup.get(section.group) ?? []) groupRows.push(row);
    for (const r of groupRows) box.append(r.el);
    rows.push(...groupRows);
    groups.push({ name: section.name, header, rows: groupRows, box });
    body.append(header, box);
  }

  const matches = (row: Row): boolean => {
    if (!query) return true;
    const meta = (TUNING_META as Record<string, { label: string; reqId: string } | undefined>)[row.key] ?? (TUNING_ENUM_META as Record<string, { label: string; reqId: string } | undefined>)[row.key];
    const hay = `${row.key} ${meta?.label ?? ''} ${meta?.reqId ?? ''}`.toLowerCase();
    return hay.includes(query);
  };

  const resetAll = (): void => {
    resetTuning();
    for (const r of rows) r.refresh();
  };

  const layout = (): void => {
    // Reset all is the first pad stop, so a pad user can always get back to the defaults.
    const items: FocusItem[] = [{ el: resetBtn, onConfirm: resetAll }];
    let shown = 0;
    for (const g of groups) {
      const visible = g.rows.filter(matches);
      const isFolded = folded.has(g.name) && !query;
      g.header.style.display = visible.length > 0 ? '' : 'none';
      setClass(g.header, 'is-folded', isFolded);
      setText(g.header.querySelector('.group__count') as HTMLElement, `${visible.length}`);
      g.box.style.display = visible.length > 0 && !isFolded ? '' : 'none';
      for (const r of g.rows) r.el.style.display = matches(r) ? '' : 'none';
      if (visible.length === 0) continue;
      items.push({
        el: g.header,
        onConfirm: () => {
          if (folded.has(g.name)) folded.delete(g.name);
          else folded.add(g.name);
          const keep = focus.index;
          layout();
          focus.focus(keep);
        },
      });
      if (isFolded) continue;
      for (const r of visible) {
        shown += 1;
        items.push({
          el: r.el,
          onAdjust: (delta) => {
            const key = r.key;
            if ((numericKeys as readonly string[]).includes(key)) {
              const k = key as NumericTuningKey;
              const meta = TUNING_META[k];
              const next = Math.min(meta.max, Math.max(meta.min, TUNING[k] + delta * meta.step));
              TUNING[k] = Number(next.toFixed(6));
            } else {
              const k = key as EnumTuningKey;
              const opts = TUNING_ENUM_META[k].options as readonly string[];
              const i = opts.indexOf(String(TUNING[k]));
              const n = (i + delta + opts.length) % opts.length;
              (TUNING as Record<string, unknown>)[k] = opts[n];
            }
            r.refresh();
            return true;
          },
        });
      }
    }
    setText(count, `${shown} of ${rows.length}`);
    // The first open starts on the first group, one below Reset all, so a stray confirm resets nothing.
    const keep = laidOut ? focus.index : 1;
    laidOut = true;
    focus.setItems(items, { columns: 1, wrap: true, initial: Math.min(keep, Math.max(0, items.length - 1)) });
  };

  filter.addEventListener('input', () => {
    query = filter.value.trim().toLowerCase();
    layout();
  });

  const setOpen = (next: boolean): void => {
    open = next;
    panel.style.display = open ? '' : 'none';
    if (open) {
      for (const r of rows) r.refresh();
      layout();
    }
  };

  return {
    get open() {
      return open;
    },
    toggle() {
      setOpen(!open);
    },
    handle(nav) {
      if (!open) return false;
      if (nav.back || nav.dev) {
        setOpen(false);
        return true;
      }
      return focus.handle(nav);
    },
    dispose() {
      focus.clear();
      clear(panel);
      panel.remove();
    },
  };
}
