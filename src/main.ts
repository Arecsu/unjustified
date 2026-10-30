import '@fontsource-variable/dm-sans';
import './style.css';
import appTemplate from './app.html?raw';
import { icon } from './icons';
import { samples } from './samples';
import { rangeMarkup } from './ui-template';
import { families, loadFonts, fontLanguages, fontBinaries, installWidthSteps, widthRange, widthSteps } from './fonts';
import { createMeasure } from './measure';
import type { Typeface } from './fonts';
import type { ComposeRequest, ComposeResponse, WorkerResponse } from './protocol';
import { compose, metrics, wordsOf } from './optimizer';
import type { Composition, Layout, Settings } from './optimizer';
import { detectLanguage, directionFor, normalizeText, hasArabic, segmentText } from './language';
import type { DirectionPolicy } from './language';
import { readNativeLayout } from './native-layout';
import { annotateParagraph, bindInspection, cssRem, kashidaHtml, renderOptimized, renderBaselineGuides } from './rendering';
import { placeKashida } from './kashida';
import { renderVisualizers } from './visualizers';
import { benchmark, publishTiming } from './benchmark';
import type { RunTiming } from './benchmark';

/** Large enough for a full blog post. The search stays interactive because the
 * document beam is bounded, not because the input is capped. */
const MAX_PARAGRAPHS = 60;
const MAX_CHARACTERS = 30000;

/**
 * Reserving each paragraph's native height keeps a swap shift-free on pages that
 * paint browser-wrapped text before composing, at the cost of up to one blank
 * line in the paragraphs whose line count changes. Deployments that block first
 * paint until the composition is ready (see research/PERFORMANCE.md) do not need
 * it, and the lab shows the composed text without the extra space.
 */
const RESERVE_NATIVE_HEIGHT = false;

const defaults = { width: 390, fontSize: 19, letterSpacing: 0, trackingMin: -0.012, trackingMax: 0.012, rag: 0.055, minEnding: 0.32, sync: 0.65, firmness: 0, wordSpacingMin: 0, wordSpacingMax: 0, kashida: 0, widthFlex: 0, protectEndings: true } satisfies Settings;
let settings: Settings = { ...defaults };
let paragraphs = samples.editorial.split('\n\n');
let typeface: Typeface = 'serif';
let direction: DirectionPolicy = 'auto';
let current: Composition | undefined;
let baseline: Layout[] = [];
let worker: Worker | undefined;
let workerReady: Promise<void> = Promise.resolve();
let workerDead = false;
/** Main-thread measurement cache, used only if the worker cannot answer. */
let fallbackMeasure: ReturnType<typeof createMeasure> | undefined;
let fallbackKey = '';
let watchdog: ReturnType<typeof setTimeout> | undefined;
/** Support diagnostics: `__worker` tells you which path composed the page. */
const workerState = { booted: false, ready: false, dead: false, fallback: false, log: [] as string[] };
let busy = false;
let requestId = 0;
let pending = false;
let pendingSince = 0;
let canvasRevision = 0;
let activeRevision = 0;
let activeRequest: ComposeRequest | undefined;
const sentFonts = new Set<string>();
let lastWidth = 0;
let inspection = false;
let completion: ((timing: RunTiming | undefined) => void) | undefined;
let run = { started: 0, scheduled: 0, mainFontMs: 0, nativeMs: 0, mode: 'cold' as 'cold' | 'warm' };
let nativeHeights: number[] = [];
let nativeColumnHeight = 0;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = appTemplate.replace(/\{\{(icon|range):([^}]+)\}\}/g, (_match, kind: string, name: string) => kind === 'icon' ? icon(name as Parameters<typeof icon>[0]) : rangeMarkup(name as Parameters<typeof rangeMarkup>[0]));
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const baseEl = $('#baseline'), optEl = $('#optimized'), previews = $('#previews');
$('#mobile-controls-toggle').addEventListener('click', event => {
  const button = event.currentTarget as HTMLButtonElement;
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  button.querySelector('span[aria-hidden="true"]')!.textContent = expanded ? '−' : '+';
  $('.controls').classList.toggle('expanded', expanded);
});

const typefaceNames: Record<Typeface, string> = { serif: 'Source Serif 4', classic: 'Georgia', sans: 'DM Sans',
  roboto: 'Roboto Flex', japanese: 'Noto Sans JP', arabic: 'Noto Sans Arabic' };
/** Width flex follows the typeface: enabled only with a width axis, read from its faces. */
function updateWidthUI() {
  const range = widthRange(typeface);
  $<HTMLInputElement>('#width-flex').disabled = !range;
  $('#width-flex-note').textContent = range
    ? `Condenses lines along ${typefaceNames[typeface]}'s width axis (down to ${range[0]}%), in whole steps.`
    : `${typefaceNames[typeface]} has no width axis. Try Roboto Flex or Noto Sans Arabic.`;
}
function updateScriptUI() {
  const allArabic = paragraphs.every(hasArabic);
  for (const id of ['tracking-min', 'tracking-max']) $<HTMLInputElement>(`#${id}`).disabled = allArabic;
  $('#tracking-note').textContent = paragraphs.some(hasArabic)
    ? 'Arabic paragraphs keep natural connected shaping: tracking is held at zero. Other paragraphs use these limits.'
    : 'Independent shrink and expansion limits. Set either handle to zero to disable that direction.';
  const anyArabic = paragraphs.some(hasArabic);
  $<HTMLInputElement>('#kashida').disabled = !anyArabic;
  $('#kashida-note').textContent = anyArabic
    ? 'Arabic only: lengthens joins with tatweel (ـ), following the traditional priority. Copying returns the text without them.'
    : 'Kashida applies to Arabic text only.';
  const noSpaces = paragraphs.every(text => segmentText(text).separator === '');
  for (const id of ['word-spacing-min', 'word-spacing-max']) $<HTMLInputElement>(`#${id}`).disabled = noSpaces;
  $('#word-spacing-note').textContent = noSpaces
    ? 'Japanese has no word spaces; tracking handles its edge.'
    : 'How far each space may shrink or stretch. The loosest way to even the edge; firmness decides how eagerly it is used.';
  const lang = detectLanguage(paragraphs.join(' '));
  if (!fontLanguages[typeface].includes(lang)) {
    typeface = lang === 'ja' ? 'japanese' : lang === 'ar' ? 'arabic' : 'serif';
    $<HTMLSelectElement>('#typeface').value = typeface;
  }
  for (const option of $<HTMLSelectElement>('#typeface').options) {
    const supported = fontLanguages[option.value as Typeface].includes(lang);
    option.hidden = !supported;
    option.disabled = !supported;
  }
  const label = lang === 'ja' ? '日本語' : lang === 'ar' ? 'العربية' : 'English';
  $('#language-note').textContent = `${label} · ${direction === 'auto' ? 'automatic paragraph direction' : `${direction.toUpperCase()} override`}. Only fonts supporting this language are listed. Mixed-script passages may use separate Noto faces.`;
  // After any automatic typeface change above.
  updateWidthUI();
}
function refreshCanvas() {
  updateScriptUI();
  // Reset the measured width to the requested measure before the style change
  // is read back; the actual width is re-read below.
  previews.style.setProperty('--measure', cssRem(settings.width));
  previews.style.setProperty('--type-size', cssRem(settings.fontSize));
  previews.style.setProperty('--base-tracking', `${settings.letterSpacing}em`);
  previews.style.setProperty('--reading-font', families[typeface]);
  for (const parent of [baseEl, optEl]) {
    const fragment = document.createDocumentFragment();
    paragraphs.forEach(text => {
      const p = document.createElement('p'); p.textContent = normalizeText(text);
      annotateParagraph(p, text, direction); fragment.append(p);
    });
    parent.replaceChildren(fragment);
  }
  // New content invalidates the reserved height; the next render sets it again.
  optEl.style.removeProperty('min-height');
}

/** Start the worker while the page is painting. Messages are sent only after
 * its handler is installed, including when dev-server imports suspend startup. */
function warmWorker() {
  ensureWorker();
}

/** One in-flight solve plus one latest input, never an ever-growing worker
 * queue. A completed solve is painted even if the next width is already pending:
 * rejecting every superseded width would starve the preview during a drag. */
function releaseComposition() {
  busy = false;
  // Start the latest input immediately, without adding a timer or frame wait.
  if (pending) void recompute(false, pendingSince);
}
function acceptResponse(response: ComposeResponse) {
  if (response.id !== requestId) return;
  clearTimeout(watchdog); watchdog = undefined;
  if (activeRevision !== canvasRevision) {
    completion?.(undefined); completion = undefined;
  } else if (response.error || !response.result) {
    fail(`Could not compose: ${response.error ?? 'unknown error'}`);
    return;
  } else {
    current = response.result;
    renderResult(response);
  }
  // Do not wait for benchmark paint telemetry before starting the next solve.
  releaseComposition();
}
function newWorkerFonts() {
  return fontBinaries().filter(font => {
    const key = `${font.family}:${font.weight}:${font.range}`;
    if (sentFonts.has(key)) return false;
    sentFonts.add(key);
    return true;
  });
}
function fail(message: string) {
  clearTimeout(watchdog); watchdog = undefined;
  releaseComposition();
  optEl.classList.remove('is-recomposing');
  $('#status').classList.remove('is-busy'); $('#status').classList.add('has-error');
  $('#status-message').textContent = `${message}. Browser wrapping is preserved.`;
  completion?.(undefined); completion = undefined;
}
function ensureWorker(): Worker | undefined {
  if (worker) return worker;
  if (workerDead) return undefined;
  try {
    worker = new Worker(new URL('./composer.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerDead = true;
    return undefined;
  }
  sentFonts.clear();
  workerState.booted = false;
  workerState.ready = false;
  let ready!: () => void;
  workerReady = new Promise(resolve => { ready = resolve; });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    if ('kind' in response) {
      if (response.kind === 'booted') {
        workerState.booted = true;
        worker!.postMessage({ warm: true, typeface, text: paragraphs.join('\n'), fonts: newWorkerFonts() });
        ready();
      }
      if (response.kind === 'ready') workerState.ready = true;
      workerState.log.push('detail' in response ? `${response.kind}: ${response.detail}` : response.kind);
      Object.assign(window, { __worker: workerState });
      return;
    }
    acceptResponse(response);
  };
  worker.onerror = () => {
    // A worker that throws or fails to load its module is not recoverable here.
    workerDead = true;
    workerState.dead = true;
    Object.assign(window, { __worker: workerState });
    worker?.terminate(); worker = undefined;
    clearTimeout(watchdog); watchdog = undefined;
    fail('The composition worker could not start');
  };
  return worker;
}

/**
 * Compose on the main thread. Last-resort path for environments where module
 * workers are blocked (extensions, hardened browser profiles) or never answer:
 * a short document still renders immediately, and the page is never left saying
 * "Considering the possibilities…" forever.
 */
/** Width-step faces for main-thread measurement; the worker installs its own. */
const pageSteps = new Map<string, Promise<FontFace>>();
async function composeHere(request: ComposeRequest) {
  await installWidthSteps(fontBinaries(), widthSteps(request.settings.widthFlex ?? 0), document.fonts, pageSteps);
  acceptResponse(composeOnMainThread(request));
}
function composeOnMainThread(request: ComposeRequest): ComposeResponse {
  const started = performance.now();
  const key = `${request.typeface}:${request.settings.fontSize}:${request.direction}`;
  if (key !== fallbackKey || !fallbackMeasure) {
    fallbackMeasure = createMeasure(request.settings, request.typeface, request.direction);
    fallbackKey = key;
  }
  // Tracking weights and measure change the search, not the measurement cache.
  const result = compose(request.paragraphs, fallbackMeasure.measure, request.settings, fallbackMeasure.measureAt);
  const elapsed = performance.now() - started;
  workerState.fallback = true;
  Object.assign(window, { __worker: workerState });
  return { id: request.id, result, elapsed, measurements: fallbackMeasure.calls,
    fontMs: 0, measureMs: fallbackMeasure.duration,
    searchMs: Math.max(0, elapsed - fallbackMeasure.duration) };
}

async function recompute(cold = false, scheduled = performance.now()): Promise<RunTiming | undefined> {
  pending = false;
  completion?.(undefined); completion = undefined;
  const id = ++requestId;
  const revision = activeRevision = canvasRevision;
  // Width flex only applies to a typeface with a width axis.
  const input = { paragraphs, settings: { ...settings, widthFlex: widthRange(typeface) ? settings.widthFlex : 0 }, typeface, direction };
  const started = performance.now();
  const mode = cold || !worker ? 'cold' : 'warm';
  busy = true;
  $('#status').classList.add('is-busy');
  $('#status-message').textContent = 'Preparing fonts and layout…';
  try {
    await loadFonts(input.typeface, input.paragraphs.join('\n'), document.fonts);
    await document.fonts.ready;
    if (id !== requestId) return;
    if (revision !== canvasRevision) { releaseComposition(); return; }
    const mainFontMs = performance.now() - started;
    const width = Math.floor(baseEl.getBoundingClientRect().width * 100) / 100;
    if (!width) { releaseComposition(); return; }
    lastWidth = width;
    const nativeStart = performance.now();
    baseline = readNativeLayout(baseEl, width, input.settings);
    // Native paragraph heights reserve the composed block's space, so the
    // handful of paragraphs whose line count changes cannot shift the page.
    nativeHeights = [...baseEl.querySelectorAll('p')].map(p => p.getBoundingClientRect().height);
    nativeColumnHeight = baseEl.getBoundingClientRect().height;
    const nativeMs = performance.now() - nativeStart;
    run = { started, scheduled, mainFontMs, nativeMs, mode };
    const actual = { ...input.settings, width: Math.max(1, width - 1) };
    $('#measure-note').textContent = width < settings.width - 1
      ? `Fits this viewport: ${Math.round(width)} px (requested ${settings.width} px).`
      : `Actual measure: ${Math.round(width)} px. Resize to recompose.`;
    previews.querySelectorAll('.measure-rule span').forEach(el => { el.textContent = `${Math.round(width)} px`; });
    // A benchmark "cold" run is an explicit cold start; ordinary recompositions
    // keep the worker. Terminating it on every resize would discard every cached
    // measurement and force a fresh font setup, which is exactly the slow path.
    if (cold) { worker?.terminate(); worker = undefined; }
    // Stale replies are already ignored by request id.
    busy = true;
    $('#status').classList.remove('has-error'); $('#status').classList.add('is-busy');
    $('#status-message').textContent = 'Considering the possibilities…';
    const request: ComposeRequest = { id, ...input, settings: actual };
    activeRequest = request;
    const completed = new Promise<RunTiming | undefined>(resolve => { completion = resolve; });
    const activeWorker = ensureWorker();
    if (!activeWorker) {
      // No worker available at all: compose here so the page still works.
      void composeHere(request);
      return await completed;
    }
    // Module evaluation can suspend before onmessage is installed. Posting
    // earlier loses messages; wait for the handler handshake, not font warm-up.
    // The watchdog below also bounds this startup wait.
    void workerReady.then(() => {
      if (id !== requestId || activeWorker !== worker) return;
      request.fonts = newWorkerFonts();
      activeWorker.postMessage(request);
    }).catch(error => {
      if (id === requestId) fail(`Could not start composition: ${String(error)}`);
    });
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = undefined;
      if (id !== requestId) return;
      workerDead = true;
      workerState.dead = true;
      worker?.terminate(); worker = undefined;
      void composeHere(request);
      toast('Composed on the main thread: the worker did not respond.');
    }, 2500);
    return await completed;
  } catch (error) {
    if (id === requestId) fail(error instanceof Error ? error.message : String(error));
  }
}
function schedule(reset = true) {
  completion?.(undefined); completion = undefined;
  if (!pending) pendingSince = performance.now();
  pending = true;
  // Keep the previous composition on screen while the next one is prepared:
  // blanking the column mid-drag makes every resize look like a flash.
  const hadResult = Boolean(current);
  // Geometry updates must also happen on the non-reset path. Reusing the old
  // composed DOM must not mean reusing the old column width.
  previews.style.setProperty('--measure', cssRem(settings.width));
  if (reset) { canvasRevision++; refreshCanvas(); }
  // Stale composed lines use white-space: pre, so they can overflow a narrower
  // column until the new composition lands. Clip them rather than flashing the
  // native text back in.
  if (hadResult && !reset) optEl.classList.add('is-recomposing');
  $('#status').classList.add('is-busy');
  $('#status-message').textContent = hadResult ? 'Recomposing…' : 'Preparing fonts and layout…';
  // Dispatch immediately when idle. While solving, replace the pending input
  // instead of queueing every event or waiting for the drag to stop.
  if (!busy) void recompute(false, pendingSince);
}
function visualizers() {
  const enabled = $<HTMLInputElement>('#visualizers').checked;
  renderVisualizers(baseEl, baseline, current?.paragraphs ?? [], enabled, settings);
  renderVisualizers(optEl, current?.paragraphs ?? [], baseline, enabled, settings);
}
/** Runs just after the browser produces the next frame: a task queued from
 *  inside requestAnimationFrame runs once that frame's rendering is done. */
function afterNextPaint(callback: () => void) {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => callback();
    channel.port2.postMessage(null);
  });
}
function renderResult(response: ComposeResponse) {
  const renderStart = performance.now();
  const result = response.result!, width = lastWidth;
  // Controls may already contain the next input while this solve is finishing.
  // Render and report the settings that actually produced these lines.
  const { paragraphs, direction, settings } = activeRequest!;
  // Reserve the native height of each paragraph (in line-height units) so the
  // composed block cannot change the document height: this is what removes the
  // layout shift when a paragraph gains or loses a line.
  renderOptimized(optEl, result.paragraphs, paragraphs, baseline, {
    direction, inspection, onInspect: inspect, letterSpacing: settings.letterSpacing,
    highlightMoves: $<HTMLInputElement>('#changes').checked,
    reservePixels: RESERVE_NATIVE_HEIGHT ? nativeHeights : undefined,
    reserveHeight: RESERVE_NATIVE_HEIGHT ? nativeColumnHeight : undefined,
  });
  renderBaselineGuides(baseEl, baseline, settings.fontSize);
  optEl.classList.toggle('is-recomposing', pending);
  visualizers();
  const actual = { ...settings, width };
  const before = metrics(baseline, actual), after = metrics(result.paragraphs, actual);
  const delta = before.cost ? (before.cost - after.cost) / before.cost * 100 : 0;
  $('#rag-stat').innerHTML = `<span>${(before.deviation * 100).toFixed(1)}%</span> <b>→</b> ${(after.deviation * 100).toFixed(1)}%`;
  $('#ending-stat').innerHTML = `<span>${before.shortEndings}</span> <b>→</b> ${after.shortEndings}`;
  $('#tracking-stat').textContent = `±${after.maxTracking.toFixed(4)} em`;
  $('#baseline-lines').textContent = `${before.lines} lines`; $('#optimized-lines').textContent = `${after.lines} lines`;
  $('#status').classList.toggle('is-busy', pending); $('#status').classList.toggle('has-error', after.overflow);
  $('#status-message').textContent = pending ? 'Recomposing…' : after.overflow ? 'An unbreakable word exceeds the measure. Widen the column or reduce the type size.'
    : `Composition settled${delta > .1 ? ` · ${delta.toFixed(0)}% lower model cost` : ' · a different balance'}`;
  $('#performance').textContent = `${Math.round(response.elapsed)} ms worker · ${result.explored.toLocaleString()} paths`;
  $('#performance-details').innerHTML = `<div><dt>Worker compute (including its fonts)</dt><dd>${response.elapsed.toFixed(1)} ms</dd></div><div><dt>New Canvas measurements</dt><dd>${response.measurements.toLocaleString()}</dd></div><div><dt>Paths scored / retained candidates</dt><dd>${result.explored.toLocaleString()} / ${result.candidates}</dd></div><div><dt>Weighted model cost</dt><dd>${before.cost.toFixed(2)} → ${after.cost.toFixed(2)}</dd></div><div><dt>Actual measure / viewport</dt><dd>${Math.round(width)} / ${innerWidth} px</dd></div><div><dt>Search mode</dt><dd>${settings.sync === 0 ? 'Independent (no joint enumeration)' : paragraphs.length <= 3 ? 'Joint candidate enumeration' : '128-state document beam'}</dd></div>`;
  $('#export').removeAttribute('disabled');
  const data = { result, baseline, settings: actual, elapsed: response.elapsed,
    roundTrip: performance.now() - run.started, measurements: response.measurements, before, after };
  Object.assign(window, { __composition: data });
  const context = { ...run }, resolve = completion;
  const id = response.id;
  afterNextPaint(() => {
    if (id !== requestId) { resolve?.(undefined); return; }
    const totalMs = performance.now() - context.started;
    const fontMs = context.mainFontMs + response.fontMs;
    const renderMs = performance.now() - renderStart;
    const timing: RunTiming = { totalMs, fontMs, nativeMs: context.nativeMs, measureMs: response.measureMs,
      searchMs: response.searchMs, renderMs, otherMs: Math.max(0, totalMs - fontMs - context.nativeMs - response.measureMs - response.searchMs - renderMs),
      queueMs: context.started - context.scheduled, mode: context.mode, measurements: response.measurements,
      engine: response.engine ?? 'js', helpers: response.helpers ?? 0 };
    publishTiming(timing);
    Object.assign(data, { timing });
    resolve?.(timing);
    if (completion === resolve) completion = undefined;
  });
}
function inspect(p: number, l: number) {
  if (!inspection || !current) return;
  const line = current.paragraphs[p]?.lines[l]; if (!line) return;
  optEl.querySelectorAll('.inspected').forEach(el => el.classList.remove('inspected'));
  optEl.querySelector(`[data-paragraph="${p}"][data-line="${l}"]`)?.classList.add('inspected');
  $('#line-inspector').innerHTML = `<span class="inspector-label">¶ ${p + 1} / LINE ${l + 1}</span><span>${Math.round(line.width)} px <i>of ${Math.round(lastWidth)}</i></span><span>${(line.fill * 100).toFixed(1)}% fill</span><strong>${line.tracking >= 0 ? '+' : ''}${line.tracking.toFixed(4)} em</strong>${line.wordSpacing ? `<span>words ${line.wordSpacing >= 0 ? '+' : '−'}${Math.abs(line.wordSpacing).toFixed(3)} em</span>` : ''}${line.kashida ? `<span>${line.kashida} ${line.kashida === 1 ? 'tatweel' : 'tatweels'}</span>` : ''}${line.stretch !== 100 ? `<span>width ${line.stretch}%</span>` : ''}`;
}
const controls: Record<string, { key: keyof Settings; factor: number; unit: string }> = {
  'font-size': { key: 'fontSize', factor: 1, unit: ' px' }, 'letter-spacing': { key: 'letterSpacing', factor: 1, unit: ' em' }, measure: { key: 'width', factor: 1, unit: ' px' },
  'tracking-min': { key: 'trackingMin', factor: 1, unit: ' em' }, 'tracking-max': { key: 'trackingMax', factor: 1, unit: ' em' },
  rag: { key: 'rag', factor: .01, unit: '%' },
  'word-spacing-min': { key: 'wordSpacingMin', factor: -.01, unit: '%' }, 'word-spacing-max': { key: 'wordSpacingMax', factor: .01, unit: '%' },
  kashida: { key: 'kashida', factor: 1, unit: '' },
  'width-flex': { key: 'widthFlex', factor: .01, unit: '%' },
  firmness: { key: 'firmness', factor: .01, unit: '%' }, sync: { key: 'sync', factor: .01, unit: '%' }, ending: { key: 'minEnding', factor: .01, unit: '%' },
};
function formatControl(id: string, value: number, unit: string) {
  if (id.startsWith('word-spacing-')) return `${id.endsWith('min') ? '−' : '+'}${Math.abs(value)}${unit}`;
  return id.startsWith('tracking-') || id === 'letter-spacing' ? `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}${unit}` : `${value}${unit}`;
}
/** Shade each two-handle range between its handles. */
function updateTrackingRange() {
  const shade = (id: string, low: number, high: number, min: number, max: number) => {
    $(`#${id}`).style.setProperty('--tracking-start', `${(min - low) / (high - low) * 100}%`);
    $(`#${id}`).style.setProperty('--tracking-end', `${(max - low) / (high - low) * 100}%`);
  };
  shade('tracking-sliders', -0.08, 0.08, settings.trackingMin, settings.trackingMax);
}
for (const [id, control] of Object.entries(controls)) {
  $<HTMLInputElement>(`#${id}`).addEventListener('input', event => {
    const n = Number((event.target as HTMLInputElement).value);
    Object.assign(settings, { [control.key]: n * control.factor });
    $(`#${id}-value`).textContent = formatControl(id, n, control.unit);
    if (id.startsWith('tracking-')) updateTrackingRange();
    if (id === 'sync') updateHarmonyNote();
    // Tracking, rag, firmness, harmony and ending weights re-rank the same text;
    // type size and base letter-spacing change the paragraph geometry.
    schedule(id === 'font-size' || id === 'letter-spacing');
  });
}
$('#typeface').addEventListener('change', e => { typeface = (e.target as HTMLSelectElement).value as Typeface; updateWidthUI(); schedule(); });
$('#direction').addEventListener('change', e => { direction = (e.target as HTMLSelectElement).value as DirectionPolicy; schedule(); });
function chooseLanguage(text: string) {
  const lang = detectLanguage(text);
  $<HTMLSelectElement>('#language').value = lang;
  typeface = lang === 'ja' ? 'japanese' : lang === 'ar' ? 'arabic' : 'serif';
  $<HTMLSelectElement>('#typeface').value = typeface;
}
$('#language').addEventListener('change', e => {
  const lang = (e.target as HTMLSelectElement).value;
  if (lang !== 'auto') {
    paragraphs = (lang === 'ja' ? samples.japanese : lang === 'ar' ? samples.arabic : samples.editorial).split('\n\n');
    chooseLanguage(paragraphs.join(' '));
  }
  schedule();
});
$('#protect').addEventListener('change', e => {
  settings.protectEndings = (e.target as HTMLInputElement).checked;
  $<HTMLInputElement>('#ending').disabled = !settings.protectEndings; schedule(false);
});
$('#visualizers').addEventListener('change', visualizers);
$('#justify-native').addEventListener('change', e => {
  baseEl.classList.toggle('justify-native', (e.target as HTMLInputElement).checked);
  // Same breaks, new geometry: re-read A and refresh its guides and stats.
  schedule(false);
});
$('#benchmark-run').addEventListener('click', () => { void benchmark(cold => recompute(cold)); });
for (const id of ['guides', 'changes', 'inspect']) $(`#${id}`).addEventListener('change', e => {
  const checked = (e.target as HTMLInputElement).checked; previews.classList.toggle(`show-${id}`, checked);
  if (id === 'changes' && current) {
    // Per-word spans are only built when highlighting is on, so re-paint from
    // the cached composition instead of paying for another search.
    renderOptimized(optEl, current.paragraphs, paragraphs, baseline, {
      direction, inspection, highlightMoves: checked, onInspect: inspect, letterSpacing: activeRequest?.settings.letterSpacing,
      reservePixels: RESERVE_NATIVE_HEIGHT ? nativeHeights : undefined,
      reserveHeight: RESERVE_NATIVE_HEIGHT ? nativeColumnHeight : undefined,
    });
    if (checked) optEl.querySelectorAll<HTMLElement>('.composed-line').forEach(el => { el.tabIndex = inspection ? 0 : -1; });
  }
  if (id === 'inspect') {
    inspection = checked; $('#line-inspector').hidden = !checked;
    optEl.querySelectorAll<HTMLElement>('.composed-line').forEach(el => { el.tabIndex = checked ? 0 : -1; });
    if (!checked) optEl.querySelectorAll('.inspected').forEach(el => el.classList.remove('inspected'));
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  previews.classList.toggle('focus-view', button.dataset.view === 'focus');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  schedule(false);
}));
function updateHarmonyNote() {
  $('#harmony-note').textContent = settings.sync === 0 ? 'Independent: each paragraph chooses its own lowest-cost layout.' : 'Joint selection. Shared contours and endings influence the choice; edge firmness takes precedence.';
}
/** Move every slider and its readout to the current settings. */
function syncControls() {
  updateHarmonyNote();
  for (const [id, control] of Object.entries(controls)) {
    const value = Number((Number(settings[control.key]) / control.factor).toFixed(4));
    $<HTMLInputElement>(`#${id}`).value = String(value); $(`#${id}-value`).textContent = formatControl(id, value, control.unit);
  }
  updateTrackingRange();
}
/** A flush edge from the tools the text can use: kashida and word spacing for
 *  Arabic, word spacing and tracking elsewhere. Width flex stays as it is.
 *  Harmony is off: with flush bodies it only matches last-line lengths, and
 *  pays for that with extra tracking. */
const justified = { rag: 0, firmness: 1, wordSpacingMin: -0.25, wordSpacingMax: 1, kashida: 4, trackingMin: -0.04, trackingMax: 0.04, sync: 0 } satisfies Partial<Settings>;
let beforeJustified: Partial<Settings> | undefined;
$('#justify').addEventListener('change', e => {
  if ((e.target as HTMLInputElement).checked) {
    beforeJustified = Object.fromEntries(Object.keys(justified).map(key => [key, settings[key as keyof Settings]]));
    Object.assign(settings, justified);
  } else if (beforeJustified) {
    Object.assign(settings, beforeJustified);
    beforeJustified = undefined;
  }
  syncControls();
  schedule(false);
});
$('#reset').addEventListener('click', () => {
  settings = { ...defaults }; direction = 'auto';
  $<HTMLSelectElement>('#direction').value = direction;
  chooseLanguage(paragraphs.join(' '));
  $('#harmony-note').textContent = 'Joint selection across all paragraphs. Set to zero for independent layouts.';
  $<HTMLInputElement>('#justify').checked = false; beforeJustified = undefined;
  $<HTMLInputElement>('#justify-native').checked = false; baseEl.classList.remove('justify-native');
  syncControls(); $<HTMLInputElement>('#protect').checked = true; $<HTMLInputElement>('#ending').disabled = false;
  for (const id of ['guides', 'changes', 'inspect', 'visualizers']) { $<HTMLInputElement>(`#${id}`).checked = false; previews.classList.remove(`show-${id}`); }
  inspection = false; $('#line-inspector').hidden = true; schedule(); toast('Composition settings reset. Your text is unchanged.');
});
const dialog = $<HTMLDialogElement>('#editor'), editor = $<HTMLTextAreaElement>('#text-editor');
function updateCount() {
  const text = editor.value.trim(), count = text ? text.split(/\n\s*\n/).length : 0;
  editor.dir = directionFor(text, direction); editor.lang = detectLanguage(text);
  $('#text-count').textContent = `${Array.from(text).length} characters · ${count} paragraphs · max ${MAX_CHARACTERS.toLocaleString()} characters / ${MAX_PARAGRAPHS} paragraphs`;
  $('#editor-error').textContent = '';
}
$('#edit-text').addEventListener('click', () => {
  editor.value = paragraphs.join('\n\n');
  $<HTMLSelectElement>('#sample').value = Object.entries(samples).find(([, text]) => text === editor.value)?.[0] ?? 'custom';
  updateCount(); dialog.showModal();
});
$('#sample').addEventListener('change', e => { const key = (e.target as HTMLSelectElement).value as keyof typeof samples; if (samples[key]) editor.value = samples[key]; updateCount(); });
editor.addEventListener('input', () => { $<HTMLSelectElement>('#sample').value = 'custom'; updateCount(); });
$('#apply-text').addEventListener('click', event => {
  const text = editor.value.trim(), next = text.split(/\n\s*\n/).map(normalizeText).filter(Boolean);
  if (!next.length || next.length > MAX_PARAGRAPHS || text.length > MAX_CHARACTERS) {
    event.preventDefault();
    $('#editor-error').textContent = `Please enter 1–${MAX_PARAGRAPHS} paragraphs, up to ${MAX_CHARACTERS.toLocaleString()} characters in total.`;
    return;
  }
  paragraphs = next; chooseLanguage(text); schedule();
});
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
function toast(text: string) { $('#toast').textContent = text; $('#toast').hidden = false; setTimeout(() => { $('#toast').hidden = true; }, 3500); }
/** Snapshot lines are plain text; tatweels stay unselectable there too. */
function snapshotKashida(text: string, count: number, escape: (text: string) => string) {
  const words = text.split(' ');
  const tatweels = placeKashida(words, count);
  return words.map((word, i) => tatweels[i] ? kashidaHtml(word, tatweels[i]) : escape(word)).join(' ');
}
$('#export').addEventListener('click', () => {
  if (!current) return;
  const escape = (text: string) => text.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<!doctype html><html lang="${detectLanguage(paragraphs.join(' '))}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unjustified composition</title><style>body{margin:2.5rem}article{width:${lastWidth / 16}rem;max-width:100%;font: ${settings.fontSize / 16}rem/1.55 sans-serif;text-align:start}p{margin:0 0 1.25em;line-height:0}p>span{display:inline-block;width:100%;white-space:pre;line-height:1.55}.kashida{user-select:none;-webkit-user-select:none}@media(max-width:${(lastWidth + 80) / 16}rem){p{line-height:1.55}p>span{display:inline;white-space:normal;letter-spacing:normal!important;word-spacing:normal!important}}</style><article>${current.paragraphs.map((p, i) => `<p dir="${directionFor(paragraphs[i], direction)}">${p.lines.map(l => `<span style="letter-spacing:${(hasArabic(paragraphs[i]) ? 0 : settings.letterSpacing ?? 0) + l.tracking}em;word-spacing:${l.wordSpacing}em${l.stretch !== 100 ? `;font-stretch:${l.stretch}%` : ''}">${l.kashida ? snapshotKashida(l.text, l.kashida, escape) : escape(l.text)}${wordsOf(paragraphs[i]).length > 1 && detectLanguage(paragraphs[i]) !== 'ja' ? ' ' : ''}</span>`).join('')}</p>`).join('')}</article><!-- Static snapshot with system-font fallback. Recompose for production. --></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = 'unjustified.html'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('HTML snapshot exported. System-font fallback can change geometry.');
});
let observedWidth = 0;
const observer = new ResizeObserver(() => {
  const width = baseEl.getBoundingClientRect().width;
  if (Math.abs(width - observedWidth) > .5) {
    observedWidth = width;
    // The input handler may already have scheduled or measured this same width.
    if (Math.abs(width - lastWidth) > .5) schedule(false);
  }
});
refreshCanvas(); observer.observe(baseEl);
bindInspection(optEl, inspect);
Object.assign(window, { __worker: workerState });
warmWorker();
schedule();
