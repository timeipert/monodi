import { FieldJob, fieldValue } from './fields';
import type { Group } from './groups';

/**
 * Volume rules: an ordered list that says which volume a document belongs to. The first rule that fits wins, so a rule
 * for a higher level (a play, by its unit ID) goes before the rules for genres, and a document is printed once.
 * A rule names the volume and looks at one field:
 *  - `in`: the field holds one of `values` (a volume made of several genres: Kyrie, Gloria, Sanctus, Agnus → "Ordinary"),
 *  - `set`: the field has any value, `empty`: it has none.
 * With `each` the rule makes one volume for every value it matches (one volume per play) instead of one for all.
 * Documents that no rule fits come last, in a volume of their own.
 */
export interface VolumeRule {
  name: string;
  field: string;
  op: 'in' | 'set' | 'empty';
  values: string[];
  each?: boolean;
}

/** The value of the split select that stands for the rules. */
export const RULES_SPLIT = '@rules';
export const NO_RULE_KEY = '\u0000no-rule';
export const NO_RULE_LABEL = '(no rule fits)';

export const RULE_OPS: { op: VolumeRule['op']; label: string }[] = [
  { op: 'in', label: 'is one of' },
  { op: 'set', label: 'has a value' },
  { op: 'empty', label: 'has no value' },
];

const norm = (s: string): string => s.trim().toLowerCase();

/** What a document has in a field, for matching: both genres count for "Genre", the manuscript is its siglum. */
function candidates(job: FieldJob, field: string): string[] {
  const raw = field === 'genre'
    ? [fieldValue(job, 'gattung1'), fieldValue(job, 'gattung2')]
    : field === 'quelle-id' ? [fieldValue(job, 'quellensigle')] : [fieldValue(job, field)];
  return raw.map((v) => v.trim()).filter(Boolean);
}

/** The values of a rule as typed: separated by commas or semicolons, empty ones dropped. */
export function parseRuleValues(text: string): string[] {
  return text.split(/[;,]/).map((v) => v.trim()).filter(Boolean);
}

/** A rule as the print can use it: a name, a field and, for `in`, at least one value. Nothing else is a rule. */
export function usableRules(rules: readonly VolumeRule[] | null | undefined): VolumeRule[] {
  return (rules ?? []).filter((r) => r && r.name?.trim() && r.field && (r.op !== 'in' || r.values?.some((v) => v.trim())));
}

/** How a document fits one rule: not at all (null), or the value it matched (`''` for set/empty) and the place of that value in the list. */
function match(job: FieldJob, rule: VolumeRule): { value: string; rank: number } | null {
  const have = candidates(job, rule.field);
  if (rule.op === 'empty') return have.length ? null : { value: '', rank: 0 };
  if (rule.op === 'set') return have.length ? { value: have[0], rank: 0 } : null;
  const wanted = rule.values.map(norm);
  let best: { value: string; rank: number } | null = null;
  for (const v of have) {
    const rank = wanted.indexOf(norm(v));
    if (rank >= 0 && (!best || rank < best.rank)) best = { value: v, rank };
  }
  return best;
}

/**
 * Splits `items` into volumes by the rules. The volumes come in the order of the rules (a volume per value of an `each`
 * rule in order of first appearance), the documents that fit no rule last. Inside a volume the documents keep the order
 * of the input, except that those of an earlier value of an `in` rule stand before the later ones: the Kyries before the Glorias.
 */
export function groupByRules<T>(items: readonly T[], jobOf: (item: T) => FieldJob, rules: readonly VolumeRule[]): Group<T>[] {
  const use = usableRules(rules);
  const groups = new Map<string, Group<T> & { order: number; ranks: number[] }>();
  const order: string[] = [];
  for (const item of items) {
    const job = jobOf(item);
    let key = NO_RULE_KEY, label = NO_RULE_LABEL, rank = 0, slot = use.length;
    for (let i = 0; i < use.length; i++) {
      const hit = match(job, use[i]);
      if (!hit) continue;
      slot = i;
      rank = hit.rank;
      if (use[i].each && hit.value) { key = `${i}\u0001${norm(hit.value)}`; label = `${use[i].name.trim()} · ${hit.value}`; }
      else { key = String(i); label = use[i].name.trim(); }
      break;
    }
    let g = groups.get(key);
    if (!g) { g = { key, label, items: [], order: slot, ranks: [] }; groups.set(key, g); order.push(key); }
    // an insertion keeps the input order among equal ranks
    let pos = g.items.length;
    while (pos > 0 && g.ranks[pos - 1] > rank) pos--;
    g.items.splice(pos, 0, item);
    g.ranks.splice(pos, 0, rank);
  }
  return order.map((k) => groups.get(k)!)
    .sort((a, b) => a.order - b.order)   // Array.sort is stable: volumes of one rule stay in order of appearance
    .map(({ key, label, items }) => ({ key, label, items }));
}
