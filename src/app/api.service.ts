import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import * as VM from './types/model';
import { v4 as uuidv4 } from 'uuid';
import * as localforage from 'localforage';
import { NotesStore } from './notes-store';
import { ensureSchemaVersion } from './schema';
import { MeiMappingProfileV2, defaultMeiProfile, migrateV1MeiMappings } from './mei/mei-mapping.model';
import { SavedCommentTemplate } from './comment/comment-templates';
import { BackupReminderService } from './backup-reminder.service';

@Injectable({
  providedIn: 'root'
})
export class APIService {
  private sourcesCache: Source[] | null = null;
  private documentsCache: Document[] | null = null;
  public storagePersisted: boolean | null = null;

  constructor(private backupReminder: BackupReminderService) {
    localforage.config({
      name: 'monodi-light',
      storeName: 'monodi_data'
    });
    this.initStorage();
  }

  public invalidateCache() {
    this.sourcesCache = null;
    this.documentsCache = null;
  }

  private async getSources(): Promise<Source[]> {
    if (this.sourcesCache) return this.sourcesCache;
    const sources = await localforage.getItem<Source[]>('monodi_sources');
    this.sourcesCache = sources || [];
    return this.sourcesCache;
  }

  private async saveSources(sources: Source[]): Promise<void> {
    this.sourcesCache = sources;
    await localforage.setItem('monodi_sources', sources);
    this.backupReminder.markChanged();
  }

  private async getDocuments(): Promise<Document[]> {
    if (this.documentsCache) return this.documentsCache;
    const docs = await localforage.getItem<Document[]>('monodi_documents');
    this.documentsCache = docs || [];
    return this.documentsCache;
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
    return from((async () => {
      let sources = await this.getSources();
      const index = sources.findIndex((s: Source) => s.id === source.id);
      if (index !== -1) {
        sources[index] = source;
        await this.saveSources(sources);
        return { kind: "Ok" as const };
      }
      return { kind: "SourceNotFound" as const };
    })());
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
    return from((async () => {
      let sources = await this.getSources();
      const newId = uuidv4();
      source.id = newId;
      sources.push(source);
      await this.saveSources(sources);
      return { kind: "SourceCreated" as const, id: newId };
    })());
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
    return from((async () => {
      const docIdsToRemove = JSON.parse(data) as string[];
      let documents = await this.getDocuments();

      documents = documents.filter((d: Document) => !docIdsToRemove.includes(d.id));
      await this.saveDocuments(documents);
      // Per-document deletion via NotesStore avoids re-saving the whole
      // notes dict (which can exceed the IndexedDB structured-clone limit
      // on large workspaces).
      await NotesStore.removeMany(docIdsToRemove);
      return { kind: "UploadFinished" as const, errors: [] };
    })());
  }

  public deleteSources(token: string, data: string): Observable<LoginRequired | UploadFinished | InsufficientPermissions> {
    return from((async () => {
      const sourceIdsToRemove = JSON.parse(data) as string[];
      let sources = await this.getSources();
      let documents = await this.getDocuments();

      sources = sources.filter((s: Source) => !sourceIdsToRemove.includes(s.id!));

      const docIdsToRemove = documents.filter((d: Document) => sourceIdsToRemove.includes(d.quelle_id)).map(d => d.id);
      documents = documents.filter((d: Document) => !sourceIdsToRemove.includes(d.quelle_id));

      await this.saveSources(sources);
      await this.saveDocuments(documents);
      await NotesStore.removeMany(docIdsToRemove);
      return { kind: "UploadFinished" as const, errors: [] };
    })());
  }

  public listDocuments(token: string): Observable<LoginRequired | DocumentsRetrieved> {
    return from((async () => {
      const documents = await this.getDocuments();
      return { kind: "DocumentsRetrieved" as const, documents: documents };
    })());
  }

  public updateDocument(token: string, update: CreateDocument): Observable<LoginRequired | Ok | DocumentNotFound | InsufficientPermissions> {
    return from((async () => {
      let documents = await this.getDocuments();

      const index = documents.findIndex((d: Document) => d.id === update.document.id);
      if (index !== -1) {
        documents[index] = update.document;
        await this.saveDocuments(documents);
        await NotesStore.set(update.document.id, update.notes);
        return { kind: "Ok" as const };
      }
      return { kind: "DocumentNotFound" as const };
    })());
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
    return from((async () => {
      let documents = await this.getDocuments();
      documents = documents.filter((d: Document) => d.id !== id);
      await this.saveDocuments(documents);
      await NotesStore.remove(id);
      return { kind: "Ok" as const };
    })());
  }

  public createDocument(token: string, creation: CreateDocument): Observable<LoginRequired | DocumentCreated> {
    return from((async () => {
      let documents = await this.getDocuments();

      const newId = uuidv4();
      creation.document.id = newId;
      documents.push(creation.document);
      await this.saveDocuments(documents);
      await NotesStore.set(newId, creation.notes);
      return { kind: "DocumentCreated" as const, id: newId };
    })());
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

  private defaultSettings(): ProjectSettings {
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
      pdfScale: 0.40,
      pdfSyllableSpacing: 10,
      pdfVerticalSpace: 15,
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
      pdfCommentStaffScale: 0.40,
      pdfBracketWidth: 12,
      pdfBracketThickness: 1.2,
      pdfMarginTop: 40,
      pdfMarginBottom: 40,
      pdfMarginRight: 40,
      pdfStaffSpacing: 20,
      pdfBracketGap: 5,
      pdfBracketTick: 4,
      pdfSyllableTextOffset: 10,
      pdfTextBlockGap: 10,
      pdfCommentTreePadding: 4,
      pdfCommentTreeGap: 4,
      pdfHeaderSource: 'textinitium',
      pdfShowPageNumbers: true,
      pdfHeadlineMetadataFields: ['dokumenten_id', 'festtag'],
      pdfHeadlineFontSize: 8,
      pdfPageNumberFontSize: 8,
      pdfParatextFontSize: 10,
      pdfParatextSpacing: 12,
      pdfFontFamily: 'times',
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
  customLists?: { [key: string]: string[] };
  commentTemplates?: SavedCommentTemplate[];
  pdfScale?: number;
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
  pdfFontFamily?: 'times' | 'helvetica';
  meiMappings?: MeiMappingSettings;
  meiProfiles?: MeiMappingProfileV2[];
  activeMeiProfileId?: string;
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

export interface SaveNotes {
  "id": string;
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
    'pdfParatextFontSize',
    'pdfTitleFontSize',
    'pdfTitleVerticalSpace',
    'pdfFontSize',
    'pdfMetadataFontSize',
    'pdfMetadataVerticalSpace',
    'pdfCommentFontSize',
    'pdfCommentTitleFontSize',
    'pdfHeadlineFontSize',
    'pdfPageNumberFontSize'
  ];
  for (const key of numericKeys) {
    if (settings[key] !== undefined && settings[key] !== null) {
      settings[key] = Number(settings[key]);
    }
  }

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

  return settings;
}

