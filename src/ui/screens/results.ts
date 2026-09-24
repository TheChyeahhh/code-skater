/**
 * src/ui/screens/results.ts (ui track): the results card (REQ-GOL-07, REQ-MNU-06): score, best combo,
 * goals completed this run, nearest uncompleted goal with distance, letters, unlock lines, Retry
 * (one press), Park select, Main menu.
 */

import { TUNING } from '../../core/tuning';
import { LETTERS } from '../../core/types';
import { checkIcon, clear, el, setClass, setGhost, setText } from '../dom';
import { formatScore } from '../format';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';
import { PARK_NAMES } from './parkSelect';

export function createResults(ctx: ScreenContext): Screen {
  const heading = el('h2', 'heading', 'Run over');
  const park = el('div', 'subheading');
  const scoreValue = el('div', 'results__score', '0');
  const combo = el('div', 'results__stat');
  const goalsBox = el('div', 'results__goals');
  const next = el('div', 'results__next');
  const letters = el('div', 'results__letters');
  const unlocks = el('div', 'results__unlocks');
  const buttons = el('div', 'buttons');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--wide', heading, park, el('div', 'results__grid',
    el('div', 'results__main', el('div', 'results__label', 'Score'), scoreValue, combo, letters),
    el('div', 'results__side', goalsBox, next, unlocks)), buttons, hints);
  setGhost(panel, 'Run over');
  const root = el('section', 'screen screen--results', panel);

  const entries: readonly { readonly label: string; readonly run: () => void }[] = [
    { label: 'Retry', run: () => ctx.actions.restartRun() },
    { label: 'Park select', run: () => { ctx.actions.quitToMenu(); ctx.go('parkSelect'); } },
    { label: 'Main menu', run: () => { ctx.actions.quitToMenu(); ctx.go('mainMenu'); } },
  ];
  const buttonEls = entries.map((e) => {
    const b = el('button', `button${e.label === 'Retry' ? ' button--primary' : ''}`, e.label);
    b.type = 'button';
    buttons.append(b);
    return b;
  });

  let countLeft = 0;
  let target = 0;

  const refresh = (): void => {
    const r = ctx.results();
    clear(goalsBox);
    clear(letters);
    clear(unlocks);
    clear(hints);
    hints.append(ctx.hints([['confirm', 'Select'], ['back', 'Main menu']]));
    if (!r) {
      setText(park, '');
      return;
    }
    const name = r.levelId === 'marketStreet' || r.levelId === 'woodshed' ? PARK_NAMES[r.levelId] : 'Test box';
    setText(park, `${name}  ${r.mode === 'career' ? 'Career' : 'Free Skate'}`);
    target = r.score;
    countLeft = TUNING.UI_RESULTS_COUNT_S;
    setText(scoreValue, countLeft > 0 ? '0' : formatScore(target));
    setText(combo, `Best combo ${formatScore(r.bestCombo)}`);
    for (const l of LETTERS) letters.append(el('span', `letter${r.letters.includes(l) ? ' is-got' : ''}`, l));
    goalsBox.append(el('div', 'results__label', r.mode === 'career' ? 'Goals this run' : 'Free Skate'));
    if (r.mode === 'career') {
      if (r.goalsCompleted.length === 0) goalsBox.append(el('div', 'results__line results__line--dim', 'No new goals'));
      for (const g of r.goalsCompleted) goalsBox.append(el('div', 'results__line results__line--done', checkIcon(), g.name));
    }
    setClass(next, 'is-hidden', !r.nextGoal || r.mode !== 'career');
    clear(next);
    if (r.nextGoal && r.mode === 'career') next.append(el('div', 'results__label', 'Next up'), el('div', 'results__line', r.nextGoal.name), el('div', 'results__line results__line--dim', r.nextGoal.distance));
    for (const u of r.unlocks) unlocks.append(el('div', 'results__unlock', u));
  };

  return {
    id: 'results',
    el: root,
    enter() {
      refresh();
      const items: FocusItem[] = buttonEls.map((b, i) => ({ el: b, onConfirm: entries[i]?.run }));
      ctx.focus.setItems(items, { columns: items.length, wrap: true, initial: 0 });
      ctx.focus.setOnBack(() => entries[2]?.run());
    },
    leave() {
      ctx.focus.clear();
    },
    refresh,
    update(_nav, dt) {
      if (countLeft > 0) {
        countLeft = Math.max(0, countLeft - dt);
        const total = Math.max(1e-6, TUNING.UI_RESULTS_COUNT_S);
        const t = 1 - countLeft / total;
        setText(scoreValue, formatScore(target * (1 - (1 - t) * (1 - t))));
      }
      return false;
    },
  };
}
