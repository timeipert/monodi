import * as localforage from 'localforage';

/**
 * Sources that the GitHub sync leaves out: a push does not look at them and does not upload them, and a push never
 * deletes their files on GitHub. The import from a repository puts the sources it creates here, because a corpus such as
 * the Corpus Monodicum (hundreds of MB of notes) belongs to its own repository and not into the repository of a person.
 * A person can include a source again (dialog of the selective push, tab *Imported* of the repository import).
 *
 * The list is a row of the workspace storage of its own; it is not part of the backup of the workspace.
 */
export const SYNC_EXCLUDED_KEY = 'monodi_sync_excluded';

export class SyncExclusions {
  /** The identifiers of the sources that the sync leaves out. */
  static async getAll(): Promise<Set<string>> {
    const stored = await localforage.getItem<unknown>(SYNC_EXCLUDED_KEY);
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  }

  static async has(id: string): Promise<boolean> {
    return (await this.getAll()).has(id);
  }

  static async add(ids: Iterable<string>): Promise<void> {
    const all = await this.getAll();
    let changed = false;
    for (const id of ids) {
      if (id && !all.has(id)) { all.add(id); changed = true; }
    }
    if (changed) await localforage.setItem(SYNC_EXCLUDED_KEY, Array.from(all));
  }

  static async remove(ids: Iterable<string>): Promise<void> {
    const all = await this.getAll();
    let changed = false;
    for (const id of ids) {
      if (all.delete(id)) changed = true;
    }
    if (changed) await localforage.setItem(SYNC_EXCLUDED_KEY, Array.from(all));
  }
}
