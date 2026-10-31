// The app's composer (src/), run as the home page runs it: the same worker, fonts,
// search, rendering and metrics. The prototype hands it the text, the settings and
// a column of the browser's own text to compare with; it hands back the composed
// lines, then the timings once they're on screen.
import { fontBinaries, installWidthSteps, loadFonts, widthSteps } from '../../../src/fonts.ts';
import { createMeasure } from '../../../src/measure.ts';
import { compose } from '../../../src/optimizer.ts';
import { readNativeLayout } from '../../../src/native-layout.ts';
import { hyphenationPoints, hyphenPenalty, loadHyphenator } from '../../../src/hyphenation.ts';

export { families, fontLanguages, widthRange } from '../../../src/fonts.ts';
export { justified, metrics, paragraphSettings } from '../../../src/optimizer.ts';
export { bindInspection, renderOptimized } from '../../../src/rendering.ts';
export { samples } from '../../../src/samples.ts';
export { benchmark, publishTiming } from '../../../src/benchmark.ts';
export { readNativeLayout };
export { normalizeText } from '../../../src/language.ts';

const now = () => performance.now();

/* input(): what to compose now, or nothing to skip: { paragraphs, settings (no
   width), typeface, direction, native (the browser's column, read for the width
   and the baseline), hyphen: { language, minWord, minBefore, minAfter, frequency }
   or nothing }. render(composition): paint it. status(words): what it's doing.
   timed(timing): the whole trip, after the next paint. */
export function createComposer({ input, render, status, timed }) {
  let worker, workerReady = Promise.resolve(), workerDead = false;
  const sent = new Set();
  let id = 0, busy = false, pending = false, pendingSince = 0, watchdog = 0, active, completion;
  let fallback, fallbackKey = '';
  const pageSteps = new Map();
  let hyphenCache;

  function newFonts() {
    return fontBinaries().filter(font => {
      const key = `${font.family}:${font.weight}:${font.range}`;
      if (sent.has(key)) return false;
      sent.add(key);
      return true;
    });
  }
  function ensureWorker() {
    if (worker) return worker;
    if (workerDead) return undefined;
    try {
      worker = new Worker(new URL('../../../src/composer.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      workerDead = true;
      return undefined;
    }
    sent.clear();
    let ready;
    workerReady = new Promise(resolve => { ready = resolve; });
    worker.onmessage = event => {
      const response = event.data;
      if ('kind' in response) {
        if (response.kind === 'booted') ready();
        return;
      }
      accept(response);
    };
    worker.onerror = () => {
      workerDead = true;
      worker?.terminate();
      worker = undefined;
      fail('The composition worker could not start');
    };
    return worker;
  }
  // The last resort, where module workers are blocked or never answer.
  async function composeHere(request) {
    await installWidthSteps(fontBinaries(), widthSteps(request.settings.widthFlex ?? 0), document.fonts, pageSteps);
    const started = now();
    const key = `${request.typeface}:${request.settings.fontSize}:${request.direction}`;
    if (key !== fallbackKey || !fallback) {
      fallback = createMeasure(request.settings, request.typeface, request.direction);
      fallbackKey = key;
    }
    const calls = fallback.calls, duration = fallback.duration;
    const result = compose(request.paragraphs, fallback.measure, request.settings, fallback.measureAt);
    const elapsed = now() - started, measureMs = fallback.duration - duration;
    accept({ id: request.id, result, elapsed, measurements: fallback.calls - calls, fontMs: 0, measureMs,
      searchMs: Math.max(0, elapsed - measureMs), engine: 'js', helpers: 0, here: true });
  }

  function release() {
    busy = false;
    if (pending) void run(false, pendingSince);
  }
  function fail(message) {
    clearTimeout(watchdog);
    status(`${message}. Browser wrapping is kept.`, true);
    completion?.(undefined);
    completion = undefined;
    release();
  }
  function accept(response) {
    if (response.id !== id) return;
    clearTimeout(watchdog);
    if (response.error || !response.result) return fail(`Could not compose: ${response.error ?? 'unknown error'}`);
    const renderStart = now(), context = active, resolve = completion;
    render({ ...context, result: response.result, response });
    // After the next frame: a task queued inside requestAnimationFrame runs once
    // that frame is drawn.
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        if (response.id !== id) return resolve?.(undefined);
        const totalMs = now() - context.started, fontMs = context.mainFontMs + response.fontMs, renderMs = now() - renderStart;
        const timing = { totalMs, fontMs, nativeMs: context.nativeMs, measureMs: response.measureMs, searchMs: response.searchMs,
          renderMs, otherMs: Math.max(0, totalMs - fontMs - context.nativeMs - response.measureMs - response.searchMs - renderMs),
          queueMs: context.started - context.scheduled, mode: context.mode, measurements: response.measurements,
          engine: response.engine ?? 'js', helpers: response.helpers ?? 0 };
        timed(timing, { ...context, result: response.result, response });
        resolve?.(timing);
        if (completion === resolve) completion = undefined;
      };
      channel.port2.postMessage(null);
    });
    release();
  }

  async function hyphenationFor(paragraphs, hyphen) {
    if (!hyphen) return undefined;
    const key = `${hyphen.language}:${hyphen.minWord}:${hyphen.minBefore}:${hyphen.minAfter}:${paragraphs.join('\n')}`;
    if (hyphenCache?.key !== key) hyphenCache = { key, points: hyphenationPoints(paragraphs, await loadHyphenator(hyphen.language), hyphen) };
    return hyphenCache.points;
  }

  // One solve in flight and the latest input waiting, never a queue.
  async function run(cold = false, scheduled = now()) {
    pending = false;
    completion?.(undefined);
    completion = undefined;
    const my = ++id;
    const next = input();
    if (!next) return void release();
    busy = true;
    const settings = { ...next.settings };
    settings.hyphenation = await hyphenationFor(next.paragraphs, next.hyphen);
    settings.hyphenPenalty = settings.hyphenation ? hyphenPenalty(next.hyphen.frequency) : 0;
    const started = now();
    status('Preparing fonts and layout…');
    try {
      await loadFonts(next.typeface, next.paragraphs.join('\n'), document.fonts);
      await document.fonts.ready;
      if (my !== id) return;
      const mainFontMs = now() - started;
      const width = Math.floor(next.native.getBoundingClientRect().width * 100) / 100;
      if (!width) return void release();
      const nativeStart = now();
      const baseline = readNativeLayout(next.native, width, settings);
      const nativeMs = now() - nativeStart;
      const request = { id: my, paragraphs: next.paragraphs, settings: { ...settings, width: Math.max(1, width - 1) },
        typeface: next.typeface, direction: next.direction };
      active = { request, baseline, width, started, scheduled, mainFontMs, nativeMs, mode: cold || !worker ? 'cold' : 'warm' };
      // A cold run starts a fresh worker, with an empty measurement cache.
      if (cold) { worker?.terminate(); worker = undefined; }
      status('Considering the possibilities…');
      const completed = new Promise(resolve => { completion = resolve; });
      const live = ensureWorker();
      if (!live) { void composeHere(request); return await completed; }
      void workerReady.then(() => {
        if (my !== id || live !== worker) return;
        request.fonts = newFonts();
        live.postMessage(request);
      });
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (my !== id) return;
        workerDead = true;
        worker?.terminate();
        worker = undefined;
        void composeHere(request);
      }, 2500);
      return await completed;
    } catch (error) {
      if (my === id) fail(error instanceof Error ? error.message : String(error));
    }
  }
  function schedule() {
    if (!pending) pendingSince = now();
    pending = true;
    if (!busy) void run(false, pendingSince);
  }
  return { schedule, run, get busy() { return busy || pending; } };
}
