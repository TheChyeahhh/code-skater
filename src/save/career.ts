/**
 * src/save/career.ts (ui track): pure career updates the app applies at run end through the SaveStore
 * (REQ-GOL-02..04, REQ-SAV-03: never inside a sim tick). Goals accumulate across runs, MacGuffins are
 * once per career, best scores and combos keep the max, the Woodshed unlock and the Lab Circuit stamp
 * are derived from the data every time (so a hand-edited save cannot desync them).
 */

import type { EventOf } from '../core/events';
import type { BoardConfig, GameOptions, ParkId } from '../core/types';
import { hasLabCircuit, isWoodshedUnlocked, PARKS, parkMacGuffin } from '../data/goals';
import type { CareerProgress, SaveData } from './types';

export function isParkId(id: string): id is ParkId {
  return (PARKS as readonly string[]).includes(id);
}

/** Recompute the derived flags from the goal and MacGuffin lists. */
export function deriveFlags(career: CareerProgress): CareerProgress {
  return {
    ...career,
    woodshedUnlocked: isWoodshedUnlocked(career.goals.marketStreet.length),
    labCircuitStamp: hasLabCircuit(career.macguffins),
  };
}

/** Fold one finished run into the career. A testBox run changes nothing. */
export function applyRunEnd(save: SaveData, runEnd: EventOf<'runEnd'>): SaveData {
  const park = runEnd.levelId;
  if (!isParkId(park)) return save;
  const c = save.career;
  const goals = [...c.goals[park]];
  if (runEnd.mode === 'career') {
    for (const id of runEnd.goalsCompleted) if (!goals.includes(id)) goals.push(id);
  }
  const macguffins = [...c.macguffins];
  const mg = parkMacGuffin(park);
  if (runEnd.macguffin && !macguffins.includes(mg)) macguffins.push(mg);
  const career = deriveFlags({
    ...c,
    goals: { ...c.goals, [park]: goals },
    macguffins,
    bestScores: { ...c.bestScores, [park]: Math.max(c.bestScores[park], runEnd.score) },
    bestCombos: { ...c.bestCombos, [park]: Math.max(c.bestCombos[park], runEnd.bestCombo) },
  });
  return { ...save, career };
}

export function withBoard(save: SaveData, board: BoardConfig): SaveData {
  return { ...save, board };
}

export function withOptions(save: SaveData, options: GameOptions): SaveData {
  return { ...save, options };
}
