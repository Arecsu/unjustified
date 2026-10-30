/**
 * Spike 2b: the per-step fallback. A FontFace whose `stretch` descriptor is a
 * single value is matched by Canvas at its default stretch, and CSS clamps the
 * wdth axis into the descriptor range, so Canvas should measure that exact width.
 */
import '@fontsource-variable/noto-sans-arabic/wdth.css';
import '@fontsource-variable/roboto-flex/wdth.css';
import arabicUrl from '@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-arabic-wdth-normal.woff2?url';
import robotoUrl from '@fontsource-variable/roboto-flex/files/roboto-flex-latin-wdth-normal.woff2?url';
import { samples } from '../../src/samples';

const fonts = [
  { family: 'Noto Sans Arabic Variable', url: arabicUrl, texts: samples.arabic.split('\n\n'), steps: [100, 93, 87, 80, 75, 70, 63] },
  { family: 'Roboto Flex Variable', url: robotoUrl, texts: samples.editorial.split('\n\n'), steps: [100, 93, 87, 80, 75, 70, 60] },
];
const context = new OffscreenCanvas(1, 1).getContext('2d')!;
context.letterSpacing = '0.000001px';
const results: object[] = [];
for (const font of fonts) {
  const { family } = font;
  const data = await (await fetch(font.url)).arrayBuffer();
  const lines = font.texts.flatMap(text => text.match(/.{40,60}(\s|$)/gu) ?? []).map(l => l.trim());
  await document.fonts.load(`19px "${family}"`, lines[0]);
  for (const step of font.steps) {
    const alias = `${family} w${step}`;
    const face = new FontFace(alias, data.slice(0), { stretch: `${step}%`, weight: '100 900' });
    document.fonts.add(face);
    await face.load();
    let worst = 0;
    for (const line of lines) {
      const span = document.createElement('span');
      span.style.fontFamily = `"${family}"`;
      span.style.fontStretch = `${step}%`;
      span.textContent = line;
      document.querySelector('#out')!.append(span);
      span.remove(); document.querySelector('#out')!.append(span);
      const dom = span.getBoundingClientRect().width;
      span.remove();
      context.font = `400 19px "${alias}"`;
      // As src/text-metrics.ts: connected scripts keep their ligatures.
      context.letterSpacing = family.includes('Arabic') ? '0px' : '0.000001px';
      span.style.fontVariantLigatures = family.includes('Arabic') ? 'normal' : 'none';
      worst = Math.max(worst, Math.abs(context.measureText(line).width - dom));
    }
    results.push({ family, step, lines: lines.length, worstError: +worst.toFixed(3) });
  }
}
(window as any).__results = results;
