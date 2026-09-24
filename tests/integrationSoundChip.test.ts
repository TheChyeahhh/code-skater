// @vitest-environment happy-dom
// tests/integrationSoundChip.test.ts (integration): the "Sound off" chip shows while the audio engine
// reports a suspended context (a pad-only start: browsers never count pad presses as activation) and
// goes away once it runs; an engine that cannot tell never shows it. Copy has no em dash.
import { describe, expect, it } from 'vitest';
import { createSoundChip, SOUND_CHIP_TEXT } from '../src/app/soundChip';

describe('sound chip (REQ-AUD-03, polish round 1)', () => {
  it('shows while suspended, hides once running, stays hidden when the engine cannot tell', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const chip = createSoundChip(root);
    expect(root.querySelector('.sound-chip')).toBe(chip.el);
    expect(chip.el.hidden).toBe(true);
    chip.update(true);
    expect(chip.visible).toBe(true);
    expect(chip.el.hidden).toBe(false);
    expect(chip.el.textContent).toBe(SOUND_CHIP_TEXT);
    chip.update(false);
    expect(chip.el.hidden).toBe(true);
    chip.update(undefined);
    expect(chip.el.hidden).toBe(true);
    expect(SOUND_CHIP_TEXT).not.toMatch(/—/);
    chip.dispose();
    expect(root.querySelector('.sound-chip')).toBeNull();
  });
});
