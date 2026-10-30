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

## 2. Width axis: Canvas interpolation (2026-10-29)

Method: `research/spikes/run-width.ts`, Chrome. Interpolate linearly between
Canvas widths at `normal` and the narrowest keyword the face supports, then
compare with DOM width at each `font-stretch` percentage. Lines are 40–60
characters from the samples, at 19 px.

| Face | Keyword honoured | Worst error, any step (px) | Mean error (px) |
| --- | --- | --- | --- |
| Noto Sans Arabic | yes (extra-condensed, 62.5%) | 2.837 (at 75%) | 2.463 (at 80%) |
| Roboto Flex | yes (ultra-condensed, 50%) | 0.016 (at 87.5% and 70%) | 0.009 (at 87.5%) |

Notes:
1. The error and mean columns are maxima over the tested steps (100 to the
   narrowest keyword). Noto Sans Arabic has 9 lines and Roboto Flex has 10.
2. Canvas honours the axis. At the exact keyword steps (87.5%, 75%, 62.5%),
   Canvas and DOM agree within 0.016 px for both faces. Noto's error therefore
   comes from the wdth axis not being linear between 100% and 62.5%, not from
   Canvas.
3. Two fixes were needed before the 100% rows could be trusted. Both are in
   `width.ts`:
   - `document.fonts.load` rejects a percentage in the `font` shorthand, so the
     variable face is loaded once per family.
   - The DOM spans set `font-variant-ligatures: none` and Canvas cannot. The
     first run had Roboto Flex at 0.846 px worst error at 100%, from the `fi`
     and related ligatures. Setting `letterSpacing = '0.000001px'` in Canvas
     disables optional ligatures, which is the trick `src/text-metrics.ts`
     uses. After that the 100% row is 0.015 px. Noto was 0.015 px either way.
4. Roboto Flex passes at every step. The rule needs every face to pass, and
   Noto does not, so the decision is per-step FontFace for both. Interpolation
   for Roboto alone is not a basis for a per-face decision.

Decision: per-step FontFace (one FontFace per 1% step, spec "Measurement").
Interpolation fails for Noto Sans Arabic (worst 2.837 px against the 0.3 px
bar), and the keyword is honoured in both faces.

## 2b. Width axis: per-step faces (2026-10-29)

Method: `research/spikes/run-width-step.ts`, Chrome. For each step N, a
`FontFace` named `<family> wN` is registered from the same binary with
`stretch: N%`. Canvas measures with that family at its default stretch, and
CSS clamps the wdth axis into the face's single-value range. Each result is
compared with DOM text in the real family at `font-stretch: N%`.

| Face | Worst error across steps (px) |
| --- | --- |
| Roboto Flex | 0.016 (all steps 60–100) |
| Noto Sans Arabic | 0.06–0.44 |

The Arabic error is already 0.357 px at 100%, so it is not caused by the
stretch. The spike face holds only the Arabic subset file and has no
`unicode-range`, while the DOM takes spaces and punctuation from Noto's other
subsets. The product therefore builds step faces per subset, each with its
original `unicode-range`, which mirrors how the DOM picks glyphs. The product's
browser test checks Canvas against DOM within 0.3 px with width flex on.

Decision: per-step faces work; one face per subset per 1% step.
