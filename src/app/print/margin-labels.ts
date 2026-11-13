import { MdInline } from './markdown';

/**
 * Margin labels anchored inside a paragraph, as in the notes on use of the printed volumes of the Corpus Monodicum:
 * `{{*Editionsquellen*}}Als Editionsquellen werden …` sets "Editionsquellen" in italics in the margin, level with the line
 * on which the word after the marker stands (`{{**Die Quellen**}}`: in bold). The marker is taken out of the text.
 */
export interface MarginAnchor {
  /** How many words of the paragraph come before the marker: the label stands beside the line of word number `word`. */
  word: number;
  label: MdInline[];
}

export function hasMarginAnchors(ins: MdInline[]): boolean {
  const s = ins.map((i) => i.t).join('');
  return /\{\{[\s\S]+?\}\}/.test(s);
}

/** The paragraph without its markers, and where each marker stood (counted in words). */
export function extractMarginAnchors(ins: MdInline[]): { inlines: MdInline[]; anchors: MarginAnchor[] } {
  const out: MdInline[] = [];
  const anchors: MarginAnchor[] = [];
  let label: MdInline[] | null = null;
  let before = '';                       // the text kept so far, for counting words
  const words = () => before.split(/\s+/).filter(Boolean).length;
  for (const inl of ins) {
    let t = inl.t;
    while (t) {
      if (label === null) {
        const k = t.indexOf('{{');
        if (k < 0) { out.push({ ...inl, t }); before += t; break; }
        if (k > 0) { out.push({ ...inl, t: t.slice(0, k) }); before += t.slice(0, k); }
        label = [];
        t = t.slice(k + 2);
      } else {
        const k = t.indexOf('}}');
        if (k < 0) { if (t) label.push({ ...inl, t }); break; }
        if (k > 0) label.push({ ...inl, t: t.slice(0, k) });
        // a marker glued to the end of a word ("…{{x}}") belongs to the next word
        anchors.push({ word: words(), label: label.filter((x) => x.t.trim()) });
        label = null;
        t = t.slice(k + 2);
      }
    }
  }
  return { inlines: out.filter((x) => x.t !== ''), anchors };
}
