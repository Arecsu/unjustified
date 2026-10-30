/**
 * Reference implementations of the paragraph DP and the joint document search,
 * kept as executable specifications for `src/optimizer.equivalence.test.ts`.
 *
 * These are the pre-optimization implementations (O(n²) measurement, copied
 * line arrays, and a per-insertion comparison against every chosen paragraph).
 * They are deliberately slow and allocation-heavy: the point is that they are
 * easy to read and obviously faithful to the documented objective.
 */
import { asEvenAsBest, greedy, scoreParagraph } from '../src/optimizer';
import type { Layout, Line, Measure, Settings } from '../src/optimizer';
import { trackingAdvances } from '../src/text-metrics';
import { segmentText, hasArabic } from '../src/language';

const square = (n: number) => n * n;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

function lineCost(line: Line, final: boolean, only: boolean, settings: Settings): number {
  if (line.overflow) return 500 + square(line.fill - 1) * 100;
  const track = 0.10 * square(line.tracking / 0.01);
  if (only) return track;
  if (final) {
    const shortage = Math.max(0, settings.minEnding - line.fill);
    return track + (settings.protectEndings
      ? 240 * square(shortage) + (line.end - line.start === 1 ? 18 : 0)
      : 0);
  }
  const short = 1 - settings.rag - line.fill;
  return 1.4 + (short > 0 ? square(short / 0.10) : 0) + 0.15 * square((1 - line.fill) / 0.10) + track
    + 80 * square(Math.max(0, 0.68 - line.fill));
}

function transition(a: Line | undefined, b: Line, final: boolean): number {
  if (!a) return 0;
  return 0.035 * square((a.tracking - b.tracking) / 0.01)
    + (final ? 0 : 0.16 * square((a.fill - b.fill) / 0.12));
}

function createLine(words: string[], start: number, end: number, measure: Measure,
  s: Settings, tracked: boolean, separator: string): Line | null {
  const text = words.slice(start, end).join(separator).trimEnd();
  const natural = measure(text);
  const advances = trackingAdvances(text);
  const coefficient = advances * s.fontSize / s.width;
  const naturalFill = natural / s.width;
  const final = end === words.length;
  const only = start === 0 && final;
  let tracking = 0;
  if (tracked && (s.trackingMin < 0 || s.trackingMax > 0) && !only) {
    const below = naturalFill < 1 - s.rag;
    const target = final ? s.minEnding : below ? 1 - s.rag : 1;
    const a = final ? (s.protectEndings && naturalFill < target ? 240 : 0) : below ? 100 : 100 * 0.15;
    const b = 1000;
    tracking = clamp(a * coefficient * (target - naturalFill)
      / (a * coefficient * coefficient + b), s.trackingMin, s.trackingMax);
    if (naturalFill + coefficient * tracking > 1) {
      tracking = Math.max(s.trackingMin, (1 - naturalFill) / coefficient);
    }
  }
  const width = natural + advances * tracking * s.fontSize;
  const overflow = width > s.width + 0.05;
  if (overflow && end - start > 1) return null;
  return { start, end, text, natural, width, tracking, wordSpacing: 0, kashida: 0, kashidaWidth: 0, stretch: 100, hyphen: false, fill: width / s.width, overflow };
}

function prune(paths: Layout[], limit: number): Layout[] {
  paths.sort((a, b) => a.cost - b.cost);
  const bins = new Map<string, number>();
  return paths.filter(path => {
    const last = path.lines.at(-1)!;
    const key = `${path.lines.length}:${last.start}`;
    const count = bins.get(key) ?? 0;
    bins.set(key, count + 1);
    return count < 4;
  }).slice(0, limit);
}

export function referenceParagraphCandidates(text: string, measure: Measure, s: Settings,
  beam = 32): { layouts: Layout[]; explored: number } {
  if (hasArabic(text)) s = { ...s, trackingMin: 0, trackingMax: 0 };
  const { units: words, separator } = segmentText(text);
  if (!words.length) return { layouts: [{ lines: [], cost: 0 }], explored: 0 };
  const paths: Layout[][] = Array.from({ length: words.length + 1 }, () => []);
  paths[0] = [{ lines: [], cost: 0 }];
  let explored = 0;
  for (let start = 0; start < words.length; start++) {
    if (start > 0) paths[start] = prune(paths[start], beam);
    if (!paths[start].length) continue;
    for (let end = start + 1; end <= words.length; end++) {
      const line = createLine(words, start, end, measure, s, true, separator);
      if (!line) break;
      const final = end === words.length;
      if (!final && line.fill < 0.50 && !line.overflow) continue;
      const cost = lineCost(line, final, start === 0 && final, s);
      for (const path of paths[start]) {
        paths[end].push({
          lines: [...path.lines, line],
          cost: path.cost + cost + transition(path.lines.at(-1), line, final),
        });
        explored++;
      }
      if (paths[end].length > beam * 20) paths[end] = prune(paths[end], beam * 2);
    }
    paths[start] = [];
  }
  const layouts = prune(paths[words.length], beam);
  layouts.push(greedy(text, measure, s));
  return { layouts: layouts.sort((a, b) => a.cost - b.cost), explored };
}

export function referenceGreedy(text: string, measure: Measure, s: Settings): Layout {
  const { units: words, separator } = segmentText(text);
  const lines: Line[] = [];
  if (!words.length) return { lines, cost: 0 };
  for (let start = 0; start < words.length;) {
    let line = createLine(words, start, start + 1, measure, s, false, separator)!;
    let end = start + 2;
    while (end <= words.length) {
      const next = createLine(words, start, end, measure, s, false, separator);
      if (!next) break;
      line = next;
      end++;
    }
    lines.push(line);
    start = line.end;
  }
  return { lines, cost: scoreParagraph(lines, s) };
}

export interface ReferenceComposition {
  paragraphs: Layout[];
  cost: number;
  layouts: Layout[][];
}

export function referenceCompose(texts: string[], measure: Measure, s: Settings): ReferenceComposition {
  const options = texts.map(text => referenceParagraphCandidates(text, measure, s));
  if (s.sync === 0) {
    const paragraphs = options.map(option => option.layouts[0]);
    return { paragraphs, cost: paragraphs.reduce((sum, p) => sum + p.cost, 0), layouts: options.map(o => o.layouts) };
  }
  for (const option of options) option.layouts = asEvenAsBest(option.layouts);
  let frontier: { paragraphs: Layout[]; cost: number }[] = [{ paragraphs: [], cost: 0 }];
  for (let i = 0; i < options.length; i++) {
    const next: typeof frontier = [];
    for (const previous of frontier) {
      for (const layout of options[i].layouts) {
        let cost = previous.cost + layout.cost;
        for (const other of previous.paragraphs) {
          cost += s.sync * 65 * Math.max(0.002, (1 - (s.firmness ?? 0)) ** 2) * shapeDistanceReference(layout, other) / Math.max(1, texts.length - 1);
        }
        next.push({ paragraphs: [...previous.paragraphs, layout], cost });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    const limit = texts.length <= 3 && i < texts.length - 1 ? 1200 : 128;
    frontier = next.slice(0, limit);
  }
  const best = frontier[0] ?? { paragraphs: [], cost: 0 };
  return { paragraphs: best.paragraphs, cost: best.cost, layouts: options.map(o => o.layouts) };
}

/** shapeDistance exactly as originally written (contour samples, no features). */
export function shapeDistanceReference(a: Layout, b: Layout): number {
  if (!a.lines.length || !b.lines.length) return 0;
  const bodyA = a.lines.slice(0, -1);
  const bodyB = b.lines.slice(0, -1);
  let cost = 2 * square(a.lines.at(-1)!.fill - b.lines.at(-1)!.fill);
  if (bodyA.length && bodyB.length) {
    const mean = (lines: Line[]) => lines.reduce((n, l) => n + l.fill, 0) / lines.length;
    cost += 2 * square(mean(bodyA) - mean(bodyB));
    for (let sample = 0; sample < 4; sample++) {
      const x = Math.round(sample / 3 * (bodyA.length - 1));
      const y = Math.round(sample / 3 * (bodyB.length - 1));
      cost += square(bodyA[x].fill - bodyB[y].fill) / 4;
    }
  }
  return cost;
}
