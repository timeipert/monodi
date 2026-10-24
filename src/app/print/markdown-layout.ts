import { MdInline } from './markdown';
import { FontStyle } from './rich-text';

/** Width of a line's pieces. */
export function lineWidth(line: MdLine): number {
  const last = line[line.length - 1];
  return last ? last.x + last.width : 0;
}

/** Raised text (`<sup>`): its size relative to the line's and how far it is lifted (in sizes of the line). */
export const SUP_SIZE = 0.68;
export const SUP_RISE = 0.36;

/** One run of text of a single style on a line, `x` relative to the line's left edge. */
export interface MdPiece { text: string; style: FontStyle; /** Small capitals: the text is measured and drawn as such. */ sc?: boolean; /** Raised and smaller, see `SUP_SIZE`. */ sup?: boolean; grey?: boolean; href?: string; x: number; width: number }
export type MdLine = MdPiece[];

type Measure = (text: string, style: FontStyle, size: number, sc?: boolean) => number;

/** Where a word may be hyphenated: the word as its fragments (`['Hand', 'schrift']`), or `null` when it stays whole. */
export type Hyphenate = (word: string) => string[] | null;

interface Atom { pieces: Omit<MdPiece, 'x'>[]; width: number }

/**
 * Breaks inline Markdown into lines of at most `maxW` (the first line `firstW` if given).
 * Pieces that touch without whitespace between them (`**bold**,`) stay on one line; a single
 * word wider than a line is cut by characters. `bold` sets the whole text bold (headings).
 * A single word that does not fit on the rest of a line is hyphenated where `opts.hyphenate` allows (and after a hyphen
 * it already has). Independent of jsPDF: the caller supplies how to measure.
 */
export function layoutInlines(ins: MdInline[], size: number, maxW: number, measure: Measure, opts: { bold?: boolean; firstW?: number; hyphenate?: Hyphenate } = {}): MdLine[] {
  const lines: MdLine[] = [[]];
  let x = 0;
  let limit = opts.firstW ?? maxW;
  const space = measure(' ', 'normal', size);
  let atom: Atom = { pieces: [], width: 0 };

  const newLine = () => { lines.push([]); x = 0; limit = maxW; };
  const styleOf = (i: MdInline): FontStyle => (opts.bold || i.bold ? 'bold' : i.italic ? 'italic' : 'normal');

  /** The longest start of a single word that fits in `room` with its hyphen, and what is left of the word. */
  const splitWord = (a: Atom, room: number): { head: Atom; rest: Atom } | null => {
    if (a.pieces.length !== 1) return null;
    const p = a.pieces[0];
    const frags: string[] = [];
    for (const part of p.text.split(/(?<=[-\u2013])/)) {
      const inner = opts.hyphenate?.(part.replace(/[-\u2013]$/, ''));
      if (inner && inner.length > 1 && inner.join('') === part.replace(/[-\u2013]$/, '')) {
        inner.forEach((f, k) => frags.push(k === inner.length - 1 ? f + part.slice(inner.join('').length) : f));
      } else frags.push(part);
    }
    for (let k = frags.length - 1; k >= 1; k--) {
      const head = frags.slice(0, k).join('');
      const hyphen = /[-\u2013]$/.test(head) ? '' : '-';
      const w = measure(head + hyphen, p.style, p.sup ? size * SUP_SIZE : size, p.sc);
      if (w > room) continue;
      const rest = frags.slice(k).join('');
      if (head.length < 2 || rest.length < 3) continue;   // no single letter left at either end
      return {
        head: { pieces: [{ ...p, text: head + hyphen, width: w }], width: w },
        rest: { pieces: [{ ...p, text: rest, width: measure(rest, p.style, p.sup ? size * SUP_SIZE : size, p.sc) }], width: measure(rest, p.style, p.sup ? size * SUP_SIZE : size, p.sc) },
      };
    }
    return null;
  };

  const place = (a: Atom) => {
    if (!a.pieces.length) return;
    const line = lines[lines.length - 1];
    const gap = line.length ? space : 0;
    if (line.length && x + gap + a.width > limit) {
      const cut = splitWord(a, limit - x - gap);   // after a hyphen the word has, and where `opts.hyphenate` allows
      if (cut) { place(cut.head); newLine(); return place(cut.rest); }
      newLine();
      return place(a);
    }
    if (!line.length && a.width > limit) {
      // longer than a whole line: cut by characters
      for (const p of a.pieces) {
        let rest = p.text;
        while (rest) {
          const cur = lines[lines.length - 1];
          let n = rest.length;
          while (n > 1 && x + measure(rest.slice(0, n), p.style, p.sup ? size * SUP_SIZE : size, p.sc) > limit) n--;
          const part = rest.slice(0, n);
          const w = measure(part, p.style, p.sup ? size * SUP_SIZE : size, p.sc);
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
      const width = measure(tok, style, i.sup ? size * SUP_SIZE : size, i.sc);
      atom.pieces.push({ text: tok, style, sc: i.sc || undefined, sup: i.sup || undefined, grey: i.code || undefined, href: i.href, width });
      atom.width += width;
    }
  }
  flush();
  return lines.filter((l, k) => l.length || k === 0);
}
