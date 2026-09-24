/**
 * src/save/types.ts: persisted data (REQ-SAV-01..03). Frozen after M0 (integration track only).
 * Storage is localStorage under SAVE_KEY, every access wrapped in try/catch (src/save/storage.ts,
 * ui track). Writes happen at run end, on menu changes and on Board Lab changes: never inside a sim
 * tick (REQ-SAV-03).
 */

import {
  DEFAULT_BOARD, DEFAULT_OPTIONS, type BoardConfig, type GameOptions, type MacGuffinId, type ParkId,
} from '../core/types';

export const SAVE_KEY = 'codeSkater.v1';
export const SAVE_VERSION = 1;

export interface CareerProgress {
  /** Completed goal ids per park, cumulative across runs (REQ-GOL-02). */
  readonly goals: Readonly<Record<ParkId, readonly string[]>>;
  /** Collected once per career (REQ-SCR-06). */
  readonly macguffins: readonly MacGuffinId[];
  readonly bestScores: Readonly<Record<ParkId, number>>;
  readonly bestCombos: Readonly<Record<ParkId, number>>;
  /** Set when UNLOCK_WOODSHED_GOALS Street goals are done (REQ-GOL-03). */
  readonly woodshedUnlocked: boolean;
  /** Both MacGuffins held (REQ-GOL-04). */
  readonly labCircuitStamp: boolean;
}

export interface SaveData {
  readonly version: typeof SAVE_VERSION;
  readonly career: CareerProgress;
  readonly board: BoardConfig;
  readonly options: GameOptions;
}

export const DEFAULT_CAREER: CareerProgress = {
  goals: { marketStreet: [], woodshed: [], labCampus: [] },
  macguffins: [],
  bestScores: { marketStreet: 0, woodshed: 0, labCampus: 0 },
  bestCombos: { marketStreet: 0, woodshed: 0, labCampus: 0 },
  woodshedUnlocked: false,
  labCircuitStamp: false,
};

export const DEFAULT_SAVE: SaveData = {
  version: SAVE_VERSION,
  career: DEFAULT_CAREER,
  board: DEFAULT_BOARD,
  options: DEFAULT_OPTIONS,
};

/** The subset of the Web Storage API the store uses (tests pass a fake or a throwing one). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveStore {
  /** False when storage is missing or throws (private mode): the game runs, nothing persists. */
  readonly available: boolean;
  /** Parsed, migrated and validated save; DEFAULT_SAVE on any problem. Never throws. */
  load(): SaveData;
  /** Returns false if the write failed. Never throws. */
  save(data: SaveData): boolean;
  /** load -> fn -> save, returns the saved data. */
  update(fn: (data: SaveData) => SaveData): SaveData;
  /** REQ-SAV-02: clears career progress, keeps options and the Board Lab. */
  resetCareer(): SaveData;
}
