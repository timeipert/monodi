import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * One slider with two handles for a range (here: which part of a chant a melody may be found in, in percent).
 * Two native range inputs lie over one track; only their handles take the mouse, so the keyboard and touch work as
 * on any slider. The handles never cross; when both sit at the right end the left one is on top, so it can still be dragged.
 */
@Component({
  selector: 'app-range-slider',
  standalone: true,
  template: `
    <div class="rs" [style.--from.%]="pct(from)" [style.--to.%]="pct(to)">
      <div class="rs-track"><div class="rs-fill"></div></div>
      <input type="range" class="rs-input" [min]="min" [max]="max" [step]="step" [value]="from" [style.z-index]="from > (min + max) / 2 ? 2 : 1" [attr.aria-label]="label + ' from'"
        (input)="moveFrom($any($event.target).valueAsNumber)" />
      <input type="range" class="rs-input" [min]="min" [max]="max" [step]="step" [value]="to" [attr.aria-label]="label + ' to'"
        (input)="moveTo($any($event.target).valueAsNumber)" />
    </div>
  `,
  styles: [`
    .rs { position: relative; height: 1.5rem; }
    .rs-track { position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; background: var(--color-border-hover); }
    .rs-fill { position: absolute; top: 0; bottom: 0; left: var(--from); right: calc(100% - var(--to)); background: var(--color-text); }
    .rs-input {
      position: absolute; inset: 0; width: 100%; margin: 0; background: none; pointer-events: none; appearance: none; -webkit-appearance: none;
    }
    .rs-input::-webkit-slider-runnable-track { background: none; }
    .rs-input::-moz-range-track { background: none; }
    .rs-input::-webkit-slider-thumb {
      pointer-events: auto; -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
      background: var(--color-text); border: 2px solid var(--color-surface); box-shadow: 0 0 0 1px var(--color-text); cursor: pointer;
    }
    .rs-input::-moz-range-thumb {
      pointer-events: auto; width: 10px; height: 10px; border-radius: 50%;
      background: var(--color-text); border: 2px solid var(--color-surface); box-shadow: 0 0 0 1px var(--color-text); cursor: pointer;
    }
  `],
})
export class RangeSliderComponent {
  @Input() min = 0;
  @Input() max = 100;
  @Input() step = 1;
  @Input() from = 0;
  @Input() to = 100;
  /** Accessible name of the two handles. */
  @Input() label = 'Range';
  @Output() fromChange = new EventEmitter<number>();
  @Output() toChange = new EventEmitter<number>();

  pct(v: number): number { return ((v - this.min) / (this.max - this.min)) * 100; }

  moveFrom(v: number): void {
    this.fromChange.emit(Math.min(v, this.to));
  }

  moveTo(v: number): void {
    this.toChange.emit(Math.max(v, this.from));
  }
}
