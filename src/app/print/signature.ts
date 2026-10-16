/**
 * The signature of a section (A, B, 2a …) stands in the narrow margin before the staff. Usually it is a
 * letter or a number; but the field takes any text, and a long one must neither run off the page nor
 * into the music: it is set smaller and, if that is not enough, broken into several lines.
 * Pure: the caller says how wide a text is.
 */
export interface SignatureLines { lines: string[]; size: number }

export type Measure = (text: string, size: number) => number;

/** Breaks a word that is wider than `maxW` into pieces by characters (at least one character each). */
function breakWord(word: string, maxW: number, size: number, measure: Measure): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of Array.from(word)) {
    if (cur && measure(cur + ch, size) > maxW) { out.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function wrap(text: string, maxW: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const pieces = measure(word, size) > maxW ? breakWord(word, maxW, size, measure) : [word];
    pieces.forEach((piece, k) => {
      const joined = cur && k === 0 ? cur + ' ' + piece : '';
      if (joined && measure(joined, size) <= maxW) cur = joined;
      else { if (cur) lines.push(cur); cur = piece; }
    });
  }
  if (cur) lines.push(cur);
  return lines;
}

/** `maxW`: the room before the staff; `size`: the usual font size. */
export function layoutSignature(text: string, maxW: number, size: number, measure: Measure): SignatureLines {
  const t = (text || '').trim();
  if (!t) return { lines: [], size };
  if (measure(t, size) <= maxW) return { lines: [t], size };
  const small = size * 0.8;
  if (measure(t, small) <= maxW) return { lines: [t], size: small };
  return { lines: wrap(t, maxW, small, measure), size: small };
}
