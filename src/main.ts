import '@fontsource-variable/dm-sans';
import './style.css';
import appTemplate from './app.html?raw';
import { icon } from './icons';
import { samples } from './samples';
import { rangeMarkup } from './ui-template';
import { families, loadFonts, fontLanguages } from './fonts';
import type { Typeface } from './fonts';
import type { ComposeResponse, WorkerResponse } from './protocol';
import { metrics, wordsOf } from './optimizer';
import type { Composition, Layout, Settings } from './optimizer';
import { detectLanguage, directionFor, normalizeText, hasArabic } from './language';
import type { DirectionPolicy } from './language';
import { readNativeLayout } from './native-layout';
import { annotateParagraph, cssRem, renderOptimized, renderBaselineGuides } from './rendering';
import { renderVisualizers } from './visualizers';
import { benchmark, publishTiming } from './benchmark';
import type { RunTiming } from './benchmark';

const defaults = { width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012, rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true } satisfies Settings;
let settings: Settings = { ...defaults };
let paragraphs = samples.editorial.split('\n\n');
let typeface: Typeface = 'serif';
let direction: DirectionPolicy = 'auto';
let current: Composition | undefined;
let baseline: Layout[] = [];
let worker: Worker | undefined;
let workerReady: Promise<void> = Promise.resolve();
let busy = false;
let requestId = 0;
let timer: ReturnType<typeof setTimeout>;
let lastWidth = 0;
let inspection = false;
let completion: ((timing: RunTiming | undefined) => void) | undefined;
let run = { started: 0, scheduled: 0, mainFontMs: 0, nativeMs: 0, mode: 'cold' as 'cold' | 'warm' };

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

function updateScriptUI() {
  const allArabic = paragraphs.every(hasArabic);
  for (const id of ['tracking-min', 'tracking-max']) $<HTMLInputElement>(`#${id}`).disabled = allArabic;
  $('#tracking-note').textContent = paragraphs.some(hasArabic)
    ? 'Arabic paragraphs keep natural connected shaping: tracking is held at zero. Other paragraphs use these limits.'
    : 'Independent shrink and expansion limits. Set either handle to zero to disable that direction.';
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
}
function refreshCanvas() {
  updateScriptUI();
  previews.style.setProperty('--measure', cssRem(settings.width));
  previews.style.setProperty('--type-size', cssRem(settings.fontSize));
  previews.style.setProperty('--reading-font', families[typeface]);
  for (const parent of [baseEl, optEl]) {
    const fragment = document.createDocumentFragment();
    paragraphs.forEach(text => {
      const p = document.createElement('p'); p.textContent = normalizeText(text);
      annotateParagraph(p, text, direction); fragment.append(p);
    });
    parent.replaceChildren(fragment);
  }
}
function fail(message: string) {
  busy = false;
  $('#status').classList.remove('is-busy'); $('#status').classList.add('has-error');
  $('#status-message').textContent = `${message}. Browser wrapping is preserved.`;
  completion?.(undefined); completion = undefined;
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./composer.worker.ts', import.meta.url), { type: 'module' });
  let ready!: () => void;
  workerReady = new Promise(resolve => { ready = resolve; });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    if ('kind' in response) { ready(); return; }
    if (response.id !== requestId) return;
    busy = false;
    if (response.error || !response.result) { fail(`Could not compose: ${response.error ?? 'unknown error'}`); return; }
    current = response.result;
    renderResult(response);
  };
  worker.onerror = () => { ready(); worker?.terminate(); worker = undefined; fail('The composition worker could not start'); };
  return worker;
}
async function recompute(cold = false, scheduled = performance.now()): Promise<RunTiming | undefined> {
  clearTimeout(timer);
  completion?.(undefined); completion = undefined;
  const id = ++requestId;
  const started = performance.now();
  $('#status').classList.add('is-busy');
  $('#status-message').textContent = 'Preparing fonts and layout…';
  const mode = cold || !worker || busy ? 'cold' : 'warm';
  try {
    await loadFonts(typeface, paragraphs.join('\n'), document.fonts);
    await document.fonts.ready;
    if (id !== requestId) return;
    const mainFontMs = performance.now() - started;
    const width = Math.floor(baseEl.getBoundingClientRect().width * 100) / 100;
    if (!width) return;
    lastWidth = width;
    const nativeStart = performance.now();
    baseline = readNativeLayout(baseEl, width, settings);
    const nativeMs = performance.now() - nativeStart;
    run = { started, scheduled, mainFontMs, nativeMs, mode };
    const actual = { ...settings, width: Math.max(1, width - 1) };
    $('#measure-note').textContent = width < settings.width - 1
      ? `Fits this viewport: ${Math.round(width)} px (requested ${settings.width} px).`
      : `Actual measure: ${Math.round(width)} px. Resize to recompose.`;
    previews.querySelectorAll('.measure-rule span').forEach(el => { el.textContent = `${Math.round(width)} px`; });
    if (busy || cold) { worker?.terminate(); worker = undefined; }
    busy = true; current = undefined;
    $('#export').setAttribute('disabled', '');
    $('#status').classList.remove('has-error'); $('#status').classList.add('is-busy');
    $('#status-message').textContent = 'Considering the possibilities…';
    const activeWorker = ensureWorker();
    await workerReady;
    if (id !== requestId || activeWorker !== worker) return;
    const completed = new Promise<RunTiming | undefined>(resolve => { completion = resolve; });
    activeWorker.postMessage({ id, paragraphs, settings: actual, typeface, direction });
    return await completed;
  } catch (error) {
    if (id === requestId) fail(error instanceof Error ? error.message : String(error));
  }
}
function schedule(reset = true) {
  requestId++;
  completion?.(undefined); completion = undefined;
  current = undefined;
  $('#export').setAttribute('disabled', '');
  clearTimeout(timer);
  const scheduled = performance.now();
  if (reset) refreshCanvas();
  $('#status').classList.add('is-busy');
  $('#status-message').textContent = 'Preparing fonts and layout…';
  timer = setTimeout(() => { void recompute(false, scheduled); }, 100);
}
function visualizers() {
  const enabled = $<HTMLInputElement>('#visualizers').checked;
  renderVisualizers(baseEl, baseline, current?.paragraphs ?? [], enabled, settings);
  renderVisualizers(optEl, current?.paragraphs ?? [], baseline, enabled, settings);
}
function renderResult(response: ComposeResponse) {
  const renderStart = performance.now();
  const result = response.result!, width = lastWidth;
  renderOptimized(optEl, result.paragraphs, paragraphs, baseline, direction, inspection, inspect);
  renderBaselineGuides(baseEl, baseline, settings.fontSize);
  visualizers();
  const actual = { ...settings, width };
  const before = metrics(baseline, actual), after = metrics(result.paragraphs, actual);
  const delta = before.cost ? (before.cost - after.cost) / before.cost * 100 : 0;
  $('#rag-stat').innerHTML = `<span>${(before.deviation * 100).toFixed(1)}%</span> <b>→</b> ${(after.deviation * 100).toFixed(1)}%`;
  $('#ending-stat').innerHTML = `<span>${before.shortEndings}</span> <b>→</b> ${after.shortEndings}`;
  $('#tracking-stat').textContent = `±${after.maxTracking.toFixed(4)} em`;
  $('#baseline-lines').textContent = `${before.lines} lines`; $('#optimized-lines').textContent = `${after.lines} lines`;
  $('#status').classList.remove('is-busy'); $('#status').classList.toggle('has-error', after.overflow);
  $('#status-message').textContent = after.overflow ? 'An unbreakable word exceeds the measure. Widen the column or reduce the type size.'
    : `Composition settled${delta > .1 ? ` · ${delta.toFixed(0)}% lower model cost` : ' · a different balance'}`;
  $('#performance').textContent = `${Math.round(response.elapsed)} ms worker · ${result.explored.toLocaleString()} paths`;
  $('#performance-details').innerHTML = `<div><dt>Worker compute (including its fonts)</dt><dd>${response.elapsed.toFixed(1)} ms</dd></div><div><dt>New Canvas measurements</dt><dd>${response.measurements.toLocaleString()}</dd></div><div><dt>Paths scored / retained candidates</dt><dd>${result.explored.toLocaleString()} / ${result.candidates}</dd></div><div><dt>Weighted model cost</dt><dd>${before.cost.toFixed(2)} → ${after.cost.toFixed(2)}</dd></div><div><dt>Actual measure / viewport</dt><dd>${Math.round(width)} / ${innerWidth} px</dd></div><div><dt>Search mode</dt><dd>${settings.sync === 0 ? 'Independent (no joint enumeration)' : paragraphs.length <= 3 ? 'Joint candidate enumeration' : '128-state document beam'}</dd></div>`;
  $('#export').removeAttribute('disabled');
  const data = { result, baseline, settings: actual, elapsed: response.elapsed,
    roundTrip: performance.now() - run.started, measurements: response.measurements, before, after };
  Object.assign(window, { __composition: data });
  const context = { ...run }, resolve = completion;
  const id = response.id;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (id !== requestId) { resolve?.(undefined); return; }
    const totalMs = performance.now() - context.started;
    const fontMs = context.mainFontMs + response.fontMs;
    const renderMs = performance.now() - renderStart;
    const timing: RunTiming = { totalMs, fontMs, nativeMs: context.nativeMs, measureMs: response.measureMs,
      searchMs: response.searchMs, renderMs, otherMs: Math.max(0, totalMs - fontMs - context.nativeMs - response.measureMs - response.searchMs - renderMs),
      debounceMs: context.started - context.scheduled, mode: context.mode, measurements: response.measurements };
    publishTiming(timing);
    Object.assign(data, { timing });
    resolve?.(timing);
    if (completion === resolve) completion = undefined;
  }));
}
function inspect(p: number, l: number) {
  if (!inspection || !current) return;
  const line = current.paragraphs[p]?.lines[l]; if (!line) return;
  optEl.querySelectorAll('.inspected').forEach(el => el.classList.remove('inspected'));
  optEl.querySelector(`[data-paragraph="${p}"][data-line="${l}"]`)?.classList.add('inspected');
  $('#line-inspector').innerHTML = `<span class="inspector-label">¶ ${p + 1} / LINE ${l + 1}</span><span>${Math.round(line.width)} px <i>of ${Math.round(lastWidth)}</i></span><span>${(line.fill * 100).toFixed(1)}% fill</span><strong>${line.tracking >= 0 ? '+' : ''}${line.tracking.toFixed(4)} em</strong>`;
}
const controls: Record<string, { key: keyof Settings; factor: number; unit: string }> = {
  'font-size': { key: 'fontSize', factor: 1, unit: ' px' }, measure: { key: 'width', factor: 1, unit: ' px' },
  'tracking-min': { key: 'trackingMin', factor: 1, unit: ' em' }, 'tracking-max': { key: 'trackingMax', factor: 1, unit: ' em' },
  rag: { key: 'rag', factor: .01, unit: '%' }, sync: { key: 'sync', factor: .01, unit: '%' }, ending: { key: 'minEnding', factor: .01, unit: '%' },
};
function formatControl(id: string, value: number, unit: string) {
  return id.startsWith('tracking-') ? `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}${unit}` : `${value}${unit}`;
}
function updateTrackingRange() {
  $('.tracking-sliders').style.setProperty('--tracking-start', `${(settings.trackingMin + .04) / .08 * 100}%`);
  $('.tracking-sliders').style.setProperty('--tracking-end', `${(settings.trackingMax + .04) / .08 * 100}%`);
}
for (const [id, control] of Object.entries(controls)) {
  $<HTMLInputElement>(`#${id}`).addEventListener('input', event => {
    const n = Number((event.target as HTMLInputElement).value);
    Object.assign(settings, { [control.key]: n * control.factor });
    $(`#${id}-value`).textContent = formatControl(id, n, control.unit);
    if (id.startsWith('tracking-')) updateTrackingRange();
    if (id === 'sync') $('#harmony-note').textContent = n === 0 ? 'Independent: each paragraph chooses its own lowest-cost layout.' : 'Joint selection. Shared contours and endings influence the choice.';
    schedule();
  });
}
$('#typeface').addEventListener('change', e => { typeface = (e.target as HTMLSelectElement).value as Typeface; schedule(); });
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
  $<HTMLInputElement>('#ending').disabled = !settings.protectEndings; schedule();
});
$('#visualizers').addEventListener('change', visualizers);
$('#benchmark-run').addEventListener('click', () => { void benchmark(cold => recompute(cold)); });
for (const id of ['guides', 'changes', 'inspect']) $(`#${id}`).addEventListener('change', e => {
  const checked = (e.target as HTMLInputElement).checked; previews.classList.toggle(`show-${id}`, checked);
  if (id === 'inspect') {
    inspection = checked; $('#line-inspector').hidden = !checked;
    optEl.querySelectorAll<HTMLElement>('.composed-line').forEach(el => { el.tabIndex = checked ? 0 : -1; });
    if (!checked) optEl.querySelectorAll('.inspected').forEach(el => el.classList.remove('inspected'));
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  previews.classList.toggle('focus-view', button.dataset.view === 'focus');
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  schedule();
}));
$('#reset').addEventListener('click', () => {
  settings = { ...defaults }; direction = 'auto';
  $<HTMLSelectElement>('#direction').value = direction;
  chooseLanguage(paragraphs.join(' '));
  $('#harmony-note').textContent = 'Joint selection across all paragraphs. Set to zero for independent layouts.';
  for (const [id, control] of Object.entries(controls)) {
    const value = Number((Number(settings[control.key]) / control.factor).toFixed(4));
    $<HTMLInputElement>(`#${id}`).value = String(value); $(`#${id}-value`).textContent = formatControl(id, value, control.unit);
  }
  updateTrackingRange(); $<HTMLInputElement>('#protect').checked = true; $<HTMLInputElement>('#ending').disabled = false;
  for (const id of ['guides', 'changes', 'inspect', 'visualizers']) { $<HTMLInputElement>(`#${id}`).checked = false; previews.classList.remove(`show-${id}`); }
  inspection = false; $('#line-inspector').hidden = true; schedule(); toast('Composition settings reset. Your text is unchanged.');
});
const dialog = $<HTMLDialogElement>('#editor'), editor = $<HTMLTextAreaElement>('#text-editor');
function updateCount() {
  const text = editor.value.trim(), count = text ? text.split(/\n\s*\n/).length : 0;
  editor.dir = directionFor(text, direction); editor.lang = detectLanguage(text);
  $('#text-count').textContent = `${Array.from(text).length} characters · ${count} paragraphs · max 6,000 characters / 8 paragraphs`;
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
  if (!next.length || next.length > 8 || text.length > 6000) { event.preventDefault(); $('#editor-error').textContent = 'Please enter 1–8 paragraphs, up to 6,000 characters in total.'; return; }
  paragraphs = next; chooseLanguage(text); schedule();
});
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
function toast(text: string) { $('#toast').textContent = text; $('#toast').hidden = false; setTimeout(() => { $('#toast').hidden = true; }, 3500); }
$('#export').addEventListener('click', () => {
  if (!current) return;
  const escape = (text: string) => text.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<!doctype html><html lang="${detectLanguage(paragraphs.join(' '))}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unjustified composition</title><style>body{margin:2.5rem}article{width:${lastWidth / 16}rem;max-width:100%;font: ${settings.fontSize / 16}rem/1.55 sans-serif;text-align:start}p{margin:0 0 1.25em;line-height:0}span{display:inline-block;width:100%;white-space:pre;line-height:1.55}@media(max-width:${(lastWidth + 80) / 16}rem){p{line-height:1.55}span{display:inline;white-space:normal;letter-spacing:normal!important}}</style><article>${current.paragraphs.map((p, i) => `<p dir="${directionFor(paragraphs[i], direction)}">${p.lines.map(l => `<span style="letter-spacing:${l.tracking}em">${escape(l.text)}${wordsOf(paragraphs[i]).length > 1 && detectLanguage(paragraphs[i]) !== 'ja' ? ' ' : ''}</span>`).join('')}</p>`).join('')}</article><!-- Static snapshot with system-font fallback. Recompose for production. --></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a'); a.href = url; a.download = 'unjustified.html'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('HTML snapshot exported. System-font fallback can change geometry.');
});
let observedWidth = 0;
const observer = new ResizeObserver(() => { const width = baseEl.getBoundingClientRect().width; if (Math.abs(width - observedWidth) > .5) { observedWidth = width; schedule(false); } });
refreshCanvas(); observer.observe(baseEl); schedule();
