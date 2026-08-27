import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { UserService, User } from '../user.service';
import { APIService, UserInfo, Source, Document } from '../api.service'
import { assertNever } from '../../utils';
import { buildWorkspaceCsv, parseWorkspaceCsv } from '../workspace-csv';
import { BackupReminderService } from '../backup-reminder.service';
import { Subscription, firstValueFrom } from 'rxjs';
import { Header } from '../smart-table/smart-table.component';
import { ToastrService } from 'ngx-toastr';
import { ContextMenuService } from '../context-menu/context-menu.service';
import { ToolsService } from '../tools.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { HttpClient } from '@angular/common/http';
import * as localforage from 'localforage';
import { PageTitleService } from '../page-title.service';
import { NotesStore } from '../notes-store';
import { WORKSPACE_SCHEMA_VERSION } from '../schema';
import { buildWorkspaceExport, parseWorkspaceImport, BackwardsCompatMode } from '../workspace-io';
import { 
  convertToBackwardsCompatibleComment, 
  convertToBackwardsCompatibleConsecutiveLines, 
  convertToBackwardsCompatibleSplitDocuments, 
  RootContainer 
} from '../types/model';
import * as JSZip from 'jszip';
import * as Handlebars from 'handlebars';

export interface SourceColDef {
  key: keyof Source | string;
  label: string;
  visible: boolean;
}

const DEFAULT_SOURCE_COLS: SourceColDef[] = [
  { key: 'quellensigle',         label: 'Source Siglum',       visible: true  },
  { key: 'datierung',            label: 'Dating',              visible: true  },
  { key: 'herkunftsregion',      label: 'Region of Origin',    visible: false },
  { key: 'herkunftsort',         label: 'Place of Origin',     visible: true  },
  { key: 'herkunftsinstitution', label: 'Institution',         visible: true  },
  { key: 'ordenstradition',      label: 'Order Tradition',     visible: false },
  { key: 'quellentyp',           label: 'Source Type',         visible: true  },
  { key: 'bibliotheksort',       label: 'Library Location',    visible: false },
  { key: 'bibliothek',           label: 'Library',             visible: false },
  { key: 'bibliothekssignatur',  label: 'Library Signature',   visible: false },
  { key: 'kommentar',            label: 'Comment',             visible: false },
];

const STORAGE_KEY = 'monodi_source_cols';

@Component({
  selector: 'app-sources-overview',
  templateUrl: './sources-overview.component.html',
  styleUrls: ['./sources-overview.component.css']
})
export class SourcesOverviewComponent implements OnInit, OnDestroy {
  subs: Subscription[] = [];
  sources: Source[] = [];
  user: User | null = null;

  showColPicker = false;
  cols: SourceColDef[] = [];

  showExportDialog = false;
  exportMode: 'zip' | 'html' = 'zip';
  isExporting = false;
  exportStatusMessage = '';
  allDocuments: any[] = [];
  selectedSourcesForExport: Source[] = [];
  selectedDocsForExport: any[] = [];
  renderingDocument: any = null;
  exportBackwardsCompatMode: BackwardsCompatMode = 'none';

  // CSV export options
  showCsvExportDialog = false;
  csvIncludeSourceMeta = true;
  csvIncludeDocumentMeta = true;
  csvIncludeContent = true;

  importProgress: {
    active: boolean;
    phase: 'reading' | 'parsing' | 'sources' | 'documents' | 'saving' | 'done';
    current: number;
    total: number;
    message: string;
    details: string;
    counts: { newSources: number; updatedSources: number; newDocs: number; updatedDocs: number; missingData: number; };
    elapsedMs: number;
    cancelled: boolean;
  } = {
    active: false,
    phase: 'reading',
    current: 0,
    total: 0,
    message: '',
    details: '',
    counts: { newSources: 0, updatedSources: 0, newDocs: 0, updatedDocs: 0, missingData: 0 },
    elapsedMs: 0,
    cancelled: false,
  };

  get isOnline(): boolean {
    return navigator.onLine;
  }

  headers: Header<Source>[] = [];

  updateHeaders() {
    this.headers = this.cols
      .filter(c => c.visible)
      .map(c => ({
        name: c.label,
        makeCell: (x: Source) => ({ kind: 'text' as const, text: (x as any)[c.key] ?? '' })
      }));
  }

  constructor(
    private api: APIService,
    private userService: UserService,
    private toastr: ToastrService,
    private contextMenuService: ContextMenuService,
    private router: Router,
    private pageTitle: PageTitleService,
    private cdRef: ChangeDetectorRef,
    private zone: NgZone,
    private route: ActivatedRoute,
    private backupReminder: BackupReminderService,
  ) {}

  ngOnInit() {
    this.pageTitle.set('Sources');
    this.loadCols();
    this.subs.push(this.userService.user.subscribe(u => {
      this.user = u;
      this.updateList();
    }));
    // Settings → Workspace tab cards land here with a `ws=` query param
    // and we kick off the matching action automatically. Once consumed we
    // strip the param so a back-button trip doesn't re-fire it.
    this.subs.push(this.route.queryParamMap.subscribe(params => {
      const ws = params.get('ws');
      if (!ws) return;
      // Defer so the file inputs / dialog state are mounted and the
      // sources list has had a chance to load.
      setTimeout(() => this.handleWorkspaceAction(ws), 50);
      this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    }));
  }

  /** Triggered by `?ws=<action>` arriving from the Settings → Workspace tab. */
  private handleWorkspaceAction(action: string): void {
    switch (action) {
      case 'import-zip':
        document.getElementById('importOmmrFile')?.click();
        break;
      case 'import-workspace':
        document.getElementById('importFile')?.click();
        break;
      case 'export-workspace':
        this.exportWorkspace();
        break;
      case 'export-zip':
        this.openExportDialog('zip');
        break;
      case 'export-html':
        this.openExportDialog('html');
        break;
      case 'export-csv':
        this.showCsvExportDialog = true;
        break;
      case 'import-csv':
        document.getElementById('importCsvFile')?.click();
        break;
      default:
        console.warn('Unknown workspace action:', action);
    }
  }

  loadCols() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: SourceColDef[] = JSON.parse(saved);
        // Merge saved visibility into defaults (supports new columns added later)
        this.cols = DEFAULT_SOURCE_COLS.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      } else {
        this.cols = DEFAULT_SOURCE_COLS.map(c => ({ ...c }));
      }
    } catch {
      this.cols = DEFAULT_SOURCE_COLS.map(c => ({ ...c }));
    }
    this.updateHeaders();
  }

  saveCols() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cols));
    this.updateHeaders();
  }

  updateList(): void {
    if (this.user) {
      this.api.listSources(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourcesRetrieved': this.sources = res.sources; break;
          default: assertNever(res);
        }
      });
    }
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
  }

  goToSource(s: Source) {
    this.router.navigate(['/source', s.id]);
  }

  delete(s: Source): void {
    if (confirm(`Are you sure you want to permanently delete the source ${s.quellensigle}? \n\nWARNING: This will also delete all documents and annotations belonging to this source!`)) {
      if (this.user && s.id) {
        this.api.deleteSources(this.user.token, JSON.stringify([s.id])).subscribe(res => {
          if (res.kind === 'UploadFinished') {
            this.toastr.success("Source successfully deleted.");
            this.updateList();
          } else {
            this.toastr.error("Error deleting source.");
          }
        });
      }
    }
  }

  async exportWorkspace() {
    try {
      const sources = await localforage.getItem('monodi_sources');
      const documents = await localforage.getItem('monodi_documents');
      // Materialise per-document notes back into a single dict for the
      // export blob — same shape the import path expects.
      const notes = await NotesStore.getAll();
      const settings = await localforage.getItem('monodi_settings');
      
      const data = buildWorkspaceExport(sources, documents, notes, settings, this.exportBackwardsCompatMode);
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace_export_${new Date().toISOString().split('T')[0]}.monodijson`;
      a.click();
      window.URL.revokeObjectURL(url);
      this.backupReminder.markBackup();
      this.toastr.success("Workspace erfolgreich exportiert.");
    } catch (e) {
      this.toastr.error("Fehler beim Exportieren: " + e);
    }
  }



  closeCsvExportDialog() {
    this.showCsvExportDialog = false;
  }

  async confirmCsvExport() {
    this.showCsvExportDialog = false;
    if (!this.csvIncludeSourceMeta && !this.csvIncludeDocumentMeta && !this.csvIncludeContent) {
      this.toastr.error('Bitte mindestens eine Spalten-Gruppe auswählen.');
      return;
    }
    await this.exportCsv();
  }

  async exportCsv() {
    try {
      const sources = (await localforage.getItem<Source[]>('monodi_sources')) || [];
      const documents = (await localforage.getItem<Document[]>('monodi_documents')) || [];
      const notesByDoc = await NotesStore.getAll();

      const csv = buildWorkspaceCsv(sources, documents, notesByDoc as { [id: string]: RootContainer }, {
        includeSourceMeta: this.csvIncludeSourceMeta,
        includeDocumentMeta: this.csvIncludeDocumentMeta,
        includeContent: this.csvIncludeContent,
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      this.toastr.success('CSV erfolgreich exportiert.');
    } catch (e) {
      this.toastr.error('Fehler beim CSV-Export: ' + e);
    }
  }

  triggerCsvImport() {
    document.getElementById('importCsvFile')?.click();
  }

  importCsv(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.zone.run(async () => {
        try {
          const content = e.target?.result as string;
          const parsed = parseWorkspaceCsv(content);

          const existingSources = (await localforage.getItem<Source[]>('monodi_sources')) || [];
          const existingDocs = (await localforage.getItem<Document[]>('monodi_documents')) || [];
          const srcById = new Map(existingSources.filter((s) => s.id).map((s): [string, Source] => [s.id!, s]));
          const docById = new Map(existingDocs.filter((d) => d.id).map((d): [string, Document] => [d.id, d]));

          let createdSources = 0;
          let updatedSources = 0;
          for (const s of parsed.sources) {
            const existing = s.id ? srcById.get(s.id) : undefined;
            if (existing) {
              // Update scalar metadata; keep existing notation-independent data
              // (equivalents, annotations) and merge custom fields.
              const mergedCustom = { ...(existing.custom || {}), ...(s.custom || {}) };
              Object.assign(existing, s);
              existing.custom = mergedCustom;
              updatedSources++;
            } else {
              existingSources.push(s);
              if (s.id) srcById.set(s.id, s);
              createdSources++;
            }
          }

          let createdDocs = 0;
          let updatedDocs = 0;
          for (const d of parsed.documents) {
            const existing = d.id ? docById.get(d.id) : undefined;
            if (existing) {
              // Update metadata only; the existing (richer) notation is preserved.
              const mergedCustom = { ...(existing.custom || {}), ...(d.custom || {}) };
              Object.assign(existing, d);
              existing.custom = mergedCustom;
              updatedDocs++;
            } else {
              existingDocs.push(d);
              docById.set(d.id, d);
              await NotesStore.set(d.id, parsed.notesByDoc[d.id]);
              createdDocs++;
            }
          }

          await localforage.setItem('monodi_sources', existingSources);
          await localforage.setItem('monodi_documents', existingDocs);

          this.api.invalidateCache();
          this.updateList();

          this.toastr.success(
            `CSV importiert: ${createdSources} neue / ${updatedSources} aktualisierte Quellen, ` +
              `${createdDocs} neue / ${updatedDocs} aktualisierte Dokumente.`
          );
          if (parsed.warnings.length > 0) {
            this.toastr.warning(parsed.warnings.slice(0, 5).join('; '), 'CSV-Import mit Hinweisen');
          }
        } catch (err) {
          this.toastr.error('Fehler beim CSV-Import: ' + err);
        }

        event.target.value = '';
      });
    };
    reader.readAsText(file);
  }

  triggerImport() {
    document.getElementById('importFile')?.click();
  }

  importWorkspace(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.zone.run(async () => {
        try {
          const content = e.target?.result as string;
          const json = JSON.parse(content);
          const data = parseWorkspaceImport(json);
          
          if (data.schemaVersion > WORKSPACE_SCHEMA_VERSION) {
            this.toastr.error("Fehler beim Importieren: Die Schemaversion der Importdatei (" + data.schemaVersion + ") ist neuer als die vom Programm unterstützte Version (" + WORKSPACE_SCHEMA_VERSION + ").");
            event.target.value = '';
            return;
          }
          
          if (data.sources) await localforage.setItem('monodi_sources', data.sources);
          if (data.documents) await localforage.setItem('monodi_documents', data.documents);
          // Per-document writes so we don't hit IndexedDB's structured-clone
          // limit when the user re-imports a very large workspace.
          if (data.notesDict) await NotesStore.replaceAll(data.notesDict);
          if (data.settings) await localforage.setItem('monodi_settings', data.settings);
          
          this.api.invalidateCache();
          this.toastr.success("Workspace erfolgreich importiert.");
          this.updateList();
        } catch (err) {
          this.toastr.error("Fehler beim Importieren: " + err);
        }
        
        event.target.value = '';
      });
    };
    reader.readAsText(file);
  }

  triggerOmmrImport() {
    document.getElementById('importOmmrFile')?.click();
  }

  onOmmrContextMenu(me: MouseEvent) {
    this.onGeneralContextMenu(me, 'Import ZIP (OMMR/monodi)', () => this.triggerOmmrImport(), 'metadata', 'exporting-data');
  }

  onGeneralContextMenu(me: MouseEvent, label: string, action: () => void, helpTopic: string, helpHash: string) {
    me.preventDefault();
    me.stopPropagation();
    
    const items = [
      {
        label: label,
        action: action
      }
    ];

    this.contextMenuService.open(me, items, helpTopic, helpHash);
  }

  /**
   * Imports a ZIP archive that follows either of two folder layouts:
   *
   *   1. **monodi export** (`IO/export_monodi/…`):
   *      ```
   *      <root>/<source-sigil>/meta.json          ← source metadata
   *      <root>/<source-sigil>/<doc-uuid>/meta.json
   *      <root>/<source-sigil>/<doc-uuid>/data.json
   *      ```
   *   2. **OMMR4all-style export** (legacy): same shape, but document
   *      metadata uses English-ish keys (`genre`, `festum`, `dies`,
   *      `rowstart`) instead of the German ones.
   *
   * Detection is by structure, not by file name: a `meta.json` is treated as a
   * *document* iff its directory also contains a `data.json` sibling;
   * otherwise it is treated as a *source*. This way an arbitrary number of
   * leading wrapper folders is tolerated — users may zip the whole
   * `export_monodi` directory, a single source, or one document.
   *
   * For each *source* every unknown field is preserved verbatim in
   * `source.custom` so nothing is silently dropped (the long `beschreibung`
   * markdown lives there, for example). The `manifest` field, if any, is
   * mapped to `iiifManifestUrl`. Likewise document `additionalData` becomes
   * `document.custom`, with any unrecognized top-level keys merged in.
   */
  /**
   * Imports a ZIP archive that follows either the `IO/export_monodi` layout
   * (German keys: `gattung1`, `festtag`, …) or the legacy OMMR4all layout
   * (English-ish keys: `genre`, `festum`, …). Detection is structural — a
   * `meta.json` whose folder also contains a `data.json` is a document;
   * anything else is a source — so the importer doesn't care whether the
   * user zipped the whole `export_monodi` directory, a single source, or one
   * document.
   *
   * Designed to chew through hundreds of sources / thousands of documents
   * without freezing the UI:
   *
   *   • A modal overlay shows file size, current phase, a progress bar, the
   *     running counts, and a Cancel button.
   *   • Heavy loops are chunked into batches of {@link IMPORT_BATCH_SIZE}.
   *     Between batches we `await yieldToUI()` which yields back to the
   *     browser event loop so it can paint and process clicks (cancel,
   *     scrolling, etc.).
   *   • All progress fields go through `updateProgress()` which calls
   *     `markForCheck` — the rest of the component can therefore stay on
   *     default CD without flooding the UI with change-detection runs.
   *
   * Unknown top-level keys are preserved verbatim in `source.custom` /
   * `document.custom` so nothing in the meta.json is silently dropped (the
   * long `beschreibung` markdown lives there, for example). `manifest` maps
   * to `Source.iiifManifestUrl`; `additionalData` maps to `Document.custom`.
   */
  async importZip(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const tStart = performance.now();
    this.beginImport(file.size);

    try {
      // -----------------------------------------------------------------
      // 1. Read the file into memory + open with JSZip.
      // -----------------------------------------------------------------
      this.updateProgress({ phase: 'reading', message: `Reading ${this.formatFileSize(file.size)}…`, current: 0, total: 0 });
      const arrayBuffer = await file.arrayBuffer();
      if (this.importProgress.cancelled) return;

      this.updateProgress({ message: 'Opening ZIP archive…' });
      const zip = await JSZip.loadAsync(arrayBuffer);
      if (this.importProgress.cancelled) return;

      // -----------------------------------------------------------------
      // 2. Collect every meta.json in the archive (ignoring macOS noise).
      // -----------------------------------------------------------------
      const metaFiles: JSZip.JSZipObject[] = [];
      zip.forEach((relativePath, zipEntry) => {
        if (zipEntry.dir) return;
        if (relativePath.includes('__MACOSX')) return;
        if (relativePath.endsWith('/meta.json') || relativePath === 'meta.json') {
          metaFiles.push(zipEntry);
        }
      });
      if (metaFiles.length === 0) {
        this.finishImport(false);
        this.toastr.error('No meta.json files found inside this ZIP — is it a valid monodi/OMMR export?');
        event.target.value = '';
        return;
      }

      // -----------------------------------------------------------------
      // 3. Classify each meta.json as Source or Document.
      // -----------------------------------------------------------------
      const sourceMetas: { meta: any; sourceId: string }[] = [];
      const docMetas:    { meta: any; sourceId: string; docId: string; dataPath: string }[] = [];

      this.updateProgress({
        phase: 'parsing',
        message: `Parsing ${metaFiles.length} metadata files…`,
        details: '',
        current: 0,
        total: metaFiles.length,
      });

      for (let i = 0; i < metaFiles.length; i++) {
        if (this.importProgress.cancelled) return;
        const metaFile = metaFiles[i];
        const path = metaFile.name;
        const folder = path.substring(0, path.lastIndexOf('/') + 1);

        let meta: any;
        try {
          meta = JSON.parse(await metaFile.async('string'));
        } catch (e) {
          console.warn(`Skipping unreadable ${path}:`, e);
          continue;
        }

        const dataPath = folder + 'data.json';
        const hasDataJson = zip.file(dataPath) !== null;
        const dirSegs = folder.replace(/\/$/, '').split('/').filter(Boolean);
        const fallbackDocId    = dirSegs.length >= 1 ? dirSegs[dirSegs.length - 1] : '';
        const fallbackSourceId = dirSegs.length >= 2 ? dirSegs[dirSegs.length - 2] : fallbackDocId;

        if (!hasDataJson) {
          const sourceId = meta.id || meta.quellensigle || fallbackSourceId || `source_${dirSegs.length}`;
          sourceMetas.push({ meta, sourceId });
        } else {
          const docId    = meta.id || meta.dokumenten_id || fallbackDocId    || 'imported_doc';
          const sourceId = meta.quelle_id || meta.source_id || fallbackSourceId || 'imported_source';
          docMetas.push({ meta, sourceId, docId, dataPath });
        }

        // Yield to UI roughly every BATCH metafiles so the modal can update
        // and the browser can paint / accept Cancel clicks.
        if ((i + 1) % SourcesOverviewComponent.IMPORT_BATCH_SIZE === 0 || i === metaFiles.length - 1) {
          this.updateProgress({
            current: i + 1,
            details: `${sourceMetas.length} source${sourceMetas.length === 1 ? '' : 's'}, ${docMetas.length} document${docMetas.length === 1 ? '' : 's'} found`,
          });
          await this.yieldToUI();
        }
      }

      // -----------------------------------------------------------------
      // 4. Load existing stores. Build O(1) lookup maps.
      // We deliberately do NOT load all the notes into memory — they're
      // written per-document via NotesStore.set() further down. That's the
      // whole point of the storage refactor: no single localforage.setItem
      // call ever sees the union of every chant's notes.
      // -----------------------------------------------------------------
      this.updateProgress({ phase: 'sources', message: 'Loading existing workspace…', current: 0, total: 1, details: '' });
      await NotesStore.ensureMigrated();
      const sources   = (await localforage.getItem<Source[]>('monodi_sources'))   || [];
      const documents = (await localforage.getItem<any[]>('monodi_documents'))    || [];
      const sourceIndex = new Map<string, Source>(sources.map(s => [s.id ?? '', s]));
      const docIndex    = new Map<string, number>(documents.map((d, i) => [d.id, i]));

      // -----------------------------------------------------------------
      // 5. Sources.
      // -----------------------------------------------------------------
      const knownSourceKeys: ReadonlySet<string> = new Set<string>([
        'id', 'quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution',
        'ordenstradition', 'quellentyp', 'bibliotheksort', 'bibliothek',
        'bibliothekssignatur', 'kommentar', 'datierung', 'iiifManifestUrl',
        'equivalents', 'annotationRegions', 'annotationItems',
        'transcriptionAnnotations', 'custom',
      ]);

      this.updateProgress({
        phase: 'sources',
        message: `Importing sources…`,
        current: 0,
        total: sourceMetas.length,
        details: '',
      });

      for (let i = 0; i < sourceMetas.length; i++) {
        if (this.importProgress.cancelled) return;
        const { meta, sourceId } = sourceMetas[i];

        const custom: { [k: string]: string } = { ...(meta.custom ?? {}) };
        for (const [k, v] of Object.entries(meta)) {
          if (k === 'manifest') continue;
          if (knownSourceKeys.has(k)) continue;
          if (v === null || v === undefined) continue;
          custom[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }

        const next: Source = {
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

        const existing = sourceIndex.get(sourceId);
        if (existing) {
          Object.assign(existing, next);
          this.importProgress.counts.updatedSources++;
        } else {
          sources.push(next);
          sourceIndex.set(sourceId, next);
          this.importProgress.counts.newSources++;
        }

        if ((i + 1) % SourcesOverviewComponent.IMPORT_BATCH_SIZE === 0 || i === sourceMetas.length - 1) {
          this.updateProgress({
            current: i + 1,
            details: `${this.importProgress.counts.newSources} added, ${this.importProgress.counts.updatedSources} updated`,
          });
          await this.yieldToUI();
        }
      }

      // -----------------------------------------------------------------
      // 6. Documents (and their data.json bodies → notes).
      // -----------------------------------------------------------------
      const knownDocKeys = new Set([
        'id', 'quelle_id', 'dokumenten_id', 'gattung1', 'gattung2', 'festtag',
        'feier', 'textinitium', 'bibliographischerverweis', 'druckausgabe',
        'zeilenstart', 'foliostart', 'kommentar', 'editionsstatus', 'custom',
        'genre', 'festum', 'dies', 'rowstart', 'source_id', 'additionalData',
      ]);

      this.updateProgress({
        phase: 'documents',
        message: `Importing documents…`,
        current: 0,
        total: docMetas.length,
        details: '',
      });

      for (let i = 0; i < docMetas.length; i++) {
        if (this.importProgress.cancelled) return;
        const { meta, sourceId, docId, dataPath } = docMetas[i];

        const dataFile = zip.file(dataPath);
        if (!dataFile) { this.importProgress.counts.missingData++; }
        else {
          let docData: any;
          try {
            docData = JSON.parse(await dataFile.async('string'));
          } catch (e) {
            console.warn(`Skipping ${dataPath} (invalid JSON):`, e);
            this.importProgress.counts.missingData++;
            continue;
          }

          const custom: { [k: string]: string } = { ...(meta.additionalData ?? meta.custom ?? {}) };
          for (const [k, v] of Object.entries(meta)) {
            if (knownDocKeys.has(k)) continue;
            if (v === null || v === undefined) continue;
            custom[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }

          const next = {
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

          // Persist this document's notes BEFORE registering the document
          // itself. If the notes write fails for any reason (storage full,
          // single-row size limit, …) we want the document to NOT appear in
          // the listing, otherwise the user would later click it and get
          // "loading…" forever because the notes row is missing. Order:
          //   1. NotesStore.set(...)
          //   2. documents.push(...) / documents[idx] = ...
          let notesPersisted = false;
          try {
            await NotesStore.set(docId, docData);
            notesPersisted = true;
          } catch (e) {
            console.warn(`Failed to persist notes for ${docId} — skipping document`, e);
            this.importProgress.counts.missingData++;
          }

          if (notesPersisted) {
            const idx = docIndex.get(docId);
            if (idx !== undefined) {
              documents[idx] = next;
              this.importProgress.counts.updatedDocs++;
            } else {
              documents.push(next);
              docIndex.set(docId, documents.length - 1);
              this.importProgress.counts.newDocs++;
            }
          }
          // Hint the GC that we no longer need this potentially-huge object
          // — important because we're processing thousands of these inside
          // the same async function and JS won't free `docData` until the
          // function frame is unwound otherwise.
          docData = undefined;
        }

        if ((i + 1) % SourcesOverviewComponent.IMPORT_BATCH_SIZE === 0 || i === docMetas.length - 1) {
          const c = this.importProgress.counts;
          this.updateProgress({
            current: i + 1,
            details: `${c.newDocs} added, ${c.updatedDocs} updated${c.missingData ? `, ${c.missingData} skipped` : ''}`,
          });
          await this.yieldToUI();
        }
      }

      if (this.importProgress.cancelled) return;

      // -----------------------------------------------------------------
      // 7. Persist source + document indexes. Notes were already written
      //    per-document above, so there is no giant final write left.
      // -----------------------------------------------------------------
      this.updateProgress({ phase: 'saving', message: 'Saving source index…',   current: 0, total: 2, details: '' });
      await localforage.setItem('monodi_sources', sources);
      this.updateProgress({ message: 'Saving document index…', current: 1 });
      await localforage.setItem('monodi_documents', documents);
      this.api.invalidateCache();
      this.updateProgress({ current: 2 });

      // -----------------------------------------------------------------
      // 8. Final state — keep the modal up so the user can read the
      //    summary, then they dismiss it manually.
      // -----------------------------------------------------------------
      const elapsed = performance.now() - tStart;
      this.updateProgress({
        phase: 'done',
        message: 'Import complete',
        elapsedMs: elapsed,
        details: '',
      });
      this.updateList();
    } catch (err) {
      console.error('ZIP import failed:', err);
      this.toastr.error(`Error reading ZIP: ${(err as Error)?.message ?? err}`);
      this.finishImport(false);
    } finally {
      event.target.value = '';
    }
  }

  /** Batch size for the chunked loops. ~25 keeps the modal smooth on a low-
   *  end laptop while still amortising the yield cost. */
  private static readonly IMPORT_BATCH_SIZE = 25;

  /** Switch the modal on and reset counters. */
  private beginImport(fileSize: number): void {
    this.importProgress = {
      active: true,
      phase: 'reading',
      current: 0,
      total: 0,
      message: `Reading ${this.formatFileSize(fileSize)}…`,
      details: '',
      counts: { newSources: 0, updatedSources: 0, newDocs: 0, updatedDocs: 0, missingData: 0 },
      elapsedMs: 0,
      cancelled: false,
    };
    this.cdRef.markForCheck();
  }

  /** Patch some fields of the progress state and request a re-render. */
  private updateProgress(patch: Partial<typeof this.importProgress>): void {
    Object.assign(this.importProgress, patch);
    this.cdRef.markForCheck();
  }

  /** Hide the modal (called from the template Close button and from the
   *  error path). `success` is unused right now but lets us style the modal
   *  differently in future if we want. */
  finishImport(_success: boolean): void {
    this.importProgress.active = false;
    this.cdRef.markForCheck();
  }

  /** Triggered by the Cancel button in the modal. We just set a flag —
   *  every batch boundary in the import loop checks it and bails out
   *  cleanly. Any work already persisted to localforage is kept (we don't
   *  attempt to roll back), so a re-import will skip already-imported
   *  documents and only redo the rest. */
  cancelImport(): void {
    this.importProgress.cancelled = true;
    this.toastr.info('Import cancelled — partial progress kept.', 'Cancelled');
    this.finishImport(false);
  }

  /** Yield to the browser so it can paint the updated progress bar and
   *  process pending input events. Uses `setTimeout(..., 0)` instead of
   *  `queueMicrotask` because microtasks would still block painting. */
  private yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /** Percentage 0–100 used by the template's progress bar width. */
  get importProgressPct(): number {
    const { current, total } = this.importProgress;
    if (total <= 0) return this.importProgress.phase === 'done' ? 100 : 0;
    return Math.min(100, Math.round((current / total) * 100));
  }

  /** Human-readable label for the current phase shown in the modal title. */
  get importPhaseLabel(): string {
    switch (this.importProgress.phase) {
      case 'reading':   return 'Reading file';
      case 'parsing':   return 'Parsing metadata';
      case 'sources':   return 'Importing sources';
      case 'documents': return 'Importing documents';
      case 'saving':    return 'Saving workspace';
      case 'done':      return 'Done';
    }
  }

  /** Human-readable file size for the import progress toast. */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  async openExportDialog(mode: 'zip' | 'html') {
    this.exportMode = mode;
    this.selectedSourcesForExport = [];
    this.selectedDocsForExport = [];
    this.isExporting = false;
    this.exportStatusMessage = '';
    
    const toastRef = this.toastr.info("Loading workspace documents...", "Export", { disableTimeOut: true });
    try {
      await this.loadAllDocuments();
      this.toastr.remove(toastRef.toastId);
      this.showExportDialog = true;
    } catch(e) {
      this.toastr.remove(toastRef.toastId);
      this.toastr.error("Failed to load documents: " + e);
    }
  }

  closeExportDialog() {
    this.showExportDialog = false;
  }

  async loadAllDocuments(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.user) { resolve(); return; }
      this.api.listDocuments(this.user.token).subscribe(res => {
        if (res.kind === 'DocumentsRetrieved') {
          this.allDocuments = res.documents;
        }
        resolve();
      }, err => resolve());
    });
  }

  onExportSelectionChange(selection: { selectedSources: Source[], selectedDocs: any[] }) {
    this.selectedSourcesForExport = selection.selectedSources;
    this.selectedDocsForExport = selection.selectedDocs;
  }

  get hasSelectedItems(): boolean {
    return this.selectedDocsForExport.length > 0;
  }

  async runExport() {
    this.isExporting = true;
    try {
      if (this.exportMode === 'zip') {
        await this.generateZipWorkspace();
      } else {
        await this.generateHtmlEdition();
      }
    } finally {
      this.isExporting = false;
    }
  }

  async generateZipWorkspace() {
    this.exportStatusMessage = "Preparing ZIP archive...";
    try {
      const zip = new JSZip();
      const totalSources = this.selectedSourcesForExport.length;
      let i = 0;
      
      for (const s of this.selectedSourcesForExport) {
        if (!s.id) continue;
        i++;
        this.exportStatusMessage = `Adding source ${i} of ${totalSources} (${s.quellensigle || s.id})...`;
        
        const mappedSource = {
          id: s.id,
          quellensigle: s.quellensigle || '',
          herkunftsregion: s.herkunftsregion || '',
          herkunftsort: s.herkunftsort || '',
          herkunftsinstitution: s.herkunftsinstitution || '',
          ordenstradition: s.ordenstradition || '',
          quellentyp: s.quellentyp || '',
          bibliotheksort: s.bibliotheksort || '',
          bibliothek: s.bibliothek || '',
          bibliothekssignatur: s.bibliothekssignatur || '',
          kommentar: s.kommentar || '',
          datierung: s.datierung || '',
          status: s.custom?.status || '',
          jahrhundert: s.custom?.jahrhundert || '',
          manifest: s.iiifManifestUrl || s.custom?.manifest || '',
          foliooffset: s.custom?.foliooffset || '',
          publish: s.custom?.publish || 'all',
          beschreibung: s.custom?.beschreibung || ''
        };
        
        zip.file(`${s.id}/meta.json`, JSON.stringify(mappedSource, null, 2));
        
        const sourceDocs = this.selectedDocsForExport.filter(d => d.quelle_id === s.id);
        
        for (const d of sourceDocs) {
          if (!d.id) continue;
          
          const additionalData: { [key: string]: string } = {};
          if (d.custom) {
            for (const [k, v] of Object.entries(d.custom)) {
              if (k !== 'publish') {
                additionalData[k] = v === null || v === undefined ? '' : String(v);
              }
            }
          }
          
          const mappedDoc = {
            id: d.id,
            quelle_id: d.quelle_id,
            dokumenten_id: d.dokumenten_id || '',
            gattung1: d.gattung1 || '',
            gattung2: d.gattung2 || '',
            festtag: d.festtag || '',
            feier: d.feier || '',
            textinitium: d.textinitium || '',
            bibliographischerverweis: d.bibliographischerverweis || '',
            druckausgabe: d.druckausgabe || '',
            zeilenstart: d.zeilenstart || '',
            foliostart: d.foliostart || '',
            kommentar: d.kommentar || '',
            editionsstatus: d.editionsstatus || '',
            additionalData,
            publish: d.custom?.publish || 'all'
          };
          
          let notes = await NotesStore.get(d.id);
          if (notes && (notes as any).kind === 'RootContainer') {
            if (this.exportBackwardsCompatMode === 'split_documents') {
              const split = convertToBackwardsCompatibleSplitDocuments(notes as RootContainer, d.id);
              const doc1 = JSON.parse(JSON.stringify(mappedDoc));
              const doc2 = JSON.parse(JSON.stringify(mappedDoc));
              doc1.textinitium = (mappedDoc.textinitium || d.id) + ' (Voice 1)';
              doc2.textinitium = (mappedDoc.textinitium || d.id) + ' (Voice 2)';
              zip.file(`${s.id}/${d.id}-v1/meta.json`, JSON.stringify(doc1, null, 2));
              zip.file(`${s.id}/${d.id}-v1/data.json`, JSON.stringify(split.v1, null, 2));
              zip.file(`${s.id}/${d.id}-v2/meta.json`, JSON.stringify(doc2, null, 2));
              zip.file(`${s.id}/${d.id}-v2/data.json`, JSON.stringify(split.v2, null, 2));
            } else {
              if (this.exportBackwardsCompatMode === 'consecutive_lines') {
                notes = convertToBackwardsCompatibleConsecutiveLines(notes as RootContainer);
              } else if (this.exportBackwardsCompatMode === 'comment') {
                notes = convertToBackwardsCompatibleComment(notes as RootContainer);
              }
              zip.file(`${s.id}/${d.id}/meta.json`, JSON.stringify(mappedDoc, null, 2));
              zip.file(`${s.id}/${d.id}/data.json`, JSON.stringify(notes, null, 2));
            }
          } else {
            zip.file(`${s.id}/${d.id}/meta.json`, JSON.stringify(mappedDoc, null, 2));
            if (notes) {
              zip.file(`${s.id}/${d.id}/data.json`, JSON.stringify(notes, null, 2));
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      this.exportStatusMessage = "Creating ZIP package...";
      const blob = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monodi_workspace_export_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      this.backupReminder.markBackup();
      this.toastr.success("Workspace successfully exported as ZIP.");
      this.closeExportDialog();
    } catch (e) {
      this.toastr.error("Error exporting workspace ZIP: " + e);
      console.error(e);
    }
  }

  getMetadataLabel(key: string): string {
    if (key === 'quellensigle') return 'Source Siglum';
    if (key === 'herkunftsort') return 'Place of Origin';
    if (key === 'herkunftsregion') return 'Region of Origin';
    if (key === 'herkunftsinstitution') return 'Institution';
    if (key === 'ordenstradition') return 'Order Tradition';
    if (key === 'quellentyp') return 'Source Type';
    if (key === 'bibliotheksort') return 'Library Location';
    if (key === 'bibliothek') return 'Library';
    if (key === 'bibliothekssignatur') return 'Library Signature';
    if (key === 'datierung') return 'Dating';
    if (key === 'kommentar') return 'Comment';
    if (key === 'dokumenten_id') return 'ID';
    if (key === 'textinitium') return 'Initium';
    if (key === 'gattung1') return 'Genre 1';
    if (key === 'gattung2') return 'Genre 2';
    if (key === 'festtag') return 'Feast Day';
    if (key === 'feier') return 'Feast';
    return key;
  }

  async fetchTemplate(name: string): Promise<string> {
    try {
      const res = await fetch(`assets/export-templates/${name}.hbs`);
      return await res.text();
    } catch (e) {
      console.error(`Failed to fetch template ${name}`, e);
      return '';
    }
  }

  getGlobalCss(): string {
    let cssText = '';
    for (let i = 0; i < document.styleSheets.length; i++) {
      try {
        const sheet = document.styleSheets[i];
        if (sheet.href && sheet.href.includes('fonts.googleapis.com')) continue;
        const rules = sheet.cssRules || sheet.rules;
        for (let j = 0; j < rules.length; j++) {
          cssText += rules[j].cssText + '\n';
        }
      } catch (e) {
        // Ignore CORS errors from external stylesheets
      }
    }
    return cssText;
  }

  async generateHtmlEdition() {
    try {
      this.exportStatusMessage = "Loading templates and data...";
      const zip = new JSZip();
      const notes = await NotesStore.getAll();
      
      const indexTpl = Handlebars.compile(await this.fetchTemplate('index'));
      const sourceTpl = Handlebars.compile(await this.fetchTemplate('source'));
      const docTpl = Handlebars.compile(await this.fetchTemplate('document'));
      const globalCss = this.getGlobalCss();
      
      let settings: any = {};
      try {
        if (this.user) {
          const settingsRes = await firstValueFrom(this.api.getSettings(this.user.token));
          if (settingsRes.kind === 'SettingsRetrieved') settings = settingsRes.settings;
        }
      } catch (e) {
        console.warn("Could not fetch settings for HTML export", e);
      }
      const customCss = settings.htmlExportCustomCss || '';
      const frontpageHtml = settings.htmlExportFrontpageHtml || '';
      const headerHtml = settings.htmlExportHeaderHtml || '';
      const footerHtml = settings.htmlExportFooterHtml || '';
      
      this.exportStatusMessage = "Bundling SVG Assets...";
      const GLYPHS = [
        'flat.svg', 'flat-focused.svg', 'natural.svg', 'natural-focused.svg', 'sharp.svg', 'sharp-focused.svg', 
        'note.svg', 'note-focused.svg', 'ascending.svg', 'ascending-focused.svg', 'descending.svg', 'descending-focused.svg', 
        'oriscus.svg', 'oriscus-focused.svg', 'strophicus.svg', 'strophicus-focused.svg', 'quilisma.svg', 'quilisma-focused.svg'
      ];
      for (const glyph of GLYPHS) {
        try {
          const res = await fetch(`assets/glyphs/${glyph}`);
          if (res.ok) {
            zip.file(`assets/glyphs/${glyph}`, await res.blob());
          }
        } catch(e) { console.warn('Could not fetch glyph', glyph); }
      }
      
      let allExportedDocs: any[] = [];
      let docsToProcess: {source: any, doc: any}[] = [];
      
      for (const src of this.selectedSourcesForExport) {
        const selectedDocs = this.selectedDocsForExport.filter(d => d.quelle_id === src.id);
        for (const doc of selectedDocs) {
          docsToProcess.push({ source: src, doc: doc });
        }
      }

      // Step 1: Headless Render loop
      const renderedHtmlMap = new Map<string, string>();
      let idx = 0;
      for (const item of docsToProcess) {
        idx++;
        this.exportStatusMessage = `Rendering SVGs for document ${idx} of ${docsToProcess.length} (${item.doc.textinitium || item.doc.id})...`;
        const docData = notes[item.doc.id];
        if (!docData) continue;
        
        this.renderingDocument = docData;
        this.cdRef.detectChanges();
        await new Promise(r => setTimeout(r, 100));
        
        const container = document.getElementById('export-render-container');
        if (container) {
          renderedHtmlMap.set(item.doc.id, container.innerHTML);
        }
      }
      
      this.renderingDocument = null;
      
      this.exportStatusMessage = "Generating HTML pages...";
      // Step 2: Generate Source and Document files
      for (const s of this.selectedSourcesForExport) {
        const selectedDocs = this.selectedDocsForExport.filter(d => d.quelle_id === s.id);
        if (selectedDocs.length > 0) {
          
          for (const doc of selectedDocs) {
            allExportedDocs.push({
              id: doc.id,
              quelle_id: doc.quelle_id,
              title: doc.textinitium || doc.dokumenten_id || 'Untitled',
              genre: doc.gattung1 || '',
              date: doc.festtag || '',
              sourceName: s.quellensigle || s.id
            });
            
            let docMetadata = Object.entries(doc)
              .filter(([k, v]) => v && k !== 'custom' && typeof v !== 'object')
              .filter(([k, _]) => !settings.htmlExportDocumentMetadata || settings.htmlExportDocumentMetadata.includes(k))
              .map(([k, v]) => ({ label: this.getMetadataLabel(k), value: v }));
              
            if (doc.custom && typeof doc.custom === 'object') {
              for (const [k, v] of Object.entries(doc.custom)) {
                if (v && typeof v !== 'object') {
                  docMetadata.push({ label: k, value: v });
                }
              }
            }
              
            let renderedHtml = renderedHtmlMap.get(doc.id) || '<div class="alert alert-warning">No visual data rendered.</div>';
            renderedHtml = renderedHtml.replace(/assets\/glyphs\//g, '../assets/glyphs/');
            
            const docHtml = docTpl({
              document: { id: doc.id, title: doc.textinitium || doc.dokumenten_id || 'Untitled Document' },
              metadata: docMetadata,
              renderedHtml: renderedHtml,
              sourceId: s.id,
              rawJsonData: JSON.stringify(notes[doc.id] || {}),
              globalCss,
              customCss,
              headerHtml,
              footerHtml
            });
            
            zip.file(`${s.id}/${doc.id}.html`, docHtml);
          }
          
          let sourceMetadata = Object.entries(s)
            .filter(([k, v]) => v && k !== 'id' && typeof v !== 'object')
            .filter(([k, _]) => !settings.htmlExportSourceMetadata || settings.htmlExportSourceMetadata.includes(k))
            .map(([k, v]) => ({ label: this.getMetadataLabel(k), value: v }));
            
          const sourceHtml = sourceTpl({
            source: s,
            metadata: sourceMetadata,
            documents: selectedDocs.map((d: any) => ({
              id: d.id,
              title: d.textinitium || d.dokumenten_id || 'Untitled',
              genre: d.gattung1 || '',
              date: d.festtag || ''
            })),
            globalCss,
            customCss,
            headerHtml,
            footerHtml
          });
          
          zip.file(`source_${s.id}.html`, sourceHtml);
        }
      }
      
      // Step 3: Generate Index
      this.exportStatusMessage = "Finalizing ZIP file...";
      
      const sourceList = this.selectedSourcesForExport
        .filter(s => this.selectedDocsForExport.some(d => d.quelle_id === s.id))
        .map(s => {
          const metadata = Object.entries(s)
            .filter(([k, v]) => v && k !== 'id')
            .filter(([k, _]) => !settings.htmlExportSourceMetadata || settings.htmlExportSourceMetadata.includes(k))
            .map(([k, v]) => ({ label: this.getMetadataLabel(k), value: v }));
          
          return {
            id: s.id,
            title: s.quellensigle || s.id,
            metadata: metadata,
            documents: this.selectedDocsForExport
              .filter(d => d.quelle_id === s.id)
              .map(d => ({
                id: d.id,
                title: d.textinitium || d.dokumenten_id || 'Untitled Document'
              }))
          };
      });

      const idxHtml = indexTpl({
        generationDate: new Date().toLocaleDateString(),
        totalDocuments: allExportedDocs.length,
        sources: sourceList,
        globalCss,
        customCss,
        frontpageHtml,
        footerHtml
      });
      zip.file(`index.html`, idxHtml);
      
      const blob = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monodi_static_edition_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      this.toastr.success("HTML Edition exported successfully!");
      this.closeExportDialog();
    } catch (e) {
      this.toastr.error("Error generating HTML export: " + e);
      console.error(e);
    } finally {
      this.renderingDocument = null;
    }
  }

}
