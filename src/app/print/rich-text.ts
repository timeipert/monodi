/**
 * The apparatus' text markup and line breaking, independent of jsPDF (the caller supplies how to
 * measure and draw): plain = italic, ((quoted)) = roman, [[SIGLUM]] = bold small capitals,
 * {{boxed}} = framed.
 */
export type FontStyle = 'normal' | 'italic' | 'bold';
export interface Seg { w: string; style: FontStyle; size: number; grey?: boolean; boxed?: boolean; sep?: boolean }
export interface Word extends Seg { width: number; gapBefore: number }

export interface TextKit {
  width(text: string, style: FontStyle, size: number): number;
  draw(text: string, x: number, y: number, style: FontStyle, size: number, grey?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
}

export function markupSegments(text: string, fs: number): Seg[] {
  const segs: Seg[] = [];
  for (const token of (text || '').split(/(\(\(.*?\)\)|\{\{.*?\}\}|\[\[.*?\]\])/g)) {
    if (!token) continue;
    if (token.startsWith('((')) segs.push({ w: token.replace(/\(\(|\)\)/g, ''), style: 'normal', size: fs });
    else if (token.startsWith('[[')) segs.push({ w: token.replace(/\[\[|\]\]/g, '').toUpperCase(), style: 'bold', size: fs - 1 });
    else if (token.startsWith('{{')) segs.push({ w: token.replace(/\{\{|\}\}/g, ''), style: 'normal', size: fs, boxed: true });
    else segs.push({ w: token, style: 'italic', size: fs });
  }
  return segs;
}

/** Breaks segments into lines no wider than `maxW`; segments not separated by whitespace stay glued. */
export function breakLines(segs: Seg[], maxW: number, kit: TextKit): Word[][] {
  const lines: Word[][] = [[]];
  let x = 0;
  segs.forEach((seg, si) => {
    const startsWithSpace = /^\s/.test(seg.w);
    const words = seg.w.split(/\s+/).filter(Boolean);
    words.forEach((w, wi) => {
      const width = kit.width(w, seg.style, seg.size);
      const spaceW = kit.width(' ', 'normal', seg.size);
      const first = lines[lines.length - 1].length === 0;
      const glue = !first && wi === 0 && si > 0 && !startsWithSpace && !seg.sep && !/\s$/.test(segs[si - 1].w) && seg.style !== 'normal';
      const gap = first ? 0 : glue ? 0 : spaceW;
      if (!first && x + gap + width > maxW) { lines.push([{ ...seg, w, width, gapBefore: 0 }]); x = width; }
      else { lines[lines.length - 1].push({ ...seg, w, width, gapBefore: gap }); x += gap + width; }
    });
  });
  return lines.filter((l, i) => l.length || i === 0);
}

export function linesWidth(lines: Word[][]): number {
  return Math.max(0, ...lines.map((l) => l.reduce((a, w) => a + w.gapBefore + w.width, 0)));
}

/** Draws lines with their first baseline at `y`. */
export function drawLines(lines: Word[][], x: number, y: number, lh: number, kit: TextKit): void {
  lines.forEach((line, li) => {
    let cx = x;
    const by = y + li * lh;
    for (const w of line) {
      cx += w.gapBefore;
      kit.draw(w.w, cx, by, w.style, w.size, w.grey);
      if (w.boxed) kit.rect(cx - 1, by - w.size, w.width + 2, w.size + 2);
      cx += w.width;
    }
  });
}
