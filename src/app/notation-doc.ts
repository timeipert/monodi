/**
 * The notation documentation of a manuscript, as the printed Corpus Monodicum shows it:
 *
 *  - "Transcription equivalents": one row per neume pattern of the manuscript's neume table,
 *    with its Reference ID, the variants (a, b …) and where each can be seen (`folio / line`);
 *  - "Sign inventory": the lines of the manuscript that carry marked signs, each as a strip of the
 *    page with a frame round every sign and its Reference ID above it.
 *
 * Built from what a source holds (`equivalents`, `annotationRegions`, `annotationItems`), without
 * the transcription or the images: pure functions on plain data.
 */

import * as VM from './types/model';
import { boundsOf, Rect } from './iiif-crop';
import { baseCode, compareForTable } from './notation-order';
import { defaultSetup, includedRows, NotationSetup } from './notation-set';

/** Key under which a source's notes on its notation are kept in `Source.custom`. */
export const NOTATION_NOTES_KEY = 'notationNotes';

/** The free text about a source's notation, or ''. */
export function notationNotes(source: { custom?: { [key: string]: string } } | null | undefined): string {
  return (source?.custom?.[NOTATION_NOTES_KEY] ?? '').toString();
}

interface SourceLike {
  custom?: { [key: string]: string };
  equivalents?: VM.EquivalentMetadata[];
  annotationRegions?: VM.AnnotationRegion[];
  annotationItems?: VM.AnnotationItem[];
}

/** Where a sign is: `folio / line`. */
export interface PlaceRef { folio: string; line: number | null; text: string }

/** One neume pattern (with one of the manuscript's Reference IDs) and where it is seen. */
export interface NotationRow {
  /** Reference ID as typed (`20`, `10+/20-`). */
  refId: string;
  pattern: string;
  /** The ID as printed: a composite ID (`10+/20-`) is stacked, one part to a line. */
  idParts: string[];
  /** Note count of the pattern: simpler neumes first. */
  tones: number;
  /** One entry per variant letter ('' = none), each with the places of its signs. */
  variants: { variant: string; places: PlaceRef[] }[];
}

/** A frame in a line strip. */
export interface StripBox {
  itemId: string;
  /** The label above the frame: Reference ID and variant, `10+20-a`. */
  label: string;
  points: string;
  rect: Rect;
}

/** One line of a page with the signs marked in it. */
export interface NotationStrip {
  region: VM.AnnotationRegion;
  place: PlaceRef;
  /** The line as a rectangle in page percent. */
  rect: Rect;
  boxes: StripBox[];
}

/** The note of one Reference ID and variant (`10b`) — the text under the table. */
export interface NotationNote { key: string; text: string }

export interface NotationDoc {
  rows: NotationRow[];
  strips: NotationStrip[];
  notes: NotationNote[];
  /** Rows without a Reference ID (their frames are labelled with the pattern). */
  withoutId: number;
  /** Snippets left out because the manuscript's documentation does not show their pattern. */
  excluded: number;
}

/** Number of notes of a pattern code (`*`, `u`, `d`, `e` each make one). */
export function tonesOf(pattern: string): number {
  return (pattern.match(/[*ude]/g) ?? []).length;
}

/** The ID as printed in a label: no slash (`10+/20-` → `10+20-`). */
export const idLabel = (refId: string): string => refId.replace(/\s*\/\s*/g, '');

/** Parts of a composite ID, one to a line: `10+/20-` → `10+`, `20-`. */
export const idParts = (refId: string): string[] => refId.split('/').map(p => p.trim()).filter(Boolean);

const isPlain = (refId: string): boolean => /^\d+$/.test(refId);

/** Reference IDs in print order: the plain numbers (10, 11, 20 …) first, the composite ones (`10+/20-`, `20+`) after, no ID last. */
export function compareRefIds(a: string, b: string): number {
  if (!a !== !b) return a ? -1 : 1;     // a pattern without an ID comes last
  const pa = isPlain(a), pb = isPlain(b);
  if (pa !== pb) return pa ? -1 : 1;
  if (pa) return Number(a) - Number(b);
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Folio labels in book order: 44, 44v, 45, 45v, 100 — numbers by value, recto before verso. */
export function compareFolios(a: string, b: string): number {
  const ka = folioKey(a), kb = folioKey(b);
  return ka.n - kb.n || ka.side - kb.side || a.localeCompare(b, undefined, { numeric: true });
}

function folioKey(label: string): { n: number; side: number } {
  const m = /(\d+)\s*([rv]?)/i.exec(label);
  if (!m) return { n: Number.MAX_SAFE_INTEGER, side: 0 };
  return { n: Number(m[1]), side: m[2].toLowerCase() === 'v' ? 1 : 0 };
}

/** The line number a region's name carries: `Line 8` → 8. */
export function lineNumberOf(region: Pick<VM.AnnotationRegion, 'name'>): number | null {
  const m = /(\d+)\s*$/.exec(region.name ?? '') ?? /(\d+)/.exec(region.name ?? '');
  return m ? Number(m[1]) : null;
}

/** The page label a region was written with (`8r`), or ''. */
export function folioOf(region: Pick<VM.AnnotationRegion, 'folio' | 'folioLabel'>): string {
  if (region.folioLabel) return region.folioLabel;
  // a legacy `folio` that is all digits is a canvas index, not a label
  return region.folio && !/^\d+$/.test(region.folio) ? region.folio : '';
}

/** A folio as the printed volume writes it: the recto has no letter (`8r` → `8`), the verso keeps its `v`. */
export const printedFolio = (label: string): string => label.replace(/^(\d+)\s*r$/i, '$1');

export function placeOf(region: VM.AnnotationRegion): PlaceRef {
  const folio = folioOf(region);
  const line = lineNumberOf(region);
  return { folio, line, text: [printedFolio(folio), line === null ? '' : String(line)].filter(Boolean).join(' / ') };
}

const comparePlaces = (a: PlaceRef, b: PlaceRef): number =>
  compareFolios(a.folio, b.folio) || (a.line ?? 0) - (b.line ?? 0);

/**
 * What a source makes of the notation documentation: the patterns of its set (see notation-set.ts) as rows, in
 * the order the setup asks for, with the places of their snippets; and a strip for every line with a snippet of
 * a shown pattern. A pattern without snippets is a row without places (the standard set shows it all the same).
 */
export function buildNotationDoc(source: SourceLike & { custom?: { [key: string]: string } }, setup: NotationSetup = defaultSetup()): NotationDoc {
  const included = includedRows(source, setup);
  const noteOf = new Map<string, string>();
  for (const e of source.equivalents ?? []) if (e.notes?.trim() && !noteOf.has(baseCode(e.pattern))) noteOf.set(baseCode(e.pattern), e.notes.trim());
  const regions = new Map((source.annotationRegions ?? []).map((r): [string, VM.AnnotationRegion] => [r.id, r]));

  const rows = new Map<string, NotationRow & { order: number }>();
  included.forEach((inc, order) => {
    rows.set(inc.pattern, { refId: inc.refId, pattern: inc.pattern, idParts: idParts(inc.refId), tones: tonesOf(inc.pattern), variants: [], order });
  });
  const stripBoxes = new Map<string, StripBox[]>();
  let excluded = 0;

  for (const item of source.annotationItems ?? []) {
    const region = regions.get(item.regionId);
    if (!region) continue;
    const pattern = baseCode(item.pattern);
    const row = rows.get(pattern);
    if (!row) { excluded++; continue; }
    const variant = (item.variant ?? '').trim();
    const place = placeOf(region);

    // the table: the places of each variant
    let v = row.variants.find(x => x.variant === variant);
    if (!v) { v = { variant, places: [] }; row.variants.push(v); }
    if (place.text && !v.places.some(p => p.text === place.text)) v.places.push(place);

    // the strips: a frame labelled with the ID (or, without one, the pattern) and the variant
    const rect = boundsOf(item.points);
    if (rect) {
      const list = stripBoxes.get(region.id) ?? [];
      list.push({ itemId: item.id, label: (row.refId ? idLabel(row.refId) : pattern) + variant, points: item.points, rect });
      stripBoxes.set(region.id, list);
    }
  }

  const rowList = [...rows.values()];
  if (setup.order === 'id') {
    // by Reference ID; rows with the same ID, and those without one, in the order of the neume table
    rowList.sort((a, b) => compareRefIds(a.refId, b.refId) || compareForTable(a.pattern, b.pattern));
  } else {
    rowList.sort((a, b) => compareForTable(a.pattern, b.pattern));
  }
  for (const r of rowList) {
    r.variants.sort((a, b) => a.variant.localeCompare(b.variant));
    for (const v of r.variants) v.places.sort(comparePlaces);
  }

  const strips: NotationStrip[] = [];
  for (const [regionId, boxes] of stripBoxes) {
    const region = regions.get(regionId)!;
    const rect = boundsOf(region.points);
    if (!rect) continue;
    boxes.sort((a, b) => a.rect.x - b.rect.x);
    strips.push({ region, place: placeOf(region), rect, boxes });
  }
  strips.sort((a, b) => comparePlaces(a.place, b.place));

  // notes of the table rows: `10b  seldom, only in a very low position`
  const notes: NotationNote[] = [];
  for (const r of rowList) {
    const text = noteOf.get(r.pattern);
    if (text && r.refId) notes.push({ key: idLabel(r.refId), text });
  }
  notes.sort((a, b) => compareRefIds(a.key, b.key));

  return { rows: rowList.map(({ order, ...r }) => r), strips, notes, withoutId: rowList.filter(r => !r.refId).length, excluded };
}

/** Rows split into columns for a page area, filled top to bottom, as the printed volume sets them. */
export function flowColumns(heights: number[], columns: number, firstColumnH: number, nextColumnH: number): { page: number; column: number; indexes: number[] }[] {
  // Fill column after column to the page bottom; whatever is left for the last page is spread
  // evenly over its columns (as the printed table ends), so that it does not hang in one column.
  const pageH = (p: number) => (p === 0 ? firstColumnH : nextColumnH);
  const place = (colH: (p: number) => number): { page: number; column: number; indexes: number[] }[] => {
    const out: { page: number; column: number; indexes: number[] }[] = [];
    let page = 0, column = 0, used = 0;
    let cur: number[] = [];
    heights.forEach((h, i) => {
      if (used + h > colH(page) && cur.length) {
        out.push({ page, column, indexes: cur });
        cur = []; used = 0; column++;
        if (column >= columns) { column = 0; page++; }
      }
      cur.push(i); used += h;
    });
    if (cur.length) out.push({ page, column, indexes: cur });
    return out;
  };

  const full = place(pageH);
  const lastPage = full.length ? full[full.length - 1].page : 0;
  if (lastPage === 0 && full.length <= 1) return full;
  // rows of the last page, spread evenly over its columns
  const onLast = full.filter(c => c.page === lastPage).flatMap(c => c.indexes);
  const total = onLast.reduce((s, i) => s + heights[i], 0);
  const colH0 = lastPage === 0 ? firstColumnH : nextColumnH;
  if (!onLast.length || total > colH0 * columns) return full;
  // smallest column height at which the rows still fit in `columns` columns
  const fits = (h: number): boolean => {
    let used = 0, cols = 1;
    for (const i of onLast) {
      if (used + heights[i] > h && used > 0) { cols++; used = 0; }
      used += heights[i];
    }
    return cols <= columns;
  };
  let lo = Math.max(...onLast.map(i => heights[i])), hi = Math.max(colH0, lo);
  for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  const balanced: { page: number; column: number; indexes: number[] }[] = [];
  let used = 0, column = 0, cur: number[] = [];
  for (const i of onLast) {
    if (used + heights[i] > hi + 0.01 && cur.length) { balanced.push({ page: lastPage, column, indexes: cur }); cur = []; used = 0; column++; }
    cur.push(i); used += heights[i];
  }
  if (cur.length) balanced.push({ page: lastPage, column, indexes: cur });
  return [...full.filter(c => c.page !== lastPage), ...balanced];
}
