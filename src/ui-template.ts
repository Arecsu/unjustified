const ranges = {
  'font-size': ['Type size', 14, 26, 19, ' px', 'Small|Large', 1],
  measure: ['Column width', 240, 620, 390, ' px', 'Narrow|Wide', 2],
  rag: ['Room for the rag', 0, 18, 5.5, '%', 'Tighter|Looser', 0.5],
  'word-spacing': ['Word spacing flex', 0, 50, 0, '%', 'Fixed|Flexible', 5],
  kashida: ['Kashida per line', 0, 4, 0, '', 'Off|4 tatweels', 1],
  'width-flex': ['Width flex', 0, 40, 0, '%', 'Natural|Condensed', 1],
  firmness: ['Edge firmness', 0, 100, 0, '%', 'Ragged|Nearly flush', 5],
  sync: ['Paragraph harmony', 0, 100, 65, '%', 'Independent|In concert', 5],
  ending: ['Minimum last line', 15, 60, 32, '%', 'A little|A little more', 1],
} as const;

export function rangeMarkup(id: keyof typeof ranges) {
  const [label, min, max, value, unit, hints, step] = ranges[id];
  const [start, end] = hints.split('|');
  return `<div class="range-control"><label for="${id}">${label}<output id="${id}-value" for="${id}">${value}${unit}</output></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" /><div class="range-ends"><span>${start}</span><span>${end}</span></div></div>`;
}
