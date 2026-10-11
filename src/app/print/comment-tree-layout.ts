import * as VM from '../types/model';
import { TextKit, breakLines, drawLines, linesWidth, markupSegments } from './rich-text';

/** A laid-out piece of the apparatus: its size and how to draw it at a position. */
export interface Box {
  w: number;
  h: number;
  /** Takes the height of its grid row (brackets). */
  stretch?: boolean;
  /** y of the middle of its staff: text and brackets of the same row are centred on it. */
  anchor?: number;
  draw(x: number, y: number, rowH: number): void;
}

export interface TreeKit extends TextKit {
  fs: number;
  lineH: number;
  /** Widest a text cell may get before it wraps. */
  maxCellW: number;
  gapX: number;
  gapY: number;
  bracket(x: number, y: number, h: number): void;
  /** A line of notes (the "Notes" leaf); `context` notes are set in grey. */
  notes(zeile: VM.ZeileContainer, context: boolean, maxW: number): Box;
}

/**
 * Lays out a comment tree like the edition view does: a grid whose columns are segments and
 * whose rows are witnesses, with text, brackets and short lines of notes in the cells.
 */
export function layoutCommentTree(tree: VM.CommentTree, kit: TreeKit, maxW: number): Box {
  switch (tree.kind) {
    case 'CommentTreeUndecided':
      return { w: 0, h: 0, draw: () => {} };
    case 'CommentTreeLeaf': {
      const c = tree.content;
      if (c.kind === 'Bracket') {
        return { w: 6, h: kit.fs, stretch: true, draw: (x, y, rowH) => kit.bracket(x, y, Math.max(rowH, kit.fs)) };
      }
      if (c.kind === 'Notes') return kit.notes(c.content, !!c.context, maxW);
      const lines = breakLines(markupSegments(c.content, kit.fs), Math.min(maxW, kit.maxCellW), kit);
      const w = linesWidth(lines);
      const h = lines.length * kit.lineH;
      return { w, h, draw: (x, y) => drawLines(lines, x, y + kit.fs, kit.lineH, kit) };
    }
    case 'CommentTreeGrid': {
      const rows = tree.items || [];
      const cols = Math.max(0, ...rows.map((r) => r.length));
      if (!rows.length || !cols) return { w: 0, h: 0, draw: () => {} };
      // Columns take the width their content needs; only when the row does not fit do the wide
      // columns share what is left (narrow ones keep theirs).
      const avail = Math.max(40 * cols, maxW - kit.gapX * (cols - 1));
      let boxes = rows.map((r) => r.map((t) => layoutCommentTree(t, kit, avail)));
      const natural = Array.from({ length: cols }, (_, ci) => Math.max(0, ...boxes.map((r) => r[ci]?.w ?? 0)));
      if (natural.reduce((a, b) => a + b, 0) > avail) {
        const alloc = new Array<number>(cols).fill(0);
        let left = avail, open = [...Array(cols).keys()];
        for (let guard = 0; guard < cols + 1 && open.length; guard++) {
          const share = left / open.length;
          const small = open.filter((ci) => natural[ci] <= share);
          if (!small.length) { for (const ci of open) alloc[ci] = Math.max(40, share); break; }
          for (const ci of small) { alloc[ci] = natural[ci]; left -= natural[ci]; }
          open = open.filter((ci) => !small.includes(ci));
        }
        boxes = rows.map((r) => r.map((t, ci) => layoutCommentTree(t, kit, alloc[ci])));
      }
      const colW = Array.from({ length: cols }, (_, ci) => Math.max(0, ...boxes.map((r) => r[ci]?.w ?? 0)));
      // Rows with a staff are centred on its middle line (text level with the notes, as printed).
      const anchors = boxes.map((r) => {
        const a = r.filter((b) => b.anchor !== undefined).map((b) => b.anchor as number);
        return a.length ? Math.max(...a) : undefined;
      });
      const offs = boxes.map((r, ri) => r.map((b) => {
        const an = anchors[ri];
        if (b.stretch || an === undefined) return 0;
        return b.anchor !== undefined ? an - b.anchor : Math.max(0, an - b.h / 2);
      }));
      const rowH = boxes.map((r, ri) => Math.max(kit.fs, ...r.map((b, ci) => (b.stretch ? 0 : offs[ri][ci] + b.h))));
      const colX: number[] = [];
      let x = 0;
      colW.forEach((w, ci) => { colX.push(x); x += w + (ci < cols - 1 ? kit.gapX : 0); });
      const rowY: number[] = [];
      let y = 0;
      rowH.forEach((h, ri) => { rowY.push(y); y += h + (ri < rows.length - 1 ? kit.gapY : 0); });
      return {
        w: x, h: y, anchor: anchors[0],
        draw: (ox, oy) => boxes.forEach((r, ri) => r.forEach((b, ci) => b.draw(ox + colX[ci], oy + rowY[ri] + offs[ri][ci], rowH[ri] - offs[ri][ci]))),
      };
    }
  }
}
