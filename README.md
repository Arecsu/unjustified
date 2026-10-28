# Unjustified

A responsive TypeScript + CSS + Vite typography lab. Optimize ragged paragraph breaks and subtle per-line tracking, then select paragraph layouts jointly. No added hyphenation or justification.

## Run

```sh
pnpm install
pnpm dev --port 5199
```

Open <http://localhost:5199>, or the printed LAN URL on a phone.

```sh
pnpm test          # pure optimizer / language tests
pnpm test:e2e      # Chrome browser tests, including native clipboard
pnpm test:production # build and run the same browser suite against production
pnpm build        # typecheck + production bundle
pnpm preview      # local production preview
```

Browser tests use installed Google Chrome. To use bundled Chromium instead, run `pnpm exec playwright install chromium` and remove `channel: 'chrome'` in `playwright.config.ts`.

## Playground

- English, Japanese, and Arabic examples; edit 1–8 paragraphs, up to 6,000 UTF-16 code units.
- **Auto by language / Left-to-right / Right-to-left** direction. Auto resolves each paragraph from its first strong letter; alignment follows direction.
- Typeface choices are filtered by detected language. English has Source Serif 4, DM Sans, Georgia, Roboto Flex and the Latin-capable Noto faces. Japanese uses Noto Sans JP; Arabic uses Noto Sans Arabic. Only font subsets needed by the text are fetched, consistently on the page and in the worker.
- Two independent tracking handles, default −0.012em / +0.012em. Zero disables either direction. Arabic paragraphs always use zero tracking to preserve connected shaping.
- **Compare** shows native browser wrapping and optimized text at identical actual measures. **Focus** shows optimized text alone.
- **Composition diagnostics** overlays neutral line endpoints, faint comparison endpoints at the same ordinal line, signed tracking (orange expansion / blue shrink), amber short endings, and red overflow. Normal whitespace and intentional raggedness are not painted as errors. This replaces the old standalone Difference chart.
- Optional margin guides, moved-unit highlighting, and keyboard-accessible line inspection.
- Export a static HTML snapshot with system-font fallback; it is not a production responsive typesetter.

### Selection and copying

The text is real DOM text, not a canvas image or an invisible duplicate. Full-width **inline** line boxes force the chosen visual breaks without making every line a semantic block. Logical separators stay inside the line boxes; real paragraphs remain `<p>` elements. Copying therefore preserves sentences and paragraph boundaries **natively**, with no copy listener or clipboard rewriting.

Chrome tests exercise actual system-clipboard copy for all three languages, full and partial selections, and with diagnostics enabled. This is not a full screen-reader audit. Mixed-direction text and browser-specific copy behavior still need broader assistive-technology and cross-browser testing.

## Joint selection, not independent paragraphs

Each paragraph first gets up to 32 retained candidate paths plus a greedy fallback. The document search chooses their combination using local costs **and pairwise contour/ending costs**. **Paragraph harmony = 0** removes coupling and skips joint enumeration entirely. Up to three paragraphs enumerate all combinations of the retained candidates; larger documents use a 128-state document beam.

This is deterministic, beam-pruned optimization, not an exhaustive search of every possible break arrangement or a universal definition of beautiful typography. The precise model and papers are documented in [research/README.md](research/README.md).

## Benchmark

**The whole trip** measures composition start through a next paint opportunity: font readiness on both threads, native A geometry, Canvas measurement, TypeScript search, DOM updates and frame wait. The 100ms control debounce is reported separately. This is not GPU paint telemetry.

**Benchmark cold + cached** runs one fresh-worker / empty-layout-cache composition followed by five cached runs. Fonts may be HTTP-cached: it is explicitly not a cold-network test. Timings, scope, current observations and optimization priorities live in [research/PERFORMANCE.md](research/PERFORMANCE.md).

`window.__composition` exposes the last layout and timing; `window.__benchmark` contains cold/cached benchmark records. No WASM is used.

## Modules

| File | Responsibility |
| --- | --- |
| `src/app.html` | Static UI and research links |
| `src/main.ts` | Controls, scheduling, worker lifecycle and orchestration |
| `src/optimizer.ts` | Pure paragraph / joint search |
| `src/language.ts` | Detection, direction, normalization and Japanese break opportunities |
| `src/fonts.ts` | Typeface coverage and shared subset loading |
| `src/text-metrics.ts` | Canvas cache, grapheme advances and shaping setup |
| `src/native-layout.ts` | Native browser line geometry, including RTL |
| `src/rendering.ts` | Selectable, copy-preserving line boxes and guides |
| `src/visualizers.ts` | Optional composition diagnostics |
| `src/benchmark.ts` | End-to-end timing UI and repeated runs |
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
