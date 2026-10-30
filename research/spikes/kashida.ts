import '@fontsource-variable/noto-sans-arabic/wdth.css';

/** [before, after]: the tatweel run goes between the two halves. */
const words: [string, string][] = [
  ['مس', 'تشفى'], // after seen
  ['مدرس', 'ة'], // before final teh marbuta
  ['كت', 'اب'], // before final alef
];
const run = 'ــ';

const rows = document.querySelector('#rows')!;
words.forEach(([before, after], i) => {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML =
    `<span class="word" id="plain-${i}">${before}${run}${after}</span>`
    + `<span class="word" id="span-${i}">${before}<span class="k" aria-hidden="true">${run}</span>${after}</span>`
    + `<span class="word" id="before-${i}">${before}<span class="kb" aria-hidden="true" data-k="${run}"></span>${after}</span>`
    + `<span class="word" id="original-${i}">${before}${after}</span>`;
  rows.append(row);
});
await document.fonts.load('48px "Noto Sans Arabic Variable"', 'مستشفى');
(window as any).__ready = true;
