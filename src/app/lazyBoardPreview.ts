/**
 * src/app/lazyBoardPreview.ts (integration): a BoardPreviewHost the UI can hold from the first frame,
 * forwarding to the skater track's real 3D turntable (createBoardPreview) once the game chunk has
 * loaded. Until then it remembers the last call of each kind and replays them on attach, so the Board
 * Lab never waits on three.js to open (REQ-MNU-05: menus paint before the game chunk arrives).
 */

import type { BoardConfig, StickerPlacement, Vec2 } from '../core/types';
import type { BoardPreviewHost } from '../render/types';

export interface LazyBoardPreview extends BoardPreviewHost {
  attach(real: BoardPreviewHost): void;
}

export function createLazyBoardPreview(initial: BoardConfig): LazyBoardPreview {
  let real: BoardPreviewHost | null = null;
  let container: HTMLElement | null = null;
  let config = initial;
  let cursor: Vec2 | null = null;
  let sticker: StickerPlacement | null = null;
  let flips = 0;
  let yaw = 0;

  return {
    attach(host) {
      real = host;
      host.setConfig(config);
      if (container) host.mount(container);
      host.setCursor(cursor);
      host.setPreviewSticker(sticker);
      for (let i = 0; i < flips % 2; i++) host.flip();
      if (yaw !== 0) host.nudge(yaw);
    },
    mount(el) {
      container = el;
      real?.mount(el);
    },
    setConfig(c) {
      config = c;
      real?.setConfig(c);
    },
    nudge(d) {
      if (real) real.nudge(d);
      else yaw += d;
    },
    flip() {
      if (real) real.flip();
      else flips += 1;
    },
    setCursor(uv) {
      cursor = uv;
      real?.setCursor(uv);
    },
    setPreviewSticker(s) {
      sticker = s;
      real?.setPreviewSticker(s);
    },
    unmount() {
      container = null;
      real?.unmount();
    },
  };
}
