/**
 * Loading the catalogue, a dataset and its indexes, following the chain of hashes: the catalogue lists the size and
 * SHA-256 of each `dataset.json`, a `dataset.json` those of its indexes, an index those of the files it names
 * (see `docs/FORMAT.md` of the repository `corpus-monodicum/monodi-datasets`).
 */
import { DatasetError, fetchJson } from './client';
import type { FetchContext } from './client';
import type { Catalog, CatalogEntry, DatasetJson, Table } from './types';
import { folderOf, resolveBase } from './urls';

/** The only layout this code reads. A dataset with another `layout_version` is refused with a clear message. */
export const SUPPORTED_LAYOUT_VERSION = 1;

function requireObject(value: unknown, what: string, url: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatasetError(`${what} at ${url} is not a JSON object.`, 'format', url);
  }
  return value as Record<string, unknown>;
}

function requireLayout(object: Record<string, unknown>, what: string, url: string): void {
  if (object['layout_version'] !== SUPPORTED_LAYOUT_VERSION) {
    throw new DatasetError(
      `${what} at ${url} has layout version ${String(object['layout_version'])}; this version of Monodi reads `
      + `version ${SUPPORTED_LAYOUT_VERSION}. Update the app or use another repository.`,
      'format', url,
    );
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * A repository that a person typed may point its files anywhere. Files are read only from the host of the file that
 * named them and only over https, so a catalogue cannot make the browser call another host.
 */
function requireSameOrigin(target: string, reference: string, what: string): void {
  const t = new URL(target);
  const r = new URL(reference);
  if (t.protocol !== 'https:' && !(t.protocol === r.protocol && t.host === r.host)) {
    throw new DatasetError(`${what} is not served over https (${target}).`, 'format', reference);
  }
  if (t.host !== r.host) {
    throw new DatasetError(`${what} is on another host than its catalogue (${t.host}, not ${r.host}).`, 'format', reference);
  }
}

/** A catalogue that has been read: its entries and the address it came from. */
export interface LoadedCatalog {
  url: string;
  catalog: Catalog;
}

export async function loadCatalog(url: string, ctx: FetchContext): Promise<LoadedCatalog> {
  const json = requireObject(await fetchJson<unknown>(url, {}, ctx), 'The catalogue', url);
  requireLayout(json, 'The catalogue', url);
  if (!Array.isArray(json['datasets'])) {
    throw new DatasetError(`The catalogue at ${url} lists no datasets.`, 'format', url);
  }
  const datasets = (json['datasets'] as unknown[]).map((entry) => {
    const e = requireObject(entry, 'A catalogue entry', url);
    for (const field of ['id', 'kind', 'path', 'sha256']) {
      if (typeof e[field] !== 'string') throw new DatasetError(`A catalogue entry has no ${field}.`, 'format', url);
    }
    if (typeof e['bytes'] !== 'number') throw new DatasetError('A catalogue entry has no bytes.', 'format', url);
    requireSameOrigin(new URL(e['path'] as string, url).href, url, 'The file of the dataset ' + String(e['id']));
    // Optional parts get a value, so that a screen can show an entry of any repository without checking each field.
    return {
      ...e,
      title: typeof e['title'] === 'string' ? e['title'] : e['id'],
      description: typeof e['description'] === 'string' ? e['description'] : '',
      licence: { spdx: 'unknown', ...asObject(e['licence']) },
      upstream: asObject(e['upstream']),
      counts: asObject(e['counts']),
    };
  });
  return { url, catalog: { ...(json as object), datasets } as unknown as Catalog };
}

/** A dataset whose `dataset.json` has been read and checked. */
export interface LoadedDataset {
  entry: CatalogEntry;
  dataset: DatasetJson;
  /** URL of the `dataset.json`. */
  url: string;
  /** Prefix of the data files; ends with `/`. */
  baseUrl: string;
}

export async function loadDataset(
  loaded: LoadedCatalog, entry: CatalogEntry, ctx: FetchContext,
): Promise<LoadedDataset> {
  const url = new URL(entry.path, loaded.url).href;
  const dataset = requireObject(
    await fetchJson<unknown>(url, { bytes: entry.bytes, sha256: entry.sha256 }, ctx), 'The dataset file', url,
  );
  requireLayout(dataset, 'The dataset file', url);
  if (dataset['id'] !== entry.id) {
    throw new DatasetError(`The dataset file at ${url} has the id ${String(dataset['id'])}, not ${entry.id}.`, 'format', url);
  }
  if (typeof dataset['base'] !== 'string' || typeof dataset['indexes'] !== 'object' || dataset['indexes'] === null) {
    throw new DatasetError(`The dataset file at ${url} lacks base or indexes.`, 'format', url);
  }
  const typed = {
    ...dataset,
    title: typeof dataset['title'] === 'string' ? dataset['title'] : entry.id,
    licence: { spdx: 'unknown', ...asObject(dataset['licence']) },
    upstream: asObject(dataset['upstream']),
    counts: asObject(dataset['counts']),
  } as unknown as DatasetJson;
  const baseUrl = resolveBase(typed.base, url);
  requireSameOrigin(baseUrl, url, 'The base of the data files');
  return { entry, dataset: typed, url, baseUrl };
}

/** Read one index of a dataset (for example `sources` or `documents`), checked against `dataset.json`. */
export async function loadIndex<T>(dataset: LoadedDataset, name: string, ctx: FetchContext): Promise<T> {
  const entry = dataset.dataset.indexes[name];
  if (!entry) throw new DatasetError(`The dataset ${dataset.entry.id} has no index ${name}.`, 'format', dataset.url);
  const url = new URL(entry.path, folderOf(dataset.url)).href;
  return fetchJson<T>(url, { bytes: entry.bytes, sha256: entry.sha256 }, ctx);
}

/** Turn a table (`columns` plus rows of cells) into a list of objects. */
export function expandTable<T>(table: Table): T[] {
  const columns = table.columns;
  return table.rows.map((row) => {
    const object: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) object[columns[i]] = row[i];
    return object as T;
  });
}
