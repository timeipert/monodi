import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const K_LAST_CHANGE = 'monodi_last_change';
const K_LAST_BACKUP = 'monodi_last_backup';
const K_DISMISSED = 'monodi_backup_reminder_off';
const K_SNOOZE_UNTIL = 'monodi_backup_snooze_until';

/** Wait this long after the last edit before nagging, so we never interrupt active typing. */
const MIN_IDLE_MS = 3 * 60 * 1000;
/** "Remind me later" hides the banner for this long. */
const SNOOZE_MS = 30 * 60 * 1000;

/**
 * Nudges the user to back up. Monodi-Zero is local-first: everything lives in the
 * browser and is lost if site data is cleared. This service tracks whether there
 * are edits made since the last *full* backup (Workspace JSON / ZIP export or a
 * GitHub push) and, if so, shows a dismissible banner and warns on tab close.
 *
 * All state is in localStorage, so it survives reloads. "Don't show again" is
 * permanent until the user makes another backup.
 */
@Injectable({
  providedIn: 'root',
})
export class BackupReminderService {
  /** The app subscribes to this to show/hide the banner. */
  readonly visible$ = new BehaviorSubject<boolean>(false);

  constructor() {
    this.evaluate();
    // Re-check on a timer so the banner appears once editing has paused.
    setInterval(() => this.evaluate(), 60 * 1000);

    // Standard "you have unsaved work" prompt when closing the tab.
    window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
      if (!this.isDismissed() && this.hasUnbackedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /** Call whenever workspace data is written to storage. */
  markChanged(): void {
    this.setNum(K_LAST_CHANGE, Date.now());
    this.evaluate();
  }

  /** Call after a full backup (workspace/ZIP export, GitHub push). */
  markBackup(): void {
    this.setNum(K_LAST_BACKUP, Date.now());
    localStorage.removeItem(K_SNOOZE_UNTIL);
    this.evaluate();
  }

  snooze(): void {
    this.setNum(K_SNOOZE_UNTIL, Date.now() + SNOOZE_MS);
    this.evaluate();
  }

  dismissForever(): void {
    localStorage.setItem(K_DISMISSED, '1');
    this.evaluate();
  }

  hasUnbackedChanges(): boolean {
    const changed = this.getNum(K_LAST_CHANGE);
    return changed > 0 && changed > this.getNum(K_LAST_BACKUP);
  }

  private isDismissed(): boolean {
    return localStorage.getItem(K_DISMISSED) === '1';
  }

  private evaluate(): void {
    const now = Date.now();
    const show =
      !this.isDismissed() &&
      this.hasUnbackedChanges() &&
      now - this.getNum(K_LAST_CHANGE) >= MIN_IDLE_MS &&
      now >= this.getNum(K_SNOOZE_UNTIL);
    if (show !== this.visible$.value) {
      this.visible$.next(show);
    }
  }

  private getNum(key: string): number {
    const v = localStorage.getItem(key);
    const n = v ? parseInt(v, 10) : 0;
    return isNaN(n) ? 0 : n;
  }

  private setNum(key: string, value: number): void {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* localStorage may be unavailable in private mode; the banner just won't show. */
    }
  }
}
