// Shared state, controls and text for the lab prototypes. CSS stands in for the composer:
// column B uses text-wrap: pretty, and the metrics are measured from the DOM.
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
    select('sample', 'Sample', ['Editorial', 'Literature', 'Arabic', 'Japanese', 'Mixed']),
    select('direction', 'Direction', ['Auto', 'LTR', 'RTL'], 'Dir'),
  ] },
  { id: 'type', label: 'Type', controls: [
    select('typeface', 'Typeface', Object.keys(FONTS), 'Face'),
    range('size', 'Size', 14, 26, 1, 19, 'px'),
    range('ls', 'Letter spacing', -0.05, 0.1, 0.005, 0, 'em', 'Track'),
    range('measure', 'Width', 240, 620, 2, 390, 'px'),
  ] },
  { id: 'edge', label: 'Edge', controls: [
    range('rag', 'Rag', 0, 18, 0.5, 5.5, '%'),
    range('firmness', 'Firmness', 0, 100, 5, 0, '%', 'Firm'),
    range('sync', 'Harmony', 0, 100, 5, 65, '%'),
    range('ending', 'Last line', 15, 60, 1, 32, '%', 'Ending'),
    toggle('protect', 'Protect short endings', true, 'Protect'),
    toggle('justify', 'Nearly justified', false, 'Flush'),
  ] },
  { id: 'space', label: 'Spacing', controls: [
    range('trackMin', 'Tracking −', -0.03, 0, 0.001, -0.012, 'em', 'Trk−'),
    range('trackMax', 'Tracking +', 0, 0.03, 0.001, 0.012, 'em', 'Trk+'),
    range('shrink', 'Space shrink', 0, 50, 5, 0, '%', 'Shrink'),
    range('stretch', 'Space stretch', 0, 1000, 10, 0, '%', 'Stretch'),
    range('widthFlex', 'Width flex', 0, 40, 1, 0, '%', 'Flex'),
    range('kashida', 'Kashida', 0, 4, 1, 0, '', 'Kash'),
  ] },
  { id: 'hyph', label: 'Hyphens', controls: [
    toggle('hyphenate', 'Hyphenate', false, 'Hyph'),
    select('hyLang', 'Language', ['English US', 'English UK', 'Español', 'Deutsch', 'Français'], 'Lang'),
    range('hyFreq', 'Frequency', 0, 100, 5, 50, '%', 'Freq'),
    range('hyMin', 'Shortest word', 4, 12, 1, 6, '', 'Min'),
    range('hyBefore', 'Letters before', 1, 5, 1, 2, '', 'Pre'),
    range('hyAfter', 'Letters after', 2, 6, 1, 3, '', 'Post'),
  ] },
  { id: 'show', label: 'Show', controls: [
    toggle('diag', 'Rag zone', false, 'Zone'),
    toggle('guides', 'Line guides', false, 'Guides'),
    toggle('moved', 'Moved words', false, 'Moved'),
    toggle('inspect', 'Inspect lines', false, 'Inspect'),
    toggle('justifyA', 'Justify A', false, 'Just A'),
  ] },
];

export const CONTROLS = Object.fromEntries(GROUPS.flatMap(g => g.controls).map(c => [c.k, c]));
export const state = Object.fromEntries(Object.values(CONTROLS).map(c => [c.k, c.value]));
const listeners = new Set();
export const onChange = fn => listeners.add(fn);

export function format(k, v = state[k]) {
  const c = CONTROLS[k];
  if (c.type === 'toggle') return v ? 'On' : 'Off';
  if (c.type === 'select') return v;
  const digits = (String(c.step).split('.')[1] ?? '').length;
  const n = Number(v).toFixed(digits);
  return (c.unit === 'em' && v > 0 ? '+' : '') + n + (c.unit ? (c.unit === '%' ? '%' : ' ' + c.unit) : '');
}

export function set(k, v) {
  const c = CONTROLS[k];
  if (c.type === 'range') v = Math.min(c.max, Math.max(c.min, Math.round(Number(v) / c.step) * c.step));
  state[k] = v;
  for (const el of document.querySelectorAll(`[data-k="${k}"]`)) {
    if (el.type === 'checkbox') el.checked = v; else if (el.value !== String(v)) el.value = v;
  }
  for (const el of document.querySelectorAll(`[data-v="${k}"]`)) el.textContent = format(k, v);
  apply();
  listeners.forEach(fn => fn(k, v));
}

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

// Inputs only need data-k; this wires every prototype the same way.
export function inputHTML(c, extra = '') {
  if (c.type === 'range') return `<input type="range" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}" aria-label="${c.label}" ${extra}>`;
  if (c.type === 'toggle') return `<input type="checkbox" data-k="${c.k}" ${c.value ? 'checked' : ''} aria-label="${c.label}" ${extra}>`;
  return `<span class="sel"><select data-k="${c.k}" aria-label="${c.label}" ${extra}>${c.options.map(o => `<option>${o}</option>`).join('')}</select></span>`;
}
export const valueHTML = (c, cls = '') => `<output class="num ${cls}" data-v="${c.k}">${format(c.k)}</output>`;

document.addEventListener('input', e => {
  const k = e.target.dataset?.k;
  if (k) set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
});

// View: which column(s) show. a | b | ab
export function setView(v) {
  root.dataset.view = v;
  for (const el of document.querySelectorAll('[data-view-set]')) el.setAttribute('aria-pressed', el.dataset.viewSet === v);
  scheduleMetrics();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-view-set]');
  if (b) setView(b.dataset.viewSet);
});

export function fillText() {
  const html = TEXT.split('\n\n').map(p => `<p>${p}</p>`).join('');
  for (const el of document.querySelectorAll('.text')) { el.innerHTML = html; el.lang = 'en'; }
}

// Line widths from the DOM: deviation of body lines, and last lines shorter than the minimum.
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
    lasts.push(w.pop());
    widths.push(...w);
  }
  const full = el.clientWidth || 1;
  const mean = widths.reduce((a, b) => a + b, 0) / (widths.length || 1);
  const dev = Math.sqrt(widths.reduce((a, b) => a + (b - mean) ** 2, 0) / (widths.length || 1)) / full * 100;
  const short = lasts.filter(w => w < full * state.ending / 100).length;
  return { lines: widths.length + lasts.length, dev: dev.toFixed(1) + '%', short: String(short) };
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
      const m = measure(el);
      for (const [key, val] of Object.entries(m)) for (const out of document.querySelectorAll(`[data-m="${col}.${key}"]`)) out.textContent = val;
    }
  });
}

export function start(view = 'ab') {
  fillText();
  setView(view);
  apply();
  document.fonts.ready.then(scheduleMetrics);
  new ResizeObserver(scheduleMetrics).observe(document.body);
}
