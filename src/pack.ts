/**
 * Paragraph candidates as transferable typed arrays. Cloning ~13,000 line
 * objects between workers costs milliseconds; transferring three buffers costs
 * nothing. Line text is rebuilt from the paragraph's own segmentation, exactly
 * as the search concatenated it.
 */
import { segmentText } from './language';
import type { Hyphenation } from './language';
import type { Layout, Line } from './optimizer';

const FIELDS = 12;

export interface PackedCandidates {
  costs: Float64Array;
  lineCounts: Int32Array;
  lines: Float64Array;
  explored: number;
}

export function packCandidates({ layouts, explored }: { layouts: Layout[]; explored: number }): PackedCandidates {
  const costs = new Float64Array(layouts.length);
  const lineCounts = new Int32Array(layouts.length);
  let total = 0;
  for (const layout of layouts) total += layout.lines.length;
  const lines = new Float64Array(total * FIELDS);
  let o = 0;
  layouts.forEach((layout, i) => {
    costs[i] = layout.cost;
    lineCounts[i] = layout.lines.length;
    for (const l of layout.lines) {
      lines[o++] = l.start; lines[o++] = l.end; lines[o++] = l.natural; lines[o++] = l.width;
      lines[o++] = l.tracking; lines[o++] = l.wordSpacing; lines[o++] = l.kashida; lines[o++] = l.kashidaWidth;
      lines[o++] = l.stretch; lines[o++] = l.fill; lines[o++] = l.overflow ? 1 : 0; lines[o++] = l.hyphen ? 1 : 0;
    }
  });
  return { costs, lineCounts, lines, explored };
}

export function unpackCandidates(packed: PackedCandidates, text: string,
  hyphenation?: Hyphenation): { layouts: Layout[]; explored: number } {
  const { units, joins } = segmentText(text, hyphenation);
  const { costs, lineCounts, lines } = packed;
  const layouts: Layout[] = [];
  let o = 0;
  for (let i = 0; i < costs.length; i++) {
    const result: Line[] = new Array(lineCounts[i]);
    for (let j = 0; j < result.length; j++) {
      const start = lines[o], end = lines[o + 1];
      result[j] = {
        start, end, text: lineText(units, joins, start, end),
        natural: lines[o + 2], width: lines[o + 3], tracking: lines[o + 4], wordSpacing: lines[o + 5],
        kashida: lines[o + 6], kashidaWidth: lines[o + 7], stretch: lines[o + 8], fill: lines[o + 9],
        overflow: lines[o + 10] === 1, hyphen: lines[o + 11] === 1,
      };
      o += FIELDS;
    }
    layouts.push({ lines: result, cost: costs[i] });
  }
  return { layouts, explored: packed.explored };
}

/** A line's text exactly as the search built it: separators between words,
 *  nothing between the pieces of a hyphenated word. */
export function lineText(units: string[], joins: string[], start: number, end: number): string {
  let text = units[start] ?? '';
  for (let i = start + 1; i < end; i++) text += joins[i - 1] + units[i];
  return text;
}

export const transferables = (packed: PackedCandidates) =>
  [packed.costs.buffer, packed.lineCounts.buffer, packed.lines.buffer];
