/**
 * Leaving things out of an analysis. Two kinds of noise are common in a chant corpus:
 *  - chants whose text and melody are always the same (a Kyrie, a Gloria, a psalm tone) and drown the rest;
 *  - frequent function words of the text (et, in, ad …) that dominate word counts.
 * An analysis carries *filters*: rules that leave whole chants out (by the value of any metadata field, for example the
 * text incipit contains "kyrie") and a list of stop words that are removed from the words of every chant. The filters
 * are applied once, before any method runs, so every method (and the corpus search) sees the same reduced corpus; they
 * are part of the fingerprint, so changing them makes stored results out of date.
 */
import type { Corpus } from './corpus';

export interface ExcludeRule {
  /** A grouping field key: `doc:textinitium`, `doc:gattung1`, `src:quellensigle`, `custom:cantus_id` … */
  field: string;
  /** `contains`: the value occurs anywhere (case ignored); `equals`: the whole value is equal (case ignored). */
  mode: 'contains' | 'equals';
  value: string;
}

export interface CorpusFilters {
  exclude: ExcludeRule[];
  stopWords: {
    /** The built-in list of Latin function words (`LATIN_STOP_WORDS`). */
    builtIn: boolean;
    /** Further words, lower case. */
    custom: string[];
  };
}

export const NO_FILTERS: CorpusFilters = { exclude: [], stopWords: { builtIn: false, custom: [] } };

/** Frequent Latin function words: prepositions, conjunctions, pronouns, forms of "to be". */
export const LATIN_STOP_WORDS: readonly string[] = (
  'et in de a ab ad ex e cum non nec ne ut per pro sub super sed autem enim est sunt esse sit erat qui quae quod quia quam ' +
  'quo cui quem quibus is ea id hic haec hoc ille illa illud iste ipse se sui sibi suus sua suum meus tuus noster vester o tu te ' +
  'tibi me mihi nos vos eius eum ei eos eas earum omnis omnes omnia atque ac vel aut si nam iam tam etiam quoque'
).split(/\s+/);

/** Does a rule match a document? The field must be set; an empty rule value matches nothing. */
export function ruleMatches(rule: ExcludeRule, fields: Record<string, string>): boolean {
  const value = (fields[rule.field] ?? '').trim().toLowerCase();
  const wanted = rule.value.trim().toLowerCase();
  if (!wanted || !value) return false;
  return rule.mode === 'equals' ? value === wanted : value.includes(wanted);
}

/** True when an analysis leaves out chants by their metadata (then every method reads the metadata digest). */
export function hasExcludeRules(filters: CorpusFilters | undefined): boolean {
  return !!filters && filters.exclude.some((r) => r.value.trim() !== '');
}

/** The stop words in force, as a set. */
export function stopWordSet(filters: CorpusFilters | undefined): Set<string> {
  const out = new Set<string>();
  if (!filters) return out;
  if (filters.stopWords.builtIn) for (const w of LATIN_STOP_WORDS) out.add(w);
  for (const w of filters.stopWords.custom) { const t = w.trim().toLowerCase(); if (t) out.add(t); }
  return out;
}

/** Split a text of stop words (separated by spaces, commas or lines) into words. */
export function parseWordList(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s,;]+/).map((w) => w.replace(/[^a-zÀ-ÿ]/g, '')).filter(Boolean))];
}

/** A stable text of the filters, part of a result's fingerprint. Empty filters give the empty string. */
export function filtersKey(filters: CorpusFilters | undefined): string {
  if (!filters) return '';
  const rules = filters.exclude.filter((r) => r.value.trim()).map((r) => `${r.field}|${r.mode}|${r.value.trim().toLowerCase()}`).sort();
  const words = [...stopWordSet(filters)].sort();
  if (rules.length === 0 && words.length === 0) return '';
  return `x:${rules.join(';')}/w:${words.join(',')}`;
}

/** A readable one-line description of the filters for the provenance line, or `''` when there are none. */
export function describeFilters(filters: CorpusFilters | undefined): string {
  if (!filters) return '';
  const parts: string[] = [];
  for (const r of filters.exclude) if (r.value.trim()) parts.push(`without chants where ${r.field.replace(/^(doc|src):/, '').replace(/^custom:/, '')} ${r.mode === 'equals' ? 'is' : 'contains'} "${r.value.trim()}"`);
  const n = stopWordSet(filters).size;
  if (n) parts.push(`${n} stop words removed`);
  return parts.join('; ');
}

export interface FilteredCorpus {
  corpus: Corpus;
  /** Indexes (into the corpus before filtering) of the chants that were kept. */
  kept: number[];
  /** Indexes of the chants that a rule left out. */
  excluded: number[];
}

/** Leave out the chants that match a rule and remove the stop words from the words of the others. */
export function applyFilters(corpus: Corpus, filters: CorpusFilters | undefined): FilteredCorpus {
  const rules = (filters?.exclude ?? []).filter((r) => r.value.trim() !== '');
  const stop = stopWordSet(filters);
  if (rules.length === 0 && stop.size === 0) {
    return { corpus, kept: corpus.docs.map((_, i) => i), excluded: [] };
  }
  const kept: number[] = [];
  const excluded: number[] = [];
  corpus.docs.forEach((d, i) => { (rules.some((r) => ruleMatches(r, d.fields)) ? excluded : kept).push(i); });
  const docs = kept.map((i) => corpus.docs[i]);
  const chants = kept.map((i) => {
    const c = corpus.chants[i];
    return stop.size === 0 ? c : { ...c, words: c.words.filter((w) => !stop.has(w)) };
  });
  return { corpus: { docs, chants }, kept, excluded };
}

/** The values of a field with the number of chants each, most frequent first: for choosing what to leave out. */
export function frequentValues(corpus: Corpus, field: string, limit = 20): { value: string; chants: number }[] {
  const counts = new Map<string, number>();
  for (const d of corpus.docs) {
    const v = d.fields[field]?.trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, chants]) => ({ value, chants })).sort((a, b) => b.chants - a.chants || a.value.localeCompare(b.value)).slice(0, limit);
}
