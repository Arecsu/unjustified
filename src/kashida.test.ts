import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TATWEEL, kashidaSites, placeKashida, splitAtSite } from './kashida';

const insert = (word: string, offset: number) => word.slice(0, offset) + TATWEEL + word.slice(offset);
const best = (word: string) => insert(word, kashidaSites(word)[0].offset);

test('priority 1: after a seen/sad-family letter', () => {
  assert.equal(best('مستشفى'), 'مستشـفى'); // two seen-family letters: the later one
  assert.equal(kashidaSites('مستشفى')[0].priority, 1);
});

test('priority 2: before a final teh marbuta, heh or dal', () => {
  assert.equal(best('مكتبة'), 'مكتبـة');
  assert.equal(kashidaSites('مكتبة')[0].priority, 2);
  assert.equal(best('وجه'), 'وجـه');
});

test('priority 3: before a final alef, lam or kaf', () => {
  assert.equal(best('كتاب'.slice(0, 3)), 'كتـا');
  assert.equal(best('جميل'), 'جميـل');
  assert.equal(kashidaSites('جميل')[0].priority, 3);
});

test('seen outranks a final ending in the same word', () => {
  assert.equal(best('مدرسة'), 'مدرسـة');
});

test('never splits lam-alef, never after a right-joining letter', () => {
  for (const site of kashidaSites('سلام')) {
    const left = 'سلام'.slice(0, site.offset);
    assert.notEqual(left.at(-1), 'ل', 'lam-alef split');
  }
  // دار: dal and alef never join forward; ر is final. No connection at all.
  assert.deepEqual(kashidaSites('دار'), []);
  assert.deepEqual(kashidaSites('و'), []);
});

test('diacritics stay on their base letter', () => {
  const word = 'كَتَبَ';
  for (const { offset } of kashidaSites(word)) {
    assert.ok(!/[ً-ٟ]/u.test(word[offset]), `tatweel before a mark at ${offset}`);
  }
});

test('trailing punctuation does not hide the final letter', () => {
  assert.equal(best('مكتبة،'), 'مكتبـة،');
  assert.equal(kashidaSites('مكتبة،')[0].priority, 2);
});

test('non-Arabic words have no sites', () => {
  assert.deepEqual(kashidaSites('hello'), []);
  assert.deepEqual(kashidaSites('日本語'), []);
});

test('placement: best priority first, from the end of the line, then stacking', () => {
  // جميل (3), مستشفى (1), دار (none), مكتبة (2)
  const words = ['جميل', 'مستشفى', 'دار', 'مكتبة'];
  assert.deepEqual(placeKashida(words, 1), [0, 1, 0, 0]);
  assert.deepEqual(placeKashida(words, 3), [1, 1, 0, 1]);
  assert.deepEqual(placeKashida(words, 5), [1, 2, 0, 2]);
  assert.deepEqual(placeKashida(['دار', 'hello'], 3), [0, 0]);
});

test('splitAtSite keeps every character', () => {
  for (const word of ['مستشفى', 'مكتبة', 'دار', 'hello']) assert.equal(splitAtSite(word).join(''), word);
});
