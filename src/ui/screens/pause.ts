/**
 * src/ui/screens/pause.ts (ui track): Paused: the goal list with completion state, Resume, Restart run,
 * Options, Quit to menu (REQ-MNU-03). Free Skate hides the goal list. Back resumes.
 */

import type { ParkId } from '../../core/types';
import { clear, el, setClass, setGhost, setText } from '../dom';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';
import { buildGoalRows } from './goalList';
import { PARK_NAMES } from './parkSelect';

export function createPause(ctx: ScreenContext): Screen {
  const heading = el('h2', 'heading', 'Paused');
  const sub = el('div', 'subheading');
  const goalsBox = el('div', 'goals__body goals__body--pause');
  const buttons = el('div', 'buttons buttons--column');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--pause', heading, sub, goalsBox, buttons, hints);
  setGhost(panel, 'Paused');
  const root = el('section', 'screen screen--pause', panel);

  const entries: readonly { readonly label: string; readonly run: () => void }[] = [
    { label: 'Resume', run: () => ctx.actions.resume() },
    { label: 'Restart run', run: () => ctx.actions.restartRun() },
    { label: 'Options', run: () => ctx.go('options') },
    { label: 'Quit to menu', run: () => ctx.actions.quitToMenu() },
  ];
  const buttonEls = entries.map((e) => {
    const b = el('button', 'button', e.label);
    b.type = 'button';
    buttons.append(b);
    return b;
  });

  const refresh = (): void => {
    const s = ctx.state();
    const snap = ctx.snapshot();
    const level = snap?.run.levelId ?? ctx.pendingPark();
    const park: ParkId | null = level === 'marketStreet' || level === 'woodshed' ? level : null;
    const career = (snap?.run.mode ?? ctx.pendingMode()) === 'career';
    setText(sub, park ? `${PARK_NAMES[park]}  ${career ? 'Career' : 'Free Skate'}` : 'Test box');
    clear(goalsBox);
    setClass(goalsBox, 'is-hidden', !career || !park);
    if (career && park) goalsBox.append(buildGoalRows(s.goals[park], s.save.career.goals[park], snap?.run.goalsCompleted ?? []));
    clear(hints);
    hints.append(ctx.hints([['move', 'Move'], ['confirm', 'Select'], ['back', 'Resume']]));
  };

  return {
    id: 'pause',
    el: root,
    enter() {
      refresh();
      const items: FocusItem[] = buttonEls.map((b, i) => ({ el: b, onConfirm: entries[i]?.run }));
      ctx.focus.setItems(items, { columns: 1, wrap: true, initial: 0 });
      ctx.focus.setOnBack(() => ctx.actions.resume());
    },
    leave() {
      ctx.focus.clear();
    },
    refresh,
  };
}
