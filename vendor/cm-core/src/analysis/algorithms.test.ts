import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALGORITHMS, PREPARATION, REFERENCES, latexEscape, methodReport, settingsOf } from './algorithms';
import { LATEX_MAX_ROWS, tableToLatex } from './latex';
import { METHODS } from './registry';
import { normalizeParams } from './result';
import type { TableView } from './result';

const texts = (id: string): string[] => [...ALGORITHMS[id].steps, ALGORITHMS[id].cost];

describe('algorithm descriptions', () => {
  it('every method has a description with steps, and no description belongs to an unknown method', () => {
    for (const m of METHODS) {
      assert.ok(ALGORITHMS[m.id], `no description for ${m.id}`);
      assert.ok(ALGORITHMS[m.id].steps.length >= 2, m.id);
      assert.ok(ALGORITHMS[m.id].cost.length > 10, m.id);
    }
    for (const id of Object.keys(ALGORITHMS)) assert.ok(METHODS.some((m) => m.id === id), `description of unknown method ${id}`);
  });

  it('every reference that is cited exists, and every listed reference is cited or listed on purpose', () => {
    for (const id of Object.keys(ALGORITHMS)) {
      for (const key of ALGORITHMS[id].references) assert.ok(REFERENCES[key], `${id}: unknown reference ${key}`);
      for (const t of texts(id)) for (const m of t.matchAll(/\[\[([a-z0-9]+)\]\]/g)) assert.ok(REFERENCES[m[1]], `${id}: unknown reference ${m[1]}`);
    }
    for (const r of Object.values(REFERENCES)) {
      assert.ok(r.bibtex.includes(`{${r.key},`), r.key);
      assert.match(r.text, /\(\d{4}\)|\d{4}/, r.key);
    }
  });

  it('the formulas of the statistics are written for the measures the methods use', () => {
    const names = (id: string) => ALGORITHMS[id].formulas.map((f) => f.name).join('|');
    assert.match(names('keyness'), /Log-likelihood/);
    assert.match(names('collocations'), /log-Dice/);
    assert.match(names('collocations'), /mutual information/);
    assert.match(names('source-distance'), /Delta/);
    for (const id of Object.keys(ALGORITHMS)) for (const f of ALGORITHMS[id].formulas) assert.ok(f.latex.length > 3 && f.plain.length > 3, `${id}: ${f.name}`);
  });

  it('is written without direct address and without time words', () => {
    const all = [...Object.keys(ALGORITHMS).flatMap(texts), ...PREPARATION.steps].join('\n');
    assert.ok(!/\b(we|you|your|our)\b/i.test(all), 'direct address');
    assert.ok(!/\b(today|currently|not yet|formerly)\b/i.test(all), 'time words');
  });
});

describe('methodReport', () => {
  it('names the method, its version, the settings used and the software', () => {
    const m = METHODS.find((x) => x.id === 'keyness')!;
    const params = normalizeParams(m, { unit: 'pitch', nFrom: 2, nTo: 4, target: 'Aa 13' });
    const r = methodReport('keyness', params)!;
    assert.ok(r.text.includes(`method version ${m.version}`));
    assert.ok(r.text.includes('Unit: Pitches (with octave)'));
    assert.ok(r.text.includes('n from: 2') && r.text.includes('n to: 4'));
    assert.ok(r.text.includes('Target value: Aa 13'));
    assert.ok(r.text.includes('@monodi/core/analysis'));
    assert.ok(r.text.includes('Preparation of the corpus') && r.text.includes('Algorithm'));
    assert.ok(r.text.includes('Dunning 1993'));
  });

  it('lists every setting of every method with its label', () => {
    for (const m of METHODS) {
      const params = normalizeParams(m, undefined);
      const s = settingsOf(m, params);
      assert.equal(s.length, m.params.length, m.id);
      const r = methodReport(m.id, params)!;
      for (const x of s) assert.ok(r.text.includes(`${x.label}: ${x.value}`), `${m.id}: ${x.label}`);
    }
  });

  it('names a grouping field by its label when the app supplies one', () => {
    const m = METHODS.find((x) => x.id === 'overview')!;
    const r = methodReport('overview', normalizeParams(m, { groupBy: 'src:quellensigle' }), undefined, (k) => (k === 'src:quellensigle' ? 'Source' : undefined))!;
    assert.ok(r.text.includes('Group by: Source;'));
    assert.ok(methodReport('overview', normalizeParams(m, { groupBy: 'src:quellensigle' }))!.text.includes('Group by: src:quellensigle;'));
    assert.ok(methodReport('overview', normalizeParams(m, { groupBy: '' }))!.text.includes('Group by: none;'));
  });

  it('reports the rules that left chants out', () => {
    const m = METHODS[0];
    const r = methodReport(m.id, normalizeParams(m, undefined), { exclude: [{ field: 'doc:textinitium', mode: 'contains', value: 'kyrie' }], stopWords: { builtIn: true, custom: ['abc'] } })!;
    assert.ok(r.text.includes('doc:textinitium contains “kyrie”'));
    assert.ok(r.text.includes('built-in Latin list') && r.text.includes('1 further word'));
    assert.ok(methodReport(m.id, normalizeParams(m, undefined))!.text.includes('Left out: none.'));
  });

  it('gives LaTeX with \\cite keys that BibTeX entries exist for, and nothing else', () => {
    for (const m of METHODS) {
      const r = methodReport(m.id, normalizeParams(m, undefined))!;
      const cited = [...r.latex.matchAll(/\\cite\{([a-z0-9]+)\}/g)].map((x) => x[1]);
      for (const k of cited) assert.ok(r.bibtex.includes(`{${k},`), `${m.id}: ${k}`);
      const entries = [...r.bibtex.matchAll(/^@\w+\{([a-z0-9]+),/gm)].map((x) => x[1]);
      assert.equal(new Set(entries).size, entries.length);
      assert.ok(r.latex.includes('\\begin{enumerate}') && r.latex.includes('\\end{enumerate}'));
      // no raw special characters outside commands in the prose
      assert.ok(!/(^|[^\\])[&%#_](?![^$]*\$)/m.test(r.latex.split('\n').filter((l) => l.startsWith('  \\item')).join('\n').replace(/\\[&%#_$]/g, '')), m.id);
    }
  });

  it('returns null for an unknown method', () => {
    assert.equal(methodReport('nope', {}), null);
  });
});

describe('latexEscape', () => {
  it('escapes the special characters and maps the signs LaTeX cannot read', () => {
    assert.equal(latexEscape('50% & a_b #1 {x}'), '50\\% \\& a\\_b \\#1 \\{x\\}');
    assert.equal(latexEscape('≥ 3 − 2 ± 1'), '$\\geq$ 3 $-$ 2 $\\pm$ 1');
    assert.equal(latexEscape('a–b'), 'a--b');
  });

  it('keeps \\cite commands', () => {
    assert.equal(latexEscape('see \\cite{dunning1993}_x'), 'see \\cite{dunning1993}\\_x');
  });
});

describe('tableToLatex', () => {
  const table: TableView = {
    kind: 'table', title: 'Table 1: description of the corpus', totalRows: 2, truncated: false,
    columns: [{ key: 'g', label: 'Group' }, { key: 'n', label: 'Notes per syllable', numeric: true }, { key: 'r', label: 'Range' }],
    rows: [['Aa_13 & co', 1.73, { notation: { mode: 'pitch', values: [30, 33] }, text: 'E4 A4' }], ['Ba', -2, null]],
  };

  it('writes a booktabs table with one column per column, numbers right-aligned', () => {
    const t = tableToLatex(table);
    assert.ok(t.startsWith('% requires \\usepackage{booktabs}'));
    assert.ok(t.includes('\\begin{tabular}{lrl}'));
    assert.ok(t.includes('\\toprule') && t.includes('\\midrule') && t.includes('\\bottomrule'));
    assert.ok(t.includes('Group & Notes per syllable & Range \\\\'));
    assert.ok(t.includes('Aa\\_13 \\& co & 1.73 & E4 A4 \\\\'));
    assert.ok(t.includes('Ba & $-$2 &  \\\\'));
    assert.ok(t.includes('\\caption{description of the corpus}'));
    assert.ok(t.includes('\\label{tab:table-1-description-of-the-corpus}'));
  });

  it('cuts a long table and says so, with every row on its own line', () => {
    const rows = Array.from({ length: LATEX_MAX_ROWS + 20 }, (_, i) => [`r${i}`, i] as (string | number)[]);
    const t = tableToLatex({ title: 'Long', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', numeric: true }], rows });
    assert.ok(t.includes(`% the first ${LATEX_MAX_ROWS} of ${LATEX_MAX_ROWS + 20} rows`));
    assert.equal((t.match(/ \\\\\n/g) ?? []).length, LATEX_MAX_ROWS + 1);
  });

  it('takes a caption and a label', () => {
    const t = tableToLatex(table, { caption: 'My 50% table', label: 'tab:mine' });
    assert.ok(t.includes('\\caption{My 50\\% table}') && t.includes('\\label{tab:mine}'));
  });
});
