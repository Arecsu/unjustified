// Round 3 shared state, panel and canvas. The unjustified column is the app's
// own composition (engine.js): the same worker, search, fonts and rendering as
// the home page.
import { benchmark, bindInspection, createComposer, families, fontLanguages, justified, metrics, normalizeText,
  paragraphSettings, publishTiming, readNativeLayout, renderOptimized, samples, widthRange } from './engine.js';

// The app's samples (src/samples.ts), by name.
const SAMPLES = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v]));
// The app's Latin typefaces. Arabic and Japanese text is set in its Noto face, as
// on the home page.
const FONTS = { 'Source Serif 4': 'serif', 'DM Sans': 'sans', Georgia: 'classic', 'Roboto Flex': 'roboto' };
const FACE = { arabic: 'Noto Sans Arabic', japanese: 'Noto Sans JP' };

const ARABIC = /\p{Script=Arabic}/u;
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
let paragraphs = SAMPLES.Editorial.split('\n\n');
const hasArabic = () => ARABIC.test(paragraphs.join(''));
const hasJapanese = () => JAPANESE.test(paragraphs.join(''));
// The typeface the engine sets: the one picked, unless the text needs a Noto face.
const typeface = () => {
  const picked = FONTS[state.typeface], lang = hasArabic() ? 'ar' : hasJapanese() ? 'ja' : 'en';
  return fontLanguages[picked].includes(lang) ? picked : lang === 'ar' ? 'arabic' : 'japanese';
};
// The hyphenation languages offered, as the engine names them.
const HY_LANG = { 'English US': 'en-us', 'English UK': 'en-gb', 'Español': 'es', 'Deutsch': 'de', 'Français': 'fr' };

/* ---------------------------------------------------------------------------
   Controls. adv: behind the group's "more". dep: dimmed while it has no effect.
   show: hidden while it doesn't apply. pair: one slider for two values while
   linked, keeping their ratio. of: one half of a pair. neg/plus: the sign shown.
   --------------------------------------------------------------------------- */
const range = (k, label, min, max, step, value, unit = '', o = {}) => ({ k, label, type: 'range', min, max, step, value, unit, ...o });
const toggle = (k, label, value = false, o = {}) => ({ k, label, type: 'toggle', value, ...o });
const select = (k, label, options, o = {}) => ({ k, label, type: 'select', options, value: options[0], ...o });
const note = (k, label, o = {}) => ({ k, label, type: 'note', ...o });

const adv = true;
const hyOn = () => state.hyphenate && !hasArabic() && !hasJapanese();
const kaOn = () => state.kashida && hasArabic();
// Nearly justified sets these itself (justified in src/optimizer.ts).
const free = () => !state.justify;

const GROUPS = [
  { id: 'text', label: 'Text', controls: [
    select('sample', 'Sample', Object.keys(SAMPLES)),
    select('direction', 'Direction', ['Auto', 'LTR', 'RTL'], { adv }),
  ] },
  { id: 'type', label: 'Type', controls: [
    select('typeface', 'Typeface', Object.keys(FONTS), { note: () => FACE[typeface()] ? `Set in ${FACE[typeface()]}, as ${state.typeface} has no ${hasArabic() ? 'Arabic' : 'Japanese'}.` : '' }),
    range('size', 'Size', 0.75, 4.5, 0.05, 1.2, 'rem'),
    range('measure', 'Width', 15, 150, 1, 40, 'ch', { auto: true }),
    // Indent in ch, or in % of the width; one row shows, per ui.unit.
    range('indent', 'Indent', 0, 80, 1, 0, 'ch', { units: true, show: () => ui.unit === 'ch' }),
    range('indentPct', 'Indent', 0, 90, 1, 0, '%', { units: true, show: () => ui.unit === '%' }),
    select('indentAt', 'Indented', ['Every paragraph', 'First only', 'All but first'], { adv, dep: () => (ui.unit === '%' ? state.indentPct : state.indent) > 0 }),
    range('lh', 'Line height', 0.9, 2, 0.05, 1.55, '', { adv }),
    range('ls', 'Letter spacing', -0.05, 0.1, 0.005, 0, 'em', { adv }),
    range('maxw', 'Auto up to', 30, 120, 1, 70, 'ch', { adv, dep: () => ui.auto }),
  ] },
  { id: 'edge', label: 'Edge', controls: [
    range('rag', 'Rag', 0, 18, 0.5, 5.5, '%', { dep: free }),
    range('ending', 'Last line', 15, 60, 1, 32, '%', { dep: () => state.protect }),
    toggle('justify', 'Nearly justified'),
    range('firmness', 'Firmness', 0, 100, 5, 0, '%', { adv, dep: free }),
    range('sync', 'Harmony', 0, 100, 5, 65, '%', { adv, dep: free }),
    toggle('protect', 'Protect short endings', true, { adv }),
  ] },
  { id: 'space', label: 'Spacing', controls: [
    range('track', 'Tracking', 0, 0.03, 0.001, 0.012, 'em', { pair: ['trackMin', 'trackMax'], dep: free }),
    range('trackMin', 'Shrink', -0.03, 0, 0.001, -0.012, 'em', { of: 'track', dep: free }),
    range('trackMax', 'Stretch', 0, 0.03, 0.001, 0.012, 'em', { of: 'track', plus: true, dep: free }),
    range('space', 'Word spacing', 0, 1000, 10, 200, '%', { pair: ['shrink', 'stretch'], dep: free }),
    range('shrink', 'Shrink', 0, 50, 5, 20, '%', { of: 'space', neg: true, dep: free }),
    range('stretch', 'Stretch', 0, 1000, 10, 200, '%', { of: 'space', plus: true, dep: free }),
    range('widthFlex', 'Width flex', 0, 40, 1, 0, '%', { adv, dep: () => !!widthRange(typeface()) }),
  ] },
  { id: 'hyph', label: 'Hyphens', master: 'hyphenate', about: 'Break words at line ends', controls: [
    toggle('hyphenate', 'Hyphenate'),
    select('hyLang', 'Language', ['English US', 'English UK', 'Español', 'Deutsch', 'Français'], { dep: hyOn }),
    range('hyFreq', 'Frequency', 0, 100, 5, 50, '%', { adv, dep: hyOn }),
    range('hyMin', 'Shortest word', 4, 12, 1, 6, '', { adv, dep: hyOn }),
    range('hyBefore', 'Letters before', 1, 5, 1, 2, '', { adv, dep: hyOn }),
    range('hyAfter', 'Letters after', 2, 6, 1, 3, '', { adv, dep: hyOn }),
  ] },
  { id: 'kash', label: 'Kashida', master: 'kashida', about: 'Stretch Arabic letters', controls: [
    toggle('kashida', 'Kashida'),
    range('kaLine', 'Per line', 1, 4, 1, 2, '', { dep: kaOn }),
    // Kashida first or word spacing first: 50% is the home page's balance; the lab
    // leans to kashida so Arabic shows it with the lab's wide spaces.
    range('kaFreq', 'Over spaces', 0, 100, 5, 75, '%', { dep: kaOn }),
    range('kaWord', 'Per word', 1, 3, 1, 2, '', { adv, dep: kaOn }),
    range('kaMin', 'Shortest word', 2, 6, 1, 2, '', { adv, dep: kaOn }),
    note('kaWhere', 'Stretch at', { adv, dep: kaOn }),
    toggle('kaSeen', 'After <span class="ar">س ش ص ض</span>', true, { adv, dep: kaOn, aria: 'After seen, sheen, sad and dad' }),
    toggle('kaHeh', 'Before a final <span class="ar">ة ه د ذ</span>', true, { adv, dep: kaOn, aria: 'Before a final teh marbuta, heh, dal or thal' }),
    toggle('kaAlef', 'Before a final <span class="ar">ا ل ك</span>', true, { adv, dep: kaOn, aria: 'Before a final alef, lam or kaf' }),
    toggle('kaAny', 'Any other joint', true, { adv, dep: kaOn }),
  ] },
  { id: 'show', label: 'Show', controls: [
    toggle('numbers', 'Paragraph numbers', true),
    select('handle', 'Width handle', ['On', 'Hover', 'Off'], { value: 'Hover' }),
    select('ruler', 'Ruler', ['Hairline', 'Ticks', 'None']),
    select('label', 'Label', ['Figure', 'Spec', 'Block', 'Sample', 'None'], { show: () => !ui.compare }),
    toggle('diag', 'Rag zone'),
    toggle('guides', 'Line guides'),
    toggle('twMarks', 'Tatweels', false, { show: () => hasArabic() }),
    toggle('moved', 'Moved words'),
    toggle('inspect', 'Inspect lines'),
  ] },
];

const CONTROLS = Object.fromEntries(GROUPS.flatMap(g => g.controls.map(c => [c.k, { ...c, g: g.id }])));
const state = Object.fromEntries(Object.values(CONTROLS).filter(c => c.type !== 'note').map(c => [c.k, c.value]));
const DEFAULTS = { ...state };
// A linked pair's slider sets its + side. Tracking's − side follows at this ratio,
// symmetric; word spacing's shrink stays put (−20%) until split.
const RATIO = { track: -1 };
const ui = { auto: true, linked: { track: true, space: true }, ratio: { ...RATIO }, open: new Set(), compare: false, read: false, focus: false, layout: 'left', vs: 'ragged', gt: 'start', chip: 'underline', opts: 'glide', dd: 'inline', hd: 'stops', mk: 'quiet', rules: 'dashed', unit: 'ch', caption: null,
  kinds: {}, nors: new Set(), rpos: 'off', rshow: 'hover', rslot: 'keep', rval: 'end', vink: 'ink', line: 'always', drag: 'kind', mom: 'short', typing: 'off' };

/* How each control is drawn, to try, one by one (Sliders in the variants window).
   slider: the browser's range, as before. row: specimen S05, the title and the
   value as one line of text, dragged sideways anywhere on it. line: row over a
   hairline filled to the value. box: specimen S02, the dropdowns' box filled from
   the left. stops: specimen S11, every value written out. cells: specimen S12, a
   cell a step. Stops and cells only where there are a few steps. A dropdown can
   be written out as stops too. */
const KINDS = ['slider', 'row', 'line', 'box', 'stops', 'cells'];
const steps = c => Math.round((c.max - c.min) / c.step);
const kindsOf = c => c.type === 'select' ? ['dropdown', 'stops'] : steps(c) < 12 ? KINDS : KINDS.slice(0, 4);
// Indent's two rows, ch and %, are one control here.
const kindKey = k => k === 'indentPct' ? 'indent' : k;
const kindOf = k => ui.kinds[kindKey(k)] ?? kindsOf(CONTROLS[k])[0];
const KIND_KEYS = Object.values(CONTROLS).filter(c => ['range', 'select'].includes(c.type) && c.k !== 'indentPct').map(c => c.k);
// A suggestion: a line where the value's place matters at a glance, words for a
// few steps or choices, the rest quiet rows.
const SUGGESTED = { direction: 'stops', indentAt: 'stops', ruler: 'stops', size: 'line', measure: 'line', rag: 'line', hyBefore: 'stops', hyAfter: 'stops', kaLine: 'cells', kaWord: 'stops', kaMin: 'stops' };
const PRESETS = {
  before: c => kindsOf(c)[0],
  suggested: c => SUGGESTED[c.k] ?? (c.type === 'range' ? 'row' : 'dropdown'),
};
// The width the text is set at: the slider's value, or the auto width.
let measureNow = state.measure;
// The most indent in ch the width allows.
let indentCap = Infinity;

function format(k) {
  const c = CONTROLS[k], v = state[k];
  if (c.type === 'toggle') return v ? 'on' : 'off';
  if (c.type === 'select') return v;
  if (k === 'measure') return measureNow + ' ch';
  // Beside the number, ch / % is the number's unit, so it isn't written twice.
  if (c.units && ['value', 'hybrid', 'glide'].includes(place())) return String(k === 'indent' ? Math.min(v, indentCap) : v);
  if (k === 'indent') return Math.min(v, indentCap) + ' ch';
  if (c.pair) {
    const [a, b] = c.pair;
    // Linked shows one number, the stretch the slider sets: ± when the sides match.
    return Math.abs(state[a] + state[b]) < 1e-9 ? '±' + format(b).slice(1) : format(b);
  }
  const digits = (String(c.step).split('.')[1] ?? '').length;
  const sign = v < 0 || (c.neg && v > 0) ? '−' : (c.plus || c.min < 0) && v > 0 ? '+' : '';
  return sign + Math.abs(v).toFixed(digits) + (c.unit === '%' ? '%' : c.unit ? ' ' + c.unit : '');
}
const changed = k => {
  if (k === 'measure') return !ui.auto;
  if (CONTROLS[k].pair) return CONTROLS[k].pair.some(changed);
  const a = state[k], b = DEFAULTS[k];
  return typeof a === 'number' ? Math.abs(a - b) > 1e-9 : a !== b;
};

const snap = (c, v) => +Math.min(c.max, Math.max(c.min, Math.round(Number(v) / c.step) * c.step)).toFixed(6);
function set(k, v) {
  const c = CONTROLS[k];
  if (c.type === 'range') v = snap(c, v);
  if (k === 'measure') ui.auto = false;
  state[k] = v;
  if (c.pair) {
    const [a, b] = c.pair;
    state[b] = v;
    // Word spacing has no ratio: linked, only the stretch moves and the shrink keeps
    // its own value, which changes only once split.
    if (k in ui.ratio) state[a] = snap(CONTROLS[a], v * ui.ratio[k]);
    paint(a);
    paint(b);
  }
  if (k === 'sample') loadSample();
  paint(k);
  apply();
}
function reset(k) {
  if (k === 'measure') ui.auto = true;
  else {
    if (k in RATIO) ui.ratio[k] = RATIO[k];
    set(k, DEFAULTS[k]);
  }
  apply();
}
function resetAll() {
  Object.assign(state, DEFAULTS);
  ui.auto = true;
  ui.linked = { track: true, space: true };
  ui.ratio = { ...RATIO };
  ui.unit = 'ch';
  loadSample();
  Object.keys(state).forEach(paint);
  apply();
}

function paint(k) {
  const v = k === 'measure' ? measureNow : state[k];
  for (const el of document.querySelectorAll(`[data-k="${k}"]`)) {
    if (el.type === 'checkbox') el.checked = v; else if (el.value !== String(v)) el.value = v;
  }
  for (const el of document.querySelectorAll(`[data-v="${k}"]`)) el.textContent = format(k);
  for (const b of document.querySelectorAll(`[data-sk="${k}"]`)) b.setAttribute('aria-pressed', b.dataset.sv === v);
  const row = document.querySelector(`.row.range[data-row="${k}"]`);
  if (!row) return;
  const c = CONTROLS[k], now = cur(k), i = Math.round((now - c.min) / c.step);
  row.style.setProperty('--p', (now - c.min) / (c.max - c.min));
  if (row.role === 'slider') {
    row.setAttribute('aria-valuenow', now);
    row.setAttribute('aria-valuetext', format(k));
  }
  for (const w of row.querySelectorAll('[data-i]')) w.classList.toggle('on', row.dataset.kind === 'cells' ? +w.dataset.i <= i :+w.dataset.i === i);
}
// The value as the controls show it: Width's auto too, and the indent the width allows.
const cur = k => k === 'measure' ? measureNow : k === 'indent' ? Math.min(state.indent, indentCap) : state[k];

const root = document.documentElement;
const texts = () => document.querySelectorAll('.text');
function apply() {
  const s = root.style;
  s.setProperty('--size', state.size + 'rem');
  s.setProperty('--lh', state.lh);
  s.setProperty('--ls', state.ls + 'em');
  s.setProperty('--font', families[typeface()]);
  s.setProperty('--hyphens', hyOn() ? 'auto' : 'manual');
  s.setProperty('--rag', state.rag);
  root.dataset.indent = { 'Every paragraph': 'all', 'First only': 'first', 'All but first': 'rest' }[state.indentAt];
  for (const [cls, on] of [['justify-b', ui.vs === 'justified'], ['guides', state.guides], ['diag', state.diag], ['tw-marks', state.twMarks], ['numbers', state.numbers], ['moved', state.moved], ['inspect', state.inspect]]) root.classList.toggle(cls, on);
  root.dataset.handle = state.handle.toLowerCase();
  root.toggleAttribute('data-compare', ui.compare);
  root.toggleAttribute('data-read', ui.read);
  root.toggleAttribute('data-focus', ui.focus);
  root.dataset.ruler = state.ruler.toLowerCase();
  const rtl = state.direction === 'RTL' || (state.direction === 'Auto' && hasArabic());
  root.classList.toggle('rtl', rtl);
  // Arabic mirrors the whole canvas: columns anchor on the right, the gutter too.
  document.querySelector('.stage').dir = rtl ? 'rtl' : 'ltr';
  // The browser hyphenates its own text in the language the composer uses.
  const lang = hasArabic() ? 'ar' : hasJapanese() ? 'ja' : hyOn() ? HY_LANG[state.hyLang].replace(/-(\w+)$/, (_, r) => '-' + r.toUpperCase()) : 'en';
  for (const t of texts()) {
    t.dir = rtl ? 'rtl' : 'ltr';
    t.lang = lang;
  }
  layout();
  refresh();
  scheduleRender();
}

/* ---------------------------------------------------------------------------
   Width is in ch, the text's own "0", so a typeface or size change keeps the
   characters a line. Auto fills the column's room, up to "Auto up to". Comparing,
   each column takes half; when half is too narrow (phones), a column takes nearly
   the whole room and the next one peeks in. The head and ruler are set in Inter,
   whose ch differs, so they get the same width in px (--measure-px).
   --------------------------------------------------------------------------- */
function chPx() {
  const el = document.querySelector('.text[data-col="u"]');
  const probe = el.appendChild(document.createElement('span'));
  probe.style.cssText = 'position:absolute;width:100ch;visibility:hidden';
  const px = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return px || 8;
}
// Whether the last layout() changed the width or the font's ch.
let laidOut = '';
function layout() {
  const pair = document.querySelector('.pair');
  if (!pair) return false;
  const ch = chPx();
  let w = state.measure;
  if (ui.auto) {
    const cs = getComputedStyle(pair);
    const room = pair.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const half = (room - (parseFloat(cs.columnGap) || 0)) / 2;
    const px = !ui.compare || ui.read ? room : half >= 240 ? half : room - 40;
    w = Math.max(15, Math.min(state.maxw, Math.floor(px / ch)));
  }
  if (w !== measureNow) {
    measureNow = w;
    paint('measure');
  }
  // An indent in ch shows at most 90% of the width, the most the % slider allows.
  // Your number is kept: widen the column again and it comes back.
  indentCap = Math.floor(w * .9);
  const input = document.querySelector('#in-indent');
  if (input) input.max = indentCap;
  paint('indent');
  document.querySelector('[data-row="indent"]')?.classList.toggle('is-capped', state.indent > indentCap);
  root.style.setProperty('--indent', ui.unit === '%' ? state.indentPct + '%' : Math.min(state.indent, indentCap) + 'ch');
  root.style.setProperty('--measure', w + 'ch');
  root.style.setProperty('--measure-px', w * ch + 'px');
  for (const el of document.querySelectorAll('[data-m="u.width"]')) el.textContent = (ui.auto ? 'auto ' : '') + w + ' ch';
  const now = `${w}:${ch}`, moved = now !== laidOut;
  laidOut = now;
  return moved;
}

/* ---------------------------------------------------------------------------
   Panel.
   --------------------------------------------------------------------------- */
// Word stops, a slash before each but the first, kept with its word when they wrap.
const words = list => list.map((w, i) => i ? `<span class="ws-i"><span class="sl">/</span>${w}</span>` : w).join('');
function rowHTML(c) {
  const cls = `row ${c.type}${c.of ? ' sub' : ''}`;
  const row = `data-row="${c.k}"`;
  if (c.type === 'note') return `<div class="${cls}" ${row}><span class="sub">${c.label}</span></div>`;
  if (c.type === 'toggle') return `<label class="${cls}" ${row}><span class="lbl">${c.label}</span><input type="checkbox" id="in-${c.k}" data-k="${c.k}" ${state[c.k] ? 'checked' : ''} aria-label="${c.aria ?? c.label}"></label>`;
  // A dropdown is drawn (title, value, arrow) with the real select laid over it,
  // invisible, so a click opens the browser's own menu. DD picks the look.
  // Written out (specimen S11), every choice shows and a click picks it.
  if (c.type === 'select' && kindOf(c.k) === 'stops') return `<div class="${cls} kind-stops" ${row}><span class="lbl">${c.label}</span><span class="ws" role="group" aria-label="${c.label}">${words(c.options.map(o => `<button class="w" data-sk="${c.k}" data-sv="${o}" aria-pressed="${o === state[c.k]}">${o}</button>`))}</span></div>`;
  if (c.type === 'select') return `<div class="${cls}" ${row}><label class="dd"><span class="dd-l">${c.label}</span><span class="dd-box"><span class="dd-v" data-v="${c.k}">${format(c.k)}</span><span class="dd-a" aria-hidden="true"><span class="mk"></span></span><select id="in-${c.k}" data-k="${c.k}">${c.options.map(o => `<option${o === state[c.k] ? ' selected' : ''}>${o}</option>`).join('')}</select></span></label></div>`;
  // Specimen T-04: struck through when off.
  const strike = (attr, on, word, title) => `<button class="opt sk" ${attr} aria-pressed="${on}" title="${title}"><span class="base">${word}</span><span class="over" aria-hidden="true">${word}</span></button>`;
  const opt = c.pair ? strike(`data-linked="${c.k}"`, true, 'linked', 'One slider moves both sides')
    : c.auto ? strike('data-auto', true, 'auto', 'Follow the window')
    : c.units ? `<span class="opt unit" role="group" aria-label="${c.label} unit"><button data-unit="ch" title="Characters, fixed">ch</button><span class="sl"> / </span><button data-unit="%" title="Percent of the width">%</button></span>` : '';
  // Below the slider, as Hyphens' start: a box, the word, what it does.
  const line = (attr, word, about) => `<button class="opt-row" ${attr} aria-pressed="true"><span class="sq" aria-hidden="true"></span><span class="w">${word}</span><span class="about">${about}</span></button>`;
  const below = c.pair ? line(`data-linked="${c.k}"`, 'linked', 'one slider moves both sides')
    : c.auto ? line('data-auto', 'auto', 'follows the window')
    : c.units ? `<span class="opt-row">${opt}<span class="about" data-says="ch">characters, fixed</span><span class="about" data-says="%">a share of the width</span></span>` : '';
  // The option is written in each place it can sit (OPTS); CSS shows one.
  const at = (place, html) => html && `<span class="at-${place}${c.units ? ' u' : ''}">${html}</span>`;
  const out = `<output class="num" data-v="${c.k}">${format(c.k)}</output>`;
  // The drawn kinds keep the range, hidden, as the value's home; the row is the slider.
  const kind = kindOf(c.k), drawn = kind !== 'slider';
  const vals = Array.from({ length: steps(c) + 1 }, (_, i) => +(c.min + i * c.step).toFixed(6));
  const at0 = Math.round((cur(c.k) - c.min) / c.step), def = Math.round((DEFAULTS[c.k] - c.min) / c.step);
  const widget = {
    stops: `<span class="ws stops" aria-hidden="true">${words(vals.map((v, i) => `<span class="w${i === at0 ? ' on' : ''}" data-i="${i}">${v}</span>`))}</span>`,
    cells: `<span class="cells" aria-hidden="true">${vals.map((_, i) => `<i class="${i <= at0 ? 'on' : ''}${i === def ? ' df' : ''}" data-i="${i}"></i>`).join('')}</span>`,
  }[kind] ?? '';
  const rs = drawn && ui.rpos !== 'off' && !ui.nors.has(kindKey(c.k)) ? `<button class="rs" data-reset="${c.k}" tabindex="-1" aria-label="Reset ${c.label}" title="Reset">↺</button>` : '';
  const p = (cur(c.k) - c.min) / (c.max - c.min);
  const style = `--p:${p}${c.auto ? '' : `;--d:${(DEFAULTS[c.k] - c.min) / (c.max - c.min)}`}`;
  const aria = drawn ? ` tabindex="0" role="slider" aria-label="${c.label}" aria-valuemin="${c.min}" aria-valuemax="${c.max}" aria-valuenow="${cur(c.k)}" aria-valuetext="${format(c.k)}"` : '';
  return `<div class="${cls} kind-${kind}${c.auto ? '' : ' has-d'}" ${row} data-kind="${kind}" style="${style}"${aria}><span class="lbl"><label for="in-${c.k}">${c.label}</label>${ui.rpos === 'label' ? rs : ''}${at('label', opt)}</span><span class="out">${widget}${c.units ? out + at('value', opt) : at('value', opt) + out}${ui.rpos === 'end' ? rs : ''}</span><input type="range" id="in-${c.k}" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${state[c.k]}" title="Double-click to reset">${kind === 'line' ? `<span class="ln" aria-hidden="true">${c.auto ? '' : '<i class="dn"></i>'}</span>` : kind === 'box' ? '<i class="fill" aria-hidden="true"></i>' : ''}${at('below', below)}</div>`;
}

// A switched group's on/off, to try. The empty line beside an off group is where
// it says what it does, so it reads as a sentence, not a hole.
// gutter: the box before the title; off, the line says what it does.
// edge: the box after the title, at the gutter's edge, pointing at the options.
// start: the box at the start of the options, with what it does after it.
// switch: off / on, as the header's left / centre.
// cell: one rectangle that presses, with a square at its corner (round 1 C).
const GT = ['gutter', 'edge', 'start', 'switch', 'cell'];
// How auto and linked read as buttons, to try: plain words as
// before; underlined as specimen S-11 (struck through when off); boxed and struck
// through when off; boxed and filled black when on.
const CHIPS = ['plain', 'underline', 'outline', 'fill'];
// Where a slider's option (auto, linked, ch / %) sits, to try: beside the label;
// beside the number, where ch / % becomes the number's unit; on a line below the
// slider; or by pointer, beside the number for a mouse and below for a finger.
// hybrid: auto and linked beside the label, where switching them never moves them,
// and ch / % beside the number as its unit. glide: hybrid, and linked slides to the
// row's end as a pair splits, striking through on the way. Both go below for a finger.
const OPTS = ['label', 'value', 'below', 'pointer', 'hybrid', 'glide'];
// Dropdown looks, to try. stack: the title above a box, as before. The rest put the
// title inside: inline, title and value on one line as a slider's; caption, a small
// title over the value; legend, the title set into the top border; split, a cell
// for the title ruled off from the value's; rule, no box, a line under the row.
const DD = ['stack', 'inline', 'caption', 'legend', 'split', 'rule'];
// The header's left / centre and the rest, to try. block: the site's black block, as
// before. stops: specimen S-11, the chosen word in ink and underlined, the others at
// half ink, so with nothing on, all of vs browser / focus / read rest at half. idle:
// stops, but nothing on leaves them all in ink; one on, the others step back.
const HD = ['block', 'stops', 'idle'];
// The prototype's pickers, at the panel's foot: name, the ui key (also the URL
// parameter and the root's data attribute), choices.
// The underlines, to try (sliders at the panel's foot). The offset is one equation
// through two points: the gap under 13px words (the panel's) and under 16px words
// (the header's). It runs on each word's own size, 1em, the way fluid type runs on
// the window's width:
//   clamp(max(1px, .05em), calc(at13 + (1em - 13px) * slope), .5em),
//   slope = (at16 - at13) / 3
// so the gap can shrink as words grow, which no px floor or em share can do. The
// clamp keeps far sizes sane: never under 1px, or a twentieth of a big word; never
// over half the word. The thickness is a share of the word's size.
// The Tuning group's sliders: [label, unit, min, max, step, default, CSS variable].
// The key is also the URL parameter. tuneApply() sets each variable; the underline's
// offset is worked out from its two points instead (--ul). Every spacing in the panel
// reads one of these, with its default as the fallback.
const TUNES = {
  ulat13: ['Underline at 13 px', 'px', 0, 6, .25, 3],
  ulat16: ['Underline at 16 px', 'px', 0, 6, .25, 5],
  ulw: ['Underline thickness', 'em', .02, .2, .005, .1, '--ul-w'],
  gap: ['Between groups', 'rem', 0, 5, .05, 2.55, '--gg'],
  rows: ['Between rows', 'rem', 0, 2.5, .05, 1, '--rg'],
  track: ['Label to slider', 'rem', 0, 1.5, .05, .4, '--lt'],
  gutter: ['Title to options', 'rem', 0, 4, .05, 2.1, '--cg'],
  sides: ['Panel sides', 'rem', 0, 4, .05, 1.65, '--ps'],
  top: ['Panel top', 'rem', 0, 4, .05, 1.25, '--pt'],
  more: ['Above "more"', 'rem', 0, 1.5, .05, 1.25, '--mm'],
  opt: ['Label to its option', 'rem', 0, 1.5, .05, .55, '--og'],
  pair: ['After a split pair', 'rem', 0, 2.5, .05, .7, '--pr'],
  sub: ['Split rows indent', 'rem', 0, 2.5, .05, 1.3, '--si'],
  ddp: ['Dropdown padding', 'em', 0, 1, .05, .65, '--ddp'],
  // The drawn sliders.
  dragpx: ['Full range drag', 'px', 80, 1000, 10, 320],
  rvg: ['Value to reset', 'rem', 0, 2, .05, .45, '--rvg'],
  rsw: ['Reset slot', 'em', 0, 2, .05, 1, '--rsw'],
  iv: ['Label to value, inline', 'rem', 0, 3, .05, .5, '--iv'],
  ll: ['Label to line', 'rem', 0, 1.5, .05, .45, '--ll'],
  lnw: ['Line weight', 'px', 1, 6, .5, 2, '--lnw'],
  cw: ['Cell width', 'rem', .2, 1.5, .05, .55, '--cw'],
  // The canvas.
  hz: ['Handle zone', '%', 5, 100, 5, 20],
};
const TUNE = Object.fromEntries(Object.entries(TUNES).map(([k, t]) => [k, t[5]]));
const ulSlope = () => +((TUNE.ulat16 - TUNE.ulat13) / 3).toFixed(4);
const ulSay = () => `${TUNE.ulat13}px + (1em − 13px) × ${String(ulSlope()).replace('-', '−')}`;
function tuneApply() {
  root.style.setProperty('--ul', `clamp(max(1px, .05em), calc(${TUNE.ulat13}px + (1em - 13px) * ${ulSlope()}), .5em)`);
  for (const [k, t] of Object.entries(TUNES)) if (t[6]) root.style.setProperty(t[6], TUNE[k] + t[1]);
}
function setTune(k, v) {
  TUNE[k] = +v;
  tuneApply();
  for (const el of document.querySelectorAll(`[data-tune="${k}"]`)) if (+el.value !== TUNE[k]) el.value = TUNE[k];
  for (const el of document.querySelectorAll(`[data-tune-v="${k}"]`)) el.textContent = `${TUNE[k]} ${TUNES[k][1]}`;
  for (const el of document.querySelectorAll('[data-ul-at]')) el.textContent = ulSay();
  param(k, TUNE[k]);
}
document.addEventListener('input', e => { if (e.target.dataset?.tune) setTune(e.target.dataset.tune, e.target.value); });
document.addEventListener('dblclick', e => { const k = e.target.dataset?.tune; if (k) setTune(k, TUNES[k][5]); });
// A slider row as the panel's. Not a .row.range: those reset through CONTROLS; these
// reset on their own double-click.
const tuneHTML = k => {
  const [label, unit, min, max, step, def] = TUNES[k];
  return `<div class="row tune-row"><span class="lbl"><label for="tune-${k}">${label}</label></span><span class="out"><output class="num" data-tune-v="${k}">${TUNE[k]} ${unit}</output></span><input type="range" id="tune-${k}" data-tune="${k}" min="${min}" max="${max}" step="${step}" value="${TUNE[k]}" style="--d:${(def - min) / (max - min)}" title="Double-click for ${def} ${unit}"></div>`;
};
// The mark on a dropdown and on "n more", to try. arrow: ↓ / ↑, as before. chevron:
// a drawn hairline chevron, quieter. caret: a small solid triangle. plus: + / − for
// "more", a chevron on dropdowns. corner: a dog-ear in the dropdown's bottom corner,
// a small one after "more", as a toolbar's tool that hides more. none: no mark; the
// box says dropdown, and "more" is underlined, as a link. quiet: the user's pick, no
// mark on dropdowns, a chevron on "more".
const MK = ['arrow', 'chevron', 'caret', 'plus', 'corner', 'none', 'quiet'];
const LOOKS = [['box', 'gt', GT], ['dropdown', 'dd', DD], ['options', 'opts', OPTS], ['buttons', 'chip', CHIPS], ['header', 'hd', HD], ['marks', 'mk', MK], ['rules', 'rules', ['line', 'dashed', 'off']]];
// How the drawn sliders behave, to try. reset mark: none, as a double-click or
// double-tap resets every slider; or a ↺ once changed, at the row's end or after
// the label, as specimen S05. Never on a browser slider. mark shows: on hover, or whenever changed. reset slot: kept
// empty at the default, so the value never moves, or collapsed. value: at the
// row's end, or right after the label, as S05. value ink: always ink; grey until
// hovered or dragged, as S05; or grey at the default. line: the line always, or on
// hover. drag: by distance (relative) or to the spot (absolute); kind picks row and
// line relative, the rest absolute. momentum: the value coasts after a flick.
// typing: click the value to type one.
const FEELS = [['reset mark', 'rpos', ['off', 'end', 'label']], ['mark shows', 'rshow', ['hover', 'always']], ['reset slot', 'rslot', ['keep', 'collapse']], ['value', 'rval', ['end', 'inline']], ['value ink', 'vink', ['ink', 'grey', 'changed']], ['line', 'line', ['always', 'hover']], ['drag', 'drag', ['kind', 'relative', 'absolute']], ['momentum', 'mom', ['off', 'short', 'long']], ['typing', 'typing', ['off', 'value']]];
const PICKS = [...LOOKS, ...FEELS];
// Picks that change the panel's markup, so it's rebuilt where it is.
const REBUILD = ['gt', 'rpos'];
// Each pick's default, before the URL sets anything, for "copy changes".
const PICK_DEF = Object.fromEntries(PICKS.map(([, k]) => [k, ui[k]]));
const coarse = matchMedia('(pointer: coarse)');
const place = () => ui.opts === 'pointer' ? (coarse.matches ? 'below' : 'value')
  : ui.opts === 'hybrid' || ui.opts === 'glide' ? (coarse.matches ? 'below' : ui.opts) : ui.opts;

// Options fold away (grid rows 0fr to 1fr, which every browser animates): a
// switched group's while it's off, and every group's extra ones until "more".
function groupHTML(g) {
  const m = g.master && CONTROLS[g.master];
  // A control's own note folds open right under it.
  const rows = cs => cs.filter(c => c.k !== g.master).map(c => rowHTML(c) + (c.note ? fold(`data-note-fold="${c.k}"`, `<p class="gnote of-row" data-note="${c.k}"></p>`, false) : '')).join('');
  // Built in the state they'll show, so nothing folds shut on load.
  const fold = (attr, html, open) => `<div class="fold${open ? '' : ' shut'}" ${attr}><div class="fold-in">${html}</div></div>`;
  const body = rows(g.controls.filter(c => !c.adv))
    + fold(`data-extra="${g.id}"`, rows(g.controls.filter(c => c.adv)), ui.open.has(g.id))
    + fold(`data-note-fold="${g.id}"`, `<p class="gnote" data-note="${g.id}"></p>`, false) + `<button class="more hl" data-more="${g.id}"></button>`;
  if (!m) return `<section class="group" data-g="${g.id}" aria-labelledby="g-${g.id}"><h2 id="g-${g.id}">${g.label}</h2><div class="rows">${body}</div></section>`;
  const on = state[m.k], gt = ui.gt;
  const about = `<span class="about">${g.about}</span>`;
  // The title always toggles; in gutter and edge it carries the box.
  const title = `<button class="gt-title${gt === 'gutter' || gt === 'edge' ? ' boxed' : ''}" data-master="${m.k}" aria-pressed="${on}" title="${m.label}">${g.label}</button>`;
  const head = {
    gutter: fold(`data-about="${g.id}"`, `<p class="row about-row">${about}</p>`, !on),
    edge: fold(`data-about="${g.id}"`, `<p class="row about-row">${about}</p>`, !on),
    start: `<label class="row master-start"><input type="checkbox" id="in-${m.k}" data-k="${m.k}" ${on ? 'checked' : ''} aria-label="${m.label}">${about}</label>`,
    switch: `<div class="row master-switch"><span class="onoff"><button class="hl" data-set-k="${m.k}" data-set-v="0">off</button><span class="muted">/</span><button class="hl" data-set-k="${m.k}" data-set-v="1">on</button></span>${about}</div>`,
    cell: `<div class="row"><button class="master-cell" data-master="${m.k}" aria-pressed="${on}">${about}<span class="sq" aria-hidden="true"></span></button></div>`,
  }[gt];
  return `<section class="group switched" data-g="${g.id}" aria-labelledby="g-${g.id}"><h2 id="g-${g.id}">${title}</h2><div class="rows">${head}${fold(`data-body="${g.id}"`, body, on)}</div></section>`;
}

// The prototype's own group: each look to try is a row, its name over its choices,
// then the underline's sliders. It sits under "reset all", which is the app's.
const cap = s => s[0].toUpperCase() + s.slice(1);
const choices = (attr, list) => list.map(t => `<button class="hl" ${attr(t)}>${t}</button>`).join('<span class="sl">/</span>');
const pickHTML = (name, html, cls = '') => `<div class="row pick${cls}"><span class="lbl">${name}</span><span class="ch">${html}</span></div>`;
const noteHTML = name => `<div class="row note"><span class="sub">${name}</span></div>`;
const variantsHTML = () => `<section class="group variants" data-g="variants" aria-labelledby="g-variants"><h2 id="g-variants">Variants</h2><div class="rows">${LOOKS.map(([name, k, list]) => pickHTML(cap(name), choices(t => `data-${k}="${t}"`, list))).join('')}</div></section>`;
// Sliders: how the drawn ones behave, then how each control is drawn, by group,
// with its reset mark on or off.
const kindName = c => c.of ? `${CONTROLS[c.of].label} ${c.label.toLowerCase()}` : c.label.replace(/<[^>]+>/g, '');
const slidersHTML = () => `<section class="group sliders" data-g="sliders" aria-labelledby="g-sliders"><h2 id="g-sliders">Sliders</h2><div class="rows">`
  + FEELS.map(([name, k, list]) => pickHTML(cap(name), choices(t => `data-${k}="${t}"`, list))).join('')
  + noteHTML('Every control')
  + pickHTML('Preset', choices(t => `data-preset="${t}"`, Object.keys(PRESETS)))
  + pickHTML('Sliders', choices(t => `data-all-r="${t}"`, KINDS.slice(0, 4)))
  + pickHTML('Dropdowns', choices(t => `data-all-s="${t}"`, ['dropdown', 'stops']))
  + GROUPS.map(g => {
    const cs = g.controls.filter(c => KIND_KEYS.includes(c.k));
    return cs.length ? noteHTML(g.label) + cs.map(c => pickHTML(kindName(c), choices(t => `data-kind-k="${c.k}" data-kind-v="${t}"`, kindsOf(c))
      + (c.type === 'range' ? `<button class="hl rs-t" data-nors="${c.k}" title="Reset mark" aria-label="${kindName(c)} reset mark">↺</button>` : ''), ' per')).join('') : '';
  }).join('')
  + '</div></section>';
// The prototype's sliders: the underline, every spacing in the panel, the drawn sliders.
const SPACES = ['gap', 'rows', 'track', 'gutter', 'sides', 'top', 'more', 'opt', 'pair', 'sub', 'ddp'];
const DRAWN = ['dragpx', 'rvg', 'rsw', 'iv', 'll', 'lnw', 'cw'];
const tuningHTML = () => `<section class="group tuning" data-g="tuning" aria-labelledby="g-tuning"><h2 id="g-tuning">Tuning</h2><div class="rows">${noteHTML('Underline')}${['ulat13', 'ulat16', 'ulw'].map(tuneHTML).join('')}<p class="gnote num" data-ul-at>${ulSay()}</p>${noteHTML('Space')}${SPACES.map(tuneHTML).join('')}${noteHTML('Sliders')}${DRAWN.map(tuneHTML).join('')}${noteHTML('Canvas')}${tuneHTML('hz')}</div></section>`;

// The box looks, the reset's place and each control's kind have their own markup,
// so the panel is rebuilt where it is.
function rebuild() {
  const panel = document.querySelector('.panel'), y = panel.scrollTop;
  buildPanel();
  panel.scrollTop = y;
  apply();
}
// Only what differs from the defaults goes in the address.
function kindsChanged() {
  for (const k of KIND_KEYS) if (ui.kinds[k] === kindsOf(CONTROLS[k])[0]) delete ui.kinds[k];
  param('kinds', Object.entries(ui.kinds).map(([k, v]) => `${k}:${v}`).join(','));
  param('nors', [...ui.nors].join(','));
  rebuild();
}

function buildPanel() {
  document.querySelector('.groups').innerHTML = GROUPS.map(groupHTML).join('')
    + '<div class="foot"><button class="hl" data-win title="Variants and tuning (⌥T)">variants</button><button class="hl" data-reset-all>reset all ↺</button></div>';
  document.querySelector('.tabs').innerHTML = GROUPS.map(g => `<button role="tab" data-tab="${g.id}" aria-selected="false">${g.label}</button>`).join('');
}

/* ---------------------------------------------------------------------------
   The prototype's own window: Variants and Tuning, floating over the page so the
   text changes in view while you tune. Drag it by its bar, resize it from its
   corner, show and hide it with ⌥T (by the key, so any layout) or "variants" at
   the panel's foot. Where it sits, its size and whether it's open are kept.
   --------------------------------------------------------------------------- */
// A window of the prototype's own, over the page: Variants and Tuning, and the
// timings. Drag it by its bar, resize it from its corner; where it sits, its size
// and whether it's open are kept, under key.
function floating({ key, label, bar, body, x, y, w, h, open = false, toggled = () => {} }) {
  const win = { x, y, w, h, open };
  try { Object.assign(win, JSON.parse(localStorage.getItem(key)) ?? {}); } catch {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(win)); } catch {} };
  const el = document.createElement('aside');
  el.className = 'win';
  el.setAttribute('aria-label', label);
  el.innerHTML = `<div class="win-bar">${bar}<button class="hl" data-close aria-label="Hide">×</button></div><div class="win-groups">${body}</div>`;
  el.style.width = win.w + 'px';
  el.style.height = win.h + 'px';
  document.body.append(el);
  const place = () => {
    // Kept on screen, whatever the window was when it was left.
    win.x = Math.max(0, Math.min(win.x, innerWidth - Math.min(el.offsetWidth || win.w, innerWidth)));
    win.y = Math.max(0, Math.min(win.y, innerHeight - 48));
    el.style.left = win.x + 'px';
    el.style.top = win.y + 'px';
  };
  const toggle = (on = !win.open) => {
    win.open = on;
    el.hidden = !on;
    if (on) place();
    toggled(on);
    save();
  };
  el.querySelector('[data-close]').addEventListener('click', () => toggle(false));
  // Drag by the bar.
  el.querySelector('.win-bar').addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('button')) return;
    const handle = e.currentTarget, dx = e.clientX - win.x, dy = e.clientY - win.y;
    handle.setPointerCapture(e.pointerId);
    const move = m => { win.x = m.clientX - dx; win.y = m.clientY - dy; place(); };
    const up = () => { handle.removeEventListener('pointermove', move); save(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
  // Its size, as left by the corner.
  new ResizeObserver(() => {
    if (el.hidden) return;
    win.w = el.offsetWidth;
    win.h = el.offsetHeight;
    save();
  }).observe(el);
  addEventListener('resize', () => { if (win.open) place(); });
  toggle(win.open);
  return toggle;
}
let winToggle = () => {};
function buildWin() {
  winToggle = floating({ key: 'unjustified-r3-win', label: 'Variants and tuning', x: 32, y: 88, w: 416, h: 560, open: true,
    bar: '<span>Variants · Tuning</span><button class="hl" data-copy title="Copy what differs from the defaults, to paste back">copy changes</button><span class="muted">⌥T</span>',
    body: variantsHTML() + slidersHTML() + tuningHTML(),
    toggled: on => { for (const b of document.querySelectorAll('.foot [data-win]')) b.setAttribute('aria-pressed', on); } });
}
// The timings, as the home page's "The whole trip" and "Under the hood": the
// ids are its own, so src/benchmark.ts fills them and runs the benchmark.
let timingsToggle = () => {}, timingsOpen = false;
function buildTimings() {
  const group = (id, title, html) => `<section class="group" aria-labelledby="g-${id}"><h2 id="g-${id}">${title}</h2><div class="rows">${html}</div></section>`;
  timingsToggle = floating({ key: 'unjustified-r3-timings', label: 'Timings', x: Math.max(16, innerWidth - 900), y: 88, w: 420, h: 600,
    bar: '<span>The whole trip</span>',
    body: group('trip', 'Trip', '<p class="trip-total"><strong id="benchmark-total" class="num">—</strong><span id="benchmark-mode">Waiting for the first composition</span></p><dl id="benchmark-breakdown" class="kv num"></dl><p id="benchmark-queue" class="gnote"></p><p class="bench"><button id="benchmark-run" class="hl">Benchmark cold + cached</button></p><p id="benchmark-result" class="gnote">A cold run starts a fresh worker, with an empty measurement cache; cached runs reuse its measurements. From font readiness and the browser\'s geometry, through the search and the DOM update, to the next paint.</p>')
      + group('hood', 'Search', '<dl id="performance-details" class="kv num"></dl>')
      + group('edge-stats', 'Edge', '<dl data-edge-stats class="kv num"></dl>'),
    toggled: on => { timingsOpen = on; for (const b of document.querySelectorAll('[data-timings]')) b.setAttribute('aria-pressed', on); } });
}
// What differs from the defaults, as plain lines to paste back into the chat, with
// the address that sets it all up again.
function changesText() {
  const lines = [];
  for (const [name, k] of PICKS) if (ui[k] !== PICK_DEF[k]) lines.push(`${name}: ${ui[k]} (default ${PICK_DEF[k]})`);
  for (const k of KIND_KEYS) if (kindOf(k) !== kindsOf(CONTROLS[k])[0]) lines.push(`${kindName(CONTROLS[k])}: ${kindOf(k)}`);
  for (const k of ui.nors) lines.push(`${kindName(CONTROLS[k])}: no reset mark`);
  for (const [k, t] of Object.entries(TUNES)) if (TUNE[k] !== t[5]) lines.push(`${t[0]}: ${TUNE[k]} ${t[1]} (default ${t[5]} ${t[1]})`);
  if (!lines.length) return '';
  return ['Round 3 variants and tuning, changed from the defaults:', ...lines, '', location.href].join('\n');
}
async function copyChanges(b) {
  const text = changesText();
  const say = words => { b.textContent = words; setTimeout(() => { b.textContent = 'copy changes'; }, 1600); };
  if (!text) return say('nothing changed');
  try { await navigator.clipboard.writeText(text); say('copied'); }
  catch {
    // Clipboard refused (no focus, or an old browser): select it in a box instead.
    const area = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(area);
    area.select();
    say(document.execCommand('copy') ? 'copied' : 'copy failed');
    area.remove();
  }
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyT' && e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); winToggle(); }
});

const NOTES = {
  edge: () => state.justify ? 'Nearly justified sets the rag, firmness, harmony and spacing itself.' : '',
  space: () => ui.open.has('space') && !widthRange(typeface()) ? `Width flex needs a width axis: Roboto Flex, or Noto Sans Arabic.` : '',
  hyph: () => hasArabic() || hasJapanese() ? 'Arabic and Japanese are not hyphenated: kashida and tracking do that work.' : '',
  kash: () => hasArabic() ? '' : 'Kashida applies to Arabic text only. <button class="hl" data-try="Arabic">Arabic sample ⟶</button>',
};

// A note, a group's or a control's, folds open and shut; shutting, it keeps its
// words until it's gone.
function showNote(key, html) {
  const n = document.querySelector(`[data-note="${key}"]`);
  if (!n) return;
  n.closest('.fold').classList.toggle('shut', !html);
  if (html && n.innerHTML !== html) n.innerHTML = html;
}
function refresh() {
  for (const c of Object.values(CONTROLS)) {
    const row = document.querySelector(`[data-row="${c.k}"]`);
    if (!row) continue;
    row.hidden = (c.show && !c.show()) || (c.of && ui.linked[c.of]);
    // Split, a pair keeps its row as the heading of its two sides, so nothing moves.
    if (c.pair) row.classList.toggle('split', !ui.linked[c.k]);
    if (c.auto) row.classList.toggle('is-auto', ui.auto);
    row.classList.toggle('dim', !!c.dep && !c.dep());
    row.classList.toggle('changed', c.type === 'range' && changed(c.k));
  }
  for (const g of GROUPS) {
    const more = document.querySelector(`[data-more="${g.id}"]`);
    const extra = g.controls.filter(c => c.adv && c.type !== 'note' && !(c.show && !c.show()));
    const touched = extra.filter(c => changed(c.k)).length;
    more.hidden = !extra.length;
    more.setAttribute('aria-expanded', ui.open.has(g.id));
    document.querySelector(`[data-extra="${g.id}"]`).classList.toggle('shut', !ui.open.has(g.id));
    if (g.master) document.querySelector(`[data-body="${g.id}"]`).classList.toggle('shut', !state[g.master]);
    document.querySelector(`[data-about="${g.id}"]`)?.classList.toggle('shut', !!state[g.master]);
    // The mark (MK) turns over as the group opens; CSS draws it.
    const words = ui.open.has(g.id) ? 'fewer' : `${extra.length} more`;
    const label = `${words} <span class="mk" aria-hidden="true"></span>${!ui.open.has(g.id) && touched ? ` · ${touched} set` : ''}`;
    if (more.innerHTML !== label) more.innerHTML = label;
    showNote(g.id, NOTES[g.id]?.() ?? '');
  }
  for (const c of Object.values(CONTROLS)) if (c.note) showNote(c.k, c.note());
  for (const b of document.querySelectorAll('[data-auto]')) b.setAttribute('aria-pressed', ui.auto);
  for (const b of document.querySelectorAll('[data-compare]')) b.setAttribute('aria-pressed', ui.compare);
  for (const b of document.querySelectorAll('[data-focus]')) b.setAttribute('aria-pressed', ui.focus);
  for (const b of document.querySelectorAll('[data-master]')) b.setAttribute('aria-pressed', state[b.dataset.master]);
  for (const b of document.querySelectorAll('[data-set-k]')) b.setAttribute('aria-pressed', state[b.dataset.setK] === (b.dataset.setV === '1'));
  for (const [, k] of PICKS) {
    root.dataset[k] = ui[k];
    for (const b of document.querySelectorAll(`button[data-${k}]`)) b.setAttribute('aria-pressed', b.dataset[k] === ui[k]);
  }
  for (const b of document.querySelectorAll('[data-kind-k]')) b.setAttribute('aria-pressed', kindOf(b.dataset.kindK) === b.dataset.kindV);
  for (const b of document.querySelectorAll('[data-nors]')) {
    b.setAttribute('aria-pressed', !ui.nors.has(b.dataset.nors));
    b.hidden = kindOf(b.dataset.nors) === 'slider';
  }
  const all = (type, t) => KIND_KEYS.filter(k => CONTROLS[k].type === type).every(k => kindOf(k) === t);
  for (const b of document.querySelectorAll('[data-all-r]')) b.setAttribute('aria-pressed', all('range', b.dataset.allR));
  for (const b of document.querySelectorAll('[data-all-s]')) b.setAttribute('aria-pressed', all('select', b.dataset.allS));
  for (const b of document.querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', KIND_KEYS.every(k => kindOf(k) === PRESETS[b.dataset.preset](CONTROLS[k])));
  if (root.dataset.place !== place()) {
    root.dataset.place = place();
    paint('indent');
    paint('indentPct');
  }
  for (const b of document.querySelectorAll('[data-unit]')) b.setAttribute('aria-pressed', b.dataset.unit === ui.unit);
  for (const b of document.querySelectorAll('[data-vs]')) b.setAttribute('aria-pressed', b.dataset.vs === ui.vs);
  for (const b of document.querySelectorAll('[data-linked]')) b.setAttribute('aria-pressed', ui.linked[b.dataset.linked]);
  for (const b of document.querySelectorAll('[data-layout-set]')) b.setAttribute('aria-pressed', b.dataset.layoutSet === ui.layout);
}

document.addEventListener('input', e => {
  const k = e.target.dataset?.k;
  if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
  set(k, CONTROLS[k].type === 'range' ? detent(CONTROLS[k], v) : v);
});
// Sliders snap to their default when dragged close to it.
const detent = (c, v) => !c.auto && Math.abs(v - DEFAULTS[c.k]) <= (c.max - c.min) * .015 ? DEFAULTS[c.k] : v;

/* Double-click or double-tap a slider, or a row's label, to reset it. Detected
   from pointer events, so a double tap on a phone counts the same as a double
   click. The reset waits a frame, after the slider has jumped to the tap. */
let lastTap = null;
document.addEventListener('pointerdown', e => {
  const row = e.target.closest('.row.range, .row.select');
  if (!row || e.target.closest('button, select')) return;
  const k = row.dataset.row, now = performance.now();
  const again = lastTap && lastTap.k === k && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 12;
  lastTap = again ? null : { k, t: now, x: e.clientX, y: e.clientY };
  if (again) requestAnimationFrame(() => reset(k));
});
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if ('reset' in d) reset(d.reset);
  else if ('resetAll' in d) resetAll();
  else if ('linked' in d) {
    // Unlinking keeps both values. Linking keeps the ratio they have now.
    const key = d.linked, [a, b] = CONTROLS[key].pair;
    const on = !ui.linked[key];
    if (on) {
      if (key in ui.ratio && state[b]) ui.ratio[key] = state[a] / state[b];
      state[key] = state[b];
      paint(key);
    }
    // Glide: splitting, the number fades first (CSS) and linked slides into its room
    // after it; joining, linked slides back at once and the number follows (CSS).
    slide(ui.opts === 'glide' && t, () => { ui.linked[key] = on; apply(); }, on ? 0 : NUMBER_OUT);
  }
  else if ('auto' in d) {
    if (ui.auto) state.measure = measureNow;
    ui.auto = !ui.auto;
    apply();
  }
  else if ('more' in d) {
    ui.open.has(d.more) ? ui.open.delete(d.more) : ui.open.add(d.more);
    refresh();
  }
  else if ('try' in d) set('sample', d.try);
  else if ('compare' in d) { ui.compare = !ui.compare; apply(); }
  else if ('vs' in d) { ui.vs = d.vs; apply(); }
  else if ('master' in d) set(d.master, !state[d.master]);
  else if ('setK' in d) set(d.setK, d.setV === '1');
  else if ('win' in d) winToggle();
  else if ('timings' in d) timingsToggle();
  else if (t.id === 'benchmark-run') void benchmark(cold => composer.run(cold));
  else if ('copy' in d) copyChanges(t);
  else if ('sk' in d) set(d.sk, d.sv);
  else if ('kindK' in d) { ui.kinds[d.kindK] = d.kindV; kindsChanged(); }
  else if ('nors' in d) { ui.nors.has(d.nors) ? ui.nors.delete(d.nors) : ui.nors.add(d.nors); kindsChanged(); }
  else if ('preset' in d || 'allR' in d || 'allS' in d) {
    for (const k of KIND_KEYS) {
      const c = CONTROLS[k];
      if ('preset' in d) ui.kinds[k] = PRESETS[d.preset](c);
      else if (c.type === ('allR' in d ? 'range' : 'select')) ui.kinds[k] = d.allR ?? d.allS;
    }
    kindsChanged();
  }
  else if (PICKS.some(([, k]) => k in d)) {
    const [, k] = PICKS.find(([, k]) => k in d);
    ui[k] = d[k];
    param(k, d[k]);
    if (REBUILD.includes(k)) rebuild();
    refresh();
  }
  else if ('unit' in d && d.unit !== ui.unit) {
    // Switching keeps the indent where it is on the page.
    if (d.unit === '%') state.indentPct = snap(CONTROLS.indentPct, Math.min(state.indent, indentCap) / measureNow * 100);
    else state.indent = Math.min(Math.round(state.indentPct / 100 * measureNow), indentCap);
    ui.unit = d.unit;
    paint('indent');
    paint('indentPct');
    apply();
  }
  else if ('read' in d) { ui.read = !ui.read; apply(); }
  else if ('focus' in d) { ui.focus = !ui.focus; apply(); }
  else if ('layoutSet' in d) setLayout(d.layoutSet);
  else if ('tab' in d) {
    const open = t.getAttribute('aria-selected') !== 'true';
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', open && b === t);
    for (const g of document.querySelectorAll('.group')) g.classList.toggle('on', open && g.dataset.g === d.tab);
  }
});
// Moves an element from where it is on screen to where a change puts it: measure,
// change, measure, then play the difference back to nothing. Measuring where it is
// now, mid-slide too, lets a second click turn it around instead of jumping.
// NUMBER_OUT matches the number's fade in proto.css (.row.split > .out).
const NUMBER_OUT = 100;
const still = matchMedia('(prefers-reduced-motion: reduce)');
function slide(el, change, delay = 0) {
  const from = el && el.getBoundingClientRect();
  for (const a of el ? el.getAnimations() : []) if (a.id === 'slide') a.cancel();
  change();
  if (!el || still.matches) return;
  const to = el.getBoundingClientRect(), dx = from.left - to.left, dy = from.top - to.top;
  if (!dx && !dy) return;
  // Held where it was through the delay (fill: backwards), then off it goes.
  el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { id: 'slide', duration: 340, delay, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
}

/* ---------------------------------------------------------------------------
   Drawn sliders (row, line, box, stops, cells), handled as specimen S05: drag
   sideways anywhere on the row, by distance or to the spot; let go moving and the
   value coasts; a sideways scroll, the arrow keys. On a finger, a drag that starts
   sideways sets the value and one that starts down scrolls the panel. A vertical
   wheel always scrolls the panel.
   --------------------------------------------------------------------------- */
const drawnRow = el => el?.closest?.('.row.range[data-kind]:not([data-kind="slider"])');
const clamp = (c, v) => Math.min(c.max, Math.max(c.min, v));
// Sets a value only once it moves a step, so a still click leaves Width on auto.
function setTo(k, v) {
  const c = CONTROLS[k];
  if (snap(c, v) === snap(c, cur(k))) return;
  set(k, clamp(c, v));
}
const absolute = row => ui.drag === 'absolute' || (ui.drag === 'kind' && !['row', 'line'].includes(row.dataset.kind));
// The track a drag to the spot measures: the cells, the line or the whole row.
const trackOf = row => row.querySelector('.cells, .ln') ?? row;
// The value under the pointer: the nearest word, the cell, or the share of the width.
function valueAt(row, c, e) {
  const words = [...row.querySelectorAll('.stops .w')];
  if (words.length) {
    const d = w => { const r = w.getBoundingClientRect(); return Math.hypot(e.clientX - (r.left + r.right) / 2, Math.max(0, Math.abs(e.clientY - (r.top + r.bottom) / 2) - r.height / 2) * 3); };
    const best = words.reduce((a, w) => d(w) < d(a) ? w : a);
    return c.min + best.dataset.i * c.step;
  }
  const r = trackOf(row).getBoundingClientRect(), p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  if (row.dataset.kind === 'cells') return c.min + Math.min(steps(c), Math.floor(p * (steps(c) + 1))) * c.step;
  return c.min + p * (c.max - c.min);
}
// Finer steps: ⇧, or on a finger, sliding away from the row.
function fine(e, y0) {
  let f = e.pointerType === 'mouse' ? 1 : Math.abs(e.clientY - y0) > 140 ? .05 : Math.abs(e.clientY - y0) > 60 ? .25 : 1;
  return e.shiftKey ? f * .1 : f;
}

// Momentum, as the specimens': the velocity kept per ms after you let go.
const FRIC = { off: 0, short: .9935, long: .997 };
let coasting = 0;
const halt = () => { cancelAnimationFrame(coasting); coasting = 0; };
// vpx: the pointer's speed at release, px per ms; perPx: value per px.
function coast(k, vpx, perPx) {
  const c = CONTROLS[k], fr = FRIC[ui.mom];
  if (!fr || still.matches || Math.abs(vpx) < .2) return;
  let v = cur(k), last = performance.now();
  const step = () => {
    const t = performance.now(), dt = Math.min(34, t - last);
    last = t;
    vpx *= fr ** dt;
    v += vpx * dt * perPx;
    setTo(k, v);
    coasting = v > c.min && v < c.max && Math.abs(vpx) > .012 ? requestAnimationFrame(step) : 0;
  };
  coasting = requestAnimationFrame(step);
}

let dragged = false;
document.addEventListener('pointerdown', e => {
  const row = drawnRow(e.target);
  halt();
  if (!row || e.button > 0 || row.classList.contains('split') || e.target.closest('button, input')) return;
  const k = row.dataset.row, c = CONTROLS[k], abs = absolute(row), touch = e.pointerType !== 'mouse';
  const x0 = e.clientX, y0 = e.clientY, samples = [];
  let raw = cur(k), lastX = x0, f = 1, moved = false;
  // A mouse jumps at once, as a slider; a finger only once it moves sideways or lifts.
  if (abs && !touch) setTo(k, detent(c, valueAt(row, c, e)));
  const move = m => {
    if (m.pointerId !== e.pointerId) return;
    if (!moved) {
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if (Math.hypot(dx, dy) < (touch ? 8 : 3)) return;
      if (touch && Math.abs(dy) > Math.abs(dx)) return end();
      moved = true;
      row.setPointerCapture(e.pointerId);
      row.classList.add('is-drag');
      root.classList.add('is-scrubbing');
    }
    const t = performance.now();
    samples.push([t, m.clientX]);
    while (samples.length > 2 && t - samples[0][0] > 120) samples.shift();
    f = fine(m, y0);
    if (abs) setTo(k, detent(c, valueAt(row, c, m)));
    else {
      raw = clamp(c, raw + (m.clientX - lastX) * f * (c.max - c.min) / TUNE.dragpx);
      setTo(k, detent(c, raw));
    }
    lastX = m.clientX;
  };
  const up = u => {
    if (u.pointerId !== e.pointerId) return;
    end();
    if (u.type === 'pointercancel') return;
    if (!moved) { if (abs && touch) setTo(k, valueAt(row, c, u)); return; }
    dragged = true;
    setTimeout(() => { dragged = false; });
    // The release speed, from the last tenth of a second.
    const t = performance.now(), q = samples.filter(s => t - s[0] <= 100);
    if (q.length < 2 || t - q.at(-1)[0] > 60) return;
    const vpx = (q.at(-1)[1] - q[0][1]) / Math.max(12, q.at(-1)[0] - q[0][0]);
    coast(k, vpx, abs ? (c.max - c.min) / trackOf(row).getBoundingClientRect().width : (c.max - c.min) / TUNE.dragpx * f);
  };
  const end = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    row.classList.remove('is-drag');
    root.classList.remove('is-scrubbing');
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
});

// The arrow keys step, ⇧ by ten; Home and End go to the ends; ⌫ resets.
document.addEventListener('keydown', e => {
  const row = e.target.matches?.('.row.range[data-kind]') && drawnRow(e.target);
  if (!row || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = row.dataset.row, c = CONTROLS[k], n = e.shiftKey ? 10 : 1;
  const to = { ArrowRight: cur(k) + n * c.step, ArrowUp: cur(k) + n * c.step, ArrowLeft: cur(k) - n * c.step, ArrowDown: cur(k) - n * c.step,
    PageUp: cur(k) + 10 * c.step, PageDown: cur(k) - 10 * c.step, Home: c.min, End: c.max }[e.key];
  if (e.key === 'Backspace' || e.key === 'Delete') reset(k);
  else if (e.key === 'Enter' && ui.typing === 'value') edit(row);
  else if (to === undefined) return;
  else setTo(k, to);
  e.preventDefault();
  halt();
});

// A sideways scroll, or ⇧ and the wheel, sets the value, on the browser's sliders
// too; the vertical wheel is the panel's. A scroll that started on the panel keeps
// scrolling it.
const WG = { t: 0, page: false };
let wheelAt = null;
document.addEventListener('wheel', e => {
  const row = e.target.closest?.('.row.range[data-kind]'), t = performance.now();
  if (!row || e.ctrlKey || row.classList.contains('split') || (t - WG.t < 180 && WG.page)) return;
  const k = row.dataset.row, c = CONTROLS[k], unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 360 : 1;
  let dx = e.deltaX * unit, dy = e.deltaY * unit;
  if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
  if (Math.abs(dx) <= Math.abs(dy)) return;
  const use = -dx;
  e.preventDefault();
  halt();
  // A wheel's notch (with ⇧) is a step, or a fiftieth of a long range; a trackpad moves as a drag.
  const notch = e.deltaMode === 1 || ((e.deltaX === 0 || e.deltaY === 0) && Math.abs(e.deltaX + e.deltaY) >= 50 && Number.isInteger(e.deltaX) && Number.isInteger(e.deltaY));
  if (notch) { setTo(k, cur(k) + Math.sign(use) * (steps(c) <= 50 ? c.step : (c.max - c.min) * .02)); wheelAt = null; return; }
  if (wheelAt?.k !== k || Math.abs(wheelAt.v - cur(k)) > c.step) wheelAt = { k, v: cur(k) };
  wheelAt.v = clamp(c, wheelAt.v + use * (c.max - c.min) / TUNE.dragpx);
  setTo(k, wheelAt.v);
}, { passive: false });
addEventListener('wheel', e => { WG.t = performance.now(); WG.page = !e.defaultPrevented; }, { passive: true });

// Typing: click a value to type one, Enter to set it, Esc to leave it. The click
// waits out a double-click, which resets instead.
let editSoon = 0, lastClick = null;
document.addEventListener('click', e => {
  const o = e.target.closest?.('.row.range output');
  clearTimeout(editSoon);
  if (!o || ui.typing !== 'value' || dragged || o.closest('.split')) return;
  const t = performance.now();
  if (lastClick?.o === o && t - lastClick.t < 350) { lastClick = null; return; }
  lastClick = { o, t };
  editSoon = setTimeout(() => edit(o.closest('.row')), 320);
});
function edit(row) {
  const k = row.dataset.row, o = row.querySelector('output');
  if (row.querySelector('.ed')) return;
  const ed = Object.assign(document.createElement('input'), { className: 'ed num', value: String(cur(k)), inputMode: 'decimal', spellcheck: false, autocomplete: 'off' });
  ed.setAttribute('aria-label', CONTROLS[k].label);
  ed.style.width = Math.max(4, ed.value.length + 1) + 'ch';
  o.hidden = true;
  o.after(ed);
  ed.focus();
  ed.select();
  let done = false;
  const close = ok => {
    if (done) return;
    done = true;
    const v = parseFloat(ed.value.replace(',', '.').replace(/[−–]/g, '-'));
    ed.remove();
    o.hidden = false;
    if (ok && Number.isFinite(v)) setTo(k, v);
  };
  ed.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      close(e.key === 'Enter');
      if (row.role === 'slider') row.focus({ preventScroll: true });
    }
  });
  ed.addEventListener('blur', () => close(true));
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !(ui.read || ui.focus) || e.target.matches?.('[data-name]')) return;
  if (ui.read) ui.read = false; else ui.focus = false;
  apply();
});

/* ---------------------------------------------------------------------------
   Canvas. The unjustified column comes first; comparing adds the browser's
   column to its right, so the text you're looking at never moves. Behind the
   unjustified one, hidden, the browser sets the same text its own way: the
   composer reads its width and its lines (the baseline), as the home page reads
   its column A.
   --------------------------------------------------------------------------- */
const colHTML = (col, name) => `<section class="col" data-col="${col}"><div class="col-head"><span data-name="${col}">${name}</span><span class="m num"><span data-m="${col}.lines">–</span> ln · Σ <span data-m="${col}.dev">–</span> · short <span data-m="${col}.short">–</span></span></div><div class="ruler" aria-hidden="true"></div><div class="frame"><div class="text" data-col="${col}" contenteditable="true" spellcheck="false"></div>${col === 'u' ? '<div class="text ghost" data-col="g" aria-hidden="true"></div>' : ''}<div class="handle" title="Drag to set the width. Double-click for auto."><span>↔</span></div></div></section>`;

const readingsHTML = () => `<dl class="readings num">${[['Lines', 'lines'], ['Σ', 'dev'], ['Short', 'short'], ['Width', 'width']].map(([l, m]) => `<dt>${l}</dt><dd data-m="u.${m}">–</dd>`).join('')}</dl>`;

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const plainHTML = () => paragraphs.map(p => `<p>${p ? esc(p) : '<br>'}</p>`).join('');
const col = c => document.querySelector(`.text[data-col="${c}"]`);

function loadSample() {
  paragraphs = SAMPLES[state.sample].split('\n\n');
  ui.caption = null;
  for (const el of texts()) el.innerHTML = plainHTML();
}

// Rebuild a column from the source text, keeping the caret where it was. The
// unjustified column waits for its composition, unless you're writing in it.
function renderCol(el) {
  if (el.dataset.col === 'u' && !editing) return;
  const caret = caretGet(el);
  el.innerHTML = plainHTML();
  if (caret) caretSet(el, caret);
}

// The settings as the engine takes them (src/optimizer.ts).
function engineSettings() {
  const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
  const indent = ui.unit === '%' ? state.indentPct / 100 * col('g').getBoundingClientRect().width : Math.min(state.indent, indentCap) * chPx();
  const s = {
    fontSize: state.size * rem, letterSpacing: state.ls,
    trackingMin: state.trackMin, trackingMax: state.trackMax,
    rag: state.rag / 100, minEnding: state.ending / 100, sync: state.sync / 100, firmness: state.firmness / 100,
    wordSpacingMin: -state.shrink / 100, wordSpacingMax: state.stretch / 100,
    kashida: state.kashida ? state.kaLine : 0, kashidaFrequency: state.kaFreq / 100,
    kashidaOptions: { sites: [state.kaSeen, state.kaHeh, state.kaAlef, state.kaAny].reduce((m, on, i) => m | (on ? 1 << i : 0), 0),
      minLetters: state.kaMin, perWord: state.kaWord },
    widthFlex: widthRange(typeface()) ? state.widthFlex / 100 : 0,
    protectEndings: state.protect,
    indent, indentParagraphs: root.dataset.indent,
  };
  // Nearly justified: the home page's flush edge, with kashida only while it's on.
  if (state.justify) Object.assign(s, justified, { kashida: state.kashida ? justified.kashida : 0 });
  return s;
}

// The last composition on screen, and the trip that brought it.
let composed = null, trip = null, said = '';
const composer = createComposer({
  input: () => ({
    paragraphs, settings: engineSettings(), typeface: typeface(), direction: state.direction.toLowerCase(), native: col('g'),
    hyphen: hyOn() ? { language: HY_LANG[state.hyLang], minWord: state.hyMin, minBefore: state.hyBefore, minAfter: state.hyAfter, frequency: state.hyFreq } : undefined,
  }),
  render(c) {
    // The composer loads the fonts, so the first composition can be the first
    // time the face's ch is known: lay out again, and recompose if it moved.
    if (layout()) return scheduleRender();
    const { request, result, baseline } = c;
    // Typing outran this one: the next composition has the text as it is now.
    if (request.paragraphs.join('\n') !== paragraphs.join('\n')) return;
    const u = col('u'), caret = editing && document.activeElement === u ? caretGet(u) : null;
    // Writing, the composition waits a keystroke while it would take something
    // you just typed away: the space after a word (it sets a paragraph's words
    // with single spaces between them), or mid-word in an input method.
    const here = caret && paragraphs[caret.p];
    if (caret && (ime || here !== normalizeText(here))) return;
    renderOptimized(u, result.paragraphs, request.paragraphs, baseline, {
      direction: request.direction, inspection: state.inspect, onInspect: inspect, highlightMoves: state.moved,
      letterSpacing: request.settings.letterSpacing, hyphenation: request.settings.hyphenation, kashida: request.settings.kashidaOptions,
      indents: request.paragraphs.map((_, i) => paragraphSettings(request.settings, i).indent ?? 0),
    });
    // An empty paragraph keeps a line, for the caret to go to.
    request.paragraphs.forEach((text, i) => { if (!text.trim()) u.children[i].outerHTML = '<p><br></p>'; });
    if (caret) caretSet(u, caret);
    composed = c;
    said = '';
    readings();
    status();
    // Writing, the text holds still: it grows downwards instead of re-centring.
    if (!typing && !editing) centre();
    root.dataset.composed = '';
  },
  status(words, error) {
    busy(!error);
    if (!error) return;
    said = words;
    // The browser's text stays, shown rather than nothing.
    root.dataset.composed = '';
    status();
  },
  timed(timing, c) {
    busy(false);
    trip = timing;
    publishTiming(timing);
    underTheHood(timing, c);
    status();
  },
});

let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    composer.schedule();
    readings();
    status();
    if (!typing) centre();
    typing = false;
  });
}

// Lines, Σ (the spread of body-line ends) and short endings, as the home page
// counts them (metrics in src/optimizer.ts): the composition's, and the browser's
// when it's beside it.
function readings() {
  const show = (c, m) => {
    for (const [key, val] of Object.entries({ lines: m ? String(m.lines) : '–', dev: m ? (m.deviation * 100).toFixed(1) + '%' : '–', short: m ? String(m.shortEndings) : '–' })) {
      for (const out of document.querySelectorAll(`[data-m="${c}.${key}"]`)) out.textContent = val;
    }
  };
  if (!composed) return;
  const s = { ...composed.request.settings, width: composed.width };
  show('u', metrics(composed.result.paragraphs, s));
  const b = col('b');
  show('b', ui.compare && b.offsetParent ? metrics(readNativeLayout(b, b.getBoundingClientRect().width, s), s) : null);
}

/* ---------------------------------------------------------------------------
   Vertical balance. The block sits in the middle of the canvas, or at the top
   once it's taller. Set from JS, not CSS centring, so it holds still while you
   type: a new line grows the text downwards instead of nudging it all up.
   --------------------------------------------------------------------------- */
let typing = false;
function centre() {
  const main = document.querySelector('#canvas'), stage = document.querySelector('.stage');
  stage.style.marginTop = Math.max(0, (main.clientHeight - stage.offsetHeight) / 2) + 'px';
}

/* The column's label and the status bar. Each says something the panel and
   the other don't: the label names the block, the status bar counts it and
   times it. The time is the whole trip, from the change to the next paint; it
   opens the timings. Inspecting, the line under the pointer takes the counts'
   place. */
// The right side is built once and its numbers change in place: each in a
// tabular slot wide enough for it, so nothing beside it moves. The tatweels slide
// open and shut; the time dims while a composition is on its way.
const SETUP = `<span>≈ <span class="v num" data-st="chars">–</span> characters a line</span>`
  + `<span class="st-fold" data-st-fold="tw"><span class="st-in"><span class="sep">·</span><span class="v num" data-st="tw">0</span> tatweels</span></span>`
  + `<span class="sep">·</span><button class="trip" data-timings aria-pressed="false" title="The whole trip, from the change to the next paint. Click for the timings."><span class="v num" data-st="trip">—</span> ms</button>`;
const busy = on => document.querySelector('[data-timings]')?.classList.toggle('busy', on);
const put = (key, text) => { const el = document.querySelector(`[data-st="${key}"]`); if (el && el.textContent !== text) el.textContent = text; };
let inspected = '';
function status() {
  const text = paragraphs.join(' ');
  const wordCount = (text.match(/\S+/g) ?? []).length;
  const join = parts => parts.filter(Boolean).join('<span class="sep">·</span>');
  const count = state.inspect && inspected ? inspected
    : join([`${paragraphs.length} ¶`, !hasJapanese() && `${wordCount} words`, `${text.replace(/\s/g, '').length} characters`]);
  const left = document.querySelector('[data-status="count"]');
  if (left.innerHTML !== count) left.innerHTML = count;
  const setup = document.querySelector('[data-status="setup"]');
  if (!setup.firstChild) setup.innerHTML = SETUP;
  const lines = composed?.result.paragraphs.flatMap(p => p.lines) ?? [];
  const tatweels = lines.reduce((n, l) => n + l.kashida, 0);
  put('chars', lines.length ? String(Math.round(text.length / lines.length)) : '–');
  // Shutting, the count keeps its last number until it's out of sight.
  if (tatweels) put('tw', String(tatweels));
  setup.querySelector('[data-st-fold="tw"]').classList.toggle('on', tatweels > 0);
  put('trip', said ? '!' : trip ? String(Math.round(trip.totalMs)) : '—');
  const button = setup.querySelector('[data-timings]');
  button.title = said || 'The whole trip, from the change to the next paint. Click for the timings.';
  button.setAttribute('aria-pressed', timingsOpen);
  // Alone, the header already says unjustified, so the label names the block in
  // other ways. Comparing, the columns need their names.
  const label = ui.compare ? 'Unjustified' : {
    Spec: `${+state.size.toFixed(2)}/${+(state.size * state.lh).toFixed(2)} rem ${FACE[typeface()] ?? state.typeface}`,
    Block: `${measureNow} ch × ${lines.length} ln`,
    Figure: ui.caption ?? `Fig. 1 · ${state.sample}`,
    Sample: state.sample,
    None: '',
  }[state.label];
  // The figure caption is yours to write, like the text. Left alone while you type.
  const own = !ui.compare && state.label === 'Figure';
  for (const el of document.querySelectorAll('[data-name="u"]')) {
    el.contentEditable = own ? 'plaintext-only' : 'false';
    el.title = own ? 'Click to write your own caption' : '';
    if (el !== document.activeElement && el.textContent !== label) el.textContent = label;
  }
  for (const el of document.querySelectorAll('[data-name="b"]')) el.textContent = `Native browser · ${ui.vs}`;
}

// Inspect lines: what the composer did to the line under the pointer, as the
// home page's inspector says it.
function inspect(p, l) {
  const line = composed?.result.paragraphs[p]?.lines[l];
  if (!state.inspect || !line) return;
  for (const el of col('u').querySelectorAll('.inspected')) el.classList.remove('inspected');
  col('u').querySelector(`[data-paragraph="${p}"][data-line="${l}"]`)?.classList.add('inspected');
  const sign = n => (n < 0 ? '−' : '+') + Math.abs(n);
  inspected = [`¶ ${p + 1} · line ${l + 1}`, `${Math.round(line.width)} of ${Math.round(composed.width)} px`, `${(line.fill * 100).toFixed(1)}%`,
    `tracking ${sign(+line.tracking.toFixed(4))} em`, line.wordSpacing && `words ${sign(+line.wordSpacing.toFixed(3))} em`,
    line.kashida && `${line.kashida} tatweel${line.kashida > 1 ? 's' : ''}`, line.stretch !== 100 && `width ${line.stretch}%`, line.hyphen && 'hyphen']
    .filter(Boolean).join('<span class="sep">·</span>');
  status();
}

// Under the hood, as the home page's: the search, the model and the edge.
function underTheHood(timing, { request, result, baseline, width, response }) {
  const s = { ...request.settings, width };
  const before = metrics(baseline, s), after = metrics(result.paragraphs, s);
  const row = ([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`;
  document.querySelector('#performance-details').innerHTML = [
    ['Worker compute, with its fonts', `${response.elapsed.toFixed(1)} ms${response.here ? ' (main thread)' : ''}`],
    ['New canvas measurements', response.measurements.toLocaleString()],
    ['Paths scored / candidates kept', `${result.explored.toLocaleString()} / ${result.candidates}`],
    ['Search', s.sync === 0 ? 'Independent' : request.paragraphs.length <= 3 ? 'Joint enumeration' : '128-state document beam'],
    ['Model cost, browser → composed', `${before.cost.toFixed(2)} → ${after.cost.toFixed(2)}`],
    ['Measure / window', `${Math.round(width)} / ${innerWidth} px`],
  ].map(row).join('');
  document.querySelector('[data-edge-stats]').innerHTML = [
    ['Σ, the spread of line ends', `${(before.deviation * 100).toFixed(1)}% → ${(after.deviation * 100).toFixed(1)}%`],
    ['Short endings', `${before.shortEndings} → ${after.shortEndings}`],
    ['Most tracking on a line', `±${after.maxTracking.toFixed(4)} em`],
    ['Lines', `${before.lines} → ${after.lines}`],
  ].map(row).join('');
}

/* ---------------------------------------------------------------------------
   Editing. Both columns are always editable and share one source text. A
   column is rebuilt while you type only when it has to be: the browser left
   loose text or divs in it. The unjustified column recomposes as you write.
   --------------------------------------------------------------------------- */
// The text as written: no tatweels (the composer's kashida spans).
function cleanText(n) {
  if (n.nodeType === 3) return n.data;
  const c = n.cloneNode(true);
  for (const k of c.querySelectorAll?.('.kashida') ?? []) k.remove();
  return c.textContent;
}
// Writing in the unjustified column: it recomposes as you type, the caret kept at
// its character.
let editing = false, ime = false;
document.addEventListener('focusin', e => { if (e.target.closest?.('.text[data-col="u"]')) editing = true; });
document.addEventListener('focusout', e => {
  if (!e.target.closest?.('.text[data-col="u"]')) return;
  editing = false;
  scheduleRender();
});
document.addEventListener('compositionstart', () => { ime = true; });

// Its own undo. Each keystroke rebuilds the column, which leaves the browser's
// undo with nothing to go back to, so it keeps the text and the caret before each
// burst of typing (a pause starts the next), and before each paste.
const history = { undo: [], redo: [], last: 0 };
function remember(u, own = false) {
  const t = performance.now();
  if (own || t - history.last > 600) {
    history.undo.push({ paragraphs: [...paragraphs], caret: caretGet(u) });
    if (history.undo.length > 200) history.undo.shift();
    history.redo.length = 0;
  }
  history.last = t;
}
function travel(u, back) {
  const [from, to] = back ? [history.undo, history.redo] : [history.redo, history.undo];
  const step = from.pop();
  if (!step) return;
  to.push({ paragraphs: [...paragraphs], caret: caretGet(u) });
  paragraphs = step.paragraphs;
  for (const el of texts()) el.innerHTML = plainHTML();
  if (step.caret) caretSet(u, step.caret);
  history.last = 0;
  apply();
}
const unjustified = e => e.target.closest?.('.text[data-col="u"]');
const MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
// ⌘Z and ⇧⌘Z (Ctrl elsewhere), and Edit › Undo from the menu.
document.addEventListener('keydown', e => {
  const u = unjustified(e);
  if (!u || !(MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.code !== 'KeyZ') return;
  e.preventDefault();
  travel(u, !e.shiftKey);
});
document.addEventListener('beforeinput', e => {
  const u = unjustified(e);
  if (!u) return;
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    e.preventDefault();
    return travel(u, e.inputType === 'historyUndo');
  }
  remember(u);
});
function readParagraphs(node) {
  const out = [];
  let loose = null;
  for (const n of node.childNodes) {
    if (n.nodeName === 'P' || n.nodeName === 'DIV') {
      if (loose !== null) out.push(loose);
      loose = null;
      out.push(cleanText(n));
    } else if (n.nodeName === 'BR') {
      if (loose !== null) out.push(loose);
      loose = null;
    } else loose = (loose ?? '') + cleanText(n);
  }
  if (loose !== null) out.push(loose);
  return out.length ? out : [''];
}
// The caret as paragraph and offset in the source text, so it survives a rebuild.
function caretGet(el) {
  const s = getSelection();
  if (!s.rangeCount || !el.contains(s.focusNode)) return null;
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(s.focusNode, s.focusOffset);
  const before = readParagraphs(r.cloneContents());
  return { p: before.length - 1, offset: before.at(-1).length };
}
function caretSet(el, { p, offset }) {
  const para = el.children[p] ?? el.lastElementChild;
  if (!para) return;
  const walk = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  let left = offset, node;
  while ((node = walk.nextNode())) {
    if (node.parentNode.closest('.kashida')) continue;
    if (left <= node.length) { getSelection().collapse(node, left); return; }
    left -= node.length;
  }
  getSelection().collapse(para, para.childNodes.length);
}

function syncFrom(t) {
  typing = true;
  paragraphs = readParagraphs(t);
  for (const el of texts()) if (el !== t) renderCol(el);
  if ([...t.childNodes].some(n => n.nodeName !== 'P')) renderCol(t);
  apply();
}
document.addEventListener('input', e => {
  const t = e.target.closest?.('.text');
  if (t && !e.isComposing) syncFrom(t);
});
document.addEventListener('compositionend', e => {
  ime = false;
  const t = e.target.closest?.('.text');
  if (t) syncFrom(t);
});
/* Paste as paragraphs, not lines. Copied text puts a blank line between
   paragraphs, and inserting it line by line made an empty paragraph of each blank
   line. With blank lines, each block is a paragraph and its single breaks become
   spaces; without, each line is one. A single line keeps the browser's own insert,
   and its undo. */
// One line: Enter or Esc finishes it, pasted line breaks become spaces, and an
// emptied caption goes back to the sample's.
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.matches?.('[data-name="u"]')) return;
  if (el.textContent.includes('\n')) el.textContent = el.textContent.replace(/\s*\n\s*/g, ' ');
  ui.caption = el.textContent;
});
document.addEventListener('keydown', e => {
  if (e.target.matches?.('[data-name="u"]') && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('focusout', e => {
  if (!e.target.matches?.('[data-name="u"]')) return;
  if (!e.target.textContent.trim()) ui.caption = null;
  status();
});

document.addEventListener('paste', e => {
  const t = e.target.closest?.('.text');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.col === 'u') remember(t, true);
  const raw = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  const parts = (/\n[ \t]*\n/.test(raw) ? raw.split(/\n[ \t]*\n\s*/).map(p => p.replace(/\n/g, ' ')) : raw.split('\n')).filter(p => p.trim());
  if (parts.length < 2) { document.execCommand('insertText', false, parts[0] ?? ''); return; }
  if (!getSelection().isCollapsed) document.execCommand('delete');
  const at = caretGet(t) ?? { p: 0, offset: 0 };
  const now = readParagraphs(t);
  const line = now[at.p] ?? '';
  const pasted = [line.slice(0, at.offset) + parts[0], ...parts.slice(1)];
  const end = pasted.at(-1).length;
  pasted[pasted.length - 1] += line.slice(at.offset);
  paragraphs = [...now.slice(0, at.p), ...pasted, ...now.slice(at.p + 1)];
  for (const el of texts()) el.innerHTML = plainHTML();
  caretSet(t, { p: at.p + pasted.length - 1, offset: end });
  apply();
});
// Copy and cut give clean text: paragraphs a blank line apart, no inserted tatweels.
for (const type of ['copy', 'cut']) document.addEventListener(type, e => {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed || !e.target.closest?.('.text')) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', readParagraphs(s.getRangeAt(0).cloneContents()).join('\n\n'));
  if (type === 'cut') document.execCommand('delete');
});

/* Width handle › Hover: the handle shows while the pointer is near it: over the
   text's last "Handle zone" share on the handle's side (the end of the line:
   right for Latin, left for Arabic), out to the handle's far edge. Measured from
   the handle itself, so it follows it to whichever column has it. */
function nearHandle(e) {
  for (const frame of document.querySelectorAll('.frame')) {
    const handle = frame.querySelector('.handle').getBoundingClientRect();
    if (!handle.width || !e) { frame.classList.remove('near'); continue; }
    const text = frame.getBoundingClientRect(), zone = text.width * TUNE.hz / 100;
    const rtl = getComputedStyle(frame).direction === 'rtl';
    const [from, to] = rtl ? [handle.left, text.left + zone] : [text.right - zone, handle.right];
    const near = e.clientX >= from && e.clientX <= to
      && e.clientY >= Math.min(text.top, handle.top) && e.clientY <= Math.max(text.bottom, handle.bottom);
    frame.classList.toggle('near', near);
  }
}
document.addEventListener('pointermove', e => { if (root.dataset.handle === 'hover' && e.pointerType === 'mouse') nearHandle(e); }, { passive: true });
root.addEventListener('pointerleave', () => nearHandle());

/* ---------------------------------------------------------------------------
   Width handle. It follows the pointer 1:1 in every layout: how far the handle
   moves per pixel of width depends on the layout (half when centred, negative
   for Arabic, double once two centred columns overflow), so it is measured
   rather than assumed, and each move corrects toward the pointer.
   --------------------------------------------------------------------------- */
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle');
  if (!h || e.button > 0) return;
  e.preventDefault();
  const at = () => { const r = h.getBoundingClientRect(); return r.left + r.width / 2; };
  const grab = e.clientX - at();
  const c0 = at();
  root.style.setProperty('--measure', measureNow + 2 + 'ch');
  let k = (at() - c0) / 2 || 1;
  root.style.setProperty('--measure', measureNow + 'ch');
  h.setPointerCapture(e.pointerId);
  h.classList.add('drag');
  const move = m => {
    for (let i = 0; i < 3; i++) {
      const err = m.clientX - grab - at();
      if (Math.abs(err) < 1) break;
      const before = at(), w = measureNow;
      set('measure', w + err / k);
      if (measureNow === w) break;
      const moved = at() - before;
      if (Math.abs(moved) > .1) k = moved / (measureNow - w);
    }
  };
  const up = () => {
    h.classList.remove('drag');
    h.removeEventListener('pointermove', move);
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up, { once: true });
  h.addEventListener('pointercancel', up, { once: true });
});
document.addEventListener('dblclick', e => {
  if (e.target.closest('.handle')) { ui.auto = true; apply(); }
});

const LAYOUTS = { left: 'Left', centre: 'Centred', gutter: 'Gutter', wide: 'Wide panel' };
// The header switches left and centre in place; the URL follows, so a reload keeps it.
function param(k, v) {
  const q = new URLSearchParams(location.search);
  if (v === '') q.delete(k); else q.set(k, v);
  // The kinds read as size:line,rag:box, not escaped.
  history.replaceState(null, '', '?' + String(q).replace(/%3A/g, ':').replace(/%2C/g, ','));
}
function setLayout(layout) {
  ui.layout = layout;
  root.dataset.layout = layout;
  param('layout', layout);
  document.title = `${LAYOUTS[layout]} · round 3 — unjustified lab`;
  apply();
}
export function start() {
  const asked = new URLSearchParams(location.search).get('layout');
  ui.layout = asked in LAYOUTS ? asked : 'left';
  const q = new URLSearchParams(location.search);
  for (const [, k, list] of PICKS) if (list.includes(q.get(k))) ui[k] = q.get(k);
  for (const k in TUNE) if (Number.isFinite(parseFloat(q.get(k)))) TUNE[k] = parseFloat(q.get(k));
  for (const [k, v] of (q.get('kinds') ?? '').split(',').map(s => s.split(':'))) if (KIND_KEYS.includes(k) && kindsOf(CONTROLS[k]).includes(v)) ui.kinds[k] = v;
  for (const k of (q.get('nors') ?? '').split(',')) if (KIND_KEYS.includes(k)) ui.nors.add(k);
  tuneApply();
  coarse.addEventListener('change', refresh);
  root.dataset.layout = ui.layout;
  document.title = `${LAYOUTS[ui.layout]} · round 3 — unjustified lab`;
  document.querySelector('.stage').innerHTML = readingsHTML() + `<div class="pair">${colHTML('u', 'Unjustified')}${colHTML('b', 'Browser')}</div>`;
  buildPanel();
  buildWin();
  buildTimings();
  bindInspection(col('u'), inspect);
  loadSample();
  apply();
  document.fonts.ready.then(() => { layout(); scheduleRender(); });
  new ResizeObserver(() => { layout(); scheduleRender(); }).observe(document.querySelector('#canvas'));
}
