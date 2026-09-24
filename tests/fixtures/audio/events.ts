// tests/fixtures/audio/events.ts (audio track): one valid SimEvent of every type, for the audio
// event map tests. Names are placeholders: real names only ever come from BRANDS.
import type { SimEvent } from '../../../src/core/events';
import type { ComboView } from '../../../src/core/types';

const pos = { x: 1, y: 0, z: 2 };
const combo: ComboView = { elements: [], names: [], base: 0, multiplier: 0, spin180s: 0, final: 0 };

export const ONE_OF_EACH: readonly SimEvent[] = [
  { type: 'stateChanged', tick: 1, from: 'Grounded', to: 'Air', row: '3' },
  { type: 'push', tick: 1, pos },
  { type: 'pop', tick: 1, heightM: 1.2, charge: 0.5, from: 'Crouch', pos },
  { type: 'speedTier', tick: 1, tier: 'fast', prev: 'cruise' },
  { type: 'trickStart', tick: 1, trickId: 'kickflip', category: 'flip', animMs: 300 },
  { type: 'trickLand', tick: 1, trickId: 'kickflip' },
  { type: 'elementAdded', tick: 1, element: { id: 'kickflip', category: 'flip', name: 'Kickflip', value: 100, accrual: 0, open: false }, index: 0, combo },
  { type: 'comboUpdated', tick: 1, combo },
  { type: 'comboBanked', tick: 1, final: 15504, base: 1000, multiplier: 15, elementCount: 6, quality: 'sick', runScore: 20000 },
  { type: 'comboLost', tick: 1, base: 500, multiplier: 3, elementCount: 3, reason: 'landing' },
  { type: 'bail', tick: 1, reason: 'landing', speed: 8, pos },
  { type: 'land', tick: 1, quality: 'ok', offAxisDeg: 15, tiltDeg: 4, vert: false, speed: 7, pos, linker: 'none' },
  { type: 'grindStart', tick: 1, railId: 'R1', railKind: 'rail', grindType: 'fifty_fifty', pos, speed: 7 },
  { type: 'grindSwitch', tick: 1, railId: 'R1', railKind: 'rail', from: 'fifty_fifty', to: 'boardslide', pos },
  { type: 'grindEnd', tick: 1, railId: 'R1', railKind: 'rail', grindType: 'boardslide', reason: 'railEnd', heldS: 1.2, distanceM: 8, pos },
  { type: 'lipStart', tick: 1, railId: 'C1', lipId: 'axle_stall', pos },
  { type: 'lipEnd', tick: 1, railId: 'C1', lipId: 'axle_stall', heldS: 0.8, reason: 'exit' },
  { type: 'manualStart', tick: 1, manualId: 'manual', swap: false, pos },
  { type: 'manualEnd', tick: 1, manualId: 'manual', heldS: 1, reason: 'pop' },
  { type: 'revert', tick: 1, stance: 'switch', pos },
  { type: 'transfer', tick: 1, railId: 'C2', pos },
  { type: 'specialReady', tick: 1 },
  { type: 'specialUsed', tick: 1, specialId: 'kernel_panic' },
  { type: 'specialEmptied', tick: 1, reason: 'drain' },
  { type: 'gap', tick: 1, gapId: 'G1', name: 'TEST GAP', base: 250 },
  { type: 'letter', tick: 1, letter: 'O', collected: ['C', 'O'], pos },
  { type: 'macguffin', tick: 1, id: 'secret_laptop', name: 'TEST ITEM', splash: 'TEST', toast: 'TEST', hitstopTicks: 7, pos },
  { type: 'pickup', tick: 1, kind: 'letter', id: 'O', pos },
  { type: 'npcTalk', tick: 1, npcId: 'sam', name: 'Test', line: 'Hello there.' },
  { type: 'goalCompleted', tick: 1, levelId: 'marketStreet', goalId: 'g1', name: 'Test goal', index: 0 },
  { type: 'runStart', tick: 1, levelId: 'marketStreet', mode: 'career', lengthS: 120 },
  { type: 'runTick', tick: 1, secondsLeft: 5 },
  { type: 'runEnd', tick: 1, levelId: 'marketStreet', mode: 'career', score: 1000, bestCombo: 500, goalsCompleted: [], letters: [], macguffin: false },
  { type: 'pause', tick: 1, paused: true, reason: 'player' },
  { type: 'controllerConnected', tick: 1, id: 'pad0', glyphs: 'xbox' },
  { type: 'controllerDisconnected', tick: 1, id: 'pad0' },
];
