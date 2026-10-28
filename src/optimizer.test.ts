import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, greedy, metrics, scoreDocument, shapeDistance, wordsOf } from './optimizer';
import type { Settings } from './optimizer';
import { trackingAdvances } from './text-metrics';
import { segmentText, directionFor } from './language';
import { samples } from './samples';

const settings: Settings = {
  width: 240, fontSize: 16, trackingMin: -0.012, trackingMax: 0.012, rag: 0.055,
  minEnding: 0.32, sync: 0.65, protectEndings: true,
};
// Predictable proportional-ish font, independent of DOM / platform font metrics.
const measure = (text: string) => Array.from(text).reduce((n, c) => n + (c === ' ' ? 4 : /[il.,!']/u.test(c) ? 3 : /[MW]/u.test(c) ? 11 : 7), 0);
const texts = [
  'Typography is the quiet architecture of a page. Before we read a single word, we notice its shape: the texture of a paragraph, the space around a thought, the gentle rhythm of one line giving way to the next.',
  'A straight right edge is not the only way to find balance. Left to their own devices, words can leave awkward gaps and lonely endings. A little consideration lets them settle into something more deliberate, without losing their natural character.',
  'The best adjustments are often the ones we never notice. A word moves up, another moves down, and the smallest change in spacing makes room for a better ending. Not perfectly aligned. Just a little more at ease.',
];

test('preserves words, order, punctuation and paragraph boundaries', () => {
  const result = compose(texts, measure, settings);
  assert.equal(result.paragraphs.length, 3);
  result.paragraphs.forEach((p, i) => {
    assert.deepEqual(p.lines.flatMap(l => wordsOf(l.text)), wordsOf(texts[i]));
    let cursor = 0;
    for (const line of p.lines) {
      assert.equal(line.start, cursor);
      assert.equal(line.end - line.start, wordsOf(line.text).length);
      cursor = line.end;
    }
    assert.equal(cursor, wordsOf(texts[i]).length);
  });
});

test('all feasible lines fit and tracking remains strictly bounded', () => {
  for (const width of [140, 240, 390, 620]) {
    for (const tracking of [0, 0.006, 0.012, 0.04]) {
      const s = { ...settings, width, trackingMin: -tracking, trackingMax: tracking };
      const result = compose(texts, measure, s);
      for (const line of result.paragraphs.flatMap(p => p.lines)) {
        assert.ok(Math.abs(line.tracking) <= tracking + 1e-10);
        assert.ok(line.width <= width + 0.05, `overflow: ${line.text}`);
        assert.ok(!line.overflow);
        const advances = Array.from(line.text).length;
        assert.ok(Math.abs(line.width - measure(line.text) - advances * s.fontSize * line.tracking) < 1e-8);
      }
    }
  }
});

test('zero tracking gives exactly natural widths, with no extra word spacing', () => {
  const result = compose(texts, measure, { ...settings, trackingMin: 0, trackingMax: 0 });
  for (const line of result.paragraphs.flatMap(p => p.lines)) {
    assert.equal(line.tracking, 0);
    assert.equal(line.width, measure(line.text));
  }
});

test('preserves and reports an impossible unbreakable word, without hyphenating', () => {
  const text = 'One pneumonoultramicroscopicsilicovolcanoconiosis remains intact.';
  const result = compose([text], measure, { ...settings, width: 100 });
  const lines = result.paragraphs[0].lines;
  assert.deepEqual(lines.flatMap(l => wordsOf(l.text)), wordsOf(text));
  assert.ok(lines.some(l => l.overflow && l.text === 'pneumonoultramicroscopicsilicovolcanoconiosis'));
  assert.ok(metrics(result.paragraphs, { ...settings, width: 100 }).overflow);
});

test('empty, whitespace-only, single-word and one-line inputs are safe', () => {
  assert.deepEqual(compose([], measure, settings).paragraphs, []);
  for (const text of ['', '   \n  ', 'Hello', 'A short line.']) {
    const result = compose([text], measure, settings);
    assert.equal(result.paragraphs.length, 1);
    assert.deepEqual(result.paragraphs[0].lines.flatMap(l => wordsOf(l.text)), wordsOf(text));
    assert.ok(Number.isFinite(result.cost));
  }
});

test('deterministic search and reported document cost are reproducible', () => {
  const a = compose(texts, measure, settings);
  const b = compose(texts, measure, settings);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.cost - scoreDocument(a.paragraphs, settings)) < 1e-8);
  assert.ok(a.explored > 0);
});

test('with coupling off, result is no worse than the retained greedy fallback', () => {
  const s = { ...settings, sync: 0 };
  const result = compose(texts, measure, s);
  const reference = texts.map(t => greedy(t, measure, s));
  assert.ok(result.cost <= scoreDocument(reference, s) + 1e-8);
});

test('coupling changes the actual joint layout rather than just the displayed score', () => {
  const independent = compose(texts, measure, { ...settings, sync: 0 });
  const coupled = compose(texts, measure, { ...settings, sync: 1 });
  const distance = (ps: typeof independent.paragraphs) => ps.reduce((sum, p, i) =>
    sum + ps.slice(0, i).reduce((n, other) => n + shapeDistance(p, other), 0), 0);
  assert.ok(distance(coupled.paragraphs) < distance(independent.paragraphs));
  assert.notDeepEqual(coupled.paragraphs, independent.paragraphs);
});

test('short-ending protection discourages single-word / tiny endings', () => {
  const s = { ...settings, width: 290, trackingMin: 0, trackingMax: 0, sync: 0, minEnding: 0.5 };
  const protectedResult = compose(texts, measure, { ...s, protectEndings: true });
  const unprotectedResult = compose(texts, measure, { ...s, protectEndings: false });
  assert.ok(metrics(protectedResult.paragraphs, s).shortEndings <= metrics(unprotectedResult.paragraphs, s).shortEndings);
});

test('asymmetric, shrink-only and expand-only tracking limits are enforced', () => {
  for (const [trackingMin, trackingMax] of [[-0.025, 0.004], [-0.02, 0], [0, 0.018]]) {
    const s = { ...settings, trackingMin, trackingMax };
    const result = compose(texts, measure, s);
    for (const line of result.paragraphs.flatMap(p => p.lines)) {
      assert.ok(line.tracking >= trackingMin - 1e-10);
      assert.ok(line.tracking <= trackingMax + 1e-10);
    }
  }
});

test('tracking counts grapheme clusters rather than UTF-16 or code points', () => {
  assert.equal(trackingAdvances('office'), 6);
  assert.equal(trackingAdvances('cafe\u0301'), 4);
  assert.equal(trackingAdvances('👩‍💻'), 1);
  assert.equal(trackingAdvances('A 🇦🇷 B'), 5);
});

test('Japanese breaks preserve text and avoid leading closing punctuation', () => {
  const input = samples.japanese.split('\n\n');
  const result = compose(input, measure, settings);
  result.paragraphs.forEach((p, i) => {
    assert.equal(p.lines.map(line => line.text).join(''), input[i]);
    for (const line of p.lines) {
      assert.ok(!/^[、。）」』！？]/u.test(line.text));
      assert.ok(!/[（「『]$/u.test(line.text));
      assert.ok(!line.overflow);
    }
  });
  assert.equal(segmentText('「こんにちは。」').separator, '');
});

test('Arabic preserves words and joining-script tracking remains zero', () => {
  const input = samples.arabic.split('\n\n');
  const result = compose(input, measure, settings);
  result.paragraphs.forEach((p, i) => {
    assert.equal(p.lines.map(line => line.text).join(' '), input[i]);
    assert.ok(p.lines.every(line => line.tracking === 0));
  });
});

test('automatic direction uses the first strong letter, with explicit overrides', () => {
  assert.equal(directionFor('123 العربية', 'auto'), 'rtl');
  assert.equal(directionFor('「日本語」', 'auto'), 'ltr');
  assert.equal(directionFor('English العربية', 'auto'), 'ltr');
  assert.equal(directionFor('العربية', 'ltr'), 'ltr');
  assert.equal(directionFor('English', 'rtl'), 'rtl');
});

test('larger documents use a bounded search and still preserve all text', () => {
  const input = [...texts, ...texts, texts[0], texts[1]];
  const result = compose(input, measure, settings);
  assert.equal(result.paragraphs.length, 8);
  result.paragraphs.forEach((p, i) => assert.deepEqual(p.lines.flatMap(l => wordsOf(l.text)), wordsOf(input[i])));
  assert.ok(Number.isFinite(result.cost));
});
