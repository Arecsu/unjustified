import { segmentText } from './language';
import { scoreParagraph } from './optimizer';
import type { Layout, Line, Settings } from './optimizer';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Read actual browser line geometry, including CJK without spaces and RTL.
 * Extents use min/max, never assume logical order equals visual x order.
 *
 * One `Range` per *unit* (word or Japanese break opportunity) rather than per
 * grapheme: a 13,000-character article needs ~2,500 range reads instead of
 * ~13,000, and offset → unit mapping is a direct index, not a linear scan.
 * Units that a line break falls inside (long words, CJK) fall back to grapheme
 * granularity for that unit only.
 */
export function readNativeLayout(column: HTMLElement, width: number, settings: Settings): Layout[] {
  const empty = (): Layout => ({ lines: [], cost: scoreParagraph([], { ...settings, width }) });
  return [...column.querySelectorAll('p')].map(p => {
    const node = p.firstChild;
    const source = node?.textContent ?? '';
    if (!source || !node) return empty();
    const { units, separator } = segmentText(source);
    if (!units.length) return empty();
    const offsets: number[] = new Array(units.length);
    let cursor = 0;
    for (let i = 0; i < units.length; i++) {
      offsets[i] = cursor;
      cursor += units[i].length + (i < units.length - 1 ? separator.length : 0);
    }

    const lines: Line[] = [];
    const range = document.createRange();
    let top = -Infinity, left = 0, right = 0;
    let lineStartOffset = 0;

    const place = (rectTop: number, rectLeft: number, rectRight: number,
      unitIndex: number, unitStartOffset: number, unitEndOffset: number) => {
      const line = lines[lines.length - 1];
      if (!line || Math.abs(rectTop - top) > 2) {
        top = rectTop; left = rectLeft; right = rectRight;
        lineStartOffset = unitStartOffset;
        const natural = rectRight - rectLeft;
        lines.push({
          start: unitIndex, end: unitIndex + 1,
          text: source.slice(unitStartOffset, unitEndOffset),
          natural, width: natural, tracking: 0, wordSpacing: 0, kashida: 0, kashidaWidth: 0,
          fill: natural / width, overflow: natural > width + 1,
        });
        return;
      }
      left = Math.min(left, rectLeft);
      right = Math.max(right, rectRight);
      line.end = unitIndex + 1;
      line.text = source.slice(lineStartOffset, unitEndOffset);
      line.width = line.natural = right - left;
      line.fill = line.width / width;
      line.overflow = line.width > width + 1;
    };

    for (let i = 0; i < units.length; i++) {
      const start = offsets[i];
      let from = start, to = start + units[i].length;
      while (from < to && /\s/u.test(source[from])) from++;
      while (to > from && /\s/u.test(source[to - 1])) to--;
      if (from === to) continue;
      range.setStart(node, from);
      range.setEnd(node, to);
      const rects = range.getClientRects();
      if (rects.length === 1) {
        const rect = rects[0];
        place(rect.top, rect.left, rect.right, i, from, to);
        continue;
      }
      // Split across lines (or several visual fragments): per grapheme.
      let placed = false;
      for (const { segment, index } of graphemes.segment(source.slice(from, to))) {
        if (/^\s+$/u.test(segment)) continue;
        range.setStart(node, from + index);
        range.setEnd(node, from + index + segment.length);
        const rect = range.getBoundingClientRect();
        place(rect.top, rect.left, rect.right, i, from + index, from + index + segment.length);
        placed = true;
      }
      if (!placed) continue;
    }
    return { lines, cost: scoreParagraph(lines, { ...settings, width }) };
  });
}
