/**
 * Quantitative summary of a *selection* of chant documents (from search).
 *
 * Pure, dependency-free: given the selected documents, their parent sources, and
 * their transcriptions (RootContainers), compute an at-a-glance dashboard —
 * shared metadata, pitch distribution (overall and grouped, on a shared scale),
 * notes-per-syllable, melodic intervals, melodic n-grams, chant-length
 * distribution, a light text analysis (words / phrases), and a 2-D similarity
 * map of the documents (PCA over text and over melody).
 */
import { Document, Source } from '../api.service';
import * as VM from '../types/model';

export interface SelectionAnalysisInput {
  documents: Document[];
  sources: (Source | null)[];
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
export interface GroupableField {
  key: string;
  label: string;
}
export interface PerDoc {
  id: string;
  label: string;
  notes: number;
  syllables: number;
}
export interface PitchGroups {
  axis: string[]; // union of pitch labels, low → high
  maxPercent: number; // shared vertical scale for all groups
  groups: { group: string; total: number; percent: number[] }[]; // aligned to `axis`
}
export interface EmbeddingPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  group: string;
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
  melodicNGrams: Bucket[];
  lengthDistribution: Bucket[];
  perDoc: PerDoc[];
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
function labelFromIndex(di: number): string {
  return `${STEP_INV[((di % 7) + 7) % 7]}${Math.floor(di / 7)}`;
}

/** Diatonic indices of a document's notes, in reading order (clefs / latent notes skipped). */
function documentPitchSeq(root: VM.RootContainer): number[] {
  const out: number[] = [];
  for (const syl of VM.getSyllables(root)) {
    for (const n of VM.allNotes(syl.notes)) {
      if (!n.isLatent) out.push(diatonicIndex(n.base as unknown as string, n.octave));
    }
  }
  return out;
}

// ── generic helpers ──────────────────────────────────────────────────────────

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) || 0) + by);
}
function topN(counts: Map<string, number>, n: number): Bucket[] {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

/** Adaptive histogram (equal-width bins) of numeric values. */
function histogram(values: number[], nbins = 8): Bucket[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: String(min), count: values.length }];
  const width = (max - min) / nbins;
  const buckets: Bucket[] = [];
  for (let i = 0; i < nbins; i++) {
    const lo = Math.round(min + i * width);
    const hi = Math.round(min + (i + 1) * width);
    buckets.push({ label: `${lo}–${hi}`, count: 0 });
  }
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= nbins) idx = nbins - 1;
    if (idx < 0) idx = 0;
    buckets[idx].count++;
  }
  return buckets;
}

function intervalLabel(step: number): string {
  const s = Math.abs(step);
  if (s === 0) return 'unison';
  if (s === 1) return '2nd';
  if (s === 2) return '3rd';
  if (s === 3) return '4th';
  if (s === 4) return '5th';
  return '6th+';
}
function stepSymbol(step: number): string {
  if (step === 0) return '·';
  return (step > 0 ? '↑' : '↓') + Math.abs(step);
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

function fieldValue(input: SelectionAnalysisInput, i: number, key: string): string {
  const [scope, field] = key.split(':');
  const obj = scope === 'doc' ? input.documents[i] : input.sources[i];
  return String(((obj as any) || {})[field] ?? '').trim();
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

const STOPWORDS = new Set(
  (
    'et in de a ab ad ex e cum non nec ne ut per pro sub super sed autem enim ' +
    'est sunt esse sit erat qui quae quod quia quam quo cui quem quibus is ea id ' +
    'hic haec hoc ille illa illud iste ipse se sui sibi suus sua suum meus tuus ' +
    'noster vester o tu te tibi me mihi nos vos eius eum ei eos eas earum omnis ' +
    'omnes omnia atque ac vel aut si nam iam tam etiam quoque'
  ).split(/\s+/)
);

const LEAD_DASH = /^[-­‐‑]+/;
const TRAIL_DASH = /[-­‐‑]+$/;

/**
 * Reconstruct whole *words* from syllables. Two consecutive syllables belong to
 * the same word if the left one ends with a hyphen OR the right one starts with
 * one — so both the `fixSyllableDashes` (trailing) convention and the raw
 * leading-dash convention ("Quo", "-ni", "am") are handled.
 */
function documentWords(root: VM.RootContainer): string[] {
  const words: string[] = [];
  let cur = '';
  let prevTrail = false;
  const flush = () => {
    const clean = cur.replace(/[^A-Za-zÀ-ÿ]/g, '').toLowerCase();
    if (clean) words.push(clean);
    cur = '';
  };
  for (const syl of VM.getSyllables(root)) {
    const t = (syl.text || '').trim();
    if (!t) continue;
    const lead = LEAD_DASH.test(t);
    const trail = TRAIL_DASH.test(t);
    const core = t.replace(LEAD_DASH, '').replace(TRAIL_DASH, '');
    const sameWord = prevTrail || lead;
    if (!sameWord && cur) flush();
    cur += core;
    prevTrail = trail;
  }
  flush();
  return words;
}

// ── main ─────────────────────────────────────────────────────────────────────

export function analyzeSelection(input: SelectionAnalysisInput): SelectionAnalysis {
  const roots = input.roots;
  const docCount = input.documents.length;

  const sourceIds = new Set<string>();
  input.sources.forEach((s) => s && s.id && sourceIds.add(s.id));

  let totalSyllables = 0;
  let totalNotes = 0;
  const pitchCounts = new Map<number, number>();
  const npsCounts = new Map<string, number>();
  const intervalCounts = new Map<string, number>();
  const ngramCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();
  const phraseCounts = new Map<string, number>();
  const perDoc: PerDoc[] = [];
  let minDi = Infinity;
  let maxDi = -Infinity;

  for (let d = 0; d < roots.length; d++) {
    const root = roots[d];
    if (!root) continue;

    let docNotes = 0;
    let docSyll = 0;
    for (const syl of VM.getSyllables(root)) {
      if (syl.syllableType === VM.SyllableType.WithoutNotes) continue;
      const notes = VM.allNotes(syl.notes).filter((n) => !n.isLatent);
      if (notes.length === 0) continue;
      docSyll++;
      docNotes += notes.length;
      bump(npsCounts, notes.length >= 6 ? '6+' : String(notes.length));
    }
    totalSyllables += docSyll;
    totalNotes += docNotes;
    perDoc.push({
      id: input.documents[d]?.id || String(d),
      label: input.documents[d]?.dokumenten_id || input.documents[d]?.textinitium || `Doc ${d + 1}`,
      notes: docNotes,
      syllables: docSyll,
    });

    // Pitch, ambitus, intervals and interval trigrams over the note sequence.
    const seq = documentPitchSeq(root);
    const steps: number[] = [];
    let prev: number | null = null;
    for (const di of seq) {
      pitchCounts.set(di, (pitchCounts.get(di) || 0) + 1);
      if (di < minDi) minDi = di;
      if (di > maxDi) maxDi = di;
      if (prev !== null) {
        const step = di - prev;
        bump(intervalCounts, intervalLabel(step));
        steps.push(clampStep(step));
      }
      prev = di;
    }
    for (let i = 0; i + 2 < steps.length; i++) {
      const key = stepSymbol(steps[i]) + ' ' + stepSymbol(steps[i + 1]) + ' ' + stepSymbol(steps[i + 2]);
      if (steps[i] === 0 && steps[i + 1] === 0 && steps[i + 2] === 0) continue; // skip pure repetition
      bump(ngramCounts, key);
    }

    // Text
    const words = documentWords(root);
    for (const w of words) if (!STOPWORDS.has(w) && w.length > 1) bump(wordCounts, w);
    for (let i = 0; i + 1 < words.length; i++) {
      if (STOPWORDS.has(words[i]) || STOPWORDS.has(words[i + 1])) continue;
      bump(phraseCounts, words[i] + ' ' + words[i + 1]);
    }
  }

  const pitchDistribution: Bucket[] = Array.from(pitchCounts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([di, count]) => ({ label: labelFromIndex(di), count }));

  const npsOrder = ['1', '2', '3', '4', '5', '6+'];
  const notesPerSyllable = npsOrder.filter((k) => npsCounts.has(k)).map((k) => ({ label: k, count: npsCounts.get(k)! }));

  const intervalOrder = ['unison', '2nd', '3rd', '4th', '5th', '6th+'];
  const intervals = intervalOrder.filter((k) => intervalCounts.has(k)).map((k) => ({ label: k, count: intervalCounts.get(k)! }));

  const ambitus =
    minDi !== Infinity ? { low: labelFromIndex(minDi), high: labelFromIndex(maxDi), span: maxDi - minDi } : null;

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
    melodicNGrams: topN(ngramCounts, 12),
    lengthDistribution: histogram(perDoc.map((p) => p.notes).filter((n) => n > 0), 8),
    perDoc,
    ambitus,
    topWords: topN(wordCounts, 20),
    topPhrases: topN(phraseCounts, 12),
    groupableFields: groupableFields(input),
  };
}

function clampStep(step: number): number {
  return Math.max(-5, Math.min(5, step));
}

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
    if (count / total >= 0.5) out.push({ key: f.key, label: f.label, value, count, total });
  }
  return out.sort((a, b) => b.count - a.count);
}

function groupableFields(input: SelectionAnalysisInput): GroupableField[] {
  return [...DOC_FIELDS, ...SOURCE_FIELDS].filter((f) => distinctNonEmpty(input, f.key) >= 2);
}

/** Pitch distribution per metadata group, on a *shared* pitch axis and % scale. */
export function pitchGroups(input: SelectionAnalysisInput, key: string): PitchGroups {
  const raw = new Map<string, Map<number, number>>();
  const allDi = new Set<number>();
  for (let i = 0; i < input.documents.length; i++) {
    const root = input.roots[i];
    if (!root) continue;
    const g = fieldValue(input, i, key) || '(none)';
    if (!raw.has(g)) raw.set(g, new Map());
    const gc = raw.get(g)!;
    for (const di of documentPitchSeq(root)) {
      gc.set(di, (gc.get(di) || 0) + 1);
      allDi.add(di);
    }
  }
  const axisDi = Array.from(allDi).sort((a, b) => a - b);
  const axis = axisDi.map(labelFromIndex);

  let maxPercent = 0;
  const groups = Array.from(raw.entries())
    .map(([group, counts]) => {
      let total = 0;
      counts.forEach((c) => (total += c));
      const percent = axisDi.map((di) => {
        const p = total > 0 ? (100 * (counts.get(di) || 0)) / total : 0;
        if (p > maxPercent) maxPercent = p;
        return p;
      });
      return { group, total, percent };
    })
    .sort((a, b) => b.total - a.total);

  return { axis, maxPercent: Math.max(1, maxPercent), groups };
}

// ── 2-D similarity map (PCA over document feature vectors) ────────────────────

/** Build a document-feature matrix for the chosen mode, then project to 2-D. */
export function documentEmbedding(
  input: SelectionAnalysisInput,
  mode: 'text' | 'melody',
  groupKey?: string
): EmbeddingPoint[] {
  const idx: number[] = [];
  for (let i = 0; i < input.roots.length; i++) if (input.roots[i]) idx.push(i);
  if (idx.length < 3) return [];

  const vectors = mode === 'text' ? textVectors(input, idx) : melodyVectors(input, idx);
  const coords = pca2D(vectors);
  if (!coords) return [];

  return idx.map((i, k) => ({
    id: input.documents[i]?.id || String(i),
    label: input.documents[i]?.dokumenten_id || input.documents[i]?.textinitium || `Doc ${i + 1}`,
    x: coords[k][0],
    y: coords[k][1],
    group: groupKey ? fieldValue(input, i, groupKey) || '(none)' : '',
  }));
}

function textVectors(input: SelectionAnalysisInput, idx: number[]): number[][] {
  const docWords = idx.map((i) => documentWords(input.roots[i]!).filter((w) => !STOPWORDS.has(w) && w.length > 1));
  const vocab = new Map<string, number>();
  docWords.forEach((ws) => new Set(ws).forEach((w) => vocab.set(w, (vocab.get(w) || 0) + 1)));
  const terms = Array.from(vocab.keys());
  const termIndex = new Map(terms.map((t, i) => [t, i]));
  const N = idx.length;

  return docWords.map((ws) => {
    const tf = new Map<string, number>();
    ws.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    const v = new Array(terms.length).fill(0);
    tf.forEach((count, w) => {
      const df = vocab.get(w)!;
      v[termIndex.get(w)!] = (count / ws.length) * Math.log((N + 1) / (df + 1));
    });
    return l2normalize(v);
  });
}

function melodyVectors(input: SelectionAnalysisInput, idx: number[]): number[][] {
  const seqs = idx.map((i) => documentPitchSeq(input.roots[i]!));
  let lo = Infinity;
  let hi = -Infinity;
  seqs.forEach((s) => s.forEach((di) => { if (di < lo) lo = di; if (di > hi) hi = di; }));
  const span = lo <= hi ? hi - lo + 1 : 1;

  return seqs.map((s) => {
    const pitch = new Array(span).fill(0);
    const interval = new Array(11).fill(0); // signed steps -5..+5
    let prev: number | null = null;
    for (const di of s) {
      if (lo <= hi) pitch[di - lo]++;
      if (prev !== null) interval[clampStep(di - prev) + 5]++;
      prev = di;
    }
    return l2normalize([...l2normalize(pitch), ...l2normalize(interval)]);
  });
}

function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
}

/** Classical PCA to 2-D via the (small) document Gram matrix + power iteration. */
function pca2D(vectors: number[][]): [number, number][] | null {
  const n = vectors.length;
  if (n < 3) return null;
  const dim = vectors[0].length;
  if (dim === 0) return null;

  // Centre the feature vectors.
  const mean = new Array(dim).fill(0);
  vectors.forEach((v) => v.forEach((x, j) => (mean[j] += x / n)));
  const X = vectors.map((v) => v.map((x, j) => x - mean[j]));

  // Gram matrix G = X Xᵀ  (n×n, symmetric PSD).
  const G: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < dim; k++) s += X[i][k] * X[j][k];
      G[i][j] = G[j][i] = s;
    }
  }

  const e1 = powerIteration(G);
  const G2 = deflate(G, e1.vec, e1.val);
  const e2 = powerIteration(G2);

  const s1 = Math.sqrt(Math.max(e1.val, 0));
  const s2 = Math.sqrt(Math.max(e2.val, 0));
  return e1.vec.map((_, i) => [e1.vec[i] * s1, e2.vec[i] * s2] as [number, number]);
}

function powerIteration(M: number[][], iters = 200): { vec: number[]; val: number } {
  const n = M.length;
  let v = new Array(n).fill(0).map((_, i) => Math.sin(i + 1)); // deterministic seed
  v = l2normalize(v);
  let val = 0;
  for (let it = 0; it < iters; it++) {
    const w = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += M[i][j] * v[j];
      w[i] = s;
    }
    const norm = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
    if (norm < 1e-12) break;
    const nv = w.map((x) => x / norm);
    val = norm;
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(nv[i] - v[i]);
    v = nv;
    if (diff < 1e-9) break;
  }
  return { vec: v, val };
}

function deflate(M: number[][], vec: number[], val: number): number[][] {
  const n = M.length;
  return M.map((row, i) => row.map((x, j) => x - val * vec[i] * vec[j]));
}
