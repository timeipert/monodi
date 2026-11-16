import { importFormatOptions, importMei, importRequestOf } from '../mei/mei-import';
import type { MeiImportResult } from '../mei/mei-import';
import type { MeiMappingProfileV2 } from '@monodi/core/mei';
import { documentIdFromFileName, newImportedDocument, newImportedSource } from '../mei/mei-import-document';
import { FocusService } from '../focus.service';
import { PdfDialogLauncher } from '../pdf-export-dialog.component';
import { sanitizeNotationColor } from '../notation-color';
import { sanitizeClefDisplayMode } from '../clef-policy';
import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ViewChild, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { UserService, User } from '../user.service';
import { APIService, Source, Document } from '../api.service'
import { assertNever, compareNatural } from '../../utils';
import { buildWorkspaceCsv, parseWorkspaceCsv } from '../workspace-csv';
import { BackupReminderService } from '../backup-reminder.service';
import { Subscription, firstValueFrom } from 'rxjs';
import { StatusLineService } from '../status-line.service';
import * as localforage from 'localforage';
import { PageTitleService } from '../page-title.service';
import { NotesStore } from '../notes-store';
import { PushCache } from '../push-cache';
import { WORKSPACE_SCHEMA_VERSION } from '../schema';
import { buildWorkspaceExport, parseWorkspaceImport, BackwardsCompatMode } from '../workspace-io';
import { AnalysisStore } from '../analysis/analysis-store';
import { applyPlaceholderImport, placeholderConfigFromSettings, placeholderImportEnabled, syllableCommentsToPlaceholders } from '../placeholder-comments';
import { 
  convertToBackwardsCompatibleComment, 
  convertToBackwardsCompatibleConsecutiveLines, 
  convertToBackwardsCompatibleSplitDocuments, 
  normalizeDocumentComments,
  RootContainer 
} from '../types/model';
import * as JSZip from 'jszip';
import * as Handlebars from 'handlebars';
import { FileSystemService } from '../file-system.service';
import { nestedZipPath } from './nested-zip';
import { SOURCE_DESCRIPTION_KEY, sourceDescription } from '../source-description';
import { applyPlan, describePlan, ImportPreview, planChangesAnything, planImport } from '../annotation-exchange';
import { parseAnnotationFile } from '../cm-transkriptionseq-import';
import { readAnnotationFiles } from '../neume-docs-import';
import { saveStripImages } from '../notation-strip-images';
import { mergeMetaAnnotations } from '../zip-source-annotations';
import { documentFromMeta, sourceFromMeta } from '../workspace-import';
import { downloadBlob } from '../download';
import { jsonForScript } from '../html-escape';
import { GuidoImportResult, parseGuidoDocx } from '../guido/guido-import';
import { BUILTIN_TEMPLATE_ID, GuidoTemplate, allGuidoTemplates, parseGuidoTemplate } from '../guido/guido-template';
import { GuidoConflictMode, GuidoPlan, applyGuidoImport, mergeNoteFlags, planGuidoImport } from '../guido/guido-apply';
import { NoteFlagDef } from '@monodi/core/document';
import { safeStorage } from '../safe-storage';
import { HasChanges } from '../ConfirmDeactivateGuard';
import { MetadataGridComponent } from '../metadata-grid/metadata-grid.component';

/** A column of the list of sources: its key, heading, and how to read its text from a source. */
interface SourceCol {
  key: string;
  label: string;
  text: (s: Source, counts: { transcribed: number; total: number }) => string;
  /** Shown unless the user hid it. */
  shown: boolean;
  num?: boolean;
}

const SOURCE_COLS: SourceCol[] = [
  { key: 'siglum', label: 'Siglum', text: s => s.quellensigle ?? '', shown: true },
  { key: 'dating', label: 'Dating', text: s => s.datierung ?? '', shown: true },
  { key: 'origin', label: 'Origin', text: s => [s.herkunftsort, s.herkunftsinstitution].filter(Boolean).join(', '), shown: true },
  { key: 'region', label: 'Region', text: s => s.herkunftsregion ?? '', shown: false },
  { key: 'type', label: 'Type', text: s => s.quellentyp ?? '', shown: false },
  { key: 'order', label: 'Order', text: s => s.ordenstradition ?? '', shown: false },
  { key: 'library', label: 'Library', text: s => [s.bibliotheksort, s.bibliothek, s.bibliothekssignatur].filter(Boolean).join(', '), shown: false },
  { key: 'docs', label: 'Documents', text: (_, c) => (c.transcribed === c.total ? `${c.total}` : `${c.transcribed}/${c.total}`), shown: true, num: true },
];
const COLS_KEY = 'monodi_sources_cols';

/** One line of the list of sources: the text of every column, worked out once per change of the list or the filters. */
interface SourceRow {
  source: Source;
  cells: Record<string, string>;
  /** Number of documents, for sorting the Documents column. */
  total: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface GuidoImportState {
  fileName: string;
  data: ArrayBuffer;
  templates: GuidoTemplate[];
  templateId: string;
  result: GuidoImportResult | null;
  error: string;
  plan: GuidoPlan | null;
  mode: GuidoConflictMode;
  definedFlags: NoteFlagDef[];
  flagsToAdd: string[];
  showTemplate: boolean;
  templateJson: string;
  templateErrors: string[];
}

@Component({
    selector: 'app-sources-overview',
    templateUrl: './sources-overview.component.html',
    styleUrls: ['./sources-overview.component.css'],
    standalone: false
})
export class SourcesOverviewComponent implements OnInit, OnDestroy, HasChanges {
  /** The list (find a source, open it) or the sheet (edit the metadata of many sources or documents like a spreadsheet). */
  sheet = false;
  @ViewChild(MetadataGridComponent) private grid?: MetadataGridComponent;

  /** Leaving the page with unsaved edits in the sheet asks first (router guard). */
  hasChanges(): boolean { return this.grid?.hasChanges() ?? false; }

  /** Switches between list and sheet; the address keeps it (`?view=sheet`) so a reload or a link opens the same view. */
  showSheet(on: boolean): void {
    if (on === this.sheet) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: on ? 'sheet' : null }, queryParamsHandling: 'merge' });
  }

  private readonly focusSvc = inject(FocusService);
  private readonly pdfDialog = inject(PdfDialogLauncher);
  subs: Subscription[] = [];
  sources: Source[] = [];
  user: User | null = null;
  docCountsMap = new Map<string, { transcribed: number; total: number }>();


  showExportDialog = false;
  exportMode: 'zip' | 'html' | 'pdf' = 'zip';
  isExporting = false;
  exportStatusMessage = '';
  allDocuments: any[] = [];
  selectedSourcesForExport: Source[] = [];
  selectedDocsForExport: any[] = [];
  renderingDocument: any = null;
  exportBackwardsCompatMode: BackwardsCompatMode = 'none';
  /** Old versions: write a placeholder note under comments on syllables without notes. */
  exportPlaceholderNotes = false;

  // CSV export options
  showCsvExportDialog = false;

  /** An annotation file from the Neumen-Editor waiting for the person's OK. */
  annotationImport: { fileName: string; preview: ImportPreview } | null = null;
  isApplyingAnnotations = false;
  /** The GUIDO (Word) file that was chosen, read with the selected template, before anything is stored. */
  guidoImport: GuidoImportState | null = null;
  isApplyingGuido = false;
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

  /** Text typed into the search field above the list (every word must occur somewhere in the row). */
  query = '';
  /** The filter typed under a column heading, by column key (every word must occur in that column). */
  colFilter: Record<string, string> = {};
  /** The column the list is sorted by and the direction; the siglum, ascending, until a heading is clicked. */
  sortKey = 'siglum';
  sortAsc = true;
  /** The columns, with the user's choice of which are shown (kept in this browser). */
  readonly cols: SourceCol[] = (() => {
    const saved = safeStorage.getJson<unknown>(COLS_KEY, null);
    const keys = Array.isArray(saved) ? saved : null;
    return SOURCE_COLS.map(c => ({ ...c, shown: keys ? keys.includes(c.key) : c.shown }));
  })();
  private rowCache: { sources: Source[] | null; counts: unknown; sig: string; rows: SourceRow[] } =
    { sources: null, counts: null, sig: '', rows: [] };

  /** The column under the mouse; only its filter field (and fields with text) are drawn. */
  hoverCol = '';

  get shownCols(): SourceCol[] { return this.cols.filter(c => c.shown); }

  /** Click on a heading: sort by it; a second click reverses. */
  sortBy(key: string): void {
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else { this.sortKey = key; this.sortAsc = true; }
  }

  /** "▲" or "▼" after the heading of the column the list is sorted by. */
  arrow(key: string): string { return this.sortKey === key ? (this.sortAsc ? '▲' : '▼') : ''; }

  toggleCol(col: SourceCol): void {
    col.shown = !col.shown;
    if (!col.shown) delete this.colFilter[col.key];
    safeStorage.setJson(COLS_KEY, this.cols.filter(c => c.shown).map(c => c.key));
  }

  /** The sources that match the search and the column filters, in the chosen order (numbers natural: "Aa 2" before "Aa 13"). */
  get rows(): SourceRow[] {
    const c = this.rowCache;
    const sig = JSON.stringify([this.query, this.colFilter, this.sortKey, this.sortAsc]);
    if (c.sources === this.sources && c.counts === this.docCountsMap && c.sig === sig) return c.rows;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const filters = Object.entries(this.colFilter)
      .map(([key, v]) => ({ key, words: v.toLowerCase().split(/\s+/).filter(Boolean) }))
      .filter(f => f.words.length);
    const rows = (this.sources ?? [])
      .map(source => this.toRow(source))
      .filter(r => {
        const all = Object.values(r.cells).join(' ').toLowerCase();
        return words.every(w => all.includes(w))
          && filters.every(f => f.words.every(w => (r.cells[f.key] ?? '').toLowerCase().includes(w)));
      })
      .sort((a, b) => {
        const d = this.sortKey === 'docs' ? a.total - b.total : collator.compare(a.cells[this.sortKey] ?? '', b.cells[this.sortKey] ?? '');
        return (this.sortAsc ? d : -d) || collator.compare(a.cells['siglum'], b.cells['siglum']);
      });
    this.rowCache = { sources: this.sources, counts: this.docCountsMap, sig, rows };
    return rows;
  }

  private toRow(source: Source): SourceRow {
    const counts = this.docCountsMap.get(source.id ?? '') ?? { transcribed: 0, total: 0 };
    const cells: Record<string, string> = {};
    for (const c of this.cols) cells[c.key] = c.text(source, counts);
    return { source, cells, total: counts.total };
  }

  /** Enter in the search field opens the first source of the list. */
  openFirst(): void {
    const first = this.rows[0];
    if (first) this.goToSource(first.source);
  }

  constructor(
    private api: APIService,
    private userService: UserService,
    private statusLine: StatusLineService,
    private router: Router,
    private pageTitle: PageTitleService,
    private cdRef: ChangeDetectorRef,
    private zone: NgZone,
    private route: ActivatedRoute,
    private fsService: FileSystemService,
    private backupReminder: BackupReminderService,
  ) {}

  ngOnInit() {
    this.pageTitle.set('Sources');
    this.subs.push(this.userService.user.subscribe(u => {
      this.user = u;
      this.updateList();
    }));
    // The Import / Export page lands here with a `ws=` query param
    // and we kick off the matching action automatically. Once consumed we
    // strip the param so a back-button trip doesn't re-fire it.
    this.subs.push(this.route.queryParamMap.subscribe(params => {
      const sheet = params.get('view') === 'sheet';
      if (this.sheet && !sheet) this.updateList();   // back to the list: show what the sheet saved
      this.sheet = sheet;
      this.cdRef.markForCheck();
      const ws = params.get('ws');
      if (!ws) return;
      // Defer so the file inputs / dialog state are mounted and the
      // sources list has had a chance to load.
      setTimeout(() => this.handleWorkspaceAction(ws), 50);
      this.router.navigate([], { relativeTo: this.route, queryParams: { ws: null }, queryParamsHandling: 'merge' });
    }));
  }

  /** Triggered by `?ws=<action>` arriving from the Import / Export page. */
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
      case 'export-pdf':
        this.openExportDialog('pdf');
        break;
      case 'export-csv':
        this.showCsvExportDialog = true;
        break;
      case 'import-csv':
        document.getElementById('importCsvFile')?.click();
        break;
      case 'import-mei':
        this.openMeiImport();
        break;
      case 'import-annotations':
        document.getElementById('importAnnotationsFile')?.click();
        break;
      case 'import-guido':
        document.getElementById('importGuidoFile')?.click();
        break;
      default:
        console.warn('Unknown workspace action:', action);
    }
  }

  updateList(): void {
    if (this.user) {
      this.api.listSources(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourcesRetrieved':
            this.sources = res.sources;
            this.loadDocumentCounts();
            break;
          default: assertNever(res);
        }
      });
    }
  }

  private static cachedDocCountsMap: Map<string, { transcribed: number; total: number }> | null = null;

  async loadDocumentCounts(): Promise<void> {
    if (!this.user) return;
    try {
      // 1. Immediately apply in-memory or persisted cache so UI renders instantly (0ms)
      if (SourcesOverviewComponent.cachedDocCountsMap) {
        this.docCountsMap = SourcesOverviewComponent.cachedDocCountsMap;
      } else {
        const persisted = await localforage.getItem<{ [sId: string]: { transcribed: number; total: number } }>('monodi_doc_counts_cache');
        if (persisted && typeof persisted === 'object') {
          this.docCountsMap = new Map(Object.entries(persisted));
          SourcesOverviewComponent.cachedDocCountsMap = this.docCountsMap;
          this.cdRef.markForCheck();
        }
      }

      // 2. Perform fast background refresh using document metadata and lightweight note index
      const docsRes = await firstValueFrom(this.api.listDocuments(this.user.token));
      if (docsRes.kind === 'DocumentsRetrieved') {
        const docs = docsRes.documents;
        const notesIndex = await NotesStore.getIndex();
        const notesIndexSet = new Set(notesIndex);

        const countsMap = new Map<string, { transcribed: number; total: number }>();
        const plainObjectCache: { [sId: string]: { transcribed: number; total: number } } = {};

        for (const d of docs) {
          const sId = d.quelle_id;
          if (!sId) continue;

          let entry = countsMap.get(sId);
          if (!entry) {
            entry = { transcribed: 0, total: 0 };
            countsMap.set(sId, entry);
            plainObjectCache[sId] = entry;
          }

          entry.total++;
          if (notesIndexSet.has(d.id)) {
            entry.transcribed++;
          }
        }

        this.docCountsMap = countsMap;
        SourcesOverviewComponent.cachedDocCountsMap = countsMap;
        localforage.setItem('monodi_doc_counts_cache', plainObjectCache).catch(() => {});
        this.cdRef.markForCheck();
      }
    } catch (e) {
      console.warn('Failed to load document counts:', e);
    }
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
  }

  goToSource(s: Source) {
    if (!s?.id) {
      this.statusLine.warning('This source has no id and cannot be opened. Export a backup and re-import it to repair it.', 'Source not opened');
      return;
    }
    this.router.navigate(['/source', s.id]).catch(e => {
      console.error('Could not open source', s.id, e);
      this.statusLine.error('Could not open this source.');
    });
  }

  async exportWorkspace() {
    try {
      const sources = await localforage.getItem('monodi_sources');
      const documents = await localforage.getItem('monodi_documents');
      // Materialise per-document notes back into a single dict for the
      // export blob — same shape the import path expects.
      const notes = await NotesStore.getAll();
      const settings = await localforage.getItem('monodi_settings');
      
      const analyses = await AnalysisStore.exportAll();
      const data = buildWorkspaceExport(sources, documents, notes, settings, this.exportBackwardsCompatMode, this.exportPlaceholderNotes, analyses);
      
      const res = await this.fsService.saveFile(JSON.stringify(data, null, 2), {
        suggestedName: `workspace_export_${new Date().toISOString().split('T')[0]}.monodijson`,
        types: [{
          description: 'Monodi Workspace Export',
          accept: { 'application/json': ['.monodijson', '.json'] }
        }],
        fallbackMimeType: 'application/json;charset=utf-8'
      });
      if (res.saved) {
        this.backupReminder.markBackup();
        this.statusLine.success("Workspace exported successfully.");
      }
    } catch (e) {
      this.statusLine.error("Export failed: " + e);
    }
  }



  // --- MEI import (several files at once) ---
  showMeiImportDialog = false;
  /** A value of `importFormatOptions`: `auto`, `neume`, `premensural` or `profile:<id>` (an export profile of the project). */
  meiImportFormat = 'auto';
  /** The export profiles of the project, for the formats of the import (loaded when the dialog opens). */
  meiImportProfiles: MeiMappingProfileV2[] = [];
  get meiImportFormats(): { value: string; label: string }[] { return importFormatOptions(this.meiImportProfiles); }
  /** Source the documents are created in; `new` creates one with the siglum below. */
  meiImportSourceId = '';
  meiImportNewSigle = '';
  meiImportFiles: { name: string; text: string; documentId: string; result?: MeiImportResult; error?: string }[] = [];
  meiImportBusy = false;

  openMeiImport(): void {
    this.meiImportFormat = 'auto';
    this.meiImportSourceId = '';
    this.meiImportNewSigle = '';
    this.meiImportFiles = [];
    this.meiImportBusy = false;
    this.showMeiImportDialog = true;
    if (this.user) {
      this.api.getSettings(this.user.token).subscribe(res => {
        if (res.kind === 'SettingsRetrieved') { this.meiImportProfiles = res.settings.meiProfiles ?? []; this.cdRef.markForCheck(); }
      });
    }
    this.cdRef.markForCheck();
  }

  closeMeiImport(): void { this.showMeiImportDialog = false; }

  async onMeiFilesPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const f of files) {
      this.meiImportFiles.push({ name: f.name, text: await f.text(), documentId: documentIdFromFileName(f.name) });
    }
    input.value = '';
    this.previewMeiImport();
  }

  /** Reads every chosen file with the chosen format; shows what was found or why a file cannot be read. */
  previewMeiImport(): void {
    for (const f of this.meiImportFiles) {
      f.result = undefined; f.error = undefined;
      try { f.result = importMei(f.text, importRequestOf(this.meiImportFormat, this.meiImportProfiles)); }
      catch (e) { f.error = e instanceof Error ? e.message : String(e); }
    }
    this.cdRef.markForCheck();
  }

  removeMeiFile(index: number): void { this.meiImportFiles.splice(index, 1); }

  get meiImportReady(): boolean {
    const ok = this.meiImportFiles.filter(f => f.result);
    const target = this.meiImportSourceId === 'new' ? this.meiImportNewSigle.trim() !== '' : this.meiImportSourceId !== '';
    return ok.length > 0 && target && !this.meiImportBusy;
  }

  async confirmMeiImport(): Promise<void> {
    if (!this.user || !this.meiImportReady) return;
    this.meiImportBusy = true;
    try {
      let sourceId = this.meiImportSourceId;
      if (sourceId === 'new') {
        const created = await firstValueFrom(this.api.createSource(this.user.token, newImportedSource(this.meiImportNewSigle.trim())));
        if (created.kind !== 'SourceCreated') throw new Error('The source could not be created.');
        sourceId = created.id;
      }
      let made = 0;
      let warnings = 0;
      for (const f of this.meiImportFiles) {
        if (!f.result) continue;
        const doc = newImportedDocument(sourceId, f.documentId.trim() || f.result.title || documentIdFromFileName(f.name));
        const res = await firstValueFrom(this.api.createDocument(this.user.token, { document: doc, notes: f.result.root }));
        if (res.kind === 'DocumentCreated') { made++; warnings += f.result.warnings.length; }
      }
      this.updateList();
      this.showMeiImportDialog = false;
      this.statusLine.success(`${made} document(s) created from MEI.`);
      if (warnings > 0) this.statusLine.warning(`${warnings} note(s) about things the import could not carry over; see the dialog next time before importing.`, 'MEI import');
    } catch (e) {
      this.statusLine.error('MEI import failed: ' + (e instanceof Error ? e.message : e));
    } finally {
      this.meiImportBusy = false;
      this.cdRef.markForCheck();
    }
  }

  closeCsvExportDialog() {
    this.showCsvExportDialog = false;
  }

  async confirmCsvExport() {
    this.showCsvExportDialog = false;
    if (!this.csvIncludeSourceMeta && !this.csvIncludeDocumentMeta && !this.csvIncludeContent) {
      this.statusLine.error('Please select at least one column group.');
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
      downloadBlob(blob, `workspace_export_${new Date().toISOString().split('T')[0]}.csv`);
      this.statusLine.success('CSV exported successfully.');
    } catch (e) {
      this.statusLine.error('CSV export failed: ' + e);
    }
  }

  async triggerImport() {
    if (this.fsService.isSupported()) {
      const res = await this.fsService.openFile({
        types: [{
          description: 'Monodi Workspace Export',
          accept: { 'application/json': ['.monodijson', '.json'] }
        }]
      });
      if (res && res.file) {
        this.processImportFile(res.file);
      }
    } else {
      document.getElementById('importFile')?.click();
    }
  }

  /** A file from the Neumen-Editor was chosen: read it and show what it would add, before anything changes. */
  async onAnnotationFilePicked(event: any): Promise<void> {
    const files: File[] = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    try {
      // one JSON file, a ZIP, or a documentation's files chosen together
      const parsed = parseAnnotationFile(await readAnnotationFiles(files));
      const preview = planImport(parsed, this.sources);
      this.annotationImport = { fileName: files.length === 1 ? files[0].name : `${files.length} files`, preview };
      if (!preview.plans.length) {
        this.statusLine.warning(preview.unmatched.length
          ? `None of the manuscripts in this file are here: ${preview.unmatched.slice(0, 3).join(', ')}.`
          : 'The file holds no manuscripts.', 'Nothing to import');
      }
    } catch (err: any) {
      this.annotationImport = null;
      this.statusLine.error(err?.message || String(err), 'Could not read the annotation file');
    }
    this.cdRef.markForCheck();
  }

  readonly describePlan = describePlan;

  get annotationPlansWithChanges() {
    return (this.annotationImport?.preview.plans ?? []).filter(planChangesAnything);
  }

  closeAnnotationImport(): void {
    if (this.isApplyingAnnotations) return;
    this.annotationImport = null;
  }

  /** Write the plans into the sources. Each source is marked changed, so the next push sends it. */
  async confirmAnnotationImport(): Promise<void> {
    if (!this.annotationImport || !this.user || this.isApplyingAnnotations) return;
    this.isApplyingAnnotations = true;
    let applied = 0;
    try {
      for (const plan of this.annotationPlansWithChanges) {
        const local = this.sources.find(s => s.id === plan.sourceId);
        if (!local) continue;
        const res = await firstValueFrom(this.api.updateSource(this.user.token, applyPlan(local, plan)));
        if (res.kind === 'Ok') applied++;
        else { this.statusLine.error(`${plan.label} could not be saved.`); continue; }
        if (plan.images) {
          try { await saveStripImages(plan.sourceId, plan.images); }
          catch { this.statusLine.error(`The line pictures of ${plan.label} could not be kept; the notation documentation prints without them.`); }
        }
      }
      if (applied) this.statusLine.success(`Annotations added to ${applied} manuscript${applied === 1 ? '' : 's'}.`);
    } finally {
      this.isApplyingAnnotations = false;
      this.annotationImport = null;
      this.updateList();
      this.cdRef.markForCheck();
    }
  }


  // ---------------------------------------------------------------------------------------------
  // GUIDO (Word): chant typed in the GUIDO font, read with an import template (see guido/)

  /** A .docx was chosen: read it with the built-in template and show what it would add. */
  async onGuidoFilePicked(event: any): Promise<void> {
    const file: File | undefined = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const settings = await this.guidoSettings();
      const templates = allGuidoTemplates(settings?.guidoImportTemplates);
      this.guidoImport = {
        fileName: file.name, data: await file.arrayBuffer(), templates, templateId: BUILTIN_TEMPLATE_ID,
        result: null, error: '', plan: null, mode: 'skip', definedFlags: settings?.noteFlags ?? [],
        flagsToAdd: [], showTemplate: false, templateJson: '', templateErrors: [],
      };
      await this.refreshGuido();
    } catch (err: any) {
      this.guidoImport = null;
      this.statusLine.error(err?.message || String(err), 'Could not read the Word file');
    }
    this.cdRef.markForCheck();
  }

  private async guidoSettings() {
    if (!this.user) return null;
    const res = await firstValueFrom(this.api.getSettings(this.user.token));
    return res.kind === 'SettingsRetrieved' ? res.settings : null;
  }

  get guidoTemplate(): GuidoTemplate | undefined {
    return this.guidoImport?.templates.find(t => t.id === this.guidoImport!.templateId);
  }

  get guidoIsBuiltin(): boolean {
    return this.guidoImport?.templateId === BUILTIN_TEMPLATE_ID;
  }

  /** Reads the file again with the selected template. */
  async refreshGuido(): Promise<void> {
    const g = this.guidoImport;
    const template = this.guidoTemplate;
    if (!g || !template) return;
    g.result = null;
    g.error = '';
    try {
      g.result = await parseGuidoDocx(g.data, template, g.fileName);
      if (!g.result.documents.length) g.error = 'Nothing is attested in this file with this template.';
    } catch (err: any) {
      g.error = err?.message || String(err);
    }
    g.templateJson = JSON.stringify(
      this.guidoIsBuiltin ? { ...template, id: 'my-template', name: `${template.name} (copy)` } : template, null, 2);
    await this.updateGuidoPlan();
    this.cdRef.markForCheck();
  }

  async updateGuidoPlan(): Promise<void> {
    const g = this.guidoImport;
    if (!g) return;
    if (!g.result) { g.plan = null; g.flagsToAdd = []; return; }
    const documents = (await localforage.getItem<Document[]>('monodi_documents')) || [];
    g.plan = planGuidoImport(g.result, this.sources, documents.map(d => d.id), g.mode);
    g.flagsToAdd = mergeNoteFlags(g.definedFlags, g.result.template.ensureFlags).added;
    this.cdRef.markForCheck();
  }

  async selectGuidoTemplate(id: string): Promise<void> {
    if (!this.guidoImport) return;
    this.guidoImport.templateId = id;
    this.guidoImport.templateErrors = [];
    await this.refreshGuido();
  }

  async setGuidoMode(mode: GuidoConflictMode): Promise<void> {
    if (!this.guidoImport) return;
    this.guidoImport.mode = mode;
    await this.updateGuidoPlan();
  }

  get guidoExisting(): number {
    return (this.guidoImport?.plan?.documents ?? []).filter(d => d.action !== 'new').length;
  }

  get guidoWillWrite(): number {
    return (this.guidoImport?.plan?.documents ?? []).filter(d => d.action !== 'skip').length;
  }

  closeGuidoImport(): void {
    if (this.isApplyingGuido) return;
    this.guidoImport = null;
  }

  /** The text of the editor is stored as a template of its own; the built-in one is never changed. */
  async saveGuidoTemplate(): Promise<void> {
    const g = this.guidoImport;
    if (!g || !this.user) return;
    g.templateErrors = [];
    let raw: unknown;
    try { raw = JSON.parse(g.templateJson); }
    catch (e: any) { g.templateErrors = [`Not valid JSON: ${e.message}`]; return; }
    const { template, errors } = parseGuidoTemplate(raw);
    if (!template || errors.length) { g.templateErrors = errors; return; }
    const settings = await this.guidoSettings();
    if (!settings) return;
    const stored = (settings.guidoImportTemplates ?? []).filter(t => t.id !== template.id);
    settings.guidoImportTemplates = [...stored, template];
    await firstValueFrom(this.api.updateSettings(this.user.token, settings));
    g.templates = allGuidoTemplates(settings.guidoImportTemplates);
    g.templateId = template.id;
    this.statusLine.success(`Template "${template.name}" saved.`);
    await this.refreshGuido();
  }

  async deleteGuidoTemplate(): Promise<void> {
    const g = this.guidoImport;
    if (!g || !this.user || this.guidoIsBuiltin) return;
    const settings = await this.guidoSettings();
    if (!settings) return;
    settings.guidoImportTemplates = (settings.guidoImportTemplates ?? []).filter(t => t.id !== g.templateId);
    await firstValueFrom(this.api.updateSettings(this.user.token, settings));
    g.templates = allGuidoTemplates(settings.guidoImportTemplates);
    g.templateId = BUILTIN_TEMPLATE_ID;
    await this.refreshGuido();
  }

  async confirmGuidoImport(): Promise<void> {
    const g = this.guidoImport;
    if (!g?.result || !this.user || this.isApplyingGuido) return;
    this.isApplyingGuido = true;
    try {
      const counts = await applyGuidoImport(g.result, g.mode);
      if (g.flagsToAdd.length) {
        const settings = await this.guidoSettings();
        if (settings) {
          settings.noteFlags = mergeNoteFlags(settings.noteFlags, g.result.template.ensureFlags).flags;
          await firstValueFrom(this.api.updateSettings(this.user.token, settings));
        }
      }
      this.api.invalidateCache();
      const parts = [
        counts.newDocuments && `${counts.newDocuments} new`,
        counts.replaced && `${counts.replaced} replaced`,
        counts.copies && `${counts.copies} copied`,
        counts.skipped && `${counts.skipped} kept as they were`,
      ].filter(Boolean).join(', ');
      this.statusLine.success(`${counts.newSources} new source${counts.newSources === 1 ? '' : 's'}; documents: ${parts || 'none'}.`, 'GUIDO import');
    } catch (err: any) {
      this.statusLine.error(err?.message || String(err), 'GUIDO import failed');
    } finally {
      this.isApplyingGuido = false;
      this.guidoImport = null;
      this.updateList();
      this.cdRef.markForCheck();
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
          // Bulk write whose exact effect on individual manuscripts isn't
          // cheaply known here — invalidate the push cache wholesale so the
          // next push does a full (correct) scan instead of risking a false
          // "clean" for something this import actually changed.
          await PushCache.invalidateAll();
          this.updateList();

          this.statusLine.success(
            `CSV imported: ${createdSources} new / ${updatedSources} updated sources, ` +
              `${createdDocs} new / ${updatedDocs} updated documents.`
          );
          if (parsed.warnings.length > 0) {
            this.statusLine.warning(parsed.warnings.slice(0, 5).join('; '), 'CSV import warnings');
          }
        } catch (err) {
          this.statusLine.error('CSV import failed: ' + err);
        }

        event.target.value = '';
      });
    };
    reader.readAsText(file);
  }

  importWorkspace(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.processImportFile(file);
    event.target.value = '';
  }

  private processImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.zone.run(async () => {
        try {
          const content = e.target?.result as string;
          const json = JSON.parse(content);
          const data = parseWorkspaceImport(json);
          
          if (data.schemaVersion > WORKSPACE_SCHEMA_VERSION) {
            this.statusLine.error("Import failed: the file's schema version (" + data.schemaVersion + ") is newer than the version this app supports (" + WORKSPACE_SCHEMA_VERSION + ").");
            return;
          }
          
          if (data.sources) await localforage.setItem('monodi_sources', data.sources);
          if (data.documents) await localforage.setItem('monodi_documents', data.documents);
          // Per-document writes so we don't hit IndexedDB's structured-clone
          // limit when the user re-imports a very large workspace.
          if (data.notesDict) await NotesStore.replaceAll(data.notesDict);
          if (data.settings) await localforage.setItem('monodi_settings', data.settings);
          // Saved analyses of the Analysis page come back with their results and ids (older files have none).
          if (data.analyses) await AnalysisStore.restoreAll(data.analyses);
          
          this.api.invalidateCache();
          // Bulk write whose exact effect on individual manuscripts isn't
          // cheaply known here — invalidate the push cache wholesale so the
          // next push does a full (correct) scan instead of risking a false
          // "clean" for something this import actually changed.
          await PushCache.invalidateAll();
          this.statusLine.success("Workspace imported successfully.");
          this.updateList();
        } catch (err) {
          this.statusLine.error("Import failed: " + err);
        }
      });
    };
    reader.readAsText(file);
  }

  triggerOmmrImport() {
    document.getElementById('importOmmrFile')?.click();
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
   * `source.custom` so nothing is silently dropped (the long `description`
   * markdown lives there, for example; the older key `beschreibung` is renamed). The `manifest` field, if any, is
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
   * long `description` markdown lives there, for example; the older key `beschreibung` is renamed). `manifest` maps
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
      let zip = await JSZip.loadAsync(arrayBuffer);
      if (this.importProgress.cancelled) return;
      // an export that was zipped once more holds only the real archive: open that one
      const inner = nestedZipPath(Object.keys(zip.files));
      if (inner) {
        this.updateProgress({ message: 'The file holds another ZIP — opening that one…' });
        zip = await JSZip.loadAsync(await zip.files[inner].async('arraybuffer'));
        if (this.importProgress.cancelled) return;
      }

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
        this.statusLine.error('No meta.json files found inside this ZIP — is it a valid monodi/OMMR export?');
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

        const next = sourceFromMeta(meta, sourceId);

        const existing = sourceIndex.get(sourceId);
        if (existing) {
          Object.assign(existing, next);
          this.importProgress.counts.updatedSources++;
        } else {
          sources.push(next);
          sourceIndex.set(sourceId, next);
          this.importProgress.counts.newSources++;
        }
        // neume table rows, line regions and snippets of the notation documentation travel in the source's meta.json
        mergeMetaAnnotations(existing ?? next, meta);

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
      this.updateProgress({
        phase: 'documents',
        message: `Importing documents…`,
        current: 0,
        total: docMetas.length,
        details: '',
      });

      const importSettings = await localforage.getItem<any>('monodi_settings');
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

          const next = documentFromMeta(meta, docId, sourceId);

          // Persist this document's notes BEFORE registering the document
          // itself. If the notes write fails for any reason (storage full,
          // single-row size limit, …) we want the document to NOT appear in
          // the listing, otherwise the user would later click it and get
          // "loading…" forever because the notes row is missing. Order:
          //   1. NotesStore.set(...)
          //   2. documents.push(...) / documents[idx] = ...
          let notesPersisted = false;
          if (docData && docData.kind === 'RootContainer' && placeholderImportEnabled(importSettings)) {
            normalizeDocumentComments(docData);
            applyPlaceholderImport(docData, importSettings);
          }
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
      // Bulk import touched an unknown subset of manuscripts — invalidate
      // wholesale so the next push scans everything rather than risking a
      // false "clean" for something this import actually changed.
      await PushCache.invalidateAll();
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
      this.statusLine.error(`Error reading ZIP: ${(err as Error)?.message ?? err}`);
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
    this.statusLine.info('Import cancelled — partial progress kept.', 'Cancelled');
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

  async openExportDialog(mode: 'zip' | 'html' | 'pdf') {
    this.exportMode = mode;
    this.selectedSourcesForExport = [];
    this.selectedDocsForExport = [];
    this.isExporting = false;
    this.exportStatusMessage = '';
    
    const toastRef = this.statusLine.info("Loading workspace documents...", "Export", { disableTimeOut: true });
    try {
      await this.loadAllDocuments();
      this.statusLine.remove(toastRef.toastId);
      this.showExportDialog = true;
    } catch(e) {
      this.statusLine.remove(toastRef.toastId);
      this.statusLine.error("Failed to load documents: " + e);
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
    // The selector reports its first selection while the dialog is still being checked; apply it right after
    // (changing the Export button's state in the middle of the check raises NG0100).
    Promise.resolve().then(() => {
      this.selectedSourcesForExport = selection.selectedSources;
      this.selectedDocsForExport = selection.selectedDocs;
    });
  }

  get hasSelectedItems(): boolean {
    return this.selectedDocsForExport.length > 0;
  }

  async runExport() {
    this.isExporting = true;
    try {
      if (this.exportMode === 'zip') {
        await this.generateZipWorkspace();
      } else if (this.exportMode === 'pdf') {
        // hand the selection over to the print dialog (options, order, page format)
        const docs = [...this.selectedDocsForExport]
          .sort((a: any, b: any) => compareNatural(a.dokumenten_id, b.dokumenten_id));
        this.closeExportDialog();
        this.pdfDialog.open({ docs, title: '' });
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
      
      const zipSettings = await localforage.getItem<any>('monodi_settings');
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
          description: sourceDescription(s)
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
              const part = (r: RootContainer) => this.exportPlaceholderNotes ? syllableCommentsToPlaceholders(r, placeholderConfigFromSettings(zipSettings)) : r;
              zip.file(`${s.id}/${d.id}-v1/data.json`, JSON.stringify(part(split.v1), null, 2));
              zip.file(`${s.id}/${d.id}-v2/meta.json`, JSON.stringify(doc2, null, 2));
              zip.file(`${s.id}/${d.id}-v2/data.json`, JSON.stringify(part(split.v2), null, 2));
            } else {
              if (this.exportBackwardsCompatMode === 'consecutive_lines') {
                notes = convertToBackwardsCompatibleConsecutiveLines(notes as RootContainer);
              } else if (this.exportBackwardsCompatMode === 'comment') {
                notes = convertToBackwardsCompatibleComment(notes as RootContainer);
              }
              if (this.exportPlaceholderNotes && notes && (notes as any).kind === 'RootContainer') {
                notes = syllableCommentsToPlaceholders(notes as RootContainer, placeholderConfigFromSettings(zipSettings));
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
      const res = await this.fsService.saveFile(blob, {
        suggestedName: `monodi_workspace_export_${new Date().toISOString().split('T')[0]}.zip`,
        types: [{
          description: 'ZIP Archive',
          accept: { 'application/zip': ['.zip'] }
        }],
        fallbackMimeType: 'application/zip'
      });
      
      if (res.saved) {
        this.backupReminder.markBackup();
        this.statusLine.success("Workspace successfully exported as ZIP.");
      }
      this.closeExportDialog();
    } catch (e) {
      this.statusLine.error("Error exporting workspace ZIP: " + e);
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
          if (settingsRes.kind === 'SettingsRetrieved') {
            settings = settingsRes.settings;
            this.focusSvc.notationColor = sanitizeNotationColor(settings?.notationColor);
            this.focusSvc.clefDisplayMode = sanitizeClefDisplayMode(settings?.clefDisplayMode);
          }
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
              rawJsonData: jsonForScript(notes[doc.id] || {}),
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
      const res = await this.fsService.saveFile(blob, {
        suggestedName: `monodi_static_edition_${new Date().toISOString().split('T')[0]}.zip`,
        types: [{
          description: 'ZIP Archive',
          accept: { 'application/zip': ['.zip'] }
        }],
        fallbackMimeType: 'application/zip'
      });
      
      if (res.saved) {
        this.statusLine.success("HTML Edition exported successfully!");
      }
      this.closeExportDialog();
    } catch (e) {
      this.statusLine.error("Error generating HTML export: " + e);
      console.error(e);
    } finally {
      this.renderingDocument = null;
    }
  }

}
