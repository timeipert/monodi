import { ApplicationRef, Component, EnvironmentInjector, EventEmitter, Injectable, Input, Output, createComponent } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import * as VM from './types/model';
import { APIService, Document, ProjectSettings, Source } from './api.service';
import { UserService } from './user.service';
import { PdfDocJob, PdfExportService } from './pdf-export.service';
import { PdfHostLauncher } from './pdf-render-host.component';
import { genreOf } from './document-metadata';

/**
 * Print several documents as one PDF: a title page with a contents table (ID, incipit, genre),
 * every document on its own page(s), and one collected apparatus divided by document.
 * Opened from the search (selected documents) and from a manuscript (all its documents).
 */
@Component({
  selector: 'app-pdf-export-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.5); z-index: 2000;">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content shadow">
        <div class="modal-header bg-light border-bottom">
          <h5 class="modal-title fw-bold"><i class="bi bi-file-pdf me-2 text-danger"></i>Print {{docs.length}} document{{docs.length === 1 ? '' : 's'}} as PDF</h5>
        </div>
        <div class="modal-body p-4">
          <label class="form-label small fw-medium text-muted mb-1" for="pdfCollectionTitle">Title</label>
          <input id="pdfCollectionTitle" class="form-control form-control-sm mb-3" [(ngModel)]="title" [disabled]="busy" placeholder="Title of the print">
          <div class="small text-muted mb-3">
            <div class="fw-medium mb-1">Contents (in this order)</div>
            <ol class="mb-0 ps-3" style="max-height: 150px; overflow: auto;">
              @for (d of docs; track d.id) {
                <li><span class="text-body">{{d.dokumenten_id}}</span> <span class="fst-italic">{{d.textinitium}}</span>@if (genre(d)) { <span class="text-secondary"> · {{genre(d)}}</span> }</li>
              }
            </ol>
          </div>
          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" id="mdMeta" [(ngModel)]="includeMetadata" [disabled]="busy">
            <label class="form-check-label fw-medium" for="mdMeta">Metadata line under each document's title</label>
          </div>
          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" id="mdApp" [(ngModel)]="apparatus" [disabled]="busy">
            <label class="form-check-label fw-medium" for="mdApp">Collected critical apparatus</label>
            <div class="form-text mt-1">The comments of all documents, divided by document (ID, incipit, genre).</div>
          </div>
          @if (busy) {
            <div class="mt-3">
              <div class="progress" style="height: 6px;"><div class="progress-bar" [style.width.%]="progress"></div></div>
              <div class="small text-muted mt-1">{{status}}</div>
            </div>
          }
          @if (error) { <div class="alert alert-danger small mt-3 mb-0">{{error}}</div> }
        </div>
        <div class="modal-footer border-0 bg-light">
          <button type="button" class="btn btn-outline-secondary px-3" (click)="close()" [disabled]="busy">Cancel</button>
          <button type="button" class="btn btn-danger px-4" (click)="run()" [disabled]="busy || !docs.length">
            <i class="bi bi-printer me-1"></i> Create PDF
          </button>
        </div>
      </div>
    </div>
  </div>`,
})
export class PdfExportDialogComponent {
  @Input() docs: Document[] = [];
  @Input() title = '';
  @Output() closed = new EventEmitter<void>();

  includeMetadata = true;
  apparatus = true;
  busy = false;
  progress = 0;
  status = '';
  error = '';

  constructor(private api: APIService, private users: UserService, private pdf: PdfExportService, private host: PdfHostLauncher) {}

  genre(d: Document): string { return genreOf(d); }

  close(): void { this.closed.emit(); }

  async run(): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const user = await firstValueFrom(this.users.user);
      const token = user?.token || '';
      const settingsRes: any = await firstValueFrom(this.api.getSettings(token));
      const settings: ProjectSettings | null = settingsRes.kind === 'SettingsRetrieved' ? settingsRes.settings : null;

      const sources = new Map<string, { source: Source | null; sigle: string }>();
      const jobs: PdfDocJob[] = [];
      for (let i = 0; i < this.docs.length; i++) {
        const d = this.docs[i];
        this.status = `Loading ${d.dokumenten_id || d.textinitium || ''} (${i + 1}/${this.docs.length})`;
        this.progress = (i / this.docs.length) * 40;
        if (!sources.has(d.quelle_id)) {
          const sr: any = await firstValueFrom(this.api.getSource(token, d.quelle_id));
          const gr: any = await firstValueFrom(this.api.getSigle(token, d.quelle_id));
          sources.set(d.quelle_id, { source: sr.kind === 'SourceRetrieved' ? sr.source : null, sigle: gr.kind === 'SigleRetrieved' ? gr.sigle : '' });
        }
        const notes: any = await firstValueFrom(this.api.getDocumentNotes(token, d.id));
        const cont = notes.kind === 'NotesRetrieved' ? VM.normalizeDocumentComments(notes.data) : VM.emptyRootContainer();
        const s = sources.get(d.quelle_id)!;
        jobs.push({ document: d, cont, source: s.source, sigle: s.sigle });
      }

      this.host.ensure();
      await this.pdf.exportDocuments(jobs, {
        settings,
        titlePage: true,
        includeMetadata: this.includeMetadata,
        apparatus: this.apparatus,
        title: this.title.trim() || `${jobs.length} documents`,
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

/** Opens the multi-document print dialog from anywhere (search, manuscript view, …). */
@Injectable({ providedIn: 'root' })
export class PdfDialogLauncher {
  constructor(private appRef: ApplicationRef, private env: EnvironmentInjector) {}

  open(docs: Document[], title = ''): void {
    const ref = createComponent(PdfExportDialogComponent, { environmentInjector: this.env });
    ref.setInput('docs', docs);
    ref.setInput('title', title);
    this.appRef.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    ref.instance.closed.subscribe(() => {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
    });
    ref.changeDetectorRef.detectChanges();
  }
}
