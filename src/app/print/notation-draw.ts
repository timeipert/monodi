import { jsPDF } from 'jspdf';
import { DHelperLine, DNote, DTie } from '../notes/Drawables';
import { GLYPH_PATHS } from '../notes/glyph-paths';
import { flagDefsOf } from '../notes/note-flags';
import { G_CLEF_PATH } from '../clef-glyph';
import { PathOp, parseSvgPath, transformOps } from './svg-path';
import { SyllableGeometry } from './notation-geometry';

export type RGB = [number, number, number];

/**
 * Where a syllable's raw coordinates land on the page: raw x maps to `cellX + x * S`, raw y
 * to `rawTopY + (y - rawTop) * S` (`rawTopY` is the page y of raw `rawTop` for voice 0;
 * further voices are `voiceStep` raw units lower).
 */
export interface NotationFrame {
  cellX: number;
  rawTopY: number;
  rawTop: number;
  S: number;
  voiceStep: number;
}

const glyphCache = new Map<string, PathOp[]>();
const glyphOps = (type: string): PathOp[] => {
  const key = GLYPH_PATHS[type] ? type : 'Normal';
  let ops = glyphCache.get(key);
  if (!ops) { ops = parseSvgPath(GLYPH_PATHS[key]); glyphCache.set(key, ops); }
  return ops;
};
let clefOps: PathOp[] | null = null;

/** Draws the notes, brackets and ledger lines of one syllable (or its placeholder box). */
export function drawSyllableNotation(doc: jsPDF, g: SyllableGeometry, f: NotationFrame, color: RGB): void {
  const { S } = f;
  const px = (x: number) => f.cellX + x * S;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.setDrawColor(color[0], color[1], color[2]);
  // a syllable without notes (the box marker of the edition view) draws nothing: its space stays
  if (!g.isNormal) return;
  g.voices.forEach((ds, v) => {
    const py = (y: number) => f.rawTopY + (y - f.rawTop + v * f.voiceStep) * S;
    for (const d of ds) {
      if (d instanceof DNote) {
        const k = d.ref.liquescent ? 8 / 12 : 1;
        const ops = transformOps(glyphOps(d.ref.noteType), (gx, gy) => [px(g.shiftUnits + d.x + (gx - 24) * k), py(d.y + gy * k)]);
        doc.path(ops);
        doc.fillEvenOdd();
        drawNoteFlags(doc, d, g.shiftUnits, px, py, S);
      } else if (d instanceof DTie) {
        const ops = transformOps(parseSvgPath(d.getPath()), (x, y) => [px(g.shiftUnits + x), py(y)]);
        doc.setLineWidth(2 * S);
        doc.setLineJoin('round');
        doc.path(ops);
        doc.stroke();
      } else if (d instanceof DHelperLine) {
        doc.rect(px(g.shiftUnits + d.x - 3), py(d.y - 0.5), 15 * S, 1 * S, 'F');
      }
    }
  });
}

const flagOpsCache = new Map<string, PathOp[]>();

/** User-defined note flags (see notes/note-flags.ts) above the note head: SVG outline or abbreviation. */
function drawNoteFlags(doc: jsPDF, d: DNote, shift: number, px: (x: number) => number, py: (y: number) => number, S: number): void {
  const defs = flagDefsOf(d.ref.flags);
  if (defs.length === 0) return;
  const cx = shift + d.x + (d.ref.liquescent ? 4 : 6);
  defs.forEach((fd, i) => {
    const top = d.y + 12 - i * 11;
    if (fd.svgPath) {
      const vb = (fd.viewBox || '0 0 10 10').split(' ').map(Number);
      if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return;
      const k = 9 / Math.max(vb[2], vb[3]);
      let ops = flagOpsCache.get(fd.svgPath);
      if (!ops) { ops = parseSvgPath(fd.svgPath); flagOpsCache.set(fd.svgPath, ops); }
      doc.path(transformOps(ops, (gx, gy) => [px(cx + (gx - vb[0] - vb[2] / 2) * k), py(top + (gy - vb[1]) * k)]));
      doc.fillEvenOdd();
    } else {
      const font = doc.getFont();
      const size = doc.getFontSize();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9 * S);
      doc.text(fd.abbrev, px(cx), py(top + 8), { align: 'center' });
      doc.setFont(font.fontName, font.fontStyle);
      doc.setFontSize(size);
    }
  });
}

/** The G clef (vector outline) at the start of a cell; `staffTopY` is the page y of the top staff line. */
export function drawGClef(doc: jsPDF, cellX: number, staffTopY: number, S: number, color: RGB): void {
  if (!clefOps) clefOps = parseSvgPath(G_CLEF_PATH);
  doc.setFillColor(color[0], color[1], color[2]);
  doc.path(transformOps(clefOps, (x, y) => [cellX + x * S, staffTopY + (y - 40) * S]));
  doc.fillEvenOdd();
}

/** Five staff lines from x1 to x2; `staffTopY` is the page y of the top line. */
export function drawStaff(doc: jsPDF, x1: number, x2: number, staffTopY: number, S: number, color: RGB): void {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(1 * S);
  for (let i = 0; i < 5; i++) doc.line(x1, staffTopY + i * 10 * S, x2, staffTopY + i * 10 * S);
}
