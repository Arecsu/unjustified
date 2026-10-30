import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from './unicode-range';

test('unicode-range terms, including minified wildcards', () => {
  assert.deepEqual(parseRange('U+41'), [0x41, 0x41]);
  assert.deepEqual(parseRange('U+0600-06FF'), [0x600, 0x6ff]);
  assert.deepEqual(parseRange('U+6??'), [0x600, 0x6ff]);
  assert.deepEqual(parseRange('U+30??'), [0x3000, 0x30ff]);
});
