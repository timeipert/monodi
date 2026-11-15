/**
 * Methods from corpus linguistics: n-gram frequencies with their distribution over groups, keyness (what is typical of
 * one group against the rest) and collocations (which units attract each other).
 */
import { groupLabels } from '../corpus';
import type { Corpus } from '../corpus';
import { groupDocs, sampleDoc } from '../grouping';
import { logDice, logLikelihood, logRatio, pmi, tScore } from '../stats';
import { cellOfKey, forEachWindow, joinerOf, labelOfKey, MAX_DISTINCT, notationOfKey, tokenize, UNIT_OPTIONS } from '../tokens';
import type { Unit } from '../tokens';
import { segmentOfNotes } from '../segmentation';
import type { Segmentation } from '../segmentation';
import { DEFAULT_ROW_CAP, makeTable, ROW_DOC_CAP } from '../result';
import type { AnalysisMethod, Cell, ParamValues } from '../result';

const UNIT_PARAM = {
  key: 'unit', label: 'Unit', type: 'select' as const, options: UNIT_OPTIONS,
  help: 'What is counted: signed steps between notes, absolute pitches, the contour (up, repeat, down) or the words of the text.',
};

/** The length of the n-grams, as a range, and the option to count only inside one syllable, neume or word. */
const LENGTH_PARAMS = [
  {
    key: 'nFrom', label: 'n from', type: 'number' as const, min: 1, max: 12,
    help: 'n is the length of a pattern: how many units follow each other. With intervals, n = 3 means three steps in a row (four notes); with pitches, n = 3 means three notes; with words, three words. The shortest n counted.',
  },
  { key: 'nTo', label: 'n to', type: 'number' as const, min: 1, max: 12, help: 'The longest n counted. A range such as 2 to 5 counts patterns of every length in between in one table (column n).' },
  {
    key: 'within', label: 'Only inside one', type: 'select' as const,
    options: [
      { value: 'none', label: 'no limit (patterns may cross syllables)' },
      { value: 'syllable', label: 'syllable' },
      { value: 'neume', label: 'neume' },
      { value: 'word', label: 'word' },
    ],
    help: 'Count a melodic pattern only when all its notes lie inside one syllable, one neume or one word. Not used for word patterns.',
  },
];

/** The notes a window of `n` units starting at token `t` covers: for pitches the n notes, for steps the n + 1 notes. */
function windowNotes(unit: Unit, t: number, n: number): [number, number] {
  return [t, t + (unit === 'pitch' ? n - 1 : n)];
}

function capNote(overflow: boolean): string[] {
  return overflow
    ? ['More than 1,500,000 distinct n-grams occurred; later new n-grams were not counted. Raise the length or narrow the corpus.']
    : [];
}

// ── n-gram frequencies ──────────────────────────────────────────────────────

interface GramEntry { n: number; count: number; docs: number; last: number; byGroup: number[]; sample: string[] }

export const ngramsMethod: AnalysisMethod = {
  id: 'ngrams',
  version: 3,
  title: 'N-gram frequencies (patterns)',
  group: 'corpus',
  summary: 'Counts every run of n consecutive units (intervals, pitches, contour steps or words; n is chosen as a range, for example 3 to 5), optionally only inside one syllable, neume or word, with the number of chants it occurs in and its distribution over the groups of a field. Answers: which patterns recur, and where?',
  uses: ['melody', 'text', 'meta'],
  cost: 2,
  params: [
    UNIT_PARAM,
    ...LENGTH_PARAMS,
    { key: 'minCount', label: 'Minimum count', type: 'number', min: 1, max: 1000, help: 'Only n-grams that occur at least this often are listed.' },
    { key: 'minDocs', label: 'Minimum chants', type: 'number', min: 1, max: 1000, help: 'Only n-grams that occur in at least this many chants are listed.' },
    { key: 'groupBy', label: 'Distribution by', type: 'field', optional: true, help: 'Count each n-gram per value of this field (source, genre, a custom key). The largest 8 values get a column.' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'The table keeps this many rows, most frequent first.' },
  ],
  defaults: { unit: 'interval', nFrom: 3, nTo: 5, within: 'none', minCount: 5, minDocs: 2, groupBy: 'doc:gattung1', rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues, io) {
    const unit = p['unit'] as Unit;
    const nFrom = Math.min(p['nFrom'] as number, p['nTo'] as number);
    const nTo = Math.max(p['nFrom'] as number, p['nTo'] as number);
    const within = (unit === 'word' ? 'none' : p['within']) as 'none' | Segmentation;
    const joiner = joinerOf(unit);
    const grouping = groupDocs(corpus, p['groupBy'] as string, 8);
    const map = new Map<string, GramEntry>();
    const totals = new Map<number, number>();
    let total = 0;
    let overflow = false;
    corpus.chants.forEach((chant, d) => {
      if (d % 200 === 0) io.progress(d, corpus.chants.length);
      const g = grouping.of[d];
      const tokens = tokenize(chant, unit);
      const segOf = within === 'none' ? null : segmentOfNotes(chant, within);
      for (let n = nFrom; n <= nTo; n++) {
        forEachWindow(tokens, n, joiner, (key, t) => {
          if (segOf) {
            const [a, b] = windowNotes(unit, t, n);
            if (b >= segOf.length || segOf[a] < 0 || segOf[a] !== segOf[b]) return;
          }
          total++;
          totals.set(n, (totals.get(n) ?? 0) + 1);
          let e = map.get(key);
          if (!e) {
            if (map.size >= MAX_DISTINCT) { overflow = true; return; }
            e = { n, count: 0, docs: 0, last: -1, byGroup: new Array<number>(grouping.labels.length).fill(0), sample: [] };
            map.set(key, e);
          }
          e.count++;
          e.byGroup[g]++;
          if (e.last !== d) { e.last = d; e.docs++; sampleDoc(e.sample, corpus.docs[d].id, ROW_DOC_CAP); }
        });
      }
    });
    const minCount = p['minCount'] as number;
    const minDocs = p['minDocs'] as number;
    const kept = [...map.entries()].filter(([, e]) => e.count >= minCount && e.docs >= minDocs).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
    const showGroups = p['groupBy'] !== '' && grouping.labels.length > 1;
    const range = nFrom === nTo ? `${nFrom}-grams` : `${nFrom}- to ${nTo}-grams`;
    const columns = [
      { key: 'rank', label: '#', numeric: true },
      { key: 'gram', label: 'Pattern' },
      ...(nFrom === nTo ? [] : [{ key: 'n', label: 'n', numeric: true, help: 'Length of the pattern: the number of units that follow each other.' }]),
      { key: 'count', label: 'Count', numeric: true },
      { key: 'per10k', label: 'Per 10,000', numeric: true, help: 'Occurrences per 10,000 patterns of the same length in the whole corpus.' },
      { key: 'docs', label: 'Chants', numeric: true, help: 'Number of chants that contain it.' },
      ...(showGroups ? grouping.labels.map((l, i) => ({ key: `g${i}`, label: l, numeric: true })) : []),
    ];
    const rows: Cell[][] = kept.map(([key, e], i) => [
      i + 1, cellOfKey(unit, key), ...(nFrom === nTo ? [] : [e.n]), e.count,
      Math.round((e.count / (totals.get(e.n) || 1)) * 1e5) / 10, e.docs, ...(showGroups ? e.byGroup : []),
    ]);
    const rowDocs = kept.map(([, e]) => e.sample);
    const notes = capNote(overflow);
    if (within !== 'none') notes.push(`Only patterns inside one ${within} were counted.`);
    return {
      summary: `${range} of ${unit} over ${corpus.chants.length} chants: ${kept.length} with count ≥ ${minCount} in ≥ ${minDocs} chants (${total} patterns counted).`,
      docCount: corpus.chants.length,
      views: [
        { kind: 'bars', layout: 'rows', title: 'Most frequent patterns', items: kept.slice(0, 20).map(([key, e]) => ({ label: labelOfKey(unit, key), value: e.count, notation: notationOfKey(unit, key) })), unit: 'times' },
        makeTable({ title: 'Patterns', columns, rows, rowDocs, cap: p['rows'] as number }),
      ],
      notes,
    };
  },
};

// ── keyness ─────────────────────────────────────────────────────────────────

export const keynessMethod: AnalysisMethod = {
  id: 'keyness',
  version: 3,
  title: 'Keyness (what is typical of a group)',
  group: 'corpus',
  summary: 'Compares one group of chants with a reference (all other chants, or one other group) and lists the units that are unusually frequent in one of them, by log-likelihood (G2) and log ratio. Answers: what is characteristic of this source or genre?',
  uses: ['melody', 'text', 'meta'],
  cost: 2,
  params: [
    UNIT_PARAM,
    ...LENGTH_PARAMS,
    { key: 'groupBy', label: 'Compare by', type: 'field', help: 'The field that defines the groups.' },
    { key: 'target', label: 'Target value', type: 'text', placeholder: 'largest group', help: 'The value of the field to examine. Empty: the largest group.' },
    { key: 'reference', label: 'Reference value', type: 'text', placeholder: 'all other chants', help: 'The value to compare against. Empty: all chants outside the target.' },
    { key: 'minCount', label: 'Minimum total count', type: 'number', min: 1, max: 1000, help: 'Items with fewer occurrences in both groups together are not tested.' },
    { key: 'rows', label: 'Rows kept per side', type: 'number', min: 10, max: 2500, step: 10, help: 'The tables keep the strongest items of each side.' },
  ],
  defaults: { unit: 'interval', nFrom: 3, nTo: 3, within: 'none', groupBy: 'src:quellensigle', target: '', reference: '', minCount: 10, rows: 100 },
  run(corpus: Corpus, p: ParamValues, io) {
    const unit = p['unit'] as Unit;
    const nFrom = Math.min(p['nFrom'] as number, p['nTo'] as number);
    const nTo = Math.max(p['nFrom'] as number, p['nTo'] as number);
    const within = (unit === 'word' ? 'none' : p['within']) as 'none' | Segmentation;
    const joiner = joinerOf(unit);
    const labels = groupLabels(corpus, p['groupBy'] as string);
    const sizes = new Map<string, number>();
    for (const l of labels) sizes.set(l, (sizes.get(l) ?? 0) + 1);
    const largest = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const target = (p['target'] as string).trim() || largest;
    const reference = (p['reference'] as string).trim();
    const counts = new Map<string, [number, number]>();
    let n1 = 0;
    let n2 = 0;
    let docsT = 0;
    let docsR = 0;
    let overflow = false;
    corpus.chants.forEach((chant, d) => {
      if (d % 200 === 0) io.progress(d, corpus.chants.length);
      const side: 0 | 1 | -1 = labels[d] === target ? 0 : reference === '' || labels[d] === reference ? 1 : -1;
      if (side < 0) return;
      if (side === 0) docsT++; else docsR++;
      const tokens = tokenize(chant, unit);
      const segOf = within === 'none' ? null : segmentOfNotes(chant, within);
      for (let n = nFrom; n <= nTo; n++) {
        forEachWindow(tokens, n, joiner, (key, t) => {
          if (segOf) {
            const [a, b] = windowNotes(unit, t, n);
            if (b >= segOf.length || segOf[a] < 0 || segOf[a] !== segOf[b]) return;
          }
          if (side === 0) n1++; else n2++;
          let e = counts.get(key);
          if (!e) {
            if (counts.size >= MAX_DISTINCT) { overflow = true; return; }
            e = [0, 0];
            counts.set(key, e);
          }
          if (side === 0) e[0]++; else e[1]++;
        });
      }
    });
    const minCount = p['minCount'] as number;
    const rowsT: { key: string; a: number; b: number; g2: number; lr: number }[] = [];
    const rowsR: { key: string; a: number; b: number; g2: number; lr: number }[] = [];
    for (const [key, [a, b]] of counts) {
      if (a + b < minCount) continue;
      const g2 = logLikelihood(a, b, n1, n2);
      const lr = logRatio(a, b, n1, n2);
      (lr >= 0 ? rowsT : rowsR).push({ key, a, b, g2, lr });
    }
    const keep = p['rows'] as number;
    rowsT.sort((x, y) => y.g2 - x.g2);
    rowsR.sort((x, y) => y.g2 - x.g2);
    const columns = [
      { key: 'rank', label: '#', numeric: true },
      { key: 'item', label: 'Pattern' },
      { key: 'a', label: 'In target', numeric: true },
      { key: 'b', label: 'In reference', numeric: true },
      { key: 'ra', label: 'Target per 10,000', numeric: true },
      { key: 'rb', label: 'Reference per 10,000', numeric: true },
      { key: 'g2', label: 'G2', numeric: true, help: 'Log-likelihood. 3.84: p < 0.05, 6.63: p < 0.01, 10.83: p < 0.001 for one test; many items are tested, so treat these as a ranking, not as proof.' },
      { key: 'lr', label: 'Log ratio', numeric: true, help: 'Binary log of the ratio of relative frequencies: +1 means twice as frequent in the target, -1 half as frequent.' },
    ];
    const toRows = (list: typeof rowsT): Cell[][] =>
      list.map((r, i) => [
        i + 1, cellOfKey(unit, r.key), r.a, r.b,
        n1 ? Math.round((r.a / n1) * 1e5) / 10 : 0, n2 ? Math.round((r.b / n2) * 1e5) / 10 : 0,
        Math.round(r.g2 * 100) / 100, Math.round(r.lr * 100) / 100,
      ]);
    const notes = capNote(overflow);
    if (docsT === 0) notes.push(`The target value "${target}" matches no chant.`);
    if (docsR === 0) notes.push('The reference side is empty.');
    return {
      summary: `Keyness of "${target}" (${docsT} chants, ${n1} items) against ${reference ? `"${reference}"` : 'all other chants'} (${docsR} chants, ${n2} items), ${nFrom === nTo ? `${nFrom}` : `${nFrom} to ${nTo}`}-grams of ${unit}.`,
      docCount: docsT + docsR,
      views: [
        { kind: 'bars', layout: 'rows', title: `Most typical of "${target}" (G2)`, items: rowsT.slice(0, 15).map((r) => ({ label: labelOfKey(unit, r.key), value: Math.round(r.g2 * 10) / 10, notation: notationOfKey(unit, r.key) })) },
        makeTable({ title: `Overused in "${target}"`, columns, rows: toRows(rowsT), cap: keep }),
        { kind: 'bars', layout: 'rows', title: 'Most typical of the reference (G2)', items: rowsR.slice(0, 15).map((r) => ({ label: labelOfKey(unit, r.key), value: Math.round(r.g2 * 10) / 10, notation: notationOfKey(unit, r.key) })) },
        makeTable({ title: 'Overused in the reference', columns, rows: toRows(rowsR), cap: keep }),
      ],
      notes,
    };
  },
};

// ── collocations ────────────────────────────────────────────────────────────

/** A pair of units as one cell: two notes on a staff for pitches, the two words for text. */
function pairCell(unit: Unit, x: string, y: string): Cell {
  if (unit === 'word') return `${x} ${y}`;
  return cellOfKey('pitch', x + y);
}

export const collocationsMethod: AnalysisMethod = {
  id: 'collocations',
  version: 2,
  title: 'Collocations',
  group: 'corpus',
  summary: 'Finds pairs of units that occur near each other more often than chance (pitch pairs inside a window, or word pairs), scored by log-Dice, pointwise mutual information and t-score. Answers: which units belong together, beyond single frequency?',
  uses: ['melody', 'text'],
  cost: 2,
  params: [
    { key: 'unit', label: 'Unit', type: 'select', options: [{ value: 'pitch', label: 'Pitches' }, { value: 'word', label: 'Text words' }], help: 'Pitches (with octave) or words of the text.' },
    { key: 'window', label: 'Window', type: 'number', min: 1, max: 8, help: 'A pair is counted when the second unit follows the first within this many positions (1 = neighbours).' },
    { key: 'minCount', label: 'Minimum count', type: 'number', min: 2, max: 1000, help: 'Pairs seen fewer times are dropped.' },
    { key: 'measure', label: 'Sort by', type: 'select', options: [{ value: 'logdice', label: 'log-Dice' }, { value: 'pmi', label: 'PMI' }, { value: 'tscore', label: 't-score' }], help: 'log-Dice does not depend on corpus size; PMI favours rare pairs; t-score favours frequent ones.' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'The table keeps this many rows.' },
  ],
  defaults: { unit: 'pitch', window: 1, minCount: 10, measure: 'logdice', rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues, io) {
    const unit = p['unit'] as Unit;
    const win = p['window'] as number;
    // Marginals are counted over pairs: how often a unit is the first (left) or the second (right) of a counted pair.
    const left = new Map<string, number>();
    const right = new Map<string, number>();
    const pairs = new Map<string, number>();
    let nPairs = 0;
    let nTokens = 0;
    let overflow = false;
    corpus.chants.forEach((chant, d) => {
      if (d % 200 === 0) io.progress(d, corpus.chants.length);
      const tokens = tokenize(chant, unit);
      nTokens += tokens.length;
      for (let i = 0; i < tokens.length; i++) {
        for (let k = 1; k <= win && i + k < tokens.length; k++) {
          const key = tokens[i] + '\u0000' + tokens[i + k];
          const have = pairs.get(key);
          if (have === undefined) {
            if (pairs.size >= MAX_DISTINCT) { overflow = true; continue; }
            pairs.set(key, 1);
          } else pairs.set(key, have + 1);
          nPairs++;
          left.set(tokens[i], (left.get(tokens[i]) ?? 0) + 1);
          right.set(tokens[i + k], (right.get(tokens[i + k]) ?? 0) + 1);
        }
      }
    });
    const minCount = p['minCount'] as number;
    const scored: { x: string; y: string; f: number; fx: number; fy: number; dice: number; pm: number; t: number }[] = [];
    for (const [key, f] of pairs) {
      if (f < minCount) continue;
      const [x, y] = key.split('\u0000');
      const fx = left.get(x) ?? 0;
      const fy = right.get(y) ?? 0;
      scored.push({ x, y, f, fx, fy, dice: logDice(f, fx, fy), pm: pmi(f, fx, fy, nPairs), t: tScore(f, fx, fy, nPairs) });
    }
    const measure = p['measure'] as string;
    const by = (r: (typeof scored)[number]) => (measure === 'pmi' ? r.pm : measure === 'tscore' ? r.t : r.dice);
    scored.sort((a, b) => by(b) - by(a) || b.f - a.f);
    const rows: Cell[][] = scored.map((r, i) => [
      i + 1, pairCell(unit, r.x, r.y), r.f, r.fx, r.fy,
      Math.round(r.dice * 100) / 100, Math.round(r.pm * 100) / 100, Math.round(r.t * 100) / 100,
    ]);
    return {
      summary: `Collocations of ${unit} in a window of ${win}: ${scored.length} pairs with count ≥ ${minCount} (${nPairs} pairs counted over ${nTokens} units).`,
      docCount: corpus.chants.length,
      views: [
        makeTable({
          title: 'Collocations',
          columns: [
            { key: 'rank', label: '#', numeric: true },
            { key: 'pair', label: 'Pair' },
            { key: 'f', label: 'Pair count', numeric: true },
            { key: 'fx', label: 'As first', numeric: true, help: 'How often the first unit starts a counted pair.' },
            { key: 'fy', label: 'As second', numeric: true, help: 'How often the second unit ends a counted pair.' },
            { key: 'dice', label: 'log-Dice', numeric: true, help: '14 + log2(2 · pair / (first + second)); at most 14.' },
            { key: 'pmi', label: 'PMI', numeric: true, help: 'Bits above what chance would give for these two units.' },
            { key: 't', label: 't-score', numeric: true },
          ],
          rows, cap: p['rows'] as number,
        }),
      ],
      notes: capNote(overflow),
    };
  },
};
