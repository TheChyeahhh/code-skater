/**
 * src/ui/hud.ts (ui track): the in-run HUD (REQ-HUD-01..06, REQ-BAL-06, REQ-NPC-02, H.2 wireframe):
 * clock top centre (red pulse under CLOCK_RED_S), run score, combo ticker ("50-50 + Smith", live
 * base x multiplier as integers), special bar (animated gradient when glowing), balance meter
 * (arc over the head for grind / lip, vertical bar for manual, reads snapshot.balance.needle), land
 * text for LAND_TEXT_S (OK on a "land" event with quality ok, clean shows nothing; a later
 * "comboBanked" with quality sick / insane replaces it with SICK / INSANE), gap splash (GAP_SPLASH_S with
 * "+base"), MacGuffin full-width splash (MACGUFFIN_SPLASH_S) + toast, goal peek, letter tray, NPC
 * dialog (name, BRANDS title line under it, opens on each "npcTalk" event, closes after NPC_DIALOG_S or on NavInput.confirm; the HUD
 * owns that state, snapshot.npc only says the skater is inside a trigger; UiRoot.update hands the
 * frame's NavInput to the HUD for the confirm). DOM only, updated in place
 * (no layout thrash per frame).
 *
 * Beyond the frozen Hud contract the returned object also has (HudExt):
 * - nav(nav): the frame's NavInput (confirm closes the NPC dialog), called by UiRoot.update.
 * - setGoals(goals, doneBefore): the park's goal list for the goal peek (career runs only).
 * - setProjector(fn): world -> screen for the balance meter so it sits over the skater's head;
 *   without one the meter sits at UI_BALANCE_ARC_Y / UI_BALANCE_BAR_X of the screen.
 */

import type { SimEvent } from '../core/events';
import { TUNING } from '../core/tuning';
import { LETTERS, type GlyphSet, type LetterId, type NavInput, type NpcId, type SimSnapshot, type Vec3 } from '../core/types';
import { BRANDS } from '../data/brands';
import { goalName, type GoalDef } from '../data/goals';
import { clear, el, setClass, setStyle, setText, svgIcon } from './dom';
import { formatBonus, formatClock, formatComboTotal, formatScore } from './format';
import { navHint } from './glyphs';
import type { Hud } from './types';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** False when behind the camera or off screen. */
  readonly visible: boolean;
}

export type WorldProjector = (world: Vec3) => ScreenPoint | null;

export interface HudExt extends Hud {
  nav(nav: NavInput): void;
  setGoals(goals: readonly GoalDef[], doneBefore: readonly string[]): void;
  setProjector(project: WorldProjector | null): void;
  /** True while the NPC dialog is open (tests). */
  readonly npcOpen: boolean;
}

/** Arc geometry (SVG units): a semicircle over the head, needle swings between +-ARC_DEG. */
const ARC_VIEW = '0 0 200 110';
const ARC_CX = 100;
const ARC_CY = 100;
const ARC_R = 84;
const ARC_DEG = 80;

/** Leading marker for a combo too long to list in full. */
export const TICKER_MORE = '... + ';

/**
 * The ticker line, oldest first: past `max` names only the newest `max` show, after TICKER_MORE,
 * so the trick being done right now is always on screen (the CSS clip drops old lines, never the tail).
 */
export function tickerText(names: readonly string[], max: number): string {
  const n = Math.max(1, Math.floor(max));
  return names.length > n ? TICKER_MORE + names.slice(names.length - n).join(' + ') : names.join(' + ');
}

function arcPoint(deg: number): { x: number; y: number } {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: ARC_CX + ARC_R * Math.cos(a), y: ARC_CY + ARC_R * Math.sin(a) };
}

function arcPath(fromDeg: number, toDeg: number): string {
  const a = arcPoint(fromDeg);
  const b = arcPoint(toDeg);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${ARC_R} ${ARC_R} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** Head height above the feet for the arc anchor. */
function headPoint(s: SimSnapshot): Vec3 {
  const up = s.skater.up;
  const h = TUNING.SKATER_HEIGHT_M;
  return { x: s.skater.pos.x + up.x * h, y: s.skater.pos.y + up.y * h, z: s.skater.pos.z + up.z * h };
}

function hipPoint(s: SimSnapshot): Vec3 {
  const up = s.skater.up;
  const h = TUNING.SKATER_HEIGHT_M * 0.5;
  return { x: s.skater.pos.x + up.x * h, y: s.skater.pos.y + up.y * h, z: s.skater.pos.z + up.z * h };
}

/** The subtitle under an NPC's name: BRANDS.npcs[id].title, or '' when it is missing or just the name. */
export function npcTitleFor(id: NpcId, name: string): string {
  const title = BRANDS.npcs[id]?.title ?? '';
  return title.trim() === name.trim() ? '' : title;
}

export function createHud(container: HTMLElement): HudExt {
  const root = el('div', 'hud');
  container.append(root);

  // Top row: score, clock, letters.
  const scoreValue = el('span', 'hud__scoreValue', '0');
  const score = el('div', 'hud__score', el('span', 'hud__label', 'Score'), scoreValue);
  const clock = el('div', 'hud__clock', '2:00');
  const letterEls = {} as Record<LetterId, HTMLElement>;
  const letters = el('div', 'hud__letters');
  for (const l of LETTERS) {
    letterEls[l] = el('span', 'letter', l);
    letters.append(letterEls[l]);
  }
  root.append(el('div', 'hud__top', score, clock, letters));

  // Goal peek (career only): a skewed chip, "NEXT: <goal>", swapping to a green "DONE: <goal>" for
  // UI_TOAST_S when a goal completes. Each row is a tag span + a name span so the text reads as one line.
  const peekDoneTag = el('span', 'goalpeek__tag', 'Done: ');
  const peekDoneName = el('span', 'goalpeek__name');
  const peekDone = el('div', 'goalpeek__row goalpeek__row--done', peekDoneTag, peekDoneName);
  const peekNextTag = el('span', 'goalpeek__tag', 'Next: ');
  const peekNextName = el('span', 'goalpeek__name');
  const peekNext = el('div', 'goalpeek__row goalpeek__row--next', peekNextTag, peekNextName);
  const peek = el('div', 'hud__goalpeek', peekDone, peekNext);
  root.append(peek);

  // Balance: arc (h) and bar (v).
  const arcSvg = svgIcon(
    ARC_VIEW,
    `<path class="arc__track" d="${arcPath(-ARC_DEG, ARC_DEG)}"/>` +
      `<path class="arc__danger" d="${arcPath(-ARC_DEG, -ARC_DEG * 0.7)}"/>` +
      `<path class="arc__danger" d="${arcPath(ARC_DEG * 0.7, ARC_DEG)}"/>` +
      `<path class="arc__center" d="M ${ARC_CX} ${ARC_CY - ARC_R - 9} L ${ARC_CX} ${ARC_CY - ARC_R + 9}"/>` +
      `<g class="arc__needle"><circle cx="${ARC_CX}" cy="${ARC_CY - ARC_R}" r="9"/></g>`,
    'arc',
  );
  const arcNeedle = arcSvg.querySelector('.arc__needle') as SVGGElement;
  const arc = el('div', 'hud__balance hud__balance--h', arcSvg);
  const barNeedle = el('div', 'bar__needle');
  const bar = el('div', 'hud__balance hud__balance--v', el('div', 'bar__track', el('div', 'bar__danger bar__danger--top'), el('div', 'bar__danger bar__danger--bottom'), el('div', 'bar__center'), barNeedle));
  root.append(arc, bar);

  // Centre: land text and gap splash.
  const land = el('div', 'hud__land');
  const gapName = el('span', 'gap__name');
  const gapBonus = el('span', 'gap__bonus');
  const gap = el('div', 'hud__gap', gapName, gapBonus);
  root.append(el('div', 'hud__center', land, gap));

  // Full-width MacGuffin splash.
  const splashText = el('span', 'splash__text');
  const splash = el('div', 'hud__splash', splashText);
  root.append(splash);

  // Bottom-left cluster: ticker names, then the total (base, x, multiplier as three spans whose
  // textContent is still formatComboTotal's string), then the short skewed special meter under it.
  const tickerNames = el('div', 'ticker__names');
  const tickerBase = el('span', 'ticker__base');
  const tickerX = el('span', 'ticker__x');
  const tickerMult = el('span', 'ticker__mult');
  const tickerTotal = el('div', 'ticker__total', tickerBase, tickerX, tickerMult);
  const ticker = el('div', 'hud__ticker', tickerNames, tickerTotal);
  const specialFill = el('div', 'special__fill');
  const special = el('div', 'hud__special', el('span', 'special__label', 'Special'), el('div', 'special__track', specialFill));
  root.append(el('div', 'hud__bottom', ticker, special));

  // Toast stack and NPC dialog.
  const toasts = el('div', 'hud__toasts');
  const npcName = el('div', 'npc__name');
  const npcTitle = el('div', 'npc__title');
  const npcLine = el('div', 'npc__line');
  const npcHint = el('div', 'npc__hint');
  const npc = el('div', 'hud__npc', npcName, npcTitle, npcLine, npcHint);
  root.append(toasts, npc);

  // Timers (seconds left), fed by dtS.
  let landLeft = 0;
  let gapLeft = 0;
  let splashLeft = 0;
  let npcLeft = 0;
  let tickerFlashLeft = 0;
  let specialReadyLeft = 0;
  let doneFlashLeft = 0;
  const letterFlash = {} as Record<LetterId, number>;
  for (const l of LETTERS) letterFlash[l] = 0;
  const toastList: { readonly el: HTMLElement; left: number }[] = [];

  let glyphs: GlyphSet = 'xbox';
  let goals: readonly GoalDef[] = [];
  let doneBefore: readonly string[] = [];
  let project: WorldProjector | null = null;
  let lastMode: SimSnapshot['run']['mode'] = 'free';
  let lastDoneCount = -1;
  let lastNextId: string | null = null;

  const renderNpcHint = (): void => {
    clear(npcHint);
    npcHint.append(navHint(glyphs, 'confirm', 'OK'));
  };
  renderNpcHint();

  const showToast = (text: string, seconds: number): void => {
    const t = el('div', 'toast', text);
    toasts.append(t);
    toastList.push({ el: t, left: seconds });
    while (toastList.length > TUNING.UI_TOAST_MAX) {
      const old = toastList.shift();
      old?.el.remove();
    }
  };

  const closeNpc = (): void => {
    npcLeft = 0;
    setClass(npc, 'is-open', false);
  };

  const updateGoalPeek = (s: SimSnapshot): void => {
    const show = s.run.mode === 'career' && goals.length > 0;
    setClass(peek, 'is-visible', show);
    if (!show) return;
    const doneIds = s.run.goalsCompleted;
    if (doneIds.length !== lastDoneCount || s.run.mode !== lastMode) {
      const lastId = doneIds[doneIds.length - 1];
      const g = lastId ? goals.find((x) => x.id === lastId) : undefined;
      setText(peekDoneName, g ? goalName(g) : 'none yet');
      setClass(peekDone, 'is-empty', !g);
      // A goal just completed (not the first look at a run): show the DONE chip for a moment.
      if (g && doneIds.length > lastDoneCount) doneFlashLeft = TUNING.UI_TOAST_S;
      lastDoneCount = doneIds.length;
    }
    const next = [...goals].sort((a, b) => a.index - b.index).find((g) => !doneBefore.includes(g.id) && !doneIds.includes(g.id));
    const nextId = next ? next.id : null;
    if (nextId !== lastNextId) {
      lastNextId = nextId;
      setText(peekNextTag, next ? 'Next: ' : '');
      setText(peekNextName, next ? goalName(next) : 'All goals done');
    }
    setClass(peek, 'is-done-flash', doneFlashLeft > 0);
  };

  /** Restart a CSS animation on an element that may already be mid-animation. */
  const retrigger = (node: HTMLElement, className: string): void => {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  };

  const showLand = (label: string, quality: 'ok' | 'sick' | 'insane'): void => {
    setText(land, label);
    land.className = `hud__land is-${quality}`;
    landLeft = quality === 'insane' ? TUNING.UI_LAND_TEXT_INSANE_S : TUNING.LAND_TEXT_S;
    retrigger(land, 'is-visible');
  };

  /**
   * Horizontal gap from the hip to the manual bar's left edge: UI_BALANCE_BAR_GAP_H of the skater's
   * projected height (head to feet), never under UI_BALANCE_BAR_GAP_MIN_PX, so the bar clears the arms
   * at any camera distance.
   */
  const manualBarOffsetPx = (s: SimSnapshot): number => {
    const min = TUNING.UI_BALANCE_BAR_GAP_MIN_PX;
    if (!project) return min;
    const head = project(headPoint(s));
    const feet = project(s.skater.pos);
    if (!head || !feet || !head.visible || !feet.visible) return min;
    const h = Math.hypot(head.x - feet.x, head.y - feet.y);
    return Math.max(min, h * TUNING.UI_BALANCE_BAR_GAP_H);
  };

  const placeBalance = (s: SimSnapshot): void => {
    const b = s.balance;
    setClass(arc, 'is-visible', b !== null && b.axis === 'h');
    setClass(bar, 'is-visible', b !== null && b.axis === 'v');
    if (!b) return;
    const needle = Math.max(-1, Math.min(1, b.needle));
    const danger = Math.abs(needle) >= 0.7;
    if (b.axis === 'h') {
      arcNeedle.setAttribute('transform', `rotate(${(needle * ARC_DEG).toFixed(2)} ${ARC_CX} ${ARC_CY})`);
      setClass(arc, 'is-danger', danger);
      const p = project ? project(headPoint(s)) : null;
      if (p && p.visible) {
        setStyle(arc, 'left', `${p.x.toFixed(1)}px`);
        setStyle(arc, 'top', `${p.y.toFixed(1)}px`);
        setClass(arc, 'is-projected', true);
      } else {
        setStyle(arc, 'left', '50%');
        setStyle(arc, 'top', `${(TUNING.UI_BALANCE_ARC_Y * 100).toFixed(1)}%`);
        setClass(arc, 'is-projected', false);
      }
    } else {
      // Negative = nose down: the marker drops below centre.
      setStyle(barNeedle, 'top', `${(50 + needle * -50).toFixed(2)}%`);
      setClass(bar, 'is-danger', danger);
      const p = project ? project(hipPoint(s)) : null;
      if (p && p.visible) {
        setStyle(bar, 'left', `${p.x.toFixed(1)}px`);
        setStyle(bar, 'top', `${p.y.toFixed(1)}px`);
        // Beside the body, not on the arm: the gap grows with the skater's height on screen.
        setStyle(bar, 'transform', `translate(${manualBarOffsetPx(s).toFixed(1)}px, -50%)`);
        setClass(bar, 'is-projected', true);
      } else {
        setStyle(bar, 'left', `${(TUNING.UI_BALANCE_BAR_X * 100).toFixed(1)}%`);
        setStyle(bar, 'top', '50%');
        setStyle(bar, 'transform', '');
        setClass(bar, 'is-projected', false);
      }
    }
  };

  const tickTimers = (dt: number): void => {
    landLeft = Math.max(0, landLeft - dt);
    gapLeft = Math.max(0, gapLeft - dt);
    splashLeft = Math.max(0, splashLeft - dt);
    tickerFlashLeft = Math.max(0, tickerFlashLeft - dt);
    specialReadyLeft = Math.max(0, specialReadyLeft - dt);
    doneFlashLeft = Math.max(0, doneFlashLeft - dt);
    if (npcLeft > 0) {
      npcLeft -= dt;
      if (npcLeft <= 0) closeNpc();
    }
    for (const l of LETTERS) {
      letterFlash[l] = Math.max(0, letterFlash[l] - dt);
      setClass(letterEls[l], 'is-flash', letterFlash[l] > 0);
    }
    for (let i = toastList.length - 1; i >= 0; i--) {
      const t = toastList[i] as { readonly el: HTMLElement; left: number };
      t.left -= dt;
      if (t.left <= 0) {
        t.el.remove();
        toastList.splice(i, 1);
      } else {
        setClass(t.el, 'is-leaving', t.left < 0.3);
      }
    }
    setClass(land, 'is-visible', landLeft > 0);
    setClass(gap, 'is-visible', gapLeft > 0);
    setClass(splash, 'is-visible', splashLeft > 0);
    setClass(ticker, 'is-flash', tickerFlashLeft > 0);
    setClass(special, 'is-ready', specialReadyLeft > 0);
  };

  const hud: HudExt = {
    update(s, dtS) {
      lastMode = s.run.mode;
      tickTimers(dtS);
      setText(scoreValue, formatScore(s.run.score));
      // Free Skate is untimed (DESIGN L): the world runs a day-long clock, the HUD says so instead.
      const untimed = s.run.mode === 'free' && s.run.clockS > TUNING.RUN_LENGTH_S;
      setText(clock, untimed ? 'Free skate' : formatClock(s.run.clockS));
      setClass(clock, 'is-free', untimed);
      setClass(clock, 'is-red', !untimed && s.run.clockS < TUNING.CLOCK_RED_S);
      setClass(clock, 'is-overtime', s.run.overtime);
      for (const l of LETTERS) setClass(letterEls[l], 'is-got', s.run.letters[l]);
      const c = s.combo;
      setClass(ticker, 'is-visible', c !== null && c.names.length > 0);
      if (c && c.names.length > 0) {
        setText(tickerNames, tickerText(c.names, TUNING.UI_TICKER_MAX_NAMES));
        // "1,644 x 9.5" split into base / operator / multiplier spans; their textContent joins back to it.
        const total = formatComboTotal(c.base, c.multiplier);
        const at = total.indexOf(' x ');
        setText(tickerBase, at >= 0 ? total.slice(0, at) : total);
        setText(tickerX, at >= 0 ? ' x ' : '');
        setText(tickerMult, at >= 0 ? total.slice(at + 3) : '');
      }
      const meter = Math.max(0, Math.min(1, s.special.meter));
      setStyle(specialFill, 'width', `${(meter * 100).toFixed(1)}%`);
      setClass(special, 'is-glowing', s.special.glowing);
      placeBalance(s);
      updateGoalPeek(s);
    },
    onEvent(e: SimEvent) {
      switch (e.type) {
        case 'land':
          if (e.quality === 'ok') showLand('OK', 'ok');
          else landLeft = 0;
          break;
        case 'comboBanked':
          if (e.quality === 'sick' || e.quality === 'insane') showLand(e.quality === 'sick' ? 'SICK' : 'INSANE', e.quality);
          break;
        case 'bail':
          landLeft = 0;
          break;
        case 'gap':
          setText(gapName, e.name);
          setText(gapBonus, formatBonus(e.base));
          gapLeft = TUNING.GAP_SPLASH_S;
          retrigger(gap, 'is-pop');
          break;
        case 'macguffin':
          setText(splashText, e.splash);
          splashLeft = TUNING.MACGUFFIN_SPLASH_S;
          showToast(e.toast, TUNING.UI_TOAST_S);
          break;
        case 'letter':
          letterFlash[e.letter] = TUNING.UI_LETTER_FLASH_S;
          break;
        case 'elementAdded':
          tickerFlashLeft = TUNING.UI_TICKER_FLASH_S;
          retrigger(ticker, 'is-flash');
          break;
        case 'goalCompleted':
          if (lastMode === 'career') showToast(`Goal: ${e.name}`, TUNING.UI_TOAST_S);
          break;
        case 'specialReady':
          specialReadyLeft = TUNING.UI_TICKER_FLASH_S * 4;
          retrigger(special, 'is-ready');
          break;
        case 'npcTalk':
          setText(npcName, e.name);
          // The brand table's display line (SPEC 11 identity) under the short name; skipped when it only repeats it.
          setText(npcTitle, npcTitleFor(e.npcId, e.name));
          setText(npcLine, e.line);
          npcLeft = TUNING.NPC_DIALOG_S;
          setClass(npc, 'is-open', true);
          break;
        case 'controllerConnected':
          showToast('Controller connected', TUNING.UI_TOAST_S);
          break;
        default:
          break;
      }
    },
    setVisible(visible) {
      setClass(root, 'is-hidden', !visible);
    },
    setGlyphs(set) {
      glyphs = set;
      renderNpcHint();
    },
    toast(text, seconds) {
      showToast(text, seconds ?? TUNING.UI_TOAST_S);
    },
    nav(nav) {
      if (nav.confirm && npcLeft > 0) closeNpc();
    },
    setGoals(next, before) {
      // The app calls this at every run start: an NPC dialog from the previous run never carries over.
      closeNpc();
      goals = next;
      doneBefore = before;
      lastDoneCount = -1;
      lastNextId = null;
      doneFlashLeft = 0;
    },
    setProjector(fn) {
      project = fn;
    },
    get npcOpen() {
      return npcLeft > 0;
    },
  };
  return hud;
}
