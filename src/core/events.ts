/**
 * src/core/events.ts: the SimEvent union and a typed synchronous event bus (frozen after M0).
 *
 * Producers:
 * - The sim world (src/sim/world.ts) returns gameplay events from each tick; the app emits them on
 *   the bus right after the tick, in order.
 * - The app (src/app/**) emits "pause", "controllerConnected" and "controllerDisconnected".
 * Consumers subscribe: audio (every event), FX, HUD (splashes, toasts, ticker flash), rumble
 * (input track mapping), save (via app at run end only, REQ-SAV-03).
 *
 * Every event carries the sim tick it happened on. Positions are plain Vec3 copies.
 * Continuous values (live accrual, speed, needle) are NOT events: read them from SimSnapshot.
 */

import type {
  BailReason, ComboElementView, ComboView, GlyphSet, GrindTypeId, LandQuality, LetterId, LevelId,
  LipId, MacGuffinId, ManualId, NpcId, RailKind, RunMode, SkaterStateName, SpecialId, SpeedTier, Stance,
  TrickCategory, TrickVariantId, Vec3,
} from './types';

/** Why a grind element ended. "corner" = a polyline bend sharper than GRIND_CORNER_MAX_DEG (REQ-GRD-10). */
export type GrindEndReason = 'pop' | 'railEnd' | 'corner' | 'stall' | 'switch' | 'bail' | 'lip';

export type ManualEndReason = 'pop' | 'stop' | 'slope' | 'leftSurface' | 'grind' | 'swap' | 'bail';

interface At {
  readonly tick: number;
}

export type SimEvent =
  // --- skater state -----------------------------------------------------------------------
  /** Every state machine transition that changed the state (row = DESIGN C.5 row id). */
  | (At & { readonly type: 'stateChanged'; readonly from: SkaterStateName; readonly to: SkaterStateName; readonly row: string })
  /** One push stroke (auto-push cycle start), for the push sound. */
  | (At & { readonly type: 'push'; readonly pos: Vec3 })
  /** Ollie / pop off any surface or linker. */
  | (At & { readonly type: 'pop'; readonly heightM: number; readonly charge: number; readonly from: SkaterStateName; readonly pos: Vec3 })
  /** Speed band changed (FOV kick, speed lines, wind audio); emitted on every change (SpeedTier rule in core/types.ts). */
  | (At & { readonly type: 'speedTier'; readonly tier: SpeedTier; readonly prev: SpeedTier })
  // --- tricks and combo -------------------------------------------------------------------
  /** A flip, grab or special began animating in the air. animMs is null for held grabs. */
  | (At & { readonly type: 'trickStart'; readonly trickId: TrickVariantId; readonly category: TrickCategory; readonly animMs: number | null })
  /** An air trick survived: emitted for each trick of an air that ended cleanly (landing, snap, lip). */
  | (At & { readonly type: 'trickLand'; readonly trickId: TrickVariantId })
  /** A +1 element joined the combo line. */
  | (At & { readonly type: 'elementAdded'; readonly element: ComboElementView; readonly index: number; readonly combo: ComboView })
  /** Elements, multiplier or spin credit changed (not emitted for per-tick hold accrual). */
  | (At & { readonly type: 'comboUpdated'; readonly combo: ComboView })
  /**
   * FINAL added to the run score (REQ-SCR-01). quality = landQuality(offAxisDeg of the most recent
   * contact from Air, final), so it may be sick / insane (REQ-VRT-09). HUD: when quality is sick or
   * insane, REPLACE the land text shown by "land" with SICK / INSANE; clean / ok here change nothing.
   */
  | (At & { readonly type: 'comboBanked'; readonly final: number; readonly base: number; readonly multiplier: number; readonly elementCount: number; readonly quality: LandQuality; readonly runScore: number })
  /** Combo discarded by a bail (REQ-SCR-07). */
  | (At & { readonly type: 'comboLost'; readonly base: number; readonly multiplier: number; readonly elementCount: number; readonly reason: BailReason })
  | (At & { readonly type: 'bail'; readonly reason: BailReason; readonly speed: number; readonly pos: Vec3 })
  /**
   * A clean contact from Air (bails emit "bail" instead). quality = landQuality(offAxisDeg, 0): only
   * clean or ok, because most combos bank ticks later (LandWindow, rows 9 / 9b) or stay alive
   * (rows 7, 8, 13). HUD: show OK for ok, nothing for clean; SICK / INSANE arrive on "comboBanked".
   * The world keeps this offAxisDeg until the combo banks (snapshot.lastLand is rewritten then).
   */
  | (At & { readonly type: 'land'; readonly quality: LandQuality; readonly offAxisDeg: number; readonly tiltDeg: number; readonly vert: boolean; readonly speed: number; readonly pos: Vec3; readonly linker: 'none' | 'manual' | 'revert' | 'crouch' })
  // --- linkers ----------------------------------------------------------------------------
  | (At & { readonly type: 'grindStart'; readonly railId: string; readonly railKind: RailKind; readonly grindType: GrindTypeId; readonly pos: Vec3; readonly speed: number })
  | (At & { readonly type: 'grindSwitch'; readonly railId: string; readonly railKind: RailKind; readonly from: GrindTypeId; readonly to: GrindTypeId; readonly pos: Vec3 })
  | (At & { readonly type: 'grindEnd'; readonly railId: string; readonly railKind: RailKind; readonly grindType: GrindTypeId; readonly reason: GrindEndReason; readonly heldS: number; readonly distanceM: number; readonly pos: Vec3 })
  | (At & { readonly type: 'lipStart'; readonly railId: string; readonly lipId: LipId; readonly pos: Vec3 })
  | (At & { readonly type: 'lipEnd'; readonly railId: string; readonly lipId: LipId; readonly heldS: number; readonly reason: 'exit' | 'bail' })
  /** Manual or nose manual began (swap = true for a nose/normal swap, REQ-MAN-03). */
  | (At & { readonly type: 'manualStart'; readonly manualId: ManualId | 'context_window'; readonly swap: boolean; readonly pos: Vec3 })
  | (At & { readonly type: 'manualEnd'; readonly manualId: ManualId | 'context_window'; readonly heldS: number; readonly reason: ManualEndReason })
  /** Revert fired (CR-04): stance is the NEW stance after the toggle. */
  | (At & { readonly type: 'revert'; readonly stance: Stance; readonly pos: Vec3 })
  /** Spine transfer (REQ-VRT-08). */
  | (At & { readonly type: 'transfer'; readonly railId: string; readonly pos: Vec3 })
  // --- specials ---------------------------------------------------------------------------
  /** Meter reached full: glowing on (REQ-SPC-03). */
  | (At & { readonly type: 'specialReady' })
  | (At & { readonly type: 'specialUsed'; readonly specialId: SpecialId })
  /** Glowing off: meter emptied by a bail or drained below SPECIAL_GLOW_OFF. */
  | (At & { readonly type: 'specialEmptied'; readonly reason: 'bail' | 'drain' })
  // --- level ------------------------------------------------------------------------------
  /** Named gap earned (REQ-SCR-05). name is the splash text. */
  | (At & { readonly type: 'gap'; readonly gapId: string; readonly name: string; readonly base: number })
  | (At & { readonly type: 'letter'; readonly letter: LetterId; readonly collected: readonly LetterId[]; readonly pos: Vec3 })
  /** MacGuffin pickup: the app applies hitstopTicks to the loop (REQ-FX-03). */
  | (At & { readonly type: 'macguffin'; readonly id: MacGuffinId; readonly name: string; readonly splash: string; readonly toast: string; readonly hitstopTicks: number; readonly pos: Vec3 })
  /** Generic pickup (letter or MacGuffin) for FX and audio. */
  | (At & { readonly type: 'pickup'; readonly kind: 'letter' | 'macguffin'; readonly id: string; readonly pos: Vec3 })
  /**
   * Rolled into an NPC talk trigger (REQ-NPC-02): emitted on EVERY entry (leaving and re-entering
   * repeats it). The HUD opens the dialog on it and closes it itself (NpcTalkView in core/types.ts).
   */
  | (At & { readonly type: 'npcTalk'; readonly npcId: NpcId; readonly name: string; readonly line: string })
  | (At & { readonly type: 'goalCompleted'; readonly levelId: LevelId; readonly goalId: string; readonly name: string; readonly index: number })
  // --- run --------------------------------------------------------------------------------
  | (At & { readonly type: 'runStart'; readonly levelId: LevelId; readonly mode: RunMode; readonly lengthS: number })
  /** Once per whole second of the run clock (secondsLeft 119 .. 0), for the HUD pulse and clock ticks. */
  | (At & { readonly type: 'runTick'; readonly secondsLeft: number })
  | (At & { readonly type: 'runEnd'; readonly levelId: LevelId; readonly mode: RunMode; readonly score: number; readonly bestCombo: number; readonly goalsCompleted: readonly string[]; readonly letters: readonly LetterId[]; readonly macguffin: boolean })
  // --- app (not produced by the sim) --------------------------------------------------------
  | (At & { readonly type: 'pause'; readonly paused: boolean; readonly reason: 'player' | 'controller' | 'focus' })
  | (At & { readonly type: 'controllerConnected'; readonly id: string; readonly glyphs: GlyphSet })
  | (At & { readonly type: 'controllerDisconnected'; readonly id: string });

export type SimEventType = SimEvent['type'];
export type EventOf<K extends SimEventType> = Extract<SimEvent, { readonly type: K }>;
export type Unsubscribe = () => void;

/**
 * Typed synchronous event bus. emit() delivers immediately to handlers of that type, then to
 * onAny handlers, in subscription order. An emit from inside a handler is queued and delivered
 * after the current event finishes (FIFO), so delivery order always equals emit order.
 * A throwing handler is reported with console.error and does not stop the others.
 */
export class EventBus {
  private readonly byType = new Map<SimEventType, Array<(e: SimEvent) => void>>();
  private readonly any: Array<(e: SimEvent) => void> = [];
  private readonly queue: SimEvent[] = [];
  private dispatching = false;

  on<K extends SimEventType>(type: K, handler: (e: EventOf<K>) => void): Unsubscribe {
    const list = this.byType.get(type) ?? [];
    const fn = handler as (e: SimEvent) => void;
    list.push(fn);
    this.byType.set(type, list);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  onAny(handler: (e: SimEvent) => void): Unsubscribe {
    this.any.push(handler);
    return () => {
      const i = this.any.indexOf(handler);
      if (i >= 0) this.any.splice(i, 1);
    };
  }

  emit(event: SimEvent): void {
    this.queue.push(event);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.queue.length > 0) {
        const e = this.queue.shift() as SimEvent;
        const typed = this.byType.get(e.type);
        if (typed) for (const h of [...typed]) this.call(h, e);
        for (const h of [...this.any]) this.call(h, e);
      }
    } finally {
      this.dispatching = false;
    }
  }

  emitAll(events: readonly SimEvent[]): void {
    for (const e of events) this.emit(e);
  }

  /** Remove every handler (session teardown). */
  clear(): void {
    this.byType.clear();
    this.any.length = 0;
    this.queue.length = 0;
  }

  private call(handler: (e: SimEvent) => void, e: SimEvent): void {
    try {
      handler(e);
    } catch (err) {
      console.error(`EventBus handler for "${e.type}" threw`, err);
    }
  }
}
