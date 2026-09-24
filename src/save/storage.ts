/**
 * src/save/storage.ts (ui track): the localStorage-backed SaveStore (REQ-SAV-01..03). Every storage
 * access is wrapped in try/catch; a missing, throwing or corrupt store yields DEFAULT_SAVE and
 * `available: false`, and the game keeps running. Unknown or older shapes are migrated field by field.
 */

import {
  DEFAULT_BOARD, DEFAULT_OPTIONS, type BoardConfig, type GameOptions, type GripId, type MacGuffinId,
  type ParkId, type QualityOption, type StickerPlacement, type StickerSheetId, type TruckColorId, type WheelId,
} from '../core/types';
import { PARKS } from '../data/goals';
import { TUNING } from '../core/tuning';
import { DEFAULT_CAREER, DEFAULT_SAVE, SAVE_KEY, SAVE_VERSION, type CareerProgress, type SaveData, type SaveStore, type StorageLike } from './types';

const GRIPS: readonly GripId[] = ['black', 'gray', 'clear', 'dieCut'];
const TRUCKS: readonly TruckColorId[] = ['raw', 'black', 'gold', 'red'];
const WHEELS: readonly WheelId[] = ['white99a', 'blue101a', 'green97a', 'orange99a'];
const SHEETS: readonly StickerSheetId[] = ['labA', 'labB', 'chip', 'wafer', 'pcb', 'tokenStream', 'inference'];
const QUALITIES: readonly QualityOption[] = ['auto', 'low', 'med', 'high', 'ultra'];
const MACGUFFINS: readonly MacGuffinId[] = ['secret_laptop', 'secret_drive'];
/** Deck graphic sheets 0..5 (DESIGN H.3). */
export const DECK_GRAPHIC_COUNT = 6;

const PROBE_KEY = `${SAVE_KEY}.probe`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) if (typeof s === 'string' && !out.includes(s)) out.push(s);
  return out;
}

function perPark<T>(v: unknown, read: (x: unknown) => T, fallback: T): Record<ParkId, T> {
  const src = isRecord(v) ? v : {};
  const out = {} as Record<ParkId, T>;
  for (const park of PARKS) out[park] = park in src ? read(src[park]) : fallback;
  return out;
}

function readSticker(v: unknown): StickerPlacement | null {
  if (!isRecord(v)) return null;
  const sheet = oneOf(v.sheet, SHEETS, null as unknown as StickerSheetId);
  if (!sheet) return null;
  return {
    sheet,
    index: Math.floor(num(v.index, 0, 0, 64)),
    u: num(v.u, 0.5, 0, 1),
    v: num(v.v, 0.5, 0, 1),
    rotDeg: num(v.rotDeg, 0, -360, 360),
  };
}

/** Validate a board config field by field (REQ-LAB-02): unknown values fall back to the default. */
export function sanitizeBoard(v: unknown): BoardConfig {
  const src = isRecord(v) ? v : {};
  const stickers: StickerPlacement[] = [];
  if (Array.isArray(src.stickers)) {
    for (const s of src.stickers) {
      const st = readSticker(s);
      if (st) stickers.push(st);
      if (stickers.length >= TUNING.MAX_STICKERS) break;
    }
  }
  return {
    deckGraphic: Math.floor(num(src.deckGraphic, DEFAULT_BOARD.deckGraphic, 0, DECK_GRAPHIC_COUNT - 1)),
    grip: oneOf(src.grip, GRIPS, DEFAULT_BOARD.grip),
    trucks: oneOf(src.trucks, TRUCKS, DEFAULT_BOARD.trucks),
    wheels: oneOf(src.wheels, WHEELS, DEFAULT_BOARD.wheels),
    stickers,
  };
}

/** Validate options field by field (REQ-MNU-04). */
export function sanitizeOptions(v: unknown): GameOptions {
  const src = isRecord(v) ? v : {};
  return {
    quality: oneOf(src.quality, QUALITIES, DEFAULT_OPTIONS.quality),
    musicVolume: num(src.musicVolume, DEFAULT_OPTIONS.musicVolume, 0, 1),
    sfxVolume: num(src.sfxVolume, DEFAULT_OPTIONS.sfxVolume, 0, 1),
    rumble: typeof src.rumble === 'boolean' ? src.rumble : DEFAULT_OPTIONS.rumble,
  };
}

/** Validate career progress field by field (REQ-SAV-01); derived flags are recomputed from the data. */
export function sanitizeCareer(v: unknown): CareerProgress {
  const src = isRecord(v) ? v : {};
  const macguffins = stringList(src.macguffins).filter((m): m is MacGuffinId => (MACGUFFINS as readonly string[]).includes(m));
  const goals = perPark(src.goals, stringList, []);
  return {
    goals,
    macguffins,
    bestScores: perPark(src.bestScores, (x) => Math.floor(num(x, 0, 0)), 0),
    bestCombos: perPark(src.bestCombos, (x) => Math.floor(num(x, 0, 0)), 0),
    woodshedUnlocked: typeof src.woodshedUnlocked === 'boolean' ? src.woodshedUnlocked : DEFAULT_CAREER.woodshedUnlocked,
    labCircuitStamp: typeof src.labCircuitStamp === 'boolean' ? src.labCircuitStamp : DEFAULT_CAREER.labCircuitStamp,
  };
}

/**
 * Parse and migrate any stored value into a valid SaveData. Anything that is not an object, any
 * missing field, any wrong type falls back to DEFAULT_SAVE's value for that field (never throws).
 * A newer version than ours is still read field by field (forward compatible where the shape agrees).
 */
export function migrateSave(raw: unknown): SaveData {
  if (!isRecord(raw)) return DEFAULT_SAVE;
  return {
    version: SAVE_VERSION,
    career: sanitizeCareer(raw.career),
    board: sanitizeBoard(raw.board),
    options: sanitizeOptions(raw.options),
  };
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window.localStorage;
    return s ? s : null;
  } catch {
    return null;
  }
}

function probe(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** storage defaults to window.localStorage when reachable; pass null to force memory-only. */
export function createSaveStore(storage?: StorageLike | null): SaveStore {
  const backing = storage === undefined ? defaultStorage() : storage;
  const available = probe(backing);
  // Memory copy: the game keeps working (and this session persists) when storage is missing.
  let memory: SaveData | null = null;

  const load = (): SaveData => {
    if (backing && available) {
      try {
        const text = backing.getItem(SAVE_KEY);
        if (text === null) return memory ?? DEFAULT_SAVE;
        const data = migrateSave(JSON.parse(text));
        memory = data;
        return data;
      } catch {
        return memory ?? DEFAULT_SAVE;
      }
    }
    return memory ?? DEFAULT_SAVE;
  };

  const save = (data: SaveData): boolean => {
    const clean = migrateSave(data);
    memory = clean;
    if (!backing || !available) return false;
    try {
      backing.setItem(SAVE_KEY, JSON.stringify(clean));
      return true;
    } catch {
      return false;
    }
  };

  const update = (fn: (data: SaveData) => SaveData): SaveData => {
    const next = migrateSave(fn(load()));
    save(next);
    return next;
  };

  return {
    available,
    load,
    save,
    update,
    resetCareer: () => update((d) => ({ ...d, career: DEFAULT_CAREER })),
  };
}
