/**
 * src/ui/screens/options.ts (ui track): Quality preset, music and SFX volume, rumble, Load my MP3
 * folder (file picker, never bundled), Controls (read-only table with glyphs per pad), Reset career
 * with a confirmation step (REQ-MNU-04, REQ-SAV-02, SPEC section 15 defaults). Every change goes to
 * actions.setOptions at once; the app persists it (REQ-SAV-03: menu changes, never a sim tick).
 */

import { BUTTONS, type Button, type GameOptions, type GlyphSet, type NavInput, type QualityOption } from '../../core/types';
import { clear, el, setClass, setGhost, setText } from '../dom';
import { glyphBadge } from '../glyphs';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';

const QUALITIES: readonly QualityOption[] = ['auto', 'low', 'med', 'high', 'ultra'];
const QUALITY_LABELS: Readonly<Record<QualityOption, string>> = { auto: 'Auto', low: 'Low', med: 'Medium', high: 'High', ultra: 'Ultra' };
const VOLUME_STEP = 0.05;

/** Direction-only inputs: what a pad and the keyboard use (rows without a button). */
interface DirInput {
  readonly pad: string;
  readonly keyboard: string;
}
const DIR_SEQUENCE: DirInput = { pad: 'Stick or D-pad', keyboard: 'W / S' };

/** Rows of the read-only controls table (SPEC section 5): action label, the buttons that do it, direction note. */
export const CONTROL_ROWS: readonly { readonly action: string; readonly buttons: readonly Button[]; readonly dir?: DirInput; readonly note: string }[] = [
  { action: 'Steer / spin / balance', buttons: [], dir: { pad: 'Left stick or D-pad', keyboard: 'WASD / Arrows' }, note: 'Spins in the air, balance on rails and manuals' },
  { action: 'Ollie', buttons: ['ollie'], note: 'Hold to crouch, release to pop' },
  { action: 'Flip trick', buttons: ['flip'], note: 'Plus a direction (8 ways)' },
  { action: 'Grab', buttons: ['grab'], note: 'Plus a direction, hold it' },
  { action: 'Grind / Lip', buttons: ['grind'], note: 'Near any edge' },
  // DESIGN E.9: the same button in the air over a transfer coping (Woodshed spine, vert wall) is a Spine Transfer.
  { action: 'Revert / Transfer', buttons: ['revert'], note: 'Vert landing: toggles stance. In the air over a spine or vert coping: Spine Transfer' },
  { action: 'Nollie / Fakie', buttons: ['nollie'], note: 'Hold with a flip or grab' },
  { action: 'Quick spin', buttons: ['spinL', 'spinR'], note: 'In the air' },
  { action: 'Manual', buttons: [], dir: DIR_SEQUENCE, note: 'Up then Down on landing' },
  { action: 'Nose manual', buttons: [], dir: DIR_SEQUENCE, note: 'Down then Up on landing' },
  { action: 'Camera', buttons: [], dir: { pad: 'Right stick', keyboard: 'Mouse' }, note: 'Keyboard: click the game to lock the mouse' },
  { action: 'Pause', buttons: ['pause'], note: '' },
  { action: 'Tuning panel', buttons: ['dev'], note: '' },
];

const GLYPH_SETS: readonly GlyphSet[] = ['xbox', 'playstation', 'keyboard'];
const GLYPH_SET_LABELS: Readonly<Record<GlyphSet, string>> = { xbox: 'Xbox', playstation: 'PlayStation', keyboard: 'Keyboard' };

export function buildControlsTable(set: GlyphSet): HTMLElement {
  const table = el('div', 'controls');
  for (const row of CONTROL_ROWS) {
    const cell = el('span', 'controls__buttons');
    for (const b of row.buttons) cell.append(glyphBadge(set, b));
    const dir = row.dir ?? DIR_SEQUENCE;
    if (row.buttons.length === 0) cell.append(el('span', 'controls__dir', set === 'keyboard' ? dir.keyboard : dir.pad));
    table.append(el('div', 'controls__row', el('span', 'controls__action', row.action), cell, el('span', 'controls__note', row.note)));
  }
  // Every logical button is covered above (a missing one would leave a pad action unexplained).
  const covered = new Set(CONTROL_ROWS.flatMap((r) => r.buttons));
  for (const b of BUTTONS) if (!covered.has(b)) table.append(el('div', 'controls__row', el('span', 'controls__action', b), el('span', 'controls__buttons', glyphBadge(set, b)), el('span', 'controls__note', '')));
  return table;
}

export function createOptions(ctx: ScreenContext): Screen {
  const heading = el('h2', 'heading', 'Options');
  const rows = el('div', 'options');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--wide', heading, rows, hints);
  setGhost(panel, 'Options');
  const root = el('section', 'screen screen--options', panel);

  // Hidden folder picker (REQ-MNU-04): files stay on the player's machine.
  const picker = el('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = 'audio/*';
  picker.setAttribute('webkitdirectory', '');
  picker.style.display = 'none';
  root.append(picker);

  let view: 'options' | 'controls' = 'options';
  let confirmingReset = false;
  let musicNote = '';
  let controlsSet: GlyphSet = 'xbox';
  /** Focus index of the Controls row, restored when the controls view closes. */
  let controlsRowIndex = 0;
  /** Focus index of the music folder row (a pad cannot open the browser's file chooser). */
  let folderIndex = -1;
  let folderValue: HTMLElement | null = null;
  const PICK_NOTE = 'Pick a folder';
  const PAD_PICK_NOTE = 'Click or press Enter to pick a folder';

  /**
   * The browser opens a file chooser only on a click or key press (user activation); gamepad presses
   * never count, so from a pad the row says how to pick instead of failing silently.
   */
  const padCannotPick = (): void => {
    musicNote = PAD_PICK_NOTE;
    if (folderValue) setText(folderValue, musicNote);
    ctx.sound('error');
  };
  const openPicker = (): void => {
    const activation = (navigator as Navigator & { readonly userActivation?: { readonly isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) {
      padCannotPick();
      return;
    }
    picker.click();
  };

  const opts = (): GameOptions => ctx.state().save.options;
  const set = (patch: Partial<GameOptions>): void => {
    ctx.actions.setOptions({ ...opts(), ...patch });
    ctx.sound('move');
  };

  const makeRow = (label: string, value: string, kind: 'picker' | 'slider' | 'button' | 'danger' = 'picker'): { readonly el: HTMLElement; readonly value: HTMLElement; readonly fill: HTMLElement | null } => {
    const v = el('span', 'option__value', value);
    let fill: HTMLElement | null = null;
    const controls = el('span', 'option__control');
    if (kind === 'picker') controls.append(el('span', 'option__arrow', '<'), v, el('span', 'option__arrow', '>'));
    else if (kind === 'slider') {
      fill = el('span', 'slider__fill');
      controls.append(el('span', 'option__arrow', '<'), el('span', 'slider', fill), v, el('span', 'option__arrow', '>'));
    } else controls.append(v);
    const row = el('div', `option option--${kind}`, el('span', 'option__label', label), controls);
    return { el: row, value: v, fill };
  };

  const pct = (x: number): string => `${Math.round(x * 100)}%`;

  const layout = (): void => {
    clear(rows);
    clear(hints);
    const o = opts();
    const items: FocusItem[] = [];
    if (view === 'controls') {
      const setRow = makeRow('Show glyphs for', GLYPH_SET_LABELS[controlsSet]);
      rows.append(setRow.el);
      const tableBox = el('div', 'controls__box', buildControlsTable(controlsSet));
      rows.append(tableBox);
      items.push({
        el: setRow.el,
        onAdjust: (d) => {
          const i = GLYPH_SETS.indexOf(controlsSet);
          controlsSet = GLYPH_SETS[(i + d + GLYPH_SETS.length) % GLYPH_SETS.length] as GlyphSet;
          ctx.sound('move');
          const keep = ctx.focus.index;
          layout();
          ctx.focus.focus(keep);
          return true;
        },
      });
      const backBtn = el('button', 'button', 'Back to options');
      backBtn.type = 'button';
      rows.append(el('div', 'buttons', backBtn));
      // Leaving the controls view lands back on the Controls row.
      const closeControls = (): void => {
        view = 'options';
        layout();
        ctx.focus.focus(controlsRowIndex);
      };
      items.push({ el: backBtn, onConfirm: closeControls });
      hints.append(ctx.hints([['adjust', 'Glyph set'], ['back', 'Back']]));
      ctx.focus.setItems(items, { columns: 1, wrap: true, initial: 0 });
      ctx.focus.setOnBack(closeControls);
      folderIndex = -1;
      folderValue = null;
      return;
    }

    const quality = makeRow('Quality', QUALITY_LABELS[o.quality]);
    const music = makeRow('Music volume', pct(o.musicVolume), 'slider');
    const sfx = makeRow('SFX volume', pct(o.sfxVolume), 'slider');
    const rumble = makeRow('Rumble', o.rumble ? 'On' : 'Off');
    const folder = makeRow('Load my MP3 folder', musicNote || PICK_NOTE, 'button');
    folderValue = folder.value;
    const controls = makeRow('Controls', 'View', 'button');
    const reset = makeRow('Reset career', confirmingReset ? 'Really? Goals, drives and best scores go. Board Lab and options stay.' : 'Clear all progress', 'danger');
    if (music.fill) music.fill.style.width = pct(o.musicVolume);
    if (sfx.fill) sfx.fill.style.width = pct(o.sfxVolume);
    rows.append(quality.el, music.el, sfx.el, rumble.el, folder.el, controls.el, reset.el);
    setClass(reset.el, 'is-confirming', confirmingReset);

    const cycle = <T extends string>(list: readonly T[], cur: T, d: -1 | 1): T => list[(list.indexOf(cur) + d + list.length) % list.length] as T;
    const step = (cur: number, d: -1 | 1): number => Math.round(Math.min(1, Math.max(0, cur + d * VOLUME_STEP)) / VOLUME_STEP) * VOLUME_STEP;

    items.push(
      { el: quality.el, onAdjust: (d) => { set({ quality: cycle(QUALITIES, opts().quality, d) }); setText(quality.value, QUALITY_LABELS[opts().quality]); return true; } },
      { el: music.el, onAdjust: (d) => { set({ musicVolume: step(opts().musicVolume, d) }); setText(music.value, pct(opts().musicVolume)); if (music.fill) music.fill.style.width = pct(opts().musicVolume); return true; } },
      { el: sfx.el, onAdjust: (d) => { set({ sfxVolume: step(opts().sfxVolume, d) }); setText(sfx.value, pct(opts().sfxVolume)); if (sfx.fill) sfx.fill.style.width = pct(opts().sfxVolume); return true; } },
      { el: rumble.el, onAdjust: () => { set({ rumble: !opts().rumble }); setText(rumble.value, opts().rumble ? 'On' : 'Off'); return true; }, onConfirm: () => { set({ rumble: !opts().rumble }); setText(rumble.value, opts().rumble ? 'On' : 'Off'); } },
      { el: folder.el, onConfirm: openPicker },
      { el: controls.el, onConfirm: () => { controlsRowIndex = ctx.focus.index; view = 'controls'; layout(); } },
      {
        el: reset.el,
        onConfirm: () => {
          if (!confirmingReset) {
            confirmingReset = true;
            const keep = ctx.focus.index;
            layout();
            ctx.focus.focus(keep);
          } else {
            confirmingReset = false;
            ctx.actions.resetCareer();
            ctx.sound('confirm');
            const keep = ctx.focus.index;
            layout();
            ctx.focus.focus(keep);
          }
        },
      },
    );
    folderIndex = items.findIndex((it) => it.el === folder.el);
    hints.append(ctx.hints([['adjust', 'Change'], ['confirm', 'Select'], ['back', confirmingReset ? 'Cancel' : 'Back']]));
    ctx.focus.setItems(items, { columns: 1, wrap: true, initial: Math.min(items.length - 1, ctx.focus.index) });
    ctx.focus.setOnBack(() => {
      if (confirmingReset) {
        confirmingReset = false;
        const keep = ctx.focus.index;
        layout();
        ctx.focus.focus(keep);
      } else ctx.back();
    });
    picker.onchange = () => {
      const files = picker.files ? Array.from(picker.files) : [];
      musicNote = files.length ? 'Loading' : 'No files picked';
      setText(folder.value, musicNote);
      void ctx.actions.loadMusicFolder(files).then((n) => {
        musicNote = n > 0 ? `${n} track${n === 1 ? '' : 's'} loaded` : 'No playable tracks in that folder';
        setText(folder.value, musicNote);
      }).catch(() => {
        musicNote = 'Could not read that folder';
        setText(folder.value, musicNote);
      });
    };
  };

  return {
    id: 'options',
    el: root,
    enter() {
      view = 'options';
      confirmingReset = false;
      controlsSet = ctx.glyphs();
      ctx.focus.setItems([], {});
      layout();
      ctx.focus.focus(0);
    },
    leave() {
      ctx.focus.clear();
    },
    refresh() {
      const keep = ctx.focus.index;
      layout();
      ctx.focus.focus(keep);
    },
    update(nav: NavInput) {
      if (nav.confirm && nav.source === 'gamepad' && view === 'options' && folderIndex >= 0 && ctx.focus.index === folderIndex) {
        padCannotPick();
        return true;
      }
      return false;
    },
  };
}
