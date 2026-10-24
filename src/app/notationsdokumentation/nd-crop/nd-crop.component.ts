import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CropView } from '../crop-view';

/**
 * A piece of a manuscript page with outlines over it: a line strip with its signs framed and labelled, or one
 * sign close up. Hovering or clicking an outline says which one it is. Without `height` the piece is as wide
 * as its box; with it, it is that high.
 */
@Component({
  selector: 'app-nd-crop',
  standalone: false,
  template: `
    @if (view) {
      <div class="ndc" [class.ndc-fixed]="!!height" [class.ndc-failed]="failed" [style.height]="height"
        [style.aspect-ratio]="view.aspect && !failed ? view.aspect : null">
        @if (view.url) {
          @if (!failed) {
            <img class="ndc-img" [class.ndc-invert]="invert" [class.ndc-sized]="!!view.aspect" [src]="view.url" alt=""
              loading="lazy" referrerpolicy="no-referrer" (error)="failed = true">
          }
        } @else if (view.background) {
          <div class="ndc-bg" [class.ndc-invert]="invert" [style.background-image]="'url(' + view.background.image + ')'"
            [style.background-size]="view.background.size" [style.background-position]="view.background.position"></div>
        }
        @if (failed) { <span class="ndc-note">The picture could not be loaded.</span> }
        @if (!failed) {
          <svg class="ndc-marks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            @for (m of view.marks; track m.id) {
              <polygon class="ndc-mark" [class.strong]="m.strong" [class.on]="m.id === hover" [class.target]="m.id === target"
                [attr.points]="m.points" vector-effect="non-scaling-stroke"
                (mouseenter)="markHover.emit(m.id)" (mouseleave)="markHover.emit('')" (click)="markClick.emit(m.id); $event.stopPropagation()">
                <title>{{ m.label }}</title>
              </polygon>
            }
          </svg>
          @if (labels) {
            @for (m of view.marks; track m.id) {
              @if (m.label) {
                <span class="ndc-label" [class.on]="m.id === hover || m.id === target" [style.left.%]="m.x" [style.top.%]="m.y">{{ m.label }}</span>
              }
            }
          }
        }
      </div>
    } @else {
      <div class="ndc ndc-none" [style.height]="height"><span class="ndc-note">{{ missing }}</span></div>
    }
  `,
  styles: [`
    :host { display: block; }
    :host(.inline) { display: inline-block; }
    .ndc { position: relative; width: 100%; background: #f1ede4; overflow: visible; }
    .ndc-fixed { width: auto; display: inline-block; }
    .ndc-img { display: block; width: 100%; height: auto; }
    .ndc-img.ndc-sized { height: 100%; }
    .ndc-fixed .ndc-img { width: auto; height: 100%; }
    .ndc-bg { position: absolute; inset: 0; background-repeat: no-repeat; }
    .ndc-invert { filter: invert(1) grayscale(1); }
    .ndc-marks { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .ndc-mark { fill: rgba(13, 110, 253, .06); stroke: #0d6efd; stroke-width: 1; cursor: pointer; transition: fill .12s; }
    .ndc-mark.strong { stroke: #d63384; stroke-width: 2; fill: rgba(214, 51, 132, .08); }
    .ndc-mark.on, .ndc-mark:hover { fill: rgba(13, 110, 253, .28); stroke-width: 2; }
    .ndc-mark.target { stroke: #fd7e14; stroke-width: 3; fill: rgba(253, 126, 20, .25); }
    .ndc-label { position: absolute; transform: translate(-4%, -110%); padding: 0 3px; background: #fff; border: 1px solid #333; border-radius: 2px;
      font: 600 10px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace; color: #111; white-space: nowrap; pointer-events: none; opacity: .9; }
    .ndc-label.on { background: #cfe2ff; opacity: 1; }
    .ndc-failed, .ndc-none { min-height: 3rem; display: flex; align-items: center; justify-content: center;
      background: repeating-linear-gradient(0deg, #f6efdd 0 14px, #efe5cc 14px 15px); }
    .ndc-none.ndc { width: 100%; }
    .ndc-note { font-size: .72rem; color: #6c757d; padding: .25rem .5rem; text-align: center; }
  `],
})
export class NdCropComponent implements OnChanges {
  @Input() view: CropView | null = null;
  /** Show a negative scan as dark ink on a light ground. */
  @Input() invert = false;
  /** CSS height; without it the piece is as wide as its box. */
  @Input() height: string | null = null;
  @Input() hover = '';
  @Input() target = '';
  @Input() labels = true;
  @Input() missing = 'No picture';
  @Output() markClick = new EventEmitter<string>();
  @Output() markHover = new EventEmitter<string>();

  failed = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['view'] && changes['view'].previousValue?.url !== changes['view'].currentValue?.url) this.failed = false;
  }
}
