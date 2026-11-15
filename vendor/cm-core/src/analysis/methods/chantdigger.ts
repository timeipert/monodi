/**
 * The methods of ChantDigger (Max Haas, 2014) rebuilt for Monodi-Zero: syllable segments with similarity criteria,
 * bridges between segments (before / nucleus / after), shared segment models, chants of equal syllable count, and the
 * axis (the most frequent notes) of a chant. See `segments.ts` for the vocabulary. ChantDigger asks for a corpus and a
 * genre; here every method takes the corpus of the analysis and an optional field to distribute the counts by.
 */
import { pitchLabel } from '../corpus';
import { pitchNotation } from '../notation';
import type { Corpus } from '../corpus';
import { groupDocs, sampleDoc } from '../grouping';
import { buildSegmentIndex, criterionKey, CRITERION_OPTIONS, findSegmentSequence } from '../segments';
import { describeSegmentation, SEGMENTATION_OPTIONS } from '../segmentation';
import type { Segmentation } from '../segmentation';
import { noteSyllableIndex } from '../features';
import type { Criterion } from '../segments';
import { DEFAULT_ROW_CAP, makeTable, ROW_DOC_CAP } from '../result';
import type { AnalysisMethod, Cell, ParamValues, ResultView } from '../result';

const GROUP_PARAM = {
  key: 'groupBy', label: 'Distribution by', type: 'field' as const, optional: true,
  help: 'Counts are split by the value of this field (ChantDigger used the genre). The largest values get a column.',
};

/** The cut that defines a "segment": ChantDigger cuts by syllable; neumes, words and groups of n notes are the alternatives. */
const SEGMENTATION_PARAMS = [
  {
    key: 'segmentation', label: 'A segment is', type: 'select' as const, options: SEGMENTATION_OPTIONS,
    help: 'How every chant is cut into segments before anything is counted. ChantDigger cuts by syllable; a neume is the notes written without a gap; a word segment spans all syllables of a word; "groups of n notes" ignores text and neumes.',
  },
  {
    key: 'segmentN', label: 'Notes per group', type: 'number' as const, min: 2, max: 12,
    help: 'Only for "groups of n notes": how many notes make one segment (the last group of a chant may be shorter).',
  },
];

function segmentationOf(p: ParamValues): { how: Segmentation; n: number; name: string } {
  const how = p['segmentation'] as Segmentation;
  const n = p['segmentN'] as number;
  return { how, n, name: describeSegmentation(how, n) };
}

function notesLabel(p: readonly number[], max = 16): string {
  const text = p.slice(0, max).map(pitchLabel).join(' ');
  return p.length > max ? `${text} …` : text;
}

// ── segments ────────────────────────────────────────────────────────────────

function classLabel(c: Criterion, key: string): string {
  if (c === 'points') return key.split(',').map((v, i) => `${['first', 'last', 'high', 'low'][i]} ${pitchLabel(Number(v))}`).join(', ');
  return key === '' ? '(single note)' : key.split(',').map((v) => (Number(v) > 0 ? `+${v}` : v)).join(' ');
}

export const segmentsMethod: AnalysisMethod = {
  id: 'segments',
  version: 3,
  title: 'Segments (ChantDigger SM2)',
  group: 'chantdigger',
  summary: 'Cuts every chant into segments (by syllable as in ChantDigger, or by neume, word or groups of n notes), lists the distinct segments with their frequency and distribution, groups similar segments by one of four ChantDigger criteria, and finds a sequence of segments in the chants. Answers: which segments are shared or similar?',
  uses: ['melody', 'text', 'meta'],
  cost: 2,
  params: [
    ...SEGMENTATION_PARAMS,
    { key: 'criterion', label: 'Similar when', type: 'select', options: CRITERION_OPTIONS, help: 'The criterion that puts segments into one class. "Identical notes" lists each segment alone.' },
    { key: 'minCount', label: 'Minimum count', type: 'number', min: 1, max: 1000, help: 'Segments (or classes) that occur fewer times are not listed.' },
    { key: 'minLength', label: 'Minimum length (notes)', type: 'number', min: 1, max: 40, help: 'Segments with fewer notes are skipped. Long segments are melismas.' },
    GROUP_PARAM,
    { key: 'sequence', label: 'Segment sequence', type: 'text', placeholder: 'e.g. 12 40 7', help: 'Optional. Segment ids (numbers from the table of this result) separated by spaces; lists the chants where these segments follow each other. Run once without it to see the ids.' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'Each table keeps this many rows.' },
  ],
  defaults: { segmentation: 'syllable', segmentN: 3, criterion: 'exact', minCount: 5, minLength: 1, groupBy: 'doc:gattung1', sequence: '', rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues, io) {
    const criterion = p['criterion'] as Criterion;
    const minCount = p['minCount'] as number;
    const minLength = p['minLength'] as number;
    const cut = segmentationOf(p);
    const idx = buildSegmentIndex(corpus.chants, cut.how, cut.n);
    const grouping = groupDocs(corpus, p['groupBy'] as string, 6);
    const showGroups = p['groupBy'] !== '' && grouping.labels.length > 1;
    const G = grouping.labels.length;
    const byGroup = new Uint32Array(idx.segments.length * G);
    idx.chantSegments.forEach((ids, d) => { for (const id of ids) byGroup[id * G + grouping.of[d]]++; });
    io.progress(1, 4);

    // Similarity classes.
    const classOf = new Map<string, number[]>();
    const segClass: string[] = new Array<string>(idx.segments.length);
    for (const s of idx.segments) {
      const key = criterion === 'exact' ? String(s.id) : criterionKey(criterion, s.pitches);
      segClass[s.id] = key;
      const list = classOf.get(key);
      if (list) list.push(s.id); else classOf.set(key, [s.id]);
    }

    const kept = idx.segments.filter((s) => s.count >= minCount && s.pitches.length >= minLength).sort((a, b) => b.count - a.count || a.id - b.id);
    const samples = new Map<number, string[]>();
    const wanted = new Set(kept.slice(0, 5000).map((s) => s.id));
    idx.chantSegments.forEach((ids, d) => {
      for (const id of ids) {
        if (!wanted.has(id)) continue;
        let list = samples.get(id);
        if (!list) { list = []; samples.set(id, list); }
        sampleDoc(list, corpus.docs[d].id, ROW_DOC_CAP);
      }
    });
    const segRows: Cell[][] = kept.map((s) => [
      s.id, pitchNotation(s.pitches), s.pitches.length, s.count, s.docs,
      ...(criterion === 'exact' ? [] : [classOf.get(segClass[s.id])!.length]),
      ...(showGroups ? Array.from({ length: G }, (_, g) => byGroup[s.id * G + g]) : []),
    ]);
    const views: ResultView[] = [
      makeTable({
        title: 'Segments',
        columns: [
          { key: 'id', label: 'Segment id', numeric: true, help: 'Numbered in order of first occurrence in this corpus; valid only for this result.' },
          { key: 'notes', label: 'Notes' }, { key: 'len', label: 'Length', numeric: true },
          { key: 'count', label: 'Count', numeric: true }, { key: 'docs', label: 'Chants', numeric: true },
          ...(criterion === 'exact' ? [] : [{ key: 'class', label: 'In class of', numeric: true, help: 'How many distinct segments are similar to this one under the chosen criterion.' }]),
          ...(showGroups ? grouping.labels.map((l, i) => ({ key: `g${i}`, label: l, numeric: true })) : []),
        ],
        rows: segRows, rowDocs: kept.map((s) => samples.get(s.id) ?? null), cap: p['rows'] as number,
      }),
    ];

    if (criterion !== 'exact') {
      const classDocs = new Map<string, number>();
      idx.chantSegments.forEach((ids) => {
        const seen = new Set<string>();
        for (const id of ids) seen.add(segClass[id]);
        for (const k of seen) classDocs.set(k, (classDocs.get(k) ?? 0) + 1);
      });
      const classes = [...classOf.entries()]
        .map(([key, members]) => ({ key, members, count: members.reduce((s, id) => s + idx.segments[id].count, 0) }))
        .filter((c) => c.count >= minCount && c.members.length >= 2)
        .sort((a, b) => b.count - a.count || b.members.length - a.members.length);
      views.push(makeTable({
        title: 'Similarity classes (two or more distinct segments)',
        columns: [
          { key: 'v', label: 'Shared vector' }, { key: 'n', label: 'Distinct segments', numeric: true },
          { key: 'c', label: 'Occurrences', numeric: true }, { key: 'd', label: 'Chants', numeric: true }, { key: 'm', label: 'Members (id: notes)' },
        ],
        rows: classes.map((c): Cell[] => [
          classLabel(criterion, c.key), c.members.length, c.count, classDocs.get(c.key) ?? 0,
          c.members.slice(0, 4).map((id) => `${id}: ${notesLabel(idx.segments[id].pitches, 8)}`).join(' | ') + (c.members.length > 4 ? ' …' : ''),
        ]),
        cap: p['rows'] as number,
      }));
    }

    const notes: string[] = [`Segments are cut as: ${cut.name}. Segment ids are numbered in order of first occurrence in this corpus and are valid only for this result.`];
    const seqText = (p['sequence'] as string).trim();
    if (seqText) {
      const query = seqText.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
      const rows: Cell[][] = [];
      const docs: string[][] = [];
      idx.chantSegments.forEach((ids, d) => {
        const at = findSegmentSequence(ids, query);
        if (at.length === 0) return;
        const c = corpus.chants[d];
        const sylOf = noteSyllableIndex(c);
        const first = sylOf[idx.chantSpans[d][at[0]].start];
        const last = sylOf[idx.chantSpans[d][at[0] + query.length - 1].end - 1];
        rows.push([corpus.docs[d].label, corpus.docs[d].sigle, at.length, at[0] + 1, c.sylText.slice(first, last + 1).join(' ').trim()]);
        docs.push([corpus.docs[d].id]);
      });
      views.push(makeTable({
        title: `Chants containing the segment sequence ${query.join(' ')}`,
        columns: [{ key: 'l', label: 'Chant' }, { key: 's', label: 'Source' }, { key: 'n', label: 'Times', numeric: true }, { key: 'p', label: 'First at segment', numeric: true }, { key: 't', label: 'Text there' }],
        rows, rowDocs: docs, cap: p['rows'] as number,
      }));
      if (rows.length === 0) notes.push('No chant contains the given segment sequence as consecutive segments.');
    }
    return {
      summary: `${idx.segments.length} distinct ${cut.name} over ${corpus.chants.length} chants; ${kept.length} with count ≥ ${minCount} and length ≥ ${minLength}.`,
      docCount: corpus.chants.length,
      views,
      notes,
    };
  },
};

// ── bridges (before / nucleus / after) ──────────────────────────────────────

export const bridgesMethod: AnalysisMethod = {
  id: 'bridges',
  version: 3,
  title: 'Bridges (ChantDigger SM4)',
  group: 'chantdigger',
  summary: 'Looks at three consecutive segments, Before (B), Nucleus (N) and After (A), where N is long. A bridge is a pair (B, A) that occurs with several different nuclei: the same opening and the same closing segment with a different melisma between. Answers: which fixed segments frame a varying melisma?',
  uses: ['melody', 'text'],
  cost: 2,
  params: [
    ...SEGMENTATION_PARAMS,
    { key: 'minNucleus', label: 'Nucleus length (notes)', type: 'number', min: 1, max: 60, help: 'The middle segment must have at least this many notes.' },
    { key: 'minTotal', label: 'Total length (notes)', type: 'number', min: 1, max: 200, help: 'The three segments together must have at least this many notes.' },
    { key: 'minCount', label: 'Minimum count', type: 'number', min: 1, max: 1000, help: 'A triple B N A must occur at least this often to be considered.' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'Each table keeps this many rows.' },
  ],
  defaults: { segmentation: 'syllable', segmentN: 3, minNucleus: 5, minTotal: 15, minCount: 2, rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues, io) {
    const minNucleus = p['minNucleus'] as number;
    const minTotal = p['minTotal'] as number;
    const minCount = p['minCount'] as number;
    const cut = segmentationOf(p);
    const idx = buildSegmentIndex(corpus.chants, cut.how, cut.n);
    const len = (id: number) => idx.segments[id].pitches.length;
    const triples = new Map<string, { b: number; n: number; a: number; count: number; docs: string[] }>();
    idx.chantSegments.forEach((ids, d) => {
      if (d % 200 === 0) io.progress(d, corpus.chants.length);
      for (let k = 1; k + 1 < ids.length; k++) {
        const b = ids[k - 1]; const n = ids[k]; const a = ids[k + 1];
        if (len(n) < minNucleus || len(b) + len(n) + len(a) < minTotal) continue;
        const key = `${b}_${n}_${a}`;
        let t = triples.get(key);
        if (!t) { t = { b, n, a, count: 0, docs: [] }; triples.set(key, t); }
        t.count++;
        sampleDoc(t.docs, corpus.docs[d].id, ROW_DOC_CAP);
      }
    });
    const frequent = [...triples.values()].filter((t) => t.count >= minCount);
    const pairs = new Map<string, { b: number; a: number; nuclei: { n: number; count: number }[]; count: number; docs: string[] }>();
    for (const t of frequent) {
      const key = `${t.b}_${t.a}`;
      let pr = pairs.get(key);
      if (!pr) { pr = { b: t.b, a: t.a, nuclei: [], count: 0, docs: [] }; pairs.set(key, pr); }
      pr.nuclei.push({ n: t.n, count: t.count });
      pr.count += t.count;
      for (const d of t.docs) sampleDoc(pr.docs, d, ROW_DOC_CAP);
    }
    const bridges = [...pairs.values()].filter((b) => b.nuclei.length >= 2).sort((x, y) => y.nuclei.length - x.nuclei.length || y.count - x.count);
    const seg = (id: number) => pitchNotation(idx.segments[id].pitches);
    const segText = (id: number) => `${id}: ${notesLabel(idx.segments[id].pitches, 8)}`;
    return {
      summary: `${frequent.length} triples B N A of ${cut.name} (nucleus ≥ ${minNucleus} notes, total ≥ ${minTotal}, count ≥ ${minCount}); ${bridges.length} bridges: pairs B_A with two or more nuclei.`,
      docCount: corpus.chants.length,
      views: [
        {
          kind: 'text', title: 'How to read this',
          paragraphs: [
            `Every chant is cut into ${cut.name}. Three that follow each other are called Before (B), Nucleus (N) and After (A). Only triples whose nucleus is long (at least ${minNucleus} notes, the three together at least ${minTotal}) are kept.`,
            'A bridge is a pair B and A that occurs with several different nuclei: the same beginning and the same end, a different melisma in between. The first table lists the bridges (B and A as notes, how many different nuclei, how often); the second table shows every single triple, so each nucleus can be read.',
          ],
        },
        makeTable({
          title: 'Bridges B_A',
          columns: [
            { key: 'bid', label: 'B id', numeric: true }, { key: 'b', label: 'Before' },
            { key: 'aid', label: 'A id', numeric: true }, { key: 'a', label: 'After' },
            { key: 'n', label: 'Different nuclei', numeric: true }, { key: 'c', label: 'Occurrences', numeric: true },
            { key: 'top', label: 'Most frequent nuclei (id × count)' },
          ],
          rows: bridges.map((b): Cell[] => [
            b.b, seg(b.b), b.a, seg(b.a), b.nuclei.length, b.count,
            b.nuclei.sort((x, y) => y.count - x.count).slice(0, 5).map((n) => `${n.n} × ${n.count}`).join(', '),
          ]),
          rowDocs: bridges.map((b) => b.docs), cap: p['rows'] as number,
        }),
        makeTable({
          title: 'Triples B N A',
          columns: [
            { key: 'bid', label: 'B id', numeric: true }, { key: 'b', label: 'Before' },
            { key: 'nid', label: 'N id', numeric: true }, { key: 'n', label: 'Nucleus' },
            { key: 'aid', label: 'A id', numeric: true }, { key: 'a', label: 'After' }, { key: 'c', label: 'Count', numeric: true },
          ],
          rows: frequent.sort((x, y) => y.count - x.count).map((t): Cell[] => [t.b, seg(t.b), t.n, seg(t.n), t.a, seg(t.a), t.count]),
          rowDocs: frequent.map((t) => t.docs), cap: p['rows'] as number,
        }),
      ],
      notes: [`Segments are cut as: ${cut.name}. Segment ids are numbered in order of first occurrence in this corpus and are valid only for this result.`],
    };
  },
};

// ── shared segment models ───────────────────────────────────────────────────

export const modelsMethod: AnalysisMethod = {
  id: 'models',
  version: 3,
  title: 'Shared models (ChantDigger models)',
  group: 'chantdigger',
  summary: 'Within each group (a genre in ChantDigger), finds sets of long segments (cut by syllable, neume, word or groups of n notes) that several chants have in common. Answers: do these chants share a melodic model?',
  uses: ['melody', 'text', 'meta'],
  cost: 3,
  params: [
    ...SEGMENTATION_PARAMS,
    { key: 'groupBy', label: 'Within groups of', type: 'field', optional: true, help: 'Models are searched inside each value of this field only. Empty: the whole corpus is one group.' },
    { key: 'minSegments', label: 'Shared segments', type: 'number', min: 2, max: 50, help: 'A model needs at least this many segments in common.' },
    { key: 'minLength', label: 'Segment length (notes)', type: 'number', min: 1, max: 40, help: 'Only segments with at least this many notes count.' },
    { key: 'minChants', label: 'Chants per model', type: 'number', min: 2, max: 200, help: 'A model must be shared by at least this many chants.' },
    { key: 'maxGroup', label: 'Largest group searched', type: 'number', min: 50, max: 3000, step: 50, help: 'Groups with more chants are cut to the first chants of this number (the search compares all pairs).' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'The table keeps this many rows.' },
  ],
  defaults: { segmentation: 'syllable', segmentN: 3, groupBy: 'doc:gattung1', minSegments: 5, minLength: 3, minChants: 3, maxGroup: 1500, rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues, io) {
    const minSegments = p['minSegments'] as number;
    const minLength = p['minLength'] as number;
    const minChants = p['minChants'] as number;
    const maxGroup = p['maxGroup'] as number;
    const cut = segmentationOf(p);
    const idx = buildSegmentIndex(corpus.chants, cut.how, cut.n);
    const grouping = groupDocs(corpus, p['groupBy'] as string, 100000);
    const found: { group: string; ids: number[]; chants: number[] }[] = [];
    const notes: string[] = [];
    const evaluated = grouping.labels.length;
    grouping.labels.forEach((label, g) => {
      io.progress(g, evaluated);
      let members: number[] = [];
      corpus.chants.forEach((_, d) => { if (grouping.of[d] === g) members.push(d); });
      if (members.length < minChants) return;
      if (members.length > maxGroup) { notes.push(`Group "${label}" has ${members.length} chants; only the first ${maxGroup} were searched.`); members = members.slice(0, maxGroup); }
      const sets = members.map((d) => [...new Set(idx.chantSegments[d].filter((id) => idx.segments[id].pitches.length >= minLength))].sort((a, b) => a - b));
      const postings = new Map<number, number[]>();
      sets.forEach((set, m) => { for (const id of set) { const l = postings.get(id); if (l) l.push(m); else postings.set(id, [m]); } });
      const models = new Map<string, number[]>();
      for (let a = 0; a < sets.length; a++) {
        const shared = new Map<number, number>();
        for (const id of sets[a]) for (const b of postings.get(id)!) if (b > a) shared.set(b, (shared.get(b) ?? 0) + 1);
        for (const [b, n] of shared) {
          if (n < minSegments) continue;
          const other = new Set(sets[b]);
          const inter = sets[a].filter((id) => other.has(id));
          models.set(inter.join(','), inter);
        }
      }
      const setObjs = sets.map((s) => new Set(s));
      for (const ids of [...models.values()].slice(0, 20000)) {
        const rarest = ids.reduce((best, id) => (postings.get(id)!.length < postings.get(best)!.length ? id : best), ids[0]);
        const chants = postings.get(rarest)!.filter((m) => ids.every((id) => setObjs[m].has(id)));
        if (chants.length >= minChants) found.push({ group: label, ids, chants: chants.map((m) => members[m]) });
      }
    });
    found.sort((x, y) => y.chants.length - x.chants.length || y.ids.length - x.ids.length);
    return {
      summary: `${found.length} models of ${cut.name}: ≥ ${minSegments} segments (≥ ${minLength} notes) shared by ≥ ${minChants} chants.`,
      docCount: corpus.chants.length,
      views: [
        makeTable({
          title: 'Models',
          columns: [
            { key: 'g', label: 'Group' }, { key: 'k', label: 'Segments', numeric: true }, { key: 'c', label: 'Chants', numeric: true },
            { key: 'ids', label: 'Segment ids' }, { key: 'ex', label: 'First segment (notes)' },
          ],
          rows: found.map((f): Cell[] => [
            f.group, f.ids.length, f.chants.length,
            f.ids.slice(0, 12).join(' ') + (f.ids.length > 12 ? ' …' : ''), pitchNotation(idx.segments[f.ids[0]].pitches),
          ]),
          rowDocs: found.map((f) => f.chants.slice(0, ROW_DOC_CAP).map((d) => corpus.docs[d].id)), cap: p['rows'] as number,
        }),
      ],
      notes: [...notes.slice(0, 5), 'A model is a set of segments, not a sequence. Smaller models contained in larger ones with the same chants are listed too.'],
    };
  },
};

// ── syllable groups ─────────────────────────────────────────────────────────

/** Number of syllables of a chant that have text (a chant without text counts its syllables with notes). */
export function syllableCount(sylText: readonly string[], sylLen: readonly number[]): number {
  const withText = sylText.filter((t) => t.trim() !== '').length;
  return withText > 0 ? withText : sylLen.length;
}

export const syllableGroupsMethod: AnalysisMethod = {
  id: 'syllable-groups',
  version: 1,
  title: 'Chants of equal length (ChantDigger SM5)',
  group: 'chantdigger',
  summary: 'Groups chants of the same genre with the same number of syllables and lays the syllables of the largest group side by side. Answers: do chants with the same syllable count share a model, or is it chance?',
  uses: ['text', 'meta'],
  cost: 1,
  params: [
    { key: 'groupBy', label: 'Within groups of', type: 'field', optional: true, help: 'Chants are compared inside each value of this field only (ChantDigger: corpus and genre).' },
    { key: 'minChants', label: 'Chants per group', type: 'number', min: 2, max: 200, help: 'Groups with fewer chants are not listed (ChantDigger used 5).' },
    { key: 'showCount', label: 'Syllable table for length', type: 'number', min: 0, max: 400, help: 'Show the syllables of the chants with exactly this many syllables. 0: the largest group.' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'The group table keeps this many rows.' },
  ],
  defaults: { groupBy: 'doc:gattung1', minChants: 5, showCount: 0, rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues) {
    const minChants = p['minChants'] as number;
    const grouping = groupDocs(corpus, p['groupBy'] as string, 100000);
    const buckets = new Map<string, { group: string; count: number; docs: number[] }>();
    corpus.chants.forEach((c, d) => {
      const n = syllableCount(c.sylText, c.sylLen);
      const key = `${grouping.of[d]}|${n}`;
      let b = buckets.get(key);
      if (!b) { b = { group: grouping.labels[grouping.of[d]], count: n, docs: [] }; buckets.set(key, b); }
      b.docs.push(d);
    });
    const list = [...buckets.values()].filter((b) => b.docs.length >= minChants).sort((a, b) => b.docs.length - a.docs.length || a.count - b.count);
    const showCount = p['showCount'] as number;
    const chosen = showCount > 0 ? list.find((b) => b.count === showCount) : list[0];
    const views: ResultView[] = [
      makeTable({
        title: 'Groups of equal syllable count',
        columns: [{ key: 'g', label: 'Group' }, { key: 'n', label: 'Syllables', numeric: true }, { key: 'c', label: 'Chants', numeric: true }],
        rows: list.map((b): Cell[] => [b.group, b.count, b.docs.length]),
        rowDocs: list.map((b) => b.docs.slice(0, ROW_DOC_CAP).map((d) => corpus.docs[d].id)), cap: p['rows'] as number,
      }),
    ];
    const notes: string[] = [];
    if (chosen) {
      const shown = chosen.docs.slice(0, 60);
      const joined = (d: number) => corpus.chants[d].sylText.filter((t) => t.trim() !== '');
      views.push(makeTable({
        title: `Syllables of ${chosen.docs.length} chants in "${chosen.group}" with ${chosen.count} syllables`,
        columns: [{ key: 'l', label: 'Chant' }, ...Array.from({ length: chosen.count }, (_, i) => ({ key: `s${i}`, label: String(i + 1) }))],
        rows: shown.map((d): Cell[] => [corpus.docs[d].label, ...Array.from({ length: chosen.count }, (_, i) => joined(d)[i] ?? '')]),
        rowDocs: shown.map((d) => [corpus.docs[d].id]), cap: 60,
      }));
      if (chosen.docs.length > 60) notes.push('The syllable table shows the first 60 chants of the group.');
    } else if (showCount > 0) notes.push(`No group with ${showCount} syllables and at least ${minChants} chants.`);
    return { summary: `${list.length} groups of ≥ ${minChants} chants with equal syllable count.`, docCount: corpus.chants.length, views, notes };
  },
};

// ── axis ────────────────────────────────────────────────────────────────────

/** The `size` most frequent pitches of a chant, most frequent first (ties: the lower pitch first). */
export function chantAxis(pitches: readonly number[], size: number): number[] {
  const counts = new Map<number, number>();
  for (const v of pitches) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, size).map((e) => e[0]);
}

export const axisMethod: AnalysisMethod = {
  id: 'axis',
  version: 2,
  title: 'Axis: most frequent notes (ChantDigger "find axis")',
  group: 'chantdigger',
  summary: 'Takes the N most frequent notes of every chant (its axis: repercussa, tenor) and groups the chants that share the same axis. Answers: which chants are built around the same notes?',
  uses: ['melody', 'meta'],
  cost: 1,
  params: [
    { key: 'size', label: 'Notes in the axis', type: 'number', min: 1, max: 5, help: 'How many of the most frequent notes form the axis (ChantDigger allows up to 5).' },
    { key: 'ordered', label: 'Distinguish rank order', type: 'boolean', help: 'On: chants only match if the notes have the same frequency order. Off: the same set of notes is enough.' },
    GROUP_PARAM,
    { key: 'minChants', label: 'Chants per axis', type: 'number', min: 1, max: 500, help: 'Axes shared by fewer chants are not listed.' },
    { key: 'rows', label: 'Rows kept', type: 'number', min: 20, max: 5000, step: 10, help: 'The table keeps this many rows.' },
  ],
  defaults: { size: 3, ordered: false, groupBy: 'doc:gattung1', minChants: 2, rows: DEFAULT_ROW_CAP },
  run(corpus: Corpus, p: ParamValues) {
    const size = p['size'] as number;
    const ordered = p['ordered'] as boolean;
    const minChants = p['minChants'] as number;
    const grouping = groupDocs(corpus, p['groupBy'] as string, 8);
    const showGroups = p['groupBy'] !== '' && grouping.labels.length > 1;
    const axes = new Map<string, { notes: number[]; chants: number; byGroup: number[]; docs: string[] }>();
    let skipped = 0;
    corpus.chants.forEach((c, d) => {
      if (c.pitches.length === 0) { skipped++; return; }
      const top = chantAxis(c.pitches, size);
      const notes = ordered ? top : [...top].sort((a, b) => a - b);
      const key = notes.join(',');
      let e = axes.get(key);
      if (!e) { e = { notes, chants: 0, byGroup: new Array<number>(grouping.labels.length).fill(0), docs: [] }; axes.set(key, e); }
      e.chants++;
      e.byGroup[grouping.of[d]]++;
      sampleDoc(e.docs, corpus.docs[d].id, ROW_DOC_CAP);
    });
    const list = [...axes.values()].filter((a) => a.chants >= minChants).sort((a, b) => b.chants - a.chants || a.notes.join().localeCompare(b.notes.join()));
    const label = (a: { notes: number[] }) => a.notes.map(pitchLabel).join(ordered ? ' > ' : ' ');
    return {
      summary: `${axes.size} distinct axes of ${size} notes over ${corpus.chants.length - skipped} chants; ${list.length} shared by ≥ ${minChants} chants.`,
      docCount: corpus.chants.length - skipped,
      views: [
        { kind: 'bars', layout: 'rows', title: 'Most shared axes', items: list.slice(0, 15).map((a) => ({ label: label(a), value: a.chants, notation: pitchNotation(a.notes).notation })), unit: 'chants' },
        makeTable({
          title: 'Axes',
          columns: [
            { key: 'a', label: ordered ? 'Axis (most frequent first)' : 'Axis (low to high)' }, { key: 'c', label: 'Chants', numeric: true },
            ...(showGroups ? grouping.labels.map((l, i) => ({ key: `g${i}`, label: l, numeric: true })) : []),
          ],
          rows: list.map((a): Cell[] => [pitchNotation(a.notes), a.chants, ...(showGroups ? a.byGroup : [])]),
          rowDocs: list.map((a) => a.docs), cap: p['rows'] as number,
        }),
      ],
      notes: skipped ? [`${skipped} chants without notes were skipped.`] : [],
    };
  },
};

