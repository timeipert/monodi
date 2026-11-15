/** Small helpers shared by the filters of the datasets: text matching and the distinct values of a field. */

/** Lower case without accents, so `Mü` is found by `mu`. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** True if every word of `query` occurs in at least one of the fields. An empty query matches everything. */
export function matchesText(query: string | undefined, fields: readonly string[]): boolean {
  const words = fold(query ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(fields.join(' \u0001 '));
  return words.every((word) => haystack.includes(word));
}

/** The distinct non-empty values with how often each occurs, most frequent first, ties in alphabetical order. */
export function facet(values: Iterable<string>): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** The whole numbers in a text such as `14., 15.` or `14th century (2nd half)`, without repeats, ascending. */
export function numbersIn(text: string): number[] {
  return Array.from(new Set((text.match(/\d+/g) ?? []).map(Number))).sort((a, b) => a - b);
}
