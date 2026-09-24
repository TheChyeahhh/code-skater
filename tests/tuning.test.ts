// tests/tuning.test.ts (integration): the Locked numbers table in code (REQ-TIM-03, REQ-TIM-05,
// SPEC §6, §7, §15). Every numeric key has META, sits inside its range, and the spec values are exact.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEGRADATION_PRESETS, PIXEL_RATIO_CAPS, SHADOW_MAP_SIZES, TUNING, TUNING_DEFAULTS, TUNING_ENUM_META, TUNING_META,
  TUNING_SECTIONS, degradationTable, hitstopTicks, maxSpeed, resetTuning, statFactor, ticks, ticksS,
  type NumericTuningKey,
} from '../src/core/tuning';

afterEach(() => resetTuning());

const numericKeys = (Object.keys(TUNING) as (keyof typeof TUNING)[]).filter((k) => typeof TUNING[k] === 'number') as NumericTuningKey[];

describe('TUNING_META completeness', () => {
  it('every numeric key has META and every META key is a numeric TUNING key', () => {
    expect(numericKeys.length).toBeGreaterThan(200);
    for (const k of numericKeys) expect(TUNING_META[k], k).toBeDefined();
    for (const k of Object.keys(TUNING_META)) expect(typeof (TUNING as Record<string, unknown>)[k], k).toBe('number');
  });

  it('every value is inside [min, max], ranges are ordered, steps positive, REQ ids well formed', () => {
    for (const k of numericKeys) {
      const m = TUNING_META[k];
      expect(m.min, k).toBeLessThanOrEqual(m.max);
      expect(TUNING[k], k).toBeGreaterThanOrEqual(m.min);
      expect(TUNING[k], k).toBeLessThanOrEqual(m.max);
      expect(m.step, k).toBeGreaterThan(0);
      expect(m.reqId, k).toMatch(/^REQ-[A-Z]+-\d{2}$/);
      expect(m.label.length, k).toBeGreaterThan(2);
    }
  });

  it('no key is declared in two sections, and the sections cover exactly the numeric keys', () => {
    const seen = new Map<string, string>();
    for (const s of TUNING_SECTIONS) {
      for (const key of s.keys) {
        expect(seen.has(key), `${key} in ${s.name} and ${seen.get(key)}`).toBe(false);
        seen.set(key, s.name);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...numericKeys].sort());
  });

  it('has one tuning file per build track, each wired into TUNING as section track:<name>', async () => {
    const src = readFileSync(new URL('../src/core/tuning.ts', import.meta.url), 'utf8');
    for (const track of ['input', 'logic', 'levels', 'street', 'woodshed', 'sim', 'render', 'skater', 'fx', 'ui', 'audio', 'integration']) {
      const exportName = `${track.toUpperCase()}_TUNING`;
      const mod = (await import(`../src/core/tuning/${track}.ts`)) as Record<string, Record<string, readonly unknown[]>>;
      const spec = mod[exportName];
      expect(spec, `src/core/tuning/${track}.ts exports ${exportName}`).toBeDefined();
      expect(src, track).toContain(`import { ${exportName} } from './tuning/${track}.ts';`);
      const sec = TUNING_SECTIONS.find((s) => s.name === `track:${track}`);
      expect(sec, track).toBeDefined();
      // Every key the track file declares reaches TUNING with its META in the track's group.
      expect([...(sec?.keys ?? [])].sort(), track).toEqual(Object.keys(spec ?? {}).sort());
      for (const key of Object.keys(spec ?? {})) {
        expect((TUNING_META as Record<string, { group: string }>)[key]?.group, key).toBe(`track:${track}`);
      }
    }
  });
});

describe('SPEC §7 timing windows (value and range exact)', () => {
  const cases: [NumericTuningKey, number, number, number][] = [
    ['COYOTE_MS', 90, 70, 120],
    ['GRIND_MAGNET_RADIUS_M', 0.55, 0.4, 0.8],
    ['GRIND_ENTRY_MAX_DEG', 55, 45, 70],
    ['GRIND_PREBUFFER_MS', 200, 120, 300],
    ['REVERT_PRE_MS', 150, 100, 200],
    ['REVERT_POST_MS', 180, 140, 220],
    ['REVERT_TO_MANUAL_MS', 200, 160, 260],
    ['MANUAL_LAND_WINDOW_MS', 140, 100, 180],
    // Founder playtest 2026-09-23 (DESIGN L CR-43): 28 (22 to 35) -> 50 (22 to 60).
    ['LAND_OFFAXIS_BAIL_DEG', 60, 22, 75], // founder playtest 2 (CR-65): 50 -> 60
    ['GETUP_LOCKOUT_S', 0.85, 0.6, 1.1],
    ['SPECIAL_SEQ_MS', 250, 200, 350],
  ];
  it.each(cases)('%s = %s (%s to %s)', (key, value, min, max) => {
    expect(TUNING[key]).toBe(value);
    expect(TUNING_META[key].min).toBe(min);
    expect(TUNING_META[key].max).toBe(max);
  });

  it('simulates at a fixed 120 Hz', () => {
    expect(TUNING.SIM_HZ).toBe(120);
    expect(TUNING_META.SIM_HZ.min).toBe(120);
    expect(TUNING_META.SIM_HZ.max).toBe(120);
  });
});

describe('SPEC §15 defaults and SPEC §6 locked values', () => {
  it('skater, speed, gravity, ollie, run defaults', () => {
    expect([TUNING.STAT_SPEED, TUNING.STAT_AIR, TUNING.STAT_BALANCE, TUNING.STAT_SPIN]).toEqual([6, 6, 6, 6]);
    expect(TUNING.STAT_SWITCH).toBe(4);
    expect(TUNING.SWITCH_POP_PENALTY).toBe(0.15);
    // Founder playtest 2026-09-23 (DESIGN L CR-44): push cutoff 0.7 -> 0.85, max speed 11 -> 13,
    // ollie 0.9 / 1.6 -> 1.2 / 2.0 m. Founder playtest 2 (CR-65): cutoff 1.0 (auto-push to full speed),
    // max speed 15 (then 13.5 and 12, founder 2026-09-23: too fast), gravity 20, full ollie 2.5 m.
    expect(TUNING.PUSH_CUTOFF).toBe(1.0);
    expect(TUNING.MAX_SPEED_MPS).toBe(12);
    expect(TUNING.GLOW_SPEED_BONUS).toBe(0.08);
    expect(TUNING.GRAVITY).toBe(20);
    expect(TUNING.OLLIE_H_TAP_M).toBe(1.2);
    expect(TUNING.OLLIE_H_FULL_M).toBe(2.5);
    expect(TUNING.RUN_LENGTH_S).toBe(120);
    expect(statFactor(6)).toBeCloseTo(1, 12);
    expect(maxSpeed(false)).toBeCloseTo(12, 12);
    expect(maxSpeed(true)).toBeCloseTo(12.96, 12);
  });

  it('scoring, special and balance numbers', () => {
    expect(TUNING.STANCE_SWITCH_MULT).toBe(1.2);
    expect(TUNING.SPIN_MULT_PER_180).toBe(0.5);
    expect(TUNING.SPIN_MODE).toBe('multiplier');
    expect(TUNING_ENUM_META.SPIN_MODE.options).toEqual(['multiplier', 'base']);
    expect(TUNING.SICK_THRESHOLD).toBe(10000);
    expect(TUNING.INSANE_THRESHOLD).toBe(50000);
    expect(TUNING.SPECIAL_FULL_BASE).toBe(3000); // founder 2026-09-23: easier to fill (6000 -> 4500 -> 3000)
    expect(TUNING.SPECIAL_IDLE_DELAY_S).toBe(4); // founder 2026-09-23 (3 -> 4)
    expect(TUNING.SPECIAL_DRAIN_PER_S).toBe(0.03); // founder 2026-09-23 (0.04 -> 0.03)
    expect(TUNING.BAL_ELEMENT_GAIN).toBe(0.12);
    expect(TUNING.BAL_SAME_OBJECT_MULT).toBe(1.6);
    expect(TUNING.BAL_RECENTER).toBe(0.35);
    expect(TUNING.MACGUFFIN_BASE).toBe(2500);
    expect([TUNING.BASE_GRAB, TUNING.HOLD_GRAB, TUNING.BASE_FIFTY_FIFTY, TUNING.HOLD_FIFTY_FIFTY]).toEqual([150, 100, 100, 80]);
    expect([TUNING.HOLD_GRIND_DIRECTIONAL, TUNING.BASE_MANUAL, TUNING.HOLD_MANUAL]).toEqual([90, 50, 40]);
    expect([TUNING.BASE_LIP, TUNING.HOLD_LIP, TUNING.BASE_REVERT, TUNING.HOLD_SPECIAL]).toEqual([150, 100, 100, 150]);
  });

  it('degradation presets (CR-07) are chosen by DEGRADATION_PRESET', () => {
    expect(DEGRADATION_PRESETS.classic).toEqual([1, 0.9, 0.75, 0.5, 0.25]);
    expect(DEGRADATION_PRESETS.steep).toEqual([1, 0.75, 0.5, 0.25, 0.1]);
    expect(TUNING.DEGRADATION_PRESET).toBe('classic');
    expect(degradationTable()).toBe(DEGRADATION_PRESETS.classic);
    TUNING.DEGRADATION_PRESET = 'steep';
    expect(degradationTable()).toBe(DEGRADATION_PRESETS.steep);
    // The shipped dev panel shows these option labels: neutral words, never a trademark abbreviation.
    for (const o of TUNING_ENUM_META.DEGRADATION_PRESET.options) expect(o).toMatch(/^(classic|steep)$/);
    expect(Object.keys(TUNING_ENUM_META)).not.toContain('DEFAULT_STANCE');
  });

  it('quality tables (REQ-REN-05)', () => {
    expect(PIXEL_RATIO_CAPS).toEqual([1.0, 1.25, 1.5, 2.0]);
    expect(SHADOW_MAP_SIZES).toEqual([1024, 2048, 2048, 4096]);
  });
});

describe('REQ-TIM-03 / REQ-TIM-05 window lengths in ticks', () => {
  it('ticks(ms) = ceil(ms x 120 / 1000 - 1e-9)', () => {
    expect(ticks(200)).toBe(24);
    expect(ticks(150)).toBe(18);
    expect(ticks(100)).toBe(12);
  });

  const windows: [string, number, number][] = [
    ['coyote', TUNING.COYOTE_MS, 11],
    ['grind pre-buffer', TUNING.GRIND_PREBUFFER_MS, 24],
    ['revert pre', TUNING.REVERT_PRE_MS, 18],
    ['revert post', TUNING.REVERT_POST_MS, 22],
    ['revert to manual', TUNING.REVERT_TO_MANUAL_MS, 24],
    ['manual land window', TUNING.MANUAL_LAND_WINDOW_MS, 17],
    ['special sequence', TUNING.SPECIAL_SEQ_MS, 30],
    ['special button', TUNING.SPECIAL_BUTTON_MS, 30],
    ['double tap', TUNING.DOUBLE_TAP_MS, 30],
    ['manual pair gap', TUNING.MANUAL_SEQ_MS, 30],
    ['grind switch cooldown', TUNING.GRIND_SWITCH_COOLDOWN_MS, 12],
    ['land yaw snap', TUNING.LAND_YAW_SNAP_MS, 12],
    ['grind snap blend', TUNING.GRIND_SNAP_BLEND_MS, 10],
    ['grab release before land', TUNING.GRAB_RELEASE_BEFORE_LAND_MS, 8],
    ['lip min hold', TUNING.LIP_MIN_HOLD_MS, 18],
    ['manual swap cooldown', TUNING.MANUAL_SWAP_COOLDOWN_MS, 72],
  ];
  it.each(windows)('%s: %s ms = %s ticks', (_name, ms, expected) => {
    expect(ticks(ms)).toBe(expected);
  });

  it('second-based windows and the hitstop floor', () => {
    expect(ticksS(TUNING.BAIL_TUMBLE_S)).toBe(72);
    expect(ticksS(TUNING.GETUP_LOCKOUT_S)).toBe(102);
    expect(hitstopTicks()).toBe(7);
  });
});

describe('live tuning', () => {
  it('helpers read TUNING at call time and resetTuning restores the defaults', () => {
    TUNING.COYOTE_MS = 100;
    expect(ticks(TUNING.COYOTE_MS)).toBe(12);
    TUNING.STAT_SPEED = 10;
    expect(maxSpeed(false)).toBeCloseTo(12 * 1.2, 12);
    resetTuning();
    expect(TUNING.COYOTE_MS).toBe(TUNING_DEFAULTS.COYOTE_MS);
    expect(TUNING.STAT_SPEED).toBe(6);
  });
});
