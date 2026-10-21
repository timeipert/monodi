import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Subject, Subscription, debounceTime, firstValueFrom } from 'rxjs';

import { APIService, Document, ProjectSettings, Source } from '../api.service';
import { BackupReminderService } from '../backup-reminder.service';
import { HasChanges } from '../ConfirmDeactivateGuard';
import { PageTitleService } from '../page-title.service';
import { safeStorage } from '../safe-storage';
import { User, UserService } from '../user.service';
import { ANY_COLUMN, FILTER_OPS, GridFilter, opNeedsValue } from './grid-filter';
import { GridKind, UnregisteredField, buildDocumentsView, buildSourcesView, documentCountOfSources, unregisteredFields, withListedFields } from './grid-data';
import { parseTsv, toTsv } from './grid-clipboard';
import { FillPlan } from './grid-fill';
import { ReplacePlan } from './grid-replace';
import { EditResult, GridView } from './grid-view';

const TAB_KEY = 'monodi_metadata_tab';

/** Above this many rows the delete dialog asks for the number to be typed. */
const TYPE_TO_CONFIRM_ABOVE = 10;

/** Settings lists that suggest values while a cell is edited, by column key. */
const SUGGESTION_LISTS: Record<GridKind, string[]> = {
  documents: ['gattung1', 'gattung2', 'festtag', 'feier'],
  sources: ['quellensigle', 'herkunftsregion', 'herkunftsort', 'herkunftsinstitution', 'ordenstradition', 'quellentyp', 'bibliotheksort', 'bibliothek', 'bibliothekssignatur'],
};

/**
 * All documents (or all sources) as one table, edited like a spreadsheet: a cell cursor and ranges, typing and
 * pasting from Excel, filling down, undo; the edits are collected and saved with one click. Filtered by rules per
 * column and deleted in bulk. The rows are virtual-scrolled, so 20 000 documents cost as much to draw as 40.
 */
@Component({
  selector: 'app-metadata-grid',
  templateUrl: './metadata-grid.component.html',
  styleUrls: ['./metadata-grid.component.css'],
  standalone: false,
})
export class MetadataGridComponent implements OnInit, OnDestroy, HasChanges {
  readonly ops = FILTER_OPS;
  readonly anyColumn = ANY_COLUMN;
  readonly rowHeight = 32;
  readonly leadingWidth = GridView.LEADING_WIDTH;

  active: GridKind = safeStorage.get(TAB_KEY) === 'sources' ? 'sources' : 'documents';
  views: Record<GridKind, GridView | null> = { documents: null, sources: null };
  suggestions: Record<GridKind, Record<string, string[]>> = { documents: {}, sources: {} };
  loading = true;
  loadError = '';

  showDelete = false;
  showImport = false;
  showRelations = false;
  showFill = false;
  showReplace = false;
  /** Custom values in the data that no field of the settings lists, per table. */
  unregistered: Record<GridKind, UnregisteredField[]> = { documents: [], sources: [] };
  listBusy = false;
  deleteBusy = false;
  typedCount = '';

  /** The cell that is being typed into, and what has been typed so far. */
  editing: { pos: number; ci: number } | null = null;
  editText = '';
  saveBusy = false;

  private user: User | null = null;
  private documents: Document[] = [];
  private sources: Source[] = [];
  private settings: ProjectSettings | null = null;
  private subs: Subscription[] = [];
  private refreshRequests = new Subject<void>();
  private scrollCleanup: (() => void) | null = null;
  private dragCleanup: (() => void) | null = null;
  private viewportEl: HTMLElement | null = null;
  private viewportRef: CdkVirtualScrollViewport | null = null;
  @ViewChild('headerScroller') private headerScroller?: ElementRef<HTMLElement>;
  @ViewChild('gridEl') private gridEl?: ElementRef<HTMLElement>;

  constructor(
    private api: APIService,
    private userService: UserService,
    private toastr: ToastrService,
    private router: Router,
    private pageTitle: PageTitleService,
    private backup: BackupReminderService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.pageTitle.set('Metadata');
    // typing in a rule's value or the quick search refilters once, shortly after the last key
    this.subs.push(this.refreshRequests.pipe(debounceTime(150)).subscribe(() => {
      this.view?.refresh();
      this.cdr.markForCheck();
    }));
    this.subs.push(this.userService.user.subscribe((user) => {
      this.user = user;
      if (user) void this.load();
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.scrollCleanup?.();
    this.dragCleanup?.();
  }

  /** Closing the tab with unsaved edits asks first (the router guard covers leaving the page inside the app). */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  hasChanges(): boolean {
    return this.views.documents?.dirtyCount ? true : !!this.views.sources?.dirtyCount;
  }

  /** The grid body appears once data is there; keep the column header scrolled sideways with it. */
  @ViewChild(CdkVirtualScrollViewport)
  set viewport(vp: CdkVirtualScrollViewport | undefined) {
    this.scrollCleanup?.();
    this.scrollCleanup = null;
    this.viewportRef = vp ?? null;
    this.viewportEl = vp?.elementRef.nativeElement ?? null;
    if (!vp) return;
    const el = vp.elementRef.nativeElement;
    const sync = () => { if (this.headerScroller) this.headerScroller.nativeElement.scrollLeft = el.scrollLeft; };
    // every scroll event would otherwise cost a change-detection pass
    this.zone.runOutsideAngular(() => el.addEventListener('scroll', sync, { passive: true }));
    this.scrollCleanup = () => el.removeEventListener('scroll', sync);
  }

  /** Focuses the input as soon as a cell turns into one. */
  @ViewChild('cellInput')
  set cellInput(ref: ElementRef<HTMLInputElement> | undefined) {
    if (!ref) return;
    const input = ref.nativeElement;
    void Promise.resolve().then(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  get view(): GridView | null {
    return this.views[this.active];
  }

  // --- loading ---

  /** Reads sources, documents and settings and rebuilds both tables; filters and sorting carry over. */
  async load(): Promise<void> {
    if (!this.user) return;
    this.loadError = '';
    try {
      const token = this.user.token;
      const [src, doc, set] = await Promise.all([
        firstValueFrom(this.api.listSources(token)),
        firstValueFrom(this.api.listDocuments(token)),
        firstValueFrom(this.api.getSettings(token)),
      ]);
      if (src.kind !== 'SourcesRetrieved' || doc.kind !== 'DocumentsRetrieved') {
        this.userService.logout();
        return;
      }
      this.sources = src.sources;
      this.documents = doc.documents;
      this.settings = set.kind === 'SettingsRetrieved' ? set.settings : null;
      const next = {
        documents: buildDocumentsView(this.documents, this.sources, this.settings),
        sources: buildSourcesView(this.sources, this.documents, this.settings),
      };
      for (const kind of ['documents', 'sources'] as const) {
        const old = this.views[kind];
        if (old) next[kind].adopt(old);
      }
      this.unregistered = { documents: unregisteredFields('documents', this.documents, this.settings), sources: unregisteredFields('sources', this.sources, this.settings) };
      this.editing = null;
      this.views = next;
      this.suggestions = {
        documents: this.suggestionsFor('documents'),
        sources: this.suggestionsFor('sources'),
      };
    } catch (e) {
      console.warn('Metadata grid: loading failed', e);
      this.loadError = 'The metadata could not be loaded.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private suggestionsFor(kind: GridKind): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const s = this.settings as unknown as Record<string, unknown> | null;
    for (const key of SUGGESTION_LISTS[kind]) {
      const list = s?.[key];
      if (Array.isArray(list) && list.length) out[key] = list.filter((x): x is string => typeof x === 'string');
    }
    return out;
  }

  /** The columns that have a suggestion list, for the `<datalist>`s. */
  get suggestionColumns(): string[] {
    return Object.keys(this.suggestions[this.active]);
  }

  setActive(kind: GridKind): void {
    this.commitEdit();
    this.active = kind;
    safeStorage.set(TAB_KEY, kind);
  }

  // --- filters ---

  /** Shows one document of the relations check: its ID in the search of the documents table. */
  findDocument(dokumentenId: string): void {
    this.showRelations = false;
    this.setActive('documents');
    const v = this.view;
    if (!v) return;
    v.quick = dokumentenId;
    v.refresh();
  }

  addFilter(): void {
    this.view?.addFilter();
  }

  removeFilter(f: GridFilter): void {
    this.view?.removeFilter(f.id);
  }

  /** A rule or the quick search changed: refilter now (selects, toggles) or shortly (typing). */
  filtersChanged(immediately = true): void {
    if (immediately) this.view?.refresh();
    else this.refreshRequests.next();
  }

  needsValue(f: GridFilter): boolean {
    return opNeedsValue(f.op);
  }

  // --- row selection ---

  rowCheck(pos: number, event: MouseEvent): void {
    this.view?.toggleAt(pos, event.shiftKey);
  }

  /** Opens a row in its own editor (document or source). */
  open(row: number): void {
    const v = this.view;
    if (!v) return;
    if (this.active === 'documents') {
      const doc = this.documents.find((d) => d.id === v.ids[row]);
      if (doc) void this.router.navigate(['/document', doc.quelle_id || 'new', doc.id]);
    } else {
      void this.router.navigate(['/source', v.ids[row]]);
    }
  }

  // --- cell cursor: mouse ---

  isActive(pos: number, ci: number): boolean {
    const a = this.view?.anchor;
    return !!a && a.pos === pos && a.ci === ci;
  }

  isEditingCell(pos: number, ci: number): boolean {
    return !!this.editing && this.editing.pos === pos && this.editing.ci === ci;
  }

  private cellOf(target: EventTarget | null): { pos: number; ci: number } | null {
    const el = (target as HTMLElement | null)?.closest?.('.mg-cell') as HTMLElement | null;
    if (!el) return null;
    const pos = Number(el.dataset['pos']);
    const ci = Number(el.dataset['ci']);
    return Number.isInteger(pos) && Number.isInteger(ci) ? { pos, ci } : null;
  }

  /** Mouse down on a cell: put the cursor there (shift extends the range) and start a drag selection. */
  bodyMouseDown(event: MouseEvent): void {
    const view = this.view;
    const cell = this.cellOf(event.target);
    if (!view || !cell || event.button !== 0) return;
    if (this.editing && this.isEditingCell(cell.pos, cell.ci)) return;   // clicks inside the input are the input's
    this.commitEdit();
    event.preventDefault();                       // no text selection, and the focus stays under our control
    this.focusGrid();
    view.selectCell(cell.pos, cell.ci, event.shiftKey);
    this.startDrag();
  }

  /** While the button is down, the range follows the pointer. The listeners live outside the zone: only a change of cell costs a render. */
  private startDrag(): void {
    const el = this.viewportEl;
    if (!el) return;
    this.dragCleanup?.();
    let last = '';
    const over = (e: MouseEvent) => {
      const cell = this.cellOf(e.target);
      if (!cell || `${cell.pos}:${cell.ci}` === last) return;
      last = `${cell.pos}:${cell.ci}`;
      this.zone.run(() => this.view?.selectCell(cell.pos, cell.ci, true));
    };
    const up = () => { this.dragCleanup?.(); };
    this.zone.runOutsideAngular(() => {
      el.addEventListener('mouseover', over);
      document.addEventListener('mouseup', up);
    });
    this.dragCleanup = () => {
      el.removeEventListener('mouseover', over);
      document.removeEventListener('mouseup', up);
      this.dragCleanup = null;
    };
  }

  bodyDoubleClick(event: MouseEvent): void {
    const cell = this.cellOf(event.target);
    if (cell) this.startEdit(cell.pos, cell.ci);
  }

  private focusGrid(): void {
    this.gridEl?.nativeElement.focus({ preventScroll: true });
  }

  // --- cell cursor: keyboard ---

  onGridKey(event: KeyboardEvent): void {
    const view = this.view;
    if (!view || this.editing) return;
    if ((event.target as HTMLElement | null)?.closest('input, select, textarea, button, a')) return;   // the filter rules and buttons have their own keys
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;

    const move = (dPos: number, dCi: number) => {
      view.moveCursor(dPos, dCi, event.shiftKey);
      this.ensureVisible();
      event.preventDefault();
    };
    const jump = (pos: number | null, ci: number | null) => {
      const from = event.shiftKey ? view.focusCell : view.anchor;
      view.selectCell(pos ?? from?.pos ?? 0, ci ?? from?.ci ?? 0, event.shiftKey);
      this.ensureVisible();
      event.preventDefault();
    };
    const last = view.viewIdx.length - 1;
    const lastCol = view.columns.length - 1;

    switch (key) {
      case 'ArrowDown': return mod ? jump(last, null) : move(1, 0);
      case 'ArrowUp': return mod ? jump(0, null) : move(-1, 0);
      case 'ArrowRight': return mod ? jump(null, lastCol) : move(0, 1);
      case 'ArrowLeft': return mod ? jump(null, 0) : move(0, -1);
      case 'PageDown': return move(this.pageRows, 0);
      case 'PageUp': return move(-this.pageRows, 0);
      case 'Home': return mod ? jump(0, 0) : jump(null, 0);
      case 'End': return mod ? jump(last, lastCol) : jump(null, lastCol);
      case 'Tab': {
        const a = view.anchor;
        if (!a) { view.selectCell(0, 0); event.preventDefault(); return; }
        const dir = event.shiftKey ? -1 : 1;
        // at the end of a row, Tab goes to the start of the next
        if (dir === 1 && a.ci === lastCol && a.pos < last) view.selectCell(a.pos + 1, 0);
        else if (dir === -1 && a.ci === 0 && a.pos > 0) view.selectCell(a.pos - 1, lastCol);
        else view.selectCell(a.pos, a.ci + dir);
        this.ensureVisible();
        event.preventDefault();
        return;
      }
      case 'Enter':
      case 'F2':
        if (view.anchor) this.startEdit(view.anchor.pos, view.anchor.ci);
        event.preventDefault();
        return;
      case 'Delete':
      case 'Backspace':
        if (view.range()) this.report(view.clearRange(), 'Cleared');
        event.preventDefault();
        return;
      case 'Escape':
        view.clearCellSelection();
        return;
      case ' ':
        if (mod) { if (view.anchor) view.selectColumn(view.anchor.ci); event.preventDefault(); return; }
        if (event.shiftKey) { if (view.anchor) view.selectRowCells(view.anchor.pos); event.preventDefault(); return; }
        break;
    }

    if (mod) {
      const k = key.toLowerCase();
      if (k === 'a') { view.selectAllCells(); event.preventDefault(); }
      else if (k === 'd') { this.report(view.fillDown(), 'Filled down'); event.preventDefault(); }
      else if (k === 'z') { (event.shiftKey ? view.redo() : view.undo()); event.preventDefault(); }
      else if (k === 'y') { view.redo(); event.preventDefault(); }
      else if (k === 's') { void this.save(); event.preventDefault(); }
      else if (k === 'h') { this.commitEdit(); this.showReplace = true; event.preventDefault(); }
      return;
    }

    // a printable key starts typing into the cell, replacing what is there (like a spreadsheet)
    if (key.length === 1 && !event.altKey && view.anchor) {
      this.startEdit(view.anchor.pos, view.anchor.ci, key);
      event.preventDefault();
    }
  }

  /** About one screen of rows. */
  private get pageRows(): number {
    const h = this.viewportEl?.clientHeight ?? 400;
    return Math.max(1, Math.floor(h / this.rowHeight) - 1);
  }

  /** Scrolls the grid so the cell under the cursor (the free end of the range) is on screen. */
  private ensureVisible(): void {
    const view = this.view;
    const el = this.viewportEl;
    const vp = this.viewportRef;
    const cell = view?.focusCell;
    if (!view || !el || !vp || !cell) return;
    // rows
    const top = cell.pos * this.rowHeight;
    const viewH = el.clientHeight;
    const offset = vp.measureScrollOffset('top');
    if (top < offset) vp.scrollToOffset(top);
    else if (top + this.rowHeight > offset + viewH) vp.scrollToOffset(top + this.rowHeight - viewH);
    // columns
    let left = GridView.LEADING_WIDTH;
    for (let c = 0; c < cell.ci; c++) left += view.columns[c].width;
    const right = left + view.columns[cell.ci].width;
    if (left - GridView.LEADING_WIDTH < el.scrollLeft) el.scrollLeft = Math.max(0, left - GridView.LEADING_WIDTH);
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }

  // --- editing a cell ---

  /** Turns a cell into an input. `initial` replaces the content (typing over a cell); without it the text is kept. */
  startEdit(pos: number, ci: number, initial?: string): void {
    const view = this.view;
    if (!view) return;
    if (!view.isEditable(ci)) {
      this.toastr.info(`“${view.columns[ci].label}” cannot be edited here.`);
      return;
    }
    // editing the cell the range starts at keeps the range (Ctrl+Enter fills all of it); any other cell becomes the cursor
    if (!this.isActive(pos, ci)) view.selectCell(pos, ci);
    this.editText = initial ?? view.cellValue(pos, ci);
    this.editing = { pos, ci };
    this.ensureVisible();
  }

  /** Keys inside the cell input. Enter/Tab keep the text and move on, Escape drops it, Ctrl+Enter writes it into the whole range. */
  editKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.commitEdit(0, 0, true);
      else this.commitEdit(event.shiftKey ? -1 : 1, 0);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.commitEdit(0, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    if (!this.editing) return;
    this.editing = null;
    this.focusGrid();
  }

  /** Writes the typed text into the cell (or, with `fill`, into the whole range) and moves the cursor. */
  commitEdit(dPos = 0, dCi = 0, fill = false): void {
    const view = this.view;
    const edit = this.editing;
    if (!view || !edit) return;
    this.editing = null;                  // first: the blur this focus change causes must find nothing to commit
    this.focusGrid();
    const res = fill ? view.fillRange(this.editText) : view.setCellsAt([{ pos: edit.pos, ci: edit.ci, value: this.editText }]);
    if (res.rejected > 0) this.toastr.warning(`“${view.columns[edit.ci].label}” cannot be empty.`);
    if (dPos || dCi) {
      view.selectCell(edit.pos + dPos, edit.ci + dCi);
      this.ensureVisible();
    }
  }

  // --- clipboard ---

  onCopy(event: ClipboardEvent): void {
    const view = this.view;
    if (!view || this.editing || !view.range() || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', toTsv(view.rangeValues()));
    event.preventDefault();
  }

  onCut(event: ClipboardEvent): void {
    const view = this.view;
    if (!view || this.editing || !view.range() || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', toTsv(view.rangeValues()));
    event.preventDefault();
    this.report(view.clearRange(), 'Cut');
  }

  onPaste(event: ClipboardEvent): void {
    const view = this.view;
    if (!view || this.editing || !view.range()) return;
    if ((event.target as HTMLElement | null)?.closest('input, textarea')) return;   // a filter field gets its own paste
    const text = event.clipboardData?.getData('text/plain') ?? '';
    event.preventDefault();
    if (!text) return;
    this.report(view.pasteMatrix(parseTsv(text)), 'Pasted');
  }

  /** What a bulk write did, in words, when something was left out. */
  private report(res: EditResult, verb: string): void {
    const parts: string[] = [];
    if (res.rejected > 0) parts.push(`${res.rejected} cell(s) not changed (read-only column, or empty where a value is required)`);
    if (res.outside > 0) parts.push(`${res.outside} cell(s) were outside the table`);
    if (parts.length) this.toastr.warning(`${verb} ${res.applied} cell(s); ${parts.join('; ')}.`);
  }

  /** Lists the custom values the data carries (an import brought them) as fields: from now on the table, the form and the print show them. */
  async listUnregistered(): Promise<void> {
    const kind = this.active;
    const keys = this.unregistered[kind].map((f) => f.key);
    if (!this.user || !keys.length || this.listBusy || this.totalDirty > 0) return;
    this.listBusy = true;
    try {
      const token = this.user.token;
      const res = await firstValueFrom(this.api.getSettings(token));
      if (res.kind !== 'SettingsRetrieved') throw new Error('The settings could not be read.');
      const next = withListedFields(res.settings, kind, keys);
      if (next) await firstValueFrom(this.api.updateSettings(token, next));
      this.toastr.success(`${keys.length} field(s) are shown in the table now.`);
      await this.load();
    } catch (e: any) {
      console.error('Listing the fields failed', e);
      this.toastr.error('The fields could not be listed: ' + (e?.message || e));
    } finally {
      this.listBusy = false;
      this.cdr.markForCheck();
    }
  }

  /** The plan of the "Fill a column" dialog goes into the table as edits: one undo step, saved like the others. */
  applyFill(plan: FillPlan): void {
    const view = this.view;
    this.showFill = false;
    if (!view) return;
    const res = view.setCells(plan.changes);
    this.report(res, 'Filled');
    this.cdr.markForCheck();
  }

  /** The plan of "Find and replace" goes into the table as edits: one undo step, saved like the others. */
  applyReplace(plan: ReplacePlan): void {
    const view = this.view;
    this.showReplace = false;
    if (!view) return;
    const res = view.setCells(plan.changes);
    this.report(res, 'Replaced');
    this.cdr.markForCheck();
  }

  undo(): void {
    this.commitEdit();
    this.view?.undo();
  }

  redo(): void {
    this.view?.redo();
  }

  // --- saving ---

  get totalDirty(): number {
    return (this.views.documents?.dirtyCount ?? 0) + (this.views.sources?.dirtyCount ?? 0);
  }

  async save(): Promise<void> {
    this.commitEdit();
    if (!this.user || this.saveBusy || this.totalDirty === 0) return;
    const token = this.user.token;
    this.saveBusy = true;
    try {
      let saved = 0;
      let failed = false;
      for (const kind of ['sources', 'documents'] as const) {
        const view = this.views[kind];
        const changes = view?.changes() ?? [];
        if (changes.length === 0) continue;
        const res = await firstValueFrom(kind === 'documents'
          ? this.api.updateDocumentsMetadata(token, changes)
          : this.api.updateSourcesMetadata(token, changes));
        if (res.kind === 'MetadataUpdated') {
          saved += res.updated;
          if (res.missing > 0) this.toastr.warning(`${res.missing} ${kind} no longer exist; their edits were skipped.`);
        } else {
          failed = true;
        }
      }
      if (failed) {
        this.toastr.error('Saving failed. Your edits are still here.');
      } else {
        this.toastr.success(`Saved ${saved} ${saved === 1 ? 'row' : 'rows'}.`);
        await this.load();               // the tables are rebuilt from what is stored; filters and sort carry over
      }
    } catch (e) {
      console.warn('Metadata grid: saving failed', e);
      this.toastr.error('Saving failed. Your edits are still here.');
    } finally {
      this.saveBusy = false;
      this.cdr.markForCheck();
    }
  }

  discard(): void {
    this.editing = null;
    this.views.documents?.discardEdits();
    this.views.sources?.discardEdits();
  }

  // --- deleting ---

  /** The number the user has to type to confirm; null for small deletions. */
  get requiredTyping(): string | null {
    const n = this.view?.selectedCount ?? 0;
    return n > TYPE_TO_CONFIRM_ABOVE ? String(n) : null;
  }

  get canConfirmDelete(): boolean {
    if (this.deleteBusy || !this.view || this.view.selectedCount === 0) return false;
    return this.requiredTyping === null || this.typedCount.trim() === this.requiredTyping;
  }

  /** For sources: how many documents go with them. */
  get cascadingDocuments(): number {
    if (this.active !== 'sources' || !this.view) return 0;
    return documentCountOfSources(this.view.selectedIds(), this.documents);
  }

  get hasUnbackedChanges(): boolean {
    return this.backup.hasUnbackedChanges();
  }

  askDelete(): void {
    // the tables are rebuilt after a delete; edits that were not saved would be lost with them
    if (!this.view || this.view.selectedCount === 0 || this.totalDirty > 0) return;
    this.typedCount = '';
    this.showDelete = true;
  }

  closeDelete(): void {
    if (this.deleteBusy) return;
    this.showDelete = false;
  }

  async confirmDelete(): Promise<void> {
    const view = this.view;
    if (!view || !this.user || !this.canConfirmDelete) return;
    const kind = this.active;
    const ids = view.selectedIds();
    this.deleteBusy = true;
    try {
      const token = this.user.token;
      const res = await firstValueFrom(kind === 'documents'
        ? this.api.deleteDocuments(token, JSON.stringify(ids))
        : this.api.deleteSources(token, JSON.stringify(ids)));
      if (res.kind === 'UploadFinished') {
        this.toastr.success(`${ids.length} ${kind === 'documents' ? 'document(s)' : 'source(s)'} deleted.`);
        this.showDelete = false;
        // a deleted source takes its documents with it, so both tables are rebuilt
        await this.load();
      } else {
        this.toastr.error('Deleting failed.');
      }
    } catch (e) {
      console.warn('Metadata grid: delete failed', e);
      this.toastr.error('Deleting failed.');
    } finally {
      this.deleteBusy = false;
      this.cdr.markForCheck();
    }
  }
}
