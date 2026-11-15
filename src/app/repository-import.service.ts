import { Injectable } from '@angular/core';
import * as localforage from 'localforage';
import {
  DEFAULT_CATALOG_URL, DatasetError, MAX_DOCUMENTS_PER_IMPORT, cantusDocumentId, cantusDocumentMeta, cmDocumentPageUrl, withOriginalLink,
  cantusSourceFingerprintParts, cantusSourceMeta, cmDocumentUrls, cmSourceFingerprintParts, cmSourceMetaUrl,
  fetchCantusChants, fetchJson, fingerprintOf, loadCantusIndex, loadCatalog, loadCmIndex, loadDataset, makeContext,
  outdatedRecords, parseManifest, prefetch, recordKey, removeRecord, sha256Hex, takesChant, upsertRecord,
} from '@monodi/core/datasets';
import type {
  CantusChant, CantusPlan, CantusSource, CatalogEntry, ChantSelection, CmDocument, CmIndex, CmPlan, CmSource,
  FetchContext, ImportManifest, ImportRecord, LoadedCatalog, LoadedDataset,
} from '@monodi/core/datasets';
import { APIService } from './api.service';
import type { Document, Source } from './api.service';
import { NotesStore } from './notes-store';
import { PushCache } from './push-cache';
import { SyncExclusions } from './sync-exclusions';
import { normalizeDocumentComments } from './types/model';
import { applyPlaceholderImport, placeholderImportEnabled } from './placeholder-comments';
import { mergeMetaAnnotations } from './zip-source-annotations';
import { documentFromMeta, sourceFromMeta } from './workspace-import';
import { cantusNotes } from './repository-documents';

/**
 * Import from a repository: reads a dataset through the client of `@monodi/core/datasets` (every file checked against
 * the SHA-256 of its index), writes the sources, documents and notes into the workspace, and keeps a record of what it
 * imported so that an import can be updated or removed.
 *
 * How the workspace is written:
 * - The notes of a batch of chants are stored first; the chants are listed (the lists of sources and documents are
 *   written) afterwards, so a document in the list always has its notes.
 * - The lists are not held for the whole import. Each write reads the lists as they are at that moment and adds what
 *   the import staged, so a chant that a person creates or edits during a long import is not overwritten by an older
 *   copy. A write happens after a few hundred chants (more as the list grows), at the end of a source that has
 *   gathered enough, and at the end of the import, also after an error or a cancel.
 * - A document that already exists in the workspace is kept unless the caller asks to overwrite it.
 */

export const IMPORT_MANIFEST_KEY = 'monodi_dataset_imports';
const SOURCES_KEY = 'monodi_sources';
const DOCUMENTS_KEY = 'monodi_documents';

/**
 * Chants of the Corpus Monodicum fetched ahead of the one being stored (two files each). Measured 2026-11-14 on 80 chants
 * of one source: 8 files at a time moved 2.6 MB/s, 16 4.1 MB/s, 32 9.5 MB/s; the time is the delay of each request, not
 * the bandwidth, so many requests at once are faster. The window runs across the sources of an import.
 */
const CM_PREFETCH_CHANTS = 24;
/** Sources of the Cantus Corpus fetched ahead (most are a few KB, the largest about 1.8 MB). */
const CANTUS_PREFETCH_SOURCES = 12;
/** Notes stored in one step: the index row of the notes store is written once per step, not once per chant. */
const NOTES_PER_STEP = 25;
/** The progress is passed on at most this often (every report redraws the dialog). */
const REPORT_EVERY_MS = 120;
/** The lists are written when this many chants are staged, or a tenth of the documents already listed if that is more. */
const COMMIT_EVERY_DOCUMENTS = 300;
/** The lists are written when this many sources are staged. */
const COMMIT_EVERY_SOURCES = 25;

export interface ImportProgress {
  /** One line for the person: what happens now. */
  message: string;
  /** Sources finished and sources in the plan. */
  current: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface ImportOptions {
  /** Replace documents (and source metadata) that exist in the workspace. Off by default. */
  overwrite: boolean;
  /**
   * Leave the sources that this import creates out of the GitHub sync (`SyncExclusions`). On unless set to false. A source
   * that was in the workspace before is not touched: its sync status stays as it is.
   */
  keepOutOfSync?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportSummary {
  sources: number;
  documents: number;
  /** Documents that were already in the workspace and were left as they are. */
  keptExisting: number;
  /** Chants of the Cantus Corpus whose melody could not be converted completely. */
  conversionWarnings: number;
}

/** The words in front of the link to the original page in the comment of an imported document. */
const CM_LINK_LABEL = 'Original page on corpus-monodicum.de';
const CANTUS_LINK_LABEL = 'Original record in the Cantus Database';

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Sources and documents that an import has decided on but not yet listed in the workspace. */
class WorkspaceWriter {
  private knownDocuments = new Set<string>();
  private knownSources = new Set<string>();
  private listedDocuments = 0;
  private stagedSources = new Map<string, { next: Source; meta: any; overwrite: boolean }>();
  private stagedDocuments = new Map<string, Document>();

  static async load(): Promise<WorkspaceWriter> {
    const writer = new WorkspaceWriter();
    const sources = (await localforage.getItem<Source[]>(SOURCES_KEY)) || [];
    const documents = (await localforage.getItem<Document[]>(DOCUMENTS_KEY)) || [];
    sources.forEach((s) => writer.knownSources.add(s.id ?? ''));
    documents.forEach((d) => writer.knownDocuments.add(d.id));
    writer.listedDocuments = documents.length;
    return writer;
  }

  hasDocument(id: string): boolean {
    return this.knownDocuments.has(id) || this.stagedDocuments.has(id);
  }

  hasSource(id: string): boolean {
    return this.knownSources.has(id) || this.stagedSources.has(id);
  }

  stageSource(next: Source, meta: any, overwrite: boolean): void {
    this.stagedSources.set(next.id ?? '', { next, meta, overwrite });
  }

  /** Take a staged source back (an import added it, then failed before its first chant). */
  unstageSource(id: string): void {
    this.stagedSources.delete(id);
  }

  stageDocument(next: Document): void {
    this.stagedDocuments.set(next.id, next);
  }

  /** True when enough is staged that the lists should be written now. */
  get due(): boolean {
    const threshold = Math.max(COMMIT_EVERY_DOCUMENTS, Math.floor(this.listedDocuments / 10));
    return this.stagedDocuments.size >= threshold || this.stagedSources.size >= COMMIT_EVERY_SOURCES;
  }

  /** Write what is staged into the lists as they are now. */
  async commit(): Promise<void> {
    if (this.stagedSources.size === 0 && this.stagedDocuments.size === 0) return;
    const sources = (await localforage.getItem<Source[]>(SOURCES_KEY)) || [];
    const documents = (await localforage.getItem<Document[]>(DOCUMENTS_KEY)) || [];
    const sourceIndex = new Map(sources.map((s) => [s.id ?? '', s]));
    const documentIndex = new Map(documents.map((d, i) => [d.id, i]));
    for (const [id, { next, meta, overwrite }] of this.stagedSources) {
      const existing = sourceIndex.get(id);
      if (!existing) {
        mergeMetaAnnotations(next, meta);
        sources.push(next);
      } else if (overwrite) {
        Object.assign(existing, next);
        mergeMetaAnnotations(existing, meta);
      }
      this.knownSources.add(id);
    }
    for (const [id, next] of this.stagedDocuments) {
      const at = documentIndex.get(id);
      if (at === undefined) documents.push(next);
      else documents[at] = next;
      this.knownDocuments.add(id);
    }
    await localforage.setItem(SOURCES_KEY, sources);
    await localforage.setItem(DOCUMENTS_KEY, documents);
    this.listedDocuments = documents.length;
    this.stagedSources.clear();
    this.stagedDocuments.clear();
  }

  /**
   * Give the documents of earlier imports the link to their original page (see `withOriginalLink`): a record of the Cantus
   * Corpus has its address in the custom field `cantus_chant`, a chant of the Corpus Monodicum its page under its id.
   * Documents that have the link already are left as they are. Returns the number of documents changed and the sources
   * they belong to.
   */
  static async addOriginalLinks(records: readonly ImportRecord[]): Promise<{ changed: number; sourceIds: string[] }> {
    const wanted = new Map<string, string>();
    for (const r of records) for (const id of r.documentIds) wanted.set(id, r.workspaceSourceId);
    const documents = (await localforage.getItem<Document[]>(DOCUMENTS_KEY)) || [];
    const sourceIds = new Set<string>();
    let changed = 0;
    for (const doc of documents) {
      const sourceId = wanted.get(doc.id);
      if (sourceId === undefined) continue;
      const cantusUrl = doc.custom?.['cantus_chant'];
      const url = typeof cantusUrl === 'string' && cantusUrl !== '' ? cantusUrl : cmDocumentPageUrl(doc.id);
      const label = typeof cantusUrl === 'string' && cantusUrl !== '' ? CANTUS_LINK_LABEL : CM_LINK_LABEL;
      const next = withOriginalLink({ kommentar: doc.kommentar ?? '', additionalData: doc.custom ?? {} }, url, label);
      if (next['kommentar'] === (doc.kommentar ?? '') && doc.custom?.['original_url'] === url) continue;
      doc.kommentar = next['kommentar'] as string;
      doc.custom = next['additionalData'] as Document['custom'];
      sourceIds.add(sourceId);
      changed++;
    }
    if (changed > 0) await localforage.setItem(DOCUMENTS_KEY, documents);
    return { changed, sourceIds: [...sourceIds] };
  }

  /** Remove chants (and the source if no chant is left in it) from the lists as they are now. */
  static async remove(documentIds: ReadonlySet<string>, sourceId: string): Promise<{ removed: number; sourceRemoved: boolean }> {
    const documents = (await localforage.getItem<Document[]>(DOCUMENTS_KEY)) || [];
    const kept = documents.filter((d) => !documentIds.has(d.id));
    const sourceRemoved = !kept.some((d) => d.quelle_id === sourceId);
    await localforage.setItem(DOCUMENTS_KEY, kept);
    if (sourceRemoved) {
      const sources = (await localforage.getItem<Source[]>(SOURCES_KEY)) || [];
      await localforage.setItem(SOURCES_KEY, sources.filter((s) => s.id !== sourceId));
    }
    return { removed: documents.length - kept.length, sourceRemoved };
  }
}

/** What one source of an import has done so far; the importer of a source fills it in. */
interface SourceRun {
  /** Identifier of the source in the workspace (known after its metadata has been read). */
  workspaceSourceId: string;
  /** The source was not in the workspace before this import. */
  sourceWasNew: boolean;
  /** Identifiers of the chants this import wrote. */
  imported: string[];
}

/** The state of one running import, shared by the importers of the two datasets. */
class ImportSession {
  readonly summary: ImportSummary = { sources: 0, documents: 0, keptExisting: 0, conversionWarnings: 0 };
  readonly touched: string[] = [];
  /** Sources that this import created and that the GitHub sync leaves out. */
  readonly leftOutOfSync: string[] = [];
  bytesDone = 0;

  constructor(
    readonly writer: WorkspaceWriter,
    public manifest: ImportManifest,
    readonly options: ImportOptions,
    readonly bytesTotal: number,
    readonly totalSources: number,
    private saveManifest: (manifest: ImportManifest) => Promise<unknown>,
  ) {}

  private lastReport = 0;

  report(message: string, done: number, force = false): void {
    const now = performance.now();
    if (!force && now - this.lastReport < REPORT_EVERY_MS) return;
    this.lastReport = now;
    this.options.onProgress?.({
      message, current: done, total: this.totalSources, bytesDone: this.bytesDone, bytesTotal: this.bytesTotal,
    });
  }

  /** Write the lists and the record of imports. */
  async commit(): Promise<void> {
    await this.writer.commit();
    await this.saveManifest(this.manifest);
  }

  async commitIfDue(): Promise<void> {
    if (this.writer.due) await this.commit();
  }
}

/**
 * Chants of one source whose notes are waiting to be stored. The chants are staged for the lists only after their notes
 * are stored, so an error in the middle never lists a chant that has no notes.
 */
class NotesStep {
  private waiting: Array<{ id: string; notes: any; doc: Document }> = [];

  constructor(private session: ImportSession, private run: SourceRun) {}

  add(id: string, notes: any, doc: Document): void {
    this.waiting.push({ id, notes, doc });
  }

  get full(): boolean {
    return this.waiting.length >= NOTES_PER_STEP;
  }

  /** Store the waiting notes (one write of the index row), stage their chants, write the lists if due, let the page paint. */
  async flush(): Promise<void> {
    if (this.waiting.length === 0) return;
    const batch: { [id: string]: any } = {};
    for (const w of this.waiting) batch[w.id] = w.notes;
    await NotesStore.merge(batch);
    for (const w of this.waiting) {
      this.session.writer.stageDocument(w.doc);
      this.run.imported.push(w.id);
    }
    this.waiting = [];
    await this.session.commitIfDue();
    await yieldToUI();
  }
}

@Injectable({ providedIn: 'root' })
export class RepositoryImportService {
  /** Injecting the API service makes sure the storage is configured before this service reads it. */
  constructor(private api: APIService) {}

  // ── reading the catalogue ──────────────────────────────────────────────────────────────────────────────────────

  readonly defaultCatalogUrl = DEFAULT_CATALOG_URL;

  context(signal?: AbortSignal): FetchContext {
    return makeContext({ signal });
  }

  openCatalog(url: string, signal?: AbortSignal): Promise<LoadedCatalog> {
    return loadCatalog(url, this.context(signal));
  }

  openDataset(catalog: LoadedCatalog, entry: CatalogEntry, signal?: AbortSignal): Promise<LoadedDataset> {
    return loadDataset(catalog, entry, this.context(signal));
  }

  openCmIndex(dataset: LoadedDataset, signal?: AbortSignal): Promise<CmIndex> {
    return loadCmIndex(dataset, this.context(signal));
  }

  openCantusIndex(dataset: LoadedDataset, signal?: AbortSignal): Promise<CantusSource[]> {
    return loadCantusIndex(dataset, this.context(signal));
  }

  /** How much storage the browser allows and has used for this site; null if the browser does not say. */
  async storageEstimate(): Promise<{ usage: number; quota: number } | null> {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || estimate.quota === undefined) return null;
    return { usage: estimate.usage ?? 0, quota: estimate.quota };
  }

  // ── the record of imports ──────────────────────────────────────────────────────────────────────────────────────

  async getManifest(): Promise<ImportManifest> {
    return parseManifest(await localforage.getItem<unknown>(IMPORT_MANIFEST_KEY));
  }

  private saveManifest = (manifest: ImportManifest): Promise<unknown> => localforage.setItem(IMPORT_MANIFEST_KEY, manifest);

  /** The records of this dataset whose source has changed in the repository since the import (Corpus Monodicum). */
  async outdatedCmRecords(dataset: LoadedDataset, index: CmIndex): Promise<ImportRecord[]> {
    const manifest = await this.getManifest();
    const current = new Map<string, string>();
    for (const source of index.sources) {
      const parts = cmSourceFingerprintParts(source, index.documents.filter((d) => d.source === source.id));
      current.set(recordKey(dataset.entry.id, source.id), await fingerprintOf(parts, sha256Hex));
    }
    return outdatedRecords(manifest, current);
  }

  // ── the loop over the sources, the same for both datasets ──────────────────────────────────────────────────────

  /** More chants than one import takes (see `MAX_DOCUMENTS_PER_IMPORT`) are refused before anything is fetched. */
  private assertWithinLimit(chants: number): void {
    if (chants > MAX_DOCUMENTS_PER_IMPORT) {
      throw new DatasetError(
        `${chants} chants are more than one import takes (${MAX_DOCUMENTS_PER_IMPORT}). Choose fewer sources or filter the chants.`,
        'limit',
      );
    }
  }

  private async importSources<S>(job: {
    sources: readonly S[];
    chants: number;
    bytesTotal: number;
    options: ImportOptions;
    datasetId: string;
    upstreamRef: string;
    label: (source: S) => string;
    /** Identifier of the source in the dataset index. */
    key: (source: S) => string;
    fingerprint: (source: S) => Promise<string>;
    importOne: (source: S, session: ImportSession, run: SourceRun) => Promise<void>;
    /** Called once when the import ends, also after an error (stop the fetches that run ahead). */
    dispose?: () => void;
  }): Promise<ImportSummary> {
    this.assertWithinLimit(job.chants);
    let session: ImportSession | undefined;
    try {
      await NotesStore.ensureMigrated();
      session = new ImportSession(
        await WorkspaceWriter.load(), await this.getManifest(), job.options, job.bytesTotal, job.sources.length,
        this.saveManifest,
      );
      for (let i = 0; i < job.sources.length; i++) {
        const source = job.sources[i];
        const run: SourceRun = { workspaceSourceId: job.key(source), sourceWasNew: false, imported: [] };
        session.report(`${job.label(source)}: reading`, i, true);
        try {
          await job.importOne(source, session, run);
          session.summary.sources++;
        } finally {
          // a source that this import added but that got no chant (an error came first) is not left behind
          if (run.sourceWasNew && run.imported.length === 0) session.writer.unstageSource(run.workspaceSourceId);
          session.touched.push(run.workspaceSourceId);
          if (run.sourceWasNew && run.imported.length > 0 && job.options.keepOutOfSync !== false) {
            session.leftOutOfSync.push(run.workspaceSourceId);
          }
          if (run.imported.length > 0) {
            session.manifest = upsertRecord(session.manifest, {
              datasetId: job.datasetId,
              sourceId: job.key(source),
              workspaceSourceId: run.workspaceSourceId,
              upstreamRef: job.upstreamRef,
              fingerprint: await job.fingerprint(source),
              documentIds: run.imported,
              importedAt: new Date().toISOString(),
            });
          }
          session.summary.documents += run.imported.length;
          await session.commitIfDue();
        }
        session.report(`${job.label(source)}: done`, i + 1, true);
      }
    } finally {
      job.dispose?.();
      if (session) {
        try {
          await session.commit();
        } finally {
          await SyncExclusions.add(session.leftOutOfSync);
          await this.afterImport(session.touched);
        }
      }
    }
    return session!.summary;
  }

  // ── Corpus Monodicum ───────────────────────────────────────────────────────────────────────────────────────────

  async importCm(dataset: LoadedDataset, index: CmIndex, plan: CmPlan, options: ImportOptions): Promise<ImportSummary> {
    this.assertWithinLimit(plan.documents.length);
    // A chant that is in the workspace already is kept, so its files are not fetched at all (unless it is replaced).
    const known = options.overwrite
      ? new Set<string>()
      : new Set(((await localforage.getItem<Document[]>(DOCUMENTS_KEY)) || []).map((d) => d.id));
    // One list of everything to fetch, in the order it is stored: a source, then its chants, then the next source.
    // The files run ahead of the storing, also across the border of two sources.
    type Unit = { source: CmSource; doc?: CmDocument };
    const docsOf = new Map<string, CmDocument[]>();
    const skipped = new Map<string, { chants: number; bytes: number }>();
    for (const d of plan.documents) {
      if (known.has(d.id)) {
        const s = skipped.get(d.source) ?? { chants: 0, bytes: 0 };
        s.chants++; s.bytes += d.meta_bytes + d.notes_bytes;
        skipped.set(d.source, s);
        continue;
      }
      const list = docsOf.get(d.source);
      if (list) list.push(d); else docsOf.set(d.source, [d]);
    }
    const units: Unit[] = plan.sources.flatMap((source) => [
      { source } as Unit, ...(docsOf.get(source.id) ?? []).map((doc) => ({ source, doc })),
    ]);
    const feed = prefetch(units, async (unit, ctx): Promise<any> => {
      if (!unit.doc) {
        return fetchJson<any>(
          cmSourceMetaUrl(dataset, unit.source), { bytes: unit.source.meta_bytes, sha256: unit.source.meta_sha256 }, ctx);
      }
      const d = unit.doc;
      const urls = cmDocumentUrls(dataset, d);
      const [docMeta, notes] = await Promise.all([
        fetchJson<any>(urls.meta, { bytes: d.meta_bytes, sha256: d.meta_sha256 }, ctx),
        fetchJson<any>(urls.notes, { bytes: d.notes_bytes, sha256: d.notes_sha256 }, ctx),
      ]);
      return { docMeta, notes };
    }, CM_PREFETCH_CHANTS, this.context(options.signal));

    return this.importSources<CmSource>({
      sources: plan.sources,
      chants: plan.documents.length,
      bytesTotal: plan.bytes,
      options,
      datasetId: dataset.entry.id,
      upstreamRef: dataset.dataset.upstream.ref ?? '',
      label: (s) => s.quellensigle,
      key: (s) => s.id,
      fingerprint: (s) => fingerprintOf(
        cmSourceFingerprintParts(s, index.documents.filter((d) => d.source === s.id)), sha256Hex),
      dispose: () => feed.close(),
      importOne: async (source, session, run) => {
        const settings = await localforage.getItem<any>('monodi_settings');
        const meta = (await feed.take()).value;
        session.bytesDone += source.meta_bytes;
        run.workspaceSourceId = meta.id || meta.quellensigle || source.id;
        run.sourceWasNew = !session.writer.hasSource(run.workspaceSourceId);
        session.writer.stageSource(sourceFromMeta(meta, run.workspaceSourceId), meta, options.overwrite);

        const documents = docsOf.get(source.id) ?? [];
        const left = skipped.get(source.id);
        if (left) {
          session.summary.keptExisting += left.chants;
          session.bytesDone += left.bytes;
        }
        const step = new NotesStep(session, run);
        let done = 0;
        for (let i = 0; i < documents.length; i++) {
          const d = documents[i];
          const taken = (await feed.take()).value;
          const notes = taken.notes;
          // The link back to the page of the chant, so the copy can be compared with the original.
          const docMeta = withOriginalLink(taken.docMeta, cmDocumentPageUrl(d.id), CM_LINK_LABEL);
          session.bytesDone += d.meta_bytes + d.notes_bytes;
          done++;
          const docId = String(docMeta['id'] || docMeta['dokumenten_id'] || d.id);
          if (session.writer.hasDocument(docId) && !options.overwrite) {
            session.summary.keptExisting++;
          } else {
            if (notes && notes.kind === 'RootContainer' && placeholderImportEnabled(settings)) {
              normalizeDocumentComments(notes);
              applyPlaceholderImport(notes, settings);
            }
            step.add(docId, notes, documentFromMeta(docMeta, docId, run.workspaceSourceId));
          }
          if (step.full) await step.flush();
          session.report(`${source.quellensigle}: ${done} of ${documents.length} chants`, session.summary.sources);
        }
        await step.flush();
      },
    });
  }

  // ── Cantus Corpus ──────────────────────────────────────────────────────────────────────────────────────────────

  async importCantus(
    dataset: LoadedDataset,
    plan: CantusPlan,
    selection: ChantSelection,
    options: ImportOptions & { alignText: boolean },
  ): Promise<ImportSummary> {
    this.assertWithinLimit(plan.chants);
    const feed = prefetch(
      plan.sources, (source, ctx) => fetchCantusChants(dataset, source, ctx), CANTUS_PREFETCH_SOURCES,
      this.context(options.signal),
    );
    return this.importSources<CantusSource>({
      sources: plan.sources,
      chants: plan.chants,
      bytesTotal: plan.downloadBytes,
      options,
      datasetId: dataset.entry.id,
      upstreamRef: dataset.dataset.upstream.release ?? dataset.dataset.upstream.ref ?? '',
      label: (s) => s.siglum,
      key: (s) => s.id,
      fingerprint: async (s) => fingerprintOf(cantusSourceFingerprintParts(s), sha256Hex),
      dispose: () => feed.close(),
      importOne: async (source, session, run) => {
        const chants: CantusChant[] = (await feed.take()).value.filter((c) => takesChant(c, selection));
        session.bytesDone += source.bytes;
        run.sourceWasNew = !session.writer.hasSource(source.id);
        const meta = cantusSourceMeta(source);
        session.writer.stageSource(sourceFromMeta(meta, source.id), meta, options.overwrite);
        const step = new NotesStep(session, run);
        let done = 0;
        for (const chant of chants) {
          done++;
          const docId = cantusDocumentId(source, chant);
          if (session.writer.hasDocument(docId) && !options.overwrite) {
            session.summary.keptExisting++;
          } else {
            let notes;
            try {
              const converted = cantusNotes(chant, { alignText: options.alignText });
              if (converted.warnings.length > 0) session.summary.conversionWarnings++;
              notes = converted.root;
            } catch {
              session.summary.conversionWarnings++;
              notes = cantusNotes({ ...chant, volpiano: '' }, { alignText: false }).root;
            }
            step.add(docId, notes, documentFromMeta(cantusDocumentMeta(dataset, source, chant), docId, source.id));
          }
          if (step.full) {
            await step.flush();
            session.report(`${source.siglum}: ${done} of ${chants.length} chants`, session.summary.sources);
          }
        }
        await step.flush();
      },
    });
  }

  // ── removing an import ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Remove what an import wrote: its documents and their notes, and the source if no other document belongs to it.
   * Documents of the same source that the person added themselves stay, and so does the source.
   */
  async removeImport(record: ImportRecord): Promise<{ documents: number; sourceRemoved: boolean }> {
    await NotesStore.ensureMigrated();
    const ids = new Set(record.documentIds);
    await NotesStore.removeMany(Array.from(ids));
    const { removed, sourceRemoved } = await WorkspaceWriter.remove(ids, record.workspaceSourceId);
    await this.saveManifest(removeRecord(await this.getManifest(), record.datasetId, record.sourceId));
    // A source that the sync leaves out was never uploaded by this person; removing it here must not delete a copy that
    // another person (or an earlier push) put on GitHub.
    const leftOut = await SyncExclusions.has(record.workspaceSourceId);
    if (sourceRemoved && !leftOut) await PushCache.markDeleted(record.workspaceSourceId);
    else await PushCache.markDirty(record.workspaceSourceId);
    if (sourceRemoved) await SyncExclusions.remove([record.workspaceSourceId]);
    this.api.invalidateCache();
    return { documents: removed, sourceRemoved };
  }

  /** Add the link to the original page to the documents of all earlier imports; returns how many documents were changed. */
  async addOriginalLinks(): Promise<number> {
    const manifest = await this.getManifest();
    const { changed, sourceIds } = await WorkspaceWriter.addOriginalLinks(manifest.records);
    if (changed > 0) await this.afterImport(sourceIds);
    return changed;
  }

  /** The identifiers of the workspace sources that the GitHub sync leaves out. */
  syncLeftOut(): Promise<Set<string>> {
    return SyncExclusions.getAll();
  }

  /** Include a source in the GitHub sync, or leave it out again. */
  async setSynced(workspaceSourceId: string, synced: boolean): Promise<void> {
    if (synced) await SyncExclusions.remove([workspaceSourceId]);
    else await SyncExclusions.add([workspaceSourceId]);
    await PushCache.markDirty(workspaceSourceId);
  }

  /** The workspace changed without the API service knowing: tell the sync which manuscripts to look at again. */
  private async afterImport(touchedSourceIds: string[]): Promise<void> {
    await PushCache.markDirty(touchedSourceIds);
    this.api.invalidateCache();
  }
}

/** A short text for an error of the client, for a toast or the dialog. */
export function describeImportError(error: unknown): string {
  if (error instanceof DatasetError) {
    if (error.kind === 'aborted') return 'The import was cancelled; what was imported so far is kept.';
    if (error.kind === 'integrity') return `A file did not match its checksum and was not imported: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
