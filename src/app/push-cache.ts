import * as localforage from 'localforage';

/**
 * Tracks which manuscripts are known to match what's on GitHub, so a push
 * doesn't have to re-read and re-hash the whole corpus's notes every time to
 * *discover* that most of it hasn't changed.
 *
 * The old push always scanned every manuscript: for each one, every
 * document's notes were read out of IndexedDB just to compute a hash and
 * compare it against the remote SHA. That per-document read is real
 * (unavoidable) I/O — for a large corpus it dominates the whole operation,
 * even when nothing has changed since the last push.
 *
 * This flips the default: a manuscript is assumed unchanged (and skipped
 * entirely — not even read) once it's recorded here as clean, and only
 * falls out of that set when something that could affect it happens:
 *
 *  - an edit marks it dirty (`markDirty`) — precise, cheap, called from the
 *    exact call sites that already know which manuscript was touched;
 *  - a bulk operation whose effect we can't cheaply pin down (CSV import,
 *    backup restore, "clean up orphans", wipe) invalidates everything
 *    (`invalidateAll`) — the next push falls back to a full scan, safe by
 *    construction.
 *
 * A push marks manuscripts clean again only once fully committed — if it's
 * interrupted, nothing is marked clean and the same manuscripts are rescanned
 * next time. Getting this wrong in the "assume clean" direction would mean
 * silently failing to upload real changes, so every write path in the app
 * that can change a manuscript's remote-relevant content MUST call
 * `markDirty`; anything bulk or uncertain should call `invalidateAll`
 * instead of trying to be clever.
 *
 * This cache is local to this browser/device. A different device (or a
 * cleared IndexedDB) simply starts with nothing marked clean, so its first
 * push does a full scan — slower, but correct — and stays fast after that.
 */
export class PushCache {
  private static readonly CLEAN_KEY = 'monodi_push_clean_manuscripts';
  private static readonly DELETED_KEY = 'monodi_push_pending_deletions';

  private static cleanIds: Set<string> | null = null;
  private static deletedIds: Set<string> | null = null;

  private static async loadClean(): Promise<Set<string>> {
    if (!this.cleanIds) {
      const arr = await localforage.getItem<string[]>(this.CLEAN_KEY);
      this.cleanIds = new Set(arr || []);
    }
    return this.cleanIds;
  }

  private static async loadDeleted(): Promise<Set<string>> {
    if (!this.deletedIds) {
      const arr = await localforage.getItem<string[]>(this.DELETED_KEY);
      this.deletedIds = new Set(arr || []);
    }
    return this.deletedIds;
  }

  private static persistClean(): Promise<any> {
    return localforage.setItem(this.CLEAN_KEY, Array.from(this.cleanIds!));
  }

  private static persistDeleted(): Promise<any> {
    return localforage.setItem(this.DELETED_KEY, Array.from(this.deletedIds!));
  }

  /** Call after any edit that changes a manuscript's source/document/notes content. */
  static async markDirty(ids: string | (string | null | undefined)[] | null | undefined): Promise<void> {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((x): x is string => !!x);
    if (list.length === 0) return;
    const set = await this.loadClean();
    let changed = false;
    for (const id of list) { if (set.delete(id)) changed = true; }
    if (changed) await this.persistClean();
  }

  /** Call once a push has confirmed these manuscripts now match the remote. */
  static async markClean(ids: Iterable<string>): Promise<void> {
    const list = Array.from(ids);
    if (list.length === 0) return;
    const set = await this.loadClean();
    for (const id of list) set.add(id);
    await this.persistClean();
  }

  /** Call when a manuscript is deleted locally, so a future push removes it remotely too. */
  static async markDeleted(ids: string | (string | null | undefined)[] | null | undefined): Promise<void> {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((x): x is string => !!x);
    if (list.length === 0) return;
    const clean = await this.loadClean();
    const deleted = await this.loadDeleted();
    let cleanChanged = false;
    for (const id of list) {
      if (clean.delete(id)) cleanChanged = true;
      deleted.add(id);
    }
    await Promise.all([cleanChanged ? this.persistClean() : Promise.resolve(), this.persistDeleted()]);
  }

  /** Call once a push has confirmed these deletions were applied remotely. */
  static async clearDeleted(ids: Iterable<string>): Promise<void> {
    const set = await this.loadDeleted();
    let changed = false;
    for (const id of ids) { if (set.delete(id)) changed = true; }
    if (changed) await this.persistDeleted();
  }

  /**
   * Forgets everything: the next push falls back to scanning and hashing
   * the whole corpus, exactly like before this cache existed. The correct,
   * safe choice whenever a change can't be pinned to specific manuscript
   * ids cheaply.
   */
  static async invalidateAll(): Promise<void> {
    this.cleanIds = new Set();
    this.deletedIds = new Set();
    await Promise.all([this.persistClean(), this.persistDeleted()]);
  }

  static async getCleanIds(): Promise<Set<string>> {
    return new Set(await this.loadClean());
  }

  static async getPendingDeletions(): Promise<Set<string>> {
    return new Set(await this.loadDeleted());
  }
}
