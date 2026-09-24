/**
 * src/ui/types.ts: UI contracts (REQ-HUD-*, REQ-MNU-*, REQ-LAB-*). Frozen after M0.
 *
 * The UI is a DOM/CSS overlay inside #ui-root over the canvas (REQ-HUD-02). It reads SimSnapshot
 * and SimEvents, never writes sim state, and asks the app to do things through UiActions.
 * Every screen is fully navigable with NavInput (D-pad / stick, confirm, back: REQ-MNU-02).
 * System font stack only; no em dashes in any string (REQ-HUD-06).
 */

import type { EventOf, SimEvent } from '../core/events';
import type {
  BoardConfig, GameOptions, GlyphSet, LetterId, LevelId, NavInput, ParkId, RunMode, SimSnapshot,
} from '../core/types';
import type { BrandMode } from '../data/brands';
import type { GoalDef } from '../data/goals';
import type { SaveData } from '../save/types';
import type { UiSound } from '../audio/types';
import type { BoardPreviewHost } from '../render/types';

/**
 * Screens the root switches between. The start gate is NOT here: it must paint before the game
 * chunk loads, so it lives in src/ui/startGate.ts (tiny, no imports) and is mounted by src/main.ts.
 * Overlays that stack on top of any screen: dev tuning panel, controller-disconnected overlay,
 * toasts, splashes and the NPC dialog (the last three are HUD layers).
 */
export type ScreenId = 'mainMenu' | 'parkSelect' | 'goalList' | 'hud' | 'pause' | 'options' | 'credits' | 'boardLab' | 'results';

/** What the UI can ask the app to do. */
export interface UiActions {
  /** Load the park and start a 2:00 run (REQ-GOL-01). */
  startRun(level: ParkId, mode: RunMode): void;
  resume(): void;
  restartRun(): void;
  quitToMenu(): void;
  setOptions(options: GameOptions): void;
  /** REQ-SAV-02, after the UI's own confirmation step. */
  resetCareer(): void;
  setBoard(board: BoardConfig): void;
  /** Folder picker result; resolves to the playable track count (REQ-MNU-04). */
  loadMusicFolder(files: readonly File[]): Promise<number>;
  uiSound(kind: UiSound): void;
}

/** Read-only model the UI renders from; the app pushes a new one whenever it changes. */
export interface UiState {
  readonly save: SaveData;
  readonly glyphs: GlyphSet;
  readonly brandMode: BrandMode;
  /** "v0.1" */
  readonly version: string;
  readonly goals: Readonly<Record<ParkId, readonly GoalDef[]>>;
}

export interface UiDeps {
  readonly actions: UiActions;
  /** Board Lab turntable from the skater track; null in harnesses (the UI shows a 2D placeholder). */
  readonly boardPreview: BoardPreviewHost | null;
}

/**
 * Results card (REQ-GOL-07, REQ-MNU-06). Built by the ui track's pure helper buildRunResults
 * (src/ui/results.ts, unit-tested in tests/ui*.test.ts); the app only applies the save update at run
 * end and calls it with the save before and after.
 */
export interface RunResults {
  readonly levelId: LevelId;
  readonly mode: RunMode;
  readonly score: number;
  readonly bestCombo: number;
  readonly goalsCompleted: readonly { readonly id: string; readonly name: string }[];
  /** Nearest uncompleted goal and its distance ("12,400 to go", "missing E"). */
  readonly nextGoal: { readonly name: string; readonly distance: string } | null;
  readonly letters: readonly LetterId[];
  /** Unlock lines ("Woodshed unlocked", "Lab Circuit stamp"). */
  readonly unlocks: readonly string[];
}

/**
 * Pure: the runEnd event plus the save before and after this run's update -> the results card.
 * goalsCompleted names come from `goals`; nextGoal = the nearest uncompleted goal with its distance
 * text ("12,400 to go", "missing E"); unlocks = lines for flags that flipped between before and after
 * ("Woodshed unlocked", "Lab Circuit stamp"). No em dashes.
 */
export type BuildRunResults = (
  runEnd: EventOf<'runEnd'>,
  before: SaveData,
  after: SaveData,
  goals: readonly GoalDef[],
) => RunResults;

/** In-run HUD (REQ-HUD-01, H.2 wireframe). */
export interface Hud {
  /** Every render frame: clock, score, combo ticker, special bar, balance meter, letters, goal peek, NPC dialog. */
  update(snapshot: SimSnapshot, dtS: number): void;
  /** Land text, gap splash, MacGuffin splash + toast, goal toasts, letter tray ding. */
  onEvent(e: SimEvent): void;
  setVisible(visible: boolean): void;
  setGlyphs(glyphs: GlyphSet): void;
  /** Free-form toast (goal completed, "Controller connected"). */
  toast(text: string, seconds?: number): void;
}

export interface FocusItem {
  readonly el: HTMLElement;
  readonly onConfirm?: () => void;
  /** Left / right on a focused item (sliders, pickers); return true when consumed. */
  readonly onAdjust?: (delta: -1 | 1) => boolean;
  readonly disabled?: boolean;
}

/** Controller-complete focus navigation for one screen at a time (REQ-MNU-02). */
export interface FocusManager {
  /** Replace the focusable items; columns > 1 makes left / right move within a grid. */
  setItems(items: readonly FocusItem[], options?: { readonly columns?: number; readonly wrap?: boolean; readonly initial?: number }): void;
  /** Apply one frame of NavInput; returns true when it consumed something. */
  handle(nav: NavInput): boolean;
  readonly index: number;
  focus(index: number): void;
  /** Back button handler for the current screen. */
  setOnBack(handler: (() => void) | null): void;
  clear(): void;
}

export interface UiRoot {
  readonly screen: ScreenId | null;
  show(screen: ScreenId): void;
  setState(state: UiState): void;
  readonly hud: Hud;
  showResults(results: RunResults): void;
  /** REQ-INP-08 overlay: "Controller disconnected". */
  setControllerLost(lost: boolean): void;
  /** Dev tuning panel (REQ-DEP-07): sliders for every TUNING_META key, dropdowns for enums. */
  toggleDevPanel(): void;
  readonly devPanelOpen: boolean;
  /** Every render frame with that frame's NavInput. */
  update(nav: NavInput, dtS: number): void;
  dispose(): void;
}
