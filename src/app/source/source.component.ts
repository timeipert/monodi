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
import { Subscription, combineLatest } from 'rxjs';
import * as S from '../sselect/sselect.component';
import { AnalyzedPattern } from '../transcription-analyzer.service';
import { analyzeDocument, extractDocumentFolios } from '../transcription-analyzer-core';
import { ProjectSettings } from '../api.service';
import { PageTitleService } from '../page-title.service';
import { Header } from '../smart-table/smart-table.component';

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
  styleUrls: ['./source.component.css']
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
    this.subs.push(combineLatest(this.userService.user, this.route.paramMap, (user, params) => ({ user, params })).subscribe(pair => {
      this.user = pair.user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
          }
        });
      }
      const id = pair.params.get("id");
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
          case 'SourceNotFound': this.source = undefined; break;
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
            break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          default: assertNever(res);
        }
      });

      this.api.listDocuments(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'DocumentsRetrieved': this.documents = res.documents.filter(d => d.quelle_id === id); break;
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
    this.switchTab('notation');
  }

  switchTab(tab: 'documents' | 'notation') {
    this.activeTab = tab;
    // Eagerly load notation when switching to notation tab — patterns feed the annotator and viewer
    if (tab === 'notation' && !this.notationLoaded && this.source?.id) {
      this.loadNotation();
    }
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

  updateDocHeaders() {
    this.docHeaders = this.visibleDocCols.map(col => ({
      name: col.label,
      makeCell: (d: Document) => {
        const text = d[col.key as keyof Document] || '';
        if (col.key === 'gattung1' || col.key === 'gattung2') {
          return { kind: 'badge' as const, text: text.toString() };
        }
        return { kind: 'text' as const, text: text.toString() };
      }
    }));
  }

  goToDocument(d: Document) {
    this.router.navigate(['/document', d.quelle_id || this.source?.id, d.id]);
  }
}

