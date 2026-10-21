import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { EMPTY_REPLACE, ReplacePlan, ReplaceSpec, planReplace } from './grid-replace';
import { GridView } from './grid-view';

/**
 * Finds text across one or more columns (or just the cells selected in the grid) and replaces it in place — a plain
 * word, or a pattern with groups. The dialog only plans: the result goes into the table as edits, which can be
 * undone and are saved with the other edits.
 */
@Component({
  selector: 'app-replace-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.55); z-index: 2000;" data-testid="replace-dialog" (click)="close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" (click)="$event.stopPropagation()">
      <div class="modal-content shadow-lg border-0">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-search me-2"></i>Find and replace</h5>
        </div>
        <div class="modal-body small">
          <p class="text-muted">
            Replaces text inside cells, wherever it stands — the rest of a cell's text stays. Nothing is saved yet: the
            new values appear in the table as edits that you can check, undo and save.
          </p>

          <div class="row g-2 mb-2">
            <div class="col-md-6">
              <label class="form-label mb-1" for="rep-find">Find</label>
              <input id="rep-find" type="text" class="form-control form-control-sm" [(ngModel)]="spec.find" (ngModelChange)="plan()" placeholder="text to find" data-testid="replace-find">
            </div>
            <div class="col-md-6">
              <label class="form-label mb-1" for="rep-with">Replace with</label>
              <input id="rep-with" type="text" class="form-control form-control-sm" [(ngModel)]="spec.replaceWith" (ngModelChange)="plan()" data-testid="replace-with">
            </div>
          </div>
          <div class="d-flex flex-wrap gap-3 mb-3">
            <div class="form-check">
              <input id="rep-case" class="form-check-input" type="checkbox" [(ngModel)]="spec.caseSensitive" (ngModelChange)="plan()" data-testid="replace-case">
              <label class="form-check-label" for="rep-case">Match case</label>
            </div>
            <div class="form-check" title="&quot;Ton&quot; does not match inside &quot;Tonart&quot;">
              <input id="rep-word" class="form-check-input" type="checkbox" [(ngModel)]="spec.wholeWord" (ngModelChange)="plan()" data-testid="replace-word">
              <label class="form-check-label" for="rep-word">Whole word</label>
            </div>
            <div class="form-check" title="The text to find is a pattern (regular expression); groups can be used in the replacement as $1, $2 …">
              <input id="rep-regex" class="form-check-input" type="checkbox" [(ngModel)]="spec.regex" (ngModelChange)="plan()" data-testid="replace-regex">
              <label class="form-check-label" for="rep-regex">Pattern</label>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-3 mb-2">
            <div class="form-check">
              <input id="rep-area-sel" class="form-check-input" type="radio" name="rep-area" [value]="true" [(ngModel)]="spec.selectionOnly" (ngModelChange)="plan()" [disabled]="view.rangeCellCount === 0" data-testid="replace-area-selection">
              <label class="form-check-label" for="rep-area-sel">
                @if (view.rangeCellCount > 0) { The {{ view.rangeCellCount }} selected cell{{ view.rangeCellCount === 1 ? '' : 's' }} }
                @else { The selected cells (select some first) }
              </label>
            </div>
            <div class="form-check">
              <input id="rep-area-cols" class="form-check-input" type="radio" name="rep-area" [value]="false" [(ngModel)]="spec.selectionOnly" (ngModelChange)="plan()" data-testid="replace-area-columns">
              <label class="form-check-label" for="rep-area-cols">These columns</label>
            </div>
          </div>

          @if (!spec.selectionOnly) {
            <div class="border rounded p-2 mb-2" data-testid="replace-columns">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="small text-muted">Search in</span>
                <div class="btn-group btn-group-sm">
                  <button type="button" class="btn btn-outline-secondary" (click)="selectColumns(true)" data-testid="replace-cols-all">All</button>
                  <button type="button" class="btn btn-outline-secondary" (click)="selectColumns(false)" data-testid="replace-cols-none">None</button>
                </div>
              </div>
              <div class="d-flex flex-wrap gap-2" style="max-height: 8rem; overflow: auto;">
                @for (c of editableColumns; track c.key) {
                  <div class="form-check form-check-inline m-0">
                    <input class="form-check-input" type="checkbox" [id]="'rep-col-' + c.key" [checked]="isChecked(c.key)"
                      (change)="toggleColumn(c.key, $any($event.target).checked)" [attr.data-testid]="'replace-column-' + c.key">
                    <label class="form-check-label small" [for]="'rep-col-' + c.key">{{ c.label }}</label>
                  </div>
                }
              </div>
            </div>
            <div class="d-flex gap-3 mb-2">
              <div class="form-check">
                <input id="rep-rows-shown" class="form-check-input" type="radio" name="rep-rows" value="shown" [(ngModel)]="spec.rows" (ngModelChange)="plan()" data-testid="replace-rows-shown">
                <label class="form-check-label small" for="rep-rows-shown">Rows shown now ({{ view.viewIdx.length }})</label>
              </div>
              <div class="form-check">
                <input id="rep-rows-all" class="form-check-input" type="radio" name="rep-rows" value="all" [(ngModel)]="spec.rows" (ngModelChange)="plan()" data-testid="replace-rows-all">
                <label class="form-check-label small" for="rep-rows-all">All rows ({{ view.rowCount }})</label>
              </div>
            </div>
          }

          <div class="border rounded p-2 bg-light" data-testid="replace-preview">
            @if (result.problem) {
              <span class="text-muted">{{ result.problem }}</span>
            } @else {
              <div>
                <strong data-testid="replace-count">{{ result.changed }}</strong> {{ result.changed === 1 ? 'cell gets' : 'cells get' }} a new value
                <span class="text-muted">
                  · {{ result.occurrences }} {{ result.occurrences === 1 ? 'match' : 'matches' }} in {{ result.cells }} {{ result.cells === 1 ? 'cell' : 'cells' }} looked at
                  @if (result.same) { · {{ result.same }} already the same }
                </span>
              </div>
              @for (s of result.samples; track $index) {
                <div class="text-truncate"><span class="text-muted">{{ s.column }}:</span> {{ s.before }} <i class="bi bi-arrow-right mx-1"></i> <strong>{{ s.after }}</strong></div>
              }
              @if (result.changed > result.samples.length) { <div class="text-muted">… and {{ result.changed - result.samples.length }} more</div> }
            }
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" (click)="close()">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="!result.changed" (click)="apply()" data-testid="replace-apply">Replace {{ result.changed }} {{ result.changed === 1 ? 'cell' : 'cells' }}</button>
        </div>
      </div>
    </div>
  </div>`,
})
export class ReplaceDialogComponent implements OnInit {
  @Input({ required: true }) view!: GridView;
  @Output() applied = new EventEmitter<ReplacePlan>();
  @Output() closed = new EventEmitter<void>();

  spec: ReplaceSpec = { ...EMPTY_REPLACE };
  result: ReplacePlan = planReplace(new GridView([], []), EMPTY_REPLACE);

  /** The columns that can be written. */
  get editableColumns() { return this.view.columns.filter((c) => c.editable !== false); }

  ngOnInit(): void {
    // a deliberate selection (more than one cell) is what the dialog starts from; otherwise every column, the rows shown now
    this.spec = { ...EMPTY_REPLACE, selectionOnly: this.view.rangeCellCount > 1, columns: this.editableColumns.map((c) => c.key) };
    this.plan();
  }

  plan(): void { this.result = this.view ? planReplace(this.view, this.spec) : this.result; }
  isChecked(key: string): boolean { return this.spec.columns.includes(key); }
  toggleColumn(key: string, on: boolean): void {
    this.spec.columns = on ? [...new Set([...this.spec.columns, key])] : this.spec.columns.filter((k) => k !== key);
    this.plan();
  }
  selectColumns(on: boolean): void { this.spec.columns = on ? this.editableColumns.map((c) => c.key) : []; this.plan(); }
  apply(): void { if (this.result.changed) this.applied.emit(this.result); }
  close(): void { this.closed.emit(); }
}
