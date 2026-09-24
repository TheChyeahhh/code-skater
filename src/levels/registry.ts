/**
 * src/levels/registry.ts (integration track, frozen): level id -> LevelDef, loaded lazily so each park
 * is its own chunk after the start gate.
 */

import type { LevelId } from '../core/types';
import type { LevelDef } from './types';

export const LEVEL_IDS: readonly LevelId[] = ['testBox', 'marketStreet', 'woodshed', 'labCampus'];

export async function loadLevelDef(id: LevelId): Promise<LevelDef> {
  switch (id) {
    case 'testBox':
      return (await import('./testBox')).TEST_BOX;
    case 'marketStreet':
      return (await import('./marketStreet')).MARKET_STREET;
    case 'woodshed':
      return (await import('./woodshed')).WOODSHED;
    case 'labCampus':
      return (await import('./labCampus')).LAB_CAMPUS;
  }
}
