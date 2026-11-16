import { ChangeDetectorRef, Component, OnDestroy, OnInit, TemplateRef } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ActivatedRoute, Router } from '@angular/router';
import { StatusLineService } from '../status-line.service';
import { Subscription } from 'rxjs';
import { describeFilters, filtersKey, frequentValues, getMethod, groupableFields, LATIN_STOP_WORDS, methodReport, METHODS, SOFTWARE_URL, METHOD_GROUPS, NO_FILTERS, normalizeParams, parseWordList, ruleMatches } from '@monodi/core/analysis';
import type { AnalysisMethod, CorpusFilters, DocInfo, ExcludeRule, FieldOption, MethodReport, ParamValues } from '@monodi/core/analysis';
import { APIService, Source } from '../api.service';
import { downloadBlob } from '../download';
import { PageTitleService } from '../page-title.service';
import { IdSelection } from '../selection/selection-set';
import { SelectionService } from '../selection/selection.service';
import { User, UserService } from '../user.service';
import { AnalysisRunnerService } from './analysis-runner.service';
import { AnalysisStore, AnalysisStoreError } from './analysis-store';
import type { AnalysisDefinition, AnalysisSummary, CorpusOrigin, MethodStatus, ResultRecord } from './analysis-types';
import { docInfoOf } from './corpus-loader';
import type { PatternUnit } from '@monodi/core/analysis';
import type { Document } from '../api.service';

type StartMode = 'selection' | 'hits' | 'sources' | 'all';

/**
 * The Analysis page: choose a corpus, tick the methods to run, run them in a worker, and keep the result as a named
 * analysis that is opened again without computing anything. See `documentation/ANALYSIS-WORKBENCH.md`.
 */
@Component({
  selector: 'app-analysis-page',
  standalone: false,
  templateUrl: './analysis-page.component.html',
  styleUrls: ['./analysis-page.component.css'],
})
export class AnalysisPageComponent implements OnInit, OnDestroy {
  user: User | null = null;
  private subs: Subscription[] = [];

  summaries: AnalysisSummary[] = [];
  current: AnalysisDefinition | null = null;
  records = new Map<string, ResultRecord>();
  status: Record<string, MethodStatus> = {};
  /** The method whose result is shown. */
  shown = '';
  expanded = new Set<string>();
  fields: FieldOption[] = [];
  storedBytes = 0;
  busy = false;
  checking = false;
  checkProgress = { done: 0, total: 0 };
  loadError = '';

  // starting a new analysis
  startMode: StartMode = 'selection';
  sources: Source[] = [];
  readonly sourcePick = new IdSelection();
  sourceFilter = '';
  hitsCount = 0;

  /** The documents of the open analysis (for the corpus card). */
  corpusDocs: Document[] = [];
  corpusOpen = false;
  patternRequest: { unit: PatternUnit; text: string; nonce: number } | null = null;
  private nonce = 0;

  // layout: the list of methods is folded away once results exist, so the results are what the page shows
  methodsOpen = true;
  filtersOpen = false;
  infoOpen = new Set<string>();
  /** The settings form above the shown result is open. */
  settingsOpen = false;

  // leaving things out
  corpusInfos: DocInfo[] = [];
  newRule: ExcludeRule = { field: 'doc:textinitium', mode: 'contains', value: '' };
  customStopText = '';
  readonly stopWordCount = LATIN_STOP_WORDS.length;

  readonly groups = METHOD_GROUPS;
  readonly allMethods = METHODS;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: APIService,
    private readonly userService: UserService,
    private readonly pageTitle: PageTitleService,
    private readonly statusLine: StatusLineService,
    private readonly modal: NgbModal,
    private readonly cdr: ChangeDetectorRef,
    readonly selSvc: SelectionService,
    private readonly runner: AnalysisRunnerService,
  ) {}

  ngOnInit(): void {
    this.pageTitle.set('Analysis');
    this.subs.push(this.userService.user.subscribe(async (user) => {
      this.user = user;
      if (!user) return;
      await this.selSvc.ensureIndex(user.token);
      const res = await this.api.listSources(user.token).toPromise();
      this.sources = res?.kind === 'SourcesRetrieved' ? res.sources.filter((s) => s.id) : [];
      this.hitsCount = this.selSvc.lastHits?.ids.length ?? 0;
      if (this.hitsCount > 0 && this.selSvc.selection.size === 0) this.startMode = 'hits';
      await this.refreshList();
      this.cdr.markForCheck();
    }));
    this.subs.push(this.route.paramMap.subscribe((p) => {
      const id = p.get('id');
      if (id) this.open(id); else { this.current = null; this.records.clear(); }
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── list of saved analyses ────────────────────────────────────────────────

  async refreshList(): Promise<void> {
    this.summaries = await AnalysisStore.list();
    this.storedBytes = this.summaries.reduce((n, s) => n + s.bytes, 0);
  }

  async open(id: string): Promise<void> {
    this.loadError = '';
    const def = await AnalysisStore.get(id);
    if (!def) { this.current = null; this.loadError = 'This analysis does not exist (any more).'; this.cdr.markForCheck(); return; }
    this.current = def;
    this.records.clear();
    this.status = {};
    for (const m of def.methods) {
      const rec = await AnalysisStore.getResult(id, m.id);
      if (rec) { this.records.set(m.id, rec); this.status[m.id] = { state: 'unchecked' }; } else this.status[m.id] = { state: 'none' };
    }
    this.shown = def.methods.find((m) => this.records.has(m.id))?.id ?? '';
    this.methodsOpen = this.records.size === 0;
    this.filtersOpen = false;
    this.customStopText = (def.filters?.stopWords.custom ?? []).join(' ');
    this.pageTitle.set(`Analysis: ${def.name}`);
    this.computeFields();
    this.cdr.markForCheck();
  }

  go(id: string | null): void {
    this.router.navigate(id ? ['/analysis', id] : ['/analysis']);
  }

  private computeFields(): void {
    if (!this.current) { this.fields = []; return; }
    const ids = new Set(this.current.corpus.docIds);
    const docs = this.selSvc.allDocs().filter((d) => ids.has(d.id));
    const sources = new Map(this.sources.map((s) => [s.id as string, s]));
    this.fields = groupableFields({ docs: docs.map((d) => docInfoOf(d, sources.get(d.quelle_id))), chants: [] });
    this.corpusDocs = docs;
    this.corpusInfos = docs.map((d) => docInfoOf(d, sources.get(d.quelle_id)));
    this.patternRequest = null;
  }

  // ── leaving things out ────────────────────────────────────────────────────

  get filters(): CorpusFilters { return this.current?.filters ?? NO_FILTERS; }

  /** Number of chants that a rule leaves out. */
  get excludedCount(): number {
    const rules = this.filters.exclude.filter((r) => r.value.trim());
    return rules.length === 0 ? 0 : this.corpusInfos.filter((d) => rules.some((r) => ruleMatches(r, d.fields))).length;
  }

  get filterSummary(): string {
    const f = this.filters;
    const rules = f.exclude.filter((r) => r.value.trim()).length;
    const stop = f.stopWords.builtIn ? this.stopWordCount : 0;
    const words = stop + f.stopWords.custom.length;
    if (rules === 0 && words === 0) return 'nothing left out';
    const parts: string[] = [];
    if (rules) parts.push(`${rules} rule${rules === 1 ? '' : 's'}, ${this.excludedCount} chants`);
    if (words) parts.push(`${words} stop words`);
    return parts.join(' · ');
  }

  /** The fields a rule can look at: the usual text fields and every grouping field of the corpus. */
  get ruleFields(): FieldOption[] {
    const base: FieldOption[] = [
      { key: 'doc:textinitium', label: 'Text incipit' }, { key: 'doc:dokumenten_id', label: 'Document id' },
      { key: 'doc:gattung1', label: 'Genre 1' }, { key: 'doc:gattung2', label: 'Genre 2' }, { key: 'doc:festtag', label: 'Feast' }, { key: 'src:quellensigle', label: 'Source' },
    ];
    const have = new Set(base.map((b) => b.key));
    return [...base, ...this.fields.filter((f) => !have.has(f.key))];
  }

  /** The most frequent values of the chosen field, to leave out with one click. */
  get valueChips(): { value: string; chants: number }[] {
    return frequentValues({ docs: this.corpusInfos, chants: [] }, this.newRule.field, 14);
  }

  isExcludedValue(value: string): boolean {
    return this.filters.exclude.some((r) => r.field === this.newRule.field && r.value.toLowerCase() === value.toLowerCase());
  }

  private async setFilters(f: CorpusFilters): Promise<void> {
    if (!this.current) return;
    this.current.filters = f;
    await this.saveDefinition();
  }

  async addRule(value = this.newRule.value, mode: 'contains' | 'equals' = this.newRule.mode): Promise<void> {
    const v = value.trim();
    if (!v) return;
    const f = this.filters;
    if (f.exclude.some((r) => r.field === this.newRule.field && r.mode === mode && r.value.toLowerCase() === v.toLowerCase())) return;
    await this.setFilters({ ...f, exclude: [...f.exclude, { field: this.newRule.field, mode, value: v }] });
    this.newRule = { ...this.newRule, value: '' };
  }

  async removeRule(i: number): Promise<void> {
    await this.setFilters({ ...this.filters, exclude: this.filters.exclude.filter((_, k) => k !== i) });
  }

  async setBuiltInStopWords(on: boolean): Promise<void> {
    await this.setFilters({ ...this.filters, stopWords: { ...this.filters.stopWords, builtIn: on } });
  }

  async saveCustomStopWords(): Promise<void> {
    await this.setFilters({ ...this.filters, stopWords: { ...this.filters.stopWords, custom: parseWordList(this.customStopText) } });
  }

  fieldLabel(key: string): string { return this.ruleFields.find((f) => f.key === key)?.label ?? key.replace(/^(doc|src|custom):/, ''); }

  toggleInfo(id: string): void { if (this.infoOpen.has(id)) this.infoOpen.delete(id); else this.infoOpen.add(id); }

  /** A pattern was clicked in a result: open the corpus card and search for it there. */
  searchPattern(p: { unit: PatternUnit; text: string }): void {
    this.corpusOpen = true;
    this.patternRequest = { ...p, nonce: ++this.nonce };
    this.cdr.markForCheck();
    setTimeout(() => document.getElementById('corpus-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // ── starting ──────────────────────────────────────────────────────────────

  get selectionCount(): number { return this.selSvc.selection.size; }

  get filteredSources(): Source[] {
    const q = this.sourceFilter.trim().toLowerCase();
    return q ? this.sources.filter((s) => `${s.quellensigle} ${s.herkunftsort} ${s.bibliothek}`.toLowerCase().includes(q)) : this.sources;
  }
  get filteredSourceIds(): string[] { return this.filteredSources.map((s) => s.id as string); }

  /** Documents the chosen start mode would analyse. */
  get startIds(): string[] {
    switch (this.startMode) {
      case 'selection': return this.selSvc.selection.ids();
      case 'hits': return this.selSvc.lastHits?.ids ?? [];
      case 'sources': return this.selSvc.docIdsOfSources(this.sourcePick.ids());
      default: return this.selSvc.allDocs().map((d) => d.id);
    }
  }

  docsOfSource(id: string | undefined): number { return id ? this.selSvc.docIdsOfSource(id).length : 0; }

  async createFromStart(): Promise<void> {
    const ids = this.startIds;
    if (ids.length === 0) { this.statusLine.warning('There are no documents to analyse yet.'); return; }
    const origin: CorpusOrigin = this.startMode === 'selection' ? 'selection' : this.startMode === 'hits' ? 'hits' : this.startMode === 'all' ? 'all' : 'manual';
    const label = this.startMode === 'selection' ? `selection of ${ids.length} documents`
      : this.startMode === 'hits' ? (this.selSvc.lastHits?.label ?? `hits of the search, ${ids.length} documents`)
      : this.startMode === 'all' ? `every document of the workspace (${ids.length})`
      : `${this.sourcePick.size} source(s), ${ids.length} documents`;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const def = await AnalysisStore.create(`Analysis ${stamp}`, { docIds: ids, origin, label }, []);
    await this.refreshList();
    this.go(def.id);
  }

  // ── methods ───────────────────────────────────────────────────────────────

  methodsOf(group: string): AnalysisMethod[] { return METHODS.filter((m) => m.group === group); }

  isChosen(id: string): boolean { return !!this.current?.methods.some((m) => m.id === id); }

  paramsOf(id: string): ParamValues {
    const m = getMethod(id)!;
    return normalizeParams(m, this.current?.methods.find((x) => x.id === id)?.params ?? m.defaults);
  }

  async toggleMethod(id: string): Promise<void> {
    const def = this.current;
    if (!def) return;
    if (this.isChosen(id)) def.methods = def.methods.filter((m) => m.id !== id);
    else def.methods = [...def.methods, { id, params: { ...getMethod(id)!.defaults } }];
    await this.saveDefinition();
    if (!this.status[id]) this.status[id] = this.records.has(id) ? { state: 'unchecked' } : { state: 'none' };
  }

  async setParams(id: string, params: ParamValues): Promise<void> {
    const def = this.current;
    const m = def?.methods.find((x) => x.id === id);
    if (!def || !m) return;
    m.params = params;
    await this.saveDefinition();
  }

  toggleExpanded(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
  }

  /** Whether the stored result of a method used other parameters than the ones now set. */
  paramsChanged(id: string): boolean {
    const rec = this.records.get(id);
    return !!rec && (JSON.stringify(rec.params) !== JSON.stringify(this.paramsOf(id)) || (rec.filtersKey ?? '') !== filtersKey(this.current?.filters));
  }

  private async saveDefinition(): Promise<void> {
    if (!this.current) return;
    try {
      await AnalysisStore.save(this.current);
      await this.refreshList();
    } catch (e) {
      this.statusLine.error((e as Error).message);
    }
    this.cdr.markForCheck();
  }

  async rename(name: string): Promise<void> {
    if (!this.current || !name.trim()) return;
    this.current.name = name.trim();
    this.pageTitle.set(`Analysis: ${this.current.name}`);
    await this.saveDefinition();
  }

  async setNote(note: string): Promise<void> {
    if (!this.current) return;
    this.current.note = note;
    await this.saveDefinition();
  }

  // ── running ───────────────────────────────────────────────────────────────

  get ticked(): string[] { return this.current?.methods.map((m) => m.id) ?? []; }

  /** Methods that would be computed by "Run": ticked ones without a stored result for the current parameters, or stale. */
  get pending(): string[] {
    return this.ticked.filter((id) => {
      const s = this.status[id]?.state;
      return !this.records.has(id) || this.paramsChanged(id) || s === 'stale' || s === 'error';
    });
  }

  async run(ids: string[] = this.ticked, force = false): Promise<void> {
    const def = this.current;
    if (!def || !this.user || this.busy || ids.length === 0) return;
    this.busy = true;
    if (this.records.size > 0 || ids.length > 0) this.methodsOpen = false;
    this.cdr.markForCheck();
    try {
      const summary = await this.runner.run(def, ids, this.user.token, {
        onStatus: (id, st) => { this.status[id] = st; this.cdr.markForCheck(); },
        onResult: (rec) => { this.records.set(rec.methodId, rec); if (!this.shown || this.shown === rec.methodId) this.shown = rec.methodId; this.cdr.markForCheck(); },
      }, { force });
      for (const id of ids) {
        const st = this.status[id];
        if (summary.cancelled && st?.state === 'running') this.status[id] = this.records.has(id) ? { state: 'unchecked' } : { state: 'none' };
      }
      if (!this.shown) this.shown = ids.find((id) => this.records.has(id)) ?? '';
      const parts: string[] = [];
      if (summary.ran.length) parts.push(`computed ${summary.ran.length}`);
      if (summary.cached.length) parts.push(`reused ${summary.cached.length} from the saved results`);
      if (summary.failed.length) this.statusLine.error(summary.failed.map((f) => `${getMethod(f.id)?.title ?? f.id}: ${f.message}`).join('\n'));
      if (summary.excludedDocs) this.statusLine.info(`${summary.excludedDocs} chants were left out by the rules for leaving things out.`);
      if (summary.missingDocs) this.statusLine.warning(`${summary.missingDocs} documents of this analysis no longer exist and were left out.`);
      if (summary.cancelled) this.statusLine.info('The run was cancelled.');
      else if (parts.length) this.statusLine.success(`${parts.join(', ')} (${(summary.ms / 1000).toFixed(1)} s)`);
      await this.refreshList();
    } catch (e) {
      this.statusLine.error(e instanceof AnalysisStoreError ? e.message : `The run failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  recompute(id: string): Promise<void> { return this.run([id], true); }

  cancelRun(): void { this.runner.cancel(); this.cancelCheck = true; }
  private cancelCheck = false;

  /** Read the documents again and compare them with what the stored results were computed from. */
  async checkChanges(): Promise<void> {
    const def = this.current;
    if (!def || !this.user || this.checking || this.busy) return;
    this.checking = true;
    this.cancelCheck = false;
    this.checkProgress = { done: 0, total: def.corpus.docIds.length };
    this.cdr.markForCheck();
    try {
      const res = await this.runner.checkFreshness(def, this.user.token, (done, total) => { this.checkProgress = { done, total }; this.cdr.markForCheck(); }, () => this.cancelCheck);
      if (res) {
        for (const [id, st] of Object.entries(res)) this.status[id] = st;
        const stale = Object.values(res).filter((s) => s.state === 'stale').length;
        if (stale === 0) this.statusLine.success('The documents are unchanged: every stored result is up to date.');
        else this.statusLine.warning(`${stale} result(s) are out of date because documents changed. They stay visible until recomputed.`);
      }
    } finally {
      this.checking = false;
      this.cdr.markForCheck();
    }
  }

  // ── results ───────────────────────────────────────────────────────────────

  statusOf(id: string): MethodStatus { return this.status[id] ?? { state: 'none' }; }

  allMethodTitle(id: string): string { return getMethod(id)?.title ?? id; }

  /** Show the result of a method; its settings form starts closed. */
  showMethod(id: string): void {
    this.shown = id;
    this.settingsOpen = false;
  }

  /** The current settings of a method as short chips: what a run would use now. */
  paramChips(id: string): { label: string; value: string }[] {
    const m = getMethod(id);
    if (!m) return [];
    const v = this.paramsOf(id);
    const out: { label: string; value: string }[] = [];
    for (const spec of m.params) {
      if (spec.key === 'rows') continue;
      const raw = v[spec.key];
      let text: string;
      switch (spec.type) {
        case 'boolean': text = raw ? 'yes' : 'no'; break;
        case 'select': text = spec.options.find((o) => o.value === raw)?.label.split(/[:(]/)[0].trim() ?? String(raw); break;
        case 'field': text = raw === '' ? 'none' : this.fieldLabel(String(raw)); break;
        default: text = String(raw ?? '');
      }
      if (spec.type === 'text' && text === '') continue;
      out.push({ label: spec.label, value: text });
    }
    return out;
  }

  /** The title without the parenthesis that names the ChantDigger mode, for the tabs. */
  shortTitle(id: string): string { return this.allMethodTitle(id).replace(/\s*\(.*\)\s*$/, '').replace(/^Axis: .*/, 'Axis'); }

  get shownRecord(): ResultRecord | null { return this.shown ? this.records.get(this.shown) ?? null : null; }
  get shownMethod(): AnalysisMethod | undefined { return this.shown ? getMethod(this.shown) : undefined; }

  /** One line that states where a result comes from, for citation and for exports. */
  provenance(rec: ResultRecord): string {
    const m = getMethod(rec.methodId);
    const p = Object.entries(rec.params).filter(([, v]) => v !== '' && v !== false).map(([k, v]) => `${k}=${v}`).join(', ');
    const when = new Date(rec.computedAt).toISOString().slice(0, 16).replace('T', ' ');
    const f = describeFilters(this.current?.filters);
    return `${m?.title ?? rec.methodId} (version ${rec.methodVersion}) on ${this.current?.corpus.label ?? 'the corpus'}, ${rec.result.docCount} documents${f ? ` (${f})` : ''}; ${p || 'default parameters'}; computed ${when}; fingerprint ${rec.fingerprint.slice(0, 12)}.`
  }

  // ── how a result was computed, for citation ──────────────────────────────

  readonly softwareUrl = SOFTWARE_URL;
  private reportFor: { key: string; report: MethodReport | null } | null = null;

  /** The description of what the method did for this result (settings as stored with it). */
  report(rec: ResultRecord): MethodReport | null {
    const same = (rec.filtersKey ?? '') === filtersKey(this.current?.filters);
    const key = `${rec.methodId}|${rec.fingerprint}|${same}|${this.fields.length}`;
    if (this.reportFor?.key !== key) this.reportFor = { key, report: methodReport(rec.methodId, rec.params, same ? this.current?.filters ?? NO_FILTERS : 'unknown', (k) => this.fields.find((f) => f.key === k)?.label) };
    return this.reportFor.report;
  }

  /** The algorithm and references of the method in a popup (opened on request; the page shows one line only). */
  openAlgorithm(content: TemplateRef<unknown>): void {
    this.modal.open(content, { size: 'lg', scrollable: true });
  }

  /** Copy the description as plain text, LaTeX or BibTeX. */
  async copyReport(rec: ResultRecord, kind: 'text' | 'latex' | 'bibtex'): Promise<void> {
    const r = this.report(rec);
    if (!r) return;
    const label = { text: 'text', latex: 'LaTeX', bibtex: 'BibTeX' }[kind];
    try {
      await navigator.clipboard.writeText(kind === 'text' ? r.text : kind === 'latex' ? r.latex : r.bibtex);
      this.statusLine.success(`The description of the method was copied as ${label}.`);
    } catch {
      this.statusLine.error('The browser did not allow copying. Select the text and copy it.');
    }
  }

  openDocs(ids: string[]): void {
    this.selSvc.selection.replace(ids);
    this.selSvc.changed$.next();
    this.router.navigate(['/search'], { queryParams: { tab: 'documents' } });
  }

  // ── analysis actions ──────────────────────────────────────────────────────

  async duplicate(): Promise<void> {
    const def = this.current;
    if (!def) return;
    const copy = await AnalysisStore.create(`${def.name} (copy)`, def.corpus, def.methods.map((m) => ({ ...m, params: { ...m.params } })), def.note);
    for (const rec of this.records.values()) await AnalysisStore.putResult(copy.id, rec);
    await this.refreshList();
    this.go(copy.id);
  }

  async remove(id: string = this.current?.id ?? ''): Promise<void> {
    if (!id) return;
    const s = this.summaries.find((x) => x.id === id);
    if (!confirm(`Delete the analysis "${s?.name ?? id}" with all its stored results? This cannot be undone.`)) return;
    await AnalysisStore.delete(id);
    await this.refreshList();
    if (this.current?.id === id) this.go(null);
    this.cdr.markForCheck();
  }

  async export(withResults = true): Promise<void> {
    const def = this.current;
    if (!def) return;
    const file = await AnalysisStore.exportOne(def.id, withResults);
    const stem = def.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'analysis';
    downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${stem}.monodi-analysis.json`);
  }

  async importFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = AnalysisStore.parseExport(JSON.parse(await file.text()));
      const def = await AnalysisStore.importOne(parsed);
      await this.refreshList();
      this.statusLine.success(`Imported "${def.name}" with ${parsed.results.length} stored result(s). Use "Check for changes" to compare with the documents here.`);
      this.go(def.id);
    } catch (e) {
      this.statusLine.error(e instanceof SyntaxError ? 'This file is not valid JSON.' : (e as Error).message);
    }
  }

  async clearAll(): Promise<void> {
    if (!confirm(`Delete all ${this.summaries.length} saved analyses and their results? The documents are not touched.`)) return;
    await AnalysisStore.deleteAll();
    await this.refreshList();
    this.go(null);
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
}
