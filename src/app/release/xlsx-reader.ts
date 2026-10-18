import * as JSZip from 'jszip';

/** One worksheet as plain text: `rows[r][c]` is the shown text of the cell, '' where nothing is. */
export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/**
 * Reads the worksheets of an .xlsx file. An .xlsx is a ZIP of XML files; this reads values only (text, numbers,
 * booleans), no formulas, styles or dates-as-dates, which is all a metadata list needs. The files that come from the
 * Corpus Monodicum database have ten thousand rows and 140 columns, so the sheet is scanned with regular expressions
 * instead of being built as a DOM tree.
 */
export async function readXlsx(data: ArrayBuffer | Uint8Array | Blob): Promise<XlsxSheet[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This is not an .xlsx file.');
  }
  const text = async (path: string): Promise<string | null> => {
    const f = zip.file(path);
    return f ? f.async('string') : null;
  };

  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new Error('This is not an .xlsx file (no workbook found).');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  }

  const shared = parseSharedStrings(await text('xl/sharedStrings.xml'));
  const sheets: XlsxSheet[] = [];
  let n = 0;
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    n++;
    const name = unescapeXml(attr(m[0], 'name') ?? `Sheet${n}`);
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    const path = (rid && targets.get(rid)) || `xl/worksheets/sheet${n}.xml`;
    const xml = await text(path);
    if (xml === null) continue;
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return sheets;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** XML entities and Excel's `_x000D_` escapes. */
function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[e] ?? whole;
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_w, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** The text of a string item or an inline string: all `<t>` pieces joined, phonetic hints left out. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const t of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += t[1] ?? '';
  return unescapeXml(out);
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(m[1] === undefined ? '' : textOf(m[1]));
  return out;
}

/** 'A' → 0, 'Z' → 25, 'AA' → 26. */
function columnIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let next = 0;   // the row a `<row>` without an `r` attribute lands in
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const given = attr(rm[1], 'r');
    const rowIndex = given ? parseInt(given, 10) - 1 : next;
    next = rowIndex + 1;
    if (rm[2] === undefined || !(rowIndex >= 0)) continue;
    const cells: string[] = [];
    let col = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /(?:^|\s)r="([A-Z]+)\d+"/.exec(cm[1]);
      if (ref) col = columnIndex(ref[1]);
      const body = cm[2];
      if (body !== undefined) {
        const type = attr(cm[1], 't');
        let value = '';
        if (type === 'inlineStr') value = textOf(body);
        else {
          const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          if (v) {
            const raw = unescapeXml(v[1]);
            value = type === 's' ? shared[parseInt(raw, 10)] ?? '' : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw;
          }
        }
        if (value !== '') {
          while (cells.length < col) cells.push('');
          cells[col] = value;
        }
      }
      col++;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}
