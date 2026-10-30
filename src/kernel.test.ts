import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose, setSearchKernel } from './optimizer';
import type { Settings } from './optimizer';
import { jointKernel, searchKernel } from './kernel';
import { samples } from './samples';
import { makeParagraphs } from '../bench/corpus';
import { hyphenationPoints, loadHyphenator } from './hyphenation';

const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL('./kernel/search.wasm', import.meta.url))));
const kernel = searchKernel(instance);
const joint = jointKernel(instance);
const measure = (text: string) => Array.from(text).reduce((n, c) => n + (c === ' ' ? 4.1 : /[il.,!']/u.test(c) ? 3.2 : /[MW]/u.test(c) ? 10.7 : 7.05), 0);
const measureAt = (text: string, stretch: number) => measure(text) * (0.55 + 0.45 * (stretch / 100) ** 1.5);
const base: Settings = { width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012, rag: 0.055,
  minEnding: 0.32, sync: 0.65, protectEndings: true };
const variants: Settings[] = [
  base, { ...base, width: 240 }, { ...base, width: 720, sync: 0 }, { ...base, trackingMin: -0.08, trackingMax: 0.08, firmness: 1, rag: 0 },
  { ...base, wordSpacingMin: -0.5, wordSpacingMax: 0.5, kashida: 4, widthFlex: 0.3, firmness: 0.7 }, { ...base, protectEndings: false, sync: 1 },
];
const hyphenation = hyphenationPoints([...Object.values(samples), ...makeParagraphs(40, 11)].flatMap(t => t.split('\n\n')),
  await loadHyphenator('en-us'), { minWord: 5, minBefore: 2, minAfter: 2 });
variants.push({ ...base, width: 260, hyphenation, hyphenPenalty: 0.05 }, { ...base, rag: 0, firmness: 1, hyphenation, hyphenPenalty: 0.01, sync: 1 });
const documents = [...Object.values(samples).map(text => text.split('\n\n')), makeParagraphs(10, 3), makeParagraphs(40, 11)];

test('the WebAssembly search returns exactly the JavaScript search results', () => {
  let checked = 0;
  for (const texts of documents) for (const s of variants) {
    setSearchKernel(undefined);
    const reference = compose(texts, measure, s, measureAt);
    setSearchKernel(kernel, joint);
    try {
      assert.deepEqual(compose(texts, measure, s, measureAt), reference);
    } finally {
      setSearchKernel(undefined);
    }
    checked++;
  }
  assert.ok(checked >= 56);
});
