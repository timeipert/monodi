import { jsPDF } from 'jspdf';
import { glyphOf, layoutPattern, tokenizePattern } from '../notationsdokumentation/svg-pattern/neume-glyph';
import { flowColumns, NotationDoc, NotationRow, NotationStrip } from '../notation-doc';
import { buildNeumeTree, layoutNeumeTree, TreeNode } from '../neume-tree';
import { Rect } from '../iiif-crop';
import { LoadedImage } from './image-loader';
import { PathOp, parseSvgPath, transformOps } from './svg-path';

/** What the notation documentation is drawn onto: the page area and how to get a new page. */
export interface NotationHost {
  doc: jsPDF;
  fontFamily: string;
  /** Body size of the text. */
  fs: number;
  /** Left edge and width of the text column. */
  x: number;
  width: number;
  /** The y at which content starts on a fresh page. */
  top: number;
  /** Lowest y that content may reach. */
  bottom: number;
  /** What stands where a strip has no picture. */
  noImage?: string;
  /** Adds a page and returns the y at which content starts on it. */
  newPage(): number;
}

// ── The neume signs ─────────────────────────────────────────────────────────────────────────
// A pattern is drawn like the printed volume: black note heads at their relative heights, a
// bracket over every group that is written connected. 1 glyph unit = GLYPH_K pt.
const GLYPH_K = 0.4;
const X_STEP = 15;        // glyph units between two notes
const Y_STEP = 7.5;       // glyph units per step of the melody
const BRACKET_ABOVE = 4.8;// pt between a bracket's line and the note under it
const BRACKET_HOOK = 2.8; // pt: the ends of a bracket turn down
const HEAD_H = 4.4;       // pt: height of a note head, for the room it needs
/** The printed volume's heads are bigger than the editor's drawing of them. */
const HEAD_BOOST = 1.22;

const pathCache = new Map<string, PathOp[]>();
const opsOf = (d: string): PathOp[] => {
  let ops = pathCache.get(d);
  if (!ops) { ops = parseSvgPath(d); pathCache.set(d, ops); }
  return ops;
};

export interface GlyphBox { w: number; h: number }

interface LaidGlyph {
  w: number; h: number;
  notes: { cx: number; cy: number; special: string }[];
  brackets: { x1: number; x2: number; y: number }[];
}

const glyphCache = new Map<string, LaidGlyph | null>();

/** The pattern as points in pt, from (0, 0) at the top left; null if it has no notes. */
function layGlyph(pattern: string): LaidGlyph | null {
  if (glyphCache.has(pattern)) return glyphCache.get(pattern)!;
  const tokens = tokenizePattern(pattern);
  let out: LaidGlyph | null = null;
  if (tokens.length) {
    const lay = layoutPattern(tokens, X_STEP, Y_STEP, X_STEP / 2);
    const step = Y_STEP * GLYPH_K;
    const hasBracket = lay.brackets.length > 0;
    const top = hasBracket ? BRACKET_ABOVE + 1 : 0;
    const cyOf = (y: number) => top + HEAD_H / 2 + (y - lay.minY * Y_STEP) * GLYPH_K;
    const notes = lay.points.map(p => ({ cx: p.x * GLYPH_K, cy: cyOf(p.y), special: p.token.special }));
    // a bracket reaches a little beyond the heads it covers
    const brackets = lay.brackets.map(b => ({
      x1: b.startX * GLYPH_K - 2.4, x2: b.endX * GLYPH_K + 2.4,
      y: cyOf(b.y) - HEAD_H / 2 - BRACKET_ABOVE
    }));
    const last = lay.points[lay.points.length - 1];
    out = {
      w: last.x * GLYPH_K + X_STEP * GLYPH_K / 2,
      h: top + HEAD_H + (lay.maxY - lay.minY) * step,
      notes, brackets
    };
  }
  glyphCache.set(pattern, out);
  return out;
}

export function measureGlyph(pattern: string): GlyphBox {
  const g = layGlyph(pattern);
  return g ? { w: g.w, h: g.h } : { w: 0, h: 0 };
}

/** Draws the pattern with its top left at (x, y), `scale` times its size. Returns the size it takes. */
export function drawNeumeGlyph(doc: jsPDF, pattern: string, x: number, y: number, scale = 1): GlyphBox {
  const g = layGlyph(pattern);
  if (!g) return { w: 0, h: 0 };
  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.45 * scale);
  for (const b of g.brackets) {
    const hook = BRACKET_HOOK * scale;
    doc.line(x + b.x1 * scale, y + b.y * scale + hook, x + b.x1 * scale, y + b.y * scale);
    doc.line(x + b.x1 * scale, y + b.y * scale, x + b.x2 * scale, y + b.y * scale);
    doc.line(x + b.x2 * scale, y + b.y * scale, x + b.x2 * scale, y + b.y * scale + hook);
  }
  for (const n of g.notes) {
    const { glyph, scale: own } = glyphOf(n.special);
    const vb = glyph.viewBox.split(' ').map(Number);
    const k = GLYPH_K * own * HEAD_BOOST * scale;
    const ox = x + n.cx * scale - (vb[0] + vb[2] / 2) * k;
    const oy = y + n.cy * scale - (vb[1] + vb[3] / 2) * k;
    doc.path(transformOps(opsOf(glyph.d), (gx, gy) => [ox + gx * k, oy + gy * k]));
    doc.fillEvenOdd();
  }
  return { w: g.w * scale, h: g.h * scale };
}

// ── The table ───────────────────────────────────────────────────────────────────────────────
const COLUMNS = 3;
const GUTTER = 14;
/** Offsets inside a column (pt): the glyph, the variant letter, the places. */
const GLYPH_X = 24;
const VARIANT_X = 56;
const PLACE_X = 72;

export const NOTATION_TEXT = {
  part: 'Notation Documentation',
  equivalents: 'Transcription equivalents',
  tree: 'Neume tree',
  inventory: 'Sign inventory',
  noImage: 'No image',
};

interface RowBlock {
  row: NotationRow;
  showId: boolean;
  height: number;
  /** The lines of each variant (places wrapped to the column). */
  lines: { variant: string; text: string[] }[];
}

function setText(h: NotationHost, style: 'normal' | 'italic' | 'bold', size: number, grey = 0): void {
  h.doc.setFont(h.fontFamily, style);
  h.doc.setFontSize(size);
  h.doc.setTextColor(grey, grey, grey);
}

/** A subheading in italics, as in the printed volume. */
export function drawSubheading(h: NotationHost, text: string, y: number): number {
  const size = h.fs + 0.5;
  if (y + size * 3 > h.bottom) y = h.newPage();
  setText(h, 'italic', size);
  h.doc.text(text, h.x, y + size);
  h.doc.setTextColor(0, 0, 0);
  return y + size * 1.9;
}

/** A subheading that is never left alone at the foot of a page: it moves to the next page if `needed` of what follows does not fit under it. */
function headingWithRoom(h: NotationHost, text: string, y: number, needed: number): number {
  const size = h.fs + 0.5;
  if (y + size * 1.9 + needed > h.bottom && y > h.top) y = h.newPage();
  return drawSubheading(h, text, y);
}

/** The transcription equivalents: IDs, signs and places in three columns, filled top to bottom. */
export function drawEquivalents(h: NotationHost, nd: NotationDoc, y: number): number {
  if (!nd.rows.length) return y;
  const doc = h.doc;
  const colW = (h.width - GUTTER * (COLUMNS - 1)) / COLUMNS;
  const placeW = Math.max(30, colW - PLACE_X);
  const lineH = h.fs * 1.5;
  setText(h, 'normal', h.fs);

  const blocks: RowBlock[] = [];
  let prevId = '';
  for (const row of nd.rows) {
    const lines = row.variants.map(v => ({
      variant: v.variant,
      text: doc.splitTextToSize(v.places.map(p => p.text).join(', ') || '–', placeW) as string[]
    }));
    const textH = lines.reduce((s, l) => s + l.text.length * lineH, 0);
    const idH = row.idParts.length * lineH;
    const glyphH = measureGlyph(row.pattern).h;
    const showId = row.refId !== prevId;
    prevId = row.refId;
    blocks.push({ row, showId, height: Math.max(textH, showId ? idH : 0, glyphH + 2) + 5, lines });
  }

  // the first page of the table has what is left of the page, later ones the whole page
  const first = Math.max(0, h.bottom - y);
  const full = h.bottom - h.top;
  const flow = flowColumns(blocks.map(b => b.height), COLUMNS, first, full);
  let page = 0;
  let top = y;
  let lastEnd = y;
  for (const cell of flow) {
    if (cell.page !== page) { page = cell.page; top = h.newPage(); lastEnd = top; }
    const cx = h.x + cell.column * (colW + GUTTER);
    let cy = top;
    for (const i of cell.indexes) {
      const b = blocks[i];
      const baseline = (n: number) => cy + h.fs * 1.05 + n * lineH;
      setText(h, 'normal', h.fs);
      if (b.showId) b.row.idParts.forEach((p, n) => doc.text(p, cx, baseline(n)));
      drawNeumeGlyph(doc, b.row.pattern, cx + GLYPH_X, cy + 1);
      let n = 0;
      setText(h, 'normal', h.fs);
      for (const l of b.lines) {
        if (l.variant) doc.text(l.variant, cx + VARIANT_X, baseline(n));
        for (const t of l.text) { doc.text(t, cx + PLACE_X, baseline(n)); n++; }
      }
      cy += b.height;
    }
    lastEnd = Math.max(lastEnd, cy);   // below the tallest column of the last page
  }
  doc.setTextColor(0, 0, 0);
  return lastEnd;
}

/** The notes of single IDs (`10b  seldom, only …`) and the free text about the notation. */
export function drawNotes(h: NotationHost, nd: NotationDoc, freeText: string, y: number): number {
  const doc = h.doc;
  const lineH = h.fs * 1.4;
  const keyW = 34;
  y += 6;
  for (const n of nd.notes) {
    const lines: string[] = doc.splitTextToSize(n.text, h.width - keyW);
    if (y + lines.length * lineH > h.bottom) y = h.newPage();
    setText(h, 'normal', h.fs);
    doc.text(n.key, h.x, y + h.fs);
    setText(h, 'italic', h.fs);
    lines.forEach((l, i) => doc.text(l, h.x + keyW, y + h.fs + i * lineH));
    y += lines.length * lineH;
  }
  const text = freeText.trim();
  if (text) {
    y += nd.notes.length ? 6 : 0;
    setText(h, 'normal', h.fs);
    for (const para of text.split(/\n{1,}/).map(p => p.trim()).filter(Boolean)) {
      const lines: string[] = doc.splitTextToSize(para, h.width);
      for (const l of lines) {
        if (y + lineH > h.bottom) y = h.newPage();
        setText(h, 'normal', h.fs);
        doc.text(l, h.x, y + h.fs);
        y += lineH;
      }
      y += 3;
    }
  }
  doc.setTextColor(0, 0, 0);
  return y;
}

// ── The line strips ─────────────────────────────────────────────────────────────────────────
/** A strip's picture: the crop of the page (`rect`, page percent) as it was fetched, or why there is none. */
export interface StripPicture {
  image: LoadedImage | null;
  /** The part of the page the picture shows, in page percent. */
  crop: Rect;
  problem?: string;
}

const LABEL_COL = 50;
const LABEL_H = 8.5;
const LABEL_FS = 6.5;

/** Strips with their pictures, one below the other: the place on the left, the line with framed signs on the right. */
export function drawStrips(h: NotationHost, strips: NotationStrip[], pictures: Map<string, StripPicture>, y: number, heading?: string): number {
  const doc = h.doc;
  const imgX = h.x + LABEL_COL;
  const maxW = h.width - LABEL_COL;
  // one scale for the whole manuscript: the widest strip fills the column
  let widest = 0;
  for (const s of strips) {
    const p = pictures.get(s.region.id);
    if (p?.image) widest = Math.max(widest, p.crop.w);
  }
  const ptPerPct = widest > 0 ? maxW / widest : 1;
  const heightOf = (s: NotationStrip): number => {
    const p = pictures.get(s.region.id);
    return p?.image ? (p.crop.w * ptPerPct * p.image.h) / p.image.w : 26;
  };
  if (heading && strips.length) y = headingWithRoom(h, heading, y, LABEL_H + heightOf(strips[0]) + 10);

  for (const s of strips) {
    const p = pictures.get(s.region.id);
    let w = 0, ih = 0;
    if (p?.image) { w = p.crop.w * ptPerPct; ih = (w * p.image.h) / p.image.w; }
    else { w = maxW; ih = 26; }
    const need = LABEL_H + ih + 10;
    if (y + need > h.bottom) y = h.newPage();
    const top = y + LABEL_H;

    // the place
    setText(h, 'normal', h.fs);
    doc.text(s.place.text, h.x, top + ih / 2 + h.fs * 0.35);

    if (p?.image) {
      doc.addImage(p.image.data, p.image.format, imgX, top, w, ih, undefined, 'FAST');
      drawBoxes(h, s, p.crop, imgX, top, w, ih);
    } else {
      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.4);
      doc.rect(imgX, top, w, ih);
      setText(h, 'italic', h.fs - 1, 120);
      doc.text(p?.problem || h.noImage || NOTATION_TEXT.noImage, imgX + 6, top + ih / 2 + h.fs * 0.3);
    }
    y = top + ih + 10;
  }
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  return y;
}

function drawBoxes(h: NotationHost, s: NotationStrip, crop: Rect, x0: number, y0: number, w: number, ih: number): void {
  const doc = h.doc;
  const toX = (px: number) => x0 + Math.min(Math.max(((px - crop.x) / crop.w) * w, 0), w);
  const toY = (py: number) => y0 + Math.min(Math.max(((py - crop.y) / crop.h) * ih, 0), ih);
  doc.setFont(h.fontFamily, 'normal');
  doc.setFontSize(LABEL_FS);
  let labelEnd = -Infinity;
  for (const b of s.boxes) {   // left to right
    const bx = toX(b.rect.x), bx2 = toX(b.rect.x + b.rect.w);
    const by = toY(b.rect.y), by2 = toY(b.rect.y + b.rect.h);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(bx, by, Math.max(bx2 - bx, 1), Math.max(by2 - by, 1));
    // the label sits on the frame; a label that would overlap the one before moves right
    const lw = doc.getTextWidth(b.label) + 3.2;
    const lx = Math.max(bx, labelEnd + 1);
    const ly = Math.max(by - LABEL_H, y0 - LABEL_H);
    doc.setFillColor(255, 255, 255);
    doc.rect(lx, ly, lw, LABEL_H, 'FD');
    doc.setTextColor(0, 0, 0);
    doc.text(b.label, lx + 1.6, ly + LABEL_H - 2.3);
    labelEnd = lx + lw;
  }
}

// ── The neume tree ──────────────────────────────────────────────────────────────────────────
const TREE_INK = 85;
const TREE_LABEL_FS = 6.5;
const TREE_LABEL_GAP = 2;

/**
 * The neume tree of a manuscript: a column for each number of notes, left to right, each pattern grown out of
 * the shorter one it contains. Drawn as vector (lines, signs) and monospaced codes under the signs; as large
 * as the text column allows (at most its own size), and moved to a new page if it does not fit under `y`.
 * Returns the y below it.
 */
export function drawNeumeTree(h: NotationHost, codes: string[], y: number, heading?: string): number {
  const tree = buildNeumeTree(codes);
  if (!tree.nodes.length) return y;
  const doc = h.doc;
  doc.setFont('courier', 'normal');
  doc.setFontSize(TREE_LABEL_FS);
  const labelW = (code: string) => doc.getTextWidth(code);
  const labelH = TREE_LABEL_FS * 1.1;
  const size = (node: TreeNode) => {
    if (node === tree.root) return { w: 4, h: 4, anchorY: 2 };
    const g = measureGlyph(node.code);
    return { w: Math.max(g.w, labelW(node.code)), h: g.h + TREE_LABEL_GAP + labelH, anchorY: g.h / 2 };
  };
  let gap = 36;
  let layout = layoutNeumeTree(tree, size, gap, 5);
  // narrow the gaps between the columns before shrinking the drawing
  while (layout.width > h.width && gap > 14) { gap -= 4; layout = layoutNeumeTree(tree, size, gap, 5); }
  const room = h.bottom - h.top;
  const scale = Math.min(1, h.width / layout.width, room / layout.height);
  if (heading) y = headingWithRoom(h, heading, y, layout.height * scale);
  if (y + layout.height * scale > h.bottom) y = h.newPage();
  const ox = h.x + Math.max(0, (h.width - layout.width * scale) / 2);
  const X = (v: number) => ox + v * scale;
  const Y = (v: number) => y + v * scale;

  // the lines, under everything
  doc.setDrawColor(TREE_INK, TREE_INK, TREE_INK);
  doc.setLineWidth(0.4 * scale);
  for (const e of layout.edges) {
    const x1 = X(e.x1), y1 = Y(e.y1), x2 = X(e.x2), y2 = Y(e.y2);
    if (e.y1 === e.y2) doc.line(x1, y1, x2, y2);
    else {
      const mid = (x1 + x2) / 2;
      doc.lines([[mid - x1, 0, mid - x1, y2 - y1, x2 - x1, y2 - y1]], x1, y1, [1, 1], 'S', false);
    }
  }
  // the root, where every single note starts
  const root = layout.boxes.get(tree.root)!;
  doc.setFillColor(40, 40, 40);
  doc.circle(X(root.x + root.w / 2), Y(root.y + root.anchorY), 1.4 * scale, 'F');

  for (const node of tree.nodes) {
    const box = layout.boxes.get(node)!;
    const g = measureGlyph(node.code);
    drawNeumeGlyph(doc, node.code, X(box.x + (box.w - g.w) / 2), Y(box.y), scale);
    doc.setFont('courier', 'normal');
    doc.setFontSize(TREE_LABEL_FS * scale);
    doc.setTextColor(30, 30, 30);
    doc.text(node.code, X(box.x + box.w / 2), Y(box.y + g.h + TREE_LABEL_GAP + labelH * 0.85), { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(0, 0, 0);
  return y + layout.height * scale + 6;
}
