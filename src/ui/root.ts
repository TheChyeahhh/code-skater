/**
 * src/ui/root.ts (ui track): the UI root (REQ-MNU-01..06, REQ-HUD-*, REQ-LAB-*, REQ-DEP-07).
 * Owns every screen inside #ui-root: main menu (title, Career, Free Skate, Board Lab, Options,
 * Credits, Lab Circuit stamp), park select (Woodshed locked until UNLOCK_WOODSHED_GOALS), goal list,
 * HUD, pause (goal list, Resume, Restart, Options, Quit), options (quality, volumes, music folder,
 * controls view with glyphs, Reset career with confirm), credits, Board Lab, results card, the dev
 * tuning panel and the "Controller disconnected" overlay. Menus are code-split from the game
 * (REQ-MNU-05): the app imports this module lazily after the start gate.
 *
 * Per frame (update): the dev panel takes the pad while open (~ / View toggles it), the controller
 * overlay swallows pad input while shown (a key or a click dismisses it, so a player whose pad died can
 * go on with the keyboard), the HUD gets the frame for its NPC confirm, then the current screen's own
 * hook, then the focus manager (move / confirm / back with menu blips). After a reconnect the first
 * pad button resumes the paused run (REQ-INP-08). Back returns to the item you came from.
 */

import './styles.css';
import type { UiSound } from '../audio/types';
import { BRAND_MODE } from '../data/brands';
import type { GlyphSet, NavInput, ParkId, RunMode, SimSnapshot } from '../core/types';
import { DEFAULT_SAVE } from '../save/types';
import { createDevPanel, type DevPanel } from './devPanel';
import { el, setClass } from './dom';
import { createFocusManager } from './focus';
import { hintBar, type NavVerb } from './glyphs';
import { createHud, type HudExt } from './hud';
import { createBoardLab } from './screens/boardLab';
import type { Screen, ScreenContext } from './screens/context';
import { createCredits } from './screens/credits';
import { createGoalList } from './screens/goalList';
import { createMainMenu } from './screens/mainMenu';
import { createOptions } from './screens/options';
import { createParkSelect } from './screens/parkSelect';
import { createPause } from './screens/pause';
import { createResults } from './screens/results';
import type { RunResults, ScreenId, UiDeps, UiRoot, UiState } from './types';

/** True when this frame's nav carries any button or direction edge (the stick look axis does not count). */
export function anyPress(nav: NavInput): boolean {
  return nav.up || nav.down || nav.left || nav.right || anyButton(nav);
}

/** True when this frame's nav carries a button edge (face, shoulder, menu or view; not a direction). */
export function anyButton(nav: NavInput): boolean {
  return nav.confirm || nav.back || nav.tabPrev || nav.tabNext || nav.action1 || nav.action2 || nav.pause || nav.dev;
}

export const NO_NAV: NavInput = {
  up: false, down: false, left: false, right: false, confirm: false, back: false, tabPrev: false, tabNext: false,
  action1: false, action2: false, pause: false, dev: false, lookX: 0, cursor: { x: 0, y: 0 }, source: 'none',
};

/** Screens that stack over a run: the HUD stays mounted (dimmed) behind them. */
const OVER_RUN: readonly ScreenId[] = ['pause'];

export interface UiRootExt extends UiRoot {
  readonly hud: HudExt;
  /** The DOM element of a screen (tests, harness). */
  screenElement(id: ScreenId): HTMLElement | null;
  /** Feed one synthetic navigation press through the same pipeline as update() (hint clicks, tests). */
  press(verb: NavVerb | 'up' | 'down' | 'left' | 'right'): void;
  readonly devPanel: DevPanel;
}

export function createUiRoot(root: HTMLElement, deps: UiDeps): UiRootExt {
  const layer = el('div', 'ui');
  const hudBox = el('div', 'ui__hud');
  const screensBox = el('div', 'ui__screens');
  const lostOverlay = el('div', 'overlay overlay--lost',
    el('div', 'overlay__card', el('div', 'overlay__title', 'Controller disconnected'), el('div', 'overlay__text', 'The run is paused. Reconnect the pad and press any button, or press a key to go on with the keyboard.')));
  layer.append(hudBox, screensBox, lostOverlay);
  root.append(layer);

  let state: UiState = { save: DEFAULT_SAVE, glyphs: 'xbox', brandMode: BRAND_MODE, version: 'v0.1', goals: { marketStreet: [], woodshed: [], labCampus: [] } };
  let current: Screen | null = null;
  let currentId: ScreenId | null = null;
  /** Screens to go back to, each with the focus index it had when you left it. */
  let history: { readonly id: ScreenId; readonly index: number }[] = [];
  let pendingMode: RunMode = 'career';
  let pendingPark: ParkId = 'marketStreet';
  let lastResults: RunResults | null = null;
  let lastSnapshot: SimSnapshot | null = null;
  let controllerLost = false;
  /** Set when the pad comes back after a loss: its first button press resumes the paused run. */
  let resumeOnPad = false;
  let disposed = false;

  const sound = (kind: UiSound): void => {
    try {
      deps.actions.uiSound(kind);
    } catch (err) {
      console.error('uiSound threw', err);
    }
  };

  const focus = createFocusManager({
    onMove: () => sound('move'),
    onConfirm: () => sound('confirm'),
    onBlocked: () => sound('error'),
  });

  const hudBase = createHud(hudBox);
  // Remember the latest snapshot for the pause screen (park, mode, goals done this run).
  const hud: HudExt = {
    ...hudBase,
    update(snapshot, dtS) {
      lastSnapshot = snapshot;
      hudBase.update(snapshot, dtS);
    },
    get npcOpen() {
      return hudBase.npcOpen;
    },
  };

  const devPanel = createDevPanel(layer);

  const show = (id: ScreenId, opts: { readonly push?: boolean } = {}): void => {
    if (disposed) return;
    if (currentId === id && current) {
      current.refresh();
      return;
    }
    if (opts.push && currentId && currentId !== 'hud' && currentId !== id) history.push({ id: currentId, index: focus.index });
    if (!opts.push) {
      // The app drove this: menus start a fresh history, run screens clear it.
      if (id === 'mainMenu' || id === 'hud' || id === 'results') history = [];
      else if (id === 'pause') history = [];
    }
    current?.leave();
    if (current) setClass(current.el, 'is-active', false);
    // The controller overlay belongs to the paused run: leaving pause (resume, quit) clears it.
    if (id !== 'pause') {
      setLost(false);
      resumeOnPad = false;
    }
    currentId = id;
    current = screens.get(id) ?? null;
    setClass(layer, 'is-menu', id !== 'hud' && !OVER_RUN.includes(id));
    setClass(layer, 'is-paused', OVER_RUN.includes(id));
    setClass(layer, 'is-run', id === 'hud');
    if (current) {
      setClass(current.el, 'is-active', true);
      current.enter();
    }
  };

  const back = (): void => {
    const prev = history.pop();
    sound('back');
    if (prev) {
      show(prev.id, { push: false });
      // Land on the item you came from, not the first one.
      focus.focus(prev.index);
    } else if (currentId !== 'mainMenu' && currentId !== 'hud') show('mainMenu');
  };

  const ctx: ScreenContext = {
    actions: deps.actions,
    focus,
    hud,
    boardPreview: deps.boardPreview,
    state: () => state,
    glyphs: () => state.glyphs,
    go: (id) => show(id, { push: true }),
    back,
    sound,
    pendingMode: () => pendingMode,
    setPendingMode: (m) => {
      pendingMode = m;
    },
    pendingPark: () => pendingPark,
    setPendingPark: (p) => {
      pendingPark = p;
    },
    results: () => lastResults,
    snapshot: () => lastSnapshot,
    hints: (list) => {
      const bar = hintBar(state.glyphs, list);
      const hints = Array.from(bar.children) as HTMLElement[];
      list.forEach(([verb], i) => {
        const h = hints[i];
        if (!h || verb === 'move' || verb === 'adjust') return;
        h.classList.add('hint--clickable');
        h.addEventListener('click', () => press(verb));
      });
      return bar;
    },
  };

  const screens = new Map<ScreenId, Screen>();
  for (const s of [createMainMenu(ctx), createParkSelect(ctx), createGoalList(ctx), createPause(ctx), createOptions(ctx), createCredits(ctx), createBoardLab(ctx), createResults(ctx)]) {
    screens.set(s.id, s);
    screensBox.append(s.el);
  }

  const handleNav = (nav: NavInput, dtS: number): void => {
    if (devPanel.open) {
      devPanel.handle(nav);
      return;
    }
    if (nav.dev) {
      devPanel.toggle();
      return;
    }
    if (controllerLost) {
      // A key press means the player goes on with the keyboard: drop the overlay, stay paused.
      if (nav.source === 'keyboard' && anyPress(nav)) setLost(false);
      return;
    }
    if (resumeOnPad && nav.source === 'gamepad' && anyPress(nav)) {
      resumeOnPad = false;
      // Any button resumes; a first D-pad / stick move means the player wants the menu (Quit, Options).
      if (currentId === 'pause' && anyButton(nav)) {
        sound('confirm');
        deps.actions.resume();
        return;
      }
    }
    if (nav.source === 'keyboard' && anyPress(nav)) resumeOnPad = false;
    if (currentId === 'hud') {
      hud.nav(nav);
      return;
    }
    if (current?.update?.(nav, dtS)) return;
    const wasBack = nav.back;
    if (focus.handle(nav)) {
      if (wasBack && currentId !== 'pause') {
        // back() already blipped when it navigated; a screen-local back (options confirm cancel) blips here.
      }
    }
  };

  const press = (verb: NavVerb | 'up' | 'down' | 'left' | 'right'): void => {
    const nav: NavInput = { ...NO_NAV, [verb === 'move' || verb === 'adjust' ? 'confirm' : verb]: true, source: 'keyboard' };
    handleNav(nav, 0);
  };

  function setLost(lost: boolean): void {
    controllerLost = lost;
    setClass(lostOverlay, 'is-visible', lost);
  }
  // A click on the overlay dismisses it like a key does.
  lostOverlay.addEventListener('pointerdown', () => {
    if (controllerLost) setLost(false);
  });

  const applyGlyphs = (set: GlyphSet): void => {
    hud.setGlyphs(set);
    layer.dataset.glyphs = set;
  };
  applyGlyphs(state.glyphs);

  const uiRoot: UiRootExt = {
    get screen() {
      return currentId;
    },
    show(id) {
      show(id, { push: false });
    },
    setState(next) {
      const glyphsChanged = next.glyphs !== state.glyphs;
      state = next;
      if (glyphsChanged) applyGlyphs(next.glyphs);
      const park = lastSnapshot?.run.levelId ?? pendingPark;
      if (park === 'marketStreet' || park === 'woodshed') hud.setGoals(next.goals[park], next.save.career.goals[park]);
      current?.refresh();
    },
    hud,
    showResults(results) {
      lastResults = results;
      if (results.levelId === 'marketStreet' || results.levelId === 'woodshed') pendingPark = results.levelId;
      pendingMode = results.mode;
      show('results', { push: false });
    },
    setControllerLost(lost) {
      // Lost -> found while the run waits on pause: the next pad button resumes it (REQ-INP-08).
      resumeOnPad = !lost && controllerLost && currentId === 'pause';
      setLost(lost);
    },
    toggleDevPanel() {
      devPanel.toggle();
    },
    get devPanelOpen() {
      return devPanel.open;
    },
    update(nav, dtS) {
      if (disposed) return;
      handleNav(nav, dtS);
    },
    dispose() {
      disposed = true;
      current?.leave();
      focus.clear();
      devPanel.dispose();
      layer.remove();
    },
    screenElement(id) {
      return screens.get(id)?.el ?? null;
    },
    press,
    devPanel,
  };
  return uiRoot;
}
