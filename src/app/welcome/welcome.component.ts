import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { PageTitleService } from '../page-title.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { GithubService } from '../github.service';
import { ToastrService } from 'ngx-toastr';
import { forkJoin } from 'rxjs';

@Component({
    selector: 'app-welcome',
    templateUrl: './welcome.component.html',
    styleUrls: ['./welcome.component.css'],
    standalone: false
})
export class WelcomeComponent implements OnInit {
  sourcesCount = 0;
  documentsCount = 0;
  storageUsed = '0 B';
  storageQuota = '0 B';
  storagePct = 0;
  isGithubConnected = false;
  githubRepo = '';
  recentDocuments: any[] = [];
  recentSearches: string[] = [];
  sourceNamesMap: { [id: string]: string } = {};
  hasData = false;
  loading = true;

  constructor(
    private pageTitle: PageTitleService,
    private modalService: NgbModal,
    public api: APIService,
    private userService: UserService,
    public github: GithubService,
    private toastr: ToastrService,
    private cdRef: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.pageTitle.reset(); // Just "Monodi" on the home page
    this.loadDashboardData();
  }

  loadDashboardData() {
    this.loading = true;
    this.userService.user.subscribe(user => {
      if (user) {
        forkJoin({
          sourcesRes: this.api.listSources(user.token),
          docsRes: this.api.listDocuments(user.token)
        }).subscribe({
          next: (res) => {
            if (res.sourcesRes.kind === 'SourcesRetrieved') {
              this.sourcesCount = res.sourcesRes.sources.length;
              this.sourceNamesMap = {};
              for (const s of res.sourcesRes.sources) {
                if (s.id) {
                  this.sourceNamesMap[s.id] = s.quellensigle || s.id;
                }
              }
            }
            if (res.docsRes.kind === 'DocumentsRetrieved') {
              this.documentsCount = res.docsRes.documents.length;
            }

            this.hasData = this.sourcesCount > 0;

            if (this.hasData) {
              this.loadRecentSearches();
              this.loadRecentDocuments(res.docsRes.kind === 'DocumentsRetrieved' ? res.docsRes.documents : []);
              this.loadStorageStats();
              this.loadGithubStatus();
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

  loadStorageStats() {
    if ('storage' in navigator && typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then(est => {
        if (est.usage !== undefined && est.quota !== undefined) {
          this.storageUsed = this.formatBytes(est.usage);
          this.storageQuota = this.formatBytes(est.quota);
          this.storagePct = Math.min(100, Math.round((est.usage / est.quota) * 100));
        }
      }).catch(err => {
        console.warn('Storage estimate failed:', err);
      });
    }
  }

  loadGithubStatus() {
    this.isGithubConnected = !!(this.github.config && this.github.config.token);
    this.githubRepo = this.isGithubConnected ? `${this.github.config?.owner}/${this.github.config?.repo}` : '';
  }

  formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const persisted = await navigator.storage.persist();
        this.api.storagePersisted = persisted;
        if (persisted) {
          this.toastr.success('Workspace storage is now protected from eviction.', 'Storage Protected');
        } else {
          this.toastr.warning(
            'Browser rejected persistence request. To protect data, bookmark this app, grant notifications, or add it to your home screen.',
            'Eviction Protection Rejected'
          );
        }
        this.loadStorageStats();
        this.cdRef.markForCheck();
      } catch (err) {
        this.toastr.error('Failed to request storage persistence: ' + err, 'Request Failed');
      }
    } else {
      this.toastr.error('Storage Persistence API is not supported by your browser.', 'Unsupported');
    }
  }

  openCredits(content: any) {
    this.modalService.open(content, { centered: true });
  }

  getSourceName(quelleId: string): string {
    return this.sourceNamesMap[quelleId] || quelleId;
  }
}
