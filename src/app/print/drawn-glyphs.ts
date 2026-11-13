/**
 * Marks of the editions that the text fonts of Monodi-Zero lack, drawn as strokes: the angle brackets ⟨ ⟩ (editorial
 * addition, ⟨...⟩ editorial omission) and the corner marks ⌞ ⌟ (the extent of a lemma in the edition), in the shape of
 * the printed volumes of the Corpus Monodicum. The patch wraps `text` and `getTextWidth` of one jsPDF document, so the
 * marks print wherever text is drawn; it must be applied before `withCaretSuperscript`.
 */
const MARKS = /[⟨⟩⌞⌟]/;
const WIDTH: Record<string, number> = { '⟨': 0.3, '⟩': 0.3, '⌞': 0.32, '⌟': 0.32 };   // in sizes of the font

export function withDrawnGlyphs<T>(doc: T): T {
  const d = doc as any;
  if (d.__drawnGlyphs) return doc;
  const text = d.text.bind(d);
  const width = d.getTextWidth.bind(d);
  const split = (t: string): string[] => t.split(/([⟨⟩⌞⌟])/).filter((x) => x !== '');
  const partWidth = (p: string): number => (WIDTH[p] !== undefined ? WIDTH[p] * d.getFontSize() : width(p));
  d.getTextWidth = (t: string): number => (typeof t === 'string' && MARKS.test(t) ? split(t).reduce((a, p) => a + partWidth(p), 0) : width(t));
  const mark = (m: string, x: number, y: number): void => {
    const f = d.getFontSize();
    const gw = WIDTH[m] * f;
    const lw0 = d.getLineWidth();
    const dc = d.getDrawColor();
    d.setLineWidth(f * 0.045);
    d.setDrawColor(d.getTextColor());
    if (m === '⟨' || m === '⟩') {
      const [outer, inner] = m === '⟨' ? [x + gw * 0.8, x + gw * 0.25] : [x + gw * 0.2, x + gw * 0.75];
      d.line(outer, y - f * 0.72, inner, y - f * 0.24);
      d.line(inner, y - f * 0.24, outer, y + f * 0.24);
    } else {
      const [vx, hx] = m === '⌞' ? [x + gw * 0.3, x + gw * 0.85] : [x + gw * 0.7, x + gw * 0.15];
      d.line(vx, y - f * 0.32, vx, y + f * 0.06);
      d.line(vx, y + f * 0.06, hx, y + f * 0.06);
    }
    d.setLineWidth(lw0);
    d.setDrawColor(dc);
  };
  d.text = (t: any, x: number, y: number, options?: any, transform?: any) => {
    if (typeof t !== 'string' || !MARKS.test(t) || transform || (options && (options.angle || options.maxWidth))) return text(t, x, y, options, transform);
    const parts = split(t);
    const total = parts.reduce((a, p) => a + partWidth(p), 0);
    const align = options?.align;
    let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    const rest = options ? { ...options, align: 'left' } : undefined;
    for (const p of parts) {
      if (WIDTH[p] !== undefined) mark(p, cx, y);
      else text(p, cx, y, rest);
      cx += partWidth(p);
    }
    return doc;
  };
  d.__drawnGlyphs = true;
  return doc;
}
