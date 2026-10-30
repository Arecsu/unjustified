import { compose, paragraphCandidates } from './optimizer';
import { fontBinaries, installWidthSteps, loadFonts, widthSteps } from './fonts';
import { createMeasure } from './measure';
import type { ComposeRequest, WarmRequest, WorkerResponse } from './protocol';
import type { FontBinary } from './fonts';

const scope = globalThis as unknown as { fonts: FontFaceSet; postMessage: (message: WorkerResponse) => void };

/**
 * Exercise the search once with throwaway input so the first real composition
 * runs optimized code. Measured on a 40-paragraph document: the same search took
 * 115 ms in a fresh worker and 38 ms afterwards, i.e. a 3x interpreter penalty
 * paid exactly once, on the composition the reader is waiting for. Costs a few
 * milliseconds here, off the main thread, while the page is still painting.
 */
function warmUpSearch() {
  const settings = { width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
    rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true };
  const sample = 'Warm the composing engine with a paragraph of ordinary length so that '
    + 'its search and measurement paths are compiled before real work arrives. ';
  const text = sample.repeat(3).trim();
  const stub = (value: string) => value.length * 8.4;
  paragraphCandidates(text, stub, settings);
  compose([text, text, text], stub, settings);
}

/**
 * Install font faces from binaries the page already downloaded, so a cold
 * composition does not fetch or decode the same subsets twice. Returns whether
 * the set was usable; a failure falls back to fetching in the worker.
 */
const installedFonts = new Map<string, Promise<FontFace>>();
/** Binaries received from the page, kept to build width-step faces later. */
const receivedFonts: FontBinary[] = [];
const installedSteps = new Map<string, Promise<FontFace>>();
async function installFonts(fonts: FontBinary[] | undefined): Promise<boolean> {
  try {
    for (const font of fonts ?? []) {
      const key = `${font.family}:${font.weight}:${font.range}`;
      if (installedFonts.has(key)) continue;
      receivedFonts.push(font);
      const face = new FontFace(font.family, font.data, { weight: font.weight, unicodeRange: font.range,
        ...(font.stretch ? { stretch: font.stretch } : {}) });
      scope.fonts.add(face);
      installedFonts.set(key, face.load().catch(error => {
        installedFonts.delete(key);
        throw error;
      }));
    }
    // Warm-up and a compose can overlap while a FontFace loads. Both await the
    // same job; warm resize requests neither clone nor decode these fonts again.
    await Promise.all(installedFonts.values());
    return installedFonts.size > 0;
  } catch {
    return false;
  }
}

let fontKey = '';
let cached = createMeasure({ width: 390, fontSize: 19, trackingMin: 0, trackingMax: 0, rag: 0.055,
  minEnding: 0.32, sync: 0, protectEndings: true }, 'serif', 'auto');

self.onmessage = async (event: MessageEvent<ComposeRequest | WarmRequest>) => {
  const request = event.data;
  if ('warm' in request) {
    // Warm-up deliberately touches no network and no fonts: it installs the
    // binaries the page already fetched (if any) and exercises the search.
    // Fetching fonts here used to hang inside a worker in some browsers, and the
    // page waited for this message before composing at all.
    try {
      scope.postMessage({ kind: 'warm-start' });
      await installFonts(request.fonts);
      scope.postMessage({ kind: 'warm-fonts' });
      warmUpSearch();
      scope.postMessage({ kind: 'warm-jit' });
    } catch (error) {
      scope.postMessage({ kind: 'warm-error', detail: String(error) });
    }
    scope.postMessage({ kind: 'ready' });
    return;
  }
  const start = performance.now();
  try {
    if (!await installFonts(request.fonts)) {
      // The page could not hand over its fonts. Fetching them here is the slow
      // path and can hang in some worker implementations, so bound it and let the
      // page compose on the main thread instead of waiting forever.
      const loaded = await Promise.race([
        loadFonts(request.typeface, request.paragraphs.join('\n'), scope.fonts).then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
      ]);
      if (!loaded) throw new Error('worker could not prepare its fonts');
    }
    const steps = widthSteps(request.settings.widthFlex ?? 0);
    if (steps.length) await installWidthSteps([...receivedFonts, ...fontBinaries()], steps, scope.fonts, installedSteps);
    const fontMs = performance.now() - start;
    const key = `${request.typeface}:${request.settings.fontSize}:${request.direction}`;
    if (key !== fontKey) {
      cached = createMeasure(request.settings, request.typeface, request.direction);
      fontKey = key;
    }
    const countBefore = cached.calls;
    const timeBefore = cached.duration;
    const searchStart = performance.now();
    const result = compose(request.paragraphs, cached.measure, request.settings, cached.measureAt);
    const compositionMs = performance.now() - searchStart;
    const measureMs = cached.duration - timeBefore;
    cached.trim();
    scope.postMessage({ id: request.id, result, elapsed: performance.now() - start,
      measurements: cached.calls - countBefore, fontMs,
      measureMs, searchMs: Math.max(0, compositionMs - measureMs) });
  } catch (error) {
    scope.postMessage({ id: request.id, elapsed: performance.now() - start, measurements: 0,
      fontMs: 0, measureMs: 0, searchMs: 0,
      error: error instanceof Error ? error.message : String(error) });
  }
};

// Announce readiness only after installing the handler. Module imports may
// suspend evaluation; messages posted during that gap would otherwise be lost.
scope.postMessage({ kind: 'booted' });
