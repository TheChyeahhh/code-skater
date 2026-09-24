// tests/saveCareer.test.ts (ui track): unlock and stamp persistence (REQ-GOL-02..04) through the pure
// applyRunEnd helper the app calls at run end (REQ-SAV-03: never inside a tick).
import { describe, expect, it } from 'vitest';
import type { EventOf } from '../src/core/events';
import { TUNING } from '../src/core/tuning';
import { applyRunEnd, deriveFlags } from '../src/save/career';
import { DEFAULT_SAVE } from '../src/save/types';

function runEnd(patch: Partial<EventOf<'runEnd'>> = {}): EventOf<'runEnd'> {
  return { type: 'runEnd', tick: 14400, levelId: 'marketStreet', mode: 'career', score: 12000, bestCombo: 3000, goalsCompleted: [], letters: [], macguffin: false, ...patch };
}

describe('applyRunEnd', () => {
  it('accumulates goals across runs without duplicates and keeps the best score and combo', () => {
    let save = applyRunEnd(DEFAULT_SAVE, runEnd({ goalsCompleted: ['MS-GOAL-01', 'MS-GOAL-05'], score: 20000, bestCombo: 4000 }));
    expect(save.career.goals.marketStreet).toEqual(['MS-GOAL-01', 'MS-GOAL-05']);
    save = applyRunEnd(save, runEnd({ goalsCompleted: ['MS-GOAL-05', 'MS-GOAL-07'], score: 15000, bestCombo: 9000 }));
    expect(save.career.goals.marketStreet).toEqual(['MS-GOAL-01', 'MS-GOAL-05', 'MS-GOAL-07']);
    expect(save.career.bestScores.marketStreet).toBe(20000);
    expect(save.career.bestCombos.marketStreet).toBe(9000);
    expect(save.career.goals.woodshed).toEqual([]);
  });

  it('unlocks Woodshed at UNLOCK_WOODSHED_GOALS Street goals (REQ-GOL-03)', () => {
    const five = Array.from({ length: TUNING.UNLOCK_WOODSHED_GOALS - 1 }, (_, i) => `MS-GOAL-0${i + 1}`);
    let save = applyRunEnd(DEFAULT_SAVE, runEnd({ goalsCompleted: five }));
    expect(save.career.woodshedUnlocked).toBe(false);
    save = applyRunEnd(save, runEnd({ goalsCompleted: ['MS-GOAL-09'] }));
    expect(save.career.goals.marketStreet.length).toBe(TUNING.UNLOCK_WOODSHED_GOALS);
    expect(save.career.woodshedUnlocked).toBe(true);
  });

  it('collects each MacGuffin once per career and stamps Lab Circuit with both (REQ-GOL-04, REQ-SCR-06)', () => {
    let save = applyRunEnd(DEFAULT_SAVE, runEnd({ macguffin: true }));
    expect(save.career.macguffins).toEqual(['secret_laptop']);
    expect(save.career.labCircuitStamp).toBe(false);
    save = applyRunEnd(save, runEnd({ macguffin: true }));
    expect(save.career.macguffins).toEqual(['secret_laptop']);
    save = applyRunEnd(save, runEnd({ levelId: 'woodshed', macguffin: true }));
    expect(save.career.macguffins).toEqual(['secret_laptop', 'secret_drive']);
    expect(save.career.labCircuitStamp).toBe(true);
  });

  it('a Free Skate run keeps best scores and MacGuffins but adds no goals', () => {
    const save = applyRunEnd(DEFAULT_SAVE, runEnd({ mode: 'free', goalsCompleted: ['MS-GOAL-01'], score: 5000, macguffin: true }));
    expect(save.career.goals.marketStreet).toEqual([]);
    expect(save.career.bestScores.marketStreet).toBe(5000);
    expect(save.career.macguffins).toEqual(['secret_laptop']);
  });

  it('a test box run changes nothing', () => {
    expect(applyRunEnd(DEFAULT_SAVE, runEnd({ levelId: 'testBox', score: 99999, goalsCompleted: ['x'] }))).toBe(DEFAULT_SAVE);
  });

  it('deriveFlags recomputes from the lists (a hand-edited save cannot desync)', () => {
    const c = deriveFlags({ ...DEFAULT_SAVE.career, macguffins: ['secret_laptop', 'secret_drive'], woodshedUnlocked: true, labCircuitStamp: false });
    expect(c.labCircuitStamp).toBe(true);
    expect(c.woodshedUnlocked).toBe(false);
  });
});
