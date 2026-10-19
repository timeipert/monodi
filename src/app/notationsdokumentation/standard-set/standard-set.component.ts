import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { sortForTable, searchPatterns, baseCode } from '../../notation-order';
import { parseTreeCode } from '../../neume-tree';
import { defaultSetup, NotationOrder, NotationSetup, StandardEntry } from '../../notation-set';

/**
 * The standard set of the notation documentation (Settings → Notation): the patterns every manuscript's
 * documentation shows, the Reference ID each usually gets, and how the rows are ordered. A manuscript can
 * remove patterns from it and add others (on its Notation Documentation tab).
 */
@Component({
  selector: 'app-standard-set',
  standalone: false,
  template: `
    <div class="mb-4">
      <label class="form-label small fw-medium text-muted mb-1">Order of the rows</label>
      <div class="form-check">
        <input class="form-check-input" type="radio" id="orderId" name="notationOrder" [checked]="setup.order === 'id'" (change)="setOrder('id')">
        <label class="form-check-label" for="orderId">By Reference ID, then as the neume table</label>
        <div class="form-text mt-0">10, 11, 20 … then 10+/20-. Rows with the same ID, and those without an ID (last), follow the order of the neume table.</div>
      </div>
      <div class="form-check mt-1">
        <input class="form-check-input" type="radio" id="orderNeume" name="notationOrder" [checked]="setup.order === 'neume'" (change)="setOrder('neume')">
        <label class="form-check-label" for="orderNeume">Only as the neume table: by number of notes, then by how often they occur in the Corpus Monodicum</label>
        <div class="form-text mt-0">Plain shapes first (<code>*</code>, <code>*d</code>, <code>*u</code>, <code>*e</code>, <code>*dd</code>, <code>*ud</code>, <code>*uu</code>, <code>*du</code> …), then the special signs L, O, Q and S. The order of the Neumen-Editor's tables and neume tree.</div>
      </div>
    </div>

    <label class="form-label small fw-medium text-muted mb-1">Standard set ({{ rows.length }} patterns)</label>
    <div class="table-responsive">
      <table class="table table-sm align-middle border mb-2" id="standard-set-table">
        <thead class="table-light small text-muted">
          <tr><th style="width: 7rem;">Shape</th><th>Pattern</th><th style="width: 10rem;">Usual Reference ID</th><th style="width: 3rem;"></th></tr>
        </thead>
        <tbody>
          @for (r of rows; track r.pattern) {
            <tr>
              <td><app-svg-pattern [pattern]="r.pattern"></app-svg-pattern></td>
              <td><code>{{ r.pattern }}</code></td>
              <td>
                <input class="form-control form-control-sm" [ngModel]="r.refId" (ngModelChange)="setRefId(r.pattern, $event)" placeholder="e.g. 20 or 10+/20-" [attr.aria-label]="'Reference ID of ' + r.pattern">
              </td>
              <td class="text-end">
                <button type="button" class="btn btn-sm btn-outline-danger" title="Take it out of the standard set" (click)="remove(r.pattern)"><i class="bi bi-x-lg"></i></button>
              </td>
            </tr>
          }
          @if (!rows.length) {
            <tr><td colspan="4" class="text-muted small">The standard set is empty: a manuscript then shows only what it has snippets of.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="position-relative mb-2" style="max-width: 28rem;">
      <input class="form-control form-control-sm" [(ngModel)]="query" (ngModelChange)="search()" (keydown.enter)="addTyped()" placeholder="Add a pattern: type a code such as *ud, [*u]dL (Enter adds it as typed)" aria-label="Add a pattern" id="standard-set-search">
      @if (hits.length) {
        <div class="list-group position-absolute w-100 shadow-sm" style="z-index: 20; max-height: 16rem; overflow: auto;">
          @for (h of hits; track h) {
            <button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-1" (click)="add(h)">
              <span style="min-width: 6rem;"><app-svg-pattern [pattern]="h"></app-svg-pattern></span><code>{{ h }}</code>
            </button>
          }
        </div>
      }
    </div>
    <button type="button" class="btn btn-sm btn-outline-secondary" (click)="reset()" title="Back to the patterns whose IDs agree in the Corpus Monodicum's notation documentation">
      <i class="bi bi-arrow-counterclockwise me-1"></i>Reset to the default set
    </button>
  `,
})
export class StandardSetComponent implements OnChanges {
  @Input() setup: NotationSetup = defaultSetup();
  @Output() setupChange = new EventEmitter<NotationSetup>();

  /** The standard set in the order of the table (rebuilt when it changes, not on every pass). */
  rows: StandardEntry[] = [];
  query = '';
  hits: string[] = [];

  ngOnChanges(): void { this.rebuild(); }

  private rebuild(): void {
    const order = sortForTable(this.setup.standard.map(e => e.pattern));
    const byPattern = new Map(this.setup.standard.map((e): [string, StandardEntry] => [e.pattern, e]));
    this.rows = order.map(p => byPattern.get(p)!);
  }

  private emit(standard: StandardEntry[], order: NotationOrder = this.setup.order): void {
    this.setup = { standard, order };
    this.rebuild();
    this.setupChange.emit(this.setup);
  }

  setOrder(order: NotationOrder): void { this.emit(this.setup.standard, order); }

  setRefId(pattern: string, refId: string): void {
    this.emit(this.setup.standard.map(e => (e.pattern === pattern ? { pattern, refId: String(refId ?? '').trim() } : e)));
  }

  remove(pattern: string): void { this.emit(this.setup.standard.filter(e => e.pattern !== pattern)); }

  search(): void {
    this.hits = searchPatterns(this.query, new Set(this.setup.standard.map(e => e.pattern)), 12);
  }

  add(pattern: string): void {
    const p = baseCode(pattern);
    if (p && !this.setup.standard.some(e => e.pattern === p)) this.emit([...this.setup.standard, { pattern: p, refId: '' }]);
    this.query = '';
    this.hits = [];
  }

  /** Enter: the code as typed, if it is a neume shape (the library does not have every pattern). */
  addTyped(): void {
    const code = baseCode(this.query);
    if (parseTreeCode(code)) this.add(code);
  }

  reset(): void { this.emit(defaultSetup().standard); }
}
