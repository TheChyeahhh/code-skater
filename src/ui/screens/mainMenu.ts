/**
 * src/ui/screens/mainMenu.ts (ui track): Title, Career, Free Skate, Board Lab, Options, Credits and the
 * Lab Circuit stamp (REQ-MNU-01, H.1). The park flythrough renders behind #ui-root (app); this screen
 * is a translucent column on the left so the park shows through.
 */

import { clear, el, setClass, setText } from '../dom';
import type { FocusItem } from '../types';
import type { Screen, ScreenContext } from './context';

export function createMainMenu(ctx: ScreenContext): Screen {
  const title = el('h1', 'title', el('span', 'title__line', 'Code'), el('span', 'title__line title__line--b', 'Skater'));
  const tagline = el('p', 'tagline', 'Compile the line. Fetch the drive.');
  const list = el('ul', 'menu');
  const stamp = el('div', 'stamp', el('span', 'stamp__line', 'Lab'), el('span', 'stamp__line', 'Circuit'), el('span', 'stamp__sub', 'both drives fetched'));
  const footer = el('div', 'menu__footer');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel panel--menu', title, tagline, list, hints, footer);
  const root = el('section', 'screen screen--mainMenu', panel, stamp);

  const entries: readonly { readonly label: string; readonly sub: string; readonly run: () => void }[] = [
    { label: 'Career', sub: 'Ten goals a park, two minutes a run', run: () => { ctx.setPendingMode('career'); ctx.go('parkSelect'); } },
    { label: 'Free Skate', sub: 'No goals, just the line', run: () => { ctx.setPendingMode('free'); ctx.go('parkSelect'); } },
    { label: 'Board Lab', sub: 'Graphic, grip, trucks, wheels, stickers', run: () => ctx.go('boardLab') },
    { label: 'Options', sub: 'Quality, sound, controls', run: () => ctx.go('options') },
    { label: 'Credits', sub: '', run: () => ctx.go('credits') },
  ];

  const rows = entries.map((e) => {
    const li = el('li', 'menu__item', el('span', 'menu__label', e.label), e.sub ? el('span', 'menu__sub', e.sub) : null);
    li.setAttribute('role', 'menuitem');
    list.append(li);
    return li;
  });

  const refresh = (): void => {
    const s = ctx.state();
    setClass(stamp, 'is-visible', s.save.career.labCircuitStamp);
    setText(footer, `${s.version}  ${s.brandMode} build`);
    clear(hints);
    hints.append(ctx.hints([['move', 'Move'], ['confirm', 'Select']]));
  };

  return {
    id: 'mainMenu',
    el: root,
    enter() {
      refresh();
      const items: FocusItem[] = rows.map((row, i) => ({ el: row, onConfirm: entries[i]?.run }));
      ctx.focus.setItems(items, { columns: 1, wrap: true, initial: 0 });
      ctx.focus.setOnBack(null);
    },
    leave() {
      ctx.focus.clear();
    },
    refresh,
  };
}
