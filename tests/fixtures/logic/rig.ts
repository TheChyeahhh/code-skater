/**
 * tests/fixtures/logic/rig.ts (logic track): hand-built facts and a tiny logic-only "world" that
 * applies TransitionResults to Scoring and the special meter the way ARCHITECTURE.md section 2
 * says the sim world will (combo effect -> scoring, revertPivot -> stance, closed elements -> meter).
 * No physics: the tests say which events happen.
 */

import type { Stance, SurfaceFlags } from '../../../src/core/types';
import { getTrick } from '../../../src/data/tricks';
import { Scoring } from '../../../src/sim/scoring';
import { createSpecial, emptySpecial, feedSpecial } from '../../../src/sim/special';
import { initialMachine, timerEvent, transition } from '../../../src/sim/stateMachine';
import type {
  ElementRef, ElementSpec, LandingFacts, MachineState, SmEvent, SmFacts, SpecialState, TransitionResult,
} from '../../../src/sim/types';

export const FLAT: SurfaceFlags = {
  slopeDeg: 0, tag: 'solid', flat: true, bank: false, transition: false, nearVertical: false, vertLanding: false, wall: false,
};
/** A quarter-pipe face at 50 deg: transition, not flat, a vert landing. */
export const QP_FACE: SurfaceFlags = {
  slopeDeg: 50, tag: 'transition', flat: false, bank: false, transition: true, nearVertical: false, vertLanding: true, wall: false,
};
/** The flat bottom of a bowl: transition AND flat. */
export const BOWL_FLOOR: SurfaceFlags = { ...FLAT, tag: 'transition', transition: true };

export function facts(p: Partial<SmFacts> = {}): SmFacts {
  return {
    tick: 0, speed: 5, surface: FLAT, movingUp: false, animsDone: true, crossHeld: false, triangleHeld: false,
    comboAlive: false, clockZero: false, ...p,
  };
}

export function landing(p: Partial<LandingFacts> = {}): LandingFacts {
  return {
    vert: false, flat: true, slopeDeg: 0, offAxisDeg: 0, tiltDeg: 0, animsDone: true, crossHeld: false,
    manualPair: null, revertBuffered: false, ...p,
  };
}

export function machine(state: MachineState['state'], p: Partial<MachineState> = {}): MachineState {
  return { ...initialMachine(0), state, ...p };
}

export const VERT_LANDING = (p: Partial<LandingFacts> = {}): LandingFacts =>
  landing({ vert: true, flat: false, slopeDeg: 50, ...p });

function holdableRef(ref: ElementRef): boolean {
  if (ref.kind === 'gap') return false;
  const t = getTrick(ref.trickId);
  return t.holdable === true || t.category === 'grind' || t.category === 'manual' || t.category === 'lip';
}

/** Logic-only run: machine + scoring + special meter + stance, stepped by explicit events. */
export class LogicRig {
  m: MachineState;
  readonly scoring: Scoring;
  special: SpecialState = createSpecial();
  stance: Stance = 'regular';
  tick = 0;
  readonly rows: (string | null)[] = [];
  readonly banks: number[] = [];

  constructor(history: Readonly<Record<string, number>> = {}, state: MachineState['state'] = 'Grounded') {
    this.scoring = new Scoring(history);
    this.m = machine(state);
  }

  facts(p: Partial<SmFacts> = {}): SmFacts {
    return facts({ tick: this.tick, comboAlive: this.scoring.combo !== null, ...p });
  }

  /** Advance n ticks, accruing hold time and firing any state timer (REQ-TIM-03). */
  wait(n: number, p: Partial<SmFacts> = {}): void {
    for (let i = 0; i < n; i++) {
      this.tick += 1;
      this.scoring.accrue(1 / 120);
      const t = timerEvent(this.m, this.tick, this.facts(p));
      if (t) this.send(t, p);
    }
  }

  send(e: SmEvent, p: Partial<SmFacts> = {}): TransitionResult {
    const r = transition(this.m, e, this.facts(p));
    this.rows.push(r.row);
    this.m = r.next;
    this.applyCombo(r);
    for (const fx of r.effects) {
      if (fx.kind === 'revertPivot') this.stance = this.stance === 'regular' ? 'switch' : 'regular';
      // Leaving a linker ends its hold: the world closes the open element there (REQ-GRD-13, REQ-SCR-04).
      if (fx.kind === 'balanceStop') this.scoring.closeOpen();
    }
    this.feed();
    return r;
  }

  /** Air tricks, gaps, pickups: added by the world directly, not by a row (ARCHITECTURE decision 11). */
  add(ref: ElementRef, extra: Partial<ElementSpec> = {}): void {
    this.scoring.addElement({ ref, stance: this.stance, holdable: holdableRef(ref), ...extra }, this.tick);
    this.feed();
  }

  private spec(ref: ElementRef): ElementSpec {
    return { ref, stance: this.stance, holdable: holdableRef(ref) };
  }

  private applyCombo(r: TransitionResult): void {
    switch (r.combo) {
      case 'start':
        this.scoring.startCombo(this.tick);
        break;
      case 'startAdd':
      case 'liveAdd':
        if (r.element) this.scoring.addElement(this.spec(r.element), this.tick);
        break;
      case 'bank':
        this.banks.push(this.scoring.bank(this.tick, 0).final);
        break;
      case 'bankStartAdd':
        this.banks.push(this.scoring.bank(this.tick, 0).final);
        if (r.element) this.scoring.addElement(this.spec(r.element), this.tick);
        break;
      case 'lose':
        this.scoring.lose(this.tick);
        this.special = emptySpecial(this.special).state;
        break;
      default:
        break;
    }
  }

  private feed(): void {
    for (const el of this.scoring.takeClosed()) this.special = feedSpecial(this.special, el.value + el.accrual).state;
  }
}
