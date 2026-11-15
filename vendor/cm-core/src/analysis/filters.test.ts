import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyFilters, describeFilters, filtersKey, frequentValues, hasExcludeRules, LATIN_STOP_WORDS, NO_FILTERS, parseWordList, ruleMatches, stopWordSet } from './filters.ts';
import type { CorpusFilters } from './filters.ts';
import { runMethod } from './registry.ts';
import { chant, corpusOf } from './test-helpers.ts';

const f = (over: Partial<CorpusFilters>): CorpusFilters => ({ ...NO_FILTERS, ...over });

describe('exclusion rules', () => {
  it('contains: a part of the value, case ignored; equals: the whole value', () => {
    assert.equal(ruleMatches({ field: 'doc:textinitium', mode: 'contains', value: 'kyrie' }, { 'doc:textinitium': 'Kyrie eleison' }), true);
    assert.equal(ruleMatches({ field: 'doc:textinitium', mode: 'equals', value: 'kyrie' }, { 'doc:textinitium': 'Kyrie eleison' }), false);
    assert.equal(ruleMatches({ field: 'doc:textinitium', mode: 'equals', value: 'KYRIE ELEISON' }, { 'doc:textinitium': 'Kyrie eleison' }), true);
  });

  it('an empty rule value or an unset field matches nothing', () => {
    assert.equal(ruleMatches({ field: 'doc:textinitium', mode: 'contains', value: '' }, { 'doc:textinitium': 'x' }), false);
    assert.equal(ruleMatches({ field: 'doc:textinitium', mode: 'contains', value: 'x' }, {}), false);
    assert.equal(hasExcludeRules(f({ exclude: [{ field: 'a', mode: 'contains', value: ' ' }] })), false);
  });
});

describe('applyFilters', () => {
  const corpus = corpusOf(
    [chant([{ text: 'Ky-', pitches: [1] }]), chant([{ text: 'Do-', pitches: [2] }, { text: 'mi-', pitches: [3] }, { text: 'nus', pitches: [4] }]), chant([{ text: 'et', pitches: [5] }])],
    (i) => ({ 'doc:textinitium': ['Kyrie eleison', 'Dominus regnavit', 'Et in terra'][i] }),
  );

  it('does nothing without filters (the same corpus object)', () => {
    const r = applyFilters(corpus, NO_FILTERS);
    assert.equal(r.corpus, corpus);
    assert.deepEqual(r.excluded, []);
    assert.deepEqual(r.kept, [0, 1, 2]);
  });

  it('leaves out the chants that match any rule and reports which', () => {
    const r = applyFilters(corpus, f({ exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'kyrie' }, { field: 'doc:textinitium', mode: 'contains', value: 'et in' }] }));
    assert.deepEqual(r.kept, [1]);
    assert.deepEqual(r.excluded, [0, 2]);
    assert.equal(r.corpus.chants.length, 1);
    assert.equal(r.corpus.docs[0].id, 'd1');
  });

  it('removes stop words from the words of every chant and leaves the melody alone', () => {
    const r = applyFilters(corpus, f({ stopWords: { builtIn: true, custom: ['dominus'] } }));
    assert.deepEqual(r.corpus.chants[0].words, ['ky']); // not a stop word: unchanged
    assert.deepEqual(r.corpus.chants[1].words, []); // "dominus" is a custom stop word
    assert.deepEqual(r.corpus.chants[2].words, []); // "et" is built in
    assert.deepEqual(r.corpus.chants[1].pitches, [2, 3, 4]);
    assert.equal(r.excluded.length, 0);
  });

  it('every method sees the reduced corpus: word counts drop the stop words, chant counts drop the excluded chants', () => {
    const r = applyFilters(corpus, f({ exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'kyrie' }], stopWords: { builtIn: false, custom: ['dominus'] } }));
    const out = runMethod('overview', r.corpus, { groupBy: '', words: 20 }, { progress: () => undefined }).result;
    const t = out.views[0];
    assert.ok(t.kind === 'table');
    assert.equal(t.rows[0][1], 2); // two chants left
  });
});

describe('helpers', () => {
  it('the built-in list has the usual function words', () => {
    for (const w of ['et', 'in', 'ad', 'cum', 'non']) assert.ok(LATIN_STOP_WORDS.includes(w), w);
  });

  it('stopWordSet joins the built-in list and the custom words', () => {
    const s = stopWordSet(f({ stopWords: { builtIn: true, custom: [' Domine ', ''] } }));
    assert.ok(s.has('et') && s.has('domine'));
    assert.equal(stopWordSet(NO_FILTERS).size, 0);
  });

  it('parseWordList splits on spaces, commas and lines, lower-cases and drops repeats', () => {
    assert.deepEqual(parseWordList('Kyrie, eleison\nkyrie  Christe;'), ['kyrie', 'eleison', 'christe']);
  });

  it('filtersKey is empty without filters and stable for the same filters in another order', () => {
    assert.equal(filtersKey(NO_FILTERS), '');
    assert.equal(filtersKey(undefined), '');
    const a = filtersKey(f({ exclude: [{ field: 'a', mode: 'contains', value: 'X' }, { field: 'b', mode: 'equals', value: 'y' }], stopWords: { builtIn: false, custom: ['b', 'a'] } }));
    const b = filtersKey(f({ exclude: [{ field: 'b', mode: 'equals', value: 'y' }, { field: 'a', mode: 'contains', value: 'x' }], stopWords: { builtIn: false, custom: ['a', 'b'] } }));
    assert.equal(a, b);
    assert.notEqual(a, filtersKey(f({ exclude: [{ field: 'a', mode: 'contains', value: 'x' }] })));
  });

  it('describes the filters for the provenance line', () => {
    assert.equal(describeFilters(NO_FILTERS), '');
    assert.match(describeFilters(f({ exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'kyrie' }], stopWords: { builtIn: true, custom: [] } })), /without chants where textinitium contains "kyrie"; \d+ stop words removed/);
  });

  it('frequentValues lists the values of a field, most frequent first', () => {
    const c = corpusOf([chant([]), chant([]), chant([]), chant([])], (i) => ({ 'doc:textinitium': ['Kyrie', 'Kyrie', 'Gloria', ''][i] }));
    assert.deepEqual(frequentValues(c, 'doc:textinitium'), [{ value: 'Kyrie', chants: 2 }, { value: 'Gloria', chants: 1 }]);
  });
});
