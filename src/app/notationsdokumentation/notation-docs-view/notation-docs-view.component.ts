import { Component, EventEmitter, HostListener, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Document, Source } from '../../api.service';
import { boundsOf, padRect } from '../../iiif-crop';
import { notationNotes } from '../../notation-doc';
import { applyLinks, emptyIndex, LinkReport, linksToStore, resolveLinks, TranscriptionIndex } from '../../notation-links';
import { baseCode, searchPatterns, signatureOf } from '../../notation-order';
import { buildOverview, LineView, Overview, PatternView, SnippetView } from '../../notation-overview';
import { candidatesFor, Candidate, defaultSetup, NotationSetup, setIncluded } from '../../notation-set';
import { parseTreeCode } from '../../neume-tree';
import { loadStripImages } from '../../notation-strip-images';
import { looksNegative } from '../../print/image-loader';
import { cropView, CropView } from '../crop-view';
import { manifestCanvases } from '../manifest-cache';
import { PageImage, pageImageOf } from '../region-page';

/** The views of the page. `annotate` (the scan editor) is the source page's, not this component's. */
export type NotationView = 'table' | 'lines' | 'tree' | 'data';

/** How a strip is cut from its page: a little more than the line, so that signs above the staff show (as the print does). */
const STRIP_PAD_X = 0.01;
const STRIP_PAD_Y = 0.12;

/**
 * A manuscript's notation documentation, read first and edited little, laid out like a manuscript page of
 * the Neumen-Editor's documentation viewer (neume-docs):
 *
 *   - what it holds and how that is tied together (the model at the top: table, snippets, lines, transcription);
 *   - the transcription equivalents: the table as printed, each pattern with its snippets and its neumes in
 *     the transcription;
 *   - the sign inventory: every line region with its signs framed, and under it the transcription line it covers;
 *   - the neume tree, and every record as it is stored (Data).
 *
 * A pattern opens a panel (its snippets, every place the transcription has it, each a link into the document);
 * a snippet opens a dialog (its picture, its line, the neume it depicts). Both can be linked to (`?pattern=`,
 * `?snippet=`).
 */
@Component({
  selector: 'app-notation-docs-view',
  standalone: false,
  templateUrl: './notation-docs-view.component.html',
  styleUrls: ['./notation-docs-view.component.css'],
})
export class NotationDocsViewComponent implements OnChanges, OnInit {
  @Input() source: Source | null = null;
  @Input() setup: NotationSetup = defaultSetup();
  /** The documents of this source (for their names). */
  @Input() documents: Document[] = [];
  /** The transcription's neumes; null while they are read. */
  @Input() index: TranscriptionIndex | null = null;
  @Input() view: NotationView = 'table';
  @Output() viewChange = new EventEmitter<NotationView>();
  /** The source was changed (the page saves it). */
  @Output() sourceChanged = new EventEmitter<void>();
  /** Open the scan editor, at this folio if one is given. */
  @Output() annotate = new EventEmitter<string>();
  /** Print the documentation. */
  @Output() print = new EventEmitter<void>();

  readonly views: { id: NotationView; label: string; icon: string }[] = [
    { id: 'table', label: 'Equivalents', icon: 'bi-table' },
    { id: 'lines', label: 'Sign inventory', icon: 'bi-images' },
    { id: 'tree', label: 'Neume tree', icon: 'bi-diagram-3' },
    { id: 'data', label: 'Data', icon: 'bi-database' },
  ];

  overview: Overview = buildOverview({}, defaultSetup(), emptyIndex(), { snippets: new Map(), lines: new Map() });
  report: LinkReport = { snippets: new Map(), lines: new Map() };
  candidates: Candidate[] = [];
  notes = '';
  /** Links that were worked out and can be stored. */
  storable = { items: 0, regions: 0 };
  docById = new Map<string, Document>();
  /** The model at the top: how much there is and how much of it is tied to the transcription. */
  summary = {
    inTranscription: 0, folios: 0,
    snippetsLinked: 0, snippetsFound: 0, snippetsLost: 0, snippetsNone: 0,
    linesLinked: 0, linesFound: 0, linesLost: 0, linesNone: 0,
  };
  /** The Data view's rows of patterns: every pattern the documentation could show, with what is stored about it. */
  dataRows: { c: Candidate; own: { refId: string; notes?: string } | undefined; standardId: string; transcription: number }[] = [];
  /** The patterns of the neume tree: those of the table. */
  treeCodes: string[] = [];
  readonly noVariant = { variant: '', snippets: [] as SnippetView[], places: [] as { text: string; snippet: SnippetView }[] };

  // pictures
  canvases: any[] = [];
  manifestProblem = '';
  manifestLoading = false;
  private localImages: { [regionId: string]: PageImage } = {};
  lineCrops = new Map<string, CropView | null>();
  signCrops = new Map<string, CropView | null>();
  invert = false;
  private invertChecked = false;

  // what is open
  panel: PatternView | null = null;
  dialog: SnippetView | null = null;
  dialogSiblings: SnippetView[] = [];
  dialogSign: CropView | null = null;
  dialogLine: CropView | null = null;
  hover = '';
  target = '';
  inventory: 'lines' | 'grid' = 'lines';
  /** The sign inventory shows only the snippets of this pattern ('' = all). */
  onlyPattern = '';
  showOthers = false;
  query = '';
  hits: string[] = [];
  /** The open pattern's occurrences by document, and its relatives (made when it opens, not on every pass). */
  panelDocs: { docId: string; places: PatternView['occurrences'] }[] = [];
  panelDocsTotal = 0;
  panelAllDocs = false;
  panelRelated: { pattern: string; count: number }[] = [];

  private loadedFor = '';

  constructor(private route: ActivatedRoute, private router: Router, private toastr: ToastrService) {}

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    this.pendingPattern = q.get('pattern') ?? '';
    this.pendingSnippet = q.get('snippet') ?? '';
    this.openPending();
  }

  private pendingPattern = '';
  private pendingSnippet = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['documents']) this.docById = new Map(this.documents.map(d => [d.id, d]));
    this.refresh();
    if (changes['source'] && this.source?.id !== this.loadedFor) {
      this.loadedFor = this.source?.id ?? '';
      void this.loadPictures();
    }
    this.openPending();
  }

  /** Everything the page shows, made again from the source, the set and the transcription. */
  refresh(): void {
    const src: any = this.source ?? {};
    const index = this.index ?? emptyIndex();
    this.report = resolveLinks(src, index);
    this.overview = buildOverview(src, this.setup, index, this.report);
    this.candidates = candidatesFor(src, this.setup);
    this.treeCodes = this.overview.rows.map(r => r.pattern);
    this.notes = notationNotes(src);
    const store = linksToStore(this.report);
    this.storable = { items: store.items.size, regions: store.regions.size };
    const k = this.overview.counts.snippetLinks, l = this.overview.counts.lineLinks;
    this.summary = {
      inTranscription: this.overview.rows.filter(r => r.occurrences.length).length,
      folios: new Set(this.overview.lines.map(x => x.place.folio).filter(Boolean)).size,
      snippetsLinked: k.stored, snippetsFound: k.reference + k.position, snippetsLost: k.lost, snippetsNone: k.none,
      linesLinked: l.stored, linesFound: l.snippets + l.name, linesLost: l.lost, linesNone: l.none,
    };
    const own = new Map<string, { refId: string; notes?: string }>();
    for (const e of src.equivalents ?? []) if (!own.has(baseCode(e.pattern))) own.set(baseCode(e.pattern), e);
    const standard = new Map(this.setup.standard.map(e => [e.pattern, e.refId]));
    this.dataRows = this.candidates.map(c => ({ c, own: own.get(c.pattern), standardId: standard.get(c.pattern) ?? '', transcription: index.byPattern.get(c.pattern)?.length ?? 0 }));
    // an open panel or dialog shows the new state of what it shows
    if (this.panel) this.setPanel(this.patternView(this.panel.pattern));
    if (this.dialog) {
      const s = this.overview.snippetById.get(this.dialog.item.id) ?? null;
      this.dialogSiblings = this.dialogSiblings.map(x => this.overview.snippetById.get(x.item.id)).filter((x): x is SnippetView => !!x);
      this.setDialog(s);
    }
    this.buildCrops();
  }

  get loading(): boolean { return !this.index; }

  setView(v: NotationView): void {
    if (v === this.view) return;
    this.view = v;
    this.viewChange.emit(v);
  }

  // ── pictures ────────────────────────────────────────────────────────────────────────────────────

  private async loadPictures(): Promise<void> {
    const source = this.source;
    this.canvases = [];
    this.manifestProblem = '';
    this.localImages = {};
    this.invertChecked = false;
    this.invert = false;
    if (!source) return;
    const kept = await loadStripImages(source.id);
    const sized = await Promise.all(Object.entries(kept).map(async ([id, url]) => [id, { url, ...(await sizeOf(url)) }] as const));
    if (this.source !== source) return;
    this.localImages = Object.fromEntries(sized);
    this.buildCrops();

    // the manifest places the lines on their pages (and gives the pages' sizes); lines kept as pictures need none
    const regions = source.annotationRegions ?? [];
    if (source.iiifManifestUrl && regions.some(r => !this.localImages[r.id])) {
      this.manifestLoading = true;
      try {
        const canvases = await manifestCanvases(source.iiifManifestUrl);
        if (this.source !== source) return;
        this.canvases = canvases;
      } catch (e: any) {
        if (this.source !== source) return;
        this.manifestProblem = `The IIIF manifest could not be read (${e?.message || 'network error'}); the library may not let other websites read it.`;
      } finally {
        if (this.source === source) this.manifestLoading = false;
      }
      this.buildCrops();
    } else if (!source.iiifManifestUrl && regions.some(r => !this.localImages[r.id] && !r.imageId)) {
      this.manifestProblem = 'This manuscript has no IIIF manifest, so its lines cannot be cut from the pages.';
    }
  }

  private pageOf(regionId: string): PageImage | null {
    const local = this.localImages[regionId];
    if (local) return local;
    const region = (this.source?.annotationRegions ?? []).find(r => r.id === regionId);
    return region ? pageImageOf(region, this.canvases) : null;
  }

  /** The strip of every line and the close-up of every sign: fields, so that change detection does not make them again. */
  private buildCrops(): void {
    this.lineCrops = new Map();
    this.signCrops = new Map();
    for (const line of this.overview.lines) {
      const page = this.pageOf(line.region.id);
      const local = !!this.localImages[line.region.id];
      const rect = local ? { x: 0, y: 0, w: 100, h: 100 } : line.rect && padRect(line.rect, STRIP_PAD_X, STRIP_PAD_Y);
      this.lineCrops.set(line.region.id, rect ? cropView(page, rect, 1400, line.snippets.map(s => ({ id: s.item.id, points: s.item.points, label: s.label }))) : null);
      for (const s of line.snippets) {
        const r = boundsOf(s.item.points);
        this.signCrops.set(s.item.id, r ? cropView(page, padRect(r, 0.3, 0.25), 240) : null);
      }
    }
    void this.checkNegative();
  }

  /** Negative scans (light ink on a dark ground, as some libraries publish them) are shown inverted, as the print does. */
  private async checkNegative(): Promise<void> {
    if (this.invertChecked) return;
    const first = [...this.lineCrops.values()].find(c => c?.url);
    if (!first?.url) return;
    this.invertChecked = true;
    const source = this.source;
    const negative = await looksNegative(first.url);
    if (this.source === source && negative !== null) this.invert = negative;
  }

  // ── what is open ──────────────────────────────────────────────────────────────────────────────

  private patternView(pattern: string): PatternView | null {
    const p = baseCode(pattern);
    return this.overview.rows.find(r => r.pattern === p) ?? this.overview.others.find(r => r.pattern === p) ?? null;
  }

  openPattern(pattern: string): void {
    this.panelAllDocs = false;
    this.setPanel(this.patternView(pattern));
    this.remember();
  }

  closePanel(): void { this.setPanel(null); this.remember(); }

  private setPanel(p: PatternView | null): void {
    this.panel = p;
    const all = p ? this.occurrencesByDocument(p) : [];
    this.panelDocsTotal = all.length;
    this.panelDocs = this.panelAllDocs ? all : all.slice(0, 12);
    this.panelRelated = p ? this.relatedPatterns(p) : [];
  }

  showAllDocs(): void {
    this.panelAllDocs = true;
    this.setPanel(this.panel);
  }

  openSnippet(s: SnippetView | undefined | null, siblings: SnippetView[] = []): void {
    if (!s) return;
    this.dialogSiblings = siblings.length ? siblings : this.overview.snippets;
    this.setDialog(s);
    this.remember();
  }

  openSnippetById(id: string, siblings: SnippetView[] = []): void { this.openSnippet(this.overview.snippetById.get(id), siblings); }

  closeDialog(): void { this.setDialog(null); this.remember(); }

  step(delta: number): void {
    if (!this.dialog || this.dialogSiblings.length < 2) return;
    const i = this.dialogSiblings.findIndex(s => s.item.id === this.dialog!.item.id);
    if (i < 0) return;
    this.setDialog(this.dialogSiblings[(i + delta + this.dialogSiblings.length) % this.dialogSiblings.length]);
    this.remember();
  }

  get dialogPosition(): number { return this.dialog ? this.dialogSiblings.findIndex(s => s.item.id === this.dialog!.item.id) : -1; }

  private setDialog(s: SnippetView | null): void {
    this.dialog = s;
    this.dialogSign = null;
    this.dialogLine = null;
    if (!s?.region) return;
    const page = this.pageOf(s.region.id);
    const r = boundsOf(s.item.points);
    if (r) this.dialogSign = cropView(page, padRect(r, 0.9, 0.5, 6, 3), 900, [{ id: s.item.id, points: s.item.points, strong: true }]);
    const line = this.overview.lines.find(l => l.region.id === s.region!.id);
    const local = !!this.localImages[s.region.id];
    const rect = local ? { x: 0, y: 0, w: 100, h: 100 } : line?.rect && padRect(line.rect, STRIP_PAD_X, STRIP_PAD_Y);
    if (line && rect) {
      this.dialogLine = cropView(page, rect, 1400, line.snippets.map(x => ({ id: x.item.id, points: x.item.points, label: x.label, strong: x.item.id === s.item.id })));
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'Escape') {
      if (this.dialog) this.closeDialog();
      else if (this.panel) this.closePanel();
    } else if (this.dialog && e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
    else if (this.dialog && e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
  }

  /** What is open goes into the address, so that it can be linked to and survives a reload. */
  private remember(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { pattern: this.panel?.pattern || null, snippet: this.dialog?.item.id || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private openPending(): void {
    if (!this.source) return;
    if (this.pendingPattern) { this.setPanel(this.patternView(this.pendingPattern)); this.pendingPattern = ''; }
    if (this.pendingSnippet && this.overview.snippetById.has(this.pendingSnippet)) {
      this.openSnippetById(this.pendingSnippet);
      this.target = this.pendingSnippet;
      this.pendingSnippet = '';
    }
  }

  /** The sign inventory, with only the snippets of one pattern. */
  showOnLines(pattern: string): void {
    this.onlyPattern = pattern;
    this.setPanel(null);
    this.remember();
    this.setView('lines');
  }

  private _shownLines: LineView[] = [];
  private _shownKey: unknown[] = [];
  /** The lines of the sign inventory (memoized: the list is iterated by the template). */
  linesToShow(): LineView[] {
    const key = [this.overview, this.onlyPattern];
    if (key[0] !== this._shownKey[0] || key[1] !== this._shownKey[1]) {
      this._shownKey = key;
      this._shownLines = this.onlyPattern
        ? this.overview.lines.filter(l => l.snippets.some(s => s.pattern === this.onlyPattern))
        : this.overview.lines;
    }
    return this._shownLines;
  }

  /** Snippets of a line as the inventory shows them (all, or those of the one pattern). */
  lineSnippets(line: LineView): SnippetView[] {
    return this.onlyPattern ? line.snippets.filter(s => s.pattern === this.onlyPattern) : line.snippets;
  }

  /** Patterns with the same notes and other brackets or signs (`[*d]u`, `*du`, `[*du]`), as the transcription has them. */
  private relatedPatterns(p: PatternView): { pattern: string; count: number }[] {
    const sig = signatureOf(p.pattern).replace(/[A-Z]/g, '');
    const out: { pattern: string; count: number }[] = [];
    for (const [code, list] of (this.index ?? emptyIndex()).byPattern) {
      if (code !== p.pattern && signatureOf(code).replace(/[A-Z]/g, '') === sig) out.push({ pattern: code, count: list.length });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 12);
  }

  // ── the transcription ───────────────────────────────────────────────────────────────────────

  docLabel(docId: string): string { return this.docById.get(docId)?.dokumenten_id || docId; }
  docTitle(docId: string): string { return this.docById.get(docId)?.textinitium || ''; }

  /** The occurrences of a pattern, by document. */
  private occurrencesByDocument(p: PatternView): { docId: string; places: PatternView['occurrences'] }[] {
    const out: { docId: string; places: PatternView['occurrences'] }[] = [];
    const at = new Map<string, number>();
    for (const o of p.occurrences) {
      let i = at.get(o.neume.docId);
      if (i === undefined) { i = out.length; at.set(o.neume.docId, i); out.push({ docId: o.neume.docId, places: [] }); }
      out[i].places.push(o);
    }
    // documents whose neumes a snippet depicts first, then by how often
    out.sort((a, b) => Number(b.places.some(x => x.snippet)) - Number(a.places.some(x => x.snippet)) || b.places.length - a.places.length);
    return out;
  }

  /** Opens the transcription at this neume (the document view scrolls to it and lights it up). */
  openInTranscription(docId: string, noteUuid: string): void {
    if (!this.source?.id) return;
    void this.router.navigate(['/document', this.source.id, docId], { queryParams: { focus: noteUuid || null } });
  }

  // ── changes (few: the documentation is edited in the Neumen-Editor) ────────────────────────────

  /** Stores the links that were worked out (the snippet's `uuid`, the region's `lineUUID`). */
  storeLinks(): void {
    if (!this.source) return;
    const done = applyLinks(this.source as any, this.report);
    this.changed();
    this.toastr.success(`${done.items} snippet${done.items === 1 ? '' : 's'} and ${done.regions} line${done.regions === 1 ? '' : 's'} are now linked to the transcription.`);
  }

  setShown(pattern: string, shown: boolean): void {
    if (!this.source) return;
    setIncluded(this.source as any, this.setup, pattern, shown);
    this.changed();
  }

  /** The Reference ID and note of a pattern in this manuscript's table. */
  saveEquivalent(pattern: string, refId: string, notes: string): void {
    if (!this.source) return;
    const list = (this.source.equivalents ??= []);
    const id = String(refId ?? '').trim(), note = String(notes ?? '').trim();
    const row = list.find(e => baseCode(e.pattern) === pattern);
    if (row) {
      if (row.refId === id && (row.notes ?? '') === note) return;
      row.refId = id;
      if (note) row.notes = note; else delete row.notes;
    } else {
      if (!id && !note) return;
      list.push(note ? { pattern, refId: id, notes: note } : { pattern, refId: id });
    }
    this.changed();
  }

  search(): void {
    this.hits = searchPatterns(this.query, new Set(this.overview.rows.map(r => r.pattern)), 12);
  }

  /** Shows a pattern the documentation did not show (from the library, or as typed). */
  addPattern(code: string): void {
    const p = baseCode(code);
    if (!p || !parseTreeCode(p)) return;
    this.query = '';
    this.hits = [];
    this.setShown(p, true);
  }

  private changed(): void {
    this.refresh();
    this.sourceChanged.emit();
  }

  // ── for the template ─────────────────────────────────────────────────────────────────────────

  readonly linkText: { [kind: string]: string } = {
    stored: 'Linked to the transcription',
    reference: 'Found by its Neume Viewer reference (not stored yet)',
    position: 'Found by its place on the line (not stored yet)',
    lost: 'Linked to a note that none of the documents has (any more)',
    none: 'Not linked to the transcription',
  };
  readonly lineLinkText: { [kind: string]: string } = {
    stored: 'Linked to the transcription line',
    snippets: 'Its snippets stand on this transcription line (not stored yet)',
    name: 'Found by its folio and line number (not stored yet)',
    lost: 'Linked to a line that none of the documents has (any more)',
    none: 'Not linked to a transcription line',
  };
  originLabel(o: string): string {
    return o === 'standard' ? 'standard set' : o === 'snippets' ? 'snippets' : o === 'table' ? 'manuscript table' : 'added';
  }
  plural(n: number, one: string, many = one + 's'): string { return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`; }
  trackSnippet = (_: number, s: SnippetView) => s.item.id;
  trackLine = (_: number, l: LineView) => l.region.id;
  trackPattern = (_: number, p: PatternView) => p.pattern;
}

/** The pixel size of a picture given as a data URL; 0 × 0 if it cannot be decoded. */
function sizeOf(url: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}
