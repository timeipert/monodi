/**
 * Folio labels of a manuscript are written in many ways ("157", "46v", "f. 31v", "fol.3"). In
 * print they should look alike: once a manuscript is known to be foliated — somewhere its
 * labels say "f." — every bare folio reference gets the "f. " too.
 */
export type FolioPrefixMode = 'off' | 'auto' | 'always';

/** "f. 3", "f.3", "fol. 3", "folio 3v", "ff. 3" */
const PREFIXED = /^(?:f{1,2}|fol|folio)\.?\s*(\d.*)$/i;
/** "157", "46v", "85a", "3 r" — a bare folio reference, no other words */
const BARE = /^\d+\s*[rvab]{0,2}$/i;

export function sanitizeFolioPrefixMode(v: unknown): FolioPrefixMode {
  return v === 'off' || v === 'always' ? v : 'auto';
}

/** Whether any of the labels already says "f." (the manuscript is foliated). */
export function usesFolioPrefix(labels: readonly string[]): boolean {
  return labels.some((l) => PREFIXED.test((l || '').trim()));
}

/** The label as printed. `foliated`: the manuscript's labels use "f." somewhere. */
export function formatFolioLabel(label: string, mode: FolioPrefixMode, foliated: boolean): string {
  const t = (label || '').trim();
  if (!t || mode === 'off') return t;
  const m = PREFIXED.exec(t);
  if (m) return 'f. ' + m[1].trim();                               // one spelling: "f. 3v"
  if (BARE.test(t) && (mode === 'always' || foliated)) return 'f. ' + t.replace(/\s+/g, '');
  return t;
}
