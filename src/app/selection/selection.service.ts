import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { APIService, Document } from '../api.service';
import { IdSelection, SelectState } from './selection-set';

/**
 * The documents the user has picked on the search page, kept for the whole session: they survive leaving the page and
 * are what the Analysis page offers as "the selection". The selection is a set of ids; the documents behind them come
 * from an index of the workspace (loaded once, refreshed on request), so a pick made from a search hit always has the
 * real metadata and never a stub.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  readonly selection = new IdSelection();
  /** Emits after every change made through this service. */
  readonly changed$ = new Subject<void>();

  /**
   * The documents behind the hits of the last search from which the user opened the Analysis page ("Analyze…"), with a
   * short description for the provenance line. Kept for the session.
   */
  lastHits: { ids: string[]; label: string } | null = null;

  private index = new Map<string, Document>();
  private bySource = new Map<string, string[]>();
  private indexVersion = 0;
  private indexLoading: Promise<void> | null = null;
  private memo: { selVersion: number; idxVersion: number; docs: Document[] } | null = null;

  constructor(private readonly api: APIService) {}

  /** Load the document index of the workspace if it has not been loaded yet. */
  ensureIndex(token: string): Promise<void> {
    if (this.indexVersion > 0) return Promise.resolve();
    return this.refreshIndex(token);
  }

  /** Reload the index (after documents were added, changed or removed). */
  refreshIndex(token: string): Promise<void> {
    if (this.indexLoading) return this.indexLoading;
    this.indexLoading = (async () => {
      try {
        const res = await this.api.listDocuments(token).toPromise();
        const docs = res?.kind === 'DocumentsRetrieved' ? res.documents : [];
        this.index = new Map(docs.map((d) => [d.id, d]));
        this.bySource = new Map();
        for (const d of docs) {
          const list = this.bySource.get(d.quelle_id);
          if (list) list.push(d.id); else this.bySource.set(d.quelle_id, [d.id]);
        }
        this.indexVersion++;
        this.memo = null;
      } finally {
        this.indexLoading = null;
      }
    })();
    return this.indexLoading;
  }

  get indexed(): boolean { return this.indexVersion > 0; }

  /** Increases whenever the index was reloaded; views that depend on source membership use it as a cache key. */
  get indexRevision(): number { return this.indexVersion; }

  /** The real document for an id, when the index knows it. */
  docOf(id: string): Document | undefined { return this.index.get(id); }

  /** All documents of the workspace in index order. */
  allDocs(): Document[] { return [...this.index.values()]; }

  /** Ids of the documents of a source. */
  docIdsOfSource(sourceId: string): string[] { return this.bySource.get(sourceId) ?? []; }

  /** Ids of the documents of several sources, in the order of the sources. */
  docIdsOfSources(sourceIds: Iterable<string>): string[] {
    const out: string[] = [];
    for (const s of sourceIds) out.push(...this.docIdsOfSource(s));
    return out;
  }

  /** Remember a document that is not in the index yet (for example one picked before the index finished loading). */
  remember(doc: Document): void {
    if (doc?.id && !this.index.has(doc.id)) { this.index.set(doc.id, doc); this.memo = null; }
  }

  /** The selected documents, in the order they were selected. The same array until the selection or the index changes. */
  selectedDocs(): Document[] {
    const m = this.memo;
    if (m && m.selVersion === this.selection.version && m.idxVersion === this.indexVersion) return m.docs;
    const docs = this.selection.ids().map((id) => this.index.get(id) ?? stubDocument(id));
    this.memo = { selVersion: this.selection.version, idxVersion: this.indexVersion, docs };
    return docs;
  }

  /** Select exactly these documents. */
  replaceWith(docs: Document[]): void {
    for (const d of docs) this.remember(d);
    this.selection.replace(docs.map((d) => d.id));
    this.changed$.next();
  }

  toggle(doc: Document): boolean {
    this.remember(doc);
    const on = this.selection.toggle(doc.id);
    this.changed$.next();
    return on;
  }

  selectAll(universe: string[]): void { this.selection.selectAll(universe); this.changed$.next(); }
  invert(universe: string[]): void { this.selection.invert(universe); this.changed$.next(); }
  keepOnly(universe: string[]): void { this.selection.keepOnly(universe); this.changed$.next(); }
  clear(): void { this.selection.clear(); this.changed$.next(); }

  /** Add or remove all documents of a source; returns the state afterwards. */
  toggleSource(sourceId: string): SelectState {
    const ids = this.docIdsOfSource(sourceId);
    if (ids.length === 0) return 'none';
    if (this.selection.stateOf(ids) === 'all') this.selection.remove(ids); else this.selection.add(ids);
    this.changed$.next();
    return this.selection.stateOf(ids);
  }

  /** Whether none, some or all documents of a source are selected. */
  sourceState(sourceId: string): SelectState {
    return this.selection.stateOf(this.docIdsOfSource(sourceId));
  }
}

/** A placeholder for a selected id whose document is not in the index (it was deleted, or the index is still loading). */
function stubDocument(id: string): Document {
  return {
    id, quelle_id: '', dokumenten_id: id, textinitium: '', gattung1: '', gattung2: '', festtag: '', feier: '',
    bibliographischerverweis: '', druckausgabe: '', zeilenstart: '', foliostart: '', kommentar: '', editionsstatus: '',
  } as Document;
}
