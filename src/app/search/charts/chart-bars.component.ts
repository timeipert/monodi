import { Component, Input } from '@angular/core';

export interface BarItem {
  label: string;
  value: number;
}

/**
 * A compact, dependency-free horizontal bar chart. Pass a shared `max` to make
 * several charts directly comparable (same scale).
 */
@Component({
  selector: 'app-chart-bars',
  template: `
    <div class="cb">
      <div class="cb-row" *ngFor="let it of items">
        <div class="cb-label" [class.mono]="labelClass === 'mono'" [class.wide]="labelClass === 'wide'"
             [title]="it.label">{{ it.label }}</div>
        <div class="cb-track">
          <div class="cb-fill" [style.width.%]="pct(it.value)" [style.background]="color"></div>
        </div>
        <div class="cb-value">{{ it.value | number: fmt }}{{ suffix }}</div>
      </div>
      <p class="text-muted small mb-0" *ngIf="!items || items.length === 0">{{ empty }}</p>
    </div>
  `,
  styles: [
    `
      .cb-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 5px; }
      .cb-label {
        flex: 0 0 3.5rem; font-size: 0.8rem; color: #374151; text-align: right;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cb-label.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .cb-label.wide { flex-basis: 8.5rem; text-align: left; }
      .cb-track { flex: 1 1 auto; background: #f1f5f9; border-radius: 5px; height: 13px; overflow: hidden; }
      .cb-fill { height: 100%; border-radius: 5px; transition: width 0.25s ease; }
      .cb-value { flex: 0 0 2.6rem; font-size: 0.78rem; color: #6b7280; text-align: right; }
    `,
  ],
})
export class ChartBarsComponent {
  @Input() items: BarItem[] = [];
  @Input() max?: number;
  @Input() color = '#6366f1';
  @Input() suffix = '';
  @Input() fmt = '1.0-0';
  @Input() labelClass: '' | 'mono' | 'wide' = '';
  @Input() empty = 'No data.';

  pct(value: number): number {
    const m = this.max ?? Math.max(1, ...this.items.map((i) => i.value));
    return m > 0 ? Math.round((value / m) * 100) : 0;
  }
}
