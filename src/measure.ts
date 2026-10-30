/**
 * Canvas measurement, shared by the worker and the main-thread fallback so both
 * produce identical widths for the same text.
 */
import { createCanvasMeasure } from './text-metrics';
import { familiesAt } from './fonts';
import type { Typeface } from './fonts';
import { hasArabic, hasJapanese, directionFor } from './language';
import type { DirectionPolicy } from './language';
import type { Settings } from './optimizer';

export type Measure = (text: string) => number;

/**
 * One Canvas context per shaping context (cursive / direction / Japanese).
 * Widths are cached by candidate string inside each context, which is what makes
 * a recomposition after a resize free of new measurements.
 */
export function createMeasure(settings: Settings, typeface: Typeface, direction: DirectionPolicy) {
  const contexts = new Map<string, ReturnType<typeof createCanvasMeasure>>();
  /** Width at a whole-percent `font-stretch` step (100 = natural). Steps other
   *  than 100 need `installWidthSteps` first. */
  const measureAt = (text: string, step: number) => {
    const cursive = hasArabic(text);
    const resolved = directionFor(text, direction);
    const japanese = hasJapanese(text);
    const key = `${cursive}:${resolved}:${japanese}:${step}`;
    let measurement = contexts.get(key);
    if (!measurement) {
      measurement = createCanvasMeasure(new OffscreenCanvas(1, 1).getContext('2d')!,
        `400 ${settings.fontSize}px ${familiesAt(typeface, step)}`, cursive, resolved, japanese);
      contexts.set(key, measurement);
    }
    return measurement.measure(text);
  };
  const measure: Measure = text => measureAt(text, 100);
  return {
    measure,
    measureAt,
    get calls() { let n = 0; for (const m of contexts.values()) n += m.calls; return n; },
    get duration() { let n = 0; for (const m of contexts.values()) n += m.duration; return n; },
    trim() { for (const m of contexts.values()) if (m.size > 30000) m.clear(); },
  };
}
