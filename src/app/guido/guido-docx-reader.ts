import * as JSZip from 'jszip';

/** One run of text with the font and colour Word would draw it in (null = not set by the file). */
export interface DocxRun {
  text: string;
  font: string | null;
  color: string | null;
}

export interface DocxCell {
  runs: DocxRun[];
}

export interface DocxTable {
  /** `rows[r][c]` is the cell in grid column c; a cell spanning columns appears in each of them. */
  rows: DocxCell[][];
}

export interface DocxContent {
  /** Text of the paragraphs outside tables, in order. */
  paragraphs: string[];
  tables: DocxTable[];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Reads a .docx (a ZIP of XML): tables with their runs, plus the paragraphs outside tables. */
export async function readDocx(data: ArrayBuffer | Uint8Array | Blob): Promise<DocxContent> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This is not a .docx file.');
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('This is not a .docx file (no word/document.xml).');
  const styles = zip.file('word/styles.xml');
  return parseDocxXml(await doc.async('string'), styles ? await styles.async('string') : null);
}

interface StyleInfo {
  font: string | null;
  basedOn: string | null;
}

function xml(text: string, what: string): Document {
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error(`The ${what} of this .docx is not valid XML.`);
  return d;
}

const kids = (el: Element, name: string): Element[] =>
  Array.from(el.children).filter(c => c.namespaceURI === W && c.localName === name);
const kid = (el: Element | null | undefined, name: string): Element | null => (el ? kids(el, name)[0] ?? null : null);
const val = (el: Element | null): string | null => el?.getAttributeNS(W, 'val') ?? null;

function fontOf(rPr: Element | null): string | null {
  const f = kid(rPr, 'rFonts');
  return f ? f.getAttributeNS(W, 'ascii') || f.getAttributeNS(W, 'hAnsi') || null : null;
}

function readStyles(stylesXml: string | null) {
  const byId = new Map<string, StyleInfo>();
  let defaultParagraph: string | null = null;
  let docDefaultFont: string | null = null;
  if (stylesXml) {
    const d = xml(stylesXml, 'styles');
    docDefaultFont = fontOf(kid(kid(kid(d.documentElement, 'docDefaults'), 'rPrDefault'), 'rPr'));
    for (const s of kids(d.documentElement, 'style')) {
      const id = s.getAttributeNS(W, 'styleId');
      if (!id) continue;
      byId.set(id, { font: fontOf(kid(s, 'rPr')), basedOn: val(kid(s, 'basedOn')) });
      if (s.getAttributeNS(W, 'type') === 'paragraph' && s.getAttributeNS(W, 'default') === '1') defaultParagraph = id;
    }
  }
  const styleFont = (id: string | null): string | null => {
    for (let i = 0; id && i < 10; i++) {
      const s = byId.get(id);
      if (!s) return null;
      if (s.font) return s.font;
      id = s.basedOn;
    }
    return null;
  };
  /** Font of a run: its own, else its paragraph style's, else the default paragraph style's, else the document's. */
  return (run: Element, paragraphStyle: string | null): string | null =>
    fontOf(kid(run, 'rPr')) ?? styleFont(paragraphStyle) ?? styleFont(defaultParagraph) ?? docDefaultFont;
}

function runText(run: Element): string {
  let out = '';
  for (const c of Array.from(run.children)) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === 't') out += c.textContent ?? '';
    else if (c.localName === 'tab') out += '\t';
    else if (c.localName === 'br' || c.localName === 'cr') out += '\n';
    else if (c.localName === 'noBreakHyphen') out += '-';
  }
  return out;
}

function runsOf(p: Element, fontFor: (r: Element, style: string | null) => string | null): DocxRun[] {
  const style = val(kid(kid(p, 'pPr'), 'pStyle'));
  const out: DocxRun[] = [];
  for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
    const text = runText(r);
    if (!text) continue;
    const c = val(kid(kid(r, 'rPr'), 'color'));
    out.push({
      text,
      font: fontFor(r, style),
      color: c && c.toLowerCase() !== 'auto' ? c.toUpperCase() : null,
    });
  }
  return out;
}

/** Same as readDocx on the already unzipped XML (this is what the specs feed). */
export function parseDocxXml(documentXml: string, stylesXml: string | null): DocxContent {
  const fontFor = readStyles(stylesXml);
  const body = kid(xml(documentXml, 'document').documentElement, 'body');
  const content: DocxContent = { paragraphs: [], tables: [] };
  if (!body) return content;
  for (const el of Array.from(body.children)) {
    if (el.namespaceURI !== W) continue;
    if (el.localName === 'p') {
      content.paragraphs.push(runsOf(el, fontFor).map(r => r.text).join(''));
    } else if (el.localName === 'tbl') {
      const rows: DocxCell[][] = [];
      const above: DocxCell[] = [];                       // last cell of each grid column, for vertical merges
      for (const tr of kids(el, 'tr')) {
        const row: DocxCell[] = [];
        for (const tc of kids(tr, 'tc')) {
          const tcPr = kid(tc, 'tcPr');
          const span = Math.max(1, parseInt(val(kid(tcPr, 'gridSpan')) ?? '1', 10) || 1);
          const vMerge = kid(tcPr, 'vMerge');
          const continued = !!vMerge && val(vMerge) !== 'restart';
          const cell: DocxCell = continued && above[row.length]
            ? above[row.length]
            : { runs: kids(tc, 'p').flatMap(p => runsOf(p, fontFor)) };
          for (let i = 0; i < span; i++) {
            above[row.length] = cell;
            row.push(cell);
          }
        }
        rows.push(row);
      }
      content.tables.push({ rows });
    }
  }
  return content;
}
