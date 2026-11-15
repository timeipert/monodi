import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateMode, tenorOf } from './methods/descriptive.ts';
import { chantAxis, syllableCount } from './methods/chantdigger.ts';
import { matrixToCsv, matrixToNexus } from './methods/stylometry.ts';
import { getMethod, METHODS, runMethod } from './registry.ts';
import { cellText, makeTable, normalizeParams } from './result.ts';
import type { MethodResult, TableView } from './result.ts';
import { pitchLabel } from './corpus.ts';
import { tableToCsv } from './csv.ts';
import { chant, corpusOf, plain } from './test-helpers.ts';
import type { ChantFeatures } from './corpus.ts';
import { segmentSpans } from './segmentation.ts';
import { buildSegmentIndex } from './segments.ts';

const io = { progress: () => undefined };
const run = (id: string, corpus: ReturnType<typeof corpusOf>, params: Record<string, number | boolean | string> = {}): MethodResult => runMethod(id, corpus, params, io).result;
const table = (r: MethodResult, title: string): TableView => {
  const v = r.views.find((x) => x.kind === 'table' && x.title.startsWith(title));
  assert.ok(v && v.kind === 'table', `no table "${title}" in ${r.views.map((x) => x.title).join(' | ')}`);
  return v;
};

/** A small deterministic random generator. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}

describe('registry', () => {
  it('has unique ids and a default for every parameter', () => {
    const ids = METHODS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of METHODS) {
      assert.ok(m.uses.length > 0, m.id);
      for (const p of m.params) assert.ok(p.key in m.defaults, `${m.id}.${p.key} has no default`);
    }
  });

  it('every method runs on an empty corpus and on a corpus of one chant without failing', () => {
    for (const m of METHODS) {
      for (const corpus of [corpusOf([]), corpusOf([plain([30, 31, 32, 31])]), corpusOf([chant([])])]) {
        const { result } = runMethod(m.id, corpus, undefined, io);
        assert.ok(Array.isArray(result.views), m.id);
        assert.equal(typeof result.summary, 'string');
      }
    }
  });

  it('normalizeParams fills defaults and clamps numbers and selects', () => {
    const m = getMethod('ngrams')!;
    const p = normalizeParams(m, { nFrom: 99, unit: 'nonsense', minCount: -4 });
    assert.equal(p['nFrom'], 12);
    assert.equal(p['unit'], 'interval');
    assert.equal(p['minCount'], 1);
    assert.equal(p['groupBy'], 'doc:gattung1');
  });

  it('runMethod rejects an unknown method', () => {
    assert.throws(() => runMethod('nope', corpusOf([]), undefined, io), /Unknown analysis method/);
  });
});

describe('makeTable', () => {
  it('cuts to the cap and records the full row count', () => {
    const t = makeTable({ title: 't', columns: [{ key: 'a', label: 'A' }], rows: [[1], [2], [3]], cap: 2 });
    assert.equal(t.rows.length, 2);
    assert.equal(t.totalRows, 3);
    assert.equal(t.truncated, true);
  });

  it('exports CSV with quoting', () => {
    const t = makeTable({ title: 't', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B, b' }], rows: [['x"y', 2], [null, 'p,q']] });
    assert.equal(tableToCsv(t), 'A,"B, b"\n"x""y",2\n,"p,q"\n');
  });
});

describe('overview', () => {
  it('counts chants, syllables and notes and reports the groups', () => {
    const c = corpusOf([plain([30, 31, 32]), plain([30, 30])], (i) => ({ 'src:quellensigle': i === 0 ? 'A' : 'B' }));
    const r = run('overview', c, { groupBy: 'src:quellensigle' });
    const t = table(r, 'Corpus');
    assert.deepEqual(t.rows.slice(0, 4), [['Chants', 2], ['Chants without notes', 0], ['Syllables', 5], ['Notes', 5]]);
    assert.equal(table(r, 'Groups').rows.length, 2);
  });
});

describe('tonal profile', () => {
  it('estimates mode 1 for a melody on D that ends on D and rests on A', () => {
    const e = estimateMode([29, 31, 33, 32, 33, 31, 29]);
    assert.deepEqual([e.mode, e.confidence, e.final, e.tenor], [1, 'high', 29, 33]);
  });

  it('estimates a plagal mode for a melody that lies around the final', () => {
    const e = estimateMode([27, 28, 29, 30, 28, 27, 29]);
    assert.equal(e.mode, 2);
    assert.equal(e.confidence, 'medium');
  });

  it('gives no mode when the final is not D, E, F or G', () => {
    assert.equal(estimateMode([30, 32, 33]).mode, null); // ends on A
    assert.equal(estimateMode([]).mode, null);
  });

  it('tenorOf returns the most frequent pitch, the one reached first on a tie', () => {
    assert.equal(tenorOf([5, 6, 6, 5, 7]), 6);
    assert.equal(tenorOf([]), null);
  });

  it('compares the estimate with a stored mode field', () => {
    const c = corpusOf([plain([29, 31, 33, 32, 33, 31, 29])], () => ({ 'custom:mode': '1' }));
    const r = run('tonal-profile', c);
    assert.match(r.notes.join(' '), /agrees on 1 \(100%\)/);
    assert.equal(table(r, 'Chants').rows[0][7], 1);
  });
});

describe('ngrams', () => {
  it('counts n-grams, documents and the distribution over groups', () => {
    const a = plain([10, 11, 12, 10, 11, 12]); // intervals +1 +1 -2 +1 +1
    const b = plain([10, 11, 12]);
    const c = corpusOf([a, b], (i) => ({ 'doc:gattung1': i === 0 ? 'Antiphon' : 'Responsory' }));
    const r = run('ngrams', c, { unit: 'interval', nFrom: 2, nTo: 2, minCount: 1, minDocs: 1, groupBy: 'doc:gattung1' });
    const t = table(r, 'Patterns');
    assert.deepEqual(t.columns.map((x) => x.label).slice(0, 5), ['#', 'Pattern', 'Count', 'Per 10,000', 'Chants']);
    const row = t.rows.find((x) => cellText(x[1]) === '+1 +1')!;
    assert.equal(row[2], 3); // twice in a, once in b
    assert.equal(row[4], 2);
    assert.deepEqual(row.slice(5), [2, 1]);
    assert.equal(t.rowDocs![t.rows.indexOf(row)]!.length, 2);
  });

  it('respects the minimum counts', () => {
    const c = corpusOf([plain([10, 11, 12]), plain([10, 12, 11])]);
    const r = run('ngrams', c, { unit: 'pitch', nFrom: 2, nTo: 2, minCount: 2, minDocs: 1, groupBy: '' });
    assert.equal(table(r, 'Patterns').rows.length, 0);
  });

  it('counts words of the text', () => {
    const c = corpusOf([chant([{ text: 'Do-', pitches: [1] }, { text: 'mi-', pitches: [2] }, { text: 'nus', pitches: [3] }, { text: 'et', pitches: [4] }])]);
    const r = run('ngrams', c, { unit: 'word', nFrom: 1, nTo: 1, minCount: 1, minDocs: 1, groupBy: '' });
    assert.deepEqual(table(r, 'Patterns').rows.map((x) => cellText(x[1])).sort(), ['dominus', 'et']);
  });
});

describe('keyness', () => {
  it('lists what is typical of the target group and of the reference', () => {
    const rising = Array.from({ length: 8 }, (_, i) => plain([10, 11, 12, 13, 14 + (i % 2)]));
    const falling = Array.from({ length: 8 }, (_, i) => plain([14, 13, 12, 11, 10 - (i % 2)]));
    const c = corpusOf([...rising, ...falling], (i) => ({ 'doc:gattung1': i < 8 ? 'Up' : 'Down' }));
    const r = run('keyness', c, { unit: 'interval', nFrom: 1, nTo: 1, groupBy: 'doc:gattung1', target: 'Up', reference: 'Down', minCount: 5 });
    const over = table(r, 'Overused in "Up"');
    assert.equal(cellText(over.rows[0][1]), '+1');
    assert.ok((over.rows[0][6] as number) > 10);
    assert.ok((over.rows[0][7] as number) > 0);
    assert.equal(cellText(table(r, 'Overused in the reference').rows[0][1]), '-1');
  });

  it('uses the largest group when no target is given', () => {
    const c = corpusOf([plain([1, 2]), plain([1, 2]), plain([3, 2])], (i) => ({ 'doc:gattung1': i < 2 ? 'Big' : 'Small' }));
    const r = run('keyness', c, { unit: 'interval', nFrom: 1, nTo: 1, groupBy: 'doc:gattung1', minCount: 1 });
    assert.match(r.summary, /"Big"/);
  });
});

describe('collocations', () => {
  it('ranks a pair that always occurs together above chance pairs', () => {
    const chants = Array.from({ length: 20 }, (_, i) => plain([30, 31, 20 + (i % 5), 40 + (i % 3)]));
    const r = run('collocations', corpusOf(chants), { unit: 'pitch', window: 1, minCount: 10, measure: 'logdice' });
    const t = table(r, 'Collocations');
    assert.equal(cellText(t.rows[0][1]), `${pitchLabel(30)} ${pitchLabel(31)}`);
    assert.equal(t.rows[0][2], 20);
  });
});

describe('source distance', () => {
  function family(seed: number, upBias: number, count: number) {
    const rnd = rng(seed);
    return Array.from({ length: count }, () => {
      const p = [30];
      for (let i = 0; i < 60; i++) p.push(p[p.length - 1] + (rnd() < upBias ? 1 : -1) * (rnd() < 0.25 ? 2 : 1));
      return plain(p);
    });
  }

  it('puts sources of similar habit next to each other and returns tree, map and matrix', () => {
    const chants = [...family(1, 0.8, 6), ...family(2, 0.8, 6), ...family(3, 0.2, 6)];
    const c = corpusOf(chants, (i) => ({ 'src:quellensigle': ['A', 'B', 'C'][Math.floor(i / 6)] }));
    const r = run('source-distance', c, { groupBy: 'src:quellensigle', unit: 'interval', n: 2, topFeatures: 60, measure: 'delta', minChants: 5 });
    assert.deepEqual(r.views.map((v) => v.kind), ['tree', 'scatter', 'matrix', 'table']);
    const nn = table(r, 'Nearest neighbours').rows;
    assert.match(String(nn.find((x) => x[0] === 'A')![2]), /^B /);
    assert.match(String(nn.find((x) => x[0] === 'B')![2]), /^A /);
    const tree = r.views[0];
    assert.ok(tree.kind === 'tree' && tree.merges.length === 2);
  });

  it('works with cosine and jaccard distances', () => {
    const chants = [...family(1, 0.8, 5), ...family(2, 0.8, 5), ...family(3, 0.2, 5)];
    const c = corpusOf(chants, (i) => ({ 'src:quellensigle': ['A', 'B', 'C'][Math.floor(i / 5)] }));
    for (const measure of ['cosine', 'jaccard']) {
      const r = run('source-distance', c, { groupBy: 'src:quellensigle', unit: 'interval', n: 2, topFeatures: 60, measure, minChants: 5 });
      assert.match(String(table(r, 'Nearest neighbours').rows.find((x) => x[0] === 'C')![2]), /^[AB] /);
    }
  });

  it('says so when fewer than three groups qualify', () => {
    const r = run('source-distance', corpusOf([plain([1, 2])]), { minChants: 5 });
    assert.equal(r.views.length, 0);
  });

  it('writes the matrix as CSV and NEXUS', () => {
    assert.equal(matrixToCsv(['a', 'b,c'], ['a', 'b,c'], [[0, 1], [1, 0]]), ',a,"b,c"\na,0,1\n"b,c",1,0\n');
    const nexus = matrixToNexus(['a', 'b'], [[0, 2], [2, 0]]);
    assert.match(nexus, /^#NEXUS/);
    assert.match(nexus, /DIMENSIONS NTAX=2/);
    assert.match(nexus, /'a' 0 2/);
  });
});

describe('variants', () => {
  it('measures the distance between witnesses of the same chant and finds the deviant one', () => {
    const base = [30, 31, 32, 31, 30, 29, 30];
    const chants = [
      plain(base), plain(base), plain([30, 33, 35, 31, 28, 29, 30]), // chant X: third witness differs
      plain([40, 41, 42]), plain([40, 41, 42]),                        // chant Y: identical
      plain([50, 51]),                                                  // chant Z: single witness
    ];
    const names = ['X', 'X', 'X', 'Y', 'Y', 'Z'];
    const c = corpusOf(chants, (i) => ({ 'doc:textinitium': names[i] }));
    const r = run('variants', c, { groupBy: 'doc:textinitium', minGroup: 2 });
    const t = table(r, 'Chants by mean variation');
    assert.deepEqual(t.rows.map((x) => x[0]), ['X', 'Y']);
    assert.equal(t.rows[0][1], 3);
    assert.ok((t.rows[0][3] as number) > 0);
    assert.equal(t.rows[0][5], 'chant 2');
    assert.equal(t.rows[1][3], 0);
    assert.equal(table(r, 'Pairs of witnesses').rows.length, 4);
  });
});

describe('segments (ChantDigger SM2)', () => {
  const a = chant([{ text: 'Ky-', pitches: [10, 12, 11] }, { text: 'ri-', pitches: [13] }, { text: 'e', pitches: [10, 12, 11] }]);
  const b = chant([{ text: 'Ky-', pitches: [12, 14, 13] }, { text: 'ri-', pitches: [13] }, { text: 'e', pitches: [10, 12, 11] }]);
  const c = corpusOf([a, b]);

  it('indexes the segments with counts and chants', () => {
    const r = run('segments', c, { criterion: 'exact', minCount: 1, minLength: 1, groupBy: '' });
    const t = table(r, 'Segments');
    const top = t.rows[0];
    assert.deepEqual([top[0], cellText(top[1]), top[3], top[4]], [0, `${pitchLabel(10)} ${pitchLabel(12)} ${pitchLabel(11)}`, 3, 2]);
    assert.equal(t.rows.length, 3);
  });

  it('groups transposed segments by the isomorphism criterion', () => {
    const r = run('segments', c, { criterion: 'isomorphism', minCount: 1, minLength: 2, groupBy: '' });
    const classes = table(r, 'Similarity classes');
    assert.equal(classes.rows.length, 1);
    // Two distinct segments (10 12 11 and 12 14 13) with four occurrences: three of the first (twice in a, once in b), one of the second.
    assert.deepEqual(classes.rows[0].slice(1, 3), [2, 4]);
  });

  it('finds a sequence of segment ids with the text where it starts', () => {
    const r = run('segments', c, { criterion: 'exact', minCount: 1, minLength: 1, groupBy: '', sequence: '0 1' });
    const t = table(r, 'Chants containing the segment sequence');
    assert.equal(t.rows.length, 1);
    assert.equal(t.rows[0][0], 'chant 0');
    assert.equal(t.rows[0][4], 'Ky- ri-');
  });
});

describe('bridges (ChantDigger SM4)', () => {
  it('finds a pair B_A that encloses several different long nuclei', () => {
    const b = [1, 2];
    const a = [9];
    const chants = [[3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 7, 7], [4, 4, 5, 6, 7, 8]].map((n) => chant([{ pitches: b }, { pitches: n }, { pitches: a }]));
    const r = run('bridges', corpusOf(chants), { minNucleus: 5, minTotal: 9, minCount: 1 });
    const t = table(r, 'Bridges B_A');
    assert.equal(t.rows.length, 1);
    assert.equal(t.rows[0][4], 3); // three different nuclei
    assert.equal(t.rows[0][5], 3); // three occurrences
    assert.equal(table(r, 'Triples B N A').rows.length, 3);
  });

  it('ignores short nuclei', () => {
    const chants = [[3, 4], [3, 5]].map((n) => chant([{ pitches: [1, 2] }, { pitches: n }, { pitches: [9] }]));
    const r = run('bridges', corpusOf(chants), { minNucleus: 5, minTotal: 3, minCount: 1 });
    assert.equal(table(r, 'Bridges B_A').rows.length, 0);
  });
});

describe('models (ChantDigger models)', () => {
  it('finds a set of segments shared by several chants of one group', () => {
    const shared = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const chants = [0, 1, 2, 3].map((i) => chant([...shared.map((s) => ({ pitches: s })), { pitches: [20 + i, 30 + i, 40 + i] }]));
    const outsider = chant([{ pitches: [60, 61, 62] }, { pitches: [63, 64, 65] }, { pitches: [66, 67, 68] }]);
    const c = corpusOf([...chants, outsider]);
    const r = run('models', c, { groupBy: '', minSegments: 3, minLength: 3, minChants: 3, maxGroup: 100 });
    const t = table(r, 'Models');
    assert.equal(t.rows.length, 1);
    assert.deepEqual(t.rows[0].slice(1, 3), [3, 4]);
  });
});

describe('syllable groups (ChantDigger SM5)', () => {
  it('groups chants of equal syllable count and shows the syllables of the largest group', () => {
    const five = Array.from({ length: 5 }, (_, i) => plain([1, 2, 3], [`a${i}`, 'b', 'c']));
    const two = Array.from({ length: 2 }, () => plain([1, 2, 3, 4]));
    const r = run('syllable-groups', corpusOf([...five, ...two]), { groupBy: '', minChants: 5, showCount: 0 });
    assert.deepEqual(table(r, 'Groups').rows, [['(all)', 3, 5]]);
    const m = table(r, 'Syllables of 5 chants');
    assert.equal(m.columns.length, 4);
    assert.deepEqual(m.rows[0], ['chant 0', 'a0', 'b', 'c']);
  });

  it('counts the syllables that have text', () => {
    assert.equal(syllableCount(['a', '', 'b'], [1, 0, 1]), 2);
    assert.equal(syllableCount(['', ''], [1, 1]), 2);
  });
});

describe('axis (ChantDigger find axis)', () => {
  it('takes the most frequent notes, lower note first on a tie', () => {
    assert.deepEqual(chantAxis([5, 5, 6, 6, 6, 7, 7, 8], 3), [6, 5, 7]);
  });

  it('groups chants with the same set of most frequent notes', () => {
    const chants = [plain([5, 5, 6, 6, 6, 7, 7]), plain([7, 7, 6, 6, 6, 5, 5, 5]), plain([1, 1, 1, 2, 2, 3])];
    const r = run('axis', corpusOf(chants), { size: 3, ordered: false, groupBy: '', minChants: 1 });
    const t = table(r, 'Axes');
    assert.equal(t.rows[0][1], 2);
    assert.equal(cellText(t.rows[0][0]), [5, 6, 7].map(pitchLabel).join(' '));
    assert.equal(t.rows.length, 2);
  });

  it('can tell the rank order apart', () => {
    const chants = [plain([5, 5, 5, 6, 6, 7]), plain([6, 6, 6, 5, 5, 7])];
    const r = run('axis', corpusOf(chants), { size: 2, ordered: true, groupBy: '', minChants: 1 });
    assert.equal(table(r, 'Axes').rows.length, 2);
  });
});

describe('n-gram length range and the limit to one syllable, neume or word', () => {
  // Two syllables of three notes: D4 F4 G4 | A4 G4 F4
  const c = chant([{ text: 'a-', pitches: [29, 31, 32] }, { text: 'b', pitches: [33, 32, 31] }]);

  it('counts several lengths in one table with a column n and per-length frequencies', () => {
    const r = run('ngrams', corpusOf([c]), { unit: 'pitch', nFrom: 1, nTo: 2, minCount: 1, minDocs: 1, groupBy: '', within: 'none' });
    const t = table(r, 'Patterns');
    assert.deepEqual(t.columns.map((x) => x.key).slice(0, 3), ['rank', 'gram', 'n']);
    const lengths = new Set(t.rows.map((x) => x[2]));
    assert.deepEqual([...lengths].sort(), [1, 2]);
    assert.equal(t.rows.filter((x) => x[2] === 2).length, 5); // five different pairs in six notes
  });

  it('counts only inside one syllable when asked: no pair crosses the syllable boundary', () => {
    const free = table(run('ngrams', corpusOf([c]), { unit: 'pitch', nFrom: 2, nTo: 2, minCount: 1, minDocs: 1, groupBy: '', within: 'none' }), 'Patterns');
    const inSyl = table(run('ngrams', corpusOf([c]), { unit: 'pitch', nFrom: 2, nTo: 2, minCount: 1, minDocs: 1, groupBy: '', within: 'syllable' }), 'Patterns');
    assert.equal(free.rows.length, 5);
    assert.equal(inSyl.rows.length, 4); // G4-A4 crosses the boundary
    assert.ok(!inSyl.rows.some((x) => cellText(x[1]) === 'G4 A4'));
  });

  it('intervals: n steps cover n + 1 notes, all of which must lie inside the segment', () => {
    const r = run('ngrams', corpusOf([c]), { unit: 'interval', nFrom: 2, nTo: 2, minCount: 1, minDocs: 1, groupBy: '', within: 'syllable' });
    // each syllable has three notes = two steps = one pair of steps; the steps across the boundary are not counted
    assert.equal(table(r, 'Patterns').rows.length, 2);
  });

  it('ignores the limit for words', () => {
    const w = chant([{ text: 'Do-', pitches: [1] }, { text: 'mi-', pitches: [2] }, { text: 'nus', pitches: [3] }]);
    const r = run('ngrams', corpusOf([w]), { unit: 'word', nFrom: 1, nTo: 1, minCount: 1, minDocs: 1, groupBy: '', within: 'syllable' });
    assert.equal(table(r, 'Patterns').rows.length, 1);
  });
});

describe('segmentation: syllable, neume, word, groups of n notes', () => {
  const c: ChantFeatures = {
    ...chant([{ text: 'Do-', pitches: [1, 2, 3] }, { text: 'mi-', pitches: [4] }, { text: 'nus', pitches: [5, 6] }, { text: 'et', pitches: [7] }]),
    neumeStart: [0, 1, 3, 4, 5, 6], // neumes: [1 2] [3] [4] [5] [6] [7]... starts are note indexes
  };

  it('syllable: the notes on each syllable that has notes', () => {
    assert.deepEqual(segmentSpans(c, 'syllable'), [{ start: 0, end: 3 }, { start: 3, end: 4 }, { start: 4, end: 6 }, { start: 6, end: 7 }]);
  });

  it('neume: from one neume start to the next, the last to the end of the chant', () => {
    assert.deepEqual(segmentSpans(c, 'neume').map((s) => [s.start, s.end]), [[0, 1], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7]]);
  });

  it('word: the notes over all syllables of a word', () => {
    // "Domi-nus" is one word (hyphens), "et" another
    assert.deepEqual(segmentSpans(c, 'word'), [{ start: 0, end: 6 }, { start: 6, end: 7 }]);
  });

  it('notes: groups of n one after the other, the last one shorter', () => {
    assert.deepEqual(segmentSpans(c, 'notes', 3).map((s) => [s.start, s.end]), [[0, 3], [3, 6], [6, 7]]);
  });

  it('the segment index follows the cut', () => {
    const syl = buildSegmentIndex([c], 'syllable');
    const word = buildSegmentIndex([c], 'word');
    assert.equal(syl.segments.length, 4);
    assert.equal(word.segments.length, 2);
    assert.deepEqual(word.chantSpans[0], [{ start: 0, end: 6 }, { start: 6, end: 7 }]);
  });

  it('segment methods take the cut as a parameter and name it in the summary', () => {
    const corpus = corpusOf([c, c]);
    const s = run('segments', corpus, { segmentation: 'word', criterion: 'exact', minCount: 1, minLength: 1, groupBy: '' });
    assert.match(s.summary, /word segments/);
    assert.equal(table(s, 'Segments').rows.length, 2);
    const g = run('segments', corpus, { segmentation: 'notes', segmentN: 2, criterion: 'exact', minCount: 1, minLength: 1, groupBy: '' });
    assert.match(g.summary, /groups of 2 notes/);
    const b = run('bridges', corpus, { segmentation: 'notes', segmentN: 2, minNucleus: 2, minTotal: 4, minCount: 1 });
    assert.ok(b.views.some((v) => v.kind === 'text'));
    assert.match(b.summary, /groups of 2 notes/);
  });
});
