/**
 * Browser bench for the DOM halves of the pipeline: native geometry, worker
 * search, DOM commit and layout-shift. Driven from `bench/run.ts` (Playwright)
 * so viewport and environment stay controlled; every stage can also be poked
 * by hand from the devtools console via `window.bench`.
 */
import { compose } from '../src/optimizer';
import type { Composition, Layout, Settings } from '../src/optimizer';
import { createCanvasMeasure } from '../src/text-metrics';
import { families, loadFonts } from '../src/fonts';
import type { Typeface } from '../src/fonts';
import { detectLanguage, directionFor, normalizeText } from '../src/language';
import { readNativeLayout } from '../src/native-layout';
import { annotateParagraph, renderBaselineGuides, renderOptimized } from '../src/rendering';
import { renderVisualizers } from '../src/visualizers';
import type { ComposeResponse, WorkerResponse } from '../src/protocol';
import { makeParagraphs, chars } from './corpus';

const settings: Settings = {
  width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
  rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true,
};
const column = document.querySelector<HTMLElement>('#column')!;
const now = () => performance.now();
const reps = <T>(n: number, fn: () => T) => {
  const samples: number[] = [];
  let value!: T;
  for (let i = 0; i < n; i++) { const t = now(); value = fn(); samples.push(now() - t); }
  samples.sort((a, b) => a - b);
  return { value, min: samples[0], median: samples[(samples.length / 2) | 0], samples };
};
const flushLayout = () => { column.getBoundingClientRect(); };

let shifts: number[] = [];
const shiftObserver = new PerformanceObserver(list => {
  for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
    if (!entry.hadRecentInput) shifts.push(entry.value);
  }
});
shiftObserver.observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);

function plainParagraphs(texts: string[], typeface: Typeface) {
  const fragment = document.createDocumentFragment();
  for (const text of texts) {
    const p = document.createElement('p');
    p.textContent = normalizeText(text);
    annotateParagraph(p, text, 'auto');
    fragment.append(p);
  }
  column.replaceChildren(fragment);
  column.style.setProperty('--measure', `${settings.width / 16}rem`);
  column.style.setProperty('--type-size', `${settings.fontSize / 16}rem`);
  column.style.setProperty('--reading-font', families[typeface]);
  flushLayout();
}

let worker: Worker | undefined;
let nextId = 1;
const requests = new Map<number, (response: ComposeResponse) => void>();
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../src/composer.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    if ('kind' in response) return;
    requests.get(response.id)?.(response);
    requests.delete(response.id);
  };
  return worker;
}
function ask(paragraphs: string[], s: Settings, typeface: Typeface): Promise<{ response: ComposeResponse; roundTrip: number }> {
  const id = nextId++;
  const active = ensureWorker();
  return new Promise(resolve => {
    requests.set(id, response => resolve({ response, roundTrip: now() - started }));
    const started = now();
    active.postMessage({ id, paragraphs, settings: s, typeface, direction: 'auto' });
  });
}

/** Main-thread composition, to attribute search vs measurement without a worker. */
function composeOnMain(paragraphs: string[], s: Settings, typeface: Typeface) {
  const measurements = new Map<string, ReturnType<typeof createCanvasMeasure>>();
  const measure = (text: string) => {
    const key = 'x';
    let m = measurements.get(key);
    if (!m) {
      m = createCanvasMeasure(new OffscreenCanvas(1, 1).getContext('2d')!, `400 ${s.fontSize}px ${families[typeface]}`, false, 'ltr', false);
      measurements.set(key, m);
    }
    return m.measure(text);
  };
  const result = compose(paragraphs, measure, s);
  const calls = [...measurements.values()].reduce((n, m) => n + m.calls, 0);
  const duration = [...measurements.values()].reduce((n, m) => n + m.duration, 0);
  return { result, calls, duration };
}

export interface StageReport {
  paragraphs: number;
  chars: number;
  lines: number;
  candidates: number;
  explored: number;
  nativeMs: number;
  nativeReps: number[];
  nativeUnits: number;
  worker: { roundTrip: number; elapsed: number; searchMs: number; measureMs: number; measurements: number; fontMs: number };
  warm: { roundTrip: number; searchMs: number; measureMs: number; measurements: number };
  main: { total: number; measureCalls: number; measureMs: number };
  render: { ms: number; layoutMs: number; elements: number; shift: number };
  rerenderSameLayout: { ms: number; layoutMs: number; elements: number };
  /** Paragraph height change native → composed; the CLS driver on a long page. */
  lineDelta: { nativeLines: number; composedLines: number; heightDeltaPx: number; changedParagraphs: number };
  resize: { width: number; roundTrip: number; nativeMs: number; renderMs: number; layoutMs: number }[];
  copy: { ok: boolean; textLength: number };
}

async function run(paragraphCount: number, width = 390): Promise<StageReport> {
  const texts = makeParagraphs(paragraphCount);
  const typeface: Typeface = 'serif';
  settings.width = width;
  await loadFonts(typeface, texts.join('\n'), document.fonts);
  await document.fonts.ready;

  // --- native geometry -----------------------------------------------------
  plainParagraphs(texts, typeface);
  const nativeWidth = column.getBoundingClientRect().width;
  const actual: Settings = { ...settings, width: Math.max(1, nativeWidth - 1) };
  const native = reps(5, () => readNativeLayout(column, nativeWidth, actual));
  const baseline = native.value;
  const nativeUnits = texts.reduce((n, t) => n + t.split(/\s+/).length, 0);

  // --- cold worker ---------------------------------------------------------
  worker?.terminate(); worker = undefined;
  requests.clear();
  const cold = await ask(texts, actual, typeface);
  const result = cold.response.result!;

  // --- warm worker ---------------------------------------------------------
  const warms: number[] = [];
  let warm = cold;
  for (let i = 0; i < 5; i++) { warm = await ask(texts, actual, typeface); warms.push(warm.roundTrip); }
  warms.sort((a, b) => a - b);

  // --- main-thread compose (measurement vs search attribution) -------------
  const mainStart = now();
  const main = composeOnMain(texts, actual, typeface);
  const mainTotal = now() - mainStart;

  // --- line-count / height delta: what shifts the rest of a long page -----
  plainParagraphs(texts, typeface);
  const nativeHeights = [...column.querySelectorAll('p')].map(p => p.getBoundingClientRect().height);
  const lineDelta = {
    nativeLines: baseline.reduce((n, p) => n + p.lines.length, 0),
    composedLines: result.paragraphs.reduce((n, p) => n + p.lines.length, 0),
    changedParagraphs: baseline.filter((p, i) => p.lines.length !== result.paragraphs[i].lines.length).length,
    heightDeltaPx: 0,
  };
  renderOptimized(column, result.paragraphs, texts, baseline, { direction: 'auto' });
  flushLayout();
  const composedHeights = [...column.querySelectorAll('p')].map(p => p.getBoundingClientRect().height);
  lineDelta.heightDeltaPx = composedHeights.reduce((n, h, i) => n + Math.abs(h - nativeHeights[i]), 0);

  // --- DOM commit ----------------------------------------------------------
  plainParagraphs(texts, typeface);
  flushLayout();
  shifts = [];
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const renderBefore = shifts.reduce((n, v) => n + v, 0);
  const renderStart = now();
  renderOptimized(column, result.paragraphs, texts, baseline, { direction: 'auto' });
  const renderDone = now();
  flushLayout();
  const layoutDone = now();
  const elements = column.querySelectorAll('*').length;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const renderShift = shifts.reduce((n, v) => n + v, 0) - renderBefore;

  // Re-render the same result (resize-like path without new search).
  plainParagraphs(texts, typeface);
  flushLayout();
  const againStart = now();
  renderOptimized(column, result.paragraphs, texts, baseline, { direction: 'auto' });
  const againDone = now();
  flushLayout();
  const againLayout = now();

  // --- resize path: warm recompose at several widths ----------------------
  const resize: StageReport['resize'] = [];
  for (const nextWidth of [Math.round(width * 0.92), Math.round(width * 1.08), width, Math.round(width * 0.75)]) {
    settings.width = nextWidth;
    plainParagraphs(texts, typeface);
    const base = column.getBoundingClientRect().width;
    const s2 = { ...settings, width: Math.max(1, base - 1) };
    const response = await ask(texts, s2, typeface);
    const started = now();
    const nextBaseline = readNativeLayout(column, base, s2);
    const measured = now();
    renderOptimized(column, response.response.result!.paragraphs, texts, nextBaseline, { direction: 'auto' });
    const rendered = now();
    flushLayout();
    resize.push({ width: Math.round(base), roundTrip: response.roundTrip, nativeMs: measured - started,
      renderMs: rendered - measured, layoutMs: now() - rendered });
    plainParagraphs(texts, typeface);
  }

  // --- copy integrity on the rendered DOM ---------------------------------
  plainParagraphs(texts, typeface);
  renderOptimized(column, result.paragraphs, texts, baseline, { direction: 'auto' });
  const normalizedSource = texts.map(normalizeText);
  const paragraphs = [...column.querySelectorAll('p')];
  const copy = {
    ok: paragraphs.every((p, i) => p.textContent!.replace(/\s+/gu, ' ').trim() === normalizedSource[i]),
    textLength: paragraphs.reduce((n, p) => n + (p.textContent?.length ?? 0), 0),
  };

  return {
    paragraphs: paragraphCount, chars: chars(texts), lines: result.paragraphs.flatMap(p => p.lines).length,
    candidates: result.candidates, explored: result.explored,
    nativeMs: native.median, nativeReps: native.samples, nativeUnits,
    worker: { roundTrip: cold.roundTrip, elapsed: cold.response.elapsed, searchMs: cold.response.searchMs,
      measureMs: cold.response.measureMs, measurements: cold.response.measurements, fontMs: cold.response.fontMs },
    warm: { roundTrip: warms[2], searchMs: warm.response.searchMs, measureMs: warm.response.measureMs, measurements: warm.response.measurements },
    main: { total: mainTotal, measureCalls: main.calls, measureMs: main.duration },
    render: { ms: renderDone - renderStart, layoutMs: layoutDone - renderDone, elements, shift: renderShift },
    rerenderSameLayout: { ms: againDone - againStart, layoutMs: againLayout - againDone, elements: column.querySelectorAll('*').length },
    lineDelta,
    resize,
    copy,
  };
}

/** Visualizers + guides cost (diagnostics on). */
async function diagnostics(paragraphCount: number, width = 390) {
  const texts = makeParagraphs(paragraphCount);
  settings.width = width;
  await loadFonts('serif', texts.join('\n'), document.fonts);
  await document.fonts.ready;
  plainParagraphs(texts, 'serif');
  const nativeWidth = column.getBoundingClientRect().width;
  const s: Settings = { ...settings, width: nativeWidth - 1 };
  const baseline = readNativeLayout(column, nativeWidth, s);
  const { result } = composeOnMain(texts, s, 'serif');
  renderOptimized(column, result.paragraphs, texts, baseline, { direction: 'auto' });
  flushLayout();
  const t = reps(3, () => {
    renderVisualizers(column, result.paragraphs, baseline, true, s);
    flushLayout();
  });
  const guides = reps(3, () => { renderBaselineGuides(column, baseline, settings.fontSize); flushLayout(); });
  return { visualizersMs: t.median, guidesMs: guides.median, marks: column.querySelectorAll('.diagnostic-mark').length };
}

Object.assign(window, { bench: { run, diagnostics, compose, settings, get mark() { return column.querySelectorAll('*').length; } } });
(window as unknown as { benchReady: boolean }).benchReady = true;
console.log('bench ready');
