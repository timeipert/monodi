import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { IdSelection, SelectState } from './selection-set';

/**
 * The selection tools shared by every list in which the user picks hits, sources or documents: a tri-state checkbox,
 * "Select all N", "Invert", "Only these" (drop picks that are not in this list) and "Clear". They always act on the
 * whole `universe` (every hit of the current result, after filters), never on the page that is shown.
 *
 * The parent passes the ids of all hits and the shared `IdSelection`; the bar changes the selection and emits `changed`
 * so the parent can refresh what depends on it (address bar, counters).
 */
@Component({
  selector: 'app-selection-bar',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="selection-bar d-flex flex-wrap align-items-center gap-2 small" role="group" [attr.aria-label]="'Selection of ' + noun">
      <input type="checkbox" class="form-check-input mt-0" style="transform: scale(1.15);"
        [checked]="state === 'all'" [indeterminate]="state === 'some'" [disabled]="universe.length === 0"
        [attr.aria-label]="state === 'all' ? 'Clear the selection of all ' + noun : 'Select all ' + universe.length + ' ' + noun"
        (change)="toggleAll()" />
      <span class="text-muted selection-count">
        {{ inUniverse }} of {{ universe.length }} {{ noun }} selected
        @if (outside > 0) { <span title="Selected elsewhere, not among these hits">(+{{ outside }} not in these hits)</span> }
      </span>
      <button type="button" class="btn btn-sm btn-outline-secondary py-0" (click)="all()" [disabled]="state === 'all' || universe.length === 0"
        [title]="'Select all ' + universe.length + ' ' + noun + ', also on the other pages'">
        Select all {{ universe.length }}
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary py-0" (click)="invert()" [disabled]="universe.length === 0"
        title="Select what is not selected and deselect what is, among these hits">
        Invert
      </button>
      @if (outside > 0) {
        <button type="button" class="btn btn-sm btn-outline-secondary py-0" (click)="only()" title="Deselect everything that is not among these hits">
          Only these hits
        </button>
      }
      <button type="button" class="btn btn-sm btn-outline-secondary py-0" (click)="clear()" [disabled]="selection.size === 0" title="Clear the whole selection">
        Clear
      </button>
      <ng-content></ng-content>
    </div>
  `,
  styles: [`.selection-count { min-width: 14rem; }`],
})
export class SelectionBarComponent {
  /** The ids of every hit (already deduplicated). */
  @Input() universe: string[] = [];
  @Input() selection!: IdSelection;
  /** What the ids are, in the plural: `documents`, `sources`. */
  @Input() noun = 'documents';
  @Output() changed = new EventEmitter<void>();

  private memo: { universe: string[]; version: number; n: number } | null = null;

  /** How many of the hits are selected. */
  get inUniverse(): number {
    const m = this.memo;
    if (m && m.universe === this.universe && m.version === this.selection.version) return m.n;
    const n = this.selection.countIn(this.universe);
    this.memo = { universe: this.universe, version: this.selection.version, n };
    return n;
  }

  /** How many selected ids are not among the hits. */
  get outside(): number { return this.selection.size - this.inUniverse; }

  get state(): SelectState {
    const n = this.inUniverse;
    return this.universe.length === 0 || n === 0 ? 'none' : n === this.universe.length ? 'all' : 'some';
  }

  toggleAll(): void {
    if (this.state === 'all') this.selection.remove(this.universe); else this.selection.selectAll(this.universe);
    this.changed.emit();
  }
  all(): void { this.selection.selectAll(this.universe); this.changed.emit(); }
  invert(): void { this.selection.invert(this.universe); this.changed.emit(); }
  only(): void { this.selection.keepOnly(this.universe); this.changed.emit(); }
  clear(): void { this.selection.clear(); this.changed.emit(); }
}
