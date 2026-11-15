/**
 * Descriptive methods: an overview of a corpus, and the tonal profile (ambitus, final, tenor, mode) of each chant and
 * each group.
 */
import { intervalLabel, pitchLabel, stepOf } from '../corpus';
import { pitchNotation } from '../notation';
import type { Corpus } from '../corpus';
import { groupDocs } from '../grouping';
import { intervalsOf } from '../features';
import { DEFAULT_ROW_CAP, makeTable } from '../result';
import type { AnalysisMethod, BarsView, Cell, FigureView, ParamValues, ResultView } from '../result';
import { mean } from '../stats';

/** Lowest and highest value of a non-empty list (a loop, so very long chants cannot overflow the argument stack). */
function minMax(values: readonly number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

function histogram(values: number[], label: (v: number) => string, order?: (a: number, b: number) => number): { label: string; value: number }[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => (order ? order(a[0], b[0]) : a[0] - b[0])).map(([v, c]) => ({ label: label(v), value: c }));
}

function bump(m: Map<number, number>, key: number): void { m.set(key, (m.get(key) ?? 0) + 1); }

/**
 * A histogram over an ordered integer axis, with the counts of each shown group as `series`. The axis has no gaps between its
 * lowest and highest value (an empty pitch or interval is a gap in the data, and a figure must show it as one).
 */
function columnsOf(
  title: string, unit: string, all: Map<number, number>, perGroup: { name: string; n: number; counts: Map<number, number> }[] | null,
  label: (v: number) => string,
): BarsView {
  const keys = [...all.keys()].sort((a, b) => a - b);
  const axis: number[] = [];
  if (keys.length) for (let k = keys[0]; k <= keys[keys.length - 1]; k++) axis.push(k);
  return {
    kind: 'bars', layout: 'columns', title, unit,
    items: axis.map((k) => ({ label: label(k), value: all.get(k) ?? 0 })),
    ...(perGroup ? { series: perGroup.map((g) => ({ name: g.name, n: g.n, values: axis.map((k) => g.counts.get(k) ?? 0) })) } : {}),
  };
}

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// ── overview ────────────────────────────────────────────────────────────────

export const overviewMethod: AnalysisMethod = {
  id: 'overview',
  version: 3,
  title: 'Overview',
  group: 'overview',
  summary: 'Size and shape of the corpus as a publication figure: chant lengths, pitch and interval distribution and notes per syllable (one panel per group, or side by side), with a caption, a description table and the most frequent words. Answers: what does this corpus look like?',
  uses: ['melody', 'text', 'meta'],
  cost: 1,
  params: [
    { key: 'groupBy', label: 'Group by', type: 'field', optional: true, help: 'One summary row and one panel per value of this field.' },
    { key: 'groupsShown', label: 'Groups in the figure', type: 'number', min: 1, max: 8, help: 'The largest groups that get their own panel or bars in the figure (1 draws the whole corpus as one). The table lists all groups.' },
    { key: 'words', label: 'Words listed', type: 'number', min: 0, max: 100, help: 'How many of the most frequent text words are listed (0 hides the list).' },
  ],
  defaults: { groupBy: 'src:quellensigle', groupsShown: 4, words: 20 },
  run(corpus: Corpus, p: ParamValues) {
    const grouping = groupDocs(corpus, p['groupBy'] as string, 60);
    const G = grouping.labels.length;
    const pitchAll = new Map<number, number>();
    const intervalAll = new Map<number, number>();
    const perSyllableAll = new Map<number, number>();
    const lengthAll = new Map<number, number>();
    const perG = grouping.labels.map(() => ({ pitch: new Map<number, number>(), interval: new Map<number, number>(), perSyllable: new Map<number, number>(), length: new Map<number, number>(), lengths: [] as number[] }));
    const wordCounts = new Map<string, number>();
    let notes = 0;
    let syllables = 0;
    let accidentals = 0;
    let withoutNotes = 0;
    const edges = [0, 1, 50, 100, 200, 300, 500, 800, 1200];
    const lenLabels = ['no notes', ...edges.slice(1).map((e, i) => (i + 2 < edges.length ? `${e}–${edges[i + 2] - 1}` : `${e}+`))];
    const perGroup = grouping.labels.map(() => ({ chants: 0, notes: 0, syllables: 0, low: Infinity, high: -Infinity }));
    corpus.chants.forEach((c, d) => {
      const gi = grouping.of[d];
      const mine = perG[gi];
      notes += c.pitches.length;
      syllables += c.sylLen.length;
      accidentals += c.accidentals;
      if (c.pitches.length === 0) withoutNotes++;
      let bucket = 0;
      while (bucket + 1 < edges.length && c.pitches.length >= edges[bucket + 1]) bucket++;
      bump(lengthAll, bucket); bump(mine.length, bucket);
      mine.lengths.push(c.pitches.length);
      for (const v of c.pitches) { bump(pitchAll, v); bump(mine.pitch, v); }
      for (const v of intervalsOf(c.pitches)) { const k = Math.max(-8, Math.min(8, v)); bump(intervalAll, k); bump(mine.interval, k); }
      for (const l of c.sylLen) if (l > 0) { const k = Math.min(l, 12); bump(perSyllableAll, k); bump(mine.perSyllable, k); }
      for (const w of c.words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
      const g = perGroup[gi];
      g.chants++;
      g.notes += c.pitches.length;
      g.syllables += c.sylLen.length;
      for (const v of c.pitches) { if (v < g.low) g.low = v; if (v > g.high) g.high = v; }
    });
    const wordLimit = p['words'] as number;
    const topWords = [...wordCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, wordLimit);

    // The figure: panels (a) to (d), with one series per shown group when the corpus has groups.
    const shown = Math.min(G, Math.max(1, Math.round(p['groupsShown'] as number)));
    const useGroups = G > 1 && shown > 1;
    const sel = (pick: (g: (typeof perG)[number]) => Map<number, number>) =>
      (useGroups ? Array.from({ length: shown }, (_, i) => ({ name: grouping.labels[i], n: grouping.sizes[i], counts: pick(perG[i]) })) : null);
    const lengthPanel = columnsOf('Chant length in notes', 'chants', lengthAll, sel((g) => g.length), (k) => lenLabels[k]);
    // The length axis lists only buckets that occur, from the first to the last; the unit of the axis is chants.
    const panels: BarsView[] = [
      lengthPanel,
      columnsOf('Pitch distribution', 'notes', pitchAll, sel((g) => g.pitch), pitchLabel),
      columnsOf('Intervals between consecutive notes (steps, capped at ±8)', 'intervals', intervalAll, sel((g) => g.interval), intervalLabel),
      columnsOf('Notes per syllable (capped at 12)', 'syllables', perSyllableAll, sel((g) => g.perSyllable), (k) => String(k)),
    ].filter((v) => v.items.length > 0);
    const letter = (title: string): string => `(${String.fromCharCode(97 + panels.findIndex((v) => v.title === title))})`;
    const omitted = useGroups ? G - shown : 0;
    const groupList = useGroups ? Array.from({ length: shown }, (_, i) => `${grouping.labels[i]} (n = ${grouping.sizes[i]})`).join(', ') : '';
    const caption =
      `Figure 1. Overview of the corpus: ${corpus.chants.length} chants with ${notes} notes on ${syllables} syllables. ` +
      panels.map((v) => `${letter(v.title)} ${v.title.replace(/ \(.*\)$/, '')}`).join('; ') + '. ' +
      (useGroups ? `Groups, with n the number of chants: ${groupList}${omitted ? `; ${omitted} smaller group${omitted === 1 ? '' : 's'} not shown` : ''}. ` : '') +
      `Pitches are named by letter and octave of the Monodi data model (the octave starts at C); intervals are counted in diatonic steps. ` +
      `Only the first voice is read, latent notes and accidental signs are not counted as notes.`;
    const figure: FigureView = { kind: 'figure', title: 'Figure 1: corpus overview', panels, caption };

    const rows: Cell[][] = perGroup.map((g, i): Cell[] => [
      grouping.labels[i], g.chants, g.notes, g.syllables, g.syllables ? Math.round((g.notes / g.syllables) * 100) / 100 : 0,
      Math.round(median([...perG[i].lengths].sort((a, b) => a - b)) * 10) / 10, g.low === Infinity ? null : pitchNotation([g.low, g.high]),
    ]);
    if (G > 1) {
      const all = [...corpus.chants.map((c) => c.pitches.length)].sort((a, b) => a - b);
      let lo = Infinity; let hi = -Infinity;
      for (const g of perGroup) { if (g.low < lo) lo = g.low; if (g.high > hi) hi = g.high; }
      rows.push(['All', corpus.chants.length, notes, syllables, syllables ? Math.round((notes / syllables) * 100) / 100 : 0, Math.round(median(all) * 10) / 10, lo === Infinity ? null : pitchNotation([lo, hi])]);
    }
    const views: ResultView[] = [
      figure,
      makeTable({
        title: 'Table 1: description of the corpus',
        columns: [
          { key: 'g', label: p['groupBy'] === '' ? 'Corpus' : 'Group' }, { key: 'c', label: 'Chants', numeric: true }, { key: 'n', label: 'Notes', numeric: true },
          { key: 's', label: 'Syllables', numeric: true }, { key: 'm', label: 'Notes per syllable', numeric: true },
          { key: 'med', label: 'Median notes per chant', numeric: true },
          { key: 'range', label: 'Range', help: 'Lowest and highest note of the group.' },
        ],
        rows,
      }),
      {
        kind: 'table', title: 'Corpus', totalRows: 6, truncated: false,
        columns: [{ key: 'k', label: 'Measure' }, { key: 'v', label: 'Value', numeric: true }],
        rows: [
          ['Chants', corpus.chants.length], ['Chants without notes', withoutNotes], ['Syllables', syllables], ['Notes', notes],
          ['Notes per chant (mean)', corpus.chants.length ? Math.round((notes / corpus.chants.length) * 10) / 10 : 0],
          ['Accidental signs skipped', accidentals],
        ],
      },
    ];
    if (topWords.length) views.push({ kind: 'bars', layout: 'rows', title: 'Most frequent words', items: topWords.map(([w, c]) => ({ label: w, value: c })), unit: 'times' });
    return {
      summary: `${corpus.chants.length} chants, ${syllables} syllables, ${notes} notes.`,
      docCount: corpus.chants.length,
      views,
      notes: accidentals ? [`${accidentals} accidental signs (flat, sharp, natural) were not counted as notes.`] : [],
    };
  },
};

// ── tonal profile ───────────────────────────────────────────────────────────

/**
 * Expected distance in steps (modulo 7) from the final to the tenor (reciting tone) of the eight modes, with the
 * final as step number (0 = C … 6 = B). Mode 3 uses C, the later tradition (the earlier one has B).
 */
const MODES: { mode: number; final: number; tenorDelta: number }[] = [
  { mode: 1, final: 1, tenorDelta: 4 }, { mode: 2, final: 1, tenorDelta: 2 },
  { mode: 3, final: 2, tenorDelta: 5 }, { mode: 4, final: 2, tenorDelta: 3 },
  { mode: 5, final: 3, tenorDelta: 4 }, { mode: 6, final: 3, tenorDelta: 2 },
  { mode: 7, final: 4, tenorDelta: 4 }, { mode: 8, final: 4, tenorDelta: 3 },
];

export interface ModeEstimate {
  /** 1–8, or null when the final is not D, E, F or G. */
  mode: number | null;
  /** `high`: range and tenor agree; `medium`: only one of them decides; `low`: they disagree (the range decides). */
  confidence: 'high' | 'medium' | 'low' | null;
  final: number | null;
  tenor: number | null;
}

/** The most frequent pitch of a chant; on a tie the one reached first. */
export function tenorOf(pitches: readonly number[]): number | null {
  const counts = new Map<number, number>();
  let best: number | null = null;
  let bestCount = 0;
  for (const v of pitches) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

/**
 * Estimate the church mode of a chant from its last note (the final), the position of the melody relative to the final
 * (authentic modes lie above the final, plagal modes reach below it) and the most frequent pitch (the tenor).
 * A heuristic for orientation, not a classification: chants that end elsewhere or recite on another tone are
 * marked `low` or get no mode.
 */
export function estimateMode(pitches: readonly number[]): ModeEstimate {
  if (pitches.length === 0) return { mode: null, confidence: null, final: null, tenor: null };
  const final = pitches[pitches.length - 1];
  const tenor = tenorOf(pitches);
  const candidates = MODES.filter((m) => m.final === stepOf(final));
  if (candidates.length === 0) return { mode: null, confidence: null, final, tenor };
  const authentic = candidates.find((m) => m.mode % 2 === 1)!;
  const plagal = candidates.find((m) => m.mode % 2 === 0)!;
  const byRange = mean(pitches) - final >= 2 ? authentic : plagal;
  const tenorDelta = tenor === null ? -1 : (((tenor - final) % 7) + 7) % 7;
  const matches = [authentic, plagal].filter((m) => m.tenorDelta === tenorDelta);
  if (matches.length === 1) {
    return { mode: byRange.mode, confidence: matches[0].mode === byRange.mode ? 'high' : 'low', final, tenor };
  }
  return { mode: byRange.mode, confidence: 'medium', final, tenor };
}

export const tonalProfileMethod: AnalysisMethod = {
  id: 'tonal-profile',
  version: 2,
  title: 'Tonal profile and mode estimate',
  group: 'melody',
  summary: 'Per chant and per group: lowest and highest note (ambitus), final (last note), most frequent note (tenor), share of steps and leaps, and an estimated mode (1–8) from final, range and tenor. Answers: which modes and ranges does the corpus use?',
  uses: ['melody', 'meta'],
  cost: 1,
  params: [
    { key: 'groupBy', label: 'Group by', type: 'field', optional: true, help: 'One summary row per value of this field.' },
    { key: 'rows', label: 'Chant rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'The per-chant table keeps this many rows.' },
  ],
  defaults: { groupBy: 'src:quellensigle', rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues) {
    const grouping = groupDocs(corpus, p['groupBy'] as string, 60);
    const modeCounts = grouping.labels.map(() => new Array<number>(9).fill(0));
    const stats = grouping.labels.map(() => ({ chants: 0, span: 0, steps: 0, repeats: 0, leaps: 0 }));
    const overallModes = new Array<number>(9).fill(0);
    const allIntervals: number[] = [];
    const rows: Cell[][] = [];
    const rowDocs: string[][] = [];
    let skipped = 0;
    let agree = 0;
    let compared = 0;
    corpus.chants.forEach((c, d) => {
      if (c.pitches.length === 0) { skipped++; return; }
      const [low, high] = minMax(c.pitches);
      const est = estimateMode(c.pitches);
      const iv = intervalsOf(c.pitches);
      let steps = 0; let repeats = 0; let leaps = 0;
      for (const v of iv) { const a = Math.abs(v); if (a === 0) repeats++; else if (a === 1) steps++; else leaps++; }
      for (const v of iv) allIntervals.push(Math.max(-8, Math.min(8, v)));
      const g = grouping.of[d];
      const s = stats[g];
      s.chants++; s.span += high - low; s.steps += steps; s.repeats += repeats; s.leaps += leaps;
      modeCounts[g][est.mode ?? 0]++;
      overallModes[est.mode ?? 0]++;
      const given = corpus.docs[d].fields['custom:mode']?.trim();
      const givenCell: Cell = given || null;
      if (given && /^[1-8]$/.test(given) && est.mode !== null) { compared++; if (Number(given) === est.mode) agree++; }
      rows.push([
        corpus.docs[d].label, corpus.docs[d].sigle, c.pitches.length, pitchNotation([low, high]), high - low + 1,
        est.final === null ? null : pitchNotation([est.final]), est.tenor === null ? null : pitchNotation([est.tenor]),
        est.mode, est.confidence, givenCell,
      ]);
      rowDocs.push([corpus.docs[d].id]);
    });
    const total = (i: number) => stats[i].steps + stats[i].repeats + stats[i].leaps;
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const groupRows: Cell[][] = grouping.labels.map((label, i) => [
      label, stats[i].chants, stats[i].chants ? Math.round((stats[i].span / stats[i].chants + 1) * 10) / 10 : 0,
      pct(stats[i].steps, total(i)), pct(stats[i].repeats, total(i)), pct(stats[i].leaps, total(i)),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((m) => modeCounts[i][m]), modeCounts[i][0],
    ]);
    const notes = [
      'Mode estimate: heuristic from the last note, the position of the melody relative to it and the most frequent note. Chants that end on A, B or C, or that are not in the eight-mode system, get no mode or a low confidence.',
    ];
    if (skipped) notes.push(`${skipped} chants without notes were skipped.`);
    if (compared) notes.push(`Of ${compared} chants with a stored mode (custom field), the estimate agrees on ${agree} (${pct(agree, compared)}%).`);
    return {
      summary: `Tonal profile of ${corpus.chants.length - skipped} chants; mode estimated for ${corpus.chants.length - skipped - overallModes[0]}.`,
      docCount: corpus.chants.length - skipped,
      views: [
        { kind: 'bars', layout: 'columns', title: 'Estimated modes', items: [1, 2, 3, 4, 5, 6, 7, 8].map((m) => ({ label: `Mode ${m}`, value: overallModes[m] })).concat([{ label: 'none', value: overallModes[0] }]), unit: 'chants' },
        { kind: 'bars', layout: 'columns', title: 'Intervals (steps, capped at ±8)', items: histogram(allIntervals, intervalLabel), unit: 'intervals' },
        makeTable({
          title: 'Groups',
          columns: [
            { key: 'g', label: 'Group' }, { key: 'c', label: 'Chants', numeric: true }, { key: 'span', label: 'Mean ambitus (notes)', numeric: true, help: 'Mean number of scale steps from the lowest to the highest note, both counted.' },
            { key: 'st', label: 'Steps %', numeric: true }, { key: 'rp', label: 'Repeats %', numeric: true }, { key: 'lp', label: 'Leaps %', numeric: true },
            ...[1, 2, 3, 4, 5, 6, 7, 8].map((m) => ({ key: `m${m}`, label: `Mode ${m}`, numeric: true })), { key: 'm0', label: 'No mode', numeric: true },
          ],
          rows: groupRows,
        }),
        makeTable({
          title: 'Chants',
          columns: [
            { key: 'l', label: 'Chant' }, { key: 's', label: 'Source' }, { key: 'n', label: 'Notes', numeric: true },
            { key: 'range', label: 'Range', help: 'Lowest and highest note.' }, { key: 'sp', label: 'Ambitus', numeric: true },
            { key: 'f', label: 'Final' }, { key: 't', label: 'Tenor' }, { key: 'm', label: 'Mode', numeric: true },
            { key: 'c', label: 'Confidence' }, { key: 'g', label: 'Mode in data', help: 'The value of the custom field "mode", where the import supplied one.' },
          ],
          rows, rowDocs, cap: p['rows'] as number,
        }),
      ],
      notes,
    };
  },
};

