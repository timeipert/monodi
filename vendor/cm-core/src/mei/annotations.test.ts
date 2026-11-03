// The parts of the annotation rules that need no DOM. The effect of a rule on the exported MEI is tested in the app
// (apps/monodi/src/app/mei/mei-annotations.spec.ts), because the emitter needs a browser DOM (see README.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAnnotationIndex, firstNoteOf, previewRule, ruleProblem, setHandAttr } from './annotations.ts';
import type { MeiAnnotationRule } from './mapping.model.ts';
import type { Note, RootContainer } from '../document/model.ts';

const note = (uuid: string, base: Note['base'] = 'G'): Note =>
  ({ uuid, base, octave: 4, noteType: 'Normal', liquescent: false, focus: false });

/** One line with one syllable; `neumes` lists the notes of each neume (a single ligature group per neume). */
function rootWith(text: string, neumes: Note[][]): RootContainer {
  return {
    kind: 'RootContainer', uuid: 'r', comments: [], documentType: 'Level1',
    children: [{
      kind: 'FormteilContainer', uuid: 'f', data: [],
      children: [{
        kind: 'ZeileContainer', uuid: 'z',
        children: [{
          kind: 'Syllable', uuid: 's', text, syllableType: 'Normal',
          notes: { spaced: neumes.map(grouped => ({ nonSpaced: [{ grouped }] })) }
        }]
      }]
    }]
  };
}

const rule = (over: Partial<MeiAnnotationRule>): MeiAnnotationRule => ({
  id: 'r', name: 'rule', enabled: true, target: 'nc', match: {}, set: { label: 'x' }, ...over
});

describe('MEI annotation rules without a DOM', () => {
  it('setHandAttr clears an attribute with an empty value and drops the empty map', () => {
    const n = note('a') as Note;
    setHandAttr(n, 'nc', 'tilt', 'n');
    assert.deepEqual(n.meiAttrs, { tilt: 'n' });
    setHandAttr(n, 'nc', 'tilt', '');
    assert.equal(n.meiAttrs, undefined);
  });

  it('reports why a rule cannot run', () => {
    assert.match(ruleProblem(rule({ match: { syllableText: '(' } })) ?? '', /regular expression/);
    assert.match(ruleProblem(rule({ match: { neume: { text: '*x', mode: 'whole', ignoreShapes: true } } })) ?? '', /pattern/);
    assert.match(ruleProblem(rule({ set: {} })) ?? '', /no attribute/);
    assert.match(ruleProblem(rule({ set: { 'xml:id': 'a' } })) ?? '', /xml:id/);
    assert.equal(ruleProblem(rule({})), null);
  });

  it('previewRule counts the elements a rule would write to', () => {
    const root = rootWith('a', [[note('a'), note('b', 'A')], [note('c')]]);
    assert.equal(previewRule(root, rule({ target: 'nc' })).count, 3);
    assert.equal(previewRule(root, rule({ target: 'neume' })).count, 2);
    assert.equal(previewRule(root, rule({ target: 'syllable' })).count, 1);
  });

  it('a rule on a neume pattern marks the chosen note only, and a rule with a problem is skipped', () => {
    const root = rootWith('Glo', [[note('n1'), note('n2', 'A')]]);
    const index = buildAnnotationIndex(root, [rule({ match: { neume: { text: '[*u]', mode: 'whole', ignoreShapes: true }, position: { which: 'last' } } })]);
    assert.deepEqual([...index.nc.keys()], ['n2']);
    assert.deepEqual(index.nc.get('n2'), { label: 'x' });
    const skipped = buildAnnotationIndex(root, [rule({ match: { syllableText: '(' } })]);
    assert.equal(skipped.nc.size, 0);
  });

  it('firstNoteOf returns the first note of a neume, or undefined for an empty one', () => {
    assert.equal(firstNoteOf({ nonSpaced: [{ grouped: [] }, { grouped: [note('x'), note('y')] }] })?.uuid, 'x');
    assert.equal(firstNoteOf({ nonSpaced: [] }), undefined);
  });
});
