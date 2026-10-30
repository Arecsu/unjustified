/**
 * Battle tests: every control's intended effect, and the invariants no
 * combination of controls may break. Effects are judged on aggregates over a
 * corpus, so one tie between equal-cost layouts cannot flip a verdict; every
 * failure message carries the measured numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, metrics, scoreDocument, shapeDistance, wordsOf } from './optimizer';
import type { Composition, Layout, Line, Settings } from './optimizer';
import { trackingAdvances } from './text-metrics';
import { hasArabic, hasJapanese, segmentText } from './language';
import { bestSite, placeKashida } from './kashida';
import { samples } from './samples';
import { makeParagraphs } from '../bench/corpus';

// A deterministic proportional font whose widths scale with type size, and a
// deliberately non-linear width axis.
const advance = (c: string) => c === ' ' ? 4.2 : /[il.,;:!'’]/u.test(c) ? 3.1 : /[mwMW]/u.test(c) ? 11.4
  : /[A-Z]/u.test(c) ? 9.6 : /[　-鿿＀-￯]/u.test(c) ? 16 : c === 'ـ' ? 6.5 : 7.3;
const measureFor = (fontSize: number) => (text: string) => {
  let width = 0;
  for (const c of text) width += advance(c);
  return width * fontSize / 16;
};
const measureAtFor = (fontSize: number) => (text: string, stretch: number) =>
  measureFor(fontSize)(text) * (0.55 + 0.45 * (stretch / 100) ** 1.5);

const base: Settings = {
  width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012, rag: 0.055,
  minEnding: 0.32, sync: 0.65, protectEndings: true,
};
const split = (text: string) => text.split('\n\n');
const corpus = {
  english: [...split(samples.editorial), ...split(samples.literature), ...split(samples.difficult)],
  generated: makeParagraphs(12, 0xbadc0de),
  japanese: split(samples.japanese),
  arabic: split(samples.arabic),
  edge: ['Hello', '', 'A', 'Supercalifragilisticexpialidociousness-without-any-break-opportunity here.',
    '“Quoted,” he said — then paused… (briefly).', '   ', 'One two'],
};
type Doc = keyof typeof corpus;

function run(doc: Doc, s: Settings): Composition {
  return compose(corpus[doc], measureFor(s.fontSize), s, measureAtFor(s.fontSize));
}
const bodyLines = (c: Composition) => c.paragraphs.flatMap(p => p.lines.length > 1 ? p.lines.slice(0, -1) : []);
const deviation = (c: Composition, s: Settings) => metrics(c.paragraphs, s).deviation;
const lineCount = (c: Composition) => c.paragraphs.reduce((n, p) => n + p.lines.length, 0);
const shortest = (c: Composition) => Math.min(1, ...bodyLines(c).map(l => l.fill));
const sum = (docs: Doc[], f: (doc: Doc) => number) => docs.reduce((n, doc) => n + f(doc), 0);

/** Every invariant, for one composition. */
function checkInvariants(doc: Doc, s: Settings, c: Composition) {
  const texts = corpus[doc];
  const where = `${doc} ${JSON.stringify(s)}`;
  assert.equal(c.paragraphs.length, texts.length, where);
  c.paragraphs.forEach((p: Layout, i) => {
    const text = texts[i];
    const arabic = hasArabic(text);
    const { units, separator } = segmentText(text);
    // Words, order and paragraph boundaries survive; lines tile the paragraph.
    if (!hasJapanese(text)) assert.deepEqual(p.lines.flatMap(l => wordsOf(l.text)), wordsOf(text), where);
    // Lines rebuild the paragraph exactly from its own break units (Japanese has no spaces).
    assert.equal(p.lines.map(l => l.text).join(separator), units.join(separator).trimEnd(), where);
    let cursor = 0;
    p.lines.forEach((l: Line, j) => {
      const at = `${where} ¶${i} line ${j} "${l.text}"`;
      assert.equal(l.start, cursor, at); cursor = l.end;
      const final = j === p.lines.length - 1;
      // Overflow only for a line that is a single unbreakable unit.
      if (l.overflow) assert.equal(l.end - l.start, 1, `overflow: ${at}`);
      else assert.ok(l.width <= s.width + 0.05, `too wide ${l.width}: ${at}`);
      // No short body lines except where nothing else fits.
      if (!final && !l.overflow) assert.ok(l.fill >= 0.5, `body line at ${l.fill}: ${at}`);
      // Tool bounds and script rules.
      const trackMin = arabic ? 0 : s.trackingMin, trackMax = arabic ? 0 : s.trackingMax;
      assert.ok(l.tracking >= trackMin - 1e-12 && l.tracking <= trackMax + 1e-12, `tracking ${l.tracking}: ${at}`);
      // A space's natural width includes the base letter-spacing it carries.
      const spaceWidth = measureFor(s.fontSize)(separator) + (arabic ? 0 : (s.letterSpacing ?? 0) * s.fontSize);
      const spaceLimit = separator ? (s.wordSpacing ?? 0) * spaceWidth / s.fontSize : 0;
      assert.ok(Math.abs(l.wordSpacing) <= spaceLimit + 1e-12, `word spacing ${l.wordSpacing} > ${spaceLimit}: ${at}`);
      if (hasJapanese(text)) assert.equal(l.wordSpacing, 0, at);
      assert.ok(Number.isInteger(l.kashida) && l.kashida >= 0 && l.kashida <= (arabic ? s.kashida ?? 0 : 0), `kashida ${l.kashida}: ${at}`);
      if (l.kashida) assert.ok(units.slice(l.start, l.end).some(w => bestSite(w)), `kashida without a site: ${at}`);
      if (l.kashida) assert.ok(placeKashida(units.slice(l.start, l.end), l.kashida).reduce((a, b) => a + b, 0) === l.kashida, at);
      const floor = 100 - Math.round((s.widthFlex ?? 0) * 100);
      assert.ok(Number.isInteger(l.stretch) && l.stretch >= floor && l.stretch <= 100, `stretch ${l.stretch}: ${at}`);
      // The reported width is the natural width plus exactly these adjustments.
      if (l.stretch === 100) {
        const spaces = separator ? l.end - l.start - 1 : 0;
        const expected = l.natural + trackingAdvances(l.text) * l.tracking * s.fontSize
          + spaces * l.wordSpacing * s.fontSize + l.kashidaWidth;
        assert.ok(Math.abs(l.width - expected) < 1e-6, `width ${l.width} vs ${expected}: ${at}`);
      }
      assert.ok(Math.abs(l.fill - l.width / s.width) < 1e-12, at);
    });
    assert.equal(cursor, units.length, where);
  });
}

// ---------------------------------------------------------------------------
// Invariants over a grid of every control's extremes and mixtures.

const grid: Settings[] = [
  base,
  { ...base, width: 240 }, { ...base, width: 620 }, { ...base, fontSize: 14 }, { ...base, fontSize: 26 },
  { ...base, letterSpacing: -0.05 }, { ...base, letterSpacing: 0.1 },
  { ...base, trackingMin: 0, trackingMax: 0 }, { ...base, trackingMin: -0.08, trackingMax: 0.08 },
  { ...base, trackingMin: -0.08, trackingMax: 0 }, { ...base, trackingMin: 0, trackingMax: 0.08 },
  { ...base, rag: 0 }, { ...base, rag: 0.18 },
  { ...base, firmness: 1 }, { ...base, firmness: 1, rag: 0, trackingMin: -0.08, trackingMax: 0.08 },
  { ...base, wordSpacing: 0.5 }, { ...base, kashida: 4 }, { ...base, widthFlex: 0.4 },
  { ...base, sync: 0 }, { ...base, sync: 1 },
  { ...base, protectEndings: false }, { ...base, minEnding: 0.6 }, { ...base, minEnding: 0.15 },
  // The nearly-justified preset, and everything at once.
  { ...base, rag: 0, firmness: 1, wordSpacing: 0.5, kashida: 4, trackingMin: -0.04, trackingMax: 0.04, sync: 0 },
  { ...base, width: 260, fontSize: 24, letterSpacing: 0.04, trackingMin: -0.08, trackingMax: 0.08, rag: 0.12,
    firmness: 0.6, wordSpacing: 0.4, kashida: 3, widthFlex: 0.3, sync: 1, minEnding: 0.5 },
];

test('invariants hold for every document under every grid setting', () => {
  let checked = 0;
  for (const doc of Object.keys(corpus) as Doc[]) for (const s of grid) {
    checkInvariants(doc, s, run(doc, s));
    checked++;
  }
  assert.equal(checked, Object.keys(corpus).length * grid.length);
});

test('composition is deterministic', () => {
  for (const doc of ['english', 'arabic', 'japanese'] as Doc[]) for (const s of [base, grid.at(-1)!, grid.at(-2)!]) {
    assert.deepEqual(run(doc, s), run(doc, s));
  }
});

test('new controls at zero change nothing', () => {
  for (const doc of Object.keys(corpus) as Doc[]) {
    const plain = compose(corpus[doc], measureFor(19), base);
    const zeroed = compose(corpus[doc], measureFor(19), { ...base, firmness: 0, wordSpacing: 0, kashida: 0,
      widthFlex: 0, letterSpacing: 0 }, measureAtFor(19));
    assert.deepEqual(zeroed, plain, doc);
  }
});

// ---------------------------------------------------------------------------
// Each control does what it says.

const latin: Doc[] = ['english', 'generated'];

test('column width: narrower columns take more lines', () => {
  for (const doc of [...latin, 'arabic', 'japanese'] as Doc[]) {
    const counts = [240, 390, 620].map(width => lineCount(run(doc, { ...base, width })));
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `${doc}: ${counts}`);
  }
});

test('type size: larger type takes more lines', () => {
  for (const doc of [...latin, 'arabic', 'japanese'] as Doc[]) {
    const counts = [14, 19, 26].map(fontSize => lineCount(run(doc, { ...base, fontSize })));
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `${doc}: ${counts}`);
  }
});

test('letter spacing: looser type takes more lines; Arabic ignores it', () => {
  for (const doc of latin) {
    const counts = [-0.05, 0, 0.1].map(letterSpacing => lineCount(run(doc, { ...base, letterSpacing })));
    assert.ok(counts[0] <= counts[1] && counts[1] < counts[2], `${doc}: ${counts}`);
  }
  assert.deepEqual(run('arabic', { ...base, letterSpacing: 0.1 }), run('arabic', base));
});

test('tracking range: wider limits even the edge, and are actually used', () => {
  const flat = { ...base, rag: 0, firmness: 1 };
  const none = sum(latin, d => deviation(run(d, { ...flat, trackingMin: 0, trackingMax: 0 }), flat));
  const wide = { ...flat, trackingMin: -0.08, trackingMax: 0.08 };
  const used = sum(latin, d => deviation(run(d, wide), wide));
  assert.ok(used < none * 0.5, `deviation ${used} vs ${none} without tracking`);
  const lines = latin.flatMap(d => run(d, wide).paragraphs.flatMap(p => p.lines));
  assert.ok(lines.some(l => l.tracking > 0.001) && lines.some(l => l.tracking < -0.001), 'both directions used');
  // One-sided limits are one-sided.
  for (const l of latin.flatMap(d => run(d, { ...flat, trackingMin: 0, trackingMax: 0.08 }).paragraphs.flatMap(p => p.lines))) {
    assert.ok(l.tracking >= 0, `expand-only went negative: ${l.tracking}`);
  }
});

test('room for the rag: a larger zone loosens the edge without narrowing the column', () => {
  const at = (rag: number) => ({ ...base, rag });
  const tight = sum(latin, d => deviation(run(d, at(0)), at(0)));
  const loose = sum(latin, d => deviation(run(d, at(0.18)), at(0.18)));
  assert.ok(loose > tight, `deviation at 18% ${loose} vs ${tight} at 0`);
  const mean = (rag: number) => {
    const fills = latin.flatMap(d => bodyLines(run(d, at(rag))).map(l => l.fill));
    return fills.reduce((a, b) => a + b, 0) / fills.length;
  };
  assert.ok(mean(0.18) > 0.88, `body lines average ${mean(0.18)} at 18%: the column looks narrower`);
});

test('edge firmness: firmer edges are more even', () => {
  const at = (firmness: number) => ({ ...base, rag: 0, firmness, trackingMin: -0.04, trackingMax: 0.04, wordSpacing: 0.3 });
  const values = [0, 0.5, 1].map(f => sum(latin, d => deviation(run(d, at(f)), at(f))));
  assert.ok(values[0] > values[1] && values[1] > values[2], `deviation by firmness: ${values}`);
});

test('word spacing: flex evens the edge for Latin and Arabic, never for Japanese', () => {
  for (const doc of [...latin, 'arabic'] as Doc[]) {
    const at = (wordSpacing: number) => ({ ...base, rag: 0, firmness: 1, trackingMin: 0, trackingMax: 0, wordSpacing });
    const without = deviation(run(doc, at(0)), at(0)), with50 = deviation(run(doc, at(0.5)), at(0.5));
    assert.ok(with50 < without, `${doc}: ${with50} vs ${without}`);
  }
  assert.ok(run('japanese', { ...base, wordSpacing: 0.5, firmness: 1 }).paragraphs
    .every(p => p.lines.every(l => l.wordSpacing === 0)));
});

test('kashida: tatweels even Arabic lines and touch nothing else', () => {
  const at = (kashida: number) => ({ ...base, rag: 0, firmness: 1, kashida });
  const without = deviation(run('arabic', at(0)), at(0)), with4 = deviation(run('arabic', at(4)), at(4));
  assert.ok(with4 < without, `${with4} vs ${without}`);
  for (const doc of [...latin, 'japanese', 'edge'] as Doc[]) {
    assert.ok(run(doc, at(4)).paragraphs.every(p => p.lines.every(l => l.kashida === 0)), doc);
  }
});

test('width flex: condensing lets lines hold more, in whole steps', () => {
  for (const doc of [...latin, 'arabic'] as Doc[]) {
    const at = (widthFlex: number) => ({ ...base, rag: 0, firmness: 1, trackingMin: 0, trackingMax: 0, widthFlex });
    const plain = run(doc, at(0)), condensed = run(doc, at(0.4));
    assert.ok(lineCount(condensed) <= lineCount(plain), `${doc}: ${lineCount(condensed)} vs ${lineCount(plain)}`);
    assert.ok(condensed.paragraphs.some(p => p.lines.some(l => l.stretch < 100)), `${doc}: nothing condensed`);
  }
});

test('protect short endings and minimum last line reduce short endings', () => {
  const shortEndings = (s: Settings) => sum(latin, d => metrics(run(d, s).paragraphs, s).shortEndings);
  const off = { ...base, protectEndings: false, minEnding: 0.5 }, on = { ...base, minEnding: 0.5 };
  assert.ok(shortEndings(on) < shortEndings(off), `${shortEndings(on)} vs ${shortEndings(off)} unprotected`);
  const endings = (minEnding: number) => latin.flatMap(d => run(d, { ...base, minEnding }).paragraphs
    .filter(p => p.lines.length > 1).map(p => p.lines.at(-1)!.fill));
  const below = (minEnding: number, threshold: number) => endings(minEnding).filter(f => f < threshold).length;
  assert.ok(below(0.6, 0.6) < below(0.15, 0.6), `endings under 60%: ${below(0.6, 0.6)} vs ${below(0.15, 0.6)}`);
});

test('paragraph harmony: shapes grow alike when the edge is loose, never at the cost of a firm one', () => {
  const docs: Doc[] = ['english', 'generated'];
  const distance = (s: Settings) => sum(docs, d => scoreDocument(run(d, s).paragraphs, { ...s, sync: 1, firmness: 0 })
    - run(d, s).paragraphs.reduce((n, p) => n + p.cost, 0));
  const apart = distance({ ...base, sync: 0 }), together = distance({ ...base, sync: 1 });
  assert.ok(together < apart, `pairwise shape distance ${together} vs ${apart} independent`);
  const firm = { ...base, rag: 0, firmness: 1, wordSpacing: 0.5, trackingMin: -0.04, trackingMax: 0.04 };
  for (const d of docs) {
    const independent = shortest(run(d, { ...firm, sync: 0 })), concert = shortest(run(d, { ...firm, sync: 1 }));
    assert.ok(concert >= independent - 0.005, `${d}: shortest body ${concert} vs ${independent} independent`);
  }
  assert.equal(shapeDistance(run('english', base).paragraphs[0], run('english', base).paragraphs[0]), 0);
});

test('nearly justified: the preset makes every body line flush in every script it can', () => {
  const preset = { ...base, rag: 0, firmness: 1, wordSpacing: 0.5, kashida: 4, trackingMin: -0.04, trackingMax: 0.04, sync: 0 };
  for (const doc of [...latin, 'arabic'] as Doc[]) {
    const c = run(doc, preset);
    assert.ok(shortest(c) > 0.97, `${doc}: shortest body line ${shortest(c)}`);
  }
});
