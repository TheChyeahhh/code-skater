/**
 * dev/input.ts (input track harness, port 5301): the full input stack live.
 * InputSystem (keyboard + mouse + every standard pad) -> FixedLoop 120 Hz -> FrameBuilder -> parseTick
 * against a mock ParserContext -> the M1 input overlay (src/input/devOverlay.ts). NavInput is shown too.
 * Run: npx vite --port 5301 --strictPort, open http://localhost:5301/dev/input.html
 * Query: ?state=Air|Grind|Manual|Grounded|LandWindow|RevertWindow  ?glow=1  ?demo (a scripted fake
 * DualSense-family pad drives the same stack, for screenshots). The dev button (Share / View / ~)
 * toggles the overlay.
 */

import { FixedLoop } from '../src/core/loop';
import { BUTTONS } from '../src/core/types';
import type { DirOrNeutral, GrindTypeId, InputFrame, ManualId, SkaterStateName } from '../src/core/types';
import { grindTypeFromDir } from '../src/data/tricks';
import { createInputOverlay } from '../src/input/devOverlay';
import { createFrameBuilder } from '../src/input/frameBuilder';
import { createParserMemory, parseTick } from '../src/input/parser';
import { createInputSystem } from '../src/input/system';
import type { GamepadLike, ParserContext, ParserMemory } from '../src/input/types';
import { createDemoPad } from './input/demoPad';
import { mountPanel } from './shared/harness';

const params = new URLSearchParams(location.search);
const demo = params.has('demo');

const panel = mountPanel('Input harness', [
  'Input track, port 5301. Pad: standard mapping. Keyboard: Space ollie, J flip, K grab, L grind,',
  'Shift revert, Z (or Ctrl) nollie, Q / E spin, WASD / arrows, Esc pause, ~ dev (toggles the overlay).',
  'Click a state chip to set the mock parser context.',
]);

// --- Mock parser context -------------------------------------------------------------------------
const STATES: readonly { label: string; state: SkaterStateName; land: 'flat' | 'vert' | null }[] = [
  { label: 'Grounded', state: 'Grounded', land: null },
  { label: 'Air', state: 'Air', land: null },
  { label: 'Grind', state: 'Grind', land: null },
  { label: 'Manual', state: 'Manual', land: null },
  { label: 'LandWindow flat', state: 'LandWindow', land: 'flat' },
  { label: 'LandWindow vert', state: 'LandWindow', land: 'vert' },
  { label: 'RevertWindow', state: 'RevertWindow', land: 'vert' },
];
let stateIdx = Math.max(0, STATES.findIndex((s) => s.state === (params.get('state') ?? 'Air')));
let glowing = params.get('glow') === '1';
let stateTick = 0;
let tick = 0;

const chips = document.createElement('div');
chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px';
const chipEls: HTMLButtonElement[] = [];
const chip = (label: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font:12px system-ui,sans-serif;padding:3px 7px;border-radius:4px;border:1px solid #46506a;background:#1b2130;color:#e8ebf2;cursor:pointer';
  b.addEventListener('click', onClick);
  chips.append(b);
  return b;
};
STATES.forEach((s, i) => chipEls.push(chip(s.label, () => setState(i))));
const glowChip = chip('glowing', () => setGlow(!glowing));
chip('toggle overlay', () => overlay.toggle());
panel.root.append(chips);

function paintChips(): void {
  chipEls.forEach((c, i) => (c.style.background = i === stateIdx ? '#2f6fed' : '#1b2130'));
  glowChip.style.background = glowing ? '#ffb020' : '#1b2130';
  glowChip.style.color = glowing ? '#10131a' : '#e8ebf2';
}
function setState(i: number): void {
  stateIdx = i;
  stateTick = tick;
  paintChips();
}
function setGlow(on: boolean): void {
  glowing = on;
  paintChips();
}
paintChips();

function mockContext(): ParserContext {
  const s = STATES[stateIdx] ?? STATES[0];
  const byDir = {} as Record<DirOrNeutral, GrindTypeId>;
  for (const d of ['N', 'U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'] as const) byDir[d] = grindTypeFromDir(d, true);
  const manual: ManualId | null = s.state === 'Manual' ? 'manual' : null;
  return {
    state: s.state, glowing, speed: 6, onFlat: true, landKind: s.land, revertUsedThisLanding: false,
    stateEnteredTick: stateTick, spineTransferAvailable: false, airGrindCandidate: null, groundSnapAvailable: false,
    grindTypeByDir: byDir, currentGrindType: s.state === 'Grind' ? 'fifty_fifty' : null,
    ticksSinceLeftSurface: s.state === 'Air' ? tick - stateTick : null, poppedThisAir: true, crossHeldAtLeftSurface: false,
    charging: false, manual, rollingFakie: false,
  };
}

// --- The stack ---------------------------------------------------------------------------------------
const demoPad = demo ? createDemoPad({ setState: (name, glow) => {
  const i = STATES.findIndex((s) => s.label === name);
  if (i >= 0) setState(i);
  setGlow(glow);
} }) : null;
const getGamepads = demoPad
  ? (): readonly (GamepadLike | null)[] => [demoPad.pad]
  : undefined;
const system = createInputSystem(getGamepads ? { getGamepads } : undefined);
system.attach(window, document.body);
const builder = createFrameBuilder();
let memory: ParserMemory = createParserMemory('Air');
let frame: InputFrame | null = null;

const overlay = createInputOverlay(document.body);
system.onConnection((e) => overlay.note(`${e.connected ? 'connected' : 'disconnected'} ${e.device.id} (${e.device.glyphs})`));
if (demoPad) demoPad.onRumble = (w, s, ms) => overlay.note(`rumble weak ${w} strong ${s} ${ms} ms`);

const loop = new FixedLoop({
  onTick: (t) => {
    tick = t;
    const raw = system.nextTick();
    frame = builder.next(raw, t);
    if (frame.pressed.includes('dev')) overlay.toggle();
    const res = parseTick(mockContext(), frame, memory);
    memory = res.memory;
    overlay.logActions(t, res.actions);
    if (demoPad && res.actions.some((a) => a.kind === 'special')) system.rumble('gap');
    if (frame.pressed.length > 0) panel.log(`t${t} pressed ${frame.pressed.join(', ')}`);
  },
});

let last = performance.now();
let frames = 0;
const step = (): void => {
  const now = performance.now();
  demoPad?.advance(now);
  system.sample(now);
  const nav = system.nav();
  overlay.logNav(nav);
  loop.frame((now - last) / 1000);
  last = now;
  const s = STATES[stateIdx] ?? STATES[0];
  overlay.update({ device: system.activeDevice, frame, memory, context: `mock context: ${s.label}${glowing ? ', glowing' : ''}  (state entered t${stateTick})` });
  panel.setStatus([
    `active device: ${system.activeDevice.kind} "${system.activeDevice.id}"`,
    `held: ${frame ? BUTTONS.filter((b) => frame?.held[b]).join(' ') || '-' : '-'}`,
    demo ? `demo: ${demoPad?.label ?? ''}` : 'live input',
  ]);
  frames += 1;
  if (demoPad ? demoPad.finished : frames === 10) window.__shotReady = true;
  requestAnimationFrame(step);
};
requestAnimationFrame(step);
