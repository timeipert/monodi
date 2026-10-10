import * as VM from '../types/model';
import { TextKit, breakLines, drawLines, linesWidth, markupSegments } from './rich-text';

/** A laid-out piece of the apparatus: its size and how to draw it at a position. */
export interface Box {
  w: number;
  h: number;
  /** Takes the height of its grid row (brackets). */
  stretch?: boolean;
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
      const cellMax = Math.max(40, (maxW - kit.gapX * (cols - 1)) / cols);
      const boxes = rows.map((r) => r.map((t) => layoutCommentTree(t, kit, cellMax)));
      const colW = Array.from({ length: cols }, (_, ci) => Math.max(0, ...boxes.map((r) => r[ci]?.w ?? 0)));
      const rowH = boxes.map((r) => Math.max(kit.fs, ...r.filter((b) => !b.stretch).map((b) => b.h)));
      const colX: number[] = [];
      let x = 0;
      colW.forEach((w, ci) => { colX.push(x); x += w + (ci < cols - 1 ? kit.gapX : 0); });
      const rowY: number[] = [];
      let y = 0;
      rowH.forEach((h, ri) => { rowY.push(y); y += h + (ri < rows.length - 1 ? kit.gapY : 0); });
      return {
        w: x, h: y,
        draw: (ox, oy) => boxes.forEach((r, ri) => r.forEach((b, ci) => b.draw(ox + colX[ci], oy + rowY[ri], rowH[ri]))),
      };
    }
  }
}
