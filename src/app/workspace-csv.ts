/**
 * Whole-workspace CSV export / import.
 *
 * One row per document: every scalar Source column (of the document's parent
 * source) + every scalar Document column + all custom fields + a `volpiano`
 * column and a `text` column derived from the notation. Sources without
 * documents are emitted as a row with empty document columns so they survive a
 * round trip.
 *
 * Columns are prefixed `source_` / `document_`; custom fields become
 * `source_custom_<key>` / `document_custom_<key>`.
 *
 * CSV is intentionally a *metadata + melody* exchange format, not a full backup:
 * the notation is reduced to its Volpiano string (see ./volpiano/volpiano.ts), so
 * apparatus, structural levels and folio detail are not carried. Use the JSON /
 * ZIP export for a lossless backup.
 */
import { Source, Document } from './api.service';
import { RootContainer, getSyllables, emptyRootContainer } from './types/model';
import { rootToVolpiano, volpianoToRoot } from './volpiano/volpiano';
import { v4 as UUID } from 'uuid';

/** Scalar (CSV-friendly) source fields, in column order. */
const SOURCE_FIELDS: (keyof Source)[] = [
  'id', 'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution',
  'ordenstradition', 'quellentyp', 'bibliotheksort', 'bibliothek', 'bibliothekssignatur',
  'kommentar', 'datierung', 'iiifManifestUrl',
];
/** Scalar (CSV-friendly) document fields, in column order. */
const DOCUMENT_FIELDS: (keyof Document)[] = [
  'id', 'quelle_id', 'dokumenten_id', 'gattung1', 'gattung2', 'festtag', 'feier',
  'textinitium', 'bibliographischerverweis', 'druckausgabe', 'zeilenstart', 'foliostart',
  'kommentar', 'editionsstatus',
];

const SOURCE_PREFIX = 'source_';
const SOURCE_CUSTOM_PREFIX = 'source_custom_';
const DOCUMENT_PREFIX = 'document_';
const DOCUMENT_CUSTOM_PREFIX = 'document_custom_';

// ─────────────────────────────────────────────────────────────────────────────
// CSV primitives (RFC 4180)
// ─────────────────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Parse CSV text into a grid of rows. Handles quoted fields with commas, quotes and newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text column
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `text` column: one whitespace-separated token per syllable (trailing
 * hyphens removed), e.g. "Quo ni am de us". Aligns 1:1 with the melody column,
 * whose `-- / ---` separators carry the syllable/word structure.
 */
function documentText(root: RootContainer): string {
  return getSyllables(root)
    .map((s) => (s.text || '').trim().replace(/-+$/, ''))
    .filter((t) => t.length > 0)
    .join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export interface CsvExportOptions {
  includeSourceMeta: boolean;
  includeDocumentMeta: boolean;
  includeContent: boolean;
}

interface RowEntity {
  source: Source | null;
  document: Document | null;
  root: RootContainer | undefined;
}

interface ColumnDef {
  header: string;
  get: (e: RowEntity) => string;
}

export function buildWorkspaceCsv(
  sources: Source[],
  documents: Document[],
  notesByDoc: { [docId: string]: RootContainer },
  options: CsvExportOptions = { includeSourceMeta: true, includeDocumentMeta: true, includeContent: true }
): string {
  // ── Row entities: one per document, plus one per source that has no documents ──
  const docsBySource = new Map<string, Document[]>();
  for (const d of documents) {
    const key = d.quelle_id || '';
    if (!docsBySource.has(key)) docsBySource.set(key, []);
    docsBySource.get(key)!.push(d);
  }
  const entities: RowEntity[] = [];
  for (const s of sources) {
    const key = s.id || '';
    const docs = docsBySource.get(key) || [];
    if (docs.length === 0) {
      entities.push({ source: s, document: null, root: undefined });
    } else {
      docs.forEach((d) => entities.push({ source: s, document: d, root: notesByDoc[d.id] }));
    }
    docsBySource.delete(key);
  }
  docsBySource.forEach((docs) =>
    docs.forEach((d) => entities.push({ source: null, document: d, root: notesByDoc[d.id] }))
  );

  // ── Candidate columns, per the include options ──
  const columns: ColumnDef[] = [];
  if (options.includeSourceMeta) {
    SOURCE_FIELDS.forEach((f) =>
      columns.push({ header: SOURCE_PREFIX + f, get: (e) => (e.source ? String((e.source as any)[f] ?? '') : '') })
    );
    collectCustomKeys(sources).forEach((k) =>
      columns.push({ header: SOURCE_CUSTOM_PREFIX + k, get: (e) => (e.source && e.source.custom && e.source.custom[k]) || '' })
    );
  }
  if (options.includeDocumentMeta) {
    DOCUMENT_FIELDS.forEach((f) =>
      columns.push({ header: DOCUMENT_PREFIX + f, get: (e) => (e.document ? String((e.document as any)[f] ?? '') : '') })
    );
    collectCustomKeys(documents).forEach((k) =>
      columns.push({ header: DOCUMENT_CUSTOM_PREFIX + k, get: (e) => (e.document && e.document.custom && e.document.custom[k]) || '' })
    );
  }
  if (options.includeContent) {
    columns.push({ header: 'melody', get: (e) => (e.root ? rootToVolpiano(e.root).volpiano : '') });
    columns.push({ header: 'text', get: (e) => (e.root ? documentText(e.root) : '') });
  }

  // ── Materialise, then drop columns (and rows) that are empty everywhere ──
  const matrix = entities.map((e) => columns.map((c) => c.get(e)));
  const keep = columns.map((_, ci) => matrix.some((row) => row[ci].trim() !== ''));
  const header = columns.filter((_, ci) => keep[ci]).map((c) => c.header);
  const rows = matrix
    .map((row) => row.filter((_, ci) => keep[ci]))
    .filter((row) => row.some((cell) => cell.trim() !== ''));

  // Prepend a UTF-8 BOM so spreadsheet apps open umlauts correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

function collectCustomKeys(items: { custom?: { [k: string]: string } }[]): string[] {
  const keys = new Set<string>();
  for (const it of items) {
    if (it.custom) Object.keys(it.custom).forEach((k) => keys.add(k));
  }
  return Array.from(keys).sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Import
// ─────────────────────────────────────────────────────────────────────────────

export interface CsvParseResult {
  sources: Source[];
  documents: Document[];
  notesByDoc: { [docId: string]: RootContainer };
  warnings: string[];
}

export function parseWorkspaceCsv(csvText: string): CsvParseResult {
  const warnings: string[] = [];
  let text = csvText || '';
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const grid = parseCsvRows(text);
  if (grid.length < 2) {
    return { sources: [], documents: [], notesByDoc: {}, warnings: ['CSV has no data rows'] };
  }

  const header = grid[0].map((h) => h.trim());
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h, i));

  const srcCustomKeys = header
    .filter((h) => h.startsWith(SOURCE_CUSTOM_PREFIX))
    .map((h) => h.slice(SOURCE_CUSTOM_PREFIX.length));
  const docCustomKeys = header
    .filter((h) => h.startsWith(DOCUMENT_CUSTOM_PREFIX))
    .map((h) => h.slice(DOCUMENT_CUSTOM_PREFIX.length));

  const cell = (row: string[], col: string): string => {
    const idx = colIndex.get(col);
    return idx === undefined ? '' : row[idx] ?? '';
  };

  const sourcesById = new Map<string, Source>();
  const sourcesBySigle = new Map<string, Source>();
  const documents: Document[] = [];
  const notesByDoc: { [docId: string]: RootContainer } = {};

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (row.every((c) => (c || '').trim() === '')) continue;

    // ── Source ──
    const anySourceField =
      SOURCE_FIELDS.some((f) => cell(row, SOURCE_PREFIX + f).trim() !== '') ||
      srcCustomKeys.some((k) => cell(row, SOURCE_CUSTOM_PREFIX + k).trim() !== '');
    let source: Source | undefined;
    if (anySourceField) {
      let sourceId = cell(row, SOURCE_PREFIX + 'id').trim();
      const sigle = cell(row, SOURCE_PREFIX + 'quellensigle').trim();
      if (sourceId) source = sourcesById.get(sourceId);
      if (!source && sigle) source = sourcesBySigle.get(sigle);
      if (!source) {
        if (!sourceId) sourceId = UUID();
        source = buildSource(row, sourceId, srcCustomKeys, cell);
        sourcesById.set(sourceId, source);
        if (sigle) sourcesBySigle.set(sigle, source);
      }
    }

    // ── Document ──
    // Accept both the new `melody` header and the earlier `volpiano` header.
    const melody = cell(row, 'melody').trim() || cell(row, 'volpiano').trim();
    const hasDoc =
      DOCUMENT_FIELDS.some((f) => f !== 'quelle_id' && cell(row, DOCUMENT_PREFIX + f).trim() !== '') ||
      docCustomKeys.some((k) => cell(row, DOCUMENT_CUSTOM_PREFIX + k).trim() !== '') ||
      melody !== '' ||
      cell(row, 'text').trim() !== '';
    if (hasDoc) {
      let docId = cell(row, DOCUMENT_PREFIX + 'id').trim();
      if (!docId) docId = UUID();
      const quelleId = source ? source.id || '' : cell(row, DOCUMENT_PREFIX + 'quelle_id').trim();
      const doc = buildDocument(row, docId, quelleId, docCustomKeys, cell);
      documents.push(doc);

      if (melody) {
        const res = volpianoToRoot(melody, cell(row, 'text').trim() || undefined, { textMode: 'syllables' });
        notesByDoc[docId] = res.root;
        res.warnings.forEach((w) => warnings.push(`document ${doc.dokumenten_id || docId}: ${w}`));
      } else {
        notesByDoc[docId] = emptyRootContainer();
      }
    }
  }

  return { sources: Array.from(sourcesById.values()), documents, notesByDoc, warnings };
}

function buildSource(
  row: string[],
  id: string,
  customKeys: string[],
  cell: (row: string[], col: string) => string
): Source {
  const custom: { [k: string]: string } = {};
  customKeys.forEach((k) => {
    const v = cell(row, SOURCE_CUSTOM_PREFIX + k);
    if (v) custom[k] = v;
  });
  return {
    id,
    quellensigle: cell(row, SOURCE_PREFIX + 'quellensigle'),
    herkunftsregion: cell(row, SOURCE_PREFIX + 'herkunftsregion'),
    herkunftsort: cell(row, SOURCE_PREFIX + 'herkunftsort'),
    herkunftsinstitution: cell(row, SOURCE_PREFIX + 'herkunftsinstitution'),
    ordenstradition: cell(row, SOURCE_PREFIX + 'ordenstradition'),
    quellentyp: cell(row, SOURCE_PREFIX + 'quellentyp'),
    bibliotheksort: cell(row, SOURCE_PREFIX + 'bibliotheksort'),
    bibliothek: cell(row, SOURCE_PREFIX + 'bibliothek'),
    bibliothekssignatur: cell(row, SOURCE_PREFIX + 'bibliothekssignatur'),
    kommentar: cell(row, SOURCE_PREFIX + 'kommentar'),
    datierung: cell(row, SOURCE_PREFIX + 'datierung'),
    iiifManifestUrl: cell(row, SOURCE_PREFIX + 'iiifManifestUrl'),
    custom,
  };
}

function buildDocument(
  row: string[],
  id: string,
  quelleId: string,
  customKeys: string[],
  cell: (row: string[], col: string) => string
): Document {
  const custom: { [k: string]: string } = {};
  customKeys.forEach((k) => {
    const v = cell(row, DOCUMENT_CUSTOM_PREFIX + k);
    if (v) custom[k] = v;
  });
  return {
    id,
    quelle_id: quelleId,
    dokumenten_id: cell(row, DOCUMENT_PREFIX + 'dokumenten_id'),
    gattung1: cell(row, DOCUMENT_PREFIX + 'gattung1'),
    gattung2: cell(row, DOCUMENT_PREFIX + 'gattung2'),
    festtag: cell(row, DOCUMENT_PREFIX + 'festtag'),
    feier: cell(row, DOCUMENT_PREFIX + 'feier'),
    textinitium: cell(row, DOCUMENT_PREFIX + 'textinitium'),
    bibliographischerverweis: cell(row, DOCUMENT_PREFIX + 'bibliographischerverweis'),
    druckausgabe: cell(row, DOCUMENT_PREFIX + 'druckausgabe'),
    zeilenstart: cell(row, DOCUMENT_PREFIX + 'zeilenstart'),
    foliostart: cell(row, DOCUMENT_PREFIX + 'foliostart'),
    kommentar: cell(row, DOCUMENT_PREFIX + 'kommentar'),
    editionsstatus: cell(row, DOCUMENT_PREFIX + 'editionsstatus'),
    custom,
  };
}
