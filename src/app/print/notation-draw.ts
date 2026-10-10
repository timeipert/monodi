import { jsPDF } from 'jspdf';
import { DHelperLine, DNote, DTie } from '../notes/Drawables';
import { GLYPH_PATHS } from '../notes/glyph-paths';
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
  if (!g.isNormal) {
    // a syllable without notes: the placeholder box of the edition view
    const py = f.rawTopY + (60 - f.rawTop) * S;
    doc.setLineWidth(4 * S);
    doc.rect(px((g.widthUnits - 40) / 2), py, 40 * S, 10 * S, 'S');
    return;
  }
  g.voices.forEach((ds, v) => {
    const py = (y: number) => f.rawTopY + (y - f.rawTop + v * f.voiceStep) * S;
    for (const d of ds) {
      if (d instanceof DNote) {
        const k = d.ref.liquescent ? 8 / 12 : 1;
        const ops = transformOps(glyphOps(d.ref.noteType), (gx, gy) => [px(g.shiftUnits + d.x + (gx - 24) * k), py(d.y + gy * k)]);
        doc.path(ops);
        doc.fillEvenOdd();
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
