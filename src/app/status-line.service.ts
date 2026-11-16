import { Injectable, signal } from '@angular/core';

/** Kind of a status message. Only `error` looks different (red text); the others are plain text. */
export type StatusKind = 'success' | 'info' | 'warning' | 'error';

/** The message shown in the status line. */
export interface StatusMessage { id: number; kind: StatusKind; text: string; }

/** How long a message stays. Without options: 4 s, errors 8 s. `disableTimeOut` keeps it until `remove()`. */
export interface StatusOptions { timeOut?: number; disableTimeOut?: boolean; }

/**
 * Short feedback after an action ("Saved", "Import failed: …"), shown as one line of text at the bottom left by
 * `StatusLineComponent`. One message at a time: a new message replaces the old one. It replaced the toast pop-ups of
 * ngx-toastr on 2026-11-16 (monochrome design, see `src/styles.css`); the method names stay the same as there
 * (`success`, `info`, `warning`, `error`, `remove`), so callers did not change.
 */
@Injectable({ providedIn: 'root' })
export class StatusLineService {
  /** The message on screen, or null. */
  readonly current = signal<StatusMessage | null>(null);
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  success(message: string, title?: string, options?: StatusOptions) { return this.show('success', message, title, options); }
  info(message: string, title?: string, options?: StatusOptions) { return this.show('info', message, title, options); }
  warning(message: string, title?: string, options?: StatusOptions) { return this.show('warning', message, title, options); }
  error(message: string, title?: string, options?: StatusOptions) { return this.show('error', message, title, options); }

  /** Hides the message with this id (from the return value of a show call), or any message without an id. */
  remove(id?: number): void {
    const m = this.current();
    if (!m || (id !== undefined && m.id !== id)) return;
    clearTimeout(this.timer);
    this.current.set(null);
  }

  private show(kind: StatusKind, message: string, title?: string, options?: StatusOptions): { toastId: number } {
    const id = this.nextId++;
    const text = title ? `${title}: ${message ?? ''}` : String(message ?? '');
    this.current.set({ id, kind, text });
    clearTimeout(this.timer);
    if (!options?.disableTimeOut) {
      const ms = options?.timeOut ?? (kind === 'error' ? 8000 : 4000);
      this.timer = setTimeout(() => this.remove(id), ms);
    }
    return { toastId: id };
  }
}
