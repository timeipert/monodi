/**
 * Raised text after a caret. The data of the Corpus Monodicum write a superscript with `^`: `59^CM` (number 59 of the
 * edition CM), `14^1`. In the PDF the part after the caret, up to the next space or closing punctuation, is set smaller
 * and raised, and the caret itself is not printed. The patch wraps `text` and `getTextWidth` of one jsPDF document, so
 * every heading, apparatus line and label gets it without changes at the places that draw text.
 */
export const SUP_SCALE = 0.68;
const CARET = /\^([^\s^:;,.)\]]+)/g;

export interface CaretPart { t: string; sup: boolean }

/** `'59^CM: x'` → `[{t: '59'}, {t: 'CM', sup}, {t: ': x'}]`; null if the text has no caret to raise. */
export function caretParts(text: string): CaretPart[] | null {
  if (!text.includes('^')) return null;
  const out: CaretPart[] = [];
  let last = 0;
  for (const m of text.matchAll(CARET)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index), sup: false });
    out.push({ t: m[1], sup: true });
    last = m.index! + m[0].length;
  }
  if (!out.length) return null;
  if (last < text.length) out.push({ t: text.slice(last), sup: false });
  return out;
}

export function withCaretSuperscript<T extends { text: any; getTextWidth: any; getFontSize: any; setFontSize: any }>(doc: T): T {
  const d = doc as any;
  if (d.__caretSuperscript) return doc;
  const text = d.text.bind(d);
  const width = d.getTextWidth.bind(d);
  const partWidth = (p: CaretPart): number => {
    if (!p.sup) return width(p.t);
    const fs = d.getFontSize();
    d.setFontSize(fs * SUP_SCALE);
    const w = width(p.t);
    d.setFontSize(fs);
    return w;
  };
  d.getTextWidth = (t: string): number => {
    const parts = typeof t === 'string' ? caretParts(t) : null;
    return parts ? parts.reduce((a, p) => a + partWidth(p), 0) : width(t);
  };
  d.text = (t: any, x: number, y: number, options?: any, transform?: any) => {
    // several lines in one call (rubrics): each line on its own, so that a caret or a drawn mark in it is handled
    if (Array.isArray(t) && !transform && t.some((l) => typeof l === 'string' && /[\^⟨⟩⌞⌟]/.test(l))) {
      const lh = d.getFontSize() * d.getLineHeightFactor();
      t.forEach((line: string, i: number) => d.text(line, x, y + i * lh, options));
      return doc;
    }
    const parts = typeof t === 'string' && !transform && !(options && (options.angle || options.maxWidth)) ? caretParts(t) : null;
    if (!parts) return text(t, x, y, options, transform);
    const total = parts.reduce((a, p) => a + partWidth(p), 0);
    const align = options?.align;
    let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    const rest = options ? { ...options, align: 'left' } : undefined;
    const fs = d.getFontSize();
    for (const p of parts) {
      if (p.sup) {
        d.setFontSize(fs * SUP_SCALE);
        text(p.t, cx, y - fs * 0.33, rest);
        d.setFontSize(fs);
      } else text(p.t, cx, y, rest);
      cx += partWidth(p);
    }
    return doc;
  };
  d.__caretSuperscript = true;
  return doc;
}
