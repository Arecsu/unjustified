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
    // Indent in ch, or in % of the width; one row shows, per ui.unit.
    range('indent', 'Indent', 0, 80, 1, 0, 'ch', { units: true, show: () => ui.unit === 'ch' }),
    range('indentPct', 'Indent', 0, 90, 1, 0, '%', { units: true, show: () => ui.unit === '%' }),
    select('indentAt', 'Indented', ['Every paragraph', 'First only', 'All but first'], { adv, dep: () => (ui.unit === '%' ? state.indentPct : state.indent) > 0 }),
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
const ui = { auto: true, linked: { track: true, space: true }, ratio: { ...RATIO }, open: new Set(), compare: false, read: false, focus: false, layout: 'left', vs: 'ragged', gt: 'start', chip: 'underline', opts: 'glide', dd: 'inline', hd: 'stops', mk: 'quiet', rules: 'dashed', unit: 'ch', caption: null };
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
  root.dataset.indent = { 'Every paragraph': 'all', 'First only': 'first', 'All but first': 'rest' }[state.indentAt];
  for (const [cls, on] of [['justify-u', state.justify], ['justify-b', ui.vs === 'justified'], ['guides', state.guides], ['diag', state.diag], ['tw-marks', state.twMarks], ['numbers', state.numbers]]) root.classList.toggle(cls, on);
  root.toggleAttribute('data-compare', ui.compare);
  root.toggleAttribute('data-read', ui.read);
  root.toggleAttribute('data-focus', ui.focus);
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
}

/* ---------------------------------------------------------------------------
   Panel.
   --------------------------------------------------------------------------- */
function rowHTML(c) {
  const cls = `row ${c.type}${c.of ? ' sub' : ''}`;
  const row = `data-row="${c.k}"`;
  if (c.type === 'note') return `<div class="${cls}" ${row}><span class="sub">${c.label}</span></div>`;
  if (c.type === 'toggle') return `<label class="${cls}" ${row}><span class="lbl">${c.label}</span><input type="checkbox" id="in-${c.k}" data-k="${c.k}" ${state[c.k] ? 'checked' : ''} aria-label="${c.aria ?? c.label}"></label>`;
  // A dropdown is drawn (title, value, arrow) with the real select laid over it,
  // invisible, so a click opens the browser's own menu. DD picks the look.
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
  return `<div class="${cls}" ${row}><span class="lbl"><label for="in-${c.k}">${c.label}</label>${at('label', opt)}</span><span class="out">${c.units ? out + at('value', opt) : at('value', opt) + out}</span><input type="range" id="in-${c.k}" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${state[c.k]}" title="Double-click to reset"${c.auto ? '' : ` style="--d:${(DEFAULTS[c.k] - c.min) / (c.max - c.min)}"`}>${at('below', below)}</div>`;
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
const PICKS = [['box', 'gt', GT], ['dropdown', 'dd', DD], ['options', 'opts', OPTS], ['buttons', 'chip', CHIPS], ['header', 'hd', HD], ['marks', 'mk', MK], ['rules', 'rules', ['line', 'dashed', 'off']]];
// Each pick's default, before the URL sets anything, for "copy changes".
const PICK_DEF = Object.fromEntries(PICKS.map(([, k]) => [k, ui[k]]));
const coarse = matchMedia('(pointer: coarse)');
const place = () => ui.opts === 'pointer' ? (coarse.matches ? 'below' : 'value')
  : ui.opts === 'hybrid' || ui.opts === 'glide' ? (coarse.matches ? 'below' : ui.opts) : ui.opts;

// Options fold away (grid rows 0fr to 1fr, which every browser animates): a
// switched group's while it's off, and every group's extra ones until "more".
function groupHTML(g) {
  const m = g.master && CONTROLS[g.master];
  const rows = cs => cs.filter(c => c.k !== g.master).map(c => rowHTML(c)).join('');
  // Built in the state they'll show, so nothing folds shut on load.
  const fold = (attr, html, open) => `<div class="fold${open ? '' : ' shut'}" ${attr}><div class="fold-in">${html}</div></div>`;
  const body = rows(g.controls.filter(c => !c.adv))
    + fold(`data-extra="${g.id}"`, rows(g.controls.filter(c => c.adv)), ui.open.has(g.id))
    + `<p class="gnote" data-note="${g.id}" hidden></p><button class="more hl" data-more="${g.id}"></button>`;
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
const variantsHTML = () => `<section class="group variants" data-g="variants" aria-labelledby="g-variants"><h2 id="g-variants">Variants</h2><div class="rows">${PICKS.map(([name, k, list]) => `<div class="row pick"><span class="lbl">${name[0].toUpperCase() + name.slice(1)}</span><span class="ch">${list.map(t => `<button class="hl" data-${k}="${t}">${t}</button>`).join('<span class="sl">/</span>')}</span></div>`).join('')}</div></section>`;
// The prototype's sliders: the underline, then every spacing in the panel.
const SPACES = ['gap', 'rows', 'track', 'gutter', 'sides', 'top', 'more', 'opt', 'pair', 'sub', 'ddp'];
const tuningHTML = () => `<section class="group tuning" data-g="tuning" aria-labelledby="g-tuning"><h2 id="g-tuning">Tuning</h2><div class="rows"><div class="row note"><span class="sub">Underline</span></div>${['ulat13', 'ulat16', 'ulw'].map(tuneHTML).join('')}<p class="gnote num" data-ul-at>${ulSay()}</p><div class="row note"><span class="sub">Space</span></div>${SPACES.map(tuneHTML).join('')}</div></section>`;

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
const WIN_KEY = 'unjustified-r3-win';
const win = { x: 32, y: 88, w: 416, h: 560, open: true };
try { Object.assign(win, JSON.parse(localStorage.getItem(WIN_KEY)) ?? {}); } catch {}
const winSave = () => { try { localStorage.setItem(WIN_KEY, JSON.stringify(win)); } catch {} };
function winPlace() {
  const el = document.querySelector('.win');
  // Kept on screen, whatever the window was when it was left.
  win.x = Math.max(0, Math.min(win.x, innerWidth - Math.min(el.offsetWidth || win.w, innerWidth)));
  win.y = Math.max(0, Math.min(win.y, innerHeight - 48));
  el.style.left = win.x + 'px';
  el.style.top = win.y + 'px';
}
function winToggle(open = !win.open) {
  win.open = open;
  document.querySelector('.win').hidden = !open;
  for (const b of document.querySelectorAll('.foot [data-win]')) b.setAttribute('aria-pressed', open);
  if (open) winPlace();
  winSave();
}
function buildWin() {
  const el = document.createElement('aside');
  el.className = 'win';
  el.setAttribute('aria-label', 'Variants and tuning');
  el.innerHTML = `<div class="win-bar"><span>Variants · Tuning</span><button class="hl" data-copy title="Copy what differs from the defaults, to paste back">copy changes</button><span class="muted">⌥T</span><button class="hl" data-win aria-label="Hide">×</button></div><div class="win-groups">${variantsHTML()}${tuningHTML()}</div>`;
  el.style.width = win.w + 'px';
  el.style.height = win.h + 'px';
  document.body.append(el);
  winToggle(win.open);
  // Drag by the bar.
  el.querySelector('.win-bar').addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('button')) return;
    const bar = e.currentTarget, dx = e.clientX - win.x, dy = e.clientY - win.y;
    bar.setPointerCapture(e.pointerId);
    const move = m => { win.x = m.clientX - dx; win.y = m.clientY - dy; winPlace(); };
    const up = () => { bar.removeEventListener('pointermove', move); winSave(); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
    bar.addEventListener('pointercancel', up, { once: true });
  });
  // Its size, as left by the corner.
  new ResizeObserver(() => {
    if (el.hidden) return;
    win.w = el.offsetWidth;
    win.h = el.offsetHeight;
    winSave();
  }).observe(el);
  addEventListener('resize', () => { if (win.open) winPlace(); });
}
// What differs from the defaults, as plain lines to paste back into the chat, with
// the address that sets it all up again.
function changesText() {
  const lines = [];
  for (const [name, k] of PICKS) if (ui[k] !== PICK_DEF[k]) lines.push(`${name}: ${ui[k]} (default ${PICK_DEF[k]})`);
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
  hyph: () => hasArabic() || hasJapanese() ? 'Arabic and Japanese are not hyphenated: kashida and tracking do that work.' : '',
  kash: () => hasArabic() ? '' : 'Kashida applies to Arabic text only. <button class="hl" data-try="Arabic">Arabic sample ⟶</button>',
};

function refresh() {
  for (const c of Object.values(CONTROLS)) {
    const row = document.querySelector(`[data-row="${c.k}"]`);
    if (!row) continue;
    row.hidden = (c.show && !c.show()) || (c.of && ui.linked[c.of]);
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
    more.setAttribute('aria-expanded', ui.open.has(g.id));
    document.querySelector(`[data-extra="${g.id}"]`).classList.toggle('shut', !ui.open.has(g.id));
    if (g.master) document.querySelector(`[data-body="${g.id}"]`).classList.toggle('shut', !state[g.master]);
    document.querySelector(`[data-about="${g.id}"]`)?.classList.toggle('shut', !!state[g.master]);
    // The mark (MK) turns over as the group opens; CSS draws it.
    const words = ui.open.has(g.id) ? 'fewer' : `${extra.length} more`;
    const label = `${words} <span class="mk" aria-hidden="true"></span>${!ui.open.has(g.id) && touched ? ` · ${touched} set` : ''}`;
    if (more.innerHTML !== label) more.innerHTML = label;
    const n = document.querySelector(`[data-note="${g.id}"]`);
    const html = NOTES[g.id]?.() ?? '';
    n.hidden = !html;
    if (n.innerHTML !== html) n.innerHTML = html;
  }
  for (const b of document.querySelectorAll('[data-auto]')) b.setAttribute('aria-pressed', ui.auto);
  for (const b of document.querySelectorAll('[data-compare]')) b.setAttribute('aria-pressed', ui.compare);
  for (const b of document.querySelectorAll('[data-focus]')) b.setAttribute('aria-pressed', ui.focus);
  for (const b of document.querySelectorAll('[data-master]')) b.setAttribute('aria-pressed', state[b.dataset.master]);
  for (const b of document.querySelectorAll('[data-set-k]')) b.setAttribute('aria-pressed', state[b.dataset.setK] === (b.dataset.setV === '1'));
  for (const [, k] of PICKS) {
    root.dataset[k] = ui[k];
    for (const b of document.querySelectorAll(`button[data-${k}]`)) b.setAttribute('aria-pressed', b.dataset[k] === ui[k]);
  }
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
  else if ('copy' in d) copyChanges(t);
  else if (PICKS.some(([, k]) => k in d)) {
    const [, k] = PICKS.find(([, k]) => k in d);
    ui[k] = d[k];
    param(k, d[k]);
    // The box looks each have their own markup, so the panel is rebuilt where it is.
    if (k === 'gt') {
      const panel = document.querySelector('.panel'), y = panel.scrollTop;
      buildPanel();
      panel.scrollTop = y;
    }
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

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !(ui.read || ui.focus) || e.target.matches?.('[data-name]')) return;
  if (ui.read) ui.read = false; else ui.focus = false;
  apply();
});

/* ---------------------------------------------------------------------------
   Canvas. The unjustified column comes first; comparing adds the browser's
   column to its right, so the text you're looking at never moves.
   --------------------------------------------------------------------------- */
const colHTML = (col, name) => `<section class="col" data-col="${col}"><div class="col-head"><span data-name="${col}">${name}</span><span class="m num"><span data-m="${col}.lines">–</span> ln · Σ <span data-m="${col}.dev">–</span> · short <span data-m="${col}.short">–</span></span></div><div class="ruler" aria-hidden="true"></div><div class="frame"><div class="text" data-col="${col}" contenteditable="true" spellcheck="false"></div><div class="handle" title="Drag to set the width. Double-click for auto."><span>↔</span></div></div></section>`;

const readingsHTML = () => `<dl class="readings num">${[['Lines', 'lines'], ['Σ', 'dev'], ['Short', 'short'], ['Width', 'width']].map(([l, m]) => `<dt>${l}</dt><dd data-m="u.${m}">–</dd>`).join('')}</dl>`;

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const plainHTML = () => paragraphs.map(p => `<p>${p ? esc(p) : '<br>'}</p>`).join('');

function loadSample() {
  paragraphs = SAMPLES[state.sample].split('\n\n');
  ui.caption = null;
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
function param(k, v) {
  const q = new URLSearchParams(location.search);
  q.set(k, v);
  history.replaceState(null, '', '?' + q);
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
  tuneApply();
  coarse.addEventListener('change', refresh);
  root.dataset.layout = ui.layout;
  document.title = `${LAYOUTS[ui.layout]} · round 3 — unjustified lab`;
  document.querySelector('.stage').innerHTML = readingsHTML() + `<div class="pair">${colHTML('u', 'Unjustified')}${colHTML('b', 'Browser')}</div>`;
  buildPanel();
  buildWin();
  loadSample();
  apply();
  document.fonts.ready.then(() => { layout(); scheduleRender(); });
  new ResizeObserver(() => { layout(); scheduleRender(); }).observe(document.querySelector('#canvas'));
}
