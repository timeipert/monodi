/**
 * Quantitative summary of a *selection* of chant documents (from search).
 *
 * Pure, dependency-free functions: given the selected documents, their parent
 * sources, and their transcriptions (RootContainers), compute an at-a-glance
 * dashboard — shared metadata, pitch distribution (overall and grouped by a
 * metadata column), notes-per-syllable, melodic intervals, ambitus, and a light
 * text analysis (top words and phrases).
 */
import { Document, Source } from '../api.service';
import * as VM from '../types/model';

export interface SelectionAnalysisInput {
  documents: Document[];
  /** Parent source per document, aligned by index (may contain nulls). */
  sources: (Source | null)[];
  /** Transcription per document, aligned by index (may contain nulls). */
  roots: (VM.RootContainer | null)[];
}

export interface Bucket {
  label: string;
  count: number;
}

export interface SharedField {
  key: string;
  label: string;
  value: string;
  count: number;
  total: number;
}

export interface GroupPitch {
  group: string;
  total: number;
  buckets: Bucket[];
}

export interface GroupableField {
  key: string;
  label: string;
}

export interface SelectionAnalysis {
  docCount: number;
  sourceCount: number;
  totalSyllables: number;
  totalNotes: number;
  avgNotesPerSyllable: number;
  sharedMetadata: SharedField[];
  pitchDistribution: Bucket[];
  notesPerSyllable: Bucket[];
  intervals: Bucket[];
  ambitus: { low: string; high: string; span: number } | null;
  topWords: Bucket[];
  topPhrases: Bucket[];
  groupableFields: GroupableField[];
}

// ── pitch helpers ────────────────────────────────────────────────────────────

const STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const STEP_INV = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function diatonicIndex(base: string, octave: number): number {
  return octave * 7 + (STEP[base] ?? 0);
}
function pitchLabel(base: string, octave: number): string {
  return `${base}${octave}`;
}
function labelFromIndex(di: number): string {
  return `${STEP_INV[((di % 7) + 7) % 7]}${Math.floor(di / 7)}`;
}

/** All melodic notes of a document, in reading order (clefs skipped, latent notes skipped). */
function documentNotes(root: VM.RootContainer): VM.Note[] {
  const out: VM.Note[] = [];
  for (const syl of VM.getSyllables(root)) {
    for (const n of VM.allNotes(syl.notes)) {
      if (!n.isLatent) out.push(n);
    }
  }
  return out;
}

// ── metadata ─────────────────────────────────────────────────────────────────

const DOC_FIELDS: GroupableField[] = [
  { key: 'doc:gattung1', label: 'Genre 1' },
  { key: 'doc:gattung2', label: 'Genre 2' },
  { key: 'doc:festtag', label: 'Feast' },
  { key: 'doc:feier', label: 'Celebration' },
  { key: 'doc:editionsstatus', label: 'Edition status' },
  { key: 'doc:druckausgabe', label: 'Print edition' },
];
const SOURCE_FIELDS: GroupableField[] = [
  { key: 'src:quellensigle', label: 'Source' },
  { key: 'src:herkunftsregion', label: 'Region' },
  { key: 'src:herkunftsort', label: 'Place of origin' },
  { key: 'src:ordenstradition', label: 'Order tradition' },
  { key: 'src:quellentyp', label: 'Source type' },
  { key: 'src:bibliothek', label: 'Library' },
  { key: 'src:datierung', label: 'Dating' },
];

/** Read a `doc:field` / `src:field` value for one document. */
function fieldValue(input: SelectionAnalysisInput, i: number, key: string): string {
  const [scope, field] = key.split(':');
  if (scope === 'doc') {
    return String(((input.documents[i] as any) || {})[field] ?? '').trim();
  }
  return String(((input.sources[i] as any) || {})[field] ?? '').trim();
}

function distinctNonEmpty(input: SelectionAnalysisInput, key: string): number {
  const set = new Set<string>();
  for (let i = 0; i < input.documents.length; i++) {
    const v = fieldValue(input, i, key);
    if (v) set.add(v);
  }
  return set.size;
}

// ── text helpers ─────────────────────────────────────────────────────────────

// A small Latin (+ liturgical) stop-word list; kept short on purpose.
const STOPWORDS = new Set(
  (
    'et in de a ab ad ex e cum non nec ne ut per pro sub super sed autem enim ' +
    'est sunt esse sit erat qui quae quod quia quam quo cui quem quibus is ea id ' +
    'hic haec hoc ille illa illud iste ipse se sui sibi suus sua suum meus tuus ' +
    'noster vester o tu te tibi me mihi nos vos eius eum ei eos eas earum omnis ' +
    'omnes omnia atque ac vel aut si nam iam tam etiam quoque'
  ).split(/\s+/)
);

/** Reconstruct whole words (from hyphen-joined syllables) for one document, in order. */
function documentWords(root: VM.RootContainer): string[] {
  const words: string[] = [];
  let cur = '';
  for (const syl of VM.getSyllables(root)) {
    const t = (syl.text || '').trim();
    if (!t) continue;
    cur += t.replace(/-+$/, '');
    if (!t.endsWith('-')) {
      const clean = cur.replace(/[^A-Za-zÀ-ÿ]/g, '').toLowerCase();
      if (clean) words.push(clean);
      cur = '';
    }
  }
  if (cur) {
    const clean = cur.replace(/[^A-Za-zÀ-ÿ]/g, '').toLowerCase();
    if (clean) words.push(clean);
  }
  return words;
}

function topN(counts: Map<string, number>, n: number): Bucket[] {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) || 0) + by);
}

// ── main ─────────────────────────────────────────────────────────────────────

export function analyzeSelection(input: SelectionAnalysisInput): SelectionAnalysis {
  const roots = input.roots;
  const docCount = input.documents.length;

  const sourceIds = new Set<string>();
  input.sources.forEach((s) => {
    if (s && s.id) sourceIds.add(s.id);
  });

  let totalSyllables = 0;
  let totalNotes = 0;
  const pitchCounts = new Map<number, number>(); // keyed by diatonic index
  const npsCounts = new Map<string, number>();
  const intervalCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();
  const phraseCounts = new Map<string, number>();
  let minDi = Infinity;
  let maxDi = -Infinity;

  for (const root of roots) {
    if (!root) continue;

    const syllables = VM.getSyllables(root);
    for (const syl of syllables) {
      if (syl.syllableType === VM.SyllableType.WithoutNotes) continue;
      const notes = VM.allNotes(syl.notes).filter((n) => !n.isLatent);
      if (notes.length === 0) continue;
      totalSyllables++;
      totalNotes += notes.length;
      bump(npsCounts, notes.length >= 6 ? '6+' : String(notes.length));
    }

    // Pitch histogram, ambitus and melodic intervals (per-document sequence).
    const seq = documentNotes(root);
    let prevDi: number | null = null;
    for (const n of seq) {
      const di = diatonicIndex(n.base as unknown as string, n.octave);
      pitchCounts.set(di, (pitchCounts.get(di) || 0) + 1);
      if (di < minDi) minDi = di;
      if (di > maxDi) maxDi = di;
      if (prevDi !== null) {
        const step = Math.abs(di - prevDi);
        bump(intervalCounts, intervalLabel(step));
      }
      prevDi = di;
    }

    // Text
    const words = documentWords(root);
    for (const w of words) {
      if (!STOPWORDS.has(w) && w.length > 1) bump(wordCounts, w);
    }
    for (let i = 0; i + 1 < words.length; i++) {
      if (STOPWORDS.has(words[i]) || STOPWORDS.has(words[i + 1])) continue;
      bump(phraseCounts, words[i] + ' ' + words[i + 1]);
    }
  }

  // Pitch distribution → ordered ascending by diatonic index.
  const pitchDistribution: Bucket[] = Array.from(pitchCounts.entries())
    .map(([di, count]) => ({ di: Number(di), count }))
    .sort((a, b) => a.di - b.di)
    .map((e) => ({ label: labelFromIndex(e.di), count: e.count }));

  // Notes-per-syllable in a friendly order.
  const npsOrder = ['1', '2', '3', '4', '5', '6+'];
  const notesPerSyllable: Bucket[] = npsOrder
    .filter((k) => npsCounts.has(k))
    .map((k) => ({ label: k, count: npsCounts.get(k)! }));

  const intervalOrder = ['unison', '2nd', '3rd', '4th', '5th', '6th+'];
  const intervals: Bucket[] = intervalOrder
    .filter((k) => intervalCounts.has(k))
    .map((k) => ({ label: k, count: intervalCounts.get(k)! }));

  const ambitus =
    minDi !== Infinity
      ? { low: labelFromIndex(minDi), high: labelFromIndex(maxDi), span: maxDi - minDi }
      : null;

  return {
    docCount,
    sourceCount: sourceIds.size,
    totalSyllables,
    totalNotes,
    avgNotesPerSyllable: totalSyllables > 0 ? totalNotes / totalSyllables : 0,
    sharedMetadata: sharedMetadata(input),
    pitchDistribution,
    notesPerSyllable,
    intervals,
    ambitus,
    topWords: topN(wordCounts, 15),
    topPhrases: topN(phraseCounts, 12),
    groupableFields: groupableFields(input),
  };
}

function intervalLabel(step: number): string {
  if (step === 0) return 'unison';
  if (step === 1) return '2nd';
  if (step === 2) return '3rd';
  if (step === 3) return '4th';
  if (step === 4) return '5th';
  return '6th+';
}

/** Fields where a single value covers a strong majority of the selection. */
function sharedMetadata(input: SelectionAnalysisInput): SharedField[] {
  const total = input.documents.length;
  if (total < 2) return [];
  const out: SharedField[] = [];
  const candidates = [...DOC_FIELDS, ...SOURCE_FIELDS].filter((f) => f.key !== 'src:quellensigle');

  for (const f of candidates) {
    const counts = new Map<string, number>();
    for (let i = 0; i < total; i++) {
      const v = fieldValue(input, i, f.key);
      if (v) bump(counts, v);
    }
    if (counts.size === 0) continue;
    const [value, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (count / total >= 0.5) {
      out.push({ key: f.key, label: f.label, value, count, total });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Metadata fields worth offering as a "group pitch by" option (≥2 distinct values). */
function groupableFields(input: SelectionAnalysisInput): GroupableField[] {
  return [...DOC_FIELDS, ...SOURCE_FIELDS].filter((f) => distinctNonEmpty(input, f.key) >= 2);
}

/** Pitch distribution split by a metadata field, one entry per group value. */
export function pitchByField(input: SelectionAnalysisInput, key: string): GroupPitch[] {
  const groups = new Map<string, Map<number, number>>();
  for (let i = 0; i < input.documents.length; i++) {
    const root = input.roots[i];
    if (!root) continue;
    const g = fieldValue(input, i, key) || '(none)';
    if (!groups.has(g)) groups.set(g, new Map());
    const gc = groups.get(g)!;
    for (const n of documentNotes(root)) {
      const di = diatonicIndex(n.base as unknown as string, n.octave);
      gc.set(di, (gc.get(di) || 0) + 1);
    }
  }

  return Array.from(groups.entries())
    .map(([group, counts]) => {
      let total = 0;
      counts.forEach((c) => (total += c));
      const buckets = Array.from(counts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([di, count]) => ({ label: labelFromIndex(di), count }));
      return { group, total, buckets };
    })
    .sort((a, b) => b.total - a.total);
}
