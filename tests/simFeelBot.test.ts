// tests/simFeelBot.test.ts (sim track): founder playtest 2 (DESIGN L CR-65). A seeded bot plays like a
// careless human on the test box and all three parks with the shipped tuning (auto-push on): it steers at
// random, ollies with random charge, starts flips and grabs at random times in the air, holds grabs
// for random lengths and mashes Triangle. It must never bail on a wall or a landing angle, and it
// may bail only rarely overall (the flips it starts too late to finish).
import { afterEach, expect, it } from 'vitest';
import { resetTuning, TUNING } from '../src/core/tuning';
import { LAB_CAMPUS } from '../src/levels/labCampus';
import { MARKET_STREET } from '../src/levels/marketStreet';
import { TEST_BOX } from '../src/levels/testBox';
import { WOODSHED } from '../src/levels/woodshed';
import { built, Rig } from './fixtures/sim/rig';

type D = 'L' | 'R' | 'U' | 'D' | 'UL' | 'UR' | 'DL' | 'DR';
type Button = 'ollie' | 'flip' | 'grab' | 'grind';
const DIRS: readonly D[] = ['L', 'R', 'U', 'D', 'UL', 'UR', 'DL', 'DR'];

afterEach(() => resetTuning());

it('a careless human-like bot: no wall or landing-angle bails, under 1.5 bails per minute of play', () => {
  let seed = 11;
  const rand = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)] as T;
  const levels = [['testBox', built(TEST_BOX)], ['street', built(MARKET_STREET)], ['woodshed', built(WOODSHED)], ['campus', built(LAB_CAMPUS)]] as const;
  const reasons: string[] = [];
  let log = '';
  let ticksTotal = 0;
  let airs = 0;
  for (const [name, level] of levels) {
    for (let sess = 0; sess < 40; sess++) {
      TUNING.SIM_AUTO_PUSH = 1;
      const r = new Rig({ level });
      let steer: D | undefined;
      let steerUntil = 0;
      let chargeStart = -1;
      let chargeLen = 0;
      let airTicks = 0;
      let trick: { at: number; btn: 'flip' | 'grab'; dir: D; hold: number } | null = null;
      r.run(900, (s) => {
        const k = s.skater;
        const t = r.tick;
        if (t >= steerUntil) {
          steer = rand() < 0.5 ? undefined : pick(['L', 'R'] as const);
          steerUntil = t + 30 + Math.floor(rand() * 90);
        }
        const h: { buttons?: Button[]; dpad?: D } = {};
        if (steer) h.dpad = steer;
        if (k.state === 'Grounded' && chargeStart < 0 && rand() < 0.02) {
          chargeStart = t;
          chargeLen = 1 + Math.floor(rand() * 72);
        }
        if (chargeStart >= 0 && (k.state === 'Grounded' || k.state === 'Crouch')) {
          if (t - chargeStart < chargeLen) h.buttons = ['ollie'];
          else chargeStart = -1;
        }
        if (k.state === 'Air') {
          airTicks++;
          if (airTicks === 1) {
            airs++;
            trick = rand() < 0.6 ? { at: 2 + Math.floor(rand() * 40), btn: rand() < 0.5 ? 'flip' : 'grab', dir: pick(DIRS), hold: 10 + Math.floor(rand() * 40) } : null;
          }
          if (trick && airTicks >= trick.at && airTicks < trick.at + (trick.btn === 'grab' ? trick.hold : 1)) {
            h.buttons = [trick.btn];
            h.dpad = trick.dir;
          }
          if (rand() < 0.03) h.buttons = [...(h.buttons ?? []), 'grind'];
        } else {
          airTicks = 0;
          if (k.state !== 'Grounded') chargeStart = -1;
        }
        if (k.state === 'Grind' || k.state === 'Manual' || k.state === 'Lip') return r.holdBalance(s, h);
        return h;
      });
      ticksTotal += 900;
      for (const b of r.of('bail')) {
        reasons.push(b.reason);
        log += `${name} s${sess} t${b.tick} ${b.reason} ${b.speed.toFixed(1)} m/s at (${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)}, ${b.pos.z.toFixed(1)})\n`;
      }
    }
  }
  const minutes = ticksTotal / 120 / 60;
  const report = `${minutes.toFixed(1)} min, ${airs} airs, ${reasons.length} bails\n${log}`;
  expect(airs, report).toBeGreaterThan(300);
  expect(reasons.filter((x) => x === 'wall' || x === 'landing'), report).toEqual([]);
  expect(reasons.length / minutes, report).toBeLessThan(1.5);
}, 120_000);
