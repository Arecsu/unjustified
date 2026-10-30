/**
 * Paragraph helper: runs the independent per-paragraph search for a share of a
 * document and returns packed candidates. The composer worker runs the joint
 * stage. Each helper keeps its own measurement cache; paragraphs are assigned
 * by a deterministic split, so a resize finds its widths already measured.
 */
import { paragraphCandidates } from './optimizer';
import { createMeasure } from './measure';
import { createFontInstaller } from './font-install';
import { packCandidates, transferables } from './pack';
import { warmUpSearch } from './warmup';
import type { HelperRequest, HelperResponse } from './protocol';

const scope = globalThis as unknown as {
  fonts: FontFaceSet;
  postMessage: (message: HelperResponse, transfer?: Transferable[]) => void;
};
const fonts = createFontInstaller(scope.fonts);
let measureKey = '';
let cached: ReturnType<typeof createMeasure> | undefined;

warmUpSearch();

self.onmessage = async (event: MessageEvent<HelperRequest>) => {
  const request = event.data;
  if (request.kind === 'fonts') {
    await fonts.install(request.fonts);
    return;
  }
  try {
    await fonts.install([]);
    await fonts.installSteps(request.settings.widthFlex ?? 0);
    const key = `${request.typeface}:${request.settings.fontSize}:${request.direction}`;
    if (key !== measureKey || !cached) {
      cached = createMeasure(request.settings, request.typeface, request.direction);
      measureKey = key;
    }
    const calls = cached.calls, duration = cached.duration;
    const results = request.paragraphs.map(({ index, text }) => ({
      index, packed: packCandidates(paragraphCandidates(text, cached!.measure, request.settings, 32, cached!.measureAt)),
    }));
    cached.trim();
    scope.postMessage({ id: request.id, results, measurements: cached.calls - calls,
      measureMs: cached.duration - duration }, results.flatMap(result => transferables(result.packed)));
  } catch (error) {
    scope.postMessage({ id: request.id, results: [], measurements: 0, measureMs: 0,
      error: error instanceof Error ? error.message : String(error) });
  }
};
