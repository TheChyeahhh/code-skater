/**
 * tests/fixtures/input/script.ts (input track): helpers to drive FrameBuilder + parseTick tick by tick.
 * A Script feeds RawTickInput with held buttons, D-pad and stick; presses are derived from held
 * changes (the script path, like the debug hook) unless given explicitly.
 */

import { ticks } from '../../../src/core/tuning';
import { BUTTONS } from '../../../src/core/types';
import type { Button, ButtonState, DirOrNeutral, GrindTypeId, InputFrame, ManualId, SkaterStateName, Vec2 } from '../../../src/core/types';
import { grindTypeFromDir } from '../../../src/data/tricks';
import { createFrameBuilder } from '../../../src/input/frameBuilder';
import { createParserMemory, parseTick } from '../../../src/input/parser';
import type { ParsedAction, ParserContext, ParserMemory, RawTickInput } from '../../../src/input/types';

export function buttons(list: readonly Button[] = []): ButtonState {
  const r = {} as Record<Button, boolean>;
  for (const b of BUTTONS) r[b] = list.includes(b);
  return r;
}

export interface RawSpec {
  readonly held?: readonly Button[];
  readonly dpad?: DirOrNeutral;
  readonly stick?: Vec2;
  readonly pressed?: readonly Button[];
  readonly released?: readonly Button[];
}

export function raw(spec: RawSpec = {}): RawTickInput {
  return {
    held: buttons(spec.held),
    ...(spec.pressed ? { pressed: spec.pressed } : {}),
    ...(spec.released ? { released: spec.released } : {}),
    stick: spec.stick ?? { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    lookDelta: { x: 0, y: 0 },
    dpad: spec.dpad ?? 'N',
    source: 'script',
  };
}

const ALL_DIRS: readonly DirOrNeutral[] = ['N', 'U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];

/** A neutral mock ParserContext; override what a case needs. */
export function ctx(patch: Partial<ParserContext> = {}): ParserContext {
  const byDir = {} as Record<DirOrNeutral, GrindTypeId>;
  for (const d of ALL_DIRS) byDir[d] = grindTypeFromDir(d, true);
  const state: SkaterStateName = patch.state ?? 'Air';
  const manual: ManualId | null = state === 'Manual' ? 'manual' : null;
  return {
    state, glowing: false, speed: 6, onFlat: true, landKind: null, revertUsedThisLanding: false, stateEnteredTick: 0,
    spineTransferAvailable: false, airGrindCandidate: null, groundSnapAvailable: false, grindTypeByDir: byDir,
    currentGrindType: state === 'Grind' ? 'fifty_fifty' : null, ticksSinceLeftSurface: null, poppedThisAir: true,
    crossHeldAtLeftSurface: false, charging: false, manual, rollingFakie: false,
    ...patch,
  };
}

export interface TickLog {
  readonly frame: InputFrame;
  readonly actions: readonly ParsedAction[];
}

/** Runs the builder and parser together; the context can change between calls. */
export class Script {
  readonly builder = createFrameBuilder();
  tick = 0;
  memory: ParserMemory;
  context: ParserContext;
  readonly log: TickLog[] = [];

  constructor(context: ParserContext = ctx()) {
    this.context = context;
    this.memory = createParserMemory(context.state);
  }

  /** Set the context; stateEnteredTick defaults to now when the state changes. */
  set(patch: Partial<ParserContext>): this {
    const state = patch.state ?? this.context.state;
    const derived: Partial<ParserContext> = state === this.context.state ? {} : {
      stateEnteredTick: this.tick,
      manual: state === 'Manual' ? 'manual' : null,
      currentGrindType: state === 'Grind' ? 'fifty_fifty' : null,
    };
    this.context = { ...this.context, ...derived, ...patch };
    return this;
  }

  /** Hold this raw input for n ticks. */
  hold(n: number, spec: RawSpec = {}): this {
    for (let i = 0; i < n; i++) this.step(spec);
    return this;
  }

  /** Hold for ms, converted with ticks(). */
  holdMs(ms: number, spec: RawSpec = {}): this {
    return this.hold(ticks(ms), spec);
  }

  step(spec: RawSpec = {}): TickLog {
    const frame = this.builder.next(raw(spec), this.tick);
    const res = parseTick(this.context, frame, this.memory);
    this.memory = res.memory;
    const entry = { frame, actions: res.actions };
    this.log.push(entry);
    this.tick += 1;
    return entry;
  }

  get last(): InputFrame {
    const l = this.log[this.log.length - 1];
    if (!l) throw new Error('no frames yet');
    return l.frame;
  }

  /** Every action emitted so far (or since log index `from`). */
  actions(from = 0): ParsedAction[] {
    return this.log.slice(from).flatMap((l) => l.actions);
  }

  kinds(from = 0): string[] {
    return this.actions(from).map((a) => a.kind);
  }
}
