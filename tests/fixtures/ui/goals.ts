/**
 * tests/fixtures/ui/goals.ts (ui track): mock goal lists shaped like DESIGN G.1 / G.2 for UI tests and
 * the dev harness (the real lists live in the level files, other tracks). Names only, no real names.
 */

import type { GoalDef } from '../../../src/data/goals';
import type { ParkId } from '../../../src/core/types';

export const STREET_GOALS: readonly GoalDef[] = [
  { id: 'MS-GOAL-01', levelId: 'marketStreet', index: 1, name: 'High Score', condition: { kind: 'runScore', threshold: 'STREET_HIGH_SCORE' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-02', levelId: 'marketStreet', index: 2, name: 'Pro Score', condition: { kind: 'runScore', threshold: 'STREET_PRO_SCORE' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-03', levelId: 'marketStreet', index: 3, name: 'Sick Score', condition: { kind: 'runScore', threshold: 'STREET_SICK_SCORE' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-04', levelId: 'marketStreet', index: 4, name: 'High Combo', condition: { kind: 'comboScore', threshold: 'STREET_HIGH_COMBO' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-05', levelId: 'marketStreet', index: 5, name: 'C-O-D-E', condition: { kind: 'letters' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-06', levelId: 'marketStreet', index: 6, name: '', nameFromMacGuffin: 'secret_laptop', condition: { kind: 'macguffin', id: 'secret_laptop' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-07', levelId: 'marketStreet', index: 7, name: 'Grind the Bus Stop Bar', condition: { kind: 'gapInBankedCombo', gapId: 'MS-G07' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-08', levelId: 'marketStreet', index: 8, name: 'Transfer the Billboard Gap', condition: { kind: 'gapInBankedCombo', gapId: 'MS-G10' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-09', levelId: 'marketStreet', index: 9, name: 'Manual the Crosswalk', condition: { kind: 'gapInBankedCombo', gapId: 'MS-G06' }, reqId: 'REQ-STR-06' },
  { id: 'MS-GOAL-10', levelId: 'marketStreet', index: 10, name: '5,000 over the fountain', condition: { kind: 'comboWithSurface', threshold: 'STREET_FOUNTAIN_COMBO', surfaceId: 'MS-F1', orGapId: 'MS-G04' }, reqId: 'REQ-STR-06' },
];

export const WOODSHED_GOALS: readonly GoalDef[] = [
  { id: 'WS-GOAL-01', levelId: 'woodshed', index: 1, name: 'High Score', condition: { kind: 'runScore', threshold: 'WOODSHED_HIGH_SCORE' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-02', levelId: 'woodshed', index: 2, name: 'Pro Score', condition: { kind: 'runScore', threshold: 'WOODSHED_PRO_SCORE' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-03', levelId: 'woodshed', index: 3, name: 'Sick Score', condition: { kind: 'runScore', threshold: 'WOODSHED_SICK_SCORE' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-04', levelId: 'woodshed', index: 4, name: 'High Combo', condition: { kind: 'comboScore', threshold: 'WOODSHED_HIGH_COMBO' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-05', levelId: 'woodshed', index: 5, name: 'C-O-D-E', condition: { kind: 'letters' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-06', levelId: 'woodshed', index: 6, name: '', nameFromMacGuffin: 'secret_drive', condition: { kind: 'macguffin', id: 'secret_drive' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-07', levelId: 'woodshed', index: 7, name: 'Spine Transfer the Center', condition: { kind: 'gapInBankedCombo', gapId: 'WS-G01' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-08', levelId: 'woodshed', index: 8, name: 'Grind the Rainbow', condition: { kind: 'gapInBankedCombo', gapId: 'WS-G08' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-09', levelId: 'woodshed', index: 9, name: 'Hold a 3-second special', condition: { kind: 'specialHeld', specialIds: ['gpu_slide', 'context_window', 'inference_900ms'], seconds: 'SPECIAL_HOLD_GOAL_S' }, reqId: 'REQ-WSH-06' },
  { id: 'WS-GOAL-10', levelId: 'woodshed', index: 10, name: '2 revert-manuals in one combo', condition: { kind: 'sequenceInCombo', first: 'revert', then: 'manual', count: 'WOODSHED_REVERT_MANUALS' }, reqId: 'REQ-WSH-06' },
];

export const MOCK_GOALS: Readonly<Record<ParkId, readonly GoalDef[]>> = { marketStreet: STREET_GOALS, woodshed: WOODSHED_GOALS, labCampus: [] };
