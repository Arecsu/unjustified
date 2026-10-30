import serifCss from '@fontsource-variable/source-serif-4/index.css?inline';
import sansCss from '@fontsource-variable/dm-sans/index.css?inline';
import robotoCss from '@fontsource-variable/roboto-flex/wdth.css?inline';
import japaneseCss from '@fontsource-variable/noto-sans-jp/index.css?inline';
import arabicCss from '@fontsource-variable/noto-sans-arabic/wdth.css?inline';
import { hasArabic, hasJapanese } from './language';
import { parseRange } from './unicode-range';
import type { Language } from './language';

export type Typeface = 'serif' | 'sans' | 'classic' | 'roboto' | 'japanese' | 'arabic';
export const fontLanguages: Record<Typeface, readonly Language[]> = {
  serif: ['en'], sans: ['en'], classic: ['en'], roboto: ['en'],
  japanese: ['en', 'ja'], arabic: ['en', 'ar'],
};
const jp = '"Noto Sans JP Variable"';
const ar = '"Noto Sans Arabic Variable"';
export const families: Record<Typeface, string> = {
  serif: `"Source Serif 4 Variable", ${jp}, ${ar}, Georgia, serif`,
  sans: `"DM Sans Variable", ${jp}, ${ar}, Arial, sans-serif`,
  classic: `Georgia, ${jp}, ${ar}, serif`,
  roboto: `"Roboto Flex Variable", ${jp}, ${ar}, Arial, sans-serif`,
  japanese: `${jp}, ${ar}, sans-serif`,
  arabic: `${ar}, ${jp}, sans-serif`,
};
const css = { serif: serifCss, sans: sansCss, roboto: robotoCss, japanese: japaneseCss, arabic: arabicCss };
/** `stretch` is the face's declared wdth range ("62.5% 100%"), or '' without a width axis. */
interface Face { family: string; url: string; weight: string; stretch: string; range: string; intervals: number[][] }
const definitions = new Map<string, Face[]>();
const pending = new Map<string, Promise<void>>();
/** Fetched font binaries, so the worker can build its faces without fetching
 *  the same subsets again (a duplicate download and parse on every cold start). */
const binaries = new Map<string, ArrayBuffer>();
function facesFor(key: keyof typeof css): Face[] {
  if (definitions.has(key)) return definitions.get(key)!;
  const faces = [...css[key].matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, body]) => {
    const family = /font-family:\s*([^;]+)/.exec(body)![1].trim().replace(/^['"]|['"]$/g, '');
    const url = /url\(['"]?([^)'"\s]+)/.exec(body)![1];
    const weight = /font-weight:\s*([^;]+)/.exec(body)![1];
    const stretch = /font-stretch:\s*([^;]+)/.exec(body)?.[1].trim() ?? '';
    const range = /unicode-range:\s*([^;]+)/.exec(body)![1];
    const intervals = range.split(',').map(part => parseRange(part.trim()));
    return { family, url, weight, stretch, range, intervals };
  });
  definitions.set(key, faces);
  return faces;
}
/** The same font subsets are explicitly installed on the page and in the worker.
 * Only subsets intersecting the current text are fetched, including Japanese.
 */
export async function loadFonts(typeface: Typeface, text: string, set: FontFaceSet): Promise<void> {
  const keys = new Set<keyof typeof css>();
  if (typeface !== 'classic') keys.add(typeface);
  if (hasJapanese(text)) keys.add('japanese');
  if (hasArabic(text)) keys.add('arabic');
  const points = [...new Set(Array.from(text, char => char.codePointAt(0)!))];
  const jobs: Promise<void>[] = [];
  for (const key of keys) for (const face of facesFor(key)) {
    if (!points.some(cp => face.intervals.some(([a, b]) => cp >= a && cp <= b))) continue;
    const id = `${key}:${face.url}`;
    let job = pending.get(id);
    if (!job) {
      job = (async () => {
        const response = await fetch(new URL(face.url, import.meta.url));
        if (!response.ok) throw new Error(`Font download failed (${response.status})`);
        const data = await response.arrayBuffer();
        binaries.set(id, data);
        const font = new FontFace(face.family, data, { weight: face.weight, unicodeRange: face.range,
          ...(face.stretch ? { stretch: face.stretch } : {}) });
        // Add before loading to avoid stale fallback-font measurements in WebKit.
        set.add(font);
        await font.load();
      })().catch(error => { pending.delete(id); throw error; });
      pending.set(id, job);
    }
    jobs.push(job);
  }
  await Promise.all(jobs);
}

export interface FontBinary { family: string; weight: string; stretch: string; range: string; data: ArrayBuffer }

/** Every subset this page has already fetched, as plain data for another
 *  thread. Callers must `await loadFonts(...)` for the current text first, which
 *  guarantees the set is complete for that text. Copied, not transferred: the
 *  page's FontFace objects still reference these buffers. */
export function fontBinaries(): FontBinary[] {
  const result: FontBinary[] = [];
  for (const [id, data] of binaries) {
    const [key, ...rest] = id.split(':');
    const face = facesFor(key as keyof typeof css).find(candidate => candidate.url === rest.join(':'));
    if (face && data) result.push({ family: face.family, weight: face.weight, stretch: face.stretch, range: face.range, data });
  }
  return result;
}

/** The typeface's own wdth range in percent, or null when it has no width axis. */
export function widthRange(typeface: Typeface): [number, number] | null {
  if (typeface === 'classic') return null;
  const stretch = facesFor(typeface)[0]?.stretch;
  if (!stretch) return null;
  const [min, max] = stretch.split(/\s+/).map(parseFloat);
  return [min, max ?? min];
}

/** Whole-percent steps that width flex (0–0.4) may condense to. */
export function widthSteps(flex: number): number[] {
  const steps: number[] = [];
  for (let step = 100 - Math.round(flex * 100); step < 100; step++) steps.push(step);
  return steps;
}

const stepFamily = (family: string, step: number) => `${family} w${step}`;

/**
 * Canvas only takes width keywords, and the wdth axis is not linear enough to
 * interpolate (research/SPIKES.md). So every width-capable subset is registered
 * once more per step, as `<family> wN` with a single-value `stretch` descriptor:
 * Canvas matches it at its default stretch and the axis is clamped to N, the
 * width the DOM draws at `font-stretch: N%`. Each keeps its `unicode-range`, so
 * glyphs come from the same subsets as on the page.
 */
export async function installWidthSteps(fonts: FontBinary[], steps: number[], set: FontFaceSet,
  installed: Map<string, Promise<FontFace>>): Promise<void> {
  for (const font of fonts) {
    if (!font.stretch) continue;
    for (const step of steps) {
      const key = `${font.family}:${font.weight}:${font.range}:${step}`;
      if (installed.has(key)) continue;
      const face = new FontFace(stepFamily(font.family, step), font.data,
        { weight: font.weight, unicodeRange: font.range, stretch: `${step}%` });
      set.add(face);
      installed.set(key, face.load());
    }
  }
  await Promise.all(installed.values());
}

/** The CSS font stack for Canvas at a width step: width-capable families are
 *  swapped for their step faces; the others are unaffected, as in the DOM. */
export function familiesAt(typeface: Typeface, step: number): string {
  if (step === 100) return families[typeface];
  return families[typeface].replace(/"(Roboto Flex Variable|Noto Sans Arabic Variable)"/g,
    (_, family: string) => `"${stepFamily(family, step)}"`);
}
