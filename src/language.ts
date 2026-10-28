import LineBreaker from 'linebreak';
export type Language = 'en' | 'ja' | 'ar';
export type Direction = 'ltr' | 'rtl';
export type DirectionPolicy = 'auto' | Direction;
export const hasArabic = (text: string) => /\p{Script=Arabic}/u.test(text);
export const hasJapanese = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
export function detectLanguage(text: string): Language {
  return hasArabic(text) ? 'ar' : hasJapanese(text) ? 'ja' : 'en';
}
export function directionFor(text: string, policy: DirectionPolicy): Direction {
  if (policy !== 'auto') return policy;
  for (const char of text) {
    if (/\p{Letter}/u.test(char)) return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(char) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}
export const normalizeText = (text: string) => text.trim().replace(/[\t\n\r\f ]+/g, ' ');
export function segmentText(text: string): { units: string[]; separator: string } {
  const normalized = normalizeText(text);
  if (!hasJapanese(normalized)) return { units: normalized ? normalized.split(' ') : [], separator: ' ' };
  // UAX #14 opportunities preserve Japanese punctuation groups without inserting
  // Latin-style spaces. This package's tables are Unicode 13, not full browser tailoring.
  const breaker = new LineBreaker(normalized);
  const units: string[] = [];
  let start = 0;
  for (let next = breaker.nextBreak(); next; next = breaker.nextBreak()) {
    units.push(normalized.slice(start, next.position));
    start = next.position;
  }
  return { units, separator: '' };
}
