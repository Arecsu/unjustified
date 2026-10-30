# Research: considered ragged-right composition

## Primary sources

1. **Donald E. Knuth & Michael F. Plass, “Breaking Paragraphs into Lines” (1981).** *Software: Practice and Experience* 11(11), 1119–1184. [PDF](https://gwern.net/doc/design/typography/tex/1981-knuth.pdf) · [DOI](https://doi.org/10.1002/spe.4380111102). Local copy: `knuth-plass.pdf`.
   - Foundational paragraph-wide optimization: candidate breakpoints form a graph, line costs define edges, and dynamic programming finds a low-cost path.
   - The framework can accommodate ragged-right text; it is not inherently synonymous with full justification.
   - This prototype borrows the global-breakpoint idea, not TeX's complete box/glue/penalty implementation.
2. **Udo Wermuth, “An attempt at ragged-right typesetting” (2020).** *TUGboat* 41(1), 73–94. [PDF](https://www.tug.org/TUGboat/tb41-1/tb127wermuth-ragged.pdf) · [Publication page](https://tug.org/TUGboat/tb41-1/tb127wermuth-ragged.html). Local copy: `wermuth-ragged.pdf`.
   - Closest match to the problem. Explores Rauhsatz versus Flattersatz, ending zones, alternating short/long lines, protruding short words, recognizable paragraph endings, fixed natural word spaces, and unwanted right-margin shapes.
   - Section 4's recommendations are culturally/style-dependent, not universal rules. In particular, R4 discourages distracting contours; matching paragraph contours is **our experimental interpretation of visual harmony**, not a recommendation taken verbatim from this paper.
   - Its hyphenation recommendations are not used: the requested prototype never introduces within-word breaks.
3. **Alex Holkner, “Global Multiple Objective Line Breaking” (2006).** RMIT honours thesis. [PDF](https://gwern.net/doc/design/typography/tex/2006-holkner.pdf). Local copy: `holkner-multiobjective.pdf`.
   - Presents multiple objectives and Pareto-optimal alternatives rather than one hidden weighted score. Relevant to exposing typographic trade-offs interactively.
   - Our prototype uses a weighted scalar score with a bounded candidate set. It does **not** implement Holkner's Pareto frontier.

Local `.txt` files were extracted with pypdf for searching; the original PDFs are authoritative. These downloaded PDFs and extracts are Git-ignored; follow the linked sources to retrieve them in a fresh checkout. Searches were performed with Pi's Codex search; full repositories and paper text were inspected afterward.

## Code references

- [robertknight/tex-linebreak](https://github.com/robertknight/tex-linebreak): JavaScript Knuth–Plass implementation, browser-independent core, higher-level DOM helpers. A suitable starting point for classic justified composition.
- [egilll/tex-linebreak2](https://github.com/egilll/tex-linebreak2): fork with ragged alignment, hanging punctuation and Unicode line-break support. Its documented beta caveats include copied line breaks and unsupported CSS features. Neither README claims joint cross-paragraph tracking optimization.
- [chenglou/pretext](https://github.com/chenglou/pretext): measurement/layout library, inspected at shallow clone commit `0d102a5` in `/tmp/unjustified-pretext`.
  - `src/layout.ts`: separate width-independent preparation from cheap repeated layout; retain measured segments.
  - `src/measurement.ts`: font-keyed caches, ligature/kerning discrepancies, browser profiles and bounded measurement work. Our `src/text-metrics.ts` adapts its `LETTER_SPACED_SHAPING` technique: tiny nonzero Canvas tracking disables optional ligatures in Chromium/Gecko while its width rounds to zero, matching our DOM's `font-variant-ligatures: none`.
  - `src/graphemes.ts` and `src/prepare.ts`: tracking advances must follow graphemes / engine shaping, not JavaScript UTF-16 length. We use the browser's `Intl.Segmenter` with a simple ASCII fast path, not Pretext's generated engine tables.
  - Pretext predicts browser-like wrapping; it does not supply our aesthetic objective or joint search. Its docs also warn segment widths are not always naively additive. We retain cached whole-candidate measurements instead of assuming word-width prefix sums are exact.
  - MIT attribution for the adapted technique is in `THIRD_PARTY_NOTICES.md`. No dependency on a temporary clone at runtime.

- [foliojs/linebreak](https://github.com/foliojs/linebreak): runtime dependency providing Unicode 13 UAX #14 opportunities for Japanese. Latin and Arabic retain whitespace-separated units. This is not a complete browser-specific Japanese line-breaking profile.
- [Pretext dynamic layout](https://chenglou.me/pretext/dynamic-layout/): source inspection confirmed ordered, positioned inline spans can preserve native selection. Our full-width inline line boxes preserve logical spaces and real paragraph elements without clipboard interception.
- [Pretext justification comparison](https://chenglou.me/pretext/justification-comparison/): its red river indicators diagnose excessive justified interword spaces. Applying that warning to intentional ragged margins would be misleading. Our final overlay therefore uses neutral endpoints, signed tracking and specific short-ending/overflow warnings, not blanket red whitespace.
- [Google Fonts Roboto Flex metadata](https://github.com/google/fonts/blob/main/ofl/robotoflex/METADATA.pb) lists Latin, Cyrillic, Greek and Vietnamese subsets, not Japanese or Arabic. The UI filters typefaces by supported example language; Noto Sans JP and Noto Sans Arabic supply those scripts.

## The prototype's objective

For natural line width `w`, measure `L`, font size `s`, and `g` tracking advances, let `f = w/L` and `k = gs/L`. Tracking `t` is in em, so the line's fill is `f + kt`.

For ordinary lines:

```
C_line(t) = A (f + kt − target)² + B t² + line_tax
         + short_body_penalty

t* = clamp(Ak(target − f)/(Ak² + B), trackingMin, trackingMax)
```

The implementation uses `A=100`, `B=1000·r`, and `target=1−rag`, where `r = max(0.002, (1−firmness)²)`. The same factor `r` scales the per-line tracking cost and the line-to-line tracking-change cost, and the fill tolerance around the target narrows from 0.10 to 0.02 as firmness goes from 0 to 1. Firmness 0 (the default) reproduces the original model exactly.

Tracking is one of several tools sharing a line's gap (`src/stretch.ts`). Each tool i changes fill by `kᵢ` per unit and costs `Bᵢ·r` per unit², and the solve minimizes `A(f + Σkᵢxᵢ − target)² + Σ Bᵢ r xᵢ²` within each tool's bounds, re-solving after any tool hits a bound. Word spacing has `k = spaces·s/L` and `B = 10`; tracking has `k = g·s/L` and `B = 1000`. In ordinary English that makes word spacing about 2.5× cheaper per unit of fill. Its bounds are `±wordSpacing·spaceWidth` in em. Usage and line-to-line change costs follow the tracking ratios. If the adjusted line exceeds the measure, tools shrink loosest first until it fits. With a single active tool, the solve reproduces the original tracking expression bit for bit, including its clamp of −0 to +0 at a zero bound, which the equivalence suite checks. Kashida is a third tool between the two, in whole tatweels: `k = tatweelWidth/L`, `B = 0.5·(tatweelWidth/s)²`, and bounds `[0, kashida]` on lines that contain a word with a site (`src/kashida.ts`). The continuous solution is rounded and pinned, and the other tools re-solve the remainder. Width is a fourth tool, condense only, in whole `font-stretch` percentage points. Its `k` comes from one extra measurement at the narrowest allowed step, taken only for lines longer than their target. The chosen step is then measured exactly and the other tools re-fit. Canvas cannot set a percentage stretch, and the axis is not linear enough to interpolate, so each width-capable subset is also registered as `<family> wN` with `stretch: N%` (`installWidthSteps`, `research/SPIKES.md` §2b). The two UI handles independently control a nonpositive lower bound and a nonnegative upper bound; zero is always permitted. This supports asymmetric, shrink-only, expand-only, and untracked experiments. A feasible negative tracking adjustment may be needed to fit a borderline word. The quadratic minimum is exact for this local surrogate before feasibility constraints; the complete objective adds transition and ending costs afterward.

Final lines use a one-sided shortage cost below the chosen minimum, plus a single-word penalty when protection is enabled. Single-line paragraphs are exempt. A soft overflow penalty permits an indivisible oversized word to remain intact. Adjacent-line penalties discourage abrupt changes in tracking and ordinary line lengths.

```
D(j, state) = min over earlier i and retained states:
              D(i, previous_state) + C(i,j) + transition
```

We retain a bounded diverse set of paths, so this is a beam-pruned dynamic program. Latin/Arabic use whitespace boundaries; Japanese uses Unicode line-break opportunities without inserting spaces. No hyphens are inserted. Arabic paragraphs force both tracking bounds to zero, preserving connected font shaping.

For layouts `P₁...Pₙ`:

```
C_document = Σ C_paragraph(Pᵢ)
           + harmony × 65 / max(1,n−1) × Σᵢ<ⱼ distance(Pᵢ,Pⱼ)
```

`distance` combines squared differences of final fill, mean body fill, and four body-line fill samples at normalized positions. The shared score changes **which combination of paragraph layouts is selected**, not merely the UI's reported score. Setting harmony to zero removes all pairwise terms. Unit tests verify a case in which coupling actually changes selected breaks and reduces shape distance.

See [PERFORMANCE.md](PERFORMANCE.md) for the end-to-end timing contract and measured observations. Japanese optional pair kerning and automatic punctuation halving are disabled consistently for measurement parity. With DOM `text-spacing-trim: space-all`, cached individual grapheme advances avoid Canvas's inconsistent adjacent-punctuation halving. This additive shortcut is restricted to the deliberately unkerned Japanese context, never connected Arabic text. Mixed-direction paragraphs are not a full paragraph-level bidi implementation.

This is not a universal definition of beautiful typography. It does not model semantics, sentence boundaries, whitespace rivers, stacked words, pagination, optical hanging punctuation, or language-specific recommendations. The visualization makes the consequences inspectable rather than claiming a mathematically perfect aesthetic result.
