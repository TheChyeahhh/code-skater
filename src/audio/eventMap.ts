/**
 * src/audio/eventMap.ts (audio track): SimEvent -> synth voices (REQ-AUD-01). Pure: tests run it in
 * node. EVENT_VOICES has an entry for EVERY SimEvent type (the Record type makes a missing one a
 * compile error); an entry that returns [] is deliberately silent, and SILENT_EVENTS says why.
 * Continuous sounds (rolling, grind loop, wind) come from the snapshot in engine.update, not from here.
 */

import type { EventOf, SimEvent, SimEventType } from '../core/events';
import { maxSpeed, TUNING } from '../core/tuning';
import { LETTERS } from '../core/types';
import { clamp01, finite } from './synth';
import type { VoiceId, VoiceParams } from './voices';

/** "ui" plays on the UI bus, which keeps sounding while the game is paused. */
export type AudioBus = 'game' | 'ui';

export interface VoiceCall {
  readonly voice: VoiceId;
  readonly params?: VoiceParams;
  readonly bus?: AudioBus;
}

type Mapper<K extends SimEventType> = (e: EventOf<K>) => readonly VoiceCall[];
type EventVoiceTable = { readonly [K in SimEventType]: Mapper<K> };

const NONE: readonly VoiceCall[] = [];

function speed01(speed: number): number {
  return clamp01(finite(speed, 0) / Math.max(0.1, maxSpeed(false)));
}

/** Bank size to 0..1: 100 points quiet, 100k points full. */
function bankIntensity(final: number): number {
  return clamp01((Math.log10(Math.max(1, finite(final, 0))) - 2) / 3);
}

/** Events that make no sound of their own, and why (tests check this list against the table). */
export const SILENT_EVENTS: Readonly<Partial<Record<SimEventType, string>>> = {
  stateChanged: 'state changes are heard through the events that caused them',
  speedTier: 'wind and rolling follow speedRatio continuously in update()',
  push: 'off by default (AUDIO_PUSH_LEVEL 0, founder 2026-09-23: auto-push stroked every 0.6 s); plays when the level is raised',
  trickLand: 'the land / bank sounds cover it',
  elementAdded: 'the element sounds (pop, grind, manual, gap) cover it',
  comboUpdated: 'no sound per score update',
  lipEnd: 'the stall clack at lipStart is the lip sound; the exit is a pop or land',
  manualEnd: 'the exit is a pop, a land or a bail',
  specialEmptied: 'the bail that empties it already has a sound; a drain is quiet',
  pickup: 'letter and macguffin events carry the pickup sounds',
  runStart: 'the park music starting is the cue',
  pause: 'the app calls setPaused(); the pause menu plays its own UI sounds',
};

export const EVENT_VOICES: EventVoiceTable = {
  stateChanged: () => NONE,
  push: () => (TUNING.AUDIO_PUSH_LEVEL > 0 ? [{ voice: 'push', params: { intensity: TUNING.AUDIO_PUSH_LEVEL } }] : NONE),
  pop: (e) => [{ voice: 'pop', params: { intensity: clamp01(finite(e.charge, 0)) } }],
  speedTier: () => NONE,
  trickStart: (e) => (e.category === 'flip' ? [{ voice: 'flick', params: { intensity: 0.7 } }] : NONE),
  trickLand: () => NONE,
  elementAdded: () => NONE,
  comboUpdated: () => NONE,
  comboBanked: (e) => [{ voice: 'comboBank', params: { intensity: bankIntensity(e.final), variant: e.quality } }],
  comboLost: () => [{ voice: 'comboLost' }],
  bail: (e) => [{ voice: 'bail', params: { intensity: speed01(e.speed) } }],
  land: (e) => [{ voice: 'land', params: { intensity: clamp01(speed01(e.speed) + (e.vert ? 0.25 : 0)), variant: e.quality === 'ok' ? 'ok' : 'clean' } }],
  grindStart: (e) => [{ voice: 'grindOn', params: { variant: e.railKind } }],
  grindSwitch: (e) => [{ voice: 'grindSwitch', params: { variant: e.railKind } }],
  grindEnd: (e) => (e.reason === 'bail' || e.reason === 'switch' || e.reason === 'lip' ? NONE : [{ voice: 'grindOff', params: { variant: e.railKind } }]),
  lipStart: () => [{ voice: 'lipStall' }],
  lipEnd: () => NONE,
  manualStart: () => [{ voice: 'manualSqueak' }],
  manualEnd: () => NONE,
  revert: () => [{ voice: 'revertScuff', params: { intensity: 0.8 } }],
  transfer: () => [{ voice: 'transfer' }],
  specialReady: () => [{ voice: 'specialReady' }],
  specialUsed: () => [{ voice: 'specialUsed' }],
  specialEmptied: () => NONE,
  gap: () => [{ voice: 'gap' }],
  letter: (e) => [{ voice: 'letter', params: { index: Math.max(0, LETTERS.indexOf(e.letter)) } }],
  macguffin: () => [{ voice: 'macguffin' }],
  pickup: () => NONE,
  npcTalk: () => [{ voice: 'uiToast', bus: 'ui' }],
  goalCompleted: () => [{ voice: 'goal' }],
  runStart: () => NONE,
  runTick: (e) => (e.secondsLeft > 0 && e.secondsLeft < TUNING.AUDIO_CLOCK_TICK_FROM_S ? [{ voice: 'clockTick', params: { index: e.secondsLeft } }] : NONE),
  runEnd: () => [{ voice: 'runEndHorn' }],
  pause: () => NONE,
  controllerConnected: () => [{ voice: 'uiConfirm', bus: 'ui' }],
  controllerDisconnected: () => [{ voice: 'uiError', bus: 'ui' }],
};

/** The voices one event plays (possibly none). */
export function voicesForEvent(e: SimEvent): readonly VoiceCall[] {
  const fn = EVENT_VOICES[e.type] as (ev: SimEvent) => readonly VoiceCall[];
  return fn(e);
}
