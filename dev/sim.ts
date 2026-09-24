/**
 * dev/sim.ts (sim track harness, port 5306): the REAL world, no renderer. Every tick runs the input
 * track's frame builder and parser, the logic state machine / scoring / balance / special, the
 * levels builder's collider and rails, and the sim controller, rails, gaps and run. Drawn top-down
 * with Canvas2D so the path of a line can be checked by eye.
 *
 *   ?level=testBox|marketStreet|woodshed   level (default testBox)
 *   ?scenario=m4|vert|spine|lip|rail|bus   scripted line, simulated at load (default: m4 on the test
 *                                          box, spine on Woodshed, bus on Market Street)
 *   ?play                                  live: keyboard / pad through the input track's InputSystem
 *                                          at 120 Hz (Space ollie, J flip, K grab, L grind, Shift
 *                                          revert, Q / E spin, WASD / arrows); R resets to spawn
 *   ?view=x0,z0,x1,z1                      map window in metres (default: the scenario's box)
 *
 * Map: collider triangles shaded by height (transitions tinted blue, boundary walls skipped), rails
 * by kind (rail yellow, ledge orange, coping cyan), the skater trail coloured by state with a dot and
 * label at every state change; the strip at the bottom is the feet height over time in the same
 * colours. The panel lists the state, the combo line, the banked combos and the event log.
 * Sets window.__shotReady once the scenario is drawn (or after 10 live frames).
 */

import { FixedLoop } from '../src/core/loop';
import type { DirOrNeutral, LevelId, SimSnapshot, SkaterStateName, Vec3 } from '../src/core/types';
import type { SimEvent } from '../src/core/events';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { createInputSystem } from '../src/input/system';
import { buildLevel } from '../src/levels/builder';
import { LEVEL_IDS, loadLevelDef } from '../src/levels/registry';
import { SURFACE_TAG_CODES, type BuiltLevel } from '../src/levels/types';
import { createDebugDriver, type SimDebugDriver } from '../src/sim/debug';
import { createWorld } from '../src/sim/world';
import type { SkaterWorld } from '../src/sim/types';
import { mountPanel, noteFallback, tryBuild } from './shared/harness';

const params = new URLSearchParams(window.location.search);
const requested = params.get('level') ?? 'testBox';
const levelId: LevelId = (LEVEL_IDS as readonly string[]).includes(requested) ? (requested as LevelId) : 'testBox';
const live = params.has('play');

const STATE_COLORS: Readonly<Record<SkaterStateName, string>> = {
  Grounded: '#9aa3b5', Crouch: '#c8cdd8', Air: '#ffffff', Grind: '#ffd23f', Lip: '#3fd7ff', Manual: '#4be07a',
  RevertWindow: '#ff5fd2', LandWindow: '#a8f0c0', Bail: '#ff4040', GetUp: '#ff9a9a', RunEnd: '#666c7a',
};
const RAIL_COLORS = { rail: '#ffd23f', ledge: '#ff8c42', coping: '#3fd7ff' } as const;

// ---------------------------------------------------------------------------------------------
// Scenarios: the same scripted lines the sim suites assert (tests/simWorld, simLip, simParks)
// ---------------------------------------------------------------------------------------------

interface Held {
  readonly buttons?: readonly ('ollie' | 'flip' | 'grab' | 'grind' | 'revert' | 'spinL' | 'spinR')[];
  readonly dpad?: DirOrNeutral;
}

interface Scenario {
  readonly label: string;
  readonly start: { readonly pos: Vec3; readonly dir: Vec3; readonly speed: number };
  readonly maxTicks: number;
  /** Map window x0, z0, x1, z1. */
  readonly view: readonly [number, number, number, number];
  readonly step: (s: SimSnapshot, tick: number, ctx: ScriptCtx) => Held;
  readonly done: (s: SimSnapshot, ctx: ScriptCtx) => boolean;
}

interface ScriptCtx {
  phase: number;
  latch: boolean;
  seenManual: string | null;
  banks: number;
}

/** Grind / lip bang-bang; manual pushes that never type a swap pair (tests/fixtures/sim/rig.ts). */
function holdBalance(s: SimSnapshot, ctx: ScriptCtx, extra: Held = {}): Held {
  const b = s.balance;
  if (!b) return extra;
  if (b.axis === 'h') return { ...extra, dpad: b.needle > 0 ? 'L' : 'R' };
  const type = String(s.skater.poseVariant);
  if (type !== ctx.seenManual) {
    ctx.seenManual = type;
    ctx.latch = false;
  }
  const nose = type.includes('nose');
  const side = nose ? 1 : -1;
  if (!ctx.latch) {
    if (b.needle * side > 0.1) ctx.latch = true;
    else return { ...extra, dpad: nose ? 'D' : 'U' };
  }
  return b.needle * side > 0.3 ? { ...extra, dpad: nose ? 'U' : 'D' } : extra;
}

/** Manual heading south: balance, and tap Cross once past z (then land and bank). */
function popOut(s: SimSnapshot, c: ScriptCtx, z: number): Held {
  if (s.skater.pos.z > z && c.phase < 9) {
    c.phase = 9;
    return holdBalance(s, c, { buttons: ['ollie'] });
  }
  return holdBalance(s, c);
}

const N = { x: 0, y: 0, z: -1 };
const E = { x: 1, y: 0, z: 0 };

const SCENARIOS: Readonly<Record<string, Scenario>> = {
  m4: {
    label: 'M4 line: ledge ground snap -> manual -> ollie into the mini -> revert -> switch manual -> bank',
    start: { pos: { x: 46.3, y: 0, z: 40 }, dir: N, speed: 6.5 },
    maxTicks: 1600,
    view: [36, 1, 58, 42],
    step: (s, _t, c) => {
      const st = s.skater.state;
      const z = s.skater.pos.z;
      switch (c.phase) {
        case 0:
          if (st === 'Grind') c.phase = 1;
          return z < 34.4 ? { buttons: ['grind'] } : {};
        case 1:
          if (st === 'Grind') return holdBalance(s, c);
          if (st === 'Manual') {
            c.phase = 2;
            return holdBalance(s, c);
          }
          return s.skater.stateTicks < 10 ? {} : s.skater.stateTicks < 16 ? { dpad: 'U' } : { dpad: 'D' };
        case 2:
          if (st !== 'Manual') {
            c.phase = 3;
            return {};
          }
          return z < 11 && z > 7 ? holdBalance(s, c, { buttons: ['ollie'] }) : holdBalance(s, c);
        case 3:
          if (st === 'Air') return s.skater.vel.y < -0.5 && s.tick % 10 < 5 ? { buttons: ['revert'] } : {};
          if (st === 'RevertWindow') return s.skater.stateTicks < 4 ? { dpad: 'U' } : { dpad: 'D' };
          if (st === 'Manual') {
            c.phase = 4;
            return holdBalance(s, c);
          }
          return {};
        case 4: // switch manual down the face and onto the flat: tap Cross to ollie out
          if (st === 'Manual' && z > 9) {
            c.phase = 5;
            return holdBalance(s, c, { buttons: ['ollie'] });
          }
          return st === 'Manual' ? holdBalance(s, c) : {};
        default:
          return {};
      }
    },
    done: (s, c) => c.phase >= 4 && s.skater.state === 'Grounded',
  },
  vert: {
    label: 'Vert revert: TB-VERT at 11 m/s, R2 spammed on the way down, Up,Down in the window',
    start: { pos: { x: 32, y: 0, z: 12 }, dir: N, speed: 11 },
    maxTicks: 900,
    view: [22, 1, 42, 22],
    step: (s, _t, c) => {
      if (s.skater.state === 'Air' && s.skater.vel.y < 0) return s.tick % 12 < 3 ? { buttons: ['revert'] } : {};
      if (s.skater.state === 'RevertWindow') return s.skater.stateTicks < 4 ? { dpad: 'U' } : { dpad: 'D' };
      if (s.skater.state === 'Manual') return popOut(s, c, 16);
      return {};
    },
    done: (s, c) => s.skater.state === 'Grounded' && c.banks > 0,
  },
  spine: {
    label: 'Spine transfer: up the west face, R2 in the air, land on the far face (gap SPINE TRANSFER)',
    start: levelId === 'woodshed' ? { pos: { x: 34, y: 0, z: 20 }, dir: E, speed: 11 } : { pos: { x: 8, y: 0, z: 16 }, dir: E, speed: 9 },
    maxTicks: 900,
    view: levelId === 'woodshed' ? [30, 8, 56, 32] : [4, 8, 24, 24],
    step: (s) => (s.skater.state === 'Air' && s.skater.stateTicks > 20 && s.skater.stateTicks < 23 ? { buttons: ['revert'] } : {}),
    done: (s, c) => s.skater.state === 'Grounded' && c.banks > 0,
  },
  lip: {
    label: 'Lip: Axle Stall on the vert coping, drop back in, R2, Up,Down (lip -> revert -> manual)',
    start: { pos: { x: 32, y: 0, z: 12 }, dir: N, speed: 9.5 },
    maxTicks: 900,
    view: [22, 1, 42, 22],
    step: (s, _t, c) => {
      const st = s.skater.state;
      if (c.phase === 0) {
        if (st === 'Lip') c.phase = 1;
        return st === 'Air' && s.skater.vel.y < 2.5 ? { buttons: ['grind'] } : {};
      }
      if (st === 'Lip') return s.skater.stateTicks < 40 ? holdBalance(s, c, { buttons: ['grind'] }) : {};
      if (st === 'Air') return s.skater.pos.y < 3 ? { buttons: ['revert'] } : {};
      if (st === 'RevertWindow') return s.skater.stateTicks < 4 ? { dpad: 'U' } : { dpad: 'D' };
      if (st === 'Manual') return popOut(s, c, 16);
      return {};
    },
    done: (s, c) => s.skater.state === 'Grounded' && c.banks > 0,
  },
  rail: {
    label: 'Rail: full ollie onto TB-RAIL, 50-50, DR + Triangle Smith, rail end, land, bank',
    start: { pos: { x: 40, y: 0, z: 48.5 }, dir: N, speed: 7 },
    maxTicks: 900,
    view: [30, 14, 50, 50],
    step: (s, t, c) => {
      if (t < 74) return { buttons: ['ollie'] };
      if (t >= 140 && t < 143) return { buttons: ['grind'] };
      if (s.skater.state === 'Grind') return s.skater.stateTicks === 60 ? { buttons: ['grind'], dpad: 'DR' } : holdBalance(s, c);
      return {};
    },
    done: (s, c) => s.skater.state === 'Grounded' && c.banks > 0,
  },
  bus: {
    label: 'Market Street: snap the Bus Stop Bar, grind it out (gap BUS STOP BAR), land, bank',
    start: { pos: { x: 60.4, y: 1.0, z: 85.7 }, dir: E, speed: 7 },
    maxTicks: 900,
    view: [52, 76, 92, 96],
    step: (s, t, c) => (t === 0 ? { buttons: ['grind'] } : s.skater.state === 'Grind' ? holdBalance(s, c) : {}),
    done: (s, c) => s.skater.state === 'Grounded' && c.banks > 0,
  },
};

const defaultScenario = levelId === 'woodshed' ? 'spine' : levelId === 'marketStreet' ? 'bus' : 'm4';
const scenarioId = params.get('scenario') ?? defaultScenario;
const scenario = SCENARIOS[scenarioId] ?? (SCENARIOS[defaultScenario] as Scenario);

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

const canvas = document.createElement('canvas');
canvas.className = 'harness-canvas';
document.body.prepend(canvas);
const g = canvas.getContext('2d') as CanvasRenderingContext2D;

const panel = mountPanel('Sim harness', [
  `Sim track, port 5306. Level ${levelId}. ${live ? 'Live input (R resets).' : `Scenario "${scenarioId}": ${scenario.label}`}`,
]);
panel.root.style.maxWidth = '430px';

interface Sample {
  readonly pos: Vec3;
  readonly state: SkaterStateName;
  readonly tick: number;
}

const trail: Sample[] = [];
const marks: { pos: Vec3; text: string; color: string }[] = [];
const log: string[] = [];

function describe(e: SimEvent): string | null {
  switch (e.type) {
    case 'stateChanged':
      return `${e.to} (row ${e.row})`;
    case 'elementAdded':
      return `+ ${e.element.name} ${Math.round(e.element.value)}`;
    case 'comboBanked':
      return `BANK ${e.final} = ${e.base} x ${e.multiplier}`;
    case 'comboLost':
      return `LOST (${e.reason})`;
    case 'gap':
      return `GAP ${e.name} +${e.base}`;
    case 'land':
      return `land ${e.vert ? 'vert' : 'flat'} off ${e.offAxisDeg.toFixed(1)} deg ${e.linker}`;
    case 'transfer':
      return `transfer ${e.railId}`;
    case 'revert':
      return `revert -> ${e.stance}`;
    case 'bail':
      return `bail (${e.reason})`;
    default:
      return null;
  }
}

function record(s: SimSnapshot, events: readonly SimEvent[]): void {
  trail.push({ pos: s.skater.pos, state: s.skater.state, tick: s.tick });
  for (const e of events) {
    const text = describe(e);
    if (text) log.push(`t${e.tick} ${text}`);
    if (e.type === 'stateChanged') marks.push({ pos: s.skater.pos, text: e.to, color: STATE_COLORS[e.to] });
  }
}

function view(level: BuiltLevel): readonly [number, number, number, number] {
  const q = params.get('view')?.split(',').map(Number);
  if (q && q.length === 4 && q.every((v) => Number.isFinite(v))) return q as unknown as [number, number, number, number];
  if (live) return [0, 0, level.def.size.x, level.def.size.z];
  return scenario.view;
}

function draw(level: BuiltLevel, snap: SimSnapshot): void {
  const w = (canvas.width = window.innerWidth);
  const h = (canvas.height = window.innerHeight);
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, w, h);
  const [x0, z0, x1, z1] = view(level);
  const strip = 150;
  // The map sits right of the panel, above the height strip, centred in that box.
  const boxL = Math.min(470, w * 0.34);
  const boxR = w - 20;
  const boxT = 20;
  const boxB = h - strip - 30;
  const scale = Math.min((boxR - boxL) / (x1 - x0), (boxB - boxT) / (z1 - z0));
  const ox = boxL + ((boxR - boxL) - (x1 - x0) * scale) / 2;
  const oz = boxT + ((boxB - boxT) - (z1 - z0) * scale) / 2;
  const px = (x: number): number => ox + (x - x0) * scale;
  const pz = (z: number): number => oz + (z - z0) * scale;
  g.save();
  g.beginPath();
  g.rect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
  g.clip();
  g.fillStyle = '#1a1e28';
  g.fillRect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);

  // Collider, painter's order by height so decks sit over their faces.
  const c = level.collider;
  const tris: { y: number; i: number }[] = [];
  for (let t = 0; t < c.triangleCount; t++) {
    if (c.triTag[t] === SURFACE_TAG_CODES.boundary) continue;
    const o = t * 9;
    const y = ((c.positions[o + 1] as number) + (c.positions[o + 4] as number) + (c.positions[o + 7] as number)) / 3;
    tris.push({ y, i: t });
  }
  tris.sort((a, b) => a.y - b.y);
  for (const { y, i } of tris) {
    const o = i * 9;
    const light = Math.max(0, Math.min(1, (y + 2) / 8));
    const transition = c.triTag[i] === SURFACE_TAG_CODES.transition;
    const v = Math.round(40 + 120 * light);
    g.fillStyle = transition ? `rgb(${v * 0.6}, ${v * 0.8}, ${Math.min(255, v + 60)})` : `rgb(${v}, ${v}, ${v * 0.95})`;
    g.beginPath();
    g.moveTo(px(c.positions[o] as number), pz(c.positions[o + 2] as number));
    g.lineTo(px(c.positions[o + 3] as number), pz(c.positions[o + 5] as number));
    g.lineTo(px(c.positions[o + 6] as number), pz(c.positions[o + 8] as number));
    g.closePath();
    g.fill();
  }
  for (const r of level.rails) {
    g.strokeStyle = RAIL_COLORS[r.kind];
    g.lineWidth = 6;
    g.globalAlpha = 0.8;
    g.beginPath();
    r.points.forEach((p, k) => (k === 0 ? g.moveTo(px(p.x), pz(p.z)) : g.lineTo(px(p.x), pz(p.z))));
    g.stroke();
    g.globalAlpha = 1;
  }

  // Trail by state.
  g.lineWidth = 2.5;
  for (let k = 1; k < trail.length; k++) {
    const a = trail[k - 1] as Sample;
    const b = trail[k] as Sample;
    g.strokeStyle = STATE_COLORS[b.state];
    g.beginPath();
    g.moveTo(px(a.pos.x), pz(a.pos.z));
    g.lineTo(px(b.pos.x), pz(b.pos.z));
    g.stroke();
  }
  g.font = '12px system-ui, sans-serif';
  const labelled: { x: number; y: number }[] = [];
  marks.forEach((m, k) => {
    const x = px(m.pos.x);
    const y = pz(m.pos.z);
    g.fillStyle = m.color;
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
    // Alternate sides, then step away from earlier labels.
    const right = k % 2 === 0;
    const text = `${k + 1}. ${m.text}`;
    const tw = g.measureText(text).width;
    const lx = right ? x + 8 : x - 8 - tw;
    let ly = y + 4;
    while (labelled.some((l) => Math.abs(l.x - lx) < tw + 4 && Math.abs(l.y - ly) < 14)) ly -= 14;
    labelled.push({ x: lx, y: ly });
    g.fillStyle = 'rgba(11, 13, 18, 0.7)';
    g.fillRect(lx - 2, ly - 11, tw + 4, 14);
    g.fillStyle = m.color;
    g.fillText(text, lx, ly);
  });
  // The skater now: an arrow along its heading.
  const sp = snap.skater.pos;
  const f = snap.skater.forward;
  const ar = Math.max(0.9, 14 / scale);
  g.fillStyle = STATE_COLORS[snap.skater.state];
  g.beginPath();
  g.moveTo(px(sp.x + f.x * ar), pz(sp.z + f.z * ar));
  g.lineTo(px(sp.x - f.z * ar * 0.4 - f.x * ar * 0.45), pz(sp.z + f.x * ar * 0.4 - f.z * ar * 0.45));
  g.lineTo(px(sp.x + f.z * ar * 0.4 - f.x * ar * 0.45), pz(sp.z - f.x * ar * 0.4 - f.z * ar * 0.45));
  g.closePath();
  g.fill();
  g.strokeStyle = '#0b0d12';
  g.lineWidth = 1;
  g.stroke();
  g.restore();
  g.strokeStyle = '#46506a';
  g.strokeRect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);
  g.fillStyle = '#9aa3b5';
  g.fillText(`x ${x0}..${x1} m, z ${z0}..${z1} m (north up)`, px(x0), pz(z1) + 14);
  // Legend.
  let lx = px(x0) + 230;
  for (const st of ['Grounded', 'Air', 'Grind', 'Manual', 'Lip', 'RevertWindow', 'LandWindow', 'Bail'] as const) {
    g.fillStyle = STATE_COLORS[st];
    g.fillRect(lx, pz(z1) + 5, 10, 10);
    g.fillText(st, lx + 13, pz(z1) + 14);
    lx += g.measureText(st).width + 26;
  }

  // Height strip.
  const sy = h - strip - 10;
  g.fillStyle = '#141824';
  g.fillRect(20, sy, w - 40, strip);
  g.fillStyle = '#9aa3b5';
  g.fillText('feet height over time (state colours); grid lines every metre', 28, sy + 14);
  if (trail.length > 1) {
    const t0 = (trail[0] as Sample).tick;
    const t1 = (trail[trail.length - 1] as Sample).tick;
    const ys = trail.map((s) => s.pos.y);
    const lo = Math.min(0, ...ys);
    const hi = Math.max(1, ...ys);
    const tx = (t: number): number => 28 + ((t - t0) / Math.max(1, t1 - t0)) * (w - 56);
    const ty = (y: number): number => sy + strip - 10 - ((y - lo) / (hi - lo)) * (strip - 30);
    g.strokeStyle = '#262c3c';
    for (let m = Math.ceil(lo); m <= hi; m++) {
      g.beginPath();
      g.moveTo(28, ty(m));
      g.lineTo(w - 28, ty(m));
      g.stroke();
    }
    g.lineWidth = 2;
    for (let k = 1; k < trail.length; k++) {
      const a = trail[k - 1] as Sample;
      const b = trail[k] as Sample;
      g.strokeStyle = STATE_COLORS[b.state];
      g.beginPath();
      g.moveTo(tx(a.tick), ty(a.pos.y));
      g.lineTo(tx(b.tick), ty(b.pos.y));
      g.stroke();
    }
  }

  const combo = snap.combo;
  panel.setStatus([
    `tick ${snap.tick}  state ${snap.skater.state}  stance ${snap.skater.stance}${snap.skater.fakie ? ' fakie' : ''}`,
    `speed ${snap.skater.speed.toFixed(2)} m/s  pos ${sp.x.toFixed(2)}, ${sp.y.toFixed(2)}, ${sp.z.toFixed(2)}`,
    combo ? `combo ${combo.names.join(' + ')}  ${combo.base} x ${combo.multiplier}` : 'combo -',
    snap.balance ? `needle ${snap.balance.needle.toFixed(2)} (${snap.balance.axis})` : 'needle -',
    `run score ${snap.run.score}  best ${snap.run.bestCombo}  clock ${snap.run.clockS.toFixed(1)} s`,
    `special ${(snap.special.meter * 100).toFixed(0)}%${snap.special.glowing ? ' GLOWING' : ''}`,
  ]);
  for (const line of log.splice(0)) panel.log(line);
}

async function main(): Promise<void> {
  const def = await loadLevelDef(levelId);
  const level = tryBuild(() => buildLevel(def));
  if (!level) {
    noteFallback(panel, 'levels/builder buildLevel');
    return;
  }
  const make = (): { world: SkaterWorld; driver: SimDebugDriver } | null => {
    const world = tryBuild(() => createWorld({ level, mode: 'free', seed: 7, collectedMacGuffins: [], completedGoals: [] }));
    return world ? { world, driver: createDebugDriver(world, createFrameBuilder()) } : null;
  };
  let sim = make();
  if (!sim) {
    noteFallback(panel, 'sim/world createWorld');
    return;
  }

  if (!live) {
    const { world, driver } = sim;
    const st = scenario.start;
    driver.teleport(st.pos, st.dir, st.speed);
    const ctx: ScriptCtx = { phase: 0, latch: false, seenManual: null, banks: 0 };
    record(world.snapshot, []);
    for (let t = 0; t < scenario.maxTicks; t++) {
      const s = world.snapshot;
      if (scenario.done(s, ctx)) break;
      const held = scenario.step(s, t, ctx);
      const buttons = held.buttons ?? [];
      driver.setInput({
        held: { ollie: buttons.includes('ollie'), flip: buttons.includes('flip'), grab: buttons.includes('grab'), grind: buttons.includes('grind'), revert: buttons.includes('revert'), spinL: buttons.includes('spinL'), spinR: buttons.includes('spinR') },
        dpad: held.dpad ?? 'N',
      });
      const next = driver.step(1);
      const events = driver.takeEvents();
      ctx.banks += events.filter((e) => e.type === 'comboBanked').length;
      record(next, events);
    }
    draw(level, world.snapshot);
    window.addEventListener('resize', () => draw(level, world.snapshot));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__shotReady = true;
    }));
    return;
  }

  // Live: the input track's InputSystem at 120 Hz.
  const system = createInputSystem();
  system.attach(window, canvas);
  const builder = createFrameBuilder();
  const loop = new FixedLoop({
    onTick: () => {
      if (!sim) return;
      const frame = builder.next(system.nextTick(), sim.world.tick);
      const res = sim.world.step(frame);
      loop.setTimeScale(res.snapshot.timeScale);
      record(res.snapshot, res.events);
      if (trail.length > 2400) trail.splice(0, trail.length - 2400);
      if (marks.length > 60) marks.splice(0, marks.length - 60);
    },
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      sim = make();
      builder.reset();
      trail.length = 0;
      marks.length = 0;
    }
  });
  let last = performance.now();
  let frames = 0;
  const frame = (): void => {
    const now = performance.now();
    system.sample(now);
    loop.frame((now - last) / 1000);
    last = now;
    if (sim) draw(level, sim.world.snapshot);
    frames += 1;
    if (frames === 10) window.__shotReady = true;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
