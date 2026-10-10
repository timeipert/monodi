import { MdInline } from './markdown';
import { FontStyle } from './rich-text';

/** Width of a line's pieces. */
export function lineWidth(line: MdLine): number {
  const last = line[line.length - 1];
  return last ? last.x + last.width : 0;
}

/** One run of text of a single style on a line, `x` relative to the line's left edge. */
export interface MdPiece { text: string; style: FontStyle; grey?: boolean; href?: string; x: number; width: number }
export type MdLine = MdPiece[];

type Measure = (text: string, style: FontStyle, size: number) => number;

interface Atom { pieces: Omit<MdPiece, 'x'>[]; width: number }

/**
 * Breaks inline Markdown into lines of at most `maxW` (the first line `firstW` if given).
 * Pieces that touch without whitespace between them (`**bold**,`) stay on one line; a single
 * word wider than a line is cut by characters. `bold` sets the whole text bold (headings).
 * Independent of jsPDF: the caller supplies how to measure.
 */
export function layoutInlines(ins: MdInline[], size: number, maxW: number, measure: Measure, opts: { bold?: boolean; firstW?: number } = {}): MdLine[] {
  const lines: MdLine[] = [[]];
  let x = 0;
  let limit = opts.firstW ?? maxW;
  const space = measure(' ', 'normal', size);
  let atom: Atom = { pieces: [], width: 0 };

  const newLine = () => { lines.push([]); x = 0; limit = maxW; };
  const styleOf = (i: MdInline): FontStyle => (opts.bold || i.bold ? 'bold' : i.italic ? 'italic' : 'normal');

  const place = (a: Atom) => {
    if (!a.pieces.length) return;
    const line = lines[lines.length - 1];
    const gap = line.length ? space : 0;
    if (line.length && x + gap + a.width > limit) { newLine(); return place(a); }
    if (!line.length && a.width > limit) {
      // longer than a whole line: cut by characters
      for (const p of a.pieces) {
        let rest = p.text;
        while (rest) {
          const cur = lines[lines.length - 1];
          let n = rest.length;
          while (n > 1 && x + measure(rest.slice(0, n), p.style, size) > limit) n--;
          const part = rest.slice(0, n);
          const w = measure(part, p.style, size);
          if (cur.length && x + w > limit) { newLine(); continue; }
          cur.push({ ...p, text: part, x, width: w });
          x += w;
          rest = rest.slice(n);
          if (rest) newLine();
        }
      }
      return;
    }
    let cx = x + gap;
    for (const p of a.pieces) { line.push({ ...p, x: cx, width: p.width }); cx += p.width; }
    x = cx;
  };
  const flush = () => { place(atom); atom = { pieces: [], width: 0 }; };

  for (const i of ins) {
    if (i.t === '\n' && !i.bold && !i.italic && !i.code && !i.href) { flush(); newLine(); continue; }
    const style = styleOf(i);
    for (const tok of i.t.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) { flush(); continue; }
      const width = measure(tok, style, size);
      atom.pieces.push({ text: tok, style, grey: i.code || undefined, href: i.href, width });
      atom.width += width;
    }
  }
  flush();
  return lines.filter((l, k) => l.length || k === 0);
}
