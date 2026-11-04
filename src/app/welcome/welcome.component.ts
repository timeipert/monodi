import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { PageTitleService } from '../page-title.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { BackupReminderService } from '../backup-reminder.service';
import { forkJoin, take } from 'rxjs';

/** How many sources the dashboard lists. */
const MAX_TOP_SOURCES = 6;

/** A source as listed on the start page. */
interface SourceRow { id: string; sigle: string; docCount: number; }

/** Backup situation of this browser's workspace: never backed up, changed since the last backup, or in sync. */
type BackupState = 'none' | 'dirty' | 'clean';

/**
 * Start page. Without sources it is a short introduction for newcomers; with sources it is a
 * workspace dashboard: continue the last document, search, see the backup state, jump to the
 * everyday actions, and open recent documents and sources.
 */
@Component({
    selector: 'app-welcome',
    templateUrl: './welcome.component.html',
    styleUrls: ['./welcome.component.css'],
    standalone: false
})
export class WelcomeComponent implements OnInit {
  sourcesCount = 0;
  documentsCount = 0;
  recentDocuments: any[] = [];
  recentSearches: string[] = [];
  sourceNamesMap: { [id: string]: string } = {};
  topSources: SourceRow[] = [];
  hasData = false;
  loading = true;

  /** Text of the search field at the top of the dashboard. */
  quickQuery = '';
  /** Time of the last recorded edit (ms since 1970); 0 when unknown. */
  lastEditAt = 0;
  lastBackupAt = 0;
  backupState: BackupState = 'none';
  /** Route of the "New document" tile: the source of the last opened document, else the first source. */
  newDocumentRoute: any[] = ['/sources'];
  newDocumentSourceName = 'a source';

  constructor(
    private pageTitle: PageTitleService,
    private modalService: NgbModal,
    public api: APIService,
    private userService: UserService,
    private backup: BackupReminderService,
    private router: Router,
  ) { }

  ngOnInit() {
    this.pageTitle.reset(); // Just "Monodi" on the home page
    this.loadDashboardData();
  }

  /** The most recently opened document, shown in the "Continue" card. */
  get continueDoc(): any | undefined {
    return this.recentDocuments[0];
  }

  loadDashboardData() {
    this.loading = true;
    // `user` never completes: take the current one, or this page would stay subscribed after it is left.
    this.userService.user.pipe(take(1)).subscribe(user => {
      if (user) {
        forkJoin({
          sourcesRes: this.api.listSources(user.token),
          docsRes: this.api.listDocuments(user.token)
        }).subscribe({
          next: (res) => {
            const sources = res.sourcesRes.kind === 'SourcesRetrieved' ? res.sourcesRes.sources : [];
            const docs = res.docsRes.kind === 'DocumentsRetrieved' ? res.docsRes.documents : [];
            this.sourcesCount = sources.length;
            this.documentsCount = docs.length;
            this.sourceNamesMap = {};
            for (const s of sources) {
              if (s.id) this.sourceNamesMap[s.id] = s.quellensigle || s.id;
            }

            this.hasData = this.sourcesCount > 0;

            if (this.hasData) {
              this.loadRecentSearches();
              this.loadRecentDocuments(docs);
              this.buildSourceList(sources, docs);
              this.loadBackupState();
            }

            this.loading = false;
          },
          error: (err) => {
            console.error('Failed to load dashboard statistics:', err);
            this.loading = false;
          }
        });
      } else {
        this.loading = false;
      }
    });
  }

  loadRecentSearches() {
    try {
      this.recentSearches = JSON.parse(localStorage.getItem('monodi_search_recent') || '[]');
    } catch {
      this.recentSearches = [];
    }
  }

  loadRecentDocuments(allDocs: any[]) {
    try {
      const recentDocsRaw = localStorage.getItem('monodi_recent_documents');
      let recent = recentDocsRaw ? JSON.parse(recentDocsRaw) : [];
      const docIds = new Set(allDocs.map(d => d.id));
      this.recentDocuments = recent.filter((d: any) => docIds.has(d.id));
    } catch {
      this.recentDocuments = [];
    }
  }

  /** Sources ordered by last use (from the recent documents), then by number of documents. */
  private buildSourceList(sources: any[], docs: any[]) {
    const counts = new Map<string, number>();
    for (const d of docs) counts.set(d.quelle_id, (counts.get(d.quelle_id) ?? 0) + 1);
    const lastUse = new Map<string, number>();
    this.recentDocuments.forEach((d, i) => { if (!lastUse.has(d.quelle_id)) lastUse.set(d.quelle_id, i); });
    const rows: SourceRow[] = sources
      .filter(s => !!s.id)
      .map(s => ({ id: s.id as string, sigle: s.quellensigle || (s.id as string), docCount: counts.get(s.id as string) ?? 0 }));
    rows.sort((a, b) =>
      (lastUse.get(a.id) ?? Infinity) - (lastUse.get(b.id) ?? Infinity)
      || b.docCount - a.docCount
      || a.sigle.localeCompare(b.sigle));
    this.topSources = rows.slice(0, MAX_TOP_SOURCES);

    const target = this.continueDoc ? rows.find(r => r.id === this.continueDoc.quelle_id) : undefined;
    const source = target ?? rows[0];
    if (source) {
      this.newDocumentRoute = ['/document', source.id];
      this.newDocumentSourceName = source.sigle;
    }
  }

  private loadBackupState() {
    this.lastEditAt = this.backup.lastChangeAt();
    this.lastBackupAt = this.backup.lastBackupAt();
    this.backupState = this.backup.hasUnbackedChanges() ? 'dirty' : this.lastBackupAt > 0 ? 'clean' : 'none';
  }

  /** Opens the search page with the typed text (the search page reads it from `?q=`). */
  quickSearch() {
    const q = this.quickQuery.trim();
    this.router.navigate(['/search'], q ? { queryParams: { q } } : {});
  }

  openCredits(content: any) {
    this.modalService.open(content, { centered: true });
  }

  getSourceName(quelleId: string): string {
    return this.sourceNamesMap[quelleId] || quelleId;
  }
}
