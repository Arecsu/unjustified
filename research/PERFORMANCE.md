# Performance: measurement before WASM

## What the UI measures

`src/main.ts` starts a clock when composition begins, before requested fonts are ready. It reads native reference-line geometry, starts or reuses the worker, waits for its result, updates the DOM and diagnostics, then records completion after two animation-frame callbacks. This gives a **next paint opportunity**, not proof of completed GPU rasterization.

The UI breaks this into font readiness, native A geometry, Canvas measurement, TypeScript search, DOM/frame wait, and remaining startup/transport/other time. These are wall-clock observations, not CPU profiler samples. Canvas measurement times instrument calls to `measureText`; font parsing/readiness is separate. Two threads' timing resolutions and bookkeeping can introduce small rounding differences.

The 100ms control debounce is outside the composition clock and displayed separately, along with interaction-to-frame time. Hidden tabs can heavily throttle animation frames, so keep the page visible for representative interactive measurements.

## Cold versus cached

**Cold layout** creates a new worker, empty candidate-width caches and new worker font faces. Page fonts already loaded remain loaded; browser HTTP caches are not flushed. Font readiness is included whenever it is needed, but this must not be described as a cold-network benchmark.

**Cached layout** reuses worker fonts and exact candidate-string measurements. It reruns the search rather than reusing a completed layout. The benchmark performs five cached runs and reports median and maximum, not an unreliable five-sample p95.

Changing font or size invalidates measurement caches. Direction/shaping contexts have separate caches. Changing weights or measure reuses applicable measurements, but a wider measure may introduce new candidate strings. Replacing in-flight work can discard the worker and its caches.

## Observed local run

A local headless Google Chrome run, English default sample, three paragraphs, 390 CSS-pixel measure, 19 CSS-pixel Source Serif 4, 1440×1000 viewport, no CPU/network throttling:

| Metric | Observed |
| --- | ---: |
| Cold layout, end to next frame opportunity | 108.1 ms |
| Cold new Canvas measurements | 790 |
| Cold Canvas call time | 3.6 ms |
| Cold TypeScript search | 28.6 ms |
| Cached end-to-frame median, five runs | 33.3 ms |
| Cached end-to-frame range | 32.8–35.0 ms |
| Cached TypeScript search range | 18.5–29.5 ms |
| Cached new Canvas measurements | 0 |

This is an observation from the browser regression run, not a portable speed claim or a mobile benchmark. Different scripts, fonts, widths, input lengths, visible diagnostics and machine load change the result. Reproduce interactively using the benchmark button for the selected language. `window.__benchmark` provides raw per-run values.

## What to optimize next

1. **Profile the search before changing languages.** Retained path-array allocation, repeated shape-feature calculation and candidate sorting are likely targets. A bounded priority queue, precomputed contour features, and predecessor links could reduce allocation/sorting without changing the objective.
2. **Maintain cache correctness.** Do not replace whole-candidate widths with naïvely summed word widths: contextual shaping, ligatures and kerning can invalidate that shortcut. Prepare/cache work independently of layout widths where valid. The Japanese context deliberately disables pair kerning and punctuation halving, allowing cached grapheme advances; that restricted shortcut is not applied to connected Arabic shaping.
3. **Reduce startup cost when it matters.** Shared font subset metadata and worker initialization contribute to cold time. Japanese fetches only intersecting Unicode subsets, not the entire family at runtime. A smaller generated manifest or prewarmed worker is a possible future improvement.
4. **Keep optional DOM work optional.** Diagnostics do not run when disabled. Native A geometry is a real DOM measurement pass; it is deliberately included in the benchmark instead of hiding it behind a worker-only number.
5. **Test on a real phone before choosing WASM.** WASM could speed a CPU-bound search but would not remove font downloads, Canvas font shaping, DOM geometry, worker startup, or frame wait. Current small desktop examples do not establish a need for it; they do not prove TypeScript meets every mobile or large-document target either.

No WASM implementation or unverified speed comparison is claimed. The pure TypeScript implementation and browser benchmark are the baseline for future experiments.
