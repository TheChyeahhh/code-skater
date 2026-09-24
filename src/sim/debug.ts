/**
 * src/sim/debug.ts (sim track): the sim side of the debug hook and a headless replay runner for
 * tests (REQ-DEP-07, REQ-TST-02). The app wraps SimDebugDriver into window.__codeSkater.debug
 * (src/app/debugHook.ts) and adds startRun / unlockAll / ready.
 *
 * setInput(ScriptInput) holds a partial input (omitted fields keep their value) from the next tick;
 * setInput(InputTimeline) plays keyframes relative to the next tick. Each step builds a
 * RawTickInput from the script (no edges: the FrameBuilder derives them from held changes), runs
 * FrameBuilder.next and SkaterWorld.step.
 */

import { BUTTONS } from '../core/types';
import type { Button, ButtonState, DirOrNeutral, InputTimeline, ScriptInput, SimSnapshot, Vec2, Vec3 } from '../core/types';
import type { SimEvent } from '../core/events';
import type { FrameBuilder, RawTickInput } from '../input/types';
import type { SkaterWorld } from './types';

export interface SimDebugDriver {
  setInput(input: ScriptInput | InputTimeline): void;
  /** Advance n ticks; returns the last snapshot. Events are appended to `events`. */
  step(ticks: number): SimSnapshot;
  snapshot(): SimSnapshot;
  teleport(pos: Vec3, dir: Vec3, speed: number): void;
  comboBanked(): number;
  runScore(): number;
  /** Every event produced by step() since the last take. */
  takeEvents(): readonly SimEvent[];
}

interface HeldScript {
  held: Record<Button, boolean>;
  stick: Vec2;
  look: Vec2;
  lookDelta: Vec2;
  dpad: DirOrNeutral;
}

function neutralScript(): HeldScript {
  const held = {} as Record<Button, boolean>;
  for (const b of BUTTONS) held[b] = false;
  return { held, stick: { x: 0, y: 0 }, look: { x: 0, y: 0 }, lookDelta: { x: 0, y: 0 }, dpad: 'N' };
}

function applyScript(s: HeldScript, input: ScriptInput): void {
  if (input.held) for (const b of BUTTONS) if (input.held[b] !== undefined) s.held[b] = input.held[b] === true;
  if (input.stick) s.stick = { x: input.stick.x, y: input.stick.y };
  if (input.look) s.look = { x: input.look.x, y: input.look.y };
  if (input.lookDelta) s.lookDelta = { x: input.lookDelta.x, y: input.lookDelta.y };
  if (input.dpad) s.dpad = input.dpad;
}

function rawOf(s: HeldScript): RawTickInput {
  const held = {} as Record<Button, boolean>;
  for (const b of BUTTONS) held[b] = s.held[b];
  return { held: held as ButtonState, stick: { ...s.stick }, look: { ...s.look }, lookDelta: { ...s.lookDelta }, dpad: s.dpad, source: 'script' };
}

export function createDebugDriver(world: SkaterWorld, builder: FrameBuilder): SimDebugDriver {
  const script = neutralScript();
  let timeline: InputTimeline | null = null;
  let timelineBase = 0;
  let key = 0;
  let events: SimEvent[] = [];

  const stepOnce = (): void => {
    if (timeline) {
      const rel = world.tick - timelineBase;
      while (key < timeline.length && (timeline[key] as InputTimeline[number]).atTick <= rel) {
        applyScript(script, (timeline[key] as InputTimeline[number]).input);
        key += 1;
      }
    }
    const frame = builder.next(rawOf(script), world.tick);
    const res = world.step(frame);
    for (const e of res.events) events.push(e);
  };

  return {
    setInput(input) {
      if (Array.isArray(input)) {
        timeline = [...(input as InputTimeline)].sort((a, b) => a.atTick - b.atTick);
        timelineBase = world.tick;
        key = 0;
      } else {
        applyScript(script, input as ScriptInput);
      }
    },
    step(ticks) {
      const n = Math.max(0, Math.floor(ticks));
      for (let i = 0; i < n; i++) stepOnce();
      return world.snapshot;
    },
    snapshot: () => world.snapshot,
    teleport: (pos, dir, speed) => world.teleport(pos, dir, speed),
    comboBanked: () => world.lastBanked,
    runScore: () => world.snapshot.run.score,
    takeEvents() {
      const out = events;
      events = [];
      return out;
    },
  };
}

/** Headless: run a timeline for `ticks` ticks and collect every snapshot and event (sim tests). */
export function replay(world: SkaterWorld, builder: FrameBuilder, timeline: InputTimeline, ticks: number): { readonly snapshots: readonly SimSnapshot[]; readonly events: readonly SimEvent[] } {
  const driver = createDebugDriver(world, builder);
  driver.setInput(timeline);
  const snapshots: SimSnapshot[] = [];
  for (let i = 0; i < ticks; i++) snapshots.push(driver.step(1));
  return { snapshots, events: driver.takeEvents() };
}
