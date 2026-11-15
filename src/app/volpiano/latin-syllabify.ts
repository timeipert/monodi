/**
 * Experimental, best-effort syllabification of Latin chant text, aligned to a
 * Volpiano melody.
 *
 * The Cantus databases store prose full-text plus a Volpiano melody; they do not
 * serve a pre-split text, and cantusdatabase.org blocks cross-origin requests, so
 * a syllabified text cannot be fetched from the browser. Instead we take the
 * syllable/word structure *from the melody* (its `--` = syllable, `---` = word)
 * and split the Latin text to match — forcing each word to the syllable count the
 * melody dictates. Where text and melody disagree it degrades gracefully and warns.
 */

const VOWELS = new Set('aeiouyAEIOUY'.split(''));
const DIPHTHONGS = new Set(['ae', 'oe', 'au', 'eu', 'ei', 'ui']);
const DIGRAPHS = new Set(['ch', 'ph', 'th', 'gn', 'qu', 'gu', 'sc']);

function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

/**
 * The `u` of "qu" (quod, aqua, qui) and of "ngu" before a vowel (lingua, sanguis) is a consonant: it does not carry a
 * syllable. Without this rule "Quadraginta" is split as "Qu-a-dra-gin-ta", with a first syllable that has no vowel.
 */
function isConsonantalU(chars: string[], i: number): boolean {
  if (chars[i].toLowerCase() !== 'u') return false;
  const before = (chars[i - 1] ?? '').toLowerCase();
  if (before === 'q') return true;
  return before === 'g' && (chars[i - 2] ?? '').toLowerCase() === 'n' && isVowel(chars[i + 1] ?? '');
}

/** The token that stands for a melody syllable without text in the aligned text (a whitespace-separated list). */
export const EMPTY_SYLLABLE = '_';

/** Split a single Latin word into syllables (heuristic; count is corrected later). */
export function syllabifyLatin(word: string): string[] {
  const chars = word.split('');
  const n = chars.length;
  if (n === 0) return [];

  // 1. Nuclei: vowel groups, merging recognised diphthongs.
  const nuclei: { start: number; end: number }[] = [];
  let i = 0;
  while (i < n) {
    if (isVowel(chars[i]) && !isConsonantalU(chars, i)) {
      const two = (chars[i] + (chars[i + 1] || '')).toLowerCase();
      if (i + 1 < n && isVowel(chars[i + 1]) && !isConsonantalU(chars, i + 1) && DIPHTHONGS.has(two)) {
        nuclei.push({ start: i, end: i + 1 });
        i += 2;
      } else {
        nuclei.push({ start: i, end: i });
        i += 1;
      }
    } else {
      i++;
    }
  }
  if (nuclei.length <= 1) return [word];

  // 2. Cut points between consecutive nuclei.
  const cuts: number[] = [];
  for (let k = 0; k < nuclei.length - 1; k++) {
    const consonants: number[] = [];
    for (let c = nuclei[k].end + 1; c < nuclei[k + 1].start; c++) consonants.push(c);

    let cutAt: number;
    if (consonants.length === 0) {
      cutAt = nuclei[k + 1].start; // hiatus
    } else if (consonants.length === 1) {
      cutAt = consonants[0]; // single consonant → onset of next syllable
    } else {
      const c1 = chars[consonants[consonants.length - 2]].toLowerCase();
      const c2 = chars[consonants[consonants.length - 1]].toLowerCase();
      const mutaCumLiquida = 'pbtdcgf'.includes(c1) && 'lr'.includes(c2);
      const digraph = DIGRAPHS.has(c1 + c2);
      // "s" + p/t before the next vowel opens the next syllable when a consonant precedes it: con-spec-tu.
      const sImpure = consonants.length >= 3 && c1 === 's' && 'ptcq'.includes(c2);
      cutAt = mutaCumLiquida || digraph || sImpure ? consonants[consonants.length - 2] : consonants[consonants.length - 1];
    }
    cuts.push(cutAt);
  }

  // 3. Slice.
  const sylls: string[] = [];
  let prev = 0;
  for (const cut of cuts) {
    sylls.push(word.slice(prev, cut));
    prev = cut;
  }
  sylls.push(word.slice(prev));
  return sylls.filter((s) => s.length > 0);
}

/** Coerce a syllable list to exactly `k` syllables by merging or splitting. */
export function forceSyllableCount(sylls: string[], k: number): string[] {
  if (k <= 0) return [];
  if (sylls.length === 0) return new Array(k).fill('');
  if (sylls.length === k) return sylls;

  if (sylls.length > k) {
    // Merge the surplus into the final kept syllable.
    const head = sylls.slice(0, k - 1);
    const tail = sylls.slice(k - 1).join('');
    return [...head, tail];
  }

  // Too few: the melody has more syllables than the word (a melisma over the end of the word). A syllable is never cut
  // into pieces without a vowel; the remaining melody syllables stay without text.
  const out = sylls.slice();
  while (out.length < k) out.push('');
  return out;
}

/** Per-word syllable counts implied by a Volpiano melody. */
export function melodyWordSyllableCounts(volpiano: string): number[] {
  // Drop clef/barline/break markers (digits 1–7; pitches use only 8/9), keep pitch
  // letters, the low liquescent ')', and hyphens.
  const cleaned = (volpiano || '')
    .replace(/[1-7]/g, ' ')
    .replace(/[^0-9A-Za-z)\-]/g, '')
    .replace(/\s+/g, '');

  const words = cleaned.split(/-{3,}/).filter((w) => /[0-9A-Za-z)]/.test(w));
  return words.map((word) => {
    const sylls = word.split(/-{2}/).filter((syl) => /[0-9A-Za-z)]/.test(syl));
    return Math.max(1, sylls.length);
  });
}

function splitTextWords(text: string): string[] {
  return (text || '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, ''))
    .filter((w) => w.length > 0);
}

export interface AlignedText {
  /** Whitespace-separated syllable tokens, one per melody syllable (for `textMode: 'syllables'`); `_` is a syllable without text. */
  text: string;
  warnings: string[];
}

/**
 * Produce syllable tokens aligned 1:1 with the melody's syllables. Feed the result
 * to `volpianoToRoot(melody, text, { textMode: 'syllables' })`.
 */
export function alignTextToMelody(volpiano: string, fulltext: string): AlignedText {
  const counts = melodyWordSyllableCounts(volpiano);
  const words = splitTextWords(fulltext);
  const warnings: string[] = [];

  if (words.length !== counts.length) {
    warnings.push(
      `melody has ${counts.length} word(s) but the text has ${words.length}; syllable text aligned by position`
    );
  }

  const tokens: string[] = [];
  const wordCount = Math.min(counts.length, words.length);
  for (let i = 0; i < wordCount; i++) {
    tokens.push(...forceSyllableCount(syllabifyLatin(words[i]), counts[i]).map((t) => (t === '' ? EMPTY_SYLLABLE : t)));
  }

  return { text: tokens.join(' '), warnings };
}
