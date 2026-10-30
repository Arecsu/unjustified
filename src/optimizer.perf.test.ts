/**
 * Scaling guard for the pure search (no DOM, no Canvas).
 *
 * Documents are generated deterministically, so both the explored-path counts
 * and the wall-clock budget are stable. The counts are a snapshot: if the search
 * changes intentionally, update them. The budget is deliberately ~10x the
 * observed time so it only fires on a real regression (the pre-optimization
 * implementation took ~930 ms for 40 paragraphs and explored 4x more state via
 * pairwise comparison).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from './optimizer';
import type { Settings } from './optimizer';
import { makeParagraphs } from '../bench/corpus';

const settings: Settings = {
  width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
  rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true,
};

// Deterministic advance table with memoization: measures the search, not `measureText`.
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

const expected = [
  { paragraphs: 3, explored: 6905, budgetMs: 60 },
  { paragraphs: 8, explored: 39649, budgetMs: 90 },
  { paragraphs: 20, explored: 130564, budgetMs: 200 },
  { paragraphs: 40, explored: 252879, budgetMs: 400 },
];

test('document search scales linearly in paragraphs and keeps its path counts', () => {
  const timings: number[] = [];
  for (const { paragraphs, explored, budgetMs } of expected) {
    const texts = makeParagraphs(paragraphs);
    const result = compose(texts, measure, settings);
    assert.equal(result.explored, explored, `explored paths for ${paragraphs} paragraphs`);
    assert.equal(result.paragraphs.length, paragraphs);
    const start = performance.now();
    compose(texts, measure, settings);
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    assert.ok(elapsed < budgetMs, `${paragraphs} paragraphs took ${elapsed.toFixed(1)} ms (budget ${budgetMs} ms)`);
  }
  // Per-paragraph cost must not grow with document length: the pairwise contour
  // term used to make this superlinear (12 ms/paragraph at 3, 23 ms at 40).
  const perParagraph = expected.map((entry, i) => timings[i] / entry.paragraphs);
  assert.ok(perParagraph.at(-1)! < perParagraph[0] * 4,
    `per-paragraph cost grew from ${perParagraph[0].toFixed(2)} to ${perParagraph.at(-1)!.toFixed(2)} ms`);
});

test('harmony coupling does not reintroduce pairwise cost', () => {
  const texts = makeParagraphs(40);
  const independent = (() => {
    const start = performance.now();
    compose(texts, measure, { ...settings, sync: 0 });
    return performance.now() - start;
  })();
  const coupled = (() => {
    const start = performance.now();
    compose(texts, measure, { ...settings, sync: 1 });
    return performance.now() - start;
  })();
  // Running moments make the pairwise term O(1) per insertion, so full coupling
  // may cost a little more than no coupling but never a multiple.
  assert.ok(coupled < independent * 3 + 60,
    `coupled ${coupled.toFixed(1)} ms vs independent ${independent.toFixed(1)} ms`);
});
