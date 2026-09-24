// tests/simGaps.test.ts (sim track): the named-gap tracker (src/sim/gaps.ts), one test per rule kind
// (REQ-LVL-07, REQ-STR-04 "scoring.test one test per gap rule kind" maps here, ARCHITECTURE.md
// section 10), plus the once-per-combo and void-on-bail rules (REQ-SCR-05, DESIGN E.10). Pure: the
// tracker is fed facts in tick order, exactly as the world does.
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import type { BuiltLevel, GapDef, SurfaceInfo } from '../src/levels/types';
import { createGapTracker, inBox, type GapFeed, type GapTracker } from '../src/sim/gaps';

const P = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function level(gaps: readonly GapDef[], surfaces: Record<string, Partial<SurfaceInfo>> = {}): BuiltLevel {
  return { def: { gaps }, surfaces } as unknown as BuiltLevel;
}

/** Feed a list of facts from tick 0; returns the gap ids earned, in order. */
function feedAll(t: GapTracker, facts: readonly GapFeed[]): string[] {
  const out: string[] = [];
  facts.forEach((f, i) => {
    for (const g of t.feed(f, i)) out.push(g.gap.id);
  });
  return out;
}

const air = (pos: Vec3, surfaceId = 'FLOOR', tag: 'solid' | 'transition' = 'solid'): GapFeed => ({ kind: 'airStart', pos, surfaceId, tag });
const land = (pos: Vec3, surfaceId = 'FLOOR', tag: 'solid' | 'transition' = 'solid'): GapFeed => ({ kind: 'land', pos, surfaceId, tag });
const gStart = (railId: string, pos: Vec3): GapFeed => ({ kind: 'grindStart', railId, pos });
const gSample = (railId: string, pos: Vec3, travelledM: number): GapFeed => ({ kind: 'grindSample', railId, pos, travelledM });
const gEnd = (railId: string, pos: Vec3, travelledM: number): GapFeed => ({ kind: 'grindEnd', railId, pos, travelledM });

describe('inBox (BoxRange: omitted axes unbounded)', () => {
  it('tests each bounded axis inclusively', () => {
    expect(inBox(P(1, 2, 3), { x: [0, 1] })).toBe(true);
    expect(inBox(P(1.01, 2, 3), { x: [0, 1] })).toBe(false);
    expect(inBox(P(1, -5, 3), { y: [-Infinity, 0] })).toBe(true);
    expect(inBox(P(1, 2, 3), undefined)).toBe(true);
  });
});

describe('REQ-LVL-07: one test per gap rule kind', () => {
  it('airBoxToBox: start box -> land box in one air; eitherDirection; a grind snap is not a landing', () => {
    const t = createGapTracker(level([
      { id: 'A', name: 'A', base: 200, rule: { kind: 'airBoxToBox', start: { x: [0, 10] }, land: { x: [20, 30] } } },
      { id: 'B', name: 'B', base: 300, rule: { kind: 'airBoxToBox', start: { x: [0, 10] }, land: { x: [40, 50] }, eitherDirection: true } },
    ]));
    expect(feedAll(t, [air(P(5, 0, 0)), land(P(25, 0, 0))])).toEqual(['A']);
    expect(feedAll(t, [{ kind: 'comboEnd' }, air(P(45, 0, 0)), land(P(5, 0, 0))])).toEqual(['B']);
    expect(feedAll(t, [{ kind: 'comboEnd' }, air(P(5, 0, 0)), gStart('R', P(25, 1, 0)), land(P(25, 0, 0))])).toEqual([]);
  });

  it('airBoxToBox with surfaces: startSurface, landSurface and landOutside', () => {
    const t = createGapTracker(level([
      { id: 'S', name: 'S', base: 200, rule: { kind: 'airBoxToBox', startSurface: 'QP', land: { y: [3.4, 3.7] } } },
      { id: 'O', name: 'O', base: 200, rule: { kind: 'airBoxToBox', startSurface: 'BOWL', land: { y: [-0.1, Infinity] }, landOutside: { x: [4, 24], z: [6, 26] } } },
    ]));
    expect(feedAll(t, [air(P(0, 2, 0), 'QP'), land(P(0, 3.5, 0), 'DECK')])).toEqual(['S']);
    expect(feedAll(t, [{ kind: 'comboEnd' }, air(P(0, 2, 0), 'FLOOR'), land(P(0, 3.5, 0), 'DECK')])).toEqual([]);
    expect(feedAll(t, [{ kind: 'comboEnd' }, air(P(10, 0, 10), 'BOWL'), land(P(10, 0, 10), 'BOWL')])).toEqual([]);
    expect(feedAll(t, [air(P(10, 0, 10), 'BOWL'), land(P(30, 0, 10), 'FLOOR')])).toEqual(['O']);
  });

  it('grindSpan: consecutive grinds on one rail cover from -> to; a type switch keeps the chain', () => {
    const t = createGapTracker(level([
      { id: 'H', name: 'HUBBA', base: 250, rule: { kind: 'grindSpan', rails: ['L1'], axis: 'z', from: { op: '<=', value: 40 }, to: { op: '>=', value: 44 } } },
    ]));
    // No grindEnd is fed for a switch (the world keeps the chain), so the samples just continue.
    const facts: GapFeed[] = [gStart('L1', P(0, 1, 39)), gSample('L1', P(0, 1, 41), 2), gSample('L1', P(0, 1, 43), 4), gSample('L1', P(0, 1, 44.2), 5.2)];
    const earned = feedAll(t, facts);
    expect(earned).toEqual(['H']);
    // Wrong direction (to before from) earns nothing without eitherDirection.
    const back = createGapTracker(level([{ id: 'H', name: 'HUBBA', base: 250, rule: { kind: 'grindSpan', rails: ['L1'], axis: 'z', from: { op: '<=', value: 40 }, to: { op: '>=', value: 44 } } }]));
    expect(feedAll(back, [gStart('L1', P(0, 1, 45)), gSample('L1', P(0, 1, 42), 3), gSample('L1', P(0, 1, 39), 6)])).toEqual([]);
  });

  it('grindDistance: summed along-rail distance on the rail id; another element breaks the chain', () => {
    const rule: GapDef = { id: 'D', name: 'BUS STOP BAR', base: 500, rule: { kind: 'grindDistance', rails: ['R2'], minM: 14 } };
    const t = createGapTracker(level([rule]));
    expect(feedAll(t, [gStart('R2', P(60, 1, 0)), gSample('R2', P(70, 1, 0), 10), gSample('R2', P(73.9, 1, 0), 13.9)])).toEqual([]);
    expect(feedAll(t, [gSample('R2', P(74.1, 1, 0), 14.1)])).toEqual(['D']);
    // Re-snapping the same rail after a non-grind element starts a new chain from 0 (the world's feed).
    const u = createGapTracker(level([rule]));
    expect(feedAll(u, [gStart('R2', P(60, 1, 0)), gEnd('R2', P(68, 1, 0), 8), { kind: 'element', category: 'flip' }, gStart('R2', P(69, 1, 0)), gSample('R2', P(75, 1, 0), 6)])).toEqual([]);
  });

  it('grindSequence: grinds on each step in order within a combo; noGroundContact voids on a landing', () => {
    const t = createGapTracker(level([
      { id: 'Q', name: 'PLAZA BAR HOP', base: 500, rule: { kind: 'grindSequence', steps: [['L1', 'L2'], ['R1']], noGroundContact: true } },
    ]));
    expect(feedAll(t, [gStart('L2', P(0, 1, 0)), gEnd('L2', P(0, 1, 5), 5), air(P(0, 1, 5)), gStart('R1', P(0, 1, 8))])).toEqual(['Q']);
    const u = createGapTracker(level([
      { id: 'Q', name: 'PLAZA BAR HOP', base: 500, rule: { kind: 'grindSequence', steps: [['L1', 'L2'], ['R1']], noGroundContact: true } },
    ]));
    expect(feedAll(u, [gStart('L2', P(0, 1, 0)), gEnd('L2', P(0, 1, 5), 5), air(P(0, 1, 5)), land(P(0, 0, 6)), gStart('R1', P(0, 1, 8))])).toEqual([]);
  });

  it('transferOn: a transfer on the rails earns at once; with then.land / then.grindOn it waits for them', () => {
    const t = createGapTracker(level([
      { id: 'T', name: 'SPINE TRANSFER', base: 500, rule: { kind: 'transferOn', rails: ['SP-W', 'SP-E'] } },
      { id: 'V', name: 'OVER THE VERT', base: 1200, rule: { kind: 'transferOn', rails: ['VW'], then: { land: { x: [84, Infinity], y: [3.5, Infinity] }, grindOn: ['OV'] } } },
    ]));
    expect(feedAll(t, [air(P(40, 2, 20)), { kind: 'transfer', railId: 'SP-E' }])).toEqual(['T']);
    expect(feedAll(t, [{ kind: 'comboEnd' }, air(P(83, 3, 30)), { kind: 'transfer', railId: 'VW' }])).toEqual([]);
    expect(feedAll(t, [land(P(84.3, 3.6, 30))])).toEqual(['V']);
    expect(feedAll(t, [{ kind: 'comboEnd' }, air(P(83, 3, 30)), { kind: 'transfer', railId: 'VW' }, gStart('OV', P(84.5, 4, 30))])).toEqual(['V']);
  });

  it('manualSpan: one manual covering from -> to inside `within`', () => {
    const t = createGapTracker(level([
      { id: 'M', name: 'CROSSWALK MANUAL', base: 350, rule: { kind: 'manualSpan', within: { x: [38, 54] }, axis: 'z', from: { op: '<=', value: 93 }, to: { op: '>=', value: 100.5 }, eitherDirection: true } },
    ]));
    const man = (z: number, x = 46): GapFeed => ({ kind: 'manualSample', pos: P(x, -1.2, z) });
    expect(feedAll(t, [{ kind: 'manualStart', pos: P(46, -1.2, 92) }, man(92.5), man(96), man(99), man(100.6)])).toEqual(['M']);
    // Outside `within` the samples do not count.
    const u = createGapTracker(level([{ id: 'M', name: 'CROSSWALK MANUAL', base: 350, rule: { kind: 'manualSpan', within: { x: [38, 54] }, axis: 'z', from: { op: '<=', value: 93 }, to: { op: '>=', value: 100.5 } } }]));
    expect(feedAll(u, [{ kind: 'manualStart', pos: P(60, -1.2, 92) }, man(92.5, 60), man(100.6, 60)])).toEqual([]);
    // A new manual starts a new span.
    const v = createGapTracker(level([{ id: 'M', name: 'CROSSWALK MANUAL', base: 350, rule: { kind: 'manualSpan', within: { x: [38, 54] }, axis: 'z', from: { op: '<=', value: 93 }, to: { op: '>=', value: 100.5 } } }]));
    expect(feedAll(v, [{ kind: 'manualStart', pos: P(46, -1.2, 92) }, man(92.5), { kind: 'manualEnd', pos: P(46, -1.2, 95) }, { kind: 'manualStart', pos: P(46, -1.2, 96) }, man(100.6)])).toEqual([]);
  });

  it('airApexIn: an air reaching minApexY inside `within`, landing on landSurface', () => {
    const rule: GapDef = { id: 'X', name: 'PIPE HIGH AIR', base: 600, rule: { kind: 'airApexIn', within: { x: [50, 76], z: [26, 34] }, minApexY: 5.5, landSurface: 'FP' } };
    const t = createGapTracker(level([rule]));
    expect(feedAll(t, [air(P(60, 3, 30), 'FP', 'transition'), { kind: 'airSample', pos: P(60, 5.6, 30) }, land(P(60, 1, 28), 'FP', 'transition')])).toEqual(['X']);
    const u = createGapTracker(level([rule]));
    expect(feedAll(u, [air(P(60, 3, 30), 'FP', 'transition'), { kind: 'airSample', pos: P(60, 5.4, 30) }, land(P(60, 1, 28), 'FP', 'transition')])).toEqual([]);
  });

  it('surfaceAzimuth: leave the fountain face and come back on it 45 deg or more around its centre', () => {
    const rule: GapDef = { id: 'F', name: 'FOUNTAIN TRANSFER', base: 750, rule: { kind: 'surfaceAzimuth', surface: 'F1', centre: { x: 52, z: 64 }, minDeltaDeg: 45 } };
    const at = (deg: number): Vec3 => P(52 + 4 * Math.cos((deg * Math.PI) / 180), 1, 64 + 4 * Math.sin((deg * Math.PI) / 180));
    expect(feedAll(createGapTracker(level([rule])), [air(at(0), 'F1', 'transition'), land(at(50), 'F1', 'transition')])).toEqual(['F']);
    expect(feedAll(createGapTracker(level([rule])), [air(at(0), 'F1', 'transition'), land(at(40), 'F1', 'transition')])).toEqual([]);
    // Wraps across +-180.
    expect(feedAll(createGapTracker(level([rule])), [air(at(170), 'F1', 'transition'), land(at(-140), 'F1', 'transition')])).toEqual(['F']);
  });

  it('dropIn: an air from outside the footprint whose first contact is a transition of the surface', () => {
    const rule: GapDef = { id: 'I', name: 'DROP-IN', base: 200, rule: { kind: 'dropIn', surfaces: ['BW1'], minStartY: -0.1 } };
    const surf = { BW1: { id: 'BW1', footprint: { x0: 4, z0: 6, x1: 24, z1: 26 } } };
    expect(feedAll(createGapTracker(level([rule], surf)), [air(P(14, 0, 27)), land(P(14, -1, 24), 'BW1', 'transition')])).toEqual(['I']);
    expect(feedAll(createGapTracker(level([rule], surf)), [air(P(14, -1, 20), 'BW1', 'transition'), land(P(14, -1, 24), 'BW1', 'transition')])).toEqual([]);
    expect(feedAll(createGapTracker(level([rule], surf)), [air(P(14, 0, 27)), land(P(14, -2.4, 16), 'BW1', 'solid')])).toEqual([]);
  });
});

describe('REQ-SCR-05 / DESIGN E.10: once per combo, any number of times per run; a bail voids a pending gap', () => {
  const rule: GapDef = { id: 'T', name: 'SPINE TRANSFER', base: 500, rule: { kind: 'transferOn', rails: ['SP'] } };

  it('the same gap twice in one combo pays once; after the combo ends it pays again', () => {
    const t = createGapTracker(level([rule]));
    expect(feedAll(t, [air(P(0, 2, 0)), { kind: 'transfer', railId: 'SP' }, land(P(1, 1, 0)), air(P(1, 1, 0)), { kind: 'transfer', railId: 'SP' }])).toEqual(['T']);
    expect(t.earnedThisCombo).toEqual(['T']);
    feedAll(t, [{ kind: 'comboEnd' }]);
    expect(t.earnedThisCombo).toEqual([]);
    expect(feedAll(t, [air(P(0, 2, 0)), { kind: 'transfer', railId: 'SP' }])).toEqual(['T']);
  });

  it('a gap started in one combo and ended in the next (a bail between) awards nothing', () => {
    const t = createGapTracker(level([{ id: 'A', name: 'A', base: 200, rule: { kind: 'airBoxToBox', start: { x: [0, 10] }, land: { x: [20, 30] } } }]));
    expect(feedAll(t, [air(P(5, 0, 0)), { kind: 'comboEnd' }, land(P(25, 0, 0))])).toEqual([]);
  });
});
