import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paragraphCandidates } from './optimizer';
import type { Settings } from './optimizer';
import { packCandidates, unpackCandidates } from './pack';
import { samples } from './samples';
import { hyphenationPoints, loadHyphenator } from './hyphenation';

const measure = (text: string) => Array.from(text).reduce((n, c) => n + (c === ' ' ? 4 : /[il.,!']/u.test(c) ? 3 : 7), 0);
const measureAt = (text: string, stretch: number) => measure(text) * (0.6 + 0.4 * stretch / 100);
const settings: Settings = { width: 240, fontSize: 16, trackingMin: -0.012, trackingMax: 0.012, rag: 0.02,
  minEnding: 0.32, sync: 0.65, firmness: 0.8, wordSpacingMin: -0.3, wordSpacingMax: 0.3, kashida: 3, widthFlex: 0.2, protectEndings: true };

const hyphenated: Settings = { ...settings, hyphenPenalty: 0.05, hyphenation: hyphenationPoints(
  [samples.editorial, samples.difficult].flatMap(s => s.split('\n\n')), await loadHyphenator('en-us'), { minWord: 5, minBefore: 2, minAfter: 2 }) };

test('packed candidates unpack to exactly the same layouts, in every script', () => {
  const texts = [samples.editorial, samples.japanese, samples.arabic, samples.difficult].flatMap(s => s.split('\n\n'));
  for (const text of texts) {
    for (const s of [settings, hyphenated]) {
      const original = paragraphCandidates(text, measure, s, 32, measureAt);
      const roundTrip = unpackCandidates(structuredClone(packCandidates(original)), text, s.hyphenation);
      assert.deepEqual(roundTrip, original);
    }
  }
});
