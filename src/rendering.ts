import type { Layout } from './optimizer';
import { detectLanguage, directionFor, segmentText, hasArabic } from './language';
import type { DirectionPolicy, Hyphenation } from './language';
import { placeKashida, splitAtSite, TATWEEL } from './kashida';

/**
 * Root font size is read once per render instead of once per line: calling
 * `getComputedStyle` inside a per-line loop forces style recalculation for every
 * line and dominates DOM commit time on long documents.
 */
export function remScale(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
export const cssRem = (pixels: number, root = remScale()) => `${pixels / root}rem`;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
));

export function annotateParagraph(p: HTMLElement, text: string, direction: DirectionPolicy) {
  p.lang = detectLanguage(text);
  p.dir = directionFor(text, direction);
  p.classList.toggle('cursive-text', hasArabic(text));
}

export interface RenderOptions {
  direction: DirectionPolicy;
  inspection?: boolean;
  /** Per-word spans + `moved-word` classes. Off unless highlighting is on. */
  highlightMoves?: boolean;
  /** Reserved height per paragraph, in CSS pixels, from the native layout. */
  reservePixels?: (number | undefined)[];
  /** Reserved column height, in CSS pixels, so the card cannot change size. */
  reserveHeight?: number;
  onInspect?: (paragraph: number, line: number) => void;
  /** Base letter-spacing in em; line tracking is relative to it. Not for Arabic. */
  letterSpacing?: number;
  /** The hyphenation points the composition used, so words split identically. */
  hyphenation?: Hyphenation;
}

/**
 * A word with its tatweels as a separate, unselectable span: the letters stay
 * joined across it (research/SPIKES.md) and native copy returns the original word.
 */
export function kashidaHtml(word: string, count: number): string {
  const [before, after] = splitAtSite(word);
  return `${escapeHtml(before)}<span class="kashida" aria-hidden="true">${TATWEEL.repeat(count)}</span>${escapeHtml(after)}`;
}

/**
 * Render the composed lines as real, selectable text. One inline-block per line
 * forces the chosen breaks; the words inside a line stay plain text unless
 * "highlight moved words" asks for per-word spans.
 *
 * The whole column is written with one `innerHTML` assignment: for a 40-paragraph
 * post that is one parse instead of ~4,000 `createElement` calls, and a single
 * delegated listener set replaces three listeners per line.
 */
export function renderOptimized(target: HTMLElement, layouts: Layout[], source: string[],
  baseline: Layout[], options: RenderOptions) {
  const { direction, inspection = false, highlightMoves = false } = options;
  const root = remScale();
  const highlight = highlightMoves;
  const paragraphs: string[] = [];
  layouts.forEach((layout, pIndex) => {
    const text = source[pIndex] ?? '';
    const { units, separator, joins } = segmentText(text, options.hyphenation);
    const lang = detectLanguage(text);
    const dir = directionFor(text, direction);
    const base = hasArabic(text) ? 0 : options.letterSpacing ?? 0;
    // One pass over the baseline instead of a linear scan per word.
    // The baseline counts whole words; hyphenation may split them into pieces.
    const wordLine = highlight ? new Int32Array(units.length).fill(-1) : undefined;
    if (wordLine) {
      baseline[pIndex]?.lines.forEach((line, lineIndex) => {
        for (let i = line.start; i < line.end && i < wordLine.length; i++) wordLine[i] = lineIndex;
      });
    }
    const wordOf = new Int32Array(units.length);
    for (let i = 1; i < units.length; i++) wordOf[i] = wordOf[i - 1] + (joins[i - 1] || !separator ? 1 : 0);
    const lines: string[] = [];
    layout.lines.forEach((line, lineIndex) => {
      let inner = '';
      const tatweels = line.kashida ? placeKashida(units.slice(line.start, line.end), line.kashida) : undefined;
      for (let i = line.start; i < line.end; i++) {
        const unit = i === line.end - 1 ? units[i].trimEnd() : units[i];
        if (i > line.start) inner += escapeHtml(joins[i - 1]);
        const word = tatweels?.[i - line.start] ? kashidaHtml(unit, tatweels[i - line.start]) : escapeHtml(unit);
        if (highlight) {
          const moved = wordLine![wordOf[i]] !== lineIndex ? ' class="moved-word"' : '';
          inner += `<span${moved}>${word}</span>`;
        } else {
          inner += word;
        }
      }
      // Native copy: preserve source separators inside inline boxes, not block
      // wrappers or fake linebreaks. Japanese boundaries usually have no space.
      // The separator sits outside `.line-text`, which measures ink only.
      // A hyphenated line ends inside a word: no separator, and a drawn hyphen
      // (generated content, so copying rejoins the word).
      if (line.hyphen) inner += '<span class="hyphen" aria-hidden="true"></span>';
      const trailing = lineIndex < layout.lines.length - 1
        ? escapeHtml(separator ? joins[line.end - 1] ?? '' : /\s$/u.test(units[line.end - 1] ?? '') ? ' ' : '')
        : '';
      lines.push(`<span class="composed-line${line.overflow ? ' overflowing' : ''}"`
        + ` style="letter-spacing:${base + line.tracking}em;${line.stretch !== 100 ? `font-stretch:${line.stretch}%;` : ''}--line-width:${cssRem(line.width, root)}"`
        + ` data-paragraph="${pIndex}" data-line="${lineIndex}"`
        + `${inspection ? ' tabindex="0"' : ' tabindex="-1"'}>`
        + `<span class="line-text"${line.wordSpacing ? ` style="word-spacing:${line.wordSpacing}em"` : ''}>${inner}</span>${trailing}</span>`);
    });
    const reserve = options.reservePixels?.[pIndex];
    const style = reserve ? ` style="min-height:${reserve.toFixed(2)}px"` : '';
    paragraphs.push(`<p class="composed-paragraph" lang="${lang}" dir="${dir}"${style}>${lines.join('')}</p>`);
  });
  target.innerHTML = paragraphs.join('');
  if (options.reserveHeight) target.style.minHeight = `${options.reserveHeight.toFixed(2)}px`;
  else target.style.removeProperty('min-height');
}

export function renderBaselineGuides(target: HTMLElement, layouts: Layout[], size: number) {
  const root = remScale();
  target.querySelectorAll('.baseline-guides').forEach(el => el.remove());
  target.querySelectorAll('p').forEach((p, pIndex) => {
    const lines = layouts[pIndex]?.lines ?? [];
    const marks = lines.map((line, index) => '<span class="line-guide" aria-hidden="true"'
      + ` style="--line-width:${cssRem(line.width, root)};top:${cssRem(index * size * 1.55, root)}"></span>`).join('');
    const guides = document.createElement('span');
    guides.className = 'baseline-guides';
    guides.setAttribute('aria-hidden', 'true');
    guides.innerHTML = marks;
    p.append(guides);
  });
}

/**
 * Delegated inspection events, installed once per column. `pointerover` and
 * `focusin` bubble; per-line listeners did not.
 */
export function bindInspection(target: HTMLElement, onInspect: (paragraph: number, line: number) => void) {
  const marker = '__unjustifiedInspection';
  const host = target as HTMLElement & { [key: string]: unknown };
  if (host[marker]) return;
  host[marker] = true;
  const find = (event: Event) => {
    const element = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.composed-line');
    if (!element || !target.contains(element)) return;
    const paragraph = Number(element.dataset.paragraph);
    if (Number.isNaN(paragraph)) return;
    onInspect(paragraph, Number(element.dataset.line));
  };
  target.addEventListener('pointerover', find);
  target.addEventListener('focusin', find);
  target.addEventListener('click', event => {
    const element = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.composed-line');
    if (!element || !target.contains(element)) return;
    const input = document.querySelector<HTMLInputElement>('#inspect');
    if (input && !input.checked) input.click();
    find(event);
  });
}
