import type { Document } from '../api.service';
import type { MetadataPatch } from '../metadata-patch';
import { DONT_PUBLISH_KEY, DONT_PUBLISH_METADATA_KEY, isFlagSet } from './printable';

/**
 * The list that Corpus Monodicum exports from its database (one row per document, ~140 columns, many of them empty
 * or repeated under another spelling). Only a few columns matter here, found by their header, not their position.
 */

/** Header as compared: lower case, letters and digits only ("Doc-Id' (intern)" → "docidintern"). */
function norm(header: unknown): string {
  return String(header ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADERS = {
  uuid: 'docidintern',
  id: 'dokumentenid',
  dontpublish: 'dontpublish',
  dontpublishMetadata: 'pleasedontpublishmetadata',
  status: 'editionsstatus',
  sigle: 'quellensigle',
} as const;

/** One row of the export, cleaned. */
export interface CmRecord {
  /** Row in the sheet, 1-based, for messages. */
  row: number;
  uuid: string;
  dokumentenId: string;
  dontpublish: string;
  dontpublishMetadata: string;
  /** 'ediert' or 'none' as in the export, otherwise ''. */
  status: string;
  sigle: string;
}

export interface OddCell {
  row: number;
  id: string;
  column: string;
  value: string;
}

export interface CmParse {
  records: CmRecord[];
  /** Cells in a flag column that hold something other than a plain mark: a comment that landed in the wrong column. */
  odd: OddCell[];
}

/** Values that mean "yes" in a flag column. Anything else is kept as it stands, reported, and counts as set. */
const PLAIN_MARKS = new Set(['x', 'true', '1', 'ja', 'yes']);

export function parseCmExport(rows: string[][]): CmParse {
  const header = rows[0] ?? [];
  const col = new Map<string, number>();
  header.forEach((h, i) => { const k = norm(h); if (k && !col.has(k)) col.set(k, i); });   // the first column of a name wins
  if (!col.has(HEADERS.dontpublish) || !(col.has(HEADERS.uuid) || col.has(HEADERS.id))) {
    throw new Error('This does not look like a Corpus Monodicum export: the columns "Dokumenten_ID" (or "Doc-Id\' (intern)") and "dontpublish" are missing.');
  }
  const at = (row: string[], key: string): string => {
    const i = col.get(key);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };

  const records: CmRecord[] = [];
  const odd: OddCell[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const uuid = at(row, HEADERS.uuid);
    const dokumentenId = at(row, HEADERS.id);
    if (!uuid && !dokumentenId) continue;
    const id = dokumentenId || uuid;
    const flag = (key: string, label: string): string => {
      const v = at(row, key);
      if (v && !PLAIN_MARKS.has(v.toLowerCase())) odd.push({ row: r + 1, id, column: label, value: v });
      return v;
    };
    const status = at(row, HEADERS.status).toLowerCase();
    records.push({
      row: r + 1,
      uuid,
      dokumentenId,
      dontpublish: flag(HEADERS.dontpublish, 'dontpublish'),
      dontpublishMetadata: flag(HEADERS.dontpublishMetadata, "please don't publish metadata"),
      status: status === 'ediert' || status === 'none' ? status : '',
      sigle: at(row, HEADERS.sigle),
    });
  }
  return { records, odd };
}

export interface CmImportPlan {
  /** Only the fields that differ from what the workspace has. */
  patches: MetadataPatch[];
  rows: number;
  matched: number;
  /** Rows without a document in this workspace (the export holds more than the workspace). */
  unmatched: number;
  /** Rows whose Dokumenten_ID fits several documents and that have no usable UUID. */
  ambiguous: number;
  /** Rows that name a document another row named before; the last one counts. */
  duplicates: number;
  /** Documents that carry "don't publish" after the import. */
  flagged: number;
  newlyFlagged: number;
  cleared: number;
  statusChanged: number;
  /** Flagged documents that have a print edition (volume): these are the ones that would have been printed. */
  flaggedWithVolume: number;
  /** Flagged rows with no document in the workspace: nothing to hold back here. */
  flaggedNotInWorkspace: number;
  /** Documents of the workspace the export does not know. */
  notInExport: number;
  unmatchedSample: string[];
}

/** Matches the rows to the documents (UUID first, then Dokumenten_ID) and works out what would change. Changes nothing. */
export function planCmImport(records: CmRecord[], documents: Document[]): CmImportPlan {
  const byId = new Map<string, Document>();
  const byName = new Map<string, Document[]>();
  for (const d of documents) {
    if (d.id) byId.set(d.id, d);
    const name = (d.dokumenten_id ?? '').trim();
    if (name) { const list = byName.get(name); if (list) list.push(d); else byName.set(name, [d]); }
  }

  const target = new Map<string, CmRecord>();   // document id → the row that decides it
  let unmatched = 0, ambiguous = 0, duplicates = 0, flaggedNotInWorkspace = 0;
  const unmatchedSample: string[] = [];
  for (const rec of records) {
    let doc = rec.uuid ? byId.get(rec.uuid) : undefined;
    if (!doc && rec.dokumentenId) {
      const named = byName.get(rec.dokumentenId);
      if (named && named.length === 1) doc = named[0];
      else if (named && named.length > 1) { ambiguous++; continue; }
    }
    if (!doc) {
      unmatched++;
      if (isFlagSet(rec.dontpublish)) flaggedNotInWorkspace++;
      if (unmatchedSample.length < 8) unmatchedSample.push(rec.dokumentenId || rec.uuid);
      continue;
    }
    if (target.has(doc.id)) duplicates++;
    target.set(doc.id, rec);
  }

  const patches: MetadataPatch[] = [];
  let flagged = 0, newlyFlagged = 0, cleared = 0, statusChanged = 0, flaggedWithVolume = 0;
  const docById = new Map(documents.map((d) => [d.id, d]));
  for (const [id, rec] of target) {
    const doc = docById.get(id)!;
    const fields: Record<string, string> = {};
    const was = doc.custom?.[DONT_PUBLISH_KEY] ?? '';
    if (isFlagSet(rec.dontpublish)) {
      flagged++;
      if ((doc.druckausgabe ?? '').trim()) flaggedWithVolume++;
    }
    if (rec.dontpublish !== was) {
      fields['custom.' + DONT_PUBLISH_KEY] = rec.dontpublish;
      if (isFlagSet(rec.dontpublish) && !isFlagSet(was)) newlyFlagged++;
      else if (!isFlagSet(rec.dontpublish) && isFlagSet(was)) cleared++;
    }
    if (rec.dontpublishMetadata !== (doc.custom?.[DONT_PUBLISH_METADATA_KEY] ?? '')) fields['custom.' + DONT_PUBLISH_METADATA_KEY] = rec.dontpublishMetadata;
    if (rec.status && rec.status !== (doc.editionsstatus ?? '')) { fields['editionsstatus'] = rec.status; statusChanged++; }
    if (Object.keys(fields).length) patches.push({ id, fields });
  }

  return {
    patches, rows: records.length, matched: target.size, unmatched, ambiguous, duplicates,
    flagged, newlyFlagged, cleared, statusChanged, flaggedWithVolume, flaggedNotInWorkspace,
    notInExport: documents.filter((d) => d.id && !target.has(d.id)).length,
    unmatchedSample,
  };
}
