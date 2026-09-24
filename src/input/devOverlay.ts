/**
 * src/input/devOverlay.ts (input track): the M1 dev overlay of raw and parsed input (DESIGN J.1 M1).
 * A DOM panel that shows, per tick: the active device and glyph set, held buttons (flash on press),
 * both sticks with the live deadzone and the 45 deg sectors, D-pad / stick / combined Dir8 and
 * dirAxis, the DirEnter ring with tEnter / tExit (sim ticks) and consumed marks, the press history,
 * the parser buffers, a log of ParsedActions, and the last menu (NavInput) edges.
 * Toggleable (show / hide / toggle) and self-contained so the game can mount it later on any
 * element (the app decides which key toggles it). Nothing touches the DOM until createInputOverlay
 * is called, so the module imports cleanly in node.
 */

import { TUNING } from '../core/tuning';
import { BUTTONS, DIR8 } from '../core/types';
import type { Button, InputFrame, NavInput, Vec2 } from '../core/types';
import { glyphLabel } from './glyphs';
import type { DeviceInfo, ParsedAction, ParserMemory } from './types';

export interface InputOverlayState {
  readonly device: DeviceInfo;
  readonly frame: InputFrame | null;
  readonly memory?: ParserMemory | null;
  /** Free text shown under the title (harness: the mock parser context). */
  readonly context?: string;
}

export interface InputOverlay {
  readonly root: HTMLElement;
  readonly visible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  /** Redraw from the latest frame (call once per render frame). */
  update(state: InputOverlayState): void;
  /** Append this tick's parsed actions to the log (call per tick; empty lists are ignored). */
  logActions(tick: number, actions: readonly ParsedAction[]): void;
  /** Record menu edges (only frames where something fired are kept). */
  logNav(nav: NavInput): void;
  /** Free-form log line (connection events, rumble). */
  note(line: string): void;
  dispose(): void;
}

const STYLE_ID = 'cs-input-overlay-style';
const CSS = `
.cs-io { position: fixed; top: 12px; right: 12px; width: 380px; max-height: calc(100vh - 24px); overflow-y: auto;
  padding: 10px 12px; border-radius: 8px; background: rgba(8, 10, 16, 0.86); color: #e8ebf2; z-index: 50;
  font: 12px/1.4 ui-monospace, Consolas, 'Courier New', monospace; box-shadow: 0 4px 18px rgba(0,0,0,0.4); }
.cs-io[hidden] { display: none; }
.cs-io h2 { margin: 0 0 2px; font: 600 13px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; letter-spacing: 0.04em; }
.cs-io .sub { color: #9aa3b5; margin-bottom: 6px; white-space: pre-wrap; }
.cs-io .btns { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 6px 0; }
.cs-io .btn { padding: 3px 0; text-align: center; border-radius: 4px; background: #1b2130; color: #7f889b; }
.cs-io .btn.held { background: #2f6fed; color: #fff; }
.cs-io .btn.press { background: #ffb020; color: #10131a; }
.cs-io .sticks { display: flex; gap: 10px; align-items: center; }
.cs-io svg { width: 92px; height: 92px; flex: none; }
.cs-io .dirs { white-space: pre; }
.cs-io .ring { display: flex; gap: 4px; margin: 6px 0 2px; min-height: 36px; }
.cs-io .ent { padding: 2px 5px; border-radius: 4px; background: #1b2130; border: 1px solid #2b3244; text-align: center; }
.cs-io .ent b { display: block; font-size: 14px; }
.cs-io .ent.open { border-color: #2f6fed; }
.cs-io .ent.used { opacity: 0.45; text-decoration: line-through; }
.cs-io .label { color: #9aa3b5; margin-top: 6px; }
.cs-io .log { white-space: pre-wrap; overflow-wrap: anywhere; color: #cfd6e4; }
.cs-io .log .new { color: #ffb020; }
`;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Press history lines shown. */
const PRESS_LINES = 4;
/** Log lines newer than this many ticks are highlighted. */
const FRESH_TICKS = 60;
const SECTOR_COUNT = DIR8.length;

interface StickView {
  readonly svg: SVGSVGElement;
  update(v: Vec2, dirIndex: number | null): void;
}

/** A stick diagram: rim, deadzone ring, the 8 sector boundaries, the lit sector, the stick dot. */
function stickView(doc: Document, title: string): StickView {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-1.15 -1.15 2.3 2.3');
  svg.setAttribute('aria-label', title);
  const mk = (tag: string, attrs: Record<string, string>): SVGElement => {
    const n = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };
  const wedge = mk('path', { fill: 'rgba(47,111,237,0.45)', d: '' });
  mk('circle', { cx: '0', cy: '0', r: '1', fill: 'none', stroke: '#46506a', 'stroke-width': '0.04' });
  const dz = mk('circle', { cx: '0', cy: '0', r: '0.35', fill: 'rgba(255,255,255,0.05)', stroke: '#7f889b', 'stroke-width': '0.03', 'stroke-dasharray': '0.06 0.05' });
  const lines: SVGElement[] = [];
  for (let i = 0; i < SECTOR_COUNT; i++) lines.push(mk('line', { stroke: '#2b3244', 'stroke-width': '0.025' }));
  const dot = mk('circle', { cx: '0', cy: '0', r: '0.11', fill: '#ffb020' });
  const polar = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [r * Math.sin(a), -r * Math.cos(a)];
  };
  return {
    svg,
    update(v, dirIndex) {
      const dead = TUNING.STICK_DEADZONE;
      const sector = TUNING.DIR_SECTOR_DEG;
      dz.setAttribute('r', String(dead));
      lines.forEach((ln, i) => {
        const [x1, y1] = polar(i * sector + sector / 2, dead);
        const [x2, y2] = polar(i * sector + sector / 2, 1);
        ln.setAttribute('x1', String(x1));
        ln.setAttribute('y1', String(y1));
        ln.setAttribute('x2', String(x2));
        ln.setAttribute('y2', String(y2));
      });
      if (dirIndex === null) wedge.setAttribute('d', '');
      else {
        const a0 = dirIndex * sector - sector / 2;
        const a1 = dirIndex * sector + sector / 2;
        const [ax, ay] = polar(a0, 1);
        const [bx, by] = polar(a1, 1);
        const [cx, cy] = polar(a1, dead);
        const [ex, ey] = polar(a0, dead);
        wedge.setAttribute('d', `M${ex},${ey} L${ax},${ay} A1,1 0 0 1 ${bx},${by} L${cx},${cy} A${dead},${dead} 0 0 0 ${ex},${ey} Z`);
      }
      const cx = Math.max(-1, Math.min(1, v.x));
      const cy = Math.max(-1, Math.min(1, -v.y));
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
    },
  };
}

function describeAction(a: ParsedAction): string {
  switch (a.kind) {
    case 'special': return `special ${a.specialId}`;
    case 'grindSwitch': return `grindSwitch ${a.grindType}`;
    case 'grindTry': return `grindTry ${a.ground ? 'ground' : 'air'}${a.buffered ? ' buffered' : ''} dir ${a.dir}`;
    case 'enhance': return `enhance ${a.trickId}`;
    case 'trick': return `trick ${a.trickId} (${a.button} ${a.dir})${a.nollie ? ' nollie' : ''}${a.fakie ? ' fakie' : ''}`;
    case 'quickSpin': return `quickSpin ${a.deg}`;
    case 'manualEntry':
    case 'manualLand':
    case 'revertManual':
    case 'manualSwap': return `${a.kind} ${a.manual}`;
    default: return a.kind;
  }
}

function navText(n: NavInput): string {
  const keys: (keyof NavInput)[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'tabPrev', 'tabNext', 'action1', 'action2', 'pause', 'dev'];
  return keys.filter((k) => n[k] === true).join(' ');
}

export function createInputOverlay(parent: HTMLElement): InputOverlay {
  const doc = parent.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = el(doc, 'style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.append(style);
  }
  const root = el(doc, 'div', 'cs-io');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Input overlay');
  const title = el(doc, 'h2', undefined, 'Input overlay');
  const sub = el(doc, 'div', 'sub');
  const btnGrid = el(doc, 'div', 'btns');
  const btnEls = new Map<Button, HTMLElement>();
  for (const b of BUTTONS) {
    const e = el(doc, 'div', 'btn', b);
    btnEls.set(b, e);
    btnGrid.append(e);
  }
  const sticks = el(doc, 'div', 'sticks');
  const left = stickView(doc, 'Left stick');
  const right = stickView(doc, 'Right stick');
  const dirs = el(doc, 'div', 'dirs');
  sticks.append(left.svg, right.svg, dirs);
  const ringLabel = el(doc, 'div', 'label', 'DirEnter ring (sim ticks, oldest first)');
  const ring = el(doc, 'div', 'ring');
  const pressLabel = el(doc, 'div', 'label', 'Press history');
  const presses = el(doc, 'div', 'log');
  const bufLabel = el(doc, 'div', 'label', 'Parser buffers');
  const buffers = el(doc, 'div', 'log');
  const logLabel = el(doc, 'div', 'label', 'Parsed actions');
  const log = el(doc, 'div', 'log');
  const navLabel = el(doc, 'div', 'label', 'Menu input (last edges)');
  const nav = el(doc, 'div', 'log');
  root.append(title, sub, btnGrid, sticks, ringLabel, ring, pressLabel, presses, bufLabel, buffers, navLabel, nav, logLabel, log);
  parent.append(root);

  const lines: { text: string; tick: number }[] = [];
  let lastTick = -1;
  let navLine = '-';

  const renderLog = (): void => {
    log.replaceChildren(...lines.map((l) => {
      const d = el(doc, 'div', l.tick >= lastTick - FRESH_TICKS ? 'new' : undefined, l.text);
      return d;
    }));
  };
  const push = (text: string, tick: number): void => {
    lines.unshift({ text, tick });
    const cap = Math.max(1, Math.floor(TUNING.INPUT_OVERLAY_LOG_LINES));
    if (lines.length > cap) lines.length = cap;
    renderLog();
  };

  return {
    root,
    get visible(): boolean {
      return !root.hidden;
    },
    show(): void {
      root.hidden = false;
    },
    hide(): void {
      root.hidden = true;
    },
    toggle(): void {
      root.hidden = !root.hidden;
    },
    update(state: InputOverlayState): void {
      if (root.hidden) return;
      const f = state.frame;
      const d = state.device;
      sub.textContent = `${d.kind} ${d.index ?? ''} "${d.id}"  glyphs ${d.glyphs}${state.context ? `\n${state.context}` : ''}`;
      for (const b of BUTTONS) {
        const e = btnEls.get(b) as HTMLElement;
        e.textContent = glyphLabel(d.glyphs, b);
        e.title = b;
        e.className = `btn${f && f.pressed.includes(b) ? ' press' : f && f.held[b] ? ' held' : ''}`;
      }
      if (!f) return;
      lastTick = f.tick;
      const sIdx = f.stickDir === 'N' ? null : DIR8.indexOf(f.stickDir);
      left.update(f.stick, sIdx);
      right.update(f.look, null);
      dirs.textContent = [
        `tick   ${f.tick}  (${f.source})`,
        `dpad   ${f.dpad}`,
        `stick  ${f.stickDir}  (${f.stick.x.toFixed(2)}, ${f.stick.y.toFixed(2)})`,
        `dir    ${f.dir}`,
        `axis   ${f.dirAxis.x.toFixed(2)}, ${f.dirAxis.y.toFixed(2)}`,
        `look   ${f.look.x.toFixed(2)}, ${f.look.y.toFixed(2)}`,
        `mouse  ${f.lookDelta.x.toFixed(0)}, ${f.lookDelta.y.toFixed(0)} px`,
      ].join('\n');
      const consumed = new Set(state.memory?.consumed ?? []);
      ring.replaceChildren(...f.dirHistory.map((e) => {
        const box = el(doc, 'div', `ent${e.open ? ' open' : ''}${consumed.has(e.id) ? ' used' : ''}`);
        box.append(el(doc, 'b', undefined, e.dir), doc.createTextNode(`${e.tEnter}..${e.open ? 'now' : e.tExit}`));
        return box;
      }));
      presses.textContent = f.pressHistory.slice(-PRESS_LINES).reverse()
        .map((p) => `t${p.tick} ${p.button} dir ${p.dir}${p.nollieHeld ? ' +nollie' : ''}`).join('\n') || '-';
      const m = state.memory;
      buffers.textContent = m
        ? [
          `state ${m.lastState}  revertBuf ${m.revertBufferTick ?? '-'}  grindBuf ${m.grindBufferTick ?? '-'}`,
          `lastAir ${m.lastAirTrick ? `${m.lastAirTrick.button} ${m.lastAirTrick.dir} t${m.lastAirTrick.tick}${m.lastAirTrick.enhanced ? ' enhanced' : ''}` : '-'}`,
          `swaps ${m.manualSwapsThisRun}  consumed ${m.consumed.join(',') || '-'}`,
        ].join('\n')
        : '-';
      nav.textContent = navLine;
    },
    logActions(tick: number, actions: readonly ParsedAction[]): void {
      for (const a of actions) push(`t${tick} ${describeAction(a)}`, tick);
    },
    logNav(n: NavInput): void {
      const t = navText(n);
      if (t) navLine = `${t}  (${n.source})`;
    },
    note(line: string): void {
      push(line, lastTick);
    },
    dispose(): void {
      root.remove();
    },
  };
}
