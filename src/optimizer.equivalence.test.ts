/**
 * Equivalence tests: the optimized search must return the same layouts as the
 * reference implementations, not merely plausible ones.
 *
 *  - `paragraphCandidates` uses back-pointers, incremental candidate strings and
 *    an additive width bound to skip measurements. None of that may change the
 *    retained candidate set.
 *  - `compose` replaces the per-pair contour comparison with running moments.
 *    The chosen paragraph combination must be identical.
 *  - `shapeDistance` must reproduce the original contour math.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, greedy, internals, paragraphCandidates, shapeDistance } from './optimizer';
import type { Layout, Measure, Settings } from './optimizer';
import { samples } from './samples';
import { referenceCompose, referenceGreedy, referenceParagraphCandidates, shapeDistanceReference } from '../bench/reference-compose';

const base: Settings = {
  width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
  rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true,
};

/** Deterministic font, independent of platform metrics. */
const fakeMeasure = (text: string) => Array.from(text)
  .reduce((n, c) => n + (c === ' ' ? 4 : /[il.,!']/u.test(c) ? 3 : /[MW]/u.test(c) ? 11 : 7), 0);

/** Slightly irregular measure to exercise kerning-like discrepancies. */
const wobblyMeasure = (text: string) => {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    width += c === ' ' ? 4.1 : /[il.,!']/u.test(c) ? 3.2 : /[MW]/u.test(c) ? 10.7 : 7.05;
    if (i > 0 && /[AVWY]/u.test(text[i - 1]) && /[a-z]/u.test(c)) width -= 0.35;
  }
  return width;
};

const editorial = samples.editorial.split('\n\n');
const documents: { name: string; texts: string[] }[] = [
  { name: 'editorial (3)', texts: editorial },
  { name: 'literature (3)', texts: samples.literature.split('\n\n') },
  { name: 'difficult (3)', texts: samples.difficult.split('\n\n') },
  { name: 'japanese (3)', texts: samples.japanese.split('\n\n') },
  { name: 'arabic (3)', texts: samples.arabic.split('\n\n') },
  { name: 'mixed (6)', texts: [editorial[0], samples.literature.split('\n\n')[1], editorial[1], samples.japanese.split('\n\n')[0], editorial[2], samples.difficult.split('\n\n')[2]] },
  { name: 'short + empty (5)', texts: ['Hello', '', 'A short line.', editorial[0], '   '] },
  { name: 'repeated (10)', texts: [...editorial, ...editorial, ...editorial, editorial[0]] },
];

const measures: { name: string; measure: Measure }[] = [
  { name: 'uniform', measure: fakeMeasure },
  { name: 'wobbly', measure: wobblyMeasure },
];

const variants: { name: string; s: Settings }[] = [
  { name: 'default', s: base },
  { name: 'narrow', s: { ...base, width: 240 } },
  { name: 'wide', s: { ...base, width: 720 } },
  { name: 'no tracking', s: { ...base, trackingMin: 0, trackingMax: 0 } },
  { name: 'shrink only', s: { ...base, trackingMin: -0.03, trackingMax: 0 } },
  { name: 'expand only', s: { ...base, trackingMin: 0, trackingMax: 0.02 } },
  { name: 'independent', s: { ...base, sync: 0 } },
  { name: 'full harmony', s: { ...base, sync: 1 } },
  { name: 'no ending protection', s: { ...base, protectEndings: false } },
  { name: 'large type', s: { ...base, fontSize: 24, rag: 0.02, minEnding: 0.45 } },
];

const signature = (layouts: Layout[]) => layouts.map(p => ({
  cost: p.cost,
  lines: p.lines.map(l => [l.start, l.end, l.text, Math.round(l.tracking * 1e12), Math.round(l.width * 1e6), l.overflow]),
}));

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test('paragraphCandidates retains exactly the reference candidate set', () => {
  let checked = 0;
  for (const { texts } of documents) {
    for (const { measure } of measures) {
      for (const { s } of variants) {
        for (const text of texts) {
          const fast = paragraphCandidates(text, measure, s);
          const slow = referenceParagraphCandidates(text, measure, s);
          assert.equal(fast.layouts.length, slow.layouts.length, `candidate count for "${text.slice(0, 24)}…"`);
          assert.equal(fast.explored, slow.explored, 'explored path count');
          for (let i = 0; i < fast.layouts.length; i++) {
            const a = fast.layouts[i], b = slow.layouts[i];
            assert.ok(closeEnough(a.cost, b.cost), `candidate ${i} cost ${a.cost} vs ${b.cost}`);
            assert.deepEqual(
              a.lines.map(l => [l.start, l.end, l.text, Math.round(l.tracking * 1e12), Math.round(l.width * 1e6), l.overflow]),
              b.lines.map(l => [l.start, l.end, l.text, Math.round(l.tracking * 1e12), Math.round(l.width * 1e6), l.overflow]),
              `candidate ${i} lines`,
            );
          }
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 400, `checked ${checked} paragraphs`);
});

test('greedy fallback matches the reference exactly', () => {
  for (const { texts } of documents) {
    for (const { measure } of measures) {
      for (const { s } of variants) {
        for (const text of texts) {
          assert.deepEqual(signature([greedy(text, measure, s)]), signature([referenceGreedy(text, measure, s)]));
        }
      }
    }
  }
});

test('joint document search matches the reference combination', () => {
  for (const { texts } of documents) {
    for (const { measure } of measures) {
      for (const { s } of variants) {
        const fast = compose(texts, measure, s);
        const slow = referenceCompose(texts, measure, s);
        // Repeated paragraphs make some combinations exactly symmetric; compare
        // the chosen layouts as a multiset so an equivalent swap still passes.
        const key = (p: ReturnType<typeof signature>[number]) => `${p.cost}:${p.lines[0]?.join()}`;
        assert.deepEqual(
          signature(fast.paragraphs).sort((a, b) => key(a).localeCompare(key(b))),
          signature(slow.paragraphs).sort((a, b) => key(a).localeCompare(key(b))),
        );
        assert.ok(closeEnough(fast.cost, slow.cost), `document cost ${fast.cost} vs ${slow.cost}`);
        assert.equal(fast.paragraphs.length, texts.length);
      }
    }
  }
});

test('selectCheapest returns exactly the k cheapest ids, in order', () => {
  const { selectCheapest, rank } = internals;
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(Math.random() * 400);
    const k = 1 + Math.floor(Math.random() * n);
    const cost = new Float64Array(n);
    const ids = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < n; i++) cost[i] = Math.round(Math.random() * 40) / 8;
    const shuffled = ids.slice().sort(() => Math.random() - 0.5);
    const expected = shuffled.slice().sort((a, b) => rank(cost, a, b)).slice(0, k);
    selectCheapest(shuffled, k, cost);
    assert.deepEqual(shuffled.slice(0, k), expected, `n=${n} k=${k}`);
  }
});

test('shapeDistance matches the original contour formula', () => {
  for (const { texts } of documents.slice(0, 4)) {
    const fast = texts.map(t => paragraphCandidates(t, fakeMeasure, base).layouts);
    for (const group of fast) {
      for (const a of group.slice(0, 6)) {
        for (const b of group.slice(0, 6)) {
          assert.ok(Math.abs(shapeDistance(a, b) - shapeDistanceReference(a, b)) < 1e-12,
            `${shapeDistance(a, b)} vs ${shapeDistanceReference(a, b)}`);
        }
      }
    }
  }
});
