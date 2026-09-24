/**
 * src/ui/startGate.ts (ui track): the "Press any button to start" gate (REQ-INP-09, REQ-AUD-03).
 * It paints before the game chunk loads, so it must stay tiny: no imports but types, no three.js,
 * no other UI modules. src/main.ts mounts it and, inside the gesture callback, creates and resumes
 * the AudioContext and starts loading the game.
 * M0 version: plain, working, keyboard / pointer / gamepad; the ui track may restyle it, but must
 * keep the prompt text "Press any button to start" and the class names start-gate /
 * start-gate__prompt: e2e/smoke.spec.ts and tests/integrationDom.test.ts depend on them. The gate's
 * CSS lives in src/styles/base.css (integration): ask for CSS changes under requests.
 * Copy: no em dashes (AGENTS.md).
 */

export type StartSource = 'pointer' | 'keyboard' | 'gamepad';

export interface StartGateOptions {
  readonly title: string;
  readonly tagline: string;
  /** Called once, synchronously inside the user gesture (pointer / key) or on a gamepad press. */
  readonly onStart: (source: StartSource) => void;
}

/** Mount the gate into root; returns an unmount function. */
export function mountStartGate(root: HTMLElement, options: StartGateOptions): () => void {
  const gate = document.createElement('div');
  gate.className = 'start-gate';
  gate.setAttribute('role', 'button');
  gate.setAttribute('tabindex', '0');
  const title = document.createElement('h1');
  title.textContent = options.title;
  const tagline = document.createElement('p');
  tagline.className = 'start-gate__tagline';
  tagline.textContent = options.tagline;
  const prompt = document.createElement('p');
  prompt.className = 'start-gate__prompt';
  prompt.textContent = 'Press any button to start';
  gate.append(title, tagline, prompt);
  root.append(gate);
  gate.focus();

  let done = false;
  let raf = 0;
  const finish = (source: StartSource): void => {
    if (done) return;
    done = true;
    cleanup();
    options.onStart(source);
  };
  const onPointer = (): void => finish('pointer');
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    finish('keyboard');
  };
  const pollPads = (): void => {
    if (done) return;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (pad && pad.buttons.some((b) => b.pressed)) {
        finish('gamepad');
        return;
      }
    }
    raf = requestAnimationFrame(pollPads);
  };
  const cleanup = (): void => {
    window.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf);
    gate.remove();
  };
  window.addEventListener('pointerdown', onPointer);
  window.addEventListener('keydown', onKey);
  raf = requestAnimationFrame(pollPads);
  return () => {
    done = true;
    cleanup();
  };
}
