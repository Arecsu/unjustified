/**
 * A ragged-right adaptation of paragraph-wide shortest-path line breaking.
 * Not a full Knuth–Plass implementation: no glue adjustment or hyphenation.
 * Bounded k-best paths preserve alternatives for the document-level search.
 */
import { trackingAdvances } from './text-metrics';
import { segmentText, hasArabic } from './language';

export interface Settings {
  width: number;
  fontSize: number;
  trackingMin: number; // Minimum CSS letter-spacing, in em (<= 0).
  trackingMax: number; // Maximum CSS letter-spacing, in em (>= 0).
  rag: number; // Desired inset of ordinary line endings, fraction of measure.
  minEnding: number;
  sync: number; // 0–1, document-level shape coupling.
  protectEndings: boolean;
}

export interface Line {
  start: number;
  end: number;
  text: string;
  natural: number;
  width: number;
  tracking: number; // em
  fill: number;
  overflow: boolean;
}

export interface Layout {
  lines: Line[];
  cost: number;
}

export interface Composition {
  paragraphs: Layout[];
  cost: number;
  explored: number;
  candidates: number;
}

export type Measure = (text: string) => number;
const square = (n: number) => n * n;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const wordsOf = (text: string): string[] => text.trim().split(/\s+/u).filter(Boolean);

function lineCost(line: Line, final: boolean, only: boolean, settings: Settings): number {
  if (line.overflow) return 500 + square(line.fill - 1) * 100;
  const track = 0.10 * square(line.tracking / 0.01);
  if (only) return track;
  if (final) {
    // Short endings are a soft constraint: impossible cases remain renderable.
    const shortage = Math.max(0, settings.minEnding - line.fill);
    return track + (settings.protectEndings
      ? 240 * square(shortage) + (line.end - line.start === 1 ? 18 : 0)
      : 0);
  }
  return 1.4 + square((line.fill - (1 - settings.rag)) / 0.10) + track
    + 80 * square(Math.max(0, 0.68 - line.fill));
}

function transition(a: Line | undefined, b: Line, final: boolean): number {
  if (!a) return 0;
  // Keep line-to-line tracking changes subtle. Final lines are allowed to relax.
  return 0.035 * square((a.tracking - b.tracking) / 0.01)
    + (final ? 0 : 0.16 * square((a.fill - b.fill) / 0.12));
}

function createLine(words: string[], start: number, end: number, measure: Measure,
  s: Settings, tracked: boolean, separator: string): Line | null {
  const text = words.slice(start, end).join(separator).trimEnd();
  const natural = measure(text);
  // CSS tracking contributes a trailing advance too. Japanese uses grapheme
  // advances; connected Arabic paragraphs have their tracking bounds set to zero.
  const advances = trackingAdvances(text);
  const coefficient = advances * s.fontSize / s.width;
  const naturalFill = natural / s.width;
  const final = end === words.length;
  const only = start === 0 && final;
  let tracking = 0;
  if (tracked && (s.trackingMin < 0 || s.trackingMax > 0) && !only) {
    // Minimize A(f + k·t − target)² + B·t² analytically, then clamp.
    const target = final ? s.minEnding : 1 - s.rag;
    const a = final ? (s.protectEndings && naturalFill < target ? 240 : 0) : 100;
    const b = 1000;
    tracking = clamp(a * coefficient * (target - naturalFill)
      / (a * coefficient * coefficient + b), s.trackingMin, s.trackingMax);
    // Use bounded negative tracking to admit a word that just barely doesn't fit.
    if (naturalFill + coefficient * tracking > 1) {
      tracking = Math.max(s.trackingMin, (1 - naturalFill) / coefficient);
    }
  }
  const width = natural + advances * tracking * s.fontSize;
  const overflow = width > s.width + 0.05;
  if (overflow && end - start > 1) return null;
  return { start, end, text, natural, width, tracking, fill: width / s.width, overflow };
}

/** Greedy reference for tests / non-DOM clients. The UI reads actual browser wraps. */
export function greedy(text: string, measure: Measure, s: Settings): Layout {
  const { units: words, separator } = segmentText(text);
  const lines: Line[] = [];
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

export function scoreParagraph(lines: Line[], s: Settings): number {
  return lines.reduce((sum, line, i) => sum
    + lineCost(line, i === lines.length - 1, lines.length === 1, s)
    + transition(lines[i - 1], line, i === lines.length - 1), 0);
}

function prune(paths: Layout[], limit: number): Layout[] {
  paths.sort((a, b) => a.cost - b.cost);
  // Preserve some end-length / line-count diversity for cross-paragraph selection.
  const bins = new Map<string, number>();
  return paths.filter(path => {
    const last = path.lines.at(-1)!;
    const key = `${path.lines.length}:${last.start}`;
    const count = bins.get(key) ?? 0;
    bins.set(key, count + 1);
    return count < 4;
  }).slice(0, limit);
}

export function paragraphCandidates(text: string, measure: Measure, s: Settings,
  beam = 32): { layouts: Layout[]; explored: number } {
  // Preserve joining scripts: optimize Arabic word breaks, never letter-space
  // its connected glyphs. Latin/Japanese paragraphs retain the chosen bounds.
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
      // Bound transient memory on long paragraphs.
      if (paths[end].length > beam * 20) paths[end] = prune(paths[end], beam * 2);
    }
    // Paths before this word will never be used again.
    paths[start] = [];
  }
  const layouts = prune(paths[words.length], beam);
  const baseline = greedy(text, measure, s);
  // Retain the exact untracked greedy reference as a valid fallback candidate.
  layouts.push(baseline);
  return { layouts: layouts.sort((a, b) => a.cost - b.cost), explored };
}

/** Compare normalized body contours (four samples), average fill, and endings.
 * This is our experimental document objective, not a published typographic rule.
 */
export function shapeDistance(a: Layout, b: Layout): number {
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

export function scoreDocument(paragraphs: Layout[], s: Settings): number {
  let cost = paragraphs.reduce((sum, p) => sum + p.cost, 0);
  for (let i = 0; i < paragraphs.length; i++) {
    for (let j = 0; j < i; j++) {
      cost += s.sync * 65 * shapeDistance(paragraphs[i], paragraphs[j])
        / Math.max(1, paragraphs.length - 1);
    }
  }
  return cost;
}

export function compose(texts: string[], measure: Measure, s: Settings): Composition {
  const options = texts.map(text => paragraphCandidates(text, measure, s));
  let explored = options.reduce((sum, option) => sum + option.explored, 0);
  if (s.sync === 0) {
    // With no pairwise terms this objective is separable; skip joint enumeration.
    const paragraphs = options.map(option => option.layouts[0]);
    return { paragraphs, cost: paragraphs.reduce((sum, p) => sum + p.cost, 0), explored,
      candidates: options.reduce((sum, p) => sum + p.layouts.length, 0) };
  }
  // Exhaustive joint selection over retained candidates for the three-paragraph
  // experiment. For >3 paragraphs, use a bounded document beam to stay interactive.
  let frontier: { paragraphs: Layout[]; cost: number }[] = [{ paragraphs: [], cost: 0 }];
  for (let i = 0; i < options.length; i++) {
    const next: typeof frontier = [];
    for (const previous of frontier) {
      for (const layout of options[i].layouts) {
        let cost = previous.cost + layout.cost;
        for (const other of previous.paragraphs) {
          cost += s.sync * 65 * shapeDistance(layout, other) / Math.max(1, texts.length - 1);
        }
        next.push({ paragraphs: [...previous.paragraphs, layout], cost });
        explored++;
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    const limit = texts.length <= 3 && i < texts.length - 1 ? 1200 : 128;
    frontier = next.slice(0, limit);
  }
  const best = frontier[0] ?? { paragraphs: [], cost: 0 };
  return { ...best, explored, candidates: options.reduce((sum, p) => sum + p.layouts.length, 0) };
}

export function metrics(layouts: Layout[], s: Settings) {
  const body = layouts.flatMap(p => p.lines.length > 1 ? p.lines.slice(0, -1) : []);
  const mean = body.reduce((n, l) => n + l.fill, 0) / (body.length || 1);
  const deviation = Math.sqrt(body.reduce((n, l) => n + square(l.fill - mean), 0) / (body.length || 1));
  const shortEndings = layouts.filter(p => p.lines.length > 1
    && (p.lines.at(-1)!.fill < s.minEnding || p.lines.at(-1)!.end - p.lines.at(-1)!.start === 1)).length;
  const all = layouts.flatMap(p => p.lines);
  return { deviation, shortEndings, lines: all.length,
    maxTracking: Math.max(0, ...all.map(l => Math.abs(l.tracking))),
    overflow: all.some(l => l.overflow),
    cost: scoreDocument(layouts, s) };
}
