// Round 2 shared state, controls, scrub behaviour and canvas. CSS stands in for the
// composer: column B uses text-wrap: pretty, and the metrics are measured from the DOM.
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/roboto-flex';

export const TEXT = `Typography is the quiet architecture of a page. Before we read a single word, we notice its shape: the texture of a paragraph, the space around a thought, the gentle rhythm of one line giving way to the next.

A straight right edge is not the only way to find balance. Left to their own devices, words can leave awkward gaps and lonely endings. A little consideration lets them settle into something more deliberate, without losing their natural character.

The best adjustments are often the ones we never notice. A word moves up, another moves down, and the smallest change in spacing makes room for a better ending. Not perfectly aligned. Just a little more at ease.`;

const FONTS = {
  'Source Serif 4': "'Source Serif 4 Variable', Georgia, serif",
  Inter: 'InterVariable, sans-serif',
  'DM Sans': "'DM Sans Variable', sans-serif",
  'Roboto Flex': "'Roboto Flex Variable', sans-serif",
};

const range = (k, label, min, max, step, value, unit = '', short = label) => ({ k, label, short, type: 'range', min, max, step, value, unit });
const toggle = (k, label, value = false, short = label) => ({ k, label, short, type: 'toggle', value });
const select = (k, label, options, short = label) => ({ k, label, short, type: 'select', options, value: options[0] });

export const GROUPS = [
  { id: 'text', label: 'Text', controls: [
    select('sample', 'Sample', ['Editorial', 'Literature', 'Arabic', 'Japanese', 'Mixed'], 'text'),
    select('direction', 'Direction', ['Auto', 'LTR', 'RTL'], 'dir'),
  ] },
  { id: 'type', label: 'Type', controls: [
    select('typeface', 'Typeface', Object.keys(FONTS), 'face'),
    range('size', 'Size', 14, 26, 1, 19, 'px', 'size'),
    range('ls', 'Letter spacing', -0.05, 0.1, 0.005, 0, 'em', 'track'),
    range('measure', 'Width', 240, 620, 2, 390, 'px', 'width'),
  ] },
  { id: 'edge', label: 'Edge', controls: [
    range('rag', 'Rag', 0, 18, 0.5, 5.5, '%', 'rag'),
    range('firmness', 'Firmness', 0, 100, 5, 0, '%', 'firm'),
    range('sync', 'Harmony', 0, 100, 5, 65, '%', 'harmony'),
    range('ending', 'Last line', 15, 60, 1, 32, '%', 'ending'),
    toggle('protect', 'Protect short endings', true, 'protect'),
    toggle('justify', 'Nearly justified', false, 'flush'),
  ] },
  { id: 'space', label: 'Spacing', controls: [
    range('trackMin', 'Tracking −', -0.03, 0, 0.001, -0.012, 'em', 'trk−'),
    range('trackMax', 'Tracking +', 0, 0.03, 0.001, 0.012, 'em', 'trk+'),
    range('shrink', 'Space shrink', 0, 50, 5, 0, '%', 'shrink'),
    range('stretch', 'Space stretch', 0, 1000, 10, 0, '%', 'stretch'),
    range('widthFlex', 'Width flex', 0, 40, 1, 0, '%', 'flex'),
    range('kashida', 'Kashida', 0, 4, 1, 0, '', 'kash'),
  ] },
  { id: 'hyph', label: 'Hyphens', controls: [
    toggle('hyphenate', 'Hyphenate', false, 'hyph'),
    select('hyLang', 'Language', ['English US', 'English UK', 'Español', 'Deutsch', 'Français'], 'lang'),
    range('hyFreq', 'Frequency', 0, 100, 5, 50, '%', 'freq'),
    range('hyMin', 'Shortest word', 4, 12, 1, 6, '', 'min'),
    range('hyBefore', 'Letters before', 1, 5, 1, 2, '', 'pre'),
    range('hyAfter', 'Letters after', 2, 6, 1, 3, '', 'post'),
  ] },
  { id: 'show', label: 'Show', controls: [
    toggle('diag', 'Rag zone', false, 'zone'),
    toggle('guides', 'Line guides', false, 'guides'),
    toggle('moved', 'Moved words', false, 'moved'),
    toggle('inspect', 'Inspect lines', false, 'inspect'),
    toggle('justifyA', 'Justify A', false, 'just A'),
  ] },
];

export const CONTROLS = Object.fromEntries(GROUPS.flatMap(g => g.controls).map(c => [c.k, c]));
export const GROUP_OF = Object.fromEntries(GROUPS.flatMap(g => g.controls.map(c => [c.k, g.id])));
export const state = Object.fromEntries(Object.values(CONTROLS).map(c => [c.k, c.value]));
const listeners = new Set();
export const onChange = fn => listeners.add(fn);

export function format(k, v = state[k]) {
  const c = CONTROLS[k];
  if (c.type === 'toggle') return v ? 'on' : 'off';
  if (c.type === 'select') return v;
  const digits = (String(c.step).split('.')[1] ?? '').length;
  const n = Number(v).toFixed(digits);
  return (c.unit === 'em' && v > 0 ? '+' : '') + n + (c.unit ? (c.unit === '%' ? '%' : ' ' + c.unit) : '');
}
const progress = k => {
  const c = CONTROLS[k];
  if (c.type === 'range') return (state[k] - c.min) / (c.max - c.min);
  if (c.type === 'toggle') return state[k] ? 1 : 0;
  return 0;
};

export function set(k, v) {
  const c = CONTROLS[k];
  if (c.type === 'range') v = +Math.min(c.max, Math.max(c.min, Math.round(Number(v) / c.step) * c.step)).toFixed(6);
  if (state[k] === v) return;
  state[k] = v;
  paint(k);
  apply();
  listeners.forEach(fn => fn(k, v));
}

function paint(k) {
  for (const el of document.querySelectorAll(`[data-k="${k}"]`)) {
    if (el.type === 'checkbox') el.checked = state[k]; else if (el.value !== String(state[k])) el.value = state[k];
  }
  for (const el of document.querySelectorAll(`[data-v="${k}"]`)) el.textContent = format(k);
  for (const el of document.querySelectorAll(`[data-scrub="${k}"]`)) {
    el.style.setProperty('--p', progress(k));
    if (CONTROLS[k].type === 'toggle') el.setAttribute('aria-pressed', state[k]);
    if (CONTROLS[k].type === 'range') el.setAttribute('aria-valuenow', state[k]);
  }
}
export const paintAll = () => Object.keys(CONTROLS).forEach(paint);

const root = document.documentElement;
function apply() {
  root.style.setProperty('--size', state.size + 'px');
  root.style.setProperty('--ls', state.ls + 'em');
  root.style.setProperty('--measure', state.measure + 'px');
  root.style.setProperty('--font', FONTS[state.typeface]);
  root.style.setProperty('--hyphens', state.hyphenate ? 'auto' : 'manual');
  root.style.setProperty('--rag', state.rag);
  root.classList.toggle('justify-b', state.justify);
  root.classList.toggle('justify-a', state.justifyA);
  root.classList.toggle('guides', state.guides);
  root.classList.toggle('diag', state.diag);
  scheduleMetrics();
}

/* ---------------------------------------------------------------------------
   Markup. tok = inline scrub value; cell = ruled rectangle around one.
   --------------------------------------------------------------------------- */
const inner = (c, label) => `${label ? `<i>${c.short}</i>` : ''}<output data-v="${c.k}">${format(c.k)}</output>${c.type === 'select' ? '<span class="arrow">↓</span>' : ''}`;
const nativeSelect = c => `<select data-k="${c.k}" aria-label="${c.label}">${c.options.map(o => `<option${o === state[c.k] ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
const aria = c => c.type === 'range'
  ? `role="slider" aria-label="${c.label}" aria-valuemin="${c.min}" aria-valuemax="${c.max}" aria-valuenow="${state[c.k]}"`
  : c.type === 'toggle' ? `role="button" aria-label="${c.label}" aria-pressed="${state[c.k]}"` : '';

export function tokHTML(c, { label = true, scrub = true, native = true } = {}) {
  // Without scrub the tok only draws, and inherits --p from the cell around it.
  const attrs = scrub ? `data-scrub="${c.k}" ${c.type === 'select' ? '' : 'tabindex="0"'} ${aria(c)} style="--p:${progress(c.k)}"` : '';
  return `<span class="tok" data-type="${c.type}" ${attrs}><span class="t">${inner(c, label)}</span><span class="ink" aria-hidden="true">${inner(c, label)}</span>${c.type === 'select' && native ? nativeSelect(c) : ''}</span>`;
}

export function cellHTML(c) {
  const body = c.type === 'toggle' ? '<span class="box"></span>' : `<span class="val">${tokHTML(c, { label: false, scrub: false, native: false })}</span>`;
  return `<div class="cell" data-scrub="${c.k}" data-type="${c.type}" ${c.type === 'select' ? '' : 'tabindex="0"'} ${aria(c)} style="--p:${progress(c.k)}"><span class="lbl">${c.label}</span>${body}${c.type === 'select' ? nativeSelect(c) : ''}</div>`;
}

/* ---------------------------------------------------------------------------
   Scrub: drag sideways on any [data-scrub] range. The whole range spans
   SCRUB_TRAVEL px. Toggles flip on click. Arrow keys step; shift steps by 10.
   --------------------------------------------------------------------------- */
const SCRUB_TRAVEL = 320;
export function nudge(k, dir) {
  const c = CONTROLS[k];
  if (c.type === 'range') set(k, state[k] + dir * c.step);
  else if (c.type === 'toggle') set(k, !state[k]);
}
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-scrub]');
  if (!el || e.button > 0) return;
  const c = CONTROLS[el.dataset.scrub];
  if (c.type !== 'range') return;
  const x0 = e.clientX, y0 = e.clientY, v0 = state[c.k];
  let dragging = false;
  const move = m => {
    const dx = m.clientX - x0;
    if (!dragging) {
      // Touch: a mostly vertical gesture is a scroll, not a scrub.
      if (Math.abs(dx) < 4 || Math.abs(m.clientY - y0) > Math.abs(dx)) return;
      dragging = true;
      try { el.setPointerCapture(m.pointerId); } catch {}
      el.classList.add('drag');
    }
    set(c.k, v0 + dx / SCRUB_TRAVEL * (c.max - c.min));
  };
  const up = () => {
    el.classList.remove('drag');
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-scrub]');
  if (el && CONTROLS[el.dataset.scrub].type === 'toggle') nudge(el.dataset.scrub, 1);
});
document.addEventListener('keydown', e => {
  const el = e.target.closest?.('[data-scrub]');
  if (!el) return;
  const c = CONTROLS[el.dataset.scrub];
  const dir = c.type === 'range'
    ? { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    : { Enter: 1, ' ': 1 }[e.key];
  if (!dir) return;
  e.preventDefault();
  nudge(c.k, dir * (e.shiftKey && c.type === 'range' ? 10 : 1));
});
document.addEventListener('input', e => {
  const k = e.target.dataset?.k;
  if (k) set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
});

/* ---------------------------------------------------------------------------
   View, canvas, edit, width handle.
   --------------------------------------------------------------------------- */
export function setView(v) {
  root.dataset.view = v;
  for (const el of document.querySelectorAll('[data-view-set]')) el.setAttribute('aria-pressed', el.dataset.viewSet === v);
  scheduleMetrics();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-view-set]');
  if (b) setView(b.dataset.viewSet);
});

const metricsHTML = col => `<span class="m num"><span data-m="${col}.lines">–</span> ln · Σ <span data-m="${col}.dev">–</span> · short <span data-m="${col}.short">–</span></span>`;
export const pairHTML = () => `<div class="pair">${[['a', 'A — Browser'], ['b', 'B — Unjustified']].map(([col, name]) =>
  `<section class="col" data-col="${col}"><div class="col-head"><span>${name}</span>${metricsHTML(col)}</div><div class="frame"><div class="text" data-col="${col}"></div><div class="handle" title="Width"><span>↔</span></div></div></section>`).join('')}</div>`;

function fillText() {
  const html = TEXT.split('\n\n').map(p => `<p>${p}</p>`).join('');
  for (const el of document.querySelectorAll('.text')) { el.innerHTML = html; el.lang = 'en'; }
}

// Edit text: both columns become editable and mirror each other.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-edit]');
  if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on);
  document.querySelectorAll('.text').forEach(t => t.contentEditable = on);
  if (on) document.querySelector('.text[data-col="b"]')?.focus();
});
document.addEventListener('input', e => {
  const t = e.target.closest?.('.text');
  if (!t) return;
  document.querySelectorAll('.text').forEach(o => { if (o !== t) o.innerHTML = t.innerHTML; });
  scheduleMetrics();
});

document.addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle');
  if (!h) return;
  const x0 = e.clientX, w0 = state.measure;
  h.setPointerCapture(e.pointerId);
  const move = m => set('measure', w0 + (m.clientX - x0));
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', () => h.removeEventListener('pointermove', move), { once: true });
});

/* ---------------------------------------------------------------------------
   Metrics from the DOM: Σ of body-line widths, and last lines under the minimum.
   --------------------------------------------------------------------------- */
function measure(el) {
  const widths = [], lasts = [];
  for (const p of el.querySelectorAll('p')) {
    const r = document.createRange();
    r.selectNodeContents(p);
    const lines = new Map();
    for (const rect of r.getClientRects()) {
      if (!rect.width) continue;
      const top = Math.round(rect.top / 4);
      const l = lines.get(top) ?? { left: Infinity, right: -Infinity };
      l.left = Math.min(l.left, rect.left); l.right = Math.max(l.right, rect.right);
      lines.set(top, l);
    }
    const w = [...lines.values()].map(l => l.right - l.left);
    if (w.length) lasts.push(w.pop());
    widths.push(...w);
  }
  const full = el.clientWidth || 1;
  const mean = widths.reduce((a, b) => a + b, 0) / (widths.length || 1);
  const dev = Math.sqrt(widths.reduce((a, b) => a + (b - mean) ** 2, 0) / (widths.length || 1)) / full * 100;
  const short = lasts.filter(w => w < full * state.ending / 100).length;
  return { lines: String(widths.length + lasts.length), dev: dev.toFixed(1) + '%', short: String(short) };
}
let pending = false;
function scheduleMetrics() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    for (const col of ['a', 'b']) {
      const el = document.querySelector(`.text[data-col="${col}"]`);
      if (!el || !el.offsetParent) continue;
      for (const [key, val] of Object.entries(measure(el))) for (const out of document.querySelectorAll(`[data-m="${col}.${key}"]`)) out.textContent = val;
    }
  });
}

export const isNarrow = () => matchMedia('(max-width: 56em)').matches;
export function start(view = 'ab') {
  // On a phone, start narrow enough that one column fits and the next one peeks in.
  // Page margins are 20px each at this size; 32px more leaves the peek.
  const fit = Math.floor((innerWidth - 72) / 2) * 2;
  if (innerWidth < 640 && fit < state.measure) state.measure = fit;
  fillText();
  setView(view);
  apply();
  paintAll();
  document.fonts.ready.then(scheduleMetrics);
  new ResizeObserver(scheduleMetrics).observe(document.body);
}
