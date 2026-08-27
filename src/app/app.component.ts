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
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'app';

  user: User | null = null;
  tools!: StackEntry;
  toolHasParent: boolean = false;
  isSyncing = false;
  isOnline: boolean = navigator.onLine;
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

  async sync(action: 'pull' | 'push') {
    this.isSyncing = true;
    this.pendingAction = action;
    const remoteDb = await this.github.pullDatabase();
    if (!remoteDb) {
      this.isSyncing = false;
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

    if (this.pendingAction === 'push') {
       const date = new Date().toLocaleString();
       const success = await this.github.pushDatabase(this.resolvedDb, `Update from Monodi-Light (${date})`);
       if (success) {
         this.backupReminder.markBackup();
         alert('Successfully synced and pushed to GitHub!');
       }
    } else {
       alert('Pull successful! Local database updated with remote changes.');
    }
    
    this.isSyncing = false;
    window.location.reload();
  }
}
