# Justification tools: word spacing, kashida, width axis — and a speed pass

Status: approved design, 2026-10-29. Implementation plan to follow.

## Goal

Let designers push any text — Arabic first, but every supported language — from
a natural rag toward an almost justified edge with a few global controls, while
the text stays real, selectable DOM text whose copy is exactly the original.

The playground is aimed at arbitrary web text, not at hand-tuned print layout.
Every control is set once for the whole text; the optimizer chooses the actual
amount per line automatically, as it already does for tracking.

## Controls

Under "02 The composition":

| Control | Range | Default | Applies to |
| --- | --- | --- | --- |
| Tracking (existing, two handles) | ±0.08 em | ±0.012 em | Latin, Japanese (Arabic stays 0) |
| **Word spacing flex** (new) | 0–50 % of a natural space | 0 (off) | Paragraphs with inter-word spaces |
| **Kashida** (new) | off, 1–4 tatweels per line | off | Arabic paragraphs |
| **Width flex** (new) | 0–40 % condensing | 0 (off) | Typefaces with a `wdth` axis |
| Edge firmness (existing) | 0–100 % | 0 | Everything |

- One slider per tool. Word spacing flex is symmetric: 30 % lets a space range
  from 70 % to 130 % of its natural width.
- Width flex only condenses: Noto Sans Arabic's axis stops at 100 %, and
  condensing complements stretched spaces.
- Disabled states, each with a one-line note in the existing `control-note`
  style:
  - Word spacing: every paragraph is Japanese ("Japanese has no word spaces;
    tracking handles it").
  - Kashida: no Arabic paragraph.
  - Width: the selected typeface declares no `font-stretch` range ("Source
    Serif 4 has no width axis. Try Roboto Flex or Noto Sans Arabic.").
- With all three new sliders at 0, output is identical to today. The existing
  equivalence tests enforce this.

## Line model: weighted sharing

Today `buildLine` solves one variable, tracking `t`, analytically:
`t* = clamp(A·k·(target − f) / (A·k² + B), min, max)`.

This generalizes to a vector of adjustments `xᵢ` with per-unit width effects
`kᵢ` (fill per unit) and stiffnesses `Bᵢ`, minimizing
`A·(f + Σ kᵢxᵢ − target)² + Σ Bᵢxᵢ²`. Unclamped, each tool takes
`xᵢ = (kᵢ/Bᵢ)·g / (1/A + Σ kⱼ²/Bⱼ)` of the gap `g = target − f`. Tools that hit
their bound are clamped and removed, and the solve repeats on the remainder
(at most four passes).

| Tool | Unit | kᵢ (fill per unit) | Stiffness order |
| --- | --- | --- | --- |
| Word spacing | fraction of the space width | spaces · spaceWidth / measure | loosest |
| Kashida | tatweels | tatweelWidth / measure | |
| Width | wdth percentage points | (natural − natural@min) / (range · measure) | |
| Tracking | em | advances · fontSize / measure | stiffest |

- Every Bᵢ is multiplied by the existing firmness `restraint(s)`, so edge
  firmness keeps its meaning: how eagerly the combined stretch is spent.
- Kashida is rounded to whole tatweels, and width to 1 % steps. Tracking
  absorbs the rounding remainder within its bounds.
- The per-line cost keeps its existing form, plus one quadratic usage term per
  tool and one line-to-line change term per tool. Both are scaled by
  `restraint(s)`, like tracking today.
- The stiffness values are internal constants, tuned so the defaults look
  restrained. They are not user controls.
- Arabic paragraphs keep both tracking bounds at 0. Kashida and word spacing
  take that role.

### Kashida placement (traditional priority)

Candidate positions in a line, best first:

1. After an initial or medial seen/sad family letter (س ش ص ض).
2. Before a final ة, ه or د family letter.
3. Before a final ا, ل or ك family letter.
4. Any other dual-joining → joining connection.

Rules:

- Never inside lam-alef (لا and variants), never next to a non-joining letter,
  and never across a word boundary or a diacritic cluster.
- At most one kashida position per word. Positions are taken from the end of
  the line backwards within the same priority, and more than one tatweel may
  stack at one position.
- Placement is a pure function, `kashidaSites(word) → ranked offsets`, unit
  tested against hand-made examples.

## Measurement

- **Word spacing:** no new Canvas calls. The line width is
  `natural + spaces · Δspace`, as with tracking advances. The space count
  comes from the existing segmentation.
- **Kashida:** the tatweel advance is measured once per (font, size) and
  cached. Joining shapes do not change width when a tatweel is inserted
  between two connected letters; the spike verifies this.
- **Width:** Canvas `fontStretch` accepts only keywords. Each candidate line
  is therefore measured at 100 % and at the narrowest keyword the font
  supports, and intermediate widths are interpolated linearly. The chosen
  lines are re-measured exactly at their quantized stretch, and tracking
  absorbs any difference. If the spike shows interpolation error above
  0.3 px, the fallback registers one `FontFace` per 1 % step, each with its
  `stretch` descriptor set to that value. That is exact, but uses more memory.
  The extra measurements happen only when width flex is above 0.

## Rendering and copy

Copy must return the original text for every tool, using the existing
native-copy mechanism. There is no copy listener and no clipboard rewriting.

- **Word spacing:** `word-spacing` on each line box, next to `letter-spacing`.
- **Width:** `font-stretch: N%` on each line box. The two capable faces switch
  to their `wdth` builds (`noto-sans-arabic/wdth.css`, `roboto-flex/wdth.css`),
  keeping subset-only loading. Axis support is detected from each face's
  declared `font-stretch` range, not from a hard-coded list.
- **Kashida:** each tatweel run is an inline element inside its word that
  cannot be selected (`user-select: none`, `aria-hidden`). It is never part of
  the text content.
  - Fallback 1: an empty element whose `::before` draws the tatweel
    (generated content is never copied).
  - Fallback 2: in a browser where neither keeps the letters joined, kashida
    is disabled with a note. That line's budget moves to word spacing. The
    text is never altered.
- The exported static snapshot carries the same styles.

## Spikes (before feature code)

Each spike is a throwaway page plus a short result note in `research/`.

1. **Kashida joining and copy.** In Chrome, Safari and Firefox, check that
   joins are kept across a non-selectable span and across `::before` content,
   and that native copy of that text is clean. The result decides between the
   main mechanism, fallback 1 and fallback 2, per browser.
2. **Width interpolation.** Compare the interpolated Canvas width against DOM
   width for Noto Sans Arabic and Roboto Flex across the sample texts.
   Pass: within 0.3 px, the existing Canvas↔DOM tolerance.

## Speed pass

The playground runs in the browser, so native x64/ARM intrinsics are not
available. The browser equivalent is WebAssembly SIMD128: one portable binary
that V8, JavaScriptCore and SpiderMonkey lower to SSE/AVX on x64 and NEON on
ARM. `research/PERFORMANCE.md` records that the cold path is dominated by
`measureText` (46 ms of 120 ms), which WASM cannot speed up, and that the JS
search is ~35 ms for 40 paragraphs. The new tools add solve work per candidate
line, so the search will matter more than before.

Items, in order of expected payoff. Each is measured with `pnpm bench` /
`pnpm bench:search` before and after, and recorded in `PERFORMANCE.md`.

1. **Parallel paragraph workers.** Split `compose` into a paragraph stage and
   a joint stage. Run the paragraph stage across `min(4, hardwareConcurrency − 1)`
   workers, each with its own measurement cache and installed font binaries.
   Expected: cold measurement and search divided roughly by the worker count.
2. **No extra measurement for new tools.** Word spacing and kashida are
   additive. Width doubles measurements only for lines in paragraphs where it
   is enabled.
3. **Skip native geometry when nothing shows it.** In focus view with
   moved-word highlighting off, skip the native layout pass (~4 ms).
4. **WASM SIMD DP kernel (Rust, `wasm32-unknown-unknown`, `+simd128`).**
   - The JS side measures each paragraph's candidate line widths into one
     flat `Float64Array` and passes it in a single call per paragraph. That
     avoids the per-call boundary cost recorded in `PERFORMANCE.md`.
   - The kernel runs the line solve and the beam DP. The weighted-sharing
     solve vectorizes across candidate lines (four f32 or two f64 lanes);
     f64 lanes are used wherever equivalence requires bit-identical costs.
   - It ships as an optional fast path, loaded only when
     `WebAssembly.validate` accepts SIMD.
   - It is kept only if it at least halves the search stage on the
     40-paragraph harness and passes the reference equivalence tests
     (identical breaks, costs within 1e-9). Otherwise it is deleted and the
     measurement is recorded, as the previous WASM decision was.
   - The JS implementation stays the reference and the fallback.
   - Build: a `wasm/` crate, `cargo build --release --target
     wasm32-unknown-unknown`, with the `.wasm` imported through Vite. No
     wasm-bindgen; a plain exported-memory ABI.

## Testing

- **Unit**
  - Each new slider at 0 leaves compositions identical.
  - At its maximum, the deviation of body-line fill drops.
  - Bounds are never exceeded, and kashida never appears in Arabic text with
    no valid join.
  - `kashidaSites` matches hand-made fixtures, including lam-alef,
    non-joining letters and diacritics.
  - The weighted solve matches a brute-force minimizer on random inputs.
- **Equivalence:** the existing reference tests are unchanged. The WASM kernel
  must match the JS kernel on the same 600 combinations.
- **Browser (Playwright)**
  - No spill past the column with everything enabled.
  - Canvas↔DOM width agreement under 0.3 px, including width flex.
  - Native clipboard copy equals the original for English, Japanese and
    Arabic, with kashida present.
  - Disabled states and their notes.
- **Stress:** the 35-paragraph English and 20-paragraph Arabic articles, with
  all tools enabled, stay within the current stress-test time limits.

## Order of work

1. Spikes 1 and 2.
2. Shared weighted-sharing solve (pure refactor; equivalence must hold).
3. Word spacing.
4. Kashida.
5. Width axis.
6. Speed pass items 1–3, then item 4 (WASM) as a measured experiment.

## Known limits

- Kashida follows a standard priority list, not a calligrapher's judgment.
- Width interpolation may need the per-step fallback.
- In mixed Arabic/Latin paragraphs, kashida applies only to the Arabic words.
- Width flex only condenses.
