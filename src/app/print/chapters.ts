/**
 * Chapters of a print of several documents: the documents of one manuscript belong together, and
 * every manuscript is a chapter. Inside a chapter the documents are numbered 1, 2, 3 …
 * Pure: the caller says which key identifies the manuscript of an item.
 */
export interface Chapters<T> {
  /** The items, grouped by manuscript (manuscripts and items keep the order of first appearance). */
  items: T[];
  /** Chapter number (1-based) of each item. */
  chapterNo: number[];
  /** True for the first item of its chapter. */
  chapterFirst: boolean[];
  /** Running number of each item inside its chapter (1-based). */
  runningNo: number[];
  /** Number of chapters. */
  count: number;
}

export function chapterize<T>(input: readonly T[], keyOf: (item: T) => string): Chapters<T> {
  const order: string[] = [];
  const keys = new Map<T, string>();
  for (const it of input) {
    const k = keyOf(it);
    keys.set(it, k);
    if (!order.includes(k)) order.push(k);
  }
  const items = [...input].sort((a, b) => order.indexOf(keys.get(a)!) - order.indexOf(keys.get(b)!));
  const chapterNo: number[] = [];
  const chapterFirst: boolean[] = [];
  const runningNo: number[] = [];
  let count = 0;
  items.forEach((it, i) => {
    const first = i === 0 || keys.get(it) !== keys.get(items[i - 1]);
    if (first) count++;
    chapterFirst.push(first);
    chapterNo.push(count);
    runningNo.push(first ? 1 : runningNo[i - 1] + 1);
  });
  return { items, chapterNo, chapterFirst, runningNo, count };
}
