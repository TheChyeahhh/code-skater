// @vitest-environment happy-dom
// tests/ui.test.ts (ui track): the UI root and every screen driven by pad input only (REQ-MNU-01..04,
// REQ-MNU-06, REQ-LAB-01..03, REQ-INP-08, REQ-DEP-07). Main menu to park select to goal list to
// startRun; Free Skate; the Woodshed lock; the Lab Circuit stamp; options (volumes, quality, the
// two-step Reset career); the Board Lab picks and controller sticker placement; results; the
// controller-lost overlay; the dev tuning panel over TUNING_META.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restSnapshot } from '../src/core/mock';
import { resetTuning, TUNING, TUNING_ENUM_META, TUNING_META, type NumericTuningKey } from '../src/core/tuning';
import { DEFAULT_BOARD, type BoardConfig, type GameOptions, type NavInput, type ParkId, type RunMode } from '../src/core/types';
import { DEFAULT_SAVE, type SaveData } from '../src/save/types';
import { createUiRoot, NO_NAV, type UiRootExt } from '../src/ui/root';
import type { RunResults, UiActions, UiState } from '../src/ui/types';
import { STICKERS_PER_SHEET } from '../src/ui/labArt';
import { stickerFits } from '../src/ui/stickerBounds';
import { MOCK_GOALS } from './fixtures/ui/goals';

interface Harness {
  readonly ui: UiRootExt;
  readonly root: HTMLElement;
  readonly calls: string[];
  readonly sounds: string[];
  setSave(next: SaveData): void;
  setGlyphs(set: UiState['glyphs']): void;
  readonly save: () => SaveData;
  press(verb: Parameters<UiRootExt['press']>[0], times?: number): void;
  frame(patch: Partial<NavInput>, dt?: number): void;
  text(selector: string): string;
  visible(selector: string): boolean;
}

function harness(initial: SaveData = DEFAULT_SAVE): Harness {
  const root = document.createElement('div');
  document.body.append(root);
  const calls: string[] = [];
  const sounds: string[] = [];
  let save = initial;
  let glyphs: UiState['glyphs'] = 'xbox';
  const push = (): void => ui.setState({ save, glyphs, brandMode: 'parody', version: 'v0.1', goals: MOCK_GOALS });
  const actions: UiActions = {
    startRun: (level: ParkId, mode: RunMode) => calls.push(`startRun ${level} ${mode}`),
    resume: () => calls.push('resume'),
    restartRun: () => calls.push('restartRun'),
    quitToMenu: () => calls.push('quitToMenu'),
    setOptions: (o: GameOptions) => {
      calls.push(`setOptions ${JSON.stringify(o)}`);
      save = { ...save, options: o };
      push();
    },
    resetCareer: () => {
      calls.push('resetCareer');
      save = { ...save, career: DEFAULT_SAVE.career };
      push();
    },
    setBoard: (b: BoardConfig) => {
      calls.push(`setBoard ${b.deckGraphic} ${b.grip} ${b.trucks} ${b.wheels} ${b.stickers.length}`);
      save = { ...save, board: b };
      push();
    },
    loadMusicFolder: (files) => Promise.resolve(files.length),
    uiSound: (k) => sounds.push(k),
  };
  const ui = createUiRoot(root, { actions, boardPreview: null });
  push();
  return {
    ui, root, calls, sounds,
    setSave: (next) => {
      save = next;
      push();
    },
    setGlyphs: (set) => {
      glyphs = set;
      push();
    },
    save: () => save,
    press: (verb, times = 1) => {
      for (let i = 0; i < times; i++) ui.press(verb);
    },
    frame: (patch, dt = 1 / 60) => ui.update({ ...NO_NAV, ...patch, source: 'gamepad' }, dt),
    text: (selector) => (root.querySelector(selector) as HTMLElement | null)?.textContent ?? '',
    visible: (selector) => (root.querySelector(selector) as HTMLElement | null)?.classList.contains('is-visible') ?? false,
  };
}

const unlocked: SaveData = { ...DEFAULT_SAVE, career: { ...DEFAULT_SAVE.career, goals: { marketStreet: ['a', 'b', 'c', 'd', 'e', 'f'], woodshed: [], labCampus: [] }, woodshedUnlocked: true } };

afterEach(() => {
  document.body.innerHTML = '';
  resetTuning();
});

describe('main menu and career flow (REQ-MNU-01, REQ-MNU-02)', () => {
  it('lists the five entries in order and reaches every screen with the pad, back returns to the menu', () => {
    const h = harness();
    h.ui.show('mainMenu');
    expect(Array.from(h.root.querySelectorAll('.menu__label')).map((e) => e.textContent)).toEqual(['Career', 'Free Skate', 'Board Lab', 'Options', 'Credits']);
    expect(h.text('.title')).toBe('CodeSkater');
    const reach = (downs: number, screen: string): void => {
      h.ui.show('mainMenu');
      h.press('down', downs);
      h.press('confirm');
      expect(h.ui.screen).toBe(screen);
      h.press('back');
      expect(h.ui.screen).toBe('mainMenu');
      // Back restored the focus to the entry it left from; walk up to the top for the next one.
      h.press('up', downs);
    };
    reach(0, 'parkSelect');
    reach(1, 'parkSelect');
    reach(2, 'boardLab');
    reach(3, 'options');
    reach(4, 'credits');
    expect(h.calls).toEqual([]);
  });

  it('back lands on the item you came from, not the first one', () => {
    const h = harness();
    const focused = (): string => (h.root.querySelector('.screen.is-active .is-focused .menu__label, .screen.is-active .option.is-focused .option__label') as HTMLElement | null)?.textContent ?? '';
    h.ui.show('mainMenu');
    h.press('down', 3);
    h.press('confirm');
    expect(h.ui.screen).toBe('options');
    h.press('back');
    expect(h.ui.screen).toBe('mainMenu');
    expect(focused()).toBe('Options');
    h.press('down');
    h.press('confirm');
    expect(h.ui.screen).toBe('credits');
    h.press('back');
    expect(focused()).toBe('Credits');
    // Options > Controls view > back lands on Controls.
    h.press('up');
    h.press('confirm');
    h.press('down', 5);
    expect(focused()).toBe('Controls');
    h.press('confirm');
    expect(h.root.querySelector('.controls')).not.toBeNull();
    h.press('back');
    expect(h.root.querySelector('.controls')).toBeNull();
    expect(focused()).toBe('Controls');
  });

  it('Career: park select -> goal list with ten rows -> Start run calls startRun(marketStreet, career)', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.press('confirm');
    expect(h.ui.screen).toBe('parkSelect');
    expect(h.text('.subheading')).toContain('Career');
    h.press('confirm');
    expect(h.ui.screen).toBe('goalList');
    expect(h.root.querySelectorAll('.screen--goalList .goals__row').length).toBe(10);
    expect(h.text('.screen--goalList .heading')).toBe('Market Street');
    h.press('confirm');
    expect(h.calls).toEqual(['startRun marketStreet career']);
    h.press('back');
    expect(h.ui.screen).toBe('parkSelect');
    h.press('back');
    expect(h.ui.screen).toBe('mainMenu');
  });

  it('Free Skate starts the run straight from park select', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.press('down');
    h.press('confirm');
    expect(h.ui.screen).toBe('parkSelect');
    expect(h.text('.subheading')).toContain('Free Skate');
    h.press('confirm');
    expect(h.calls).toEqual(['startRun marketStreet free']);
  });

  it('Woodshed is locked until UNLOCK_WOODSHED_GOALS Street goals: confirm is blocked, then allowed', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.press('confirm');
    expect(h.text('.card--woodshed .card__lock')).toBe(`Locked: ${TUNING.UNLOCK_WOODSHED_GOALS} of 10 Street goals`);
    expect(h.root.querySelector('.card--woodshed')?.classList.contains('is-locked')).toBe(true);
    h.press('right');
    // The locked card cannot take focus: confirm still targets Market Street.
    h.ui.press('confirm');
    expect(h.calls).toEqual([]);
    expect(h.ui.screen).toBe('goalList');
    expect(h.text('.screen--goalList .heading')).toBe('Market Street');
    h.ui.show('mainMenu');
    h.setSave(unlocked);
    h.press('confirm');
    expect(h.root.querySelector('.card--woodshed')?.classList.contains('is-locked')).toBe(false);
    h.press('right');
    h.press('confirm');
    expect(h.ui.screen).toBe('goalList');
    expect(h.text('.screen--goalList .heading')).toBe('Woodshed');
    h.press('confirm');
    expect(h.calls).toEqual(['startRun woodshed career']);
  });

  it('the Lab Circuit stamp shows only with both MacGuffins', () => {
    const h = harness();
    h.ui.show('mainMenu');
    expect(h.visible('.stamp')).toBe(false);
    h.setSave({ ...DEFAULT_SAVE, career: { ...DEFAULT_SAVE.career, macguffins: ['secret_laptop', 'secret_drive'], labCircuitStamp: true } });
    expect(h.visible('.stamp')).toBe(true);
    expect(h.text('.stamp')).toContain('Circuit');
  });

  it('menu blips: move, confirm and back sounds go through uiSound', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.press('down');
    h.press('confirm');
    h.press('back');
    expect(h.sounds).toEqual(['move', 'confirm', 'back']);
  });
});

describe('pause (REQ-MNU-03)', () => {
  it('shows the goal list with this run\'s completions, Resume / Restart / Options / Quit, back resumes', () => {
    const h = harness({ ...DEFAULT_SAVE, career: { ...DEFAULT_SAVE.career, goals: { marketStreet: ['MS-GOAL-01'], woodshed: [], labCampus: [] } } });
    const s = restSnapshot('marketStreet');
    h.ui.show('hud');
    h.ui.hud.update({ ...s, run: { ...s.run, mode: 'career', goalsCompleted: ['MS-GOAL-07'] } }, 0);
    h.ui.show('pause');
    expect(Array.from(h.root.querySelectorAll('.screen--pause .button')).map((b) => b.textContent)).toEqual(['Resume', 'Restart run', 'Options', 'Quit to menu']);
    const rows = Array.from(h.root.querySelectorAll('.screen--pause .goals__row'));
    expect(rows.length).toBe(10);
    expect(rows[0]?.classList.contains('is-done')).toBe(true);
    expect(rows[6]?.classList.contains('is-fresh')).toBe(true);
    expect(rows[1]?.classList.contains('is-done')).toBe(false);
    h.press('down');
    h.press('confirm');
    expect(h.calls).toEqual(['restartRun']);
    h.press('down');
    h.press('down');
    h.press('confirm');
    expect(h.calls).toEqual(['restartRun', 'quitToMenu']);
    h.press('back');
    expect(h.calls).toEqual(['restartRun', 'quitToMenu', 'resume']);
    // Focus is still on Quit to menu: one step up is Options.
    h.press('up');
    h.press('confirm');
    expect(h.ui.screen).toBe('options');
    h.press('back');
    expect(h.ui.screen).toBe('pause');
  });
});

describe('options (REQ-MNU-04, REQ-SAV-02)', () => {
  it('quality cycles, volumes step by 5%, rumble toggles, all through setOptions', () => {
    const h = harness();
    h.ui.show('options');
    h.press('right');
    expect(h.save().options.quality).toBe('low');
    h.press('left');
    h.press('left');
    expect(h.save().options.quality).toBe('ultra');
    h.press('down');
    h.press('left');
    expect(h.save().options.musicVolume).toBeCloseTo(DEFAULT_SAVE.options.musicVolume - 0.05, 5);
    h.press('down');
    h.press('right');
    expect(h.save().options.sfxVolume).toBeCloseTo(DEFAULT_SAVE.options.sfxVolume + 0.05, 5);
    h.press('down');
    h.press('confirm');
    expect(h.save().options.rumble).toBe(false);
    expect(h.calls.filter((c) => c.startsWith('setOptions')).length).toBe(6);
  });

  it('Reset career asks first: back cancels, a second confirm resets', () => {
    const h = harness(unlocked);
    h.ui.show('options');
    h.press('down', 6);
    h.press('confirm');
    expect(h.calls).toEqual([]);
    expect(h.root.querySelector('.option--danger')?.classList.contains('is-confirming')).toBe(true);
    h.press('back');
    expect(h.root.querySelector('.option--danger')?.classList.contains('is-confirming')).toBe(false);
    expect(h.ui.screen).toBe('options');
    h.press('confirm');
    h.press('confirm');
    expect(h.calls).toEqual(['resetCareer']);
    expect(h.save().career.woodshedUnlocked).toBe(false);
  });

  it('Load my MP3 folder from a pad says how to pick instead of failing silently (no file chooser without user activation)', () => {
    const h = harness();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      h.ui.show('options');
      h.press('down', 4);
      expect(h.root.querySelector('.option.is-focused .option__label')?.textContent).toBe('Load my MP3 folder');
      h.frame({ confirm: true });
      expect(click).not.toHaveBeenCalled();
      expect(h.root.querySelector('.option.is-focused .option__value')?.textContent).toBe('Click or press Enter to pick a folder');
      expect(h.sounds).toContain('error');
      // Enter on the keyboard still opens the chooser.
      h.press('confirm');
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
    }
  });

  it('the controls view lists steering and the camera next to the buttons (SPEC section 5)', () => {
    const h = harness();
    h.ui.show('options');
    h.press('down', 5);
    h.press('confirm');
    const rowText = Array.from(h.root.querySelectorAll('.controls__row')).map((r) => r.textContent ?? '');
    expect(rowText.some((t) => t.startsWith('Steer / spin / balance') && t.includes('Left stick or D-pad'))).toBe(true);
    expect(rowText.some((t) => t.startsWith('Camera') && t.includes('Right stick'))).toBe(true);
    h.press('right', 2);
    const kb = Array.from(h.root.querySelectorAll('.controls__row')).map((r) => r.textContent ?? '');
    expect(kb.some((t) => t.startsWith('Steer / spin / balance') && t.includes('WASD / Arrows'))).toBe(true);
    expect(kb.some((t) => t.startsWith('Camera') && t.includes('Mouse'))).toBe(true);
  });

  it('the controls view is a read-only table with a glyph per pad button and a set picker', () => {
    const h = harness();
    h.setGlyphs('playstation');
    h.ui.show('options');
    h.press('down', 5);
    h.press('confirm');
    const rows = h.root.querySelectorAll('.controls__row');
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(h.root.querySelectorAll('.controls .glyph--playstation').length).toBeGreaterThanOrEqual(10);
    expect(h.root.querySelector('.controls .glyph--ollie svg')).not.toBeNull();
    h.press('right');
    expect(h.root.querySelectorAll('.controls .glyph--keyboard').length).toBeGreaterThanOrEqual(10);
    h.press('back');
    expect(h.root.querySelector('.controls')).toBeNull();
    expect(h.ui.screen).toBe('options');
  });
});

describe('Board Lab (REQ-LAB-01..03)', () => {
  it('five rows; left / right change the pick of the focused row through setBoard', () => {
    const h = harness();
    h.ui.show('boardLab');
    expect(Array.from(h.root.querySelectorAll('.lab__rowlabel')).map((e) => e.textContent)).toEqual(['Deck graphic', 'Grip', 'Trucks', 'Wheels', 'Underside stickers']);
    h.press('right');
    expect(h.save().board.deckGraphic).toBe(1);
    h.press('down');
    h.press('right');
    expect(h.save().board.grip).toBe('gray');
    h.press('down');
    h.press('left');
    expect(h.save().board.trucks).toBe('red');
    h.press('down');
    h.press('right');
    expect(h.save().board.wheels).toBe('blue101a');
    expect(h.text('.lab__row--wheels .lab__value')).toBe('Blue 101a');
    expect(h.calls.length).toBe(4);
  });

  it('the empty-map hint sits outside the deck outline, never over the chosen graphic', () => {
    const h = harness();
    h.ui.show('boardLab');
    const hint = h.root.querySelector('.lab__map .map__hint') as HTMLElement;
    expect(hint).not.toBeNull();
    expect(hint.classList.contains('is-hidden')).toBe(false);
    expect(hint.closest('.map__deck')).toBeNull();
  });

  it('places stickers with the stick and confirm, removes with action1, caps at MAX_STICKERS, back leaves placement', () => {
    const h = harness();
    h.ui.show('boardLab');
    h.press('down', 4);
    h.press('confirm');
    expect(h.root.querySelector('.lab__map')?.classList.contains('is-placing')).toBe(true);
    // Hold the stick up-right for half a second, then place.
    for (let i = 0; i < 30; i++) h.frame({ cursor: { x: 1, y: 1 } });
    h.frame({ confirm: true });
    expect(h.save().board.stickers.length).toBe(1);
    const s = h.save().board.stickers[0] as BoardConfig['stickers'][number];
    expect(s.u).toBeGreaterThan(0.5);
    expect(s.v).toBeGreaterThan(0.5);
    h.frame({ tabNext: true });
    h.frame({ tabPrev: true });
    h.frame({ confirm: true });
    expect(h.save().board.stickers.length).toBe(2);
    expect(h.save().board.stickers[1]?.index).toBe(1);
    expect(h.save().board.stickers[1]?.rotDeg).toBe(-TUNING.UI_STICKER_ROT_STEP_DEG);
    h.frame({ action1: true });
    expect(h.save().board.stickers.length).toBe(1);
    for (let i = 0; i < 8; i++) h.frame({ confirm: true });
    expect(h.save().board.stickers.length).toBe(TUNING.MAX_STICKERS);
    expect(h.sounds).toContain('error');
    h.frame({ back: true });
    expect(h.root.querySelector('.lab__map')?.classList.contains('is-placing')).toBe(false);
    expect(h.ui.screen).toBe('boardLab');
    h.press('back');
    expect(h.ui.screen).toBe('mainMenu');
  });

  it('the sticker cursor stops at the deck outline: a sticker pushed into a corner is still wholly on the deck', () => {
    const h = harness();
    h.ui.show('boardLab');
    h.press('down', 4);
    h.press('confirm');
    // Stick right and down for three seconds (far past the edge), then place; rotate, push the other way, place.
    for (let i = 0; i < 180; i++) h.frame({ cursor: { x: 1, y: -1 } });
    h.frame({ confirm: true });
    h.frame({ tabPrev: true });
    for (let i = 0; i < 60; i++) h.frame({ cursor: { x: -1, y: 1 } });
    h.frame({ confirm: true });
    const stickers = h.save().board.stickers;
    expect(stickers.length).toBe(2);
    for (const s of stickers) expect(stickerFits(s.u, s.v, s.rotDeg), JSON.stringify(s)).toBe(true);
    // It still went toward the corner it was pushed at (tail, right side).
    expect(stickers[0]?.u).toBeLessThan(0.3);
    expect(stickers[0]?.v).toBeGreaterThan(0.5);
  });

  it('binds its window pointerup listener only while shown', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const h = harness();
      const count = (spy: typeof add): number => spy.mock.calls.filter((c) => c[0] === 'pointerup').length;
      expect(count(add)).toBe(0);
      h.ui.show('boardLab');
      expect(count(add)).toBe(1);
      h.ui.show('mainMenu');
      expect(count(remove)).toBe(1);
      h.ui.show('boardLab');
      h.ui.dispose();
      expect(count(add)).toBe(2);
      expect(count(remove)).toBe(2);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('the sticker sheets list the three brand sheets by name plus the four generic ones', () => {
    const h = harness();
    h.ui.show('boardLab');
    const tabs = Array.from(h.root.querySelectorAll('.sheet__tab')).map((t) => t.textContent);
    expect(tabs.length).toBe(7);
    expect(tabs.slice(3)).toEqual(['Wafer', 'PCB', 'Token Stream', 'Inference']);
    expect(h.root.querySelectorAll('.sheet__sticker').length).toBe(STICKERS_PER_SHEET);
    expect(h.root.querySelectorAll('.pick--deck').length).toBe(10);
  });

  it('Y / Triangle randomises the whole board', () => {
    const h = harness();
    h.ui.show('boardLab');
    h.frame({ action2: true });
    expect(h.calls.length).toBe(1);
    expect(h.save().board.stickers.length).toBeGreaterThanOrEqual(2);
    expect(h.save().board.stickers.length).toBeLessThanOrEqual(TUNING.MAX_STICKERS);
    expect(h.save().board).not.toEqual(DEFAULT_BOARD);
  });
});

describe('results (REQ-MNU-06)', () => {
  const results: RunResults = {
    levelId: 'marketStreet', mode: 'career', score: 46600, bestCombo: 15504,
    goalsCompleted: [{ id: 'MS-GOAL-01', name: 'High Score' }], nextGoal: { name: 'High Combo', distance: '4,496 to go' },
    letters: ['C', 'O', 'E'], unlocks: ['Woodshed unlocked'],
  };

  it('shows the card and its buttons act; the score counts up over UI_RESULTS_COUNT_S', () => {
    const h = harness();
    h.ui.showResults(results);
    expect(h.ui.screen).toBe('results');
    expect(h.text('.results__stat')).toBe('Best combo 15,504');
    expect(Array.from(h.root.querySelectorAll('.results__line--done')).map((e) => e.textContent)).toEqual(['High Score']);
    expect(h.text('.results__next')).toContain('4,496 to go');
    expect(Array.from(h.root.querySelectorAll('.results__unlock')).map((e) => e.textContent)).toEqual(['Woodshed unlocked']);
    expect(Array.from(h.root.querySelectorAll('.results__letters .letter.is-got')).map((e) => e.textContent)).toEqual(['C', 'O', 'E']);
    expect(h.text('.results__score')).toBe('0');
    h.frame({}, TUNING.UI_RESULTS_COUNT_S + 0.1);
    expect(h.text('.results__score')).toBe('46,600');
    h.press('confirm');
    expect(h.calls).toEqual(['restartRun']);
    h.press('right');
    h.press('confirm');
    expect(h.calls).toEqual(['restartRun', 'quitToMenu']);
    expect(h.ui.screen).toBe('parkSelect');
  });
});

describe('controller disconnected (REQ-INP-08)', () => {
  it('shows the overlay and swallows pad navigation while lost', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.ui.setControllerLost(true);
    expect(h.visible('.overlay--lost')).toBe(true);
    expect(h.text('.overlay__title')).toBe('Controller disconnected');
    h.frame({ confirm: true });
    expect(h.ui.screen).toBe('mainMenu');
    h.ui.setControllerLost(false);
    expect(h.visible('.overlay--lost')).toBe(false);
    h.press('confirm');
    expect(h.ui.screen).toBe('parkSelect');
  });

  it('a key press drops the overlay and the paused run goes on with the keyboard', () => {
    const h = harness();
    h.ui.show('pause');
    h.ui.setControllerLost(true);
    h.press('back');
    expect(h.visible('.overlay--lost')).toBe(false);
    expect(h.ui.screen).toBe('pause');
    expect(h.calls).toEqual([]);
    // The pause menu now answers the keyboard: Quit to menu.
    h.press('down', 3);
    h.press('confirm');
    expect(h.calls).toEqual(['quitToMenu']);
  });

  it('a click on the overlay drops it too', () => {
    const h = harness();
    h.ui.show('pause');
    h.ui.setControllerLost(true);
    h.root.querySelector('.overlay--lost')?.dispatchEvent(new Event('pointerdown'));
    expect(h.visible('.overlay--lost')).toBe(false);
    expect(h.ui.screen).toBe('pause');
  });

  it('after a reconnect any pad button resumes the paused run; a D-pad move goes to the menu instead', () => {
    const h = harness();
    h.ui.show('pause');
    h.ui.setControllerLost(true);
    h.ui.setControllerLost(false);
    h.frame({ action2: true });
    expect(h.calls).toEqual(['resume']);
    const g = harness();
    g.ui.show('pause');
    g.ui.setControllerLost(true);
    g.ui.setControllerLost(false);
    g.frame({ down: true });
    g.frame({ action2: true });
    expect(g.calls).toEqual([]);
    g.frame({ confirm: true });
    expect(g.calls).toEqual(['restartRun']);
  });

  it('leaving the pause screen clears the overlay', () => {
    const h = harness();
    h.ui.show('pause');
    h.ui.setControllerLost(true);
    h.ui.show('hud');
    expect(h.visible('.overlay--lost')).toBe(false);
  });
});

describe('dev tuning panel (REQ-DEP-07)', () => {
  beforeEach(() => resetTuning());

  it('has a live control for every TUNING_META key and every enum, grouped by area', () => {
    const h = harness();
    h.ui.show('mainMenu');
    expect(h.ui.devPanelOpen).toBe(false);
    h.frame({ dev: true });
    expect(h.ui.devPanelOpen).toBe(true);
    const sliders = h.root.querySelectorAll('.devpanel .row__slider');
    const selects = h.root.querySelectorAll('.devpanel .row__select');
    expect(sliders.length).toBe(Object.keys(TUNING_META).length);
    expect(selects.length).toBe(Object.keys(TUNING_ENUM_META).length);
    expect(h.root.querySelectorAll('.devpanel__group').length).toBeGreaterThan(5);
    for (const [key, meta] of Object.entries(TUNING_META)) {
      const input = Array.from(sliders).find((s) => (s as HTMLInputElement).getAttribute('aria-label') === meta.label) as HTMLInputElement | undefined;
      expect(input, key).toBeDefined();
      expect(input?.min).toBe(String(meta.min));
      expect(input?.max).toBe(String(meta.max));
    }
  });

  it('a slider writes TUNING at once; the pad steps the focused row; back closes; reset restores', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.frame({ dev: true });
    const key = 'CLOCK_RED_S' as NumericTuningKey;
    const meta = TUNING_META[key];
    const input = Array.from(h.root.querySelectorAll('.devpanel .row__slider')).find((s) => s.getAttribute('aria-label') === meta.label) as HTMLInputElement;
    input.value = String(meta.min);
    input.dispatchEvent(new Event('input'));
    expect(TUNING.CLOCK_RED_S).toBe(meta.min);
    // Pad: focus opens on the first group header (Reset all is one up); the row after it is a slider.
    expect(h.root.querySelector('.devpanel .devpanel__group')?.classList.contains('is-focused')).toBe(true);
    h.frame({ down: true });
    const focused = h.root.querySelector('.devpanel .devpanel__row.is-focused');
    expect(focused).not.toBeNull();
    const focusedKey = (focused?.querySelector('.row__key')?.textContent ?? '').split(/\s+/)[0] as NumericTuningKey;
    const before = TUNING[focusedKey] as number;
    h.frame({ right: true });
    expect(TUNING[focusedKey]).toBeCloseTo(Math.min(TUNING_META[focusedKey].max, before + TUNING_META[focusedKey].step), 6);
    h.frame({ back: true });
    expect(h.ui.devPanelOpen).toBe(false);
    (h.root.querySelector('.devpanel__reset') as HTMLButtonElement).click();
    expect(TUNING.CLOCK_RED_S).toBe(10);
    // The pad went to the panel, not the menu.
    expect(h.ui.screen).toBe('mainMenu');
  });

  it('Reset all is reachable with the pad', () => {
    const h = harness();
    h.ui.show('mainMenu');
    h.frame({ dev: true });
    // Down past the group header to the first slider with any range (some locked keys have min = max).
    const focusedKey = (): NumericTuningKey => (h.root.querySelector('.devpanel .devpanel__row.is-focused .row__key')?.textContent ?? '').split(/\s+/)[0] as NumericTuningKey;
    let downs = 0;
    do {
      h.frame({ down: true });
      downs += 1;
    } while (!(TUNING_META[focusedKey()] && TUNING_META[focusedKey()].min < TUNING_META[focusedKey()].max) && downs < 40);
    const key = focusedKey();
    const before = TUNING[key];
    h.frame({ right: true });
    if (TUNING[key] === before) h.frame({ left: true });
    expect(TUNING[key]).not.toBe(before);
    expect(h.root.querySelector('.devpanel .devpanel__row.is-changed')).not.toBeNull();
    for (let i = 0; i < downs + 1; i++) h.frame({ up: true });
    expect(h.root.querySelector('.devpanel .devpanel__reset')?.classList.contains('is-focused')).toBe(true);
    h.frame({ confirm: true });
    expect(h.ui.devPanelOpen).toBe(true);
    expect(TUNING[key]).toBe(before);
    expect(h.root.querySelector('.devpanel .devpanel__row.is-changed')).toBeNull();
  });
});

describe('glyph set (REQ-HUD-05)', () => {
  it('hints redraw for the connected pad', () => {
    const h = harness();
    h.ui.show('mainMenu');
    expect(h.root.querySelectorAll('.screen--mainMenu .glyph--xbox').length).toBeGreaterThan(0);
    h.setGlyphs('playstation');
    expect(h.root.querySelectorAll('.screen--mainMenu .glyph--xbox').length).toBe(0);
    expect(h.root.querySelectorAll('.screen--mainMenu .glyph--playstation svg').length).toBeGreaterThan(0);
    expect((h.root.querySelector('.ui') as HTMLElement).dataset.glyphs).toBe('playstation');
    h.setGlyphs('keyboard');
    expect(h.root.querySelector('.screen--mainMenu .glyph__text')?.textContent).toBe('Arrows');
  });
});
