// @vitest-environment happy-dom
// tests/uiFocus.test.ts (ui track): the focus manager (REQ-MNU-02), the results card builder
// (REQ-GOL-07, REQ-MNU-06), the glyph badges (REQ-HUD-05) and the REQ-HUD-06 text scan over the ui
// sources (no em dashes, no fetched fonts, system font stacks only).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/tuning';
import { BUTTONS, type Button, type GlyphSet, type NavInput } from '../src/core/types';
import { DEFAULT_SAVE, type SaveData } from '../src/save/types';
import { createFocusManager } from '../src/ui/focus';
import { buttonLabel, glyphBadge, hintBar, navHint } from '../src/ui/glyphs';
import { buildRunResults, goalDistance } from '../src/ui/results';
import { NO_NAV } from '../src/ui/root';
import type { FocusItem } from '../src/ui/types';
import { STREET_GOALS } from './fixtures/ui/goals';

afterEach(() => {
  document.body.innerHTML = '';
});

const nav = (patch: Partial<NavInput>): NavInput => ({ ...NO_NAV, ...patch, source: 'gamepad' });

function items(n: number, disabled: readonly number[] = []): { readonly items: FocusItem[]; readonly confirmed: number[] } {
  const confirmed: number[] = [];
  const list: FocusItem[] = [];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    document.body.append(el);
    list.push({ el, onConfirm: () => confirmed.push(i), disabled: disabled.includes(i) });
  }
  return { items: list, confirmed };
}

describe('FocusManager (REQ-MNU-02)', () => {
  it('moves with up / down, wraps, skips disabled items and confirms the focused one', () => {
    const moves: number[] = [];
    const blocked: number[] = [];
    const f = createFocusManager({ onMove: (i) => moves.push(i), onBlocked: (i) => blocked.push(i) });
    const { items: list, confirmed } = items(4, [2]);
    f.setItems(list, { columns: 1, wrap: true, initial: 0 });
    expect(f.index).toBe(0);
    expect(list[0]?.el.classList.contains('is-focused')).toBe(true);
    expect(f.handle(nav({ down: true }))).toBe(true);
    expect(f.index).toBe(1);
    f.handle(nav({ down: true }));
    expect(f.index).toBe(3);
    f.handle(nav({ down: true }));
    expect(f.index).toBe(0);
    f.handle(nav({ up: true }));
    expect(f.index).toBe(3);
    expect(moves).toEqual([1, 3, 0, 3]);
    f.handle(nav({ confirm: true }));
    expect(confirmed).toEqual([3]);
    f.focus(2);
    f.handle(nav({ confirm: true }));
    expect(confirmed).toEqual([3]);
    expect(blocked).toEqual([2]);
  });

  it('never starts on a disabled item and does not wrap when wrap is off', () => {
    const f = createFocusManager();
    const { items: list } = items(3, [0]);
    f.setItems(list, { wrap: false, initial: 0 });
    expect(f.index).toBe(1);
    f.handle(nav({ up: true }));
    expect(f.index).toBe(1);
    f.handle(nav({ down: true }));
    expect(f.index).toBe(2);
    expect(f.handle(nav({ down: true }))).toBe(false);
    expect(f.index).toBe(2);
  });

  it('left / right adjust a slider first, else move within a grid', () => {
    const f = createFocusManager();
    const deltas: number[] = [];
    const { items: list } = items(4);
    const grid = list.map((it, i) => (i === 0 ? { ...it, onAdjust: (d: -1 | 1) => { deltas.push(d); return true; } } : it));
    f.setItems(grid, { columns: 2, wrap: true });
    f.handle(nav({ right: true }));
    expect(deltas).toEqual([1]);
    expect(f.index).toBe(0);
    f.handle(nav({ down: true }));
    expect(f.index).toBe(2);
    f.handle(nav({ right: true }));
    expect(f.index).toBe(3);
    f.handle(nav({ left: true }));
    expect(f.index).toBe(2);
    f.handle(nav({ up: true }));
    expect(f.index).toBe(0);
  });

  it('back calls the screen handler, even with no items; mouse hover and click work', () => {
    const f = createFocusManager();
    let backs = 0;
    f.setItems([], {});
    f.setOnBack(() => (backs += 1));
    expect(f.handle(nav({ back: true }))).toBe(true);
    expect(backs).toBe(1);
    const { items: list, confirmed } = items(3);
    f.setItems(list, {});
    list[2]?.el.dispatchEvent(new Event('pointerenter'));
    expect(f.index).toBe(2);
    list[1]?.el.click();
    expect(confirmed).toEqual([1]);
    expect(f.index).toBe(1);
    f.clear();
    expect(f.handle(nav({ confirm: true }))).toBe(false);
  });
});

describe('glyph badges and hints (REQ-HUD-05)', () => {
  it('labels follow the set through the input track table, with a fallback to the button name', () => {
    for (const set of ['xbox', 'playstation', 'keyboard'] as const) {
      for (const b of BUTTONS) {
        const label = buttonLabel(set, b);
        expect(label.length).toBeGreaterThan(0);
        const badge = glyphBadge(set, b);
        expect(badge.getAttribute('aria-label')).toBe(label);
        expect(badge.classList.contains(`glyph--${set}`)).toBe(true);
      }
    }
  });

  it('PlayStation face buttons draw the SPEC shapes, others draw text', () => {
    const faces: readonly Button[] = ['ollie', 'grab', 'flip', 'grind'];
    for (const b of faces) {
      expect(glyphBadge('playstation', b).querySelector('svg')).not.toBeNull();
      expect(glyphBadge('xbox', b).querySelector('svg')).toBeNull();
      expect(glyphBadge('xbox', b).querySelector('.glyph__text')?.textContent).toBe(buttonLabel('xbox', b));
    }
    expect(glyphBadge('playstation', 'revert').querySelector('svg')).toBeNull();
  });

  it('hint bars pair a badge with the verb text; keyboard shows key names', () => {
    const bar = hintBar('xbox', [['confirm', 'Select'], ['back', 'Back'], ['move', 'Move']]);
    const hints = Array.from(bar.querySelectorAll('.hint'));
    expect(hints.map((h) => h.querySelector('.hint__text')?.textContent)).toEqual(['Select', 'Back', 'Move']);
    expect(hints[0]?.querySelector('.glyph__text')?.textContent).toBe(buttonLabel('xbox', 'ollie'));
    expect(hints[2]?.querySelector('.glyph__text')?.textContent).toBe('D-pad');
    expect(navHint('keyboard', 'confirm', 'Go').querySelector('.glyph__text')?.textContent).toBe('Enter');
    expect(navHint('keyboard', 'back', 'Back').querySelector('.glyph__text')?.textContent).toBe('Esc');
    const sets: GlyphSet[] = ['xbox', 'playstation', 'keyboard'];
    for (const s of sets) expect(hintBar(s, [['confirm', 'x']]).textContent).not.toContain('—');
  });
});

describe('buildRunResults (REQ-GOL-07, REQ-MNU-06)', () => {
  const runEnd = (patch: Partial<Parameters<typeof buildRunResults>[0]> = {}): Parameters<typeof buildRunResults>[0] => ({
    type: 'runEnd', tick: 14400, levelId: 'marketStreet', mode: 'career', score: 12000, bestCombo: 5504, goalsCompleted: [], letters: ['C', 'O', 'D'], macguffin: false, ...patch,
  });
  const withGoals = (ids: readonly string[], flags: Partial<SaveData['career']> = {}): SaveData => ({ ...DEFAULT_SAVE, career: { ...DEFAULT_SAVE.career, goals: { marketStreet: [...ids], woodshed: [], labCampus: [] }, ...flags } });

  it('names completed goals and picks the nearest uncompleted goal with a distance text', () => {
    const r = buildRunResults(runEnd({ goalsCompleted: ['MS-GOAL-07'] }), DEFAULT_SAVE, withGoals(['MS-GOAL-07']), STREET_GOALS);
    expect(r.goalsCompleted).toEqual([{ id: 'MS-GOAL-07', name: 'Grind the Bus Stop Bar' }]);
    // 12,000 of STREET_HIGH_SCORE is the smallest fraction left; the text names what is missing.
    const expectedLeft = Math.max(0, TUNING.STREET_HIGH_SCORE - 12000);
    expect(r.nextGoal).toEqual({ name: 'High Score', distance: `${expectedLeft.toLocaleString('en-US')} to go` });
    expect(r.letters).toEqual(['C', 'O', 'D']);
    expect(r.score).toBe(12000);
    expect(r.bestCombo).toBe(5504);
  });

  it('skips goals already done in the career and reports letters and MacGuffins by name', () => {
    const done = STREET_GOALS.filter((g) => g.index !== 5 && g.index !== 6).map((g) => g.id);
    const r = buildRunResults(runEnd(), withGoals(done), withGoals(done), STREET_GOALS);
    expect(r.nextGoal?.name).toBe('C-O-D-E');
    expect(r.nextGoal?.distance).toBe('missing E');
    const mg = goalDistance(STREET_GOALS[5] as (typeof STREET_GOALS)[number], runEnd());
    expect(mg.text.startsWith('find the ')).toBe(true);
    expect(mg.text).not.toContain('—');
  });

  it('unlock lines appear only for flags that flipped, plus new bests', () => {
    const before = withGoals([]);
    const after = withGoals([], { woodshedUnlocked: true, labCircuitStamp: true });
    const r = buildRunResults(runEnd({ score: 100, bestCombo: 50 }), before, after, STREET_GOALS);
    expect(r.unlocks).toEqual(['Woodshed unlocked', 'Lab Circuit stamp', 'New best score', 'New best combo']);
    const none = buildRunResults(runEnd({ score: 0, bestCombo: 0 }), after, after, STREET_GOALS);
    expect(none.unlocks).toEqual([]);
  });

  it('a free skate run lists no goals and every string is em dash free', () => {
    const r = buildRunResults(runEnd({ mode: 'free', goalsCompleted: [] }), DEFAULT_SAVE, DEFAULT_SAVE, STREET_GOALS);
    expect(r.goalsCompleted).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('—');
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('REQ-HUD-06 source scan', () => {
  const files = [...walk(join(process.cwd(), 'src', 'ui')), ...walk(join(process.cwd(), 'src', 'save'))];

  it('no em dash in any ui or save source file (comments included, so none can leak into a string)', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('—'));
    expect(offenders).toEqual([]);
  });

  it('the stylesheet fetches nothing: no @import, @font-face or url()', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'styles.css'), 'utf8');
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/url\(/);
    expect(css).toMatch(/system-ui/);
  });
});
