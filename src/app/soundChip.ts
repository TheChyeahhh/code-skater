/**
 * src/app/soundChip.ts (integration): the "Sound off" chip (REQ-INP-09 / REQ-AUD-03, polish round 1).
 * Browsers never count a gamepad press as user activation, so a player who passes the start gate with
 * a pad (or any ?autostart page) has a suspended AudioContext until they click or press a key. While
 * the engine reports `suspended`, a small persistent chip says so; it goes away the moment the context
 * runs. No em dashes in the copy (AGENTS.md).
 */

export const SOUND_CHIP_TEXT = 'Sound off: click or press any key to turn it on';

export interface SoundChip {
  readonly el: HTMLElement;
  readonly visible: boolean;
  /** Call once per frame with the engine's suspended flag (undefined = the engine cannot tell: hidden). */
  update(suspended: boolean | undefined): void;
  dispose(): void;
}

export function createSoundChip(root: HTMLElement): SoundChip {
  const el = root.ownerDocument.createElement('div');
  el.className = 'sound-chip';
  el.setAttribute('role', 'status');
  el.textContent = SOUND_CHIP_TEXT;
  el.hidden = true;
  root.append(el);
  let visible = false;
  return {
    el,
    get visible() {
      return visible;
    },
    update(suspended) {
      const next = suspended === true;
      if (next === visible) return;
      visible = next;
      el.hidden = !next;
    },
    dispose() {
      el.remove();
    },
  };
}
