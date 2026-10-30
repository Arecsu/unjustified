/**
 * Can the browser's own hyphenation dictionary be read? Each word goes into a
 * zero-width box with `hyphens: auto`, so the browser breaks it at every
 * opportunity; the start offset of each visual line is a hyphenation point.
 */
const words: Record<string, string[]> = {
  en: ['architecture', 'typography', 'consideration', 'deliberate', 'hyphenation', 'beautiful'],
  de: ['Silbentrennung', 'Donaudampfschifffahrt', 'Wörterbuch'],
  es: ['arquitectura', 'tipografía', 'consideración'],
  fr: ['architecture', 'typographie', 'considération'],
};

function points(word: string, lang: string): number[] {
  const box = document.createElement('div');
  box.lang = lang;
  box.style.cssText = 'position:absolute;visibility:hidden;width:0;hyphens:auto;-webkit-hyphens:auto;font:16px serif;overflow-wrap:normal;word-break:normal';
  box.textContent = word;
  document.body.append(box);
  const text = box.firstChild!;
  const range = document.createRange();
  const result: number[] = [];
  let top = -Infinity;
  for (let i = 0; i < word.length; i++) {
    range.setStart(text, i); range.setEnd(text, i + 1);
    const rect = range.getClientRects()[0];
    if (rect && rect.top > top + 1) { if (i > 0) result.push(i); top = rect.top; }
  }
  box.remove();
  return result;
}

const out: Record<string, string> = {};
for (const [lang, list] of Object.entries(words)) for (const word of list) {
  const at = points(word, lang);
  let shown = '', last = 0;
  for (const p of at) { shown += word.slice(last, p) + '·'; last = p; }
  out[`${lang} ${word}`] = shown + word.slice(last);
}
(window as any).__results = out;
