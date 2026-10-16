import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Subject, Subscription, debounceTime, firstValueFrom } from 'rxjs';

import { APIService, Document, ProjectSettings, Source } from '../api.service';
import { BackupReminderService } from '../backup-reminder.service';
import { PageTitleService } from '../page-title.service';
import { safeStorage } from '../safe-storage';
import { User, UserService } from '../user.service';
import { ANY_COLUMN, FILTER_OPS, GridFilter, opNeedsValue } from './grid-filter';
import { GridKind, buildDocumentsView, buildSourcesView, documentCountOfSources } from './grid-data';
import { GridView } from './grid-view';

const TAB_KEY = 'monodi_metadata_tab';

/** Above this many rows the delete dialog asks for the number to be typed. */
const TYPE_TO_CONFIRM_ABOVE = 10;

/**
 * All documents (or all sources) as one table that is filtered by rules per column and can be deleted in bulk.
 * The rows are virtual-scrolled, so 20 000 documents cost as much to draw as 40.
 */
@Component({
  selector: 'app-metadata-grid',
  templateUrl: './metadata-grid.component.html',
  styleUrls: ['./metadata-grid.component.css'],
  standalone: false,
})
export class MetadataGridComponent implements OnInit, OnDestroy {
  readonly ops = FILTER_OPS;
  readonly anyColumn = ANY_COLUMN;
  readonly rowHeight = 32;
  readonly leadingWidth = GridView.LEADING_WIDTH;

  active: GridKind = safeStorage.get(TAB_KEY) === 'sources' ? 'sources' : 'documents';
  views: Record<GridKind, GridView | null> = { documents: null, sources: null };
  loading = true;
  loadError = '';

  showDelete = false;
  deleteBusy = false;
  typedCount = '';

  private user: User | null = null;
  private documents: Document[] = [];
  private sources: Source[] = [];
  private settings: ProjectSettings | null = null;
  private subs: Subscription[] = [];
  private refreshRequests = new Subject<void>();
  private scrollCleanup: (() => void) | null = null;
  @ViewChild('headerScroller') private headerScroller?: ElementRef<HTMLElement>;

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
  }

  /** The grid body appears once data is there; keep the column header scrolled sideways with it. */
  @ViewChild(CdkVirtualScrollViewport)
  set viewport(vp: CdkVirtualScrollViewport | undefined) {
    this.scrollCleanup?.();
    this.scrollCleanup = null;
    if (!vp) return;
    const el = vp.elementRef.nativeElement;
    const sync = () => { if (this.headerScroller) this.headerScroller.nativeElement.scrollLeft = el.scrollLeft; };
    // every scroll event would otherwise cost a change-detection pass
    this.zone.runOutsideAngular(() => el.addEventListener('scroll', sync, { passive: true }));
    this.scrollCleanup = () => el.removeEventListener('scroll', sync);
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
      this.views = next;
    } catch (e) {
      console.warn('Metadata grid: loading failed', e);
      this.loadError = 'The metadata could not be loaded.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  setActive(kind: GridKind): void {
    this.active = kind;
    safeStorage.set(TAB_KEY, kind);
  }

  // --- filters ---

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

  // --- selection ---

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
    if (!this.view || this.view.selectedCount === 0) return;
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
