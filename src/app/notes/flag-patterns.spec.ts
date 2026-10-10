import { musicLanguage } from './language';
import { applyFlag, findFlagMatches, FlagQuery, queryProblem } from './flag-patterns';
import { describeNeume, extractPattern } from '../transcription-analyzer-core';
import * as VM from '../types/model';

/** A document with one syllable per entry; each entry is note text such as "c d  e". */
function docOf(...texts: string[]): VM.RootContainer {
  const root = VM.emptyRootContainer();
  const formteil = VM.emptyFormteilContainer(VM.DocumentType.Level1, []);
  const zeile = VM.emptyZeileContainer(1);
  zeile.children = texts.map((t, i) => {
    const s = VM.emptySyllable(i + 1);
    s.text = 'syl' + i;
    s.notes = musicLanguage.Spaced.tryParse(t);
    return s;
  });
  formteil.children = [zeile];
  root.children = [formteil];
  return root;
}

const q = (text: string, over: Partial<FlagQuery> = {}): FlagQuery =>
  ({ text, mode: 'whole', ignoreShapes: true, target: 'first', nth: 1, ...over });

describe('flag patterns', () => {
  it('describeNeume agrees with extractPattern', () => {
    for (const t of ['c d', 'cd', 'c d[o] c', 'cdc  e', 'c[l] d e']) {
      for (const ns of musicLanguage.Spaced.tryParse(t).spaced) {
        const steps = describeNeume(ns);
        const parts: string[] = [];
        let i = 0;
        for (const g of ns.nonSpaced) {
          const n = g.grouped.length;
          if (n === 0) continue;
          if (n > 1) parts.push('[');
          for (let k = 0; k < n; k++, i++) parts.push((steps[i].step === '*' ? '*' : steps[i].step) + steps[i].suffix);
          if (n > 1) parts.push(']');
        }
        expect(parts.join('')).toBe(extractPattern(ns));
      }
    }
  });

  it('whole mode: separate groups (*u) and a ligature ([*u]) are different patterns', () => {
    const root = docOf('c d', 'cd');
    expect(findFlagMatches(root, q('*u')).map(m => m.syllableText)).toEqual(['syl0']);
    expect(findFlagMatches(root, q('[*u]')).map(m => m.syllableText)).toEqual(['syl1']);
    expect(findFlagMatches(root, q('*?')).length).toBe(1); // ? is any step; brackets still count
  });

  it('whole mode: shapes are ignored by default and compared when asked', () => {
    const root = docOf('c d[o]');
    expect(findFlagMatches(root, q('*u')).length).toBe(1);
    expect(findFlagMatches(root, q('*u', { ignoreShapes: false })).length).toBe(0);
    expect(findFlagMatches(root, q('*uO', { ignoreShapes: false })).length).toBe(1);
  });

  it('contains mode finds steps anywhere in a neume and picks the target note', () => {
    const root = docOf('c d c');                 // *ud
    const [m] = findFlagMatches(root, q('ud', { mode: 'contains' }));
    expect(m.notes.length).toBe(3);
    expect(m.targets.map(n => String(n.base))).toEqual(['C']);
    expect(findFlagMatches(root, q('ud', { mode: 'contains', target: 'last' }))[0].targets[0].base as string).toBe('C');
    expect(findFlagMatches(root, q('d', { mode: 'contains', target: 'all' }))[0].targets.length).toBe(2);
    expect(findFlagMatches(root, q('ud', { mode: 'contains', target: 'nth', nth: 2 }))[0].targets[0].base as string).toBe('D');
    expect(findFlagMatches(root, q('uu', { mode: 'contains' })).length).toBe(0);
  });

  it('contains mode: a leading * anchors at the neume start; matches do not overlap', () => {
    const root = docOf('c d e f g');             // *uuuu
    expect(findFlagMatches(root, q('uu', { mode: 'contains' })).length).toBe(2);
    expect(findFlagMatches(root, q('*uu', { mode: 'contains' })).length).toBe(1);
    expect(findFlagMatches(root, q('*dd', { mode: 'contains' })).length).toBe(0);
  });

  it('adds and removes a flag idempotently and drops an empty flag list', () => {
    const root = docOf('c d', 'c d');
    const matches = findFlagMatches(root, q('*u', { target: 'all' }));
    expect(applyFlag(matches, 'V', 'add')).toEqual({ notes: 4, matches: 2 });
    expect(applyFlag(matches, 'V', 'add')).toEqual({ notes: 0, matches: 0 });
    expect(matches[0].targets[0].flags).toEqual(['V']);
    expect(applyFlag(matches, 'V', 'remove')).toEqual({ notes: 4, matches: 2 });
    expect(matches[0].targets[0].flags).toBeUndefined();
  });

  it('reports unusable queries', () => {
    expect(queryProblem('*u')).toBeNull();
    expect(queryProblem('')).toBeNull();
    expect(queryProblem('xyz')).not.toBeNull();
    expect(queryProblem('[*u')).not.toBeNull();
    expect(findFlagMatches(docOf('c d'), q('[*u'))).toEqual([]);
  });
});
