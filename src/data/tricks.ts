/**
 * src/data/tricks.ts: the complete MVP trick catalog (SPEC §9.1 schema, DESIGN D.2 values). Frozen.
 *
 * - Only base tricks are authored. Switch, nollie and fakie variants are DERIVED ids (variantId),
 *   never authored (SPEC §9.1, REQ-DEG-03).
 * - Values that DESIGN's Locked numbers table makes tunable (grab / 50-50 / manual / lip / revert
 *   bases and hold rates, flip tiers and anims, enhanced bonuses, special hold rates, MacGuffin base)
 *   are getters that read TUNING live, so the dev panel changes scoring immediately. Values DESIGN
 *   gives only per trick (directional grind bases, special bases, special anims) are data here.
 * - Names that reference real marks are read from src/data/brands.ts (gpu_slide, MacGuffins).
 * - "gpu_slide" is DESIGN D.2's special grind, renamed from the chip-brand id (DESIGN §L CR-20).
 * - Neutral flip = Kickflip and neutral grab = Indy (M0 default: DESIGN leaves neutral Square /
 *   Circle open; logged in ARCHITECTURE.md decisions).
 */

import { TUNING } from '../core/tuning';
import type {
  AirTrickId, BaseTrickId, Dir8, DirOrNeutral, EnhancedFlipId, FlipId, GrabId, GrindTypeId, LipId,
  MacGuffinId, ManualId, SpecialId, TrickCategory, TrickVariantId, TweakedGrabId,
} from '../core/types';
import { BRANDS } from './brands';

/** SPEC §9.1 schema, plus the optional fields the systems need (all documented). */
export interface Trick {
  readonly id: BaseTrickId;
  /** Display name. For gpu_slide and MacGuffins use trickName(): it reads BRANDS. */
  readonly name: string;
  readonly category: TrickCategory;
  readonly input: {
    readonly button: 'flip' | 'grab' | 'grind' | 'ollie' | 'none';
    /** Direction held with the button; omitted = neutral. */
    readonly dir?: Dir8;
    /** Either of these directions (Boardslide / Lipslide: L or R, chosen by the toe-side rule). */
    readonly dirs?: readonly Dir8[];
    /** Two-direction sequence (specials, manuals). */
    readonly seq?: readonly [Dir8, Dir8];
  };
  readonly base: number;
  /** Points per second while held. */
  readonly holdRate?: number;
  /** Animation length that must finish before landing or snapping (REQ-SM-03). */
  readonly animMs?: number;
  /** Specials: only while glowing (REQ-INP-12). */
  readonly requiresSpecial?: boolean;
  /** "h" grind / lip, "v" manual (CR-02). */
  readonly balanceAxis?: 'h' | 'v';
  readonly reqId: string;
  // ---- extensions (not in the SPEC §9.1 literal schema) ----
  /** Flip difficulty tier 1..4 (for enhanced flips: the tier of the plain flip). */
  readonly tier?: 1 | 2 | 3 | 4;
  /** On a plain flip or grab: its enhanced (double-tap) version. */
  readonly enhancedId?: EnhancedFlipId | TweakedGrabId;
  /** On an enhanced flip or tweaked grab: the plain version. */
  readonly enhancedOf?: FlipId | GrabId;
  /** Specials: the state the input is parsed in (REQ-INP-10 P3). */
  readonly specialState?: 'Air' | 'Grind' | 'Manual';
  /** Held tricks accrue holdRate while held (grabs, holdable specials). */
  readonly holdable?: boolean;
  /** Minimum pose / hold before release counts (grabs 250 ms, 900ms Inference 900 ms). */
  readonly minHoldMs?: number;
  /** Rock to Fakie exits riding fakie. */
  readonly exitsFakie?: boolean;
  /** Boardslide = rail on the toe side at approach; Lipslide = heel side (REQ-GRD-06). */
  readonly side?: 'toe' | 'heel';
}

function flipBase(tier: number): number {
  return TUNING.FLIP_BASE_T1 + (tier - 1) * TUNING.FLIP_TIER_STEP;
}

function flipAnim(tier: 1 | 2 | 3 | 4): number {
  switch (tier) {
    case 1:
      return TUNING.FLIP_ANIM_MS_T1;
    case 2:
      return TUNING.FLIP_ANIM_MS_T2;
    case 3:
      return TUNING.FLIP_ANIM_MS_T3;
    case 4:
      return TUNING.FLIP_ANIM_MS_T4;
  }
}

function flip(id: FlipId, name: string, dir: Dir8, tier: 1 | 2 | 3 | 4, enhancedId: EnhancedFlipId): Trick {
  return {
    id, name, category: 'flip', input: { button: 'flip', dir }, tier, enhancedId, reqId: 'REQ-SCR-09',
    get base() {
      return flipBase(tier);
    },
    get animMs() {
      return flipAnim(tier);
    },
  };
}

function enhancedFlip(id: EnhancedFlipId, name: string, of: FlipId, dir: Dir8, tier: 1 | 2 | 3 | 4): Trick {
  return {
    id, name, category: 'flip', input: { button: 'flip', dir }, tier, enhancedOf: of, reqId: 'REQ-SCR-11',
    get base() {
      return flipBase(tier) + TUNING.FLIP_TIER_STEP;
    },
    get animMs() {
      return flipAnim(tier) + TUNING.ENHANCED_ANIM_EXTRA_MS;
    },
  };
}

function grab(id: GrabId, name: string, dir: Dir8, enhancedId: TweakedGrabId): Trick {
  return {
    id, name, category: 'grab', input: { button: 'grab', dir }, holdable: true, enhancedId, reqId: 'REQ-SCR-09',
    get base() {
      return TUNING.BASE_GRAB;
    },
    get holdRate() {
      return TUNING.HOLD_GRAB;
    },
    get minHoldMs() {
      return TUNING.GRAB_MIN_POSE_MS;
    },
  };
}

function tweaked(id: TweakedGrabId, name: string, of: GrabId, dir: Dir8): Trick {
  return {
    id, name, category: 'grab', input: { button: 'grab', dir }, holdable: true, enhancedOf: of, reqId: 'REQ-SCR-11',
    get base() {
      return TUNING.BASE_GRAB + TUNING.ENHANCED_GRAB_BONUS;
    },
    get holdRate() {
      return TUNING.HOLD_GRAB;
    },
    get minHoldMs() {
      return TUNING.GRAB_MIN_POSE_MS;
    },
  };
}

/** Directional grind: base is DESIGN D.2 data, hold rate is the tunable directional rate. */
function grind(id: GrindTypeId, name: string, base: number, input: Trick['input'], side?: 'toe' | 'heel'): Trick {
  return {
    id, name, category: 'grind', input, base, balanceAxis: 'h', reqId: 'REQ-SCR-09', ...(side ? { side } : {}),
    get holdRate() {
      return TUNING.HOLD_GRIND_DIRECTIONAL;
    },
  };
}

function lip(id: LipId, name: string, dir: Dir8 | undefined, exitsFakie: boolean): Trick {
  return {
    id, name, category: 'lip', input: dir ? { button: 'grind', dir } : { button: 'grind' }, balanceAxis: 'h',
    reqId: 'REQ-LIP-01', ...(exitsFakie ? { exitsFakie } : {}),
    get base() {
      return TUNING.BASE_LIP;
    },
    get holdRate() {
      return TUNING.HOLD_LIP;
    },
  };
}

function manual(id: ManualId, name: string, seq: readonly [Dir8, Dir8]): Trick {
  return {
    id, name, category: 'manual', input: { button: 'none', seq }, balanceAxis: 'v', reqId: 'REQ-MAN-01',
    get base() {
      return TUNING.BASE_MANUAL;
    },
    get holdRate() {
      return TUNING.HOLD_MANUAL;
    },
  };
}

function macguffin(id: MacGuffinId, name: string): Trick {
  return {
    id, name, category: 'macguffin', input: { button: 'none' }, reqId: 'REQ-SCR-06',
    get base() {
      return TUNING.MACGUFFIN_BASE;
    },
  };
}

/** Every authored trick, keyed by id (DESIGN D.2). */
export const TRICKS: Readonly<Record<BaseTrickId, Trick>> = {
  // Flips (Square + Dir8), tiers 100 / 150 / 200 / 250.
  kickflip: flip('kickflip', 'Kickflip', 'L', 1, 'double_kickflip'),
  heelflip: flip('heelflip', 'Heelflip', 'R', 1, 'double_heelflip'),
  pop_shove_it: flip('pop_shove_it', 'Pop Shove-It', 'D', 1, 'shove_it_360'),
  varial_kickflip: flip('varial_kickflip', 'Varial Kickflip', 'UL', 2, 'double_varial_kickflip'),
  varial_heelflip: flip('varial_heelflip', 'Varial Heelflip', 'UR', 2, 'double_varial_heelflip'),
  impossible: flip('impossible', 'Impossible', 'U', 3, 'double_impossible'),
  hardflip: flip('hardflip', 'Hardflip', 'DL', 3, 'double_hardflip'),
  tre_flip: flip('tre_flip', '360 Flip', 'DR', 4, 'double_tre_flip'),
  // Enhanced flips (double-tap): +1 tier of base, +ENHANCED_ANIM_EXTRA_MS anim (REQ-SCR-11).
  double_kickflip: enhancedFlip('double_kickflip', 'Double Kickflip', 'kickflip', 'L', 1),
  double_heelflip: enhancedFlip('double_heelflip', 'Double Heelflip', 'heelflip', 'R', 1),
  shove_it_360: enhancedFlip('shove_it_360', '360 Shove-It', 'pop_shove_it', 'D', 1),
  double_varial_kickflip: enhancedFlip('double_varial_kickflip', 'Double Varial Kickflip', 'varial_kickflip', 'UL', 2),
  double_varial_heelflip: enhancedFlip('double_varial_heelflip', 'Double Varial Heelflip', 'varial_heelflip', 'UR', 2),
  double_impossible: enhancedFlip('double_impossible', 'Double Impossible', 'impossible', 'U', 3),
  double_hardflip: enhancedFlip('double_hardflip', 'Double Hardflip', 'hardflip', 'DL', 3),
  double_tre_flip: enhancedFlip('double_tre_flip', 'Double 360 Flip', 'tre_flip', 'DR', 4),
  // Grabs (Circle + Dir8), holdable.
  nosegrab: grab('nosegrab', 'Nosegrab', 'U', 'tweaked_nosegrab'),
  tailgrab: grab('tailgrab', 'Tailgrab', 'D', 'tweaked_tailgrab'),
  indy: grab('indy', 'Indy', 'L', 'tweaked_indy'),
  melon: grab('melon', 'Melon', 'R', 'tweaked_melon'),
  japan: grab('japan', 'Japan', 'UL', 'tweaked_japan'),
  stalefish: grab('stalefish', 'Stalefish', 'UR', 'tweaked_stalefish'),
  benihana: grab('benihana', 'Benihana', 'DL', 'tweaked_benihana'),
  crossbone: grab('crossbone', 'Crossbone', 'DR', 'tweaked_crossbone'),
  // Tweaked grabs (double-tap): base + ENHANCED_GRAB_BONUS = 200.
  tweaked_nosegrab: tweaked('tweaked_nosegrab', 'Tweaked Nosegrab', 'nosegrab', 'U'),
  tweaked_tailgrab: tweaked('tweaked_tailgrab', 'Tweaked Tailgrab', 'tailgrab', 'D'),
  tweaked_indy: tweaked('tweaked_indy', 'Tweaked Indy', 'indy', 'L'),
  tweaked_melon: tweaked('tweaked_melon', 'Tweaked Melon', 'melon', 'R'),
  tweaked_japan: tweaked('tweaked_japan', 'Tweaked Japan', 'japan', 'UL'),
  tweaked_stalefish: tweaked('tweaked_stalefish', 'Tweaked Stalefish', 'stalefish', 'UR'),
  tweaked_benihana: tweaked('tweaked_benihana', 'Tweaked Benihana', 'benihana', 'DL'),
  tweaked_crossbone: tweaked('tweaked_crossbone', 'Tweaked Crossbone', 'crossbone', 'DR'),
  // Grinds (Triangle + Dir8), balance axis h.
  fifty_fifty: {
    id: 'fifty_fifty', name: '50-50', category: 'grind', input: { button: 'grind' }, balanceAxis: 'h', reqId: 'REQ-SCR-09',
    get base() {
      return TUNING.BASE_FIFTY_FIFTY;
    },
    get holdRate() {
      return TUNING.HOLD_FIFTY_FIFTY;
    },
  },
  nosegrind: grind('nosegrind', 'Nosegrind', 150, { button: 'grind', dir: 'U' }),
  five_o: grind('five_o', '5-0', 150, { button: 'grind', dir: 'D' }),
  boardslide: grind('boardslide', 'Boardslide', 120, { button: 'grind', dirs: ['L', 'R'] }, 'toe'),
  lipslide: grind('lipslide', 'Lipslide', 130, { button: 'grind', dirs: ['L', 'R'] }, 'heel'),
  crooked: grind('crooked', 'Crooked', 160, { button: 'grind', dir: 'UL' }),
  overcrook: grind('overcrook', 'Overcrook', 170, { button: 'grind', dir: 'UR' }),
  feeble: grind('feeble', 'Feeble', 160, { button: 'grind', dir: 'DL' }),
  smith: grind('smith', 'Smith', 180, { button: 'grind', dir: 'DR' }),
  // Lips (MVP, CR-13): Triangle at coping.
  axle_stall: lip('axle_stall', 'Axle Stall', undefined, false),
  rock_to_fakie: lip('rock_to_fakie', 'Rock to Fakie', 'D', true),
  // Manuals (balance axis v).
  manual: manual('manual', 'Manual', ['U', 'D']),
  nose_manual: manual('nose_manual', 'Nose Manual', ['D', 'U']),
  // Revert (R2 on a vert landing, CR-04).
  revert: {
    id: 'revert', name: 'Revert', category: 'revert', input: { button: 'none' }, reqId: 'REQ-REV-01',
    get base() {
      return TUNING.BASE_REVERT;
    },
  },
  // Specials (glowing only, CR-09 / CR-10 / CR-11 / CR-12).
  kernel_panic: {
    id: 'kernel_panic', name: 'Kernel Panic', category: 'special', input: { button: 'grab', seq: ['U', 'D'] },
    base: 3000, animMs: 700, requiresSpecial: true, specialState: 'Air', reqId: 'REQ-SPC-06',
  },
  token_overflow: {
    id: 'token_overflow', name: 'Token Overflow', category: 'special', input: { button: 'flip', seq: ['L', 'R'] },
    base: 2800, animMs: 700, requiresSpecial: true, specialState: 'Air', reqId: 'REQ-SPC-06',
  },
  inference_900ms: {
    id: 'inference_900ms', name: '900ms Inference', category: 'special', input: { button: 'grab', seq: ['D', 'U'] },
    base: 4500, requiresSpecial: true, specialState: 'Air', holdable: true, reqId: 'REQ-SPC-05',
    get holdRate() {
      return TUNING.HOLD_SPECIAL;
    },
    get minHoldMs() {
      return TUNING.INFERENCE_MIN_HOLD_MS;
    },
  },
  gpu_slide: {
    id: 'gpu_slide', name: 'Special Slide', category: 'special', input: { button: 'grind', seq: ['U', 'D'] },
    base: 500, requiresSpecial: true, specialState: 'Grind', holdable: true, balanceAxis: 'h', reqId: 'REQ-INP-13',
    get holdRate() {
      return TUNING.HOLD_SPECIAL;
    },
  },
  context_window: {
    id: 'context_window', name: 'Context Window', category: 'special', input: { button: 'grind', seq: ['L', 'R'] },
    base: 1400, requiresSpecial: true, specialState: 'Manual', holdable: true, balanceAxis: 'v', reqId: 'REQ-INP-14',
    get holdRate() {
      return TUNING.HOLD_CONTEXT_WINDOW;
    },
  },
  // MacGuffins (never degrade, once per career).
  secret_laptop: macguffin('secret_laptop', 'Laptop'),
  secret_drive: macguffin('secret_drive', 'Drive'),
};

export const TRICK_LIST: readonly Trick[] = Object.values(TRICKS);

export function getTrick(id: BaseTrickId): Trick {
  return TRICKS[id];
}

/** Square + Dir8 (REQ-INP-10 P7). Neutral = Kickflip (M0 default). */
export const FLIP_BY_DIR: Readonly<Record<DirOrNeutral, FlipId>> = {
  N: 'kickflip', L: 'kickflip', R: 'heelflip', U: 'impossible', D: 'pop_shove_it',
  UL: 'varial_kickflip', UR: 'varial_heelflip', DL: 'hardflip', DR: 'tre_flip',
};

/** Circle + Dir8 (REQ-INP-10 P7). Neutral = Indy (M0 default). */
export const GRAB_BY_DIR: Readonly<Record<DirOrNeutral, GrabId>> = {
  N: 'indy', U: 'nosegrab', D: 'tailgrab', L: 'indy', R: 'melon',
  UL: 'japan', UR: 'stalefish', DL: 'benihana', DR: 'crossbone',
};

/** Triangle + Dir8; "slide" = L or R, resolved by grindTypeFromDir's toe-side rule (REQ-GRD-06). */
export const GRIND_BY_DIR: Readonly<Record<DirOrNeutral, Exclude<GrindTypeId, 'boardslide' | 'lipslide' | 'gpu_slide'> | 'slide'>> = {
  N: 'fifty_fifty', U: 'nosegrind', D: 'five_o', L: 'slide', R: 'slide',
  UL: 'crooked', UR: 'overcrook', DL: 'feeble', DR: 'smith',
};

/** Lip by Dir8 at the Triangle press: Down = Rock to Fakie, anything else = Axle Stall (CR-13). */
export function lipFromDir(dir: DirOrNeutral): LipId {
  return dir === 'D' ? 'rock_to_fakie' : 'axle_stall';
}

/** Enhanced (double-tap) version of a flip or grab (REQ-INP-04, REQ-SCR-11). */
export function enhancedOf(id: FlipId | GrabId): EnhancedFlipId | TweakedGrabId {
  const e = TRICKS[id].enhancedId;
  if (!e) throw new Error(`no enhanced version for ${id}`);
  return e;
}

/**
 * Grind type for a direction at snap or switch time (REQ-GRD-06). railOnToeSide is computed by the
 * sim: toe side = right of travel when (stance regular XOR fakie), else left; the rail is on the
 * toe side when dot(railPoint - boardCentre, right) x toeSign > 0 (DESIGN E.1).
 */
export function grindTypeFromDir(dir: DirOrNeutral, railOnToeSide: boolean): GrindTypeId {
  const t = GRIND_BY_DIR[dir];
  if (t === 'slide') return railOnToeSide ? 'boardslide' : 'lipslide';
  return t;
}

/** The special whose sequence and button match, in the given state, or null (REQ-INP-10 P3). */
export function specialFor(first: Dir8, second: Dir8, button: 'flip' | 'grab' | 'grind', state: 'Air' | 'Grind' | 'Manual'): SpecialId | null {
  for (const t of TRICK_LIST) {
    if (t.category !== 'special' || t.specialState !== state || t.input.button !== button) continue;
    const seq = t.input.seq;
    if (seq && seq[0] === first && seq[1] === second) return t.id as SpecialId;
  }
  return null;
}

const AIR_CATEGORIES: readonly TrickCategory[] = ['flip', 'grab'];

export interface VariantFlags {
  /** Stance flag is switch when the element is added (CR-05). */
  readonly switchStance: boolean;
  /** Flip/grab with L2 held while rolling forward (REQ-SCR-10). */
  readonly nollie?: boolean;
  /** Flip/grab with L2 held while rolling fakie (REQ-SCR-10). */
  readonly fakie?: boolean;
}

/**
 * Derive the degradation id (REQ-DEG-03): switch_ prefix for any trick in switch stance, then
 * nollie_ / fakie_ for flips and grabs. MacGuffins never take a variant.
 */
export function variantId(baseId: BaseTrickId, flags: VariantFlags): TrickVariantId {
  const t = TRICKS[baseId];
  if (t.category === 'macguffin') return baseId;
  let id: string = baseId;
  if (AIR_CATEGORIES.includes(t.category)) {
    if (flags.nollie) id = `nollie_${id}`;
    else if (flags.fakie) id = `fakie_${id}`;
  }
  if (flags.switchStance) id = `switch_${id}`;
  return id as TrickVariantId;
}

export interface ParsedVariant {
  readonly baseId: BaseTrickId;
  readonly switchStance: boolean;
  readonly nollie: boolean;
  readonly fakie: boolean;
}

/** Inverse of variantId. */
export function parseVariantId(id: TrickVariantId): ParsedVariant {
  let rest: string = id;
  const switchStance = rest.startsWith('switch_');
  if (switchStance) rest = rest.slice('switch_'.length);
  const nollie = rest.startsWith('nollie_');
  if (nollie) rest = rest.slice('nollie_'.length);
  const fakie = rest.startsWith('fakie_');
  if (fakie) rest = rest.slice('fakie_'.length);
  if (!(rest in TRICKS)) throw new Error(`unknown trick id ${id}`);
  return { baseId: rest as BaseTrickId, switchStance, nollie, fakie };
}

/** Brand-resolved display name of a base trick. */
export function baseTrickName(baseId: BaseTrickId): string {
  if (baseId === 'gpu_slide') return BRANDS.specialSlideName;
  if (baseId === 'secret_laptop' || baseId === 'secret_drive') return BRANDS.macguffins[baseId].name;
  return TRICKS[baseId].name;
}

/** Display name of any variant: "Switch Nollie Kickflip", "Fakie Indy", "VIDA Slide". */
export function trickName(id: TrickVariantId): string {
  const v = parseVariantId(id);
  const parts: string[] = [];
  if (v.switchStance) parts.push('Switch');
  if (v.nollie) parts.push('Nollie');
  if (v.fakie) parts.push('Fakie');
  parts.push(baseTrickName(v.baseId));
  return parts.join(' ');
}

/** True for flips and grabs (the tricks with nollie/fakie variants and double-tap versions). */
export function isAirTrick(id: BaseTrickId): id is AirTrickId {
  return AIR_CATEGORIES.includes(TRICKS[id].category);
}
