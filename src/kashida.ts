/**
 * Kashida (tatweel, U+0640) placement for Arabic lines.
 *
 * A tatweel can only lengthen an existing connection: between a letter that
 * joins forward and a letter that joins backward. Sites are ranked by the
 * traditional priority used in Arabic typesetting:
 *   1. after a seen/sad-family letter (س ش ص ض),
 *   2. before a final ة ه د ذ,
 *   3. before a final ا ل ك,
 *   4. any other connection.
 * Lam-alef is never split (it is a ligature), and diacritics stay on their
 * base letter. A word takes at most one site; extra tatweels stack there.
 */
export const TATWEEL = 'ـ';

const LETTER = /[ؠ-يٮ-ۓۺ-ۼـ]/u;
const MARK = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/u;
/** Letters that connect to the previous letter but never to the next one. */
const RIGHT_JOINING = new Set('اأإآٱدذرزوؤةژڈڑۀەۃ');
const ALEF = new Set('اأإآٱ');
const SEEN = new Set('سشصض');
const FINAL_HEH = new Set('ةهدذ');
const FINAL_ALEF = new Set('اأإآٱلكک');

const joinsForward = (c: string) => LETTER.test(c) && c !== 'ء' && !RIGHT_JOINING.has(c);
const joinsBackward = (c: string) => LETTER.test(c) && c !== 'ء';

export interface Site { offset: number; priority: number }

/** Every place a tatweel may go in `word`, best first. Offsets are UTF-16
 *  indices: the tatweel is inserted before `word[offset]`. */
export function kashidaSites(word: string): Site[] {
  // Base letters with the index just past their marks.
  const letters: { char: string; index: number; end: number }[] = [];
  for (let i = 0; i < word.length; i++) {
    if (MARK.test(word[i])) {
      if (letters.length && letters[letters.length - 1].end === i) letters[letters.length - 1].end = i + 1;
      continue;
    }
    // Punctuation and digits are skipped: the adjacency check below treats the
    // gap as a break, so trailing punctuation never hides the final letter.
    if (LETTER.test(word[i])) letters.push({ char: word[i], index: i, end: i + 1 });
  }
  const sites: Site[] = [];
  for (let i = 0; i + 1 < letters.length; i++) {
    const a = letters[i], b = letters[i + 1];
    if (b.index !== a.end || !joinsForward(a.char) || !joinsBackward(b.char)) continue;
    if (a.char === 'ل' && ALEF.has(b.char)) continue;
    const final = i + 1 === letters.length - 1;
    const priority = SEEN.has(a.char) ? 1
      : final && FINAL_HEH.has(b.char) ? 2
        : final && FINAL_ALEF.has(b.char) ? 3
          : 4;
    sites.push({ offset: a.end, priority });
  }
  // Same priority: later in the word first.
  return sites.sort((x, y) => x.priority - y.priority || y.offset - x.offset);
}

const siteCache = new Map<string, Site | null>();
/** The single site a word uses, or null. Cached: lines repeat words often. */
export function bestSite(word: string): Site | null {
  let site = siteCache.get(word);
  if (site === undefined) {
    site = kashidaSites(word)[0] ?? null;
    if (siteCache.size > 50000) siteCache.clear();
    siteCache.set(word, site);
  }
  return site;
}

/**
 * Distribute `count` tatweels over a line's words: best priority first, then
 * from the end of the line, one per word before any stacking. Returns, per
 * word, how many tatweels it receives (0 for most words).
 */
export function placeKashida(words: string[], count: number): number[] {
  const result = new Array<number>(words.length).fill(0);
  if (count <= 0) return result;
  const order: number[] = [];
  for (let i = 0; i < words.length; i++) if (bestSite(words[i])) order.push(i);
  if (!order.length) return result;
  order.sort((a, b) => bestSite(words[a])!.priority - bestSite(words[b])!.priority || b - a);
  for (let j = 0; j < count; j++) result[order[j % order.length]]++;
  return result;
}

/** Split `word` around its site for rendering: [before, after]. */
export function splitAtSite(word: string): [string, string] {
  const site = bestSite(word);
  return site ? [word.slice(0, site.offset), word.slice(site.offset)] : [word, ''];
}
