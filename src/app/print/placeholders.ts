/**
 * Placeholders in print texts: `$gattung1$en aus $quelle$` becomes "Antiphonen aus Aachen, Domarchiv, Hs. G 13".
 * Names are case-insensitive; `$$` is a literal dollar sign. Pure: the caller says what a name stands for.
 */
export type PlaceholderLookup = (name: string) => string | undefined;

export interface Resolved {
  text: string;
  /** Names that no field knows (the text shows nothing for them). */
  unknown: string[];
  /** Names that stood for an empty value. */
  empty: string[];
  /** Number of placeholders in the text. */
  count: number;
}

const PLACEHOLDER = /\$\$|\$([\p{L}\p{N}_.-]+)\$/gu;

/** The names used in a text, in order of appearance, without duplicates (lower case). */
export function placeholderNames(text: string): string[] {
  const names: string[] = [];
  for (const m of (text || '').matchAll(PLACEHOLDER)) {
    const n = m[1]?.toLowerCase();
    if (n && !names.includes(n)) names.push(n);
  }
  return names;
}

export function resolvePlaceholders(text: string, lookup: PlaceholderLookup): Resolved {
  const unknown: string[] = [];
  const empty: string[] = [];
  let count = 0;
  const out = (text || '').replace(PLACEHOLDER, (all, name: string | undefined) => {
    if (!name) return '$';
    count++;
    const key = name.toLowerCase();
    const v = lookup(key);
    if (v === undefined) { if (!unknown.includes(key)) unknown.push(key); return ''; }
    if (!v.trim()) { if (!empty.includes(key)) empty.push(key); return ''; }
    return v;
  });
  return { text: out, unknown, empty, count };
}

/**
 * The text of one block as lines. A line keeps its blank lines (they are spacing). With `hideIfEmpty`, a block in which
 * a placeholder stands for nothing is left out altogether ("herausgegeben von $herausgeber$" without an editor).
 * Returns null when the block is not to be printed.
 */
export function resolveBlock(text: string, lookup: PlaceholderLookup, hideIfEmpty: boolean): string[] | null {
  const r = resolvePlaceholders(text, lookup);
  if (hideIfEmpty && (r.empty.length || r.unknown.length)) return null;
  const lines = r.text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.length ? lines : null;
}
