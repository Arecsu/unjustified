/**
 * Pure-search benchmark: no DOM. Run with `pnpm tsx bench/optimizer-bench.ts`.
 *
 * Measures `compose()` for document sizes that matter (3 → 40 paragraphs) with
 * a deterministic synthetic advance table. Reports wall time, `explored` path
 * counts, allocations proxy (GC time is visible through run-to-run spread) and
 * per-paragraph candidate counts.
 */
import { compose, paragraphCandidates, metrics } from '../src/optimizer';
import type { Layout, Settings } from '../src/optimizer';
import { makeParagraphs, chars } from './corpus';

const settings: Settings = {
  width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
  rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true,
};

// Deterministic "font": widths per character class, with a cheap cache so the
// measure function is not the bottleneck we are trying to isolate.
const advance = (c: string) => c === ' ' ? 4.2 : /[ilj.,!'|]/u.test(c) ? 4.6
  : /[MWmw@]/u.test(c) ? 15.5 : /[A-Z]/u.test(c) ? 11 : 8.4;
const memo = new Map<string, number>();
const measure = (text: string) => {
  let width = memo.get(text);
  if (width === undefined) {
    width = 0;
    for (let i = 0; i < text.length; i++) width += advance(text[i]);
    memo.set(text, width);
  }
  return width;
};

const now = () => performance.now();
const fmt = (n: number) => n.toFixed(2).padStart(8);

function time(fn: () => void, runs: number) {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = now();
    fn();
    samples.push(now() - start);
  }
  samples.sort((a, b) => a - b);
  return { min: samples[0], median: samples[(samples.length / 2) | 0], max: samples.at(-1)! };
}

console.log('paragraphs  chars  words   candidates  explored  compose ms (min/median)  per-paragraph ms');
for (const count of [3, 8, 20, 32, 40]) {
  const texts = makeParagraphs(count);
  const wordCount = texts.reduce((n, t) => n + t.split(/\s+/).length, 0);
  let result = compose(texts, measure, settings);
  const candidates = result.candidates;
  const explored = result.explored;
  const t = time(() => { result = compose(texts, measure, settings); }, 5);
  console.log(`${String(count).padStart(10)}  ${String(chars(texts)).padStart(5)}  ${String(wordCount).padStart(5)}  ${String(candidates).padStart(10)}  ${String(explored).padStart(8)}  ${fmt(t.min)}  ${fmt(t.median)}          ${(t.median / count).toFixed(2)}`);
}

// Where the time goes for one large document: candidates vs joint selection.
const texts = makeParagraphs(40);
const all = time(() => { for (const text of texts) paragraphCandidates(text, measure, settings); }, 5);
const s0 = { ...settings, sync: 0 };
const syncOff = time(() => { compose(texts, measure, s0); }, 5);
const syncOn = time(() => { compose(texts, measure, settings); }, 5);
console.log(`\n40 paragraphs, sync=0 (independent): ${fmt(syncOff.median)} ms`);
console.log(`40 paragraphs, sync=1 (joint beam): ${fmt(syncOn.median)} ms`);
console.log(`40 paragraphs, candidates only:     ${fmt(all.median)} ms`);
const judged = metrics(compose(texts, measure, settings).paragraphs, settings);
console.log(`quality: ragged deviation ${(judged.deviation * 100).toFixed(2)}%, short endings ${judged.shortEndings}, lines ${judged.lines}, max tracking ${judged.maxTracking.toFixed(4)}em`);

export type { Layout };
