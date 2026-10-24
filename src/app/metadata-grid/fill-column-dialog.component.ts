import { Component, EventEmitter, Input, Output } from '@angular/core';
import { EMPTY_FILL, FillPlan, FillSpec, planFill } from './grid-fill';
import { GridView } from './grid-view';

/**
 * Fills one column from another, with a change of the text if wanted (Spiel 12 → play-12). The dialog only plans: the
 * result goes into the table as edits, which can be undone and are saved with the other edits.
 */
@Component({
  selector: 'app-fill-column-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.55); z-index: 2000;" data-testid="fill-dialog" (click)="close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" (click)="$event.stopPropagation()">
      <div class="modal-content shadow-lg border-0">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-arrow-right-square me-2"></i>Fill a column from another</h5>
        </div>
        <div class="modal-body small">
          <p class="text-muted">
            Copies the values of one column into another, row by row — for example a play name into <em>Unit ID</em> — and can change the text on the way.
            Nothing is saved yet: the new values appear in the table as edits that you can check, undo and save.
          </p>
          <div class="row g-2 align-items-end mb-2">
            <div class="col-md-5">
              <label class="form-label mb-1" for="fill-from">Copy from</label>
              <select id="fill-from" class="form-select form-select-sm" [(ngModel)]="spec.from" (ngModelChange)="plan()" data-testid="fill-from">
                <option value="">Choose a column …</option>
                @for (c of view.columns; track c.key) { <option [value]="c.key">{{ c.label }}</option> }
              </select>
            </div>
            <div class="col-md-1 text-center pb-1"><i class="bi bi-arrow-right"></i></div>
            <div class="col-md-5">
              <label class="form-label mb-1" for="fill-to">Fill</label>
              <select id="fill-to" class="form-select form-select-sm" [(ngModel)]="spec.to" (ngModelChange)="plan()" data-testid="fill-to">
                <option value="">Choose a column …</option>
                @for (c of targets; track c.key) { <option [value]="c.key">{{ c.label }}</option> }
              </select>
            </div>
          </div>

          <div class="row g-2 mb-2">
            <div class="col-md-5">
              <label class="form-label mb-1" for="fill-find">Find in the text (optional)</label>
              <input id="fill-find" type="text" class="form-control form-control-sm" [(ngModel)]="spec.find" (ngModelChange)="plan()" placeholder="e.g. Spiel " data-testid="fill-find">
            </div>
            <div class="col-md-5">
              <label class="form-label mb-1" for="fill-replace">Replace with</label>
              <input id="fill-replace" type="text" class="form-control form-control-sm" [(ngModel)]="spec.replaceWith" (ngModelChange)="plan()" placeholder="e.g. play-" data-testid="fill-replace">
            </div>
            <div class="col-md-2 d-flex align-items-end">
              <div class="form-check mb-1" title="The text to find is a pattern; $1 in the replacement is its first group">
                <input id="fill-regex" class="form-check-input" type="checkbox" [(ngModel)]="spec.regex" (ngModelChange)="plan()" data-testid="fill-regex">
                <label class="form-check-label" for="fill-regex">Pattern</label>
              </div>
            </div>
          </div>
          <div class="row g-2 mb-2">
            <div class="col-md-5">
              <label class="form-label mb-1" for="fill-prefix">Put in front</label>
              <input id="fill-prefix" type="text" class="form-control form-control-sm" [(ngModel)]="spec.prefix" (ngModelChange)="plan()" data-testid="fill-prefix">
            </div>
            <div class="col-md-5">
              <label class="form-label mb-1" for="fill-suffix">Put behind</label>
              <input id="fill-suffix" type="text" class="form-control form-control-sm" [(ngModel)]="spec.suffix" (ngModelChange)="plan()" data-testid="fill-suffix">
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 mb-3">
            <div class="form-check">
              <input id="fill-empty" class="form-check-input" type="checkbox" [(ngModel)]="spec.onlyEmpty" (ngModelChange)="plan()" data-testid="fill-only-empty">
              <label class="form-check-label" for="fill-empty">Only cells that are empty</label>
            </div>
            <div class="form-check">
              <input id="fill-shown" class="form-check-input" type="radio" name="fill-scope" value="shown" [(ngModel)]="spec.scope" (ngModelChange)="plan()">
              <label class="form-check-label" for="fill-shown">The rows shown now ({{ view.viewIdx.length }})</label>
            </div>
            <div class="form-check">
              <input id="fill-all" class="form-check-input" type="radio" name="fill-scope" value="all" [(ngModel)]="spec.scope" (ngModelChange)="plan()">
              <label class="form-check-label" for="fill-all">All rows ({{ view.rowCount }})</label>
            </div>
          </div>

          <div class="border rounded p-2 bg-light" data-testid="fill-preview">
            @if (result.problem) {
              <span class="text-muted">{{ result.problem }}</span>
            } @else {
              <div>
                <strong data-testid="fill-count">{{ result.changed }}</strong> {{ result.changed === 1 ? 'cell gets' : 'cells get' }} a new value
                <span class="text-muted">
                  @if (result.kept) { · {{ result.kept }} already filled, left alone }
                  @if (result.emptySource) { · {{ result.emptySource }} without a value to copy }
                  @if (result.same) { · {{ result.same }} already the same }
                </span>
              </div>
              @for (s of result.samples; track $index) {
                <div class="text-truncate"><span class="text-muted">{{ s.from }}</span> <i class="bi bi-arrow-right mx-1"></i> <strong>{{ s.to }}</strong>@if (s.was) { <span class="text-muted ms-2">(was “{{ s.was }}”)</span> }</div>
              }
              @if (result.changed > result.samples.length) { <div class="text-muted">… and {{ result.changed - result.samples.length }} more</div> }
            }
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" (click)="close()">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="!result.changed" (click)="apply()" data-testid="fill-apply">Fill {{ result.changed }} {{ result.changed === 1 ? 'cell' : 'cells' }}</button>
        </div>
      </div>
    </div>
  </div>`,
})
export class FillColumnDialogComponent {
  @Input({ required: true }) view!: GridView;
  /** What to start with (the column to fill, say). */
  @Input() set preset(p: Partial<FillSpec> | undefined) { this.spec = { ...EMPTY_FILL, ...(p ?? {}) }; this.plan(); }
  @Output() applied = new EventEmitter<FillPlan>();
  @Output() closed = new EventEmitter<void>();

  spec: FillSpec = { ...EMPTY_FILL };
  result: FillPlan = planFill(new GridView([], []), EMPTY_FILL);

  /** The columns that can be written. */
  get targets() { return this.view.columns.filter((c) => c.editable !== false); }

  plan(): void { this.result = this.view ? planFill(this.view, this.spec) : this.result; }
  apply(): void { if (this.result.changed) this.applied.emit(this.result); }
  close(): void { this.closed.emit(); }
}
