// @vitest-environment happy-dom
// tests/hud.test.ts (ui track): REQ-HUD-01, 03, 04, 06 and REQ-BAL-06 / REQ-NPC-02 on the DOM HUD.
// Clock text and red pulse, the combo ticker within one frame, land text and gap splash timing,
// the MacGuffin splash and toast, the balance meters' axes, the NPC dialog's open / close rules.
import { afterEach, describe, expect, it } from 'vitest';
import { restSnapshot } from '../src/core/mock';
import { TUNING } from '../src/core/tuning';
import type { ComboView, SimSnapshot } from '../src/core/types';
import { BRANDS } from '../src/data/brands';
import { createHud, npcTitleFor, TICKER_MORE, tickerText } from '../src/ui/hud';
import { formatClock, formatComboTotal, formatMultiplier, formatScore } from '../src/ui/format';
import { NO_NAV } from '../src/ui/root';
import { STREET_GOALS } from './fixtures/ui/goals';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(): { readonly hud: ReturnType<typeof createHud>; readonly root: HTMLElement } {
  const root = document.createElement('div');
  document.body.append(root);
  return { hud: createHud(root), root };
}

function text(root: HTMLElement, selector: string): string {
  return (root.querySelector(selector) as HTMLElement | null)?.textContent ?? '';
}

function has(root: HTMLElement, selector: string, className: string): boolean {
  return (root.querySelector(selector) as HTMLElement | null)?.classList.contains(className) ?? false;
}

function snap(patch: (s: SimSnapshot) => SimSnapshot = (s) => s): SimSnapshot {
  return patch(restSnapshot('marketStreet'));
}

const COMBO: ComboView = {
  elements: [],
  names: ['50-50', 'Smith', 'Kickflip', 'Revert', 'Manual'],
  base: 1644,
  multiplier: 9.5,
  spin180s: 1,
  final: 15618,
};

describe('format helpers (REQ-HUD-01, REQ-HUD-03)', () => {
  it('clock reads m:ss and rounds up so 0:01 shows until the clock hits zero', () => {
    expect(formatClock(120)).toBe('2:00');
    expect(formatClock(83.2)).toBe('1:24');
    expect(formatClock(9.5)).toBe('0:10');
    expect(formatClock(0.4)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('score and combo totals are whole numbers with thousands separators, x between them', () => {
    expect(formatScore(46600.7)).toBe('46,600');
    expect(formatMultiplier(9)).toBe('9');
    expect(formatMultiplier(9.5)).toBe('9.5');
    expect(formatComboTotal(1644.4, 9.5)).toBe('1,644 x 9.5');
  });
});

describe('HUD top row', () => {
  it('shows the clock top centre, the score and the letter tray from the snapshot', () => {
    const { hud, root } = mount();
    hud.update(snap((s) => ({ ...s, run: { ...s.run, clockS: 83, score: 46600, letters: { C: true, O: true, D: false, E: false } } })), 1 / 60);
    expect(text(root, '.hud__clock')).toBe('1:23');
    expect(text(root, '.hud__scoreValue')).toBe('46,600');
    const letters = Array.from(root.querySelectorAll('.letter')).map((l) => `${l.textContent}${l.classList.contains('is-got') ? '*' : ''}`);
    expect(letters).toEqual(['C*', 'O*', 'D', 'E']);
    expect(has(root, '.hud__clock', 'is-red')).toBe(false);
  });

  it('pulses red under CLOCK_RED_S and marks overtime', () => {
    const { hud, root } = mount();
    hud.update(snap((s) => ({ ...s, run: { ...s.run, clockS: TUNING.CLOCK_RED_S - 0.5 } })), 1 / 60);
    expect(has(root, '.hud__clock', 'is-red')).toBe(true);
    hud.update(snap((s) => ({ ...s, run: { ...s.run, clockS: 0, overtime: true } })), 1 / 60);
    expect(has(root, '.hud__clock', 'is-overtime')).toBe(true);
    expect(text(root, '.hud__clock')).toBe('0:00');
  });
});

describe('combo ticker (REQ-HUD-03)', () => {
  it('joins names with " + " and shows base x multiplier in the same frame the combo appears', () => {
    const { hud, root } = mount();
    hud.update(snap(), 1 / 60);
    expect(has(root, '.hud__ticker', 'is-visible')).toBe(false);
    hud.update(snap((s) => ({ ...s, combo: COMBO })), 1 / 60);
    expect(has(root, '.hud__ticker', 'is-visible')).toBe(true);
    expect(text(root, '.ticker__names')).toBe('50-50 + Smith + Kickflip + Revert + Manual');
    expect(text(root, '.ticker__total')).toBe('1,644 x 9.5');
    hud.update(snap((s) => ({ ...s, combo: { ...COMBO, base: 1700.9, multiplier: 10 } })), 1 / 60);
    expect(text(root, '.ticker__total')).toBe('1,700 x 10');
  });

  it('a long combo keeps its newest names on screen: the oldest drop behind a leading "... +"', () => {
    const { hud, root } = mount();
    const names = Array.from({ length: TUNING.UI_TICKER_MAX_NAMES + 11 }, (_, i) => `Trick ${i + 1}`);
    hud.update(snap((s) => ({ ...s, combo: { ...COMBO, names } })), 1 / 60);
    const shown = text(root, '.ticker__names');
    expect(shown.startsWith(TICKER_MORE)).toBe(true);
    expect(shown.endsWith(`+ Trick ${names.length}`)).toBe(true);
    expect(shown).not.toContain('Trick 1 +');
    expect(shown.slice(TICKER_MORE.length).split(' + ').length).toBe(TUNING.UI_TICKER_MAX_NAMES);
    expect(tickerText(['A', 'B'], 2)).toBe('A + B');
    expect(tickerText(['A', 'B', 'C'], 2)).toBe(`${TICKER_MORE}B + C`);
  });

  it('flashes on elementAdded for UI_TICKER_FLASH_S', () => {
    const { hud, root } = mount();
    hud.update(snap((s) => ({ ...s, combo: COMBO })), 0);
    hud.onEvent({ type: 'elementAdded', tick: 1, element: { id: 'kickflip', category: 'flip', name: 'Kickflip', value: 100, accrual: 0, open: false }, index: 0, combo: COMBO });
    hud.update(snap((s) => ({ ...s, combo: COMBO })), 0);
    expect(has(root, '.hud__ticker', 'is-flash')).toBe(true);
    hud.update(snap((s) => ({ ...s, combo: COMBO })), TUNING.UI_TICKER_FLASH_S + 0.01);
    expect(has(root, '.hud__ticker', 'is-flash')).toBe(false);
  });
});

describe('land text and gap splash (REQ-HUD-04)', () => {
  const land = (quality: 'clean' | 'ok') => ({ type: 'land' as const, tick: 10, quality, offAxisDeg: quality === 'ok' ? 20 : 3, tiltDeg: 2, vert: false, speed: 7, pos: { x: 0, y: 0, z: 0 }, linker: 'none' as const });

  it('clean shows nothing, OK shows "OK" for LAND_TEXT_S', () => {
    const { hud, root } = mount();
    hud.onEvent(land('clean'));
    hud.update(snap(), 0);
    expect(has(root, '.hud__land', 'is-visible')).toBe(false);
    hud.onEvent(land('ok'));
    hud.update(snap(), 0);
    expect(has(root, '.hud__land', 'is-visible')).toBe(true);
    expect(text(root, '.hud__land')).toBe('OK');
    hud.update(snap(), TUNING.LAND_TEXT_S / 2);
    expect(has(root, '.hud__land', 'is-visible')).toBe(true);
    hud.update(snap(), TUNING.LAND_TEXT_S / 2 + 0.01);
    expect(has(root, '.hud__land', 'is-visible')).toBe(false);
  });

  it('SICK and INSANE arrive on comboBanked and replace the land text; clean banks change nothing', () => {
    const { hud, root } = mount();
    const banked = (quality: 'clean' | 'ok' | 'sick' | 'insane') => ({ type: 'comboBanked' as const, tick: 20, final: 15504, base: 1632, multiplier: 9.5, elementCount: 8, quality, runScore: 15504 });
    hud.onEvent(land('ok'));
    hud.onEvent(banked('sick'));
    hud.update(snap(), 0);
    expect(text(root, '.hud__land')).toBe('SICK');
    expect(has(root, '.hud__land', 'is-sick')).toBe(true);
    hud.onEvent(banked('insane'));
    hud.update(snap(), 0);
    expect(text(root, '.hud__land')).toBe('INSANE');
    expect(has(root, '.hud__land', 'is-insane')).toBe(true);
    // INSANE holds longer than OK / SICK (UI_LAND_TEXT_INSANE_S >= LAND_TEXT_S).
    expect(TUNING.UI_LAND_TEXT_INSANE_S).toBeGreaterThanOrEqual(TUNING.LAND_TEXT_S);
    hud.update(snap(), TUNING.LAND_TEXT_S + 0.01);
    expect(has(root, '.hud__land', 'is-visible')).toBe(TUNING.UI_LAND_TEXT_INSANE_S > TUNING.LAND_TEXT_S + 0.01);
    hud.update(snap(), TUNING.UI_LAND_TEXT_INSANE_S);
    expect(has(root, '.hud__land', 'is-visible')).toBe(false);
    hud.onEvent(banked('clean'));
    hud.update(snap(), 0);
    expect(has(root, '.hud__land', 'is-visible')).toBe(false);
  });

  it('a bail cancels the land text', () => {
    const { hud, root } = mount();
    hud.onEvent(land('ok'));
    hud.onEvent({ type: 'bail', tick: 11, reason: 'landing', speed: 7, pos: { x: 0, y: 0, z: 0 } });
    hud.update(snap(), 0);
    expect(has(root, '.hud__land', 'is-visible')).toBe(false);
  });

  it('gap splash shows the name and "+base" for GAP_SPLASH_S', () => {
    const { hud, root } = mount();
    hud.onEvent({ type: 'gap', tick: 30, gapId: 'MS-G10', name: 'BILLBOARD GAP', base: 1000 });
    hud.update(snap(), 0);
    expect(has(root, '.hud__gap', 'is-visible')).toBe(true);
    expect(text(root, '.gap__name')).toBe('BILLBOARD GAP');
    expect(text(root, '.gap__bonus')).toBe('+1,000');
    hud.update(snap(), TUNING.GAP_SPLASH_S - 0.05);
    expect(has(root, '.hud__gap', 'is-visible')).toBe(true);
    hud.update(snap(), 0.1);
    expect(has(root, '.hud__gap', 'is-visible')).toBe(false);
  });
});

describe('MacGuffin splash, toasts, letters, special bar (REQ-HUD-01)', () => {
  it('shows the full-width splash text from the event for MACGUFFIN_SPLASH_S and the toast', () => {
    const { hud, root } = mount();
    hud.onEvent({ type: 'macguffin', tick: 40, id: 'secret_laptop', name: 'n', splash: 'MOCK SPLASH', toast: 'mock toast', hitstopTicks: 7, pos: { x: 0, y: 0, z: 0 } });
    hud.update(snap(), 0);
    expect(has(root, '.hud__splash', 'is-visible')).toBe(true);
    expect(text(root, '.splash__text')).toBe('MOCK SPLASH');
    expect(Array.from(root.querySelectorAll('.toast')).map((t) => t.textContent)).toEqual(['mock toast']);
    hud.update(snap(), TUNING.MACGUFFIN_SPLASH_S + 0.01);
    expect(has(root, '.hud__splash', 'is-visible')).toBe(false);
  });

  it('keeps at most UI_TOAST_MAX toasts and drops them after their time', () => {
    const { hud, root } = mount();
    for (let i = 0; i < TUNING.UI_TOAST_MAX + 2; i++) hud.toast(`t${i}`, 1);
    hud.update(snap(), 0);
    expect(root.querySelectorAll('.toast').length).toBe(TUNING.UI_TOAST_MAX);
    hud.update(snap(), 1.01);
    expect(root.querySelectorAll('.toast').length).toBe(0);
  });

  it('a letter event flashes that tray slot', () => {
    const { hud, root } = mount();
    hud.onEvent({ type: 'letter', tick: 50, letter: 'O', collected: ['O'], pos: { x: 0, y: 0, z: 0 } });
    hud.update(snap(), 0);
    const slots = Array.from(root.querySelectorAll('.letter'));
    expect(slots.map((l) => l.classList.contains('is-flash'))).toEqual([false, true, false, false]);
    hud.update(snap(), TUNING.UI_LETTER_FLASH_S + 0.01);
    expect(slots[1]?.classList.contains('is-flash')).toBe(false);
  });

  it('special bar width follows the meter and glows when full', () => {
    const { hud, root } = mount();
    hud.update(snap((s) => ({ ...s, special: { meter: 0.42, glowing: false, activeId: null, heldS: 0 } })), 0);
    expect((root.querySelector('.special__fill') as HTMLElement).style.width).toBe('42.0%');
    expect(has(root, '.hud__special', 'is-glowing')).toBe(false);
    hud.update(snap((s) => ({ ...s, special: { meter: 1, glowing: true, activeId: null, heldS: 0 } })), 0);
    expect((root.querySelector('.special__fill') as HTMLElement).style.width).toBe('100.0%');
    expect(has(root, '.hud__special', 'is-glowing')).toBe(true);
  });
});

describe('balance meter (REQ-BAL-06)', () => {
  it('grind / lip use the horizontal arc, manual the vertical bar; nothing without a needle', () => {
    const { hud, root } = mount();
    hud.update(snap(), 0);
    expect(has(root, '.hud__balance--h', 'is-visible')).toBe(false);
    expect(has(root, '.hud__balance--v', 'is-visible')).toBe(false);
    hud.update(snap((s) => ({ ...s, balance: { needle: 0.5, axis: 'h' } })), 0);
    expect(has(root, '.hud__balance--h', 'is-visible')).toBe(true);
    expect(has(root, '.hud__balance--v', 'is-visible')).toBe(false);
    expect((root.querySelector('.arc__needle') as SVGGElement).getAttribute('transform')).toMatch(/^rotate\(40\.00 /);
    hud.update(snap((s) => ({ ...s, balance: { needle: -0.5, axis: 'v' } })), 0);
    expect(has(root, '.hud__balance--h', 'is-visible')).toBe(false);
    expect(has(root, '.hud__balance--v', 'is-visible')).toBe(true);
    // Negative = nose down: the marker sits below centre.
    expect((root.querySelector('.bar__needle') as HTMLElement).style.top).toBe('75.00%');
  });

  it('marks danger at |needle| >= 0.7 and follows the projector when one is set', () => {
    const { hud, root } = mount();
    hud.update(snap((s) => ({ ...s, balance: { needle: 0.8, axis: 'h' } })), 0);
    expect(has(root, '.hud__balance--h', 'is-danger')).toBe(true);
    expect(has(root, '.hud__balance--h', 'is-projected')).toBe(false);
    hud.setProjector(() => ({ x: 640, y: 200, visible: true }));
    hud.update(snap((s) => ({ ...s, balance: { needle: 0.1, axis: 'h' } })), 0);
    const arc = root.querySelector('.hud__balance--h') as HTMLElement;
    expect(arc.classList.contains('is-projected')).toBe(true);
    expect(parseFloat(arc.style.left)).toBe(640);
    expect(parseFloat(arc.style.top)).toBe(200);
    expect(arc.classList.contains('is-danger')).toBe(false);
  });
});

describe('manual bar placement (REQ-BAL-06)', () => {
  /** Side-on camera: k screen px per metre, feet of the rest skater near (640, 500). */
  const sideOn = (k: number) => (w: { x: number; y: number; z: number }) => ({ x: 640 + w.x * k, y: 500 - w.y * k, visible: true });
  const gapPx = (root: HTMLElement): number => {
    const m = /translate\((-?[\d.]+)px/.exec((root.querySelector('.hud__balance--v') as HTMLElement).style.transform);
    return m ? parseFloat(m[1] as string) : NaN;
  };

  it('keeps the bar clear of the body: the hip gap scales with the skater height on screen', () => {
    const { hud, root } = mount();
    const k = 150;
    hud.setProjector(sideOn(k));
    const s = snap((x) => ({ ...x, balance: { needle: 0, axis: 'v' } }));
    hud.update(s, 0);
    const screenH = TUNING.SKATER_HEIGHT_M * k * Math.hypot(s.skater.up.x, s.skater.up.y);
    expect(screenH * TUNING.UI_BALANCE_BAR_GAP_H).toBeGreaterThan(TUNING.UI_BALANCE_BAR_GAP_MIN_PX);
    expect(gapPx(root)).toBeCloseTo(screenH * TUNING.UI_BALANCE_BAR_GAP_H, 0);
  });

  it('never closer than UI_BALANCE_BAR_GAP_MIN_PX for a small skater, and drops the inline gap without a projector', () => {
    const { hud, root } = mount();
    hud.setProjector(sideOn(5));
    hud.update(snap((x) => ({ ...x, balance: { needle: 0, axis: 'v' } })), 0);
    expect(gapPx(root)).toBeCloseTo(TUNING.UI_BALANCE_BAR_GAP_MIN_PX, 5);
    hud.setProjector(null);
    hud.update(snap((x) => ({ ...x, balance: { needle: 0, axis: 'v' } })), 0);
    expect((root.querySelector('.hud__balance--v') as HTMLElement).style.transform).toBe('');
  });
});

describe('NPC dialog (REQ-NPC-02)', () => {
  it('shows the brand table title line under the short name (SPEC 11)', () => {
    const { hud, root } = mount();
    hud.onEvent({ type: 'npcTalk', tick: 60, npcId: 'sam', name: BRANDS.npcs.sam.name, line: BRANDS.npcs.sam.line });
    expect(text(root, '.npc__name')).toBe(BRANDS.npcs.sam.name);
    expect(text(root, '.npc__title')).toBe(BRANDS.npcs.sam.title);
    hud.onEvent({ type: 'npcTalk', tick: 90, npcId: 'dario', name: BRANDS.npcs.dario.name, line: BRANDS.npcs.dario.line });
    expect(text(root, '.npc__title')).toBe(BRANDS.npcs.dario.title);
    // A title that only repeats the name is not printed twice.
    expect(npcTitleFor('sam', BRANDS.npcs.sam.title)).toBe('');
  });


  it('opens on npcTalk, closes on confirm, reopens on the next npcTalk', () => {
    const { hud, root } = mount();
    expect(hud.npcOpen).toBe(false);
    hud.onEvent({ type: 'npcTalk', tick: 60, npcId: 'sam', name: 'Sam', line: 'mock line' });
    expect(hud.npcOpen).toBe(true);
    expect(text(root, '.npc__name')).toBe('Sam');
    expect(text(root, '.npc__line')).toBe('mock line');
    hud.nav({ ...NO_NAV, confirm: true, source: 'gamepad' });
    expect(hud.npcOpen).toBe(false);
    hud.onEvent({ type: 'npcTalk', tick: 90, npcId: 'sam', name: 'Sam', line: 'mock line' });
    expect(hud.npcOpen).toBe(true);
  });

  it('closes by itself after NPC_DIALOG_S', () => {
    const { hud } = mount();
    hud.onEvent({ type: 'npcTalk', tick: 60, npcId: 'dario', name: 'Dario', line: 'l' });
    hud.update(snap(), TUNING.NPC_DIALOG_S - 0.1);
    expect(hud.npcOpen).toBe(true);
    hud.update(snap(), 0.2);
    expect(hud.npcOpen).toBe(false);
  });
});

describe('goal peek', () => {
  it('shows last done and next goal in career runs only', () => {
    const { hud, root } = mount();
    hud.setGoals(STREET_GOALS, ['MS-GOAL-01']);
    hud.update(snap((s) => ({ ...s, run: { ...s.run, mode: 'free' } })), 0);
    expect(has(root, '.hud__goalpeek', 'is-visible')).toBe(false);
    hud.update(snap((s) => ({ ...s, run: { ...s.run, mode: 'career', goalsCompleted: [] } })), 0);
    expect(has(root, '.hud__goalpeek', 'is-visible')).toBe(true);
    expect(text(root, '.goalpeek__row--done')).toBe('Done: none yet');
    expect(text(root, '.goalpeek__row--next')).toBe('Next: Pro Score');
    hud.update(snap((s) => ({ ...s, run: { ...s.run, mode: 'career', goalsCompleted: ['MS-GOAL-02'] } })), 0);
    expect(text(root, '.goalpeek__row--done')).toBe('Done: Pro Score');
    expect(text(root, '.goalpeek__row--next')).toBe('Next: Sick Score');
  });
});

describe('REQ-HUD-06', () => {
  it('renders no em dash in any HUD text after a busy frame', () => {
    const { hud, root } = mount();
    hud.setGoals(STREET_GOALS, []);
    hud.onEvent({ type: 'gap', tick: 1, gapId: 'g', name: 'PLAZA BAR HOP', base: 500 });
    hud.onEvent({ type: 'npcTalk', tick: 1, npcId: 'sam', name: 'Sam', line: 'Hi.' });
    hud.toast('Controller connected');
    hud.update(snap((s) => ({ ...s, combo: COMBO, balance: { needle: 0, axis: 'h' }, run: { ...s.run, mode: 'career' } })), 0);
    expect(root.textContent).not.toContain('—');
  });
});
