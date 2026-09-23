import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { APIService } from './api.service'
import { StackEntry, ToolsService, Tool} from './tools.service';
import { UserService, User } from './user.service';
import { GithubService } from './github.service';
import { UndoService } from './undoService';
import { ContextMenuService } from './context-menu/context-menu.service';
import { BackupReminderService } from './backup-reminder.service';
import * as localforage from 'localforage';
import * as _ from 'lodash';
import { NotesStore } from './notes-store';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false
})
export class AppComponent {
  title = 'app';

  user: User | null = null;
  tools!: StackEntry;
  toolHasParent: boolean = false;
  isSyncing = false;
  syncProgress: { phase: string; current: number; total: number } | null = null;
  isOnline: boolean = navigator.onLine;

  get syncPercent(): number {
    if (!this.syncProgress || this.syncProgress.total <= 0) return 0;
    return Math.round((this.syncProgress.current / this.syncProgress.total) * 100);
  }
  showBackupReminder = false;
  /** Mobile/tablet navbar collapse state (driven by ng-bootstrap's ngbCollapse). */
  isNavCollapsed = true;

  constructor (
    private api: APIService,
    private userService: UserService,
    private toolsService: ToolsService,
    public github: GithubService,
    public undoService: UndoService,
    public router: Router,
    private contextMenuService: ContextMenuService,
    private backupReminder: BackupReminderService
  ) {
    userService.user.subscribe(u => this.user = u);
    toolsService.subscribe((ts, hasParent) => { this.tools = ts; this.toolHasParent = hasParent });
    window.addEventListener('online', () => this.isOnline = true);
    window.addEventListener('offline', () => this.isOnline = false);
    this.backupReminder.visible$.subscribe(v => this.showBackupReminder = v);
  }

  /** Backup reminder banner actions. */
  goToBackup(): void {
    this.showBackupReminder = false;
    this.router.navigate(['/import-export']);
  }
  snoozeBackup(): void {
    this.backupReminder.snooze();
  }
  dismissBackupReminder(): void {
    this.backupReminder.dismissForever();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent) {
    // This catches any right clicks that were NOT intercepted by child components
    // (because child components call event.stopPropagation())
    event.preventDefault();
    
    const items = [
      {
        label: 'Open Global Manual',
        icon: 'bi-book',
        action: () => {
          const urlTree = this.router.createUrlTree(['/manual']);
          const serialized = this.router.serializeUrl(urlTree);
          const url = window.location.origin + window.location.pathname + '#' + serialized;
          window.open(url, '_blank');
        }
      },
      {
        label: 'View Use Cases / Tutorials',
        icon: 'bi-lightbulb',
        action: () => {
          const urlTree = this.router.createUrlTree(['/manual', 'use-cases']);
          const serialized = this.router.serializeUrl(urlTree);
          const url = window.location.origin + window.location.pathname + '#' + serialized;
          window.open(url, '_blank');
        }
      },
      {
        label: 'Open Settings',
        icon: 'bi-gear',
        action: () => { this.router.navigate(['/settings']); }
      }
    ];

    this.contextMenuService.open(event, items, undefined, undefined);
  }

  onToolContextMenu(event: MouseEvent, t: Tool) {
    event.preventDefault();
    event.stopPropagation();
    
    let helpTopic = 'transcription';
    let helpHash = '';

    const titleLower = (t.title || '').toLowerCase();
    
    if (titleLower.includes('export') || titleLower.includes('html') || titleLower.includes('mei') || titleLower.includes('pdf')) {
      helpTopic = 'metadata';
      helpHash = 'exporting-data';
    } else if (titleLower.includes('search')) {
      helpTopic = 'search';
    } else if (titleLower.includes('iiif') || titleLower.includes('map')) {
      helpTopic = 'iiif';
    }

    const items = [
      {
        label: 'Execute Action',
        action: () => { if (t.callback) t.callback(); }
      }
    ];

    this.contextMenuService.open(event, items, helpTopic, helpHash);
  }

  toolsBack() {
    this.toolsService.remove(this.tools.source);
  }

  showMergeDialog = false;
  conflicts: any[] = [];
  resolvedDb: any = null;
  pendingAction: 'pull' | 'push' = 'pull';

  // ---- Selective sync (choose which manuscripts to pull/push) ----
  showSyncDialog = false;
  syncDialogAction: 'pull' | 'push' = 'push';
  manuscriptList: { id: string; sigle: string; region: string; assigned: string[]; remoteOnly: boolean; selected: boolean }[] = [];
  syncFilterText = '';
  syncOnlyMine = false;
  loadingManuscripts = false;

  get currentUserName(): string {
    return this.user?.user || '';
  }

  private async loadLocalDb(): Promise<{ sources: any[]; documents: any[]; notes: any; settings: any }> {
    const sources = await localforage.getItem<any[]>('monodi_sources') || [];
    const documents = await localforage.getItem<any[]>('monodi_documents') || [];
    const notes = await NotesStore.getAll();
    const settings = await localforage.getItem<any>('monodi_settings') || null;
    return { sources, documents, notes, settings };
  }

  async openSyncDialog(action: 'pull' | 'push') {
    this.syncDialogAction = action;
    this.syncFilterText = '';
    this.syncOnlyMine = false;
    this.loadingManuscripts = true;
    this.showSyncDialog = true;

    const localSources = await localforage.getItem<any[]>('monodi_sources') || [];
    const byId = new Map<string, any>();
    for (const s of localSources) if (s && s.id) byId.set(s.id, s);

    const list = localSources
      .filter(s => s && s.id)
      .map(s => ({
        id: s.id as string,
        sigle: (Array.isArray(s.quellensigle) ? s.quellensigle.join(', ') : s.quellensigle) || '(ohne Sigle)',
        region: s.herkunftsregion || '',
        assigned: Array.isArray(s.assignedTo) ? s.assignedTo : [],
        remoteOnly: false,
        selected: false
      }));

    // For a pull, also offer manuscripts that exist on the remote but not locally.
    if (action === 'pull') {
      try {
        const remoteIds = await this.github.listRemoteManuscriptIds();
        for (const id of remoteIds) {
          if (id === '__unassigned__') continue;
          if (!byId.has(id)) {
            list.push({ id, sigle: '(nur auf GitHub)', region: '', assigned: [], remoteOnly: true, selected: false });
          }
        }
      } catch { /* offline / empty repo: local list only */ }
    }

    list.sort((a, b) => a.sigle.localeCompare(b.sigle));
    this.manuscriptList = list;
    this.loadingManuscripts = false;
  }

  get filteredManuscripts() {
    const q = this.syncFilterText.trim().toLowerCase();
    const me = this.currentUserName;
    return this.manuscriptList.filter(m => {
      if (this.syncOnlyMine && !(me && m.assigned.includes(me))) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q)
        || m.sigle.toLowerCase().includes(q)
        || m.region.toLowerCase().includes(q);
    });
  }

  get selectedManuscriptCount(): number {
    return this.manuscriptList.filter(m => m.selected).length;
  }

  selectAllVisible(selected: boolean) {
    for (const m of this.filteredManuscripts) m.selected = selected;
  }

  /** Tags the selected manuscripts as assigned to the current user (locally). */
  async assignSelectedToMe() {
    const me = this.currentUserName;
    if (!me) return;
    const selectedIds = new Set(this.manuscriptList.filter(m => m.selected && !m.remoteOnly).map(m => m.id));
    if (selectedIds.size === 0) return;
    const sources = await localforage.getItem<any[]>('monodi_sources') || [];
    for (const s of sources) {
      if (s && selectedIds.has(s.id)) {
        const assigned: string[] = Array.isArray(s.assignedTo) ? s.assignedTo : [];
        if (!assigned.includes(me)) assigned.push(me);
        s.assignedTo = assigned;
      }
    }
    await localforage.setItem('monodi_sources', sources);
    for (const m of this.manuscriptList) {
      if (selectedIds.has(m.id) && !m.assigned.includes(me)) m.assigned.push(me);
    }
    alert(`${selectedIds.size} Handschrift(en) dir zugewiesen. Push die Auswahl, um es auf GitHub zu speichern.`);
  }

  async confirmSyncSelection() {
    const ids = new Set(this.manuscriptList.filter(m => m.selected).map(m => m.id));
    if (ids.size === 0) return;
    const action = this.syncDialogAction;
    this.showSyncDialog = false;

    if (action === 'push') {
      await this.pushSelected(ids);
    } else {
      await this.pullSelected(ids);
    }
  }

  /** Pushes only the chosen manuscripts; everything else on GitHub is left as-is. */
  private async pushSelected(ids: Set<string>) {
    this.isSyncing = true;
    this.syncProgress = { phase: 'Preparing…', current: 0, total: 0 };
    const db = await this.loadLocalDb();
    const date = new Date().toLocaleString();
    const ok = await this.github.pushDatabase(
      db,
      `Update ${ids.size} manuscript(s) from Monodi-Light (${date})`,
      p => this.syncProgress = p,
      ids
    );
    this.isSyncing = false;
    this.syncProgress = null;
    if (ok) {
      this.backupReminder.markBackup();
      alert(`Push abgeschlossen: ${ids.size} Handschrift(en) auf GitHub aktualisiert.`);
    }
  }

  /**
   * Pulls the chosen manuscripts and replaces the local copy of just those
   * manuscripts; all other local data is left untouched.
   */
  private async pullSelected(ids: Set<string>) {
    this.isSyncing = true;
    this.syncProgress = { phase: 'Connecting…', current: 0, total: 0 };
    const remoteDb = await this.github.pullDatabase(p => this.syncProgress = p, ids);
    if (!remoteDb) {
      this.isSyncing = false;
      this.syncProgress = null;
      return;
    }

    const local = await this.loadLocalDb();

    // Drop the local copy of the selected manuscripts, then splice in remote.
    const selectedLocalDocIds = new Set(
      local.documents.filter(d => d && ids.has(d.quelle_id)).map(d => d.id)
    );
    const newSources = local.sources.filter(s => !(s && ids.has(s.id))).concat(remoteDb.sources);
    const newDocuments = local.documents.filter(d => !(d && ids.has(d.quelle_id))).concat(remoteDb.documents);
    const newNotes: any = { ...local.notes };
    for (const docId of selectedLocalDocIds) delete newNotes[docId];
    for (const docId of Object.keys(remoteDb.notes)) newNotes[docId] = remoteDb.notes[docId];

    await localforage.setItem('monodi_sources', newSources);
    await localforage.setItem('monodi_documents', newDocuments);
    await NotesStore.replaceAll(newNotes);

    this.isSyncing = false;
    this.syncProgress = null;
    alert(`Pull abgeschlossen: ${ids.size} Handschrift(en) aus GitHub übernommen.`);
    window.location.reload();
  }

  async sync(action: 'pull' | 'push') {
    this.isSyncing = true;
    this.pendingAction = action;
    this.syncProgress = { phase: 'Connecting…', current: 0, total: 0 };
    const remoteDb = await this.github.pullDatabase(p => this.syncProgress = p);
    if (!remoteDb) {
      this.isSyncing = false;
      this.syncProgress = null;
      return;
    }

    const localSources = await localforage.getItem<any[]>('monodi_sources') || [];
    const localDocs = await localforage.getItem<any[]>('monodi_documents') || [];
    // Pulls every chant's notes from per-document rows (with legacy
    // single-blob migration handled transparently).
    const localNotes = await NotesStore.getAll();
    const localSettings = await localforage.getItem<any>('monodi_settings') || null;

    this.conflicts = [];
    this.resolvedDb = { sources: [], documents: [], notes: {}, settings: null };

    // settings
    if (!_.isEqual(localSettings, remoteDb.settings) && localSettings && remoteDb.settings) {
       this.conflicts.push({ type: 'Settings', id: 'Global Settings', name: 'Settings', local: localSettings, remote: remoteDb.settings, resolution: 'local' });
    } else {
       this.resolvedDb.settings = remoteDb.settings || localSettings;
    }

    // sources
    const sourceMap = new Map();
    localSources.forEach(s => sourceMap.set(s.id, { local: s }));
    remoteDb.sources.forEach(s => {
       if (sourceMap.has(s.id)) sourceMap.get(s.id).remote = s;
       else sourceMap.set(s.id, { remote: s });
    });

    for (const [id, data] of sourceMap.entries()) {
       if (data.local && data.remote) {
          if (!_.isEqual(data.local, data.remote)) {
             this.conflicts.push({ type: 'Source', id: id, name: data.local.quellensigle || id, local: data.local, remote: data.remote, resolution: 'local' });
          } else {
             this.resolvedDb.sources.push(data.local);
          }
       } else if (data.local) {
          this.resolvedDb.sources.push(data.local);
       } else if (data.remote) {
          this.resolvedDb.sources.push(data.remote);
       }
    }

    // documents
    const docMap = new Map();
    localDocs.forEach(d => docMap.set(d.id, { local: d }));
    remoteDb.documents.forEach(d => {
       if (docMap.has(d.id)) docMap.get(d.id).remote = d;
       else docMap.set(d.id, { remote: d });
    });

    for (const [id, data] of docMap.entries()) {
       if (data.local && data.remote) {
          if (!_.isEqual(data.local, data.remote)) {
             this.conflicts.push({ type: 'Document', id: id, name: data.local.dokumenten_id || id, local: data.local, remote: data.remote, resolution: 'local' });
          } else {
             this.resolvedDb.documents.push(data.local);
          }
       } else if (data.local) {
          this.resolvedDb.documents.push(data.local);
       } else if (data.remote) {
          this.resolvedDb.documents.push(data.remote);
       }
    }

    // notes
    const noteMap = new Map();
    Object.keys(localNotes).forEach(id => noteMap.set(id, { local: localNotes[id] }));
    Object.keys(remoteDb.notes).forEach(id => {
       if (noteMap.has(id)) noteMap.get(id).remote = remoteDb.notes[id];
       else noteMap.set(id, { remote: remoteDb.notes[id] });
    });

    for (const [id, data] of noteMap.entries()) {
       if (data.local && data.remote) {
          if (!_.isEqual(data.local, data.remote)) {
             this.conflicts.push({ type: 'Notes', id: id, name: `Notes for Document ${id}`, local: data.local, remote: data.remote, resolution: 'local' });
          } else {
             this.resolvedDb.notes[id] = data.local;
          }
       } else if (data.local) {
          this.resolvedDb.notes[id] = data.local;
       } else if (data.remote) {
          this.resolvedDb.notes[id] = data.remote;
       }
    }

    this.isSyncing = false;
    this.syncProgress = null;

    if (this.conflicts.length > 0) {
       this.showMergeDialog = true;
    } else {
       await this.finishSync();
    }
  }

  async resolveConflicts() {
    for (const conflict of this.conflicts) {
      const selected = conflict.resolution === 'local' ? conflict.local : conflict.remote;
      if (conflict.type === 'Settings') this.resolvedDb.settings = selected;
      else if (conflict.type === 'Source') this.resolvedDb.sources.push(selected);
      else if (conflict.type === 'Document') this.resolvedDb.documents.push(selected);
      else if (conflict.type === 'Notes') this.resolvedDb.notes[conflict.id] = selected;
    }
    this.showMergeDialog = false;
    await this.finishSync();
  }

  async finishSync() {
    this.isSyncing = true;
    await localforage.setItem('monodi_sources', this.resolvedDb.sources);
    await localforage.setItem('monodi_documents', this.resolvedDb.documents);
    // Per-document writes so a multi-GB workspace doesn't trip IndexedDB's
    // structured-clone limit on the next sync.
    await NotesStore.replaceAll(this.resolvedDb.notes);
    if (this.resolvedDb.settings) await localforage.setItem('monodi_settings', this.resolvedDb.settings);

    let reload = true;
    if (this.pendingAction === 'push') {
       const date = new Date().toLocaleString();
       this.syncProgress = { phase: 'Preparing…', current: 0, total: 0 };
       const success = await this.github.pushDatabase(this.resolvedDb, `Update from Monodi-Light (${date})`, p => this.syncProgress = p);
       if (success) {
         this.backupReminder.markBackup();
         alert('Successfully synced and pushed to GitHub!');
       } else {
         // Partial progress is already committed on GitHub; keep the page as
         // is so the user sees the error and can press Push again to resume.
         reload = false;
       }
    } else {
       alert('Pull successful! Local database updated with remote changes.');
    }

    this.isSyncing = false;
    this.syncProgress = null;
    if (reload) window.location.reload();
  }
}
