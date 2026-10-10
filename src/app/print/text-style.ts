/**
 * How the lyric of a section is set in print, chosen per section status (e.g. entry marks in
 * small capitals). Pure: no jsPDF, no Angular.
 */
export type TextStyle = 'none' | 'smallcaps' | 'uppercase' | 'lowercase';

export const TEXT_STYLES: readonly TextStyle[] = ['none', 'smallcaps', 'uppercase', 'lowercase'];

/** How a lyric is drawn in small capitals: which letters stay full size. */
export type CapsMode = 'all' | 'first' | 'mixed';

export function isTextStyle(x: unknown): x is TextStyle {
  return typeof x === 'string' && (TEXT_STYLES as readonly string[]).includes(x);
}

/** The per-status styles from the settings: unknown styles are dropped, 'none' is the default. */
export function resolveStatusTextStyles(raw: unknown): { [status: string]: TextStyle } {
  const out: { [status: string]: TextStyle } = {};
  if (raw && typeof raw === 'object') {
    for (const [status, style] of Object.entries(raw as Record<string, unknown>)) {
      if (isTextStyle(style) && style !== 'none') out[status] = style;
    }
  }
  return out;
}

/** The lyric after the style: upper/lower case change the letters, the others leave them as typed. */
export function styledLyric(txt: string, style: TextStyle | undefined): string {
  if (style === 'uppercase') return txt.toLocaleUpperCase();
  if (style === 'lowercase') return txt.toLocaleLowerCase();
  return txt;
}

/** A lyric that is already all capitals (at least two letters): set in small capitals by default. */
export function isAllCaps(txt: string): boolean {
  return /\p{Lu}/u.test(txt) && !/\p{Ll}/u.test(txt) && (txt.match(/\p{L}/gu) || []).length >= 2;
}

/**
 * Small capitals of a lyric, or undefined for normal setting.
 * - 'none': only all-caps text gets them (the printed edition's habit); a continuation of a
 *   hyphenated word is all small, a word start keeps its first letter full size.
 * - 'smallcaps': every lyric; capitals stay full size, lower-case letters become small capitals.
 * - 'uppercase' / 'lowercase': never — the letters are what the user asked for.
 */
export function capsModeFor(txt: string, style: TextStyle | undefined, prevLyric: string): CapsMode | undefined {
  if (style === 'uppercase' || style === 'lowercase') return undefined;
  if (isAllCaps(txt)) return /[–-]$/.test(prevLyric) ? 'all' : 'first';
  if (style === 'smallcaps' && /\p{L}/u.test(txt)) return 'mixed';
  return undefined;
}

/**
 * Splits a small-caps lyric into runs of equal size. `text` is what is drawn: in 'mixed' mode the
 * small runs are upper-cased. Characters that are not letters take the size of the run before them.
 */
export function smallCapsRuns(txt: string, caps: CapsMode): { text: string; big: boolean }[] {
  const runs: { text: string; big: boolean }[] = [];
  let first = caps === 'first';
  for (const ch of Array.from(txt)) {
    const isLetter = /\p{L}/u.test(ch);
    let big: boolean;
    let drawn = ch;
    if (caps === 'mixed') {
      if (isLetter) {
        big = ch !== ch.toLocaleLowerCase();
        if (!big) drawn = ch.toLocaleUpperCase();
      } else {
        big = runs.length ? runs[runs.length - 1].big : false;
      }
    } else {
      big = first && isLetter;
      if (isLetter) first = false;
    }
    const last = runs[runs.length - 1];
    if (last && last.big === big) last.text += drawn; else runs.push({ text: drawn, big });
  }
  return runs;
}
