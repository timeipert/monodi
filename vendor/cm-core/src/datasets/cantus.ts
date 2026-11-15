/**
 * The Cantus Corpus dataset (catalogue records of Gregorian chant, some with a melody in Volpiano notation): filters
 * on its index, the plan of an import, and the metadata of a source and of a chant in the form the ZIP import of
 * Monodi-Zero reads. The conversion of a Volpiano melody into notes stays in the app (`volpianoToRoot`).
 */
import { loadIndex } from './catalog';
import type { LoadedDataset } from './catalog';
import type { FetchContext } from './client';
import { fetchJson, DatasetError } from './client';
import { facet, matchesText, numbersIn } from './filter';
import type { CantusChant, CantusChunk, CantusSource, MonodiMeta } from './types';
import { fileUrl, fillTemplate } from './urls';

export async function loadCantusIndex(dataset: LoadedDataset, ctx: FetchContext): Promise<CantusSource[]> {
  return loadIndex<CantusSource[]>(dataset, 'sources', ctx);
}

/** Which chants of a source are imported. */
export type ChantSelection = 'with-melody' | 'without-melody' | 'all';

export interface CantusSourceFilter {
  text?: string;
  /** Centuries as numbers (`num_century`). */
  centuries?: number[];
  cursus?: string[];
  /** Host names of the databases (`cantusdatabase.org`, ...). */
  hosts?: string[];
  /** Only sources that have at least one chant with melody. */
  withMelodyOnly?: boolean;
}

export function filterCantusSources(sources: readonly CantusSource[], filter: CantusSourceFilter): CantusSource[] {
  return sources.filter((s) => {
    if (!matchesText(filter.text, [s.siglum, s.title, s.provenance, ...s.chant_sigla])) return false;
    if (filter.centuries?.length && !numbersIn(s.num_century).some((c) => filter.centuries!.includes(c))) return false;
    if (filter.cursus?.length && !filter.cursus.includes(s.cursus)) return false;
    if (filter.hosts?.length && !filter.hosts.includes(s.host)) return false;
    if (filter.withMelodyOnly && s.n_with_melody === 0) return false;
    return true;
  });
}

export function cantusSourceFacets(sources: readonly CantusSource[]) {
  return {
    centuries: facet(sources.flatMap((s) => numbersIn(s.num_century).map(String)))
      .map((f) => ({ value: Number(f.value), count: f.count })).sort((a, b) => a.value - b.value),
    cursus: facet(sources.map((s) => s.cursus)),
    hosts: facet(sources.map((s) => s.host)),
  };
}

/** The number of chants of a source that the selection takes. */
export function chantsIn(source: CantusSource, selection: ChantSelection): number {
  if (selection === 'with-melody') return source.n_with_melody;
  if (selection === 'without-melody') return source.n_chants - source.n_with_melody;
  return source.n_chants;
}

/**
 * Rough sizes of what a chant takes in the workspace once imported: a document without melody (its metadata and its
 * text in syllables), and what a melody adds (the notes that its conversion makes). Estimates, only used to warn
 * before an import fills the storage. Measured 2026-11-14 with the storage figure that the browser reports:
 * 8,375 chants without melody (source `F-AS 465`) took 14.4 MB, that is 1.7 KB each; 11,038 melodies of 16 sources
 * of the 14th century took 63 MB, that is 5.7 KB each (15 melodies of one source took 7.5 KB each; the notes of a
 * melody are 18.7 KB as JSON text). A melody adds 5 KB to the 1.7 KB of the document, a little more than measured.
 */
export const ESTIMATED_BYTES_PER_DOCUMENT = 1_700;
export const ESTIMATED_BYTES_PER_MELODY = 5_000;

export interface CantusPlan {
  sources: CantusSource[];
  chants: number;
  melodies: number;
  /** Bytes to download: the chunk files of every chosen source, whichever chants are taken from them. */
  downloadBytes: number;
  /** Estimate of the bytes the imported documents take in the workspace. */
  storedBytes: number;
  files: number;
}

/** The plan for the chosen sources; a source that has no chant for the selection is left out. */
export function planCantusImport(sources: readonly CantusSource[], selection: ChantSelection): CantusPlan {
  const used = sources.filter((s) => chantsIn(s, selection) > 0);
  let chants = 0;
  let melodies = 0;
  let downloadBytes = 0;
  let files = 0;
  for (const s of used) {
    chants += chantsIn(s, selection);
    melodies += selection === 'without-melody' ? 0 : s.n_with_melody;
    downloadBytes += s.bytes;
    files += s.files.length;
  }
  return {
    sources: used, chants, melodies, downloadBytes, files,
    storedBytes: chants * ESTIMATED_BYTES_PER_DOCUMENT + melodies * ESTIMATED_BYTES_PER_MELODY,
  };
}

/** Rows of a chunk as chant records. */
export function chantsOfChunk(chunk: CantusChunk, columns: readonly string[]): CantusChant[] {
  if (chunk.columns.length !== columns.length || chunk.columns.some((c, i) => c !== columns[i])) {
    throw new DatasetError(`The chunk of ${chunk.source} has other columns than the dataset lists.`, 'format');
  }
  return chunk.rows.map((row) => {
    const chant: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) chant[columns[i]] = row[i];
    return chant as unknown as CantusChant;
  });
}

/** Fetch every chunk of a source (checked against the index) and return its chants in the order of the files. */
export async function fetchCantusChants(
  dataset: LoadedDataset, source: CantusSource, ctx: FetchContext,
): Promise<CantusChant[]> {
  const columns = dataset.dataset.chant_columns;
  if (!columns) throw new DatasetError('The dataset lists no chant columns.', 'format', dataset.url);
  // the chunks of one source are asked for together; they are joined in the order of the index
  const chunks = await Promise.all(source.files.map((file) => fetchJson<CantusChunk>(
    fileUrl(dataset.baseUrl, file.path), { bytes: file.bytes, sha256: file.sha256 }, ctx,
  )));
  return chunks.flatMap((chunk) => chantsOfChunk(chunk, columns));
}

export function takesChant(chant: CantusChant, selection: ChantSelection): boolean {
  if (selection === 'all') return true;
  return selection === 'with-melody' ? chant.volpiano !== '' : chant.volpiano === '';
}

/** Link to a chant in the database that delivered it. */
export function cantusChantUrl(dataset: LoadedDataset, source: CantusSource, chant: CantusChant): string {
  if (/^https?:\/\//.test(chant.ref)) return chant.ref;
  return fillTemplate(dataset.dataset.chant_url_template ?? 'https://{host}/{chant_path}/{ref}', {
    host: source.host, chant_path: source.chant_path, ref: chant.ref,
  });
}

/** Identifier of a chant in the workspace: stable, unique in the dataset, safe in an address. */
export function cantusDocumentId(source: CantusSource, chant: CantusChant): string {
  const ref = /^https?:\/\//.test(chant.ref) ? chant.ref.split('/').filter(Boolean).slice(-2).join('-') : chant.ref;
  return `${source.id}-${ref}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Metadata of a source, with the keys that the ZIP import of Monodi-Zero reads. */
export function cantusSourceMeta(source: CantusSource): MonodiMeta {
  return {
    id: source.id,
    quellensigle: source.siglum,
    herkunftsort: source.provenance,
    datierung: source.century,
    kommentar: source.title,
    jahrhundert: source.num_century ? `${source.num_century}.` : '',
    cursus: source.cursus,
    cantus_source: source.srclink,
    cantus_dbs: source.dbs.join(', '),
    dataset: 'cantuscorpus',
  };
}

/** Metadata of a chant, with the keys that the ZIP import of Monodi-Zero reads (`additionalData` becomes `custom`). */
export function cantusDocumentMeta(dataset: LoadedDataset, source: CantusSource, chant: CantusChant): MonodiMeta {
  const id = cantusDocumentId(source, chant);
  return {
    id,
    quelle_id: source.id,
    dokumenten_id: [source.siglum, chant.folio, chant.cantus_id].filter(Boolean).join(' '),
    gattung1: chant.genre,
    gattung2: '',
    festtag: chant.feast,
    feier: chant.office,
    textinitium: chant.incipit,
    foliostart: chant.folio,
    kommentar: '',
    additionalData: {
      cantus_id: chant.cantus_id,
      mode: chant.mode,
      feast_code: chant.feast_code,
      position: chant.position,
      cantus_chant: cantusChantUrl(dataset, source, chant),
      image: chant.image,
      db: chant.db,
      full_text: chant.full_text,
      dataset: 'cantuscorpus',
    },
  };
}

/** The parts of the fingerprint of a source: the hashes of its chunk files. */
export function cantusSourceFingerprintParts(source: CantusSource): string[] {
  return source.files.map((f) => f.sha256);
}
