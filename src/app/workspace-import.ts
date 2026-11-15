import type { Document, Source } from './api.service';
import { SOURCE_DESCRIPTION_KEY } from './source-description';

/**
 * How the metadata of a source or a document in an archive or dataset (`meta.json`) becomes a record of the workspace.
 * Shared by the ZIP import (`sources-overview.component.ts`) and the import from a repository
 * (`repository-import.service.ts`), so that both read the same keys the same way.
 *
 * A key that the workspace record has no field for is kept in `custom` (as text), so nothing is dropped.
 */

/** Top-level keys of a source's `meta.json` that have a field in `Source`. */
export const KNOWN_SOURCE_KEYS: ReadonlySet<string> = new Set<string>([
  'id', 'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution',
  'ordenstradition', 'quellentyp', 'bibliotheksort', 'bibliothek',
  'bibliothekssignatur', 'kommentar', 'datierung', 'iiifManifestUrl',
  'equivalents', 'annotationRegions', 'annotationItems',
  'transcriptionAnnotations', 'custom',
]);

/** Top-level keys of a document's `meta.json` that have a field in `Document`. */
export const KNOWN_DOCUMENT_KEYS: ReadonlySet<string> = new Set<string>([
  'id', 'quelle_id', 'dokumenten_id', 'gattung1', 'gattung2', 'festtag',
  'feier', 'textinitium', 'bibliographischerverweis', 'druckausgabe',
  'zeilenstart', 'foliostart', 'kommentar', 'editionsstatus', 'custom',
  'genre', 'festum', 'dies', 'rowstart', 'source_id', 'additionalData',
]);

/**
 * The workspace source for a source's `meta.json`. `manifest` becomes `iiifManifestUrl`; every other key without a
 * field goes to `custom`; the older key `beschreibung` becomes the description (`SOURCE_DESCRIPTION_KEY`).
 * The notation annotations of the source (`equivalents`, ...) are not handled here: see `mergeMetaAnnotations`.
 */
export function sourceFromMeta(meta: any, sourceId: string): Source {
  const custom: { [k: string]: string } = { ...(meta.custom ?? {}) };
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'manifest') continue;
    if (KNOWN_SOURCE_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    custom[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  // earlier exports call the Markdown description `beschreibung`; it is kept as `description`
  if (custom['beschreibung'] !== undefined) {
    if (!custom[SOURCE_DESCRIPTION_KEY]) custom[SOURCE_DESCRIPTION_KEY] = custom['beschreibung'];
    delete custom['beschreibung'];
  }

  return {
    id:                    sourceId,
    quellensigle:          meta.quellensigle          || sourceId,
    herkunftsregion:       meta.herkunftsregion       || '',
    herkunftsort:          meta.herkunftsort          || '',
    herkunftsinstitution:  meta.herkunftsinstitution  || '',
    ordenstradition:       meta.ordenstradition       || '',
    quellentyp:            meta.quellentyp            || '',
    bibliotheksort:        meta.bibliotheksort        || '',
    bibliothek:            meta.bibliothek            || '',
    bibliothekssignatur:   meta.bibliothekssignatur   || '',
    kommentar:             meta.kommentar             || '',
    datierung:             meta.datierung             || '',
    iiifManifestUrl:       meta.iiifManifestUrl || meta.manifest || undefined,
    custom:                Object.keys(custom).length ? custom : undefined,
  };
}

/**
 * The workspace document for a document's `meta.json` (the German keys of the monodi export, or the English-ish keys
 * `genre`, `festum`, `dies`, `rowstart` of the OMMR4all export). `additionalData` becomes `custom`.
 */
export function documentFromMeta(meta: any, docId: string, sourceId: string): Document {
  const custom: { [k: string]: string } = { ...(meta.additionalData ?? meta.custom ?? {}) };
  for (const [k, v] of Object.entries(meta)) {
    if (KNOWN_DOCUMENT_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    custom[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }

  return {
    id:                       docId,
    quelle_id:                sourceId,
    dokumenten_id:            meta.dokumenten_id            || docId,
    gattung1:                 meta.gattung1 || meta.genre   || '',
    gattung2:                 meta.gattung2                 || '',
    festtag:                  meta.festtag  || meta.festum  || '',
    feier:                    meta.feier    || meta.dies    || '',
    textinitium:              meta.textinitium              || '',
    bibliographischerverweis: meta.bibliographischerverweis || '',
    druckausgabe:             meta.druckausgabe             || '',
    zeilenstart:              meta.zeilenstart || meta.rowstart || '',
    foliostart:               meta.foliostart               || '',
    kommentar:                meta.kommentar                || '',
    editionsstatus:           meta.editionsstatus           || '',
    custom:                   Object.keys(custom).length ? custom : {},
  };
}
