import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { CmImportPlan, CmParse, OddCell, parseCmExport, planCmImport } from './cm-export';
import { withReleaseFields } from './printable';
import { readXlsx } from './xlsx-reader';

/**
 * Loads the export list of Corpus Monodicum (.xlsx) and marks the documents in this workspace: "don't publish",
 * "don't publish metadata" and the edition status. Shows what would change first; nothing is written before "Apply".
 * Documents are matched by their UUID, then by their document ID. Running it again with a newer export is safe.
 */
@Component({
  selector: 'app-cm-import-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.55); z-index: 2000;" data-testid="cm-import-dialog" (click)="!busy && close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" (click)="$event.stopPropagation()">
      <div class="modal-content shadow-lg border-0">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-file-earmark-excel me-2"></i>Import the Corpus Monodicum export</h5>
        </div>
        <div class="modal-body">
          <p class="small text-muted mb-2">
            Choose the export list (.xlsx). Documents marked <em>dontpublish</em> there are held back from the print; the edition status is taken over.
            The file stays on this computer. Nothing is changed before you press Apply.
          </p>
          <input type="file" class="form-control form-control-sm mb-3" accept=".xlsx" [disabled]="busy" (change)="choose($event)" data-testid="cm-file" aria-label="Export list (.xlsx)" />

          @if (reading) {
            <div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Reading {{ fileName }} …</div>
          }
          @if (error) { <div class="alert alert-danger small py-2" data-testid="cm-error">{{ error }}</div> }

          @if (plan; as p) {
            <div class="small" data-testid="cm-summary">
              <p class="mb-2"><strong>{{ p.rows }}</strong> documents in the list, <strong>{{ p.matched }}</strong> found in this workspace.</p>
              <ul class="mb-2">
                <li><strong>{{ p.flagged }}</strong> are marked "don't publish" ({{ p.newlyFlagged }} new@if (p.cleared) {, {{ p.cleared }} no longer marked}).
                  @if (p.flaggedWithVolume) { <span class="text-danger"><strong>{{ p.flaggedWithVolume }}</strong> of them have a print edition: without this they would have been printed.</span> }
                </li>
                <li>Edition status changes for <strong>{{ p.statusChanged }}</strong> documents.</li>
                @if (p.flaggedNotInWorkspace) { <li>{{ p.flaggedNotInWorkspace }} marked documents are not in this workspace (nothing to hold back).</li> }
                @if (p.notInExport) { <li class="text-muted">{{ p.notInExport }} documents of this workspace are not in the list; they stay as they are.</li> }
              </ul>
              @if (p.unmatched) {
                <div class="text-muted mb-1">{{ p.unmatched }} rows have no document here@if (p.unmatchedSample.length) { (for example {{ p.unmatchedSample.join(', ') }}) }.</div>
              }
              @if (p.ambiguous) {
                <div class="text-warning-emphasis mb-1">{{ p.ambiguous }} rows were skipped: their document ID belongs to several documents and the row has no UUID.</div>
              }
              @if (p.duplicates) {
                <div class="text-warning-emphasis mb-1">{{ p.duplicates }} rows name a document twice; the later row counts.</div>
              }
              @if (odd.length) {
                <div class="alert alert-warning py-2 mt-2 mb-0">
                  <div class="fw-semibold">{{ odd.length }} cells in a flag column hold text instead of a mark. They count as marked:</div>
                  <ul class="mb-0">
                    @for (o of odd.slice(0, 6); track o.row + o.column) { <li>row {{ o.row }}, {{ o.id }}, {{ o.column }}: "{{ o.value }}"</li> }
                    @if (odd.length > 6) { <li>… and {{ odd.length - 6 }} more</li> }
                  </ul>
                </div>
              }
            </div>
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" [disabled]="busy" (click)="close()">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="busy || !plan || (!plan.patches.length && !needsFields)" (click)="apply()" data-testid="cm-apply">
            @if (busy) { <span class="spinner-border spinner-border-sm me-1"></span> }Apply@if (plan && plan.patches.length) { to {{ plan.patches.length }} documents }
          </button>
        </div>
      </div>
    </div>
  </div>`,
})
export class CmImportDialogComponent {
  /** Emits after the workspace was changed, so the page can reload its tables. */
  @Output() applied = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  fileName = '';
  reading = false;
  busy = false;
  error = '';
  plan: CmImportPlan | null = null;
  odd: OddCell[] = [];
  /** The release columns are not among the custom fields yet. */
  needsFields = false;

  constructor(private api: APIService, private users: UserService, private toastr: ToastrService, private cdr: ChangeDetectorRef) {}

  close(): void { this.closed.emit(); }

  async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileName = file.name;
    this.plan = null; this.odd = []; this.error = '';
    this.reading = true;
    try {
      const sheets = await readXlsx(file);
      // the export has one sheet; take the first one that has the columns
      let parsed: CmParse | null = null;
      let failure: unknown = null;
      for (const sheet of sheets) {
        try { parsed = parseCmExport(sheet.rows); break; } catch (e) { failure ??= e; }
      }
      if (!parsed) throw failure ?? new Error('The file has no sheet.');
      const token = (await firstValueFrom(this.users.user))?.token || '';
      const [docs, settings] = await Promise.all([firstValueFrom(this.api.listDocuments(token)), firstValueFrom(this.api.getSettings(token))]);
      if (docs.kind !== 'DocumentsRetrieved') throw new Error('The workspace could not be read.');
      this.odd = parsed.odd;
      this.plan = planCmImport(parsed.records, docs.documents);
      this.needsFields = settings.kind === 'SettingsRetrieved' && withReleaseFields(settings.settings) !== null;
    } catch (e: any) {
      console.warn('Export list could not be read', e);
      this.error = e?.message || 'The file could not be read.';
    } finally {
      this.reading = false;
      this.cdr.markForCheck();
    }
  }

  async apply(): Promise<void> {
    if (!this.plan || this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      const token = (await firstValueFrom(this.users.user))?.token || '';
      // the two columns first: a document marked in the data but without a column would be invisible in the grid
      const settings = await firstValueFrom(this.api.getSettings(token));
      if (settings.kind === 'SettingsRetrieved') {
        const next = withReleaseFields(settings.settings);
        if (next) await firstValueFrom(this.api.updateSettings(token, next));
      }
      const res = await firstValueFrom(this.api.updateDocumentsMetadata(token, this.plan.patches));
      if (res.kind !== 'MetadataUpdated') throw new Error('Saving failed.');
      this.toastr.success(`${res.updated} documents updated, ${this.plan.flagged} held back from the print.`);
      this.applied.emit();
      this.close();
    } catch (e: any) {
      console.error('Import of the export list failed', e);
      this.error = 'The import failed: ' + (e?.message || e);
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }
}
