import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, greedy, metrics, paragraphSettings, scoreDocument, shapeDistance, wordsOf } from './optimizer';
import type { Settings } from './optimizer';
import { trackingAdvances } from './text-metrics';
import { segmentText, directionFor } from './language';
import { samples } from './samples';
import { placeKashida } from './kashida';

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

test('edge firmness spends tracking to even the edge, and zero changes nothing', () => {
  const loose = { ...settings, trackingMin: -0.08, trackingMax: 0.08, rag: 0 };
  assert.deepEqual(compose(texts, measure, { ...settings, firmness: 0 }), compose(texts, measure, settings));
  const before = metrics(compose(texts, measure, loose).paragraphs, loose);
  const firm = { ...loose, firmness: 1 };
  const after = metrics(compose(texts, measure, firm).paragraphs, firm);
  assert.ok(after.deviation < before.deviation / 4, `${after.deviation} vs ${before.deviation}`);
  assert.ok(after.maxTracking <= 0.08 + 1e-9);
  assert.equal(after.overflow, false);
});

test('word spacing at zero changes nothing', () => {
  assert.deepEqual(compose(texts, measure, { ...settings, wordSpacingMin: -0, wordSpacingMax: 0 }), compose(texts, measure, settings));
});

test('word spacing evens the edge on its own, within its bounds', () => {
  // Tracking off so only word spacing can move the edge.
  const flat = { ...settings, trackingMin: 0, trackingMax: 0, rag: 0, firmness: 1 };
  const before = metrics(compose(texts, measure, flat).paragraphs, flat);
  const spaced = { ...flat, wordSpacingMin: -0.5, wordSpacingMax: 0.5 };
  const result = compose(texts, measure, spaced);
  const after = metrics(result.paragraphs, spaced);
  assert.ok(after.deviation < before.deviation, `${after.deviation} vs ${before.deviation}`);
  assert.ok(result.paragraphs.some(p => p.lines.some(l => l.wordSpacing !== 0)));
  // The test measure gives a space 4 px at 16 px type: 0.25 em, so 50 % is 0.125 em.
  const limit = 0.5 * 4 / settings.fontSize;
  for (const line of result.paragraphs.flatMap(p => p.lines)) {
    assert.ok(Math.abs(line.wordSpacing) <= limit + 1e-12, `${line.wordSpacing}`);
    assert.equal(line.tracking, 0);
  }
  assert.equal(after.overflow, false);
});

test('word spacing never applies to Japanese, which has no word spaces', () => {
  const japanese = samples.japanese.split('\n\n');
  const result = compose(japanese, measure, { ...settings, wordSpacingMin: -0.5, wordSpacingMax: 0.5, firmness: 1 });
  for (const line of result.paragraphs.flatMap(p => p.lines)) assert.equal(line.wordSpacing, 0);
});

test('word spacing works on Arabic while its tracking stays locked at zero', () => {
  const arabic = samples.arabic.split('\n\n');
  const s = { ...settings, wordSpacingMin: -0.5, wordSpacingMax: 0.5, firmness: 1, rag: 0 };
  const lines = compose(arabic, measure, s).paragraphs.flatMap(p => p.lines);
  assert.ok(lines.some(line => line.wordSpacing !== 0));
  for (const line of lines) assert.equal(line.tracking, 0);
});

test('kashida at zero changes nothing', () => {
  const arabic = samples.arabic.split('\n\n');
  assert.deepEqual(compose(arabic, measure, { ...settings, kashida: 0 }), compose(arabic, measure, settings));
});

test('kashida evens Arabic lines with whole tatweels, only where a word can take one', () => {
  const arabic = samples.arabic.split('\n\n');
  const flat = { ...settings, rag: 0, firmness: 1 };
  const before = metrics(compose(arabic, measure, flat).paragraphs, flat);
  const stretched = { ...flat, kashida: 4 };
  const result = compose(arabic, measure, stretched);
  const after = metrics(result.paragraphs, stretched);
  assert.ok(after.deviation < before.deviation, `${after.deviation} vs ${before.deviation}`);
  const lines = result.paragraphs.flatMap(p => p.lines);
  assert.ok(lines.some(line => line.kashida > 0));
  for (const line of lines) {
    assert.ok(Number.isInteger(line.kashida) && line.kashida >= 0 && line.kashida <= 4, `${line.kashida}`);
    if (line.kashida) assert.ok(placeKashida(wordsOf(line.text), line.kashida).some(n => n > 0));
    assert.equal(line.tracking, 0);
  }
  assert.equal(after.overflow, false);
});

test('kashida keeps to its options: sites, words and how many each stacks', () => {
  const arabic = samples.arabic.split('\n\n');
  const options = { sites: 0b0011, minLetters: 4, perWord: 1 };
  const s = { ...settings, rag: 0, firmness: 1, kashida: 4, kashidaOptions: options };
  for (const line of compose(arabic, measure, s).paragraphs.flatMap(p => p.lines)) {
    if (!line.kashida) continue;
    const placed = placeKashida(wordsOf(line.text), line.kashida, options);
    assert.equal(placed.reduce((a, b) => a + b, 0), line.kashida, 'every counted tatweel has a place');
    assert.ok(placed.every(n => n <= 1));
  }
});

test('kashida frequency trades tatweels for word spacing', () => {
  const arabic = samples.arabic.split('\n\n');
  const s = { ...settings, kashida: 4, wordSpacingMin: -0.2, wordSpacingMax: 2 };
  const use = (f: number) => {
    const lines = compose(arabic, measure, { ...s, kashidaFrequency: f }).paragraphs.flatMap(p => p.lines);
    return { tatweels: lines.reduce((n, l) => n + l.kashida, 0), spaces: lines.reduce((n, l) => n + Math.max(0, l.wordSpacing), 0) };
  };
  const spaces = use(0), kashida = use(1);
  assert.ok(kashida.tatweels > spaces.tatweels, `${kashida.tatweels} vs ${spaces.tatweels}`);
  assert.ok(kashida.spaces < spaces.spaces, `${kashida.spaces} vs ${spaces.spaces}`);
});

test('an indent shortens the first line of the paragraphs it applies to', () => {
  const s = { ...settings, indent: 60 };
  const result = compose(texts, measure, s);
  result.paragraphs.forEach(p => assert.ok(p.lines[0].width <= s.width - s.indent + 0.05, `${p.lines[0].width}`));
  assert.equal(paragraphSettings({ ...s, indentParagraphs: 'first' }, 1).indent, 0);
  assert.equal(paragraphSettings({ ...s, indentParagraphs: 'rest' }, 0).indent, 0);
  assert.equal(paragraphSettings({ ...s, indentParagraphs: 'rest' }, 2).indent, 60);
  const plain = compose(texts, measure, settings);
  assert.ok(result.paragraphs.some((p, i) => p.lines[0].end < plain.paragraphs[i].lines[0].end));
});

test('kashida never touches Latin or Japanese text', () => {
  const s = { ...settings, kashida: 4, firmness: 1, rag: 0 };
  for (const doc of [texts, samples.japanese.split('\n\n')]) {
    for (const line of compose(doc, measure, s).paragraphs.flatMap(p => p.lines)) assert.equal(line.kashida, 0);
  }
});

/** A font whose width axis is deliberately non-linear: 100 % → 1, 70 % → ~0.82. */
const measureAt = (text: string, stretch: number) => measure(text) * (0.55 + 0.45 * (stretch / 100) ** 1.5);

test('width flex at zero, or without a step-aware measure, changes nothing', () => {
  const plain = compose(texts, measure, settings);
  assert.deepEqual(compose(texts, measure, { ...settings, widthFlex: 0 }, measureAt), plain);
  assert.deepEqual(compose(texts, measure, { ...settings, widthFlex: 0.3 }), plain);
});

test('width flex condenses long lines in whole steps, measured exactly at the chosen step', () => {
  const flat = { ...settings, trackingMin: 0, trackingMax: 0, rag: 0.08, firmness: 1 };
  const condensed = { ...flat, widthFlex: 0.3 };
  const result = compose(texts, measure, condensed, measureAt);
  const lines = result.paragraphs.flatMap(p => p.lines);
  assert.ok(lines.some(line => line.stretch < 100), 'no line condensed');
  for (const line of lines) {
    assert.ok(Number.isInteger(line.stretch) && line.stretch >= 70 && line.stretch <= 100, `${line.stretch}`);
    const exact = measureAt(line.text, line.stretch);
    assert.ok(Math.abs(line.width - exact) < 1e-9, `${line.width} vs ${exact} at ${line.stretch}`);
  }
  assert.equal(metrics(result.paragraphs, condensed).overflow, false);
});

test('condensing lets lines hold more words', () => {
  const tight = { ...settings, trackingMin: 0, trackingMax: 0, rag: 0, firmness: 1 };
  const before = compose(texts, measure, tight).paragraphs.reduce((n, p) => n + p.lines.length, 0);
  const after = compose(texts, measure, { ...tight, widthFlex: 0.4 }, measureAt).paragraphs.reduce((n, p) => n + p.lines.length, 0);
  assert.ok(after <= before, `${after} lines vs ${before}`);
});

test('base letter-spacing is a fixed advance per grapheme, and Arabic ignores it', () => {
  const s = { ...settings, letterSpacing: 0.03 };
  const spaced = (text: string) => measure(text) + trackingAdvances(text) * 0.03 * settings.fontSize;
  assert.deepEqual(compose(texts, measure, s), compose(texts, spaced, settings));
  const arabic = samples.arabic.split('\n\n');
  assert.deepEqual(compose(arabic, measure, s), compose(arabic, measure, settings));
});

test('paragraph harmony yields to edge firmness', () => {
  const firm = { ...settings, rag: 0, firmness: 1, wordSpacingMin: -0.5, wordSpacingMax: 0.5 };
  for (const sample of [samples.editorial, samples.literature, samples.difficult]) {
    const paragraphs = sample.split('\n\n');
    // Harmony may still choose between equally even layouts, never a less even one.
    const shortest = (sync: number) => Math.min(...compose(paragraphs, measure, { ...firm, sync }).paragraphs
      .flatMap(p => p.lines.slice(0, -1).map(l => l.fill)));
    assert.ok(shortest(1) >= shortest(0) - 0.005, `${shortest(1)} vs ${shortest(0)}`);
  }
});
