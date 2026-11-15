import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { applyFilters, describePattern, makeTable, parsePattern, PATTERN_UNIT_OPTIONS, ruleMatches, searchCorpus } from '@monodi/core/analysis';
import type { Cell, Corpus, PatternUnit, TableView } from '@monodi/core/analysis';
import type { Document, Source } from '../api.service';
import type { AnalysisDefinition } from './analysis-types';
import { CorpusLoader } from './corpus-loader';

/**
 * The documents of an analysis, listed with metadata (filter, sort, CSV, open in the search), and a search for a melodic
 * pattern in them: pitches, intervals or contour, exact, with differences, or with the notes spread inside a window.
 * The notes are read once and kept while the analysis is open.
 */
@Component({
  selector: 'app-corpus-panel',
  standalone: false,
  templateUrl: './corpus-panel.component.html',
})
export class CorpusPanelComponent implements OnChanges {
  @Input() def!: AnalysisDefinition;
  @Input() docs: Document[] = [];
  @Input() sources: Source[] = [];
  @Input() token = '';
  /** A pattern chosen elsewhere (a click on a pattern in a result); it fills the form and runs the search. */
  @Input() request: { unit: PatternUnit; text: string; nonce: number } | null = null;
  @Output() openDocs = new EventEmitter<string[]>();

  docsView: TableView | null = null;

  readonly units = PATTERN_UNIT_OPTIONS;
  unit: PatternUnit = 'interval';
  text = '';
  maxDistance = 0;
  window = 0;
  searching = false;
  progress = { done: 0, total: 0 };
  error = '';
  result: TableView | null = null;
  summary = '';

  private loaded: { key: string; corpus: Corpus } | null = null;
  private lastNonce = -1;

  constructor(private readonly loader: CorpusLoader) {}

  get example(): string { return this.units.find((u) => u.value === this.unit)?.example ?? ''; }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['docs'] || ch['sources'] || ch['def']) this.buildDocsView();
    if (ch['def'] && !ch['def'].firstChange) { this.result = null; this.summary = ''; this.loaded = null; }
    if (this.request && this.request.nonce !== this.lastNonce) {
      this.lastNonce = this.request.nonce;
      this.unit = this.request.unit;
      this.text = this.request.text;
      this.maxDistance = 0;
      this.window = 0;
      this.search();
    }
  }

  private buildDocsView(): void {
    const sources = new Map(this.sources.map((s) => [s.id as string, s]));
    const rows: Cell[][] = this.docs.map((d) => [
      d.dokumenten_id || d.id, sources.get(d.quelle_id)?.quellensigle ?? '', d.gattung1 || null, d.festtag || null, d.textinitium || null,
    ]);
    const rules = (this.def?.filters?.exclude ?? []).filter((r) => r.value.trim());
    const left = (d: Document) => rules.some((r) => ruleMatches(r, { 'doc:textinitium': d.textinitium ?? '', 'doc:dokumenten_id': d.dokumenten_id ?? '', 'doc:gattung1': d.gattung1 ?? '', 'doc:gattung2': d.gattung2 ?? '', 'doc:festtag': d.festtag ?? '', 'src:quellensigle': sources.get(d.quelle_id)?.quellensigle ?? '', ...Object.fromEntries(Object.entries(d.custom ?? {}).map(([k, v]) => [`custom:${k}`, String(v)])) }));
    const rows2: Cell[][] = this.docs.map((d, i) => [...rows[i], left(d) ? 'left out' : 'used']);
    this.docsView = makeTable({
      title: `Documents of this analysis`,
      columns: [
        { key: 'chant', label: 'Document' }, { key: 'source', label: 'Source' }, { key: 'genre', label: 'Genre 1' },
        { key: 'feast', label: 'Feast' }, { key: 'incipit', label: 'Text incipit' },
        { key: 'used', label: 'In the analysis', help: 'Chants matching a rule of "Leave out" are not used by any method or by the pattern search.' },
      ],
      rows: rows2, rowDocs: this.docs.map((d) => [d.id]), cap: 5000,
    });
  }

  async search(): Promise<void> {
    this.error = '';
    const parsed = parsePattern(this.text, this.unit);
    if ('error' in parsed) { this.error = parsed.error; return; }
    if (this.searching || !this.def) return;
    this.searching = true;
    this.progress = { done: 0, total: this.def.corpus.docIds.length };
    try {
      const key = `${this.def.id}:${this.def.corpus.docIds.length}`;
      if (!this.loaded || this.loaded.key !== key) {
        const loaded = await this.loader.load(this.def.corpus.docIds, this.token, (done, total) => { this.progress = { done, total }; });
        if (!loaded) return;
        this.loaded = { key, corpus: loaded.corpus };
      }
      const t0 = performance.now();
      const r = searchCorpus(applyFilters(this.loaded.corpus, this.def.filters).corpus, parsed.pattern, { maxDistance: this.maxDistance, window: this.maxDistance === 0 && this.window > 0 ? this.window : undefined });
      this.result = { ...r.table, title: `Chants with the pattern ${describePattern(parsed.pattern)}` };
      const used = applyFilters(this.loaded.corpus, this.def.filters).corpus.chants.length;
      this.summary = `${r.chants.toLocaleString('en')} of ${used.toLocaleString('en')} chants contain the pattern, ${r.matches.toLocaleString('en')} passages (${Math.round(performance.now() - t0)} ms).`;
    } catch (e) {
      this.error = `The search failed: ${(e as Error).message}`;
    } finally {
      this.searching = false;
    }
  }
}
