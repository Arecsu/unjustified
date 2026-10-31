/**
 * A ragged-right adaptation of paragraph-wide shortest-path line breaking.
 * Not a full Knuth–Plass implementation: no glue adjustment or hyphenation.
 * Bounded k-best paths preserve alternatives for the document-level search.
 *
 * Performance notes (see research/PERFORMANCE.md). None of this changes the
 * objective or the retained candidates; `src/optimizer.equivalence.test.ts`
 * proves the fast paths against the reference implementations in
 * `bench/reference-compose.ts`.
 *  - Paths store back-pointers instead of copying line arrays, and candidate
 *    strings are built incrementally instead of slicing word arrays.
 *  - A conservative additive width bound skips `measureText` calls for
 *    candidates that could not survive the existing fill/overflow rules.
 *  - The document search keeps the pairwise contour/ending term as running
 *    first and second moments, so adding a paragraph costs O(1) instead of
 *    comparing it against every earlier paragraph.
 */
import { trackingAdvances } from './text-metrics';
import { segmentText, hasArabic } from './language';
import type { Hyphenation } from './language';
import { fitMeasure, shareGap } from './stretch';
import type { Tool } from './stretch';
import { bestSite, TATWEEL } from './kashida';
import type { KashidaOptions } from './kashida';

export interface Settings {
  width: number;
  fontSize: number;
  trackingMin: number; // Minimum CSS letter-spacing, in em (<= 0).
  trackingMax: number; // Maximum CSS letter-spacing, in em (>= 0).
  rag: number; // Desired inset of ordinary line endings, fraction of measure.
  minEnding: number;
  sync: number; // 0–1, document-level shape coupling.
  /** 0–1. Trades tracking restraint for an even edge: 0 is the ragged default,
   *  1 spends the tracking bounds freely to pull lines onto the rag target. */
  firmness?: number;
    /** How far each inter-word space may shrink (<= 0) and stretch (>= 0), as
   *  fractions of its natural width. Both 0 disable word-spacing adjustment. */
  wordSpacingMin?: number;
  wordSpacingMax?: number;
  /** Base CSS letter-spacing of the text, in em. Tracking adjusts relative to
   *  it. Arabic paragraphs ignore it. */
  letterSpacing?: number;
  /** Where words may be hyphenated (from `hyphenationPoints`); absent: never. */
  hyphenation?: Hyphenation;
  /** How bad a hyphen is, as the fraction of the measure a line would have to
   *  fall short to be as bad (0.2: rare, 0.01: frequent). Stacked hyphens
   *  cost extra. Scaled like evenness, so it keeps its meaning at any firmness. */
  hyphenPenalty?: number;
  /** 0–4. Most tatweels a line of Arabic may receive. 0 disables kashida. */
  kashida?: number;
  /** Which joins take tatweels and how many a word may stack. Default: every
   *  join, any word, no limit per word. */
  kashidaOptions?: KashidaOptions;
  /** 0–1. Kashida over the other tools, word spacing first: 0.5 is the default
   *  balance, 0 makes kashida 64 times stiffer (spaces first), 1 64 times looser
   *  (kashida first, spaces once tatweels run out). */
  kashidaFrequency?: number;
  /** First-line indent in px: that line's measure is `width - indent`. Set per
   *  paragraph by `paragraphSettings`. */
  indent?: number;
  /** Which paragraphs `indent` applies to. Default: all. */
  indentParagraphs?: 'all' | 'first' | 'rest';
  /** 0–0.4. How far lines may condense along the font's width axis. Needs a
   *  `MeasureAt`; ignored without one. */
  widthFlex?: number;
  protectEndings: boolean;
}

/** A flush edge from the tools the text can use: kashida and word spacing for
 *  Arabic, word spacing and tracking elsewhere. Width flex stays as it is.
 *  Harmony is off: with flush bodies it only matches last-line lengths, and
 *  pays for that with extra tracking. */
export const justified = { rag: 0, firmness: 1, wordSpacingMin: -0.25, wordSpacingMax: 1, kashida: 4, trackingMin: -0.04, trackingMax: 0.04, sync: 0 } satisfies Partial<Settings>;

export interface Line {
  start: number;
  end: number;
  text: string;
  natural: number;
  width: number;
  tracking: number; // em
  wordSpacing: number; // em added to (or removed from) each inter-word space
  kashida: number; // tatweels inserted into this line (Arabic only)
  kashidaWidth: number; // their total advance, px
  stretch: number; // CSS font-stretch, percent (100 = natural)
  hyphen: boolean; // ends inside a word, with a drawn hyphen
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
/** Width at a whole-percent font-stretch step. */
export type MeasureAt = (text: string, stretch: number) => number;
const square = (n: number) => n * n;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
/** How strongly tracking and its line-to-line changes are resisted, relative to
 *  the default (1 at firmness 0). Floored so the tracking solve stays defined. */
const restraint = (s: Settings) => Math.max(0.002, square(1 - (s.firmness ?? 0)));
/** Tolerance around the rag target: 0.10 by default, 0.02 at full firmness. */
const fillTolerance = (s: Settings) => 0.10 * (1 - 0.8 * (s.firmness ?? 0));
/** Two hyphenated lines in a row cost this many times the hyphen penalty extra. */
const HYPHEN_STACK = 2;
const hyphenCost = (s: Settings) => square((s.hyphenPenalty ?? 0) / fillTolerance(s));
/** Kashida's stiffness on a line, scaled by its frequency. Line-to-line changes
 *  keep the base stiffness, as the WebAssembly search does. */
const kashidaStiffness = (s: Settings) => KASHIDA_STIFFNESS * 64 ** (1 - 2 * (s.kashidaFrequency ?? 0.5));
/** How much shorter (fraction of the measure) a body may get for harmony. */
const HARMONY_SLACK = 0.01;
/** Weight of the pull toward the full edge for lines inside the rag zone. */
const ZONE_PULL = 0.15;
/** Tool stiffness, loosest to stiffest per unit of fill: word spacing (em²),
 *  kashida (em² of tatweel), width (percentage point²), tracking (em²). */
const WORD_STIFFNESS = 10;
const KASHIDA_STIFFNESS = 0.5;
const WIDTH_STIFFNESS = 0.015;
const TRACKING_STIFFNESS = 1000;
/** Reused by every `buildLine` call: the candidate loop is hot.
 *  Loosest first: word spacing, kashida (in tatweels), width (in steps), tracking. */
const tools: Tool[] = [0, 1, 2, 3].map(() => ({ k: 0, b: 0, min: 0, max: 0 }));
const amounts = new Float64Array(4);

export const wordsOf = (text: string): string[] => text.trim().split(/\s+/u).filter(Boolean);

function lineCost(line: Line, final: boolean, only: boolean, settings: Settings): number {
  if (line.overflow) return 500 + square(line.fill - 1) * 100;
  const track = 0.10 * restraint(settings) * square(line.tracking / 0.01)
    + (line.wordSpacing !== 0 ? WORD_STIFFNESS * restraint(settings) * square(line.wordSpacing) : 0)
    + (line.kashida !== 0 ? kashidaStiffness(settings) * restraint(settings) * square(line.kashidaWidth / settings.fontSize) : 0)
    + (line.stretch !== 100 ? WIDTH_STIFFNESS * restraint(settings) * square(100 - line.stretch) : 0)
    + (line.hyphen ? hyphenCost(settings) : 0);
  if (only) return track;
  if (final) {
    // Short endings are a soft constraint: impossible cases remain renderable.
    const shortage = Math.max(0, settings.minEnding - line.fill);
    return track + (settings.protectEndings
      ? 240 * square(shortage) + (line.end - line.start === 1 ? 18 : 0)
      : 0);
  }
  // The rag is a zone: a line may end anywhere in the last `rag` of the measure.
  // Ending before the zone is penalized; inside it, a light pull to the edge.
  const tolerance = fillTolerance(settings);
  const short = 1 - settings.rag - line.fill;
  return 1.4 + (short > 0 ? square(short / tolerance) : 0) + ZONE_PULL * square((1 - line.fill) / tolerance) + track
    + 80 * square(Math.max(0, 0.68 - line.fill));
}

function transition(a: Line | undefined, b: Line, final: boolean, s: Settings): number {
  if (!a) return 0;
  // Keep line-to-line tracking changes subtle. Final lines are allowed to relax.
  return 0.035 * restraint(s) * square((a.tracking - b.tracking) / 0.01)
    + (a.wordSpacing !== b.wordSpacing ? 0.35 * WORD_STIFFNESS * restraint(s) * square(a.wordSpacing - b.wordSpacing) : 0)
    + (a.kashida !== b.kashida ? 0.35 * KASHIDA_STIFFNESS * restraint(s) * square((a.kashidaWidth - b.kashidaWidth) / s.fontSize) : 0)
    + (a.stretch !== b.stretch ? 0.35 * WIDTH_STIFFNESS * restraint(s) * square(a.stretch - b.stretch) : 0)
    + (final ? 0 : 0.16 * square((a.fill - b.fill) / 0.12))
    + (a.hyphen && b.hyphen ? HYPHEN_STACK * hyphenCost(s) : 0);
}

/** Build one candidate line from an already-measured natural width. */
function buildLine(start: number, end: number, text: string, natural: number, advances: number,
  totalWords: number, s: Settings, tracked: boolean, spaces = 0, spaceShrink = 0, spaceStretch = 0,
  kashidaLimit = 0, tatweel = 0, widthLimit = 0, measureAt?: MeasureAt,
  hyphen = false, ink = text, wholeWord = end - start === 1): Line | null {
  // CSS tracking contributes a trailing advance too. Japanese uses grapheme
  // advances; connected Arabic paragraphs have their tracking bounds set to zero.
  const naturalFill = natural / s.width;
  const final = end === totalWords;
  const only = start === 0 && final;
  let tracking = 0, wordSpacing = 0, kashida = 0, stretch = 100;
  let base = natural, tatweelAt = tatweel;
  if (tracked && !only) {
    // Each tool moves fill by k per unit: em for spacing, one tatweel for
    // kashida, one percentage point of font-stretch for width (condense only).
    const words = tools[0], kash = tools[1], fit = tools[2], track = tools[3];
    kash.k = tatweel / s.width;
    kash.b = kashidaStiffness(s) * restraint(s) * square(tatweel / s.fontSize);
    kash.min = 0; kash.max = kashidaLimit;
    words.k = spaces * s.fontSize / s.width;
    words.b = WORD_STIFFNESS * restraint(s);
    words.min = -spaceShrink; words.max = spaceStretch;
    track.k = advances * s.fontSize / s.width;
    track.b = TRACKING_STIFFNESS * restraint(s);
    track.min = s.trackingMin; track.max = s.trackingMax;
    // Below the rag zone, aim for its start; inside it, the light pull to the edge.
    const below = naturalFill < 1 - s.rag;
    const target = final ? s.minEnding : below ? 1 - s.rag : 1;
    // Condensing only helps a line that is too long, so only then is it worth
    // the extra measurement at the narrowest step.
    const narrow = widthLimit && naturalFill > target ? measureAt!(ink, 100 - widthLimit) : natural;
    fit.k = (natural - narrow) / (widthLimit * s.width || 1);
    fit.b = WIDTH_STIFFNESS * restraint(s);
    fit.min = -widthLimit; fit.max = 0;
    const a = final ? (s.protectEndings && naturalFill < target ? 240 : 0) : below ? 100 : 100 * ZONE_PULL;
    shareGap(target - naturalFill, a, tools, amounts);
    // Tatweels are whole glyphs and widths whole steps: round, pin, and let the
    // other tools absorb the rest.
    let rounded = false;
    for (const i of [1, 2]) {
      if (amounts[i] === 0) continue;
      const whole = Math.round(amounts[i]);
      tools[i].min = tools[i].max = whole;
      if (whole !== amounts[i]) rounded = true;
    }
    if (rounded) shareGap(target - naturalFill, a, tools, amounts);
    // Use bounded negative adjustment to admit a word that just barely doesn't fit.
    fitMeasure(naturalFill, tools, amounts);
    // Rounding up a tatweel, or a width step toward natural, can push the line
    // past the measure, which would discard it. Back off one unit until it fits.
    for (;;) {
      let used = 0;
      for (let i = 0; i < tools.length; i++) if (amounts[i] !== 0) used += tools[i].k * amounts[i];
      if (naturalFill + used <= 1 + 0.05 / s.width) break;
      if (amounts[1] > 0) kash.min = kash.max = amounts[1] - 1;
      else if (fit.min === fit.max && amounts[2] > -widthLimit) fit.min = fit.max = amounts[2] - 1;
      else break;
      shareGap(target - naturalFill, a, tools, amounts);
      fitMeasure(naturalFill, tools, amounts);
    }
    if (amounts[2] !== 0) {
      // Fitting may condense by a fraction of a step: go to the next whole one,
      // then replace the estimate with the exact width at that step.
      stretch = 100 + Math.floor(amounts[2]);
      base = measureAt!(ink, stretch);
      if (kashidaLimit) tatweelAt = measureAt!(TATWEEL, stretch);
      fit.k = 0;
      kash.k = tatweelAt / s.width;
      fitMeasure(base / s.width, tools, amounts);
    }
    wordSpacing = amounts[0];
    kashida = amounts[1];
    tracking = amounts[3];
  }
  let width = base + advances * tracking * s.fontSize;
  if (wordSpacing !== 0) width += spaces * wordSpacing * s.fontSize;
  const kashidaWidth = kashida * tatweelAt;
  if (kashida !== 0) width += kashidaWidth;
  const overflow = width > s.width + 0.05;
  if (overflow && !wholeWord) return null;
  return { start, end, text, natural, width, tracking, wordSpacing, kashida, kashidaWidth, stretch, hyphen,
    fill: width / s.width, overflow };
}

/** Grapheme advances are immutable per string; the candidate loop asks often. */
const advanceCache = new Map<string, number>();
function advancesOf(text: string): number {
  let count = advanceCache.get(text);
  if (count === undefined) {
    count = trackingAdvances(text);
    if (advanceCache.size > 100000) advanceCache.clear();
    advanceCache.set(text, count);
  }
  return count;
}

/** Greedy reference for tests / non-DOM clients. The UI reads actual browser wraps. */
export function greedy(text: string, measure: Measure, s: Settings): Layout {
  const { units: words, separator, joins } = segmentText(text, s.hyphenation);
  const total = words.length;
  if (!total) return { lines: [], cost: 0 };
  const lines: Line[] = [];
  const separatorAdvances = separator ? advancesOf(separator) : 0;
  const first = firstLine(s);
  /** The end of the word starting at `from`: greedy never breaks inside one. */
  const wordEnd = (from: number) => {
    let end = from + 1;
    while (separator && end < total && joins[end - 1] === '') end++;
    return end;
  };
  for (let start = 0; start < total;) {
    const ls = start === 0 ? first : s;
    let end = wordEnd(start);
    let candidate = words.slice(start, end).join('');
    let advances = advancesOf(candidate);
    let line = buildLine(start, end, candidate, measure(candidate), advances, total, ls, false,
      0, 0, 0, 0, 0, 0, undefined, false, candidate, true)!;
    while (end < total) {
      const next = wordEnd(end);
      const word = words.slice(end, next).join('');
      candidate = candidate + separator + word;
      advances += advancesOf(word) + separatorAdvances;
      const built = buildLine(start, next, candidate, measure(candidate), advances, total, ls, false);
      if (!built) break;
      line = built;
      end = next;
    }
    lines.push(line);
    start = line.end;
  }
  return { lines, cost: scoreParagraph(lines, s) };
}

/** A paragraph's first line: the measure less its indent. */
const firstLine = (s: Settings): Settings => s.indent ? { ...s, width: Math.max(1, s.width - s.indent) } : s;

/** The settings for paragraph `index`: its indent, or none where it doesn't apply. */
export function paragraphSettings(s: Settings, index: number): Settings {
  if (!s.indent) return s;
  const on = s.indentParagraphs === 'first' ? index === 0 : s.indentParagraphs === 'rest' ? index > 0 : true;
  return on ? s : { ...s, indent: 0 };
}

export function scoreParagraph(lines: Line[], s: Settings): number {
  return lines.reduce((sum, line, i) => sum
    + lineCost(line, i === lines.length - 1, lines.length === 1, s)
    + transition(lines[i - 1], line, i === lines.length - 1, s), 0);
}

/**
 * Paragraph DP frontier: struct-of-arrays with back-pointers.
 *
 * A 40-paragraph post explores ~400,000 partial paths; as objects that was
 * ~400,000 allocations per composition and the single largest remaining cost.
 * Indices into typed arrays keep the same algorithm with none of the churn.
 */
class PathPool {
  prev: Int32Array;
  depth: Int32Array;
  cost: Float64Array;
  line: Int32Array; // line id in the paragraph's line table, -1 for the root
  size = 0;
  constructor(capacity: number) {
    this.prev = new Int32Array(capacity);
    this.depth = new Int32Array(capacity);
    this.cost = new Float64Array(capacity);
    this.line = new Int32Array(capacity);
  }
  reset() {
    this.size = 0;
    this.push(-1, 0, -1);
  }
  push(prev: number, cost: number, line: number): number {
    if (this.size === this.prev.length) this.grow();
    const id = this.size++;
    this.prev[id] = prev;
    this.depth[id] = prev < 0 ? 0 : this.depth[prev] + 1;
    this.cost[id] = cost;
    this.line[id] = line;
    return id;
  }
  private grow() {
    const capacity = this.prev.length * 2;
    const prev = new Int32Array(capacity); prev.set(this.prev);
    const depth = new Int32Array(capacity); depth.set(this.depth);
    const cost = new Float64Array(capacity); cost.set(this.cost);
    const line = new Int32Array(capacity); line.set(this.line);
    this.prev = prev; this.depth = depth; this.cost = cost; this.line = line;
  }
}

/** Rank order for pruning: cost, then insertion order (pool ids increase
 *  monotonically), which reproduces a stable sort by cost exactly. */
function rank(cost: Float64Array, a: number, b: number): number {
  const difference = cost[a] - cost[b];
  return difference !== 0 ? difference : a - b;
}

/**
 * Move the `k` cheapest ids to the front, in order. The full sort this replaces
 * was ~40% of composition time: every word boundary re-sorted a few hundred
 * candidates with a comparator closure.
 */
function selectCheapest(paths: number[], k: number, cost: Float64Array) {
  const n = paths.length;
  if (k >= n) {
    paths.sort((a, b) => rank(cost, a, b));
    return;
  }
  const target = k - 1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    // Median-of-three pivot keeps the nearly sorted case linear.
    const mid = (lo + hi) >> 1;
    if (rank(cost, paths[mid], paths[lo]) < 0) { const t = paths[mid]; paths[mid] = paths[lo]; paths[lo] = t; }
    if (rank(cost, paths[hi], paths[lo]) < 0) { const t = paths[hi]; paths[hi] = paths[lo]; paths[lo] = t; }
    if (rank(cost, paths[hi], paths[mid]) < 0) { const t = paths[hi]; paths[hi] = paths[mid]; paths[mid] = t; }
    const pivot = paths[mid];
    let i = lo, j = hi;
    while (i <= j) {
      while (rank(cost, paths[i], pivot) < 0) i++;
      while (rank(cost, paths[j], pivot) > 0) j--;
      if (i <= j) { const t = paths[i]; paths[i] = paths[j]; paths[j] = t; i++; j--; }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }
  const prefix = paths.slice(0, k);
  prefix.sort((a, b) => rank(cost, a, b));
  for (let i = 0; i < k; i++) paths[i] = prefix[i];
}

/** Cost order, then keep a bounded, end-shape-diverse subset. */
function prune(paths: number[], limit: number, pool: PathPool, bins: Int32Array, stride: number,
  starts: Int32Array): number[] {
  if (paths.length === 0) return paths;
  // Only the cheapest `limit * 4` entries can matter: a bin holds at most four.
  const prefix = Math.min(paths.length, limit * 4);
  selectCheapest(paths, prefix, pool.cost);
  let kept = diversity(paths, prefix, limit, pool, bins, stride, starts);
  if (kept.length < limit && prefix < paths.length) {
    // A saturated bin can force the search deeper; sort fully so the kept set is
    // exactly what a full sort would produce.
    selectCheapest(paths, paths.length, pool.cost);
    kept = diversity(paths, paths.length, limit, pool, bins, stride, starts);
  }
  return kept;
}

function diversity(paths: number[], count: number, limit: number, pool: PathPool,
  bins: Int32Array, stride: number, starts: Int32Array): number[] {
  bins.fill(-1, 0, bins.length);
  const kept: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = paths[i];
    const key = pool.depth[id] * stride + starts[pool.line[id]];
    const seen = bins[key] < 0 ? 0 : bins[key];
    bins[key] = seen + 1;
    if (seen < 4) kept.push(id);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** A paragraph's candidate lines as columns: what the search reads. */
export interface LineColumns {
  start: Int32Array; end: Int32Array; cost: Float64Array; tracking: Float64Array; wordSpacing: Float64Array;
  kashida: Float64Array; kashidaWidth: Float64Array; stretch: Float64Array; fill: Float64Array; hyphen: Float64Array;
}
function lineColumns(table: Line[], costs: number[]): LineColumns {
  const n = table.length;
  const columns: LineColumns = {
    start: new Int32Array(n), end: new Int32Array(n), cost: Float64Array.from(costs), tracking: new Float64Array(n),
    wordSpacing: new Float64Array(n), kashida: new Float64Array(n), kashidaWidth: new Float64Array(n),
    stretch: new Float64Array(n), fill: new Float64Array(n), hyphen: new Float64Array(n),
  };
  table.forEach((l, i) => {
    columns.start[i] = l.start; columns.end[i] = l.end; columns.tracking[i] = l.tracking;
    columns.wordSpacing[i] = l.wordSpacing; columns.kashida[i] = l.kashida; columns.kashidaWidth[i] = l.kashidaWidth;
    columns.stretch[i] = l.stretch; columns.fill[i] = l.fill; columns.hyphen[i] = l.hyphen ? 1 : 0;
  });
  return columns;
}

/** `transition` over line ids. */
function transitionAt(t: LineColumns, a: number, b: number, final: boolean, r: number, fontSize: number,
  stack: number): number {
  return 0.035 * r * square((t.tracking[a] - t.tracking[b]) / 0.01)
    + (t.wordSpacing[a] !== t.wordSpacing[b] ? 0.35 * WORD_STIFFNESS * r * square(t.wordSpacing[a] - t.wordSpacing[b]) : 0)
    + (t.kashida[a] !== t.kashida[b] ? 0.35 * KASHIDA_STIFFNESS * r * square((t.kashidaWidth[a] - t.kashidaWidth[b]) / fontSize) : 0)
    + (t.stretch[a] !== t.stretch[b] ? 0.35 * WIDTH_STIFFNESS * r * square(t.stretch[a] - t.stretch[b]) : 0)
    + (final ? 0 : 0.16 * square((t.fill[a] - t.fill[b]) / 0.12))
    + (t.hyphen[a] && t.hyphen[b] ? stack : 0);
}

export interface SearchResult { retained: { ids: number[]; cost: number }[]; explored: number }
/** A faster implementation of `searchLines` (WebAssembly), when one is loaded. */
let kernel: ((t: LineColumns, total: number, beam: number, restraint: number, fontSize: number,
  stack: number) => SearchResult) | undefined;
/** The document stage in WebAssembly: chosen layout index per paragraph, and
 *  how many combinations were scored. */
type JointKernel = (counts: Int32Array, costs: Float64Array, kinds: Uint8Array, features: Float64Array,
  factor: number) => { chosen: number[]; explored: number };
let jointKernel: JointKernel | undefined;
export function setSearchKernel(next: typeof kernel, joint?: JointKernel) { kernel = next; jointKernel = next && joint; }

/** Beam search over a line table, lines grouped by start in increasing order. */
export function searchLines(t: LineColumns, total: number, beam: number, s: Settings): SearchResult {
  const stack = HYPHEN_STACK * hyphenCost(s);
  if (kernel) return kernel(t, total, beam, restraint(s), s.fontSize, stack);
  return searchLinesJs(t, total, beam, restraint(s), s.fontSize, stack);
}

export function searchLinesJs(t: LineColumns, total: number, beam: number, r: number, fontSize: number,
  stack = 0): SearchResult {
  const paths: number[][] = Array.from({ length: total + 1 }, () => []);
  const pool = new PathPool(1024 + beam * 24);
  pool.reset();
  paths[0] = [0];
  // Flat bin counters, reset per prune without allocating or hashing.
  const stride = total + 1;
  const bins = new Int32Array((total + 2) * stride).fill(-1);
  const starts = t.start;
  let explored = 0;
  let line = 0;
  for (let start = 0; start < total; start++) {
    if (start > 0) paths[start] = prune(paths[start], beam, pool, bins, stride, starts);
    const predecessors = paths[start];
    for (; line < starts.length && starts[line] === start; line++) {
      const end = t.end[line];
      const final = end === total;
      const bucket = paths[end];
      for (let i = 0; i < predecessors.length; i++) {
        const path = predecessors[i];
        const previous = pool.line[path];
        bucket.push(pool.push(path, pool.cost[path] + t.cost[line]
          + (previous < 0 ? 0 : transitionAt(t, previous, line, final, r, fontSize, stack)), line));
        explored++;
      }
      // Bound transient memory on long paragraphs.
      if (bucket.length > beam * 20) paths[end] = prune(bucket, beam * 2, pool, bins, stride, starts);
    }
    // Paths before this word will never be used again.
    paths[start] = [];
  }
  const retained = prune(paths[total], beam, pool, bins, stride, starts).map(id => {
    const ids: number[] = new Array(pool.depth[id]);
    for (let node = id, i = ids.length - 1; i >= 0; node = pool.prev[node], i--) ids[i] = pool.line[node];
    return { ids, cost: pool.cost[id] };
  });
  return { retained, explored };
}

export function paragraphCandidates(text: string, measure: Measure, s: Settings,
  beam = 32, measureAt?: MeasureAt): { layouts: Layout[]; explored: number } {
  // Preserve joining scripts: optimize Arabic word breaks, never letter-space
  // its connected glyphs. Latin/Japanese paragraphs retain the chosen bounds.
  if (hasArabic(text)) s = { ...s, trackingMin: 0, trackingMax: 0 };
  // Base letter-spacing adds a fixed advance per grapheme, like tracking.
  const base = hasArabic(text) ? 0 : s.letterSpacing ?? 0;
  if (base) {
    const plain = measure, plainAt = measureAt;
    measure = value => plain(value) + advancesOf(value) * base * s.fontSize;
    if (plainAt) measureAt = (value, stretch) => plainAt(value, stretch) + advancesOf(value) * base * s.fontSize;
  }
  const { units: words, separator, joins } = segmentText(text, s.hyphenation);
  const total = words.length;
  if (!total) return { layouts: [{ lines: [], cost: 0 }], explored: 0 };
  const separatorAdvances = separator ? advancesOf(separator) : 0;
  const unitAdvances = new Int32Array(total);
  for (let i = 0; i < total; i++) unitAdvances[i] = advancesOf(words[i]);

  // Conservative additive width bound. Only used to skip measurements that
  // cannot survive the fill/overflow rules that follow: the band absorbs
  // kerning, ligatures and contextual (Arabic) shaping differences, so a
  // skipped candidate would have been discarded anyway.
  const first = firstLine(s);
  const unitWidths = new Float64Array(total);
  for (let i = 0; i < total; i++) unitWidths[i] = measure(words[i]);
  const spaceWidth = separator ? measure(separator) : 0;
  // Word-spacing bound in em. Japanese has no separator, so no spaces to adjust.
  const spaceShrink = -(s.wordSpacingMin ?? 0) * spaceWidth / s.fontSize;
  const spaceStretch = (s.wordSpacingMax ?? 0) * spaceWidth / s.fontSize;
  // Kashida: which words can take a tatweel, as a prefix count per line range.
  const kashidaLimit = s.kashida && hasArabic(text) ? s.kashida : 0;
  const perWord = s.kashidaOptions?.perWord ?? Infinity;
  const tatweel = kashidaLimit ? measure(TATWEEL) : 0;
  // Width: whole condensing steps, only with a step-aware measure.
  const widthLimit = measureAt && s.widthFlex ? Math.round(s.widthFlex * 100) : 0;
  const sitePrefix = new Int32Array(total + 1);
  if (kashidaLimit) for (let i = 0; i < total; i++) sitePrefix[i + 1] = sitePrefix[i] + (bestSite(words[i], s.kashidaOptions) ? 1 : 0);

  // Stage 1: every line that can start where some line ends. Which lines exist
  // depends only on their start, never on the path that reached it, so this
  // runs before the search, and the search sees only numbers.
  const table: Line[] = [];
  const costs: number[] = [];
  const reachable = new Uint8Array(total + 1);
  reachable[0] = 1;
  for (let start = 0; start < total; start++) {
    if (!reachable[start]) continue;
    // The first line is set in the measure its indent leaves.
    const ls = start === 0 ? first : s;
    const band = ls.width * 0.10;
    let candidate = '';
    let advances = 0;
    let estimate = 0;
    let spaces = 0;
    for (let end = start + 1; end <= total; end++) {
      const index = end - 1;
      if (end === start + 1) {
        candidate = words[index];
        advances = unitAdvances[index];
        estimate = unitWidths[index];
      } else if (joins[index - 1]) {
        candidate = candidate + separator + words[index];
        advances += unitAdvances[index] + separatorAdvances;
        estimate += unitWidths[index] + spaceWidth;
        spaces++;
      } else {
        // Inside a hyphenated word: no space between the pieces.
        candidate = candidate + words[index];
        advances += unitAdvances[index];
        estimate += unitWidths[index];
      }
      const final = end === total;
      // A line may end inside a word only at a hyphenation point, with a hyphen.
      const hyphen = !final && separator !== '' && joins[index] === '';
      // Tracking and word spacing can move a line's width: allow for the full bounded amount.
      const trackingPx = advances * s.fontSize;
      const shrinkPx = spaceShrink > 0 ? spaceShrink * spaces * s.fontSize : 0;
      const stretchPx = spaceStretch > 0 ? spaceStretch * spaces * s.fontSize : 0;
      // Condensing by N % never narrows text by more than N % of its width.
      const longest = ls.width + band + (s.trackingMin < 0 ? -s.trackingMin * trackingPx : 0) + shrinkPx
        + (widthLimit ? estimate * widthLimit / 100 : 0);
      const lineKashida = kashidaLimit ? Math.min(kashidaLimit, (sitePrefix[end] - sitePrefix[start]) * perWord) : 0;
      const shortest = ls.width * 0.5 - band - (s.trackingMax > 0 ? s.trackingMax * trackingPx : 0) - stretchPx
        - (lineKashida ? lineKashida * tatweel : 0);
      if (estimate > longest) {
        // Beyond the overflow threshold, a longer line can only overflow further.
        if (end - start > 1) break;
      } else if (!final && estimate < shortest) {
        // Cannot reach the 0.50 fill floor that the search requires.
        continue;
      }
      const ink = hyphen ? candidate + '-' : candidate;
      const wholeWord = separator ? spaces === 0 && (start === 0 || joins[start - 1] !== '') && !hyphen : end - start === 1;
      const line = buildLine(start, end, candidate, hyphen ? measure(ink) : measure(candidate),
        hyphen ? advances + 1 : advances, total, ls, true, spaces, spaceShrink, spaceStretch,
        lineKashida, tatweel, widthLimit, measureAt, hyphen, ink, wholeWord);
      if (!line) break;
      if (!final && line.fill < 0.50 && !line.overflow) continue;
      table.push(line);
      costs.push(lineCost(line, final, start === 0 && final, ls));
      reachable[end] = 1;
    }
  }
  // Stage 2: the beam search over that table.
  const { retained, explored } = searchLines(lineColumns(table, costs), total, beam, s);
  const layouts = retained.map(({ ids, cost }) => ({ lines: ids.map(id => table[id]), cost }));
  // Retain the exact untracked greedy reference as a valid fallback candidate.
  layouts.push(greedy(text, measure, s));
  return { layouts: layouts.sort((a, b) => a.cost - b.cost), explored };
}

/**
 * Six-number summary of a layout's visual shape, in the same units and with the
 * same weights as `shapeDistance`. Body features only compare when both
 * paragraphs have a body (more than one line).
 */
const FEATURE_COUNT = 6;
const FEATURE_WEIGHTS = [2, 2, 0.25, 0.25, 0.25, 0.25];
const EMPTY = 0, SINGLE_LINE = 1, HAS_BODY = 2;

function writeFeatures(layout: Layout, out: Float64Array, offset: number): number {
  const lines = layout.lines;
  if (!lines.length) {
    for (let i = 0; i < FEATURE_COUNT; i++) out[offset + i] = 0;
    return EMPTY;
  }
  out[offset] = lines[lines.length - 1].fill;
  for (let i = 1; i < FEATURE_COUNT; i++) out[offset + i] = 0;
  if (lines.length < 2) return SINGLE_LINE;
  const body = lines.length - 1;
  let sum = 0;
  for (let i = 0; i < body; i++) sum += lines[i].fill;
  out[offset + 1] = sum / body;
  for (let sample = 0; sample < 4; sample++) {
    out[offset + 2 + sample] = lines[Math.round(sample / 3 * (body - 1))].fill;
  }
  return HAS_BODY;
}

const featureCache = new WeakMap<Layout, Float64Array>();

export function featuresOf(layout: Layout): Float64Array {
  let features = featureCache.get(layout);
  if (!features) {
    features = new Float64Array(FEATURE_COUNT);
    writeFeatures(layout, features, 0);
    featureCache.set(layout, features);
  }
  return features;
}

/** Compare normalized body contours (four samples), average fill, and endings.
 * This is our experimental document objective, not a published typographic rule.
 */
export function shapeDistance(a: Layout, b: Layout): number {
  if (!a.lines.length || !b.lines.length) return 0;
  const fa = featuresOf(a), fb = featuresOf(b);
  let cost = FEATURE_WEIGHTS[0] * square(fa[0] - fb[0]);
  if (a.lines.length > 1 && b.lines.length > 1) {
    for (let i = 1; i < FEATURE_COUNT; i++) cost += FEATURE_WEIGHTS[i] * square(fa[i] - fb[i]);
  }
  return cost;
}

export function scoreDocument(paragraphs: Layout[], s: Settings): number {
  let cost = 0;
  for (const p of paragraphs) cost += p.cost;
  if (s.sync === 0) return cost;
  const divisor = Math.max(1, paragraphs.length - 1);
  for (let i = 0; i < paragraphs.length; i++) {
    for (let j = 0; j < i; j++) {
      cost += s.sync * 65 * restraint(s) * shapeDistance(paragraphs[i], paragraphs[j]) / divisor;
    }
  }
  return cost;
}

/**
 * Fixed-width frontier for the document beam. The moments of the six
 * shape features are kept per frontier state so the pairwise term is O(1) per
 * insertion:
 *   Σ_j w·(v − a_j)² = w·(n·v² − 2·v·Σa_j + Σa_j²)
 */
interface DocState {
  parent: DocState | null;
  layout: Layout;
  cost: number;
  count: number; // non-empty layouts (feature 0 is always compared)
  bodyCount: number; // layouts with a body (features 1..5)
  sum0: number;
  sumSq0: number;
  sumBody: Float64Array;
  sumSqBody: Float64Array;
}

function childState(parent: DocState, layout: Layout, features: Float64Array, offset: number,
  kind: number, factor: number): DocState {
  let cost = parent.cost + layout.cost;
  let { count, bodyCount, sum0, sumSq0 } = parent;
  let sumBody = parent.sumBody, sumSqBody = parent.sumSqBody;
  if (kind !== EMPTY) {
    const v = features[offset];
    cost += factor * FEATURE_WEIGHTS[0] * (count * v * v - 2 * v * sum0 + sumSq0);
    count += 1; sum0 += v; sumSq0 += v * v;
    if (kind === HAS_BODY) {
      const nextSum = Float64Array.from(sumBody);
      const nextSq = Float64Array.from(sumSqBody);
      for (let i = 1; i < FEATURE_COUNT; i++) {
        const value = features[offset + i];
        const sum = sumBody[i - 1], sumSq = sumSqBody[i - 1];
        cost += factor * FEATURE_WEIGHTS[i] * (bodyCount * value * value - 2 * value * sum + sumSq);
        nextSum[i - 1] = sum + value;
        nextSq[i - 1] = sumSq + value * value;
      }
      sumBody = nextSum; sumSqBody = nextSq; bodyCount += 1;
    }
  }
  return { parent, layout, cost, count, bodyCount, sum0, sumSq0, sumBody, sumSqBody };
}

/** Pairwise cost of adding `features` to `state`, without allocating. */
function pairCost(state: DocState, features: Float64Array, offset: number, kind: number, factor: number): number {
  if (kind === EMPTY) return 0;
  const v = features[offset];
  let cost = FEATURE_WEIGHTS[0] * (state.count * v * v - 2 * v * state.sum0 + state.sumSq0);
  if (kind === HAS_BODY) {
    for (let i = 1; i < FEATURE_COUNT; i++) {
      const value = features[offset + i];
      cost += FEATURE_WEIGHTS[i]
        * (state.bodyCount * value * value - 2 * value * state.sumBody[i - 1] + state.sumSqBody[i - 1]);
    }
  }
  return factor * cost;
}

/** Bounded max-heap of (cost, insertion order), keeping the k smallest. Ties
 * resolve by insertion order so the beam is deterministic and matches a stable
 * sort of the full frontier. */
class TopK {
  private costs: Float64Array;
  private orders: Float64Array;
  size = 0;
  constructor(private limit: number) {
    const capacity = Math.max(1, limit);
    this.costs = new Float64Array(capacity);
    this.orders = new Float64Array(capacity);
  }
  /** True when (aCost, aOrder) ranks before (bCost, bOrder). */
  private static before(aCost: number, aOrder: number, bCost: number, bOrder: number) {
    return aCost < bCost || (aCost === bCost && aOrder < bOrder);
  }
  offer(cost: number, order: number) {
    const { costs, orders, limit } = this;
    if (this.size < limit) {
      let i = this.size++;
      costs[i] = cost; orders[i] = order;
      while (i > 0) {
        // Max-heap: the worst kept entry stays at the root, so bubble up while
        // this new entry is worse than its parent.
        const parent = (i - 1) >> 1;
        if (TopK.before(cost, order, costs[parent], orders[parent])) break;
        costs[i] = costs[parent]; orders[i] = orders[parent];
        costs[parent] = cost; orders[parent] = order;
        i = parent;
      }
      return;
    }
    // Full: the root is the worst kept entry.
    if (!TopK.before(cost, order, costs[0], orders[0])) return;
    costs[0] = cost; orders[0] = order;
    let i = 0;
    for (;;) {
      // The root must stay the worst kept entry, so sift the worst child up.
      const left = i * 2 + 1, right = left + 1;
      let worst = i;
      if (left < this.size && TopK.before(costs[worst], orders[worst], costs[left], orders[left])) worst = left;
      if (right < this.size && TopK.before(costs[worst], orders[worst], costs[right], orders[right])) worst = right;
      if (worst === i) break;
      const c = costs[i], o = orders[i];
      costs[i] = costs[worst]; orders[i] = orders[worst];
      costs[worst] = c; orders[worst] = o;
      i = worst;
    }
  }
  sorted(): { cost: number; order: number }[] {
    const out = Array.from({ length: this.size }, (_, i) => ({ cost: this.costs[i], order: this.orders[i] }));
    out.sort((a, b) => a.cost - b.cost || a.order - b.order);
    return out;
  }
}

/** Layouts whose shortest and average body lines are within HARMONY_SLACK of
 *  the best layout's. Single-line layouts have no body and always qualify. */
export function asEvenAsBest(layouts: Layout[]): Layout[] {
  const body = (layout: Layout) => {
    const lines = layout.lines.slice(0, -1);
    if (!lines.length) return undefined;
    let shortest = Infinity, total = 0;
    for (const line of lines) { shortest = Math.min(shortest, line.fill); total += line.fill; }
    return { shortest, mean: total / lines.length };
  };
  const best = body(layouts[0]);
  if (!best) return layouts;
  return layouts.filter(layout => {
    const b = body(layout);
    return !b || (b.shortest >= best.shortest - HARMONY_SLACK && b.mean >= best.mean - HARMONY_SLACK);
  });
}

export function compose(texts: string[], measure: Measure, s: Settings, measureAt?: MeasureAt): Composition {
  return composeCandidates(texts.map((text, i) => paragraphCandidates(text, measure, paragraphSettings(s, i), 32, measureAt)), s);
}

/** The joint stage alone: choose one retained layout per paragraph. Paragraph
 *  candidates are independent, so they may come from several workers. */
export function composeCandidates(options: { layouts: Layout[]; explored: number }[], s: Settings): Composition {
  let explored = options.reduce((sum, option) => sum + option.explored, 0);
  let candidates = 0;
  for (const option of options) candidates += option.layouts.length;
  if (s.sync === 0) {
    // With no pairwise terms this objective is separable; skip joint enumeration.
    const paragraphs = options.map(option => option.layouts[0]);
    return { paragraphs, cost: paragraphs.reduce((sum, p) => sum + p.cost, 0), explored, candidates };
  }
  // Harmony never worsens a paragraph's body: it only chooses among layouts
  // whose body is as even as the paragraph's best.
  options = options.map(option => ({ ...option, layouts: asEvenAsBest(option.layouts) }));

  // One feature table for every candidate layout: no per-comparison work.
  const offsets = new Int32Array(options.length);
  let total = 0;
  for (let i = 0; i < options.length; i++) { offsets[i] = total; total += options[i].layouts.length; }
  const features = new Float64Array(total * FEATURE_COUNT);
  const kinds = new Uint8Array(total);
  for (let i = 0; i < options.length; i++) {
    const layouts = options[i].layouts;
    for (let k = 0; k < layouts.length; k++) {
      kinds[offsets[i] + k] = writeFeatures(layouts[k], features, (offsets[i] + k) * FEATURE_COUNT);
    }
  }

  // Harmony yields to edge firmness: it must not break an edge held flush.
  const factor = s.sync * 65 * restraint(s) / Math.max(1, options.length - 1);
  if (jointKernel && options.length) {
    const counts = Int32Array.from(options, option => option.layouts.length);
    const costs = Float64Array.from(options.flatMap(option => option.layouts.map(layout => layout.cost)));
    const { chosen, explored: scored } = jointKernel(counts, costs, kinds, features, factor);
    const paragraphs = chosen.map((k, i) => options[i].layouts[k]);
    return { paragraphs, cost: scoreDocument(paragraphs, s), explored: explored + scored, candidates };
  }
  const zero = new Float64Array(FEATURE_COUNT - 1);
  let frontier: DocState[] = [{
    parent: null, layout: { lines: [], cost: 0 }, cost: 0,
    count: 0, bodyCount: 0, sum0: 0, sumSq0: 0, sumBody: zero, sumSqBody: zero,
  }];
  for (let i = 0; i < options.length; i++) {
    const layouts = options[i].layouts;
    const offset = offsets[i];
    const limit = options.length <= 3 && i < options.length - 1 ? 1200 : 128;
    const top = new TopK(limit);
    let order = 0;
    for (let f = 0; f < frontier.length; f++) {
      const state = frontier[f];
      for (let k = 0; k < layouts.length; k++) {
        const index = offset + k;
        const cost = state.cost + layouts[k].cost
          + pairCost(state, features, index * FEATURE_COUNT, kinds[index], factor);
        top.offer(cost, order++);
      }
    }
    explored += order;
    const retained = top.sorted();
    const next: DocState[] = new Array(retained.length);
    for (let n = 0; n < retained.length; n++) {
      const insertion = retained[n].order;
      const f = (insertion / layouts.length) | 0;
      const k = insertion - f * layouts.length;
      const index = offset + k;
      next[n] = childState(frontier[f], layouts[k], features, index * FEATURE_COUNT, kinds[index], factor);
    }
    frontier = next;
  }

  const paragraphs: Layout[] = [];
  // The chain root is a virtual empty state, not a paragraph.
  for (let state: DocState | null = frontier[0] ?? null; state?.parent; state = state.parent) paragraphs.push(state.layout);
  paragraphs.reverse();
  return { paragraphs, cost: scoreDocument(paragraphs, s), explored, candidates };
}

/** Internal hooks used by the equivalence tests. Not part of the public API. */
export const internals = { childState, pairCost, TopK, selectCheapest, rank, FEATURE_COUNT, FEATURE_WEIGHTS, writeFeatures };

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
