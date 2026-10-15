import { compareNatural } from '../../utils';

/** Documents that belong together in one volume: they have the same value in the field the print is split by. */
export interface Group<T> {
  key: string;
  /** What the volume is called; empty for the documents that have no value. */
  label: string;
  items: T[];
}

/**
 * Splits `items` into groups. The order inside a group is the order of the input; the groups are sorted by label
 * (numbers as numbers), the group without a value comes last.
 */
export function groupItems<T>(items: readonly T[], keyOf: (item: T) => { key: string; label: string }): Group<T>[] {
  const groups = new Map<string, Group<T>>();
  for (const it of items) {
    const { key, label } = keyOf(it);
    const g = groups.get(key);
    if (g) g.items.push(it);
    else groups.set(key, { key, label, items: [it] });
  }
  return [...groups.values()].sort((a, b) => (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0) || compareNatural(a.label, b.label));
}

/** A name that every file system accepts, short enough, never empty. */
export function safeFileName(text: string, fallback = 'ohne-Angabe'): string {
  const cleaned = (text || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const cut = Array.from(cleaned).slice(0, 60).join('').trim();
  return cut || fallback;
}

/** One file name per group: `base_label.pdf`, made unique when two labels end up the same. */
export function volumeFileNames(base: string, labels: string[], ext = '.pdf'): string[] {
  const used = new Set<string>();
  return labels.map((label) => {
    const stem = `${safeFileName(base, 'Volume')}_${safeFileName(label)}`;
    let name = stem + ext;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}_${n}${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}
