import type { Layout } from './optimizer';
import { detectLanguage, directionFor, segmentText, hasArabic } from './language';
import type { DirectionPolicy } from './language';
export const cssRem = (pixels: number) => `${pixels / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`;
export function annotateParagraph(p: HTMLElement, text: string, direction: DirectionPolicy) {
  p.lang = detectLanguage(text);
  p.dir = directionFor(text, direction);
  p.classList.toggle('cursive-text', hasArabic(text));
}
export function renderOptimized(target: HTMLElement, layouts: Layout[], source: string[], baseline: Layout[],
  direction: DirectionPolicy, inspection: boolean, inspect: (p: number, l: number) => void) {
  const fragment = document.createDocumentFragment();
  layouts.forEach((layout, pIndex) => {
    const p = document.createElement('p');
    p.className = 'composed-paragraph';
    annotateParagraph(p, source[pIndex], direction);
    const { units, separator } = segmentText(source[pIndex]);
    layout.lines.forEach((line, lineIndex) => {
      const element = document.createElement('span');
      element.className = `composed-line${line.overflow ? ' overflowing' : ''}`;
      element.style.letterSpacing = `${line.tracking}em`;
      element.style.setProperty('--line-width', cssRem(line.width));
      element.dataset.paragraph = String(pIndex);
      element.dataset.line = String(lineIndex);
      element.tabIndex = inspection ? 0 : -1;
      const text = document.createElement('span');
      text.className = 'line-text';
      for (let i = line.start; i < line.end; i++) {
        if (i > line.start) text.append(separator);
        const original = baseline[pIndex]?.lines.findIndex(l => i >= l.start && i < l.end);
        const span = document.createElement('span');
        span.textContent = i === line.end - 1 ? units[i].trimEnd() : units[i];
        if (original !== lineIndex) span.className = 'moved-word';
        text.append(span);
      }
      element.append(text);
      // Native copy: preserve source separators inside inline boxes, not block
      // wrappers or fake linebreaks. Japanese boundaries usually have no space.
      if (lineIndex < layout.lines.length - 1) {
        element.append(separator || (/\s$/u.test(units[line.end - 1]) ? ' ' : ''));
      }
      const guide = document.createElement('span');
      guide.className = 'line-guide'; guide.setAttribute('aria-hidden', 'true');
      element.append(guide);
      const show = () => inspect(pIndex, lineIndex);
      element.addEventListener('pointerenter', show);
      element.addEventListener('focus', show);
      element.addEventListener('click', () => {
        const input = document.querySelector<HTMLInputElement>('#inspect')!;
        if (!input.checked) input.click();
        show();
      });
      p.append(element);
    });
    fragment.append(p);
  });
  target.replaceChildren(fragment);
}
export function renderBaselineGuides(target: HTMLElement, layouts: Layout[], size: number) {
  target.querySelectorAll('.baseline-guides').forEach(el => el.remove());
  target.querySelectorAll('p').forEach((p, pIndex) => {
    const guides = document.createElement('span');
    guides.className = 'baseline-guides'; guides.setAttribute('aria-hidden', 'true');
    layouts[pIndex].lines.forEach((line, index) => {
      const guide = document.createElement('span'); guide.className = 'line-guide';
      guide.style.setProperty('--line-width', cssRem(line.width));
      guide.style.top = cssRem(index * size * 1.55);
      guides.append(guide);
    });
    p.append(guides);
  });
}
