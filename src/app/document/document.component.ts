import { FocusService } from '../focus.service';
import { registerEmbeddedFont, embeddedFamily } from '../pdf-font';
import { ViewChild, ElementRef, Component, OnInit, HostListener, ChangeDetectorRef, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { UserService, User } from '../user.service';
import { APIService, Document, ProjectSettings, Source } from '../api.service';
import { assertNever } from '../../utils';
import { ToolsService } from '../tools.service';
import { ToastrService } from 'ngx-toastr';
import { Subscription, combineLatest } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { parsers } from '../types/parser';
import * as VM from '../types/model';
import * as S from '../sselect/sselect.component';
import { UndoService } from '../undoService';
import { CommentComponent } from '../comment/comment.component';
import { commentColor } from '../comment/comment-colors';
import { getCategoryDetails } from '../comment/comment-categories';
import { getInterventionLabel, INTERVENTIONS } from '../comment/intervention-vocabulary';
import { DragStateService } from '../dragger/drag-state.service';
import { NavigationService } from '../notationsdokumentation/navigation.service';
import { PageTitleService } from '../page-title.service';
import { extractFolioFromString, extractDocumentFolios } from '../transcription-analyzer-core';
import { MeiExportService } from '../mei-export.service';
import { SearchExecService } from '../search/search-exec.service';
import { VolpianoService } from '../volpiano.service';

import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import autoTable from 'jspdf-autotable';
import { sanitizeClefDisplayMode } from '../clef-policy';
import { sanitizeNotationColor } from '../notation-color';
import { layoutPdfLine } from '../pdf-layout';
import { G_CLEF_PATH } from '../clef-glyph';
import { commentLemma, commentStartIndex, commentType } from '../comment-lemma';
import { metadataFieldLabel, metadataFieldValue, headlineText, inlineMetadataItems } from '../document-metadata';
import { minNoteYOf, requiredPadTop } from '../notes/Drawables';
import { PRINT_PDF_DEFAULTS, pdfPageFormat } from '../pdf-defaults';
import { PdfExportService, PdfDocJob } from '../pdf-export.service';
import { PdfHostLauncher } from '../pdf-render-host.component';
import { FileSystemService } from '../file-system.service';

import { SearchReplaceService, SearchMatch, SearchReplaceOptions } from './search-replace.service';

@Component({
    selector: 'app-document',
    templateUrl: './document.component.html',
    styleUrls: ['./document.component.css'],
    standalone: false
})
export class DocumentComponent implements OnInit {
  /** Publish the first syllable's UUID (for the chant-start clef). Called when a
   *  document is loaded — NOT during change detection — so it never mutates state
   *  that a freshly-created child view reads in the same CD pass (NG0100). */
  private setFirstSyllable(): void {
    const sylls = this.cont ? VM.getSyllables(this.cont) : [];
    this.focusService.firstSyllableUuid = sylls.length > 0 ? sylls[0].uuid : null;
    let minY = Infinity;
    for (const sy of sylls) {
      minY = Math.min(minY, minNoteYOf(sy.notes));
      for (const extra of (sy as any).additionalMelodies || []) minY = Math.min(minY, minNoteYOf(extra));
    }
    this.focusService.docPadTop = Number.isFinite(minY) ? requiredPadTop(minY) : 0;
  }

  getCategoryDetails = getCategoryDetails;
  private pdfExport = inject(PdfExportService);
  private pdfHost = inject(PdfHostLauncher);
  getInterventionLabel = getInterventionLabel;
  getInterventionIcon(key: string): string {
    const found = INTERVENTIONS.find(i => i.key === key);
    return found ? found.icon : 'bi-pencil-fill';
  }
  @ViewChild('textImport', { static: true }) textImportModal!: ElementRef;
  @ViewChild('globalComment', { static: true }) globalCommentModal!: ElementRef;
  @ViewChild('searchInputEl') searchInputEl?: ElementRef<HTMLInputElement>;
  subs: Subscription[] = [];
  document: Document | undefined = undefined;
  user: User | null = null;
  private _cont: VM.RootContainer | undefined;
  get cont(): VM.RootContainer | undefined { return this._cont; }
  set cont(v: VM.RootContainer | undefined) {
    this._cont = v;
    if (v) {
      this.dragState.setRootData(v);
      this.applyPendingFocus();
      if (this.isSearchReplaceOpen && this.searchQuery) {
        this.onSearchQueryChange();
      }
    }
  }

  // --- Search & Replace State ---
  isSearchReplaceOpen = false;
  searchQuery = '';
  replaceQuery = '';
  searchScopeSyllables = true;
  searchScopeNotes = true;
  searchScopeParatext = true;
  searchMatchCase = false;
  searchMatchWholeWord = false;
  currentMatches: SearchMatch[] = [];
  currentMatchIndex = -1;

  get matchCountsByScope(): { syllables: number; notes: number; paratext: number } {
    let syllables = 0;
    let notes = 0;
    let paratext = 0;
    for (const m of this.currentMatches) {
      if (m.scope === 'syllables') syllables++;
      else if (m.scope === 'notes') notes++;
      else if (m.scope === 'paratext') paratext++;
    }
    return { syllables, notes, paratext };
  }

  openSearchReplace(): void {
    this.isSearchReplaceOpen = true;
    setTimeout(() => {
      if (this.searchInputEl) {
        this.searchInputEl.nativeElement.focus();
        this.searchInputEl.nativeElement.select();
      }
      this.onSearchQueryChange();
    }, 50);
  }

  closeSearchReplace(): void {
    this.isSearchReplaceOpen = false;
    this.currentMatches = [];
    this.currentMatchIndex = -1;
  }

  toggleSearchReplace(): void {
    if (this.isSearchReplaceOpen) {
      this.closeSearchReplace();
    } else {
      this.openSearchReplace();
    }
  }

  onSearchQueryChange(): void {
    if (!this.cont || !this.searchQuery) {
      this.currentMatches = [];
      this.currentMatchIndex = -1;
      return;
    }

    const opts: SearchReplaceOptions = {
      query: this.searchQuery,
      replaceWith: this.replaceQuery,
      matchCase: this.searchMatchCase,
      matchWholeWord: this.searchMatchWholeWord,
      scope: {
        syllables: this.searchScopeSyllables,
        notes: this.searchScopeNotes,
        paratext: this.searchScopeParatext
      }
    };

    this.currentMatches = this.searchReplaceSvc.findMatches(this.cont, opts);
    if (this.currentMatches.length > 0) {
      if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.currentMatches.length) {
        this.currentMatchIndex = 0;
      }
    } else {
      this.currentMatchIndex = -1;
    }
  }

  nextSearchMatch(): void {
    if (this.currentMatches.length === 0) return;
    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.currentMatches.length;
    this.scrollToCurrentMatch();
  }

  prevSearchMatch(): void {
    if (this.currentMatches.length === 0) return;
    this.currentMatchIndex = (this.currentMatchIndex - 1 + this.currentMatches.length) % this.currentMatches.length;
    this.scrollToCurrentMatch();
  }

  scrollToCurrentMatch(): void {
    if (this.currentMatchIndex < 0 || this.currentMatchIndex >= this.currentMatches.length) return;
    const match = this.currentMatches[this.currentMatchIndex];
    if (match?.targetUuid) {
      try {
        const el = document.querySelector(`[data-uuid="${match.targetUuid}"]`) ||
                   document.getElementById(match.targetUuid);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (e) {
        // ignore scrolling errors
      }
    }
  }

  replaceCurrentMatch(): void {
    if (!this.cont || this.currentMatchIndex < 0 || this.currentMatchIndex >= this.currentMatches.length) return;
    const match = this.currentMatches[this.currentMatchIndex];

    this.undoService.beforeChange();
    const result = this.searchReplaceSvc.replaceSingleMatch(this.cont, match, this.replaceQuery);

    if (result.success) {
      this.cont = JSON.parse(JSON.stringify(this.cont));
      this.save();
      this.cdr.detectChanges();
      this.cdr.markForCheck();
      this.toastr.success('Replaced 1 occurrence.');
      this.onSearchQueryChange();
    } else {
      this.toastr.error(result.error || 'Failed to replace occurrence.');
    }
  }

  replaceAllMatches(): void {
    if (!this.cont || !this.searchQuery) return;

    const opts: SearchReplaceOptions = {
      query: this.searchQuery,
      replaceWith: this.replaceQuery,
      matchCase: this.searchMatchCase,
      matchWholeWord: this.searchMatchWholeWord,
      scope: {
        syllables: this.searchScopeSyllables,
        notes: this.searchScopeNotes,
        paratext: this.searchScopeParatext
      }
    };

    this.undoService.beforeChange();
    const result = this.searchReplaceSvc.replaceAll(this.cont, opts);

    if (result.replacedCount > 0) {
      this.cont = JSON.parse(JSON.stringify(this.cont));
      this.save();
      this.cdr.detectChanges();
      this.cdr.markForCheck();
      this.toastr.success(`Replaced ${result.replacedCount} occurrence(s).`);
      this.onSearchQueryChange();
    } else {
      this.toastr.info('No occurrences found to replace.');
    }

    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        this.toastr.warning(err);
      }
    }
  }

  pendingFocusNoteUuid: string | null = null;

  findSyllableUuidForNoteUuid(root: VM.RootContainer, noteUuid: string): string | null {
    let foundSyllableUuid: string | null = null;
    const traverse = (node: any) => {
      if (foundSyllableUuid) return;
      if (!node) return;
      if (node.kind === 'Syllable') {
        if (node.notes && node.notes.spaced) {
          for (const spacedItem of node.notes.spaced) {
            if (spacedItem.nonSpaced) {
              for (const ns of spacedItem.nonSpaced) {
                if (ns.grouped) {
                  for (const g of ns.grouped) {
                    if (g.uuid === noteUuid) {
                      foundSyllableUuid = node.uuid;
                      return;
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
      if (node.parts && Array.isArray(node.parts)) {
        for (const part of node.parts) {
          traverse(part);
        }
      }
    };
    traverse(root);
    return foundSyllableUuid;
  }

  applyPendingFocus() {
    if (!this.pendingFocusNoteUuid || !this._cont) return;
    const noteUuid = this.pendingFocusNoteUuid;
    const syllableUuid = this.findSyllableUuidForNoteUuid(this._cont, noteUuid);
    if (syllableUuid) {
      this.pendingFocusNoteUuid = null;
      setTimeout(() => {
        const el = document.querySelector(`[data-uuid="${syllableUuid}"]`) as HTMLElement;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const originalBg = el.style.backgroundColor;
          const originalShadow = el.style.boxShadow;
          const originalTransition = el.style.transition;
          el.style.transition = 'all 0.5s ease';
          el.style.backgroundColor = '#fef08a';
          el.style.boxShadow = '0 0 15px #fde047';
          setTimeout(() => {
            el.style.backgroundColor = originalBg;
            el.style.boxShadow = originalShadow;
            setTimeout(() => {
              el.style.transition = originalTransition;
            }, 500);
          }, 2000);
          this.focusService.focusedNoteUUID = noteUuid;
        }
      }, 500);
    }
  }
  readOnly: boolean = false;
  collapseMetadata: boolean = true;
  sourceSigle: string | undefined;
  documentJsonClone: string | undefined = undefined;
  contJsonClone: string | undefined = undefined;
  textImportErrors: Array<string> = [];
  settings: ProjectSettings | null = null;
  sourceData: Source | null = null;
  viewMode: 'transcription' | 'split' | 'iiif' = 'transcription';
  get splitScreen(): boolean { return this.viewMode === 'split'; }
  splitLeftWidth = 45;
  isDraggingSplitter = false;
  isSaving = false;
  /** True if a save was requested while an HTTP request was already ongoing */
  private savePending = false;
  sidebarTab: 'metadata' | 'comments' | 'structure' = 'metadata';
  activeSidebarComment: VM.Comment | null = null;
  activeSidebarOriginal: VM.ZeileContainer | null = null;

  sidebarVisible = true;

  /** Whether the inline "How to add a comment" help card is collapsed.
   *  Persisted in localStorage so a user only sees the verbose card once. */
  commentHelpDismissed: boolean = (() => {
    try { return localStorage.getItem('monodi_comment_help_dismissed') === '1'; }
    catch { return false; }
  })();

  dismissCommentHelp(): void {
    this.commentHelpDismissed = true;
    try { localStorage.setItem('monodi_comment_help_dismissed', '1'); } catch {}
  }

  reopenCommentHelp(): void {
    this.commentHelpDismissed = false;
    try { localStorage.removeItem('monodi_comment_help_dismissed'); } catch {}
  }

  // ── IIIF split-screen two-way connection ──────────────────────────────────
  /** UUID of the line-change last clicked; passed to IIIF viewer to highlight the linked region. */
  highlightedLineUUID = '';
  /** When true the user just clicked a region's "Link" button — next line-change click links them. */
  isLinkingMode = false;
  linkModeRegionId = '';
  linkModeRegionName = '';
  
  /** Dynamic folio index to pass to IIIF viewer to snap to the correct page */
  currentFolioIndex: number | undefined;

  /** Folios present in the current document (extracted during line mapping) */
  documentFolios: string[] = [];

  /** Name of the region corresponding to the active line. */
  activeLineName?: string;
  /** Maps LineChange UUID to { folio, lineName } */
  lineMap: Map<string, { folio: string, lineName: string }> = new Map();
  /** Maps `${folio}_${lineName}` to LineChange UUID */
  regionToLineMap: Map<string, string> = new Map();

  /** Stable empty array — never pass `[]` literals as @Input to avoid a new reference every CD cycle. */
  readonly emptyArray: any[] = [];

  showPdfExportDialog = false;
  printIncludeMetadata = true;
  printTitlePage = true;
  printApparatus = true;
  isPrinting = false;

  showSecondVoiceImportDialog = false;
  detectedSecondVoiceCommentCount = 0;

  importText: string = '';
  importType: keyof typeof parsers = "Misc";
  importTypes = Object.keys(parsers);
  fixDashesOnImport = true;

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private undoService: UndoService,
    private route: ActivatedRoute,
    private toastr: ToastrService,
    private modalService: NgbModal,
    private location: Location,
    private toolService: ToolsService,
    public dragState: DragStateService,
    private navService: NavigationService,
    private meiExport: MeiExportService,
    private volpiano: VolpianoService,
    private pageTitle: PageTitleService, public focusService: FocusService,
    public searchExecSvc: SearchExecService,
    private searchReplaceSvc: SearchReplaceService,
    private cdr: ChangeDetectorRef,
    private fsService: FileSystemService) {
  }

  get activeHighlight() {
    const h = this.searchExecSvc.activeDocumentHighlight;
    if (h && this.document && h.documentId === this.document.id) {
      return h;
    }
    return null;
  }

  clearHighlights(): void {
    this.searchExecSvc.clearDocumentHighlight();
  }

  documentTypes = [
    { value: 'Level0', label: '0' },
    { value: 'Level1', label: '1' },
    { value: 'Level2', label: '2' },
    { value: 'Level3', label: '3' }
  ];

  getStructureTree(): Array<{ zipper: number[], label: string, kind: string, depth: number, icon: string }> {
    if (!this.cont) return [];
    const items: any[] = [];
    const traverse = (node: any, zipper: number[], depth: number) => {
      const isContainer = [
        'FormteilContainer',
        'ZeileContainer',
        'ParatextContainer',
        'MiscContainer'
      ].includes(node.kind);

      if (!isContainer && zipper.length > 0) {
        return;
      }

      if (zipper.length > 0) {
        let label = '';
        let icon = '';
        if (node.kind === 'FormteilContainer') {
          const sig = (node.data || []).find((d: any) => d.name === 'Signatur')?.data;
          const ti  = (node.data || []).find((d: any) => d.name === 'LemmatisiertesTextInitium')?.data;
          label = sig || (ti ? ti.slice(0, 15) : '') || 'Section';
          icon = '📁';
        } else if (node.kind === 'ZeileContainer') {
          const syllables = (node.children || []).filter((c: any) => c.kind === 'Syllable');
          let text = '';
          syllables.forEach((s: any) => {
            const t = (s.text || '').trim();
            if (!t) return;
            if (text.length > 0 && !text.endsWith('-')) {
              text += ' ';
            }
            text += t;
          });
          label = text ? (text.slice(0, 20) + (text.length > 20 ? '...' : '')) : 'Line';
          icon = '♩';
        } else if (node.kind === 'ParatextContainer') {
          label = (node.text || '').trim().slice(0, 15) || node.paratextType || 'Text';
          icon = '¶';
        } else if (node.kind === 'MiscContainer') {
          label = 'Misc';
          icon = '…';
        }
        items.push({ zipper, label, kind: node.kind, depth, icon });
      }
      if (node.children) {
        node.children.forEach((child: any, idx: number) => {
          traverse(child, [...zipper, idx], depth + 1);
        });
      }
    };
    traverse(this.cont, [], -1);
    return items;
  }

  renameContainer(zipper: number[], newName: string): void {
    if (!this.cont) return;
    this.undoService.beforeChange();
    const node = VM.resolve(this.cont, zipper) as any;
    if (node && node.kind === 'FormteilContainer') {
      if (!node.data) node.data = [];
      let sig = node.data.find((d: any) => d.name === 'Signatur');
      if (sig) {
        sig.data = newName;
      } else {
        node.data.push({ name: 'Signatur', data: newName });
      }
      this.save();
      this.cont = { ...this.cont };
    }
  }

  onStructureDragStart(ev: DragEvent, zipper: number[]): void {
    ev.dataTransfer!.setData('text/plain', JSON.stringify(zipper));
    ev.dataTransfer!.dropEffect = 'move';
    setTimeout(() => {
      this.dragState.startDrag(zipper);
    }, 0);
  }

  onStructureDragEnd(ev: DragEvent): void {
    this.dragState.endDrag();
  }

  onStructureDragEnter(ev: DragEvent, zipper: number[]): void {
    if (this.dragState.isValidTarget(zipper)) {
      this.dragState.setHovered(zipper);
    }
  }

  onStructureDragOver(ev: DragEvent): void {
    ev.preventDefault();
  }

  onStructureDragLeave(ev: DragEvent, zipper: number[]): void {
    if (this.dragState.hoveredZipper && this.dragState.zippersEqual(this.dragState.hoveredZipper, zipper)) {
      this.dragState.setHovered(null);
    }
  }

  onStructureDrop(ev: DragEvent, zipper: number[]): void {
    ev.preventDefault();
    if (!this.cont) return;
    if (this.dragState.isValidTarget(zipper)) {
      try {
        const from = JSON.parse(ev.dataTransfer!.getData('text/plain'));
        this.undoService.beforeChange();
        const errorMessage = VM.move(this.cont, from, zipper);
        if (errorMessage !== undefined) {
          this.toastr.error(errorMessage);
        } else {
          this.save();
          this.cont = { ...this.cont };
        }
      } catch (err) {
        console.error('Drop failed:', err);
      }
    }
    this.dragState.endDrag();
  }

  canMergeContainer(zipper: number[]): boolean {
    if (!this.cont) return false;
    const parentZipper = zipper.slice(0, -1);
    const index = zipper[zipper.length - 1];
    const parent = VM.resolve(this.cont, parentZipper) as any;
    if (!parent || !parent.children) return false;
    const nextChild = parent.children[index + 1];
    return nextChild && nextChild.kind === 'FormteilContainer';
  }

  mergeContainerWithNext(zipper: number[]): void {
    if (!this.cont) return;
    this.undoService.beforeChange();
    const parentZipper = zipper.slice(0, -1);
    const index = zipper[zipper.length - 1];
    const parent = VM.resolve(this.cont, parentZipper) as any;
    if (parent && parent.children) {
      const current = parent.children[index];
      const next = parent.children[index + 1];
      if (current && next && current.kind === 'FormteilContainer' && next.kind === 'FormteilContainer') {
        current.children.push(...next.children);
        parent.children.splice(index + 1, 1);
        this.save();
        this.cont = { ...this.cont };
      }
    }
  }

  canDeleteContainer(zipper: number[]): boolean {
    if (!this.cont) return false;
    const parentZipper = zipper.slice(0, -1);
    const parent = VM.resolve(this.cont, parentZipper) as any;
    if (!parent || !parent.children) return false;
    const formteilCount = parent.children.filter((c: any) => c.kind === 'FormteilContainer').length;
    return formteilCount > 1;
  }

  deleteContainerAt(zipper: number[]): void {
    if (!this.cont) return;
    if (!this.canDeleteContainer(zipper)) {
      this.toastr.warning("This section cannot be deleted because it is the only one at this level.");
      return;
    }
    this.undoService.beforeChange();
    const parentZipper = zipper.slice(0, -1);
    const index = zipper[zipper.length - 1];
    const parent = VM.resolve(this.cont, parentZipper) as any;
    if (parent && parent.children) {
      const node = parent.children[index];
      if (node) {
        if (node.children && node.children.length > 0) {
          parent.children.splice(index, 1, ...node.children);
        } else {
          parent.children.splice(index, 1);
        }
        this.save();
        this.cont = { ...this.cont };
      }
    }
  }

  splitContainerAt(zipper: number[]): void {
    if (!this.cont) return;
    this.undoService.beforeChange();
    const parentZipper = zipper.slice(0, -1);
    const index = zipper[zipper.length - 1];
    const parent = VM.resolve(this.cont, parentZipper) as any;
    if (parent && parent.children) {
      const itemsToMove = parent.children.slice(index);
      parent.children.length = index;
      const grandParentZipper = parentZipper.slice(0, -1);
      const parentIndex = parentZipper[parentZipper.length - 1];
      const grandParent = VM.resolve(this.cont, grandParentZipper) as any;
      if (grandParent && grandParent.children) {
        const newFormteil = VM.emptyFormteilContainer(this.cont.documentType, []);
        newFormteil.children = itemsToMove;
        grandParent.children.splice(parentIndex + 1, 0, newFormteil);
        this.save();
        this.cont = { ...this.cont };
      }
    }
  }

  setDocumentType(value: string): void {
    if (!this.cont) return;
    this.undoService.beforeChange();
    this.cont.documentType = value as VM.DocumentType;
    VM.changeDocumentStructure(this.cont, this.cont.documentType);
    this.save();
    this.cont = { ...this.cont };
  }


  test() {
    this.undoService.undo();
  }

  toggleReadOnly() {
    this.readOnly = !this.readOnly;
  }

  setViewMode(mode: 'transcription' | 'split' | 'iiif', updateRoute = true) {
    this.viewMode = mode;
    if (mode === 'split' || mode === 'iiif') {
      this.sidebarVisible = false;
      this.buildLineMap();
    }
    // Reset link state when changing views
    this.activeLineName = undefined;
    this.isLinkingMode = false;
    this.highlightedLineUUID = '';
    this.updateToolbar();

    if (updateRoute) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { view: mode },
        queryParamsHandling: 'merge'
      });
    }
  }

  /** Switch the right-hand sidebar tab and keep it in the URL (?stab=) so a
   *  reload returns to the same panel. */
  setSidebarTab(tab: 'metadata' | 'structure' | 'comments') {
    this.sidebarTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { stab: tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Receives events bubbled up from app-root-section (via the Section base class onEvent output). */
  handleRootEvent(e: any): void {
    if (e.kind === 'FixSyllableDashesRequested') {
      this.undoService.beforeChange();
      if (this.cont) {
        VM.fixSyllableDashes(this.cont);
        this.save();
        this.cont = { ...this.cont } as VM.RootContainer;
      }
      this.toastr.success("Syllable hyphens corrected.");
      return;
    }
    if (e.kind === 'DocumentUpdated') {
      this.save();
      if (this.cont) {
        this.cont = { ...this.cont } as VM.RootContainer;
      }
      return;
    }
    if (e.kind === 'OpenCommentModalRequested') {
      this.openComment(e.comment);
      return;
    }
    if (e.kind === 'HighlightRegionRequested') {
      if (this.isLinkingMode && this.linkModeRegionId && this.sourceData) {
        // Link mode: bind the clicked line UUID to the pending region
        const region = (this.sourceData.annotationRegions ?? []).find(r => r.id === this.linkModeRegionId);
        if (region) {
          region.lineUUID = e.uuid;
          this.saveSourceData();
          this.toastr.success(`"${this.linkModeRegionName}" linked to the selected line`);
        }
        this.isLinkingMode = false;
        this.linkModeRegionId = '';
        this.linkModeRegionName = '';
        // Also highlight the newly-linked region
        this.highlightedLineUUID = e.uuid;
      } else {
        // Normal mode: highlight the region linked to this line UUID
        this.highlightedLineUUID = e.uuid;
        
        // Implicit mapping: if the explicit UUID mapping in iiif-viewer fails, we provide activeLineName as fallback
        this.buildLineMap(); // Ensure map is up-to-date
        const mapped = this.lineMap.get(e.uuid);
        if (mapped) {
          this.activeLineName = mapped.lineName;
          
          if (mapped.folio !== undefined && !isNaN(parseInt(mapped.folio, 10))) {
            this.currentFolioIndex = parseInt(mapped.folio, 10);
          }
          
          // Optional: we can force the IIIF viewer to navigate to the folio if needed
          if (this.sourceData && this.sourceData.id) {
            // this.navService.openIiifViewerForFolio(this.sourceData.id, mapped.folio);
          }
        } else {
          this.activeLineName = undefined;
        }
      }
    }
  }

  /** Called right before a change in the IIIF viewer happens, to register an undo state */
  handleIiifBeforeChange(): void {
    this.undoService.beforeChange('IIIF Annotation Change');
  }

  /** Called when the IIIF viewer emits requestLineLink — user clicked "Link" on a region. */
  handleIiifRequestLineLink(data: { regionId: string; regionName: string }): void {
    this.isLinkingMode = true;
    this.linkModeRegionId = data.regionId;
    this.linkModeRegionName = data.regionName;
    this.toastr.info(`Now click a line-change in the transcription to link it to "${data.regionName}"`, '', { timeOut: 8000 });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target && !target.closest('.content-row')) {
      this.focusService.focusedContainerUUID = undefined;
    }
  }

  /** Builds a map of line-changes to their implicit region names based on DOM order. */
  private buildLineMap(): void {
    this.lineMap.clear();
    this.regionToLineMap.clear();
    if (!this.cont) return;

    let currentFolio = this.document?.foliostart || "1";
    let currentLine = 1;

    const traverse = (node: any) => {
      if (!node || !node.kind) return;

      const oldFolio = currentFolio;

      if (node.kind === VM.LinePartKind.FolioChange) {
        currentFolio = node.text || currentFolio;
      } else if (node.kind === VM.ContainerKind.ParatextContainer) {
        if (node.text && node.text.includes('|')) {
          currentLine += (node.text.match(/\|/g) || []).length;
        }
        const extracted = extractFolioFromString(node.text || '');
        if (extracted) {
          currentFolio = extracted;
        }
      }

      if (node.kind === VM.LinePartKind.FolioChange || currentFolio !== oldFolio) {
        currentLine = 1;
      }

      if (node.kind === VM.LinePartKind.LineChange) {
        const lineName = currentLine.toString();
        this.lineMap.set(node.uuid, { folio: currentFolio, lineName });
        this.regionToLineMap.set(`${currentFolio}_${lineName}`, node.uuid);
        currentLine++;
      }

      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          traverse(child);
        }
      }
      if (node.parts && Array.isArray(node.parts)) {
        for (const part of node.parts) {
          traverse(part);
        }
      }
    };

    traverse(this.cont);
    this.documentFolios = extractDocumentFolios(this.cont, this.document?.foliostart);
  }

  /** Called when the user clicks a region in the IIIF viewer (simpleMode).
   *  If the region has a lineUUID, try to scroll to that line in the DOM. */
  handleIiifRegionClicked(data: { name: string, folio: string, lineUUID?: string }): void {
    let targetUUID = data.lineUUID;

    // Implicit fallback: if not explicitly linked, try to map from region name
    if (!targetUUID) {
      this.buildLineMap();
      targetUUID = this.regionToLineMap.get(`${data.folio}_${data.name}`);
    }

    if (targetUUID) {
      // Try to scroll the transcription to the element with that UUID
      const el = document.querySelector(`[data-uuid="${targetUUID}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Optionally flash the element
        (el as HTMLElement).style.transition = 'background-color 0.5s';
        (el as HTMLElement).style.backgroundColor = '#fff3cd';
        setTimeout(() => (el as HTMLElement).style.backgroundColor = '', 1500);
      }
    }
  }

  get initialFolioIndex(): number | undefined {
    if (this.document && this.document.foliostart) {
      const idx = parseInt(this.document.foliostart, 10);
      return isNaN(idx) ? undefined : idx;
    }
    return undefined;
  }

  saveSourceData() {
    if (this.user && this.sourceData) {
      this.api.updateSource(this.user.token, this.sourceData).subscribe(res => {
        if (res.kind === 'Ok') {
          // this.toastr.success('Source annotations saved successfully');
        } else {
          this.toastr.error('Failed to save source annotations');
        }
      });
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isDraggingSplitter) return;
    const container = document.getElementById('split-screen-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      let newWidth = ((event.clientX - rect.left) / rect.width) * 100;
      if (newWidth < 20) newWidth = 20;
      if (newWidth > 80) newWidth = 80;
      this.splitLeftWidth = newWidth;
      // Prevent text selection while dragging
      event.preventDefault();
    }
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isDraggingSplitter) {
      this.isDraggingSplitter = false;
      document.body.style.cursor = 'default';
    }
  }

  startSplitDrag(event: MouseEvent) {
    this.isDraggingSplitter = true;
    document.body.style.cursor = 'col-resize';
    event.preventDefault();
  }

  openPdfExport() {
    try {
      const o = JSON.parse(localStorage.getItem('monodi_pdf_export_options') || 'null');
      if (o) {
        this.printTitlePage = o.titlePage ?? this.printTitlePage;
        this.printIncludeMetadata = o.metadata ?? this.printIncludeMetadata;
        this.printApparatus = o.apparatus ?? this.printApparatus;
      }
    } catch { /* no stored choice */ }
    this.showPdfExportDialog = true;
  }

  private rememberPdfExportOptions(): void {
    try {
      localStorage.setItem('monodi_pdf_export_options', JSON.stringify({
        titlePage: this.printTitlePage, metadata: this.printIncludeMetadata, apparatus: this.printApparatus,
      }));
    } catch { /* storage unavailable */ }
  }

  // ── Citation suggestions ────────────────────────────────────────────────────
  showCiteDialog = false;

  private citationBits(): { title: string; qualifier: string; source: string; id: string; url: string; date: string; year: string } {
    const d: any = this.document || {};
    const title = (d.textinitium || d.dokumenten_id || 'Chant').toString().trim();
    const genre = (d.gattung1 || '').toString().trim();
    const feast = (d.festtag || '').toString().trim();
    const qualifier = [genre, feast].filter(Boolean).join(', ');
    const sigle = (this.sourceSigle || '').toString().trim();
    const id = (d.dokumenten_id || '').toString().trim();
    const source = [sigle, id].filter(Boolean).join(', ');
    const url = (typeof window !== 'undefined' ? window.location.href.split('#')[0] : 'https://monodi.app');
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    return { title, qualifier, source, id, url, date, year: String(now.getFullYear()) };
  }

  /** A plain, copyable citation suggestion. */
  citationText(): string {
    const b = this.citationBits();
    const q = b.qualifier ? ` (${b.qualifier})` : '';
    const src = b.source ? ` Source: ${b.source}.` : '';
    return `${b.title}${q}.${src} Corpus Monodicum, transcribed with monodi-zero. Retrieved ${b.date} from ${b.url}.`;
  }

  /** A BibTeX @misc entry for the same edition. */
  citationBibtex(): string {
    const b = this.citationBits();
    const key = 'monodizero_' + (b.id || b.title).replace(/[^A-Za-z0-9]+/g, '').slice(0, 32).toLowerCase();
    const note = [b.source ? `Source ${b.source}` : '', b.qualifier].filter(Boolean).join('; ');
    return [
      `@misc{${key},`,
      `  author       = {{Corpus Monodicum}},`,
      `  title        = {${b.title}},`,
      `  howpublished = {Corpus Monodicum; transcribed with monodi-zero},`,
      note ? `  note         = {${note}},` : '',
      `  year         = {${b.year}},`,
      `  url          = {${b.url}},`,
      `  urldate      = {${b.date}}`,
      `}`,
    ].filter(Boolean).join('\n');
  }

  copyCitation(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => this.toastr.success('Citation copied to clipboard.'),
        () => this.toastr.error('Could not copy to clipboard.')
      );
    }
  }

  getMetadataFieldLabel(key: string): string { return metadataFieldLabel(key, this.settings); }

  getMetadataFieldValue(key: string): string { return metadataFieldValue(this.document, key); }

  buildHeadlineText(fields: string[]): string { return headlineText(this.document, fields, this.settings); }

  get currentLevelNames(): any {
    if (!this.settings || !this.settings.genreLevelProfiles || !this.document) return null;
    const g1 = this.document.gattung1 || '';
    const g2 = this.document.gattung2 || '';
    let profile = this.settings.genreLevelProfiles.find((p: any) => p.gattung1 === g1 && p.gattung2 === g2);
    if (!profile) profile = this.settings.genreLevelProfiles.find((p: any) => p.gattung1 === g1 && (!p.gattung2 || p.gattung2 === '*'));
    if (!profile) profile = this.settings.genreLevelProfiles.find((p: any) => (!p.gattung1 || p.gattung1 === '*') && (!p.gattung2 || p.gattung2 === '*'));
    return profile ? profile.names : null;
  }

  /** Counters of the last PDF export (read by the e2e checks). */
  get lastPdfStats() { return this.pdfExport.lastStats; }

  /** Prints this document through the shared exporter (see PdfExportService). */
  async confirmPdfExport() {
    this.rememberPdfExportOptions();
    this.showPdfExportDialog = false;
    if (!this.document || !this.cont) return;
    this.isPrinting = true;
    try {
      this.pdfHost.ensure();
      const job: PdfDocJob = { document: this.document, cont: this.cont, source: this.sourceData, sigle: this.sourceSigle || '' };
      await this.pdfExport.exportDocuments([job], {
        settings: this.settings,
        titlePage: this.printTitlePage,
        includeMetadata: this.printIncludeMetadata,
        apparatus: this.printApparatus,
      });
    } catch (err) {
      console.error('PDF Generation failed:', err);
      this.toastr.error('Failed to generate PDF.', 'Error');
    } finally {
      this.isPrinting = false;
    }
  }

  /**
   * The text a comment's brackets frame (the apparatus cites it instead of a number):
   * the lyrics from the start to the end syllable, word-joined by dropping hyphens.
   */
  getCommentLemma(comment: VM.Comment): string {
    return this.cont ? commentLemma(VM.getAllLineParts(this.cont), comment) : '';
  }

  getInlineMetadataItems(): { label: string, val: string }[] { return inlineMetadataItems(this.document, this.settings); }

  recalcId(): void {
    if (this.sourceSigle && this.document) {
      this.document.dokumenten_id = [this.sourceSigle, this.document.foliostart, this.document.zeilenstart].join('-');
    }
  }

  getJsonString = (): string | undefined => {
    if (this.cont) {
      return JSON.stringify({
        cont: this.cont,
        sourceAnnotations: this.sourceData ? {
          annotationRegions: this.sourceData.annotationRegions,
          annotationItems: this.sourceData.annotationItems,
          transcriptionAnnotations: this.sourceData.transcriptionAnnotations
        } : undefined
      });
    }
    return undefined;
  }

  undoChanges = (jsonString: string): void => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && parsed.cont) {
        this.cont = parsed.cont;
        if (this.sourceData && parsed.sourceAnnotations) {
          this.sourceData.annotationRegions = parsed.sourceAnnotations.annotationRegions;
          this.sourceData.annotationItems = parsed.sourceAnnotations.annotationItems;
          this.sourceData.transcriptionAnnotations = parsed.sourceAnnotations.transcriptionAnnotations;
          // Note: not saving to API immediately on undo, the user might save later or we can call saveSourceData
          this.saveSourceData();
        }
      } else if (parsed) {
        // Fallback for old history that only had the container object
        this.cont = parsed;
      }
    } catch (e) {
      console.error("Error parsing undo history", e);
    }
  }

  ngOnInit(): void {
    this.undoService.registerUnDo(this.getJsonString, this.undoChanges);
    this.undoService.registerAutosave(() => {
      this.save();
    });
    this.subs.push(combineLatest([this.userService.user, this.route.paramMap]).subscribe(([user, params]) => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
            this.focusService.clefDisplayMode = sanitizeClefDisplayMode(res.settings?.clefDisplayMode);
            this.focusService.notationColor = sanitizeNotationColor(res.settings?.notationColor);
          }
        });
      }
      const source = (params.get('source') as string);
      const id = params.get('id');
      this.setSourceSigle(source);
      
      if (this.user) {
        this.api.getSource(this.user.token, source).subscribe(res => {
          if (res.kind === 'SourceRetrieved') {
            this.sourceData = res.source;
            this.updateToolbar();
          }
        });
      }

      if (id !== null) {
        this.retrieveForId(id);
      } else {
        this.pageTitle.set('New Document', 'Editing');
        this.collapseMetadata = false;
        this.document = {
          id: '',
          quelle_id: source,
          dokumenten_id: '',
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
          custom: {}
        };
        this.cont = VM.emptyRootContainer();
        this.currentFolioIndex = this.initialFolioIndex;
      }
      this.setFirstSyllable();

      setTimeout(() => {
        this.updateToolbar();
      }, 0);
    }));
    
    // Subscribe to query params to restore view mode
    this.subs.push(this.route.queryParams.subscribe(params => {
      if (params['view'] && ['transcription', 'split', 'iiif'].includes(params['view'])) {
        this.setViewMode(params['view'] as any, false);
      }
      if (params['stab'] && ['metadata', 'structure', 'comments'].includes(params['stab'])) {
        this.sidebarTab = params['stab'];
      }
      if (params['focus']) {
        this.pendingFocusNoteUuid = params['focus'];
        this.applyPendingFocus();
      }
    }));
  }

  updateToolbar() {
    // A deferred setTimeout can fire after the component is torn down (e.g. in
    // tests), when the injected route/snapshot is no longer available — guard it.
    const source = this.route?.snapshot?.paramMap?.get('source') || '';
    
    // Tools logic
    const tools: any[] = [
      {
        callback: () => { this.goToSource(source); },
        icon: 'to-source',
        title: 'Back to Source'
      }
    ];

    // Add view buttons if IIIF exists
    if (this.sourceData?.iiifManifestUrl) {
      tools.push(
        {
          callback: () => { this.setViewMode('iiif'); },
          icon: 'image',
          title: 'Scan Only',
          active: this.viewMode === 'iiif'
        },
        {
          callback: () => { this.setViewMode('split'); },
          icon: 'layout-split',
          title: 'Split View',
          active: this.viewMode === 'split'
        },
        {
          callback: () => { this.setViewMode('transcription'); },
          icon: 'music-note-list',
          title: 'Transcription Only',
          active: this.viewMode === 'transcription'
        }
      );
    }

    // Standard buttons
    tools.push(
      {
        callback: () => { this.upload(); },
        icon: 'upload',
        title: 'Upload Document'
      },
      {
        callback: () => { this.openJsonExport(); },
        icon: 'download',
        title: 'Export Document'
      },
      {
        callback: () => { this.openPdfExport(); },
        icon: 'file-pdf',
        title: 'Export as PDF'
      },
      {
        callback: () => { if (this.cont) this.meiExport.exportAndDownload(this.cont, (this.document?.dokumenten_id || 'document') + '.mei', this.settings, this.document, this.sourceSigle); },
        icon: 'mei',
        title: 'Export MEI'
      },
      {
        callback: () => { this.exportVolpiano(); },
        icon: 'music-note-beamed',
        title: 'Export Volpiano'
      },
      {
        callback: () => { this.toggleReadOnly(); },
        icon: 'eye',
        title: 'Toggle Read-Only Mode'
      },
      {
        callback: () => { this.modalService.open(this.textImportModal); },
        icon: 'file-earmark-text',
        title: 'Import Text'
      },
      {
        callback: () => {
          this.undoService.beforeChange();
          if (this.cont) {
            VM.fixSyllableDashes(this.cont);
            this.save();
            this.cont = { ...this.cont } as VM.RootContainer;
          }
          this.toastr.success("Syllable hyphens corrected.");
        },
        icon: 'type-strikethrough',
        title: 'Fix Syllable Dashes'
      },
      {
        callback: () => { this.toggleSearchReplace(); },
        icon: 'search',
        title: 'Search and Replace (Ctrl+H)',
        active: this.isSearchReplaceOpen
      },
      {
        callback: () => { this.modalService.open(this.globalCommentModal, { size: 'xl', fullscreen: true }); },
        icon: 'chat-left-text',
        title: 'Edit Global Comment'
      }
    );

    // Update stack
    this.toolService.remove(this);
    this.toolService.addStack({
      source: this,
      tools: tools
    });
  }

  goToSource(s_id: string) {
    this.router.navigate(['/source', s_id]);
  }

  retrieveForId(id: string): void {
    if (this.user) {
      this.api.getDocument(this.user.token, id).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          case 'DocumentNotFound': this.document = undefined; break;
          case 'DocumentRetrieved':
            this.document = res.document;
            if (!this.document.custom) this.document.custom = {};
            if (this.document) {
              this.documentJsonClone = JSON.stringify(this.document);
              this.currentFolioIndex = this.initialFolioIndex;
              this.pageTitle.set(
                this.document.textinitium || this.document.dokumenten_id || 'Document',
                this.sourceSigle || undefined,
                'Editing'
              );
              try {
                const recentDocsRaw = localStorage.getItem('monodi_recent_documents');
                let recentDocs: any[] = recentDocsRaw ? JSON.parse(recentDocsRaw) : [];
                recentDocs = recentDocs.filter((d: any) => d.id !== res.document.id);
                recentDocs.unshift({
                  id: res.document.id,
                  quelle_id: res.document.quelle_id,
                  textinitium: res.document.textinitium || '',
                  dokumenten_id: res.document.dokumenten_id || '',
                  timestamp: new Date().toISOString()
                });
                recentDocs = recentDocs.slice(0, 8);
                localStorage.setItem('monodi_recent_documents', JSON.stringify(recentDocs));
              } catch (recentErr) {
                console.warn('Failed to save recent document:', recentErr);
              }
            }
            break;
          default: assertNever(res);
        }
      });
      this.api.getDocumentNotes(this.user.token, id).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          case 'DocumentNotFound':
            // Notes are missing — this is NOT the same as "document
            // missing". A freshly-imported document whose notes write
            // failed, or an old-format doc with no notes row yet, should
            // still open as an empty edition rather than reverting to
            // "loading…". Previously we set `this.document = undefined`
            // here, which made imported docs look permanently broken.
            this.cont = VM.emptyRootContainer();
            this.contJsonClone = JSON.stringify(this.cont);
            this.setFirstSyllable();
            this.toastr.warning(
              'No transcription data was found for this document. Starting from an empty edition — re-import to restore the original notes.',
              'Notes missing'
            );
            break;
          case 'NotesRetrieved':
            this.cont = VM.normalizeDocumentComments(res.data);
            this.contJsonClone = JSON.stringify(this.cont);
            this.checkSecondVoiceComments(this.cont);
            this.setFirstSyllable();
            break;
          default: assertNever(res);
        }
      });
    }
  }

  setSourceSigle(sourceId: string): void {
    if (this.user) {
      this.api.getSigle(this.user.token, sourceId).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourceNotFound': this.sourceSigle = ''; break;
          case 'SigleRetrieved': this.sourceSigle = res.sigle; break;
          default: assertNever(res);
        }
        this.recalcId();
      });
    }
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

  save(): void {
    if (this.document) {
      if (this.document.id) {
        this.update();
      } else {
        this.create();
      }
    }
  }

  create(): void {
    const doc = this.document;
    const cont = this.cont;
    if (this.user && doc && cont) {
      if (this.isSaving) {
        this.savePending = true;
        return;
      }
      this.isSaving = true;
      this.api.createDocument(this.user.token, { document: doc, notes: cont }).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'DocumentCreated': 
            this.toastr.success("Saved successfully");
            this.document!.id = res.id;
            this.location.replaceState('/document/' + doc.quelle_id + '/' + res.id); 
            break;
          default: assertNever(res);
        }
        if (this.savePending) {
          this.savePending = false;
          this.save();
        }
      });
    }
  }

  update(): void {
    if (this.user && this.document && this.document.id && this.cont) {
      if (this.isSaving) {
        this.savePending = true;
        return;
      }
      this.isSaving = true;
      this.api.updateDocument(this.user.token, { document: this.document, notes: this.cont }).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'Ok': 
            // Removed toastr to prevent spamming on autosave
            this.resetClones(); 
            break;
          case 'DocumentNotFound': this.toastr.error("It looks like this document was deleted in the meantime."); break;
          case 'InsufficientPermissions': this.toastr.error("You don't have permission to save this document. You can download it as JSON, request access, then re-upload it to avoid losing data.", "Save failed."); break;
          default: assertNever(res);
        }
        if (this.savePending) {
          this.savePending = false;
          this.save();
        }
      });
    }
  }

  showJsonExportDialog = false;
  exportJsonMode: 'none' | 'comment' | 'consecutive_lines' | 'split_documents' = 'none';

  openJsonExport(): void {
    this.showJsonExportDialog = true;
  }

  /** Export the current document as a Volpiano string: download a .txt and copy to clipboard. */
  exportVolpiano(): void {
    if (!this.cont) {
      this.toastr.error('No document open to export.');
      return;
    }
    try {
      const baseId = (this.document && this.document.dokumenten_id) ? this.document.dokumenten_id : 'document';
      const result = this.volpiano.exportAndDownload(this.cont, baseId + '.volpiano.txt');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(result.volpiano).then(
          () => this.toastr.success('Volpiano copied to clipboard and downloaded as .txt.'),
          () => this.toastr.success('Volpiano downloaded as .txt.')
        );
      } else {
        this.toastr.success('Volpiano downloaded as .txt.');
      }
      if (result.warnings.length > 0) {
        this.toastr.warning(result.warnings.slice(0, 5).join('; '), 'Volpiano export warnings');
      }
    } catch (e) {
      this.toastr.error('Volpiano export failed: ' + e);
    }
  }

  confirmJsonExport(): void {
    this.showJsonExportDialog = false;
    this.download(this.exportJsonMode);
  }

  download(mode: 'none' | 'comment' | 'consecutive_lines' | 'split_documents' | boolean = 'none'): void {
    if (!this.cont) return;

    const compatMode = typeof mode === 'boolean' ? (mode ? 'comment' : 'none') : mode;
    const baseId = (this.document && this.document.dokumenten_id) ? this.document.dokumenten_id : 'document';

    if (compatMode === 'split_documents') {
      const split = VM.convertToBackwardsCompatibleSplitDocuments(this.cont, baseId);
      this.triggerDownloadBlob(split.v1, split.filename1);
      setTimeout(() => {
        this.triggerDownloadBlob(split.v2, split.filename2);
      }, 250);
      return;
    }

    let exportData: VM.RootContainer = this.cont;
    if (compatMode === 'consecutive_lines') {
      exportData = VM.convertToBackwardsCompatibleConsecutiveLines(this.cont);
    } else if (compatMode === 'comment') {
      exportData = VM.convertToBackwardsCompatibleComment(this.cont);
    }

    this.triggerDownloadBlob(exportData, `${baseId}.json`);
  }

  private triggerDownloadBlob(data: any, filename: string): void {
    const pom = document.createElement('a');
    pom.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2)));
    pom.setAttribute('download', filename);

    if (document.createEvent) {
      var event = document.createEvent('MouseEvents');
      event.initEvent('click', true, true);
      pom.dispatchEvent(event);
    } else {
      pom.click();
    }
  }

  upload(): void {
    document.getElementById("document-upload")!.click();
  }

  handleFile(): void {
    const that = this;
    const file = (document.getElementById("document-upload") as HTMLInputElement)!.files![0];
    const reader = new FileReader();
    reader.onload = (p: ProgressEvent) => {
      const newCont = (p.target as any).result;
      if (this.user) {
        this.api.verifyNotes(this.user.token, newCont).subscribe(res => {
          switch (res.kind) {
            case 'LoginRequired': this.userService.logout(); break;
            case 'Failed': this.toastr.error("Invalid format", "Upload failed!"); break;
            case 'NotesRetrieved':
              this.cont = VM.normalizeDocumentComments(res.data);
              this.contJsonClone = JSON.stringify(this.cont);
              this.toastr.success("Upload successful!");
              this.checkSecondVoiceComments(this.cont);
              this.setFirstSyllable();
              break;

            default: assertNever(res);
          }
        });
        (document.getElementById("document-upload") as HTMLInputElement)!.value = "";
      }
    }
    reader.readAsText(file);
  }

  checkSecondVoiceComments(root: VM.RootContainer): void {
    if (!root) return;
    const svComments = VM.findSecondVoiceComments(root);
    if (svComments.length > 0) {
      this.detectedSecondVoiceCommentCount = svComments.length;
      this.showSecondVoiceImportDialog = true;
    }
  }

  confirmReincorporateSecondVoice(): void {
    if (this.cont) {
      this.undoService.beforeChange('Incorporate 2nd Voice Comments');
      const result = VM.reincorporateSecondVoiceComments(this.cont);
      this.cont = result.root;
      this.contJsonClone = JSON.stringify(this.cont);
      this.save();
      this.toastr.success(`${result.count} 2nd voice comment(s) incorporated into native polyphonic staves!`);
    }
    this.showSecondVoiceImportDialog = false;
  }

  keepSecondVoiceAsComments(): void {
    this.showSecondVoiceImportDialog = false;
  }

  /**
   * Saves the document with clear feedback and syncs to OS file if Chromium File System handle is linked.
   */
  async saveWithFeedbackAndSync(): Promise<void> {
    if (!this.document || !this.cont) return;

    this.save();

    // Check and trigger OS backup file sync if handle is configured
    try {
      const syncRes = await this.fsService.syncWorkspaceToOsFile();
      if (syncRes.synced) {
        this.toastr.success(`Document saved and synced to ${syncRes.filename || 'OS file'}.`, 'Saved & Synced');
      } else if (syncRes.error) {
        this.toastr.info('Document saved locally. (OS backup file: ' + syncRes.error + ')', 'Saved');
      } else {
        this.toastr.success('Document saved successfully.', 'Saved');
      }
    } catch (e) {
      this.toastr.success('Document saved successfully.', 'Saved');
    }
  }

  @HostListener('window:unload', ['$event'])
  unloadHandler($event: any) {
    this.hasChanges();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnloadHander($event: any) {
    return !this.hasChanges();
  }

  @HostListener('window:monodi-shortcut', ['$event'])
  handleCustomShortcut(event: any) {
    const action = event?.detail?.action;
    if (!action) return;
    if (action === 'mergeWithNextLine') {
      this.executeMergeWithNextLine();
    } else if (action === 'mergeSection') {
      this.executeMergeSection();
    } else if (action === 'mergeAllLines') {
      this.executeMergeAllLines();
    }
  }

  @HostListener('window:keydown', ['$event'])
  keyEvent(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveWithFeedbackAndSync();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.startCommentCreation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'h' || event.key.toLowerCase() === 'f')) {
      // Don't intercept browser search if inside standard textareas unless user wants editor search
      event.preventDefault();
      this.toggleSearchReplace();
      this.updateToolbar();
      return;
    }
    if (event.ctrlKey && event.key === 'z') {
      this.undoService.undo();
      return;
    }
    // Global merge & split shortcuts in document view
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this.executeMergeWithNextLine();
      return;
    }
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this.executeMergeSection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this.executeMergeAllLines();
      return;
    }
    if (event.key === 'Escape') {
      if (this.isCommentCreationMode) {
        event.preventDefault();
        this.cancelCommentCreation();
      } else if (this.isSearchReplaceOpen) {
        event.preventDefault();
        this.closeSearchReplace();
        this.updateToolbar();
      }
    }
  }

  executeMergeWithNextLine(): void {
    if (!this.cont) return;
    const lines = VM.getAllLineContainers(this.cont);
    if (lines.length === 0) return;
    
    let targetIdx = -1;
    if (this.focusService.focusedContainerUUID) {
      targetIdx = lines.findIndex(l => l.uuid === this.focusService.focusedContainerUUID);
    }
    if (targetIdx === -1 && this.focusService.focusedNoteUUID) {
      const sylUuid = this.findSyllableUuidForNoteUuid(this.cont, this.focusService.focusedNoteUUID);
      if (sylUuid) {
        targetIdx = lines.findIndex(l => (l.children || []).some((c: any) => c.uuid === sylUuid));
      }
    }
    if (targetIdx === -1) {
      targetIdx = 0;
    }

    if (targetIdx >= 0 && lines[targetIdx + 1]) {
      this.undoService.beforeChange();
      const current = lines[targetIdx];
      const next = lines[targetIdx + 1];
      current.children.push(...next.children);
      VM.remove(this.cont, next);
      VM.removeStaleComments(this.cont);
      this.save();
      this.cont = { ...this.cont };
      this.toastr.success('Zeile mit nächster Zeile zusammengeführt.');
    } else {
      this.toastr.warning('Es gibt keine folgende Zeile zum Zusammenführen.');
    }
  }

  executeMergeSection(): void {
    if (!this.cont) return;
    let targetUuid = this.focusService.focusedContainerUUID;
    if (!targetUuid && this.focusService.focusedNoteUUID) {
      const sylUuid = this.findSyllableUuidForNoteUuid(this.cont, this.focusService.focusedNoteUUID);
      if (sylUuid) {
        const parentRes = VM.findParentContainer(this.cont, sylUuid);
        if (parentRes) {
          targetUuid = parentRes.parent.uuid;
        }
      }
    }
    if (!targetUuid) {
      // Find first section
      const findFirstFormteil = (c: VM.Container): string | undefined => {
        if (c.kind === VM.ContainerKind.FormteilContainer) return c.uuid;
        const children = VM.getContainerChildren(c);
        if (children) {
          for (const child of children) {
            const found = findFirstFormteil(child);
            if (found) return found;
          }
        }
        return undefined;
      };
      targetUuid = findFirstFormteil(this.cont);
    }

    if (targetUuid) {
      const res = VM.findParentContainer(this.cont, targetUuid);
      if (res) {
        const { parent, index } = res;
        const parentContainer = parent as any;
        const current = parentContainer.children[index];
        const next = parentContainer.children[index + 1];
        if (current && next && current.kind === VM.ContainerKind.FormteilContainer && next.kind === VM.ContainerKind.FormteilContainer) {
          this.undoService.beforeChange();
          current.children.push(...next.children);
          parentContainer.children.splice(index + 1, 1);
          VM.removeStaleComments(this.cont);
          this.save();
          this.cont = { ...this.cont };
          this.toastr.success('Abschnitt mit nächstem Abschnitt zusammengeführt.');
          return;
        }
      }
    }
    this.toastr.warning('Es gibt keinen folgenden Abschnitt zum Zusammenführen.');
  }

  executeMergeAllLines(): void {
    if (!this.cont) return;
    this.undoService.beforeChange();
    let targetContainer: VM.Container = this.cont;
    if (this.focusService.focusedContainerUUID) {
      const found = VM.findContainerByUUID(this.cont, this.focusService.focusedContainerUUID);
      if (found && found.kind === VM.ContainerKind.FormteilContainer) {
        targetContainer = found;
      }
    }
    const count = VM.mergeAllLinesPerSection(targetContainer);
    VM.removeStaleComments(this.cont);
    this.save();
    this.cont = { ...this.cont };
    if (count > 0) {
      this.toastr.success(`${count} Zeile(n) erfolgreich innerhalb der Abschnitte zusammengeführt.`);
    } else {
      this.toastr.info('Keine Zeilen zum Zusammenführen vorhanden.');
    }
  }

  hasChanges(): boolean {
    if (this.contJsonClone)
      return !(this.contJsonClone.replace(/"focus":true/g, '"focus":false') === JSON.stringify(this.cont).replace(/"focus":true/g, '"focus":false')
        && this.documentJsonClone === JSON.stringify(this.document));
    return false;
  }

  resetClones(): void {
    this.documentJsonClone = JSON.stringify(this.document);
    this.contJsonClone = JSON.stringify(this.cont);
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
    this.toolService.remove(this);
  }

  doImport(): void {
    this.textImportErrors = [];
    if (this.validateTextImputAgainstCommonErrors(this.importText.trim())) {
      const result = parsers[this.importType]!.parse(this.importText.trim());
      if (result.status) {
        this.cont = result.value;
        if (this.fixDashesOnImport && this.cont) {
          VM.fixSyllableDashes(this.cont);
        }
        this.save();
        this.cont = { ...this.cont };
        this.modalService.dismissAll();
      } else {
        console.log(result);
        this.toastr.error("Technical details are available in the console.", "Could not parse text");
        this.modalService.dismissAll();
      }
    }
  }

  validateTextImputAgainstCommonErrors(importedText: string): boolean {
    // rule more then 2 tabstops regex(/\t\t+/)
    const rule1 = /\t\t\t+/;
    // rule more then 2 spaces regex(/\ \ +/)
    const rule2 = /\ \ +/;
    // rule no whitespace in first column
    const rule3 = /^\ +\t/;
    // rule if || then two tabs else only one allowed
    const rule4 = /\t.*\t(?!\|{2})/;

    const rules: RegExp[] = [rule1, rule2, rule3, rule4];
    const inputLines = importedText.split('\n');
    let result = true;
    const errors: Array<Array<string>> = new Array(4).fill(1).map(() => new Array());
    for (let i = 0; i < inputLines.length; i++) {
      rules.map((rule, index) => {
        if (inputLines[i].match(rule) != null) {
          errors[index].push('' + (i + 1));
          result = false;
        }
      }
      );
    }
    if (!result) {
      if (errors.length > 0) {
        if (errors[0].length > 0) {
          this.textImportErrors.push('More than two tab stops were found in these lines: ' + errors[0]);
        }
        if (errors[1].length > 0) {
          this.textImportErrors.push('Two or more consecutive spaces were found in these lines: ' + errors[1]);
        }
        if (errors[2].length > 0) {
          this.textImportErrors.push('Spaces in the first column were found in these lines: ' + errors[2]);
        }
        if (errors[3].length > 0) {
          this.textImportErrors.push('Two tabs in lines without a page break were found in these lines: ' + errors[3]);
        }
      }
      this.toastr.error('Errors were found in the input.');
    }
    return result;
  }

  copyIdToClipboard(): void {
    const e = document.getElementById("document-id-input") as HTMLInputElement | null;
    if (e) {
      e.select();
      e.setSelectionRange(0, 99999)
      document.execCommand("copy");
      window.alert("copied");
    }
  }

  createGlobalComment(): void {
    if (this.cont) {
      this.cont.globalComment = VM.emptyCommentTree();
    }
  }

  handleGlobalCommentTreeEvent(e: VM.CommentTreeEvent): void {
    if (this.cont?.globalComment) {
      this.cont.globalComment = VM.applyCommentTreeEvent(this.cont.globalComment, e);
    }
  }

  createNewZeileContainerForTreeComment(): VM.ZeileContainer {
    return VM.emptyZeileContainer();
  }

  deleteGlobalComment(): void {
    if (this.cont) {
      this.cont.globalComment = undefined;
    }
  }

  openComment(comment: VM.Comment): void {
    if (!this.cont) return;
    this.undoService.beforeChange('Edit Comment');
    const original = VM.extractComment(this.cont, comment);

    const modalRef = this.modalService.open(CommentComponent, { size: 'xl', centered: true, backdrop: 'static', windowClass: 'comment-modal-window', scrollable: true, fullscreen: 'lg' });
    modalRef.componentInstance.comments = [comment];
    modalRef.componentInstance.originals = [original];

    /** Tracks whether the user pressed Delete inside the modal (the modal
     *  sets its slot to null in that case). Used by the close handler to
     *  actually remove the comment from `cont.comments`. */
    let deletedInModal = false;

    modalRef.componentInstance.saveEvent.subscribe((newComments: (VM.Comment | null)[]) => {
      // newComments mirrors the modal's internal array. A null entry means
      // the user clicked Delete on that comment. Apply the deletion to the
      // real document so it sticks after the modal closes.
      if (Array.isArray(newComments) && newComments.length > 0 && newComments[0] === null) {
        deletedInModal = true;
        this.cont!.comments = this.cont!.comments.filter(c => c !== comment);
        VM.removeStaleComments(this.cont!);
      }
      this.save();
    });

    const onModalClose = () => {
      // If the user added a comment and then dismissed without entering
      // any content, treat it as an accidental creation and drop it. A
      // comment's content is now always a tree, so emptiness is checked
      // via VM.isCommentEmpty (empty text + empty/Undecided tree).
      if (!deletedInModal && VM.isCommentEmpty(comment)) {
        this.cont!.comments = this.cont!.comments.filter(c => c !== comment);
        VM.removeStaleComments(this.cont!);
      }
      this.save();
    };

    modalRef.result.then(onModalClose).catch(onModalClose);
  }



  getFocusedNoteUUID(): string | null {
    if (!this.cont) return null;
    const syllables = VM.getSyllables(this.cont);
    for (const s of syllables) {
      if (s.notes) {
        const focused = VM.getFocused(s.notes);
        if (focused) return focused.uuid;
        if (s.additionalMelodies) {
          for (const am of s.additionalMelodies) {
            const f = VM.getFocused(am);
            if (f) return f.uuid;
          }
        }
      }
    }
    return null;
  }
  /**
   * Begins the two-click "make a comment" workflow.
   *
   * Always goes through the explicit pick-start → pick-end sequence so the
   * user is never confused about which note becomes the start. Any
   * previously-focused note is intentionally ignored.
   */
  startCommentCreation(): void {
    if (!this.cont) return;
    if (this.focusService.mode.kind !== 'Normal') return; // already in a pick mode
    // Clear any lingering note focus so the previous selection can't be
    // mistaken for the start of the new comment. We walk the tree
    // defensively because some containers may not have a fully-initialized
    // children array (VM.removeFocus crashes in that case).
    this.clearAllFocus(this.cont);
    this.focusService.mode = { kind: 'CommentPickStart' };
  }

  /** Defensive variant of VM.removeFocus that tolerates partially-formed
   *  containers (e.g. a Formteil whose `children` array is missing). */
  private clearAllFocus(node: any): void {
    if (!node) return;
    if (node.focus === true) node.focus = false;
    // Notes are nested inside Syllable.notes.spaced[].nonSpaced[].grouped[]
    if (node.kind === 'Syllable' && node.notes && Array.isArray(node.notes.spaced)) {
      for (const sp of node.notes.spaced) {
        for (const ns of (sp?.nonSpaced ?? [])) {
          for (const n of (ns?.grouped ?? [])) {
            if (n) n.focus = false;
          }
        }
      }
      if (Array.isArray(node.additionalMelodies)) {
        for (const am of node.additionalMelodies) {
          for (const sp of (am?.spaced ?? [])) {
            for (const ns of (sp?.nonSpaced ?? [])) {
              for (const n of (ns?.grouped ?? [])) {
                if (n) n.focus = false;
              }
            }
          }
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) this.clearAllFocus(c);
    }
  }

  /** True if we're somewhere in the 2-step comment-creation flow. */
  get isCommentCreationMode(): boolean {
    return this.focusService.mode.kind === 'CommentPickStart'
        || this.focusService.mode.kind === 'CommentCreate';
  }

  /** True when waiting for the user to pick the START note (step 1). */
  get isPickingCommentStart(): boolean {
    return this.focusService.mode.kind === 'CommentPickStart';
  }

  /** True when waiting for the user to pick the END note (step 2). */
  get isPickingCommentEnd(): boolean {
    return this.focusService.mode.kind === 'CommentCreate';
  }

  cancelCommentCreation(): void {
    if (this.isCommentCreationMode) {
      this.focusService.mode = { kind: 'Normal' };
    }
  }

  /** Hex color assigned to a comment based on its position in
   *  `cont.comments`. Used to color both the SVG bracket and the matching
   *  sidebar card stripe so the user can easily pair them up. */
  commentColor(c: VM.Comment): string {
    if (!this.cont) return '#94a3b8';
    const idx = this.cont.comments.indexOf(c);
    return commentColor(idx);
  }

  isCommentHighlighted(comment: VM.Comment): boolean {
    if (!this.cont) return false;
    const focusedNote = this.getFocusedNoteUUID();
    if (!focusedNote) return false;
    
    const uuids = VM.getAllCommentableUUIDs(this.cont);
    const startIdx = uuids.indexOf(comment.startUUID);
    const endIdx = uuids.indexOf(comment.endUUID);
    const focusIdx = uuids.indexOf(focusedNote);
    
    if (startIdx !== -1 && endIdx !== -1 && focusIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        return focusIdx >= min && focusIdx <= max;
    }
    return comment.startUUID === focusedNote || comment.endUUID === focusedNote;
  }
  getCommentType(c: VM.Comment): string { return commentType(c); }

  getCommentPreview(comment: VM.Comment): string {
    if (!this.cont) return '';
    const syllables = VM.getSyllables(this.cont);
    
    // Helper to find parent syllable by checking syllable UUID or note UUIDs inside
    const findSyllableIdx = (uuid: string): number => {
      return syllables.findIndex(s => {
        if (s.uuid === uuid) return true;
        if (s.notes && s.notes.spaced) {
          for (const ns of s.notes.spaced) {
            for (const g of ns.nonSpaced) {
              for (const n of g.grouped) {
                if (n.uuid === uuid) return true;
              }
            }
          }
        }
        return false;
      });
    };

    const startIdx = findSyllableIdx(comment.startUUID);
    const endIdx = findSyllableIdx(comment.endUUID);
    
    if (startIdx >= 0 && endIdx >= 0) {
      const minIdx = Math.min(startIdx, endIdx);
      const maxIdx = Math.max(startIdx, endIdx);
      const sliced = syllables.slice(minIdx, maxIdx + 1);
      
      const words = sliced.map(s => s.text).filter(t => !!t);
      if (words.length > 0) {
        return `"${words.join(' ')}"`;
      }
      
      // Fallback to note pitches when syllables have empty lyrics
      const notes: VM.Note[] = [];
      for (const s of sliced) {
        if (s.notes && s.notes.spaced) {
          for (const ns of s.notes.spaced) {
            for (const g of ns.nonSpaced) {
              for (const n of g.grouped) {
                notes.push(n);
              }
            }
          }
        }
      }
      if (notes.length > 0) {
        return `[${notes.map(n => n.base + n.octave).join('-')}]`;
      }
    }
    return '';
  }

  getCommentTreeText(tree: VM.CommentTree | undefined): string {
    if (!tree) return '';
    if (tree.kind === "CommentTreeLeaf") {
      if (tree.content.kind === "Text") {
        return tree.content.content;
      } else if (tree.content.kind === "Notes") {
        const syllables = VM.getSyllables(tree.content.content);
        const text = syllables.map(s => s.text).filter(t => !!t).join(' ');
        if (text) {
          return `[Notes: ${text}]`;
        } else {
          // Fall back to note pitches when lyrics are empty
          const notes: VM.Note[] = [];
          for (const s of syllables) {
            if (s.notes && s.notes.spaced) {
              for (const ns of s.notes.spaced) {
                for (const g of ns.nonSpaced) {
                  for (const n of g.grouped) {
                    notes.push(n);
                  }
                }
              }
            }
          }
          if (notes.length > 0) {
            const pitchStr = notes.map(n => n.base + n.octave).join('-');
            return `[Notes: ${pitchStr}]`;
          }
          return '[Notes]';
        }
      } else if (tree.content.kind === "Bracket") {
        return ']';
      }
    } else if (tree.kind === "CommentTreeGrid") {
      const parts: string[] = [];
      for (const row of tree.items) {
        for (const cell of row) {
          const cellText = this.getCommentTreeText(cell);
          if (cellText) parts.push(cellText);
        }
      }
      return parts.join(' / ');
    }
    return '';
  }

}
