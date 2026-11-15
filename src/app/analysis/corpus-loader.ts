import { Injectable } from '@angular/core';
import { extractFeatures, digestsOf } from '@monodi/core/analysis';
import type { ChantFeatures, Corpus, DocDigests, DocInfo } from '@monodi/core/analysis';
import { APIService, Document, Source } from '../api.service';
import { NotesStore } from '../notes-store';

/** The corpus as the methods read it, with the digests that fingerprint it. */
export interface LoadedCorpus {
  corpus: Corpus;
  digests: Record<string, DocDigests>;
  /** Ids that are not documents of the workspace any more. */
  missing: string[];
}

const DOC_FIELDS: (keyof Document)[] = [
  'dokumenten_id', 'gattung1', 'gattung2', 'festtag', 'feier', 'textinitium', 'bibliographischerverweis',
  'druckausgabe', 'foliostart', 'zeilenstart', 'editionsstatus',
];
const SOURCE_FIELDS: (keyof Source)[] = [
  'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution', 'ordenstradition', 'quellentyp',
  'bibliothek', 'bibliotheksort', 'bibliothekssignatur', 'datierung',
];

/** The grouping fields and labels of a document, from its metadata and that of its source. */
export function docInfoOf(doc: Document, source: Source | undefined): DocInfo {
  const fields: Record<string, string> = {};
  for (const k of DOC_FIELDS) { const v = String(doc[k] ?? '').trim(); if (v) fields[`doc:${k}`] = v; }
  if (source) for (const k of SOURCE_FIELDS) { const v = String(source[k] ?? '').trim(); if (v) fields[`src:${k}`] = v; }
  for (const [k, v] of Object.entries(doc.custom ?? {})) { const t = String(v ?? '').trim(); if (t) fields[`custom:${k}`] = t; }
  const label = (doc.dokumenten_id || doc.textinitium || doc.id).trim();
  return { id: doc.id, sourceId: doc.quelle_id, sigle: source?.quellensigle ?? '', label, fields };
}

const EMPTY: ChantFeatures = { pitches: [], sylStart: [], sylLen: [], sylText: [], words: [], neumeStart: [], wordStart: [], wordEnd: [], accidentals: 0 };

/**
 * Reads the documents of an analysis into a `Corpus`: the notes of each document are read one row at a time (as the
 * search does) in chunks, reduced to features at once, and dropped, so memory holds the features and not the trees.
 */
@Injectable({ providedIn: 'root' })
export class CorpusLoader {
  constructor(private readonly api: APIService) {}

  /**
   * @param ids documents to read, in the order the corpus gets
   * @param opts.needNotes false skips reading notes (a check of methods that use only metadata)
   * @param opts.isCancelled polled between chunks; when true the load stops and returns `null`
   */
  async load(
    ids: string[],
    token: string,
    progress: (done: number, total: number) => void = () => undefined,
    opts: { needNotes?: boolean; isCancelled?: () => boolean } = {},
  ): Promise<LoadedCorpus | null> {
    const [docsRes, sourcesRes] = await Promise.all([this.api.listDocuments(token).toPromise(), this.api.listSources(token).toPromise()]);
    const docs = docsRes?.kind === 'DocumentsRetrieved' ? docsRes.documents : [];
    const sources = sourcesRes?.kind === 'SourcesRetrieved' ? sourcesRes.sources : [];
    const docMap = new Map(docs.map((d) => [d.id, d]));
    const sourceMap = new Map(sources.filter((s) => s.id).map((s) => [s.id as string, s]));

    const present = ids.filter((id) => docMap.has(id));
    const missing = ids.filter((id) => !docMap.has(id));
    const infos = present.map((id) => docInfoOf(docMap.get(id)!, sourceMap.get(docMap.get(id)!.quelle_id)));
    const chants: ChantFeatures[] = new Array(present.length);
    const needNotes = opts.needNotes !== false;

    const CHUNK = 100;
    for (let start = 0; start < present.length; start += CHUNK) {
      if (opts.isCancelled?.()) return null;
      const end = Math.min(present.length, start + CHUNK);
      await Promise.all(
        present.slice(start, end).map(async (id, k) => {
          let features = EMPTY;
          if (needNotes) {
            try {
              const root = await NotesStore.get(id);
              if (root) features = extractFeatures(root);
            } catch (e) {
              console.warn(`Skipping the notes of ${id}`, e);
            }
          }
          chants[start + k] = features;
        }),
      );
      progress(end, present.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const digests: Record<string, DocDigests> = {};
    present.forEach((id, i) => { digests[id] = digestsOf(chants[i], infos[i]); });
    return { corpus: { docs: infos, chants }, digests, missing };
  }
}
