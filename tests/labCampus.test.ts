// tests/labCampus.test.ts: Lab Campus (founder request 2026-09-23). The level validates clean, has its
// letters and ten goals, and the headline lines work on the real sim: the cable tray grinds far enough
// for its gap, and the east quarter-pipe air reaches the E.
import { afterEach, describe, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import { buildLevel } from '../src/levels/builder';
import { LAB_CAMPUS } from '../src/levels/labCampus';
import { validateLevel } from '../src/levels/validate';
import { Rig } from './fixtures/sim/rig';

afterEach(() => resetTuning());

const built = buildLevel(LAB_CAMPUS);

describe('Lab Campus data', () => {
  it('validates with zero violations', () => {
    expect(validateLevel(LAB_CAMPUS, built)).toEqual([]);
  });

  it('has C-O-D-E, ten goals with live thresholds, and a night environment', () => {
    expect(LAB_CAMPUS.letters.map((l) => l.letter)).toEqual(['C', 'O', 'D', 'E']);
    expect(LAB_CAMPUS.goals).toHaveLength(10);
    expect(LAB_CAMPUS.goals.map((g) => g.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const g of LAB_CAMPUS.goals) {
      const c = g.condition;
      if ('threshold' in c) expect(typeof TUNING[c.threshold], g.id).toBe('number');
      if (c.kind === 'gapInBankedCombo') expect(LAB_CAMPUS.gaps.some((gap) => gap.id === c.gapId), g.id).toBe(true);
    }
    expect(LAB_CAMPUS.environment).toBe('campusNight');
  });
});

describe('Lab Campus on the real sim', () => {
  it('the cable tray: an ollie onto it from the spawn side grinds 30 m and pays CABLE TRAY', () => {
    const r = new Rig({ level: built });
    r.teleport({ x: 22, y: 0, z: 74 }, { x: 1, y: 0, z: 0 }, 8);
    r.run(40, (s) => (s.skater.pos.x > 24 && s.skater.state === 'Grounded' ? { buttons: ['ollie'] } : {}), (s) => s.skater.state === 'Air');
    r.run(1500, (s) => (s.skater.state === 'Grind' ? r.holdBalance(s) : { buttons: ['grind'] }), (s) => r.of('comboBanked').length > 0 || s.skater.state === 'Bail');
    expect(r.of('bail')).toEqual([]);
    expect(r.of('grindStart').map((g) => g.railId)).toContain('LC-CT');
    expect(r.of('elementAdded').some((e) => e.element.id === 'gap:LC-G02'), JSON.stringify(r.of('grindEnd')) + JSON.stringify(r.of('grindStart').map((g) => [g.tick, g.railId]))).toBe(true);
  });

  it('the east quarter-pipe: a straight run at it reaches the E', () => {
    const r = new Rig({ level: built });
    r.teleport({ x: 80, y: 0, z: 48 }, { x: 1, y: 0, z: 0 }, 11);
    r.run(400, () => ({}), () => r.of('letter').length > 0 || r.of('bail').length > 0);
    expect(r.of('bail')).toEqual([]);
    expect(r.of('letter').map((l) => l.letter)).toContain('E');
  });
});
