import type { Layout, Settings } from './optimizer';

/** Ragged-text diagnostics are not justified-text river warnings. Intentional
 * spaces and unused margins stay unpainted. All overlays are non-selectable,
 * text-free, aria-hidden geometry; copying the underlying prose stays native. */
export function renderVisualizers(column: HTMLElement, layouts: Layout[], reference: Layout[], enabled: boolean, settings: Settings) {
  column.querySelector('.composition-overlay')?.remove();
  if (!enabled) return;
  const overlay = document.createElement('span');
  overlay.className = 'composition-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  const origin = column.getBoundingClientRect();
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const rem = (n: number) => `${n / root}rem`;
  const add = (kind: string, x: number, y: number, width: number, height: number) => {
    const element = document.createElement('i'); element.className = `diagnostic-mark ${kind}`;
    element.style.left = rem(x); element.style.top = rem(y);
    element.style.width = rem(width); element.style.height = rem(height);
    overlay.append(element); return element;
  };
  column.querySelectorAll('p').forEach((p, index) => {
    const lineHeight = parseFloat(getComputedStyle(column).lineHeight);
    const y = p.getBoundingClientRect().top - origin.top;
    const rtl = p.dir === 'rtl';
    const lines = layouts[index]?.lines ?? [];
    lines.forEach((line, i) => {
      const top = y + i * lineHeight;
      const endpoint = rtl ? origin.width - line.width : line.width;
      add(`endpoint${line.overflow ? ' overflow' : ''}`, endpoint, top + lineHeight * .28, root / 16, lineHeight * .42);
      const other = reference[index]?.lines[i];
      if (other) {
        add('reference-endpoint', rtl ? origin.width - other.width : other.width,
          top + lineHeight * .10, root / 16, lineHeight * .15);
      }
      if (Math.abs(line.tracking) > .00005) {
        const mark = add(line.tracking < 0 ? 'tracking shrink' : 'tracking expand',
          rtl ? -root : origin.width + root * .25, top + lineHeight * .24, root * .8, lineHeight * .5);
        mark.dataset.label = `${line.tracking < 0 ? '−' : '+'}${Math.round(Math.abs(line.tracking) * 1000)}`;
      }
      const final = i === lines.length - 1 && lines.length > 1;
      if (settings.protectEndings && final && (line.fill < settings.minEnding || line.end - line.start === 1)) {
        add('short-ending', rtl ? Math.max(0, endpoint) : 0,
          top + lineHeight * .93, Math.min(origin.width, line.width), root / 16);
      }
    });
  });
  column.append(overlay);
}
