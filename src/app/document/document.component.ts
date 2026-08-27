import { FocusService } from '../focus.service';
import { ViewChild, ElementRef, Component, OnInit, HostListener } from '@angular/core';
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
import { VolpianoService } from '../volpiano.service';

import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import autoTable from 'jspdf-autotable';

@Component({
  selector: 'app-document',
  templateUrl: './document.component.html',
  styleUrls: ['./document.component.css']
})
export class DocumentComponent implements OnInit {
  getCategoryDetails = getCategoryDetails;
  getInterventionLabel = getInterventionLabel;
  getInterventionIcon(key: string): string {
    const found = INTERVENTIONS.find(i => i.key === key);
    return found ? found.icon : 'bi-pencil-fill';
  }
  @ViewChild('textImport', { static: true }) textImportModal!: ElementRef;
  @ViewChild('globalComment', { static: true }) globalCommentModal!: ElementRef;
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
    private pageTitle: PageTitleService, public focusService: FocusService) {
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
      this.toastr.warning("Dieser Abschnitt kann nicht gelöscht werden, da er der einzige auf dieser Ebene ist.");
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

  /** Receives events bubbled up from app-root-section (via the Section base class onEvent output). */
  handleRootEvent(e: any): void {
    if (e.kind === 'FixSyllableDashesRequested') {
      this.undoService.beforeChange();
      if (this.cont) {
        VM.fixSyllableDashes(this.cont);
        this.save();
        this.cont = { ...this.cont } as VM.RootContainer;
      }
      this.toastr.success("Silbentrennstriche wurden korrigiert.");
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
    this.showPdfExportDialog = true;
  }

  getMetadataFieldLabel(key: string): string {
    if (key === 'dokumenten_id') return 'ID';
    if (key === 'textinitium') return 'Initium';
    if (key === 'gattung1') return 'Genre 1';
    if (key === 'gattung2') return 'Genre 2';
    if (key === 'festtag') return 'Feast Day';
    if (key === 'feier') return 'Feast';
    const custom = this.settings?.customDocumentFields?.find(f => f.key === key);
    return custom ? custom.label : key;
  }

  getMetadataFieldValue(key: string): string {
    if (!this.document) return '';
    if (key === 'dokumenten_id') return this.document.dokumenten_id || '';
    if (key === 'textinitium') return this.document.textinitium || '';
    if (key === 'gattung1') return this.document.gattung1 || '';
    if (key === 'gattung2') return this.document.gattung2 || '';
    if (key === 'festtag') return this.document.festtag || '';
    if (key === 'feier') return this.document.feier || '';
    return this.document.custom?.[key] || '';
  }

  buildHeadlineText(fields: string[]): string {
    if (!fields || fields.length === 0) return '';
    const parts: string[] = [];
    for (const f of fields) {
      const val = this.getMetadataFieldValue(f);
      if (val) {
        if (f === 'dokumenten_id') {
          parts.push(val);
        } else {
          const label = this.getMetadataFieldLabel(f);
          parts.push(`${label}: ${val}`);
        }
      }
    }
    return parts.join('   •   ');
  }

  get currentLevelNames(): any {
    if (!this.settings || !this.settings.genreLevelProfiles || !this.document) return null;
    const g1 = this.document.gattung1 || '';
    const g2 = this.document.gattung2 || '';
    let profile = this.settings.genreLevelProfiles.find((p: any) => p.gattung1 === g1 && p.gattung2 === g2);
    if (!profile) profile = this.settings.genreLevelProfiles.find((p: any) => p.gattung1 === g1 && (!p.gattung2 || p.gattung2 === '*'));
    if (!profile) profile = this.settings.genreLevelProfiles.find((p: any) => (!p.gattung1 || p.gattung1 === '*') && (!p.gattung2 || p.gattung2 === '*'));
    return profile ? profile.names : null;
  }

  async confirmPdfExport() {
    this.showPdfExportDialog = false;
    this.isPrinting = true;
    
    // Force readOnly to render clean text without boxes
    const originalReadOnly = this.readOnly;
    this.readOnly = true;

    // Wait for Angular to re-render the DOM
    setTimeout(async () => {
      try {
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const s: any = this.settings || {};
        const fontFamily = s.pdfFontFamily || 'times';
        const pdfMarginLeft = Number(s.pdfMarginLeft ?? 40);
        const pdfMarginRight = Number(s.pdfMarginRight ?? 40);
        const pdfMarginTop = Number(s.pdfMarginTop ?? 40);
        const pdfMarginBottom = Number(s.pdfMarginBottom ?? 40);
        const pdfStaffSpacing = Number(s.pdfStaffSpacing ?? 20);
        const pdfBracketGap = Number(s.pdfBracketGap ?? 5);
        const pdfBracketTick = Number(s.pdfBracketTick ?? 4);
        const pdfSyllableTextOffset = Number(s.pdfSyllableTextOffset ?? 10);
        const pdfTextBlockGap = Number(s.pdfTextBlockGap ?? 10);
        
        // Coerced layout parameters
        const titleFontSize = Number(s.pdfTitleFontSize ?? 16);
        const pdfTitleVerticalSpace = Number(s.pdfTitleVerticalSpace ?? 20);
        const headerSource = s.pdfHeaderSource || 'textinitium';
        const metaFontSize = Number(s.pdfMetadataFontSize ?? 9);
        const pdfMetadataVerticalSpace = Number(s.pdfMetadataVerticalSpace ?? 15);
        const pdfBracketThickness = Number(s.pdfBracketThickness ?? 1.2);
        const pdfCommentTitleFontSize = Number(s.pdfCommentTitleFontSize ?? 8);
        const pdfVerticalSpace = Number(s.pdfVerticalSpace ?? 15);
        const SCALE = Number(s.pdfScale ?? 0.40);
        const extraSyllableSpacing = Number(s.pdfSyllableSpacing ?? 10);
        const pdfFontSize = Number(s.pdfFontSize ?? 10);
        const pdfSignaturSpace = Number(s.pdfSignaturSpace ?? 60);
        const pdfParatextFontSize = Number(s.pdfParatextFontSize ?? 10);
        const pdfParatextSpacing = Number(s.pdfParatextSpacing ?? 12);
        const pdfCommentStaffScale = Number(s.pdfCommentStaffScale ?? s.pdfScale ?? 0.40);
        const pdfCommentFontSize = Number(s.pdfCommentFontSize ?? 9);
        const pdfCommentTitleFontSizeActual = Number(s.pdfCommentTitleFontSize ?? 10);
        const pdfCommentBlockGap = Number(s.pdfCommentBlockGap ?? 25);
        const pdfShowPageNumbers = s.pdfShowPageNumbers === true || s.pdfShowPageNumbers === 'true';
        const pdfPageNumberFontSize = Number(s.pdfPageNumberFontSize ?? 8);
        const pdfHeadlineFontSize = Number(s.pdfHeadlineFontSize ?? 8);
        const pdfHeadlineMetadataFields = s.pdfHeadlineMetadataFields || [];

        let cursorY = pdfMarginTop;
        const pageHeight = 842;
        const pageWidth = 595;
        const printWidth = pageWidth - pdfMarginLeft - pdfMarginRight;
        const maxContentY = pageHeight - pdfMarginBottom;

        const checkPageOverflow = (neededHeight: number) => {
          if (cursorY + neededHeight > maxContentY) {
            doc.addPage();
            cursorY = pdfMarginTop;
          }
        };

        // Title
        doc.setFontSize(titleFontSize);
        doc.setFont(fontFamily, "bold");
        const headerText = this.getMetadataFieldValue(headerSource) || (this.document?.textinitium || "New Document");
        doc.text(headerText, pdfMarginLeft, cursorY);
        cursorY += pdfTitleVerticalSpace;
        checkPageOverflow(0);

        // Metadata inline, styled & dense
        if (this.printIncludeMetadata && this.document) {
          doc.setFontSize(metaFontSize);
          
          const items = this.getInlineMetadataItems();
          let curX = pdfMarginLeft;
          let curY = cursorY;
          const bullet = "   •   ";
          
          for (let k = 0; k < items.length; k++) {
            const item = items[k];
            const labelText = item.label + ": ";
            const valText = item.val + (k < items.length - 1 ? bullet : "");
            
            doc.setFont(fontFamily, "bold");
            const labelWidth = doc.getTextWidth(labelText);
            doc.setFont(fontFamily, "normal");
            const valWidth = doc.getTextWidth(valText);
            
            if (curX + labelWidth + valWidth > pageWidth - pdfMarginRight) {
              curX = pdfMarginLeft;
              curY += metaFontSize * 1.4;
              checkPageOverflow(metaFontSize * 1.4);
            }
            
            doc.setFont(fontFamily, "bold");
            doc.text(labelText, curX, curY);
            curX += labelWidth;
            
            doc.setFont(fontFamily, "normal");
            doc.text(valText, curX, curY);
            curX += valWidth;
          }
          
          cursorY = curY + pdfMetadataVerticalSpace;
          checkPageOverflow(0);
        }

        // DOM Traversal for Structural Layout
        doc.setFontSize(12);
        
        const drawActiveBracket = (startX: number, endX: number, bY: number, label: string) => {
           doc.setLineWidth(pdfBracketThickness);
           doc.setDrawColor(0, 0, 0);
           doc.line(startX, bY - pdfBracketTick, startX, bY);
           doc.line(startX, bY, endX, bY);
           doc.line(endX, bY - pdfBracketTick, endX, bY);
           
           if (label) {
               const cleanLabel = label.replace(/^\[|\]$/g, '');
               doc.setFontSize(pdfCommentTitleFontSizeActual);
               doc.setFont(fontFamily, "italic");
               const txtX = startX + (endX - startX) / 2 - (doc.getTextWidth(cleanLabel) / 2);
               doc.text(cleanLabel, txtX, bY + pdfBracketTick + 4);
           }
        };
        
        // Grab all app-containers in document order, only from the main document area
        const containers = document.querySelectorAll('app-root-section .app-container');
        
        // Track active comments for drawing brackets
        const activeBrackets: { [key: string]: { startX: number, startLineY: number, label: string } } = {};
        const documentComments = this.cont?.comments || [];
        
        // Build a map of Syllable/LinePart UUID to all its nested commentable UUIDs (including notes)
        const uuidMap: { [key: string]: string[] } = {};
        if (this.cont) {
            const allLineParts = VM.getAllLineParts(this.cont);
            for (const lp of allLineParts) {
                uuidMap[lp.uuid] = VM.getCommentableUUIDsOfLinePart(lp);
            }
        }
        
        // Track the current Signatures to print before the next Zeile
        let currentSignatures: string[] = [];
        let wasLastElementParatext = false;
        
        for (let i = 0; i < containers.length; i++) {
          const container = containers[i] as HTMLElement;
          
          // Calculate indentation based on left padding/margin of parent .child elements
          let paddingLeft = 0;
          let currentElement: HTMLElement | null = container;
          while (currentElement) {
              if (currentElement.classList && currentElement.classList.contains('child')) {
                  paddingLeft += 20;
              }
              currentElement = currentElement.parentElement;
          }
          
          // structural text xOffset
          const xOffset = pdfMarginLeft + paddingLeft;

          // Only look inside the immediate content-row, not inside nested .children
          const firstDiv = container.children[0];
          if (!firstDiv) continue;
          
          const contentRow = firstDiv.querySelector('.content-row') as HTMLElement;
          if (!contentRow) continue;
          
          // 1. Check for Signatur
          const formteilDivs = contentRow.querySelectorAll('.formteil-line > div');
          for (let k = 0; k < formteilDivs.length; k++) {
             const fDiv = formteilDivs[k] as HTMLElement;
             if (fDiv.innerText && fDiv.innerText.indexOf("Signatur") !== -1) {
                 const input = fDiv.querySelector('input');
                 if (input && input.value.trim()) {
                     currentSignatures.push(input.value.trim());
                 }
             }
          }

          // Add vertical space ONLY if this is a FormteilContainer (level section)
          if (contentRow.classList.contains('formteil-section')) {
            if (!wasLastElementParatext) {
              checkPageOverflow(pdfVerticalSpace);
              cursorY += pdfVerticalSpace;
            }
            wasLastElementParatext = false;
          }
          
          // Check if this row is a Zeile (contains musical notes)
          const parts = contentRow.querySelectorAll('app-notes, app-line-change, app-folio-change');
          
          if (parts.length > 0) {
            wasLastElementParatext = false;
            // Horizontal layout for notes and breaks
            
            const musicStartX = pdfMarginLeft + pdfSignaturSpace;
            
            let lineStartY = cursorY;
            let cursorX = musicStartX;
            let lineMaxHeight = 0;
            let lineHasLyrics = false;
            let lineHasBrackets = Object.keys(activeBrackets).length > 0;
            
            for (let j = 0; j < parts.length; j++) {
              const part = parts[j] as HTMLElement;
              const tagName = part.tagName.toLowerCase();
              
              if (tagName === 'app-line-change' || tagName === 'app-folio-change') {
                // Wrap on editorial break
                const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
                for (const key in activeBrackets) {
                    const b = activeBrackets[key];
                    drawActiveBracket(b.startX, cursorX, bracketY, b.label);
                }
                
                let lineBottomY = lineStartY + lineMaxHeight;
                if (lineHasBrackets) {
                    lineBottomY = bracketY + pdfBracketTick + 8;
                } else if (lineHasLyrics) {
                    lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
                }
                
                cursorY = lineBottomY + pdfStaffSpacing;
                checkPageOverflow(40); // check overflow for staff line height of at least 40pt
                
                lineStartY = cursorY;
                cursorX = musicStartX;
                lineMaxHeight = 0;
                lineHasLyrics = false;
                lineHasBrackets = Object.keys(activeBrackets).length > 0;
                
                for (const key in activeBrackets) {
                    const b = activeBrackets[key];
                    b.startX = musicStartX;
                    b.startLineY = lineStartY;
                }
                continue;
              }
              
              const sec = part.querySelector('.section') as HTMLElement;
              if (!sec) continue;
              
              const svgs = sec.querySelectorAll('svg');
              const textEl = sec.querySelector('.syllableText:not(.dnone)') as HTMLElement;
              
              let maxRawWidth = 50;
              let totalRawHeight = 0;
              for (let v = 0; v < svgs.length; v++) {
                 const s = svgs[v];
                 let w = parseFloat(s.getAttribute('width') || '50');

                 // Dynamic width check: inspect note image and slur path coordinates
                 // to ensure we never truncate content if DOM attributes are too small or lag.
                 const images = s.querySelectorAll('image');
                 const paths = s.querySelectorAll('path');
                 let maxContentRight = 0;

                 images.forEach(img => {
                   const x = parseFloat(img.getAttribute('x') || '0');
                   const width = parseFloat(img.getAttribute('width') || '12');
                   if (x + width > maxContentRight) {
                     maxContentRight = x + width;
                   }
                 });

                 paths.forEach(p => {
                   const d = p.getAttribute('d') || '';
                   const numbers = d.match(/-?[0-9.]+/g);
                   if (numbers && numbers.length >= 7) {
                     const startX = parseFloat(numbers[0]);
                     const offsetVal = parseFloat(numbers[6]);
                     const endX = startX + offsetVal;
                     if (endX > maxContentRight) {
                       maxContentRight = endX;
                     }
                   }
                 });

                 if (maxContentRight > 0) {
                   // Find the inner layout translation amount (default 12)
                   const gTranslate = s.querySelector('g[transform*="translate"]');
                   let translateAmt = 12;
                   if (gTranslate) {
                     const transform = gTranslate.getAttribute('transform') || '';
                     const match = transform.match(/translate\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)/);
                     if (match) {
                       translateAmt = parseFloat(match[1]);
                     }
                   }
                   const contentWidth = maxContentRight + translateAmt + 8;
                   if (contentWidth > w) {
                     w = contentWidth;
                   }
                 }

                 if (w > maxRawWidth) maxRawWidth = w;
                 totalRawHeight += (s.getBoundingClientRect().height || 80);
              }
              if (svgs.length === 0) {
                 totalRawHeight = 80;
              }
              
              const svgWidth = maxRawWidth * SCALE;
              const secHeight = totalRawHeight * SCALE;
              
              let txt = "";
              let textWidth = 0;
              if (textEl) {
                txt = textEl.innerText.trim();
                if (txt && txt !== "X" && txt !== "..." && txt !== "<...>") {
                  doc.setFontSize(pdfFontSize);
                  doc.setFont(fontFamily, "normal");
                  textWidth = doc.getTextWidth(txt);
                  lineHasLyrics = true;
                } else {
                  txt = "";
                }
              }

              // Calculate final section width
              let finalSecWidth = Math.max(svgWidth, textWidth + extraSyllableSpacing);
              
              // Detect if this syllable is the last one on the current visual line,
              // so we can extend staff lines to fill up to the right margin.
              let isLastOnLine = (j === parts.length - 1);
              if (!isLastOnLine && j + 1 < parts.length) {
                const nextPart = parts[j + 1] as HTMLElement;
                const nextTag = nextPart.tagName.toLowerCase();
                if (nextTag === 'app-line-change' || nextTag === 'app-folio-change') {
                  isLastOnLine = true;
                } else if (nextTag === 'app-notes') {
                  // Peek at the next syllable's width to see if it would trigger a wrap
                  const nextSec = nextPart.querySelector('.section') as HTMLElement;
                  if (nextSec) {
                    const nextSvgEls = nextSec.querySelectorAll('svg');
                    let nextRawW = 50;
                    for (let v = 0; v < nextSvgEls.length; v++) {
                        const w = parseFloat(nextSvgEls[v].getAttribute('width') || '50');
                        if (w > nextRawW) nextRawW = w;
                    }
                    const nextSvgW = nextRawW * SCALE;
                    const nextTextEl = nextSec.querySelector('.syllableText:not(.dnone)') as HTMLElement;
                    let nextTxtW = 0;
                    if (nextTextEl) {
                      const nt = nextTextEl.innerText.trim();
                      if (nt && nt !== 'X' && nt !== '...' && nt !== '<...>') {
                        doc.setFontSize(pdfFontSize);
                        doc.setFont(fontFamily, 'normal');
                        nextTxtW = doc.getTextWidth(nt);
                      }
                    }
                    const nextW = Math.max(nextSvgW, nextTxtW + extraSyllableSpacing);
                    // After the current syllable, if next would overflow, current is last on line
                    if (cursorX + finalSecWidth + nextW > pageWidth - pdfMarginRight) {
                      isLastOnLine = true;
                    }
                  }
                }
              }
              
              // Extend the SVG width to fill up to the right margin for the last syllable on the line
              if (isLastOnLine) {
                const extendedWidth = pageWidth - pdfMarginRight - cursorX;
                if (extendedWidth > finalSecWidth) {
                  finalSecWidth = extendedWidth;
                }
              }
              
              const partUuid = part.getAttribute('data-uuid');
              const partUuids = partUuid ? (uuidMap[partUuid] || [partUuid]) : [];
              
              // 1. Check if any comments start here
              if (partUuids.length > 0) {
                  const startingComments = documentComments.filter((c: any) => partUuids.includes(c.startUUID));
                  if (startingComments.length > 0) {
                      lineHasBrackets = true;
                      for (let ci = 0; ci < startingComments.length; ci++) {
                          const c = startingComments[ci];
                          const key = `${c.startUUID}_${c.endUUID}`;
                          const idx = documentComments.indexOf(c) + 1;
                          activeBrackets[key] = { startX: cursorX, startLineY: lineStartY, label: `[${idx}]` };
                      }
                  }
              }
              
              // Print Signatur right-aligned before the first note of this line
              if (j === 0 && currentSignatures.length > 0) {
                  doc.setFontSize(pdfFontSize);
                  doc.setFont(fontFamily, "normal");
                  const sigText = currentSignatures.join(" ");
                  const sigWidth = doc.getTextWidth(sigText);
                  const sigX = musicStartX - sigWidth - 10;
                  doc.text(sigText, sigX, cursorY + (secHeight / 2) + (pdfFontSize * 0.35));
                  currentSignatures = [];
              }
              
              // Wrap to next line if it exceeds page width
              if (cursorX + finalSecWidth > pageWidth - pdfMarginRight) {
                 const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
                 for (const key in activeBrackets) {
                     const b = activeBrackets[key];
                     drawActiveBracket(b.startX, cursorX, bracketY, b.label);
                 }
                 
                 let lineBottomY = lineStartY + lineMaxHeight;
                 if (lineHasBrackets) {
                     lineBottomY = bracketY + pdfBracketTick + 8;
                 } else if (lineHasLyrics) {
                     lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
                 }
                 
                 cursorY = lineBottomY + pdfStaffSpacing;
                 checkPageOverflow(40);
                 
                 lineStartY = cursorY;
                 cursorX = musicStartX + 30; // auto-wrap with indentation
                 lineMaxHeight = 0;
                 lineHasLyrics = false;
                 lineHasBrackets = Object.keys(activeBrackets).length > 0;
                 
                 for (const key in activeBrackets) {
                     const b = activeBrackets[key];
                     b.startX = musicStartX + 30;
                     b.startLineY = lineStartY;
                 }
              }
              
              lineMaxHeight = Math.max(lineMaxHeight, secHeight);
              
              // Draw SVGs
              if (svgs.length > 0) {
                let currentSvgY = cursorY;
                for (let v = 0; v < svgs.length; v++) {
                  const svg = svgs[v];
                  const rawHeight = svg.getBoundingClientRect().height || 80;
                  const svgSecHeight = rawHeight * SCALE;
                  const originalViewBox = svg.getAttribute('viewBox');
                  if (!originalViewBox) {
                    const finalRawWidth = finalSecWidth / SCALE;
                    svg.setAttribute('viewBox', `0 0 ${finalRawWidth} ${rawHeight}`);
                  }
                  
                  await doc.svg(svg, { x: cursorX, y: currentSvgY, width: finalSecWidth, height: svgSecHeight });
                  currentSvgY += svgSecHeight;
                  
                  if (!originalViewBox) {
                    svg.removeAttribute('viewBox');
                  }
                }
              }
              
              // Draw Syllable Text below the SVG
              if (txt) {
                doc.text(txt, cursorX, cursorY + secHeight + pdfSyllableTextOffset);
              }
              
              // 2. Check if any comments end here
              if (partUuids.length > 0) {
                  const endingComments = documentComments.filter((c: any) => partUuids.includes(c.endUUID));
                  if (endingComments.length > 0) {
                      lineHasBrackets = true;
                      for (let ci = 0; ci < endingComments.length; ci++) {
                          const c = endingComments[ci];
                          const key = `${c.startUUID}_${c.endUUID}`;
                          if (activeBrackets[key]) {
                              const b = activeBrackets[key];
                              const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
                              drawActiveBracket(b.startX, cursorX + finalSecWidth, bracketY, b.label);
                              delete activeBrackets[key];
                          }
                      }
                  }
              }
              
              cursorX += finalSecWidth;
            }
            
            // Close active brackets at the very end of the ZeileContainer
            const bracketY = lineStartY + lineMaxHeight + (lineHasLyrics ? (pdfSyllableTextOffset + pdfFontSize + pdfBracketGap) : pdfBracketGap);
            for (const key in activeBrackets) {
                const b = activeBrackets[key];
                drawActiveBracket(b.startX, cursorX, bracketY, b.label);
                delete activeBrackets[key];
            }
            
            let lineBottomY = lineStartY + lineMaxHeight;
            if (lineHasBrackets) {
                lineBottomY = bracketY + pdfBracketTick + 8;
            } else if (lineHasLyrics) {
                lineBottomY = lineStartY + lineMaxHeight + pdfSyllableTextOffset + pdfFontSize;
            }
            cursorY = lineBottomY + pdfStaffSpacing;
            checkPageOverflow(0);
            
          } else {
            // Normal Text / Paratext
            const contentDiv = contentRow.querySelector('.after-dragger > div:not(.type-identifier)');
            const textEl = contentDiv ? contentDiv.querySelector('textarea, span') : null;
            
            let txt = "";
            if (textEl && textEl.tagName.toLowerCase() === 'textarea') {
              txt = (textEl as HTMLTextAreaElement).value.trim();
            } else if (textEl) {
               txt = (textEl as HTMLElement).innerText.trim();
            }
            
            if (txt) {
              checkPageOverflow(pdfParatextFontSize * 2);
              
              doc.setFontSize(pdfParatextFontSize);
              doc.setFont(fontFamily, "normal");
              
              const splitText = doc.splitTextToSize(txt, printWidth - paddingLeft);
              doc.text(splitText, xOffset, cursorY);
              cursorY += (splitText.length * (pdfParatextFontSize * 1.4)) + pdfParatextSpacing;
              checkPageOverflow(0);
              wasLastElementParatext = true;
            }
          }
        }

        // Render Comment Trees on the final page (Critical Apparatus)
        const commentsArea = document.getElementById('pdf-comments-render-area');
        const hasComments = (this.cont?.comments && this.cont.comments.length > 0) || this.cont?.globalComment;
        if (commentsArea && hasComments) {
            doc.addPage();
            let cursorY = pdfMarginTop;
            doc.setFontSize(titleFontSize);
            doc.setFont(fontFamily, "bold");
            doc.text("Critical Apparatus", pdfMarginLeft, cursorY);
            cursorY += pdfTitleVerticalSpace;
            checkPageOverflow(0);

            const commentBlocks = commentsArea.querySelectorAll('.pdf-comment-block');
            for (let i = 0; i < commentBlocks.length; i++) {
                const block = commentBlocks[i] as HTMLElement;
                const blockRect = block.getBoundingClientRect();
                const blockWidth = blockRect.width > 0 ? blockRect.width : 1000;
                const maxScale = pdfCommentStaffScale;
                const SCALE_C = Math.min(maxScale, (pageWidth - pdfMarginLeft - pdfMarginRight) / blockWidth);
                
                let bHeight = blockRect.height * SCALE_C;
                if (cursorY + bHeight > maxContentY) {
                    doc.addPage();
                    cursorY = pdfMarginTop;
                }

                // Draw each element relative to the block
                const elementsToDraw = block.querySelectorAll('textarea, svg, .bracket, h4, span.text, .syllableText:not(.dnone), .app-index, .app-category, .app-witness-siglum');
                for (let j = 0; j < elementsToDraw.length; j++) {
                    const el = elementsToDraw[j] as HTMLElement;
                    const elRect = el.getBoundingClientRect();
                    
                    const relX = elRect.left - blockRect.left;
                    const relY = elRect.top - blockRect.top;
                    
                    const sRelX = relX * SCALE_C;
                    const sRelY = relY * SCALE_C;
                    const drawX = pdfMarginLeft + sRelX;
                    const drawY = cursorY + sRelY;
                    
                    if (el.tagName.toLowerCase() === 'svg') {
                        const rawWidth = parseFloat(el.getAttribute('width') || elRect.width.toString() || '50');
                        const rawHeight = elRect.height > 0 ? elRect.height : 100;
                        const svgWidth = rawWidth * SCALE_C;
                        const svgHeight = rawHeight * SCALE_C;
                        const originalViewBox = el.getAttribute('viewBox');
                        if (!originalViewBox) {
                            el.setAttribute('viewBox', `0 0 ${rawWidth} ${rawHeight}`);
                        }
                        await doc.svg(el as unknown as SVGElement, { x: drawX, y: drawY, width: svgWidth, height: svgHeight });
                        if (!originalViewBox) {
                            el.removeAttribute('viewBox');
                        }
                    } 
                    else if (el.classList.contains('syllableText')) {
                        const val = el.innerText.trim();
                        if (val && val !== "X" && val !== "..." && val !== "<...>") {
                            doc.setFontSize(pdfCommentFontSize);
                            doc.setFont(fontFamily, "normal");
                            doc.text(val, drawX, drawY + pdfCommentFontSize);
                        }
                    }
                    else if (el.tagName.toLowerCase() === 'textarea' || el.tagName.toLowerCase() === 'span') {
                        let val = "";
                        if (el.tagName.toLowerCase() === 'textarea') {
                            val = (el as HTMLTextAreaElement).value.trim();
                        } else {
                            val = el.innerText.trim();
                        }
                        if (val) {
                            const commentLineHeight = pdfCommentFontSize * 1.4;
                            const rightBoundary = pageWidth - pdfMarginRight;
                            let curX = drawX;
                            let textY = drawY + pdfCommentFontSize + 2;
                            const tokens = val.split(/(\(\(.*?\)\)|\{\{.*?\}\}|\[\[.*?\]\])/g);
                            
                            // Word-wrap helper: splits text into words and wraps at rightBoundary
                            const wrapAndDraw = (text: string, fontStyle: string, fontSize: number, isBoxed: boolean) => {
                              doc.setFontSize(fontSize);
                              doc.setFont(fontFamily, fontStyle);
                              // Split on whitespace, keeping the spaces as tokens
                              const words = text.split(/(\s+)/);
                              for (const word of words) {
                                if (!word) continue;
                                const wordWidth = doc.getTextWidth(word);
                                // Wrap if the word would overflow (but only if we've advanced past the left margin)
                                if (curX + wordWidth > rightBoundary && curX > drawX + 1) {
                                  curX = drawX;
                                  textY += commentLineHeight;
                                }
                                doc.text(word, curX, textY);
                                if (isBoxed) {
                                  doc.setLineWidth(0.2);
                                  doc.rect(curX - 1, textY - fontSize, wordWidth + 2, fontSize + 2);
                                }
                                curX += wordWidth;
                              }
                            };
                            
                            for (const token of tokens) {
                                if (!token) continue;
                                if (token.startsWith('((')) {
                                    const t = token.replace(/\(\(|\)\)/g, '');
                                    wrapAndDraw(t, 'normal', pdfCommentFontSize, false);
                                } else if (token.startsWith('[[')) {
                                    const t = token.replace(/\[\[|\]\]/g, '').toUpperCase();
                                    wrapAndDraw(t, 'bold', pdfCommentFontSize - 1, false);
                                } else if (token.startsWith('{{')) {
                                    const t = token.replace(/\{\{|\}\}/g, '');
                                    wrapAndDraw(t, 'normal', pdfCommentFontSize, true);
                                } else {
                                    wrapAndDraw(token, 'italic', pdfCommentFontSize, false);
                                }
                            }
                        }
                    }
                    else if (el.tagName.toLowerCase() === 'h4' || el.classList.contains('app-index')) {
                        const val = el.innerText.trim();
                        doc.setFontSize(pdfCommentTitleFontSizeActual);
                        doc.setFont(fontFamily, "bolditalic");
                        doc.text(val, drawX, drawY + pdfCommentTitleFontSizeActual);
                    }
                    else if (el.classList.contains('app-category')) {
                        const val = el.innerText.trim();
                        doc.setFontSize(pdfCommentTitleFontSizeActual);
                        doc.setFont(fontFamily, "italic");
                        doc.text(val, drawX, drawY + pdfCommentTitleFontSizeActual);
                    }
                    else if (el.classList.contains('app-witness-siglum')) {
                        const val = el.innerText.trim();
                        doc.setFontSize(pdfCommentFontSize);
                        doc.setFont(fontFamily, "bold");
                        doc.text(val, drawX, drawY + pdfCommentFontSize);
                    }
                    else if (el.classList.contains('bracket')) {
                        const bWidth = elRect.width * SCALE_C;
                        const bHeight = elRect.height * SCALE_C;
                        doc.setDrawColor(0,0,0);
                        doc.setLineWidth(pdfBracketThickness);
                        doc.line(drawX, drawY, drawX + bWidth, drawY); // top
                        doc.line(drawX + bWidth, drawY, drawX + bWidth, drawY + bHeight); // right
                        doc.line(drawX + bWidth, drawY + bHeight, drawX, drawY + bHeight); // bottom
                    }
                }
                
                cursorY += bHeight + pdfCommentBlockGap;
            }
        }

        // Draw page numbers and running headlines on all pages
        const totalPages = doc.getNumberOfPages();
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          doc.setPage(pageNum);
          
          // Page Numbers
          if (pdfShowPageNumbers) {
            doc.setFontSize(pdfPageNumberFontSize);
            doc.setFont(fontFamily, "normal");
            doc.setTextColor(120, 120, 120);
            const pageNumText = `Page ${pageNum} of ${totalPages}`;
            const pageNumWidth = doc.getTextWidth(pageNumText);
            const textY = pageHeight - (pdfMarginBottom / 2);
            doc.text(pageNumText, pdfMarginLeft + printWidth / 2 - pageNumWidth / 2, textY);
          }

          // Running Headline on page 2+
          if (pageNum > 1) {
            const headlineText = this.buildHeadlineText(pdfHeadlineMetadataFields);
            if (headlineText) {
              const headlineFontSize = pdfHeadlineFontSize;
              doc.setFontSize(pdfHeadlineFontSize);
              doc.setFont(fontFamily, "italic");
              doc.setTextColor(80, 80, 80);
              
              const splitHeadline = doc.splitTextToSize(headlineText, printWidth);
              let headlineY = pdfMarginTop / 2;
              
              for (const line of splitHeadline) {
                const lineX = pdfMarginLeft + printWidth / 2 - doc.getTextWidth(line) / 2;
                doc.text(line, lineX, headlineY);
                headlineY += headlineFontSize * 1.2;
              }
              
              const lineUnderY = headlineY - (headlineFontSize * 1.2) + 6;
              doc.setLineWidth(0.5);
              doc.setDrawColor(200, 200, 200);
              doc.line(pdfMarginLeft, lineUnderY, pageWidth - pdfMarginRight, lineUnderY);
            }
          }
        }

        doc.save(`Document_${this.document?.dokumenten_id || 'Export'}.pdf`);

      } catch (err) {
        console.error("PDF Generation failed:", err);
        this.toastr.error("Failed to generate PDF.", "Error");
      } finally {
        this.isPrinting = false;
        this.readOnly = originalReadOnly;
      }
    }, 200);
  }

  getInlineMetadataItems(): { label: string, val: string }[] {
    const items: { label: string, val: string }[] = [];
    if (!this.document) return items;
    if (this.document.dokumenten_id) items.push({ label: 'ID', val: this.document.dokumenten_id });
    if (this.document.textinitium) items.push({ label: 'Initium', val: this.document.textinitium });
    const genres = [this.document.gattung1, this.document.gattung2].filter(x => x).join(' / ');
    if (genres) items.push({ label: 'Genre', val: genres });
    const feast = [this.document.festtag, this.document.feier ? `(${this.document.feier})` : ''].filter(x => x).join(' ');
    if (feast) items.push({ label: 'Feast', val: feast });
    if (this.document.foliostart || this.document.zeilenstart) {
      items.push({ label: 'Folio/Line', val: `F: ${this.document.foliostart || ''}, L: ${this.document.zeilenstart || ''}` });
    }
    if (this.document.druckausgabe) items.push({ label: 'Edition', val: this.document.druckausgabe });
    if (this.document.bibliographischerverweis) items.push({ label: 'Ref', val: this.document.bibliographischerverweis });
    if (this.document.kommentar) items.push({ label: 'Comment', val: this.document.kommentar });
    
    if (this.settings?.customDocumentFields) {
      for (const cf of this.settings.customDocumentFields) {
        const val = this.document.custom?.[cf.key];
        if (val) {
          items.push({ label: cf.label, val });
        }
      }
    }
    return items;
  }

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

      setTimeout(() => {
        this.updateToolbar();
      }, 0);
    }));
    
    // Subscribe to query params to restore view mode
    this.subs.push(this.route.queryParams.subscribe(params => {
      if (params['view'] && ['transcription', 'split', 'iiif'].includes(params['view'])) {
        this.setViewMode(params['view'] as any, false);
      }
      if (params['focus']) {
        this.pendingFocusNoteUuid = params['focus'];
        this.applyPendingFocus();
      }
    }));
  }

  updateToolbar() {
    const source = this.route.snapshot.paramMap.get('source') || '';
    
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
          this.toastr.success("Silbentrennstriche wurden korrigiert.");
        },
        icon: 'type-strikethrough',
        title: 'Fix Syllable Dashes'
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
            this.toastr.warning(
              'No transcription data was found for this document. Starting from an empty edition — re-import to restore the original notes.',
              'Notes missing'
            );
            break;
          case 'NotesRetrieved':
            this.cont = VM.normalizeDocumentComments(res.data);
            this.contJsonClone = JSON.stringify(this.cont);
            this.checkSecondVoiceComments(this.cont);
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
        this.toastr.success(`${val} zu ${category} hinzugefügt`);
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
        this.toastr.success(`${val} zu ${category} hinzugefügt`);
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
            this.toastr.success("Erfolgreich gespeichert"); 
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
          case 'DocumentNotFound': this.toastr.error("Es sieht so aus, als wäre das Dokument zwischenzeitlich gelöscht worden"); break;
          case 'InsufficientPermissions': this.toastr.error("Sie haben nicht genügend Rechte, um dieses Dokument zu speichern. Sie können das Dokument jedoch als JSON downloaden, um die Rechte bitten und es dann wieder hochladen um Datenverlust zu vermeiden.", "Fehler beim Speichern."); break;
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
      this.toastr.error('Kein Dokument zum Exportieren geöffnet.');
      return;
    }
    try {
      const baseId = (this.document && this.document.dokumenten_id) ? this.document.dokumenten_id : 'document';
      const result = this.volpiano.exportAndDownload(this.cont, baseId + '.volpiano.txt');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(result.volpiano).then(
          () => this.toastr.success('Volpiano in die Zwischenablage kopiert und als .txt heruntergeladen.'),
          () => this.toastr.success('Volpiano als .txt heruntergeladen.')
        );
      } else {
        this.toastr.success('Volpiano als .txt heruntergeladen.');
      }
      if (result.warnings.length > 0) {
        this.toastr.warning(result.warnings.slice(0, 5).join('; '), 'Volpiano-Export mit Hinweisen');
      }
    } catch (e) {
      this.toastr.error('Volpiano-Export fehlgeschlagen: ' + e);
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
            case 'Failed': this.toastr.error("Invalides Format", "Upload gescheitert!"); break;
            case 'NotesRetrieved':
              this.cont = VM.normalizeDocumentComments(res.data);
              this.contJsonClone = JSON.stringify(this.cont);
              this.toastr.success("Upload erfolgreich!");
              this.checkSecondVoiceComments(this.cont);
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

  @HostListener('window:unload', ['$event'])
  unloadHandler($event: any) {
    this.hasChanges();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnloadHander($event: any) {
    return !this.hasChanges();
  }

  @HostListener('window:keydown', ['$event'])
  keyEvent(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.startCommentCreation();
    }
    if (event.ctrlKey && event.key === 'z') {
      this.undoService.undo();
    }
    if (event.key === 'Escape' && this.isCommentCreationMode) {
      event.preventDefault();
      this.cancelCommentCreation();
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
        this.toastr.error("Technische details können in der Konsole gesehen werden", "Text konnte nicht geparst werden");
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
          this.textImportErrors.push('Es wurden mehr als Zwei Tabstops in folgenden Zeilen erkannt: ' + errors[0]);
        }
        if (errors[1].length > 0) {
          this.textImportErrors.push('Es wurden Zwei oder mehr Leerzeichen hintereinander in folgenden Zeilen erkannt: ' + errors[1]);
        }
        if (errors[2].length > 0) {
          this.textImportErrors.push('Es wurden Leerzeichen in der ersten Spalte in folgenden Zeilen erkannt: ' + errors[2]);
        }
        if (errors[3].length > 0) {
          this.textImportErrors.push('Es wurden Zwei Tabs in Zeilen ohne Seitenumbruch in folgenden Zeilen erkannt: ' + errors[3]);
        }
      }
      this.toastr.error('Es wurden Fehler in der Eingabe erkannt.');
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
  getCommentType(c: VM.Comment): string {
    if (c.commentType) return c.commentType;
    if (c.tree) return 'tree';
    if (c.lines) return 'lines';
    return 'text';
  }

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
