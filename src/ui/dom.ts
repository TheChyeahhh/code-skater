/**
 * src/ui/dom.ts (ui track): tiny DOM helpers so screens read as markup, not boilerplate.
 */

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: readonly Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Set textContent only when it changed (no layout thrash per frame, REQ-HUD-02 note). */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setClass(node: HTMLElement, className: string, on: boolean): void {
  if (node.classList.contains(className) !== on) node.classList.toggle(className, on);
}

export function setStyle(node: HTMLElement, prop: string, value: string): void {
  if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value);
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A 16px check mark (goal lists, results): a drawn tick, never the word OK, which is a land grade. */
export function checkIcon(): SVGSVGElement {
  return svgIcon('0 0 24 24', '<path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>', 'check');
}

/** The panel's ghost heading (styles.css .panel::after reads data-ghost). */
export function setGhost(panel: HTMLElement, text: string): void {
  if (panel.getAttribute('data-ghost') !== text) panel.setAttribute('data-ghost', text);
}

export function svgIcon(viewBox: string, inner: string, className = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  svg.innerHTML = inner;
  return svg;
}
