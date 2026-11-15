/**
 * The record of what was imported from a repository, so that the app can show "update available" and remove an
 * import again. Pure functions on a plain object; the app keeps the object in its own storage.
 */

export interface ImportRecord {
  datasetId: string;
  /** Identifier of the source in the dataset index. */
  sourceId: string;
  /** Identifier of the source in the workspace. */
  workspaceSourceId: string;
  /** Commit or release the data came from. */
  upstreamRef: string;
  /** Changes when any file of the source changes (see `fingerprintOf`). */
  fingerprint: string;
  /** Identifiers of the workspace documents that the import wrote. */
  documentIds: string[];
  /** ISO time of the last import of this source. */
  importedAt: string;
}

export interface ImportManifest {
  version: 1;
  records: ImportRecord[];
}

export function emptyManifest(): ImportManifest {
  return { version: 1, records: [] };
}

/** Read a stored manifest; anything that is not one gives an empty manifest, a record that lacks a field is dropped. */
export function parseManifest(value: unknown): ImportManifest {
  if (typeof value !== 'object' || value === null) return emptyManifest();
  const records = (value as { records?: unknown }).records;
  if (!Array.isArray(records)) return emptyManifest();
  const valid = records.filter((r): r is ImportRecord =>
    typeof r === 'object' && r !== null
    && typeof r.datasetId === 'string' && typeof r.sourceId === 'string' && typeof r.workspaceSourceId === 'string'
    && typeof r.upstreamRef === 'string' && typeof r.fingerprint === 'string'
    && Array.isArray(r.documentIds) && typeof r.importedAt === 'string');
  return { version: 1, records: valid };
}

export function recordKey(datasetId: string, sourceId: string): string {
  return `${datasetId}\u0001${sourceId}`;
}

export function findRecord(manifest: ImportManifest, datasetId: string, sourceId: string): ImportRecord | undefined {
  return manifest.records.find((r) => r.datasetId === datasetId && r.sourceId === sourceId);
}

/** Add a record; an import of the same source again replaces the record and keeps the documents of the earlier one. */
export function upsertRecord(manifest: ImportManifest, record: ImportRecord): ImportManifest {
  const earlier = findRecord(manifest, record.datasetId, record.sourceId);
  const documentIds = Array.from(new Set([...(earlier?.documentIds ?? []), ...record.documentIds]));
  const kept = manifest.records.filter((r) => r !== earlier);
  return { version: 1, records: [...kept, { ...record, documentIds }] };
}

export function removeRecord(manifest: ImportManifest, datasetId: string, sourceId: string): ImportManifest {
  return { version: 1, records: manifest.records.filter((r) => !(r.datasetId === datasetId && r.sourceId === sourceId)) };
}

/** A value that changes when any of the parts changes: the SHA-256 of the parts joined by line breaks. */
export async function fingerprintOf(parts: readonly string[], sha256: (data: ArrayBuffer) => Promise<string>): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join('\n'));
  return sha256(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** The records whose source now has another fingerprint than at the import. `current` maps `recordKey` to it. */
export function outdatedRecords(manifest: ImportManifest, current: ReadonlyMap<string, string>): ImportRecord[] {
  return manifest.records.filter((r) => {
    const now = current.get(recordKey(r.datasetId, r.sourceId));
    return now !== undefined && now !== r.fingerprint;
  });
}
