/**
 * Types of the dataset catalogue that "Import from Repository" reads. Type-only (no code), so a module that imports
 * them with `import type` costs nothing at run time.
 *
 * The files are produced by the repository `corpus-monodicum/monodi-datasets`; its `docs/FORMAT.md` is the
 * authoritative description of every field. Names that exist in the data keep their German spelling.
 */

/** A file of a dataset as the index lists it: path relative to the dataset folder, size in bytes, SHA-256 in hex. */
export interface IndexEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface LicenceInfo {
  /** SPDX identifier, for example `CC-BY-NC-4.0`. */
  spdx: string;
  url?: string | null;
  /** Name of the licence file inside the dataset folder. */
  file?: string;
  share_alike?: boolean;
}

export interface UpstreamInfo {
  repo?: string | null;
  /** Commit (Corpus Monodicum) or release tag (Cantus Corpus) the data was built from. */
  ref?: string | null;
  release?: string | null;
  version?: string | null;
  note?: string;
  note_de?: string;
}

/** One dataset in `catalog.json`. */
export interface CatalogEntry {
  id: string;
  /** `transcriptions` (full notation) or `catalogue` (chant records, some with a melody). */
  kind: string;
  title: string;
  description: string;
  description_de?: string;
  /** Path of the `dataset.json`, relative to the catalogue. */
  path: string;
  bytes: number;
  sha256: string;
  licence: { spdx: string; url?: string | null };
  upstream: UpstreamInfo;
  counts: Record<string, number>;
}

export interface Catalog {
  layout_version: number;
  title: string;
  description?: string;
  description_de?: string;
  built?: string;
  datasets: CatalogEntry[];
}

export interface DatasetJson {
  layout_version: number;
  id: string;
  kind: string;
  title: string;
  description: string;
  description_de?: string;
  built?: string;
  upstream: UpstreamInfo;
  /** URL prefix of the data files; a relative value is resolved against the URL of the `dataset.json`. */
  base: string;
  licence: LicenceInfo;
  counts: Record<string, number>;
  bytes?: Record<string, number>;
  indexes: Record<string, IndexEntry>;
  /** Corpus Monodicum: `source_meta`, `document_meta`, `document_notes` with `{source}` and `{dir}`. */
  file_templates?: Record<string, string>;
  /** Cantus Corpus: the columns of every chunk row. */
  chant_columns?: string[];
  chant_url_template?: string;
  citation_url?: string;
  excluded?: Array<{ kind: string; id: string; reason: string; reason_de?: string }>;
  changes_against_release?: Array<{ text: string; text_de?: string }>;
  attribution_file?: string;
}

/** A table as stored in the index files: a list of columns and rows in that order. */
export interface Table {
  columns: string[];
  rows: unknown[][];
}

/** A source (manuscript) of the Corpus Monodicum index. */
export interface CmSource {
  id: string;
  quellensigle: string;
  bibliothek: string;
  bibliotheksort: string;
  bibliothekssignatur: string;
  datierung: string;
  jahrhundert: string;
  herkunftsregion: string;
  herkunftsort: string;
  herkunftsinstitution: string;
  ordenstradition: string;
  quellentyp: string;
  status: string;
  editors: string;
  documents: number;
  bytes: number;
  meta_bytes: number;
  meta_sha256: string;
}

/** A chant of the Corpus Monodicum index (one row of `documents.json`). */
export interface CmDocument {
  id: string;
  dokumenten_id: string;
  quelle_id: string;
  /** Folder name of the source upstream (the `id` of its `CmSource`). */
  source: string;
  /** Folder name of the chant upstream. */
  dir: string;
  gattung1: string;
  gattung2: string;
  festtag: string;
  feier: string;
  textinitium: string;
  foliostart: string;
  notes_bytes: number;
  meta_bytes: number;
  notes_sha256: string;
  meta_sha256: string;
}

/** A source of the Cantus Corpus index. */
export interface CantusSource {
  id: string;
  title: string;
  siglum: string;
  century: string;
  num_century: string;
  provenance: string;
  cursus: string;
  dbs: string[];
  host: string;
  srclink: string;
  chant_path: string;
  chant_sigla: string[];
  n_chants: number;
  n_with_melody: number;
  bytes: number;
  files: IndexEntry[];
}

/** One file of the chants of a source. */
export interface CantusChunk {
  source: string;
  part: number;
  parts: number;
  columns: string[];
  rows: string[][];
}

/** One chant record of the Cantus Corpus. `volpiano` is empty if the record has no melody. */
export interface CantusChant {
  cantus_id: string;
  folio: string;
  position: string;
  genre: string;
  office: string;
  feast: string;
  feast_code: string;
  mode: string;
  incipit: string;
  full_text: string;
  volpiano: string;
  /** Identifier at the end of the chant link, or a complete link if it starts with `http`. */
  ref: string;
  image: string;
  db: string;
}

/** The metadata of a source or chant in the form the ZIP import of Monodi-Zero reads (`meta.json`). */
export type MonodiMeta = Record<string, unknown>;
