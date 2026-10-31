/**
 * Hyphenation points from TeX (Liang) patterns via the `hyphen` package, one
 * lazily loaded module per language. Browsers' own `hyphens: auto` cannot be
 * read back reliably (Chrome's results depend on its environment), and patterns
 * give the same breaks in every browser.
 */
import type { Hyphenation } from './language';
import { hasArabic, hasJapanese } from './language';

type Hyphenate = (text: string, options?: { hyphenChar?: string; minWordLength?: number }) => string;

/** Languages offered for hyphenation: value is the `hyphen` module name. */
export const hyphenationLanguages: [string, string][] = [
  ['en-us', 'English (US)'], ['en-gb', 'English (UK)'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'],
  ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['ca', 'Català'], ['sv', 'Svenska'], ['da', 'Dansk'],
  ['nb', 'Norsk bokmål'], ['fi', 'Suomi'], ['pl', 'Polski'], ['cs', 'Čeština'], ['sk', 'Slovenčina'], ['hu', 'Magyar'],
  ['ro', 'Română'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['uk', 'Українська'], ['el-monoton', 'Ελληνικά'],
];

type PatternModule = { hyphenateSync?: Hyphenate; default?: { hyphenateSync: Hyphenate } };
const loaders: Record<string, () => Promise<PatternModule>> = {
  'en-us': () => import('hyphen/en-us'), 'en-gb': () => import('hyphen/en-gb'), de: () => import('hyphen/de'),
  fr: () => import('hyphen/fr'), es: () => import('hyphen/es'), it: () => import('hyphen/it'),
  pt: () => import('hyphen/pt'), nl: () => import('hyphen/nl'), ca: () => import('hyphen/ca'),
  sv: () => import('hyphen/sv'), da: () => import('hyphen/da'), nb: () => import('hyphen/nb'),
  fi: () => import('hyphen/fi'), pl: () => import('hyphen/pl'), cs: () => import('hyphen/cs'),
  sk: () => import('hyphen/sk'), hu: () => import('hyphen/hu'), ro: () => import('hyphen/ro'),
  tr: () => import('hyphen/tr'), ru: () => import('hyphen/ru'), uk: () => import('hyphen/uk'),
  'el-monoton': () => import('hyphen/el-monoton'),
};
const loaded = new Map<string, Promise<Hyphenate>>();

export function loadHyphenator(language: string): Promise<Hyphenate> {
  let job = loaded.get(language);
  if (!job) {
    // CommonJS modules: the export may arrive as a named export or on `default`.
    job = loaders[language]().then(module => (module.hyphenateSync ?? module.default!.hyphenateSync));
    loaded.set(language, job);
  }
  return job;
}

export interface HyphenationOptions { minWord: number; minBefore: number; minAfter: number }

/** A hyphen is as bad as a line this far short: 20 % at 'Rare', 1 % at 'Frequent'. */
export const hyphenPenalty = (frequency: number) => 0.01 + 0.19 * (1 - frequency / 100) ** 2;

/** Break points for every word of `paragraphs` that may be hyphenated. Arabic
 *  and Japanese are never hyphenated; leading/trailing punctuation never
 *  counts toward the letters kept on either side. */
export function hyphenationPoints(paragraphs: string[], hyphenate: Hyphenate, options: HyphenationOptions): Hyphenation {
  const points: Hyphenation = {};
  for (const text of paragraphs) {
    if (hasArabic(text) || hasJapanese(text)) continue;
    for (const word of text.split(/\s+/u)) {
      if (!word || word in points) continue;
      const core = /^(\P{L}*)(.*?)(\P{L}*)$/u.exec(word)!;
      const [, lead, letters] = core;
      if ([...letters].length < options.minWord || /[^\p{L}\p{M}'’-]/u.test(letters)) continue;
      const marked = hyphenate(letters, { hyphenChar: '­', minWordLength: options.minWord });
      const found: number[] = [];
      let offset = 0;
      for (const piece of marked.split('­').slice(0, -1)) {
        offset += piece.length;
        if (offset >= options.minBefore && letters.length - offset >= options.minAfter && letters[offset - 1] !== '-') {
          found.push(lead.length + offset);
        }
      }
      if (found.length) points[word] = found;
    }
  }
  return points;
}
