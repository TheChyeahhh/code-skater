/**
 * src/ui/screens/goalList.ts (ui track): the career goal list for the chosen park with checkmarks and
 * a Start run button (H.1: Career -> park select -> goal list -> Start run). Also used as the body of
 * the pause screen (buildGoalRows), where this run's completions are marked live.
 */

import type { ParkId } from '../../core/types';
import { goalName, type GoalDef } from '../../data/goals';
import { checkIcon, clear, el, setGhost, setText } from '../dom';
import { formatScore } from '../format';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';
import { PARK_NAMES } from './parkSelect';

/** Goal rows with a check for done ids; `fresh` ids (done this run) get a highlight. */
export function buildGoalRows(goals: readonly GoalDef[], done: readonly string[], fresh: readonly string[] = []): HTMLElement {
  const list = el('ol', 'goals');
  const sorted = [...goals].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) list.append(el('li', 'goals__empty', 'Goals arrive with the park.'));
  for (const g of sorted) {
    const isDone = done.includes(g.id) || fresh.includes(g.id);
    const li = el('li', `goals__row${isDone ? ' is-done' : ''}${fresh.includes(g.id) ? ' is-fresh' : ''}`,
      el('span', 'goals__check', isDone ? checkIcon() : null),
      el('span', 'goals__index', String(g.index).padStart(2, '0')),
      el('span', 'goals__name', goalName(g)));
    list.append(li);
  }
  return list;
}

export function createGoalList(ctx: ScreenContext): Screen {
  const heading = el('h2', 'heading');
  const stats = el('div', 'subheading');
  const body = el('div', 'goals__body');
  const start = el('button', 'button button--primary', 'Start run');
  start.type = 'button';
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--wide', heading, stats, body, el('div', 'buttons', start), hints);
  const root = el('section', 'screen screen--goalList', panel);

  const refresh = (): void => {
    const s = ctx.state();
    const park: ParkId = ctx.pendingPark();
    const done = s.save.career.goals[park];
    const total = s.goals[park].length;
    setText(heading, PARK_NAMES[park]);
    setGhost(panel, PARK_NAMES[park]);
    setText(stats, `${done.length}${total > 0 ? ` of ${total}` : ''} goals done.  Best score ${formatScore(s.save.career.bestScores[park])}.  Best combo ${formatScore(s.save.career.bestCombos[park])}.`);
    clear(body);
    body.append(buildGoalRows(s.goals[park], done));
    clear(hints);
    hints.append(ctx.hints([['confirm', 'Start'], ['back', 'Back']]));
  };

  return {
    id: 'goalList',
    el: root,
    enter() {
      refresh();
      const items: FocusItem[] = [{ el: start, onConfirm: () => ctx.actions.startRun(ctx.pendingPark(), 'career') }];
      ctx.focus.setItems(items, { columns: 1, wrap: true, initial: 0 });
      ctx.focus.setOnBack(() => ctx.back());
    },
    leave() {
      ctx.focus.clear();
    },
    refresh,
  };
}
