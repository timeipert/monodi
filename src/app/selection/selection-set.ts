/**
 * A set of selected ids with the operations the search, analysis and statistics pages share: select all, invert,
 * keep only the hits, clear. All operations that take a *universe* work on the whole list given, never on the page the
 * user happens to see: "all" always means every hit.
 */

export type SelectState = 'none' | 'some' | 'all';

/** The ids of a list without repeats and without empty entries, in their order. */
export function uniqueIds(ids: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

export class IdSelection {
  private readonly set = new Set<string>();
  private changes = 0;

  /** Increases with every change, so a view can recompute only when the selection changed. */
  get version(): number { return this.changes; }
  get size(): number { return this.set.size; }

  has(id: string): boolean { return this.set.has(id); }

  /** The selected ids in the order they were added. */
  ids(): string[] { return [...this.set]; }

  /** Select the ids; returns how many were not selected before. */
  add(ids: Iterable<string>): number {
    let n = 0;
    for (const id of ids) if (id && !this.set.has(id)) { this.set.add(id); n++; }
    if (n) this.changes++;
    return n;
  }

  /** Deselect the ids; returns how many were selected before. */
  remove(ids: Iterable<string>): number {
    let n = 0;
    for (const id of ids) if (this.set.delete(id)) n++;
    if (n) this.changes++;
    return n;
  }

  /** Flip one id; returns whether it is selected afterwards. */
  toggle(id: string): boolean {
    if (this.set.delete(id)) { this.changes++; return false; }
    this.set.add(id);
    this.changes++;
    return true;
  }

  clear(): void {
    if (this.set.size) { this.set.clear(); this.changes++; }
  }

  /** Replace the whole selection. */
  replace(ids: Iterable<string>): void {
    this.set.clear();
    for (const id of ids) if (id) this.set.add(id);
    this.changes++;
  }

  /** Select every id of the universe (ids outside it stay as they are). */
  selectAll(universe: Iterable<string>): void { this.add(universe); }

  /** Flip every id of the universe: selected ones are deselected and the other way round. Ids outside it stay. */
  invert(universe: Iterable<string>): void {
    for (const id of uniqueIds(universe)) {
      if (this.set.has(id)) this.set.delete(id); else this.set.add(id);
    }
    this.changes++;
  }

  /** Keep only the ids that are in the universe. */
  keepOnly(universe: Iterable<string>): void {
    const keep = new Set(universe);
    for (const id of [...this.set]) if (!keep.has(id)) this.set.delete(id);
    this.changes++;
  }

  /** How many ids of the (duplicate-free) universe are selected. */
  countIn(universe: readonly string[]): number {
    let n = 0;
    for (const id of universe) if (this.set.has(id)) n++;
    return n;
  }

  /** `all` when every id of the universe is selected, `some` when part of it is, else `none`. An empty universe is `none`. */
  stateOf(universe: readonly string[]): SelectState {
    if (universe.length === 0) return 'none';
    const n = this.countIn(universe);
    return n === 0 ? 'none' : n === universe.length ? 'all' : 'some';
  }
}
