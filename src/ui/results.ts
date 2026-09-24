/**
 * src/ui/results.ts (ui track): the results card data (REQ-GOL-07, REQ-MNU-06) as a pure function,
 * so goal distance and unlock text are unit-tested in node (tests/ui*.test.ts) instead of waiting for
 * integration. Goal semantics (conditions, TUNING score keys) come from src/data/goals.ts and the
 * level's GoalDef list; this module only formats them.
 */

import type { EventOf } from '../core/events';
import { TUNING } from '../core/tuning';
import { LETTERS, type LetterId } from '../core/types';
import { BRANDS } from '../data/brands';
import { goalName, type GoalDef } from '../data/goals';
import type { SaveData } from '../save/types';
import { formatScore } from './format';
import type { BuildRunResults, RunResults } from './types';

interface Distance {
  /** 0 = done, 1 = nothing achieved yet; goals with no measurable progress get 1. */
  readonly fraction: number;
  readonly text: string;
}

function toGo(threshold: number, have: number): Distance {
  const left = Math.max(0, threshold - have);
  return { fraction: threshold > 0 ? left / threshold : 0, text: `${formatScore(left)} to go` };
}

/** How far this run left a goal from completion, as text ("12,400 to go", "missing E"). */
export function goalDistance(goal: GoalDef, runEnd: EventOf<'runEnd'>): Distance {
  const c = goal.condition;
  switch (c.kind) {
    case 'runScore':
      return toGo(TUNING[c.threshold], runEnd.score);
    case 'comboScore':
      return toGo(TUNING[c.threshold], runEnd.bestCombo);
    case 'comboWithSurface':
      return { ...toGo(TUNING[c.threshold], 0), text: `${formatScore(TUNING[c.threshold])} in one combo over it` };
    case 'letters': {
      const missing = LETTERS.filter((l: LetterId) => !runEnd.letters.includes(l));
      if (missing.length === 0) return { fraction: 0, text: 'all four collected' };
      return { fraction: missing.length / LETTERS.length, text: `missing ${missing.join(', ')}` };
    }
    case 'macguffin':
      return { fraction: runEnd.macguffin ? 0 : 1, text: `find the ${BRANDS.macguffins[c.id].name}` };
    case 'gapInBankedCombo':
      return { fraction: 1, text: 'land it inside a combo' };
    case 'specialHeld':
      return { fraction: 1, text: `hold a special for ${TUNING[c.seconds]} s` };
    case 'sequenceInCombo':
      return { fraction: 1, text: `${TUNING[c.count]} in one combo` };
  }
}

/** Unlock lines for flags that flipped between before and after (REQ-GOL-03, REQ-GOL-04). */
export function unlockLines(before: SaveData, after: SaveData, runEnd: EventOf<'runEnd'>): string[] {
  const lines: string[] = [];
  if (!before.career.woodshedUnlocked && after.career.woodshedUnlocked) lines.push('Woodshed unlocked');
  if (!before.career.labCircuitStamp && after.career.labCircuitStamp) lines.push('Lab Circuit stamp');
  const park = runEnd.levelId;
  if (park === 'marketStreet' || park === 'woodshed') {
    if (runEnd.score > 0 && runEnd.score > before.career.bestScores[park]) lines.push('New best score');
    if (runEnd.bestCombo > 0 && runEnd.bestCombo > before.career.bestCombos[park]) lines.push('New best combo');
  }
  return lines;
}

export const buildRunResults: BuildRunResults = (runEnd, before, after, goals): RunResults => {
  const park = runEnd.levelId;
  const done = new Set<string>(park === 'marketStreet' || park === 'woodshed' ? after.career.goals[park] : []);
  for (const id of runEnd.goalsCompleted) done.add(id);
  const byId = new Map(goals.map((g) => [g.id, g] as const));
  const goalsCompleted = runEnd.goalsCompleted.map((id) => {
    const g = byId.get(id);
    return { id, name: g ? goalName(g) : id };
  });
  let best: { readonly goal: GoalDef; readonly d: Distance } | null = null;
  for (const goal of [...goals].sort((a, b) => a.index - b.index)) {
    if (done.has(goal.id)) continue;
    const d = goalDistance(goal, runEnd);
    if (!best || d.fraction < best.d.fraction) best = { goal, d };
  }
  return {
    levelId: park,
    mode: runEnd.mode,
    score: runEnd.score,
    bestCombo: runEnd.bestCombo,
    goalsCompleted,
    nextGoal: best ? { name: goalName(best.goal), distance: best.d.text } : null,
    letters: runEnd.letters,
    unlocks: unlockLines(before, after, runEnd),
  };
};
