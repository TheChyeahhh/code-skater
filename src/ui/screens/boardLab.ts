/**
 * src/ui/screens/boardLab.ts (ui track): the Board Lab (REQ-LAB-01..03, H.3). A 3D board on a turntable
 * (skater track's BoardPreviewHost, or the 2D placeholder) beside five rows: Deck Graphic, Grip, Trucks,
 * Wheels, Stickers. Up / down move between rows, left / right change the focused row's pick, L1 / R1
 * jump rows too. Confirm on the Stickers row enters placement: the stick moves a cursor over the deck
 * underside (also drawn on the 2D map on the right), confirm places (up to MAX_STICKERS), X / Square
 * removes the sticker under the cursor (or the last one), L1 rotates the provisional sticker, R1 picks
 * the next sticker of the sheet, Y / Triangle picks the next sheet (outside placement it randomises the
 * board; D-pad taps feed both the up / down edges and the cursor, so the sheet cannot live on them),
 * back leaves placement. Confirm on any other row flips the board over. Mouse: drag a sticker from the
 * sheet onto the map to place it, drag a placed sticker to move it. Every change goes to actions.setBoard.
 */

import { TUNING } from '../../core/tuning';
import type { BoardConfig, GripId, NavInput, StickerPlacement, StickerSheetId, TruckColorId, Vec2, WheelId } from '../../core/types';
import { stickerSheetLabel } from '../../data/brands';
import { createBoardPlaceholder, type BoardPlaceholder } from '../boardPlaceholder';
import { clear, el, setClass, setGhost, setText } from '../dom';
import {
  DECK_GRAPHIC_NAMES, deckGraphicDataUrl, deckGraphicThumb, GRIP_LABELS, gripThumb, MAP_DECK_ASPECT, STICKER_ALONG, STICKER_SHEETS,
  STICKERS_PER_SHEET, stickerThumb, swatchThumb, TRUCK_COLORS, TRUCK_LABELS, WHEEL_COLORS, WHEEL_LABELS, DECK_GRAPHIC_COLORS,
} from '../labArt';
import { clampStickerCenter } from '../stickerBounds';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';

const GRIPS: readonly GripId[] = ['black', 'gray', 'clear', 'dieCut'];
const TRUCKS: readonly TruckColorId[] = ['raw', 'black', 'gold', 'red'];
const WHEELS: readonly WheelId[] = ['white99a', 'blue101a', 'green97a', 'orange99a'];
type RowId = 'graphic' | 'grip' | 'trucks' | 'wheels' | 'stickers';
const ROWS: readonly { readonly id: RowId; readonly label: string }[] = [
  { id: 'graphic', label: 'Deck graphic' },
  { id: 'grip', label: 'Grip' },
  { id: 'trucks', label: 'Trucks' },
  { id: 'wheels', label: 'Wheels' },
  { id: 'stickers', label: 'Underside stickers' },
];
/**
 * A placed sticker's long side runs along the deck; on the map (width = deck width) that is
 * STICKER_ALONG of the length, so STICKER_ALONG / MAP_DECK_ASPECT of the map width, drawn a quarter turn.
 */
const MAP_STICKER_W = STICKER_ALONG / MAP_DECK_ASPECT;
/** Deterministic randomiser (Y / Triangle) seeded from the current config so the same press differs. */
function nextSeed(s: number): number {
  let x = (s * 1664525 + 1013904223) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

export function createBoardLab(ctx: ScreenContext): Screen {
  const heading = el('h2', 'heading', 'Board Lab');
  const previewBox = el('div', 'lab__preview');
  const rowsBox = el('div', 'lab__rows');
  const mapBox = el('div', 'lab__map');
  const mapDeck = el('div', 'map__deck');
  const mapCursor = el('div', 'map__cursor');
  const mapHint = el('div', 'map__hint', 'Drag a sticker here');
  mapDeck.append(mapCursor);
  // The hint sits under the outline so it never prints over the chosen deck graphic.
  mapBox.append(el('div', 'map__label', 'Underside'), mapDeck, mapHint);
  const sheetBox = el('div', 'lab__sheet');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--lab', heading, el('div', 'lab__grid', previewBox, el('div', 'lab__side', rowsBox, sheetBox), mapBox), hints);
  setGhost(panel, 'Board Lab');
  const root = el('section', 'screen screen--boardLab', panel);

  let preview: BoardPlaceholder | null = null;
  const host = ctx.boardPreview;
  let mounted = false;

  let placing = false;
  /** Which face the preview shows; every host starts on the top (grip) and flip() toggles. */
  let showingBottom = false;
  let sheetIndex = 0;
  let stickerIndex = 0;
  let cursor: Vec2 = { x: 0.5, y: 0.5 };
  let rotDeg = 0;
  let seed = 7;
  let dragging: { readonly placed: number | null; readonly sheet: StickerSheetId; readonly index: number } | null = null;

  const board = (): BoardConfig => ctx.state().save.board;
  const commit = (next: BoardConfig): void => {
    ctx.actions.setBoard(next);
    ctx.sound('move');
    (host ?? preview)?.setConfig(next);
    renderMap();
  };

  const cycle = <T extends string>(list: readonly T[], cur: T, d: number): T => list[((list.indexOf(cur) + d) % list.length + list.length) % list.length] as T;

  const provisional = (): StickerPlacement => ({ sheet: STICKER_SHEETS[sheetIndex] as StickerSheetId, index: stickerIndex, u: cursor.y, v: cursor.x, rotDeg });

  const previewHost = (): BoardPlaceholder | typeof host => host ?? preview;

  const flipFace = (): void => {
    showingBottom = !showingBottom;
    previewHost()?.flip();
  };

  /** Stickers live on the underside: turn the board over before placing one. */
  const showUnderside = (): void => {
    if (!showingBottom) flipFace();
  };

  const syncPlacement = (): void => {
    const h = previewHost();
    // The host takes StickerPlacement coordinates (x = u along the length, y = v across);
    // the screen's cursor is map space (x across, y along).
    h?.setCursor(placing ? { x: cursor.y, y: cursor.x } : null);
    h?.setPreviewSticker(placing && board().stickers.length < TUNING.MAX_STICKERS ? provisional() : null);
    setClass(mapCursor, 'is-visible', placing);
    mapCursor.style.left = `${cursor.x * 100}%`;
    mapCursor.style.top = `${(1 - cursor.y) * 100}%`;
    setClass(mapBox, 'is-placing', placing);
  };

  const placedIndexAt = (uv: Vec2): number | null => {
    const stickers = board().stickers;
    let best: number | null = null;
    let bestD = 0.16;
    stickers.forEach((s, i) => {
      const d = Math.hypot((s.v - uv.x) * 0.3, (s.u - uv.y));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  // The 2D map of the underside (mouse drag target + a mirror of the cursor).
  const renderMap = (): void => {
    for (const c of Array.from(mapDeck.querySelectorAll('.map__sticker'))) c.remove();
    const b = board();
    const graphic = deckGraphicDataUrl(b.deckGraphic);
    const tint = DECK_GRAPHIC_COLORS[b.deckGraphic] ?? '#333';
    mapDeck.style.background = graphic ? `url(${graphic}) center / 100% 100% no-repeat ${tint}` : tint;
    b.stickers.forEach((s, i) => {
      const chip = el('div', 'map__sticker', stickerThumb(s.sheet, s.index));
      chip.style.left = `${s.v * 100}%`;
      chip.style.top = `${(1 - s.u) * 100}%`;
      chip.style.width = `${MAP_STICKER_W * 100}%`;
      chip.style.transform = `translate(-50%, -50%) rotate(${-90 - s.rotDeg}deg)`;
      chip.setAttribute('draggable', 'false');
      chip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        dragging = { placed: i, sheet: s.sheet, index: s.index };
        mapDeck.setPointerCapture?.(ev.pointerId);
      });
      mapDeck.append(chip);
    });
    setClass(mapHint, 'is-hidden', b.stickers.length > 0 || placing);
    setText(mapBox.querySelector('.map__label') as HTMLElement, `Underside  ${b.stickers.length} of ${TUNING.MAX_STICKERS}`);
  };

  /** Map-space point (x across, y along) moved to where a sticker with this rotation lies wholly on the deck. */
  const onDeck = (p: Vec2, rot: number): Vec2 => {
    const c = clampStickerCenter(p.y, p.x, rot);
    return { x: c.v, y: c.u };
  };

  const uvFromPointer = (ev: PointerEvent): Vec2 => {
    const r = mapDeck.getBoundingClientRect();
    const x = r.width > 0 ? (ev.clientX - r.left) / r.width : 0.5;
    const y = r.height > 0 ? 1 - (ev.clientY - r.top) / r.height : 0.5;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };

  mapDeck.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const placedRot = dragging.placed !== null ? board().stickers[dragging.placed]?.rotDeg ?? 0 : 0;
    const uv = onDeck(uvFromPointer(ev), placedRot);
    cursor = uv;
    if (dragging.placed !== null) {
      const stickers = board().stickers.map((s, i) => (i === dragging?.placed ? { ...s, u: uv.y, v: uv.x } : s));
      (host ?? preview)?.setConfig({ ...board(), stickers });
      const chip = mapDeck.querySelectorAll('.map__sticker')[dragging.placed] as HTMLElement | undefined;
      if (chip) {
        chip.style.left = `${uv.x * 100}%`;
        chip.style.top = `${(1 - uv.y) * 100}%`;
      }
    } else {
      previewHost()?.setPreviewSticker({ sheet: dragging.sheet, index: dragging.index, u: uv.y, v: uv.x, rotDeg: 0 });
    }
  });
  const endDrag = (ev: PointerEvent): void => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    const raw = uvFromPointer(ev);
    // Dropped off the map: a placed sticker is removed, a new one is not placed.
    const inside = raw.x > 0 && raw.x < 1 && raw.y > 0 && raw.y < 1;
    const b = board();
    if (d.placed !== null) {
      const uv = onDeck(raw, b.stickers[d.placed]?.rotDeg ?? 0);
      if (inside) commit({ ...b, stickers: b.stickers.map((s, i) => (i === d.placed ? { ...s, u: uv.y, v: uv.x } : s)) });
      else commit({ ...b, stickers: b.stickers.filter((_, i) => i !== d.placed) });
    } else if (inside && b.stickers.length < TUNING.MAX_STICKERS) {
      const uv = onDeck(raw, 0);
      commit({ ...b, stickers: [...b.stickers, { sheet: d.sheet, index: d.index, u: uv.y, v: uv.x, rotDeg: 0 }] });
    } else {
      ctx.sound('error');
      previewHost()?.setPreviewSticker(null);
      renderMap();
    }
    syncPlacement();
  };
  mapDeck.addEventListener('pointerup', endDrag);
  mapDeck.addEventListener('pointercancel', endDrag);
  /** A drag released anywhere ends it; bound only while the Lab is shown (enter / leave). */
  const onWindowPointerUp = (ev: PointerEvent): void => {
    if (dragging) endDrag(ev);
  };

  // Rows.
  interface Row {
    readonly id: RowId;
    readonly el: HTMLElement;
    readonly picks: HTMLElement;
    readonly value: HTMLElement;
  }
  const rowEls: Row[] = ROWS.map((r) => {
    const picks = el('div', 'lab__picks');
    const value = el('span', 'lab__value');
    const row = el('div', `lab__row lab__row--${r.id}`, el('div', 'lab__rowhead', el('span', 'lab__rowlabel', r.label), value), picks);
    rowsBox.append(row);
    return { id: r.id, el: row, picks, value };
  });

  const renderSheet = (): void => {
    clear(sheetBox);
    const sheet = STICKER_SHEETS[sheetIndex] as StickerSheetId;
    const tabs = el('div', 'sheet__tabs');
    STICKER_SHEETS.forEach((s, i) => {
      const t = el('button', `sheet__tab${i === sheetIndex ? ' is-active' : ''}`, stickerSheetLabel(s));
      t.type = 'button';
      t.addEventListener('click', () => {
        sheetIndex = i;
        stickerIndex = 0;
        renderSheet();
        syncPlacement();
      });
      tabs.append(t);
    });
    const strip = el('div', 'sheet__strip');
    for (let i = 0; i < STICKERS_PER_SHEET; i++) {
      const c = el('div', `sheet__sticker${i === stickerIndex && placing ? ' is-active' : ''}`, stickerThumb(sheet, i));
      c.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        stickerIndex = i;
        dragging = { placed: null, sheet, index: i };
        showUnderside();
        renderSheet();
      });
      strip.append(c);
    }
    sheetBox.append(el('div', 'sheet__label', 'Sticker sheets'), tabs, strip);
  };

  const renderRows = (): void => {
    const b = board();
    for (const r of rowEls) {
      clear(r.picks);
      const pick = (children: readonly { readonly el: HTMLElement; readonly active: boolean; readonly onClick: () => void }[]): void => {
        for (const c of children) {
          setClass(c.el, 'is-active', c.active);
          c.el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            c.onClick();
          });
          r.picks.append(c.el);
        }
      };
      switch (r.id) {
        case 'graphic':
          setText(r.value, DECK_GRAPHIC_NAMES[b.deckGraphic] ?? '');
          // The hero pick: drawn at twice its display size so the art stays crisp.
          pick(DECK_GRAPHIC_NAMES.map((name, i) => ({ el: el('div', 'pick pick--deck pick--graphic', deckGraphicThumb(i, 128, 352), el('span', 'pick__label', String(i + 1))), active: i === b.deckGraphic, onClick: () => commit({ ...b, deckGraphic: i }) })));
          break;
        case 'grip':
          setText(r.value, GRIP_LABELS[b.grip]);
          pick(GRIPS.map((g) => ({ el: el('div', 'pick pick--deck', gripThumb(g), el('span', 'pick__label', GRIP_LABELS[g])), active: g === b.grip, onClick: () => commit({ ...b, grip: g }) })));
          break;
        case 'trucks':
          setText(r.value, TRUCK_LABELS[b.trucks]);
          pick(TRUCKS.map((t) => ({ el: el('div', 'pick pick--swatch', swatchThumb(TRUCK_COLORS[t]), el('span', 'pick__label', TRUCK_LABELS[t])), active: t === b.trucks, onClick: () => commit({ ...b, trucks: t }) })));
          break;
        case 'wheels':
          setText(r.value, WHEEL_LABELS[b.wheels]);
          pick(WHEELS.map((w) => ({ el: el('div', 'pick pick--swatch', swatchThumb(WHEEL_COLORS[w]), el('span', 'pick__label', WHEEL_LABELS[w])), active: w === b.wheels, onClick: () => commit({ ...b, wheels: w }) })));
          break;
        case 'stickers':
          setText(r.value, placing ? `Placing: ${stickerSheetLabel(STICKER_SHEETS[sheetIndex] as StickerSheetId)} ${stickerIndex + 1}` : `${b.stickers.length} of ${TUNING.MAX_STICKERS}  Sheet: ${stickerSheetLabel(STICKER_SHEETS[sheetIndex] as StickerSheetId)}`);
          break;
      }
    }
    renderSheet();
    renderMap();
  };

  /** The hint bar follows the focused row: confirm places stickers on the Stickers row, flips the board elsewhere. */
  let hintsFor: string | null = null;
  const renderHints = (): void => {
    const onStickers = ROWS[ctx.focus.index]?.id === 'stickers';
    const key = `${ctx.glyphs()}:${placing ? 'placing' : onStickers ? 'stickers' : 'pick'}`;
    if (key === hintsFor) return;
    hintsFor = key;
    clear(hints);
    if (placing) hints.append(ctx.hints([['move', 'Cursor'], ['confirm', 'Place'], ['action1', 'Remove'], ['tabPrev', 'Rotate'], ['tabNext', 'Sticker'], ['action2', 'Sheet'], ['back', 'Done']]));
    else if (onStickers) hints.append(ctx.hints([['adjust', 'Sheet'], ['confirm', 'Place stickers'], ['action2', 'Random'], ['back', 'Back']]));
    else hints.append(ctx.hints([['adjust', 'Pick'], ['confirm', 'Flip board'], ['action2', 'Random'], ['back', 'Back']]));
  };

  const randomise = (): void => {
    seed = nextSeed(seed + board().deckGraphic * 31 + board().stickers.length);
    const r = (n: number): number => Math.floor(((seed >>> 8) % 1000) / 1000 * n);
    seed = nextSeed(seed);
    const deckGraphic = r(DECK_GRAPHIC_NAMES.length);
    seed = nextSeed(seed);
    const grip = GRIPS[r(GRIPS.length)] as GripId;
    seed = nextSeed(seed);
    const trucks = TRUCKS[r(TRUCKS.length)] as TruckColorId;
    seed = nextSeed(seed);
    const wheels = WHEELS[r(WHEELS.length)] as WheelId;
    const stickers: StickerPlacement[] = [];
    const n = 2 + (seed % 3);
    for (let i = 0; i < n; i++) {
      seed = nextSeed(seed);
      const sheet = STICKER_SHEETS[r(STICKER_SHEETS.length)] as StickerSheetId;
      seed = nextSeed(seed);
      stickers.push({ sheet, index: r(STICKERS_PER_SHEET), u: 0.2 + (0.6 * (i + 0.5)) / n, v: 0.35 + 0.3 * ((seed % 100) / 100), rotDeg: -20 + (seed % 41) });
    }
    commit({ deckGraphic, grip, trucks, wheels, stickers });
    ctx.sound('confirm');
    renderRows();
  };

  const setPlacing = (on: boolean): void => {
    placing = on;
    if (on) {
      cursor = { x: 0.5, y: 0.5 };
      rotDeg = 0;
      showUnderside();
    }
    syncPlacement();
    renderRows();
    setItems();
    renderHints();
    // On a short window the sheet strip can sit below the fold: bring it into view for placement.
    if (on && typeof sheetBox.scrollIntoView === 'function') {
      try {
        sheetBox.scrollIntoView({ block: 'nearest' });
      } catch {
        // happy-dom: no layout, nothing to scroll.
      }
    }
  };

  const setItems = (): void => {
    const b = board();
    const items: FocusItem[] = rowEls.map((r) => ({
      el: r.el,
      onAdjust: (d) => {
        if (placing) return false;
        switch (r.id) {
          case 'graphic': commit({ ...b, deckGraphic: (b.deckGraphic + d + DECK_GRAPHIC_NAMES.length) % DECK_GRAPHIC_NAMES.length }); break;
          case 'grip': commit({ ...b, grip: cycle(GRIPS, b.grip, d) }); break;
          case 'trucks': commit({ ...b, trucks: cycle(TRUCKS, b.trucks, d) }); break;
          case 'wheels': commit({ ...b, wheels: cycle(WHEELS, b.wheels, d) }); break;
          case 'stickers': sheetIndex = (sheetIndex + d + STICKER_SHEETS.length) % STICKER_SHEETS.length; stickerIndex = 0; ctx.sound('move'); break;
        }
        const keep = ctx.focus.index;
        renderRows();
        setItems();
        ctx.focus.focus(keep);
        return true;
      },
      onConfirm: () => {
        if (r.id === 'stickers') setPlacing(true);
        else {
          // Confirm on a pick row flips the board over so the change is visible.
          flipFace();
          ctx.sound('confirm');
        }
      },
    }));
    const keep = ctx.focus.index;
    ctx.focus.setItems(items, { columns: 1, wrap: true, initial: keep });
    ctx.focus.setOnBack(() => {
      if (placing) setPlacing(false);
      else ctx.back();
    });
  };

  return {
    id: 'boardLab',
    el: root,
    enter() {
      if (host) {
        host.mount(previewBox);
      } else {
        preview = preview ?? createBoardPlaceholder();
        preview.mount(previewBox);
      }
      mounted = true;
      window.addEventListener('pointerup', onWindowPointerUp);
      placing = false;
      hintsFor = null;
      (host ?? preview)?.setConfig(board());
      renderRows();
      ctx.focus.setItems([], {});
      setItems();
      ctx.focus.focus(0);
      renderHints();
      syncPlacement();
    },
    leave() {
      window.removeEventListener('pointerup', onWindowPointerUp);
      dragging = null;
      if (mounted) {
        (host ?? preview)?.unmount();
        mounted = false;
      }
      placing = false;
      ctx.focus.clear();
    },
    refresh() {
      (host ?? preview)?.setConfig(board());
      const keep = ctx.focus.index;
      renderRows();
      setItems();
      ctx.focus.focus(keep);
      renderHints();
    },
    update(nav: NavInput, dt: number) {
      preview?.update(dt);
      // Mouse hover and pad moves both change the focused row; the hints follow it (cheap: keyed).
      renderHints();
      const h = previewHost();
      if (Math.abs(nav.lookX) > 0.01) h?.nudge(nav.lookX * TUNING.UI_TURNTABLE_STICK_DPS * dt);
      if (nav.action2 && !placing) {
        randomise();
        return true;
      }
      if (!placing) return false;
      // Placement mode owns the pad.
      const speed = TUNING.UI_STICKER_CURSOR_SPEED * dt;
      const dx = nav.cursor.x + (nav.right ? 1 : 0) - (nav.left ? 1 : 0);
      const dy = nav.cursor.y + (nav.up ? 1 : 0) - (nav.down ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        // The cursor is the provisional sticker's centre: it stops where the sticker would leave the deck.
        cursor = onDeck({ x: cursor.x + dx * speed * 0.6, y: cursor.y + dy * speed }, rotDeg);
        syncPlacement();
      }
      if (nav.tabPrev) {
        rotDeg -= TUNING.UI_STICKER_ROT_STEP_DEG;
        cursor = onDeck(cursor, rotDeg);
        syncPlacement();
      }
      if (nav.tabNext) {
        stickerIndex = (stickerIndex + 1) % STICKERS_PER_SHEET;
        renderRows();
        syncPlacement();
      }
      if (nav.action2) {
        // Next sheet without leaving placement (the tabs are also clickable).
        sheetIndex = (sheetIndex + 1) % STICKER_SHEETS.length;
        stickerIndex = 0;
        ctx.sound('move');
        renderRows();
        syncPlacement();
      }
      if (nav.action1) {
        const b = board();
        const hit = placedIndexAt(cursor) ?? (b.stickers.length > 0 ? b.stickers.length - 1 : null);
        if (hit === null) ctx.sound('error');
        else commit({ ...b, stickers: b.stickers.filter((_, i) => i !== hit) });
        renderRows();
        syncPlacement();
        return true;
      }
      if (nav.confirm) {
        const b = board();
        if (b.stickers.length >= TUNING.MAX_STICKERS) {
          ctx.sound('error');
        } else {
          commit({ ...b, stickers: [...b.stickers, provisional()] });
          ctx.sound('confirm');
        }
        renderRows();
        syncPlacement();
        return true;
      }
      if (nav.back) {
        setPlacing(false);
        ctx.sound('back');
        return true;
      }
      return true;
    },
  };
}
