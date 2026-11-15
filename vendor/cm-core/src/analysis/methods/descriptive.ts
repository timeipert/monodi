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
import type { AnalysisMethod, Cell, ParamValues, ResultView } from '../result';
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

// ── overview ────────────────────────────────────────────────────────────────

export const overviewMethod: AnalysisMethod = {
  id: 'overview',
  version: 2,
  title: 'Overview',
  group: 'overview',
  summary: 'Size and shape of the corpus: notes and syllables, pitch and interval distribution, chant lengths, the most frequent words, and one line per group. Answers: what does this corpus look like?',
  uses: ['melody', 'text', 'meta'],
  cost: 1,
  params: [
    { key: 'groupBy', label: 'Group by', type: 'field', optional: true, help: 'One summary row per value of this field.' },
    { key: 'words', label: 'Words listed', type: 'number', min: 0, max: 100, help: 'How many of the most frequent text words are listed (0 hides the list).' },
  ],
  defaults: { groupBy: 'src:quellensigle', words: 20 },
  run(corpus: Corpus, p: ParamValues) {
    const grouping = groupDocs(corpus, p['groupBy'] as string, 60);
    const pitchCounts: number[] = [];
    const allIntervals: number[] = [];
    const perSyllable: number[] = [];
    const lengths: number[] = [];
    const wordCounts = new Map<string, number>();
    let notes = 0;
    let syllables = 0;
    let accidentals = 0;
    let withoutNotes = 0;
    const perGroup = grouping.labels.map(() => ({ chants: 0, notes: 0, syllables: 0, low: Infinity, high: -Infinity }));
    corpus.chants.forEach((c, d) => {
      notes += c.pitches.length;
      syllables += c.sylLen.length;
      accidentals += c.accidentals;
      if (c.pitches.length === 0) withoutNotes++;
      lengths.push(c.pitches.length);
      for (const v of c.pitches) pitchCounts.push(v);
      for (const v of intervalsOf(c.pitches)) allIntervals.push(Math.max(-8, Math.min(8, v)));
      for (const l of c.sylLen) if (l > 0) perSyllable.push(Math.min(l, 12));
      for (const w of c.words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
      const g = perGroup[grouping.of[d]];
      g.chants++;
      g.notes += c.pitches.length;
      g.syllables += c.sylLen.length;
      for (const v of c.pitches) { if (v < g.low) g.low = v; if (v > g.high) g.high = v; }
    });
    const lenBuckets = new Map<string, number>();
    const edges = [0, 1, 50, 100, 200, 300, 500, 800, 1200];
    for (const l of lengths) {
      let b = 0;
      while (b + 1 < edges.length && l >= edges[b + 1]) b++;
      const label = l === 0 ? 'no notes' : b + 1 < edges.length ? `${edges[b]}–${edges[b + 1] - 1}` : `${edges[b]}+`;
      lenBuckets.set(label, (lenBuckets.get(label) ?? 0) + 1);
    }
    const lenOrder = ['no notes', ...edges.slice(1).map((e, i) => (i + 2 < edges.length ? `${e}–${edges[i + 2] - 1}` : `${e}+`))];
    const wordLimit = p['words'] as number;
    const topWords = [...wordCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, wordLimit);
    const views: ResultView[] = [
      {
        kind: 'table', title: 'Corpus', totalRows: 6, truncated: false,
        columns: [{ key: 'k', label: 'Measure' }, { key: 'v', label: 'Value', numeric: true }],
        rows: [
          ['Chants', corpus.chants.length], ['Chants without notes', withoutNotes], ['Syllables', syllables], ['Notes', notes],
          ['Notes per chant (mean)', corpus.chants.length ? Math.round((notes / corpus.chants.length) * 10) / 10 : 0],
          ['Accidental signs skipped', accidentals],
        ],
      },
      { kind: 'bars', layout: 'columns', title: 'Pitch distribution', items: histogram(pitchCounts, pitchLabel), unit: 'notes' },
      { kind: 'bars', layout: 'columns', title: 'Intervals (steps, capped at ±8)', items: histogram(allIntervals, intervalLabel), unit: 'intervals' },
      { kind: 'bars', layout: 'columns', title: 'Notes per syllable (capped at 12)', items: histogram(perSyllable, (v) => String(v)), unit: 'syllables' },
      { kind: 'bars', layout: 'columns', title: 'Chant length in notes', items: lenOrder.filter((l) => lenBuckets.has(l)).map((l) => ({ label: l, value: lenBuckets.get(l)! })), unit: 'chants' },
    ];
    if (p['groupBy'] !== '' && grouping.labels.length > 1) {
      views.push(makeTable({
        title: 'Groups',
        columns: [
          { key: 'g', label: 'Group' }, { key: 'c', label: 'Chants', numeric: true }, { key: 'n', label: 'Notes', numeric: true },
          { key: 's', label: 'Syllables', numeric: true }, { key: 'm', label: 'Notes per syllable', numeric: true },
          { key: 'range', label: 'Range', help: 'Lowest and highest note of the group.' },
        ],
        rows: perGroup.map((g, i): Cell[] => [
          grouping.labels[i], g.chants, g.notes, g.syllables, g.syllables ? Math.round((g.notes / g.syllables) * 100) / 100 : 0,
          g.low === Infinity ? null : pitchNotation([g.low, g.high]),
        ]),
      }));
    }
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

