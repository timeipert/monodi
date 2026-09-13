import { Component, Input, OnChanges } from '@angular/core';

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  group: string;
}

const PALETTE = [
  '#6366f1', '#16a34a', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7',
  '#ec4899', '#14b8a6', '#84cc16', '#f97316', '#64748b', '#eab308',
];

interface RenderPoint {
  cx: number;
  cy: number;
  label: string;
  group: string;
  color: string;
}

/**
 * Minimal, dependency-free SVG scatter plot for a 2-D similarity map. Points
 * close together are similar; colour encodes an optional grouping.
 */
@Component({
  selector: 'app-chart-scatter',
  template: `
    <div>
      <svg viewBox="0 0 320 220" width="100%" style="max-height: 340px;">
        <line x1="20" y1="110" x2="300" y2="110" stroke="#eef0f4" stroke-width="1" />
        <line x1="160" y1="14" x2="160" y2="206" stroke="#eef0f4" stroke-width="1" />
        <g *ngFor="let p of rendered">
          <circle [attr.cx]="p.cx" [attr.cy]="p.cy" r="4.5" [attr.fill]="p.color" fill-opacity="0.85" stroke="#fff" stroke-width="1">
            <title>{{ p.label }}{{ p.group ? ' · ' + p.group : '' }}</title>
          </circle>
          <text *ngIf="showLabels" [attr.x]="p.cx + 6" [attr.y]="p.cy + 3" font-size="6.5" fill="#6b7280">{{ p.label }}</text>
        </g>
      </svg>
      <div class="d-flex flex-wrap gap-2 mt-1" *ngIf="legend.length > 1">
        <span class="d-inline-flex align-items-center gap-1 small text-muted" *ngFor="let l of legend">
          <span style="width:10px;height:10px;border-radius:9999px;display:inline-block;" [style.background]="l.color"></span>{{ l.group }}
        </span>
      </div>
    </div>
  `,
})
export class ChartScatterComponent implements OnChanges {
  @Input() points: ScatterPoint[] = [];

  rendered: RenderPoint[] = [];
  legend: { group: string; color: string }[] = [];
  showLabels = false;

  ngOnChanges(): void {
    const pts = this.points || [];
    if (pts.length === 0) {
      this.rendered = [];
      this.legend = [];
      return;
    }

    // Group → colour.
    const groups = Array.from(new Set(pts.map((p) => p.group)));
    const colorOf = new Map<string, string>();
    groups.forEach((g, i) => colorOf.set(g, PALETTE[i % PALETTE.length]));
    this.legend = groups.filter((g) => g !== '').map((g) => ({ group: g, color: colorOf.get(g)! }));

    // Scale data to the plot area (20..300 × 14..206, y inverted).
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = (x: number) => 20 + (maxX > minX ? ((x - minX) / (maxX - minX)) * 280 : 140);
    const sy = (y: number) => 206 - (maxY > minY ? ((y - minY) / (maxY - minY)) * 192 : 96);

    this.showLabels = pts.length <= 15;
    this.rendered = pts.map((p) => ({
      cx: sx(p.x),
      cy: sy(p.y),
      label: p.label,
      group: p.group,
      color: colorOf.get(p.group)!,
    }));
  }
}
