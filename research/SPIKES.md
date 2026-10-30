# Spike results

## 1. Kashida: joining and clean copy (2026-10-29)

Method: `research/spikes/run-kashida.ts`. The same words are drawn with plain
tatweel text, a `user-select: none` span, and `::before` content. A mechanism
keeps joins when its width and pixels equal plain text.

| Browser | Span: joined | Span: clean copy | ::before: joined | ::before: clean copy |
| --- | --- | --- | --- | --- |
| Chrome | yes | yes (real clipboard: yes) | yes | yes (real clipboard: yes) |
| WebKit | yes, by eye (see note 2) | yes | yes, by eye (see note 2) | yes |
| Firefox | yes | yes | yes | yes |

Measured: `widthDelta` is 0 for all words except word index 2 (`كتاب`), which
is 0.016 px in all three browsers. Pixels equal plain text in Chrome and Firefox
for all six rows. In WebKit, 6 to 12 pixels differ per word.

Notes:
1. The first run had `samePixels: false` in every browser. The cause was the
   layout of the spike page, not the mechanisms. Each word started at a
   different sub-pixel x and y. The page now stacks the words in a column and
   pins `line-height` to 80px so every box is on whole pixels. The runner and
   the measured rows are unchanged.
2. WebKit `samePixels` is false for both mechanisms, with 6 to 12 differing
   pixels per word (max channel delta 18 to 63). At 1x the words look
   identical. At 4x, the split tatweel run shows faint seams at its
   boundaries while the letters stay joined. This is anti-aliasing at the
   span boundary, which the plan allows. It is a judgment call, not a strict
   pass.
3. "Clean copy" uses `selection.toString()` in all browsers. Chrome was also
   checked with the real clipboard: `span` and `::before` both copy `مستشفى`.
4. The word index 2 widthDelta of 0.016 px is far below a 0.3 px tolerance.

Decision: Chrome: span. WebKit: span (joined by eye, see note 2; `::before`
renders identically, so the choice does not matter there). Firefox: span.
