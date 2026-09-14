import { ChangeDetectorRef, DoCheck, Component, OnInit, OnDestroy, ViewChild, TemplateRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UserService, User } from '../user.service';
import { APIService, UserInfo, Source, Document } from '../api.service'
import { VolpianoService } from '../volpiano.service';
import { ToastrService } from 'ngx-toastr';
import { ToolsService, Tool } from '../tools.service';
import { assertNever } from '../../utils';
import { Subscription, combineLatest, firstValueFrom } from 'rxjs';
import * as S from '../sselect/sselect.component';
import { AnalyzedPattern } from '../transcription-analyzer.service';
import { analyzeDocument, extractDocumentFolios } from '../transcription-analyzer-core';
import { ProjectSettings } from '../api.service';
import { PageTitleService } from '../page-title.service';
import { Header, BatchField } from '../smart-table/smart-table.component';
import { NotesStore } from '../notes-store';
import { ContainerKind, RootContainer } from '../types/model';

export interface DocColDef {
  key: keyof Document | string;
  label: string;
  visible: boolean;
}

const DEFAULT_DOC_COLS: DocColDef[] = [
  { key: 'dokumenten_id',          label: 'Document ID',           visible: true  },
  { key: 'textinitium',            label: 'Text Initium',          visible: true  },
  { key: 'gattung1',               label: 'Genre 1',               visible: true  },
  { key: 'gattung2',               label: 'Genre 2',               visible: true  },
  { key: 'festtag',                label: 'Feast Day',             visible: false },
  { key: 'feier',                  label: 'Celebration',           visible: false },
  { key: 'foliostart',             label: 'Folio Start',           visible: false },
  { key: 'zeilenstart',            label: 'Line Start',            visible: false },
  { key: 'druckausgabe',           label: 'Print Edition',         visible: false },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.',  visible: false },
  { key: 'editionsstatus',         label: 'Edition Status',        visible: false },
  { key: 'kommentar',              label: 'Comment',               visible: false },
];

const DOC_COLS_KEY = 'monodi_doc_cols';

@Component({
    selector: 'app-source',
    templateUrl: './source.component.html',
    styleUrls: ['./source.component.css'],
    standalone: false
})
export class SourceComponent implements OnInit {
  subs: Subscription[] = [];
  source: Source | undefined = undefined;
  documents: Document[] = [];
  user: User | null = null;
  settings: ProjectSettings | null = null;
  isSaving = false;

  // Volpiano import
  @ViewChild('volpianoImport', { static: false }) volpianoImportModal!: TemplateRef<any>;
  volpianoImportText = '';
  volpianoImportAlignedText = '';
  volpianoImportDocId = '';
  volpianoImportWarnings: string[] = [];

  // Tab state
  activeTab: 'documents' | 'notation' = 'documents';
  activeNotationTab: 'select' | 'annotate' | 'view' = 'select';

  // Notation analysis
  allPatterns: AnalyzedPattern[] = [];
  sourceFolios: string[] = [];
  isLoadingNotation = false;
  notationLoaded = false;

  showDocColPicker = false;
  showMetadataPanel = false;
  iiifGalleryPattern = '';
  docCols: DocColDef[] = [];

  get visibleDocCols(): DocColDef[] {
    return this.docCols.filter(c => c.visible);
  }

  loadDocCols() {
    try {
      const saved = localStorage.getItem(DOC_COLS_KEY);
      if (saved) {
        const parsed: DocColDef[] = JSON.parse(saved);
        this.docCols = DEFAULT_DOC_COLS.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      } else {
        this.docCols = DEFAULT_DOC_COLS.map(c => ({ ...c }));
      }
    } catch {
      this.docCols = DEFAULT_DOC_COLS.map(c => ({ ...c }));
    }
    this.updateDocHeaders();
  }

  saveDocCols() {
    localStorage.setItem(DOC_COLS_KEY, JSON.stringify(this.docCols));
    this.updateDocHeaders();
  }

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private route: ActivatedRoute,
    private toastr: ToastrService,
    private location: Location,
    private toolService: ToolsService,
    private cdr: ChangeDetectorRef,
    private modalService: NgbModal,
    private volpiano: VolpianoService,
    private pageTitle: PageTitleService) {
    this.loadDocCols();
  }

  ngOnInit() {
    // Restore panel state from the URL so a reload keeps you on the same tab.
    const q = this.route.snapshot.queryParamMap;
    const tab = q.get('tab');
    if (tab === 'documents' || tab === 'notation') this.activeTab = tab;
    const ntab = q.get('ntab');
    if (ntab === 'select' || ntab === 'annotate' || ntab === 'view') this.activeNotationTab = ntab;

    this.subs.push(combineLatest([this.userService.user, this.route.paramMap]).subscribe(([user, params]) => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
            this.cdr.markForCheck();
          }
        });
      }
      const id = params.get("id");
      if (id !== null) {
        this.retrieveForId(id);
      } else {
        this.pageTitle.set('New Source');
        this.showMetadataPanel = true;
        this.source = {
          id: undefined,
          quellensigle: "",
          herkunftsregion: "",
          herkunftsort: "",
          herkunftsinstitution: "",
          ordenstradition: "",
          quellentyp: "",
          bibliotheksort: "",
          bibliothek: "",
          bibliothekssignatur: "",
          kommentar: "",
          datierung: "",
          custom: {}
        };
        this.cdr.markForCheck();
      }

    }));
  }

  promptForName() {
    this.showMetadataPanel = true;
    setTimeout(() => {
      const el = document.getElementById('quellensigle-input') as HTMLInputElement;
      if (el) {
        el.focus();
        el.select();
      }
    }, 50);
  }

  updateQuellensigle(quellensigle: string) {
    this.toolService.remove(this);
    this.toolService.addStack({
      source: this,
      tools: [
        {
          title: 'Quellensigle: ' + quellensigle
        },
      ]
    });
  }

  retrieveForId(id: string): void {
    if (this.user) {
      this.api.getSource(this.user.token, id).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourceNotFound':
            this.source = undefined;
            this.cdr.markForCheck();
            break;
          case 'SourceRetrieved':
            this.source = res.source;
            if (!this.source.custom) this.source.custom = {};
            this.updateQuellensigle(this.source.quellensigle);
            this.pageTitle.set(
              this.source.quellensigle || this.source.bibliothekssignatur || 'Source',
              this.source.herkunftsinstitution || undefined
            );
            this.notationLoaded = false;
            this.allPatterns = [];
            this.sourceFolios = [];
            // Reload landed directly on the notation tab (?tab=notation): load it now.
            if (this.activeTab === 'notation' && this.source?.id) {
              this.loadNotation();
            }
            this.cdr.markForCheck();
            break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          default: assertNever(res);
        }
      });

      this.api.listDocuments(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'DocumentsRetrieved':
            this.documents = res.documents.filter(d => d.quelle_id === id);
            this.cdr.markForCheck();
            break;
          default: assertNever(res);
        }
      });
    }
  }

  save(): void {
    if (this.source) {
      if (this.source.id) {
        this.update();
      } else {
        this.create();
      }
    }
  }

  create(): void {
    if (this.user && this.source && !this.isSaving) {
      this.isSaving = true;
      this.api.createSource(this.user.token, this.source).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourceCreated': 
            this.toastr.success("Saved successfully.");
            if (this.source) this.source.id = res.id;
            this.location.replaceState('/source/' + res.id);
            break;
          default: assertNever(res);
        }
      });
    }
  }

  update(): void {
    if (this.user && this.source && this.source.id && !this.isSaving) {
      this.isSaving = true;
      this.api.updateSource(this.user.token, this.source).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'Ok':
            // Removed toast to prevent spamming on autosave
            if (this.source && this.source.quellensigle) {
              this.updateQuellensigle(this.source.quellensigle);
            }
            break;
          case 'SourceNotFound': this.toastr.error("It looks like this source was deleted in the meantime."); break;
          default: assertNever(res);
        }
      });
    }
  }

  deleteDocument(d: Document): void {
    if (confirm(`Delete document ${d.dokumenten_id}?`)) {
      if (this.user) {
        this.api.removeDocument(this.user.token, d.id).subscribe(res => {
          if (res.kind === 'Ok') {
            this.toastr.success("Document deleted.");
            if (this.source?.id) {
              this.retrieveForId(this.source.id);
            }
          }
        });
      }
    }
  }

  openVolpianoImport(): void {
    this.volpianoImportText = '';
    this.volpianoImportAlignedText = '';
    this.volpianoImportDocId = '';
    this.volpianoImportWarnings = [];
    this.modalService.open(this.volpianoImportModal, { size: 'lg' });
  }

  /** Create a new document under this source from a pasted Volpiano string. */
  doVolpianoImport(): void {
    if (!this.user || !this.source || !this.source.id) return;
    const raw = this.volpianoImportText.trim();
    if (!raw) {
      this.toastr.error('Please paste a Volpiano string.');
      return;
    }

    let result;
    try {
      result = this.volpiano.import(raw, this.volpianoImportAlignedText.trim() || undefined);
    } catch (e) {
      this.toastr.error('Could not read Volpiano: ' + e);
      return;
    }
    this.volpianoImportWarnings = result.warnings;

    const doc: Document = {
      id: '',
      quelle_id: this.source.id,
      dokumenten_id: this.volpianoImportDocId.trim(),
      gattung1: '',
      gattung2: '',
      festtag: '',
      feier: '',
      textinitium: '',
      bibliographischerverweis: '',
      druckausgabe: '',
      zeilenstart: '',
      foliostart: '',
      kommentar: '',
      editionsstatus: '',
      custom: {},
    };

    this.api.createDocument(this.user.token, { document: doc, notes: result.root }).subscribe(res => {
      switch (res.kind) {
        case 'LoginRequired': this.userService.logout(); break;
        case 'DocumentCreated':
          if (result.warnings.length > 0) {
            this.toastr.warning(result.warnings.slice(0, 5).join('; '), 'Volpiano import warnings');
          }
          this.toastr.success('Document created from Volpiano.');
          this.modalService.dismissAll();
          this.router.navigate(['/document', this.source!.id, res.id]);
          break;
        default: assertNever(res);
      }
    });
  }

  addToSettings(category: keyof ProjectSettings, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    const arr = this.settings[category] as any;
    if (Array.isArray(arr) && !arr.includes(val)) {
      arr.push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        this.toastr.success(`Added ${val} to ${category}`);
      });
    }
  }

  /** Unique pattern IDs across all analysed documents, passed to the IIIF annotator. */
  get documentPatternIds(): string[] {
    return Array.from(new Set(this.allPatterns.map(p => p.patternId)));
  }

  openPatternInGallery(event: { patternId: string; folio: string }) {
    this.iiifGalleryPattern = event.patternId;
    this.activeNotationTab = 'annotate';
    this.switchTab('notation'); // syncs URL (tab + ntab)
  }

  switchTab(tab: 'documents' | 'notation') {
    this.activeTab = tab;
    this.syncTabUrl();
    // Eagerly load notation when switching to notation tab — patterns feed the annotator and viewer
    if (tab === 'notation' && !this.notationLoaded && this.source?.id) {
      this.loadNotation();
    }
  }

  setNotationTab(tab: 'select' | 'annotate' | 'view') {
    this.activeNotationTab = tab;
    this.syncTabUrl();
  }

  /** Mirror the current panel state into the URL query string so the exact
   *  tab is linkable and survives a reload. */
  private syncTabUrl() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: this.activeTab, ntab: this.activeNotationTab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  loadNotation() {
    if (!this.user || !this.source?.id) return;
    this.isLoadingNotation = true;
    this.allPatterns = [];
    this.sourceFolios = [];
    const sourceId = this.source.id;

    this.api.listDocuments(this.user.token).subscribe(res => {
      if (res.kind !== 'DocumentsRetrieved') return;
      const docs = res.documents.filter(d => d.quelle_id === sourceId);

      if (docs.length === 0) {
        this.isLoadingNotation = false;
        this.notationLoaded = true;
        return;
      }

      let loaded = 0;
      const docsData: any[] = [];

      for (const doc of docs) {
        this.api.getDocumentNotes(this.user!.token, doc.id).subscribe(noteRes => {
          if (noteRes.kind === 'NotesRetrieved') {
            docsData.push({ root: noteRes.data, id: doc.id, quelle_id: doc.quelle_id });
          }
          loaded++;
          if (loaded === docs.length) {
            setTimeout(() => {
              let patterns: AnalyzedPattern[] = [];
              const folios = new Set<string>();
              for (const d of docsData) {
                patterns = patterns.concat(analyzeDocument(d.root, d.quelle_id || 'Unknown', d.id || 'Unknown'));
                const docFolios = extractDocumentFolios(d.root, d.foliostart);
                docFolios.forEach(f => folios.add(f));
              }
              this.allPatterns = patterns;
              this.sourceFolios = Array.from(folios);
              this.isLoadingNotation = false;
              this.notationLoaded = true;
              this.cdr.detectChanges();
            }, 0);
          }
        });
      }
    });
  }

  addToSettingsCustom(category: string, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    if (!this.settings.customLists) this.settings.customLists = {};
    if (!this.settings.customLists[category]) this.settings.customLists[category] = [];
    if (!this.settings.customLists[category].includes(val)) {
      this.settings.customLists[category].push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        this.toastr.success(`Added ${val} to ${category}`);
      });
    }
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
    this.toolService.remove(this);
  }

  docHeaders: Header<Document>[] = [];

  get docBatchFields(): BatchField[] {
    return [
      { key: 'textinitium', label: 'Text Initium' },
      { key: 'gattung1', label: 'Genre 1' },
      { key: 'gattung2', label: 'Genre 2' },
      { key: 'festtag', label: 'Feast Day' },
      { key: 'feier', label: 'Celebration' },
      { key: 'foliostart', label: 'Folio Start' },
      { key: 'zeilenstart', label: 'Line Start' },
      { key: 'druckausgabe', label: 'Print Edition' },
      { key: 'bibliographischerverweis', label: 'Bibliographic Ref.' },
      { key: 'editionsstatus', label: 'Edition Status' },
      { key: 'kommentar', label: 'Comment' },
    ];
  }

  updateDocHeaders() {
    this.docHeaders = this.visibleDocCols.map(col => ({
      name: col.label,
      key: col.key as string,
      makeCell: (d: Document) => {
        const text = d[col.key as keyof Document] || '';
        if (col.key === 'gattung1' || col.key === 'gattung2') {
          return { kind: 'badge' as const, text: text.toString() };
        }
        return { kind: 'text' as const, text: text.toString() };
      }
    }));
  }

  onBatchDeleteDocuments(docs: Document[]): void {
    const ids = docs.map(d => d.id).filter((id): id is string => !!id);
    if (ids.length === 0 || !this.user) return;

    this.api.deleteDocuments(this.user.token, JSON.stringify(ids)).subscribe(res => {
      if (res.kind === 'UploadFinished') {
        this.toastr.success(`${ids.length} document(s) successfully deleted.`);
        if (this.source?.id) {
          this.retrieveForId(this.source.id);
        }
      } else {
        this.toastr.error('Error deleting documents.');
      }
    });
  }

  async onBatchEditDocuments(evt: { items: Document[]; key: string; value: string }): Promise<void> {
    if (!this.user || evt.items.length === 0) return;
    let count = 0;
    for (const doc of evt.items) {
      if (!doc.id) continue;
      (doc as any)[evt.key] = evt.value;
      try {
        const existingNotes = await NotesStore.get(doc.id);
        const notes: RootContainer = existingNotes || {
          kind: ContainerKind.RootContainer,
          uuid: doc.id,
          children: [],
          comments: [],
          documentType: 'Antiphon'
        };
        await firstValueFrom(this.api.updateDocument(this.user.token, { document: doc, notes }));
        count++;
      } catch (e) {
        console.warn('Failed to update document:', doc.id, e);
      }
    }
    this.toastr.success(`Updated ${count} document(s).`);
    if (this.source?.id) {
      this.retrieveForId(this.source.id);
    }
  }

  goToDocument(d: Document) {
    this.router.navigate(['/document', d.quelle_id || this.source?.id, d.id]);
  }
}

