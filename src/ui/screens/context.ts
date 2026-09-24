/**
 * src/ui/screens/context.ts (ui track): what every screen gets from the root, and the Screen shape
 * the root drives. Screens build their DOM once, refresh from UiState on enter (and on setState while
 * shown), and register their focus items on the shared FocusManager.
 */

import type { GlyphSet, NavInput, ParkId, RunMode, SimSnapshot } from '../../core/types';
import type { UiSound } from '../../audio/types';
import type { BoardPreviewHost } from '../../render/types';
import type { HudExt } from '../hud';
import type { NavVerb } from '../glyphs';
import type { FocusManager, RunResults, ScreenId, UiActions, UiState } from '../types';

export interface ScreenContext {
  readonly actions: UiActions;
  readonly focus: FocusManager;
  readonly hud: HudExt;
  readonly boardPreview: BoardPreviewHost | null;
  state(): UiState;
  glyphs(): GlyphSet;
  /** Navigate forward (the current screen is remembered for back). */
  go(screen: ScreenId): void;
  /** Navigate back to the previous screen; the root decides what that is. */
  back(): void;
  sound(kind: UiSound): void;
  /** Career / free choice made on the main menu, read by park select. */
  pendingMode(): RunMode;
  setPendingMode(mode: RunMode): void;
  /** Park chosen on park select, read by the goal list. */
  pendingPark(): ParkId;
  setPendingPark(park: ParkId): void;
  /** The most recent results card (results screen). */
  results(): RunResults | null;
  /** The latest snapshot the HUD saw (pause screen goal state), or null before a run. */
  snapshot(): SimSnapshot | null;
  /** Build a hint bar for this screen; the root wires the Back hint to a click. */
  hints(list: readonly (readonly [NavVerb, string])[]): HTMLElement;
}

export interface Screen {
  readonly id: ScreenId;
  readonly el: HTMLElement;
  /** Shown: rebuild from state and register focus items. */
  enter(): void;
  /** Hidden. */
  leave(): void;
  /** State changed while shown. */
  refresh(): void;
  /** Optional per-frame hook before the focus manager sees the nav; return true to consume it. */
  update?(nav: NavInput, dtS: number): boolean;
}
