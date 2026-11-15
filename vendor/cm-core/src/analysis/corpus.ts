/**
 * The data every analysis method reads: a corpus is a list of chants, each reduced to the few things the methods
 * need (pitches, syllable boundaries, text), plus the metadata of each document that groups them. The methods never
 * see the document tree, so they run unchanged in a web worker and in Node.
 *
 * Pitch is a *diatonic index*: `octave * 7 + step`, with C = 0 … B = 6 inside the octave of the Monodi data model
 * (the octave starts at C). A difference of two indices is a number of scale steps (a third up is +2). B and B-flat
 * are the same index: an accidental is not a note of the melody (see `extractFeatures`).
 */

/** One chant, reduced to what the analysis methods read. All arrays are in reading order. */
export interface ChantFeatures {
  /** Diatonic index of every note of the first voice, without latent notes and without accidentals. */
  pitches: number[];
  /** For each syllable of the chant (also those without notes): index into `pitches` of its first note. */
  sylStart: number[];
  /** For each syllable: number of notes it carries (0 for a syllable without notes). */
  sylLen: number[];
  /** For each syllable: its text as stored (hyphens mark word internal syllable breaks). */
  sylText: string[];
  /** Whole words rebuilt from the syllables, lower case, letters only. */
  words: string[];
  /** For each neume (notes written without a gap) that has notes: index into `pitches` of its first note. */
  neumeStart: number[];
  /** For each word that has notes: index into `pitches` of its first and one past its last note. */
  wordStart: number[];
  wordEnd: number[];
  /** Number of accidental signs (flat, sharp, natural) that the reading skipped. */
  accidentals: number;
}

/** The metadata of one document that methods group or label by. */
export interface DocInfo {
  id: string;
  sourceId: string;
  /** Source siglum (`Quellensigle`). */
  sigle: string;
  /** A short label for tables: the document id of the edition, else the text incipit. */
  label: string;
  /**
   * Grouping fields, keyed `doc:<field>`, `src:<field>` and `custom:<key>` (for example `doc:gattung1`,
   * `src:quellensigle`, `custom:cantus_id`). Values are trimmed strings, empty when the field is not set.
   */
  fields: Record<string, string>;
}

/** The analysed documents. `docs[i]` describes `chants[i]`. */
export interface Corpus {
  docs: DocInfo[];
  chants: ChantFeatures[];
}

/** A field a method may group by, with a label for the user interface. */
export interface FieldOption {
  key: string;
  label: string;
}

/** The label of an unset field value. */
export const NO_VALUE = '(none)';

/** The value of a grouping field for every document of the corpus, `NO_VALUE` where unset. */
export function groupLabels(corpus: Corpus, fieldKey: string): string[] {
  if (!fieldKey) return corpus.docs.map(() => '(all)');
  return corpus.docs.map((d) => d.fields[fieldKey]?.trim() || NO_VALUE);
}

/**
 * The fields offered for grouping: the fixed metadata fields plus every `custom:` key that occurs in the corpus,
 * limited to fields that have at least two distinct values (a field with one value cannot group anything).
 */
export function groupableFields(corpus: Corpus): FieldOption[] {
  const fixed: FieldOption[] = [
    { key: 'src:quellensigle', label: 'Source' },
    { key: 'doc:gattung1', label: 'Genre 1' },
    { key: 'doc:gattung2', label: 'Genre 2' },
    { key: 'doc:festtag', label: 'Feast' },
    { key: 'doc:feier', label: 'Celebration' },
    { key: 'src:herkunftsregion', label: 'Region' },
    { key: 'src:herkunftsort', label: 'Place of origin' },
    { key: 'src:ordenstradition', label: 'Order tradition' },
    { key: 'src:quellentyp', label: 'Source type' },
    { key: 'src:bibliothek', label: 'Library' },
    { key: 'src:datierung', label: 'Dating' },
  ];
  const customKeys = new Set<string>();
  for (const d of corpus.docs) for (const k of Object.keys(d.fields)) if (k.startsWith('custom:')) customKeys.add(k);
  const all = [...fixed, ...[...customKeys].sort().map((k) => ({ key: k, label: `Custom: ${k.slice(7)}` }))];
  return all.filter((f) => {
    const values = new Set<string>();
    for (const d of corpus.docs) {
      const v = d.fields[f.key]?.trim();
      if (v) values.add(v);
      if (values.size > 1) return true;
    }
    return false;
  });
}

/** Sorted distinct values of a field with the number of documents each, for group pickers. */
export function groupCounts(corpus: Corpus, fieldKey: string): { value: string; docs: number }[] {
  const counts = new Map<string, number>();
  for (const v of groupLabels(corpus, fieldKey)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([value, docs]) => ({ value, docs })).sort((a, b) => b.docs - a.docs || a.value.localeCompare(b.value));
}

const STEP_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** `G4` for diatonic index 32: the letter, then the octave of the Monodi data model (the octave starts at C). */
export function pitchLabel(index: number): string {
  const step = ((index % 7) + 7) % 7;
  return `${STEP_LETTERS[step]}${Math.floor(index / 7)}`;
}

/** The step inside the octave (0 = C … 6 = B) of a diatonic index. */
export function stepOf(index: number): number {
  return ((index % 7) + 7) % 7;
}

/** The letter of a diatonic index without the octave (`D`). */
export function letterOf(index: number): string {
  return STEP_LETTERS[stepOf(index)];
}

/** `+2`, `-1`, `0`: a signed number of scale steps. */
export function intervalLabel(steps: number): string {
  return steps > 0 ? `+${steps}` : String(steps);
}
