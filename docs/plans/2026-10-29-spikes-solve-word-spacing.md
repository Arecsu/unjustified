# Spikes, weighted solve and word spacing: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the two feasibility spikes from the spec. Then generalize the
per-line tracking solve into a weighted multi-tool solve, and ship the first new
tool, **Word spacing flex**, end to end.

**Spec:** `docs/specs/2026-10-29-justification-tools-design.md`. This plan
covers spec steps 1–3 ("Order of work"). Kashida, the width axis and the speed
pass get their own plans, written after the spike results are in, because the
spikes choose their mechanisms.

**Architecture:**
- A new pure module, `src/stretch.ts`, splits a line's fill gap across tools by
  stiffness. It handles bound clamping and the "fit inside the measure" rule.
- `buildLine` in `src/optimizer.ts` calls it with two tools: word spacing
  (loose) and tracking (stiff).
- With word spacing at 0, every number must stay bit-identical. The existing
  equivalence suite (`src/optimizer.equivalence.test.ts`) enforces this.
- Rendering adds `word-spacing` to each line's `.line-text`, so the trailing
  separator outside it is not stretched.

**Tech stack:** TypeScript, Vite, `node:test` via `tsx`, and Playwright
(installed Chrome, plus Playwright's bundled WebKit and Firefox for the kashida
spike).

**Conventions (read before starting):**
- Commit messages: imperative sentence, no prefix (`git log --oneline` for
  examples).
- Commands: `pnpm test` (unit), `pnpm test:e2e` (browser, starts the dev server
  on 5199), `npx tsc --noEmit` (types).
- Comment density matches the surrounding code: short `/** */` notes on
  exported functions, and a line comment only where a choice isn't obvious.

---

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `research/spikes/kashida.html`, `research/spikes/kashida.ts` | create | Spike 1 page: the same Arabic words drawn three ways |
| `research/spikes/run-kashida.ts` | create | Spike 1 runner: Chrome, WebKit and Firefox; join and copy checks |
| `research/spikes/width.html`, `research/spikes/width.ts` | create | Spike 2 page: Canvas interpolation vs DOM `font-stretch` |
| `research/spikes/run-width.ts` | create | Spike 2 runner |
| `research/SPIKES.md` | create | Recorded results and the decision each spike makes |
| `src/stretch.ts` | create | `shareGap` and `fitMeasure`: the weighted multi-tool solve |
| `src/stretch.test.ts` | create | Brute-force and bit-identity tests for the solve |
| `src/optimizer.ts` | modify | `Settings.wordSpacing`, `Line.wordSpacing`, `buildLine` uses `stretch.ts`, costs, pruning bounds |
| `bench/reference-compose.ts` | modify | Add `wordSpacing: 0` to its `Line` literal (type only) |
| `src/optimizer.test.ts` | modify | Word spacing unit tests |
| `src/ui-template.ts`, `src/app.html`, `src/main.ts` | modify | Slider, disabled state, inspector, export |
| `src/rendering.ts` | modify | `word-spacing` on `.line-text` |
| `tests/playground.spec.ts` | modify | Browser tests: flush edge, geometry agreement, copy, disabled state |
| `README.md`, `research/README.md` | modify | Document the control and the solve |

---

### Task 1: Kashida spike (joining and clean copy)

The question: does Arabic stay joined, and does copy stay clean, when the
tatweel is (a) plain text, (b) a non-selectable inline span, or (c) `::before`
content on an empty span? Run it in Chrome, WebKit and Firefox.

**Files:**
- Create: `research/spikes/kashida.html`
- Create: `research/spikes/kashida.ts`
- Create: `research/spikes/run-kashida.ts`

- [ ] **Step 1: Create the spike page**

`research/spikes/kashida.html`:

```html
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>Kashida spike</title>
  <style>
    body { font: 48px/1.6 'Noto Sans Arabic Variable', sans-serif; margin: 2rem; }
    .row { display: flex; gap: 2rem; }
    .word { display: inline-block; white-space: pre; }
    .k { user-select: none; -webkit-user-select: none; }
    .kb::before { content: attr(data-k); }
  </style>
</head>
<body>
  <div id="rows"></div>
  <script type="module" src="./kashida.ts"></script>
</body>
</html>
```

`research/spikes/kashida.ts`:

```ts
import '@fontsource-variable/noto-sans-arabic/wdth.css';

/** [before, after]: the tatweel run goes between the two halves. */
const words: [string, string][] = [
  ['مس', 'تشفى'], // after seen
  ['مدرس', 'ة'], // before final teh marbuta
  ['كت', 'اب'], // before final alef
];
const run = 'ــ';

const rows = document.querySelector('#rows')!;
words.forEach(([before, after], i) => {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML =
    `<span class="word" id="plain-${i}">${before}${run}${after}</span>`
    + `<span class="word" id="span-${i}">${before}<span class="k" aria-hidden="true">${run}</span>${after}</span>`
    + `<span class="word" id="before-${i}">${before}<span class="kb" aria-hidden="true" data-k="${run}"></span>${after}</span>`
    + `<span class="word" id="original-${i}">${before}${after}</span>`;
  rows.append(row);
});
await document.fonts.load('48px "Noto Sans Arabic Variable"', 'مستشفى');
(window as any).__ready = true;
```

- [ ] **Step 2: Create the runner**

`research/spikes/run-kashida.ts`:

```ts
/**
 * Spike 1. Prints, per browser and word, whether mechanisms (b) span and
 * (c) ::before render identically to (a) plain tatweel text — same width and
 * same pixels means the joins were kept — and what a selection of each
 * contains. Needs `pnpm dev --port 5199` running.
 */
import { chromium, webkit, firefox } from '@playwright/test';

const url = 'http://127.0.0.1:5199/research/spikes/kashida.html';
const browsers = [
  ['chrome', () => chromium.launch({ channel: 'chrome' })],
  ['webkit', () => webkit.launch()],
  ['firefox', () => firefox.launch()],
] as const;

for (const [name, launch] of browsers) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__ready);
  for (let i = 0; i < 3; i++) {
    const plain = page.locator(`#plain-${i}`);
    const plainBox = (await plain.boundingBox())!;
    const plainShot = await plain.screenshot();
    const original = await page.locator(`#original-${i}`).textContent();
    for (const mechanism of ['span', 'before'] as const) {
      const el = page.locator(`#${mechanism}-${i}`);
      const box = (await el.boundingBox())!;
      const samePixels = Buffer.compare(await el.screenshot(), plainShot) === 0;
      const selected = await el.evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
      console.log(JSON.stringify({
        browser: name, word: i, mechanism,
        widthDelta: +(box.width - plainBox.width).toFixed(3),
        samePixels,
        cleanSelection: selected === original,
        selected,
      }));
    }
  }
  await browser.close();
}
```

- [ ] **Step 3: Run it**

```bash
pnpm dev --port 5199 --strictPort &   # leave running for Tasks 1–2
npx tsx research/spikes/run-kashida.ts
```

Expected: 18 JSON lines (3 browsers × 3 words × 2 mechanisms). Joins are kept
when `widthDelta` is 0 and `samePixels` is true. Copy is clean when
`cleanSelection` is true.

If `samePixels` is false but `widthDelta` is 0, save the two screenshots
(`plain.screenshot({ path })`) to the scratchpad and inspect them by eye.
Anti-aliasing at a span boundary can differ by a pixel without breaking joins.

- [ ] **Step 4: For Chrome, confirm real clipboard copy for the winning mechanism**

`selection.toString()` approximates copy. Chrome's real clipboard is what the
existing tests use. Append to the runner, inside the Chrome iteration only:

```ts
if (name === 'chrome') {
  const context = page.context();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const mechanism of ['span', 'before'] as const) {
    await page.locator(`#${mechanism}-0`).evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+c');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    console.log(JSON.stringify({ browser: name, mechanism, clipboard: copied, clean: copied === 'مستشفى' }));
  }
}
```

Run again: `npx tsx research/spikes/run-kashida.ts`.

- [ ] **Step 5: Record results in `research/SPIKES.md`**

Create the file with the following section, filling the table from the output.
The decision line must name exactly one mechanism per browser:

```markdown
# Spike results

## 1. Kashida: joining and clean copy (2026-10-29)

Method: `research/spikes/run-kashida.ts`. The same words are drawn with plain
tatweel text, a `user-select: none` span, and `::before` content. A mechanism
keeps joins when its width and pixels equal plain text.

| Browser | Span: joined | Span: clean copy | ::before: joined | ::before: clean copy |
| --- | --- | --- | --- | --- |
| Chrome | | | | |
| WebKit | | | | |
| Firefox | | | | |

Decision: per browser, span if joined and clean, else ::before if joined and
clean, else kashida disabled in that browser.
```

- [ ] **Step 6: Commit**

```bash
git add research/spikes/kashida.html research/spikes/kashida.ts research/spikes/run-kashida.ts research/SPIKES.md
git commit -m "Add kashida joining and copy spike with results"
```

---

### Task 2: Width interpolation spike

The question: can Canvas, which only takes width keywords, predict DOM width
at any `font-stretch` percentage by interpolating linearly between 100% and the
narrowest keyword? Pass: within 0.3 px.

**Files:**
- Create: `research/spikes/width.html`
- Create: `research/spikes/width.ts`
- Create: `research/spikes/run-width.ts`
- Modify: `research/SPIKES.md`

- [ ] **Step 1: Create the page**

`research/spikes/width.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Width spike</title>
<style>span { white-space: pre; font-size: 19px; font-kerning: normal; font-variant-ligatures: none; }</style>
</head>
<body><div id="out"></div><script type="module" src="./width.ts"></script></body>
</html>
```

`research/spikes/width.ts`:

```ts
import '@fontsource-variable/noto-sans-arabic/wdth.css';
import '@fontsource-variable/roboto-flex/wdth.css';
import { samples } from '../../src/samples';

/** Canvas keyword → percentage, per CSS Fonts 4. */
const keywords = [['ultra-condensed', 50], ['extra-condensed', 62.5], ['condensed', 75],
  ['semi-condensed', 87.5], ['normal', 100]] as const;
const fonts = [
  { family: 'Noto Sans Arabic Variable', min: 62.5, texts: samples.arabic.split('\n\n') },
  { family: 'Roboto Flex Variable', min: 50, texts: samples.editorial.split('\n\n') },
];
const steps = [100, 96, 93, 90, 87.5, 85, 80, 75, 70, 62.5];

const canvas = new OffscreenCanvas(1, 1);
const context = canvas.getContext('2d')!;
const out = document.querySelector('#out')!;
const results: object[] = [];

for (const font of fonts) {
  for (const stretch of steps) await document.fonts.load(`${stretch}% 19px "${font.family}"`, font.texts[0]);
  const minKeyword = keywords.find(([, value]) => value === font.min)![0];
  // Lines of roughly 40–60 characters, as the optimizer would measure.
  const lines = font.texts.flatMap(text => text.match(/.{40,60}(\s|$)/gu) ?? []).map(l => l.trim());
  const canvasAt = (keyword: string, text: string) => {
    context.font = `19px "${font.family}"`;
    context.fontStretch = keyword as CanvasFontStretch;
    context.fontKerning = 'normal';
    return context.measureText(text).width;
  };
  for (const stretch of steps.filter(value => value >= font.min)) {
    let worst = 0, sum = 0;
    for (const line of lines) {
      const span = document.createElement('span');
      span.style.fontFamily = `"${font.family}"`;
      span.style.fontStretch = `${stretch}%`;
      span.textContent = line;
      out.append(span);
      const dom = span.getBoundingClientRect().width;
      span.remove();
      const wide = canvasAt('normal', line), narrow = canvasAt(minKeyword, line);
      const t = (100 - stretch) / (100 - font.min);
      const predicted = wide + (narrow - wide) * t;
      const error = Math.abs(predicted - dom);
      worst = Math.max(worst, error); sum += error;
    }
    results.push({ family: font.family, stretch, lines: lines.length,
      meanError: +(sum / lines.length).toFixed(3), worstError: +worst.toFixed(3) });
  }
  // Does Canvas honour the axis at all? A keyword width must differ from normal.
  results.push({ family: font.family, keywordHonoured: canvasAt(minKeyword, lines[0]) < canvasAt('normal', lines[0]) - 1 });
}
(window as any).__results = results;
```

- [ ] **Step 2: Create the runner**

`research/spikes/run-width.ts`:

```ts
/** Spike 2. Needs `pnpm dev --port 5199` running. Chrome only: the product's target. */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5199/research/spikes/width.html');
await page.waitForFunction(() => (window as any).__results, null, { timeout: 30000 });
for (const row of await page.evaluate(() => (window as any).__results)) console.log(JSON.stringify(row));
await browser.close();
```

- [ ] **Step 3: Run it**

Run: `npx tsx research/spikes/run-width.ts`

Expected:
- One row per (font, stretch) with `meanError` and `worstError`.
- One `keywordHonoured` row per font.
- At 100%, `worstError` must be under 0.3. If it isn't, the comparison is
  broken (font not loaded, or kerning mismatch). Fix the page before reading
  the other rows.

- [ ] **Step 4: Record results and decision in `research/SPIKES.md`**

Append:

```markdown
## 2. Width axis: Canvas interpolation (2026-10-29)

Method: `research/spikes/run-width.ts`, Chrome. Interpolate linearly between
Canvas widths at `normal` and the narrowest keyword the face supports, then
compare with DOM width at each `font-stretch` percentage. Lines are 40–60
characters from the samples, at 19 px.

| Face | Keyword honoured | Worst error, any step (px) | Mean error (px) |
| --- | --- | --- | --- |
| Noto Sans Arabic | | | |
| Roboto Flex | | | |

Decision: interpolation if every worst error < 0.3 px and the keyword is
honoured; otherwise one FontFace per 1% step (spec, "Measurement").
```

- [ ] **Step 5: Commit**

```bash
git add research/spikes/width.html research/spikes/width.ts research/spikes/run-width.ts research/SPIKES.md
git commit -m "Add width-axis interpolation spike with results"
```

Stop the dev server started in Task 1 (`kill %1`, or `pkill -f "vite --host 0.0.0.0 --port 5199"`).

---

### Task 3: Weighted multi-tool solve (`src/stretch.ts`)

`buildLine` currently minimizes `A·(f + k·t − target)² + B·t²` for tracking
alone. This task adds the general form over several tools, with bounds, plus
the "fit inside the measure" fallback. With exactly one active tool, it must
reproduce the current expressions bit for bit.

**Files:**
- Create: `src/stretch.ts`
- Test: `src/stretch.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/stretch.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitMeasure, shareGap } from './stretch';
import type { Tool } from './stretch';

const objective = (gap: number, a: number, tools: Tool[], x: number[]) =>
  a * (tools.reduce((n, t, i) => n + t.k * x[i], 0) - gap) ** 2
  + tools.reduce((n, t, i) => n + t.b * x[i] ** 2, 0);

/** Grid search: slow, obviously correct. */
function bruteForce(gap: number, a: number, tools: Tool[]): number[] {
  const steps = 160;
  const grid = (t: Tool) => Array.from({ length: steps + 1 }, (_, i) => t.min + (t.max - t.min) * i / steps);
  let best: number[] = tools.map(() => 0), bestCost = Infinity;
  const walk = (i: number, x: number[]) => {
    if (i === tools.length) {
      const cost = objective(gap, a, tools, x);
      if (cost < bestCost) { bestCost = cost; best = [...x]; }
      return;
    }
    for (const value of grid(tools[i])) walk(i + 1, [...x, value]);
  };
  walk(0, []);
  return best;
}

test('one tool reproduces the original tracking expression bit for bit', () => {
  const out = new Float64Array(1);
  for (const [a, k, gap, b, min, max] of [
    [100, 2.44, 0.05, 1000, -0.012, 0.012],
    [100, 1.7, -0.03, 1000, -0.04, 0],
    [240, 0.9, 0.2, 2, -0.08, 0.08],
    [0, 2, 0.1, 1000, -0.012, 0.012],
  ]) {
    shareGap(gap, a, [{ k, b, min, max }], out);
    const original = Math.min(max, Math.max(min, a * k * gap / (a * k * k + b)));
    assert.equal(Object.is(out[0], original), true, `${out[0]} vs ${original}`);
  }
});

test('a disabled tool (zero bounds or zero effect) stays at zero and does not disturb the others', () => {
  const out = new Float64Array(2);
  const tracking = { k: 2.44, b: 1000, min: -0.012, max: 0.012 };
  shareGap(0.05, 100, [{ k: 0.4, b: 10, min: 0, max: 0 }, tracking], out);
  const alone = new Float64Array(1);
  shareGap(0.05, 100, [tracking], alone);
  assert.equal(out[0], 0);
  assert.equal(Object.is(out[1], alone[0]), true);
  shareGap(0.05, 100, [{ k: 0, b: 10, min: -1, max: 1 }, tracking], out);
  assert.equal(out[0], 0);
  assert.equal(Object.is(out[1], alone[0]), true);
});

test('matches a brute-force minimizer within grid resolution', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = new Float64Array(2);
  for (let trial = 0; trial < 60; trial++) {
    const tools: Tool[] = [
      { k: 0.1 + random() * 0.5, b: 1 + random() * 20, min: -random() * 0.15, max: random() * 0.15 },
      { k: 1 + random() * 2, b: 200 + random() * 1000, min: -random() * 0.05, max: random() * 0.05 },
    ];
    const gap = (random() - 0.4) * 0.2;
    shareGap(gap, 100, tools, out);
    const best = bruteForce(gap, 100, tools);
    const ours = objective(gap, 100, tools, [out[0], out[1]]);
    const reference = objective(gap, 100, tools, best);
    assert.ok(ours <= reference + 1e-6, `trial ${trial}: ${ours} > ${reference}`);
    tools.forEach((t, i) => assert.ok(out[i] >= t.min - 1e-12 && out[i] <= t.max + 1e-12));
  }
});

test('the looser tool takes the larger share of the gap', () => {
  const out = new Float64Array(2);
  shareGap(0.04, 100, [{ k: 0.39, b: 10, min: -0.2, max: 0.2 }, { k: 2.44, b: 1000, min: -0.08, max: 0.08 }], out);
  assert.ok(0.39 * out[0] > 2.44 * out[1]);
});

test('fitMeasure reproduces the original single-tool fit and shrinks the loosest tool first', () => {
  const x = new Float64Array([0.01]);
  const tools = [{ k: 2.44, b: 1000, min: -0.012, max: 0.012 }];
  fitMeasure(0.99, tools, x);
  assert.equal(Object.is(x[0], Math.max(-0.012, (1 - 0.99) / 2.44)), true);

  const two = new Float64Array([0.05, 0.004]);
  const both = [{ k: 0.4, b: 10, min: -0.1, max: 0.1 }, { k: 2.44, b: 1000, min: -0.012, max: 0.012 }];
  fitMeasure(0.99, both, two);
  assert.ok(0.99 + 0.4 * two[0] + 2.44 * two[1] <= 1 + 1e-12);
  assert.equal(two[1], 0.004, 'tracking untouched when word spacing alone can fit the line');
});

test('fitMeasure leaves an already-fitting line alone', () => {
  const x = new Float64Array([0.002]);
  fitMeasure(0.9, [{ k: 2.44, b: 1000, min: -0.012, max: 0.012 }], x);
  assert.equal(x[0], 0.002);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/stretch.test.ts`
Expected: FAIL with `Cannot find module './stretch'` (or similar resolution
error).

- [ ] **Step 3: Implement `src/stretch.ts`**

```ts
/**
 * Splits a line's fill gap across adjustable tools (word spacing, tracking, …).
 *
 * Each tool i changes fill by kᵢ per unit and costs Bᵢ per unit². We minimize
 * A·(Σ kᵢxᵢ − gap)² + Σ Bᵢxᵢ² subject to minᵢ ≤ xᵢ ≤ maxᵢ. Unclamped,
 * xᵢ = (kᵢ/Bᵢ)·A·gap / (1 + A·Σ kⱼ²/Bⱼ). Tools that cross a bound are fixed
 * there, and the remaining gap is re-solved over the others. The objective is
 * convex and separable in the bounds, so this active-set loop converges in at
 * most one pass per tool.
 *
 * Tools are ordered loosest first; `fitMeasure` relies on that order.
 */
export interface Tool { k: number; b: number; min: number; max: number }

const enabled = (t: Tool) => t.k > 0 && (t.min < 0 || t.max > 0);

export function shareGap(gap: number, a: number, tools: Tool[], out: Float64Array): void {
  let free = 0;
  for (let i = 0; i < tools.length; i++) {
    out[i] = 0;
    if (enabled(tools[i])) free |= 1 << i;
  }
  while (free) {
    let remaining = gap, sum = 0, count = 0;
    for (let i = 0; i < tools.length; i++) {
      if (free & (1 << i)) { sum += tools[i].k * tools[i].k / tools[i].b; count++; }
      else if (out[i] !== 0) remaining -= tools[i].k * out[i];
    }
    let clamped = false;
    for (let i = 0; i < tools.length; i++) {
      if (!(free & (1 << i))) continue;
      const t = tools[i];
      // A lone tool keeps the original tracking expression, so results with
      // the new tools disabled stay bit-identical to the reference search.
      const x = count === 1
        ? a * t.k * remaining / (a * t.k * t.k + t.b)
        : t.k / t.b * a * remaining / (1 + a * sum);
      if (x < t.min) { out[i] = t.min; free &= ~(1 << i); clamped = true; }
      else if (x > t.max) { out[i] = t.max; free &= ~(1 << i); clamped = true; }
      else out[i] = x;
    }
    if (!clamped) break;
  }
}

/**
 * If the adjusted line is wider than the measure, shrink tools loosest first
 * until it fits or every tool is at its minimum. This admits a word that only
 * just doesn't fit naturally.
 */
export function fitMeasure(naturalFill: number, tools: Tool[], x: Float64Array): void {
  let used = 0;
  for (let i = 0; i < tools.length; i++) if (x[i] !== 0) used += tools[i].k * x[i];
  if (naturalFill + used <= 1) return;
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (!enabled(t)) continue;
    const others = used - (x[i] !== 0 ? t.k * x[i] : 0);
    x[i] = Math.max(t.min, (1 - naturalFill - others) / t.k);
    used = others + (x[i] !== 0 ? t.k * x[i] : 0);
    if (naturalFill + used <= 1) return;
  }
}
```

Why the `!== 0` guards: they skip `+ k·0` and `− k·0` terms. That keeps
single-tool arithmetic identical to the original one-variable expressions,
which the equivalence suite compares at 1e-12.

Check of the fit loop for one tool: `others` is `used − k·x`. With one tool,
`used` was exactly `k·x`, so `others` is `0` and `(1 − f − 0)/k` equals the
original `(1 − f)/k`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/stretch.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stretch.ts src/stretch.test.ts
git commit -m "Add weighted multi-tool line solve"
```

---

### Task 4: Route `buildLine` through the solve (pure refactor)

Tracking becomes one entry in a tool list. The new word-spacing tool is wired
in but always disabled in this task. Every equivalence test must pass
unchanged.

**Files:**
- Modify: `src/optimizer.ts` (`Line`, `buildLine`, `greedy`, `paragraphCandidates`)
- Modify: `bench/reference-compose.ts:59` (return literal)

- [ ] **Step 1: Add `wordSpacing` to `Line`**

In `src/optimizer.ts`, interface `Line`, after `tracking: number; // em`:

```ts
  wordSpacing: number; // em added to (or removed from) each inter-word space
```

In `bench/reference-compose.ts`, change its `buildLine` return to:

```ts
  return { start, end, text, natural, width, tracking, wordSpacing: 0, fill: width / s.width, overflow };
```

- [ ] **Step 2: Replace the tracking block in `buildLine`**

Add the import at the top of `src/optimizer.ts`, next to the others:

```ts
import { fitMeasure, shareGap } from './stretch';
import type { Tool } from './stretch';
```

Add these module constants after `fillTolerance`:

```ts
/** Stiffness per em² of each tool. Word spacing is looser than tracking: per
 *  unit of fill it costs about 2.5× less in ordinary English text. */
const TRACKING_STIFFNESS = 1000;
const WORD_STIFFNESS = 10;
/** Reused by every `buildLine` call: the candidate loop runs it ~10⁵ times. */
const tools: Tool[] = [{ k: 0, b: 0, min: 0, max: 0 }, { k: 0, b: 0, min: 0, max: 0 }];
const amounts = new Float64Array(2);
```

Replace the entire `buildLine` function with:

```ts
/** Build one candidate line from an already-measured natural width. */
function buildLine(start: number, end: number, text: string, natural: number, advances: number,
  totalWords: number, s: Settings, tracked: boolean, spaces = 0, spaceLimit = 0): Line | null {
  // CSS tracking contributes a trailing advance too. Japanese uses grapheme
  // advances; connected Arabic paragraphs have their tracking bounds set to zero.
  const naturalFill = natural / s.width;
  const final = end === totalWords;
  const only = start === 0 && final;
  let tracking = 0, wordSpacing = 0;
  if (tracked && !only) {
    // Loosest first: word spacing, then tracking. Each moves fill by k per em.
    const words = tools[0], track = tools[1];
    words.k = spaces * s.fontSize / s.width;
    words.b = WORD_STIFFNESS * restraint(s);
    words.min = -spaceLimit; words.max = spaceLimit;
    track.k = advances * s.fontSize / s.width;
    track.b = TRACKING_STIFFNESS * restraint(s);
    track.min = s.trackingMin; track.max = s.trackingMax;
    const target = final ? s.minEnding : 1 - s.rag;
    const a = final ? (s.protectEndings && naturalFill < target ? 240 : 0) : 100;
    shareGap(target - naturalFill, a, tools, amounts);
    // Use bounded negative adjustment to admit a word that just barely doesn't fit.
    fitMeasure(naturalFill, tools, amounts);
    wordSpacing = amounts[0];
    tracking = amounts[1];
  }
  let width = natural + advances * tracking * s.fontSize;
  if (wordSpacing !== 0) width += spaces * wordSpacing * s.fontSize;
  const overflow = width > s.width + 0.05;
  if (overflow && end - start > 1) return null;
  return { start, end, text, natural, width, tracking, wordSpacing, fill: width / s.width, overflow };
}
```

Bit-identity notes for the reviewer:
- The old code entered the tracking branch only when
  `trackingMin < 0 || trackingMax > 0`. `shareGap` treats a tool with both
  bounds at 0 as disabled and leaves it at 0, so the outcome is the same.
- The old `b` was `1000 * restraint(s)`, which is the same as
  `TRACKING_STIFFNESS * restraint(s)`.
- The old gap expression was `target - naturalFill`; it is passed through
  unchanged.

- [ ] **Step 3: Pass `spaces` from the candidate loop (still disabled)**

In `paragraphCandidates`, replace the `buildLine(...)` call with:

```ts
      const spaces = separator ? end - start - 1 : 0;
      const line = buildLine(start, end, candidate, measure(candidate), advances, total, s, true, spaces, 0);
```

`greedy` keeps calling `buildLine(..., s, false)`; the defaults apply.

- [ ] **Step 4: Run the full unit suite**

Run: `npx tsc --noEmit && pnpm test`
Expected: tsc silent; all tests pass, including every
`optimizer.equivalence.test.ts` case. A failure there means the refactor
changed numbers. Diff `amounts` against the old formula for the failing case;
do not loosen the test.

- [ ] **Step 5: Run the search benchmark to check for slowdown**

Run: `pnpm bench:search` before this task (`git stash`) and after. Note both
totals.
Expected: within ~5% of each other. If it is slower by more, the likely cause
is property writes on `tools`. Inline the two-tool case into local variables
instead, keeping the same expressions.

- [ ] **Step 6: Commit**

```bash
git add src/optimizer.ts bench/reference-compose.ts
git commit -m "Route line adjustment through the weighted multi-tool solve"
```

---

### Task 5: Word spacing in the optimizer

**Files:**
- Modify: `src/optimizer.ts` (`Settings`, `lineCost`, `transition`, `paragraphCandidates`)
- Test: `src/optimizer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/optimizer.test.ts`:

```ts
test('word spacing at zero changes nothing', () => {
  assert.deepEqual(compose(texts, measure, { ...settings, wordSpacing: 0 }), compose(texts, measure, settings));
});

test('word spacing evens the edge on its own, within its bounds', () => {
  // Tracking off so only word spacing can move the edge.
  const flat = { ...settings, trackingMin: 0, trackingMax: 0, rag: 0, firmness: 1 };
  const before = metrics(compose(texts, measure, flat).paragraphs, flat);
  const spaced = { ...flat, wordSpacing: 0.5 };
  const result = compose(texts, measure, spaced);
  const after = metrics(result.paragraphs, spaced);
  assert.ok(after.deviation < before.deviation, `${after.deviation} vs ${before.deviation}`);
  assert.ok(result.paragraphs.some(p => p.lines.some(l => l.wordSpacing !== 0)));
  // The test measure gives a space 4 px at 16 px type: 0.25 em, so 50 % is 0.125 em.
  const limit = 0.5 * 4 / settings.fontSize;
  for (const line of result.paragraphs.flatMap(p => p.lines)) {
    assert.ok(Math.abs(line.wordSpacing) <= limit + 1e-12, `${line.wordSpacing}`);
    assert.equal(line.tracking, 0);
  }
  assert.equal(after.overflow, false);
});

test('word spacing never applies to Japanese, which has no word spaces', () => {
  const japanese = samples.japanese.split('\n\n');
  const result = compose(japanese, measure, { ...settings, wordSpacing: 0.5, firmness: 1 });
  for (const line of result.paragraphs.flatMap(p => p.lines)) assert.equal(line.wordSpacing, 0);
});

test('word spacing works on Arabic while its tracking stays locked at zero', () => {
  const arabic = samples.arabic.split('\n\n');
  const s = { ...settings, wordSpacing: 0.5, firmness: 1, rag: 0 };
  const lines = compose(arabic, measure, s).paragraphs.flatMap(p => p.lines);
  assert.ok(lines.some(line => line.wordSpacing !== 0));
  for (const line of lines) assert.equal(line.tracking, 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsx --test src/optimizer.test.ts`
Expected: FAIL. "evens the edge" and "works on Arabic" fail, because the
optimizer still passes a word-spacing limit of 0, so no line gets any word
spacing. (`tsx` does not type-check, so the unknown `wordSpacing` setting is
accepted at runtime.)

- [ ] **Step 3: Add the setting**

In `Settings`, after `firmness?: number;`:

```ts
  /** 0–0.5. How far each inter-word space may shrink or stretch, as a fraction
   *  of its natural width. 0 disables word-spacing adjustment. */
  wordSpacing?: number;
```

- [ ] **Step 4: Enable the tool in `paragraphCandidates`**

After `const spaceWidth = separator ? measure(separator) : 0;` add:

```ts
  // Word-spacing bound in em. Japanese has no separator, so no spaces to adjust.
  const spaceLimit = (s.wordSpacing ?? 0) * spaceWidth / s.fontSize;
```

In the candidate loop:
- Delete the `const spaces = …` line that Task 4 Step 3 added before the
  `buildLine` call.
- Replace everything from `const final = end === total;` through the
  `const shortest = …;` line (four statements plus the comment) with:

```ts
      const final = end === total;
      const spaces = separator ? end - start - 1 : 0;
      // Tracking and word spacing can move a line's width: allow for the full bounded amount.
      const trackingPx = advances * s.fontSize;
      const spacingPx = spaceLimit > 0 ? spaceLimit * spaces * s.fontSize : 0;
      const longest = s.width + band + (s.trackingMin < 0 ? -s.trackingMin * trackingPx : 0) + spacingPx;
      const shortest = s.width * 0.5 - band - (s.trackingMax > 0 ? s.trackingMax * trackingPx : 0) - spacingPx;
```

The `buildLine` call becomes:

```ts
      const line = buildLine(start, end, candidate, measure(candidate), advances, total, s, true, spaces, spaceLimit);
```

When the tool is off, `spacingPx` is exactly `0`, and `x + 0` / `x - 0`
leave the bounds bit-identical.

- [ ] **Step 5: Cost terms**

In `lineCost`, replace the `track` line with:

```ts
  const track = 0.10 * restraint(settings) * square(line.tracking / 0.01)
    + (line.wordSpacing !== 0 ? WORD_STIFFNESS * restraint(settings) * square(line.wordSpacing) : 0);
```

In `transition`, replace the return with:

```ts
  return 0.035 * restraint(s) * square((a.tracking - b.tracking) / 0.01)
    + (a.wordSpacing !== b.wordSpacing ? 0.35 * WORD_STIFFNESS * restraint(s) * square(a.wordSpacing - b.wordSpacing) : 0)
    + (final ? 0 : 0.16 * square((a.fill - b.fill) / 0.12));
```

Both new terms use the tracking ratios: the usage cost equals the solve's
stiffness (`0.10·(t/0.01)² = 1000·t²`), and the change cost is 0.35 × the
stiffness, as `0.035·(Δt/0.01)² = 350·Δt²` is for tracking.

- [ ] **Step 6: Run the tests**

Run: `npx tsc --noEmit && pnpm test`
Expected: everything passes, including the four new tests and the unchanged
equivalence suite.

- [ ] **Step 7: Commit**

```bash
git add src/optimizer.ts src/optimizer.test.ts
git commit -m "Add word spacing as a second line-adjustment tool"
```

---

### Task 6: Word spacing in the UI and rendering

**Files:**
- Modify: `src/ui-template.ts:1-7`
- Modify: `src/app.html` (composition section)
- Modify: `src/main.ts` (defaults, controls, `updateScriptUI`, inspector, export)
- Modify: `src/rendering.ts:85-88`
- Test: `tests/playground.spec.ts`

- [ ] **Step 1: Write the failing browser tests**

Append to `tests/playground.spec.ts`:

```ts
test('word spacing flex evens Arabic lines with tracking locked at zero', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('#language').selectOption('ar');
  await settled(page);
  const bodyFills = () => page.evaluate(() => (window as any).__composition.result.paragraphs
    .flatMap((p: any) => p.lines.slice(0, -1).map((l: any) => l.fill)) as number[]);
  await setRange(page, 'rag', 0);
  await setRange(page, 'firmness', 100);
  const ragged = Math.min(...await bodyFills());
  await setRange(page, 'word-spacing', 50);
  await expect(page.locator('#word-spacing-value')).toHaveText('50%');
  // Arabic lines have few spaces, so 50 % flex narrows the rag rather than
  // closing it; the shortest body line must still get longer.
  expect(Math.min(...await bodyFills())).toBeGreaterThan(ragged);
  const geometry = await page.evaluate(() => {
    const models = (window as any).__composition.result.paragraphs.flatMap((p: any) => p.lines);
    const rendered = [...document.querySelectorAll('#optimized .composed-line')];
    const column = document.querySelector('#optimized')!.getBoundingClientRect();
    return {
      error: Math.max(...rendered.map((el, i) => Math.abs(el.querySelector('.line-text')!.getBoundingClientRect().width - models[i].width))),
      spill: Math.max(...rendered.map(el => column.left - el.querySelector('.line-text')!.getBoundingClientRect().left)),
      tracking: Math.max(...models.map((l: any) => Math.abs(l.tracking))),
      spaced: models.some((l: any) => l.wordSpacing !== 0),
    };
  });
  expect(geometry.error).toBeLessThan(0.3);
  // RTL: lines grow leftwards, so spill shows as text left of the column.
  expect(geometry.spill).toBeLessThan(0.5);
  expect(geometry.tracking).toBe(0);
  expect(geometry.spaced).toBe(true);
  // Native copy is still the original text.
  const expected = await page.locator('#baseline p').allTextContents();
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#optimized')!);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected.join('\n\n'));
});

test('word spacing flex is disabled for all-Japanese text', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await expect(page.locator('#word-spacing')).toBeEnabled();
  await page.locator('#language').selectOption('ja');
  await settled(page);
  await expect(page.locator('#word-spacing')).toBeDisabled();
  await expect(page.locator('#word-spacing-note')).toContainText('no word spaces');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test -g "word spacing"`
Expected: both FAIL. Locator `#word-spacing` is not found.

- [ ] **Step 3: Slider definition**

In `src/ui-template.ts`, add to `ranges` directly after the `rag` entry:

```ts
  'word-spacing': ['Word spacing flex', 0, 50, 0, '%', 'Fixed|Flexible', 5],
```

In `src/app.html`, after `{{range:rag}}`, insert:

```html
            {{range:word-spacing}}
            <p id="word-spacing-note" class="control-note">How far each space may shrink or stretch. The loosest way to even the edge; firmness decides how eagerly it is used.</p>
```

- [ ] **Step 4: Wire the control in `src/main.ts`**

`defaults`: add `wordSpacing: 0` before `protectEndings: true`.

`controls`: add after the `rag` entry:

```ts
  'word-spacing': { key: 'wordSpacing', factor: .01, unit: '%' },
```

In `updateScriptUI`, after the tracking-note statement, add:

```ts
  const noSpaces = paragraphs.every(text => segmentText(text).separator === '');
  $<HTMLInputElement>('#word-spacing').disabled = noSpaces;
  $('#word-spacing-note').textContent = noSpaces
    ? 'Japanese has no word spaces; tracking handles its edge.'
    : 'How far each space may shrink or stretch. The loosest way to even the edge; firmness decides how eagerly it is used.';
```

Change the `./language` import at `src/main.ts:13` to:

```ts
import { detectLanguage, directionFor, normalizeText, hasArabic, segmentText } from './language';
```

In the line inspector (`#line-inspector` innerHTML), after the tracking
`<strong>`, append:

```ts
${line.wordSpacing ? `<span>words ${line.wordSpacing >= 0 ? '+' : '−'}${Math.abs(line.wordSpacing).toFixed(3)} em</span>` : ''}
```

In the export snapshot template, change the line span's style from
`letter-spacing:${l.tracking}em` to
`letter-spacing:${l.tracking}em;word-spacing:${l.wordSpacing}em`. In its
`@media` rule, change `letter-spacing:normal!important` to
`letter-spacing:normal!important;word-spacing:normal!important`.

- [ ] **Step 5: Render word spacing**

In `src/rendering.ts`, inside `renderOptimized`, replace

```ts
        + `<span class="line-text">${inner}</span>${trailing}${guide}</span>`);
```

with

```ts
        + `<span class="line-text"${line.wordSpacing ? ` style="word-spacing:${line.wordSpacing}em"` : ''}>${inner}</span>${trailing}${guide}</span>`);
```

It goes on `.line-text`, not the line box, so the trailing separator outside it
keeps its natural width and cannot push the line box past the column.

- [ ] **Step 6: Run the browser tests**

Run: `npx playwright test -g "word spacing"`
Expected: both PASS.

If the geometry `error` is ≥ 0.3, compare `spaceWidth` (Canvas
`measure(' ')`) with the DOM width of a lone space in the same font. Arabic
shaping can give the space a different advance in context. In that case,
measure the space as `measure('a a') − measure('aa')` using a letter from the
paragraph's script, and record the finding in `research/README.md`.

- [ ] **Step 7: Run every suite**

Run: `npx tsc --noEmit && pnpm test && pnpm test:e2e`
Expected: all pass (37 browser tests: the 35 before this task plus the two
new ones).

- [ ] **Step 8: Commit**

```bash
git add src/ui-template.ts src/app.html src/main.ts src/rendering.ts tests/playground.spec.ts
git commit -m "Add word spacing flex control and render per-line word spacing"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (Playground list)
- Modify: `research/README.md` (model section)

- [ ] **Step 1: README**

In `README.md`, after the **Edge firmness** bullet, add:

```markdown
- **Word spacing flex** (default 0, up to 50 %) lets each space shrink or stretch by up to that fraction of its natural width. It is the loosest way to even the edge and works for Arabic, whose tracking stays at zero. Japanese has no word spaces, so the control is disabled there. Firmness decides how eagerly it is used.
```

- [ ] **Step 2: research/README.md**

After the paragraph ending "Firmness 0 (the default) reproduces the original
model exactly.", add:

```markdown
Tracking is one of several tools sharing a line's gap (`src/stretch.ts`). Each tool i changes fill by `kᵢ` per unit and costs `Bᵢ·r` per unit², and the solve minimizes `A(f + Σkᵢxᵢ − target)² + Σ Bᵢ r xᵢ²` within each tool's bounds, re-solving after any tool hits a bound. Word spacing has `k = spaces·s/L` and `B = 10`; tracking has `k = g·s/L` and `B = 1000`. In ordinary English that makes word spacing about 2.5× cheaper per unit of fill. Its bounds are `±wordSpacing·spaceWidth` in em. Usage and line-to-line change costs follow the tracking ratios. If the adjusted line exceeds the measure, tools shrink loosest first until it fits. With a single active tool, the solve reproduces the original tracking expression bit for bit, which the equivalence suite checks.
```

- [ ] **Step 3: Commit**

```bash
git add README.md research/README.md
git commit -m "Document word spacing flex and the multi-tool solve"
```

---

## After this plan

Write the next plans from the spike decisions in `research/SPIKES.md`:

1. **Kashida.** `kashidaSites`, a third tool with integer rounding, and the
   mechanism the spike chose per browser.
2. **Width axis.** The `wdth` font builds, detection, interpolated or per-step
   measurement, and a fourth tool with 1% rounding.
3. **Speed pass.** Parallel paragraph workers, skipping native geometry when it
   can't be seen, then the WASM SIMD kernel experiment.
