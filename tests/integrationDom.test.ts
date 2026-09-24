// @vitest-environment happy-dom
// tests/integrationDom.test.ts (integration): proves the DOM test environment works for the suites
// that need one (tests/ui*.test.ts, tests/hud*.test.ts put the same first line; ARCHITECTURE.md §10),
// and pins the start gate's text and class names that e2e/smoke.spec.ts depends on.
import { afterEach, describe, expect, it } from 'vitest';
import { mountStartGate, type StartSource } from '../src/ui/startGate';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DOM test environment (happy-dom)', () => {
  it('has a document, elements and events', () => {
    const el = document.createElement('div');
    el.textContent = 'ok';
    document.body.append(el);
    expect(document.body.textContent).toBe('ok');
    let clicked = 0;
    el.addEventListener('click', () => (clicked += 1));
    el.click();
    expect(clicked).toBe(1);
  });
});

describe('start gate (e2e contract)', () => {
  it('shows the prompt with the class names the e2e smoke test uses', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const unmount = mountStartGate(root, { title: 'Code Skater', tagline: 'Compile the line. Fetch the drive.', onStart: () => undefined });
    expect(root.querySelector('.start-gate')).not.toBeNull();
    expect(root.querySelector('.start-gate__prompt')?.textContent).toBe('Press any button to start');
    expect(root.textContent).not.toContain('—');
    unmount();
    expect(root.querySelector('.start-gate')).toBeNull();
  });

  it('a key press starts once and removes the gate', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const starts: StartSource[] = [];
    mountStartGate(root, { title: 'Code Skater', tagline: 't', onStart: (s) => starts.push(s) });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(starts).toEqual(['keyboard']);
    expect(root.querySelector('.start-gate')).toBeNull();
  });
});
