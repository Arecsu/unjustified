// Round 3 shared state, panel and canvas. CSS stands in for the composer: the
// unjustified column uses text-wrap: pretty, kashida is placed by the rough stand-in
// below, and the metrics are measured from the DOM.
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/roboto-flex';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/noto-sans-jp';

// The app's own samples (src/samples.ts).
const SAMPLES = {
  Editorial: `Typography is the quiet architecture of a page. Before we read a single word, we notice its shape: the texture of a paragraph, the space around a thought, the gentle rhythm of one line giving way to the next.

A straight right edge is not the only way to find balance. Left to their own devices, words can leave awkward gaps and lonely endings. A little consideration lets them settle into something more deliberate, without losing their natural character.

The best adjustments are often the ones we never notice. A word moves up, another moves down, and the smallest change in spacing makes room for a better ending. Not perfectly aligned. Just a little more at ease.`,
  Literature: `There was no hurry that afternoon. The light had settled on the table as if it meant to stay, and beyond the window the garden moved in the small, unremarkable ways that a garden moves when nobody is watching.

She opened the book where she had left it. A pressed leaf marked the place, its veins as fine as the streets on an old map. For a moment she could not remember the story, only the weather on the day she had begun it.

Some things ask to be read slowly. Not because they are difficult, but because they leave a little space around themselves. You come to the end of a sentence and find that you have been thinking of somewhere else entirely.`,
  Arabic: `للكلمات إيقاع هادئ يبدأ قبل أن نقرأ معناها. نرى شكل الفقرة والمسافات التي تحيط بها، ثم تنتقل العين من سطر إلى آخر. وحين تتوازن هذه التفاصيل الصغيرة تصبح القراءة أكثر راحة ووضوحا.

ليس من الضروري أن تنتهي جميع السطور عند الحافة نفسها. يمكن أن نحافظ على اتصال الحروف وطبيعة الكلمات، ونختار مواضع أفضل للانتقال إلى السطر التالي. عندها يبدو النص منظما من غير أن يفقد حريته.

أفضل التعديلات هي التي لا تلفت الانتباه. تنتقل كلمة إلى السطر السابق، وتجد كلمة أخرى مكانها في السطر التالي، وتبقى نهاية الفقرة واضحة ومريحة. الهدف ليس شكلا مثاليا، بل تجربة قراءة أكثر هدوءا.`,
  Japanese: `文字を読む前に、私たちは文章のかたちを見ています。行の長さや余白、段落の間に生まれる静かなリズム。それらは目立たないところで、読む時間の心地よさを支えています。

すべての行を同じ長さにそろえる必要はありません。言葉のまとまりを大切にしながら、次の行への移り方を少しだけ工夫する。それだけで、文章の表情は驚くほど穏やかになります。

よい調整ほど、読んでいるときには気づかないものです。「ここでひと息つこう」と思える余白があり、短すぎる結びが残らない。文字と文字の間に、自然な呼吸が生まれます。`,
  Difficult: `Small words can make surprisingly large problems. A line that ends with a tiny isolated word can disturb the balance of an otherwise comfortable paragraph. The solution is not necessarily to stretch every line until it reaches the edge.

Counterintuitively, the best arrangement may require an earlier line to become shorter. Paragraph composition looks ahead, trying several possible breaks before choosing where each word belongs. It is a small optimization problem with a very visible result.

Supercalifragilisticexpialidocious is deliberately included here to test the limits. An unbreakable word wider than the measure cannot be fixed without breaking a constraint. This experiment preserves the word, reports the overflow, and lets you decide what to change.`,
};

// Arabic and Japanese fall back to the app's faces whatever the Latin typeface is.
const FALLBACK = "'Noto Sans Arabic Variable', 'Noto Sans JP Variable'";
const FONTS = {
  'Source Serif 4': `'Source Serif 4 Variable', ${FALLBACK}, Georgia, serif`,
  Inter: `InterVariable, ${FALLBACK}, sans-serif`,
  'DM Sans': `'DM Sans Variable', ${FALLBACK}, sans-serif`,
  'Roboto Flex': `'Roboto Flex Variable', ${FALLBACK}, sans-serif`,
};

const ARABIC = /[؀-ۿ]/;
const JAPANESE = /[぀-ヿ一-鿿]/;
let paragraphs = SAMPLES.Editorial.split('\n\n');
const hasArabic = () => ARABIC.test(paragraphs.join(''));
const hasJapanese = () => JAPANESE.test(paragraphs.join(''));

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

const GROUPS = [
  { id: 'text', label: 'Text', controls: [
    select('sample', 'Sample', Object.keys(SAMPLES)),
    select('direction', 'Direction', ['Auto', 'LTR', 'RTL'], { adv }),
  ] },
  { id: 'type', label: 'Type', controls: [
    select('typeface', 'Typeface', Object.keys(FONTS)),
    range('size', 'Size', 0.75, 4.5, 0.05, 1.2, 'rem'),
    range('measure', 'Width', 15, 150, 1, 40, 'ch', { auto: true }),
    range('indent', 'Indent', 0, 80, 1, 0, 'ch'),
    select('indentAt', 'Indented', ['Every paragraph', 'First only', 'All but first'], { adv, dep: () => state.indent > 0 }),
    range('lh', 'Line height', 0.9, 2, 0.05, 1.55, '', { adv }),
    range('ls', 'Letter spacing', -0.05, 0.1, 0.005, 0, 'em', { adv }),
    range('maxw', 'Auto up to', 30, 120, 1, 70, 'ch', { adv, dep: () => ui.auto }),
  ] },
  { id: 'edge', label: 'Edge', controls: [
    range('rag', 'Rag', 0, 18, 0.5, 5.5, '%'),
    range('ending', 'Last line', 15, 60, 1, 32, '%'),
    toggle('justify', 'Nearly justified'),
    range('firmness', 'Firmness', 0, 100, 5, 0, '%', { adv }),
    range('sync', 'Harmony', 0, 100, 5, 65, '%', { adv }),
    toggle('protect', 'Protect short endings', true, { adv }),
  ] },
  { id: 'space', label: 'Spacing', controls: [
    range('track', 'Tracking', 0, 0.03, 0.001, 0.012, 'em', { pair: ['trackMin', 'trackMax'] }),
    range('trackMin', 'Shrink', -0.03, 0, 0.001, -0.012, 'em', { of: 'track' }),
    range('trackMax', 'Stretch', 0, 0.03, 0.001, 0.012, 'em', { of: 'track', plus: true }),
    range('space', 'Word spacing', 0, 1000, 10, 200, '%', { pair: ['shrink', 'stretch'] }),
    range('shrink', 'Shrink', 0, 50, 5, 20, '%', { of: 'space', neg: true }),
    range('stretch', 'Stretch', 0, 1000, 10, 200, '%', { of: 'space', plus: true }),
    range('widthFlex', 'Width flex', 0, 40, 1, 0, '%', { adv }),
  ] },
  { id: 'hyph', label: 'Hyphens', controls: [
    toggle('hyphenate', 'Hyphenate'),
    select('hyLang', 'Language', ['English US', 'English UK', 'Español', 'Deutsch', 'Français'], { dep: hyOn }),
    range('hyFreq', 'Frequency', 0, 100, 5, 50, '%', { adv, dep: hyOn }),
    range('hyMin', 'Shortest word', 4, 12, 1, 6, '', { adv, dep: hyOn }),
    range('hyBefore', 'Letters before', 1, 5, 1, 2, '', { adv, dep: hyOn }),
    range('hyAfter', 'Letters after', 2, 6, 1, 3, '', { adv, dep: hyOn }),
  ] },
  { id: 'kash', label: 'Kashida', controls: [
    toggle('kashida', 'Kashida'),
    range('kaLine', 'Per line', 1, 4, 1, 2, '', { dep: kaOn }),
    range('kaFreq', 'Frequency', 0, 100, 5, 50, '%', { adv, dep: kaOn }),
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
    select('ruler', 'Ruler', ['Hairline', 'Dimension', 'Ticks', 'None']),
    select('label', 'Label', ['Spec', 'Block', 'Figure', 'Sample', 'None'], { show: () => !ui.compare }),
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
const ui = { auto: true, linked: { track: true, space: true }, ratio: { ...RATIO }, open: new Set(), compare: false, read: false, focus: false, layout: 'left', vs: 'ragged', peek: null };
// The width the text is set at: the slider's value, or the auto width.
let measureNow = state.measure;

function format(k) {
  const c = CONTROLS[k], v = state[k];
  if (c.type === 'toggle') return v ? 'on' : 'off';
  if (c.type === 'select') return v;
  if (k === 'measure') return measureNow + ' ch';
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
}

const root = document.documentElement;
const texts = () => document.querySelectorAll('.text');
function apply() {
  const s = root.style;
  s.setProperty('--size', state.size + 'rem');
  s.setProperty('--lh', state.lh);
  s.setProperty('--ls', state.ls + 'em');
  s.setProperty('--font', FONTS[state.typeface]);
  s.setProperty('--hyphens', hyOn() ? 'auto' : 'manual');
  s.setProperty('--rag', state.rag);
  s.setProperty('--indent', state.indent + 'ch');
  root.dataset.indent = { 'Every paragraph': 'all', 'First only': 'first', 'All but first': 'rest' }[state.indentAt];
  for (const [cls, on] of [['justify-u', state.justify], ['justify-b', (ui.peek ?? ui.vs) === 'justified'], ['guides', state.guides], ['diag', state.diag], ['tw-marks', state.twMarks], ['numbers', state.numbers]]) root.classList.toggle(cls, on);
  root.toggleAttribute('data-compare', ui.compare);
  root.toggleAttribute('data-read', ui.read);
  root.toggleAttribute('data-focus', ui.focus);
  root.toggleAttribute('data-peeking', !!ui.peek);
  root.dataset.ruler = state.ruler.toLowerCase();
  const rtl = state.direction === 'RTL' || (state.direction === 'Auto' && hasArabic());
  root.classList.toggle('rtl', rtl);
  // Arabic mirrors the whole canvas: columns anchor on the right, the gutter too.
  document.querySelector('.stage').dir = rtl ? 'rtl' : 'ltr';
  for (const t of texts()) {
    t.dir = rtl ? 'rtl' : 'ltr';
    t.lang = hasArabic() ? 'ar' : hasJapanese() ? 'ja' : 'en';
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
function layout() {
  const pair = document.querySelector('.pair');
  if (!pair) return;
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
  root.style.setProperty('--measure', w + 'ch');
  root.style.setProperty('--measure-px', w * ch + 'px');
  for (const el of document.querySelectorAll('[data-m="width"]')) el.textContent = w + ' ch';
  for (const el of document.querySelectorAll('[data-m="u.width"]')) el.textContent = (ui.auto ? 'auto ' : '') + w + ' ch';
}

/* ---------------------------------------------------------------------------
   Panel.
   --------------------------------------------------------------------------- */
function rowHTML(c) {
  const cls = `row ${c.type}${c.of ? ' sub' : ''}`;
  const row = `data-row="${c.k}"`;
  if (c.type === 'note') return `<div class="${cls}" ${row}><span class="sub">${c.label}</span></div>`;
  if (c.type === 'toggle') return `<label class="${cls}" ${row}><span class="lbl">${c.label}</span><input type="checkbox" data-k="${c.k}" ${state[c.k] ? 'checked' : ''} aria-label="${c.aria ?? c.label}"></label>`;
  if (c.type === 'select') return `<div class="${cls}" ${row}><label class="lbl" for="in-${c.k}">${c.label}</label><span></span><span class="sel"><select id="in-${c.k}" data-k="${c.k}">${c.options.map(o => `<option${o === state[c.k] ? ' selected' : ''}>${o}</option>`).join('')}</select></span></div>`;
  // Specimen T-04: struck through when off.
  const strike = (attr, on, word, title) => `<button class="opt sk" ${attr} aria-pressed="${on}" title="${title}"><span class="base">${word}</span><span class="over" aria-hidden="true">${word}</span></button>`;
  const opt = c.pair ? strike(`data-linked="${c.k}"`, true, 'linked', 'One slider moves both sides')
    : c.auto ? strike('data-auto', true, 'auto', 'Follow the window') : '';
  return `<div class="${cls}" ${row}><span class="lbl"><label for="in-${c.k}">${c.label}</label>${opt}</span><span class="out"><output class="num" data-v="${c.k}">${format(c.k)}</output></span><input type="range" id="in-${c.k}" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${state[c.k]}" title="Double-click to reset"${c.auto ? '' : ` style="--d:${(DEFAULTS[c.k] - c.min) / (c.max - c.min)}"`}></div>`;
}

function buildPanel() {
  document.querySelector('.groups').innerHTML = GROUPS.map(g => `<section class="group" data-g="${g.id}" aria-labelledby="g-${g.id}"><h2 id="g-${g.id}">${g.label}</h2><div class="rows">${g.controls.map(rowHTML).join('')}<p class="gnote" data-note="${g.id}" hidden></p><button class="more hl" data-more="${g.id}"></button></div></section>`).join('')
    + '<div class="foot"><button class="hl" data-reset-all>reset all ↺</button></div>';
  document.querySelector('.tabs').innerHTML = GROUPS.map(g => `<button role="tab" data-tab="${g.id}" aria-selected="false">${g.label}</button>`).join('');
}

const NOTES = {
  hyph: () => hasArabic() || hasJapanese() ? 'Arabic and Japanese are not hyphenated: kashida and tracking do that work.' : '',
  kash: () => hasArabic() ? '' : 'Kashida applies to Arabic text only. <button class="hl" data-try="Arabic">Arabic sample ⟶</button>',
};

function refresh() {
  for (const c of Object.values(CONTROLS)) {
    const row = document.querySelector(`[data-row="${c.k}"]`);
    if (!row) continue;
    row.hidden = (c.adv && !ui.open.has(c.g)) || (c.show && !c.show()) || (c.of && ui.linked[c.of]);
    // Split, a pair keeps its row as the heading of its two sides, so nothing moves.
    if (c.pair) row.classList.toggle('split', !ui.linked[c.k]);
    if (c.auto) row.classList.toggle('is-auto', ui.auto);
    row.classList.toggle('dim', !!c.dep && !c.dep());
  }
  for (const g of GROUPS) {
    const more = document.querySelector(`[data-more="${g.id}"]`);
    const extra = g.controls.filter(c => c.adv && c.type !== 'note' && !(c.show && !c.show()));
    const touched = extra.filter(c => changed(c.k)).length;
    more.hidden = !extra.length;
    more.textContent = ui.open.has(g.id) ? 'fewer ↑' : `${extra.length} more ↓${touched ? ` · ${touched} set` : ''}`;
    const n = document.querySelector(`[data-note="${g.id}"]`);
    const html = NOTES[g.id]?.() ?? '';
    n.hidden = !html;
    if (n.innerHTML !== html) n.innerHTML = html;
  }
  for (const b of document.querySelectorAll('[data-auto]')) b.setAttribute('aria-pressed', ui.auto);
  for (const b of document.querySelectorAll('[data-compare]')) b.setAttribute('aria-pressed', ui.compare);
  for (const b of document.querySelectorAll('[data-focus]')) b.setAttribute('aria-pressed', ui.focus);
  for (const b of document.querySelectorAll('[data-peek]')) b.setAttribute('aria-pressed', b.dataset.peek === ui.vs);
  for (const b of document.querySelectorAll('[data-linked]')) b.setAttribute('aria-pressed', ui.linked[b.dataset.linked]);
  for (const b of document.querySelectorAll('[data-layout-set]')) b.setAttribute('aria-pressed', b.dataset.layoutSet === ui.layout);
}

document.addEventListener('input', e => {
  const k = e.target.dataset?.k;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
  // Sliders snap to their default when dragged close to it.
  const c = CONTROLS[k];
  if (c.type === 'range' && !c.auto && Math.abs(v - DEFAULTS[k]) <= (c.max - c.min) * .015) v = DEFAULTS[k];
  set(k, v);
});

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
    ui.linked[key] = on;
    apply();
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
  else if ('read' in d) { ui.read = !ui.read; apply(); }
  else if ('focus' in d) { ui.focus = !ui.focus; apply(); }
  else if ('layoutSet' in d) setLayout(d.layoutSet);
  else if ('tab' in d) {
    const open = t.getAttribute('aria-selected') !== 'true';
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', open && b === t);
    for (const g of document.querySelectorAll('.group')) g.classList.toggle('on', open && g.dataset.g === d.tab);
  }
});
/* Hold ragged or justified: the browser's own text takes your column's place
   until you let go. Pressing also picks what side by side compares against.
   Space or Enter on the button holds it from the keyboard. */
function peek(b, start) {
  ui.vs = b.dataset.peek;
  ui.peek = start && !ui.compare ? ui.vs : null;
  apply();
}
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-peek]');
  if (!b || e.button > 0) return;
  e.preventDefault();
  b.setPointerCapture(e.pointerId);
  peek(b, true);
  const end = () => peek(b, false);
  b.addEventListener('pointerup', end, { once: true });
  b.addEventListener('pointercancel', end, { once: true });
});
document.addEventListener('keydown', e => {
  const b = e.target.closest?.('[data-peek]');
  if (b && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) peek(b, true); }
});
document.addEventListener('keyup', e => {
  const b = e.target.closest?.('[data-peek]');
  if (b && (e.key === ' ' || e.key === 'Enter')) peek(b, false);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !(ui.read || ui.focus)) return;
  if (ui.read) ui.read = false; else ui.focus = false;
  apply();
});

/* ---------------------------------------------------------------------------
   Canvas. The unjustified column comes first; comparing adds the browser's
   column to its right, so the text you're looking at never moves.
   --------------------------------------------------------------------------- */
const colHTML = (col, name) => `<section class="col" data-col="${col}"><div class="col-head"><span data-name="${col}">${name}</span><span class="m num"><span data-m="${col}.lines">–</span> ln · Σ <span data-m="${col}.dev">–</span> · short <span data-m="${col}.short">–</span></span></div><div class="ruler" aria-hidden="true"><span class="w num" data-m="width"></span></div><div class="frame"><div class="text" data-col="${col}" contenteditable="true" spellcheck="false"></div><div class="handle" title="Drag to set the width. Double-click for auto."><span>↔</span></div></div></section>`;

const readingsHTML = () => `<dl class="readings num">${[['Lines', 'lines'], ['Σ', 'dev'], ['Short', 'short'], ['Width', 'width']].map(([l, m]) => `<dt>${l}</dt><dd data-m="u.${m}">–</dd>`).join('')}</dl>`;

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const plainHTML = () => paragraphs.map(p => `<p>${p ? esc(p) : '<br>'}</p>`).join('');

function loadSample() {
  paragraphs = SAMPLES[state.sample].split('\n\n');
  for (const el of texts()) el.innerHTML = plainHTML();
  uHasTw = false;
}

// Rebuild a column from the source text, keeping the caret where it was.
let uHasTw = false;
function renderCol(el) {
  const caret = caretGet(el);
  el.innerHTML = plainHTML();
  if (el.dataset.col === 'u') uHasTw = kaOn() && composeKashida(el);
  if (caret) caretSet(el, caret);
}

let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const u = document.querySelector('.text[data-col="u"]');
    if (u && (kaOn() || uHasTw)) renderCol(u);
    metrics();
    status();
    if (!typing) centre();
    typing = false;
  });
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
   the other don't: the label names the block, the status bar counts it. */
function status() {
  const u = document.querySelector('.text[data-col="u"]');
  const text = paragraphs.join(' ');
  const wordCount = (text.match(/\S+/g) ?? []).length;
  const join = parts => parts.filter(Boolean).join('<span class="sep">·</span>');
  document.querySelector('[data-status="count"]').innerHTML = join([`${paragraphs.length} ¶`, !hasJapanese() && `${wordCount} words`, `${text.replace(/\s/g, '').length} characters`]);
  const lines = +document.querySelector('[data-m="u.lines"]').textContent || 1;
  const minutes = Math.max(1, Math.round(hasJapanese() ? text.length / 500 : wordCount / 230));
  const tatweels = [...u.querySelectorAll('.tw')].reduce((n, t) => n + t.textContent.length, 0);
  document.querySelector('[data-status="setup"]').innerHTML = join([`≈ ${Math.round(text.length / lines)} characters a line`, `${minutes} min read`, tatweels && `${tatweels} tatweels`]);
  // Alone, the header already says unjustified, so the label names the block in
  // other ways. Comparing, the columns need their names.
  const label = ui.compare ? 'Unjustified' : {
    Spec: `${+state.size.toFixed(2)}/${+(state.size * state.lh).toFixed(2)} rem ${state.typeface}`,
    Block: `${measureNow} ch × ${lines} ln`,
    Figure: `Fig. 1 · ${state.sample}`,
    Sample: state.sample,
    None: '',
  }[state.label];
  for (const el of document.querySelectorAll('[data-name="u"]')) el.textContent = label;
  for (const el of document.querySelectorAll('[data-name="b"]')) el.textContent = `Browser · ${ui.peek ?? ui.vs}`;
}

/* ---------------------------------------------------------------------------
   Editing. Both columns are always editable and share one source text. A
   column is rebuilt while you type only when it has to be: it holds tatweels,
   or the browser left loose text or divs in it.
   --------------------------------------------------------------------------- */
const TATWEEL = 'ـ';
function cleanText(n) {
  if (n.nodeType === 3) return n.data;
  const c = n.cloneNode(true);
  for (const tw of [c, ...c.querySelectorAll?.('.tw') ?? []]) if (tw.classList?.contains('tw')) tw.textContent = tw.textContent.replaceAll(TATWEEL, '');
  return c.textContent;
}
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
    if (node.parentNode.closest('.tw')) continue;
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
  const t = e.target.closest?.('.text');
  if (t) syncFrom(t);
});
/* Paste as paragraphs, not lines. Copied text puts a blank line between
   paragraphs, and inserting it line by line made an empty paragraph of each blank
   line. With blank lines, each block is a paragraph and its single breaks become
   spaces; without, each line is one. A single line keeps the browser's own insert,
   and its undo. */
document.addEventListener('paste', e => {
  const t = e.target.closest?.('.text');
  if (!t) return;
  e.preventDefault();
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
  uHasTw = false;
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

/* ---------------------------------------------------------------------------
   Kashida stand-in. The site ranking is src/kashida.ts, with each class
   switchable. Placement is rough: every line but a paragraph's last gets up to
   "Per line" tatweels, enough to fill Frequency's share of the room it has
   left, best sites first, from the end of the line, one per word before any
   stacks up to "Per word".
   --------------------------------------------------------------------------- */
const LETTER = /[ؠ-يٮ-ۓۺ-ۼـ]/u;
const MARK = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/u;
const RIGHT_JOINING = new Set('اأإآٱدذرزوؤةژڈڑۀەۃ');
const ALEF = new Set('اأإآٱ');
const SEEN = new Set('سشصض');
const FINAL_HEH = new Set('ةهدذ');
const FINAL_ALEF = new Set('اأإآٱلكک');
const joinsForward = c => LETTER.test(c) && c !== 'ء' && !RIGHT_JOINING.has(c);
const joinsBackward = c => LETTER.test(c) && c !== 'ء';

function bestSite(word) {
  const allowed = [null, state.kaSeen, state.kaHeh, state.kaAlef, state.kaAny];
  const letters = [];
  for (let i = 0; i < word.length; i++) {
    if (MARK.test(word[i])) {
      if (letters.length && letters.at(-1).end === i) letters.at(-1).end = i + 1;
      continue;
    }
    if (LETTER.test(word[i])) letters.push({ char: word[i], index: i, end: i + 1 });
  }
  if (letters.length < state.kaMin) return null;
  let best = null;
  for (let i = 0; i + 1 < letters.length; i++) {
    const a = letters[i], b = letters[i + 1];
    if (b.index !== a.end || !joinsForward(a.char) || !joinsBackward(b.char)) continue;
    if (a.char === 'ل' && ALEF.has(b.char)) continue;
    const final = i + 1 === letters.length - 1;
    const priority = SEEN.has(a.char) ? 1 : final && FINAL_HEH.has(b.char) ? 2 : final && FINAL_ALEF.has(b.char) ? 3 : 4;
    // Same priority: the later site wins.
    if (allowed[priority] && (!best || priority <= best.priority)) best = { offset: a.end, priority };
  }
  return best;
}

function composeKashida(el) {
  // Lines are measured unjustified, so justify can't hide the room.
  el.style.textAlign = 'start';
  const probe = el.appendChild(document.createElement('span'));
  probe.textContent = TATWEEL.repeat(10);
  const tw = probe.getBoundingClientRect().width / 10 || 1;
  probe.remove();
  const rtl = el.dir === 'rtl';
  const range = document.createRange();
  const plans = [];
  for (const p of el.querySelectorAll(':scope > p')) {
    const node = p.firstChild;
    if (node?.nodeType !== 3 || !ARABIC.test(node.data)) continue;
    const box = p.getBoundingClientRect();
    const lines = [];
    let top = null;
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (!r) continue;
      if (top === null || Math.abs(r.top - top) > 2) { lines.push({ words: [], end: 0 }); top = r.top; }
      const line = lines.at(-1);
      line.words.push({ start: m.index, word: m[0] });
      line.end = Math.max(line.end, rtl ? box.right - r.left : r.right - box.left);
    }
    lines.pop();
    const counts = new Map();
    for (const line of lines) {
      let n = Math.min(state.kaLine, Math.floor((box.width - line.end) * state.kaFreq / 100 / tw));
      const order = line.words.map((w, i) => ({ ...w, i, site: bestSite(w.word) })).filter(w => w.site)
        .sort((a, b) => a.site.priority - b.site.priority || b.i - a.i);
      for (let round = 0; round < state.kaWord; round++) for (const w of order) {
        if (n-- <= 0) break;
        counts.set(w.start, { site: w.site, n: (counts.get(w.start)?.n ?? 0) + 1 });
      }
    }
    if (counts.size) plans.push({ p, text: node.data, counts });
  }
  el.style.textAlign = '';
  for (const { p, text, counts } of plans) {
    let html = '', at = 0;
    for (const [start, { site, n }] of [...counts].sort((a, b) => a[0] - b[0])) {
      const cut = start + site.offset;
      html += esc(text.slice(at, cut)) + `<span class="tw">${TATWEEL.repeat(n)}</span>`;
      at = cut;
    }
    p.innerHTML = html + esc(text.slice(at));
  }
  return plans.length > 0;
}

/* ---------------------------------------------------------------------------
   Metrics from the DOM. Each line is measured to its end from the starting
   edge, so an indent counts: Σ is the spread of body-line ends, short counts
   last lines under "Last line".
   --------------------------------------------------------------------------- */
function measure(el) {
  const box = el.getBoundingClientRect();
  const rtl = el.dir === 'rtl';
  const ends = [], lasts = [];
  for (const p of el.querySelectorAll(':scope > p')) {
    const r = document.createRange();
    r.selectNodeContents(p);
    const lines = new Map();
    for (const rect of r.getClientRects()) {
      if (!rect.width) continue;
      const key = Math.round(rect.top / 4);
      lines.set(key, Math.max(lines.get(key) ?? 0, rtl ? box.right - rect.left : rect.right - box.left));
    }
    const e = [...lines.values()];
    if (e.length) lasts.push(e.pop());
    ends.push(...e);
  }
  const mean = ends.reduce((a, b) => a + b, 0) / (ends.length || 1);
  const dev = Math.sqrt(ends.reduce((a, b) => a + (b - mean) ** 2, 0) / (ends.length || 1)) / box.width * 100;
  return { lines: String(ends.length + lasts.length), dev: dev.toFixed(1) + '%', short: String(lasts.filter(w => w < box.width * state.ending / 100).length) };
}
function metrics() {
  for (const el of texts()) {
    if (!el.offsetParent) continue;
    for (const [key, val] of Object.entries(measure(el))) for (const out of document.querySelectorAll(`[data-m="${el.dataset.col}.${key}"]`)) out.textContent = val;
  }
}

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
function setLayout(layout) {
  ui.layout = layout;
  root.dataset.layout = layout;
  history.replaceState(null, '', `?layout=${layout}`);
  document.title = `${LAYOUTS[layout]} · round 3 — unjustified lab`;
  apply();
}
export function start() {
  const asked = new URLSearchParams(location.search).get('layout');
  ui.layout = asked in LAYOUTS ? asked : 'left';
  root.dataset.layout = ui.layout;
  document.title = `${LAYOUTS[ui.layout]} · round 3 — unjustified lab`;
  document.querySelector('.stage').innerHTML = readingsHTML() + `<div class="pair">${colHTML('u', 'Unjustified')}${colHTML('b', 'Browser')}</div>`;
  buildPanel();
  loadSample();
  apply();
  document.fonts.ready.then(() => { layout(); scheduleRender(); });
  new ResizeObserver(() => { layout(); scheduleRender(); }).observe(document.querySelector('#canvas'));
}
