import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { APIService } from './api.service'
import { StackEntry, ToolsService, Tool} from './tools.service';
import { UserService, User } from './user.service';
import { GithubService, SyncProgress } from './github.service';
import { UndoService } from './undoService';
import { ContextMenuService } from './context-menu/context-menu.service';
import { BackupReminderService } from './backup-reminder.service';
import * as localforage from 'localforage';
import * as _ from 'lodash';
import { NotesStore } from './notes-store';
import { LocalWorkspaceSource } from './workspace-source';
import { PushCache } from './push-cache';

/** One manuscript's worth of merge conflicts, grouped for the merge dialog. */
interface ConflictGroup {
  key: string;          // source id, or '__settings__' / '__unassigned__'
  isSettings: boolean;
  sigle: string;
  region: string;
  assigned: string[];
  items: any[];          // the individual Source/Document/Notes conflict entries
  expanded: boolean;
  resolution: 'local' | 'remote' | 'custom';
}

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
  syncProgress: SyncProgress | null = null;
  isOnline: boolean = navigator.onLine;

  /**
   * Percentage for the bar. Prefers bytes over file counts: one manuscript can
   * be a thousand times bigger than another, so a file-count bar would crawl
   * and then leap. Falls back to counts while we don't know the byte total.
   */
  get syncPercent(): number {
    const p = this.syncProgress;
    if (!p) return 0;
    if (p.bytesTotal && p.bytesTotal > 0) {
      return Math.min(100, Math.round(((p.bytesDone || 0) / p.bytesTotal) * 100));
    }
    if (p.total > 0) return Math.min(100, Math.round((p.current / p.total) * 100));
    return 0;
  }

  /** True while we can't say how much work there is (indeterminate bar). */
  get syncIndeterminate(): boolean {
    const p = this.syncProgress;
    if (!p) return true;
    return !(p.bytesTotal && p.bytesTotal > 0) && p.total <= 0;
  }

  formatBytes(n: number | undefined): string {
    if (!n || n <= 0) return '0 MB';
    const mb = n / (1024 * 1024);
    if (mb < 1) return `${Math.max(1, Math.round(n / 1024))} KB`;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  formatEta(seconds: number | undefined): string {
    if (seconds === undefined || !isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60) return `${Math.round(seconds)}s remaining`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m} min remaining`;
    return `${Math.floor(m / 60)}h ${m % 60}min remaining`;
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
  conflictGroups: ConflictGroup[] = [];
  mergeFilterText = '';
  mergeOnlyMine = false;
  /** Manuscripts left untouched during the streaming merge, pending a decision. */
  conflictedManuscriptIds = new Set<string>();
  /** Remote settings held back for the dialog (small enough to keep in memory). */
  pendingSettings: any = null;
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
    await PushCache.markDirty(Array.from(selectedIds));
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
    const date = new Date().toLocaleString();
    // Streams straight from IndexedDB — never materialises the workspace.
    const ok = await this.github.pushDatabase(
      new LocalWorkspaceSource(),
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

    // Metadata rows only — the note payloads are handled per document below.
    const sources = await localforage.getItem<any[]>('monodi_sources') || [];
    const documents = await localforage.getItem<any[]>('monodi_documents') || [];

    // Drop the local copy of the selected manuscripts, then splice in remote
    // one manuscript at a time so nothing accumulates in memory.
    const staleDocIds = documents.filter(d => d && ids.has(d.quelle_id)).map(d => d.id);
    const keptSources = sources.filter(s => !(s && ids.has(s.id)));
    const keptDocuments = documents.filter(d => !(d && ids.has(d.quelle_id)));

    try {
      const streamed = await this.github.streamManuscripts(async (id, bundle: any) => {
        if (bundle.source) keptSources.push(bundle.source);
        for (const doc of (bundle.documents || [])) keptDocuments.push(doc);
        if (bundle.notes && Object.keys(bundle.notes).length > 0) {
          await NotesStore.merge(bundle.notes);
        }
      }, p => this.syncProgress = p, ids);

      if (!streamed) {
        this.isSyncing = false;
        this.syncProgress = null;
        alert('This repository still uses the old per-chant layout. Press "Push" once to migrate it first.');
        return;
      }
    } catch (e) {
      console.error('Selective pull failed', e);
      this.isSyncing = false;
      this.syncProgress = null;
      alert('Pull failed while reading from GitHub. Your local data was not changed.');
      return;
    }

    // Notes belonging to chants the remote no longer has.
    const survivors = new Set(keptDocuments.map(d => d?.id).filter(Boolean));
    const orphaned = staleDocIds.filter(id => !survivors.has(id));
    if (orphaned.length > 0) await NotesStore.removeMany(orphaned);

    await localforage.setItem('monodi_sources', keptSources);
    await localforage.setItem('monodi_documents', keptDocuments);
    // Local now holds exactly what GitHub had — no push needed for these.
    await PushCache.markClean(ids);

    this.isSyncing = false;
    this.syncProgress = null;
    alert(`Pull complete: ${ids.size} manuscript(s) taken from GitHub.`);
    window.location.reload();
  }

  /**
   * Streaming merge.
   *
   * Walks the remote repository one manuscript at a time and reconciles it
   * against local storage as it goes, so neither side is ever fully resident
   * in memory. Only *metadata* (sources, document records, conflict
   * descriptors) is accumulated — the heavy note payloads are compared and
   * written per document and released immediately.
   *
   * Anything unambiguous (new on one side, or identical on both) is applied
   * during the walk. Genuine conflicts are recorded as descriptors *without*
   * their payloads and left untouched until the user decides; the chosen
   * version is re-fetched in {@link resolveConflicts}. That keeps the peak
   * footprint flat no matter how large the corpus is.
   */
  async sync(action: 'pull' | 'push') {
    this.isSyncing = true;
    this.pendingAction = action;
    this.syncProgress = { phase: 'Connecting…', current: 0, total: 0 };

    // Metadata only — small enough to hold, and already stored as single rows.
    const localSources = await localforage.getItem<any[]>('monodi_sources') || [];
    const localDocs = await localforage.getItem<any[]>('monodi_documents') || [];
    const localSettings = await localforage.getItem<any>('monodi_settings') || null;

    const sourcesById = new Map<string, any>();
    for (const s of localSources) if (s?.id) sourcesById.set(s.id, s);
    const docsById = new Map<string, any>();
    for (const d of localDocs) if (d?.id) docsById.set(d.id, d);

    this.conflicts = [];
    this.conflictedManuscriptIds = new Set<string>();

    const sourceMetaById = new Map<string, { sigle: string; region: string; assigned: string[] }>();
    const describeSource = (s: any) => ({
      sigle: (Array.isArray(s.quellensigle) ? s.quellensigle.join(', ') : s.quellensigle) || s.id,
      region: s.herkunftsregion || '',
      assigned: Array.isArray(s.assignedTo) ? s.assignedTo : []
    });
    for (const s of localSources) if (s?.id) sourceMetaById.set(s.id, describeSource(s));

    // Notes written straight through during the walk; nothing accumulates.
    const noteWrites: { [docId: string]: any } = {};
    let pendingNoteWrites = 0;
    const flushNotes = async () => {
      if (pendingNoteWrites === 0) return;
      await NotesStore.merge(noteWrites);
      for (const k of Object.keys(noteWrites)) delete noteWrites[k];
      pendingNoteWrites = 0;
    };

    const visitedIds = new Set<string>();
    const onBundle = async (id: string, bundle: any) => {
      visitedIds.add(id);
      if (bundle.source?.id) sourceMetaById.set(id, describeSource(bundle.source));
      let manuscriptHasConflict = false;

      // --- source metadata ---
      if (bundle.source?.id) {
        const local = sourcesById.get(bundle.source.id);
        if (!local) {
          sourcesById.set(bundle.source.id, bundle.source);
        } else if (!_.isEqual(local, bundle.source)) {
          this.conflicts.push({
            type: 'Source', id: bundle.source.id, sourceId: id,
            name: local.quellensigle || bundle.source.id, resolution: 'local'
          });
          manuscriptHasConflict = true;
        }
      }

      // --- document records ---
      for (const doc of (bundle.documents || [])) {
        if (!doc?.id) continue;
        const local = docsById.get(doc.id);
        if (!local) {
          docsById.set(doc.id, doc);
        } else if (!_.isEqual(local, doc)) {
          this.conflicts.push({
            type: 'Document', id: doc.id, sourceId: id,
            name: local.dokumenten_id || doc.id, resolution: 'local'
          });
          manuscriptHasConflict = true;
        }
      }

      // --- notes (the heavy part: one document at a time, never in bulk) ---
      for (const docId of Object.keys(bundle.notes || {})) {
        const remoteNote = bundle.notes[docId];
        const localNote = await NotesStore.get(docId);
        if (localNote === null || localNote === undefined) {
          noteWrites[docId] = remoteNote;
          pendingNoteWrites++;
          if (pendingNoteWrites >= 50) await flushNotes();
        } else if (!_.isEqual(localNote, remoteNote)) {
          this.conflicts.push({
            type: 'Notes', id: docId, sourceId: id,
            name: `Notes for Document ${docId}`, resolution: 'local'
          });
          manuscriptHasConflict = true;
        }
      }

      if (manuscriptHasConflict) this.conflictedManuscriptIds.add(id);
    };

    let streamed = false;
    try {
      streamed = await this.github.streamManuscripts(onBundle, p => this.syncProgress = p);
      await flushNotes();
    } catch (e) {
      console.error('Streaming merge failed', e);
      this.toastrError('Merge failed while reading from GitHub. Nothing was lost — try again.');
      this.isSyncing = false;
      this.syncProgress = null;
      return;
    }

    if (!streamed) {
      // Repository still uses the legacy per-chant layout. Fall back to the
      // old bulk path; a full Push migrates it to the streaming-friendly one.
      this.isSyncing = false;
      this.syncProgress = null;
      alert('This repository still uses the old per-chant layout. Press "Push" once to migrate it — after that, syncing streams and stays memory-safe.');
      return;
    }

    // Manuscripts the walk confirmed match the remote (no conflict) need no
    // push to reflect that — mark them clean so the next push skips them
    // instead of re-reading and re-hashing all their notes for nothing.
    const confirmedClean = Array.from(visitedIds).filter(id => !this.conflictedManuscriptIds.has(id));
    await PushCache.markClean(confirmedClean);

    // --- global settings (small, compared inline) ---
    let remoteSettings: any = null;
    try { remoteSettings = await this.github.getRemoteSettings(); } catch { /* optional */ }
    this.pendingSettings = null;
    if (localSettings && remoteSettings && !_.isEqual(localSettings, remoteSettings)) {
      this.conflicts.push({
        type: 'Settings', id: 'Global Settings', sourceId: '__settings__',
        name: 'Settings', resolution: 'local'
      });
      this.pendingSettings = remoteSettings;
    } else if (!localSettings && remoteSettings) {
      await localforage.setItem('monodi_settings', remoteSettings);
    }

    // Metadata arrays are written back as whole rows (they always were).
    await localforage.setItem('monodi_sources', Array.from(sourcesById.values()));
    await localforage.setItem('monodi_documents', Array.from(docsById.values()));

    this.isSyncing = false;
    this.syncProgress = null;

    if (this.conflicts.length > 0) {
      this.mergeFilterText = '';
      this.mergeOnlyMine = false;
      this.buildConflictGroups(sourceMetaById);
      this.showMergeDialog = true;
    } else {
      await this.finishSync();
    }
  }

  private toastrError(msg: string) {
    alert(msg);
  }

  /** Groups the flat conflict list by manuscript for the merge dialog. */
  private buildConflictGroups(sourceMetaById: Map<string, { sigle: string; region: string; assigned: string[] }>) {
    const groups = new Map<string, ConflictGroup>();
    for (const item of this.conflicts) {
      const key = item.sourceId || '__unassigned__';
      let g = groups.get(key);
      if (!g) {
        const meta = sourceMetaById.get(key);
        g = {
          key,
          isSettings: key === '__settings__',
          sigle: key === '__settings__' ? 'Global settings' : (meta?.sigle || (key === '__unassigned__' ? '(no manuscript)' : key)),
          region: meta?.region || '',
          assigned: meta?.assigned || [],
          items: [],
          expanded: false,
          resolution: 'local'
        };
        groups.set(key, g);
      }
      g.items.push(item);
    }
    this.conflictGroups = Array.from(groups.values()).sort((a, b) => {
      if (a.isSettings !== b.isSettings) return a.isSettings ? -1 : 1;
      return a.sigle.localeCompare(b.sigle);
    });
  }

  get filteredConflictGroups(): ConflictGroup[] {
    const q = this.mergeFilterText.trim().toLowerCase();
    const me = this.currentUserName;
    return this.conflictGroups.filter(g => {
      if (g.isSettings) return true; // always keep global settings visible
      if (this.mergeOnlyMine && !(me && g.assigned.includes(me))) return false;
      if (!q) return true;
      return g.key.toLowerCase().includes(q) || g.sigle.toLowerCase().includes(q) || g.region.toLowerCase().includes(q);
    });
  }

  /** Sets every item in a manuscript group to the same resolution. */
  setGroupResolution(group: ConflictGroup, value: 'local' | 'remote') {
    for (const item of group.items) item.resolution = value;
    group.resolution = value;
  }

  /** Overrides a single item within a group; marks the group 'custom' if that makes it non-uniform. */
  setItemResolution(group: ConflictGroup, item: any, value: 'local' | 'remote') {
    item.resolution = value;
    const allLocal = group.items.every(i => i.resolution === 'local');
    const allRemote = group.items.every(i => i.resolution === 'remote');
    group.resolution = allLocal ? 'local' : allRemote ? 'remote' : 'custom';
  }

  /** Applies a bulk choice to every currently visible (filtered) group. */
  bulkSetResolution(value: 'local' | 'remote') {
    for (const g of this.filteredConflictGroups) this.setGroupResolution(g, value);
  }

  private static readonly CONFLICT_TYPE_LABELS: { [type: string]: (n: number) => string } = {
    Settings: () => 'global settings',
    Source: () => 'manuscript metadata',
    Document: n => n === 1 ? '1 document' : `${n} documents`,
    Notes: n => n === 1 ? '1 note' : `${n} notes`
  };

  /** Short badges summarizing what's in conflict within a group, e.g. ["manuscript metadata", "3 documents"]. */
  groupTypeSummary(group: ConflictGroup): string[] {
    const counts = new Map<string, number>();
    for (const item of group.items) counts.set(item.type, (counts.get(item.type) || 0) + 1);
    return ['Settings', 'Source', 'Document', 'Notes']
      .filter(t => counts.has(t))
      .map(t => AppComponent.CONFLICT_TYPE_LABELS[t](counts.get(t)!));
  }

  /**
   * Leaves every conflicted manuscript exactly as it was locally.
   *
   * Note the streaming merge already applied the unambiguous changes (new
   * manuscripts, new chants) as it walked the repository — that is what lets
   * it avoid holding the whole corpus in memory. Each applied manuscript is
   * internally consistent, so the workspace stays valid; cancelling just
   * declines the conflicting ones.
   */
  async cancelMerge() {
    const declined = Array.from(this.conflictedManuscriptIds);
    this.showMergeDialog = false;
    this.conflicts = [];
    this.conflictGroups = [];
    this.conflictedManuscriptIds = new Set();
    this.pendingSettings = null;
    this.isSyncing = false;
    this.syncProgress = null;
    // Local still differs from remote for these — make sure a future push
    // doesn't mistake them for already in sync.
    await PushCache.markDirty(declined);
    if (declined.length > 0) {
      alert(`Kept your local version for ${declined.length} conflicting manuscript(s). Non-conflicting updates from GitHub were already applied.`);
    }
  }

  /**
   * Applies the user's choices. "Keep local" needs no work at all — local
   * storage already holds that version. Only manuscripts with at least one
   * "take remote" decision are re-fetched, one at a time, so resolving stays
   * memory-safe even when the whole corpus is in conflict.
   */
  async resolveConflicts() {
    this.showMergeDialog = false;
    this.isSyncing = true;
    this.syncProgress = { phase: 'Applying your choices…', current: 0, total: 0 };

    // Which items did the user want the remote version of?
    const takeRemote = this.conflicts.filter(c => c.resolution === 'remote');

    if (this.pendingSettings && takeRemote.some(c => c.type === 'Settings')) {
      await localforage.setItem('monodi_settings', this.pendingSettings);
    }

    const byManuscript = new Map<string, any[]>();
    for (const c of takeRemote) {
      if (c.type === 'Settings') continue;
      const list = byManuscript.get(c.sourceId) || [];
      list.push(c);
      byManuscript.set(c.sourceId, list);
    }

    // A manuscript whose every conflicting item was resolved "remote" now
    // matches GitHub and needs no push. One with any "local" choice still
    // differs from GitHub and must stay dirty so a future push uploads it.
    const nowClean: string[] = [];
    const stillDirty: string[] = [];
    for (const id of this.conflictedManuscriptIds) {
      const items = this.conflicts.filter(c => c.sourceId === id);
      const allRemote = items.length > 0 && items.every(c => c.resolution === 'remote');
      (allRemote ? nowClean : stillDirty).push(id);
    }

    if (byManuscript.size > 0) {
      const sources = await localforage.getItem<any[]>('monodi_sources') || [];
      const documents = await localforage.getItem<any[]>('monodi_documents') || [];
      const sourcesById = new Map<string, any>();
      for (const s of sources) if (s?.id) sourcesById.set(s.id, s);
      const docsById = new Map<string, any>();
      for (const d of documents) if (d?.id) docsById.set(d.id, d);

      let done = 0;
      const wanted = new Set(byManuscript.keys());
      await this.github.streamManuscripts(async (id, bundle: any) => {
        const decisions = byManuscript.get(id) || [];
        const noteWrites: { [docId: string]: any } = {};

        for (const c of decisions) {
          if (c.type === 'Source' && bundle.source?.id === c.id) {
            sourcesById.set(c.id, bundle.source);
          } else if (c.type === 'Document') {
            const doc = (bundle.documents || []).find((d: any) => d?.id === c.id);
            if (doc) docsById.set(c.id, doc);
          } else if (c.type === 'Notes') {
            if (bundle.notes && c.id in bundle.notes) noteWrites[c.id] = bundle.notes[c.id];
          }
        }

        if (Object.keys(noteWrites).length > 0) await NotesStore.merge(noteWrites);

        done++;
        this.syncProgress = {
          phase: 'Applying your choices…', detail: id,
          current: done, total: wanted.size
        };
      }, undefined, wanted);

      await localforage.setItem('monodi_sources', Array.from(sourcesById.values()));
      await localforage.setItem('monodi_documents', Array.from(docsById.values()));
    }

    if (nowClean.length > 0) await PushCache.markClean(nowClean);
    if (stillDirty.length > 0) await PushCache.markDirty(stillDirty);

    this.conflicts = [];
    this.conflictGroups = [];
    this.conflictedManuscriptIds = new Set();
    this.pendingSettings = null;

    await this.finishSync();
  }

  /**
   * The merge has already been written to storage manuscript by manuscript,
   * so there is nothing left to persist here — this just pushes (if asked)
   * and reports the outcome.
   */
  async finishSync() {
    this.isSyncing = true;

    let reload = true;
    if (this.pendingAction === 'push') {
       const date = new Date().toLocaleString();
       this.syncProgress = { phase: 'Preparing…', current: 0, total: 0 };
       // The merged result was just written to storage above, so the push can
       // stream it back out manuscript by manuscript instead of holding the
       // whole (potentially multi-GB) workspace serialized in memory.
       const success = await this.github.pushDatabase(new LocalWorkspaceSource(), `Update from Monodi-Light (${date})`, p => this.syncProgress = p);
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
