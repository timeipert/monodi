import * as localforage from 'localforage';

/**
 * Per-document notes storage.
 *
 * Background: the app originally stored every document's notes inside a
 * single `monodi_notes` object — `{ [docId]: RootContainer }`. IndexedDB's
 * structured-clone limit is ~1 GiB per row, so once a workspace grew past a
 * few hundred sources the next `localforage.setItem('monodi_notes', …)`
 * threw `IDBObjectStore.put: The structured clone is too large`.
 *
 * Fix: keep each document's notes in its own row (`monodi_notes_doc_<id>`),
 * with an index row (`monodi_notes_index`) listing the known IDs. No single
 * write can exceed one document's worth of data anymore. A migration on
 * first access transparently splits the legacy blob if it is still present.
 *
 * The public API mirrors the old "one big dict" mental model so the rest of
 * the codebase doesn't need a sweeping rewrite — but writers that touch many
 * documents at once (import / delete / save) should now use `set` /
 * `remove` / `merge` instead of `replaceAll`, because `replaceAll` still
 * loads everything into memory.
 */
export class NotesStore {
  private static readonly INDEX_KEY = 'monodi_notes_index';
  private static readonly LEGACY_KEY = 'monodi_notes';
  private static readonly MIGRATION_FLAG = 'monodi_notes_migrated_v1';
  private static readonly ITEM_KEY = (id: string) => `monodi_notes_doc_${id}`;

  /**
   * Counts the writes made through this class since the page was loaded. Caches that are derived from the notes (the
   * results of the quick search) include it in their key, so a document edited after the search is not served stale.
   */
  static revision = 0;

  /** Cached promise so concurrent callers don't re-run the migration. */
  private static migrationPromise: Promise<void> | null = null;

  /** Public migration hook — call once at boot to surface migration errors
   *  early instead of on the next read. Idempotent and concurrency-safe. */
  static async ensureMigrated(): Promise<void> {
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = (async () => {
      const done = await localforage.getItem<boolean>(this.MIGRATION_FLAG);
      if (done) return;

      const legacy = await localforage.getItem<{ [id: string]: any }>(this.LEGACY_KEY);
      if (legacy && typeof legacy === 'object') {
        const ids = Object.keys(legacy);
        const migrated: string[] = [];
        for (const id of ids) {
          try {
            await localforage.setItem(this.ITEM_KEY(id), legacy[id]);
            migrated.push(id);
          } catch (e) {
            console.warn(`NotesStore: failed to migrate ${id}`, e);
            throw e;
          }
        }
        await localforage.setItem(this.INDEX_KEY, migrated);
        // Drop the giant legacy blob so it stops eating storage quota.
        try { await localforage.removeItem(this.LEGACY_KEY); } catch { /* ignore */ }
      }

      await localforage.setItem(this.MIGRATION_FLAG, true);
    })().catch(err => {
      // Don't poison the promise cache on failure — let callers retry.
      this.migrationPromise = null;
      throw err;
    });
    return this.migrationPromise;
  }

  /** Read one document's notes. Returns null if absent. */
  static async get(id: string): Promise<any | null> {
    await this.ensureMigrated();
    return await localforage.getItem(this.ITEM_KEY(id));
  }

  /** Write one document's notes. Updates the index if this is new. */
  static async set(id: string, data: any): Promise<void> {
    this.revision++;
    await this.ensureMigrated();
    await localforage.setItem(this.ITEM_KEY(id), data);
    const idx = (await localforage.getItem<string[]>(this.INDEX_KEY)) || [];
    if (!idx.includes(id)) {
      idx.push(id);
      await localforage.setItem(this.INDEX_KEY, idx);
    }
  }

  /** Delete one document's notes. */
  static async remove(id: string): Promise<void> {
    this.revision++;
    await this.ensureMigrated();
    await localforage.removeItem(this.ITEM_KEY(id));
    const idx = (await localforage.getItem<string[]>(this.INDEX_KEY)) || [];
    const i = idx.indexOf(id);
    if (i >= 0) {
      idx.splice(i, 1);
      await localforage.setItem(this.INDEX_KEY, idx);
    }
  }

  /** Bulk-delete a list of IDs. Single index write at the end. */
  static async removeMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    this.revision++;
    await this.ensureMigrated();
    const toRemove = new Set(ids);
    for (const id of ids) {
      try {
        await localforage.removeItem(this.ITEM_KEY(id));
      } catch (e) {
        console.warn('remove failed', id, e);
        throw e;
      }
    }
    const idx = (await localforage.getItem<string[]>(this.INDEX_KEY)) || [];
    await localforage.setItem(this.INDEX_KEY, idx.filter(i => !toRemove.has(i)));
  }

  /** Merge a partial dict into the store. Each entry is its own put, so no
   *  single write hits the structured-clone limit. Single index write at end. */
  static async merge(dict: { [id: string]: any }): Promise<void> {
    this.revision++;
    await this.ensureMigrated();
    const ids = Object.keys(dict);
    if (ids.length === 0) return;
    for (const id of ids) {
      await localforage.setItem(this.ITEM_KEY(id), dict[id]);
    }
    const idx = (await localforage.getItem<string[]>(this.INDEX_KEY)) || [];
    const set = new Set(idx);
    for (const id of ids) set.add(id);
    await localforage.setItem(this.INDEX_KEY, Array.from(set));
  }

  /** List of all doc IDs known to the store. */
  static async getIndex(): Promise<string[]> {
    await this.ensureMigrated();
    return (await localforage.getItem<string[]>(this.INDEX_KEY)) || [];
  }

  /** Read everything as a single dict.
   *
   *  NOTE: this materialises the whole notes store in memory — fine for
   *  search / export over a workspace of a few hundred MB, but not safe to
   *  re-write back via `localforage.setItem('monodi_notes', dict)` (that's
   *  exactly the bug we're trying to fix). Use `merge` / `replaceAll`
   *  instead, both of which write one row per document. */
  static async getAll(): Promise<{ [id: string]: any }> {
    await this.ensureMigrated();
    const ids = await this.getIndex();
    const out: { [id: string]: any } = {};
    for (const id of ids) {
      const v = await localforage.getItem(this.ITEM_KEY(id));
      if (v !== null && v !== undefined) out[id] = v;
    }
    return out;
  }

  /** Replace the entire store. Removes anything not present in `dict`. */
  static async replaceAll(dict: { [id: string]: any }): Promise<void> {
    this.revision++;
    await this.ensureMigrated();
    const newIds = Object.keys(dict);
    const oldIds = await this.getIndex();
    for (const id of newIds) {
      await localforage.setItem(this.ITEM_KEY(id), dict[id]);
    }
    for (const id of oldIds) {
      if (!(id in dict)) {
        try {
          await localforage.removeItem(this.ITEM_KEY(id));
        } catch (e) {
          console.warn(`NotesStore: replaceAll failed to remove ${id}`, e);
          throw e;
        }
      }
    }
    await localforage.setItem(this.INDEX_KEY, newIds);
  }
}
