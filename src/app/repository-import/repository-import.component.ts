import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import {
  DatasetError, MAX_DOCUMENTS_PER_IMPORT, catalogUrlForRepository, chantsIn, cmDocumentFacets, cmSourceFacets, filterCantusSources, filterCmSources,
  planCantusImport, planCmImport, cantusSourceFacets, recordKey,
} from '@monodi/core/datasets';
import type {
  CantusPlan, CantusSource, CatalogEntry, ChantSelection, CmIndex, CmPlan, CmSource, ImportManifest, ImportRecord,
  LoadedCatalog, LoadedDataset,
} from '@monodi/core/datasets';
import { ToastrService } from 'ngx-toastr';
import { GithubService } from '../github.service';
import { ImportProgress, ImportSummary, RepositoryImportService, describeImportError } from '../repository-import.service';

/** Rows of the Cantus table shown at once; the filter narrows 2,278 sources down. */
const CANTUS_ROWS_SHOWN = 150;

type Tab = 'datasets' | 'imported';
type CantusSort = 'siglum' | 'chants' | 'melodies';

@Component({
  selector: 'app-repository-import',
  templateUrl: './repository-import.component.html',
  styleUrls: ['./repository-import.component.css'],
  standalone: false,
})
export class RepositoryImportComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  /** The tab that is open first: the datasets, or what was imported before. */
  @Input() startTab: Tab = 'datasets';

  tab: Tab = 'datasets';

  // catalogue
  catalogUrl = '';
  repositoryText = '';
  catalog: LoadedCatalog | null = null;
  loadingCatalog = false;
  catalogError = '';

  // the open dataset
  active: LoadedDataset | null = null;
  loadingDataset = false;
  datasetError = '';
  overwrite = false;
  /** Leave the sources that the import creates out of the GitHub sync (on by default). */
  keepOutOfSync = true;

  // Corpus Monodicum
  cmIndex: CmIndex | null = null;
  cmText = '';
  cmCenturies: number[] = [];
  cmRegion = '';
  cmChantText = '';
  cmGenre = '';
  cmSelected = new Set<string>();
  cmShown: CmSource[] = [];
  cmPlan: CmPlan | null = null;
  cmCenturyFacets: Array<{ value: number; count: number }> = [];
  cmRegionFacets: Array<{ value: string; count: number }> = [];
  cmGenreFacets: Array<{ value: string; count: number }> = [];

  // Cantus Corpus
  cantusSources: CantusSource[] = [];
  cantusText = '';
  cantusCenturies: number[] = [];
  cantusCursus = '';
  cantusHost = '';
  cantusMelodyOnly = false;
  cantusSort: CantusSort = 'siglum';
  chantSelection: ChantSelection = 'with-melody';
  /** On by default: the text of a chant with a melody is placed under its notes (heuristic; the label says so). */
  alignText = true;
  cantusSelected = new Set<string>();
  cantusMatching: CantusSource[] = [];
  cantusPlan: CantusPlan | null = null;
  cantusCenturyFacets: Array<{ value: number; count: number }> = [];
  cantusCursusFacets: Array<{ value: string; count: number }> = [];
  cantusHostFacets: Array<{ value: string; count: number }> = [];

  // running an import
  running = false;
  progress: ImportProgress | null = null;
  summary: ImportSummary | null = null;
  error = '';
  private abort: AbortController | null = null;
  storage: { usage: number; quota: number } | null = null;

  // earlier imports
  manifest: ImportManifest = { version: 1, records: [] };
  /** Workspace sources that the GitHub sync leaves out. */
  syncLeftOut = new Set<string>();
  outdated = new Set<string>();
  checkingUpdates = false;
  private updateTargets = new Map<string, { dataset: LoadedDataset; index: CmIndex }>();

  constructor(private service: RepositoryImportService, private toastr: ToastrService, private github: GithubService) {}

  ngOnInit(): void {
    this.tab = this.startTab;
    this.catalogUrl = this.service.defaultCatalogUrl;
    void this.loadCatalog();
    void this.refreshManifest();
    void this.service.storageEstimate().then((s) => (this.storage = s)).catch(() => undefined);
  }

  ngOnDestroy(): void {
    this.abort?.abort();
  }

  close(): void {
    if (this.running) return;
    this.closed.emit();
  }

  // ── catalogue and datasets ─────────────────────────────────────────────────────────────────────────────────────

  async loadCatalog(url: string = this.catalogUrl): Promise<void> {
    this.loadingCatalog = true;
    this.catalogError = '';
    this.catalog = null;
    this.active = null;
    try {
      this.catalog = await this.service.openCatalog(url);
      this.catalogUrl = url;
    } catch (error) {
      this.catalogError = describeImportError(error);
    } finally {
      this.loadingCatalog = false;
    }
  }

  /** Read the catalogue of another repository that a person typed (`owner/repo` or `owner/repo@tag`). */
  async useRepository(): Promise<void> {
    const url = catalogUrlForRepository(this.repositoryText);
    if (!url) {
      this.catalogError = 'Write a repository as owner/name, or owner/name@tag.';
      return;
    }
    await this.loadCatalog(url);
  }

  resetRepository(): void {
    this.repositoryText = '';
    void this.loadCatalog(this.service.defaultCatalogUrl);
  }

  async openDataset(entry: CatalogEntry): Promise<void> {
    if (!this.catalog) return;
    this.loadingDataset = true;
    this.datasetError = '';
    this.summary = null;
    this.error = '';
    this.active = null;
    try {
      const dataset = await this.service.openDataset(this.catalog, entry);
      if (entry.kind === 'transcriptions') {
        this.cmIndex = await this.service.openCmIndex(dataset);
        this.cmSelected = new Set();
        this.cmText = ''; this.cmCenturies = []; this.cmRegion = ''; this.cmChantText = ''; this.cmGenre = '';
        const facets = cmSourceFacets(this.cmIndex.sources);
        this.cmCenturyFacets = facets.centuries;
        this.cmRegionFacets = facets.regions;
        this.cmGenreFacets = cmDocumentFacets(this.cmIndex.documents).genres;
      } else {
        this.cantusSources = await this.service.openCantusIndex(dataset);
        this.cantusSelected = new Set();
        this.cantusText = ''; this.cantusCenturies = []; this.cantusCursus = ''; this.cantusHost = '';
        const facets = cantusSourceFacets(this.cantusSources);
        this.cantusCenturyFacets = facets.centuries;
        this.cantusCursusFacets = facets.cursus;
        this.cantusHostFacets = facets.hosts;
      }
      this.active = dataset;
      this.recompute();
    } catch (error) {
      this.datasetError = describeImportError(error);
    } finally {
      this.loadingDataset = false;
    }
  }

  backToDatasets(): void {
    if (this.running) return;
    this.active = null;
    this.summary = null;
    this.error = '';
  }

  get isCm(): boolean {
    return this.active?.entry.kind === 'transcriptions';
  }

  /** Where the licence text and the citation of the open dataset can be read. */
  get licenceLink(): string | null {
    const dataset = this.active?.dataset;
    if (!dataset) return null;
    if (dataset.citation_url) return dataset.citation_url;
    if (dataset.attribution_file) return this.active!.baseUrl + dataset.attribution_file;
    return null;
  }

  // ── filters and plans ──────────────────────────────────────────────────────────────────────────────────────────

  /** Call after any change of a filter or of the selection. */
  recompute(): void {
    if (this.isCm && this.cmIndex) {
      this.cmShown = filterCmSources(this.cmIndex.sources, {
        text: this.cmText, centuries: this.cmCenturies, regions: this.cmRegion ? [this.cmRegion] : [],
      });
      this.cmPlan = planCmImport(this.cmIndex, this.cmSelected, {
        text: this.cmChantText, genres: this.cmGenre ? [this.cmGenre] : [],
      });
    } else if (this.active) {
      const matching = filterCantusSources(this.cantusSources, {
        text: this.cantusText, centuries: this.cantusCenturies, cursus: this.cantusCursus ? [this.cantusCursus] : [],
        hosts: this.cantusHost ? [this.cantusHost] : [], withMelodyOnly: this.cantusMelodyOnly,
      });
      const key = this.cantusSort;
      this.cantusMatching = [...matching].sort((a, b) =>
        key === 'chants' ? b.n_chants - a.n_chants
          : key === 'melodies' ? b.n_with_melody - a.n_with_melody || a.siglum.localeCompare(b.siglum)
            : a.siglum.localeCompare(b.siglum));
      this.cantusPlan = planCantusImport(
        this.cantusSources.filter((s) => this.cantusSelected.has(s.id)), this.chantSelection,
      );
    }
  }

  toggleCentury(list: number[], century: number): number[] {
    return list.includes(century) ? list.filter((c) => c !== century) : [...list, century].sort((a, b) => a - b);
  }

  toggleCmCentury(century: number): void {
    this.cmCenturies = this.toggleCentury(this.cmCenturies, century);
    this.recompute();
  }

  toggleCantusCentury(century: number): void {
    this.cantusCenturies = this.toggleCentury(this.cantusCenturies, century);
    this.recompute();
  }

  toggleCm(id: string): void {
    if (this.cmSelected.has(id)) this.cmSelected.delete(id); else this.cmSelected.add(id);
    this.recompute();
  }

  toggleCantus(id: string): void {
    if (this.cantusSelected.has(id)) this.cantusSelected.delete(id); else this.cantusSelected.add(id);
    this.recompute();
  }

  selectMatching(): void {
    if (this.isCm) this.cmShown.forEach((s) => this.cmSelected.add(s.id));
    else this.cantusMatching.filter((s) => chantsIn(s, this.chantSelection) > 0).forEach((s) => this.cantusSelected.add(s.id));
    this.recompute();
  }

  clearSelection(): void {
    this.cmSelected = new Set();
    this.cantusSelected = new Set();
    this.recompute();
  }

  get cantusRows(): CantusSource[] {
    return this.cantusMatching.slice(0, CANTUS_ROWS_SHOWN);
  }

  get cantusHidden(): number {
    return Math.max(0, this.cantusMatching.length - CANTUS_ROWS_SHOWN);
  }

  chantsOf(source: CantusSource): number {
    return chantsIn(source, this.chantSelection);
  }

  // ── size and storage ───────────────────────────────────────────────────────────────────────────────────────────

  /** Bytes the import will fetch. */
  get downloadBytes(): number {
    return (this.isCm ? this.cmPlan?.bytes : this.cantusPlan?.downloadBytes) ?? 0;
  }

  /** Bytes the imported documents are expected to take in the workspace (an estimate, measured on samples). */
  get storedBytes(): number {
    return (this.isCm ? this.cmPlan?.storedBytes : this.cantusPlan?.storedBytes) ?? 0;
  }

  get freeBytes(): number | null {
    return this.storage ? Math.max(0, this.storage.quota - this.storage.usage) : null;
  }

  /** `ok`, `tight` (more than half of the free space) or `over` (more than the free space). */
  get storageState(): 'ok' | 'tight' | 'over' {
    const free = this.freeBytes;
    if (free === null) return 'ok';
    if (this.storedBytes > free) return 'over';
    return this.storedBytes > free / 2 ? 'tight' : 'ok';
  }

  /** The workspace is connected to GitHub: the button Push would upload what this import adds. */
  get githubSyncConnected(): boolean {
    return this.github.isConnected;
  }

  get selectedCount(): number {
    return this.isCm ? this.cmPlan?.sources.length ?? 0 : this.cantusPlan?.sources.length ?? 0;
  }

  get itemCount(): number {
    return this.isCm ? this.cmPlan?.documents.length ?? 0 : this.cantusPlan?.chants ?? 0;
  }

  /** More chants than one import takes (`MAX_DOCUMENTS_PER_IMPORT`). */
  get tooMany(): boolean {
    return this.itemCount > MAX_DOCUMENTS_PER_IMPORT;
  }

  readonly maxChants = MAX_DOCUMENTS_PER_IMPORT;

  get canImport(): boolean {
    return !this.running && this.selectedCount > 0 && this.storageState !== 'over' && !this.tooMany;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  get progressPercent(): number {
    const p = this.progress;
    if (!p || p.bytesTotal <= 0) return 0;
    return Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100));
  }

  // ── running an import ──────────────────────────────────────────────────────────────────────────────────────────

  private beginRun(): AbortController {
    this.running = true;
    this.summary = null;
    this.error = '';
    this.progress = { message: 'Starting…', current: 0, total: 0, bytesDone: 0, bytesTotal: 0 };
    this.abort = new AbortController();
    return this.abort;
  }

  private async endRun(): Promise<void> {
    this.running = false;
    this.abort = null;
    await this.refreshManifest();
    this.storage = await this.service.storageEstimate().catch(() => null);
    this.recompute();
  }

  async runImport(): Promise<void> {
    if (!this.active || !this.canImport) return;
    const controller = this.beginRun();
    const options = {
      overwrite: this.overwrite, keepOutOfSync: this.keepOutOfSync, signal: controller.signal,
      onProgress: (p: ImportProgress) => (this.progress = p),
    };
    try {
      if (this.isCm && this.cmIndex && this.cmPlan) {
        this.summary = await this.service.importCm(this.active, this.cmIndex, this.cmPlan, options);
      } else if (this.cantusPlan) {
        this.summary = await this.service.importCantus(this.active, this.cantusPlan, this.chantSelection,
          { ...options, alignText: this.alignText });
      }
      if (this.summary) this.toastr.success(`${this.summary.documents} chant(s) imported from ${this.summary.sources} source(s).`);
    } catch (error) {
      this.error = describeImportError(error);
      if (!(error instanceof DatasetError && error.kind === 'aborted')) console.error('Import from repository failed:', error);
    } finally {
      await this.endRun();
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  // ── earlier imports ────────────────────────────────────────────────────────────────────────────────────────────

  async refreshManifest(): Promise<void> {
    this.manifest = await this.service.getManifest();
    this.syncLeftOut = await this.service.syncLeftOut();
  }

  /** The GitHub sync (button Push) uploads this source. */
  isSynced(record: ImportRecord): boolean {
    return !this.syncLeftOut.has(record.workspaceSourceId);
  }

  async toggleSynced(record: ImportRecord): Promise<void> {
    await this.service.setSynced(record.workspaceSourceId, !this.isSynced(record));
    await this.refreshManifest();
  }

  isOutdated(record: ImportRecord): boolean {
    return this.outdated.has(recordKey(record.datasetId, record.sourceId));
  }

  /** Compare the imported Corpus Monodicum sources with the repository (reads the indexes, no data files). */
  async checkUpdates(): Promise<void> {
    if (!this.catalog) return;
    this.checkingUpdates = true;
    this.error = '';
    try {
      const ids = new Set(this.manifest.records.map((r) => r.datasetId));
      this.outdated = new Set();
      this.updateTargets = new Map();
      for (const entry of this.catalog.catalog.datasets.filter((d) => ids.has(d.id) && d.kind === 'transcriptions')) {
        const dataset = await this.service.openDataset(this.catalog, entry);
        const index = await this.service.openCmIndex(dataset);
        this.updateTargets.set(entry.id, { dataset, index });
        for (const record of await this.service.outdatedCmRecords(dataset, index)) {
          this.outdated.add(recordKey(record.datasetId, record.sourceId));
        }
      }
      this.toastr.info(this.outdated.size === 0 ? 'Everything imported is up to date.' : `${this.outdated.size} source(s) changed in the repository.`);
    } catch (error) {
      this.error = describeImportError(error);
    } finally {
      this.checkingUpdates = false;
    }
  }

  async updateRecord(record: ImportRecord): Promise<void> {
    const target = this.updateTargets.get(record.datasetId);
    if (!target || this.running) return;
    const plan = planCmImport(target.index, new Set([record.sourceId]));
    const ok = window.confirm(
      `Replace the ${plan.documents.length} chants of ${record.workspaceSourceId} with the version in the repository?\n\n`
      + 'Changes you made to these chants and to the metadata of the source are lost.');
    if (!ok) return;
    const controller = this.beginRun();
    try {
      this.summary = await this.service.importCm(target.dataset, target.index, plan, {
        overwrite: true, signal: controller.signal, onProgress: (p) => (this.progress = p),
      });
      this.outdated.delete(recordKey(record.datasetId, record.sourceId));
    } catch (error) {
      this.error = describeImportError(error);
    } finally {
      await this.endRun();
    }
  }

  /** Give the documents of earlier imports the link to their original page. */
  async addLinks(): Promise<void> {
    if (this.running) return;
    try {
      const changed = await this.service.addOriginalLinks();
      this.toastr.success(changed === 0 ? 'All imported chants have the link already.' : `The link to the original page was added to ${changed} chant(s).`);
    } catch (error) {
      this.error = describeImportError(error);
    }
  }

  async removeRecord(record: ImportRecord): Promise<void> {
    if (this.running) return;
    const ok = window.confirm(
      `Remove the ${record.documentIds.length} chants of ${record.workspaceSourceId} that were imported from the repository?\n\n`
      + 'Chants you added yourself to this source stay.');
    if (!ok) return;
    try {
      const result = await this.service.removeImport(record);
      this.toastr.success(`${result.documents} chant(s) removed${result.sourceRemoved ? ' with their source' : ''}.`);
      await this.refreshManifest();
    } catch (error) {
      this.error = describeImportError(error);
    }
  }
}
