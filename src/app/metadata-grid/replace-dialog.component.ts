import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { EMPTY_REPLACE, EMPTY_RULE, ReplacePlan, ReplaceSpec, planReplace } from './grid-replace';
import { GridView } from './grid-view';

/**
 * Finds text across one or more columns (or just the cells selected in the grid) and replaces it in place — a plain
 * word, or a pattern with groups. Several rules can run in one go, each on the result of the one before it. The
 * dialog only plans: the result goes into the table as edits, which can be undone and are saved with the other edits.
 */
@Component({
  selector: 'app-replace-dialog',
  standalone: false,
  template: `
  <div class="modal fade show d-block" tabindex="-1" style="background: rgba(0,0,0,0.55); z-index: 2000;" data-testid="replace-dialog" (click)="close()">
    <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" (click)="$event.stopPropagation()">
      <div class="modal-content shadow-lg border-0">
        <div class="modal-header">
          <h5 class="modal-title d-flex align-items-center">
            <i class="bi bi-search me-2"></i>Find and replace
            @if (result.changed > 0) { <span class="badge text-bg-primary ms-2" data-testid="replace-badge">{{ result.changed }} pending</span> }
          </h5>
        </div>
        <div class="modal-body small">
          <p class="text-muted mb-3">
            Replaces text inside cells, wherever it stands — the rest of a cell's text stays. Nothing is saved yet: the
            new values appear in the table as edits that you can check, undo and save.
          </p>

          <div class="card shadow-sm border-light mb-3">
            <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
              <h6 class="mb-0 fw-semibold text-primary"><i class="bi bi-arrow-left-right me-2"></i>Rules</h6>
              <span class="text-muted" style="font-size: .8em;">Each row runs on the result of the one before it</span>
            </div>
            <div class="card-body bg-white py-3">
              @for (r of spec.rules; track $index) {
                <div class="d-flex align-items-center gap-2 mb-2" [attr.data-testid]="'replace-rule-' + $index">
                  <span class="badge rounded-pill text-bg-light" style="width: 1.6rem;">{{ $index + 1 }}</span>
                  <input type="text" class="form-control form-control-sm" [(ngModel)]="r.find" (ngModelChange)="plan()"
                    placeholder="Find" [attr.aria-label]="'Find, row ' + ($index + 1)" [attr.data-testid]="'replace-find-' + $index">
                  <i class="bi bi-arrow-right text-muted"></i>
                  <input type="text" class="form-control form-control-sm" [(ngModel)]="r.replaceWith" (ngModelChange)="plan()"
                    placeholder="Replace with" [attr.aria-label]="'Replace with, row ' + ($index + 1)" [attr.data-testid]="'replace-with-' + $index">
                  <div class="btn-group btn-group-sm" role="group" aria-label="How to match">
                    <input type="checkbox" class="btn-check" [id]="'rep-case-' + $index" [(ngModel)]="r.caseSensitive" (ngModelChange)="plan()">
                    <label class="btn btn-outline-secondary px-2" [for]="'rep-case-' + $index" title="Match case" [attr.data-testid]="'replace-case-' + $index">Aa</label>
                    <input type="checkbox" class="btn-check" [id]="'rep-word-' + $index" [(ngModel)]="r.wholeWord" (ngModelChange)="plan()">
                    <label class="btn btn-outline-secondary px-2 text-decoration-underline" [for]="'rep-word-' + $index" title="Whole word" [attr.data-testid]="'replace-word-' + $index">ab</label>
                    <input type="checkbox" class="btn-check" [id]="'rep-regex-' + $index" [(ngModel)]="r.regex" (ngModelChange)="plan()">
                    <label class="btn btn-outline-secondary px-2 font-monospace" [for]="'rep-regex-' + $index" title="The text to find is a pattern (regular expression); groups can be used in the replacement as $1, $2 …" [attr.data-testid]="'replace-regex-' + $index">.*</label>
                  </div>
                  <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="spec.rules.length < 2" (click)="removeRule($index)" title="Remove this row" [attr.data-testid]="'replace-remove-' + $index">
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>
              }
              <button type="button" class="btn btn-sm btn-outline-primary mt-1" (click)="addRule()" data-testid="replace-add-rule">
                <i class="bi bi-plus-lg me-1"></i>Add another rule
              </button>
            </div>
          </div>

          <div class="card shadow-sm border-light mb-3">
            <div class="card-header bg-light py-2">
              <h6 class="mb-0 fw-semibold text-primary"><i class="bi bi-crop me-2"></i>Where</h6>
            </div>
            <div class="card-body bg-white py-3">
              <div class="btn-group btn-group-sm mb-2" role="group" aria-label="Area">
                <input type="radio" class="btn-check" id="rep-area-cols" name="rep-area" [value]="false" [(ngModel)]="spec.selectionOnly" (ngModelChange)="plan()">
                <label class="btn btn-outline-secondary" for="rep-area-cols" data-testid="replace-area-columns">These columns</label>
                <input type="radio" class="btn-check" id="rep-area-sel" name="rep-area" [value]="true" [(ngModel)]="spec.selectionOnly" (ngModelChange)="plan()" [disabled]="view.rangeCellCount === 0">
                <label class="btn btn-outline-secondary" for="rep-area-sel" data-testid="replace-area-selection">
                  @if (view.rangeCellCount > 0) { The {{ view.rangeCellCount }} selected cell{{ view.rangeCellCount === 1 ? '' : 's' }} }
                  @else { The selected cells (select some first) }
                </label>
              </div>

              @if (!spec.selectionOnly) {
                <div class="border rounded p-2 mb-2" data-testid="replace-columns">
                  <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <input type="text" class="form-control form-control-sm" style="max-width: 14rem;" placeholder="Filter columns…"
                      [(ngModel)]="columnFilter" data-testid="replace-col-filter">
                    <div class="btn-group btn-group-sm ms-auto">
                      <button type="button" class="btn btn-outline-secondary" (click)="selectColumns(true)" data-testid="replace-cols-all">All</button>
                      <button type="button" class="btn btn-outline-secondary" (click)="selectColumns(false)" data-testid="replace-cols-none">None</button>
                    </div>
                  </div>
                  <div class="d-flex flex-wrap gap-2" style="max-height: 8rem; overflow: auto;">
                    @for (c of filteredColumns; track c.key) {
                      <div class="form-check form-check-inline m-0">
                        <input class="form-check-input" type="checkbox" [id]="'rep-col-' + c.key" [checked]="isChecked(c.key)"
                          (change)="toggleColumn(c.key, $any($event.target).checked)" [attr.data-testid]="'replace-column-' + c.key">
                        <label class="form-check-label small" [for]="'rep-col-' + c.key">{{ c.label }}</label>
                      </div>
                    }
                    @if (!filteredColumns.length) { <span class="text-muted">No column matches “{{ columnFilter }}”.</span> }
                  </div>
                </div>
                <div class="btn-group btn-group-sm" role="group" aria-label="Rows">
                  <input type="radio" class="btn-check" id="rep-rows-shown" name="rep-rows" value="shown" [(ngModel)]="spec.rows" (ngModelChange)="plan()">
                  <label class="btn btn-outline-secondary" for="rep-rows-shown" data-testid="replace-rows-shown">Rows shown now ({{ view.viewIdx.length }})</label>
                  <input type="radio" class="btn-check" id="rep-rows-all" name="rep-rows" value="all" [(ngModel)]="spec.rows" (ngModelChange)="plan()">
                  <label class="btn btn-outline-secondary" for="rep-rows-all" data-testid="replace-rows-all">All rows ({{ view.rowCount }})</label>
                </div>
              }
            </div>
          </div>

          <div class="border rounded-3 p-2" [class.bg-light]="!result.changed" [class.border-primary]="result.changed > 0" data-testid="replace-preview">
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

  spec: ReplaceSpec = { ...EMPTY_REPLACE, rules: [{ ...EMPTY_RULE }] };
  result: ReplacePlan = planReplace(new GridView([], []), EMPTY_REPLACE);
  columnFilter = '';

  /** The columns that can be written. */
  get editableColumns() { return this.view.columns.filter((c) => c.editable !== false); }
  get filteredColumns() {
    const q = this.columnFilter.trim().toLowerCase();
    return q ? this.editableColumns.filter((c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)) : this.editableColumns;
  }

  ngOnInit(): void {
    // a deliberate selection (more than one cell) is what the dialog starts from; otherwise every column, the rows shown now
    this.spec = { ...EMPTY_REPLACE, rules: [{ ...EMPTY_RULE }], selectionOnly: this.view.rangeCellCount > 1, columns: this.editableColumns.map((c) => c.key) };
    this.plan();
  }

  plan(): void { this.result = this.view ? planReplace(this.view, this.spec) : this.result; }

  addRule(): void { this.spec.rules = [...this.spec.rules, { ...EMPTY_RULE }]; this.plan(); }
  removeRule(i: number): void {
    if (this.spec.rules.length < 2) return;
    this.spec.rules = this.spec.rules.filter((_, k) => k !== i);
    this.plan();
  }

  isChecked(key: string): boolean { return this.spec.columns.includes(key); }
  toggleColumn(key: string, on: boolean): void {
    this.spec.columns = on ? [...new Set([...this.spec.columns, key])] : this.spec.columns.filter((k) => k !== key);
    this.plan();
  }
  selectColumns(on: boolean): void { this.spec.columns = on ? this.editableColumns.map((c) => c.key) : []; this.plan(); }

  apply(): void { if (this.result.changed) this.applied.emit(this.result); }
  close(): void { this.closed.emit(); }
}
