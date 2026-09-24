/**
 * src/sim/gaps.ts (sim track): named gap evaluation from element events and box tests only
 * (REQ-LVL-07, REQ-SCR-05, DESIGN E.10). Each gap once per combo, any number of times per run; a bail
 * between start and end voids it; grind rules sum consecutive grind elements on the same rail id.
 *
 * The world feeds facts in tick order; a gap is returned on the tick its last condition is met, so
 * the splash appears the moment it is earned. The world adds the +1 gap element (never degraded,
 * the scoring module's rule) and ends the combo with "comboEnd", which forgets everything pending.
 *
 * Rule readings (DESIGN G.1 / G.2 gap tables):
 * - An air is one airStart -> land interval. A grind snap ends the air without a landing, so an
 *   airBoxToBox rule needs the land in the same air ("no contact between").
 * - A grind chain is consecutive grind elements on one rail id: a type switch keeps the chain (no
 *   grindEnd is fed for a switch); leaving the rail and snapping the same rail again with no other
 *   element in between continues it; any other element or another rail starts a new chain.
 * - grindSpan / manualSpan "cover from -> to": a sample meeting `from` and a later sample meeting
 *   `to` (either order with eitherDirection); manualSpan samples count only inside `within`.
 * - grindSequence: a grind on steps[k]'s rails advances; noGroundContact resets on any ground
 *   contact (landing, rolling, manual) between steps.
 * - airApexIn: some sample of the air inside `within` at feet y >= minApexY, and the landing on
 *   landSurface when given.
 */

import type { SurfaceTag, TrickCategory, Vec3 } from '../core/types';
import type { BoxRange, BuiltLevel, GapDef, GapRule, SpanBound } from '../levels/types';

/** What the world tells the tracker, in tick order. */
export type GapFeed =
  | { readonly kind: 'airStart'; readonly pos: Vec3; readonly surfaceId: string; readonly tag: SurfaceTag }
  | { readonly kind: 'airSample'; readonly pos: Vec3 }
  | { readonly kind: 'land'; readonly pos: Vec3; readonly surfaceId: string; readonly tag: SurfaceTag }
  | { readonly kind: 'grindStart'; readonly railId: string; readonly pos: Vec3 }
  | { readonly kind: 'grindSample'; readonly railId: string; readonly pos: Vec3; readonly travelledM: number }
  | { readonly kind: 'grindEnd'; readonly railId: string; readonly pos: Vec3; readonly travelledM: number }
  | { readonly kind: 'manualStart'; readonly pos: Vec3 }
  | { readonly kind: 'manualSample'; readonly pos: Vec3 }
  | { readonly kind: 'manualEnd'; readonly pos: Vec3 }
  | { readonly kind: 'transfer'; readonly railId: string }
  /** Any ground contact that is not a landing from air (rolling). */
  | { readonly kind: 'groundContact'; readonly surfaceId: string }
  /** The combo banked or was lost: forget pending gaps. */
  | { readonly kind: 'comboEnd' }
  /** Extension (sim track): a non-grind element joined the combo (breaks "consecutive" grind chains). */
  | { readonly kind: 'element'; readonly category: TrickCategory };

export interface EarnedGap {
  readonly gap: GapDef;
  readonly tick: number;
}

export interface GapTracker {
  /** Feed one fact; returns gaps completed by it (usually none). */
  feed(e: GapFeed, tick: number): readonly EarnedGap[];
  /** Gap ids earned in the current combo. */
  readonly earnedThisCombo: readonly string[];
}

/** Axis ranges test (an omitted axis is unbounded). */
export function inBox(p: Vec3, box: BoxRange | undefined): boolean {
  if (!box) return true;
  if (box.x && (p.x < box.x[0] || p.x > box.x[1])) return false;
  if (box.y && (p.y < box.y[0] || p.y > box.y[1])) return false;
  if (box.z && (p.z < box.z[0] || p.z > box.z[1])) return false;
  return true;
}

function meets(value: number, b: SpanBound): boolean {
  return b.op === '<=' ? value <= b.value : value >= b.value;
}

function wrapDeg(a: number): number {
  let r = a % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

/** Progress of a from -> to span (grindSpan, manualSpan). */
interface Span {
  fromSeen: boolean;
  toSeen: boolean;
}

interface AirTrack {
  readonly start: Vec3;
  readonly surfaceId: string;
  readonly tag: SurfaceTag;
  apexHit: Record<string, boolean>;
  transfer: string | null;
}

interface Chain {
  railId: string;
  travelled: number;
  spans: Record<string, Span>;
  open: boolean;
}

export function createGapTracker(level: BuiltLevel): GapTracker {
  const gaps = level.def.gaps;
  let earned: string[] = [];
  let air: AirTrack | null = null;
  let chain: Chain | null = null;
  let manualSpans: Record<string, Span> | null = null;
  let seqProgress: Record<string, number> = {};

  const outsideFootprints = (p: Vec3, ids: readonly string[]): boolean =>
    ids.every((id) => {
      const s = level.surfaces[id];
      if (!s) return true;
      const f = s.footprint;
      return p.x < f.x0 || p.x > f.x1 || p.z < f.z0 || p.z > f.z1;
    });

  const award = (gap: GapDef, tick: number, out: EarnedGap[]): void => {
    if (earned.includes(gap.id)) return;
    earned = [...earned, gap.id];
    out.push({ gap, tick });
  };

  const spanStep = (span: Span, value: number, from: SpanBound, to: SpanBound, either: boolean): boolean => {
    const f = meets(value, from);
    const t = meets(value, to);
    if (span.fromSeen && t) return true;
    if (either && span.toSeen && f) return true;
    if (f) span.fromSeen = true;
    if (t) span.toSeen = true;
    return false;
  };

  const chainSample = (pos: Vec3, travelled: number, tick: number, out: EarnedGap[]): void => {
    if (!chain) return;
    chain.travelled = travelled;
    for (const gap of gaps) {
      const r = gap.rule;
      if (r.kind === 'grindDistance' && r.rails.includes(chain.railId) && chain.travelled >= r.minM) award(gap, tick, out);
      if (r.kind === 'grindSpan' && r.rails.includes(chain.railId)) {
        const span = (chain.spans[gap.id] ??= { fromSeen: false, toSeen: false });
        const v = r.axis === 'x' ? pos.x : pos.z;
        if (spanStep(span, v, r.from, r.to, r.eitherDirection === true)) award(gap, tick, out);
      }
    }
  };

  const groundTouch = (): void => {
    for (const gap of gaps) if (gap.rule.kind === 'grindSequence' && gap.rule.noGroundContact) seqProgress[gap.id] = 0;
  };

  const reset = (): void => {
    earned = [];
    air = null;
    chain = null;
    manualSpans = null;
    seqProgress = {};
  };

  const onLand = (e: Extract<GapFeed, { kind: 'land' }>, tick: number, out: EarnedGap[]): void => {
    const a = air;
    air = null;
    if (a) {
      for (const gap of gaps) {
        const r: GapRule = gap.rule;
        switch (r.kind) {
          case 'airBoxToBox': {
            const fwd = (!r.start || inBox(a.start, r.start)) && (!r.startSurface || a.surfaceId === r.startSurface)
              && (!r.land || inBox(e.pos, r.land)) && (!r.landSurface || e.surfaceId === r.landSurface)
              && (!r.landOutside || !inBox(e.pos, r.landOutside));
            const rev = r.eitherDirection === true && (!r.land || inBox(a.start, r.land)) && (!r.start || inBox(e.pos, r.start))
              && (!r.landSurface || a.surfaceId === r.landSurface) && (!r.startSurface || e.surfaceId === r.startSurface);
            if (fwd || rev) award(gap, tick, out);
            break;
          }
          case 'airApexIn':
            if (a.apexHit[gap.id] && (!r.landSurface || e.surfaceId === r.landSurface)) award(gap, tick, out);
            break;
          case 'surfaceAzimuth':
            if (a.surfaceId === r.surface && e.surfaceId === r.surface) {
              const a1 = Math.atan2(a.start.z - r.centre.z, a.start.x - r.centre.x);
              const a2 = Math.atan2(e.pos.z - r.centre.z, e.pos.x - r.centre.x);
              if (Math.abs(wrapDeg(((a1 - a2) * 180) / Math.PI)) >= r.minDeltaDeg) award(gap, tick, out);
            }
            break;
          case 'dropIn':
            if (a.start.y >= r.minStartY && outsideFootprints(a.start, r.surfaces) && e.tag === 'transition' && r.surfaces.includes(e.surfaceId)) award(gap, tick, out);
            break;
          case 'transferOn':
            if (a.transfer && r.rails.includes(a.transfer) && r.then?.land && inBox(e.pos, r.then.land)) award(gap, tick, out);
            break;
          default:
            break;
        }
      }
    }
    groundTouch();
  };

  const onGrindStart = (e: Extract<GapFeed, { kind: 'grindStart' }>, tick: number, out: EarnedGap[]): void => {
    // A grind snap ends the air; a transfer followed by a grind on then.grindOn earns its gap.
    if (air?.transfer) {
      for (const gap of gaps) {
        const r = gap.rule;
        if (r.kind === 'transferOn' && r.rails.includes(air.transfer) && r.then?.grindOn?.includes(e.railId)) award(gap, tick, out);
      }
    }
    air = null;
    if (!chain || chain.railId !== e.railId) chain = { railId: e.railId, travelled: 0, spans: {}, open: true };
    else chain.open = true;
    for (const gap of gaps) {
      const r = gap.rule;
      if (r.kind !== 'grindSequence') continue;
      const k = seqProgress[gap.id] ?? 0;
      const step = r.steps[k];
      if (step && step.includes(e.railId)) {
        seqProgress[gap.id] = k + 1;
        if (k + 1 >= r.steps.length) award(gap, tick, out);
      } else if (k > 0 && (r.steps[k - 1] as readonly string[]).includes(e.railId)) {
        // Re-snapping the rail of the step just done keeps the progress.
      } else if ((r.steps[0] as readonly string[]).includes(e.railId)) {
        seqProgress[gap.id] = 1;
      } else if (r.noGroundContact) {
        seqProgress[gap.id] = 0;
      }
    }
    chainSample(e.pos, chain.travelled, tick, out);
  };

  return {
    get earnedThisCombo() {
      return earned;
    },
    feed(e, tick) {
      const out: EarnedGap[] = [];
      switch (e.kind) {
        case 'comboEnd':
          reset();
          break;
        case 'airStart':
          air = { start: e.pos, surfaceId: e.surfaceId, tag: e.tag, apexHit: {}, transfer: null };
          if (chain) chain.open = false;
          break;
        case 'airSample':
          if (air) {
            for (const gap of gaps) {
              const r = gap.rule;
              if (r.kind === 'airApexIn' && inBox(e.pos, r.within) && e.pos.y >= r.minApexY) air.apexHit[gap.id] = true;
            }
          }
          break;
        case 'land':
          onLand(e, tick, out);
          break;
        case 'grindStart':
          onGrindStart(e, tick, out);
          break;
        case 'grindSample':
          if (chain && chain.railId === e.railId) chainSample(e.pos, e.travelledM, tick, out);
          break;
        case 'grindEnd':
          if (chain && chain.railId === e.railId) {
            chainSample(e.pos, e.travelledM, tick, out);
            chain.open = false;
          }
          break;
        case 'manualStart':
          manualSpans = {};
          groundTouch();
          chain = null;
          break;
        case 'manualSample':
        case 'manualEnd':
          if (manualSpans) {
            for (const gap of gaps) {
              const r = gap.rule;
              if (r.kind !== 'manualSpan' || !inBox(e.pos, r.within)) continue;
              const span = (manualSpans[gap.id] ??= { fromSeen: false, toSeen: false });
              const v = r.axis === 'x' ? e.pos.x : e.pos.z;
              if (spanStep(span, v, r.from, r.to, r.eitherDirection === true)) award(gap, tick, out);
            }
          }
          if (e.kind === 'manualEnd') manualSpans = null;
          break;
        case 'transfer':
          if (air) air.transfer = e.railId;
          for (const gap of gaps) {
            const r = gap.rule;
            if (r.kind === 'transferOn' && r.rails.includes(e.railId) && !r.then) award(gap, tick, out);
          }
          break;
        case 'groundContact':
          groundTouch();
          break;
        case 'element':
          if (e.category !== 'grind' && e.category !== 'gap') chain = null;
          break;
      }
      return out;
    },
  };
}
