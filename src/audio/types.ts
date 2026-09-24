/**
 * src/audio/types.ts: audio engine contract (REQ-AUD-01..03). Frozen after M0.
 * Everything is synthesized with the Web Audio API; no audio files ship (REQ-AUD-01, REQ-MAT-05).
 * The AudioContext is created or resumed only inside init(), which the app calls from the start
 * gate's user gesture (REQ-AUD-03). Before init() every method is a silent no-op.
 */

import type { SimEvent } from '../core/events';
import type { ParkId, SimSnapshot } from '../core/types';

export interface AudioVolumes {
  /** 0..1 */
  readonly music: number;
  /** 0..1 */
  readonly sfx: number;
}

export type MusicTrack = 'menu' | ParkId;

export type UiSound = 'move' | 'confirm' | 'back' | 'error' | 'toast';

export interface AudioEngine {
  readonly ready: boolean;
  /**
   * True while the AudioContext exists but the browser keeps it suspended (no user activation yet:
   * a gamepad press never counts as one). The app shows a "click or press a key" chip meanwhile.
   * Optional so test engines may omit it.
   */
  readonly suspended?: boolean;
  /**
   * Adopt the AudioContext that src/main.ts created and resumed inside the start gate's user
   * gesture (the game chunk loads after the gesture, too late to create one itself), or create and
   * resume one when called from a gesture. Idempotent.
   */
  init(context?: AudioContext): Promise<void>;
  /** One-shot SFX from gameplay events (pop, land, bail, gap chime, letter ding, MacGuffin fanfare, ...). */
  onEvent(e: SimEvent): void;
  /** Continuous voices from the interpolated snapshot: roll noise by speed, grind by speed, wind. null = menus. */
  update(snapshot: SimSnapshot | null, dtS: number): void;
  /** Synthesized Y2K breakbeat per park (REQ-AUD-02); null stops music. */
  playMusic(track: MusicTrack | null): void;
  setVolumes(v: AudioVolumes): void;
  /** Player-chosen MP3 folder via the file picker (never bundled). Resolves to the number of playable tracks. */
  loadUserMusic(files: readonly File[]): Promise<number>;
  /** Play the loaded user tracks instead of the synth loop. */
  useUserMusic(on: boolean): void;
  uiSound(kind: UiSound): void;
  /** Pause / resume all audio (pause menu, tab hidden). */
  setPaused(paused: boolean): void;
  dispose(): void;
}
