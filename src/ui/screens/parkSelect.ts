/**
 * src/ui/screens/parkSelect.ts (ui track): Market Street and Woodshed cards. Woodshed is locked until
 * UNLOCK_WOODSHED_GOALS Street goals are done (REQ-GOL-03). Career -> goal list; Free Skate -> run.
 */

import { TUNING } from '../../core/tuning';
import type { ParkId } from '../../core/types';
import { PARKS } from '../../data/goals';
import { clear, el, setClass, setGhost, setText } from '../dom';
import { formatScore } from '../format';
import { parkArtDataUrl } from '../labArt';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';

export const PARK_NAMES: Readonly<Record<ParkId, string>> = { marketStreet: 'Market Street', woodshed: 'Woodshed', labCampus: 'Lab Campus' };
const PARK_BLURB: Readonly<Record<ParkId, string>> = {
  marketStreet: 'Downtown. Marble ledges, stair rails, scaffold pipes, a fountain that skates like a bowl.',
  woodshed: 'Indoor wood park. Rainbow rails, bowls, a full pipe and a spine down the middle.',
  labCampus: 'A research campus after dark. Server-rack ledges, a reflecting pool, neon and glass.',
};

export function createParkSelect(ctx: ScreenContext): Screen {
  const heading = el('h2', 'heading', 'Pick a park');
  const mode = el('div', 'subheading');
  const cards = el('div', 'cards');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--wide', heading, mode, cards, hints);
  setGhost(panel, 'Parks');
  const root = el('section', 'screen screen--parkSelect', panel);

  interface Card {
    readonly park: ParkId;
    readonly el: HTMLElement;
    readonly best: HTMLElement;
    readonly goals: HTMLElement;
    readonly lock: HTMLElement;
  }
  const cardEls: Card[] = PARKS.map((park) => {
    const best = el('div', 'card__stat');
    const goals = el('div', 'card__stat');
    const lock = el('div', 'card__lock');
    const art = el('div', `card__art card__art--${park}`);
    // Procedural silhouette of the park (labArt); the CSS stripe pattern stays as the no-canvas fallback.
    const artUrl = parkArtDataUrl(park);
    if (artUrl) art.style.backgroundImage = `url(${artUrl})`;
    const c = el('div', `card card--${park}`, art, el('div', 'card__name', PARK_NAMES[park]), el('div', 'card__blurb', PARK_BLURB[park]), best, goals, lock);
    cards.append(c);
    return { park, el: c, best, goals, lock };
  });

  const refresh = (): void => {
    const s = ctx.state();
    const m = ctx.pendingMode();
    setText(mode, m === 'career' ? 'Career: ten goals a park' : 'Free Skate: no clock, no goals');
    for (const c of cardEls) {
      const career = s.save.career;
      const total = s.goals[c.park].length;
      const done = career.goals[c.park].length;
      setText(c.best, `Best ${formatScore(career.bestScores[c.park])}`);
      setText(c.goals, total > 0 ? `Goals ${done} of ${total}` : `Goals ${done}`);
      // Founder 2026-09-23: Free Skate opens every park; only Career keeps the Woodshed unlock.
      // Lab Campus (2026-09-23) opens in Career with the Woodshed.
      const locked = m === 'career' && c.park !== 'marketStreet' && !career.woodshedUnlocked;
      setClass(c.el, 'is-locked', locked);
      setText(c.lock, locked ? `Locked: ${TUNING.UNLOCK_WOODSHED_GOALS} of 10 Street goals` : '');
    }
    clear(hints);
    hints.append(ctx.hints([['adjust', 'Pick'], ['confirm', 'Go'], ['back', 'Back']]));
  };

  return {
    id: 'parkSelect',
    el: root,
    enter() {
      refresh();
      const s = ctx.state();
      const items: FocusItem[] = cardEls.map((c) => ({
        el: c.el,
        disabled: ctx.pendingMode() === 'career' && c.park !== 'marketStreet' && !s.save.career.woodshedUnlocked,
        onConfirm: () => {
          ctx.setPendingPark(c.park);
          if (ctx.pendingMode() === 'career') ctx.go('goalList');
          else ctx.actions.startRun(c.park, 'free');
        },
      }));
      const initial = Math.max(0, cardEls.findIndex((c) => c.park === ctx.pendingPark()));
      ctx.focus.setItems(items, { columns: cardEls.length, wrap: true, initial });
      ctx.focus.setOnBack(() => ctx.back());
    },
    leave() {
      ctx.focus.clear();
    },
    refresh,
  };
}
