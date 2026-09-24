/**
 * src/ui/screens/credits.ts (ui track): plain-text credits (H.1). Brand names come from the brand table.
 */

import { BRANDS } from '../../data/brands';
import { clear, el, setGhost } from '../dom';
import type { Screen, ScreenContext } from './context';

export function createCredits(ctx: ScreenContext): Screen {
  const body = el('div', 'credits');
  const hints = el('div', 'menu__hints');
  const panel = el('div', 'panel', el('h2', 'heading', 'Credits'), body, hints);
  setGhost(panel, 'Credits');
  const root = el('section', 'screen screen--credits', panel);

  const refresh = (): void => {
    const s = ctx.state();
    clear(body);
    const lines: readonly (readonly [string, string])[] = [
      ['Design, code, art, sound', 'Everything in this build is generated in code. No downloaded assets, no fonts fetched.'],
      ['Built with', 'TypeScript, Vite, three.js, postprocessing, three-mesh-bvh, Web Audio.'],
      ['Sponsors', `${BRANDS.companies.labA.name}, ${BRANDS.companies.labB.name} and ${BRANDS.companies.chip.name} are fictional labs in this ${s.brandMode} build.`],
      ['People', 'Sam and Dario are cartoon figures built from boxes. No real person is depicted.'],
      ['Lineage', 'A tribute to the arcade skate games of the late nineties. Not affiliated with any of them.'],
      ['Version', s.version],
    ];
    for (const [k, v] of lines) body.append(el('div', 'credits__row', el('span', 'credits__key', k), el('span', 'credits__value', v)));
    clear(hints);
    hints.append(ctx.hints([['back', 'Back']]));
  };

  return {
    id: 'credits',
    el: root,
    enter() {
      refresh();
      ctx.focus.setItems([], { columns: 1 });
      ctx.focus.setOnBack(() => ctx.back());
    },
    leave() {
      ctx.focus.clear();
    },
    refresh,
  };
}
