/**
 * The link from an imported document back to the page it was taken from, so a person can compare the copy in the
 * workspace with the original (the Cantus Database for a record of the Cantus Corpus, corpus-monodicum.de for a chant of
 * the Corpus Monodicum). The link is written into the comment of the document (`kommentar`), where it is read on the
 * metadata page and in the document, and into the custom field `original_url`, where a program finds it.
 */
import type { MonodiMeta } from './types';

/** Address of the page of a Corpus Monodicum document: this base and the document id (the declared document base URI of the project). */
export const CM_DOCUMENT_PAGE_URL = 'https://corpus-monodicum.de/d/';

/** The page of a Corpus Monodicum document on corpus-monodicum.de. */
export function cmDocumentPageUrl(documentId: string): string {
  return CM_DOCUMENT_PAGE_URL + encodeURIComponent(documentId);
}

/**
 * The metadata of a document with the link added: a line `label: url` after the comment that is there (separated by a blank
 * line; an existing comment is kept), and `original_url` in `additionalData`. Adding the same link twice changes nothing.
 */
export function withOriginalLink(meta: MonodiMeta, url: string, label: string): MonodiMeta {
  const existing = typeof meta['kommentar'] === 'string' ? (meta['kommentar'] as string).trim() : '';
  const line = `${label}: ${url}`;
  const kommentar = existing.includes(url) ? existing : existing ? `${existing}\n\n${line}` : line;
  const additional = (meta['additionalData'] && typeof meta['additionalData'] === 'object' ? meta['additionalData'] : {}) as Record<string, unknown>;
  return { ...meta, kommentar, additionalData: { ...additional, original_url: url } };
}
