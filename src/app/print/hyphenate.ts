import { Hyphenate } from './markdown-layout';

/** Words shorter than this stay whole. */
const MIN_WORD = 5;

let sync: ((text: string) => string) | null = null;
let loading: Promise<void> | null = null;

/** Loads the German hyphenation patterns (a chunk of their own: only needed when a description is printed). */
export function loadHyphenation(): Promise<void> {
  loading ??= import('hyphen/de-1996').then((m: any) => { sync = (m.hyphenateSync ?? m.default?.hyphenateSync) || null; }).catch(() => { sync = null; });
  return loading;
}

/** The word in its syllables; `null` while the patterns are not loaded or when the word stays whole. */
export const hyphenateWord: Hyphenate = (word) => {
  if (!sync || word.length < MIN_WORD || !/\p{L}{3}/u.test(word)) return null;
  const parts = sync(word).split('­');
  return parts.length > 1 ? parts : null;
};
