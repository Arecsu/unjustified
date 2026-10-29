/**
 * Deterministic, realistic-shaped blog-post corpus for benchmarks.
 * A seeded PRNG over a Zipf-ish English vocabulary produces prose with
 * realistic word lengths, sentence lengths and punctuation, so line-break
 * candidates and `measureText` call counts resemble a real article rather
 * than a repeated sample (which would hit measurement caches unrealistically).
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Roughly English word-frequency order; short function words are over-represented.
const vocabulary = `the of and to a in that is was he for it with as his on be at by i this had not are but from or have an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people mr how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three states himself few house use during without again place around however home small found thought went say part once general high upon school every don t does got united left number course war until always away something fact water though less public put think almost hand enough far took head yet government system better set told nothing night end why didn t called didn eyes face point cried voice next morning whole half story hundred front word quiet table window garden book light afternoon weather leaf map street slow difficult comfortable balance shape paragraph line edge words space rhythm sentence page read reader letter spacing break composition margin ragged align straight lonely ending settle deliberate consider possibility choose look ahead measure`

export const WORDS = vocabulary.split(/\s+/).filter(Boolean);

export function makeParagraphs(count: number, seed = 0x51ed) {
  const random = mulberry32(seed);
  const pick = () => WORDS[Math.floor(Math.pow(random(), 1.6) * WORDS.length)];
  const paragraphs: string[] = [];
  for (let p = 0; p < count; p++) {
    const sentences: string[] = [];
    const sentenceCount = 3 + Math.floor(random() * 4);
    for (let s = 0; s < sentenceCount; s++) {
      const words: string[] = [];
      const wordCount = 6 + Math.floor(random() * 16);
      for (let w = 0; w < wordCount; w++) words.push(pick());
      words[0] = words[0][0].toUpperCase() + words[0].slice(1);
      // Occasional comma and an occasional longer, harder word.
      if (wordCount > 9) words[Math.floor(wordCount / 2)] += ',';
      if (random() < 0.12) words.push('counterintuitively');
      sentences.push(words.join(' ') + (random() < 0.1 ? '?' : '.'));
    }
    paragraphs.push(sentences.join(' '));
  }
  return paragraphs;
}

/** Total UTF-16 length, for the "blog post size" check. */
export const chars = (paragraphs: string[]) => paragraphs.reduce((n, p) => n + p.length, 0);
