import { Component, inject } from '@angular/core';
import { StatusLineService } from './status-line.service';

/** One line at the bottom left (a dark box, red for errors) with the latest status message (see `StatusLineService`). A click hides it. */
@Component({
  selector: 'app-status-line',
  standalone: true,
  template: `
    @if (status.current(); as m) {
      <div class="status-line" [class.is-error]="m.kind === 'error'" role="status" aria-live="polite"
        (click)="status.remove(m.id)">{{ m.text }}</div>
    }
  `,
  styles: [`
    .status-line {
      position: fixed; left: 1rem; bottom: 1rem; z-index: 2000; max-width: min(36rem, calc(100vw - 2rem));
      padding: .6rem 1rem; background: #111; color: #fff; border-radius: var(--radius-md, 4px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, .25); font-size: .95rem; cursor: default;
    }
    .status-line.is-error { background: var(--color-danger); }
  `],
})
export class StatusLineComponent {
  readonly status = inject(StatusLineService);
}
