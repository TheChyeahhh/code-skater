// tests/tricks.test.ts (integration): the catalog equals DESIGN D.2 (REQ-SCR-09, REQ-SCR-11), variants
// are derived never authored (REQ-DEG-03), and brand-referencing names read BRANDS (SPEC §11).
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import type { BaseTrickId, TrickVariantId } from '../src/core/types';
import { BRANDS } from '../src/data/brands';
import {
  enhancedOf, FLIP_BY_DIR, getTrick, GRAB_BY_DIR, grindTypeFromDir, lipFromDir, parseVariantId, specialFor,
  TRICK_LIST, TRICKS, trickName, variantId,
} from '../src/data/tricks';

afterEach(() => resetTuning());

// DESIGN D.2: [id, category, base, holdRate | null, animMs | null]
const D2: [BaseTrickId, string, number, number | null, number | null][] = [
  ['kickflip', 'flip', 100, null, 300], ['heelflip', 'flip', 100, null, 300], ['pop_shove_it', 'flip', 100, null, 300],
  ['varial_kickflip', 'flip', 150, null, 340], ['varial_heelflip', 'flip', 150, null, 340],
  ['impossible', 'flip', 200, null, 380], ['hardflip', 'flip', 200, null, 380], ['tre_flip', 'flip', 250, null, 420],
  ['double_kickflip', 'flip', 150, null, 420], ['double_heelflip', 'flip', 150, null, 420], ['shove_it_360', 'flip', 150, null, 420],
  ['double_varial_kickflip', 'flip', 200, null, 460], ['double_varial_heelflip', 'flip', 200, null, 460],
  ['double_impossible', 'flip', 250, null, 500], ['double_hardflip', 'flip', 250, null, 500], ['double_tre_flip', 'flip', 300, null, 540],
  ['nosegrab', 'grab', 150, 100, null], ['tailgrab', 'grab', 150, 100, null], ['indy', 'grab', 150, 100, null],
  ['melon', 'grab', 150, 100, null], ['japan', 'grab', 150, 100, null], ['stalefish', 'grab', 150, 100, null],
  ['benihana', 'grab', 150, 100, null], ['crossbone', 'grab', 150, 100, null],
  ['tweaked_nosegrab', 'grab', 200, 100, null], ['tweaked_tailgrab', 'grab', 200, 100, null], ['tweaked_indy', 'grab', 200, 100, null],
  ['tweaked_melon', 'grab', 200, 100, null], ['tweaked_japan', 'grab', 200, 100, null], ['tweaked_stalefish', 'grab', 200, 100, null],
  ['tweaked_benihana', 'grab', 200, 100, null], ['tweaked_crossbone', 'grab', 200, 100, null],
  ['fifty_fifty', 'grind', 100, 80, null], ['nosegrind', 'grind', 150, 90, null], ['five_o', 'grind', 150, 90, null],
  ['boardslide', 'grind', 120, 90, null], ['lipslide', 'grind', 130, 90, null], ['crooked', 'grind', 160, 90, null],
  ['overcrook', 'grind', 170, 90, null], ['feeble', 'grind', 160, 90, null], ['smith', 'grind', 180, 90, null],
  ['axle_stall', 'lip', 150, 100, null], ['rock_to_fakie', 'lip', 150, 100, null],
  ['manual', 'manual', 50, 40, null], ['nose_manual', 'manual', 50, 40, null], ['revert', 'revert', 100, null, null],
  ['kernel_panic', 'special', 3000, null, 700], ['token_overflow', 'special', 2800, null, 700],
  ['inference_900ms', 'special', 4500, 150, null], ['gpu_slide', 'special', 500, 150, null], ['context_window', 'special', 1400, 60, null],
  ['secret_laptop', 'macguffin', 2500, null, null], ['secret_drive', 'macguffin', 2500, null, null],
];

describe('catalog = DESIGN D.2', () => {
  it('has exactly the D.2 tricks', () => {
    expect(TRICK_LIST.map((t) => t.id).sort()).toEqual(D2.map((r) => r[0]).sort());
  });

  it.each(D2)('%s: %s base %s hold %s anim %s', (id, category, base, hold, anim) => {
    const t = getTrick(id);
    expect(t.id).toBe(id);
    expect(t.category).toBe(category);
    expect(t.base).toBe(base);
    expect(t.holdRate ?? null).toBe(hold);
    expect(t.animMs ?? null).toBe(anim);
    expect(t.reqId).toMatch(/^REQ-/);
  });

  it('REQ-SCR-11: no enhanced anim exceeds 740 ms; enhanced = base + one tier', () => {
    for (const t of TRICK_LIST) {
      if (t.enhancedOf) {
        const plain = TRICKS[t.enhancedOf];
        expect(t.base, t.id).toBe(plain.base + TUNING.FLIP_TIER_STEP);
        if (t.animMs !== undefined) expect(t.animMs, t.id).toBeLessThanOrEqual(740);
      }
    }
    expect(enhancedOf('kickflip')).toBe('double_kickflip');
    expect(enhancedOf('indy')).toBe('tweaked_indy');
  });

  it('balance axes: grind and lip horizontal, manual vertical (CR-02)', () => {
    for (const t of TRICK_LIST) {
      if (t.category === 'grind' || t.category === 'lip') expect(t.balanceAxis, t.id).toBe('h');
      if (t.category === 'manual') expect(t.balanceAxis, t.id).toBe('v');
    }
    expect(TRICKS.context_window.balanceAxis).toBe('v');
    expect(TRICKS.gpu_slide.balanceAxis).toBe('h');
  });

  it('tunable bases follow TUNING live (dev panel)', () => {
    TUNING.BASE_GRAB = 175;
    TUNING.FLIP_TIER_STEP = 60;
    expect(TRICKS.indy.base).toBe(175);
    expect(TRICKS.tweaked_indy.base).toBe(175 + TUNING.ENHANCED_GRAB_BONUS);
    expect(TRICKS.tre_flip.base).toBe(100 + 3 * 60);
  });
});

describe('input tables', () => {
  it('flip and grab directions per SPEC §9.1', () => {
    expect([FLIP_BY_DIR.L, FLIP_BY_DIR.R, FLIP_BY_DIR.U, FLIP_BY_DIR.D]).toEqual(['kickflip', 'heelflip', 'impossible', 'pop_shove_it']);
    expect([FLIP_BY_DIR.UL, FLIP_BY_DIR.UR, FLIP_BY_DIR.DL, FLIP_BY_DIR.DR]).toEqual(['varial_kickflip', 'varial_heelflip', 'hardflip', 'tre_flip']);
    expect([GRAB_BY_DIR.U, GRAB_BY_DIR.D, GRAB_BY_DIR.L, GRAB_BY_DIR.R]).toEqual(['nosegrab', 'tailgrab', 'indy', 'melon']);
    expect([GRAB_BY_DIR.UL, GRAB_BY_DIR.UR, GRAB_BY_DIR.DL, GRAB_BY_DIR.DR]).toEqual(['japan', 'stalefish', 'benihana', 'crossbone']);
  });

  it('grind types by direction with the toe-side rule (REQ-GRD-06)', () => {
    expect(grindTypeFromDir('N', true)).toBe('fifty_fifty');
    expect(grindTypeFromDir('U', true)).toBe('nosegrind');
    expect(grindTypeFromDir('D', false)).toBe('five_o');
    expect(grindTypeFromDir('L', true)).toBe('boardslide');
    expect(grindTypeFromDir('R', false)).toBe('lipslide');
    expect(grindTypeFromDir('DR', true)).toBe('smith');
    expect(lipFromDir('N')).toBe('axle_stall');
    expect(lipFromDir('D')).toBe('rock_to_fakie');
  });

  it('special sequences per state (CR-10, CR-12)', () => {
    expect(specialFor('U', 'D', 'grab', 'Air')).toBe('kernel_panic');
    expect(specialFor('L', 'R', 'flip', 'Air')).toBe('token_overflow');
    expect(specialFor('D', 'U', 'grab', 'Air')).toBe('inference_900ms');
    expect(specialFor('U', 'D', 'grind', 'Grind')).toBe('gpu_slide');
    expect(specialFor('L', 'R', 'grind', 'Manual')).toBe('context_window');
    expect(specialFor('U', 'D', 'grind', 'Air')).toBeNull();
    expect(specialFor('R', 'L', 'flip', 'Air')).toBeNull();
  });
});

describe('derived variant ids (REQ-DEG-03, REQ-SCR-10)', () => {
  it('switch, nollie, fakie prefixes in DESIGN order', () => {
    expect(variantId('kickflip', { switchStance: false })).toBe('kickflip');
    expect(variantId('kickflip', { switchStance: true })).toBe('switch_kickflip');
    expect(variantId('kickflip', { switchStance: false, nollie: true })).toBe('nollie_kickflip');
    expect(variantId('kickflip', { switchStance: false, fakie: true })).toBe('fakie_kickflip');
    expect(variantId('kickflip', { switchStance: true, nollie: true })).toBe('switch_nollie_kickflip');
    expect(variantId('manual', { switchStance: true })).toBe('switch_manual');
    expect(variantId('manual', { switchStance: false, nollie: true })).toBe('manual');
    expect(variantId('secret_laptop', { switchStance: true })).toBe('secret_laptop');
  });

  it('parseVariantId inverts variantId for every trick and flag combination', () => {
    for (const t of TRICK_LIST) {
      for (const switchStance of [false, true]) {
        for (const l2 of ['none', 'nollie', 'fakie'] as const) {
          const id = variantId(t.id, { switchStance, nollie: l2 === 'nollie', fakie: l2 === 'fakie' });
          const back = parseVariantId(id);
          expect(back.baseId).toBe(t.id);
          expect(variantId(back.baseId, back)).toBe(id);
        }
      }
    }
    expect(() => parseVariantId('switch_unknown' as TrickVariantId)).toThrow();
  });

  it('names read BRANDS for marks and prefix variants', () => {
    expect(trickName('switch_kickflip')).toBe('Switch Kickflip');
    expect(trickName('switch_nollie_heelflip')).toBe('Switch Nollie Heelflip');
    expect(trickName('fakie_indy')).toBe('Fakie Indy');
    expect(trickName('gpu_slide')).toBe(BRANDS.specialSlideName);
    expect(trickName('gpu_slide')).toBe('VIDA Slide');
    expect(trickName('secret_laptop')).toBe(BRANDS.macguffins.secret_laptop.name);
  });
});
