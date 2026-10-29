/**
 * Blog-post fixture: 35 paragraphs of body copy composed on load, then
 * recomposed on resize. Answers the two questions the lab UI hides:
 *
 *   1. What does the swap cost in layout shift on a real article page?
 *   2. Is resize smooth when the composition re-runs?
 *
 * Modes (query string):
 *   naive    – browser-wrapped text painted, then swapped for composed lines
 *   reserve  – each paragraph and the article keep their native height
 *   hidden   – reserve, and keep the text invisible until composed
 *   off      – control: browser wrapping only, no composition
 *
 * The measurement window opens *after* the fonts are ready and the baseline
 * article has painted, so font swap and the fixture's own first fill are not
 * counted as composition cost. That is the honest question: what does composing
 * add on top of a normally rendered page?
 */
import type { Composition, Settings } from '../src/optimizer';
import { families, fontBinaries, loadFonts } from '../src/fonts';
import { normalizeText } from '../src/language';
import { readNativeLayout } from '../src/native-layout';
import { annotateParagraph, renderOptimized } from '../src/rendering';
import type { ComposeResponse, ComposeRequest, WorkerResponse } from '../src/protocol';
import { makeParagraphs } from './corpus';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'reserve';
const paragraphCount = Number(params.get('n') ?? 35);
const article = document.querySelector<HTMLElement>('#article')!;
const texts = makeParagraphs(paragraphCount);
const settings: Settings = {
  width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
  rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true,
};
const now = () => performance.now();
const marks: Record<string, number> = { start: now() };
const longTasks: { start: number; duration: number }[] = [];
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
}).observe({ type: 'longtask', buffered: true });

let shifts: { value: number; start: number; sources: number; nodes: string }[] = [];
new PerformanceObserver(list => {
  for (const entry of list.getEntries() as unknown as { value: number; startTime: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
    if (entry.hadRecentInput) continue;
    const nodes = (entry.sources ?? []).map(s => (s.node as HTMLElement | undefined)?.nodeName ?? '?').join(',');
    shifts.push({ value: entry.value, start: entry.startTime, sources: entry.sources?.length ?? 0, nodes });
  }
}).observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);
Object.defineProperty(window, '__shifts', { get: () => shifts.reduce((n, v) => n + v.value, 0) });
Object.defineProperty(window, '__shiftLog', { get: () => shifts });

function plain(hidden = false) {
  const fragment = document.createDocumentFragment();
  for (const text of texts) {
    const p = document.createElement('p');
    p.textContent = normalizeText(text);
    annotateParagraph(p, text, 'auto');
    fragment.append(p);
  }
  article.classList.remove('composed');
  article.replaceChildren(fragment);
  if (hidden) article.style.visibility = 'hidden';
}

let worker: Worker | undefined;
function startWorker() {
  if (!worker) {
    marks.workerStart = now();
    worker = new Worker(new URL('../src/composer.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', event => {
      if ((event.data as WorkerResponse & { kind?: string }).kind === 'ready') marks.workerReady = now();
    });
  }
  return worker;
}
/** Warm the worker's font subsets while the page is still fetching its own. */
function warmWorker() {
  const text = texts.join('\n');
  void loadFonts('serif', text, document.fonts)
    .then(() => startWorker().postMessage({ warm: true, typeface: 'serif', text, fonts: fontBinaries() }));
}
function composeInWorker(paragraphs: string[], s: Settings): Promise<ComposeResponse> {
  const active = startWorker();
  return new Promise(resolve => {
    const id = ++nextId;
    const handler = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if ('kind' in response || response.id !== id) return;
      active.removeEventListener('message', handler);
      resolve(response);
    };
    active.addEventListener('message', handler);
    const text = paragraphs.join('\n');
    active.postMessage({ id, paragraphs, settings: s, typeface: 'serif', direction: 'auto',
      fonts: fontBinaries() } satisfies ComposeRequest);
  });
}
let nextId = 0;

const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

async function run() {
  // --- a real page waits for its fonts before painting body text -----------
  warmWorker();
  await loadFonts('serif', texts.join('\n'), document.fonts);
  await document.fonts.ready;
  marks.fonts = now();

  if (mode === 'off') {
    plain();
    await frame();
    marks.plain = now();
    marks.settled = now();
    Object.assign(window, { __blog: { mode, marks, shifts, longTasks, texts } });
    return;
  }

  plain(mode === 'hidden');
  await frame();
  marks.plain = now();
  // Open the measurement window: everything from here is composition cost.
  shifts = [];
  article.getBoundingClientRect();

  const width = Math.floor(article.getBoundingClientRect().width);
  const s: Settings = { ...settings, width: width - 1 };
  const nativeStart = now();
  const baseline = readNativeLayout(article, width, s);
  const nativeHeight = article.getBoundingClientRect().height;
  marks.native = now() - nativeStart;
  marks.nativeHeight = nativeHeight;

  if (mode === 'reserve') {
    article.style.minHeight = `${nativeHeight}px`;
    for (const p of article.querySelectorAll('p')) (p as HTMLElement).style.minHeight = `${p.getBoundingClientRect().height}px`;
  }

  const sent = now();
  const response = await composeInWorker(texts, s);
  const received = now();
  const result = response.result as Composition;
  marks.search = received - sent;
  marks.workerInternal = response.elapsed;
  marks.workerMeasure = response.measureMs;

  const renderStart = now();
  renderOptimized(article, result.paragraphs, texts, baseline, {
    direction: 'auto',
    reservePixels: mode === 'naive' ? undefined
      : baseline.map(p => (p.lines.length ? p.lines.length * 29.45 : undefined)),
    reserveHeight: mode === 'naive' ? undefined : nativeHeight,
  });
  article.classList.add('composed');
  if (mode === 'hidden') article.style.visibility = '';
  article.getBoundingClientRect();
  marks.render = now() - renderStart;
  marks.settled = now();
  await frame();
  marks.painted = now();
  Object.assign(window, {
    __blog: { mode, marks, result, baseline, texts, shifts, longTasks,
      worker: { elapsed: response.elapsed, searchMs: response.searchMs, measureMs: response.measureMs,
        roundTrip: received - sent, startup: (marks.workerReady ?? 0) - (marks.workerStart ?? 0) } },
  });

  // --- resize path: recompose in place, measure main-thread cost -----------
  const resizeMarks: { width: number; native: number; worker: number; render: number; layout: number }[] = [];
  for (const next of [width - 40, width + 60]) {
    article.style.maxWidth = `${next}px`;
    article.style.removeProperty('min-height');
    plain();
    article.getBoundingClientRect();
    const start = now();
    const w = Math.floor(article.getBoundingClientRect().width);
    const nextSettings = { ...settings, width: w - 1 };
    const nextBaseline = readNativeLayout(article, w, nextSettings);
    const nativeDone = now();
    const nextResponse = await composeInWorker(texts, nextSettings);
    const workerDone = now();
    renderOptimized(article, nextResponse.result!.paragraphs, texts, nextBaseline, { direction: 'auto' });
    article.classList.add('composed');
    const renderDone = now();
    article.getBoundingClientRect();
    const layoutDone = now();
    resizeMarks.push({ width: w, native: nativeDone - start, worker: workerDone - nativeDone,
      render: renderDone - workerDone, layout: layoutDone - renderDone });
  }
  Object.assign((window as any).__blog, { resizeMarks });
}

void run().then(() => { (window as any).blogReady = true; });
