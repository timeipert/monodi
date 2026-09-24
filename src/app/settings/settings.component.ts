import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { APIService, ProjectSettings, sanitizeSettings, Source } from '../api.service';
import { UserService, User } from '../user.service';
import { GithubService, GithubConfig } from '../github.service';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { PageTitleService } from '../page-title.service';
import { ToastrService } from 'ngx-toastr';
import { NotesStore } from '../notes-store';
import { PushCache } from '../push-cache';
import * as localforage from 'localforage';
import { FileSystemService } from '../file-system.service';
import { buildWorkspaceExport } from '../workspace-io';

import { EditorShortcutsService, ShortcutConfig, DEFAULT_SHORTCUTS } from '../notes/editor-shortcuts.service';

export interface FieldDef { key: string, label: string, isCustom: boolean }

@Component({
    selector: 'app-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.css'],
    standalone: false
})
export class SettingsComponent implements OnInit, OnDestroy {
  activeTab: 'metadata' | 'github' | 'pdf' | 'containers' | 'editor' | 'mei' | 'htmlExport' | 'workspace' | 'shortcuts' = 'metadata';

  shortcutsConfig: ShortcutConfig = { ...DEFAULT_SHORTCUTS };

  /** Grouped sidebar navigation. Single source of truth for the nav —
   *  the template loops over this instead of hardcoding eight buttons. */
  readonly tabGroups: {
    label: string;
    tabs: { id: SettingsComponent['activeTab']; icon: string; label: string }[];
  }[] = [
    {
      label: 'Project',
      tabs: [
        { id: 'metadata',   icon: 'bi-card-list',          label: 'Metadata Schemas' },
        { id: 'containers', icon: 'bi-diagram-3',          label: 'Container Names' },
        { id: 'editor',     icon: 'bi-pencil-square',      label: 'Editor' },
        { id: 'shortcuts',  icon: 'bi-keyboard',           label: 'Shortcuts' },
      ]
    },
    {
      label: 'Export',
      tabs: [
        { id: 'pdf',        icon: 'bi-file-pdf',           label: 'PDF Layout' },
        { id: 'mei',        icon: 'bi-music-note-beamed',  label: 'MEI Mapping' },
        { id: 'htmlExport', icon: 'bi-globe2',             label: 'HTML Edition' },
      ]
    },
    {
      label: 'Data',
      tabs: [
        { id: 'github',     icon: 'bi-github',             label: 'GitHub Sync' },
        { id: 'workspace',  icon: 'bi-database-gear',      label: 'Workspace' },
      ]
    }
  ];

  /** Autosave feedback shown at the bottom of the sidebar. */
  saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  private saveStateTimer: any;

  /** Switch tab and keep the URL in sync so the current tab is always
   *  linkable / reload-safe (the ?tab= param was previously only read). */
  selectTab(tab: SettingsComponent['activeTab']): void {
    this.activeTab = tab;
    if (tab === 'workspace') {
      this.loadCachedStats();
      this.loadLinkedBackupInfo();
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── Workspace tab state ────────────────────────────────────────────────
  /** Stats refreshed when the user enters the Workspace tab and after each
   *  destructive action. Populated by `refreshWorkspaceStats()`. */
  workspaceStats: {
    sources: number;
    documents: number;
    notes: number;
    orphanNotes: number;
    orphanDocs: number;
    storageQuotaBytes?: number;
    storageUsedBytes?: number;
    settingsPresent: boolean;
  } = { sources: 0, documents: 0, notes: 0, orphanNotes: 0, orphanDocs: 0, settingsPresent: false };

  loadingStats = false;
  statsComputed = false;
  lastComputedTime: string | null = null;
  private currentStatsRunId = 0;

  /** Tracks which action is currently in-flight so the UI can disable the
   *  whole row of destructive buttons and show a spinner on the active one. */
  busyAction: '' | 'reset-settings' | 'reset-cols' | 'reset-push-cache' | 'orphan-notes' | 'orphan-docs'
            | 'wipe-docs' | 'wipe-all' = '';

  /** Two-step confirmation: clicking a destructive button arms it; the
   *  second click within the same arm window executes the action. */
  armedAction: '' | 'reset-settings' | 'orphan-notes' | 'orphan-docs'
             | 'wipe-docs' | 'wipe-all' = '';
  private armedTimeout: any;
  previewScale = 0.6;
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

  onSettingsChange() {
    if (this.settings) {
      sanitizeSettings(this.settings);
    }
    this.saveSettings();
  }

  resetMeiMappings() {
    if (this.settings) {
      this.settings.meiMappings = {
        formteilContainer: { tag: 'section' },
        zeileContainer: { tag: 'sb' },
        syllable: { tag: 'syllable', textTag: 'syl' },
        neume: { tag: 'neume' },
        note: {
          tag: 'nc',
          pitchAttr: 'pname',
          octaveAttr: 'oct',
          liquescentAttr: 'curve',
          liquescentValue: 'c',
          connectionAttr: 'con',
          connectionGapValue: 'g'
        },
        oriscus: { tag: 'oriscus' },
        quilisma: { tag: 'quilisma' },
        strophicus: { tag: 'strophicus' },
        liquescentElement: { tag: 'liquescent' },
        clef: {
          tag: 'clef',
          shapeAttr: 'shape',
          lineAttr: 'line',
          defaultLine: '1'
        },
        paratextContainer: { tag: 'dir' }
      };
      this.saveSettings();
    }
  }

  sourceFields: FieldDef[] = [
    { key: 'quellensigle', label: 'Source Siglum', isCustom: false },
    { key: 'herkunftsregion', label: 'Region of Origin', isCustom: false },
    { key: 'herkunftsort', label: 'Place of Origin', isCustom: false },
    { key: 'herkunftsinstitution', label: 'Institution of Origin', isCustom: false },
    { key: 'ordenstradition', label: 'Order Tradition', isCustom: false },
    { key: 'quellentyp', label: 'Source Type', isCustom: false },
    { key: 'bibliotheksort', label: 'Library Location', isCustom: false },
    { key: 'bibliothek', label: 'Library', isCustom: false },
    { key: 'bibliothekssignatur', label: 'Library Signature', isCustom: false }
  ];

  documentFields: FieldDef[] = [
    { key: 'gattung1', label: 'Genre 1', isCustom: false },
    { key: 'gattung2', label: 'Genre 2', isCustom: false },
    { key: 'festtag', label: 'Feast Day', isCustom: false },
    { key: 'feier', label: 'Feast', isCustom: false }
  ];

  selectedField: FieldDef | null = null;
  newValues: { [key: string]: string } = {};

  newCustomFieldLabel = '';
  newCustomFieldType: 'source' | 'document' = 'source';

  newProfileGattung1 = '';
  newProfileGattung2 = '';
  newProfileLevel1 = '';
  newProfileLevel2 = '';
  newProfileLevel3 = '';

  githubConfig: GithubConfig = { token: '', owner: '', repo: '', branch: 'main' };
  isGithubConnecting = false;

  constructor(
    public api: APIService,
    private userService: UserService,
    public github: GithubService,
    private pageTitle: PageTitleService,
    private toastr: ToastrService,
    private cdRef: ChangeDetectorRef,
    private route: ActivatedRoute,
    private router: Router,
    public shortcutsService: EditorShortcutsService,
    public fsService: FileSystemService,
  ) {
    if (this.github.config) {
      this.githubConfig = { ...this.github.config };
    }
  }

  saveShortcutsConfig() {
    this.shortcutsService.saveShortcuts(this.shortcutsConfig);
    this.toastr.success('Editor shortcuts updated.');
  }

  resetShortcutsConfig() {
    this.shortcutsService.resetToDefaults();
    this.shortcutsConfig = { ...this.shortcutsService.getShortcuts() };
    this.toastr.info('Editor shortcuts reset to defaults.');
  }

  get htmlExportSourceFields() {
    return [
      { key: 'quellensigle', label: 'Siglum' },
      { key: 'herkunftsregion', label: 'Region of Origin' },
      { key: 'herkunftsort', label: 'Place of Origin' },
      { key: 'herkunftsinstitution', label: 'Institution of Origin' },
      { key: 'ordenstradition', label: 'Order Tradition' },
      { key: 'quellentyp', label: 'Source Type' },
      { key: 'bibliotheksort', label: 'Library Location' },
      { key: 'bibliothek', label: 'Library' },
      { key: 'bibliothekssignatur', label: 'Library Signature' }
    ];
  }

  get htmlExportDocumentFields() {
    return [
      { key: 'textinitium', label: 'Text Initium' },
      { key: 'dokumenten_id', label: 'Document ID' },
      { key: 'gattung1', label: 'Genre 1' },
      { key: 'gattung2', label: 'Genre 2' },
      { key: 'festtag', label: 'Feast Day' },
      { key: 'feier', label: 'Celebration' },
      { key: 'liturgischer_status', label: 'Liturgical Status' }
    ];
  }

  ngOnInit() {
    this.pageTitle.set('Settings');
    this.shortcutsConfig = { ...this.shortcutsService.getShortcuts() };
    // Allow deep-linking to a specific tab via ?tab=workspace etc.
    // Used by the Sources page gear button to land directly on Workspace.
    this.subs.push(this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab');
      const allowed = ['metadata', 'github', 'pdf', 'containers', 'editor', 'mei', 'htmlExport', 'workspace', 'shortcuts'];
      if (tab && allowed.includes(tab)) {
        this.activeTab = tab as any;
        if (tab === 'workspace') {
          this.loadCachedStats();
          this.loadLinkedBackupInfo();
        }
      }
    }));
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
            if (!this.settings.customSourceFields) this.settings.customSourceFields = [];
            if (!this.settings.customDocumentFields) this.settings.customDocumentFields = [];
            if (!this.settings.customLists) this.settings.customLists = {};
            if (!this.settings.htmlExportSourceMetadata) this.settings.htmlExportSourceMetadata = this.htmlExportSourceFields.map(f => f.key);
            if (!this.settings.htmlExportDocumentMetadata) this.settings.htmlExportDocumentMetadata = this.htmlExportDocumentFields.map(f => f.key);
            if (!this.settings.htmlExportCustomCss) this.settings.htmlExportCustomCss = '';
            if (!this.settings.htmlExportFrontpageHtml) {
              this.settings.htmlExportFrontpageHtml = `<div class="frontpage-banner text-center py-5 mb-5 rounded-4 shadow-sm" style="background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white;">\n  <h1 class="display-4 fw-bold">Monodi Edition</h1>\n  <p class="lead opacity-75">Digital musicological source edition</p>\n  <hr class="my-4 mx-auto style-light" style="width: 100px; border-color: rgba(255,255,255,0.3); border-width: 3px;">\n  <div class="d-flex justify-content-center gap-3">\n    <span class="badge bg-white text-primary px-3 py-2 rounded-pill fs-7">Offline Viewer</span>\n    <span class="badge bg-info text-dark px-3 py-2 rounded-pill fs-7">Interactive Search</span>\n  </div>\n</div>`;
            }
            if (!this.settings.htmlExportHeaderHtml) {
              this.settings.htmlExportHeaderHtml = `<div class="edition-header py-2 px-3 mb-4 rounded-3 border bg-white d-flex justify-content-between align-items-center">\n  <span class="text-secondary fw-semibold small text-uppercase tracking-wider">Monodi Digital Scholarly Edition</span>\n  <span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill small">Status: Final</span>\n</div>`;
            }
            if (!this.settings.htmlExportFooterHtml) {
              this.settings.htmlExportFooterHtml = `<footer class="edition-footer mt-5 pt-4 pb-3 border-top text-center text-muted small">\n  <p class="mb-1">&copy; 2026 Scholarly Monodi Edition Project. All rights reserved.</p>\n  <p class="opacity-75">Generated with Monodi+ zero. Free to share and adapt for non-commercial scholarly purposes.</p>\n</footer>`;
            }
            if (this.settings.pdfSynopsisScale === undefined) this.settings.pdfSynopsisScale = 1.0;
            if (this.settings.pdfSynopsisShowHeader === undefined) this.settings.pdfSynopsisShowHeader = true;
            if (this.settings.pdfSynopsisShowHeaderMetadata === undefined) this.settings.pdfSynopsisShowHeaderMetadata = true;
            if (this.settings.pdfSynopsisShowFooter === undefined) this.settings.pdfSynopsisShowFooter = true;
            if (this.settings.pdfSynopsisShowFooterIds === undefined) this.settings.pdfSynopsisShowFooterIds = true;
            if (this.settings.pdfSynopsisShowDate === undefined) this.settings.pdfSynopsisShowDate = true;
          }
        });
      }
    }));
  }

  ngOnDestroy() {
    this.currentStatsRunId++;
    clearTimeout(this.saveStateTimer);
    this.subs.forEach(s => s.unsubscribe());
  }

  get allSourceFields(): FieldDef[] {
    if (!this.settings) return this.sourceFields;
    const custom = (this.settings.customSourceFields || []).map(f => ({ ...f, isCustom: true }));
    return [...this.sourceFields, ...custom];
  }

  get allDocumentFields(): FieldDef[] {
    if (!this.settings) return this.documentFields;
    const custom = (this.settings.customDocumentFields || []).map(f => ({ ...f, isCustom: true }));
    return [...this.documentFields, ...custom];
  }

  selectField(field: FieldDef) {
    this.selectedField = field;
    if (this.newValues[field.key] === undefined) {
      this.newValues[field.key] = '';
    }
  }

  getList(field: FieldDef): string[] {
    if (!this.settings) return [];
    if (field.isCustom) {
      if (!this.settings.customLists) this.settings.customLists = {};
      if (!this.settings.customLists[field.key]) this.settings.customLists[field.key] = [];
      return this.settings.customLists[field.key];
    } else {
      return (this.settings as any)[field.key] || [];
    }
  }

  addValue() {
    if (!this.selectedField || !this.settings || !this.user) return;
    const value = this.newValues[this.selectedField.key];
    if (value && value.trim()) {
      const valTrimmed = value.trim();
      const list = this.getList(this.selectedField);
      if (!list.includes(valTrimmed)) {
        list.push(valTrimmed);
        list.sort((a, b) => a.localeCompare(b));
        this.saveSettings();
        this.newValues[this.selectedField.key] = '';
      }
    }
  }

  removeValue(value: string) {
    if (!this.selectedField || !this.settings || !this.user) return;
    const list = this.getList(this.selectedField);
    const index = list.indexOf(value);
    if (index !== -1) {
      list.splice(index, 1);
      this.saveSettings();
    }
  }

  addCustomField() {
    if (!this.newCustomFieldLabel.trim() || !this.settings) return;
    const key = this.newCustomFieldLabel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const field = { key, label: this.newCustomFieldLabel.trim() };
    
    if (this.newCustomFieldType === 'source') {
      if (!this.settings.customSourceFields) this.settings.customSourceFields = [];
      if (this.settings.customSourceFields.find(f => f.key === key)) return;
      this.settings.customSourceFields.push(field);
    } else {
      if (!this.settings.customDocumentFields) this.settings.customDocumentFields = [];
      if (this.settings.customDocumentFields.find(f => f.key === key)) return;
      this.settings.customDocumentFields.push(field);
    }
    
    if (!this.settings.customLists) this.settings.customLists = {};
    this.settings.customLists[key] = [];
    
    this.saveSettings();
    this.newCustomFieldLabel = '';
    this.selectField({ ...field, isCustom: true });
  }

  addGenreProfile() {
    if (!this.settings) return;
    if (!this.settings.genreLevelProfiles) this.settings.genreLevelProfiles = [];
    this.settings.genreLevelProfiles.push({
      id: Math.random().toString(36).substr(2, 9),
      gattung1: this.newProfileGattung1.trim(),
      gattung2: this.newProfileGattung2.trim(),
      names: {
        level1: this.newProfileLevel1.trim(),
        level2: this.newProfileLevel2.trim(),
        level3: this.newProfileLevel3.trim()
      }
    });
    this.saveSettings();
    this.newProfileGattung1 = '';
    this.newProfileGattung2 = '';
    this.newProfileLevel1 = '';
    this.newProfileLevel2 = '';
    this.newProfileLevel3 = '';
  }

  removeGenreProfile(id: string) {
    if (!this.settings || !this.settings.genreLevelProfiles) return;
    this.settings.genreLevelProfiles = this.settings.genreLevelProfiles.filter(p => p.id !== id);
    this.saveSettings();
  }

  get availableHeadlineFields(): FieldDef[] {
    const std = [
      { key: 'dokumenten_id', label: 'Document ID', isCustom: false },
      { key: 'textinitium', label: 'Textinitium (Title)', isCustom: false },
      ...this.documentFields
    ];
    const custom = (this.settings?.customDocumentFields || []).map(f => ({ ...f, isCustom: true }));
    return [...std, ...custom];
  }

  get availableHeaderFields(): FieldDef[] {
    return this.availableHeadlineFields;
  }

  isFieldSelectedInHeadline(key: string): boolean {
    if (!this.settings || !this.settings.pdfHeadlineMetadataFields) return false;
    return this.settings.pdfHeadlineMetadataFields.includes(key);
  }

  toggleFieldInHeadline(key: string): void {
    if (!this.settings) return;
    if (!this.settings.pdfHeadlineMetadataFields) {
      this.settings.pdfHeadlineMetadataFields = [];
    }
    const idx = this.settings.pdfHeadlineMetadataFields.indexOf(key);
    if (idx > -1) {
      this.settings.pdfHeadlineMetadataFields.splice(idx, 1);
    } else {
      this.settings.pdfHeadlineMetadataFields.push(key);
    }
    this.onSettingsChange();
  }

  get mockupHeaderValue(): string {
    const src = this.settings?.pdfHeaderSource || 'textinitium';
    if (src === 'dokumenten_id') return 'GL-01-01';
    if (src === 'textinitium') return 'Gloria in excelsis';
    if (src === 'gattung1') return 'Gloria';
    if (src === 'gattung2') return 'Introductory Rites';
    if (src === 'festtag') return 'Christmas';
    if (src === 'feier') return 'Main Mass';
    return 'Gloria in excelsis';
  }

  get mockupHeadlineText(): string {
    const fields = this.settings?.pdfHeadlineMetadataFields || [];
    if (fields.length === 0) return '';
    const parts: string[] = [];
    for (const f of fields) {
      let label = '';
      let val = '';
      if (f === 'dokumenten_id') { label = 'ID'; val = 'GL-01-01'; }
      else if (f === 'textinitium') { label = 'Initium'; val = 'Gloria in excelsis'; }
      else if (f === 'gattung1') { label = 'Genre 1'; val = 'Gloria'; }
      else if (f === 'gattung2') { label = 'Genre 2'; val = 'Introductory Rites'; }
      else if (f === 'festtag') { label = 'Feast Day'; val = 'Christmas'; }
      else if (f === 'feier') { label = 'Feast'; val = 'Main Mass'; }
      else {
        const custom = (this.settings?.customDocumentFields || []).find(x => x.key === f);
        label = custom ? custom.label : f;
        val = 'Sample';
      }
      parts.push(`${label}: ${val}`);
    }
    return parts.join('   •   ');
  }

  private saveSettings() {
    if (!this.settings || !this.user) return;
    this.saveState = 'saving';
    clearTimeout(this.saveStateTimer);
    this.api.updateSettings(this.user.token, this.settings).subscribe({
      next: () => {
        this.saveState = 'saved';
        // Let the checkmark linger briefly, then fade back to idle.
        this.saveStateTimer = setTimeout(() => {
          this.saveState = 'idle';
          this.cdRef.markForCheck();
        }, 2000);
        this.cdRef.markForCheck();
      },
      error: () => {
        this.saveState = 'error';
        this.cdRef.markForCheck();
      }
    });
  }

  async connectGithub() {
    this.isGithubConnecting = true;
    this.github.saveConfig(this.githubConfig);
    const success = await this.github.testConnection();
    this.isGithubConnecting = false;
    if (!success) {
      alert('GitHub connection failed. The settings were saved, but we could not reach the repository. Please verify your internet connection, token scopes/validity, and repository details.');
    } else {
      alert('GitHub connected successfully! Use the Sync button in the top navigation bar to push or pull data.');
    }
  }

  disconnectGithub() {
    this.github.clearConfig();
    this.githubConfig = { token: '', owner: '', repo: '', branch: 'main' };
  }

  toggleHtmlExportSourceField(key: string) {
    if (!this.settings || !this.settings.htmlExportSourceMetadata) return;
    const list = this.settings.htmlExportSourceMetadata;
    const index = list.indexOf(key);
    if (index >= 0) list.splice(index, 1);
    else list.push(key);
    this.saveSettings();
  }

  toggleHtmlExportDocumentField(key: string) {
    if (!this.settings || !this.settings.htmlExportDocumentMetadata) return;
    const list = this.settings.htmlExportDocumentMetadata;
    const index = list.indexOf(key);
    if (index >= 0) list.splice(index, 1);
    else list.push(key);
    this.saveSettings();
  }

  // ──────────────────────────────────────────────────────────────────────
  //                          WORKSPACE TAB
  // ──────────────────────────────────────────────────────────────────────

  /** Switch to the Workspace tab and load cached stats if available. */
  openWorkspaceTab(): void {
    this.activeTab = 'workspace';
    this.loadCachedStats();
    this.loadLinkedBackupInfo();
  }

  loadCachedStats(): void {
    const cached = localStorage.getItem('monodi_cached_workspace_stats');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        this.workspaceStats = parsed.stats;
        this.lastComputedTime = parsed.timestamp;
        this.statsComputed = true;
      } catch (e) {
        this.statsComputed = false;
      }
    } else {
      this.statsComputed = false;
    }
    this.cdRef.markForCheck();
  }

  async refreshWorkspaceStats(): Promise<void> {
    this.currentStatsRunId++;
    const runId = this.currentStatsRunId;
    this.loadingStats = true;
    this.statsComputed = false;
    this.cdRef.markForCheck();

    const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    // Only cancel when a newer run has started (e.g. user clicked refresh again
    // or the component is being destroyed). Do NOT include activeTab in this
    // check — a transient query-param re-emission could falsely cancel the run
    // and leave loadingStats=true forever.
    const isCancelled = () => runId !== this.currentStatsRunId;
    const cancelCleanup = () => {
      if (runId === this.currentStatsRunId) {
        this.loadingStats = false;
        this.cdRef.markForCheck();
      }
    };

    // Reset stats to -1 (indicating they are currently loading)
    this.workspaceStats = {
      sources: -1,
      documents: -1,
      notes: -1,
      orphanNotes: -1,
      orphanDocs: -1,
      settingsPresent: false,
    };
    this.cdRef.markForCheck();

    try {
      // 1. Fetch sources & settings
      const sources = (await localforage.getItem<Source[]>('monodi_sources')) || [];
      const settings = await localforage.getItem<any>('monodi_settings');
      if (isCancelled()) { cancelCleanup(); return; }

      this.workspaceStats.sources = sources.length;
      this.workspaceStats.settingsPresent = !!settings;
      this.cdRef.markForCheck();

      // Yield to let UI update and remain responsive
      await yieldToEventLoop();
      if (isCancelled()) { cancelCleanup(); return; }

      // 2. Fetch documents
      const documents = (await localforage.getItem<any[]>('monodi_documents')) || [];
      if (isCancelled()) { cancelCleanup(); return; }

      this.workspaceStats.documents = documents.length;
      this.cdRef.markForCheck();

      // Yield
      await yieldToEventLoop();
      if (isCancelled()) { cancelCleanup(); return; }

      // 3. Fetch Notes Index
      const noteIds = await NotesStore.getIndex();
      if (isCancelled()) { cancelCleanup(); return; }

      this.workspaceStats.notes = noteIds.length;
      this.cdRef.markForCheck();

      // Yield
      await yieldToEventLoop();
      if (isCancelled()) { cancelCleanup(); return; }

      // 4. Compute sourceIds Set & docIds Set
      const sourceIds = new Set(sources.map(s => s.id));
      const docIds = new Set(documents.map(d => d.id));
      if (isCancelled()) { cancelCleanup(); return; }

      // Yield
      await yieldToEventLoop();
      if (isCancelled()) { cancelCleanup(); return; }

      // 5. Compute orphanDocs
      const orphanDocs = documents.filter(d => !sourceIds.has(d.quelle_id)).length;
      if (isCancelled()) { cancelCleanup(); return; }

      this.workspaceStats.orphanDocs = orphanDocs;
      this.cdRef.markForCheck();

      // Yield
      await yieldToEventLoop();
      if (isCancelled()) { cancelCleanup(); return; }

      // 6. Compute orphanNotes
      const orphanNotes = noteIds.filter(id => !docIds.has(id)).length;
      if (isCancelled()) { cancelCleanup(); return; }

      this.workspaceStats.orphanNotes = orphanNotes;
      this.cdRef.markForCheck();

      // Yield
      await yieldToEventLoop();
      if (isCancelled()) { cancelCleanup(); return; }

      // 7. Storage Manager API — wrapped in its own try so a storage-API
      //    denial (e.g. Firefox private browsing, extension interference) does
      //    not abort the whole stats run.
      if ('storage' in navigator && typeof navigator.storage.estimate === 'function') {
        try {
          const est = await navigator.storage.estimate();
          if (!isCancelled()) {
            this.workspaceStats.storageQuotaBytes = est.quota;
            this.workspaceStats.storageUsedBytes  = est.usage;
          }
        } catch (storageErr) {
          console.warn('Storage estimate failed (non-fatal):', storageErr);
        }
      }

      if (isCancelled()) { cancelCleanup(); return; }

      const timestamp = new Date().toLocaleString();
      this.lastComputedTime = timestamp;
      this.statsComputed = true;
      localStorage.setItem('monodi_cached_workspace_stats', JSON.stringify({
        stats: this.workspaceStats,
        timestamp
      }));

      this.loadingStats = false;
      this.cdRef.markForCheck();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.error('Failed to refresh workspace stats', e);
      if (runId === this.currentStatsRunId) {
        this.loadingStats = false;
        this.statsComputed = false;
        this.cdRef.markForCheck();
        this.toastr.error(`Stats failed: ${msg}`, 'Workspace stats error');
      }
    }
  }

  /** Two-click safety: first click arms the action, second click within
   *  6 seconds executes it. The window auto-clears so users don't
   *  accidentally trigger something on a stale armed state. */
  armAction(a: typeof this.armedAction): void {
    if (this.armedAction === a) {
      // Second click — execute.
      this.runArmedAction(a);
      return;
    }
    this.armedAction = a;
    clearTimeout(this.armedTimeout);
    this.armedTimeout = setTimeout(() => {
      this.armedAction = '';
      this.cdRef.markForCheck();
    }, 6000);
  }

  private async runArmedAction(a: typeof this.armedAction): Promise<void> {
    clearTimeout(this.armedTimeout);
    this.armedAction = '';
    switch (a) {
      case 'reset-settings': await this.resetSettings();        break;
      case 'orphan-notes':   await this.cleanOrphanNotes();     break;
      case 'orphan-docs':    await this.cleanOrphanDocuments(); break;
      case 'wipe-docs':      await this.wipeDocuments();        break;
      case 'wipe-all':       await this.wipeEverything();       break;
    }
  }

  /** Format e.g. 1241060536 → "1.16 GB". */
  formatBytes(b?: number): string {
    if (b === undefined || b === null) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  get storagePct(): number {
    const { storageUsedBytes, storageQuotaBytes } = this.workspaceStats;
    if (!storageUsedBytes || !storageQuotaBytes) return 0;
    return Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100));
  }

  /** Wipe `monodi_settings` but leave sources / documents / notes alone. */
  async resetSettings(): Promise<void> {
    this.busyAction = 'reset-settings';
    try {
      await localforage.removeItem('monodi_settings');
      this.toastr.success('Settings reset. Reload the page to pick up defaults.', 'Settings cleared');
      await this.refreshWorkspaceStats();
    } catch (e) {
      this.toastr.error(`Reset failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busyAction = '';
    }
  }

  /** Removes the per-source / per-document column visibility prefs
   *  (those live in localStorage, not IndexedDB). */
  resetUiPreferences(): void {
    this.busyAction = 'reset-cols';
    try {
      // Known UI-pref keys used elsewhere in the app
      localStorage.removeItem('monodi_source_cols');
      localStorage.removeItem('monodi_doc_cols');
      localStorage.removeItem('monodi_comment_help_dismissed');
      this.toastr.success('Column visibility & UI hints reset.', 'UI preferences cleared');
    } finally {
      this.busyAction = '';
    }
  }

  /**
   * Forgets which manuscripts Push believes already match GitHub. Push
   * normally skips anything it already knows is in sync, so it only takes
   * as long as however much actually changed — this button is the manual
   * escape hatch if that ever seems wrong (e.g. after editing the workspace
   * from outside the app), forcing the next push to fully re-check
   * everything against GitHub again, safely.
   */
  async resetPushCache(): Promise<void> {
    this.busyAction = 'reset-push-cache';
    try {
      await PushCache.invalidateAll();
      this.toastr.success('The next push will fully re-check every manuscript against GitHub.', 'Push cache reset');
    } finally {
      this.busyAction = '';
    }
  }

  /** Deletes notes rows whose document no longer exists. */
  async cleanOrphanNotes(): Promise<void> {
    this.busyAction = 'orphan-notes';
    try {
      const documents = (await localforage.getItem<any[]>('monodi_documents')) || [];
      const docIds = new Set(documents.map(d => d.id));
      const noteIds = await NotesStore.getIndex();
      const orphans = noteIds.filter(id => !docIds.has(id));
      if (orphans.length === 0) {
        this.toastr.info('No orphan notes found.', 'Already clean');
      } else {
        await NotesStore.removeMany(orphans);
        await PushCache.invalidateAll();
        this.toastr.success(`Removed ${orphans.length} orphan note row${orphans.length === 1 ? '' : 's'}.`);
      }
      await this.refreshWorkspaceStats();
    } catch (e) {
      this.toastr.error(`Cleanup failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busyAction = '';
    }
  }

  /** Deletes documents whose source no longer exists, and their notes. */
  async cleanOrphanDocuments(): Promise<void> {
    this.busyAction = 'orphan-docs';
    try {
      const sources = (await localforage.getItem<Source[]>('monodi_sources')) || [];
      const documents = (await localforage.getItem<any[]>('monodi_documents')) || [];
      const sourceIds = new Set(sources.map(s => s.id));
      const orphans = documents.filter(d => !sourceIds.has(d.quelle_id));
      if (orphans.length === 0) {
        this.toastr.info('No orphan documents found.', 'Already clean');
      } else {
        const keep = documents.filter(d => sourceIds.has(d.quelle_id));
        await localforage.setItem('monodi_documents', keep);
        this.api.invalidateCache();
        await NotesStore.removeMany(orphans.map(d => d.id));
        await PushCache.invalidateAll();
        this.toastr.success(`Removed ${orphans.length} orphan document${orphans.length === 1 ? '' : 's'} and their notes.`);
      }
      await this.refreshWorkspaceStats();
    } catch (e) {
      this.toastr.error(`Cleanup failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busyAction = '';
    }
  }

  /** Deletes ALL documents + ALL notes, keeps sources + settings. */
  async wipeDocuments(): Promise<void> {
    this.busyAction = 'wipe-docs';
    try {
      const noteIds = await NotesStore.getIndex();
      await localforage.setItem('monodi_documents', []);
      this.api.invalidateCache();
      await NotesStore.removeMany(noteIds);
      // Sources survive, now empty — a push needs to pick that up.
      await PushCache.invalidateAll();
      localStorage.removeItem('monodi_cached_pattern_stats');
      localStorage.removeItem('monodi_pattern_params');
      await localforage.removeItem('monodi_cached_pattern_stats'); // IndexedDB copy
      this.toastr.success('All documents and notes deleted. Sources kept.', 'Documents wiped');
      await this.refreshWorkspaceStats();
    } catch (e) {
      this.toastr.error(`Wipe failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busyAction = '';
    }
  }

  /** Nuclear option — delete sources, documents, notes, settings, and UI prefs. */
  async wipeEverything(): Promise<void> {
    this.busyAction = 'wipe-all';
    try {
      const noteIds = await NotesStore.getIndex();
      // Every manuscript is genuinely gone (not just emptied) — a future
      // push should remove them from GitHub too, so record them as deleted
      // rather than merely dirty.
      const previousSourceIds = ((await localforage.getItem<Source[]>('monodi_sources')) || [])
        .map(s => s.id).filter((id): id is string => !!id);

      await NotesStore.removeMany(noteIds);
      await localforage.removeItem('monodi_notes_index');
      await localforage.removeItem('monodi_notes_migrated_v1');
      await localforage.removeItem('monodi_notes');           // legacy blob if any
      await localforage.setItem('monodi_sources', []);
      await localforage.setItem('monodi_documents', []);
      this.api.invalidateCache();
      await PushCache.markDeleted(previousSourceIds);
      await localforage.removeItem('monodi_settings');
      localStorage.removeItem('monodi_source_cols');
      localStorage.removeItem('monodi_doc_cols');
      localStorage.removeItem('monodi_comment_help_dismissed');
      localStorage.removeItem('monodi_cached_workspace_stats');
      localStorage.removeItem('monodi_cached_pattern_stats');
      localStorage.removeItem('monodi_pattern_params');
      await localforage.removeItem('monodi_cached_pattern_stats'); // IndexedDB copy
      this.statsComputed = false;
      this.lastComputedTime = null;
      this.toastr.success('Workspace cleared. Reload the page for a clean slate.', 'Everything wiped');
      await this.refreshWorkspaceStats();
    } catch (e) {
      this.toastr.error(`Wipe failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.busyAction = '';
    }
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
        await this.refreshWorkspaceStats();
      } catch (err) {
        this.toastr.error('Failed to request storage persistence: ' + err, 'Request Failed');
      }
    } else {
      this.toastr.error('Storage Persistence API is not supported by your browser.', 'Unsupported');
    }
  }

  /** Used to reload the page after a wipe so cached in-memory state is
   *  reset everywhere. */
  reloadPage(): void {
    window.location.reload();
  }

  // ── OS Live Backup State ───────────────────────────────────────────────
  linkedBackupFileName: string | null = null;
  linkedBackupHandle: any = null;
  lastBackupTime: string | null = null;
  isSavingBackup = false;

  get isFileSystemSupported(): boolean {
    return this.fsService.isSupported();
  }

  async loadLinkedBackupInfo() {
    this.linkedBackupFileName = localStorage.getItem('monodi_os_backup_name');
    this.lastBackupTime = localStorage.getItem('monodi_os_backup_time');
    this.linkedBackupHandle = await this.fsService.getStoredHandle('monodi_os_backup_handle');
    this.cdRef.markForCheck();
  }

  async linkOsBackupFile() {
    try {
      const handle = await this.fsService.pickAndStoreBackupHandle(
        'monodi_os_backup_handle',
        `monodi_workspace_backup_${new Date().toISOString().split('T')[0]}.monodijson`
      );
      if (handle) {
        this.linkedBackupHandle = handle;
        const name = handle.name || 'monodi_workspace_backup.monodijson';
        this.linkedBackupFileName = name;
        localStorage.setItem('monodi_os_backup_name', name);
        this.toastr.success(`Linked to ${name}`, 'OS File Linked');
        await this.syncWorkspaceToOsFile();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.toastr.error(`Failed to link OS file: ${err?.message || err}`);
      }
    }
  }

  async unlinkOsBackupFile() {
    await this.fsService.removeStoredHandle('monodi_os_backup_handle');
    localStorage.removeItem('monodi_os_backup_name');
    localStorage.removeItem('monodi_os_backup_time');
    this.linkedBackupHandle = null;
    this.linkedBackupFileName = null;
    this.lastBackupTime = null;
    this.toastr.info('OS backup file unlinked.', 'Unlinked');
    this.cdRef.markForCheck();
  }

  async syncWorkspaceToOsFile() {
    if (!this.linkedBackupHandle) {
      this.linkedBackupHandle = await this.fsService.getStoredHandle('monodi_os_backup_handle');
    }
    if (!this.linkedBackupHandle) {
      this.toastr.warning('No OS file linked. Please link a file first.', 'Backup File Needed');
      return;
    }

    this.isSavingBackup = true;
    this.cdRef.markForCheck();

    try {
      const sources = await localforage.getItem('monodi_sources');
      const documents = await localforage.getItem('monodi_documents');
      const notes = await NotesStore.getAll();
      const settings = await localforage.getItem('monodi_settings');
      const data = buildWorkspaceExport(sources, documents, notes, settings, 'none');
      const content = JSON.stringify(data, null, 2);

      const success = await this.fsService.saveToHandle(this.linkedBackupHandle, content);
      if (success) {
        const now = new Date().toLocaleTimeString();
        this.lastBackupTime = now;
        localStorage.setItem('monodi_os_backup_time', now);
        this.toastr.success(`Workspace saved directly to ${this.linkedBackupFileName || 'OS file'}.`, 'OS Backup Complete');
      } else {
        this.toastr.warning('Permission required or write failed. Please re-link or permit access to your backup file.', 'Write Access Needed');
      }
    } catch (e: any) {
      this.toastr.error(`Failed to sync to OS file: ${e?.message || e}`);
    } finally {
      this.isSavingBackup = false;
      this.cdRef.markForCheck();
    }
  }
}
