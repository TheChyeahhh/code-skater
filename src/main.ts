/**
 * src/main.ts (integration): the tiny entry chunk. It paints the start gate (REQ-INP-09), and inside
 * the user gesture creates and resumes the AudioContext (REQ-AUD-03), then dynamic-imports the game
 * (src/app/boot.ts), which pulls in the vendor chunk (three, postprocessing, n8ao, three-mesh-bvh).
 * Nothing heavy is imported statically here, so the first paint stays small (REQ-DEP-03).
 *
 * "?autostart" skips the gate (screenshots, harness runs); audio then waits for a real gesture.
 */

import './styles/base.css';
import { mountStartGate } from './ui/startGate';

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el as T;
}

const canvas = requireElement<HTMLCanvasElement>('game');
const uiRoot = requireElement<HTMLDivElement>('ui-root');

function createAudioContext(): AudioContext | null {
  try {
    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

function showStatus(text: string, error = false): HTMLElement {
  const el = document.createElement('div');
  el.className = error ? 'boot-status boot-status--error' : 'boot-status';
  el.textContent = text;
  uiRoot.append(el);
  return el;
}

async function start(audioContext: AudioContext | null): Promise<void> {
  const status = showStatus('Loading');
  try {
    const { boot } = await import('./app/boot');
    await boot({ canvas, uiRoot, audioContext });
    status.remove();
  } catch (err) {
    status.remove();
    showStatus('Could not start. Reload the page to try again.', true);
    console.error('Code Skater failed to boot', err);
  }
}

/**
 * The game plays with a keyboard or a controller only, so a phone or tablet (no mouse or trackpad)
 * is told so on first paint instead of reaching a run it cannot move in.
 */
function warnIfTouchOnly(): void {
  if (window.matchMedia('(any-pointer: fine)').matches) return;
  const note = document.createElement('div');
  note.className = 'phone-warning';
  note.setAttribute('role', 'alert');
  const text = document.createElement('p');
  const lead = document.createElement('strong');
  lead.textContent = 'Code Skater needs a computer.';
  text.append(lead, ' Play with a keyboard or a game controller. Phones and tablets are not supported yet.');
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'OK';
  ok.addEventListener('click', () => note.remove());
  // A tap on the notice must not also count as the start gate's "press any button".
  note.addEventListener('pointerdown', (e) => e.stopPropagation());
  note.append(text, ok);
  document.body.append(note);
}

warnIfTouchOnly();

if (new URLSearchParams(window.location.search).has('autostart')) {
  void start(null);
} else {
  mountStartGate(uiRoot, {
    title: 'Code Skater',
    tagline: 'Compile the line. Fetch the drive.',
    onStart: () => {
      void start(createAudioContext());
    },
  });
}
