import { segmentText } from './language';
import { scoreParagraph } from './optimizer';
import type { Layout, Line, Settings } from './optimizer';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Read actual browser line geometry, including CJK without spaces and RTL.
 * Extents use min/max, never assume logical order equals visual x order. */
export function readNativeLayout(column: HTMLElement, width: number, settings: Settings): Layout[] {
  return [...column.querySelectorAll('p')].map(p => {
    const node = p.firstChild!;
    const source = node.textContent ?? '';
    const { units, separator } = segmentText(source);
    const ends: number[] = [];
    let cursor = 0;
    units.forEach((unit, i) => { cursor += unit.length; ends.push(cursor); if (i < units.length - 1) cursor += separator.length; });
    const lines: Line[] = [];
    const range = document.createRange();
    let top = -Infinity, left = 0, right = 0, lineStart = 0;
    const unitAt = (offset: number) => { const i = ends.findIndex(end => end > offset); return i < 0 ? units.length : i; };
    for (const { segment, index } of graphemes.segment(source)) {
      if (/^\s+$/u.test(segment)) continue;
      range.setStart(node, index); range.setEnd(node, index + segment.length);
      const rect = range.getBoundingClientRect();
      if (Math.abs(rect.top - top) > 2) {
        top = rect.top; left = rect.left; right = rect.right; lineStart = index;
        lines.push({ start: unitAt(index), end: unitAt(index + segment.length - 1) + 1,
          text: segment, natural: rect.width, width: rect.width, tracking: 0,
          fill: rect.width / width, overflow: rect.width > width + 1 });
      } else {
        left = Math.min(left, rect.left); right = Math.max(right, rect.right);
        const line = lines.at(-1)!;
        line.text = source.slice(lineStart, index + segment.length);
        line.end = unitAt(index + segment.length - 1) + 1;
        line.width = line.natural = right - left;
        line.fill = line.width / width;
        line.overflow = line.width > width + 1;
      }
    }
    return { lines, cost: scoreParagraph(lines, { ...settings, width }) };
  });
}
