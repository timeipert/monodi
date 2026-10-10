import { ApplicationRef, Component, EnvironmentInjector, EventEmitter, Injectable, Input, OnInit, Output, createComponent } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import * as VM from './types/model';
import { APIService, Document, ProjectSettings, Source } from './api.service';
import { UserService } from './user.service';
import { PdfBoxLabel, PdfDocJob, PdfExportService } from './pdf-export.service';
import { genreOf } from './document-metadata';

interface Entry { id: string; doc: Document | null; job: PdfDocJob | null; }

interface DialogOptions {
  titlePage: boolean;
  contents: boolean;
  metadata: boolean;
  apparatus: boolean;
  newPage: boolean;
  pageFormat: 'settings' | 'cm' | 'a4';
  boxLabel: PdfBoxLabel;
}

const OPTIONS_KEY = (multi: boolean) => `monodi_pdf_dialog_${multi ? 'multi' : 'single'}`;

/**
 * Print one or several documents as a PDF typeset like the printed edition.
 * One document: optional title page with a metadata table. Several documents: they run on in
 * one flow (each begins with a heading line), a contents table (ID, incipit, genre, page) on
 * the title page, one collected apparatus divided by document. Opened from the document view,
 * the search results, a manuscript, the synopsis and the workspace export.
 */
@Component({
  selector: 'app-pdf-export-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.5); z-index: 2000;" (keydown.escape)="!busy && close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content shadow">
        <div class="modal-header bg-light border-bottom">
          <h5 class="modal-title fw-bold">
            <i class="bi bi-file-pdf me-2 text-danger"></i>Print as PDF
            <span class="badge bg-secondary-subtle text-secondary fw-normal ms-2">{{entries.length}} document{{entries.length === 1 ? '' : 's'}}</span>
          </h5>
        </div>

        <div class="modal-body p-0">
          <div class="row g-0">
            <!-- ── Documents ─────────────────────────────────────────────── -->
            <div class="col-md-6 border-end p-3">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <div class="small fw-semibold text-uppercase text-muted" style="letter-spacing: .06em;">Documents</div>
                @if (entries.length > 1) {
                  <div class="btn-group btn-group-sm" role="group" aria-label="Sort">
                    <button type="button" class="btn btn-outline-secondary" (click)="sortBy('id')" [disabled]="busy" title="Sort by document ID">ID</button>
                    <button type="button" class="btn btn-outline-secondary" (click)="sortBy('incipit')" [disabled]="busy" title="Sort by incipit">Incipit</button>
                    <button type="button" class="btn btn-outline-secondary" (click)="sortBy('genre')" [disabled]="busy" title="Sort by genre">Genre</button>
                  </div>
                }
              </div>
              <ol class="list-unstyled mb-0 pdf-doc-list" style="max-height: 340px; overflow: auto;">
                @for (e of entries; track e.id; let i = $index) {
                  <li class="d-flex align-items-start gap-2 py-1 border-bottom">
                    <span class="text-muted small text-end" style="width: 1.6rem;">{{i + 1}}</span>
                    <div class="flex-grow-1 small" style="min-width: 0;">
                      @if (e.doc) {
                        <div class="text-truncate"><span class="fw-semibold">{{e.doc.dokumenten_id}}</span><span class="fst-italic ms-2">{{e.doc.textinitium}}</span></div>
                        @if (genre(e.doc)) { <div class="text-secondary text-truncate" style="font-size: .78rem;">{{genre(e.doc)}}</div> }
                      } @else {
                        <span class="text-muted">Loading…</span>
                      }
                    </div>
                    <div class="btn-group btn-group-sm flex-shrink-0">
                      <button type="button" class="btn btn-link text-secondary px-1" (click)="move(i, -1)" [disabled]="busy || i === 0" title="Move up"><i class="bi bi-chevron-up"></i></button>
                      <button type="button" class="btn btn-link text-secondary px-1" (click)="move(i, 1)" [disabled]="busy || i === entries.length - 1" title="Move down"><i class="bi bi-chevron-down"></i></button>
                      <button type="button" class="btn btn-link text-danger px-1" (click)="remove(i)" [disabled]="busy" title="Leave out"><i class="bi bi-x-lg"></i></button>
                    </div>
                  </li>
                }
              </ol>
              @if (entries.length > 150) {
                <div class="alert alert-warning small mt-2 mb-0 py-2">Printing {{entries.length}} documents can take a few minutes.</div>
              }
            </div>

            <!-- ── Options ───────────────────────────────────────────────── -->
            <div class="col-md-6 p-3">
              <div class="small fw-semibold text-uppercase text-muted mb-2" style="letter-spacing: .06em;">Options</div>
              @if (multi) {
                <label class="form-label small text-muted mb-1" for="pdfTitle">Title</label>
                <input id="pdfTitle" class="form-control form-control-sm mb-3" [(ngModel)]="title" [disabled]="busy" placeholder="Title of the print">
              }
              <label class="form-label small text-muted mb-1" for="pdfFormat">Page format</label>
              <select id="pdfFormat" class="form-select form-select-sm mb-3" [(ngModel)]="o.pageFormat" [disabled]="busy" (ngModelChange)="save()">
                <option value="settings">As in the settings</option>
                <option value="cm">Print edition (21 × 27 cm)</option>
                <option value="a4">A4</option>
              </select>

              <label class="form-label small text-muted mb-1" for="pdfBox">Framed number in the margin</label>
              <select id="pdfBox" class="form-select form-select-sm mb-3" [(ngModel)]="o.boxLabel" [disabled]="busy" (ngModelChange)="save()">
                <option value="enumeration">Manuscript – running number (Aa 1, Aa 2 …)</option>
                <option value="incipit">Manuscript – incipit (Aa Gloriosae)</option>
                <option value="genre">Genre – manuscript (Sequenz Aa)</option>
                <option value="none">None</option>
              </select>

              <div class="form-check form-switch mb-1">
                <input class="form-check-input" type="checkbox" id="oTitle" [(ngModel)]="o.titlePage" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oTitle">Title page</label>
              </div>
              @if (multi) {
                <div class="form-check form-switch mb-1 ms-4">
                  <input class="form-check-input" type="checkbox" id="oContents" [(ngModel)]="o.contents" [disabled]="busy || !o.titlePage" (ngModelChange)="save()">
                  <label class="form-check-label" for="oContents">Contents (ID, incipit, genre, page)</label>
                </div>
              }
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oMeta" [(ngModel)]="o.metadata" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oMeta">Metadata</label>
                <div class="form-text mt-0">{{ multi ? 'A line under each document\\'s heading.' : (o.titlePage ? 'A table on the title page.' : 'A line under the title.') }}</div>
              </div>
              <div class="form-check form-switch mb-1 mt-2">
                <input class="form-check-input" type="checkbox" id="oApp" [(ngModel)]="o.apparatus" [disabled]="busy" (ngModelChange)="save()">
                <label class="form-check-label fw-medium" for="oApp">Critical apparatus</label>
                <div class="form-text mt-0">{{ multi ? 'Collected after the editions, divided by document.' : 'The comments, after the edition.' }}</div>
              </div>
              @if (multi) {
                <div class="form-check form-switch mb-1 mt-2">
                  <input class="form-check-input" type="checkbox" id="oNew" [(ngModel)]="o.newPage" [disabled]="busy" (ngModelChange)="save()">
                  <label class="form-check-label fw-medium" for="oNew">Every document on a new page</label>
                  <div class="form-text mt-0">Off: documents run on, each begins with a heading line (compact, like the printed edition).</div>
                </div>
              }
              <label class="form-label small text-muted mb-1 mt-3" for="pdfFile">File name</label>
              <div class="input-group input-group-sm">
                <input id="pdfFile" class="form-control" [(ngModel)]="fileBase" [disabled]="busy" placeholder="Document">
                <span class="input-group-text">.pdf</span>
              </div>
            </div>
          </div>

          @if (busy || error) {
            <div class="px-3 pb-3">
              @if (busy) {
                <div class="progress" style="height: 6px;"><div class="progress-bar" [style.width.%]="progress"></div></div>
                <div class="small text-muted mt-1">{{status}}</div>
              }
              @if (error) { <div class="alert alert-danger small mb-0 mt-2">{{error}}</div> }
            </div>
          }
        </div>

        <div class="modal-footer border-0 bg-light">
          <button type="button" class="btn btn-outline-secondary px-3" (click)="close()" [disabled]="busy">Cancel</button>
          <button type="button" class="btn btn-danger px-4" (click)="run()" [disabled]="busy || !entries.length || loadingMeta">
            @if (busy) { <span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> }
            @else { <i class="bi bi-printer me-1"></i> }
            Create PDF
          </button>
        </div>
      </div>
    </div>
  </div>`,
})
export class PdfExportDialogComponent implements OnInit {
  /** Exactly one of these is used: ready jobs (document view), documents, or ids to load. */
  @Input() jobs: PdfDocJob[] = [];
  @Input() docs: Document[] = [];
  @Input() ids: string[] = [];
  @Input() title = '';
  @Input() fileName = '';
  @Output() closed = new EventEmitter<void>();

  entries: Entry[] = [];
  o: DialogOptions = { titlePage: true, contents: true, metadata: true, apparatus: true, newPage: false, pageFormat: 'settings', boxLabel: 'enumeration' };
  fileBase = '';
  busy = false;
  loadingMeta = false;
  progress = 0;
  status = '';
  error = '';

  constructor(private api: APIService, private users: UserService, private pdf: PdfExportService) {}

  get multi(): boolean { return this.entries.length > 1; }

  genre(d: Document): string { return genreOf(d); }

  async ngOnInit(): Promise<void> {
    if (this.jobs.length) this.entries = this.jobs.map((j) => ({ id: j.document.id, doc: j.document, job: j }));
    else if (this.docs.length) this.entries = this.docs.map((d) => ({ id: d.id, doc: d, job: null }));
    else this.entries = this.ids.map((id) => ({ id, doc: null, job: null }));
    this.loadOptions();
    this.fileBase = this.fileName || (this.entries.length === 1 && this.entries[0].doc ? `Document_${this.entries[0].doc.dokumenten_id || 'Export'}` : 'Documents');

    // metadata of entries given as ids
    const missing = this.entries.filter((e) => !e.doc);
    if (missing.length) {
      this.loadingMeta = true;
      try {
        const token = (await firstValueFrom(this.users.user))?.token || '';
        for (const e of missing) {
          const r: any = await firstValueFrom(this.api.getDocument(token, e.id));
          e.doc = r.kind === 'DocumentRetrieved' ? r.document : null;
        }
        this.entries = this.entries.filter((e) => e.doc);
      } finally {
        this.loadingMeta = false;
      }
      if (!this.fileName) this.fileBase = this.entries.length === 1 && this.entries[0].doc ? `Document_${this.entries[0].doc.dokumenten_id || 'Export'}` : 'Documents';
    }
  }

  // ── list handling ──
  move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.entries.length) return;
    const copy = [...this.entries];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    this.entries = copy;
  }
  remove(i: number): void { this.entries = this.entries.filter((_, k) => k !== i); }
  sortBy(kind: 'id' | 'incipit' | 'genre'): void {
    const key = (e: Entry) => kind === 'id' ? (e.doc?.dokumenten_id || '') : kind === 'incipit' ? (e.doc?.textinitium || '') : genreOf(e.doc);
    this.entries = [...this.entries].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' }));
  }

  // ── remembered choices (kept apart for one and for several documents) ──
  private loadOptions(): void {
    const multi = this.entries.length > 1;
    this.o = multi
      ? { titlePage: true, contents: true, metadata: true, apparatus: true, newPage: false, pageFormat: 'settings', boxLabel: 'enumeration' }
      : { titlePage: false, contents: false, metadata: true, apparatus: true, newPage: false, pageFormat: 'settings', boxLabel: 'enumeration' };
    try {
      const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY(multi)) || 'null');
      if (stored) this.o = { ...this.o, ...stored };
    } catch { /* no stored choice */ }
  }
  save(): void {
    try { localStorage.setItem(OPTIONS_KEY(this.multi), JSON.stringify(this.o)); } catch { /* storage unavailable */ }
  }

  close(): void { this.closed.emit(); }

  async run(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.save();
    try {
      const token = (await firstValueFrom(this.users.user))?.token || '';
      const settingsRes: any = await firstValueFrom(this.api.getSettings(token));
      const settings: ProjectSettings | null = settingsRes.kind === 'SettingsRetrieved' ? settingsRes.settings : null;

      const sources = new Map<string, { source: Source | null; sigle: string }>();
      const jobs: PdfDocJob[] = [];
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        if (e.job) { jobs.push(e.job); continue; }
        const d = e.doc!;
        this.status = `Loading ${d.dokumenten_id || d.textinitium || ''} (${i + 1}/${this.entries.length})`;
        this.progress = (i / this.entries.length) * 40;
        if (!sources.has(d.quelle_id)) {
          const sr: any = await firstValueFrom(this.api.getSource(token, d.quelle_id));
          const gr: any = await firstValueFrom(this.api.getSigle(token, d.quelle_id));
          sources.set(d.quelle_id, { source: sr.kind === 'SourceRetrieved' ? sr.source : null, sigle: gr.kind === 'SigleRetrieved' ? gr.sigle : '' });
        }
        const notes: any = await firstValueFrom(this.api.getDocumentNotes(token, d.id));
        const cont = notes.kind === 'NotesRetrieved' ? VM.normalizeDocumentComments(notes.data) : VM.emptyRootContainer();
        const s = sources.get(d.quelle_id)!;
        const job: PdfDocJob = { document: d, cont, source: s.source, sigle: s.sigle };
        e.job = job;
        jobs.push(job);
      }

      await this.pdf.exportDocuments(jobs, {
        settings,
        titlePage: this.o.titlePage,
        contents: this.o.contents && this.o.titlePage,
        includeMetadata: this.o.metadata,
        apparatus: this.o.apparatus,
        newPagePerDocument: this.o.newPage,
        boxLabel: this.o.boxLabel,
        pageFormat: this.o.pageFormat === 'settings' ? undefined : this.o.pageFormat,
        title: this.title.trim() || `${jobs.length} documents`,
        fileName: (this.fileBase.trim() || 'Documents').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf',
        onProgress: (msg, done, total) => { this.status = msg; this.progress = 40 + (done / Math.max(1, total)) * 60; },
      });
      this.close();
    } catch (e: any) {
      console.error('PDF export failed', e);
      this.error = 'The PDF could not be created: ' + (e?.message || e);
    } finally {
      this.busy = false;
    }
  }
}

export interface PdfDialogRequest {
  /** Ready jobs (the open document, with its unsaved state). */
  jobs?: PdfDocJob[];
  /** Documents whose transcription is loaded when printing. */
  docs?: Document[];
  /** Only ids: their metadata is loaded when the dialog opens. */
  ids?: string[];
  title?: string;
  fileName?: string;
}

/** Opens the print dialog from anywhere (document view, search, manuscript, synopsis, …). */
@Injectable({ providedIn: 'root' })
export class PdfDialogLauncher {
  constructor(private appRef: ApplicationRef, private env: EnvironmentInjector, private api: APIService, private users: UserService) {}

  open(request: PdfDialogRequest): void {
    const ref = createComponent(PdfExportDialogComponent, { environmentInjector: this.env });
    ref.setInput('jobs', request.jobs ?? []);
    ref.setInput('docs', request.docs ?? []);
    ref.setInput('ids', request.ids ?? []);
    ref.setInput('title', request.title ?? '');
    ref.setInput('fileName', request.fileName ?? '');
    this.appRef.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    ref.instance.closed.subscribe(() => {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
    });
    ref.changeDetectorRef.detectChanges();
  }

  /** All documents of one manuscript. */
  async openForSource(sourceId: string, title = ''): Promise<void> {
    const token = (await firstValueFrom(this.users.user))?.token || '';
    const res: any = await firstValueFrom(this.api.queryDocuments(token, {
      dokumenten_id: undefined, gattung1: undefined, gattung2: undefined, festtag: undefined, feier: undefined, textinitium: undefined,
      bibliographischerverweis: undefined, druckausgabe: undefined, zeilenstart: undefined, foliostart: undefined, kommentar: undefined,
    }));
    const docs: Document[] = (res.documents || []).filter((d: Document) => d.quelle_id === sourceId)
      .sort((a: Document, b: Document) => (a.dokumenten_id || '').localeCompare(b.dokumenten_id || '', undefined, { numeric: true, sensitivity: 'base' }));
    this.open({ docs, title });
  }
}
