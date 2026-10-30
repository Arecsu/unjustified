import { composeCandidates, paragraphCandidates } from './optimizer';
import type { Layout } from './optimizer';
import { fontBinaries, loadFonts } from './fonts';
import { createMeasure } from './measure';
import { createFontInstaller } from './font-install';
import { unpackCandidates } from './pack';
import { warmUpSearch } from './warmup';
import { loadSearchKernel } from './kernel';
import type { ComposeRequest, HelperRequest, HelperResponse, WarmRequest, WorkerResponse } from './protocol';

const scope = globalThis as unknown as { fonts: FontFaceSet; postMessage: (message: WorkerResponse) => void };
const fonts = createFontInstaller(scope.fonts);
const kernelReady = loadSearchKernel(new URL('./kernel/search.wasm', import.meta.url));

/**
 * Paragraph search is independent per paragraph, so long documents are split
 * across helper workers; only the joint stage runs here. Short documents are
 * not worth the messaging. Any helper failure falls back to searching here.
 */
const PARALLEL_CHARACTERS = 3000;
const helperCount = Math.min(4, Math.max(0, (navigator.hardwareConcurrency ?? 2) - 1));
interface Helper { worker: Worker; sent: Set<string>; waiting: Map<number, (response: HelperResponse) => void> }
let helpers: Helper[] | undefined;
let helpersDead = helperCount < 2;

function spawnHelpers(): Helper[] | undefined {
  if (helpersDead) return undefined;
  if (helpers) return helpers;
  try {
    helpers = Array.from({ length: helperCount }, () => {
      const helper: Helper = {
        worker: new Worker(new URL('./paragraph.worker.ts', import.meta.url), { type: 'module' }),
        sent: new Set(), waiting: new Map(),
      };
      helper.worker.onmessage = (event: MessageEvent<HelperResponse>) => {
        helper.waiting.get(event.data.id)?.(event.data);
        helper.waiting.delete(event.data.id);
      };
      helper.worker.onerror = () => retireHelpers();
      return helper;
    });
    scope.postMessage({ kind: 'helpers-started' });
  } catch {
    retireHelpers();
  }
  return helpers;
}
function retireHelpers() {
  helpersDead = true;
  for (const helper of helpers ?? []) {
    helper.worker.terminate();
    // Unblock anything waiting; the caller falls back to a local search.
    for (const resolve of helper.waiting.values()) resolve({ id: -1, results: [], measurements: 0, measureMs: 0, error: 'retired' });
  }
  helpers = undefined;
}
/** Send each helper the font binaries it does not have yet. */
function shareFonts(helper: Helper) {
  const missing = [...fonts.received, ...fontBinaries()].filter(font => {
    const key = `${font.family}:${font.weight}:${font.range}`;
    if (helper.sent.has(key)) return false;
    helper.sent.add(key);
    return true;
  });
  if (missing.length) helper.worker.postMessage({ kind: 'fonts', fonts: missing } satisfies HelperRequest);
}
/** Longest paragraphs first into the least-loaded share: deterministic, so a
 *  paragraph stays with the helper whose cache already holds its widths. */
function split(texts: string[], parts: number): number[][] {
  const shares = Array.from({ length: parts }, () => ({ load: 0, indices: [] as number[] }));
  const order = texts.map((_, i) => i).sort((a, b) => texts[b].length - texts[a].length || a - b);
  for (const i of order) {
    const lightest = shares.reduce((best, share) => share.load < best.load ? share : best);
    lightest.indices.push(i);
    lightest.load += texts[i].length + 1;
  }
  return shares.map(share => share.indices);
}

let helperRequest = 0;
async function searchInParallel(request: ComposeRequest, pool: Helper[]) {
  const id = ++helperRequest;
  const shares = split(request.paragraphs, pool.length);
  const responses = await Promise.all(pool.map((helper, h) => new Promise<HelperResponse>(resolve => {
    shareFonts(helper);
    helper.waiting.set(id, resolve);
    helper.worker.postMessage({ kind: 'work', id, settings: request.settings, typeface: request.typeface,
      direction: request.direction,
      paragraphs: shares[h].map(index => ({ index, text: request.paragraphs[index] })) } satisfies HelperRequest);
  })));
  if (responses.some(response => response.error)) return undefined;
  const options: { layouts: Layout[]; explored: number }[] = new Array(request.paragraphs.length);
  for (const response of responses) for (const { index, packed } of response.results) {
    options[index] = unpackCandidates(packed, request.paragraphs[index]);
  }
  return {
    options,
    measurements: responses.reduce((n, r) => n + r.measurements, 0),
    // Helpers measure concurrently: the slowest share is what the reader waits for.
    measureMs: Math.max(...responses.map(r => r.measureMs)),
  };
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
      await fonts.install(request.fonts);
      scope.postMessage({ kind: 'warm-fonts' });
      // Long documents: start helpers now, while the page paints, so each warms
      // its search and fonts early. Short ones never start them: every helper
      // holds its own copy of the fonts and measurement cache.
      if (request.text.length >= PARALLEL_CHARACTERS) for (const helper of spawnHelpers() ?? []) shareFonts(helper);
      await kernelReady;
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
    await kernelReady;
    if (!await fonts.install(request.fonts)) {
      // The page could not hand over its fonts. Fetching them here is the slow
      // path and can hang in some worker implementations, so bound it and let the
      // page compose on the main thread instead of waiting forever.
      const loaded = await Promise.race([
        loadFonts(request.typeface, request.paragraphs.join('\n'), scope.fonts).then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
      ]);
      if (!loaded) throw new Error('worker could not prepare its fonts');
    }
    await fonts.installSteps(request.settings.widthFlex ?? 0);
    const fontMs = performance.now() - start;
    const key = `${request.typeface}:${request.settings.fontSize}:${request.direction}`;
    if (key !== fontKey) {
      cached = createMeasure(request.settings, request.typeface, request.direction);
      fontKey = key;
    }
    const countBefore = cached.calls;
    const timeBefore = cached.duration;
    const searchStart = performance.now();
    const pool = request.paragraphs.join('').length >= PARALLEL_CHARACTERS ? spawnHelpers() : undefined;
    const parallel = pool ? await searchInParallel(request, pool) : undefined;
    const options = parallel?.options ?? request.paragraphs.map(text =>
      paragraphCandidates(text, cached.measure, request.settings, 32, cached.measureAt));
    const result = composeCandidates(options, request.settings);
    const compositionMs = performance.now() - searchStart;
    const measureMs = parallel ? parallel.measureMs : cached.duration - timeBefore;
    cached.trim();
    scope.postMessage({ id: request.id, result, elapsed: performance.now() - start,
      measurements: parallel ? parallel.measurements : cached.calls - countBefore, fontMs,
      measureMs, searchMs: Math.max(0, compositionMs - measureMs),
      engine: await kernelReady ? 'wasm' : 'js', helpers: parallel ? pool!.length : 0 });
  } catch (error) {
    scope.postMessage({ id: request.id, elapsed: performance.now() - start, measurements: 0,
      fontMs: 0, measureMs: 0, searchMs: 0,
      error: error instanceof Error ? error.message : String(error) });
  }
};

// Announce readiness only after installing the handler. Module imports may
// suspend evaluation; messages posted during that gap would otherwise be lost.
scope.postMessage({ kind: 'booted' });
