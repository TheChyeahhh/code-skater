/**
 * tests/input.test.ts (input track): Dir8, the DirEnter ring, the priority parser (DESIGN C.3) and
 * its arbitration rules CR-11 / CR-12, double tap, Context Window, sim-time windows and replay
 * determinism. REQ-INP-02, 03, 04, 07, 10 to 17, REQ-TIM-02, REQ-TIM-03.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { ticks, TUNING } from '../src/core/tuning';
import { BUTTONS, DIR8 } from '../src/core/types';
import type { Button, Dir8, DirOrNeutral, InputFrame, SkaterStateName } from '../src/core/types';
import { analogAxis, combineDir, dir8FromDpad, dir8FromStick, dirParts, dirToAxis } from '../src/input/dir8';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { createParserMemory, newestPair, parseTick, resolveLanding } from '../src/input/parser';
import type { ParsedAction, ParserMemory } from '../src/input/types';
import { ctx, raw, Script } from './fixtures/input/script';

const deg = (d: number): { x: number; y: number } => ({ x: Math.sin((d * Math.PI) / 180), y: Math.cos((d * Math.PI) / 180) });

/** Hold dir for n ticks then neutral for gap ticks. */
function tap(s: Script, dir: DirOrNeutral, n: number, gap = 0, held: readonly Button[] = []): Script {
  s.hold(n, { dpad: dir, held });
  if (gap > 0) s.hold(gap, { held });
  return s;
}

/** One-tick button press (held on this tick, released on the next) with dir held. */
function press(s: Script, button: Button, dir: DirOrNeutral = 'N'): ParsedAction[] {
  const a = s.step({ dpad: dir, held: [button] }).actions;
  s.step({ dpad: dir });
  return [...a];
}

describe('Dir8 (REQ-INP-02)', () => {
  it('maps 16 stick angles (sector centres and both sides of every boundary) to the expected Dir8', () => {
    DIR8.forEach((d, i) => {
      const next = DIR8[(i + 1) % 8] as Dir8;
      expect(dir8FromStick(deg(i * 45)), `centre ${i * 45}`).toBe(d);
      expect(dir8FromStick(deg(i * 45 + 22.5 - 0.01)), `just before ${i * 45 + 22.5}`).toBe(d);
      expect(dir8FromStick(deg(i * 45 + 22.5 + 0.01)), `just after ${i * 45 + 22.5}`).toBe(next);
    });
    // Just counter-clockwise of up is still U; the -22.5 boundary belongs to U (clockwise-next of UL).
    expect(dir8FromStick(deg(-22.5 + 0.01))).toBe('U');
    expect(dir8FromStick(deg(-22.5 - 0.01))).toBe('UL');
  });

  it('applies the 0.35 radial deadzone (inclusive edge), also on diagonals', () => {
    expect(TUNING.STICK_DEADZONE).toBe(0.35);
    expect(dir8FromStick({ x: 0, y: 0.349 })).toBe('N');
    expect(dir8FromStick({ x: 0, y: 0.35 })).toBe('U');
    expect(dir8FromStick({ x: 0.24, y: 0.24 })).toBe('N'); // |v| 0.339
    expect(dir8FromStick({ x: 0.25, y: 0.25 })).toBe('UR'); // |v| 0.354
    expect(dir8FromStick({ x: 0, y: 0 })).toBe('N');
    expect(dir8FromStick({ x: Number.NaN, y: 0 })).toBe('N');
  });

  it('D-pad and stick give identical Dir8 for every direction; opposite D-pad presses cancel', () => {
    for (const d of DIR8) {
      const p = dirParts(d);
      expect(dir8FromDpad(p.up, p.down, p.left, p.right)).toBe(d);
      expect(dir8FromStick(dirToAxis(d))).toBe(d);
    }
    expect(dir8FromDpad(true, true, false, false)).toBe('N');
    expect(dir8FromDpad(true, true, false, true)).toBe('R');
    expect(dir8FromDpad(false, false, true, true)).toBe('N');
  });

  it('D-pad and stick produce identical frames: same dir, same ring, same press directions', () => {
    const run = (useDpad: boolean): InputFrame[] => {
      const b = createFrameBuilder();
      const frames: InputFrame[] = [];
      let t = 0;
      for (const d of ['U', 'N', 'D', 'DL', 'N', 'R'] as const) {
        for (let i = 0; i < 6; i++) {
          const spec = useDpad ? { dpad: d } : { stick: dirToAxis(d) };
          frames.push(b.next(raw({ ...spec, held: i === 4 ? ['flip'] : [] }), t++));
        }
      }
      return frames;
    };
    const a = run(true);
    const b = run(false);
    expect(a.map((f) => f.dir)).toEqual(b.map((f) => f.dir));
    expect(a.map((f) => f.dirHistory)).toEqual(b.map((f) => f.dirHistory));
    expect(a.map((f) => f.pressHistory)).toEqual(b.map((f) => f.pressHistory));
  });

  it('the D-pad wins over the stick; dirAxis rescales the stick past the deadzone', () => {
    expect(combineDir('L', 'U')).toBe('L');
    expect(combineDir('N', 'U')).toBe('U');
    const f = createFrameBuilder().next(raw({ dpad: 'L', stick: { x: 0, y: 1 } }), 0);
    expect(f.dir).toBe('L');
    expect(f.stickDir).toBe('U');
    expect(f.dirAxis).toEqual({ x: -1, y: 0 });
    expect(analogAxis({ x: 0, y: 0.35 }, 'N').y).toBeCloseTo(0, 9);
    expect(analogAxis({ x: 0, y: 1 }, 'N').y).toBeCloseTo(1, 9);
    expect(analogAxis({ x: 0, y: 0.675 }, 'N').y).toBeCloseTo(0.5, 9);
    expect(analogAxis({ x: 0.2, y: 0 }, 'N')).toEqual({ x: 0, y: 0 });
  });
});

describe('DirEnter ring and frames (REQ-INP-03, REQ-INP-17, REQ-TIM-02)', () => {
  it('Up, Neutral, Down yields two entries stamped in sim ticks (tEnter = began, tExit = left)', () => {
    const s = new Script(ctx({ state: 'Air' }));
    s.hold(5); // t0..4
    tap(s, 'U', 10, 4); // U t5..14, neutral t15..18
    tap(s, 'D', 6); // D t19..24
    const h = s.last.dirHistory;
    expect(h.map((e) => e.dir)).toEqual(['U', 'D']);
    expect(h[0]).toEqual({ id: 5, dir: 'U', tEnter: 5, tExit: 15, open: false });
    expect(h[1]).toEqual({ id: 19, dir: 'D', tEnter: 19, tExit: 24, open: true });
    expect(newestPair(s.last, s.memory, 30)?.gapTicks).toBe(4);
  });

  it('a direction held shorter than DIR_MIN_DWELL_TICKS never enters; the entry appears on its dwell tick', () => {
    const s = new Script(ctx({ state: 'Grounded' }));
    tap(s, 'U', 2, 2);
    expect(s.last.dirHistory).toEqual([]);
    s.hold(TUNING.DIR_MIN_DWELL_TICKS - 1, { dpad: 'R' });
    expect(s.last.dirHistory).toEqual([]);
    s.step({ dpad: 'R' });
    expect(s.last.dirHistory.map((e) => e.dir)).toEqual(['R']);
    expect(s.last.dirHistory[0]?.tEnter).toBe(4);
  });

  it('a fast rim sweep Up to Down records only the directions it dwelt on', () => {
    const s = new Script(ctx({ state: 'Grounded' }));
    s.hold(10, { stick: deg(0) });
    for (const a of [30, 55, 80, 105, 130, 155]) s.hold(1, { stick: deg(a) }); // 25 deg per tick
    s.hold(6, { stick: deg(180) });
    expect(s.last.dirHistory.map((e) => e.dir)).toEqual(['U', 'D']);
  });

  it('keeps at most DIR_RING_SIZE entries, oldest first', () => {
    const s = new Script(ctx({ state: 'Grounded' }));
    for (const d of ['U', 'R', 'D', 'L', 'U', 'R'] as const) tap(s, d, 4, 1);
    expect(s.last.dirHistory.map((e) => e.dir)).toEqual(['D', 'L', 'U', 'R']);
  });

  it('passes explicit edges through in order, duplicates kept (two presses in one frame)', () => {
    const b = createFrameBuilder();
    const f = b.next(raw({ held: [], pressed: ['flip', 'flip'], released: ['flip'] }), 0);
    expect(f.pressed).toEqual(['flip', 'flip']);
    expect(f.released).toEqual(['flip']);
    expect(f.pressHistory.map((p) => p.button)).toEqual(['flip', 'flip']);
  });

  it('derives edges from held changes when a script omits them', () => {
    const b = createFrameBuilder();
    b.next(raw({ held: ['grab'] }), 0);
    const f1 = b.next(raw({ held: ['grab', 'flip'] }), 1);
    const f2 = b.next(raw({ held: ['flip'] }), 2);
    expect(f1.pressed).toEqual(['flip']);
    expect(f2.released).toEqual(['grab']);
    expect(f2.pressed).toEqual([]);
  });

  it('recovers a release the edge queue lost (drained while paused): held went down, released says so', () => {
    const b = createFrameBuilder();
    b.next(raw({ held: ['ollie', 'grab'], pressed: ['ollie', 'grab'], released: [] }), 0);
    // Paused: the release edges were drained. The first tick after resume carries empty edge arrays.
    const f = b.next(raw({ held: [], pressed: [], released: [] }), 1);
    expect(f.released).toEqual(['ollie', 'grab']);
    expect(f.pressed).toEqual([]);
    // An edge that did arrive is not doubled.
    b.next(raw({ held: ['flip'], pressed: ['flip'], released: [] }), 2);
    expect(b.next(raw({ held: [], pressed: [], released: ['flip'] }), 3).released).toEqual(['flip']);
    // A press the queue lost is NOT invented (the resume button must not fire a trick).
    expect(b.next(raw({ held: ['grab'], pressed: [], released: [] }), 4).pressed).toEqual([]);
  });

  it('REQ-INP-07: a press records the Dir8 and the nollie modifier held at that tick', () => {
    const b = createFrameBuilder();
    b.next(raw({ dpad: 'L', held: ['nollie'] }), 0);
    const f = b.next(raw({ dpad: 'L', held: ['nollie', 'flip'] }), 1);
    expect(f.pressHistory.at(-1)).toEqual({ button: 'flip', tick: 1, dir: 'L', nollieHeld: true });
  });

  it('reset() forgets history', () => {
    const b = createFrameBuilder();
    b.next(raw({ dpad: 'U', held: ['flip'] }), 0);
    b.next(raw({ dpad: 'U' }), 1);
    b.next(raw({ dpad: 'U' }), 2);
    b.reset();
    expect(b.last).toBeNull();
    const f = b.next(raw({ held: ['flip'] }), 0);
    expect(f.dirHistory).toEqual([]);
    expect(f.pressed).toEqual(['flip']);
  });
});

describe('CR-11: specials consume their pair; specials only while glowing (REQ-INP-11, REQ-INP-12)', () => {
  const kernelPanicThenLand = (glowing: boolean): { s: Script; special: ParsedAction[]; manual: string | null; landWindow: string[] } => {
    const s = new Script(ctx({ state: 'Air', glowing }));
    s.hold(5);
    tap(s, 'U', 10, 3); // U t5..14
    s.hold(4, { dpad: 'D' }); // D t18..21
    const special = press(s, 'grab', 'D');
    // Contact on flat 2 ticks later, still inside MANUAL_LAND_WINDOW_MS of the pair.
    s.hold(1, { dpad: 'D' });
    const land = resolveLanding(s.last, s.memory, s.last.tick, 'flat');
    s.memory = land.memory;
    s.set({ state: 'LandWindow', landKind: 'flat' });
    const from = s.log.length;
    s.hold(ticks(TUNING.MANUAL_LAND_WINDOW_MS), { dpad: 'D' });
    return { s, special, manual: land.manualPair, landWindow: s.kinds(from) };
  };

  it('glowing: U,D + Circle = Kernel Panic, and landing on flat right after never makes a manual', () => {
    const r = kernelPanicThenLand(true);
    expect(r.special).toEqual([{ kind: 'special', specialId: 'kernel_panic' }]);
    expect(r.manual).toBeNull();
    expect(r.landWindow).toEqual([]);
  });

  it('not glowing: the same input is a Tailgrab and the Up,Down pair still links a manual on landing', () => {
    const r = kernelPanicThenLand(false);
    expect(r.special).toEqual([{ kind: 'trick', button: 'grab', dir: 'D', trickId: 'tailgrab', nollie: false, fakie: false }]);
    expect(r.manual).toBe('manual');
  });

  it('not glowing: L,R + Square is a Heelflip and consumes nothing', () => {
    const s = new Script(ctx({ state: 'Air', glowing: false }));
    tap(s, 'L', 6);
    s.hold(3, { dpad: 'R' });
    const a = press(s, 'flip', 'R');
    expect(a).toEqual([{ kind: 'trick', button: 'flip', dir: 'R', trickId: 'heelflip', nollie: false, fakie: false }]);
    expect(s.memory.consumed).toEqual([]);
  });

  it('glowing: L,R + Square = Token Overflow, D,U + Circle = 900ms Inference', () => {
    const s = new Script(ctx({ state: 'Air', glowing: true }));
    tap(s, 'L', 6);
    s.hold(3, { dpad: 'R' });
    expect(press(s, 'flip', 'R')).toEqual([{ kind: 'special', specialId: 'token_overflow' }]);
    tap(s, 'D', 6);
    s.hold(3, { dpad: 'U' });
    expect(press(s, 'grab', 'U')).toEqual([{ kind: 'special', specialId: 'inference_900ms' }]);
  });

  it('the button must follow the second direction within SPECIAL_BUTTON_MS (half-open)', () => {
    const late = new Script(ctx({ state: 'Air', glowing: true }));
    tap(late, 'U', 6);
    late.hold(ticks(TUNING.SPECIAL_BUTTON_MS), { dpad: 'D' }); // D entered at t6, now t6 + 30
    expect(press(late, 'grab', 'D')[0]?.kind).toBe('trick');
    const inTime = new Script(ctx({ state: 'Air', glowing: true }));
    tap(inTime, 'U', 6);
    inTime.hold(ticks(TUNING.SPECIAL_BUTTON_MS) - 1, { dpad: 'D' });
    expect(press(inTime, 'grab', 'D')[0]).toEqual({ kind: 'special', specialId: 'kernel_panic' });
  });
});

describe('CR-12: special grind vs grind switch (REQ-INP-13)', () => {
  /** In Grind: U held, neutral for gapTicks, D held 3 ticks, then Triangle with D held. */
  const grindSeq = (glowing: boolean, gapTicks: number): ParsedAction[] => {
    const s = new Script(ctx({ state: 'Grind', glowing }));
    s.hold(4);
    tap(s, 'U', 8, gapTicks);
    s.hold(3, { dpad: 'D' });
    return press(s, 'grind', 'D');
  };

  it('U,D (200 ms) + Triangle while glowing = special slide', () => {
    expect(grindSeq(true, ticks(200))).toEqual([{ kind: 'special', specialId: 'gpu_slide' }]);
  });

  it('Down and Triangle arriving on the same tick still complete the pair (the press confirms the held direction)', () => {
    const s = new Script(ctx({ state: 'Grind', glowing: true }));
    tap(s, 'U', 8, 4);
    expect(press(s, 'grind', 'D')).toEqual([{ kind: 'special', specialId: 'gpu_slide' }]);
    const a = new Script(ctx({ state: 'Air', glowing: true }));
    tap(a, 'U', 8, 4);
    expect(press(a, 'grab', 'D')).toEqual([{ kind: 'special', specialId: 'kernel_panic' }]);
  });

  it('the same while not glowing = switch to 5-0 (Down)', () => {
    expect(grindSeq(false, ticks(200))).toEqual([{ kind: 'grindSwitch', grindType: 'five_o' }]);
  });

  it('a pair older than SPECIAL_SEQ_MS is not a sequence: glowing still switches (edge 29 vs 30 ticks)', () => {
    const n = ticks(TUNING.SPECIAL_SEQ_MS);
    expect(grindSeq(true, n - 1)).toEqual([{ kind: 'special', specialId: 'gpu_slide' }]);
    expect(grindSeq(true, n)).toEqual([{ kind: 'grindSwitch', grindType: 'five_o' }]);
  });

  it('a single direction + Triangle while glowing = grind switch; neutral or the same type = nothing', () => {
    const s = new Script(ctx({ state: 'Grind', glowing: true }));
    s.hold(3, { dpad: 'U' });
    expect(press(s, 'grind', 'U')).toEqual([{ kind: 'grindSwitch', grindType: 'nosegrind' }]);
    s.hold(ticks(TUNING.SPECIAL_SEQ_MS) + 5);
    expect(press(s, 'grind', 'N')).toEqual([]);
    s.set({ currentGrindType: 'five_o' });
    s.hold(4, { dpad: 'D' });
    expect(press(s, 'grind', 'D')).toEqual([]);
  });

  it('grind switches respect GRIND_SWITCH_COOLDOWN_MS', () => {
    const s = new Script(ctx({ state: 'Grind' }));
    expect(press(s, 'grind', 'U')[0]?.kind).toBe('grindSwitch');
    s.hold(ticks(TUNING.GRIND_SWITCH_COOLDOWN_MS) - 3, { dpad: 'D' });
    expect(press(s, 'grind', 'D')).toEqual([]); // 11 ticks after the first
    expect(press(s, 'grind', 'D')[0]).toEqual({ kind: 'grindSwitch', grindType: 'five_o' }); // 13 ticks
  });
});

describe('Context Window (REQ-INP-14, CR-10)', () => {
  const lr = (glowing: boolean, snap = false): ParsedAction[] => {
    const s = new Script(ctx({ state: 'Manual', glowing, groundSnapAvailable: snap }));
    tap(s, 'L', 8, 4);
    s.hold(3, { dpad: 'R' });
    return press(s, 'grind', 'R');
  };

  it('in Manual, L,R + Triangle while glowing = Context Window', () => {
    expect(lr(true)).toEqual([{ kind: 'special', specialId: 'context_window' }]);
  });

  it('not glowing it falls through to P5b: nothing without a candidate, a ground snap with one', () => {
    expect(lr(false)).toEqual([]);
    expect(lr(false, true)).toEqual([{ kind: 'grindTry', ground: true, buffered: false, dir: 'R' }]);
  });

  it('Triangle release is reported (Context Window end, lip exit)', () => {
    const s = new Script(ctx({ state: 'Manual', glowing: true }));
    s.step({ held: ['grind'] });
    expect(s.step().actions).toEqual([{ kind: 'triangleRelease' }]);
  });
});

describe('Double tap enhanced flips and grabs (REQ-INP-04, P6 / P7)', () => {
  const twoTaps = (button: 'flip' | 'grab', dir: DirOrNeutral, apartTicks: number, dir2: DirOrNeutral = dir): ParsedAction[] => {
    const s = new Script(ctx({ state: 'Air' }));
    s.hold(4, { dpad: dir });
    s.step({ dpad: dir, held: [button] });
    s.hold(apartTicks - 1, { dpad: dir2 });
    s.step({ dpad: dir2, held: [button] });
    s.step({ dpad: dir2 });
    return s.actions();
  };

  it('two kickflip presses 200 ms apart = Double Kickflip once (one trick, one enhance)', () => {
    const a = twoTaps('flip', 'L', ticks(200));
    expect(a).toEqual([
      { kind: 'trick', button: 'flip', dir: 'L', trickId: 'kickflip', nollie: false, fakie: false },
      { kind: 'enhance', trickId: 'double_kickflip' },
    ]);
  });

  it('the window is half-open at DOUBLE_TAP_MS: 29 ticks enhance, 30 ticks is a second trick', () => {
    const n = ticks(TUNING.DOUBLE_TAP_MS);
    expect(twoTaps('flip', 'R', n - 1).map((x) => x.kind)).toEqual(['trick', 'enhance']);
    expect(twoTaps('flip', 'R', n).map((x) => x.kind)).toEqual(['trick', 'trick']);
  });

  it('grabs double tap to their tweaked version; a different direction is a new trick', () => {
    expect(twoTaps('grab', 'N', 10)[1]).toEqual({ kind: 'enhance', trickId: 'tweaked_indy' });
    expect(twoTaps('grab', 'U', 10, 'D').map((x) => x.kind)).toEqual(['trick', 'trick']);
  });

  it('a third tap after the enhance starts a new trick; flips outside Air do nothing', () => {
    const s = new Script(ctx({ state: 'Air' }));
    press(s, 'flip', 'N');
    press(s, 'flip', 'N');
    press(s, 'flip', 'N');
    expect(s.kinds()).toEqual(['trick', 'enhance', 'trick']);
    const g = new Script(ctx({ state: 'Grounded' }));
    expect(press(g, 'flip', 'L')).toEqual([]);
  });

  it('L2 held gives nollie, or fakie when rolling fakie (REQ-SCR-10)', () => {
    const s = new Script(ctx({ state: 'Air' }));
    s.step({ held: ['nollie'] });
    expect(s.step({ held: ['nollie', 'flip'] }).actions[0]).toMatchObject({ nollie: true, fakie: false });
    s.set({ rollingFakie: true });
    s.step({ held: ['nollie'] });
    s.hold(ticks(TUNING.DOUBLE_TAP_MS));
    s.step({ held: ['nollie'] });
    expect(s.step({ held: ['nollie', 'flip'] }).actions[0]).toMatchObject({ nollie: false, fakie: true });
  });
});

describe('Manual readers and sim-time windows (REQ-INP-17, REQ-TIM-03, REQ-TIM-07, REQ-TIM-08)', () => {
  it('Up held 2 s then Down within 100 ms -> MANUAL (leave-to-enter gap)', () => {
    const s = new Script(ctx({ state: 'Grounded', speed: 6 }));
    tap(s, 'U', ticks(2000), ticks(100) - 1);
    s.hold(3, { dpad: 'D' });
    expect(s.actions()).toEqual([{ kind: 'manualEntry', manual: 'manual' }]);
  });

  it('Down, Up -> nose manual; too slow, not flat, or a gap of MANUAL_SEQ_MS -> nothing', () => {
    const run = (patch: Parameters<typeof ctx>[0], gap: number): string[] => {
      const s = new Script(ctx({ state: 'Grounded', ...patch }));
      tap(s, 'D', 6, gap);
      s.hold(4, { dpad: 'U' });
      return s.actions().map((a) => (a.kind === 'manualEntry' ? a.manual : a.kind));
    };
    expect(run({}, 3)).toEqual(['nose_manual']);
    expect(run({ speed: TUNING.MANUAL_MIN_SPEED - 0.01 }, 3)).toEqual([]);
    expect(run({ onFlat: false }, 3)).toEqual([]);
    expect(run({}, ticks(TUNING.MANUAL_SEQ_MS))).toEqual([]);
    expect(run({}, ticks(TUNING.MANUAL_SEQ_MS) - 1)).toEqual(['nose_manual']);
  });

  it('manual on landing: a pair completed 16 ticks before a flat contact links, 17 ticks does not', () => {
    const land = (ticksBefore: number): string | null => {
      const s = new Script(ctx({ state: 'Air' }));
      tap(s, 'U', 6); // U t0..5
      s.hold(3, { dpad: 'D' }); // D entered t6
      const completed = 6;
      while (s.tick <= completed + ticksBefore) s.step({ dpad: 'D' });
      return resolveLanding(s.last, s.memory, completed + ticksBefore, 'flat').manualPair;
    };
    const n = ticks(TUNING.MANUAL_LAND_WINDOW_MS);
    expect(n).toBe(17);
    expect(land(n - 1)).toBe('manual');
    expect(land(n)).toBeNull();
  });

  it('manual after landing: a pair completed inside LandWindow (flat) links; after a vert landing it does not', () => {
    for (const landKind of ['flat', 'vert'] as const) {
      const s = new Script(ctx({ state: 'Air' }));
      s.hold(5);
      s.set({ state: 'LandWindow', landKind });
      tap(s, 'U', 5);
      s.hold(3, { dpad: 'D' });
      expect(s.kinds(), landKind).toEqual(landKind === 'flat' ? ['manualLand'] : []);
    }
  });

  it('a returned landing pair is consumed: the LandWindow reader cannot use it again', () => {
    const s = new Script(ctx({ state: 'Air' }));
    tap(s, 'U', 6);
    s.hold(4, { dpad: 'D' });
    const l = resolveLanding(s.last, s.memory, s.last.tick, 'flat');
    expect(l.manualPair).toBe('manual');
    s.memory = l.memory;
    s.set({ state: 'LandWindow', landKind: 'flat' });
    s.hold(5, { dpad: 'D' });
    expect(s.kinds()).toEqual([]);
  });

  it('revert pre-buffer: R2 17 ticks before a vert contact fires, 18 ticks does not; flat never; cleared either way', () => {
    const at = (before: number, landing: 'flat' | 'vert'): { fired: boolean; mem: ParserMemory } => {
      const s = new Script(ctx({ state: 'Air' }));
      s.hold(3);
      expect(press(s, 'revert')).toEqual([{ kind: 'revertBuffered' }]);
      const pressTick = 3;
      const r = resolveLanding(s.last, s.memory, pressTick + before, landing);
      return { fired: r.revertBuffered, mem: r.memory };
    };
    const n = ticks(TUNING.REVERT_PRE_MS);
    expect(at(n - 1, 'vert').fired).toBe(true);
    expect(at(n, 'vert').fired).toBe(false);
    expect(at(1, 'flat').fired).toBe(false);
    expect(at(1, 'vert').mem.revertBufferTick).toBeNull();
  });

  it('REQ-INP-16: R2 in Air with the transfer condition is a spine transfer and writes no revert buffer', () => {
    const s = new Script(ctx({ state: 'Air', spineTransferAvailable: true }));
    expect(press(s, 'revert')).toEqual([{ kind: 'spineTransfer' }]);
    expect(s.memory.revertBufferTick).toBeNull();
  });

  it('P2b: R2 in a vert LandWindow reverts once; flat or already reverted does nothing', () => {
    expect(press(new Script(ctx({ state: 'LandWindow', landKind: 'vert' })), 'revert')).toEqual([{ kind: 'revert' }]);
    expect(press(new Script(ctx({ state: 'LandWindow', landKind: 'flat' })), 'revert')).toEqual([]);
    expect(press(new Script(ctx({ state: 'LandWindow', landKind: 'vert', revertUsedThisLanding: true })), 'revert')).toEqual([]);
  });

  it('revert to manual: a pair typed during the revert pivot links within REVERT_TO_MANUAL_MS', () => {
    const s = new Script(ctx({ state: 'Air' }));
    s.hold(2);
    s.set({ state: 'RevertWindow', landKind: 'vert' });
    tap(s, 'U', 6);
    s.hold(3, { dpad: 'D' });
    expect(s.actions()).toEqual([{ kind: 'revertManual', manual: 'manual' }]);
    const late = new Script(ctx({ state: 'Air' }));
    late.set({ state: 'RevertWindow', landKind: 'vert' });
    late.hold(ticks(TUNING.REVERT_TO_MANUAL_MS));
    tap(late, 'U', 6);
    late.hold(3, { dpad: 'D' });
    expect(late.actions()).toEqual([]);
  });

  it('REQ-INP-18: 20 alternating balance taps over 4 s produce at most 3 swaps', () => {
    const s = new Script(ctx({ state: 'Grounded' }));
    s.set({ state: 'Manual', manual: 'manual' });
    let swaps = 0;
    for (let i = 0; i < 20; i++) {
      const d: Dir8 = i % 2 === 0 ? 'D' : 'U';
      for (let k = 0; k < ticks(200); k++) {
        const a = s.step({ dpad: d }).actions.find((x) => x.kind === 'manualSwap');
        if (a && a.kind === 'manualSwap') {
          swaps += 1;
          s.set({ manual: a.manual });
        }
      }
    }
    expect(s.tick).toBe(20 * ticks(200));
    expect(swaps).toBeGreaterThan(0);
    expect(swaps).toBeLessThanOrEqual(TUNING.MANUAL_SWAP_MAX_PER_RUN);
  });

  it('a swap needs the second direction held MANUAL_SWAP_MIN_HOLD_TICKS and the opposite pair', () => {
    const s = new Script(ctx({ state: 'Grounded' }));
    s.set({ state: 'Manual', manual: 'manual' });
    tap(s, 'U', 6);
    s.hold(8, { dpad: 'D' }); // U,D = the current type: no swap
    expect(s.kinds()).toEqual([]);
    tap(s, 'D', 6);
    s.hold(TUNING.MANUAL_SWAP_MIN_HOLD_TICKS - 1, { dpad: 'U' });
    expect(s.kinds()).toEqual([]);
    s.step({ dpad: 'U' });
    expect(s.actions()).toEqual([{ kind: 'manualSwap', manual: 'nose_manual' }]);
  });
});

describe('Other priority rows (REQ-INP-10, REQ-INP-15, REQ-TIM-06, REQ-TIM-10, REQ-VRT-04)', () => {
  it('P5: Triangle in Air with no candidate buffers; a candidate within GRIND_PREBUFFER_MS snaps, later not', () => {
    const s = new Script(ctx({ state: 'Air' }));
    expect(press(s, 'grind')).toEqual([]);
    expect(s.memory.grindBufferTick).toBe(0);
    s.hold(8);
    s.set({ airGrindCandidate: 'rail' });
    expect(s.step().actions).toEqual([{ kind: 'grindTry', ground: false, buffered: true, dir: 'N' }]);
    const late = new Script(ctx({ state: 'Air' }));
    press(late, 'grind');
    late.hold(ticks(TUNING.GRIND_PREBUFFER_MS) - 2);
    late.set({ airGrindCandidate: 'lip' });
    expect(late.step().actions).toEqual([]);
    expect(late.memory.grindBufferTick).toBeNull();
  });

  it('P5 with a candidate tries now; P5c: Triangle held in Crouch buffers from the pop tick', () => {
    expect(press(new Script(ctx({ state: 'Air', airGrindCandidate: 'rail' })), 'grind', 'U'))
      .toEqual([{ kind: 'grindTry', ground: false, buffered: false, dir: 'U' }]);
    const s = new Script(ctx({ state: 'Crouch' }));
    s.hold(5, { held: ['ollie', 'grind'] });
    s.set({ state: 'Air' });
    s.step({ held: ['grind'] });
    expect(s.memory.grindBufferTick).toBe(5);
  });

  it('P8 / P9: a one-tick Cross tap in Grounded is press then release; Crouch release pops', () => {
    const g = new Script(ctx({ state: 'Grounded' }));
    expect(g.step({ held: [], pressed: ['ollie'], released: ['ollie'] }).actions.map((a) => a.kind)).toEqual(['crossPress', 'crossRelease']);
    const c = new Script(ctx({ state: 'Crouch' }));
    c.hold(10, { held: ['ollie'] });
    expect(c.step().actions).toEqual([{ kind: 'crossRelease' }]);
  });

  it('P8b coyote: Cross in Air within COYOTE_MS of leaving a surface pops once', () => {
    const n = ticks(TUNING.COYOTE_MS);
    expect(press(new Script(ctx({ state: 'Air', ticksSinceLeftSurface: n - 1, poppedThisAir: false })), 'ollie')).toEqual([{ kind: 'coyotePop' }]);
    expect(press(new Script(ctx({ state: 'Air', ticksSinceLeftSurface: n, poppedThisAir: false })), 'ollie')).toEqual([]);
    expect(press(new Script(ctx({ state: 'Air', ticksSinceLeftSurface: 2, poppedThisAir: true })), 'ollie')).toEqual([]);
  });

  it('P10: L1 / R1 in Air queue a -180 / +180 quick spin (CR-01); nothing on the ground', () => {
    expect(press(new Script(ctx({ state: 'Air' })), 'spinL')).toEqual([{ kind: 'quickSpin', deg: -180 }]);
    expect(press(new Script(ctx({ state: 'Air' })), 'spinR')).toEqual([{ kind: 'quickSpin', deg: 180 }]);
    expect(press(new Script(ctx({ state: 'Grounded' })), 'spinR')).toEqual([]);
  });

  it('GetUp, Bail and RunEnd parse nothing (pause belongs to the app)', () => {
    for (const state of ['GetUp', 'Bail', 'RunEnd'] as SkaterStateName[]) {
      const s = new Script(ctx({ state, glowing: true }));
      for (const b of BUTTONS) press(s, b, 'U');
      tap(s, 'D', 5);
      expect(s.actions(), state).toEqual([]);
    }
  });

  it('actions come out in press order, one per press', () => {
    const b = createFrameBuilder();
    const f = b.next(raw({ held: ['flip'], pressed: ['spinL', 'flip', 'revert'] }), 0);
    const r = parseTick(ctx({ state: 'Air' }), f, createParserMemory('Air'));
    expect(r.actions.map((a) => a.kind)).toEqual(['quickSpin', 'trick', 'revertBuffered']);
  });

  it('consumed ids stay bounded to the ring', () => {
    const s = new Script(ctx({ state: 'Air', glowing: true }));
    for (let i = 0; i < 6; i++) {
      tap(s, 'U', 5);
      s.hold(3, { dpad: 'D' });
      press(s, 'grab', 'D');
      s.hold(4);
    }
    expect(s.kinds().filter((k) => k === 'special').length).toBe(6);
    const live = new Set(s.last.dirHistory.map((e) => e.id));
    for (const id of s.memory.consumed) expect(live.has(id)).toBe(true);
  });
});

describe('Replay determinism (REQ-INP-10)', () => {
  const STATES: SkaterStateName[] = ['Grounded', 'Air', 'Grind', 'Manual', 'LandWindow', 'RevertWindow', 'Crouch'];
  const replay = (seed: number): string => {
    const rng = createRng(seed);
    const s = new Script(ctx({ state: 'Grounded' }));
    const dirs: DirOrNeutral[] = ['N', ...DIR8];
    for (let i = 0; i < 8000; i++) {
      if (i % 90 === 0) s.set({ state: STATES[rng.int(STATES.length)], glowing: rng.next() < 0.5, landKind: rng.next() < 0.5 ? 'flat' : 'vert' });
      const held = BUTTONS.filter(() => rng.next() < 0.08);
      const useStick = rng.next() < 0.5;
      const d = dirs[rng.int(dirs.length)] as DirOrNeutral;
      const n = 1 + rng.int(6);
      for (let k = 0; k < n; k++) s.step(useStick ? { held, stick: { x: dirToAxis(d).x * rng.range(0.2, 1), y: dirToAxis(d).y } } : { held, dpad: d });
    }
    return JSON.stringify({ log: s.log, memory: s.memory });
  };

  it('the same frames in give the same intents out, byte for byte', () => {
    const a = replay(1234);
    expect(replay(1234)).toBe(a);
    expect(replay(99)).not.toBe(a);
    const parsed = JSON.parse(a) as { log: { actions: ParsedAction[] }[] };
    const kinds = new Set(parsed.log.flatMap((l) => l.actions.map((x) => x.kind)));
    // The random script exercises most of the table.
    for (const k of ['trick', 'enhance', 'special', 'grindSwitch', 'crossPress', 'quickSpin', 'revertBuffered']) expect(kinds.has(k as ParsedAction['kind']), k).toBe(true);
  });

  it('parseTick does not mutate its inputs', () => {
    const s = new Script(ctx({ state: 'Air', glowing: true }));
    tap(s, 'U', 5);
    s.hold(3, { dpad: 'D' });
    const frame = s.builder.next(raw({ dpad: 'D', held: ['grab'] }), s.tick);
    const mem = s.memory;
    const before = JSON.stringify({ frame, mem });
    const r1 = parseTick(s.context, frame, mem);
    const r2 = parseTick(s.context, frame, mem);
    expect(JSON.stringify({ frame, mem })).toBe(before);
    expect(r2).toEqual(r1);
  });
});
