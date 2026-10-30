# Performance: measurements, what changed, what is left

Everything below was measured, not estimated. The harness lives in `bench/` and
is reproducible; numbers are single-machine observations from headless Google
Chrome (channel `chrome`, 1440×1000, no CPU or network throttling) against the
Vite dev server, which is slightly pessimistic versus the production bundle.

## How to measure

```sh
pnpm dev --port 5199 &        # harness needs a server
pnpm bench                    # DOM stages + the blog fixture, prints a table and JSON
pnpm bench:search             # pure search only (Node), sizes 3…40 paragraphs
BENCH_SIZES=3,20,40 pnpm bench
BENCH_ONLY=blog pnpm bench    # just the 35-paragraph article fixture
```

* `bench/corpus.ts` generates a deterministic, realistic article: a Zipf-ish
  vocabulary, real word lengths, punctuation and paragraph shapes. Repeated
  sample text would hit measurement caches unrealistically, so it is not used.
* `bench/dom-bench.ts` (`bench.html`) measures each stage in isolation: native
  geometry, cold/warm worker round trip, main-thread compose (to attribute
  measurement versus search), DOM commit plus the layout it forces, the same
  commit again, and a warm recompose at four widths. It also verifies that the
  rendered DOM still reproduces the source text.
* `bench/blog.ts` (`bench/blog.html`) is a 35-paragraph article page with four
  integration modes (`naive`, `reserve`, `hidden`, `off`). It measures layout
  shift, long tasks, main-thread cost and recompose cost after a resize.
* `bench/reference-compose.ts` keeps the pre-optimization search as an executable
  specification; `src/optimizer.equivalence.test.ts` proves the fast paths
  against it, and `src/optimizer.perf.test.ts` guards scaling and path counts.

## Before / after

Same harness, same corpus, same machine. `native` = reading the browser's own
line geometry; `cold` = fresh worker with empty caches; `warm` = recompose with
the worker's measurement cache; `commit` = DOM write + forced layout.

| 40 paragraphs, 12,902 chars, 329 lines, 390 px measure | before | after |
| --- | ---: | ---: |
| Native geometry (`readNativeLayout`) | 12.5 ms | **4.1 ms** |
| Worker cold round trip | 473 ms | **120 ms** |
| Worker warm round trip (the resize path) | 316 ms | **36 ms** |
| … of which search | 315 ms | **34 ms** |
| … of which Canvas measurement (cold only) | 62 ms | 46 ms |
| Main-thread compose (for attribution) | 451 ms | 91 ms |
| DOM commit + forced layout | 8.4 + 10.1 ms | **0.9 + 2.9 ms** |
| DOM nodes in the composed column | 3,478 | **1,027** |
| Warm recompose after a resize (end to end) | 313 ms | **34–46 ms** |
| Pure search, 40 paragraphs (Node) | 933 ms | **35 ms** |

Small documents improved by the same mechanisms:

| 3 paragraphs (the default sample) | before | after |
| --- | ---: | ---: |
| Worker cold round trip | 62 ms | **26 ms** |
| Worker warm round trip | 21 ms | **3.1 ms** |
| DOM commit + layout | 0.2 + 0.6 ms | 0.1 + 0.4 ms |
| Warm recompose after a resize | 16–21 ms | **3–4 ms** |

The 35-paragraph article fixture, measured from the moment the browser-wrapped
baseline has painted: composition adds **0.0000 CLS** and no long task; the
article appears ~200 ms after first paint. Recomposing that article at a new
width costs 2–3 ms of main-thread work plus a ~40 ms worker round trip.

## What actually made the difference

**1. The document search was quadratic.** For each candidate it compared against
every already-chosen paragraph with `shapeDistance`, allocating a new paragraph
array per insertion. The pairwise objective is separable:

```
Σ_j w·(v − a_j)² = w·(n·v² − 2·v·Σa_j + Σa_j²)
```

Keeping running first and second moments of the six shape features makes each
insertion O(1), and a predecessor chain replaces the array copies. 933 ms → 35 ms
with an identical objective. A bounded max-heap replaces the full frontier sort,
and a quickselect replaces the per-boundary sort that was 40 % of the remaining
time. Correctness is enforced by `optimizer.equivalence.test.ts`, which compares
600 combinations of document, font metric and settings against the reference
implementation, including `explored` path counts.

**2. Measurement was asked for strings it could not use.** The DP measured every
candidate line, including those that the existing `fill < 0.50` and overflow
rules would discard. A conservative additive bound (per-unit widths plus spaces,
with a band that absorbs kerning, ligatures and contextual shaping) skips those.
Word and separator grapheme counts are memoized, candidate strings are built
incrementally instead of slicing word arrays, and the DP frontier is a
struct-of-arrays with back-pointers, so a 40-paragraph document no longer
allocates ~400,000 path objects.

**3. Cold start was paid twice and then interpreted.** The worker re-downloaded
and re-parsed the same font subsets the page had already fetched; the page now
hands it the binaries. The first composition in a fresh worker also ran
interpreter-speed code: the same 40-paragraph search took **115 ms cold and 38 ms
warm**. A few milliseconds of throwaway search work on the worker's warm-up
message removes that 3× penalty. The app pre-warms the worker (module, fonts and
JIT) while the page is still painting, and the worker is no longer terminated on
resize — terminating it discarded every cached measurement.

**4. Native geometry was per grapheme.** `readNativeLayout` created a `Range` per
grapheme and did a linear offset→unit lookup, so a 13,000-character article
issued ~13,000 range reads. It now reads one `Range` per word (or per Japanese
break opportunity), falls back to graphemes only inside units that a line break
actually splits, and maps offsets by index. 12.5 ms → 4.1 ms.

**5. The DOM commit built word spans and re-read computed style per line.**
`getComputedStyle(documentElement).fontSize` ran once per line and per guide
marker, forcing style recalculation thousands of times; it is now read once per
render. Each line was three `createElement` calls plus three listeners; the column
is now written with one `innerHTML` assignment, three delegated listeners and one
text node per line. Per-word spans and `moved-word` classes are only built when
"highlight moved words" is on. Node count dropped from 3,478 to 1,027 for the
40-paragraph article and commit + layout from 18.5 ms to 3.8 ms. Paragraphs whose
line count changes can reserve their native height (and the column its native
height) so the swap cannot move the page; that is an opt-in flag
(`RESERVE_NATIVE_HEIGHT` in `src/main.ts`) because it leaves up to one blank line
where the composed text is shorter. Deployments that block first paint until the
composition is ready do not need it.

**6. Resize is a different path from first load.** Input dispatches immediately, without a debounce or an animation-frame scheduling delay. There is at most one in-flight solve and one latest pending input. Each finished width is committed even if another is pending; discarding every superseded width would starve the preview during a continuous drag. Text/font/size/direction changes still invalidate incompatible results. The next pending solve starts immediately after the previous commit, without waiting for the benchmark's two-frame telemetry. The previous composition stays visible, with stale lines clipped during recomposition. Font binaries are sent and installed only once per subset per worker, not copied and decoded on every input. Tracking, rag, harmony and ending weights re-rank the same text.

## WebAssembly search kernel

Composition is split in two: JavaScript builds every candidate line (it needs
Canvas measurement), then a Rust kernel (`wasm/`, built with `pnpm build:wasm`,
shipped as `src/kernel/search.wasm`) runs the paragraph beam search and the
document stage over plain numbers. `src/kernel.test.ts` requires bit-identical
output against the JavaScript search, which remains the fallback.

The search was dominated by pruning (selecting the cheapest paths), not by
arithmetic. The kernel sorts `(cost, id)` packed into one integer key and
prunes in place with reused buffers. Explicit SIMD would not help this
branch-heavy code, and Binaryen's `wasm-opt` made no measurable difference.

40-paragraph article, idle M1, Node:

| | JavaScript | WebAssembly |
| --- | ---: | ---: |
| First composition | 85–87 ms | 54–61 ms |
| Warm composition | ~41 ms | 18–20 ms |

In the browser, the warm (resize) worker time is ~12–18 ms, from ~43 ms before
paragraph helpers and the kernel. Cold start is still dominated by Canvas
measurement and helper startup, which the kernel cannot speed up.

## Paragraph helpers

Long documents (3,000+ characters) split paragraph search across up to four
nested workers; the composer runs the document stage. Candidates come back as
transferable typed arrays (`src/pack.ts`). On a 4 GB Android phone this made
resizes ~25 % faster but the first long composition ~80 ms slower and used
noticeably more memory; short texts never start helpers.

## What to optimize next

1. **Parallel paragraphs.** Paragraph search is independent; only the joint
   beam needs all candidates. Two to four workers would divide both measurement
   (46 ms) and search (34 ms) on a cold document, and cut the resize path to
   ~10–15 ms. Requires splitting `compose` into a paragraph stage and a joint
   stage (the joint stage already only needs the retained candidates).
2. **Additive width mode.** The additive word model is accurate to a mean of
   0.01 px and a worst case of 0.57 px on this corpus. Running the DP on it and
   exactly verifying the chosen lines would cut measurement calls ~5× (≈ 35 ms
   cold) at the cost of occasionally choosing a different equal-cost layout.
   This is a deliberate quality trade-off, not a free optimization, so it should
   be an opt-in measured against the reference.
3. **Skip native geometry when it cannot be seen.** The compare panel and the
   moved-word highlight are the only consumers. In focus view or in a blog
   integration, the 4 ms native pass can be skipped entirely.
4. **Maintain cache correctness.** Do not replace whole-candidate widths with
   summed word widths without the fallback above: contextual shaping, ligatures
   and kerning can invalidate that shortcut. Japanese already uses cached
   grapheme advances with kerning and pair-halving disabled for measurement
   parity, and connected Arabic shaping keeps full-string measurement.

## Measurement caveats

Timings are wall-clock observations from one machine, not CPU profiles. Canvas
measurement times instrument `measureText`; font parsing is reported separately.
Two threads and bookkeeping introduce small rounding differences. Hidden tabs
throttle animation frames, so interactive numbers require a visible tab. The
`pnpm test:production` run repeats the browser suite against the built bundle.

Layout shift is reported for the *composition* only: the fixture measures from
after the fonts are ready and the browser-wrapped article has painted, because a
real deployment is expected to block first paint (or reserve space) until fonts
and composition are ready. A page that paints body text before its fonts arrive
will shift for reasons that have nothing to do with this library.
