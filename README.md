# Unjustified

A responsive TypeScript + CSS + Vite typography lab. Optimize ragged paragraph breaks and subtle per-line tracking, then select paragraph layouts jointly. No added hyphenation or justification.

## Run

```sh
pnpm install
pnpm dev --port 5199
```

Open <http://localhost:5199>, or the printed LAN URL on a phone.

```sh
pnpm test           # pure search/language tests, reference equivalence, scaling guard
pnpm test:e2e       # Chrome browser tests, including native clipboard and the 35-paragraph stress suite
pnpm test:production # build and run the same browser suite against production
pnpm build          # typecheck + production bundle
pnpm preview        # local production preview
pnpm bench          # performance harness (needs a running dev server)
pnpm bench:search   # pure search benchmark, Node only
```

Browser tests use installed Google Chrome. To use bundled Chromium instead, run `pnpm exec playwright install chromium` and remove `channel: 'chrome'` in `playwright.config.ts`.

## Playground

- English, Japanese, and Arabic examples; edit 1–60 paragraphs, up to 30,000 UTF-16 code units (a full article).
- **Auto by language / Left-to-right / Right-to-left** direction. Auto resolves each paragraph from its first strong letter; alignment follows direction.
- Typeface choices are filtered by detected language. English has Source Serif 4, DM Sans, Georgia, Roboto Flex and the Latin-capable Noto faces. Japanese uses Noto Sans JP; Arabic uses Noto Sans Arabic. Only font subsets needed by the text are fetched, consistently on the page and in the worker.
- Two independent tracking handles, default −0.012em / +0.012em, up to ±0.08em. Zero disables either direction.
- **Edge firmness** (default 0) sets how freely tracking is spent to reach the rag target. With no room for the rag, wide tracking and full firmness, body lines land essentially flush: a nearly justified edge from letter-spacing alone, with the visible cost of heavily tracked lines. Arabic paragraphs always use zero tracking to preserve connected shaping.
- **Compare** shows native browser wrapping and optimized text at identical actual measures. **Focus** shows optimized text alone.
- **Composition diagnostics** overlays neutral line endpoints, faint comparison endpoints at the same ordinal line, signed tracking (orange expansion / blue shrink), amber short endings, and red overflow. Normal whitespace and intentional raggedness are not painted as errors. This replaces the old standalone Difference chart.
- Optional margin guides, moved-unit highlighting, and keyboard-accessible line inspection. Per-word spans are only built when highlighting is on.
- Export a static HTML snapshot with system-font fallback; it is not a production responsive typesetter.

## Rendering

The composed column is written with one `innerHTML` assignment and one delegated
listener set. The previous composition stays on screen while a resize is being
recomposed; stale line boxes are clipped for that brief window instead of flashing
back to native text. Reservable paragraph/column heights (off by default) can make
the swap shift-free for pages that paint before composing.

## Selection and copying

The text is real DOM text, not a canvas image or an invisible duplicate. Full-width **inline** line boxes force the chosen visual breaks without making every line a semantic block. Logical separators stay inside the line boxes; real paragraphs remain `<p>` elements. Copying therefore preserves sentences and paragraph boundaries **natively**, with no copy listener or clipboard rewriting.

Chrome tests exercise actual system-clipboard copy for all three languages, full and partial selections, a 35-paragraph article, and with diagnostics enabled. This is not a full screen-reader audit. Mixed-direction text and browser-specific copy behavior still need broader assistive-technology and cross-browser testing.

## Joint selection, not independent paragraphs

Each paragraph first gets up to 32 retained candidate paths plus a greedy fallback. The document search chooses their combination using local costs **and pairwise contour/ending costs**. **Paragraph harmony = 0** removes coupling and skips joint enumeration entirely. Up to three paragraphs enumerate all combinations of the retained candidates; larger documents use a 128-state document beam.

This is deterministic, beam-pruned optimization, not an exhaustive search of every possible break arrangement or a universal definition of beautiful typography. The precise model and papers are documented in [research/README.md](research/README.md).

## Performance

Composition is a two-stage search: each paragraph runs a bounded k-best line-break
DP, then the document search selects the combination. The document stage keeps
running moments of each layout's shape features, so the pairwise contour/ending
term costs O(1) per candidate instead of one comparison per earlier paragraph;
this turned 933 ms into 35 ms for a 40-paragraph article without changing the
objective. `src/optimizer.equivalence.test.ts` proves that against the reference
implementation in `bench/reference-compose.ts` (600 document × font × settings
combinations, including explored-path counts).

Measured with the 40-paragraph, 12,902-character harness document at a 390 px
measure (`pnpm bench`):

| | before | after |
| --- | ---: | ---: |
| Worker cold composition | 473 ms | 120 ms |
| Worker warm recomposition (resize) | 316 ms | 36 ms |
| Native geometry read | 12.5 ms | 4.1 ms |
| DOM commit + forced layout | 18.5 ms | 3.8 ms |
| DOM nodes in the composed column | 3,478 | 1,027 |

The whole trip (font readiness on both threads, native geometry, Canvas
measurement, search, DOM updates and two animation frames) is still reported in
the UI. Input dispatches immediately, with at most one in-flight solve and one latest pending input; pending-input wait is reported separately. Method,
per-stage breakdown, integration guidance, the layout-shift measurements and the
measured reason there is no WASM path are in
[research/PERFORMANCE.md](research/PERFORMANCE.md).

## Battle tests

`tests/stress.spec.ts` loads a generated 35-paragraph article (~11,000
characters) through the editor and checks the things a real deployment hits:
no horizontal overflow, every word and paragraph boundary preserved, tracking
bounds, Canvas↔DOM width agreement, DOM budget, warm recomposition with zero new
measurements, a resize burst with no long task, opt-in word highlighting that
does not change the text, determinism, diagnostics that do not move geometry,
native clipboard copy of the whole article, and 20-paragraph Japanese and Arabic
documents at two widths. `src/optimizer.perf.test.ts` guards search scaling.

## Modules

| File | Responsibility |
| --- | --- |
| `src/app.html` | Static UI and research links |
| `src/main.ts` | Controls, scheduling, worker lifecycle and orchestration |
| `src/optimizer.ts` | Pure paragraph / joint search |
| `src/language.ts` | Detection, direction, normalization and Japanese break opportunities |
| `src/fonts.ts` | Typeface coverage and shared subset loading |
| `src/text-metrics.ts` | Canvas cache, grapheme advances and shaping setup |
| `src/native-layout.ts` | Native browser line geometry (one Range per word, RTL-safe) |
| `src/rendering.ts` | Selectable, copy-preserving line boxes, guide marks, delegated inspection |
| `src/visualizers.ts` | Optional composition diagnostics |
| `src/benchmark.ts` | End-to-end timing UI and repeated runs |
| `bench/` | Performance harness: corpus, DOM stages, article fixture, reference search |
| `src/composer.worker.ts`, `src/protocol.ts` | Worker search and message contracts |
| `src/styles/*.css` | Relative-unit, responsive presentation |

Presentation uses rem/em; Canvas and DOM coordinates use CSS pixels internally and are converted back for presentation.

## Boundaries

- Plain horizontal text, not arbitrary HTML or a complete typography engine.
- Japanese uses `linebreak`'s Unicode 13 opportunities, not complete browser-specific kinsoku tailoring. Optional CJK pair kerning and automatic punctuation halving are disabled for measurement parity; Japanese uses cached grapheme advances with CSS `text-spacing-trim: space-all`.
- Arabic is shaped by the browser's font engine, with no tracking or kashida insertion. Paragraph direction is preserved, but explicitly rendering lines can differ from full-paragraph bidi resolution for mixed-direction passages.
- Chrome is tested at widths 320–1440 CSS pixels; Japanese and Arabic at 375 and 1440. Safari/Firefox, emoji, other scripts, font substitution and assistive technologies need additional testing. The tiny Canvas tracking technique has a known WebKit ligature limitation.
- Oversized indivisible units are preserved and reported. Ending protection is a soft penalty; there is no pagination or widow/orphan control.
- Model cost and diagnostics are design hypotheses, not validated readability scores.

See [third-party notices](THIRD_PARTY_NOTICES.md). Downloaded paper PDFs and extracted text are kept locally under `research/` but ignored by Git; their authoritative source links are in the research notes.
