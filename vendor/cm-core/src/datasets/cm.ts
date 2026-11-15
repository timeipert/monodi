/**
 * The Corpus Monodicum dataset: filters on its index, the plan of an import (which files, how many bytes) and the
 * addresses of the files. The files themselves are read from the pinned commit of the upstream repository.
 */
import { loadIndex, expandTable } from './catalog';
import type { LoadedDataset } from './catalog';
import type { FetchContext } from './client';
import { facet, matchesText, numbersIn } from './filter';
import type { CmDocument, CmSource, Table } from './types';
import { fileUrl, fillTemplate } from './urls';

export interface CmIndex {
  sources: CmSource[];
  documents: CmDocument[];
}

export async function loadCmIndex(dataset: LoadedDataset, ctx: FetchContext): Promise<CmIndex> {
  const sources = await loadIndex<CmSource[]>(dataset, 'sources', ctx);
  const documents = expandTable<CmDocument>(await loadIndex<Table>(dataset, 'documents', ctx));
  return { sources, documents };
}

export interface CmSourceFilter {
  text?: string;
  /** Centuries as numbers (12 for the twelfth). A source matches if its `jahrhundert` names one of them. */
  centuries?: number[];
  regions?: string[];
  types?: string[];
}

/** The centuries a source belongs to (`14., 15.` gives 14 and 15). */
export function centuriesOf(source: CmSource): number[] {
  return numbersIn(source.jahrhundert);
}

export function filterCmSources(sources: readonly CmSource[], filter: CmSourceFilter): CmSource[] {
  return sources.filter((s) => {
    if (!matchesText(filter.text, [s.quellensigle, s.bibliothek, s.bibliotheksort, s.herkunftsort, s.quellentyp, s.editors])) {
      return false;
    }
    if (filter.centuries?.length && !centuriesOf(s).some((c) => filter.centuries!.includes(c))) return false;
    if (filter.regions?.length && !filter.regions.includes(s.herkunftsregion)) return false;
    if (filter.types?.length && !filter.types.includes(s.quellentyp)) return false;
    return true;
  });
}

export function cmSourceFacets(sources: readonly CmSource[]) {
  return {
    centuries: facet(sources.flatMap((s) => centuriesOf(s).map(String))).map((f) => ({ value: Number(f.value), count: f.count }))
      .sort((a, b) => a.value - b.value),
    regions: facet(sources.map((s) => s.herkunftsregion)),
  };
}

export interface CmDocumentFilter {
  text?: string;
  /** `gattung1` values (the genre, for example `Tropus`). */
  genres?: string[];
  /** `festtag` values (the feast). */
  feasts?: string[];
}

export function filterCmDocuments(documents: readonly CmDocument[], filter: CmDocumentFilter): CmDocument[] {
  return documents.filter((d) => {
    if (!matchesText(filter.text, [d.dokumenten_id, d.textinitium, d.festtag, d.gattung1, d.gattung2, d.foliostart])) return false;
    if (filter.genres?.length && !filter.genres.includes(d.gattung1)) return false;
    if (filter.feasts?.length && !filter.feasts.includes(d.festtag)) return false;
    return true;
  });
}

export function cmDocumentFacets(documents: readonly CmDocument[]) {
  return { genres: facet(documents.map((d) => d.gattung1)), feasts: facet(documents.map((d) => d.festtag)) };
}

/** What an import of the chosen sources would fetch and store. */
export interface CmPlan {
  sources: CmSource[];
  documents: CmDocument[];
  /** Bytes to download: the metadata of each source plus the metadata and notes of each chant. */
  bytes: number;
  /** Estimate of the bytes the imported chants take in the workspace (see `CM_STORED_RATIO`). */
  storedBytes: number;
  files: number;
}

/**
 * What the browser reports as storage for imported Corpus Monodicum files, against their size as downloaded.
 * Measured 2026-11-14: source `Pa 1871`, 45.9 MB downloaded, 14.6 MB of storage (0.32); source `Abb 7`, 79 KB downloaded,
 * 36 KB of storage (0.45). The value is the upper one, rounded.
 */
export const CM_STORED_RATIO = 0.5;

/**
 * The plan for the chosen sources. The chants are those of these sources that pass `documentFilter`; a source with no
 * such chant is left out of the plan.
 */
export function planCmImport(
  index: CmIndex, sourceIds: ReadonlySet<string>, documentFilter: CmDocumentFilter = {},
): CmPlan {
  const inSources = index.documents.filter((d) => sourceIds.has(d.source));
  const documents = filterCmDocuments(inSources, documentFilter);
  const used = new Set(documents.map((d) => d.source));
  const sources = index.sources.filter((s) => used.has(s.id));
  let bytes = 0;
  for (const s of sources) bytes += s.meta_bytes;
  for (const d of documents) bytes += d.meta_bytes + d.notes_bytes;
  return { sources, documents, bytes, storedBytes: Math.round(bytes * CM_STORED_RATIO), files: sources.length + documents.length * 2 };
}

/** Addresses of the files of the sources and chants. */
export function cmSourceMetaUrl(dataset: LoadedDataset, source: CmSource): string {
  return fileUrl(dataset.baseUrl, fillTemplate(dataset.dataset.file_templates!['source_meta'], { source: source.id }));
}

export function cmDocumentUrls(dataset: LoadedDataset, document: CmDocument): { meta: string; notes: string } {
  const values = { source: document.source, dir: document.dir };
  const templates = dataset.dataset.file_templates!;
  return {
    meta: fileUrl(dataset.baseUrl, fillTemplate(templates['document_meta'], values)),
    notes: fileUrl(dataset.baseUrl, fillTemplate(templates['document_notes'], values)),
  };
}

/** One value that changes when any file of the source in the plan changes; stored with an import to find updates. */
export function cmSourceFingerprintParts(source: CmSource, documents: readonly CmDocument[]): string[] {
  return [
    source.meta_sha256,
    ...documents.filter((d) => d.source === source.id).map((d) => `${d.id}:${d.meta_sha256}:${d.notes_sha256}`).sort(),
  ];
}
