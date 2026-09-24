/**
 * tests/integrationDrive.test.ts (integration, polish round 2): the Woodshed drive "needs speed +
 * transfer" (SPEC §9.2). A plain spine air at any speed reaches its height but never collects it; the
 * same air with R2 over the spine (the transfer, REQ-VRT-08) does (MacGuffinDef.needs.transferInAir).
 */

import { describe, expect, it } from 'vitest';
import { WOODSHED } from '../src/levels/woodshed';
import { built, describeEvents, Rig, worldAvailable } from './fixtures/sim/rig';

function spineAir(speed: number, transfer: boolean): Rig {
  const r = new Rig({ level: built(WOODSHED), seed: 5, mode: 'career' });
  r.teleport({ x: 36, y: 0, z: 28 }, { x: 1, y: 0, z: 0 }, speed);
  let pressed = false;
  for (let i = 0; i < 300; i++) {
    const press = transfer && !pressed && r.snap.skater.state === 'Air';
    if (press) pressed = true;
    r.hold(1, press ? { buttons: ['revert'] } : {});
  }
  return r;
}

const drives = (r: Rig): number => r.of('pickup').filter((p) => p.kind === 'macguffin' && p.id === 'secret_drive').length;

describe.skipIf(!worldAvailable())('Woodshed drive gate (SPEC §9.2 "needs speed + transfer")', () => {
  it('a spine air with no input at 10 to 13 m/s never collects the Drive', () => {
    for (const v of [10, 11, 12, 13]) {
      const r = spineAir(v, false);
      expect(drives(r), `${v}: ${describeEvents(r.events)}`).toBe(0);
    }
  });

  it('the same air with R2 over the spine (a transfer) collects it at 11 m/s', () => {
    const r = spineAir(11, true);
    const log = describeEvents(r.events);
    expect(r.of('transfer').length, log).toBe(1);
    expect(drives(r), log).toBe(1);
  });
});
