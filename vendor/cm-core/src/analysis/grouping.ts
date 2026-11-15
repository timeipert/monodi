/**
 * Helpers shared by the methods that split the corpus by a metadata field.
 */
import { groupLabels } from './corpus';
import type { Corpus } from './corpus';

export interface Grouping {
  /** Group labels, most frequent first; a final `(other)` entry exists when groups were merged. */
  labels: string[];
  /** For each document, the index into `labels`. */
  of: number[];
  /** Documents per group. */
  sizes: number[];
}

export const OTHER_GROUP = '(other)';

/**
 * Group the documents by a field. At most `maxGroups` groups are kept (the largest ones); the rest are merged into
 * `(other)`. An empty `fieldKey` puts everything into one group named `(all)`.
 */
export function groupDocs(corpus: Corpus, fieldKey: string, maxGroups = 12): Grouping {
  const labelsPerDoc = groupLabels(corpus, fieldKey);
  const counts = new Map<string, number>();
  for (const l of labelsPerDoc) counts.set(l, (counts.get(l) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = ordered.slice(0, maxGroups);
  const merged = ordered.length > maxGroups;
  const labels = kept.map((e) => e[0]);
  const index = new Map(labels.map((l, i) => [l, i]));
  if (merged) labels.push(OTHER_GROUP);
  const otherIdx = labels.length - 1;
  const of = labelsPerDoc.map((l) => index.get(l) ?? otherIdx);
  const sizes = new Array<number>(labels.length).fill(0);
  for (const g of of) sizes[g]++;
  return { labels, of, sizes };
}

/** Group every document by its own value, without merging (used where each group becomes a row or a leaf). */
export function groupAll(corpus: Corpus, fieldKey: string): { labels: string[]; of: number[]; sizes: number[] } {
  const labelsPerDoc = groupLabels(corpus, fieldKey);
  const order: string[] = [];
  const index = new Map<string, number>();
  for (const l of labelsPerDoc) if (!index.has(l)) { index.set(l, order.length); order.push(l); }
  const sorted = [...order].sort((a, b) => a.localeCompare(b));
  const pos = new Map(sorted.map((l, i) => [l, i]));
  const of = labelsPerDoc.map((l) => pos.get(l)!);
  const sizes = new Array<number>(sorted.length).fill(0);
  for (const g of of) sizes[g]++;
  return { labels: sorted, of, sizes };
}

/** Add a document id to a bounded sample list (used for the documents shown beside a table row). */
export function sampleDoc(list: string[], id: string, cap: number): void {
  if (list.length < cap && list[list.length - 1] !== id && !list.includes(id)) list.push(id);
}

/** Companion field list for `groupBy` parameters: `''` means no grouping. */
export const NO_GROUPING = '';
