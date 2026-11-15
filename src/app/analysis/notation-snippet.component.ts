import { Component, Input, OnChanges } from '@angular/core';
import { layoutNotation, STAFF_LINES } from '@monodi/core/analysis';
import type { NotationCell, NotationLayout } from '@monodi/core/analysis';
import { G_CLEF_PATH } from '../clef-glyph';
import { GLYPH_PATHS } from '../notes/glyph-paths';

/**
 * A few notes on a five-line staff, drawn the way the editor draws them (same staff geometry, same note head, same G
 * clef). Absolute pitches stand on the fixed treble staff with the G clef; intervals and contours get no clef. See
 * `layoutNotation` in the core library.
 */
@Component({
  selector: 'app-notation-snippet',
  standalone: false,
  template: `
    <svg class="ns" [attr.width]="layout.width * scale" [attr.height]="layout.height * scale"
      [attr.viewBox]="'0 ' + layout.top + ' ' + layout.width + ' ' + layout.height" role="img" [attr.aria-label]="label">
      @for (y of staff; track y) {
        <line x1="0" [attr.x2]="layout.width" [attr.y1]="y" [attr.y2]="y" class="ns-line" />
      }
      @if (layout.clef) {
        <path [attr.d]="gClef" class="ns-clef" />
      }
      @for (l of layout.ledgers; track $index) {
        <line [attr.x1]="l.x1" [attr.x2]="l.x2" [attr.y1]="l.y" [attr.y2]="l.y" class="ns-ledger" />
      }
      @for (h of layout.heads; track $index) {
        <path [attr.d]="head" [attr.transform]="'translate(' + (h.x - 30.5) + ' ' + (h.y - 30) + ')'" class="ns-head" />
      }
      @if (layout.more) {
        <text [attr.x]="layout.width - 12" y="64" class="ns-more">…</text>
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-block; vertical-align: middle; line-height: 0; }
    .ns-line { stroke: #b7b5ab; stroke-width: 1; }
    .ns-ledger { stroke: #6b6a64; stroke-width: 1.2; }
    .ns-head { fill: #1f1e1b; }
    .ns-clef { fill: #1f1e1b; }
    .ns-more { font: bold 16px sans-serif; fill: #6b6a64; }
  `],
})
export class NotationSnippetComponent implements OnChanges {
  @Input() notation!: NotationCell['notation'];
  /** Drawing scale: 1 draws the staff at the size of the editor (40 px between the first and the last line). */
  @Input() scale = 0.6;
  /** Text alternative (the notes as words). */
  @Input() label = '';

  layout: NotationLayout = layoutNotation({ mode: 'pitch', values: [] });
  readonly staff = STAFF_LINES;
  readonly head = GLYPH_PATHS['Normal'];
  /** The G clef of the editor (outline on the second line from the bottom). */
  readonly gClef = G_CLEF_PATH;

  ngOnChanges(): void {
    this.layout = layoutNotation(this.notation ?? { mode: 'pitch', values: [] });
  }
}
