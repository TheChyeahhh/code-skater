// tests/save.test.ts (ui track): REQ-SAV-01..03. Round trip, throwing storage never crashes, corrupt or
// partial data migrates field by field, reset career keeps options and the Board Lab.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD, DEFAULT_OPTIONS } from '../src/core/types';
import { TUNING } from '../src/core/tuning';
import { createSaveStore, migrateSave, sanitizeBoard } from '../src/save/storage';
import { DEFAULT_SAVE, SAVE_KEY, SAVE_VERSION, type SaveData, type StorageLike } from '../src/save/types';

function memoryStorage(): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function throwingStorage(): StorageLike {
  const boom = (): never => {
    throw new Error('QuotaExceededError');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const SAMPLE: SaveData = {
  version: SAVE_VERSION,
  career: {
    goals: { marketStreet: ['MS-GOAL-01', 'MS-GOAL-05'], woodshed: [], labCampus: [] },
    macguffins: ['secret_laptop'],
    bestScores: { marketStreet: 46600, woodshed: 0, labCampus: 0 },
    bestCombos: { marketStreet: 15504, woodshed: 0, labCampus: 0 },
    woodshedUnlocked: false,
    labCircuitStamp: false,
  },
  board: { deckGraphic: 3, grip: 'dieCut', trucks: 'gold', wheels: 'blue101a', stickers: [{ sheet: 'pcb', index: 1, u: 0.3, v: 0.6, rotDeg: 12 }] },
  options: { quality: 'high', musicVolume: 0.4, sfxVolume: 1, rumble: false },
};

describe('SaveStore (REQ-SAV-01)', () => {
  it('round-trips a save through storage under the versioned key', () => {
    const storage = memoryStorage();
    const store = createSaveStore(storage);
    expect(store.available).toBe(true);
    expect(store.load()).toEqual(DEFAULT_SAVE);
    expect(store.save(SAMPLE)).toBe(true);
    expect(storage.map.has(SAVE_KEY)).toBe(true);
    expect(SAVE_KEY).toBe('codeSkater.v1');
    expect(createSaveStore(storage).load()).toEqual(SAMPLE);
  });

  it('storage that throws never crashes: available false, load gives defaults, save reports false', () => {
    const store = createSaveStore(throwingStorage());
    expect(store.available).toBe(false);
    expect(store.load()).toEqual(DEFAULT_SAVE);
    expect(store.save(SAMPLE)).toBe(false);
    // The session still remembers what it saved (memory copy) so the game keeps running.
    expect(store.load()).toEqual(SAMPLE);
    expect(() => store.resetCareer()).not.toThrow();
  });

  it('null storage is memory-only', () => {
    const store = createSaveStore(null);
    expect(store.available).toBe(false);
    store.update((d) => ({ ...d, options: { ...d.options, musicVolume: 0.1 } }));
    expect(store.load().options.musicVolume).toBe(0.1);
  });

  it('corrupt JSON and wrong shapes fall back field by field', () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(createSaveStore(storage).load()).toEqual(DEFAULT_SAVE);
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99, career: { goals: { marketStreet: ['a', 'a', 3], woodshed: 'nope', labCampus: [] }, bestScores: { marketStreet: -5 } }, board: { grip: 'purple', stickers: 'x' }, options: { musicVolume: 7, quality: 'insane' } }));
    const loaded = createSaveStore(storage).load();
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.career.goals).toEqual({ marketStreet: ['a'], woodshed: [], labCampus: [] });
    expect(loaded.career.bestScores).toEqual({ marketStreet: 0, woodshed: 0, labCampus: 0 });
    expect(loaded.board.grip).toBe(DEFAULT_BOARD.grip);
    expect(loaded.board.stickers).toEqual([]);
    expect(loaded.options.musicVolume).toBe(1);
    expect(loaded.options.quality).toBe(DEFAULT_OPTIONS.quality);
  });

  it('migrateSave handles non-objects and clamps stickers to MAX_STICKERS', () => {
    expect(migrateSave(null)).toEqual(DEFAULT_SAVE);
    expect(migrateSave('x')).toEqual(DEFAULT_SAVE);
    const many = Array.from({ length: 12 }, (_, i) => ({ sheet: 'wafer', index: i, u: 0.5, v: 0.5, rotDeg: 0 }));
    expect(sanitizeBoard({ stickers: many }).stickers.length).toBe(TUNING.MAX_STICKERS);
    expect(sanitizeBoard({ stickers: [{ sheet: 'unknownSheet', index: 0, u: 0.5, v: 0.5, rotDeg: 0 }, { sheet: 'chip', index: 2, u: 2, v: -1, rotDeg: 0 }] }).stickers).toEqual([{ sheet: 'chip', index: 2, u: 1, v: 0, rotDeg: 0 }]);
  });

  it('update applies a function and persists the result', () => {
    const storage = memoryStorage();
    const store = createSaveStore(storage);
    const out = store.update((d) => ({ ...d, career: { ...d.career, bestScores: { ...d.career.bestScores, woodshed: 777 } } }));
    expect(out.career.bestScores.woodshed).toBe(777);
    expect(JSON.parse(storage.map.get(SAVE_KEY) ?? '{}').career.bestScores.woodshed).toBe(777);
  });
});

describe('resetCareer (REQ-SAV-02)', () => {
  it('clears career progress and keeps options and the Board Lab', () => {
    const store = createSaveStore(memoryStorage());
    store.save(SAMPLE);
    const after = store.resetCareer();
    expect(after.career).toEqual(DEFAULT_SAVE.career);
    expect(after.board).toEqual(SAMPLE.board);
    expect(after.options).toEqual(SAMPLE.options);
    expect(store.load()).toEqual(after);
  });
});
