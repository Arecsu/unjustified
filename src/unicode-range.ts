/** One `unicode-range` term: `U+41`, `U+0-FF`, or the wildcard `U+6??` that
 *  production CSS minification produces for `U+600-6FF`. */
export function parseRange(term: string): [number, number] {
  const [a, b] = term.slice(2).split('-');
  if (b !== undefined) return [parseInt(a, 16), parseInt(b, 16)];
  return [parseInt(a.replace(/\?/g, '0'), 16), parseInt(a.replace(/\?/g, 'F'), 16)];
}
