/**
 * Stylometry and text-critical methods: the distance between sources (or any groups of chants) with a dendrogram and a
 * map, and the variants of the same chant across witnesses.
 */
import type { Corpus } from '../corpus';
import { groupAll } from '../grouping';
import { averageLinkage, classicalMds, leafOrder } from '../cluster';
import { burrowsDelta, cosineSparse, editDistance, jaccard, mean } from '../stats';
import { forEachWindow, joinerOf, tokenize, UNIT_OPTIONS } from '../tokens';
import type { Unit } from '../tokens';
import { intervalsOf } from '../features';
import { DEFAULT_ROW_CAP, makeTable } from '../result';
import type { AnalysisMethod, Cell, ParamValues, ResultView } from '../result';

// ── source distance ─────────────────────────────────────────────────────────

/** The most groups the distance matrix is computed for (the matrix and the clustering grow with the square or cube). */
const MAX_GROUPS = 400;
/** The most groups for which the full matrix is stored in the result (larger matrices are described by the tree). */
const MAX_MATRIX = 120;

export const sourceDistanceMethod: AnalysisMethod = {
  id: 'source-distance',
  version: 1,
  title: 'Distance between sources',
  group: 'corpus',
  summary: 'Compares groups of chants (by default the sources) by the relative frequencies of their most frequent n-grams, computes a distance for every pair, and clusters them into a dendrogram and a two-dimensional map. Answers: which sources are close in melodic or textual habit?',
  uses: ['melody', 'text', 'meta'],
  cost: 2,
  params: [
    { key: 'groupBy', label: 'Compare', type: 'field', help: 'The field whose values are compared (the source, a genre, a region).' },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, help: 'What is counted in each group.' },
    { key: 'n', label: 'Length n', type: 'number', min: 1, max: 6, help: 'Number of consecutive units in one feature.' },
    { key: 'topFeatures', label: 'Most frequent features', type: 'number', min: 20, max: 2000, step: 10, help: 'The distance uses this many of the most frequent n-grams of the whole corpus (Burrows used the 150 to 500 most frequent words).' },
    { key: 'measure', label: 'Distance', type: 'select', options: [{ value: 'delta', label: "Burrows' Delta (z-scored frequencies)" }, { value: 'cosine', label: 'Cosine (1 - similarity of frequencies)' }, { value: 'jaccard', label: 'Jaccard (1 - share of features present in both)' }], help: "Delta weights every feature equally after z-scoring and is the usual stylometric choice." },
    { key: 'minChants', label: 'Chants per group', type: 'number', min: 1, max: 200, help: 'Groups with fewer chants are left out (their frequencies are too uncertain).' },
  ],
  defaults: { groupBy: 'src:quellensigle', unit: 'interval', n: 3, topFeatures: 300, measure: 'delta', minChants: 5 },
  run(corpus: Corpus, p: ParamValues, io) {
    const unit = p['unit'] as Unit;
    const n = p['n'] as number;
    const joiner = joinerOf(unit);
    const all = groupAll(corpus, p['groupBy'] as string);
    const minChants = p['minChants'] as number;
    let groups = all.labels.map((label, g) => ({ label, g, size: all.sizes[g] })).filter((x) => x.size >= minChants);
    const notes: string[] = [];
    if (groups.length > MAX_GROUPS) {
      groups = groups.sort((a, b) => b.size - a.size).slice(0, MAX_GROUPS);
      notes.push(`Only the ${MAX_GROUPS} largest groups were compared.`);
    }
    if (groups.length < 3) {
      return { summary: 'Fewer than three groups reach the minimum number of chants.', docCount: 0, views: [], notes: ['Lower "Chants per group" or choose another field.'] };
    }
    const slot = new Map(groups.map((x, i) => [x.g, i]));
    const counts: Map<string, number>[] = groups.map(() => new Map());
    const totals = new Array<number>(groups.length).fill(0);
    const overall = new Map<string, number>();
    corpus.chants.forEach((c, d) => {
      if (d % 200 === 0) io.progress(d, corpus.chants.length);
      const s = slot.get(all.of[d]);
      if (s === undefined) return;
      forEachWindow(tokenize(c, unit), n, joiner, (key) => {
        counts[s].set(key, (counts[s].get(key) ?? 0) + 1);
        overall.set(key, (overall.get(key) ?? 0) + 1);
        totals[s]++;
      });
    });
    const features = [...overall.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, p['topFeatures'] as number).map((e) => e[0]);
    const freqs = groups.map((_, i) => features.map((f) => (totals[i] ? (counts[i].get(f) ?? 0) / totals[i] : 0)));
    const measure = p['measure'] as string;
    let dist: number[][];
    if (measure === 'cosine') {
      const maps = freqs.map((row) => new Map(row.map((v, j) => [features[j], v] as [string, number])));
      dist = maps.map((a) => maps.map((b) => 1 - cosineSparse(a, b)));
    } else if (measure === 'jaccard') {
      const sets = counts.map((m) => new Set(features.filter((f) => m.has(f))));
      dist = sets.map((a) => sets.map((b) => 1 - jaccard(a, b)));
    } else {
      dist = burrowsDelta(freqs);
    }
    io.progress(3, 4);
    const labels = groups.map((x) => x.label);
    const merges = averageLinkage(dist);
    const order = leafOrder(labels.length, merges);
    const coords = classicalMds(dist);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const views: ResultView[] = [
      { kind: 'tree', title: 'Dendrogram (average linkage)', leaves: labels, merges: merges.map((m) => ({ a: m.a, b: m.b, height: round(m.height) })) },
    ];
    if (coords) views.push({ kind: 'scatter', title: 'Map (classical multidimensional scaling)', points: coords.map((c, i) => ({ label: labels[i], x: round(c[0]), y: round(c[1]), group: labels[i] })), note: 'Distances in the plane approximate the distances of the matrix; the axes have no meaning.' });
    if (labels.length <= MAX_MATRIX) {
      views.push({ kind: 'matrix', title: 'Distance matrix', rowLabels: order.map((i) => labels[i]), colLabels: order.map((i) => labels[i]), values: order.map((i) => order.map((j) => round(dist[i][j]))), digits: 3, lowIsClose: true, note: 'Rows and columns are ordered as in the dendrogram.' });
    } else notes.push(`The full matrix is not stored above ${MAX_MATRIX} groups; the dendrogram and the table of nearest neighbours carry the result.`);
    const nearest = labels.map((label, i): Cell[] => {
      const others = dist[i].map((v, j) => [j, v] as const).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3);
      return [label, groups[i].size, ...others.map(([j, v]) => `${labels[j]} (${round(v)})`), round(mean(dist[i].filter((_, j) => j !== i)))];
    });
    views.push(makeTable({
      title: 'Nearest neighbours',
      columns: [{ key: 'g', label: 'Group' }, { key: 'c', label: 'Chants', numeric: true }, { key: 'n1', label: 'Nearest' }, { key: 'n2', label: 'Second' }, { key: 'n3', label: 'Third' }, { key: 'm', label: 'Mean distance', numeric: true }],
      rows: nearest, cap: DEFAULT_ROW_CAP,
    }));
    return {
      summary: `${labels.length} groups compared by ${features.length} ${n}-grams of ${unit} (${measure}).`,
      docCount: groups.reduce((s, x) => s + x.size, 0),
      views,
      notes,
    };
  },
};

/** The distance matrix of a result as CSV text (first row and column are the labels). */
export function matrixToCsv(rowLabels: readonly string[], colLabels: readonly string[], values: readonly (readonly number[])[]): string {
  const esc = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [['', ...colLabels].map(esc).join(',')];
  rowLabels.forEach((l, i) => lines.push([esc(l), ...values[i].map(String)].join(',')));
  return lines.join('\n') + '\n';
}

/** A symmetric distance matrix as NEXUS (for SplitsTree, PAUP and similar programs). */
export function matrixToNexus(labels: readonly string[], values: readonly (readonly number[])[]): string {
  const name = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = labels.map((l, i) => `${name(l)} ${values[i].join(' ')}`);
  return `#NEXUS\nBEGIN TAXA;\n  DIMENSIONS NTAX=${labels.length};\n  TAXLABELS ${labels.map(name).join(' ')};\nEND;\nBEGIN DISTANCES;\n  DIMENSIONS NTAX=${labels.length};\n  FORMAT TRIANGLE=BOTH LABELS=LEFT;\n  MATRIX\n${rows.map((r) => '    ' + r).join('\n')}\n  ;\nEND;\n`;
}

// ── variants ────────────────────────────────────────────────────────────────

export const variantsMethod: AnalysisMethod = {
  id: 'variants',
  version: 1,
  title: 'Variants of the same chant',
  group: 'melody',
  summary: 'Groups chants that are witnesses of the same chant (by default the Cantus ID, else the text incipit) and measures how much their melodies differ: normalised edit distance between the interval sequences, per group and per pair. Answers: which chants vary most, and which witness deviates?',
  uses: ['melody', 'meta'],
  cost: 2,
  params: [
    { key: 'groupBy', label: 'Witnesses of the same chant by', type: 'field', help: 'The field that identifies the chant: Cantus ID where the corpus has one, else the text incipit.' },
    { key: 'minGroup', label: 'Witnesses per chant', type: 'number', min: 2, max: 50, help: 'Groups with fewer witnesses are skipped.' },
    { key: 'maxGroup', label: 'Largest group compared', type: 'number', min: 2, max: 60, help: 'Groups with more witnesses are cut to the first witnesses of this number (all pairs are compared).' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'Each table keeps this many rows.' },
  ],
  defaults: { groupBy: 'doc:textinitium', minGroup: 2, maxGroup: 30, rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues, io) {
    const all = groupAll(corpus, p['groupBy'] as string);
    const minGroup = p['minGroup'] as number;
    const maxGroup = p['maxGroup'] as number;
    const seqs = corpus.chants.map((c) => Int8Array.from(intervalsOf(c.pitches).map((v) => Math.max(-30, Math.min(30, v)))));
    const groupRows: Cell[][] = [];
    const groupDocs: string[][] = [];
    const pairRows: Cell[][] = [];
    const pairDocs: string[][] = [];
    const notes: string[] = [];
    let used = 0;
    let cut = 0;
    const order = all.labels.map((label, g) => ({ label, g })).filter((x) => x.label !== '(none)' && all.sizes[x.g] >= minGroup);
    order.forEach(({ label, g }, gi) => {
      if (gi % 20 === 0) io.progress(gi, order.length);
      let members: number[] = [];
      corpus.chants.forEach((_, d) => { if (all.of[d] === g && seqs[d].length > 0) members.push(d); });
      if (members.length < minGroup) return;
      if (members.length > maxGroup) { members = members.slice(0, maxGroup); cut++; }
      used += members.length;
      const m = members.length;
      const dist = Array.from({ length: m }, () => new Array<number>(m).fill(0));
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          const a = seqs[members[i]];
          const b = seqs[members[j]];
          const longest = Math.max(a.length, b.length);
          const d = longest === 0 ? 0 : editDistance(a, b, longest) / longest;
          dist[i][j] = d;
          dist[j][i] = d;
          pairRows.push([label, corpus.docs[members[i]].label, corpus.docs[members[j]].label, Math.round(d * 1000) / 1000]);
          pairDocs.push([corpus.docs[members[i]].id, corpus.docs[members[j]].id]);
        }
      }
      const pairValues: number[] = [];
      for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) pairValues.push(dist[i][j]);
      const rowMeans = dist.map((row, i) => mean(row.filter((_, j) => j !== i)));
      const worst = rowMeans.indexOf(Math.max(...rowMeans));
      groupRows.push([
        label, m, new Set(members.map((d) => corpus.docs[d].sigle)).size,
        Math.round(mean(pairValues) * 1000) / 1000, Math.round(Math.max(...pairValues) * 1000) / 1000,
        corpus.docs[members[worst]].label, Math.round(rowMeans[worst] * 1000) / 1000,
      ]);
      groupDocs.push(members.slice(0, 12).map((d) => corpus.docs[d].id));
    });
    const ranked = groupRows.map((r, i) => ({ r, d: groupDocs[i] })).sort((a, b) => (b.r[3] as number) - (a.r[3] as number));
    const rankedPairs = pairRows.map((r, i) => ({ r, d: pairDocs[i] })).sort((a, b) => (b.r[3] as number) - (a.r[3] as number));
    if (cut) notes.push(`${cut} groups had more than ${maxGroup} witnesses; only the first ${maxGroup} were compared.`);
    notes.push('Distance 0 means identical interval sequences, 1 means nothing in common. Chants without notes are skipped. The comparison is of the whole chants, not an alignment of parts.');
    return {
      summary: `${groupRows.length} chants with ≥ ${minGroup} witnesses (${used} documents compared).`,
      docCount: used,
      views: [
        makeTable({
          title: 'Chants by mean variation',
          columns: [
            { key: 'g', label: 'Chant (group value)' }, { key: 'w', label: 'Witnesses', numeric: true }, { key: 's', label: 'Sources', numeric: true },
            { key: 'mean', label: 'Mean distance', numeric: true }, { key: 'max', label: 'Largest distance', numeric: true },
            { key: 'dev', label: 'Most deviant witness' }, { key: 'devd', label: 'Its mean distance', numeric: true },
          ],
          rows: ranked.map((x) => x.r), rowDocs: ranked.map((x) => x.d), cap: p['rows'] as number,
        }),
        makeTable({
          title: 'Pairs of witnesses by distance',
          columns: [{ key: 'g', label: 'Chant' }, { key: 'a', label: 'Witness A' }, { key: 'b', label: 'Witness B' }, { key: 'd', label: 'Distance', numeric: true }],
          rows: rankedPairs.map((x) => x.r), rowDocs: rankedPairs.map((x) => x.d), cap: p['rows'] as number,
        }),
      ],
      notes,
    };
  },
};
