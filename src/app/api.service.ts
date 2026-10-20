import { MetadataPatch, applyMetadataPatches, DOCUMENT_METADATA_FIELDS, SOURCE_METADATA_FIELDS } from './metadata-patch';
import { ClefDisplayMode, sanitizeClefDisplayMode } from './clef-policy';
import type { HeadingField } from './print/doc-heading';
import { FolioPrefixMode, sanitizeFolioPrefixMode } from './folio-label';
import { sanitizeNotationColor } from './notation-color';
import { PRINT_PDF_DEFAULTS } from './pdf-defaults';
import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import * as VM from './types/model';
import { v4 as uuidv4 } from 'uuid';
import * as localforage from 'localforage';
import { NotesStore } from './notes-store';
import { ensureSchemaVersion } from './schema';
import { NoteFlagDef, sanitizeNoteFlags, setNoteFlagDefs } from './notes/note-flags';
import { MeiMappingProfileV2, defaultMeiProfile, migrateV1MeiMappings, normalizePatternRule } from './mei/mei-mapping.model';
import { SavedCommentTemplate } from './comment/comment-templates';
import { BackupReminderService } from './backup-reminder.service';
import { PushCache } from './push-cache';
import { ORPHAN_BUNDLE_ID } from './workspace-source';
import { repairStoredSources } from './source-repair';

@Injectable({
  providedIn: 'root'
})
export class APIService {
  private sourcesCache: Source[] | null = null;
  private documentsCache: Document[] | null = null;
  /** The first read of each list. The app start and the first page both ask for it at the same moment; they must
   *  share one read, or each would build its own copy (and, for sources, its own repaired ids). */
  private sourcesLoading: Promise<Source[]> | null = null;
  private documentsLoading: Promise<Document[]> | null = null;
  /** Bumped by `invalidateCache`: a read that started before it must not fill the cache afterwards. */
  private cacheGeneration = 0;
  /** The tail of the queue of writes, see `serialized`. */
  private writeQueue: Promise<unknown> = Promise.resolve();
  public storagePersisted: boolean | null = null;

  constructor(private backupReminder: BackupReminderService) {
    localforage.config({
      name: 'monodi-light',
      storeName: 'monodi_data'
    });
    this.initStorage();
  }

  public invalidateCache() {
    this.cacheGeneration++;
    this.sourcesCache = null;
    this.documentsCache = null;
    this.sourcesLoading = null;
    this.documentsLoading = null;
  }

  /**
   * Runs a write after every write started before it has finished. A write reads the list, changes it and stores
   * it again; two that overlap would both start from the same list, and the second would silently undo the first
   * (a deleted document coming back, an edit lost). One failing write does not block the ones behind it.
   */
  private serialized<T>(write: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(write, write);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private getSources(): Promise<Source[]> {
    if (this.sourcesCache) return Promise.resolve(this.sourcesCache);
    return this.sourcesLoading ??= this.loadSources();
  }

  private async loadSources(): Promise<Source[]> {
    const generation = this.cacheGeneration;
    try {
      const { sources, repaired } = repairStoredSources(await localforage.getItem<Source[]>('monodi_sources'));
      // A save or an invalidation that happened while we were reading wins over what we read.
      if (this.sourcesCache || generation !== this.cacheGeneration) return this.sourcesCache ?? sources;
      this.sourcesCache = sources;
      if (repaired) {
        console.warn('Repaired sources without a usable id.');
        await localforage.setItem('monodi_sources', sources).catch(e => console.warn('Could not save repaired sources:', e));
      }
      return sources;
    } catch (e) {
      if (generation === this.cacheGeneration) this.sourcesLoading = null;   // let the next call try again
      throw e;
    }
  }

  private async saveSources(sources: Source[]): Promise<void> {
    this.sourcesCache = sources;
    await localforage.setItem('monodi_sources', sources);
    this.backupReminder.markChanged();
  }

  private getDocuments(): Promise<Document[]> {
    if (this.documentsCache) return Promise.resolve(this.documentsCache);
    return this.documentsLoading ??= this.loadDocuments();
  }

  private async loadDocuments(): Promise<Document[]> {
    const generation = this.cacheGeneration;
    try {
      const stored = await localforage.getItem<Document[]>('monodi_documents');
      const docs = Array.isArray(stored) ? stored : [];
      if (this.documentsCache || generation !== this.cacheGeneration) return this.documentsCache ?? docs;
      this.documentsCache = docs;
      return docs;
    } catch (e) {
      if (generation === this.cacheGeneration) this.documentsLoading = null;
      throw e;
    }
  }

  private async saveDocuments(docs: Document[]): Promise<void> {
    this.documentsCache = docs;
    await localforage.setItem('monodi_documents', docs);
    this.backupReminder.markChanged();
  }

  private async initStorage() {
    await ensureSchemaVersion();
    // Warm up the caches at startup
    await this.getSources();
    await this.getDocuments();
    await NotesStore.ensureMigrated();

    try {
      if (navigator.storage && navigator.storage.persist) {
        let persisted = await navigator.storage.persisted();
        if (!persisted) {
          persisted = await navigator.storage.persist();
        }
        this.storagePersisted = persisted;
      }
    } catch (e) {
      console.warn('Storage persistence check/request failed:', e);
    }
  }

  public logout(): Observable<null> {
    return of(null).pipe(delay(200));
  }

  public login(user: string, password: string): Observable<InvalidUsernameFormat | LoginFailed | LoginSuccessful> {
    return of({
      kind: "LoginSuccessful" as const,
      user: user,
      roles: ["admin"],
      token: "mock-local-token"
    }).pipe(delay(200));
  }

  public listUsers(token: string): Observable<LoginRequired | InsufficientPermissions | UserInfosRetrieved> {
    return of({
      kind: "UserInfosRetrieved" as const,
      infos: [{ user: "local-user", roles: ["admin"] }]
    });
  }

  public createUser(token: string, user: string, password: string): Observable<LoginRequired | InsufficientPermissions | Ok | InvalidUsernameFormat | UserAlreadyExists> {
    return of({ kind: "Ok" as const });
  }

  public removeUser(token: string, user: string): Observable<LoginRequired | InsufficientPermissions | Ok | InvalidUsernameFormat | TriedToRemoveSelf> {
    return of({ kind: "Ok" as const });
  }

  public listSources(token: string): Observable<LoginRequired | SourcesRetrieved> {
    return from((async () => {
      const sources = await this.getSources();
      return { kind: "SourcesRetrieved" as const, sources: sources };
    })());
  }

  public updateSource(token: string, source: Source): Observable<LoginRequired | Ok | SourceNotFound> {
    return from(this.serialized(async () => {
      let sources = await this.getSources();
      const index = sources.findIndex((s: Source) => s.id === source.id);
      if (index !== -1) {
        sources[index] = source;
        await this.saveSources(sources);
        await PushCache.markDirty(source.id);
        return { kind: "Ok" as const };
      }
      return { kind: "SourceNotFound" as const };
    }));
  }

  /**
   * Metadata edits of many sources at once (the metadata grid): one read, one write of the list, one push-cache
   * update, however many edits there are. `updateSource` per source would write the whole list each time.
   */
  public updateSourcesMetadata(token: string, patches: MetadataPatch[]): Observable<LoginRequired | MetadataUpdated> {
    return from(this.serialized(async () => {
      const sources = await this.getSources();
      const res = applyMetadataPatches(sources, patches, SOURCE_METADATA_FIELDS);
      if (res.changedIds.length > 0) {
        await this.saveSources(res.items);
        await PushCache.markDirty(res.changedIds);
      }
      return { kind: "MetadataUpdated" as const, updated: res.changedIds.length, missing: res.missingIds.length, rejectedFields: res.rejectedFields };
    }));
  }

  /**
   * Metadata edits of many documents at once. Touches neither the notes (the transcription) nor the documents that
   * have no edit; marks only the sources that own a changed document for the next push.
   */
  public updateDocumentsMetadata(token: string, patches: MetadataPatch[]): Observable<LoginRequired | MetadataUpdated> {
    return from(this.serialized(async () => {
      const documents = await this.getDocuments();
      const res = applyMetadataPatches(documents, patches, DOCUMENT_METADATA_FIELDS);
      if (res.changedIds.length > 0) {
        await this.saveDocuments(res.items);
        const changed = new Set(res.changedIds);
        const owners = new Set<string>();
        for (const d of res.items) if (changed.has(d.id)) owners.add(d.quelle_id || ORPHAN_BUNDLE_ID);
        await PushCache.markDirty(Array.from(owners));
      }
      return { kind: "MetadataUpdated" as const, updated: res.changedIds.length, missing: res.missingIds.length, rejectedFields: res.rejectedFields };
    }));
  }

  public getSource(token: string, id: string): Observable<LoginRequired | SourceRetrieved | SourceNotFound | InsufficientPermissions> {
    return from((async () => {
      const sources = await this.getSources();
      const source = sources.find((s: Source) => s.id === id);
      if (source) {
        return { kind: "SourceRetrieved" as const, source: source };
      }
      return { kind: "SourceNotFound" as const };
    })());
  }

  public getSigle(token: string, id: string): Observable<LoginRequired | SigleRetrieved | SourceNotFound> {
    return from((async () => {
      const sources = await this.getSources();
      const source = sources.find((s: Source) => s.id === id);
      if (source) {
        return { kind: "SigleRetrieved" as const, sigle: source.quellensigle };
      }
      return { kind: "SourceNotFound" as const };
    })());
  }

  public querySources(token: string, query: SourceQuery): Observable<LoginRequired | SourcesRetrieved> {
    return from((async () => {
      let sources = await this.getSources();
      if (query) {
        sources = sources.filter((s: Source) => {
          for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== '') {
              const sv = String((s as any)[key] ?? '').toLowerCase();
              if (!sv.includes(String(value).toLowerCase())) return false;
            }
          }
          return true;
        });
      }
      return { kind: "SourcesRetrieved" as const, sources: sources };
    })());
  }

  public fullTextSearchSources(token: string, text: string): Observable<LoginRequired | SourcesRetrieved> {
    return from((async () => {
      const sources = await this.getSources();
      if (!text.trim()) return { kind: "SourcesRetrieved" as const, sources };
      const q = text.toLowerCase();
      const filtered = sources.filter((s: Source) => {
        const allText = Object.values(s).filter(v => typeof v === 'string').join(' ').toLowerCase();
        return allText.includes(q);
      });
      return { kind: "SourcesRetrieved" as const, sources: filtered };
    })());
  }

  public createSource(token: string, source: Source): Observable<LoginRequired | SourceCreated> {
    return from(this.serialized(async () => {
      let sources = await this.getSources();
      const newId = uuidv4();
      source.id = newId;
      sources.push(source);
      await this.saveSources(sources);
      await PushCache.markDirty(newId);
      return { kind: "SourceCreated" as const, id: newId };
    }));
  }

  public importZip(token: string, data: string): Observable<LoginRequired | UploadFinished | InsufficientPermissions> {
    return of({ kind: "UploadFinished" as const, errors: [] });
  }

  public importDocuments(token: string, data: string): Observable<LoginRequired | UploadFinished | InsufficientPermissions> {
    return of({ kind: "UploadFinished" as const, errors: [] });
  }

  public importSources(token: string, data: string): Observable<LoginRequired | UploadFinished | InsufficientPermissions> {
    return of({ kind: "UploadFinished" as const, errors: [] });
  }

  public deleteDocuments(token: string, data: string): Observable<LoginRequired | UploadFinished | InsufficientPermissions> {
    return from(this.serialized(async () => {
      const docIdsToRemove = JSON.parse(data) as string[];
      const doomed = new Set(docIdsToRemove);
      let documents = await this.getDocuments();

      // The manuscripts losing a document still exist remotely and need a
      // push to reflect the removal, so they're dirty — not deleted.
      const removed = documents.filter((d: Document) => doomed.has(d.id));
      const affectedManuscripts = [...new Set(removed.map(d => d.quelle_id || ORPHAN_BUNDLE_ID))];

      documents = documents.filter((d: Document) => !doomed.has(d.id));
      await this.saveDocuments(documents);
      // Per-document deletion via NotesStore avoids re-saving the whole
      // notes dict (which can exceed the IndexedDB structured-clone limit
      // on large workspaces).
      await NotesStore.removeMany(docIdsToRemove);
      await PushCache.markDirty(affectedManuscripts);
      return { kind: "UploadFinished" as const, errors: [] };
    }));
  }

  public deleteSources(token: string, data: string): Observable<LoginRequired | UploadFinished | InsufficientPermissions> {
    return from(this.serialized(async () => {
      const sourceIdsToRemove = JSON.parse(data) as string[];
      const doomed = new Set(sourceIdsToRemove);
      let sources = await this.getSources();
      let documents = await this.getDocuments();

      sources = sources.filter((s: Source) => !doomed.has(s.id!));

      const docIdsToRemove = documents.filter((d: Document) => doomed.has(d.quelle_id)).map(d => d.id);
      documents = documents.filter((d: Document) => !doomed.has(d.quelle_id));

      await this.saveSources(sources);
      await this.saveDocuments(documents);
      await NotesStore.removeMany(docIdsToRemove);
      // The whole manuscript is gone: the next push should remove its files
      // from GitHub rather than just re-upload a changed version of them.
      await PushCache.markDeleted(sourceIdsToRemove);
      return { kind: "UploadFinished" as const, errors: [] };
    }));
  }

  public listDocuments(token: string): Observable<LoginRequired | DocumentsRetrieved> {
    return from((async () => {
      const documents = await this.getDocuments();
      return { kind: "DocumentsRetrieved" as const, documents: documents };
    })());
  }

  public updateDocument(token: string, update: CreateDocument): Observable<LoginRequired | Ok | DocumentNotFound | InsufficientPermissions> {
    return from(this.serialized(async () => {
      let documents = await this.getDocuments();

      const index = documents.findIndex((d: Document) => d.id === update.document.id);
      if (index !== -1) {
        // A document can move between manuscripts (quelle_id changed) — both
        // the old and new owner need a push to pick up the change.
        const oldOwner = documents[index].quelle_id || ORPHAN_BUNDLE_ID;
        const newOwner = update.document.quelle_id || ORPHAN_BUNDLE_ID;
        documents[index] = update.document;
        await this.saveDocuments(documents);
        await NotesStore.set(update.document.id, update.notes);
        await PushCache.markDirty(oldOwner === newOwner ? [newOwner] : [oldOwner, newOwner]);
        return { kind: "Ok" as const };
      }
      return { kind: "DocumentNotFound" as const };
    }));
  }

  public getDocument(token: string, id: string): Observable<LoginRequired | DocumentRetrieved | DocumentNotFound | InsufficientPermissions> {
    return from((async () => {
      const documents = await this.getDocuments();
      const document = documents.find((d: Document) => d.id === id);
      if (document) {
        return { kind: "DocumentRetrieved" as const, document: document };
      }
      return { kind: "DocumentNotFound" as const };
    })());
  }

  public removeDocument(token: string, id: string): Observable<LoginRequired | Ok> {
    return from(this.serialized(async () => {
      let documents = await this.getDocuments();
      const removed = documents.find((d: Document) => d.id === id);
      documents = documents.filter((d: Document) => d.id !== id);
      await this.saveDocuments(documents);
      await NotesStore.remove(id);
      await PushCache.markDirty(removed?.quelle_id || ORPHAN_BUNDLE_ID);
      return { kind: "Ok" as const };
    }));
  }

  public createDocument(token: string, creation: CreateDocument): Observable<LoginRequired | DocumentCreated> {
    return from(this.serialized(async () => {
      let documents = await this.getDocuments();

      const newId = uuidv4();
      creation.document.id = newId;
      documents.push(creation.document);
      await this.saveDocuments(documents);
      await NotesStore.set(newId, creation.notes);
      await PushCache.markDirty(creation.document.quelle_id || ORPHAN_BUNDLE_ID);
      return { kind: "DocumentCreated" as const, id: newId };
    }));
  }

  public queryDocuments(token: string, query: DocumentQuery): Observable<LoginRequired | DocumentsRetrieved> {
    return from((async () => {
      let documents = await this.getDocuments();
      if (query) {
        documents = documents.filter((d: Document) => {
          for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== '') {
              const dv = String((d as any)[key] ?? '').toLowerCase();
              if (!dv.includes(String(value).toLowerCase())) return false;
            }
          }
          return true;
        });
      }
      return { kind: "DocumentsRetrieved" as const, documents: documents };
    })());
  }

  public fullTextSearchDocuments(token: string, text: string): Observable<LoginRequired | DocumentsRetrieved> {
    return from((async () => {
      const documents = await this.getDocuments();
      if (!text.trim()) return { kind: "DocumentsRetrieved" as const, documents };
      const q = text.toLowerCase();
      const filtered = documents.filter((d: Document) => {
        const allText = Object.values(d).filter(v => typeof v === 'string').join(' ').toLowerCase();
        return allText.includes(q);
      });
      return { kind: "DocumentsRetrieved" as const, documents: filtered };
    })());
  }

  public getAllDocumentNotes(token: string): Observable<{ [id: string]: VM.RootContainer }> {
    return from((async () => {
      // NotesStore.getAll() materialises every document's notes into one
      // dict for the caller (search / export use this). Migration from the
      // legacy single-blob storage is transparent.
      return await NotesStore.getAll();
    })());
  }

  public getDocumentNotes(token: string, id: string): Observable<LoginRequired | NotesRetrieved | DocumentNotFound | InsufficientPermissions> {
    return from((async () => {
      const data = await NotesStore.get(id);
      if (data) {
        return { kind: "NotesRetrieved" as const, data: data };
      }
      return { kind: "DocumentNotFound" as const };
    })());
  }

  public verifyNotes(token: string, notes: string): Observable<LoginRequired | NotesRetrieved | Failed> {
    return of({ kind: "NotesRetrieved" as const, data: JSON.parse(notes) });
  }

  public getSettings(token: string): Observable<LoginRequired | SettingsRetrieved> {
    return from((async () => {
      const stored = await localforage.getItem<ProjectSettings>('monodi_settings');
      const defaults = this.defaultSettings();
      const settings = stored ? { ...defaults, ...stored } : defaults;
      return { kind: "SettingsRetrieved" as const, settings: sanitizeSettings(settings) };
    })());
  }

  public updateSettings(token: string, settings: ProjectSettings): Observable<LoginRequired | Ok> {
    return from((async () => {
      await localforage.setItem('monodi_settings', sanitizeSettings(settings));
      return { kind: "Ok" as const };
    })());
  }

  /** Fresh settings: structural defaults plus the print-edition look. */
  private defaultSettings(): ProjectSettings {
    return { ...this.baseDefaultSettings(), ...PRINT_PDF_DEFAULTS };
  }

  private baseDefaultSettings(): ProjectSettings {
    return {
      quellensigle: [],
      herkunftsregion: [],
      herkunftsort: [],
      herkunftsinstitution: [],
      ordenstradition: [],
      quellentyp: [],
      bibliotheksort: [],
      bibliothek: [],
      bibliothekssignatur: [],
      gattung1: [],
      gattung2: [],
      festtag: [],
      feier: [],
      customSourceFields: [],
      customDocumentFields: [],
      customLists: {},
      pdfScale: 0.36,
      pdfContinuationIndent: 20,
      pdfFormat: 'a4',
      pdfOrientation: 'portrait',
      pdfSyllableSpacing: 10,
      pdfVerticalSpace: 12,
      pdfMarginLeft: 40,
      pdfSignaturSpace: 60,
      pdfFontSize: 10,
      pdfTitleFontSize: 16,
      pdfTitleVerticalSpace: 20,
      pdfMetadataFontSize: 9,
      pdfMetadataVerticalSpace: 15,
      pdfCommentBlockGap: 25,
      pdfCommentFontSize: 9,
      pdfCommentTitleFontSize: 10,
      pdfCommentStaffScale: 0.28,
      pdfBracketWidth: 12,
      pdfBracketThickness: 1.2,
      pdfMarginTop: 40,
      pdfMarginBottom: 40,
      pdfMarginRight: 40,
      pdfStaffSpacing: 2,
      pdfBracketGap: 5,
      pdfBracketTick: 4,
      pdfSyllableTextOffset: 8,
      pdfTextBlockGap: 10,
      pdfCommentTreePadding: 4,
      pdfCommentTreeGap: 4,
      pdfHeaderSource: 'textinitium',
      pdfShowPageNumbers: true,
      pdfHeadlineMetadataFields: ['dokumenten_id', 'festtag'],
      pdfHeadlineFontSize: 8,
      pdfPageNumberFontSize: 8,
      pdfParatextFontSize: 10,
      pdfParatextSpacing: 6.5,
      pdfFontFamily: 'times',
      clefDisplayMode: 'document-start',
      pdfFolioPrefix: 'auto',
      notationColor: '#333333',
      meiMappings: {
        formteilContainer: { tag: 'section' },
        zeileContainer: { tag: 'sb' },
        syllable: { tag: 'syllable', textTag: 'syl' },
        neume: { tag: 'neume' },
        note: {
          tag: 'nc',
          pitchAttr: 'pname',
          octaveAttr: 'oct',
          liquescentAttr: 'curve',
          liquescentValue: 'c',
          connectionAttr: 'con',
          connectionGapValue: 'g'
        },
        oriscus: { tag: 'oriscus' },
        quilisma: { tag: 'quilisma' },
        strophicus: { tag: 'strophicus' },
        liquescentElement: { tag: 'liquescent' },
        clef: {
          tag: 'clef',
          shapeAttr: 'shape',
          lineAttr: 'line',
          defaultLine: '1'
        },
        paratextContainer: { tag: 'dir' }
      }
    };
  }
}

export interface LevelNames {
  level1?: string;
  level2?: string;
  level3?: string;
}

export interface GenreLevelProfile {
  id: string;
  gattung1: string;
  gattung2: string;
  names: LevelNames;
}

export interface ProjectSettings {
  genreLevelProfiles?: GenreLevelProfile[];
  quellensigle: string[];
  herkunftsregion: string[];
  herkunftsort: string[];
  herkunftsinstitution: string[];
  ordenstradition: string[];
  quellentyp: string[];
  bibliotheksort: string[];
  bibliothek: string[];
  bibliothekssignatur: string[];
  gattung1: string[];
  gattung2: string[];
  festtag: string[];
  feier: string[];
  customSourceFields?: { key: string, label: string }[];
  customDocumentFields?: { key: string, label: string }[];
  /** How documents can refer to each other and the suffix of the related document's number in the print (see relations/relations.ts). */
  relationTypes?: { name: string; suffix: string }[];
  customLists?: { [key: string]: string[] };
  commentTemplates?: SavedCommentTemplate[];
  /** The standard set of the notation documentation: patterns every manuscript shows, with the Reference ID they usually get (see notation-set.ts). */
  notationStandard?: { pattern: string; refId: string }[];
  /** How the rows of the notation documentation are ordered: by Reference ID, then as the neume table ('id', default), or only as the neume table ('neume'). */
  notationOrder?: 'neume' | 'id';
  pdfScale?: number;
  /** Page format for PDF export: 'a5' | 'a4' | 'a3' | 'letter' | 'legal' | 'tabloid'. */
  pdfFormat?: string;
  /** Page orientation for PDF export. */
  pdfOrientation?: 'portrait' | 'landscape';
  pdfSynopsisScale?: number;
  pdfSynopsisShowHeader?: boolean;
  pdfSynopsisShowHeaderMetadata?: boolean;
  pdfSynopsisShowFooter?: boolean;
  pdfSynopsisShowFooterIds?: boolean;
  pdfSynopsisShowDate?: boolean;
  pdfSyllableSpacing?: number;
  pdfVerticalSpace?: number;
  htmlExportSourceMetadata?: string[];
  htmlExportDocumentMetadata?: string[];
  htmlExportCustomCss?: string;
  htmlExportFrontpageHtml?: string;
  htmlExportHeaderHtml?: string;
  htmlExportFooterHtml?: string;
  undoHistorySize?: number;
  pdfMarginLeft?: number;
  pdfSignaturSpace?: number;
  pdfFontSize?: number;
  pdfTitleFontSize?: number;
  pdfTitleVerticalSpace?: number;
  pdfMetadataFontSize?: number;
  pdfMetadataVerticalSpace?: number;
  pdfCommentBlockGap?: number;
  pdfCommentFontSize?: number;
  pdfCommentTitleFontSize?: number;
  pdfCommentStaffScale?: number;
  pdfBracketWidth?: number;
  pdfBracketThickness?: number;
  pdfMarginTop?: number;
  pdfMarginBottom?: number;
  pdfMarginRight?: number;
  pdfStaffSpacing?: number;
  pdfBracketGap?: number;
  pdfBracketTick?: number;
  pdfSyllableTextOffset?: number;
  pdfTextBlockGap?: number;
  pdfCommentTreePadding?: number;
  pdfCommentTreeGap?: number;
  pdfHeaderSource?: string;
  pdfShowPageNumbers?: boolean;
  pdfHeadlineMetadataFields?: string[];
  pdfHeadlineFontSize?: number;
  pdfPageNumberFontSize?: number;
  pdfParatextFontSize?: number;
  pdfParatextSpacing?: number;
  /** 'CrimsonText' (print edition), 'times', 'helvetica' or an embedded Noto family. */
  pdfFontFamily?: string;
  /** 'print': running head + rule on every page, page number in the head; 'classic': footer "Page n of m". */
  pdfPageStyle?: 'print' | 'classic';
  /** Folio labels in print: leave as typed, add "f." once the manuscript uses it (default), or always. */
  pdfFolioPrefix?: FolioPrefixMode;
  pdfApparatusStaffScale?: number;
  pdfApparatusEntryGap?: number;
  pdfLemmaColumnMax?: number;
  pdfWidowSlack?: number;
  pdfHideStaffWithoutNotes?: boolean;
  pdfCompactTextless?: boolean;
  /** Syllables with neither text nor notes take no room (default); off keeps their gap. */
  pdfSkipEmptySyllables?: boolean;
  /** Lyric style per section status (key: English status name): 'smallcaps' | 'uppercase' | 'lowercase'; missing = as typed. */
  pdfStatusTextStyle?: { [status: string]: 'none' | 'smallcaps' | 'uppercase' | 'lowercase' };
  pdfChapterHeadings?: boolean;
  pdfChapterNewPage?: boolean;
  /** Contents of the Edition: only the manuscripts (default, as in the printed volume) or every document. */
  pdfContentsEdition?: 'chapters' | 'documents';
  /** Transitions between Edition, Critical Apparatus and Source Descriptions: 'volume' = a page of its own with a rule (as in the printed volume, no running head), 'compact' = just a heading where the part begins. */
  pdfPartStyle?: 'volume' | 'compact';
  pdfContentsApparatus?: 'chapters' | 'documents' | 'none';
  pdfBookmarks?: boolean;
  /** Frame the edition number (document field "Print Edition") in the margin next to the title. */
  pdfShowEditionBox?: boolean;
  /** When the automatic G-clef is drawn: chant start only (print edition), every manuscript line, or every line break. */
  clefDisplayMode?: ClefDisplayMode;
  /** Colour of staff lines, notes, slurs and clef in editor, PDF and HTML export (#rrggbb). */
  notationColor?: string;
  /** Indent (pt) of automatically wrapped continuation systems in the PDF. */
  pdfContinuationIndent?: number;
  meiMappings?: MeiMappingSettings;
  meiProfiles?: MeiMappingProfileV2[];
  activeMeiProfileId?: string;
  /** User-defined note flags (virga etc.), see notes/note-flags.ts. */
  noteFlags?: NoteFlagDef[];
  /** Heading where a document begins in the PDF: fields, labels, styles (see print/doc-heading.ts). Default: ID, reference, genre (genre only where the PDF has several). */
  pdfDocHeadingFields?: HeadingField[];
  /** Between the parts of that heading (default three spaces). */
  pdfDocHeadingSeparator?: string;
  /** Import: comments on placeholder notes (old convention) move onto the syllables. Default on. */
  importPlaceholderComments?: boolean;
  /** Import: a syllable that holds nothing but placeholder notes loses them, comment or not. Default on. */
  clearLonePlaceholders?: boolean;
  /** Notes that count as placeholders on import, e.g. "F3, D6". */
  placeholderNotes?: string;
  /** Note written for a commented syllable without notes when exporting for old versions, e.g. "F3". */
  placeholderExportNote?: string;
}

export interface MeiMappingSettings {
  formteilContainer: {
    tag: string;
  };
  zeileContainer: {
    tag: string;
  };
  syllable: {
    tag: string;
    textTag: string;
  };
  neume: {
    tag: string;
  };
  note: {
    tag: string;
    pitchAttr: string;
    octaveAttr: string;
    liquescentAttr: string;
    liquescentValue: string;
    connectionAttr: string;
    connectionGapValue: string;
  };
  oriscus: { tag: string; };
  quilisma: { tag: string; };
  strophicus: { tag: string; };
  liquescentElement: { tag: string; };
  clef: {
    tag: string;
    shapeAttr: string;
    lineAttr: string;
    defaultLine: string;
  };
  paratextContainer: {
    tag: string;
  };
}

export interface SettingsRetrieved {
  "kind": "SettingsRetrieved";
  "settings": ProjectSettings;
}

export type User = string
export type Role = string

export interface Ok {
  "kind": "Ok";
}

export interface Failed {
  "kind": "Failed";
}

export interface LoginRequired {
  "kind": "LoginRequired";
}

export interface InsufficientPermissions {
  "kind": "InsufficientPermissions";
}

export interface InvalidUsernameFormat {
  "kind": "InvalidUsernameFormat";
}

export interface LoginFailed {
  "kind": "LoginFailed";
}

export interface LoginSuccessful {
  "kind": "LoginSuccessful";
  "user": User;
  "roles": Role[];
  "token": string;
}

export interface UserAlreadyExists {
  "kind": "UserAlreadyExists";
}

export interface UserInfosRetrieved {
  "kind": "UserInfosRetrieved";
  "infos": UserInfo[];
}

export interface TriedToRemoveSelf {
  "kind": "TriedToRemoveSelf";
}

export interface MetadataUpdated {
  "kind": "MetadataUpdated";
  /** Items that really changed. */
  "updated": number;
  /** Edits for items that no longer exist. */
  "missing": number;
  /** Fields refused because they are not metadata fields. */
  "rejectedFields": number;
}

export interface SourcesRetrieved {
  "kind": "SourcesRetrieved";
  "sources": Source[];
}

export interface SourceNotFound {
  "kind": "SourceNotFound";
}

export interface SourceRetrieved {
  "kind": "SourceRetrieved";
  "source": Source;
}

export interface SigleRetrieved {
  "kind": "SigleRetrieved";
  "sigle": string;
}

export interface SourceCreated {
  "kind": "SourceCreated";
  "id": string;
}

export interface DocumentsRetrieved {
  "kind": "DocumentsRetrieved";
  "documents": Document[];
}

export interface DocumentNotFound {
  "kind": "DocumentNotFound";
}

export interface DocumentRetrieved {
  "kind": "DocumentRetrieved";
  "document": Document;
}

export interface DocumentCreated {
  "kind": "DocumentCreated";
  "id": string;
}

export interface UploadFinished {
  "kind": "UploadFinished";
  errors: string[];
}

export interface NotesRetrieved {
  "kind": "NotesRetrieved";
  "data": VM.RootContainer;
}

export interface Source {
  id?: string;
  quellensigle: string;
  herkunftsregion: string;
  herkunftsort: string;
  herkunftsinstitution: string;
  ordenstradition: string;
  quellentyp: string;
  bibliotheksort: string;
  bibliothek: string;
  bibliothekssignatur: string;
  kommentar: string;
  datierung: string;
  iiifManifestUrl?: string;
  equivalents?: VM.EquivalentMetadata[];
  annotationRegions?: VM.AnnotationRegion[];
  annotationItems?: VM.AnnotationItem[];
  transcriptionAnnotations?: VM.TranscriptionAnnotation[];
  custom?: { [key: string]: string };
}

export interface Document {
  "id": string;
  "quelle_id": string;
  "dokumenten_id": string;
  "gattung1": string;
  "gattung2": string;
  "festtag": string;
  "feier": string;
  "textinitium": string;
  "bibliographischerverweis": string;
  "druckausgabe": string;
  "zeilenstart": string;
  "foliostart": string;
  "kommentar": string;
  "editionsstatus": string;
  "custom"?: { [key: string]: string };
}

export interface UserInfo {
  "user": User;
  "roles": Role[];
}

export interface DocumentQuery {
  "dokumenten_id": string | undefined;
  "gattung1": string | undefined;
  "gattung2": string | undefined;
  "festtag": string | undefined;
  "feier": string | undefined;
  "textinitium": string | undefined;
  "bibliographischerverweis": string | undefined;
  "druckausgabe": string | undefined;
  "zeilenstart": string | undefined;
  "foliostart": string | undefined;
  "kommentar": string | undefined;
}

export interface CreateDocument {
  "document": Document;
  "notes": VM.RootContainer;
}

export interface SourceQuery {
  quellensigle?: string | undefined;
  herkunftsregion?: string | undefined;
  herkunftsort?: string | undefined;
  herkunftsinstitution?: string | undefined;
  ordenstradition?: string | undefined;
  quellentyp?: string | undefined;
  bibliotheksort?: string | undefined;
  bibliothek?: string | undefined;
  bibliothekssignatur?: string | undefined;
  kommentar?: string | undefined;
  datierung?: string | undefined;
  iiifManifestUrl?: string | undefined;
  equivalents?: VM.EquivalentMetadata[] | undefined;
  annotationRegions?: VM.AnnotationRegion[] | undefined;
  annotationItems?: VM.AnnotationItem[] | undefined;
  transcriptionAnnotations?: VM.TranscriptionAnnotation[] | undefined;
}

export function sanitizeSettings(settings: any): ProjectSettings {
  if (!settings) return settings;
  const numericKeys = [
    'pdfScale',
    'pdfCommentStaffScale',
    'pdfSignaturSpace',
    'pdfMarginLeft',
    'pdfMarginRight',
    'pdfMarginTop',
    'pdfMarginBottom',
    'pdfStaffSpacing',
    'pdfSyllableSpacing',
    'pdfSyllableTextOffset',
    'pdfVerticalSpace',
    'pdfTextBlockGap',
    'pdfParatextSpacing',
    'pdfBracketWidth',
    'pdfBracketThickness',
    'pdfBracketGap',
    'pdfBracketTick',
    'pdfCommentTreePadding',
    'pdfCommentTreeGap',
    'pdfCommentBlockGap',
    'pdfApparatusStaffScale',
    'pdfApparatusEntryGap',
    'pdfLemmaColumnMax',
    'pdfWidowSlack',
    'pdfParatextFontSize',
    'pdfTitleFontSize',
    'pdfTitleVerticalSpace',
    'pdfFontSize',
    'pdfMetadataFontSize',
    'pdfMetadataVerticalSpace',
    'pdfCommentFontSize',
    'pdfCommentTitleFontSize',
    'pdfHeadlineFontSize',
    'pdfPageNumberFontSize',
    'pdfContinuationIndent'
  ];
  for (const key of numericKeys) {
    if (settings[key] !== undefined && settings[key] !== null) {
      settings[key] = Number(settings[key]);
    }
  }
  settings.clefDisplayMode = sanitizeClefDisplayMode(settings.clefDisplayMode);
  settings.pdfFolioPrefix = sanitizeFolioPrefixMode(settings.pdfFolioPrefix);
  if (!['chapters', 'documents', 'none'].includes(settings.pdfContentsApparatus)) settings.pdfContentsApparatus = 'chapters';
  settings.notationColor = sanitizeNotationColor(settings.notationColor);

  if (settings.commentTemplates !== undefined) {
    settings.commentTemplates = Array.isArray(settings.commentTemplates)
      ? settings.commentTemplates.filter((t: any) =>
          t && typeof t.id === 'string' && typeof t.name === 'string' && t.tree && typeof t.tree === 'object')
      : [];
  }

  if (!settings.meiProfiles || settings.meiProfiles.length === 0) {
    const defProfile = defaultMeiProfile();
    settings.meiProfiles = [defProfile];
    settings.activeMeiProfileId = defProfile.id;

    if (settings.meiMappings) {
      const defaultV1 = {
        formteilContainer: { tag: 'section' },
        zeileContainer: { tag: 'sb' },
        syllable: { tag: 'syllable', textTag: 'syl' },
        neume: { tag: 'neume' },
        note: {
          tag: 'nc',
          pitchAttr: 'pname',
          octaveAttr: 'oct',
          liquescentAttr: 'curve',
          liquescentValue: 'c',
          connectionAttr: 'con',
          connectionGapValue: 'g'
        },
        oriscus: { tag: 'oriscus' },
        quilisma: { tag: 'quilisma' },
        strophicus: { tag: 'strophicus' },
        liquescentElement: { tag: 'liquescent' },
        clef: {
          tag: 'clef',
          shapeAttr: 'shape',
          lineAttr: 'line',
          defaultLine: '1'
        },
        paratextContainer: { tag: 'dir' }
      };

      if (JSON.stringify(settings.meiMappings) !== JSON.stringify(defaultV1)) {
        const migrated = migrateV1MeiMappings(settings.meiMappings);
        migrated.name = 'Migrated legacy mapping';
        settings.meiProfiles.push(migrated);
        settings.activeMeiProfileId = migrated.id;
      }
    }
  }

  settings.noteFlags = sanitizeNoteFlags(settings.noteFlags);
  setNoteFlagDefs(settings.noteFlags);

  for (const prof of settings.meiProfiles ?? []) {
    if (prof.patternRules !== undefined) {
      prof.patternRules = Array.isArray(prof.patternRules)
        ? prof.patternRules.filter((r: any) => r && typeof r.id === 'string' && typeof r.pattern === 'string').map((r: any) => normalizePatternRule(r))
        : [];
    }
  }

  return settings;
}

