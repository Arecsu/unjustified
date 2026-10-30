import '@fontsource-variable/noto-sans-arabic/wdth.css';
import '@fontsource-variable/roboto-flex/wdth.css';
import { samples } from '../../src/samples';

/** Canvas keyword → percentage, per CSS Fonts 4. */
const keywords = [['ultra-condensed', 50], ['extra-condensed', 62.5], ['condensed', 75],
  ['semi-condensed', 87.5], ['normal', 100]] as const;
const fonts = [
  { family: 'Noto Sans Arabic Variable', min: 62.5, texts: samples.arabic.split('\n\n') },
  { family: 'Roboto Flex Variable', min: 50, texts: samples.editorial.split('\n\n') },
];
const steps = [100, 96, 93, 90, 87.5, 85, 80, 75, 70, 62.5];

const canvas = new OffscreenCanvas(1, 1);
const context = canvas.getContext('2d')!;
const out = document.querySelector('#out')!;
const results: object[] = [];

for (const font of fonts) {
  // The font shorthand takes only keyword stretch, so load the variable file once.
  await document.fonts.load(`19px "${font.family}"`, font.texts[0]);
  const minKeyword = keywords.find(([, value]) => value === font.min)![0];
  // Lines of roughly 40–60 characters, as the optimizer would measure.
  const lines = font.texts.flatMap(text => text.match(/.{40,60}(\s|$)/gu) ?? []).map(l => l.trim());
  const canvasAt = (keyword: string, text: string) => {
    context.font = `19px "${font.family}"`;
    context.fontStretch = keyword as CanvasFontStretch;
    context.fontKerning = 'normal';
    // The DOM spans disable ligatures. Canvas has no switch for that, so use the
    // product's trick (src/text-metrics.ts): a tiny nonzero letter-spacing.
    context.letterSpacing = '0.000001px';
    return context.measureText(text).width;
  };
  for (const stretch of steps.filter(value => value >= font.min)) {
    let worst = 0, sum = 0;
    for (const line of lines) {
      const span = document.createElement('span');
      span.style.fontFamily = `"${font.family}"`;
      span.style.fontStretch = `${stretch}%`;
      span.textContent = line;
      out.append(span);
      const dom = span.getBoundingClientRect().width;
      span.remove();
      const wide = canvasAt('normal', line), narrow = canvasAt(minKeyword, line);
      const t = (100 - stretch) / (100 - font.min);
      const predicted = wide + (narrow - wide) * t;
      const error = Math.abs(predicted - dom);
      worst = Math.max(worst, error); sum += error;
    }
    results.push({ family: font.family, stretch, lines: lines.length,
      meanError: +(sum / lines.length).toFixed(3), worstError: +worst.toFixed(3) });
  }
  // Does Canvas honour the axis at all? A keyword width must differ from normal.
  results.push({ family: font.family, keywordHonoured: canvasAt(minKeyword, lines[0]) < canvasAt('normal', lines[0]) - 1 });
}
(window as any).__results = results;
