/**
 * Measurement principles informed by chenglou/pretext (MIT): prepare once,
 * cache by font, count grapheme advances, and shape Canvas without optional
 * ligatures when the DOM uses font-variant-ligatures:none.
 * See THIRD_PARTY_NOTICES.md and research/README.md.
 */
let segmenter: Intl.Segmenter | undefined;
export function trackingAdvances(text: string): number {
  // The fast path covers the demo's ordinary ASCII prose.
  if (/^[\x20-\x7e]*$/u.test(text)) return text.length;
  segmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

export function createCanvasMeasure(context: OffscreenCanvasRenderingContext2D, font: string, cursive = false, direction: CanvasDirection = 'ltr', japanese = false) {
  context.font = font;
  context.fontKerning = japanese ? 'none' : 'normal';
  // Adapted from Pretext's LETTER_SPACED_SHAPING technique. Chromium/Gecko
  // disable optional ligatures for nonzero tracking, but round this advance to
  // zero. The actual requested tracking is added analytically by the optimizer.
  // WebKit may keep Canvas ligatures; this remains a documented limitation.
  context.letterSpacing = cursive ? '0px' : '0.000001px';
  context.direction = direction;
  const widths = new Map<string, number>();
  const glyphs = new Map<string, number>();
  let calls = 0;
  let duration = 0;
  const read = (text: string) => {
    const start = performance.now();
    const width = context.measureText(text).width;
    duration += performance.now() - start;
    calls++;
    return width;
  };
  return {
    measure(text: string) {
      let width = widths.get(text);
      if (width === undefined) {
        if (japanese) {
          // Japanese is deliberately unkerned and uses space-all in the DOM.
          // Whole-string Canvas measurement may still halve adjacent CJK
          // punctuation. Cached individual grapheme advances avoid that engine
          // discrepancy. Do not apply this shortcut to connected Arabic text.
          segmenter ??= new Intl.Segmenter('ja', { granularity: 'grapheme' });
          width = 0;
          for (const { segment } of segmenter.segment(text)) {
            let advance = glyphs.get(segment);
            if (advance === undefined) { advance = read(segment); glyphs.set(segment, advance); }
            width += advance;
          }
        } else width = read(text);
        widths.set(text, width);
      }
      return width;
    },
    get calls() { return calls; },
    get duration() { return duration; },
    get size() { return widths.size; },
    clear() { widths.clear(); glyphs.clear(); },
  };
}
