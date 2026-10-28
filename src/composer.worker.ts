import { compose } from './optimizer';
import { createCanvasMeasure } from './text-metrics';
import { families, loadFonts } from './fonts';
import { hasArabic, hasJapanese, directionFor } from './language';
import type { ComposeRequest, WorkerResponse } from './protocol';

const scope = globalThis as unknown as { fonts: FontFaceSet; postMessage: (message: WorkerResponse) => void };
let fontKey = '';
const measurements = new Map<string, ReturnType<typeof createCanvasMeasure>>();
self.onmessage = async (event: MessageEvent<ComposeRequest>) => {
  const request = event.data;
  const start = performance.now();
  try {
    await loadFonts(request.typeface, request.paragraphs.join('\n'), scope.fonts);
    const fontMs = performance.now() - start;
    const key = `${request.typeface}:${request.settings.fontSize}`;
    if (key !== fontKey) { measurements.clear(); fontKey = key; }
    const countBefore = [...measurements.values()].reduce((n, m) => n + m.calls, 0);
    const timeBefore = [...measurements.values()].reduce((n, m) => n + m.duration, 0);
    const measure = (text: string) => {
      const cursive = hasArabic(text);
      const direction = directionFor(text, request.direction);
      const japanese = hasJapanese(text);
      const key = `${cursive}:${direction}:${japanese}`;
      let measurement = measurements.get(key);
      if (!measurement) {
        measurement = createCanvasMeasure(new OffscreenCanvas(1, 1).getContext('2d')!,
          `400 ${request.settings.fontSize}px ${families[request.typeface]}`, cursive, direction, japanese);
        measurements.set(key, measurement);
      }
      return measurement.measure(text);
    };
    const searchStart = performance.now();
    const result = compose(request.paragraphs, measure, request.settings);
    const compositionMs = performance.now() - searchStart;
    const measureMs = [...measurements.values()].reduce((n, m) => n + m.duration, 0) - timeBefore;
    const count = [...measurements.values()].reduce((n, m) => n + m.calls, 0) - countBefore;
    for (const m of measurements.values()) if (m.size > 30000) m.clear();
    scope.postMessage({ id: request.id, result, elapsed: performance.now() - start,
      measurements: count, fontMs, measureMs, searchMs: Math.max(0, compositionMs - measureMs) });
  } catch (error) {
    scope.postMessage({ id: request.id, elapsed: performance.now() - start, measurements: 0,
      fontMs: 0, measureMs: 0, searchMs: 0,
      error: error instanceof Error ? error.message : String(error) });
  }
};
scope.postMessage({ kind: 'ready' });
