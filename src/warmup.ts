import { compose, paragraphCandidates } from './optimizer';

/**
 * Exercise the search once with throwaway input so the first real composition
 * runs optimized code. Measured on a 40-paragraph document: the same search took
 * 115 ms in a fresh worker and 38 ms afterwards, i.e. a 3x interpreter penalty
 * paid exactly once, on the composition the reader is waiting for. Costs a few
 * milliseconds here, off the main thread, while the page is still painting.
 */
export function warmUpSearch() {
  const settings = { width: 390, fontSize: 19, trackingMin: -0.012, trackingMax: 0.012,
    rag: 0.055, minEnding: 0.32, sync: 0.65, protectEndings: true };
  const sample = 'Warm the composing engine with a paragraph of ordinary length so that '
    + 'its search and measurement paths are compiled before real work arrives. ';
  const text = sample.repeat(3).trim();
  const stub = (value: string) => value.length * 8.4;
  paragraphCandidates(text, stub, settings);
  compose([text, text, text], stub, settings);
}
